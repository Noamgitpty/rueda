/**
 * Module Nest de la réception des webhooks PSP (17 §4.4), importé par le seul processus API
 * (`api.module.ts`, rôle `app_api`), jamais par le travailleur. Les adaptateurs sont choisis par
 * l'appelant :
 * - production : `postgresPayAdapters(pool, process.env)` (registre sans aucun FAKE, contrôle de
 *   démarrage C19) ; aucun interrupteur d'environnement ne peut y substituer un FAKE ;
 * - tests : registre FAKE de `../testing/`, absent de la compilation de production.
 */
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { WebhookInboxStore } from './stores.js';
import { PAY_WEBHOOK_INGEST } from './tokens.js';
import { WebhookController } from './webhook.controller.js';
import { WebhookIngestService } from './webhook-ingest.js';
import type {
  PaymentLogger,
  WebhookSecretResolver,
  WebhookVerifierRegistry,
} from './webhook-ingest.js';

export interface PayWebhookOptions {
  readonly registry: WebhookVerifierRegistry;
  readonly store: WebhookInboxStore;
  readonly secrets: WebhookSecretResolver;
  readonly log: PaymentLogger;
}

@Module({})
export class PayWebhookModule {
  static register(options: PayWebhookOptions): DynamicModule {
    return {
      module: PayWebhookModule,
      controllers: [WebhookController],
      providers: [
        {
          provide: PAY_WEBHOOK_INGEST,
          useValue: new WebhookIngestService(
            options.registry,
            options.store,
            options.secrets,
            options.log,
          ),
        },
      ],
    };
  }
}
