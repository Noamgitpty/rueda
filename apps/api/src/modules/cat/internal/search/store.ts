/**
 * Port de lecture de la recherche publique (US-201, US-203) et son adaptateur PostgreSQL :
 * fonctions `core.catalog_public_cards` de 0105 (la recherche de 0103 inchangée, plus la
 * caution et l'instant du devis) et `core.catalog_public_areas` de 0103 (SECURITY DEFINER,
 * EXECUTE app_api), paramètres liés. Dates de la fiche (US-204) : `core.catalog_public_slot_check`
 * de 0106 et le pays de l'annonce lu par `core.catalog_public_listing` (0067). Lecture seule : aucune écriture, aucune session.
 *
 * Ce que rend le port (C0 seulement, comme la fiche publique d'US-115) : prix par jour, véhicule,
 * ville, zone saisie par l'hôte, point arrondi au centième de degré, fuseau et instants UTC de la
 * période ; jamais le nom ni l'adresse du lieu, son point exact, la plaque, le VIN, le compte
 * d'hôte ni l'occupation (L1-PM-19, L2-PM-29). Caution annoncée avant le checkout (US-701c, T70 c,
 * ADR-173) : la base ne rend que sa BASE (pays, devise, classe de valeur, `depositBasis`) ; la
 * décision est celle de PAY (port `ListingDepositPolicy`) et la classe n'est jamais rendue au
 * visiteur. `deposit_amount_minor` de 0105 / 0118 (`catalog_deposit_policy`) n'est plus lu.
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
      /**
       * Conditions de l'annonce pour ce départ, lues DANS LA MÊME REQUÊTE que le contrôle des
       * dates (US-205b, revues de 205a : lecture atomique) ; `null` : annonce retirée entre-temps.
       */
      readonly terms: ListingTerms | null;
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
  /**
   * Contrôle des dates de la fiche (US-204) et, pour un créneau accepté, conditions de l'annonce
   * pour ce départ, en une seule requête (US-205b) ; une issue, jamais une exception métier.
   */
  slotCheck(query: SlotQuery): Promise<SlotOutcome>;
  /**
   * Conditions publiques d'une annonce LISTED (US-205, `core.catalog_public_terms` de 0115) pour
   * un départ (instant UTC) ou sans dates (`null`) ; `null` si inconnue ou non publiée.
   */
  terms(listingId: string, startAt: string | null): Promise<ListingTerms | null>;
  /**
   * Annonces dont la base promet la protection de l'assureur partenaire (US-205b : ligne
   * « protection incluse » des cartes seulement si la couverture est réelle, même règle que la
   * fiche) ; une seule requête pour les résultats d'une page.
   */
  protectionOffered(listingIds: readonly string[]): Promise<ReadonlySet<string>>;
  /**
   * Base de la caution annoncée avant le checkout (US-701c, `core.catalog_public_deposit_basis` de
   * 0149) : pays et classe de valeur du catalogue des annonces LISTED demandées (50 au plus) ; une
   * annonce absente de la réponse est inconnue ou retirée. Jamais rendue au visiteur.
   */
  depositBasis(listingIds: readonly string[]): Promise<ReadonlyMap<string, DepositBasis>>;
}

/** Ce que le véhicule permet de connaître de la caution (08 BR-PAY-06 : COUNTRY, CLASS). */
export interface DepositBasis {
  readonly country: string;
  /** `value_class` du catalogue, texte lu en base ; `null` : inconnue (fail-closed côté PAY). */
  readonly valueClass: string | null;
}

/** Niveaux de protection de la grille du pays (US-226, ADR-136), dans leur ordre de rang. */
export const PROTECTION_LEVELS = ['BASICA', 'ESTANDAR', 'TOTAL'] as const;
export type ProtectionLevel = (typeof PROTECTION_LEVELS)[number];
/** Langues des textes de l'assureur (les quatre langues du site, DEC-FONDATEUR-17, 18). */
export const TERMS_LANGUAGES = ['es', 'en', 'fr', 'pt-BR'] as const;
export type TermsLanguage = (typeof TERMS_LANGUAGES)[number];

/**
 * Protection de l'assureur partenaire promise sur la fiche (16 LST-013, PRT-003, PRT-013) :
 * conditions du contrat en vigueur du pays, recopiées telles quelles (mêmes sources que le contrat
 * de location, US-211). Absente dès que la base ne peut pas la promettre (19 US-205 critère 4).
 */
