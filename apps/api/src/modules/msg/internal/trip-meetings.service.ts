/**
 * Rendez-vous d'un trip (US-316, ADR-186 ; 19 US-316 critère 4 ; 10b S16 « heure et détails du
 * rendez-vous »).
 *
 * - **Lecture** : propositions en attente, acceptées et refusées du trip, pour une partie du trip
 *   de la session (voyageur, titulaire du compte d'hôte, co-hôte de portée). Lieu (sans
 *   coordonnées) et heures seulement : aucun nom, aucun contact. Toute autre personne, trip inconnu
 *   ou identifiant mal formé ⇒ 404 `TRIP_NOT_FOUND`, même réponse (17 §2.3 point 5).
 * - **Proposition** (hôte seulement) : corps `{ id, kind, place, meetAt }` (identifiant choisi par
 *   le client : réessai sans doublon). La base refuse un lieu qui porte des coordonnées
 *   (`MEETING_PLACE_CONTACT`) et une heure hors du trip (`MEETING_INVALID`).
 * - **Réponse** (voyageur seulement) : corps `{ decision }` (`ACCEPT` ou `DECLINE`). Acceptée, la
 *   proposition devient le rendez-vous du trip et la base émet `trip.meeting.confirmed` (heure,
 *   jamais le lieu) : NTF avise les deux parties.
 * - **Aucun lieu dans un journal ni dans une erreur** : codes et SQLSTATE seulement.
 *
 * Fail-closed : base illisible ou forme inattendue ⇒ 503 `MESSAGES_UNAVAILABLE`.
 */
import { msgBody, MsgHttpError } from './errors.js';
import type { MsgBody, MsgCode } from './errors.js';
import { TripMessageStoreError } from './trip-message-store.js';
import type { ViewerRole } from './trip-message-store.js';
import { MEETING_DECISIONS, MEETING_KINDS } from './trip-meeting-store.js';
import type {
  AnswerResult,
  MeetingDecision,
  MeetingKind,
  MeetingStatus,
  MeetingsReadResult,
  ProposeResult,
  TripMeetingStore,
} from './trip-meeting-store.js';
import type { MsgLogger } from './trip-messages.service.js';
import { TripMessagesService } from './trip-messages.service.js';

export interface TripMeetingsDeps {
  readonly meetings: TripMeetingStore;
  readonly log: MsgLogger;
}

/** Bornes du lieu (celles de la base, en caractères, après les blancs de bord). */
export const PLACE_MIN_CHARS = 3;
export const PLACE_MAX_CHARS = 160;

export interface TripMeetingView {
  readonly id: string;
  readonly kind: MeetingKind;
  readonly place: string;
  readonly meetAt: string;
  readonly status: MeetingStatus;
  readonly mine: boolean;
  readonly createdAt: string;
  readonly answeredAt: string | null;
}

export interface TripMeetingsView extends MsgBody {
  readonly code: 'TRIP_MEETINGS';
  readonly tripId: string;
  readonly viewerRole: ViewerRole;
  readonly canPropose: boolean;
  readonly timezone: string;
  readonly meetings: readonly TripMeetingView[];
}

export interface MeetingProposedView extends MsgBody {
  readonly code: 'MEETING_PROPOSED';
  readonly meeting: {
    readonly id: string;
    readonly kind: MeetingKind;
    readonly place: string;
    readonly meetAt: string;
    readonly status: string;
  };
}

export interface MeetingAnsweredView extends MsgBody {
  readonly code: 'MEETING_ANSWERED';
  readonly meeting: {
    readonly id: string;
    readonly kind: MeetingKind;
    readonly meetAt: string;
    readonly status: 'ACCEPTED' | 'DECLINED';
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Instant ISO 8601 en UTC (forme de l'OpenAPI : `date-time`, « Z »). */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k));

const PROPOSE_REFUSALS: Readonly<Record<Exclude<ProposeResult['outcome'], 'DONE'>, MsgCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  NOT_FOUND: 'TRIP_NOT_FOUND',
  MEETING_NOT_ALLOWED: 'MEETING_NOT_ALLOWED',
  MEETING_INVALID: 'MEETING_INVALID',
  MEETING_PLACE_CONTACT: 'MEETING_PLACE_CONTACT',
  REQUEST_INVALID: 'REQUEST_INVALID',
};

const ANSWER_REFUSALS: Readonly<Record<Exclude<AnswerResult['outcome'], 'DONE'>, MsgCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  // trip dont la session n'est pas partie, proposition inconnue ou d'un autre trip : même issue
  NOT_FOUND: 'MEETING_NOT_FOUND',
  MEETING_NOT_ALLOWED: 'MEETING_NOT_ALLOWED',
  MEETING_NOT_PENDING: 'MEETING_NOT_PENDING',
  MEETING_EXPIRED: 'MEETING_EXPIRED',
  REQUEST_INVALID: 'REQUEST_INVALID',
};

export class TripMeetingsService {
  readonly #meetings: TripMeetingStore;
  readonly #log: MsgLogger;

