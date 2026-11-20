/**
 * Adaptateur PostgreSQL du port `MitChargeStore` (US-703, ADR-189 ; migration 0169), sous
 * `app_worker` dans une transaction du travailleur `payment_command`. Toute règle est jugée par
 * les commandes de la base ; cet adaptateur ne fait que lire leurs issues, strictement : une forme
 * inattendue est une panne (fail-closed), jamais un succès.
 */
import { LEGS } from './legs.js';
import type { LegAmounts } from './legs.js';
import { applyOperationStatus } from './pg-stores.js';
import type { SqlExecutor } from './pg-stores.js';
import { MIT_REASONS, OPERATION_STATUSES } from './port.js';
import type { MitReason, OperationStatus } from './port.js';
import { PLAN_OUTCOMES, POST_TRIP_CHARGE_STATUSES, SETTLE_OUTCOMES } from './mit-charge-store.js';
import type {
  DueCharge,
  MitChargeStore,
  MitOrder,
  PlanOutcome,
  PlanResult,
  PostTripChargeStatus,
  SettleOutcome,
  SettleResult,
} from './mit-charge-store.js';
import type { ApplyOutcome, ApplyStatusInput } from './stores.js';

/** Forme de ligne inattendue : panne, jamais un succès. */
export class MitChargeStoreError extends Error {
  override readonly name = 'MitChargeStoreError';
}

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MINOR = /^-?[0-9]{1,18}$/;

function oneOf<T extends string>(list: readonly T[], v: unknown, what: string): T {
  if (typeof v === 'string' && (list as readonly string[]).includes(v)) return v as T;
  throw new MitChargeStoreError(`${what} illisible`);
}
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const codeOrNull = (v: unknown): string | null =>
  typeof v === 'string' && CODE.test(v) ? v : null;
const intOrNull = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
function minorOrNull(v: unknown): bigint | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  if (!MINOR.test(s)) throw new MitChargeStoreError('montant illisible');
  return BigInt(s);
}
function legsOrNull(v: unknown): LegAmounts | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new MitChargeStoreError('jambes illisibles');
  const o = v as Record<string, unknown>;
  const out = {} as Record<(typeof LEGS)[number], bigint>;
  for (const k of LEGS) {
    const x = o[k];
    if (typeof x !== 'string' || !MINOR.test(x)) throw new MitChargeStoreError('jambe illisible');
    out[k] = BigInt(x);
  }
  if (Object.keys(o).length !== LEGS.length) throw new MitChargeStoreError('jambes illisibles');
  return out;
}

export class PgMitChargeStore implements MitChargeStore {
  readonly #tx: SqlExecutor;

  constructor(tx: SqlExecutor) {
    this.#tx = tx;
  }

  async due(limit: number): Promise<readonly DueCharge[]> {
    const { rows } = await this.#tx.query(
      'SELECT charge_id, status, provider, country_code FROM core.payment_post_trip_charges_due($1)',
      [limit],
    );
    return rows.map((r) => ({
      chargeId: String(r['charge_id']),
      status: oneOf<PostTripChargeStatus>(POST_TRIP_CHARGE_STATUSES, r['status'], 'statut'),
      provider: String(r['provider']),
      country: String(r['country_code']),
    }));
  }

  async plan(chargeId: string, operationId: string): Promise<PlanResult> {
    const { rows } = await this.#tx.query(
      'SELECT outcome, code, operation_id, attempt FROM core.payment_cmd_plan_mit_attempt($1, $2)',
      [chargeId, operationId],
    );
    const r = rows[0];
    if (r === undefined) throw new MitChargeStoreError('planification sans résultat');
    return {
      outcome: oneOf<PlanOutcome>(PLAN_OUTCOMES, r['outcome'], 'issue'),
      code: codeOrNull(r['code']),
      operationId: textOrNull(r['operation_id']),
      attempt: intOrNull(r['attempt']),
    };
  }

  async orderForSend(chargeId: string): Promise<MitOrder> {
    const { rows } = await this.#tx.query(
      `SELECT sendable, operation_id, operation_status, idem_sent, amount_minor::text AS amount_minor,
              currency, legs, provider_reference, instrument_token, mit_reason, attempt
         FROM core.payment_mit_attempt_for_send($1)`,
      [chargeId],
    );
    const r = rows[0];
    if (r === undefined) throw new MitChargeStoreError('ordre sans résultat');
    const status = r['operation_status'];
    return {
      sendable: r['sendable'] === true,
      operationId: textOrNull(r['operation_id']),
      status:
        status === null || status === undefined
          ? null
          : oneOf<OperationStatus>(OPERATION_STATUSES, status, 'statut de l’ordre'),
      idemSent: textOrNull(r['idem_sent']),
      amountMinor: minorOrNull(r['amount_minor']),
      currency: textOrNull(r['currency']),
      legs: legsOrNull(r['legs']),
      providerReference: textOrNull(r['provider_reference']),
      instrumentToken: textOrNull(r['instrument_token']),
      reason:
        r['mit_reason'] === null || r['mit_reason'] === undefined
          ? null
          : oneOf<MitReason>(MIT_REASONS, r['mit_reason'], 'motif'),
      attempt: intOrNull(r['attempt']),
    };
  }

  async settle(chargeId: string, doNotRetry: boolean): Promise<SettleResult> {
    const { rows } = await this.#tx.query(
      'SELECT outcome, code FROM core.payment_cmd_settle_mit_attempt($1, $2)',
      [chargeId, doNotRetry],
    );
    const r = rows[0];
    if (r === undefined) throw new MitChargeStoreError('report sans résultat');
    return {
      outcome: oneOf<SettleOutcome>(SETTLE_OUTCOMES, r['outcome'], 'issue'),
      code: codeOrNull(r['code']),
    };
  }

  apply(input: ApplyStatusInput): Promise<ApplyOutcome> {
    return applyOperationStatus(this.#tx, input);
  }
}
