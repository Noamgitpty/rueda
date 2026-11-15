/**
 * Contrat HTTP de la recherche publique `/search` et `/search/areas` (US-201), sur l'application
 * RÉELLE (ApiModule, harnais d'US-043) : chaque réponse est confrontée à `openapi.json`.
 *
 * Attendus tirés de 19 US-201 (critère 1 : « début 10:00 et fin 09:30 le même jour ⇒
 * SEARCH_DATES_INVALID » ; critère 4 : zone approximative seule), de 16 SRC-001 (codes
 * `SEARCH_*`, pas de 30 min) et de 17 §2.3 (sonde limitée à `availability_probe_per_minute` par
 * IP, BOARD N-78) ; les règles de la base (hôte activable, disponibilité, préavis, fuseau, durée,
 * début passé) sont prouvées en L0 (l0-us201-public-search), jamais par ce FAKE.
 */
import { afterAll, describe, expect, it } from 'vitest';
import {
  closeContractApps,
  contract,
  coverageOf,
  FIRST_COUNTRY,
  startContractApp,
} from '../../../testing/contract/support.js';
import type { ContractApp } from '../../../testing/contract/support.js';
import { missingCoverage } from '../../../testing/openapi-contract.js';
import type { AvailabilityProbeLimiter } from '../internal/search/search.service.js';
import { fakeResult, FakeSearchStore } from './fake-search-store.js';

const apps: ContractApp[] = [];

async function app(store: FakeSearchStore, probe?: AvailabilityProbeLimiter) {
  const a = await startContractApp({ search: { store, ...(probe ? { probe } : {}) } });
  apps.push(a);
  return a.api;
}

const q = (p: Record<string, string>): string => `/search?${new URLSearchParams(p).toString()}`;
const VALID = {
  country: FIRST_COUNTRY,
  city: 'Ciudad',
  area: 'Barrio Norte',
  start: '2036-12-10T10:00',
  end: '2036-12-12T10:00',
};

