/**
 * Réponses HTTP du checkout (US-208, partie back-end ; 16 BKG-001, BKG-002 / BKG-025, BKG-008,
 * PRC-025 ; ADR-133) : code stable et clé du catalogue `@rueda/i18n` (es, en, fr, pt-BR) ; jamais
 * de détail technique, de montant de jambe ni d'information sur l'occupation en cause.
 *
 * Codes de 16 : `QUOTE_EXPIRED` (PRC-025, BKG-001), `MANUAL_TRANSMISSION_NOT_CONFIRMED`,
 * `DRIVER_MUST_BE_ACCOUNT_HOLDER` (BKG-025, BKG-002), `TERMS_NOT_ACCEPTED` (BKG-008), codes de
 * BKG-012 rendus par la pose du hold (`GUEST_OVERLAP`, `SELF_BOOKING_FORBIDDEN`,
 * `ACCOUNT_RESTRICTED`). Repris d'US-102 et d'US-204 : `TERMS_VERSION_CHANGED`,
 * `DATES_UNAVAILABLE`, `DATES_NOTICE_TOO_SHORT`. PROPOSÉS par US-208 (ADR-133) :
 * `QUOTE_ALREADY_USED`, `QUOTE_LINE_NOT_SUPPORTED` (N-129), `REQUEST_MODE_UNAVAILABLE` (N-128),
 * `LISTING_UNAVAILABLE`, `HOLD_NOT_FOUND`, `HOLD_ALREADY_LIVE`, `HOLD_LIMIT_REACHED`,
 * `HOLD_RATE_LIMITED`, `KYC_CONSENT_WITHDRAWN`, `TERMS_UNAVAILABLE`, `BOOKING_UNAVAILABLE`,
 * `REQUEST_INVALID`.
 */
import { HttpException } from '@nestjs/common';

export const CHECKOUT_MESSAGES = {
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  HOLD_NOT_FOUND: { status: 404, messageKey: 'common.checkout.holdNotFound' },
  QUOTE_EXPIRED: { status: 409, messageKey: 'common.quote.expired' },
  QUOTE_ALREADY_USED: { status: 409, messageKey: 'common.checkout.quoteAlreadyUsed' },
  QUOTE_LINE_NOT_SUPPORTED: { status: 422, messageKey: 'common.quote.lineNotSupported' },
  LISTING_UNAVAILABLE: { status: 409, messageKey: 'common.checkout.listingUnavailable' },
  REQUEST_MODE_UNAVAILABLE: { status: 409, messageKey: 'common.checkout.requestModeUnavailable' },
  MANUAL_TRANSMISSION_NOT_CONFIRMED: {
    status: 422,
    messageKey: 'common.checkout.manualNotConfirmed',
  },
  DRIVER_MUST_BE_ACCOUNT_HOLDER: {
    status: 422,
    messageKey: 'common.checkout.driverMustBeAccountHolder',
  },
  TERMS_NOT_ACCEPTED: { status: 422, messageKey: 'common.checkout.termsNotAccepted' },
  TERMS_VERSION_CHANGED: { status: 409, messageKey: 'common.legal.versionChanged' },
  TERMS_UNAVAILABLE: { status: 503, messageKey: 'common.legal.unavailable' },
  DATES_UNAVAILABLE: { status: 409, messageKey: 'common.listing.datesUnavailable' },
  DATES_NOTICE_TOO_SHORT: { status: 422, messageKey: 'common.checkout.noticeTooShort' },
  GUEST_OVERLAP: { status: 409, messageKey: 'common.checkout.guestOverlap' },
  HOLD_ALREADY_LIVE: { status: 409, messageKey: 'common.checkout.holdAlreadyLive' },
  HOLD_LIMIT_REACHED: { status: 409, messageKey: 'common.checkout.holdLimit' },
  HOLD_RATE_LIMITED: { status: 429, messageKey: 'common.checkout.holdRateLimited' },
  SELF_BOOKING_FORBIDDEN: { status: 403, messageKey: 'common.booking.selfBookingForbidden.body' },
  ACCOUNT_RESTRICTED: { status: 403, messageKey: 'common.checkout.accountRestricted' },
  KYC_CONSENT_WITHDRAWN: { status: 403, messageKey: 'common.checkout.identityConsentWithdrawn' },
  BOOKING_UNAVAILABLE: { status: 503, messageKey: 'common.checkout.unavailable' },
} as const;

export type CheckoutHttpCode = keyof typeof CHECKOUT_MESSAGES;

export class CheckoutHttpError extends HttpException {
  readonly code: CheckoutHttpCode;

  constructor(code: CheckoutHttpCode) {
    super({ code, messageKey: CHECKOUT_MESSAGES[code].messageKey }, CHECKOUT_MESSAGES[code].status);
    this.code = code;
  }
}

export function isCheckoutCode(value: string): value is CheckoutHttpCode {
  return Object.hasOwn(CHECKOUT_MESSAGES, value);
}
