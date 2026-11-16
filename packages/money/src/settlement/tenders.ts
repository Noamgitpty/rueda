/**
 * Ventilation des jambes entre plusieurs encaissements (08 E7 règle 10 ; TJ15, TJ21 ; US-223).
 *
 * Un paiement peut être fait de plusieurs encaissements (carte, Yappy, crédit cash, crédit promo).
 * Chaque encaissement porte le montant EXPLICITE de chaque jambe (règle 1 : jamais de prorata) :
 * - les encaissements sont pris dans l'ordre natif → non natif → crédit cash → crédit promo ;
 * - chaque encaissement remplit les jambes dans l'ordre `HOST` → `INSURER` → `TAX_THIRD_PARTY` →
 *   `PLATFORM`, dans la limite de ce qu'il reste de chaque jambe ;
 * - Σ encaissements = total des jambes, sinon refus (aucune jambe laissée ni créée) ;
 * - un crédit (cash ou promo) ne touche que `PLATFORM` (TJ21) : le crédit imputable est plafonné à
 *   la jambe `PLATFORM` de la capture (`creditCap`), le reste est payé par un moyen réel.
 *
 * Fonction pure, `bigint` en unités mineures, sans arrondi (aucune division). Les attendus de ses
 * tests viennent de l'oracle `docs/specs/tools/check_legs.py` (`cascade`), jamais de ce fichier.
 */
import { add, isNegative, min, subtract, type Money } from '../money.ts';
import { SettlementError } from './errors.ts';
import { LEGS, type Leg, type Legs } from './types.ts';

/** Moyens d'encaissement, dans l'ordre de la cascade (08 E7 règle 10). */
export const TENDER_KINDS = ['NATIVE', 'NON_NATIVE', 'CASH_CREDIT', 'PROMO_CREDIT'] as const;
export type TenderKind = (typeof TENDER_KINDS)[number];

export interface Tender {
  readonly kind: TenderKind;
  readonly amount: Money;
}

export interface TenderLegs {
  readonly kind: TenderKind;
  readonly legs: Legs;
}

const isCredit = (kind: TenderKind): boolean => kind === 'CASH_CREDIT' || kind === 'PROMO_CREDIT';

/** Crédit imputable au plus : la jambe `PLATFORM` de la capture (TJ21 : 99,91 sur 120,00 demandés). */
export function creditCap(capture: Legs, asked: Money): Money {
  if (isNegative(asked)) {
    throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'crédit demandé négatif');
  }
  if (isNegative(capture.PLATFORM)) return subtract(capture.PLATFORM, capture.PLATFORM);
  return min(asked, capture.PLATFORM);
}

/**
 * Jambes de chaque encaissement, dans l'ordre de la cascade. Refus (`SETTLEMENT_INPUT_INVALID`) :
 * encaissement négatif ou nul, devise différente, Σ encaissements ≠ total, jambe de capture
 * négative ; un crédit qui toucherait une autre jambe que `PLATFORM` est refusé
 * (`LEG_AMOUNT_NEGATIVE` n'est jamais produit : aucune jambe n'est débitée au-delà de son reste).
 */
export function cascadeTenders(capture: Legs, tenders: readonly Tender[]): readonly TenderLegs[] {
  const currency = capture.total.currency;
  const nil = subtract(capture.total, capture.total);
  for (const leg of LEGS) {
    if (isNegative(capture[leg])) {
      throw new SettlementError('LEG_AMOUNT_NEGATIVE', `jambe ${leg} de la capture négative`);
    }
  }
  const ordered = [...tenders].sort(
    (a, b) => TENDER_KINDS.indexOf(a.kind) - TENDER_KINDS.indexOf(b.kind),
  );
  for (const t of ordered) {
    if (t.amount.currency !== currency) {
      throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'devise d’encaissement différente');
    }
    if (t.amount.amountMinor <= 0n) {
      throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'encaissement nul ou négatif');
    }
  }
  const paid = ordered.reduce((s, t) => add(s, t.amount), nil);
  if (paid.amountMinor !== capture.total.amountMinor) {
    throw new SettlementError(
      'SETTLEMENT_INPUT_INVALID',
      `Σ encaissements ${paid.amountMinor} ≠ total ${capture.total.amountMinor}`,
    );
  }
  const rest: Record<Leg, Money> = {
    HOST: capture.HOST,
    INSURER: capture.INSURER,
    TAX_THIRD_PARTY: capture.TAX_THIRD_PARTY,
    PLATFORM: capture.PLATFORM,
  };
  return ordered.map((t) => {
    let need = t.amount;
    const row = {} as Record<Leg, Money>;
    for (const leg of LEGS) {
      const take = min(rest[leg], need);
      row[leg] = take;
      rest[leg] = subtract(rest[leg], take);
      need = subtract(need, take);
    }
    if (isCredit(t.kind) && LEGS.some((leg) => leg !== 'PLATFORM' && row[leg].amountMinor > 0n)) {
      throw new SettlementError(
        'SETTLEMENT_INPUT_INVALID',
        'un crédit ne touche que PLATFORM (08 E7 règle 10, TJ21) : crédit au-delà du plafond',
      );
    }
    const total = LEGS.reduce((s, leg) => add(s, row[leg]), nil);
    return Object.freeze({ kind: t.kind, legs: Object.freeze({ ...row, total }) });
  });
}
