/**
 * Intégration du schéma d'audit (US-009, migrations 0016 à 0021, test 9150 ; ADR-051).
 * Vérifie, sous les rôles de production, ce que les preuves L0 d'audit supposent :
 * - RLS ENABLE + FORCE et politique migrator_all sur TOUTES les tables de core (CLAUDE.md point 5) ;
 * - aucun UPDATE / DELETE / TRUNCATE pour aucun rôle applicatif sur les tables d'audit, aucune
 *   politique UPDATE / DELETE / ALL hors migrator_all (17 §3.1.2) ;
 * - INSERT par colonnes : id, at, prev_hash, hash, created_at, destroyed_at, server_received_at
 *   ne sont jamais fournis par le client ;
 * - triggers de refus et de chaîne présents ; zz_audit_log_chain est le DERNIER trigger BEFORE
 *   INSERT (la ligne hachée est la ligne écrite) ;
 * - fonction de chaîne SECURITY DEFINER (propriétaire migrator, search_path figé, sans EXECUTE) ;
 *   procédure de destruction SECURITY INVOKER et inaccessible aux rôles applicatifs.
 */
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';

const AUDIT_TABLES = [
  'audit_audit_log',
  'audit_chain_head',
  'audit_data_access_log',
  'audit_file_asset',
  'audit_subject_key',
] as const;

const APP_ROLES = ['app_api', 'app_worker', 'app_anon'] as const;

