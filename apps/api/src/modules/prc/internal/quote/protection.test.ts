/**
 * Protection du voyageur dans le moteur de devis `prc.quote/3` (US-226, ADR-136 ; revue de code
 * n° 2) : prix journalier, plancher puis plafond, arrondi, grille incohérente, niveaux proposés,
 * part de l'assureur du niveau, ligne fournie refusée, devis figé rejoué.
 *
 * Attendus tirés de 16 PRC-018 (« prix journalier net de 38,76 et taux de test de 40 % ⇒ 15,50 par
 * jour »), de 08 BR-PRICE-11 (« % × prix journalier net », plancher et plafond par jour), de la règle
 * d'arrondi unique roundHalfUp de 08 (« entier le plus proche, demi-unité vers +∞ ») appliquée à
 * des entrées de test écrites ici, et de 08 E7 (prime = roundHalfUp(protection × part de
 * l'assureur)) ; jamais du code testé. Pays et devises lus des données (ADR-024).
 */
import { money, ratio, type Currency, type Ratio } from '@rueda/money';
import { describe, expect, it } from 'vitest';
import {
  computeQuote,
  protectionOptions,
  type ProtectionGrid,
  type ProtectionTerms,
  type QuoteParams,
  type QuoteRequest,
} from './engine.js';
import { freezeQuote, replayFrozenQuote } from './frozen.js';
import { resolveQuoteParams } from './params.js';
import { DAY_MS, T0_MS, codeOf, repoConfig } from '../../../../../test/support/quote.js';

const AT = new Date(T0_MS - 5 * DAY_MS);
const byExponent = (exponent: number): QuoteParams => {
  for (const country of repoConfig.countries.keys()) {
    const p = resolveQuoteParams(repoConfig, { country, at: AT });
    if (p.currency.exponent === exponent) return p;
  }
  throw new Error(`aucun pays du dépôt à l'exposant ${exponent}`);
};
const CENTS = byExponent(2);
const WHOLE = byExponent(0);

function terms(
  c: Currency,
  level: string,
  rank: number,
  price: Ratio,
  o: { minDriverAge?: number | null; floor?: bigint | null; ceiling?: bigint | null } = {},
): ProtectionTerms {
  return {
    level,
    rank,
    price,
    minDriverAge: o.minDriverAge ?? null,
    dailyFloor: o.floor === undefined || o.floor === null ? null : money(o.floor, c),
    dailyCeiling: o.ceiling === undefined || o.ceiling === null ? null : money(o.ceiling, c),
  };
}

function withGrid(base: QuoteParams, levels: ProtectionTerms[], minLevel = 'BASICA'): QuoteParams {
  const grid: ProtectionGrid = { minLevel, levels };
  return {
    ...base,
    protectionGrid: grid,
    insurerPremiumShareByLevel: Object.fromEntries(levels.map((t) => [t.level, ratio(7n, 10n)])),
  };
}

function request(
  dailyMinor: bigint,
  p: QuoteParams,
  o: { level?: string; age?: number; days?: number; lines?: QuoteRequest['lines'] } = {},
): QuoteRequest {
  return {
    startAtMs: T0_MS,
    endAtMs: T0_MS + (o.days ?? 3) * DAY_MS,
    quotedAtMs: AT.getTime(),
    rateType: 'REFUNDABLE',
    dailyRate: money(dailyMinor, p.currency),
    protectionLevel: o.level ?? 'BASICA',
    ...(o.age === undefined ? {} : { driverAge: o.age }),
    ...(o.lines === undefined ? {} : { lines: o.lines }),
  };
}

const lineOf = (p: QuoteParams, r: QuoteRequest): bigint | undefined =>
  computeQuote(r, p).lines.find((l) => l.type === 'PROTECTION')?.amount.amountMinor;

