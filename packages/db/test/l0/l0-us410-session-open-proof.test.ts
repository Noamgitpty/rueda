/**
 * US-410 — ouverture de session sur PREUVE SIGNÉE (F-RLS-03, EXC-003 ; migration 0185, ADR-205),
 * sous les rôles de production (assertion L0-05 par connectAs / withRole), en PA et en PY.
 *
 * Attendus (BOARD, fiche US-410 ; pré-mortem du lot 4, L4-PM-01 à 04, RT-L4-S01 à S04) :
 * - témoin : une preuve v1 valable sous la clé installée ouvre la session, résolue ensuite ;
 * - refus 42501 et AUCUNE session pour : preuve absente, tronquée, sous une autre clé, ou dont un
 *   champ (session, compte, empreinte, durée, instant) diffère de l'appel ; preuve périmée (plus
 *   de 60 s) ou émise dans le futur (plus de 5 s) ; rejeu (même session ou même jeton), y compris
 *   CONCURRENT (deux connexions : le second attend le premier, puis est refusé) ;
 * - clé absente : aucune session (échec fermé), y compris dans la base de PRODUCTION du banc ;
 * - rotation : STAGE => ancienne et nouvelle acceptées ; PROMOTE => l'ancienne refusée ; sans
 *   PROMOTE, l'ancienne refusée 24 h après STAGE ; ABORT => la nouvelle refusée ; app_api
 *   n'appelle pas la fonction de rotation ;
 * - la clé est introuvable sous app_api, app_worker et app_anon : aucun droit sur la table, aucun
 *   réglage, aucune fonction exécutable qui la lise hors l'ouverture elle-même (qui rend une date).
 * Les preuves sont recalculées par node:crypto (src/testing/session-open.ts), clés de TEST
 * publiques ; jamais le code testé comme oracle.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  connectAs,
  databaseNowMs,
  releaseClient,
  sessionOpenProof,
  TEST_SESSION_OPEN_KEY,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { backendPid, waitUntilBlocked } from '../support/concurrency.ts';
import { plus, setVirtualNow } from '../support/iam.ts';
import { account } from '../support/rls.ts';

const OPEN = `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'l0-us410', $5, $6) AS expires_at`;
const TTL_S = 3600;
const OTHER_KEY = createHash('sha256')
  .update('rueda-test-session-open-key-us410 (autre clé de test publique)', 'utf8')
  .digest();
const NEW_KEY = createHash('sha256')
  .update('rueda-test-session-open-key-us410 (nouvelle clé de test publique)', 'utf8')
  .digest();

interface Call {
  readonly sessionId: string;
  readonly userId: string;
  readonly tokenHash: Buffer;
  readonly ttlS: number;
  readonly issuedAtMs: bigint;
  readonly proof: Buffer | null;
}

interface Outcome {
  readonly code: string;
  readonly message: string;
}

/** Appel signé à l'instant de la base (décalé de `skewMs`), sous la clé de test ou `key`. */
async function signed(
  tx: pg.ClientBase,
  userId: string,
  options: { key?: Buffer; skewMs?: bigint } = {},
): Promise<Call> {
  const issuedAtMs = (await databaseNowMs(tx)) + (options.skewMs ?? 0n);
  const f = {
    sessionId: randomUUID(),
    userId,
    tokenHash: randomBytes(32),
    ttlS: TTL_S,
    issuedAtMs,
  };
  return { ...f, proof: sessionOpenProof(f, options.key ?? TEST_SESSION_OPEN_KEY) };
}

/** Exécute l'ouverture dans un point de sauvegarde : rend « OK » ou le code et le message. */
async function open(tx: pg.ClientBase, c: Call): Promise<Outcome> {
  await tx.query('SAVEPOINT us410');
  try {
    const r = await tx.query<{ expires_at: Date | null }>(OPEN, [
      c.sessionId,
      c.userId,
      c.tokenHash,
      c.ttlS,
      c.issuedAtMs.toString(),
      c.proof,
    ]);
    await tx.query('RELEASE SAVEPOINT us410');
    return { code: r.rows[0]?.expires_at instanceof Date ? 'OK' : 'NULL', message: '' };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT us410');
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? '?', message: e.message ?? '' };
  }
}

async function resolved(tx: pg.ClientBase, hash: Buffer): Promise<string | null> {
  const { rows } = await tx.query<{ user_id: string }>(
    'SELECT user_id FROM core.iam_session_resolve($1)',
    [hash],
  );
  return rows[0]?.user_id ?? null;
}

