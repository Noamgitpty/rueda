/**
 * Contrat HTTP de la fiche du véhicule (US-204, US-205 ; écran S03) sur l'application RÉELLE (ApiModule,
 * harnais d'US-043) : `GET /listings/{id}` (galerie, notes, hôte vérifié), `GET
 * /listings/{id}/availability` (dates choisies sur la fiche) et `GET /listings/{id}/meeting-point`
 * (lieu exact du voyageur). Chaque réponse est confrontée à `openapi.json`.
 *
 * Attendus tirés de 19 US-204 (galerie dans l'ordre de l'hôte ; préavis non respecté ⇒
 * DATES_NOTICE_TOO_SHORT ; adresse exacte absente de la réponse avant BOOKED, montrée au
 * voyageur seulement après), de 16 LST-002, LST-003 / LST-020, LST-006, LST-007 et de 17 §2.3
 * (sonde limitée par IP, RLS-17 ; point 5 : 404 sans rien révéler). Les règles de la base (ordre,
 * photos refusées, préavis, tampon, hôte activable, trip confirmé) sont prouvées en L0
 * (`l0-us204-listing-page.test.ts`), jamais par ces doubles.
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
  PublicListingRating,
  PublicListingRatings,
} from '../internal/host-listings/public-ratings.js';
import {
  HostListingStoreError,
  UnavailableHostListingStore,
} from '../internal/host-listings/store.js';
import type { GuestMeetingPoint, PublicListing } from '../internal/host-listings/store.js';
import type { SearchPriceInput, SearchPricer } from '../internal/search/cards.js';
import type { ListingTerms } from '../internal/search/store.js';
import type { AvailabilityProbeLimiter } from '../internal/search/search.service.js';
import { FakeSearchStore } from './fake-search-store.js';

const LISTING = '00000000-0000-4000-8000-0000000204a1';
const OTHER = '00000000-0000-4000-8000-0000000204a2';
const P1 = '00000000-0000-4000-8000-0000000204b1';
const P2 = '00000000-0000-4000-8000-0000000204b2';

/** Fiche C0 de forme (valeurs fictives). */
const PUBLIC: PublicListing = {
  id: LISTING,
  country: FIRST_COUNTRY,
  dailyPriceMinor: '4000',
  currency: 'XTS',
  currencyExponent: 2,
  mileageMode: 'UNLIMITED',
  includedKmPerDay: null,
  extraKmPriceMinor: null,
  instantBook: true,
  variantId: null,
  makeName: 'Marca',
  modelName: 'Modelo',
  year: 2021,
  transmission: 'AUTOMATIC',
  seats: 5,
  fuelType: 'GASOLINE',
  locationKind: 'POI',
  city: 'Ciudad Ficticia',
  areaLabel: 'Barrio Norte',
  approximatePoint: { lat: 8.98, lng: -79.52 },
  timezone: 'UTC',
  hostFirstName: 'Ana',
  // ordre de l'hôte (rang), identifiants volontairement non triés
  photos: [
    { id: P2, order: 0, key: `listing/${LISTING}/${P2}` },
    { id: P1, order: 1, key: `listing/${LISTING}/${P1}` },
  ],
};

const MEETING: GuestMeetingPoint = {
  placeLabel: 'Entrada del centro comercial',
  addressLine: 'Calle Ficticia 1',
  city: 'Ciudad Ficticia',
  areaLabel: 'Barrio Norte',
  locationKind: 'POI',
};

/** Magasin de la fiche : deux lectures imposées, tout le reste indisponible (503). */
class PageStore extends UnavailableHostListingStore {
  listing: PublicListing | null = PUBLIC;
  failing = false;
  /** Empreinte (hex) de la session qui a un trip confirmé de LISTING. */
  bookedProof: string | null = null;
  asked: string[] = [];

  constructor() {
    super();
    Object.assign(this, {
      publicListing: (id: string): Promise<PublicListing | null> => {
        if (this.failing) return Promise.reject(new HostListingStoreError('panne', '08006'));
        return Promise.resolve(id === LISTING ? this.listing : null);
      },
      guestMeetingPoint: (proof: Buffer, id: string): Promise<GuestMeetingPoint | null> => {
        if (this.failing) return Promise.reject(new HostListingStoreError('panne', '08006'));
        this.asked.push(`${proof.toString('hex')}:${id}`);
        return Promise.resolve(
          proof.toString('hex') === this.bookedProof && id === LISTING ? MEETING : null,
        );
      },
    });
  }
}

