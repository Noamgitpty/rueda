/**
 * Module Nest des documents juridiques et des consentements (US-102) et des CGU de l'hôte
 * (US-126 : routes `/host/accounts/{orgId}/terms`). Module DYNAMIQUE, importé
 * par le seul processus API (`api.module.ts`), après `IamAuthModule` (il utilise `SessionGuard`).
 * Global : `TermsGuard` est injectable par les modules qui réservent sans réimporter CTR.
 *
 * Adaptateurs choisis par l'appelant : production `postgresCtrAdapters(pool)` ; tests
 * `FakeConsentStore` (`../testing/`, absent de la compilation de production).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { ConsentStore } from './consent-store.js';
import { HostTermsController } from './host-terms.controller.js';
import { LegalController } from './legal.controller.js';
import { LegalService } from './legal.service.js';
import { TermsGuard } from './terms.guard.js';
import { CTR_CONSENT_STORE } from './tokens.js';

export interface CtrLegalOptions {
  readonly store: ConsentStore;
}

@Module({})
export class CtrLegalModule {
  static register(options: CtrLegalOptions): DynamicModule {
    return {
      module: CtrLegalModule,
      global: true,
      controllers: [LegalController, HostTermsController],
      providers: [
        { provide: CTR_CONSENT_STORE, useValue: options.store },
        LegalService,
        TermsGuard,
      ],
      exports: [LegalService, TermsGuard],
    };
  }
}
