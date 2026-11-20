/**
 * Magasin des avis réciproques (US-317, migration 0170, ADR-190) : port et lecture STRICTE des
 * réponses de la base (fonctions `core.review_trip_read`, `core.review_cmd_submit`,
 * `core.review_my_received` et `core.review_listing_host_profile`, SECURITY DEFINER, propriétaire
 * `review_cmd_owner`, EXECUTE au seul `app_api`). La base juge la partie du trip de la SESSION, la
 * fenêtre, le texte exigé, masque les coordonnées et tient le scellé jusqu'à la publication ;
 * l'API ne fait que traduire. Toute forme inattendue ⇒ erreur (fail-closed : jamais un avis deviné,
 * jamais un succès supposé). Aucune erreur ne porte une note ni un texte : SQLSTATE seulement.
 */

/** Exécuteur SQL (pool `pg` sous `app_api`). */
export interface RevSqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export const REVIEW_ROLES = ['GUEST', 'HOST'] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];

/** Sous-notes du voyageur sur la voiture et l'hôte (08 BR-REVIEW-03). */
export const GUEST_SCORE_KEYS = [
  'cleanliness',
  'communication',
  'convenience',
  'accuracy',
  'maintenance',
] as const;
/** Sous-notes de l'hôte sur le voyageur (08 BR-REVIEW-03, recommandation LATAM). */
export const HOST_SCORE_KEYS = [
  'punctuality',
  'returnCondition',
  'communication',
  'rulesRespect',
] as const;
export type ScoreKey = (typeof GUEST_SCORE_KEYS)[number] | (typeof HOST_SCORE_KEYS)[number];
export type SubScores = Readonly<Partial<Record<ScoreKey, number>>>;
const SCORE_KEYS: readonly string[] = [...new Set([...GUEST_SCORE_KEYS, ...HOST_SCORE_KEYS])];

/** Bornes du texte (celles de la base, en caractères, après normalisation et masquage). */
export const REVIEW_TEXT_MAX_CHARS = 1000;
export const REVIEW_TEXT_MIN_CHARS_LOW_RATING = 25;

/** Avis publié servi : prénom de l'auteur seulement, jamais un identifiant ni un nom de famille. */
export interface PublishedReview {
  readonly authorRole: ReviewRole;
  readonly authorName: string | null;
  readonly overall: number;
  readonly subScores: SubScores;
  /** Texte publié, coordonnées masquées ; `null` sans texte. */
  readonly text: string | null;
  readonly publishedAt: string;
}

/** Avis de la personne de la session : scellé (`SUBMITTED`) ou publié. */
export interface MyReview {
  readonly status: 'SUBMITTED' | 'PUBLISHED';
  readonly overall: number;
  readonly subScores: SubScores;
  readonly text: string | null;
  /** Coordonnées trouvées et masquées dans le texte avant l'écriture. */
  readonly contactMasked: boolean;
  readonly submittedAt: string;
}

export interface ReviewSummary {
  readonly reviewCount: number;
  /** Moyenne ×100 arrondie au demi supérieur par la base ; `null` sans avis (badge « Nuevo »). */
  readonly averageX100: number | null;
  readonly reviews: readonly PublishedReview[];
}

export interface TripReviews {
  readonly viewerRole: ReviewRole;
  readonly counterpartName: string | null;
  readonly timezone: string;
  readonly windowDays: number | null;
  /** Fin effective du trip (première ligne RETURNED) ; `null` tant que la voiture n'est pas rendue. */
  readonly endedAt: string | null;
  /** Échéance de la fenêtre ; `null` sans fin effective ou sans paramètre. */
  readonly closesAt: string | null;
  readonly canSubmit: boolean;
  readonly mine: MyReview | null;
  /** Avis PUBLIÉS du trip (les deux sens) ; jamais l'avis scellé de l'autre partie. */
  readonly published: readonly PublishedReview[];
  /** Profil du voyageur (avis publiés des hôtes sur lui), servi à l'hôte seul. */
  readonly guestProfile: ReviewSummary | null;
}

export interface HostReviewSummary extends ReviewSummary {
  /** Mois d'inscription (`AAAA-MM`). */
  readonly memberSince: string | null;
  readonly tripCount: number;
}

export interface ReceivedReviews {
  readonly asGuest: ReviewSummary;
  readonly asHost: HostReviewSummary | null;
}