export interface ListingProtection {
  readonly insurerName: string;
  readonly insurerLicenseRef: string | null;
  readonly brokerName: string | null;
  readonly brokerLicenseRef: string | null;
  readonly contractVersion: number;
  /** RC tiers incluse par événement, unités mineures (texte d'un entier). */
  readonly rcAmountMinor: string;
  /** Franchise du voyageur par niveau, unités mineures (texte d'un entier). */
  readonly deductibles: Readonly<Record<ProtectionLevel, string>>;
  /** Exclusions principales, par langue. */
  readonly exclusions: Readonly<Record<TermsLanguage, string>>;
}

/** Conditions publiques d'une annonce (US-205), telles que la base les rend. */
export interface ListingTerms {
  readonly currency: string;
  readonly timezone: string;
  /** Paramètres d'annulation du pays (BR-CXL-01) ; `null` si absents (aucune promesse). */
  readonly cancellation: {
    readonly freeCancelLeadHours: number;
    readonly lastMinuteThresholdHours: number;
    /** Départ donné : réservation de dernière minute si elle avait lieu maintenant. */
    readonly lastMinute: boolean | null;
    /**
     * Départ donné : fin de l'annulation gratuite (ISO 8601 UTC) ; hors dernière minute, départ −
     * `free_cancel_lead` ; en dernière minute, min(maintenant + fenêtre, départ) (08 BR-CXL-01).
     */
    readonly freeUntil: string | null;
    /** Fenêtre de dernière minute du pays (`last_minute_free_window_minutes`), en minutes. */
    readonly lastMinuteWindowMinutes: number;
  } | null;
  readonly mileageMode: 'UNLIMITED' | 'INCLUDED';
  readonly includedKmPerDay: number | null;
  readonly extraKmPriceMinor: string | null;
  readonly protection: ListingProtection | null;
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
  terms = (): Promise<ListingTerms | null> => this.#fail();
  protectionOffered = (): Promise<ReadonlySet<string>> => this.#fail();
  depositBasis = (): Promise<ReadonlyMap<string, DepositBasis>> => this.#fail();
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
    // US-205b : contrôle des dates et conditions du départ accepté en UNE requête (revues de 205a,
    // architecture n° 5, code n° 6) : jamais des conditions d'un autre état de l'annonce
    const rows = await this.#rows(
      'dates de la fiche',
      // montants bigint rendus en TEXTE dans l'objet JSON (revue de code de 205b n° 2) : jamais un
      // nombre JSON arrondi au-delà de 2^53
      `SELECT s.*,
              CASE WHEN t.listing_id IS NULL THEN NULL
                   ELSE pg_catalog.to_jsonb(t.*) || pg_catalog.jsonb_build_object(
                          'extra_km_price_minor', t.extra_km_price_minor::text,
                          'rc_amount_minor', t.rc_amount_minor::text)
              END AS terms
         FROM core.catalog_public_slot_check($1::uuid, $2::timestamp, $3::timestamp) AS s
         LEFT JOIN LATERAL core.catalog_public_terms($1::uuid, s.start_at) AS t
                ON s.outcome = 'OK'`,
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
      const terms = r['terms'];
      if (terms !== null && (typeof terms !== 'object' || Array.isArray(terms))) {
        throw new SearchStoreError('ligne inattendue', undefined);
      }
      return {
        outcome: 'OK',
        startAt: iso(r['start_at']),
        endAt: iso(r['end_at']),
        timezone: String(r['timezone']),
        terms: terms === null ? null : termsOf(terms as Record<string, unknown>),
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
  async terms(listingId: string, startAt: string | null): Promise<ListingTerms | null> {
    const rows = await this.#rows(
      'conditions de l’annonce',
      'SELECT * FROM core.catalog_public_terms($1::uuid, $2::timestamptz)',
      [listingId, startAt],
    );
    const r = rows[0];
    if (r === undefined) return null;
    if (rows.length !== 1) throw new SearchStoreError('ligne inattendue', undefined);
    return termsOf(r);
  }

