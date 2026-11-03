/**
 * Adaptateurs de PRODUCTION du module PAY (17 §6.5 points 2 et 3 ; C19 ; ADR-032).
 *
 * - **Registre des PSP : vide jusqu'au lot C.** Aucun connecteur réel n'existe avant le choix du
 *   pays (DEC-FONDATEUR-03) et le FAKE n'est jamais compilé dans l'image de production
 *   (`tsconfig.build.json` exclut `testing/` ; `@rueda/fake-adapters` est une dépendance de
 *   développement). Un webhook posté sur `/webhooks/FAKE/…` en production répond donc 404 sans
 *   toucher la base. Aucune option ne permet d'y injecter un autre registre.
 * - **Secrets de webhook : aucun coffre avant US-003.** Le résolveur rend `null` (503 sans
 *   écriture) : fail-closed.
 * - `assertPaymentStartup` refuse de démarrer si un compte PSP FAKE existe en base de production,
 *   ou si une variable `*_ADAPTER=FAKE` est posée en production.
 */
import type { WebhookVerifier } from './port.js';
import { PgWebhookInboxStore } from './pg-stores.js';
import type { SqlExecutor } from './pg-stores.js';
import { assertPaymentStartup } from './startup-guard.js';
import type { PaymentStartupState } from './startup-guard.js';
import type { PayWebhookOptions } from './pay-webhook.module.js';
import type {
  PaymentLogger,
  WebhookSecretResolver,
  WebhookVerifierRegistry,
} from './webhook-ingest.js';

/** Fournisseurs compilés dans l'image de production (lot C : connecteurs réels seulement). */
export const PRODUCTION_PROVIDERS: readonly string[] = [];

// aucun connecteur réel avant le lot C : tout fournisseur est inconnu (404 sans écriture)
const productionRegistry: WebhookVerifierRegistry = {
  get: (): WebhookVerifier | undefined => undefined,
};

const noVault: WebhookSecretResolver = {
  resolve: () => Promise.resolve(null),
};

const consoleLogger: PaymentLogger = {
  warn: (message, fields) => {
    console.warn(JSON.stringify({ level: 'warn', module: 'PAY', message, ...fields }));
  },
};

export interface PostgresPayAdapters {
  readonly webhooks: PayWebhookOptions;
  readonly startup: PaymentStartupState;
}

/** Contrôle de démarrage puis adaptateurs de production (connexion `app_api`). */
export async function postgresPayAdapters(
  db: SqlExecutor,
  env: Readonly<Record<string, string | undefined>>,
): Promise<PostgresPayAdapters> {
  const startup = await assertPaymentStartup({ env, db });
  return {
    startup,
    webhooks: {
      registry: productionRegistry,
      store: new PgWebhookInboxStore(db),
      secrets: noVault,
      log: consoleLogger,
    },
  };
}
