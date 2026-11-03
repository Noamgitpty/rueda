/**
 * Métriques du bus (17 §6.3 : « âge maximal de l'outbox non publiée (> 2 min) » ; §6.7 : âge de
 * l'outbox p99 < 30 s ; revue architecture US-008, constat 2). Lues par `core.outbox_metrics()`
 * (migration 0015) sous le travailleur réservé `bus_monitor`, seul à voir toutes les files.
 *
 * Le travailleur publie l'instantané en une ligne JSON (`bus.metrics`, `LogMetricsSink`) reprise
 * par l'observabilité ; les seuils d'alerte sont ceux de 17 §6.3.
 */
import { BUS_MONITOR_WORKER } from './registry.js';
import type { WorkerTransactions } from './sql.js';

export interface QueueDepth {
  /** Tâches CREATED déjà échues (en attente d'un travailleur). */
  readonly ready: number;
  /** Tâches CREATED à échéance future (réessais, minuteries, tâches périodiques). */
  readonly scheduled: number;
  readonly active: number;
  readonly failed: number;
  /** Lettres mortes non rejouées. */
  readonly deadLetters: number;
  /** Âge (s) de la plus ancienne tâche échue non traitée, 0 si aucune. */
  readonly oldestReadyAgeSeconds: number;
}

export interface BusMetricsSnapshot {
  readonly outboxUnpublished: number;
  /** Âge (s) du plus ancien événement non publié, 0 si aucun. */
  readonly outboxOldestAgeSeconds: number;
  readonly queues: Readonly<Record<string, QueueDepth>>;
}

export interface MetricRow {
  readonly metric: string;
  readonly queue: string | null;
  readonly value: string | number;
}

const EMPTY: QueueDepth = {
  ready: 0,
  scheduled: 0,
  active: 0,
  failed: 0,
  deadLetters: 0,
  oldestReadyAgeSeconds: 0,
};

const FIELD: Readonly<Record<string, keyof QueueDepth>> = {
  queue_ready: 'ready',
  queue_scheduled: 'scheduled',
  queue_active: 'active',
  queue_failed: 'failed',
  dead_letter_open: 'deadLetters',
  queue_oldest_ready_age_s: 'oldestReadyAgeSeconds',
};

/** Lignes de `core.outbox_metrics()` → instantané. */
export function toSnapshot(rows: readonly MetricRow[]): BusMetricsSnapshot {
  let outboxUnpublished = 0;
  let outboxOldestAgeSeconds = 0;
  const queues: Record<string, QueueDepth> = {};
  for (const r of rows) {
    const value = Number(r.value);
    if (r.metric === 'outbox_unpublished') outboxUnpublished = value;
    else if (r.metric === 'outbox_oldest_age_s') outboxOldestAgeSeconds = value;
    else {
      const field = FIELD[r.metric];
      if (field !== undefined && r.queue !== null) {
        queues[r.queue] = { ...(queues[r.queue] ?? EMPTY), [field]: value };
      }
    }
  }
  return { outboxUnpublished, outboxOldestAgeSeconds, queues };
}

export class BusMetrics {
  readonly #tx: WorkerTransactions;

  constructor(tx: WorkerTransactions) {
    this.#tx = tx;
  }

  async collect(): Promise<BusMetricsSnapshot> {
    const rows = await this.#tx.run(BUS_MONITOR_WORKER, async (sql) => {
      const { rows: out } = await sql.query<MetricRow>(
        'SELECT metric, queue, value FROM core.outbox_metrics()',
      );
      return out;
    });
    return toSnapshot(rows);
  }
}

/** Ligne JSON `bus.metrics` (identifiants de files et compteurs seulement). */
export function metricsLogLine(snapshot: BusMetricsSnapshot): string {
  return JSON.stringify({ level: 'info', metric: 'bus.metrics', ...snapshot });
}
