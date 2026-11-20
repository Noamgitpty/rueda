/**
 * FAKE du magasin des avis (US-317) pour les tests de contrat, sans base. Reproduit les issues de
 * `core.review_cmd_submit` / `core.review_trip_read` (0170) au plus simple : partie connue par
 * l'empreinte de la session, fenêtre réglable, texte exigé de 1 à 3 (25 caractères), une fois par
 * partie, publication des deux avis au second enregistrement. Les règles elles-mêmes sont prouvées
 * sur PostgreSQL (packages/db/test/l0/l0-us317-*.test.ts). JAMAIS exporté par `index.ts` (C19).
 */
import { ReviewStoreError } from '../internal/review-store.js';
import type {
  HostProfile,
  HostProfileResult,
  MyReview,
  PublishedReview,
  ReceivedResult,
  ReviewInput,
  ReviewRole,
  ReviewStore,
  SubmitResult,
  TripReviewsResult,
} from '../internal/review-store.js';

interface Party {
  readonly role: ReviewRole;
  readonly name: string;
}

interface FakeTrip {
  readonly timezone: string;
  readonly parties: Map<string, Party>;
  endedAt: string | null;
  closesAt: string | null;
  windowDays: number | null;
  readonly sealed: Map<ReviewRole, { input: ReviewInput; at: Date; author: string }>;
  publishedAt: Date | null;
}

export class FakeReviewStore implements ReviewStore {
  readonly #trips = new Map<string, FakeTrip>();
  readonly #profiles = new Map<string, HostProfile>();
  now = new Date('2035-06-14T12:00:00.000Z');
  /** SQLSTATE simulé : toute opération échoue (fail-closed). */
  failWith: string | null = null;

