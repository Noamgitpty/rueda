/**
 * US-009 — journal d'audit inaltérable et chaîne de hachage vérifiable (17 §1.7, §3.1.2,
 * §3.2.13 ; 16 ADM-001 ; ADR-051), sous les rôles de production (assertion L0-05 en tête).
 *
 * Critère : « Given le journal, When une mise à jour ou une suppression est tentée depuis
 * l'application, Then elle est impossible et la chaîne de hachage reste vérifiable. »
 * Preuves :
 * - écriture par app_api (GUEST, HOST, STAFF) et app_worker ; id, at, prev_hash, hash attribués par
 *   la base ; le vérificateur TypeScript INDÉPENDANT recalcule chaque hachage et retrouve la tête ;
 * - UPDATE, DELETE, TRUNCATE refusés (42501) pour app_api, app_worker et app_anon ; écriture
 *   refusée sans contexte (fail-closed) ;
 * - même le propriétaire est refusé par le trigger (IMMUTABLE_RECORD) ; s'il contourne le trigger,
 *   la vérification détecte l'altération (modification, modification re-hachée, suppression au
 *   milieu, suppression de la fin) ;
 * - 16 écrivains concurrents : chaîne linéaire, sans trou ni fourche.
 */
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { appendAuditLog, SubjectKeyStore } from '../../src/audit/index.ts';
import { connectAs, FakeKeyWrapper, releaseClient, withRole } from '../../src/testing/index.ts';
import {
  attempt,
  auditTx,
  readChain,
  setActor,
  uuid,
  VERIFIER,
  verifyChainIn,
} from '../support/audit.ts';
import type { ActorContext } from '../support/audit.ts';

const T0 = '2031-03-01T09:00:00.123456Z';
const WRITER: ActorContext = { kind: 'WORKER', worker: 'audit_test_writer' };

const insertSql = `
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type, subject_id,
                                    after, request_id)
  VALUES ($1, $2, 'TEST_ACTION', 'TRIP', $3, '{"step": 1}', $4)`;

/** Ligne minimale, sans IP. */
async function writeRow(
  tx: Parameters<typeof appendAuditLog>[0],
  requestId: string,
  role = 'STAFF',
): Promise<void> {
  await tx.query(insertSql, [uuid(), role, uuid(), requestId]);
}