  async protectionOffered(listingIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (listingIds.length === 0) return new Set();
    const rows = await this.#rows(
      'protection des cartes',
      `SELECT t.listing_id, t.protection_offered
         FROM pg_catalog.unnest($1::uuid[]) AS u(id)
         CROSS JOIN LATERAL core.catalog_public_terms(u.id, NULL) AS t`,
      [listingIds],
    );
    const offered = new Set<string>();
    for (const r of rows) {
      if (r['protection_offered'] === true) offered.add(String(r['listing_id']));
      else if (r['protection_offered'] !== false) {
        throw new SearchStoreError('ligne inattendue', undefined);
      }
    }
    return offered;
  }

  async depositBasis(listingIds: readonly string[]): Promise<ReadonlyMap<string, DepositBasis>> {
    if (listingIds.length === 0) return new Map();
    const rows = await this.#rows(
      'base de la caution',
      'SELECT * FROM core.catalog_public_deposit_basis($1::uuid[])',
      [listingIds],
    );
    const out = new Map<string, DepositBasis>();
    for (const r of rows) {
      const country = str(r['country_code']);
      if (country === null) throw new SearchStoreError('ligne inattendue', undefined);
      out.set(String(r['listing_id']), { country, valueClass: str(r['value_class']) });
    }
    return out;
  }
}

const MINOR_TEXT = /^(0|[1-9][0-9]{0,17})$/;

/** Objet JSON dont les clés sont exactement `keys`, chaque valeur passant `ok` ; sinon `null`. */
function exactRecord<K extends string>(
  v: unknown,
  keys: readonly K[],
  ok: (x: unknown) => x is string,
): Record<K, string> | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== keys.length) return null;
  const out = {} as Record<K, string>;
  for (const k of keys) {
    const x = o[k];
    if (!ok(x)) return null;
    out[k] = x;
  }
  return out;
}

const isMinor = (x: unknown): x is string => typeof x === 'string' && MINOR_TEXT.test(x);

/**
 * Montant en unités mineures lu de la base : texte d'un entier, ou nombre entier SÛR (colonne
 * bigint rendue par le pilote) ; un nombre au-delà de 2^53 (arrondi) ou mal formé ⇒ erreur.
 */
function minorOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && !Number.isSafeInteger(v)) {
    throw new SearchStoreError('montant hors des entiers sûrs', undefined);
  }
  const t = String(v);
  if (!MINOR_TEXT.test(t)) throw new SearchStoreError('montant illisible', undefined);
  return t;
}
const isText = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';

/**
 * Ligne de `core.catalog_public_terms` vers le port : toute forme inattendue (version N de la base
 * pendant un déploiement) ⇒ erreur (503), jamais une promesse de couverture devinée.
 */
function termsOf(r: Record<string, unknown>): ListingTerms {
  const bad = (): never => {
    throw new SearchStoreError('ligne inattendue', undefined);
  };
  const lead = num(r['free_cancel_lead_hours']);
  const thr = num(r['last_minute_threshold_hours']);
  const win = num(r['last_minute_window_minutes']);
  const lastMinute = r['last_minute'];
  const freeUntil = r['free_until'];
  const cancellation =
    lead === null || thr === null || win === null
      ? null
      : {
          freeCancelLeadHours: lead,
          lastMinuteThresholdHours: thr,
          lastMinute: lastMinute === null || lastMinute === undefined ? null : lastMinute === true,
          freeUntil: freeUntil === null || freeUntil === undefined ? null : iso(freeUntil),
          lastMinuteWindowMinutes: win,
        };
  const mode = String(r['mileage_mode']);
  if (mode !== 'UNLIMITED' && mode !== 'INCLUDED') return bad();
  let protection: ListingProtection | null = null;
  if (r['protection_offered'] === true) {
    const deductibles = exactRecord(r['deductibles'], PROTECTION_LEVELS, isMinor);
    const exclusions = exactRecord(r['exclusions'], TERMS_LANGUAGES, isText);
    const rc = minorOrNull(r['rc_amount_minor']);
    const version = num(r['contract_version']);
    if (
      deductibles === null ||
      exclusions === null ||
      rc === null ||
      !MINOR_TEXT.test(rc) ||
      version === null ||
      typeof r['insurer_name'] !== 'string'
    ) {
      return bad();
    }
    protection = {
      insurerName: r['insurer_name'],
      insurerLicenseRef: str(r['insurer_license_ref']),
      brokerName: str(r['broker_name']),
      brokerLicenseRef: str(r['broker_license_ref']),
      contractVersion: version,
      rcAmountMinor: rc,
      deductibles,
      exclusions,
    };
  } else if (r['protection_offered'] !== false) {
    return bad();
  }
  return {
    currency: String(r['currency']),
    timezone: String(r['timezone']),
    cancellation,
    mileageMode: mode,
    includedKmPerDay: num(r['included_km_per_day']),
    extraKmPriceMinor: minorOrNull(r['extra_km_price_minor']),
    protection,
  };
}
