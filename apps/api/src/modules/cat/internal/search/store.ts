/**
 * Port de lecture de la recherche publique (US-201, US-203) et son adaptateur PostgreSQL :
 * fonctions `core.catalog_public_cards` de 0105 (la recherche de 0103 inchangée, plus la
 * caution et l'instant du devis) et `core.catalog_public_areas` de 0103 (SECURITY DEFINER,
 * EXECUTE app_api), paramètres liés. Dates de la fiche (US-204) : `core.catalog_public_slot_check`
 * de 0106 et le pays de l'annonce lu par `core.catalog_public_listing` (0067). Lecture seule : aucune écriture, aucune session.
 *
 * Ce que rend le port (C0 seulement, comme la fiche publique d'US-115) : prix par jour, véhicule,
 * ville, zone saisie par l'hôte, point arrondi au centième de degré, fuseau et instants UTC de la
 * période ; caution de la plateforme du pays et de la classe (montant seul, jamais la classe ni
 * les déclencheurs, BR-PAY-06) ; jamais le nom ni l'adresse du lieu, son point exact, la plaque,
 * le VIN, le compte d'hôte ni l'occupation (L1-PM-19, L2-PM-29).
 */
import type { FuelType, LocationKind, Transmission } from '../host-listings/model.js';
import type { SqlExecutor } from '../host-listings/store.js';
import type { SearchQuery } from './model.js';

/** Ville et zone de remise d'au moins une annonce cherchable, avec le fuseau du pays. */
export interface SearchArea {
  readonly country: string;
  readonly city: string;
  readonly area: string | null;
  readonly timezone: string;
}

/** Annonce disponible sur la période cherchée (colonnes C0). */
export interface SearchResult {
  readonly id: string;
  readonly dailyPriceMinor: string;
  readonly currency: string;
  /** Exposant de la devise (config_currency) : affichage sans constante de devise. */
  readonly currencyExponent: number;
  readonly instantBook: boolean;
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
  /** Fuseau IANA du véhicule : les heures s'affichent dans ce fuseau (critère 3). */
  readonly timezone: string;
  /** Début et fin de la période, instants UTC (ISO 8601). */
  readonly startAt: string;
  readonly endAt: string;
  /**
   * Caution par carte de la plateforme (`deposit_policy` du pays et de la classe du véhicule, en
   * vigueur, même devise, > 0 ; 16 SRC-011, T70 c), unités mineures ; `null` : aucune caution
   * annoncée avant le checkout, mention générique (US-203).
   */
  readonly depositAmountMinor: string | null;
  /** `platform.now()` de la lecture (instant du devis provisoire), ISO 8601 UTC (US-203). */
  readonly quotedAt: string;
}

export type SearchRefusal =
  | 'SEARCH_LOCATION_REQUIRED'
  | 'SEARCH_DATES_INVALID'
  | 'SEARCH_DURATION_EXCEEDED'
  | 'SEARCH_UNAVAILABLE';

export type SearchOutcome =
  | { readonly outcome: 'OK'; readonly results: readonly SearchResult[] }
  | { readonly outcome: SearchRefusal };

/**
 * Dates choisies sur la fiche d'une annonce (US-204 ; 16 LST-006) : heures LOCALES du lieu, au pas
 * de 30 min, jugées par `core.catalog_public_slot_check` (0106) : refus de la recherche, préavis
 * du lieu, hôte activable et sonde de disponibilité avec le tampon.
 */
export interface SlotQuery {
  readonly listingId: string;
  readonly startLocal: string;
  readonly endLocal: string;
}

export type SlotRefusal =
  | 'LISTING_NOT_FOUND'
  | 'SEARCH_DATES_INVALID'
  | 'SEARCH_DURATION_EXCEEDED'
  | 'SEARCH_UNAVAILABLE'
  | 'DATES_UNAVAILABLE';

