/**
 * Lecture des lignes d'un trip et part hôte retenue (08 `settle`, E7 jambe `HOST`), partagées par
 * le règlement et par les jambes.
 */
import { add, allocHost, max, sum, zero, type Money } from '../money.ts';
import type { SettlementLine, SettlementTrip } from './types.ts';

/** Montant d'une ligne (absente = 0), contrôlé : vrai `Money`, devise du trip. */
export function line(trip: SettlementTrip, name: SettlementLine): Money {
  const value = trip.lines[name];
  // `add` refuse un faux `Money` et une ligne d'une autre devise (MONEY_CURRENCY_MISMATCH).
  return add(zero(trip.currency), value ?? zero(trip.currency));
}

/**
 * `hostFromGuest` sur des lignes retenues : `allocHost(P) + promoHost + allocHost(D) +
 * allocHost(Extras)`, plancher 0 (T63). Jamais le trip fee (A02) ; promo hôte 100 % hôte
 * (BR-PRICE-16) ; livraison et Extras à leur part figée (BR-CXL-16).
 */
export function hostFromGuestOf(
  trip: SettlementTrip,
  retained: Readonly<Record<SettlementLine, Money>>,
): Money {
  const raw = sum(trip.currency, [
    allocHost(retained.tripPrice, trip.hostSharePctFrozen),
    retained.promoHost,
    allocHost(retained.delivery, trip.deliverySharePct),
    allocHost(retained.extras, trip.extrasSharePct),
  ]);
  return max(zero(trip.currency), raw);
}
