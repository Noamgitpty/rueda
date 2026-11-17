/**
 * Magasin du paiement du hold du checkout (US-223 partie 223b, ADR-142 ; commandes de la migration
 * 0116, ADR-139) sous app_api : T1 `core.booking_cmd_checkout_pay`, T2
 * `core.booking_cmd_checkout_record_order` et la lecture `core.booking_checkout_payment` (fonctions
 * SECURITY DEFINER de cmd_hold_owner ; voyageur désigné par l'empreinte de son jeton de session),
 * paramètres liés, aucun SQL construit. Montant et jambes viennent du devis ENGAGÉ au checkout,
 * rejoués par la base : jamais du client ni de l'API.
 *
 * Les refus de T1 / T2 levés par la base (SQLSTATE et contrainte, 0040, 0045, 0112) sont traduits
 * ici en codes stables ; une contrainte inconnue ou un SQLSTATE différent ⇒ panne (503,
 * fail-closed : on ne devine pas). Sans adaptateur : 503 partout.
 *
 * US-223c (0124, ADR-146) : T1 rend le mode de capture (`MANUAL` pour une demande à l'hôte :
 * autorisation seulement, capture à l'acceptation) ; la lecture porte l'état de la demande
 * (`core.booking_checkout_request`).
 */
import { LEGS } from '../../../pay/index.js';
import type { CaptureMode, Leg } from '../../../pay/index.js';
import type { SqlExecutor } from './store.js';

/** Lecture du paiement du hold (0116), telle que la base la rend. */
export interface CheckoutPaymentRow {
  readonly holdStatus: string;
  readonly tripId: string | null;
  readonly expiresAt: string;
  readonly paymentInFlightUntil: string | null;
  /**
   * Statut de la dernière opération de loyer : lu par le service pour distinguer un refus ou un
   * paiement non prouvé, JAMAIS pour confirmer (la confirmation = trip né, hold CONVERTED) et
   * jamais rendu au client.
   */
  readonly operationStatus: string | null;
  /**
   * Demande à l'hôte (hold REQUEST, US-223c, 0124) : état et heure limite ; `null` pour un hold de
   * réservation immédiate (CHECKOUT).
   */
  readonly request: CheckoutRequestRow | null;
}

