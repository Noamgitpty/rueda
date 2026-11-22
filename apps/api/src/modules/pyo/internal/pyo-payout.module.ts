/**
 * Module Nest du compte de versement de l'hôte (US-707, ADR-180 : routes
 * /host/accounts/{orgId}/payout-account) et des versements lus par le titulaire (US-314, ADR-192 :
 * route /host/accounts/{orgId}/payouts, écran A08). Module DYNAMIQUE, importé par le seul processus API
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
import { HostPayoutsController } from './host-payouts.controller.js';
import { HostPayoutsService, UnavailableHostPayoutsStore } from './host-payouts.js';
import type { HostPayoutsStore } from './host-payouts.js';
import { PayoutAccountController } from './payout-account.controller.js';
import { UnavailablePayoutAccountStore } from './payout-account-store.js';
import { PayoutAccountService } from './payout-account.service.js';
import type { PayoutAccountDeps } from './payout-account.service.js';
import { PYO_PAYOUT_ACCOUNT_SERVICE } from './tokens.js';

export type PyoPayoutOptions = PayoutAccountDeps & {
  /** Versements lus par le titulaire (US-314, A08) ; absent ⇒ 503 (fail-closed). */
  readonly payouts?: HostPayoutsStore;
};

const consoleLogger: PayoutAccountDeps['log'] = {
  warn: (message, fields) => {
    console.warn(JSON.stringify({ level: 'warn', module: 'PYO', message, ...fields }));
  },
};

/** Options fail-closed : aucun magasin, aucun coffre, aucun prestataire. */
export function unavailablePyoOptions(): PyoPayoutOptions {
  return {
    store: new UnavailablePayoutAccountStore(),
    payouts: new UnavailableHostPayoutsStore(),
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
      controllers: [PayoutAccountController, HostPayoutsController],
      providers: [
        { provide: PYO_PAYOUT_ACCOUNT_SERVICE, useValue: new PayoutAccountService(options) },
        {
          provide: HostPayoutsService,
          useValue: new HostPayoutsService(options.payouts ?? new UnavailableHostPayoutsStore()),
        },
      ],
    };
  }
}

export { consoleLogger as pyoConsoleLogger };
