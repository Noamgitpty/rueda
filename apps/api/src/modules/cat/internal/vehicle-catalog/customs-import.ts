/**
 * Import des marques et modèles déclarés à la douane (suite d'US-113 ; ADR-109, ADR-094 ;
 * 17 §3.2.3, ADR-034). La donnée est `../../data/vehicle-catalog-dnit.json`, produite par
 * `scripts/catalog/dnit-import.mjs` ; elle est validée ici, fail-closed, puis rendue en SQL dans
 * la migration `0078_catalog_customs_import.sql` (le test `customs-import.test.ts` échoue si la
 * section générée en diffère).
 *
 * Règles (PROPOSÉES, ADR-109) :
 * - chaque ligne désigne une provenance qui porte `source` et `licenseNote` non vides, sinon
 *   `CATALOG_SOURCE_MISSING` ; la licence de la source doit être `VALIDATED`, sinon
 *   `CATALOG_SOURCE_UNLICENSED` (17 ADR-034, OQ-CAT-01) ; tout autre défaut : `CATALOG_DATA_INVALID` ;
 * - la graine v1 garde ses lignes : une marque ou un modèle `existing` doit y exister sous le même
 *   slug et le même nom, et n'est jamais recréé ; une ligne nouvelle dont le nom ou un alias
 *   normalisé (casse, accents, ponctuation) rejoint une ligne de la v1 ou de l'import est un
 *   doublon, refusé ;
 * - aucune caractéristique technique (la douane n'en donne pas) : chaque modèle nouveau reçoit une
 *   variante sans fiche (boîte, carburant, transmission, places, portes nulles), des années
 *   indicatives et le marché de la source ; un modèle de la v1 n'en reçoit une que pour des années
 *   antérieures à toutes ses variantes (jamais de chevauchement avec une fiche saisie à la main).
 * Le marché est une donnée du fichier, jamais une constante du code (CLAUDE.md contrainte 3).
 */
import { catalogId, CATALOG_SOURCES, LICENSE_STATUSES, SPECLESS_SOURCES } from './model.js';
import type { CatalogSource, LicenseStatus, Provenance, VehicleCatalogSeed } from './model.js';
import { CatalogError } from './errors.js';
import type { CatalogErrorCode } from './errors.js';

export const CUSTOMS_MIGRATION_FILE = '0078_catalog_customs_import.sql';
export const CUSTOMS_BEGIN =
  '-- >>> graine générée (US-113, import de la douane) : ne pas éditer à la main';
export const CUSTOMS_END = '-- <<< fin de la graine générée de la douane';
/** Code de variante de la ligne « sans fiche » d'un modèle importé. */
export const CUSTOMS_VARIANT_CODE = 'customs';

export interface CustomsMake {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly provenance: Provenance;
}

export interface CustomsModel {
  readonly id: string;
  readonly makeId: string;
  readonly makeSlug: string;
  readonly slug: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly provenance: Provenance;
}

/** Variante sans fiche : seules les années, le marché et la provenance sont connus. */
export interface CustomsVariant {
  readonly id: string;
  readonly modelId: string;
  readonly makeSlug: string;
  readonly modelSlug: string;
  readonly yearFrom: number;
  readonly yearTo: number | null;
  readonly market: string;
  readonly provenance: Provenance;
}