describe('prix journalier de la protection (16 PRC-018 ; 08 BR-PRICE-11)', () => {
  it('PRC-018 : 38,76 × 40 % ⇒ 15,50 par jour, × 3 jours facturables = 46,50', () => {
    const p = withGrid(CENTS, [terms(CENTS.currency, 'BASICA', 1, ratio(2n, 5n))]);
    expect(lineOf(p, request(3_876n, p))).toBe(4_650n);
  });

  it('arrondi par jour, au plus proche, demi-unité vers le haut : 0,5 ⇒ 1 ; 83 333,5 ⇒ 83 334', () => {
    const half = withGrid(CENTS, [terms(CENTS.currency, 'BASICA', 1, ratio(1n, 2n))]);
    // 0,01 × 1/2 = 0,005 ⇒ 0,01 par jour, × 1 jour
    expect(lineOf(half, request(1n, half, { days: 1 }))).toBe(1n);
    // 0,03 × 1/2 = 0,015 ⇒ 0,02 par jour (jamais l'arrondi du total : 3 × 0,015 = 0,045 ⇒ 0,05)
    expect(lineOf(half, request(3n, half))).toBe(6n);
    const quarter = withGrid(WHOLE, [terms(WHOLE.currency, 'BASICA', 1, ratio(1n, 4n))]);
    expect(lineOf(quarter, request(333_334n, quarter))).toBe(250_002n);
  });

  it('plancher puis plafond du prix journalier : sous le plancher ⇒ plancher ; au-dessus du plafond ⇒ plafond ; entre les deux ⇒ prix calculé', () => {
    for (const [base, step] of [
      [CENTS, 100n],
      [WHOLE, 1_000n],
    ] as const) {
      const c = base.currency;
      // part 1/4, plancher 15 unités, plafond 20 unités par jour
      const p = withGrid(base, [
        terms(c, 'BASICA', 1, ratio(1n, 4n), { floor: 15n * step, ceiling: 20n * step }),
      ]);
      expect(lineOf(p, request(40n * step, p))).toBe(45n * step); // 10 ⇒ plancher 15, × 3
      expect(lineOf(p, request(100n * step, p))).toBe(60n * step); // 25 ⇒ plafond 20, × 3
      expect(lineOf(p, request(72n * step, p))).toBe(54n * step); // 18, × 3
      // prime due : roundHalfUp(45 × 7/10) = 31,5 unités (08 E7)
      expect(computeQuote(request(40n * step, p), p).legs.INSURER.amountMinor).toBe(
        (45n * step * 7n) / 10n,
      );
    }
  });
});

describe('grille incohérente ⇒ QUOTE_UNAVAILABLE ; niveau refusé ⇒ PROTECTION_LEVEL_NOT_ELIGIBLE', () => {
  const c = CENTS.currency;
  it.each([
    ['rang en double', [terms(c, 'BASICA', 1, ratio(1n, 4n)), terms(c, 'TOTAL', 1, ratio(1n, 2n))]],
    ['part au-delà de 1', [terms(c, 'BASICA', 1, ratio(5n, 4n))]],
    ['rang nul', [terms(c, 'BASICA', 0, ratio(1n, 4n))]],
    ['plancher > plafond', [terms(c, 'BASICA', 1, ratio(1n, 4n), { floor: 500n, ceiling: 400n })]],
  ] as const)('%s', (_name, levels) => {
    const p = withGrid(CENTS, [...levels]);
    expect(codeOf(() => computeQuote(request(4_000n, p), p))).toBe('QUOTE_UNAVAILABLE');
  });

  it('minimum du pays absent de la grille ⇒ QUOTE_UNAVAILABLE', () => {
    const p = withGrid(CENTS, [terms(c, 'ESTANDAR', 2, ratio(2n, 5n))]);
    expect(codeOf(() => computeQuote(request(4_000n, p, { level: 'ESTANDAR' }), p))).toBe(
      'QUOTE_UNAVAILABLE',
    );
  });

  it('niveau inconnu, sous le minimum ou refusé à l’âge ⇒ PROTECTION_LEVEL_NOT_ELIGIBLE ; sans niveau ⇒ PROTECTION_LEVEL_REQUIRED ; âge non entier ⇒ QUOTE_INPUT_INVALID', () => {
    const p = withGrid(CENTS, [
      terms(c, 'INFERIEURE', 1, ratio(1n, 10n)),
      terms(c, 'BASICA', 2, ratio(1n, 4n)),
      terms(c, 'TOTAL', 3, ratio(13n, 20n), { minDriverAge: 21 }),
    ]);
    const code = (r: QuoteRequest) => codeOf(() => computeQuote(r, p));
    expect(code(request(4_000n, p, { level: 'PRO' }))).toBe('PROTECTION_LEVEL_NOT_ELIGIBLE');
    expect(code(request(4_000n, p, { level: 'INFERIEURE' }))).toBe('PROTECTION_LEVEL_NOT_ELIGIBLE');
    expect(code(request(4_000n, p, { level: 'TOTAL' }))).toBe('PROTECTION_LEVEL_NOT_ELIGIBLE');
    expect(code(request(4_000n, p, { level: 'TOTAL', age: 20 }))).toBe(
      'PROTECTION_LEVEL_NOT_ELIGIBLE',
    );
    expect(code(request(4_000n, p, { level: 'TOTAL', age: 21 }))).toBe('OK');
    expect(code(request(4_000n, p, { level: 'TOTAL', age: 20.5 }))).toBe('QUOTE_INPUT_INVALID');
    const without: { -readonly [K in keyof QuoteRequest]: QuoteRequest[K] } = request(4_000n, p);
    delete without.protectionLevel;
    expect(code(without)).toBe('PROTECTION_LEVEL_REQUIRED');
  });

  it('ligne PROTECTION fournie par l’appelant ⇒ QUOTE_INPUT_INVALID (calculée, jamais fournie)', () => {
    const p = withGrid(CENTS, [terms(c, 'BASICA', 1, ratio(1n, 4n))]);
    expect(
      codeOf(() =>
        computeQuote(request(4_000n, p, { lines: { PROTECTION: money(1n, CENTS.currency) } }), p),
      ),
    ).toBe('QUOTE_INPUT_INVALID');
  });
});

