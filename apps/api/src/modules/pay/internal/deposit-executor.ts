/**
 * Exécution des rails de la caution par le port `PaymentProvider` (17 §2.8 ; 08 BR-PAY-06 ;
 * US-225, ADR-164). Jusqu'au lot C, seul l'adaptateur FAKE existe (C19) : cette classe n'est
 * branchée à aucun travailleur de production dans cette story.
 *
 * - Chaque commande porte son **montant explicite** et, si elle déplace des fonds, ses jambes
 *   (`chargeLegs` pour la pose, jambes des frais pour une capture ou un débit MIT) ; l'adaptateur les
 *   revérifie avant tout appel (`LEG_SUM_MISMATCH`).
 * - Clé d'idempotence par tentative (`depositOperationKey`), transmise telle quelle ou condensée selon
 *   `IDEMPOTENCY_KEY_MAX_LEN` : un rejeu avec la même tentative ne crée jamais un second mouvement.
 * - **Aucun fonds de tiers détenu** : le rail « débit puis remboursement » est refusé sans appel tant
 *   que `funds_holding_enabled[pays]` = `false` (relu par l'appelant, jamais déduit ici).
 * - Ré-autorisation refusée (ou capacité non validée) : signal ops `DEPOSIT_REAUTH_FAILED`, **aucun
 *   débit** de remplacement.
 */
import { PaymentError, isPaymentError } from './errors.js';
import { depositOperationKey, idempotencyKeyToSend } from './idempotency.js';
import type { DepositOperationType } from './idempotency.js';
import type { HostedPayment, OperationResult, OperationStatus, PaymentProvider } from './port.js';
import { chargeLegs, fallbackAfterCaptureFailure } from './deposit-rails.js';
import type { DepositDecisionPlan, DepositRail, DepositStep } from './deposit-rails.js';
import { money } from '@rueda/money';
import type { Currency } from '@rueda/money';

/** Méthodes du port utilisées par les rails de la caution. */
export type DepositPaymentProvider = Pick<
  PaymentProvider,
  | 'capabilities'
  | 'createHostedPayment'
  | 'capture'
  | 'void'
  | 'refund'
  | 'chargeMIT'
  | 'reauthorize'
>;

export interface DepositReference {
  /** `deposit_hold.id`. */
  readonly depositId: string;
  /** Trip dont le PSP tient les jambes. */
  readonly tripReference: string;
  readonly currency: Currency;
}

export interface PlaceDepositRequest {
  readonly mechanism: DepositRail;
  readonly amountMinor: bigint;
  /** `funds_holding_enabled[pays]`, relu au moment de la pose. */
  readonly fundsHoldingEnabled: boolean;
  readonly attemptNo: number;
}

export type DepositReauthOutcome =
  | { readonly kind: 'REAUTHORIZED'; readonly result: OperationResult }
  | {
      readonly kind: 'REAUTH_REFUSED';
      /** Le trip est signalé à l'ops ; aucun débit. */
      readonly opsSignal: 'DEPOSIT_REAUTH_FAILED';
      readonly reason: 'DECLINED' | 'UNSUPPORTED_CAPABILITY';
    };

export interface DepositStepResult {
  readonly step: DepositStep;
  /** `null` : étape sans appel au PSP (`LET_EXPIRE`, `DEBT`). */
  readonly result: OperationResult | null;
}

/** Étape où l'exécution s'est arrêtée. */
export interface DepositStepFailure {
  readonly step: DepositStep;
  /** Exception du port (refus, issue inconnue, capacité absente) ; `null` si un statut a été rendu. */
  readonly error: unknown;
  /** Statut rendu par le port autre que `SUCCEEDED` ; `null` si une exception a été levée. */
  readonly status: OperationStatus | null;
  /**
   * Issue inconnue ou en cours (`UNKNOWN_OUTCOME`, `UNKNOWN`, `PENDING`, `SUBMITTED`) : l'appelant
   * lit l'état faisant foi (`getOperation`) AVANT tout rejeu, qui garde les MÊMES clés (17 §4.3).
   */
  readonly needsLookup: boolean;
}

