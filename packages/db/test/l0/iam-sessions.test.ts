/**
 * Preuves IAM de US-010 sous le rôle de production app_api (assertion L0-05 en tête de chaque
 * test par withRole ; horloge de la base platform.now(), virtuelle en test) :
 * - critère 1 : seul un hachage robuste (argon2id, format PHC) est stocké, jamais le mot de passe ;
 * - critère 2 (côté base) : une session révoquée ne se résout plus (l'API répond 401) ;
 * - expiration à l'horloge de la base, bornes de durée, 8 h pour le staff (17 §3.2.1) ;
 * - révocation définitive, aucune prolongation, jeton stocké seulement en SHA-256 ;
 * - compte fermé ou banni : plus de session ; inscription anti-énumération (16 ACC-001) ;
 * - lien de vérification à usage unique et borné dans le temps.
 * Valeurs attendues : 17 §3.2.1, §6.6 ; 16 ACC-001 ; ADR-052 (bornes PROPOSÉES).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import {
  newToken,
  openSession,
  phcArgon2id,
  plus,
  register,
  resolve,
  SESSION_TTL_S,
  setVirtualNow,
  uuid,
  VERIFICATION_TTL_S,
} from '../support/iam.ts';

const T0 = '2031-03-10T14:00:00.000Z';

describe('IAM — comptes et sessions sous app_api (US-010)', () => {
  it('critère 1 : un mot de passe en clair ou un hachage faible est refusé ; seul argon2id est stocké', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        for (const weak of [
          'Correct-Horse-9',
          '$2b$12$abcdefghijklmnopqrstuuJ7nq1dMpXcLx3Jg1a9oPqE0nB4c6W2y', // bcrypt
          '$argon2i$v=19$m=65536,t=3,p=1$c2FsdHNhbHQ$aGFzaGhhc2g', // argon2i
          createHash('sha256').update('Correct-Horse-9').digest('hex'),
        ]) {
          await tx.query('SAVEPOINT s');
          await expect(register(tx, { passwordHash: weak }), weak).rejects.toMatchObject({
            code: '23514',
            constraint: 'user_account_password_hash_argon2id',
          });
          await tx.query('ROLLBACK TO SAVEPOINT s');
        }
        const hash = phcArgon2id();
        const r = await register(tx, { passwordHash: hash });
        expect(r.created).toBe(true);
        const { rows } = await tx.query<{ password_hash: string; status: string }>(
          'SELECT password_hash, status FROM test_fixture.iam_read_account($1)',
          [r.email],
        );
        expect(rows).toEqual([{ password_hash: hash, status: 'PENDING_EMAIL' }]);
      });
    });
  });

  it('inscription : email déjà pris => false, sans erreur ni second compte (anti-énumération)', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const first = await register(tx);
        const again = await register(tx, { email: first.email });
        expect(first.created).toBe(true);
        expect(again.created).toBe(false);
        const { rows } = await tx.query('SELECT * FROM core.iam_auth_lookup($1)', [first.email]);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ user_id: first.userId, status: 'PENDING_EMAIL' });
        const unknown = await tx.query('SELECT * FROM core.iam_auth_lookup($1)', [
          'nobody@example.test',
        ]);
        expect(unknown.rows).toEqual([]);
        // email non normalisé : refusé par la base (l'API normalise avant)
        await expect(register(tx, { email: 'Ana@Example.test' })).rejects.toMatchObject({
          code: '23514',
          constraint: 'user_account_email_normalized',
        });
      });
    });
  });

  it('critère 2 : session ouverte puis révoquée => plus aucune résolution ; révocation définitive', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const u = await register(tx);
        const s = await openSession(tx, u.userId);
        expect(s.expiresAt?.toISOString()).toBe(plus(T0, SESSION_TTL_S));
        const live = await resolve(tx, s.hash);
        expect(live).toHaveLength(1);
        expect(live[0]).toMatchObject({ user_id: u.userId, mfa_level: 'NONE' });

        const revoked = await tx.query<{ ok: boolean }>(
          `SELECT core.iam_cmd_revoke_session($1, 'LOGOUT') AS ok`,
          [s.hash],
        );
        expect(revoked.rows[0]?.ok).toBe(true);
        expect(await resolve(tx, s.hash)).toEqual([]);
        // seconde révocation : sans effet ; motif hors liste : refusé
        const twice = await tx.query<{ ok: boolean }>(
          `SELECT core.iam_cmd_revoke_session($1, 'LOGOUT') AS ok`,
          [s.hash],
        );
        expect(twice.rows[0]?.ok).toBe(false);
        await tx.query('SAVEPOINT s');
        await expect(
          tx.query(`SELECT core.iam_cmd_revoke_session($1, 'ADMIN')`, [s.hash]),
        ).rejects.toMatchObject({ code: '22023' });
        await tx.query('ROLLBACK TO SAVEPOINT s');
        // même le propriétaire ne peut ni annuler la révocation, ni prolonger, ni changer le titulaire
        await register(tx); // un autre compte, cible de « STEAL »
        for (const kind of ['UNREVOKE', 'EXTEND', 'STEAL']) {
          await tx.query('SAVEPOINT g');
          await expect(
            tx.query('SELECT test_fixture.iam_force_session_update($1, $2)', [s.hash, kind]),
            kind,
          ).rejects.toMatchObject({ code: '23514', constraint: 'session_guarded_columns' });
          await tx.query('ROLLBACK TO SAVEPOINT g');
        }
        expect(await resolve(tx, s.hash)).toEqual([]);
      });
    });
  });

  it('jeton : seul son SHA-256 est stocké ; jeton inconnu => aucune ligne', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const u = await register(tx);
        const s = await openSession(tx, u.userId);
        const { rows } = await tx.query<{ token_hash: Buffer; user_agent: string }>(
          'SELECT token_hash, user_agent FROM test_fixture.iam_read_sessions($1)',
          [u.userId],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.token_hash.equals(s.hash)).toBe(true);
        expect(rows[0]?.token_hash.toString('base64url')).not.toBe(s.token);
        expect(await resolve(tx, newToken().hash)).toEqual([]);
        // le jeton en clair (et non son empreinte) ne résout rien
        expect(await resolve(tx, Buffer.from(s.token, 'utf8'))).toEqual([]);
      });
    });
  });

  it('expiration à l’horloge de la base : valide à T+ttl-1 s, plus à T+ttl', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const u = await register(tx);
        const s = await openSession(tx, u.userId, { ttlS: 3600 });
        await setVirtualNow(tx, plus(T0, 3599));
        expect(await resolve(tx, s.hash)).toHaveLength(1);
        await setVirtualNow(tx, plus(T0, 3600));
        expect(await resolve(tx, s.hash)).toEqual([]);
        // une session expirée ne permet pas « se déconnecter partout »
        const all = await tx.query<{ n: number }>(
          'SELECT core.iam_cmd_revoke_all_sessions($1) AS n',
          [s.hash],
        );
        expect(all.rows[0]?.n).toBe(0);
      });
    });
  });

  it('durée de session bornée (300 s à 30 j) ; 8 h pour un compte qui a un rôle interne', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const u = await register(tx);
        for (const ttl of [0, 299, 2_592_001]) {
          await tx.query('SAVEPOINT s');
          await expect(openSession(tx, u.userId, { ttlS: ttl }), String(ttl)).rejects.toMatchObject(
            { code: '22023' },
          );
          await tx.query('ROLLBACK TO SAVEPOINT s');
        }
        const admin = await register(tx);
        await tx.query(
          `SELECT test_fixture.iam_grant_staff_role($1, $2, 'OPS_AGENT', ARRAY['PA','PY'], $3, NULL)`,
          [uuid(), u.userId, admin.userId],
        );
        const staff = await openSession(tx, u.userId, { ttlS: SESSION_TTL_S });
        expect(staff.expiresAt?.toISOString()).toBe(plus(T0, 8 * 3600));
        // rôle expiré : plus de réduction
        const v = await register(tx);
        await tx.query(
          `SELECT test_fixture.iam_grant_staff_role($1, $2, 'FINANCE', ARRAY['PY'], $3, $4)`,
          [uuid(), v.userId, admin.userId, plus(T0, -1)],
        );
        const former = await openSession(tx, v.userId, { ttlS: SESSION_TTL_S });
        expect(former.expiresAt?.toISOString()).toBe(plus(T0, SESSION_TTL_S));
      });
    });
  });

  it('« se déconnecter partout » révoque toutes les sessions du titulaire, pas celles des autres', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const a = await register(tx);
        const b = await register(tx);
        const a1 = await openSession(tx, a.userId);
        const a2 = await openSession(tx, a.userId);
        const b1 = await openSession(tx, b.userId);
        const { rows } = await tx.query<{ n: number }>(
          'SELECT core.iam_cmd_revoke_all_sessions($1) AS n',
          [a1.hash],
        );
        expect(rows[0]?.n).toBe(2);
        expect(await resolve(tx, a1.hash)).toEqual([]);
        expect(await resolve(tx, a2.hash)).toEqual([]);
        expect(await resolve(tx, b1.hash)).toHaveLength(1);
        const reasons = await tx.query<{ revoked_reason: string }>(
          'SELECT revoked_reason FROM test_fixture.iam_read_sessions($1)',
          [a.userId],
        );
        expect(reasons.rows.map((r) => r.revoked_reason)).toEqual(['LOGOUT_ALL', 'LOGOUT_ALL']);
      });
    });
  });

  it('compte fermé ou banni : ses sessions ne se résolvent plus et aucune ne s’ouvre', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        for (const status of ['CLOSED', 'BANNED']) {
          const u = await register(tx);
          const s = await openSession(tx, u.userId);
          await tx.query('SELECT test_fixture.iam_set_account_status($1, $2)', [u.userId, status]);
          expect(await resolve(tx, s.hash), status).toEqual([]);
          const again = await openSession(tx, u.userId);
          expect(again.expiresAt, status).toBeNull();
        }
        // compte inconnu : aucune session
        expect((await openSession(tx, uuid())).expiresAt).toBeNull();
        // compte restreint : connexion possible (la restriction limite la réservation, BKG-012)
        const r = await register(tx);
        await tx.query(`SELECT test_fixture.iam_set_account_status($1, 'RESTRICTED')`, [r.userId]);
        expect((await openSession(tx, r.userId)).expiresAt).not.toBeNull();
      });
    });
  });

  it('lien de vérification : usage unique, expiré après 24 h, PENDING_EMAIL -> ACTIVE, sessions antérieures révoquées', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const verify = async (hash: Buffer) =>
          (await tx.query<{ ok: boolean }>('SELECT core.iam_cmd_verify_email($1) AS ok', [hash]))
            .rows[0]?.ok;
        const late = await register(tx);
        await setVirtualNow(tx, plus(T0, VERIFICATION_TTL_S));
        expect(await verify(late.verification.hash)).toBe(false);

        await setVirtualNow(tx, T0);
        const u = await register(tx);
        // session ouverte AVANT la vérification (pré-détournement) : révoquée par la vérification
        const before = await openSession(tx, u.userId);
        expect((await resolve(tx, before.hash))[0]?.email_verified).toBe(false);
        await setVirtualNow(tx, plus(T0, VERIFICATION_TTL_S - 1));
        expect(await verify(u.verification.hash)).toBe(true);
        expect(await resolve(tx, before.hash)).toEqual([]);
        const after = await openSession(tx, u.userId);
        expect((await resolve(tx, after.hash))[0]?.email_verified).toBe(true);
        const reasons = await tx.query<{ revoked_reason: string | null }>(
          'SELECT revoked_reason FROM test_fixture.iam_read_sessions($1)',
          [u.userId],
        );
        expect(reasons.rows.map((r) => r.revoked_reason)).toEqual(['EMAIL_VERIFIED', null]);
        expect(await verify(u.verification.hash)).toBe(false);
        expect(await verify(newToken().hash)).toBe(false);
        const { rows } = await tx.query<{ status: string; email_verified_at: Date }>(
          'SELECT status, email_verified_at FROM test_fixture.iam_read_account($1)',
          [u.email],
        );
        expect(rows[0]?.status).toBe('ACTIVE');
        expect(rows[0]?.email_verified_at.toISOString()).toBe(plus(T0, VERIFICATION_TTL_S - 1));
        // durée hors bornes : refusée
        await tx.query('SAVEPOINT s');
        await expect(
          tx.query(
            `SELECT core.iam_cmd_register($1, $2, $3, 'A', 'B', 'es-PA', $4, $5, 60, NULL)`,
            [uuid(), `x-${uuid()}@example.test`, phcArgon2id(), uuid(), newToken().hash],
          ),
        ).rejects.toMatchObject({ code: '22023' });
        await tx.query('ROLLBACK TO SAVEPOINT s');
      });
    });
  });
});
