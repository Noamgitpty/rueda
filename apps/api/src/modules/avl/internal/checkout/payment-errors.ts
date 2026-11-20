/**
 * Réponses HTTP du paiement du hold du checkout (US-223 partie 223b, ADR-142 ; 16 PAY-034,
 * PAY-006, PAY-017, BKG-014 ; codes de la base : ADR-065, ADR-139) : code stable et clé du
 * catalogue `@rueda/i18n` (es, en, fr, pt-BR) ; jamais de détail technique, de jambe, de référence
 * du PSP ni de montant (le client n'envoie ni ne reçoit aucun montant de jambe).
 *
 * Codes de 16 et 08 : `HOST_PAYOUT_RAIL_UNAVAILABLE` (08 E7, 17 §2.8 : capacité bloquante du PSP non
 * validée, inconnue = « non »), `BOOKING_UNDER_REVIEW` (BKG-014, ADM-029 : hold de revue avant
 * `reviewed_at`), `PAYMENT_ATTEMPTS_EXCEEDED` (PAY-017), `HOLD_EXPIRED` (BKG-014). PROPOSÉS par
 * US-024 (ADR-065) et repris : `START_PASSED`, `PAYMENT_METHOD_UNAVAILABLE` ; par US-223 (ADR-139) :
 * `PAYMENT_UNAVAILABLE` (aucun compte marchand ACTIVE du pays, ou aucun connecteur servi par cette
 * image : production jusqu'au lot C) ; par 223b (ADR-142) : `HOLD_NOT_PAYABLE` (hold déjà payé ou
 * terminal : la lecture de l'état fait foi).
 */
import { HttpException } from '@nestjs/common';
import { CHECKOUT_MESSAGES } from './errors.js';

export const PAYMENT_MESSAGES = {
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  REQUEST_INVALID: CHECKOUT_MESSAGES.REQUEST_INVALID,
  HOLD_NOT_FOUND: CHECKOUT_MESSAGES.HOLD_NOT_FOUND,
  HOLD_EXPIRED: { status: 409, messageKey: 'common.payment.holdExpired' },
  HOLD_NOT_PAYABLE: { status: 409, messageKey: 'common.payment.holdNotPayable' },
  BOOKING_UNDER_REVIEW: { status: 409, messageKey: 'common.payment.underReview' },
  START_PASSED: { status: 409, messageKey: 'common.payment.startPassed' },
  PAYMENT_ATTEMPTS_EXCEEDED: { status: 409, messageKey: 'common.payment.attemptsExceeded' },
  HOST_PAYOUT_RAIL_UNAVAILABLE: { status: 409, messageKey: 'common.payment.payoutRailUnavailable' },
  PAYMENT_METHOD_UNAVAILABLE: { status: 422, messageKey: 'common.payment.methodUnavailable' },
  // US-703 (ADR-189 ; 08 BR-PAY-09, 16 PAY-015) : case du consentement MIT non cochée (S05)
  MIT_CONSENT_REQUIRED: { status: 422, messageKey: 'common.payment.mitConsentRequired' },
  QUOTE_UNAVAILABLE: { status: 422, messageKey: 'common.quote.unavailable' },
  ACCOUNT_RESTRICTED: CHECKOUT_MESSAGES.ACCOUNT_RESTRICTED,
  KYC_NOT_APPROVED: CHECKOUT_MESSAGES.KYC_NOT_APPROVED,
  KYC_BIOMETRIC_CONSENT_MISSING: CHECKOUT_MESSAGES.KYC_BIOMETRIC_CONSENT_MISSING,
  KYC_LICENSE_EXPIRED: CHECKOUT_MESSAGES.KYC_LICENSE_EXPIRED,
  AGE_CLASS_MISMATCH: CHECKOUT_MESSAGES.AGE_CLASS_MISMATCH,
  // US-701 (ADR-169 ; 08 BR-PAY-06) : caution exigée sans rail possible pour ces dates, ou sans
  // montant fixé (`deposit_amount` absent) ; refus AVANT le paiement, aucune écriture
  DEPOSIT_RAIL_UNAVAILABLE: { status: 409, messageKey: 'common.payment.depositUnavailable' },
  DEPOSIT_PARAM_MISSING: { status: 409, messageKey: 'common.payment.depositUnavailable' },
  PAYMENT_UNAVAILABLE: { status: 503, messageKey: 'common.payment.unavailable' },
  BOOKING_UNAVAILABLE: CHECKOUT_MESSAGES.BOOKING_UNAVAILABLE,
} as const;

export type PaymentHttpCode = keyof typeof PAYMENT_MESSAGES;

export class PaymentHttpError extends HttpException {
  readonly code: PaymentHttpCode;

  constructor(code: PaymentHttpCode) {
    super({ code, messageKey: PAYMENT_MESSAGES[code].messageKey }, PAYMENT_MESSAGES[code].status);
    this.code = code;
  }
}
