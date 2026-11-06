/**
 * Garde des montants d'un trip payable (ADR-090), commune au moteur de règlement et au futur
 * moteur de devis : elle refuse, en fail-closed, un devis que 08 n'autorise pas.
 *
 * - 08 pseudo-code BR-CXL (`LINES`) : « promoPlatform ≤ 0 et promoHost ≤ 0 » ; les autres lignes
 *   sont des prix ≥ 0 (déduction PROPOSÉE : 08 ne l'écrit pas ; E7 règle 2, jambes ≥ 0)
 *   ⇒ `LINE_SIGN_INVALID`.
 * - taxe payée d'un groupe < 0 (groupe de promos seules) : refus PROPOSÉ, Q-014 ⇒ `TAX_PAID_NEGATIVE`,
 *   avant tout calcul de remboursement.
 * - 08 BR-PAY-07 : un code promo s'applique « sur le prix du véhicule seulement » ; 08 E7 règle 5 :
 *   un code trop fort « est refusé au checkout » ⇒ Σ promos ≥ −P, sinon `PROMO_EXCEEDS_TRIP_PRICE`.
 *   Une promo égale à P (« promo à 100 % », 08 VERIF_09-m02) reste admise.
 * - 08 E1 : `0 ≤ refund_committed ≤ collected_total` ; un total payé négatif rend l'invariant
 *   insatisfaisable. Un total nul n'est pas tranché par 08 : refusé par défaut (PROPOSÉ, Q-013)
 *   ⇒ `TOTAL_PAID_NOT_POSITIVE`.
 */
import { add, compare, isNegative, isPositive, sum, zero, type Money } from '../money.ts';
import type { Currency } from '../currency.ts';
import { SettlementError } from './errors.ts';
import { SETTLEMENT_LINES, type SettlementLine } from './types.ts';

/** Ce que la garde lit d'un trip ou d'un devis : devise, lignes HT signées, total payé TTC. */
export interface PayableAmounts {
  readonly currency: Currency;
  readonly lines: Readonly<Partial<Record<SettlementLine, Money>>>;
  readonly totalPaid: Money;
  /** Taxe payée par groupe (facture figée). Absente pour un devis qui ne l'a pas encore calculée. */
  readonly taxGroups?: readonly { readonly id: string; readonly taxPaid: Money }[];
}

const PROMO_LINES: readonly SettlementLine[] = ['promoPlatform', 'promoHost'];

/**
 * Refuse un trip ou un devis hors des règles de 08 (voir l'en-tête). Ne calcule aucun montant :
 * elle ne fait que comparer des entrées. La cohérence `total = Σ lignes + Σ taxe payée` reste
 * contrôlée par le moteur (`SETTLEMENT_INPUT_INVALID`).
 */
export function assertPayableAmounts(amounts: PayableAmounts): void {
  const of = (name: SettlementLine): Money =>
    add(zero(amounts.currency), amounts.lines[name] ?? zero(amounts.currency));
  for (const name of SETTLEMENT_LINES) {
    const value = of(name);
    const promo = PROMO_LINES.includes(name);
    if (promo ? isPositive(value) : isNegative(value)) {
      throw new SettlementError(
        'LINE_SIGN_INVALID',
        `${name} = ${value.amountMinor} : ${promo ? 'promo ≤ 0 (08 LINES)' : 'prix ≥ 0 (déduction PROPOSÉE, ADR-090)'} attendu`,
      );
    }
  }
  for (const g of amounts.taxGroups ?? []) {
    const taxPaid = add(zero(amounts.currency), g.taxPaid);
    if (isNegative(taxPaid)) {
      throw new SettlementError(
        'TAX_PAID_NEGATIVE',
        `groupe ${g.id} : taxe payée ${taxPaid.amountMinor} < 0 (ADR-090, Q-014)`,
        {
          currency: amounts.currency.code,
          taxGroupId: g.id,
          taxPaidMinor: `${taxPaid.amountMinor}`,
        },
      );
    }
  }
  const promos = sum(
    amounts.currency,
    PROMO_LINES.map((name) => of(name)),
  );
  const priced = add(of('tripPrice'), promos);
  if (isNegative(priced)) {
    throw new SettlementError(
      'PROMO_EXCEEDS_TRIP_PRICE',
      `promos ${promos.amountMinor} au-delà du prix du véhicule ${of('tripPrice').amountMinor} (08 BR-PAY-07)`,
    );
  }
  const total = add(zero(amounts.currency), amounts.totalPaid);
  if (compare(total, zero(amounts.currency)) <= 0) {
    throw new SettlementError(
      'TOTAL_PAID_NOT_POSITIVE',
      `total payé ${total.amountMinor} : strictement positif attendu (08 E1)`,
    );
  }
}
