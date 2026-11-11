/**
 * Réponses de l'authentification : code stable (16 A.8, `SCREAMING_SNAKE_CASE` sans préfixe de
 * module) et clé de message du catalogue `@rueda/i18n` (es, en, fr ; le client affiche le texte
 * dans la langue de la vue). Jamais de détail technique, jamais de jeton.
 *
 * Codes repris de 16 ACC-001 : AUTH_EMAIL_INVALID, AUTH_PASSWORD_WEAK, AUTH_TERMS_NOT_ACCEPTED,
 * AUTH_LINK_EXPIRED, RATE_LIMITED. Codes PROPOSÉS (à reporter dans 16 A.8, voir la passation) :
 * AUTH_REQUIRED, AUTH_INVALID_CREDENTIALS, REQUEST_INVALID, SIGNUP_ACCEPTED, EMAIL_VERIFIED.
 * Console interne (US-012) : FORBIDDEN, 2FA_REQUIRED (16 ADM-001) ; PROPOSÉS : AUTH_TOTP_INVALID,
 * AUTH_TOTP_LOCKED, STAFF_MFA_UNAVAILABLE, STAFF_ACTION_UNAVAILABLE, STAFF_ACTION_RECORDED,
 * STAFF_ACTION_DONE ; cadre des actions (US-101) : STAFF_ACTION_REQUESTED, STAFF_ACTION_REFUSED,
 * STAFF_SELF_APPROVAL.
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
  // Consentements à l'inscription (US-102) : PROPOSÉS, à reporter dans 16 A.8.
  TERMS_VERSION_CHANGED: { status: 409, messageKey: 'common.legal.versionChanged' },
  LEGAL_DOCUMENT_UNAVAILABLE: { status: 503, messageKey: 'common.legal.unavailable' },
  COUNTRY_UNKNOWN: { status: 400, messageKey: 'common.legal.countryUnknown' },
  // Console interne (US-012) : FORBIDDEN et 2FA_REQUIRED viennent de 16 ADM-001 ; les autres sont
  // PROPOSÉS (à reporter dans 16 A.8, voir la passation US-012).
  FORBIDDEN: { status: 403, messageKey: 'common.auth.forbidden' },
  '2FA_REQUIRED': { status: 403, messageKey: 'common.auth.twoFactorRequired' },
  AUTH_TOTP_INVALID: { status: 400, messageKey: 'common.auth.totpInvalid' },
  AUTH_TOTP_LOCKED: { status: 429, messageKey: 'common.auth.totpLocked' },
  STAFF_MFA_UNAVAILABLE: { status: 503, messageKey: 'common.auth.mfaUnavailable' },
  STAFF_ACTION_UNAVAILABLE: { status: 409, messageKey: 'common.auth.actionUnavailable' },
  STAFF_ACTION_RECORDED: { status: 201, messageKey: 'common.auth.actionRecorded' },
  STAFF_ACTION_DONE: { status: 200, messageKey: 'common.auth.actionDone' },
  // Cadre des actions de console (US-101, PROPOSÉS) : demande FINANCE en attente d'une seconde
  // personne, refus de la commande de domaine, auto-approbation refusée (RLS-24).
  STAFF_ACTION_REQUESTED: { status: 201, messageKey: 'common.auth.actionRequested' },
  STAFF_ACTION_REFUSED: { status: 409, messageKey: 'common.auth.actionRefused' },
  STAFF_SELF_APPROVAL: { status: 409, messageKey: 'common.auth.selfApproval' },
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
