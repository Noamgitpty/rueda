/**
 * Amendes, péages et fourrières refacturés au voyageur (suite d'US-318, 0181, ADR-201, PROPOSÉ
 * « comme Turo » ; 08 BR-TT-02 : 48 h pour payer ou contester ; 10b S12) : lecture DÉFENSIVE de
 * `GET /trips/{id}/traffic-charges` (toute forme inattendue ⇒ `null`, l'écran dit l'erreur, jamais
 * un état partiel), textes des états, lien de l'écran. Aucun montant n'est calculé ici (l'API rend
 * montant, frais et total en unités mineures) ; aucune heure n'est envoyée ; aucun débit avant la
 * réponse du voyageur ou l'échéance. Jamais de donnée personnelle dans une URL ni un journal.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';
import { messageKeyOf } from './host-listings.ts';
import {
  TRAFFIC_EXECUTION_STATUSES,
  TRAFFIC_GUEST_STATUSES,
  TRAFFIC_KINDS,
  TRAFFIC_REFERENCE,
  UUID,
} from './trip-claims.ts';
import type { TrafficExecutionStatus, TrafficGuestStatus, TrafficKind } from './trip-claims.ts';
import type { SlotGroup } from './trip-incidental.ts';

const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const SLOT = /^[A-Z][A-Z0-9_]{1,31}$/;

/** Motif de la contestation (20 à 1 000 caractères) et photos du trip jointes (0 à 10), comme l'API. */
export const TRAFFIC_DISPUTE_MIN = 20;
export const TRAFFIC_DISPUTE_MAX = 1000;
export const TRAFFIC_EVIDENCE_MAX = 10;

export interface TrafficGuestCharge {
  readonly id: string;
  readonly kind: TrafficKind;
  readonly occurredAt: string;
  readonly reference: string;
  readonly amountMinor: string;
  readonly adminFeeMinor: string;
  readonly totalMinor: string;
  readonly declaredAt: string;
  readonly responseDueAt: string;
  readonly status: TrafficGuestStatus;
  readonly executionStatus: TrafficExecutionStatus;
  readonly canRespond: boolean;
  readonly disputeReason: string | null;
  readonly decidedAt: string | null;
  readonly decisionRationale: string | null;
}

export interface TrafficGuestPhoto {
  readonly fileId: string;
  readonly kind: 'CHECKIN' | 'CHECKOUT';
  readonly slot: string;
  readonly takenBy: 'HOST' | 'GUEST';
  readonly receivedAt: string;
}

export interface TrafficGuestView {
  readonly tripId: string;
  readonly currency: string;
  readonly charges: readonly TrafficGuestCharge[];
  /** Photos du trip proposées comme pièces d'une contestation (tant qu'une réponse est possible). */
  readonly photos: readonly TrafficGuestPhoto[];
}

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isTimeOrNull = (v: unknown): v is string | null => v === null || isTime(v);
const isTextOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';
const has = <T extends string>(list: readonly T[], v: unknown): v is T =>
  (list as readonly unknown[]).includes(v);

function chargeOf(c: unknown): TrafficGuestCharge | null {
  if (!isObj(c)) return null;
  const disputeReason = c['disputeReason'] ?? null;
  const decidedAt = c['decidedAt'] ?? null;
  const decisionRationale = c['decisionRationale'] ?? null;
  if (
    typeof c['id'] !== 'string' ||
    !UUID.test(c['id']) ||
    !has(TRAFFIC_KINDS, c['kind']) ||
    !isTime(c['occurredAt']) ||
    typeof c['reference'] !== 'string' ||
    !TRAFFIC_REFERENCE.test(c['reference']) ||
    ['amountMinor', 'adminFeeMinor', 'totalMinor'].some(
      (k) => typeof c[k] !== 'string' || !MINOR.test(c[k] as string),
    ) ||
    !isTime(c['declaredAt']) ||
    !isTime(c['responseDueAt']) ||
    !has(TRAFFIC_GUEST_STATUSES, c['status']) ||
    !has(TRAFFIC_EXECUTION_STATUSES, c['executionStatus']) ||
    typeof c['canRespond'] !== 'boolean' ||
    !isTextOrNull(disputeReason) ||
    !isTimeOrNull(decidedAt) ||
    !isTextOrNull(decisionRationale)
  ) {
    return null;
  }
  return {
    id: c['id'],
    kind: c['kind'],
    occurredAt: c['occurredAt'],
    reference: c['reference'],
    amountMinor: c['amountMinor'] as string,
    adminFeeMinor: c['adminFeeMinor'] as string,
    totalMinor: c['totalMinor'] as string,
    declaredAt: c['declaredAt'],
    responseDueAt: c['responseDueAt'],
    status: c['status'],
    executionStatus: c['executionStatus'],
    // une réponse n'est proposée que pour une refacturation en attente (jamais déduit d'un autre état)
    canRespond: c['canRespond'] && c['status'] === 'AWAITING_GUEST',
    disputeReason,
    decidedAt,
    decisionRationale,
  };
}

function photoOf(p: unknown): TrafficGuestPhoto | null {
  if (
    !isObj(p) ||
    typeof p['fileId'] !== 'string' ||
    !UUID.test(p['fileId']) ||
    (p['kind'] !== 'CHECKIN' && p['kind'] !== 'CHECKOUT') ||
    typeof p['slot'] !== 'string' ||
    !SLOT.test(p['slot']) ||
    (p['takenBy'] !== 'HOST' && p['takenBy'] !== 'GUEST') ||
    !isTime(p['receivedAt'])
  ) {
    return null;
  }
  return {
    fileId: p['fileId'],
    kind: p['kind'],
    slot: p['slot'],
    takenBy: p['takenBy'],
    receivedAt: p['receivedAt'],
  };
}

