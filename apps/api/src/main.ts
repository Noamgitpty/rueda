/**
 * Point d'entrée « API » (processus HTTP). Même image que le travailleur (worker.ts),
 * processus distinct (17 §6.1, §10 point 3).
 *
 * Connexion PostgreSQL : variables standard de libpq (`PGHOST`, `PGPORT`, `PGDATABASE`,
 * `PGUSER` = app_api, `PGPASSWORD` fourni par le gestionnaire de secrets ; docs/ops/ENV_VARS.md).
 * Le démarrage échoue si le rôle n'est pas app_api sans SUPERUSER ni BYPASSRLS (US-010).
 * `RUEDA_API_TRUST_PROXY` règle `trust proxy` (défaut : aucun mandataire, voir trust-proxy.ts).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import pg from 'pg';
import { ApiModule } from './api.module.js';
import { postgresIamAdapters } from './modules/iam/index.js';
import { parseTrustProxy } from './trust-proxy.js';

const DEFAULT_PORT = 3000;

async function bootstrap(): Promise<void> {
  const trustProxy = parseTrustProxy(process.env['RUEDA_API_TRUST_PROXY']);
  const pool = new pg.Pool({ application_name: 'rueda-api' });
  const iam = await postgresIamAdapters(pool);
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.register(iam));
  app.set('trust proxy', trustProxy);
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? DEFAULT_PORT);
  await app.listen(port);
}

void bootstrap();
