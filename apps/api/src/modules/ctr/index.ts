// Point d'entrée public du module CTR. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, ctr.module.ts) est privé (règle rueda/module-boundaries).
export { CtrModule } from './ctr.module.js';

// Documents juridiques et consentements versionnés (US-102, ADR-091) : routes /legal, garde des
// réservations, adaptateur PostgreSQL de production.
export { CtrLegalModule } from './internal/ctr-legal.module.js';
export type { CtrLegalOptions } from './internal/ctr-legal.module.js';
export { TermsGuard } from './internal/terms.guard.js';
export { BOOKING_ROUTES, BookingRoutes } from './internal/booking-routes.js';
export { LEGAL_MESSAGES, LegalHttpError } from './internal/errors.js';
export { postgresCtrAdapters, PgConsentStore } from './internal/pg-consent-store.js';
export type {
  ConsentStatusRow,
  ConsentStore,
  LegalDocument,
  LegalDocumentKind,
  LegalDocumentSummary,
} from './internal/consent-store.js';

// Port SignatureService (US-020, ADR-058) : types seulement ; l'adaptateur est injecté.
export type {
  SignatureCheckResult,
  SignatureOutcome,
  SignatureRecord,
  SignatureService,
  SignRequest,
} from './internal/signature-service.port.js';
