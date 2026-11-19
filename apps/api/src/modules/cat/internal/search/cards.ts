/**
 * Cartes des résultats de la recherche (US-203 ; 16 SRC-008, SRC-011, SRC-042 ; 19 US-203) :
 * chaque annonce disponible reçoit son total TTC du devis provisoire (PRC-025, même moteur que la
 * fiche et le checkout), ses jours facturés, la caution annoncée avant le checkout (US-701c,
 * T70 c : montant, mention générique ou caution non disponible) et sa note publique.
 *
 * CAT ne dépend ni de PRC (PRC dépend de CAT, 17 §2.2), ni de REV, ni de PAY : le prix, les notes et
 * la caution passent par des ports satisfaits par l'appelant (`main.ts`) : `SearchPricer`
 * (adaptateur de PRC, `searchQuotePricer`), `SearchRatings` (notes de REV, US-218 ; aucune note
 * tant que REV ne les fournit pas : badge « Nuevo ») et `ListingDepositPolicy` (décision de PAY,
 * `PreCheckoutDepositReader`, ADR-173). Sans pricer ou sans politique de caution : 503
 * (fail-closed).
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

/**
 * Caution annoncée avant le checkout (08 BR-PAY-06 « Moment de l'évaluation », T70 c ; 10b UX-21) :
 * `GENERIC` (mention générique), `REQUIRED` (montant `deposit_amount[pays][classe]`, unités
 * mineures) ou `UNAVAILABLE` (déclencheur vrai, montant À DÉCIDER : le checkout refusera ce trip,
 * `PARAM_MISSING`). Jamais les déclencheurs ni la classe.
 */
export type DepositNotice =
  | { readonly status: 'GENERIC' }
  | { readonly status: 'REQUIRED'; readonly amountMinor: string }
  | { readonly status: 'UNAVAILABLE' };

/** Décision de la caution avant le checkout (PAY) pour un pays et une classe lue en base. */
export interface ListingDepositPolicy {
  notice(country: string, valueClass: string | null): Promise<DepositNotice>;
}

/** Aucune politique fournie : toute carte ou fiche répond 503 (fail-closed). */
export const UNAVAILABLE_DEPOSIT_POLICY: ListingDepositPolicy = {
  notice: () => Promise.reject(new Error('caution avant le checkout indisponible')),
};

/** Statut de la caution rendu à l'API (le montant est rendu à part, `null` hors `REQUIRED`). */
export type DepositStatus = DepositNotice['status'];

/** Carte d'un résultat (colonnes C0 d'US-201, plus le prix, la caution et la note). */
export interface SearchCard extends Omit<SearchResult, 'quotedAt'> {
  /**
   * Caution annoncée (US-701c) : montant si `depositStatus` = `REQUIRED`, sinon `null` ; mention
   * générique (`GENERIC`) ou caution non disponible (`UNAVAILABLE`).
   */
  readonly depositAmountMinor: string | null;
  readonly depositStatus: DepositStatus;
  readonly totalMinor: string;
  readonly billableDays: number;
  /** Note publique, ou `null` sans avis (badge « Nuevo »). */
  readonly rating: SearchRating | null;
  /**
   * La base promet la protection de l'assureur partenaire pour cette annonce (US-205b, même règle
   * que la fiche) : seule condition de la mention « protection incluse » de la carte.
   */
  readonly protectionOffered: boolean;
}

/** Alerte ops d'un devis impossible : identifiant de l'annonce seulement (aucune donnée C1+). */
export type QuoteUnavailableAlert = (listingId: string, country: string) => void;

export const LOG_QUOTE_UNAVAILABLE: QuoteUnavailableAlert = (listingId, country) => {
  console.warn(
    JSON.stringify({ level: 'warn', event: 'search.quote_unavailable', listingId, country }),
  );
};
