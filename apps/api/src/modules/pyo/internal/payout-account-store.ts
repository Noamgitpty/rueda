/**
 * Magasin du compte de versement de l'hôte (US-707, ADR-180) : interface vers les commandes
 * `core.payout_*` de la migration 0159 (adaptateur PostgreSQL : `pg-payout-account-store.ts` ; FAKE
 * des tests : `../testing/fake-payout-account-store.ts`). Aucune méthode ne reçoit un numéro en
 * clair : le numéro de compte arrive chiffré, la cédula / le RUC n'arrive jamais.
 */

export const RAIL_KINDS = ['BANK_ACCOUNT', 'WALLET'] as const;
export type RailKind = (typeof RAIL_KINDS)[number];

export const ACCOUNT_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Rail du pays (configuration `payout_account_rails`, forme validée par CFG). */
export interface PayoutRail {
  readonly kind: RailKind;
  readonly accountPattern: string;
  /** Liste fermée d'établissements, ou `null` : code d'établissement selon `institutionPattern`. */
  readonly institutions: readonly string[] | null;
  readonly institutionPattern: string | null;
}

export interface CurrentAccount {
  readonly id: string;
  readonly status: AccountStatus;
  readonly kind: RailKind;
  readonly institution: string;
  readonly last4: string;
  readonly holdUntil: Date | null;
  readonly rejectReason: string | null;
}

export interface PayoutAccountSnapshot {
  readonly country: string;
  readonly currency: string;
  /** Vide : rails absents ou mal formés (aucun compte enregistrable, fail-closed). */
  readonly rails: readonly PayoutRail[];
  readonly taxKind: string | null;
  readonly account: CurrentAccount | null;
}

export type AccessRefusal = 'AUTH_REQUIRED' | 'FORBIDDEN' | 'PERMISSION_DENIED';

export type StateResult =
  | { readonly outcome: 'OK'; readonly state: PayoutAccountSnapshot }
  | { readonly outcome: AccessRefusal };

export const CONTEXT_REFUSALS = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'PERMISSION_DENIED',
  'HOST_PAYOUT_RAIL_UNAVAILABLE',
  'HOST_KYC_REQUIRED',
  'HOST_TAX_ID_REQUIRED',
  'PAYOUT_HOLDER_MISMATCH',
] as const;
export type ContextRefusal = (typeof CONTEXT_REFUSALS)[number];

export type ContextResult =
  | {
      readonly outcome: 'OK';
      readonly country: string;
      readonly currency: string;
      readonly rails: readonly PayoutRail[];
      readonly taxKind: string;
      readonly taxIdEnvelope: Buffer;
    }
  | { readonly outcome: ContextRefusal };

export interface AccountToRegister {
  readonly kind: RailKind;
  readonly institution: string;
  readonly envelope: Buffer;
  readonly last4: string;
  readonly holderGivenNames: string;
  readonly holderSurnames: string;
}

export const REGISTER_REFUSALS = [
  ...CONTEXT_REFUSALS,
  'REQUEST_INVALID',
  'PAYOUT_RAIL_UNSUPPORTED',
  'PAYOUT_ACCOUNT_INVALID',
] as const;
export type RegisterRefusal = (typeof REGISTER_REFUSALS)[number];

export type RegisterResult =
  | { readonly outcome: 'REGISTERED'; readonly accountId: string; readonly holdUntil: Date | null }
  | { readonly outcome: RegisterRefusal };

export type VerificationToRecord =
  | { readonly status: 'VERIFIED'; readonly providerReference: string }
  | { readonly status: 'REJECTED'; readonly reason: string };

export const RECORD_OUTCOMES = [
  'APPLIED',
  'DUPLICATE',
  'CONFLICT',
  'REQUEST_INVALID',
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'PERMISSION_DENIED',
] as const;
export type RecordOutcome = (typeof RECORD_OUTCOMES)[number];

export interface PayoutAccountStore {
  state(tokenHash: Buffer, orgId: string): Promise<StateResult>;
  context(
    tokenHash: Buffer,
    orgId: string,
    holderGivenNames: string,
    holderSurnames: string,
  ): Promise<ContextResult>;
  register(tokenHash: Buffer, orgId: string, account: AccountToRegister): Promise<RegisterResult>;
  recordVerification(
    tokenHash: Buffer,
    orgId: string,
    accountId: string,
    verification: VerificationToRecord,
  ): Promise<RecordOutcome>;
}

/** Base illisible ou issue inconnue (fail-closed : 503). Le message ne porte aucune donnée. */
export class PayoutAccountStoreError extends Error {
  readonly sqlState: string | undefined;

  constructor(operation: string, sqlState: string | undefined) {
    super(`magasin du compte de versement : ${operation}`);
    this.name = 'PayoutAccountStoreError';
    this.sqlState = sqlState;
  }
}

/** Magasin fail-closed : toute opération échoue (503). */
export class UnavailablePayoutAccountStore implements PayoutAccountStore {
  state(): Promise<StateResult> {
    return Promise.reject(new PayoutAccountStoreError('indisponible', undefined));
  }
  context(): Promise<ContextResult> {
    return Promise.reject(new PayoutAccountStoreError('indisponible', undefined));
  }
  register(): Promise<RegisterResult> {
    return Promise.reject(new PayoutAccountStoreError('indisponible', undefined));
  }
  recordVerification(): Promise<RecordOutcome> {
    return Promise.reject(new PayoutAccountStoreError('indisponible', undefined));
  }
}

/** Rails de la configuration (forme de 0160 / CFG) ; toute forme inattendue ⇒ aucun rail. */
export function railsOf(value: unknown): PayoutRail[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const out: PayoutRail[] = [];
  for (const kind of RAIL_KINDS) {
    const r = (value as Record<string, unknown>)[kind];
    if (r === undefined) continue;
    if (r === null || typeof r !== 'object' || Array.isArray(r)) return [];
    const rail = r as Record<string, unknown>;
    const accountPattern = rail['accountPattern'];
    const list = rail['institutions'];
    const pattern = rail['institutionPattern'];
    if (typeof accountPattern !== 'string') return [];
    if (Array.isArray(list) && list.every((x) => typeof x === 'string')) {
      out.push({ kind, accountPattern, institutions: list, institutionPattern: null });
    } else if (typeof pattern === 'string') {
      out.push({ kind, accountPattern, institutions: null, institutionPattern: pattern });
    } else {
      return [];
    }
  }
  return out;
}
