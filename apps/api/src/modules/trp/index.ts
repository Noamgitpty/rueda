// Point d'entrée public du module TRP. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, trp.module.ts) est privé (règle rueda/module-boundaries).
export { TrpModule } from './trp.module.js';
// Photos d'état du véhicule (US-303, ADR-179)
export { postgresTrpAdapters, TrpInspectionModule } from './internal/trp-inspection.module.js';
export type { TrpInspectionOptions } from './internal/trp-inspection.module.js';
export { INSPECTION_MESSAGES, InspectionHttpError } from './internal/inspection/errors.js';
export {
  evidenceOpen,
  UNAVAILABLE_EVIDENCE,
  UnavailableEvidenceFileStore,
  UnavailableEvidenceScanner,
  UnavailableEvidenceVault,
} from './internal/inspection/ports.js';
export type {
  EvidenceFileStore,
  EvidencePipeline,
  EvidenceScanner,
  EvidenceVault,
} from './internal/inspection/ports.js';
export { PgInspectionStore, UnavailableInspectionStore } from './internal/inspection/store.js';
export type {
  InspectionStore,
  InspectionViewRow,
  PhotoRecord,
} from './internal/inspection/store.js';