export interface CustomsImport {
  readonly version: number;
  readonly market: string;
  /** Marques nouvelles (les marques de la v1 ne sont pas recréées). */
  readonly makes: readonly CustomsMake[];
  /** Modèles nouveaux. */
  readonly models: readonly CustomsModel[];
  /** Variantes sans fiche (modèles nouveaux et années antérieures des modèles de la v1). */
  readonly variants: readonly CustomsVariant[];
  /** Lignes du fichier rattachées à la v1 (marques, modèles) : doublons évités. */
  readonly existing: { readonly makes: number; readonly models: number };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MARKET = /^[A-Z]{2}$/;
const NAME_MAX = 80;
const NOTE_MAX = 500;
const YEAR_MIN = 1950;
const YEAR_MAX = 2100;

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const intIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Clé de doublon : sans accents, sans casse, sans ponctuation ni espace (« D-MAX » = « D-Max »). */
export function duplicateKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

class Problems {
  readonly lines: Array<[CatalogErrorCode, string]> = [];
  add(code: CatalogErrorCode, line: string): void {
    this.lines.push([code, line]);
  }
  throwIfAny(): void {
    const order: CatalogErrorCode[] = [
      'CATALOG_SOURCE_MISSING',
      'CATALOG_SOURCE_UNLICENSED',
      'CATALOG_DATA_INVALID',
    ];
    const first = order.find((c) => this.lines.some(([k]) => k === c));
    if (first === undefined) return;
    const all = order.flatMap((c) =>
      this.lines.filter(([k]) => k === c).map(([k, l]) => `${k} ${l}`),
    );
    throw new CatalogError(first, 'import de la douane refusé', all);
  }
}

function aliasesOf(p: Problems, where: string, raw: Raw): string[] {
  const v = raw['aliases'];
  if (v === undefined) return [];
  if (!Array.isArray(v) || !v.every((a) => nonBlank(a) && a.length <= NAME_MAX)) {
    p.add('CATALOG_DATA_INVALID', `${where} : aliases doit être une liste de noms non vides`);
    return [];
  }
  return v as string[];
}

/**
 * Valide l'import de la douane contre la graine v1 (déjà validée) et rend les lignes à charger.
 * Lève `CatalogError` au moindre défaut ; aucune ligne n'est rendue tant qu'un défaut subsiste.
 */
export function parseCustomsCatalog(raw: unknown, v1: VehicleCatalogSeed): CustomsImport {
  const p = new Problems();
  if (!isObject(raw)) {
    p.add('CATALOG_DATA_INVALID', 'document : objet attendu');
    p.throwIfAny();
  }
  const doc = raw as Raw;
  const version = doc['version'];
  if (!intIn(version, 1, 1_000_000)) p.add('CATALOG_DATA_INVALID', 'version : entier attendu');
  const market = doc['market'];
  if (typeof market !== 'string' || !MARKET.test(market))
    p.add('CATALOG_DATA_INVALID', 'market : code pays ISO 3166-1 alpha-2 attendu');

  const licenses = new Map<string, LicenseStatus>();
  const rawLicenses = isObject(doc['sourceLicenses']) ? doc['sourceLicenses'] : {};
  for (const [source, entry] of Object.entries(rawLicenses)) {
    const status = isObject(entry) ? entry['status'] : undefined;
    if (typeof status === 'string' && (LICENSE_STATUSES as readonly string[]).includes(status)) {
      licenses.set(source, status as LicenseStatus);
    } else {
      p.add('CATALOG_DATA_INVALID', `sourceLicenses.${source} : status de licence inconnu`);
    }
  }

  const provenances = new Map<string, Provenance>();
  const rawProvenances = isObject(doc['provenances']) ? doc['provenances'] : {};
  for (const [name, entry] of Object.entries(rawProvenances)) {
    const e = isObject(entry) ? entry : {};
    const source = e['source'];
    const licenseNote = e['licenseNote'];
    if (!nonBlank(source) || !nonBlank(licenseNote)) {
      p.add('CATALOG_SOURCE_MISSING', `provenance ${name} : source et licenseNote obligatoires`);
      continue;
    }
    if (!(CATALOG_SOURCES as readonly string[]).includes(source)) {
      p.add('CATALOG_DATA_INVALID', `provenance ${name} : source inconnue`);
      continue;
    }
    if (!SPECLESS_SOURCES.includes(source as CatalogSource)) {
      p.add('CATALOG_DATA_INVALID', `provenance ${name} : ${source} exige une fiche technique`);
      continue;
    }
    if (licenses.get(source) !== 'VALIDATED') {
      p.add('CATALOG_SOURCE_UNLICENSED', `provenance ${name} : licence de ${source} non validée`);
      continue;
    }
    if (licenseNote.length > NOTE_MAX) {
      p.add('CATALOG_DATA_INVALID', `provenance ${name} : licenseNote trop longue`);
      continue;
    }
    const sourceRef = e['sourceRef'];
    provenances.set(name, {
      source: source as CatalogSource,
      sourceRef: nonBlank(sourceRef) ? sourceRef : null,
      licenseNote,
    });
  }
  const provenanceOf = (where: string, row: Raw): Provenance | null => {
    const name = row['provenance'];
    if (!nonBlank(name)) {
      p.add('CATALOG_SOURCE_MISSING', `${where} : provenance (source, licence) absente`);
      return null;
    }
    const found = provenances.get(name);
    if (found === undefined && !(name in rawProvenances))
      p.add('CATALOG_SOURCE_MISSING', `${where} : provenance ${name} inconnue`);
    return found ?? null;
  };

  // clés de doublon de la v1 : marques (nom, alias) et modèles par marque
  const v1Makes = new Map(v1.makes.map((m) => [m.slug, m]));
  const makeKeys = new Map<string, string>();
  for (const m of v1.makes) {
    for (const n of [m.name, ...m.aliases]) makeKeys.set(duplicateKey(n), `v1 ${m.slug}`);
  }

  const makes: CustomsMake[] = [];
  const models: CustomsModel[] = [];
  const variants: CustomsVariant[] = [];
  const existing = { makes: 0, models: 0 };
  const seenMakes = new Set<string>();
  const rawMakes = Array.isArray(doc['makes']) ? (doc['makes'] as unknown[]) : [];
  if (rawMakes.length === 0) p.add('CATALOG_DATA_INVALID', 'makes : liste non vide attendue');

  for (const [mi, makeRaw] of rawMakes.entries()) {
    const m = isObject(makeRaw) ? makeRaw : {};
    const slug = m['slug'];
    const where = `makes[${mi}] (${String(slug)})`;
    if (typeof slug !== 'string' || !SLUG.test(slug)) {
      p.add('CATALOG_DATA_INVALID', `${where} : slug invalide`);
      continue;
    }
    if (seenMakes.has(slug)) p.add('CATALOG_DATA_INVALID', `${where} : slug en double`);
    seenMakes.add(slug);
    const name = m['name'];
    if (!nonBlank(name) || name.length > NAME_MAX)
      p.add('CATALOG_DATA_INVALID', `${where} : name invalide`);
    const makeProvenance = provenanceOf(where, m);
    const aliases = aliasesOf(p, where, m);
    const v1Make = v1Makes.get(slug);
    const isExisting = m['existing'] === true;
    const makeId = catalogId(`make/${slug}`);

    if (isExisting) {
      if (v1Make === undefined || v1Make.name !== name)
        p.add('CATALOG_DATA_INVALID', `${where} : existing sans marque de même slug et nom en v1`);
      if (aliases.length > 0)
        p.add('CATALOG_DATA_INVALID', `${where} : une ligne de la v1 n'est jamais modifiée`);
      existing.makes += 1;
    } else {
      if (v1Make !== undefined)
        p.add('CATALOG_DATA_INVALID', `${where} : doublon de la marque v1 ${slug}`);
      for (const n of typeof name === 'string' ? [name, ...aliases] : aliases) {
        const k = duplicateKey(n);
        const other = makeKeys.get(k);
        if (other !== undefined)
          p.add('CATALOG_DATA_INVALID', `${where} : « ${n} » doublon de la marque ${other}`);
        makeKeys.set(k, slug);
      }
    }

    // modèles : clés de doublon de la marque (v1 puis import)
    const modelKeys = new Map<string, string>();
    const v1Models = new Map((v1Make?.models ?? []).map((o) => [o.slug, o]));
    for (const o of v1Make?.models ?? []) {
      for (const n of [o.name, ...o.aliases]) modelKeys.set(duplicateKey(n), `v1 ${o.slug}`);
    }
    const seenModels = new Set<string>();
    const rawModels = Array.isArray(m['models']) ? (m['models'] as unknown[]) : [];
    if (rawModels.length === 0) p.add('CATALOG_DATA_INVALID', `${where} : aucun modèle`);
    for (const [oi, modelRaw] of rawModels.entries()) {
      const o = isObject(modelRaw) ? modelRaw : {};
      const oslug = o['slug'];
      const owhere = `${where}.models[${oi}] (${String(oslug)})`;
      if (typeof oslug !== 'string' || !SLUG.test(oslug)) {
        p.add('CATALOG_DATA_INVALID', `${owhere} : slug invalide`);
        continue;
      }
      if (seenModels.has(oslug)) p.add('CATALOG_DATA_INVALID', `${owhere} : slug en double`);
      seenModels.add(oslug);
      const oname = o['name'];
      if (!nonBlank(oname) || oname.length > NAME_MAX)
        p.add('CATALOG_DATA_INVALID', `${owhere} : name invalide`);
      const modelProvenance = provenanceOf(owhere, o);
      const oaliases = aliasesOf(p, owhere, o);
      const v1Model = v1Models.get(oslug);
      const modelExisting = o['existing'] === true;
      const modelId = catalogId(`model/${slug}/${oslug}`);

      if (modelExisting) {
        if (!isExisting || v1Model === undefined || v1Model.name !== oname)
          p.add(
            'CATALOG_DATA_INVALID',
            `${owhere} : existing sans modèle de même slug et nom en v1`,
          );
        if (oaliases.length > 0)
          p.add('CATALOG_DATA_INVALID', `${owhere} : une ligne de la v1 n'est jamais modifiée`);
        existing.models += 1;
      } else {
        if (v1Model !== undefined)
          p.add('CATALOG_DATA_INVALID', `${owhere} : doublon du modèle v1 ${oslug}`);
        for (const n of typeof oname === 'string' ? [oname, ...oaliases] : oaliases) {
          const k = duplicateKey(n);
          const other = modelKeys.get(k);
          if (other !== undefined)
            p.add('CATALOG_DATA_INVALID', `${owhere} : « ${n} » doublon du modèle ${other}`);
          modelKeys.set(k, oslug);
        }
      }

      // variante sans fiche
      const v = o['variant'];
      let variant: { yearFrom: number; yearTo: number | null } | null = null;
      if (v === null || v === undefined) {
        if (!modelExisting)
          p.add('CATALOG_DATA_INVALID', `${owhere} : au moins une variante (OQ-CAT-01 g)`);
      } else if (!isObject(v)) {
        p.add('CATALOG_DATA_INVALID', `${owhere} : variant invalide`);
      } else {
        const yearFrom = v['yearFrom'];
        const yearTo = v['yearTo'] ?? null;
        if (!intIn(yearFrom, YEAR_MIN, YEAR_MAX)) {
          p.add('CATALOG_DATA_INVALID', `${owhere} : yearFrom hors de [${YEAR_MIN}, ${YEAR_MAX}]`);
        } else if (yearTo !== null && (!intIn(yearTo, YEAR_MIN, YEAR_MAX) || yearTo < yearFrom)) {
          p.add('CATALOG_DATA_INVALID', `${owhere} : yearTo invalide ou antérieur à yearFrom`);
        } else {
          variant = { yearFrom, yearTo };
        }
        if (variant !== null && modelExisting && v1Model !== undefined) {
          const v1From = Math.min(...v1Model.variants.map((x) => x.yearFrom));
          if (variant.yearTo === null || variant.yearTo >= v1From)
            p.add(
              'CATALOG_DATA_INVALID',
              `${owhere} : la variante de la douane chevauche les années de la v1 (dès ${v1From})`,
            );
        }
      }

      if (modelProvenance === null || makeProvenance === null) continue;
      if (!modelExisting) {
        models.push({
          id: modelId,
          makeId,
          makeSlug: slug,
          slug: oslug,
          name: oname as string,
          aliases: oaliases,
          provenance: modelProvenance,
        });
      }
      if (variant !== null && typeof market === 'string') {
        variants.push({
          id: catalogId(`variant/${slug}/${oslug}/${CUSTOMS_VARIANT_CODE}`),
          modelId: modelExisting && v1Model !== undefined ? v1Model.id : modelId,
          makeSlug: slug,
          modelSlug: oslug,
          yearFrom: variant.yearFrom,
          yearTo: variant.yearTo,
          market,
          provenance: modelProvenance,
        });
      }
    }
    if (makeProvenance === null || isExisting) continue;
    makes.push({ id: makeId, slug, name: name as string, aliases, provenance: makeProvenance });
  }

  p.throwIfAny();
  return {
    version: version as number,
    market: market as string,
    makes,
    models,
    variants,
    existing,
  };
}

const lit = (v: string | number | null): string => {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replaceAll("'", "''")}'`;
};
const textArray = (values: readonly string[]): string =>
  values.length === 0 ? 'ARRAY[]::text[]' : `ARRAY[${values.map(lit).join(', ')}]::text[]`;

