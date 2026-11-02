import type { LocaleProfile } from './locale-profile.ts';
import { joinDecimal } from './number-format.ts';
import { fillPattern } from './pattern.ts';

/**
 * Interface **minimale** d'un montant à afficher. Ce n'est pas le type `Money` (US-015) : tout
 * objet qui porte ces trois champs s'affiche, sans dépendance vers le moteur monétaire.
 *
 * - `amountMinor` : unités mineures en `bigint` (cents pour USD, guaraníes pour PYG) ;
 * - `currency` : code ISO 4217 ;
 * - `exponent` : exposant de la devise lu dans `config.currency` (USD = 2, PYG = 0, 17 §1.2).
 */
export interface MinorUnitAmount {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly exponent: number;
}

/** Exposant maximal accepté (ISO 4217 n'en connaît pas au-delà de 4). */
const MAX_EXPONENT = 4;

/**
 * Adaptateur d'**affichage seulement** : reçoit des unités mineures et produit une chaîne.
 * Aucun calcul (ni division, ni arrondi, ni conversion) : les chiffres du `bigint` sont
 * découpés tels quels à la position de l'exposant. PYG (exposant 0) n'a donc jamais de décimale.
 */
export function formatMoney(amount: MinorUnitAmount, profile: LocaleProfile): string {
  const { amountMinor, currency, exponent } = amount;
  if (typeof amountMinor !== 'bigint') {
    throw new TypeError('amountMinor doit être un bigint (unités mineures, jamais un flottant).');
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new RangeError(`Code de devise ISO 4217 attendu, reçu « ${currency} ».`);
  }
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > MAX_EXPONENT) {
    throw new RangeError(`Exposant de devise invalide : ${String(exponent)}.`);
  }
  const raw = amountMinor.toString();
  const negative = raw.startsWith('-');
  const digits = (negative ? raw.slice(1) : raw).padStart(exponent + 1, '0');
  const cut = digits.length - exponent;
  const body = joinDecimal(digits.slice(0, cut), digits.slice(cut), profile.number);
  const symbol = profile.currency.symbols[currency] ?? currency;
  const pattern = negative ? profile.currency.negativePattern : profile.currency.pattern;
  return fillPattern(pattern, { symbol, amount: body });
}
