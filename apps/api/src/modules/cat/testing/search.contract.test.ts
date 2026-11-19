/**
 * Contrat HTTP de la recherche publique `/search` et `/search/areas` (US-201, US-203), sur l'application
 * RÉELLE (ApiModule, harnais d'US-043) : chaque réponse est confrontée à `openapi.json`.
 *
 * Attendus tirés de 19 US-201 (critère 1 : « début 10:00 et fin 09:30 le même jour ⇒
 * SEARCH_DATES_INVALID » ; critère 4 : zone approximative seule), de 16 SRC-001 (codes
 * `SEARCH_*`, pas de 30 min) et de 17 §2.3 (sonde limitée à `availability_probe_per_minute` par
 * IP, BOARD N-78) ; les règles de la base (hôte activable, disponibilité, préavis, fuseau, durée,
 * début passé, caution) sont prouvées en L0 (l0-us201-public-search, l0-us203-search-cards),
 * jamais par ce FAKE ; le total TTC du devis provisoire est prouvé dans PRC
 * (`search-pricer.test.ts`, TA01 et variante PYG des oracles).
 *
 * US-203 (19 US-203, 16 SRC-008, SRC-011) : chaque carte porte le total TTC et les jours facturés
 * du pricer, la caution rendue par la base (ou rien : mention générique), la note de REV (ou rien :
 * badge « Nuevo ») ; devis impossible ⇒ annonce exclue et alerte ops ; pricer ou notes en panne ⇒
 * 503 (jamais un total ou un badge inventés).
 *
 * US-701c (T70 c, ADR-173) : la caution de chaque carte est la décision de PAY (port
 * `ListingDepositPolicy`, FAKE ici ; la règle est prouvée dans `pay/internal/deposit-notice.test.ts`
 * avec l'oracle) sur la base rendue par la base (pays, classe) : montant, mention générique ou
 * caution non disponible ; jamais la classe ni un déclencheur dans la réponse ; panne ⇒ 503.
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
import type {
  ListingDepositPolicy,
  SearchPricer,
  SearchRatings,
} from '../internal/search/cards.js';
import type { AvailabilityProbeLimiter } from '../internal/search/search.service.js';
import type { SearchResult } from '../internal/search/store.js';
import {
  FakeDepositPolicy,
  fakeResult,
  FakeSearchPricer,
  FakeSearchRatings,
  FakeSearchStore,
} from './fake-search-store.js';

const apps: ContractApp[] = [];

/** Pricer de forme : 3 jours, total imposé par annonce (le moteur est prouvé dans PRC). */
function pricerFor(...results: SearchResult[]): FakeSearchPricer {
  const p = new FakeSearchPricer();
  for (const r of results) p.prices.set(r.id, { totalMinor: '12840', billableDays: 3 });
  return p;
}

async function app(
  store: FakeSearchStore,
  probe?: AvailabilityProbeLimiter,
  more: {
    readonly pricer?: SearchPricer;
    readonly ratings?: SearchRatings;
    readonly alertQuoteUnavailable?: (listingId: string, country: string) => void;
    readonly deposits?: ListingDepositPolicy;
  } = {},
) {
  const results = store.outcome.outcome === 'OK' ? store.outcome.results : [];
  const a = await startContractApp({
    search: {
      store,
      ...(probe ? { probe } : {}),
      pricer: more.pricer ?? pricerFor(...results),
      ...(more.ratings ? { ratings: more.ratings } : {}),
      ...(more.alertQuoteUnavailable ? { alertQuoteUnavailable: more.alertQuoteUnavailable } : {}),
      // US-701c : politique de caution imposée (mention générique par défaut)
      deposits: more.deposits ?? new FakeDepositPolicy(),
    },
  });
  apps.push(a);
  return a.api;
}

