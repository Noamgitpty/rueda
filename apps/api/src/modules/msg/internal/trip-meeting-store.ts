/**
 * Magasin des rendez-vous d'un trip (US-316, ADR-186) : port et lecture STRICTE des lignes de la
 * base (fonctions `core.messaging_meeting_read`, `core.messaging_cmd_propose_meeting` et
 * `core.messaging_cmd_answer_meeting` de 0166, SECURITY DEFINER, EXECUTE au seul `app_api`). La
 * base juge la partie du trip de la SESSION, refuse un lieu qui porte des coordonnées, borne
 * l'heure par le trip et émet `trip.meeting.confirmed` à l'acceptation ; l'API ne fait que
 * traduire. Toute forme inattendue ⇒ erreur (fail-closed). Aucune erreur ne porte un lieu :
 * SQLSTATE seulement.
 */
import { TripMessageStoreError, VIEWER_ROLES } from './trip-message-store.js';
import type { MsgSqlExecutor, ViewerRole } from './trip-message-store.js';

export const MEETING_KINDS = ['PICKUP', 'RETURN'] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

/** États servis (les propositions remplacées et purgées ne sont pas rendues par la base). */
export const MEETING_STATUSES = ['PROPOSED', 'ACCEPTED', 'DECLINED'] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_DECISIONS = ['ACCEPT', 'DECLINE'] as const;
export type MeetingDecision = (typeof MEETING_DECISIONS)[number];

export interface StoredMeeting {
  readonly id: string;
  readonly kind: MeetingKind;
  /** Lieu convenu, sans coordonnées (refusées par la base). */
  readonly place: string;
  readonly meetAt: Date;
  readonly status: MeetingStatus;
  /** Proposée ou répondue par la personne de la session. */
  readonly mine: boolean;
  readonly createdAt: Date;
  readonly answeredAt: Date | null;
}

export type MeetingsReadResult =
  | {
      readonly outcome: 'DONE';
      readonly viewerRole: ViewerRole;
      readonly canPropose: boolean;
      readonly timezone: string;
      readonly meetings: readonly StoredMeeting[];
    }
  | { readonly outcome: 'AUTH_REQUIRED' | 'NOT_FOUND' };

export type ProposeResult =
  | {
      readonly outcome: 'DONE';
      readonly id: string;
      readonly kind: MeetingKind;
      readonly place: string;
      readonly meetAt: Date;
      readonly status: 'PROPOSED' | 'ACCEPTED' | 'DECLINED' | 'SUPERSEDED';
    }
  | {
      readonly outcome:
        | 'AUTH_REQUIRED'
        | 'NOT_FOUND'
        | 'MEETING_NOT_ALLOWED'
        | 'MEETING_INVALID'
        | 'MEETING_PLACE_CONTACT'
        | 'REQUEST_INVALID';
    };

export type AnswerResult =
  | {
      readonly outcome: 'DONE';
      readonly id: string;
      readonly kind: MeetingKind;
      readonly meetAt: Date;
      readonly status: 'ACCEPTED' | 'DECLINED';
    }
  | {
      readonly outcome:
        | 'AUTH_REQUIRED'
        | 'NOT_FOUND'
        | 'MEETING_NOT_ALLOWED'
        | 'MEETING_NOT_PENDING'
        | 'MEETING_EXPIRED'
        | 'REQUEST_INVALID';
    };

