/**
 * Réponses des routes du no-show `/trips/{tripId}/no-show` (US-307, ADR-191 ; 16 TRP-015) : code
 * stable (16 A.8, sans préfixe de module) et clé du catalogue `@rueda/i18n` (es, en, fr, pt) ;
 * jamais de détail technique.
 *
 * Codes de 16 TRP-015 : `NO_SHOW_TOO_EARLY`, `NO_SHOW_WINDOW_CLOSED` ; de 16 TRP-002 :
 * `CHECKIN_NOT_OPEN` ; d'US-215 : `CANCELLATION_PENDING` ; `REQUEST_INVALID`, `AUTH_REQUIRED`
 * (US-010). PROPOSÉS (à reporter dans 16 A.8) : `NO_SHOW_NOT_FOUND` (trip inconnu, d'une autre
 * personne, identifiant mal formé : même réponse), `NO_SHOW_NOT_ALLOWED` (état du trip sans sortie
 * vers un no-show : commencé, terminé, annulé), `NO_SHOW_PARTY_PRESENT` (la partie déclarée absente
 * s'est présentée à la remise), `NO_SHOW_EVIDENCE_REQUIRED` (no-show de l'hôte sans message du
 * voyageur suivi de 15 min sans réponse), `NO_SHOW_UNAVAILABLE` (base injoignable).
 */
import { HttpException } from '@nestjs/common';

export const NO_SHOW_MESSAGES = {
  NO_SHOW_NOT_FOUND: { status: 404, messageKey: 'common.noShow.notFound' },
  CHECKIN_NOT_OPEN: { status: 409, messageKey: 'common.noShow.checkinNotOpen' },
  NO_SHOW_NOT_ALLOWED: { status: 409, messageKey: 'common.noShow.notAllowed' },
  NO_SHOW_TOO_EARLY: { status: 409, messageKey: 'common.noShow.tooEarly' },
  NO_SHOW_WINDOW_CLOSED: { status: 409, messageKey: 'common.noShow.windowClosed' },
  NO_SHOW_PARTY_PRESENT: { status: 409, messageKey: 'common.noShow.partyPresent' },
  NO_SHOW_EVIDENCE_REQUIRED: { status: 409, messageKey: 'common.noShow.evidenceRequired' },
  CANCELLATION_PENDING: { status: 409, messageKey: 'common.noShow.pending' },
  NO_SHOW_UNAVAILABLE: { status: 503, messageKey: 'common.noShow.unavailable' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
} as const;

export type NoShowCode = keyof typeof NO_SHOW_MESSAGES;

/** Erreur HTTP des routes du no-show : corps `{ code, messageKey }`. */
export class NoShowHttpError extends HttpException {
  readonly code: NoShowCode;

  constructor(code: NoShowCode) {
    super({ code, messageKey: NO_SHOW_MESSAGES[code].messageKey }, NO_SHOW_MESSAGES[code].status);
    this.code = code;
  }
}

/** Obstacle ou issue de la base → code HTTP ; toute valeur inconnue : indisponible (fail-closed). */
export function noShowOutcomeCode(outcome: string): NoShowCode {
  switch (outcome) {
    case 'NOT_FOUND':
      return 'NO_SHOW_NOT_FOUND';
    case 'TRIP_TRANSITION_FORBIDDEN':
      return 'NO_SHOW_NOT_ALLOWED';
    case 'CHECKIN_NOT_OPEN':
    case 'NO_SHOW_TOO_EARLY':
    case 'NO_SHOW_WINDOW_CLOSED':
    case 'NO_SHOW_PARTY_PRESENT':
    case 'NO_SHOW_EVIDENCE_REQUIRED':
    case 'CANCELLATION_PENDING':
    case 'REQUEST_INVALID':
      return outcome;
    default:
      return 'NO_SHOW_UNAVAILABLE';
  }
}
