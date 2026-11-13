/**
 * Service des lieux de remise, véhicules et annonces de l'hôte (US-115 ; ADR-099). Valide la
 * saisie champ par champ (UX-50), appelle le magasin (la base juge la propriété, le pays, les
 * doublons, le pas de prix, SM-2) et traduit chaque issue en code stable (`errors.ts`).
 *
 * Catalogue de référence (US-113, ADR-094) : les listes de choix et le préremplissage sont
 * filtrés par le pays du compte d'hôte (réserve de la revue d'US-113 : `market` nul ou égal au
 * pays ; une variante d'un autre marché est inconnue).
 */
import { createHash, randomUUID } from 'node:crypto';
import { CatalogError } from '../vehicle-catalog/errors.js';
import type { VehiclePrefill } from '../vehicle-catalog/prefill.js';
import type { VehicleCatalogService } from '../vehicle-catalog/vehicle-catalog.service.js';
import type { MakeOption, ModelOption, VariantOption } from '../vehicle-catalog/store.js';
import { HostListingHttpError, outcomeCode } from './errors.js';
import type { HostListingCode } from './errors.js';
import {
  FieldValidationError,
  isUuid,
  parseCatalogRequest,
  parseListing,
  parseLocation,
  parsePricing,
  parseVehicle,
} from './model.js';
import { API_BODY_LIMIT_BYTES } from '../../../../http-hardening.js';
import {
  isCleanScan,
  PhotoRejectedError,
  preparePhoto,
  DEFAULT_PHOTO_LIMITS,
  UnavailablePhotoScanner,
  UnavailablePhotoStorage,
} from './photo-ingest.js';
import type { PhotoLimits, PhotoScanner, PhotoStorage } from './photo-ingest.js';
import { HostListingStoreError } from './store.js';
import type {
  HostListing,
  HostListingStore,
  HostLocation,
  HostMarket,
  HostVehicle,
  PublicListing,
} from './store.js';

export interface PhotoPipeline {
  readonly scanner: PhotoScanner;
  readonly storage: PhotoStorage;
  readonly limits?: PhotoLimits;
}

export class HostListingsService {
  readonly #photos: PhotoPipeline;
  readonly #newId: () => string;

