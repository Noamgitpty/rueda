/**
 * Vérification d'une base RESTAURÉE (US-051, ADR-082 ;
 * runbook docs/ops/BACKUP_RESTORE.md). Point d'entrée : cli.ts ; contrôles : verify.ts.
 *
 * Variables (noms seulement, docs/ops/ENV_VARS.md) : `PGHOST`, `PGPORT`, `PGDATABASE` (l'instance
 * RESTAURÉE, jamais celle en service), `RUEDA_ENV` (environnement déclaré attendu),
 * `RUEDA_DB_ADMIN_USER`, `RUEDA_DB_ADMIN_PASSWORD`, `RUEDA_DB_APP_API_PASSWORD`,
 * `RUEDA_DB_APP_WORKER_PASSWORD` (secrets du coffre, ceux du job de base), `RUEDA_RESTORE_REPORT`
 * (facultatif : fichier où écrire le rapport JSON). TLS : `PGSSLMODE`, `NODE_EXTRA_CA_CERTS`.
 *
 * Sortie : une ligne par contrôle, puis le rapport JSON (empreintes, aucun secret) ; code 1 si un
 * contrôle échoue. Tout message d'erreur est expurgé des secrets.
 */
import { writeFileSync } from 'node:fs';
import pg from 'pg';
import { redactError } from '../secrets.ts';
import { catalogFingerprint, dataFingerprint, verifyRestoredDatabase } from './verify.ts';

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const v = env[name];
  if (v === undefined || v === '') throw new Error(`${name} absente`);
  return v;
}

export async function main(env: Readonly<Record<string, string | undefined>>): Promise<boolean> {
  const secrets = [
    env['RUEDA_DB_ADMIN_PASSWORD'],
    env['RUEDA_DB_APP_API_PASSWORD'],
    env['RUEDA_DB_APP_WORKER_PASSWORD'],
  ].filter((v): v is string => typeof v === 'string' && v !== '');
  const clients: pg.Client[] = [];
  try {
    const host = required(env, 'PGHOST');
    const port = Number(env['PGPORT'] ?? '5432');
    const database = required(env, 'PGDATABASE');
    const adminUser = required(env, 'RUEDA_DB_ADMIN_USER');
    const environment = required(env, 'RUEDA_ENV');
    if (!IDENTIFIER.test(database) || !IDENTIFIER.test(adminUser)) {
      throw new Error('PGDATABASE ou RUEDA_DB_ADMIN_USER invalide');
    }
    const connect = async (user: string, password: string): Promise<pg.Client> => {
      const client = new pg.Client({
        host,
        port,
        database,
        user,
        password,
        application_name: 'rueda-restore-verify',
      });
      clients.push(client);
      await client.connect();
      return client;
    };
    const admin = await connect(adminUser, required(env, 'RUEDA_DB_ADMIN_PASSWORD'));
    const api = await connect('app_api', required(env, 'RUEDA_DB_APP_API_PASSWORD'));
    const worker = await connect('app_worker', required(env, 'RUEDA_DB_APP_WORKER_PASSWORD'));

    const checks = await verifyRestoredDatabase({ admin, api, worker }, { environment });
    for (const c of checks) {
      console.log(`[restore-verify] ${c.ok ? 'OK  ' : 'ÉCHEC'} ${c.name} : ${c.detail}`);
    }
    const report = {
      verifiedAt: new Date().toISOString(),
      environment,
      ok: checks.every((c) => c.ok),
      checks,
      catalog: await catalogFingerprint(admin),
      data: await dataFingerprint(admin),
    };
    console.log(`[restore-verify] ${JSON.stringify({ ok: report.ok, catalog: report.catalog })}`);
    const out = env['RUEDA_RESTORE_REPORT'];
    if (out !== undefined && out !== '') writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    return report.ok;
  } catch (error) {
    throw redactError(error, secrets);
  } finally {
    for (const c of clients) await c.end().catch(() => undefined);
  }
}
