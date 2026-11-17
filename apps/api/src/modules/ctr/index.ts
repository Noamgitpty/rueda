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

// Contrat de location hôte–voyageur par trip (US-211, ADR-143) : texte figé, PDF déterministe,
// empreinte et vérification (CONTRACT_HASH_MISMATCH). Fonctions pures ; le travailleur de
// génération est dans AVL (faits du devis figé, retenue du moteur de règlement de PRC).
export {
  buildContractBody,
  contractFooter,
  contractSha256,
  ContractInputError,
  fillSignatureBlock,
  parseContractBody,
  parseContractDerived,
  parseContractFacts,
  parseContractTerms,
  renderContractPdf,
  RENTAL_CONTRACT_RENDERER,
  RENTAL_CONTRACT_SCHEMA,
  verifyContractPdf,
  verifySignedContractPdf,
} from './internal/contract/rental-contract.js';
export type {
  ContractCancellation,
  ContractDerived,
  ContractFacts,
  ContractIdentity,
  ContractSignatureBlock,
  ContractTemplateText,
  ContractTerms,
  ContractVerification,
  CourtesyLocale,
  RentalContractInput,
} from './internal/contract/rental-contract.js';
export { nonWinAnsiCount } from './internal/contract/pdf.js';
export type { ContractLine, ContractLineStyle } from './internal/contract/pdf.js';

// Routes du contrat d'un trip (US-211 partie 211b, ADR-149) : port et adaptateur PostgreSQL du
// magasin (lecture d'une version, signature du voyageur), codes de réponse.
export { CONTRACT_MESSAGES, ContractHttpError } from './internal/contract/errors.js';
export {
  ContractStoreError,
  PgTripContractStore,
  UnavailableTripContractStore,
} from './internal/contract/trip-contract.store.js';
export type {
  ContractDocumentRow,
  ContractReadResult,
  ContractSignOutcome,
  TripContractStore,
} from './internal/contract/trip-contract.store.js';