describe('part de l’assureur du niveau choisi (08 E7)', () => {
  const c = CENTS.currency;
  it('la part du niveau remplace une part unique de l’instantané ; part absente pour ce niveau ⇒ QUOTE_UNAVAILABLE, jamais une prime nulle', () => {
    const p: QuoteParams = {
      ...withGrid(CENTS, [
        terms(c, 'BASICA', 1, ratio(1n, 4n)),
        terms(c, 'TOTAL', 2, ratio(1n, 2n)),
      ]),
      insurerPremiumShare: ratio(1n, 2n),
      insurerPremiumShareByLevel: { BASICA: ratio(7n, 10n) },
    };
    const q = computeQuote(request(4_000n, p), p);
    // 3 × 10,00 = 30,00 ; prime 0,7 × 30,00 = 21,00 (note de TJ01)
    expect(q.legs.INSURER.amountMinor).toBe(2_100n);
    expect(q.insurerPremiumShare).toEqual(ratio(7n, 10n));
    expect(codeOf(() => computeQuote(request(4_000n, p, { level: 'TOTAL' }), p))).toBe(
      'QUOTE_UNAVAILABLE',
    );
  });
});

describe('niveaux proposés (16 BKG-003, PRT-001)', () => {
  const c = CENTS.currency;
  const p = withGrid(CENTS, [
    terms(c, 'TOTAL', 3, ratio(13n, 20n), { minDriverAge: 21 }),
    terms(c, 'INFERIEURE', 1, ratio(1n, 10n)),
    terms(c, 'BASICA', 2, ratio(1n, 4n)),
  ]);

  it('au moins le minimum, par rang croissant ; un niveau refusé à l’âge reste listé, grisé avec sa raison', () => {
    const at20 = protectionOptions(p, money(4_000n, c), 3, 20);
    expect(
      at20.map((o) => [o.level, o.eligible, o.reason, o.daily.amountMinor, o.line.amountMinor]),
    ).toEqual([
      ['BASICA', true, null, 1_000n, 3_000n],
      ['TOTAL', false, 'DRIVER_AGE', 2_600n, 7_800n],
    ]);
    expect(protectionOptions(p, money(4_000n, c), 3, 21).map((o) => o.eligible)).toEqual([
      true,
      true,
    ]);
    expect(protectionOptions(p, money(4_000n, c), 3, undefined)[1]?.eligible).toBe(false);
  });

  it('sans grille : aucun niveau ; jours facturables invalides ⇒ QUOTE_INPUT_INVALID', () => {
    const noGrid: { -readonly [K in keyof QuoteParams]: QuoteParams[K] } = { ...p };
    delete noGrid.protectionGrid;
    expect(protectionOptions(noGrid, money(4_000n, c), 3, 30)).toEqual([]);
    expect(codeOf(() => protectionOptions(p, money(4_000n, c), 0, 30))).toBe('QUOTE_INPUT_INVALID');
  });
});

describe('devis figé avec protection (16 PRC-025 : rejouable)', () => {
  it.each([
    ['exposant 2', CENTS, 4_000n],
    ['exposant 0', WHOLE, 333_334n],
  ] as const)(
    '%s : freezeQuote puis replayFrozenQuote ⇒ mêmes lignes, prime et niveau, grille et parts par niveau figées',
    (_n, base, daily) => {
      const c = base.currency;
      const p = withGrid(base, [
        terms(c, 'BASICA', 1, ratio(1n, 4n), { floor: 1n, ceiling: daily }),
        terms(c, 'TOTAL', 2, ratio(13n, 20n), { minDriverAge: 21 }),
      ]);
      const { quote, frozen } = freezeQuote(request(daily, p, { level: 'TOTAL', age: 30 }), p);
      const again = replayFrozenQuote(frozen);
      expect(again.lines).toEqual(quote.lines);
      expect(again.legs).toEqual(quote.legs);
      expect(again.protectionLevel).toBe('TOTAL');
      expect(again.hostPlan).toBe(base.hostPlan);
      const inputs = JSON.parse(frozen.inputs) as {
        request: Record<string, unknown>;
        params: Record<string, unknown>;
      };
      expect(inputs.request).toMatchObject({ protectionLevel: 'TOTAL', driverAge: 30 });
      expect(inputs.params['insurerPremiumShareByLevel']).toEqual({
        BASICA: '7/10',
        TOTAL: '7/10',
      });
    },
  );
});
