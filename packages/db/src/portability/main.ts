/**
 * Outil d'export de portabilité (US-036 ; runbook docs/ops/PORTABILITY.md ; ADR-120).
 * Point d'entrée : `node packages/db/src/portability/cli.ts <commande>`.
 *
 * Commandes :
 *   - `prepare-target` : sur la NOUVELLE instance, avant `pg_restore` : amorçage (rôles, droits,
 *     extensions ; `bootstrap/`) et mots de passe des rôles de connexion (nouveaux secrets) ;
 *   - `export-keys` / `import-keys` : clés de sujet via le séquestre du fondateur (keys.ts) ;
 *   - `export-files` / `import-files` : objets du registre `file_asset` (files.ts).
 *
 * Variables (noms seulement, docs/ops/ENV_VARS.md) : `PGHOST`, `PGPORT`, `PGDATABASE`,
 * `RUEDA_DB_ADMIN_USER`, `RUEDA_DB_ADMIN_PASSWORD` (administration de l'instance) ;
 * `RUEDA_DB_*_PASSWORD` (`prepare-target`) ; `RUEDA_EXPORT_DIR` (dossier de l'export, 0700) ;
 * `RUEDA_ESCROW_PUBLIC_KEY_FILE` (export) et `RUEDA_ESCROW_PRIVATE_KEY_FILE` (import, clé du
 * fondateur) ; `RUEDA_KEY_WRAPPER` et `RUEDA_LOCAL_MASTER_KEY_FILE` (adaptateur du port
 * `KeyWrapper` de l'instance visée) ; `RUEDA_FILE_STORE` et `RUEDA_FILE_STORE_DIR` (adaptateur du
 * port `FileStore`) ; `RUEDA_ENV`.
 *
 * Aucune valeur secrète n'est affichée : la sortie ne donne que des comptes et des empreintes
 * publiques ; tout message d'erreur est expurgé des mots de passe.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import type { FileStore } from '../audit/file-asset.ts';
import type { KeyWrapper } from '../audit/key-wrapper.ts';
import { runBootstrap, setRolePasswords } from '../bootstrap.ts';
import { PASSWORD_VARIABLES } from '../deploy/setup.ts';
import { LOGIN_ROLES } from '../roles.ts';
import type { LoginRole } from '../roles.ts';
import { redactError } from '../secrets.ts';
import { EscrowOpener, EscrowSealer } from './escrow.ts';
import { exportFiles, importFiles, parseManifest } from './files.ts';
import { FsFileStore } from './fs-file-store.ts';
import {
  exportSubjectKeys,
  importSubjectKeys,
  parseKeys,
  PortabilityError,
  serializeKeys,
} from './keys.ts';
import { LocalKeyWrapper } from './local-key-wrapper.ts';

export const COMMANDS = [
  'prepare-target',
  'export-keys',
  'import-keys',
  'export-files',
  'import-files',
] as const;
export type Command = (typeof COMMANDS)[number];

export const KEYS_FILE = 'subject-keys.escrow.jsonl';
export const MANIFEST_FILE = 'files-manifest.json';
export const FILES_DIR = 'files';

type Env = Readonly<Record<string, string | undefined>>;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

function required(env: Env, name: string): string {
  const v = env[name];
  if (v === undefined || v === '') throw new PortabilityError(`${name} absente`);
  return v;
}

export function parseCommand(value: string | undefined): Command {
  if ((COMMANDS as readonly (string | undefined)[]).includes(value)) return value as Command;
  throw new PortabilityError(`commande attendue : ${COMMANDS.join(', ')}`);
}

/**
 * Adaptateur du port `KeyWrapper` de l'instance visée. Seul l'adaptateur `local` existe tant que
 * l'hébergeur n'est pas choisi (Q-007) : tout autre nom est refusé (fail-closed), jamais deviné.
 */
export function keyWrapperFromEnv(env: Env): KeyWrapper {
  const kind = env['RUEDA_KEY_WRAPPER'];
  if (kind === 'local')
    return LocalKeyWrapper.fromFile(required(env, 'RUEDA_LOCAL_MASTER_KEY_FILE'), env);
  throw new PortabilityError(
    `RUEDA_KEY_WRAPPER = ${kind === undefined ? 'absente' : JSON.stringify(kind)} : seul « local » ` +
      'existe ; l’adaptateur du KMS de l’hébergeur arrive avec son choix (Q-007, ADR-120)',
  );
}

