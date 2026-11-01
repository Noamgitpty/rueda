/**
 * Codes d'erreur stables du paquet monétaire (16 A.8, CONTRIBUTING §11) : SCREAMING_SNAKE_CASE,
 * sans préfixe. Un code publié ne change plus.
 *
 * - `MONEY_CURRENCY_MISMATCH`, `CURRENCY_UNSUPPORTED` : 16, fiche PRC-021 (référence).
 * - Les autres codes sont des noms de référence PROPOSÉS par US-015 (à reporter au catalogue 16 A.8).
 */
export const MONEY_ERROR_CODES = [
  /** Opération entre deux devises différentes (16 PRC-021). */
  'MONEY_CURRENCY_MISMATCH',
  /** Devise absente de la configuration (16 PRC-021). */
  'CURRENCY_UNSUPPORTED',
  /** PROPOSÉ : configuration de devise invalide (code non ISO, exposant invalide, doublon). */
  'CURRENCY_CONFIG_INVALID',
  /** PROPOSÉ : montant qui n'est pas un entier exact (number flottant, chaîne mal formée, trop de décimales). */
  'MONEY_INVALID_AMOUNT',
  /** PROPOSÉ : montant hors de l'intervalle de la colonne PostgreSQL `bigint` (int64). */
  'MONEY_OUT_OF_RANGE',
  /** PROPOSÉ : montant d'écriture nul ou négatif (08 E4, 17 §3.1.5 : strictement positif). */
  'MONEY_NOT_POSITIVE',
  /** PROPOSÉ : fraction invalide (dénominateur nul, composant non entier, chaîne mal formée). */
  'RATIO_INVALID',
  /** PROPOSÉ : part d'un partage hôte / plateforme hors de [0 ; 1]. */
  'SHARE_OUT_OF_RANGE',
] as const;

export type MoneyErrorCode = (typeof MONEY_ERROR_CODES)[number];

/** Erreur du paquet monétaire. `code` est stable ; `message` est technique (jamais montré au guest). */
export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/** Vrai si `error` est une `MoneyError` portant `code` (aide pour les appelants). */
export function isMoneyError(error: unknown, code?: MoneyErrorCode): error is MoneyError {
  return error instanceof MoneyError && (code === undefined || error.code === code);
}
