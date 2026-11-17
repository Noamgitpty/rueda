/**
 * Règlement des annulations demandées par l'ops (US-215, ADR-148) : plan du moteur unique, ordres
 * par jambe, paramètres lus en base, classement des refus et enchaînement des commandes.
 *
 * Attendus : vecteurs de l'export des oracles Python (`docs/specs/tools/golden_vectors.json`, via
 * `@rueda/money/golden-vectors`) — T03 / TJ02b (critère 1), T14 / TJ06 et T15 (critère 2), T07 /
 * T08 (critère 4), T27 / TJ08b (variante PYG, critère 5) — jamais le code testé. Les entrées des
 * vecteurs (trip, événement, paramètres de test de 08) viennent de l'adaptateur de test du moteur
 * (`@rueda/money/testing`). Pays fictif `XA` (aucune constante de pays).
 */
import { SettlementError, canonicalJson, type SettlementTrip } from '@rueda/money';
import { legVector, loadGoldenVectors, settlementVector } from '@rueda/money/golden-vectors';
import { testParams, toEvent, toTrip } from '@rueda/money/testing';
import { describe, expect, it } from 'vitest';
import { BusRegistry, assertSafeAlert } from '../../bus/index.js';
import type {
  AlertChannel,
  OpsAlert,
  SqlClient,
  SqlResult,
  WorkerTransactions,
} from '../../bus/index.js';
import {
  CancellationPlanError,
  TRIP_CANCELLATION_MAX_RETRIES,
  TripCancellationProcessor,
  UNEXPECTED_CODE,
  cancellationEvent,
  cancellationParams,
  classify,
  orderKey,
  planCancellation,
  registerTripCancellations,
  type CancellationFacts,
} from './trip-cancellation.js';

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const TRIP_ID = '11111111-1111-4111-8111-111111111111';
const SEGMENT_ID = '22222222-2222-4222-8222-222222222222';
const CANCELLATION_ID = '33333333-3333-4333-8333-333333333333';

/** Faits d'une demande rejouant le vecteur `id` (instants et paramètres de test de 08). */
function factsOf(
  id: string,
  over: Partial<CancellationFacts> = {},
): { facts: CancellationFacts; trip: SettlementTrip } {
  const v = settlementVector(golden, id);
  const trip = toTrip(v.trip);
  const event = toEvent(v.event);
  const facts: CancellationFacts = {
    cancellationId: CANCELLATION_ID,
    tripId: TRIP_ID,
    segmentId: SEGMENT_ID,
    country: 'XA',
    currency: trip.currency.code,
    tripRowVersion: 3,
    startAtMs: trip.startAtMs,
    bookedAtMs: trip.bookedAtMs,
    requestedReason: event.reason,
    subReason: event.subReason ?? null,
    evidenceValidated: event.evidenceValidated === true,
    checkinValidated: false,
    requestedAtMs: event.requestedAtMs,
    frozen: null,
    // forme canonique que rend la base (0124, core.booking_cancellation_params)
    params: JSON.parse(canonicalJson(testParams(trip.currency))) as unknown,
    ...over,
  };
  return { facts, trip };
}

const legsOf = (id: string): Record<string, bigint> => ({ ...legVector(golden, id).legsMinor });
const negate = (l: Record<string, bigint>): Record<string, bigint> =>
  Object.fromEntries(LEGS.map((k) => [k, -(l[k] ?? 0n)]));
const expected = (id: string) => settlementVector(golden, id).expected;

