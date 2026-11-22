/**
 * Réponses du compte de versement de l'hôte (US-707, ADR-180 ; 16 PYO-001) : code stable et clé
 * du catalogue `@rueda/i18n` (es, en, fr, pt) ; jamais un détail technique, jamais un numéro (ni
 * de compte, ni ses 4 derniers caractères, ni de pièce).
 *
 * Codes de 16 PYO-001 : `HOST_PAYOUT_RAIL_UNAVAILABLE`, `HOST_TAX_ID_REQUIRED`. Repris :
 * `AUTH_REQUIRED`, `REQUEST_INVALID` (US-010), `HOST_ACCOUNT_NOT_FOUND` (US-115),
 * `HOST_KYC_REQUIRED` (US-123). PROPOSÉS (à reporter dans 16 A.8, ADR-180) :
 * `PAYOUT_ACCOUNT_STATE`, `PAYOUT_ACCOUNT_SAVED`, `PAYOUT_MANAGE_FORBIDDEN`,
 * `PAYOUT_ACCOUNT_INVALID`, `PAYOUT_RAIL_UNSUPPORTED`, `PAYOUT_HOLDER_MISMATCH`,
 * `PAYOUT_VAULT_UNAVAILABLE`, `PAYOUT_ACCOUNT_UNAVAILABLE`. US-314 (ADR-192, PROPOSÉS) :
 * `PAYOUTS_READ_FORBIDDEN`, `PAYOUTS_UNAVAILABLE` (versements de l'hôte, A08).
 */
import { HttpException } from '@nestjs/common';

export const PYO_MESSAGES = {
  PAYOUT_ACCOUNT_STATE: { status: 200, messageKey: 'common.payoutAccount.state' },
  PAYOUT_ACCOUNT_SAVED: { status: 200, messageKey: 'common.payoutAccount.saved' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
  PAYOUT_MANAGE_FORBIDDEN: { status: 403, messageKey: 'common.payoutAccount.manageForbidden' },
  HOST_KYC_REQUIRED: { status: 403, messageKey: 'common.hostVerification.kycRequired' },
  HOST_ACCOUNT_NOT_FOUND: { status: 404, messageKey: 'common.listing.hostNotFound' },
  HOST_TAX_ID_REQUIRED: { status: 409, messageKey: 'common.payoutAccount.taxRequired' },
  PAYOUT_ACCOUNT_INVALID: { status: 422, messageKey: 'common.payoutAccount.invalid' },
  PAYOUT_RAIL_UNSUPPORTED: { status: 422, messageKey: 'common.payoutAccount.railUnsupported' },
  PAYOUT_HOLDER_MISMATCH: { status: 422, messageKey: 'common.payoutAccount.holderMismatch' },
  PAYOUT_VAULT_UNAVAILABLE: { status: 503, messageKey: 'common.payoutAccount.vaultUnavailable' },
  PAYOUT_ACCOUNT_UNAVAILABLE: { status: 503, messageKey: 'common.payoutAccount.unavailable' },
  HOST_PAYOUT_RAIL_UNAVAILABLE: {
    status: 503,
    messageKey: 'common.payoutAccount.railUnavailable',
  },
  // US-314 (ADR-192) : versements lus par le titulaire (A08)
  PAYOUTS_READ_FORBIDDEN: { status: 403, messageKey: 'common.payouts.readForbidden' },
  PAYOUTS_UNAVAILABLE: { status: 503, messageKey: 'common.payouts.unavailable' },
} as const;

export type PyoCode = keyof typeof PYO_MESSAGES;

export interface PyoBody {
  readonly code: PyoCode;
  readonly messageKey: (typeof PYO_MESSAGES)[PyoCode]['messageKey'];
}

export function pyoBody(code: PyoCode): PyoBody {
  return { code, messageKey: PYO_MESSAGES[code].messageKey };
}

/** Erreur HTTP du compte de versement : corps `{ code, messageKey }`. */
export class PyoHttpError extends HttpException {
  readonly code: PyoCode;

  constructor(code: PyoCode) {
    super(pyoBody(code), PYO_MESSAGES[code].status);
    this.code = code;
  }
}
