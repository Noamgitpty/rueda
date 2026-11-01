import { describe, expect, it } from 'vitest';
import { ratio, roundHalfUp } from '../src/index.ts';
import { errorCodeOf } from './fixtures.ts';

/**
 * Valeurs attendues : arrondis écrits dans 08 (colonne « Détail » des vecteurs cités) ou
 * définition littérale de 08 (« floor(q + 1/2) … aussi pour une ligne négative »).
 */
describe('roundHalfUp = floor(q + 1/2) (08 pseudo-code BR-CXL)', () => {
  it.each([
    // [source, numérateur, dénominateur, attendu]
    ['T42 : taxe remboursée 362 × 1 294 / 5 176 = 90,5', 362n * 1294n, 5176n, 91n],
    ['T09 : taxe remboursée 644 × 5 750 / 9 200 = 402,5', 644n * 5750n, 9200n, 403n],
    ['T43 : taxe remboursée 140 × 1 508 / 2 010 = 105,03', 140n * 1508n, 2010n, 105n],
    [
      'T40 : taxe remboursée 112 550 × 750 335 / 1 125 502 = 75 033,37',
      112550n * 750335n,
      1125502n,
      75033n,
    ],
    ['T55 : 5 000 × 1 438 050 / 20 000 = 359 512,5', 5000n * 1438050n, 20000n, 359513n],
    ['T55 : 1 000 367 × 20 000 / 1 438 050 = 13 912,83', 1000367n * 20000n, 1438050n, 13913n],
    ['TA06 : 4 501 × 1/2 = 2 250,5', 4501n, 2n, 2251n],
    ['TA06 : 315 × 2 250 / 4 501 = 157,46', 315n * 2250n, 4501n, 157n],
    ['TA06 : 2 251 × 12 / 100 = 270,12', 2251n * 12n, 100n, 270n],
    ['T43 : 1 005 × 7 / 100 = 70,35', 1005n * 7n, 100n, 70n],
  ])('%s', (_source, num, den, expected) => {
    expect(roundHalfUp(ratio(num, den))).toBe(expected);
  });

  it('T35 : promo roundHalfUp(−2 000 / 3 = −666,67) = −667 (ligne négative)', () => {
    expect(roundHalfUp(ratio(-2000n, 3n))).toBe(-667n);
  });

  it.each([
    // demi-unité vers +∞, y compris pour une valeur négative (08 : « aussi pour une ligne négative »)
    [5n, 2n, 3n],
    [-5n, 2n, -2n],
    [-1n, 2n, 0n],
    [1n, 2n, 1n],
    [-3n, 2n, -1n],
    // hors égalité : entier le plus proche
    [-26n, 10n, -3n],
    [-24n, 10n, -2n],
    [7n, 1n, 7n],
    [-7n, 1n, -7n],
    [0n, 1n, 0n],
  ])('définition littérale : roundHalfUp(%i/%i) = %i', (num, den, expected) => {
    expect(roundHalfUp(ratio(num, den))).toBe(expected);
  });

  it('refuse autre chose qu’une fraction : RATIO_INVALID', () => {
    expect(errorCodeOf(() => roundHalfUp({ num: 1n, den: 0n } as never))).toBe('RATIO_INVALID');
    expect(errorCodeOf(() => roundHalfUp(0.5 as never))).toBe('RATIO_INVALID');
  });
});
