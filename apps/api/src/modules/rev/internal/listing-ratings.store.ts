/**
 * Port et adaptateur PostgreSQL des notes publiques d'annonces (US-218, migration 0104, ADR-130 ;
 * 16 REV-010 : nombre de trips, moyenne, badge « Nuevo » sans avis). L'adaptateur n'appelle QUE
 * `core.review_listing_ratings` (SECURITY DEFINER, propriétaire review_cmd_owner, EXECUTE au seul
 * app_api) : la base ne rend que des annonces LISTED, jamais un compte, un auteur ni un texte.
 * Requête paramétrée ; une erreur de la base devient `ListingRatingStoreError` (SQLSTATE seulement).
 * Consommateurs attendus : recherche (US-201) et fiche de l'annonce (US-204), par `index.ts`.
 */

/** Exécuteur SQL minimal (pool ou client de `pg`). */
export interface SqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

/** Note d'un sujet : nombre d'avis publiés et moyenne ×100 (`null` sans avis). */
export interface SubjectRating {
  /** Trips réalisés (COMPLETED ou IN_DISPUTE), notés ou non. */
  readonly tripCount: number;
  readonly reviewCount: number;
  /** Moyenne des notes globales ×100, arrondie au demi supérieur par la base ; `null` sans avis. */
  readonly averageX100: number | null;
  /** Badge « Nuevo » de 16 REV-010 : aucun avis publié. */
  readonly isNew: boolean;
}

export interface ListingRating {
  readonly listingId: string;
  readonly vehicle: SubjectRating;
  readonly host: SubjectRating;
}

/** Au plus 100 annonces par appel (borne de la fonction de 0104). */
export const LISTING_RATINGS_MAX = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class ListingRatingStoreError extends Error {
  constructor(
    message: string,
    readonly sqlstate: string | undefined,
  ) {
    super(message);
    this.name = 'ListingRatingStoreError';
  }
}

export interface ListingRatingStore {
  /** Notes des annonces LISTED demandées ; une annonce inconnue ou non publiée est absente. */
  ratings(listingIds: readonly string[]): Promise<readonly ListingRating[]>;
}

/** Magasin indisponible (aucun adaptateur fourni) : tout appel échoue (fail-closed). */
export class UnavailableListingRatingStore implements ListingRatingStore {
  ratings(): Promise<readonly ListingRating[]> {
    return Promise.reject(new ListingRatingStoreError('notes indisponibles', undefined));
  }
}

const sqlstateOf = (error: unknown): string | undefined =>
  typeof (error as { code?: unknown }).code === 'string'
    ? ((error as { code: string }).code as string)
    : undefined;

/** Entier ≥ 0 rendu par la base (pg rend `integer` en nombre) ; sinon ligne illisible. */
function count(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new ListingRatingStoreError('notes : ligne illisible', undefined);
  }
  return v;
}

/** Moyenne ×100 dans [100, 500], ou `null` ; sinon ligne illisible. */
function average(v: unknown, reviews: number): number | null {
  if (v === null || v === undefined) {
    if (reviews !== 0) throw new ListingRatingStoreError('notes : ligne illisible', undefined);
    return null;
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 100 || v > 500 || reviews === 0) {
    throw new ListingRatingStoreError('notes : ligne illisible', undefined);
  }
  return v;
}

function subject(trips: unknown, reviews: unknown, avg: unknown): SubjectRating {
  const reviewCount = count(reviews);
  return {
    tripCount: count(trips),
    reviewCount,
    averageX100: average(avg, reviewCount),
    isNew: reviewCount === 0,
  };
}

export class PgListingRatingStore implements ListingRatingStore {
  constructor(private readonly db: SqlExecutor) {}

  async ratings(listingIds: readonly string[]): Promise<readonly ListingRating[]> {
    const ids = [...new Set(listingIds.map((id) => id.toLowerCase()))];
    if (ids.length === 0) return [];
    if (ids.length > LISTING_RATINGS_MAX || !ids.every((id) => UUID.test(id))) {
      throw new ListingRatingStoreError('notes : annonces invalides', undefined);
    }
    let rows: Record<string, unknown>[];
    try {
      rows = (
        await this.db.query<Record<string, unknown>>(
          'SELECT * FROM core.review_listing_ratings($1::uuid[])',
          [ids],
        )
      ).rows;
    } catch (error) {
      throw new ListingRatingStoreError('notes des annonces', sqlstateOf(error));
    }
    return rows.map((r) => {
      // ligne mal formée : refus de toute la réponse (jamais une donnée partielle)
      if (typeof r['listing_id'] !== 'string' || !ids.includes(r['listing_id'])) {
        throw new ListingRatingStoreError('notes : ligne illisible', undefined);
      }
      return {
        listingId: r['listing_id'],
        vehicle: subject(r['vehicle_trip_count'], r['vehicle_review_count'], r['vehicle_avg_x100']),
        host: subject(r['host_trip_count'], r['host_review_count'], r['host_avg_x100']),
      };
    });
  }
}
