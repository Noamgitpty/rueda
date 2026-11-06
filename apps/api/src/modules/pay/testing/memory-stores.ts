/**
 * Magasins EN MÉMOIRE des ports de PAY, pour les tests unitaires (US-019). TESTS SEULEMENT :
 * exclus de la compilation de production. Ils reproduisent les règles des commandes SQL de la
 * migration 0028 (dédoublonnage, tolérance de ± 5 min, rangs de 17 §4.4 point 7) ; les commandes
 * SQL elles-mêmes sont prouvées sous les rôles de production par `packages/db/test/l0/l0-pay-*`.
 */
import type { NormalizedPaymentEvent, OperationStatus } from '../internal/port.js';
import type {
  ApplyOutcome,
  ApplyStatusInput,
  InboxItem,
  OperationRef,
  ReceiveOutcome,
  ReceiveWebhookInput,
  StatusSource,
  WebhookAccount,
  WebhookInboxStore,
  WebhookWorkStore,
} from '../internal/stores.js';

export interface MemoryAccount {
  readonly accountId: string;
  readonly provider: string;
  readonly publicWebhookId: string;
  readonly webhookSecretRef: string | null;
}

export interface MemoryInboxRow {
  readonly id: string;
  readonly accountId: string;
  readonly provider: string;
  readonly providerEventId: string | null;
  readonly dedupKey: string;
  readonly signatureValid: boolean;
  readonly headers: Readonly<Record<string, string>>;
  readonly events: readonly NormalizedPaymentEvent[];
  status: 'RECEIVED' | 'QUARANTINED' | 'PROCESSED' | 'FAILED' | 'REJECTED_SIGNATURE';
  error: string | null;
  /**
   * Horodatage signé hors tolérance à la réception (`signed_at_out_of_tolerance`, 0058) : posé par
   * `receive`, jamais réécrit par `mark` (les tests le posent pour simuler une réception tardive).
   */
  signedAtOutOfTolerance: boolean;
  /** Passages en échec (QUARANTINED, FAILED), comme `processing_attempts` (0051, US-004). */
  processingAttempts: number;
  readonly receivedAtMs: number;
}

export interface MemoryOperation {
  readonly id: string;
  readonly accountId: string;
  readonly idemSent: string;
  providerReference: string | null;
  status: OperationStatus;
}

export interface MemoryStatusEvent {
  readonly operationId: string;
  readonly status: OperationStatus;
  readonly source: StatusSource;
  readonly outcome: Exclude<ApplyOutcome, 'NOT_FOUND'>;
  readonly rawRef: string | null;
}

const RANK: Readonly<Record<OperationStatus, number>> = {
  PENDING: 0,
  SUBMITTED: 1,
  UNKNOWN: 1,
  SUCCEEDED: 2,
  FAILED: 2,
};

const TOLERANCE_MS = 5 * 60_000;
const QUARANTINE_MS = 15 * 60_000;

export class MemoryPaymentStore implements WebhookInboxStore, WebhookWorkStore {
  readonly accounts: MemoryAccount[] = [];
  readonly inbox: MemoryInboxRow[] = [];
  readonly operations = new Map<string, MemoryOperation>();
  readonly statusEvents: MemoryStatusEvent[] = [];
  /** Opérations dont la base refuserait toute preuve (`UNPROVEN`), pour les tests du processeur. */
  readonly unproven = new Set<string>();
  /** Heure « de la base » (ms). */
  now: () => number;
  /** Simule une base en production (C19) : comptes FAKE introuvables. */
  productionDatabase = false;
  calls = { resolveAccount: 0, receive: 0 };
  #seq = 0;

  constructor(now: () => number) {
    this.now = now;
  }

  addOperation(op: Omit<MemoryOperation, 'status'> & { status?: OperationStatus }): void {
    this.operations.set(op.id, { ...op, status: op.status ?? 'PENDING' });
  }

