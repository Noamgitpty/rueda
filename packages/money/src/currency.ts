/**
 * Devises : l'exposant vient de la configuration (table `config.currency`, 17 §1.2 et §3.2), jamais
 * d'une constante par pays (ADR-024, ADR-033). Ce module ne contient aucun code de devise.
 */
import { MoneyError } from './errors.ts';

/** Ligne de configuration d'une devise, telle que lue dans `config.currency (code, exponent)`. */
export interface CurrencyDefinition {
  /** Code ISO 4217 alphabétique (trois lettres majuscules). */
  readonly code: string;
  /** Nombre de décimales de l'unité mineure (ISO 4217) : entier de 0 à `MAX_CURRENCY_EXPONENT`. */
  readonly exponent: number;
}

declare const currencyBrand: unique symbol;

/**
 * Devise validée, obtenue uniquement par un `CurrencyRegistry` : la marque de type empêche d'en
 * fabriquer une à la main, et `assertCurrency` le vérifie aussi à l'exécution.
 */
export interface Currency {
  readonly code: string;
  readonly exponent: number;
  readonly [currencyBrand]: true;
}

/** Devises issues d'un registre (vérification à l'exécution, sans fuite mémoire). */
const REGISTERED = new WeakSet<object>();

/** Refuse (`CURRENCY_UNSUPPORTED`) toute valeur qui n'est pas une devise issue d'un registre. */
export function assertCurrency(value: unknown): asserts value is Currency {
  if (typeof value !== 'object' || value === null || !REGISTERED.has(value)) {
    throw new MoneyError('CURRENCY_UNSUPPORTED', 'devise non issue de la configuration');
  }
}

/**
 * Borne technique de l'exposant : 10^18 tient encore dans un int64. ISO 4217 n'utilise que 0 à 4 ;
 * la borne n'est pas une règle métier, elle garantit seulement que l'échelle reste représentable.
 */
export const MAX_CURRENCY_EXPONENT = 18;

const ISO_CODE = /^[A-Z]{3}$/;

/** Registre immuable des devises configurées. */
export interface CurrencyRegistry {
  /** Devise configurée ; sinon `CURRENCY_UNSUPPORTED`. */
  get(code: string): Currency;
  has(code: string): boolean;
  /** Codes configurés, dans l'ordre de la configuration. */
  codes(): readonly string[];
}

/**
 * Construit le registre à partir de la configuration. Refuse (`CURRENCY_CONFIG_INVALID`) un code
 * non ISO, un exposant non entier ou hors bornes, un doublon.
 */
export function createCurrencyRegistry(
  definitions: readonly CurrencyDefinition[],
): CurrencyRegistry {
  const byCode = new Map<string, Currency>();
  for (const definition of definitions) {
    const { code, exponent } = definition;
    if (typeof code !== 'string' || !ISO_CODE.test(code)) {
      throw new MoneyError('CURRENCY_CONFIG_INVALID', `code de devise invalide : ${String(code)}`);
    }
    if (!Number.isSafeInteger(exponent) || exponent < 0 || exponent > MAX_CURRENCY_EXPONENT) {
      throw new MoneyError(
        'CURRENCY_CONFIG_INVALID',
        `exposant invalide pour ${code} : ${String(exponent)}`,
      );
    }
    if (byCode.has(code)) {
      throw new MoneyError('CURRENCY_CONFIG_INVALID', `devise en double : ${code}`);
    }
    const currency = Object.freeze({ code, exponent }) as Currency;
    REGISTERED.add(currency);
    byCode.set(code, currency);
  }
  const codes = Object.freeze([...byCode.keys()]);
  return Object.freeze({
    get(code: string): Currency {
      const currency = byCode.get(code);
      if (currency === undefined) {
        throw new MoneyError('CURRENCY_UNSUPPORTED', `devise non configurée : ${String(code)}`);
      }
      return currency;
    },
    has(code: string): boolean {
      return byCode.has(code);
    },
    codes(): readonly string[] {
      return codes;
    },
  });
}
