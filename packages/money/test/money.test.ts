import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_MINOR,
  MIN_AMOUNT_MINOR,
  add,
  allocHost,
  compare,
  equals,
  isMoney,
  isNegative,
  isPositive,
  isZero,
  max,
  min,
  money,
  moneyFromSafeInteger,
  moneyToJSON,
  multiplyByInteger,
  multiplyRoundHalfUp,
  negate,
  parseMajor,
  parseMinor,
  ratio,
  ratioOf,
  requirePositive,
  splitHostPlatform,
  subtract,
  sum,
  taxByLine,
  toMajorString,
  toMinorString,
  zero,
  type Money,
} from '../src/index.ts';
import { COUNTRY_VARIANTS, PYG, USD, errorCodeOf } from './fixtures.ts';

const usd = (minor: bigint): Money => money(minor, USD);
const pyg = (minor: bigint): Money => money(minor, PYG);
const H = ratio(3n, 4n); // part hôte de la configuration de test de 08 (75 %)

describe('construction : bigint seulement, number refusé (ADR-009)', () => {
  it.each(COUNTRY_VARIANTS)(
    '$country : money(bigint) et parseMinor(chaîne du pilote)',
    ({ currency }) => {
      const a = money(25666n, currency);
      expect(a).toMatchObject({ amountMinor: 25666n, currency: currency.code });
      expect(isMoney(a)).toBe(true);
      expect(Object.isFrozen(a)).toBe(true);
      // 17 §1.2 : l'API et le pilote transportent une chaîne d'entier ; jamais de number.
      expect(parseMinor('25666', currency).amountMinor).toBe(25666n);
      expect(parseMinor('-450', currency).amountMinor).toBe(-450n);
      expect(parseMinor('0', currency).amountMinor).toBe(0n);
    },
  );

  it.each(COUNTRY_VARIANTS)('$country : un number est refusé par money()', ({ currency }) => {
    expect(errorCodeOf(() => money(100 as unknown as bigint, currency))).toBe(
      'MONEY_INVALID_AMOUNT',
    );
    expect(errorCodeOf(() => money('100' as unknown as bigint, currency))).toBe(
      'MONEY_INVALID_AMOUNT',
    );
  });

  it.each(COUNTRY_VARIANTS)(
    '$country : moneyFromSafeInteger accepte un entier sûr et refuse le reste',
    ({ currency }) => {
      expect(moneyFromSafeInteger(4501, currency).amountMinor).toBe(4501n);
      expect(moneyFromSafeInteger(-1, currency).amountMinor).toBe(-1n);
      expect(moneyFromSafeInteger(Number.MAX_SAFE_INTEGER, currency).amountMinor).toBe(
        9007199254740991n,
      );
      for (const bad of [45.01, 0.1 + 0.2, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        expect(errorCodeOf(() => moneyFromSafeInteger(bad, currency))).toBe('MONEY_INVALID_AMOUNT');
      }
      expect(errorCodeOf(() => moneyFromSafeInteger(1n as unknown as number, currency))).toBe(
        'MONEY_INVALID_AMOUNT',
      );
    },
  );

  it.each(['', ' 1', '+1', '1.0', '01', '-0', '1e3', '1_000', '0x1F', '١٢'])(
    'parseMinor refuse %j : MONEY_INVALID_AMOUNT',
    (text) => {
      expect(errorCodeOf(() => parseMinor(text, USD))).toBe('MONEY_INVALID_AMOUNT');
    },
  );

  it('refuse un objet qui imite un Money : MONEY_INVALID_AMOUNT', () => {
    const forged = { amountMinor: 1n, currency: 'USD' } as unknown as Money;
    expect(errorCodeOf(() => add(forged, usd(1n)))).toBe('MONEY_INVALID_AMOUNT');
  });
});

describe('unités majeures : exposant de la configuration', () => {
  it('PA (USD, exposant 2)', () => {
    expect(parseMajor('45.01', USD).amountMinor).toBe(4501n);
    expect(parseMajor('45.1', USD).amountMinor).toBe(4510n);
    expect(parseMajor('45', USD).amountMinor).toBe(4500n);
    expect(parseMajor('-20.00', USD).amountMinor).toBe(-2000n);
    expect(parseMajor('0.07', USD).amountMinor).toBe(7n);
    expect(toMajorString(usd(25666n), USD)).toBe('256.66');
    expect(toMajorString(usd(7n), USD)).toBe('0.07');
    expect(toMajorString(usd(-667n), USD)).toBe('-6.67');
    expect(toMajorString(usd(0n), USD)).toBe('0.00');
  });

  it('PY (PYG, exposant 0)', () => {
    expect(parseMajor('1438052', PYG).amountMinor).toBe(1438052n);
    expect(parseMajor('-450', PYG).amountMinor).toBe(-450n);
    expect(toMajorString(pyg(1438052n), PYG)).toBe('1438052');
    expect(toMajorString(pyg(-1n), PYG)).toBe('-1');
  });

  it('refuse plus de décimales que l’exposant, sans arrondir (EC-32) : MONEY_INVALID_AMOUNT', () => {
    expect(errorCodeOf(() => parseMajor('45.015', USD))).toBe('MONEY_INVALID_AMOUNT');
    expect(errorCodeOf(() => parseMajor('1000.5', PYG))).toBe('MONEY_INVALID_AMOUNT');
    expect(errorCodeOf(() => parseMajor('1000.0', PYG))).toBe('MONEY_INVALID_AMOUNT');
    expect(errorCodeOf(() => parseMajor('1.000', PYG))).toBe('MONEY_INVALID_AMOUNT');
    expect(errorCodeOf(() => parseMajor('45,01', USD))).toBe('MONEY_INVALID_AMOUNT');
  });

  it('toMajorString refuse une devise différente : MONEY_CURRENCY_MISMATCH', () => {
    expect(errorCodeOf(() => toMajorString(usd(1n), PYG))).toBe('MONEY_CURRENCY_MISMATCH');
  });

  it('sérialise sans number (17 §1.2)', () => {
    expect(toMinorString(pyg(1438052n))).toBe('1438052');
    expect(moneyToJSON(usd(25666n))).toEqual({ amountMinor: '25666', currency: 'USD' });
    expect(JSON.stringify(moneyToJSON(pyg(9007199254740993n)))).toBe(
      '{"amountMinor":"9007199254740993","currency":"PYG"}',
    );
  });
});

describe('aucune opération entre devises (16 PRC-021 : MONEY_CURRENCY_MISMATCH)', () => {
  const a = usd(100n);
  const b = pyg(100n);
  it.each([
    ['add', () => add(a, b)],
    ['subtract', () => subtract(a, b)],
    ['compare', () => compare(a, b)],
    ['equals', () => equals(a, b)],
    ['max', () => max(a, b)],
    ['min', () => min(a, b)],
    ['ratioOf', () => ratioOf(a, b)],
    ['sum', () => sum(USD, [a, b])],
    ['taxByLine', () => taxByLine(PYG, [a], ratio(1n, 10n))],
  ])('%s', (_name, operation) => {
    expect(errorCodeOf(operation)).toBe('MONEY_CURRENCY_MISMATCH');
  });
});

describe.each(COUNTRY_VARIANTS)('arithmétique exacte — $country', ({ currency }) => {
  const m = (minor: bigint): Money => money(minor, currency);

  it('addition, soustraction, opposé, somme', () => {
    expect(add(m(1000002n), m(125500n)).amountMinor).toBe(1125502n);
    expect(subtract(m(100n), m(250n)).amountMinor).toBe(-150n);
    expect(negate(m(450n)).amountMinor).toBe(-450n);
    expect(sum(currency, []).amountMinor).toBe(0n);
    expect(sum(currency, [m(1n), m(2n), m(-3n)]).amountMinor).toBe(0n);
    expect(multiplyByInteger(m(1000n), 3n).amountMinor).toBe(3000n);
    expect(errorCodeOf(() => multiplyByInteger(m(1n), 3 as unknown as bigint))).toBe(
      'MONEY_INVALID_AMOUNT',
    );
  });

  it('montants négatifs admis (ligne promo, net plateforme : 08 BR-PRICE-16, 17 §3.2)', () => {
    const promo = m(-2000n);
    expect(isNegative(promo)).toBe(true);
    expect(isPositive(promo)).toBe(false);
    expect(isZero(zero(currency))).toBe(true);
    expect(max(zero(currency), promo).amountMinor).toBe(0n); // plancher max(0, …) de 08
    expect(min(zero(currency), promo).amountMinor).toBe(-2000n);
  });

  it('montant d’écriture strictement positif (08 E4) : MONEY_NOT_POSITIVE sinon', () => {
    expect(requirePositive(m(1n)).amountMinor).toBe(1n);
    expect(errorCodeOf(() => requirePositive(m(0n)))).toBe('MONEY_NOT_POSITIVE');
    expect(errorCodeOf(() => requirePositive(m(-1n)))).toBe('MONEY_NOT_POSITIVE');
  });

  it('borne int64 (colonne bigint) : MONEY_OUT_OF_RANGE, jamais de troncature', () => {
    expect(m(MAX_AMOUNT_MINOR).amountMinor).toBe(9223372036854775807n);
    expect(m(MIN_AMOUNT_MINOR).amountMinor).toBe(-9223372036854775808n);
    expect(errorCodeOf(() => m(MAX_AMOUNT_MINOR + 1n))).toBe('MONEY_OUT_OF_RANGE');
    expect(errorCodeOf(() => add(m(MAX_AMOUNT_MINOR), m(1n)))).toBe('MONEY_OUT_OF_RANGE');
    expect(errorCodeOf(() => negate(m(MIN_AMOUNT_MINOR)))).toBe('MONEY_OUT_OF_RANGE');
    expect(errorCodeOf(() => parseMinor('9223372036854775808', currency))).toBe(
      'MONEY_OUT_OF_RANGE',
    );
    // les produits intermédiaires dépassent int64 sans perte : seul le résultat est borné
    expect(multiplyRoundHalfUp(m(MAX_AMOUNT_MINOR), ratio(1n, 2n)).amountMinor).toBe(
      4611686018427387904n,
    );
  });

  it('ratioOf refuse un dénominateur nul : RATIO_INVALID', () => {
    expect(errorCodeOf(() => ratioOf(m(1n), m(0n)))).toBe('RATIO_INVALID');
  });
});

describe('taxe par ligne puis somme (08 BR-PRICE-12, BR-PRICE-14 (2))', () => {
  it('T43 (trip G, USD) : 0,70 + 0,70 = 1,40, et non roundHalfUp(7 % × 20,10) = 1,41', () => {
    const lines = [usd(1005n), usd(1005n)];
    const rate = ratio(7n, 100n);
    expect(taxByLine(USD, lines, rate).amountMinor).toBe(140n);
    expect(multiplyRoundHalfUp(sum(USD, lines), rate).amountMinor).toBe(141n);
  });

  it('T35 (trip AP, USD) : 8,40 − 1,40 + 1,26 = 8,26, ligne promo négative', () => {
    // 08 tableau des trips T28–T48, trip AP : P 120,00, promo −20,00, F 18,00, taxe 7 % par ligne.
    expect(
      taxByLine(USD, [usd(12000n), usd(-2000n), usd(1800n)], ratio(7n, 100n)).amountMinor,
    ).toBe(826n);
  });

  it('T40 (trip D2, PYG) : 100 000 + 12 550 = 112 550', () => {
    // 08, trip D2 : P 1 000 002 et F 125 500 taxés à 10 % (100 000,2 → 100 000 ; 12 550).
    expect(taxByLine(PYG, [pyg(1000002n), pyg(125500n)], ratio(1n, 10n)).amountMinor).toBe(112550n);
  });

  it('liste vide : zéro dans la devise', () => {
    expect(taxByLine(PYG, [], ratio(1n, 10n))).toMatchObject({ amountMinor: 0n, currency: 'PYG' });
  });
});

describe('allocHost : au plus proche, égalité exacte → plateforme (08 BR-PRICE-14 (3))', () => {
  it.each([
    // [source, devise, montant, attendu]
    ['T40 : 0,75 × 333 334 = 250 000,5 → égalité, 250 000', PYG, 333334n, 250000n],
    ['T27 : 0,75 × 333 333 = 249 999,75 → 250 000', PYG, 333333n, 250000n],
    ['T40 / T27 : 0,75 × 25 000 = 18 750', PYG, 25000n, 18750n],
    ['T42 : 0,75 × 33,76 = 25,32', USD, 3376n, 2532n],
    ['T42 : 0,75 × 7,51 = 5,6325 → 5,63', USD, 751n, 563n],
    ['T43 : 0,75 × 2,51 = 1,8825 → 1,88', USD, 251n, 188n],
    ['T03 : 0,75 × 40,00 = 30,00', USD, 4000n, 3000n],
  ])('%s', (_source, currency, amount, expected) => {
    expect(allocHost(money(amount, currency), H).amountMinor).toBe(expected);
  });

  it('la plateforme prend le complément (T40 : 333 334 − 250 000 = 83 334)', () => {
    const { host, platform } = splitHostPlatform(pyg(333334n), H);
    expect(host.amountMinor).toBe(250000n);
    expect(platform.amountMinor).toBe(83334n);
  });

  it('égalité exacte → floor, au-dessus de la moitié → ceil (définition littérale de 08)', () => {
    expect(allocHost(usd(1n), ratio(1n, 2n)).amountMinor).toBe(0n); // 0,5 → 0
    expect(allocHost(usd(3n), ratio(1n, 2n)).amountMinor).toBe(1n); // 1,5 → 1
    expect(allocHost(usd(5n), ratio(3n, 10n)).amountMinor).toBe(1n); // 5 × 0,3 = 1,5 → 1
    expect(allocHost(usd(6n), ratio(3n, 10n)).amountMinor).toBe(2n); // 6 × 0,3 = 1,8 → 2
    expect(allocHost(usd(4n), ratio(3n, 10n)).amountMinor).toBe(1n); // 4 × 0,3 = 1,2 → 1
  });

  it('montant négatif : formule appliquée telle quelle (frac(x) = x − floor(x))', () => {
    // x = −5 × 1/2 = −2,5 ; floor = −3 ; frac = 1/2 ≤ 1/2 → −3
    expect(allocHost(usd(-5n), ratio(1n, 2n)).amountMinor).toBe(-3n);
    // x = −5 × 3/4 = −3,75 ; floor = −4 ; frac = 1/4 → −4
    expect(allocHost(usd(-5n), H).amountMinor).toBe(-4n);
    // x = −1 × 1/4 = −0,25 ; floor = −1 ; frac = 3/4 > 1/2 → ceil = 0
    expect(allocHost(usd(-1n), ratio(1n, 4n)).amountMinor).toBe(0n);
  });

  it('bornes de la part : 0 et 1 admis, hors [0 ; 1] refusé (SHARE_OUT_OF_RANGE)', () => {
    expect(allocHost(usd(4501n), ratio(0n, 1n)).amountMinor).toBe(0n);
    expect(allocHost(usd(4501n), ratio(1n, 1n)).amountMinor).toBe(4501n);
    expect(errorCodeOf(() => allocHost(usd(1n), ratio(-1n, 4n)))).toBe('SHARE_OUT_OF_RANGE');
    expect(errorCodeOf(() => allocHost(usd(1n), ratio(5n, 4n)))).toBe('SHARE_OUT_OF_RANGE');
  });
});