  #visible(provider: string): boolean {
    return !(this.productionDatabase && provider === 'FAKE');
  }

  resolveAccount(provider: string, publicWebhookId: string): Promise<WebhookAccount | null> {
    this.calls.resolveAccount += 1;
    const a = this.accounts.find(
      (x) =>
        x.provider === provider &&
        x.publicWebhookId === publicWebhookId &&
        this.#visible(x.provider),
    );
    return Promise.resolve(
      a === undefined ? null : { accountId: a.accountId, webhookSecretRef: a.webhookSecretRef },
    );
  }

  receive(
    input: ReceiveWebhookInput,
  ): Promise<{ outcome: ReceiveOutcome; inboxId: string | null }> {
    this.calls.receive += 1;
    const account = this.accounts.find((a) => a.accountId === input.accountId);
    if (account === undefined || !this.#visible(account.provider)) {
      return Promise.resolve({ outcome: 'NOT_FOUND', inboxId: null });
    }
    const dedupKey = Buffer.from(input.dedupKey).toString('hex');
    if (this.inbox.some((r) => r.accountId === input.accountId && r.dedupKey === dedupKey)) {
      return Promise.resolve({ outcome: 'DUPLICATE', inboxId: null });
    }
    const now = this.now();
    const status: MemoryInboxRow['status'] = !input.signatureValid
      ? 'REJECTED_SIGNATURE'
      : input.signedAt !== null && Math.abs(input.signedAt.getTime() - now) > TOLERANCE_MS
        ? 'QUARANTINED'
        : 'RECEIVED';
    this.#seq += 1;
    const id = `inbox-${this.#seq}`;
    this.inbox.push({
      id,
      accountId: input.accountId,
      provider: account.provider,
      providerEventId: input.providerEventId,
      dedupKey,
      signatureValid: input.signatureValid,
      headers: input.headers,
      events: status === 'REJECTED_SIGNATURE' ? [] : input.events,
      status,
      error: status === 'QUARANTINED' ? 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE' : null,
      signedAtOutOfTolerance: status === 'QUARANTINED',
      processingAttempts: 0,
      receivedAtMs: now,
    });
    return Promise.resolve({ outcome: status, inboxId: id });
  }

  claim(limit: number): Promise<readonly InboxItem[]> {
    const now = this.now();
    return Promise.resolve(
      this.inbox
        .filter(
          (r): r is MemoryInboxRow & { status: 'RECEIVED' | 'QUARANTINED' } =>
            r.status === 'RECEIVED' || r.status === 'QUARANTINED',
        )
        .slice(0, limit)
        .map((r) => ({
          inboxId: r.id,
          accountId: r.accountId,
          provider: r.provider,
          status: r.status,
          receivedAt: new Date(r.receivedAtMs),
          quarantineExpired: now - r.receivedAtMs > QUARANTINE_MS,
          quarantineReason: r.status === 'QUARANTINED' ? r.error : null,
          signedAtOutOfTolerance: r.signedAtOutOfTolerance,
          events: r.events,
        })),
    );
  }

  findOperation(
    accountId: string,
    by: { readonly providerReference: string; readonly merchantReference: string | null },
  ): Promise<OperationRef | null> {
    const ops = [...this.operations.values()].filter((o) => o.accountId === accountId);
    const op =
      ops.find((o) => o.providerReference === by.providerReference) ??
      (by.merchantReference === null
        ? undefined
        : ops.find((o) => o.idemSent === by.merchantReference));
    return Promise.resolve(
      op === undefined
        ? null
        : { operationId: op.id, idemSent: op.idemSent, providerReference: op.providerReference },
    );
  }

  /** Même règle que `core.payment_cmd_apply_operation_status` (17 §4.4 point 7). */
  apply(input: ApplyStatusInput): Promise<ApplyOutcome> {
    const op = this.operations.get(input.operationId);
    if (op === undefined) return Promise.resolve('NOT_FOUND');
    let outcome: Exclude<ApplyOutcome, 'NOT_FOUND'>;
    const terminal = input.status === 'SUCCEEDED' || input.status === 'FAILED';
    const proof =
      input.source === 'WEBHOOK'
        ? this.inbox.find((r) => r.id === input.rawRef && r.accountId === op.accountId)
        : undefined;
    if (input.status === op.status) outcome = 'DUPLICATE';
    else if (RANK[input.status] < RANK[op.status]) outcome = 'STALE';
    else if (RANK[op.status] === 2) outcome = 'CONFLICT';
    else if (
      op.providerReference !== null &&
      input.providerReference !== null &&
      op.providerReference !== input.providerReference
    ) {
      outcome = 'CONFLICT';
    } else if (
      terminal &&
      (input.source === 'MANUAL_OPS' ||
        this.unproven.has(op.id) ||
        (input.source === 'WEBHOOK' &&
          (proof === undefined || !proof.signatureValid || proof.signedAtOutOfTolerance)))
    ) {
      // même règle que 0055 / 0058 : rien n'est appliqué, aucun événement n'est écrit
      return Promise.resolve('UNPROVEN');
    } else {
      outcome = 'APPLIED';
      op.status = input.status;
      op.providerReference ??= input.providerReference;
    }
    this.statusEvents.push({
      operationId: op.id,
      status: input.status,
      source: input.source,
      outcome,
      rawRef: input.rawRef,
    });
    return Promise.resolve(outcome);
  }

  mark(
    inboxId: string,
    status: 'PROCESSED' | 'QUARANTINED' | 'FAILED',
    error: string | null,
  ): Promise<void> {
    const row = this.inbox.find((r) => r.id === inboxId);
    if (row !== undefined) {
      // même règle que PgWebhookWorkStore.mark : le motif d'horodatage n'est jamais remplacé
      const keep = status === 'QUARANTINED' && row.error === 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE';
      row.status = status;
      row.error = keep ? row.error : error;
      if (status !== 'PROCESSED') row.processingAttempts += 1;
    }
    return Promise.resolve();
  }
}
