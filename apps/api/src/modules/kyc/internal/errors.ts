/**
 * Réponses de la vérification d'identité (US-105) : code stable (16 A.8, sans préfixe de module
 * autre que celui de 16) et clé du catalogue `@rueda/i18n` (es, en, fr, pt) ; jamais de détail
 * technique, jamais une donnée de la pièce.
 *
 * Codes de 16 VER-001 / VER-002 : `KYC_SESSION_FAILED`, `KYC_LICENSE_EXPIRED`,
 * `KYC_PROVIDER_UNAVAILABLE`, `KYC_BIOMETRIC_CONSENT_MISSING`. Repris : `AUTH_REQUIRED`,
 * `REQUEST_INVALID` (US-010), `COUNTRY_UNKNOWN` (US-102), `PHONE_NOT_VERIFIED` (US-104).
 * PROPOSÉS (à reporter dans 16 A.8, ADR-102) : `KYC_STATE`, `KYC_CONSENT_RECORDED`,
 * `KYC_CONSENT_VERSION_CHANGED`, `KYC_CONSENT_UNAVAILABLE`, `KYC_SESSION_STARTED`,
 * `KYC_SESSION_IN_PROGRESS`, `KYC_IN_REVIEW`, `KYC_ALREADY_APPROVED`, `KYC_NOT_ELIGIBLE`,
 * `KYC_DOCUMENT_UNSUPPORTED`, `KYC_NOT_APPROVED`, `KYC_DRIVER_ELIGIBLE`.
 * Vérification de l'hôte (US-123, ADR-105) : `HOST_UNDER_AGE`, `HOST_ENTITY_NOT_ALLOWED`,
 * `HOST_TAX_ID_REQUIRED`, `HOST_SANCTIONS_HIT`, `HOST_SCREENING_MISSING` (16 A.8) ; PROPOSÉS :
 * `HOST_VERIFICATION_STATE`, `HOST_VERIFICATION_SUBMITTED`, `HOST_TAX_PROFILE_SAVED`,
 * `HOST_AGE_UNVERIFIED`, `HOST_KYC_REQUIRED`, `HOST_RESIDENCE_MISMATCH`, `HOST_ACCOUNT_NOT_ELIGIBLE`,
 * `HOST_VERIFICATION_LOCKED`, `HOST_TAX_ID_KIND_INVALID`, `HOST_TAX_ID_INVALID`,
 * `HOST_TAX_VAULT_UNAVAILABLE`, `HOST_VERIFICATION_UNAVAILABLE`.
 */
import { HttpException } from '@nestjs/common';

