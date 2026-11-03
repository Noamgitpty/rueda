/**
 * Tests d'acceptation QA indépendants — US-015 (primitives monétaires).
 * Écrits à partir de la spécification seule (19 US-015, 08 BR-PRICE-14 et pseudo-code BR-CXL,
 * 16 A.8.1) et du README / point d'entrée public. Aucune lecture de l'implémentation.
 * Valeurs attendues : vecteurs de 08 (T..) et de 16 (TA..), confirmées par les oracles Python
 * `independent_settlement_check.py`, `verif11_settlement.py`, `verif15_ta.py`
 * (`python -I -X utf8`, depuis docs/specs/) : « ECARTS sur T01-T48 : 0 », TA01–TA08 OK.
 * Les montants sont écrits en unités mineures (USD : cents ; PYG : guaraní).
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_MINOR,
  MIN_AMOUNT_MINOR,
  MONEY_ERROR_CODES,
  MoneyError,
  add,
  allocHost,
  compare,
  compareRatios,
  createCurrencyRegistry,
  isMoneyError,
  isNegative,
  isZero,
  money,
  moneyFromSafeInteger,
  moneyToJSON,
  multiplyByInteger,
  multiplyRatios,
  multiplyRoundHalfUp,
  negate,
  parseMajor,
  parseMinor,
  parseRatio,
  ratio,
  ratioOf,
  requirePositive,
  roundHalfUp,
  splitHostPlatform,
  subtract,
  sum,
  taxByLine,
  toMajorString,
  toMinorString,
  zero,
} from '../src/index.ts';

// Registre construit par le test (configuration), pas importé de l'auteur.
const reg = createCurrencyRegistry([
  { code: 'USD', exponent: 2 },
  { code: 'PYG', exponent: 0 },
  { code: 'KWD', exponent: 3 },
]);
const USD = reg.get('USD');
const PYG = reg.get('PYG');
const KWD = reg.get('KWD');

const u = (n: bigint) => money(n, USD);
const g = (n: bigint) => money(n, PYG);
const r = (n: bigint, d: bigint) => ratio(n, d);
const PCT75 = parseRatio('0.75');
const HALF = r(1n, 2n);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    expect(isMoneyError(e)).toBe(true);
    expect(e).toBeInstanceOf(MoneyError);
    return (e as MoneyError).code;
  }
  return undefined;
}

describe('US-015 critère 2 — devises différentes', () => {
  it('add / subtract / compare / sum / ratioOf entre USD et PYG → MONEY_CURRENCY_MISMATCH', () => {
    expect(codeOf(() => add(u(1n), g(1n)))).toBe('MONEY_CURRENCY_MISMATCH');
    expect(codeOf(() => subtract(u(1n), g(1n)))).toBe('MONEY_CURRENCY_MISMATCH');
    expect(codeOf(() => compare(u(1n), g(1n)))).toBe('MONEY_CURRENCY_MISMATCH');
    expect(codeOf(() => sum(USD, [u(1n), g(1n)]))).toBe('MONEY_CURRENCY_MISMATCH');
    expect(codeOf(() => ratioOf(u(1n), g(2n)))).toBe('MONEY_CURRENCY_MISMATCH');
  });
  it('même devise : addition exacte', () => {
    expect(add(u(1n), u(2n)).amountMinor).toBe(3n);
    expect(sum(PYG, [g(1n), g(2n), g(3n)]).amountMinor).toBe(6n);
    expect(sum(PYG, []).amountMinor).toBe(0n);
  });
  it('le catalogue expose les codes de référence de 16 PRC-021', () => {
    expect(MONEY_ERROR_CODES).toContain('MONEY_CURRENCY_MISMATCH');
    expect(MONEY_ERROR_CODES).toContain('CURRENCY_UNSUPPORTED');
  });
});

describe('US-015 critère 3 — pilote → chaîne → bigint, sans number flottant', () => {
  it('PYG × taux décimal lu depuis une chaîne : 25 666 × 0,07 = 1 796,62 → 1 797', () => {
    const m = parseMinor('25666', PYG);
    expect(multiplyRoundHalfUp(m, parseRatio('0.07')).amountMinor).toBe(1797n);
  });
  it('au-delà de 2^53 un flottant se tromperait ; le résultat reste exact', () => {
    const a = 9007199254740993n; // 2^53 + 1
    const m = parseMinor('9007199254740993', PYG);
    expect(m.amountMinor).toBe(a);
    // (2^53+1)/2 = 4503599627370496,5 → demi vers le haut
    expect(multiplyRoundHalfUp(m, HALF).amountMinor).toBe(4503599627370497n);
    // roundHalfUp(a × 7/100) = floor((2·a·7 + 100) / 200), calculé en entiers
    expect(multiplyRoundHalfUp(m, parseRatio('0.07')).amountMinor).toBe(
      (2n * a * 7n + 100n) / 200n,
    );
  });
  it('un number est refusé à la construction (MONEY_INVALID_AMOUNT)', () => {
    expect(codeOf(() => money(5 as unknown as bigint, USD))).toBe('MONEY_INVALID_AMOUNT');
    expect(codeOf(() => money(1.5 as unknown as bigint, USD))).toBe('MONEY_INVALID_AMOUNT');
    expect(codeOf(() => money('5' as unknown as bigint, USD))).toBe('MONEY_INVALID_AMOUNT');
  });
  it('le seul accès number est un entier sûr', () => {
    expect(moneyFromSafeInteger(250, USD).amountMinor).toBe(250n);
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, -(2 ** 53)]) {
      expect(codeOf(() => moneyFromSafeInteger(bad, USD))).toBe('MONEY_INVALID_AMOUNT');
    }
  });
  it('chaînes mal formées refusées', () => {
    for (const bad of ['1.5', '', ' 1', '1e3', 'abc', '0x10', '1_000']) {
      expect(codeOf(() => parseMinor(bad, USD))).toBe('MONEY_INVALID_AMOUNT');
    }
    expect(codeOf(() => parseRatio('1/0'))).toBe('RATIO_INVALID');
    expect(codeOf(() => parseRatio('abc'))).toBe('RATIO_INVALID');
  });
  it('un faux Money (montant number) est refusé par add', () => {
    const fake = { amountMinor: 5, currency: USD } as unknown as ReturnType<typeof u>;
    expect(codeOf(() => add(fake, u(1n)))).toBe('MONEY_INVALID_AMOUNT');
  });
});

describe('US-015 critère 1 — T40 (PYG, 08) étape par étape', () => {
  // D2 : P = 1 000 002, F = 125 500, D = 50 000 ; j = 1 ; days = 3 ; part hôte 0,75 ; IVA 10 %.
  const P = g(1_000_002n);
  const F = g(125_500n);
  const D = g(50_000n);
  const third = r(1n, 3n);
  it('retenues : 333 334 + 41 833 + 25 000 = 400 167', () => {
    expect(multiplyRoundHalfUp(P, third).amountMinor).toBe(333_334n); // 1 000 002/3 exact
    expect(multiplyRoundHalfUp(F, third).amountMinor).toBe(41_833n); // 41 833,33
    expect(multiplyRoundHalfUp(D, HALF).amountMinor).toBe(25_000n);
    expect(333_334n + 41_833n + 25_000n).toBe(400_167n);
  });
  it('remboursement HT 925 335 et taxe 75 033', () => {
    expect(1_000_002n - 333_334n + (125_500n - 41_833n) + 150_000n + 25_000n).toBe(925_335n);
    expect(taxByLine(PYG, [P, F], parseRatio('0.10')).amountMinor).toBe(112_550n);
    // 112 550 × 750 335 / 1 125 502 = 75 033,37 → 75 033
    expect(multiplyRoundHalfUp(g(112_550n), r(750_335n, 1_125_502n)).amountMinor).toBe(75_033n);
  });
  it('égalité exacte de allocHost : 0,75 × 333 334 = 250 000,5 → 250 000 (plateforme)', () => {
    expect(allocHost(g(333_334n), PCT75).amountMinor).toBe(250_000n);
    expect(allocHost(g(25_000n), PCT75).amountMinor).toBe(18_750n);
    const s = splitHostPlatform(g(333_334n), PCT75);
    expect(s.host.amountMinor).toBe(250_000n);
    expect(s.platform.amountMinor).toBe(83_334n);
  });
});

describe('US-015 critère 1 — T42 (USD, centimes impairs, 08) étape par étape', () => {
  const P = u(4501n);
  const F = u(675n);
  const D = u(1501n);
  const threeQuarters = r(3n, 4n);
  it('retenues : 33,76 + 5,06 + 7,51 = 46,33', () => {
    expect(multiplyRoundHalfUp(P, threeQuarters).amountMinor).toBe(3376n); // 3375,75
    expect(multiplyRoundHalfUp(F, threeQuarters).amountMinor).toBe(506n); // 506,25
    expect(multiplyRoundHalfUp(D, HALF).amountMinor).toBe(751n); // 750,5 → vers le haut
  });
  it('taxe payée par ligne 3,62 ; taxe remboursée 362 × 1294/5176 = 90,5 → 91', () => {
    expect(taxByLine(USD, [P, F], parseRatio('0.07')).amountMinor).toBe(362n);
    expect(multiplyRoundHalfUp(u(362n), r(1294n, 5176n)).amountMinor).toBe(91n);
  });
  it('part hôte : 0,75 × 33,76 = 25,32 ; 0,75 × 7,51 = 5,6325 → 5,63', () => {
    expect(allocHost(u(3376n), PCT75).amountMinor).toBe(2532n);
    expect(allocHost(u(751n), PCT75).amountMinor).toBe(563n);
  });
});

describe('US-015 critère 1 — T43 (taxe par ligne ≠ agrégée, 08)', () => {
  const lines = [u(1005n), u(1005n)];
  const rate = parseRatio('0.07');
  it('par ligne : 0,70 + 0,70 = 1,40 ; agrégée : 1,41', () => {
    expect(taxByLine(USD, lines, rate).amountMinor).toBe(140n);
    expect(multiplyRoundHalfUp(sum(USD, lines), rate).amountMinor).toBe(141n);
  });
  it('retenues, taxe remboursée et part hôte', () => {
    expect(multiplyRoundHalfUp(u(1005n), r(1n, 4n)).amountMinor).toBe(251n); // 251,25 (j = ½ sur 2 j)
    expect(multiplyRoundHalfUp(u(140n), r(1508n, 2010n)).amountMinor).toBe(105n); // 105,03
    expect(allocHost(u(251n), PCT75).amountMinor).toBe(188n); // 188,25
  });
});

describe('US-015 critère 1 — TA06 (16 A.8.1)', () => {
  const rent = u(4501n);
  it('ITBMS roundHalfUp(315,07) = 3,15 ; total 48,16', () => {
    const tax = multiplyRoundHalfUp(rent, parseRatio('0.07'));
    expect(tax.amountMinor).toBe(315n);
    expect(add(rent, tax).amountMinor).toBe(4816n);
  });
  it('retenu roundHalfUp(2 250,5) = 22,51', () => {
    expect(multiplyRoundHalfUp(rent, HALF).amountMinor).toBe(2251n);
    expect(roundHalfUp(r(4501n, 2n))).toBe(2251n);
  });
  it('ITBMS remboursé 315 × 2 250/4 501 = 157,46 → 1,57 ; remboursement 24,07 ; conservé 24,09', () => {
    const reftax = multiplyRoundHalfUp(u(315n), r(2250n, 4501n));
    expect(reftax.amountMinor).toBe(157n);
    const refund = add(u(2250n), reftax);
    expect(refund.amountMinor).toBe(2407n);
    expect(subtract(u(4816n), refund).amountMinor).toBe(2409n);
  });
  it('commission roundHalfUp(270,12) = 2,70', () => {
    expect(multiplyRoundHalfUp(u(2251n), parseRatio('0.12')).amountMinor).toBe(270n);
  });
});

describe('Autres vecteurs de 08 / 16 (USD et PYG)', () => {
  it('T27 (PYG) : retenues 333 333 / 41 833, taxe 75 033, part hôte 250 000', () => {
    expect(multiplyRoundHalfUp(g(1_000_000n), r(1n, 3n)).amountMinor).toBe(333_333n);
    expect(multiplyRoundHalfUp(g(125_500n), r(1n, 3n)).amountMinor).toBe(41_833n);
    expect(multiplyRoundHalfUp(g(112_550n), r(750_334n, 1_125_500n)).amountMinor).toBe(75_033n);
    expect(allocHost(g(333_333n), PCT75).amountMinor).toBe(250_000n); // 249 999,75 → ceil
    expect(allocHost(g(25_000n), PCT75).amountMinor).toBe(18_750n);
  });
  it('T41 (PYG) : 666 667, 83 667, taxe 37 517, part hôte 500 000', () => {
    expect(multiplyRoundHalfUp(g(2_000_000n), r(1n, 3n)).amountMinor).toBe(666_667n);
    expect(multiplyRoundHalfUp(g(251_000n), r(1n, 3n)).amountMinor).toBe(83_667n);
    expect(multiplyRoundHalfUp(g(112_550n), r(375_166n, 1_125_500n)).amountMinor).toBe(37_517n);
    expect(allocHost(g(666_667n), PCT75).amountMinor).toBe(500_000n); // 500 000,25
  });
  it('T55 (PYG/USD) : roundHalfUp(13 912,83) = 13 913 ; roundHalfUp(359 512,5) = 359 513', () => {
    expect(multiplyRoundHalfUp(g(1_000_367n), r(20_000n, 1_438_050n)).amountMinor).toBe(13_913n);
    expect(multiplyRoundHalfUp(g(5_000n), r(1_438_050n, 20_000n)).amountMinor).toBe(359_513n);
  });
  it('T09 (USD, j = ¾ sur 2 jours) : retenues 30,00 / 4,50 ; taxe 402,5 → 4,03 ; hôte 22,50', () => {
    const k = r(3n, 8n);
    expect(multiplyRoundHalfUp(u(8000n), k).amountMinor).toBe(3000n);
    expect(multiplyRoundHalfUp(u(1200n), k).amountMinor).toBe(450n);
    expect(multiplyRoundHalfUp(u(644n), r(5750n, 9200n)).amountMinor).toBe(403n);
    expect(allocHost(u(3000n), PCT75).amountMinor).toBe(2250n);
  });
  it('T03 / T04 (USD) : taxe 9,66 = 80 + 12 + 30 + 15 + 9 + 15 + 20 ; remboursées 6,44 et 4,83 ; hôte 30,00', () => {
    expect(multiplyRoundHalfUp(u(966n), r(92n, 138n)).amountMinor).toBe(644n);
    expect(multiplyRoundHalfUp(u(644n), r(69n, 92n)).amountMinor).toBe(483n);
    expect(allocHost(u(4000n), PCT75).amountMinor).toBe(3000n);
  });
  it('T35 (USD, promo négative) : roundHalfUp(−20,00/3) = −6,67 ; taxe 826 × 7 867/11 800 → 5,51', () => {
    expect(multiplyRoundHalfUp(u(-2000n), r(1n, 3n)).amountMinor).toBe(-667n);
    expect(multiplyRoundHalfUp(u(826n), r(7867n, 11_800n)).amountMinor).toBe(551n);
  });
  it('TA01 / TA02 / TA05 / TA08 (16 A.8.1)', () => {
    expect(multiplyRoundHalfUp(u(12_000n), parseRatio('0.07')).amountMinor).toBe(840n);
    expect(multiplyRoundHalfUp(u(12_000n), r(1n, 3n)).amountMinor).toBe(4000n);
    expect(multiplyRoundHalfUp(u(840n), r(8000n, 12_000n)).amountMinor).toBe(560n); // TA02 : 5,60
    expect(multiplyRoundHalfUp(u(4000n), parseRatio('0.12')).amountMinor).toBe(480n); // 4,80
    expect(multiplyRoundHalfUp(u(8000n), r(1n, 4n)).amountMinor).toBe(2000n); // TA05
    expect(multiplyRoundHalfUp(u(560n), r(6000n, 8000n)).amountMinor).toBe(420n);
    // TA08 : commission par ligne puis somme = 34,20
    const lines = [u(12_000n), u(8000n), u(4501n), u(4000n)];
    expect(taxByLine(USD, lines, parseRatio('0.12')).amountMinor).toBe(3420n);
  });
  it('TA03 (no-show j = 2) : remboursement 42,80 et commission 9,60', () => {
    expect(multiplyRoundHalfUp(u(12_000n), r(2n, 3n)).amountMinor).toBe(8000n);
    expect(multiplyRoundHalfUp(u(840n), r(4000n, 12_000n)).amountMinor).toBe(280n);
    expect(multiplyRoundHalfUp(u(8000n), parseRatio('0.12')).amountMinor).toBe(960n);
  });
});

describe('roundHalfUp : demi-unité vers +∞, aussi pour une valeur négative (08 pseudo-code)', () => {
  const cases: Array<[bigint, bigint, bigint]> = [
    [5n, 2n, 3n],
    [-5n, 2n, -2n],
    [1n, 2n, 1n],
    [-1n, 2n, 0n],
    [-3n, 2n, -1n],
    [3n, 2n, 2n],
    [7n, 3n, 2n],
    [-7n, 3n, -2n],
    [1n, 3n, 0n],
    [-1n, 3n, 0n],
    [2n, 3n, 1n],
    [-2n, 3n, -1n],
    [0n, 5n, 0n],
    [8n, 4n, 2n],
    [-8n, 4n, -2n],
  ];
  for (const [n, d, e] of cases) {
    it(`${n}/${d} → ${e}`, () => expect(roundHalfUp(r(n, d))).toBe(e));
  }
  it('dénominateur nul → RATIO_INVALID', () => {
    expect(codeOf(() => ratio(1n, 0n))).toBe('RATIO_INVALID');
  });
  it('composant number refusé', () => {
    expect(codeOf(() => ratio(1 as unknown as bigint, 2n))).toBe('RATIO_INVALID');
  });
  it('multiplication exacte puis arrondi unique', () => {
    expect(compareRatios(multiplyRatios(r(1n, 3n), r(3n, 4n)), r(1n, 4n))).toBe(0);
    expect(compareRatios(r(1n, 3n), r(1n, 2n))).toBeLessThan(0);
    expect(compareRatios(r(2n, 4n), r(1n, 2n))).toBe(0);
    expect(roundHalfUp(multiplyRatios(r(2n, 3n), r(3n, 4n)))).toBe(1n); // 1/2 → 1
  });
});

describe('allocHost — arrondi au plus proche, égalité exacte → plateforme (08 BR-PRICE-14)', () => {
  it('égalités exactes → floor (la plateforme prend le résidu)', () => {
    expect(allocHost(u(1n), HALF).amountMinor).toBe(0n); // 0,5
    expect(allocHost(u(3n), HALF).amountMinor).toBe(1n); // 1,5
    expect(allocHost(u(5n), HALF).amountMinor).toBe(2n); // 2,5
    expect(allocHost(g(2n), r(1n, 4n)).amountMinor).toBe(0n); // 0,5
    expect(allocHost(g(6n), r(1n, 4n)).amountMinor).toBe(1n); // 1,5
    expect(allocHost(g(10n), r(1n, 20n)).amountMinor).toBe(0n); // 0,5
  });
  it('hors égalité : au plus proche', () => {
    expect(allocHost(g(333_333n), PCT75).amountMinor).toBe(250_000n); // .75 → ceil
    expect(allocHost(g(666_667n), PCT75).amountMinor).toBe(500_000n); // .25 → floor
    expect(allocHost(u(1n), r(1n, 3n)).amountMinor).toBe(0n); // .333
    expect(allocHost(u(2n), r(1n, 3n)).amountMinor).toBe(1n); // .667
  });
  it('bornes 0 et 100 %', () => {
    expect(allocHost(u(12_345n), r(0n, 1n)).amountMinor).toBe(0n);
    expect(allocHost(u(12_345n), r(1n, 1n)).amountMinor).toBe(12_345n);
    expect(allocHost(u(0n), PCT75).amountMinor).toBe(0n);
  });
  it('part hors [0 ; 1] → SHARE_OUT_OF_RANGE', () => {
    expect(codeOf(() => allocHost(u(100n), r(3n, 2n)))).toBe('SHARE_OUT_OF_RANGE');
    expect(codeOf(() => allocHost(u(100n), r(-1n, 4n)))).toBe('SHARE_OUT_OF_RANGE');
    expect(codeOf(() => allocHost(u(100n), parseRatio('1.01')))).toBe('SHARE_OUT_OF_RANGE');
  });
  it('splitHostPlatform : host + platform = total exact, plateforme = complément', () => {
    for (const t of [0n, 1n, 2n, 3n, 5n, 999n, 1_000_001n, -1n, -3n, -999n]) {
      const s = splitHostPlatform(g(t), PCT75);
      expect(s.host.amountMinor + s.platform.amountMinor).toBe(t);
      expect(s.host.amountMinor).toBe(allocHost(g(t), PCT75).amountMinor);
    }
  });
  it('écart à la part exacte ≤ ½ unité', () => {
    const shares: Array<[bigint, bigint]> = [
      [3n, 4n],
      [1n, 2n],
      [1n, 3n],
      [2n, 7n],
      [1n, 8n],
    ];
    for (let t = -40n; t <= 40n; t++) {
      for (const [n, d] of shares) {
        const host = allocHost(g(t), r(n, d)).amountMinor;
        // |host − t·n/d| ≤ 1/2  ⇔  |2·d·host − 2·t·n| ≤ d
        const diff = 2n * d * host - 2n * t * n;
        expect(diff <= d && -diff <= d).toBe(true);
      }
    }
  });
  it('montants négatifs : au plus proche, égalité → floor (x = −1,5 → −2)', () => {
    expect(allocHost(g(-3n), HALF).amountMinor).toBe(-2n);
    expect(allocHost(g(-5n), PCT75).amountMinor).toBe(-4n); // −3,75
    expect(allocHost(g(-7n), PCT75).amountMinor).toBe(-5n); // −5,25
    expect(allocHost(g(-4n), PCT75).amountMinor).toBe(-3n); // exact
  });
});

describe('montants négatifs et signes', () => {
  it('lignes promo négatives', () => {
    expect(isNegative(u(-1n))).toBe(true);
    expect(isZero(zero(USD))).toBe(true);
    expect(negate(u(5n)).amountMinor).toBe(-5n);
    expect(add(u(1000n), u(-250n)).amountMinor).toBe(750n);
    expect(multiplyRoundHalfUp(u(-5n), HALF).amountMinor).toBe(-2n); // −2,5 → −2
    expect(multiplyRoundHalfUp(u(5n), HALF).amountMinor).toBe(3n);
    expect(multiplyByInteger(u(-7n), 3n).amountMinor).toBe(-21n);
  });
  it('taxe d une ligne négative arrondie de la même façon (08 BR-CXL-06)', () => {
    expect(taxByLine(USD, [u(-1005n)], parseRatio('0.07')).amountMinor).toBe(-70n); // −70,35
    expect(taxByLine(USD, [u(-25n)], parseRatio('0.1')).amountMinor).toBe(-2n); // −2,5
  });
  it('requirePositive refuse 0 et le négatif (MONEY_NOT_POSITIVE)', () => {
    expect(codeOf(() => requirePositive(u(0n)))).toBe('MONEY_NOT_POSITIVE');
    expect(codeOf(() => requirePositive(u(-1n)))).toBe('MONEY_NOT_POSITIVE');
    expect(codeOf(() => requirePositive(u(1n)))).toBeUndefined();
  });
  it('parseMajor / toMajorString négatifs', () => {
    expect(parseMajor('-0.05', USD).amountMinor).toBe(-5n);
    expect(toMajorString(u(-5n), USD)).toBe('-0.05');
  });
});

describe('PYG sans décimale ; exposant venant de la configuration', () => {
  it('PYG exposant 0 : parseMajor et toMajorString sans point', () => {
    expect(parseMajor('1438050', PYG).amountMinor).toBe(1_438_050n);
    expect(toMajorString(g(1_438_050n), PYG)).toBe('1438050');
    expect(toMinorString(g(1_438_050n))).toBe('1438050');
  });
  it('PYG : décimales refusées, jamais arrondies', () => {
    expect(codeOf(() => parseMajor('12.5', PYG))).toBe('MONEY_INVALID_AMOUNT');
  });
  it('USD : trop de décimales refusées', () => {
    expect(codeOf(() => parseMajor('1.234', USD))).toBe('MONEY_INVALID_AMOUNT');
    expect(parseMajor('1.5', USD).amountMinor).toBe(150n);
    expect(parseMajor('12', USD).amountMinor).toBe(1200n);
    expect(toMajorString(u(150n), USD)).toBe('1.50');
    expect(toMajorString(u(5n), USD)).toBe('0.05');
  });
  it('l exposant vient de la configuration : KWD (3) et un PYG reconfiguré à 2', () => {
    expect(parseMajor('1.234', KWD).amountMinor).toBe(1234n);
    expect(toMajorString(money(1234n, KWD), KWD)).toBe('1.234');
    const pyg2 = createCurrencyRegistry([{ code: 'PYG', exponent: 2 }]).get('PYG');
    expect(parseMajor('1.50', pyg2).amountMinor).toBe(150n);
    expect(toMajorString(money(150n, pyg2), pyg2)).toBe('1.50');
  });
  it('registre : devise inconnue, devise fabriquée à la main, configuration invalide', () => {
    expect(codeOf(() => reg.get('EUR'))).toBe('CURRENCY_UNSUPPORTED');
    const handmade = { code: 'USD', exponent: 2 } as unknown as typeof USD;
    expect(codeOf(() => money(1n, handmade))).toBe('CURRENCY_UNSUPPORTED');
    expect(codeOf(() => createCurrencyRegistry([{ code: 'USD', exponent: -1 }]))).toBe(
      'CURRENCY_CONFIG_INVALID',
    );
    expect(codeOf(() => createCurrencyRegistry([{ code: 'USD', exponent: 2.5 }]))).toBe(
      'CURRENCY_CONFIG_INVALID',
    );
    expect(codeOf(() => createCurrencyRegistry([{ code: 'usd', exponent: 2 }]))).toBe(
      'CURRENCY_CONFIG_INVALID',
    );
    expect(
      codeOf(() =>
        createCurrencyRegistry([
          { code: 'USD', exponent: 2 },
          { code: 'USD', exponent: 2 },
        ]),
      ),
    ).toBe('CURRENCY_CONFIG_INVALID');
  });
  // CONSTAT QA (MINEUR, rapport qa-2026-11-01) : deux registres donnant le même code avec des exposants
  // différents se mélangent sans erreur. Hors critères de la story ; consigné avec it.fails.
  it.fails('devises de registres distincts de même code : pas de mélange silencieux', () => {
    const other = createCurrencyRegistry([{ code: 'USD', exponent: 3 }]);
    expect(codeOf(() => add(u(1n), money(1n, other.get('USD'))))).toBeDefined();
  });
  it('aucun montant décimal : un PYG × taux reste un entier', () => {
    const v = multiplyRoundHalfUp(g(1_438_050n), parseRatio('0.10')).amountMinor;
    expect(typeof v).toBe('bigint');
    expect(v).toBe(143_805n);
  });
});

describe('débordement int64', () => {
  it('bornes', () => {
    expect(MAX_AMOUNT_MINOR).toBe(2n ** 63n - 1n);
    expect(g(MAX_AMOUNT_MINOR).amountMinor).toBe(MAX_AMOUNT_MINOR);
    expect(g(MIN_AMOUNT_MINOR).amountMinor).toBe(MIN_AMOUNT_MINOR);
    expect(codeOf(() => g(MAX_AMOUNT_MINOR + 1n))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => g(MIN_AMOUNT_MINOR - 1n))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => parseMinor('9223372036854775808', PYG))).toBe('MONEY_OUT_OF_RANGE');
  });
  it('add, subtract, multiplyByInteger hors bornes refusés (pas de troncature)', () => {
    expect(codeOf(() => add(g(MAX_AMOUNT_MINOR), g(1n)))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => subtract(g(MIN_AMOUNT_MINOR), g(1n)))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => multiplyByInteger(g(MAX_AMOUNT_MINOR), 2n))).toBe('MONEY_OUT_OF_RANGE');
    expect(codeOf(() => sum(PYG, [g(MAX_AMOUNT_MINOR), g(1n)]))).toBe('MONEY_OUT_OF_RANGE');
    expect(add(g(MAX_AMOUNT_MINOR), g(-1n)).amountMinor).toBe(MAX_AMOUNT_MINOR - 1n);
  });
  it('produits intermédiaires exacts : max × 2/3 reste exact, max × 3/2 est refusé', () => {
    const a = MAX_AMOUNT_MINOR;
    const expected = (4n * a + 3n) / 6n; // roundHalfUp(2a/3) = floor((2·2a + 3) / 6)
    expect(multiplyRoundHalfUp(g(a), r(2n, 3n)).amountMinor).toBe(expected);
    expect(multiplyRoundHalfUp(g(a), r(1n, 1n)).amountMinor).toBe(a);
    expect(allocHost(g(a), r(1n, 1n)).amountMinor).toBe(a);
    expect(codeOf(() => multiplyRoundHalfUp(g(a), r(3n, 2n)))).toBe('MONEY_OUT_OF_RANGE');
  });
  it('JSON : bigint sérialisé en chaîne', () => {
    const j = moneyToJSON(g(MAX_AMOUNT_MINOR));
    expect(j.amountMinor).toBe('9223372036854775807');
    expect(() => JSON.stringify(j)).not.toThrow();
    expect(JSON.stringify(j)).toContain('PYG');
  });
});

describe('invariant de partage sur vecteurs (host + platform = total)', () => {
  it('T40, T27, T42, T43', () => {
    for (const m of [g(333_334n), g(333_333n), g(666_667n), u(3376n), u(751n), u(251n)]) {
      const s = splitHostPlatform(m, PCT75);
      expect(add(s.host, s.platform).amountMinor).toBe(m.amountMinor);
    }
  });
});
