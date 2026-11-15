/**
 * Moteur de devis (US-202 critères 1, 2 et 5 ; 16 PRC-020, PRC-025 ; 08 BR-PRICE-12, E7).
 *
 * Attendus : uniquement l'export des oracles Python (`docs/specs/tools/golden_vectors.json`, lu
 * par `@rueda/money/golden-vectors`) — taxe payée par groupe et total payé de chaque trip des
 * vecteurs T, jambes de capture des vecteurs TJ. Jamais une valeur produite par le code testé.
 * Chaque cas tourne dans les deux devises des vecteurs (exposant 2 et exposant 0).
 */
import { money, ratio, type Ratio, type SettlementTrip } from '@rueda/money';
import { legVector, settlementVector, settlementVectors } from '@rueda/money/golden-vectors';
import { J, J3, N, NP, NP_MAX, N_MAX } from '@rueda/money/testing';
import { describe, expect, it } from 'vitest';
import { assembleQuote, computeQuote, type QuoteParams } from './engine.js';
import {
  DAY_MS,
  MINUTE_MS,
  T0_MS,
  TEST_INSURER,
  caseOfGoldenTrip,
  caseOfSettlementTrip,
  codeOf,
  golden,
  goldenRegistry,
  rulesOf,
  testTripFeeSchedule,
  toRatio,
} from '../../../../../test/support/quote.js';

// Un trip par nom et par jeu de lignes (plusieurs vecteurs T partagent le même trip).
const trips = [
  ...new Map(
    settlementVectors(golden).map((v) => [
      `${v.trip.name}:${JSON.stringify(v.trip.linesMinor, (_k, x: unknown) => (typeof x === 'bigint' ? x.toString() : x))}`,
      v,
    ]),
  ).values(),
];

describe('taxe par ligne et total TTC : trips des vecteurs T de 08 (oracle)', () => {
  it('les deux devises des vecteurs sont couvertes', () => {
    expect(new Set(trips.map((v) => v.currency)).size).toBeGreaterThanOrEqual(2);
  });

  it.each(trips.map((v) => [v.id, v.trip.name, v.currency, v] as const))(
    '%s (trip %s, %s) : taxe de chaque groupe et total payé de l’oracle',
    (_id, _name, _cur, v) => {
      const { period, params } = caseOfGoldenTrip(v.trip);
      const quote = assembleQuote(period, params);
      for (const g of v.trip.taxGroups) {
        expect(quote.taxGroups.find((x) => x.id === g.id)?.tax.amountMinor).toBe(g.taxPaidMinor);
      }
      expect(quote.total.amountMinor).toBe(v.trip.totalPaidMinor);
      expect(quote.total.currency).toBe(v.currency);
      expect(quote.legs.total.amountMinor).toBe(v.trip.totalPaidMinor);
    },
  );
});