const rotate = async (tx: pg.ClientBase, action: string, key: Buffer | null): Promise<string> => {
  const { rows } = await tx.query<{ r: string | null }>(
    'SELECT test_fixture.us410_rotate_session_open_key($1, $2) AS r',
    [action, key],
  );
  return rows[0]?.r ?? '';
};

const slots = async (tx: pg.ClientBase): Promise<number[]> => {
  const { rows } = await tx.query<{ s: number[] }>(
    'SELECT test_fixture.us410_session_open_key_slots() AS s',
  );
  return rows[0]?.s ?? [];
};

const refused = (message: string): Outcome => ({ code: '42501', message });

describe.each(COUNTRIES.map((c) => [c.country] as const))(
  'US-410 — ouverture signée, compte de %s (app_api)',
  (country) => {
    it(`témoin : preuve valable => session ouverte et résolue (${country})`, async () => {
      await withRole('app_api', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          const userId = await account(tx);
          const c = await signed(tx, userId);
          expect(await open(tx, c)).toEqual({ code: 'OK', message: '' });
          expect(await resolved(tx, c.tokenHash)).toBe(userId);
        });
      });
    });

    it(`preuve absente, tronquée, sous une autre clé ou d’un champ modifié : refus, aucune session (${country})`, async () => {
      await withRole('app_api', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          const userId = await account(tx);
          const victim = await account(tx);
          const base = await signed(tx, userId);
          const forged = await signed(tx, userId, { key: OTHER_KEY });
          const cases: [string, Call][] = [
            ['sans preuve', { ...base, proof: null }],
            ['preuve tronquée', { ...base, proof: (base.proof as Buffer).subarray(0, 31) }],
            [
              'preuve allongée',
              { ...base, proof: Buffer.concat([base.proof as Buffer, Buffer.alloc(1)]) },
            ],
            ['preuve au hasard', { ...base, proof: randomBytes(32) }],
            ['autre clé', forged],
            ['autre compte', { ...base, userId: victim }],
            ['autre session', { ...base, sessionId: randomUUID() }],
            ['autre jeton', { ...base, tokenHash: randomBytes(32) }],
            ['autre durée', { ...base, ttlS: TTL_S + 1 }],
            ['autre instant', { ...base, issuedAtMs: base.issuedAtMs - 1n }],
          ];
          for (const [label, c] of cases) {
            expect(await open(tx, c), label).toEqual(refused('session_proof_refused'));
            expect(await resolved(tx, c.tokenHash), label).toBeNull();
          }
          // témoin : la preuve de base, intacte, est acceptée
          expect(await open(tx, base)).toEqual({ code: 'OK', message: '' });
        });
      });
    });

    it(`preuve périmée (61 s) ou du futur (6 s) : refus ; 59 s : acceptée (${country})`, async () => {
      await withRole('app_api', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          const userId = await account(tx);
          const old = await signed(tx, userId, { skewMs: -61_000n });
          expect(await open(tx, old)).toEqual(refused('session_proof_expired'));
          expect(await resolved(tx, old.tokenHash)).toBeNull();
          const future = await signed(tx, userId, { skewMs: 6_000n });
          expect(await open(tx, future)).toEqual(refused('session_proof_expired'));
          expect(await resolved(tx, future.tokenHash)).toBeNull();
          const recent = await signed(tx, userId, { skewMs: -59_000n });
          expect(await open(tx, recent)).toEqual({ code: 'OK', message: '' });
        });
      });
    });

    it(`rejeu de la même preuve, ou même jeton sous une nouvelle session : refus (${country})`, async () => {
      await withRole('app_api', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          const userId = await account(tx);
          const c = await signed(tx, userId);
          expect(await open(tx, c)).toEqual({ code: 'OK', message: '' });
          expect(await open(tx, c)).toEqual(refused('session_proof_replayed'));
          // même jeton, nouvelle session, preuve valable : le jeton est déjà pris
          const issuedAtMs = await databaseNowMs(tx);
          const f = {
            sessionId: randomUUID(),
            userId,
            tokenHash: c.tokenHash,
            ttlS: TTL_S,
            issuedAtMs,
          };
          expect(await open(tx, { ...f, proof: sessionOpenProof(f) })).toEqual(
            refused('session_proof_replayed'),
          );
          expect(await resolved(tx, c.tokenHash)).toBe(userId);
        });
      });
    });

    it(`clé absente : aucune session ouverte (échec fermé) (${country})`, async () => {
      await withRole('app_api', async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          const userId = await account(tx);
          const c = await signed(tx, userId);
          await tx.query('SELECT test_fixture.us410_delete_session_open_key()');
          expect(await slots(tx)).toEqual([]);
          expect(await open(tx, c)).toEqual(refused('session_proof_unavailable'));
          expect(await resolved(tx, c.tokenHash)).toBeNull();
        });
      });
    });
  },
);

