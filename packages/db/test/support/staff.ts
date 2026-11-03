/**
 * Aides des preuves du staff et de la console (US-012) : comptes de staff, enrôlement TOTP et
 * élévation par les VRAIES commandes `core.iam_staff_*` sous app_api.
 *
 * La base ne voit jamais le secret TOTP ni le code : elle juge le pas (`step`) et la preuve
 * HMAC-SHA-256 (ADR-062). La preuve attendue est recalculée ici par `node:crypto` (oracle
 * indépendant du HMAC écrit en SQL), avec une clé de TEST publique : jamais un secret.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { newToken, phcArgon2id, SESSION_TTL_S } from './iam.ts';

export const uuid = (): string => randomUUID();

/** Clé de preuve de TEST (dérivée d'une chaîne publique ; la production installe un secret géré). */
export const TEST_PROOF_KEY = createHash('sha256')
  .update('rueda-test-mfa-proof-key (valeur de test publique)', 'utf8')
  .digest();

export async function installTestProofKey(client: pg.ClientBase): Promise<void> {
  await client.query('SELECT test_fixture.iam_install_mfa_proof_key($1)', [TEST_PROOF_KEY]);
}

/** Pas TOTP courant (RFC 6238, 30 s). */
export const stepNow = (): number => Math.floor(Date.now() / 1000 / 30);

const uuidBytes = (id: string): Buffer => Buffer.from(id.replace(/-/g, ''), 'hex');

/** Preuve v1 (ADR-062) : HMAC-SHA-256(clé, « rueda-staff-mfa-v1 » ‖ empreinte ‖ facteur ‖ pas). */
export function proof(tokenHash: Buffer, factorId: string, step: number, key = TEST_PROOF_KEY) {
  const s = Buffer.alloc(8);
  s.writeBigInt64BE(BigInt(step));
  return createHmac('sha256', key)
    .update(
      Buffer.concat([Buffer.from('rueda-staff-mfa-v1', 'utf8'), tokenHash, uuidBytes(factorId), s]),
    )
    .digest();
}

export interface StaffAccount {
  readonly userId: string;
  readonly factorId: string;
  readonly code: string;
  readonly codeHash: Buffer;
}

/**
 * Compte de staff ACTIVE avec un rôle et, sauf `withFactor: false`, un facteur TOTP EN ATTENTE
 * (procédure d'amorçage hors application, fixture 9650). Validé (autocommit).
 */
export async function createStaff(
  client: pg.ClientBase,
  role: string | null,
  scope: readonly string[],
  options: { withFactor?: boolean } = {},
): Promise<StaffAccount> {
  const userId = uuid();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register($1, $2, $3, 'Staff', 'Test', 'es', $4, $5, 86400, NULL) AS ok`,
    [userId, `staff-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32)],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [userId]);
  if (role !== null) {
    await client.query(
      `SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`,
      [uuid(), userId, role, scope],
    );
  }
  const factorId = uuid();
  const code = randomBytes(9).toString('base64url');
  const codeHash = createHash('sha256').update(code, 'utf8').digest();
  if (options.withFactor !== false) {
    await client.query(
      `SELECT test_fixture.iam_insert_pending_totp($1, $2, 'fake-vault:test-secret', $3, 86400)`,
      [factorId, userId, codeHash],
    );
  }
  return { userId, factorId, code, codeHash };
}

/** Session ouverte par la vraie commande (niveau NONE) ; rend son empreinte. */
export async function login(client: pg.ClientBase, userId: string): Promise<Buffer> {
  const t = newToken();
  const { rows } = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

export async function begin(
  client: pg.ClientBase,
  hash: Buffer,
): Promise<{ outcome: string; factor_id: string | null }> {
  const { rows } = await client.query<{ outcome: string; factor_id: string | null }>(
    'SELECT outcome, factor_id FROM core.iam_staff_cmd_begin($1)',
    [hash],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('begin sans ligne');
  return row;
}

/** Tentative MFA comptée par la base avant de rendre la référence du secret. */
export async function attempt(
  client: pg.ClientBase,
  hash: Buffer,
): Promise<{ outcome: string; secret_ref: string | null }> {
  const { rows } = await client.query<{ outcome: string; secret_ref: string | null }>(
    'SELECT outcome, secret_ref FROM core.iam_staff_cmd_mfa_attempt($1)',
    [hash],
  );
  return rows[0] ?? { outcome: '', secret_ref: null };
}

export async function elevate(
  client: pg.ClientBase,
  hash: Buffer,
  factorId: string,
  step = stepNow(),
  p: Buffer | null = proof(hash, factorId, step),
): Promise<string> {
  const { rows } = await client.query<{ r: string }>(
    'SELECT core.iam_staff_cmd_elevate($1, $2, $3, $4) AS r',
    [hash, factorId, step, p],
  );
  return rows[0]?.r ?? '';
}

/**
 * Staff complet : compte, rôle, enrôlement (code remis hors bande, puis élévation) ; rend
 * l'empreinte de la session ÉLEVÉE. Enrôlement au pas courant : une seconde élévation du même
 * compte doit présenter un pas STRICTEMENT plus grand (anti-rejeu), par exemple `stepNow() + 1`.
 */
export async function elevatedStaff(
  client: pg.ClientBase,
  role: string,
  scope: readonly string[],
): Promise<StaffAccount & { readonly hash: Buffer }> {
  const s = await createStaff(client, role, scope);
  const hash = await login(client, s.userId);
  const reveal = await client.query<{ outcome: string }>(
    'SELECT outcome FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
    [hash, s.codeHash],
  );
  if (reveal.rows[0]?.outcome !== 'OK') throw new Error('enrôlement refusé');
  const r = await elevate(client, hash, s.factorId, stepNow());
  if (r !== 'ENROLLED') throw new Error(`élévation refusée : ${r}`);
  return { ...s, hash };
}

export interface AuditRow {
  readonly id: string;
  readonly actor_role: string;
  readonly action_code: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly reason: string | null;
  readonly request_id: string | null;
}

export async function auditOf(client: pg.ClientBase, actor: string): Promise<AuditRow[]> {
  const { rows } = await client.query<AuditRow>(
    'SELECT * FROM test_fixture.audit_rows_of_actor($1)',
    [actor],
  );
  return rows;
}
