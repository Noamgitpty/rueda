/**
 * Boucle du travailleur (US-003, ADR-078 ; ADR-050) : relais de l'outbox, files de tâches,
 * planificateur des tâches périodiques et métriques du module BUS, dans un seul processus.
 *
 * Un passage :
 *   1. relais : lots publiés tant que l'outbox en rend (borné à `maxRelayBatches` par passage) ;
 *   2. chaque file déclarée (`registry.queueNames()`) : un lot de tâches ;
 *   3. toutes les `schedulerEveryMs` : `PeriodicScheduler.tick()` (au premier passage aussi) ;
 *   4. toutes les `metricsEveryMs` : `BusMetrics.collect()`, une ligne de journal (comptes seulement).
 * Puis une attente de `idleMs` (interrompue par `stop()`).
 *
 * Erreurs : une étape qui échoue est journalisée (nom et SQLSTATE seulement, jamais de message de
 * la base : il peut citer une valeur) et la boucle continue. Après `maxConsecutiveFailures`
 * passages entièrement en échec (base perdue, droits retirés…), la boucle s'arrête en erreur :
 * le processus sort avec un code non nul et l'orchestrateur de conteneurs le relance (fail loud).
 * Arrêt propre : `stop()` (SIGTERM) termine le passage en cours, puis `run()` rend la main.
 */
import type {
  BusMetrics,
  BusRegistry,
  JobRunner,
  OutboxRelay,
  PeriodicScheduler,
} from './modules/bus/index.js';
import { metricsLogLine } from './modules/bus/index.js';

/** Valeurs PROPOSÉES (ADR-078). */
export const WORKER_LOOP_DEFAULTS = {
  idleMs: 1_000,
  schedulerEveryMs: 5_000,
  metricsEveryMs: 60_000,
  maxRelayBatches: 10,
  maxConsecutiveFailures: 30,
} as const;

export interface WorkerLoopParts {
  readonly registry: Pick<BusRegistry, 'queueNames'>;
  readonly relay: Pick<OutboxRelay, 'runOnce'>;
  readonly runner: Pick<JobRunner, 'runOnce'>;
  readonly scheduler: Pick<PeriodicScheduler, 'tick'>;
  readonly metrics: Pick<BusMetrics, 'collect'>;
}

export interface WorkerLoopOptions {
  readonly idleMs?: number;
  readonly schedulerEveryMs?: number;
  readonly metricsEveryMs?: number;
  readonly maxRelayBatches?: number;
  readonly maxConsecutiveFailures?: number;
  readonly log?: (line: string) => void;
  readonly clock?: () => number;
}

export class WorkerLoopFailure extends Error {
  override readonly name = 'WorkerLoopFailure';
}

/** Étiquette d'erreur sans donnée : nom de l'erreur et SQLSTATE éventuel. */
export function errorLabel(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const name = (error as { name?: unknown }).name;
  const code = (error as { code?: unknown }).code;
  const safeName = typeof name === 'string' && /^[A-Za-z]{1,64}$/.test(name) ? name : 'Error';
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? `${safeName}:${code}` : safeName;
}

export class WorkerLoop {
  readonly #parts: WorkerLoopParts;
  readonly #o: Required<Omit<WorkerLoopOptions, 'log' | 'clock'>>;
  readonly #log: (line: string) => void;
  readonly #clock: () => number;
  #stopping = false;
  #wake: (() => void) | undefined;

  constructor(parts: WorkerLoopParts, options: WorkerLoopOptions = {}) {
    this.#parts = parts;
    this.#o = {
      idleMs: options.idleMs ?? WORKER_LOOP_DEFAULTS.idleMs,
      schedulerEveryMs: options.schedulerEveryMs ?? WORKER_LOOP_DEFAULTS.schedulerEveryMs,
      metricsEveryMs: options.metricsEveryMs ?? WORKER_LOOP_DEFAULTS.metricsEveryMs,
      maxRelayBatches: options.maxRelayBatches ?? WORKER_LOOP_DEFAULTS.maxRelayBatches,
      maxConsecutiveFailures:
        options.maxConsecutiveFailures ?? WORKER_LOOP_DEFAULTS.maxConsecutiveFailures,
    };
    this.#log =
      options.log ??
      ((line) => {
        console.log(line);
      });
    this.#clock = options.clock ?? (() => Date.now());
    for (const [k, v] of Object.entries(this.#o)) {
      if (!Number.isInteger(v) || v < 0) throw new TypeError(`${k} : entier ≥ 0 attendu`);
    }
  }

  /** Demande l'arrêt : le passage en cours se termine, l'attente est interrompue. */
  stop(): void {
    this.#stopping = true;
    this.#wake?.();
  }

  get stopping(): boolean {
    return this.#stopping;
  }

  async #step(label: string, fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (error) {
      this.#log(JSON.stringify({ level: 'error', step: label, error: errorLabel(error) }));
      return false;
    }
  }

  /** Un passage ; renvoie le nombre d'étapes en échec et le nombre d'étapes tentées. */
  async runOnce(state: { lastSchedule: number; lastMetrics: number }): Promise<{
    readonly failed: number;
    readonly attempted: number;
  }> {
    let failed = 0;
    let attempted = 0;
    const step = async (label: string, fn: () => Promise<void>): Promise<void> => {
      attempted++;
      if (!(await this.#step(label, fn))) failed++;
    };
    const now = this.#clock();
    if (now - state.lastSchedule >= this.#o.schedulerEveryMs) {
      state.lastSchedule = now;
      await step('scheduler', async () => {
        await this.#parts.scheduler.tick();
      });
    }
    await step('relay', async () => {
      for (let i = 0; i < this.#o.maxRelayBatches && !this.#stopping; i++) {
        const r = await this.#parts.relay.runOnce();
        if (r.published === 0) break;
      }
    });
    for (const queue of this.#parts.registry.queueNames()) {
      if (this.#stopping) break;
      await step(`queue:${queue}`, async () => {
        await this.#parts.runner.runOnce(queue);
      });
    }
    if (now - state.lastMetrics >= this.#o.metricsEveryMs) {
      state.lastMetrics = now;
      await step('metrics', async () => {
        this.#log(metricsLogLine(await this.#parts.metrics.collect()));
      });
    }
    return { failed, attempted };
  }

  /** Tourne jusqu'à `stop()` ; lève `WorkerLoopFailure` après trop de passages en échec. */
  async run(): Promise<void> {
    const state = { lastSchedule: -Infinity, lastMetrics: -Infinity };
    let consecutive = 0;
    while (!this.#stopping) {
      const { failed, attempted } = await this.runOnce(state);
      consecutive = attempted > 0 && failed === attempted ? consecutive + 1 : 0;
      if (consecutive >= this.#o.maxConsecutiveFailures && this.#o.maxConsecutiveFailures > 0) {
        throw new WorkerLoopFailure(`${consecutive} passages consécutifs entièrement en échec`);
      }
      if (this.#stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.#o.idleMs);
        this.#wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.#wake = undefined;
    }
  }
}
