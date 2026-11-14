/**
 * L0-06 (17 §11, tableau L0, point 6) — passe de C2, C5 et C15 **sans horloge virtuelle** (suite N-17
 * de la porte du lot 0, US-045). C1 tourne déjà sur l'horloge réelle (L0-02) ; ce fichier complète la
 * passe exigée par 17 §1.3 point 2 bis : « une passe de C1, C2, C5 et C15 tourne sans horloge
 * virtuelle (barrières seulement) sur la fonction de production `clock_timestamp()` ».
 *
 * Attendus : tableau « Plan de test de concurrence » de 17 §2.5, mêmes issues que la passe virtuelle
 * (l0-us024-conversion.test.ts) — jamais le code testé :
 * - C2 : la tâche d'expiration tourne pendant une conversion verrouillée ⇒ elle saute le hold, trip
 *   `BOOKED` avec occupation `TRIP` active, I-OCC vrai ;
 * - C5 : B tente un hold pendant que le hold de A est `PAYMENT_IN_FLIGHT` (après `expires_at`, avant
 *   `payment_in_flight_until`) ⇒ B reçoit `409` (`VEHICLE_UNAVAILABLE`), le hold de A n'est pas expiré ;
 * - C15 (a) : appel PSP lent qui franchit `expires_at`, la tâche d'expiration tourne pendant l'appel ⇒
 *   hold non expiré (borne provisoire), puis conversion ;
 * - C15 (c) : hold déjà échu au moment de T1 ⇒ aucun appel PSP (`HOLD_EXPIRED`, aucune opération).
 *
 * Horloge : AUCUN `virtualNow` ; chaque transaction vérifie que `app.virtual_now` est vide et que
 * `platform.now()` suit `clock_timestamp()`. Les holds échoient en temps réel : ils sont posés
 * pendant une fenêtre de quelques secondes où `hold_ttl_minutes` vaut 1 min (fixture 9962, version
 * de paramètre ordinaire, fermée d'emblée), puis le test attend réellement l'échéance (≈ 1 min par
 * pays). Les capacités bloquantes du FAKE sont validées à partir de l'instant réel puis refermées
 * (UNKNOWN) à la fin du fichier, comme l0-us024 le fait dans ses périodes virtuelles.
 *
 * Rôles de production seulement (assertion L0-05 par `connectAs`) : app_api (voyageurs, commandes
 * par `commandCallSql`), app_worker (booking_conversion, hold_expiry, webhook_ingest). En USD (PA)
 * et en PYG (PY). Fichier isolé (projet `l0-concurrence`) : la tâche d'expiration porte sur toute
 * la base, et aucun autre fichier ne pose de hold pendant la fenêtre de 9962.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commandCallSql, translateDbError } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase, Slot, Worker } from '../support/avl.ts';
import { ensureParties, placeHoldCommand, registerVehicles } from '../support/concurrency.ts';
import { legsJson } from '../support/pay.ts';

/** Fenêtre de la fixture 9962 (s) : toutes les poses du pays y tiennent. */
const SHORT_TTL_WINDOW_S = 20;
/** `hold_ttl_minutes` dans la fenêtre (9962) : 1 min. */
const SHORT_TTL_MS = 60_000;
/** Attente réelle maximale de l'échéance (marge sur `SHORT_TTL_MS`). */
const EXPIRY_WAIT_MAX_MS = 120_000;
const LONG = 240_000;
/** Ordre du PSP de 5 min (comme la passe virtuelle : `order(…, orderMin = 5)`). */
const ORDER_TTL_MS = 5 * 60_000;

const set = loadGoldenVectors();
const CAPTURE = Object.fromEntries(
  [legVector(set, 'TJ01'), legVector(set, 'TJ08a')].map((v) => [v.currency, v]),
);
const captureOf = (c: CountryCase): ReturnType<typeof legVector> => {
  const v = CAPTURE[c.currency];
  if (v === undefined) throw new Error(`aucun vecteur TJ de capture en ${c.currency}`);
  return v;
};

type Json = Record<string, unknown>;
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

let api: pg.Client;
let worker: pg.Client;

/**
 * Horloge réelle exigée dans la transaction (17 §1.3 point 2 bis, L0-06) : aucun `app.virtual_now`,
 * et `platform.now()` à moins de 5 s de l'horloge du client (même hôte en CI).
 */
async function expectRealClock(tx: pg.ClientBase): Promise<void> {
  const before = Date.now();
  const r = await tx.query<{ virtual: string | null; now: Date }>(
    `SELECT NULLIF(pg_catalog.current_setting('app.virtual_now', true), '') AS virtual,
            platform.now() AS now`,
  );
  expect(r.rows[0]?.virtual ?? null).toBeNull();
  expect(Math.abs((r.rows[0]?.now as Date).getTime() - before)).toBeLessThan(5_000);
}

