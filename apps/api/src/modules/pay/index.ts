// Point d'entrée public du module PAY. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, pay.module.ts) est privé (règle rueda/module-boundaries).
// Les adaptateurs FAKE (testing/) ne sont JAMAIS exportés ici (C19).
export { PayModule } from './pay.module.js';
export { PayWebhookModule } from './internal/pay-webhook.module.js';
export type { PayWebhookOptions } from './internal/pay-webhook.module.js';
export {
  postgresPayAdapters,
  PRODUCTION_PAYMENT_CONNECTORS,
  PRODUCTION_PROVIDERS,
} from './internal/production.js';
export type { PaymentConnectorRegistry, PostgresPayAdapters } from './internal/production.js';

// Port PaymentProvider (17 §2.8)
export {
  MARKETPLACE_WRITE_METHODS,
  MIT_REASONS,
  MONEY_MOVING_METHODS,
  OPERATION_STATUSES,
  PAYMENT_METHODS,
  PAYOUT_ADJUSTMENT_REASONS,
  PLATFORM_TRANSFER_REASONS,
  SUBMERCHANT_STATUSES,
} from './internal/port.js';
export type {
  AdjustPayoutRequest,
  CaptureMode,
  CaptureRequest,
  ChargeMitRequest,
  CreateHostedPaymentRequest,
  HoldLegRequest,
  HostedPayment,
  LegBalance,
  LegBalanceQuery,
  MarketplaceWriteMethod,
  MitReason,
  MoneyMovingMethod,
  NormalizedPaymentEvent,
  OperationLookup,
  OperationResult,
  OperationStatus,
  PaymentMethod,
  PaymentProvider,
  PayoutAdjustmentReason,
  PayoutRequest,
  PlatformTransferReason,
  ProviderOperation,
  ReallocateRequest,
  ReferenceRequest,
  RefundRequest,
  RegisterSubmerchantRequest,
  ReleaseLegRequest,
  RollbackRequest,
  Submerchant,
  SubmerchantStatus,
  TransferFromPlatformRequest,
  WebhookHeaders,
  WebhookVerification,
  WebhookVerifier,
} from './internal/port.js';
export {
  assertMovingLegs,
  assertPositiveAmount,
  assertReallocationLegs,
  assertTransferLegs,
  debitFromVariation,
  isLeg,
  LEGS,
  legsEqual,
  legsToJson,
  legSum,
} from './internal/legs.js';
export type { Leg, LegAmounts, LegBeneficiaries } from './internal/legs.js';
export { isPaymentError, PAYMENT_ERROR_CODES, PaymentError } from './internal/errors.js';
export type { PaymentErrorCode, PaymentErrorDetails } from './internal/errors.js';
export {
  CAPABILITIES,
  CAPABILITY_NAMES,
  CAPABILITY_STATUSES,
  CapabilitySet,
} from './internal/capabilities.js';
export type {
  CapabilityName,
  CapabilityRecord,
  CapabilityStatus,
  CollectionMode,
} from './internal/capabilities.js';

// Idempotence (08 E4) et commandes monétaires (17 §4.3)
export {
  holdAttemptKey,
  holdCompensationRefundKey,
  HOLD_OPERATION_TYPES,
  idempotencyKeyToSend,
  nextAttemptKey,
  offSettlementRefundKey,
  settlementOperationKey,
  SETTLEMENT_OPERATION_TYPES,
} from './internal/idempotency.js';
export type {
  HoldOperationType,
  SettlementKeyParts,
  SettlementOperationType,
} from './internal/idempotency.js';
export { COMMAND_KINDS, MoneyCommandSender } from './internal/money-command-sender.js';
export type { CommandKind, MoneyCommand, SendOutcome } from './internal/money-command-sender.js';

export { depositOperationKey, DEPOSIT_OPERATION_TYPES } from './internal/idempotency.js';
export type { DepositKeyParts, DepositOperationType } from './internal/idempotency.js';

