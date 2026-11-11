/**
 * Réponses des routes `/legal` (US-102) : code stable (16 A.8, sans préfixe de module) et clé du
 * catalogue `@rueda/i18n` (es, en, fr, pt) ; jamais de détail technique.
 *
 * Codes : `TERMS_REACCEPT_REQUIRED` (16 ACC-001, US-102) ; `REQUEST_INVALID`, `AUTH_REQUIRED`
 * (US-010) ; PROPOSÉS (à reporter dans 16 A.8) : `TERMS_CURRENT`, `TERMS_VERSION_CHANGED`,
 * `LEGAL_DOCUMENT_UNAVAILABLE`, `LEGAL_DOCUMENT_NOT_FOUND`, `CONSENT_RECORDED`.
 */
import { HttpException } from '@nestjs/common';

export const LEGAL_MESSAGES = {
  TERMS_CURRENT: { status: 200, messageKey: 'common.legal.current' },
  TERMS_REACCEPT_REQUIRED: { status: 409, messageKey: 'common.legal.reacceptRequired' },
  TERMS_VERSION_CHANGED: { status: 409, messageKey: 'common.legal.versionChanged' },
  LEGAL_DOCUMENT_UNAVAILABLE: { status: 503, messageKey: 'common.legal.unavailable' },
  LEGAL_DOCUMENT_NOT_FOUND: { status: 404, messageKey: 'common.legal.notFound' },
  CONSENT_RECORDED: { status: 200, messageKey: 'common.legal.consentRecorded' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
} as const;

export type LegalCode = keyof typeof LEGAL_MESSAGES;

export interface LegalBody {
  readonly code: LegalCode;
  readonly messageKey: (typeof LEGAL_MESSAGES)[LegalCode]['messageKey'];
}

export function legalBody(code: LegalCode): LegalBody {
  return { code, messageKey: LEGAL_MESSAGES[code].messageKey };
}

/** Erreur HTTP des routes `/legal` : corps `{ code, messageKey }`. */
export class LegalHttpError extends HttpException {
  readonly code: LegalCode;

  constructor(code: LegalCode) {
    super(legalBody(code), LEGAL_MESSAGES[code].status);
    this.code = code;
  }
}
