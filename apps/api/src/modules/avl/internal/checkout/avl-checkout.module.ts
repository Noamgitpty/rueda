/**
 * Module Nest du checkout (US-208, ADR-133). Module DYNAMIQUE, importé par le seul processus API
 * (`api.module.ts`), après `IamAuthModule` (SessionGuard) et `CtrLegalModule` (TermsGuard).
 *
 * Adaptateurs choisis par l'appelant : production `postgresCheckoutAdapters(db, paramsOf)`
 * (fonctions de 0108 et commande de gel de PRC sous app_api ; instantané de configuration du devis
 * de l'instance `QuoteService` de `main.ts`, le même que la recherche et la fiche) ; tests : FAKE.
 * Sans options : 503 partout (fail-closed).
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { PgQuoteStore, UnavailableQuoteStore } from '../../../prc/index.js';
import type { QuoteParamsOf, QuoteStore } from '../../../prc/index.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService } from './checkout.service.js';
import { PgCheckoutStore, UnavailableCheckoutStore } from './store.js';
import type { CheckoutStore, SqlExecutor } from './store.js';

export interface AvlCheckoutOptions {
  /** Instantané des paramètres du devis (PRC, CFG) à l'instant du devis. */
  readonly paramsOf: QuoteParamsOf;
  /** Devis figés (commande de gel de PRC). */
  readonly quotes: QuoteStore;
  readonly store: CheckoutStore;
}

/** Aucun adaptateur : 503 partout (fail-closed). */
export const UNAVAILABLE_AVL_CHECKOUT: AvlCheckoutOptions = {
  paramsOf: () => {
    throw new Error('configuration du devis indisponible');
  },
  quotes: new UnavailableQuoteStore(),
  store: new UnavailableCheckoutStore(),
};

/** Production : commandes de 0100 / 0102 / 0108 sous app_api. */
export function postgresCheckoutAdapters(
  db: SqlExecutor,
  paramsOf: QuoteParamsOf,
): AvlCheckoutOptions {
  return { paramsOf, quotes: new PgQuoteStore(db), store: new PgCheckoutStore(db) };
}

@Module({})
export class AvlCheckoutModule {
  static register(options: AvlCheckoutOptions = UNAVAILABLE_AVL_CHECKOUT): DynamicModule {
    return {
      module: AvlCheckoutModule,
      controllers: [CheckoutController],
      providers: [
        {
          provide: CheckoutService,
          useValue: new CheckoutService(options.paramsOf, options.quotes, options.store),
        },
      ],
    };
  }
}
