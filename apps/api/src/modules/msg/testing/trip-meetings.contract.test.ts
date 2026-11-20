/**
 * US-316 — tests de contrat des routes `/trips/{tripId}/meetings` sur l'application RÉELLE
 * (ApiModule, harnais d'US-043) et le FAKE du magasin (sans base) : chaque réponse est confrontée à
 * `apps/api/openapi/openapi.json`. Attendus : 19 US-316 (critère 4 : proposition de l'hôte acceptée
 * par le voyageur ⇒ rendez-vous du trip ; critère 1 : aucun contact servi, aucune pièce jointe),
 * 17 §2.3 point 5 (trip d'un autre : même 404 qu'un trip inconnu), ADR-186 (lieu sans
 * coordonnées, aucun lieu dans un journal). Les règles elles-mêmes (parties, bornes de l'heure,
 * statuts du trip, coordonnées, événement) sont prouvées sur PostgreSQL
 * (packages/db/test/l0/l0-us316-messaging-privacy.test.ts), en PA et en PY. Données fictives.
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
import { FakeTripMeetingStore } from './fake-trip-meeting-store.js';
import { FakeTripMessageStore } from './fake-trip-message-store.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const PLACE = 'Estacionamiento del centro comercial, entrada norte';
const MEET_AT = '2035-06-10T14:00:00.000Z';
/** Fuseau du premier pays déclaré par CFG (jamais en constante, ADR-024). */
const TIME_ZONE = new CountryConfigService().config.countries.get(FIRST_COUNTRY)?.timeZone ?? '';

interface World {
  readonly app: ContractApp;
  readonly meetings: FakeTripMeetingStore;
  readonly logs: string[];
  readonly trip: string;
  readonly base: string;
  readonly guest: Record<string, string>;
  readonly host: Record<string, string>;
}

const apps: ContractApp[] = [];
afterAll(closeContractApps);

async function world(): Promise<World> {
  const meetings = new FakeTripMeetingStore();
  const logs: string[] = [];
  const app = await startContractApp({
    msg: {
      store: new FakeTripMessageStore(),
      meetings,
      log: { warn: (message, fields) => logs.push(JSON.stringify({ message, ...fields })) },
    },
  });
  apps.push(app);
  const trip = randomUUID();
  meetings.addTrip(trip, TIME_ZONE);
  meetings.addParty(trip, app.hash('voyageur'), 'GUEST', 'u-guest');
  meetings.addParty(trip, app.hash('staff_sans_mfa'), 'HOST', 'u-host');
  return {
    app,
    meetings,
    logs,
    trip,
    base: `/trips/${trip}/meetings`,
    guest: { ...app.cookie('voyageur'), ...JSON_HEADERS },
    host: { ...app.cookie('staff_sans_mfa'), ...JSON_HEADERS },
  };
}

