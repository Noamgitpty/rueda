/**
 * US-042 — gardes fail-closed de l'API publique, fonction par fonction (mutants survivants de la
 * première mesure, ADR-076) : un faux `Money`, une devise hors registre, une fraction mal formée
 * ou un montant d'une autre devise sont refusés par **chaque** fonction, avec le code stable de
 * 16 PRC-021 / README (jamais une valeur silencieuse). Bornes et égalités des comparaisons.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_AMOUNT_MINOR,
  MAX_CURRENCY_EXPONENT,
  MIN_AMOUNT_MINOR,
  MoneyError,
  add,
  allocHost,
  assertCurrency,
  compare,
  compareRatios,
  createCurrencyRegistry,
  equals,
  isMoney,
  isMoneyError,
  isNegative,
  isPositive,
  isRatio,
  isZero,
  max,
  min,
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
  ratioToString,
  requirePositive,
  roundHalfUp,
  splitHostPlatform,
  subtract,
  sum,
  taxByLine,
  toMajorString,
  toMinorString,
  zero,
  type Currency,
  type Money,
  type Ratio,
} from '../src/index.ts';
import { floorDiv } from '../src/rounding.ts';
import { COUNTRY_VARIANTS, PYG, USD, errorCodeOf } from './fixtures.ts';

/** Objet qui a la forme d'un `Money` sans avoir été construit par le paquet. */
const FAKE_MONEY = Object.freeze({ amountMinor: 100n, currency: 'USD' }) as unknown as Money;
/** Objet qui a la forme d'une `Currency` sans venir du registre. */
const FAKE_CURRENCY = Object.freeze({ code: 'USD', exponent: 2 }) as unknown as Currency;
const BAD_RATIOS: readonly [string, unknown][] = [
  ['null', null],
  ['nombre', 0.5],
  ['composants number', { num: 1, den: 2 }],
  ['dénominateur nul', { num: 1n, den: 0n }],
  ['dénominateur négatif', { num: 1n, den: -2n }],
];
const HALF = ratio(1n, 2n);

