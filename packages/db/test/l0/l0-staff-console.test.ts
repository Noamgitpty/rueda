/**
 * Preuves de la console interne (US-012) sous le rôle de production app_api (assertion L0-05 en
 * tête de chaque test par withRole), avec des membres du staff enrôlés et élevés par les VRAIES
 * commandes (support/staff.ts), en USD (PA) et en PYG (PY) :
 * - critère 1 : un rôle sans droit d'annulation plateforme qui tente l'action => 403 journalisé ;
 * - un rôle sans MFA ne peut rien faire de sensible (refus journalisé) ;
 * - la portée pays est respectée (OPS d'un pays sur un trip de l'autre : refus journalisé) ;
 * - chaque action est journalisée (audit écrit par la commande, rattaché à manual_action) ;
 * - un compte suspendu perd tout (rôles, sessions, facteur, lectures RLS, console) ;
 * - réinitialisation du TOTP par un autre admin (16 ADM-001), lecture du journal (audit.read).
 * Valeurs attendues : 16 ADM-001 ; 17 §2.3 (matrice), §3.2.13, §10 ; ADR-062.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setSessionContext } from '../../src/index.ts';
import {
  connectAs,
  releaseClient,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { buildWorld, ids } from '../support/rls.ts';
import type { World } from '../support/rls.ts';
import {
  auditOf,
  begin,
  createStaff,
  elevatedStaff,
  installTestProofKey,
  login,
  uuid,
} from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
const FIRST = [COUNTRIES[0].country];
const REASON = 'Motif de test suffisamment long';
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

const trip = (i: number): string => world.countries[i]?.trips.a1.id ?? '';

/**
 * Action de console par le cadre d'US-101 (forme à pièces) : une action d'enregistrement seul
 * (RECORD_CLAIM) porte une pièce reçue du seau des preuves (fixture 9960) ; aucune saisie.
 */
async function act(
  client: pg.ClientBase,
  hash: Buffer,
  action: string,
  subject: string,
  requestId = uuid(),
): Promise<{ outcome: string; action_id: string | null }> {
  const evidence: string[] = [];
  if (action === 'RECORD_CLAIM') {
    const file = uuid();
    await client.query(`SELECT test_fixture.us101_insert_file($1, 'PRIVATE_EVIDENCE')`, [file]);
    evidence.push(file);
  }
  const { rows } = await client.query<{ outcome: string; action_id: string | null }>(
    'SELECT outcome, action_id FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])',
    [hash, requestId, action, subject, REASON, {}, evidence],
  );
  return rows[0] ?? { outcome: '', action_id: null };
}

async function suspend(client: pg.ClientBase, hash: Buffer, target: string): Promise<string> {
  const { rows } = await client.query<{ r: string }>(
    'SELECT core.iam_staff_cmd_suspend($1, $2, $3, $4) AS r',
    [hash, uuid(), target, REASON],
  );
  return rows[0]?.r ?? '';
}

describe('critère 1 — rôle sans droit d’annulation plateforme : 403 journalisé', () => {
  it.each(['FINANCE', 'SUPPORT_AGENT'])(
    '%s élevé tente CANCEL_TRIP_PLATFORM : FORBIDDEN, journalisé',
    async (role) => {
      await withRole('app_api', async (client) => {
        const s = await elevatedStaff(client, role, ALL);
        const requestId = uuid();
        expect(await act(client, s.hash, 'CANCEL_TRIP_PLATFORM', trip(0), requestId)).toEqual({
          outcome: 'FORBIDDEN',
          action_id: null,
        });
        const last = (await auditOf(client, s.userId)).at(-1);
        expect(last).toMatchObject({
          action_code: 'STAFF_FORBIDDEN',
          subject_type: 'TRIP',
          subject_id: trip(0),
          reason: REASON,
          request_id: requestId,
          after: {
            reason: 'PERMISSION',
            attempted: 'CANCEL_TRIP_PLATFORM',
            permission: 'ops.platform_cancel',
          },
        });
      });
    },
  );

  it('OPS et ADMIN ont le droit : la commande de domaine n’existe pas encore => UNAVAILABLE, journalisé (aucun faux changement d’état)', async () => {
    await withRole('app_api', async (client) => {
      for (const [role, scope] of [
        ['OPS_AGENT', FIRST],
        ['ADMIN', ALL],
      ] as const) {
        const s = await elevatedStaff(client, role, scope);
        expect((await act(client, s.hash, 'CANCEL_TRIP_PLATFORM', trip(0))).outcome, role).toBe(
          'UNAVAILABLE',
        );
        expect((await auditOf(client, s.userId)).at(-1)?.action_code, role).toBe(
          'MANUAL_ACTION_UNAVAILABLE',
        );
      }
    });
  });
});

