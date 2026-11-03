/**
 * US-061 — port de place de marché sur l'adaptateur FAKE (17 §2.8 ; 08 E7 règles 1 à 3 bis, 6, 7,
 * 10 ; ADR-066), dans chaque devise des vecteurs (USD à 2 décimales, PYG sans décimale ;
 * CLAUDE.md contrainte 3). Montants : vecteurs TJ de `@rueda/money/golden-vectors` (jamais
 * calculés ici) ; pays : configuration pays (`CountryConfigService`), jamais une constante.
 *
 * - Critère 1 : Σ jambes ≠ montant ou jambe négative ⇒ LEG_SUM_MISMATCH / LEG_AMOUNT_NEGATIVE,
 *   aucun mouvement (suite de contrat, méthodes qui déplacent des fonds, `transferFromPlatform`
 *   compris).
 * - Critère 2 : jambe libérée ⇒ LEG_ALREADY_RELEASED ; TJ18b accepté (suite de contrat).
 * - Critère 3 : chaque capacité bloquante UNKNOWN ⇒ HOST_PAYOUT_RAIL_UNAVAILABLE à l'enregistrement
 *   d'un hôte ET au paiement, sans appel au PSP.
 * - Critère 4 : FAKE en mode « prorata » ⇒ le test de contrat détecte l'écart (TJ10c) et le refuse.
 * - Critère 5 : chaque méthode idempotente par sa clé (suite de contrat ; un seul mouvement ici).
 */
