/**
 * US-024 — conversion gardée, ré-acquisition et compensation (19 US-024 ; 16 BKG-014 ; 08 BR-BOOK-10,
 * SM-1, EC-51 ; 17 §2.3, §2.5 étapes 3 à 7 et scénarios C2, C3, C4, C4 bis, C6, C7, C8, C13, C14,
 * C15, C15 bis, C16, C17, C18, C20 ; L0-07 ; migrations 0040, 0041, ADR-065).
 *
 * Attendus : tableau « Plan de test de concurrence » de 17 §2.5 (reformulé pour le seul hold
 * CHECKOUT, révision P2P), paramètres de 17 §7.2 (graine US-013) et montants des vecteurs TJ01
 * (USD) et TJ08a (PYG) de 08 E7 (export des oracles, US-016) — jamais le code testé.
 *
 * Rôles de production seulement : app_api (voyageur, commandes T1 / T2 / libération par
 * commandCallSql), app_worker (booking_conversion, disposition_sweeper, payment_intent_sweeper,
 * hold_expiry, webhook_ingest, payment_command, outbox_relay) ; assertion L0-05 par connectAs à
 * chaque test. En USD (PA) et en PYG (PY).
 *
 * Horloge : chaque test vit dans sa propre période virtuelle (2041 et après) ; ce fichier tourne
 * SEUL, après tous les autres fichiers L0 (projet l0-concurrence, vitest.l0.config.ts) : la tâche
 * d'expiration et les balayages, qui portent sur toute la base, ne touchent aucun hold d'un autre
 * fichier en cours. Les capacités du FAKE sont ouvertes puis refermées dans la période du test.
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commandCallSql, translateDbError } from '../../src/index.ts';
import type { SessionContext } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { at, COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase, Slot, Worker } from '../support/avl.ts';
import {
  backendPid,
  ensureParties,
  placeHoldCommand,
  registerVehicles,
  waitUntilBlocked,
} from '../support/concurrency.ts';
import { legsJson } from '../support/pay.ts';

// --- Paramètres de 17 §7.2 (graine US-013) -------------------------------------------------------
const HOLD_MAX_TOTAL_MIN = 20; // hold_max_total_minutes
const PSP_CALL_TIMEOUT_S = 20; // psp_call_timeout_s
const MARGIN_S = 120; // payment_in_flight_margin_s
const REVIEW_TTL_MIN = 10; // hold_ttl_minutes, prolongation unique d'un hold de revue approuvé
/** Yappy : ordre de 300 s (09b §2.1, 17 §2.5 « Garde de durée ») ; hypothèse non mesurée (L0-10). */
const YAPPY_ORDER_TTL_S = 300;

// --- Montants : capture des vecteurs TJ01 (USD) et TJ08a (PYG), 08 E7 -----------------------------
const set = loadGoldenVectors();
const CAPTURE = Object.fromEntries(
  [legVector(set, 'TJ01'), legVector(set, 'TJ08a')].map((v) => [v.currency, v]),
);
const captureOf = (c: CountryCase): ReturnType<typeof legVector> => {
  const v = CAPTURE[c.currency];
  if (v === undefined) throw new Error(`aucun vecteur TJ de capture en ${c.currency}`);
  return v;
};
const legsText = (c: CountryCase): Record<string, string> =>
  Object.fromEntries(
    Object.entries(captureOf(c).legsMinor).map(([leg, amount]) => [leg, amount.toString()]),
  );

// --- Horloge virtuelle -------------------------------------------------------------------------
const ERA0 = Date.parse('2041-01-05T10:00:00.000Z');
/** Entrée en vigueur des capacités bloquantes du FAKE de ces preuves : la veille de la période 0. */
const BLOCKING_FROM = new Date(ERA0 - 86_400_000).toISOString();
const era = (n: number): string => new Date(ERA0 + n * 3 * 86_400_000).toISOString();
const atSec = (base: string, seconds: number): string =>
  new Date(Date.parse(base) + seconds * 1000).toISOString();

const guest = (actorId: string): SessionContext => ({ kind: 'GUEST', actorId });
const LONG = 120_000;

interface Failure {
  readonly code: string;
  readonly raw: { readonly code: string | undefined; readonly constraint: string | undefined };
}
const failure = (error: unknown): Failure => {
  const e = error as { code?: string; constraint?: string };
  return { code: translateDbError(error).code, raw: { code: e.code, constraint: e.constraint } };
};
const isFailure = (x: unknown): x is Failure =>
  typeof x === 'object' && x !== null && 'raw' in x && 'code' in x;

type Json = Record<string, unknown>;

let api: pg.Client;
let worker: pg.Client;

beforeEach(async () => {
  api = await connectAs('app_api');
  worker = await connectAs('app_worker');
});

afterEach(async () => {
  await releaseClient(worker);
  await releaseClient(api);
});

// --- Monde de test ---------------------------------------------------------------------------------
interface World {
  readonly orgId: string;
  readonly vehicles: string[];
  readonly guests: string[];
  readonly account: string;
}

async function world(c: CountryCase, vehicles: number, guests: number): Promise<World> {
  const orgId = uuid();
  const v = Array.from({ length: vehicles }, () => uuid());
  const g = Array.from({ length: guests }, () => uuid());
  const account = await inTx(api, { commit: true }, async (tx) => {
    await ensureParties(tx, g, orgId, c);
    await registerVehicles(tx, v, orgId, c);
    const r = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
      c.country,
    ]);
    return r.rows[0]?.id as string;
  });
  return { orgId, vehicles: v, guests: g, account };
}

const slotOf = (vehicleId: string, orgId: string, base: string, startMin: number): Slot => {
  const start = new Date(Date.parse(base) + startMin * 60_000);
  return {
    vehicleId,
    orgId,
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
    bufferHours: 2,
  };
};
/** Créneau de deux jours commençant deux jours après `base`. */
const slotLater = (vehicleId: string, orgId: string, base: string, days = 2): Slot =>
  slotOf(vehicleId, orgId, base, days * 24 * 60);

// --- Commandes du voyageur (app_api, commandCallSql) --------------------------------------------------
async function pose(g: string, slot: Slot, when: string, flagged = false): Promise<string> {
  return inTx(api, { virtualNow: when, commit: true }, (tx) =>
    placeHoldCommand(tx, { slot, guestId: g, flagged }),
  );
}

async function poseOutcome(g: string, slot: Slot, when: string): Promise<string> {
  try {
    await pose(g, slot, when);
    return 'OK';
  } catch (error) {
    return failure(error).code;
  }
}

async function setTerms(holdId: string, c: CountryCase, slot: Slot): Promise<void> {
  const v = captureOf(c);
  await inTx(api, { commit: true }, (tx) =>
    tx.query(
      `SELECT test_fixture.us024_set_terms($1, $2::bigint, $3, $4::jsonb, $5::timestamptz,
                                           $6::timestamptz, $7)`,
      [
        holdId,
        v.totalMinor.toString(),
        v.currency,
        legsJson(v.legsMinor),
        slot.start,
        slot.end,
        c.timezone,
      ],
    ),
  );
}

async function guestCall<T>(
  ctx: SessionContext,
  fn: string,
  args: { value: unknown; type: string }[],
  when: string,
  commit = true,
): Promise<T | Failure> {
  try {
    return await inTx(api, { virtualNow: when, commit }, async (tx) => {
      const { text, values } = commandCallSql(ctx, fn, args);
      const r = await tx.query<{ result: T }>(text, values);
      return r.rows[0]?.result as T;
    });
  } catch (error) {
    return failure(error);
  }
}

const startPayment = (
  g: string,
  holdId: string,
  account: string,
  when: string,
  method = 'CARD',
): Promise<Json | Failure> =>
  guestCall<Json>(
    guest(g),
    'core.booking_cmd_start_payment',
    [
      { value: holdId, type: 'uuid' },
      { value: account, type: 'uuid' },
      { value: method, type: 'text' },
    ],
    when,
  );

const recordOrder = (
  g: string,
  holdId: string,
  operationId: string,
  reference: string,
  when: string,
  orderExpiresAt: string | null,
): Promise<string | Failure> =>
  guestCall<string>(
    guest(g),
    'core.booking_cmd_record_order',
    [
      { value: holdId, type: 'uuid' },
      { value: operationId, type: 'uuid' },
      { value: reference, type: 'text' },
      { value: orderExpiresAt, type: 'timestamptz' },
    ],
    when,
  );

const release = (
  g: string,
  holdId: string,
  when: string,
  commit = true,
): Promise<string | Failure> =>
  guestCall<string>(
    guest(g),
    'core.booking_cmd_release_own_hold',
    [{ value: holdId, type: 'uuid' }],
    when,
    commit,
  );