/** États d'une demande lus en base (`core.booking_checkout_request`, 0124). */
export const REQUEST_STATUSES = [
  'AUTHORIZING',
  'AWAITING_HOST',
  'CAPTURING',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CAPTURE_FAILED',
  'COMPENSATED',
  'ENDED',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface CheckoutRequestRow {
  readonly status: RequestStatus;
  /** Heure limite de réponse de l'hôte ; `null` avant la preuve de l'autorisation. */
  readonly respondBy: string | null;
}

/** Issues rendues par T1 quand un ordre est à créer, à relire ou en cours (0112). */
export const PAYMENT_START_OUTCOMES = [
  'NEW_ORDER',
  'EXISTING_ORDER',
  'RETRY_SAME_KEY',
  'VERIFYING',
] as const;
export type PaymentStartOutcome = (typeof PAYMENT_START_OUTCOMES)[number];

/** Refus traduits de T1, T2 et de la lecture (codes stables de `payment-errors.ts`). */
export const PAYMENT_REFUSALS = [
  'AUTH_REQUIRED',
  'HOLD_NOT_FOUND',
  'PAYMENT_UNAVAILABLE',
  'HOLD_EXPIRED',
  'HOLD_NOT_PAYABLE',
  'BOOKING_UNDER_REVIEW',
  'ACCOUNT_RESTRICTED',
  'KYC_NOT_APPROVED',
  'KYC_BIOMETRIC_CONSENT_MISSING',
  'KYC_LICENSE_EXPIRED',
  'AGE_CLASS_MISMATCH',
  'QUOTE_UNAVAILABLE',
  'START_PASSED',
  'PAYMENT_ATTEMPTS_EXCEEDED',
  'PAYMENT_METHOD_UNAVAILABLE',
  'HOST_PAYOUT_RAIL_UNAVAILABLE',
] as const;
export type PaymentRefusal = (typeof PAYMENT_REFUSALS)[number];

/**
 * Intention de paiement (T1) dont l'ordre est à créer (`NEW_ORDER`) ou à rechercher puis recréer
 * sous la MÊME clé (`RETRY_SAME_KEY`) : montant et jambes de la base.
 */
export interface PaymentStart {
  readonly outcome: 'NEW_ORDER' | 'RETRY_SAME_KEY';
  readonly operationId: string;
  /** Clé envoyée au PSP (`hold:<id>:CAPTURE:a<n>`), stockée par T1 avant tout appel. */
  readonly idemSent: string;
  readonly provider: string;
  readonly method: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly legs: Readonly<Record<Leg, bigint>>;
  /**
   * US-223c : `MANUAL` pour une demande à l'hôte (autorisation, capture à l'acceptation), `AUTO`
   * sinon ; décidé par la base (type du hold), jamais par le client.
   */
  readonly capture: CaptureMode;
}

export type PaymentStartResult =
  | { readonly kind: 'START'; readonly start: PaymentStart }
  /** Ordre déjà en cours (`EXISTING_ORDER`, `VERIFYING`) : aucun nouvel envoi au PSP. */
  | { readonly kind: 'IN_FLIGHT' }
  | { readonly kind: 'REFUSED'; readonly code: PaymentRefusal };

/** Issues de T2 (0040 : RECORDED, CONVERTED, COMPENSATED, EXPIRED ; 0116 : jeton, hold). */
export const RECORD_OUTCOMES = [
  'RECORDED',
  'CONVERTED',
  'COMPENSATED',
  'EXPIRED',
  'AUTH_REQUIRED',
  'HOLD_NOT_FOUND',
] as const;
export type RecordOutcome = (typeof RECORD_OUTCOMES)[number];

export interface CheckoutPaymentStore {
  /** Paiement du hold du voyageur ; `HOLD_NOT_FOUND` : inconnu, d'un autre ou sans checkout. */
  read(
    proof: Buffer,
    holdId: string,
  ): Promise<CheckoutPaymentRow | 'AUTH_REQUIRED' | 'HOLD_NOT_FOUND'>;
  /** T1 sur le compte marchand de Kmino du pays (choisi par la base). */
  start(proof: Buffer, holdId: string, method: string): Promise<PaymentStartResult>;
  /** T2 : référence de l'ordre créé chez le PSP et son expiration réelle. */
  record(
    proof: Buffer,
    holdId: string,
    operationId: string,
    providerReference: string,
    orderExpiresAt: Date | null,
  ): Promise<RecordOutcome>;
}

export class CheckoutPaymentStoreError extends Error {
  override readonly name = 'CheckoutPaymentStoreError';
}

/** Aucun adaptateur : refus (503). */
export class UnavailableCheckoutPaymentStore implements CheckoutPaymentStore {
  #fail = (): Promise<never> =>
    Promise.reject(new CheckoutPaymentStoreError('magasin du paiement indisponible'));
  read = (): Promise<never> => this.#fail();
  start = (): Promise<never> => this.#fail();
  record = (): Promise<never> => this.#fail();
}

const SQL = {
  checkViolation: '23514',
  integrity: '23000',
  privilege: '42501',
  prerequisite: '55000',
} as const;

/**
 * Refus levés par T1 et T2 (contrainte → [SQLSTATE attendu, code]) ; mêmes couples que
 * `packages/db/src/errors.ts` (traduction de référence, prouvée par les L0), codes de la route.
 */
export const PAYMENT_CONSTRAINTS: Readonly<Record<string, readonly [string, PaymentRefusal]>> = {
  hold_forbidden: [SQL.privilege, 'HOLD_NOT_FOUND'],
  hold_not_payable: [SQL.prerequisite, 'HOLD_EXPIRED'],
  hold_payment_terminal: [SQL.prerequisite, 'HOLD_NOT_PAYABLE'],
  hold_review_before_payment: [SQL.checkViolation, 'BOOKING_UNDER_REVIEW'],
  hold_account_restricted: [SQL.prerequisite, 'ACCOUNT_RESTRICTED'],
  hold_kyc_consent_missing: [SQL.prerequisite, 'KYC_BIOMETRIC_CONSENT_MISSING'],
  hold_kyc_not_approved: [SQL.prerequisite, 'KYC_NOT_APPROVED'],
  hold_kyc_license_expired: [SQL.prerequisite, 'KYC_LICENSE_EXPIRED'],
  hold_age_class_mismatch: [SQL.prerequisite, 'AGE_CLASS_MISMATCH'],
  payment_quote_unavailable: [SQL.prerequisite, 'QUOTE_UNAVAILABLE'],
  payment_start_passed: [SQL.prerequisite, 'START_PASSED'],
  payment_attempts_exceeded: [SQL.prerequisite, 'PAYMENT_ATTEMPTS_EXCEEDED'],
  payment_method_unavailable: [SQL.prerequisite, 'PAYMENT_METHOD_UNAVAILABLE'],
  host_payout_rail_unavailable: [SQL.prerequisite, 'HOST_PAYOUT_RAIL_UNAVAILABLE'],
  // compte marchand inactif ou FAKE / bac à sable hors environnement de test : aucun paiement
  payment_operation_account_active: [SQL.integrity, 'PAYMENT_UNAVAILABLE'],
  psp_account_fake_forbidden: [SQL.integrity, 'PAYMENT_UNAVAILABLE'],
};

/** Refus connu d'une erreur levée par la base ; `null` : panne (journalisée, 503). */
export function paymentRefusalOf(error: unknown): PaymentRefusal | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  if (typeof code !== 'string' || typeof constraint !== 'string') return null;
  const known = Object.hasOwn(PAYMENT_CONSTRAINTS, constraint)
    ? PAYMENT_CONSTRAINTS[constraint]
    : undefined;
  return known !== undefined && known[0] === code ? known[1] : null;
}

