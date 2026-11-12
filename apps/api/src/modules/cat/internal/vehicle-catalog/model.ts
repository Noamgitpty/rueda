/**
 * Modèle et validation du catalogue de référence des véhicules (US-113 ; 16 HST-050 ; 17 §3.2.3,
 * ADR-034 ; ADR-094). Les énumérations sont celles de 17 §3.2.3 ; aucune n'est propre à un pays.
 *
 * La graine est une DONNÉE (`../../data/vehicle-catalog.json`) validée ici, fail-closed :
 * - chaque marque, modèle et variante désigne une provenance qui porte `source` et
 *   `licenseNote` non vides, sinon `CATALOG_SOURCE_MISSING` (16 HST-050, 19 US-113 critère 1) ;
 * - la licence de la source (et celle de la source d'une consommation) doit être `VALIDATED`,
 *   sinon `CATALOG_SOURCE_UNLICENSED` (17 ADR-034 ; défaut d'OQ-CAT-01 (a)(b) : n'importer que
 *   les sources dont la licence est validée) ;
 * - toute autre forme invalide : `CATALOG_DATA_INVALID`.
 * Aucune ligne n'est rendue tant qu'un seul défaut subsiste.
 */
import { createHash } from 'node:crypto';
import { CatalogError } from './errors.js';
import type { CatalogErrorCode } from './errors.js';

