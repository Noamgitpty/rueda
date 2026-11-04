/**
 * US-003 — tâches du travailleur sur PostgreSQL réel, sous `app_worker` (CLAUDE.md point 6 :
 * `connectAs` exécute l'assertion L0-05 en tête de chaque test).
 *
 * Critère (handoffs US-023, US-024, US-025, US-052, US-035) : chaque tâche périodique déclarée par
 * `registerWorkerTasks` s'exécute sous SON nom de travailleur, avec les droits, politiques et gardes
 * que la base lui réserve (0007, 0037, 0040, 0041, 0045, 0047) ; un nom faux est refusé (42501).
 * Le travailleur de production n'a aucun FAKE : la garde de démarrage C19 passe sur la base de test.
 *
 * Les transactions sont toujours ANNULÉES (rien n'est validé dans la base partagée par les autres
 * fichiers) : la tâche ne fait que prouver qu'elle tourne. Les tâches portent sur tous les pays à
 * la fois (aucune devise en jeu) ; la configuration chargée est celle de PA et PY.
 */
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { connectAs, releaseClient } from '@rueda/db/testing';
import { BusRegistry } from '../../src/modules/bus/index.js';
import type { SqlClient, WorkerTransactions } from '../../src/modules/bus/index.js';
import { CountryConfigService } from '../../src/modules/cfg/index.js';
import { assertPaymentStartup } from '../../src/modules/pay/index.js';
import { registerWorkerTasks } from '../../src/worker-tasks.js';

const opened: pg.Client[] = [];
afterEach(async () => {
  for (const c of opened.splice(0)) await releaseClient(c);
});

const sqlOf = (client: pg.Client): SqlClient => ({
  query: async <R>(text: string, params?: readonly unknown[]) => {
    const r = await client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  },
});

/** Transactions de travailleur toujours annulées, une connexion app_worker chacune. */
const rolledBack: WorkerTransactions = {
  async run(worker, fn) {
    const client = await connectAs('app_worker');
    opened.push(client);
    await client.query('BEGIN');
    try {
      await client.query(
        `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                pg_catalog.set_config('app.worker_name', $1, true)`,
        [worker],
      );
      return await fn(sqlOf(client));
    } finally {
      await client.query('ROLLBACK');
    }
  },
};

function registry(logs: string[]): BusRegistry {
  const r = new BusRegistry();
  registerWorkerTasks(r, {
    transactions: rolledBack,
    config: new CountryConfigService().config,
    brandName: 'Marca de prueba',
    log: (l) => logs.push(l),
  });
  return r;
}

describe('US-003 — tâches périodiques du travailleur sous app_worker', () => {
  for (const name of ['hold_expiry', 'disposition_sweeper', 'booking_oracle', 'risk_pruner']) {
    it(`${name} : s'exécute sous son nom de travailleur ; un autre nom est refusé`, async () => {
      const logs: string[] = [];
      const r = registry(logs);
      const h = r.handlerOf(name);
      if (h?.kind !== 'timer') throw new Error(`${name} : minuterie attendue`);
      await rolledBack.run(name, (tx) => h.handle({}, tx));
      expect(logs.length, logs.join('\n')).toBeGreaterThan(0);
      for (const l of logs) expect(JSON.parse(l) as unknown).toMatchObject({ worker: name });
      // le même gestionnaire sous un autre travailleur : refusé par la base (garde ou RLS)
      await expect(rolledBack.run('outbox_relay', (tx) => h.handle({}, tx))).rejects.toMatchObject({
        code: '42501',
      });
    });
  }

  it('garde de démarrage C19 sous app_worker : environnement de test, aucun compte FAKE requis', async () => {
    const client = await connectAs('app_worker');
    opened.push(client);
    const state = await assertPaymentStartup({ env: { RUEDA_ENV: 'test' }, db: client });
    expect(state.environment).toBe('test');
    expect(state.deploymentEnv).toBe('test');
  });
});
