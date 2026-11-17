/**
 * Demandes de réservation de l'hôte (US-223 partie 223d, ADR-152 ; routes de 223c, ADR-146 §10 ;
 * 16 HDB-002 ; 10b A05 `web.a05.accept` / `web.a05.decline`), côté SERVEUR du site seulement :
 * lecture défensive de `GET /host/accounts/{orgId}/requests[/{holdId}]` et des décisions
 * (`POST …/accept`, `POST …/decline`). Une réponse mal formée est refusée en bloc (`null`) : l'écran
 * affiche son état d'erreur, jamais une donnée partielle. Aucun montant n'est calculé ni envoyé : le
 * total et la jambe HOST sont relus tels quels (unités mineures, `bigint`) ; l'exposant de la devise
 * vient du marché du compte (`GET …/listings`), jamais d'une constante de pays.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';
import { codeOf } from './api-client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^[0-9]{1,18}$/;
const CURRENCY = /^[A-Z]{3}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

export const HOST_REQUEST_STATUSES = ['AWAITING_HOST', 'CAPTURING'] as const;
export type HostRequestStatus = (typeof HOST_REQUEST_STATUSES)[number];

export interface HostRequestView {
  readonly holdId: string;
  /** `AWAITING_HOST` : à accepter ou refuser ; `CAPTURING` : acceptée, paiement en cours. */
  readonly status: HostRequestStatus;
  readonly vehicleId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly timezone: string;
  /** Heure limite de réponse, posée par la base (jamais calculée ici). */
  readonly respondBy: string;
  readonly currency: string;
  readonly totalMinor: bigint;
  /** Jambe HOST du devis engagé (gains estimés) ; `null` si inconnue. */
  readonly hostLegMinor: bigint | null;
  readonly guest: {
    readonly firstName: string | null;
    readonly ageYears: number | null;
    readonly rating: number | null;
    readonly verified: boolean;
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInstant = (v: unknown): v is string => typeof v === 'string' && INSTANT.test(v);
const isZone = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(v);

function requestOf(r: unknown): HostRequestView | null {
  if (!isObj(r) || !isObj(r['guest'])) return null;
  const g = r['guest'];
  const first = g['firstName'];
  const age = g['ageYears'];
  const rating = g['rating'];
  const hostLeg = r['hostLegMinor'];
  if (
    typeof r['holdId'] !== 'string' ||
    !UUID.test(r['holdId']) ||
    !(HOST_REQUEST_STATUSES as readonly unknown[]).includes(r['status']) ||
    typeof r['vehicleId'] !== 'string' ||
    !UUID.test(r['vehicleId']) ||
    !isInstant(r['scheduledStart']) ||
    !isInstant(r['scheduledEnd']) ||
    Date.parse(r['scheduledEnd']) <= Date.parse(r['scheduledStart']) ||
    !isZone(r['timezone']) ||
    !isInstant(r['respondBy']) ||
    typeof r['currency'] !== 'string' ||
    !CURRENCY.test(r['currency']) ||
    typeof r['totalMinor'] !== 'string' ||
    !MINOR.test(r['totalMinor']) ||
    !(hostLeg === null || (typeof hostLeg === 'string' && MINOR.test(hostLeg))) ||
    !(first === null || (typeof first === 'string' && first.length <= 80)) ||
    !(age === null || (typeof age === 'number' && Number.isInteger(age) && age >= 0)) ||
    !(rating === null || (typeof rating === 'number' && Number.isFinite(rating))) ||
    typeof g['verified'] !== 'boolean'
  ) {
    return null;
  }
  return {
    holdId: r['holdId'],
    status: r['status'] as HostRequestStatus,
    vehicleId: r['vehicleId'],
    startsAt: r['scheduledStart'],
    endsAt: r['scheduledEnd'],
    timezone: r['timezone'],
    respondBy: r['respondBy'],
    currency: r['currency'],
    totalMinor: BigInt(r['totalMinor']),
    hostLegMinor: hostLeg === null ? null : BigInt(hostLeg as string),
    guest: {
      firstName: first as string | null,
      ageYears: age as number | null,
      rating: rating as number | null,
      verified: g['verified'],
    },
  };
}

/** `GET …/requests` ; `null` si la réponse est illisible ou refusée. */
export function hostRequestsOf(reply: ApiResult): readonly HostRequestView[] | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['requests'])) {
    return null;
  }
  const out: HostRequestView[] = [];
  for (const r of reply.json['requests'] as unknown[]) {
    const v = requestOf(r);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

/** `GET …/requests/{holdId}` ; `null` si la réponse est illisible ou refusée. */
export function hostRequestOf(reply: ApiResult): HostRequestView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  return requestOf(reply.json['request']);
}

/** Issue d'une décision de l'hôte (`POST …/accept|decline`, 200). */
export const DECISION_STATUSES = ['CAPTURING', 'ACCEPTED', 'DECLINED'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export function decisionOf(reply: ApiResult, holdId: string): DecisionStatus | null {
  if (reply.status !== 200 || !isObj(reply.json) || !isObj(reply.json['decision'])) return null;
  const d = reply.json['decision'];
  if (d['holdId'] !== holdId) return null;
  return (DECISION_STATUSES as readonly unknown[]).includes(d['status'])
    ? (d['status'] as DecisionStatus)
    : null;
}

/**
 * Codes stables des routes des demandes (ADR-146 §10, `HOST_REQUEST_MESSAGES` de l'API) → clé du
 * catalogue (es, en, fr, pt-BR). Un code inconnu ou une API injoignable donne un message générique
 * (fail-closed) : la demande n'est jamais dite traitée.
 */
const REQUEST_KEYS: Readonly<Record<string, MessageKey>> = {
  REQUEST_NOT_FOUND: 'common.request.notFound',
  REQUEST_EXPIRED: 'common.request.expired',
  INVALID_TRANSITION: 'common.request.alreadyAnswered',
  TERMS_REACCEPT_REQUIRED: 'common.request.hostTermsRequired',
  GUEST_NOT_ELIGIBLE: 'common.request.guestNotEligible',
  START_PASSED: 'common.request.startPassed',
  LEG_SUM_MISMATCH: 'common.request.amountMismatch',
  PAYMENT_UNAVAILABLE: 'common.request.paymentUnavailable',
  BOOKING_UNAVAILABLE: 'common.request.unavailable',
  RATE_LIMITED: 'common.rateLimit.retryLater',
};

export function requestErrorKey(reply: ApiResult): MessageKey {
  const code = codeOf(reply);
  const key = code === null ? undefined : REQUEST_KEYS[code];
  return key ?? 'common.request.unavailable';
}

/** Codes connus (tests) ; chacun a sa clé dans les quatre catalogues (typecheck). */
export const REQUEST_ERROR_CODES: readonly string[] = Object.keys(REQUEST_KEYS);

/** Numéro montré à l'hôte : celui que voit le voyageur sur S06 (8 premiers caractères du hold). */
export const requestReference = (holdId: string): string => holdId.slice(0, 8).toUpperCase();

export const requestHref = (
  orgId: string,
  holdId: string,
  confirm?: 'accept' | 'decline',
): string =>
  `/host/requests/${holdId}?${new URLSearchParams({
    org: orgId,
    ...(confirm === undefined ? {} : { confirm }),
  }).toString()}`;
