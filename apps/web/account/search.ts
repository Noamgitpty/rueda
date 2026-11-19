/**
 * Recherche publique (US-201, US-203) côté SERVEUR du site : lecture défensive des réponses de
 * `GET /search/areas` et `GET /search` (cartes : total TTC du devis, jours facturés, caution de la
 * plateforme, note, point approximatif), et saisie du formulaire de S01 (lieu choisi dans la liste
 * des zones déclarées par les hôtes, date et heure de départ et de retour au pas de 30 min, dans
 * le fuseau du lieu). Toute réponse mal formée est refusée (`null`) : l'écran affiche alors son
 * état d'erreur, jamais une donnée partielle. Aucune constante de pays, de devise ni de fuseau :
 * ils viennent de l'API.
 */
import type { MessageKey } from '@rueda/i18n';
import type { ApiResult } from './api-client.ts';
import { codeOf } from './api-client.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[03]0$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Heure locale du lieu, à la minute, au pas de 30 min (forme de l'API). */
export const LOCAL_SLOT = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[03]0$/;
const PLACE_MAX = 120;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) ? v : null;

/** Créneaux du sélecteur d'heure : 00:00 à 23:30, pas de 30 min (16 SRC-001, BR-BOOK-03). */
export const TIME_SLOTS: readonly string[] = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
);

export interface SearchAreaView {
  readonly country: string;
  readonly city: string;
  readonly area: string | null;
  readonly timezone: string;
}

/** Note publique d'une annonce (16 REV-010) ; absente : badge « Nuevo ». */
export interface SearchRatingView {
  /** Moyenne ×100 (100 à 500), `null` sans avis publié. */
  readonly averageX100: number | null;
  readonly reviewCount: number;
  readonly tripCount: number;
}

export interface SearchResultView {
  readonly id: string;
  readonly dailyPriceMinor: bigint;
  /** Total TTC du séjour (devis provisoire de l'API, jamais recalculé ici ; 16 SRC-042). */
  readonly totalMinor: bigint;
  readonly billableDays: number;
  /** Caution annoncée : montant si `depositStatus` = `REQUIRED`, sinon `null` (16 SRC-011, T70 c). */
  readonly depositAmountMinor: bigint | null;
  /** Mention générique, montant ou caution non disponible (US-701c, 10b UX-21). */
  readonly depositStatus: DepositNoticeStatus;
  readonly rating: SearchRatingView | null;
  /**
   * La base promet la protection de l'assureur partenaire (US-205b) : seule condition de la
   * mention « protection incluse » de la carte ; absente ou autre qu'un booléen ⇒ `false`.
   */
  readonly protectionOffered: boolean;
  /** Point arrondi au centième de degré (zone approximative), ou `null` sans épingle. */
  readonly point: { readonly lat: number; readonly lng: number } | null;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly instantBook: boolean;
  readonly makeName: string;
  readonly modelName: string;
  readonly year: number;
  readonly city: string;
  readonly areaLabel: string | null;
  readonly timezone: string;
  readonly startAt: string;
  readonly endAt: string;
}

/** Zones de `GET /search/areas` ; `null` si la réponse est illisible. */
export function searchAreasOf(reply: ApiResult): SearchAreaView[] | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['areas'])) {
    return null;
  }
  const out: SearchAreaView[] = [];
  for (const a of reply.json['areas']) {
    if (!isObj(a)) return null;
    const country = str(a['country']);
    const city = str(a['city']);
    const timezone = str(a['timezone']);
    const area = a['area'] === null ? null : str(a['area']);
    if (
      country === null ||
      !/^[A-Z]{2}$/.test(country) ||
      city === null ||
      city === '' ||
      timezone === null ||
      timezone === '' ||
      (a['area'] !== null && area === null)
    ) {
      return null;
    }
    out.push({ country, city, area, timezone });
  }
  return out;
}

/**
 * Caution annoncée avant le checkout (US-701c ; 08 BR-PAY-06 T70 c ; 10b UX-21) : `GENERIC`
 * (mention générique), `REQUIRED` (montant) ou `UNAVAILABLE` (caution non disponible pour ce
 * véhicule : le paiement la refusera, même texte que S05).
 */
export type DepositNoticeStatus = 'GENERIC' | 'REQUIRED' | 'UNAVAILABLE';

/**
 * Statut de la caution d'une réponse, cohérent avec son montant : `REQUIRED` ⇔ montant ≥ 1 ;
 * statut absent (API N-1, avant US-701c) ⇒ déduit du montant ; autre forme ⇒ `undefined`
 * (réponse illisible, rien n'est promis).
 */
