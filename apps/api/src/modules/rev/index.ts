// Point d'entrée public du module REV. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, rev.module.ts) est privé (règle rueda/module-boundaries).
// Les adaptateurs FAKE (testing/) ne sont JAMAIS exportés ici (C19).
export { RevModule } from './rev.module.js';
// US-218 (ADR-130) : notes publiques d'annonces (16 REV-010), pour la recherche (US-201) et la
// fiche (US-204)
export {
  LISTING_RATINGS_MAX,
  ListingRatingStoreError,
  PgListingRatingStore,
  UnavailableListingRatingStore,
} from './internal/listing-ratings.store.js';
export type {
  ListingRating,
  ListingRatingStore,
  SubjectRating,
} from './internal/listing-ratings.store.js';
// US-317 (ADR-190) : avis réciproques en double aveugle, avis reçus, profil public de l'hôte
export { RevReviewsModule, unavailableRevOptions } from './internal/rev-reviews.module.js';
export type { RevReviewsOptions } from './internal/rev-reviews.module.js';
export { postgresRevAdapters } from './internal/production.js';
export { PgReviewStore, UnavailableReviewStore } from './internal/review-store.js';
export type { ReviewStore, RevSqlExecutor } from './internal/review-store.js';
export { REV_MESSAGES, RevHttpError } from './internal/errors.js';
