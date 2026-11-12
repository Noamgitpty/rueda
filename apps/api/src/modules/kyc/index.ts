// Point d'entrée public du module KYC. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, kyc.module.ts) est privé (règle rueda/module-boundaries).
export { KycModule } from './kyc.module.js';

// Port IdentityProvider (US-020, ADR-058 ; contrôles du rappel : US-105) : types seulement ;
// l'adaptateur est injecté.
export type {
  ErasureReceipt,
  ErasureRequest,
  IdentityChecks,
  IdentityDecision,
  IdentityDecisionEvent,
  IdentityDocumentRef,
  IdentityDocumentResult,
  IdentityOutcome,
  IdentityProvider,
  IdentitySubjectFacts,
  IdentityWebhookVerdict,
  StartVerificationRequest,
  VerificationSession,
  VerificationStatus,
} from './internal/identity-provider.port.js';

// Vérification d'identité par parcours hébergé et consentement biométrique (US-105, ADR-102) :
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

// Inscription et vérification individuelle de l'hôte, profil fiscal (US-123, ADR-105) : routes
// /host/accounts/{orgId}/verification ; ports SanctionsScreener et TaxIdSealer (types seulement,
// adaptateurs injectés) ; décision de l'ops par la console (HOST_VERIFICATION_DECISION, en base).
export { HostVerificationService } from './internal/host-verification.service.js';
export type {
  HostVerificationDeps,
  HostVerificationLogger,
  HostVerificationView,
} from './internal/host-verification.service.js';
export { unavailableHostVerification } from './internal/kyc-identity.module.js';
export { PgHostVerificationStore } from './internal/pg-host-verification-store.js';
export { UnavailableHostVerificationStore } from './internal/host-verification-store.js';
export type {
  HostBlocker,
  HostMissing,
  HostVerificationState,
  HostVerificationStore,
} from './internal/host-verification-store.js';
export type {
  SanctionsScreener,
  ScreeningOutcome,
  ScreeningReport,
  ScreeningRequest,
  ScreeningResult,
} from './internal/sanctions-screener.port.js';
export { TAX_ID_COLUMN } from './internal/tax-id-sealer.port.js';
export type { SealOutcome, TaxIdSealer } from './internal/tax-id-sealer.port.js';
