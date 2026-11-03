/**
 * Moteur de règlement des annulations, sous-ensemble bêta (US-017). Exporté par `@rueda/money`.
 */
export {
  CANCELLATION_ENGINE_VERSION,
  computeCancellationSettlement,
  freeUntil,
} from './cancellation.ts';
export { computeCaptureLegs, computeLegs, legVariation } from './legs.ts';
export {
  SETTLEMENT_ERROR_CODES,
  SettlementError,
  isSettlementError,
  type SettlementErrorCode,
} from './errors.ts';
export {
  BETA_CANCELLATION_REASONS,
  LEGS,
  NO_SHOW_SUBREASONS,
  PICKUP_SUBREASONS,
  SETTLEMENT_LINES,
  type CancellationEvent,
  type CancellationReason,
  type CancellationSettlement,
  type HostPenaltySchedule,
  type Leg,
  type Legs,
  type Qualification,
  type RateType,
  type SettlementLine,
  type SettlementOrigin,
  type SettlementParams,
  type SettlementTaxGroup,
  type SettlementTrip,
  type TargetState,
} from './types.ts';
