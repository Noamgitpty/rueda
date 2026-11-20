/**
 * US-317 — lecture défensive des avis côté site. Attendus : OpenAPI (`TripReviews`,
 * `ReviewSubmitted`, `ReviewsReceived`, `ListingHostProfile`), 19 US-317 (avis scellé non servi à
 * l'autre partie ; prénom seulement), ADR-190 ; fuseau IANA hors des marchés (ADR-024 ; jamais le
 * code testé).
 */
import { describe, expect, it } from 'vitest';
import type { ApiResult } from './api-client.ts';
import {
  hostProfileOf,
  memberYearOf,
  ratingOf,
  receivedReviewsOf,
  reviewDoneFromQuery,
  reviewDoneOf,
  reviewPath,
  tripReviewsOf,
} from './trip-reviews.ts';

const TRIP = '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a6f';
const LISTING = '0190f5a2-7c3e-7d4b-8a1f-3c5e9b2d4a70';
const published = {
  authorRole: 'GUEST',
  authorName: 'Ana',
  overall: 4,
  subScores: { cleanliness: 5 },
  text: 'Todo salió bien, el auto estaba impecable.',
  publishedAt: '2035-06-16T14:00:00.000Z',
};
const reply = (json: unknown, status = 200): ApiResult => ({ status, json, session: null });
const trip = (over: Record<string, unknown> = {}) =>
  reply({
    code: 'TRIP_REVIEWS',
    messageKey: 'common.reviews.trip',
    tripId: TRIP,
    viewerRole: 'HOST',
    counterpartName: 'Ana',
    timezone: 'Pacific/Honolulu',
    windowDays: 10,
    endedAt: '2035-06-13T14:00:00.000Z',
    closesAt: '2035-06-23T14:00:00.000Z',
    canSubmit: false,
    mine: {
      status: 'SUBMITTED',
      overall: 5,
      subScores: { punctuality: 5 },
      text: null,
      contactMasked: false,
      submittedAt: '2035-06-14T14:00:00.000Z',
    },
    published: [published],
    guestProfile: { reviewCount: 1, averageX100: 400, reviews: [published] },
    ...over,
  });

describe('US-317 — avis côté site', () => {
  it('avis du trip : forme attendue lue ; autre trip, code, rôle, note, sous-note ou date mal formés ⇒ null', () => {
    expect(tripReviewsOf(trip(), TRIP)).toMatchObject({
      viewerRole: 'HOST',
      mine: { status: 'SUBMITTED', overall: 5 },
      published: [{ authorName: 'Ana', overall: 4 }],
      guestProfile: { reviewCount: 1, averageX100: 400 },
    });
    expect(tripReviewsOf(trip({ mine: null, guestProfile: null }), TRIP)).toMatchObject({
      mine: null,
      guestProfile: null,
    });
    for (const bad of [
      { tripId: LISTING },
      { code: 'TRIP_MEETINGS' },
      { viewerRole: 'CO_HOST' },
      { timezone: 'pas un fuseau' },
      { published: [{ ...published, overall: 6 }] },
      { published: [{ ...published, subScores: { stars: 5 } }] },
      { published: [published, published, published] },
      { closesAt: '2035-06-23' },
      { mine: { status: 'DRAFT' } },
      { guestProfile: { reviewCount: 1, averageX100: 50, reviews: [] } },
    ]) {
      expect(tripReviewsOf(trip(bad), TRIP), JSON.stringify(bad)).toBeNull();
    }
    expect(tripReviewsOf(reply({}, 404), TRIP)).toBeNull();
    expect(tripReviewsOf({ status: 'unavailable' }, TRIP)).toBeNull();
  });

  it('avis reçus et profil public de l’hôte : prénoms, ancienneté au mois ; forme inattendue ⇒ null', () => {
    const received = receivedReviewsOf(
      reply({
        code: 'REVIEWS_RECEIVED',
        messageKey: 'common.reviews.received',
        asGuest: {
          reviewCount: 1,
          averageX100: 300,
          reviews: [{ ...published, authorRole: 'HOST' }],
        },
        asHost: {
          firstName: 'María',
          memberSince: '2034-11',
          tripCount: 3,
          reviewCount: 0,
          averageX100: null,
          reviews: [],
        },
      }),
    );
    expect(received).toMatchObject({
      asGuest: { reviewCount: 1, averageX100: 300 },
      asHost: { firstName: 'María', memberSince: '2034-11', tripCount: 3 },
    });
    expect(
      receivedReviewsOf(reply({ code: 'REVIEWS_RECEIVED', asGuest: null, asHost: null })),
    ).toBeNull();
    const profile = {
      code: 'HOST_PROFILE',
      messageKey: 'common.reviews.hostProfile',
      listingId: LISTING,
      firstName: 'María',
      memberSince: '2034-11',
      tripCount: 4,
      reviewCount: 1,
      averageX100: 400,
      reviews: [published],
    };
    expect(hostProfileOf(reply(profile), LISTING)).toMatchObject({ firstName: 'María' });
    expect(hostProfileOf(reply(profile), TRIP)).toBeNull();
    expect(hostProfileOf(reply({ ...profile, memberSince: '2034-13' }), LISTING)).toBeNull();
    expect(hostProfileOf(reply(profile, 404), LISTING)).toBeNull();
    expect(memberYearOf('2034-11')).toBe(2034);
    expect(memberYearOf(null)).toBeUndefined();
    expect(ratingOf(475)).toBe(4.75);
    expect(ratingOf(null)).toBeUndefined();
  });

  it('envoi : statut de la réponse 201 ; issue de la requête en liste fermée ; chemins des écrans', () => {
    const done = (status: string) =>
      reply(
        {
          code: 'REVIEW_SUBMITTED',
          messageKey: 'common.reviews.submitted',
          review: { status, submittedAt: '2035-06-14T14:00:00.000Z', publishedAt: null },
        },
        201,
      );
    expect(reviewDoneOf(done('SUBMITTED'))).toBe('SUBMITTED');
    expect(reviewDoneOf(done('PUBLISHED'))).toBe('PUBLISHED');
    expect(reviewDoneOf(done('DRAFT'))).toBeNull();
    expect(reviewDoneOf(reply({ code: 'REVIEW_TEXT_REQUIRED' }, 422))).toBeNull();
    expect(reviewDoneFromQuery('PUBLISHED')).toBe('PUBLISHED');
    expect(reviewDoneFromQuery('javascript:')).toBeNull();
    expect(reviewDoneFromQuery(['SUBMITTED'])).toBeNull();
    expect(reviewPath('guest', TRIP)).toBe(`/trips/${TRIP}/review`);
    expect(reviewPath('host', TRIP)).toBe(`/host/trips/${TRIP}/review`);
    expect(reviewPath('guest', '../x')).toBeNull();
  });
});