export interface HostProfile extends HostReviewSummary {
  readonly firstName: string;
}

export interface ReviewInput {
  readonly overall: number;
  readonly subScores: SubScores;
  readonly text: string | null;
}

export type TripReviewsResult =
  | { readonly outcome: 'DONE'; readonly view: TripReviews }
  | { readonly outcome: 'AUTH_REQUIRED' | 'NOT_FOUND' | 'REQUEST_INVALID' };

export const SUBMIT_REFUSALS = [
  'AUTH_REQUIRED',
  'NOT_FOUND',
  'REQUEST_INVALID',
  'REVIEW_INVALID',
  'REVIEW_TEXT_REQUIRED',
  'REVIEW_NOT_OPEN',
  'REVIEW_WINDOW_CLOSED',
  'REVIEW_WINDOW_UNKNOWN',
  'REVIEW_ALREADY_SUBMITTED',
] as const;
export type SubmitRefusal = (typeof SUBMIT_REFUSALS)[number];

export type SubmitResult =
  | {
      readonly outcome: 'DONE';
      readonly status: 'SUBMITTED' | 'PUBLISHED';
      readonly submittedAt: Date;
      readonly publishedAt: Date | null;
    }
  | { readonly outcome: SubmitRefusal };

export type ReceivedResult =
  | { readonly outcome: 'DONE'; readonly view: ReceivedReviews }
  | { readonly outcome: 'AUTH_REQUIRED' };

export type HostProfileResult =
  { readonly outcome: 'DONE'; readonly view: HostProfile } | { readonly outcome: 'NOT_FOUND' };

export interface ReviewStore {
  read(proof: Buffer, tripId: string): Promise<TripReviewsResult>;
  submit(proof: Buffer, tripId: string, input: ReviewInput): Promise<SubmitResult>;
  received(proof: Buffer): Promise<ReceivedResult>;
  hostProfile(listingId: string): Promise<HostProfileResult>;
}

export class ReviewStoreError extends Error {
  override readonly name = 'ReviewStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`avis (${operation}) : échec de la base${sqlstate ? ` (SQLSTATE ${sqlstate})` : ''}`);
    this.sqlstate = sqlstate;
  }
}

/** Aucun adaptateur : 503 (fail-closed). */
export class UnavailableReviewStore implements ReviewStore {
  read(): Promise<TripReviewsResult> {
    return Promise.reject(new ReviewStoreError('read', undefined));
  }

  submit(): Promise<SubmitResult> {
    return Promise.reject(new ReviewStoreError('submit', undefined));
  }

  received(): Promise<ReceivedResult> {
    return Promise.reject(new ReviewStoreError('received', undefined));
  }

  hostProfile(): Promise<HostProfileResult> {
    return Promise.reject(new ReviewStoreError('hostProfile', undefined));
  }
}

export const READ_SQL = 'SELECT * FROM core.review_trip_read($1, $2::uuid)';
export const SUBMIT_SQL = 'SELECT * FROM core.review_cmd_submit($1, $2::uuid, $3, $4::jsonb, $5)';
export const RECEIVED_SQL = 'SELECT * FROM core.review_my_received($1)';
export const HOST_PROFILE_SQL = 'SELECT * FROM core.review_listing_host_profile($1::uuid)';

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/;

type Json = Record<string, unknown>;

const shape = (operation: string): ReviewStoreError =>
  new ReviewStoreError(`${operation}: forme`, undefined);

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function exactKeys(v: unknown, keys: readonly string[], operation: string): Json {
  if (!isRecord(v)) throw shape(operation);
  const own = Object.keys(v).sort();
  const want = [...keys].sort();
  if (own.length !== want.length || own.some((k, i) => k !== want[i])) throw shape(operation);
  return v;
}

function member<T extends string>(list: readonly T[], value: unknown, operation: string): T {
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  throw new ReviewStoreError(`${operation}: issue inconnue`, undefined);
}

function score(value: unknown, operation: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    throw shape(operation);
  }
  return value;
}

function count(value: unknown, operation: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw shape(operation);
  return value;
}

function average(value: unknown, operation: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 100 || value > 500) {
    throw shape(operation);
  }
  return value;
}

function instant(value: unknown, operation: string): string {
  if (typeof value !== 'string' || !INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
    throw shape(operation);
  }
  return value;
}

function instantOrNull(value: unknown, operation: string): string | null {
  return value === null ? null : instant(value, operation);
}

