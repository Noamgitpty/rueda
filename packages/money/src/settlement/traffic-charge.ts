/**
 * Jambes d'une amende, d'un péage ou d'une fourrière refacturés au voyageur (08 BR-TT-02 à 04,
 * BR-PRICE-15 [NOUS], BR-REIMB-04 ; US-318, ADR-198). Fonction pure, versionnée
 * (`TRAFFIC_CHARGE_RULE_VERSION`), référence de la règle : en production, les jambes sont
 * calculées par sa jumelle SQL `core.claim_traffic_charge_legs` (0178), qui écrit la refacturation
 * et le débit séparé ; cette fonction n'est appelée que par les tests, qui prouvent la parité des
 * deux avec l'oracle `rhu` de docs/specs/tools (revue code n° 5).
 *
 * - `HOST` = montant payé par l'hôte (100 % reversés à l'hôte, BR-REIMB-04) ;
 * - `PLATFORM` = frais de gestion = roundHalfUp(montant × bps / 10 000) (paramètre du pays
 *   `traffic_charge_admin_fee_bps`, à la charge du voyageur, taxes de la plateforme comprises) ;
 * - `INSURER` = `TAX_THIRD_PARTY` = 0.
 * Montant explicite de chaque jambe, jamais un prorata ; Σ jambes = total = montant + frais.
 */
import type { Currency } from '../currency.ts';
import { add, money, type Money } from '../money.ts';
import { ratio } from '../ratio.ts';
import { roundHalfUp } from '../rounding.ts';
import { SettlementError } from './errors.ts';
import type { Legs } from './types.ts';

/** Version de la règle ; citée par ADR-198 et par la fonction SQL jumelle. */
export const TRAFFIC_CHARGE_RULE_VERSION = 'BR-TT-US318';

/**
 * Jambes de la refacturation de `amount` (> 0) avec des frais de `feeBps` points de base
 * (entier dans [0 ; 10 000]). Refus (`SETTLEMENT_INPUT_INVALID`) : devise différente, montant nul
 * ou négatif, frais hors bornes.
 */
export function trafficChargeLegs(currency: Currency, amount: Money, feeBps: number): Legs {
  if (amount.currency !== currency.code) {
    throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'devise de la refacturation différente');
  }
  if (amount.amountMinor <= 0n) {
    throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'montant refacturé nul ou négatif');
  }
  if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new SettlementError('SETTLEMENT_INPUT_INVALID', 'frais de gestion hors de [0 ; 10 000]');
  }
  const fee = money(roundHalfUp(ratio(amount.amountMinor * BigInt(feeBps), 10_000n)), currency);
  const zero = money(0n, currency);
  return Object.freeze({
    HOST: amount,
    INSURER: zero,
    TAX_THIRD_PARTY: zero,
    PLATFORM: fee,
    total: add(amount, fee),
  });
}
