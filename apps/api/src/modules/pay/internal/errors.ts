/**
 * Erreurs normalisées du port `PaymentProvider` (17 §2.8 « Erreurs normalisées » ; 16 fiche
 * PAY-019 pour `IDEMPOTENCY_CONFLICT`). Un adaptateur traduit TOUTE erreur de son PSP dans l'un de
 * ces codes ; aucun code métier ne voit une erreur propre à un fournisseur.
 *
 * - `UNKNOWN_OUTCOME` : délai dépassé, 5xx ou réponse illisible. L'opération reste `UNKNOWN` et
 *   sera levée par `getOperation`, **jamais** renvoyée avec une nouvelle clé (08 E4, EC-29).
 * - `PROVIDER_UNAVAILABLE` : la requête n'a pas atteint le PSP (connexion refusée) : rien n'est
 *   fait, le rejeu garde la même clé.
 * - `DECLINED` : refus **reçu**, aucun fonds débité ; `doNotRetry` pour un refus définitif (carte
 *   volée, compte fermé : aucune relance, 08 E4 et T68).
 * - `INVALID_REQUEST`, `FAKE_FORBIDDEN_IN_PRODUCTION` : PROPOSÉS par US-019 (ADR-056).
 */

export const PAYMENT_ERROR_CODES = [
  'DECLINED',
  'AUTHENTICATION_REQUIRED',
  'INSUFFICIENT_FUNDS',
  'UNSUPPORTED_CAPABILITY',
  'DUPLICATE_KEY',
  'PROVIDER_UNAVAILABLE',
  'LEG_SUM_MISMATCH',
  'LEG_AMOUNT_NEGATIVE',
  'LEG_ALREADY_RELEASED',
  'UNKNOWN_OUTCOME',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_REQUEST',
  'FAKE_FORBIDDEN_IN_PRODUCTION',
] as const;
export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];

export interface PaymentErrorDetails {
  /** Code de refus du réseau ou du PSP (`DECLINED`), sans donnée de carte. */
  readonly declineCode?: string;
  /** Refus définitif : aucune nouvelle tentative (08 E4, T68). */
  readonly doNotRetry?: boolean;
  /** Capacité manquante (`UNSUPPORTED_CAPABILITY`). */
  readonly capability?: string;
}

export class PaymentError extends Error {
  override readonly name = 'PaymentError';
  readonly code: PaymentErrorCode;
  readonly details: PaymentErrorDetails;

  constructor(code: PaymentErrorCode, message: string, details: PaymentErrorDetails = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function isPaymentError(error: unknown, code?: PaymentErrorCode): error is PaymentError {
  return error instanceof PaymentError && (code === undefined || error.code === code);
}