  constructor(
    private readonly store: HostListingStore,
    private readonly catalog: VehicleCatalogService | null,
    photos: PhotoPipeline,
    newId: () => string = randomUUID,
  ) {
    this.#photos = photos;
    this.#newId = newId;
  }

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HostListingStoreError)
        throw new HostListingHttpError('LISTING_UNAVAILABLE');
      throw error;
    }
  }

  #fields(fn: () => void): void {
    try {
      fn();
    } catch (error) {
      if (error instanceof FieldValidationError) {
        throw new HostListingHttpError('REQUEST_INVALID', error.problems);
      }
      throw error;
    }
  }

  #done(outcome: string, success: HostListingCode): { code: HostListingCode } {
    if (outcome === 'DONE') return { code: success };
    throw new HostListingHttpError(outcomeCode(outcome));
  }

  async createLocation(proof: Buffer, orgId: string, body: Record<string, unknown>) {
    let input!: ReturnType<typeof parseLocation>;
    this.#fields(() => {
      input = parseLocation(body);
    });
    const r = await this.#call(() => this.store.createLocation(proof, orgId, input));
    // zone affichée qui ressemble à une adresse exacte (BOARD N-62, filtre de la base) : refus
    // rattaché au champ, avec son propre message
    if (r.outcome === 'LOCATION_AREA_ADDRESS') {
      throw new HostListingHttpError('LOCATION_AREA_ADDRESS', [
        { field: 'areaLabel', reason: 'INVALID' },
      ]);
    }
    return { ...this.#done(r.outcome, 'LOCATION_CREATED'), locationId: r.id as string };
  }

  async createVehicle(proof: Buffer, orgId: string, body: Record<string, unknown>) {
    let input!: ReturnType<typeof parseVehicle>;
    this.#fields(() => {
      input = parseVehicle(body);
    });
    const r = await this.#call(() => this.store.createVehicle(proof, orgId, input));
    return { ...this.#done(r.outcome, 'VEHICLE_CREATED'), vehicleId: r.id as string };
  }

  async createListing(proof: Buffer, orgId: string, body: Record<string, unknown>) {
    let input!: ReturnType<typeof parseListing>;
    this.#fields(() => {
      input = parseListing(body);
    });
    const r = await this.#call(() => this.store.createListing(proof, orgId, input));
    return { ...this.#done(r.outcome, 'LISTING_CREATED'), listingId: r.id as string };
  }

  async updatePricing(
    proof: Buffer,
    orgId: string,
    listingId: string,
    body: Record<string, unknown>,
  ) {
    let input!: ReturnType<typeof parsePricing>;
    this.#fields(() => {
      input = parsePricing(body);
    });
    const r = await this.#call(() => this.store.updatePricing(proof, orgId, listingId, input));
    return this.#done(r.outcome, 'LISTING_SAVED');
  }

  /**
   * Publication (US-118, ADR-114) : publiée dès que les contrôles automatiques passent
   * (DEC-FONDATEUR-22) ; en revue seulement si le pays l'exige (`listing_manual_review_required`).
   */
  async submit(proof: Buffer, orgId: string, listingId: string) {
    const r = await this.#call(() => this.store.submitListing(proof, orgId, listingId));
    if (r.outcome === 'LISTED') {
      return { code: 'LISTING_PUBLISHED' as const, status: 'LISTED' as const };
    }
    if (r.outcome === 'PENDING_REVIEW') {
      return { code: 'LISTING_SUBMITTED' as const, status: 'PENDING_REVIEW' as const };
    }
    throw new HostListingHttpError(outcomeCode(r.outcome));
  }

  /** Retrait par l'hôte (US-118) : refusé tant qu'un trip est à venir (OQ-BR-29). */
  async unlist(proof: Buffer, orgId: string, listingId: string) {
    const r = await this.#call(() => this.store.unlistListing(proof, orgId, listingId));
    return { ...this.#done(r.outcome, 'LISTING_UNLISTED'), status: 'UNLISTED' as const };
  }

  /** Nouvelle demande d'ajout au catalogue (US-114) : après un refus, marque et modèle corrigés. */
  async requestCatalogAddition(
    proof: Buffer,
    orgId: string,
    vehicleId: string,
    body: Record<string, unknown>,
  ) {
    let input!: ReturnType<typeof parseCatalogRequest>;
    this.#fields(() => {
      input = parseCatalogRequest(body);
    });
    const r = await this.#call(() =>
      this.store.requestCatalogAddition(proof, orgId, vehicleId, input),
    );
    return { ...this.#done(r.outcome, 'CATALOG_REQUEST_CREATED'), requestId: r.id as string };
  }

  async remove(proof: Buffer, orgId: string, listingId: string) {
    const r = await this.#call(() => this.store.deleteListing(proof, orgId, listingId));
    return { ...this.#done(r.outcome, 'LISTING_DELETED'), status: 'DELETED' as const };
  }

  /**
   * Photo d'annonce : contrôles et nettoyage (photo-ingest.ts), antivirus, ligne en base puis
   * dépôt. Production : antivirus et stockage indisponibles (Q-019, US-003) ⇒ 503.
   */
  async addPhoto(proof: Buffer, orgId: string, listingId: string, upload: Buffer) {
    let clean!: ReturnType<typeof preparePhoto>;
    try {
      clean = preparePhoto(upload, this.#photos.limits ?? DEFAULT_PHOTO_LIMITS);
    } catch (error) {
      if (error instanceof PhotoRejectedError) throw new HostListingHttpError('PHOTO_FORMAT');
      throw error;
    }
    const scan = await this.#photos.scanner.scan({ declaredMime: clean.mime, body: clean.body });
    if (scan.status !== 'SCANNED') throw new HostListingHttpError('PHOTO_UPLOAD_UNAVAILABLE');
    if (!isCleanScan(scan, clean.mime)) throw new HostListingHttpError('PHOTO_FORMAT');
    const sha256 = createHash('sha256').update(clean.body).digest();
    let depositFailed = false;
    const r = await this.#call(() =>
      this.store.addPhoto(
        proof,
        orgId,
        listingId,
        {
          photoId: this.#newId(),
          fileId: this.#newId(),
          mime: clean.mime,
          bytes: clean.body.length,
          sha256,
        },
        async (key) => {
          const put = await this.#photos.storage.put('PUBLIC_LISTING', key, clean.body);
          if (put.status !== 'STORED') {
            depositFailed = true;
            throw new Error('dépôt refusé');
          }
        },
      ),
    ).catch((error: unknown) => {
      if (depositFailed) throw new HostListingHttpError('PHOTO_UPLOAD_UNAVAILABLE');
      throw error;
    });
    return { ...this.#done(r.outcome, 'PHOTO_ADDED'), photoId: r.id as string };
  }

  locations(proof: Buffer, orgId: string): Promise<HostLocation[]> {
    return this.#owned(proof, orgId, () => this.store.locations(proof, orgId));
  }

  vehicles(proof: Buffer, orgId: string): Promise<HostVehicle[]> {
    return this.#owned(proof, orgId, () => this.store.vehicles(proof, orgId));
  }

  /** Annonces du compte et marché du compte (devise et exposant pour la saisie du prix). */
  async listings(
    proof: Buffer,
    orgId: string,
  ): Promise<{
    listings: HostListing[];
    market: HostMarket;
    photoUploads: { open: boolean; maxBytes: number };
  }> {
    const market = await this.#market(proof, orgId);
    const listings = await this.#call(() => this.store.listings(proof, orgId));
    return { listings, market, photoUploads: this.photoUploads() };
  }

  /**
   * Dépôt des photos annoncé à l'écran AVANT l'envoi (revue ux d'US-115) : fermé tant que
   * l'antivirus (ClamAV, DEC-FONDATEUR-20) ou le stockage (US-003) ne sont pas branchés ; taille
   * maximale effective : la plus petite de la limite des photos et du corps JSON en base64.
   */
  photoUploads(): { open: boolean; maxBytes: number } {
    const open =
      !(this.#photos.scanner instanceof UnavailablePhotoScanner) &&
      !(this.#photos.storage instanceof UnavailablePhotoStorage);
    const limits = this.#photos.limits ?? DEFAULT_PHOTO_LIMITS;
    // base64 : 4 caractères pour 3 octets ; marge pour l'enveloppe JSON
    const viaJson = Math.floor(((API_BODY_LIMIT_BYTES - 1024) * 3) / 4);
    return { open, maxBytes: Math.min(limits.maxBytes, viaJson) };
  }

  /** Lecture : un compte d'un autre (ou inconnu) rend 404, jamais une liste vide trompeuse. */
  async #owned<T>(proof: Buffer, orgId: string, read: () => Promise<T>): Promise<T> {
    await this.#country(proof, orgId);
    return this.#call(read);
  }

  async #market(proof: Buffer, orgId: string): Promise<HostMarket> {
    const market = await this.#call(() => this.store.hostMarket(proof, orgId));
    if (market === null) throw new HostListingHttpError('HOST_ACCOUNT_NOT_FOUND');
    return market;
  }

  async #country(proof: Buffer, orgId: string): Promise<string> {
    return (await this.#market(proof, orgId)).country;
  }

  async publicListing(listingId: string): Promise<PublicListing> {
    if (!isUuid(listingId)) throw new HostListingHttpError('LISTING_NOT_FOUND');
    const r = await this.#call(() => this.store.publicListing(listingId));
    if (r === null) throw new HostListingHttpError('LISTING_NOT_FOUND');
    return r;
  }

  // ---- catalogue de référence, filtré par le marché du compte d'hôte (US-113) --------------
  #catalog(): VehicleCatalogService {
    if (this.catalog === null) throw new HostListingHttpError('LISTING_UNAVAILABLE');
    return this.catalog;
  }

  async makes(proof: Buffer, orgId: string): Promise<MakeOption[]> {
    const country = await this.#country(proof, orgId);
    return this.#call(() => this.#catalog().listMakes(country));
  }

  async models(proof: Buffer, orgId: string, makeId: string): Promise<ModelOption[]> {
    const country = await this.#country(proof, orgId);
    return this.#call(() => this.#catalog().listModels(makeId, country));
  }

  async variants(
    proof: Buffer,
    orgId: string,
    modelId: string,
    year: number | null,
  ): Promise<VariantOption[]> {
    const country = await this.#country(proof, orgId);
    return this.#call(() => this.#catalog().listVariants(modelId, year, country));
  }

  async prefill(proof: Buffer, orgId: string, variantId: string): Promise<VehiclePrefill> {
    const country = await this.#country(proof, orgId);
    try {
      return await this.#catalog().prefill(variantId, country);
    } catch (error) {
      if (error instanceof CatalogError) {
        throw new HostListingHttpError(
          error.code === 'CATALOG_VARIANT_RETIRED'
            ? 'CATALOG_VARIANT_RETIRED'
            : 'CATALOG_VARIANT_NOT_FOUND',
        );
      }
      throw new HostListingHttpError('LISTING_UNAVAILABLE');
    }
  }
}