/** T1 (CARD) puis T2 : l'ordre expire `orderMin` minutes après T1. Renvoie l'opération. */
async function order(
  g: string,
  holdId: string,
  account: string,
  t1: string,
  orderMin = 5,
  method = 'CARD',
): Promise<{ operationId: string; reference: string }> {
  const s = await startPayment(g, holdId, account, t1, method);
  if (isFailure(s)) throw new Error(`T1 refusée : ${s.code}`);
  expect(s.outcome).toBe('NEW_ORDER');
  const operationId = s.operationId as string;
  const reference = `fake-${uuid()}`;
  expect(await recordOrder(g, holdId, operationId, reference, t1, at(t1, orderMin))).toBe(
    'RECORDED',
  );
  return { operationId, reference };
}

// --- Travailleurs (app_worker) ---------------------------------------------------------------------
async function workerSql<T extends pg.QueryResultRow>(
  name: Worker,
  when: string | undefined,
  sql: string,
  params: unknown[],
  commit = true,
): Promise<T[]> {
  return inTx(
    worker,
    { worker: name, ...(when !== undefined ? { virtualNow: when } : {}), commit },
    async (tx) => (await tx.query<T>(sql, params)).rows,
  );
}

/** Statut reçu du PSP (webhook signé, réponse API ou lecture du balayage), règles de rang §4.4. */
async function applyStatus(
  operationId: string,
  status: 'SUCCEEDED' | 'FAILED' | 'UNKNOWN' | 'SUBMITTED',
  when: string,
  source: 'WEBHOOK' | 'POLL' | 'API_RESPONSE' = 'WEBHOOK',
): Promise<string> {
  const name: Worker = source === 'WEBHOOK' ? 'webhook_ingest' : 'payment_command';
  const rows = await workerSql<{ outcome: string }>(
    name,
    when,
    'SELECT core.payment_cmd_apply_operation_status($1, $2, $3, NULL, NULL) AS outcome',
    [operationId, status, source],
  );
  return rows[0]?.outcome as string;
}

async function convert(
  operationId: string,
  when: string,
  name: Worker = 'booking_conversion',
): Promise<Json> {
  const rows = await workerSql<{ r: Json }>(
    name,
    when,
    'SELECT core.booking_convert_payment($1) AS r',
    [operationId],
  );
  return rows[0]?.r as Json;
}

async function paymentFailure(operationId: string, when: string): Promise<Json> {
  const rows = await workerSql<{ r: Json }>(
    'booking_conversion',
    when,
    'SELECT core.booking_record_payment_failure($1) AS r',
    [operationId],
  );
  return rows[0]?.r as Json;
}

async function expiryJob(when: string): Promise<number> {
  const rows = await workerSql<{ n: number }>(
    'hold_expiry',
    when,
    'SELECT core.booking_expire_due_holds(10000) AS n',
    [],
  );
  return rows[0]?.n ?? -1;
}

async function releaseCancelled(when: string): Promise<number> {
  const rows = await workerSql<{ n: number }>(
    'hold_expiry',
    when,
    'SELECT core.booking_release_cancelled_holds(10000) AS n',
    [],
  );
  return rows[0]?.n ?? -1;
}

async function intentsDue(when: string): Promise<string[]> {
  const rows = await workerSql<{ operation_id: string }>(
    'payment_intent_sweeper',
    when,
    'SELECT operation_id FROM core.booking_intents_due(10000)',
    [],
  );
  return rows.map((r) => r.operation_id);
}

async function recordPoll(operationId: string, when: string): Promise<Json> {
  const rows = await workerSql<{ r: Json }>(
    'payment_intent_sweeper',
    when,
    'SELECT core.booking_record_poll($1) AS r',
    [operationId],
  );
  return rows[0]?.r as Json;
}

async function candidates(when: string): Promise<string[]> {
  const rows = await workerSql<{ operation_id: string }>(
    'disposition_sweeper',
    when,
    'SELECT operation_id FROM core.booking_disposition_candidates(10000)',
    [],
  );
  return rows.map((r) => r.operation_id);
}

async function repair(operationId: string, when: string): Promise<Json> {
  const rows = await workerSql<{ r: Json }>(
    'disposition_sweeper',
    when,
    'SELECT core.booking_disposition_repair($1) AS r',
    [operationId],
  );
  return rows[0]?.r as Json;
}

async function setCapability(
  c: CountryCase,
  method: string,
  capability: string,
  value: unknown,
  from: string,
  until: string,
  during: 'VALIDATED_SANDBOX' | 'UNKNOWN' = 'VALIDATED_SANDBOX',
  after: 'VALIDATED_SANDBOX' | 'UNKNOWN' = 'UNKNOWN',
): Promise<void> {
  await inTx(api, { commit: true }, async (tx) => {
    const q = `SELECT test_fixture.us024_set_capability('FAKE', $1, $2, $3, $4::jsonb, $5, $6::timestamptz)`;
    await tx.query(q, [c.country, method, capability, JSON.stringify(value), during, from]);
    await tx.query(q, [c.country, method, capability, JSON.stringify(value), after, until]);
  });
}

/**
 * Capacités BLOQUANTES du catalogue (US-061, 17 §2.8) validées pour (FAKE, pays), portée (*, *),
 * avant toutes les périodes des tests : sans elles, T1 refuse tout paiement (fail-closed).
 */
async function validateAllBlocking(c: CountryCase): Promise<void> {
  await inTx(api, { commit: true }, async (tx) => {
    const { rows } = await tx.query<{ capability: string; kind: string }>(
      `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
    );
    for (const r of rows) {
      const value = r.kind === 'bool' ? true : r.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';
      await tx.query(
        `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', $2, $3::jsonb, 'VALIDATED_SANDBOX', $4::timestamptz)`,
        [c.country, r.capability, JSON.stringify(value), BLOCKING_FROM],
      );
    }
  });
}

async function extraOperation(
  holdId: string,
  kind: 'CAPTURE' | 'AUTH',
  attemptNo: number,
  status: 'SUCCEEDED' | 'PENDING',
  when: string,
): Promise<string> {
  const id = uuid();
  await inTx(api, { virtualNow: when, commit: true }, (tx) =>
    tx.query('SELECT test_fixture.us024_extra_operation($1, $2, $3, $4, $5)', [
      id,
      holdId,
      kind,
      attemptNo,
      status,
    ]),
  );
  return id;
}

// --- Lectures (travailleurs) ---------------------------------------------------------------------
interface HoldState {
  status: string;
  release_reason: string | null;
  payment_in_flight_until: Date | null;
  payment_attempts: number;
  last_polled_at: Date | null;
  converted_trip_id: string | null;
  conversion_operation_id: string | null;
  occ_kind: string;
  occ_active: boolean;
  deactivated_reason: string | null;
}

async function holdState(holdId: string): Promise<HoldState> {
  const rows = await workerSql<HoldState>(
    'booking_conversion',
    undefined,
    `SELECT h.status, h.release_reason, h.payment_in_flight_until, h.payment_attempts,
            h.last_polled_at, h.converted_trip_id, h.conversion_operation_id,
            o.kind AS occ_kind, o.active AS occ_active, o.deactivated_reason
       FROM core.booking_checkout_hold h
       JOIN core.booking_vehicle_occupancy o ON o.id = h.occupancy_id
      WHERE h.id = $1`,
    [holdId],
    false,
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`hold ${holdId} invisible`);
  return row;
}

interface Disposition {
  operation_id: string;
  disposition: string;
  trip_id: string | null;
  reason: string | null;
  action: string | null;
}

async function dispositions(holdId: string): Promise<Disposition[]> {
  return workerSql<Disposition>(
    'booking_conversion',
    undefined,
    `SELECT d.operation_id, d.disposition, d.trip_id, c.reason, c.action
       FROM core.booking_payment_disposition d
       LEFT JOIN core.booking_hold_compensation c ON c.id = d.hold_compensation_id
      WHERE d.hold_id = $1
      ORDER BY d.decided_at, d.operation_id`,
    [holdId],
    false,
  );
}

async function tripsOfGuest(guestId: string): Promise<{ id: string; status: string }[]> {
  return workerSql<{ id: string; status: string }>(
    'booking_conversion',
    undefined,
    'SELECT id, status FROM core.booking_trip WHERE guest_user_id = $1 ORDER BY booked_at',
    [guestId],
    false,
  );
}

async function tripOf(tripId: string): Promise<Json> {
  const rows = await workerSql<Json>(
    'booking_conversion',
    undefined,
    `SELECT t.status, t.scheduled_start, t.scheduled_end, t.timezone, t.currency,
            (SELECT count(*)::int FROM core.booking_vehicle_occupancy o
              WHERE o.kind = 'TRIP' AND o.active AND o.ref_id = t.id) AS active_trip_occupancies,
            (SELECT count(*)::int FROM core.booking_guest_occupancy g
              WHERE g.trip_id = t.id AND g.active) AS guest_occupancies
       FROM core.booking_trip t WHERE t.id = $1`,
    [tripId],
    false,
  );
  return rows[0] as Json;
}

async function activeOn(vehicleId: string): Promise<string[]> {
  const rows = await workerSql<{ kind: string }>(
    'booking_conversion',
    undefined,
    `SELECT kind FROM core.booking_vehicle_occupancy WHERE vehicle_id = $1 AND active ORDER BY kind`,
    [vehicleId],
    false,
  );
  return rows.map((r) => r.kind);
}

