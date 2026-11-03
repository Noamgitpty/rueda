/**
 * Aides des tests IAM (US-010) : jetons, hachages, appels des commandes core.iam_* sous app_api.
 *
 * Les valeurs attendues viennent de 17 §3.2.1, §6.6 et de 16 ACC-001, jamais de ce fichier. Les
 * hachages argon2id utilisés ici sont des chaînes au FORMAT PHC (la base ne vérifie que le
 * format ; le calcul argon2id est fait et testé par l'API, apps/api).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';

export const uuid = (): string => randomUUID();

/** Jeton opaque de 32 octets (base64url) et son SHA-256 (ce que la base stocke). */
export function newToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest() };
}

/** Chaîne PHC argon2id bien formée (sel et empreinte aléatoires). */
export function phcArgon2id(): string {
  const b64 = (n: number) => randomBytes(n).toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=65536,t=3,p=1$${b64(16)}$${b64(32)}`;
}

/** 24 h (16 ACC-001, PROPOSÉ) et 14 j (ADR-052, PROPOSÉ), en secondes. */
export const VERIFICATION_TTL_S = 86_400;
export const SESSION_TTL_S = 1_209_600;

export interface Registered {
  readonly userId: string;
  readonly email: string;
  readonly verification: { token: string; hash: Buffer };
}

export async function register(
  client: pg.ClientBase,
  overrides: { email?: string; passwordHash?: string; userId?: string } = {},
): Promise<{ created: boolean } & Registered> {
  const userId = overrides.userId ?? uuid();
  const email = overrides.email ?? `u-${userId}@example.test`;
  const verification = newToken();
  const { rows } = await client.query<{ created: boolean }>(
    `SELECT core.iam_cmd_register($1, $2, $3, 'Ana', 'Pérez', 'en', $4, $5, $6, '203.0.113.7') AS created`,
    [
      userId,
      email,
      overrides.passwordHash ?? phcArgon2id(),
      uuid(),
      verification.hash,
      VERIFICATION_TTL_S,
    ],
  );
  return { created: rows[0]?.created === true, userId, email, verification };
}

export async function openSession(
  client: pg.ClientBase,
  userId: string,
  options: { ttlS?: number } = {},
): Promise<{ token: string; hash: Buffer; expiresAt: Date | null }> {
  const t = newToken();
  const { rows } = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', '203.0.113.7', 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, options.ttlS ?? SESSION_TTL_S],
  );
  return { ...t, expiresAt: rows[0]?.expires_at ?? null };
}

export async function resolve(
  client: pg.ClientBase,
  hash: Buffer,
): Promise<
  {
    session_id: string;
    user_id: string;
    mfa_level: string;
    expires_at: Date;
    email_verified: boolean;
  }[]
> {
  const { rows } = await client.query<{
    session_id: string;
    user_id: string;
    mfa_level: string;
    expires_at: Date;
    email_verified: boolean;
  }>('SELECT * FROM core.iam_session_resolve($1)', [hash]);
  return rows;
}

/** Pose l'horloge virtuelle (SET LOCAL) dans la transaction courante. */
export async function setVirtualNow(client: pg.ClientBase, iso: string): Promise<void> {
  await client.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [iso]);
}

/** Instant ISO décalé de `seconds` secondes. */
export const plus = (iso: string, seconds: number): string =>
  new Date(Date.parse(iso) + seconds * 1000).toISOString();
