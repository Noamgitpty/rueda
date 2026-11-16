/**
 * US-223 (partie 223a) — paiement du hold du checkout par jambes (migration 0114, ADR-139), sous
 * les rôles de production (assertion L0-05 : `withRole`), en USD (PA) et en PYG sans décimale (PY).
 * Personnes, sessions, devis figés et checkout par les VRAIES commandes (US-208, US-209, US-226) ;
 * interrupteurs `p2p_private_hosts_enabled` et `insurer_contract_active` ouverts par la procédure à
 * deux personnes d'US-125 dans une transaction ANNULÉE ; compte marchand FAKE de bac à sable et
 * capacités du PSP posés par la fixture 9800 dans la même transaction.
 *
 * Attendus : jamais le code testé. Ils viennent de 19 US-223 (critère 1 : l'ordre porte le montant
 * EXPLICITE de chaque jambe ; critère 6 : capacité bloquante non validée ⇒ refus avant le paiement,
 * inconnue = « non »), de 08 E7 (règle 2 : jambes de la capture = jambes du devis ; PLATFORM =
 * complément) et des vecteurs du checkout d'US-208 / US-226 (en-tête de l0-us209-risk-checkout) :
 * - PA : TA01 (40,00 × 3 j, ITBMS 7 % sur le loyer, trip fee de TEST à 0 %) + BASICA 30,00 (grille
 *   de TEST) : total 158,40 ; HOST 90,00 ; INSURER 21,00 (TJ01 : 0,7 × 30,00) ; TAX 0 ;
 *   PLATFORM 158,40 − 90,00 − 21,00 = 47,40 ;
 * - PY : D2 sans ses lignes non taxées (TJ09c : 1 265 002, HOST 750 001) + BASICA 150 000 : total
 *   1 415 002 ; HOST 750 001 ; INSURER 105 000 (TJ09a) ; TAX 0 ; PLATFORM 560 001.
 * N-157 / N-161 : le montant et les jambes viennent du devis ENGAGÉ au checkout
 * (booking_checkout_acceptance), colonnes rejouées par la base. N-160 : un devis du checkout n'est
 * jamais rattaché à un autre trip ; un devis échu non plus.
 */
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  approveDriver,
  checkoutPerson,
  checkoutQuote,
  DAY_MS,
  failure,
  frozenQuote,
  listedListing,
  openSwitch,
  protectionParams,
  quoteDocs,
  setClock,
  taxGroups,
} from '../support/checkout.ts';
import type { CheckoutVector, Person } from '../support/checkout.ts';

type Tx = pg.ClientBase;
type Json = Record<string, unknown>;

const NOW = '2026-12-01T12:00:00.000Z';
const START = '2026-12-10T15:00:00.000Z';
const MIN = 60_000;

const VECTORS: Readonly<Record<string, CheckoutVector & { platform: number }>> = {
  PA: {
    daily: 4_000,
    schedule: { tiers: [{ maxDays: null, rateBps: 0 }], minMinor: '0' },
    fee: 0,
    taxes: { TRIP_PRICE: 840 },
    host: 9_000,
    total: 15_840,
    basicaPrice: '1/4',
    protection: 3_000,
    insurer: 2_100,
    platform: 4_740,
  },
  PY: {
    daily: 333_334,
    schedule: null,
    fee: 150_000,
    taxes: { TRIP_PRICE: 100_000, TRIP_FEE: 15_000 },
    host: 750_001,
    total: 1_415_002,
    basicaPrice: '3/20',
    protection: 150_000,
    insurer: 105_000,
    platform: 560_001,
  },
};

const at = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * MIN).toISOString();

interface World {
  readonly groups: Map<string, string>;
  readonly account: string;
}

