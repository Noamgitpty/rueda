/**
 * Port et adaptateur PostgreSQL des lieux, véhicules et annonces de l'hôte (US-115, migration
 * 0066). L'adaptateur n'appelle QUE les fonctions `core.catalog_*` (SECURITY DEFINER,
 * propriétaire catalog_cmd_owner, EXECUTE au seul app_api) : app_api n'a aucun droit sur les
 * tables. L'hôte est désigné par l'empreinte de son jeton de session (`proof`), jamais par un
 * identifiant reçu du client ; le compte d'hôte demandé (`orgId`) est revérifié en base.
 * Requêtes paramétrées uniquement ; une erreur de la base devient `HostListingStoreError`
 * (SQLSTATE seulement, jamais le message du serveur ni un paramètre).
 */
import type {
  FuelType,
  ListingInput,
  ListingStatus,
  LocationInput,
  LocationKind,
  MileageMode,
  PricingInput,
  Transmission,
  VehicleInput,
} from './model.js';

/** Exécuteur SQL minimal (pool `pg` ou client). */
export interface SqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

/** Client d'une transaction (pool `pg`) : `release` rend la connexion. */
export interface SqlClient extends SqlExecutor {
  release(): void;
}

/** Pool capable d'ouvrir une transaction (dépôt d'une photo : ligne puis objet, ADR-099). */
export interface SqlPool extends SqlExecutor {
  connect(): Promise<SqlClient>;
}

export interface Outcome {
  readonly outcome: string;
  readonly id: string | null;
}

export interface HostLocation {
  readonly id: string;
  readonly kind: LocationKind;
  readonly label: string;
  readonly addressLine: string;
  readonly city: string;
  readonly areaLabel: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly timezone: string;
}

export interface HostVehicle {
  readonly id: string;
  readonly locationId: string;
  readonly plate: string;
  readonly vin: string | null;
  readonly variantId: string | null;
  readonly makeText: string | null;
  readonly modelText: string | null;
  readonly year: number;
  readonly trim: string | null;
  readonly valueClass: string | null;
  readonly transmission: Transmission;
  readonly seats: number;
  readonly fuelType: FuelType;
  readonly odometerKm: number | null;
  readonly gpsInstalled: boolean;
  readonly lienDeclared: boolean;
  readonly eligibilityStatus: string;
  readonly listingId: string | null;
  readonly listingStatus: ListingStatus | null;
}

export interface HostListing {
  readonly id: string;
  readonly vehicleId: string;
  readonly status: ListingStatus;
  readonly dailyPriceMinor: string;
  readonly currency: string;
  readonly mileageMode: MileageMode;
  readonly includedKmPerDay: number | null;
  readonly extraKmPriceMinor: string | null;
  readonly instantBook: boolean;
  readonly photos: number;
  readonly submittedAt: string | null;
}

/** Fiche publique d'une annonce LISTED (colonnes C0 seulement, zone approximative). */
export interface PublicListing {
  readonly id: string;
  readonly country: string;
  readonly dailyPriceMinor: string;
  readonly currency: string;
  readonly mileageMode: MileageMode;
  readonly includedKmPerDay: number | null;
  readonly extraKmPriceMinor: string | null;
  readonly instantBook: boolean;
  readonly variantId: string | null;
  readonly makeName: string;
  readonly modelName: string;
  readonly year: number;
  readonly transmission: Transmission;
  readonly seats: number;
  readonly fuelType: FuelType;
  readonly locationKind: LocationKind;
  readonly city: string;
  readonly areaLabel: string | null;
  /** Point arrondi au centième de degré (≈ 1,1 km), ou `null` sans épingle (ADR-099). */
  readonly approximatePoint: { readonly lat: number; readonly lng: number } | null;
  readonly timezone: string;
}

export interface PhotoRecord {
  readonly photoId: string;
  readonly fileId: string;
  readonly mime: string;
  readonly bytes: number;
  readonly sha256: Buffer;
}

