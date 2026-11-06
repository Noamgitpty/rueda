/**
 * Moteur de règlement des annulations, sous-ensemble bêta (US-017), et forme persistée des
 * règlements versionnés avec leurs jambes (US-018). Exporté par `@rueda/money`.
 */
export {
  CANCELLATION_ENGINE_VERSION,
  computeCancellationSettlement,
  freeUntil,
} from './cancellation.ts';
export { assertPayableAmounts, type PayableAmounts } from './amounts.ts';
export { computeCaptureLegs, computeLegs, legVariation } from './legs.ts';
export {
  MONEY_OPERATION_TYPES,
  SETTLEMENT_INPUTS_HASH_PREFIX,
  SETTLEMENT_RECORD_FORMAT,
  buildSettlementRecord,
  canonicalJson,
  pspIdempotencyValue,
  settlementDelta,
  settlementInputsCanonical,
  settlementInputsHash,
  settlementLegRecords,
  settlementOperationKey,
  settlementParamsHash,
  settlementRecordPayload,
  signedLegs,
  type MoneyOperationType,
  type OperationKeyParts,
  type SettlementDelta,
  type SettlementLegRecord,
  type SettlementLineRecord,
  type SettlementRecord,
  type SettlementRecordPayload,
  type SettlementTaxRecord,
} from './record.ts';
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
