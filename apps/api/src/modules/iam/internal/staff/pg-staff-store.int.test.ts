/**
 * test:int — console interne de bout en bout sur la base jetable du banc de @rueda/db, sous
 * app_api (assertion L0-05 par connectAs) : `StaffAuthService` + `PgStaffStore` + commandes
 * `core.iam_staff_*`, avec un VRAI code TOTP (RFC 6238) calculé ici, le secret dans le coffre FAKE
 * et la clé de preuve de TEST installée par la fixture 9600 (valeur publique, jamais un secret).
 * Prouve que la preuve HMAC calculée en TypeScript est celle que la base recalcule en SQL, et que :
 * - un compte staff sans TOTP n'obtient jamais de principal (403 2FA_REQUIRED) — critère 2 ;
 * - enrôlement (code remis hors bande) puis console ; code faux compté ; rejeu refusé ;
 * - la suspension par un ADMIN fait tout perdre (401 au lieu du principal).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connectAs, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeTotpSecretVault } from '../../testing/fake-totp-vault.js';
import { StaffAuthService } from './staff.service.js';
import { PgStaffStore } from './staff-store.js';
import { hotp, totpStep } from './totp.js';

/** Clé de preuve de TEST : la même dérivation que packages/db/test/support/staff.ts. */
const TEST_PROOF_KEY = createHash('sha256')
  .update('rueda-test-mfa-proof-key (valeur de test publique)', 'utf8')
  .digest();
const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

let client: pg.Client;
let vault: FakeTotpSecretVault;
let staff: StaffAuthService;

// Une connexion par test : connectAs fait l'assertion L0-05 de CHAQUE test.
beforeEach(async () => {
  client = await connectAs('app_api');
  await client.query('SELECT test_fixture.iam_install_mfa_proof_key($1)', [TEST_PROOF_KEY]);
  vault = new FakeTotpSecretVault();
  staff = new StaffAuthService({
    store: new PgStaffStore(client),
    vault,
    proofKey: TEST_PROOF_KEY,
    issuer: 'Console',
  });
});

afterEach(async () => {
  await releaseClient(client);
});

const token = (): string => randomBytes(32).toString('base64url');
const sha = (t: string): Buffer => createHash('sha256').update(t, 'utf8').digest();

/** Compte staff ACTIVE, rôle, facteur en attente (secret au coffre FAKE), session NONE. */
async function staffWithSession(
  role: string,
  countries: readonly string[],
  withFactor = true,
): Promise<{ userId: string; token: string; secret: Buffer; code: string }> {
  const userId = randomUUID();
  await client.query(
    `SELECT core.iam_cmd_register($1, $2, $3, 'Int', 'Test', 'es', $4, $5, 86400, NULL)`,
    [userId, `int-${userId}@example.test`, PHC, randomUUID(), randomBytes(32)],
  );
  await client.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [userId]);
  await client.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`,
    [randomUUID(), userId, role, countries],
  );
  const secret = randomBytes(20);
  const code = 'ABCDEFGHIJKLMNOP';
  if (withFactor) {
    const ref = await vault.store(secret);
    await client.query(`SELECT test_fixture.iam_insert_pending_totp($1, $2, $3, $4, 86400)`, [
      randomUUID(),
      userId,
      ref,
      sha(code),
    ]);
  }
  const t = token();
  await client.query(`SELECT core.iam_cmd_open_session($1, $2, $3, 3600, 'NONE', NULL, 'int')`, [
    randomUUID(),
    userId,
    sha(t),
  ]);
  return { userId, token: t, secret, code };
}

const countries = async (): Promise<string[]> =>
  (
    await client.query<{ code: string }>(
      'SELECT code::text AS code FROM core.config_country ORDER BY code',
    )
  ).rows.map((r) => r.code);

describe('console interne de bout en bout (PostgreSQL, app_api)', () => {
  it('critère 2 : compte staff sans TOTP => 403 2FA_REQUIRED, jamais de principal', async () => {
    const s = await staffWithSession('ADMIN', await countries(), false);
    await expect(staff.principal(s.token)).rejects.toMatchObject({ code: '2FA_REQUIRED' });
    expect((await staff.access(s.token))?.access.outcome).toBe('TOTP_NOT_ENROLLED');
  });

  it('enrôlement puis élévation par un vrai code TOTP : la preuve TypeScript = la preuve SQL', async () => {
    const s = await staffWithSession('OPS_AGENT', (await countries()).slice(0, 1));
    await expect(staff.principal(s.token)).rejects.toMatchObject({ code: '2FA_REQUIRED' });
    const revealed = await staff.enroll(s.token, s.code);
    expect(revealed.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const code = hotp(s.secret, totpStep(Date.now()));
    // code faux d'abord : compté, refusé
    await expect(
      staff.verify(s.token, {
        code: code === '000000' ? '111111' : '000000',
        enrollmentCode: s.code,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_TOTP_INVALID' });
    expect(await staff.verify(s.token, { code, enrollmentCode: s.code })).toBe('ENROLLED');
    const p = await staff.principal(s.token);
    expect(p.userId).toBe(s.userId);
    expect(p.roles.map((r) => r.role)).toEqual(['OPS_AGENT']);
    // même code sur une nouvelle session : rejeu refusé (pas déjà consommé, relu en base)
    const second = token();
    await client.query(`SELECT core.iam_cmd_open_session($1, $2, $3, 3600, 'NONE', NULL, 'int')`, [
      randomUUID(),
      s.userId,
      sha(second),
    ]);
    await expect(staff.verify(second, { code })).rejects.toMatchObject({
      code: 'AUTH_TOTP_INVALID',
    });
  });

  it('suspension par un ADMIN : la cible perd tout (401), l’auteur garde sa console', async () => {
    const all = await countries();
    const admin = await staffWithSession('ADMIN', all);
    await staff.enroll(admin.token, admin.code);
    await staff.verify(admin.token, {
      code: hotp(admin.secret, totpStep(Date.now())),
      enrollmentCode: admin.code,
    });
    const ops = await staffWithSession('OPS_AGENT', all.slice(0, 1));
    await staff.enroll(ops.token, ops.code);
    await staff.verify(ops.token, {
      code: hotp(ops.secret, totpStep(Date.now())),
      enrollmentCode: ops.code,
    });
    expect((await staff.principal(ops.token)).userId).toBe(ops.userId);
    const principal = await staff.principal(admin.token);
    await staff.suspend(principal, ops.userId, 'Départ de l’équipe, accès retiré');
    await expect(staff.principal(ops.token)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect((await staff.principal(admin.token)).userId).toBe(admin.userId);
    // un OPS ne suspend personne : 403 FORBIDDEN (journalisé en base)
    const ops2 = await staffWithSession('OPS_AGENT', all.slice(0, 1));
    await staff.enroll(ops2.token, ops2.code);
    await staff.verify(ops2.token, {
      code: hotp(ops2.secret, totpStep(Date.now())),
      enrollmentCode: ops2.code,
    });
    await expect(
      staff.suspend(await staff.principal(ops2.token), admin.userId, 'Tentative non autorisée'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const journal = await staff.audit(principal, undefined, '200');
    expect(journal.map((e) => e.actionCode)).toEqual(
      expect.arrayContaining(['STAFF_SUSPENDED', 'STAFF_FORBIDDEN', 'STAFF_TOTP_ENROLLED']),
    );
  });
});