const iso = (value: unknown): string => {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new CheckoutPaymentStoreError('instant illisible');
  return d.toISOString();
};
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new CheckoutPaymentStoreError('colonne inattendue');
  return value;
};
const textOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : text(value);
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const minor = (value: unknown): bigint => {
  const s = typeof value === 'number' ? String(value) : text(value);
  if (!MINOR.test(s)) throw new CheckoutPaymentStoreError('montant illisible');
  return BigInt(s);
};

/** Jambes rendues par T1 : exactement les quatre jambes, montants entiers positifs ou nuls. */
function legsOf(value: unknown): Readonly<Record<Leg, bigint>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CheckoutPaymentStoreError('jambes illisibles');
  }
  const raw = value as Record<string, unknown>;
  const keys = Object.keys(raw).sort();
  if (keys.join(',') !== [...LEGS].sort().join(',')) {
    throw new CheckoutPaymentStoreError('jambes illisibles');
  }
  const out = {} as Record<Leg, bigint>;
  for (const leg of LEGS) out[leg] = minor(raw[leg]);
  return out;
}

const START_OUTCOMES: ReadonlySet<string> = new Set(PAYMENT_START_OUTCOMES);
const REQUEST_STATUS_SET: ReadonlySet<string> = new Set(REQUEST_STATUSES);

/** Mode de capture rendu par T1 : exactement AUTO ou MANUAL (sinon panne, fail-closed). */
function captureOf(value: unknown): CaptureMode {
  if (value === 'AUTO' || value === 'MANUAL') return value;
  throw new CheckoutPaymentStoreError('mode de capture illisible');
}
const RECORDS: ReadonlySet<string> = new Set(RECORD_OUTCOMES);

/** Commandes et lecture de 0116, sous app_api. */
export class PgCheckoutPaymentStore implements CheckoutPaymentStore {
  constructor(private readonly db: SqlExecutor) {}

  async read(
    proof: Buffer,
    holdId: string,
  ): Promise<CheckoutPaymentRow | 'AUTH_REQUIRED' | 'HOLD_NOT_FOUND'> {
    const { rows } = await this.db.query(
      'SELECT * FROM core.booking_checkout_payment($1, $2::uuid)',
      [proof, holdId],
    );
    const r = rows[0];
    const outcome = r === undefined ? '' : String(r['outcome']);
    if (outcome === 'AUTH_REQUIRED' || outcome === 'HOLD_NOT_FOUND') return outcome;
    if (r === undefined || outcome !== 'DONE') {
      throw new CheckoutPaymentStoreError(
        `issue inattendue de booking_checkout_payment : ${outcome}`,
      );
    }
    return {
      holdStatus: text(r['hold_status']),
      tripId: textOrNull(r['trip_id']),
      expiresAt: iso(r['expires_at']),
      paymentInFlightUntil:
        r['payment_in_flight_until'] === null ? null : iso(r['payment_in_flight_until']),
      operationStatus: textOrNull(r['operation_status']),
      request: await this.#request(proof, holdId),
    };
  }

