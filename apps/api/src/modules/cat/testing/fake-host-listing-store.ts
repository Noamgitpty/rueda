/**
 * FAKE du magasin des lieux, véhicules et annonces de l'hôte (US-115) — TESTS SEULEMENT (absent de
 * la compilation de production). Reproduit les issues des commandes `core.catalog_*` de 0067 que
 * les tests de contrat HTTP observent ; les règles elles-mêmes (propriété, pays, doublons, pas du
 * prix, SM-2) sont prouvées sur PostgreSQL (packages/db/test/l0/l0-us115-host-listings.test.ts).
 */
import { randomUUID } from 'node:crypto';
import { HostListingStoreError } from '../internal/host-listings/store.js';
import type {
  HostListing,
  HostListingStore,
  HostLocation,
  HostMarket,
  HostVehicle,
  Outcome,
  PhotoRecord,
  PublicListing,
} from '../internal/host-listings/store.js';
import type {
  ListingInput,
  ListingStatus,
  LocationInput,
  PricingInput,
  VehicleInput,
} from '../internal/host-listings/model.js';

interface FakeHost {
  readonly orgId: string;
  readonly country: string;
  readonly currency: string;
  status: string;
}

interface FakeListing {
  readonly id: string;
  readonly orgId: string;
  readonly vehicleId: string;
  status: ListingStatus;
  pricing: PricingInput;
  readonly instantBook: boolean;
  photos: number;
}

export class FakeHostListingStore implements HostListingStore {
  readonly hosts = new Map<string, FakeHost[]>();
  readonly locationsById = new Map<string, { orgId: string; input: LocationInput }>();
  readonly vehiclesById = new Map<
    string,
    { orgId: string; country: string; input: VehicleInput }
  >();
  readonly listingsById = new Map<string, FakeListing>();
  readonly deposited: string[] = [];
  /** Pas du prix par pays (donnée de test, comme 17 §7.2). */
  readonly priceStep = new Map<string, bigint>();
  /** `p2p_private_hosts_enabled[pays]` : toujours false (interrupteur, US-125). */
  readonly minPhotos = 6;
  /** Exposant de la devise des comptes du FAKE. */
  exponent = 2;
  /** Panne simulée de la base. */
  failing = false;

  /** Inscrit un compte d'hôte titulaire de la session `proof`. */
  addHost(proof: Buffer, host: FakeHost): void {
    const k = proof.toString('hex');
    this.hosts.set(k, [...(this.hosts.get(k) ?? []), host]);
  }