describe('MFA, portée pays, journal', () => {
  it('rôle sans MFA (session NONE) : MFA_REQUIRED sur chaque commande, refus journalisé, rien d’écrit', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const ops = await elevatedStaff(client, 'OPS_AGENT', FIRST);
      const plain = await login(client, admin.userId); // même ADMIN, nouvelle session non élevée
      expect((await act(client, plain, 'RECORD_CLAIM', trip(0))).outcome).toBe('MFA_REQUIRED');
      expect(await suspend(client, plain, ops.userId)).toBe('MFA_REQUIRED');
      const read = await client.query('SELECT * FROM core.iam_staff_audit_read($1, NULL, 50)', [
        plain,
      ]);
      expect(read.rows).toEqual([]);
      const denied = (await auditOf(client, admin.userId)).filter(
        (a) => a.action_code === 'STAFF_ACCESS_DENIED',
      );
      expect(denied.map((a) => a.after?.['attempted'])).toEqual([
        'RECORD_CLAIM',
        'SUSPEND_STAFF',
        'AUDIT_READ',
      ]);
      expect((await begin(client, ops.hash)).outcome).toBe('ELEVATED'); // la cible n'a rien perdu
    });
  });

  it('portée pays : OPS du premier pays sur un trip du second => FORBIDDEN (COUNTRY_SCOPE) ; sujet inconnu => même issue', async () => {
    await withRole('app_api', async (client) => {
      const ops = await elevatedStaff(client, 'OPS_AGENT', FIRST);
      expect((await act(client, ops.hash, 'RECORD_CLAIM', trip(1))).outcome).toBe('FORBIDDEN');
      expect((await act(client, ops.hash, 'RECORD_CLAIM', uuid())).outcome).toBe('FORBIDDEN');
      expect((await act(client, ops.hash, 'RECORD_CLAIM', trip(0))).outcome).toBe('RECORDED');
      expect(
        (await auditOf(client, ops.userId)).map((a) => [
          a.action_code,
          a.after?.['reason'] ?? null,
        ]),
      ).toEqual([
        ['STAFF_TOTP_ENROLLED', null],
        ['STAFF_FORBIDDEN', 'COUNTRY_SCOPE'],
        ['STAFF_FORBIDDEN', 'SUBJECT_NOT_FOUND'],
        ['MANUAL_ACTION_RECORDED', null],
      ]);
    });
  });

  it('action enregistrée : manual_action rattachée à SA ligne d’audit ; même request_id => DUPLICATE sans seconde écriture', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const requestId = uuid();
      const first = await act(client, admin.hash, 'RECORD_CLAIM', trip(1), requestId);
      expect(first).toEqual({ outcome: 'RECORDED', action_id: requestId });
      const again = await act(client, admin.hash, 'RECORD_CLAIM', trip(1), requestId);
      expect(again).toEqual({ outcome: 'DUPLICATE', action_id: requestId });
      const audit = (await auditOf(client, admin.userId)).filter(
        (a) => a.action_code === 'MANUAL_ACTION_RECORDED',
      );
      expect(audit).toHaveLength(1);
      expect(audit[0]?.after).toMatchObject({
        manualActionId: requestId,
        action: 'RECORD_CLAIM',
        mode: 'RECORD_ONLY',
        country: COUNTRIES[1].country,
      });
      const { rows } = await client.query<{
        action_code: string;
        country_code: string;
        actor_role: string;
        audit_log_id: string;
      }>('SELECT * FROM test_fixture.manual_action_row($1)', [requestId]);
      expect(rows).toEqual([
        {
          action_code: 'RECORD_CLAIM',
          mode: 'RECORD_ONLY',
          country_code: COUNTRIES[1].country,
          actor_role: 'ADMIN',
          audit_log_id: audit[0]?.id,
        },
      ]);
      // app_api n'écrit ni ne lit manual_action directement
      await expect(client.query('SELECT 1 FROM core.support_manual_action')).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  it('motif trop court ou action inconnue : 22023, rien n’est écrit', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const before = (await auditOf(client, admin.userId)).length;
      for (const [action, reason] of [
        ['RECORD_CLAIM', 'court'],
        ['DELETE_EVERYTHING', REASON],
      ] as const) {
        await expect(
          client.query('SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, NULL)', [
            admin.hash,
            uuid(),
            action,
            trip(0),
            reason,
          ]),
          action,
        ).rejects.toMatchObject({ code: '22023' });
      }
      expect(await auditOf(client, admin.userId)).toHaveLength(before);
    });
  });
});

