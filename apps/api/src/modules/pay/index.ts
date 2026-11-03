// Point d'entrée public du module PAY. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, pay.module.ts) est privé (règle rueda/module-boundaries).
// Les adaptateurs FAKE (testing/) ne sont JAMAIS exportés ici (C19).
export { PayModule } from './pay.module.js';
export { PayWebhookModule } from './internal/pay-webhook.module.js';
export type { PayWebhookOptions } from './internal/pay-webhook.module.js';
export { postgresPayAdapters, PRODUCTION_PROVIDERS } from './internal/production.js';
export type { PostgresPayAdapters } from './internal/production.js';

// Port PaymentProvider (17 §2.8)
export {
  MIT_REASONS,
  MONEY_MOVING_METHODS,
  OPERATION_STATUSES,
  PAYMENT_METHODS,
} from './internal/port.js';
export type {
  CaptureMode,
  CaptureRequest,
  ChargeMitRequest,
  CreateHostedPaymentRequest,
  HostedPayment,
  MitReason,
  MoneyMovingMethod,
  NormalizedPaymentEvent,
  OperationLookup,
  OperationResult,
  OperationStatus,
  PaymentMethod,
  PaymentProvider,
  ProviderOperation,
  ReallocateRequest,
  ReferenceRequest,
  RefundRequest,
  RollbackRequest,
  WebhookHeaders,
  WebhookVerification,
  WebhookVerifier,
} from './internal/port.js';
export {
  assertMovingLegs,
  assertReallocationLegs,
  debitFromVariation,
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
  PgWebhookInboxStore,
  PgWebhookWorkStore,
  withPaymentWorker,
} from './internal/pg-stores.js';
export type {
  PaymentWorkerName,
  RecordOperationInput,
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
