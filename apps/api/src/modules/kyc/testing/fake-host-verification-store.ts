/**
 * FAKE du magasin de la vérification de l'hôte (US-123) — TESTS SEULEMENT, jamais compilé en
 * production (`testing/` exclu par tsconfig.build.json). Mémoire seulement ; reproduit les issues
 * des commandes `core.kyc_*` de 0075 utiles aux contrats d'API (compte de la session, profil
 * fiscal, soumission, filtrage, pièces manquantes). Les règles elles-mêmes (âge, résidence,
 * activation, interrupteurs) sont prouvées sur PostgreSQL (packages/db/test/l0/l0-us123-*).
 */
import type {
  HostMissing,
  HostVerificationState,
  HostVerificationStore,
  ScreeningRecordOutcome,
  ScreeningToRecord,
  StateResult,
  SubmitOutcome,
  SubmitResult,
  TaxOutcome,
  TaxProfileToSave,
} from '../internal/host-verification-store.js';
import { HostVerificationStoreError } from '../internal/host-verification-store.js';

interface Account {
  readonly owner: string;
  readonly country: string;
  readonly taxKinds: readonly string[];
  /** Contrôles de la personne posés par le test (KYC, âge, résidence, CGU). */
  kycApproved: boolean;
  ageStatus: HostVerificationState['ageStatus'];
  residenceStatus: HostVerificationState['residenceStatus'];
  termsAccepted: boolean;
  orgStatus: HostVerificationState['orgStatus'];
  verificationStatus: HostVerificationState['verificationStatus'];
  tax: { kind: string; envelope: Buffer; regime: string | null } | null;
  screening: ScreeningToRecord | null;
}

export class FakeHostVerificationStore implements HostVerificationStore {
  /** Panne simulée de la base (toutes les opérations). */
  failing = false;
  /** Issue imposée de la soumission (refus jugé en base). */
  submitRefusal: Exclude<SubmitOutcome, 'SUBMITTED' | 'DECIDED'> | null = null;
  readonly #accounts = new Map<string, Account>();