describe('plan du règlement d’une demande (moteur unique, vecteurs de l’export)', () => {
  it('critère 1 — T03 : remboursement 187,44 ventilé par jambe (TJ02b), un seul ordre REFUND, sans saisie', () => {
    const { facts, trip } = factsOf('T03');
    const plan = planCancellation(facts, trip);
    expect(plan.record.guestRefundMinor).toBe(expected('T03').guestRefundMinor);
    expect(plan.record.hostPenaltyMinor).toBe(0n);
    expect(plan.orders).toHaveLength(1);
    const refund = plan.orders[0];
    expect(refund?.kind).toBe('REFUND');
    expect(refund?.amountMinor).toBe(expected('T03').guestRefundMinor);
    // jambes explicites = − variation de TJ02b (jamais un prorata)
    expect({ ...refund?.legs }).toEqual(negate(legsOf('TJ02b')));
  });

  it('critère 2 — T14 (T−30 h) : remboursement intégral (TJ06), pénalité de 25,00 hors jambes ; T15 (T−24 h pile) : palier « ≤ 24 h »', () => {
    const t14 = factsOf('T14');
    const p14 = planCancellation(t14.facts, t14.trip);
    expect(p14.record.guestRefundMinor).toBe(expected('T14').guestRefundMinor);
    expect(p14.record.hostPenaltyMinor).toBe(expected('T14').hostPenaltyMinor);
    expect({ ...p14.orders[0]?.legs }).toEqual(negate(legsOf('TJ06')));
    // la pénalité n'est sur aucune jambe : Σ jambes de l'ordre = remboursement du voyageur
    expect(LEGS.reduce((s, k) => s + (p14.orders[0]?.legs[k] ?? 0n), 0n)).toBe(
      p14.record.guestRefundMinor,
    );
    const t15 = factsOf('T15');
    const p15 = planCancellation(t15.facts, t15.trip);
    expect(p15.record.hostPenaltyMinor).toBe(expected('T15').hostPenaltyMinor);
  });

  it('critère 4 — T07 / T08 : la qualification dépend de la preuve validée', () => {
    const t07 = factsOf('T07');
    expect(t07.facts.evidenceValidated).toBe(true);
    const p07 = planCancellation(t07.facts, t07.trip);
    expect(p07.record.reason).toBe(expected('T07').qualifiedReason);
    expect(p07.record.guestRefundMinor).toBe(expected('T07').guestRefundMinor);
    // même demande sans preuve : requalifiée HOST_CANCELLED (T08)
    const t08 = factsOf('T07', { evidenceValidated: false });
    const p08 = planCancellation(t08.facts, t08.trip);
    expect(p08.record.reason).toBe(expected('T08').qualifiedReason);
    expect(p08.record.origin).toBe('REQUALIFIED_NO_EVIDENCE');
    expect(p08.record.guestRefundMinor).toBe(expected('T08').guestRefundMinor);
    expect(p08.record.hostPenaltyMinor).toBe(expected('T08').hostPenaltyMinor);
  });

  it('critère 5 — variante sans décimale : T27 (TJ08b) à l’unité près', () => {
    const { facts, trip } = factsOf('T27');
    expect(trip.currency.exponent).toBe(0);
    const plan = planCancellation(facts, trip);
    expect(plan.record.guestRefundMinor).toBe(expected('T27').guestRefundMinor);
    expect({ ...plan.orders[0]?.legs }).toEqual(negate(legsOf('TJ08b')));
  });

  it('événement : seulement les faits de la base, dans la forme contrôlée par la base', () => {
    const { facts } = factsOf('T03');
    expect(cancellationEvent(facts)).toEqual({
      reason: 'GUEST_CANCELLED',
      requestedAtMs: facts.requestedAtMs,
      checkinValidated: false,
    });
    const host = cancellationEvent({
      ...facts,
      requestedReason: 'HOST_CANCELLED_DUE_TO_GUEST',
      subReason: 'INVALID_LICENSE',
      evidenceValidated: true,
    });
    expect(host).toEqual({
      reason: 'HOST_CANCELLED_DUE_TO_GUEST',
      requestedAtMs: facts.requestedAtMs,
      subReason: 'INVALID_LICENSE',
      evidenceValidated: true,
      checkinValidated: false,
    });
  });

  it('paramètres : aucun défaut ; absents ou mal formés ⇒ PARAM_MISSING (BLOCK)', () => {
    const { trip, facts } = factsOf('T03');
    const ok = cancellationParams(facts.params, trip.currency);
    expect(canonicalJson(ok)).toBe(canonicalJson(testParams(trip.currency)));
    const base = facts.params as Record<string, unknown>;
    for (const bad of [
      null,
      [],
      { ...base, noShowGraceMinutes: '60' },
      { ...base, freeCancelLeadHours: 1.5 },
      { ...base, lastMinuteThresholdHours: undefined },
      { ...base, hostPenalty: 'x' },
      { ...base, hostPenalty: { cxlEarly: { amountMinor: { $bigint: '-1' }, currency: 'x' } } },
    ]) {
      expect(() => cancellationParams(bad, trip.currency), JSON.stringify(bad)).toThrow(
        CancellationPlanError,
      );
    }
    // compensation de l'hôte (DEC-FONDATEUR-01) : recopiée telle quelle, absente ⇒ absente
    expect('platformFundedHostCompensation' in ok).toBe(false);
    const withFlag = cancellationParams(
      { ...base, platformFundedHostCompensation: false },
      trip.currency,
    );
    expect(withFlag.platformFundedHostCompensation).toBe(false);
  });

  it('clé d’idempotence d’un remboursement : forme de 08 E4, moyen = capture d’origine', () => {
    const { facts, trip } = factsOf('T03');
    const order = planCancellation(facts, trip).orders[0];
    if (order === undefined) throw new Error('ordre attendu');
    expect(orderKey(facts, order, 'cap-1')).toBe(`${TRIP_ID}:${SEGMENT_ID}:v1:REFUND:cap-1:i1:a1`);
  });
});