/** Refacturations du trip vues par son voyageur (200) ; `null` si la forme surprend. */
export function trafficGuestOf(reply: ApiResult, tripId: string): TrafficGuestView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  if (
    j['tripId'] !== tripId ||
    typeof j['currency'] !== 'string' ||
    !/^[A-Z]{3}$/.test(j['currency']) ||
    !Array.isArray(j['charges']) ||
    !Array.isArray(j['photos'])
  ) {
    return null;
  }
  const charges = (j['charges'] as unknown[]).map(chargeOf);
  const photos = (j['photos'] as unknown[]).map(photoOf);
  if (charges.some((c) => c === null) || photos.some((p) => p === null)) return null;
  return {
    tripId,
    currency: j['currency'],
    charges: charges as TrafficGuestCharge[],
    photos: photos as TrafficGuestPhoto[],
  };
}

/** Groupe d'un emplacement de photo d'état (texte affiché) ; inconnu ⇒ `null` (« autre photo »). */
export function slotGroupOf(slot: string): SlotGroup | null {
  if (/^EXT_[0-9]{2}$/.test(slot)) return 'EXTERIOR';
  if (/^INT_[0-9]{2}$/.test(slot)) return 'INTERIOR';
  if (/^DAMAGE_[0-9]{2}$/.test(slot)) return 'DAMAGE';
  if (slot === 'FUEL' || slot === 'ODOMETER' || slot === 'KEY') return slot;
  return null;
}

/**
 * Texte de l'état d'une refacturation pour le voyageur : en attente et échéance non passée ⇒
 * « réponds avant… » ; en attente et échéance passée ⇒ ce qui va se passer ; sinon la réponse ou la
 * décision. L'heure du rendu dit seulement si l'échéance est passée : la base fait foi.
 */
export function trafficGuestStatusKey(c: TrafficGuestCharge, nowMs: number): MessageKey {
  switch (c.status) {
    case 'AWAITING_GUEST':
      return c.canRespond && nowMs < Date.parse(c.responseDueAt)
        ? 'web.trafficGuest.due'
        : 'web.trafficGuest.status.EXPIRED';
    case 'ACCEPTED':
      return 'web.trafficGuest.status.ACCEPTED';
    case 'DISPUTED':
      return 'web.trafficGuest.status.DISPUTED';
    case 'DECIDED_CHARGE':
      return 'web.trafficGuest.status.DECIDED_CHARGE';
    case 'REJECTED':
      return 'web.trafficGuest.status.REJECTED';
  }
}

export const TRAFFIC_GUEST_TONE: Readonly<
  Record<TrafficGuestStatus, 'info' | 'success' | 'warning' | 'danger'>
> = {
  AWAITING_GUEST: 'info',
  ACCEPTED: 'success',
  DISPUTED: 'warning',
  DECIDED_CHARGE: 'info',
  REJECTED: 'success',
};

/**
 * Texte de la réponse du voyageur vue par l'hôte (A09) : en attente avant l'échéance, sans réponse
 * après l'échéance, payée, contestée, décidée ou rejetée ; `null` : refacturation antérieure à 0181.
 */
export function trafficHostAnswerKey(
  c: { readonly guestStatus: TrafficGuestStatus | null; readonly responseDueAt: string | null },
  nowMs: number,
): MessageKey | null {
  switch (c.guestStatus) {
    case null:
      return null;
    case 'AWAITING_GUEST':
      if (c.responseDueAt === null) return null;
      return nowMs < Date.parse(c.responseDueAt)
        ? 'web.traffic.guest.AWAITING_GUEST'
        : 'web.traffic.guest.expired';
    case 'ACCEPTED':
      return 'web.traffic.guest.ACCEPTED';
    case 'DISPUTED':
      return 'web.traffic.guest.DISPUTED';
    case 'DECIDED_CHARGE':
      return 'web.traffic.guest.DECIDED_CHARGE';
    case 'REJECTED':
      return 'web.traffic.guest.REJECTED';
  }
}

/** Résultat affiché après une réponse (paramètre `done` reconstruit, jamais un texte reçu). */
export const TRAFFIC_DONE = ['accepted', 'disputed'] as const;
export type TrafficDone = (typeof TRAFFIC_DONE)[number];
export const TRAFFIC_DONE_KEYS: Readonly<Record<TrafficDone, MessageKey>> = {
  accepted: 'web.trafficGuest.done.accepted',
  disputed: 'web.trafficGuest.done.disputed',
};
export const trafficDoneOf = (v: unknown): TrafficDone | null =>
  typeof v === 'string' && (TRAFFIC_DONE as readonly string[]).includes(v)
    ? (v as TrafficDone)
    : null;

/** Page du voyageur, reconstruite (jamais une adresse reçue d'un formulaire). */
export function trafficGuestHref(tripId: string, done?: TrafficDone): string {
  const base = `/trips/${tripId}/traffic-charges`;
  return done === undefined ? base : `${base}?done=${done}`;
}

/** États du trip où la page est proposée au voyageur (après le retour, comme les frais annexes). */
export function trafficOffered(status: string): boolean {
  return (
    status === 'RETURNED' ||
    status === 'POST_TRIP' ||
    status === 'COMPLETED' ||
    status === 'IN_DISPUTE'
  );
}

/** Clé du refus d'une réponse de l'API ; sans réseau : indisponible. */
export function trafficFailureKey(reply: ApiResult): MessageKey {
  if (reply.status === 'unavailable') return 'common.tripClaims.unavailable';
  return messageKeyOf(reply) ?? 'common.error.server';
}
