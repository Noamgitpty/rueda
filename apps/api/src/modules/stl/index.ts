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
  ordersByTender,
  planCancellation,
  registerTripCancellations,
  tenderKindOf,
} from './internal/trip-cancellation.js';
export type {
  BetaRefundRail,
  CancellationFacts,
  CancellationOrder,
  CancellationOutcome,
  CancellationPlan,
  CaptureTender,
  TenderOrder,
} from './internal/trip-cancellation.js';
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
