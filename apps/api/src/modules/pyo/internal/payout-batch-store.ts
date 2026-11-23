/**
 * Lots de versement à l'hôte (US-708, ADR-185 ; 08 SM-6, BR-PAYOUT-02 ; 17 §3.2.9) : port de
 * stockage du travailleur `payout_scheduler` ; ajustement de la part compensée (US-709, 0167). Une instance par transaction du travailleur
 * `payment_command` (la base l'exige pour chaque commande). Aucun montant n'est calculé ici :
 * montants, clés, rangs et motifs de retenue viennent des commandes de la migration 0165 ; parts
 * HOST des débits post-trip reportés versées par le lot suivant (US-319, 0180, ADR-200).
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

/** Débit post-trip reporté (frais annexe, dommage, amende) dont la part HOST attend un lot. */
export interface ChargeToPrepare {
  readonly chargeId: string;
  readonly tripId: string;
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
  /**
   * INITIATED (émis à l'instant), REPLAY (déjà émis : lecture d'abord ; `holdReasons` non vide ⇒
   * lecture seule, jamais un envoi), ON_HOLD, RELEASE_PENDING…
   */
  readonly outcome: string;
  readonly idempotencyKey: string | null;
  readonly amountMinor: bigint | null;
  readonly currency: string | null;
  readonly submerchantReference: string | null;
  readonly providerRef: string | null;
  readonly holdReasons: readonly string[];
}

/**
 * Ajustement de versement de la part compensée d'un lot (US-709, ADR-187 ; 08 E7 règle 7,
 * `adjustPayout`), avant le versement : clé `adjust:{lot}:r1`, montant compensé STOCKÉ.
 */
export interface AdjustmentOrder {
  /**
   * ADJUST (à envoyer), REPLAY (déjà envoyé : lecture d'abord), DONE (réussi), FAILED (revue FIN,
   * jamais renvoyé), NONE (rien de compensé), RELEASE_PENDING, ON_HOLD, l'état du lot sinon.
   */
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
  /** Préparation différée après un refus de la base (`code` : contrainte ou SQLSTATE). */
  deferTrip(tripId: string, code: string): Promise<void>;
  /** US-319 : débits post-trip reportés à mettre dans le lot suivant (item du trip compensé). */
  chargesToPrepare(limit: number): Promise<readonly ChargeToPrepare[]>;
  /** US-319 : part HOST explicite du débit rattachée au lot suivant de l'hôte. */
  prepareCharge(chargeId: string): Promise<PrepareResult>;
  dueBatches(limit: number): Promise<readonly DueBatch[]>;
  netBatch(batchId: string): Promise<BatchCheck>;
  recheckBatch(batchId: string): Promise<BatchCheck>;
  releaseItems(batchId: string): Promise<readonly ReleaseItem[]>;
  /** Ordre LEG_RELEASE PENDING de l'item (gardé par la base) ; rend l'identifiant de l'ordre. */
  recordRelease(input: RecordReleaseInput): Promise<string>;
  /** Report d'une libération prouvée sur les soldes par jambe. */
  applyRelease(operationId: string): Promise<string>;
  /** Ajustement de la part compensée (US-709) : à faire avant `initiate`. */
  adjustment(batchId: string): Promise<AdjustmentOrder>;
  recordAdjustment(
    batchId: string,
    status: OperationStatus,
    providerRef: string | null,
  ): Promise<string>;
  initiate(batchId: string): Promise<PayoutOrder>;
  recordPayoutResult(
    batchId: string,
    status: OperationStatus,
    providerRef: string | null,
  ): Promise<string>;
}
