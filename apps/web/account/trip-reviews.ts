/**
 * Avis réciproques côté site (US-317, ADR-190 ; 19 US-317 ; 10b S13, A12, A13 et fiche S03) :
 * lecture DÉFENSIVE de `GET /trips/{id}/reviews`, `GET /reviews/received` et
 * `GET /listings/{id}/host-profile` (toute forme inattendue ⇒ `null`, l'écran dit l'erreur, jamais
 * un avis deviné) et de la réponse de `POST /trips/{id}/reviews`. Les avis publiés portent le
 * prénom de l'auteur seulement ; le texte est déjà masqué par la base. Côté serveur seulement ;
 * jamais une note ni un texte dans une URL ni dans un journal.
 */
import type { ApiResult } from './api-client.ts';
import { UUID } from './trip-messages.ts';

export const REVIEW_ROLES = ['GUEST', 'HOST'] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];

/** Sous-notes du voyageur sur la voiture et l'hôte (08 BR-REVIEW-03), dans l'ordre d'affichage. */
export const GUEST_SCORE_KEYS = [
  'cleanliness',
  'communication',
  'convenience',
  'accuracy',
  'maintenance',
] as const;
/** Sous-notes de l'hôte sur le voyageur (08 BR-REVIEW-03). */
export const HOST_SCORE_KEYS = [
  'punctuality',
  'returnCondition',
  'communication',
  'rulesRespect',
] as const;
export type ScoreKey = (typeof GUEST_SCORE_KEYS)[number] | (typeof HOST_SCORE_KEYS)[number];
export type SubScores = Readonly<Partial<Record<ScoreKey, number>>>;
const SCORE_KEYS: readonly string[] = [...new Set([...GUEST_SCORE_KEYS, ...HOST_SCORE_KEYS])];

/** Bornes du texte (celles de l'API et de la base). */
export const REVIEW_TEXT_MAX_CHARS = 1000;
export const REVIEW_TEXT_MIN_CHARS_LOW_RATING = 25;
/** Note à partir de laquelle le texte devient facultatif (BR-REVIEW-04 : obligatoire de 1 à 3). */
export const REVIEW_TEXT_OPTIONAL_FROM = 4;

export interface PublishedReview {
  readonly authorRole: ReviewRole;
  readonly authorName: string | null;
  readonly overall: number;
  readonly subScores: SubScores;
  readonly text: string | null;
  readonly publishedAt: string;
}

export interface MyReview {
  readonly status: 'SUBMITTED' | 'PUBLISHED';
  readonly overall: number;
  readonly subScores: SubScores;
  readonly text: string | null;
  readonly contactMasked: boolean;
  readonly submittedAt: string;
}

export interface ReviewSummary {
  readonly reviewCount: number;
  readonly averageX100: number | null;
  readonly reviews: readonly PublishedReview[];
}

export interface TripReviews {
  readonly viewerRole: ReviewRole;
  readonly counterpartName: string | null;
  readonly timezone: string;
  readonly windowDays: number | null;
  readonly endedAt: string | null;
  readonly closesAt: string | null;
  readonly canSubmit: boolean;
  readonly mine: MyReview | null;
  readonly published: readonly PublishedReview[];
  readonly guestProfile: ReviewSummary | null;
}

export interface HostReviewSummary extends ReviewSummary {
  readonly memberSince: string | null;
  readonly tripCount: number;
}

export interface ReceivedHostSummary extends HostReviewSummary {
  /** Prénom de la personne de la session tel que le voient les voyageurs (aperçu A13). */
  readonly firstName: string | null;
}

export interface ReceivedReviews {
  readonly asGuest: ReviewSummary;
  readonly asHost: ReceivedHostSummary | null;
}

export interface HostProfile extends HostReviewSummary {
  readonly firstName: string;
}

/** Issue montrée après un envoi (`?rv=SUBMITTED|PUBLISHED`). */
export const REVIEW_DONE = ['SUBMITTED', 'PUBLISHED'] as const;
export type ReviewDone = (typeof REVIEW_DONE)[number];

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ZONE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const member = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);
const isScore = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5;
const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isTextOrNull = (v: unknown, max: number): v is string | null =>
  v === null || (typeof v === 'string' && v.length > 0 && [...v].length <= max);
