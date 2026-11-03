/**
 * Comparaison exacte d'un résultat observé (moteur US-017, US-018…) aux attendus des oracles.
 * Égalité stricte de `bigint` ; un champ absent ou qui n'est pas un `bigint` est un écart (fail-closed).
 * Rien n'est recalculé : l'attendu est la valeur exportée par l'oracle.
 */
import {
  LEG_NAMES,
  type GoldenLegVector,
  type GoldenSettlementVector,
  type LegName,
  type SettlementAmountField,
} from './types.ts';

export interface Mismatch {
  readonly vectorId: string;
  readonly field: string;
  readonly expected: bigint;
  readonly observed: unknown;
}

/** Colonnes de 08 (T01–T48) : remboursement TTC, taxes remboursées, gains hôte, net plateforme, pénalité. */
export const SETTLEMENT_COLUMNS_08 = [
  'guestRefundMinor',
  'taxRefundedMinor',
  'hostEarningsMinor',
  'platformNetMinor',
  'hostPenaltyMinor',
] as const satisfies readonly SettlementAmountField[];

export function compareAmounts(
  vectorId: string,
  expected: Readonly<Record<string, unknown>>,
  observed: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): readonly Mismatch[] {
  const out: Mismatch[] = [];
  for (const field of fields) {
    const exp = expected[field];
    if (typeof exp !== 'bigint') throw new TypeError(`${vectorId} : attendu « ${field} » inconnu`);
    const obs = observed[field];
    if (typeof obs !== 'bigint' || obs !== exp)
      out.push({ vectorId, field, expected: exp, observed: obs });
  }
  return out;
}

export type SettlementObservation = Readonly<Partial<Record<SettlementAmountField, bigint>>>;

export function compareSettlement(
  vector: GoldenSettlementVector,
  observed: SettlementObservation,
  fields: readonly SettlementAmountField[] = SETTLEMENT_COLUMNS_08,
): readonly Mismatch[] {
  return compareAmounts(vector.id, vector.expected, observed, fields);
}

export interface LegObservation {
  readonly legsMinor: Readonly<Partial<Record<LegName, bigint>>>;
  readonly totalMinor?: bigint;
}

export function compareLegs(
  vector: GoldenLegVector,
  observed: LegObservation,
): readonly Mismatch[] {
  return [
    ...compareAmounts(vector.id, vector.legsMinor, observed.legsMinor, LEG_NAMES),
    ...compareAmounts(
      vector.id,
      { totalMinor: vector.totalMinor },
      { totalMinor: observed.totalMinor },
      ['totalMinor'],
    ),
  ];
}

export interface ReplayReport {
  readonly replayed: number;
  readonly mismatches: readonly Mismatch[];
}

/**
 * Rejoue `engine` sur chaque vecteur et agrège les écarts. Une exception du moteur est un écart
 * (champ « exception »), jamais un vecteur ignoré.
 */
export function replay<V extends { readonly id: string }, O>(
  vectors: readonly V[],
  engine: (vector: V) => O,
  compare: (vector: V, observed: O) => readonly Mismatch[],
): ReplayReport {
  const mismatches: Mismatch[] = [];
  for (const v of vectors) {
    let observed: O;
    try {
      observed = engine(v);
    } catch (cause) {
      mismatches.push({ vectorId: v.id, field: 'exception', expected: 0n, observed: cause });
      continue;
    }
    mismatches.push(...compare(v, observed));
  }
  return { replayed: vectors.length, mismatches };
}
