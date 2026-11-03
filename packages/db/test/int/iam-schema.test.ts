/**
 * Intégration du schéma IAM (US-010, migrations 0200, 0201 et test 9200), sous les rôles de
 * production (assertion L0-05 par withRole) :
 * - RLS ENABLE + FORCE sur toutes les tables iam_*, seule politique migrator_all (17 §2.3, B9) ;
 * - aucun droit de table pour app_api, app_worker, app_anon (les politiques par acteur : US-011) ;
 * - commandes core.iam_* : SECURITY DEFINER, propriétaire migrator, search_path figé, EXECUTE au
 *   seul app_api (liste blanche RLS-15 à reprendre par US-011) ;
 * - contraintes structurelles de 17 §3.2.1 utiles à US-011 (titulaire du compte d'hôte, portée
 *   par pays du staff, rôles).
 */
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { register, uuid } from '../support/iam.ts';

const IAM_TABLES = [
  'iam_auth_factor',
  'iam_email_verification',
  'iam_membership',
  'iam_organization',
  'iam_otp_challenge',
  'iam_restriction',
  'iam_role_permission',
  'iam_session',
  'iam_staff_role_assignment',
  'iam_user_account',
] as const;

const IAM_COMMANDS = [
  'core.iam_auth_lookup(text)',
  'core.iam_cmd_open_session(uuid,uuid,bytea,integer,text,inet,text)',
  'core.iam_cmd_register(uuid,text,text,text,text,text,uuid,bytea,integer,inet)',
  'core.iam_cmd_revoke_all_sessions(bytea)',
  'core.iam_cmd_revoke_session(bytea,text)',
  'core.iam_cmd_verify_email(bytea)',
  'core.iam_session_resolve(bytea)',
] as const;

