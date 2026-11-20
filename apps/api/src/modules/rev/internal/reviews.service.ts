/**
 * Avis réciproques en double aveugle (US-317, ADR-190 ; 19 US-317 ; 16 REV-001, REV-002, REV-004,
 * LST-020 ; écrans S13, A12, A13 et fiche S03).
 *
 * - **Avis d'un trip** (partie du trip de la session : voyageur ou titulaire du compte d'hôte) :
 *   fenêtre, MON avis (scellé ou publié), avis PUBLIÉS du trip et, pour l'hôte, profil du voyageur.
 *   Jamais l'avis scellé de l'autre partie, ni un signe qu'il existe. Toute autre personne, trip
 *   inconnu ou identifiant mal formé ⇒ 404 `TRIP_NOT_FOUND`, même réponse (17 §2.3 point 5).
 * - **Enregistrement** : corps `{ overall, subScores?, text? }` (clés fermées). La base juge la
 *   fenêtre (fin effective + `review_window_days`), le texte exigé de 1 à 3 (25 caractères), masque
 *   les coordonnées et publie les deux avis au second enregistrement (publication simultanée).
 * - **Avis reçus** par la personne de la session (droit d'accès, Ley 81 ; A13).
 * - **Profil public de l'hôte** d'une annonce publiée (LST-020) : prénom, ancienneté, trips, note.
 * - **Aucune note ni aucun texte dans un journal ni dans une erreur** : codes et SQLSTATE seulement.
 *
 * Fail-closed : base illisible, paramètre de fenêtre absent ou forme inattendue ⇒ 503
 * `REVIEWS_UNAVAILABLE`.
 */
import { revBody, RevHttpError } from './errors.js';
import type { RevBody, RevCode } from './errors.js';
import {
  GUEST_SCORE_KEYS,
  HOST_SCORE_KEYS,
  REVIEW_TEXT_MAX_CHARS,
  ReviewStoreError,
} from './review-store.js';
import type {
  HostProfile,
  HostProfileResult,
  ReceivedResult,
  ReceivedReviews,
  ReviewStore,
  SubmitRefusal,
  SubmitResult,
  SubScores,
  TripReviews,
  TripReviewsResult,
} from './review-store.js';

export interface RevLogger {
  warn(message: string, fields: Readonly<Record<string, string>>): void;
}

export interface ReviewsDeps {
  readonly store: ReviewStore;
  readonly log: RevLogger;
}

export interface TripReviewsView extends RevBody, TripReviews {
  readonly code: 'TRIP_REVIEWS';
  readonly tripId: string;
}

export interface ReviewSubmittedView extends RevBody {
  readonly code: 'REVIEW_SUBMITTED';
  readonly review: {
    readonly status: 'SUBMITTED' | 'PUBLISHED';
    readonly submittedAt: string;
    readonly publishedAt: string | null;
  };
}

export interface ReviewsReceivedView extends RevBody, ReceivedReviews {
  readonly code: 'REVIEWS_RECEIVED';
}

export interface HostProfileView extends RevBody, HostProfile {
  readonly code: 'HOST_PROFILE';
  readonly listingId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SCORE_KEYS: readonly string[] = [...new Set([...GUEST_SCORE_KEYS, ...HOST_SCORE_KEYS])];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((k) => keys.includes(k));
const isScore = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

const SUBMIT_CODES: Readonly<Record<SubmitRefusal, RevCode>> = {
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  // trip dont la session n'est pas partie (co-hôte compris), inconnu : même issue
  NOT_FOUND: 'TRIP_NOT_FOUND',
  REQUEST_INVALID: 'REQUEST_INVALID',
  REVIEW_INVALID: 'REVIEW_INVALID',
  REVIEW_TEXT_REQUIRED: 'REVIEW_TEXT_REQUIRED',
  REVIEW_NOT_OPEN: 'REVIEW_NOT_OPEN',
  REVIEW_WINDOW_CLOSED: 'REVIEW_WINDOW_CLOSED',
  // paramètre de fenêtre absent ou mal formé : fail-closed
  REVIEW_WINDOW_UNKNOWN: 'REVIEWS_UNAVAILABLE',
  REVIEW_ALREADY_SUBMITTED: 'REVIEW_ALREADY_SUBMITTED',
};

export class ReviewsService {
  readonly #store: ReviewStore;
  readonly #log: RevLogger;

  constructor(deps: ReviewsDeps) {
    this.#store = deps.store;
    this.#log = deps.log;
  }

  /** Identifiant de trip ou d'annonce : mal formé ⇒ comme un inconnu (aucun oracle). */
  static idOf(id: string, notFound: 'TRIP_NOT_FOUND' | 'LISTING_NOT_FOUND'): string {
    if (!UUID.test(id)) throw new RevHttpError(notFound);
    return id;
  }

