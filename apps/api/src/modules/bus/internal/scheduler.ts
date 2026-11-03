/**
 * Programmation d'une tâche (file `core.outbox_scheduled_job`, ADR-050) dans la transaction
 * courante : minuterie durable (17 §2.11) ou livraison. L'instant d'exécution est soit un délai
 * (calculé par la base : `platform.now() + délai`), soit un instant métier lu en base (ex. début
 * du trip − 24 h) ; le serveur ne passe jamais « l'heure courante » (17 §1.3).
 */
import type { JsonObject } from './envelope.js';
import type { SqlClient } from './sql.js';
import { assertWorkerName } from './sql.js';

/** 17 §4.2 : « 5 tentatives avec attente exponentielle, puis dead_letter ». */
export const SPEC_MAX_ATTEMPTS = 5;

export interface ScheduleJobInput {
  /** File (= `app.worker_name` du travailleur qui l'exécutera). */
  readonly name: string;
  readonly payload: JsonObject;
  /** Au plus une tâche vivante par (file, clé). */
  readonly singletonKey?: string | null;
  readonly eventId?: string | null;
  /** Instant métier lu en base ; à défaut, `platform.now() + delaySeconds`. */
  readonly runAt?: Date | null;
  readonly delaySeconds?: number;
  readonly maxAttempts?: number;
}

const ENQUEUE = `
  SELECT core.outbox_enqueue($1::text, $2::jsonb, $3::text, $4::uuid, $5::timestamptz,
                             make_interval(secs => $6::double precision), $7::integer) AS added`;

/** Ajoute la tâche ; `false` si une tâche vivante de même (file, clé) existe déjà. */
export async function scheduleJob(tx: SqlClient, input: ScheduleJobInput): Promise<boolean> {
  assertWorkerName(input.name);
  const delay = input.delaySeconds ?? 0;
  if (!Number.isFinite(delay) || delay < 0)
    throw new TypeError('delaySeconds : nombre ≥ 0 attendu');
  const maxAttempts = input.maxAttempts ?? SPEC_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 25) {
    throw new TypeError('maxAttempts : entier de 1 à 25 attendu');
  }
  const { rows } = await tx.query<{ added: boolean }>(ENQUEUE, [
    input.name,
    JSON.stringify(input.payload),
    input.singletonKey ?? null,
    input.eventId ?? null,
    input.runAt ?? null,
    delay,
    maxAttempts,
  ]);
  return rows[0]?.added === true;
}