async function operations(
  holdId: string,
): Promise<{ id: string; status: string; attempt_no: number }[]> {
  return workerSql(
    'booking_conversion',
    undefined,
    `SELECT id, status, attempt_no FROM core.payment_payment_operation
      WHERE hold_id = $1 ORDER BY attempt_no, created_at`,
    [holdId],
    false,
  );
}

async function events(aggregateId: string): Promise<string[]> {
  const rows = await workerSql<{ type: string }>(
    'outbox_relay',
    undefined,
    'SELECT type FROM core.outbox_outbox_event WHERE aggregate_id = $1 ORDER BY occurred_at, type',
    [aggregateId],
    false,
  );
  return rows.map((r) => r.type);
}

async function commands(
  holdId: string,
): Promise<{ idem_plain: string; status: string; operation_id: string }[]> {
  return workerSql(
    'payment_command',
    undefined,
    `SELECT idem_plain, status, operation_id FROM core.payment_payment_command
      WHERE hold_id = $1 ORDER BY created_at`,
    [holdId],
    false,
  );
}

const iso = (d: Date | null | undefined): string | undefined => d?.toISOString();

describe.each(COUNTRIES)('US-024 — conversion gardée ($country, $currency)', (c) => {
  beforeAll(async () => {
    api = await connectAs('app_api');
    try {
      await validateAllBlocking(c);
    } finally {
      await releaseClient(api);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // T1 / T2 (17 §2.5 étape 3) et conversion nominale ; C15 bis (g) et (h) ; C6 (rejeu séquentiel)
  // ---------------------------------------------------------------------------------------------
  it(
    'T1 / T2 : intention et borne provisoire, double clic (C15 bis g), preuve avant T2 (C15 bis h), conversion, rejeu',
    async () => {
      const T0 = era(0);
      const w = await world(c, 1, 1);
      const g = w.guests[0] as string;
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = await pose(g, slot, T0);
      await setTerms(holdId, c, slot);

      const t1 = await startPayment(g, holdId, w.account, at(T0, 1));
      if (isFailure(t1)) throw new Error(t1.code);
      // TTL d'ordre inconnu (capacité absente) : borne = created_at + hold_max_total_minutes
      expect(t1).toMatchObject({
        outcome: 'NEW_ORDER',
        attemptNo: 1,
        amountMinor: captureOf(c).totalMinor.toString(),
        currency: c.currency,
        legs: legsText(c),
        idemSent: `hold:${holdId}:CAPTURE:a1`,
      });
      expect(new Date(t1.paymentInFlightUntil as string).toISOString()).toBe(
        at(T0, HOLD_MAX_TOTAL_MIN),
      );
      expect((await holdState(holdId)).status).toBe('PAYMENT_IN_FLIGHT');
      expect(await events(holdId)).toContain('booking.hold.payment_in_flight');

      // double clic avant T2 : aucun ordre connu ; SUPPORTS_LOOKUP_BY_MERCHANT_REF (bloquante) est
      // validée ⇒ même clé après getOperation, jamais un second ordre
      const again = await startPayment(g, holdId, w.account, atSec(T0, 90));
      expect(again).toMatchObject({
        outcome: 'RETRY_SAME_KEY',
        operationId: t1.operationId,
        idemSent: `hold:${holdId}:CAPTURE:a1`,
      });
      expect(await operations(holdId)).toHaveLength(1);

      // T2 : ordre de 5 min ⇒ borne affinée à expiration + marge (jamais allongée)
      const ref = `fake-${uuid()}`;
      expect(
        await recordOrder(g, holdId, t1.operationId as string, ref, at(T0, 2), at(T0, 7)),
      ).toBe('RECORDED');
      expect(iso((await holdState(holdId)).payment_in_flight_until)).toBe(
        atSec(at(T0, 7), MARGIN_S),
      );

      // double clic avec ordre vivant (C15 bis g) : l'ordre existant, aucun nouvel ordre
      const existing = await startPayment(g, holdId, w.account, at(T0, 3));
      expect(existing).toMatchObject({
        outcome: 'EXISTING_ORDER',
        operationId: t1.operationId,
        providerReference: ref,
      });
      expect(await operations(holdId)).toHaveLength(1);

      // preuve (webhook signé) AVANT un second T2 (C15 bis h) : rien n'est annulé, ni rétrogradé
      expect(await applyStatus(t1.operationId as string, 'SUCCEEDED', at(T0, 4))).toBe('APPLIED');
      expect(
        await recordOrder(g, holdId, t1.operationId as string, ref, at(T0, 4), at(T0, 7)),
      ).toBe('RECORDED');
      expect((await operations(holdId))[0]?.status).toBe('SUCCEEDED');

      const converted = await convert(t1.operationId as string, at(T0, 4));
      expect(converted).toMatchObject({ outcome: 'CONVERTED', reacquired: false });
      const tripId = converted.tripId as string;
      expect(await holdState(holdId)).toMatchObject({
        status: 'CONVERTED',
        converted_trip_id: tripId,
        conversion_operation_id: t1.operationId,
        occ_kind: 'TRIP',
        occ_active: true,
      });
      const trip = await tripOf(tripId);
      expect(trip).toMatchObject({
        status: 'BOOKED',
        timezone: c.timezone,
        currency: c.currency,
        active_trip_occupancies: 1,
        guest_occupancies: 1,
      });
      expect((trip.scheduled_start as Date).toISOString()).toBe(slot.start);
      expect((trip.scheduled_end as Date).toISOString()).toBe(slot.end);
      expect(await dispositions(holdId)).toEqual([
        {
          operation_id: t1.operationId,
          disposition: 'CONVERSION',
          trip_id: tripId,
          reason: null,
          action: null,
        },
      ]);
      expect(await events(holdId)).toEqual(
        expect.arrayContaining(['booking.hold.created', 'booking.hold.converted']),
      );
      expect(await events(holdId)).not.toContain('booking.hold.reacquired');
      expect(await events(tripId)).toEqual(['booking.trip.booked']);

      // T2 tardive, paiement de nouveau, rejeu de la conversion : rien ne change
      expect(
        await recordOrder(g, holdId, t1.operationId as string, ref, at(T0, 5), at(T0, 7)),
      ).toBe('CONVERTED');
      expect((await operations(holdId))[0]?.status).toBe('SUCCEEDED');
      const paid = await startPayment(g, holdId, w.account, at(T0, 5));
      expect(isFailure(paid) ? paid.code : paid).toBe('INVALID_TRANSITION');
      expect(await convert(t1.operationId as string, at(T0, 6))).toMatchObject({
        outcome: 'REPLAY',
        disposition: 'CONVERSION',
        tripId,
      });
      expect(await tripsOfGuest(g)).toHaveLength(1);
    },
    LONG,
  );

  it(
    'T1 refusée : tiers, devis absent, compte, moyen, revue (UXQ-08), hold échu (C15 c), sans contexte voyageur',
    async () => {
      const T0 = era(1);
      const w = await world(c, 4, 2);
      const [g, other] = w.guests as [string, string];
      const s0 = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = await pose(g, s0, T0);

      // devis absent (fail-closed : aucune ligne avant le module PRC)
      const noQuote = await startPayment(g, holdId, w.account, at(T0, 1));
      expect(isFailure(noQuote) && noQuote.raw).toEqual({
        code: '55000',
        constraint: 'payment_quote_unavailable',
      });
      expect(isFailure(noQuote) && noQuote.code).toBe('QUOTE_UNAVAILABLE');
      await setTerms(holdId, c, s0);
      // autre voyageur, hold inconnu : même réponse, rien n'est révélé
      for (const [who, id] of [
        [other, holdId],
        [g, uuid()],
      ] as const) {
        const r = await startPayment(who, id, w.account, at(T0, 1));
        expect(isFailure(r) && r.raw).toEqual({ code: '42501', constraint: 'hold_forbidden' });
      }
      // compte inconnu, compte de l'autre pays
      const otherCountry = COUNTRIES.find((x) => x.country !== c.country) as CountryCase;
      const foreignAccount = (await world(otherCountry, 0, 0)).account;
      for (const account of [uuid(), foreignAccount]) {
        const r = await startPayment(g, holdId, account, at(T0, 1));
        expect(isFailure(r) && r.code).toBe('PSP_ACCOUNT_INACTIVE');
      }
      // moyen inconnu
      const cash = await startPayment(g, holdId, w.account, at(T0, 1), 'CASH');
      expect(isFailure(cash) && cash.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
      // contexte non voyageur (hôte, travailleur) : FORBIDDEN
      for (const ctx of [
        { kind: 'HOST', actorId: g, orgId: w.orgId },
        { kind: 'WORKER', workerName: 'booking_conversion' },
      ] as SessionContext[]) {
        const r = await guestCall<Json>(
          ctx,
          'core.booking_cmd_start_payment',
          [
            { value: holdId, type: 'uuid' },
            { value: w.account, type: 'uuid' },
            { value: 'CARD', type: 'text' },
          ],
          at(T0, 1),
        );
        expect(isFailure(r) && r.code).toBe('FORBIDDEN');
      }
      expect(await operations(holdId)).toEqual([]);
      expect((await holdState(holdId)).status).toBe('ACTIVE');

      // revue avant le débit (UXQ-08) : aucune intention de paiement avant reviewed_at
      const s1 = slotLater(w.vehicles[1] as string, w.orgId, T0);
      const review = await pose(other, s1, T0, true);
      await setTerms(review, c, s1);
      const underReview = await startPayment(other, review, w.account, at(T0, 1));
      expect(isFailure(underReview) && underReview.code).toBe('BOOKING_UNDER_REVIEW');

      // capacité bloquante retirée (17 §2.8, report d'US-061) : aucun paiement
      const s3 = slotLater(w.vehicles[3] as string, w.orgId, T0);
      const blocked = await pose(g, s3, at(T0, 30));
      await setTerms(blocked, c, s3);
      await setCapability(
        c,
        '*',
        'SUPPORTS_B2C_PAYOUT',
        true,
        at(T0, 30),
        at(T0, 35),
        'UNKNOWN',
        'VALIDATED_SANDBOX',
      );
      const noRail = await startPayment(g, blocked, w.account, at(T0, 31));
      expect(isFailure(noRail) && noRail.raw).toEqual({
        code: '55000',
        constraint: 'host_payout_rail_unavailable',
      });
      expect(isFailure(noRail) && noRail.code).toBe('HOST_PAYOUT_RAIL_UNAVAILABLE');
      expect(await operations(blocked)).toEqual([]);
      expect(await startPayment(g, blocked, w.account, at(T0, 36))).toMatchObject({
        outcome: 'NEW_ORDER',
      });

      // C15 (c) : hold déjà échu au moment de T1 (tâche pas encore passée, puis passée) : aucun appel
      const s2 = slotLater(w.vehicles[2] as string, w.orgId, T0);
      const late = await pose(g, s2, T0);
      await setTerms(late, c, s2);
      const expired = await startPayment(g, late, w.account, at(T0, 11));
      expect(isFailure(expired) && expired.raw).toEqual({
        code: '55000',
        constraint: 'hold_not_payable',
      });
      expect(isFailure(expired) && expired.code).toBe('HOLD_EXPIRED');
      await expiryJob(at(T0, 12));
      const after = await startPayment(g, late, w.account, at(T0, 13));
      expect(isFailure(after) && after.code).toBe('HOLD_EXPIRED');
      expect(await operations(late)).toEqual([]);

      // écriture directe d'app_api sur les tables de paiement et de commandes : refusée
      await inTx(api, {}, async (tx) => {
        await expect(
          tx.query(
            `UPDATE core.payment_payment_operation SET status = 'SUCCEEDED' WHERE hold_id = $1`,
            [holdId],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      });
      await inTx(api, {}, async (tx) => {
        await expect(
          tx.query(`SELECT count(*) FROM core.payment_payment_command`),
        ).rejects.toMatchObject({ code: '42501' });
      });
    },
    LONG,
  );

  it(
    'C15 (a) : borne provisoire avec ORDER_TTL_SECONDS ; la tâche d’expiration pendant l’appel lent ne touche pas le hold',
    async () => {
      const T0 = era(2);
      await setCapability(
        c,
        'YAPPY',
        'ORDER_TTL_SECONDS',
        YAPPY_ORDER_TTL_S,
        T0,
        at(T0, 3 * 24 * 60 - 1),
      );
      const w = await world(c, 1, 1);
      const g = w.guests[0] as string;
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = await pose(g, slot, T0);
      await setTerms(holdId, c, slot);

      const t1 = await startPayment(g, holdId, w.account, at(T0, 9), 'YAPPY');
      if (isFailure(t1)) throw new Error(t1.code);
      // borne = min(T1 + psp_call_timeout_s + ORDER_TTL + marge, created_at + hold_max_total_minutes)
      const bound = atSec(at(T0, 9), PSP_CALL_TIMEOUT_S + YAPPY_ORDER_TTL_S + MARGIN_S);
      expect(Date.parse(bound)).toBeLessThan(Date.parse(at(T0, HOLD_MAX_TOTAL_MIN)));
      expect(new Date(t1.paymentInFlightUntil as string).toISOString()).toBe(bound);
      // appel lent : expires_at (T0 + 10) franchi, la tâche tourne à T0 + 15
      await expiryJob(at(T0, 15));
      expect((await holdState(holdId)).status).toBe('PAYMENT_IN_FLIGHT');
      // T2 tardive : ordre créé à T1, expirant à T1 + 5 min ; preuve ; conversion
      expect(
        await recordOrder(
          g,
          holdId,
          t1.operationId as string,
          `fake-${uuid()}`,
          atSec(at(T0, 15), 30),
          at(T0, 14),
        ),
      ).toBe('RECORDED');
      expect(iso((await holdState(holdId)).payment_in_flight_until)).toBe(
        atSec(at(T0, 14), MARGIN_S),
      );
      expect(await applyStatus(t1.operationId as string, 'SUCCEEDED', atSec(at(T0, 15), 40))).toBe(
        'APPLIED',
      );
      expect(await convert(t1.operationId as string, atSec(at(T0, 15), 40))).toMatchObject({
        outcome: 'CONVERTED',
        reacquired: false,
      });
    },
    LONG,
  );

  it(
    'C15 (b) + C3 : plantage entre T1 et T2 ; le balayage lit à la borne ; expiration ; preuve tardive ⇒ ré-acquisition',
    async () => {
      const T0 = era(3);
      const w = await world(c, 1, 1);
      const g = w.guests[0] as string;
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = await pose(g, slot, T0);
      await setTerms(holdId, c, slot);
      const t1 = await startPayment(g, holdId, w.account, at(T0, 1));
      if (isFailure(t1)) throw new Error(t1.code);
      const op = t1.operationId as string;
      const bound = at(T0, HOLD_MAX_TOTAL_MIN);
      // aucune T2 (plantage) : hold protégé jusqu'à la borne, puis pendant sweep_grace_s sans lecture
      await expiryJob(atSec(bound, 10));
      expect((await holdState(holdId)).status).toBe('PAYMENT_IN_FLIGHT');
      // balayage : rien avant borne − sweep_lead_s, l'ordre ensuite
      expect(await intentsDue(atSec(bound, -40))).not.toContain(op);
      expect(await intentsDue(atSec(bound, 20))).toContain(op);
      // lecture : PSP muet (aucune recherche par notre clé) ⇒ UNKNOWN, lecture notée
      expect(await applyStatus(op, 'UNKNOWN', atSec(bound, 20), 'POLL')).toBe('APPLIED');
      expect(await recordPoll(op, atSec(bound, 20))).toMatchObject({
        outcome: 'POLLED',
        status: 'UNKNOWN',
      });
      expect(iso((await holdState(holdId)).last_polled_at)).toBe(atSec(bound, 20));
      expect(await intentsDue(atSec(bound, 25))).not.toContain(op);
      // le balayage a levé l'état : la tâche expire le hold
      await expiryJob(atSec(bound, 30));
      expect(await holdState(holdId)).toMatchObject({
        status: 'EXPIRED',
        occ_active: false,
        deactivated_reason: 'HOLD_EXPIRED',
      });
      // C3 : preuve après l'expiration, créneau libre ⇒ ré-acquisition, trip BOOKED
      expect(await applyStatus(op, 'SUCCEEDED', at(bound, 5))).toBe('APPLIED');
      const r = await convert(op, at(bound, 5));
      expect(r).toMatchObject({ outcome: 'CONVERTED', reacquired: true });
      expect(await holdState(holdId)).toMatchObject({
        status: 'CONVERTED',
        occ_kind: 'TRIP',
        occ_active: true,
        deactivated_reason: null,
      });
      expect(await events(holdId)).toContain('booking.hold.reacquired');
      expect(await tripOf(r.tripId as string)).toMatchObject({
        status: 'BOOKED',
        active_trip_occupancies: 1,
      });
    },
    LONG,
  );

  it(
    'C4 : créneau pris et converti par B après l’expiration ⇒ aucun trip pour A, compensation REFUND_API (capacité validée), une occupation active',
    async () => {
      const T0 = era(4);
      const w = await world(c, 1, 2);
      const [a, b] = w.guests as [string, string];
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdA = await pose(a, slot, T0);
      await setTerms(holdA, c, slot);
      const { operationId: opA } = await order(a, holdA, w.account, at(T0, 1)); // borne T0 + 8
      await expiryJob(at(T0, 10));
      expect((await holdState(holdA)).status).toBe('EXPIRED');

      const holdB = await pose(b, slot, at(T0, 11));
      await setTerms(holdB, c, slot);
      const { operationId: opB } = await order(b, holdB, w.account, at(T0, 11));
      await applyStatus(opB, 'SUCCEEDED', at(T0, 12));
      expect(await convert(opB, at(T0, 12))).toMatchObject({ outcome: 'CONVERTED' });

      await applyStatus(opA, 'SUCCEEDED', at(T0, 13));
      expect(await convert(opA, at(T0, 13))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'SLOT_LOST_AFTER_EXPIRY',
        action: 'REFUND_API',
      });
      expect(await holdState(holdA)).toMatchObject({ status: 'COMPENSATED', occ_active: false });
      expect(await dispositions(holdA)).toMatchObject([
        {
          operation_id: opA,
          disposition: 'COMPENSATION',
          trip_id: null,
          reason: 'SLOT_LOST_AFTER_EXPIRY',
        },
      ]);
      expect(await tripsOfGuest(a)).toEqual([]);
      expect(await activeOn(slot.vehicleId)).toEqual(['TRIP']);
      expect(await events(holdA)).toEqual(
        expect.arrayContaining(['booking.hold.compensated', 'booking.hold.compensation_required']),
      );
    },
    LONG,
  );

  it(
    'C4 bis : hold concurrent échu mais pas encore balayé ⇒ la ré-acquisition l’expire d’abord, trip pour A, aucune compensation',
    async () => {
      const T0 = era(5);
      const w = await world(c, 1, 2);
      const [a, b] = w.guests as [string, string];
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdA = await pose(a, slot, T0);
      await setTerms(holdA, c, slot);
      const { operationId: opA } = await order(a, holdA, w.account, at(T0, 1));
      await expiryJob(atSec(at(T0, 10), 30));
      expect((await holdState(holdA)).status).toBe('EXPIRED');
      // HB : posé à 10:11, échu à 10:21:00, jamais balayé ; preuve de A à 10:21:20
      const holdB = await pose(b, slot, at(T0, 11));
      await applyStatus(opA, 'SUCCEEDED', atSec(at(T0, 21), 20));
      expect(await convert(opA, atSec(at(T0, 21), 20))).toMatchObject({
        outcome: 'CONVERTED',
        reacquired: true,
      });
      expect(await holdState(holdB)).toMatchObject({ status: 'EXPIRED', occ_active: false });
      expect(await dispositions(holdA)).toMatchObject([{ disposition: 'CONVERSION' }]);
      expect(await activeOn(slot.vehicleId)).toEqual(['TRIP']);
    },
    LONG,
  );

  it(
    'C2 : la tâche d’expiration tourne pendant une conversion verrouillée ⇒ elle saute le hold sans attendre, trip BOOKED, I-OCC',
    async () => {
      const T0 = era(6);
      const w = await world(c, 1, 1);
      const g = w.guests[0] as string;
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = await pose(g, slot, T0);
      await setTerms(holdId, c, slot);
      const { operationId } = await order(g, holdId, w.account, at(T0, 1));
      await applyStatus(operationId, 'SUCCEEDED', at(T0, 7));

      const jobClient = await connectAs('app_worker');
      const reader = await connectAs('app_worker');
      try {
        const result = await inTx(
          worker,
          { worker: 'booking_conversion', virtualNow: at(T0, 12), commit: true },
          async (tx) => {
            const r = await tx.query<{ r: Json }>('SELECT core.booking_convert_payment($1) AS r', [
              operationId,
            ]);
            // barrière : la conversion tient le verrou du hold ; la tâche passe (SKIP LOCKED)
            const n = await inTx(
              jobClient,
              { worker: 'hold_expiry', virtualNow: at(T0, 12), commit: true },
              async (job) => {
                await job.query(`SET LOCAL statement_timeout = '10s'`);
                const q = await job.query<{ n: number }>(
                  'SELECT core.booking_expire_due_holds(10000) AS n',
                );
                return q.rows[0]?.n ?? -1;
              },
            );
            expect(n).toBeGreaterThanOrEqual(0);
            const during = await inTx(reader, { worker: 'booking_conversion' }, async (rd) => {
              const q = await rd.query<{ status: string }>(
                'SELECT status FROM core.booking_checkout_hold WHERE id = $1',
                [holdId],
              );
              return q.rows[0]?.status;
            });
            expect(during).toBe('PAYMENT_IN_FLIGHT');
            return r.rows[0]?.r as Json;
          },
        );
        expect(result).toMatchObject({ outcome: 'CONVERTED' });
      } finally {
        await releaseClient(reader);
        await releaseClient(jobClient);
      }
      expect(await holdState(holdId)).toMatchObject({
        status: 'CONVERTED',
        occ_kind: 'TRIP',
        occ_active: true,
      });
      const trips = await tripsOfGuest(g);
      expect(trips).toHaveLength(1);
      expect(await tripOf(trips[0]?.id as string)).toMatchObject({
        status: 'BOOKED',
        active_trip_occupancies: 1,
      });
    },
    LONG,
  );

  it(
    'C6 : webhook en double et lecture du balayage simultanés ⇒ un seul trip, les rejeux renvoient le trip existant',
    async () => {
      const T0 = era(7);
      const w = await world(c, 1, 1);
      const g = w.guests[0] as string;
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = await pose(g, slot, T0);
      await setTerms(holdId, c, slot);
      const { operationId } = await order(g, holdId, w.account, at(T0, 1));
      expect(await applyStatus(operationId, 'SUCCEEDED', at(T0, 4))).toBe('APPLIED');

      const sweeper = await connectAs('app_worker');
      try {
        const sweeperPid = await backendPid(sweeper);
        const box: { pending?: Promise<Json> } = {};
        const first = await inTx(
          worker,
          { worker: 'booking_conversion', virtualNow: at(T0, 5), commit: true },
          async (tx) => {
            const r = await tx.query<{ r: Json }>('SELECT core.booking_convert_payment($1) AS r', [
              operationId,
            ]);
            box.pending = inTx(
              sweeper,
              { worker: 'payment_intent_sweeper', virtualNow: at(T0, 5), commit: true },
              async (s) =>
                (
                  await s.query<{ r: Json }>('SELECT core.booking_record_poll($1) AS r', [
                    operationId,
                  ])
                ).rows[0]?.r as Json,
            );
            // la lecture du balayage attend le verrou du voyageur tenu par la conversion
            await waitUntilBlocked(api, sweeperPid, 'advisory');
            return r.rows[0]?.r as Json;
          },
        );
        expect(first).toMatchObject({ outcome: 'CONVERTED' });
        expect(await box.pending).toMatchObject({ outcome: 'REPLAY', tripId: first.tripId });
        // webhook en double : DUPLICATE, puis rejeu de la conversion
        expect(await applyStatus(operationId, 'SUCCEEDED', at(T0, 6))).toBe('DUPLICATE');
        expect(await convert(operationId, at(T0, 6))).toMatchObject({
          outcome: 'REPLAY',
          tripId: first.tripId,
        });
      } finally {
        await releaseClient(sweeper);
      }
      expect(await tripsOfGuest(g)).toHaveLength(1);
      expect(await dispositions(holdId)).toHaveLength(1);
    },
    LONG,
  );

  it(
    'C7 : deux holds chevauchants payés sur deux véhicules ⇒ un trip ; le second compensé GUEST_OVERLAP (BANK_TRANSFER_REFUND, capacité inconnue)',
    async () => {
      const T0 = era(8);
      // remboursement API non validé pour la carte pendant ce test (ligne propre au moyen)
      await setCapability(
        c,
        'CARD',
        'SUPPORTS_REFUND',
        true,
        T0,
        at(T0, 24 * 60),
        'UNKNOWN',
        'VALIDATED_SANDBOX',
      );
      const w = await world(c, 2, 1);
      const g = w.guests[0] as string;
      const s1 = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const s2 = slotLater(w.vehicles[1] as string, w.orgId, T0);
      const h1 = await pose(g, s1, T0);
      const h2 = await pose(g, s2, T0);
      await setTerms(h1, c, s1);
      await setTerms(h2, c, s2);
      const { operationId: op1 } = await order(g, h1, w.account, at(T0, 1));
      const { operationId: op2 } = await order(g, h2, w.account, at(T0, 1));
      await applyStatus(op1, 'SUCCEEDED', at(T0, 2));
      await applyStatus(op2, 'SUCCEEDED', at(T0, 2));
      expect(await convert(op1, at(T0, 3))).toMatchObject({ outcome: 'CONVERTED' });
      expect(await convert(op2, at(T0, 3))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'GUEST_OVERLAP',
        action: 'BANK_TRANSFER_REFUND',
      });
      expect(await holdState(h2)).toMatchObject({ status: 'COMPENSATED', occ_active: false });
      expect(await activeOn(s2.vehicleId)).toEqual([]);
      expect(await tripsOfGuest(g)).toHaveLength(1);
    },
    LONG,
  );

  it(
    'C8 : hold de revue — aucun paiement avant reviewed_at ; libération concurrente d’une preuve ⇒ conversion xor compensation, jamais un trip sans occupation',
    async () => {
      const T0 = era(9);
      const w = await world(c, 1, 1);
      const g = w.guests[0] as string;
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = await pose(g, slot, T0, true);
      await setTerms(holdId, c, slot);
      const before = await startPayment(g, holdId, w.account, at(T0, 1));
      expect(isFailure(before) && before.code).toBe('BOOKING_UNDER_REVIEW');
      expect(await operations(holdId)).toEqual([]);
      // approbation de la revue à T0 + 30 (travailleur de revue, fixture)
      await inTx(api, { virtualNow: at(T0, 30), commit: true }, (tx) =>
        tx.query('SELECT test_fixture.us024_approve_review($1, $2)', [holdId, REVIEW_TTL_MIN]),
      );
      const t1 = await startPayment(g, holdId, w.account, at(T0, 31));
      if (isFailure(t1)) throw new Error(t1.code);
      // base de la borne d'un hold de revue : reviewed_at + hold_max_total_minutes
      expect(new Date(t1.paymentInFlightUntil as string).toISOString()).toBe(
        at(at(T0, 30), HOLD_MAX_TOTAL_MIN),
      );
      const op = t1.operationId as string;
      await recordOrder(g, holdId, op, `fake-${uuid()}`, at(T0, 31), at(T0, 36));
      await applyStatus(op, 'SUCCEEDED', at(T0, 33));
      const [rel, conv] = await Promise.all([
        release(g, holdId, at(T0, 34)),
        convert(op, at(T0, 34)),
      ]);
      expect(['DEFERRED', 'INVALID_TRANSITION']).toContain(isFailure(rel) ? rel.code : rel);
      expect(conv).toMatchObject({ outcome: 'CONVERTED' });
      const d = await dispositions(holdId);
      expect(d).toHaveLength(1);
      expect(d[0]?.disposition).toBe('CONVERSION');
      expect(await holdState(holdId)).toMatchObject({
        status: 'CONVERTED',
        occ_kind: 'TRIP',
        occ_active: true,
      });
      // la tâche d'expiration ne touche jamais un hold converti
      await expiryJob(at(T0, 120));
      expect((await holdState(holdId)).occ_active).toBe(true);
    },
    LONG,
  );

  it(
    'C13 : preuve tardive après compensation ⇒ aucun trip même créneau libre ; E2 ignorée ; autre opération ⇒ LATE_PAYMENT_AFTER_COMPENSATION',
    async () => {
      const T0 = era(10);
      const w = await world(c, 1, 2);
      const [a, b] = w.guests as [string, string];
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdA = await pose(a, slot, T0);
      await setTerms(holdA, c, slot);
      const { operationId: opA } = await order(a, holdA, w.account, at(T0, 1));
      await expiryJob(at(T0, 10));
      const holdB = await pose(b, slot, at(T0, 11));
      // E1 : HB vivant sur le créneau ⇒ compensation
      await applyStatus(opA, 'SUCCEEDED', at(T0, 12));
      expect(await convert(opA, at(T0, 12))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'SLOT_LOST_AFTER_EXPIRY',
      });
      // HB expire sans paiement : créneau libre
      await expiryJob(at(T0, 22));
      expect((await holdState(holdB)).status).toBe('EXPIRED');
      expect(await activeOn(slot.vehicleId)).toEqual([]);
      // E2 de la même opération (autre livraison) : journalisée, ignorée
      expect(await applyStatus(opA, 'SUCCEEDED', at(T0, 23))).toBe('DUPLICATE');
      expect(await convert(opA, at(T0, 23))).toMatchObject({
        outcome: 'REPLAY',
        disposition: 'COMPENSATION',
      });
      expect(await events(holdA)).toContain('booking.payment.late_ignored');
      // autre opération réussie de A
      const other = await extraOperation(holdA, 'CAPTURE', 2, 'SUCCEEDED', at(T0, 24));
      expect(await convert(other, at(T0, 24))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'LATE_PAYMENT_AFTER_COMPENSATION',
      });
      expect((await holdState(holdA)).status).toBe('COMPENSATED');
      expect(await tripsOfGuest(a)).toEqual([]);
      expect(
        (await dispositions(holdA)).map((d) => [d.operation_id, d.disposition, d.reason]),
      ).toEqual([
        [opA, 'COMPENSATION', 'SLOT_LOST_AFTER_EXPIRY'],
        [other, 'COMPENSATION', 'LATE_PAYMENT_AFTER_COMPENSATION'],
      ]);
      expect(await activeOn(slot.vehicleId)).toEqual([]);
    },
    LONG,
  );

  it(
    'C14 : paiements multiples sur un hold (tentatives 1 et 2, ordre réutilisable, autorisation, rapprochement seul) ⇒ un trip, DUPLICATE_PAYMENT',
    async () => {
      const T0 = era(11);
      // remboursement API non validé pour la carte pendant ce test (ligne propre au moyen)
      await setCapability(
        c,
        'CARD',
        'SUPPORTS_REFUND',
        true,
        T0,
        at(T0, 24 * 60),
        'UNKNOWN',
        'VALIDATED_SANDBOX',
      );
      await setCapability(c, '*', 'SUPPORTS_VOID', true, T0, at(T0, 24 * 60));
      const w = await world(c, 1, 1);
      const g = w.guests[0] as string;
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = await pose(g, slot, T0);
      await setTerms(holdId, c, slot);
      // (b) tentative 1 crue refusée (refus REÇU) ⇒ retour en ACTIVE, une tentative de plus
      const { operationId: a1 } = await order(g, holdId, w.account, at(T0, 1));
      expect(await applyStatus(a1, 'FAILED', at(T0, 2), 'API_RESPONSE')).toBe('APPLIED');
      expect(await paymentFailure(a1, at(T0, 2))).toMatchObject({
        outcome: 'RETRY_ALLOWED',
        paymentAttempts: 1,
      });
      expect(await holdState(holdId)).toMatchObject({
        status: 'ACTIVE',
        payment_in_flight_until: null,
        payment_attempts: 1,
        occ_active: true,
      });
      const t2 = await startPayment(g, holdId, w.account, at(T0, 3));
      expect(t2).toMatchObject({
        outcome: 'NEW_ORDER',
        attemptNo: 2,
        idemSent: `hold:${holdId}:CAPTURE:a2`,
      });
      const a2 = (t2 as Json).operationId as string;
      await recordOrder(g, holdId, a2, `fake-${uuid()}`, at(T0, 3), at(T0, 8));
      await applyStatus(a2, 'SUCCEEDED', at(T0, 4));
      const conv = await convert(a2, at(T0, 4));
      expect(conv).toMatchObject({ outcome: 'CONVERTED' });
      // la tentative 1 avait en fait réussi (statut corrigé par l'ops après getOperation)
      await inTx(api, { commit: true }, (tx) =>
        tx.query(`SELECT test_fixture.us024_force_operation_status($1, 'SUCCEEDED')`, [a1]),
      );
      expect(await convert(a1, at(T0, 5))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'DUPLICATE_PAYMENT',
        action: 'BANK_TRANSFER_REFUND',
        holdUpdated: false,
      });
      // (a) ordre réutilisable payé une seconde fois (webhook)
      const reused = await extraOperation(holdId, 'CAPTURE', 2, 'SUCCEEDED', at(T0, 5));
      expect(await convert(reused, at(T0, 5))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'DUPLICATE_PAYMENT',
      });
      // autorisation seule : VOID (SUPPORTS_VOID validé)
      const auth = await extraOperation(holdId, 'AUTH', 2, 'SUCCEEDED', at(T0, 5));
      expect(await convert(auth, at(T0, 5))).toMatchObject({
        reason: 'DUPLICATE_PAYMENT',
        action: 'VOID',
      });
      // (d) second paiement vu par le rapprochement seulement : disposition_sweeper
      const recon = await extraOperation(holdId, 'CAPTURE', 2, 'SUCCEEDED', at(T0, 6));
      expect(await candidates(atSec(at(T0, 7), 59))).not.toContain(recon);
      expect(await candidates(at(T0, 8))).toContain(recon);
      expect(await repair(recon, at(T0, 8))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'DUPLICATE_PAYMENT',
      });
      expect(await candidates(at(T0, 9))).not.toContain(recon);

      expect(await tripsOfGuest(g)).toHaveLength(1);
      const d = await dispositions(holdId);
      expect(d.filter((x) => x.disposition === 'CONVERSION').map((x) => x.operation_id)).toEqual([
        a2,
      ]);
      expect(d.filter((x) => x.disposition === 'COMPENSATION')).toHaveLength(4);
      expect(new Set(d.map((x) => x.operation_id)).size).toBe(5);
      expect(await holdState(holdId)).toMatchObject({
        status: 'CONVERTED',
        conversion_operation_id: a2,
      });
    },
    LONG,
  );

  it(
    'C17 : conversion en échec 3 fois puis panne ⇒ disposition_sweeper écrit la disposition < 20 min, hold non libéré ; cause persistante ⇒ alerte P1 à 10 min, une fois',
    async () => {
      const T0 = era(12);
      const w = await world(c, 2, 2);
      const [g, h] = w.guests as [string, string];
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = await pose(g, slot, T0);
      await setTerms(holdId, c, slot);
      const { operationId } = await order(g, holdId, w.account, at(T0, 1)); // borne T0 + 8
      await applyStatus(operationId, 'SUCCEEDED', at(T0, 5));
      // trois transactions de conversion annulées (40P01 injecté : annulation complète)
      for (let i = 0; i < 3; i += 1) {
        const r = await workerSql<{ r: Json }>(
          'booking_conversion',
          atSec(at(T0, 5), 10 + i),
          'SELECT core.booking_convert_payment($1) AS r',
          [operationId],
          false,
        );
        expect(r[0]?.r).toMatchObject({ outcome: 'CONVERTED' });
      }
      expect(await dispositions(holdId)).toEqual([]);
      // panne du travailleur de webhooks : la tâche d'expiration ne libère pas le hold (A6)
      await expiryJob(at(T0, 10));
      expect((await holdState(holdId)).status).toBe('PAYMENT_IN_FLIGHT');
      // disposition_repair_after_minutes = 2 après la réussite connue (T0 + 5)
      expect(await candidates(atSec(at(T0, 6), 59))).not.toContain(operationId);
      expect(await candidates(at(T0, 7))).toContain(operationId);
      const repaired = await repair(operationId, at(T0, 7));
      expect(repaired).toMatchObject({ outcome: 'CONVERTED' });
      expect(await dispositions(holdId)).toMatchObject([{ disposition: 'CONVERSION' }]);

      // cause persistante : opération réussie d'un hold de revue non approuvé (impossible par T1)
      const s2 = slotLater(w.vehicles[1] as string, w.orgId, T0);
      const review = await pose(h, s2, at(T0, 20), true);
      await setTerms(review, c, s2);
      const stuck = await extraOperation(review, 'CAPTURE', 1, 'SUCCEEDED', at(T0, 20));
      expect(await repair(stuck, at(T0, 22))).toMatchObject({
        outcome: 'FAILED',
        error: '55000:conversion_review_pending',
        attempts: 1,
        alerted: false,
      });
      expect(await repair(stuck, at(T0, 30))).toMatchObject({
        outcome: 'FAILED',
        attempts: 2,
        alerted: true,
      });
      expect(await repair(stuck, at(T0, 31))).toMatchObject({
        outcome: 'FAILED',
        attempts: 3,
        alerted: false,
      });
      expect(
        (await events(stuck)).filter((t) => t === 'booking.payment.disposition_overdue'),
      ).toHaveLength(1);
      expect(await dispositions(review)).toEqual([]);
      // le hold n'est jamais libéré tant que la disposition manque
      await expiryJob(at(T0, 300));
      expect((await holdState(review)).status).toBe('ACTIVE');
    },
    LONG,
  );

  it(
    'C18 : H1 échu, H2 du même voyageur ; preuve de H1 ⇒ H2 supplanté (CANCEL_ORDER), H1 converti ; paiement sur H2 ⇒ DUPLICATE_PAYMENT ; H2 déjà payé ⇒ DUPLICATE_PAYMENT',
    async () => {
      const T0 = era(13);
      await setCapability(c, '*', 'SUPPORTS_ORDER_CANCEL', true, T0, at(T0, 24 * 60));
      const w = await world(c, 2, 1);
      const g = w.guests[0] as string;
      // variante 1 : H2 en vol avec un ordre vivant, non payé
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const h1 = await pose(g, slot, T0);
      await setTerms(h1, c, slot);
      const { operationId: op1 } = await order(g, h1, w.account, at(T0, 1));
      await expiryJob(at(T0, 10));
      const h2 = await pose(g, slot, at(T0, 11));
      await setTerms(h2, c, slot);
      const { operationId: op2 } = await order(g, h2, w.account, at(T0, 12));
      await applyStatus(op1, 'SUCCEEDED', at(T0, 13));
      expect(await convert(op1, at(T0, 13))).toMatchObject({
        outcome: 'CONVERTED',
        reacquired: true,
      });
      expect(await holdState(h2)).toMatchObject({
        status: 'RELEASED',
        release_reason: 'SUPERSEDED_BY_PAID_HOLD',
        occ_active: false,
      });
      expect(await dispositions(h1)).toMatchObject([{ disposition: 'CONVERSION' }]);
      expect(await commands(h2)).toEqual([
        { idem_plain: `hold:${h2}:CANCEL:${op2}:a1`, status: 'PENDING', operation_id: op2 },
      ]);
      // paiement ultérieur sur H2 : le trip de H1 occupe le créneau ⇒ DUPLICATE_PAYMENT
      await applyStatus(op2, 'SUCCEEDED', at(T0, 14));
      expect(await convert(op2, at(T0, 14))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'DUPLICATE_PAYMENT',
      });
      expect(await tripsOfGuest(g)).toHaveLength(1);

      // variante 2 (autres dates) : H2 déjà payé ⇒ l'opération de H1 est compensée
      const later = slotLater(w.vehicles[1] as string, w.orgId, T0, 10);
      const k1 = await pose(g, later, at(T0, 30));
      await setTerms(k1, c, later);
      const { operationId: q1 } = await order(g, k1, w.account, at(T0, 31));
      await expiryJob(at(T0, 40));
      const k2 = await pose(g, later, at(T0, 41));
      await setTerms(k2, c, later);
      const { operationId: q2 } = await order(g, k2, w.account, at(T0, 42));
      await applyStatus(q2, 'SUCCEEDED', at(T0, 43));
      await applyStatus(q1, 'SUCCEEDED', at(T0, 43));
      expect(await convert(q1, at(T0, 44))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'DUPLICATE_PAYMENT',
      });
      expect(await convert(q2, at(T0, 44))).toMatchObject({ outcome: 'CONVERTED' });
      expect(await tripsOfGuest(g)).toHaveLength(2);
      expect(await activeOn(later.vehicleId)).toEqual(['TRIP']);
    },
    LONG,
  );

  it(
    'C20 : réservation de dernière minute ⇒ START_PASSED, remboursement intégral ; hold de revue approuvé après le début ⇒ aucun paiement',
    async () => {
      const T0 = era(14); // « 13:58 »
      // remboursement API non validé pour la carte pendant ce test (ligne propre au moyen)
      await setCapability(
        c,
        'CARD',
        'SUPPORTS_REFUND',
        true,
        T0,
        at(T0, 24 * 60),
        'UNKNOWN',
        'VALIDATED_SANDBOX',
      );
      const w = await world(c, 2, 2);
      const [g, h] = w.guests as [string, string];
      const slot = slotOf(w.vehicles[0] as string, w.orgId, T0, 2); // début « 14:00 »
      const holdId = await pose(g, slot, T0);
      await setTerms(holdId, c, slot);
      const { operationId } = await order(g, holdId, w.account, at(T0, 1));
      await applyStatus(operationId, 'SUCCEEDED', at(T0, 3)); // « 14:01 »
      expect(await convert(operationId, at(T0, 3))).toMatchObject({
        outcome: 'COMPENSATED',
        reason: 'START_PASSED',
        action: 'BANK_TRANSFER_REFUND',
      });
      expect(await tripsOfGuest(g)).toEqual([]);
      expect(await holdState(holdId)).toMatchObject({ status: 'COMPENSATED', occ_active: false });
      expect(await activeOn(slot.vehicleId)).toEqual([]);
      // remboursement intégral de l'opération : montant total de la capture (jambes rendues en entier)
      const required = await workerSql<{ payload: Json }>(
        'outbox_relay',
        undefined,
        `SELECT payload FROM core.outbox_outbox_event
        WHERE aggregate_id = $1 AND type = 'booking.hold.compensation_required'`,
        [holdId],
        false,
      );
      expect(required[0]?.payload).toMatchObject({
        operation_id: operationId,
        amount_minor: captureOf(c).totalMinor.toString(),
        currency: c.currency,
        reason: 'START_PASSED',
      });

      // hold de revue posé à « 13:00 » pour un début à « 14:00 », approuvé à « 14:05 »
      const s2 = slotOf(w.vehicles[1] as string, w.orgId, at(T0, -58), 60);
      const review = await pose(h, s2, at(T0, -58), true);
      await setTerms(review, c, s2);
      await inTx(api, { virtualNow: at(T0, 7), commit: true }, (tx) =>
        tx.query('SELECT test_fixture.us024_approve_review($1, $2)', [review, REVIEW_TTL_MIN]),
      );
      const r = await startPayment(h, review, w.account, at(T0, 8));
      expect(isFailure(r) && r.raw).toEqual({ code: '55000', constraint: 'payment_start_passed' });
      expect(isFailure(r) && r.code).toBe('START_PASSED');
      expect(await operations(review)).toEqual([]);
    },
    LONG,
  );

  it(
    'C15 (d) / C15 bis (f) : ordre Yappy sans annulation, libération différée ; B reçoit 409 à 7:45 ; payé à 4:59, IPN perdu, lu à 7:50 ⇒ A convertit',
    async () => {
      const T0 = era(15);
      await setCapability(c, 'YAPPY', 'ORDER_TTL_SECONDS', YAPPY_ORDER_TTL_S, T0, at(T0, 24 * 60));
      const w = await world(c, 1, 2);
      const [a, b] = w.guests as [string, string];
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdA = await pose(a, slot, T0);
      await setTerms(holdA, c, slot);
      const t1 = await startPayment(a, holdA, w.account, atSec(T0, 1), 'YAPPY');
      if (isFailure(t1)) throw new Error(t1.code);
      const op = t1.operationId as string;
      // ordre de 5 min ⇒ borne 5:01 + marge = 7:01
      expect(await recordOrder(a, holdA, op, `fake-${uuid()}`, atSec(T0, 5), atSec(T0, 301))).toBe(
        'RECORDED',
      );
      const bound = atSec(T0, 301 + MARGIN_S);
      expect(iso((await holdState(holdA)).payment_in_flight_until)).toBe(bound);
      // libération par A, ordre vivant, aucune annulation validée ⇒ différée, aucune commande
      expect(await release(a, holdA, at(T0, 1))).toBe('DEFERRED');
      expect(await commands(holdA)).toEqual([]);
      expect(await poseOutcome(b, slot, at(T0, 2))).toBe('VEHICLE_UNAVAILABLE');
      // A paie à 4:59 ; IPN perdu. B tente à 7:45 (après la borne, avant borne + sweep_grace_s)
      expect(await poseOutcome(b, slot, atSec(T0, 7 * 60 + 45))).toBe('VEHICLE_UNAVAILABLE');
      await expiryJob(atSec(T0, 7 * 60 + 46));
      expect((await holdState(holdA)).status).toBe('PAYMENT_IN_FLIGHT');
      // le balayage lit « payé » à 7:50 : conversion dans la transaction de la lecture
      const at750 = atSec(T0, 7 * 60 + 50);
      expect(await intentsDue(at750)).toContain(op);
      expect(await applyStatus(op, 'SUCCEEDED', at750, 'POLL')).toBe('APPLIED');
      expect(await recordPoll(op, at750)).toMatchObject({
        outcome: 'CONVERTED',
        reacquired: false,
      });
      expect(await holdState(holdA)).toMatchObject({ status: 'CONVERTED', occ_kind: 'TRIP' });
      expect(await poseOutcome(b, slot, at(T0, 9))).toBe('VEHICLE_UNAVAILABLE');
    },
    LONG,
  );

  it(
    'C15 (e) / C16 : annulation validée ⇒ une seule CANCEL_ORDER quels que soient les rejeux ; libération seulement après confirmation ; paiement concurrent ⇒ conversion ; T2 sur hold échu ⇒ CANCEL_ORDER',
    async () => {
      const T0 = era(16);
      await setCapability(c, '*', 'SUPPORTS_ORDER_CANCEL', true, T0, at(T0, 24 * 60));
      const w = await world(c, 3, 3);
      const [g1, g2, g3] = w.guests as [string, string, string];

      // 1. libération demandée : temps 1 annulé (40P01 injecté) puis rejoué deux fois
      const s1 = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const h1 = await pose(g1, s1, T0);
      await setTerms(h1, c, s1);
      const { operationId: op1 } = await order(g1, h1, w.account, at(T0, 1));
      expect(await release(g1, h1, atSec(at(T0, 1), 30), false)).toBe('DEFERRED'); // annulée
      expect(await commands(h1)).toEqual([]);
      expect(await release(g1, h1, at(T0, 2))).toBe('DEFERRED');
      expect(await release(g1, h1, atSec(at(T0, 2), 10))).toBe('DEFERRED');
      expect(await commands(h1)).toEqual([
        { idem_plain: `hold:${h1}:CANCEL:${op1}:a1`, status: 'PENDING', operation_id: op1 },
      ]);
      // temps 2 avant confirmation : rien
      expect(await releaseCancelled(at(T0, 3))).toBe(0);
      expect((await holdState(h1)).status).toBe('PAYMENT_IN_FLIGHT');
      // confirmation de l'annulation par le PSP (travailleur de commandes) ⇒ temps 2 libère
      await workerSql(
        'payment_command',
        at(T0, 4),
        `UPDATE core.payment_payment_command SET status = 'DONE' WHERE hold_id = $1`,
        [h1],
      );
      expect(await releaseCancelled(at(T0, 4))).toBeGreaterThanOrEqual(1);
      expect(await holdState(h1)).toMatchObject({
        status: 'RELEASED',
        occ_active: false,
        deactivated_reason: 'HOLD_RELEASED',
      });
      expect(await releaseCancelled(at(T0, 5))).toBe(0);

      // 2. paiement concurrent de l'annulation ⇒ conversion ; le temps 2 ne fait rien ensuite
      const s2 = slotLater(w.vehicles[1] as string, w.orgId, T0);
      const h2 = await pose(g2, s2, T0);
      await setTerms(h2, c, s2);
      const { operationId: op2 } = await order(g2, h2, w.account, at(T0, 1));
      expect(await release(g2, h2, at(T0, 2))).toBe('DEFERRED');
      await applyStatus(op2, 'SUCCEEDED', at(T0, 3));
      expect(await convert(op2, at(T0, 3))).toMatchObject({ outcome: 'CONVERTED' });
      await workerSql(
        'payment_command',
        at(T0, 4),
        `UPDATE core.payment_payment_command SET status = 'DONE' WHERE hold_id = $1`,
        [h2],
      );
      await releaseCancelled(at(T0, 4));
      expect(await holdState(h2)).toMatchObject({ status: 'CONVERTED', occ_active: true });
      expect(await commands(h2)).toHaveLength(1);

      // 3. T2 arrivée après l'expiration (appel plus long que la borne) ⇒ CANCEL_ORDER, une seule
      const s3 = slotLater(w.vehicles[2] as string, w.orgId, T0);
      const h3 = await pose(g3, s3, T0);
      await setTerms(h3, c, s3);
      const t1 = await startPayment(g3, h3, w.account, at(T0, 1));
      if (isFailure(t1)) throw new Error(t1.code);
      const op3 = t1.operationId as string;
      await expiryJob(atSec(at(T0, HOLD_MAX_TOTAL_MIN + 1), 30));
      expect((await holdState(h3)).status).toBe('EXPIRED');
      const ref = `fake-${uuid()}`;
      expect(await recordOrder(g3, h3, op3, ref, at(T0, 22), at(T0, 25))).toBe('EXPIRED');
      expect(await recordOrder(g3, h3, op3, ref, at(T0, 23), at(T0, 25))).toBe('EXPIRED');
      expect(await commands(h3)).toEqual([
        { idem_plain: `hold:${h3}:CANCEL:${op3}:a1`, status: 'PENDING', operation_id: op3 },
      ]);
      expect((await operations(h3))[0]?.status).toBe('SUBMITTED');
    },
    LONG,
  );

  it(
    'rôles : conversion et balayages réservés à leurs travailleurs ; aucune fonction de conversion pour app_api ni app_anon',
    async () => {
      const T0 = era(17);
      const op = uuid();
      // travailleur hors liste
      for (const fn of [
        'SELECT core.booking_convert_payment($1)',
        'SELECT core.booking_record_payment_failure($1)',
        'SELECT core.booking_record_poll($1)',
        'SELECT core.booking_disposition_repair($1)',
        'SELECT core.booking_conversion_eligibility($1)',
      ]) {
        await expect(workerSql('trip_lifecycle', T0, fn, [op], false), fn).rejects.toMatchObject({
          code: '42501',
        });
      }
      await expect(
        workerSql(
          'booking_conversion',
          T0,
          'SELECT * FROM core.booking_intents_due(10)',
          [],
          false,
        ),
      ).rejects.toMatchObject({ code: '42501' });
      // app_api : aucun EXECUTE
      for (const fn of [
        'SELECT core.booking_convert_payment($1)',
        'SELECT core.booking_conversion_eligibility($1)',
        'SELECT core.booking_open_compensation($1, $1, $2)',
      ]) {
        await inTx(api, {}, async (tx) => {
          const params = fn.includes('$2') ? [op, 'DUPLICATE_PAYMENT'] : [op];
          await expect(tx.query(fn, params), fn).rejects.toMatchObject({ code: '42501' });
        });
      }
      // app_anon : rien
      const anon = await connectAs('app_anon');
      try {
        await expect(
          anon.query('SELECT core.booking_cmd_start_payment($1, $1, $2)', [op, 'CARD']),
        ).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await releaseClient(anon);
      }
      // travailleur d'expiration : n'écrit pas de commande
      await expect(
        workerSql(
          'hold_expiry',
          T0,
          `INSERT INTO core.payment_payment_command (id, operation_kind, idem_plain, operation_id, hold_id, country_code, partition_key)
         VALUES ($1, 'CANCEL_ORDER', 'x', $1, $1, $2, 'x')`,
          [op, c.country],
          false,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    },
    LONG,
  );
});
