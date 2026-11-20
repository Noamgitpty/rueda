/**
 * US-215 (215a, ADR-148) — le VRAI processeur de production sur PostgreSQL réel (revue qa n° 1 et
 * n° 9 de la PR #203) : `TripCancellationProcessor` (lecture `core.booking_trip_cancellation_begin`,
 * moteur unique, `core.settlement_cmd_record`, transition réglée, capture d'origine `captureOf`,
 * remboursement `PgRefundPlanner.plan`) et la tâche périodique `registerTripCancellations`, sous les
 * rôles de production (`connectAs` : assertion L0-05 en tête), en USD (T03 / TJ02b) et en PYG
 * sans décimale (T27 / TJ08b).
 *
 * Préparation VALIDÉE (trip neuf du vecteur, capture prouvée par un vrai webhook signé, demande de
 * la console sous app_api) ; le processeur valide ses propres transactions (horloge virtuelle). Le
 * trip du moteur est celui du vecteur (`tripOf`, aucun devis figé dans la fixture de trip) ; les
 * jambes attendues viennent de l'export des oracles (`@rueda/money/golden-vectors`), jamais du code.
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
import { BusRegistry } from '../../bus/index.js';
import type { AlertChannel, OpsAlert, SqlClient, WorkerTransactions } from '../../bus/index.js';
import {
  TripCancellationProcessor,
  registerTripCancellations,
  type CancellationFacts,
} from './trip-cancellation.js';

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
const MINUTE = 60_000;
const SIGNUP = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
/** Instant de la demande : fenêtre virtuelle lointaine (2032), distincte des preuves L0. */
const REQUESTED_AT_MS = Date.UTC(2032, 4, 12, 12, 0, 0);
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

/**
 * Transactions du travailleur sous app_worker, VALIDÉES, à l'instant virtuel `atMs` (comme le
 * travailleur de production : `BEGIN`, contexte, `fn`, `COMMIT` ou `ROLLBACK`).
 */
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

interface World {
  readonly trip: string;
  readonly capture: string;
  readonly country: string;
}