describe('critère 1 : TA01 (prix du trip × jours facturables)', () => {
  const ta01 = settlementVector(golden, 'T01'); // trip A : seule source normative du loyer de 120,00
  const cur = goldenRegistry.get(ta01.currency);
  // TA01 : « 3 j, loyer 120,00, ITBMS 7 % = 8,40, total 128,40 » (16 A.8.1 ; verif15_ta.py).
  // Configuration « PA1 » de TA01 : « ni trip fee ni protection » ⇒ barème nul (taux 0, minimum 0).
  const params: QuoteParams = {
    currency: cur,
    graceMinutes: 29,
    maxTripDays: 30,
    tripFeeSchedule: testTripFeeSchedule(cur, [[null, 0]], 0n),
    taxRules: rulesOf([{ id: 'g', rate: ratio(7n, 100n), lines: ['tripPrice'] }]),
    hostSharePct: ratio(3n, 4n),
    deliverySharePct: ratio(3n, 4n),
    extrasSharePct: ratio(3n, 4n),
  };

  it('40,00 × 3 jours ⇒ loyer 120,00, taxe 8,40, total 128,40', () => {
    const q = computeQuote(
      {
        startAtMs: T0_MS,
        endAtMs: T0_MS + 3 * DAY_MS,
        quotedAtMs: T0_MS - 5 * DAY_MS,
        rateType: 'REFUNDABLE',
        dailyRate: money(4_000n, cur),
      },
      params,
    );
    expect(q.billableDays).toBe(3);
    expect(q.lines.map((l) => [l.type, l.amount.amountMinor])).toEqual([['TRIP_PRICE', 12_000n]]);
    expect(q.taxTotal.amountMinor).toBe(840n);
    expect(q.total.amountMinor).toBe(12_840n);
    expect(q.taxThirdParty.amountMinor).toBe(0n);
    expect(q.legs.TAX_THIRD_PARTY.amountMinor).toBe(0n);
  });

  it('variante sans décimale : D2 (T40), 333 334 × 3 jours, taxe 10 % sur P et F ⇒ taxe et total de l’oracle', () => {
    const v = settlementVector(golden, 'T40');
    const { params: base } = caseOfGoldenTrip(v.trip);
    const c = base.currency;
    expect(c.exponent).toBe(0);
    // F de D2 (125 500) donné par 08 : barème de TEST à 12,55 %, roundHalfUp(125 500,251) = 125 500
    const p: QuoteParams = { ...base, tripFeeSchedule: testTripFeeSchedule(c, [[null, 1255]], 0n) };
    const q = computeQuote(
      {
        startAtMs: T0_MS,
        endAtMs: T0_MS + 3 * DAY_MS,
        quotedAtMs: T0_MS + v.trip.bookedAtMinutes * MINUTE_MS,
        rateType: v.trip.rate,
        dailyRate: money(333_334n, c), // P = 1 000 002 de D2 (08), divisible par 3
        lines: {
          PROTECTION: money(v.trip.linesMinor.protection, c),
          DELIVERY_FEE: money(v.trip.linesMinor.delivery, c),
        },
      },
      p,
    );
    expect(q.lines.find((l) => l.type === 'TRIP_PRICE')?.amount.amountMinor).toBe(
      v.trip.linesMinor.tripPrice,
    );
    expect(q.lines.find((l) => l.type === 'TRIP_FEE')?.amount.amountMinor).toBe(
      v.trip.linesMinor.tripFee,
    );
    expect(q.taxTotal.amountMinor).toBe(v.trip.taxGroups[0]!.taxPaidMinor);
    expect(q.total.amountMinor).toBe(v.trip.totalPaidMinor);
    const tj = legVector(golden, 'TJ09a'); // capture de D2
    expect(q.legs.HOST.amountMinor).toBe(tj.legsMinor.HOST);
    expect(q.legs.INSURER.amountMinor).toBe(tj.legsMinor.INSURER);
    expect(q.legs.TAX_THIRD_PARTY.amountMinor).toBe(tj.legsMinor.TAX_THIRD_PARTY);
    expect(q.legs.PLATFORM.amountMinor).toBe(tj.legsMinor.PLATFORM);
  });
});

describe('critère 2 : T43, taxe par ligne et non sur la base agrégée', () => {
  it('deux lignes de 10,05 à 7 % ⇒ 0,70 + 0,70 = 1,40 (et non 1,41)', () => {
    const v = settlementVector(golden, 'T43');
    const q = assembleQuote(caseOfGoldenTrip(v.trip).period, caseOfGoldenTrip(v.trip).params);
    expect(q.lines.map((l) => l.tax.amountMinor)).toEqual([70n, 70n]);
    expect(q.taxTotal.amountMinor).toBe(v.trip.taxGroups[0]!.taxPaidMinor);
    expect(q.taxTotal.amountMinor).not.toBe(141n);
  });

  it('T44 : deux groupes fiscaux, chacun somme de ses taxes de ligne', () => {
    const v = settlementVector(golden, 'T44');
    const q = assembleQuote(caseOfGoldenTrip(v.trip).period, caseOfGoldenTrip(v.trip).params);
    expect(q.taxGroups.map((g) => [g.id, g.tax.amountMinor])).toEqual(
      v.trip.taxGroups.map((g) => [g.id, g.taxPaidMinor]),
    );
  });
});

// Trips de 08 E7 et leurs vecteurs TJ de capture. Les taux sont ceux des entrées de 08 citées :
// A, D, D2 (vecteurs T) ; J, J3 (10 %), N (7 %), NP (10 %) (check_legs.py, adaptateur de test).
const sameRate = (trip: SettlementTrip, rate: Ratio): Record<string, Ratio> =>
  Object.fromEntries(trip.taxGroups.map((g) => [g.id, rate]));

const settlementTripCases: readonly (readonly [string, SettlementTrip, Record<string, Ratio>])[] = [
  ['TJ10a', J, sameRate(J, ratio(1n, 10n))],
  ['TJ11a', J3, sameRate(J3, ratio(1n, 10n))],
  ['TJ13b', N_MAX, { g: ratio(7n, 100n) }],
  ['TJ13d', NP_MAX, { g: ratio(1n, 10n) }],
];

