/**
 * `node packages/db/src/restore/release-cli.ts` : levée de la garde de reprise (US-402, ADR-206 ;
 * runbook docs/ops/BACKUP_RESTORE.md « Reprise gardée »). Outil d'exploitation, sous le rôle
 * d'administration de l'instance restaurée (superutilisateur local, `migrator` en cloud) ; jamais
 * sous un rôle applicatif.
 *
 * Variables (noms seulement, docs/ops/ENV_VARS.md) : `PGHOST`, `PGPORT`, `PGDATABASE`,
 * `RUEDA_DB_ADMIN_USER`, `RUEDA_DB_ADMIN_PASSWORD` ; `RUEDA_RECOVERY_RESTORED_TO` (instant T
 * restauré, ISO 8601) ; `RUEDA_RECOVERY_RECONCILED` (`yes` = rapprochement avec le PSP attesté par
 * l'opérateur) ; `RUEDA_PSP_IDEMPOTENCY_WINDOW_S` (fenêtre W du PSP, hypothèse H-IDEM ; absente =
 * inconnue) ; `RUEDA_RECOVERY_PSP_LISTING` (`yes` = relevé complet du PSP depuis T rapproché) ;
 * `RUEDA_RECOVERY_NOTE` (note de levée, 3 à 500 caractères, sans donnée personnelle).
 *
 * Sortie : l'inventaire de ce qui sera repris, la décision ; code 1 si la levée est refusée.
 */
import pg from 'pg';
import { redactError } from '../secrets.ts';
import { inFlightInventory, releaseDecision } from './recovery.ts';

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/;

function required(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const v = env[name];
  if (v === undefined || v === '') throw new Error(`${name} absente`);
  return v;
}

async function release(env: Readonly<Record<string, string | undefined>>): Promise<boolean> {
  const password = required(env, 'RUEDA_DB_ADMIN_PASSWORD');
  const user = required(env, 'RUEDA_DB_ADMIN_USER');
  const database = required(env, 'PGDATABASE');
  if (!IDENTIFIER.test(user) || !IDENTIFIER.test(database)) {
    throw new Error('PGDATABASE ou RUEDA_DB_ADMIN_USER invalide');
  }
  const restoredToMs = Date.parse(required(env, 'RUEDA_RECOVERY_RESTORED_TO'));
  if (!Number.isFinite(restoredToMs)) throw new Error('RUEDA_RECOVERY_RESTORED_TO illisible');
  const note = required(env, 'RUEDA_RECOVERY_NOTE');
  const windowText = env['RUEDA_PSP_IDEMPOTENCY_WINDOW_S'];
  const client = new pg.Client({
    host: required(env, 'PGHOST'),
    port: Number(env['PGPORT'] ?? '5432'),
    database,
    user,
    password,
    application_name: 'rueda-recovery-release',
  });
  try {
    await client.connect();
    for (const l of await inFlightInventory(client)) {
      console.log(`[reprise] à reprendre : ${l.category} ${l.key} = ${String(l.count)}`);
    }
    const now = await client.query<{ now: Date }>('SELECT platform.now() AS now');
    const decision = releaseDecision({
      restoredToMs,
      nowMs: (now.rows[0]?.now ?? new Date(Number.NaN)).getTime(),
      idempotencyWindowS: windowText === undefined || windowText === '' ? null : Number(windowText),
      reconciledWithPsp: env['RUEDA_RECOVERY_RECONCILED'] === 'yes',
      pspListingSinceRestore: env['RUEDA_RECOVERY_PSP_LISTING'] === 'yes',
    });
    console.log(`[reprise] décision : ${JSON.stringify(decision)}`);
    if (!decision.allowed) return false;
    const r = await client.query<{ n: number }>('SELECT platform.recovery_release($1) AS n', [
      note,
    ]);
    console.log(`[reprise] garde levée (${String(r.rows[0]?.n ?? 0)} garde(s) explicite(s))`);
    return true;
  } catch (error) {
    throw redactError(error, [password]);
  } finally {
    await client.end().catch(() => undefined);
  }
}

release(process.env).then(
  (ok) => {
    if (!ok) process.exitCode = 1;
  },
  (error: unknown) => {
    console.error(`[reprise] échec : ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
