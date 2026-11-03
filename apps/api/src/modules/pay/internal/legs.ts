/**
 * Jambes explicites d'un ordre de paiement (08 E7 règle 1 ; 17 §2.8 ; contrainte 4 de CLAUDE.md).
 *
 * `LegAmounts = { HOST, INSURER, TAX_THIRD_PARTY, PLATFORM }` en unités mineures `bigint`, dans la
 * devise du trip. Les montants viennent du règlement (fonction pure de `@rueda/money`, 08 E7),
 * jamais d'un prorata calculé ici ni par le PSP. Ce module ne CALCULE aucune jambe : il les
 * VÉRIFIE avant tout appel au PSP (`LEG_SUM_MISMATCH`, `LEG_AMOUNT_NEGATIVE`, sans appel).
 */
import { PaymentError } from './errors.js';

/** Ordre des jambes (cascade de 08 E7 règle 10 : HOST → INSURER → TAX_THIRD_PARTY → PLATFORM). */
export const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
export type Leg = (typeof LEGS)[number];

export type LegAmounts = Readonly<Record<Leg, bigint>>;

/** Bénéficiaires des jambes tierces (sous-marchand hôte, assureur ; US-061). */
export interface LegBeneficiaries {
  readonly hostSubmerchantRef?: string;
  readonly insurerBeneficiaryRef?: string;
}

function checkShape(legs: LegAmounts): void {
  if (legs === null || typeof legs !== 'object') {
    throw new PaymentError('INVALID_REQUEST', 'jambes absentes');
  }
  const keys = Object.keys(legs).sort();
  if (keys.join(',') !== [...LEGS].sort().join(',')) {
    throw new PaymentError('INVALID_REQUEST', `jambes attendues : ${LEGS.join(', ')}`);
  }
  for (const leg of LEGS) {
    if (typeof legs[leg] !== 'bigint') {
      throw new PaymentError('INVALID_REQUEST', `jambe ${leg} : bigint en unités mineures attendu`);
    }
  }
}

export function legSum(legs: LegAmounts): bigint {
  return LEGS.reduce((sum, leg) => sum + legs[leg], 0n);
}

/**
 * Ordre qui déplace des fonds (capture, encaissement, remboursement, débit MIT, rollback, paiement
 * hébergé) : montant > 0, chaque jambe ≥ 0, Σ jambes = montant (17 §2.8).
 */
export function assertMovingLegs(amountMinor: bigint, legs: LegAmounts): void {
  if (typeof amountMinor !== 'bigint' || amountMinor <= 0n) {
    throw new PaymentError(
      'INVALID_REQUEST',
      'montant strictement positif en unités mineures attendu',
    );
  }
  checkShape(legs);
  for (const leg of LEGS) {
    if (legs[leg] < 0n) throw new PaymentError('LEG_AMOUNT_NEGATIVE', `jambe ${leg} négative`);
  }
  const sum = legSum(legs);
  if (sum !== amountMinor) {
    throw new PaymentError('LEG_SUM_MISMATCH', `Σ jambes ${sum} ≠ montant ${amountMinor}`);
  }
}

/**
 * Réaffectation entre jambes d'un même trip (08 E7 règle 3, TJ05b, TJ20b) : Σ = 0 et au moins
 * une jambe débitée. Rend le montant déplacé (Σ des jambes créditées).
 */
export function assertReallocationLegs(legs: LegAmounts): bigint {
  checkShape(legs);
  const sum = legSum(legs);
  if (sum !== 0n) {
    throw new PaymentError('LEG_SUM_MISMATCH', `réaffectation : Σ jambes ${sum} ≠ 0`);
  }
  const moved = LEGS.reduce((s, leg) => (legs[leg] > 0n ? s + legs[leg] : s), 0n);
  if (moved === 0n) throw new PaymentError('INVALID_REQUEST', 'réaffectation vide');
  return moved;
}

export function legsEqual(a: LegAmounts, b: LegAmounts): boolean {
  return LEGS.every((leg) => a[leg] === b[leg]);
}

/** Forme JSON sans perte (montants en texte) : paramètre `p_legs` des commandes SQL. */
export function legsToJson(legs: LegAmounts): Record<Leg, string> {
  return Object.fromEntries(LEGS.map((leg) => [leg, legs[leg].toString()])) as Record<Leg, string>;
}

/** Jambes d'un débit à partir d'une variation signée (08 E7 règle 3) : variation négative ⇒ débit. */
export function debitFromVariation(variation: LegAmounts): LegAmounts {
  checkShape(variation);
  return Object.fromEntries(
    LEGS.map((leg) => {
      if (variation[leg] > 0n) {
        throw new PaymentError(
          'INVALID_REQUEST',
          `variation positive sur ${leg} : réaffectation à passer avant le remboursement (08 E7 règle 3)`,
        );
      }
      return [leg, -variation[leg]];
    }),
  ) as Record<Leg, bigint>;
}

/**
 * Transfert du solde PLATFORM vers des jambes tierces d'un même trip (`transferFromPlatform`,
 * 17 §2.8, §2.9 ; avance de Kmino, 08 E7 règle 3 bis) : Σ = 0, PLATFORM seule débitée, au moins une
 * jambe créditée. Rend le montant transféré.
 */
export function assertTransferLegs(legs: LegAmounts): bigint {
  checkShape(legs);
  const sum = legSum(legs);
  if (sum !== 0n) {
    throw new PaymentError('LEG_SUM_MISMATCH', `transfert : Σ jambes ${sum} ≠ 0`);
  }
  for (const leg of LEGS) {
    if (leg !== 'PLATFORM' && legs[leg] < 0n) {
      throw new PaymentError('LEG_AMOUNT_NEGATIVE', `transfert : jambe ${leg} débitée`);
    }
  }
  const moved = -legs.PLATFORM;
  if (moved <= 0n) throw new PaymentError('INVALID_REQUEST', 'transfert vide');
  return moved;
}

/** Montant strictement positif en unités mineures (libération, versement, ajustement). */
export function assertPositiveAmount(amountMinor: bigint): void {
  if (typeof amountMinor !== 'bigint' || amountMinor <= 0n) {
    throw new PaymentError(
      'INVALID_REQUEST',
      'montant strictement positif en unités mineures attendu',
    );
  }
}

export function isLeg(value: unknown): value is Leg {
  return typeof value === 'string' && (LEGS as readonly string[]).includes(value);
}
