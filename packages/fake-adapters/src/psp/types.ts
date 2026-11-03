/**
 * Types du PSP simulé (`FakePsp`). Ils imitent l'API d'un **fournisseur** (vocabulaire du PSP), pas
 * le port `PaymentProvider` de PAY : l'adaptateur FAKE de `apps/api` (répertoire `testing/`)
 * traduit l'un en l'autre, comme le fera le connecteur réel du lot C avec le SDK du PSP retenu.
 *
 * Montants : `bigint` en unités mineures de la devise de l'opération (CLAUDE.md contrainte 4).
 */
import type { EnvironmentVariables } from '../guard.ts';

/**
 * Jambes d'un ordre (08 E7). Le PSP simulé contrôle leur somme (US-019) et tient, comme un PSP de
 * place de marché, un solde par trip et par jambe (US-061 : libération, gel, réaffectation).
 */
export const FAKE_LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
export type FakeLeg = (typeof FAKE_LEGS)[number];
export type FakeLegAmounts = Readonly<Record<FakeLeg, bigint>>;

/** Opérations exposées par le PSP simulé (une par appel d'API). */
export const FAKE_OPERATIONS = [
  'CREATE_ORDER',
  'CANCEL_ORDER',
  'CAPTURE',
  'VOID',
  'REFUND',
  'REALLOCATE',
  'ROLLBACK',
  'MIT_CHARGE',
  'REAUTHORIZE',
  'LOOKUP',
  // place de marché (US-061 ; 17 §2.8)
  'REGISTER_SUBMERCHANT',
  'GET_SUBMERCHANT',
  'RELEASE_LEG',
  'HOLD_LEG',
  'PAYOUT',
  'ADJUST_PAYOUT',
  'TRANSFER_FROM_PLATFORM',
  'LIST_LEG_BALANCES',
] as const;
export type FakeOperation = (typeof FAKE_OPERATIONS)[number];
/** Lectures : aucune clé d'idempotence, aucun mouvement. */
export type FakeReadOperation = 'LOOKUP' | 'GET_SUBMERCHANT' | 'LIST_LEG_BALANCES';
export type FakeWriteOperation = Exclude<FakeOperation, FakeReadOperation>;

/**
 * État d'une transaction chez le PSP simulé :
 * - ordre : `CREATED` → `AUTHORIZED` (capture manuelle) ou `SUCCEEDED` (capture automatique),
 *   `FAILED` (refus), `EXPIRED` (ordre à durée de vie, Yappy 300 s), `CANCELLED` ;
 * - autres opérations : `SUCCEEDED` ou `FAILED`.
 */
export type FakeTxStatus =
  'CREATED' | 'AUTHORIZED' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export type FakeCaptureMode = 'AUTO' | 'MANUAL';

export interface FakeTransaction {
  readonly reference: string;
  /** Clé d'idempotence reçue du marchand (`idem_sent`, 08 E4). */
  readonly merchantReference: string;
  readonly operation: FakeWriteOperation;
  readonly method: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly legs: FakeLegAmounts | null;
  readonly parentReference: string | null;
  readonly captureMode: FakeCaptureMode | null;
  readonly createdAtMs: number;
  readonly expiresAtMs: number | null;
  readonly status: FakeTxStatus;
  readonly declineCode: string | null;
  /** Ordre : montant encaissé (capture automatique, capture, débit MIT). */
  readonly capturedMinor: bigint;
  readonly refundedMinor: bigint;
  readonly voided: boolean;
  /** Ordre : nombre de paiements reçus (lien réutilisable payé deux fois : 2). */
  readonly paidCount: number;
  /** Trip dont les jambes sont tenues par le PSP (place de marché, US-061). */
  readonly tripReference: string;
  /** Sous-marchand visé (enregistrement, versement, ajustement), sinon `null`. */
  readonly submerchantReference: string | null;
}

