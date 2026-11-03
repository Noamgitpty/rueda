/**
 * Adaptateurs PostgreSQL des ports de PAY (production). Chaque écriture appelle une commande
 * `core.payment_cmd_*` (migration 0027, SECURITY DEFINER, propriétaire cmd_money_owner) :
 * - API (`app_api`) : `PgWebhookInboxStore` (résolution du compte, réception) ;
 * - travailleurs (`app_worker`, transaction ouverte par `withPaymentWorker` avec le contexte
 *   `app.actor_kind = WORKER`, `app.worker_name`) : `PgOperationRecorder` (payment_command),
 *   `PgWebhookWorkStore` (webhook_ingest).
 * Aucune valeur PostgreSQL brute ne remonte au client : les erreurs sont traduites par
 * `translateDbError` de `@rueda/db` côté appelant, ou rendues sous forme de code.
 */
import type { LegAmounts } from './legs.js';
import { legsToJson } from './legs.js';
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
        JSON.stringify(input.events),
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
                                                $13::jsonb)`,
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
      events: unknown;
    }>(
      `SELECT w.id, w.psp_account_id, w.provider, w.processing_status, w.received_at,
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
              error = $3
        WHERE id = $1`,
      [inboxId, status, error],
    );
  }
}
