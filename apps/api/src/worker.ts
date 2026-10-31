/**
 * Point d'entrée « travailleur » : files et minuteries pg-boss (ADR-011, 17 §6.1).
 * Même image que l'API (main.ts), processus distinct, sans serveur HTTP.
 *
 * EMPLACEMENT : pg-boss n'est pas encore branché (story ultérieure, après US-005).
 * Le branchement se fera ici : création du client pg-boss sur la connexion `app_worker`,
 * enregistrement des gestionnaires exposés par les modules (via leur index.ts),
 * arrêt propre sur SIGTERM.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  // TODO(pg-boss) : démarrer la file ici. En attendant, le processus s'initialise puis s'arrête.
  await app.close();
}

void bootstrap();
