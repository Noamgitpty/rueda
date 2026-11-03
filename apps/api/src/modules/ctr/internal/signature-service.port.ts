/**
 * Port `SignatureService` du module CTR (17 §2.7, §5 « Signature électronique », §10 ; ADR-017 ;
 * US-020, ADR-058).
 *
 * Signature électronique simple : clic après authentification et OTP récent (17 §2.7 : ≤ 10 min,
 * contrôlé par CTR et par le service) ; le service enregistre l'empreinte SHA-256 (hexadécimal
 * minuscule) du PDF exact présenté, le signataire, l'heure, la référence OTP et le contexte, et
 * rend l'empreinte du PDF re-scellé avec le bloc de signature. Les deux empreintes sont conservées.
 * `TIMEOUT` = issue inconnue : rejouer la même clé (sinon deux signatures).
 *
 * Adaptateurs : FAKE `@rueda/fake-adapters/signature` ; implémentation interne (ADR-017) à venir ;
 * prestataire tiers optionnel, non évalué.
 */
export type SignatureOutcome<T, R extends string> =
  | { readonly status: 'OK'; readonly value: T; readonly replayed: boolean }
  | { readonly status: 'REFUSED'; readonly reason: R | 'IDEMPOTENCY_CONFLICT' | 'UNSUPPORTED' }
  | { readonly status: 'UNAVAILABLE' }
  | { readonly status: 'TIMEOUT' };

export interface SignRequest {
  readonly idempotencyKey: string;
  readonly documentSha256: string;
  readonly signerRef: string;
  readonly otpRef: string;
  readonly otpVerifiedAt: Date;
  readonly ip: string;
  readonly userAgent: string;
  readonly context: string;
}

export interface SignatureRecord {
  readonly signatureId: string;
  readonly documentSha256: string;
  readonly signedDocumentSha256: string;
  readonly signerRef: string;
  readonly otpRef: string;
  readonly signedAt: Date;
}

export interface SignatureCheckResult {
  readonly valid: boolean;
  readonly record: SignatureRecord;
}

export interface SignatureService {
  sign(
    request: SignRequest,
  ): Promise<SignatureOutcome<SignatureRecord, 'INVALID_DOCUMENT_HASH' | 'OTP_TOO_OLD'>>;
  verify(
    signatureId: string,
    sha256: string,
  ): Promise<SignatureOutcome<SignatureCheckResult, 'UNKNOWN_SIGNATURE'>>;
}