  /** Demande du hold (0124) ; `null` pour un hold CHECKOUT. Toute autre forme : panne. */
  async #request(proof: Buffer, holdId: string): Promise<CheckoutRequestRow | null> {
    const { rows } = await this.db.query(
      'SELECT * FROM core.booking_checkout_request($1, $2::uuid)',
      [proof, holdId],
    );
    const r = rows[0];
    if (r === undefined || String(r['outcome']) !== 'DONE') {
      throw new CheckoutPaymentStoreError('issue inattendue de booking_checkout_request');
    }
    const kind = text(r['hold_kind']);
    if (kind === 'CHECKOUT') return null;
    const status = r['request_status'];
    if (kind !== 'REQUEST' || typeof status !== 'string' || !REQUEST_STATUS_SET.has(status)) {
      throw new CheckoutPaymentStoreError('demande illisible');
    }
    return {
      status: status as RequestStatus,
      respondBy: r['request_respond_by'] === null ? null : iso(r['request_respond_by']),
    };
  }

  async start(proof: Buffer, holdId: string, method: string): Promise<PaymentStartResult> {
    let r: Record<string, unknown> | undefined;
    try {
      const { rows } = await this.db.query<{ r: unknown }>(
        'SELECT core.booking_cmd_checkout_pay($1, $2::uuid, $3) AS r',
        [proof, holdId, method],
      );
      r = rows[0]?.r as Record<string, unknown> | undefined;
    } catch (error) {
      const code = paymentRefusalOf(error);
      if (code === null) throw error;
      return { kind: 'REFUSED', code };
    }
    if (typeof r !== 'object' || r === null) {
      throw new CheckoutPaymentStoreError('réponse illisible de booking_cmd_checkout_pay');
    }
    const outcome = String(r['outcome']);
    if (
      outcome === 'AUTH_REQUIRED' ||
      outcome === 'HOLD_NOT_FOUND' ||
      outcome === 'PAYMENT_UNAVAILABLE'
    ) {
      return { kind: 'REFUSED', code: outcome };
    }
    // issue inconnue (version N de la base pendant un déploiement) : indisponible, fail-closed
    if (!START_OUTCOMES.has(outcome)) {
      throw new CheckoutPaymentStoreError(
        `issue inattendue de booking_cmd_checkout_pay : ${outcome}`,
      );
    }
    // ordre déjà créé chez le PSP, ou état à vérifier : jamais un second ordre (UX-27, PAY-019)
    if (outcome === 'EXISTING_ORDER' || outcome === 'VERIFYING') return { kind: 'IN_FLIGHT' };
    return {
      kind: 'START',
      start: {
        outcome: outcome as 'NEW_ORDER' | 'RETRY_SAME_KEY',
        operationId: text(r['operationId']),
        idemSent: text(r['idemSent']),
        provider: text(r['provider']),
        method: text(r['method']),
        amountMinor: minor(r['amountMinor']),
        currency: text(r['currency']),
        legs: legsOf(r['legs']),
        capture: captureOf(r['captureMode']),
      },
    };
  }

  async record(
    proof: Buffer,
    holdId: string,
    operationId: string,
    providerReference: string,
    orderExpiresAt: Date | null,
  ): Promise<RecordOutcome> {
    const { rows } = await this.db.query<{ r: unknown }>(
      'SELECT core.booking_cmd_checkout_record_order($1, $2::uuid, $3::uuid, $4, $5) AS r',
      [proof, holdId, operationId, providerReference, orderExpiresAt],
    );
    const outcome = String(rows[0]?.r ?? '');
    if (!RECORDS.has(outcome)) {
      throw new CheckoutPaymentStoreError(
        `issue inattendue de booking_cmd_checkout_record_order : ${outcome}`,
      );
    }
    return outcome as RecordOutcome;
  }
}