/** Adaptateur du port `FileStore` de l'instance visée (même règle : `fs` seulement, Q-007). */
export function fileStoreFromEnv(env: Env): FileStore {
  const kind = env['RUEDA_FILE_STORE'];
  if (kind === 'fs') return new FsFileStore(required(env, 'RUEDA_FILE_STORE_DIR'));
  throw new PortabilityError(
    `RUEDA_FILE_STORE = ${kind === undefined ? 'absente' : JSON.stringify(kind)} : seul « fs » ` +
      'existe ; l’adaptateur du stockage objet de l’hébergeur arrive avec son choix (Q-007, ADR-120)',
  );
}

const exportDir = (env: Env): string => required(env, 'RUEDA_EXPORT_DIR');

/** Écrit un fichier de l'export : 0600, jamais par-dessus un fichier existant. */
function writeExport(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600, flag: 'wx' });
}

async function withAdmin<T>(env: Env, fn: (admin: pg.Client) => Promise<T>): Promise<T> {
  const database = required(env, 'PGDATABASE');
  const user = required(env, 'RUEDA_DB_ADMIN_USER');
  if (!IDENTIFIER.test(database) || !IDENTIFIER.test(user)) {
    throw new PortabilityError('PGDATABASE ou RUEDA_DB_ADMIN_USER invalide');
  }
  const admin = new pg.Client({
    host: required(env, 'PGHOST'),
    port: Number(env['PGPORT'] ?? '5432'),
    database,
    user,
    password: required(env, 'RUEDA_DB_ADMIN_PASSWORD'),
    application_name: 'rueda-portability',
  });
  await admin.connect();
  try {
    return await fn(admin);
  } finally {
    await admin.end().catch(() => undefined);
  }
}

const log = (line: string): void => {
  console.log(`[portabilite] ${line}`);
};

async function run(command: Command, env: Env): Promise<void> {
  switch (command) {
    case 'prepare-target': {
      const passwords = Object.fromEntries(
        LOGIN_ROLES.map((r) => [r, required(env, PASSWORD_VARIABLES[r])]),
      ) as Record<LoginRole, string>;
      await withAdmin(env, async (admin) => {
        await runBootstrap(admin);
        await setRolePasswords(admin, passwords);
      });
      log('instance cible amorcée (rôles, droits, extensions ; mots de passe posés)');
      return;
    }
    case 'export-keys': {
      const sealer = new EscrowSealer(readFileSync(required(env, 'RUEDA_ESCROW_PUBLIC_KEY_FILE')));
      const source = keyWrapperFromEnv(env);
      const { header, keys } = await withAdmin(env, (admin) =>
        exportSubjectKeys(admin, source, sealer),
      );
      writeExport(join(exportDir(env), KEYS_FILE), serializeKeys(header, keys));
      log(
        `clés exportées pour le séquestre ${header.escrow} : ${header.count} (${header.live} vivantes)`,
      );
      return;
    }
    case 'import-keys': {
      const opener = new EscrowOpener(readFileSync(required(env, 'RUEDA_ESCROW_PRIVATE_KEY_FILE')));
      const target = keyWrapperFromEnv(env);
      const exported = parseKeys(readFileSync(join(exportDir(env), KEYS_FILE), 'utf8'));
      const r = await withAdmin(env, (admin) => importSubjectKeys(admin, opener, target, exported));
      log(`clés importées sous ${target.keyId} : ${r.imported} (${r.live} vivantes)`);
      return;
    }
    case 'export-files': {
      const source = fileStoreFromEnv(env);
      const dir = join(exportDir(env), FILES_DIR);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const manifest = await withAdmin(env, (admin) =>
        exportFiles(admin, source, new FsFileStore(dir)),
      );
      writeExport(join(exportDir(env), MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
      log(`fichiers exportés : ${manifest.count}`);
      return;
    }
    case 'import-files': {
      const target = fileStoreFromEnv(env);
      const manifest = parseManifest(readFileSync(join(exportDir(env), MANIFEST_FILE), 'utf8'));
      const r = await importFiles(
        manifest,
        new FsFileStore(join(exportDir(env), FILES_DIR)),
        target,
      );
      log(`fichiers importés : ${r.imported}`);
      return;
    }
  }
}

export async function main(argv: readonly string[], env: Env): Promise<void> {
  const secrets = ['RUEDA_DB_ADMIN_PASSWORD', ...Object.values(PASSWORD_VARIABLES)]
    .map((n) => env[n])
    .filter((v): v is string => typeof v === 'string' && v !== '');
  try {
    await run(parseCommand(argv[0]), env);
  } catch (error) {
    throw redactError(error, secrets);
  }
}
