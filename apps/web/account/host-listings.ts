/**
 * Lecture défensive des réponses de l'API des lieux, véhicules et annonces de l'hôte (US-115,
 * ADR-099) et saisie du prix, côté SERVEUR du site seulement. Toute réponse mal formée est
 * refusée (`null`) : l'écran affiche alors son état d'erreur, jamais une donnée partielle.
 * Aucune constante de pays ni de devise : la devise et son exposant viennent du compte d'hôte.
 */
import { CATALOGS } from '@rueda/i18n';
import type { LocaleProfile, MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

export interface HostAccountView {
  readonly orgId: string;
  readonly country: string;
  readonly status: string;
}

/** Comptes d'hôte de `GET /auth/session` ; `null` si la réponse est illisible. */
export function hostAccountsOf(reply: ApiResult): HostAccountView[] | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const list = reply.json['hostAccounts'];
  if (!Array.isArray(list)) return null;
  const out: HostAccountView[] = [];
  for (const a of list) {
    if (!isObj(a) || !UUID.test(String(a['orgId'])) || !/^[A-Z]{2}$/.test(String(a['country']))) {
      return null;
    }
    out.push({
      orgId: String(a['orgId']),
      country: String(a['country']),
      status: String(a['status']),
    });
  }
  return out;
}

export interface MarketView {
  readonly country: string;
  readonly currency: string;
  readonly currencyExponent: number;
}

export interface LocationView {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly addressLine: string;
  readonly city: string;
  readonly areaLabel: string | null;
}

export interface VehicleView {
  readonly id: string;
  readonly plate: string;
  readonly makeText: string | null;
  readonly modelText: string | null;
  readonly year: number;
  readonly listingId: string | null;
}

export interface ListingView {
  readonly id: string;
  readonly vehicleId: string;
  readonly status: string;
  readonly dailyPriceMinor: bigint;
  readonly currency: string;
  readonly mileageMode: string;
  readonly includedKmPerDay: number | null;
  /** Prix du km supplémentaire (distance incluse), en unités mineures ; `null` en illimité. */
  readonly extraKmPriceMinor: bigint | null;
  readonly photos: number;
}

/** Dépôt des photos annoncé par l'API : ouvert ou fermé, et taille maximale d'une photo. */
export interface PhotoUploadsView {
  readonly open: boolean;
  readonly maxBytes: number;
}

function photoUploadsOf(v: unknown): PhotoUploadsView | null {
  if (!isObj(v) || typeof v['open'] !== 'boolean') return null;
  const maxBytes = int(v['maxBytes']);
  if (maxBytes === null || maxBytes < 0) return null;
  return { open: v['open'], maxBytes };
}

function marketOf(v: unknown): MarketView | null {
  if (!isObj(v)) return null;
  const currency = str(v['currency']);
  const exponent = int(v['currencyExponent']);
  const country = str(v['country']);
  if (currency === null || !/^[A-Z]{3}$/.test(currency) || exponent === null || exponent < 0) {
    return null;
  }
  if (country === null || !/^[A-Z]{2}$/.test(country)) return null;
  return { country, currency, currencyExponent: exponent };
}

export function locationsOf(reply: ApiResult): LocationView[] | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['locations'])) {
    return null;
  }
  const out: LocationView[] = [];
  for (const l of reply.json['locations'] as unknown[]) {
    if (!isObj(l) || !UUID.test(String(l['id']))) return null;
    const label = str(l['label']);
    const addressLine = str(l['addressLine']);
    const city = str(l['city']);
    if (label === null || addressLine === null || city === null) return null;
    out.push({
      id: String(l['id']),
      kind: String(l['kind']),
      label,
      addressLine,
      city,
      areaLabel: str(l['areaLabel']),
    });
  }
  return out;
}

