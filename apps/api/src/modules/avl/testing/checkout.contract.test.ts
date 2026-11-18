/**
 * Contrat HTTP du checkout (US-208, partie back-end ; écran S05 ; ADR-133) sur l'application RÉELLE
 * (ApiModule, harnais d'US-043) : `POST /checkout/quotes`, `GET /checkout/quotes/{id}`,
 * `POST /checkout/quotes/{id}/hold`, `GET /checkout/holds/{id}`. Chaque réponse est confrontée à
 * `openapi.json`.
 *
 * Attendus tirés de 19 US-208 et 16 BKG-001, BKG-006, PRC-025, et des oracles Python
 * (`docs/specs/tools/golden_vectors.json`, lus par `@rueda/money/golden-vectors`), jamais du code
 * testé :
 * - critère 1, TA01 (16 A.8.1, configuration « PA1 » : taxe de 7 % sur le loyer seul, ni trip fee
 *   ni protection) : le devis figé envoyé à la base porte 40,00 × 3 j ⇒ total 128,40 (« TA01
 *   refund » = total) ;
 * - critère 4, variante sans décimale : trip D2 de 08 (T40) sans ses lignes non taxées ⇒ total de
 *   l'oracle moins ces lignes, à l'unité près ;
 * - US-226 (protection du voyageur, ADR-136) : grille de TEST de 16 PRC-018 (BASICA 1/4, trip A de
 *   08 : protection 30,00 ; ESTANDAR 2/5, « taux de test de 40 % » ; TOTAL dès 21 ans, PRT-002) et
 *   part de TEST de l'assureur de 08 E7 (7/10 : prime 21,00 de TJ01).
 * Les règles de la base (rejeu, validité, annonce immédiate, boîte manuelle, conducteur, documents,
 * pose du hold, IDOR) sont prouvées en L0 (`l0-us208-checkout.test.ts`), jamais par ces doubles.
 * Aucun code de pays ni de devise n'est écrit ici : ils sont lus des données (ADR-024).
 */
import { ratio } from '@rueda/money';
import { checksFor, settlementVector } from '@rueda/money/golden-vectors';
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
import type { QuoteParams, QuoteParamsContext, QuoteParamsOf } from '../../prc/index.js';
import { QuoteError } from '../../prc/index.js';
import type { CheckoutHold, CheckoutQuote, CheckoutResult } from '../internal/checkout/store.js';
import { CHECKOUT_OUTCOMES } from '../internal/checkout/store.js';
import { CHECKOUT_MESSAGES } from '../internal/checkout/errors.js';
import { FakeCheckoutStore, FakeQuoteStore } from './fake-checkout-store.js';
import {
  caseOfGoldenTrip,
  DAY_MS,
  golden,
  goldenRegistry,
  rulesOf,
  T0_MS,
  testTripFeeSchedule,
} from '../../../../test/support/quote.js';

const LISTING = '00000000-0000-4000-8000-0000000208a1';
const QUOTE = '00000000-0000-4000-8000-0000000208c1';
const HOLD = '00000000-0000-4000-8000-0000000208d1';
const iso = (ms: number): string => new Date(ms).toISOString();

const t01 = settlementVector(golden, 'T01');
const cur = goldenRegistry.get(t01.currency);
// « PA1 » : ITBMS 7 % sur le loyer seul, ni trip fee ni protection (16 A.8.1)
const PA1: QuoteParams = {
  currency: cur,
  graceMinutes: 29,
  maxTripDays: 30,
  tripFeeSchedule: testTripFeeSchedule(cur, [[null, 0]], 0n),
  taxRules: rulesOf([{ id: 'g', rate: ratio(7n, 100n), lines: ['tripPrice'] }]),
  hostSharePct: ratio(3n, 4n),
  deliverySharePct: ratio(3n, 4n),
  extrasSharePct: ratio(3n, 4n),
};

