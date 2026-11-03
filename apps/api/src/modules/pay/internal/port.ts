/**
 * Port `PaymentProvider` (17 §2.8 ; 16 fiche PAY-001 ; ADR-032, ADR-045, ADR-059).
 *
 * Un adaptateur par PSP ; aucun code métier ne connaît un PSP. Jusqu'au lot C, seul l'adaptateur
 * FAKE existe (`../testing/`, jamais en production, C19).
 *
 * Règles du contrat (vérifiées par la suite `../testing/contract.ts`, la même pour le FAKE et le
 * connecteur réel) :
 * 1. **Toute méthode qui déplace des fonds reçoit un `LegAmounts`** (`MONEY_MOVING_METHODS`) ;
 *    l'adaptateur vérifie Σ jambes = montant et chaque jambe ≥ 0 (réaffectation : Σ = 0) AVANT
 *    tout appel, sinon `LEG_SUM_MISMATCH` / `LEG_AMOUNT_NEGATIVE` sans appel au PSP.
 * 2. Capacité requise non validée ⇒ `UNSUPPORTED_CAPABILITY` sans appel (inconnue = non).
 * 3. `idempotencyKey` = `idem_sent` déjà stocké (08 E4) : l'adaptateur le transmet tel quel ; un
 *    rejeu avec la même clé ne crée jamais un second mouvement.
 * 4. Délai dépassé, 5xx, réponse illisible ⇒ `UNKNOWN_OUTCOME` ; l'appelant lit `getOperation`
 *    avant tout renvoi (17 §4.3 point 3).
 * 5. Montants : `bigint` en unités mineures de la devise du trip ; jamais de flottant.
 *
 * Port de place de marché (US-061 ; 17 §2.8, lignes `registerSubmerchant` à `listLegBalances` ;
 * 08 E7 ; ADR-066) : Kmino marchand de référence, chaque hôte sous-marchand. Règles en plus :
 * 6. Capacité BLOQUANTE non validée (17 §2.8) ⇒ `HOST_PAYOUT_RAIL_UNAVAILABLE` à
 *    l'enregistrement d'un hôte et avant tout paiement (`createHostedPayment`), sans appel.
 * 7. Un débit (remboursement, réaffectation, transfert) d'une jambe déjà libérée ou gelée ⇒
 *    `LEG_ALREADY_RELEASED`, sans mouvement : la variation doit avoir été portée sur `PLATFORM`
 *    avant l'appel (08 E7 règle 3 bis, TJ18b).
 * 8. Le PSP exécute les montants par jambe reçus, à l'unité près, jamais un prorata (08 E7
 *    règle 1, TJ10c) : la suite de contrat relit les jambes (`getOperation`, `listLegBalances`).
 * 9. Chaque écriture de place de marché est idempotente par sa clé (17 §2.8) :
 *    `submerchant:{org_id}:a{n}`, `release:{trip_id}:{segment}:{jambe}:i{n}`, lot de versement,
 *    `adjust:{host_ledger_entry_id}`, `ptransfer:{platform_advance_id}`.
 */
import type { CapabilitySet } from './capabilities.js';
import type { Leg, LegAmounts, LegBeneficiaries } from './legs.js';

