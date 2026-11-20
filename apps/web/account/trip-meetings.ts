/**
 * Rendez-vous d'un trip côté site (US-316, ADR-186 ; 19 US-316 critère 4 ; 10b S16) : lecture
 * DÉFENSIVE de `GET /trips/{id}/meetings` (toute forme inattendue ⇒ `null`, l'écran dit l'erreur,
 * jamais un rendez-vous deviné) et des réponses de `POST /trips/{id}/meetings` et
 * `POST /trips/{id}/meetings/{meetingId}/answer`. Le lieu est déjà sans coordonnées (refusées par
 * la base) ; aucun nom ni contact ne circule. Côté serveur seulement ; jamais de lieu dans une URL
 * ni dans un journal.
 */
import type { ApiResult } from './api-client.ts';
import { UUID, VIEWER_ROLES } from './trip-messages.ts';
import type { ViewerRole } from './trip-messages.ts';

export const MEETING_KINDS = ['PICKUP', 'RETURN'] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

export const MEETING_STATUSES = ['PROPOSED', 'ACCEPTED', 'DECLINED'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/** Issue montrée après une proposition ou une réponse (`?mt=…`). */
export const MEETING_DONE = ['PROPOSED', 'ACCEPTED', 'DECLINED'] as const;
export type MeetingDone = (typeof MEETING_DONE)[number];

/** Refus de la réponse du voyageur montrés par l'écran (`?me=…`), avec leur texte. */
export const ANSWER_ERRORS = [
  'MEETING_NOT_PENDING',
  'MEETING_EXPIRED',
  'MEETING_NOT_ALLOWED',
  'MEETING_NOT_FOUND',
  'MESSAGES_UNAVAILABLE',
] as const;
export type AnswerError = (typeof ANSWER_ERRORS)[number];
export const ANSWER_ERROR_KEYS = {
  MEETING_NOT_PENDING: 'common.meetings.notPending',
  MEETING_EXPIRED: 'common.meetings.expired',
  MEETING_NOT_ALLOWED: 'common.meetings.notAllowed',
  MEETING_NOT_FOUND: 'common.meetings.notFound',
  MESSAGES_UNAVAILABLE: 'common.messages.unavailable',
} as const satisfies Readonly<Record<AnswerError, string>>;

/** Refus lu dans la requête de la page (`?me=…`) ; inconnu ⇒ `null`. */
export function answerErrorFromQuery(value: string | string[] | undefined): AnswerError | null {
  return typeof value === 'string' && member(ANSWER_ERRORS, value) ? value : null;
}

/** Bornes du lieu (celles de l'API et de la base). */
export const PLACE_MIN_CHARS = 3;
export const PLACE_MAX_CHARS = 160;

export interface TripMeeting {
  readonly id: string;
  readonly kind: MeetingKind;
  readonly place: string;
  readonly meetAt: string;
  readonly status: MeetingStatus;
  readonly mine: boolean;
}

export interface TripMeetings {
  readonly viewerRole: ViewerRole;
  readonly canPropose: boolean;
  readonly timezone: string;
  readonly meetings: readonly TripMeeting[];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/;
/** Valeur d'un champ `datetime-local` (minutes, sans fuseau). */
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const member = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

function meetingOf(v: unknown): TripMeeting | null {
  if (!isRecord(v)) return null;
  const { id, kind, place, meetAt, status, mine } = v;
  if (
    typeof id !== 'string' ||
    !UUID.test(id) ||
    !member(MEETING_KINDS, kind) ||
    typeof place !== 'string' ||
    place.length === 0 ||
    typeof meetAt !== 'string' ||
    !ISO.test(meetAt) ||
    !member(MEETING_STATUSES, status) ||
    typeof mine !== 'boolean'
  ) {
    return null;
  }
  return { id, kind, place, meetAt, status, mine };
}

/** Rendez-vous de la réponse 200 ; `null` si la réponse n'a pas la forme attendue ou un autre trip. */
export function tripMeetingsOf(reply: ApiResult, tripId: string): TripMeetings | null {
  if (reply.status !== 200 || !isRecord(reply.json)) return null;
  const j = reply.json;
  if (
    j['code'] !== 'TRIP_MEETINGS' ||
    j['tripId'] !== tripId ||
    !member(VIEWER_ROLES, j['viewerRole']) ||
    typeof j['canPropose'] !== 'boolean' ||
    typeof j['timezone'] !== 'string' ||
    !ZONE.test(j['timezone']) ||
    !Array.isArray(j['meetings'])
  ) {
    return null;
  }
  const meetings: TripMeeting[] = [];
  for (const m of j['meetings']) {
    const parsed = meetingOf(m);
    if (parsed === null) return null;
    meetings.push(parsed);
  }
  return {
    viewerRole: j['viewerRole'],
    canPropose: j['canPropose'],
    timezone: j['timezone'],
    meetings,
  };
}

/** Statut d'une réponse 201 (proposition) ou 200 (réponse) ; `null` sinon. */
export function meetingDoneOf(reply: ApiResult): MeetingDone | null {
  if (reply.status === 'unavailable') return null;
  if (!isRecord(reply.json) || !isRecord(reply.json['meeting'])) return null;
  const status = reply.json['meeting']['status'];
  if (reply.status === 201 && reply.json['code'] === 'MEETING_PROPOSED') {
    // réessai : la proposition d'origine, quel que soit son état actuel
    return typeof status === 'string' ? 'PROPOSED' : null;
  }
  if (reply.status === 200 && reply.json['code'] === 'MEETING_ANSWERED') {
    return status === 'ACCEPTED' || status === 'DECLINED' ? status : null;
  }
  return null;
}

/** Issue lue dans la requête de la page (`?mt=ACCEPTED`) ; inconnue ⇒ `null`. */
export function meetingDoneFromQuery(value: string | string[] | undefined): MeetingDone | null {
  return typeof value === 'string' && member(MEETING_DONE, value) ? value : null;
}

/** Décalage (ms) du fuseau `zone` à l'instant `utcMs` : heure murale − UTC. */
function offsetMs(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const n = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return wall - utcMs;
}

/**
 * Heure murale d'un champ `datetime-local` (« 2035-06-10T09:30 ») au fuseau IANA du trip ⇒ instant
 * ISO en UTC ; `null` si la valeur ou le fuseau sont mal formés. Deux passes : le décalage relu à
 * l'instant trouvé (changement d'heure).
 */
export function localToUtc(local: string, zone: string): string | null {
  const m = LOCAL.exec(local);
  if (m === null || !ZONE.test(zone)) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  try {
    let utc = wall - offsetMs(wall, zone);
    utc = wall - offsetMs(utc, zone);
    const iso = new Date(utc).toISOString();
    return ISO.test(iso) ? iso : null;
  } catch {
    return null; // fuseau inconnu de l'environnement
  }
}
