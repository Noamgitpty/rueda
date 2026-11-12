/**
 * Module Nest de la vérification d'identité (US-105, ADR-102). Module DYNAMIQUE, importé par le
 * seul processus API (`api.module.ts`), après `IamAuthModule` (il utilise `SessionGuard`). Global : le
 * service (`KYC_IDENTITY_SERVICE`, méthode `assertDriverEligible`) est injectable par le module
 * qui encaisse (US-209 : contrôle bloquant du permis) sans réimporter KYC.
 *
 * Adaptateurs choisis par l'appelant :
 * - production : `postgresKycAdapters(pool)` (aucun fournisseur tant qu'OQ-MK-09 est ouverte :
 *   ouverture 503, rappels 404) ;
 * - tests : `FakeIdentityStore` et `FakeIdentityProvider` (`../testing/`, absents de la
 *   compilation de production).
 * Sans options : magasin indisponible et aucun fournisseur (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { IdentityController } from './identity.controller.js';
import { KycWebhookController } from './kyc-webhook.controller.js';
import { IdentityVerificationService } from './identity.service.js';
import type { IdentityServiceDeps } from './identity.service.js';
import { UnavailableIdentityStore } from './identity-store.js';
import { KYC_IDENTITY_SERVICE } from './tokens.js';

export type KycIdentityOptions = IdentityServiceDeps;

const consoleLogger: IdentityServiceDeps['log'] = {
  warn: (message, fields) => {
    console.warn(JSON.stringify({ level: 'warn', module: 'KYC', message, ...fields }));
  },
};

/** Options fail-closed : aucun magasin, aucun fournisseur. */
export function unavailableKycOptions(): KycIdentityOptions {
  return {
    store: new UnavailableIdentityStore(),
    providers: { active: null, byCode: new Map() },
    returnUrl: null,
    countries: [],
    log: consoleLogger,
  };
}

@Module({})
export class KycIdentityModule {
  static register(options: KycIdentityOptions = unavailableKycOptions()): DynamicModule {
    return {
      module: KycIdentityModule,
      global: true,
      controllers: [IdentityController, KycWebhookController],
      providers: [
        { provide: KYC_IDENTITY_SERVICE, useValue: new IdentityVerificationService(options) },
      ],
      exports: [KYC_IDENTITY_SERVICE],
    };
  }
}

export { consoleLogger as kycConsoleLogger };