export function vehiclesOf(reply: ApiResult): VehicleView[] | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['vehicles'])) {
    return null;
  }
  const out: VehicleView[] = [];
  for (const v of reply.json['vehicles'] as unknown[]) {
    if (!isObj(v) || !UUID.test(String(v['id'])) || int(v['year']) === null) return null;
    const plate = str(v['plate']);
    if (plate === null) return null;
    const listingId = str(v['listingId']);
    out.push({
      id: String(v['id']),
      plate,
      makeText: str(v['makeText']),
      modelText: str(v['modelText']),
      year: int(v['year']) as number,
      listingId: listingId !== null && UUID.test(listingId) ? listingId : null,
    });
  }
  return out;
}

export function listingsOf(
  reply: ApiResult,
): { listings: ListingView[]; market: MarketView; photoUploads: PhotoUploadsView } | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['listings'])) {
    return null;
  }
  const market = marketOf(reply.json['market']);
  const photoUploads = photoUploadsOf(reply.json['photoUploads']);
  if (market === null || photoUploads === null) return null;
  const listings: ListingView[] = [];
  for (const l of reply.json['listings'] as unknown[]) {
    if (!isObj(l) || !UUID.test(String(l['id'])) || !UUID.test(String(l['vehicleId']))) return null;
    const price = str(l['dailyPriceMinor']);
    if (price === null || !MINOR.test(price)) return null;
    const extra = l['extraKmPriceMinor'] ?? null;
    if (extra !== null && (typeof extra !== 'string' || !MINOR.test(extra))) return null;
    listings.push({
      id: String(l['id']),
      vehicleId: String(l['vehicleId']),
      status: String(l['status']),
      dailyPriceMinor: BigInt(price),
      currency: String(l['currency']),
      mileageMode: String(l['mileageMode']),
      includedKmPerDay: int(l['includedKmPerDay']),
      extraKmPriceMinor: extra === null ? null : BigInt(extra),
      photos: int(l['photos']) ?? 0,
    });
  }
  return { listings, market, photoUploads };
}

export interface PublicListingView {
  readonly id: string;
  /** Pays de l'annonce (avertissements réglementaires du pays, US-125). */
  readonly country: string;
  readonly dailyPriceMinor: bigint;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly mileageMode: string;
  readonly includedKmPerDay: number | null;
  readonly instantBook: boolean;
  readonly makeName: string;
  readonly modelName: string;
  readonly year: number;
  readonly transmission: string;
  readonly seats: number;
  readonly fuelType: string;
  readonly city: string;
  readonly areaLabel: string | null;
}

/** Fiche publique de `GET /listings/{id}` (colonnes C0 seulement) ; `null` si illisible. */
export function publicListingOf(reply: ApiResult): PublicListingView | null {
  if (reply.status !== 200 || !isObj(reply.json) || !isObj(reply.json['listing'])) return null;
  const l = reply.json['listing'];
  const price = str(l['dailyPriceMinor']);
  const exponent = int(l['currencyExponent']);
  const currency = str(l['currency']);
  const year = int(l['year']);
  const seats = int(l['seats']);
  const country = str(l['country']);
  if (
    !UUID.test(String(l['id'])) ||
    country === null ||
    !/^[A-Z]{2}$/.test(country) ||
    price === null ||
    !MINOR.test(price) ||
    exponent === null ||
    currency === null ||
    !/^[A-Z]{3}$/.test(currency) ||
    year === null ||
    seats === null ||
    str(l['makeName']) === null ||
    str(l['modelName']) === null ||
    str(l['city']) === null
  ) {
    return null;
  }
  return {
    id: String(l['id']),
    country,
    dailyPriceMinor: BigInt(price),
    currency,
    currencyExponent: exponent,
    mileageMode: String(l['mileageMode']),
    includedKmPerDay: int(l['includedKmPerDay']),
    instantBook: l['instantBook'] === true,
    makeName: String(l['makeName']),
    modelName: String(l['modelName']),
    year,
    transmission: String(l['transmission']),
    seats,
    fuelType: String(l['fuelType']),
    city: String(l['city']),
    areaLabel: str(l['areaLabel']),
  };
}

