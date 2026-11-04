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
