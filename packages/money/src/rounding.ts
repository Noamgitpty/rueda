/**
 * Arrondi unique du dépôt (08 pseudo-code BR-CXL, BR-PRICE-14 ; ADR-009).
 *
 *   roundHalfUp(q) = floor(q + 1/2) : entier le plus proche, demi-unité vers +∞,
 *   aussi pour une valeur négative (−2,5 → −2 ; 08 : « aussi pour une ligne négative »).
 *
 * Aucune autre fonction d'arrondi ne doit exister dans le code monétaire (revue de code, 16 PRC-021).
 */
import { assertRatio, type Ratio } from './ratio.ts';

/** Division entière arrondie vers −∞ (`den > 0`). La division `bigint` native tronque vers 0. */
export function floorDiv(num: bigint, den: bigint): bigint {
  const quotient = num / den;
  return num % den !== 0n && num < 0n !== den < 0n ? quotient - 1n : quotient;
}

/** `floor(q + 1/2)` calculé exactement : `floor((2·num + den) / (2·den))`. */
export function roundHalfUp(q: Ratio): bigint {
  assertRatio(q);
  return floorDiv(2n * q.num + q.den, 2n * q.den);
}
