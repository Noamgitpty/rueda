/**
 * Ordres d'un règlement : réaffectation puis remboursements par moyen, montant explicite de chaque
 * jambe (08 E7 règles 1, 3 et 10 ; 16 PAY-021 ; US-224).
 *
 * Entrée : la variation SIGNÉE de chaque jambe entre l'état capturé (ou la version n) et la version
 * en tête du règlement (`settlement_leg.variation_minor`, 08 E7 règle 3 : `−` = débit de la jambe,
 * `+` = réaffectation vers la jambe), et le remboursement de chaque moyen de paiement (décidé par
 * E2 : `refunds`). Sortie :
 * - `reallocation` : l'ordre `LEG_REALLOCATION` (Σ = 0), passé AVANT les remboursements ; chaque
 *   variation positive est prise sur les jambes en baisse dans l'ordre `HOST` → `INSURER` →
 *   `TAX_THIRD_PARTY` → `PLATFORM` (règle 3, TJ05b : 18,53 pris sur `HOST`) ; `null` sans variation
 *   positive ;
 * - `refunds` : un ordre `REFUND` par moyen, jambes en cascade (règle 10, TJ16 : moyens natif →
 *   non natif → crédit cash → crédit promo, jambes `HOST` → … → `PLATFORM`), montants POSITIFS
 *   (débit de chaque jambe). Σ ordres = − Σ variations négatives restantes, jambe par jambe.
 *
 * Jamais de prorata : aucune division, aucun arrondi. Refus (`SettlementError`) :
 * - `SETTLEMENT_INPUT_INVALID` : devises différentes, remboursement nul ou négatif d'un moyen,
 *   Σ remboursements ≠ − Σ variations, variation positive plus grande que les jambes en baisse,
 *   crédit qui toucherait une autre jambe que `PLATFORM` (TJ20b : réaffectation de 224b) ;
 * - `REFUND_EXCEEDS_COLLECTED` n'est pas produit ici : le plafond « jamais plus que l'encaissé »
 *   est tenu en base à l'enregistrement de l'ordre (migration 0121, ADR-145).
 *
 * Fonction pure, `bigint` en unités mineures. Les attendus de ses tests viennent de l'export des
 * oracles (`check_legs.py` : `cascade`, vecteurs TJ02b, TJ08b, TJ10b, TJ16a à d) et de 08 E7
 * règle 3 (TJ05b), jamais de ce fichier.
 */
import { add, isNegative, min, negate, subtract, type Money } from '../money.ts';
import { SettlementError } from './errors.ts';
import { cascadeTenders, type Tender, type TenderLegs } from './tenders.ts';
import { LEGS, type Leg, type Legs } from './types.ts';

export interface SettlementOrders {
  /** Réaffectation signée (Σ = 0), ou `null`. */
  readonly reallocation: Legs | null;
  /** Un remboursement par moyen, dans l'ordre de la cascade ; jambes positives (débits). */
  readonly refunds: readonly TenderLegs[];
}

const legsOf = (row: Record<Leg, Money>, nil: Money): Legs =>
  Object.freeze({ ...row, total: LEGS.reduce((s, leg) => add(s, row[leg]), nil) });

/**
 * Ordres d'un règlement à partir de la variation signée de ses jambes et du remboursement de
 * chaque moyen (08 E7 règles 3 et 10).
 */
export function settlementOrders(variation: Legs, refunds: readonly Tender[]): SettlementOrders {
  const currency = variation.total.currency;
  const nil = subtract(variation.total, variation.total);
  for (const leg of LEGS) {
    if (variation[leg].currency !== currency) {
      throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'devise de jambe différente');
    }
  }
  const sum = LEGS.reduce((s, leg) => add(s, variation[leg]), nil);
  if (sum.amountMinor !== variation.total.amountMinor) {
    throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'Σ variations ≠ total');
  }

  // règle 3 : chaque variation positive est prise sur les jambes en baisse, HOST d'abord
  const debit: Record<Leg, Money> = {
    HOST: nil,
    INSURER: nil,
    TAX_THIRD_PARTY: nil,
    PLATFORM: nil,
  };
  for (const leg of LEGS) {
    if (isNegative(variation[leg])) debit[leg] = negate(variation[leg]);
  }
  const moved: Record<Leg, Money> = {
    HOST: nil,
    INSURER: nil,
    TAX_THIRD_PARTY: nil,
    PLATFORM: nil,
  };
  let credit = LEGS.reduce(
    (s, leg) => (variation[leg].amountMinor > 0n ? add(s, variation[leg]) : s),
    nil,
  );
  const hasReallocation = credit.amountMinor > 0n;
  for (const leg of LEGS) {
    if (credit.amountMinor === 0n) break;
    const take = min(debit[leg], credit);
    if (take.amountMinor > 0n) {
      moved[leg] = negate(take);
      debit[leg] = subtract(debit[leg], take);
      credit = subtract(credit, take);
    }
  }
  if (credit.amountMinor > 0n) {
    throw new SettlementError(
      'SETTLEMENT_INPUT_INVALID',
      'réaffectation plus grande que les jambes en baisse (08 E7 règle 3)',
    );
  }
  for (const leg of LEGS) {
    if (variation[leg].amountMinor > 0n) moved[leg] = variation[leg];
  }
  const reallocation = hasReallocation ? legsOf(moved, nil) : null;

  // règle 10 : les débits restants sont répartis en cascade entre les remboursements des moyens
  const remaining = legsOf(debit, nil);
  if (remaining.total.amountMinor === 0n) {
    if (refunds.length > 0) {
      throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'remboursement sans débit à porter');
    }
    return Object.freeze({ reallocation, refunds: Object.freeze([]) });
  }
  return Object.freeze({ reallocation, refunds: cascadeTenders(remaining, refunds) });
}
