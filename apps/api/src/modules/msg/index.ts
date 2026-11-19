// Point d'entrée public du module MSG. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, msg.module.ts) est privé (règle rueda/module-boundaries).
// Les adaptateurs FAKE (testing/) ne sont JAMAIS exportés ici (C19).
export { MsgModule } from './msg.module.js';

// Messagerie par trip et signal du marché gris (US-525, ADR-181)
export {
  MsgTripMessagesModule,
  unavailableMsgOptions,
} from './internal/msg-trip-messages.module.js';
export type { MsgTripMessagesOptions } from './internal/msg-trip-messages.module.js';
export { postgresMsgAdapters } from './internal/production.js';
export { PgTripMessageStore, UnavailableTripMessageStore } from './internal/trip-message-store.js';
export type { MsgSqlExecutor, TripMessageStore } from './internal/trip-message-store.js';
export { MSG_MESSAGES, MsgHttpError } from './internal/errors.js';