describe('suspension : un compte suspendu perd tout', () => {
  it('ADMIN suspend un OPS : rôles finis, sessions révoquées, facteur désactivé, RLS et console fermées', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const ops = await elevatedStaff(client, 'OPS_AGENT', FIRST);
      expect(await suspend(client, admin.hash, ops.userId)).toBe('DONE');
      // sessions : la session élevée de l'OPS ne se résout plus (console : AUTH_REQUIRED)
      expect((await begin(client, ops.hash)).outcome).toBe('AUTH_REQUIRED');
      const { rows: session } = await client.query<{ revoked_reason: string }>(
        'SELECT revoked_reason FROM test_fixture.iam_read_session_mfa($1)',
        [ops.hash],
      );
      expect(session).toEqual([{ revoked_reason: 'ADMIN' }]);
      // RLS : même avec la preuve de son ancienne session, rien
      await withTestTransaction(client, {}, async (tx) => {
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: ops.userId,
          countryScope: FIRST,
          sessionTokenHash: ops.hash.toString('hex'),
        });
        for (const t of ['booking_trip', 'support_support_case', 'iam_organization']) {
          expect(await ids(tx, t), t).toEqual([]);
        }
      });
      // nouvelle connexion (le mot de passe reste valable) : plus aucun rôle
      const again = await login(client, ops.userId);
      expect((await begin(client, again)).outcome).toBe('NOT_STAFF');
      expect((await act(client, again, 'RECORD_CLAIM', trip(0))).outcome).toBe('MFA_REQUIRED');
      const { rows: factors } = await client.query<{ disabled: boolean }>(
        'SELECT disabled_at IS NOT NULL AS disabled FROM test_fixture.iam_read_factors($1)',
        [ops.userId],
      );
      expect(factors).toEqual([{ disabled: true }]);
      const last = (await auditOf(client, admin.userId)).at(-1);
      expect(last).toMatchObject({
        action_code: 'STAFF_SUSPENDED',
        actor_role: 'ADMIN',
        subject_id: ops.userId,
        before: { roles: [{ role: 'OPS_AGENT', countries: FIRST }] },
        after: { roles: [], sessionsRevoked: 1, factorsDisabled: 1 },
      });
    });
  });

  it('autorité : jamais soi-même ; un ADMIN ne suspend pas un ADMIN ; un ADMIN d’un pays ne vise pas un OPS de l’autre ; refus journalisés', async () => {
    await withRole('app_api', async (client) => {
      const adminAll = await elevatedStaff(client, 'ADMIN', ALL);
      const adminFirst = await elevatedStaff(client, 'ADMIN', FIRST);
      const opsSecond = await elevatedStaff(client, 'OPS_AGENT', [COUNTRIES[1].country]);
      const ops = await elevatedStaff(client, 'OPS_AGENT', FIRST);
      expect(await suspend(client, adminAll.hash, adminAll.userId)).toBe('FORBIDDEN');
      expect(await suspend(client, adminAll.hash, adminFirst.userId)).toBe('FORBIDDEN');
      expect(await suspend(client, adminFirst.hash, opsSecond.userId)).toBe('FORBIDDEN');
      expect(await suspend(client, ops.hash, opsSecond.userId)).toBe('FORBIDDEN');
      expect(
        (await auditOf(client, adminAll.userId))
          .filter((a) => a.action_code === 'STAFF_FORBIDDEN')
          .map((a) => a.after?.['reason']),
      ).toEqual(['SELF', 'TARGET_PRIVILEGED']);
      expect((await auditOf(client, adminFirst.userId)).at(-1)?.after?.['reason']).toBe(
        'PERMISSION_OR_COUNTRY',
      );
      // les cibles n'ont rien perdu
      for (const t of [adminFirst, opsSecond]) {
        expect((await begin(client, t.hash)).outcome).toBe('ELEVATED');
      }
    });
  });

  it('un SUPERADMIN suspend un ADMIN', async () => {
    await withRole('app_api', async (client) => {
      const sa = await elevatedStaff(client, 'SUPERADMIN', ALL);
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      expect(await suspend(client, sa.hash, admin.userId)).toBe('DONE');
      expect((await begin(client, admin.hash)).outcome).toBe('AUTH_REQUIRED');
    });
  });
});

