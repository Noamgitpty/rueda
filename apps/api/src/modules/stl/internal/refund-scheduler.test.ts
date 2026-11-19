/**
 * Ordonnanceur des remboursements (US-224c, ADR-150) : enchaînement des commandes, appel au
 * connecteur avec l'ordre STOCKÉ (montant explicite de chaque jambe, clé d'idempotence stockée,
 * jamais recalculés), états SM-8, alertes FIN une fois par état, isolement des instances.
 *
 * Attendus : jambes de l'export des oracles Python (`docs/specs/tools`, via
 * `@rueda/money/golden-vectors`) — TJ02b (règlement T03, USD) et TJ08b (règlement T27, PYG sans
 * décimale), remboursement = −variation (08 E7 règle 1) ; jamais le code testé. Pays fictif `XA`.
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { BusRegistry, assertSafeAlert } from '../../bus/index.js';
import type {
  AlertChannel,
  OpsAlert,
  SqlClient,
  SqlResult,
  WorkerTransactions,
} from '../../bus/index.js';
import { PaymentError } from '../../pay/index.js';
import type {
  DueRefund,
  OperationResult,
  PaymentConnectorRegistry,
  PaymentProvider,
  ProviderOperation,
  RefundRequest,
} from '../../pay/index.js';
import {
  REFUND_SCHEDULER_WORKER,
  RefundScheduler,
  UNEXPECTED_CODE,
  classifyRefundError,
  registerRefundScheduler,
} from './refund-scheduler.js';

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const INSTANCE = '33333333-3333-4333-8333-333333333333';
const OPERATION = '44444444-4444-4444-8444-444444444444';

/** Remboursement d'un règlement : −variation du vecteur (TJ02b, TJ08b), en unités mineures. */
function refundOf(vector: string) {
  const v = legVector(golden, vector);
  const legs = Object.fromEntries(LEGS.map((k) => [k, -v.legsMinor[k]])) as Record<
    (typeof LEGS)[number],
    bigint
  >;
  return { currency: v.currency, legs, amount: LEGS.reduce((s, k) => s + legs[k], 0n) };
}

interface Call {
  readonly worker: string;
  readonly sql: string;
  readonly params: readonly unknown[];
}

type Answer = (sql: string, params: readonly unknown[]) => unknown[] | Error;

class FakeDb implements SqlClient {
  worker = '';
  readonly calls: Call[] = [];
  constructor(private readonly answer: Answer) {}
  async query<R>(text: string, params: readonly unknown[] = []): Promise<SqlResult<R>> {
    if (text.includes("set_config('app.worker_name'")) {
      this.worker = String(params[0]);
      return { rows: [], rowCount: 0 };
    }
    const sql = text.replace(/\s+/g, ' ').trim();
    this.calls.push({ worker: this.worker, sql, params });
    const out = this.answer(sql, params);
    if (out instanceof Error) throw out;
    return { rows: out as R[], rowCount: out.length };
  }
  called(fragment: string): Call[] {
    return this.calls.filter((c) => c.sql.includes(fragment));
  }
}

function transactionsOf(
  db: FakeDb,
): WorkerTransactions & { runs: string[]; outcomes: ('COMMIT' | 'ROLLBACK')[] } {
  const runs: string[] = [];
  const outcomes: ('COMMIT' | 'ROLLBACK')[] = [];
  return {
    runs,
    outcomes,
    async run<T>(workerName: string, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      runs.push(workerName);
      db.worker = workerName;
      try {
        const out = await fn(db);
        outcomes.push('COMMIT');
        return out;
      } catch (error) {
        outcomes.push('ROLLBACK');
        throw error;
      }
    },
  };
}

class Alerts implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  fail = false;
  async send(alert: OpsAlert): Promise<void> {
    assertSafeAlert(alert);
    if (this.fail) throw new Error('canal indisponible');
    this.sent.push(alert);
  }
}

/** Connecteur minimal : capacités choisies, remboursement et lecture scénarisés. */
class StubConnector {
  readonly refunds: RefundRequest[] = [];
  readonly lookups: unknown[] = [];
  constructor(
    private readonly caps: ReadonlySet<string>,
    private readonly onRefund: (req: RefundRequest) => OperationResult | Error,
    private readonly onLookup: () => ProviderOperation | null = () => null,
  ) {}
  capabilities() {
    return { bool: (name: string) => this.caps.has(name) };
  }
  async refund(req: RefundRequest): Promise<OperationResult> {
    this.refunds.push(req);
    const out = this.onRefund(req);
    if (out instanceof Error) throw out;
    return out;
  }
  async getOperation(lookup: unknown): Promise<ProviderOperation | null> {
    this.lookups.push(lookup);
    return this.onLookup();
  }
}