describe('jambes de la capture du total (08 E7, vecteurs TJ)', () => {
  it.each([
    ['TJ01', 'T01'],
    ['TJ08a', 'T27'],
    ['TJ09a', 'T40'],
  ] as const)('%s : jambes de la capture du trip de %s', (tjId, tId) => {
    const { period, params } = caseOfGoldenTrip(settlementVector(golden, tId).trip);
    const q = assembleQuote(period, params);
    const tj = legVector(golden, tjId);
    expect(q.legs.HOST.amountMinor).toBe(tj.legsMinor.HOST);
    expect(q.legs.INSURER.amountMinor).toBe(tj.legsMinor.INSURER);
    expect(q.legs.TAX_THIRD_PARTY.amountMinor).toBe(tj.legsMinor.TAX_THIRD_PARTY);
    expect(q.legs.PLATFORM.amountMinor).toBe(tj.legsMinor.PLATFORM);
    expect(q.legs.total.amountMinor).toBe(tj.totalMinor);
  });

  it.each(settlementTripCases)('%s : jambes et total de l’oracle', (tjId, trip, rates) => {
    const { period, params } = caseOfSettlementTrip(trip, rates);
    const q = assembleQuote(period, params);
    const tj = legVector(golden, tjId);
    expect(q.total.amountMinor).toBe(tj.totalMinor);
    expect(q.legs.HOST.amountMinor).toBe(tj.legsMinor.HOST);
    expect(q.legs.INSURER.amountMinor).toBe(tj.legsMinor.INSURER);
    expect(q.legs.TAX_THIRD_PARTY.amountMinor).toBe(tj.legsMinor.TAX_THIRD_PARTY);
    expect(q.legs.PLATFORM.amountMinor).toBe(tj.legsMinor.PLATFORM);
  });

  it.each([
    ['TJ13a', N, { g: ratio(7n, 100n) }],
    ['TJ13c', NP, { g: ratio(1n, 10n) }],
  ] as const)(
    '%s : capture refusée par l’oracle (PLATFORM < 0) ⇒ LEG_AMOUNT_NEGATIVE, aucun devis',
    (tjId, trip, rates) => {
      expect(legVector(golden, tjId).legsMinor.PLATFORM < 0n).toBe(true);
      const { period, params } = caseOfSettlementTrip(trip, rates);
      expect(codeOf(() => assembleQuote(period, params))).toBe('LEG_AMOUNT_NEGATIVE');
    },
  );
});

describe('critère 5 : groupe fiscal third_party ⇒ jambe TAX_THIRD_PARTY (BR-PRICE-12)', () => {
  it('TJ11a : la taxe du groupe pour compte de tiers est portée à part, les autres jambes = TJ10a', () => {
    const q = assembleQuote(
      caseOfSettlementTrip(J3, sameRate(J3, ratio(1n, 10n))).period,
      caseOfSettlementTrip(J3, sameRate(J3, ratio(1n, 10n))).params,
    );
    const tj11 = legVector(golden, 'TJ11a');
    const tj10 = legVector(golden, 'TJ10a');
    expect(q.taxThirdParty.amountMinor).toBe(tj11.legsMinor.TAX_THIRD_PARTY);
    expect(q.legs.TAX_THIRD_PARTY.amountMinor).toBe(tj11.legsMinor.TAX_THIRD_PARTY);
    for (const leg of ['HOST', 'INSURER', 'PLATFORM'] as const) {
      expect(q.legs[leg].amountMinor).toBe(tj10.legsMinor[leg]);
    }
  });

  it.each(trips.map((v) => [v.id, v.currency, v] as const))(
    '%s (%s) : third_party = false par défaut ⇒ TAX_THIRD_PARTY = 0',
    (_id, _c, v) => {
      const { period, params } = caseOfGoldenTrip(v.trip);
      expect(params.taxRules.every((r) => !r.thirdParty)).toBe(true);
      expect(assembleQuote(period, params).legs.TAX_THIRD_PARTY.amountMinor).toBe(0n);
    },
  );

  it.each(['T01', 'T27'] as const)(
    '%s : même trip, groupe marqué third_party ⇒ toute sa taxe passe de PLATFORM à TAX_THIRD_PARTY',
    (id) => {
      const v = settlementVector(golden, id);
      const { period, params } = caseOfGoldenTrip(v.trip);
      const base = assembleQuote(period, params);
      const tp = assembleQuote(period, {
        ...params,
        taxRules: params.taxRules.map((r) => (r.taxable ? { ...r, thirdParty: true } : r)),
      });
      const taxPaid = v.trip.taxGroups[0]!.taxPaidMinor;
      expect(tp.legs.TAX_THIRD_PARTY.amountMinor).toBe(taxPaid);
      expect(tp.legs.PLATFORM.amountMinor).toBe(base.legs.PLATFORM.amountMinor - taxPaid);
      expect(tp.legs.HOST.amountMinor).toBe(base.legs.HOST.amountMinor);
      expect(tp.total.amountMinor).toBe(v.trip.totalPaidMinor);
    },
  );
});