/**
 * Réponse scriptée d'un appel (mode hostile, 17 §6.5 point 5). Consommée dans l'ordre, une par
 * appel de l'opération ; file vide ⇒ `OK`.
 * - `TIMEOUT_BEFORE` / `UNAVAILABLE` : rien n'est fait (délai dépassé avant traitement, connexion
 *   refusée) ;
 * - `TIMEOUT_AFTER_SUCCESS` / `UNREADABLE_AFTER_SUCCESS` : l'opération est FAITE, la réponse se
 *   perd ou est illisible (cas EC-29, T51) ;
 * - `DECLINE` : refus reçu (aucun fonds débité) ; `doNotRetry` : refus « ne pas réessayer » (T68) ;
 * - `ALREADY_CANCELLED` / `ALREADY_PAID` : réponses de `cancelOrder` (17 §6.5 point 5).
 */
export type FakeResponse =
  | { readonly kind: 'OK' }
  | { readonly kind: 'DECLINE'; readonly code: string; readonly doNotRetry?: boolean }
  | { readonly kind: 'TIMEOUT_BEFORE' }
  | { readonly kind: 'TIMEOUT_AFTER_SUCCESS' }
  | { readonly kind: 'UNREADABLE_AFTER_SUCCESS' }
  | { readonly kind: 'UNAVAILABLE' }
  | { readonly kind: 'ALREADY_CANCELLED' }
  | { readonly kind: 'ALREADY_PAID' };

export interface FakeWebhookScenario {
  /** Chaque webhook est livré deux fois. */
  readonly duplicate?: boolean;
  /** Les webhooks dus sont livrés du plus récent au plus ancien (hors d'ordre). */
  readonly reverse?: boolean;
  /** Retard de livraison, en millisecondes d'horloge simulée. */
  readonly delayMs?: number;
  /** Moyens dont les IPN sont perdus (Yappy, 17 §6.5 point 5). */
  readonly loseMethods?: readonly string[];
}

export interface FakePspScenario {
  readonly responses?: Partial<Record<FakeOperation, readonly FakeResponse[]>>;
  readonly webhooks?: FakeWebhookScenario;
  /** PSP qui ignore l'idempotence : la même clé débite une seconde fois (17 §6.5 point 5). */
  readonly ignoreIdempotency?: boolean;
  /**
   * PSP HOSTILE qui ventile lui-même un remboursement au prorata des jambes encaissées, au lieu des
   * montants explicites reçus (contre-exemple TJ10c, interdit par 08 E7 règle 1) : chaque jambe
   * non plateforme = arrondi au plus proche (demi vers le haut) de jambe × remboursé / encaissé,
   * PLATFORM en complément. Le test de contrat doit le détecter (US-061, critère 4).
   */
  readonly prorata?: boolean;
  /** Issue du KYC du PSP à l'enregistrement d'un sous-marchand (défaut : `ACTIVE`). */
  readonly submerchantKyc?: FakeSubmerchantStatus;
}

export type FakeCapabilityStatus =
  'VALIDATED_SANDBOX' | 'VALIDATED_CONTRACT' | 'DOCUMENTED' | 'UNKNOWN';

/** Ligne de la matrice de capacités simulée (même forme que `psp_capability`, 17 §2.8). */
export interface FakeCapability {
  readonly capability: string;
  /** `*` : tous les moyens. */
  readonly method: string;
  readonly value: boolean | number | string;
  readonly status: FakeCapabilityStatus;
}

export interface FakePspOptions {
  /** Secret de signature des webhooks (compte FAKE ; jamais un secret réel). */
  readonly secret: string;
  /** Horloge simulée (ms depuis l'époque Unix) : déterministe dans les tests. */
  readonly clock: () => number;
  /** Matrice simulée ; une capacité absente ou non `VALIDATED_*` vaut « non ». */
  readonly capabilities: readonly FakeCapability[];
  readonly scenario?: FakePspScenario;
  /** Variables d'environnement lues par la garde C19 (défaut : `process.env`). */
  readonly env?: EnvironmentVariables;
}