  #unavailable(operation: string, error: unknown): RevHttpError {
    // jamais une note ni un texte : opération et SQLSTATE seulement
    this.#log.warn('REVIEWS_UNAVAILABLE', {
      operation,
      sqlstate: error instanceof ReviewStoreError ? (error.sqlstate ?? 'none') : 'none',
    });
    return new RevHttpError('REVIEWS_UNAVAILABLE');
  }

  async trip(proof: Buffer | null, tripId: string): Promise<TripReviewsView> {
    if (proof === null) throw new RevHttpError('AUTH_REQUIRED');
    const trip = ReviewsService.idOf(tripId, 'TRIP_NOT_FOUND');
    let r: TripReviewsResult;
    try {
      r = await this.#store.read(proof, trip);
    } catch (error) {
      throw this.#unavailable('read', error);
    }
    if (r.outcome !== 'DONE') {
      throw new RevHttpError(r.outcome === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'TRIP_NOT_FOUND');
    }
    return {
      ...(revBody('TRIP_REVIEWS') as RevBody & { code: 'TRIP_REVIEWS' }),
      tripId: trip,
      ...r.view,
    };
  }

  async submit(proof: Buffer | null, tripId: string, body: unknown): Promise<ReviewSubmittedView> {
    if (proof === null) throw new RevHttpError('AUTH_REQUIRED');
    const trip = ReviewsService.idOf(tripId, 'TRIP_NOT_FOUND');
    if (!isRecord(body) || !onlyKeys(body, ['overall', 'subScores', 'text'])) {
      throw new RevHttpError('REQUEST_INVALID');
    }
    const { overall, subScores, text } = body;
    if (!isScore(overall)) throw new RevHttpError('REQUEST_INVALID');
    if (text !== undefined && text !== null && typeof text !== 'string') {
      throw new RevHttpError('REQUEST_INVALID');
    }
    let scores: SubScores = {};
    if (subScores !== undefined && subScores !== null) {
      if (!isRecord(subScores)) throw new RevHttpError('REQUEST_INVALID');
      for (const [k, v] of Object.entries(subScores)) {
        if (!SCORE_KEYS.includes(k) || !isScore(v)) throw new RevHttpError('REQUEST_INVALID');
      }
      scores = subScores as SubScores;
    }
    // borne grossière avant la base (la base juge le texte normalisé et masqué)
    if (typeof text === 'string' && [...text].length > REVIEW_TEXT_MAX_CHARS * 2) {
      throw new RevHttpError('REVIEW_INVALID');
    }
    let r: SubmitResult;
    try {
      r = await this.#store.submit(proof, trip, {
        overall,
        subScores: scores,
        text: typeof text === 'string' ? text : null,
      });
    } catch (error) {
      throw this.#unavailable('submit', error);
    }
    if (r.outcome !== 'DONE') {
      if (r.outcome === 'REVIEW_WINDOW_UNKNOWN') {
        this.#log.warn('REVIEWS_UNAVAILABLE', { operation: 'submit', reason: 'WINDOW_UNKNOWN' });
      }
      throw new RevHttpError(SUBMIT_CODES[r.outcome]);
    }
    return {
      ...(revBody('REVIEW_SUBMITTED') as RevBody & { code: 'REVIEW_SUBMITTED' }),
      review: {
        status: r.status,
        submittedAt: r.submittedAt.toISOString(),
        publishedAt: r.publishedAt === null ? null : r.publishedAt.toISOString(),
      },
    };
  }

  async received(proof: Buffer | null): Promise<ReviewsReceivedView> {
    if (proof === null) throw new RevHttpError('AUTH_REQUIRED');
    let r: ReceivedResult;
    try {
      r = await this.#store.received(proof);
    } catch (error) {
      throw this.#unavailable('received', error);
    }
    if (r.outcome !== 'DONE') throw new RevHttpError('AUTH_REQUIRED');
    return {
      ...(revBody('REVIEWS_RECEIVED') as RevBody & { code: 'REVIEWS_RECEIVED' }),
      ...r.view,
    };
  }

  async hostProfile(listingId: string): Promise<HostProfileView> {
    const listing = ReviewsService.idOf(listingId, 'LISTING_NOT_FOUND');
    let r: HostProfileResult;
    try {
      r = await this.#store.hostProfile(listing);
    } catch (error) {
      throw this.#unavailable('hostProfile', error);
    }
    if (r.outcome !== 'DONE') throw new RevHttpError('LISTING_NOT_FOUND');
    return {
      ...(revBody('HOST_PROFILE') as RevBody & { code: 'HOST_PROFILE' }),
      listingId: listing,
      ...r.view,
    };
  }
}