describe.each(COUNTRY_VARIANTS)('gardes de l’API — $country', ({ currency }) => {
  const m = (x: bigint) => money(x, currency);
  const other = currency.code === USD.code ? PYG : USD;
  const foreign = () => money(1n, other);

  it('un faux Money est refusé par chaque fonction (MONEY_INVALID_AMOUNT)', () => {
    const calls: [string, () => unknown][] = [
      ['toMinorString', () => toMinorString(FAKE_MONEY)],
      ['toMajorString', () => toMajorString(FAKE_MONEY, currency)],
      ['moneyToJSON', () => moneyToJSON(FAKE_MONEY)],
      ['add a', () => add(FAKE_MONEY, m(1n))],
      ['add b', () => add(m(1n), FAKE_MONEY)],
      ['subtract a', () => subtract(FAKE_MONEY, m(1n))],
      ['subtract b', () => subtract(m(1n), FAKE_MONEY)],
      ['negate', () => negate(FAKE_MONEY)],
      ['sum', () => sum(currency, [m(1n), FAKE_MONEY])],
      ['multiplyByInteger', () => multiplyByInteger(FAKE_MONEY, 2n)],
      ['compare a', () => compare(FAKE_MONEY, m(1n))],
      ['compare b', () => compare(m(1n), FAKE_MONEY)],
      ['equals', () => equals(FAKE_MONEY, m(1n))],
      ['max', () => max(FAKE_MONEY, m(1n))],
      ['min', () => min(m(1n), FAKE_MONEY)],
      ['isZero', () => isZero(FAKE_MONEY)],
      ['isNegative', () => isNegative(FAKE_MONEY)],
      ['isPositive', () => isPositive(FAKE_MONEY)],
      ['requirePositive', () => requirePositive(FAKE_MONEY)],
      ['ratioOf part', () => ratioOf(FAKE_MONEY, m(1n))],
      ['ratioOf whole', () => ratioOf(m(1n), FAKE_MONEY)],
      ['multiplyRoundHalfUp', () => multiplyRoundHalfUp(FAKE_MONEY, HALF)],
      ['taxByLine', () => taxByLine(currency, [FAKE_MONEY], HALF)],
      ['allocHost', () => allocHost(FAKE_MONEY, HALF)],
      ['splitHostPlatform', () => splitHostPlatform(FAKE_MONEY, HALF)],
    ];
    for (const [name, call] of calls) {
      expect([name, errorCodeOf(call)]).toEqual([name, 'MONEY_INVALID_AMOUNT']);
    }
  });

  it('une devise hors registre est refusée (CURRENCY_UNSUPPORTED)', () => {
    const calls: [string, () => unknown][] = [
      ['money', () => money(1n, FAKE_CURRENCY)],
      ['moneyFromSafeInteger', () => moneyFromSafeInteger(1, FAKE_CURRENCY)],
      ['parseMinor', () => parseMinor('1', FAKE_CURRENCY)],
      ['parseMajor', () => parseMajor('1', FAKE_CURRENCY)],
      ['zero', () => zero(FAKE_CURRENCY)],
      ['toMajorString', () => toMajorString(m(1n), FAKE_CURRENCY)],
      ['sum', () => sum(FAKE_CURRENCY, [])],
      ['taxByLine', () => taxByLine(FAKE_CURRENCY, [], HALF)],
      ['assertCurrency objet', () => assertCurrency(FAKE_CURRENCY)],
      ['assertCurrency null', () => assertCurrency(null)],
      ['assertCurrency chaîne', () => assertCurrency('USD')],
    ];
    for (const [name, call] of calls) {
      expect([name, errorCodeOf(call)]).toEqual([name, 'CURRENCY_UNSUPPORTED']);
    }
  });

  it('un montant d’une autre devise est refusé (MONEY_CURRENCY_MISMATCH)', () => {
    const calls: [string, () => unknown][] = [
      ['add', () => add(m(1n), foreign())],
      ['subtract', () => subtract(m(1n), foreign())],
      ['compare', () => compare(m(1n), foreign())],
      ['sum', () => sum(currency, [foreign()])],
      ['taxByLine', () => taxByLine(currency, [foreign()], HALF)],
      ['toMajorString', () => toMajorString(foreign(), currency)],
      ['ratioOf', () => ratioOf(m(1n), foreign())],
    ];
    for (const [name, call] of calls) {
      expect([name, errorCodeOf(call)]).toEqual([name, 'MONEY_CURRENCY_MISMATCH']);
    }
  });

  it.each(BAD_RATIOS)('une fraction mal formée (%s) est refusée (RATIO_INVALID)', (_l, bad) => {
    const r = bad as Ratio;
    const calls: [string, () => unknown][] = [
      ['multiplyRoundHalfUp', () => multiplyRoundHalfUp(m(1n), r)],
      ['taxByLine', () => taxByLine(currency, [m(1n)], r)],
      ['allocHost', () => allocHost(m(1n), r)],
      ['roundHalfUp', () => roundHalfUp(r)],
      ['multiplyRatios a', () => multiplyRatios(r, HALF)],
      ['multiplyRatios b', () => multiplyRatios(HALF, r)],
      ['compareRatios a', () => compareRatios(r, HALF)],
      ['compareRatios b', () => compareRatios(HALF, r)],
      ['ratioToString', () => ratioToString(r)],
    ];
    for (const [name, call] of calls) {
      expect([name, errorCodeOf(call)]).toEqual([name, 'RATIO_INVALID']);
    }
    expect(isRatio(bad)).toBe(false);
  });

  it('comparaisons : −1 / 0 / 1 exacts, égalité, max et min en cas d’égalité', () => {
    expect(compare(m(1n), m(2n))).toBe(-1);
    expect(compare(m(2n), m(1n))).toBe(1);
    expect(compare(m(2n), m(2n))).toBe(0);
    expect(equals(m(2n), m(2n))).toBe(true);
    expect(equals(m(2n), m(3n))).toBe(false);
    const a = m(5n);
    const b = m(5n);
    expect(max(a, b)).toBe(a);
    expect(min(a, b)).toBe(a);
    expect(max(m(4n), m(5n)).amountMinor).toBe(5n);
    expect(min(m(4n), m(5n)).amountMinor).toBe(4n);
    expect([isZero(m(0n)), isZero(m(1n)), isZero(m(-1n))]).toEqual([true, false, false]);
    expect([isPositive(m(0n)), isPositive(m(1n))]).toEqual([false, true]);
    expect([isNegative(m(0n)), isNegative(m(-1n))]).toEqual([false, true]);
  });

  it('bornes int64 exactes : −2^63 et 2^63 − 1 admis, au-delà refusé', () => {
    expect(MIN_AMOUNT_MINOR).toBe(-9_223_372_036_854_775_808n);
    expect(MAX_AMOUNT_MINOR).toBe(9_223_372_036_854_775_807n);
    expect(m(MIN_AMOUNT_MINOR).amountMinor).toBe(MIN_AMOUNT_MINOR);
    expect(errorCodeOf(() => m(MIN_AMOUNT_MINOR - 1n))).toBe('MONEY_OUT_OF_RANGE');
    expect(errorCodeOf(() => m(MAX_AMOUNT_MINOR + 1n))).toBe('MONEY_OUT_OF_RANGE');
  });

  it('textes et nombres : formes refusées', () => {
    expect(errorCodeOf(() => moneyFromSafeInteger(1.5, currency))).toBe('MONEY_INVALID_AMOUNT');
    expect(errorCodeOf(() => moneyFromSafeInteger(2 ** 53, currency))).toBe('MONEY_INVALID_AMOUNT');
    expect(errorCodeOf(() => moneyFromSafeInteger('1' as unknown as number, currency))).toBe(
      'MONEY_INVALID_AMOUNT',
    );
    expect(moneyFromSafeInteger(-7, currency).amountMinor).toBe(-7n);
    expect(errorCodeOf(() => parseMinor(12 as unknown as string, currency))).toBe(
      'MONEY_INVALID_AMOUNT',
    );
    expect(errorCodeOf(() => parseMajor(12 as unknown as string, currency))).toBe(
      'MONEY_INVALID_AMOUNT',
    );
    expect(errorCodeOf(() => multiplyByInteger(m(1n), 2 as unknown as bigint))).toBe(
      'MONEY_INVALID_AMOUNT',
    );
    expect(errorCodeOf(() => requirePositive(m(0n)))).toBe('MONEY_NOT_POSITIVE');
    expect(errorCodeOf(() => allocHost(m(1n), ratio(3n, 2n)))).toBe('SHARE_OUT_OF_RANGE');
    expect(errorCodeOf(() => allocHost(m(1n), ratio(-1n, 2n)))).toBe('SHARE_OUT_OF_RANGE');
  });

  it('isMoney : faux, null et primitives refusés', () => {
    expect(isMoney(m(1n))).toBe(true);
    for (const v of [FAKE_MONEY, null, undefined, 1n, 'USD', {}]) expect(isMoney(v)).toBe(false);
  });
});

