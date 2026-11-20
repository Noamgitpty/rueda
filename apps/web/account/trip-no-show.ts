/**
 * No-show entre particuliers côté site (US-307, ADR-191 ; 16 TRP-015 ; 19 US-307) : lecture
 * DÉFENSIVE de `GET /trips/{id}/no-show` (toute forme inattendue ⇒ `null`, l'écran dit l'erreur,
 * jamais un état partiel) et liens des écrans. L'hôte déclare le voyageur absent, le voyageur
 * signale l'hôte absent : la partie absente est jugée par la base, jamais choisie ici. Le site
 * n'envoie jamais d'heure ni de montant ; jamais de donnée personnelle dans une URL ni un journal.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';
import { messageKeyOf } from './host-listings.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export type NoShowRole = 'HOST' | 'GUEST';
export type DeclarationStatus = 'AWAITING_REVIEW' | 'PENDING' | 'SETTLED' | 'FIN_REVIEW' | 'FAILED';

/** Obstacles possibles (codes de l'API, 16 TRP-015 et PROPOSÉS d'ADR-191). */
export const BLOCKERS = [
  'CHECKIN_NOT_OPEN',
  'NO_SHOW_NOT_ALLOWED',
  'NO_SHOW_TOO_EARLY',
  'NO_SHOW_WINDOW_CLOSED',
  'NO_SHOW_PARTY_PRESENT',
  'NO_SHOW_EVIDENCE_REQUIRED',
  'CANCELLATION_PENDING',
  'NO_SHOW_NOT_FOUND',
  'NO_SHOW_UNAVAILABLE',
] as const;
export type NoShowBlocker = (typeof BLOCKERS)[number];

/** Texte d'un obstacle (catalogue `common.noShow.*`, mêmes textes que les refus de l'API). */
export const BLOCKER_KEYS: Readonly<Record<NoShowBlocker, MessageKey>> = {
  CHECKIN_NOT_OPEN: 'common.noShow.checkinNotOpen',
  NO_SHOW_NOT_ALLOWED: 'common.noShow.notAllowed',
  NO_SHOW_TOO_EARLY: 'common.noShow.tooEarly',
  NO_SHOW_WINDOW_CLOSED: 'common.noShow.windowClosed',
  NO_SHOW_PARTY_PRESENT: 'common.noShow.partyPresent',
  NO_SHOW_EVIDENCE_REQUIRED: 'common.noShow.evidenceRequired',
  CANCELLATION_PENDING: 'common.noShow.pending',
  NO_SHOW_NOT_FOUND: 'common.noShow.notFound',
  NO_SHOW_UNAVAILABLE: 'common.noShow.unavailable',
};

export interface TripNoShowView {
  readonly tripId: string;
  readonly viewerRole: NoShowRole;
  readonly absentParty: NoShowRole;
  readonly tripStatus: string;
  /** Fuseau IANA du trip (heure serveur affichée). */
  readonly timezone: string;
  readonly scheduledStart: string;
  readonly declarableFrom: string | null;
  readonly declarableUntil: string | null;
  readonly canDeclare: boolean;
  readonly blocker: NoShowBlocker | null;
  readonly messageTraced: boolean;
  readonly declaration: {
    readonly id: string;
    readonly requestedReason: string;
    readonly status: DeclarationStatus;
    readonly requestedAt: string;
    readonly mine: boolean;
  } | null;
}

const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isRole = (v: unknown): v is NoShowRole => v === 'HOST' || v === 'GUEST';
const isTime = (v: unknown): v is string => typeof v === 'string' && ISO.test(v);
const isTimeOrNull = (v: unknown): v is string | null => v === null || isTime(v);
const STATUSES: readonly unknown[] = [
  'AWAITING_REVIEW',
  'PENDING',
  'SETTLED',
  'FIN_REVIEW',
  'FAILED',
];

/** Vue de l'API, lue strictement ; `null` si la forme surprend (jamais un état deviné). */
export function tripNoShowOf(reply: ApiResult): TripNoShowView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const { viewerRole, absentParty, blocker } = j;
  if (
    typeof j['tripId'] !== 'string' ||
    !UUID.test(j['tripId']) ||
    !isRole(viewerRole) ||
    !isRole(absentParty) ||
    viewerRole === absentParty ||
    typeof j['tripStatus'] !== 'string' ||
    typeof j['timezone'] !== 'string' ||
    j['timezone'] === '' ||
    !isTime(j['scheduledStart']) ||
    !isTimeOrNull(j['declarableFrom']) ||
    !isTimeOrNull(j['declarableUntil']) ||
    typeof j['canDeclare'] !== 'boolean' ||
    typeof j['messageTraced'] !== 'boolean' ||
    (blocker !== null && !(BLOCKERS as readonly unknown[]).includes(blocker)) ||
    j['canDeclare'] !== (blocker === null)
  ) {
    return null;
  }
  let declaration: TripNoShowView['declaration'] = null;
  const d = j['declaration'];
  if (d !== null) {
    if (
      !isObj(d) ||
      typeof d['id'] !== 'string' ||
      !UUID.test(d['id']) ||
      typeof d['requestedReason'] !== 'string' ||
      !STATUSES.includes(d['status']) ||
      !isTime(d['requestedAt']) ||
      typeof d['mine'] !== 'boolean'
    ) {
      return null;
    }
    declaration = {
      id: d['id'],
      requestedReason: d['requestedReason'],
      status: d['status'] as DeclarationStatus,
      requestedAt: d['requestedAt'],
      mine: d['mine'],
    };
  }
  return {
    tripId: j['tripId'],
    viewerRole,
    absentParty,
    tripStatus: j['tripStatus'],
    timezone: j['timezone'],
    scheduledStart: j['scheduledStart'],
    declarableFrom: j['declarableFrom'],
    declarableUntil: j['declarableUntil'],
    canDeclare: j['canDeclare'],
    blocker: blocker as NoShowBlocker | null,
    messageTraced: j['messageTraced'],
    declaration,
  };
}

/** Texte du motif d'une demande (le no-show de l'une ou l'autre partie, ou une autre annulation). */
export function reasonKey(requestedReason: string): MessageKey {
  if (requestedReason === 'GUEST_NO_SHOW') return 'web.noShow.reason.GUEST_NO_SHOW';
  if (requestedReason === 'HOST_NO_SHOW') return 'web.noShow.reason.HOST_NO_SHOW';
  return 'web.noShow.reason.other';
}

/** Page du no-show, reconstruite (jamais une adresse reçue d'un formulaire). */
export function noShowHref(role: string, tripId: string, org: string): string {
  return role === 'HOST'
    ? `/host/trips/${tripId}/no-show${UUID.test(org) ? `?org=${org}` : ''}`
    : `/trips/${tripId}/no-show`;
}

/** Fil des messages du trip (preuve de l'attente, US-525). */
export function messagesHref(role: NoShowRole, tripId: string, org: string | null): string {
  return role === 'HOST'
    ? `/host/trips/${tripId}/messages${org === null ? '' : `?org=${org}`}`
    : `/trips/${tripId}/messages`;
}

/** Les états où la page du no-show est proposée depuis le détail du trip. */
export function noShowOffered(status: string): boolean {
  return status === 'CHECKIN_OPEN' || status === 'START_WINDOW_EXPIRED';
}

/** Clé du refus d'une réponse de l'API ; sans réseau : « réessayer ». */
export function noShowFailureKey(reply: ApiResult): MessageKey {
  if (reply.status === 'unavailable') return 'common.noShow.unavailable';
  return messageKeyOf(reply) ?? 'common.error.server';
}
