/**
 * Instantané des paramètres du pays (US-202 critères 1 et 5 avec la configuration du dépôt ;
 * 16 PRC-025 « paramètre manquant ⇒ QUOTE_UNAVAILABLE »). Les pays et devises sont lus des données
 * CFG ; les attendus viennent de l'oracle (trip A : vecteur T01, D2 : vecteur T40 de
 * `golden_vectors.json`) et de 08 BR-PRICE-06 (barème du trip fee, US-704). US-226 : la
 * configuration du dépôt vend la protection (grille et parts de l'assureur de TEST, 16 PRC-018,
 * 08 E7) : chaque devis porte le niveau minimal `BASICA` (1/4 du prix journalier net, protection
 * de 30,00 du trip A de 08).
 */
import { money, ratio } from '@rueda/money';
import { settlementVector } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../../cfg/index.js';
import { computeQuote, type QuoteRequest } from './engine.js';
import { resolveQuoteParams } from './params.js';
import { QuoteService } from './quote.service.js';
import {
  DAY_MS,
  T0_MS,
  TEST_INSURER,
  codeOf,
  countryOfCurrency,
  golden,
  repoConfig,
  testTripFeeSchedule,
} from '../../../../../test/support/quote.js';

const AT = new Date(T0_MS - 5 * DAY_MS);
const ta01Country = countryOfCurrency(settlementVector(golden, 'T01').currency);
const d2 = settlementVector(golden, 'T40'); // trip D2, exposant 0
// Trip A de 08 (T01) : P 120,00 sur 3 j, F 18,00 (TJ01), taxe par ligne du groupe 9,66.
const a = settlementVector(golden, 'T01').trip;
const aTax = a.taxGroups[0]!.taxPaidMinor;
const aTotal = a.linesMinor.tripPrice + a.linesMinor.tripFee + aTax;
const d2Country = countryOfCurrency(d2.currency);
// US-226 : protection minimale (BASICA, 1/4 de 40,00 × 3 j = 30,00, la protection du trip A)
const aProtection = a.linesMinor.protection;

function request(
  dailyRate: QuoteRequest['dailyRate'],
  lines?: QuoteRequest['lines'],
  protectionLevel: string | null = 'BASICA',
): QuoteRequest {
  return {
    startAtMs: T0_MS,
    endAtMs: T0_MS + 3 * DAY_MS,
    quotedAtMs: AT.getTime(),
    rateType: 'REFUNDABLE',
    dailyRate,
    ...(lines === undefined ? {} : { lines }),
    ...(protectionLevel === null ? {} : { protectionLevel }),
  };
}

describe('paramètres de chaque pays du dépôt', () => {
  it('deux pays, deux devises d’exposants différents', () => {
    const exps = [...repoConfig.countries.keys()].map(
      (country) => resolveQuoteParams(repoConfig, { country, at: AT }).currency.exponent,
    );
    expect(exps.length).toBeGreaterThanOrEqual(2);
    expect(new Set(exps).size).toBeGreaterThanOrEqual(2);
  });

  it.each([...repoConfig.countries.keys()])(
    '%s : devise du pays, plan par défaut 3/4, third_party = false, parts de l’assureur par niveau seulement',
    (country) => {
      const p = resolveQuoteParams(repoConfig, { country, at: AT });
      expect(p.currency.code).toBe(repoConfig.countries.get(country)!.currency.code);
      expect(p.hostSharePct).toEqual(ratio(3n, 4n));
      expect(p.deliverySharePct).toEqual(p.hostSharePct);
      expect(p.extrasSharePct).toEqual(p.hostSharePct);
      expect(p.maxTripDays).toBe(30);
      expect(p.taxRules.every((r) => !r.thirdParty)).toBe(true);
      expect(p.taxRules.find((r) => r.lineType === 'TRIP_PRICE')?.taxable).toBe(true);
      expect(p.taxRules.find((r) => r.lineType === 'TRIP_FEE')?.taxable).toBe(true);
      // US-226 : la part unique n'est jamais posée par l'instantané, seulement celle du niveau ;
      // valeurs de TEST de 08 E7 (7/10 et 1/2), à remplacer par le contrat d'assureur
      expect(p.insurerPremiumShare).toBeUndefined();
      expect(p.insurerRoadsideShare).toEqual(ratio(1n, 2n));
      expect(p.insurerPremiumShareByLevel).toEqual({
        BASICA: ratio(7n, 10n),
        ESTANDAR: ratio(7n, 10n),
        TOTAL: ratio(7n, 10n),
      });
      expect(p.hostPlan).toBe('ESTÁNDAR');
      // 16 PRT-011 : minimum BASICA ; 10b S05 : trois niveaux ; PRT-002 : Total dès 21 ans
      expect(p.protectionGrid?.minLevel).toBe('BASICA');
      expect(p.protectionGrid?.levels.map((t) => [t.level, t.rank, t.minDriverAge])).toEqual([
        ['BASICA', 1, null],
        ['ESTANDAR', 2, null],
        ['TOTAL', 3, 21],
      ]);
    },
  );
});

