/**
 * Réponses HTTP des demandes de réservation de l'hôte (US-223 partie 223c, ADR-146 ; 16 HDB-002 ;
 * 17 §2.5 « Hold de demande REQUEST » et exigences de sécurité 1 et 2) : code stable et clé du
 * catalogue `@rueda/i18n` (es, en, fr, pt-BR) ; jamais de détail technique, de jambe, de référence
 * du PSP, ni l'état d'une demande d'un autre compte.
 *
 * Codes de 17 §2.5 : `REQUEST_EXPIRED` (acceptation après l'heure limite de la base),
 * `INVALID_TRANSITION` (demande déjà acceptée ou refusée), `LEG_SUM_MISMATCH` (08 E7 : Σ jambes ≠
 * total du devis, ou total > autorisation : aucune capture). IDOR : demande inconnue, d'un autre
 * compte, ou compte qui n'est pas un compte titulaire de la session ⇒ 404 `REQUEST_NOT_FOUND`,
 * même réponse (la base rend FORBIDDEN, journalisé ; 17 §2.3 point 5). Repris : `TERMS_REACCEPT_
 * REQUIRED` (CGU de l'hôte, US-126, N-66), `START_PASSED`, `PAYMENT_UNAVAILABLE` (aucun connecteur
 * servi : production jusqu'au lot C). PROPOSÉS (ADR-146) : `REQUEST_NOT_FOUND`,
 * `GUEST_NOT_ELIGIBLE` (contrôles bloquants du voyageur relus avant la capture, US-209).
 */
import { HttpException } from '@nestjs/common';

export const HOST_REQUEST_MESSAGES = {
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  REQUEST_NOT_FOUND: { status: 404, messageKey: 'common.request.notFound' },
  REQUEST_EXPIRED: { status: 409, messageKey: 'common.request.expired' },
  INVALID_TRANSITION: { status: 409, messageKey: 'common.request.alreadyAnswered' },
  TERMS_REACCEPT_REQUIRED: { status: 409, messageKey: 'common.listing.hostTermsRequired' },
  GUEST_NOT_ELIGIBLE: { status: 409, messageKey: 'common.request.guestNotEligible' },
  START_PASSED: { status: 409, messageKey: 'common.payment.startPassed' },
  LEG_SUM_MISMATCH: { status: 409, messageKey: 'common.request.amountMismatch' },
  PAYMENT_UNAVAILABLE: { status: 503, messageKey: 'common.payment.unavailable' },
  BOOKING_UNAVAILABLE: { status: 503, messageKey: 'common.checkout.unavailable' },
} as const;

export type HostRequestHttpCode = keyof typeof HOST_REQUEST_MESSAGES;

export class HostRequestHttpError extends HttpException {
  readonly code: HostRequestHttpCode;

  constructor(code: HostRequestHttpCode) {
    super(
      { code, messageKey: HOST_REQUEST_MESSAGES[code].messageKey },
      HOST_REQUEST_MESSAGES[code].status,
    );
    this.code = code;
  }
}