export const KYC_MESSAGES = {
  KYC_STATE: { status: 200, messageKey: 'common.kyc.state' },
  KYC_CONSENT_RECORDED: { status: 200, messageKey: 'common.kyc.consentRecorded' },
  KYC_CONSENT_VERSION_CHANGED: { status: 409, messageKey: 'common.kyc.consentVersionChanged' },
  KYC_CONSENT_UNAVAILABLE: { status: 503, messageKey: 'common.kyc.consentUnavailable' },
  KYC_SESSION_STARTED: { status: 201, messageKey: 'common.kyc.sessionStarted' },
  KYC_SESSION_IN_PROGRESS: { status: 200, messageKey: 'common.kyc.sessionInProgress' },
  KYC_BIOMETRIC_CONSENT_MISSING: { status: 403, messageKey: 'common.kyc.consentMissing' },
  PHONE_NOT_VERIFIED: { status: 403, messageKey: 'common.otp.phoneRequired' },
  KYC_NOT_ELIGIBLE: { status: 403, messageKey: 'common.kyc.notEligible' },
  KYC_IN_REVIEW: { status: 409, messageKey: 'common.kyc.inReview' },
  KYC_ALREADY_APPROVED: { status: 409, messageKey: 'common.kyc.alreadyApproved' },
  KYC_DOCUMENT_UNSUPPORTED: { status: 422, messageKey: 'common.kyc.documentUnsupported' },
  KYC_SESSION_FAILED: { status: 502, messageKey: 'common.kyc.sessionFailed' },
  KYC_PROVIDER_UNAVAILABLE: { status: 503, messageKey: 'common.kyc.providerUnavailable' },
  // US-111 (16 LEG-010, ADR-118) : registre Ley 81 du pays non validé en production ; même texte
  // que l'indisponibilité du fournisseur (aucun détail juridique montré à la personne)
  KYC_PRODUCTION_BLOCKED_NO_REGISTER: {
    status: 503,
    messageKey: 'common.kyc.providerUnavailable',
  },
  KYC_NOT_APPROVED: { status: 403, messageKey: 'common.kyc.notApproved' },
  KYC_LICENSE_EXPIRED: { status: 403, messageKey: 'common.kyc.licenseExpired' },
  KYC_DRIVER_ELIGIBLE: { status: 200, messageKey: 'common.kyc.driverEligible' },
  // Vérification de l'hôte (US-123, ADR-105) : HOST_UNDER_AGE, HOST_ENTITY_NOT_ALLOWED (16 A.8,
  // clés d'US-107), HOST_ACCOUNT_NOT_FOUND (code d'US-115) ; les autres sont PROPOSÉS.
  HOST_VERIFICATION_STATE: { status: 200, messageKey: 'common.hostVerification.state' },
  HOST_VERIFICATION_SUBMITTED: { status: 200, messageKey: 'common.hostVerification.submitted' },
  HOST_TAX_PROFILE_SAVED: { status: 200, messageKey: 'common.hostVerification.taxSaved' },
  HOST_ACCOUNT_NOT_FOUND: { status: 404, messageKey: 'common.listing.hostNotFound' },
  HOST_ENTITY_NOT_ALLOWED: { status: 422, messageKey: 'common.host.entityNotAllowed' },
  HOST_UNDER_AGE: { status: 403, messageKey: 'common.host.underAge' },
  HOST_AGE_UNVERIFIED: { status: 403, messageKey: 'common.hostVerification.ageUnverified' },
  HOST_KYC_REQUIRED: { status: 403, messageKey: 'common.hostVerification.kycRequired' },
  HOST_RESIDENCE_MISMATCH: { status: 403, messageKey: 'common.hostVerification.residenceMismatch' },
  HOST_ACCOUNT_NOT_ELIGIBLE: {
    status: 409,
    messageKey: 'common.hostVerification.accountNotEligible',
  },
  HOST_VERIFICATION_LOCKED: { status: 409, messageKey: 'common.hostVerification.locked' },
  HOST_TAX_ID_KIND_INVALID: { status: 422, messageKey: 'common.hostVerification.taxKindInvalid' },
  HOST_TAX_ID_INVALID: { status: 422, messageKey: 'common.hostVerification.taxIdInvalid' },
  HOST_TAX_VAULT_UNAVAILABLE: {
    status: 503,
    messageKey: 'common.hostVerification.vaultUnavailable',
  },
  HOST_VERIFICATION_UNAVAILABLE: { status: 503, messageKey: 'common.hostVerification.unavailable' },
  COUNTRY_UNKNOWN: { status: 400, messageKey: 'common.legal.countryUnknown' },
  REQUEST_INVALID: { status: 400, messageKey: 'common.auth.requestInvalid' },
  AUTH_REQUIRED: { status: 401, messageKey: 'common.auth.sessionRequired' },
} as const;

export type KycCode = keyof typeof KYC_MESSAGES;

export interface KycBody {
  readonly code: KycCode;
  readonly messageKey: (typeof KYC_MESSAGES)[KycCode]['messageKey'];
}

export function kycBody(code: KycCode): KycBody {
  return { code, messageKey: KYC_MESSAGES[code].messageKey };
}

/** Erreur HTTP de la vérification d'identité : corps `{ code, messageKey }`. */
export class KycHttpError extends HttpException {
  readonly code: KycCode;

  constructor(code: KycCode) {
    super(kycBody(code), KYC_MESSAGES[code].status);
    this.code = code;
  }
}
