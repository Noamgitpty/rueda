/**
 * Adaptateurs de PRODUCTION du port d'authentification. Aucune option ne permet d'y brancher un
 * FAKE (« inconnu = non ») : le FAKE n'est pas compilé dans l'image de production.
 *
 * La connexion PostgreSQL est fournie par l'appelant (`pg.Pool` configuré par les variables
 * standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` : aucun secret dans le code ni
 * dans une URL) ; `assertApiDatabaseRole` refuse de démarrer si elle n'est pas `app_api` sans
 * `SUPERUSER` ni `BYPASSRLS`.
 */
import type { IamAuthOptions } from './iam-auth.module.js';
import { PendingIdentityNotifier } from './notifier.js';
import { assertApiDatabaseRole, PgAuthStore } from './pg-auth-store.js';
import type { SqlExecutor } from './pg-auth-store.js';

export async function postgresIamAdapters(db: SqlExecutor): Promise<IamAuthOptions> {
  await assertApiDatabaseRole(db);
  return { store: new PgAuthStore(db), notifier: new PendingIdentityNotifier() };
}
