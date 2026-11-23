/**
 * Adaptateur PostgreSQL du stockage des lots de versement (US-708, ADR-185) : appels des
 * commandes de 0165 (`core.payout_*`), de l'enregistrement d'ordre et du report sur les soldes de
 * PAY/STL (`core.payment_cmd_record_operation`, `core.settlement_cmd_apply_leg_movement`), sous la
 * transaction du travailleur `payment_command` reçue. Montants en texte (bigint exact).
 */
import type { SqlClient } from '../../bus/index.js';
import { PgOperationRecorder } from '../../pay/index.js';
import type { ApplyOutcome, ApplyStatusInput, OperationStatus } from '../../pay/index.js';
import type {
  AdjustmentOrder,
  BatchCheck,
  ChargeToPrepare,
  DueBatch,
  PayoutBatchStore,
  PayoutOrder,
  PayoutStep,
  PrepareResult,
  RecordReleaseInput,
  ReleaseItem,
} from './payout-batch-store.js';

const STEPS: readonly PayoutStep[] = ['NET', 'RELEASE', 'PAYOUT'];
const STATUSES: readonly OperationStatus[] = [
  'PENDING',
  'SUBMITTED',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
];

const bigOrNull = (v: string | null): bigint | null => (v === null ? null : BigInt(v));
const statusOf = (v: string | null): OperationStatus | null => {
  if (v === null) return null;
  if (!(STATUSES as readonly string[]).includes(v)) throw new Error('PYO : statut inconnu');
  return v as OperationStatus;
};

export class PgPayoutBatchStore implements PayoutBatchStore {
  readonly #db: SqlClient;
  readonly #recorder: PgOperationRecorder;

  constructor(db: SqlClient) {
    this.#db = db;
    this.#recorder = new PgOperationRecorder(db);
  }