export const PAYMENT_METHODS = ['CARD', 'YAPPY', 'CLAVE', 'QR', 'PIX', 'BANK_TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Projection du statut d'une opération (17 §3.2.7 ; rangs §4.4 point 7). */
export const OPERATION_STATUSES = [
  'PENDING',
  'SUBMITTED',
  'SUCCEEDED',
  'FAILED',
  'UNKNOWN',
] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export type CaptureMode = 'AUTO' | 'MANUAL';

/** Motifs d'un débit initié par le marchand (17 §2.8 `chargeMIT`). */
export const MIT_REASONS = [
  'DELAYED_CHARGES',
  'NO_SHOW',
  'DAMAGE_SEPARATE',
  'REAUTHORIZATION',
] as const;
export type MitReason = (typeof MIT_REASONS)[number];

interface Keyed {
  /** `idem_sent` (08 E4), déjà stocké avant l'appel. */
  readonly idempotencyKey: string;
}

/** Ordre qui déplace des fonds : montant et jambes explicites, dans la devise du trip. */
interface MovesFunds extends Keyed {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly legs: LegAmounts;
  readonly beneficiaries?: LegBeneficiaries;
}

export interface CreateHostedPaymentRequest extends MovesFunds {
  /** Trip (ou hold) dont le PSP tient les jambes ; défaut : la référence de l'ordre. */
  readonly tripReference?: string;
  readonly method: PaymentMethod;
  /** `AUTO` : `legs` = jambes de la capture (08 E7 règle 2) ; `MANUAL` : pré-autorisation. */
  readonly capture: CaptureMode;
}

export interface CaptureRequest extends MovesFunds {
  /** Référence PSP de l'autorisation. */
  readonly providerReference: string;
}

export interface RefundRequest extends MovesFunds {
  /** Référence PSP de l'opération encaissée remboursée. */
  readonly providerReference: string;
}

export interface RollbackRequest extends MovesFunds {
  readonly providerReference: string;
}

export interface ChargeMitRequest extends MovesFunds {
  readonly tripReference?: string;
  readonly reason: MitReason;
  /** Jeton de l'instrument de garantie (jamais un PAN, 17 §1.6). */
  readonly instrumentToken: string;
  readonly networkTxReference?: string;
}

/** Réaffectation de somme nulle entre jambes d'un trip (08 E7 règle 3). */
export interface ReallocateRequest extends Keyed {
  readonly providerReference: string;
  readonly currency: string;
  readonly legs: LegAmounts;
}

export interface ReferenceRequest extends Keyed {
  readonly providerReference: string;
}

export interface HostedPayment {
  readonly providerReference: string;
  /** Page hébergée du PSP (SAQ A, 17 §1.6). */
  readonly redirectUrl: string;
  /** Expiration réelle de l'ordre si le PSP la rend (`ORDER_EXPIRY_RETURNED`). */
  readonly expiresAt: Date | null;
}

export interface OperationResult {
  readonly providerReference: string;
  readonly status: OperationStatus;
}

/** Recherche par NOTRE clé (si `SUPPORTS_LOOKUP_BY_MERCHANT_REF`) ou par référence du PSP. */
export type OperationLookup =
  | { readonly merchantReference: string; readonly providerReference?: undefined }
  | { readonly providerReference: string; readonly merchantReference?: undefined };

export interface ProviderOperation {
  readonly providerReference: string;
  readonly merchantReference: string | null;
  readonly status: OperationStatus;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Jambes, si le PSP les expose. */
  readonly legs: LegAmounts | null;
}

/** Événement interne normalisé (17 §4.4 point 5) : aucune donnée de carte. */
export interface NormalizedPaymentEvent {
  readonly type: string;
  readonly providerReference: string;
  /** Notre clé, si le PSP la renvoie (`ECHOES_MERCHANT_REF_IN_WEBHOOK`). */
  readonly merchantReference: string | null;
  readonly status: OperationStatus;
  /** Instant du fait chez le PSP (ISO 8601) ; jamais utilisé comme horloge de décision. */
  readonly occurredAt: string;
}

export interface WebhookVerification {
  readonly signatureValid: boolean;
  /** Horodatage signé ; la tolérance est contrôlée à l'heure de la base (17 §4.4 point 2). */
  readonly signedAt: Date | null;
  readonly providerEventId: string | null;
  readonly events: readonly NormalizedPaymentEvent[];
}

export type WebhookHeaders = Readonly<Record<string, string | undefined>>;

/** Vérification et normalisation d'un webhook (seule méthode utilisée par l'API). */
export interface WebhookVerifier {
  readonly provider: string;
  verifyAndParseWebhook(
    raw: Uint8Array,
    headers: WebhookHeaders,
    secret: Uint8Array,
  ): WebhookVerification;
}

// --- place de marché (US-061 ; 17 §2.8) ---------------------------------------------------------

/** État KYC d'un sous-marchand chez le PSP (17 §3.2.7 `psp_submerchant.kyc_status`). */
export const SUBMERCHANT_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'] as const;
export type SubmerchantStatus = (typeof SUBMERCHANT_STATUSES)[number];

export interface RegisterSubmerchantRequest extends Keyed {
  /** Référence du compte d'hôte chez Kmino (`org_id`), jamais une donnée personnelle. */
  readonly hostReference: string;
  /** Hôte particulier (P2P) : exige `SUPPORTS_INDIVIDUAL_SUBMERCHANT`. */
  readonly individual: boolean;
  readonly country: string;
  /** Devise de versement = devise du pays (08 E7 règle 9 : aucune conversion). */
  readonly payoutCurrency: string;
}

export interface Submerchant {
  readonly submerchantReference: string;
  readonly status: SubmerchantStatus;
}

/** Libération d'une jambe d'un trip vers son bénéficiaire (08 E7 règle 6). */
export interface ReleaseLegRequest extends Keyed {
  readonly tripReference: string;
  readonly leg: Leg;
  /** Une seule jambe, montant explicite : aucune ventilation possible. */
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Sous-marchand (HOST), bénéficiaire de l'assureur (INSURER) ou compte de Kmino. */
  readonly beneficiaryReference: string;
}

export interface HoldLegRequest extends Keyed {
  readonly tripReference: string;
  readonly leg: Leg;
}

/** Versement d'un lot à l'hôte, depuis ses jambes HOST libérées (B2C). */
export interface PayoutRequest extends Keyed {
  readonly submerchantReference: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

/** Motifs d'un ajustement de versement (08 E7 règle 7). */
export const PAYOUT_ADJUSTMENT_REASONS = [
  'HOST_PENALTY',
  'DAMAGE_DEDUCTIBLE',
  'IMPUTED_REFUND',
  'RELEASED_LEG_RECOVERY',
  'CHARGEBACK_RECOVERY',
] as const;
export type PayoutAdjustmentReason = (typeof PAYOUT_ADJUSTMENT_REASONS)[number];

export interface AdjustPayoutRequest extends PayoutRequest {
  readonly reason: PayoutAdjustmentReason;
}

/** Motifs d'un transfert depuis PLATFORM (17 §2.9). */
export const PLATFORM_TRANSFER_REASONS = [
  'RELEASED_LEG_ADVANCE',
  'CREDIT_BEYOND_PLATFORM',
  'HOST_COMPENSATION',
] as const;
export type PlatformTransferReason = (typeof PLATFORM_TRANSFER_REASONS)[number];

/** Transfert du solde PLATFORM vers des jambes tierces d'un trip : Σ jambes = 0. */
export interface TransferFromPlatformRequest extends Keyed {
  readonly tripReference: string;
  readonly currency: string;
  readonly legs: LegAmounts;
  readonly reason: PlatformTransferReason;
}

/** Solde d'une jambe d'un trip tenu par le PSP (rapprochement, 17 §2.9). */
export interface LegBalance {
  readonly tripReference: string;
  readonly leg: Leg;
  readonly currency: string;
  readonly capturedMinor: bigint;
  readonly refundedMinor: bigint;
  readonly reallocatedInMinor: bigint;
  readonly reallocatedOutMinor: bigint;
  readonly releasedMinor: bigint;
  readonly held: boolean;
}

export interface LegBalanceQuery {
  readonly tripReference?: string;
}

export interface PaymentProvider extends WebhookVerifier {
  /** Capacités du compte (fournisseur, pays), lecture fail-closed. */
  capabilities(): CapabilitySet;
  createHostedPayment(request: CreateHostedPaymentRequest): Promise<HostedPayment>;
  cancelOrder(request: ReferenceRequest): Promise<OperationResult>;
  capture(request: CaptureRequest): Promise<OperationResult>;
  void(request: ReferenceRequest): Promise<OperationResult>;
  refund(request: RefundRequest): Promise<OperationResult>;
  reallocate(request: ReallocateRequest): Promise<OperationResult>;
  rollback(request: RollbackRequest): Promise<OperationResult>;
  chargeMIT(request: ChargeMitRequest): Promise<OperationResult>;
  reauthorize(request: ReferenceRequest): Promise<OperationResult>;
  /** État faisant foi, indispensable après `UNKNOWN_OUTCOME` ; `null` : inconnu du PSP. */
  getOperation(lookup: OperationLookup): Promise<ProviderOperation | null>;

  // place de marché (US-061)
  registerSubmerchant(request: RegisterSubmerchantRequest): Promise<Submerchant>;
  /** `null` : sous-marchand inconnu du PSP. */
  getSubmerchant(submerchantReference: string): Promise<Submerchant | null>;
  releaseLeg(request: ReleaseLegRequest): Promise<OperationResult>;
  holdLeg(request: HoldLegRequest): Promise<OperationResult>;
  payout(request: PayoutRequest): Promise<OperationResult>;
  adjustPayout(request: AdjustPayoutRequest): Promise<OperationResult>;
  transferFromPlatform(request: TransferFromPlatformRequest): Promise<OperationResult>;
  listLegBalances(query: LegBalanceQuery): Promise<readonly LegBalance[]>;
}

/** Méthodes qui déplacent des fonds : chacune reçoit un `LegAmounts` (critère 5 de US-019). */
export const MONEY_MOVING_METHODS = [
  'createHostedPayment',
  'capture',
  'refund',
  'reallocate',
  'rollback',
  'chargeMIT',
  'transferFromPlatform',
] as const satisfies readonly (keyof PaymentProvider)[];
export type MoneyMovingMethod = (typeof MONEY_MOVING_METHODS)[number];

/**
 * Écritures de place de marché, chacune idempotente par sa clé (19 US-061, critère 5).
 * `releaseLeg`, `payout` et `adjustPayout` portent une seule jambe et son montant explicite.
 */
export const MARKETPLACE_WRITE_METHODS = [
  'registerSubmerchant',
  'releaseLeg',
  'holdLeg',
  'payout',
  'adjustPayout',
  'transferFromPlatform',
] as const satisfies readonly (keyof PaymentProvider)[];
export type MarketplaceWriteMethod = (typeof MARKETPLACE_WRITE_METHODS)[number];
