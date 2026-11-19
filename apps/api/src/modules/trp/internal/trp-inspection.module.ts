/**
 * Module Nest des photos d'état du véhicule (US-303, ADR-179) : routes
 * `/trips/{tripId}/inspections/{kind}`. Module DYNAMIQUE, importé par le seul processus API
 * (`api.module.ts`), après `IamAuthModule` (`SessionGuard`) et `CtrLegalModule` (`TermsGuard`).
 *
 * Adaptateurs choisis par l'appelant : production `postgresTrpAdapters(pool)` (magasin PostgreSQL,
 * antivirus, coffre et stockage indisponibles : envoi 503) ; tests : FAKE (`../testing/`, absent de
 * la compilation de production). Sans magasin, toute route répond 503 après les gardes.
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { TripInspectionController } from './inspection/inspection.controller.js';
import { InspectionService } from './inspection/inspection.service.js';
import { UNAVAILABLE_EVIDENCE } from './inspection/ports.js';
import type { EvidencePipeline, SqlPool } from './inspection/ports.js';
import { PgInspectionStore, UnavailableInspectionStore } from './inspection/store.js';
import type { InspectionStore } from './inspection/store.js';
import { TRP_EVIDENCE_PIPELINE, TRP_INSPECTION_STORE } from './tokens.js';

export interface TrpInspectionOptions {
  /** Magasin des séries ; absent : 503. */
  readonly store?: InspectionStore;
  /** Antivirus, coffre, stockage ; absent : indisponibles (envoi 503). */
  readonly evidence?: EvidencePipeline;
}

@Module({})
export class TrpInspectionModule {
  static register(options: TrpInspectionOptions = {}): DynamicModule {
    return {
      module: TrpInspectionModule,
      controllers: [TripInspectionController],
      providers: [
        {
          provide: TRP_INSPECTION_STORE,
          useValue: options.store ?? new UnavailableInspectionStore(),
        },
        { provide: TRP_EVIDENCE_PIPELINE, useValue: options.evidence ?? UNAVAILABLE_EVIDENCE },
        InspectionService,
      ],
    };
  }
}

/**
 * Adaptateurs de production : magasin PostgreSQL sous app_api ; antivirus (ClamAV,
 * DEC-FONDATEUR-20), coffre KMS et stockage à verrou objet (US-003, Q-007) pas encore livrés :
 * indisponibles (fail-closed, jamais un FAKE en production).
 */
export function postgresTrpAdapters(pool: SqlPool): TrpInspectionOptions {
  return { store: new PgInspectionStore(pool, pool), evidence: UNAVAILABLE_EVIDENCE };
}
