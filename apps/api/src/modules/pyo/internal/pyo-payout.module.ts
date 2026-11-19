/**
 * Module Nest du compte de versement de l'hôte (US-707, ADR-180 : routes
 * /host/accounts/{orgId}/payout-account). Module DYNAMIQUE, importé par le seul processus API
 * (`api.module.ts`), après `IamAuthModule` (il utilise `SessionGuard`).
 *
 * Adaptateurs choisis par l'appelant :
 * - production : `postgresPyoAdapters(pool)` (aucun coffre ni prestataire avant le lot C : l'état
 *   reste lisible, l'enregistrement rend 503) ;
 * - tests : FAKE du magasin, du coffre et du PSP (`../testing/`, absents de la compilation de
 *   production).
 * Sans options : magasin indisponible, ni coffre ni prestataire (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { PayoutAccountController } from './payout-account.controller.js';
import { UnavailablePayoutAccountStore } from './payout-account-store.js';
import { PayoutAccountService } from './payout-account.service.js';
import type { PayoutAccountDeps } from './payout-account.service.js';
import { PYO_PAYOUT_ACCOUNT_SERVICE } from './tokens.js';

export type PyoPayoutOptions = PayoutAccountDeps;

const consoleLogger: PayoutAccountDeps['log'] = {
  warn: (message, fields) => {
    console.warn(JSON.stringify({ level: 'warn', module: 'PYO', message, ...fields }));
  },
};

/** Options fail-closed : aucun magasin, aucun coffre, aucun prestataire. */
export function unavailablePyoOptions(): PyoPayoutOptions {
  return {
    store: new UnavailablePayoutAccountStore(),
    vault: null,
    verifier: null,
    log: consoleLogger,
  };
}

@Module({})
export class PyoPayoutModule {
  static register(options: PyoPayoutOptions = unavailablePyoOptions()): DynamicModule {
    return {
      module: PyoPayoutModule,
      controllers: [PayoutAccountController],
      providers: [
        { provide: PYO_PAYOUT_ACCOUNT_SERVICE, useValue: new PayoutAccountService(options) },
      ],
    };
  }
}

export { consoleLogger as pyoConsoleLogger };
