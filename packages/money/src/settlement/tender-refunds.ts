/**
 * Remboursement réparti entre les moyens d'origine (08 E2, règle d'imputation INCRÉMENTALE ; E7
 * règle 10 ; vecteurs T33, T66, TJ16a à TJ16d, TJ20a ; US-224 partie 224f, ADR-166).
 *
 * Deux ordres distincts (08 E7 règle 10, US-056) :
 * - **combien** chaque moyen rembourse : E2. `refundable[m] = max(0, payé[m] − engagé[m])` (engagé :
 *   instances SM-8 du moyen, toutes versions, hors `CANCELLED` et `SUPERSEDED`) ; la part non
 *   remboursée de ce tour, `K' = Σ refundable − refund_total`, est absorbée dans l'ordre crédit
 *   promo → crédit cash → externes non natifs → externes natifs, la capture la plus récente d'abord
 *   à l'intérieur d'une catégorie ; chaque moyen reçoit `refundable[m] − absorbé[m]`, jamais plus
 *   que son reliquat ;
 * - **quelles jambes** porte chaque remboursement : la cascade de la règle 10 (`settlementOrders`),
 *   moyens natif → non natif → crédit cash → crédit promo.
 *
 * Fonction pure, `bigint` en unités mineures, sans division ni arrondi (jamais de prorata). Les
 * chargebacks perdus (`chargeback_perdu_net`) ne sont pas modélisés : aucun chargeback en bêta
 * (fail-closed : un appelant qui en connaîtrait un doit les déduire de `committed`). Les attendus des
 * tests viennent de 08 (T33, T66 b, TJ16c) et de l'export des oracles (`check_legs.py` :
 * `e2_refunds`, `e2_incremental`, `cascade`), jamais de ce fichier.
 */
import { add, isNegative, min, subtract, type Money } from '../money.ts';
import { SettlementError } from './errors.ts';
import { settlementOrders } from './refunds.ts';
import { TENDER_KINDS, type TenderKind } from './tenders.ts';
import type { Legs } from './types.ts';

/** Ordre d'absorption de E2 (la part NON remboursée est prise d'abord sur le crédit promo). */
const ABSORPTION: readonly TenderKind[] = ['PROMO_CREDIT', 'CASH_CREDIT', 'NON_NATIVE', 'NATIVE'];

/** Un moyen payé du trip (une capture ou un encaissement réussi du loyer). */
export interface PaidTender {
  /** Identité du moyen (en base : l'encaissement remboursé). */
  readonly id: string;
  readonly kind: TenderKind;
  /** Payé par ce moyen, devise du trip. */
  readonly paid: Money;
  /** Déjà engagé sur ce moyen (instances SM-8 hors `CANCELLED` et `SUPERSEDED`), ≥ 0. */
  readonly committed: Money;
  /** Rang de la capture : plus grand = plus récente (E2 : la plus récente absorbe d'abord). */
  readonly capturedRank: number;
}

/** Remboursement d'un moyen (E2), dans l'ordre de la cascade de la règle 10. */
export interface TenderRefund {
  readonly id: string;
  readonly kind: TenderKind;
  readonly amount: Money;
}

/** Remboursement d'un moyen avec ses jambes (montants positifs = débits de chaque jambe). */
export interface TenderRefundLegs {
  readonly id: string;
  readonly kind: TenderKind;
  readonly legs: Legs;
}

export interface TenderRefundOrders {
  /** Réaffectation signée (Σ = 0) passée avant les remboursements, ou `null` (08 E7 règle 3). */
  readonly reallocation: Legs | null;
  /** Un remboursement par moyen qui rembourse quelque chose, ordre de la cascade. */
  readonly refunds: readonly TenderRefundLegs[];
}

const kindRank = (kind: TenderKind): number => TENDER_KINDS.indexOf(kind);

/** Ordre de la cascade : catégorie (natif d'abord), puis la capture la plus ancienne d'abord. */
const byCascade = (a: PaidTender, b: PaidTender): number =>
  kindRank(a.kind) - kindRank(b.kind) || a.capturedRank - b.capturedRank;

