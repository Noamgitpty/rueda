/**
 * Appel du moteur de règlement par le service STL : refus `REFUND_OUT_OF_RANGE` mis en revue FIN
 * (BOARD N-13 (a) ; ADR-090 décision 2 ; 08 E7 règle 5 ; US-224, ADR-145).
 *
 * Le moteur pur (`@rueda/money`) refuse un remboursement hors de [0 ; total payé] ou une taxe
 * remboursée hors de [0 ; taxe payée] (promotions proches de 100 %, Q-014) : aucun règlement n'est
 * alors produit. Le service appelant (annulation d'US-215, fins anticipées d'US-518) passe par
 * `settleOrFinReview` :
 * - l'erreur est attrapée, aucun règlement ni aucun ordre n'est écrit ni envoyé (le remboursement
 *   reste à planifier, jamais réduit) ;
 * - une alerte P1 `FIN_SETTLEMENT_REVIEW` est levée, avec des COMPTES et des CODES seulement (pays,
 *   code d'erreur) : le canal d'alerte refuse tout identifiant d'objet (17 §6.3) ;
 * - le résultat `FIN_REVIEW` rend à l'appelant `SettlementError.details` (montants en chaînes
 *   d'unités mineures, devise, motif ; aucune donnée personnelle) pour qu'il l'inscrive avec la
 *   référence du trip dans sa propre transaction (instance `PLANNED` de 224b, file FIN).
 *
 * Toute autre erreur du moteur est relancée telle quelle (elle n'est pas une revue FIN).
 */
import { isSettlementError, type SettlementErrorDetails } from '@rueda/money';
import type { AlertChannel } from '../../bus/index.js';

export type SettlementAttempt<T> =
  | { readonly outcome: 'SETTLED'; readonly result: T }
  | {
      readonly outcome: 'FIN_REVIEW';
      readonly code: 'REFUND_OUT_OF_RANGE';
      readonly details: SettlementErrorDetails;
    };

const COUNTRY = /^[A-Z]{2}$/;

/**
 * Exécute `compute` (appel du moteur pur) ; `REFUND_OUT_OF_RANGE` ⇒ revue FIN et alerte, rien
 * d'écrit. `country` est le pays du trip (étiquette de l'alerte).
 */
export async function settleOrFinReview<T>(
  compute: () => T,
  country: string,
  alerts: AlertChannel,
): Promise<SettlementAttempt<T>> {
  if (!COUNTRY.test(country)) throw new Error('STL : code pays invalide');
  try {
    return { outcome: 'SETTLED', result: compute() };
  } catch (error) {
    if (!isSettlementError(error) || error.code !== 'REFUND_OUT_OF_RANGE') throw error;
    await alerts.send({
      code: 'FIN_SETTLEMENT_REVIEW',
      severity: 'P1',
      counts: { settlements: 1 },
      labels: { country, error_code: 'REFUND_OUT_OF_RANGE' },
    });
    return {
      outcome: 'FIN_REVIEW',
      code: 'REFUND_OUT_OF_RANGE',
      details: error.details ?? Object.freeze({}),
    };
  }
}
