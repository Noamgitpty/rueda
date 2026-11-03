/**
 * Exécution des tâches d'une file (17 §4.2 « Consommation » et « Échecs » ; ADR-050), sous le
 * travailleur qui porte le nom de la file :
 *
 *   1. réclamation (`core.outbox_claim_jobs`, transaction courte) : tâches échues, bail posé,
 *      une tentative comptée ;
 *   2. traitement, une transaction par tâche :
 *      - livraison d'événement : verrou consultatif sur `partition_key` s'il y en a une (un seul
 *        traitement à la fois par agrégat monétaire, F32) ; reçu `core.outbox_begin_receipt`
 *        (PK consumer, event_id) ; doublon ⇒ le traitement est sauté ; sinon le gestionnaire
 *        s'exécute **dans la même transaction** ; puis `core.outbox_complete_job` ;
 *      - minuterie : gestionnaire (idempotent, revérifie l'état), puis `complete_job` ;
 *   3. échec ⇒ ROLLBACK (ni reçu, ni écriture), puis, dans une transaction séparée,
 *      `core.outbox_fail_job` : nouvelle échéance à attente exponentielle, ou, après
 *      `max_attempts` tentatives, `FAILED` + `dead_letter` ⇒ alerte ;
 *   4. bail expiré sur une dernière tentative (`core.outbox_reap_expired_jobs`) ⇒ lettre morte
 *      et alerte.
 */
import type { Alerter } from './alerts.js';
import type { EnvelopeJson, JsonObject } from './envelope.js';
import { envelopeToEvent, errorCode } from './envelope.js';
import type { BusRegistry } from './registry.js';
import type { WorkerTransactions } from './sql.js';

export interface JobRunnerOptions {
  /** Tâches réclamées par passage (1 à 1000). PROPOSÉ : 10. */
  readonly batchSize?: number;
  /** Bail d'une tâche réclamée, en secondes. PROPOSÉ : 300. */
  readonly leaseSeconds?: number;
  /** Base de l'attente exponentielle, en secondes : base × 2^(tentative − 1). PROPOSÉ : 30. */
  readonly backoffBaseSeconds?: number;
}

export type JobOutcome = 'PROCESSED' | 'DUPLICATE' | 'RETRY' | 'DEAD_LETTER' | 'LOST';

export interface RunResult {
  readonly outcomes: readonly { readonly jobId: string; readonly outcome: JobOutcome }[];
  readonly reaped: number;
}

interface ClaimedJob {
  readonly id: string;
  readonly event_id: string | null;
  readonly payload: JsonObject;
  readonly attempts: number;
}

interface DeadLetterRow {
  readonly consumer: string;
  readonly event_id: string | null;
  readonly job_id: string;
  readonly attempts: number;
  readonly last_error: string | null;
}

/** Valeurs PROPOSÉES (17 §4.2 ne fixe que les 5 tentatives) ; voir ADR-050. */
export const JOB_RUNNER_DEFAULTS = {
  batchSize: 10,
  leaseSeconds: 300,
  backoffBaseSeconds: 30,
} as const;

export class JobRunner {
  readonly #tx: WorkerTransactions;
  readonly #registry: BusRegistry;
  readonly #alerter: Alerter;
  readonly #batchSize: number;
  readonly #leaseSeconds: number;
  readonly #backoffBaseSeconds: number;

