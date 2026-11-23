// Point d'entrée public du module CLM. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, clm.module.ts) est privé (règle rueda/module-boundaries).
export { ClmModule } from './clm.module.js';

// Dossier de preuve d'un trip (US-308, ADR-184) : portes de la console (service, port et adaptateur
// PostgreSQL), travailleur de l'archive (`evidence_verifier`), archive ZIP déterministe.
export {
  EVIDENCE_WORKER,
  EVIDENCE_ZIP_MAX_BYTES,
  EvidenceBundler,
  EvidenceTransientError,
} from './internal/evidence/bundler.js';
export type {
  EvidenceArchiveSealer,
  EvidenceArchiveStore,
  EvidenceBundlerOptions,
  EvidenceContractRenderer,
  EvidenceContractSource,
  EvidenceFileRead,
  EvidenceFileReader,
  EvidenceGeneration,
} from './internal/evidence/bundler.js';
export { EVIDENCE_BUNDLE_MESSAGES, EvidenceBundleHttpError } from './internal/evidence/errors.js';
export type { EvidenceBundleCode } from './internal/evidence/errors.js';
export { MANIFEST_SCHEMA, ManifestError, parseManifest } from './internal/evidence/manifest.js';
export type { EvidenceManifest, ManifestFile } from './internal/evidence/manifest.js';
export {
  UnavailableEvidenceExportFiles,
  UnavailableEvidenceExportVault,
} from './internal/evidence/ports.js';
export type {
  EvidenceExportFiles,
  EvidenceFileGet,
  EvidenceExportVault,
  EvidenceSqlClient,
  EvidenceSqlExecutor,
  EvidenceSqlPool,
} from './internal/evidence/ports.js';
export { EvidenceBundleService, EvidenceUnavailableError } from './internal/evidence/service.js';
export type {
  EvidenceArchive,
  EvidenceBundleServiceOptions,
  EvidenceDownloadOutcome,
} from './internal/evidence/service.js';
export {
  EVIDENCE_PURPOSES,
  EvidenceStoreError,
  PgEvidenceBundleStore,
} from './internal/evidence/store.js';
export type {
  EvidenceAccessRefusal,
  EvidenceBundleStore,
  EvidenceOpenOutcome,
  EvidencePurpose,
  EvidenceRequestInput,
  EvidenceRequestOutcome,
  EvidenceStaff,
  EvidenceStatusOutcome,
} from './internal/evidence/store.js';
export { buildZip, isSafeZipPath, ZipInputError } from './internal/evidence/zip.js';
export type { ZipEntry } from './internal/evidence/zip.js';

// Déclarations de dommage et d'incident, décisions motivées par gabarit, exécution par Kmino
// (US-309, ADR-195) : portes de la console (port et adaptateur PostgreSQL), travailleur
// `claim_decision_executor` (sous `payment_command`) et port de l'assureur partenaire.
export { CLAIM_MESSAGES, ClaimHttpError, isClaimCode } from './internal/claims/errors.js';
export type { ClaimCode } from './internal/claims/errors.js';
export {
  CLAIM_KINDS,
  ClaimStoreError,
  DECISION_LINE_CATEGORIES,
  DECISION_OUTCOMES,
  DECLARED_BY,
  PgClaimStore,
  UNAVAILABLE_CLAIM_STORE,
} from './internal/claims/store.js';
export type {
  ClaimDeclaredBy,
  ClaimKind,
  ClaimResult,
  ClaimStaff,
  ClaimStore,
  DecisionInput,
  DecisionLine,
  DecisionLineCategory,
  DecisionOutcome,
  RecordClaimInput,
} from './internal/claims/store.js';
export {
  CLAIM_DECISION_BATCH,
  CLAIM_DECISION_PERIOD_SECONDS,
  CLAIM_DECISION_WORKER,
  ClaimDecisionExecutor,
  registerClaimDecisionExecutor,
} from './internal/claims/executor.js';
export type {
  ClaimDecisionExecutorDeps,
  ClaimExecutionPass,
  InsurerClaimRequest,
  InsurerClaimResult,
  InsurerClaimsPort,
} from './internal/claims/executor.js';

// Frais annexes (US-706, ADR-197) : travailleur `incidental_invoice_executor` (sous
// `payment_command`) qui débite par US-703 les frais payés, décidés ou sans réponse à l'échéance.
export {
  INCIDENTAL_BATCH,
  INCIDENTAL_PERIOD_SECONDS,
  INCIDENTAL_WORKER,
  IncidentalInvoiceExecutor,
  registerIncidentalInvoiceExecutor,
} from './internal/incidental/executor.js';
export type {
  IncidentalChargeOutcome,
  IncidentalExecutorDeps,
  IncidentalPass,
} from './internal/incidental/executor.js';
export {
  INCIDENTAL_DECISION_OUTCOMES,
  PgIncidentalStaffStore,
  UNAVAILABLE_INCIDENTAL_STAFF_STORE,
} from './internal/incidental/staff-store.js';
export type {
  IncidentalDecisionOutcome,
  IncidentalStaffStore,
} from './internal/incidental/staff-store.js';
// Sinistres entre particuliers d'un trip (US-318, ADR-198) : incident du voyageur depuis S17,
// amendes, péages et fourrière déclarés par l'hôte et refacturés par débit séparé, dossier de vol
// présumé (travailleur dans la passe de `claim_decision_executor`).
export { ClmTripClaimsModule, postgresClmTripAdapters } from './internal/clm-trip-claims.module.js';
export type { ClmTripClaimsOptions } from './internal/clm-trip-claims.module.js';
export { TRIP_CLAIM_MESSAGES, TripClaimHttpError } from './internal/p2p/errors.js';
export type { TripClaimCode } from './internal/p2p/errors.js';
export {
  PgTripClaimsStore,
  TRAFFIC_CHARGE_KINDS,
  TripClaimStoreError,
  UnavailableTripClaimsStore,
} from './internal/p2p/store.js';
export type {
  IncidentInput,
  IncidentResult,
  TrafficChargeInput,
  TrafficChargeKind,
  TrafficChargeResult,
  TripClaimsStore,
} from './internal/p2p/store.js';
export { P2P_CLAIM_BATCH, P2pClaimsExecutor } from './internal/p2p/executor.js';
export type { P2pClaimsExecutorDeps, P2pClaimsPass } from './internal/p2p/executor.js';