  #host(proof: Buffer, orgId: string): FakeHost | 'FORBIDDEN' {
    return this.hosts.get(proof.toString('hex'))?.find((h) => h.orgId === orgId) ?? 'FORBIDDEN';
  }

  #write(proof: Buffer, orgId: string): FakeHost | Outcome {
    if (this.failing) throw new HostListingStoreError('panne', '08006');
    const h = this.#host(proof, orgId);
    if (h === 'FORBIDDEN') return { outcome: 'FORBIDDEN', id: null };
    if (!['ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE'].includes(h.status)) {
      return { outcome: 'HOST_ACCOUNT_SUSPENDED', id: null };
    }
    return h;
  }

  hostMarket(proof: Buffer, orgId: string): Promise<HostMarket | null> {
    if (this.failing) return Promise.reject(new HostListingStoreError('panne', '08006'));
    const h = this.#host(proof, orgId);
    return Promise.resolve(
      h === 'FORBIDDEN'
        ? null
        : { country: h.country, currency: h.currency, currencyExponent: this.exponent },
    );
  }

  createLocation(proof: Buffer, orgId: string, input: LocationInput): Promise<Outcome> {
    const h = this.#write(proof, orgId);
    if ('outcome' in h) return Promise.resolve(h);
    const id = randomUUID();
    this.locationsById.set(id, { orgId, input });
    return Promise.resolve({ outcome: 'DONE', id });
  }

  createVehicle(proof: Buffer, orgId: string, input: VehicleInput): Promise<Outcome> {
    const h = this.#write(proof, orgId);
    if ('outcome' in h) return Promise.resolve(h);
    if (this.locationsById.get(input.locationId)?.orgId !== orgId) {
      return Promise.resolve({ outcome: 'LOCATION_NOT_FOUND', id: null });
    }
    const duplicate = [...this.vehiclesById.values()].some(
      (v) =>
        (v.country === h.country && v.input.plate === input.plate) ||
        (input.vin !== null && v.input.vin === input.vin),
    );
    if (duplicate) return Promise.resolve({ outcome: 'VEHICLE_PLATE_DUPLICATE', id: null });
    const id = randomUUID();
    this.vehiclesById.set(id, { orgId, country: h.country, input });
    return Promise.resolve({ outcome: 'DONE', id });
  }

  #pricing(country: string, p: PricingInput): string {
    const step = this.priceStep.get(country) ?? 1n;
    if (p.dailyPriceMinor <= 0n || p.dailyPriceMinor % step !== 0n) return 'PRICE_INVALID';
    return 'OK';
  }

  createListing(proof: Buffer, orgId: string, input: ListingInput): Promise<Outcome> {
    const h = this.#write(proof, orgId);
    if ('outcome' in h) return Promise.resolve(h);
    if (this.vehiclesById.get(input.vehicleId)?.orgId !== orgId) {
      return Promise.resolve({ outcome: 'VEHICLE_NOT_FOUND', id: null });
    }
    const check = this.#pricing(h.country, input);
    if (check !== 'OK') return Promise.resolve({ outcome: check, id: null });
    if ([...this.listingsById.values()].some((l) => l.vehicleId === input.vehicleId)) {
      return Promise.resolve({ outcome: 'LISTING_EXISTS', id: null });
    }
    const id = randomUUID();
    this.listingsById.set(id, {
      id,
      orgId,
      vehicleId: input.vehicleId,
      status: 'DRAFT',
      pricing: input,
      instantBook: input.instantBook,
      photos: 0,
    });
    return Promise.resolve({ outcome: 'DONE', id });
  }

  #listing(orgId: string, listingId: string): FakeListing | undefined {
    const l = this.listingsById.get(listingId);
    return l?.orgId === orgId ? l : undefined;
  }

  updatePricing(
    proof: Buffer,
    orgId: string,
    listingId: string,
    input: PricingInput,
  ): Promise<Outcome> {
    const h = this.#write(proof, orgId);
    if ('outcome' in h) return Promise.resolve(h);
    const l = this.#listing(orgId, listingId);
    if (l === undefined) return Promise.resolve({ outcome: 'LISTING_NOT_FOUND', id: null });
    if (l.status === 'DELETED' || l.status === 'REMOVED_BY_PLATFORM') {
      return Promise.resolve({ outcome: 'LISTING_TRANSITION_FORBIDDEN', id: null });
    }
    const check = this.#pricing(h.country, input);
    if (check !== 'OK') return Promise.resolve({ outcome: check, id: null });
    l.pricing = input;
    return Promise.resolve({ outcome: 'DONE', id: listingId });
  }

  submitListing(proof: Buffer, orgId: string, listingId: string): Promise<Outcome> {
    const h = this.#host(proof, orgId);
    if (h === 'FORBIDDEN') return Promise.resolve({ outcome: 'FORBIDDEN', id: null });
    const l = this.#listing(orgId, listingId);
    if (l === undefined) return Promise.resolve({ outcome: 'LISTING_NOT_FOUND', id: null });
    if (l.status !== 'DRAFT')
      return Promise.resolve({ outcome: 'LISTING_TRANSITION_FORBIDDEN', id: null });
    if (l.photos < this.minPhotos) return Promise.resolve({ outcome: 'PHOTO_MIN_COUNT', id: null });
    // compte ACTIVE ET pays ouvert : l'interrupteur vaut false, comme en base (US-125)
    return Promise.resolve({ outcome: 'HOST_NOT_ACTIVATED', id: null });
  }

  deleteListing(proof: Buffer, orgId: string, listingId: string): Promise<Outcome> {
    const h = this.#host(proof, orgId);
    if (h === 'FORBIDDEN') return Promise.resolve({ outcome: 'FORBIDDEN', id: null });
    const l = this.#listing(orgId, listingId);
    if (l === undefined) return Promise.resolve({ outcome: 'LISTING_NOT_FOUND', id: null });
    if (!['DRAFT', 'BLOCKED_ELIGIBILITY', 'REJECTED'].includes(l.status)) {
      return Promise.resolve({ outcome: 'LISTING_TRANSITION_FORBIDDEN', id: null });
    }
    l.status = 'DELETED';
    return Promise.resolve({ outcome: 'DONE', id: listingId });
  }

  async addPhoto(
    proof: Buffer,
    orgId: string,
    listingId: string,
    photo: PhotoRecord,
    deposit: (storageKey: string) => Promise<void>,
  ): Promise<Outcome> {
    const h = this.#write(proof, orgId);
    if ('outcome' in h) return h;
    const l = this.#listing(orgId, listingId);
    if (l === undefined) return { outcome: 'LISTING_NOT_FOUND', id: null };
    if (!['DRAFT', 'REJECTED', 'BLOCKED_ELIGIBILITY'].includes(l.status)) {
      return { outcome: 'LISTING_TRANSITION_FORBIDDEN', id: null };
    }
    const key = `listing/${listingId}/${photo.photoId}`;
    await deposit(key);
    this.deposited.push(key);
    l.photos += 1;
    return { outcome: 'DONE', id: photo.photoId };
  }

  locations(proof: Buffer, orgId: string): Promise<HostLocation[]> {
    return Promise.resolve(
      [...this.locationsById.entries()]
        .filter(([, l]) => l.orgId === orgId && this.#host(proof, orgId) !== 'FORBIDDEN')
        .map(([id, { input }]) => ({
          id,
          kind: input.kind,
          label: input.label,
          addressLine: input.addressLine,
          city: input.city,
          areaLabel: input.areaLabel,
          lat: input.lat,
          lng: input.lng,
          timezone: 'UTC',
        })),
    );
  }

  vehicles(proof: Buffer, orgId: string): Promise<HostVehicle[]> {
    return Promise.resolve(
      [...this.vehiclesById.entries()]
        .filter(([, v]) => v.orgId === orgId && this.#host(proof, orgId) !== 'FORBIDDEN')
        .map(([id, { input }]) => {
          const l = [...this.listingsById.values()].find((x) => x.vehicleId === id);
          return {
            id,
            locationId: input.locationId,
            plate: input.plate,
            vin: input.vin,
            variantId: input.variantId,
            makeText: input.makeText,
            modelText: input.modelText,
            year: input.year,
            trim: input.trim,
            valueClass: null,
            transmission: input.transmission,
            seats: input.seats,
            fuelType: input.fuelType,
            odometerKm: input.odometerKm,
            gpsInstalled: input.gpsInstalled,
            lienDeclared: input.lienDeclared,
            eligibilityStatus: 'PENDING',
            listingId: l?.id ?? null,
            listingStatus: l?.status ?? null,
          };
        }),
    );
  }

  listings(proof: Buffer, orgId: string): Promise<HostListing[]> {
    const h = this.#host(proof, orgId);
    if (h === 'FORBIDDEN') return Promise.resolve([]);
    return Promise.resolve(
      [...this.listingsById.values()]
        .filter((l) => l.orgId === orgId && l.status !== 'DELETED')
        .map((l) => ({
          id: l.id,
          vehicleId: l.vehicleId,
          status: l.status,
          dailyPriceMinor: l.pricing.dailyPriceMinor.toString(),
          currency: h.currency,
          mileageMode: l.pricing.mileageMode,
          includedKmPerDay: l.pricing.includedKmPerDay,
          extraKmPriceMinor: l.pricing.extraKmPriceMinor?.toString() ?? null,
          instantBook: l.instantBook,
          photos: l.photos,
          submittedAt: null,
        })),
    );
  }

  publicListing(listingId: string): Promise<PublicListing | null> {
    if (this.failing) return Promise.reject(new HostListingStoreError('panne', '08006'));
    const l = this.listingsById.get(listingId);
    if (l === undefined || l.status !== 'LISTED') return Promise.resolve(null);
    const v = this.vehiclesById.get(l.vehicleId);
    const loc = v === undefined ? undefined : this.locationsById.get(v.input.locationId);
    if (v === undefined || loc === undefined) return Promise.resolve(null);
    const round = (x: number) => Math.round(x * 100) / 100;
    return Promise.resolve({
      id: l.id,
      country: v.country,
      dailyPriceMinor: l.pricing.dailyPriceMinor.toString(),
      currency: [...this.hosts.values()].flat().find((h) => h.orgId === l.orgId)?.currency ?? '',
      currencyExponent: this.exponent,
      mileageMode: l.pricing.mileageMode,
      includedKmPerDay: l.pricing.includedKmPerDay,
      extraKmPriceMinor: l.pricing.extraKmPriceMinor?.toString() ?? null,
      instantBook: l.instantBook,
      variantId: v.input.variantId,
      makeName: v.input.makeText ?? '',
      modelName: v.input.modelText ?? '',
      year: v.input.year,
      transmission: v.input.transmission,
      seats: v.input.seats,
      fuelType: v.input.fuelType,
      locationKind: loc.input.kind,
      city: loc.input.city,
      areaLabel: loc.input.areaLabel,
      approximatePoint:
        loc.input.lat === null || loc.input.lng === null
          ? null
          : { lat: round(loc.input.lat), lng: round(loc.input.lng) },
      timezone: 'UTC',
    });
  }
}
