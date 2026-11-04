/**
 * Pool PostgreSQL de l'API et du travailleur, avec ROTATION SANS COUPURE du mot de passe du rôle
 * (US-051, ADR-082 ; runbook docs/ops/SECRET_ROTATION.md).
 *
 * PostgreSQL ne garde qu'un mot de passe par rôle, et ne le vérifie qu'à l'ouverture d'une
 * connexion. Pendant une rotation, chaque processus connaît donc DEUX valeurs : `PGPASSWORD`
 * (courante) et `RUEDA_PGPASSWORD_NEXT` (suivante, posée seulement le temps de la rotation). Une
 * nouvelle connexion essaie la valeur préférée ; si la base répond `28P01` (authentification
 * refusée), elle essaie l'autre UNE fois et la garde comme préférée. Les connexions déjà ouvertes
 * ne sont pas touchées par `ALTER ROLE … PASSWORD`. Ordre de la rotation (runbook) :
 *   1. déployer avec les deux valeurs (aucune connexion ne change : la courante est acceptée) ;
 *   2. le job de base pose la valeur suivante sur le rôle ; les nouvelles connexions basculent ;
 *   3. déployer avec la seule valeur suivante (devenue courante) ; l'ancienne est refusée.
 *
 * Aucune valeur n'est journalisée ni placée dans un message : seuls le rôle et le rang de la valeur
 * (`courante` / `suivante`) apparaissent. Sans `RUEDA_PGPASSWORD_NEXT`, comportement identique à
 * `new pg.Pool(config)` (libpq lit `PGPASSWORD`).
 */
import pg from 'pg';

/** Code SQLSTATE d'une authentification refusée (`invalid_password`). */
export const AUTH_FAILED = '28P01';

export type PasswordRank = 'courante' | 'suivante';

export interface PasswordCandidates {
  /** Valeurs dans l'ordre (courante, puis suivante) ; vide : libpq lit `PGPASSWORD` seul. */
  readonly values: readonly string[];
}

/** Lit les deux valeurs ; refuse une valeur suivante sans valeur courante (fail-closed). */
export function passwordCandidates(
  env: Readonly<Record<string, string | undefined>>,
): PasswordCandidates {
  const current = env['PGPASSWORD'] ?? '';
  const next = env['RUEDA_PGPASSWORD_NEXT'] ?? '';
  if (next === '') return { values: current === '' ? [] : [current] };
  if (current === '') {
    throw new Error('RUEDA_PGPASSWORD_NEXT posée sans PGPASSWORD : rotation incohérente');
  }
  if (/[\r\n]/.test(next)) throw new Error('RUEDA_PGPASSWORD_NEXT : une seule ligne attendue');
  return { values: next === current ? [current] : [current, next] };
}

export interface RotationLogEntry {
  readonly level: 'warn';
  readonly event: 'db.password.switched';
  readonly role: string;
  readonly to: PasswordRank;
}

const isAuthFailure = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === AUTH_FAILED;

type ConnectCallback = (err: Error | undefined, client?: pg.PoolClient, done?: () => void) => void;

/**
 * `pg.Pool` dont les NOUVELLES connexions essaient la valeur préférée puis, sur `28P01`, l'autre.
 * `query()` de pg-pool passe par `connect()` : les deux chemins sont couverts.
 */
export class RotatingPasswordPool extends pg.Pool {
  readonly #values: readonly string[];
  readonly #log: (entry: RotationLogEntry) => void;
  readonly #role: string;
  /** Rang préféré, partagé avec la fonction de mot de passe passée au constructeur parent. */
  readonly #state: { preferred: number };

  constructor(
    config: pg.PoolConfig,
    candidates: PasswordCandidates,
    log: (entry: RotationLogEntry) => void = (e) => {
      console.warn(JSON.stringify(e));
    },
  ) {
    const values = candidates.values;
    const state = { preferred: 0 };
    // une fonction : relue à chaque nouvelle connexion (la valeur préférée peut changer)
    super(
      values.length > 1 ? { ...config, password: () => values[state.preferred] ?? '' } : config,
    );
    this.#state = state;
    this.#values = values;
    this.#log = log;
    this.#role = config.user ?? process.env['PGUSER'] ?? '?';
  }

  /** Rang de la valeur actuellement préférée (tests, journal). */
  get preferredRank(): PasswordRank {
    return this.#state.preferred === 0 ? 'courante' : 'suivante';
  }

  /**
   * Connexion avec repli, sûre en concurrence (revue code US-051 n° 1) : le rang préféré n'est
   * basculé que s'il vaut ENCORE celui qu'on a essayé (comparer puis remplacer). Si une autre
   * connexion a déjà basculé pendant notre essai, on réessaie avec son choix, sans rebasculer :
   * des échecs simultanés ne ramènent jamais l'ancienne valeur. Au plus un essai par valeur pour
   * un même appel ; toutes refusées : l'erreur remonte.
   */
  async #connectWithFallback(): Promise<pg.PoolClient> {
    const triedRanks = new Set<number>();
    for (;;) {
      const tried = this.#state.preferred;
      triedRanks.add(tried);
      try {
        return await super.connect();
      } catch (error) {
        if (!isAuthFailure(error)) throw error;
        if (this.#state.preferred === tried) {
          const next = (tried + 1) % this.#values.length;
          if (triedRanks.has(next)) throw error;
          this.#state.preferred = next;
          this.#log({
            level: 'warn',
            event: 'db.password.switched',
            role: this.#role,
            to: this.preferredRank,
          });
        } else if (triedRanks.has(this.#state.preferred)) {
          throw error;
        }
      }
    }
  }

  override connect(): Promise<pg.PoolClient>;
  override connect(callback: ConnectCallback): void;
  override connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    if (this.#values.length < 2) {
      return callback === undefined ? super.connect() : super.connect(callback);
    }
    const pending = this.#connectWithFallback();
    if (callback === undefined) return pending;
    pending.then(
      (client) => {
        callback(undefined, client, () => {
          client.release();
        });
      },
      (error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)));
      },
    );
  }
}

/** Pool de production : deux valeurs pendant une rotation, sinon `pg.Pool` ordinaire. */
export function createAppPool(
  config: pg.PoolConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): pg.Pool {
  return new RotatingPasswordPool(config, passwordCandidates(env));
}