describe('US-316 — rendez-vous du trip (S16)', () => {
  it('critère 4 : l’hôte propose, le voyageur accepte ⇒ rendez-vous du trip et événement sans lieu ; no-store ; réessais sans doublon', async () => {
    const w = await world();
    const empty = await w.app.api.request('GET', w.base, { headers: w.guest });
    expect(empty.status).toBe(200);
    expect(empty.headers.get('cache-control')).toBe('no-store');
    expect(empty.json).toEqual({
      code: 'TRIP_MEETINGS',
      messageKey: 'common.meetings.list',
      tripId: w.trip,
      viewerRole: 'GUEST',
      canPropose: false,
      timezone: TIME_ZONE,
      meetings: [],
    });
    const id = randomUUID();
    const p = await w.app.api.request('POST', w.base, {
      headers: w.host,
      body: { id, kind: 'PICKUP', place: PLACE, meetAt: MEET_AT },
    });
    expect(p.status).toBe(201);
    expect(p.headers.get('cache-control')).toBe('no-store');
    expect(p.json).toEqual({
      code: 'MEETING_PROPOSED',
      messageKey: 'common.meetings.proposed',
      meeting: { id, kind: 'PICKUP', place: PLACE, meetAt: MEET_AT, status: 'PROPOSED' },
    });
    // réessai : même identifiant ⇒ la proposition d'origine
    const again = await w.app.api.request('POST', w.base, {
      headers: w.host,
      body: { id, kind: 'PICKUP', place: 'Otro lugar', meetAt: MEET_AT },
    });
    expect(again.status).toBe(201);
    expect(again.json).toMatchObject({ meeting: { id, place: PLACE } });

    const listed = await w.app.api.request('GET', w.base, { headers: w.guest });
    expect(listed.json).toMatchObject({
      meetings: [
        { id, kind: 'PICKUP', place: PLACE, meetAt: MEET_AT, status: 'PROPOSED', mine: false },
      ],
    });
    const a = await w.app.api.request('POST', `${w.base}/${id}/answer`, {
      headers: w.guest,
      body: { decision: 'ACCEPT' },
    });
    expect(a.status).toBe(200);
    expect(a.headers.get('cache-control')).toBe('no-store');
    expect(a.json).toEqual({
      code: 'MEETING_ANSWERED',
      messageKey: 'common.meetings.answered',
      meeting: { id, kind: 'PICKUP', meetAt: MEET_AT, status: 'ACCEPTED' },
    });
    const replay = await w.app.api.request('POST', `${w.base}/${id}/answer`, {
      headers: w.guest,
      body: { decision: 'ACCEPT' },
    });
    expect(replay.status).toBe(200);
    expect(w.meetings.events).toEqual([
      { trip_id: w.trip, meeting_id: id, kind: 'PICKUP', meet_at: MEET_AT },
    ]);
    const host = await w.app.api.request('GET', w.base, { headers: w.host });
    expect(host.json).toMatchObject({
      viewerRole: 'HOST',
      canPropose: true,
      meetings: [{ id, status: 'ACCEPTED', mine: true }],
    });
    // aucun lieu dans un journal
    expect([...w.logs, ...w.app.h.logs].join('\n')).not.toContain('Estacionamiento');
  });

  it('critère 1 : aucune donnée de contact servie ; aucune pièce jointe acceptée', async () => {
    const w = await world();
    await w.app.api.request('POST', w.base, {
      headers: w.host,
      body: { id: randomUUID(), kind: 'PICKUP', place: PLACE, meetAt: MEET_AT },
    });
    const r = await w.app.api.request('GET', w.base, { headers: w.guest });
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object' && v !== null) {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    walk(r.json);
    for (const k of keys) {
      expect(k).not.toMatch(
        /phone|email|mail|lastName|license|licence|document|attachment|photo|exif|gps|address/i,
      );
    }
    // texte seul : un champ de pièce jointe est refusé, pour un message comme pour un rendez-vous
    for (const [path, body] of [
      [`/trips/${w.trip}/messages`, { id: randomUUID(), body: 'hola', attachment: 'x.jpg' }],
      [w.base, { id: randomUUID(), kind: 'PICKUP', place: PLACE, meetAt: MEET_AT, photo: 'x' }],
    ] as const) {
      const p = await w.app.api.request('POST', path, { headers: w.host, body });
      expect(p.status, path).toBe(400);
      expect(p.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
  });

  it('IDOR : trip dont la session n’est pas partie, inconnu ou mal formé ⇒ 404 TRIP_NOT_FOUND ; proposition inconnue ⇒ 404 MEETING_NOT_FOUND', async () => {
    const w = await world();
    for (const path of [`/trips/${randomUUID()}/meetings`, '/trips/pas-un-uuid/meetings']) {
      const g = await w.app.api.request('GET', path, { headers: w.guest });
      expect(g.status, path).toBe(404);
      expect(g.json).toEqual({ code: 'TRIP_NOT_FOUND', messageKey: 'common.trips.notFound' });
      const p = await w.app.api.request('POST', path, {
        headers: w.host,
        body: { id: randomUUID(), kind: 'PICKUP', place: PLACE, meetAt: MEET_AT },
      });
      expect(p.status, path).toBe(404);
    }
    for (const meeting of [randomUUID(), 'pas-un-uuid']) {
      const a = await w.app.api.request('POST', `${w.base}/${meeting}/answer`, {
        headers: w.guest,
        body: { decision: 'ACCEPT' },
      });
      expect(a.status, meeting).toBe(404);
      expect(a.json).toEqual({ code: 'MEETING_NOT_FOUND', messageKey: 'common.meetings.notFound' });
    }
  });

  it('refus : 400 corps invalide, 401 sans session, 403 mauvais rôle, 409 déjà répondue ou passée, 415 hors JSON, 422 lieu invalide ou avec coordonnées', async () => {
    const w = await world();
    for (const body of [
      {},
      { id: 'x', kind: 'PICKUP', place: PLACE, meetAt: MEET_AT },
      { id: randomUUID(), kind: 'ELSEWHERE', place: PLACE, meetAt: MEET_AT },
      { id: randomUUID(), kind: 'PICKUP', place: 12, meetAt: MEET_AT },
      { id: randomUUID(), kind: 'PICKUP', place: PLACE, meetAt: 'demain' },
      { id: randomUUID(), kind: 'PICKUP', place: PLACE, meetAt: '2035-06-10T14:00:00-05:00' },
      [],
    ]) {
      const r = await w.app.api.request('POST', w.base, { headers: w.host, body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    for (const method of ['GET', 'POST'] as const) {
      const r = await w.app.api.request(method, w.base, {
        headers: JSON_HEADERS,
        ...(method === 'POST'
          ? { body: { id: randomUUID(), kind: 'PICKUP', place: PLACE, meetAt: MEET_AT } }
          : {}),
      });
      expect(r.status, method).toBe(401);
    }
    const unauth = await w.app.api.request('POST', `${w.base}/${randomUUID()}/answer`, {
      headers: JSON_HEADERS,
      body: { decision: 'ACCEPT' },
    });
    expect(unauth.status).toBe(401);
    expect(
      (await w.app.api.request('POST', w.base, textBody(w.app.cookie('staff_sans_mfa')))).status,
    ).toBe(415);
    expect(
      (
        await w.app.api.request(
          'POST',
          `${w.base}/${randomUUID()}/answer`,
          textBody(w.app.cookie('voyageur')),
        )
      ).status,
    ).toBe(415);
    // le voyageur ne propose pas
    const byGuest = await w.app.api.request('POST', w.base, {
      headers: w.guest,
      body: { id: randomUUID(), kind: 'PICKUP', place: PLACE, meetAt: MEET_AT },
    });
    expect(byGuest.status).toBe(403);
    expect(byGuest.json).toEqual({
      code: 'MEETING_NOT_ALLOWED',
      messageKey: 'common.meetings.notAllowed',
    });
    // lieu trop court, trop long, ou avec des coordonnées
    for (const [place, code] of [
      ['ab', 'MEETING_INVALID'],
      ['x'.repeat(161), 'MEETING_INVALID'],
      ['x'.repeat(400), 'MEETING_INVALID'],
      ['Llámame al 6123-4567 y te digo', 'MEETING_PLACE_CONTACT'],
      ['Escribe a ana@correo.test', 'MEETING_PLACE_CONTACT'],
    ] as const) {
      const r = await w.app.api.request('POST', w.base, {
        headers: w.host,
        body: { id: randomUUID(), kind: 'PICKUP', place, meetAt: MEET_AT },
      });
      expect(r.status, place).toBe(422);
      expect(r.json).toMatchObject({ code });
    }
    expect(w.logs.join('\n')).not.toContain('6123-4567');
    const id = randomUUID();
    await w.app.api.request('POST', w.base, {
      headers: w.host,
      body: { id, kind: 'RETURN', place: PLACE, meetAt: '2035-06-13T15:00:00.000Z' },
    });
    for (const body of [{}, { decision: 'MAYBE' }, { decision: 'ACCEPT', extra: 1 }]) {
      const r = await w.app.api.request('POST', `${w.base}/${id}/answer`, {
        headers: w.guest,
        body,
      });
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    // l'hôte ne répond pas
    const byHost = await w.app.api.request('POST', `${w.base}/${id}/answer`, {
      headers: w.host,
      body: { decision: 'ACCEPT' },
    });
    expect(byHost.status).toBe(403);
    // refusée puis acceptée : 409 ; heure passée : 409 MEETING_EXPIRED
    await w.app.api.request('POST', `${w.base}/${id}/answer`, {
      headers: w.guest,
      body: { decision: 'DECLINE' },
    });
    const late = await w.app.api.request('POST', `${w.base}/${id}/answer`, {
      headers: w.guest,
      body: { decision: 'ACCEPT' },
    });
    expect(late.status).toBe(409);
    expect(late.json).toEqual({
      code: 'MEETING_NOT_PENDING',
      messageKey: 'common.meetings.notPending',
    });
    const soon = randomUUID();
    await w.app.api.request('POST', w.base, {
      headers: w.host,
      body: { id: soon, kind: 'PICKUP', place: PLACE, meetAt: MEET_AT },
    });
    w.meetings.now = new Date('2035-06-11T00:00:00.000Z');
    const expired = await w.app.api.request('POST', `${w.base}/${soon}/answer`, {
      headers: w.guest,
      body: { decision: 'ACCEPT' },
    });
    expect(expired.status).toBe(409);
    expect(expired.json).toEqual({
      code: 'MEETING_EXPIRED',
      messageKey: 'common.meetings.expired',
    });
  });

  it('fail-closed : base en échec ou sans adaptateur ⇒ 503 MESSAGES_UNAVAILABLE, SQLSTATE seul au journal', async () => {
    const w = await world();
    w.meetings.failWith = '55000';
    const calls = [
      ['GET', w.base, undefined],
      ['POST', w.base, { id: randomUUID(), kind: 'PICKUP', place: PLACE, meetAt: MEET_AT }],
      ['POST', `${w.base}/${randomUUID()}/answer`, { decision: 'ACCEPT' }],
    ] as const;
    for (const [method, path, body] of calls) {
      const r = await w.app.api.request(method, path, {
        headers: w.host,
        ...(body !== undefined ? { body } : {}),
      });
      expect(r.status, path).toBe(503);
      expect(r.json).toEqual({
        code: 'MESSAGES_UNAVAILABLE',
        messageKey: 'common.messages.unavailable',
      });
    }
    expect(w.logs.join('\n')).toContain('55000');
    expect(w.logs.join('\n')).not.toContain('Estacionamiento');
    const bare = await startContractApp();
    apps.push(bare);
    const none = await bare.api.request('GET', `/trips/${randomUUID()}/meetings`, {
      headers: bare.cookie('voyageur'),
    });
    expect(none.status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/meetings est exercé', () => {
    expect(
      missingCoverage(contract, '/trips/{tripId}/meetings', coverageOf(...apps)),
      'statuts',
    ).toEqual([]);
  });
});
