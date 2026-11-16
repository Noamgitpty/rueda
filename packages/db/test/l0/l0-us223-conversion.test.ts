/**
 * US-223 (partie 223a) — du paiement par jambes au trip BOOKED, preuve par webhook seulement
 * (migration 0114, ADR-139 ; 17 §2.5 étapes 3 à 7, C20 ; 19 US-223 critères 1, 3, 4, 5).
 *
 * Données COMMITÉES (deux sessions, balayages sur toute la base) : ce fichier tourne seul, après
 * les autres (projet l0-concurrence de vitest.l0.config.ts), dans sa propre période d'horloge
 * virtuelle (2043). Aucun interrupteur de mise en service n'est touché : le devis engagé au checkout
 * est posé par la fixture 9969 (forme écrite par les commandes de gel et de checkout, qui exigent
 * les interrupteurs et sont prouvées par l0-us223-checkout-payment dans une transaction annulée) ;
 * tout le reste passe par les VRAIES commandes, sous les rôles de production (assertion L0-05 par
 * connectAs) : pose du hold, T1, T2 (app_api), statuts (payment_command, webhook_ingest),
 * conversion (booking_conversion), expiration (hold_expiry).
 *
 * Attendus : jambes de capture des vecteurs TJ01 (USD) et TJ09a (PYG) de l'export des oracles
 * (08 E7 règle 2) ; paramètres de 17 §7.2 (graine US-013 : hold_max_total_minutes 20,
 * sweep_grace_s 60, conversion_start_tolerance_minutes 0) ; 19 US-223 : « aucune capture d'écran ni
 * déclaration ne vaut preuve », « 120,00 reçus pour 128,40 ⇒ MISMATCH et aucun trip », « hold sans
 * preuve à son échéance ⇒ EXPIRED, aucun trip ni booking.trip.booked », « début immédiat payé 8 min
 * après ⇒ BOOKED sans START_PASSED (C20) » ; N-163 / 19 consigne : aucun double débit à deux
 * sessions (T1 concurrentes : une opération) ni double trip (conversions concurrentes).
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandCallSql } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { at, COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase, Worker } from '../support/avl.ts';
import {
  backendPid,
  ensureParties,
  placeHoldCommand,
  registerVehicles,
  waitUntilBlocked,
} from '../support/concurrency.ts';
import { legsJson } from '../support/pay.ts';

const HOLD_MAX_TOTAL_MIN = 20;
const SWEEP_GRACE_S = 60;
const LONG = 120_000;

const set = loadGoldenVectors();
const CAPTURE = Object.fromEntries(
  [legVector(set, 'TJ01'), legVector(set, 'TJ09a')].map((v) => [v.currency, v]),
);
const captureOf = (c: CountryCase) => CAPTURE[c.currency]!;
const legsText = (c: CountryCase): Record<string, string> =>
  Object.fromEntries(
    Object.entries(captureOf(c).legsMinor).map(([leg, amount]) => [leg, amount.toString()]),
  );

const ERA0 = Date.parse('2043-03-02T10:00:00.000Z');
const era = (n: number): string => new Date(ERA0 + n * 3 * 86_400_000).toISOString();
const atSec = (base: string, s: number): string =>
  new Date(Date.parse(base) + s * 1000).toISOString();

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

interface World {
  readonly orgId: string;
  readonly vehicle: string;
  readonly guest: string;
  readonly account: string;
}

/** Hôte, véhicule, voyageur au conducteur approuvé, compte FAKE, capacités bloquantes validées. */
async function world(c: CountryCase, from: string): Promise<World> {
  const orgId = uuid();
  const vehicle = uuid();
  const guest = uuid();
  const account = await inTx(api, { virtualNow: from, commit: true }, async (tx) => {
    await ensureParties(tx, [guest], orgId, c);
    await registerVehicles(tx, [vehicle], orgId, c);
    await tx.query('SELECT test_fixture.us209_driver($1, $2, $3::date, $4::date, $5)', [
      guest,
      c.country,
      '1990-01-01',
      '2060-12-31',
      c.country,
    ]);
    const { rows } = await tx.query<{ capability: string; kind: string }>(
      `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
    );
    for (const r of rows) {
      const value = r.kind === 'bool' ? true : r.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';
      await tx.query(
        `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', $2, $3::jsonb,
                                                  'VALIDATED_SANDBOX', $4::timestamptz)`,
        [c.country, r.capability, JSON.stringify(value), at(from, -60)],
      );
    }
    const a = await tx.query<{ id: string }>('SELECT test_fixture.us024_psp_account($1) AS id', [
      c.country,
    ]);
    return a.rows[0]!.id;
  });
  return { orgId, vehicle, guest, account };
}

/** Pose réelle du hold puis devis engagé au checkout (fixture 9969) : période [début ; fin). */
async function checkoutHold(
  c: CountryCase,
  w: World,
  when: string,
  start: string,
  end: string,
): Promise<{ holdId: string; quoteId: string }> {
  const holdId = await inTx(api, { virtualNow: when, commit: true }, (tx) =>
    placeHoldCommand(tx, {
      slot: { vehicleId: w.vehicle, orgId: w.orgId, start, end, bufferHours: 2 },
      guestId: w.guest,
    }),
  );
  const v = captureOf(c);
  const quoteId = await inTx(api, { virtualNow: when, commit: true }, async (tx) => {
    const r = await tx.query<{ id: string }>(
      `SELECT test_fixture.us223_checkout_acceptance($1, $2::bigint, $3, $4::jsonb,
                                                     $5::timestamptz, $6::timestamptz) AS id`,
      [holdId, v.totalMinor.toString(), v.currency, legsJson(v.legsMinor), start, end],
    );
    return r.rows[0]!.id;
  });
  return { holdId, quoteId };
}

async function guestCall<T>(
  guest: string,
  fn: string,
  args: { value: unknown; type: string }[],
  when: string,
): Promise<T> {
  return inTx(api, { virtualNow: when, commit: true }, async (tx) => {
    const { text, values } = commandCallSql({ kind: 'GUEST', actorId: guest }, fn, args);
    return (await tx.query<{ result: T }>(text, values)).rows[0]?.result as T;
  });
}

const startPayment = (w: World, holdId: string, when: string) =>
  guestCall<Json>(
    w.guest,
    'core.booking_cmd_start_payment',
    [
      { value: holdId, type: 'uuid' },
      { value: w.account, type: 'uuid' },
      { value: 'CARD', type: 'text' },
    ],
    when,
  );

async function order(w: World, holdId: string, t1: string): Promise<{ op: string; ref: string }> {
  const s = await startPayment(w, holdId, t1);
  expect(s['outcome']).toBe('NEW_ORDER');
  const op = s['operationId'] as string;
  const ref = `fake-${uuid()}`;
  const r = await guestCall<string>(
    w.guest,
    'core.booking_cmd_record_order',
    [
      { value: holdId, type: 'uuid' },
      { value: op, type: 'uuid' },
      { value: ref, type: 'text' },
      { value: at(t1, 5), type: 'timestamptz' },
    ],
    t1,
  );
  expect(r).toBe('RECORDED');
  return { op, ref };
}

async function workerSql<T extends pg.QueryResultRow>(
  name: Worker,
  when: string | undefined,
  sql: string,
  params: unknown[],
  client: pg.Client = worker,
): Promise<T[]> {
  return inTx(
    client,
    { worker: name, ...(when !== undefined ? { virtualNow: when } : {}), commit: true },
    async (tx) => (await tx.query<T>(sql, params)).rows,
  );
}

const apiResponse = async (op: string, status: string, when: string): Promise<string> =>
  (
    await workerSql<{ o: string }>(
      'payment_command',
      when,
      `SELECT core.payment_cmd_apply_operation_status($1, $2, 'API_RESPONSE', NULL, NULL) AS o`,
      [op, status],
    )
  )[0]!.o;

/** Vrai webhook signé de l'opération (fixture 9940 : montant et devise de l'ordre), puis statut. */
const webhook = async (op: string, status: string, when: string): Promise<string> =>
  (
    await workerSql<{ o: string }>(
      'webhook_ingest',
      when,
      `SELECT core.payment_cmd_apply_operation_status($1, $2, 'WEBHOOK',
                test_fixture.us049_signed_webhook($1, $2), NULL) AS o`,
      [op, status],
    )
  )[0]!.o;

/** Webhook signé portant un montant REÇU (scénario MISMATCH). */
async function webhookWithAmount(
  c: CountryCase,
  w: World,
  op: string,
  ref: string,
  received: bigint,
  when: string,
): Promise<string> {
  return (
    await workerSql<{ o: string }>(
      'webhook_ingest',
      when,
      `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK',
                (SELECT r.inbox_id FROM test_fixture.us049_receive_custom($2, $3::jsonb, true,
                                                                          platform.now()) AS r),
                NULL) AS o`,
      [
        op,
        w.account,
        JSON.stringify([
          {
            type: 'payment.captured',
            providerReference: ref,
            merchantReference: null,
            status: 'SUCCEEDED',
            amountMinor: received.toString(),
            currency: c.currency,
            occurredAt: when,
          },
        ]),
      ],
    )
  )[0]!.o;
}

const convert = async (op: string, when: string, client: pg.Client = worker): Promise<Json> =>
  (
    await workerSql<{ r: Json }>(
      'booking_conversion',
      when,
      'SELECT core.booking_convert_payment($1) AS r',
      [op],
      client,
    )
  )[0]!.r;

const due = async (when: string): Promise<{ operation_id: string; action: string }[]> =>
  workerSql<{ operation_id: string; action: string }>(
    'booking_conversion',
    when,
    'SELECT operation_id, action FROM core.booking_conversion_due(10000)',
    [],
  );

async function hold(holdId: string): Promise<{ status: string; converted_trip_id: string | null }> {
  return (
    await workerSql<{ status: string; converted_trip_id: string | null }>(
      'booking_conversion',
      undefined,
      'SELECT status, converted_trip_id FROM core.booking_checkout_hold WHERE id = $1',
      [holdId],
    )
  )[0]!;
}

const versions = async (trip: string) =>
  (
    await inTx(api, { commit: false }, (tx) =>
      tx.query<{ version: number; quote_id: string }>(
        'SELECT * FROM test_fixture.us223_trip_price_versions($1)',
        [trip],
      ),
    )
  ).rows;

async function bookedEvents(holdId: string): Promise<number> {
  const rows = await workerSql<{ n: number }>(
    'outbox_relay',
    undefined,
    `SELECT pg_catalog.count(*)::int AS n FROM core.outbox_outbox_event
      WHERE type = 'booking.trip.booked' AND payload ->> 'hold_id' = $1`,
    [holdId],
  );
  return rows[0]!.n;
}

describe.each(COUNTRIES)(
  'US-223 — paiement prouvé par webhook ⇒ trip BOOKED ($country, $currency)',
  (c) => {
    const v = captureOf(c);
    const idx = COUNTRIES.indexOf(c) * 10;

    it(
      'bout en bout : T1 avec les jambes du devis engagé ; SUCCEEDED de réponse d’API ⇒ NOT_PROVEN, aucun trip ; webhook signé ⇒ preuve, trip BOOKED, version de prix n° 1 = devis du checkout ; rejeu ⇒ REPLAY',
      async () => {
        const T0 = era(idx + 1);
        const w = await world(c, T0);
        const start = at(T0, 3 * 24 * 60);
        const end = at(start, 2 * 24 * 60);
        const h = await checkoutHold(c, w, T0, start, end);
        const s = await startPayment(w, h.holdId, at(T0, 1));
        expect(s).toMatchObject({
          outcome: 'NEW_ORDER',
          amountMinor: v.totalMinor.toString(),
          currency: v.currency,
          legs: legsText(c),
        });
        const op = s['operationId'] as string;
        expect(
          await guestCall<string>(
            w.guest,
            'core.booking_cmd_record_order',
            [
              { value: h.holdId, type: 'uuid' },
              { value: op, type: 'uuid' },
              { value: `fake-${uuid()}`, type: 'text' },
              { value: at(T0, 6), type: 'timestamptz' },
            ],
            at(T0, 1),
          ),
        ).toBe('RECORDED');
        // « le PSP dit SUCCEEDED » dans la réponse d'API : ni une capture d'écran ni une déclaration
        // ne vaut preuve, une réponse non signée non plus
        expect(await apiResponse(op, 'SUCCEEDED', at(T0, 2))).toBe('APPLIED');
        expect(await convert(op, at(T0, 2))).toEqual({ outcome: 'NOT_PROVEN' });
        expect((await due(at(T0, 2))).filter((d) => d.operation_id === op)).toEqual([]);
        expect(await hold(h.holdId)).toEqual({
          status: 'PAYMENT_IN_FLIGHT',
          converted_trip_id: null,
        });
        // webhook signé : la preuve est posée sur le statut déjà terminal
        expect(await webhook(op, 'SUCCEEDED', at(T0, 3))).toBe('DUPLICATE');
        expect((await due(at(T0, 3))).filter((d) => d.operation_id === op)).toEqual([
          { operation_id: op, action: 'CONVERT' },
        ]);
        const r = await convert(op, at(T0, 3));
        expect(r).toMatchObject({ outcome: 'CONVERTED', reacquired: false });
        const trip = r['tripId'] as string;
        expect(await hold(h.holdId)).toEqual({ status: 'CONVERTED', converted_trip_id: trip });
        expect(await versions(trip)).toEqual([{ version: 1, quote_id: h.quoteId }]);
        expect(await bookedEvents(h.holdId)).toBe(1);
        // webhook rejoué : DUPLICATE ; conversion rejouée : REPLAY, un seul trip
        expect(await webhook(op, 'SUCCEEDED', at(T0, 4))).toBe('DUPLICATE');
        expect(await convert(op, at(T0, 4))).toMatchObject({ outcome: 'REPLAY', tripId: trip });
        expect(await versions(trip)).toHaveLength(1);
        expect(await bookedEvents(h.holdId)).toBe(1);
      },
      LONG,
    );

    it(
      '19 US-223 : montant reçu inférieur à l’ordre ⇒ MISMATCH, aucun trip ; sans preuve à l’échéance (hold_max_total_minutes) ⇒ EXPIRED, créneau libéré, aucun booking.trip.booked',
      async () => {
        const T0 = era(idx + 2);
        const w = await world(c, T0);
        const start = at(T0, 3 * 24 * 60);
        const h = await checkoutHold(c, w, T0, start, at(start, 2 * 24 * 60));
        const { op, ref } = await order(w, h.holdId, at(T0, 1));
        const received = (v.totalMinor * 9n) / 10n;
        expect(await webhookWithAmount(c, w, op, ref, received, at(T0, 2))).toBe('MISMATCH');
        expect(await convert(op, at(T0, 3))).toMatchObject({ outcome: 'NOT_SUCCEEDED' });
        // échéance : base (pose) + hold_max_total_minutes, puis sweep_grace_s
        const after = atSec(at(T0, HOLD_MAX_TOTAL_MIN), SWEEP_GRACE_S + 1);
        await workerSql('hold_expiry', after, 'SELECT core.booking_expire_due_holds(10000)', []);
        expect(await hold(h.holdId)).toEqual({ status: 'EXPIRED', converted_trip_id: null });
        expect(await bookedEvents(h.holdId)).toBe(0);
        // le créneau est libre : un autre hold du même voyageur peut être posé et payé
        const h2 = await checkoutHold(c, w, after, start, at(start, 2 * 24 * 60));
        expect((await order(w, h2.holdId, atSec(after, 30))).op).toBeTruthy();
      },
      LONG,
    );

    it(
      'C20 : début immédiat (10 min après la pose) payé et prouvé 8 min après ⇒ BOOKED, aucune compensation START_PASSED',
      async () => {
        const T0 = era(idx + 3);
        const w = await world(c, T0);
        await api.query('SELECT test_fixture.us119_set_org_notice($1, 0)', [w.orgId]);
        const start = at(T0, 10);
        const h = await checkoutHold(c, w, T0, start, at(start, 24 * 60));
        const { op } = await order(w, h.holdId, at(T0, 1));
        expect(await webhook(op, 'SUCCEEDED', at(T0, 8))).toBe('APPLIED');
        expect(await convert(op, at(T0, 8))).toMatchObject({ outcome: 'CONVERTED' });
      },
      LONG,
    );

    it(
      'deux sessions : T1 concurrentes sur le même hold ⇒ une seule opération (aucun double débit) ; conversions concurrentes ⇒ un seul trip',
      async () => {
        const T0 = era(idx + 4);
        const w = await world(c, T0);
        const start = at(T0, 3 * 24 * 60);
        const h = await checkoutHold(c, w, T0, start, at(start, 2 * 24 * 60));
        const api2 = await connectAs('app_api');
        const worker2 = await connectAs('app_worker');
        try {
          const call = (client: pg.Client) => {
            const { text, values } = commandCallSql(
              { kind: 'GUEST', actorId: w.guest },
              'core.booking_cmd_start_payment',
              [
                { value: h.holdId, type: 'uuid' },
                { value: w.account, type: 'uuid' },
                { value: 'CARD', type: 'text' },
              ],
            );
            return client.query<{ result: Json }>(text, values);
          };
          const pid2 = await backendPid(api2);
          const results = await inTx(api, { virtualNow: at(T0, 1), commit: true }, async (tx) => {
            const first = (await call(tx as pg.Client)).rows[0]!.result;
            // la seconde session attend le verrou du voyageur tenu par la première
            const second = inTx(
              api2,
              { virtualNow: at(T0, 1), commit: true },
              async (tx2) => (await call(tx2 as pg.Client)).rows[0]!.result,
            );
            await waitUntilBlocked(worker, pid2, 'advisory');
            return { first, second };
          });
          const second = await results.second;
          expect(results.first).toMatchObject({ outcome: 'NEW_ORDER' });
          expect(second['outcome']).not.toBe('NEW_ORDER');
          expect(second['operationId']).toBe(results.first['operationId']);
          const ops = await workerSql<{ n: number }>(
            'booking_conversion',
            undefined,
            'SELECT pg_catalog.count(*)::int AS n FROM core.payment_payment_operation WHERE hold_id = $1',
            [h.holdId],
          );
          expect(ops[0]!.n).toBe(1);

          const op = results.first['operationId'] as string;
          expect(await webhook(op, 'SUCCEEDED', at(T0, 2))).toBe('APPLIED');
          const pidW2 = await backendPid(worker2);
          const conv = await inTx(
            worker,
            { worker: 'booking_conversion', virtualNow: at(T0, 3), commit: true },
            async (tx) => {
              const one = (
                await tx.query<{ r: Json }>('SELECT core.booking_convert_payment($1) AS r', [op])
              ).rows[0]!.r;
              const two = convert(op, at(T0, 3), worker2);
              await waitUntilBlocked(api, pidW2, 'advisory');
              return { one, two };
            },
          );
          const two = await conv.two;
          expect(conv.one).toMatchObject({ outcome: 'CONVERTED' });
          expect(two).toMatchObject({ outcome: 'REPLAY', tripId: conv.one['tripId'] });
          expect(await bookedEvents(h.holdId)).toBe(1);
        } finally {
          await releaseClient(api2);
          await releaseClient(worker2);
        }
      },
      LONG,
    );
  },
);
