/**
 * Aides des preuves d'audit (US-009) : transaction de test avec contexte d'acteur (17 §2.3),
 * relecture et vérification de la chaîne par le travailleur `audit_chain_verifier`.
 * Toutes les requêtes passent par une connexion sous un rôle de PRODUCTION (`withRole` /
 * `connectAs` : assertion L0-05 en tête). Les attentes des tests viennent de 17 §1.7, §3.1.3,
 * §3.2.13 et d'ADR-051, pas de ce fichier.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { AUDIT_CHAIN_SELECT, fromDbRow, verifyAuditChain } from '../../src/audit/index.ts';
import type { AuditChainDbRow, AuditChainResult, AuditChainRow } from '../../src/audit/index.ts';
import { withTestTransaction } from '../../src/testing/index.ts';

export const uuid = (): string => randomUUID();

export type ActorContext =
  /** `actorId` : app.actor_id ; la clé de sujet USER n'est accessible qu'à ce compte (US-011) */
  | { readonly kind: 'GUEST' | 'HOST' | 'STAFF'; readonly actorId?: string }
  | { readonly kind: 'WORKER'; readonly worker: string }
  /** aucun `app.*` posé (fail-closed attendu) */
  | { readonly kind: 'NONE' };

export interface AuditTxOptions {
  readonly actor: ActorContext;
  readonly virtualNow?: string;
  readonly commit?: boolean;
}

/** Transaction de test (US-005) avec le contexte d'acteur posé par `SET LOCAL`. */
export async function auditTx<T>(
  client: pg.ClientBase,
  options: AuditTxOptions,
  fn: (tx: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return withTestTransaction(
    client,
    {
      ...(options.virtualNow !== undefined ? { virtualNow: options.virtualNow } : {}),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
    },
    async (tx) => {
      await setActor(tx, options.actor);
      return fn(tx);
    },
  );
}

/** Pose (ou change) le contexte d'acteur dans la transaction courante. */
export async function setActor(tx: pg.ClientBase, actor: ActorContext): Promise<void> {
  if (actor.kind === 'NONE') {
    await tx.query(
      `SELECT pg_catalog.set_config('app.actor_kind', '', true),
              pg_catalog.set_config('app.actor_id', '', true),
              pg_catalog.set_config('app.worker_name', '', true)`,
    );
  } else if (actor.kind === 'WORKER') {
    await tx.query(
      `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
              pg_catalog.set_config('app.actor_id', '', true),
              pg_catalog.set_config('app.worker_name', $1, true)`,
      [actor.worker],
    );
  } else {
    await tx.query(
      `SELECT pg_catalog.set_config('app.actor_kind', $1, true),
              pg_catalog.set_config('app.actor_id', $2, true),
              pg_catalog.set_config('app.worker_name', '', true)`,
      [actor.kind, actor.actorId ?? ''],
    );
  }
}

export const VERIFIER: ActorContext = { kind: 'WORKER', worker: 'audit_chain_verifier' };

/** Relit toute la chaîne et la tête (contexte `audit_chain_verifier` déjà posé). */
export async function readChain(
  tx: pg.ClientBase,
): Promise<{ rows: AuditChainRow[]; head: { lastId: string; lastHash: Buffer } }> {
  // la tête d'abord, puis les lignes jusqu'à elle : des écrivains concurrents validés entre les
  // deux lectures (READ COMMITTED) ne faussent pas la comparaison
  const head = await tx.query<{ last_id: string; last_hash: Buffer }>(
    `SELECT last_id::text AS last_id, last_hash FROM core.audit_chain_head WHERE chain = 'audit_log'`,
  );
  const h = head.rows[0];
  if (h === undefined)
    throw new Error('tête de chaîne invisible : contexte audit_chain_verifier ?');
  const { rows } = await tx.query<AuditChainDbRow>(AUDIT_CHAIN_SELECT, [h.last_id]);
  return { rows: rows.map(fromDbRow), head: { lastId: h.last_id, lastHash: h.last_hash } };
}

/** Vérifie la chaîne complète contre la tête (pose le contexte du vérificateur). */
export async function verifyChainIn(tx: pg.ClientBase): Promise<AuditChainResult> {
  await setActor(tx, VERIFIER);
  const { rows, head } = await readChain(tx);
  return verifyAuditChain(rows, head);
}

/** Capture l'erreur d'une promesse (ou undefined). */
export const failure = (p: Promise<unknown>): Promise<unknown> =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  );

/**
 * Exécute `sql` dans un SAVEPOINT et rend l'erreur (la transaction reste utilisable).
 */
export async function attempt(
  tx: pg.ClientBase,
  sql: string,
  params: unknown[] = [],
): Promise<unknown> {
  await tx.query('SAVEPOINT attempt');
  const error = await failure(tx.query(sql, params));
  await tx.query(
    error === undefined ? 'RELEASE SAVEPOINT attempt' : 'ROLLBACK TO SAVEPOINT attempt',
  );
  return error;
}
