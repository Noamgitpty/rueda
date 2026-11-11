/**
 * Port et adaptateur PostgreSQL du catalogue de référence des véhicules (US-113, migration 0061).
 *
 * Lecture seule, sous la RLS d'`app_api` : la base ne montre que les lignes `ACTIVE` et `RETIRED`
 * (politique `api_read`), jamais la provenance (`source`, `license_note`) ni le vérificateur. Les
 * listes de choix de l'assistant de l'hôte ne rendent que les lignes `ACTIVE` dont le parent est
 * `ACTIVE`. Aucune écriture : la graine est chargée par migration, les ajouts passent par la file
 * d'US-114. Requêtes paramétrées, jamais de SQL concaténé.
 */
import type { BodyType, CatalogStatus, Drive, Gearbox, VariantFuel } from './model.js';
import type { VariantView } from './prefill.js';

/** Exécuteur SQL minimal (pool `pg` ou client). */
export interface SqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export interface MakeOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

export interface ModelOption {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly bodyType: BodyType;
}

export interface VariantOption {
  readonly id: string;
  readonly yearFrom: number;
  readonly yearTo: number | null;
  readonly trimName: string | null;
  readonly transmission: Gearbox;
  readonly fuelType: VariantFuel;
  readonly drive: Drive;
}

export interface VehicleCatalogStore {
  /** Marques `ACTIVE`, par nom. */
  listMakes(): Promise<MakeOption[]>;
  /** Modèles `ACTIVE` d'une marque `ACTIVE`, par nom. */
  listModels(makeId: string): Promise<ModelOption[]>;
  /** Variantes `ACTIVE` d'un modèle `ACTIVE` (d'une marque `ACTIVE`), produites l'année donnée. */
  listVariants(modelId: string, year: number | null): Promise<VariantOption[]>;
  /** Variante lisible (`ACTIVE` ou `RETIRED`) avec son modèle et sa marque, sinon `null`. */
  findVariant(variantId: string): Promise<VariantView | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID.test(v);

interface VariantRow extends Record<string, unknown> {
  id: string;
  status: CatalogStatus;
  make_id: string;
  make_name: string;
  make_status: CatalogStatus;
  model_id: string;
  model_name: string;
  model_status: CatalogStatus;
  body_type: BodyType;
  year_from: number;
  year_to: number | null;
  trim_name: string | null;
  transmission: Gearbox;
  fuel_type: VariantFuel;
  drive: Drive;
  engine_cc: number | null;
  seats: number;
  doors: number;
  value_class: VariantView['valueClass'];
  consumption: string | null;
  consumption_source: VariantView['consumptionSource'];
}

export class PgVehicleCatalogStore implements VehicleCatalogStore {
  constructor(private readonly db: SqlExecutor) {}

  async listMakes(): Promise<MakeOption[]> {
    const { rows } = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      aliases: string[];
    }>(
      `SELECT id::text AS id, slug, name, aliases
         FROM core.catalog_vehicle_make
        WHERE status = 'ACTIVE'
        ORDER BY name, slug`,
    );
    return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, aliases: r.aliases }));
  }

  async listModels(makeId: string): Promise<ModelOption[]> {
    if (!isUuid(makeId)) return [];
    const { rows } = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      aliases: string[];
      body_type: BodyType;
    }>(
      `SELECT o.id::text AS id, o.slug, o.name, o.aliases, o.body_type
         FROM core.catalog_vehicle_model AS o
         JOIN core.catalog_vehicle_make AS m ON m.id = o.make_id
        WHERE o.make_id = $1::uuid AND o.status = 'ACTIVE' AND m.status = 'ACTIVE'
        ORDER BY o.name, o.slug`,
      [makeId],
    );
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      aliases: r.aliases,
      bodyType: r.body_type,
    }));
  }

  async listVariants(modelId: string, year: number | null): Promise<VariantOption[]> {
    if (!isUuid(modelId)) return [];
    const { rows } = await this.db.query<{
      id: string;
      year_from: number;
      year_to: number | null;
      trim_name: string | null;
      transmission: Gearbox;
      fuel_type: VariantFuel;
      drive: Drive;
    }>(
      `SELECT v.id::text AS id, v.year_from, v.year_to, v.trim_name, v.transmission, v.fuel_type,
              v.drive
         FROM core.catalog_vehicle_variant AS v
         JOIN core.catalog_vehicle_model AS o ON o.id = v.model_id
         JOIN core.catalog_vehicle_make AS m ON m.id = o.make_id
        WHERE v.model_id = $1::uuid
          AND v.status = 'ACTIVE' AND o.status = 'ACTIVE' AND m.status = 'ACTIVE'
          AND ($2::int IS NULL OR (v.year_from <= $2::int
                                   AND (v.year_to IS NULL OR v.year_to >= $2::int)))
        ORDER BY v.year_from, v.trim_name NULLS FIRST, v.transmission, v.fuel_type, v.drive`,
      [modelId, year],
    );
    return rows.map((r) => ({
      id: r.id,
      yearFrom: r.year_from,
      yearTo: r.year_to,
      trimName: r.trim_name,
      transmission: r.transmission,
      fuelType: r.fuel_type,
      drive: r.drive,
    }));
  }

  async findVariant(variantId: string): Promise<VariantView | null> {
    if (!isUuid(variantId)) return null;
    const { rows } = await this.db.query<VariantRow>(
      `SELECT v.id::text AS id, v.status, m.id::text AS make_id, m.name AS make_name,
              m.status AS make_status, o.id::text AS model_id, o.name AS model_name,
              o.status AS model_status, o.body_type, v.year_from, v.year_to, v.trim_name,
              v.transmission, v.fuel_type, v.drive, v.engine_cc, v.seats, v.doors, v.value_class,
              v.consumption_l_100km::text AS consumption, v.consumption_source
         FROM core.catalog_vehicle_variant AS v
         JOIN core.catalog_vehicle_model AS o ON o.id = v.model_id
         JOIN core.catalog_vehicle_make AS m ON m.id = o.make_id
        WHERE v.id = $1::uuid`,
      [variantId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: r.id,
      status: r.status,
      makeId: r.make_id,
      makeName: r.make_name,
      makeStatus: r.make_status,
      modelId: r.model_id,
      modelName: r.model_name,
      modelStatus: r.model_status,
      bodyType: r.body_type,
      yearFrom: r.year_from,
      yearTo: r.year_to,
      trimName: r.trim_name,
      transmission: r.transmission,
      fuelType: r.fuel_type,
      drive: r.drive,
      engineCc: r.engine_cc,
      seats: r.seats,
      doors: r.doors,
      valueClass: r.value_class,
      consumptionL100km: r.consumption,
      consumptionSource: r.consumption_source,
    };
  }
}