describe('classement des refus', () => {
  it('moteur, plan et base : FAILED ou FIN_REVIEW ; interblocage : RETRY ; erreur inconnue relancée', () => {
    expect(classify(new CancellationPlanError('QUOTE_UNAVAILABLE'))).toEqual({
      outcome: 'FAILED',
      code: 'QUOTE_UNAVAILABLE',
    });
    expect(classify({ code: '55000', constraint: 'operation_settlement_fin_review' })).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'OPERATION_SETTLEMENT_FIN_REVIEW',
    });
    expect(classify({ code: '55000', constraint: 'trip_transition_forbidden' })).toEqual({
      outcome: 'FAILED',
      code: 'TRIP_TRANSITION_FORBIDDEN',
    });
    expect(classify({ code: '40P01' })).toEqual({ outcome: 'RETRY', code: 'RETRY' });
    expect(() => classify(new Error('réseau'))).toThrow('réseau');
  });
});

// ------------------------------------------------------------------ enchaînement des commandes

interface Call {
  readonly worker: string;
  readonly sql: string;
}

class FakeDb implements SqlClient {
  worker = '';
  readonly calls: Call[] = [];
  constructor(private readonly answer: (sql: string) => unknown[] | Error) {}
  async query<R>(text: string, params?: readonly unknown[]): Promise<SqlResult<R>> {
    if (text.includes("set_config('app.worker_name'")) {
      this.worker = String(params?.[0]);
      return { rows: [], rowCount: 0 };
    }
    this.calls.push({ worker: this.worker, sql: text.replace(/\s+/g, ' ').trim() });
    const out = this.answer(text);
    if (out instanceof Error) throw out;
    return { rows: out as R[], rowCount: out.length };
  }
}

function transactionsOf(db: FakeDb): WorkerTransactions & { runs: string[] } {
  const runs: string[] = [];
  return {
    runs,
    async run<T>(workerName: string, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      runs.push(workerName);
      db.worker = workerName;
      return fn(db);
    },
  };
}

class Alerts implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  async send(alert: OpsAlert): Promise<void> {
    assertSafeAlert(alert);
    this.sent.push(alert);
  }
}