describe('US-410 — rejeu concurrent (deux connexions app_api)', () => {
  it('la même preuve sur deux connexions : la seconde attend la première, puis est refusée ; une seule session', async () => {
    const a = await connectAs('app_api');
    const b = await connectAs('app_api');
    try {
      const userId = await withTestTransaction(a, { commit: true }, (tx) => account(tx));
      await a.query('BEGIN');
      await b.query('BEGIN');
      const c = await signed(a, userId);
      expect(await open(a, c)).toEqual({ code: 'OK', message: '' });
      const pidB = await backendPid(b);
      const second = open(b, c);
      await waitUntilBlocked(a, pidB, 'transactionid');
      await a.query('COMMIT');
      expect(await second).toEqual(refused('session_proof_replayed'));
      await b.query('COMMIT');
      expect(await resolved(a, c.tokenHash)).toBe(userId);
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      await releaseClient(a);
      await releaseClient(b);
    }
  });
});

describe('US-410 — rotation de la clé sans coupure (0185)', () => {
  it('STAGE : ancienne et nouvelle acceptées ; PROMOTE : l’ancienne refusée, la nouvelle acceptée', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const userId = await account(tx);
        expect(await slots(tx)).toEqual([1]);
        expect(await open(tx, await signed(tx, userId, { key: NEW_KEY }))).toEqual(
          refused('session_proof_refused'),
        );
        expect(await rotate(tx, 'STAGE', NEW_KEY)).toBe('CURRENT+NEXT');
        expect(await open(tx, await signed(tx, userId))).toEqual({ code: 'OK', message: '' });
        expect(await open(tx, await signed(tx, userId, { key: NEW_KEY }))).toEqual({
          code: 'OK',
          message: '',
        });
        expect(await rotate(tx, 'PROMOTE', null)).toBe('CURRENT');
        expect(await open(tx, await signed(tx, userId))).toEqual(refused('session_proof_refused'));
        expect(await open(tx, await signed(tx, userId, { key: NEW_KEY }))).toEqual({
          code: 'OK',
          message: '',
        });
      });
    });
  });

  it('sans PROMOTE, l’ancienne est refusée 24 h après STAGE ; ABORT : la nouvelle est refusée', async () => {
    const t0 = '2031-03-10T12:00:00.000Z';
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: t0 }, async (tx) => {
        const userId = await account(tx);
        expect(await rotate(tx, 'STAGE', NEW_KEY)).toBe('CURRENT+NEXT');
        await setVirtualNow(tx, plus(t0, 24 * 3600 - 1));
        expect(await open(tx, await signed(tx, userId))).toEqual({ code: 'OK', message: '' });
        await setVirtualNow(tx, plus(t0, 24 * 3600));
        expect(await open(tx, await signed(tx, userId))).toEqual(refused('session_proof_refused'));
        expect(await open(tx, await signed(tx, userId, { key: NEW_KEY }))).toEqual({
          code: 'OK',
          message: '',
        });
      });
      await withTestTransaction(client, {}, async (tx) => {
        const userId = await account(tx);
        expect(await rotate(tx, 'STAGE', NEW_KEY)).toBe('CURRENT+NEXT');
        expect(await rotate(tx, 'ABORT', null)).toBe('CURRENT');
        expect(await open(tx, await signed(tx, userId, { key: NEW_KEY }))).toEqual(
          refused('session_proof_refused'),
        );
        expect(await open(tx, await signed(tx, userId))).toEqual({ code: 'OK', message: '' });
      });
    });
  });

  it('gestes incohérents refusés ; app_api n’appelle pas la fonction de rotation (42501)', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const errorOf = async (sql: string, params: unknown[]): Promise<Outcome> => {
          await tx.query('SAVEPOINT r');
          try {
            await tx.query(sql, params);
            await tx.query('RELEASE SAVEPOINT r');
            return { code: 'AUCUNE_ERREUR', message: '' };
          } catch (error) {
            await tx.query('ROLLBACK TO SAVEPOINT r');
            const e = error as { code?: string; message?: string };
            return { code: e.code ?? '?', message: e.message ?? '' };
          }
        };
        const fixture = 'SELECT test_fixture.us410_rotate_session_open_key($1, $2)';
        expect(await errorOf(fixture, ['INSTALL', NEW_KEY])).toEqual({
          code: '55000',
          message: 'session_open_key_already_installed',
        });
        expect(await errorOf(fixture, ['STAGE', TEST_SESSION_OPEN_KEY])).toEqual({
          code: '22023',
          message: 'session_open_key_unchanged',
        });
        expect(await errorOf(fixture, ['STAGE', Buffer.alloc(31, 1)])).toEqual({
          code: '22023',
          message: 'session_open_key_invalid',
        });
        expect(await errorOf(fixture, ['PROMOTE', null])).toEqual({
          code: '55000',
          message: 'session_open_key_nothing_staged',
        });
        expect(await errorOf(fixture, ['DROP', null])).toEqual({
          code: '22023',
          message: 'session_open_key_action_invalid',
        });
        expect(
          (await errorOf('SELECT core.iam_session_open_key_rotate($1, $2)', ['STAGE', NEW_KEY]))
            .code,
        ).toBe('42501');
        expect(await slots(tx)).toEqual([1]);
      });
    });
  });
});

