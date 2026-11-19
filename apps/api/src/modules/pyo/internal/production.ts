/**
 * Adaptateurs de PRODUCTION du compte de versement (US-707, ADR-180 ; ADR-007 ; C19).
 *
 * - Magasin : commandes `core.payout_*` de 0159 sous `app_api` (l'état reste lisible).
 * - **Aucun coffre de clés (KMS) ni prestataire de vérification avant le lot C** : le FAKE n'est
 *   jamais compilé dans l'image de production (`tsconfig.build.json` exclut `testing/`) ;
 *   l'enregistrement rend 503 `PAYOUT_VAULT_UNAVAILABLE` sans rien écrire. Aucun versement réel :
 *   `payouts_enabled[pays]` reste `false` (17 §0.1), aucun interrupteur n'est touché.
 */
import { pyoConsoleLogger } from './pyo-payout.module.js';
import type { PyoPayoutOptions } from './pyo-payout.module.js';
import { PgPayoutAccountStore } from './pg-payout-account-store.js';
import type { PyoSqlExecutor } from './pg-payout-account-store.js';

export function postgresPyoAdapters(db: PyoSqlExecutor): PyoPayoutOptions {
  return {
    store: new PgPayoutAccountStore(db),
    vault: null,
    verifier: null,
    log: pyoConsoleLogger,
  };
}
