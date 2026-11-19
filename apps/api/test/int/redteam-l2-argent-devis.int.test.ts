/**
 * US-222b — red team argent du lot 2, axe « devis et ordre au PSP » (19 US-222 critère 2,
 * scénarios 1 « devis modifié côté client », 2 « jambe négative » au devis, 7 « prorata » au
 * checkout ; pré-mortem L2 : RT-L2-M01, M02, M03, M04 ; risques L2-PM-03, L2-PM-04, L2-PM-06).
 * Rapport : docs/team/redteam/L2-argent.md.
 *
 * Joué en CI contre le PSP `FAKE`, sur PostgreSQL réel, sous les rôles de PRODUCTION (`connectAs` :
 * assertion L0-05 en tête de chaque test), en USD (PA) et en PYG sans décimale (PY). Les
 * interrupteurs `p2p_private_hosts_enabled` et `insurer_contract_active` ne s'ouvrent que dans une
 * transaction ANNULÉE, par la vraie procédure à deux personnes (US-125) ; ils sont relus fermés
 * après. Aucun correctif de produit (L2-PM-39) : un test vert prouve que l'attaque est BLOQUÉE ; un
 * défaut est prouvé par un `it.fails` documenté, nommé par son constat (F-L2-ARG-nn), dont
 * l'observation est faite par un test vert qui affirme que l'attaque a bien été jouée.
 *
 * Attendus : codes de 16 (QUOTE_MISMATCH, QUOTE_EXPIRED, LEG_AMOUNT_NEGATIVE,
 * PROTECTION_LEVEL_REQUIRED) ; montants du devis du checkout dérivés de 08 et de la configuration
 * du dépôt (même dérivation que parcours-dores-reservation.int.test.ts, US-221) ; jambes de TJ13a /
 * TJ13c pour la promotion qui rend PLATFORM négative ; jamais le code testé.
 */
import { createHash, randomUUID } from 'node:crypto';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import { money, type Currency } from '@rueda/money';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  CheckoutPaymentService,
  PgCheckoutPaymentStore,
  PgCheckoutStore,
  type HostedPaymentProvider,
} from '../../src/modules/avl/index.js';
import { CountryConfigService } from '../../src/modules/cfg/index.js';
import {
  freezeQuote,
  PgQuoteStore,
  QuoteService,
  type FrozenQuote,
} from '../../src/modules/prc/index.js';
import type {
  CreateHostedPaymentRequest,
  DepositEnforcement,
  DepositGuestView,
  HostedPayment,
} from '../../src/modules/pay/index.js';
import {
  ALL_CLOSED,
  CASES,
  DAY,
  MINUTE,
  capabilities,
  inTx,
  invariant,
  iso,
  open,
  openSession,
  openSwitch,
  register,
  sum,
  switches,
  type Case,
  type Legs,
} from '../support/redteam-l2.js';

/**
 * Devis du checkout par exposant de la devise (configuration du dépôt : BASICA 1/4 du prix
 * journalier, part de l'assureur 7/10, plan ESTÁNDAR 3/4, barème du trip fee du pays ; 08 E7
 * règle 2) — dérivation reprise de parcours-dores-reservation.int.test.ts (US-221) :
 * - exposant 2 : P 120,00 ; F 18,00 ; taxe 7 % 8,40 + 1,26 ; BASICA 30,00 ; total 177,66 ; HOST
 *   90,00 ; INSURER 21,00 ; TAX 0 ; PLATFORM 66,66 ;
 * - exposant 0 : P 1 000 002 ; F 150 000 ; taxe 10 % 100 000 + 15 000 ; BASICA 250 002 ; total
 *   1 515 004 ; HOST 750 001 (TJ09c) ; INSURER 175 001 ; TAX 0 ; PLATFORM 590 002.
 * `bigPromo` : promotion plateforme de TJ13a (−90,00, USD) / TJ13c (−900 000, PYG) appliquée à ce
 * devis : PLATFORM = 81,36 − 90,00 − 21,00 = −29,64 (USD) et 525 004 − 750 001 − 175 001 =
 * −399 998 (PYG) ⇒ LEG_AMOUNT_NEGATIVE (TJ13a, TJ13c). `smallPromo` : promotion de l'hôte de
 * 10,00 / 100 000 (PLATFORM reste positive : aucune règle de jambe ne la refuse).
 */