describe('réinitialisation du TOTP par un autre admin, lecture du journal', () => {
  it('ADMIN réinitialise le TOTP d’un OPS : ancien facteur désactivé, sessions révoquées, nouveau facteur en attente ; journalisé', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const ops = await elevatedStaff(client, 'OPS_AGENT', FIRST);
      const factorId = uuid();
      const { rows } = await client.query<{ r: string }>(
        `SELECT core.iam_staff_cmd_reset_totp($1, $2, $3, $4, $5, 'fake-vault:reset', $6, 86400) AS r`,
        [admin.hash, uuid(), ops.userId, REASON, factorId, ops.codeHash],
      );
      expect(rows[0]?.r).toBe('DONE');
      expect((await begin(client, ops.hash)).outcome).toBe('AUTH_REQUIRED');
      const fresh = await login(client, ops.userId);
      expect(await begin(client, fresh)).toMatchObject({
        outcome: 'ENROLLMENT_REQUIRED',
        factor_id: factorId,
      });
      const { rows: factors } = await client.query<{ id: string; disabled: boolean }>(
        'SELECT id, disabled_at IS NOT NULL AS disabled FROM test_fixture.iam_read_factors($1)',
        [ops.userId],
      );
      expect(factors).toEqual([
        { id: ops.factorId, disabled: true },
        { id: factorId, disabled: false },
      ]);
      expect((await auditOf(client, admin.userId)).at(-1)).toMatchObject({
        action_code: 'STAFF_TOTP_RESET',
        subject_id: ops.userId,
        after: { factorId, sessionsRevoked: 1 },
      });
    });
  });

  it('audit.read : ADMIN lit le journal (refus compris), OPS seulement ses lignes, jamais d’IP', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const finance = await elevatedStaff(client, 'FINANCE', ALL);
      const ops = await elevatedStaff(client, 'OPS_AGENT', FIRST);
      await act(client, finance.hash, 'CANCEL_TRIP_PLATFORM', trip(0)); // 403 journalisé
      const read = async (hash: Buffer) =>
        (
          await client.query<{ actor_user_id: string; action_code: string }>(
            'SELECT * FROM core.iam_staff_audit_read($1, NULL, 200)',
            [hash],
          )
        ).rows;
      const byAdmin = await read(admin.hash);
      expect(byAdmin).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            actor_user_id: finance.userId,
            action_code: 'STAFF_FORBIDDEN',
          }),
        ]),
      );
      expect(Object.keys(byAdmin[0] ?? {})).not.toContain('ip_enc');
      const byOps = await read(ops.hash);
      expect(byOps.length).toBeGreaterThan(0);
      expect(new Set(byOps.map((r) => r.actor_user_id))).toEqual(new Set([ops.userId]));
      // SUPPORT_AGENT n'a pas audit.read en Bêta : aucune ligne, refus journalisé
      const support = await elevatedStaff(client, 'SUPPORT_AGENT', ALL);
      expect(await read(support.hash)).toEqual([]);
      expect((await auditOf(client, support.userId)).at(-1)).toMatchObject({
        action_code: 'STAFF_FORBIDDEN',
        after: { attempted: 'AUDIT_READ', reason: 'PERMISSION' },
      });
      // compte de staff créé hors MFA : la lecture reste vide
      const noMfa = await createStaff(client, 'ADMIN', ALL, { withFactor: false });
      expect(await read(await login(client, noMfa.userId))).toEqual([]);
    });
  });
});

