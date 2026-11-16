/**
 * Preuves de la distance figée dans le devis et des conditions du checkout (US-205 partie 205b ;
 * migrations 0117 et 0118, ADR-140 ; fixture 9971) sous les rôles de production (assertion L0-05 en
 * tête de chaque connexion : `withRole`), en USD (PA) et en PYG sans décimale (PY). Personnes,
 * sessions et devis par les VRAIES commandes ; interrupteurs ouverts par la procédure à deux
 * personnes d'US-125 dans une transaction ANNULÉE.
 *
 * Attendus : jamais le code testé. Ils viennent de 19 US-205 (critère 2 : « 200 km / j et 3 jours
 * facturables ⇒ 600 km incluidos » et le même prix du km au checkout, au contrat et au reçu), de
 * 16 LST-012 et de 08 BR-CXL-01 (formulation exécutable : en dernière minute,
 * `freeUntil = min(bookedAt + fenêtre, start)`). Vecteurs du devis : ceux de
 * l0-us209-risk-checkout.test.ts (TA01 en PA, D2 de 08 en PY, protection BASICA de TEST).
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import {
  checkoutPerson,
  frozenQuote,
  listedListing,
  openSwitch,
  protectionParams,
  quoteDocs,
  setClock,
  taxGroups,
} from '../support/checkout.ts';
import type { CheckoutVector, QuoteDocs } from '../support/checkout.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const NOW = '2026-12-01T12:00:00.000Z';
const START = '2026-12-10T15:00:00.000Z';
const MIN = 60_000;
const FREEZE = 'SELECT * FROM core.pricing_cmd_freeze_quote($1, $2, $3, $4, $5, $6)';
const READ = 'SELECT * FROM core.pricing_checkout_terms($1, $2::uuid)';

/** Vecteurs du devis de 3 jours (en-tête de l0-us209-risk-checkout.test.ts). */
const VECTORS: Readonly<Record<string, CheckoutVector>> = {
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
  },
};

/** Prix du km supplémentaire de TEST de l'annonce, unités mineures de la devise du pays. */
const EXTRA_KM: Readonly<Record<string, number>> = { PA: 35, PY: 3_000 };

const sha = (prefix: string, text: string): string =>
  createHash('sha256')
    .update(prefix + text, 'utf8')
    .digest('hex');

/** Documents du devis avec la distance (forme de frozen.ts) : demande et sorties, empreintes. */
function withMileage(d: QuoteDocs, request: object | null, output: object | null): QuoteDocs {
  const inputs = JSON.parse(d.inputs) as { request: Record<string, unknown> };
  const outputs = JSON.parse(d.outputs) as Record<string, unknown>;
  if (request !== null) inputs.request['mileage'] = request;
  if (output !== null) outputs['mileage'] = output;
  const i = JSON.stringify(inputs);
  const o = JSON.stringify(outputs);
  return {
    inputs: i,
    inputsHash: sha('rueda.quote.inputs/1\n', i),
    outputs: o,
    outputsHash: sha('rueda.quote.outputs/1\n', o),
  };
}

function scenario(cc: CountryCase) {
  return (fn: (tx: Tx, groups: Map<string, string>) => Promise<void>) =>
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
        await fn(tx, await taxGroups(tx, cc));
      }),
    );
}

/** Annonce LISTED (fixture 9998) avec 200 km par jour et le prix du km de TEST du pays. */
async function includedListing(tx: Tx, cc: CountryCase): Promise<string> {
  const l = await listedListing(tx, cc, VECTORS[cc.country]!.daily);
  await tx.query('SELECT test_fixture.us205b_set_listing_mileage($1, $2, $3, $4)', [
    l.listingId,
    'INCLUDED',
    200,
    EXTRA_KM[cc.country],
  ]);
  return l.listingId;
}

async function mileageOf(tx: Tx, quoteId: string): Promise<Row | undefined> {
  return (await tx.query<Row>('SELECT * FROM test_fixture.us205b_quote_mileage($1)', [quoteId]))
    .rows[0];
}