/** Trip neuf du vecteur, capturé par les jambes `capture` (webhook signé, report). VALIDÉ. */
async function world(
  vector: string,
  capture: string,
  shiftMs = 0,
  checkinOpen = false,
): Promise<World> {
  const v = settlementVector(golden, vector);
  const c = countryCases().find((x) => x.currency === v.currency);
  if (c === undefined) throw new Error(`aucun pays en ${v.currency}`);
  const at = v.event.requestedAtMinutes;
  if (at === undefined) throw new Error(`${vector} : instant de demande absent`);
  const startAtMs = REQUESTED_AT_MS + shiftMs - at * MINUTE;
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
  // compte FAKE ACTIVE du pays partagé (fixture 9800 : un seul compte ACTIVE par pays)
  const account = await w.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
    c.country,
  ]);
  const idem = `trip:${trip}:capture:${operation}`;
  await w.query(
    `SELECT * FROM core.payment_cmd_record_operation($1, NULL, $2, $3, 'CARD', 'CAPTURE', 'RENT',
                                                    $4, $5, 1, $6, $6, $7::jsonb, NULL, NULL)`,
    [
      operation,
      trip,
      account.rows[0]?.id,
      LEGS.reduce((s, k) => s + legs[k], 0n).toString(),
      c.currency,
      idem,
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
  if (checkinOpen) {
    // US-307 : remise ouverte (un no-show ne se déclare qu'en CHECKIN_OPEN ou START_WINDOW_EXPIRED)
    await w.query(`SELECT pg_catalog.set_config('app.worker_name', 'trip_lifecycle', true)`);
    await w.query(
      `SELECT core.booking_cmd_trip_transition($1, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED', NULL)`,
      [trip],
    );
  }
  await w.query('COMMIT');
  return { trip, capture: operation, country: c.country };
}

/** Demande de la console (CANCEL_TRIP_GUEST) d'un agent OPS du pays, à l'instant virtuel. */
async function request(
  w: World,
  action = 'CANCEL_TRIP_GUEST',
  input: Record<string, unknown> = {},
  shiftMs = 0,
): Promise<string> {
  const api = await open('app_api');
  const userId = randomUUID();
  const reg = await api.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Staff', 'Test', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [
      userId,
      `int215-${userId}@example.test`,
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
    iso(REQUESTED_AT_MS + shiftMs),
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
       FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, '{}'::uuid[])`,
    [hash, randomUUID(), action, w.trip, 'Demande du support, motif de test', input],
  );
  await api.query('COMMIT');
  expect(rows[0]?.outcome).toBe('DONE');
  return rows[0]?.domain_ref ?? '';
}

/** Trip du moteur : celui du vecteur, aux instants de la base. */
const tripOf =
  (vector: string) =>
  (f: CancellationFacts): ReturnType<typeof toTrip> => ({
    ...toTrip(settlementVector(golden, vector).trip),
    startAtMs: f.startAtMs,
    bookedAtMs: f.bookedAtMs,
  });

/** État lu après coup : demande, variation des jambes du règlement, jambes de l'ordre REFUND. */
async function observe(cancellation: string, trip: string) {
  const w = await open('app_worker');
  const row = await w.query<{ status: string; settlement_id: string | null; cost_bearer: string }>(
    'SELECT status, settlement_id, cost_bearer FROM test_fixture.us215_cancellation($1)',
    [cancellation],
  );
  await w.query('BEGIN');
  await w.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', 'settlement', true)`,
  );
  const variation = await w.query<{ leg: string; v: string }>(
    `SELECT leg, variation_minor::text AS v FROM core.settlement_settlement_leg
      WHERE settlement_id = $1`,
    [row.rows[0]?.settlement_id],
  );
  await w.query(`SELECT pg_catalog.set_config('app.worker_name', 'payment_command', true)`);
  const refund = await w.query<{ leg: string; v: string }>(
    `SELECT l.leg, l.amount_minor::text AS v
       FROM core.payment_payment_operation AS o
       JOIN core.payment_payment_operation_leg AS l ON l.operation_id = o.id
      WHERE o.trip_id = $1 AND o.kind = 'REFUND'`,
    [trip],
  );
  await w.query('ROLLBACK');
  const legs = (rows: { leg: string; v: string }[]) =>
    Object.fromEntries(rows.map((r) => [r.leg, BigInt(r.v)]));
  return { row: row.rows[0], variation: legs(variation.rows), refund: legs(refund.rows) };
}

const negate = (l: Record<string, bigint>) =>
  Object.fromEntries(LEGS.map((k) => [k, -(l[k] ?? 0n)]));

describe('US-215 — processeur de production sur base réelle', () => {
  it('devise à deux décimales (T03) : process() règle la demande, jambes du règlement = TJ02b, remboursement planifié = −TJ02b', async () => {
    const w = await world('T03', 'TJ01');
    const id = await request(w);
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({
      transactions: committing(REQUESTED_AT_MS + MINUTE),
      alerts,
      tripOf: tripOf('T03'),
    });
    expect(await p.process(id)).toEqual({ outcome: 'SETTLED', costBearer: 'GUEST', orders: 1 });
    expect(alerts.sent).toEqual([]);
    const o = await observe(id, w.trip);
    expect(o.row).toMatchObject({ status: 'SETTLED', cost_bearer: 'GUEST' });
    const tj02b = legVector(golden, 'TJ02b').legsMinor;
    expect(o.variation).toEqual({ ...tj02b });
    expect(o.refund).toEqual(negate({ ...tj02b }));
    // rejeu : la demande n'est plus en attente, rien n'est écrit
    expect(await p.process(id)).toEqual({ outcome: 'SKIPPED' });
  });

  it('devise sans décimale (T27) : la tâche périodique trip_lifecycle règle la demande en attente ; comptes seulement au journal', async () => {
    const w = await world('T27', 'TJ08a');
    const id = await request(w);
    const registry = new BusRegistry();
    const logs: string[] = [];
    const transactions = committing(REQUESTED_AT_MS + MINUTE);
    registerTripCancellations(
      registry,
      transactions,
      new Alerts(),
      (l) => logs.push(l),
      tripOf('T27'),
    );
    const h = registry.handlerOf('trip_lifecycle');
    if (h?.kind !== 'timer') throw new Error('minuterie attendue');
    // la base de test est partagée : d'autres demandes en attente peuvent être traitées aussi
    await transactions.run('trip_lifecycle', (tx) => h.handle({}, tx));
    const summary = JSON.parse(logs.at(-1) ?? '{}') as Record<string, unknown>;
    expect(summary).toMatchObject({ level: 'info', worker: 'trip_lifecycle' });
    expect(Number(summary['settled'])).toBeGreaterThanOrEqual(1);
    for (const l of logs) expect(l).not.toContain(id);
    const o = await observe(id, w.trip);
    expect(o.row).toMatchObject({ status: 'SETTLED', cost_bearer: 'GUEST' });
    const tj08b = legVector(golden, 'TJ08b').legsMinor;
    expect(o.variation).toEqual({ ...tj08b });
    expect(o.refund).toEqual(negate({ ...tj08b }));
  });
});