const HONEST = new Set(['SUPPORTS_IDEMPOTENCY_HEADER', 'SUPPORTS_LOOKUP_BY_MERCHANT_REF']);
const registryOf = (c: StubConnector | undefined): PaymentConnectorRegistry => ({
  get: (provider) => (provider === 'FAKE' ? (c as unknown as PaymentProvider) : undefined),
});

const due = (over: Partial<DueRefund> = {}): DueRefund => ({
  instanceId: INSTANCE,
  country: 'XA',
  status: 'PLANNED',
  operationStatus: 'PENDING',
  provider: 'FAKE',
  blockedReason: null,
  finAlert: null,
  targetKnown: true,
  ...over,
});

/** Ligne de `core.payment_cmd_refund_order_for_send` : l'ordre stocké du vecteur. */
function orderRow(vector: string, over: Record<string, unknown> = {}) {
  const r = refundOf(vector);
  return {
    operation_id: OPERATION,
    operation_status: 'PENDING',
    idem_sent: `trip:t:1:v1:REFUND:cap:i1:a1`,
    amount_minor: r.amount.toString(),
    currency: r.currency,
    legs: Object.fromEntries(LEGS.map((k) => [k, r.legs[k].toString()])),
    target_reference: 'psp_capture_1',
    provider_reference: null,
    provider: 'FAKE',
    sendable: true,
    reason: null,
    ...over,
  };
}

/** Réponses de la base : envoi autorisé, ordre, statut appliqué, marque, report. */
function answers(over: Partial<Record<string, unknown[] | Error>> = {}): Answer {
  return (sql) => {
    for (const [fragment, rows] of Object.entries(over)) {
      if (sql.includes(fragment)) return rows as unknown[] | Error;
    }
    if (sql.includes('payment_cmd_submit_refund')) {
      return [{ outcome: 'SUBMITTED', blocked_reason: null }];
    }
    if (sql.includes('payment_cmd_refund_order_for_send')) return [orderRow('TJ02b')];
    if (sql.includes('payment_cmd_apply_operation_status')) return [{ outcome: 'APPLIED' }];
    if (sql.includes('payment_cmd_refund_mark_alerted')) return [{ changed: true }];
    if (sql.includes('payment_cmd_refund_await_choice')) return [{ outcome: 'AWAITING_CHOICE' }];
    if (sql.includes('FROM core.payment_refund_instance')) return [{ operation_id: OPERATION }];
    if (sql.includes('settlement_cmd_apply_leg_movement')) return [{ outcome: 'APPLIED' }];
    return new Error(`requête inattendue : ${sql}`);
  };
}

describe.each(['TJ02b', 'TJ08b'])('ordonnanceur — ordre du règlement %s', (vector) => {
  it('PLANNED : envoi autorisé puis appel au connecteur dans LA MÊME transaction payment_command, ordre stocké (jambes explicites, clé stockée, encaissement visé)', async () => {
    const db = new FakeDb((sql, p) =>
      sql.includes('order_for_send') ? [orderRow(vector)] : answers()(sql, p),
    );
    const tx = transactionsOf(db);
    const alerts = new Alerts();
    const connector = new StubConnector(HONEST, () => ({
      providerReference: 'psp_refund_1',
      status: 'PENDING',
    }));
    const s = new RefundScheduler({ transactions: tx, alerts, connectors: registryOf(connector) });
    expect(await s.process(due())).toEqual({ step: 'SENT' });
    expect(tx.runs).toEqual(['payment_command']);
    expect(db.calls.map((c) => c.worker)).toEqual(db.calls.map(() => 'payment_command'));
    expect(db.calls.map((c) => c.sql.match(/core\.(\w+)/)?.[1])).toEqual([
      'payment_cmd_submit_refund',
      'payment_cmd_refund_order_for_send',
      'payment_cmd_apply_operation_status',
    ]);
    const r = refundOf(vector);
    expect(connector.refunds).toEqual([
      {
        idempotencyKey: 'trip:t:1:v1:REFUND:cap:i1:a1',
        providerReference: 'psp_capture_1',
        amountMinor: r.amount,
        currency: r.currency,
        legs: r.legs,
      },
    ]);
    // le PSP a pris l'ordre sans le traiter : SUBMITTED (l'instance passe SENT, déclencheur de 0127)
    expect(db.called('payment_cmd_apply_operation_status')[0]?.params).toEqual([
      OPERATION,
      'SUBMITTED',
      'API_RESPONSE',
      null,
      'psp_refund_1',
    ]);
    expect(alerts.sent).toEqual([]);
  });
});

