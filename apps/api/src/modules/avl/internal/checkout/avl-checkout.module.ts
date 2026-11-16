/**
 * Module Nest du checkout (US-208, ADR-133). Module DYNAMIQUE, importé par le seul processus API
 * (`api.module.ts`), après `IamAuthModule` (SessionGuard) et `CtrLegalModule` (TermsGuard).
 *
 * Adaptateurs choisis par l'appelant : production `postgresCheckoutAdapters(db, paramsOf)`
 * (fonctions de 0108 et commande de gel de PRC sous app_api ; instantané de configuration du devis
 * de l'instance `QuoteService` de `main.ts`, le même que la recherche et la fiche) ; tests : FAKE.
 * Sans options : 503 partout (fail-closed).
 *
 * Paiement du hold (US-223 partie 223b, ADR-142) : magasin des commandes de 0116 et connecteurs
 * des PSP servis par l'image, par fournisseur. Production : AUCUN connecteur jusqu'au lot C (le FAKE
 * n'est jamais compilé dans l'image, C19) ⇒ `PAYMENT_UNAVAILABLE` sans toucher au hold ; tests :
 * l'adaptateur FAKE de `pay/testing/`.
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { PgQuoteStore, UnavailableQuoteStore } from '../../../prc/index.js';
import type { QuoteParamsOf, QuoteStore } from '../../../prc/index.js';
import { CheckoutController } from './checkout.controller.js';
import { CheckoutService, LOG_CHECKOUT_FAILURE } from './checkout.service.js';
import type { CancellationParamsOf } from './checkout.service.js';
import { PgCheckoutStore, UnavailableCheckoutStore } from './store.js';
import type { CheckoutStore, SqlExecutor } from './store.js';
import { CheckoutPaymentController } from './payment.controller.js';
import { CheckoutPaymentService, LOG_PAYMENT_FAILURE } from './payment.service.js';
import type { HostedPaymentProvider } from './payment.service.js';
import { PgCheckoutPaymentStore, UnavailableCheckoutPaymentStore } from './payment-store.js';
import type { CheckoutPaymentStore } from './payment-store.js';

/** Paiement du hold du checkout (US-223b) : commandes de 0116 et connecteurs servis. */
export interface AvlCheckoutPaymentOptions {
  readonly store: CheckoutPaymentStore;
  /** Connecteurs par fournisseur (`payment_psp_account.provider`) ; vide : aucun paiement. */
  readonly providers: ReadonlyMap<string, HostedPaymentProvider>;
}

/** Aucun connecteur, aucun magasin : 503 (fail-closed). */
export const UNAVAILABLE_CHECKOUT_PAYMENTS: AvlCheckoutPaymentOptions = {
  store: new UnavailableCheckoutPaymentStore(),
  providers: new Map(),
};

export interface AvlCheckoutOptions {
  /** Instantané des paramètres du devis (PRC, CFG) à l'instant du devis. */
  readonly paramsOf: QuoteParamsOf;
  /** Devis figés (commande de gel de PRC). */
  readonly quotes: QuoteStore;
  readonly store: CheckoutStore;
  /**
   * Paramètres d'annulation du pays (PRC, CFG ; US-205b) : retenue hors fenêtre gratuite affichée
   * sur S05. Absents : aucune retenue affichée (renvoi à la politique publiée).
   */
  readonly cancellationParamsOf?: CancellationParamsOf;
  /** Paiement du hold (US-223b) ; absent : 503 (aucun paiement). */
  readonly payments?: AvlCheckoutPaymentOptions;
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
  cancellationParamsOf?: CancellationParamsOf,
): AvlCheckoutOptions {
  return {
    paramsOf,
    quotes: new PgQuoteStore(db),
    store: new PgCheckoutStore(db),
    ...(cancellationParamsOf === undefined ? {} : { cancellationParamsOf }),
    // aucun connecteur de PSP en production avant le lot C (PRODUCTION_PROVIDERS vide)
    payments: { store: new PgCheckoutPaymentStore(db), providers: new Map() },
  };
}

@Module({})
export class AvlCheckoutModule {
  static register(options: AvlCheckoutOptions = UNAVAILABLE_AVL_CHECKOUT): DynamicModule {
    return {
      module: AvlCheckoutModule,
      controllers: [CheckoutController, CheckoutPaymentController],
      providers: [
        {
          provide: CheckoutService,
          useValue: new CheckoutService(
            options.paramsOf,
            options.quotes,
            options.store,
            LOG_CHECKOUT_FAILURE,
            options.cancellationParamsOf,
          ),
        },
        {
          provide: CheckoutPaymentService,
          useValue: new CheckoutPaymentService(
            (options.payments ?? UNAVAILABLE_CHECKOUT_PAYMENTS).store,
            (options.payments ?? UNAVAILABLE_CHECKOUT_PAYMENTS).providers,
            LOG_PAYMENT_FAILURE,
          ),
        },
      ],
    };
  }
}
