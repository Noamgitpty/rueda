/**
 * US-317 — tests de contrat des routes d'avis (`/trips/{tripId}/reviews`, `/reviews/received`,
 * `/listings/{listingId}/host-profile`) sur l'application RÉELLE (ApiModule, harnais d'US-043) et
 * le FAKE du magasin (sans base) : chaque réponse est confrontée à `apps/api/openapi/openapi.json`.
 * Attendus : 19 US-317 (critère 2 : publication des deux avis au second enregistrement ; critère 3 :
 * avis reçus consultables, texte exigé de 1 à 3 ; critère 4 : profil public de l'hôte), 16 REV-004
 * (« l'autre partie ne voit ni la note ni le texte » d'un avis scellé), 17 §2.3 point 5 (trip
 * d'un autre : même 404 qu'un trip inconnu), ADR-190 (aucune note ni texte dans un journal). Les
 * règles elles-mêmes (parties, fenêtre au fuseau du trip, scellé, publication à l'échéance,
 * masquage, courses) sont prouvées sur PostgreSQL (packages/db/test/l0/l0-us317-*.test.ts), en PA
 * et en PY. Données fictives.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { CountryConfigService } from '../../cfg/index.js';
import {
  closeContractApps,
  contract,
  coverageOf,
  FIRST_COUNTRY,
  startContractApp,
  textBody,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import { FakeReviewStore } from './fake-review-store.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const TEXT = 'Todo salió bien, el auto estaba impecable y la entrega fue puntual.';
const SECRET = 'Llegó tarde y el auto olía a cigarro, no lo recomiendo.';
/** Fuseau du premier pays déclaré par CFG (jamais en constante, ADR-024). */
const TIME_ZONE = new CountryConfigService().config.countries.get(FIRST_COUNTRY)?.timeZone ?? '';
const ENDED_AT = '2035-06-13T14:00:00.000Z';

interface World {
  readonly app: ContractApp;
  readonly store: FakeReviewStore;
  readonly logs: string[];
  readonly trip: string;
  readonly base: string;
  readonly guest: Record<string, string>;
  readonly host: Record<string, string>;
}

const apps: ContractApp[] = [];
afterAll(closeContractApps);

async function world(): Promise<World> {
  const store = new FakeReviewStore();
  const logs: string[] = [];
  const app = await startContractApp({
    rev: {
      store,
      log: { warn: (message, fields) => logs.push(JSON.stringify({ message, ...fields })) },
    },
  });
  apps.push(app);
  const trip = randomUUID();
  store.addTrip(trip, TIME_ZONE, ENDED_AT, 10);
  store.addParty(trip, app.hash('voyageur'), 'GUEST', 'Ana');
  store.addParty(trip, app.hash('staff_sans_mfa'), 'HOST', 'María');
  return {
    app,
    store,
    logs,
    trip,
    base: `/trips/${trip}/reviews`,
    guest: { ...app.cookie('voyageur'), ...JSON_HEADERS },
    host: { ...app.cookie('staff_sans_mfa'), ...JSON_HEADERS },
  };
}

