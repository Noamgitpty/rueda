// Point d'entrée public du module NTF. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, ntf.module.ts) est privé (règle rueda/module-boundaries).
export { NtfModule } from './ntf.module.js';

// Port MessagingChannel (US-020, ADR-058) : types seulement ; l'adaptateur est injecté.
export type {
  DeliveryReceipt,
  DeliveryStatus,
  MessageAccepted,
  MessageChannelKind,
  MessagingChannel,
  MessagingOutcome,
  OutboundMessage,
} from './internal/messaging-channel.port.js';

// Moteur de notifications (US-021, ADR-061) : catalogue, envoi, montage sur le module BUS.
export { RULES, TEMPLATE_KEYS, TEMPLATES, subscribedEventTypes } from './internal/catalog.js';
export type {
  ChannelSpec,
  RecipientRole,
  RuleSpec,
  TemplateKey,
  TemplateSpec,
  VariableSource,
} from './internal/catalog.js';
export {
  NTF_DISPATCHER_WORKER,
  NTF_SENDER_WORKER,
  NotificationContractError,
  dispatchEvent,
  planDispatches,
} from './internal/dispatcher.js';
export type { PlannedDispatch } from './internal/dispatcher.js';
export type { RecipientContact, RecipientDirectory } from './internal/recipient-directory.port.js';
export {
  notificationCountryData,
  registerNotifications,
  repositoryLocaleConfig,
} from './internal/registration.js';
export { MAX_SEND_ATTEMPTS, NotificationSender, RETRY_BASE_SECONDS } from './internal/sender.js';
export type {
  CountryNotificationProfile,
  NotificationSenderDeps,
  NtfLogEntry,
} from './internal/sender.js';
