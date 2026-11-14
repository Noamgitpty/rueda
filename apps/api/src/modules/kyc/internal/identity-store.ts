/**
 * Port de persistance de la vérification d'identité (US-105, ADR-102) : les seules commandes
 * `core.kyc_*` de 0072 (`SECURITY DEFINER`, `EXECUTE` au seul `app_api`). La personne est
 * désignée par l'empreinte de son jeton de session (jamais un identifiant reçu du client) ; la base
 * juge tout à son horloge (consentement à la version en vigueur, téléphone, état SM-3, échéance
 * du permis, rétention des scores).
 *
 * Implémentations : `PgIdentityStore` (production) ; `FakeIdentityStore` (`../testing/`, TESTS
 * SEULEMENT) ; `UnavailableIdentityStore` (aucun magasin : KYC indisponible, fail-closed).
 */
import type { IdentityDecisionEvent } from './identity-provider.port.js';

/** Statuts SM-3 (17 §3.2.2). */
export const KYC_STATUSES = [
  'NOT_STARTED',
  'PHONE_VERIFIED',
  'DOCS_SUBMITTED',
  'AUTO_CHECKS',
  'MANUAL_REVIEW',
  'MORE_INFO_REQUIRED',
  'APPROVED',
  'RECHECK',
  'EXPIRED',
  'REVOKED',
  'REJECTED',
  'APPEAL',
  'REJECTED_FINAL',
  'BANNED',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export interface BiometricConsentText {
  /** Version en vigueur (VER-004) ; le client la renvoie à l'acceptation. */
  readonly version: number;
  /** Version acceptée par la personne, si c'est la version en vigueur ; sinon `null`. */
  readonly acceptedVersion: number | null;
  readonly locale: string;
  readonly title: string;
  readonly bodyMd: string;
}

/** État de la vérification de la personne de la session (`null` : session invalide). */
export interface IdentityState {
  readonly status: KycStatus;
  /** Pays du dossier (pays de délivrance du permis), `null` avant toute ouverture. */
  readonly country: string | null;
  readonly reasonCode: string | null;
  /** Échéance du permis (AAAA-MM-JJ) lue par le fournisseur, la sienne seulement. */
  readonly licenseExpiresOn: string | null;
  /** Session hébergée encore vivante (reprise possible). */
  readonly sessionLive: boolean;
  /** Téléphone vérifié (pré-requis de l'ouverture, SM-3 `PHONE_VERIFIED`). */
  readonly phoneVerified: boolean;
  /** `null` : aucun texte en vigueur (fail-closed : aucune vérification possible). */
  readonly consent: BiometricConsentText | null;
}

export const CONSENT_OUTCOMES = [
  'RECORDED',
  'AUTH_REQUIRED',
  'NOT_ELIGIBLE',
  'COUNTRY_UNKNOWN',
  'CONSENT_UNAVAILABLE',
  'VERSION_CHANGED',
] as const;
export type ConsentOutcome = (typeof CONSENT_OUTCOMES)[number];

export const OPEN_OUTCOMES = [
  'READY',
  'IN_PROGRESS',
  'AUTH_REQUIRED',
  'COUNTRY_UNKNOWN',
  'NOT_ELIGIBLE',
  'PHONE_NOT_VERIFIED',
  'CONSENT_MISSING',
  'IN_REVIEW',
  'ALREADY_APPROVED',
  'PROVIDER_INVALID',
  'PRODUCTION_BLOCKED',
] as const;
export type OpenOutcome = (typeof OPEN_OUTCOMES)[number];

export interface OpenResult {
  readonly outcome: OpenOutcome;
  readonly verificationId: string | null;
  readonly attempt: number | null;
  readonly hostedUrl: string | null;
  readonly sessionExpiresAt: Date | null;
}

export const RECORD_OUTCOMES = [
  'RECORDED',
  'AUTH_REQUIRED',
  'NOT_FOUND',
  'SUPERSEDED',
  'INVALID',
] as const;
export type RecordOutcome = (typeof RECORD_OUTCOMES)[number];

export interface SessionToRecord {
  readonly verificationId: string;
  readonly attempt: number;
  readonly provider: string;
  readonly sessionRef: string;
  readonly hostedUrl: string;
  readonly expiresAt: Date;
}

export const DECISION_OUTCOMES = [
  'APPLIED',
  'DUPLICATE',
  'UNKNOWN_SESSION',
  'STALE',
  'CONSENT_WITHDRAWN',
  'PRODUCTION_BLOCKED',
] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];

export interface DecisionResult {
  readonly outcome: DecisionOutcome;
  readonly status: KycStatus | null;
}

export type WebhookRejectionReason = 'BAD_SIGNATURE' | 'STALE' | 'MALFORMED';

export const ELIGIBILITY_OUTCOMES = [
  'ELIGIBLE',
  'AUTH_REQUIRED',
  'COUNTRY_UNKNOWN',
  'REQUEST_INVALID',
  'KYC_NOT_APPROVED',
  'KYC_BIOMETRIC_CONSENT_MISSING',
  'KYC_LICENSE_EXPIRED',
] as const;

/** Demande d'effacement en attente (retrait du consentement) : à exécuter chez le fournisseur. */
export interface PendingErasure {
  readonly requestId: string;
  readonly provider: string;
  readonly sessionRef: string;
}

export type ErasureOutcome = 'RECORDED' | 'AUTH_REQUIRED' | 'NOT_FOUND';