describe('ordonnanceur — états et refus', () => {
  it('aucun connecteur pour le fournisseur (production avant le lot C) : rien n’est autorisé ni envoyé', async () => {
    const db = new FakeDb(answers());
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
      connectors: registryOf(undefined),
    });
    expect(await s.process(due())).toEqual({ step: 'NO_CONNECTOR' });
    expect(await s.process(due({ status: 'SUBMITTED' }))).toEqual({ step: 'NO_CONNECTOR' });
    expect(db.calls).toEqual([]);
  });

  it('critère 4 : avance sans décision FINANCE ⇒ BLOCKED, alerte FIN_REFUND_BLOCKED (pays et motif seulement) levée UNE fois, rien envoyé', async () => {
    const db = new FakeDb(
      answers({
        payment_cmd_submit_refund: [{ outcome: 'BLOCKED', blocked_reason: 'ADVANCE_CAP_UNSET' }],
      }),
    );
    const alerts = new Alerts();
    const connector = new StubConnector(HONEST, () => new Error('jamais appelé'));
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts,
      connectors: registryOf(connector),
    });
    const first = await s.process(due());
    expect(first.step).toBe('BLOCKED');
    expect(alerts.sent).toEqual([
      {
        code: 'FIN_REFUND_BLOCKED',
        severity: 'P1',
        counts: { refunds: 1 },
        labels: { country: 'XA', error_code: 'ADVANCE_CAP_UNSET' },
      },
    ]);
    expect(db.called('payment_cmd_refund_mark_alerted')[0]?.params).toEqual([
      INSTANCE,
      'BLOCKED:ADVANCE_CAP_UNSET',
    ]);
    // passage suivant : même état déjà signalé ⇒ aucune seconde alerte
    await s.process(
      due({ blockedReason: 'ADVANCE_CAP_UNSET', finAlert: 'BLOCKED:ADVANCE_CAP_UNSET' }),
    );
    expect(alerts.sent).toHaveLength(1);
    // motif changé (plafond par hôte) ⇒ nouvelle alerte
    const db2 = new FakeDb(
      answers({
        payment_cmd_submit_refund: [{ outcome: 'BLOCKED', blocked_reason: 'HOST_ADVANCE_CAP' }],
      }),
    );
    const s2 = new RefundScheduler({
      transactions: transactionsOf(db2),
      alerts,
      connectors: registryOf(connector),
    });
    await s2.process(due({ finAlert: 'BLOCKED:ADVANCE_CAP_UNSET' }));
    expect(alerts.sent.map((a) => a.labels?.error_code)).toEqual([
      'ADVANCE_CAP_UNSET',
      'HOST_ADVANCE_CAP',
    ]);
    expect(connector.refunds).toEqual([]);
  });

  it('version remplacée et ordre jamais envoyé : aucun appel au PSP, revue FIN', async () => {
    const db = new FakeDb(
      answers({
        payment_cmd_refund_order_for_send: [
          orderRow('TJ02b', { sendable: false, reason: 'SUPERSEDED_UNSENT' }),
        ],
      }),
    );
    const alerts = new Alerts();
    const connector = new StubConnector(HONEST, () => new Error('jamais appelé'));
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts,
      connectors: registryOf(connector),
    });
    expect(await s.process(due({ status: 'SUBMITTED' }))).toMatchObject({
      step: 'ATTENTION',
      alert: { code: 'FIN_REFUND_FAILED', key: 'SEND:SUPERSEDED_UNSENT' },
    });
    expect(connector.refunds).toEqual([]);
    expect(alerts.sent[0]?.labels).toEqual({ country: 'XA', error_code: 'SUPERSEDED_UNSENT' });
  });

  it('instance déjà autorisée ou finale (relue sous les verrous) : rien envoyé', async () => {
    const db = new FakeDb(
      answers({
        payment_cmd_submit_refund: [{ outcome: 'DUPLICATE', blocked_reason: null }],
        payment_cmd_refund_order_for_send: [
          orderRow('TJ02b', { sendable: false, reason: 'FINAL' }),
        ],
      }),
    );
    const connector = new StubConnector(HONEST, () => new Error('jamais appelé'));
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
      connectors: registryOf(connector),
    });
    expect(await s.process(due())).toEqual({ step: 'DUPLICATE' });
    expect(await s.process(due({ status: 'SENT' }))).toEqual({ step: 'DUPLICATE' });
    expect(connector.refunds).toEqual([]);
  });

  it('refus du PSP : statut FAILED appliqué ; l’instance FAILED est signalée une fois au passage suivant', async () => {
    const db = new FakeDb(answers());
    const alerts = new Alerts();
    const connector = new StubConnector(
      HONEST,
      () => new PaymentError('DECLINED', 'refusé', { declineCode: 'X' }),
    );
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts,
      connectors: registryOf(connector),
    });
    expect(await s.process(due())).toEqual({ step: 'FAILED' });
    expect(db.called('payment_cmd_apply_operation_status')[0]?.params.slice(0, 3)).toEqual([
      OPERATION,
      'FAILED',
      'API_RESPONSE',
    ]);
    expect(alerts.sent).toEqual([]);
    expect(await s.process(due({ status: 'FAILED', operationStatus: 'FAILED' }))).toMatchObject({
      step: 'ATTENTION',
      alert: { code: 'FIN_REFUND_FAILED', key: 'FAILED', errorCode: 'REFUND_FAILED' },
    });
    // US-224f : marque et attente du choix d'un autre rail dans LA MÊME transaction, après l'alerte ;
    // N-364 (ADR-166 n° 7) : attente du choix (trip puis instance) AVANT la marque
    expect(db.calls.slice(-2).map((c) => [c.sql.match(/core\.(\w+)/)?.[1], c.params])).toEqual([
      ['payment_cmd_refund_await_choice', [INSTANCE]],
      ['payment_cmd_refund_mark_alerted', [INSTANCE, 'FAILED']],
    ]);
    await s.process(due({ status: 'FAILED', operationStatus: 'FAILED', finAlert: 'FAILED' }));
    expect(alerts.sent.map((a) => a.code)).toEqual(['FIN_REFUND_FAILED']);
    expect(db.called('payment_cmd_refund_await_choice')).toHaveLength(1);
  });

  it('US-224f : seule l’alerte d’un échec confirmé ouvre le choix du rail ; issue inconnue de la base ⇒ alerte rejouée au passage suivant', async () => {
    const blocked = new FakeDb(
      answers({
        payment_cmd_submit_refund: [{ outcome: 'BLOCKED', blocked_reason: 'ADVANCE_CAP_UNSET' }],
      }),
    );
    const s1 = new RefundScheduler({
      transactions: transactionsOf(blocked),
      alerts: new Alerts(),
      connectors: registryOf(new StubConnector(HONEST, () => new Error('jamais appelé'))),
    });
    expect((await s1.process(due())).step).toBe('BLOCKED');
    expect(blocked.called('payment_cmd_refund_await_choice')).toEqual([]);

    const odd = new FakeDb(answers({ payment_cmd_refund_await_choice: [{ outcome: 'X' }] }));
    const lines: string[] = [];
    const s2 = new RefundScheduler({
      transactions: transactionsOf(odd),
      alerts: new Alerts(),
      connectors: registryOf(undefined),
      log: (l) => lines.push(l),
    });
    await s2.process(due({ status: 'FAILED', operationStatus: 'FAILED' }));
    expect(lines.some((l) => l.includes('alert_deferred'))).toBe(true);
    // N-364 : l'attente du choix refusée ⇒ la marque n'est même pas tentée (rejouée au passage suivant)
    expect(odd.called('payment_cmd_refund_mark_alerted')).toEqual([]);
  });

  it('issue inconnue : UNKNOWN appliqué, repris plus tard ; ordre en vol relu d’abord (aucun renvoi) puis SENT', async () => {
    const db = new FakeDb(answers());
    const timeout = new StubConnector(
      HONEST,
      () => new PaymentError('UNKNOWN_OUTCOME', 'délai dépassé'),
    );
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
      connectors: registryOf(timeout),
    });
    expect(await s.process(due())).toEqual({ step: 'WAITING' });
    expect(db.called('payment_cmd_apply_operation_status')[0]?.params[1]).toBe('UNKNOWN');

    const db2 = new FakeDb(
      answers({
        payment_cmd_refund_order_for_send: [orderRow('TJ02b', { operation_status: 'UNKNOWN' })],
      }),
    );
    const found = new StubConnector(
      HONEST,
      () => new Error('jamais renvoyé'),
      () => ({
        providerReference: 'psp_refund_1',
        merchantReference: 'trip:t:1:v1:REFUND:cap:i1:a1',
        status: 'SUCCEEDED',
        amountMinor: refundOf('TJ02b').amount,
        currency: refundOf('TJ02b').currency,
        legs: refundOf('TJ02b').legs,
      }),
    );
    const s2 = new RefundScheduler({
      transactions: transactionsOf(db2),
      alerts: new Alerts(),
      connectors: registryOf(found),
    });
    expect(await s2.process(due({ status: 'SUBMITTED', operationStatus: 'UNKNOWN' }))).toEqual({
      step: 'SENT',
    });
    expect(found.refunds).toEqual([]);
    expect(found.lookups).toEqual([{ merchantReference: 'trip:t:1:v1:REFUND:cap:i1:a1' }]);
    expect(db2.called('payment_cmd_apply_operation_status')[0]?.params.slice(1, 3)).toEqual([
      'SUCCEEDED',
      'POLL',
    ]);
  });

  it('succès non prouvé (compte LIVE ou production) : la preuve signée décide, aucune alerte', async () => {
    const db = new FakeDb(
      answers({ payment_cmd_apply_operation_status: [{ outcome: 'UNPROVEN' }] }),
    );
    const alerts = new Alerts();
    const connector = new StubConnector(HONEST, () => ({
      providerReference: 'psp_refund_1',
      status: 'SUCCEEDED',
    }));
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts,
      connectors: registryOf(connector),
    });
    expect(await s.process(due())).toEqual({ step: 'WAITING' });
    expect(alerts.sent).toEqual([]);
  });

  it('sans lecture possible (ni clé recherchable ni référence) : aucun renvoi, escalade FIN', async () => {
    const db = new FakeDb(
      answers({
        payment_cmd_refund_order_for_send: [orderRow('TJ02b', { operation_status: 'UNKNOWN' })],
      }),
    );
    const connector = new StubConnector(
      new Set(['SUPPORTS_IDEMPOTENCY_HEADER']),
      () => new Error('jamais renvoyé'),
    );
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
      connectors: registryOf(connector),
    });
    expect(await s.process(due({ status: 'SENT', operationStatus: 'UNKNOWN' }))).toMatchObject({
      step: 'ATTENTION',
      alert: { key: 'SEND:NO_LOOKUP_POSSIBLE' },
    });
    expect(connector.refunds).toEqual([]);
  });

  it('CONFIRMED prouvé : report sur les soldes des jambes ; refus du report ⇒ revue FIN par le nom de la contrainte', async () => {
    const db = new FakeDb(answers());
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
      connectors: registryOf(undefined),
    });
    expect(await s.process(due({ status: 'CONFIRMED', operationStatus: 'SUCCEEDED' }))).toEqual({
      step: 'REPORTED',
    });
    expect(db.called('settlement_cmd_apply_leg_movement')[0]?.params).toEqual([OPERATION]);

    const refused = Object.assign(new Error('x'), {
      code: '55000',
      constraint: 'leg_funds_holding_disabled',
    });
    const db2 = new FakeDb(answers({ settlement_cmd_apply_leg_movement: refused }));
    const alerts = new Alerts();
    const s2 = new RefundScheduler({
      transactions: transactionsOf(db2),
      alerts,
      connectors: registryOf(undefined),
    });
    expect(await s2.process(due({ status: 'CONFIRMED' }))).toMatchObject({
      step: 'ATTENTION',
      alert: { key: 'REPORT:LEG_FUNDS_HOLDING_DISABLED' },
    });
    expect(alerts.sent[0]?.labels?.error_code).toBe('LEG_FUNDS_HOLDING_DISABLED');
  });

  it('alerte impossible : rien n’est marqué (rejouée au passage suivant), journal sans identifiant', async () => {
    const db = new FakeDb(
      answers({
        payment_cmd_submit_refund: [{ outcome: 'BLOCKED', blocked_reason: 'HOST_ADVANCE_CAP' }],
      }),
    );
    const alerts = new Alerts();
    alerts.fail = true;
    const logs: string[] = [];
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts,
      connectors: registryOf(new StubConnector(HONEST, () => new Error('x'))),
      log: (l) => logs.push(l),
    });
    expect((await s.process(due())).step).toBe('BLOCKED');
    expect(db.called('payment_cmd_refund_mark_alerted')).toEqual([]);
    expect(logs).toEqual([
      JSON.stringify({
        worker: REFUND_SCHEDULER_WORKER,
        level: 'warn',
        event: 'alert_deferred',
        error_class: 'Error',
      }),
    ]);
    for (const l of logs) expect(l).not.toContain(INSTANCE);
  });
});