  /** Compte d'hôte `orgId` de la personne dont la session a l'empreinte `ownerHash` (hex). */
  addAccount(
    ownerHash: string,
    orgId: string,
    country: string,
    taxKinds: readonly string[],
    checks: Partial<
      Pick<Account, 'kycApproved' | 'ageStatus' | 'residenceStatus' | 'termsAccepted' | 'orgStatus'>
    > = {},
  ): void {
    this.#accounts.set(orgId, {
      owner: ownerHash,
      country,
      taxKinds,
      kycApproved: checks.kycApproved ?? true,
      ageStatus: checks.ageStatus ?? 'OK',
      residenceStatus: checks.residenceStatus ?? 'VERIFIED',
      termsAccepted: checks.termsAccepted ?? true,
      orgStatus: checks.orgStatus ?? 'ONBOARDING',
      verificationStatus: null,
      tax: null,
      screening: null,
    });
  }

  /** Lecture du test : profil fiscal consigné (enveloppe seulement). */
  taxOf(orgId: string): Account['tax'] {
    return this.#accounts.get(orgId)?.tax ?? null;
  }

  /** Lecture du test : filtrage consigné. */
  screeningOf(orgId: string): ScreeningToRecord | null {
    return this.#accounts.get(orgId)?.screening ?? null;
  }

  /** Panne simulée : promesse rejetée (comme un pilote de base injoignable). */
  #down<T>(operation: string): Promise<T> | null {
    return this.failing ? Promise.reject(new HostVerificationStoreError(operation, '08006')) : null;
  }

  #own(tokenHash: Buffer, orgId: string): Account | null {
    const a = this.#accounts.get(orgId);
    return a !== undefined && a.owner === tokenHash.toString('hex') ? a : null;
  }

  #missing(a: Account): HostMissing[] {
    const m: HostMissing[] = [];
    if (!a.kycApproved) m.push('HOST_KYC_REQUIRED');
    if (a.screening === null) m.push('HOST_SCREENING_MISSING');
    if (a.tax === null) m.push('HOST_TAX_ID_REQUIRED');
    if (!a.termsAccepted) m.push('TERMS_REACCEPT_REQUIRED');
    return m;
  }

  #refresh(a: Account): void {
    if (
      a.verificationStatus === null ||
      ['OPEN', 'DOCS_PENDING', 'IN_REVIEW'].includes(a.verificationStatus)
    ) {
      a.verificationStatus = this.#missing(a).length === 0 ? 'IN_REVIEW' : 'DOCS_PENDING';
    }
  }

  state(tokenHash: Buffer, orgId: string): Promise<StateResult> {
    const down = this.#down<StateResult>('state');
    if (down !== null) return down;
    const a = this.#own(tokenHash, orgId);
    if (a === null) return Promise.resolve({ outcome: 'FORBIDDEN' });
    const blockers: HostVerificationState['blockers'] =
      a.orgStatus === 'ACTIVE'
        ? []
        : [
            ...(a.ageStatus === 'UNDER_AGE' ? (['HOST_UNDER_AGE'] as const) : []),
            ...(a.tax === null ? (['HOST_TAX_ID_REQUIRED'] as const) : []),
            ...(a.termsAccepted ? [] : (['TERMS_REACCEPT_REQUIRED'] as const)),
            ...(a.verificationStatus === 'APPROVED'
              ? []
              : (['HOST_VERIFICATION_NOT_APPROVED'] as const)),
            'SUBMERCHANT_NOT_ACTIVE',
            'P2P_HOSTS_DISABLED',
            'INSURER_CONTRACT_INACTIVE',
          ];
    return Promise.resolve({
      outcome: 'OK',
      state: {
        country: a.country,
        orgStatus: a.orgStatus,
        verificationStatus: a.verificationStatus,
        missing: a.verificationStatus === null ? [] : this.#missing(a),
        kycApproved: a.kycApproved,
        ageStatus: a.ageStatus,
        residenceStatus: a.residenceStatus,
        taxRequired: true,
        taxSaved: a.tax !== null,
        taxKind: a.tax?.kind ?? null,
        taxKinds: [...a.taxKinds],
        termsAccepted: a.termsAccepted,
        screeningDone: a.screening !== null,
        blockers,
      },
    });
  }

  saveTaxProfile(tokenHash: Buffer, orgId: string, p: TaxProfileToSave): Promise<TaxOutcome> {
    const down = this.#down<TaxOutcome>('save_tax_profile');
    if (down !== null) return down;
    const a = this.#own(tokenHash, orgId);
    if (a === null) return Promise.resolve('FORBIDDEN');
    if (p.taxpayerKind !== 'INDIVIDUAL') return Promise.resolve('HOST_ENTITY_NOT_ALLOWED');
    if (!a.taxKinds.includes(p.kind)) return Promise.resolve('HOST_TAX_ID_KIND_INVALID');
    if (p.envelope.length < 30 || p.envelope[0] !== 1) return Promise.resolve('REQUEST_INVALID');
    if (['APPROVED', 'REJECTED', 'REVOKED', 'BLOCKED'].includes(a.verificationStatus ?? '')) {
      return Promise.resolve('HOST_VERIFICATION_LOCKED');
    }
    a.tax = { kind: p.kind, envelope: p.envelope, regime: p.regime };
    return Promise.resolve('SAVED');
  }

  submit(tokenHash: Buffer, orgId: string): Promise<SubmitResult> {
    const down = this.#down<SubmitResult>('submit');
    if (down !== null) return down;
    const a = this.#own(tokenHash, orgId);
    if (a === null) return Promise.resolve({ outcome: 'FORBIDDEN', screening: null });
    if (['APPROVED', 'REJECTED', 'REVOKED', 'BLOCKED'].includes(a.verificationStatus ?? '')) {
      return Promise.resolve({ outcome: 'DECIDED', screening: null });
    }
    if (this.submitRefusal !== null) {
      return Promise.resolve({ outcome: this.submitRefusal, screening: null });
    }
    if (!a.kycApproved) return Promise.resolve({ outcome: 'HOST_KYC_REQUIRED', screening: null });
    if (a.ageStatus === 'UNDER_AGE') {
      return Promise.resolve({ outcome: 'HOST_UNDER_AGE', screening: null });
    }
    this.#refresh(a);
    return Promise.resolve({
      outcome: 'SUBMITTED',
      screening:
        a.screening === null
          ? {
              key: `screening:${orgId}:a1`,
              identityProvider: 'FAKE',
              identitySessionRef: `fk_idv_${orgId.slice(0, 8)}`,
            }
          : null,
    });
  }

  recordScreening(
    tokenHash: Buffer,
    orgId: string,
    s: ScreeningToRecord,
  ): Promise<ScreeningRecordOutcome> {
    const down = this.#down<ScreeningRecordOutcome>('record_screening');
    if (down !== null) return down;
    const a = this.#own(tokenHash, orgId);
    if (a === null) return Promise.resolve('FORBIDDEN');
    if (a.screening !== null) {
      return Promise.resolve(a.screening.key === s.key ? 'DUPLICATE' : 'ALREADY_SCREENED');
    }
    a.screening = s;
    if (s.result === 'CLEAR') this.#refresh(a);
    else a.verificationStatus = 'BLOCKED';
    return Promise.resolve('RECORDED');
  }
}