describe('critère 1 avec la configuration du dépôt', () => {
  it('trip A : 40,00 × 3 j ⇒ P 120,00, F 18,00 (barème du dépôt), taxe 9,66 (T01)', () => {
    const p = resolveQuoteParams(repoConfig, { country: ta01Country, at: AT });
    const q = computeQuote(request(money(4_000n, p.currency)), p);
    expect(q.lines.map((l) => [l.type, l.amount.amountMinor])).toEqual([
      ['TRIP_PRICE', a.linesMinor.tripPrice],
      ['TRIP_FEE', a.linesMinor.tripFee],
      ['PROTECTION', aProtection],
    ]);
    expect(q.taxTotal.amountMinor).toBe(aTax);
    expect(q.total.amountMinor).toBe(aTotal + aProtection);
    expect(q.legs.TAX_THIRD_PARTY.amountMinor).toBe(0n);
    // TJ01 (note de 08 E7) : prime due 0,7 × 30,00 = 21,00
    expect(q.legs.INSURER.amountMinor).toBe(2_100n);
    expect(q.protectionLevel).toBe('BASICA');
  });

  it('variante sans décimale : D2, taxe de 10 % par ligne ⇒ taxe et total de l’oracle (T40)', () => {
    const base = resolveQuoteParams(repoConfig, { country: d2Country, at: AT });
    const p = {
      ...base,
      ...TEST_INSURER, // parts de test de 08 E7 : le contrat d'assureur n'est pas signé
      // F de D2 (125 500) donné par 08 : barème de TEST à 12,55 % (roundHalfUp(125 500,251))
      tripFeeSchedule: testTripFeeSchedule(base.currency, [[null, 1255]], 0n),
      // protection de D2 (150 000) : grille de TEST à 3/20 (roundHalfUp(50 000,1) × 3 j)
      protectionGrid: {
        ...base.protectionGrid!,
        levels: base.protectionGrid!.levels.map((t) =>
          t.level === 'BASICA' ? { ...t, price: ratio(3n, 20n) } : t,
        ),
      },
    };
    const c = p.currency;
    expect(c.exponent).toBe(0);
    const t = d2.trip.linesMinor;
    const q = computeQuote(request(money(333_334n, c), { DELIVERY_FEE: money(t.delivery, c) }), p);
    expect(q.lines.find((l) => l.type === 'TRIP_FEE')?.amount.amountMinor).toBe(t.tripFee);
    expect(q.lines.find((l) => l.type === 'PROTECTION')?.amount.amountMinor).toBe(t.protection);
    expect(q.taxTotal.amountMinor).toBe(d2.trip.taxGroups[0]!.taxPaidMinor);
    expect(q.total.amountMinor).toBe(d2.trip.totalPaidMinor);
  });
});

