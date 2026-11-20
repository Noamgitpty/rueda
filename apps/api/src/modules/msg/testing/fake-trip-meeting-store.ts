/**
 * FAKE du magasin des rendez-vous d'un trip (US-316) — TESTS SEULEMENT (contrat HTTP sans base).
 * Reprend, en mémoire et en TRÈS simplifié, les issues de la migration 0166 : partie du trip de la
 * session (sinon NOT_FOUND), hôte seul à proposer, voyageur seul à répondre, lieu de 3 à 160
 * caractères, coordonnées imitées par une suite de 7 chiffres ou une arobase, réessai par
 * identifiant, remplacement de la proposition en attente. Les vraies règles (bornes de l'heure,
 * statuts du trip, détection des coordonnées, événement) sont prouvées sur PostgreSQL
 * (packages/db/test/l0/l0-us316-messaging-privacy.test.ts), en PA et en PY.
 */
import { TripMessageStoreError } from '../internal/trip-message-store.js';
import type { ViewerRole } from '../internal/trip-message-store.js';
import type {
  AnswerResult,
  MeetingDecision,
  MeetingKind,
  MeetingsReadResult,
  ProposeResult,
  TripMeetingStore,
} from '../internal/trip-meeting-store.js';

interface Party {
  readonly role: ViewerRole;
  readonly userId: string;
}

interface FakeMeeting {
  readonly id: string;
  readonly kind: MeetingKind;
  readonly place: string;
  readonly meetAt: Date;
  status: 'PROPOSED' | 'ACCEPTED' | 'DECLINED' | 'SUPERSEDED';
  readonly proposedBy: string;
  answeredBy: string | null;
  readonly createdAt: Date;
  answeredAt: Date | null;
}

interface FakeTrip {
  readonly parties: Map<string, Party>;
  readonly timezone: string;
  open: boolean;
  readonly meetings: FakeMeeting[];
}

export class FakeTripMeetingStore implements TripMeetingStore {
  readonly #trips = new Map<string, FakeTrip>();
  /** Panne simulée de la base (SQLSTATE rendu). */
  failWith: string | null = null;
  /** Heure de la base simulée. */
  now = new Date('2035-05-02T09:00:00.000Z');
  /** Événements `trip.meeting.confirmed` émis (charge utile, jamais le lieu). */
  readonly events: Record<string, string>[] = [];

  addTrip(tripId: string, timezone: string): void {
    this.#trips.set(tripId, { parties: new Map(), timezone, open: true, meetings: [] });
  }

  addParty(tripId: string, proofHex: string, role: ViewerRole, userId: string): void {
    this.#trips.get(tripId)?.parties.set(proofHex, { role, userId });
  }

  /** Trip clos : plus aucune proposition ni réponse. */
  close(tripId: string): void {
    const t = this.#trips.get(tripId);
    if (t) t.open = false;
  }

