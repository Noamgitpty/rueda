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
// Remise et retour entre particuliers (US-315, ADR-183)
export { HANDOVER_MESSAGES, HandoverHttpError } from './internal/handover/errors.js';
export { PgHandoverStore, UnavailableHandoverStore } from './internal/handover/store.js';
export type { HandoverStore, HandoverViewRow } from './internal/handover/store.js';
// No-show déclaré par une partie du trip (US-307, ADR-191)
export { NO_SHOW_MESSAGES, NoShowHttpError } from './internal/no-show/errors.js';
export { PgNoShowStore, UnavailableNoShowStore } from './internal/no-show/store.js';
export type { NoShowStore, NoShowViewRow } from './internal/no-show/store.js';
// Détection automatique des retards (US-305, ADR-188)
export {
  alertOps,
  DETECTION_OUTCOMES,
  OverdueDetector,
  parseDetection,
  registerOverdueDetection,
  TRIP_AT_RISK_FLAGGED_EVENT,
  TRIP_OVERDUE_ALERT_WORKER,
  TRIP_OVERDUE_DEFAULTS,
  TRIP_OVERDUE_DETECTED_EVENT,
  TRIP_OVERDUE_WORKER,
} from './internal/overdue/overdue-detection.js';
export type {
  DetectionOutcome,
  DetectionResult,
  OverdueDetectorOptions,
  OverduePassCounts,
} from './internal/overdue/overdue-detection.js';
