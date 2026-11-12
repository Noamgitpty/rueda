/**
 * US-115 — tests de contrat des routes de l'hôte `/host/accounts/{orgId}/…` et de la fiche
 * publique `/listings/{listingId}`, sur l'application RÉELLE (ApiModule, harnais d'US-043) et le
 * FAKE du magasin (sans base) : chaque réponse est confrontée à `apps/api/openapi/openapi.json`.
 * Attendus : 19 US-115 (doublon de plaque, PHOTO_MIN_COUNT, prix au pas du pays, zone seule avant
 * confirmation), 16 HST-005 / HST-011 / HST-012 / PRC-001 / HST-033, 17 §2.3 point 5 (IDOR : 404) ;
 * 19 US-114 et 16 ADM-036 (véhicule hors catalogue : demande d'ajout, annonce non publiable,
 * CATALOG_REQUEST_DUPLICATE).
 * Les règles elles-mêmes sont prouvées sur PostgreSQL (packages/db/test/l0/l0-us115-*). Données
 * fictives.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
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
import { FakeUploadScanner, InMemoryFileStore } from '@rueda/fake-adapters/files';
import {
  UnavailablePhotoScanner,
  UnavailablePhotoStorage,
} from '../internal/host-listings/photo-ingest.js';
import type { Outcome } from '../internal/host-listings/store.js';
import { VehicleCatalogService } from '../internal/vehicle-catalog/vehicle-catalog.service.js';
import type { VehicleCatalogStore } from '../internal/vehicle-catalog/store.js';
import { FakeHostCalendarStore } from './fake-host-calendar-store.js';
import { FakeHostListingStore } from './fake-host-listing-store.js';

/** FAKE dont l'issue de la base est imposée (règles prouvées en base, non modélisées ici). */
class ForcedStore extends FakeHostListingStore {
  forced: string | null = null;
  #force(): Outcome | null {
    return this.forced === null
      ? null
      : { outcome: this.forced, id: this.forced === 'DONE' ? randomUUID() : null };
  }
  override createVehicle(...a: Parameters<FakeHostListingStore['createVehicle']>) {
    return Promise.resolve(this.#force() ?? null).then((f) => f ?? super.createVehicle(...a));
  }
  override createListing(...a: Parameters<FakeHostListingStore['createListing']>) {
    return Promise.resolve(this.#force() ?? null).then((f) => f ?? super.createListing(...a));
  }
  override updatePricing(...a: Parameters<FakeHostListingStore['updatePricing']>) {
    return Promise.resolve(this.#force() ?? null).then((f) => f ?? super.updatePricing(...a));
  }
  override submitListing(...a: Parameters<FakeHostListingStore['submitListing']>) {
    return Promise.resolve(this.#force() ?? null).then((f) => f ?? super.submitListing(...a));
  }
}

const VARIANT = '00000000-0000-4000-8000-0000000000b1';
const MAKE = '00000000-0000-4000-8000-0000000000b2';
const MODEL = '00000000-0000-4000-8000-0000000000b3';

/** Catalogue en mémoire : une marque, un modèle, une variante commune (market nul). */
const catalogStore: VehicleCatalogStore = {
  listMakes: () => Promise.resolve([{ id: MAKE, slug: 'marca', name: 'Marca', aliases: [] }]),
  listModels: (makeId) =>
    Promise.resolve(
      makeId === MAKE
        ? [{ id: MODEL, slug: 'modelo', name: 'Modelo', aliases: [], bodyType: 'SUV' }]
        : [],
    ),
  listVariants: (modelId) =>
    Promise.resolve(
      modelId === MODEL
        ? [
            {
              id: VARIANT,
              yearFrom: 2018,
              yearTo: null,
              trimName: null,
              transmission: 'AT',
              fuelType: 'GASOLINE',
              drive: 'FWD',
            },
          ]
        : [],
    ),
  findVariant: (variantId) =>
    Promise.resolve(
      variantId === VARIANT
        ? {
            id: VARIANT,
            status: 'ACTIVE',
            makeId: MAKE,
            makeName: 'Marca',
            makeStatus: 'ACTIVE',
            modelId: MODEL,
            modelName: 'Modelo',
            modelStatus: 'ACTIVE',
            bodyType: 'SUV',
            yearFrom: 2018,
            yearTo: null,
            trimName: null,
            transmission: 'AT',
            fuelType: 'GASOLINE',
            drive: 'FWD',
            engineCc: null,
            seats: 5,
            doors: 5,
            valueClass: 'STANDARD',
            consumptionL100km: null,
            consumptionSource: null,
          }
        : null,
    ),
};

interface World {
  readonly app: ContractApp;
  readonly store: ForcedStore;
  readonly calendar: FakeHostCalendarStore;
  readonly orgA: string;
  readonly orgB: string;
  /** Hôte A = acteur « voyageur » du harnais ; hôte B = « staff_sans_mfa ». */
  readonly a: Record<string, string>;
  readonly b: Record<string, string>;
}

const apps: ContractApp[] = [];

async function world(
  options: { catalog?: boolean; failing?: boolean; photos?: boolean } = {},
): Promise<World> {
  const store = new ForcedStore();
  store.priceStep.set(FIRST_COUNTRY, 1n);
  const calendar = new FakeHostCalendarStore(store);
  const app = await startContractApp({
    cat: {
      store,
      calendar,
      catalog: options.catalog === false ? null : new VehicleCatalogService(catalogStore),
      photos:
        options.photos === true
          ? {
              scanner: new FakeUploadScanner({ env: { RUEDA_ENV: 'test' } }),
              storage: new InMemoryFileStore({ env: { RUEDA_ENV: 'test' } }),
            }
          : { scanner: new UnavailablePhotoScanner(), storage: new UnavailablePhotoStorage() },
    },
  });
  apps.push(app);
  const orgA = randomUUID();
  const orgB = randomUUID();
  store.addHost(Buffer.from(app.hash('voyageur'), 'hex'), {
    orgId: orgA,
    country: FIRST_COUNTRY,
    currency: 'XXX',
    status: 'ONBOARDING',
  });
  store.addHost(Buffer.from(app.hash('staff_sans_mfa'), 'hex'), {
    orgId: orgB,
    country: FIRST_COUNTRY,
    currency: 'XXX',
    status: 'ONBOARDING',
  });
  return {
    app,
    store,
    calendar,
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

const vehicleBody = (locationId: string, plate: string) => ({
  locationId,
  plate,
  makeText: 'Marca',
  modelText: 'Modelo',
  year: 2021,
  transmission: 'AUTOMATIC',
  seats: 5,
  fuelType: 'GASOLINE',
});

/** Véhicule rattaché au catalogue (variante) : publiable (US-114). */
const linkedBody = (locationId: string, plate: string) => ({
  ...vehicleBody(locationId, plate),
  makeText: undefined,
  modelText: undefined,
  variantId: VARIANT,
});

async function draft(w: World, options: { offCatalog?: boolean } = {}) {
  const api = w.app.api;
  const base = `/host/accounts/${w.orgA}`;
  const loc = await api.request('POST', `${base}/locations`, { headers: w.a, body: LOCATION });
  expect(loc.status).toBe(201);
  const locationId = (loc.json as { locationId: string }).locationId;
  const plate = `ab-${randomUUID().slice(0, 6)}`;
  const veh = await api.request('POST', `${base}/vehicles`, {
    headers: w.a,
    body:
      options.offCatalog === true ? vehicleBody(locationId, plate) : linkedBody(locationId, plate),
  });
  expect(veh.status).toBe(201);
  const vehicleId = (veh.json as { vehicleId: string }).vehicleId;
  const lst = await api.request('POST', `${base}/listings`, {
    headers: w.a,
    body: { vehicleId, dailyPriceMinor: '4000' },
  });
  expect(lst.status).toBe(201);
  return { base, locationId, vehicleId, listingId: (lst.json as { listingId: string }).listingId };
}

describe('contrat HTTP — /host/accounts/{orgId} et /listings (US-115)', () => {
  afterAll(async () => {
    await closeContractApps();
  });

  it('parcours : lieu, véhicule, annonce DRAFT, tarif, lectures ; zone seule sur la fiche publique', async () => {
    const w = await world();
    const api = w.app.api;
    const d = await draft(w);
    const locs = await api.request('GET', `${d.base}/locations`, { headers: w.a });
    expect(locs.status).toBe(200);
    expect(locs.json).toMatchObject({ locations: [{ id: d.locationId, label: 'Casa' }] });
    expect((await api.request('GET', `${d.base}/vehicles`, { headers: w.a })).status).toBe(200);
    const listings = await api.request('GET', `${d.base}/listings`, { headers: w.a });
    expect(listings.json).toMatchObject({
      listings: [{ id: d.listingId, status: 'DRAFT' }],
      market: { country: FIRST_COUNTRY, currencyExponent: 2 },
    });
    const priced = await api.request('PUT', `${d.base}/listings/${d.listingId}/pricing`, {
      headers: w.a,
      body: {
        dailyPriceMinor: '5000',
        mileageMode: 'INCLUDED',
        includedKmPerDay: 250,
        extraKmPriceMinor: '25',
      },
    });
    expect(priced.status).toBe(200);
    expect(priced.json).toMatchObject({ code: 'LISTING_SAVED' });
    // brouillon : jamais public
    expect((await api.request('GET', `/listings/${d.listingId}`)).status).toBe(404);
    const l = w.store.listingsById.get(d.listingId);
    if (l) l.status = 'LISTED';
    const pub = await api.request('GET', `/listings/${d.listingId}`);
    expect(pub.status).toBe(200);
    const text = pub.text;
    expect(pub.json).toMatchObject({
      listing: {
        city: 'Ciudad Ficticia',
        areaLabel: 'Barrio Ficticio',
        approximatePoint: { lat: 8.98, lng: -79.52 },
      },
    });
    for (const secret of ['Casa', 'Calle Ficticia', '8.983712', '-79.519843']) {
      expect(text, secret).not.toContain(secret);
    }
    // catalogue du marché du compte
    expect((await api.request('GET', `${d.base}/catalog/makes`, { headers: w.a })).status).toBe(
      200,
    );
    expect(
      (await api.request('GET', `${d.base}/catalog/makes/${MAKE}/models`, { headers: w.a })).status,
    ).toBe(200);
    expect(
      (
        await api.request('GET', `${d.base}/catalog/models/${MODEL}/variants?year=2021`, {
          headers: w.a,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api.request('GET', `${d.base}/catalog/models/${MODEL}/variants?year=20x1`, {
          headers: w.a,
        })
      ).status,
    ).toBe(400);
    const prefill = await api.request('GET', `${d.base}/catalog/variants/${VARIANT}/prefill`, {
      headers: w.a,
    });
    expect(prefill.status).toBe(200);
    expect(prefill.json).toMatchObject({
      prefill: { variantId: VARIANT, seats: 5, transmission: 'AUTOMATIC' },
    });
    expect(
      (
        await api.request('GET', `${d.base}/catalog/variants/${randomUUID()}/prefill`, {
          headers: w.a,
        })
      ).status,
    ).toBe(404);
  });

  it('critère 1 : plaque déjà enregistrée (casse, tirets) ⇒ 409 VEHICLE_PLATE_DUPLICATE ; champs refusés ⇒ 400 avec `fields`, jamais leur valeur', async () => {
    const w = await world();
    const api = w.app.api;
    const base = `/host/accounts/${w.orgA}`;
    const loc = await api.request('POST', `${base}/locations`, { headers: w.a, body: LOCATION });
    const locationId = (loc.json as { locationId: string }).locationId;
    expect(
      (
        await api.request('POST', `${base}/vehicles`, {
          headers: w.a,
          body: vehicleBody(locationId, 'ab-123'),
        })
      ).status,
    ).toBe(201);
    const dup = await api.request('POST', `${base}/vehicles`, {
      headers: w.a,
      body: vehicleBody(locationId, 'AB 123'),
    });
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({ code: 'VEHICLE_PLATE_DUPLICATE' });
    const bad = await api.request('POST', `${base}/vehicles`, {
      headers: w.a,
      body: { ...vehicleBody(locationId, 'Пл-1'), seats: 0, vin: 'IOQ45678901234567' },
    });
    expect(bad.status).toBe(400);
    const fields = (bad.json as { fields: { field: string }[] }).fields.map((f) => f.field).sort();
    expect(fields).toEqual(['plate', 'seats', 'vin']);
    expect(bad.text).not.toContain('IOQ');
    // emplacement d'un autre (ou inconnu) : 404
    expect(
      (
        await api.request('POST', `${base}/vehicles`, {
          headers: w.a,
          body: vehicleBody(randomUUID(), 'zz-999'),
        })
      ).status,
    ).toBe(404);
    // champ jugé par la base (forcé)
    w.store.forced = 'VEHICLE_FIELD_REQUIRED';
    expect(
      (
        await api.request('POST', `${base}/vehicles`, {
          headers: w.a,
          body: vehicleBody(locationId, 'yy-1'),
        })
      ).status,
    ).toBe(422);
    // lieu : corps invalide, épingle à moitié posée, 415
    for (const body of [{}, { ...LOCATION, lng: undefined }, { ...LOCATION, extra: 1 }]) {
      expect((await api.request('POST', `${base}/locations`, { headers: w.a, body })).status).toBe(
        400,
      );
    }
    expect((await api.request('POST', `${base}/locations`, { ...textBody(w.a) })).status).toBe(415);
    expect((await api.request('POST', `${base}/vehicles`, { ...textBody(w.a) })).status).toBe(415);
  });

  it('critère 2 et N-37 : soumission sans assez de photos ⇒ 422 PHOTO_MIN_COUNT ; CGU de l’hôte non acceptées ⇒ 409 TERMS_REACCEPT_REQUIRED (US-126) ; hôte non activé ⇒ 422 HOST_NOT_ACTIVATED ; transitions de SM-2', async () => {
    const w = await world();
    const api = w.app.api;
    const d = await draft(w);
    const submit = () =>
      api.request('POST', `${d.base}/listings/${d.listingId}/submit`, { headers: w.a, body: {} });
    const few = await submit();
    expect(few.status).toBe(422);
    expect(few.json).toMatchObject({ code: 'PHOTO_MIN_COUNT' });
    const l = w.store.listingsById.get(d.listingId);
    if (l) l.photos = 6;
    // CGU de l'hôte non acceptées (US-126) : 409, l'annonce reste DRAFT
    const terms = await submit();
    expect(terms.status).toBe(409);
    expect(terms.json).toMatchObject({ code: 'TERMS_REACCEPT_REQUIRED' });
    expect(w.store.listingsById.get(d.listingId)?.status).toBe('DRAFT');
    w.store.hostTermsAccepted.add(w.orgA);
    expect((await submit()).json).toMatchObject({ code: 'HOST_NOT_ACTIVATED' });
    expect(w.store.listingsById.get(d.listingId)?.status).toBe('DRAFT');
    // US-108 : couverture de l'assureur à la soumission (16 A.8) : 422, l'annonce reste DRAFT
    for (const code of ['VEHICLE_NOT_COVERED', 'INSURER_CONTRACT_INACTIVE'] as const) {
      w.store.forced = code;
      const refused = await submit();
      expect(refused.status).toBe(422);
      expect(refused.json).toMatchObject({ code });
    }
    w.store.forced = 'DONE';
    const done = await submit();
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ code: 'LISTING_SUBMITTED', status: 'PENDING_REVIEW' });
    w.store.forced = 'LISTING_TRANSITION_FORBIDDEN';
    expect((await submit()).status).toBe(409);
    w.store.forced = null;
    expect(
      (await api.request('POST', `${d.base}/listings/${d.listingId}/submit`, { ...textBody(w.a) }))
        .status,
    ).toBe(415);
    // suppression d'un brouillon, puis plus rien
    const del = await api.request('DELETE', `${d.base}/listings/${d.listingId}`, { headers: w.a });
    expect(del.status).toBe(200);
    expect(del.json).toMatchObject({ code: 'LISTING_DELETED', status: 'DELETED' });
    expect(
      (await api.request('DELETE', `${d.base}/listings/${d.listingId}`, { headers: w.a })).status,
    ).toBe(409);
    expect(
      (await api.request('DELETE', `${d.base}/listings/${d.listingId}`, { ...textBody(w.a) }))
        .status,
    ).toBe(415);
    // l'annonce supprimée libère son véhicule : une nouvelle annonce peut être créée
    const vehicleId = w.store.listingsById.get(d.listingId)?.vehicleId;
    const again = await api.request('POST', `${d.base}/listings`, {
      headers: w.a,
      body: { vehicleId, dailyPriceMinor: '4000' },
    });
    expect(again.status).toBe(201);
    expect((again.json as { listingId: string }).listingId).not.toBe(d.listingId);
  });

  it('US-114 : véhicule hors catalogue ⇒ demande d’ajout OPEN lue avec le véhicule ; soumission ⇒ 409 CATALOG_ADDITION_PENDING (annonce DRAFT) ; nouvelle demande ⇒ 409 CATALOG_REQUEST_DUPLICATE tant qu’une demande est ouverte, 201 après un refus ; véhicule rattaché ⇒ 409 CATALOG_ALREADY_LINKED', async () => {
    const w = await world();
    const api = w.app.api;
    const d = await draft(w, { offCatalog: true });
    const vehicles = await api.request('GET', `${d.base}/vehicles`, { headers: w.a });
    expect(vehicles.status).toBe(200);
    expect(vehicles.json).toMatchObject({
      vehicles: [
        {
          id: d.vehicleId,
          variantId: null,
          catalogRequest: {
            status: 'OPEN',
            makeText: 'Marca',
            modelText: 'Modelo',
            rejectReason: null,
          },
        },
      ],
    });
    const l = w.store.listingsById.get(d.listingId);
    if (l) l.photos = 6;
    w.store.hostTermsAccepted.add(w.orgA);
    const pending = await api.request('POST', `${d.base}/listings/${d.listingId}/submit`, {
      headers: w.a,
      body: {},
    });
    expect(pending.status).toBe(409);
    expect(pending.json).toMatchObject({
      code: 'CATALOG_ADDITION_PENDING',
      messageKey: 'common.catalogAddition.pending',
    });
    expect(w.store.listingsById.get(d.listingId)?.status).toBe('DRAFT');
    const ask = (body: unknown, vehicleId = d.vehicleId, headers = w.a, base = d.base) =>
      api.request('POST', `${base}/vehicles/${vehicleId}/catalog-request`, { headers, body });
    const dup = await ask({ makeText: 'Chery', modelText: 'Tiggo 2' });
    expect(dup.status).toBe(409);
    expect(dup.json).toMatchObject({ code: 'CATALOG_REQUEST_DUPLICATE' });
    // refus de l'ops (décision prouvée en base, l0-us114) : l'hôte redemande
    const open = w.store.catalogRequests.get(d.vehicleId);
    if (open) {
      w.store.catalogRequests.set(d.vehicleId, {
        ...open,
        status: 'REJECTED',
        rejectReason: 'UNKNOWN_MODEL',
      });
    }
    const rejected = await api.request('GET', `${d.base}/vehicles`, { headers: w.a });
    expect(rejected.json).toMatchObject({
      vehicles: [{ catalogRequest: { status: 'REJECTED', rejectReason: 'UNKNOWN_MODEL' } }],
    });
    const refused = await api.request('POST', `${d.base}/listings/${d.listingId}/submit`, {
      headers: w.a,
      body: {},
    });
    expect(refused.status).toBe(409);
    expect(refused.json).toMatchObject({ code: 'CATALOG_ADDITION_REJECTED' });
    const again = await ask({ makeText: 'Chery', modelText: 'Tiggo 2', trim: 'Comfort' });
    expect(again.status).toBe(201);
    expect(again.json).toMatchObject({
      code: 'CATALOG_REQUEST_CREATED',
      messageKey: 'common.catalogAddition.requested',
    });
    expect((again.json as { requestId: string }).requestId).toMatch(/^[0-9a-f-]{36}$/);
    // saisie refusée avant la base : 400 avec `fields`
    for (const body of [
      {},
      { makeText: 'Chery' },
      { makeText: 'Chery', modelText: 'x', extra: 1 },
    ]) {
      const bad = await ask(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
    expect(
      (
        await api.request('POST', `${d.base}/vehicles/${d.vehicleId}/catalog-request`, {
          ...textBody(w.a),
        })
      ).status,
    ).toBe(415);
    // véhicule non admis : plus de nouvelle demande
    const reopened = w.store.catalogRequests.get(d.vehicleId);
    if (reopened) {
      w.store.catalogRequests.set(d.vehicleId, {
        ...reopened,
        status: 'REJECTED',
        rejectReason: 'NOT_ELIGIBLE',
      });
    }
    const notAllowed = await ask({ makeText: 'Chery', modelText: 'Tiggo 2' });
    expect(notAllowed.status).toBe(409);
    expect(notAllowed.json).toMatchObject({ code: 'CATALOG_REQUEST_NOT_ALLOWED' });
    // véhicule rattaché au catalogue : rien à demander
    const linked = await draft(w);
    expect((await ask({ makeText: 'Marca', modelText: 'Modelo' }, linked.vehicleId)).status).toBe(
      409,
    );
    // véhicule d'un autre (ou inconnu, ou identifiant mal formé) : 404
    const bBase = `/host/accounts/${w.orgB}`;
    expect(
      (await ask({ makeText: 'Chery', modelText: 'Tiggo 2' }, d.vehicleId, w.b, bBase)).status,
    ).toBe(404);
    expect((await ask({ makeText: 'Chery', modelText: 'Tiggo 2' }, 'pas-un-uuid')).status).toBe(
      404,
    );
    expect((await ask({ makeText: 'Chery', modelText: 'Tiggo 2' }, d.vehicleId, w.b)).status).toBe(
      404,
    );
    expect((await ask({ makeText: 'Chery', modelText: 'Tiggo 2' }, d.vehicleId, {})).status).toBe(
      401,
    );
    w.store.failing = true;
    expect((await ask({ makeText: 'Chery', modelText: 'Tiggo 2' })).status).toBe(503);
    w.store.failing = false;
  });

  it('critère 3 : prix hors pas du pays ⇒ 422 PRICE_INVALID ; distance invalide ⇒ 400 ; une annonce par véhicule ⇒ 409', async () => {
    const w = await world();
    w.store.priceStep.set(FIRST_COUNTRY, 1000n);
    const api = w.app.api;
    const base = `/host/accounts/${w.orgA}`;
    const loc = await api.request('POST', `${base}/locations`, { headers: w.a, body: LOCATION });
    const locationId = (loc.json as { locationId: string }).locationId;
    const veh = await api.request('POST', `${base}/vehicles`, {
      headers: w.a,
      body: vehicleBody(locationId, 'pp-1'),
    });
    const vehicleId = (veh.json as { vehicleId: string }).vehicleId;
    const off = await api.request('POST', `${base}/listings`, {
      headers: w.a,
      body: { vehicleId, dailyPriceMinor: '250500' },
    });
    expect(off.status).toBe(422);
    expect(off.json).toMatchObject({ code: 'PRICE_INVALID' });
    // montant décimal ou nombre : refusés avant la base (unités mineures en chaîne d'entier)
    for (const dailyPriceMinor of ['2505.5', 250000, '-1']) {
      expect(
        (
          await api.request('POST', `${base}/listings`, {
            headers: w.a,
            body: { vehicleId, dailyPriceMinor },
          })
        ).status,
      ).toBe(400);
    }
    const ok = await api.request('POST', `${base}/listings`, {
      headers: w.a,
      body: { vehicleId, dailyPriceMinor: '250000' },
    });
    expect(ok.status).toBe(201);
    const listingId = (ok.json as { listingId: string }).listingId;
    expect(
      (
        await api.request('POST', `${base}/listings`, {
          headers: w.a,
          body: { vehicleId, dailyPriceMinor: '250000' },
        })
      ).status,
    ).toBe(409);
    const pricing = (body: unknown) =>
      api.request('PUT', `${base}/listings/${listingId}/pricing`, { headers: w.a, body });
    expect((await pricing({ dailyPriceMinor: '250500' })).status).toBe(422);
    // plafond de cohérence du pays (16 PRC-001) : au plafond accepté, au-delà PRICE_INVALID
    w.store.priceCeiling.set(FIRST_COUNTRY, 35_000_000n);
    expect((await pricing({ dailyPriceMinor: '35000000' })).status).toBe(200);
    const over = await pricing({ dailyPriceMinor: '35001000' });
    expect(over.status).toBe(422);
    expect(over.json).toMatchObject({ code: 'PRICE_INVALID' });
    expect((await pricing({ dailyPriceMinor: '300000', mileageMode: 'INCLUDED' })).status).toBe(
      400,
    );
    w.store.forced = 'LISTING_TRANSITION_FORBIDDEN';
    expect((await pricing({ dailyPriceMinor: '300000' })).status).toBe(409);
    w.store.forced = 'MILEAGE_CONFIG_INVALID';
    expect((await pricing({ dailyPriceMinor: '300000' })).status).toBe(422);
    w.store.forced = null;
    expect(
      (await api.request('PUT', `${base}/listings/${listingId}/pricing`, { ...textBody(w.a) }))
        .status,
    ).toBe(415);
    expect((await api.request('POST', `${base}/listings`, { ...textBody(w.a) })).status).toBe(415);
  });

  it('L1-PM-11 — IDOR : B ne voit ni ne modifie rien de A (404 partout, jamais 403) ; sans session : 401', async () => {
    const w = await world();
    const api = w.app.api;
    const d = await draft(w);
    const aBase = d.base;
    // B sur le compte de A
    for (const path of [
      'locations',
      'vehicles',
      'listings',
      'catalog/makes',
      `catalog/makes/${MAKE}/models`,
      `catalog/models/${MODEL}/variants`,
      `catalog/variants/${VARIANT}/prefill`,
    ]) {
      const r = await api.request('GET', `${aBase}/${path}`, { headers: w.b });
      expect(r.status, path).toBe(404);
      expect(r.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_FOUND' });
    }
    expect(
      (await api.request('POST', `${aBase}/locations`, { headers: w.b, body: LOCATION })).status,
    ).toBe(404);
    expect(
      (
        await api.request('POST', `${aBase}/vehicles`, {
          headers: w.b,
          body: vehicleBody(d.locationId, 'qq-1'),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api.request('POST', `${aBase}/listings`, {
          headers: w.b,
          body: { vehicleId: d.vehicleId, dailyPriceMinor: '1' },
        })
      ).status,
    ).toBe(404);
    // B sous son propre compte, sur l'annonce de A
    const bBase = `/host/accounts/${w.orgB}`;
    expect(
      (
        await api.request('PUT', `${bBase}/listings/${d.listingId}/pricing`, {
          headers: w.b,
          body: { dailyPriceMinor: '1' },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await api.request('POST', `${bBase}/listings/${d.listingId}/submit`, {
          headers: w.b,
          body: {},
        })
      ).status,
    ).toBe(404);
    expect(
      (await api.request('DELETE', `${bBase}/listings/${d.listingId}`, { headers: w.b })).status,
    ).toBe(404);
    expect(
      (
        await api.request('POST', `${bBase}/listings`, {
          headers: w.b,
          body: { vehicleId: d.vehicleId, dailyPriceMinor: '1' },
        })
      ).status,
    ).toBe(404);
    // identifiant mal formé : 404, comme inconnu
    expect(
      (await api.request('GET', `/host/accounts/pas-un-uuid/listings`, { headers: w.a })).status,
    ).toBe(404);
    expect((await api.request('GET', `/listings/pas-un-uuid`)).status).toBe(404);
    // A intact
    expect(w.store.listingsById.get(d.listingId)?.pricing.dailyPriceMinor).toBe(4000n);
    // sans session : 401 sur chaque route de l'hôte
    for (const [method, path] of [
      ['GET', `${aBase}/locations`],
      ['POST', `${aBase}/locations`],
      ['GET', `${aBase}/vehicles`],
      ['POST', `${aBase}/vehicles`],
      ['GET', `${aBase}/listings`],
      ['POST', `${aBase}/listings`],
      ['PUT', `${aBase}/listings/${d.listingId}/pricing`],
      ['POST', `${aBase}/listings/${d.listingId}/submit`],
      ['DELETE', `${aBase}/listings/${d.listingId}`],
      ['GET', `${aBase}/catalog/makes`],
      ['GET', `${aBase}/catalog/makes/${MAKE}/models`],
      ['GET', `${aBase}/catalog/models/${MODEL}/variants`],
      ['GET', `${aBase}/catalog/variants/${VARIANT}/prefill`],
    ] as const) {
      const r = await api.request(method, path, method === 'GET' ? {} : { body: {} });
      expect(r.status, `${method} ${path}`).toBe(401);
    }
  });

  it('photos : production (antivirus et stockage absents) ⇒ 503 ; FAKE sain ⇒ 201 ; type trompeur ⇒ 422 ; base64 invalide ⇒ 400 ; annonce d’un autre ⇒ 404 ; annonce publiée ⇒ 409', async () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03]),
      Buffer.alloc(9),
      Buffer.from([0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9]),
    ]).toString('base64');
    const closed = await world();
    const d0 = await draft(closed);
    const off = await closed.app.api.request('POST', `${d0.base}/listings/${d0.listingId}/photos`, {
      headers: closed.a,
      body: { dataBase64: jpeg },
    });
    expect(off.status).toBe(503);
    expect(off.json).toMatchObject({ code: 'PHOTO_UPLOAD_UNAVAILABLE' });
    // l'écran sait AVANT l'envoi que le dépôt est fermé, et connaît la taille maximale
    const closedList = await closed.app.api.request('GET', `${d0.base}/listings`, {
      headers: closed.a,
    });
    expect(closedList.json).toMatchObject({ photoUploads: { open: false } });
    const w = await world({ photos: true });
    const api = w.app.api;
    const d = await draft(w);
    const openList = await api.request('GET', `${d.base}/listings`, { headers: w.a });
    const uploads = (openList.json as { photoUploads: { open: boolean; maxBytes: number } })
      .photoUploads;
    expect(uploads.open).toBe(true);
    // base64 d'une photo de cette taille, dans son enveloppe JSON, tient dans le corps admis
    expect(Math.ceil(uploads.maxBytes / 3) * 4 + 64).toBeLessThanOrEqual(100 * 1024);
    const send = (body: unknown, headers = w.a, listingId = d.listingId) =>
      api.request('POST', `${d.base}/listings/${listingId}/photos`, { headers, body });
    const ok = await send({ dataBase64: jpeg });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ code: 'PHOTO_ADDED' });
    expect(w.store.listingsById.get(d.listingId)?.photos).toBe(1);
    expect((await send({ dataBase64: Buffer.from('<svg/>').toString('base64') })).status).toBe(422);
    expect((await send({ dataBase64: 'pas du base64 !' })).status).toBe(400);
    expect((await send({ dataBase64: jpeg }, w.a, randomUUID())).status).toBe(404);
    expect((await send({ dataBase64: jpeg }, {})).status).toBe(401);
    expect(
      (
        await api.request('POST', `${d.base}/listings/${d.listingId}/photos`, {
          ...textBody(w.a),
        })
      ).status,
    ).toBe(415);
    const l = w.store.listingsById.get(d.listingId);
    if (l) l.status = 'LISTED';
    expect((await send({ dataBase64: jpeg })).status).toBe(409);
  });

  it('compte suspendu ⇒ 403 HOST_ACCOUNT_SUSPENDED ; base indisponible ⇒ 503 LISTING_UNAVAILABLE', async () => {
    const w = await world();
    const api = w.app.api;
    const host = w.store.hosts.get(w.app.hash('voyageur'))?.[0];
    if (host) host.status = 'SUSPENDED';
    const r = await api.request('POST', `/host/accounts/${w.orgA}/locations`, {
      headers: w.a,
      body: LOCATION,
    });
    expect(r.status).toBe(403);
    expect(r.json).toMatchObject({ code: 'HOST_ACCOUNT_SUSPENDED' });
    if (host) host.status = 'ONBOARDING';
    w.store.failing = true;
    const down = await api.request('POST', `/host/accounts/${w.orgA}/locations`, {
      headers: w.a,
      body: LOCATION,
    });
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'LISTING_UNAVAILABLE' });
  });

  // ---- calendrier, blocages et préavis (US-119) ------------------------------------------
  it('US-119 : calendrier du véhicule, blocage par jours puis par heures, créneau pris ⇒ 409 sans détail, levée, préavis', async () => {
    const w = await world();
    const api = w.app.api;
    const d = await draft(w);
    const car = `${d.base}/vehicles/${d.vehicleId}`;
    // annonce non publiée : blocage refusé (409 VEHICLE_NOT_LISTED), calendrier lisible
    const notListed = await api.request('POST', `${car}/blocks`, {
      headers: w.a,
      body: { from: '2036-12-10', to: '2036-12-12' },
    });
    expect(notListed.status).toBe(409);
    expect(notListed.json).toMatchObject({ code: 'VEHICLE_NOT_LISTED' });
    const listing = w.store.listingsById.get(d.listingId);
    if (listing) listing.status = 'LISTED';
    const empty = await api.request('GET', `${car}/calendar`, { headers: w.a });
    expect(empty.status).toBe(200);
    expect(empty.json).toMatchObject({
      vehicle: {
        id: d.vehicleId,
        listed: true,
        locationId: d.locationId,
        noticeMinutes: null,
        effectiveNoticeMinutes: 180,
      },
      entries: [],
    });
    // du 10 au 12 inclus : [10 00:00, 13 00:00) en heure locale du véhicule
    const days = await api.request('POST', `${car}/blocks`, {
      headers: w.a,
      body: { from: '2036-12-10', to: '2036-12-12' },
    });
    expect(days.status).toBe(201);
    expect(days.json).toMatchObject({
      code: 'BLOCK_CREATED',
      messageKey: 'common.calendar.blockCreated',
    });
    const blockId = (days.json as { blockId: string }).blockId;
    const hours = await api.request('POST', `${car}/blocks`, {
      headers: w.a,
      body: { start: '2036-12-14T08:30', end: '2036-12-14T12:00' },
    });
    expect(hours.status).toBe(201);
    const taken = await api.request('POST', `${car}/blocks`, {
      headers: w.a,
      body: { start: '2036-12-11T10:00', end: '2036-12-11T12:00' },
    });
    expect(taken.status).toBe(409);
    expect(taken.json).toEqual({
      code: 'VEHICLE_UNAVAILABLE',
      messageKey: 'common.calendar.vehicleUnavailable',
    });
    const past = await api.request('POST', `${car}/blocks`, {
      headers: w.a,
      body: { from: '2001-01-01', to: '2001-01-02' },
    });
    expect(past.status).toBe(422);
    expect(past.json).toMatchObject({ code: 'INVALID_PERIOD' });
    const cal = await api.request('GET', `${car}/calendar`, { headers: w.a });
    expect((cal.json as { entries: unknown[] }).entries).toEqual([
      expect.objectContaining({
        id: blockId,
        kind: 'HOST_BLOCK',
        startLocal: '2036-12-10T00:00',
        endLocal: '2036-12-13T00:00',
        removable: true,
      }),
      expect.objectContaining({ startLocal: '2036-12-14T08:30', endLocal: '2036-12-14T12:00' }),
    ]);
    // saisie refusée champ par champ : jour impossible, pas de 30 min, mélange, fin avant début
    for (const body of [
      { from: '2036-02-30', to: '2036-03-01' },
      { start: '2036-12-14T08:15', end: '2036-12-14T12:00' },
      { from: '2036-12-10', end: '2036-12-14T12:00' },
      { from: '2036-12-12', to: '2036-12-10' },
      { start: '2036-12-14T12:00', end: '2036-12-14T12:00' },
    ]) {
      const r = await api.request('POST', `${car}/blocks`, { headers: w.a, body });
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json).toMatchObject({ code: 'REQUEST_INVALID' });
    }
    // levée ; seconde levée : 404 BLOCK_NOT_FOUND
    const del = await api.request('DELETE', `${car}/blocks/${blockId}`, { headers: w.a });
    expect(del.status).toBe(200);
    expect(del.json).toEqual({ code: 'BLOCK_REMOVED', messageKey: 'common.calendar.blockRemoved' });
    const again = await api.request('DELETE', `${car}/blocks/${blockId}`, { headers: w.a });
    expect(again.status).toBe(404);
    expect(again.json).toMatchObject({ code: 'BLOCK_NOT_FOUND' });
    expect(
      (await api.request('DELETE', `${car}/blocks/${blockId}`, { ...textBody(w.a) })).status,
    ).toBe(415);
    // préavis du lieu : 3 h, puis défaut du pays ; hors bornes ou hors pas : 400
    const notice = `${d.base}/locations/${d.locationId}/notice`;
    const set = await api.request('PUT', notice, { headers: w.a, body: { minutes: 180 } });
    expect(set.status).toBe(200);
    expect(set.json).toEqual({ code: 'NOTICE_SAVED', messageKey: 'common.calendar.noticeSaved' });
    const reread = await api.request('GET', `${car}/calendar`, { headers: w.a });
    expect(
      (reread.json as { vehicle: { noticeMinutes: number | null } }).vehicle.noticeMinutes,
    ).toBe(180);
    const reset = await api.request('PUT', notice, { headers: w.a, body: { minutes: null } });
    expect(reset.status).toBe(200);
    for (const minutes of [45, 0, 10_110, 90.5, '180']) {
      const r = await api.request('PUT', notice, { headers: w.a, body: { minutes } });
      expect(r.status, String(minutes)).toBe(400);
    }
    expect((await api.request('PUT', notice, { headers: w.a, body: {} })).status).toBe(400);
    expect((await api.request('PUT', notice, { ...textBody(w.a) })).status).toBe(415);
    expect((await api.request('POST', `${car}/blocks`, { ...textBody(w.a) })).status).toBe(415);
  });

  it('US-119 : IDOR — un autre hôte, un compte d’autrui, un identifiant mal formé ⇒ 404 ; sans session ⇒ 401 ; compte suspendu ⇒ 403 ; base indisponible ⇒ 503', async () => {
    const w = await world();
    const api = w.app.api;
    const d = await draft(w);
    const listing = w.store.listingsById.get(d.listingId);
    if (listing) listing.status = 'LISTED';
    const car = `${d.base}/vehicles/${d.vehicleId}`;
    const block = await api.request('POST', `${car}/blocks`, {
      headers: w.a,
      body: { from: '2036-12-20', to: '2036-12-20' },
    });
    const blockId = (block.json as { blockId: string }).blockId;
    const bBase = `/host/accounts/${w.orgB}`;
    const bCar = `${bBase}/vehicles/${d.vehicleId}`;
    // l'hôte B, avec son propre compte, vise le véhicule, le blocage et le lieu de A
    const read = await api.request('GET', `${bCar}/calendar`, { headers: w.b });
    expect(read.status).toBe(404);
    expect(read.json).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
    const put = await api.request('POST', `${bCar}/blocks`, {
      headers: w.b,
      body: { from: '2036-12-22', to: '2036-12-22' },
    });
    expect(put.status).toBe(404);
    expect(put.json).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
    const del = await api.request('DELETE', `${bCar}/blocks/${blockId}`, { headers: w.b });
    expect(del.status).toBe(404);
    expect(del.json).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
    const notice = await api.request('PUT', `${bBase}/locations/${d.locationId}/notice`, {
      headers: w.b,
      body: { minutes: 240 },
    });
    expect(notice.status).toBe(404);
    expect(notice.json).toMatchObject({ code: 'LOCATION_NOT_FOUND' });
    // l'hôte B avec le compte de A : 404 HOST_ACCOUNT_NOT_FOUND partout
    const routes: readonly (readonly ['GET' | 'POST' | 'DELETE' | 'PUT', string, unknown])[] = [
      ['GET', `${car}/calendar`, undefined],
      ['POST', `${car}/blocks`, { from: '2036-12-22', to: '2036-12-22' }],
      ['DELETE', `${car}/blocks/${blockId}`, undefined],
      ['PUT', `${d.base}/locations/${d.locationId}/notice`, { minutes: 240 }],
    ];
    for (const [method, path, body] of routes) {
      const r = await api.request(method, path, {
        headers: w.b,
        ...(body === undefined ? {} : { body }),
      });
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(r.json).toMatchObject({ code: 'HOST_ACCOUNT_NOT_FOUND' });
    }
    // identifiants mal formés : 404 comme un identifiant inconnu
    const badCar = await api.request('GET', `${d.base}/vehicles/pas-un-uuid/calendar`, {
      headers: w.a,
    });
    expect(badCar.json).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
    const badBlock = await api.request('DELETE', `${car}/blocks/pas-un-uuid`, { headers: w.a });
    expect(badBlock.json).toMatchObject({ code: 'BLOCK_NOT_FOUND' });
    // rien n'a changé chez A
    const cal = await api.request('GET', `${car}/calendar`, { headers: w.a });
    expect((cal.json as { entries: { id: string }[] }).entries.map((e) => e.id)).toEqual([blockId]);
    // sans session
    for (const [method, path, body] of routes) {
      const r = await api.request(method, path, body === undefined ? {} : { body });
      expect(r.status, `${method} ${path}`).toBe(401);
    }
    // compte suspendu : aucune écriture
    const host = w.store.hosts.get(w.app.hash('voyageur'))?.[0];
    if (host) host.status = 'SUSPENDED';
    const suspended = await api.request('POST', `${car}/blocks`, {
      headers: w.a,
      body: { from: '2036-12-24', to: '2036-12-24' },
    });
    expect(suspended.status).toBe(403);
    expect(suspended.json).toMatchObject({ code: 'HOST_ACCOUNT_SUSPENDED' });
    if (host) host.status = 'ONBOARDING';
    // base indisponible
    w.store.failing = true;
    expect((await api.request('GET', `${car}/calendar`, { headers: w.a })).status).toBe(503);
    const down = await api.request('POST', `${car}/blocks`, {
      headers: w.a,
      body: { from: '2036-12-24', to: '2036-12-24' },
    });
    expect(down.status).toBe(503);
    expect(down.json).toMatchObject({ code: 'LISTING_UNAVAILABLE' });
  });

  it('couverture : chaque statut déclaré pour /host/accounts/{orgId} est exercé ; chaque statut déclaré pour /listings est exercé', () => {
    const covered = coverageOf(...apps);
    // les CGU de l'hôte (/host/accounts/{orgId}/terms, US-126) et la vérification de l'hôte
    // (/host/accounts/{orgId}/verification, US-123) ont leur propre suite (CTR, KYC)
    expect(
      missingCoverage(contract, '/host/accounts/{orgId}', covered).filter(
        (d) =>
          !d.includes(' /host/accounts/{orgId}/terms') &&
          !d.includes(' /host/accounts/{orgId}/verification'),
      ),
    ).toEqual([]);
    expect(missingCoverage(contract, '/listings', covered)).toEqual([]);
  });
});
