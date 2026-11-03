/**
 * Relais de l'outbox (17 §4.2, « Relais ») : sous le travailleur `outbox_relay`, une transaction
 * par lot :
 *   1. `core.outbox_relay_claim(n)` : `WHERE published_at IS NULL ORDER BY id FOR UPDATE SKIP
 *      LOCKED LIMIT n` (plusieurs relais se partagent les événements sans s'attendre) ;
 *   2. pour chaque événement, une tâche par consommateur abonné (`core.outbox_enqueue`, clé =
 *      event_id : un rejeu du relais n'ajoute pas de seconde tâche vivante) ;
 *   3. `core.outbox_mark_published(ids)`.
 * Tout est dans la même transaction : un échec n'a rien publié (livraison au moins une fois).
 * L'ordre par agrégat n'est pas garanti entre relais : les consommateurs s'appuient sur
 * `aggregate_version` (17 §4.2, VERIF_14-F32).
 */
import type { OutboxEventRow } from './envelope.js';
import { errorCode, rowToEnvelope } from './envelope.js';
import type { BusRegistry } from './registry.js';
import { OUTBOX_RELAY_WORKER } from './registry.js';
import { SPEC_MAX_ATTEMPTS } from './scheduler.js';
import type { WorkerTransactions } from './sql.js';

export interface OutboxRelayOptions {
  /** Taille de lot (1 à 1000). PROPOSÉ : 100. */
  readonly batchSize?: number;
  /** Tentatives par livraison avant lettre morte (17 §4.2 : 5). */
  readonly maxAttempts?: number;
}

export interface RelayResult {
  readonly published: number;
  readonly deliveries: number;
}

const ENQUEUE_DELIVERY = `
  SELECT core.outbox_enqueue($1::text, $2::jsonb, $3::text, $4::uuid, NULL::timestamptz,
                             interval '0 seconds', $5::integer) AS added`;

export class OutboxRelay {
  readonly #tx: WorkerTransactions;
  readonly #registry: BusRegistry;
  readonly #batchSize: number;
  readonly #maxAttempts: number;

  constructor(tx: WorkerTransactions, registry: BusRegistry, options: OutboxRelayOptions = {}) {
    this.#tx = tx;
    this.#registry = registry;
    this.#batchSize = options.batchSize ?? 100;
    this.#maxAttempts = options.maxAttempts ?? SPEC_MAX_ATTEMPTS;
    if (!Number.isInteger(this.#batchSize) || this.#batchSize < 1 || this.#batchSize > 1000) {
      throw new TypeError('batchSize : entier de 1 à 1000 attendu');
    }
  }

  /** Publie un lot ; `published = 0` quand l'outbox est vide (ou verrouillée par un autre relais). */
  async runOnce(): Promise<RelayResult> {
    let claimed: string[] = [];
    try {
      return await this.#tx.run(OUTBOX_RELAY_WORKER, async (sql) => {
        const { rows } = await sql.query<OutboxEventRow>(
          `SELECT id, type, schema_version, occurred_at, aggregate_type, aggregate_id,
                  aggregate_version, country_code, actor_user_id, actor_role, correlation_id,
                  causation_id, payload, partition_key
             FROM core.outbox_relay_claim($1::integer)`,
          [this.#batchSize],
        );
        claimed = rows.map((r) => r.id);
        let deliveries = 0;
        for (const row of rows) {
          const envelope = rowToEnvelope(row);
          for (const consumer of this.#registry.consumersOf(row.type)) {
            const { rows: added } = await sql.query<{ added: boolean }>(ENQUEUE_DELIVERY, [
              consumer,
              JSON.stringify({ event: envelope }),
              row.id,
              row.id,
              this.#maxAttempts,
            ]);
            if (added[0]?.added === true) deliveries++;
          }
        }
        if (claimed.length > 0) {
          await sql.query('SELECT core.outbox_mark_published($1::uuid[]) AS n', [claimed]);
        }
        return { published: claimed.length, deliveries };
      });
    } catch (error) {
      if (claimed.length > 0) {
        const ids = claimed;
        // diagnostic (attempts, last_error) dans une transaction séparée ; l'échec initial prime
        await this.#tx
          .run(OUTBOX_RELAY_WORKER, (sql) =>
            sql.query('SELECT core.outbox_record_relay_failure($1::uuid[], $2::text) AS n', [
              ids,
              errorCode(error),
            ]),
          )
          .catch(() => undefined);
      }
      throw error;
    }
  }
}
