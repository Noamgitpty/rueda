/**
 * Caution annoncée AVANT le checkout (US-701 partie 701c, T70 c ; ADR-173 ; 08 BR-PAY-06 « Moment
 * de l'évaluation », « Fail-closed », « Montant unique » ; 10b UX-21 ; 16 SRC-011).
 *
 * Fiche S03 et cartes de la recherche (S01 / S02) : la MÊME décision que la porte du checkout
 * (`DepositCheckoutGate`, ADR-169), au stade `PRE_CHECKOUT` : seuls `COUNTRY` et `CLASS` (connus du
 * véhicule) sont évalués par `evaluateDepositTriggers`, avec leur fail-closed (paramètre absent ou
 * classe inconnue ⇒ vrai) ; le montant est `depositAmountFor(deposit_amount[pays], classe)`, comme
 * au checkout. `AGE` et `RISK` ne sont jamais évalués ici : leur inconnu n'est pas un « vrai ».
 *
 * Trois issues, rien d'autre (le visiteur ne voit jamais les déclencheurs ni la classe) :
 * - `GENERIC` : aucun déclencheur du véhicule ⇒ mention générique (« une caution peut être demandée
 *   selon le profil du conducteur ») ;
 * - `REQUIRED` : montant `deposit_amount[pays][classe]` ;
 * - `UNAVAILABLE` : un déclencheur du véhicule est vrai mais le montant manque (aujourd'hui LUXE,
 *   `TO_DECIDE`) ⇒ la porte du checkout refusera ce trip avant le paiement (`PARAM_MISSING`, T72 c),
 *   et la fiche le dit déjà (`web.deposit.unavailableNone`, le texte de S05). Jamais un montant
 *   inventé ni ramené à 0.
 */
import { valueClassOf } from './deposit-checkout.js';
import type { DepositConfigSource } from './deposit-checkout.js';
import { depositAmountFor, evaluateDepositTriggers } from './deposit-triggers.js';
import type { DepositValueClass } from './deposit-triggers.js';
import type { DepositRailConfig } from './pg-deposit-config.js';

export type PreCheckoutDeposit =
  | { readonly status: 'GENERIC' }
  | { readonly status: 'REQUIRED'; readonly amountMinor: bigint }
  | { readonly status: 'UNAVAILABLE' };

/** Décision pure avant le checkout (vecteurs T70 c, T73 ; oracle `check_t49plus.py`). */
export function preCheckoutDeposit(
  config: Pick<DepositRailConfig, 'triggerParams' | 'amounts'>,
  valueClass: DepositValueClass | null,
): PreCheckoutDeposit {
  const triggers = evaluateDepositTriggers(config.triggerParams, { valueClass }, 'PRE_CHECKOUT');
  if (!triggers.required) return { status: 'GENERIC' };
  const amountMinor = depositAmountFor(config.amounts, valueClass);
  return amountMinor === null ? { status: 'UNAVAILABLE' } : { status: 'REQUIRED', amountMinor };
}

/**
 * Lecture pour la fiche et les cartes : paramètres du pays à l'heure de la base (lecteur du
 * checkout, `PgDepositRailConfigReader`, sous app_api), puis `preCheckoutDeposit`. Aucun compte
 * marchand n'est lu (les rails dépendent des dates et de la carte : ils restent au checkout).
 * `valueClass` est le texte lu en base ; hors vocabulaire ⇒ inconnue (fail-closed : `CLASS` vrai).
 */
export class PreCheckoutDepositReader {
  constructor(private readonly config: DepositConfigSource) {}

  async notice(country: string, valueClass: unknown): Promise<PreCheckoutDeposit> {
    // fournisseur vide : aucune portée PSP lue (aucun paramètre de déclencheur n'en a)
    const config = await this.config.read(country, '');
    return preCheckoutDeposit(config, valueClassOf(valueClass));
  }
}