/** Provenances distinctes, numérotées dans l'ordre de première apparition (rendu stable). */
function provenanceKeys(data: CustomsImport): Map<string, { k: number; p: Provenance }> {
  const keys = new Map<string, { k: number; p: Provenance }>();
  for (const row of [...data.makes, ...data.models, ...data.variants]) {
    const id = JSON.stringify([
      row.provenance.source,
      row.provenance.sourceRef,
      row.provenance.licenseNote,
    ]);
    if (!keys.has(id)) keys.set(id, { k: keys.size + 1, p: row.provenance });
  }
  return keys;
}

/**
 * Une instruction par table : les lignes (`r`) désignent leur provenance par un numéro, joint à la
 * table des provenances (`p`) par une jointure EXTERNE ; un numéro sans provenance donnerait une
 * source et une licence nulles, refusées par la base (NOT NULL) : la migration, une transaction,
 * échouerait en entier. La note de licence n'est écrite qu'une fois par instruction.
 */
function insert(
  table: string,
  columns: readonly string[],
  select: readonly string[],
  rowColumns: readonly string[],
  rows: readonly string[][],
  provenances: string,
): string {
  return [
    `INSERT INTO core.${table}`,
    `  (${columns.join(', ')})`,
    `SELECT ${select.join(', ')}, p.source, p.source_ref, p.license_note`,
    '  FROM (VALUES',
    rows.map((r) => `  (${r.join(', ')})`).join(',\n'),
    `  ) AS r (${rowColumns.join(', ')}, provenance)`,
    `  LEFT JOIN (VALUES`,
    provenances,
    '  ) AS p (k, source, source_ref, license_note) ON p.k = r.provenance;',
  ].join('\n');
}