function textOrNull(value: unknown, operation: string, max = REVIEW_TEXT_MAX_CHARS): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || [...value].length > max) {
    throw shape(operation);
  }
  return value;
}

function monthOrNull(value: unknown, operation: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !MONTH.test(value)) throw shape(operation);
  return value;
}

function subScoresOf(value: unknown, operation: string): SubScores {
  if (!isRecord(value)) throw shape(operation);
  const out: Partial<Record<ScoreKey, number>> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!SCORE_KEYS.includes(k)) throw shape(operation);
    out[k as ScoreKey] = score(v, operation);
  }
  return out;
}

function publishedOf(value: unknown, operation: string): PublishedReview {
  const r = exactKeys(
    value,
    ['authorRole', 'authorName', 'overall', 'subScores', 'text', 'publishedAt'],
    operation,
  );
  return {
    authorRole: member(REVIEW_ROLES, r['authorRole'], operation),
    authorName: textOrNull(r['authorName'], operation, 40),
    overall: score(r['overall'], operation),
    subScores: subScoresOf(r['subScores'], operation),
    text: textOrNull(r['text'], operation),
    publishedAt: instant(r['publishedAt'], operation),
  };
}

function listOf(value: unknown, operation: string, max: number): PublishedReview[] {
  if (!Array.isArray(value) || value.length > max) throw shape(operation);
  return value.map((v) => publishedOf(v, operation));
}

function summaryOf(value: Json, operation: string, max: number): ReviewSummary {
  const reviewCount = count(value['reviewCount'], operation);
  const averageX100 = average(value['averageX100'], operation);
  if ((reviewCount === 0) !== (averageX100 === null)) throw shape(operation);
  return { reviewCount, averageX100, reviews: listOf(value['reviews'], operation, max) };
}

/** Ligne de `core.review_trip_read` : issue et vue JSON (clés fermées). */
export function tripReviewsOf(rows: readonly Record<string, unknown>[]): TripReviewsResult {
  const op = 'read';
  const [r] = rows;
  if (r === undefined || rows.length !== 1) throw shape(op);
  if (r['outcome'] !== 'DONE') {
    if (r['view'] !== null) throw shape(op);
    return { outcome: member(['AUTH_REQUIRED', 'NOT_FOUND', 'REQUEST_INVALID'], r['outcome'], op) };
  }
  const v = exactKeys(
    r['view'],
    [
      'viewerRole',
      'counterpartName',
      'timezone',
      'windowDays',
      'endedAt',
      'closesAt',
      'canSubmit',
      'mine',
      'published',
      'guestProfile',
    ],
    op,
  );
  const viewerRole = member(REVIEW_ROLES, v['viewerRole'], op);
  const timezone = v['timezone'];
  if (typeof timezone !== 'string' || !ZONE.test(timezone)) throw shape(op);
  const windowDays = v['windowDays'] === null ? null : count(v['windowDays'], op);
  if (typeof v['canSubmit'] !== 'boolean') throw shape(op);
  let mine: MyReview | null = null;
  if (v['mine'] !== null) {
    const m = exactKeys(
      v['mine'],
      ['status', 'overall', 'subScores', 'text', 'contactMasked', 'submittedAt'],
      op,
    );
    if (typeof m['contactMasked'] !== 'boolean') throw shape(op);
    mine = {
      status: member(['SUBMITTED', 'PUBLISHED'] as const, m['status'], op),
      overall: score(m['overall'], op),
      subScores: subScoresOf(m['subScores'], op),
      text: textOrNull(m['text'], op),
      contactMasked: m['contactMasked'],
      submittedAt: instant(m['submittedAt'], op),
    };
  }
  let guestProfile: ReviewSummary | null = null;
  if (v['guestProfile'] !== null) {
    if (viewerRole !== 'HOST') throw shape(op);
    guestProfile = summaryOf(
      exactKeys(v['guestProfile'], ['reviewCount', 'averageX100', 'reviews'], op),
      op,
      5,
    );
  }
  return {
    outcome: 'DONE',
    view: {
      viewerRole,
      counterpartName: textOrNull(v['counterpartName'], op, 40),
      timezone,
      windowDays,
      endedAt: instantOrNull(v['endedAt'], op),
      closesAt: instantOrNull(v['closesAt'], op),
      canSubmit: v['canSubmit'],
      mine,
      // deux avis au plus par trip (un par partie)
      published: listOf(v['published'], op, 2),
      guestProfile,
    },
  };
}

