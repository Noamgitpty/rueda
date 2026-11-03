import { fileURLToPath } from 'node:url';

/** Racine du paquet `packages/db`. */
export const PACKAGE_ROOT: string = fileURLToPath(new URL('..', import.meta.url));

/** Migrations de production, appliquées sous `migrator`, suivies dans `platform.schema_migration`. */
export const MIGRATIONS_DIR: string = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Migrations de test (horloge virtuelle) : jamais appliquées hors du harnais de tests. */
export const TEST_MIGRATIONS_DIR: string = fileURLToPath(
  new URL('../test-migrations/', import.meta.url),
);

/** Amorçage idempotent (rôles d'instance, droits sur la base), exécuté par un administrateur. */
export const BOOTSTRAP_DIR: string = fileURLToPath(new URL('../bootstrap/', import.meta.url));
