import { describe, expect, it } from 'vitest';
import { compareRatios, multiplyRatios, parseRatio, ratio, ratioToString } from '../src/index.ts';
import { errorCodeOf } from './fixtures.ts';

describe('fractions exactes (17 §1.2, 08 pseudo-code BR-CXL)', () => {
  it('réduit la fraction et porte le signe au numérateur', () => {
    expect(ratio(6n, 8n)).toMatchObject({ num: 3n, den: 4n });
    expect(ratio(3n, -4n)).toMatchObject({ num: -3n, den: 4n });
    expect(ratio(-3n, -4n)).toMatchObject({ num: 3n, den: 4n });
    expect(ratio(0n, -7n)).toMatchObject({ num: 0n, den: 1n });
  });

  it('refuse un dénominateur nul : RATIO_INVALID', () => {
    expect(errorCodeOf(() => ratio(1n, 0n))).toBe('RATIO_INVALID');
  });

  it('refuse un number, même entier : RATIO_INVALID', () => {
    expect(errorCodeOf(() => ratio(3 as unknown as bigint, 4n))).toBe('RATIO_INVALID');
    expect(errorCodeOf(() => ratio(3n, 4 as unknown as bigint))).toBe('RATIO_INVALID');
  });

  it.each([
    ['0.07', 7n, 100n],
    ['0.75', 3n, 4n],
    ['0.12', 3n, 25n],
    ['0.10', 1n, 10n],
    ['12', 12n, 1n],
    ['-0.5', -1n, 2n],
    ['3/4', 3n, 4n],
    ['-1/3', -1n, 3n],
    ['0', 0n, 1n],
  ])('lit %s sans passer par un number', (text, num, den) => {
    expect(parseRatio(text)).toMatchObject({ num, den });
  });

  it('lit exactement un taux qu’un flottant ne représente pas (0,1 + 0,2)', () => {
    // 30000000000000004 / 10^17, sous forme réduite (÷ 4)
    expect(parseRatio('0.30000000000000004')).toMatchObject({
      num: 7500000000000001n,
      den: 25000000000000000n,
    });
    expect(compareRatios(parseRatio('0.3'), ratio(3n, 10n))).toBe(0);
  });

  it.each(['', ' 0.07', '+0.07', '0,07', '1e-2', '.5', '5.', '007', 'NaN', '1/0', '1/-2', '0x10'])(
    'refuse la forme %j : RATIO_INVALID',
    (text) => {
      expect(errorCodeOf(() => parseRatio(text))).toBe('RATIO_INVALID');
    },
  );

  it('multiplie et compare exactement', () => {
    expect(multiplyRatios(ratio(3n, 4n), ratio(1n, 3n))).toMatchObject({ num: 1n, den: 4n });
    expect(compareRatios(ratio(1n, 3n), ratio(333n, 1000n))).toBe(1);
    expect(compareRatios(ratio(2n, 4n), ratio(1n, 2n))).toBe(0);
    expect(compareRatios(ratio(-1n, 2n), ratio(0n, 1n))).toBe(-1);
    expect(ratioToString(ratio(10n, 4n))).toBe('5/2');
  });
});
