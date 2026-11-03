/**
 * Ports de persistance du module PAY (adaptateurs : `pg-stores.ts` en production, mémoire dans
 * `../testing/` pour les tests unitaires). Chaque écriture passe par une commande SQL
 * `core.payment_cmd_*` (migration 0028), jamais par une écriture de table directe de l'API.
 */
import type { NormalizedPaymentEvent, OperationStatus } from './port.js';

// --- réception des webhooks (API, rôle app_api) ------------------------------------------------

export interface WebhookAccount {
  readonly accountId: string;
  /** Référence de coffre du secret (C4) ; jamais le secret lui-même. */
  readonly webhookSecretRef: string | null;
}

export type ReceiveOutcome =
  'NOT_FOUND' | 'RECEIVED' | 'QUARANTINED' | 'DUPLICATE' | 'REJECTED_SIGNATURE';

export interface ReceiveWebhookInput {
  readonly accountId: string;
  readonly providerEventId: string | null;
  /** 32 octets (SHA-256), 17 §4.4 point 3. */
  readonly dedupKey: Uint8Array;
  readonly signatureValid: boolean;
  readonly signedAt: Date | null;
  /** En-têtes conservés, PAN masqués. */
  readonly headers: Readonly<Record<string, string>>;
  /** Événements normalisés, PAN masqués ; vides si la signature est invalide. */
  readonly events: readonly NormalizedPaymentEvent[];
}

export interface WebhookInboxStore {
  /** Compte du point d'entrée ; `null` : inconnu, ou FAKE en production (404 sans écriture). */
  resolveAccount(provider: string, publicWebhookId: string): Promise<WebhookAccount | null>;
  receive(
    input: ReceiveWebhookInput,
  ): Promise<{ readonly outcome: ReceiveOutcome; readonly inboxId: string | null }>;
}

// --- statuts d'opération (travailleurs, rôle app_worker) ----------------------------------------

export type StatusSource = 'API_RESPONSE' | 'WEBHOOK' | 'POLL' | 'MANUAL_OPS';
export type ApplyOutcome = 'APPLIED' | 'DUPLICATE' | 'STALE' | 'CONFLICT' | 'NOT_FOUND';

export interface ApplyStatusInput {
  readonly operationId: string;
  readonly status: Exclude<OperationStatus, 'PENDING'>;
  readonly source: StatusSource;
  readonly rawRef: string | null;
  readonly providerReference: string | null;
}

export interface OperationStatusStore {
  /** Applique un statut selon les rangs de 17 §4.4 point 7 (`core.payment_cmd_apply_operation_status`). */
  apply(input: ApplyStatusInput): Promise<ApplyOutcome>;
}

// --- traitement asynchrone de la boîte de réception (travailleur webhook_ingest) ----------------

export interface InboxItem {
  readonly inboxId: string;
  readonly accountId: string;
  readonly provider: string;
  readonly status: 'RECEIVED' | 'QUARANTINED';
  readonly receivedAt: Date;
  /** Reçu depuis plus de 15 min (17 §4.4 point 6), calculé à l'heure de la BASE. */
  readonly quarantineExpired: boolean;
  readonly events: readonly NormalizedPaymentEvent[];
}

export interface OperationRef {
  readonly operationId: string;
  readonly idemSent: string;
  readonly providerReference: string | null;
}

export interface WebhookWorkStore extends OperationStatusStore {
  /** Éléments à traiter (`RECEIVED`, `QUARANTINED`), verrouillés jusqu'à la fin du traitement. */
  claim(limit: number): Promise<readonly InboxItem[]>;
  /** Rattachement par référence PSP, ou par notre clé si le PSP la renvoie (17 §4.4 point 6). */
  findOperation(
    accountId: string,
    by: { readonly providerReference: string; readonly merchantReference: string | null },
  ): Promise<OperationRef | null>;
  mark(
    inboxId: string,
    status: 'PROCESSED' | 'QUARANTINED' | 'FAILED',
    error: string | null,
  ): Promise<void>;
}
