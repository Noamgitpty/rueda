/**
 * Module Nest des sinistres entre particuliers d'un trip (US-318, ADR-198) : routes
 * `/trips/{tripId}/incidents`, `/trips/{tripId}/claims` et `/trips/{tripId}/traffic-charges`.
 * Module DYNAMIQUE, importé par le seul processus API (`api.module.ts`), après `IamAuthModule`
 * (`SessionGuard`) et `CtrLegalModule` (`TermsGuard`). Sans magasin, toute route répond 503 après
 * les gardes (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { EvidenceSqlExecutor } from './evidence/ports.js';
import { TripClaimsController } from './p2p/controller.js';
import { TripClaimsService } from './p2p/service.js';
import { PgTripClaimsStore, UnavailableTripClaimsStore } from './p2p/store.js';
import type { TripClaimsStore } from './p2p/store.js';
import { CLM_TRIP_CLAIMS_STORE } from './tokens.js';

export interface ClmTripClaimsOptions {
  /** Magasin des sinistres du trip ; absent : 503. */
  readonly store?: TripClaimsStore;
}

@Module({})
export class ClmTripClaimsModule {
  static register(options: ClmTripClaimsOptions = {}): DynamicModule {
    return {
      module: ClmTripClaimsModule,
      controllers: [TripClaimsController],
      providers: [
        {
          provide: CLM_TRIP_CLAIMS_STORE,
          useValue: options.store ?? new UnavailableTripClaimsStore(),
        },
        TripClaimsService,
      ],
    };
  }
}

/** Adaptateur de production : commandes core.claim_* de 0178 sous app_api (aucun port externe). */
export function postgresClmTripAdapters(pool: EvidenceSqlExecutor): ClmTripClaimsOptions {
  return { store: new PgTripClaimsStore(pool) };
}
