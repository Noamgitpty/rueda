/**
 * Lots de versement à l'hôte (US-708, ADR-185 ; 08 SM-6, BR-PAYOUT-02 ; 17 §3.2.9) : port de
 * stockage du travailleur `payout_scheduler`. Une instance par transaction du travailleur
 * `payment_command` (la base l'exige pour chaque commande). Aucun montant n'est calculé ici :
 * montants, clés, rangs et motifs de retenue viennent des commandes de la migration 0165.
 */
import type { OperationStatus, OperationStatusStore } from '../../pay/index.js';

/** Étape d'un lot : compensation à l'échéance, libérations, versement (lecture d'abord). */
export type PayoutStep = 'NET' | 'RELEASE' | 'PAYOUT';

export interface DueBatch {
  readonly batchId: string;
  readonly step: PayoutStep;
  readonly status: string;
  readonly country: string;
  readonly currency: string;
  /** Fournisseur du compte PSP des trips du lot (connecteur à utiliser). */
  readonly provider: string;
}

export interface PrepareResult {
  /** PREPARED, ALREADY_PREPARED, NOT_COMPLETED, NO_EFFECTIVE_END, CALENDAR_MISSING… */
  readonly outcome: string;
  readonly batchId: string | null;
  readonly status: string | null;
  readonly holdReasons: readonly string[];
}

export interface BatchCheck {
  /** READY, ZERO_NET, ON_HOLD, NOT_DUE, ALREADY_NETTED… */
  readonly outcome: string;
  readonly holdReasons: readonly string[];
}

/** Item d'un lot READY et son ordre LEG_RELEASE (valeurs STOCKÉES). */
export interface ReleaseItem {
  readonly itemId: string;
  readonly tripId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly pspAccountId: string;
  /** Rang et clé de l'ordre à enregistrer s'il n'y a aucun ordre vivant. */
  readonly nextAttempt: number;
  readonly nextKey: string;
  readonly operationId: string | null;
  readonly operationStatus: OperationStatus | null;
  readonly idemSent: string | null;
  readonly providerReference: string | null;
  /** Libération reportée sur les soldes par jambe. */
  readonly applied: boolean;
  /** Sous-marchand ACTIVE de l'hôte chez le PSP ; `null` : aucun. */
  readonly beneficiaryReference: string | null;
}

export interface RecordReleaseInput {
  readonly operationId: string;
  readonly tripId: string;
  readonly pspAccountId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly attemptNo: number;
  readonly idemPlain: string;
  readonly idemSent: string;
}

/** Ordre de versement d'un lot (`payout:{lot}:r{n}`). */
export interface PayoutOrder {
  /** INITIATED (émis à l'instant), REPLAY (déjà émis : lecture d'abord), ON_HOLD, RELEASE_PENDING… */
  readonly outcome: string;
  readonly idempotencyKey: string | null;
  readonly amountMinor: bigint | null;
  readonly currency: string | null;
  readonly submerchantReference: string | null;
  readonly providerRef: string | null;
  readonly holdReasons: readonly string[];
}

export interface PayoutBatchStore extends OperationStatusStore {
  tripsToPrepare(limit: number): Promise<readonly string[]>;
  prepareTrip(tripId: string): Promise<PrepareResult>;
  dueBatches(limit: number): Promise<readonly DueBatch[]>;
  netBatch(batchId: string): Promise<BatchCheck>;
  recheckBatch(batchId: string): Promise<BatchCheck>;
  releaseItems(batchId: string): Promise<readonly ReleaseItem[]>;
  /** Ordre LEG_RELEASE PENDING de l'item (gardé par la base) ; rend l'identifiant de l'ordre. */
  recordRelease(input: RecordReleaseInput): Promise<string>;
  /** Report d'une libération prouvée sur les soldes par jambe. */
  applyRelease(operationId: string): Promise<string>;
  initiate(batchId: string): Promise<PayoutOrder>;
  recordPayoutResult(
    batchId: string,
    status: OperationStatus,
    providerRef: string | null,
  ): Promise<string>;
}