/** Transaction validée en horloge réelle (aucun `virtualNow`), contexte de travailleur éventuel. */
async function realTx<T>(
  client: pg.ClientBase,
  name: Worker | undefined,
  fn: (tx: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return inTx(
    client,
    { ...(name === undefined ? {} : { worker: name }), commit: true },
    async (tx) => {
      await expectRealClock(tx);
      return fn(tx);
    },
  );
}

async function serverNow(): Promise<Date> {
  // hors transaction de test : aucun app.virtual_now, platform.now() = horloge réelle
  const r = await api.query<{ now: Date }>('SELECT platform.now() AS now');
  return r.rows[0]?.now as Date;
}

/** Capacités bloquantes du catalogue (US-061) pour (FAKE, pays), à partir de `from`. */
async function setBlocking(c: CountryCase, status: 'VALIDATED_SANDBOX' | 'UNKNOWN'): Promise<void> {
  await inTx(api, { commit: true }, async (tx) => {
    const { rows } = await tx.query<{ capability: string; kind: string }>(
      `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
    );
    for (const r of rows) {
      const value = r.kind === 'bool' ? true : r.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';
      await tx.query(
        `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', $2, $3::jsonb, $4,
                                                  platform.now())`,
        [c.country, r.capability, JSON.stringify(value), status],
      );
    }
  });
}

interface World {
  readonly orgId: string;
  readonly vehicles: string[];
  readonly guests: string[];
  readonly account: string;
}

async function world(c: CountryCase, n: number): Promise<World> {
  const orgId = uuid();
  const vehicles = Array.from({ length: n }, () => uuid());
  const guests = Array.from({ length: n + 1 }, () => uuid());
  const account = await inTx(api, { commit: true }, async (tx) => {
    await ensureParties(tx, guests, orgId, c);
    await registerVehicles(tx, vehicles, orgId, c);
    const r = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
      c.country,
    ]);
    return r.rows[0]?.id as string;
  });
  return { orgId, vehicles, guests, account };
}

/** Créneau futur de deux jours (période commerciale), loin de l'instant réel. */
function slotOf(vehicleId: string, orgId: string, startIso: string): Slot {
  const start = new Date(startIso);
  return {
    vehicleId,
    orgId,
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
    bufferHours: 2,
  };
}

async function pose(g: string, slot: Slot): Promise<string> {
  return realTx(api, undefined, (tx) => placeHoldCommand(tx, { slot, guestId: g }));
}

async function poseOutcome(g: string, slot: Slot): Promise<string> {
  try {
    await pose(g, slot);
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

/** T1 (`booking_cmd_start_payment`) par le voyageur, en horloge réelle. */
async function startPayment(g: string, holdId: string, account: string): Promise<Json | Failure> {
  try {
    return await realTx(api, undefined, async (tx) => {
      const { text, values } = commandCallSql(
        { kind: 'GUEST', actorId: g },
        'core.booking_cmd_start_payment',
        [
          { value: holdId, type: 'uuid' },
          { value: account, type: 'uuid' },
          { value: 'CARD', type: 'text' },
        ],
      );
      const r = await tx.query<{ result: Json }>(text, values);
      return r.rows[0]?.result as Json;
    });
  } catch (error) {
    return failure(error);
  }
}

/** T2 (`booking_cmd_record_order`) : ordre créé chez le PSP, échéance `orderMin` minutes réelles. */
async function recordOrder(g: string, holdId: string, operationId: string): Promise<string> {
  return realTx(api, undefined, async (tx) => {
    const { text, values } = commandCallSql(
      { kind: 'GUEST', actorId: g },
      'core.booking_cmd_record_order',
      [
        { value: holdId, type: 'uuid' },
        { value: operationId, type: 'uuid' },
        { value: `fake-${uuid()}`, type: 'text' },
        { value: new Date(Date.now() + ORDER_TTL_MS).toISOString(), type: 'timestamptz' },
      ],
    );
    const r = await tx.query<{ result: string }>(text, values);
    return r.rows[0]?.result as string;
  });
}

async function proof(operationId: string): Promise<string> {
  const rows = await realTx(
    worker,
    'webhook_ingest',
    async (tx) =>
      (
        await tx.query<{ outcome: string }>(
          `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK',
                  test_fixture.us049_signed_webhook($1, 'SUCCEEDED'), NULL) AS outcome`,
          [operationId],
        )
      ).rows,
  );
  return rows[0]?.outcome as string;
}

async function expiryJob(client: pg.ClientBase = worker): Promise<number> {
  return realTx(client, 'hold_expiry', async (tx) => {
    await tx.query(`SET LOCAL statement_timeout = '10s'`);
    const q = await tx.query<{ n: number }>('SELECT core.booking_expire_due_holds(10000) AS n');
    return q.rows[0]?.n ?? -1;
  });
}

interface HoldState {
  status: string;
  expires_at: Date;
  payment_in_flight_until: Date | null;
  occ_kind: string;
  occ_active: boolean;
}

async function holdState(holdId: string): Promise<HoldState> {
  return inTx(worker, { worker: 'booking_conversion' }, async (tx) => {
    const r = await tx.query<HoldState>(
      `SELECT h.status, h.expires_at, h.payment_in_flight_until, o.kind AS occ_kind,
              o.active AS occ_active
         FROM core.booking_checkout_hold h
         JOIN core.booking_vehicle_occupancy o ON o.id = h.occupancy_id
        WHERE h.id = $1`,
      [holdId],
    );
    const row = r.rows[0];
    if (row === undefined) throw new Error(`hold ${holdId} invisible`);
    return row;
  });
}

async function tripOfGuest(guestId: string): Promise<Json[]> {
  return inTx(
    worker,
    { worker: 'booking_conversion' },
    async (tx) =>
      (
        await tx.query<Json>(
          `SELECT t.status,
                (SELECT count(*)::int FROM core.booking_vehicle_occupancy o
                  WHERE o.kind = 'TRIP' AND o.active AND o.ref_id = t.id) AS active_trip_occupancies
           FROM core.booking_trip t WHERE t.guest_user_id = $1`,
          [guestId],
        )
      ).rows,
  );
}

async function operationsOf(holdId: string): Promise<number> {
  return inTx(worker, { worker: 'booking_conversion' }, async (tx) => {
    const r = await tx.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM core.payment_payment_operation WHERE hold_id = $1',
      [holdId],
    );
    return r.rows[0]?.n ?? -1;
  });
}

/** Attente RÉELLE (aucune horloge virtuelle) jusqu'à ce que `platform.now()` dépasse `instant`. */
async function waitPast(instant: Date): Promise<void> {
  const deadline = Date.now() + EXPIRY_WAIT_MAX_MS;
  for (;;) {
    if ((await serverNow()).getTime() > instant.getTime() + 1000) return;
    if (Date.now() > deadline)
      throw new Error(`échéance réelle non atteinte : ${instant.toISOString()}`);
    await sleep(1000);
  }
}

beforeAll(async () => {
  api = await connectAs('app_api');
  worker = await connectAs('app_worker');
});

afterAll(async () => {
  try {
    for (const c of COUNTRIES) await setBlocking(c, 'UNKNOWN');
  } finally {
    await releaseClient(worker);
    await releaseClient(api);
  }
});

describe.each(COUNTRIES)(
  'L0-06 — C2, C5, C15 sans horloge virtuelle ($country, $currency)',
  (c) => {
    it(
      'mêmes issues que la passe virtuelle : C2 trip BOOKED, C5 409 et hold intact, C15 (a) hold protégé puis converti, C15 (c) aucun appel PSP',
      async () => {
        await setBlocking(c, 'VALIDATED_SANDBOX');
        const w = await world(c, 4);
        const [gC2, gC5, gC15a, gC15c, gB] = w.guests as [string, string, string, string, string];
        const [vC2, vC5, vC15a, vC15c] = w.vehicles as [string, string, string, string];
        // créneaux bien après l'instant réel : seule l'échéance du hold compte
        const start = new Date((await serverNow()).getTime() + 30 * 86_400_000).toISOString();
        const slots = {
          c2: slotOf(vC2, w.orgId, start),
          c5: slotOf(vC5, w.orgId, start),
          c15a: slotOf(vC15a, w.orgId, start),
          c15c: slotOf(vC15c, w.orgId, start),
        };

        // fenêtre courte de 9962 (hold_ttl_minutes = 1), puis poses par la commande réelle
        const windowEnd = await realTx(api, undefined, async (tx) => {
          const r = await tx.query<{ until: Date }>(
            'SELECT test_fixture.us045_short_hold_ttl($1, $2) AS until',
            [c.country, SHORT_TTL_WINDOW_S],
          );
          return r.rows[0]?.until as Date;
        });
        const hC2 = await pose(gC2, slots.c2);
        const hC5 = await pose(gC5, slots.c5);
        const hC15a = await pose(gC15a, slots.c15a);
        const hC15c = await pose(gC15c, slots.c15c);
        expect((await serverNow()).getTime()).toBeLessThan(windowEnd.getTime());
        const states = await Promise.all([hC2, hC5, hC15a, hC15c].map((h) => holdState(h)));
        for (const s of states) {
          expect(s.status).toBe('ACTIVE');
          // l'échéance vient de la commande réelle, sur l'horloge réelle (≈ 1 min)
          expect(s.expires_at.getTime() - Date.now()).toBeLessThanOrEqual(SHORT_TTL_MS + 5_000);
        }
        for (const [h, s] of [
          [hC2, slots.c2],
          [hC5, slots.c5],
          [hC15a, slots.c15a],
          [hC15c, slots.c15c],
        ] as const) {
          await setTerms(h, c, s);
        }

        // T1 avant l'échéance (C2, C5, C15 a) : PAYMENT_IN_FLIGHT, borne provisoire au-delà
        const ops: Record<string, string> = {};
        for (const [g, h] of [
          [gC2, hC2],
          [gC5, hC5],
          [gC15a, hC15a],
        ] as const) {
          const t1 = await startPayment(g, h, w.account);
          if (isFailure(t1)) throw new Error(`T1 refusée : ${t1.code}`);
          expect(t1.outcome).toBe('NEW_ORDER');
          ops[h] = t1.operationId as string;
          expect(await recordOrder(g, h, ops[h])).toBe('RECORDED');
          const s = await holdState(h);
          expect(s.status).toBe('PAYMENT_IN_FLIGHT');
          expect((s.payment_in_flight_until as Date).getTime()).toBeGreaterThan(
            s.expires_at.getTime(),
          );
        }
        // preuve de C2 reçue avant l'échéance (comme la passe virtuelle : T0 + 7 < T0 + 10)
        expect(await proof(ops[hC2] as string)).toBe('APPLIED');

        // attente RÉELLE de l'échéance de tous les holds
        const latest = new Date(Math.max(...states.map((s) => s.expires_at.getTime())));
        await waitPast(latest);

        // C15 (a) : « appel PSP lent » — la tâche d'expiration tourne après expires_at ⇒ hold intact
        expect(await expiryJob()).toBeGreaterThanOrEqual(0);
        expect((await holdState(hC15a)).status).toBe('PAYMENT_IN_FLIGHT');

        // C5 : B tente le créneau de A pendant PAYMENT_IN_FLIGHT ⇒ 409, le hold de A n'expire pas
        expect(await poseOutcome(gB, slots.c5)).toBe('VEHICLE_UNAVAILABLE');
        expect(await holdState(hC5)).toMatchObject({
          status: 'PAYMENT_IN_FLIGHT',
          occ_kind: 'HOLD',
          occ_active: true,
        });

        // C15 (c) : hold déjà échu au moment de T1 (tâche passée) ⇒ aucun appel PSP
        expect((await holdState(hC15c)).status).toBe('EXPIRED');
        const late = await startPayment(gC15c, hC15c, w.account);
        expect(isFailure(late) && late.code).toBe('HOLD_EXPIRED');
        expect(await operationsOf(hC15c)).toBe(0);

        // C2 : conversion verrouillée ; la tâche d'expiration tourne pendant ⇒ SKIP LOCKED
        const jobClient = await connectAs('app_worker');
        const reader = await connectAs('app_worker');
        try {
          const result = await realTx(worker, 'booking_conversion', async (tx) => {
            const r = await tx.query<{ r: Json }>('SELECT core.booking_convert_payment($1) AS r', [
              ops[hC2],
            ]);
            expect(await expiryJob(jobClient)).toBeGreaterThanOrEqual(0);
            const during = await inTx(reader, { worker: 'booking_conversion' }, async (rd) => {
              const q = await rd.query<{ status: string }>(
                'SELECT status FROM core.booking_checkout_hold WHERE id = $1',
                [hC2],
              );
              return q.rows[0]?.status;
            });
            expect(during).toBe('PAYMENT_IN_FLIGHT');
            return r.rows[0]?.r as Json;
          });
          expect(result).toMatchObject({ outcome: 'CONVERTED' });
        } finally {
          await releaseClient(reader);
          await releaseClient(jobClient);
        }
        expect(await holdState(hC2)).toMatchObject({
          status: 'CONVERTED',
          occ_kind: 'TRIP',
          occ_active: true,
        });
        expect(await tripOfGuest(gC2)).toEqual([{ status: 'BOOKED', active_trip_occupancies: 1 }]);

        // C15 (a), suite : la preuve arrive après l'échéance, avant la borne ⇒ conversion
        expect(await proof(ops[hC15a] as string)).toBe('APPLIED');
        const conv = await realTx(worker, 'booking_conversion', async (tx) => {
          const r = await tx.query<{ r: Json }>('SELECT core.booking_convert_payment($1) AS r', [
            ops[hC15a],
          ]);
          return r.rows[0]?.r as Json;
        });
        expect(conv).toMatchObject({ outcome: 'CONVERTED', reacquired: false });
        expect(await tripOfGuest(gC15a)).toEqual([
          { status: 'BOOKED', active_trip_occupancies: 1 },
        ]);
      },
      LONG,
    );
  },
);
