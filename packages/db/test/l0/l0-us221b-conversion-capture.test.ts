/**
 * US-221 partie 221b — report de la capture d'un checkout sur les soldes par jambe du trip réservé
 * (migration 0146, ADR-170 ; défauts D1 et D2 de la passation US-221 ; 08 E7 règles 1, 2 et 10 ;
 * 17 v6 §2.5 étape 4, §2.9).
 *
 * D1 : à la conversion gardée, la CAPTURE prouvée est rattachée au trip né et reportée sur CHAQUE
 * jambe avec son montant explicite (jamais un prorata), dans la même transaction ; COLLECTION de la
 * jambe INSURER au registre de l'assureur ; rejeu sans double report.
 * D2 : un trip dont la capture convertie et prouvée n'est pas portée est vu par les faits de
 * l'invariant par jambe du rapprochement (Σ capturé ≠ Σ encaissé).
 *
 * Attendus : vecteurs TJ01 (USD) et TJ08a (PYG) de l'oracle Python (`docs/specs/tools/check_legs.py`,
 * `python -I -X utf8` : « TJ01 (USD) : 131,25 / 25,50 / 0,00 / 99,91 / 256,66 » et « TJ08a (PYG) :
 * 787 500 / 105 000 / 0 / 545 550 / 1 438 050 »), recoupés avec l'export `golden_vectors.json`.
 *
 * Données COMMITÉES (deux sessions, conversion et balayages sur toute la base) : ce fichier tourne
 * seul, après les autres (projet isolé de vitest.l0.config.ts), dans sa propre période d'horloge
 * virtuelle (2056). Aucun interrupteur de mise en service n'est touché : le devis engagé au checkout
 * est posé par la fixture 9969 ; tout le reste passe par les VRAIES commandes, sous les rôles de
 * production (assertion L0-05 par connectAs) : pose du hold, T1, T2 (app_api), preuve
 * (webhook_ingest), conversion (booking_conversion), lectures (payment_command, reconciliation).
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandCallSql } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { at, COUNTRIES, inTx, uuid } from '../support/avl.ts';
import type { CountryCase, Worker } from '../support/avl.ts';
import { ensureParties, placeHoldCommand, registerVehicles } from '../support/concurrency.ts';
import { legsJson } from '../support/pay.ts';
import { insertTrip } from '../support/settlement.ts';

const LONG = 120_000;
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
type Legs = Record<(typeof LEGS)[number], bigint>;

// Oracle Python (check_legs.py), unités mineures : jamais le code testé
const ORACLE: Readonly<Record<string, { id: string; legs: Legs; total: bigint }>> = {
  USD: {
    id: 'TJ01',
    legs: { HOST: 13125n, INSURER: 2550n, TAX_THIRD_PARTY: 0n, PLATFORM: 9991n },
    total: 25666n,
  },
  PYG: {
    id: 'TJ08a',
    legs: { HOST: 787500n, INSURER: 105000n, TAX_THIRD_PARTY: 0n, PLATFORM: 545550n },
    total: 1438050n,
  },
};
const oracleOf = (c: CountryCase) => ORACLE[c.currency]!;

const ERA0 = Date.parse('2056-04-02T10:00:00.000Z');
const era = (n: number): string => new Date(ERA0 + n * 3 * 86_400_000).toISOString();

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
      '2070-12-31',
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

/** Hold posé par la vraie commande, devis engagé aux jambes de l'oracle (fixture 9969), T1, T2. */
async function paidHold(
  c: CountryCase,
  w: World,
  T0: string,
): Promise<{ hold: string; op: string }> {
  const start = at(T0, 3 * 24 * 60);
  const end = at(start, 2 * 24 * 60);
  const hold = await inTx(api, { virtualNow: T0, commit: true }, (tx) =>
    placeHoldCommand(tx, {
      slot: { vehicleId: w.vehicle, orgId: w.orgId, start, end, bufferHours: 2 },
      guestId: w.guest,
    }),
  );
  const o = oracleOf(c);
  await inTx(api, { virtualNow: T0, commit: true }, (tx) =>
    tx.query(
      `SELECT test_fixture.us223_checkout_acceptance($1, $2::bigint, $3, $4::jsonb,
                                                     $5::timestamptz, $6::timestamptz)`,
      [hold, o.total.toString(), c.currency, legsJson(o.legs), start, end],
    ),
  );
  const s = await guestCall<Json>(
    w.guest,
    'core.booking_cmd_start_payment',
    [
      { value: hold, type: 'uuid' },
      { value: w.account, type: 'uuid' },
      { value: 'CARD', type: 'text' },
    ],
    at(T0, 1),
  );
  // ordre au PSP : montant explicite de CHAQUE jambe (08 E7 règle 2)
  expect(s).toMatchObject({
    outcome: 'NEW_ORDER',
    amountMinor: o.total.toString(),
    currency: c.currency,
    legs: Object.fromEntries(LEGS.map((l) => [l, o.legs[l].toString()])),
  });
  const op = s['operationId'] as string;
  expect(
    await guestCall<string>(
      w.guest,
      'core.booking_cmd_record_order',
      [
        { value: hold, type: 'uuid' },
        { value: op, type: 'uuid' },
        { value: `fake-${uuid()}`, type: 'text' },
        { value: at(T0, 6), type: 'timestamptz' },
      ],
      at(T0, 1),
    ),
  ).toBe('RECORDED');
  return { hold, op };
}

