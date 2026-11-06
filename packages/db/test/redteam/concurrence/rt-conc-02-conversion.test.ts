/**
 * US-049 — red team « concurrence », conversion hold → réservation (19 US-049 critère 4 ;
 * 17 §2.5 étapes 3 à 5 ; C6, C13, C14, C15, C18 ; migrations 0040, 0041).
 *
 * Attendus (17 §2.5, 19 US-024) : la conversion est atomique et rejouable (la disposition est la
 * clé primaire d'exclusion mutuelle : une opération a UNE disposition), un hold payé ne peut être
 * ni expiré ni repris par un tiers, un second paiement du même hold est compensé
 * (`DUPLICATE_PAYMENT`), il n'existe jamais deux occupations actives sur un véhicule, ni deux
 * trips pour un hold. Chaque test affirme que l'attaque est BLOQUÉE ; rouge = faille.
 * Rôles de production seulement ; en USD (PA) et en PYG (PY). Montants de capture : vecteurs TJ01
 * (USD) et TJ08a (PYG) de docs/specs/08 (oracle `@rueda/money/golden-vectors`).
 *
 * Horloge : la conversion lance l'expiration et les balayages sur toute la base ; ce fichier tourne
 * donc dans le groupe isolé « l0-redteam-concurrence » (vitest.l0.config.ts), après tous les autres,
 * à des instants virtuels de 2047 qu'aucune autre suite n'utilise.
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commandCallSql, translateDbError } from '../../../src/index.ts';
import type { SessionContext } from '../../../src/index.ts';
import { connectAs, releaseClient } from '../../../src/testing/index.ts';
import { COUNTRIES, inTx } from '../../support/avl.ts';
import type { CountryCase, Worker } from '../../support/avl.ts';
import { Barrier, ensureParties, registerVehicles } from '../../support/concurrency.ts';
import { legsJson } from '../../support/pay.ts';
import { at, LONG, pose, slotBetween, uuid } from './support.ts';
import type { Slot } from './support.ts';

const set = loadGoldenVectors();
const CAPTURE = Object.fromEntries(
  [legVector(set, 'TJ01'), legVector(set, 'TJ08a')].map((v) => [v.currency, v]),
);
const captureOf = (c: CountryCase): ReturnType<typeof legVector> => {
  const v = CAPTURE[c.currency];
  if (v === undefined) throw new Error(`aucun vecteur TJ de capture en ${c.currency}`);
  return v;
};

const ERA0 = Date.parse('2047-01-05T10:00:00.000Z');
const BLOCKING_FROM = new Date(ERA0 - 86_400_000).toISOString();
const era = (n: number): string => new Date(ERA0 + n * 3 * 86_400_000).toISOString();
const DAY = 86_400_000;

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

interface Party {
  readonly orgId: string;
  readonly vehicles: string[];
  readonly guests: string[];
  readonly account: string;
}

async function party(c: CountryCase, vehicles: number, guests: number): Promise<Party> {
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

/** Capacités BLOQUANTES du FAKE validées pour le pays (sans elles T1 refuse tout, fail-closed). */
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

/** Créneau de deux jours commençant deux jours après `base`. */
const slotLater = (vehicleId: string, orgId: string, base: string): Slot => {
  const start = Date.parse(base) + 2 * DAY;
  return slotBetween(
    vehicleId,
    orgId,
    new Date(start).toISOString(),
    new Date(start + 2 * DAY).toISOString(),
  );
};

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
): Promise<T> {
  return inTx(api, { virtualNow: when, commit: true }, async (tx) => {
    const { text, values } = commandCallSql(ctx, fn, args);
    const r = await tx.query<{ result: T }>(text, values);
    return r.rows[0]?.result as T;
  });
}

/** T1 puis T2 : l'ordre expire 5 min après T1. Renvoie l'opération. */
async function order(guest: string, holdId: string, account: string, t1: string): Promise<string> {
  const ctx: SessionContext = { kind: 'GUEST', actorId: guest };
  const started = await guestCall<Json>(
    ctx,
    'core.booking_cmd_start_payment',
    [
      { value: holdId, type: 'uuid' },
      { value: account, type: 'uuid' },
      { value: 'CARD', type: 'text' },
    ],
    t1,
  );
  expect(started.outcome).toBe('NEW_ORDER');
  const operationId = started.operationId as string;
  const recorded = await guestCall<string>(
    ctx,
    'core.booking_cmd_record_order',
    [
      { value: holdId, type: 'uuid' },
      { value: operationId, type: 'uuid' },
      { value: `fake-${uuid()}`, type: 'text' },
      { value: at(t1, 5), type: 'timestamptz' },
    ],
    t1,
  );
  expect(recorded).toBe('RECORDED');
  return operationId;
}