export interface FakeCreateOrderRequest {
  readonly merchantReference: string;
  /** Trip des jambes tenues (défaut : la référence de l'ordre). */
  readonly tripReference?: string;
  readonly method: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly legs: FakeLegAmounts;
  readonly capture: FakeCaptureMode;
}

export interface FakeMoneyRequest {
  readonly merchantReference: string;
  readonly reference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly legs: FakeLegAmounts;
}

export interface FakeReallocateRequest {
  readonly merchantReference: string;
  readonly reference: string;
  readonly currency: string;
  readonly legs: FakeLegAmounts;
}

export interface FakeMitRequest {
  readonly merchantReference: string;
  readonly tripReference?: string;
  readonly instrumentToken: string;
  readonly reason: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly legs: FakeLegAmounts;
}

export interface FakeReferenceRequest {
  readonly merchantReference: string;
  readonly reference: string;
}

export interface FakeLookup {
  readonly merchantReference?: string;
  readonly reference?: string;
}

/** Mouvement de fonds exécuté (inspection des tests : « débité une fois »). */
export interface FakeMovement {
  readonly reference: string;
  readonly merchantReference: string;
  readonly operation: FakeTransaction['operation'];
  readonly amountMinor: bigint;
  readonly legs: FakeLegAmounts | null;
}

/** Webhook signé prêt à être posté sur le point d'entrée (17 §4.4). */
export interface FakeWebhookDelivery {
  readonly eventId: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

// --- place de marché (US-061 ; 17 §2.8) -------------------------------------------------------

export type FakeSubmerchantStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REJECTED';

export interface FakeSubmerchant {
  readonly reference: string;
  /** Référence de l'hôte chez le marchand (compte d'hôte), transmise à l'enregistrement. */
  readonly hostReference: string;
  readonly individual: boolean;
  readonly country: string;
  readonly payoutCurrency: string;
  readonly status: FakeSubmerchantStatus;
  /** Jambes HOST libérées vers ce sous-marchand, versées, retenues (unités mineures). */
  readonly releasedMinor: bigint;
  readonly paidOutMinor: bigint;
  readonly adjustedMinor: bigint;
}

export interface FakeRegisterSubmerchantRequest {
  readonly merchantReference: string;
  readonly hostReference: string;
  readonly individual: boolean;
  readonly country: string;
  readonly payoutCurrency: string;
}

export interface FakeReleaseLegRequest {
  readonly merchantReference: string;
  readonly tripReference: string;
  readonly leg: FakeLeg;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Sous-marchand (jambe HOST) ou bénéficiaire (assureur, compte de Kmino). */
  readonly beneficiaryReference: string;
}

export interface FakeHoldLegRequest {
  readonly merchantReference: string;
  readonly tripReference: string;
  readonly leg: FakeLeg;
}

export interface FakePayoutRequest {
  readonly merchantReference: string;
  readonly submerchantReference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface FakeAdjustPayoutRequest extends FakePayoutRequest {
  readonly reason: string;
}

export interface FakeTransferRequest {
  readonly merchantReference: string;
  readonly tripReference: string;
  readonly currency: string;
  /** Σ = 0 : PLATFORM débitée, jambes tierces créditées. */
  readonly legs: FakeLegAmounts;
  readonly reason: string;
}

/** Solde d'une jambe d'un trip tenu par le PSP (`listLegBalances`, 17 §2.8). */
export interface FakeLegBalance {
  readonly tripReference: string;
  readonly leg: FakeLeg;
  readonly currency: string;
  readonly capturedMinor: bigint;
  readonly refundedMinor: bigint;
  readonly reallocatedInMinor: bigint;
  readonly reallocatedOutMinor: bigint;
  readonly releasedMinor: bigint;
  readonly held: boolean;
}
