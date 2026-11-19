/**
 * US-525 — tests de contrat des routes `/trips/{tripId}/messages` sur l'application RÉELLE
 * (ApiModule, harnais d'US-043) et le FAKE du magasin (sans base) : chaque réponse est confrontée à
 * `apps/api/openapi/openapi.json`. Attendus : 19 US-525 (numéro masqué et message signalé ; un
 * visiteur sans trip ne peut pas écrire ; rappel à l'expéditeur qu'un paiement passe par la
 * plateforme), 16 MSG-001 / MSG-007 (prénoms seulement ; fil en lecture seule après la fenêtre :
 * MESSAGE_THREAD_CLOSED), 17 §2.3 point 5 (trip d'un autre : même 404 qu'un trip inconnu). Aucun
 * texte de message dans un journal. Les règles elles-mêmes (parties, masquage, corpus, signal,
 * fenêtre) sont prouvées sur PostgreSQL (packages/db/test/l0/l0-us525-messaging.test.ts), en PA et
 * en PY. Données fictives.
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
import { FakeTripMessageStore } from './fake-trip-message-store.js';

const JSON_HEADERS = { 'content-type': 'application/json' };
const PHONE = '+1 555 0123 4567';
/** Fuseau du premier pays déclaré par CFG (jamais en constante, ADR-024). */
const TIME_ZONE = new CountryConfigService().config.countries.get(FIRST_COUNTRY)?.timeZone ?? '';

interface World {
  readonly app: ContractApp;
  readonly store: FakeTripMessageStore;
  readonly logs: string[];
  readonly trip: string;
  readonly base: string;
  readonly headers: Record<string, string>;
}

const apps: ContractApp[] = [];
afterAll(closeContractApps);

async function world(): Promise<World> {
  const store = new FakeTripMessageStore();
  const logs: string[] = [];
  const app = await startContractApp({
    msg: {
      store,
      log: { warn: (message, fields) => logs.push(JSON.stringify({ message, ...fields })) },
    },
  });
  apps.push(app);
  const trip = randomUUID();
  store.addTrip(trip, new Date('2035-06-23T15:00:00.000Z'), TIME_ZONE);
  store.addParty(trip, app.hash('voyageur'), 'GUEST', 'u-guest', 'Ana');
  store.addParty(trip, 'hote', 'HOST', 'u-host', 'María');
  return {
    app,
    store,
    logs,
    trip,
    base: `/trips/${trip}/messages`,
    headers: { ...app.cookie('voyageur'), ...JSON_HEADERS },
  };
}

