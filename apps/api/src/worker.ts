/**
 * Point d'entrée « travailleur » : relais de l'outbox, files de tâches, tâches périodiques et
 * métriques du module BUS (US-008, ADR-050 : file SQL sous RLS, pg-boss non retenu en Bêta).
 * Même image que l'API (main.ts), processus distinct, sans serveur HTTP.
 *
 * EMPLACEMENT : les boucles ne sont pas encore branchées (US-003 : pool de connexions `app_worker`
 * et secrets). Le branchement se fera ici, avec l'index public du module BUS :
 * `workerTransactions(pool)`, puis en boucle `OutboxRelay.runOnce()`, `JobRunner.runOnce(file)`
 * pour chaque file de `BusRegistry.queueNames()`, `PeriodicScheduler.tick()` (au démarrage puis
 * toutes les 5 s, PROPOSÉ) et `BusMetrics.collect()` ; arrêt propre sur SIGTERM.
 *
 * RÈGLE (revue architecture US-001 #10, à appliquer au câblage du travailleur par US-003 ;
 * le module BUS est livré par US-008) : les gestionnaires de tâches (relais de l'outbox, files,
 * minuteries) sont enregistrés **au travailleur seulement**, via un module réservé (par exemple
 * `WorkerModule` qui importe `AppModule` et ajoute les fournisseurs de tâches), avec la connexion
 * `app_worker`. Ils ne doivent jamais être instanciés par l'API (`main.ts`, rôle `app_api`).
 * En attendant, ce processus initialise le contexte puis s'arrête : un conteneur « worker »
 * démarré avant US-003 sort donc immédiatement, et c'est voulu.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  // TODO(US-003, ADR-050) : démarrer ici les boucles du module BUS (voir l'en-tête).
  await app.close();
}

void bootstrap();