function checkTenders(refundTotal: Money, tenders: readonly PaidTender[]): void {
  const currency = refundTotal.currency;
  if (isNegative(refundTotal)) {
    throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'remboursement négatif');
  }
  const ids = new Set<string>();
  const ranks = new Set<number>();
  for (const t of tenders) {
    if (!TENDER_KINDS.includes(t.kind)) {
      throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'catégorie de moyen inconnue');
    }
    if (t.paid.currency !== currency || t.committed.currency !== currency) {
      throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'devise de moyen différente');
    }
    if (t.paid.amountMinor <= 0n || isNegative(t.committed)) {
      throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'payé ≤ 0 ou engagé négatif');
    }
    if (!Number.isSafeInteger(t.capturedRank) || ranks.has(t.capturedRank) || ids.has(t.id)) {
      // rang ou identité en double : l'ordre d'absorption ne serait plus déterministe
      throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'moyen ou rang de capture en double');
    }
    ids.add(t.id);
    ranks.add(t.capturedRank);
  }
}

/**
 * 08 E2 (imputation incrémentale) : remboursement de chaque moyen, dans l'ordre de la cascade de la
 * règle 10 ; un moyen absorbé en entier reçoit 0. Refus : `REFUND_OUT_OF_RANGE` si le remboursement
 * dépasse Σ reliquats (jamais un moyen remboursé au-delà de ce qu'il a payé), `SETTLEMENT_INPUT_INVALID`
 * pour une entrée incohérente.
 */
export function refundsByTender(
  refundTotal: Money,
  tenders: readonly PaidTender[],
): readonly TenderRefund[] {
  checkTenders(refundTotal, tenders);
  const nil = subtract(refundTotal, refundTotal);
  const refundable = new Map<string, Money>();
  let pool = nil;
  for (const t of tenders) {
    const rest = subtract(t.paid, t.committed);
    const r = isNegative(rest) ? nil : rest;
    refundable.set(t.id, r);
    pool = add(pool, r);
  }
  if (refundTotal.amountMinor > pool.amountMinor) {
    throw new SettlementError(
      'REFUND_OUT_OF_RANGE',
      'remboursement au-delà de Σ reliquats remboursables (08 E2)',
      {
        refundMinor: refundTotal.amountMinor.toString(),
        refundableMinor: pool.amountMinor.toString(),
      },
    );
  }
  // K' absorbé : crédit promo → crédit cash → non natif → natif, la capture la plus récente d'abord
  let keep = subtract(pool, refundTotal);
  const absorbed = new Map<string, Money>();
  const absorption = [...tenders].sort(
    (a, b) =>
      ABSORPTION.indexOf(a.kind) - ABSORPTION.indexOf(b.kind) || b.capturedRank - a.capturedRank,
  );
  for (const t of absorption) {
    const a = min(keep, refundable.get(t.id) ?? nil);
    absorbed.set(t.id, a);
    keep = subtract(keep, a);
  }
  return Object.freeze(
    [...tenders].sort(byCascade).map((t) =>
      Object.freeze({
        id: t.id,
        kind: t.kind,
        amount: subtract(refundable.get(t.id) ?? nil, absorbed.get(t.id) ?? nil),
      }),
    ),
  );
}

/**
 * Ordres d'un règlement sur plusieurs moyens : E2 décide le montant de chaque moyen, puis la
 * cascade de la règle 10 (`settlementOrders`) ses jambes ; réaffectation d'abord (règle 3).
 * Σ remboursements = − variation totale, jambe par jambe ; un moyen à 0 n'a pas d'ordre.
 */
export function tenderRefundOrders(
  variation: Legs,
  tenders: readonly PaidTender[],
): TenderRefundOrders {
  const nil = subtract(variation.total, variation.total);
  if (variation.total.amountMinor > 0n) {
    throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'variation totale positive');
  }
  const refundTotal = subtract(nil, variation.total);
  const refunds = refundsByTender(refundTotal, tenders).filter((r) => r.amount.amountMinor > 0n);
  const orders = settlementOrders(
    variation,
    refunds.map((r) => ({ kind: r.kind, amount: r.amount })),
  );
  // `cascadeTenders` trie par catégorie de façon stable : l'entrée est déjà dans l'ordre de la
  // cascade, la i-ème sortie est donc le i-ème moyen (contrôlé, jamais supposé)
  if (orders.refunds.length !== refunds.length) {
    throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'ordres et moyens en nombre différent');
  }
  return Object.freeze({
    reallocation: orders.reallocation,
    refunds: Object.freeze(
      orders.refunds.map((o, i) => {
        const r = refunds[i];
        if (
          r === undefined ||
          r.kind !== o.kind ||
          r.amount.amountMinor !== o.legs.total.amountMinor
        ) {
          throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'ordre sans son moyen');
        }
        return Object.freeze({ id: r.id, kind: r.kind, legs: o.legs });
      }),
    ),
  });
}
