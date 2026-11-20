/**
 * Module Nest des photos d'état du véhicule (US-303, ADR-179) et de la remise et du retour entre
 * particuliers (US-315, ADR-183) : routes `/trips/{tripId}/inspections/{kind}` et
 * `/trips/{tripId}/handover/{direction}`. Module DYNAMIQUE, importé par le seul processus API
 * (`api.module.ts`), après `IamAuthModule` (`SessionGuard`) et `CtrLegalModule` (`TermsGuard`).
 *
 * Adaptateurs choisis par l'appelant : production `postgresTrpAdapters(pool)` (magasin PostgreSQL,
 * antivirus, coffre et stockage indisponibles : envoi 503) ; tests : FAKE (`../testing/`, absent de
 * la compilation de production). Sans magasin, toute route répond 503 après les gardes.
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { TripHandoverController } from './handover/handover.controller.js';
import { HandoverService } from './handover/handover.service.js';
import { PgHandoverStore, UnavailableHandoverStore } from './handover/store.js';
import type { HandoverStore } from './handover/store.js';
import { TripInspectionController } from './inspection/inspection.controller.js';
import { InspectionService } from './inspection/inspection.service.js';
import { UNAVAILABLE_EVIDENCE } from './inspection/ports.js';
import type { EvidencePipeline, SqlPool } from './inspection/ports.js';
import { PgInspectionStore, UnavailableInspectionStore } from './inspection/store.js';
import type { InspectionStore } from './inspection/store.js';
import { PgMitConsentStore, UNAVAILABLE_MIT_CONSENTS } from '../../pay/index.js';
import type { MitConsentPort } from '../../pay/index.js';
import {
  TRP_EVIDENCE_PIPELINE,
  TRP_HANDOVER_STORE,
  TRP_INSPECTION_STORE,
  TRP_MIT_REMINDERS,
} from './tokens.js';

export interface TrpInspectionOptions {
  /** Magasin des séries ; absent : 503. */
  readonly store?: InspectionStore;
  /** Antivirus, coffre, stockage ; absent : indisponibles (envoi 503). */
  readonly evidence?: EvidencePipeline;
  /** Remise et retour (US-315) ; absent : 503. */
  readonly handover?: HandoverStore;
  /** Rappel du consentement MIT à la remise (US-703) ; absent : rien n'est enregistré. */
  readonly mitReminders?: MitConsentPort;
}

@Module({})
export class TrpInspectionModule {
  static register(options: TrpInspectionOptions = {}): DynamicModule {
    return {
      module: TrpInspectionModule,
      controllers: [TripInspectionController, TripHandoverController],
      providers: [
        {
          provide: TRP_INSPECTION_STORE,
          useValue: options.store ?? new UnavailableInspectionStore(),
        },
        { provide: TRP_EVIDENCE_PIPELINE, useValue: options.evidence ?? UNAVAILABLE_EVIDENCE },
        InspectionService,
        {
          provide: TRP_HANDOVER_STORE,
          useValue: options.handover ?? new UnavailableHandoverStore(),
        },
        {
          provide: TRP_MIT_REMINDERS,
          useValue: options.mitReminders ?? UNAVAILABLE_MIT_CONSENTS,
        },
        HandoverService,
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
  return {
    store: new PgInspectionStore(pool, pool),
    evidence: UNAVAILABLE_EVIDENCE,
    // US-315 : commandes core.trip_cmd_* de la remise sous app_api (aucun port externe)
    handover: new PgHandoverStore(pool),
    // US-703 : rappel du consentement MIT à la remise (commande de PAY, 0169, sous app_api)
    mitReminders: new PgMitConsentStore(pool),
  };
}