export type SlotOutcome =
  | {
      readonly outcome: 'OK';
      /** Instants UTC (ISO 8601) dans le fuseau du véhicule, et ce fuseau. */
      readonly startAt: string;
      readonly endAt: string;
      readonly timezone: string;
    }
  | {
      readonly outcome: 'DATES_NOTICE_TOO_SHORT';
      /** Préavis en vigueur du lieu, en minutes (le voyageur sait quoi changer). */
      readonly noticeMinutes: number;
    }
  | { readonly outcome: SlotRefusal };

export interface SearchStore {
  /** Zones proposées ; `country` nul : tous les pays. */
  areas(country: string | null): Promise<SearchArea[]>;
  search(query: SearchQuery): Promise<SearchOutcome>;
  /**
   * Pays d'une annonce LISTED (fiche publique d'US-115), pour la limite de la sonde de ce pays ;
   * `null` si inconnue ou non publiée (US-204).
   */
  listingCountry(listingId: string): Promise<string | null>;
  /**
   * Prix journalier, devise de l'annonce LISTED et instant du devis (`platform.now()`), pour le
   * total TTC de la fiche (US-208, même devis provisoire que la recherche) ; `null` si inconnue.
   */
  listingPrice(listingId: string): Promise<ListingPrice | null>;
  /** Contrôle des dates de la fiche (US-204) ; une issue, jamais une exception métier. */
  slotCheck(query: SlotQuery): Promise<SlotOutcome>;
}

/** Prix de l'annonce pour le devis provisoire de la fiche (US-208). */
export interface ListingPrice {
  readonly currency: string;
  /** Prix journalier (texte d'un entier, unités mineures). */
  readonly dailyPriceMinor: string;
  /** Instant du devis lu en base (ISO 8601 UTC). */
  readonly quotedAt: string;
}

