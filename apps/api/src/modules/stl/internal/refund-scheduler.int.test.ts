/**
 * US-224c (ADR-150) — l'ordonnanceur de production sur PostgreSQL réel, de bout en bout : une
 * annulation de l'ops réglée par le VRAI processeur d'US-215 laisse un remboursement `PLANNED` ;
 * `RefundScheduler.process` l'autorise et l'envoie au connecteur (connecteur de test qui rend « en
 * cours »), l'instance passe `SENT` ; la preuve signée du PSP, appliquée par le travailleur
 * `webhook_ingest`, la passe `CONFIRMED` ; le passage suivant reporte le remboursement sur les
 * soldes des jambes. Rôles de production (`connectAs` : assertion L0-05 en tête), USD (T03 /
 * TJ02b) et PYG sans décimale (T27 / TJ08b).
 *
 * Préparation VALIDÉE (trip neuf du vecteur, capture prouvée par un vrai webhook signé, demande de
 * la console) ; seules les instances de ce fichier sont traitées (la base de test est partagée :
 * jamais la tâche périodique, qui enverrait au connecteur de test celles des autres fichiers).
 * Attendus : export des oracles (`@rueda/money/golden-vectors`), jamais le code testé.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setSessionContext } from '@rueda/db';
import { connectAs, releaseClient } from '@rueda/db/testing';
import type {} from '@rueda/db/testing/global-setup';
import { legVector, loadGoldenVectors, settlementVector } from '@rueda/money/golden-vectors';
import { toTrip } from '@rueda/money/testing';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { countryCases } from '../../../../test/support/countries.js';
import type { AlertChannel, OpsAlert, SqlClient, WorkerTransactions } from '../../bus/index.js';
import { PgRefundOrders } from '../../pay/index.js';
import type {
  OperationResult,
  PaymentConnectorRegistry,
  PaymentProvider,
  RefundRequest,
} from '../../pay/index.js';
import { RefundScheduler } from './refund-scheduler.js';
import { TripCancellationProcessor, type CancellationFacts } from './trip-cancellation.js';

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const MINUTE = 60_000;
const SIGNUP = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
/** Instant de la demande : fenêtre virtuelle lointaine (2032), distincte des autres preuves. */
const REQUESTED_AT_MS = Date.UTC(2032, 6, 14, 12, 0, 0);
const iso = (ms: number): string => new Date(ms).toISOString();

const opened: pg.Client[] = [];
afterEach(async () => {
  for (const c of opened.splice(0)) await releaseClient(c);
});
async function open(role: 'app_api' | 'app_worker'): Promise<pg.Client> {
  const client = await connectAs(role); // assertion L0-05
  opened.push(client);
  return client;
}

const sqlOf = (client: pg.Client): SqlClient => ({
  query: async <R>(text: string, params?: readonly unknown[]) => {
    const r = await client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  },
});

