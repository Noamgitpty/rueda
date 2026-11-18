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
import type { HostedPayment, OperationResult, PaymentProvider } from './port.js';
import { chargeLegs } from './deposit-rails.js';
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

export interface DepositExecution {
  readonly completed: readonly DepositStepResult[];
  /** Première étape en échec : l'exécution s'arrête ; un rejeu reprend avec les MÊMES clés. */
  readonly failed: { readonly step: DepositStep; readonly error: unknown } | null;
}

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
    const code = ref.currency.code;
    for (const step of plan.steps) {
      try {
        completed.push({ step, result: await this.#run(ref, step, code, target) });
      } catch (error) {
        return { completed, failed: { step, error } };
      }
    }
    return { completed, failed: null };
  }

  async #run(
    ref: DepositReference,
    step: DepositStep,
    currency: string,
    target: {
      readonly providerReference: string;
      readonly instrumentToken: string;
      readonly attemptNo: number;
    },
  ): Promise<OperationResult | null> {
    const a = target.attemptNo;
    switch (step.op) {
      case 'CAPTURE':
        return this.#provider.capture({
          idempotencyKey: this.#key(ref, 'CAPTURE', 1, a),
          providerReference: target.providerReference,
          amountMinor: step.amountMinor,
          currency,
          legs: step.legs,
        });
      case 'VOID':
        return this.#provider.void({
          idempotencyKey: this.#key(ref, 'VOID', 1, a),
          providerReference: target.providerReference,
        });
      case 'REFUND':
        return this.#provider.refund({
          idempotencyKey: this.#key(ref, 'REFUND', 1, a),
          providerReference: target.providerReference,
          amountMinor: step.amountMinor,
          currency,
          legs: step.legs,
        });
      case 'MIT_CHARGE':
        return this.#provider.chargeMIT({
          idempotencyKey: this.#key(ref, 'MIT_CHARGE', 1, a),
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
