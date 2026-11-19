/**
 * FAKE du magasin de la messagerie par trip (US-525) — TESTS SEULEMENT (contrat HTTP sans base).
 * Reprend, en mémoire et en TRÈS simplifié, les issues de la migration 0160 : partie du trip de la
 * session (sinon NOT_FOUND), fil fermé, texte vide ou trop long, réessai par identifiant. Le
 * masquage n'est qu'une imitation (suite de 7 chiffres ou plus) et le marché gris un seul mot
 * (« efectivo ») : les vraies règles, leur corpus et leurs faux positifs sont prouvés sur
 * PostgreSQL (packages/db/test/l0/l0-us525-messaging.test.ts), en PA et en PY.
 */
import { TripMessageStoreError } from '../internal/trip-message-store.js';
import type {
  PostResult,
  StoredMessage,
  ThreadReadResult,
  TripMessageStore,
  ViewerRole,
} from '../internal/trip-message-store.js';

interface Party {
  readonly role: ViewerRole;
  readonly userId: string;
  readonly name: string;
}

interface FakeTrip {
  readonly parties: Map<string, Party>;
  writable: boolean;
  readonly closesAt: Date;
  readonly timezone: string;
  readonly messages: (StoredMessage & { readonly author: string; readonly original: string })[];
}

export class FakeTripMessageStore implements TripMessageStore {
  readonly #trips = new Map<string, FakeTrip>();
  /** Panne simulée de la base (SQLSTATE rendu). */
  failWith: string | null = null;

  addTrip(tripId: string, closesAt: Date, timezone: string): void {
    this.#trips.set(tripId, {
      parties: new Map(),
      writable: true,
      closesAt,
      timezone,
      messages: [],
    });
  }

  addParty(tripId: string, proofHex: string, role: ViewerRole, userId: string, name: string): void {
    this.#trips.get(tripId)?.parties.set(proofHex, { role, userId, name });
  }

  close(tripId: string): void {
    const t = this.#trips.get(tripId);
    if (t) t.writable = false;
  }

  /** Texte reçu (preuve), jamais servi. */
  originalOf(id: string): string | undefined {
    for (const t of this.#trips.values()) {
      const m = t.messages.find((x) => x.id === id);
      if (m) return m.original;
    }
    return undefined;
  }

  #party(proof: Buffer, tripId: string): { trip: FakeTrip; party: Party } | null {
    const trip = this.#trips.get(tripId);
    const party = trip?.parties.get(proof.toString('hex'));
    return trip && party ? { trip, party } : null;
  }

  read(proof: Buffer, tripId: string, limit: number): Promise<ThreadReadResult> {
    if (this.failWith !== null) {
      return Promise.reject(new TripMessageStoreError('read', this.failWith));
    }
    if (limit < 1 || limit > 200) return Promise.resolve({ outcome: 'REQUEST_INVALID' });
    const found = this.#party(proof, tripId);
    if (!found) return Promise.resolve({ outcome: 'NOT_FOUND' });
    const { trip, party } = found;
    const other = [...trip.parties.values()].find(
      (p) => (party.role === 'GUEST') !== (p.role === 'GUEST'),
    );
    return Promise.resolve({
      outcome: 'DONE',
      viewerRole: party.role,
      counterpartName: other?.name ?? null,
      writable: trip.writable,
      closesAt: trip.closesAt,
      timezone: trip.timezone,
      messages: trip.messages.slice(-limit).map((m) => ({
        id: m.id,
        mine: m.author === party.userId,
        authorRole: m.authorRole,
        authorName: m.authorName,
        body: m.body,
        masked: m.masked,
        offPlatform: m.author === party.userId && m.offPlatform,
        sentAt: m.sentAt,
      })),
    });
  }

  post(proof: Buffer, tripId: string, messageId: string, body: string): Promise<PostResult> {
    if (this.failWith !== null) {
      return Promise.reject(new TripMessageStoreError('post', this.failWith));
    }
    const found = this.#party(proof, tripId);
    if (!found) return Promise.resolve({ outcome: 'NOT_FOUND' });
    const { trip, party } = found;
    const old = trip.messages.find((m) => m.id === messageId);
    if (old) {
      if (old.author !== party.userId) return Promise.resolve({ outcome: 'REQUEST_INVALID' });
      return Promise.resolve({
        outcome: 'DONE',
        id: old.id,
        body: old.body ?? '',
        masked: old.masked,
        offPlatform: old.offPlatform,
        sentAt: old.sentAt,
      });
    }
    if (!trip.writable) return Promise.resolve({ outcome: 'MESSAGE_THREAD_CLOSED' });
    const text = body.trim();
    if (text.length < 1 || [...text].length > 2000) {
      return Promise.resolve({ outcome: 'MESSAGE_INVALID' });
    }
    const served = text.replace(/\+?\d[\d\s().-]{5,}\d/g, '•••');
    const masked = served !== text;
    const offPlatform = /\befectivo\b/i.test(text);
    const sentAt = new Date(Date.parse('2035-05-02T09:00:00.000Z') + trip.messages.length * 60_000);
    trip.messages.push({
      id: messageId,
      author: party.userId,
      original: text,
      mine: true,
      authorRole: party.role,
      authorName: party.name,
      body: served,
      masked,
      offPlatform,
      sentAt,
    });
    return Promise.resolve({
      outcome: 'DONE',
      id: messageId,
      body: served,
      masked,
      offPlatform,
      sentAt,
    });
  }
}
