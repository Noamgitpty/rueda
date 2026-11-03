/**
 * Aides des tests de l'outbox (US-008) : transaction de test avec contexte de session (acteur de
 * l'API ou travailleur nommé), écriture d'un événement, appels des fonctions de file. Toutes les
 * requêtes passent par une connexion sous un rôle de PRODUCTION (`withRole` / `connectAs` :
 * assertion L0-05 en tête).
 *
 * Les valeurs attendues des tests viennent de 17 §4.1 et §4.2, jamais de ce fichier.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from './avl.ts';

/**
 * Les deux pays de premier rang (CLAUDE.md point 3) : jeux de TEST de support/avl.ts (USD à 2
 * décimales, PYG sans décimale ; montants en unités mineures, chaînes bigint).
 */
export const EVENT_COUNTRIES = COUNTRIES.map((c) => ({
  country: c.country,
  currency: c.currency,
  amountMinor: c.rentMinor,
}));
export type EventCountry = (typeof EVENT_COUNTRIES)[number];

/** 17 §4.2 : « 5 tentatives avec attente exponentielle, puis dead_letter ». */
export const SPEC_MAX_ATTEMPTS = 5;

export const uuid = (): string => randomUUID();

/** Nom de travailleur unique (format `app.worker_name`) : une file isolée par test. */
export const workerName = (prefix: string): string => `${prefix}_${randomBytes(6).toString('hex')}`;

export interface OutboxTxOptions {
  /** Acteur de l'API (17 §2.3) : `app.actor_kind`. */
  readonly actor?: 'GUEST' | 'HOST' | 'STAFF';
  /** Travailleur : `app.actor_kind = WORKER` et `app.worker_name`. */
  readonly worker?: string;
  readonly virtualNow?: string;
  readonly commit?: boolean;
}

/** Transaction de test (US-005) avec le contexte de session demandé, posé par `SET LOCAL`. */
export async function outboxTx<T>(
  client: pg.ClientBase,
  options: OutboxTxOptions,
  fn: (tx: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return withTestTransaction(
    client,
    {
      ...(options.virtualNow !== undefined ? { virtualNow: options.virtualNow } : {}),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    },
    async (tx) => {
      if (options.actor !== undefined) {
        await tx.query(`SELECT pg_catalog.set_config('app.actor_kind', $1, true)`, [options.actor]);
      }
      if (options.worker !== undefined) {
        await tx.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', $1, true)`,
          [options.worker],
        );
      }
      return fn(tx);
    },
  );
}

export interface TestEvent {
  readonly id: string;
  readonly type: string;
  readonly aggregateId: string;
  readonly country: EventCountry;
}

/** Écrit un événement (enveloppe 17 §4.1) dans la transaction courante, sans RETURNING. */
export async function insertEvent(
  tx: pg.ClientBase,
  country: EventCountry,
  overrides: { readonly type?: string; readonly partitionKey?: string } = {},
): Promise<TestEvent> {
  const event: TestEvent = {
    id: uuid(),
    type: overrides.type ?? 'booking.trip.booked',
    aggregateId: uuid(),
    country,
  };
  await tx.query(
    `INSERT INTO core.outbox_outbox_event
            (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version,
             country_code, actor_user_id, actor_role, correlation_id, causation_id, payload,
             partition_key)
     VALUES ($1, $2, 1, 'trip', $3, 1, $4, NULL, 'SYSTEM', $5, NULL, $6::jsonb, $7)`,
    [
      event.id,
      event.type,
      event.aggregateId,
      country.country,
      uuid(),
      JSON.stringify({
        trip_id: event.aggregateId,
        currency: country.currency,
        amount_minor: country.amountMinor,
      }),
      overrides.partitionKey ?? null,
    ],
  );
  return event;
}

export interface JobRow {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly event_id: string | null;
  readonly run_at: Date;
}

/** `core.outbox_enqueue` : tâche pour le travailleur `name` ; renvoie `true` si ajoutée. */
export async function enqueue(
  tx: pg.ClientBase,
  name: string,
  options: {
    readonly eventId?: string;
    readonly singletonKey?: string;
    readonly maxAttempts?: number;
    readonly delay?: string;
  } = {},
): Promise<boolean> {
  const { rows } = await tx.query<{ added: boolean }>(
    `SELECT core.outbox_enqueue($1::text, $2::jsonb, $3::text, $4::uuid, NULL::timestamptz,
                                $5::interval, $6::integer) AS added`,
    [
      name,
      JSON.stringify(options.eventId !== undefined ? { event_id: options.eventId } : {}),
      options.singletonKey ?? options.eventId ?? null,
      options.eventId ?? null,
      options.delay ?? '0 seconds',
      options.maxAttempts ?? SPEC_MAX_ATTEMPTS,
    ],
  );
  return rows[0]?.added === true;
}

/** `core.outbox_claim_jobs` : tâches réclamées par le travailleur du contexte. */
export async function claimJobs(
  tx: pg.ClientBase,
  limit = 10,
  lease = '5 minutes',
): Promise<JobRow[]> {
  const { rows } = await tx.query<JobRow>(
    `SELECT id, name, state, attempts, max_attempts, event_id, run_at
       FROM core.outbox_claim_jobs($1::integer, $2::interval)
      ORDER BY run_at, id`,
    [limit, lease],
  );
  return rows;
}

/** `core.outbox_fail_job` : 'RETRY', 'DEAD_LETTER' ou 'NOT_FOUND'. */
export async function failJob(
  tx: pg.ClientBase,
  jobId: string,
  backoffBase = '0 seconds',
): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    `SELECT core.outbox_fail_job($1::uuid, 'Error', $2::interval) AS outcome`,
    [jobId, backoffBase],
  );
  return rows[0]?.outcome ?? '';
}

/** Capture l'erreur d'une promesse (ou undefined). */
export const failure = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );
