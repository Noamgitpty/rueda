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