export interface TripMeetingStore {
  read(proof: Buffer, tripId: string): Promise<MeetingsReadResult>;
  propose(
    proof: Buffer,
    tripId: string,
    meetingId: string,
    kind: MeetingKind,
    place: string,
    meetAt: Date,
  ): Promise<ProposeResult>;
  answer(
    proof: Buffer,
    tripId: string,
    meetingId: string,
    decision: MeetingDecision,
  ): Promise<AnswerResult>;
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableTripMeetingStore implements TripMeetingStore {
  read(): Promise<MeetingsReadResult> {
    return Promise.reject(new TripMessageStoreError('meetings', undefined));
  }

  propose(): Promise<ProposeResult> {
    return Promise.reject(new TripMessageStoreError('propose', undefined));
  }

  answer(): Promise<AnswerResult> {
    return Promise.reject(new TripMessageStoreError('answer', undefined));
  }
}

export const MEETINGS_SQL = 'SELECT * FROM core.messaging_meeting_read($1, $2::uuid)';
export const PROPOSE_SQL =
  'SELECT * FROM core.messaging_cmd_propose_meeting($1, $2::uuid, $3::uuid, $4, $5, $6::timestamptz)';
export const ANSWER_SQL =
  'SELECT * FROM core.messaging_cmd_answer_meeting($1, $2::uuid, $3::uuid, $4)';

const READ_REFUSALS = ['AUTH_REQUIRED', 'NOT_FOUND'] as const;
const PROPOSE_REFUSALS = [
  'AUTH_REQUIRED',
  'NOT_FOUND',
  'MEETING_NOT_ALLOWED',
  'MEETING_INVALID',
  'MEETING_PLACE_CONTACT',
  'REQUEST_INVALID',
] as const;
const ANSWER_REFUSALS = [
  'AUTH_REQUIRED',
  'NOT_FOUND',
  'MEETING_NOT_ALLOWED',
  'MEETING_NOT_PENDING',
  'MEETING_EXPIRED',
  'REQUEST_INVALID',
] as const;
const PROPOSED_STATUSES = ['PROPOSED', 'ACCEPTED', 'DECLINED', 'SUPERSEDED'] as const;
const ANSWERED_STATUSES = ['ACCEPTED', 'DECLINED'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/;

const shape = (operation: string): TripMessageStoreError =>
  new TripMessageStoreError(`${operation}: forme`, undefined);

function member<T extends string>(list: readonly T[], value: unknown, operation: string): T {
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  throw new TripMessageStoreError(`${operation}: issue inconnue`, undefined);
}

function bool(value: unknown, operation: string): boolean {
  if (typeof value !== 'boolean') throw shape(operation);
  return value;
}

function date(value: unknown, operation: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw shape(operation);
  return value;
}

function uuidOf(value: unknown, operation: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw shape(operation);
  return value;
}

function placeOf(value: unknown, operation: string): string {
  if (typeof value !== 'string' || value.length === 0) throw shape(operation);
  return value;
}

/** Lignes de `core.messaging_meeting_read` : en-tête répété, une ligne par rendez-vous (ou aucune). */
export function meetingsOf(rows: readonly Record<string, unknown>[]): MeetingsReadResult {
  const [head] = rows;
  if (head === undefined) throw new TripMessageStoreError('meetings: aucune ligne', undefined);
  if (head['outcome'] !== 'DONE') {
    if (rows.length !== 1) throw shape('meetings');
    return { outcome: member(READ_REFUSALS, head['outcome'], 'meetings') };
  }
  const viewerRole = member(VIEWER_ROLES, head['viewer_role'], 'meetings');
  const canPropose = bool(head['can_propose'], 'meetings');
  const timezone = head['timezone'];
  if (typeof timezone !== 'string' || !ZONE.test(timezone)) throw shape('meetings');
  const meetings: StoredMeeting[] = [];
  for (const r of rows) {
    if (
      r['outcome'] !== 'DONE' ||
      r['viewer_role'] !== viewerRole ||
      r['can_propose'] !== canPropose ||
      r['timezone'] !== timezone
    ) {
      throw new TripMessageStoreError('meetings: en-tête incohérent', undefined);
    }
    if (r['meeting_id'] === null) {
      if (rows.length !== 1) throw shape('meetings');
      continue;
    }
    meetings.push({
      id: uuidOf(r['meeting_id'], 'meetings'),
      kind: member(MEETING_KINDS, r['kind'], 'meetings'),
      place: placeOf(r['place_label'], 'meetings'),
      meetAt: date(r['meet_at'], 'meetings'),
      status: member(MEETING_STATUSES, r['status'], 'meetings'),
      mine: bool(r['mine'], 'meetings'),
      createdAt: date(r['created_at'], 'meetings'),
      answeredAt: r['answered_at'] === null ? null : date(r['answered_at'], 'meetings'),
    });
  }
  return { outcome: 'DONE', viewerRole, canPropose, timezone, meetings };
}

/** Ligne de `core.messaging_cmd_propose_meeting`. */
export function proposeOf(rows: readonly Record<string, unknown>[]): ProposeResult {
  const [r] = rows;
  if (r === undefined || rows.length !== 1) throw shape('propose');
  if (r['outcome'] !== 'DONE')
    return { outcome: member(PROPOSE_REFUSALS, r['outcome'], 'propose') };
  return {
    outcome: 'DONE',
    id: uuidOf(r['meeting_id'], 'propose'),
    kind: member(MEETING_KINDS, r['kind'], 'propose'),
    place: placeOf(r['place_label'], 'propose'),
    meetAt: date(r['meet_at'], 'propose'),
    status: member(PROPOSED_STATUSES, r['status'], 'propose'),
  };
}

/** Ligne de `core.messaging_cmd_answer_meeting`. */
export function answerOf(rows: readonly Record<string, unknown>[]): AnswerResult {
  const [r] = rows;
  if (r === undefined || rows.length !== 1) throw shape('answer');
  if (r['outcome'] !== 'DONE') return { outcome: member(ANSWER_REFUSALS, r['outcome'], 'answer') };
  return {
    outcome: 'DONE',
    id: uuidOf(r['meeting_id'], 'answer'),
    kind: member(MEETING_KINDS, r['kind'], 'answer'),
    meetAt: date(r['meet_at'], 'answer'),
    status: member(ANSWERED_STATUSES, r['status'], 'answer'),
  };
}

export class PgTripMeetingStore implements TripMeetingStore {
  readonly #db: MsgSqlExecutor;

  constructor(db: MsgSqlExecutor) {
    this.#db = db;
  }

  async #run(
    operation: string,
    text: string,
    values: readonly unknown[],
  ): Promise<Record<string, unknown>[]> {
    try {
      return (await this.#db.query<Record<string, unknown>>(text, values)).rows;
    } catch (error) {
      const { code } = error as { code?: unknown };
      throw new TripMessageStoreError(operation, typeof code === 'string' ? code : undefined);
    }
  }

  async read(proof: Buffer, tripId: string): Promise<MeetingsReadResult> {
    return meetingsOf(await this.#run('meetings', MEETINGS_SQL, [proof, tripId]));
  }

  async propose(
    proof: Buffer,
    tripId: string,
    meetingId: string,
    kind: MeetingKind,
    place: string,
    meetAt: Date,
  ): Promise<ProposeResult> {
    return proposeOf(
      await this.#run('propose', PROPOSE_SQL, [
        proof,
        tripId,
        meetingId,
        kind,
        place,
        meetAt.toISOString(),
      ]),
    );
  }

  async answer(
    proof: Buffer,
    tripId: string,
    meetingId: string,
    decision: MeetingDecision,
  ): Promise<AnswerResult> {
    return answerOf(await this.#run('answer', ANSWER_SQL, [proof, tripId, meetingId, decision]));
  }
}