export class SearchStoreError extends Error {
  override readonly name = 'SearchStoreError';
  readonly sqlstate: string | undefined;
  constructor(operation: string, sqlstate: string | undefined) {
    super(`CAT : échec de la recherche (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Magasin indisponible (aucun adaptateur fourni) : toute route répond 503 (fail-closed). */
export class UnavailableSearchStore implements SearchStore {
  #fail(): Promise<never> {
    return Promise.reject(new SearchStoreError('magasin indisponible', undefined));
  }
  areas = (): Promise<SearchArea[]> => this.#fail();
  search = (): Promise<SearchOutcome> => this.#fail();
  listingCountry = (): Promise<string | null> => this.#fail();
  listingPrice = (): Promise<ListingPrice | null> => this.#fail();
  slotCheck = (): Promise<SlotOutcome> => this.#fail();
}

const SLOT_REFUSALS: ReadonlySet<string> = new Set<SlotRefusal>([
  'LISTING_NOT_FOUND',
  'SEARCH_DATES_INVALID',
  'SEARCH_DURATION_EXCEEDED',
  'SEARCH_UNAVAILABLE',
  'DATES_UNAVAILABLE',
]);

const REFUSALS: ReadonlySet<string> = new Set<SearchRefusal>([
  'SEARCH_LOCATION_REQUIRED',
  'SEARCH_DATES_INVALID',
  'SEARCH_DURATION_EXCEEDED',
  'SEARCH_UNAVAILABLE',
]);

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? ((error as { code: string }).code as string)
    : undefined;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();

export class PgSearchStore implements SearchStore {
  constructor(private readonly db: SqlExecutor) {}

  async #rows(operation: string, sql: string, values: readonly unknown[]) {
    try {
      return (await this.db.query<Record<string, unknown>>(sql, values)).rows;
    } catch (error) {
      throw new SearchStoreError(operation, sqlstateOf(error));
    }
  }

  async areas(country: string | null): Promise<SearchArea[]> {
    const rows = await this.#rows('zones', 'SELECT * FROM core.catalog_public_areas($1::text)', [
      country,
    ]);
    return rows.map((r) => ({
      country: String(r['country_code']),
      city: String(r['city']),
      area: str(r['area_label']),
      timezone: String(r['timezone']),
    }));
  }

  async search(q: SearchQuery): Promise<SearchOutcome> {
    const rows = await this.#rows(
      'recherche',
      `SELECT s.*, c.exponent::int AS currency_exponent
         FROM core.catalog_public_cards($1::text, $2::text, $3::text, $4::timestamp,
                                               $5::timestamp, $6::integer)
                WITH ORDINALITY AS s
         LEFT JOIN core.config_currency AS c ON c.code::text = s.currency
        ORDER BY s.ordinality`,
      [q.country, q.city, q.area, q.startLocal, q.endLocal, q.limit],
    );
    const first = rows[0];
    if (rows.length === 1 && first !== undefined && first['outcome'] !== 'OK') {
      const code = String(first['outcome']);
      // issue inconnue (version N de la base pendant un déploiement) : indisponible, fail-closed
      if (!REFUSALS.has(code)) throw new SearchStoreError(`issue ${code}`, undefined);
      return { outcome: code as SearchRefusal };
    }
    return {
      outcome: 'OK',
      results: rows.map((r) => {
        if (r['outcome'] !== 'OK' || r['currency_exponent'] === null || r['quoted_at'] === null) {
          throw new SearchStoreError('ligne inattendue', undefined);
        }
        const lat = num(r['geo_public_lat']);
        const lng = num(r['geo_public_lng']);
        return {
          id: String(r['listing_id']),
          dailyPriceMinor: String(r['daily_price_minor']),
          currency: String(r['currency']),
          currencyExponent: Number(r['currency_exponent']),
          instantBook: r['instant_book'] === true,
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
          startAt: iso(r['start_at']),
          endAt: iso(r['end_at']),
          depositAmountMinor: str(r['deposit_amount_minor']),
          quotedAt: iso(r['quoted_at']),
        };
      }),
    };
  }
  async listingCountry(listingId: string): Promise<string | null> {
    const rows = await this.#rows(
      'pays de l’annonce',
      'SELECT p.country_code FROM core.catalog_public_listing($1::uuid) AS p',
      [listingId],
    );
    return str(rows[0]?.['country_code']);
  }

  async listingPrice(listingId: string): Promise<ListingPrice | null> {
    const rows = await this.#rows(
      'prix de l’annonce',
      `SELECT p.currency, p.daily_price_minor::text AS daily_price_minor, platform.now() AS quoted_at
         FROM core.catalog_public_listing($1::uuid) AS p`,
      [listingId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    const currency = str(r['currency']);
    const daily = str(r['daily_price_minor']);
    if (currency === null || daily === null || r['quoted_at'] === null) {
      throw new SearchStoreError('ligne inattendue', undefined);
    }
    return { currency, dailyPriceMinor: daily, quotedAt: iso(r['quoted_at']) };
  }

  async slotCheck(q: SlotQuery): Promise<SlotOutcome> {
    const rows = await this.#rows(
      'dates de la fiche',
      'SELECT * FROM core.catalog_public_slot_check($1::uuid, $2::timestamp, $3::timestamp)',
      [q.listingId, q.startLocal, q.endLocal],
    );
    const r = rows[0];
    if (rows.length !== 1 || r === undefined)
      throw new SearchStoreError('ligne inattendue', undefined);
    const code = String(r['outcome']);
    if (code === 'OK') {
      if (r['start_at'] === null || r['end_at'] === null || r['timezone'] === null) {
        throw new SearchStoreError('ligne inattendue', undefined);
      }
      return {
        outcome: 'OK',
        startAt: iso(r['start_at']),
        endAt: iso(r['end_at']),
        timezone: String(r['timezone']),
      };
    }
    if (code === 'DATES_NOTICE_TOO_SHORT') {
      const notice = num(r['notice_minutes']);
      if (notice === null || !Number.isInteger(notice) || notice < 0) {
        throw new SearchStoreError('ligne inattendue', undefined);
      }
      return { outcome: 'DATES_NOTICE_TOO_SHORT', noticeMinutes: notice };
    }
    // issue inconnue (version N de la base pendant un déploiement) : indisponible, fail-closed
    if (!SLOT_REFUSALS.has(code)) throw new SearchStoreError(`issue ${code}`, undefined);
    return { outcome: code as SlotRefusal };
  }
}
