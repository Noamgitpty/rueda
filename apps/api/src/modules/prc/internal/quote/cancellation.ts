/**
 * Conditions d'annulation d'un devis (US-205b ; 16 LST-010 ; 08 BR-CXL-01, BR-CXL-06 ; 10b UX-54
 * « se retiene 1 día de alquiler: {amount} »).
 *
 * Aucune règle d'annulation n'est réécrite ici : la fin de l'annulation gratuite (`freeUntil`) et
 * la retenue d'une annulation hors fenêtre viennent du **moteur de règlement unique** de
 * `@rueda/money` (`computeCancellationSettlement`, version `cxl-beta/1`), appliqué au trip tiré du
 * devis figé (`quoteSettlementTrip`). Le montant affiché au checkout est donc exactement celui que
 * le règlement retiendra pour une annulation volontaire du voyageur hors fenêtre gratuite.
 *
 * Paramètres du pays (`free_cancel_lead`, `last_minute_threshold`, `no_show_grace_minutes`) lus de
 * CFG par l'appelant (`resolveCancellationParams`) ; aucune horloge : l'instant de réservation
 * supposé (« si tu réserves maintenant ») est passé par l'appelant.
 */
import {
  computeCancellationSettlement,
  freeUntil,
  isSettlementError,
  subtract,
  type Money,
  type Ratio,
  type SettlementParams,
} from '@rueda/money';
import { quoteSettlementTrip, type Quote } from './engine.js';
import { QuoteError } from './errors.js';

/** Retenue d'une annulation volontaire hors fenêtre gratuite (08 BR-CXL-06). */
export interface LateCancellation {
  /** Fin de l'annulation gratuite pour une réservation faite à `bookedAtMs` (BR-CXL-01). */
  readonly freeUntilMs: number;
  /** Jours de location retenus : 1 (trip de plus de 2 jours) ou 1/2 (BR-CXL-06). */
  readonly penaltyDays: Ratio;
  /** Montant retenu TTC (lignes retenues et leur taxe) = total payé − remboursement. */
  readonly retained: Money;
  /** Remboursement TTC du voyageur dans ce cas. */
  readonly refund: Money;
  /** Version du moteur de règlement qui a produit ces montants. */
  readonly engineVersion: string;
}

const MINUTE_MS = 60_000;

/**
 * Annulation volontaire du voyageur juste après la fin de la fenêtre gratuite, réglée par le moteur
 * unique. `null` quand aucune annulation tardive n'existe avant le no-show (fenêtre gratuite qui
 * finit au départ et tolérance de no-show nulle) ou que le moteur ne la qualifie pas en retenue
 * partielle. Paramètres ou devis incohérents ⇒ `QUOTE_UNAVAILABLE` (jamais un montant deviné).
 */
export function lateCancellationOf(
  quote: Quote,
  params: SettlementParams,
  bookedAtMs: number,
): LateCancellation | null {
  if (!Number.isSafeInteger(bookedAtMs) || bookedAtMs > quote.startAtMs) {
    throw new QuoteError('QUOTE_UNAVAILABLE', 'instant de réservation après le départ');
  }
  try {
    const trip = { ...quoteSettlementTrip(quote), bookedAtMs };
    const free = freeUntil(trip, params);
    const requestedAtMs = free + 1;
    if (requestedAtMs >= trip.startAtMs + params.noShowGraceMinutes * MINUTE_MS) return null;
    const s = computeCancellationSettlement(
      trip,
      { reason: 'GUEST_CANCELLED', requestedAtMs },
      params,
    );
    if (s.qualification !== 'VOLUNTARY' || s.penaltyDays === null) return null;
    return {
      freeUntilMs: free,
      penaltyDays: s.penaltyDays,
      retained: subtract(quote.total, s.guestRefund),
      refund: s.guestRefund,
      engineVersion: s.engineVersion,
    };
  } catch (cause) {
    if (isSettlementError(cause)) {
      throw new QuoteError('QUOTE_UNAVAILABLE', `règlement impossible : ${cause.code}`, { cause });
    }
    throw cause;
  }
}
