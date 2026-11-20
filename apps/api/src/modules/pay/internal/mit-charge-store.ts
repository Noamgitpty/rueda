/**
 * Débits post-trip par MIT (US-703, ADR-189 ; 16 PAY-015 / PAY-037 ; 08 BR-PAY-09 bis, E4) : port
 * de stockage de la tâche `mit_charge_scheduler`. Une instance par transaction du travailleur
 * `payment_command` (la base l'exige pour chaque commande). Aucun montant, aucune clé, aucun délai
 * n'est calculé ici : consentement, rappel, carte, règle du réseau, préavis, délai, `SUPPORTS_MIT`,
 * échéancier et clé `{trip}:1:{v…}:MIT_CHARGE:{moyen}:i1:a{n}` viennent des commandes de 0169.
 */
import type { LegAmounts } from './legs.js';
import type { MitReason, OperationStatus } from './port.js';
import type { OperationStatusStore } from './stores.js';

/** États d'un débit post-trip (CHECK de 0169). */
export const POST_TRIP_CHARGE_STATUSES = [
  'NOTIFIED',
  'CHARGING',
  'RETRY_DUE',
  'CHARGED',
  'UNPAID',
] as const;
export type PostTripChargeStatus = (typeof POST_TRIP_CHARGE_STATUSES)[number];

export interface DueCharge {
  readonly chargeId: string;
  readonly status: PostTripChargeStatus;
  /** Fournisseur du compte PSP du débit (connecteur à utiliser). */
  readonly provider: string;
  readonly country: string;
}

/** Issues de `core.payment_cmd_plan_mit_attempt` (0169). */
export const PLAN_OUTCOMES = [
  'PLANNED',
  'IN_FLIGHT',
  'SETTLE',
  'NOT_DUE',
  'BLOCKED',
  'DEBT',
  'DONE',
  'NOT_FOUND',
] as const;
export type PlanOutcome = (typeof PLAN_OUTCOMES)[number];

export interface PlanResult {
  readonly outcome: PlanOutcome;
  /** Motif de la base (`MIT_NOTICE_PERIOD_NOT_ELAPSED`, `MIT_CONSENT_MISSING`…) ; jamais un message. */
  readonly code: string | null;
  readonly operationId: string | null;
  readonly attempt: number | null;
}

/** Ordre `MIT_CHARGE` STOCKÉ de la tentative courante (valeurs relues, jamais recalculées). */
export interface MitOrder {
  readonly sendable: boolean;
  readonly operationId: string | null;
  readonly status: OperationStatus | null;
  readonly idemSent: string | null;
  readonly amountMinor: bigint | null;
  readonly currency: string | null;
  readonly legs: LegAmounts | null;
  readonly providerReference: string | null;
  /** Jeton du coffre du PSP de la carte consentie [C4] ; jamais journalisé. */
  readonly instrumentToken: string | null;
  readonly reason: MitReason | null;
  readonly attempt: number | null;
}

/** Issues de `core.payment_cmd_settle_mit_attempt` (0169). */
export const SETTLE_OUTCOMES = [
  'CHARGED',
  'AWAITING_PROOF',
  'RETRY_DUE',
  'DEBT',
  'IN_FLIGHT',
  'DONE',
  'NOT_FOUND',
] as const;
export type SettleOutcome = (typeof SETTLE_OUTCOMES)[number];

export interface SettleResult {
  readonly outcome: SettleOutcome;
  readonly code: string | null;
}

export interface MitChargeStore extends OperationStatusStore {
  due(limit: number): Promise<readonly DueCharge[]>;
  /** Planifie (ou relit) la tentative courante ; `operationId` : identifiant d'un nouvel ordre. */
  plan(chargeId: string, operationId: string): Promise<PlanResult>;
  /** Ordre de la tentative courante, sous les verrous du trip et du débit. */
  orderForSend(chargeId: string): Promise<MitOrder>;
  /** Reporte l'issue connue de la tentative courante (refus « ne pas réessayer » compris). */
  settle(chargeId: string, doNotRetry: boolean): Promise<SettleResult>;
  /** Prochaine relecture d'un débit en cours ou en attente de preuve (+15 min, base). */
  defer(chargeId: string, code: string): Promise<string>;
}
