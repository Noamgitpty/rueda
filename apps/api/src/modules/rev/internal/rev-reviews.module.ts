/**
 * Module Nest des avis réciproques (US-317, ADR-190 : routes /trips/{tripId}/reviews,
 * /reviews/received, /listings/{listingId}/host-profile). Module DYNAMIQUE, importé par le seul
 * processus API (`api.module.ts`), après `IamAuthModule` (il utilise `SessionGuard`) et
 * `CtrLegalModule` (`TermsGuard`).
 *
 * Adaptateurs choisis par l'appelant :
 * - production : `postgresRevAdapters(pool)` (fonctions de 0170 sous `app_api`) ;
 * - tests : FAKE du magasin (`../testing/`, absent de la compilation de production).
 * Sans options : magasin indisponible, 503 (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { UnavailableReviewStore } from './review-store.js';
import { ListingHostProfileController } from './listing-host-profile.controller.js';
import { ReceivedReviewsController } from './received-reviews.controller.js';
import { ReviewsService } from './reviews.service.js';
import type { ReviewsDeps } from './reviews.service.js';
import { REV_REVIEWS_SERVICE } from './tokens.js';
import { TripReviewsController } from './trip-reviews.controller.js';

export type RevReviewsOptions = ReviewsDeps;

/** Journal des avis : codes et SQLSTATE seulement, jamais une note ni un texte d'avis. */
export const revConsoleLogger: ReviewsDeps['log'] = {
  warn: (message, fields) => {
    console.warn(JSON.stringify({ level: 'warn', module: 'REV', message, ...fields }));
  },
};

/** Options fail-closed : aucun magasin. */
export function unavailableRevOptions(): RevReviewsOptions {
  return { store: new UnavailableReviewStore(), log: revConsoleLogger };
}

@Module({})
export class RevReviewsModule {
  static register(options: RevReviewsOptions = unavailableRevOptions()): DynamicModule {
    return {
      module: RevReviewsModule,
      controllers: [TripReviewsController, ReceivedReviewsController, ListingHostProfileController],
      providers: [{ provide: REV_REVIEWS_SERVICE, useValue: new ReviewsService(options) }],
    };
  }
}