  addTrip(tripId: string, timezone: string, endedAt: string | null, windowDays: number): void {
    this.#trips.set(tripId, {
      timezone,
      parties: new Map(),
      endedAt,
      closesAt:
        endedAt === null
          ? null
          : new Date(Date.parse(endedAt) + windowDays * 86_400_000).toISOString(),
      windowDays,
      sealed: new Map(),
      publishedAt: null,
    });
  }

  /** `proofHex` : empreinte SHA-256 du jeton de session, en hexadécimal (harnais de contrat). */
  addParty(tripId: string, proofHex: string, role: ReviewRole, name: string): void {
    this.#trips.get(tripId)?.parties.set(proofHex, { role, name });
  }

  addProfile(listingId: string, profile: HostProfile): void {
    this.#profiles.set(listingId, profile);
  }

  #fail(operation: string): void {
    if (this.failWith !== null) throw new ReviewStoreError(operation, this.failWith);
  }

  #party(proof: Buffer, tripId: string): { trip: FakeTrip; party: Party } | null {
    const trip = this.#trips.get(tripId);
    const party = trip?.parties.get(proof.toString('hex'));
    return trip === undefined || party === undefined ? null : { trip, party };
  }

  #published(trip: FakeTrip): PublishedReview[] {
    if (trip.publishedAt === null) return [];
    const at = trip.publishedAt.toISOString();
    return [...trip.sealed.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([role, s]) => ({
        authorRole: role,
        authorName: s.author,
        overall: s.input.overall,
        subScores: s.input.subScores,
        text: s.input.text,
        publishedAt: at,
      }));
  }

  read(proof: Buffer, tripId: string): Promise<TripReviewsResult> {
    this.#fail('read');
    const p = this.#party(proof, tripId);
    if (p === null) return Promise.resolve({ outcome: 'NOT_FOUND' });
    const { trip, party } = p;
    const own = trip.sealed.get(party.role);
    const mine: MyReview | null =
      own === undefined
        ? null
        : {
            status: trip.publishedAt === null ? 'SUBMITTED' : 'PUBLISHED',
            overall: own.input.overall,
            subScores: own.input.subScores,
            text: own.input.text,
            contactMasked: false,
            submittedAt: own.at.toISOString(),
          };
    const other = [...trip.parties.values()].find((x) => x.role !== party.role);
    const open =
      trip.endedAt !== null &&
      trip.closesAt !== null &&
      this.now.getTime() >= Date.parse(trip.endedAt) &&
      this.now.getTime() < Date.parse(trip.closesAt);
    return Promise.resolve({
      outcome: 'DONE',
      view: {
        viewerRole: party.role,
        counterpartName: other?.name ?? null,
        timezone: trip.timezone,
        windowDays: trip.windowDays,
        endedAt: trip.endedAt,
        closesAt: trip.closesAt,
        canSubmit: mine === null && open,
        mine,
        published: this.#published(trip),
        guestProfile:
          party.role === 'HOST' ? { reviewCount: 0, averageX100: null, reviews: [] } : null,
      },
    });
  }

  submit(proof: Buffer, tripId: string, input: ReviewInput): Promise<SubmitResult> {
    this.#fail('submit');
    const p = this.#party(proof, tripId);
    if (p === null) return Promise.resolve({ outcome: 'NOT_FOUND' });
    const { trip, party } = p;
    if (input.overall < 1 || input.overall > 5)
      return Promise.resolve({ outcome: 'REVIEW_INVALID' });
    const text = input.text?.trim() ?? '';
    if (input.overall <= 3 && [...text].length < 25) {
      return Promise.resolve({ outcome: 'REVIEW_TEXT_REQUIRED' });
    }
    if (trip.sealed.has(party.role))
      return Promise.resolve({ outcome: 'REVIEW_ALREADY_SUBMITTED' });
    if (trip.endedAt === null) return Promise.resolve({ outcome: 'REVIEW_NOT_OPEN' });
    if (trip.closesAt === null) return Promise.resolve({ outcome: 'REVIEW_WINDOW_UNKNOWN' });
    if (this.now.getTime() >= Date.parse(trip.closesAt)) {
      return Promise.resolve({ outcome: 'REVIEW_WINDOW_CLOSED' });
    }
    const at = new Date(this.now);
    trip.sealed.set(party.role, {
      input: { ...input, text: text === '' ? null : text },
      at,
      author: party.name,
    });
    if (trip.sealed.size === 2) trip.publishedAt = at;
    return Promise.resolve({
      outcome: 'DONE',
      status: trip.publishedAt === null ? 'SUBMITTED' : 'PUBLISHED',
      submittedAt: at,
      publishedAt: trip.publishedAt,
    });
  }

  received(proof: Buffer): Promise<ReceivedResult> {
    this.#fail('received');
    const key = proof.toString('hex');
    const reviews: PublishedReview[] = [];
    let asHost = false;
    for (const trip of this.#trips.values()) {
      const party = trip.parties.get(key);
      if (party === undefined) continue;
      if (party.role === 'HOST') asHost = true;
      reviews.push(...this.#published(trip).filter((r) => r.authorRole !== party.role));
    }
    const summary = (list: PublishedReview[]) => ({
      reviewCount: list.length,
      averageX100:
        list.length === 0
          ? null
          : Math.floor(
              (list.reduce((s, r) => s + r.overall, 0) * 200 + list.length) / (2 * list.length),
            ),
      reviews: list,
    });
    return Promise.resolve({
      outcome: 'DONE',
      view: {
        asGuest: summary(reviews.filter((r) => r.authorRole === 'HOST')),
        asHost: asHost
          ? {
              ...summary(reviews.filter((r) => r.authorRole === 'GUEST')),
              memberSince: '2034-11',
              tripCount: 1,
            }
          : null,
      },
    });
  }

  hostProfile(listingId: string): Promise<HostProfileResult> {
    this.#fail('hostProfile');
    const p = this.#profiles.get(listingId);
    return Promise.resolve(
      p === undefined ? { outcome: 'NOT_FOUND' } : { outcome: 'DONE', view: p },
    );
  }
}
