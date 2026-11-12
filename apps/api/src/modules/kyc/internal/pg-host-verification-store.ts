/**
 * Adaptateur PostgreSQL du magasin de la vérification de l'hôte (US-123, ADR-105) : appelle les
 * seules fonctions `core.kyc_*` de la migration 0075 (`SECURITY DEFINER`, `EXECUTE` au seul
 * `app_api`). Requêtes paramétrées uniquement. Erreur de la base ⇒ erreur sans message du serveur
 * (SQLSTATE seulement) ; issue inconnue ⇒ erreur (fail-closed : jamais un succès supposé).
 */
import {
  AGE_STATUSES,
  HOST_BLOCKERS,
  HOST_MISSING,
  HostVerificationStoreError,
  ORG_STATUSES,
  RESIDENCE_STATUSES,
  SCREENING_OUTCOMES,
  SUBMIT_OUTCOMES,
  TAX_OUTCOMES,
  VERIFICATION_STATUSES,
} from './host-verification-store.js';
import type {
  HostVerificationStore,
  ScreeningRecordOutcome,
  ScreeningToRecord,
  StateResult,
  SubmitResult,
  TaxOutcome,
  TaxProfileToSave,
} from './host-verification-store.js';
import type { KycSqlExecutor } from './pg-identity-store.js';

function member<T extends string>(list: readonly T[], value: unknown, operation: string): T {
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  throw new HostVerificationStoreError(`${operation}: issue inconnue`, undefined);
}

function members<T extends string>(list: readonly T[], value: unknown, operation: string): T[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new HostVerificationStoreError(`${operation}: liste`, undefined);
  return value.map((v) => member(list, v, operation));
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

interface StateRow extends Record<string, unknown> {
  outcome: string;
  country_code: string | null;
  org_status: string | null;
  verification_status: string | null;
  missing: unknown;
  kyc_approved: boolean | null;
  age_status: string | null;
  residence_status: string | null;
  tax_required: boolean | null;
  tax_saved: boolean | null;
  tax_kind: string | null;
  tax_kinds: unknown;
  terms_ok: boolean | null;
  screening_done: boolean | null;
  blockers: unknown;
}

interface SubmitRow extends Record<string, unknown> {
  outcome: string;
  screening_key: string | null;
  identity_provider: string | null;
  identity_session_ref: string | null;
}

export class PgHostVerificationStore implements HostVerificationStore {
  readonly #db: KycSqlExecutor;

  constructor(db: KycSqlExecutor) {
    this.#db = db;
  }

  async #run<R extends Record<string, unknown>>(
    operation: string,
    text: string,
    values: readonly unknown[],
  ): Promise<R> {
    let rows: R[];
    try {
      rows = (await this.#db.query<R>(text, values)).rows;
    } catch (error) {
      const { code } = error as { code?: unknown };
      throw new HostVerificationStoreError(operation, typeof code === 'string' ? code : undefined);
    }
    const [r] = rows;
    if (r === undefined) throw new HostVerificationStoreError(`${operation}: aucune ligne`, undefined);
    return r;
  }

  async state(tokenHash: Buffer, orgId: string): Promise<StateResult> {
    const r = await this.#run<StateRow>(
      'state',
      'SELECT * FROM core.kyc_host_state($1, $2)',
      [tokenHash, orgId],
    );
    if (r.outcome === 'AUTH_REQUIRED' || r.outcome === 'FORBIDDEN') return { outcome: r.outcome };
    if (r.outcome !== 'OK' || r.country_code === null) {
      throw new HostVerificationStoreError('state: issue inconnue', undefined);
    }
    return {
      outcome: 'OK',
      state: {
        country: r.country_code,
        orgStatus: member(ORG_STATUSES, r.org_status, 'state'),
        verificationStatus:
          r.verification_status === null
            ? null
            : member(VERIFICATION_STATUSES, r.verification_status, 'state'),
        missing: members(HOST_MISSING, r.missing, 'state'),
        kycApproved: r.kyc_approved === true,
        ageStatus: member(AGE_STATUSES, r.age_status, 'state'),
        residenceStatus: member(RESIDENCE_STATUSES, r.residence_status, 'state'),
        taxRequired: r.tax_required !== false,
        taxSaved: r.tax_saved === true,
        taxKind: r.tax_kind,
        taxKinds: strings(r.tax_kinds),
        termsAccepted: r.terms_ok === true,
        screeningDone: r.screening_done === true,
        blockers: members(HOST_BLOCKERS, r.blockers, 'state'),
      },
    };
  }

  async saveTaxProfile(
    tokenHash: Buffer,
    orgId: string,
    p: TaxProfileToSave,
  ): Promise<TaxOutcome> {
    const r = await this.#run<{ outcome: string }>(
      'save_tax_profile',
      'SELECT * FROM core.kyc_cmd_host_save_tax_profile($1, $2, $3, $4, $5, $6)',
      [tokenHash, orgId, p.kind, p.envelope, p.regime, p.taxpayerKind],
    );
    return member(TAX_OUTCOMES, r.outcome, 'save_tax_profile');
  }

  async submit(tokenHash: Buffer, orgId: string): Promise<SubmitResult> {
    const r = await this.#run<SubmitRow>(
      'submit',
      'SELECT * FROM core.kyc_cmd_host_submit($1, $2)',
      [tokenHash, orgId],
    );
    return {
      outcome: member(SUBMIT_OUTCOMES, r.outcome, 'submit'),
      screening:
        r.screening_key !== null && r.identity_provider !== null && r.identity_session_ref !== null
          ? {
              key: r.screening_key,
              identityProvider: r.identity_provider,
              identitySessionRef: r.identity_session_ref,
            }
          : null,
    };
  }

  async recordScreening(
    tokenHash: Buffer,
    orgId: string,
    s: ScreeningToRecord,
  ): Promise<ScreeningRecordOutcome> {
    const r = await this.#run<{ outcome: string }>(
      'record_screening',
      'SELECT * FROM core.kyc_cmd_host_record_screening($1, $2, $3, $4, $5, $6::jsonb, $7)',
      [tokenHash, orgId, s.provider, s.key, s.result, JSON.stringify(s.listsVersion), s.matchRef],
    );
    return member(SCREENING_OUTCOMES, r.outcome, 'record_screening');
  }
}