describe('journal borné au pays (décision de l’orchestrateur, ADR-062 point 10)', () => {
  it('un ADMIN du premier pays ne lit rien du second ni d’une action globale ; un ADMIN des deux pays lit tout', async () => {
    await withRole('app_api', async (client) => {
      const [first, second] = [COUNTRIES[0].country, COUNTRIES[1].country];
      const adminFirst = await elevatedStaff(client, 'ADMIN', [first]);
      const adminAll = await elevatedStaff(client, 'ADMIN', ALL);
      const opsFirst = await elevatedStaff(client, 'OPS_AGENT', [first]);
      const opsSecond = await elevatedStaff(client, 'OPS_AGENT', [second]);
      const inFirst = await act(client, opsFirst.hash, 'RECORD_CLAIM', trip(0));
      const inSecond = await act(client, opsSecond.hash, 'RECORD_CLAIM', trip(1));
      expect([inFirst.outcome, inSecond.outcome]).toEqual(['RECORDED', 'RECORDED']);
      // action GLOBALE (aucun pays) : refus d'accès d'un compte sans rôle interne
      const outsider = await createStaff(client, null, ALL);
      expect((await begin(client, await login(client, outsider.userId))).outcome).toBe('NOT_STAFF');

      // les pays sont dérivés de l'action et de sa cible, et entrent dans la ligne chaînée
      const rowsOf = async (actor: string) => auditOf(client, actor);
      expect((await rowsOf(opsFirst.userId)).at(-1)?.after?.['countries']).toEqual([first]);
      expect((await rowsOf(opsSecond.userId)).at(-1)?.after?.['countries']).toEqual([second]);
      expect((await rowsOf(outsider.userId)).at(-1)?.after?.['countries']).toEqual([]);

      const read = async (hash: Buffer) =>
        (
          await client.query<{
            id: string;
            actor_user_id: string;
            after: { countries?: string[] };
          }>('SELECT id, actor_user_id, after FROM core.iam_staff_audit_read($1, NULL, 200)', [
            hash,
          ])
        ).rows;
      const actors = (rows: { actor_user_id: string }[]) =>
        new Set(rows.map((r) => r.actor_user_id));

      const byFirst = await read(adminFirst.hash);
      expect(actors(byFirst).has(opsFirst.userId)).toBe(true);
      expect(actors(byFirst).has(opsSecond.userId)).toBe(false);
      expect(actors(byFirst).has(outsider.userId)).toBe(false);
      for (const r of byFirst) {
        if (r.actor_user_id === adminFirst.userId) continue; // ses propres lignes
        expect(r.after.countries?.length ?? 0, r.id).toBeGreaterThan(0);
        expect(
          r.after.countries?.every((c) => c === first),
          r.id,
        ).toBe(true);
      }

      const byAll = await read(adminAll.hash);
      for (const who of [opsFirst.userId, opsSecond.userId, outsider.userId]) {
        expect(actors(byAll).has(who), who).toBe(true);
      }
    });
  });
});
