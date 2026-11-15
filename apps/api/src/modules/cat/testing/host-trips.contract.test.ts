/**
 * US-219 — tests de contrat des routes des trips de l'hôte `/host/accounts/{orgId}/trips[/{tripId}]`
 * sur l'application RÉELLE (ApiModule, harnais d'US-043) et les FAKE des magasins (sans base) :
 * chaque réponse est confrontée à `apps/api/openapi/openapi.json`. Attendus : 19 US-219 (critères 2
 * et 3 : voyageur minimisé, 0 trip d'un autre hôte), 16 HDB-002 (onglets, filtres, gains estimés de
 * la jambe HOST ; « 404 sans état révélé »), 17 §2.3 point 5 (IDOR : 404). Les règles elles-mêmes
 * sont prouvées sur PostgreSQL (packages/db/test/l0/l0-us219-host-trips.test.ts). Données fictives.
 */
import { randomUUID } from 'node:crypto';
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
import {
  UnavailablePhotoScanner,
  UnavailablePhotoStorage,
} from '../internal/host-listings/photo-ingest.js';
import type { HostTripRow } from '../internal/host-trips/store.js';
import { FakeHostListingStore } from './fake-host-listing-store.js';
import { FakeHostTripStore } from './fake-host-trip-store.js';

const apps: ContractApp[] = [];

interface World {
  readonly app: ContractApp;
  readonly store: FakeHostListingStore;
  readonly trips: FakeHostTripStore;
  readonly orgA: string;
  readonly orgB: string;
  /** Hôte A = acteur « voyageur » du harnais ; hôte B = « staff_sans_mfa ». */
  readonly a: Record<string, string>;
  readonly b: Record<string, string>;
}

async function world(options: { trips?: boolean } = {}): Promise<World> {
  const store = new FakeHostListingStore();
  const trips = new FakeHostTripStore(store);
  const app = await startContractApp({
    cat: {
      store,
      catalog: null,
      photos: { scanner: new UnavailablePhotoScanner(), storage: new UnavailablePhotoStorage() },
      ...(options.trips === false ? {} : { trips }),
    },
  });
  apps.push(app);
  const orgA = randomUUID();
  const orgB = randomUUID();
  for (const [actor, orgId] of [
    ['voyageur', orgA],
    ['staff_sans_mfa', orgB],
  ] as const) {
    store.addHost(Buffer.from(app.hash(actor), 'hex'), {
      orgId,
      country: FIRST_COUNTRY,
      currency: 'XXX',
      status: 'ACTIVE',
    });
  }
  return {
    app,
    store,
    trips,
    orgA,
    orgB,
    a: app.cookie('voyageur'),
    b: app.cookie('staff_sans_mfa'),
  };
}

const LOCATION = {
  kind: 'HOME',
  label: 'Casa',
  addressLine: 'Calle Ficticia 1',
  city: 'Ciudad Ficticia',
  areaLabel: 'Barrio Ficticio',
  lat: 8.983712,
  lng: -79.519843,
};

/** Lieu et véhicule du compte de A par les routes d'US-115. */
async function car(w: World): Promise<string> {
  const api = w.app.api;
  const base = `/host/accounts/${w.orgA}`;
  const loc = await api.request('POST', `${base}/locations`, { headers: w.a, body: LOCATION });
  const locationId = (loc.json as { locationId: string }).locationId;
  const veh = await api.request('POST', `${base}/vehicles`, {
    headers: w.a,
    body: {
      locationId,
      plate: `ab-${randomUUID().slice(0, 6)}`,
      makeText: 'Marca',
      modelText: 'Modelo',
      year: 2021,
      transmission: 'AUTOMATIC',
      seats: 5,
      fuelType: 'GASOLINE',
    },
  });
  expect(veh.status).toBe(201);
  return (veh.json as { vehicleId: string }).vehicleId;
}

const row = (vehicleId: string, tab: HostTripRow['tab'], over: Partial<HostTripRow> = {}) => ({
  tripId: randomUUID(),
  reference: null,
  tab,
  status: tab === 'CANCELLED' ? 'CANCELLED_BY_GUEST' : 'BOOKED',
  vehicleId,
  startsAt: '2036-12-12T14:00:00.000Z',
  endsAt: '2036-12-13T14:00:00.000Z',
  timezone: 'UTC',
  bookedAt: '2036-12-10T15:00:00.000Z',
  paymentStatus: 'CONFIRMED',
  currency: 'XXX',
  hostEarningsMinor: tab === 'CANCELLED' ? null : '12000',
  guest: { firstName: 'Lucía', ageYears: 29, rating: null, verified: true },
  ...over,
});