  #party(proof: Buffer, tripId: string): { trip: FakeTrip; party: Party } | null {
    const trip = this.#trips.get(tripId);
    const party = trip?.parties.get(proof.toString('hex'));
    return trip && party ? { trip, party } : null;
  }

  #fail(operation: string): Promise<never> | null {
    return this.failWith === null
      ? null
      : Promise.reject(new TripMessageStoreError(operation, this.failWith));
  }

  read(proof: Buffer, tripId: string): Promise<MeetingsReadResult> {
    const failed = this.#fail('meetings');
    if (failed) return failed;
    const found = this.#party(proof, tripId);
    if (!found) return Promise.resolve({ outcome: 'NOT_FOUND' });
    const { trip, party } = found;
    return Promise.resolve({
      outcome: 'DONE',
      viewerRole: party.role,
      canPropose: party.role !== 'GUEST' && trip.open,
      timezone: trip.timezone,
      meetings: trip.meetings
        .filter((m) => m.status !== 'SUPERSEDED')
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          place: m.place,
          meetAt: m.meetAt,
          status: m.status as 'PROPOSED' | 'ACCEPTED' | 'DECLINED',
          mine: m.proposedBy === party.userId || m.answeredBy === party.userId,
          createdAt: m.createdAt,
          answeredAt: m.answeredAt,
        })),
    });
  }

  propose(
    proof: Buffer,
    tripId: string,
    meetingId: string,
    kind: MeetingKind,
    place: string,
    meetAt: Date,
  ): Promise<ProposeResult> {
    const failed = this.#fail('propose');
    if (failed) return failed;
    const found = this.#party(proof, tripId);
    if (!found) return Promise.resolve({ outcome: 'NOT_FOUND' });
    const { trip, party } = found;
    const old = trip.meetings.find((m) => m.id === meetingId);
    if (old) {
      if (old.proposedBy !== party.userId) return Promise.resolve({ outcome: 'REQUEST_INVALID' });
      return Promise.resolve({ outcome: 'DONE', ...old });
    }
    if (party.role === 'GUEST' || !trip.open) {
      return Promise.resolve({ outcome: 'MEETING_NOT_ALLOWED' });
    }
    const text = place.trim();
    if ([...text].length < 3 || [...text].length > 160 || meetAt <= this.now) {
      return Promise.resolve({ outcome: 'MEETING_INVALID' });
    }
    if (/\d[\d\s().-]{5,}\d|@/.test(text)) {
      return Promise.resolve({ outcome: 'MEETING_PLACE_CONTACT' });
    }
    for (const m of trip.meetings) {
      if (m.kind === kind && m.status === 'PROPOSED') m.status = 'SUPERSEDED';
    }
    const meeting: FakeMeeting = {
      id: meetingId,
      kind,
      place: text,
      meetAt,
      status: 'PROPOSED',
      proposedBy: party.userId,
      answeredBy: null,
      createdAt: new Date(this.now.getTime() + trip.meetings.length * 60_000),
      answeredAt: null,
    };
    trip.meetings.push(meeting);
    return Promise.resolve({ outcome: 'DONE', ...meeting });
  }

  answer(
    proof: Buffer,
    tripId: string,
    meetingId: string,
    decision: MeetingDecision,
  ): Promise<AnswerResult> {
    const failed = this.#fail('answer');
    if (failed) return failed;
    const found = this.#party(proof, tripId);
    const m = found?.trip.meetings.find((x) => x.id === meetingId);
    if (!found || !m) return Promise.resolve({ outcome: 'NOT_FOUND' });
    const { trip, party } = found;
    if (party.role !== 'GUEST') return Promise.resolve({ outcome: 'MEETING_NOT_ALLOWED' });
    const target = decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
    if (m.status !== 'PROPOSED') {
      if (m.status === target && m.answeredBy === party.userId) {
        return Promise.resolve({
          outcome: 'DONE',
          id: m.id,
          kind: m.kind,
          meetAt: m.meetAt,
          status: target,
        });
      }
      return Promise.resolve({ outcome: 'MEETING_NOT_PENDING' });
    }
    if (!trip.open) return Promise.resolve({ outcome: 'MEETING_NOT_ALLOWED' });
    if (decision === 'ACCEPT' && m.meetAt <= this.now) {
      return Promise.resolve({ outcome: 'MEETING_EXPIRED' });
    }
    if (decision === 'ACCEPT') {
      for (const x of trip.meetings) {
        if (x.kind === m.kind && x.status === 'ACCEPTED') x.status = 'SUPERSEDED';
      }
      this.events.push({
        trip_id: tripId,
        meeting_id: m.id,
        kind: m.kind,
        meet_at: m.meetAt.toISOString(),
      });
    }
    m.status = target;
    m.answeredBy = party.userId;
    m.answeredAt = this.now;
    return Promise.resolve({
      outcome: 'DONE',
      id: m.id,
      kind: m.kind,
      meetAt: m.meetAt,
      status: target,
    });
  }
}
