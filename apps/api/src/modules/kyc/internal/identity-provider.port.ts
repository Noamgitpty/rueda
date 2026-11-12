/**
 * Port `IdentityProvider` du module KYC (17 §5 « KYC », §10 ; ADR-007 ; US-020, ADR-058).
 *
 * Parcours **hébergé** chez le fournisseur : l'application n'envoie ni pièce ni selfie (zéro copie
 * par défaut, F15), seulement une référence opaque du sujet et le type de pièce ; la décision
 * revient par un rappel signé, et `getStatus` permet le rapprochement si le rappel se perd.
 *
 * Règles du port :
 * - les pays et types de pièce sont des **données** (configuration CFG), jamais des constantes ;
 * - pièce non prise en charge ⇒ `UNSUPPORTED_DOCUMENT` (capacité inconnue = « non ») ;
 * - les échecs sont des valeurs ; `TIMEOUT` = issue inconnue : rejouer la même clé d'idempotence.
 *
 * Adaptateurs : FAKE `@rueda/fake-adapters/identity` (tests et développement, C19) ; fournisseur
 * réel après le choix du pays (DEC-FONDATEUR-03, lot C, VER-029).
 */
export type IdentityOutcome<T, R extends string> =
  | { readonly status: 'OK'; readonly value: T; readonly replayed: boolean }
  | { readonly status: 'REFUSED'; readonly reason: R | 'IDEMPOTENCY_CONFLICT' | 'UNSUPPORTED' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export interface IdentityDocumentRef {
  readonly country: string;
  readonly kind: string;
}

export interface StartVerificationRequest {
  readonly idempotencyKey: string;
  /** Référence opaque du sujet (jamais un nom, une pièce ni un email). */
  readonly subjectRef: string;
  readonly document: IdentityDocumentRef;
  readonly locale: string;
  readonly returnUrl: string;
}

export interface VerificationSession {
  readonly sessionId: string;
  readonly hostedUrl: string;
  readonly expiresAt: Date;
}

export type IdentityDecision = 'APPROVED' | 'DECLINED' | 'REVIEW';

export interface VerificationStatus {
  readonly sessionId: string;
  readonly state: 'PENDING' | 'EXPIRED' | IdentityDecision;
  readonly reasons: readonly string[];
}

/**
 * Champs MINIMAUX de la pièce lue par le fournisseur (US-105 ; 17 §3.2.2) : jamais d'image ni de
 * numéro (zéro copie, 17 §1.5 point 3). Échéance au format AAAA-MM-JJ.
 */
export interface IdentityDocumentResult {
  readonly kind: string;
  readonly country: string;
  readonly expiresOn: string | null;
  readonly licenseClass: string | null;
  readonly isPermanent: boolean | null;
  readonly providerDocumentRef: string | null;
}

/**
 * Faits VÉRIFIÉS sur la personne (US-123, ADR-105 ; BOARD N-28, N-38) : date de naissance lue sur
 * la pièce (AAAA-MM-JJ) et pays de résidence établi par le fournisseur. Source prioritaire de l'âge
 * et de la résidence de l'hôte. Jamais un nom, un numéro ni une adresse.
 */
export interface IdentitySubjectFacts {
  readonly dateOfBirth: string | null;
  readonly residenceCountry: string | null;
}

/**
 * Contrôles du fournisseur : scores de liveness et de face match (0 à 1, C3), pièce lue et, quand
 * le fournisseur les rend, faits vérifiés sur la personne.
 */
export interface IdentityChecks {
  readonly livenessScore: number | null;
  readonly faceMatchScore: number | null;
  readonly document: IdentityDocumentResult | null;
  readonly subject?: IdentitySubjectFacts | null;
}

export interface IdentityDecisionEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly subjectRef: string;
  readonly decision: IdentityDecision;
  readonly reasons: readonly string[];
  readonly decidedAt: Date;
  readonly checks: IdentityChecks;
}

/** Demande d'effacement d'une session chez le fournisseur (retrait du consentement, VER-004). */
export interface ErasureRequest {
  readonly idempotencyKey: string;
  readonly sessionId: string;
}

/** Attestation d'effacement rendue par le fournisseur (consignée en base). */
export interface ErasureReceipt {
  readonly attestationRef: string;
  readonly erasedAt: Date;
}

export type IdentityWebhookVerdict =
  | { readonly status: 'ACCEPTED'; readonly event: IdentityDecisionEvent }
  | { readonly status: 'REJECTED'; readonly reason: 'BAD_SIGNATURE' | 'STALE' | 'MALFORMED' };

export interface IdentityProvider {
  readonly supportsDocument: (document: IdentityDocumentRef) => boolean;
  readonly startVerification: (
    request: StartVerificationRequest,
  ) => Promise<IdentityOutcome<VerificationSession, 'UNSUPPORTED_DOCUMENT'>>;
  readonly getStatus: (
    sessionId: string,
  ) => Promise<IdentityOutcome<VerificationStatus, 'UNKNOWN_SESSION'>>;
  /**
   * Efface chez le fournisseur les images, selfies et données biométriques d'une session
   * (retrait du consentement, VER-004 ; RISKS L1-PM-39) et rend une attestation. Idempotent.
   */
  readonly requestErasure: (
    request: ErasureRequest,
  ) => Promise<IdentityOutcome<ErasureReceipt, 'UNKNOWN_SESSION'>>;
  /** Vérifie la signature et la fraîcheur d'un rappel (corps brut), puis le lit. */
  readonly parseWebhook: (
    body: string,
    signature: string | undefined,
    receivedAt: Date,
  ) => IdentityWebhookVerdict;
}