interface CheckoutExpected {
  readonly daily: string;
  readonly total: bigint;
  readonly legs: Legs;
  readonly bigPromo: bigint;
  readonly smallPromo: bigint;
}
const CHECKOUT: Readonly<Record<number, CheckoutExpected>> = {
  2: {
    daily: '4000',
    total: 17766n,
    legs: { HOST: 9000n, INSURER: 2100n, TAX_THIRD_PARTY: 0n, PLATFORM: 6666n },
    bigPromo: 9000n,
    smallPromo: 1000n,
  },
  0: {
    daily: '333334',
    total: 1515004n,
    legs: { HOST: 750001n, INSURER: 175001n, TAX_THIRD_PARTY: 0n, PLATFORM: 590002n },
    bigPromo: 900000n,
    smallPromo: 100000n,
  },
};

const NOW = '2026-12-02T12:00:00.000Z';
const START_MS = Date.parse('2026-12-10T15:00:00.000Z');
const END_MS = START_MS + 3 * DAY;

const OUTPUTS_PREFIX = 'rueda.quote.outputs/1\n';
const INPUTS_PREFIX = 'rueda.quote.inputs/1\n';
const digest = (prefix: string, text: string): string =>
  createHash('sha256')
    .update(prefix + text, 'utf8')
    .digest('hex');
type Doc = Record<string, unknown> & {
  request?: Record<string, unknown> & { lines?: Record<string, string> };
  lines?: { type: string; amount: string; taxGroup: string | null; tax: string }[];
  legs?: Record<string, string>;
};
/**
 * Devis figé modifié par l'attaquant : il connaît le format et recalcule lui-même les empreintes
 * (SHA-256 public), sauf `keepHashes` (empreintes d'origine gardées).
 */
function tamper(
  frozen: FrozenQuote,
  edit: { readonly inputs?: (d: Doc) => void; readonly outputs?: (d: Doc) => void },
  keepHashes = false,
): FrozenQuote {
  const inputs = JSON.parse(frozen.inputs) as Doc;
  const outputs = JSON.parse(frozen.outputs) as Doc;
  edit.inputs?.(inputs);
  edit.outputs?.(outputs);
  const i = JSON.stringify(inputs);
  const o = JSON.stringify(outputs);
  return {
    ...frozen,
    inputs: i,
    outputs: o,
    inputsHash: keepHashes ? frozen.inputsHash : digest(INPUTS_PREFIX, i),
    outputsHash: keepHashes ? frozen.outputsHash : digest(OUTPUTS_PREFIX, o),
  };
}
const shift = (v: string | undefined, d: bigint): string => (BigInt(v ?? '0') + d).toString();

/** PSP FAKE de la page hébergée : garde chaque ordre reçu (montant et jambes explicites). */
class FakeHostedPsp implements HostedPaymentProvider {
  readonly orders: CreateHostedPaymentRequest[] = [];
  createHostedPayment(request: CreateHostedPaymentRequest): Promise<HostedPayment> {
    this.orders.push(request);
    return Promise.resolve({
      providerReference: `fake-${randomUUID()}`,
      redirectUrl: 'https://psp.example.test/pay',
      expiresAt: null,
    });
  }
  getOperation(): Promise<null> {
    return Promise.resolve(null);
  }
}
/** Porte de la caution « aucune caution » (couture assumée, comme US-221 ; prouvée par US-701). */
class NoDepositGate {
  view(): Promise<DepositGuestView | null> {
    return Promise.resolve(null);
  }
  enforce(): Promise<DepositEnforcement> {
    return Promise.resolve({ kind: 'ACCEPTED', view: { status: 'NONE' } });
  }
}

