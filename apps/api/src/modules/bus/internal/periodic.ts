/**
 * Planificateur des tâches périodiques (ADR-050, « Tâches périodiques » ; revue architecture
 * US-008, constat 2). Il n'y a pas de cron : chaque passage du planificateur garantit, pour
 * chaque tâche déclarée par `registerPeriodic`, **une occurrence vivante** (état CREATED ou
 * ACTIVE) dans sa file, avec la clé de singleton `periodic` :
 *
 * - occurrence vivante ⇒ rien (index partiel `scheduled_job_singleton`, `ON CONFLICT DO NOTHING`) ;
 * - occurrence terminée, **ou passée en lettre morte**, ou jamais créée ⇒ nouvelle occurrence à
 *   `platform.now() + période`.
 *
 * La chaîne ne peut donc pas mourir définitivement : une lettre morte alerte (port `Alerter`) et
 * la tâche reprend au passage suivant. Le travailleur appelle `tick()` au démarrage puis à
 * intervalle court (PROPOSÉ : 5 s), sous le travailleur réservé `bus_scheduler`.
 */
import type { BusRegistry } from './registry.js';
import { BUS_SCHEDULER_WORKER, PERIODIC_SINGLETON_KEY } from './registry.js';
import { scheduleJob } from './scheduler.js';
import type { WorkerTransactions } from './sql.js';

export class PeriodicScheduler {
  readonly #tx: WorkerTransactions;
  readonly #registry: BusRegistry;

  constructor(tx: WorkerTransactions, registry: BusRegistry) {
    this.#tx = tx;
    this.#registry = registry;
  }

  /** Recrée les occurrences manquantes ; renvoie les files où une occurrence a été ajoutée. */
  async tick(): Promise<string[]> {
    const tasks = this.#registry.periodicTasks();
    if (tasks.length === 0) return [];
    return this.#tx.run(BUS_SCHEDULER_WORKER, async (sql) => {
      const created: string[] = [];
      for (const { name, spec } of tasks) {
        const added = await scheduleJob(sql, {
          name,
          payload: {},
          singletonKey: PERIODIC_SINGLETON_KEY,
          delaySeconds: spec.periodSeconds,
          maxAttempts: spec.maxAttempts,
        });
        if (added) created.push(name);
      }
      return created;
    });
  }
}
