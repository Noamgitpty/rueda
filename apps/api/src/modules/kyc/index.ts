// Point d'entrée public du module KYC. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, kyc.module.ts) est privé (règle rueda/module-boundaries).
export { KycModule } from './kyc.module.js';

// Port IdentityProvider (US-020, ADR-057) : types seulement ; l'adaptateur est injecté.
export type {
  IdentityDecision,
  IdentityDecisionEvent,
  IdentityDocumentRef,
  IdentityOutcome,
  IdentityProvider,
  IdentityWebhookVerdict,
  StartVerificationRequest,
  VerificationSession,
  VerificationStatus,
} from './internal/identity-provider.port.js';
