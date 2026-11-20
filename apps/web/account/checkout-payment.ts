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
  'INTERRUPTED',
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

/**
 * États d'une demande à l'hôte rendus par l'API (US-223c, ADR-146 §9,
 * `core.booking_checkout_request`) ; un autre état ⇒ réponse refusée (fail-closed).
 */
export const REQUEST_STATUSES = [
  'AUTHORIZING',
  'AWAITING_HOST',
  'CAPTURING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CAPTURE_FAILED',
  'COMPENSATED',
  'ENDED',
] as const;
export type RequestStatusView = (typeof REQUEST_STATUSES)[number];

export interface PaymentRequestView {
  readonly status: RequestStatusView;
  /** Heure limite de réponse de l'hôte (base) ; `null` avant la preuve de l'autorisation. */
  readonly respondBy: string | null;
}

/**
 * Caution vue par le voyageur (US-701, ADR-169 ; 08 BR-PAY-06) : aucune, montant et libération, ou
 * réservation impossible avant le paiement. L'API ne rend jamais les déclencheurs (S-7).
 */
export type DepositView =
  | { readonly status: 'NONE' }
  | {
      readonly status: 'REQUIRED';
      readonly amountMinor: bigint;
      readonly currency: string;
      /** `HOLD` : blocage sur la carte ; `CHARGE` : débit puis remboursement. */
      readonly kind: 'HOLD' | 'CHARGE';
      readonly releaseAt: string;
    }
  | { readonly status: 'UNAVAILABLE'; readonly maxBookableDays: number | null };

