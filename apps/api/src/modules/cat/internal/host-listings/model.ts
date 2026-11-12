/**
 * Modèle et validation des lieux de remise, véhicules et annonces de l'hôte (US-115 ; 16 HST-011,
 * HST-005, HST-012, PRC-001, HST-033 ; 17 §3.2.3 ; ADR-099). Fonctions pures : la base revérifie
 * tout (commandes `core.catalog_cmd_*` de 0067) et décide seule de la propriété, du pays, de
 * l'unicité de la plaque et du pas de prix du pays.
 *
 * Une saisie invalide est rendue champ par champ (UX-50 : « champ invalide lié au champ ») ;
 * aucune constante propre à un pays : le pays et la devise sont ceux du compte d'hôte, en base.
 */

export const LOCATION_KINDS = ['HOME', 'POI', 'AIRPORT'] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const TRANSMISSIONS = ['MANUAL', 'AUTOMATIC'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const FUEL_TYPES = ['GASOLINE', 'DIESEL', 'HYBRID', 'EV'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const MILEAGE_MODES = ['UNLIMITED', 'INCLUDED'] as const;
export type MileageMode = (typeof MILEAGE_MODES)[number];

/** États de SM-2 (08 ; 17 §3.2.3). */
export const LISTING_STATUSES = [
  'DRAFT',
  'BLOCKED_ELIGIBILITY',
  'PENDING_REVIEW',
  'LISTED',
  'REJECTED',
  'SNOOZED',
  'UNLISTED',
  'RESTRICTED',
  'REMOVED_BY_PLATFORM',
  'DELETED',
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export interface LocationInput {
  readonly kind: LocationKind;
  readonly label: string;
  readonly addressLine: string;
  readonly city: string;
  readonly areaLabel: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface VehicleInput {
  readonly locationId: string;
  readonly plate: string;
  readonly vin: string | null;
  readonly variantId: string | null;
  readonly makeText: string | null;
  readonly modelText: string | null;
  readonly year: number;
  readonly trim: string | null;
  readonly transmission: Transmission;
  readonly seats: number;
  readonly fuelType: FuelType;
  readonly odometerKm: number | null;
  readonly gpsInstalled: boolean;
  readonly lienDeclared: boolean;
}

export interface PricingInput {
  /** Prix journalier en unités mineures de la devise du pays (chaîne d'entier, jamais un flottant). */
  readonly dailyPriceMinor: bigint;
  readonly mileageMode: MileageMode;
  readonly includedKmPerDay: number | null;
  readonly extraKmPriceMinor: bigint | null;
}

export interface ListingInput extends PricingInput {
  readonly vehicleId: string;
  readonly instantBook: boolean;
}

/** Champ refusé et sa raison (clé de message `common.listing.field.*`). */
export interface FieldProblem {
  readonly field: string;
  readonly reason: 'REQUIRED' | 'INVALID';
}

export class FieldValidationError extends Error {
  override readonly name = 'FieldValidationError';
  readonly problems: readonly FieldProblem[];
  constructor(problems: readonly FieldProblem[]) {
    super(`champs invalides : ${problems.map((p) => p.field).join(', ')}`);
    this.problems = Object.freeze([...problems]);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Plaque normalisée (majuscules, sans espace, point ni tiret) ; caractère étranger : `null`. */
export function normalizePlate(raw: string): string | null {
  if (!/^[A-Za-z0-9 .-]{1,24}$/.test(raw)) return null;
  const p = raw.replace(/[ .-]/g, '').toUpperCase();
  return /^[A-Z0-9]{2,12}$/.test(p) ? p : null;
}

/** VIN normalisé : ISO 3779 (17 caractères, ni I, O ni Q), ou 5 à 17 avant 1981 (BR-LIST-04). */
export function normalizeVin(raw: string, year: number): string | null {
  if (!/^[A-Za-z0-9 -]{1,40}$/.test(raw)) return null;
  const v = raw.replace(/[ -]/g, '').toUpperCase();
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return v;
  return year < 1981 && /^[A-Z0-9]{5,17}$/.test(v) ? v : null;
}

class Fields {
  readonly problems: FieldProblem[] = [];
  constructor(private readonly body: Record<string, unknown>) {}

  text(field: string, max: number, required = true): string | null {
    const v = this.body[field];
    if (v === undefined || v === null) {
      if (required) this.problems.push({ field, reason: 'REQUIRED' });
      return null;
    }
    if (typeof v !== 'string' || v.trim() === '' || v.length > max) {
      this.problems.push({ field, reason: v === '' ? 'REQUIRED' : 'INVALID' });
      return null;
    }
    return v.trim();
  }

  choice<T extends string>(field: string, values: readonly T[], fallback?: T): T | null {
    const v = this.body[field];
    if (v === undefined && fallback !== undefined) return fallback;
    if (typeof v === 'string' && (values as readonly string[]).includes(v)) return v as T;
    this.problems.push({ field, reason: v === undefined ? 'REQUIRED' : 'INVALID' });
    return null;
  }

  int(field: string, min: number, max: number, required = true): number | null {
    const v = this.body[field];
    if (v === undefined || v === null) {
      if (required) this.problems.push({ field, reason: 'REQUIRED' });
      return null;
    }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      this.problems.push({ field, reason: 'INVALID' });
      return null;
    }
    return v;
  }

  /** Montant en unités mineures : chaîne d'entier (17 §1.2), jamais un nombre décimal. */
  minor(field: string, required = true): bigint | null {
    const v = this.body[field];
    if (v === undefined || v === null) {
      if (required) this.problems.push({ field, reason: 'REQUIRED' });
      return null;
    }
    if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,17})$/.test(v)) {
      this.problems.push({ field, reason: 'INVALID' });
      return null;
    }
    return BigInt(v);
  }

  bool(field: string, fallback: boolean): boolean {
    const v = this.body[field];
    if (v === undefined) return fallback;
    if (typeof v === 'boolean') return v;
    this.problems.push({ field, reason: 'INVALID' });
    return fallback;
  }

  coordinate(field: string, limit: number): number | null {
    const v = this.body[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > limit) {
      this.problems.push({ field, reason: 'INVALID' });
      return null;
    }
    return Math.round(v * 1e6) / 1e6;
  }

  unknownKeys(allowed: readonly string[]): void {
    for (const k of Object.keys(this.body)) {
      if (!allowed.includes(k)) this.problems.push({ field: k, reason: 'INVALID' });
    }
  }

  done(): void {
    if (this.problems.length > 0) throw new FieldValidationError(this.problems);
  }
}

const LOCATION_KEYS = ['kind', 'label', 'addressLine', 'city', 'areaLabel', 'lat', 'lng'] as const;

/** Lieu de remise (16 HST-011 ; OQ-P2P-05) : épingle facultative, mais complète. */
export function parseLocation(body: Record<string, unknown>): LocationInput {
  const f = new Fields(body);
  f.unknownKeys(LOCATION_KEYS);
  const kind = f.choice('kind', LOCATION_KINDS, 'HOME');
  const label = f.text('label', 80);
  const addressLine = f.text('addressLine', 200);
  const city = f.text('city', 80);
  const areaLabel = f.text('areaLabel', 80, false);
  const lat = f.coordinate('lat', 90);
  const lng = f.coordinate('lng', 180);
  // épingle facultative, mais jamais à moitié posée
  const hasLat = body['lat'] !== undefined && body['lat'] !== null;
  const hasLng = body['lng'] !== undefined && body['lng'] !== null;
  if (hasLat !== hasLng) f.problems.push({ field: hasLat ? 'lng' : 'lat', reason: 'REQUIRED' });
  f.done();
  return {
    kind: kind as LocationKind,
    label: label as string,
    addressLine: addressLine as string,
    city: city as string,
    areaLabel,
    lat,
    lng,
  };
}

const VEHICLE_KEYS = [
  'locationId',
  'plate',
  'vin',
  'variantId',
  'makeText',
  'modelText',
  'year',
  'trim',
  'transmission',
  'seats',
  'fuelType',
  'odometerKm',
  'gpsInstalled',
  'lienDeclared',
] as const;

/** Véhicule (16 HST-011) : variante du catalogue OU repli marque / modèle (17 §3.2.3). */
export function parseVehicle(body: Record<string, unknown>): VehicleInput {
  const f = new Fields(body);
  f.unknownKeys(VEHICLE_KEYS);
  const locationId = body['locationId'];
  if (!isUuid(locationId)) f.problems.push({ field: 'locationId', reason: 'REQUIRED' });
  const year = f.int('year', 1950, 2100);
  const rawPlate = f.text('plate', 24);
  const plate = rawPlate === null ? null : normalizePlate(rawPlate);
  if (rawPlate !== null && plate === null) f.problems.push({ field: 'plate', reason: 'INVALID' });
  const rawVin = f.text('vin', 40, false);
  const vin = rawVin === null || year === null ? null : normalizeVin(rawVin, year);
  if (rawVin !== null && year !== null && vin === null) {
    f.problems.push({ field: 'vin', reason: 'INVALID' });
  }
  const variantId = body['variantId'] ?? null;
  if (variantId !== null && !isUuid(variantId))
    f.problems.push({ field: 'variantId', reason: 'INVALID' });
  const makeText = f.text('makeText', 80, variantId === null);
  const modelText = f.text('modelText', 80, variantId === null);
  if (variantId !== null && (makeText !== null || modelText !== null)) {
    f.problems.push({ field: makeText !== null ? 'makeText' : 'modelText', reason: 'INVALID' });
  }
  const trim = f.text('trim', 80, false);
  const transmission = f.choice('transmission', TRANSMISSIONS);
  const seats = f.int('seats', 1, 60);
  const fuelType = f.choice('fuelType', FUEL_TYPES);
  const odometerKm = f.int('odometerKm', 0, 3_000_000, false);
  const gpsInstalled = f.bool('gpsInstalled', false);
  const lienDeclared = f.bool('lienDeclared', false);
  f.done();
  return {
    locationId: locationId as string,
    plate: plate as string,
    vin,
    variantId: variantId as string | null,
    makeText: variantId === null ? makeText : null,
    modelText: variantId === null ? modelText : null,
    year: year as number,
    trim,
    transmission: transmission as Transmission,
    seats: seats as number,
    fuelType: fuelType as FuelType,
    odometerKm,
    gpsInstalled,
    lienDeclared,
  };
}

const PRICING_KEYS = ['dailyPriceMinor', 'mileageMode', 'includedKmPerDay', 'extraKmPriceMinor'];

function pricingOf(f: Fields): PricingInput {
  const dailyPriceMinor = f.minor('dailyPriceMinor');
  if (dailyPriceMinor !== null && dailyPriceMinor <= 0n) {
    f.problems.push({ field: 'dailyPriceMinor', reason: 'INVALID' });
  }
  const mileageMode = f.choice('mileageMode', MILEAGE_MODES, 'UNLIMITED');
  const included = mileageMode === 'INCLUDED';
  const includedKmPerDay = f.int('includedKmPerDay', 1, 10_000, included);
  const extraKmPriceMinor = f.minor('extraKmPriceMinor', included);
  if (!included && (includedKmPerDay !== null || extraKmPriceMinor !== null)) {
    f.problems.push({ field: 'mileageMode', reason: 'INVALID' });
  }
  return {
    dailyPriceMinor: dailyPriceMinor ?? 0n,
    mileageMode: mileageMode as MileageMode,
    includedKmPerDay: included ? includedKmPerDay : null,
    extraKmPriceMinor: included ? extraKmPriceMinor : null,
  };
}

/** Tarif (PRC-001, HST-033) : le pas du pays et le reste sont jugés par la base. */
export function parsePricing(body: Record<string, unknown>): PricingInput {
  const f = new Fields(body);
  f.unknownKeys(PRICING_KEYS);
  const p = pricingOf(f);
  f.done();
  return p;
}

/** Annonce DRAFT : véhicule, tarif, mode de réservation (INSTANT par défaut, OQ-P2P-10). */
export function parseListing(body: Record<string, unknown>): ListingInput {
  const f = new Fields(body);
  f.unknownKeys([...PRICING_KEYS, 'vehicleId', 'instantBook']);
  const vehicleId = body['vehicleId'];
  if (!isUuid(vehicleId)) f.problems.push({ field: 'vehicleId', reason: 'REQUIRED' });
  const p = pricingOf(f);
  const instantBook = f.bool('instantBook', true);
  f.done();
  return { ...p, vehicleId: vehicleId as string, instantBook };
}
