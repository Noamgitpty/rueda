/**
 * US-222c — aides de la red team du lot 2, axe « ex-porte LB, RLS et console » (19 US-222 critère 3
 * et rejeux ; pré-mortem du lot 2, RT-L2-LB01 à LB05, RT-L2-R03, RT-L2-S01). TESTS SEULEMENT.
 *
 * Règles de jeu (comme la passe argent, US-222b) : connexions sous les rôles de PRODUCTION
 * (`withRole` / `connectAs` : assertion L0-05 en tête), une connexion par client, toujours libérée ;
 * horloge de la base (`platform.now()`, horloge virtuelle de test) ; aucun interrupteur ouvert hors
 * d'une transaction ANNULÉE et par la vraie procédure à deux personnes (`support/golive.ts`, tête
 * d'audit puis verrou consultatif) ; aucune constante de pays (pays et devises de `COUNTRIES`,
 * exposants lus dans les données CFG) ; montants des oracles (`@rueda/money/golden-vectors`).
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checksFor, loadGoldenVectors } from '@rueda/money/golden-vectors';
import type pg from 'pg';
import { setSessionContext } from '../../../src/index.ts';
import { connectAs, releaseClient } from '../../../src/testing/index.ts';
import type { CountryCase } from '../../support/avl.ts';

export type Tx = pg.ClientBase;
export type Row = Record<string, unknown>;
export const H = 3_600_000;
export const at = (iso: string, hours: number): string =>
  new Date(Date.parse(iso) + hours * H).toISOString();

const cfg = (file: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../../apps/api/src/modules/cfg/data/${file}`, import.meta.url),
      'utf8',
    ),
  );
const EXPONENTS = new Map(
  (cfg('currencies.json') as { currencies: { code: string; exponent: number }[] }).currencies.map(
    (c) => [c.code, c.exponent],
  ),
);
export const exponentOf = (cc: CountryCase): number => {
  const e = EXPONENTS.get(cc.currency);
  if (e === undefined) throw new Error(`devise sans exposant : ${cc.currency}`);
  return e;
};

const T57 = (() => {
  const found = checksFor(loadGoldenVectors(), 'T57').find((c) => c.label === 'T57');
  if (found === undefined) throw new Error('contrôle T57 absent de l’export');
  return found.expected as Record<string, bigint>;
})();

/**
 * Caution de test par exposant de la devise : exposant 2, T57 de l'export (capture 1 200 + VOID
 * 28 800 = 30 000) ; exposant 0, T73 a (`deposit_amount[PY][LUXE]` = 1 500 000, oracle
 * `check_t49plus.py`). Frais de T57 / T58 : 1 200 (export) ; en PYG, 60 000 (valeur de test passée à
 * la fonction `deposit` de l'oracle, `python -I -X utf8`, 2026-11-19 : capture 60 000, VOID
 * 1 440 000 avec capture partielle).
 */
export function depositOf(cc: CountryCase): { amount: bigint; fee: bigint } {
  const e = exponentOf(cc);
  if (e === 2)
    return { amount: (T57['capture'] ?? 0n) + (T57['void'] ?? 0n), fee: T57['capture'] ?? 0n };
  if (e === 0) return { amount: 1_500_000n, fee: 60_000n };
  throw new Error(`exposant sans vecteur de caution : ${String(e)}`);
}

/** Erreur d'une instruction, isolée par un point de sauvegarde (la transaction continue). */
export async function failure(
  c: Tx,
  text: string,
  values: readonly unknown[] = [],
): Promise<{ code: string | undefined; constraint: string | undefined } | null> {
  await c.query('SAVEPOINT rt_l2c');
  try {
    await c.query(text, values as unknown[]);
    await c.query('RELEASE SAVEPOINT rt_l2c');
    return null;
  } catch (error) {
    await c.query('ROLLBACK TO SAVEPOINT rt_l2c');
    const e = error as { code?: string; constraint?: string };
    return { code: e.code, constraint: e.constraint };
  }
}

/** Ouvre une transaction du travailleur `worker` à l'instant virtuel `now` ; rend le pid. */
export async function beginWorker(client: pg.Client, worker: string, now: string): Promise<number> {
  await client.query('BEGIN');
  await setSessionContext(client, { kind: 'WORKER', workerName: worker });
  await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [now]);
  const { rows } = await client.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid');
  return rows[0]?.pid ?? -1;
}

/** Attend que la session `pid` soit BLOQUÉE sur un verrou (pg_stat_activity) ; 10 s au plus. */
export async function waitUntilLocked(observer: pg.ClientBase, pid: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { rows } = await observer.query<{ wait: string | null }>(
      'SELECT wait_event_type AS wait FROM pg_catalog.pg_stat_activity WHERE pid = $1',
      [pid],
    );
    if (rows[0]?.wait === 'Lock') return;
    if (Date.now() > deadline) {
      throw new Error(`session ${String(pid)} jamais bloquée sur un verrou`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Deux connexions concurrentes et une d'observation, du même rôle ; toujours libérées. */
export async function withThree<T>(
  role: 'app_api' | 'app_worker',
  fn: (a: pg.Client, b: pg.Client, observer: pg.Client) => Promise<T>,
): Promise<T> {
  const a = await connectAs(role);
  const b = await connectAs(role);
  const observer = await connectAs(role);
  try {
    return await fn(a, b, observer);
  } finally {
    for (const client of [a, b]) {
      await client.query('ROLLBACK').catch(() => undefined);
      await releaseClient(client);
    }
    await releaseClient(observer);
  }
}

/** Seconde session élevée (TOTP) de `userId` (fixture 9650) : empreinte de son jeton. */
export async function newSessionHash(tx: Tx, userId: string): Promise<Buffer> {
  const hash = createHash('sha256').update(randomBytes(32)).digest();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [userId, hash]);
  return hash;
}