describe('US-317 — avis réciproques en double aveugle (S13, A12, A13, fiche)', () => {
  it('double aveugle puis publication simultanée : l’avis scellé du voyageur n’est pas servi à l’hôte ; au second avis, les deux sont publiés au même instant ; no-store', async () => {
    const w = await world();
    const before = await w.app.api.request('GET', w.base, { headers: w.host });
    expect(before.status).toBe(200);
    expect(before.headers.get('cache-control')).toBe('no-store');
    expect(before.json).toMatchObject({
      code: 'TRIP_REVIEWS',
      messageKey: 'common.reviews.trip',
      tripId: w.trip,
      viewerRole: 'HOST',
      counterpartName: 'Ana',
      timezone: TIME_ZONE,
      endedAt: ENDED_AT,
      canSubmit: true,
      mine: null,
      published: [],
    });

    const sealed = await w.app.api.request('POST', w.base, {
      headers: w.guest,
      body: { overall: 2, text: SECRET, subScores: { cleanliness: 1 } },
    });
    expect(sealed.status).toBe(201);
    expect(sealed.headers.get('cache-control')).toBe('no-store');
    expect(sealed.json).toMatchObject({
      code: 'REVIEW_SUBMITTED',
      messageKey: 'common.reviews.submitted',
      review: { status: 'SUBMITTED', publishedAt: null },
    });
    // l'hôte : même lecture qu'avant
    const after = await w.app.api.request('GET', w.base, { headers: w.host });
    expect(after.json).toEqual(before.json);
    expect(JSON.stringify(after.json)).not.toContain('cigarro');
    // le voyageur relit son avis en attente
    const mine = await w.app.api.request('GET', w.base, { headers: w.guest });
    expect(mine.json).toMatchObject({
      viewerRole: 'GUEST',
      guestProfile: null,
      mine: { status: 'SUBMITTED', overall: 2, text: SECRET },
      published: [],
    });

    const second = await w.app.api.request('POST', w.base, {
      headers: w.host,
      body: { overall: 5, subScores: { punctuality: 5, rulesRespect: 4 } },
    });
    expect(second.status).toBe(201);
    expect(second.json).toMatchObject({ review: { status: 'PUBLISHED' } });
    const pub = (second.json as { review: { publishedAt: string } }).review.publishedAt;
    const both = await w.app.api.request('GET', w.base, { headers: w.host });
    expect(both.json).toMatchObject({
      mine: { status: 'PUBLISHED' },
      published: [
        { authorRole: 'GUEST', authorName: 'Ana', overall: 2, text: SECRET, publishedAt: pub },
        { authorRole: 'HOST', authorName: 'María', overall: 5, publishedAt: pub },
      ],
    });

    // avis reçus (droit d'accès) : le voyageur lit l'avis de l'hôte
    const received = await w.app.api.request('GET', '/reviews/received', { headers: w.guest });
    expect(received.status).toBe(200);
    expect(received.headers.get('cache-control')).toBe('no-store');
    expect(received.json).toMatchObject({
      code: 'REVIEWS_RECEIVED',
      messageKey: 'common.reviews.received',
      asGuest: { reviewCount: 1, averageX100: 500, reviews: [{ authorName: 'María' }] },
      asHost: null,
    });
    // le journal ne porte jamais une note ni un texte
    expect(w.logs.join('\n')).not.toContain('cigarro');
  });

  it('refus : une fois (409), texte exigé de 1 à 3 (422), note invalide (422), corps invalide (400), non JSON (415), trip d’un autre ou inconnu (404), sans session (401), fenêtre close ou pas ouverte (409)', async () => {
    const w = await world();
    const low = await w.app.api.request('POST', w.base, {
      headers: w.guest,
      body: { overall: 3, text: 'Corto.' },
    });
    expect(low.status).toBe(422);
    expect(low.json).toEqual({
      code: 'REVIEW_TEXT_REQUIRED',
      messageKey: 'common.reviews.textRequired',
    });
    const out = await w.app.api.request('POST', w.base, {
      headers: w.guest,
      body: { overall: 7 },
    });
    expect(out.status).toBe(422);
    expect(out.json).toEqual({ code: 'REVIEW_INVALID', messageKey: 'common.reviews.invalid' });
    for (const body of [
      {},
      { overall: '5' },
      { overall: 4.5 },
      { overall: 5, extra: true },
      { overall: 5, subScores: { stars: 5 } },
      { overall: 5, text: 42 },
    ]) {
      const r = await w.app.api.request('POST', w.base, { headers: w.guest, body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toEqual({ code: 'REQUEST_INVALID', messageKey: 'common.auth.requestInvalid' });
    }
    const notJson = await w.app.api.request('POST', w.base, textBody(w.app.cookie('voyageur')));
    expect(notJson.status).toBe(415);

    expect(
      (
        await w.app.api.request('POST', w.base, {
          headers: w.guest,
          body: { overall: 5, text: TEXT },
        })
      ).status,
    ).toBe(201);
    const twice = await w.app.api.request('POST', w.base, {
      headers: w.guest,
      body: { overall: 1, text: TEXT },
    });
    expect(twice.status).toBe(409);
    expect(twice.json).toEqual({
      code: 'REVIEW_ALREADY_SUBMITTED',
      messageKey: 'common.reviews.alreadySubmitted',
    });

    // trip d'un autre, inconnu, identifiant mal formé : même 404
    for (const path of [`/trips/${randomUUID()}/reviews`, '/trips/pas-un-uuid/reviews']) {
      for (const [method, body] of [
        ['GET', undefined],
        ['POST', { overall: 5 }],
      ] as const) {
        const r = await w.app.api.request(method, path, {
          headers: w.guest,
          ...(body !== undefined ? { body } : {}),
        });
        expect(r.status, `${method} ${path}`).toBe(404);
        expect(r.json).toEqual({ code: 'TRIP_NOT_FOUND', messageKey: 'common.trips.notFound' });
      }
    }
    // sans session
    for (const [method, path] of [
      ['GET', w.base],
      ['POST', w.base],
      ['GET', '/reviews/received'],
    ] as const) {
      const r = await w.app.api.request(method, path, {
        headers: JSON_HEADERS,
        ...(method === 'POST' ? { body: { overall: 5 } } : {}),
      });
      expect(r.status, `${method} ${path}`).toBe(401);
    }

    // fenêtre close (ni prolongation) ; voiture pas encore rendue
    w.store.now = new Date('2035-06-23T14:00:00.000Z');
    const closed = await w.app.api.request('POST', w.base, {
      headers: w.host,
      body: { overall: 5 },
    });
    expect(closed.status).toBe(409);
    expect(closed.json).toEqual({
      code: 'REVIEW_WINDOW_CLOSED',
      messageKey: 'common.reviews.windowClosed',
    });
    const early = randomUUID();
    w.store.addTrip(early, TIME_ZONE, null, 10);
    w.store.addParty(early, w.app.hash('voyageur'), 'GUEST', 'Ana');
    const notOpen = await w.app.api.request('POST', `/trips/${early}/reviews`, {
      headers: w.guest,
      body: { overall: 5 },
    });
    expect(notOpen.status).toBe(409);
    expect(notOpen.json).toEqual({ code: 'REVIEW_NOT_OPEN', messageKey: 'common.reviews.notOpen' });
  });

  it('profil public de l’hôte (LST-020) : prénom, ancienneté, trips, note, avis ; annonce inconnue ou mal formée ⇒ 404', async () => {
    const w = await world();
    const listing = randomUUID();
    w.store.addProfile(listing, {
      firstName: 'María',
      memberSince: '2034-11',
      tripCount: 4,
      reviewCount: 4,
      averageX100: 475,
      reviews: [
        {
          authorRole: 'GUEST',
          authorName: 'Ana',
          overall: 5,
          subScores: {},
          text: TEXT,
          publishedAt: '2035-06-14T12:00:00.000Z',
        },
      ],
    });
    const ok = await w.app.api.request('GET', `/listings/${listing}/host-profile`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.json).toEqual({
      code: 'HOST_PROFILE',
      messageKey: 'common.reviews.hostProfile',
      listingId: listing,
      firstName: 'María',
      memberSince: '2034-11',
      tripCount: 4,
      reviewCount: 4,
      averageX100: 475,
      reviews: [
        {
          authorRole: 'GUEST',
          authorName: 'Ana',
          overall: 5,
          subScores: {},
          text: TEXT,
          publishedAt: '2035-06-14T12:00:00.000Z',
        },
      ],
    });
    for (const id of [randomUUID(), 'pas-un-uuid']) {
      const r = await w.app.api.request('GET', `/listings/${id}/host-profile`);
      expect(r.status, id).toBe(404);
      expect(r.json).toEqual({ code: 'LISTING_NOT_FOUND', messageKey: 'common.listing.notFound' });
    }
  });

  it('fail-closed : base en échec ou sans adaptateur ⇒ 503 REVIEWS_UNAVAILABLE, SQLSTATE seul au journal', async () => {
    const w = await world();
    w.store.failWith = '55000';
    const calls = [
      ['GET', w.base, undefined],
      ['POST', w.base, { overall: 2, text: SECRET }],
      ['GET', '/reviews/received', undefined],
      ['GET', `/listings/${randomUUID()}/host-profile`, undefined],
    ] as const;
    for (const [method, path, body] of calls) {
      const r = await w.app.api.request(method, path, {
        headers: w.guest,
        ...(body !== undefined ? { body } : {}),
      });
      expect(r.status, path).toBe(503);
      expect(r.json).toEqual({
        code: 'REVIEWS_UNAVAILABLE',
        messageKey: 'common.reviews.unavailable',
      });
    }
    expect(w.logs.join('\n')).toContain('55000');
    expect(w.logs.join('\n')).not.toContain('cigarro');
    const bare = await startContractApp();
    apps.push(bare);
    const none = await bare.api.request('GET', `/trips/${randomUUID()}/reviews`, {
      headers: bare.cookie('voyageur'),
    });
    expect(none.status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/reviews est exercé', () => {
    expect(
      missingCoverage(contract, '/trips/{tripId}/reviews', coverageOf(...apps)),
      'statuts',
    ).toEqual([]);
  });

  it('couverture : chaque statut déclaré pour /reviews est exercé', () => {
    expect(missingCoverage(contract, '/reviews', coverageOf(...apps)), 'statuts').toEqual([]);
  });

  it('couverture : chaque statut déclaré pour /listings/{listingId}/host-profile est exercé', () => {
    expect(
      missingCoverage(contract, '/listings/{listingId}/host-profile', coverageOf(...apps)),
      'statuts',
    ).toEqual([]);
  });
});