/**
 * Prix saisi dans la langue de la vue (« 40,00 », « 250.000 », « 1.234,50 ») → unités mineures
 * (chaîne d'entier), sans flottant : séparateur décimal de la locale, au plus `exponent` décimales
 * (aucune pour une devise sans décimale). Les séparateurs de groupes ne sont admis qu'à leur place
 * (groupes de trois chiffres) : une saisie ambiguë comme « 40.50 » dans une locale où « . » groupe
 * les milliers est REFUSÉE, jamais lue 4 050 (revue argent d'US-115). Saisie invalide : `null`.
 */
export function minorFromInput(
  raw: string,
  exponent: number,
  number: LocaleProfile['number'],
): string | null {
  // espaces (dont ins\u00e9cables) ramen\u00e9s \u00e0 une espace : s\u00e9parateur de groupes s'il en est un
  const text = raw.trim().replace(/[\s\u00a0\u202f]+/g, ' ');
  const group = /^[\s\u00a0\u202f]+$/.test(number.group) ? ' ' : number.group;
  const parts = text.split(number.decimal);
  if (parts.length > 2) return null;
  const [grouped = '', frac = ''] = parts;
  let whole = grouped;
  if (group !== '' && grouped.includes(group)) {
    const [head = '', ...rest] = grouped.split(group);
    if (!/^[0-9]{1,3}$/.test(head) || rest.some((g) => !/^[0-9]{3}$/.test(g))) return null;
    whole = [head, ...rest].join('');
  }
  if (!/^[0-9]{1,15}$/.test(whole) || !/^[0-9]*$/.test(frac) || frac.length > exponent) return null;
  if (parts.length === 2 && frac.length === 0) return null;
  const digits = `${whole}${frac.padEnd(exponent, '0')}`.replace(/^0+(?=.)/, '');
  return MINOR.test(digits) ? digits : null;
}

/** Unités mineures → saisie dans la langue de la vue (sans symbole, sans groupe, sans flottant). */
export function inputFromMinor(
  minor: bigint,
  exponent: number,
  number: LocaleProfile['number'],
): string {
  const digits = minor.toString().padStart(exponent + 1, '0');
  const cut = digits.length - exponent;
  return exponent === 0 ? digits : `${digits.slice(0, cut)}${number.decimal}${digits.slice(cut)}`;
}

/** Exemple de saisie d'un prix dans la langue de la vue (« 1.234,50 », « 250.000 »). */
export function priceExample(exponent: number, number: LocaleProfile['number']): string {
  if (exponent === 0) return `250${number.group}000`;
  return `1${number.group}234${number.decimal}${'50'.padEnd(exponent, '0').slice(0, exponent)}`;
}

/** Taille maximale d'une photo, dans la langue de la vue (« 75 kB »), arrondie vers le bas. */
export function formatPhotoMax(bytes: number, tag: string): string {
  return new Intl.NumberFormat(tag, {
    style: 'unit',
    unit: 'kilobyte',
    maximumFractionDigits: 0,
  }).format(Math.floor(bytes / 1000));
}

/** Clé de message rendue par l'API (`messageKey`), si elle existe dans le catalogue. */
export function messageKeyOf(reply: ApiResult): MessageKey | null {
  if (reply.status === 'unavailable' || !isObj(reply.json)) return null;
  const key = reply.json['messageKey'];
  return typeof key === 'string' && Object.hasOwn(CATALOGS.es.messages, key)
    ? (key as MessageKey)
    : null;
}

/** Champs refusés (`fields`) d'une réponse 400 de l'API (noms seulement, jamais de valeur). */
export function fieldsOf(reply: ApiResult): { field: string; reason: string }[] {
  if (reply.status === 'unavailable' || !isObj(reply.json)) return [];
  const f = reply.json['fields'];
  if (!Array.isArray(f)) return [];
  return f
    .filter((x): x is Obj => isObj(x) && typeof x['field'] === 'string')
    .map((x) => ({ field: String(x['field']), reason: String(x['reason']) }));
}