describe('contrat HTTP — /host/accounts/{orgId}/trips (US-219)', () => {
  afterAll(closeContractApps);

  it('liste : onglets et véhicule, voyageur minimisé, véhicule et lieu joints, montant relu tel quel', async () => {
    const w = await world();
    const vehicleId = await car(w);
    const upcoming = row(vehicleId, 'UPCOMING');
    const cancelled = row(vehicleId, 'CANCELLED');
    w.trips.add(w.orgA, upcoming);
    w.trips.add(w.orgA, cancelled);
    const api = w.app.api;
    const base = `/host/accounts/${w.orgA}/trips`;
    const all = await api.request('GET', base, { headers: w.a });
    expect(all.status).toBe(200);
    const body = all.json as { market: unknown; trips: Record<string, unknown>[] };
    expect(body.market).toEqual({ currency: 'XXX', currencyExponent: expect.any(Number) });
    expect(body.trips).toHaveLength(2);
    expect(body.trips[0]).toMatchObject({
      tripId: upcoming.tripId,
      hostEarningsMinor: '12000',
      vehicle: { id: vehicleId, makeText: 'Marca', modelText: 'Modelo', year: 2021 },
      handoverPlace: 'Casa',
      guest: { firstName: 'Lucía', ageYears: 29, rating: null, verified: true },
    });
    expect(Object.keys(body.trips[0]?.['guest'] as object).sort()).toEqual([
      'ageYears',
      'firstName',
      'rating',
      'verified',
    ]);
    const tab = await api.request('GET', `${base}?tab=CANCELLED&vehicleId=${vehicleId}`, {
      headers: w.a,
    });
    expect((tab.json as { trips: { tripId: string; hostEarningsMinor: unknown }[] }).trips).toEqual(
      [expect.objectContaining({ tripId: cancelled.tripId, hostEarningsMinor: null })],
    );
    const dated = await api.request('GET', `${base}?from=2036-12-01&to=2036-12-31`, {
      headers: w.a,
    });
    expect(dated.status).toBe(200);
  });

  it('saisie invalide ⇒ 400 REQUEST_INVALID (onglet, véhicule, date, période inversée, clé inconnue)', async () => {
    const w = await world();
    const base = `/host/accounts/${w.orgA}/trips`;
    for (const q of [
      'tab=ARCHIVED',
      'vehicleId=pas-un-uuid',
      'from=2036-02-30',
      'from=2036-12-20&to=2036-12-19',
      'guestId=x',
      'tab=UPCOMING&tab=DONE',
    ]) {
      const r = await w.app.api.request('GET', `${base}?${q}`, { headers: w.a });
      expect(r.status, q).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
  });

  it('critère 3 / IDOR : compte de B avec la session de A ⇒ 404 HOST_ACCOUNT_NOT_FOUND ; trip de B (ou inconnu) sur le compte de A ⇒ 404 TRIP_NOT_FOUND ; sans session ⇒ 401', async () => {
    const w = await world();
    const vehicleId = await car(w);
    const mine = row(vehicleId, 'UPCOMING');
    const theirs = row(randomUUID(), 'UPCOMING');
    w.trips.add(w.orgA, mine);
    w.trips.add(w.orgB, theirs);
    const api = w.app.api;
    const other = await api.request('GET', `/host/accounts/${w.orgB}/trips`, { headers: w.a });
    expect(other.status).toBe(404);
    expect(other.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_FOUND' });
    const otherOne = await api.request('GET', `/host/accounts/${w.orgB}/trips/${theirs.tripId}`, {
      headers: w.a,
    });
    expect(otherOne.status).toBe(404);
    expect(otherOne.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_FOUND' });
    for (const id of [theirs.tripId, randomUUID(), 'pas-un-uuid']) {
      const r = await api.request('GET', `/host/accounts/${w.orgA}/trips/${id}`, { headers: w.a });
      expect(r.status).toBe(404);
      expect(r.json).toMatchObject({ code: 'TRIP_NOT_FOUND' });
    }
    const one = await api.request('GET', `/host/accounts/${w.orgA}/trips/${mine.tripId}`, {
      headers: w.a,
    });
    expect(one.status).toBe(200);
    expect(one.json).toMatchObject({ trip: { tripId: mine.tripId, handoverPlace: 'Casa' } });
    expect(
      (await api.request('GET', `/host/accounts/pas-un-uuid/trips`, { headers: w.a })).status,
    ).toBe(404);
    expect((await api.request('GET', `/host/accounts/${w.orgA}/trips`)).status).toBe(401);
    expect((await api.request('GET', `/host/accounts/${w.orgA}/trips/${mine.tripId}`)).status).toBe(
      401,
    );
  });

  it('base indisponible ou magasin absent ⇒ 503 HOST_TRIPS_UNAVAILABLE (fail-closed)', async () => {
    const w = await world();
    w.store.failing = true;
    const list = await w.app.api.request('GET', `/host/accounts/${w.orgA}/trips`, { headers: w.a });
    expect(list.status).toBe(503);
    expect(list.json).toMatchObject({ code: 'HOST_TRIPS_UNAVAILABLE' });
    const none = await world({ trips: false });
    const one = await none.app.api.request(
      'GET',
      `/host/accounts/${none.orgA}/trips/${randomUUID()}`,
      { headers: none.a },
    );
    expect(one.status).toBe(503);
    expect(one.json).toMatchObject({ code: 'HOST_TRIPS_UNAVAILABLE' });
  });

  it('couverture : chaque statut déclaré pour /host/accounts/{orgId}/trips est exercé', () => {
    const covered = coverageOf(...apps);
    expect(missingCoverage(contract, '/host/accounts/{orgId}/trips', covered)).toEqual([]);
  });
});