describe('US-525 — messagerie par trip (S16)', () => {
  it('GET : fil vide de la partie de la session, prénom de l’autre partie, fenêtre ; no-store', async () => {
    const w = await world();
    const r = await w.app.api.request('GET', w.base, { headers: w.headers });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toEqual({
      code: 'TRIP_MESSAGES',
      messageKey: 'common.messages.thread',
      tripId: w.trip,
      viewerRole: 'GUEST',
      counterpartName: 'María',
      writable: true,
      closesAt: '2035-06-23T15:00:00.000Z',
      timezone: TIME_ZONE,
      messages: [],
    });
  });

  it('critère 1 : numéro masqué, rappel CONTACT_MASKED ; critère 2 : rappel OFF_PLATFORM_PAYMENT ; aucun texte dans les journaux', async () => {
    const w = await world();
    const id = randomUUID();
    const r = await w.app.api.request('POST', w.base, {
      headers: w.headers,
      body: { id, body: `escríbeme al ${PHONE}` },
    });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toMatchObject({
      code: 'MESSAGE_SENT',
      messageKey: 'common.messages.sent',
      message: { id, body: 'escríbeme al •••', masked: true, offPlatform: false },
      notices: ['CONTACT_MASKED'],
    });
    // le texte reçu reste comme preuve, jamais servi
    expect(w.store.originalOf(id)).toBe(`escríbeme al ${PHONE}`);
    const cash = await w.app.api.request('POST', w.base, {
      headers: w.headers,
      body: { id: randomUUID(), body: 'te pago en efectivo' },
    });
    expect(cash.status).toBe(201);
    expect(cash.json).toMatchObject({
      message: { body: 'te pago en efectivo', masked: false, offPlatform: true },
      notices: ['OFF_PLATFORM_PAYMENT'],
    });
    // réessai : même identifiant ⇒ le message d'origine, sans doublon
    const again = await w.app.api.request('POST', w.base, {
      headers: w.headers,
      body: { id, body: 'autre texte' },
    });
    expect(again.status).toBe(201);
    expect(again.json).toMatchObject({ message: { id, body: 'escríbeme al •••' } });
    const thread = await w.app.api.request('GET', w.base, { headers: w.headers });
    expect(thread.status).toBe(200);
    const messages = (thread.json as { messages: Record<string, unknown>[] }).messages;
    expect(messages.map((m) => [m['body'], m['mine'], m['authorRole'], m['offPlatform']])).toEqual([
      ['escríbeme al •••', true, 'GUEST', false],
      ['te pago en efectivo', true, 'GUEST', true],
    ]);
    // journaux : codes seulement, jamais le texte ni le numéro
    const logged = [...w.logs, ...w.app.h.logs].join('\n');
    expect(logged).toContain('MESSAGE_FLAGGED');
    for (const secret of [PHONE, 'escríbeme', 'efectivo', 'autre texte']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('IDOR : trip dont la session n’est pas partie (visiteur sans trip), inconnu ou identifiant mal formé ⇒ 404 TRIP_NOT_FOUND, rien d’écrit', async () => {
    const w = await world();
    for (const path of [`/trips/${randomUUID()}/messages`, '/trips/pas-un-uuid/messages']) {
      const g = await w.app.api.request('GET', path, { headers: w.headers });
      expect(g.status, path).toBe(404);
      expect(g.json).toEqual({ code: 'TRIP_NOT_FOUND', messageKey: 'common.trips.notFound' });
      const p = await w.app.api.request('POST', path, {
        headers: w.headers,
        body: { id: randomUUID(), body: 'hola' },
      });
      expect(p.status, path).toBe(404);
      expect(p.json).toEqual({ code: 'TRIP_NOT_FOUND', messageKey: 'common.trips.notFound' });
    }
  });

  it('refus : 400 corps invalide, 401 sans session, 409 fil fermé, 415 hors JSON, 422 texte vide ou trop long', async () => {
    const w = await world();
    for (const body of [
      {},
      { id: 'x', body: 'hola' },
      { id: randomUUID() },
      { id: randomUUID(), body: 12 },
      { id: randomUUID(), body: 'hola', extra: true },
      [],
    ]) {
      const r = await w.app.api.request('POST', w.base, { headers: w.headers, body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    for (const method of ['GET', 'POST'] as const) {
      const r = await w.app.api.request(method, w.base, {
        headers: JSON_HEADERS,
        ...(method === 'POST' ? { body: { id: randomUUID(), body: 'hola' } } : {}),
      });
      expect(r.status, method).toBe(401);
    }
    const notJson = await w.app.api.request('POST', w.base, textBody(w.app.cookie('voyageur')));
    expect(notJson.status).toBe(415);
    for (const text of ['   ', 'x'.repeat(2001), 'x'.repeat(4001)]) {
      const r = await w.app.api.request('POST', w.base, {
        headers: w.headers,
        body: { id: randomUUID(), body: text },
      });
      expect(r.status).toBe(422);
      expect(r.json).toEqual({ code: 'MESSAGE_INVALID', messageKey: 'common.messages.invalid' });
    }
    w.store.close(w.trip);
    const closed = await w.app.api.request('POST', w.base, {
      headers: w.headers,
      body: { id: randomUUID(), body: 'hola' },
    });
    expect(closed.status).toBe(409);
    expect(closed.json).toEqual({
      code: 'MESSAGE_THREAD_CLOSED',
      messageKey: 'common.messages.threadClosed',
    });
    const read = await w.app.api.request('GET', w.base, { headers: w.headers });
    expect(read.json).toMatchObject({ writable: false });
  });

  it('fail-closed : base en échec ou sans adaptateur ⇒ 503 MESSAGES_UNAVAILABLE, SQLSTATE seul au journal', async () => {
    const w = await world();
    w.store.failWith = '55000';
    for (const method of ['GET', 'POST'] as const) {
      const r = await w.app.api.request(method, w.base, {
        headers: w.headers,
        ...(method === 'POST' ? { body: { id: randomUUID(), body: `llámame ${PHONE}` } } : {}),
      });
      expect(r.status, method).toBe(503);
      expect(r.json).toEqual({
        code: 'MESSAGES_UNAVAILABLE',
        messageKey: 'common.messages.unavailable',
      });
    }
    expect(w.logs.join('\n')).toContain('55000');
    expect(w.logs.join('\n')).not.toContain(PHONE);
    const bare = await startContractApp();
    apps.push(bare);
    const none = await bare.api.request('GET', `/trips/${randomUUID()}/messages`, {
      headers: bare.cookie('voyageur'),
    });
    expect(none.status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /trips/{tripId}/messages est exercé', () => {
    expect(
      missingCoverage(contract, '/trips/{tripId}/messages', coverageOf(...apps)),
      'statuts',
    ).toEqual([]);
  });
});