describe('ADR-150 : jamais SUBMITTED (date d’émission) sans envoi', () => {
  it('PSP injoignable après l’envoi autorisé : transaction ANNULÉE (instance PLANNED), repris au passage suivant', async () => {
    const db = new FakeDb(answers());
    const tx = transactionsOf(db);
    const connector = new StubConnector(
      HONEST,
      () => new PaymentError('PROVIDER_UNAVAILABLE', 'injoignable'),
    );
    const s = new RefundScheduler({
      transactions: tx,
      alerts: new Alerts(),
      connectors: registryOf(connector),
    });
    expect(await s.process(due())).toEqual({ step: 'WAITING' });
    expect(db.called('payment_cmd_submit_refund')).toHaveLength(1);
    expect(connector.refunds).toHaveLength(1);
    expect(db.called('payment_cmd_apply_operation_status')).toEqual([]);
    expect(tx.outcomes).toEqual(['ROLLBACK']);
  });

  it('aucune lecture possible (ni en-tête d’idempotence ni recherche) : rien envoyé, transaction annulée, escalade FIN', async () => {
    const db = new FakeDb(answers());
    const tx = transactionsOf(db);
    const alerts = new Alerts();
    const connector = new StubConnector(new Set(), () => new Error('jamais appelé'));
    const s = new RefundScheduler({ transactions: tx, alerts, connectors: registryOf(connector) });
    expect(await s.process(due())).toMatchObject({
      step: 'ATTENTION',
      alert: { key: 'SEND:NO_LOOKUP_POSSIBLE' },
    });
    expect(connector.refunds).toEqual([]);
    // envoi autorisé annulé, puis marque de l'alerte dans sa propre transaction
    expect(tx.outcomes).toEqual(['ROLLBACK', 'COMMIT']);
    expect(alerts.sent.map((a) => a.labels?.error_code)).toEqual(['NO_LOOKUP_POSSIBLE']);
  });

  it('ordre non envoyable relu après l’envoi autorisé : transaction annulée', async () => {
    const db = new FakeDb(
      answers({
        payment_cmd_refund_order_for_send: [
          orderRow('TJ02b', { sendable: false, reason: 'SUPERSEDED_UNSENT' }),
        ],
      }),
    );
    const tx = transactionsOf(db);
    const s = new RefundScheduler({
      transactions: tx,
      alerts: new Alerts(),
      connectors: registryOf(new StubConnector(HONEST, () => new Error('jamais appelé'))),
    });
    expect((await s.process(due())).alert?.key).toBe('SEND:SUPERSEDED_UNSENT');
    expect(tx.outcomes[0]).toBe('ROLLBACK');
  });

  it('encaissement sans référence PSP : lu AVANT l’envoi autorisé, aucune transaction d’envoi, revue FIN', async () => {
    const db = new FakeDb(answers());
    const tx = transactionsOf(db);
    const alerts = new Alerts();
    const s = new RefundScheduler({
      transactions: tx,
      alerts,
      connectors: registryOf(new StubConnector(HONEST, () => new Error('jamais appelé'))),
    });
    expect(await s.process(due({ targetKnown: false }))).toMatchObject({
      step: 'ATTENTION',
      alert: { key: 'SEND:NO_TARGET', errorCode: 'NO_TARGET' },
    });
    expect(db.called('payment_cmd_submit_refund')).toEqual([]);
    expect(db.calls.map((c) => c.sql.match(/core\.(\w+)/)?.[1])).toEqual([
      'payment_cmd_refund_mark_alerted',
    ]);
  });

  it('sans connecteur : aucune transaction ouverte', async () => {
    const db = new FakeDb(answers());
    const tx = transactionsOf(db);
    const s = new RefundScheduler({
      transactions: tx,
      alerts: new Alerts(),
      connectors: registryOf(undefined),
    });
    expect(await s.process(due())).toEqual({ step: 'NO_CONNECTOR' });
    expect(tx.runs).toEqual([]);
  });

  it('ordre déjà final côté envoyeur : DUPLICATE', async () => {
    const db = new FakeDb(
      answers({
        payment_cmd_refund_order_for_send: [orderRow('TJ02b', { operation_status: 'SUCCEEDED' })],
      }),
    );
    const s = new RefundScheduler({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
      connectors: registryOf(new StubConnector(HONEST, () => new Error('jamais appelé'))),
    });
    expect(await s.process(due({ status: 'SENT', operationStatus: 'SUCCEEDED' }))).toEqual({
      step: 'DUPLICATE',
    });
  });
});