export interface CheckoutPaymentView {
  readonly holdId: string;
  readonly state: PaymentStateView;
  readonly tripId: string | null;
  readonly expiresAt: string;
  readonly paymentInFlightUntil: string | null;
  /** Page hébergée du PSP (POST seulement) ; `null` : aucun ordre créé par cet appel. */
  readonly redirectUrl: string | null;
  /** Demande à l'hôte (hold `REQUEST`, US-223c) ; `null` : réservation immédiate. */
  readonly request: PaymentRequestView | null;
  /** Caution (US-701) ; `null` : ni figée ni évaluable (champ absent). */
  readonly deposit: DepositView | null;
  /**
   * US-703 (ADR-189 n° 15) : forme du consentement MIT du pays ; `null` : absente ou illisible (le
   * site affiche alors la case, la forme la plus explicite).
   */
  readonly mitConsentMode: 'NOTICE' | 'CHECKBOX' | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const instantOrNull = (v: unknown): string | null | undefined =>
  v === null ? null : typeof v === 'string' && INSTANT.test(v) ? v : undefined;

const DEPOSIT_MINOR = /^[1-9][0-9]{0,17}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * Champ `deposit` (US-701) : absent ⇒ `null` ; mal formé ou porteur d'un champ inattendu
 * (déclencheurs, âge…) ⇒ `undefined` (réponse refusée, fail-closed).
 */
function depositOf(v: unknown): DepositView | null | undefined {
  if (v === undefined) return null;
  if (!isObj(v)) return undefined;
  const keys = Object.keys(v).sort().join(',');
  switch (v['status']) {
    case 'NONE':
      return keys === 'status' ? { status: 'NONE' } : undefined;
    case 'REQUIRED': {
      const amount = v['amountMinor'];
      const currency = v['currency'];
      const kind = v['kind'];
      const releaseAt = v['releaseAt'];
      if (
        keys !== 'amountMinor,currency,kind,releaseAt,status' ||
        typeof amount !== 'string' ||
        !DEPOSIT_MINOR.test(amount) ||
        typeof currency !== 'string' ||
        !CURRENCY_CODE.test(currency) ||
        (kind !== 'HOLD' && kind !== 'CHARGE') ||
        typeof releaseAt !== 'string' ||
        !INSTANT.test(releaseAt)
      ) {
        return undefined;
      }
      return { status: 'REQUIRED', amountMinor: BigInt(amount), currency, kind, releaseAt };
    }
    case 'UNAVAILABLE': {
      const days = v['maxBookableDays'];
      if (keys !== 'maxBookableDays,status') return undefined;
      if (days === null) return { status: 'UNAVAILABLE', maxBookableDays: null };
      return typeof days === 'number' && Number.isSafeInteger(days) && days >= 0
        ? { status: 'UNAVAILABLE', maxBookableDays: days }
        : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Message du refus de la caution sur S05 (suite S-8 d'US-225 ; 10b UX-24) : au moins un jour
 * possible ⇒ `web.deposit.unavailable` (« tu peux réserver jusqu'à {count} jours ») ; 0 ou aucun
 * (montant non fixé) ⇒ `web.deposit.unavailableNone` (jamais « jusqu'à 0 jour »).
 */
export function depositRefusalMessage(deposit: DepositView & { readonly status: 'UNAVAILABLE' }):
  | { readonly key: 'web.deposit.unavailable'; readonly count: number }
  | {
      readonly key: 'web.deposit.unavailableNone';
    } {
  const days = deposit.maxBookableDays;
  return days !== null && days >= 1
    ? { key: 'web.deposit.unavailable', count: days }
    : { key: 'web.deposit.unavailableNone' };
}

/** Champ `request` du paiement : absent ⇒ `null` (réservation immédiate), mal formé ⇒ `undefined`. */
function requestOf(v: unknown): PaymentRequestView | null | undefined {
  if (v === undefined) return null;
  if (!isObj(v) || !(REQUEST_STATUSES as readonly unknown[]).includes(v['status'])) {
    return undefined;
  }
  const respondBy = instantOrNull(v['respondBy']);
  if (respondBy === undefined) return undefined;
  const status = v['status'] as RequestStatusView;
  // la base pose l'heure limite à la preuve de l'autorisation : jamais d'attente sans elle
  if ((status === 'AWAITING_HOST' || status === 'CAPTURING') && respondBy === null) {
    return undefined;
  }
  return { status, respondBy };
}

/**
 * Écrans dédiés du voyageur pour une demande à l'hôte (US-223 partie 223d, ADR-152 ; 10b S07
 * « Mode REQUEST : état `web.s07.request.pending` », S06, §4.3) ; `null` : l'état du paiement fait
 * foi (autorisation en cours ou refusée, réservation confirmée, remboursement, sortie avant
 * l'envoi).
 *
 * - `REQUEST_SENT` : autorisation prouvée, l'hôte n'a pas répondu (10b S07 « demande envoyée ») ;
 * - `REQUEST_CAPTURING` : acceptée, capture en attente de sa preuve (jamais « confirmé » avant le
 *   webhook) ;
 * - `REQUEST_DECLINED`, `REQUEST_EXPIRED` : autorisation annulée, aucun débit ;
 * - `REQUEST_CAPTURE_FAILED` : capture refusée ou non confirmée (`CAPTURE_UNCONFIRMED`), demande
 *   terminée, autorisation annulée.
 * Croisement fail-closed avec l'état du paiement : une demande n'est dite « envoyée » ou
 * « acceptée » que si l'API rend `VERIFYING` (aucun paiement possible), terminée que si elle rend
 * `ENDED` (aucun débit) ; toute autre combinaison garde l'écran de l'état du paiement.
 */
export type RequestScreen =
  | 'REQUEST_SENT'
  | 'REQUEST_CAPTURING'
  | 'REQUEST_DECLINED'
  | 'REQUEST_EXPIRED'
  | 'REQUEST_CAPTURE_FAILED';

export function requestScreenOf(payment: CheckoutPaymentView): RequestScreen | null {
  const r = payment.request;
  if (r === null) return null;
  if (payment.state === 'VERIFYING') {
    if (r.status === 'AWAITING_HOST') return 'REQUEST_SENT';
    if (r.status === 'CAPTURING') return 'REQUEST_CAPTURING';
    return null;
  }
  if (payment.state === 'ENDED') {
    if (r.status === 'DECLINED') return 'REQUEST_DECLINED';
    if (r.status === 'EXPIRED') return 'REQUEST_EXPIRED';
    if (r.status === 'CAPTURE_FAILED') return 'REQUEST_CAPTURE_FAILED';
  }
  return null;
}

/**
 * Créneau local `AAAA-MM-JJTHH:MM` d'un instant dans le fuseau du véhicule : dates d'une demande
 * refusée ou expirée reprises dans la recherche (10b §4.3 « Mira estos autos disponibles en tus
 * fechas ») ; `null` si l'instant ou le fuseau est invalide.
 */
export function localSlotOf(instant: string, timeZone: string): string | null {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms));
  } catch {
    return null;
  }
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const slot = `${v('year')}-${v('month')}-${v('day')}T${v('hour')}:${v('minute')}`;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(slot) ? slot : null;
}

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
  const request = requestOf(p['request']);
  if (request === undefined) return null;
  const deposit = depositOf(p['deposit']);
  if (deposit === undefined) return null;
  const redirectUrl =
    typeof url === 'string' && HOSTED.test(url) && url.length <= HOSTED_MAX ? url : null;
  const mit = p['mitConsent'];
  const mode = isObj(mit) ? mit['mode'] : undefined;
  const mitConsentMode = mode === 'NOTICE' || mode === 'CHECKBOX' ? mode : null;
  return {
    holdId,
    state: state as PaymentStateView,
    tripId: tripId as string | null,
    expiresAt,
    paymentInFlightUntil: inFlight,
    redirectUrl,
    request,
    deposit,
    mitConsentMode,
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
  // US-703 : consentement MIT absent (case non cochée)
  MIT_CONSENT_REQUIRED: 'common.payment.mitConsentRequired',
  HOLD_NOT_PAYABLE: 'common.payment.holdNotPayable',
  BOOKING_UNDER_REVIEW: 'common.payment.underReview',
  // US-701 (ADR-169) : caution impossible pour ces dates, ou montant non fixé
  DEPOSIT_RAIL_UNAVAILABLE: 'common.payment.depositUnavailable',
  DEPOSIT_PARAM_MISSING: 'common.payment.depositUnavailable',
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
