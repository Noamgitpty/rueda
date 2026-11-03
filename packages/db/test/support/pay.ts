/**
 * Aides des preuves du port PaymentProvider (US-019, migration 0027) : transaction avec contexte
 * (travailleur nommé, environnement de déploiement de TEST posé par `app.test_deployment_env`,
 * test-migrations/9400), compte PSP FAKE écrit par app_worker (droit de TEST), trip par la fixture
 * US-011, appels des commandes `core.payment_*`, points de sauvegarde pour les erreurs attendues.
 * Toutes les requêtes passent par une connexion sous un rôle de PRODUCTION (`withRole` :
 * assertion L0-05 en tête). Les attendus viennent de 17, 08 et des vecteurs TJ, jamais d'ici.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { withTestTransaction } from '../../src/testing/index.ts';
import type { CountryCase } from './avl.ts';

export const uuid = (): string => randomUUID();

/** Identifiant public d'un point d'entrée de webhook (format de 0027 : 16 à 64 caractères). */
export const publicWebhookId = (): string => `wh_${randomBytes(12).toString('hex')}`;

export interface PayTxOptions {
  /** `app.actor_kind = WORKER`, `app.worker_name`. */
  readonly worker?: string;
  /** Environnement de déploiement simulé (test-migrations/9400 ; défaut « test »). */
  readonly deploymentEnv?: 'production' | 'test';
  readonly virtualNow?: string;
  readonly commit?: boolean;
}

export async function payTx<T>(
  client: pg.ClientBase,
  options: PayTxOptions,
  fn: (tx: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return withTestTransaction(
    client,
    {
      ...(options.virtualNow !== undefined ? { virtualNow: options.virtualNow } : {}),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    },
    async (tx) => {
      if (options.worker !== undefined) {
        await tx.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', $1, true)`,
          [options.worker],
        );
      }
      if (options.deploymentEnv !== undefined) {
        await tx.query(`SELECT pg_catalog.set_config('app.test_deployment_env', $1, true)`, [
          options.deploymentEnv,
        ]);
      }
      return fn(tx);
    },
  );
}

export interface AccountInput {
  readonly id?: string;
  readonly provider?: string;
  readonly country: string;
  readonly environment?: 'SANDBOX' | 'LIVE';
  readonly status?: 'PENDING_VALIDATION' | 'ACTIVE' | 'SUSPENDED';
  readonly publicWebhookId?: string;
  readonly gateDecisionRef?: string | null;
}

/** Compte PSP écrit par app_worker (droit de TEST de 9400 ; gardes CHECK et trigger actives). */
export async function insertAccount(tx: pg.ClientBase, a: AccountInput): Promise<string> {
  const id = a.id ?? uuid();
  await tx.query(
    `INSERT INTO core.payment_psp_account
            (id, provider, country_code, environment, status, public_webhook_id, webhook_secret_ref,
             credentials_ref, gate_decision_ref)
     VALUES ($1, $2, $3, $4, $5, $6, 'vault:psp/test/webhook', 'vault:psp/test/api', $7)`,
    [
      id,
      a.provider ?? 'FAKE',
      a.country,
      a.environment ?? 'SANDBOX',
      a.status ?? 'ACTIVE',
      a.publicWebhookId ?? publicWebhookId(),
      a.gateDecisionRef ?? null,
    ],
  );
  return id;
}

/** Trip réservé par la fixture d'US-011 (comptes créés au besoin). */
export async function insertTrip(tx: pg.ClientBase, c: CountryCase): Promise<string> {
  const id = uuid();
  await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
    id,
    uuid(),
    uuid(),
    uuid(),
    c.country,
    c.currency,
    c.timezone,
    '2031-08-01T10:00:00Z',
    '2031-08-04T10:00:00Z',
  ]);
  return id;
}

export type Legs = Readonly<Record<'HOST' | 'INSURER' | 'TAX_THIRD_PARTY' | 'PLATFORM', bigint>>;

export const legsJson = (legs: Legs): string =>
  JSON.stringify({
    HOST: legs.HOST.toString(),
    INSURER: legs.INSURER.toString(),
    TAX_THIRD_PARTY: legs.TAX_THIRD_PARTY.toString(),
    PLATFORM: legs.PLATFORM.toString(),
  });

export interface RecordInput {
  readonly id?: string;
  readonly tripId: string;
  readonly accountId: string;
  readonly kind?: string;
  readonly purpose?: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly attemptNo?: number;
  readonly idemPlain: string;
  readonly idemSent?: string;
  readonly legs: Legs | null;
}

export async function recordOperation(
  tx: pg.ClientBase,
  r: RecordInput,
): Promise<{ operation_id: string; replayed: boolean }> {
  const { rows } = await tx.query<{ operation_id: string; replayed: boolean }>(
    `SELECT operation_id, replayed
       FROM core.payment_cmd_record_operation($1, NULL, $2, $3, 'CARD', $4, $5, $6, $7, $8, $9, $10,
                                              $11::jsonb)`,
    [
      r.id ?? uuid(),
      r.tripId,
      r.accountId,
      r.kind ?? 'CAPTURE',
      r.purpose ?? 'RENT',
      r.amountMinor.toString(),
      r.currency,
      r.attemptNo ?? 1,
      r.idemPlain,
      r.idemSent ?? r.idemPlain,
      r.legs === null ? null : legsJson(r.legs),
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('record_operation sans résultat');
  return row;
}

export async function applyStatus(
  tx: pg.ClientBase,
  operationId: string,
  status: string,
  source = 'WEBHOOK',
  providerReference: string | null = null,
): Promise<string> {
  const { rows } = await tx.query<{ outcome: string }>(
    `SELECT core.payment_cmd_apply_operation_status($1, $2, $3, NULL, $4) AS outcome`,
    [operationId, status, source, providerReference],
  );
  return rows[0]?.outcome ?? '';
}

/** Exécute `sql` dans un point de sauvegarde et rend l'erreur (la transaction reste utilisable). */
export async function caught(
  tx: pg.ClientBase,
  run: () => Promise<unknown>,
): Promise<{ code?: string; constraint?: string } | null> {
  await tx.query('SAVEPOINT expect_error');
  try {
    await run();
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT expect_error');
    return error as { code?: string; constraint?: string };
  }
  await tx.query('RELEASE SAVEPOINT expect_error');
  return null;
}
