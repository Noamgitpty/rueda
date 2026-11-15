/**
 * Trip fee du voyageur (US-704 ; 16 PRC-012 ; 08 BR-PRICE-06, E7 ; 19 US-704 critères 1 et 2).
 *
 * Attendus : uniquement 08 et l'export des oracles Python (`golden_vectors.json`) — F des trips de
 * référence (A, B, C, H des vecteurs T ; J, NP, N, K2 de 08 E7 « Trips ajoutés »), jambes de
 * capture TJ01 — et le barème de 08 BR-PRICE-06 (15 % ≤ 6 j, 12 % 7–29 j, 8 % ≥ 30 j, minimum
 * 5 USD / 35 000 PYG) appliqué par 16 PRC-012. Jamais une valeur produite par le code testé.
 * Le barème est celui du dépôt (`trip_fee_schedule` de CFG), lu pour le pays de la devise du
 * vecteur : aucun code de pays ni de devise n'est écrit ici.
 */
import { money, type Currency } from '@rueda/money';
import { legVector, settlementVector } from '@rueda/money/golden-vectors';
import { J, N, NP } from '@rueda/money/testing';
import { describe, expect, it } from 'vitest';
import { assembleQuote, computeQuote, tripFeeOf, type QuoteParams } from './engine.js';
import {
  DAY_MS,
  MINUTE_MS,
  T0_MS,
  caseOfGoldenTrip,
  codeOf,
  golden,
  goldenRegistry,
  repoTripFeeSchedule,
  testTripFeeSchedule,
} from '../../../../../test/support/quote.js';

const fee = (tripPriceMinor: bigint, days: number, currency: Currency): bigint =>
  tripFeeOf(money(tripPriceMinor, currency), days, repoTripFeeSchedule(currency), currency)
    .amountMinor;

describe('critère 1 : F des trips de référence de 08 avec le barème du dépôt', () => {
  it.each(['T01', 'T04', 'T10', 'T42'] as const)(
    '%s : F de l’oracle = barème appliqué à P et aux jours du trip',
    (id) => {
      const t = settlementVector(golden, id).trip;
      const c = goldenRegistry.get(t.currency);
      expect(fee(t.linesMinor.tripPrice, t.days, c)).toBe(t.linesMinor.tripFee);
    },
  );

  it('trip A (T01) : F = 18,00, 15 % de P = 120,00 sur 3 jours (19 US-704, TJ01)', () => {
    const t = settlementVector(golden, 'T01').trip;
    expect(t.linesMinor.tripFee).toBe(1_800n);
    expect(fee(12_000n, 3, goldenRegistry.get(t.currency))).toBe(1_800n);
  });

  it('H (T42) : roundHalfUp(15 % × 45,01 = 6,7515) = 6,75', () => {
    const t = settlementVector(golden, 'T42').trip;
    expect(fee(t.linesMinor.tripPrice, 1, goldenRegistry.get(t.currency))).toBe(675n);
  });

  it('sans décimale : J (08 E7) : P 1 000 001 sur 3 jours ⇒ F 150 000 (roundHalfUp(150 000,15))', () => {
    expect(J.currency.exponent).toBe(0);
    expect(fee(J.lines.tripPrice!.amountMinor, J.days, J.currency)).toBe(
      J.lines.tripFee!.amountMinor,
    );
  });

  it('les promotions ne changent pas l’assiette : N (TJ13a) et NP (TJ13c), F sur P avant promo', () => {
    for (const trip of [N, NP]) {
      expect(trip.lines.promoPlatform!.amountMinor < 0n).toBe(true);
      expect(fee(trip.lines.tripPrice!.amountMinor, trip.days, trip.currency)).toBe(
        trip.lines.tripFee!.amountMinor,
      );
    }
  });
});

describe('minimum du pays (08 BR-PRICE-06 ; 16 PRC-012)', () => {
  it('K2 (08 E7, exposant 2) : P 10,02 sur 1 jour ⇒ F 5,00, minimum de BR-PRICE-06', () => {
    const c = goldenRegistry.get(settlementVector(golden, 'T01').currency);
    expect(c.exponent).toBe(2);
    expect(fee(1_002n, 1, c)).toBe(500n);
  });

  it('16 PRC-012 (exposant 0) : trip de 3 jours dont 15 % donnent moins de 35 000 ⇒ F = 35 000', () => {
    const c = J.currency;
    expect(c.exponent).toBe(0);
    expect(fee(150_000n, 3, c)).toBe(35_000n); // 15 % = 22 500 < 35 000
    expect(fee(233_334n, 3, c)).toBe(35_000n); // 15 % = 35 000,1 ⇒ roundHalfUp = 35 000
    expect(fee(240_000n, 3, c)).toBe(36_000n); // au-dessus du minimum : 15 %
  });
});

describe('tranches de durée (08 BR-PRICE-06 : 15 % ≤ 6 j, 12 % 7–29 j, 8 % ≥ 30 j)', () => {
  const both = [
    ['exposant 2', goldenRegistry.get(settlementVector(golden, 'T01').currency), 10_000n],
    ['exposant 0', J.currency, 1_000_000n],
  ] as const;

  it.each(both)('%s : bornes 6 / 7, 29 / 30 jours', (_name, c, daily) => {
    const at = (days: number) => fee(daily * BigInt(days), days, c);
    expect(at(6)).toBe((daily * 6n * 15n) / 100n);
    expect(at(7)).toBe((daily * 7n * 12n) / 100n);
    expect(at(29)).toBe((daily * 29n * 12n) / 100n);
    expect(at(30)).toBe((daily * 30n * 8n) / 100n);
  });
});