  constructor(deps: TripMeetingsDeps) {
    this.#meetings = deps.meetings;
    this.#log = deps.log;
  }

  #unavailable(operation: string, error: unknown): MsgHttpError {
    // jamais un lieu : opération et SQLSTATE seulement
    this.#log.warn('MESSAGES_UNAVAILABLE', {
      operation,
      sqlstate: error instanceof TripMessageStoreError ? (error.sqlstate ?? 'none') : 'none',
    });
    return new MsgHttpError('MESSAGES_UNAVAILABLE');
  }

  async list(proof: Buffer | null, tripId: string): Promise<TripMeetingsView> {
    if (proof === null) throw new MsgHttpError('AUTH_REQUIRED');
    const trip = TripMessagesService.tripOf(tripId);
    let r: MeetingsReadResult;
    try {
      r = await this.#meetings.read(proof, trip);
    } catch (error) {
      throw this.#unavailable('meetings', error);
    }
    if (r.outcome !== 'DONE') {
      throw new MsgHttpError(r.outcome === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'TRIP_NOT_FOUND');
    }
    return {
      ...(msgBody('TRIP_MEETINGS') as MsgBody & { code: 'TRIP_MEETINGS' }),
      tripId: trip,
      viewerRole: r.viewerRole,
      canPropose: r.canPropose,
      timezone: r.timezone,
      meetings: r.meetings.map((m) => ({
        id: m.id,
        kind: m.kind,
        place: m.place,
        meetAt: m.meetAt.toISOString(),
        status: m.status,
        mine: m.mine,
        createdAt: m.createdAt.toISOString(),
        answeredAt: m.answeredAt === null ? null : m.answeredAt.toISOString(),
      })),
    };
  }

  async propose(proof: Buffer | null, tripId: string, body: unknown): Promise<MeetingProposedView> {
    if (proof === null) throw new MsgHttpError('AUTH_REQUIRED');
    const trip = TripMessagesService.tripOf(tripId);
    if (!isRecord(body) || !onlyKeys(body, ['id', 'kind', 'place', 'meetAt'])) {
      throw new MsgHttpError('REQUEST_INVALID');
    }
    const { id, kind, place, meetAt } = body;
    if (
      typeof id !== 'string' ||
      !UUID.test(id) ||
      typeof kind !== 'string' ||
      !(MEETING_KINDS as readonly string[]).includes(kind) ||
      typeof place !== 'string' ||
      typeof meetAt !== 'string' ||
      !INSTANT.test(meetAt) ||
      Number.isNaN(Date.parse(meetAt))
    ) {
      throw new MsgHttpError('REQUEST_INVALID');
    }
    // borne grossière avant la base (la base juge le lieu après les blancs de bord)
    if ([...place].length > PLACE_MAX_CHARS * 2) throw new MsgHttpError('MEETING_INVALID');
    let r: ProposeResult;
    try {
      r = await this.#meetings.propose(
        proof,
        trip,
        id,
        kind as MeetingKind,
        place,
        new Date(meetAt),
      );
    } catch (error) {
      throw this.#unavailable('propose', error);
    }
    if (r.outcome !== 'DONE') throw new MsgHttpError(PROPOSE_REFUSALS[r.outcome]);
    return {
      ...(msgBody('MEETING_PROPOSED') as MsgBody & { code: 'MEETING_PROPOSED' }),
      meeting: {
        id: r.id,
        kind: r.kind,
        place: r.place,
        meetAt: r.meetAt.toISOString(),
        status: r.status,
      },
    };
  }

  async answer(
    proof: Buffer | null,
    tripId: string,
    meetingId: string,
    body: unknown,
  ): Promise<MeetingAnsweredView> {
    if (proof === null) throw new MsgHttpError('AUTH_REQUIRED');
    const trip = TripMessagesService.tripOf(tripId);
    // identifiant de proposition mal formé : comme une proposition inconnue (aucun oracle)
    if (!UUID.test(meetingId)) throw new MsgHttpError('MEETING_NOT_FOUND');
    if (!isRecord(body) || !onlyKeys(body, ['decision'])) throw new MsgHttpError('REQUEST_INVALID');
    const decision = body['decision'];
    if (
      typeof decision !== 'string' ||
      !(MEETING_DECISIONS as readonly string[]).includes(decision)
    ) {
      throw new MsgHttpError('REQUEST_INVALID');
    }
    let r: AnswerResult;
    try {
      r = await this.#meetings.answer(proof, trip, meetingId, decision as MeetingDecision);
    } catch (error) {
      throw this.#unavailable('answer', error);
    }
    if (r.outcome !== 'DONE') throw new MsgHttpError(ANSWER_REFUSALS[r.outcome]);
    return {
      ...(msgBody('MEETING_ANSWERED') as MsgBody & { code: 'MEETING_ANSWERED' }),
      meeting: { id: r.id, kind: r.kind, meetAt: r.meetAt.toISOString(), status: r.status },
    };
  }
}
