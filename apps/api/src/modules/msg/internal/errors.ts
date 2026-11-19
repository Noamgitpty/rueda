/**
 * Réponses de la messagerie par trip (US-525, ADR-181 ; 16 MSG-001 / MSG-007) : code stable et clé
 * du catalogue `@rueda/i18n` (es, en, fr, pt). Jamais un détail technique, jamais le texte d'un
 * message dans une erreur.
 *
 * Code de 16 A.8 : `MESSAGE_THREAD_CLOSED`. Repris : `AUTH_REQUIRED`, `REQUEST_INVALID` (US-010),
 * `TRIP_NOT_FOUND` (US-214). PROPOSÉS (à reporter dans 16 A.8, ADR-181) : `TRIP_MESSAGES`,
 * `MESSAGE_SENT`, `MESSAGE_INVALID`, `MESSAGES_UNAVAILABLE`.
 */
import { HttpException } from '@nestjs/common';

export const MSG_MESSAGES = {
  TRIP_MESSAGES: { status: 200, messageKey: 'common.messages.thread' },
  MESSAGE_SENT: { status: 201, messageKey: 'common.messages.sent' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  TRIP_NOT_FOUND: { status: 404, messageKey: 'common.trips.notFound' },
  MESSAGE_THREAD_CLOSED: { status: 409, messageKey: 'common.messages.threadClosed' },
  MESSAGE_INVALID: { status: 422, messageKey: 'common.messages.invalid' },
  MESSAGES_UNAVAILABLE: { status: 503, messageKey: 'common.messages.unavailable' },
} as const;

export type MsgCode = keyof typeof MSG_MESSAGES;

export interface MsgBody {
  readonly code: MsgCode;
  readonly messageKey: (typeof MSG_MESSAGES)[MsgCode]['messageKey'];
}

export function msgBody(code: MsgCode): MsgBody {
  return { code, messageKey: MSG_MESSAGES[code].messageKey };
}

/** Erreur HTTP de la messagerie : corps `{ code, messageKey }`. */
export class MsgHttpError extends HttpException {
  readonly code: MsgCode;

  constructor(code: MsgCode) {
    super(msgBody(code), MSG_MESSAGES[code].status);
    this.code = code;
  }
}