  constructor(
    tx: WorkerTransactions,
    registry: BusRegistry,
    alerter: Alerter,
    options: JobRunnerOptions = {},
  ) {
    this.#tx = tx;
    this.#registry = registry;
    this.#alerter = alerter;
    this.#batchSize = options.batchSize ?? JOB_RUNNER_DEFAULTS.batchSize;
    this.#leaseSeconds = options.leaseSeconds ?? JOB_RUNNER_DEFAULTS.leaseSeconds;
    this.#backoffBaseSeconds = options.backoffBaseSeconds ?? JOB_RUNNER_DEFAULTS.backoffBaseSeconds;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 1000) {
      throw new TypeError('batchSize : entier de 1 à 1000 attendu');
    }
    if (!(this.#leaseSeconds > 0)) throw new TypeError('leaseSeconds : nombre > 0 attendu');
    if (!(this.#backoffBaseSeconds >= 0)) {
      throw new TypeError('backoffBaseSeconds : nombre ≥ 0 attendu');
    }
  }

  /** Un passage sur la file `queue` : lettres mortes des baux expirés, puis un lot de tâches. */
  async runOnce(queue: string): Promise<RunResult> {
    const handler = this.#registry.handlerOf(queue);
    if (handler === undefined) throw new TypeError(`file inconnue : ${queue}`);

    const reaped = await this.#tx.run(queue, async (sql) => {
      const { rows } = await sql.query<DeadLetterRow>(
        'SELECT consumer, event_id, job_id, attempts, last_error FROM core.outbox_reap_expired_jobs()',
      );
      return rows;
    });
    for (const dead of reaped) {
      await this.#alert({
        consumer: dead.consumer,
        eventId: dead.event_id,
        jobId: dead.job_id,
        attempts: dead.attempts,
        errorCode: dead.last_error ?? 'LEASE_EXPIRED',
      });
    }

    const jobs = await this.#tx.run(queue, async (sql) => {
      const { rows } = await sql.query<ClaimedJob>(
        `SELECT id, event_id, payload, attempts
           FROM core.outbox_claim_jobs($1::integer, make_interval(secs => $2::double precision))
          ORDER BY run_at, id`,
        [this.#batchSize, this.#leaseSeconds],
      );
      return rows;
    });

    const outcomes: { jobId: string; outcome: JobOutcome }[] = [];
    for (const job of jobs) {
      outcomes.push({ jobId: job.id, outcome: await this.#process(queue, job) });
    }
    return { outcomes, reaped: reaped.length };
  }

  async #process(queue: string, job: ClaimedJob): Promise<JobOutcome> {
    const handler = this.#registry.handlerOf(queue);
    try {
      return await this.#tx.run(queue, async (sql): Promise<JobOutcome> => {
        let outcome: JobOutcome = 'PROCESSED';
        if (handler?.kind === 'consumer') {
          const event = envelopeToEvent(job.payload['event'] as unknown as EnvelopeJson);
          if (event.eventId !== job.event_id) throw new TypeError('tâche et événement discordants');
          if (event.partitionKey !== null) {
            await sql.query(
              'SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended($1::text, 0))',
              [`bus:${event.partitionKey}`],
            );
          }
          const { rows } = await sql.query<{ fresh: boolean }>(
            'SELECT core.outbox_begin_receipt($1::uuid) AS fresh',
            [event.eventId],
          );
          if (rows[0]?.fresh === true) {
            await handler.handle(event, sql);
          } else {
            outcome = 'DUPLICATE';
          }
        } else if (handler?.kind === 'timer') {
          await handler.handle(job.payload, sql);
        }
        const { rows: done } = await sql.query<{ ok: boolean }>(
          'SELECT core.outbox_complete_job($1::uuid) AS ok',
          [job.id],
        );
        // bail perdu : un autre travailleur a repris la tâche ; le reçu tranche entre les deux
        return done[0]?.ok === true ? outcome : 'LOST';
      });
    } catch (error) {
      const code = errorCode(error);
      const outcome = await this.#tx.run(queue, async (sql) => {
        const { rows } = await sql.query<{ outcome: string }>(
          `SELECT core.outbox_fail_job($1::uuid, $2::text,
                                       make_interval(secs => $3::double precision)) AS outcome`,
          [job.id, code, this.#backoffBaseSeconds],
        );
        return rows[0]?.outcome;
      });
      if (outcome === 'DEAD_LETTER') {
        await this.#alert({
          consumer: queue,
          eventId: job.event_id,
          jobId: job.id,
          attempts: job.attempts,
          errorCode: code,
        });
        return 'DEAD_LETTER';
      }
      return outcome === 'RETRY' ? 'RETRY' : 'LOST';
    }
  }

  async #alert(alert: Parameters<Alerter['deadLetter']>[0]): Promise<void> {
    try {
      await this.#alerter.deadLetter(alert);
    } catch {
      // l'alerte ne doit pas bloquer la file : la lettre morte est déjà enregistrée en base
    }
  }
}
