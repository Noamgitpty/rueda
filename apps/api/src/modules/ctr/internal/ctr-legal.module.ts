/**
 * Module Nest des documents juridiques et des consentements (US-102) et des CGU de l'hôte
 * (US-126 : routes `/host/accounts/{orgId}/terms`). Module DYNAMIQUE, importé
 * par le seul processus API (`api.module.ts`), après `IamAuthModule` (il utilise `SessionGuard`).
 * Global : `TermsGuard` est injectable par les modules qui réservent sans réimporter CTR.
 *
 * Adaptateurs choisis par l'appelant : production `postgresCtrAdapters(pool)` ; tests
 * `FakeConsentStore` (`../testing/`, absent de la compilation de production).
 *
 * Contrat de location d'un trip (US-211 partie 211b) : routes `/trips/{tripId}/contract` ; sans
 * magasin (`contracts` absent), elles répondent 503 après les gardes (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { CfgModule } from '../../cfg/index.js';
import type { ConsentStore } from './consent-store.js';
import { TripContractController } from './contract/trip-contract.controller.js';
import { TripContractService } from './contract/trip-contract.service.js';
import { UnavailableTripContractStore } from './contract/trip-contract.store.js';
import type { TripContractStore } from './contract/trip-contract.store.js';
import { HostTermsController } from './host-terms.controller.js';
import { LegalController } from './legal.controller.js';
import { LegalService } from './legal.service.js';
import { TermsGuard } from './terms.guard.js';
import { CTR_CONSENT_STORE, CTR_CONTRACT_STORE } from './tokens.js';

export interface CtrLegalOptions {
  readonly store: ConsentStore;
  /** Contrat de location d'un trip (US-211 partie 211b) ; absent : 503. */
  readonly contracts?: TripContractStore;
}

@Module({})
export class CtrLegalModule {
  static register(options: CtrLegalOptions): DynamicModule {
    return {
      module: CtrLegalModule,
      global: true,
      imports: [CfgModule],
      controllers: [LegalController, HostTermsController, TripContractController],
      providers: [
        { provide: CTR_CONSENT_STORE, useValue: options.store },
        {
          provide: CTR_CONTRACT_STORE,
          useValue: options.contracts ?? new UnavailableTripContractStore(),
        },
        LegalService,
        TermsGuard,
        TripContractService,
      ],
      exports: [LegalService, TermsGuard],
    };
  }
}