// Caution « comme Turo » : déclencheurs, rails, décision, exécution (US-225, ADR-164)
export {
  DEPOSIT_TRIGGERS,
  DEPOSIT_VALUE_CLASSES,
  depositAmountFor,
  evaluateDepositTriggers,
} from './internal/deposit-triggers.js';
export type {
  DepositStage,
  DepositTrigger,
  DepositTriggerContext,
  DepositTriggerDecision,
  DepositTriggerParams,
  DepositValueClass,
} from './internal/deposit-triggers.js';
export {
  chargeLegs,
  completeRailParams,
  decideDepositGate,
  DEPOSIT_EVENTS,
  DEPOSIT_HOLD_STATUSES,
  DEPOSIT_MECHANISMS,
  depositAuthAt,
  depositAuthExpiry,
  depositDecisionAt,
  depositHoldValidityHours,
  depositReauthDueAt,
  depositReleaseAt,
  depositScheduleAfterReauth,
  isCapturableOnDeposit,
  nextDepositStatus,
  planDepositDecision,
  planDepositSchedule,
  requiredHoldMinutes,
  selectDepositRail,
} from './internal/deposit-rails.js';
export type {
  DepositDecisionInput,
  DepositDecisionPlan,
  DepositEvent,
  DepositFeePart,
  DepositGateDecision,
  DepositGateInput,
  DepositHoldStatus,
  DepositIncidentalFee,
  DepositMechanism,
  DepositRail,
  DepositRailCapabilities,
  DepositRailParams,
  DepositRailRequest,
  DepositRailSelection,
  DepositSchedule,
  DepositStep,
  CompleteRailParams,
} from './internal/deposit-rails.js';
export { DepositRailExecutor } from './internal/deposit-executor.js';
export type {
  DepositExecution,
  DepositPaymentProvider,
  DepositReauthOutcome,
  DepositReference,
  DepositStepResult,
  PlaceDepositRequest,
} from './internal/deposit-executor.js';
export { DEPOSIT_CONFIG_KEYS, PgDepositRailConfigReader } from './internal/pg-deposit-config.js';
export type { DepositRailConfig } from './internal/pg-deposit-config.js';
// Caution au checkout, vue du voyageur, minuterie de ré-autorisation (US-701, ADR-169)
export {
  DepositCheckoutGate,
  evaluateDepositCheckout,
  guestViewOfRecorded,
} from './internal/deposit-checkout.js';
export type {
  DepositCheckoutContext,
  DepositCheckoutRead,
  DepositCheckoutStore,
  DepositConfigSource,
  DepositDecisionRecord,
  DepositEnforcement,
  DepositGuestView,
  DepositReadRefusal,
  DepositRecordOutcome,
  RecordedDeposit,
} from './internal/deposit-checkout.js';
export { PgDepositCheckoutStore } from './internal/pg-deposit-checkout.js';
// Caution annoncée avant le checkout : fiche S03 et cartes, T70 c (US-701c, ADR-173)
export { preCheckoutDeposit, PreCheckoutDepositReader } from './internal/deposit-notice.js';
export type { PreCheckoutDeposit } from './internal/deposit-notice.js';
export {
  DEPOSIT_TIMER_BATCH,
  DEPOSIT_TIMER_PERIOD_SECONDS,
  DEPOSIT_TIMER_WORKER,
  DepositReauthTimer,
  PgDepositTimerStore,
  postgresDepositTimerDeps,
  registerDepositTimers,
} from './internal/deposit-timer.js';
export type {
  DepositTimerDeps,
  DepositTimerStep,
  DueDepositReauth,
} from './internal/deposit-timer.js';
// décision de la caution à l'heure de décision (US-702, ADR-172)
export {
  DEPOSIT_DECISION_BATCH,
  DepositDecisionTimer,
  NO_DEPOSIT_FEES,
  PgDepositDecisionStore,
  postgresDepositDecisionDeps,
  withoutMit,
} from './internal/deposit-decision.js';
export type {
  DepositDecisionDeps,
  DepositDecisionStep,
  DepositFeeSource,
  DepositOutcome,
  DueDepositDecision,
} from './internal/deposit-decision.js';

// Webhooks (17 §4.4)
export {
  WEBHOOK_MAX_BODY_BYTES,
  WEBHOOK_MAX_HEADER_BYTES,
  WebhookIngestService,
} from './internal/webhook-ingest.js';
export type {
  PaymentLogger,
  WebhookRequest,
  WebhookResponse,
  WebhookSecretResolver,
  WebhookVerifierRegistry,
} from './internal/webhook-ingest.js';
export { WebhookProcessor } from './internal/webhook-processor.js';
export type { ProcessorReport } from './internal/webhook-processor.js';
export { containsPan, maskPan } from './internal/pan.js';

// Persistance (commandes core.payment_cmd_*, migration 0028) et démarrage (C19)
export {
  PgOperationRecorder,
  PgRefundOrders,
  PgRefundPlanner,
  REFUND_INSTANCE_STATUSES,
  PgWebhookInboxStore,
  PgWebhookWorkStore,
  withPaymentWorker,
} from './internal/pg-stores.js';
export type {
  DueRefund,
  PaymentWorkerName,
  PlannedRefund,
  RefundInstanceStatus,
  RefundOrderForSend,
  RefundSendRefusal,
  PlanRefundInput,
  RecordOperationInput,
  RefundBlockedReason,
  SubmitRefundOutcome,
  SqlExecutor,
  SqlPool,
} from './internal/pg-stores.js';
export type {
  ApplyOutcome,
  ApplyStatusInput,
  InboxItem,
  OperationRef,
  OperationStatusStore,
  ReceiveOutcome,
  ReceiveWebhookInput,
  StatusSource,
  WebhookAccount,
  WebhookInboxStore,
  WebhookWorkStore,
} from './internal/stores.js';
export {
  assertPaymentStartup,
  checkPaymentStartup,
  fakeAdapterVariables,
} from './internal/startup-guard.js';
export type { PaymentStartupState } from './internal/startup-guard.js';

// Carte enregistrée, consentement MIT et débits post-trip (US-703, ADR-189)
export {
  MIT_CONSENT_CATALOG_VERSION,
  MIT_CONSENT_OUTCOMES,
  MIT_REMINDER_OUTCOMES,
  mitConsentLocaleOf,
  PgMitConsentStore,
  UNAVAILABLE_MIT_CONSENTS,
} from './internal/mit-consent.js';
export type {
  MitConsentOutcome,
  MitConsentPort,
  MitReminderOutcome,
} from './internal/mit-consent.js';
export {
  classifyMitError,
  MIT_CHARGE_SCHEDULER_BATCH,
  MIT_CHARGE_SCHEDULER_PERIOD_SECONDS,
  MIT_CHARGE_SCHEDULER_WORKER,
  MitChargeScheduler,
  registerMitChargeScheduler,
} from './internal/mit-charge-scheduler.js';
export type {
  MitChargeOutcome,
  MitChargeSchedulerDeps,
  MitChargeStep,
} from './internal/mit-charge-scheduler.js';
export {
  PLAN_OUTCOMES,
  POST_TRIP_CHARGE_STATUSES,
  SETTLE_OUTCOMES,
} from './internal/mit-charge-store.js';
export type {
  DueCharge,
  MitChargeStore,
  MitOrder,
  PlanOutcome,
  PlanResult,
  PostTripChargeStatus,
  SettleOutcome,
  SettleResult,
} from './internal/mit-charge-store.js';
export { MitChargeStoreError, PgMitChargeStore } from './internal/pg-mit-charge-store.js';
