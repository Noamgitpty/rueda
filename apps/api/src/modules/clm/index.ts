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