export interface HostListingStore {
  /** Pays du compte d'hôte titulaire `orgId` de la session, sinon `null` (inconnu ou d'un autre). */
  hostCountry(proof: Buffer, orgId: string): Promise<string | null>;
  createLocation(proof: Buffer, orgId: string, input: LocationInput): Promise<Outcome>;
  createVehicle(proof: Buffer, orgId: string, input: VehicleInput): Promise<Outcome>;
  createListing(proof: Buffer, orgId: string, input: ListingInput): Promise<Outcome>;
  updatePricing(
    proof: Buffer,
    orgId: string,
    listingId: string,
    input: PricingInput,
  ): Promise<Outcome>;
  submitListing(proof: Buffer, orgId: string, listingId: string): Promise<Outcome>;
  deleteListing(proof: Buffer, orgId: string, listingId: string): Promise<Outcome>;
  /**
   * Ligne `file_asset` et photo PENDING dans une transaction ; `deposit(storageKey)` dépose
   * l'objet AVANT la validation : un dépôt en échec annule la ligne (création seule, rien
   * d'écrasé). Issue de la base (`DONE` ou refus) ; `id` = identifiant de la photo.
   */
  addPhoto(
    proof: Buffer,
    orgId: string,
    listingId: string,
    photo: PhotoRecord,
    deposit: (storageKey: string) => Promise<void>,
  ): Promise<Outcome>;
  locations(proof: Buffer, orgId: string): Promise<HostLocation[]>;
  vehicles(proof: Buffer, orgId: string): Promise<HostVehicle[]>;
  listings(proof: Buffer, orgId: string): Promise<HostListing[]>;
  publicListing(listingId: string): Promise<PublicListing | null>;
}