describe('schéma IAM (US-010)', () => {
  it('tables iam_* : RLS ENABLE + FORCE, propriétaire migrator, seule politique migrator_all', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        relname: string;
        rls: boolean;
        force: boolean;
        owner: string;
        policies: string;
      }>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                pg_catalog.array_to_string(ARRAY(
                  SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                           SELECT pg_catalog.pg_get_userbyid(r) FROM pg_catalog.unnest(p.polroles) AS r), ',')
                    FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1), ';') AS policies
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p') AND c.relname ~ '^iam_'
          ORDER BY c.relname`,
      );
      expect(rows.map((r) => r.relname)).toEqual([...IAM_TABLES]);
      for (const r of rows) {
        expect(r, r.relname).toEqual({
          relname: r.relname,
          rls: true,
          force: true,
          owner: 'migrator',
          policies: 'migrator_all:migrator',
        });
      }
    });
  });

  it('aucun droit de table IAM pour app_api, app_worker, app_anon (lecture comprise)', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ g: string }>(
        `SELECT r.role || ':' || t.tbl || ':' || p.priv AS g
           FROM unnest($1::text[]) AS t(tbl),
                unnest(ARRAY['app_api', 'app_anon', 'app_worker']) AS r(role),
                unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(priv)
          WHERE pg_catalog.has_table_privilege(r.role, 'core.' || t.tbl, p.priv)`,
        [IAM_TABLES],
      );
      expect(rows).toEqual([]);
      for (const sql of [
        'SELECT password_hash FROM core.iam_user_account LIMIT 1',
        'SELECT token_hash FROM core.iam_session LIMIT 1',
        `UPDATE core.iam_session SET revoked_at = NULL`,
        `DELETE FROM core.iam_session`,
      ]) {
        await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
    });
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(client.query('SELECT 1 FROM core.iam_session LIMIT 1')).rejects.toMatchObject({
          code: '42501',
        });
      });
    }
  });

  it('commandes IAM : SECURITY DEFINER, propriétaire migrator, search_path figé, EXECUTE au seul app_api', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        fn: string;
        secdef: boolean;
        owner: string;
        config: string[] | null;
        api: boolean;
        worker: boolean;
        anon: boolean;
        public_exec: boolean;
      }>(
        `SELECT pg_catalog.regexp_replace(p.oid::regprocedure::text, ', ', ',', 'g') AS fn,
                p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
                p.proconfig AS config,
                pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE') AS api,
                pg_catalog.has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
                pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE') AS anon,
                COALESCE(p.proacl::text ~ '(^|[{,])=X', true) AS public_exec
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core' AND p.proname ~ '^iam_' AND p.prosecdef
          ORDER BY 1`,
      );
      expect(rows.map((r) => r.fn)).toEqual([...IAM_COMMANDS].sort());
      for (const r of rows) {
        expect(r, r.fn).toMatchObject({
          secdef: true,
          owner: 'migrator',
          api: true,
          worker: false,
          anon: false,
          public_exec: false,
        });
        expect(r.config, r.fn).toEqual(['search_path=pg_catalog, pg_temp']);
      }
      // la fonction de trigger de session n'est pas SECURITY DEFINER et n'est exécutable par personne
      const { rows: guard } = await client.query<{ secdef: boolean; api: boolean }>(
        `SELECT p.prosecdef AS secdef, pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE') AS api
           FROM pg_catalog.pg_proc p WHERE p.oid = 'core.iam_session_guard()'::regprocedure`,
      );
      expect(guard).toEqual([{ secdef: false, api: false }]);
    });
  });

  it('commandes IAM refusées à app_worker et app_anon (42501)', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query(`SELECT * FROM core.iam_session_resolve('\\x00'::bytea)`),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
  });

  it('compte d’hôte : un titulaire par pays ; le P2P_HOST de membership est le titulaire', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const holder = await register(tx);
        const other = await register(tx);
        const orgPa = uuid();
        await tx.query('SELECT test_fixture.iam_insert_organization($1, $2, $3)', [
          orgPa,
          holder.userId,
          'PA',
        ]);
        // même titulaire, autre pays : un second compte d'hôte (17 §2.3)
        await tx.query('SELECT test_fixture.iam_insert_organization($1, $2, $3)', [
          uuid(),
          holder.userId,
          'PY',
        ]);
        await tx.query('SAVEPOINT s');
        await expect(
          tx.query('SELECT test_fixture.iam_insert_organization($1, $2, $3)', [
            uuid(),
            holder.userId,
            'PA',
          ]),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'organization_country_holder_unique',
        });
        await tx.query('ROLLBACK TO SAVEPOINT s');
        // P2P_HOST qui n'est pas le titulaire : refusé par la clé étrangère
        await expect(
          tx.query('SELECT test_fixture.iam_insert_membership($1, $2, $3, $4, $5, $6)', [
            uuid(),
            other.userId,
            orgPa,
            'P2P_HOST',
            [],
            'ACTIVE',
          ]),
        ).rejects.toMatchObject({ code: '23503', constraint: 'membership_holder_matches_org' });
        await tx.query('ROLLBACK TO SAVEPOINT s');
        await tx.query('SELECT test_fixture.iam_insert_membership($1, $2, $3, $4, $5, $6)', [
          uuid(),
          holder.userId,
          orgPa,
          'P2P_HOST',
          [],
          'ACTIVE',
        ]);
        // co-hôte avec portée de véhicules : accepté ; portée sur un P2P_HOST : refusée
        await tx.query('SELECT test_fixture.iam_insert_membership($1, $2, $3, $4, $5, $6)', [
          uuid(),
          other.userId,
          orgPa,
          'CO_HOST',
          [uuid()],
          'INVITED',
        ]);
        await tx.query('SAVEPOINT t');
        await expect(
          tx.query(`SELECT test_fixture.iam_insert_organization($1, $2, 'pa')`, [
            uuid(),
            other.userId,
          ]),
        ).rejects.toMatchObject({ code: '23514', constraint: 'organization_country_format' });
        await tx.query('ROLLBACK TO SAVEPOINT t');
      });
    });
  });

  it('rôle interne : portée par pays obligatoire et bien formée ; aucune auto-attribution', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const staff = await register(tx);
        const admin = await register(tx);
        const grant = (scope: string[], grantedBy: string | null, role = 'OPS_AGENT') =>
          tx.query('SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4, $5, NULL)', [
            uuid(),
            staff.userId,
            role,
            scope,
            grantedBy,
          ]);
        await grant(['PA'], admin.userId);
        await grant(['PA', 'PY'], admin.userId, 'FINANCE');
        for (const [scope, by, constraint] of [
          [[], admin.userId, 'staff_country_scope_format'],
          [['pa'], admin.userId, 'staff_country_scope_format'],
          [['PA', 'PRY'], admin.userId, 'staff_country_scope_format'],
          [['PA'], staff.userId, 'staff_no_self_grant'],
        ] as const) {
          await tx.query('SAVEPOINT s');
          await expect(grant([...scope], by)).rejects.toMatchObject({ code: '23514', constraint });
          await tx.query('ROLLBACK TO SAVEPOINT s');
        }
        await expect(grant(['PA'], admin.userId, 'P2P_HOST')).rejects.toMatchObject({
          code: '23514',
          constraint: 'staff_role_valid',
        });
      });
    });
  });
});