describe.each(COUNTRIES)('US-205b — distance figée dans le devis ($country, $currency)', (cc) => {
  const docs = (groups: Map<string, string>) =>
    quoteDocs(cc, VECTORS[cc.country]!, groups, Date.parse(START), Date.parse(NOW));

  it('critère 2 : 200 km par jour × 3 jours facturables ⇒ 600 km et prix du km de l’annonce figés ; documents rejoués ; lecture du checkout par le seul voyageur de la session', async () => {
    await scenario(cc)(async (tx, groups) => {
      const listing = await includedListing(tx, cc);
      const extra = String(EXTRA_KM[cc.country]);
      const d = withMileage(
        docs(groups),
        { mode: 'INCLUDED', kmPerDay: 200, extraKmPrice: extra },
        { mode: 'INCLUDED', kmPerDay: 200, includedKm: 600, extraKmPrice: extra },
      );
      const guest = await checkoutPerson(tx, cc.country);
      const quoteId = await frozenQuote(tx, guest, listing, d);
      expect(await mileageOf(tx, quoteId)).toEqual({
        mileage_mode: 'INCLUDED',
        included_km: 600,
        extra_km_price_minor: extra,
      });
      const [row] = (await tx.query<Row>(READ, [guest.hash, quoteId])).rows;
      expect(row).toMatchObject({
        quote_id: quoteId,
        engine_version: 'prc.quote/3',
        inputs: d.inputs,
        inputs_hash: d.inputsHash,
        outputs: d.outputs,
        outputs_hash: d.outputsHash,
        total_minor: String(VECTORS[cc.country]!.total),
        currency: cc.currency,
        mileage_mode: 'INCLUDED',
        included_km: 600,
        extra_km_price_minor: extra,
      });
      // autre voyageur, session inconnue : aucune ligne (même réponse)
      const other = await checkoutPerson(tx, cc.country);
      expect((await tx.query(READ, [other.hash, quoteId])).rows).toEqual([]);
      expect((await tx.query(READ, [Buffer.alloc(32, 9), quoteId])).rows).toEqual([]);
    });
  });

  it('distance de la demande ou des sorties différente de l’annonce ou du rejeu, ou présente d’un seul côté ⇒ QUOTE_MISMATCH, rien d’écrit', async () => {
    await scenario(cc)(async (tx, groups) => {
      const listing = await includedListing(tx, cc);
      const extra = String(EXTRA_KM[cc.country]);
      const guest = await checkoutPerson(tx, cc.country);
      const good = { mode: 'INCLUDED', kmPerDay: 200, extraKmPrice: extra };
      const goodOut = { ...good, includedKm: 600 };
      const cases: [object | null, object | null][] = [
        [
          { ...good, kmPerDay: 150 },
          { ...goodOut, kmPerDay: 150, includedKm: 450 },
        ],
        [
          { ...good, extraKmPrice: '1' },
          { ...goodOut, extraKmPrice: '1' },
        ],
        [good, { ...goodOut, includedKm: 599 }],
        [{ mode: 'UNLIMITED' }, { mode: 'UNLIMITED' }],
        [good, null],
        [null, goodOut],
      ];
      for (const [req, out] of cases) {
        const d = withMileage(docs(groups), req, out);
        const { rows } = await tx.query<{ outcome: string; quote_id: string | null }>(FREEZE, [
          guest.hash,
          listing,
          d.inputs,
          d.inputsHash,
          d.outputs,
          d.outputsHash,
        ]);
        expect(rows[0], JSON.stringify([req, out])).toEqual({
          outcome: 'QUOTE_MISMATCH',
          quote_id: null,
        });
      }
    });
  });

  it('documents sans distance (client antérieur) ⇒ distance de l’annonce figée quand même ; annonce illimitée ⇒ UNLIMITED, ni km ni prix du km', async () => {
    await scenario(cc)(async (tx, groups) => {
      const listing = await includedListing(tx, cc);
      const guest = await checkoutPerson(tx, cc.country);
      const legacy = await frozenQuote(tx, guest, listing, docs(groups));
      expect(await mileageOf(tx, legacy)).toEqual({
        mileage_mode: 'INCLUDED',
        included_km: 600,
        extra_km_price_minor: String(EXTRA_KM[cc.country]),
      });
      const free = await listedListing(tx, cc, VECTORS[cc.country]!.daily);
      const d = withMileage(docs(groups), { mode: 'UNLIMITED' }, { mode: 'UNLIMITED' });
      const q = await frozenQuote(tx, guest, free.listingId, d);
      expect(await mileageOf(tx, q)).toEqual({
        mileage_mode: 'UNLIMITED',
        included_km: null,
        extra_km_price_minor: null,
      });
    });
  });

  it('08 BR-CXL-01 : fenêtre de dernière minute lue du paramètre du pays (90 min ⇒ maintenant + 90 min), jamais après le départ', async () => {
    await scenario(cc)(async (tx) => {
      const listing = await includedListing(tx, cc);
      await tx.query('SELECT test_fixture.us205b_set_window($1, $2)', [cc.country, 90]);
      const now = Date.parse(START) - 20 * 60 * MIN;
      await setClock(tx, new Date(now).toISOString());
      const terms = async () =>
        (
          await tx.query<Row>(
            'SELECT * FROM core.catalog_public_terms($1::uuid, $2::timestamptz)',
            [listing, START],
          )
        ).rows[0];
      const late = await terms();
      expect(late).toMatchObject({ last_minute: true, last_minute_window_minutes: 90 });
      expect((late?.['free_until'] as Date).getTime()).toBe(now + 90 * MIN);
      await setClock(tx, new Date(Date.parse(START) - 60 * MIN).toISOString());
      expect(((await terms())?.['free_until'] as Date).getTime()).toBe(Date.parse(START));
    });
  });
});

describe('US-205b — droits', () => {
  it('app_anon et app_worker ne peuvent pas exécuter core.pricing_checkout_terms ; app_api ne lit pas les documents du devis directement', async () => {
    for (const role of ['app_anon', 'app_worker'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query(READ, [Buffer.alloc(32, 1), '00000000-0000-4000-8000-000000000001']),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
    await withRole('app_api', async (client) => {
      await expect(
        client.query('SELECT inputs, mileage_mode FROM core.pricing_quote'),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
