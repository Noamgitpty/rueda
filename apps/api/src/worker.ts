/**
 * Point d'entrée « travailleur » (US-003, ADR-078 ; US-008, ADR-050) : relais de l'outbox, files de
 * tâches, tâches périodiques et métriques du module BUS. Même image que l'API (main.ts), processus
 * distinct, sans serveur HTTP.
 *
 * Démarrage, dans l'ordre (tout échec ⇒ code de sortie 1, l'orchestrateur relance) :
 *   1. contexte Nest d'AppModule (contrôles de démarrage de CFG : `RUEDA_ENV`, données pays, tzdata) ;
 *   2. pool PostgreSQL (variables libpq, `PGUSER` = app_worker ; `PGPASSWORD` du coffre) et refus
 *      si le rôle n'est pas `app_worker` sans SUPERUSER ni BYPASSRLS (L0-05) ;
 *   3. `assertPaymentStartup` (C19) : comme l'API, refus d'un FAKE en production et d'une base
 *      discordante (revue code US-019, constat 7) ;
 *   4. tâches déclarées par `registerWorkerTasks` (worker-tasks.ts), au travailleur SEULEMENT
 *      (règle de la revue architecture US-001 #10 : jamais instanciées par l'API) ;
 *   5. boucle (worker-loop.ts) jusqu'à SIGTERM / SIGINT : fin du passage en cours, pool fermé, code 0.
 *
 * Variables (noms seulement, docs/ops/ENV_VARS.md) : `RUEDA_ENV`, `PG*`, `RUEDA_BRAND_NAME`,
 * `RUEDA_WORKER_POOL_MAX`.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import pg from 'pg';
import { AppModule } from './app.module.js';
import {
  BusMetrics,
  BusRegistry,
  JobRunner,
  LogAlerter,
  OutboxRelay,
  PeriodicScheduler,
  workerTransactions,
} from './modules/bus/index.js';
import type { LeasedSqlClient } from './modules/bus/index.js';
import { CountryConfigService } from './modules/cfg/index.js';
import { assertPaymentStartup } from './modules/pay/index.js';
import { errorLabel, WorkerLoop } from './worker-loop.js';
import { parseBrandName, parsePoolMax } from './worker-config.js';
import { registerWorkerTasks } from './worker-tasks.js';

async function assertWorkerRole(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{
    current_user: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
  }>(
    `SELECT current_user, r.rolsuper, r.rolbypassrls
       FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
  );
  const me = rows[0];
  if (me === undefined || me.current_user !== 'app_worker' || me.rolsuper || me.rolbypassrls) {
    throw new Error('le travailleur se connecte sous app_worker, sans SUPERUSER ni BYPASSRLS');
  }
}

const leased = (client: pg.PoolClient): LeasedSqlClient => ({
  query: async <R>(text: string, params?: readonly unknown[]) => {
    const r = await client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  },
  release: () => {
    client.release();
  },
});

async function bootstrap(): Promise<void> {
  const log = (line: string): void => {
    console.log(line);
  };
  const brandName = parseBrandName(process.env['RUEDA_BRAND_NAME']);
  const app = await NestFactory.createApplicationContext(AppModule);
  const pool = new pg.Pool({
    application_name: 'rueda-worker',
    max: parsePoolMax(process.env['RUEDA_WORKER_POOL_MAX']),
  });
  try {
    await assertWorkerRole(pool);
    await assertPaymentStartup({ env: process.env, db: pool });

    const transactions = workerTransactions(async () => leased(await pool.connect()));
    const registry = new BusRegistry();
    registerWorkerTasks(registry, {
      transactions,
      config: app.get(CountryConfigService).config,
      brandName,
      log,
    });
    const loop = new WorkerLoop(
      {
        registry,
        relay: new OutboxRelay(transactions, registry),
        runner: new JobRunner(transactions, registry, new LogAlerter()),
        scheduler: new PeriodicScheduler(transactions, registry),
        metrics: new BusMetrics(transactions),
      },
      { log },
    );
    const stop = (): void => {
      loop.stop();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    log(
      JSON.stringify({
        level: 'info',
        event: 'worker.started',
        release: process.env['RUEDA_RELEASE'] ?? 'unknown',
        queues: registry.queueNames(),
      }),
    );
    await loop.run();
    log(JSON.stringify({ level: 'info', event: 'worker.stopped' }));
  } finally {
    await pool.end().catch(() => undefined);
    await app.close().catch(() => undefined);
  }
}

bootstrap().catch((error: unknown) => {
  // nom et SQLSTATE seulement, sauf pour nos propres refus de démarrage (messages sans donnée)
  const own =
    error instanceof Error &&
    /^(RUEDA_|le travailleur|démarrage refusé|\d+ passages)/.test(error.message);
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'worker.failed',
      error: errorLabel(error),
      ...(own ? { message: error.message } : {}),
    }),
  );
  process.exitCode = 1;
});