/** Transactions du travailleur sous app_worker, VALIDÉES, à l'instant virtuel `atMs`. */
function committing(atMs: number): WorkerTransactions {
  return {
    async run(worker, fn) {
      const client = await open('app_worker');
      await client.query('BEGIN');
      try {
        await client.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', $1, true),
                  pg_catalog.set_config('app.virtual_now', $2, true)`,
          [worker, iso(atMs)],
        );
        const out = await fn(sqlOf(client));
        await client.query('COMMIT');
        return out;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
  };
}

class Alerts implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  send(alert: OpsAlert): Promise<void> {
    this.sent.push(alert);
    return Promise.resolve();
  }
}

/** Connecteur de test : en-tête d'idempotence honoré ; le remboursement est pris « en cours ». */
class AcceptingConnector {
  readonly refunds: RefundRequest[] = [];
  capabilities() {
    return {
      bool: (name: string) =>
        name === 'SUPPORTS_IDEMPOTENCY_HEADER' || name === 'SUPPORTS_LOOKUP_BY_MERCHANT_REF',
    };
  }
  refund(req: RefundRequest): Promise<OperationResult> {
    this.refunds.push(req);
    return Promise.resolve({ providerReference: `psp-refund-${randomUUID()}`, status: 'PENDING' });
  }
}

interface World {
  readonly trip: string;
  readonly capture: string;
  readonly country: string;
}

/** Trip neuf du vecteur, capturé par les jambes `capture` (webhook signé, report). VALIDÉ. */
async function world(vector: string, capture: string): Promise<World> {
  const v = settlementVector(golden, vector);
  const c = countryCases().find((x) => x.currency === v.currency);
  if (c === undefined) throw new Error(`aucun pays en ${v.currency}`);
  const at = v.event.requestedAtMinutes;
  if (at === undefined) throw new Error(`${vector} : instant de demande absent`);
  const startAtMs = REQUESTED_AT_MS - at * MINUTE;
  const bookedAtMs = startAtMs + v.trip.bookedAtMinutes * MINUTE;
  const legs = legVector(golden, capture).legsMinor;
  const trip = randomUUID();
  const operation = randomUUID();
  const w = await open('app_worker');
  await w.query('BEGIN');
  await w.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', 'payment_command', true),
            pg_catalog.set_config('app.virtual_now', $1, true)`,
    [iso(bookedAtMs)],
  );
  await w.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`, [
    trip,
    randomUUID(),
    randomUUID(),
    randomUUID(),
    c.country,
    c.currency,
    iso(startAtMs),
    iso(startAtMs + v.trip.days * 24 * 60 * MINUTE),
  ]);
  const account = await w.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
    c.country,
  ]);
  await w.query(
    `SELECT * FROM core.payment_cmd_record_operation($1, NULL, $2, $3, 'CARD', 'CAPTURE', 'RENT',
                                                    $4, $5, 1, $6, $6, $7::jsonb, NULL, NULL)`,
    [
      operation,
      trip,
      account.rows[0]?.id,
      LEGS.reduce((s, k) => s + legs[k], 0n).toString(),
      c.currency,
      `trip:${trip}:capture:${operation}`,
      JSON.stringify(Object.fromEntries(LEGS.map((k) => [k, legs[k].toString()]))),
    ],
  );
  const raw = await w.query<{ id: string }>(
    'SELECT test_fixture.us049_signed_webhook($1, $2) AS id',
    [operation, 'SUCCEEDED'],
  );
  await w.query(
    `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK', $2, NULL)`,
    [operation, raw.rows[0]?.id],
  );
  await w.query('SELECT core.settlement_cmd_apply_leg_movement($1)', [operation]);
  await w.query('COMMIT');
  return { trip, capture: operation, country: c.country };
}

/** Demande de la console (CANCEL_TRIP_GUEST) d'un agent OPS du pays, à l'instant virtuel. */
async function request(w: World): Promise<string> {
  const api = await open('app_api');
  const userId = randomUUID();
  const reg = await api.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Staff', 'Test', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [
      userId,
      `int224c-${userId}@example.test`,
      PHC,
      randomUUID(),
      randomBytes(32),
      w.country,
      SIGNUP,
    ],
  );
  if (reg.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await api.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  await api.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, 'OPS_AGENT', $3::text[], NULL, NULL)`,
    [randomUUID(), userId, [w.country]],
  );
  await api.query('BEGIN');
  await api.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
    iso(REQUESTED_AT_MS),
  ]);
  const hash = createHash('sha256').update(randomBytes(32)).digest();
  await api.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [userId, hash]);
  await setSessionContext(api, {
    kind: 'STAFF',
    actorId: userId,
    countryScope: [w.country],
    sessionTokenHash: hash.toString('hex'),
  });
  const { rows } = await api.query<{ outcome: string; domain_ref: string | null }>(
    `SELECT outcome, domain_ref
       FROM core.iam_staff_cmd_manual_action($1, $2, 'CANCEL_TRIP_GUEST', $3, $4, '{}'::jsonb,
                                             '{}'::uuid[])`,
    [hash, randomUUID(), w.trip, 'Demande du support, motif de test'],
  );
  await api.query('COMMIT');
  expect(rows[0]?.outcome).toBe('DONE');
  return rows[0]?.domain_ref ?? '';
}

const tripOf =
  (vector: string) =>
  (f: CancellationFacts): ReturnType<typeof toTrip> => ({
    ...toTrip(settlementVector(golden, vector).trip),
    startAtMs: f.startAtMs,
    bookedAtMs: f.bookedAtMs,
  });

/** Lecture sous payment_command (rien n'est écrit) : instance du trip, son ordre, soldes. */
async function observe(trip: string) {
  const w = await open('app_worker');
  await w.query('BEGIN');
  await w.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', 'payment_command', true)`,
  );
  const inst = await w.query<{ id: string; status: string; operation_id: string; issued: boolean }>(
    `SELECT id, status, operation_id, issued_at IS NOT NULL AS issued
       FROM core.payment_refund_instance WHERE trip_id = $1`,
    [trip],
  );
  const refunded = await w.query<{ leg: string; v: string }>(
    `SELECT leg, refunded_minor::text AS v FROM core.settlement_trip_leg_balance
      WHERE trip_id = $1 AND segment_no = 1`,
    [trip],
  );
  const due = await new PgRefundOrders(sqlOf(w)).due(500);
  await w.query('ROLLBACK');
  const row = inst.rows[0];
  if (row === undefined || inst.rows.length !== 1) throw new Error('une instance attendue');
  return {
    instance: row,
    refunded: Object.fromEntries(refunded.rows.map((r) => [r.leg, BigInt(r.v)])),
    due: due.find((d) => d.instanceId === row.id),
  };
}

