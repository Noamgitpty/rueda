/**
 * Preuve d'ouverture de session pour les TESTS (US-410, migration 0185, ADR-205). Exporté par
 * `@rueda/db/testing` seulement, jamais par `@rueda/db`.
 *
 * `core.iam_cmd_open_session` exige une preuve HMAC-SHA-256 v1 sous la clé installée en base. En
 * test, la clé est une valeur de TEST publique, posée par la fixture 9901 avec la même dérivation
 * que `TEST_SESSION_OPEN_KEY` ci-dessous : jamais un secret. La preuve est recalculée ici par
 * node:crypto, oracle indépendant du HMAC écrit en SQL (vecteurs RFC 4231 : l0-iam-staff-mfa).
 *
 * Message v1 : UTF-8('rueda-session-open-v1') ‖ UUID de session (16) ‖ UUID du compte (16) ‖
 * empreinte du jeton (32) ‖ durée (int4 BE) ‖ instant d'émission en ms (int8 BE), l'instant étant
 * celui de `platform.now()` (horloge virtuelle des tests comprise).
 */
import { createHash, createHmac } from 'node:crypto';
import type pg from 'pg';

/** Clé de TEST (dérivée d'une chaîne publique, comme la fixture 9901). */
export const TEST_SESSION_OPEN_KEY: Buffer = createHash('sha256')
  .update('rueda-test-session-open-key (valeur de test publique)', 'utf8')
  .digest();

const uuidBytes = (id: string): Buffer => Buffer.from(id.replace(/-/g, ''), 'hex');

export interface SessionOpenFields {
  readonly sessionId: string;
  readonly userId: string;
  readonly tokenHash: Buffer;
  readonly ttlS: number;
  readonly issuedAtMs: bigint;
}

/** Preuve v1 (ADR-205) sous `key` (par défaut, la clé de test installée). */
export function sessionOpenProof(
  f: SessionOpenFields,
  key: Buffer = TEST_SESSION_OPEN_KEY,
): Buffer {
  const ttl = Buffer.alloc(4);
  ttl.writeInt32BE(f.ttlS);
  const at = Buffer.alloc(8);
  at.writeBigInt64BE(f.issuedAtMs);
  return createHmac('sha256', key)
    .update(
      Buffer.concat([
        Buffer.from('rueda-session-open-v1', 'utf8'),
        uuidBytes(f.sessionId),
        uuidBytes(f.userId),
        f.tokenHash,
        ttl,
        at,
      ]),
    )
    .digest();
}

/** Instant de la base (`platform.now()`, en ms) : celui que signe une ouverture. */
export async function databaseNowMs(client: pg.ClientBase): Promise<bigint> {
  const { rows } = await client.query<{ ms: string }>(
    'SELECT (floor(EXTRACT(EPOCH FROM platform.now()) * 1000))::int8::text AS ms',
  );
  const ms = rows[0]?.ms;
  if (ms === undefined) throw new Error('platform.now() illisible');
  return BigInt(ms);
}

/**
 * Les deux derniers arguments de `core.iam_cmd_open_session` (instant, preuve) pour ces champs,
 * signés à l'instant courant de la base sous `key`. À placer en $8 et $9.
 */
export async function sessionOpenArgs(
  client: pg.ClientBase,
  sessionId: string,
  userId: string,
  tokenHash: Buffer,
  ttlS: number,
  key: Buffer = TEST_SESSION_OPEN_KEY,
): Promise<[string, Buffer]> {
  const issuedAtMs = await databaseNowMs(client);
  return [
    issuedAtMs.toString(),
    sessionOpenProof({ sessionId, userId, tokenHash, ttlS, issuedAtMs }, key),
  ];
}

/**
 * Ouverture signée par la VRAIE commande (sous le rôle du client, app_api en pratique) : rend
 * `expires_at` (NULL pour un compte fermé ou banni). Les erreurs de la base remontent telles quelles.
 */
export async function openSignedSession(
  client: pg.ClientBase,
  input: {
    readonly sessionId: string;
    readonly userId: string;
    readonly tokenHash: Buffer;
    readonly ttlS: number;
    readonly ip?: string | null;
    readonly userAgent?: string | null;
    readonly key?: Buffer;
  },
): Promise<Date | null> {
  const [at, proof] = await sessionOpenArgs(
    client,
    input.sessionId,
    input.userId,
    input.tokenHash,
    input.ttlS,
    input.key,
  );
  const { rows } = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', $5, $6, $7, $8) AS expires_at`,
    [
      input.sessionId,
      input.userId,
      input.tokenHash,
      input.ttlS,
      input.ip ?? null,
      input.userAgent ?? null,
      at,
      proof,
    ],
  );
  return rows[0]?.expires_at ?? null;
}

/**
 * Paramètres d'un appel `core.iam_cmd_open_session($1, $2, $3, …, $n+1, $n+2)` : rend `params`
 * suivi de l'instant et de la preuve, signés sur les VALEURS déjà calculées de `params[0]`
 * (session), `params[1]` (compte), `params[2]` (empreinte) et de la durée (`params[3]` par défaut,
 * ou `ttlS` quand la durée est écrite dans la requête).
 */
export async function signedOpenParams(
  client: pg.ClientBase,
  params: readonly unknown[],
  ttlS?: number,
): Promise<unknown[]> {
  const [sessionId, userId, tokenHash] = params;
  const ttl = ttlS ?? params[3];
  if (typeof sessionId !== 'string' || typeof userId !== 'string' || !Buffer.isBuffer(tokenHash)) {
    throw new Error('signedOpenParams : session, compte (UUID) et empreinte (Buffer) attendus');
  }
  if (typeof ttl !== 'number') throw new Error('signedOpenParams : durée attendue');
  return [...params, ...(await sessionOpenArgs(client, sessionId, userId, tokenHash, ttl))];
}