describe('refus fail-closed', () => {
  const v = settlementVector(golden, 'T27');
  const { period, params } = caseOfGoldenTrip(v.trip);
  const c = params.currency;
  const other = goldenRegistry.get(settlementVector(golden, 'T01').currency);
  const request = {
    startAtMs: T0_MS,
    endAtMs: T0_MS + 3 * DAY_MS,
    quotedAtMs: T0_MS - DAY_MS,
    rateType: 'REFUNDABLE' as const,
    dailyRate: money(100_000n, c),
  };

  it('ligne non nulle sans règle fiscale ⇒ TAX_CONFIG_MISSING', () => {
    const rules = params.taxRules.filter((r) => r.lineType !== 'DELIVERY_FEE');
    expect(codeOf(() => assembleQuote(period, { ...params, taxRules: rules }))).toBe(
      'TAX_CONFIG_MISSING',
    );
  });

  it('groupe à deux taux, règle en double, taxable sans taux ⇒ TAX_CONFIG_MISSING', () => {
    const twoRates = params.taxRules.map((r) =>
      r.lineType === 'TRIP_FEE' ? { ...r, rate: ratio(1n, 20n) } : r,
    );
    expect(codeOf(() => assembleQuote(period, { ...params, taxRules: twoRates }))).toBe(
      'TAX_CONFIG_MISSING',
    );
    expect(
      codeOf(() =>
        assembleQuote(period, { ...params, taxRules: [...params.taxRules, params.taxRules[0]!] }),
      ),
    ).toBe('TAX_CONFIG_MISSING');
    const noRate = params.taxRules.map((r) => (r.taxable ? { ...r, rate: null } : r));
    expect(codeOf(() => assembleQuote(period, { ...params, taxRules: noRate }))).toBe(
      'TAX_CONFIG_MISSING',
    );
  });

  it('protection sans part de l’assureur figée ⇒ QUOTE_UNAVAILABLE (jamais 0)', () => {
    const rest: QuoteParams = { ...params };
    delete (rest as { insurerPremiumShare?: unknown }).insurerPremiumShare;
    expect(codeOf(() => assembleQuote(period, rest))).toBe('QUOTE_UNAVAILABLE');
  });

  it('durée au-delà de max_trip_days ⇒ QUOTE_UNAVAILABLE ; à la borne ⇒ devis', () => {
    const at = (days: number) => ({ ...request, endAtMs: T0_MS + days * DAY_MS + 29 * MINUTE_MS });
    expect(computeQuote(at(30), params).billableDays).toBe(30);
    expect(codeOf(() => computeQuote({ ...at(30), endAtMs: at(30).endAtMs + 1 }, params))).toBe(
      'QUOTE_UNAVAILABLE',
    );
  });

  it('montant d’une autre devise, ligne négative hors promo, prix fourni ⇒ QUOTE_INPUT_INVALID', () => {
    expect(codeOf(() => computeQuote({ ...request, dailyRate: money(100n, other) }, params))).toBe(
      'QUOTE_INPUT_INVALID',
    );
    expect(
      codeOf(() => computeQuote({ ...request, lines: { EXTRAS: money(-1n, c) } }, params)),
    ).toBe('QUOTE_INPUT_INVALID');
    expect(
      codeOf(() =>
        computeQuote({ ...request, lines: { TRIP_FEE: money(1n, c) } as never }, params),
      ),
    ).toBe('QUOTE_INPUT_INVALID');
    expect(codeOf(() => computeQuote({ ...request, dailyRate: money(0n, c) }, params))).toBe(
      'QUOTE_INPUT_INVALID',
    );
    expect(
      codeOf(() =>
        computeQuote({ ...request, lines: { TRIP_PRICE: money(1n, c) } as never }, params),
      ),
    ).toBe('QUOTE_INPUT_INVALID');
    expect(
      codeOf(() =>
        assembleQuote(
          { ...period, lines: { ...period.lines, BOGUS: money(1n, c) } as never },
          params,
        ),
      ),
    ).toBe('QUOTE_INPUT_INVALID');
  });

  it('part hors de [0 ; 1] ⇒ QUOTE_UNAVAILABLE', () => {
    expect(codeOf(() => assembleQuote(period, { ...params, hostSharePct: ratio(5n, 4n) }))).toBe(
      'QUOTE_UNAVAILABLE',
    );
  });

  it('la ligne promo négative porte une taxe négative arrondie par roundHalfUp (TJ13b, oracle)', () => {
    const { period: p, params: pp } = caseOfSettlementTrip(N_MAX, { g: ratio(7n, 100n) });
    const q = assembleQuote(p, pp);
    expect(q.lines.find((l) => l.type === 'PROMO_PLATFORM')!.tax.amountMinor < 0n).toBe(true);
    expect(q.taxTotal.amountMinor).toBe(N_MAX.taxGroups[0]!.taxPaid.amountMinor);
    expect(toRatio({ numerator: 3n, denominator: 4n })).toEqual(N_MAX.hostSharePctFrozen);
    expect(TEST_INSURER.insurerPremiumShare).toEqual(N_MAX.insurerPremiumShareFrozen);
  });
});
