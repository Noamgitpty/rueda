/**
 * Module Nest de la recherche publique (US-201, ADR-127). Module DYNAMIQUE, importé par le seul
 * processus API (`api.module.ts`), après `RiskHttpModule` (garde global de débit).
 *
 * Adaptateurs choisis par l'appelant : production `postgresSearchAdapters(db, probe)` (fonctions
 * `core.catalog_public_search*` de 0100 sous app_api ; limiteur de la sonde : garde anti-abus de
 * RISK, câblée par `main.ts`) ; tests : FAKE de `../../testing/`. Sans options : 503 partout.
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { SqlExecutor } from '../host-listings/store.js';
import { SearchController } from './search.controller.js';
import { SearchService, UNAVAILABLE_PROBE_LIMITER } from './search.service.js';
import type { AvailabilityProbeLimiter } from './search.service.js';
import { PgSearchStore, UnavailableSearchStore } from './store.js';
import type { SearchStore } from './store.js';

export interface CatSearchOptions {
  readonly store: SearchStore;
  readonly probe: AvailabilityProbeLimiter;
}

/** Aucun adaptateur : 503 partout (fail-closed). */
export const UNAVAILABLE_CAT_SEARCH: CatSearchOptions = {
  store: new UnavailableSearchStore(),
  probe: UNAVAILABLE_PROBE_LIMITER,
};

/** Production : fonctions de 0100 sous app_api ; limiteur fourni par l'appelant (RISK). */
export function postgresSearchAdapters(
  db: SqlExecutor,
  probe: AvailabilityProbeLimiter,
): CatSearchOptions {
  return { store: new PgSearchStore(db), probe };
}

@Module({})
export class CatSearchModule {
  static register(options: CatSearchOptions = UNAVAILABLE_CAT_SEARCH): DynamicModule {
    return {
      module: CatSearchModule,
      controllers: [SearchController],
      providers: [
        { provide: SearchService, useValue: new SearchService(options.store, options.probe) },
      ],
    };
  }
}