/** Preuve signée du PSP appliquée par le travailleur `webhook_ingest` (comme en production). */
async function proveByWebhook(operationId: string, atMs: number): Promise<string> {
  return committing(atMs).run('webhook_ingest', async (tx) => {
    const raw = await tx.query<{ id: string }>(
      'SELECT test_fixture.us049_signed_webhook($1, $2) AS id',
      [operationId, 'SUCCEEDED'],
    );
    const { rows } = await tx.query<{ outcome: string }>(
      `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK', $2, NULL) AS outcome`,
      [operationId, raw.rows[0]?.id],
    );
    return rows[0]?.outcome ?? '';
  });
}

describe.each([
  { vector: 'T03', capture: 'TJ01', variation: 'TJ02b' },
  { vector: 'T27', capture: 'TJ08a', variation: 'TJ08b' },
])('US-224c — ordonnanceur sur base réelle ($vector)', ({ vector, capture, variation }) => {
  it('PLANNED → SUBMITTED / SENT (ordre stocké envoyé au connecteur) → CONFIRMED (preuve signée) → reporté ; jambes = −variation de l’oracle', async () => {
    const w = await world(vector, capture);
    const id = await request(w);
    const settled = await new TripCancellationProcessor({
      transactions: committing(REQUESTED_AT_MS + MINUTE),
      alerts: new Alerts(),
      tripOf: tripOf(vector),
    }).process(id);
    expect(settled).toMatchObject({ outcome: 'SETTLED', orders: 1 });

    const before = await observe(w.trip);
    expect(before.instance).toMatchObject({ status: 'PLANNED', issued: false });
    const due = before.due;
    if (due === undefined) throw new Error('instance absente de la file');
    expect(due).toMatchObject({ country: w.country, status: 'PLANNED', provider: 'FAKE' });

    const connector = new AcceptingConnector();
    const connectors: PaymentConnectorRegistry = {
      get: (p) => (p === 'FAKE' ? (connector as unknown as PaymentProvider) : undefined),
    };
    const alerts = new Alerts();
    const scheduler = new RefundScheduler({
      transactions: committing(REQUESTED_AT_MS + 2 * MINUTE),
      alerts,
      connectors,
    });
    expect(await scheduler.process(due)).toEqual({ step: 'SENT' });
    const expected = Object.fromEntries(
      LEGS.map((k) => [k, -legVector(golden, variation).legsMinor[k]]),
    );
    expect(connector.refunds).toHaveLength(1);
    expect(connector.refunds[0]).toMatchObject({
      amountMinor: LEGS.reduce((s, k) => s + (expected[k] ?? 0n), 0n),
      currency: legVector(golden, variation).currency,
      legs: expected,
    });
    expect(connector.refunds[0]?.idempotencyKey).toMatch(/^.{1,64}$/);

    const sent = await observe(w.trip);
    expect(sent.instance).toMatchObject({ status: 'SENT', issued: true });
    // en vol : relu au passage suivant (lecture d'abord), jamais renvoyé sans lecture
    expect(sent.due).toMatchObject({ status: 'SENT', operationStatus: 'SUBMITTED' });

    expect(await proveByWebhook(sent.instance.operation_id, REQUESTED_AT_MS + 3 * MINUTE)).toBe(
      'APPLIED',
    );
    const confirmed = await observe(w.trip);
    expect(confirmed.instance.status).toBe('CONFIRMED');
    const again = confirmed.due;
    if (again === undefined) throw new Error('remboursement prouvé absent de la file');
    expect(await scheduler.process(again)).toEqual({ step: 'REPORTED' });

    const done = await observe(w.trip);
    expect(done.refunded).toEqual(expected);
    expect(done.due).toBeUndefined();
    expect(alerts.sent).toEqual([]);
    expect(connector.refunds).toHaveLength(1);
  });
});