function beginRow(f: CancellationFacts): Record<string, unknown> {
  return {
    cancellation_id: f.cancellationId,
    trip_id: f.tripId,
    segment_id: f.segmentId,
    country_code: f.country,
    currency: f.currency,
    trip_row_version: f.tripRowVersion,
    start_at_ms: String(f.startAtMs),
    booked_at_ms: String(f.bookedAtMs),
    requested_reason: f.requestedReason,
    sub_reason: f.subReason,
    evidence_validated: f.evidenceValidated,
    checkin_validated: f.checkinValidated,
    requested_at_ms: String(f.requestedAtMs),
    quote_engine_version: null,
    quote_inputs: null,
    quote_inputs_hash: null,
    quote_outputs: null,
    quote_outputs_hash: null,
    quote_total_minor: null,
    quote_currency: null,
    params: f.params,
  };
}

describe('processeur trip_lifecycle', () => {
  it('une transaction : faits, règlement (settlement), transition (trip_lifecycle), ordre REFUND (payment_command)', async () => {
    const { facts, trip } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
      if (sql.includes('booking_cmd_trip_settle_cancellation'))
        return [{ r: { costBearer: 'GUEST' } }];
      if (sql.includes('payment_payment_operation'))
        return [{ id: 'cap-1', psp_account_id: 'acc-1', method: 'CARD' }];
      if (sql.includes('payment_cmd_plan_refund'))
        return [
          {
            instance_id: 'ri-1',
            operation_id: 'op-1',
            advance_id: null,
            status: 'PLANNED',
            blocked_reason: null,
            replayed: false,
          },
        ];
      return new Error(`requête inattendue : ${sql}`);
    });
    const tx = transactionsOf(db);
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({ transactions: tx, alerts, tripOf: () => trip });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'SETTLED',
      costBearer: 'GUEST',
      orders: 1,
    });
    expect(tx.runs).toEqual(['trip_lifecycle']);
    expect(db.calls.map((c) => [c.worker, /core\.([a-z_]+)/.exec(c.sql)?.[1]])).toEqual([
      ['trip_lifecycle', 'booking_trip_cancellation_begin'],
      ['settlement', 'settlement_cmd_record'],
      ['trip_lifecycle', 'booking_cmd_trip_settle_cancellation'],
      ['payment_command', 'payment_payment_operation'],
      ['payment_command', 'payment_cmd_plan_refund'],
    ]);
    expect(alerts.sent).toEqual([]);
  });

  it('demande déjà traitée : rien d’écrit', async () => {
    const db = new FakeDb((sql) =>
      sql.includes('booking_trip_cancellation_begin') ? [] : new Error(sql),
    );
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({ outcome: 'SKIPPED' });
  });

  it('refus déterministe (devis introuvable) : transaction annulée, demande garée FAILED, alerte P1 sans identifiant', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(sql);
    });
    const tx = transactionsOf(db);
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({ transactions: tx, alerts });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FAILED',
      code: 'QUOTE_UNAVAILABLE',
    });
    expect(tx.runs).toEqual(['trip_lifecycle', 'trip_lifecycle']);
    expect(db.calls.some((c) => c.sql.includes('settlement_cmd_record'))).toBe(false);
    expect(alerts.sent).toEqual([
      {
        code: 'TRIP_CANCELLATION_FAILED',
        severity: 'P1',
        counts: { cancellations: 1 },
        labels: { country: 'XA', error_code: 'QUOTE_UNAVAILABLE' },
      },
    ]);
  });

  it('ordre refusé pour décision FINANCE (jambe négative, US-224b) : FIN_REVIEW et alerte FIN', async () => {
    const { facts, trip } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
      if (sql.includes('booking_cmd_trip_settle_cancellation'))
        return [{ r: { costBearer: 'GUEST' } }];
      if (sql.includes('payment_payment_operation'))
        return [{ id: 'cap-1', psp_account_id: 'acc-1', method: 'CARD' }];
      if (sql.includes('payment_cmd_plan_refund'))
        return Object.assign(new Error('fin'), {
          code: '55000',
          constraint: 'operation_settlement_fin_review',
        });
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(sql);
    });
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts,
      tripOf: () => trip,
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'OPERATION_SETTLEMENT_FIN_REVIEW',
    });
    expect(alerts.sent.map((a) => a.code)).toEqual(['FIN_SETTLEMENT_REVIEW']);
  });

  it('trip sans capture unique du loyer : FAILED (TRIP_NOT_CAPTURED), jamais un moyen deviné', async () => {
    const { facts, trip } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
      if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
      if (sql.includes('booking_cmd_trip_settle_cancellation'))
        return [{ r: { costBearer: 'GUEST' } }];
      if (sql.includes('payment_payment_operation')) return [];
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(sql);
    });
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts: new Alerts(),
      tripOf: () => trip,
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FAILED',
      code: 'TRIP_NOT_CAPTURED',
    });
  });

  it('interblocage : demande laissée en attente (aucune mise en garde, aucune alerte)', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) {
        return Object.assign(new Error('deadlock'), { code: '40P01' });
      }
      return new Error(sql);
    });
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({ transactions: transactionsOf(db), alerts });
    expect(await p.process(facts.cancellationId)).toEqual({ outcome: 'RETRY', code: 'RETRY' });
    expect(db.calls.some((c) => c.sql.includes('park'))).toBe(false);
    expect(alerts.sent).toEqual([]);
  });
});

