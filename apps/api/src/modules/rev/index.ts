// Point d'entrée public du module REV. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, rev.module.ts) est privé (règle rueda/module-boundaries).
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