describe('schéma d’audit (US-009)', () => {
  it('toutes les tables de core : RLS ENABLE + FORCE, migrator_all, propriétaire migrator ; tables d’audit présentes', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{
        relname: string;
        rls: boolean;
        force: boolean;
        owner: string;
        migrator_all: boolean;
      }>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
                         WHERE p.polrelid = c.oid AND p.polname = 'migrator_all') AS migrator_all
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p')
          ORDER BY c.relname`,
      );
      for (const t of AUDIT_TABLES) expect(rows.map((r) => r.relname)).toContain(t);
      for (const r of rows) {
        expect(r, r.relname).toMatchObject({
          rls: true,
          force: true,
          owner: 'migrator',
          migrator_all: true,
        });
      }
    });
  });

  it('aucun UPDATE / DELETE / TRUNCATE pour un rôle applicatif ; rien pour app_anon', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ role: string; tbl: string; priv: string }>(
        `SELECT r.role, t.tbl, p.priv
           FROM unnest($1::text[]) AS t(tbl),
                unnest($2::text[]) AS r(role),
                unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(priv)
          WHERE pg_catalog.has_table_privilege(r.role, 'core.' || t.tbl, p.priv)
             OR (p.priv IN ('SELECT', 'INSERT', 'UPDATE')
                 AND pg_catalog.has_any_column_privilege(r.role, 'core.' || t.tbl, p.priv))
          ORDER BY 1, 2, 3`,
        [AUDIT_TABLES, APP_ROLES],
      );
      const granted = rows.map((r) => `${r.role}:${r.tbl}:${r.priv}`);
      expect(
        granted.filter((g) => /:(UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER)$/.test(g)),
      ).toEqual([]);
      expect(granted.filter((g) => g.startsWith('app_anon:'))).toEqual([]);
      // ce qui reste : écriture par colonnes et lectures ciblées (0021)
      expect(granted).toEqual(
        [
          'app_api:audit_audit_log:INSERT',
          'app_api:audit_data_access_log:INSERT',
          'app_api:audit_file_asset:INSERT',
          'app_api:audit_subject_key:INSERT',
          'app_api:audit_subject_key:SELECT',
          'app_worker:audit_audit_log:INSERT',
          'app_worker:audit_audit_log:SELECT',
          'app_worker:audit_chain_head:SELECT',
          'app_worker:audit_data_access_log:INSERT',
          'app_worker:audit_file_asset:INSERT',
          'app_worker:audit_file_asset:SELECT',
          'app_worker:audit_subject_key:INSERT',
          'app_worker:audit_subject_key:SELECT',
        ].sort(),
      );
    });
  });

  it('INSERT par colonnes : le client ne fournit jamais les colonnes de chaîne, d’horloge ni de destruction', async () => {
    await withRole('app_worker', async (client) => {
      const forbidden: ReadonlyArray<readonly [string, string]> = [
        ['audit_audit_log', 'id'],
        ['audit_audit_log', 'at'],
        ['audit_audit_log', 'prev_hash'],
        ['audit_audit_log', 'hash'],
        ['audit_data_access_log', 'at'],
        ['audit_subject_key', 'created_at'],
        ['audit_subject_key', 'destroyed_at'],
        ['audit_subject_key', 'destroy_request_id'],
        ['audit_file_asset', 'server_received_at'],
        ['audit_file_asset', 'legal_hold_until'],
        ['audit_file_asset', 'deleted_at'],
      ];
      for (const role of ['app_api', 'app_worker']) {
        for (const [tbl, col] of forbidden) {
          const { rows } = await client.query<{ has: boolean }>(
            `SELECT pg_catalog.has_column_privilege($1, $2, $3, 'INSERT') AS has`,
            [role, `core.${tbl}`, col],
          );
          expect(rows[0]?.has, `${role} ${tbl}.${col}`).toBe(false);
        }
      }
    });
  });

  it('politiques : aucune pour PUBLIC ni app_anon ; aucune UPDATE / DELETE / ALL hors migrator_all et le propriétaire de la chaîne', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{
        relname: string;
        polname: string;
        cmd: string;
        roles: string;
      }>(
        `SELECT c.relname, p.polname, p.polcmd::text AS cmd,
                pg_catalog.array_to_string(ARRAY(
                  SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END
                    FROM pg_catalog.unnest(p.polroles) AS r ORDER BY 1), ',') AS roles
           FROM pg_catalog.pg_policy p
           JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname = ANY ($1::text[]) AND p.polname <> 'migrator_all'`,
        [AUDIT_TABLES],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        const where = `${r.relname}.${r.polname}`;
        if (r.roles === 'iam_staff_owner' || r.roles === 'cmd_money_owner') {
          // US-062 (0036) : même usage par les commandes FINANCE à deux personnes
          // US-012 (0033) : écriture au journal par les commandes de la console et relecture sans
          // C2 (core.iam_staff_audit_read) ; aucune UPDATE / DELETE
          expect(['r', 'a'], where).toContain(r.cmd);
          continue;
        }
        if (r.roles === 'catalog_cmd_owner') {
          // US-115 (0067) : soumission et suppression d'annonce journalisées ; fichier d'une photo
          // d'annonce (bucket public, C0) ; INSERT seulement
          expect(
            [
              'audit_audit_log.catalog_cmd_audit_insert',
              'audit_file_asset.catalog_cmd_photo_insert',
            ],
            where,
          ).toContain(where);
          expect(r.cmd, where).toBe('a');
          continue;
        }
        if (r.roles === 'iam_auth_owner') {
          // US-107 (0061) : ouverture d'un compte d'hôte journalisée, INSERT seulement
          expect(where).toBe('audit_audit_log.iam_auth_host_insert');
          expect(r.cmd, where).toBe('a');
          continue;
        }
        if (r.roles === 'audit_chain_owner') {
          // US-011 (0026) : lecture et verrou des clés, avance de la tête ; aucun INSERT / DELETE
          expect(['r', 'w'], where).toContain(r.cmd);
          continue;
        }
        expect(['app_api', 'app_worker'], where).toContain(r.roles);
        expect(['r', 'a'], where).toContain(r.cmd); // SELECT ou INSERT seulement
      }
    });
  });

  it('triggers de refus et de chaîne ; zz_audit_log_chain est le dernier BEFORE INSERT', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ tbl: string; tgname: string; def: string }>(
        `SELECT c.relname AS tbl, t.tgname, pg_catalog.pg_get_triggerdef(t.oid) AS def
           FROM pg_catalog.pg_trigger t
           JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname = ANY ($1::text[]) AND NOT t.tgisinternal
          ORDER BY c.relname, t.tgname`,
        [AUDIT_TABLES],
      );
      const names = rows.map((r) => `${r.tbl}.${r.tgname}`);
      expect(names).toEqual(
        [
          'audit_audit_log.audit_log_append_only',
          'audit_audit_log.audit_log_no_truncate',
          'audit_audit_log.zz_audit_log_chain',
          'audit_chain_head.audit_chain_head_guard',
          'audit_chain_head.audit_chain_head_no_truncate',
          'audit_data_access_log.data_access_log_append_only',
          'audit_data_access_log.data_access_log_no_truncate',
          'audit_file_asset.file_asset_immutable',
          'audit_file_asset.file_asset_no_truncate',
          'audit_subject_key.subject_key_immutable',
          'audit_subject_key.subject_key_no_truncate',
        ].sort(),
      );
      for (const r of rows) {
        // tous les déclencheurs sont actifs (tgenabled = 'O'), vérifié par leur définition
        expect(r.def, r.tgname).toMatch(/BEFORE/);
      }
      const { rows: enabled } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM pg_catalog.pg_trigger t
           JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname = ANY ($1::text[]) AND NOT t.tgisinternal
            AND t.tgenabled <> 'O'`,
        [AUDIT_TABLES],
      );
      expect(enabled[0]?.n).toBe(0);
      // dernier trigger BEFORE INSERT ligne par ligne de audit_audit_log (ordre alphabétique)
      const { rows: beforeInsert } = await client.query<{ tgname: string }>(
        `SELECT t.tgname
           FROM pg_catalog.pg_trigger t
          WHERE t.tgrelid = 'core.audit_audit_log'::regclass AND NOT t.tgisinternal
            AND (t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4
          ORDER BY t.tgname`,
      );
      expect(beforeInsert.at(-1)?.tgname).toBe('zz_audit_log_chain');
    });
  });

  it('fonction de chaîne SECURITY DEFINER sous audit_chain_owner (US-011) ; aucune fonction d’audit exécutable par un rôle applicatif', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{
        fn: string;
        secdef: boolean;
        owner: string;
        config: string[] | null;
      }>(
        `SELECT p.oid::regprocedure::text AS fn, p.prosecdef AS secdef,
                pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core' AND p.proname LIKE 'audit%'
          ORDER BY 1`,
      );
      expect(rows.map((r) => r.fn)).toEqual(
        [
          'core.audit_append_only()',
          'core.audit_canon(text)',
          'core.audit_chain_head_guard()',
          'core.audit_destroy_subject_key(text,uuid,uuid,text)',
          'core.audit_file_asset_guard()',
          'core.audit_log_canonical(core.audit_audit_log)',
          'core.audit_log_chain()',
          'core.audit_subject_key_guard()',
        ].sort(),
      );
      for (const r of rows) {
        expect(r.owner, r.fn).toBe(
          r.fn === 'core.audit_log_chain()' ? 'audit_chain_owner' : 'migrator',
        );
        expect(r.config, r.fn).toEqual(['search_path=pg_catalog, pg_temp']);
        expect(r.secdef, r.fn).toBe(r.fn === 'core.audit_log_chain()');
        for (const role of APP_ROLES) {
          const { rows: ex } = await client.query<{ has: boolean }>(
            `SELECT pg_catalog.has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS has`,
            [role, r.fn],
          );
          expect(ex[0]?.has, `${role} EXECUTE ${r.fn}`).toBe(false);
        }
      }
    });
  });

  it('tête de chaîne initialisée (une ligne) et lisible par audit_chain_verifier seulement', async () => {
    await withRole('app_worker', async (client) => {
      const count = `SELECT count(*)::int AS n FROM core.audit_chain_head`;
      expect((await client.query<{ n: number }>(count)).rows[0]?.n).toBe(0); // contexte absent
      await client.query('BEGIN');
      try {
        await client.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
                  pg_catalog.set_config('app.worker_name', 'audit_chain_verifier', true)`,
        );
        expect((await client.query<{ n: number }>(count)).rows[0]?.n).toBe(1);
        await client.query(`SELECT pg_catalog.set_config('app.worker_name', 'hold_expiry', true)`);
        expect((await client.query<{ n: number }>(count)).rows[0]?.n).toBe(0);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('fixtures d’audit (9150) présentes dans la base principale, absentes de la base de production', async () => {
    const query = `SELECT pg_catalog.to_regprocedure('test_fixture.owner_tamper_audit_log(text,bigint,boolean)') IS NOT NULL AS tamper,
                          pg_catalog.to_regclass('core.audit_audit_log') IS NOT NULL AS audit`;
    await withRole('app_worker', async (client) => {
      expect((await client.query(query)).rows[0]).toEqual({ tamper: true, audit: true });
    });
    await withRole(
      'app_worker',
      async (client) => {
        expect((await client.query(query)).rows[0]).toEqual({ tamper: false, audit: true });
      },
      { database: 'production' },
    );
  });
});