/**
 * US-307 (ADR-191) — no-show du voyageur déclaré par l'ops (`DECLARE_NO_SHOW`, absentParty GUEST)
 * à T+72 h sans message de l'hôte tracé (T39, hôte inéligible) : le VRAI processeur lit
 * `hostMessageTraced` en base, garde la réaffectation par `SUPPORTS_PAYOUT_ADJUSTMENT` (capacité
 * VALIDÉE dans une fenêtre virtuelle propre à ce fichier, 2032), écrit la réaffectation puis le
 * remboursement ; capacité non validée (ligne plus récente `UNKNOWN`) ⇒ FIN_REVIEW, rien d'écrit.
 * Attendus : TJ05b de l'export ; 08 E7 (note de TJ05b) : 18,53 réaffectés, 112,72 + 25,50 remboursés.
 */
async function setCapability(country: string, status: string, validFromMs: number): Promise<void> {
  const w = await open('app_worker');
  await w.query(
    `SELECT test_fixture.us024_set_capability('FAKE', $1, 'CARD', 'SUPPORTS_PAYOUT_ADJUSTMENT',
                                              'true'::jsonb, $2, $3::timestamptz)`,
    [country, status, iso(validFromMs)],
  );
}

describe('US-307 — no-show déclaré, processeur de production', () => {
  it('T39 (devise à deux décimales) : capacité validée ⇒ réglée, variation TJ05b, réaffectation HOST → PLATFORM puis remboursement', async () => {
    const w = await world('T39', 'TJ01', 0, true);
    await setCapability(w.country, 'VALIDATED_SANDBOX', REQUESTED_AT_MS - 60 * MINUTE);
    const id = await request(w, 'DECLARE_NO_SHOW', { absentParty: 'GUEST' });
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({
      transactions: committing(REQUESTED_AT_MS + MINUTE),
      alerts,
      tripOf: tripOf('T39'),
    });
    expect(await p.process(id)).toEqual({ outcome: 'SETTLED', costBearer: 'GUEST', orders: 2 });
    expect(alerts.sent).toEqual([]);
    const o = await observe(id, w.trip);
    expect(o.variation).toEqual({ ...legVector(golden, 'TJ05b').legsMinor });
    expect(o.refund).toEqual({ HOST: 11272n, INSURER: 2550n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n });
  });

  it('T39 (devise à deux décimales) : capacité non validée ⇒ FIN_REVIEW (LEG_REALLOCATION_UNSUPPORTED), alerte FIN, aucun ordre', async () => {
    const day = 24 * 60 * MINUTE;
    const w = await world('T39', 'TJ01', day, true);
    await setCapability(w.country, 'UNKNOWN', REQUESTED_AT_MS + day - 60 * MINUTE);
    const id = await request(w, 'DECLARE_NO_SHOW', { absentParty: 'GUEST' }, day);
    const alerts = new Alerts();
    const p = new TripCancellationProcessor({
      transactions: committing(REQUESTED_AT_MS + day + MINUTE),
      alerts,
      tripOf: tripOf('T39'),
    });
    expect(await p.process(id)).toEqual({
      outcome: 'FIN_REVIEW',
      code: 'LEG_REALLOCATION_UNSUPPORTED',
    });
    expect(alerts.sent.map((a) => a.code)).toEqual(['FIN_SETTLEMENT_REVIEW']);
    const o = await observe(id, w.trip);
    expect(o.row).toMatchObject({ status: 'FIN_REVIEW', settlement_id: null });
    expect(o.refund).toEqual({});
  });
});
