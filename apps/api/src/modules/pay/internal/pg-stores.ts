/**
 * Adaptateurs PostgreSQL des ports de PAY (production). Chaque écriture appelle une commande
 * `core.payment_cmd_*` (migration 0028, SECURITY DEFINER, propriétaire cmd_money_owner) :
 * - API (`app_api`) : `PgWebhookInboxStore` (résolution du compte, réception) ;
 * - travailleurs (`app_worker`, transaction ouverte par `withPaymentWorker` avec le contexte
 *   `app.actor_kind = WORKER`, `app.worker_name`) : `PgOperationRecorder` (payment_command),
 *   `PgWebhookWorkStore` (webhook_ingest).
 * Aucune valeur PostgreSQL brute ne remonte au client : les erreurs sont traduites par
 * `translateDbError` de `@rueda/db` côté appelant, ou rendues sous forme de code.
 */
import type { LegAmounts } from './legs.js';
import { LEGS, legsToJson } from './legs.js';
import type { NormalizedPaymentEvent, OperationStatus } from './port.js';
import type {
  ApplyOutcome,
  ApplyStatusInput,
  InboxItem,
  OperationRef,
  ReceiveOutcome,
  ReceiveWebhookInput,
  WebhookAccount,
  WebhookInboxStore,
  WebhookWorkStore,
} from './stores.js';

/** Sous-ensemble de `pg.Pool` / `pg.Client` utilisé ici. */
export interface SqlExecutor {
  query<R extends Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export interface PooledClient extends SqlExecutor {
  release(): void;
}

export interface SqlPool {
  connect(): Promise<PooledClient>;
}

/** Travailleurs de PAY (17 §2.3 : une politique explicite par travailleur). */
export type PaymentWorkerName = 'payment_command' | 'webhook_ingest';

/**
 * Transaction d'un travailleur de PAY : `BEGIN`, contexte posé par `SET LOCAL`
 * (`set_config(…, true)`), `fn`, `COMMIT` (ou `ROLLBACK` sur erreur).
 */
export async function withPaymentWorker<T>(
  pool: SqlPool,
  worker: PaymentWorkerName,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
              pg_catalog.set_config('app.worker_name', $1, true)`,
      [worker],
    );
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export class PgWebhookInboxStore implements WebhookInboxStore {
  readonly #db: SqlExecutor;

  constructor(db: SqlExecutor) {
    this.#db = db;
  }

  async resolveAccount(provider: string, publicWebhookId: string): Promise<WebhookAccount | null> {
    const { rows } = await this.#db.query<{
      account_id: string;
      webhook_secret_ref: string | null;
    }>(`SELECT account_id, webhook_secret_ref FROM core.payment_resolve_webhook_account($1, $2)`, [
      provider,
      publicWebhookId,
    ]);
    const row = rows[0];
    return row === undefined
      ? null
      : { accountId: row.account_id, webhookSecretRef: row.webhook_secret_ref };
  }

  async receive(
    input: ReceiveWebhookInput,
  ): Promise<{ readonly outcome: ReceiveOutcome; readonly inboxId: string | null }> {
    const { rows } = await this.#db.query<{ outcome: ReceiveOutcome; inbox_id: string | null }>(
      `SELECT outcome, inbox_id
         FROM core.payment_cmd_receive_webhook($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        input.accountId,
        input.providerEventId,
        Buffer.from(input.dedupKey),
        input.signatureValid,
        input.signedAt,
        JSON.stringify(input.headers),
        // US-223 : montant en texte (bigint exact), jamais un nombre JSON
        JSON.stringify(input.events, (_k, v: unknown) =>
          typeof v === 'bigint' ? v.toString() : v,
        ),
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('PAY : réception du webhook sans résultat');
    return { outcome: row.outcome, inboxId: row.inbox_id };
  }
}

export interface RecordOperationInput {
  readonly id: string;
  readonly holdId: string | null;
  readonly tripId: string | null;
  readonly pspAccountId: string;
  readonly method: string | null;
  readonly kind: string;
  readonly purpose: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly attemptNo: number;
  readonly idemPlain: string;
  readonly idemSent: string;
  /** `null` pour VOID, DEPOSIT_VOID, DEPOSIT_AUTH, CHARGEBACK, CHARGEBACK_REVERSAL. */
  readonly legs: LegAmounts | null;
  /**
   * US-224 (S-02, ADR-145) : règlement et version dont découle un ordre REFUND / LEG_REALLOCATION /
   * LEG_RELEASE d'un trip (version en tête, gardée par la base à l'enregistrement) ; absent pour
   * les autres ordres. Sans lui, un ordre de règlement d'un trip est refusé.
   */
  readonly settlement?: { readonly id: string; readonly version: number };
}

/** Travailleur `payment_command` : opération planifiée et ses jambes (17 §4.3 point 1). */
export class PgOperationRecorder {
  readonly #tx: SqlExecutor;

