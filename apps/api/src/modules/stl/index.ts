// Point d'entrée public du module STL. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, stl.module.ts) est privé (règle rueda/module-boundaries).
export { StlModule } from './stl.module.js';
export { settleOrFinReview } from './internal/settlement-review.js';
export type { SettlementAttempt } from './internal/settlement-review.js';
// Annulations déclenchées par l'ops, réglées dans la transition (US-215, ADR-148)
export {
  CancellationPlanError,
  TRIP_CANCELLATION_PERIOD_SECONDS,
  TRIP_LIFECYCLE_WORKER,
  TripCancellationProcessor,
  cancellationEvent,
  cancellationParams,
  planCancellation,
  registerTripCancellations,
} from './internal/trip-cancellation.js';
export type {
  CancellationFacts,
  CancellationOrder,
  CancellationOutcome,
  CancellationPlan,
} from './internal/trip-cancellation.js';
// Bordereau mensuel de l'assureur (US-227, ADR-165)
export {
  INSURER_BORDEREAU_PERIOD_SECONDS,
  INSURER_BORDEREAU_WORKER,
  registerInsurerBordereaux,
} from './internal/insurer-bordereau.js';
// Ordonnanceur des remboursements planifiés (US-224c, ADR-150)
export {
  REFUND_SCHEDULER_BATCH,
  REFUND_SCHEDULER_PERIOD_SECONDS,
  REFUND_SCHEDULER_WORKER,
  RefundScheduler,
  classifyRefundError,
  registerRefundScheduler,
} from './internal/refund-scheduler.js';
export type {
  RefundAlertCode,
  RefundOutcome,
  RefundSchedulerDeps,
  RefundStep,
} from './internal/refund-scheduler.js';
