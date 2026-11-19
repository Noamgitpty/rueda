// Point d'entrée public du module PYO. Les autres modules n'importent que ce fichier ;
// tout le reste (internal/, pyo.module.ts) est privé (règle rueda/module-boundaries).
// Les adaptateurs FAKE (testing/) ne sont JAMAIS exportés ici (C19).
export { PyoModule } from './pyo.module.js';

// Compte de versement de l'hôte (US-707, ADR-180)
export { PyoPayoutModule, unavailablePyoOptions } from './internal/pyo-payout.module.js';
export type { PyoPayoutOptions } from './internal/pyo-payout.module.js';
export { postgresPyoAdapters } from './internal/production.js';
export { PgPayoutAccountStore } from './internal/pg-payout-account-store.js';
export type { PyoSqlExecutor } from './internal/pg-payout-account-store.js';
export { UnavailablePayoutAccountStore } from './internal/payout-account-store.js';
export type {
  PayoutAccountSnapshot,
  PayoutAccountStore,
  PayoutRail,
} from './internal/payout-account-store.js';
export { PayoutAccountService } from './internal/payout-account.service.js';
export type { PayoutAccountDeps, PayoutAccountView } from './internal/payout-account.service.js';
export type { PayoutAccountVault } from './internal/payout-account-vault.port.js';
export type {
  PayoutAccountVerification,
  PayoutAccountVerifier,
  VerifyPayoutAccountRequest,
} from './internal/payout-account-verifier.port.js';
export { PYO_MESSAGES, PyoHttpError } from './internal/errors.js';