export const CATALOG_STATUSES = ['ACTIVE', 'PENDING_REVIEW', 'RETIRED'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

/**
 * Sources d'une ligne (17 §3.2.3 ; `AGENCY_REQUEST` historique, hors produit : DEC-FONDATEUR-13) ;
 * `DNIT_ADUANAS_PY` : données ouvertes de la douane (DNIT – Gerencia General de Aduanas), suite
 * d'US-113, migration 0079, ADR-109.
 */
export const CATALOG_SOURCES = [
  'WIKIDATA',
  'NHTSA_VPIC',
  'OPS_CURATED',
  'HOST_REQUEST',
  'DNIT_ADUANAS_PY',
] as const;
export type CatalogSource = (typeof CATALOG_SOURCES)[number];

/**
 * Sources sans caractéristiques techniques (ADR-109) : leurs lignes peuvent n'avoir ni carrosserie,
 * ni places, ni portes, ni boîte, ni carburant, ni transmission (« à compléter par l'ops ») ; la
 * base refuse une ligne sans fiche de toute autre source (0079).
 */
export const SPECLESS_SOURCES: readonly CatalogSource[] = ['DNIT_ADUANAS_PY'];

export const BODY_TYPES = [
  'SUV',
  'PICKUP',
  'SEDAN',
  'HATCHBACK',
  'VAN',
  'MINIVAN',
  'COUPE',
  'CONVERTIBLE',
  'WAGON',
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const GEARBOXES = ['MT', 'AT', 'CVT', 'DCT'] as const;
export type Gearbox = (typeof GEARBOXES)[number];

export const VARIANT_FUELS = ['GASOLINE', 'DIESEL', 'HYBRID', 'PHEV', 'EV', 'LPG'] as const;
export type VariantFuel = (typeof VARIANT_FUELS)[number];

export const DRIVES = ['FWD', 'RWD', 'AWD', '4X4'] as const;
export type Drive = (typeof DRIVES)[number];

/** `EPA_US_REFERENCE` = valeur US indicative, toujours étiquetée « référence US » (17 §3.2.3). */
export const CONSUMPTION_SOURCES = ['EPA_US_REFERENCE', 'OPS_CURATED'] as const;
export type ConsumptionSource = (typeof CONSUMPTION_SOURCES)[number];

export const VALUE_CLASSES = ['STANDARD', 'PREMIUM', 'LUXE'] as const;
export type ValueClass = (typeof VALUE_CLASSES)[number];

export const LICENSE_STATUSES = ['VALIDATED', 'TO_VALIDATE'] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export interface Provenance {
  readonly source: CatalogSource;
  readonly sourceRef: string | null;
  readonly licenseNote: string;
}

export interface CatalogVariant {
  readonly id: string;
  /** Code de la variante, unique dans son modèle (slug). */
  readonly variantCode: string;
  readonly yearFrom: number;
  readonly yearTo: number | null;
  readonly trimName: string | null;
  readonly transmission: Gearbox;
  readonly fuelType: VariantFuel;
  readonly drive: Drive;
  readonly engineCc: number | null;
  readonly engineCylinders: number | null;
  readonly powerHp: number | null;
  /** Litres aux 100 km, une décimale au plus, en chaîne (jamais un flottant arrondi au rendu). */
  readonly consumptionL100km: string | null;
  readonly consumptionSource: ConsumptionSource | null;
  readonly seats: number;
  readonly doors: number;
  readonly cargoL: number | null;
  readonly valueClass: ValueClass | null;
  readonly status: CatalogStatus;
  readonly provenance: Provenance;
}

export interface CatalogModel {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly bodyType: BodyType;
  readonly seatsDefault: number;
  readonly doorsDefault: number;
  readonly status: CatalogStatus;
  readonly provenance: Provenance;
  readonly variants: readonly CatalogVariant[];
}

export interface CatalogMake {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly countryOrigin: string | null;
  readonly aliases: readonly string[];
  readonly status: CatalogStatus;
  readonly provenance: Provenance;
  readonly models: readonly CatalogModel[];
}

export interface VehicleCatalogSeed {
  readonly version: number;
  readonly makes: readonly CatalogMake[];
}

/**
 * Identifiant stable d'une ligne de graine : UUID version 8 (RFC 9562, « personnalisé ») tiré du
 * SHA-256 de son chemin (`make/<slug>`, `model/<marque>/<slug>`, `variant/<marque>/<modèle>/<clé>`).
 * Le même chemin donne le même identifiant dans toutes les bases (US-115 y rattache
 * `vehicle.variant_id`).
 */
export function catalogId(path: string): string {
  const b = createHash('sha256').update(`rueda.vehicle-catalog:${path}`, 'utf8').digest();
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x80;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = b.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_COUNTRY = /^[A-Z]{2}$/;
const CONSUMPTION = /^\d{1,2}(?:\.\d)?$/;
const NAME_MAX = 80;
const NOTE_MAX = 500;
const YEAR_MIN = 1950;
const YEAR_MAX = 2100;

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonBlank = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);

class Problems {
  readonly byCode = new Map<CatalogErrorCode, string[]>();
  add(code: CatalogErrorCode, line: string): void {
    const list = this.byCode.get(code) ?? [];
    list.push(line);
    this.byCode.set(code, list);
  }
  /** Lève l'erreur du défaut le plus grave, avec tous les défauts en détail. */
  throwIfAny(): void {
    const order: CatalogErrorCode[] = [
      'CATALOG_SOURCE_MISSING',
      'CATALOG_SOURCE_UNLICENSED',
      'CATALOG_DATA_INVALID',
    ];
    const first = order.find((c) => (this.byCode.get(c) ?? []).length > 0);
    if (first === undefined) return;
    const all = order.flatMap((c) => (this.byCode.get(c) ?? []).map((l) => `${c} ${l}`));
    throw new CatalogError(first, 'graine du catalogue des véhicules refusée', all);
  }
}

function intIn(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}

function optionalInt(
  p: Problems,
  where: string,
  raw: Raw,
  field: string,
  min: number,
  max: number,
): number | null {
  const v = raw[field];
  if (v === undefined || v === null) return null;
  if (!intIn(v, min, max)) {
    p.add('CATALOG_DATA_INVALID', `${where} : ${field} hors de [${min}, ${max}]`);
    return null;
  }
  return v;
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

function statusOf(p: Problems, where: string, raw: Raw): CatalogStatus {
  const v = raw['status'] ?? 'ACTIVE';
  if (!oneOf(CATALOG_STATUSES, v)) {
    p.add('CATALOG_DATA_INVALID', `${where} : status inconnu`);
    return 'ACTIVE';
  }
  return v;
}

function licenses(p: Problems, raw: unknown, label: string): Map<string, LicenseStatus> {
  const out = new Map<string, LicenseStatus>();
  if (!isObject(raw)) {
    p.add('CATALOG_DATA_INVALID', `${label} absent`);
    return out;
  }
  for (const [source, entry] of Object.entries(raw)) {
    const status = isObject(entry) ? entry['status'] : undefined;
    if (!oneOf(LICENSE_STATUSES, status)) {
      p.add('CATALOG_DATA_INVALID', `${label}.${source} : status de licence inconnu`);
      continue;
    }
    out.set(source, status);
  }
  return out;
}

/** Valide la graine et rend le catalogue (identifiants stables). Lève `CatalogError` sinon. */
export function parseVehicleCatalog(raw: unknown): VehicleCatalogSeed {
  const p = new Problems();
  if (!isObject(raw)) {
    p.add('CATALOG_DATA_INVALID', 'document : objet attendu');
    p.throwIfAny();
  }
  const doc = raw as Raw;
  const version = doc['version'];
  if (!intIn(version, 1, 1_000_000)) p.add('CATALOG_DATA_INVALID', 'version : entier attendu');

  const sourceLicenses = licenses(p, doc['sourceLicenses'], 'sourceLicenses');
  const consumptionLicenses = licenses(p, doc['consumptionLicenses'], 'consumptionLicenses');

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
    if (!oneOf(CATALOG_SOURCES, source)) {
      p.add('CATALOG_DATA_INVALID', `provenance ${name} : source inconnue`);
      continue;
    }
    if (sourceLicenses.get(source) !== 'VALIDATED') {
      p.add('CATALOG_SOURCE_UNLICENSED', `provenance ${name} : licence de ${source} non validée`);
      continue;
    }
    if (licenseNote.length > NOTE_MAX) {
      p.add('CATALOG_DATA_INVALID', `provenance ${name} : licenseNote trop longue`);
      continue;
    }
    const sourceRef = e['sourceRef'];
    provenances.set(name, {
      source,
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
    if (found === undefined && !(name in rawProvenances)) {
      p.add('CATALOG_SOURCE_MISSING', `${where} : provenance ${name} inconnue`);
    }
    return found ?? null;
  };

  const makes: CatalogMake[] = [];
  const makeSlugs = new Set<string>();
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
    if (makeSlugs.has(slug)) p.add('CATALOG_DATA_INVALID', `${where} : slug en double`);
    makeSlugs.add(slug);
    const name = m['name'];
    if (!nonBlank(name) || name.length > NAME_MAX)
      p.add('CATALOG_DATA_INVALID', `${where} : name invalide`);
    const origin = m['countryOrigin'];
    if (origin !== undefined && (typeof origin !== 'string' || !ISO_COUNTRY.test(origin)))
      p.add('CATALOG_DATA_INVALID', `${where} : countryOrigin (ISO 3166-1 alpha-2) invalide`);
    const makeProvenance = provenanceOf(where, m);
    const aliases = aliasesOf(p, where, m);
    const status = statusOf(p, where, m);

    const models: CatalogModel[] = [];
    const modelSlugs = new Set<string>();
    const rawModels = Array.isArray(m['models']) ? (m['models'] as unknown[]) : [];
    for (const [oi, modelRaw] of rawModels.entries()) {
      const o = isObject(modelRaw) ? modelRaw : {};
      const oslug = o['slug'];
      const owhere = `${where}.models[${oi}] (${String(oslug)})`;
      if (typeof oslug !== 'string' || !SLUG.test(oslug)) {
        p.add('CATALOG_DATA_INVALID', `${owhere} : slug invalide`);
        continue;
      }
      if (modelSlugs.has(oslug)) p.add('CATALOG_DATA_INVALID', `${owhere} : slug en double`);
      modelSlugs.add(oslug);
      const oname = o['name'];
      if (!nonBlank(oname) || oname.length > NAME_MAX)
        p.add('CATALOG_DATA_INVALID', `${owhere} : name invalide`);
      const bodyType = o['bodyType'];
      if (!oneOf(BODY_TYPES, bodyType))
        p.add('CATALOG_DATA_INVALID', `${owhere} : bodyType inconnu`);
      const seatsDefault = o['seatsDefault'];
      const doorsDefault = o['doorsDefault'];
      if (!intIn(seatsDefault, 1, 60))
        p.add('CATALOG_DATA_INVALID', `${owhere} : seatsDefault hors de [1, 60]`);
      if (!intIn(doorsDefault, 1, 6))
        p.add('CATALOG_DATA_INVALID', `${owhere} : doorsDefault hors de [1, 6]`);
      const modelProvenance = provenanceOf(owhere, o);
      const oaliases = aliasesOf(p, owhere, o);
      const ostatus = statusOf(p, owhere, o);

      const variants: CatalogVariant[] = [];
      const keys = new Set<string>();
      const natural = new Set<string>();
      const rawVariants = Array.isArray(o['variants']) ? (o['variants'] as unknown[]) : [];
      if (rawVariants.length === 0)
        p.add('CATALOG_DATA_INVALID', `${owhere} : au moins une variante (OQ-CAT-01 g)`);
      for (const [vi, variantRaw] of rawVariants.entries()) {
        const v = isObject(variantRaw) ? variantRaw : {};
        const key = v['variantCode'];
        const vwhere = `${owhere}.variants[${vi}] (${String(key)})`;
        if (typeof key !== 'string' || !SLUG.test(key)) {
          p.add('CATALOG_DATA_INVALID', `${vwhere} : variantCode invalide`);
          continue;
        }
        if (keys.has(key)) p.add('CATALOG_DATA_INVALID', `${vwhere} : variantCode en double`);
        keys.add(key);
        const yearFrom = v['yearFrom'];
        const yearTo = v['yearTo'] ?? null;
        if (!intIn(yearFrom, YEAR_MIN, YEAR_MAX))
          p.add('CATALOG_DATA_INVALID', `${vwhere} : yearFrom hors de [${YEAR_MIN}, ${YEAR_MAX}]`);
        if (
          yearTo !== null &&
          (!intIn(yearTo, YEAR_MIN, YEAR_MAX) ||
            (typeof yearFrom === 'number' && yearTo < yearFrom))
        )
          p.add('CATALOG_DATA_INVALID', `${vwhere} : yearTo invalide ou antérieur à yearFrom`);
        const trimName = v['trimName'] ?? null;
        if (trimName !== null && (!nonBlank(trimName) || trimName.length > NAME_MAX))
          p.add('CATALOG_DATA_INVALID', `${vwhere} : trimName invalide`);
        const transmission = v['transmission'];
        const fuelType = v['fuelType'];
        const drive = v['drive'];
        if (!oneOf(GEARBOXES, transmission))
          p.add('CATALOG_DATA_INVALID', `${vwhere} : transmission inconnue`);
        if (!oneOf(VARIANT_FUELS, fuelType))
          p.add('CATALOG_DATA_INVALID', `${vwhere} : fuelType inconnu`);
        if (!oneOf(DRIVES, drive)) p.add('CATALOG_DATA_INVALID', `${vwhere} : drive inconnu`);
        const seats = v['seats'];
        const doors = v['doors'];
        if (!intIn(seats, 1, 60))
          p.add('CATALOG_DATA_INVALID', `${vwhere} : seats hors de [1, 60]`);
        if (!intIn(doors, 1, 6)) p.add('CATALOG_DATA_INVALID', `${vwhere} : doors hors de [1, 6]`);
        const valueClass = v['valueClass'] ?? null;
        if (valueClass !== null && !oneOf(VALUE_CLASSES, valueClass))
          p.add('CATALOG_DATA_INVALID', `${vwhere} : valueClass inconnue`);

        let consumptionL100km: string | null = null;
        let consumptionSource: ConsumptionSource | null = null;
        const consumption = v['consumption'];
        if (consumption !== undefined && consumption !== null) {
          const c = isObject(consumption) ? consumption : {};
          const value = c['litersPer100km'];
          const source = c['source'];
          if (typeof value !== 'string' || !CONSUMPTION.test(value) || Number(value) <= 0) {
            p.add('CATALOG_DATA_INVALID', `${vwhere} : consumption.litersPer100km invalide`);
          } else if (!oneOf(CONSUMPTION_SOURCES, source)) {
            p.add('CATALOG_SOURCE_MISSING', `${vwhere} : consumption.source absente ou inconnue`);
          } else if (consumptionLicenses.get(source) !== 'VALIDATED') {
            p.add(
              'CATALOG_SOURCE_UNLICENSED',
              `${vwhere} : licence de la consommation ${source} non validée`,
            );
          } else {
            consumptionL100km = value;
            consumptionSource = source;
          }
        }

        const naturalKey = [yearFrom, trimName, transmission, fuelType, drive].join('|');
        if (natural.has(naturalKey))
          p.add('CATALOG_DATA_INVALID', `${vwhere} : variante en double (année, finition, boîte…)`);
        natural.add(naturalKey);

        const provenance = provenanceOf(vwhere, v);
        if (provenance === null) continue;
        variants.push({
          id: catalogId(`variant/${slug}/${oslug}/${key}`),
          variantCode: key,
          yearFrom: yearFrom as number,
          yearTo: yearTo as number | null,
          trimName: trimName as string | null,
          transmission: transmission as Gearbox,
          fuelType: fuelType as VariantFuel,
          drive: drive as Drive,
          engineCc: optionalInt(p, vwhere, v, 'engineCc', 50, 10_000),
          engineCylinders: optionalInt(p, vwhere, v, 'engineCylinders', 1, 16),
          powerHp: optionalInt(p, vwhere, v, 'powerHp', 1, 2_000),
          consumptionL100km,
          consumptionSource,
          seats: seats as number,
          doors: doors as number,
          cargoL: optionalInt(p, vwhere, v, 'cargoL', 1, 20_000),
          valueClass: valueClass as ValueClass | null,
          status: statusOf(p, vwhere, v),
          provenance,
        });
      }
      if (modelProvenance === null) continue;
      models.push({
        id: catalogId(`model/${slug}/${oslug}`),
        slug: oslug,
        name: oname as string,
        aliases: oaliases,
        bodyType: bodyType as BodyType,
        seatsDefault: seatsDefault as number,
        doorsDefault: doorsDefault as number,
        status: ostatus,
        provenance: modelProvenance,
        variants,
      });
    }
    if (makeProvenance === null) continue;
    makes.push({
      id: catalogId(`make/${slug}`),
      slug,
      name: name as string,
      countryOrigin: typeof origin === 'string' ? origin : null,
      aliases,
      status,
      provenance: makeProvenance,
      models,
    });
  }

  p.throwIfAny();
  return { version: version as number, makes };
}