/** Fournisseur du compte que T1 retiendrait À CET INSTANT (ordre de `booking_cmd_checkout_pay`). */
async function firstProvider(worker: pg.ClientBase, country: string): Promise<string | null> {
  const { rows } = await worker.query<{ provider: string }>(
    `SELECT provider FROM core.payment_psp_account WHERE country_code = $1 AND status = 'ACTIVE'
      ORDER BY (environment = 'LIVE') DESC, provider, id LIMIT 1`,
    [country],
  );
  return rows[0]?.provider ?? null;
}
/**
 * Essai de T1 sur le compte FAKE du pays (constat C-1 d'US-221 : les scènes de
 * concurrence-webhook ouvrent un temps un compte EBANX ACTIVE, retenu avant FAKE) : retenu
 * seulement si FAKE est en tête avant et après lui, sinon annulé par son point de sauvegarde.
 */
async function onFakeAccount<T>(
  tx: pg.ClientBase,
  country: string,
  psp: FakeHostedPsp,
  attempt: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  const worker = await open('app_worker');
  for (let i = 0; i < 240; i++) {
    if ((await firstProvider(worker, country)) === 'FAKE') {
      await tx.query('SAVEPOINT rt_l2_fake');
      const sent = psp.orders.length;
      let out: { ok: true; value: T } | { ok: false; error: unknown };
      try {
        out = { ok: true, value: await attempt() };
      } catch (error) {
        out = { ok: false, error };
      }
      if ((await firstProvider(worker, country)) === 'FAKE') {
        await tx.query(
          out.ok ? 'RELEASE SAVEPOINT rt_l2_fake' : 'ROLLBACK TO SAVEPOINT rt_l2_fake',
        );
        return out;
      }
      await tx.query('ROLLBACK TO SAVEPOINT rt_l2_fake');
      psp.orders.splice(sent);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('le compte FAKE n’est jamais resté en tête');
}

interface Observed {
  promoHost?: { outcome: string; total: string | null };
  promoPlatform?: { outcome: string; total: string | null };
}
/** Observations des attaques à défaut (lues par les `it.fails`), par pays. */
const observed = new Map<string, Observed>();

describe.each(CASES)(
  'RT-L2-ARG — devis, checkout, ordre au PSP ($country, $currency)',
  (c: Case) => {
    const obs: Observed = {};
    observed.set(c.country, obs);

    it(
      'S1 / S2 / S7 : devis modifié côté client (total, ligne, jambes, taux, période, protection, empreinte) ⇒ QUOTE_MISMATCH ou PROTECTION_LEVEL_REQUIRED, rien de figé ; promotion qui rend PLATFORM négative (TJ13a / TJ13c) ⇒ LEG_AMOUNT_NEGATIVE en TypeScript et en base ; devis échu ⇒ QUOTE_EXPIRED ; T1 : montant du devis rejoué par la base, montant EXPLICITE de chaque jambe, aucun montant du client ; interrupteurs refermés ; invariant par jambe',
      { timeout: 240_000 },
      async () => {
        const api = await open('app_api');
        const service = new QuoteService(new CountryConfigService());
        const currency: Currency = service.params({
          country: c.country,
          at: new Date(NOW),
        }).currency;
        const want = CHECKOUT[currency.exponent];
        if (want === undefined)
          throw new Error(`aucun attendu pour l'exposant ${currency.exponent}`);
        expect(sum(want.legs)).toBe(want.total);
        await inTx(api, { commit: true }, async (tx) => {
          await tx.query('SELECT test_fixture.us024_psp_account($1)', [c.country]);
        });

        await inTx(api, { at: NOW }, async (tx) => {
          await openSwitch(tx, 'p2p_private_hosts_enabled', c.country);
          await openSwitch(tx, 'insurer_contract_active', c.country);
          const { rows } = await tx.query<{ listing_id: string }>(
            'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
            [c.country, want.daily, 'AUTOMATIC', true],
          );
          const listingId = rows[0]!.listing_id;
          const guest = await register(tx, c.country);
          await tx.query('SELECT test_fixture.us209_driver($1, $2, $3::date, $4::date, $5)', [
            guest,
            c.country,
            '1990-01-01',
            '2030-12-31',
            c.country,
          ]);
          const hash = await openSession(tx, guest);
          const checkout = new PgCheckoutStore(tx);
          const quotes = new PgQuoteStore(tx);
          const listing = await checkout.listing(listingId);
          if (listing === null) throw new Error('annonce du checkout introuvable');
          const params = service.params({
            country: listing.country,
            at: new Date(listing.quotedAtMs),
            hostPlan: listing.hostPlan,
          });
          const level = params.protectionGrid?.minLevel;
          expect(level).toBe('BASICA');
          const request = (lines?: Record<string, bigint>) => ({
            startAtMs: START_MS,
            endAtMs: END_MS,
            quotedAtMs: listing.quotedAtMs,
            rateType: 'REFUNDABLE' as const,
            dailyRate: money(BigInt(listing.dailyPriceMinor), params.currency),
            ...(level === undefined ? {} : { protectionLevel: level }),
            mileage: { mode: 'UNLIMITED' as const },
            ...(lines === undefined
              ? {}
              : {
                  lines: Object.fromEntries(
                    Object.entries(lines).map(([k, v]) => [k, money(v, params.currency)]),
                  ),
                }),
          });
          const { frozen } = freezeQuote(request(), params);
          const legit = JSON.parse(frozen.outputs) as Doc;
          expect(legit.legs).toEqual(
            Object.fromEntries(Object.entries(want.legs).map(([k, v]) => [k, v.toString()])),
          );
          const unit = currency.exponent === 0 ? 100n : 1n;

          // --- S1 : devis modifié côté client (chaque attaque : empreintes recalculées) ----------
          const attacks: readonly [string, FrozenQuote, string][] = [
            [
              'total − 1 (et PLATFORM − 1)',
              tamper(frozen, {
                outputs: (d) => {
                  d['total'] = shift(d['total'] as string, -unit);
                  d.legs!['PLATFORM'] = shift(d.legs!['PLATFORM'], -unit);
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'valeur déplacée de PLATFORM vers HOST (total inchangé)',
              tamper(frozen, {
                outputs: (d) => {
                  d.legs!['PLATFORM'] = shift(d.legs!['PLATFORM'], -unit);
                  d.legs!['HOST'] = shift(d.legs!['HOST'], unit);
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'ligne TRIP_FEE retirée et total réduit',
              tamper(frozen, {
                outputs: (d) => {
                  const fee = d.lines!.find((l) => l.type === 'TRIP_FEE')!;
                  d.lines = d.lines!.filter((l) => l.type !== 'TRIP_FEE');
                  const cut = BigInt(fee.amount) + BigInt(fee.tax);
                  d['total'] = shift(d['total'] as string, -cut);
                  d.legs!['PLATFORM'] = shift(d.legs!['PLATFORM'], -cut);
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'taxes mises à zéro',
              tamper(frozen, {
                outputs: (d) => {
                  const tax = BigInt(d['taxTotal'] as string);
                  for (const l of d.lines!) l.tax = '0';
                  d['taxTotal'] = '0';
                  d['total'] = shift(d['total'] as string, -tax);
                  d.legs!['PLATFORM'] = shift(d.legs!['PLATFORM'], -tax);
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'niveau de protection changé dans les sorties',
              tamper(frozen, {
                outputs: (d) => {
                  d['protectionLevel'] = 'PREMIUM';
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'prix journalier abaissé dans la demande',
              tamper(frozen, {
                inputs: (d) => {
                  d.request!['dailyRate'] = shift(d.request!['dailyRate'] as string, -unit);
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'TRIP_PRICE fourni par la demande',
              tamper(frozen, {
                inputs: (d) => {
                  d.request!.lines = { ...d.request!.lines, TRIP_PRICE: '1' };
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'TRIP_FEE fourni à 0 par la demande',
              tamper(frozen, {
                inputs: (d) => {
                  d.request!.lines = { ...d.request!.lines, TRIP_FEE: '0' };
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'période allongée d’un jour (mêmes sorties)',
              tamper(frozen, {
                inputs: (d) => {
                  d.request!['endAtMs'] = END_MS + DAY;
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'version de moteur inconnue',
              tamper(frozen, {
                outputs: (d) => {
                  d['engineVersion'] = 'prc.quote/1';
                },
              }),
              'QUOTE_MISMATCH',
            ],
            [
              'protection retirée de la demande (16 PRT-011)',
              tamper(frozen, {
                inputs: (d) => {
                  delete d.request!['protectionLevel'];
                },
              }),
              'PROTECTION_LEVEL_REQUIRED',
            ],
            [
              'total réduit, empreintes d’origine gardées',
              tamper(
                frozen,
                {
                  outputs: (d) => {
                    d['total'] = shift(d['total'] as string, -unit);
                  },
                },
                true,
              ),
              'QUOTE_MISMATCH',
            ],
          ];
          for (const [label, forged, code] of attacks) {
            const r = await quotes.freeze(hash, listingId, forged);
            expect(r, label).toEqual({ outcome: code, quoteId: null });
          }

          // --- S2 : promotion plateforme qui rend PLATFORM négative (TJ13a / TJ13c) ---------------
          let engineCode: unknown = null;
          try {
            freezeQuote(request({ PROMO_PLATFORM: -want.bigPromo }), params);
          } catch (error) {
            engineCode = (error as { code?: unknown }).code;
          }
          expect(engineCode).toBe('LEG_AMOUNT_NEGATIVE');
          const negative = await quotes.freeze(
            hash,
            listingId,
            tamper(frozen, {
              inputs: (d) => {
                d.request!.lines = { PROMO_PLATFORM: (-want.bigPromo).toString() };
              },
            }),
          );
          expect(negative).toEqual({ outcome: 'LEG_AMOUNT_NEGATIVE', quoteId: null });

          // --- observation F-L2-ARG-01 : remise sans source portée par la demande -----------------
          // aucune promotion n'existe en bêta (ni code, ni module, ni écrivain) : la demande de l'API
          // porte pourtant ces lignes jusqu'au gel ; l'issue est notée, jugée par l'it.fails
          for (const [key, line] of [
            ['promoHost', 'PROMO_HOST'],
            ['promoPlatform', 'PROMO_PLATFORM'],
          ] as const) {
            await tx.query('SAVEPOINT rt_l2_promo');
            const forged = freezeQuote(request({ [line]: -want.smallPromo }), params).frozen;
            const r = await quotes.freeze(hash, listingId, forged);
            obs[key] = {
              outcome: r.outcome,
              total:
                r.quoteId === null ? null : (await checkout.quote(hash, r.quoteId))!.totalMinor,
            };
            await tx.query('ROLLBACK TO SAVEPOINT rt_l2_promo');
          }
          expect(obs.promoHost?.outcome).toMatch(/^[A-Z_]+$/);
          expect(obs.promoPlatform?.outcome).toMatch(/^[A-Z_]+$/);

          // --- devis légitime : seul le rejeu de la base fait foi ---------------------------------
          const gel = await quotes.freeze(hash, listingId, frozen);
          expect(gel.outcome).toBe('DONE');
          const quoteId = gel.quoteId!;
          const quote = await checkout.quote(hash, quoteId);
          if (quote === null) throw new Error('devis figé illisible');
          expect(BigInt(quote.totalMinor)).toBe(want.total);
          const demand = {
            driverFirstName: 'Ana',
            driverLastName: 'Pérez',
            manualTransmissionConfirmed: false,
            acceptedDocuments: quote.documents.map((d) => ({ kind: d.kind, version: d.version })),
          };

          // devis échu (16 PRC-025) : checkout refusé, rien de posé (point de sauvegarde)
          if (quote.expiresAt === null) throw new Error('devis sans échéance');
          await tx.query('SAVEPOINT rt_l2_expired');
          await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
            iso(Date.parse(quote.expiresAt) + MINUTE),
          ]);
          expect((await checkout.checkout(hash, quoteId, demand)).outcome).toBe('QUOTE_EXPIRED');
          await tx.query('ROLLBACK TO SAVEPOINT rt_l2_expired');

          const placed = await checkout.checkout(hash, quoteId, demand);
          expect(placed.outcome).toBe('DONE');
          const holdId = placed.holdId!;

          // --- S7 : T1 — ordre au PSP, montant explicite de chaque jambe, aucun montant du client
          const psp = new FakeHostedPsp();
          const pay = new CheckoutPaymentService(
            new PgCheckoutPaymentStore(tx),
            new Map([['FAKE', psp]]),
            new NoDepositGate(),
            () => undefined,
          );
          await capabilities(tx, c.country, iso(Date.parse(NOW) - 3 * MINUTE));
          // le client envoie un montant, des jambes ou une remise : la requête n'admet que le moyen
          // (T1 = jeton, hold, moyen) ⇒ REQUEST_INVALID, aucun ordre ; le montant est celui du devis
          for (const hostile of [
            { method: 'CARD', amountMinor: '1' },
            {
              method: 'CARD',
              legs: { HOST: '1', INSURER: '0', TAX_THIRD_PARTY: '0', PLATFORM: '0' },
            },
            { method: 'CARD', totalMinor: (want.total - 1n).toString() },
            { method: 'CARD', quoteId: randomUUID() },
          ]) {
            await expect(
              pay.pay(hash, holdId, hostile),
              JSON.stringify(hostile),
            ).rejects.toMatchObject({ code: 'REQUEST_INVALID' });
          }
          expect(psp.orders).toEqual([]);
          const paid = await onFakeAccount(tx, c.country, psp, () =>
            pay.pay(hash, holdId, { method: 'CARD' }),
          );
          if (!paid.ok) throw new Error('paiement refusé', { cause: paid.error });
          expect(psp.orders).toHaveLength(1);
          const order = psp.orders[0]!;
          expect(order).toMatchObject({ amountMinor: want.total, currency: c.currency });
          expect({ ...order.legs }).toEqual(want.legs);
          expect(sum({ ...order.legs } as Legs)).toBe(order.amountMinor);
          // second clic, deux onglets : aucun second ordre (l'état fait foi, L2-PM-01)
          expect((await pay.pay(hash, holdId, { method: 'CARD' })).created).toBe(false);
          expect(psp.orders).toHaveLength(1);
        });

        // transaction annulée : aucun interrupteur ouvert ne survit (17 §0.1) ; invariant par jambe
        await inTx(api, { at: NOW }, async (tx) => {
          expect(await switches(tx, c.country)).toEqual(ALL_CLOSED);
        });
        await invariant(c.country);
      },
    );

    // F-L2-ARG-01 (constat, gravité PROPOSÉE élevée) : la commande de gel (0118) rejoue le prix,
    // le trip fee, la protection et les taxes, mais LIT de la demande les lignes PROMO_PLATFORM,
    // PROMO_HOST, EXTRAS, ADDITIONAL_DRIVER_FEE, YOUNG_DRIVER_FEE et DELIVERY_FEE, sans source en base
    // (aucune promotion ni option n'existe en bêta). Un appelant app_api fige donc une remise de
    // l'hôte (prise sur sa jambe HOST, sans son accord) ou de la plateforme. Attendu (défaut
    // fail-closed, comme les crédits refusés en bêta, N-367) : gel refusé tant que la ligne n'a pas
    // de source vérifiée. Suite proposée : N-xxx-A (rapport).
    it.fails(
      'F-L2-ARG-01 : une remise de l’hôte portée par la demande (PROMO_HOST, sans code ni accord) est refusée au gel',
      async () => {
        await open('app_api'); // L0-05
        // observation absente (attaque non jouée) : l'assertion passe et l'it.fails rougit
        expect(observed.get(c.country)?.promoHost?.outcome).not.toBe('DONE');
      },
    );
    it.fails(
      'F-L2-ARG-01 : une remise de la plateforme portée par la demande (PROMO_PLATFORM, aucune promotion en bêta) est refusée au gel',
      async () => {
        await open('app_api'); // L0-05
        expect(observed.get(c.country)?.promoPlatform?.outcome).not.toBe('DONE');
      },
    );
  },
);