/** Carte attendue : colonnes C0 du résultat, sans l'instant du devis, plus prix et note. */
function cardOf(r: SearchResult, extra: Record<string, unknown> = {}) {
  const c0: { -readonly [K in keyof SearchResult]?: SearchResult[K] } = { ...r };
  delete c0.quotedAt;
  return {
    ...c0,
    depositAmountMinor: null,
    depositStatus: 'GENERIC',
    totalMinor: '12840',
    billableDays: 3,
    rating: null,
    protectionOffered: false,
    ...extra,
  };
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
    expect(r.json).toEqual({ results: [cardOf(fakeResult())] });
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

  it('US-203 : total TTC et jours du devis provisoire, caution de la base, note de REV ou badge « Nuevo » ; mêmes annonces dans le même ordre ; le pricer reçoit l’annonce, la période et l’instant de la base', async () => {
    const luxe = fakeResult({ id: '00000000-0000-4000-8000-0000000000d1' });
    const plain = fakeResult({
      id: '00000000-0000-4000-8000-0000000000d2',
      approximatePoint: null,
    });
    const store = new FakeSearchStore();
    store.outcome = { outcome: 'OK', results: [luxe, plain] };
    // US-205b : protection promise par la base pour la seule annonce couverte
    store.coveredListings.add(luxe.id);
    // US-701c : base de la caution rendue par la base, décision imposée au FAKE de PAY
    store.depositBases.set(luxe.id, { country: FIRST_COUNTRY, valueClass: 'LUXE' });
    store.depositBases.set(plain.id, { country: FIRST_COUNTRY, valueClass: 'STANDARD' });
    const deposits = new FakeDepositPolicy();
    deposits.notices.set(`${FIRST_COUNTRY}|LUXE`, { status: 'REQUIRED', amountMinor: '30000' });
    const pricer = pricerFor(luxe, plain);
    const ratings = new FakeSearchRatings();
    ratings.rows.set(plain.id, { averageX100: 480, reviewCount: 3, tripCount: 5 });
    const api = await app(store, undefined, { pricer, ratings, deposits });
    const r = await api.request('GET', q(VALID));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      results: [
        cardOf(luxe, {
          depositAmountMinor: '30000',
          depositStatus: 'REQUIRED',
          protectionOffered: true,
        }),
        cardOf(plain, { rating: { averageX100: 480, reviewCount: 3, tripCount: 5 } }),
      ],
    });
    expect(JSON.stringify(r.json)).not.toContain('quotedAt');
    expect(pricer.inputs).toEqual(
      [luxe, plain].map((x) => ({
        listingId: x.id,
        country: FIRST_COUNTRY,
        currency: x.currency,
        dailyPriceMinor: x.dailyPriceMinor,
        startAt: x.startAt,
        endAt: x.endAt,
        quotedAt: x.quotedAt,
      })),
    );
    expect(ratings.asked).toEqual([[luxe.id, plain.id]]);
    expect(store.depositBasisAsked).toEqual([[luxe.id, plain.id]]);
    expect(deposits.asked).toEqual([
      [FIRST_COUNTRY, 'LUXE'],
      [FIRST_COUNTRY, 'STANDARD'],
    ]);
    expect(JSON.stringify(r.json)).not.toMatch(/LUXE|STANDARD|valueClass|trigger/);
  });

  it('US-701c (T70 c) : caution non disponible (montant À DÉCIDER) ⇒ statut UNAVAILABLE sans montant ; annonce sans base (retirée) ⇒ classe inconnue (fail-closed) ; une décision par pays et classe ; politique ou base en panne ⇒ 503', async () => {
    const a = fakeResult({ id: '00000000-0000-4000-8000-0000000000f1' });
    const b = fakeResult({ id: '00000000-0000-4000-8000-0000000000f2' });
    const gone = fakeResult({ id: '00000000-0000-4000-8000-0000000000f3' });
    const store = new FakeSearchStore();
    store.outcome = { outcome: 'OK', results: [a, b, gone] };
    store.depositBases.set(a.id, { country: FIRST_COUNTRY, valueClass: 'LUXE' });
    store.depositBases.set(b.id, { country: FIRST_COUNTRY, valueClass: 'LUXE' });
    const deposits = new FakeDepositPolicy();
    deposits.notices.set(`${FIRST_COUNTRY}|LUXE`, { status: 'UNAVAILABLE' });
    deposits.notices.set(`${FIRST_COUNTRY}|`, { status: 'UNAVAILABLE' });
    const api = await app(store, undefined, { deposits });
    const r = await api.request('GET', q(VALID));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      results: [a, b, gone].map((x) => cardOf(x, { depositStatus: 'UNAVAILABLE' })),
    });
    expect(deposits.asked).toEqual([
      [FIRST_COUNTRY, 'LUXE'],
      [FIRST_COUNTRY, null],
    ]);
    deposits.down = true;
    expect((await api.request('GET', q(VALID))).status).toBe(503);
    const none = await app(store, undefined, {
      deposits: { notice: () => Promise.reject(new Error('aucune politique')) },
    });
    expect((await none.request('GET', q(VALID))).status).toBe(503);
  });

  it('US-203 : devis impossible ⇒ annonce exclue et alerte ops (identifiant seul) ; pricer ou notes en panne ⇒ 503', async () => {
    const ok = fakeResult({ id: '00000000-0000-4000-8000-0000000000e1' });
    const noQuote = fakeResult({ id: '00000000-0000-4000-8000-0000000000e2' });
    const store = new FakeSearchStore();
    store.outcome = { outcome: 'OK', results: [noQuote, ok] };
    const alerts: [string, string][] = [];
    const api = await app(store, undefined, {
      pricer: pricerFor(ok),
      alertQuoteUnavailable: (id, country) => alerts.push([id, country]),
    });
    const r = await api.request('GET', q(VALID));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ results: [cardOf(ok)] });
    expect(alerts).toEqual([[noQuote.id, FIRST_COUNTRY]]);
    const brokenPricer = new FakeSearchPricer();
    brokenPricer.down = true;
    const down = await app(store, undefined, { pricer: brokenPricer });
    const d = await down.request('GET', q(VALID));
    expect(d.status).toBe(503);
    expect(d.json).toEqual({ code: 'SEARCH_UNAVAILABLE', messageKey: 'common.search.unavailable' });
    const brokenRatings = new FakeSearchRatings();
    brokenRatings.down = true;
    const noRatings = await app(store, undefined, {
      pricer: pricerFor(ok, noQuote),
      ratings: brokenRatings,
    });
    expect((await noRatings.request('GET', q(VALID))).status).toBe(503);
    // sans pricer câblé (production sans adaptateur) : 503 dès qu'il y a un résultat
    const bare = await startContractApp({ search: { store } });
    apps.push(bare);
    expect((await bare.api.request('GET', q(VALID))).status).toBe(503);
  });

  it('couverture : chaque statut déclaré pour /search est exercé', () => {
    expect(missingCoverage(contract, '/search', coverageOf(...apps))).toEqual([]);
  });
});