  async tripsToPrepare(limit: number): Promise<readonly string[]> {
    const { rows } = await this.#db.query<{ trip_id: string }>(
      'SELECT trip_id FROM core.payout_trips_to_prepare($1)',
      [limit],
    );
    return rows.map((r) => r.trip_id);
  }

  async prepareTrip(tripId: string): Promise<PrepareResult> {
    const { rows } = await this.#db.query<{
      outcome: string;
      batch_id: string | null;
      status: string | null;
      hold_reasons: string[] | null;
    }>('SELECT outcome, batch_id, status, hold_reasons FROM core.payout_cmd_prepare_trip($1)', [
      tripId,
    ]);
    const r = rows[0];
    if (r === undefined) throw new Error('PYO : préparation sans résultat');
    return {
      outcome: r.outcome,
      batchId: r.batch_id,
      status: r.status,
      holdReasons: r.hold_reasons ?? [],
    };
  }

  async deferTrip(tripId: string, code: string): Promise<void> {
    await this.#db.query('SELECT core.payout_cmd_defer_trip($1, $2)', [tripId, code]);
  }

  async chargesToPrepare(limit: number): Promise<readonly ChargeToPrepare[]> {
    const { rows } = await this.#db.query<{ charge_id: string; trip_id: string }>(
      'SELECT charge_id, trip_id FROM core.payout_charges_to_prepare($1)',
      [limit],
    );
    return rows.map((r) => ({ chargeId: r.charge_id, tripId: r.trip_id }));
  }

  async prepareCharge(chargeId: string): Promise<PrepareResult> {
    const { rows } = await this.#db.query<{
      outcome: string;
      batch_id: string | null;
      status: string | null;
      hold_reasons: string[] | null;
    }>('SELECT outcome, batch_id, status, hold_reasons FROM core.payout_cmd_prepare_charge($1)', [
      chargeId,
    ]);
    const r = rows[0];
    if (r === undefined) throw new Error('PYO : préparation de débit sans résultat');
    return {
      outcome: r.outcome,
      batchId: r.batch_id,
      status: r.status,
      holdReasons: r.hold_reasons ?? [],
    };
  }

  async dueBatches(limit: number): Promise<readonly DueBatch[]> {
    const { rows } = await this.#db.query<{
      batch_id: string;
      step: string;
      status: string;
      country_code: string;
      currency: string;
      provider: string;
    }>(
      'SELECT batch_id, step, status, country_code, currency, provider FROM core.payout_batches_due($1)',
      [limit],
    );
    return rows.map((r) => {
      if (!(STEPS as readonly string[]).includes(r.step)) throw new Error('PYO : étape inconnue');
      return {
        batchId: r.batch_id,
        step: r.step as PayoutStep,
        status: r.status,
        country: r.country_code,
        currency: r.currency,
        provider: r.provider,
      };
    });
  }

  async netBatch(batchId: string): Promise<BatchCheck> {
    return this.#check('SELECT outcome, hold_reasons FROM core.payout_cmd_net_batch($1)', batchId);
  }

  async recheckBatch(batchId: string): Promise<BatchCheck> {
    return this.#check(
      'SELECT outcome, hold_reasons FROM core.payout_cmd_recheck_batch($1)',
      batchId,
    );
  }

  async #check(sql: string, batchId: string): Promise<BatchCheck> {
    const { rows } = await this.#db.query<{ outcome: string; hold_reasons: string[] | null }>(sql, [
      batchId,
    ]);
    const r = rows[0];
    if (r === undefined) throw new Error('PYO : lot sans résultat');
    return { outcome: r.outcome, holdReasons: r.hold_reasons ?? [] };
  }

  async releaseItems(batchId: string): Promise<readonly ReleaseItem[]> {
    const { rows } = await this.#db.query<{
      item_id: string;
      trip_id: string;
      amount_minor: string;
      currency: string;
      psp_account_id: string;
      next_attempt: number;
      next_key: string;
      operation_id: string | null;
      operation_status: string | null;
      idem_sent: string | null;
      provider_reference: string | null;
      applied: boolean;
      beneficiary_reference: string | null;
    }>(
      `SELECT item_id, trip_id, amount_minor::text AS amount_minor, currency, psp_account_id,
              next_attempt, next_key, operation_id, operation_status, idem_sent,
              provider_reference, applied, beneficiary_reference
         FROM core.payout_release_items($1)`,
      [batchId],
    );
    return rows.map((r) => ({
      itemId: r.item_id,
      tripId: r.trip_id,
      amountMinor: BigInt(r.amount_minor),
      currency: r.currency,
      pspAccountId: r.psp_account_id,
      nextAttempt: r.next_attempt,
      nextKey: r.next_key,
      operationId: r.operation_id,
      operationStatus: statusOf(r.operation_status),
      idemSent: r.idem_sent,
      providerReference: r.provider_reference,
      applied: r.applied,
      beneficiaryReference: r.beneficiary_reference,
    }));
  }

  async recordRelease(input: RecordReleaseInput): Promise<string> {
    const { operationId } = await this.#recorder.record({
      id: input.operationId,
      holdId: null,
      tripId: input.tripId,
      pspAccountId: input.pspAccountId,
      method: null,
      kind: 'LEG_RELEASE',
      purpose: 'RENT',
      amountMinor: input.amountMinor,
      currency: input.currency,
      attemptNo: input.attemptNo,
      idemPlain: input.idemPlain,
      idemSent: input.idemSent,
      // une seule jambe, montant explicite (17 §2.8 `releaseLeg`)
      legs: { HOST: input.amountMinor, INSURER: 0n, TAX_THIRD_PARTY: 0n, PLATFORM: 0n },
    });
    return operationId;
  }

  async applyRelease(operationId: string): Promise<string> {
    const { rows } = await this.#db.query<{ outcome: string }>(
      'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
      [operationId],
    );
    return rows[0]?.outcome ?? '';
  }

  async adjustment(batchId: string): Promise<AdjustmentOrder> {
    const { rows } = await this.#db.query<{
      outcome: string;
      idempotency_key: string | null;
      amount_minor: string | null;
      currency: string | null;
      submerchant_reference: string | null;
      provider_ref: string | null;
      hold_reasons: string[] | null;
    }>(
      `SELECT outcome, idempotency_key, amount_minor::text AS amount_minor, currency,
              submerchant_reference, provider_ref, hold_reasons
         FROM core.payout_cmd_adjustment($1)`,
      [batchId],
    );
    const r = rows[0];
    if (r === undefined) throw new Error('PYO : ajustement sans résultat');
    return {
      outcome: r.outcome,
      idempotencyKey: r.idempotency_key,
      amountMinor: bigOrNull(r.amount_minor),
      currency: r.currency,
      submerchantReference: r.submerchant_reference,
      providerRef: r.provider_ref,
      holdReasons: r.hold_reasons ?? [],
    };
  }

  async recordAdjustment(
    batchId: string,
    status: OperationStatus,
    providerRef: string | null,
  ): Promise<string> {
    const { rows } = await this.#db.query<{ s: string }>(
      'SELECT core.payout_cmd_record_adjustment($1, $2, $3) AS s',
      [batchId, status, providerRef],
    );
    return rows[0]?.s ?? '';
  }

  async initiate(batchId: string): Promise<PayoutOrder> {
    const { rows } = await this.#db.query<{
      outcome: string;
      idempotency_key: string | null;
      amount_minor: string | null;
      currency: string | null;
      submerchant_reference: string | null;
      provider_ref: string | null;
      hold_reasons: string[] | null;
    }>(
      `SELECT outcome, idempotency_key, amount_minor::text AS amount_minor, currency,
              submerchant_reference, provider_ref, hold_reasons
         FROM core.payout_cmd_initiate_batch($1)`,
      [batchId],
    );
    const r = rows[0];
    if (r === undefined) throw new Error('PYO : versement sans résultat');
    return {
      outcome: r.outcome,
      idempotencyKey: r.idempotency_key,
      amountMinor: bigOrNull(r.amount_minor),
      currency: r.currency,
      submerchantReference: r.submerchant_reference,
      providerRef: r.provider_ref,
      holdReasons: r.hold_reasons ?? [],
    };
  }

  async recordPayoutResult(
    batchId: string,
    status: OperationStatus,
    providerRef: string | null,
  ): Promise<string> {
    const { rows } = await this.#db.query<{ s: string }>(
      'SELECT core.payout_cmd_record_payout_result($1, $2, $3) AS s',
      [batchId, status, providerRef],
    );
    return rows[0]?.s ?? '';
  }

  apply(input: ApplyStatusInput): Promise<ApplyOutcome> {
    return this.#recorder.apply(input);
  }
}
