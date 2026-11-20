/**
 * Messages d'un trip côté site (US-525, ADR-181 ; 16 MSG-001 / MSG-007 ; 10b S16) : lecture
 * DÉFENSIVE de `GET /trips/{id}/messages` (toute forme inattendue ⇒ `null`, l'écran dit l'erreur,
 * jamais un fil partiel ou deviné) et des rappels de `POST /trips/{id}/messages`. Le texte reçu est
 * déjà MASQUÉ par la base (téléphones, courriels, identifiants, liens) ; seuls des prénoms
 * circulent. Côté serveur seulement ; jamais de texte de message dans une URL ni dans un journal.
 */
import type { ApiResult } from './api-client.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const VIEWER_ROLES = ['GUEST', 'HOST', 'CO_HOST'] as const;
export type ViewerRole = (typeof VIEWER_ROLES)[number];

/** Rappels montrés à l'expéditeur après un envoi signalé (réponse de l'API, US-525). */
export const NOTICES = ['CONTACT_MASKED', 'OFF_PLATFORM_PAYMENT'] as const;
export type Notice = (typeof NOTICES)[number];

/** Borne du texte (celle de l'API et de la base). */
export const MESSAGE_MAX_CHARS = 2000;

export interface TripMessage {
  readonly id: string;
  readonly mine: boolean;
  readonly authorRole: ViewerRole;
  readonly authorName: string | null;
  /** `null` : message masqué par l'équipe de soutien. */
  readonly body: string | null;
  readonly masked: boolean;
  readonly offPlatform: boolean;
  readonly sentAt: string;
  /** Texte effacé par la rétention (US-316) ; `body` est alors `null`. */
  readonly purged: boolean;
}

export interface TripThread {
  readonly tripId: string;
  readonly viewerRole: ViewerRole;
  readonly counterpartName: string | null;
  readonly writable: boolean;
  readonly closesAt: string | null;
  readonly timezone: string;
  readonly messages: readonly TripMessage[];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Fuseau IANA (« Region/Ville » ou « UTC ») ; jamais une chaîne libre. */
const ZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isRole = (v: unknown): v is ViewerRole =>
  typeof v === 'string' && (VIEWER_ROLES as readonly string[]).includes(v);
const textOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string';

function messageOf(v: unknown): TripMessage | null {
  if (!isRecord(v)) return null;
  const { id, mine, authorRole, authorName, body, masked, offPlatform, sentAt, purged } = v;
  if (
    typeof id !== 'string' ||
    !UUID.test(id) ||
    typeof mine !== 'boolean' ||
    !isRole(authorRole) ||
    !textOrNull(authorName) ||
    !textOrNull(body) ||
    typeof masked !== 'boolean' ||
    typeof offPlatform !== 'boolean' ||
    typeof sentAt !== 'string' ||
    !ISO.test(sentAt) ||
    typeof purged !== 'boolean'
  ) {
    return null;
  }
  return { id, mine, authorRole, authorName, body, masked, offPlatform, sentAt, purged };
}

/** Fil de la réponse 200 ; `null` si la réponse n'a pas la forme attendue ou un autre trip. */
export function tripThreadOf(reply: ApiResult, tripId: string): TripThread | null {
  if (reply.status !== 200 || !isRecord(reply.json)) return null;
  const j = reply.json;
  if (
    j['code'] !== 'TRIP_MESSAGES' ||
    j['tripId'] !== tripId ||
    !isRole(j['viewerRole']) ||
    !textOrNull(j['counterpartName']) ||
    typeof j['writable'] !== 'boolean' ||
    !(j['closesAt'] === null || (typeof j['closesAt'] === 'string' && ISO.test(j['closesAt']))) ||
    typeof j['timezone'] !== 'string' ||
    !ZONE.test(j['timezone']) ||
    !Array.isArray(j['messages'])
  ) {
    return null;
  }
  const messages: TripMessage[] = [];
  for (const m of j['messages']) {
    const parsed = messageOf(m);
    if (parsed === null) return null;
    messages.push(parsed);
  }
  return {
    tripId,
    viewerRole: j['viewerRole'],
    counterpartName: j['counterpartName'],
    writable: j['writable'],
    closesAt: j['closesAt'],
    timezone: j['timezone'],
    messages,
  };
}

/** Rappels d'une réponse 201 ; `null` si la réponse n'est pas un message enregistré. */
export function sentNoticesOf(reply: ApiResult): readonly Notice[] | null {
  if (reply.status !== 201 || !isRecord(reply.json) || reply.json['code'] !== 'MESSAGE_SENT') {
    return null;
  }
  const notices = reply.json['notices'];
  if (!Array.isArray(notices)) return null;
  const out: Notice[] = [];
  for (const n of notices) {
    if (typeof n !== 'string' || !(NOTICES as readonly string[]).includes(n)) return null;
    if (!out.includes(n as Notice)) out.push(n as Notice);
  }
  return out;
}

/** Rappels lus dans la requête de la page (`?n=CONTACT_MASKED.OFF_PLATFORM_PAYMENT`) ; inconnus ignorés. */
export function noticesFromQuery(value: string | string[] | undefined): readonly Notice[] {
  if (typeof value !== 'string') return [];
  return NOTICES.filter((n) => value.split('.').includes(n));
}

/** Chemin de l'écran S16 du voyageur (`guest`) ou de l'hôte (`host`) ; `null` si le trip est mal formé. */
export function threadPath(scope: 'guest' | 'host', tripId: string): string | null {
  if (!UUID.test(tripId)) return null;
  return scope === 'guest' ? `/trips/${tripId}/messages` : `/host/trips/${tripId}/messages`;
}
