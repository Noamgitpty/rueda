/**
 * Module Nest de la vérification d'identité (US-105, ADR-102) et de la vérification de l'hôte
 * (US-123, ADR-105 : routes /host/accounts/{orgId}/verification). Module DYNAMIQUE, importé par le
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
import { HostVerificationController } from './host-verification.controller.js';
import { UnavailableHostVerificationStore } from './host-verification-store.js';
import { HostVerificationService } from './host-verification.service.js';
import type { HostVerificationDeps } from './host-verification.service.js';
import { IdentityController } from './identity.controller.js';
import { KycWebhookController } from './kyc-webhook.controller.js';
import { IdentityVerificationService } from './identity.service.js';
import type { IdentityServiceDeps } from './identity.service.js';
import { UnavailableIdentityStore } from './identity-store.js';
import { KYC_HOST_VERIFICATION_SERVICE, KYC_IDENTITY_SERVICE } from './tokens.js';

/**
 * Options du module : vérification d'identité (US-105) et, facultative, vérification de l'hôte
 * (US-123) ; absente : magasin indisponible, ni prestataire de filtrage ni coffre (503).
 */
export type KycIdentityOptions = IdentityServiceDeps & { readonly host?: HostVerificationDeps };

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

/** Vérification de l'hôte fail-closed : aucun magasin, aucun prestataire de filtrage, aucun coffre. */
export function unavailableHostVerification(): HostVerificationDeps {
  return {
    store: new UnavailableHostVerificationStore(),
    screener: null,
    sealer: null,
    log: consoleLogger,
  };
}

@Module({})
export class KycIdentityModule {
  static register(options: KycIdentityOptions = unavailableKycOptions()): DynamicModule {
    return {
      module: KycIdentityModule,
      global: true,
      controllers: [IdentityController, KycWebhookController, HostVerificationController],
      providers: [
        { provide: KYC_IDENTITY_SERVICE, useValue: new IdentityVerificationService(options) },
        {
          provide: KYC_HOST_VERIFICATION_SERVICE,
          useValue: new HostVerificationService(options.host ?? unavailableHostVerification()),
        },
      ],
      exports: [KYC_IDENTITY_SERVICE],
    };
  }
}

export { consoleLogger as kycConsoleLogger };
