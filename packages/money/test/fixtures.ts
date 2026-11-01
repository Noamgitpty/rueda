/**
 * Configuration de devises de TEST (fixture) : USD = 2, PYG = 0 (ISO 4217 ; 17 §1.2, table
 * `config.currency`). Le code de production ne contient aucune de ces valeurs (ADR-024).
 */
import {
  createCurrencyRegistry,
  isMoneyError,
  type Currency,
  type MoneyErrorCode,
} from '../src/index.ts';

/** Code de la `MoneyError` levée par `fn`, ou `undefined` si `fn` ne lève rien. */
export function errorCodeOf(fn: () => unknown): MoneyErrorCode | undefined {
  try {
    fn();
  } catch (error) {
    if (isMoneyError(error)) return error.code;
    throw error;
  }
  return undefined;
}

export const registry = createCurrencyRegistry([
  { code: 'USD', exponent: 2 },
  { code: 'PYG', exponent: 0 },
]);

export const USD: Currency = registry.get('USD');
export const PYG: Currency = registry.get('PYG');

/** Variantes pays de premier rang (CLAUDE.md contrainte 3) : PA en USD, PY en PYG. */
export const COUNTRY_VARIANTS: readonly {
  readonly country: string;
  readonly currency: Currency;
}[] = [
  { country: 'PA', currency: USD },
  { country: 'PY', currency: PYG },
];
