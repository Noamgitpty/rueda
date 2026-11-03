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
 * Le port de place de marché (sous-marchands, libération, versement, ajustement, transfert
 * plateforme, soldes par jambe) est ajouté par US-061 (17 §2.8, lignes `registerSubmerchant` à
 * `listLegBalances`).
 */
import type { CapabilitySet } from './capabilities.js';
import type { LegAmounts, LegBeneficiaries } from './legs.js';

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
}

/** Méthodes qui déplacent des fonds : chacune reçoit un `LegAmounts` (critère 5 de US-019). */
export const MONEY_MOVING_METHODS = [
  'createHostedPayment',
  'capture',
  'refund',
  'reallocate',
  'rollback',
  'chargeMIT',
] as const satisfies readonly (keyof PaymentProvider)[];
export type MoneyMovingMethod = (typeof MONEY_MOVING_METHODS)[number];
