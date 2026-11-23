/**
 * Réponses des routes des sinistres entre particuliers d'un trip (US-318, ADR-198 ; 16 CLM-002,
 * 08 BR-TT-02 à 04) : `/trips/{tripId}/incidents` (voyageur, depuis S17),
 * `/trips/{tripId}/claims` et `/trips/{tripId}/traffic-charges` (titulaire du compte d'hôte). Code
 * stable (16 A.8, sans préfixe de module) et clé du catalogue `@rueda/i18n` (es, en, fr, pt) ;
 * jamais de détail technique.
 *
 * PROPOSÉS (à reporter dans 16 A.8) : `TRIP_CLAIM_NOT_FOUND` (trip inconnu, d'une autre personne,
 * partie sans droit : même réponse), `INCIDENT_NOT_OPEN` (hors du trip en cours),
 * `INCIDENT_CASE_REQUIRED` (aucune demande d'aide ACCIDENT / BREAKDOWN vivante de la personne),
 * `INCIDENT_PHOTOS_REQUIRED` (aucune photo dans sa série INCIDENT), `TRAFFIC_TRIP_NOT_ENDED`,
 * `TRAFFIC_CHARGE_DEADLINE_PASSED` (fin effective + délai du pays dépassé), `TRAFFIC_OUTSIDE_TRIP`
 * (fait hors de la période du trip), `TRAFFIC_EVIDENCE_REQUIRED` (pièce absente de la série
 * TRAFFIC ou déjà utilisée), `TRAFFIC_TERMS_UNKNOWN` (délai ou frais du pays absents),
 * `TRIP_CLAIM_UNAVAILABLE` (base injoignable).
 *
 * Suite (0181, ADR-201, red team F-L3-SIN-01 / 02), PROPOSÉS : `TRAFFIC_REFERENCE_REQUIRED`
 * (référence du PV absente), `TRAFFIC_DUPLICATE` (référence déjà refacturée sur ce trip ;
 * `chargeId`), `TRAFFIC_AMOUNT_ABOVE_CAP` (plafond du pays ; `capMinor`), `TRAFFIC_NOT_OPEN`
 * (refacturation contestée, payée, décidée ou exécutée) ; repris d'US-706 :
 * `GUEST_RESPONSE_WINDOW_CLOSED`, `INCIDENTAL_DISPUTE_REASON_REQUIRED`, `CLAIM_EVIDENCE_MISSING`
 * (mêmes clés du catalogue). `TRAFFIC_TERMS_UNKNOWN` couvre aussi le délai du voyageur et le
 * plafond absents.
 */
import { HttpException } from '@nestjs/common';

export const TRIP_CLAIM_MESSAGES = {
  TRIP_CLAIM_NOT_FOUND: { status: 404, messageKey: 'common.tripClaims.notFound' },
  INCIDENT_NOT_OPEN: { status: 409, messageKey: 'common.tripClaims.incidentNotOpen' },
  INCIDENT_CASE_REQUIRED: { status: 409, messageKey: 'common.tripClaims.incidentCaseRequired' },
  INCIDENT_PHOTOS_REQUIRED: { status: 422, messageKey: 'common.tripClaims.incidentPhotosRequired' },
  TRAFFIC_TRIP_NOT_ENDED: { status: 409, messageKey: 'common.tripClaims.trafficTripNotEnded' },
  TRAFFIC_CHARGE_DEADLINE_PASSED: {
    status: 422,
    messageKey: 'common.tripClaims.trafficDeadlinePassed',
  },
  TRAFFIC_OUTSIDE_TRIP: { status: 422, messageKey: 'common.tripClaims.trafficOutsideTrip' },
  TRAFFIC_EVIDENCE_REQUIRED: {
    status: 422,
    messageKey: 'common.tripClaims.trafficEvidenceRequired',
  },
  TRAFFIC_TERMS_UNKNOWN: { status: 503, messageKey: 'common.tripClaims.trafficTermsUnknown' },
  TRAFFIC_REFERENCE_REQUIRED: {
    status: 422,
    messageKey: 'common.tripClaims.trafficReferenceRequired',
  },
  TRAFFIC_DUPLICATE: { status: 409, messageKey: 'common.tripClaims.trafficDuplicate' },
  TRAFFIC_AMOUNT_ABOVE_CAP: { status: 422, messageKey: 'common.tripClaims.trafficAmountAboveCap' },
  TRAFFIC_NOT_OPEN: { status: 409, messageKey: 'common.tripClaims.trafficNotOpen' },
  GUEST_RESPONSE_WINDOW_CLOSED: {
    status: 409,
    messageKey: 'common.incidental.responseWindowClosed',
  },
  INCIDENTAL_DISPUTE_REASON_REQUIRED: {
    status: 422,
    messageKey: 'common.incidental.disputeReasonRequired',
  },
  CLAIM_EVIDENCE_MISSING: { status: 422, messageKey: 'common.incidental.evidenceMissing' },
  TRIP_CLAIM_UNAVAILABLE: { status: 503, messageKey: 'common.tripClaims.unavailable' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
} as const;

export type TripClaimCode = keyof typeof TRIP_CLAIM_MESSAGES;

/**
 * Erreur HTTP des routes des sinistres d'un trip : corps `{ code, messageKey }` (et `deadlineAt`,
 * `chargeId`, `capMinor` selon le code).
 */
export class TripClaimHttpError extends HttpException {
  readonly code: TripClaimCode;

  constructor(code: TripClaimCode, extra?: Readonly<Record<string, string>>) {
    super(
      { code, messageKey: TRIP_CLAIM_MESSAGES[code].messageKey, ...(extra ?? {}) },
      TRIP_CLAIM_MESSAGES[code].status,
    );
    this.code = code;
  }
}

/** Issue de la base → code HTTP ; toute issue inconnue : indisponible (fail-closed). */
export function tripClaimOutcomeCode(outcome: string): TripClaimCode {
  switch (outcome) {
    case 'NOT_FOUND':
      return 'TRIP_CLAIM_NOT_FOUND';
    case 'TRAFFIC_WINDOW_UNKNOWN':
    case 'TRAFFIC_FEE_UNKNOWN':
    case 'TRAFFIC_RESPONSE_WINDOW_UNKNOWN':
    case 'TRAFFIC_CAP_UNKNOWN':
      return 'TRAFFIC_TERMS_UNKNOWN';
    case 'INCIDENT_NOT_OPEN':
    case 'INCIDENT_CASE_REQUIRED':
    case 'INCIDENT_PHOTOS_REQUIRED':
    case 'TRAFFIC_TRIP_NOT_ENDED':
    case 'TRAFFIC_CHARGE_DEADLINE_PASSED':
    case 'TRAFFIC_OUTSIDE_TRIP':
    case 'TRAFFIC_EVIDENCE_REQUIRED':
    case 'TRAFFIC_REFERENCE_REQUIRED':
    case 'TRAFFIC_DUPLICATE':
    case 'TRAFFIC_AMOUNT_ABOVE_CAP':
    case 'TRAFFIC_NOT_OPEN':
    case 'GUEST_RESPONSE_WINDOW_CLOSED':
    case 'INCIDENTAL_DISPUTE_REASON_REQUIRED':
    case 'CLAIM_EVIDENCE_MISSING':
    case 'REQUEST_INVALID':
      return outcome;
    default:
      return 'TRIP_CLAIM_UNAVAILABLE';
  }
}