describe('US-201 — contrat de la recherche publique', () => {
  afterAll(async () => {
    await closeContractApps();
  });

  it('zones : liste du pays (ou de tous les pays), sans cache ; pays mal formé ⇒ 400', async () => {
    const store = new FakeSearchStore();
    store.areaRows = [
      { country: FIRST_COUNTRY, city: 'Ciudad', area: 'Barrio Norte', timezone: 'UTC' },
      { country: FIRST_COUNTRY, city: 'Ciudad', area: null, timezone: 'UTC' },
    ];
    const api = await app(store);
    const r = await api.request('GET', `/search/areas?country=${FIRST_COUNTRY}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toEqual({ areas: store.areaRows });
    expect(store.lastAreasCountry).toBe(FIRST_COUNTRY);
    expect((await api.request('GET', '/search/areas')).status).toBe(200);
    expect(store.lastAreasCountry).toBeNull();
    for (const bad of ['zz', 'ZZZ', '1']) {
      const b = await api.request('GET', `/search/areas?country=${bad}`);
      expect(b.status).toBe(400);
      expect(b.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
  });

  it('recherche valide : résultats C0 rendus tels quels, requête transmise à la base sans transformation', async () => {
    const store = new FakeSearchStore();
    store.outcome = { outcome: 'OK', results: [fakeResult()] };
    const api = await app(store);
    const r = await api.request('GET', q(VALID));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toEqual({ results: [fakeResult()] });
    expect(store.lastQuery).toEqual({
      country: FIRST_COUNTRY,
      city: 'Ciudad',
      area: 'Barrio Norte',
      startLocal: '2036-12-10T10:00',
      endLocal: '2036-12-12T10:00',
      limit: null,
    });
    // zone vide : toute la ville ; nombre de résultats transmis
    await api.request('GET', q({ ...VALID, area: '', limit: '5' }));
    expect(store.lastQuery).toMatchObject({ area: null, limit: 5 });
    // aucun résultat : liste vide (SEARCH_NO_RESULTS est un état, 16 SRC-008)
    store.outcome = { outcome: 'OK', results: [] };
    expect((await api.request('GET', q(VALID))).json).toEqual({ results: [] });
  });

  it('critère 1 : début 10:00 et fin 09:30 le même jour ⇒ 422 SEARCH_DATES_INVALID, sans appel de la base ; pas de 30 min, format', async () => {
    const store = new FakeSearchStore();
    const api = await app(store);
    for (const [start, end] of [
      ['2036-12-10T10:00', '2036-12-10T09:30'],
      ['2036-12-10T10:00', '2036-12-10T10:00'],
      ['2036-12-10T10:15', '2036-12-12T10:00'],
      ['2036-02-30T10:00', '2036-03-02T10:00'],
      ['2036-12-10 10:00', '2036-12-12T10:00'],
      ['2036-12-10T10:00Z', '2036-12-12T10:00'],
      ['', '2036-12-12T10:00'],
    ] as const) {
      const r = await api.request('GET', q({ ...VALID, start, end }));
      expect(r.status, `${start} → ${end}`).toBe(422);
      expect(r.json).toEqual({
        code: 'SEARCH_DATES_INVALID',
        messageKey: 'common.search.datesInvalid',
      });
    }
    expect(store.lastQuery).toBeNull();
  });

  it('lieu absent ⇒ 422 SEARCH_LOCATION_REQUIRED ; nombre de résultats hors bornes ⇒ 400', async () => {
    const store = new FakeSearchStore();
    const api = await app(store);
    for (const p of [
      { ...VALID, city: '' },
      { ...VALID, city: '   ' },
      { ...VALID, country: 'zz' },
      { ...VALID, city: 'x'.repeat(121) },
    ]) {
      const r = await api.request('GET', q(p));
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ code: 'SEARCH_LOCATION_REQUIRED' });
    }
    for (const limit of ['0', '51', 'abc']) {
      const r = await api.request('GET', q({ ...VALID, limit }));
      expect(r.status).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    expect(store.lastQuery).toBeNull();
  });

  it('issues de la base : SEARCH_DATES_INVALID (début passé), SEARCH_DURATION_EXCEEDED, SEARCH_LOCATION_REQUIRED (pays inconnu) ⇒ 422 ; SEARCH_UNAVAILABLE et panne ⇒ 503', async () => {
    const store = new FakeSearchStore();
    const api = await app(store);
    for (const code of [
      'SEARCH_DATES_INVALID',
      'SEARCH_DURATION_EXCEEDED',
      'SEARCH_LOCATION_REQUIRED',
    ] as const) {
      store.outcome = { outcome: code };
      const r = await api.request('GET', q(VALID));
      expect(r.status).toBe(422);
      expect(r.json).toMatchObject({ code });
    }
    store.outcome = { outcome: 'SEARCH_UNAVAILABLE' };
    expect((await api.request('GET', q(VALID))).status).toBe(503);
    store.down = true;
    const down = await api.request('GET', q(VALID));
    expect(down.status).toBe(503);
    expect(down.json).toEqual({
      code: 'SEARCH_UNAVAILABLE',
      messageKey: 'common.search.unavailable',
    });
    const areas = await api.request('GET', '/search/areas');
    expect(areas.status).toBe(503);
    expect(areas.json).toMatchObject({ code: 'SEARCH_UNAVAILABLE' });
  });

  it('sonde de disponibilité (N-78) : au-delà de la limite ⇒ 429 RATE_LIMITED et Retry-After, sans appel de la base ; limiteur en panne ⇒ 503', async () => {
    const store = new FakeSearchStore();
    let calls = 0;
    const limited: AvailabilityProbeLimiter = {
      hit: (ip, country) => {
        calls += 1;
        expect(ip).not.toBe('');
        expect(country).toBe(FIRST_COUNTRY);
        return Promise.resolve(calls > 2 ? 17 : null);
      },
    };
    const api = await app(store, limited);
    expect((await api.request('GET', q(VALID))).status).toBe(200);
    expect((await api.request('GET', q(VALID))).status).toBe(200);
    store.lastQuery = null;
    const r = await api.request('GET', q(VALID));
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('17');
    expect(r.json).toEqual({
      code: 'RATE_LIMITED',
      messageKey: 'common.rateLimit.retryLater',
      values: { retryAfterS: 17 },
    });
    expect(store.lastQuery).toBeNull();
    // une requête refusée par la forme ne compte pas de sonde
    const before = calls;
    await api.request('GET', q({ ...VALID, end: '2036-12-10T09:30' }));
    expect(calls).toBe(before);
    const broken = await app(new FakeSearchStore(), {
      hit: () => Promise.reject(new Error('compteur en panne')),
    });
    expect((await broken.request('GET', q(VALID))).status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /search est exercé', () => {
    expect(missingCoverage(contract, '/search', coverageOf(...apps))).toEqual([]);
  });
});
