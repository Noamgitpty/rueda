/**
 * US-115 — tests de contrat des routes de l'hôte `/host/accounts/{orgId}/…` et de la fiche
 * publique `/listings/{listingId}`, sur l'application RÉELLE (ApiModule, harnais d'US-043) et le
 * FAKE du magasin (sans base) : chaque réponse est confrontée à `apps/api/openapi/openapi.json`.
 * Attendus : 19 US-115 (doublon de plaque, PHOTO_MIN_COUNT, prix au pas du pays, zone seule avant
 * confirmation), 16 HST-005 / HST-011 / HST-012 / PRC-001 / HST-033, 17 §2.3 point 5 (IDOR : 404).
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
  const app = await startContractApp({
    cat: {
      store,
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
  return { app, store, orgA, orgB, a: app.cookie('voyageur'), b: app.cookie('staff_sans_mfa') };
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

async function draft(w: World) {
  const api = w.app.api;
  const base = `/host/accounts/${w.orgA}`;
  const loc = await api.request('POST', `${base}/locations`, { headers: w.a, body: LOCATION });
  expect(loc.status).toBe(201);
  const locationId = (loc.json as { locationId: string }).locationId;
  const veh = await api.request('POST', `${base}/vehicles`, {
    headers: w.a,
    body: vehicleBody(locationId, `ab-${randomUUID().slice(0, 6)}`),
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

  it('couverture : chaque statut déclaré pour /host/accounts/{orgId} est exercé ; chaque statut déclaré pour /listings est exercé', () => {
    const covered = coverageOf(...apps);
    // les CGU de l'hôte (/host/accounts/{orgId}/terms, US-126) ont leur propre suite (CTR)
    expect(
      missingCoverage(contract, '/host/accounts/{orgId}', covered).filter(
        (d) => !d.includes(' /host/accounts/{orgId}/terms'),
      ),
    ).toEqual([]);
    expect(missingCoverage(contract, '/listings', covered)).toEqual([]);
  });
});