/** Capacités bloquantes du catalogue validées (FAKE, pays) à `from` (US-061 : sinon aucun paiement). */
async function validateBlocking(tx: Tx, cc: CountryCase, from: string): Promise<void> {
  const { rows } = await tx.query<{ capability: string; kind: string }>(
    `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
  );
  for (const r of rows) {
    const value = r.kind === 'bool' ? true : r.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';
    await capability(tx, cc, r.capability, value, 'VALIDATED_SANDBOX', from);
  }
}

async function capability(
  tx: Tx,
  cc: CountryCase,
  name: string,
  value: unknown,
  status: 'VALIDATED_SANDBOX' | 'UNKNOWN',
  from: string,
): Promise<void> {
  await tx.query(
    `SELECT test_fixture.us024_set_capability('FAKE', $1, '*', $2, $3::jsonb, $4, $5::timestamptz)`,
    [cc.country, name, JSON.stringify(value), status, from],
  );
}

function scenario(cc: CountryCase) {
  return (fn: (tx: Tx, w: World) => Promise<void>) =>
    withRole('app_api', (client) =>
      withTestTransaction(client, { virtualNow: NOW }, async (tx) => {
        await openSwitch(tx, 'p2p_private_hosts_enabled', cc.country);
        await openSwitch(tx, 'insurer_contract_active', cc.country);
        const v = VECTORS[cc.country]!;
        if (v.schedule !== null) {
          await tx.query('SELECT test_fixture.us704_set_trip_fee_schedule($1, $2::jsonb)', [
            cc.country,
            JSON.stringify(v.schedule),
          ]);
        }
        await protectionParams(tx, cc.country, v);
        const acc = await tx.query<{ id: string }>(
          'SELECT test_fixture.us024_psp_account($1) AS id',
          [cc.country],
        );
        await fn(tx, { groups: await taxGroups(tx, cc), account: acc.rows[0]!.id });
      }),
    );
}

async function guest(tx: Tx, cc: CountryCase): Promise<Person> {
  const p = await checkoutPerson(tx, cc.country);
  await approveDriver(tx, p, cc.country, { birth: '1990-01-01', licenseExpiry: '2030-12-31' });
  return p;
}

/** Devis de 3 jours puis checkout : rend le devis et le hold. */
async function book(tx: Tx, cc: CountryCase, w: World, p: Person) {
  const l = await listedListing(tx, cc, VECTORS[cc.country]!.daily);
  const d = quoteDocs(cc, VECTORS[cc.country]!, w.groups, Date.parse(START), Date.parse(NOW));
  const quoteId = await frozenQuote(tx, p, l.listingId, d);
  const r = await checkoutQuote(tx, p, quoteId);
  expect(r.outcome).toBe('DONE');
  return { quoteId, holdId: r.hold_id!, listingId: l.listingId, vehicleId: l.vehicleId };
}

const pay = async (tx: Tx, hash: Buffer, holdId: string, method = 'CARD'): Promise<Json> =>
  (
    await tx.query<{ r: Json }>('SELECT core.booking_cmd_checkout_pay($1, $2, $3) AS r', [
      hash,
      holdId,
      method,
    ])
  ).rows[0]!.r;

const recordOrder = async (
  tx: Tx,
  hash: Buffer,
  holdId: string,
  op: string,
  ref: string,
  expires: string | null,
): Promise<string> =>
  (
    await tx.query<{ r: string }>(
      'SELECT core.booking_cmd_checkout_record_order($1, $2, $3, $4, $5) AS r',
      [hash, holdId, op, ref, expires],
    )
  ).rows[0]!.r;

const readPayment = async (tx: Tx, hash: Buffer, holdId: string): Promise<Json> =>
  (await tx.query<Json>('SELECT * FROM core.booking_checkout_payment($1, $2)', [hash, holdId]))
    .rows[0]!;

describe.each(COUNTRIES)(
  'US-223 — paiement par jambes du hold du checkout ($country, $currency)',
  (cc) => {
    const v = VECTORS[cc.country]!;
    const run = scenario(cc);
    const legs = {
      HOST: String(v.host),
      INSURER: String(v.insurer),
      TAX_THIRD_PARTY: '0',
      PLATFORM: String(v.platform),
    };

    it('critère 6 : capacité bloquante non validée (SUPPORTS_PER_LEG_AMOUNTS inconnue) ⇒ HOST_PAYOUT_RAIL_UNAVAILABLE avant le paiement, aucune opération', async () => {
      await run(async (tx, w) => {
        const p = await guest(tx, cc);
        const b = await book(tx, cc, w, p);
        await validateBlocking(tx, cc, at(NOW, -3));
        await capability(tx, cc, 'SUPPORTS_PER_LEG_AMOUNTS', true, 'UNKNOWN', at(NOW, -2));
        const e = await failure(tx, 'SELECT core.booking_cmd_checkout_pay($1, $2, $3)', [
          p.hash,
          b.holdId,
          'CARD',
        ]);
        expect(e).toMatchObject({ code: '55000', constraint: 'host_payout_rail_unavailable' });
        expect(translateDbError(e ?? {}).code).toBe('HOST_PAYOUT_RAIL_UNAVAILABLE');
        expect(await readPayment(tx, p.hash, b.holdId)).toMatchObject({
          outcome: 'DONE',
          hold_status: 'ACTIVE',
          operation_status: null,
        });
      });
    });

    it('critère 1 (N-157, N-161) : l’ordre porte le montant et CHAQUE jambe du devis engagé ; rejeu ⇒ même opération, même clé ; T2 ⇒ ordre existant', async () => {
      await run(async (tx, w) => {
        const p = await guest(tx, cc);
        const b = await book(tx, cc, w, p);
        await validateBlocking(tx, cc, at(NOW, -3));
        const first = await pay(tx, p.hash, b.holdId);
        expect(first).toMatchObject({
          outcome: 'NEW_ORDER',
          amountMinor: String(v.total),
          currency: cc.currency,
          attemptNo: 1,
          legs,
          provider: 'FAKE',
          method: 'CARD',
          pspAccountId: w.account,
          holdId: b.holdId,
        });
        // vecteurs : Σ jambes = total du devis (08 E7)
        expect(v.host + v.insurer + v.platform).toBe(v.total);
        expect(first['idemSent']).toBe(`hold:${b.holdId}:CAPTURE:a1`);
        // double clic avant T2 : même opération, même clé, aucun nouvel ordre (VERIF_17-B1)
        const again = await pay(tx, p.hash, b.holdId);
        expect(again).toMatchObject({
          outcome: 'RETRY_SAME_KEY',
          operationId: first['operationId'],
          idemSent: first['idemSent'],
          legs,
        });
        const ref = `fake-${uuid()}`;
        expect(
          await recordOrder(tx, p.hash, b.holdId, String(first['operationId']), ref, at(NOW, 5)),
        ).toBe('RECORDED');
        expect(await pay(tx, p.hash, b.holdId)).toMatchObject({
          outcome: 'EXISTING_ORDER',
          operationId: first['operationId'],
          providerReference: ref,
        });
        const read = await readPayment(tx, p.hash, b.holdId);
        expect(read).toMatchObject({
          outcome: 'DONE',
          hold_status: 'PAYMENT_IN_FLIGHT',
          trip_id: null,
          operation_status: 'SUBMITTED',
        });
        // aucun montant de jambe ni référence PSP dans la lecture du voyageur
        expect(Object.keys(read).sort()).toEqual([
          'expires_at',
          'hold_status',
          'operation_status',
          'outcome',
          'payment_in_flight_until',
          'trip_id',
        ]);
      });
    });

    it('IDOR : hold d’un autre voyageur ⇒ HOLD_NOT_FOUND (paiement, T2, lecture), sans session ⇒ AUTH_REQUIRED ; rien n’est écrit', async () => {
      await run(async (tx, w) => {
        const p = await guest(tx, cc);
        const other = await guest(tx, cc);
        const b = await book(tx, cc, w, p);
        await validateBlocking(tx, cc, at(NOW, -3));
        expect(await pay(tx, other.hash, b.holdId)).toEqual({ outcome: 'HOLD_NOT_FOUND' });
        expect(await pay(tx, Buffer.alloc(32), b.holdId)).toEqual({ outcome: 'AUTH_REQUIRED' });
        expect(await recordOrder(tx, other.hash, b.holdId, uuid(), 'fake-x', null)).toBe(
          'HOLD_NOT_FOUND',
        );
        expect(await readPayment(tx, other.hash, b.holdId)).toMatchObject({
          outcome: 'HOLD_NOT_FOUND',
          hold_status: null,
        });
        expect(await pay(tx, p.hash, uuid())).toEqual({ outcome: 'HOLD_NOT_FOUND' });
        // aucun ordre : la lecture du voyageur ne voit aucune opération (app_api ne lit pas la table)
        expect(await readPayment(tx, p.hash, b.holdId)).toMatchObject({ operation_status: null });
      });
    });

    it('N-160 : un devis engagé au checkout n’est jamais rattaché à un autre trip ; un devis échu non plus ; un devis frais l’est', async () => {
      await run(async (tx, w) => {
        const p = await guest(tx, cc);
        const b = await book(tx, cc, w, p);
        const tripId = uuid();
        await tx.query('SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)', [
          tripId,
          p.id,
          uuid(),
          // autre véhicule : le hold occupe déjà celui du devis sur la période
          uuid(),
          cc.country,
          cc.currency,
          cc.timezone,
          START,
          new Date(Date.parse(START) + 3 * DAY_MS).toISOString(),
        ]);
        const version = async (quote: string) =>
          (
            await tx.query<{ outcome: string; version: number | null }>(
              'SELECT * FROM core.pricing_cmd_version_trip_price($1, $2, $3)',
              [p.hash, tripId, quote],
            )
          ).rows[0]!;
        expect(await version(b.quoteId)).toEqual({ outcome: 'QUOTE_MISMATCH', version: null });
        const d = quoteDocs(cc, v, w.groups, Date.parse(START), Date.parse(NOW));
        const stale = await frozenQuote(tx, p, b.listingId, d);
        await setClock(tx, at(NOW, 31));
        expect(await version(stale)).toEqual({ outcome: 'QUOTE_EXPIRED', version: null });
        const fresh = await frozenQuote(
          tx,
          p,
          b.listingId,
          quoteDocs(cc, v, w.groups, Date.parse(START), Date.parse(at(NOW, 31))),
        );
        expect(await version(fresh)).toEqual({ outcome: 'DONE', version: 1 });
      });
    });
  },
);

describe('US-223 rôles', () => {
  it('commandes du paiement par jeton : app_api seul ; lecture des conditions et version n° 1 : app_worker seul', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const sql of [
          'SELECT core.booking_cmd_checkout_pay($1, $2, $3)',
          'SELECT core.booking_cmd_checkout_record_order($1, $2, $4, $3, NULL)',
          'SELECT * FROM core.booking_checkout_payment($1, $2)',
        ]) {
          const args = sql.includes('$4')
            ? [Buffer.alloc(32), uuid(), 'x', uuid()]
            : sql.includes('$3')
              ? [Buffer.alloc(32), uuid(), 'CARD']
              : [Buffer.alloc(32), uuid()];
          await expect(client.query(sql, args), `${role} ${sql}`).rejects.toMatchObject({
            code: '42501',
          });
        }
      });
    }
    for (const role of ['app_api', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query('SELECT * FROM core.booking_checkout_capture_terms($1)', [uuid()]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          client.query('SELECT core.pricing_bind_checkout_trip($1)', [uuid()]),
        ).rejects.toMatchObject({ code: '42501' });
        await expect(
          client.query('SELECT * FROM core.booking_conversion_due(10)'),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
  });
});