/** Issues du changement du nom légal (US-103, `core.kyc_cmd_change_legal_name`). */
export const LEGAL_NAME_OUTCOMES = [
  'CHANGED',
  'UNCHANGED',
  'AUTH_REQUIRED',
  'NOT_ELIGIBLE',
  'NAME_REQUIRED',
  'LOCKED_PENDING_REVIEW',
] as const;
export type LegalNameOutcome = (typeof LEGAL_NAME_OUTCOMES)[number];

export interface LegalNameResult {
  readonly outcome: LegalNameOutcome;
  /** Statut SM-3 après le changement (`RECHECK` si le dossier était approuvé). */
  readonly status: KycStatus | null;
}

/**
 * Garde du KYC de production (US-111, LEG-010, ADR-118) : `KYC_PRODUCTION_BLOCKED_NO_REGISTER` en
 * production tant que le registre Ley 81 du pays n'est pas validé ou qu'aucun fournisseur KYC
 * contractuel n'est inscrit ; `null` hors production (données synthétiques).
 */
export type RegisterGate = 'KYC_PRODUCTION_BLOCKED_NO_REGISTER' | null;
export type EligibilityOutcome = (typeof ELIGIBILITY_OUTCOMES)[number];

export interface IdentityStore {
  state(tokenHash: Buffer, country: string | null): Promise<IdentityState | null>;
  /** Acceptation (version affichée) ou retrait du consentement biométrique. */
  consent(
    tokenHash: Buffer,
    country: string | null,
    version: number | null,
    accepted: boolean,
  ): Promise<{ readonly outcome: ConsentOutcome; readonly version: number | null }>;
  /** Garde du registre Ley 81 du pays (US-111), jugée en base avant toute ouverture. */
  registerGate(country: string): Promise<RegisterGate>;
  /** Juge et prépare une tentative ; aucune écriture hors READY. */
  open(tokenHash: Buffer, country: string, provider: string): Promise<OpenResult>;
  /** Pose la session hébergée sur la tentative courante (SM-3 DOCS_SUBMITTED). */
  recordSession(tokenHash: Buffer, session: SessionToRecord): Promise<RecordOutcome>;
  /** Décision du fournisseur, rappel déjà vérifié par l'adaptateur (idempotente par événement). */
  applyDecision(provider: string, event: IdentityDecisionEvent): Promise<DecisionResult>;
  /** Journal d'un rappel rejeté : empreinte SHA-256 et longueur du corps, jamais le corps. */
  recordRejection(
    provider: string,
    reason: WebhookRejectionReason,
    bodySha256: Buffer,
    bodyLength: number,
  ): Promise<void>;
  /**
   * Changement du nom légal (US-103) : la base le refuse pendant une décision en cours et fait
   * passer un dossier approuvé en `RECHECK`.
   */
  changeLegalName(tokenHash: Buffer, first: string, last: string): Promise<LegalNameResult>;
  /** Contrôle bloquant du paiement (US-209) : permis valable jusqu'à la fin du trip. */
  eligibility(tokenHash: Buffer, tripEnd: Date, tripCountry: string): Promise<EligibilityOutcome>;
  /** Demandes d'effacement en attente de la personne de la session (après un retrait). */
  pendingErasures(tokenHash: Buffer): Promise<readonly PendingErasure[]>;
  /** Issue d'une demande d'effacement : `DONE` (attestation) ou `FAILED` (refus du fournisseur). */
  recordErasure(
    tokenHash: Buffer,
    requestId: string,
    outcome: 'DONE' | 'FAILED',
    attestationRef: string | null,
  ): Promise<ErasureOutcome>;
}

/** Échec de la base : opération et SQLSTATE seulement (jamais un message du serveur). */
export class IdentityStoreError extends Error {
  override readonly name = 'IdentityStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`KYC : échec de la base (${operation}${sqlstate ? `, SQLSTATE ${sqlstate}` : ''})`);
    this.sqlstate = sqlstate;
  }
}

/** Aucun magasin : tout appel échoue (l'API rend KYC_PROVIDER_UNAVAILABLE). */
export class UnavailableIdentityStore implements IdentityStore {
  state(): Promise<IdentityState | null> {
    return Promise.reject(new IdentityStoreError('state', undefined));
  }
  consent(): Promise<{ readonly outcome: ConsentOutcome; readonly version: number | null }> {
    return Promise.reject(new IdentityStoreError('consent', undefined));
  }
  registerGate(): Promise<RegisterGate> {
    return Promise.reject(new IdentityStoreError('register_gate', undefined));
  }
  open(): Promise<OpenResult> {
    return Promise.reject(new IdentityStoreError('open', undefined));
  }
  recordSession(): Promise<RecordOutcome> {
    return Promise.reject(new IdentityStoreError('record_session', undefined));
  }
  applyDecision(): Promise<DecisionResult> {
    return Promise.reject(new IdentityStoreError('apply_decision', undefined));
  }
  recordRejection(): Promise<void> {
    return Promise.reject(new IdentityStoreError('record_rejection', undefined));
  }
  changeLegalName(): Promise<LegalNameResult> {
    return Promise.reject(new IdentityStoreError('change_legal_name', undefined));
  }
  eligibility(): Promise<EligibilityOutcome> {
    return Promise.reject(new IdentityStoreError('eligibility', undefined));
  }
  pendingErasures(): Promise<readonly PendingErasure[]> {
    return Promise.reject(new IdentityStoreError('pending_erasures', undefined));
  }
  recordErasure(): Promise<ErasureOutcome> {
    return Promise.reject(new IdentityStoreError('record_erasure', undefined));
  }
}