async function workerSql<T extends pg.QueryResultRow>(
  client: pg.ClientBase,
  name: Worker,
  when: string | undefined,
  sql: string,
  params: unknown[],
  commit = true,
): Promise<T[]> {
  return inTx(
    client,
    { worker: name, ...(when !== undefined ? { virtualNow: when } : {}), commit },
    async (tx) => (await tx.query<T>(sql, params)).rows,
  );
}

const applySucceeded = async (operationId: string, when: string): Promise<string> =>
  (
    await workerSql<{ outcome: string }>(
      worker,
      'webhook_ingest',
      when,
      'SELECT core.payment_cmd_apply_operation_status($1, $2, $3, NULL, NULL) AS outcome',
      [operationId, 'SUCCEEDED', 'WEBHOOK'],
    )
  )[0]?.outcome as string;

const convertOn = async (client: pg.ClientBase, operationId: string, when: string): Promise<Json> =>
  (
    await workerSql<{ r: Json }>(
      client,
      'booking_conversion',
      when,
      'SELECT core.booking_convert_payment($1) AS r',
      [operationId],
    )
  )[0]?.r as Json;

async function extraOperation(holdId: string, attemptNo: number, when: string): Promise<string> {
  const id = uuid();
  await inTx(api, { virtualNow: when, commit: true }, (tx) =>
    tx.query('SELECT test_fixture.us024_extra_operation($1, $2, $3, $4, $5)', [
      id,
      holdId,
      'CAPTURE',
      attemptNo,
      'SUCCEEDED',
    ]),
  );
  return id;
}

/** `n` appels simultanés (une session `app_worker` chacun, départ commun par barrière). */
async function simultaneously<T>(
  n: number,
  run: (client: pg.Client, i: number) => Promise<T>,
): Promise<T[]> {
  const observer = await connectAs('app_api');
  const sessions = await Promise.all(Array.from({ length: n }, () => connectAs('app_worker')));
  try {
    const barrier = await Barrier.open(observer);
    const runs = sessions.map(async (session, i) => {
      await barrier.wait(session);
      return run(session, i);
    });
    try {
      await barrier.waitForWaiters(n);
    } finally {
      await barrier.release();
    }
    return await Promise.all(runs);
  } finally {
    await Promise.all([...sessions, observer].map((s) => releaseClient(s)));
  }
}

const read = async <T extends pg.QueryResultRow>(sql: string, params: unknown[]): Promise<T[]> =>
  workerSql<T>(worker, 'booking_conversion', undefined, sql, params, false);

const tripsOfHold = (holdId: string): Promise<{ id: string; status: string }[]> =>
  read(`SELECT id, status FROM core.booking_trip WHERE source_hold_id = $1`, [holdId]);

const activeOn = (vehicleId: string): Promise<{ kind: string; ref_id: string | null }[]> =>
  read(`SELECT kind, ref_id FROM core.booking_vehicle_occupancy WHERE vehicle_id = $1 AND active`, [
    vehicleId,
  ]);

const holdStatus = async (holdId: string): Promise<string | undefined> =>
  (
    await read<{ status: string }>(`SELECT status FROM core.booking_checkout_hold WHERE id = $1`, [
      holdId,
    ])
  )[0]?.status;

const dispositionsOf = (
  holdId: string,
): Promise<{ operation_id: string; disposition: string; reason: string | null }[]> =>
  read(
    `SELECT d.operation_id, d.disposition, c.reason
       FROM core.booking_payment_disposition d
       LEFT JOIN core.booking_hold_compensation c ON c.id = d.hold_compensation_id
      WHERE d.hold_id = $1 ORDER BY d.decided_at, d.operation_id`,
    [holdId],
  );

