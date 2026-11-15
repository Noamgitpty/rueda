/**
 * Cartes des résultats de la recherche (US-203 ; 16 SRC-008, SRC-011, SRC-042 ; 19 US-203) :
 * chaque annonce disponible reçoit son total TTC du devis provisoire (PRC-025, même moteur que la
 * fiche et le checkout), ses jours facturés, la caution de la plateforme rendue par la base
 * (`deposit_policy` du pays et de la classe, ou rien : mention générique) et sa note publique.
 *
 * CAT ne dépend ni de PRC (PRC dépend de CAT, 17 §2.2) ni de REV : le prix et les notes passent par
 * deux ports satisfaits par l'appelant (`main.ts`) : `SearchPricer` (adaptateur de PRC,
 * `searchQuotePricer`) et `SearchRatings` (notes de REV, US-218 ; aucune note tant que REV ne les
 * fournit pas : badge « Nuevo »). Sans pricer : 503 (fail-closed).
 */
import type { SearchResult } from './store.js';

/** Entrée du devis provisoire d'une annonce : rien d'autre que l'annonce et la période. */
export interface SearchPriceInput {
  readonly listingId: string;
  readonly country: string;
  readonly currency: string;
  /** Prix journalier de l'annonce (texte d'un entier, unités mineures). */
  readonly dailyPriceMinor: string;
  /** Période et instant du devis (`platform.now()` lu par la base), ISO 8601 UTC. */
  readonly startAt: string;
  readonly endAt: string;
  readonly quotedAt: string;
}

/** Devis provisoire (non persisté, 16 SRC-042 « devis PROVISIONAL ») : total TTC et jours. */
export interface SearchPrice {
  /** Total TTC payé par le voyageur (texte d'un entier, unités mineures). */
  readonly totalMinor: string;
  readonly billableDays: number;
}

/**
 * Prix des résultats. `null` : devis impossible pour cette annonce (paramètre du pays manquant,
 * devise, durée) ⇒ annonce exclue et alerte ops (16 SRC-008, parcours alternatif) ; une exception :
 * prix indisponible ⇒ 503.
 */
export interface SearchPricer {
  price(input: SearchPriceInput): SearchPrice | null;
}

/** Aucun pricer fourni : toute recherche avec résultats répond 503 (fail-closed). */
export const UNAVAILABLE_SEARCH_PRICER: SearchPricer = {
  price: () => {
    throw new Error('prix des résultats indisponible');
  },
};

/** Note publique d'une annonce (16 REV-010) : moyenne ×100 (`null` sans avis), avis et trips. */
export interface SearchRating {
  readonly averageX100: number | null;
  readonly reviewCount: number;
  readonly tripCount: number;
}

/** Notes des annonces ; une annonce absente de la réponse n'a aucun avis (« Nuevo »). */
export interface SearchRatings {
  ratings(listingIds: readonly string[]): Promise<ReadonlyMap<string, SearchRating>>;
}

/**
 * Aucune note (REV ne fournit pas encore les siennes, US-218) : chaque carte porte le badge
 * « Nuevo », ce qui est exact tant qu'aucun avis n'est publié. Une erreur d'un vrai adaptateur
 * vaut « indisponible » (503), jamais « Nuevo ».
 */
export const NO_SEARCH_RATINGS: SearchRatings = {
  ratings: () => Promise.resolve(new Map()),
};

/** Carte d'un résultat (colonnes C0 d'US-201, plus le prix, la caution et la note). */
export interface SearchCard extends Omit<SearchResult, 'quotedAt'> {
  readonly totalMinor: string;
  readonly billableDays: number;
  /** Note publique, ou `null` sans avis (badge « Nuevo »). */
  readonly rating: SearchRating | null;
}

/** Alerte ops d'un devis impossible : identifiant de l'annonce seulement (aucune donnée C1+). */
export type QuoteUnavailableAlert = (listingId: string, country: string) => void;

export const LOG_QUOTE_UNAVAILABLE: QuoteUnavailableAlert = (listingId, country) => {
  console.warn(
    JSON.stringify({ level: 'warn', event: 'search.quote_unavailable', listingId, country }),
  );
};
