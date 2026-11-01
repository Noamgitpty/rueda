/**
 * Fractions exactes (17 §1.2 : « ratios = fractions exactes, numérateur / dénominateur entiers » ;
 * 08 pseudo-code BR-CXL : « les ratios (j / days, pourcentages) sont des fractions exactes »).
 * Aucun `number` flottant : composants `bigint`, dénominateur strictement positif, forme réduite.
 */
import { MoneyError } from './errors.ts';

declare const ratioBrand: unique symbol;

/** Fraction réduite `num / den`, `den > 0`. Construite uniquement par `ratio` ou `parseRatio`. */
export interface Ratio {
  readonly num: bigint;
  readonly den: bigint;
  readonly [ratioBrand]: true;
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = abs(a);
  let y = abs(b);
  while (y !== 0n) {
    [x, y] = [y, x % y];
  }
  return x;
}

/**
 * Fraction `num / den`. Refuse (`RATIO_INVALID`) un composant qui n'est pas un `bigint` (un `number`
 * est refusé, même entier) et un dénominateur nul. Le signe est porté par le numérateur.
 */
export function ratio(num: bigint, den: bigint): Ratio {
  if (typeof num !== 'bigint' || typeof den !== 'bigint') {
    throw new MoneyError('RATIO_INVALID', 'numérateur et dénominateur doivent être des bigint');
  }
  if (den === 0n) {
    throw new MoneyError('RATIO_INVALID', 'dénominateur nul');
  }
  const sign = den < 0n ? -1n : 1n;
  const divisor = gcd(num, den);
  return Object.freeze({ num: (sign * num) / divisor, den: (sign * den) / divisor }) as Ratio;
}

/** Vrai si `value` a la forme d'une `Ratio` valide (bigint, dénominateur > 0). */
export function isRatio(value: unknown): value is Ratio {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { num?: unknown; den?: unknown };
  return (
    typeof candidate.num === 'bigint' && typeof candidate.den === 'bigint' && candidate.den > 0n
  );
}

/** Refuse (`RATIO_INVALID`) toute valeur qui n'est pas une fraction valide. */
export function assertRatio(value: unknown): asserts value is Ratio {
  if (!isRatio(value)) {
    throw new MoneyError('RATIO_INVALID', 'fraction attendue');
  }
}

const DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/;
const FRACTION = /^(-?)(0|[1-9][0-9]*)\/([1-9][0-9]*)$/;

/**
 * Lit une fraction depuis une chaîne, sans passer par un `number` : décimal (`"0.07"`, `"-0.5"`,
 * `"12"`) ou fraction (`"3/4"`). Forme du pilote PostgreSQL pour une colonne `numeric`.
 * Refuse (`RATIO_INVALID`) toute autre forme (exposant, espace, `+`, zéros de tête).
 */
export function parseRatio(text: string): Ratio {
  if (typeof text !== 'string') {
    throw new MoneyError('RATIO_INVALID', 'chaîne attendue');
  }
  const fraction = FRACTION.exec(text);
  if (fraction !== null) {
    const [, sign, num, den] = fraction as unknown as [string, string, string, string];
    return ratio(BigInt(sign + num), BigInt(den));
  }
  const decimal = DECIMAL.exec(text);
  if (decimal === null) {
    throw new MoneyError('RATIO_INVALID', `fraction illisible : ${text}`);
  }
  const [, sign, integer, digits = ''] = decimal as unknown as [string, string, string, string?];
  return ratio(BigInt(sign + integer + digits), 10n ** BigInt(digits.length));
}

/** Produit exact de deux fractions (par ex. `j × 1/days`). */
export function multiplyRatios(a: Ratio, b: Ratio): Ratio {
  assertRatio(a);
  assertRatio(b);
  return ratio(a.num * b.num, a.den * b.den);
}

/** Comparaison exacte : -1, 0 ou 1. */
export function compareRatios(a: Ratio, b: Ratio): -1 | 0 | 1 {
  assertRatio(a);
  assertRatio(b);
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Représentation `"num/den"` (journaux, empreintes de paramètres). */
export function ratioToString(value: Ratio): string {
  assertRatio(value);
  return `${value.num}/${value.den}`;
}