export function depositStatusOf(
  status: unknown,
  amount: bigint | null,
): DepositNoticeStatus | undefined {
  if (status === undefined) return amount === null ? 'GENERIC' : 'REQUIRED';
  if (status === 'REQUIRED') return amount !== null && amount >= 1n ? 'REQUIRED' : undefined;
  if (status === 'GENERIC' || status === 'UNAVAILABLE') return amount === null ? status : undefined;
  return undefined;
}

const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/** Point approximatif : `null` (sans épingle) ou coordonnées dans les bornes ; `undefined` : illisible. */
function pointOf(v: unknown): { lat: number; lng: number } | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  const lat = finite(v['lat']);
  const lng = finite(v['lng']);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined;
  return { lat, lng };
}

/** Note : `null` (aucun avis) ou entiers dans les bornes ; `undefined` : illisible. */
function ratingOf(v: unknown): SearchRatingView | null | undefined {
  if (v === null) return null;
  if (!isObj(v)) return undefined;
  const reviews = int(v['reviewCount']);
  const trips = int(v['tripCount']);
  const avg = v['averageX100'] === null ? null : int(v['averageX100']);
  if (reviews === null || reviews < 0 || trips === null || trips < 0) return undefined;
  if (v['averageX100'] !== null && (avg === null || avg < 100 || avg > 500)) return undefined;
  if ((avg === null) !== (reviews === 0)) return undefined;
  return { averageX100: avg, reviewCount: reviews, tripCount: trips };
}

/** Résultats de `GET /search` ; `null` si la réponse est illisible. */
export function searchResultsOf(reply: ApiResult): SearchResultView[] | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['results'])) {
    return null;
  }
  const out: SearchResultView[] = [];
  for (const r of reply.json['results']) {
    if (!isObj(r)) return null;
    const price = str(r['dailyPriceMinor']);
    const exponent = int(r['currencyExponent']);
    const currency = str(r['currency']);
    const year = int(r['year']);
    const startAt = str(r['startAt']);
    const endAt = str(r['endAt']);
    const timezone = str(r['timezone']);
    const total = str(r['totalMinor']);
    const days = int(r['billableDays']);
    const deposit = r['depositAmountMinor'] === null ? null : str(r['depositAmountMinor']);
    const point = pointOf(r['approximatePoint']);
    const rating = ratingOf(r['rating']);
    const depositStatus = depositStatusOf(
      r['depositStatus'],
      deposit === null || !MINOR.test(deposit) ? null : BigInt(deposit),
    );
    if (
      total === null ||
      !MINOR.test(total) ||
      days === null ||
      days < 1 ||
      (r['depositAmountMinor'] !== null && (deposit === null || !MINOR.test(deposit))) ||
      depositStatus === undefined ||
      point === undefined ||
      rating === undefined ||
      !UUID.test(String(r['id'])) ||
      price === null ||
      !MINOR.test(price) ||
      exponent === null ||
      currency === null ||
      !/^[A-Z]{3}$/.test(currency) ||
      year === null ||
      str(r['makeName']) === null ||
      str(r['modelName']) === null ||
      str(r['city']) === null ||
      timezone === null ||
      timezone === '' ||
      startAt === null ||
      !INSTANT.test(startAt) ||
      endAt === null ||
      !INSTANT.test(endAt)
    ) {
      return null;
    }
    out.push({
      id: String(r['id']),
      dailyPriceMinor: BigInt(price),
      totalMinor: BigInt(total),
      billableDays: days,
      depositAmountMinor: deposit === null ? null : BigInt(deposit),
      depositStatus,
      rating,
      // fail-closed : seul `true` exact promet la couverture
      protectionOffered: r['protectionOffered'] === true,
      point,
      currency,
      currencyExponent: exponent,
      instantBook: r['instantBook'] === true,
      makeName: String(r['makeName']),
      modelName: String(r['modelName']),
      year,
      city: String(r['city']),
      areaLabel: str(r['areaLabel']),
      timezone,
      startAt,
      endAt,
    });
  }
  return out;
}

/** Valeur d'option du lieu : pays, ville et zone (zone nulle : toute la ville). */
export function placeValue(a: { country: string; city: string; area: string | null }): string {
  return JSON.stringify([a.country, a.city, a.area]);
}

export interface SearchPlace {
  readonly country: string;
  readonly city: string;
  readonly area: string | null;
}

