// API publique de @rueda/db/audit (US-009) : chaîne d'audit, enveloppe par sujet, port KMS,
// clés par sujet, magasin de preuves. Aucun adaptateur FAKE ici (ils sont dans @rueda/db/testing).
export {
  AUDIT_CHAIN_GENESIS,
  AUDIT_CHAIN_SELECT,
  AUDIT_CHAIN_VERSION,
  auditRowHash,
  canonicalAuditRow,
  fromDbRow,
  verifyAuditChain,
} from './chain.ts';
export type {
  AuditChainBreak,
  AuditChainBreakReason,
  AuditChainDbRow,
  AuditChainHead,
  AuditChainResult,
  AuditChainRow,
} from './chain.ts';
export {
  columnAad,
  DEK_BYTES,
  ENVELOPE_MIN_BYTES,
  ENVELOPE_VERSION,
  EnvelopeError,
  fileAad,
  open,
  seal,
  subjectLabel,
} from './envelope.ts';
export type { SubjectRef, SubjectType } from './envelope.ts';
export { KeyWrapperRejectedError, KeyWrapperUnavailableError } from './key-wrapper.ts';
export type { KeyWrapper } from './key-wrapper.ts';
export { DEFAULT_DEK_CACHE_TTL_MS, SubjectKeyStore } from './subject-keys.ts';
export type { DekResult, Queryable, SubjectKeyStoreOptions } from './subject-keys.ts';
export {
  appendAuditLog,
  AUDIT_IP_COLUMN,
  AUDIT_IP_TABLE,
  AuditEntryError,
  recordDataAccess,
} from './audit-log.ts';
export type {
  AuditAppendResult,
  AuditEntry,
  AuditObject,
  AuditValue,
  DataAccessEntry,
  DataAccessKind,
} from './audit-log.ts';
export {
  FileAssetError,
  FileStoreConflictError,
  receiveFile,
  sha256Stream,
  verifyFileAsset,
} from './file-asset.ts';
export type {
  Bucket,
  Classification,
  FileSource,
  FileStore,
  FileVerification,
  ReceivedFile,
  ReceiveFileInput,
} from './file-asset.ts';
