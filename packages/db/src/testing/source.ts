/**
 * Source de la base d'administration du banc (ADR-043) : **une seule fonction** choisit entre
 * le PostgreSQL natif local (repli P-07) et Testcontainers `postgres:16` (CI, fait foi).
 *
 * Variables (noms seulement, docs/ops/ENV_VARS.md) :
 * - `RUEDA_PG_ADMIN_URL` : URL d'administration SANS mot de passe
 *   (ex. `postgres://postgres@localhost:5432/postgres`) ;
 * - `RUEDA_PG_SUPERUSER_PASSWORD_FILE` : chemin d'un fichier hors dépôt contenant le mot de passe ;
 * - `RUEDA_PG_TESTCONTAINERS=1` : à défaut d'URL, démarre `postgres:16` par Testcontainers.
 *
 * Le mot de passe n'est jamais affiché ni journalisé ; il ne figure dans aucune URL.
 */
import { readFileSync } from 'node:fs';
import { maskConnectionString } from '../secrets.ts';

export interface ConnectionTarget {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
}

export interface AdminSource {
  /** `native` (local, P-07) ou `testcontainers` (CI). */
  readonly kind: 'native' | 'testcontainers';
  readonly admin: ConnectionTarget;
  /** Libellé affichable (sans secret). */
  readonly label: string;
  /** Arrête le conteneur éventuel. */
  stop(): Promise<void>;
}

export const POSTGRES_IMAGE = 'postgres:16';

export type BenchEnv = Readonly<Record<string, string | undefined>>;

/** Analyse l'URL d'administration ; refuse une URL qui porte un mot de passe. */
export function parseAdminUrl(raw: string): Omit<ConnectionTarget, 'password'> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`RUEDA_PG_ADMIN_URL invalide : ${maskConnectionString(raw)}`);
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('RUEDA_PG_ADMIN_URL : schéma postgres:// attendu');
  }
  if (url.password !== '') {
    throw new Error(
      `RUEDA_PG_ADMIN_URL ne doit pas contenir de mot de passe (${maskConnectionString(raw)}) : ` +
        'utiliser RUEDA_PG_SUPERUSER_PASSWORD_FILE',
    );
  }
  const user = decodeURIComponent(url.username);
  if (user === '') throw new Error('RUEDA_PG_ADMIN_URL : utilisateur manquant');
  return {
    host: url.hostname.replace(/^\[(.*)\]$/, '$1') || 'localhost',
    port: url.port === '' ? 5432 : Number(url.port),
    user,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres',
  };
}

/** Lit le mot de passe (fin de ligne finale retirée). Le contenu n'apparaît dans aucune erreur. */
export function readPasswordFile(path: string): string {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'erreur';
    // L'erreur d'origine (fs) ne porte que le chemin, jamais le contenu.
    throw new Error(`RUEDA_PG_SUPERUSER_PASSWORD_FILE illisible (${code}) : ${path}`, {
      cause: error,
    });
  }
  const password = content.replace(/^\uFEFF/, '').replace(/\r?\n$/, '');
  if (password.length === 0 || /[\r\n]/.test(password)) {
    throw new Error(
      `RUEDA_PG_SUPERUSER_PASSWORD_FILE : une seule ligne non vide attendue (${path})`,
    );
  }
  return password;
}

/** Choisit et prépare la source de la base d'administration. */
export async function resolveAdminSource(env: BenchEnv = process.env): Promise<AdminSource> {
  const url = env['RUEDA_PG_ADMIN_URL'];
  if (url !== undefined && url !== '') {
    const passwordFile = env['RUEDA_PG_SUPERUSER_PASSWORD_FILE'];
    if (passwordFile === undefined || passwordFile === '') {
      throw new Error('RUEDA_PG_ADMIN_URL est posée mais RUEDA_PG_SUPERUSER_PASSWORD_FILE manque');
    }
    const target = parseAdminUrl(url);
    return {
      kind: 'native',
      admin: { ...target, password: readPasswordFile(passwordFile) },
      label: `natif ${target.user}@${target.host}:${target.port}/${target.database}`,
      stop: async () => undefined,
    };
  }
  if (env['RUEDA_PG_TESTCONTAINERS'] === '1') {
    // Import dynamique : Testcontainers (et Docker) ne sont requis qu'en CI.
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const { randomPassword } = await import('../scram.ts');
    const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase('postgres')
      .withUsername('postgres')
      .withPassword(randomPassword())
      // L0-02 (US-007) : 100 poses concurrentes, chacune sur sa connexion directe ; le défaut de
      // l'image (100) n'y suffit pas. L0-02 tourne seul, après les autres fichiers L0
      // (vitest.l0.config.ts, ADR-056 « Budget de connexions du banc »).
      .withCommand(['postgres', '-c', 'max_connections=200'])
      .start();
    return {
      kind: 'testcontainers',
      admin: {
        host: container.getHost(),
        port: container.getPort(),
        user: container.getUsername(),
        password: container.getPassword(),
        database: container.getDatabase(),
      },
      label: `testcontainers ${POSTGRES_IMAGE} ${container.getHost()}:${container.getPort()}`,
      stop: async () => {
        await container.stop();
      },
    };
  }
  throw new Error(
    'banc PostgreSQL non configuré : poser RUEDA_PG_ADMIN_URL et RUEDA_PG_SUPERUSER_PASSWORD_FILE ' +
      '(PostgreSQL natif, P-07), ou RUEDA_PG_TESTCONTAINERS=1 (CI). Voir packages/db/README.md.',
  );
}