describe.each(COUNTRIES)('US-049 red team concurrence — conversion ($country, $currency)', (c) => {
  beforeAll(async () => {
    api = await connectAs('app_api');
    try {
      await validateAllBlocking(c);
    } finally {
      await releaseClient(api);
    }
  });

  it(
    'RT-CONC-10 : la même preuve est convertie par 6 sessions simultanées ⇒ exactement un CONVERTED, cinq REPLAY ; un trip, une occupation TRIP, une disposition',
    async () => {
      for (let round = 0; round < 2; round++) {
        const T0 = era(round);
        const w = await party(c, 1, 1);
        const guest = w.guests[0] as string;
        const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
        const holdId = (await pose(api, guest, slot, T0)).holdId as string;
        await setTerms(holdId, c, slot);
        const op = await order(guest, holdId, w.account, at(T0, 1));
        expect(await applySucceeded(op, at(T0, 3))).toBe('APPLIED');

        const outcomes = await simultaneously(6, (session) => convertOn(session, op, at(T0, 4)));
        const tally: Record<string, number> = {};
        for (const o of outcomes)
          tally[o.outcome as string] = (tally[o.outcome as string] ?? 0) + 1;
        expect(tally).toEqual({ CONVERTED: 1, REPLAY: 5 });
        expect(await tripsOfHold(holdId)).toHaveLength(1);
        expect(await holdStatus(holdId)).toBe('CONVERTED');
        expect((await activeOn(slot.vehicleId)).map((o) => o.kind)).toEqual(['TRIP']);
        expect(await dispositionsOf(holdId)).toEqual([
          { operation_id: op, disposition: 'CONVERSION', reason: null },
        ]);
      }
    },
    LONG,
  );

  it(
    'RT-CONC-11 : deux paiements réussis du même hold convertis en même temps ⇒ un seul trip, l’autre opération compensée DUPLICATE_PAYMENT',
    async () => {
      const T0 = era(3);
      const w = await party(c, 1, 1);
      const guest = w.guests[0] as string;
      const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
      const holdId = (await pose(api, guest, slot, T0)).holdId as string;
      await setTerms(holdId, c, slot);
      const op1 = await order(guest, holdId, w.account, at(T0, 1));
      await applySucceeded(op1, at(T0, 3));
      const op2 = await extraOperation(holdId, 2, at(T0, 3));

      const ops = [op1, op2];
      const outcomes = await simultaneously(2, (session, i) =>
        convertOn(session, ops[i] as string, at(T0, 4)),
      );
      expect(outcomes.map((o) => o.outcome).sort()).toEqual(['COMPENSATED', 'CONVERTED']);
      expect(await tripsOfHold(holdId)).toHaveLength(1);
      expect((await activeOn(slot.vehicleId)).map((o) => o.kind)).toEqual(['TRIP']);
      const dispo = await dispositionsOf(holdId);
      expect(dispo.map((d) => d.disposition).sort()).toEqual(['COMPENSATION', 'CONVERSION']);
      expect(dispo.find((d) => d.disposition === 'COMPENSATION')?.reason).toBe('DUPLICATE_PAYMENT');
    },
    LONG,
  );

  it(
    'RT-CONC-12 : hold payé mais non converti, bien après expires_at ⇒ un tiers ne peut pas le reprendre ; pose rivale et conversion simultanées ⇒ jamais deux occupants, jamais trip ET rival',
    async () => {
      for (let round = 0; round < 3; round++) {
        const T0 = era(4 + round);
        const w = await party(c, 1, 2);
        const [guest, rival] = w.guests as [string, string];
        const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
        const holdId = (await pose(api, guest, slot, T0)).holdId as string;
        await setTerms(holdId, c, slot);
        const op = await order(guest, holdId, w.account, at(T0, 1));
        await applySucceeded(op, at(T0, 3));

        // 30 min plus tard : bien après expires_at (10 min) et payment_in_flight_until
        const late = at(T0, 30);
        if (round === 0) {
          // pose rivale seule : le hold payé n'est pas expiré par la pose d'un tiers
          const alone = await pose(api, rival, slot, late);
          expect(alone.code).toBe('VEHICLE_UNAVAILABLE');
          expect(await holdStatus(holdId)).not.toBe('EXPIRED');
        }
        // pose rivale et conversion en même temps
        const observer = await connectAs('app_api');
        const apiSession = await connectAs('app_api');
        const workerSession = await connectAs('app_worker');
        try {
          const barrier = await Barrier.open(observer);
          const racing = [
            (async () => {
              await barrier.wait(apiSession);
              return pose(apiSession, rival, slot, late);
            })(),
            (async () => {
              await barrier.wait(workerSession);
              return convertOn(workerSession, op, late);
            })(),
          ] as const;
          try {
            await barrier.waitForWaiters(2);
          } finally {
            await barrier.release();
          }
          const [rivalOutcome, converted] = await Promise.all(racing);
          const trips = await tripsOfHold(holdId);
          const occupants = await activeOn(slot.vehicleId);
          expect(occupants.length, 'occupants actifs').toBe(1);
          expect(trips.length <= 1).toBe(true);
          // le trip existe si et seulement si le rival n'a pas obtenu le créneau
          expect(
            trips.length === 1,
            `trip=${trips.length} rival=${rivalOutcome.code ?? 'OK'}`,
          ).toBe(rivalOutcome.code !== undefined);
          if (trips.length === 1) expect(converted.outcome).toBe('CONVERTED');
          else expect(converted.outcome).toBe('COMPENSATED');
        } finally {
          await Promise.all([observer, apiSession, workerSession].map((s) => releaseClient(s)));
        }
      }
    },
    LONG,
  );

  it(
    'RT-CONC-13 : libération du hold par le voyageur et conversion simultanées ⇒ état cohérent (trip ⇔ CONVERTED), au plus une occupation active',
    async () => {
      for (let round = 0; round < 3; round++) {
        const T0 = era(8 + round);
        const w = await party(c, 1, 1);
        const guest = w.guests[0] as string;
        const slot = slotLater(w.vehicles[0] as string, w.orgId, T0);
        const holdId = (await pose(api, guest, slot, T0)).holdId as string;
        await setTerms(holdId, c, slot);
        const op = await order(guest, holdId, w.account, at(T0, 1));
        await applySucceeded(op, at(T0, 3));

        const observer = await connectAs('app_api');
        const apiSession = await connectAs('app_api');
        const workerSession = await connectAs('app_worker');
        try {
          const barrier = await Barrier.open(observer);
          const racing = [
            (async () => {
              await barrier.wait(apiSession);
              return guestReleaseOutcome(apiSession, guest, holdId, at(T0, 4));
            })(),
            (async () => {
              await barrier.wait(workerSession);
              return convertOn(workerSession, op, at(T0, 4));
            })(),
          ] as const;
          try {
            await barrier.waitForWaiters(2);
          } finally {
            await barrier.release();
          }
          await Promise.all(racing);
        } finally {
          await Promise.all([observer, apiSession, workerSession].map((s) => releaseClient(s)));
        }
        const trips = await tripsOfHold(holdId);
        const status = await holdStatus(holdId);
        const occupants = await activeOn(slot.vehicleId);
        expect(trips.length).toBeLessThanOrEqual(1);
        expect(occupants.length).toBeLessThanOrEqual(1);
        expect(trips.length === 1, `statut ${status}`).toBe(status === 'CONVERTED');
        if (trips.length === 1) expect(occupants.map((o) => o.kind)).toEqual(['TRIP']);
        else expect(occupants.some((o) => o.kind === 'TRIP')).toBe(false);
        // jamais un trip pour un hold libéré : payer puis libérer ne fait pas un trip sans disposition
        const dispo = await dispositionsOf(holdId);
        expect(dispo.filter((d) => d.disposition === 'CONVERSION')).toHaveLength(trips.length);
      }
    },
    LONG,
  );
});

async function guestReleaseOutcome(
  client: pg.ClientBase,
  guest: string,
  holdId: string,
  when: string,
): Promise<string> {
  try {
    return await inTx(client, { virtualNow: when, commit: true }, async (tx) => {
      const { text, values } = commandCallSql(
        { kind: 'GUEST', actorId: guest },
        'core.booking_cmd_release_own_hold',
        [{ value: holdId, type: 'uuid' }],
      );
      const r = await tx.query<{ result: string }>(text, values);
      return r.rows[0]?.result ?? '';
    });
  } catch (error) {
    return translateDbError(error).code;
  }
}