const isIsoOrNull = (v: unknown): v is string | null =>
  v === null || (typeof v === 'string' && ISO.test(v));

function subScoresOf(v: unknown): SubScores | null {
  if (!isRecord(v)) return null;
  const out: Partial<Record<ScoreKey, number>> = {};
  for (const [k, s] of Object.entries(v)) {
    if (!SCORE_KEYS.includes(k) || !isScore(s)) return null;
    out[k as ScoreKey] = s;
  }
  return out;
}

function publishedOf(v: unknown): PublishedReview | null {
  if (!isRecord(v)) return null;
  const { authorRole, authorName, overall, text, publishedAt } = v;
  const subScores = subScoresOf(v['subScores']);
  if (
    !member(REVIEW_ROLES, authorRole) ||
    !isTextOrNull(authorName, 40) ||
    !isScore(overall) ||
    subScores === null ||
    !isTextOrNull(text, REVIEW_TEXT_MAX_CHARS) ||
    typeof publishedAt !== 'string' ||
    !ISO.test(publishedAt)
  ) {
    return null;
  }
  return { authorRole, authorName, overall, subScores, text, publishedAt };
}

function listOf(v: unknown, max: number): PublishedReview[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const out: PublishedReview[] = [];
  for (const r of v) {
    const parsed = publishedOf(r);
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out;
}

function summaryOf(v: unknown, max: number): ReviewSummary | null {
  if (!isRecord(v)) return null;
  const { reviewCount, averageX100 } = v;
  const reviews = listOf(v['reviews'], max);
  if (
    !isCount(reviewCount) ||
    !(averageX100 === null || (isCount(averageX100) && averageX100 >= 100 && averageX100 <= 500)) ||
    reviews === null
  ) {
    return null;
  }
  return { reviewCount, averageX100, reviews };
}

function hostSummaryOf(v: unknown, max: number): HostReviewSummary | null {
  if (!isRecord(v)) return null;
  const s = summaryOf(v, max);
  const { memberSince, tripCount } = v;
  if (
    s === null ||
    !isCount(tripCount) ||
    !(memberSince === null || (typeof memberSince === 'string' && MONTH.test(memberSince)))
  ) {
    return null;
  }
  return { ...s, memberSince, tripCount };
}

function mineOf(v: unknown): MyReview | null | undefined {
  if (v === null) return null;
  if (!isRecord(v)) return undefined;
  const { status, overall, text, contactMasked, submittedAt } = v;
  const subScores = subScoresOf(v['subScores']);
  if (
    !member(['SUBMITTED', 'PUBLISHED'] as const, status) ||
    !isScore(overall) ||
    subScores === null ||
    !isTextOrNull(text, REVIEW_TEXT_MAX_CHARS) ||
    typeof contactMasked !== 'boolean' ||
    typeof submittedAt !== 'string' ||
    !ISO.test(submittedAt)
  ) {
    return undefined;
  }
  return { status, overall, subScores, text, contactMasked, submittedAt };
}

/** Avis du trip (réponse 200) ; `null` si la forme est inattendue ou s'il s'agit d'un autre trip. */
export function tripReviewsOf(reply: ApiResult, tripId: string): TripReviews | null {
  if (reply.status !== 200 || !isRecord(reply.json)) return null;
  const j = reply.json;
  const mine = mineOf(j['mine']);
  const published = listOf(j['published'], 2);
  const guestProfile = j['guestProfile'] === null ? null : summaryOf(j['guestProfile'], 50);
  if (
    j['code'] !== 'TRIP_REVIEWS' ||
    j['tripId'] !== tripId ||
    !member(REVIEW_ROLES, j['viewerRole']) ||
    !isTextOrNull(j['counterpartName'], 40) ||
    typeof j['timezone'] !== 'string' ||
    !ZONE.test(j['timezone']) ||
    !(j['windowDays'] === null || isCount(j['windowDays'])) ||
    !isIsoOrNull(j['endedAt']) ||
    !isIsoOrNull(j['closesAt']) ||
    typeof j['canSubmit'] !== 'boolean' ||
    mine === undefined ||
    published === null ||
    (j['guestProfile'] !== null && guestProfile === null)
  ) {
    return null;
  }
  return {
    viewerRole: j['viewerRole'],
    counterpartName: j['counterpartName'],
    timezone: j['timezone'],
    windowDays: j['windowDays'],
    endedAt: j['endedAt'],
    closesAt: j['closesAt'],
    canSubmit: j['canSubmit'],
    mine,
    published,
    guestProfile,
  };
}

/** Avis reçus (réponse 200) ; `null` si la forme est inattendue. */
export function receivedReviewsOf(reply: ApiResult): ReceivedReviews | null {
  if (reply.status !== 200 || !isRecord(reply.json)) return null;
  const j = reply.json;
  if (j['code'] !== 'REVIEWS_RECEIVED') return null;
  const asGuest = summaryOf(j['asGuest'], 50);
  if (asGuest === null) return null;
  if (j['asHost'] === null) return { asGuest, asHost: null };
  const host = hostSummaryOf(j['asHost'], 50);
  const firstName = isRecord(j['asHost']) ? j['asHost']['firstName'] : undefined;
  if (host === null || !isTextOrNull(firstName, 40)) return null;
  return { asGuest, asHost: { ...host, firstName } };
}

/** Profil public de l'hôte (réponse 200) ; `null` si la forme est inattendue (bloc sans ancienneté). */
export function hostProfileOf(reply: ApiResult, listingId: string): HostProfile | null {
  if (reply.status !== 200 || !isRecord(reply.json)) return null;
  const j = reply.json;
  const s = hostSummaryOf(j, 5);
  const firstName = j['firstName'];
  if (
    j['code'] !== 'HOST_PROFILE' ||
    j['listingId'] !== listingId ||
    typeof firstName !== 'string' ||
    firstName.length === 0 ||
    s === null
  ) {
    return null;
  }
  return { ...s, firstName };
}

/** Statut d'une réponse 201 de l'envoi ; `null` sinon. */
export function reviewDoneOf(reply: ApiResult): ReviewDone | null {
  if (reply.status !== 201 || !isRecord(reply.json)) return null;
  if (reply.json['code'] !== 'REVIEW_SUBMITTED' || !isRecord(reply.json['review'])) return null;
  const status = reply.json['review']['status'];
  return member(REVIEW_DONE, status) ? status : null;
}

/** Issue lue dans la requête de la page (`?rv=…`) ; inconnue ⇒ `null`. */
export function reviewDoneFromQuery(value: string | string[] | undefined): ReviewDone | null {
  return typeof value === 'string' && member(REVIEW_DONE, value) ? value : null;
}

/** Écran d'avis d'un trip (S13 voyageur, A12 hôte) ; identifiant mal formé ⇒ `null`. */
export function reviewPath(scope: 'guest' | 'host', tripId: string): string | null {
  if (!UUID.test(tripId)) return null;
  return scope === 'guest' ? `/trips/${tripId}/review` : `/host/trips/${tripId}/review`;
}

/** Statuts d'un trip dont la voiture a été rendue (lien vers l'écran d'avis). */
export const REVIEWABLE_TRIP_STATUSES = [
  'RETURNED',
  'POST_TRIP',
  'COMPLETED',
  'IN_DISPUTE',
] as const;

/** Moyenne ×100 ⇒ note sur 5 (une décimale à l'affichage) ; `undefined` sans avis (« Nuevo »). */
export function ratingOf(averageX100: number | null): number | undefined {
  return averageX100 === null ? undefined : averageX100 / 100;
}

/** Année d'inscription d'un mois `AAAA-MM` (bloc de l'hôte, « Miembro desde 2024 »). */
export function memberYearOf(memberSince: string | null): number | undefined {
  const m = memberSince === null ? null : MONTH.exec(memberSince);
  return m === null ? undefined : Number(m[1]);
}
