/**
 * Accès SQL minimal du module BUS : une interface structurelle (compatible avec `pg.ClientBase`)
 * et l'exécution d'une transaction **sous un contexte de travailleur** (17 §2.3 : `app.actor_kind
 * = 'WORKER'`, `app.worker_name`), posé par `set_config(…, true)` (équivalent de `SET LOCAL`, donc
 * effacé à la fin de la transaction). Aucun pilote importé ici : le module ne dépend pas de `pg`.
 */

export interface SqlResult<R> {
  readonly rows: R[];
  readonly rowCount: number | null;
}

/** Ce dont le module a besoin d'une connexion : `query` paramétrée (jamais de SQL construit). */
export interface SqlClient {
  query<R = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<SqlResult<R>>;
}

/** Connexion empruntée (pool) : rendue après la transaction. */
export interface LeasedSqlClient extends SqlClient {
  release(): void | Promise<void>;
}

/** Exécute `fn` dans une transaction, sous le contexte du travailleur `workerName`. */
export interface WorkerTransactions {
  run<T>(workerName: string, fn: (tx: SqlClient) => Promise<T>): Promise<T>;
}

/** Format de `app.worker_name` (0002) : sinon la RLS ne voit rien (fail-closed). */
export const WORKER_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;

export function assertWorkerName(name: string): void {
  if (!WORKER_NAME_PATTERN.test(name)) {
    throw new TypeError(`nom de travailleur invalide : ${JSON.stringify(name)}`);
  }
}

/**
 * Transactions de travailleur sur des connexions empruntées (`connect`), une connexion directe
 * par transaction (17 §1.3 point 2 bis : pas de `SET` de session à travers un pooler).
 * `BEGIN` ; contexte local ; `fn` ; `COMMIT` — ou `ROLLBACK` si `fn` échoue ; connexion rendue.
 */
export function workerTransactions(connect: () => Promise<LeasedSqlClient>): WorkerTransactions {
  return {
    async run<T>(workerName: string, fn: (tx: SqlClient) => Promise<T>): Promise<T> {
      assertWorkerName(workerName);
      const client = await connect();
      try {
        await client.query('BEGIN');
        try {
          await client.query(
            `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                    pg_catalog.set_config('app.worker_name', $1, true)`,
            [workerName],
          );
          const result = await fn(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      } finally {
        await client.release();
      }
    },
  };
}