/** Ligne de `core.review_cmd_submit`. */
export function submitOf(rows: readonly Record<string, unknown>[]): SubmitResult {
  const op = 'submit';
  const [r] = rows;
  if (r === undefined || rows.length !== 1) throw shape(op);
  if (r['outcome'] !== 'DONE') return { outcome: member(SUBMIT_REFUSALS, r['outcome'], op) };
  const status = member(['SUBMITTED', 'PUBLISHED'] as const, r['status'], op);
  const submittedAt = r['submitted_at'];
  const publishedAt = r['published_at'];
  if (!(submittedAt instanceof Date) || Number.isNaN(submittedAt.getTime())) throw shape(op);
  if (publishedAt !== null && !(publishedAt instanceof Date)) throw shape(op);
  if ((status === 'PUBLISHED') !== (publishedAt !== null)) throw shape(op);
  return { outcome: 'DONE', status, submittedAt, publishedAt };
}

function hostSummaryOf(v: Json, op: string): HostReviewSummary {
  return {
    ...summaryOf(v, op, 50),
    memberSince: monthOrNull(v['memberSince'], op),
    tripCount: count(v['tripCount'], op),
  };
}

/** Ligne de `core.review_my_received`. */
export function receivedOf(rows: readonly Record<string, unknown>[]): ReceivedResult {
  const op = 'received';
  const [r] = rows;
  if (r === undefined || rows.length !== 1) throw shape(op);
  if (r['outcome'] !== 'DONE') {
    if (r['view'] !== null) throw shape(op);
    return { outcome: member(['AUTH_REQUIRED'] as const, r['outcome'], op) };
  }
  const v = exactKeys(r['view'], ['asGuest', 'asHost'], op);
  const asGuest = summaryOf(
    exactKeys(v['asGuest'], ['reviewCount', 'averageX100', 'reviews'], op),
    op,
    50,
  );
  const asHost =
    v['asHost'] === null
      ? null
      : hostSummaryOf(
          exactKeys(
            v['asHost'],
            ['memberSince', 'tripCount', 'reviewCount', 'averageX100', 'reviews'],
            op,
          ),
          op,
        );
  return { outcome: 'DONE', view: { asGuest, asHost } };
}

/** Ligne de `core.review_listing_host_profile`. */
export function hostProfileOf(rows: readonly Record<string, unknown>[]): HostProfileResult {
  const op = 'hostProfile';
  const [r] = rows;
  if (r === undefined || rows.length !== 1) throw shape(op);
  if (r['outcome'] !== 'DONE') {
    if (r['view'] !== null) throw shape(op);
    return { outcome: member(['NOT_FOUND'] as const, r['outcome'], op) };
  }
  const v = exactKeys(
    r['view'],
    ['firstName', 'memberSince', 'tripCount', 'reviewCount', 'averageX100', 'reviews'],
    op,
  );
  const firstName = textOrNull(v['firstName'], op, 40);
  if (firstName === null) throw shape(op);
  const s = hostSummaryOf(v, op);
  if (s.reviews.length > 5) throw shape(op);
  return { outcome: 'DONE', view: { firstName, ...s } };
}

export class PgReviewStore implements ReviewStore {
  readonly #db: RevSqlExecutor;

  constructor(db: RevSqlExecutor) {
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
      throw new ReviewStoreError(operation, typeof code === 'string' ? code : undefined);
    }
  }

  async read(proof: Buffer, tripId: string): Promise<TripReviewsResult> {
    return tripReviewsOf(await this.#run('read', READ_SQL, [proof, tripId]));
  }

  async submit(proof: Buffer, tripId: string, input: ReviewInput): Promise<SubmitResult> {
    return submitOf(
      await this.#run('submit', SUBMIT_SQL, [
        proof,
        tripId,
        input.overall,
        JSON.stringify(input.subScores),
        input.text,
      ]),
    );
  }

  async received(proof: Buffer): Promise<ReceivedResult> {
    return receivedOf(await this.#run('received', RECEIVED_SQL, [proof]));
  }

  async hostProfile(listingId: string): Promise<HostProfileResult> {
    return hostProfileOf(await this.#run('hostProfile', HOST_PROFILE_SQL, [listingId]));
  }
}
