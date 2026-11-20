/**
 * Réponses des routes de la remise et du retour `/trips/{tripId}/handover/{direction}` (US-315,
 * ADR-183) : code stable (16 A.8, sans préfixe de module) et clé du catalogue `@rueda/i18n` (es,
 * en, fr, pt) ; jamais de détail technique.
 *
 * Codes de 16 TRP-002 et VER-015 : `CHECKIN_NOT_OPEN`, `CHECKIN_PAYMENT_NOT_CONFIRMED`,
 * `CHECKIN_STEP_INCOMPLETE`, `CONTRACT_NOT_SIGNED`, `CHECKIN_LICENSE_CHECK_INCOMPLETE` ; de 16
 * PRT-001 : `INSURER_CONTRACT_INACTIVE` ; `REQUEST_INVALID`, `AUTH_REQUIRED` (US-010). PROPOSÉS (à
 * reporter dans 16 A.8) : `HANDOVER_NOT_FOUND` (trip inconnu, d'une autre personne, sens ou
 * identifiant mal formé : même réponse), `HANDOVER_HOST_ONLY` (contrôle du permis par le voyageur),
 * `CHECKOUT_NOT_OPEN`, `CHECKOUT_STEP_INCOMPLETE`, `DEPOSIT_NOT_READY` (caution exigée non
 * autorisée), `HANDOVER_BLOCKED` (éligibilité d'une partie : rien de plus n'est dit à l'autre),
 * `IDENTITY_CHECK_FAILED`, `READING_INVALID`, `CONTACTLESS_UNAVAILABLE` (OQ-P2P-05),
 * `HANDOVER_UNAVAILABLE` (base injoignable : aucune file hors ligne au lot 3, ADR-005, ADR-039).
 */
import { HttpException } from '@nestjs/common';

export const HANDOVER_MESSAGES = {
  HANDOVER_NOT_FOUND: { status: 404, messageKey: 'common.handover.notFound' },
  HANDOVER_HOST_ONLY: { status: 403, messageKey: 'common.handover.hostOnly' },
  CHECKIN_NOT_OPEN: { status: 409, messageKey: 'common.handover.checkinNotOpen' },
  CHECKOUT_NOT_OPEN: { status: 409, messageKey: 'common.handover.checkoutNotOpen' },
  CHECKIN_PAYMENT_NOT_CONFIRMED: {
    status: 409,
    messageKey: 'common.handover.paymentNotConfirmed',
  },
  CONTRACT_NOT_SIGNED: { status: 409, messageKey: 'common.handover.contractNotSigned' },
  DEPOSIT_NOT_READY: { status: 409, messageKey: 'common.handover.depositNotReady' },
  INSURER_CONTRACT_INACTIVE: { status: 409, messageKey: 'common.handover.insurerInactive' },
  HANDOVER_BLOCKED: { status: 409, messageKey: 'common.handover.blocked' },
  IDENTITY_CHECK_FAILED: { status: 409, messageKey: 'common.handover.identityFailed' },
  CHECKIN_STEP_INCOMPLETE: { status: 409, messageKey: 'common.handover.checkinStepIncomplete' },
  CHECKOUT_STEP_INCOMPLETE: {
    status: 409,
    messageKey: 'common.handover.checkoutStepIncomplete',
  },
  CONTACTLESS_UNAVAILABLE: { status: 409, messageKey: 'common.handover.contactlessUnavailable' },
  CHECKIN_LICENSE_CHECK_INCOMPLETE: {
    status: 422,
    messageKey: 'common.handover.licenseCheckIncomplete',
  },
  READING_INVALID: { status: 422, messageKey: 'common.handover.readingInvalid' },
  HANDOVER_UNAVAILABLE: { status: 503, messageKey: 'common.handover.unavailable' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
} as const;

export type HandoverCode = keyof typeof HANDOVER_MESSAGES;

/** Erreur HTTP des routes de la remise : corps `{ code, messageKey }`. */
export class HandoverHttpError extends HttpException {
  readonly code: HandoverCode;

  constructor(code: HandoverCode) {
    super({ code, messageKey: HANDOVER_MESSAGES[code].messageKey }, HANDOVER_MESSAGES[code].status);
    this.code = code;
  }
}

/** Issue de la base → code HTTP ; toute issue inconnue : indisponible (fail-closed). */
export function handoverOutcomeCode(outcome: string): HandoverCode {
  switch (outcome) {
    case 'NOT_FOUND':
      return 'HANDOVER_NOT_FOUND';
    case 'HOST_ONLY':
      return 'HANDOVER_HOST_ONLY';
    case 'CHECKIN_NOT_OPEN':
    case 'CHECKOUT_NOT_OPEN':
    case 'CHECKIN_PAYMENT_NOT_CONFIRMED':
    case 'CONTRACT_NOT_SIGNED':
    case 'DEPOSIT_NOT_READY':
    case 'INSURER_CONTRACT_INACTIVE':
    case 'HANDOVER_BLOCKED':
    case 'IDENTITY_CHECK_FAILED':
    case 'CHECKIN_STEP_INCOMPLETE':
    case 'CHECKOUT_STEP_INCOMPLETE':
    case 'CONTACTLESS_UNAVAILABLE':
    case 'CHECKIN_LICENSE_CHECK_INCOMPLETE':
    case 'READING_INVALID':
    case 'REQUEST_INVALID':
      return outcome;
    default:
      return 'HANDOVER_UNAVAILABLE';
  }
}