describe('classement des erreurs', () => {
  it('interblocage ⇒ reprise ; contrainte ⇒ son nom ; PAY ⇒ son code ; autre ⇒ UNEXPECTED_ERROR', () => {
    expect(classifyRefundError({ code: '40P01' }, 'SEND')).toEqual({ step: 'RETRY' });
    expect(classifyRefundError({ code: '40001' }, 'REPORT')).toEqual({ step: 'RETRY' });
    expect(
      classifyRefundError({ code: '55000', constraint: 'operation_settlement_superseded' }, 'SEND'),
    ).toEqual({
      step: 'ATTENTION',
      alert: {
        code: 'FIN_REFUND_FAILED',
        key: 'SEND:OPERATION_SETTLEMENT_SUPERSEDED',
        errorCode: 'OPERATION_SETTLEMENT_SUPERSEDED',
      },
    });
    expect(classifyRefundError({ code: '22023' }, 'SEND').alert?.key).toBe('SEND:DB_22023');
    expect(classifyRefundError(new PaymentError('LEG_SUM_MISMATCH', 'x'), 'SEND').alert?.key).toBe(
      'SEND:LEG_SUM_MISMATCH',
    );
    expect(classifyRefundError(new TypeError('x'), 'SEND').alert?.errorCode).toBe(UNEXPECTED_CODE);
  });
});