describe('isolement des demandes, alertes et essais bornés (revue code n° 1 à 4, 7)', () => {
  const ok = (facts: CancellationFacts) => (sql: string) => {
    if (sql.includes('booking_trip_cancellation_begin')) return [beginRow(facts)];
    if (sql.includes('settlement_cmd_record')) return [{ id: 'set-1' }];
    if (sql.includes('booking_cmd_trip_settle_cancellation'))
      return [{ r: { costBearer: 'GUEST' } }];
    if (sql.includes('payment_payment_operation'))
      return [{ id: 'cap-1', psp_account_id: 'acc-1', method: 'CARD' }];
    if (sql.includes('payment_cmd_plan_refund'))
      return [
        {
          instance_id: 'ri-1',
          operation_id: 'op-1',
          advance_id: null,
          status: 'PLANNED',
          blocked_reason: null,
          replayed: false,
        },
      ];
    if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
    return new Error(sql);
  };

  it('erreur sans SQLSTATE (programme) : garée FAILED UNEXPECTED_ERROR, alerte, journal sans identifiant ; process ne lève pas', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb(ok(facts));
    const alerts = new Alerts();
    const logs: string[] = [];
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts,
      log: (l) => logs.push(l),
      tripOf: () => {
        throw new TypeError('devis illisible');
      },
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({ outcome: 'FAILED', code: UNEXPECTED_CODE });
    expect(db.calls.some((c) => c.sql.includes('booking_cmd_trip_park_cancellation'))).toBe(true);
    expect(alerts.sent.map((a) => [a.code, a.labels?.error_code])).toEqual([
      ['TRIP_CANCELLATION_FAILED', UNEXPECTED_CODE],
    ]);
    expect(logs.map((l) => JSON.parse(l) as unknown)).toEqual([
      { worker: 'trip_lifecycle', level: 'error', event: 'unexpected', error_class: 'TypeError' },
    ]);
    for (const l of logs) expect(l).not.toContain(CANCELLATION_ID);
  });

  it('REFUND_OUT_OF_RANGE du moteur : FIN_REVIEW garé, UNE seule alerte FIN_SETTLEMENT_REVIEW', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb(ok(facts));
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts,
      tripOf: () => {
        throw new SettlementError('REFUND_OUT_OF_RANGE', 'remboursement hors bornes');
      },
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'REFUND_OUT_OF_RANGE',
    });
    expect(alerts.sent.map((a) => a.code)).toEqual(['FIN_SETTLEMENT_REVIEW']);
    expect(db.calls.some((c) => c.sql.includes('booking_cmd_trip_park_cancellation'))).toBe(true);
  });

  it('interblocages répétés : RETRY jusqu’à la borne, puis FAILED RETRY_EXHAUSTED, alerté et garé', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellation_begin')) {
        return Object.assign(new Error('deadlock'), { code: '40P01' });
      }
      if (sql.includes('booking_cmd_trip_park_cancellation')) return [{ r: 'PARKED' }];
      return new Error(sql);
    });
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({ transactions: transactionsOf(db), alerts });
    for (let i = 1; i < TRIP_CANCELLATION_MAX_RETRIES; i++) {
      expect(await p.process(facts.cancellationId)).toEqual({ outcome: 'RETRY', code: 'RETRY' });
    }
    expect(alerts.sent).toEqual([]);
    expect(await p.process(facts.cancellationId)).toEqual({
      outcome: 'FAILED',
      code: 'RETRY_EXHAUSTED',
    });
    expect(alerts.sent.map((a) => [a.code, a.labels?.error_code])).toEqual([
      ['TRIP_CANCELLATION_FAILED', 'RETRY_EXHAUSTED'],
    ]);
  });

  it('alerte impossible : rien n’est garé (la demande reste en attente, DEFERRED), jamais un garage silencieux', async () => {
    const { facts } = factsOf('T03');
    const db = new FakeDb(ok(facts));
    const p = new TripCancellationProcessor({
      transactions: transactionsOf(db),
      alerts: { send: () => Promise.reject(new Error('canal indisponible')) },
      tripOf: () => {
        throw new TypeError('x');
      },
    });
    expect(await p.process(CANCELLATION_ID)).toEqual({
      outcome: 'DEFERRED',
      code: UNEXPECTED_CODE,
    });
    expect(db.calls.some((c) => c.sql.includes('booking_cmd_trip_park_cancellation'))).toBe(false);
  });

  it('tâche périodique : une demande en échec inattendu ne bloque pas la suivante ; comptes seulement au journal', async () => {
    const { facts } = factsOf('T03');
    const bad = '44444444-4444-4444-8444-444444444444';
    const db = new FakeDb((sql) => {
      if (sql.includes('booking_trip_cancellations_pending'))
        return [{ id: bad }, { id: CANCELLATION_ID }];
      return ok(facts)(sql);
    });
    const registry = new BusRegistry();
    const logs: string[] = [];
    let call = 0;
    const tx = transactionsOf(db);
    const alerts = new Alerts();
    registerTripCancellations(
      registry,
      {
        run: async (worker, fn) => {
          call++;
          // première demande : la lecture des faits rend une ligne illisible (forme inattendue)
          if (call === 1) {
            return tx.run(worker, () => Promise.reject(new TypeError('ligne inattendue')));
          }
          return tx.run(worker, fn);
        },
      },
      alerts,
      (l) => logs.push(l),
    );
    const h = registry.handlerOf('trip_lifecycle');
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    await h.handle({}, db);
    const summary = logs.map((l) => JSON.parse(l) as Record<string, unknown>).at(-1);
    // première : erreur inattendue ⇒ FAILED ; seconde : traitée quand même (sans devis figé dans
    // ce double : QUOTE_UNAVAILABLE ⇒ FAILED) ; les deux garées et alertées
    expect(summary).toMatchObject({ worker: 'trip_lifecycle', failed: 2, settled: 0 });
    expect(
      db.calls.filter((c) => c.sql.includes('booking_cmd_trip_park_cancellation')),
    ).toHaveLength(2);
    expect(alerts.sent.map((a) => a.labels?.error_code)).toEqual([
      UNEXPECTED_CODE,
      'QUOTE_UNAVAILABLE',
    ]);
    for (const l of logs) {
      expect(l).not.toContain(bad);
      expect(l).not.toContain(CANCELLATION_ID);
    }
    expect(db.calls.filter((c) => c.sql.includes('booking_trip_cancellation_begin'))).toHaveLength(
      1,
    );
  });
});