import { legVector, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type { GoldenLegVector } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../cfg/index.js';
import { isPaymentError } from '../internal/errors.js';
import type { PaymentErrorCode } from '../internal/errors.js';
import { debitFromVariation, LEGS } from '../internal/legs.js';
import type { LegAmounts } from '../internal/legs.js';
import { describeMarketplaceContract, perLegDiscrepancies } from './contract.js';
import type { MarketplaceHarness } from './contract.js';
import { fakeStack } from './fake-stack.js';
import type { FakeStackOptions } from './fake-stack.js';

const set = loadGoldenVectors();
const legsOf = (v: GoldenLegVector): LegAmounts => ({ ...v.legsMinor });
const debit = (v: GoldenLegVector) => ({
  amountMinor: -v.totalMinor,
  legs: debitFromVariation(legsOf(v)),
});
const amounts = (v: GoldenLegVector) => ({ amountMinor: v.totalMinor, legs: legsOf(v) });

/** Pays configuré de chaque devise (configuration pays, jamais une constante du code). */
const COUNTRY_OF = new Map(
  [...new CountryConfigService().config.countries.values()].map((c) => [c.currency.code, c.code]),
);
const countryOf = (currency: string): string => {
  const country = COUNTRY_OF.get(currency);
  if (country === undefined) throw new Error(`aucun pays configuré en ${currency}`);
  return country;
};

/** Vecteurs par devise : capture, jambe libérée (TJ18), fidélité par jambe (TJ10 / TJ02). */
const CASES = [
  {
    capture: legVector(set, 'TJ01'),
    theory: legVector(set, 'TJ18a'),
    executed: legVector(set, 'TJ18b'),
    fidelity: { capture: legVector(set, 'TJ01'), refund: legVector(set, 'TJ02b') },
    prorata: null,
  },
  {
    capture: legVector(set, 'TJ08a'),
    theory: legVector(set, 'TJ18c'),
    executed: legVector(set, 'TJ18d'),
    fidelity: { capture: legVector(set, 'TJ10a'), refund: legVector(set, 'TJ10b') },
    // contre-exemple de 08 E7 règle 1 : le même remboursement ventilé au prorata
    prorata: legVector(set, 'TJ10c'),
  },
];
type Case = (typeof CASES)[number];

function harness(c: Case, options: FakeStackOptions = {}) {
  const stack = fakeStack(options);
  const h: MarketplaceHarness = {
    provider: stack.provider,
    currency: c.capture.currency,
    country: countryOf(c.capture.currency),
    capture: amounts(c.capture),
    releasedTheory: debit(c.theory),
    releasedExecuted: debit(c.executed),
    fidelity: { capture: amounts(c.fidelity.capture), refund: debit(c.fidelity.refund) },
    customerPays: (ref) => {
      stack.psp.customerPays(ref);
      return Promise.resolve();
    },
    approveKyc: (ref) => {
      stack.psp.setSubmerchantStatus(ref, 'ACTIVE');
      return Promise.resolve();
    },
  };
  return { stack, h };
}

for (const c of CASES) {
  describeMarketplaceContract(`FAKE (${c.capture.currency}, ${c.capture.id})`, () => harness(c).h);
  // même suite, PSP qui sait transférer depuis PLATFORM (capacité non bloquante, défaut false)
  describeMarketplaceContract(
    `FAKE avec SUPPORTS_PLATFORM_LEG_TRANSFER (${c.capture.currency})`,
    () =>
      harness(c, {
        override: [
          {
            capability: 'SUPPORTS_PLATFORM_LEG_TRANSFER',
            method: '*',
            value: true,
            status: 'VALIDATED_SANDBOX',
          },
        ],
      }).h,
  );
}

async function expectCode(promise: Promise<unknown>, code: PaymentErrorCode) {
  try {
    await promise;
  } catch (error) {
    expect(isPaymentError(error), String(error)).toBe(true);
    expect((error as { code: string }).code).toBe(code);
    return error as { details: Record<string, unknown> };
  }
  throw new Error(`erreur ${code} attendue`);
}

/** Capacités bloquantes nommées par 19 US-061 (critère 3). */
const STORY_BLOCKING = [
  'SUPPORTS_SUBMERCHANT',
  'SUPPORTS_INDIVIDUAL_SUBMERCHANT',
  'SUPPORTS_MULTI_LEG_SPLIT',
  'SUPPORTS_PER_LEG_AMOUNTS',
  'SUPPORTS_B2C_PAYOUT',
  'SUPPORTS_DELAYED_PAYOUT_RELEASE',
  'SUPPORTS_PAYOUT_ADJUSTMENT',
  'SUPPORTS_NEGATIVE_BALANCE_RECOVERY',
  'SUPPORTS_MIT',
] as const;

describe.each(CASES)('FAKE de place de marché — $capture.currency', (c) => {
  const currency = c.capture.currency;
  const country = countryOf(currency);

  it.each(STORY_BLOCKING)(
    '%s réglée à UNKNOWN ⇒ HOST_PAYOUT_RAIL_UNAVAILABLE à l’activation de l’hôte et au paiement, sans appel au PSP',
    async (capability) => {
      const { stack } = harness(c, {
        override: [{ capability, method: '*', value: true, status: 'UNKNOWN' }],
      });
      const host = await expectCode(
        stack.provider.registerSubmerchant({
          idempotencyKey: 'submerchant:org-1:a1',
          hostReference: 'org-1',
          individual: true,
          country,
          payoutCurrency: currency,
        }),
        'HOST_PAYOUT_RAIL_UNAVAILABLE',
      );
      expect(host.details['missing']).toEqual([capability]);
      const pay = await expectCode(
        stack.provider.createHostedPayment({
          idempotencyKey: 'hold:h1:CAPTURE:a1',
          currency,
          method: 'CARD',
          capture: 'AUTO',
          ...amounts(c.capture),
        }),
        'HOST_PAYOUT_RAIL_UNAVAILABLE',
      );
      expect(pay.details['capability']).toBe(capability);
      expect(stack.psp.totalCalls()).toBe(0);
    },
  );

  it('variante B (PLATFORM_MOR) : SUPPORTS_MULTI_LEG_SPLIT n’est bloquante qu’en variante A ; les autres le restent', async () => {
    const mor = harness(c, {
      collectionMode: 'PLATFORM_MOR',
      without: ['SUPPORTS_MULTI_LEG_SPLIT'],
    });
    const sm = await mor.stack.provider.registerSubmerchant({
      idempotencyKey: 'submerchant:org-1:a1',
      hostReference: 'org-1',
      individual: true,
      country,
      payoutCurrency: currency,
    });
    expect(sm.status).toBe('ACTIVE');
    const noMit = harness(c, { collectionMode: 'PLATFORM_MOR', without: ['SUPPORTS_MIT'] });
    await expectCode(
      noMit.stack.provider.registerSubmerchant({
        idempotencyKey: 'submerchant:org-1:a1',
        hostReference: 'org-1',
        individual: true,
        country,
        payoutCurrency: currency,
      }),
      'HOST_PAYOUT_RAIL_UNAVAILABLE',
    );
  });

  it('critère 4 : un PSP qui ventile au prorata est détecté par le test de contrat', async () => {
    const { h } = harness(c, { scenario: { prorata: true } });
    const gaps = await perLegDiscrepancies(h, 'trip-prorata');
    expect(gaps.length).toBeGreaterThan(0);
    if (c.prorata === null) return; // TJ10c n'est publié qu'en PYG
    // écarts exacts de 08 E7 règle 1 : TJ10c (prorata) contre TJ10b (montants de la règle)
    const prorata = debitFromVariation(legsOf(c.prorata));
    const expected = debitFromVariation(legsOf(c.fidelity.refund));
    const balanceGaps = gaps.filter((g) => g.source === 'BALANCE');
    expect(balanceGaps).toEqual(
      LEGS.filter((leg) => prorata[leg] !== expected[leg]).map((leg) => ({
        source: 'BALANCE',
        leg,
        expectedMinor: expected[leg],
        actualMinor: prorata[leg],
      })),
    );
    // l'opération relue porte la même ventilation au prorata
    expect(gaps.filter((g) => g.source === 'OPERATION').map((g) => g.actualMinor)).toEqual(
      balanceGaps.map((g) => g.actualMinor),
    );
  });

  it('jambes illisibles chez le PSP ⇒ la fidélité par jambe n’est pas vérifiable (fail-closed)', async () => {
    const { h } = harness(c, { without: ['SUPPORTS_LIST_TRANSACTIONS'] });
    await expect(perLegDiscrepancies(h, 'trip-x')).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY',
    });
  });

  it('idempotence : une libération rejouée après une réponse perdue ne libère qu’une fois', async () => {
    const { stack, h } = harness(c, {
      scenario: { responses: { RELEASE_LEG: [{ kind: 'TIMEOUT_AFTER_SUCCESS' }] } },
    });
    const sm = await stack.provider.registerSubmerchant({
      idempotencyKey: 'submerchant:org-1:a1',
      hostReference: 'org-1',
      individual: true,
      country,
      payoutCurrency: currency,
    });
    const order = await stack.provider.createHostedPayment({
      idempotencyKey: 'trip-1:CAPTURE:a1',
      tripReference: 'trip-1',
      currency,
      method: 'CARD',
      capture: 'AUTO',
      ...h.capture,
    });
    stack.psp.customerPays(order.providerReference);
    const release = {
      idempotencyKey: 'release:trip-1:1:HOST:i1',
      tripReference: 'trip-1',
      leg: 'HOST' as const,
      amountMinor: h.capture.legs.HOST,
      currency,
      beneficiaryReference: sm.submerchantReference,
    };
    await expectCode(stack.provider.releaseLeg(release), 'UNKNOWN_OUTCOME');
    expect((await stack.provider.releaseLeg(release)).status).toBe('SUCCEEDED');
    expect(stack.psp.movements().filter((m) => m.operation === 'RELEASE_LEG')).toHaveLength(1);
    expect(stack.psp.submerchant(sm.submerchantReference)?.releasedMinor).toBe(h.capture.legs.HOST);
  });

  it('KYC refusé par le PSP ⇒ sous-marchand REJECTED, aucune libération vers lui ; jambe gelée ⇒ LEG_ALREADY_RELEASED', async () => {
    const { stack, h } = harness(c, { scenario: { submerchantKyc: 'REJECTED' } });
    const sm = await stack.provider.registerSubmerchant({
      idempotencyKey: 'submerchant:org-1:a1',
      hostReference: 'org-1',
      individual: true,
      country,
      payoutCurrency: currency,
    });
    expect(sm.status).toBe('REJECTED');
    const order = await stack.provider.createHostedPayment({
      idempotencyKey: 'trip-1:CAPTURE:a1',
      tripReference: 'trip-1',
      currency,
      method: 'CARD',
      capture: 'AUTO',
      ...h.capture,
    });
    stack.psp.customerPays(order.providerReference);
    await expectCode(
      stack.provider.releaseLeg({
        idempotencyKey: 'release:trip-1:1:HOST:i1',
        tripReference: 'trip-1',
        leg: 'HOST',
        amountMinor: h.capture.legs.HOST,
        currency,
        beneficiaryReference: sm.submerchantReference,
      }),
      'INVALID_REQUEST',
    );
    // chargeback ouvert : la jambe HOST est gelée, plus aucun débit (08 E7 règle 7)
    await stack.provider.holdLeg({
      idempotencyKey: 'hold:trip-1:1:HOST',
      tripReference: 'trip-1',
      leg: 'HOST',
    });
    await expectCode(
      stack.provider.refund({
        idempotencyKey: 'trip-1:v1:REFUND:card:i1:a1',
        currency,
        providerReference: order.providerReference,
        ...h.releasedTheory,
      }),
      'LEG_ALREADY_RELEASED',
    );
    expect(stack.psp.movements().filter((m) => m.operation === 'REFUND')).toHaveLength(0);
  });

  it('ajustement au-delà du solde sans SUPPORTS_NEGATIVE_BALANCE_RECOVERY ⇒ UNSUPPORTED_CAPABILITY ; transfert depuis PLATFORM par défaut ⇒ UNSUPPORTED_CAPABILITY', async () => {
    // capacité bloquante retirée APRÈS l'activation de l'hôte (17 §2.8 : lots ON_HOLD, revue ops
    // et FIN) : l'hôte a été enregistré chez le PSP avant le retrait
    const { stack } = harness(c, { without: ['SUPPORTS_NEGATIVE_BALANCE_RECOVERY'] });
    const sm = stack.psp.registerSubmerchant({
      merchantReference: 'submerchant:org-1:a1',
      hostReference: 'org-1',
      individual: true,
      country,
      payoutCurrency: currency,
    });
    // créance de la règle 3 bis (TJ18 : part de l'hôte avancée par Kmino), solde versé nul
    await expectCode(
      stack.provider.adjustPayout({
        idempotencyKey: 'adjust:hle-1',
        submerchantReference: sm.reference,
        amountMinor: debit(c.theory).legs.HOST,
        currency,
        reason: 'RELEASED_LEG_RECOVERY',
      }),
      'UNSUPPORTED_CAPABILITY',
    );
    expect(stack.psp.submerchant(sm.reference)?.adjustedMinor).toBe(0n);
    await expectCode(
      stack.provider.transferFromPlatform({
        idempotencyKey: 'ptransfer:adv-1',
        tripReference: 'trip-1',
        currency,
        legs: { HOST: 1n, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: -1n },
        reason: 'RELEASED_LEG_ADVANCE',
      }),
      'UNSUPPORTED_CAPABILITY',
    );
    expect(stack.psp.calls('TRANSFER_FROM_PLATFORM')).toBe(0);
  });
});