describe('ligne TRIP_FEE du devis : calculée, entièrement dans PLATFORM (08 E7, TJ01)', () => {
  const v = settlementVector(golden, 'T01');
  const { params } = caseOfGoldenTrip(v.trip);
  const c = params.currency;
  const t = v.trip.linesMinor;
  const request = {
    startAtMs: T0_MS,
    endAtMs: T0_MS + 3 * DAY_MS,
    quotedAtMs: T0_MS + v.trip.bookedAtMinutes * MINUTE_MS,
    rateType: v.trip.rate,
    dailyRate: money(4_000n, c),
    lines: {
      PROTECTION: money(t.protection, c),
      EXTRAS: money(t.extras, c),
      ENHANCED_ROADSIDE: money(t.enhancedRoadside, c),
      ADDITIONAL_DRIVER_FEE: money(t.additionalDriver, c),
      DELIVERY_FEE: money(t.delivery, c),
    },
  };

  it('trip A : F 18,00 présent, total et jambes de capture TJ01', () => {
    const q = computeQuote(request, params);
    expect(q.lines.find((l) => l.type === 'TRIP_FEE')?.amount.amountMinor).toBe(1_800n);
    expect(q.total.amountMinor).toBe(v.trip.totalPaidMinor);
    const tj = legVector(golden, 'TJ01');
    for (const leg of ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const) {
      expect(q.legs[leg].amountMinor).toBe(tj.legsMinor[leg]);
    }
  });

  it('F n’entre dans aucune jambe autre que PLATFORM : +x sur F ⇒ +x (et sa taxe) sur PLATFORM seule', () => {
    const base = computeQuote(request, params);
    const doubled: QuoteParams = {
      ...params,
      tripFeeSchedule: testTripFeeSchedule(c, [[null, 3000]], 0n), // F = 36,00 au lieu de 18,00
    };
    const q = computeQuote(request, doubled);
    const fBase = base.lines.find((l) => l.type === 'TRIP_FEE')!;
    const fNew = q.lines.find((l) => l.type === 'TRIP_FEE')!;
    const delta =
      fNew.amount.amountMinor +
      fNew.tax.amountMinor -
      fBase.amount.amountMinor -
      fBase.tax.amountMinor;
    expect(fNew.amount.amountMinor).toBe(3_600n);
    expect(q.legs.HOST).toEqual(base.legs.HOST);
    expect(q.legs.INSURER).toEqual(base.legs.INSURER);
    expect(q.legs.TAX_THIRD_PARTY).toEqual(base.legs.TAX_THIRD_PARTY);
    expect(q.legs.PLATFORM.amountMinor - base.legs.PLATFORM.amountMinor).toBe(delta);
  });

  it('TRIP_FEE fourni par l’appelant ⇒ QUOTE_INPUT_INVALID (jamais un montant du client)', () => {
    expect(
      codeOf(() =>
        computeQuote(
          { ...request, lines: { ...request.lines, TRIP_FEE: money(1_800n, c) } as never },
          params,
        ),
      ),
    ).toBe('QUOTE_INPUT_INVALID');
  });

  it('assembleQuote (lignes données, rejeu des vecteurs) garde F tel quel', () => {
    const { period } = caseOfGoldenTrip(v.trip);
    expect(
      assembleQuote(period, params).lines.find((l) => l.type === 'TRIP_FEE')?.amount.amountMinor,
    ).toBe(t.tripFee);
  });
});

describe('barème incohérent ⇒ QUOTE_UNAVAILABLE (fail-closed, jamais un trip fee nul)', () => {
  const c = goldenRegistry.get(settlementVector(golden, 'T01').currency);
  const other = J.currency;
  const p = money(12_000n, c);
  const sched = (tiers: readonly (readonly [number | null, number])[], min = 500n) =>
    testTripFeeSchedule(c, tiers, min);

  it.each([
    ['barème absent', undefined],
    ['aucune tranche', sched([])],
    [
      'bornes non croissantes',
      sched([
        [6, 1500],
        [6, 1200],
        [null, 800],
      ]),
    ],
    [
      'tranche sans borne avant la fin',
      sched([
        [null, 1500],
        [29, 1200],
      ]),
    ],
    [
      'borne nulle ou négative',
      sched([
        [0, 1500],
        [null, 800],
      ]),
    ],
    ['taux supérieur à 100 %', sched([[null, 10_001]])],
    ['durée non couverte', sched([[2, 1500]])],
    ['minimum négatif', sched([[null, 1500]], -1n)],
    ['minimum d’une autre devise', { ...sched([[null, 1500]]), min: money(500n, other) }],
  ] as const)('%s', (_name, schedule) => {
    expect(codeOf(() => tripFeeOf(p, 3, schedule, c))).toBe('QUOTE_UNAVAILABLE');
  });

  it('sans barème, computeQuote refuse le devis', () => {
    const rest = { ...params } as { tripFeeSchedule?: unknown };
    delete rest.tripFeeSchedule;
    delete rest.tripFeeSchedule;
    expect(
      codeOf(() =>
        computeQuote(
          {
            startAtMs: T0_MS,
            endAtMs: T0_MS + 3 * DAY_MS,
            quotedAtMs: T0_MS - DAY_MS,
            rateType: 'REFUNDABLE',
            dailyRate: money(4_000n, c),
          },
          rest as unknown as QuoteParams,
        ),
      ),
    ).toBe('QUOTE_UNAVAILABLE');
  });
});