describe('tâche périodique refund_scheduler', () => {
  it('file lue sous payment_command ; une instance en erreur inattendue ne bloque pas la suivante ; comptes seulement au journal', async () => {
    const dueRows = [
      { instance_id: INSTANCE, status: 'PLANNED', operation_status: 'PENDING' },
      { instance_id: OPERATION, status: 'CONFIRMED', operation_status: 'SUCCEEDED' },
    ].map((r) => ({
      ...r,
      country_code: 'XA',
      provider: 'FAKE',
      blocked_reason: null,
      fin_alert: null,
      target_known: true,
    }));
    const db = new FakeDb((sql, p) => {
      if (sql.includes('payment_refunds_due')) return dueRows;
      if (sql.includes('payment_cmd_submit_refund')) return new TypeError('panne');
      return answers()(sql, p);
    });
    const registry = new BusRegistry();
    const logs: string[] = [];
    const alerts = new Alerts();
    registerRefundScheduler(
      registry,
      transactionsOf(db),
      alerts,
      (l) => logs.push(l),
      registryOf(new StubConnector(HONEST, () => new Error('x'))),
    );
    expect(registry.periodicTasks()).toEqual([
      { name: 'refund_scheduler', spec: { periodSeconds: 10, maxAttempts: 5 } },
    ]);
    const h = registry.handlerOf('refund_scheduler');
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    db.worker = 'refund_scheduler';
    await h.handle({}, db);
    expect(db.called('payment_refunds_due')[0]?.worker).toBe('payment_command');
    expect(db.called('settlement_cmd_apply_leg_movement')).toHaveLength(1);
    expect(alerts.sent.map((a) => a.labels?.error_code)).toEqual([UNEXPECTED_CODE]);
    const summary = JSON.parse(logs.at(-1) ?? '{}') as Record<string, unknown>;
    expect(summary).toEqual({
      level: 'info',
      worker: 'refund_scheduler',
      due: 2,
      attention: 1,
      reported: 1,
    });
    for (const l of logs) {
      expect(l).not.toContain(INSTANCE);
      expect(l).not.toContain(OPERATION);
    }
  });
});