const apps: ContractApp[] = [];

async function app(
  options: {
    readonly store?: PageStore;
    readonly ratings?: PublicListingRatings;
    readonly search?: FakeSearchStore;
    readonly probe?: AvailabilityProbeLimiter;
    readonly pricer?: SearchPricer;
  } = {},
) {
  const a = await startContractApp({
    cat: {
      store: options.store ?? new PageStore(),
      ...(options.ratings ? { ratings: options.ratings } : {}),
    },
    search: {
      store: options.search ?? new FakeSearchStore(),
      ...(options.probe ? { probe: options.probe } : {}),
      ...(options.pricer ? { pricer: options.pricer } : {}),
    },
  });
  apps.push(a);
  return a;
}

const at = (p: Record<string, string>, id = LISTING): string =>
  `/listings/${id}/availability?${new URLSearchParams(p).toString()}`;
const DATES = { start: '2036-12-10T10:00', end: '2036-12-12T10:00' };

describe('US-204 — contrat de la fiche du véhicule', () => {
  afterAll(async () => {
    await closeContractApps();
  });

  it('fiche : galerie dans l’ordre de l’hôte, hôte vérifié, notes de REV ; sans note : null (« Nuevo ») ; notes en panne : 503, jamais « Nuevo » inventé', async () => {
    const rating: PublicListingRating = {
      vehicle: { averageX100: 480, reviewCount: 3, tripCount: 5 },
      host: { averageX100: 490, reviewCount: 10, tripCount: 12 },
    };
    const asked: string[] = [];
    const a = await app({
      ratings: {
        ratings: (id) => {
          asked.push(id);
          return Promise.resolve(rating);
        },
      },
    });
    const r = await a.api.request('GET', `/listings/${LISTING}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toEqual({ listing: { ...PUBLIC, hostVerified: true, ratings: rating } });
    expect(asked).toEqual([LISTING]);
    // ni libellé, ni adresse du lieu, même si le magasin en connaît un
    expect(r.text).not.toContain(MEETING.placeLabel);
    expect(r.text).not.toContain(MEETING.addressLine);

    // sans note ni prénom (compte non ACTIVE) : null et hôte non vérifié
    const store = new PageStore();
    store.listing = { ...PUBLIC, hostFirstName: null, photos: [] };
    const plain = await app({ store });
    const p = await plain.api.request('GET', `/listings/${LISTING}`);
    expect(p.json).toEqual({
      listing: { ...PUBLIC, hostFirstName: null, photos: [], hostVerified: false, ratings: null },
    });

    const down = await app({ ratings: { ratings: () => Promise.reject(new Error('panne')) } });
    const d = await down.api.request('GET', `/listings/${LISTING}`);
    expect(d.status).toBe(503);
    expect(d.json).toMatchObject({ code: 'LISTING_UNAVAILABLE' });
    expect((await down.api.request('GET', `/listings/${OTHER}`)).status).toBe(404);
  });

  it('critère 2 : préavis non respecté ⇒ 422 DATES_NOTICE_TOO_SHORT avec le préavis en heures entières (arrondi supérieur) ; créneau libre ⇒ 200 ; pris ⇒ 409 DATES_UNAVAILABLE sans détail', async () => {
    const search = new FakeSearchStore();
    search.listingCountries.set(LISTING, FIRST_COUNTRY);
    const a = await app({ search });
    const ok = await a.api.request('GET', at(DATES));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    // annonce sans prix lu (double) : aucun total, jamais un total inventé
    expect(ok.json).toEqual({
      availability: {
        startAt: '2036-12-10T15:00:00.000Z',
        endAt: '2036-12-12T15:00:00.000Z',
        timezone: 'UTC',
        price: null,
        // double sans conditions imposées : paramètres absents ⇒ aucune promesse (US-205)
        cancellation: null,
        mileage: {
          mode: 'UNLIMITED',
          includedKmPerDay: null,
          includedKm: null,
          extraKmPriceMinor: null,
        },
      },
    });
    expect(search.lastSlot).toEqual({
      listingId: LISTING,
      startLocal: DATES.start,
      endLocal: DATES.end,
    });
    for (const [minutes, hours] of [
      [180, 3],
      [90, 2],
      [1440, 24],
    ] as const) {
      search.slotOutcome = { outcome: 'DATES_NOTICE_TOO_SHORT', noticeMinutes: minutes };
      const n = await a.api.request('GET', at(DATES));
      expect(n.status).toBe(422);
      expect(n.json).toEqual({
        code: 'DATES_NOTICE_TOO_SHORT',
        messageKey: 'common.listing.datesNoticeTooShort',
        values: { noticeHours: hours },
      });
    }
    search.slotOutcome = { outcome: 'DATES_UNAVAILABLE' };
    const busy = await a.api.request('GET', at(DATES));
    expect(busy.status).toBe(409);
    expect(busy.json).toEqual({
      code: 'DATES_UNAVAILABLE',
      messageKey: 'common.listing.datesUnavailable',
    });
    for (const code of ['SEARCH_DATES_INVALID', 'SEARCH_DURATION_EXCEEDED'] as const) {
      search.slotOutcome = { outcome: code };
      const x = await a.api.request('GET', at(DATES));
      expect(x.status).toBe(422);
      expect(x.json).toMatchObject({ code });
    }
    search.slotOutcome = { outcome: 'LISTING_NOT_FOUND' };
    expect((await a.api.request('GET', at(DATES))).status).toBe(404);
    search.slotOutcome = { outcome: 'SEARCH_UNAVAILABLE' };
    expect((await a.api.request('GET', at(DATES))).status).toBe(503);
  });

  it('US-208 : créneau libre ⇒ total TTC du devis provisoire (même pricer que la recherche, instants du créneau et instant lu en base) ; devis impossible ⇒ price null ; pricer en panne ⇒ 503', async () => {
    const search = new FakeSearchStore();
    search.listingCountries.set(LISTING, FIRST_COUNTRY);
    search.listingPrices.set(LISTING, {
      currency: 'XTS',
      dailyPriceMinor: '4000',
      quotedAt: '2036-12-01T12:00:00.000Z',
    });
    const seen: SearchPriceInput[] = [];
    let answer: { totalMinor: string; billableDays: number } | null = {
      totalMinor: '12840',
      billableDays: 2,
    };
    const a = await app({
      search,
      pricer: {
        price: (input) => {
          seen.push(input);
          return answer;
        },
      },
    });
    const ok = await a.api.request('GET', at(DATES));
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      availability: { price: { totalMinor: '12840', currency: 'XTS', billableDays: 2 } },
    });
    expect(seen).toEqual([
      {
        listingId: LISTING,
        country: FIRST_COUNTRY,
        currency: 'XTS',
        dailyPriceMinor: '4000',
        startAt: '2036-12-10T15:00:00.000Z',
        endAt: '2036-12-12T15:00:00.000Z',
        quotedAt: '2036-12-01T12:00:00.000Z',
      },
    ]);
    answer = null;
    const none = await a.api.request('GET', at(DATES));
    expect(none.status).toBe(200);
    expect(none.json).toMatchObject({ availability: { price: null } });
    const broken = await app({
      search,
      pricer: {
        price: () => {
          throw new Error('panne');
        },
      },
    });
    const down = await broken.api.request('GET', at(DATES));
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'SEARCH_UNAVAILABLE' });
  });

  it('forme : dates hors pas de 30 min ou fin ≤ début ⇒ 422 sans appel de la base ; annonce mal formée, inconnue ou non publiée ⇒ 404 ; base en panne ⇒ 503', async () => {
    const search = new FakeSearchStore();
    search.listingCountries.set(LISTING, FIRST_COUNTRY);
    const a = await app({ search });
    for (const [start, end] of [
      ['2036-12-10T10:00', '2036-12-10T09:30'],
      ['2036-12-10T10:15', '2036-12-12T10:00'],
      ['2036-12-10', '2036-12-12T10:00'],
    ] as const) {
      const r = await a.api.request('GET', at({ start, end }));
      expect(r.status, `${start} ${end}`).toBe(422);
      expect(r.json).toMatchObject({ code: 'SEARCH_DATES_INVALID' });
    }
    expect((await a.api.request('GET', `/listings/${LISTING}/availability`)).status).toBe(422);
    expect(search.lastSlot).toBeNull();
    const unknown = await a.api.request('GET', at(DATES, OTHER));
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ code: 'LISTING_NOT_FOUND' });
    expect((await a.api.request('GET', at(DATES, 'pas-un-uuid'))).status).toBe(404);
    expect(search.lastSlot).toBeNull();
    search.down = true;
    const down = await a.api.request('GET', at(DATES));
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'SEARCH_UNAVAILABLE' });
  });

  it('sonde limitée par IP (availability_probe_per_minute du pays de l’annonce) : au-delà ⇒ 429 RATE_LIMITED et Retry-After ; limiteur en panne ⇒ 503', async () => {
    const search = new FakeSearchStore();
    search.listingCountries.set(LISTING, FIRST_COUNTRY);
    const hits: string[] = [];
    let retry: number | null = null;
    const a = await app({
      search,
      probe: {
        hit: (_ip, country) => {
          hits.push(country);
          return Promise.resolve(retry);
        },
      },
    });
    expect((await a.api.request('GET', at(DATES))).status).toBe(200);
    expect(hits).toEqual([FIRST_COUNTRY]);
    retry = 42;
    const limited = await a.api.request('GET', at(DATES));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('42');
    expect(limited.json).toMatchObject({ code: 'RATE_LIMITED', values: { retryAfterS: 42 } });
    const broken = await app({
      search,
      probe: { hit: () => Promise.reject(new Error('limiteur en panne')) },
    });
    expect((await broken.api.request('GET', at(DATES))).status).toBe(503);
  });

  it('critère 3 : lieu exact au seul voyageur d’un trip confirmé (jugé par la base) ; sans trip ou sans session ⇒ 404 / 401 sans rien révéler ; jamais en cache', async () => {
    const store = new PageStore();
    const a = await app({ store });
    store.bookedProof = a.hash('voyageur');
    const mine = await a.api.request('GET', `/listings/${LISTING}/meeting-point`, {
      headers: a.cookie('voyageur'),
    });
    expect(mine.status).toBe(200);
    expect(mine.headers.get('cache-control')).toBe('no-store');
    expect(mine.json).toEqual({ meetingPoint: MEETING });
    // la base reçoit l'empreinte du jeton de la session, jamais un identifiant fourni par le client
    expect(store.asked).toEqual([`${a.hash('voyageur')}:${LISTING}`]);
    const other = await a.api.request('GET', `/listings/${LISTING}/meeting-point`, {
      headers: a.cookie('staff_sans_mfa'),
    });
    expect(other.status).toBe(404);
    expect(other.json).toEqual({
      code: 'MEETING_POINT_NOT_FOUND',
      messageKey: 'common.listing.meetingPointNotFound',
    });
    expect(other.text).not.toContain(MEETING.addressLine);
    const bad = await a.api.request('GET', '/listings/pas-un-uuid/meeting-point', {
      headers: a.cookie('voyageur'),
    });
    expect(bad.status).toBe(404);
    const anonymous = await a.api.request('GET', `/listings/${LISTING}/meeting-point`);
    expect(anonymous.status).toBe(401);
    store.failing = true;
    const down = await a.api.request('GET', `/listings/${LISTING}/meeting-point`, {
      headers: a.cookie('voyageur'),
    });
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'LISTING_UNAVAILABLE' });
  });

  // ---- US-205 : conditions affichées (annulation, distance, protection, caution) -------------
  it('US-205 critères 1 et 2 : créneau accepté ⇒ freeUntil de la base pour ce départ (instant UTC transmis), fenêtre de dernière minute de 60 min ; km par jour × jours facturables du devis (200 × 3 = 600) et prix du km de l’annonce', async () => {
    const search = new FakeSearchStore();
    search.listingCountries.set(LISTING, FIRST_COUNTRY);
    search.listingPrices.set(LISTING, {
      currency: 'XTS',
      dailyPriceMinor: '4000',
      quotedAt: '2036-12-01T12:00:00.000Z',
    });
    const terms: ListingTerms = {
      currency: 'XTS',
      timezone: 'UTC',
      cancellation: {
        freeCancelLeadHours: 24,
        lastMinuteThresholdHours: 25,
        lastMinute: false,
        freeUntil: '2036-12-09T15:00:00.000Z',
      },
      mileageMode: 'INCLUDED',
      includedKmPerDay: 200,
      extraKmPriceMinor: '35',
      depositAmountMinor: null,
      protection: null,
    };
    search.listingTerms.set(LISTING, terms);
    const a = await app({
      search,
      pricer: { price: () => ({ totalMinor: '12840', billableDays: 3 }) },
    });
    const ok = await a.api.request('GET', at(DATES));
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      availability: {
        cancellation: {
          lastMinute: false,
          freeUntil: '2036-12-09T15:00:00.000Z',
          lastMinuteWindowMinutes: 60,
        },
        mileage: {
          mode: 'INCLUDED',
          includedKmPerDay: 200,
          includedKm: 600,
          extraKmPriceMinor: '35',
        },
      },
    });
    // la base reçoit l'instant UTC du départ accepté (jamais l'heure locale brute)
    expect(search.termsAsked).toEqual(['2036-12-10T15:00:00.000Z']);
    // dernière minute : aucune date (« 1 h après la réservation »), même si la base en rendait une
    search.listingTerms.set(LISTING, {
      ...terms,
      cancellation: {
        ...terms.cancellation!,
        lastMinute: true,
        freeUntil: '2036-12-10T15:00:00.000Z',
      },
    });
    const late = await a.api.request('GET', at(DATES));
    expect(late.json).toMatchObject({
      availability: {
        cancellation: { lastMinute: true, freeUntil: null, lastMinuteWindowMinutes: 60 },
      },
    });
    // départ non jugé par la base (lastMinute nul) : aucune promesse d'annulation gratuite
    search.listingTerms.set(LISTING, {
      ...terms,
      cancellation: { ...terms.cancellation!, lastMinute: null, freeUntil: null },
    });
    expect((await a.api.request('GET', at(DATES))).json).toMatchObject({
      availability: { cancellation: null },
    });
  });

  it('US-205 : conditions sans dates ⇒ politique du pays, caution, protection telle que la base la rend ; protection non promise ⇒ null ; inconnue ⇒ 404 ; base en panne ⇒ 503', async () => {
    const search = new FakeSearchStore();
    search.listingCountries.set(LISTING, FIRST_COUNTRY);
    const protection = {
      insurerName: 'Aseguradora Ficticia',
      insurerLicenseRef: 'LIC-1',
      brokerName: 'Corredor Ficticio',
      brokerLicenseRef: null,
      contractVersion: 2,
      rcAmountMinor: '10000000',
      deductibles: { BASICA: '150000', ESTANDAR: '50000', TOTAL: '0' },
      exclusions: { es: 'Excl.', en: 'Excl.', fr: 'Excl.', 'pt-BR': 'Excl.' },
    } as const;
    search.listingTerms.set(LISTING, {
      currency: 'XTS',
      timezone: 'UTC',
      cancellation: {
        freeCancelLeadHours: 24,
        lastMinuteThresholdHours: 25,
        lastMinute: null,
        freeUntil: null,
      },
      mileageMode: 'UNLIMITED',
      includedKmPerDay: null,
      extraKmPriceMinor: null,
      depositAmountMinor: '25000',
      protection,
    });
    const a = await app({ search });
    const r = await a.api.request('GET', `/listings/${LISTING}/conditions`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toEqual({
      conditions: {
        currency: 'XTS',
        timezone: 'UTC',
        cancellation: {
          freeCancelLeadHours: 24,
          lastMinuteThresholdHours: 25,
          lastMinuteWindowMinutes: 60,
        },
        deposit: { amountMinor: '25000' },
        protection,
      },
    });
    expect(search.termsAsked).toEqual([null]);
    // contrat inactif (ou RC sous le minimum, véhicule hors contrat) : la base ne promet rien
    search.listingTerms.delete(LISTING);
    const none = await a.api.request('GET', `/listings/${LISTING}/conditions`);
    expect(none.json).toEqual({
      conditions: {
        currency: 'XTS',
        timezone: 'UTC',
        cancellation: null,
        deposit: null,
        protection: null,
      },
    });
    expect(none.text).not.toContain('Aseguradora');
    const unknown = await a.api.request('GET', `/listings/${OTHER}/conditions`);
    expect(unknown.status).toBe(404);
    expect(unknown.json).toMatchObject({ code: 'LISTING_NOT_FOUND' });
    expect((await a.api.request('GET', '/listings/pas-un-uuid/conditions')).status).toBe(404);
    search.down = true;
    const down = await a.api.request('GET', `/listings/${LISTING}/conditions`);
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'SEARCH_UNAVAILABLE' });
  });

  it('couverture : chaque statut déclaré pour /listings (fiche, dates, lieu exact, conditions) est exercé', () => {
    expect(missingCoverage(contract, '/listings', coverageOf(...apps))).toEqual([]);
  });
});