// US-226 : grille de TEST (16 PRC-018, PRT-002) et parts de TEST de l'assureur (08 E7)
const GRID: QuoteParams = {
  ...PA1,
  protectionGrid: {
    minLevel: 'BASICA',
    levels: [
      {
        level: 'BASICA',
        rank: 1,
        price: ratio(1n, 4n),
        minDriverAge: null,
        dailyFloor: null,
        dailyCeiling: null,
      },
      {
        level: 'ESTANDAR',
        rank: 2,
        price: ratio(2n, 5n),
        minDriverAge: null,
        dailyFloor: null,
        dailyCeiling: null,
      },
      {
        level: 'TOTAL',
        rank: 3,
        price: ratio(13n, 20n),
        minDriverAge: 21,
        dailyFloor: null,
        dailyCeiling: null,
      },
    ],
  },
  insurerPremiumShareByLevel: {
    BASICA: ratio(7n, 10n),
    ESTANDAR: ratio(7n, 10n),
    TOTAL: ratio(7n, 10n),
  },
};

const QUOTED_AT = T0_MS - 5 * DAY_MS;
/** Annonce sans limite de distance (US-205b). */
const UNLIMITED = {
  mileageMode: 'UNLIMITED',
  includedKmPerDay: null,
  extraKmPriceMinor: null,
} as const;
const BODY = { listingId: LISTING, startAt: iso(T0_MS), endAt: iso(T0_MS + 3 * DAY_MS) };

/** Devis figé tel que la base le rend (valeurs de forme). */
const VIEW: CheckoutQuote = {
  quoteId: QUOTE,
  listingId: LISTING,
  country: FIRST_COUNTRY,
  currency: cur.code,
  startAt: iso(T0_MS),
  endAt: iso(T0_MS + 3 * DAY_MS),
  billableDays: 3,
  lines: [{ type: 'TRIP_PRICE', amountMinor: '12000', taxMinor: '840' }],
  totalMinor: '12840',
  expiresAt: iso(QUOTED_AT + 30 * 60_000),
  expired: false,
  manualTransmission: true,
  instantBook: true,
  documents: [
    { kind: 'TOS_GUEST', version: 1, locale: 'es', title: 'Términos' },
    { kind: 'CANCELLATION_POLICY', version: 1, locale: 'es', title: 'Cancelación' },
    { kind: 'GEO_TERMS', version: 2, locale: 'es', title: 'Zonas' },
  ],
  protectionLevel: null,
  driverAge: null,
  insurerContractActive: true,
  protectionOptions: [],
  mileage: { mode: 'UNLIMITED', includedKm: null, extraKmPriceMinor: null },
  cancellation: {
    lastMinute: false,
    freeUntil: iso(T0_MS - DAY_MS),
    lastMinuteWindowMinutes: 60,
    endsAtStart: false,
  },
  lateCancellation: null,
};

const HOLD_VIEW: CheckoutHold = {
  holdId: HOLD,
  status: 'ACTIVE',
  expiresAt: iso(QUOTED_AT + 10 * 60_000),
  quoteId: QUOTE,
  listingId: LISTING,
  currency: cur.code,
  startAt: iso(T0_MS),
  endAt: iso(T0_MS + 3 * DAY_MS),
  totalMinor: '12840',
  manualConfirmed: true,
  reviewState: 'NONE',
  documents: [
    { kind: 'CANCELLATION_POLICY', version: 1, locale: 'es' },
    { kind: 'GEO_TERMS', version: 2, locale: 'es' },
    { kind: 'TOS_GUEST', version: 1, locale: 'es' },
  ],
};

const DEMAND = {
  driver: { firstName: 'Ana', lastName: 'Pérez' },
  manualTransmissionConfirmed: true,
  acceptedDocuments: [
    { kind: 'TOS_GUEST', version: 1 },
    { kind: 'CANCELLATION_POLICY', version: 1 },
    { kind: 'GEO_TERMS', version: 2 },
  ],
};

const apps: ContractApp[] = [];

async function app(
  options: { params?: QuoteParamsOf; quotes?: FakeQuoteStore; store?: FakeCheckoutStore } = {},
) {
  const store = options.store ?? new FakeCheckoutStore();
  if (!store.listings.has(LISTING)) {
    store.listings.set(LISTING, {
      country: FIRST_COUNTRY,
      currency: cur.code,
      dailyPriceMinor: '4000',
      quotedAtMs: QUOTED_AT,
      hostPlan: null,
      ...UNLIMITED,
    });
  }
  const quotes = options.quotes ?? new FakeQuoteStore();
  const a = await startContractApp({
    checkout: { paramsOf: options.params ?? (() => PA1), quotes, store },
  });
  apps.push(a);
  return { a, store, quotes };
}

