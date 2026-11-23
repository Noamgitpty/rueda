/**
 * Réponses des routes des frais annexes `/trips/{tripId}/incidental-fees` (US-706, ADR-197 ; 16
 * CLM-021) : code stable (16 A.8, sans préfixe de module) et clé du catalogue `@rueda/i18n` (es,
 * en, fr, pt) ; jamais de détail technique.
 *
 * Codes de 16 CLM-021 : `CLAIM_EVIDENCE_MISSING` ; `REQUEST_INVALID`, `AUTH_REQUIRED` (US-010).
 * PROPOSÉS (à reporter dans 16 A.8) : `INCIDENTAL_NOT_FOUND` (trip ou frais inconnu, d'une autre
 * personne, identifiant mal formé : même réponse), `INCIDENTAL_TYPE_NOT_ALLOWED` (hors de la liste
 * fermée de BR-REIMB-01), `INCIDENTAL_TYPE_NOT_SUPPORTED` (type de la liste traité ailleurs : retard,
 * péages, amendes, kilométrage, recharge), `INCIDENTAL_TRIP_NOT_ENDED`, `INCIDENTAL_WINDOW_CLOSED`
 * (délai de l'hôte, BR-REIMB-01 R09), `INCIDENTAL_NOT_BILLABLE` (BR-FUEL-01 / 03, BR-RETURN-05),
 * `INCIDENTAL_FUEL_PREPAID` (BR-FUEL-02), `INCIDENTAL_AMOUNT_ABOVE_CAP`, `INCIDENTAL_DUPLICATE`,
 * `INCIDENTAL_NOT_CANCELLABLE`, `INCIDENTAL_NOT_OPEN`, `GUEST_RESPONSE_WINDOW_CLOSED` (BR-REIMB-02 :
 * fenêtre jamais rouverte), `INCIDENTAL_DISPUTE_REASON_REQUIRED`, `INCIDENTAL_UNAVAILABLE` (base
 * injoignable ou paramètre du pays absent : rien n'est écrit).
 */
import { HttpException } from '@nestjs/common';

export const INCIDENTAL_MESSAGES = {
  INCIDENTAL_NOT_FOUND: { status: 404, messageKey: 'common.incidental.notFound' },
  INCIDENTAL_TYPE_NOT_ALLOWED: { status: 422, messageKey: 'common.incidental.typeNotAllowed' },
  INCIDENTAL_TYPE_NOT_SUPPORTED: { status: 422, messageKey: 'common.incidental.typeNotSupported' },
  INCIDENTAL_TRIP_NOT_ENDED: { status: 409, messageKey: 'common.incidental.tripNotEnded' },
  INCIDENTAL_WINDOW_CLOSED: { status: 409, messageKey: 'common.incidental.windowClosed' },
  CLAIM_EVIDENCE_MISSING: { status: 422, messageKey: 'common.incidental.evidenceMissing' },
  INCIDENTAL_NOT_BILLABLE: { status: 422, messageKey: 'common.incidental.notBillable' },
  INCIDENTAL_FUEL_PREPAID: { status: 422, messageKey: 'common.incidental.fuelPrepaid' },
  INCIDENTAL_AMOUNT_ABOVE_CAP: { status: 422, messageKey: 'common.incidental.amountAboveCap' },
  INCIDENTAL_DUPLICATE: { status: 409, messageKey: 'common.incidental.duplicate' },
  INCIDENTAL_NOT_CANCELLABLE: { status: 409, messageKey: 'common.incidental.notCancellable' },
  INCIDENTAL_NOT_OPEN: { status: 409, messageKey: 'common.incidental.notOpen' },
  GUEST_RESPONSE_WINDOW_CLOSED: {
    status: 409,
    messageKey: 'common.incidental.responseWindowClosed',
  },
  INCIDENTAL_DISPUTE_REASON_REQUIRED: {
    status: 422,
    messageKey: 'common.incidental.disputeReasonRequired',
  },
  INCIDENTAL_UNAVAILABLE: { status: 503, messageKey: 'common.incidental.unavailable' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
} as const;

export type IncidentalCode = keyof typeof INCIDENTAL_MESSAGES;

/** Erreur HTTP des routes des frais annexes : corps `{ code, messageKey }`. */
export class IncidentalHttpError extends HttpException {
  readonly code: IncidentalCode;

  constructor(code: IncidentalCode) {
    super(
      { code, messageKey: INCIDENTAL_MESSAGES[code].messageKey },
      INCIDENTAL_MESSAGES[code].status,
    );
    this.code = code;
  }
}

/** Issue de la base → code HTTP ; toute valeur inconnue : indisponible (fail-closed). */
export function incidentalOutcomeCode(outcome: string): IncidentalCode {
  switch (outcome) {
    case 'NOT_FOUND':
      return 'INCIDENTAL_NOT_FOUND';
    case 'INCIDENTAL_TYPE_NOT_ALLOWED':
    case 'INCIDENTAL_TYPE_NOT_SUPPORTED':
    case 'INCIDENTAL_TRIP_NOT_ENDED':
    case 'INCIDENTAL_WINDOW_CLOSED':
    case 'CLAIM_EVIDENCE_MISSING':
    case 'INCIDENTAL_NOT_BILLABLE':
    case 'INCIDENTAL_FUEL_PREPAID':
    case 'INCIDENTAL_AMOUNT_ABOVE_CAP':
    case 'INCIDENTAL_DUPLICATE':
    case 'INCIDENTAL_NOT_CANCELLABLE':
    case 'INCIDENTAL_NOT_OPEN':
    case 'GUEST_RESPONSE_WINDOW_CLOSED':
    case 'INCIDENTAL_DISPUTE_REASON_REQUIRED':
    case 'REQUEST_INVALID':
      return outcome;
    default:
      // PARAM_MISSING (délai ou plafond du pays absent) et toute issue inconnue : rien n'est écrit
      return 'INCIDENTAL_UNAVAILABLE';
  }
}
