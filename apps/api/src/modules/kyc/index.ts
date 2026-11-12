// Point d'entrée public du module KYC. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, kyc.module.ts) est privé (règle rueda/module-boundaries).
export { KycModule } from './kyc.module.js';

// Port IdentityProvider (US-020, ADR-058 ; contrôles du rappel : US-105) : types seulement ;
// l'adaptateur est injecté.
export type {
  IdentityChecks,
  IdentityDecision,
  IdentityDecisionEvent,
  IdentityDocumentRef,
  IdentityDocumentResult,
  IdentityOutcome,
  IdentityProvider,
  IdentityWebhookVerdict,
  StartVerificationRequest,
  VerificationSession,
  VerificationStatus,
} from './internal/identity-provider.port.js';

// Vérification d'identité par parcours hébergé et consentement biométrique (US-105, ADR-101) :
// routes /identity et /kyc/webhooks, montage par le processus API, contrôle bloquant du paiement
// (US-209 : `assertDriverEligible` du service injecté par KYC_IDENTITY_SERVICE).
export { KycIdentityModule, unavailableKycOptions } from './internal/kyc-identity.module.js';
export type { KycIdentityOptions } from './internal/kyc-identity.module.js';
export { KYC_IDENTITY_SERVICE } from './internal/tokens.js';
export { IdentityVerificationService, LICENSE_DOCUMENT_KIND } from './internal/identity.service.js';
export type {
  IdentityProviders,
  IdentityStateView,
  KycCountry,
  KycLogger,
} from './internal/identity.service.js';
export { KYC_MESSAGES, KycHttpError } from './internal/errors.js';
export { KYC_SIGNATURE_HEADER } from './internal/kyc-webhook.controller.js';
export {
  kycCountries,
  postgresKycAdapters,
  PRODUCTION_IDENTITY_PROVIDERS,
} from './internal/production.js';
export { PgIdentityStore } from './internal/pg-identity-store.js';
export { UnavailableIdentityStore } from './internal/identity-store.js';
export type { IdentityState, IdentityStore, KycStatus } from './internal/identity-store.js';