const webhook = async (op: string, when: string): Promise<string> =>
  (
    await workerSql<{ o: string }>(
      'webhook_ingest',
      when,
      `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK',
                test_fixture.us049_signed_webhook($1, 'SUCCEEDED'), NULL) AS o`,
      [op],
    )
  )[0]!.o;

const convert = async (op: string, when: string): Promise<Json> =>
  (
    await workerSql<{ r: Json }>(
      'booking_conversion',
      when,
      'SELECT core.booking_convert_payment($1) AS r',
      [op],
    )
  )[0]!.r;

interface Balance {
  leg: string;
  captured: string;
  refunded: string;
  reallocated_in: string;
  reallocated_out: string;
  released: string;
}

const balances = async (trip: string): Promise<Record<string, Balance>> =>
  Object.fromEntries(
    (
      await workerSql<Balance>(
        'payment_command',
        undefined,
        `SELECT leg, captured_minor::text AS captured, refunded_minor::text AS refunded,
                reallocated_in_minor::text AS reallocated_in,
                reallocated_out_minor::text AS reallocated_out, released_minor::text AS released
           FROM core.settlement_trip_leg_balance WHERE trip_id = $1 AND segment_no = 1`,
        [trip],
        false,
      )
    ).map((r) => [r.leg, r]),
  );

const captureState = async (op: string) =>
  (
    await workerSql<{
      operation_trip_id: string | null;
      legs_trip_ids: string[];
      movements: number;
      movement_kind: string | null;
    }>(
      'payment_command',
      undefined,
      `SELECT operation_trip_id::text AS operation_trip_id,
              legs_trip_ids::text[] AS legs_trip_ids, movements, movement_kind
         FROM test_fixture.us221b_capture_state($1)`,
      [op],
      false,
    )
  )[0]!;

const collections = async (trip: string) =>
  (
    await workerSql<{ reason: string; amount_minor: string; operation_id: string }>(
      'payment_command',
      undefined,
      'SELECT reason, amount_minor, operation_id FROM test_fixture.us227_entries($1)',
      [trip],
      false,
    )
  ).filter((e) => e.reason === 'COLLECTION');

interface Facts {
  captured: string;
  collected: string | null;
  collected_legs: string | null;
  expected_host: string | null;
  statement_host: string | null;
}

const FACTS_SQL = `SELECT captured_minor::text AS captured, collected_minor::text AS collected,
                          collected_legs_minor::text AS collected_legs,
                          expected_host_minor::text AS expected_host,
                          statement_host_minor::text AS statement_host
                     FROM core.finance_trip_leg_facts() WHERE trip_id = $1::uuid`;

async function asReconciliation(tx: pg.ClientBase): Promise<void> {
  await tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', 'reconciliation', true)`,
  );
}

async function sqlstate(tx: pg.ClientBase, sql: string, params: unknown[]) {
  await tx.query('SAVEPOINT s');
  try {
    await tx.query(sql, params);
    return 'OK';
  } catch (error) {
    const e = error as { code?: string; constraint?: string };
    return `${e.code ?? '?'}:${e.constraint ?? ''}`;
  } finally {
    await tx.query('ROLLBACK TO SAVEPOINT s');
  }
}

describe('US-221b — attendus de l’oracle recoupés avec l’export des vecteurs', () => {
  it('TJ01 (USD) et TJ08a (PYG) : Σ jambes = total ; export = oracle', async () => {
    // L0-05 : assertion de rôle faite par connectAs dans beforeEach (app_api, app_worker)
    expect(worker).toBeDefined();
    const set = loadGoldenVectors();
    for (const c of COUNTRIES) {
      const o = oracleOf(c);
      const v = legVector(set, o.id);
      expect(v.currency).toBe(c.currency);
      expect(v.totalMinor).toBe(o.total);
      expect({ ...v.legsMinor }).toEqual(o.legs);
      expect(LEGS.reduce((s, l) => s + o.legs[l], 0n)).toBe(o.total);
    }
  });
});