  constructor(tx: SqlExecutor) {
    this.#tx = tx;
  }

  async record(input: RecordOperationInput): Promise<{ operationId: string; replayed: boolean }> {
    const { rows } = await this.#tx.query<{ operation_id: string; replayed: boolean }>(
      `SELECT operation_id, replayed
         FROM core.payment_cmd_record_operation($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                                                $13::jsonb, $14::uuid, $15::integer)`,
      [
        input.id,
        input.holdId,
        input.tripId,
        input.pspAccountId,
        input.method,
        input.kind,
        input.purpose,
        input.amountMinor.toString(),
        input.currency,
        input.attemptNo,
        input.idemPlain,
        input.idemSent,
        input.legs === null ? null : JSON.stringify(legsToJson(input.legs)),
        input.settlement?.id ?? null,
        input.settlement?.version ?? null,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('PAY : enregistrement sans résultat');
    return { operationId: row.operation_id, replayed: row.replayed };
  }

  async apply(input: ApplyStatusInput): Promise<ApplyOutcome> {
    return applyStatus(this.#tx, input);
  }
}

/**
 * US-224b (ADR-147, 08 SM-8) : remboursement d'un règlement planifié par Kmino. `legs` sont les
 * jambes que donne le règlement (`settlementOrders`) ; la base y applique la règle 3 bis (part HOST
 * déjà versée portée sur PLATFORM, avance de Kmino attendue) et écrit l'ordre REFUND PENDING.
 */
export interface PlanRefundInput {
  readonly instanceId: string;
  readonly operationId: string;
  readonly settlementId: string;
  /** Encaissement réussi du loyer du trip remboursé (capture), dont le compte et le moyen servent. */
  readonly refundedOperationId: string;
  readonly instanceSeq: number;
  /** Bêta : `NATIVE_PARTIAL` ou `ROLLBACK_AND_RECHARGE` ; crédit cash et virement refusés. */
  readonly rail: 'NATIVE_PARTIAL' | 'ROLLBACK_AND_RECHARGE' | 'BANK_TRANSFER' | 'CREDIT_CASH';
  readonly legs: LegAmounts;
  readonly idemPlain: string;
  readonly idemSent: string;
}

/** Motif d'un envoi retenu (avance de Kmino sans décision FINANCE à deux personnes). */
export type RefundBlockedReason =
  'ADVANCE_CAP_UNSET' | 'HOST_ADVANCE_CAP' | 'PLATFORM_BALANCE_UNKNOWN';

/** États d'une instance de remboursement (08 SM-8, CHECK de 0123). */
export const REFUND_INSTANCE_STATUSES = [
  'PLANNED',
  'BLOCKED_CHARGEBACK',
  'PENDING_CUSTOMER_CHOICE',
  'PENDING_BANK_DETAILS',
  'SUBMITTED',
  'SENT',
  'CONFIRMED',
  'FAILED',
  'CREDITED',
  'CANCELLED',
  'SUPERSEDED',
] as const;
export type RefundInstanceStatus = (typeof REFUND_INSTANCE_STATUSES)[number];

function refundStatus(value: unknown): RefundInstanceStatus {
  if (!(REFUND_INSTANCE_STATUSES as readonly unknown[]).includes(value)) {
    throw new Error('PAY : état d’instance de remboursement inconnu');
  }
  return value as RefundInstanceStatus;
}

const BLOCKED_REASONS: readonly RefundBlockedReason[] = [
  'ADVANCE_CAP_UNSET',
  'HOST_ADVANCE_CAP',
  'PLATFORM_BALANCE_UNKNOWN',
];

function blockedReason(value: unknown): RefundBlockedReason | null {
  if (value === null) return null;
  if (!(BLOCKED_REASONS as readonly unknown[]).includes(value)) {
    throw new Error('PAY : motif de blocage inconnu');
  }
  return value as RefundBlockedReason;
}

export interface PlannedRefund {
  readonly instanceId: string;
  readonly operationId: string;
  readonly advanceId: string | null;
  readonly status: RefundInstanceStatus;
  readonly blockedReason: RefundBlockedReason | null;
  readonly replayed: boolean;
}

export type SubmitRefundOutcome =
  | { readonly outcome: 'SUBMITTED' | 'DUPLICATE' | 'SUPERSEDED' }
  | { readonly outcome: 'BLOCKED'; readonly blockedReason: RefundBlockedReason };

/**
 * Travailleur `payment_command` : instance de remboursement (`core.payment_cmd_plan_refund`) et
 * envoi autorisé (`core.payment_cmd_submit_refund`) ; l'appel au PSP ne suit que `SUBMITTED`.
 */
export class PgRefundPlanner {
  readonly #tx: SqlExecutor;

  constructor(tx: SqlExecutor) {
    this.#tx = tx;
  }

  async plan(input: PlanRefundInput): Promise<PlannedRefund> {
    const { rows } = await this.#tx.query<{
      instance_id: string;
      operation_id: string;
      advance_id: string | null;
      status: string;
      blocked_reason: RefundBlockedReason | null;
      replayed: boolean;
    }>(
      `SELECT instance_id, operation_id, advance_id, status, blocked_reason, replayed
         FROM core.payment_cmd_plan_refund($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [
        input.instanceId,
        input.operationId,
        input.settlementId,
        input.refundedOperationId,
        input.instanceSeq,
        input.rail,
        JSON.stringify(legsToJson(input.legs)),
        input.idemPlain,
        input.idemSent,
      ],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('PAY : planification sans résultat');
    return {
      instanceId: row.instance_id,
      operationId: row.operation_id,
      advanceId: row.advance_id,
      status: refundStatus(row.status),
      blockedReason: blockedReason(row.blocked_reason),
      replayed: row.replayed,
    };
  }

  async submit(instanceId: string): Promise<SubmitRefundOutcome> {
    const { rows } = await this.#tx.query<{
      outcome: 'SUBMITTED' | 'DUPLICATE' | 'SUPERSEDED' | 'BLOCKED';
      blocked_reason: RefundBlockedReason | null;
    }>('SELECT outcome, blocked_reason FROM core.payment_cmd_submit_refund($1)', [instanceId]);
    const row = rows[0];
    if (row === undefined) throw new Error('PAY : envoi sans résultat');
    if (row.outcome === 'BLOCKED') {
      if (row.blocked_reason === null) throw new Error('PAY : envoi retenu sans motif');
      return { outcome: 'BLOCKED', blockedReason: row.blocked_reason };
    }
    return { outcome: row.outcome };
  }
}

/** Instance de remboursement qui attend l'ordonnanceur (`core.payment_refunds_due`, 0127). */
export interface DueRefund {
  readonly instanceId: string;
  /** Pays de l'instance (étiquette d'alerte : un code, jamais un identifiant). */
  readonly country: string;
  readonly status: RefundInstanceStatus;
  readonly operationStatus: OperationStatus;
  /** Fournisseur de l'ordre (`payment_operation.provider`) : connecteur qui l'exécute. */
  readonly provider: string;
  readonly blockedReason: RefundBlockedReason | null;
  /** Dernière alerte FIN levée pour l'instance (un état n'est signalé qu'une fois). */
  readonly finAlert: string | null;
  /** Référence PSP de l'encaissement remboursé connue (sinon rien ne peut partir : `NO_TARGET`). */
  readonly targetKnown: boolean;
}

/** Motif pour lequel l'ordre d'une instance ne part pas (relu sous les verrous). */
export type RefundSendRefusal = 'NOT_SUBMITTED' | 'FINAL' | 'SUPERSEDED_UNSENT' | 'NO_TARGET';

/** Ordre STOCKÉ d'une instance envoyée, verrouillé (trip puis ordre) jusqu'à la fin de la transaction. */
export type RefundOrderForSend =
  | {
      readonly sendable: true;
      readonly operationId: string;
      readonly status: OperationStatus;
      readonly idemSent: string;
      readonly amountMinor: bigint;
      readonly currency: string;
      readonly legs: LegAmounts;
      /** Référence PSP de l'encaissement remboursé. */
      readonly targetReference: string;
      readonly providerReference: string | null;
      readonly provider: string;
    }
  | { readonly sendable: false; readonly reason: RefundSendRefusal };

const SEND_REFUSALS: readonly RefundSendRefusal[] = [
  'NOT_SUBMITTED',
  'FINAL',
  'SUPERSEDED_UNSENT',
  'NO_TARGET',
];

function operationStatus(value: unknown): OperationStatus {
  if (!(STATUSES as readonly unknown[]).includes(value)) {
    throw new Error('PAY : statut d’ordre inconnu');
  }
  return value as OperationStatus;
}

const MINOR = /^-?\d{1,19}$/;

/** Jambes stockées (texte d'unités mineures), exactement les quatre jambes. */
function storedLegs(value: unknown): LegAmounts {
  if (typeof value !== 'object' || value === null) throw new Error('PAY : jambes absentes');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== LEGS.length) throw new Error('PAY : jambe inattendue');
  const out: Partial<Record<(typeof LEGS)[number], bigint>> = {};
  for (const leg of LEGS) {
    const v = raw[leg];
    if (typeof v !== 'string' || !MINOR.test(v)) throw new Error('PAY : jambe illisible');
    out[leg] = BigInt(v);
  }
  return out as LegAmounts;
}

/**
 * US-224c (ADR-150) : file de l'ordonnanceur des remboursements et ordre à envoyer, travailleur
 * `payment_command`. Aucun montant n'est calculé : l'ordre envoyé est celui que la base a gardé.
 */
export class PgRefundOrders {
  readonly #tx: SqlExecutor;

  constructor(tx: SqlExecutor) {
    this.#tx = tx;
  }

  async due(limit: number): Promise<readonly DueRefund[]> {
    const { rows } = await this.#tx.query<{
      instance_id: string;
      country_code: string;
      status: string;
      operation_status: string;
      provider: string;
      blocked_reason: string | null;
      fin_alert: string | null;
      target_known: boolean;
    }>(
      `SELECT instance_id, country_code, status, operation_status, provider, blocked_reason,
              fin_alert, target_known
         FROM core.payment_refunds_due($1)`,
      [limit],
    );
    return rows.map((r) => ({
      instanceId: r.instance_id,
      country: r.country_code,
      status: refundStatus(r.status),
      operationStatus: operationStatus(r.operation_status),
      provider: r.provider,
      blockedReason: blockedReason(r.blocked_reason),
      finAlert: r.fin_alert,
      targetKnown: r.target_known,
    }));
  }

  async orderForSend(instanceId: string): Promise<RefundOrderForSend> {
    const { rows } = await this.#tx.query<{
      operation_id: string;
      operation_status: string;
      idem_sent: string;
      amount_minor: string;
      currency: string;
      legs: unknown;
      target_reference: string | null;
      provider_reference: string | null;
      provider: string;
      sendable: boolean;
      reason: string | null;
    }>(
      `SELECT operation_id, operation_status, idem_sent, amount_minor::text AS amount_minor,
              currency, legs, target_reference, provider_reference, provider, sendable, reason
         FROM core.payment_cmd_refund_order_for_send($1)`,
      [instanceId],
    );
    const row = rows[0];
    if (row === undefined) throw new Error('PAY : ordre de remboursement sans résultat');
    if (!row.sendable) {
      if (!(SEND_REFUSALS as readonly unknown[]).includes(row.reason)) {
        throw new Error('PAY : refus d’envoi sans motif connu');
      }
      return { sendable: false, reason: row.reason as RefundSendRefusal };
    }
    if (row.target_reference === null || !MINOR.test(row.amount_minor)) {
      throw new Error('PAY : ordre de remboursement illisible');
    }
    return {
      sendable: true,
      operationId: row.operation_id,
      status: operationStatus(row.operation_status),
      idemSent: row.idem_sent,
      amountMinor: BigInt(row.amount_minor),
      currency: row.currency,
      legs: storedLegs(row.legs),
      targetReference: row.target_reference,
      providerReference: row.provider_reference,
      provider: row.provider,
    };
  }

  /** Pose la dernière alerte FIN levée ; `false` si elle l'était déjà. */
  async markAlerted(instanceId: string, key: string): Promise<boolean> {
    const { rows } = await this.#tx.query<{ changed: boolean }>(
      'SELECT core.payment_cmd_refund_mark_alerted($1, $2) AS changed',
      [instanceId, key],
    );
    return rows[0]?.changed === true;
  }

  /**
   * US-224f (ADR-166, 08 SM-8) : instance `FAILED` après un rejet confirmé ⇒ `PENDING_CUSTOMER_CHOICE`
   * (`attempt_no` + 1) ; déjà en attente ⇒ `DUPLICATE` ; remplacée ⇒ `SUPERSEDED`.
   */
  async awaitChoice(instanceId: string): Promise<'AWAITING_CHOICE' | 'DUPLICATE' | 'SUPERSEDED'> {
    const { rows } = await this.#tx.query<{ outcome: string }>(
      'SELECT core.payment_cmd_refund_await_choice($1) AS outcome',
      [instanceId],
    );
    const outcome = rows[0]?.outcome;
    if (outcome !== 'AWAITING_CHOICE' && outcome !== 'DUPLICATE' && outcome !== 'SUPERSEDED') {
      throw new Error('PAY : attente du choix du rail sans issue connue');
    }
    return outcome;
  }

  /** Opération d'une instance (report après confirmation). */
  async operationOf(instanceId: string): Promise<string> {
    const { rows } = await this.#tx.query<{ operation_id: string }>(
      'SELECT operation_id FROM core.payment_refund_instance WHERE id = $1',
      [instanceId],
    );
    const id = rows[0]?.operation_id;
    if (id === undefined) throw new Error('PAY : instance de remboursement introuvable');
    return id;
  }

  /** Report d'un remboursement confirmé et prouvé sur les soldes des jambes (0123). */
  async applyLegMovement(operationId: string): Promise<'APPLIED' | 'DUPLICATE'> {
    const { rows } = await this.#tx.query<{ outcome: string }>(
      'SELECT core.settlement_cmd_apply_leg_movement($1) AS outcome',
      [operationId],
    );
    const outcome = rows[0]?.outcome;
    if (outcome !== 'APPLIED' && outcome !== 'DUPLICATE') {
      throw new Error('PAY : report sans issue connue');
    }
    return outcome;
  }
}

async function applyStatus(db: SqlExecutor, input: ApplyStatusInput): Promise<ApplyOutcome> {
  const { rows } = await db.query<{ outcome: ApplyOutcome }>(
    `SELECT core.payment_cmd_apply_operation_status($1, $2, $3, $4, $5) AS outcome`,
    [input.operationId, input.status, input.source, input.rawRef, input.providerReference],
  );
  const outcome = rows[0]?.outcome;
  if (outcome === undefined) throw new Error('PAY : application du statut sans résultat');
  return outcome;
}

const STATUSES: readonly OperationStatus[] = [
  'PENDING',
  'SUBMITTED',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
];

function toEvents(raw: unknown): NormalizedPaymentEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e: unknown) => {
    const x = e as Record<string, unknown>;
    if (
      typeof x['type'] !== 'string' ||
      typeof x['providerReference'] !== 'string' ||
      typeof x['occurredAt'] !== 'string' ||
      !STATUSES.includes(x['status'] as OperationStatus)
    ) {
      return [];
    }
    return [
      {
        type: x['type'],
        providerReference: x['providerReference'],
        merchantReference:
          typeof x['merchantReference'] === 'string' ? x['merchantReference'] : null,
        status: x['status'] as OperationStatus,
        occurredAt: x['occurredAt'],
        // US-223 : montant et devise reçus (texte d'unités mineures), relus tels que stockés
        amountMinor:
          typeof x['amountMinor'] === 'string' && /^\d{1,18}$/.test(x['amountMinor'])
            ? BigInt(x['amountMinor'])
            : null,
        currency: typeof x['currency'] === 'string' ? x['currency'] : null,
      },
    ];
  });
}

/** Travailleur `webhook_ingest` : boîte de réception et statuts (17 §4.4 points 5 à 8). */
export class PgWebhookWorkStore implements WebhookWorkStore {
  readonly #tx: SqlExecutor;

  constructor(tx: SqlExecutor) {
    this.#tx = tx;
  }

  async claim(limit: number): Promise<readonly InboxItem[]> {
    const { rows } = await this.#tx.query<{
      id: string;
      psp_account_id: string;
      provider: string;
      processing_status: 'RECEIVED' | 'QUARANTINED';
      received_at: Date;
      quarantine_expired: boolean;
      error: string | null;
      signed_at_out_of_tolerance: boolean;
      events: unknown;
    }>(
      `SELECT w.id, w.psp_account_id, w.provider, w.processing_status, w.received_at, w.error,
              w.signed_at_out_of_tolerance,
              (platform.now() - w.received_at) > interval '15 minutes' AS quarantine_expired,
              COALESCE(w.normalized_events, '[]'::jsonb) AS events
         FROM core.payment_webhook_inbox AS w
        WHERE w.processing_status IN ('RECEIVED', 'QUARANTINED')
          AND w.psp_account_id IS NOT NULL
        ORDER BY w.received_at, w.id
        LIMIT $1
          FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows.map((r) => ({
      inboxId: r.id,
      accountId: r.psp_account_id,
      provider: r.provider,
      status: r.processing_status,
      receivedAt: r.received_at,
      quarantineExpired: r.quarantine_expired,
      quarantineReason: r.processing_status === 'QUARANTINED' ? r.error : null,
      signedAtOutOfTolerance: r.signed_at_out_of_tolerance,
      events: toEvents(r.events),
    }));
  }

  async findOperation(
    accountId: string,
    by: { readonly providerReference: string; readonly merchantReference: string | null },
  ): Promise<OperationRef | null> {
    const { rows } = await this.#tx.query<{
      id: string;
      idem_sent: string;
      provider_reference: string | null;
    }>(
      `SELECT o.id, o.idem_sent, o.provider_reference
         FROM core.payment_payment_operation AS o
        WHERE o.psp_account_id = $1
          AND (o.provider_reference = $2 OR ($3::text IS NOT NULL AND o.idem_sent = $3))
        ORDER BY (o.provider_reference = $2) DESC NULLS LAST
        LIMIT 1`,
      [accountId, by.providerReference, by.merchantReference],
    );
    const row = rows[0];
    return row === undefined
      ? null
      : { operationId: row.id, idemSent: row.idem_sent, providerReference: row.provider_reference };
  }

  async apply(input: ApplyStatusInput): Promise<ApplyOutcome> {
    return applyStatus(this.#tx, input);
  }

  async mark(
    inboxId: string,
    status: 'PROCESSED' | 'QUARANTINED' | 'FAILED',
    error: string | null,
  ): Promise<void> {
    await this.#tx.query(
      `UPDATE core.payment_webhook_inbox
          SET processing_status = $2,
              processed_at = CASE WHEN $2 = 'PROCESSED' THEN platform.now() END,
              -- US-049 : le motif d'horodatage d'une ligne restée en quarantaine n'est jamais
              -- remplacé (la colonne signed_at_out_of_tolerance, non effaçable, fait foi)
              error = CASE WHEN $2 = 'QUARANTINED' AND error = 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE'
                           THEN error ELSE $3 END,
              -- passages en échec comptés : alerte du moniteur à 3 (0051, US-004, ADM-032)
              processing_attempts = processing_attempts
                                    + CASE WHEN $2 = 'PROCESSED' THEN 0 ELSE 1 END
        WHERE id = $1`,
      [inboxId, status, error],
    );
  }
}
