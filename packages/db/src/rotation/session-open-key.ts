/**
 * Provisionnement et rotation de la clé de preuve d'ouverture de session (US-410, migration 0185,
 * ADR-205 ; runbook docs/ops/SECRET_ROTATION.md § 3.4). Les gestes de l'exploitation, sous
 * `migrator` (propriétaire de `core.iam_session_open_key`, seul à pouvoir appeler
 * `core.iam_session_open_key_rotate`) :
 *
 *   INSTALL  première clé (avant le premier déploiement : sans clé, aucune session ne s'ouvre) ;
 *   STAGE    clé suivante : la base accepte alors l'ancienne ET la nouvelle (24 h au plus) ;
 *   PROMOTE  après le déploiement de l'API avec la nouvelle clé : l'ancienne est refusée ;
 *   ABORT    rotation abandonnée (la clé suivante est retirée).
 *
 * Variables (noms seulement, docs/ops/ENV_VARS.md) : `PGHOST`, `PGPORT`, `PGDATABASE`,
 * `RUEDA_DB_MIGRATOR_PASSWORD` ; pour INSTALL et STAGE, `RUEDA_SESSION_OPEN_KEY_NEXT` (la clé à
 * poser, hexadécimale, 32 à 64 octets, celle que recevra `RUEDA_SESSION_OPEN_KEY` de l'API).
 * Aucune clé n'est affichée : la sortie est l'état (`CURRENT`, `CURRENT+NEXT`).
 */
import pg from 'pg';
import { MIGRATOR_ROLE } from '../roles.ts';
import { redactError } from '../secrets.ts';
import { parseAction } from './mfa-proof-key.ts';

export const SESSION_OPEN_KEY_NEXT_VAR = 'RUEDA_SESSION_OPEN_KEY_NEXT';

/** Clé hexadécimale de 32 à 64 octets (même règle que l'API, session-open-key.ts). */
export function parseSessionOpenKey(raw: string | undefined): Buffer {
  const ok =
    raw !== undefined &&
    /^[0-9a-fA-F]+$/.test(raw) &&
    raw.length % 2 === 0 &&
    raw.length / 2 >= 32 &&
    raw.length / 2 <= 64;
  if (!ok) {
    throw new Error(`${SESSION_OPEN_KEY_NEXT_VAR} : 32 à 64 octets en hexadécimal attendus`);
  }
  return Buffer.from(raw, 'hex');
}

export async function rotateSessionOpenKey(
  env: Readonly<Record<string, string | undefined>>,
  rawAction: string | undefined,
): Promise<string> {
  const secrets = [env['RUEDA_DB_MIGRATOR_PASSWORD'], env['RUEDA_SESSION_OPEN_KEY_NEXT']].filter(
    (v): v is string => typeof v === 'string' && v !== '',
  );
  try {
    const action = parseAction(rawAction);
    const key =
      action === 'INSTALL' || action === 'STAGE'
        ? parseSessionOpenKey(env['RUEDA_SESSION_OPEN_KEY_NEXT'])
        : null;
    const password = env['RUEDA_DB_MIGRATOR_PASSWORD'];
    if (password === undefined || password === '') {
      throw new Error('RUEDA_DB_MIGRATOR_PASSWORD absente');
    }
    const client = new pg.Client({
      user: MIGRATOR_ROLE,
      password,
      application_name: 'rueda-rotation',
    });
    await client.connect();
    try {
      const { rows } = await client.query<{ state: string | null }>(
        'SELECT core.iam_session_open_key_rotate($1, $2) AS state',
        [action, key],
      );
      return rows[0]?.state ?? 'NONE';
    } finally {
      await client.end();
    }
  } catch (error) {
    throw redactError(error, secrets);
  }
}
