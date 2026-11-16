/**
 * Service de la recherche publique (US-201, US-203) : forme de la requête (`model.ts`), sonde de
 * disponibilité limitée par IP (`availability_probe_per_minute`, 17 §2.3, BOARD N-78), puis la
 * base, qui juge le pays, l'instant présent, la durée, le préavis et la disponibilité, et rend la
 * caution de chaque annonce. Chaque résultat reçoit ensuite son total TTC du devis provisoire
 * (port `SearchPricer`, moteur de PRC : le même chiffre en liste, sur la carte, sur la fiche et au
 * checkout) et sa note (port `SearchRatings`). Issues de la base vers codes stables
 * (`errors.ts`) ; base, limiteur, prix ou notes indisponibles : 503 (fail-closed).
 */
import { LOG_QUOTE_UNAVAILABLE, NO_SEARCH_RATINGS, UNAVAILABLE_SEARCH_PRICER } from './cards.js';
import type {
  QuoteUnavailableAlert,
  SearchCard,
  SearchPrice,
  SearchPricer,
  SearchRating,
  SearchRatings,
} from './cards.js';
import { SearchHttpError } from './errors.js';
import { countryOf, localSlot, parseSearchQuery } from './model.js';
import type {
  ListingProtection,
  ListingTerms,
  SearchArea,
  SearchResult,
  SearchStore,
} from './store.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Total TTC du créneau (US-208) : devis provisoire, le même que la recherche et le checkout. */
export interface ListingSlotPrice {
  readonly totalMinor: string;
  readonly currency: string;
  readonly billableDays: number;
}

/**
 * Créneau accepté sur la fiche (US-204) : instants UTC et fuseau du véhicule ; total TTC du devis
 * provisoire (US-208), `null` si aucun devis n'est possible (alerte ops, comme la recherche).
 */
export interface ListingSlot {
  readonly startAt: string;
  readonly endAt: string;
  readonly timezone: string;
  readonly price: ListingSlotPrice | null;
  /**
   * Annulation gratuite pour ce départ si la réservation avait lieu maintenant (US-205 critère 1 ;
   * BR-CXL-01 calculé par la base à `platform.now()`) ; `null` : paramètres du pays absents.
   */
  readonly cancellation: SlotCancellation | null;
  /** Distance incluse sur la période (US-205 critère 2 ; 16 LST-012). */
  readonly mileage: SlotMileage;
}

/** `freeUntil` de BR-CXL-01 : date limite, ou « 1 h après la réservation » (dernière minute). */
export interface SlotCancellation {
  readonly lastMinute: boolean;
  /** Fin de l'annulation gratuite (ISO 8601 UTC) ; `null` en dernière minute. */
  readonly freeUntil: string | null;
  /** Durée de la fenêtre de dernière minute (08 BR-CXL-01 : 60 min), en minutes. */
  readonly lastMinuteWindowMinutes: number;
}

/**
 * Distance incluse : km par jour × jours facturables du devis provisoire (le même que le total) ;
 * `includedKm` nul si illimité ou sans devis ; prix du km supplémentaire de l'annonce.
 */
export interface SlotMileage {
  readonly mode: 'UNLIMITED' | 'INCLUDED';
  readonly includedKmPerDay: number | null;
  readonly includedKm: number | null;
  readonly extraKmPriceMinor: string | null;
}

/** Fenêtre de dernière minute de 08 BR-CXL-01 (« 1 h après `booked_at` »), en minutes. */
export const LAST_MINUTE_WINDOW_MINUTES = 60;

/**
 * Conditions de la fiche sans dates (US-205 ; `GET /listings/{id}/conditions`) : politique
 * d'annulation du pays, caution de la plateforme, protection de l'assureur partenaire.
 */
export interface ListingConditions {
  readonly currency: string;
  readonly timezone: string;
  readonly cancellation: {
    readonly freeCancelLeadHours: number;
    readonly lastMinuteThresholdHours: number;
    readonly lastMinuteWindowMinutes: number;
  } | null;
  readonly deposit: { readonly amountMinor: string } | null;
  readonly protection: ListingProtection | null;
}

/**
 * Limite de la sonde de disponibilité, par IP (port satisfait par la garde anti-abus de RISK,
 * câblée par `main.ts` : CAT ne dépend pas de RISK). `null` : sonde admise ; sinon délai de
 * reprise en secondes. Une erreur vaut « indisponible ».
 */
export interface AvailabilityProbeLimiter {
  hit(ip: string, country: string): Promise<number | null>;
}

/** Aucun limiteur fourni : toute recherche avec dates est refusée (503, fail-closed). */
export const UNAVAILABLE_PROBE_LIMITER: AvailabilityProbeLimiter = {
  hit: () => Promise.reject(new Error('limiteur de la sonde indisponible')),
};

