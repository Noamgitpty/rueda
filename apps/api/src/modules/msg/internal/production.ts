/**
 * Adaptateurs de PRODUCTION de la messagerie par trip (US-525, ADR-181 ; ADR-007 ; C19) : fonctions
 * `core.messaging_*` de 0161 sous `app_api`. Aucun relais WhatsApp (P1) ni notification ici : le
 * fil se lit dans l'appli (S16).
 */
import { msgConsoleLogger } from './msg-trip-messages.module.js';
import type { MsgTripMessagesOptions } from './msg-trip-messages.module.js';
import { PgTripMessageStore } from './trip-message-store.js';
import type { MsgSqlExecutor } from './trip-message-store.js';

export function postgresMsgAdapters(db: MsgSqlExecutor): MsgTripMessagesOptions {
  return { store: new PgTripMessageStore(db), log: msgConsoleLogger };
}