describe('US-410 — la clé est introuvable sous les rôles de production (RT-L4-S04)', () => {
  for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
    it(`${role} : aucun droit sur la table, aucun réglage, aucune fonction qui la rende`, async () => {
      await withRole(
        role,
        async (client) => {
          const priv = await client.query<{ any: boolean; found: number; member: boolean }>(
            // par OID lu au catalogue : app_anon n'a pas USAGE sur le schéma core (un nom qualifié
            // y échouerait avant de juger le droit)
            `WITH t AS (SELECT c.oid FROM pg_catalog.pg_class c
                          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                         WHERE n.nspname = 'core' AND c.relname = 'iam_session_open_key')
             SELECT EXISTS (SELECT 1 FROM t, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(x)
                             WHERE pg_catalog.has_table_privilege(t.oid, p.x))
                 OR EXISTS (SELECT 1 FROM t, unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p(x)
                             WHERE pg_catalog.has_any_column_privilege(t.oid, p.x)) AS any,
                    (SELECT count(*) FROM t)::int AS found,
                    pg_catalog.pg_has_role(current_user, 'iam_auth_owner', 'MEMBER') AS member`,
          );
          expect(priv.rows[0]).toEqual({ any: false, found: 1, member: false });
          const read = await client.query('SELECT key FROM core.iam_session_open_key').then(
            () => 'LU',
            (e: { code?: string }) => e.code ?? '?',
          );
          expect(read).toBe('42501');
          // fonctions des schémas de production exécutables par le rôle et qui lisent la table
          const fns = await client.query<{ f: string; ret: string }>(
            `SELECT n.nspname || '.' || p.proname AS f, pg_catalog.format_type(p.prorettype, NULL) AS ret
               FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('core', 'app', 'platform')
                AND p.prosrc ~ 'iam_session_open_key'
                AND pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE')
              ORDER BY 1`,
          );
          expect(fns.rows).toEqual(
            role === 'app_api'
              ? [{ f: 'core.iam_cmd_open_session', ret: 'timestamp with time zone' }]
              : [],
          );
          // la primitive de preuve (qui prend la clé en argument) n'est pas exécutable non plus
          const proofFn = await client.query<{ x: boolean }>(
            `SELECT pg_catalog.has_function_privilege(p.oid, 'EXECUTE') AS x
               FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'core' AND p.proname = 'iam_session_open_proof'`,
          );
          expect(proofFn.rows[0]?.x).toBe(false);
          const settings = await client.query<{ name: string }>(
            `SELECT name FROM pg_catalog.pg_settings WHERE name ~* '(session_open|open_key|proof)'`,
          );
          expect(settings.rows).toEqual([]);
        },
        { database: 'production' },
      );
    });
  }

  it('base de production du banc (aucune clé installée) : une preuve de test n’ouvre rien', async () => {
    await withRole(
      'app_api',
      async (client) => {
        await withTestTransaction(client, {}, async (tx) => {
          // la preuve est jugée avant toute lecture du compte : un UUID quelconque suffit
          const c = await signed(tx, randomUUID());
          expect(await open(tx, c)).toEqual(refused('session_proof_unavailable'));
          expect(await resolved(tx, c.tokenHash)).toBeNull();
        });
      },
      { database: 'production' },
    );
  });
});