describe('fractions et arrondi : formes et signes', () => {
  it('ratio normalise le signe et réduit ; refuse un dénominateur nul ou non bigint', () => {
    expect(ratio(1n, -2n)).toEqual({ num: -1n, den: 2n });
    expect(ratio(-6n, -4n)).toEqual({ num: 3n, den: 2n });
    expect(ratio(0n, -5n)).toEqual({ num: 0n, den: 1n });
    expect(ratio(-4n, 6n)).toEqual({ num: -2n, den: 3n });
    expect(errorCodeOf(() => ratio(1n, 0n))).toBe('RATIO_INVALID');
    expect(errorCodeOf(() => ratio(1 as unknown as bigint, 2n))).toBe('RATIO_INVALID');
    expect(errorCodeOf(() => ratio(1n, 2 as unknown as bigint))).toBe('RATIO_INVALID');
  });

  it('parseRatio : décimal et fraction ancrés, formes illisibles refusées', () => {
    expect(parseRatio('3/4')).toEqual({ num: 3n, den: 4n });
    expect(parseRatio('-3/4')).toEqual({ num: -3n, den: 4n });
    expect(parseRatio('10/20')).toEqual({ num: 1n, den: 2n });
    expect(parseRatio('0/7')).toEqual({ num: 0n, den: 1n });
    expect(parseRatio('0.07')).toEqual({ num: 7n, den: 100n });
    for (const bad of [
      'x3/4',
      '3/4x',
      '3/0',
      '03/4',
      '3/04',
      '1/2/3',
      '',
      '3 /4',
      '13a/4',
      '1/2b',
    ]) {
      expect([bad, errorCodeOf(() => parseRatio(bad))]).toEqual([bad, 'RATIO_INVALID']);
    }
    expect(errorCodeOf(() => parseRatio(0.5 as unknown as string))).toBe('RATIO_INVALID');
  });

  it('compareRatios et multiplyRatios', () => {
    expect(compareRatios(ratio(1n, 3n), ratio(1n, 2n))).toBe(-1);
    expect(compareRatios(ratio(1n, 2n), ratio(1n, 3n))).toBe(1);
    expect(compareRatios(ratio(2n, 4n), ratio(1n, 2n))).toBe(0);
    expect(compareRatios(ratio(-1n, 2n), ratio(1n, 3n))).toBe(-1);
    expect(multiplyRatios(ratio(2n, 3n), ratio(3n, 4n))).toEqual({ num: 1n, den: 2n });
  });

  it('floorDiv arrondit vers −∞ quel que soit le signe du dénominateur', () => {
    expect(floorDiv(7n, 2n)).toBe(3n);
    expect(floorDiv(-7n, 2n)).toBe(-4n);
    expect(floorDiv(7n, -2n)).toBe(-4n);
    expect(floorDiv(-7n, -2n)).toBe(3n);
    expect(floorDiv(6n, -2n)).toBe(-3n);
    expect(floorDiv(0n, -2n)).toBe(0n);
  });
});

