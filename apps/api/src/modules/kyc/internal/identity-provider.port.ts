/**
 * Port `IdentityProvider` du module KYC (17 §5 « KYC », §10 ; ADR-007 ; US-020, ADR-057).
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

export interface IdentityDecisionEvent {
  readonly eventId: string;
  readonly sessionId: string;
  readonly subjectRef: string;
  readonly decision: IdentityDecision;
  readonly reasons: readonly string[];
  readonly decidedAt: Date;
}

export type IdentityWebhookVerdict =
  | { readonly status: 'ACCEPTED'; readonly event: IdentityDecisionEvent }
  | { readonly status: 'REJECTED'; readonly reason: 'BAD_SIGNATURE' | 'STALE' | 'MALFORMED' };

export interface IdentityProvider {
  supportsDocument(document: IdentityDocumentRef): boolean;
  startVerification(
    request: StartVerificationRequest,
  ): Promise<IdentityOutcome<VerificationSession, 'UNSUPPORTED_DOCUMENT'>>;
  getStatus(sessionId: string): Promise<IdentityOutcome<VerificationStatus, 'UNKNOWN_SESSION'>>;
  /** Vérifie la signature et la fraîcheur d'un rappel (corps brut), puis le lit. */
  parseWebhook(
    body: string,
    signature: string | undefined,
    receivedAt: Date,
  ): IdentityWebhookVerdict;
}
