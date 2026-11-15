/**
 * Erreurs du moteur de devis (US-202 ; 16 fiches PRC-025 et PRC-020, A.8).
 *
 * - `QUOTE_UNAVAILABLE` (16 PRC-025) : paramètre du pays manquant ou invalide, durée hors des
 *   bornes, part requise absente : aucun devis, la voiture n'est pas réservable.
 * - `TAX_CONFIG_MISSING` (16 PRC-020) : ligne sans règle fiscale, règle incohérente.
 * - `LEG_AMOUNT_NEGATIVE` (16 PRC-025, 08 E7 règle 5) : une jambe du devis serait négative.
 * - `QUOTE_INPUT_INVALID` (PROPOSÉ) : entrée mal formée (instant, montant, devise, ligne inconnue).
 * - `QUOTE_REPLAY_MISMATCH` (PROPOSÉ) : un devis figé rejoué ne redonne pas exactement ses lignes,
 *   ses taxes, son total et ses jambes (17 §2.6, NFR-17), ou son empreinte ne correspond plus.
 *
 * Aucun de ces codes n'est encore exposé par une route : leurs textes es / en / fr / pt-BR
 * arrivent avec la route du devis (passation US-202).
 */
export const QUOTE_ERROR_CODES = [
  'QUOTE_UNAVAILABLE',
  'TAX_CONFIG_MISSING',
  'LEG_AMOUNT_NEGATIVE',
  'QUOTE_INPUT_INVALID',
  'QUOTE_REPLAY_MISMATCH',
] as const;
export type QuoteErrorCode = (typeof QUOTE_ERROR_CODES)[number];

export class QuoteError extends Error {
  override readonly name = 'QuoteError';

  constructor(
    readonly code: QuoteErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(`${code} : ${message}`, options);
  }
}

export function isQuoteError(value: unknown): value is QuoteError {
  return value instanceof QuoteError;
}
