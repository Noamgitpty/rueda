/**
 * Rendu SQL de la graine du catalogue des véhicules (US-113 ; ADR-094) depuis
 * `../../data/vehicle-catalog.json`, validée par `parseVehicleCatalog` (aucune ligne sans source
 * ni licence, aucune source à la licence non validée). La migration
 * `packages/db/migrations/0061_catalog_vehicle_reference.sql` contient ce rendu entre deux
 * marqueurs ; `seed-sql.test.ts` échoue s'il en diffère. Une instruction `INSERT` par table : la
 * migration est une transaction, une ligne refusée par la base (NOT NULL, CHECK) annule tout.
 */
import type { CatalogMake, CatalogModel, CatalogVariant, VehicleCatalogSeed } from './model.js';

export const CATALOG_MIGRATION_FILE = '0061_catalog_vehicle_reference.sql';
export const SEED_BEGIN = '-- >>> graine générée (US-113) : ne pas éditer à la main';
export const SEED_END = '-- <<< fin de la graine générée';

const lit = (v: string | number | null): string => {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replaceAll("'", "''")}'`;
};

const textArray = (values: readonly string[]): string =>
  values.length === 0 ? 'ARRAY[]::text[]' : `ARRAY[${values.map(lit).join(', ')}]::text[]`;

function insert(table: string, columns: readonly string[], rows: readonly string[][]): string {
  return [
    `INSERT INTO core.${table}`,
    `  (${columns.join(', ')})`,
    'VALUES',
    rows.map((r) => `  (${r.join(', ')})`).join(',\n') + ';',
  ].join('\n');
}

const makeRow = (m: CatalogMake): string[] => [
  lit(m.id),
  lit(m.slug),
  lit(m.name),
  lit(m.countryOrigin),
  textArray(m.aliases),
  lit(m.status),
  lit(m.provenance.source),
  lit(m.provenance.sourceRef),
  lit(m.provenance.licenseNote),
];

const modelRow = (m: CatalogMake, o: CatalogModel): string[] => [
  lit(o.id),
  lit(m.id),
  lit(o.slug),
  lit(o.name),
  textArray(o.aliases),
  lit(o.bodyType),
  lit(o.seatsDefault),
  lit(o.doorsDefault),
  lit(o.status),
  lit(o.provenance.source),
  lit(o.provenance.sourceRef),
  lit(o.provenance.licenseNote),
];

const variantRow = (o: CatalogModel, v: CatalogVariant): string[] => [
  lit(v.id),
  lit(o.id),
  lit(v.yearFrom),
  lit(v.yearTo),
  lit(v.trimName),
  lit(v.transmission),
  lit(v.fuelType),
  lit(v.drive),
  lit(v.engineCc),
  lit(v.engineCylinders),
  lit(v.powerHp),
  v.consumptionL100km === null ? 'NULL' : v.consumptionL100km,
  lit(v.consumptionSource),
  lit(v.seats),
  lit(v.doors),
  lit(v.cargoL),
  lit(v.valueClass),
  lit(v.status),
  lit(v.provenance.source),
  lit(v.provenance.sourceRef),
  lit(v.provenance.licenseNote),
];

/** Section générée de la migration, marqueurs compris, terminée par un saut de ligne. */
export function renderVehicleCatalogSeedSql(seed: VehicleCatalogSeed): string {
  const models = seed.makes.flatMap((m) => m.models.map((o) => [m, o] as const));
  const variants = models.flatMap(([, o]) => o.variants.map((v) => [o, v] as const));
  return [
    SEED_BEGIN,
    `-- Source : apps/api/src/modules/cat/data/vehicle-catalog.json (version ${seed.version}),`,
    '-- rendue par apps/api/src/modules/cat/internal/vehicle-catalog/seed-sql.ts.',
    `-- ${seed.makes.length} marques, ${models.length} modèles, ${variants.length} variantes.`,
    insert(
      'catalog_vehicle_make',
      [
        'id',
        'slug',
        'name',
        'country_origin',
        'aliases',
        'status',
        'source',
        'source_ref',
        'license_note',
      ],
      seed.makes.map(makeRow),
    ),
    insert(
      'catalog_vehicle_model',
      [
        'id',
        'make_id',
        'slug',
        'name',
        'aliases',
        'body_type',
        'seats_default',
        'doors_default',
        'status',
        'source',
        'source_ref',
        'license_note',
      ],
      models.map(([m, o]) => modelRow(m, o)),
    ),
    insert(
      'catalog_vehicle_variant',
      [
        'id',
        'model_id',
        'year_from',
        'year_to',
        'trim_name',
        'transmission',
        'fuel_type',
        'drive',
        'engine_cc',
        'engine_cylinders',
        'power_hp',
        'consumption_l_100km',
        'consumption_source',
        'seats',
        'doors',
        'cargo_l',
        'value_class',
        'status',
        'source',
        'source_ref',
        'license_note',
      ],
      variants.map(([o, v]) => variantRow(o, v)),
    ),
    SEED_END,
    '',
  ].join('\n');
}

/** Extrait la section générée d'une migration (marqueurs compris) ; `null` si absente. */
export function extractSeedSection(migration: string): string | null {
  const text = migration.replaceAll('\r\n', '\n');
  const begin = text.indexOf(SEED_BEGIN);
  const end = text.indexOf(SEED_END);
  if (begin < 0 || end < begin) return null;
  return `${text.slice(begin, end + SEED_END.length)}\n`;
}
