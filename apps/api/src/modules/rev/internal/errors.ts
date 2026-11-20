/**
 * Réponses des avis réciproques (US-317, ADR-190 ; 16 REV-001, REV-002, REV-004, LST-020) : code
 * stable et clé du catalogue `@rueda/i18n` (es, en, fr, pt). Jamais une note, un texte d'avis ni un
 * détail technique dans une erreur.
 *
 * Codes de 16 A.8 : `REVIEW_WINDOW_CLOSED`, `REVIEW_TEXT_REQUIRED`, `REVIEW_ALREADY_SUBMITTED`.
 * Repris : `AUTH_REQUIRED`, `REQUEST_INVALID` (US-010), `TRIP_NOT_FOUND` (US-214),
 * `LISTING_NOT_FOUND` (US-115). PROPOSÉS (à reporter dans 16 A.8, ADR-190) : `TRIP_REVIEWS`,
 * `REVIEW_SUBMITTED`, `REVIEWS_RECEIVED`, `HOST_PROFILE`, `REVIEW_NOT_OPEN`, `REVIEW_INVALID`,
 * `REVIEWS_UNAVAILABLE`.
 */
import { HttpException } from '@nestjs/common';

export const REV_MESSAGES = {
  TRIP_REVIEWS: { status: 200, messageKey: 'common.reviews.trip' },
  REVIEW_SUBMITTED: { status: 201, messageKey: 'common.reviews.submitted' },
  REVIEWS_RECEIVED: { status: 200, messageKey: 'common.reviews.received' },
  HOST_PROFILE: { status: 200, messageKey: 'common.reviews.hostProfile' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  TRIP_NOT_FOUND: { status: 404, messageKey: 'common.trips.notFound' },
  LISTING_NOT_FOUND: { status: 404, messageKey: 'common.listing.notFound' },
  REVIEW_ALREADY_SUBMITTED: { status: 409, messageKey: 'common.reviews.alreadySubmitted' },
  REVIEW_NOT_OPEN: { status: 409, messageKey: 'common.reviews.notOpen' },
  REVIEW_WINDOW_CLOSED: { status: 409, messageKey: 'common.reviews.windowClosed' },
  REVIEW_TEXT_REQUIRED: { status: 422, messageKey: 'common.reviews.textRequired' },
  REVIEW_INVALID: { status: 422, messageKey: 'common.reviews.invalid' },
  REVIEWS_UNAVAILABLE: { status: 503, messageKey: 'common.reviews.unavailable' },
} as const;

export type RevCode = keyof typeof REV_MESSAGES;

export interface RevBody {
  readonly code: RevCode;
  readonly messageKey: (typeof REV_MESSAGES)[RevCode]['messageKey'];
}

export function revBody(code: RevCode): RevBody {
  return { code, messageKey: REV_MESSAGES[code].messageKey };
}

/** Erreur HTTP des avis : corps `{ code, messageKey }`. */
export class RevHttpError extends HttpException {
  readonly code: RevCode;

  constructor(code: RevCode) {
    super(revBody(code), REV_MESSAGES[code].status);
    this.code = code;
  }
}
