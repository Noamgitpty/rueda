/**
 * Requête de la recherche publique (US-201 ; 16 SRC-001, bêta : lieu choisi dans la liste des
 * villes et zones déclarées par les hôtes, dates et heures au pas de 30 min dans le fuseau du
 * lieu). Validation de forme seulement : le pays, l'instant présent (`platform.now()`), la durée
 * maximale (`max_trip_days`) et le fuseau sont jugés par la base, qui fait foi (CLAUDE.md, point 5).
 *
 * Refus : pays ou ville absents ⇒ `SEARCH_LOCATION_REQUIRED` ; date ou heure absente, mal
 * formée, hors pas de 30 min, ou fin ≤ début (heures locales du même fuseau) ⇒
 * `SEARCH_DATES_INVALID` (19 US-201 critère 1) ; nombre de résultats hors de 1 à 50 ⇒
 * `REQUEST_INVALID`. Aucune constante de pays.
 */

/** Heure locale du lieu, à la minute : `AAAA-MM-JJTHH:MM` (pas de fuseau : celui du lieu). */
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
/** Longueur maximale d'une ville ou d'une zone saisie par un hôte (bornes de 0067). */
const PLACE_MAX = 120;
/** Résultats rendus au plus (la base borne aussi, de 1 à 50). */
export const SEARCH_LIMIT_MAX = 50;

export interface SearchQuery {
  readonly country: string;
  readonly city: string;
  /** Zone de la ville ; `null` : toute la ville. */
  readonly area: string | null;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly limit: number | null;
}

export type SearchQueryRefusal =
  'SEARCH_LOCATION_REQUIRED' | 'SEARCH_DATES_INVALID' | 'REQUEST_INVALID';

export type ParsedSearchQuery =
  | { readonly ok: true; readonly query: SearchQuery }
  | { readonly ok: false; readonly code: SearchQueryRefusal };

/** Pays au format de la configuration (deux lettres capitales), sinon `null`. */
export function countryOf(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Z]{2}$/.test(raw) ? raw : null;
}

function place(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return v.length > 0 && v.length <= PLACE_MAX ? v : null;
}

/** Heure locale valide au calendrier (29 février compris) et au pas de 30 min, sinon `null`. */
export function localSlot(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = LOCAL.exec(raw);
  if (m === null) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    date.getUTCHours() !== h ||
    mi % 30 !== 0
  ) {
    return null;
  }
  return raw;
}

export function parseSearchQuery(raw: Readonly<Record<string, unknown>>): ParsedSearchQuery {
  const country = countryOf(raw['country']);
  const city = place(raw['city']);
  if (country === null || city === null) return { ok: false, code: 'SEARCH_LOCATION_REQUIRED' };
  const area = raw['area'] === undefined || raw['area'] === '' ? null : place(raw['area']);
  if (raw['area'] !== undefined && raw['area'] !== '' && area === null) {
    return { ok: false, code: 'SEARCH_LOCATION_REQUIRED' };
  }
  const startLocal = localSlot(raw['start']);
  const endLocal = localSlot(raw['end']);
  // même format, même fuseau : l'ordre lexical est l'ordre chronologique
  if (startLocal === null || endLocal === null || endLocal <= startLocal) {
    return { ok: false, code: 'SEARCH_DATES_INVALID' };
  }
  let limit: number | null = null;
  if (raw['limit'] !== undefined) {
    const n =
      typeof raw['limit'] === 'string' && /^\d{1,2}$/.test(raw['limit'])
        ? Number(raw['limit'])
        : NaN;
    if (!(n >= 1 && n <= SEARCH_LIMIT_MAX)) return { ok: false, code: 'REQUEST_INVALID' };
    limit = n;
  }
  return { ok: true, query: { country, city, area, startLocal, endLocal, limit } };
}
