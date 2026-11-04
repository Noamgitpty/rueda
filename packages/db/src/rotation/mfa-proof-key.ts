/**
 * Rotation de la clé de preuve d'élévation MFA du staff (US-051, migration 0053, ADR-082 ;
 * runbook docs/ops/SECRET_ROTATION.md). Les gestes de l'exploitation, sous `migrator` (propriétaire
 * de `core.iam_mfa_proof_key`, seul à pouvoir appeler `core.iam_mfa_proof_key_rotate`) :
 *
 *   INSTALL  première clé (la console staff s'ouvre) ;
 *   STAGE    clé suivante : la base accepte alors l'ancienne ET la nouvelle ;
 *   PROMOTE  après le déploiement de l'API avec la nouvelle clé : l'ancienne est refusée ;
 *   ABORT    rotation abandonnée (la clé suivante est retirée).
 *
 * Variables (noms seulement, docs/ops/ENV_VARS.md) : `PGHOST`, `PGPORT`, `PGDATABASE`,
 * `RUEDA_DB_MIGRATOR_PASSWORD` ; pour INSTALL et STAGE, `RUEDA_STAFF_MFA_PROOF_KEY_NEXT` (la clé à
 * poser, hexadécimale, 32 à 64 octets, celle que recevra `RUEDA_STAFF_MFA_PROOF_KEY` de l'API).
 * Aucune clé n'est affichée : la sortie est l'état (`CURRENT`, `CURRENT+NEXT`).
 */
import pg from 'pg';
import { MIGRATOR_ROLE } from '../roles.ts';
import { redactError } from '../secrets.ts';

export const MFA_KEY_ACTIONS = ['INSTALL', 'STAGE', 'PROMOTE', 'ABORT'] as const;
export type MfaKeyAction = (typeof MFA_KEY_ACTIONS)[number];

/** Clé hexadécimale de 32 à 64 octets (même règle que l'API, mfa-proof.ts). */
export function parseMfaKey(raw: string | undefined): Buffer {
  const ok =
    raw !== undefined &&
    /^[0-9a-fA-F]+$/.test(raw) &&
    raw.length % 2 === 0 &&
    raw.length / 2 >= 32 &&
    raw.length / 2 <= 64;
  if (!ok) {
    throw new Error('RUEDA_STAFF_MFA_PROOF_KEY_NEXT : 32 à 64 octets en hexadécimal attendus');
  }
  return Buffer.from(raw, 'hex');
}

export function parseAction(raw: string | undefined): MfaKeyAction {
  const action = (raw ?? '').toUpperCase();
  if (!(MFA_KEY_ACTIONS as readonly string[]).includes(action)) {
    throw new Error(`action attendue : ${MFA_KEY_ACTIONS.join(', ')}`);
  }
  return action as MfaKeyAction;
}

export async function rotateMfaProofKey(
  env: Readonly<Record<string, string | undefined>>,
  rawAction: string | undefined,
): Promise<string> {
  const secrets = [env['RUEDA_DB_MIGRATOR_PASSWORD'], env['RUEDA_STAFF_MFA_PROOF_KEY_NEXT']].filter(
    (v): v is string => typeof v === 'string' && v !== '',
  );
  try {
    const action = parseAction(rawAction);
    const key =
      action === 'INSTALL' || action === 'STAGE'
        ? parseMfaKey(env['RUEDA_STAFF_MFA_PROOF_KEY_NEXT'])
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
        'SELECT core.iam_mfa_proof_key_rotate($1, $2) AS state',
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