describe.each(COUNTRIES)(
  'US-221b — capture convertie portée par jambe ($country, $currency)',
  (c) => {
    const o = oracleOf(c);
    const idx = COUNTRIES.indexOf(c) * 10;

    it(
      'D1 : conversion gardée ⇒ capture rattachée au trip, soldes = jambes explicites de l’oracle (Σ = total), mouvement CAPTURE, COLLECTION de l’assureur ; rejeux ⇒ aucun double report',
      async () => {
        const T0 = era(idx + 1);
        const w = await world(c, T0);
        const { op } = await paidHold(c, w, T0);
        expect(await webhook(op, at(T0, 2))).toBe('APPLIED');
        const r = await convert(op, at(T0, 3));
        expect(r).toMatchObject({ outcome: 'CONVERTED', reacquired: false });
        const trip = r['tripId'] as string;

        // rattachement (opération et jambes) et report, dans la transaction de la conversion
        expect(await captureState(op)).toEqual({
          operation_trip_id: trip,
          legs_trip_ids: [trip],
          movements: 1,
          movement_kind: 'CAPTURE',
        });
        const b = await balances(trip);
        expect(Object.keys(b).sort()).toEqual([...LEGS].sort());
        for (const leg of LEGS) {
          expect(b[leg], leg).toEqual({
            leg,
            captured: o.legs[leg].toString(),
            refunded: '0',
            reallocated_in: '0',
            reallocated_out: '0',
            released: '0',
          });
        }
        expect(LEGS.reduce((s, l) => s + BigInt(b[l]!.captured), 0n)).toBe(o.total);
        expect(await collections(trip)).toEqual([
          { reason: 'COLLECTION', amount_minor: o.legs.INSURER.toString(), operation_id: op },
        ]);

        // rejeux : conversion (REPLAY), webhook (DUPLICATE), report de 0123 (DUPLICATE)
        expect(await convert(op, at(T0, 4))).toMatchObject({ outcome: 'REPLAY', tripId: trip });
        expect(await webhook(op, at(T0, 4))).toBe('DUPLICATE');
        expect(
          (
            await workerSql<{ r: string }>(
              'payment_command',
              at(T0, 5),
              'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
              [op],
            )
          )[0]!.r,
        ).toBe('DUPLICATE');
        expect((await captureState(op)).movements).toBe(1);
        expect(await balances(trip)).toEqual(b);
        expect(await collections(trip)).toHaveLength(1);

        // le rapprochement voit le trip : Σ capturé = Σ encaissé = Σ jambes = total ; HOST = HOST
        await inTx(worker, {}, async (tx) => {
          await asReconciliation(tx);
          const { rows } = await tx.query<Facts>(FACTS_SQL, [trip]);
          expect(rows).toEqual([
            {
              captured: o.total.toString(),
              collected: o.total.toString(),
              collected_legs: o.total.toString(),
              expected_host: o.legs.HOST.toString(),
              statement_host: o.legs.HOST.toString(),
            },
          ]);
        });
      },
      LONG,
    );

    it(
      'garde : report refusé hors des travailleurs de conversion (42501) et pour une opération sans conversion (leg_movement_unsupported) ; app_api sans EXECUTE ; D2 : capture convertie jamais portée vue en écart par le rapprochement',
      async () => {
        const T0 = era(idx + 2);
        const w = await world(c, T0);
        const { op } = await paidHold(c, w, T0);
        expect(await webhook(op, at(T0, 2))).toBe('APPLIED');
        const call = 'SELECT core.settlement_cmd_apply_conversion_capture($1)';
        for (const name of ['payment_command', 'reconciliation', 'webhook_ingest'] as const) {
          await inTx(worker, {}, async (tx) => {
            await tx.query(
              `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                    pg_catalog.set_config('app.worker_name', $1, true)`,
              [name],
            );
            expect(await sqlstate(tx, call, [op]), name).toBe('42501:');
          });
        }
        // opération prouvée mais non convertie : aucune disposition CONVERSION ⇒ refus
        await inTx(worker, { worker: 'booking_conversion', virtualNow: at(T0, 3) }, async (tx) => {
          expect(await sqlstate(tx, call, [op])).toBe('55000:leg_movement_unsupported');
        });
        await inTx(api, {}, async (tx) => {
          expect(await sqlstate(tx, call, [op])).toBe('42501:');
        });
        // rien n'a été porté ni rattaché
        expect(await captureState(op)).toMatchObject({ operation_trip_id: null, movements: 0 });
        // D2 (transaction ANNULÉE) : la même capture prouvée convertie SANS report (forme d'avant
        // 0146 : disposition CONVERSION, aucun solde) est vue par les faits du rapprochement, en
        // écart (Σ capturé 0 ≠ Σ encaissé ; aucune ligne de relevé)
        await inTx(worker, {}, async (tx) => {
          const trip = await insertTrip(tx, c, 9000 + idx);
          await tx.query('SELECT test_fixture.us221b_legacy_conversion($1, $2)', [op, trip.id]);
          await asReconciliation(tx);
          const { rows } = await tx.query<Facts>(FACTS_SQL, [trip.id]);
          expect(rows).toEqual([
            {
              captured: '0',
              collected: o.total.toString(),
              collected_legs: o.total.toString(),
              expected_host: o.legs.HOST.toString(),
              statement_host: null,
            },
          ]);
        });
        // la vraie conversion porte ensuite la capture (aucune opération prouvée laissée sans
        // disposition dans la base partagée)
        const r = await convert(op, at(T0, 4));
        expect(r).toMatchObject({ outcome: 'CONVERTED' });
        expect(await captureState(op)).toMatchObject({
          operation_trip_id: r['tripId'],
          movements: 1,
        });
      },
      LONG,
    );
  },
);