describe('registre des devises et erreurs', () => {
  it('codes ISO à 3 lettres majuscules, exposant dans [0 ; MAX], sans doublon', () => {
    const ok = createCurrencyRegistry([
      { code: 'AAA', exponent: 0 },
      { code: 'BBB', exponent: MAX_CURRENCY_EXPONENT },
    ]);
    expect(ok.get('AAA').exponent).toBe(0);
    expect(ok.get('BBB').exponent).toBe(MAX_CURRENCY_EXPONENT);
    const bad: [string, unknown][] = [
      ['2 lettres', [{ code: 'US', exponent: 2 }]],
      ['4 lettres', [{ code: 'USDX', exponent: 2 }]],
      ['préfixe', [{ code: 'xUSD', exponent: 2 }]],
      ['minuscules', [{ code: 'usd', exponent: 2 }]],
      ['chiffres', [{ code: '123', exponent: 2 }]],
      ['non chaîne', [{ code: 123, exponent: 2 }]],
      ['exposant −1', [{ code: 'USD', exponent: -1 }]],
      ['exposant MAX + 1', [{ code: 'USD', exponent: MAX_CURRENCY_EXPONENT + 1 }]],
      ['exposant décimal', [{ code: 'USD', exponent: 1.5 }]],
      [
        'doublon',
        [
          { code: 'USD', exponent: 2 },
          { code: 'USD', exponent: 2 },
        ],
      ],
    ];
    for (const [label, defs] of bad) {
      expect([label, errorCodeOf(() => createCurrencyRegistry(defs as never))]).toEqual([
        label,
        'CURRENCY_CONFIG_INVALID',
      ]);
    }
    expect(errorCodeOf(() => ok.get('CCC'))).toBe('CURRENCY_UNSUPPORTED');
    expect(Object.isFrozen(ok)).toBe(true);
  });

  it('MoneyError : nom, code, message préfixé par le code ; isMoneyError filtre le code', () => {
    let caught: unknown;
    try {
      money(1n, FAKE_CURRENCY);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MoneyError);
    const e = caught as MoneyError;
    expect(e.name).toBe('MoneyError');
    expect(e.code).toBe('CURRENCY_UNSUPPORTED');
    expect(e.message.startsWith('CURRENCY_UNSUPPORTED: ')).toBe(true);
    expect(e.message.length).toBeGreaterThan('CURRENCY_UNSUPPORTED: '.length);
    expect(isMoneyError(e)).toBe(true);
    expect(isMoneyError(e, 'CURRENCY_UNSUPPORTED')).toBe(true);
    expect(isMoneyError(e, 'MONEY_OUT_OF_RANGE')).toBe(false);
    expect(isMoneyError(new Error('x'))).toBe(false);
    expect(isMoneyError(new Error('x'), 'CURRENCY_UNSUPPORTED')).toBe(false);
  });
});