/** Colonnes C0 du résultat, sans l'instant du devis (interne à l'API). */
function withoutQuotedAt(res: SearchResult): Omit<SearchResult, 'quotedAt'> {
  const c0: { -readonly [K in keyof SearchResult]?: SearchResult[K] } = { ...res };
  delete c0.quotedAt;
  return c0 as Omit<SearchResult, 'quotedAt'>;
}

export class SearchService {
  constructor(
    private readonly store: SearchStore,
    private readonly probe: AvailabilityProbeLimiter,
    private readonly pricer: SearchPricer = UNAVAILABLE_SEARCH_PRICER,
    private readonly reviews: SearchRatings = NO_SEARCH_RATINGS,
    private readonly alertQuoteUnavailable: QuoteUnavailableAlert = LOG_QUOTE_UNAVAILABLE,
  ) {}

  async areas(rawCountry: unknown): Promise<SearchArea[]> {
    const country = rawCountry === undefined ? null : countryOf(rawCountry);
    if (rawCountry !== undefined && country === null) throw new SearchHttpError('REQUEST_INVALID');
    try {
      return await this.store.areas(country);
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
  }

  async search(raw: Readonly<Record<string, unknown>>, ip: string): Promise<SearchCard[]> {
    const parsed = parseSearchQuery(raw);
    if (!parsed.ok) throw new SearchHttpError(parsed.code);
    let retryAfterS: number | null;
    try {
      retryAfterS = await this.probe.hit(ip, parsed.query.country);
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
    if (retryAfterS !== null) throw new SearchHttpError('RATE_LIMITED', Math.max(1, retryAfterS));
    let r;
    try {
      r = await this.store.search(parsed.query);
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
    if (r.outcome !== 'OK') throw new SearchHttpError(r.outcome);
    return this.#cards(parsed.query.country, r.results);
  }

  /**
   * Dates choisies sur la fiche d'une annonce (US-204 ; 16 LST-006) : forme (heures locales au pas
   * de 30 min, fin après le début), pays de l'annonce, limite de la sonde de ce pays, puis la base
   * (instant présent, durée, préavis du lieu, hôte activable, disponibilité avec le tampon).
   * Identifiant mal formé ou annonce non publiée ⇒ 404 ; base ou limiteur en panne ⇒ 503.
   */
  async slot(
    listingId: string,
    raw: Readonly<Record<string, unknown>>,
    ip: string,
  ): Promise<ListingSlot> {
    if (!UUID.test(listingId)) throw new SearchHttpError('LISTING_NOT_FOUND');
    const startLocal = localSlot(raw['start']);
    const endLocal = localSlot(raw['end']);
    // même format, même fuseau : l'ordre lexical est l'ordre chronologique
    if (startLocal === null || endLocal === null || endLocal <= startLocal) {
      throw new SearchHttpError('SEARCH_DATES_INVALID');
    }
    const id = listingId.toLowerCase();
    let country: string | null;
    try {
      country = await this.store.listingCountry(id);
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
    if (country === null) throw new SearchHttpError('LISTING_NOT_FOUND');
    let retryAfterS: number | null;
    try {
      retryAfterS = await this.probe.hit(ip, country);
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
    if (retryAfterS !== null) throw new SearchHttpError('RATE_LIMITED', Math.max(1, retryAfterS));
    let r;
    try {
      r = await this.store.slotCheck({ listingId: id, startLocal, endLocal });
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
    if (r.outcome === 'OK') {
      const price = await this.#slotPrice(id, country, r.startAt, r.endAt);
      const terms = await this.#terms(id, r.startAt);
      // annonce retirée entre les deux lectures : inconnue (404), jamais des conditions devinées
      if (terms === null) throw new SearchHttpError('LISTING_NOT_FOUND');
      return {
        startAt: r.startAt,
        endAt: r.endAt,
        timezone: r.timezone,
        price,
        cancellation: slotCancellation(terms),
        mileage: slotMileage(terms, price),
      };
    }
    if (r.outcome === 'DATES_NOTICE_TOO_SHORT') {
      // préavis affiché en heures entières (arrondi supérieur : jamais un délai plus court)
      throw new SearchHttpError('DATES_NOTICE_TOO_SHORT', null, {
        noticeHours: Math.ceil(r.noticeMinutes / 60),
      });
    }
    throw new SearchHttpError(r.outcome);
  }

  /**
   * Conditions de la fiche sans dates (US-205 ; 16 LST-010, LST-013, PRT-003 / PRT-013) :
   * identifiant mal formé, annonce inconnue ou non publiée ⇒ 404 ; base en panne ⇒ 503.
   */
  async conditions(listingId: string): Promise<ListingConditions> {
    if (!UUID.test(listingId)) throw new SearchHttpError('LISTING_NOT_FOUND');
    const t = await this.#terms(listingId.toLowerCase(), null);
    if (t === null) throw new SearchHttpError('LISTING_NOT_FOUND');
    return {
      currency: t.currency,
      timezone: t.timezone,
      cancellation:
        t.cancellation === null
          ? null
          : {
              freeCancelLeadHours: t.cancellation.freeCancelLeadHours,
              lastMinuteThresholdHours: t.cancellation.lastMinuteThresholdHours,
              lastMinuteWindowMinutes: LAST_MINUTE_WINDOW_MINUTES,
            },
      deposit: t.depositAmountMinor === null ? null : { amountMinor: t.depositAmountMinor },
      protection: t.protection,
    };
  }

  async #terms(listingId: string, startAt: string | null): Promise<ListingTerms | null> {
    try {
      return await this.store.terms(listingId, startAt);
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
  }

  /**
   * Total TTC du créneau de la fiche (US-208 ; 16 SRC-042 « 128,40 partout ») : même pricer que la
   * recherche. Devis impossible ⇒ `null` et alerte ops ; base ou pricer en panne ⇒ 503.
   */
  async #slotPrice(
    listingId: string,
    country: string,
    startAt: string,
    endAt: string,
  ): Promise<ListingSlotPrice | null> {
    let price: SearchPrice | null;
    let currency: string;
    try {
      const listing = await this.store.listingPrice(listingId);
      if (listing === null) return null;
      currency = listing.currency;
      price = this.pricer.price({
        listingId,
        country,
        currency,
        dailyPriceMinor: listing.dailyPriceMinor,
        startAt,
        endAt,
        quotedAt: listing.quotedAt,
      });
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
    if (price === null) {
      this.alertQuoteUnavailable(listingId, country);
      return null;
    }
    return { totalMinor: price.totalMinor, currency, billableDays: price.billableDays };
  }

  /**
   * Total TTC et note de chaque annonce, dans l'ordre de la base. Devis impossible ⇒ annonce
   * exclue et alerte ops (16 SRC-008) ; pricer ou notes en panne ⇒ 503 (jamais un total ou un
   * badge « Nuevo » inventés).
   */
  async #cards(country: string, results: readonly SearchResult[]): Promise<SearchCard[]> {
    if (results.length === 0) return [];
    let ratings: ReadonlyMap<string, SearchRating>;
    try {
      ratings = await this.reviews.ratings(results.map((x) => x.id));
    } catch {
      throw new SearchHttpError('SEARCH_UNAVAILABLE');
    }
    const cards: SearchCard[] = [];
    for (const res of results) {
      let price: SearchPrice | null;
      try {
        price = this.pricer.price({
          listingId: res.id,
          country,
          currency: res.currency,
          dailyPriceMinor: res.dailyPriceMinor,
          startAt: res.startAt,
          endAt: res.endAt,
          quotedAt: res.quotedAt,
        });
      } catch {
        throw new SearchHttpError('SEARCH_UNAVAILABLE');
      }
      if (price === null) {
        this.alertQuoteUnavailable(res.id, country);
        continue;
      }
      cards.push({
        ...withoutQuotedAt(res),
        totalMinor: price.totalMinor,
        billableDays: price.billableDays,
        rating: ratings.get(res.id) ?? null,
      });
    }
    return cards;
  }
}

/** Annulation du créneau : départ futur et paramètres présents, sinon `null` (aucune promesse). */
function slotCancellation(t: ListingTerms): SlotCancellation | null {
  const c = t.cancellation;
  if (c === null || c.lastMinute === null) return null;
  if (!c.lastMinute && c.freeUntil === null) return null;
  return {
    lastMinute: c.lastMinute,
    freeUntil: c.lastMinute ? null : c.freeUntil,
    lastMinuteWindowMinutes: LAST_MINUTE_WINDOW_MINUTES,
  };
}

/** Distance du créneau (16 LST-012) : km par jour × jours facturables du devis provisoire. */
function slotMileage(t: ListingTerms, price: ListingSlotPrice | null): SlotMileage {
  const perDay = t.mileageMode === 'INCLUDED' ? t.includedKmPerDay : null;
  return {
    mode: t.mileageMode,
    includedKmPerDay: perDay,
    includedKm: perDay === null || price === null ? null : perDay * price.billableDays,
    extraKmPriceMinor: t.mileageMode === 'INCLUDED' ? t.extraKmPriceMinor : null,
  };
}