export class HostListingStoreError extends Error {
  override readonly name = 'HostListingStoreError';
  readonly sqlstate: string | undefined;
  constructor(operation: string, sqlstate: string | undefined) {
    super(`CAT : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableHostListingStore implements HostListingStore {
  #fail(): Promise<never> {
    return Promise.reject(new HostListingStoreError('magasin indisponible', undefined));
  }
  hostCountry = (): Promise<string | null> => this.#fail();
  createLocation = (): Promise<Outcome> => this.#fail();
  createVehicle = (): Promise<Outcome> => this.#fail();
  createListing = (): Promise<Outcome> => this.#fail();
  updatePricing = (): Promise<Outcome> => this.#fail();
  submitListing = (): Promise<Outcome> => this.#fail();
  deleteListing = (): Promise<Outcome> => this.#fail();
  addPhoto = (): Promise<Outcome> => this.#fail();
  locations = (): Promise<HostLocation[]> => this.#fail();
  vehicles = (): Promise<HostVehicle[]> => this.#fail();
  listings = (): Promise<HostListing[]> => this.#fail();
  publicListing = (): Promise<PublicListing | null> => this.#fail();
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? ((error as { code: string }).code as string)
    : undefined;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

interface OutcomeRow extends Record<string, unknown> {
  outcome: string;
  id: string | null;
}

export class PgHostListingStore implements HostListingStore {
  /**
   * `db` : exécuteur des commandes et lectures ; `pool` : pool qui ouvre une transaction (dépôt
   * d'une photo). Sans pool, le dépôt d'une photo est refusé (indisponible).
   */
  constructor(
    private readonly db: SqlExecutor,
    private readonly pool: SqlPool | null = null,
  ) {}

  async #outcome(operation: string, sql: string, values: readonly unknown[]): Promise<Outcome> {
    try {
      const { rows } = await this.db.query<OutcomeRow>(sql, values);
      return { outcome: rows[0]?.outcome ?? 'LISTING_UNAVAILABLE', id: rows[0]?.id ?? null };
    } catch (error) {
      throw new HostListingStoreError(operation, sqlstateOf(error));
    }
  }

  async #rows<R extends Record<string, unknown>>(
    operation: string,
    sql: string,
    values: readonly unknown[],
  ): Promise<R[]> {
    try {
      return (await this.db.query<R>(sql, values)).rows;
    } catch (error) {
      throw new HostListingStoreError(operation, sqlstateOf(error));
    }
  }

  async hostCountry(proof: Buffer, orgId: string): Promise<string | null> {
    const rows = await this.#rows<{ country_code: string }>(
      'comptes d’hôte',
      'SELECT a.country_code FROM core.iam_host_accounts($1) AS a WHERE a.org_id = $2::uuid',
      [proof, orgId],
    );
    return rows[0]?.country_code ?? null;
  }

  createLocation(proof: Buffer, orgId: string, i: LocationInput): Promise<Outcome> {
    return this.#outcome(
      'lieu',
      `SELECT r.outcome, r.location_id::text AS id
         FROM core.catalog_cmd_create_location($1, $2::uuid, $3, $4, $5, $6, $7, $8::numeric,
                                               $9::numeric) AS r`,
      [proof, orgId, i.kind, i.label, i.addressLine, i.city, i.areaLabel, i.lat, i.lng],
    );
  }

  createVehicle(proof: Buffer, orgId: string, i: VehicleInput): Promise<Outcome> {
    return this.#outcome(
      'véhicule',
      `SELECT r.outcome, r.vehicle_id::text AS id
         FROM core.catalog_cmd_create_vehicle($1, $2::uuid, $3::uuid, $4, $5, $6::uuid, $7, $8,
                                              $9::integer, $10, $11, $12::smallint, $13,
                                              $14::integer, $15::boolean, $16::boolean) AS r`,
      [
        proof,
        orgId,
        i.locationId,
        i.plate,
        i.vin,
        i.variantId,
        i.makeText,
        i.modelText,
        i.year,
        i.trim,
        i.transmission,
        i.seats,
        i.fuelType,
        i.odometerKm,
        i.gpsInstalled,
        i.lienDeclared,
      ],
    );
  }

  createListing(proof: Buffer, orgId: string, i: ListingInput): Promise<Outcome> {
    return this.#outcome(
      'annonce',
      `SELECT r.outcome, r.listing_id::text AS id
         FROM core.catalog_cmd_create_listing($1, $2::uuid, $3::uuid, $4::bigint, $5, $6::integer,
                                              $7::bigint, $8::boolean) AS r`,
      [
        proof,
        orgId,
        i.vehicleId,
        i.dailyPriceMinor.toString(),
        i.mileageMode,
        i.includedKmPerDay,
        i.extraKmPriceMinor?.toString() ?? null,
        i.instantBook,
      ],
    );
  }

  updatePricing(
    proof: Buffer,
    orgId: string,
    listingId: string,
    i: PricingInput,
  ): Promise<Outcome> {
    return this.#outcome(
      'tarif',
      `SELECT r.outcome, r.listing_id::text AS id
         FROM core.catalog_cmd_update_listing_pricing($1, $2::uuid, $3::uuid, $4::bigint, $5,
                                                      $6::integer, $7::bigint) AS r`,
      [
        proof,
        orgId,
        listingId,
        i.dailyPriceMinor.toString(),
        i.mileageMode,
        i.includedKmPerDay,
        i.extraKmPriceMinor?.toString() ?? null,
      ],
    );
  }

  submitListing(proof: Buffer, orgId: string, listingId: string): Promise<Outcome> {
    return this.#outcome(
      'soumission',
      `SELECT r.outcome, r.listing_id::text AS id
         FROM core.catalog_cmd_submit_listing($1, $2::uuid, $3::uuid) AS r`,
      [proof, orgId, listingId],
    );
  }

  deleteListing(proof: Buffer, orgId: string, listingId: string): Promise<Outcome> {
    return this.#outcome(
      'suppression',
      `SELECT r.outcome, r.listing_id::text AS id
         FROM core.catalog_cmd_delete_listing($1, $2::uuid, $3::uuid) AS r`,
      [proof, orgId, listingId],
    );
  }

  async addPhoto(
    proof: Buffer,
    orgId: string,
    listingId: string,
    photo: PhotoRecord,
    deposit: (storageKey: string) => Promise<void>,
  ): Promise<Outcome> {
    if (this.pool === null) throw new HostListingStoreError('photo : pool requis', undefined);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        outcome: string;
        photo_id: string | null;
        storage_key: string | null;
      }>(
        `SELECT r.outcome, r.photo_id::text AS photo_id, r.storage_key
           FROM core.catalog_cmd_add_listing_photo($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6,
                                                   $7::bigint, $8) AS r`,
        [
          proof,
          orgId,
          listingId,
          photo.photoId,
          photo.fileId,
          photo.mime,
          photo.bytes,
          photo.sha256,
        ],
      );
      const r = rows[0];
      if (r?.outcome !== 'DONE' || r.storage_key === null) {
        await client.query('ROLLBACK');
        return { outcome: r?.outcome ?? 'LISTING_UNAVAILABLE', id: null };
      }
      // ligne d'abord (collision de clé refusée par la base), objet ensuite, validation enfin
      await deposit(r.storage_key);
      await client.query('COMMIT');
      return { outcome: 'DONE', id: r.photo_id };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof HostListingStoreError) throw error;
      if (sqlstateOf(error) !== undefined)
        throw new HostListingStoreError('photo', sqlstateOf(error));
      throw error;
    } finally {
      client.release();
    }
  }

  async locations(proof: Buffer, orgId: string): Promise<HostLocation[]> {
    const rows = await this.#rows<Record<string, unknown>>(
      'lieux',
      'SELECT * FROM core.catalog_host_locations($1, $2::uuid)',
      [proof, orgId],
    );
    return rows.map((r) => ({
      id: String(r['location_id']),
      kind: r['kind'] as LocationKind,
      label: String(r['place_label']),
      addressLine: String(r['address_line']),
      city: String(r['city']),
      areaLabel: str(r['area_label']),
      lat: num(r['geo_lat']),
      lng: num(r['geo_lng']),
      timezone: String(r['timezone']),
    }));
  }

  async vehicles(proof: Buffer, orgId: string): Promise<HostVehicle[]> {
    const rows = await this.#rows<Record<string, unknown>>(
      'véhicules',
      'SELECT * FROM core.catalog_host_vehicles($1, $2::uuid)',
      [proof, orgId],
    );
    return rows.map((r) => ({
      id: String(r['vehicle_id']),
      locationId: String(r['location_id']),
      plate: String(r['plate']),
      vin: str(r['vin']),
      variantId: str(r['variant_id']),
      makeText: str(r['make_text']),
      modelText: str(r['model_text']),
      year: Number(r['year']),
      trim: str(r['trim_override']),
      valueClass: str(r['value_class']),
      transmission: r['transmission'] as Transmission,
      seats: Number(r['seats']),
      fuelType: r['fuel_type'] as FuelType,
      odometerKm: num(r['odometer_km']),
      gpsInstalled: r['gps_installed'] === true,
      lienDeclared: r['lien_declared'] === true,
      eligibilityStatus: String(r['eligibility_status']),
      listingId: str(r['listing_id']),
      listingStatus: str(r['listing_status']) as ListingStatus | null,
    }));
  }

  async listings(proof: Buffer, orgId: string): Promise<HostListing[]> {
    const rows = await this.#rows<Record<string, unknown>>(
      'annonces',
      'SELECT * FROM core.catalog_host_listings($1, $2::uuid)',
      [proof, orgId],
    );
    return rows.map((r) => ({
      id: String(r['listing_id']),
      vehicleId: String(r['vehicle_id']),
      status: r['status'] as ListingStatus,
      dailyPriceMinor: String(r['daily_price_minor']),
      currency: String(r['currency']),
      mileageMode: r['mileage_mode'] as MileageMode,
      includedKmPerDay: num(r['included_km_per_day']),
      extraKmPriceMinor: str(r['extra_km_price_minor']),
      instantBook: r['instant_book'] === true,
      photos: Number(r['photos']),
      submittedAt: r['submitted_at'] instanceof Date ? r['submitted_at'].toISOString() : null,
    }));
  }

  async publicListing(listingId: string): Promise<PublicListing | null> {
    const rows = await this.#rows<Record<string, unknown>>(
      'fiche publique',
      'SELECT * FROM core.catalog_public_listing($1::uuid)',
      [listingId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    const lat = num(r['geo_public_lat']);
    const lng = num(r['geo_public_lng']);
    return {
      id: String(r['listing_id']),
      country: String(r['country_code']),
      dailyPriceMinor: String(r['daily_price_minor']),
      currency: String(r['currency']),
      mileageMode: r['mileage_mode'] as MileageMode,
      includedKmPerDay: num(r['included_km_per_day']),
      extraKmPriceMinor: str(r['extra_km_price_minor']),
      instantBook: r['instant_book'] === true,
      variantId: str(r['variant_id']),
      makeName: String(r['make_name']),
      modelName: String(r['model_name']),
      year: Number(r['year']),
      transmission: r['transmission'] as Transmission,
      seats: Number(r['seats']),
      fuelType: r['fuel_type'] as FuelType,
      locationKind: r['location_kind'] as LocationKind,
      city: String(r['city']),
      areaLabel: str(r['area_label']),
      approximatePoint: lat === null || lng === null ? null : { lat, lng },
      timezone: String(r['timezone']),
    };
  }
}
