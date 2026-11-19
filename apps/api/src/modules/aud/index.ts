// Point d'entrée public du module AUD. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, aud.module.ts) est privé (règle rueda/module-boundaries).
export { AudModule } from './aud.module.js';
export {
  readPersonalDataAsStaff,
  recordStaffDataAccess,
  STAFF_DATA_ACCESS_SQL,
  StaffDataAccessDenied,
} from './internal/staff-data-access.js';
export type {
  StaffDataAccessKind,
  StaffDataAccessOutcome,
  StaffDataAccessRequest,
} from './internal/staff-data-access.js';
// Contrôles communs des photos téléversées (US-115, partagés par US-303 : CAT et TRP, ADR-179)
export {
  DEFAULT_PHOTO_LIMITS,
  isCleanScan,
  PhotoRejectedError,
  preparePhoto,
  sniffPhotoMime,
  UnavailablePhotoScanner,
  UnavailablePhotoStorage,
} from './internal/photo-checks.js';
export type {
  CleanPhoto,
  Dimensions,
  PhotoLimits,
  PhotoMime,
  PhotoRejection,
  PhotoScanner,
  PhotoScanResult,
  PhotoStorage,
} from './internal/photo-checks.js';
