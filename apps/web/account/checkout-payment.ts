/**
 * Paiement du hold du checkout, côté SERVEUR du site (US-223 partie 223b ; ADR-142 ; 16 PAY-034,
 * PAY-006 ; 10b S05, S06, UX-26, UX-27) : lecture défensive des réponses de
 * `POST|GET /checkout/holds/{id}/payment`. Toute réponse mal formée est refusée (`null`) : l'écran
 * affiche son état d'erreur. Le site n'envoie JAMAIS de montant ni de jambe (L2-PM-03) : seulement le
 * moyen de paiement. S06 se fonde sur l'état rendu par l'API (hold et trip né), jamais sur un statut
 * d'opération du PSP.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';
import { codeOf } from './api-client.ts';
import { isUuid } from './checkout.ts';

/** États rendus par l'API (ADR-142) ; un autre état ⇒ réponse refusée (fail-closed). */
export const PAYMENT_STATES = [
  'PAYABLE',
  'DECLINED',
  'VERIFYING',
  'CONFIRMED',
  'REFUND_DUE',
  'UNPROVEN',
  'ENDED',
] as const;
export type PaymentStateView = (typeof PAYMENT_STATES)[number];

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** Page hébergée du PSP : https seulement, sans espace, bornée (jamais une adresse du client). */
const HOSTED = /^https:\/\/[^\s"'<>]+$/;
const HOSTED_MAX = 500;

export interface CheckoutPaymentView {
  readonly holdId: string;
  readonly state: PaymentStateView;
  readonly tripId: string | null;
  readonly expiresAt: string;
  readonly paymentInFlightUntil: string | null;
  /** Page hébergée du PSP (POST seulement) ; `null` : aucun ordre créé par cet appel. */
  readonly redirectUrl: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const instantOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === 'string' && INSTANT.test(v) ? v : undefined;

/** Réponse 200 / 201 de la route du paiement ; `null` si mal formée. */
export function checkoutPaymentOf(reply: ApiResult): CheckoutPaymentView | null {
  if (reply.status !== 200 && reply.status !== 201) return null;
  if (!isObj(reply.json) || !isObj(reply.json['payment'])) return null;
  const p = reply.json['payment'];
  const holdId = p['holdId'];
  const state = p['state'];
  const tripId = p['tripId'];
  const expiresAt = instantOrNull(p['expiresAt']);
  const inFlight = instantOrNull(p['paymentInFlightUntil']);
  const url = p['redirectUrl'];
  if (!isUuid(holdId) || !(PAYMENT_STATES as readonly unknown[]).includes(state)) return null;
  if (!(tripId === null || isUuid(tripId))) return null;
  if (typeof expiresAt !== 'string' || inFlight === undefined) return null;
  // « confirmé » exige un trip né (jamais l'inverse)
  if (state === 'CONFIRMED' && tripId === null) return null;
  const redirectUrl =
    typeof url === 'string' && HOSTED.test(url) && url.length <= HOSTED_MAX ? url : null;
  return {
    holdId,
    state: state as PaymentStateView,
    tripId: tripId as string | null,
    expiresAt,
    paymentInFlightUntil: inFlight,
    redirectUrl,
  };
}

/**
 * Codes stables de la route du paiement (ADR-142) → clé du catalogue (es, en, fr, pt-BR). Un code
 * inconnu ou une API injoignable donne un message générique (fail-closed).
 */
const PAYMENT_KEYS: Readonly<Record<string, MessageKey>> = {
  REQUEST_INVALID: 'common.auth.requestInvalid',
  HOLD_NOT_FOUND: 'common.checkout.holdNotFound',
  HOLD_EXPIRED: 'common.payment.holdExpired',
  HOLD_NOT_PAYABLE: 'common.payment.holdNotPayable',
  BOOKING_UNDER_REVIEW: 'common.payment.underReview',
  START_PASSED: 'common.payment.startPassed',
  PAYMENT_ATTEMPTS_EXCEEDED: 'common.payment.attemptsExceeded',
  HOST_PAYOUT_RAIL_UNAVAILABLE: 'common.payment.payoutRailUnavailable',
  PAYMENT_METHOD_UNAVAILABLE: 'common.payment.methodUnavailable',
  QUOTE_UNAVAILABLE: 'common.quote.unavailable',
  ACCOUNT_RESTRICTED: 'common.checkout.accountRestricted',
  KYC_NOT_APPROVED: 'common.kyc.notApproved',
  KYC_BIOMETRIC_CONSENT_MISSING: 'common.kyc.consentMissing',
  KYC_LICENSE_EXPIRED: 'common.kyc.licenseExpired',
  AGE_CLASS_MISMATCH: 'common.checkout.ageClassMismatch',
  PAYMENT_UNAVAILABLE: 'common.payment.unavailable',
  BOOKING_UNAVAILABLE: 'common.checkout.unavailable',
  RATE_LIMITED: 'common.rateLimit.retryLater',
};

export function paymentErrorKey(reply: ApiResult): MessageKey {
  const code = codeOf(reply);
  const key = code === null ? undefined : PAYMENT_KEYS[code];
  return key ?? 'common.payment.unavailable';
}

/** Codes connus (tests) ; chacun a sa clé dans les quatre catalogues (typecheck). */
export const PAYMENT_ERROR_CODES: readonly string[] = Object.keys(PAYMENT_KEYS);

/**
 * Refus après lesquels l'état du hold fait foi (S06) : hold échu ou déjà payé entre l'affichage de
 * S05 et le clic.
 */
export const PAYMENT_STATE_CODES: readonly string[] = ['HOLD_EXPIRED', 'HOLD_NOT_PAYABLE'];

/**
 * Numéro de réservation montré au voyageur pour le support (10b UX-27 ; PROPOSÉ, ADR-142) : les huit
 * premiers caractères de l'identifiant du hold, en majuscules (aucune donnée personnelle).
 */
export function bookingReference(holdId: string): string {
  return holdId.slice(0, 8).toUpperCase();
}

/** S06 du hold. */
export const paymentHref = (holdId: string): string => `/checkout/hold/${holdId}/payment`;
