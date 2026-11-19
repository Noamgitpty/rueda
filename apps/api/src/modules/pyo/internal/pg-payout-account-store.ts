/**
 * Adaptateur PostgreSQL du magasin du compte de versement (US-707, ADR-180) : appelle les seules
 * fonctions `core.payout_*` de la migration 0159 (`SECURITY DEFINER`, `EXECUTE` au seul `app_api`).
 * Requêtes paramétrées uniquement. Erreur de la base ⇒ erreur sans message du serveur (SQLSTATE
 * seulement) ; issue inconnue ⇒ erreur (fail-closed : jamais un succès supposé).
 */
import {
  ACCOUNT_STATUSES,
  CONTEXT_REFUSALS,
  PayoutAccountStoreError,
  RAIL_KINDS,
  railsOf,
  RECORD_OUTCOMES,
  REGISTER_REFUSALS,
} from './payout-account-store.js';
import type {
  AccountToRegister,
  ContextResult,
  PayoutAccountStore,
  RecordOutcome,
  RegisterResult,
  StateResult,
  VerificationToRecord,
} from './payout-account-store.js';

/** Exécuteur SQL (pool `pg` sous `app_api`). */
export interface PyoSqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

function member<T extends string>(list: readonly T[], value: unknown, operation: string): T {
  if (typeof value === 'string' && (list as readonly string[]).includes(value)) return value as T;
  throw new PayoutAccountStoreError(`${operation}: issue inconnue`, undefined);
}

const ACCESS = ['AUTH_REQUIRED', 'FORBIDDEN', 'PERMISSION_DENIED'] as const;

interface StateRow extends Record<string, unknown> {
  outcome: string;
  country_code: string | null;
  currency: string | null;
  rails: unknown;
  tax_kind: string | null;
  account_id: string | null;
  status: string | null;
  rail_kind: string | null;
  institution_code: string | null;
  account_last4: string | null;
  change_hold_until: Date | null;
  reject_reason: string | null;
}

interface ContextRow extends Record<string, unknown> {
  outcome: string;
  country_code: string | null;
  currency: string | null;
  rails: unknown;
  tax_kind: string | null;
  tax_id_enc: Buffer | null;
}

interface RegisterRow extends Record<string, unknown> {
  outcome: string;
  account_id: string | null;
  change_hold_until: Date | null;
}

/** `infinity` (retenue sans fin, fail-closed) est rendu `Infinity` par le pilote. */
function holdOf(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (value === Number.POSITIVE_INFINITY) return new Date(8.64e15);
  throw new PayoutAccountStoreError('retenue illisible', undefined);
}

export class PgPayoutAccountStore implements PayoutAccountStore {
  readonly #db: PyoSqlExecutor;

  constructor(db: PyoSqlExecutor) {
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
      throw new PayoutAccountStoreError(operation, typeof code === 'string' ? code : undefined);
    }
    const [r] = rows;
    if (r === undefined) throw new PayoutAccountStoreError(`${operation}: aucune ligne`, undefined);
    return r;
  }

  async state(tokenHash: Buffer, orgId: string): Promise<StateResult> {
    const r = await this.#run<StateRow>(
      'state',
      'SELECT * FROM core.payout_payout_account_state($1, $2)',
      [tokenHash, orgId],
    );
    if (r.outcome !== 'OK') return { outcome: member(ACCESS, r.outcome, 'state') };
    if (r.country_code === null || r.currency === null) {
      throw new PayoutAccountStoreError('state: issue inconnue', undefined);
    }
    return {
      outcome: 'OK',
      state: {
        country: r.country_code,
        currency: r.currency,
        rails: railsOf(r.rails),
        taxKind: r.tax_kind,
        account:
          r.account_id === null
            ? null
            : {
                id: r.account_id,
                status: member(ACCOUNT_STATUSES, r.status, 'state'),
                kind: member(RAIL_KINDS, r.rail_kind, 'state'),
                institution: String(r.institution_code),
                last4: String(r.account_last4),
                holdUntil: holdOf(r.change_hold_until),
                rejectReason: r.reject_reason,
              },
      },
    };
  }

  async context(
    tokenHash: Buffer,
    orgId: string,
    holderGivenNames: string,
    holderSurnames: string,
  ): Promise<ContextResult> {
    const r = await this.#run<ContextRow>(
      'context',
      'SELECT * FROM core.payout_payout_account_context($1, $2, $3, $4)',
      [tokenHash, orgId, holderGivenNames, holderSurnames],
    );
    if (r.outcome !== 'OK') return { outcome: member(CONTEXT_REFUSALS, r.outcome, 'context') };
    if (
      r.country_code === null ||
      r.currency === null ||
      r.tax_kind === null ||
      !Buffer.isBuffer(r.tax_id_enc)
    ) {
      throw new PayoutAccountStoreError('context: issue inconnue', undefined);
    }
    return {
      outcome: 'OK',
      country: r.country_code,
      currency: r.currency,
      rails: railsOf(r.rails),
      taxKind: r.tax_kind,
      taxIdEnvelope: r.tax_id_enc,
    };
  }

  async register(
    tokenHash: Buffer,
    orgId: string,
    account: AccountToRegister,
  ): Promise<RegisterResult> {
    const r = await this.#run<RegisterRow>(
      'register',
      'SELECT * FROM core.payout_cmd_register_payout_account($1, $2, $3, $4, $5, $6, $7, $8)',
      [
        tokenHash,
        orgId,
        account.kind,
        account.institution,
        account.envelope,
        account.last4,
        account.holderGivenNames,
        account.holderSurnames,
      ],
    );
    if (r.outcome === 'REGISTERED' && r.account_id !== null) {
      return {
        outcome: 'REGISTERED',
        accountId: r.account_id,
        holdUntil: holdOf(r.change_hold_until),
      };
    }
    return { outcome: member(REGISTER_REFUSALS, r.outcome, 'register') };
  }

  async recordVerification(
    tokenHash: Buffer,
    orgId: string,
    accountId: string,
    verification: VerificationToRecord,
  ): Promise<RecordOutcome> {
    const r = await this.#run<{ outcome: string }>(
      'recordVerification',
      'SELECT * FROM core.payout_cmd_record_payout_account_verification($1, $2, $3, $4, $5, $6)',
      [
        tokenHash,
        orgId,
        accountId,
        verification.status,
        verification.status === 'REJECTED' ? verification.reason : null,
        verification.status === 'VERIFIED' ? verification.providerReference : null,
      ],
    );
    return member(RECORD_OUTCOMES, r.outcome, 'recordVerification');
  }
}