/** Lieu reçu du formulaire ; `null` s'il est absent ou mal formé. */
export function placeOf(raw: unknown): SearchPlace | null {
  if (typeof raw !== 'string' || raw.length > 4 * PLACE_MAX) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(v) || v.length !== 3) return null;
  const [country, city, area] = v as unknown[];
  if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) return null;
  if (typeof city !== 'string' || city.trim() === '' || city.length > PLACE_MAX) return null;
  if (area !== null && (typeof area !== 'string' || area === '' || area.length > PLACE_MAX)) {
    return null;
  }
  return { country, city, area: area as string | null };
}

/** Recherche saisie : lieu et heures locales `AAAA-MM-JJTHH:MM`. */
export interface SearchInput extends SearchPlace {
  readonly start: string;
  readonly end: string;
}

export type SearchFormError = 'SEARCH_LOCATION_REQUIRED' | 'SEARCH_DATES_INVALID';

const one = (v: unknown): string | undefined =>
  typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;

/**
 * Paramètres du formulaire (`place`, `startDate`, `startTime`, `endDate`, `endTime`) → recherche.
 * Fin ≤ début (heures locales du même lieu) ⇒ `SEARCH_DATES_INVALID` (19 US-201 critère 1) ; le
 * début passé et la durée sont jugés par l'API (horloge de la base).
 */
export function searchInputOf(
  params: Readonly<Record<string, unknown>>,
):
  | { readonly ok: true; readonly input: SearchInput }
  | { readonly ok: false; readonly code: SearchFormError } {
  const place = placeOf(one(params['place']));
  if (place === null) return { ok: false, code: 'SEARCH_LOCATION_REQUIRED' };
  const sd = one(params['startDate']) ?? '';
  const st = one(params['startTime']) ?? '';
  const ed = one(params['endDate']) ?? '';
  const et = one(params['endTime']) ?? '';
  if (!DATE.test(sd) || !TIME.test(st) || !DATE.test(ed) || !TIME.test(et)) {
    return { ok: false, code: 'SEARCH_DATES_INVALID' };
  }
  const start = `${sd}T${st}`;
  const end = `${ed}T${et}`;
  if (end <= start) return { ok: false, code: 'SEARCH_DATES_INVALID' };
  return { ok: true, input: { ...place, start, end } };
}

/** Chemin de l'API pour une recherche saisie. */
export function searchApiPath(input: SearchInput): string {
  const p = new URLSearchParams({
    country: input.country,
    city: input.city,
    start: input.start,
    end: input.end,
  });
  if (input.area !== null) p.set('area', input.area);
  return `/search?${p.toString()}`;
}

/** Lien vers la fiche avec les dates reprises (19 US-201 critère 2 ; 16 LST-006). */
export function listingHref(id: string, input: { start: string; end: string }): string {
  return `/listings/${id}?${new URLSearchParams({ start: input.start, end: input.end }).toString()}`;
}

/** Paramètres du formulaire de S01 pour revenir à la même recherche depuis la fiche. */
export function searchHref(input: SearchInput): string {
  const [sd, st] = input.start.split('T') as [string, string];
  const [ed, et] = input.end.split('T') as [string, string];
  return `/search?${new URLSearchParams({
    place: placeValue(input),
    startDate: sd,
    startTime: st,
    endDate: ed,
    endTime: et,
  }).toString()}`;
}

/** Heures locales reprises sur la fiche (`?start=&end=`) ; `null` si absentes ou mal formées. */
export function listingDatesOf(
  params: Readonly<Record<string, unknown>>,
): { readonly start: string; readonly end: string } | null {
  const start = one(params['start']);
  const end = one(params['end']);
  if (start === undefined || end === undefined) return null;
  if (!LOCAL_SLOT.test(start) || !LOCAL_SLOT.test(end) || end <= start) return null;
  return { start, end };
}

/** Instant fictif en UTC portant l'heure LOCALE saisie : formaté avec le fuseau `UTC`. */
export function wallClock(local: string): string {
  return `${local}:00.000Z`;
}

const ERROR_KEYS: Readonly<Record<string, MessageKey>> = {
  SEARCH_LOCATION_REQUIRED: 'common.search.locationRequired',
  SEARCH_DATES_INVALID: 'common.search.datesInvalid',
  SEARCH_DURATION_EXCEEDED: 'common.search.durationExceeded',
  RATE_LIMITED: 'common.rateLimit.retryLater',
};

/** Message d'un refus de la recherche ; indisponible par défaut. */
export function searchErrorKey(reply: ApiResult | SearchFormError): MessageKey {
  const code = typeof reply === 'string' ? reply : codeOf(reply);
  return (code !== null ? ERROR_KEYS[code] : undefined) ?? 'common.search.unavailable';
}