export interface DepositExecution {
  readonly completed: readonly DepositStepResult[];
  /**
   * Première étape qui n'a pas abouti (exception ou statut autre que `SUCCEEDED`) : l'exécution
   * s'arrête, AUCUNE étape suivante ne part (un VOID n'est jamais envoyé après une capture non
   * prouvée) ; un rejeu reprend avec les mêmes clés.
   */
  readonly failed: DepositStepFailure | null;
  /** Repli exécuté après un REFUS de capture (08 E3 repli 2 : VOID total puis MIT) ; sinon `null`. */
  readonly fallback: DepositDecisionPlan | null;
}

type Target = {
  readonly providerReference: string;
  readonly instrumentToken: string;
  readonly attemptNo: number;
};

const UNSETTLED: ReadonlySet<OperationStatus> = new Set<OperationStatus>([
  'PENDING',
  'SUBMITTED',
  'UNKNOWN',
]);

export class DepositRailExecutor {
  readonly #provider: DepositPaymentProvider;

  constructor(provider: DepositPaymentProvider) {
    this.#provider = provider;
  }

  #key(ref: DepositReference, op: DepositOperationType, instanceSeq: number, attemptNo: number) {
    const plain = depositOperationKey(ref.depositId, op, instanceSeq, attemptNo);
    return idempotencyKeyToSend(
      plain,
      this.#provider.capabilities().int('IDEMPOTENCY_KEY_MAX_LEN'),
    );
  }

  /**
   * Pose de la caution à `auth_at` : pré-autorisation (`MANUAL`) pour les rails PREAUTH_SINGLE et
   * REAUTH, débit (`AUTO`) pour le rail CHARGE_THEN_REFUND, toujours sur la page hébergée du PSP
   * (le port n'a pas d'autorisation sans le voyageur : suite S-1 d'ADR-164).
   */
  async place(ref: DepositReference, req: PlaceDepositRequest): Promise<HostedPayment> {
    if (req.mechanism === 'CHARGE_THEN_REFUND' && !req.fundsHoldingEnabled) {
      throw new PaymentError(
        'INVALID_REQUEST',
        'caution débitée puis remboursée : funds_holding_enabled = false (aucun fonds de tiers détenu)',
      );
    }
    const amount = money(req.amountMinor, ref.currency);
    const charge = req.mechanism === 'CHARGE_THEN_REFUND';
    return this.#provider.createHostedPayment({
      idempotencyKey: this.#key(ref, charge ? 'CHARGE' : 'AUTH', 1, req.attemptNo),
      tripReference: ref.tripReference,
      method: 'CARD',
      amountMinor: amount.amountMinor,
      currency: amount.currency,
      legs: chargeLegs(amount),
      capture: charge ? 'AUTO' : 'MANUAL',
    });
  }

  /**
   * Ré-autorisation (rail a), demandée avant l'échéance. Refus reçu ou capacité non validée ⇒
   * `REAUTH_REFUSED` (trip signalé à l'ops, sans débit). Issue inconnue : l'erreur remonte, la
   * même clé est rejouée après lecture de l'état (17 §4.3 point 3).
   */
  async reauthorize(
    ref: DepositReference,
    providerReference: string,
    instanceSeq: number,
    attemptNo: number,
  ): Promise<DepositReauthOutcome> {
    try {
      const result = await this.#provider.reauthorize({
        idempotencyKey: this.#key(ref, 'REAUTH', instanceSeq, attemptNo),
        providerReference,
      });
      if (result.status === 'FAILED') {
        return { kind: 'REAUTH_REFUSED', opsSignal: 'DEPOSIT_REAUTH_FAILED', reason: 'DECLINED' };
      }
      return { kind: 'REAUTHORIZED', result };
    } catch (error) {
      if (isPaymentError(error, 'DECLINED') || isPaymentError(error, 'UNSUPPORTED_CAPABILITY')) {
        return {
          kind: 'REAUTH_REFUSED',
          opsSignal: 'DEPOSIT_REAUTH_FAILED',
          reason: error.code === 'DECLINED' ? 'DECLINED' : 'UNSUPPORTED_CAPABILITY',
        };
      }
      throw error;
    }
  }

  /** Exécute les commandes de la décision dans l'ordre (T57 : capture puis VOID ; T58 : VOID puis MIT). */
  async execute(
    ref: DepositReference,
    plan: DepositDecisionPlan,
    target: {
      /** Référence PSP de la pose (autorisation ou débit). */
      readonly providerReference: string;
      /** Jeton de la carte enregistrée (consentement MIT du checkout). */
      readonly instrumentToken: string;
      readonly attemptNo: number;
    },
  ): Promise<DepositExecution> {
    const completed: DepositStepResult[] = [];
    const first = await this.#steps(ref, plan.steps, 1, target, completed);
    if (first === null) return { completed, failed: null, fallback: null };
    if (!first.captureRefused) return { completed, failed: first.failure, fallback: null };
    // 08 E3 repli 2 : capture refusée ⇒ aucun frais sur la caution, VOID total puis MIT de tous les
    // frais ; clés de rang i2 (le plan d'origine n'a envoyé que la capture refusée)
    const fallback = fallbackAfterCaptureFailure(plan, {
      capabilities: this.#provider.capabilities(),
    });
    if (fallback === null) return { completed, failed: first.failure, fallback: null };
    const second = await this.#steps(ref, fallback.steps, 2, target, completed);
    return { completed, failed: second === null ? null : second.failure, fallback };
  }

  /** Étapes dans l'ordre ; `null` si toutes ont abouti, sinon la première qui n'a pas abouti. */
  async #steps(
    ref: DepositReference,
    steps: readonly DepositStep[],
    instanceSeq: number,
    target: Target,
    completed: DepositStepResult[],
  ): Promise<{ readonly failure: DepositStepFailure; readonly captureRefused: boolean } | null> {
    const code = ref.currency.code;
    for (const step of steps) {
      let result: OperationResult | null;
      try {
        result = await this.#run(ref, step, code, target, instanceSeq);
      } catch (error) {
        return {
          failure: {
            step,
            error,
            status: null,
            needsLookup: isPaymentError(error, 'UNKNOWN_OUTCOME'),
          },
          captureRefused: step.op === 'CAPTURE' && isPaymentError(error, 'DECLINED'),
        };
      }
      if (result !== null && result.status !== 'SUCCEEDED') {
        return {
          failure: {
            step,
            error: null,
            status: result.status,
            needsLookup: UNSETTLED.has(result.status),
          },
          captureRefused: step.op === 'CAPTURE' && result.status === 'FAILED',
        };
      }
      completed.push({ step, result });
    }
    return null;
  }

  async #run(
    ref: DepositReference,
    step: DepositStep,
    currency: string,
    target: Target,
    i: number,
  ): Promise<OperationResult | null> {
    const a = target.attemptNo;
    switch (step.op) {
      case 'CAPTURE':
        return this.#provider.capture({
          idempotencyKey: this.#key(ref, 'CAPTURE', i, a),
          providerReference: target.providerReference,
          amountMinor: step.amountMinor,
          currency,
          legs: step.legs,
        });
      case 'VOID':
        return this.#provider.void({
          idempotencyKey: this.#key(ref, 'VOID', i, a),
          providerReference: target.providerReference,
        });
      case 'REFUND':
        return this.#provider.refund({
          idempotencyKey: this.#key(ref, 'REFUND', i, a),
          providerReference: target.providerReference,
          amountMinor: step.amountMinor,
          currency,
          legs: step.legs,
        });
      case 'MIT_CHARGE':
        return this.#provider.chargeMIT({
          idempotencyKey: this.#key(ref, 'MIT_CHARGE', i, a),
          tripReference: ref.tripReference,
          reason: step.reason,
          instrumentToken: target.instrumentToken,
          amountMinor: step.amountMinor,
          currency,
          legs: step.legs,
        });
      case 'LET_EXPIRE':
      case 'DEBT':
        return null;
    }
  }
}