/**
 * Section générée de la migration 0078, marqueurs compris, terminée par un saut de ligne. Une
 * instruction par table : la migration est une transaction, une ligne refusée annule tout.
 */
export function renderCustomsSeedSql(data: CustomsImport): string {
  const keys = provenanceKeys(data);
  const keyOf = (x: { provenance: Provenance }): string =>
    String(
      keys.get(
        JSON.stringify([x.provenance.source, x.provenance.sourceRef, x.provenance.licenseNote]),
      )?.k ?? 0,
    );
  const provenances = [...keys.values()]
    .map(({ k, p }) => `  (${k}, ${lit(p.source)}, ${lit(p.sourceRef)},\n   ${lit(p.licenseNote)})`)
    .join(',\n');
  return [
    CUSTOMS_BEGIN,
    `-- Source : apps/api/src/modules/cat/data/vehicle-catalog-dnit.json (version ${data.version}),`,
    '-- rendue par apps/api/src/modules/cat/internal/vehicle-catalog/customs-import.ts.',
    `-- ${data.makes.length} marques et ${data.models.length} modèles nouveaux, ` +
      `${data.variants.length} variantes sans fiche ; ` +
      `${data.existing.makes} marques et ${data.existing.models} modèles de la v1 gardés.`,
    insert(
      'catalog_vehicle_make',
      ['id', 'slug', 'name', 'aliases', 'status', 'source', 'source_ref', 'license_note'],
      ['r.id::uuid', 'r.slug', 'r.name', 'r.aliases', "'ACTIVE'"],
      ['id', 'slug', 'name', 'aliases'],
      data.makes.map((m) => [lit(m.id), lit(m.slug), lit(m.name), textArray(m.aliases), keyOf(m)]),
      provenances,
    ),
    insert(
      'catalog_vehicle_model',
      [
        'id',
        'make_id',
        'slug',
        'name',
        'aliases',
        'status',
        'source',
        'source_ref',
        'license_note',
      ],
      ['r.id::uuid', 'r.make_id::uuid', 'r.slug', 'r.name', 'r.aliases', "'ACTIVE'"],
      ['id', 'make_id', 'slug', 'name', 'aliases'],
      data.models.map((o) => [
        lit(o.id),
        lit(o.makeId),
        lit(o.slug),
        lit(o.name),
        textArray(o.aliases),
        keyOf(o),
      ]),
      provenances,
    ),
    insert(
      'catalog_vehicle_variant',
      [
        'id',
        'model_id',
        'year_from',
        'year_to',
        'market',
        'status',
        'source',
        'source_ref',
        'license_note',
      ],
      [
        'r.id::uuid',
        'r.model_id::uuid',
        'r.year_from::integer',
        'r.year_to::integer',
        'r.market::char(2)',
        "'ACTIVE'",
      ],
      ['id', 'model_id', 'year_from', 'year_to', 'market'],
      data.variants.map((v) => [
        lit(v.id),
        lit(v.modelId),
        lit(v.yearFrom),
        lit(v.yearTo),
        lit(v.market),
        keyOf(v),
      ]),
      provenances,
    ),
    CUSTOMS_END,
    '',
  ].join('\n');
}

/** Extrait la section générée de la douane d'une migration (marqueurs compris) ; `null` sinon. */
export function extractCustomsSection(migration: string): string | null {
  const text = migration.replaceAll('\r\n', '\n');
  const begin = text.indexOf(CUSTOMS_BEGIN);
  const end = text.indexOf(CUSTOMS_END);
  if (begin < 0 || end < begin) return null;
  return `${text.slice(begin, end + CUSTOMS_END.length)}\n`;
}
