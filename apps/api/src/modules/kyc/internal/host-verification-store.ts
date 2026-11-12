/**
 * Port du magasin de la vérification de l'hôte (US-123, ADR-105) : les commandes
 * `core.kyc_host_state`, `core.kyc_cmd_host_save_tax_profile`, `core.kyc_cmd_host_submit` et
 * `core.kyc_cmd_host_record_screening` de la migration 0075 (adaptateur PostgreSQL), ou leur FAKE
 * (`../testing/`). La personne est celle de la session (empreinte du jeton) ; le compte d'hôte est
 * l'un de ses comptes titulaires, revérifié en base.
 */

/** Pièces manquantes d'un dossier (codes de 16 A.8 et d'US-126). */
export const HOST_MISSING = [
  'HOST_SCREENING_MISSING',
  'HOST_TAX_ID_REQUIRED',
  'TERMS_REACCEPT_REQUIRED',
  'HOST_KYC_REQUIRED',
] as const;
export type HostMissing = (typeof HOST_MISSING)[number];

/** Blocages de l'activation (17 §2.4), dans l'ordre où la base les rend. */
export const HOST_BLOCKERS = [
  'HOST_UNDER_AGE',
  'HOST_AGE_UNVERIFIED',
  'PARAM_MISSING',
  'HOST_RESIDENCE_MISMATCH',
  'HOST_TAX_ID_REQUIRED',
  'TERMS_REACCEPT_REQUIRED',
  'HOST_VERIFICATION_NOT_APPROVED',
  'SUBMERCHANT_NOT_ACTIVE',
  'PSP_CAPABILITY_MISSING',
  'P2P_HOSTS_DISABLED',
  'INSURER_CONTRACT_INACTIVE',
  'HOST_NOT_ACTIVATED',
] as const;
export type HostBlocker = (typeof HOST_BLOCKERS)[number];

export const ORG_STATUSES = [
  'ONBOARDING',
  'PENDING_ACTIVATION',
  'ACTIVE',
  'SUSPENDED',
  'OFFBOARDED',
] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  'OPEN',
  'DOCS_PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'REVOKED',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const AGE_STATUSES = ['OK', 'UNDER_AGE', 'UNVERIFIED'] as const;
export const RESIDENCE_STATUSES = ['VERIFIED', 'DECLARED', 'MISMATCH'] as const;

export interface HostVerificationState {
  readonly country: string;
  readonly orgStatus: OrgStatus;
  readonly verificationStatus: VerificationStatus | null;
  readonly missing: readonly HostMissing[];
  readonly kycApproved: boolean;
  readonly ageStatus: (typeof AGE_STATUSES)[number];
  readonly residenceStatus: (typeof RESIDENCE_STATUSES)[number];
  readonly taxRequired: boolean;
  readonly taxSaved: boolean;
  readonly taxKind: string | null;
  readonly taxKinds: readonly string[];
  readonly termsAccepted: boolean;
  readonly screeningDone: boolean;
  readonly blockers: readonly HostBlocker[];
}

/** Lecture : état, ou absence (session invalide / compte d'un autre). */
export type StateResult =
  | { readonly outcome: 'OK'; readonly state: HostVerificationState }
  | { readonly outcome: 'AUTH_REQUIRED' | 'FORBIDDEN' };

export const TAX_OUTCOMES = [
  'SAVED',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'HOST_ENTITY_NOT_ALLOWED',
  'HOST_TAX_ID_KIND_INVALID',
  'REQUEST_INVALID',
  'HOST_VERIFICATION_LOCKED',
] as const;
export type TaxOutcome = (typeof TAX_OUTCOMES)[number];

export const SUBMIT_OUTCOMES = [
  'SUBMITTED',
  'DECIDED',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'HOST_ACCOUNT_NOT_ELIGIBLE',
  'HOST_KYC_REQUIRED',
  'PARAM_MISSING',
  'HOST_AGE_UNVERIFIED',
  'HOST_UNDER_AGE',
  'HOST_RESIDENCE_MISMATCH',
] as const;
export type SubmitOutcome = (typeof SUBMIT_OUTCOMES)[number];

export interface SubmitResult {
  readonly outcome: SubmitOutcome;
  /** Demande de filtrage à faire (aucun filtrage consigné) : clé et session d'identité. */
  readonly screening: {
    readonly key: string;
    readonly identityProvider: string;
    readonly identitySessionRef: string;
  } | null;
}

export const SCREENING_OUTCOMES = [
  'RECORDED',
  'DUPLICATE',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'REQUEST_INVALID',
  'ALREADY_SCREENED',
] as const;
export type ScreeningRecordOutcome = (typeof SCREENING_OUTCOMES)[number];

export interface ScreeningToRecord {
  readonly provider: string;
  readonly key: string;
  readonly result: 'CLEAR' | 'POTENTIAL_MATCH' | 'CONFIRMED_MATCH';
  readonly listsVersion: Readonly<Record<string, string>>;
  readonly matchRef: string | null;
}

export interface TaxProfileToSave {
  readonly kind: string;
  readonly envelope: Buffer;
  readonly regime: string | null;
  readonly taxpayerKind: string;
}

export interface HostVerificationStore {
  state(tokenHash: Buffer, orgId: string): Promise<StateResult>;
  saveTaxProfile(tokenHash: Buffer, orgId: string, profile: TaxProfileToSave): Promise<TaxOutcome>;
  submit(tokenHash: Buffer, orgId: string): Promise<SubmitResult>;
  recordScreening(
    tokenHash: Buffer,
    orgId: string,
    screening: ScreeningToRecord,
  ): Promise<ScreeningRecordOutcome>;
}

/** Erreur du magasin (base injoignable, issue inconnue) : 503, jamais un succès supposé. */
export class HostVerificationStoreError extends Error {
  override readonly name = 'HostVerificationStoreError';
  readonly sqlstate: string | undefined;

  constructor(operation: string, sqlstate: string | undefined) {
    super(`magasin de la vérification de l'hôte : ${operation}`);
    this.sqlstate = sqlstate;
  }
}

/** Magasin indisponible (aucun adaptateur) : toute opération échoue (503, fail-closed). */
export class UnavailableHostVerificationStore implements HostVerificationStore {
  state(): Promise<StateResult> {
    return Promise.reject(new HostVerificationStoreError('state', undefined));
  }
  saveTaxProfile(): Promise<TaxOutcome> {
    return Promise.reject(new HostVerificationStoreError('save_tax_profile', undefined));
  }
  submit(): Promise<SubmitResult> {
    return Promise.reject(new HostVerificationStoreError('submit', undefined));
  }
  recordScreening(): Promise<ScreeningRecordOutcome> {
    return Promise.reject(new HostVerificationStoreError('record_screening', undefined));
  }
}
