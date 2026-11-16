/**
 * Notes publiques de la fiche (US-204 ; 16 LST-003 / LST-020, bêta SIMPLIFIÉ : note et nombre de
 * trips du véhicule et de l'hôte, badge « Nuevo » sans avis ; REV-010). CAT ne dépend pas de REV
 * (17 §2.2) : la note passe par ce port, satisfait par l'appelant (`main.ts`, notes de REV,
 * `core.review_listing_ratings` d'US-218). Aucun port fourni : aucune note (badge « Nuevo »,
 * exact tant qu'aucun avis n'est publié) ; une erreur d'un vrai adaptateur vaut « indisponible »
 * (503), jamais « Nuevo ».
 */

/** Note d'un sujet : moyenne ×100 (`null` sans avis), avis publiés, trips réalisés. */
export interface PublicRating {
  readonly averageX100: number | null;
  readonly reviewCount: number;
  readonly tripCount: number;
}

/** Notes du véhicule (en-tête) et de l'hôte (bloc « Tu anfitrión ») d'une annonce. */
export interface PublicListingRating {
  readonly vehicle: PublicRating;
  readonly host: PublicRating;
}

export interface PublicListingRatings {
  /** Notes d'une annonce LISTED ; `null` : aucune note connue (« Nuevo »). */
  ratings(listingId: string): Promise<PublicListingRating | null>;
}

export const NO_PUBLIC_LISTING_RATINGS: PublicListingRatings = {
  ratings: () => Promise.resolve(null),
};
