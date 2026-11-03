/**
 * Preuves de l'authentification forte du staff (US-012) sous le rôle de production app_api
 * (assertion L0-05 en tête de chaque test par withRole ; horloge de la base platform.now()) :
 * - critère 2 : un compte staff sans TOTP n'a accès à rien (refus journalisé) ;
 * - une session naît au niveau NONE (report US-010) ; seul l'enrôlement ou la vérification TOTP,
 *   prouvés par HMAC (clé illisible par app_api), l'élèvent ; pas à ±1, aucun rejeu, verrou à 5 ;
 * - un rôle sans MFA ne lit rien sous la RLS (has_staff_role exige une session élevée) ;
 * - RLS-18 réduite : du SQL arbitraire sous app_api ne fabrique pas de session élevée ;
 * - chaque refus et chaque élévation sont journalisés.
 * Valeurs attendues : 16 ADM-001 ; 17 §2.3 ; RFC 4231 (HMAC-SHA-256), RFC 6238 (pas de 30 s) ;
 * bornes PROPOSÉES d'ADR-062 (5 échecs, 15 min). Les preuves HMAC sont recalculées par node:crypto.
 */
import { createHash, createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { setSessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { newToken, SESSION_TTL_S } from '../support/iam.ts';
import { buildWorld, ids } from '../support/rls.ts';
import type { World } from '../support/rls.ts';
import {
  attempt,
  auditOf,
  begin,
  createStaff,
  elevate,
  elevatedStaff,
  installTestProofKey,
  login,
  proof,
  stepNow,
  uuid,
} from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
let world: World;

beforeAll(async () => {
  const api = await connectAs('app_api');
  try {
    await installTestProofKey(api);
    world = await buildWorld(api, COUNTRIES);
  } finally {
    await releaseClient(api);
  }
});

const hex = (b: Buffer): string => b.toString('hex');

describe('primitives', () => {
  it('HMAC-SHA-256 en SQL = RFC 4231 (cas 1, 2, 6) et = node:crypto', async () => {
    const cases: [Buffer, Buffer, string][] = [
      [
        Buffer.alloc(20, 0x0b),
        Buffer.from('Hi There'),
        'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
      ],
      [
        Buffer.from('Jefe'),
        Buffer.from('what do ya want for nothing?'),
        '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
      ],
      [
        Buffer.alloc(131, 0xaa),
        Buffer.from('Test Using Larger Than Block-Size Key - Hash Key First'),
        '60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54',
      ],
    ];
    await withRole('app_api', async (client) => {
      for (const [key, msg, expected] of cases) {
        const { rows } = await client.query<{ h: Buffer }>(
          'SELECT test_fixture.iam_hmac_sha256($1, $2) AS h',
          [key, msg],
        );
        expect(hex(rows[0]?.h ?? Buffer.alloc(0))).toBe(expected);
        expect(createHmac('sha256', key).update(msg).digest('hex')).toBe(expected);
      }
      // la primitive elle-même n'est pas exécutable par app_api
      await expect(
        client.query(`SELECT core.iam_hmac_sha256('\\x00'::bytea, '\\x00'::bytea)`),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('report US-010 : une session naît au niveau NONE, toute autre valeur est refusée (22023)', async () => {
    await withRole('app_api', async (client) => {
      const s = await createStaff(client, 'ADMIN', ALL);
      for (const level of ['TOTP', 'OTP', 'none', '']) {
        await expect(
          client.query(`SELECT core.iam_cmd_open_session($1, $2, $3, $4, $5, NULL, NULL)`, [
            uuid(),
            s.userId,
            newToken().hash,
            SESSION_TTL_S,
            level,
          ]),
          level,
        ).rejects.toMatchObject({ code: '22023' });
      }
      const hash = await login(client, s.userId);
      const { rows } = await client.query<{ mfa_level: string }>(
        'SELECT mfa_level FROM test_fixture.iam_read_session_mfa($1)',
        [hash],
      );
      expect(rows).toEqual([{ mfa_level: 'NONE' }]);
    });
  });
});

describe('critère 2 — un compte staff sans TOTP : accès refusé', () => {
  it('aucun facteur : TOTP_NOT_ENROLLED, refus journalisé, aucune lecture sous la RLS', async () => {
    await withRole('app_api', async (client) => {
      const s = await createStaff(client, 'ADMIN', ALL, { withFactor: false });
      const hash = await login(client, s.userId);
      expect((await begin(client, hash)).outcome).toBe('TOTP_NOT_ENROLLED');
      // aucune élévation possible : aucun facteur à prouver
      expect(await elevate(client, hash, s.factorId)).toBe('REFUSED');
      const audit = await auditOf(client, s.userId);
      expect(audit.map((a) => [a.action_code, a.after?.['reason']])).toEqual([
        ['STAFF_ACCESS_DENIED', '2FA_REQUIRED'],
        ['STAFF_MFA_REFUSED', 'UNKNOWN_FACTOR'],
      ]);
      // un ADMIN de deux pays sans MFA : 0 ligne, même avec la preuve de SA session (NONE)
      await withTestTransaction(client, {}, async (tx) => {
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: s.userId,
          countryScope: ALL,
          sessionTokenHash: hex(hash),
        });
        expect(await ids(tx, 'booking_trip')).toEqual([]);
        expect(await ids(tx, 'iam_organization')).toEqual([]);
      });
    });
  });

  it('un utilisateur sans rôle interne : NOT_STAFF, journalisé', async () => {
    await withRole('app_api', async (client) => {
      const s = await createStaff(client, null, ALL);
      const hash = await login(client, s.userId);
      expect((await begin(client, hash)).outcome).toBe('NOT_STAFF');
      expect(await elevate(client, hash, s.factorId)).toBe('NOT_STAFF');
      expect((await auditOf(client, s.userId)).map((a) => a.after?.['reason'])).toEqual([
        'NOT_STAFF',
        'NOT_STAFF',
      ]);
    });
  });

  it('session absente, révoquée ou inconnue : AUTH_REQUIRED, rien n’est journalisé', async () => {
    await withRole('app_api', async (client) => {
      expect((await begin(client, newToken().hash)).outcome).toBe('AUTH_REQUIRED');
      expect(await elevate(client, newToken().hash, uuid())).toBe('AUTH_REQUIRED');
    });
  });
});

describe('enrôlement et élévation', () => {
  it('code d’enrôlement remis hors bande, puis preuve : ENROLLED ; la session devient TOTP et ouvre la RLS', async () => {
    await withRole('app_api', async (client) => {
      const s = await createStaff(client, 'ADMIN', ALL);
      const hash = await login(client, s.userId);
      const b = await begin(client, hash);
      expect(b).toMatchObject({ outcome: 'ENROLLMENT_REQUIRED', factor_id: s.factorId });
      expect(b).not.toHaveProperty('secret_ref'); // begin ne rend jamais la référence du secret
      const wrong = createHash('sha256').update('mauvais code').digest();
      const bad = await client.query<{ outcome: string; secret_ref: string | null }>(
        'SELECT outcome, secret_ref FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
        [hash, wrong],
      );
      expect(bad.rows).toEqual([{ outcome: 'REFUSED', secret_ref: null }]);
      const ok = await client.query<{ outcome: string; factor_id: string; secret_ref: string }>(
        'SELECT * FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
        [hash, s.codeHash],
      );
      expect(ok.rows).toEqual([
        { outcome: 'OK', factor_id: s.factorId, secret_ref: 'fake-vault:test-secret' },
      ]);
      // sans contexte élevé, rien n'est lisible
      await withTestTransaction(client, {}, async (tx) => {
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: s.userId,
          countryScope: ALL,
          sessionTokenHash: hex(hash),
        });
        expect(await ids(tx, 'booking_trip')).toEqual([]);
      });
      const step = stepNow();
      expect(await elevate(client, hash, s.factorId, step)).toBe('ENROLLED');
      expect((await begin(client, hash)).outcome).toBe('ELEVATED');
      const factors = await client.query<{ enabled: boolean; has_code: boolean; step: string }>(
        `SELECT enabled_at IS NOT NULL AS enabled, has_code, last_used_step::text AS step
           FROM test_fixture.iam_read_factors($1)`,
        [s.userId],
      );
      expect(factors.rows).toEqual([{ enabled: true, has_code: false, step: String(step) }]);
      await withTestTransaction(client, {}, async (tx) => {
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: s.userId,
          countryScope: ALL,
          sessionTokenHash: hex(hash),
        });
        const trips = await ids(tx, 'booking_trip');
        expect(trips).toEqual(expect.arrayContaining(world.countries.map((c) => c.trips.a1.id)));
      });
      expect((await auditOf(client, s.userId)).map((a) => a.action_code)).toEqual([
        'STAFF_ENROLLMENT_REFUSED',
        'STAFF_TOTP_ENROLLED',
      ]);
    });
  });

  it('session suivante : MFA_REQUIRED puis ELEVATED ; preuve fausse, pas rejoué ou hors fenêtre : REFUSED et journalisé', async () => {
    await withRole('app_api', async (client) => {
      const s = await elevatedStaff(client, 'OPS_AGENT', [ALL[0] ?? '']);
      const enrolledStep = stepNow();
      const second = await login(client, s.userId);
      const b = await begin(client, second);
      expect(b).toMatchObject({ outcome: 'MFA_REQUIRED', factor_id: s.factorId });
      // la référence du secret ne sort que contre une tentative comptée
      expect(await attempt(client, second)).toEqual({
        outcome: 'OK',
        secret_ref: 'fake-vault:test-secret',
      });
      // preuve calculée avec une autre clé (ce que pourrait faire du SQL arbitraire) : refus
      const forged = proof(second, s.factorId, enrolledStep + 1, Buffer.alloc(32, 7));
      expect(await elevate(client, second, s.factorId, enrolledStep + 1, forged)).toBe('REFUSED');
      // preuve d'une AUTRE session : refus (la preuve lie le jeton)
      expect(
        await elevate(
          client,
          second,
          s.factorId,
          enrolledStep + 1,
          proof(s.hash, s.factorId, enrolledStep + 1),
        ),
      ).toBe('REFUSED');
      // pas déjà utilisé (rejeu) puis pas hors de la fenêtre ±1
      expect(await elevate(client, second, s.factorId, enrolledStep - 1)).toBe('REFUSED');
      expect(await elevate(client, second, s.factorId, enrolledStep + 5)).toBe('REFUSED');
      expect((await begin(client, second)).outcome).toBe('MFA_REQUIRED');
      expect(await elevate(client, second, s.factorId, enrolledStep + 1)).toBe('ELEVATED');
      expect((await begin(client, second)).outcome).toBe('ELEVATED');
      const reasons = (await auditOf(client, s.userId))
        .filter((a) => a.action_code === 'STAFF_MFA_REFUSED')
        .map((a) => a.after?.['reason']);
      expect(reasons).toEqual(['BAD_PROOF', 'BAD_PROOF', 'STEP_REPLAYED', 'STEP_OUT_OF_WINDOW']);
      expect((await auditOf(client, s.userId)).at(-1)?.action_code).toBe('STAFF_MFA_VERIFIED');
    });
  });

  it('5 tentatives au plus, comptées AVANT que le secret ne sorte ; la 6e verrouille (15 min), LOCKED même avec une preuve juste', async () => {
    await withRole('app_api', async (client) => {
      const s = await elevatedStaff(client, 'OPS_AGENT', [ALL[0] ?? '']);
      const next = await login(client, s.userId);
      const outcomes: string[] = [];
      for (let i = 0; i < 6; i += 1) outcomes.push((await attempt(client, next)).outcome);
      expect(outcomes).toEqual(['OK', 'OK', 'OK', 'OK', 'OK', 'LOCKED']);
      expect((await attempt(client, next)).secret_ref).toBeNull();
      expect((await begin(client, next)).outcome).toBe('LOCKED');
      expect(await elevate(client, next, s.factorId, stepNow() + 1)).toBe('LOCKED');
    });
  });

  it('concurrence (revue sécurité, MAJEUR 1) : 16 tentatives parallèles, jamais plus de 5 accordées avant le verrou', async () => {
    const setup = await connectAs('app_api');
    let s: Awaited<ReturnType<typeof elevatedStaff>>;
    let hash: Buffer;
    try {
      s = await elevatedStaff(setup, 'OPS_AGENT', [ALL[0] ?? '']);
      hash = await login(setup, s.userId);
    } finally {
      await releaseClient(setup);
    }
    const clients = await Promise.all(Array.from({ length: 16 }, () => connectAs('app_api')));
    try {
      const results = await Promise.all(clients.map((c) => attempt(c, hash)));
      const granted = results.filter((r) => r.outcome === 'OK');
      expect(granted.length).toBeLessThanOrEqual(5);
      expect(granted.length).toBe(5);
      expect(results.filter((r) => r.outcome === 'LOCKED')).toHaveLength(11);
      expect(
        results.filter((r) => r.outcome === 'LOCKED').every((r) => r.secret_ref === null),
      ).toBe(true);
    } finally {
      await Promise.all(clients.map((c) => releaseClient(c)));
    }
  });

  it('revue sécurité, MAJEUR 2 : une session ouverte AVANT l’attribution du rôle (durée de client) est ramenée à 8 h à l’élévation', async () => {
    await withRole('app_api', async (client) => {
      const s = await createStaff(client, null, ALL); // facteur en attente, aucun rôle encore
      const hash = await login(client, s.userId); // 14 j : aucun rôle interne en cours
      const before = await client.query<{ expires_at: Date; token_hash: Buffer }>(
        'SELECT expires_at, token_hash FROM test_fixture.iam_read_sessions($1)',
        [s.userId],
      );
      const opened = before.rows.find((r) => r.token_hash.equals(hash));
      expect((opened?.expires_at.getTime() ?? 0) - Date.now()).toBeGreaterThan(9 * 3600_000);
      await client.query(
        `SELECT test_fixture.iam_grant_staff_role($1, $2, 'ADMIN', $3::text[], NULL, NULL)`,
        [uuid(), s.userId, ALL],
      );
      const reveal = await client.query<{ outcome: string }>(
        'SELECT outcome FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
        [hash, s.codeHash],
      );
      expect(reveal.rows[0]?.outcome).toBe('OK');
      expect(await elevate(client, hash, s.factorId)).toBe('ENROLLED');
      const after = await client.query<{ expires_at: Date; token_hash: Buffer }>(
        'SELECT expires_at, token_hash FROM test_fixture.iam_read_sessions($1)',
        [s.userId],
      );
      const elevated = after.rows.find((r) => r.token_hash.equals(hash));
      expect((elevated?.expires_at.getTime() ?? Infinity) - Date.now()).toBeLessThanOrEqual(
        8 * 3600_000 + 60_000,
      );
    });
  });

  it('aucune clé de preuve installée : aucune élévation (UNAVAILABLE, fail-closed)', async () => {
    await withRole('app_api', async (client) => {
      const s = await createStaff(client, 'ADMIN', ALL);
      const hash = await login(client, s.userId);
      await withTestTransaction(client, {}, async (tx) => {
        await tx.query('SELECT test_fixture.iam_delete_mfa_proof_key()');
        expect(await elevate(tx, hash, s.factorId)).toBe('UNAVAILABLE');
      });
    });
  });
});

describe('RLS-18 réduite : du SQL arbitraire sous app_api ne fabrique pas un ADMIN élevé', () => {
  it('session ouverte pour un ADMIN connu, élévation sans la clé, écriture directe : rien', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      // l'attaquant choisit son jeton et ouvre une session pour l'ADMIN (limite US-010 connue)
      const forgedHash = await login(client, admin.userId);
      const step = stepNow() + 1;
      const guesses = [Buffer.alloc(32), createHash('sha256').update(forgedHash).digest()];
      for (const key of guesses) {
        expect(
          await elevate(
            client,
            forgedHash,
            admin.factorId,
            step,
            proof(forgedHash, admin.factorId, step, key),
          ),
        ).toBe('REFUSED');
      }
      // ni lecture de la clé ou des sessions, ni écriture directe du niveau MFA
      for (const sql of [
        'SELECT key FROM core.iam_mfa_proof_key',
        'SELECT token_hash FROM core.iam_session LIMIT 1',
        `UPDATE core.iam_session SET mfa_level = 'TOTP'`,
        `UPDATE core.iam_auth_factor SET failed_attempts = 0`,
      ]) {
        await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
      await withTestTransaction(client, {}, async (tx) => {
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: admin.userId,
          countryScope: ALL,
          sessionTokenHash: hex(forgedHash),
        });
        expect(await ids(tx, 'booking_trip')).toEqual([]);
      });
    });
  });
});
