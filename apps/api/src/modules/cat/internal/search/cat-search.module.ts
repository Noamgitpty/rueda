/**
 * Module Nest de la recherche publique (US-201, ADR-127). Module DYNAMIQUE, importé par le seul
 * processus API (`api.module.ts`), après `RiskHttpModule` (garde global de débit).
 *
 * Adaptateurs choisis par l'appelant : production `postgresSearchAdapters(db, probe, pricer)`
 * (fonctions `core.catalog_public_cards` de 0105 et `core.catalog_public_areas` de 0103 sous
 * app_api ; limiteur de la sonde : garde anti-abus de RISK ; prix : devis provisoire de PRC
 * (`searchQuotePricer`) ; notes : aucune tant que REV ne les fournit pas (US-218) ; caution
 * annoncée : décision de PAY (`PreCheckoutDepositReader`, US-701c) ; câblés par `main.ts`) ; tests : FAKE de `../../testing/`. Sans options : 503 partout. Dates choisies sur la
 * fiche (US-204, ADR-132) : `GET /listings/{id}/availability`, même magasin et même limiteur.
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { SqlExecutor } from '../host-listings/store.js';
import {
  NO_SEARCH_RATINGS,
  UNAVAILABLE_DEPOSIT_POLICY,
  UNAVAILABLE_SEARCH_PRICER,
} from './cards.js';
import type {
  ListingDepositPolicy,
  QuoteUnavailableAlert,
  SearchPricer,
  SearchRatings,
} from './cards.js';
import { ListingSlotController } from './listing-slot.controller.js';
import { SearchController } from './search.controller.js';
import { SearchService, UNAVAILABLE_PROBE_LIMITER } from './search.service.js';
import type { AvailabilityProbeLimiter } from './search.service.js';
import { PgSearchStore, UnavailableSearchStore } from './store.js';
import type { SearchStore } from './store.js';

export interface CatSearchOptions {
  readonly store: SearchStore;
  readonly probe: AvailabilityProbeLimiter;
  /** Total TTC des résultats (US-203) ; absent : 503 dès qu'il y a un résultat. */
  readonly pricer?: SearchPricer;
  /** Notes publiques (US-218) ; absentes : aucune note, badge « Nuevo ». */
  readonly ratings?: SearchRatings;
  /** Alerte ops d'un devis impossible ; absente : journal JSON (`search.quote_unavailable`). */
  readonly alertQuoteUnavailable?: QuoteUnavailableAlert;
  /** Caution annoncée avant le checkout (US-701c, PAY) ; absente : 503 (cartes et conditions). */
  readonly deposits?: ListingDepositPolicy;
}

/** Aucun adaptateur : 503 partout (fail-closed). */
export const UNAVAILABLE_CAT_SEARCH: CatSearchOptions = {
  store: new UnavailableSearchStore(),
  probe: UNAVAILABLE_PROBE_LIMITER,
  pricer: UNAVAILABLE_SEARCH_PRICER,
  ratings: NO_SEARCH_RATINGS,
  deposits: UNAVAILABLE_DEPOSIT_POLICY,
};

/**
 * Production : fonctions de 0105 / 0103 / 0149 sous app_api ; limiteur (RISK), prix (PRC), notes
 * (REV) et caution annoncée (PAY) fournis par l'appelant.
 */
export function postgresSearchAdapters(
  db: SqlExecutor,
  probe: AvailabilityProbeLimiter,
  pricer: SearchPricer,
  ratings: SearchRatings = NO_SEARCH_RATINGS,
  deposits: ListingDepositPolicy = UNAVAILABLE_DEPOSIT_POLICY,
): CatSearchOptions {
  return { store: new PgSearchStore(db), probe, pricer, ratings, deposits };
}

@Module({})
export class CatSearchModule {
  static register(options: CatSearchOptions = UNAVAILABLE_CAT_SEARCH): DynamicModule {
    return {
      module: CatSearchModule,
      // dates de la fiche (US-204) : même service, même sonde limitée par IP
      controllers: [SearchController, ListingSlotController],
      providers: [
        {
          provide: SearchService,
          useValue: new SearchService(
            options.store,
            options.probe,
            options.pricer,
            options.ratings,
            options.alertQuoteUnavailable,
            options.deposits,
          ),
        },
      ],
    };
  }
}