describe('US-208 — contrat du checkout (partie back-end)', () => {
  afterAll(async () => {
    await closeContractApps();
  });

  it('critère 1 : TA01 ⇒ devis figé envoyé à la base pour la session (total 128,40, 3 jours, instant du devis lu en base) ; réponse = devis rejoué lu en base, jamais en cache', async () => {
    const { a, store, quotes } = await app();
    store.quotes.set(`${a.hash('voyageur')}:${QUOTE}`, VIEW);
    const asked: { country: string; at: string }[] = [];
    const { a: b, quotes: qb } = await app({
      store,
      params: (ctx) => {
        asked.push({ country: ctx.country, at: ctx.at.toISOString() });
        return PA1;
      },
    });
    store.quotes.set(`${b.hash('voyageur')}:${QUOTE}`, VIEW);
    const r = await b.api.request('POST', '/checkout/quotes', {
      headers: b.cookie('voyageur'),
      body: BODY,
    });
    expect(r.status).toBe(201);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toEqual({ quote: VIEW });
    const refund = checksFor(golden, 'TA01').find((c) => c.label === 'TA01 refund')?.expected;
    expect(qb.frozen).toHaveLength(1);
    expect(qb.frozen[0]).toMatchObject({ proof: b.hash('voyageur'), listingId: LISTING });
    expect(qb.frozen[0]?.frozen.totalMinor).toBe(String(refund));
    expect(qb.frozen[0]?.frozen.totalMinor).toBe('12840');
    expect(JSON.parse(qb.frozen[0]?.frozen.outputs ?? '{}')).toMatchObject({ billableDays: 3 });
    expect(asked).toEqual([{ country: FIRST_COUNTRY, at: iso(QUOTED_AT) }]);
    expect(quotes.frozen).toEqual([]);

    const again = await a.api.request('GET', `/checkout/quotes/${QUOTE}`, {
      headers: a.cookie('voyageur'),
    });
    expect(again.status).toBe(200);
    expect(again.json).toEqual({ quote: VIEW });
  });

  it('US-205b critère 2 et 10b UX-54 : distance de l’annonce figée dans le devis (200 km × 3 jours = 600, prix du km) ; le devis lu rend la distance figée, l’annulation gratuite de la base et la retenue hors fenêtre du moteur de règlement sur le devis REJOUÉ', async () => {
    const store = new FakeCheckoutStore();
    store.listings.set(LISTING, {
      country: FIRST_COUNTRY,
      currency: cur.code,
      dailyPriceMinor: '4000',
      quotedAtMs: QUOTED_AT,
      hostPlan: null,
      mileageMode: 'INCLUDED',
      includedKmPerDay: 200,
      extraKmPriceMinor: '35',
    });
    const asked: string[] = [];
    const { a, quotes } = await app({ store });
    const b = await startContractApp({
      checkout: {
        paramsOf: () => PA1,
        quotes,
        store,
        // paramètres de TEST de 08 (24 h, 25 h, 60 min), lus du pays du devis à l'instant du gel
        cancellationParamsOf: (ctx) => {
          asked.push(`${ctx.country}@${ctx.at.toISOString()}`);
          return { freeCancelLeadHours: 24, lastMinuteThresholdHours: 25, noShowGraceMinutes: 60 };
        },
      },
    });
    apps.push(b);
    store.quotes.set(`${a.hash('voyageur')}:${QUOTE}`, VIEW);
    const r = await a.api.request('POST', '/checkout/quotes', {
      headers: a.cookie('voyageur'),
      body: BODY,
    });
    expect(r.status).toBe(201);
    const frozen = quotes.frozen[0]?.frozen;
    if (frozen === undefined) throw new Error('aucun devis figé');
    // 19 US-205 critère 2 : 200 km / j et 3 jours facturables ⇒ 600 km, prix du km de l'annonce
    expect(JSON.parse(frozen.inputs)).toMatchObject({
      request: { mileage: { mode: 'INCLUDED', kmPerDay: 200, extraKmPrice: '35' } },
    });
    expect(JSON.parse(frozen.outputs)).toMatchObject({
      mileage: { mode: 'INCLUDED', kmPerDay: 200, includedKm: 600, extraKmPrice: '35' },
    });
    const view: CheckoutQuote = {
      ...VIEW,
      mileage: { mode: 'INCLUDED', includedKm: 600, extraKmPriceMinor: '35' },
    };
    store.quotes.set(`${b.hash('voyageur')}:${QUOTE}`, view);
    store.frozenDocuments.set(QUOTE, frozen);
    store.frozenAtMs = QUOTED_AT;
    const read = await b.api.request('GET', `/checkout/quotes/${QUOTE}`, {
      headers: b.cookie('voyageur'),
    });
    expect(read.status).toBe(200);
    // TA01 (« PA1 », 3 jours, total 128,40) annulé hors fenêtre : 08 BR-CXL-06, j = 1 (trip de
    // plus de 2 jours) ⇒ loyer retenu 120,00 × 1/3 = 40,00 ; taxe remboursée au prorata de la base
    // remboursée = roundHalfUp(8,40 × 80,00 / 120,00) = 5,60 ⇒ taxe retenue 2,80 ; retenue 42,80
    expect(read.json).toEqual({
      quote: { ...view, lateCancellation: { penaltyDays: '1', retainedMinor: '4280' } },
    });
    expect(asked).toEqual([`${FIRST_COUNTRY}@${iso(QUOTED_AT)}`]);
    // devis antérieur (aucun document) : aucune retenue calculée, jamais un montant deviné
    store.frozenDocuments.clear();
    const old = await b.api.request('GET', `/checkout/quotes/${QUOTE}`, {
      headers: b.cookie('voyageur'),
    });
    expect(old.json).toEqual({ quote: { ...view, lateCancellation: null } });
  });

  it('critère 4 : variante sans décimale (D2, T40) ⇒ total de l’oracle sans la protection ni la livraison, à l’unité près', async () => {
    const v = settlementVector(golden, 'T40');
    const { params: base } = caseOfGoldenTrip(v.trip);
    const c = base.currency;
    expect(c.exponent).toBe(0);
    // F de D2 (125 500) donné par 08 : barème de TEST à 12,55 % (entrée, pas un attendu)
    const params: QuoteParams = {
      ...base,
      tripFeeSchedule: testTripFeeSchedule(c, [[null, 1255]], 0n),
    };
    const store = new FakeCheckoutStore();
    store.listings.set(LISTING, {
      country: FIRST_COUNTRY,
      currency: c.code,
      dailyPriceMinor: '333334', // P = 1 000 002 de D2 (08), divisible par 3
      quotedAtMs: QUOTED_AT,
      hostPlan: null,
      ...UNLIMITED,
    });
    const { a, quotes } = await app({ store, params: () => params });
    store.quotes.set(`${a.hash('voyageur')}:${QUOTE}`, { ...VIEW, currency: c.code });
    const r = await a.api.request('POST', '/checkout/quotes', {
      headers: a.cookie('voyageur'),
      body: BODY,
    });
    expect(r.status).toBe(201);
    const untaxed = Object.entries(v.trip.linesMinor)
      .filter(([name]) => name !== 'tripPrice' && name !== 'tripFee')
      .reduce((sum, [, x]) => sum + x, 0n);
    expect(quotes.frozen[0]?.frozen.totalMinor).toBe(String(v.trip.totalPaidMinor - untaxed));
  });

  it('devis : corps invalide ⇒ 400 sans appel ; annonce inconnue ⇒ 404 ; rejeu différent ⇒ 409 ; aucun prix ⇒ 422 ; débit ⇒ 429 ; panne ⇒ 503 ; sans session ⇒ 401', async () => {
    const { a, quotes } = await app();
    const post = (body: unknown, actor: 'voyageur' | null = 'voyageur') =>
      a.api.request('POST', '/checkout/quotes', {
        ...(actor ? { headers: a.cookie(actor) } : {}),
        body,
      });
    for (const body of [
      {},
      { ...BODY, listingId: 'x' },
      { ...BODY, startAt: iso(T0_MS + 60_000) },
      { ...BODY, endAt: BODY.startAt },
      { ...BODY, startAt: '2036-12-10T10:00' },
      // le client n'envoie jamais de montant : un total fourni ne change rien et n'est pas lu
    ]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(quotes.frozen).toEqual([]);
    expect((await post({ ...BODY, listingId: QUOTE })).status).toBe(404);
    for (const [outcome, status] of [
      ['QUOTE_MISMATCH', 409],
      ['QUOTE_UNAVAILABLE', 422],
      ['QUOTE_RATE_LIMITED', 429],
    ] as const) {
      quotes.outcome = outcome;
      const r = await post({ ...BODY, totalMinor: '1' });
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code: outcome });
    }
    // configuration du pays absente : aucun prix, jamais un devis inventé
    const { a: m } = await app({
      params: () => {
        throw new QuoteError('QUOTE_UNAVAILABLE', 'trip_fee_schedule absent');
      },
    });
    const missing = await m.api.request('POST', '/checkout/quotes', {
      headers: m.cookie('voyageur'),
      body: BODY,
    });
    expect(missing.status).toBe(422);
    expect((await post(BODY, null)).status).toBe(401);
    quotes.down = true;
    expect((await post(BODY)).json).toMatchObject({ code: 'BOOKING_UNAVAILABLE' });
  });

  it('devis d’un autre voyageur ou inconnu ⇒ 404 QUOTE_NOT_FOUND (même réponse) ; sans session ⇒ 401 ; panne ⇒ 503', async () => {
    const { a, store } = await app();
    store.quotes.set(`${a.hash('voyageur')}:${QUOTE}`, VIEW);
    for (const [path, actor] of [
      [`/checkout/quotes/${QUOTE}`, 'staff_sans_mfa'],
      ['/checkout/quotes/pas-un-uuid', 'voyageur'],
    ] as const) {
      const r = await a.api.request('GET', path, { headers: a.cookie(actor) });
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ code: 'QUOTE_NOT_FOUND', messageKey: 'common.quote.notFound' });
    }
    expect((await a.api.request('GET', `/checkout/quotes/${QUOTE}`)).status).toBe(401);
    store.down = true;
    const down = await a.api.request('GET', `/checkout/quotes/${QUOTE}`, {
      headers: a.cookie('voyageur'),
    });
    expect(down.status).toBe(503);
  });

  it('checkout : la demande (conducteur, case, versions) part à la base pour la session ; hold posé ⇒ 201 et récapitulatif ; chaque refus de la base ⇒ son code et son statut', async () => {
    const { a, store } = await app();
    store.result = { outcome: 'DONE', holdId: HOLD, expiresAt: HOLD_VIEW.expiresAt };
    store.holds.set(`${a.hash('voyageur')}:${HOLD}`, HOLD_VIEW);
    const hold = (body: unknown, actor: 'voyageur' | null = 'voyageur', quote = QUOTE) =>
      a.api.request('POST', `/checkout/quotes/${quote}/hold`, {
        ...(actor ? { headers: a.cookie(actor) } : {}),
        body,
      });
    const ok = await hold(DEMAND);
    expect(ok.status).toBe(201);
    expect(ok.json).toEqual({ hold: HOLD_VIEW });
    expect(store.demands).toEqual([
      {
        proof: a.hash('voyageur'),
        quoteId: QUOTE,
        demand: {
          driverFirstName: 'Ana',
          driverLastName: 'Pérez',
          manualTransmissionConfirmed: true,
          acceptedDocuments: DEMAND.acceptedDocuments,
        },
      },
    ]);
    // case et versions absentes : transmises telles quelles (la base refuse, TERMS_NOT_ACCEPTED)
    await hold({ driver: DEMAND.driver });
    expect(store.demands[1]?.demand).toMatchObject({
      manualTransmissionConfirmed: false,
      acceptedDocuments: [],
    });

    const refused = CHECKOUT_OUTCOMES.filter((o) => o !== 'DONE');
    for (const outcome of refused) {
      store.result = { outcome, holdId: null, expiresAt: null } as CheckoutResult;
      const r = await hold(DEMAND);
      if (outcome === 'AUTH_REQUIRED') {
        expect(r.status).toBe(401);
      } else if (outcome === 'QUOTE_NOT_FOUND') {
        expect(r.status).toBe(404);
      } else {
        const m = CHECKOUT_MESSAGES[outcome];
        expect(r.status, outcome).toBe(m.status);
        expect(r.json, outcome).toEqual({ code: outcome, messageKey: m.messageKey });
      }
    }
    for (const body of [
      {},
      { driver: { firstName: 1, lastName: 'x' } },
      { ...DEMAND, manualTransmissionConfirmed: 'oui' },
      { ...DEMAND, acceptedDocuments: [{ kind: 'tos', version: 1 }] },
      { ...DEMAND, acceptedDocuments: [{ kind: 'TOS_GUEST', version: 0 }] },
      { ...DEMAND, driver: { firstName: 'x'.repeat(101), lastName: 'y' } },
    ]) {
      expect((await hold(body)).status).toBe(400);
    }
    expect((await hold(DEMAND, 'voyageur', 'pas-un-uuid')).status).toBe(404);
    expect((await hold(DEMAND, null)).status).toBe(401);
    store.down = true;
    expect((await hold(DEMAND)).status).toBe(503);
  });

  it('US-514 critère 1 : lieu de retour différent ⇒ 422 ONE_WAY_NOT_ALLOWED sans pose du hold ; absent ⇒ aucune lecture du lieu ; identique ⇒ hold posé ; devis d’autrui ⇒ 404 ; lieu mal formé ⇒ 400 ; panne ⇒ 503', async () => {
    const { a, store } = await app();
    store.result = { outcome: 'DONE', holdId: HOLD, expiresAt: HOLD_VIEW.expiresAt };
    store.holds.set(`${a.hash('voyageur')}:${HOLD}`, HOLD_VIEW);
    const place = '00000000-0000-4000-8000-0000000514a1';
    const hold = (body: unknown) =>
      a.api.request('POST', `/checkout/quotes/${QUOTE}/hold`, {
        headers: a.cookie('voyageur'),
        body,
      });

    // absent (ou null) : retour au lieu de prise, aucune lecture du lieu, hold posé
    expect((await hold(DEMAND)).status).toBe(201);
    expect((await hold({ ...DEMAND, returnLocationId: null })).status).toBe(201);
    expect(store.returnPlaces).toEqual([]);

    // différent du lieu de prise (jugé en base) : refusé, aucune pose
    store.returnPlaceOutcome = 'ONE_WAY_NOT_ALLOWED';
    const posed = store.demands.length;
    const refused = await hold({ ...DEMAND, returnLocationId: place.toUpperCase() });
    expect(refused.status).toBe(422);
    expect(refused.json).toEqual({
      code: 'ONE_WAY_NOT_ALLOWED',
      messageKey: 'common.checkout.oneWayNotAllowed',
    });
    expect(store.returnPlaces).toEqual([
      { proof: a.hash('voyageur'), quoteId: QUOTE, returnLocationId: place },
    ]);
    expect(store.demands).toHaveLength(posed);

    // identique au lieu de prise : hold posé, lieu transmis tel quel
    store.returnPlaceOutcome = 'DONE';
    const ok = await hold({ ...DEMAND, returnLocationId: place });
    expect(ok.status).toBe(201);
    expect(store.demands.at(-1)?.demand).toMatchObject({ returnLocationId: place });

    // devis d'un autre voyageur ou inconnu : même réponse qu'un devis absent
    store.returnPlaceOutcome = 'QUOTE_NOT_FOUND';
    const foreign = await hold({ ...DEMAND, returnLocationId: place });
    expect(foreign.status).toBe(404);
    expect(foreign.json).toEqual({ code: 'QUOTE_NOT_FOUND', messageKey: 'common.quote.notFound' });

    for (const returnLocationId of ['pas-un-uuid', 42, { id: place }]) {
      expect((await hold({ ...DEMAND, returnLocationId })).status).toBe(400);
    }
    store.down = true;
    expect((await hold({ ...DEMAND, returnLocationId: place })).status).toBe(503);
  });

  it('critère 3 : récapitulatif du hold (versions exactes acceptées) au seul voyageur ; autre ou inconnu ⇒ 404 ; sans session ⇒ 401 ; panne ⇒ 503', async () => {
    const { a, store } = await app();
    store.holds.set(`${a.hash('voyageur')}:${HOLD}`, HOLD_VIEW);
    const mine = await a.api.request('GET', `/checkout/holds/${HOLD}`, {
      headers: a.cookie('voyageur'),
    });
    expect(mine.status).toBe(200);
    expect(mine.json).toEqual({ hold: HOLD_VIEW });
    // US-209c (ADR-144, N-203) : chaque état de revue rendu tel que la base le dit
    for (const reviewState of ['PENDING', 'APPROVED', 'REJECTED'] as const) {
      store.holds.set(`${a.hash('voyageur')}:${HOLD}`, { ...HOLD_VIEW, reviewState });
      const r = await a.api.request('GET', `/checkout/holds/${HOLD}`, {
        headers: a.cookie('voyageur'),
      });
      expect(r.status).toBe(200);
      expect(r.json).toEqual({ hold: { ...HOLD_VIEW, reviewState } });
    }
    const other = await a.api.request('GET', `/checkout/holds/${HOLD}`, {
      headers: a.cookie('staff_sans_mfa'),
    });
    expect(other.status).toBe(404);
    expect(other.json).toEqual({
      code: 'HOLD_NOT_FOUND',
      messageKey: 'common.checkout.holdNotFound',
    });
    expect((await a.api.request('GET', `/checkout/holds/${HOLD}`)).status).toBe(401);
    store.down = true;
    const down = await a.api.request('GET', `/checkout/holds/${HOLD}`, {
      headers: a.cookie('voyageur'),
    });
    expect(down.status).toBe(503);
  });

  it('US-226 critère 1 : sans niveau ⇒ minimum BASICA présélectionné, ligne PROTECTION calculée (30,00 du trip A) et prime de l’assureur 21,00 (TJ01) dans le devis envoyé à la base ; plan du véhicule transmis au moteur', async () => {
    const asked: QuoteParamsContext[] = [];
    const store = new FakeCheckoutStore();
    store.listings.set(LISTING, {
      country: FIRST_COUNTRY,
      currency: cur.code,
      dailyPriceMinor: '4000',
      quotedAtMs: QUOTED_AT,
      hostPlan: 'ESTÁNDAR',
      ...UNLIMITED,
    });
    const { a, quotes } = await app({
      store,
      params: (ctx) => {
        asked.push(ctx);
        return GRID;
      },
    });
    store.quotes.set(`${a.hash('voyageur')}:${QUOTE}`, VIEW);
    const r = await a.api.request('POST', '/checkout/quotes', {
      headers: a.cookie('voyageur'),
      body: BODY,
    });
    expect(r.status).toBe(201);
    expect(asked[0]).toMatchObject({ country: FIRST_COUNTRY, hostPlan: 'ESTÁNDAR' });
    const frozen = quotes.frozen[0]!.frozen;
    const inputs = JSON.parse(frozen.inputs) as { request: Record<string, unknown> };
    expect(inputs.request).toMatchObject({ protectionLevel: 'BASICA', driverAge: null });
    expect(inputs.request['lines']).toEqual({});
    const outputs = JSON.parse(frozen.outputs) as {
      lines: { type: string; amount: string }[];
      legs: Record<string, string>;
      protectionLevel: string;
    };
    const refund = checksFor(golden, 'TA01').find((c) => c.label === 'TA01 refund')?.expected;
    expect(outputs.protectionLevel).toBe('BASICA');
    expect(outputs.lines.find((l) => l.type === 'PROTECTION')?.amount).toBe(
      String(t01.trip.linesMinor.protection),
    );
    expect(frozen.totalMinor).toBe(String(BigInt(String(refund)) + t01.trip.linesMinor.protection));
    expect(outputs.legs['INSURER']).toBe('2100');
  });

  it('US-226 critère 1 : TOTAL refusé sans âge et à 20 ans (PROTECTION_LEVEL_NOT_ELIGIBLE), accepté à 21 ans ; aucune protection ⇒ PROTECTION_LEVEL_REQUIRED sans appel à la base ; forme invalide ⇒ 400 ; refus de la base ⇒ son code', async () => {
    const { a, quotes, store } = await app({ params: () => GRID });
    store.quotes.set(`${a.hash('voyageur')}:${QUOTE}`, VIEW);
    const post = (extra: Record<string, unknown>) =>
      a.api.request('POST', '/checkout/quotes', {
        headers: a.cookie('voyageur'),
        body: { ...BODY, ...extra },
      });
    for (const extra of [
      { protectionLevel: 'TOTAL' },
      { protectionLevel: 'TOTAL', driverAge: 20 },
    ]) {
      const r = await post(extra);
      expect(r.status).toBe(422);
      expect(r.json).toEqual({
        code: 'PROTECTION_LEVEL_NOT_ELIGIBLE',
        messageKey: 'common.quote.protectionNotEligible',
      });
    }
    // niveau inconnu du pays (refus total déguisé) : non vendu
    expect((await post({ protectionLevel: 'NONE' })).json).toMatchObject({
      code: 'PROTECTION_LEVEL_NOT_ELIGIBLE',
    });
    for (const protectionLevel of [null, '']) {
      const r = await post({ protectionLevel });
      expect(r.status).toBe(422);
      expect(r.json).toEqual({
        code: 'PROTECTION_LEVEL_REQUIRED',
        messageKey: 'common.quote.protectionRequired',
      });
    }
    for (const extra of [
      { protectionLevel: 'basica' },
      { protectionLevel: 3 },
      { driverAge: 0 },
      { driverAge: 151 },
      { driverAge: '20' },
      { driverAge: 20.5 },
    ]) {
      expect((await post(extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect(quotes.frozen).toEqual([]);
    const ok = await post({ protectionLevel: 'TOTAL', driverAge: 21 });
    expect(ok.status).toBe(201);
    const outputs = JSON.parse(quotes.frozen[0]!.frozen.outputs) as {
      lines: { type: string; amount: string }[];
    };
    // 13/20 × 40,00 = 26,00 par jour × 3 j
    expect(outputs.lines.find((l) => l.type === 'PROTECTION')?.amount).toBe('7800');
    for (const [outcome, status] of [
      ['INSURER_CONTRACT_INACTIVE', 409],
      ['PROTECTION_LEVEL_NOT_ELIGIBLE', 422],
      ['PROTECTION_LEVEL_REQUIRED', 422],
    ] as const) {
      quotes.outcome = outcome;
      const r = await post({});
      expect(r.status, outcome).toBe(status);
      expect(r.json).toMatchObject({ code: outcome });
    }
  });

  it('US-226 : devis lu ⇒ niveaux vendus par rang avec leur prix pour la période ; niveau refusé à l’âge déclaré grisé (DRIVER_AGE) ; interrupteur de l’assureur rendu tel quel', async () => {
    const { a, store } = await app({ params: () => GRID });
    store.frozenAtMs = QUOTED_AT;
    const view: CheckoutQuote = {
      ...VIEW,
      lines: [
        { type: 'TRIP_PRICE', amountMinor: '12000', taxMinor: '840' },
        { type: 'PROTECTION', amountMinor: '3000', taxMinor: '0' },
      ],
      totalMinor: '15840',
      protectionLevel: 'BASICA',
      driverAge: 20,
      insurerContractActive: false,
    };
    store.quotes.set(`${a.hash('voyageur')}:${QUOTE}`, view);
    const r = await a.api.request('GET', `/checkout/quotes/${QUOTE}`, {
      headers: a.cookie('voyageur'),
    });
    expect(r.status).toBe(200);
    const q = (r.json as { quote: CheckoutQuote }).quote;
    expect(q.insurerContractActive).toBe(false);
    // 1/4, 2/5 et 13/20 de 40,00 par jour (16 PRC-018), × 3 jours facturables
    expect(q.protectionOptions).toEqual([
      {
        level: 'BASICA',
        eligible: true,
        reason: null,
        minDriverAge: null,
        dailyMinor: '1000',
        lineMinor: '3000',
        selected: true,
      },
      {
        level: 'ESTANDAR',
        eligible: true,
        reason: null,
        minDriverAge: null,
        dailyMinor: '1600',
        lineMinor: '4800',
        selected: false,
      },
      {
        level: 'TOTAL',
        eligible: false,
        reason: 'DRIVER_AGE',
        minDriverAge: 21,
        dailyMinor: '2600',
        lineMinor: '7800',
        selected: false,
      },
    ]);
  });

  it('couverture : chaque statut déclaré pour /checkout est exercé', () => {
    // paiement du hold (US-223b) : sa propre suite (checkout-payment.contract)
    expect(
      missingCoverage(contract, '/checkout', coverageOf(...apps)).filter(
        (d) => !d.includes(' /checkout/holds/{holdId}/payment '),
      ),
    ).toEqual([]);
  });
});
