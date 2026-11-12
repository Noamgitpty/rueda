/**
 * Erreurs des formulaires de compte (US-102) : code stable de l'API → clé du catalogue
 * `@rueda/i18n` (es, en, fr, pt). Un code inconnu ou une API injoignable donne un message
 * générique (fail-closed : jamais de texte technique, jamais de « {x} »).
 */
import type { MessageKey } from '@rueda/i18n';

export interface FormError {
  /** Identifiant du champ en erreur (`s15-form` : erreur du formulaire entier). */
  readonly fieldId: string;
  readonly key: MessageKey;
  readonly values?: Readonly<Record<string, number | string>>;
}
export type FormErrors = readonly FormError[];

const KEYS: Readonly<Record<string, MessageKey>> = {
  AUTH_EMAIL_INVALID: 'common.auth.emailInvalid',
  AUTH_PASSWORD_WEAK: 'common.auth.passwordWeak',
  AUTH_TERMS_NOT_ACCEPTED: 'common.auth.termsNotAccepted',
  AUTH_INVALID_CREDENTIALS: 'common.auth.invalidCredentials',
  AUTH_LINK_EXPIRED: 'common.auth.linkExpired',
  AUTH_REQUIRED: 'common.auth.sessionRequired',
  REQUEST_INVALID: 'common.auth.requestInvalid',
  RATE_LIMITED: 'common.auth.rateLimited',
  RATE_LIMIT_UNAVAILABLE: 'common.rateLimit.unavailable',
  BOT_CHALLENGE_REQUIRED: 'common.rateLimit.challengeRequired',
  TERMS_VERSION_CHANGED: 'common.legal.versionChanged',
  TERMS_REACCEPT_REQUIRED: 'common.legal.reacceptRequired',
  LEGAL_DOCUMENT_UNAVAILABLE: 'common.legal.unavailable',
  COUNTRY_UNKNOWN: 'common.legal.countryUnknown',
  // téléphone par OTP (US-104)
  PHONE_INVALID: 'common.error.phoneDigits',
  PHONE_NOT_ELIGIBLE: 'common.otp.notEligible',
  PHONE_ALREADY_VERIFIED: 'common.otp.alreadyVerified',
  OTP_INVALID: 'common.otp.invalid',
  OTP_EXPIRED: 'common.otp.expired',
  OTP_LOCKED: 'common.otp.locked',
  OTP_UNAVAILABLE: 'common.otp.unavailable',
  ACCOUNT_DUPLICATE_PHONE: 'common.otp.duplicatePhone',
};

export function apiErrorKey(code: string | null, status: number | 'unavailable'): MessageKey {
  if (code !== null && KEYS[code] !== undefined) return KEYS[code];
  return status === 'unavailable' ? 'common.legal.unavailable' : 'common.error.server';
}