describe('US-009 — journal d’audit chaîné (17 §1.7, ADM-001)', () => {
  it('app_api et app_worker écrivent ; la base attribue id, at, prev_hash, hash ; la chaîne se vérifie', async () => {
    const keys = new SubjectKeyStore(new FakeKeyWrapper());
    const requestIds = [uuid(), uuid(), uuid(), uuid()];
    await withRole('app_api', async (client) => {
      for (const [i, kind] of (['GUEST', 'HOST', 'STAFF'] as const).entries()) {
        await auditTx(client, { actor: { kind }, virtualNow: T0, commit: true }, async (tx) => {
          await appendAuditLog(tx, keys, {
            actorUserId: uuid(),
            actorRole: kind,
            actionCode: 'TEST_ACTION',
            subjectType: 'TRIP',
            subjectId: uuid(),
            after: { status: 'CANCELLED', country_code: i % 2 === 0 ? 'PA' : 'PY' },
            requestId: requestIds[i] as string,
          });
        });
      }
    });
    await withRole('app_worker', async (client) => {
      await auditTx(client, { actor: WRITER, virtualNow: T0, commit: true }, async (tx) => {
        await appendAuditLog(tx, keys, {
          actorUserId: null,
          actorRole: 'WORKER',
          actionCode: 'HOLD_EXPIRED',
          subjectType: 'HOLD',
          subjectId: uuid(),
          requestId: requestIds[3] as string,
        });
      });
      await auditTx(client, { actor: VERIFIER }, async (tx) => {
        const { rows, head } = await readChain(tx);
        const result = await verifyChainIn(tx);
        expect(result).toMatchObject({ ok: true, lastId: head.lastId });
        const mine = rows.filter((r) => requestIds.includes(r.requestId ?? ''));
        expect(mine).toHaveLength(4);
        for (const r of mine) {
          // instant = platform.now() (horloge virtuelle du test), au microseconde près
          expect(r.atUs).toBe(String(Date.parse('2031-03-01T09:00:00.123Z') * 1000 + 456));
          expect(r.hash).toHaveLength(32);
        }
        // id strictement croissants dans l'ordre des validations
        const ids = mine.map((r) => BigInt(r.id));
        expect([...ids].sort((a, b) => (a < b ? -1 : 1))).toEqual(ids);
      });
    });
  });

  it('le client ne peut fournir ni id, ni at, ni prev_hash, ni hash (42501)', async () => {
    await withRole('app_api', async (client) => {
      await auditTx(client, { actor: { kind: 'STAFF' } }, async (tx) => {
        for (const [col, value] of [
          ['id', '1'],
          ['at', '2000-01-01T00:00:00Z'],
          ['prev_hash', '\\x' + '00'.repeat(32)],
          ['hash', '\\x' + '00'.repeat(32)],
        ] as const) {
          const error = await attempt(
            tx,
            `INSERT INTO core.audit_audit_log (${col}, actor_role, action_code, subject_type, subject_id)
             VALUES ($1, 'STAFF', 'TEST_ACTION', 'TRIP', $2)`,
            [value, uuid()],
          );
          expect(error, col).toMatchObject({ code: '42501' });
        }
      });
    });
  });

  it('UPDATE, DELETE, TRUNCATE impossibles depuis l’application (app_api, app_worker, app_anon : 42501)', async () => {
    const statements = [
      `UPDATE core.audit_audit_log SET reason = 'x'`,
      `UPDATE core.audit_audit_log SET hash = prev_hash WHERE id = 1`,
      `DELETE FROM core.audit_audit_log`,
      `DELETE FROM core.audit_audit_log WHERE id = 1`,
      `TRUNCATE core.audit_audit_log`,
      `UPDATE core.audit_chain_head SET last_id = 0`,
      `DELETE FROM core.audit_chain_head`,
      `UPDATE core.audit_data_access_log SET purpose = 'x'`,
      `DELETE FROM core.audit_data_access_log`,
      `TRUNCATE core.audit_data_access_log`,
    ];
    const contexts: Record<'app_api' | 'app_worker' | 'app_anon', ActorContext> = {
      app_api: { kind: 'STAFF' },
      app_worker: VERIFIER, // même le vérificateur, seul lecteur du journal
      app_anon: { kind: 'NONE' },
    };
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await client.query('BEGIN');
        try {
          if (role !== 'app_anon') await setActor(client, contexts[role]);
          for (const sql of statements) {
            const error = await attempt(client, sql);
            expect(error, `${role} : ${sql}`).toMatchObject({ code: '42501' });
          }
        } finally {
          await client.query('ROLLBACK');
        }
      });
    }
  });

  it('sans contexte app.* : écriture refusée par la RLS (42501), lecture vide', async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await withRole(role, async (client) => {
        await auditTx(client, { actor: { kind: 'NONE' } }, async (tx) => {
          expect(await attempt(tx, insertSql, [uuid(), 'STAFF', uuid(), uuid()])).toMatchObject({
            code: '42501',
          });
        });
      });
    }
    await withRole('app_api', async (client) => {
      // app_api en GUEST ne peut pas se faire passer pour un travailleur, ni lire le journal
      await auditTx(
        client,
        { actor: { kind: 'WORKER', worker: 'audit_chain_verifier' } },
        async (tx) => {
          expect(await attempt(tx, insertSql, [uuid(), 'STAFF', uuid(), uuid()])).toMatchObject({
            code: '42501',
          });
          expect(await attempt(tx, 'SELECT 1 FROM core.audit_audit_log LIMIT 1')).toMatchObject({
            code: '42501',
          });
        },
      );
    });
    await withRole('app_worker', async (client) => {
      await auditTx(client, { actor: WRITER }, async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM core.audit_audit_log',
        );
        expect(rows[0]?.n).toBe(0); // seul audit_chain_verifier lit le journal
      });
    });
  });

  it('même le propriétaire : UPDATE et DELETE refusés par le trigger (IMMUTABLE_RECORD)', async () => {
    await withRole('app_worker', async (client) => {
      await auditTx(client, { actor: WRITER }, async (tx) => {
        await writeRow(tx, uuid());
        const { rows } = await tx.query<{ id: string }>(
          `SELECT last_id::text AS id FROM core.audit_chain_head`,
        );
        // la tête est invisible du rédacteur : on la lit en vérificateur
        await setActor(tx, VERIFIER);
        const head = (await readChain(tx)).head.lastId;
        expect(rows).toHaveLength(0);
        for (const kind of ['UPDATE_REASON', 'DELETE']) {
          const error = await attempt(
            tx,
            `SELECT test_fixture.owner_tamper_audit_log($1, $2, false)`,
            [kind, head],
          );
          expect(error, kind).toMatchObject({ code: '23000', constraint: 'audit_log_append_only' });
          expect(translateDbError(error)).toEqual({ code: 'IMMUTABLE_RECORD', retryable: false });
        }
        expect(await verifyChainIn(tx)).toMatchObject({ ok: true });
      });
    });
  });

  it.each([
    ['UPDATE_REASON', 0, 'HASH_MISMATCH'],
    ['UPDATE_REASON_REHASH', 1, 'PREV_HASH_MISMATCH'],
    ['DELETE', 1, 'ID_GAP'],
  ] as const)(
    'altération par le propriétaire qui contourne le trigger (%s) : détectée par la vérification',
    async (kind, offset, reason) => {
      await withRole('app_worker', async (client) => {
        await auditTx(client, { actor: WRITER }, async (tx) => {
          await tx.query('SELECT test_fixture.lock_audit_log()'); // avant la tête : pas d'interblocage
          await writeRow(tx, uuid());
          await writeRow(tx, uuid());
          await writeRow(tx, uuid());
          const before = await verifyChainIn(tx);
          expect(before.ok ? 'ok' : JSON.stringify(before.break)).toBe('ok');
          if (!before.ok) return;
          const target = BigInt(before.lastId) - 1n; // avant-dernière ligne
          await tx.query(`SELECT test_fixture.owner_tamper_audit_log($1, $2, true)`, [
            kind,
            target.toString(),
          ]);
          expect(await verifyChainIn(tx)).toEqual({
            ok: false,
            break: { id: (target + BigInt(offset)).toString(), reason },
          });
        }); // ROLLBACK : l'altération disparaît
      });
    },
  );

  it('suppression de la DERNIÈRE ligne par le propriétaire : détectée par la tête (HEAD_MISMATCH)', async () => {
    await withRole('app_worker', async (client) => {
      await auditTx(client, { actor: WRITER }, async (tx) => {
        await tx.query('SELECT test_fixture.lock_audit_log()');
        await writeRow(tx, uuid());
        const before = await verifyChainIn(tx);
        if (!before.ok) throw new Error('chaîne invalide avant l’altération');
        await tx.query(`SELECT test_fixture.owner_tamper_audit_log('DELETE', $1, true)`, [
          before.lastId,
        ]);
        expect(await verifyChainIn(tx)).toEqual({
          ok: false,
          break: { id: before.lastId, reason: 'HEAD_MISMATCH' },
        });
      });
    });
    // après l'annulation, la chaîne est de nouveau intacte
    await withRole('app_worker', async (client) => {
      await auditTx(client, { actor: VERIFIER }, async (tx) => {
        expect(await verifyChainIn(tx)).toMatchObject({ ok: true });
      });
    });
  });

  it('16 écrivains concurrents : chaîne linéaire, id contigus, vérifiable', async () => {
    const before = await withRole('app_worker', (client) =>
      auditTx(client, { actor: VERIFIER }, (tx) => verifyChainIn(tx)),
    );
    if (!before.ok) throw new Error('chaîne invalide au départ');
    const n = 16;
    const clients = await Promise.all(
      Array.from({ length: n }, (_, i) => connectAs(i % 2 === 0 ? 'app_api' : 'app_worker')),
    );
    const requestIds = Array.from({ length: n }, () => uuid());
    try {
      await Promise.all(
        clients.map((client, i) =>
          auditTx(
            client,
            { actor: i % 2 === 0 ? { kind: 'STAFF' } : WRITER, commit: true },
            async (tx) => writeRow(tx, requestIds[i] as string),
          ),
        ),
      );
    } finally {
      await Promise.all(clients.map((c) => releaseClient(c)));
    }
    await withRole('app_worker', async (client) => {
      await auditTx(client, { actor: VERIFIER }, async (tx) => {
        const result = await verifyChainIn(tx);
        expect(result.ok ? 'ok' : JSON.stringify(result.break)).toBe('ok');
        const { rows } = await readChain(tx);
        const mine = rows.filter((r) => requestIds.includes(r.requestId ?? ''));
        expect(mine).toHaveLength(n);
        if (result.ok)
          expect(BigInt(result.lastId) - BigInt(before.lastId)).toBeGreaterThanOrEqual(n);
      });
    });
  });
});