describe('US-704 : barème du trip fee de chaque pays du dépôt (08 BR-PRICE-06)', () => {
  it.each([...repoConfig.countries.keys()])(
    '%s : tranches 15, 12 et 8 pour cent (≤ 6 j, 7–29 j, ≥ 30 j), minimum du pays dans sa devise',
    (country) => {
      const p = resolveQuoteParams(repoConfig, { country, at: AT });
      expect(p.tripFeeSchedule.tiers).toEqual([
        { maxDays: 6, rate: ratio(15n, 100n) },
        { maxDays: 29, rate: ratio(12n, 100n) },
        { maxDays: null, rate: ratio(8n, 100n) },
      ]);
      // 08 BR-PRICE-06 : « minimum 5 USD / 35 000 PYG » (exposant 2 ⇒ 500 ; exposant 0 ⇒ 35 000)
      expect(p.tripFeeSchedule.min.amountMinor).toBe(p.currency.exponent === 0 ? 35_000n : 500n);
      expect(p.tripFeeSchedule.min.currency).toBe(p.currency.code);
    },
  );

  it.each([...repoConfig.countries.keys()])(
    '%s : barème absent ou mal formé ⇒ QUOTE_UNAVAILABLE (BLOCK), jamais un trip fee nul',
    (country) => {
      const without = {
        ...repoConfig,
        values: repoConfig.values.filter((v) => v.key !== 'trip_fee_schedule'),
      };
      expect(codeOf(() => resolveQuoteParams(without, { country, at: AT }))).toBe(
        'QUOTE_UNAVAILABLE',
      );
      for (const bad of [
        { tiers: [], minMinor: '500' },
        { tiers: [{ maxDays: null, rateBps: 10_001 }], minMinor: '500' },
        { tiers: [{ maxDays: 'six', rateBps: 1500 }], minMinor: '500' },
        { tiers: [{ maxDays: null, rateBps: 1500 }], minMinor: '-1' },
        { tiers: [{ maxDays: null, rateBps: 1500 }], minMinor: 500 },
        [],
      ]) {
        const malformed = {
          ...repoConfig,
          values: repoConfig.values.map((v) =>
            v.key === 'trip_fee_schedule' ? { ...v, value: bad as never } : v,
          ),
        };
        expect(codeOf(() => resolveQuoteParams(malformed, { country, at: AT }))).toBe(
          'QUOTE_UNAVAILABLE',
        );
      }
    },
  );
});

describe('critère 5 avec la configuration du dépôt', () => {
  it('groupe marqué third_party ⇒ sa taxe forme la jambe TAX_THIRD_PARTY (trip A : 9,66)', () => {
    const p = resolveQuoteParams(repoConfig, { country: ta01Country, at: AT });
    const tp = {
      ...p,
      taxRules: p.taxRules.map((r) => (r.taxable ? { ...r, thirdParty: true } : r)),
    };
    const q = computeQuote(request(money(4_000n, p.currency)), tp);
    expect(q.taxThirdParty.amountMinor).toBe(aTax);
    expect(q.legs.TAX_THIRD_PARTY.amountMinor).toBe(aTax);
    expect(q.total.amountMinor).toBe(aTotal + aProtection);
  });
});

describe('fail-closed', () => {
  it.each([...repoConfig.countries.keys()])(
    '%s : protection vendue sans part d’assureur (contrat non signé) ⇒ QUOTE_UNAVAILABLE ; ligne fournie ⇒ QUOTE_INPUT_INVALID',
    (country) => {
      const without = {
        ...repoConfig,
        values: repoConfig.values.filter((v) => v.key !== 'insurer_premium_share'),
      };
      const p = resolveQuoteParams(without, { country, at: AT });
      expect(p.insurerPremiumShareByLevel).toBeUndefined();
      const step = p.currency.exponent === 0 ? 1_000n : 100n;
      expect(codeOf(() => computeQuote(request(money(10n * step, p.currency)), p))).toBe(
        'QUOTE_UNAVAILABLE',
      );
      // la ligne PROTECTION est calculée par le moteur, jamais fournie (L2-PM-03)
      const full = resolveQuoteParams(repoConfig, { country, at: AT });
      expect(
        codeOf(() =>
          computeQuote(
            request(money(10n * step, p.currency), { PROTECTION: money(step, p.currency) }),
            full,
          ),
        ),
      ).toBe('QUOTE_INPUT_INVALID');
    },
  );

  it('pays inconnu, plan inconnu ⇒ QUOTE_UNAVAILABLE', () => {
    expect(codeOf(() => resolveQuoteParams(repoConfig, { country: 'ZZ', at: AT }))).toBe(
      'QUOTE_UNAVAILABLE',
    );
    expect(
      codeOf(() =>
        resolveQuoteParams(repoConfig, { country: ta01Country, at: AT, hostPlan: 'INCONNU' }),
      ),
    ).toBe('QUOTE_UNAVAILABLE');
  });
});

describe('QuoteService (module PRC)', () => {
  it('même devis que le moteur avec l’instantané du pays', () => {
    const service = new QuoteService(new CountryConfigService());
    const p = resolveQuoteParams(repoConfig, { country: ta01Country, at: AT });
    const req = request(money(4_000n, p.currency));
    const q = service.quote(req, { country: ta01Country, at: AT });
    expect(q.total.amountMinor).toBe(aTotal + aProtection);
    const { frozen } = service.freeze(req, { country: ta01Country, at: AT });
    expect(frozen.totalMinor).toBe((aTotal + aProtection).toString());
  });
});
