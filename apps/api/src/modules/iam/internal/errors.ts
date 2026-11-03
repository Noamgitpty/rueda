/**
 * Réponses de l'authentification : code stable (16 A.8, `SCREAMING_SNAKE_CASE` sans préfixe de
 * module) et clé de message du catalogue `@rueda/i18n` (es, en, fr ; le client affiche le texte
 * dans la langue de la vue). Jamais de détail technique, jamais de jeton.
 *
 * Codes repris de 16 ACC-001 : AUTH_EMAIL_INVALID, AUTH_PASSWORD_WEAK, AUTH_TERMS_NOT_ACCEPTED,
 * AUTH_LINK_EXPIRED, RATE_LIMITED. Codes PROPOSÉS (à reporter dans 16 A.8, voir la passation) :
 * AUTH_REQUIRED, AUTH_INVALID_CREDENTIALS, REQUEST_INVALID, SIGNUP_ACCEPTED, EMAIL_VERIFIED.
 */
import { HttpException } from '@nestjs/common';

export const AUTH_MESSAGES = {
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  AUTH_INVALID_CREDENTIALS: { status: 401, messageKey: 'common.auth.invalidCredentials' },
  AUTH_EMAIL_INVALID: { status: 400, messageKey: 'common.auth.emailInvalid' },
  AUTH_PASSWORD_WEAK: { status: 400, messageKey: 'common.auth.passwordWeak' },
  AUTH_TERMS_NOT_ACCEPTED: { status: 400, messageKey: 'common.auth.termsNotAccepted' },
  AUTH_LINK_EXPIRED: { status: 400, messageKey: 'common.auth.linkExpired' },
  RATE_LIMITED: { status: 429, messageKey: 'common.auth.rateLimited' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  SIGNUP_ACCEPTED: { status: 202, messageKey: 'common.auth.signupAccepted' },
  EMAIL_VERIFIED: { status: 200, messageKey: 'common.auth.emailVerified' },
} as const;

export type AuthCode = keyof typeof AUTH_MESSAGES;
export type AuthMessageKey = (typeof AUTH_MESSAGES)[AuthCode]['messageKey'];

export interface AuthBody {
  readonly code: AuthCode;
  readonly messageKey: AuthMessageKey;
  readonly values?: Readonly<Record<string, number | string>>;
}

export function authBody(
  code: AuthCode,
  values?: Readonly<Record<string, number | string>>,
): AuthBody {
  return {
    code,
    messageKey: AUTH_MESSAGES[code].messageKey,
    ...(values !== undefined ? { values } : {}),
  };
}

/** Erreur HTTP de l'authentification : le corps est `{ code, messageKey, values? }`. */
export class AuthHttpError extends HttpException {
  readonly code: AuthCode;

  constructor(code: AuthCode, values?: Readonly<Record<string, number | string>>, status?: number) {
    super(authBody(code, values), status ?? AUTH_MESSAGES[code].status);
    this.code = code;
  }
}
