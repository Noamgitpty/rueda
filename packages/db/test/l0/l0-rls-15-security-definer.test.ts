/**
 * RLS-15 et RLS-16 (17 §2.3, §11 L0-05 ; US-011, ADR-053) : inventaire `pg_proc` de la base de
 * PRODUCTION du banc (migrations de production seules, sans test_fixture), sous app_api.
 *
 * - toute fonction ou procédure SECURITY DEFINER est dans `security-definer-allowlist.json`, avec
 *   exactement son propriétaire NOLOGIN, `search_path = pg_catalog, pg_temp` et ses rôles EXECUTE ;
 * - aucune n'appartient à migrator ni à un rôle de connexion ; aucune n'est exécutable par PUBLIC ;
 * - toute fonction des schémas du projet (core, app, platform) a un search_path figé (RLS-16 :
 *   `pg_temp` en dernier, un objet homonyme créé dans pg_temp n'est pas résolu) et aucune n'est
 *   exécutable par PUBLIC ; app_api ne peut d'ailleurs créer aucun objet temporaire.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOGIN_ROLES, OWNER_ROLES, PACKAGE_ROOT } from '../../src/index.ts';
import { withRole } from '../../src/testing/index.ts';

interface AllowEntry {
  readonly signature: string;
  readonly family: string;
  readonly owner: string;
  readonly execute: readonly string[];
  readonly story: string;
}
const allowlist = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'security-definer-allowlist.json'), 'utf8'),
) as { searchPath: string; functions: AllowEntry[] };

const PROJECT_SCHEMAS = ['core', 'app', 'platform'];

interface ProcRow {
  signature: string;
  owner: string;
  config: string[] | null;
  executors: string[];
  public_exec: boolean;
}

const PROC_SQL = `
  SELECT pg_catalog.regexp_replace(p.oid::regprocedure::text, ',\\s+', ',', 'g') AS signature,
         pg_catalog.pg_get_userbyid(p.proowner) AS owner,
         p.proconfig AS config,
         ARRAY(SELECT pg_catalog.pg_get_userbyid(a.grantee)
                 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> 0 AND a.grantee <> p.proowner
                ORDER BY 1) AS executors,
         EXISTS (SELECT 1
                   FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                  WHERE a.privilege_type = 'EXECUTE' AND a.grantee = 0) AS public_exec
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace`;

describe('RLS-15 — liste blanche des fonctions SECURITY DEFINER (base de production)', () => {
  it('la liste blanche est bien formée : propriétaires NOLOGIN gérés, signatures uniques', async () => {
    // propriétaires réellement NOLOGIN dans la base (et assertion L0-05 du test)
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_catalog.pg_roles
          WHERE rolname = ANY($1::text[]) AND NOT rolcanlogin`,
        [[...new Set(allowlist.functions.map((f) => f.owner))]],
      );
      expect(rows[0]?.n).toBe(new Set(allowlist.functions.map((f) => f.owner)).size);
    });
    const sigs = allowlist.functions.map((f) => f.signature);
    expect(new Set(sigs).size).toBe(sigs.length);
    for (const f of allowlist.functions) {
      expect(OWNER_ROLES as readonly string[], f.signature).toContain(f.owner);
      for (const r of f.execute) expect(['app_api', 'app_worker'], f.signature).toContain(r);
    }
  });

  it('pg_proc : exactement la liste blanche, propriétaire, search_path figé et EXECUTE conformes', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<ProcRow>(
          `${PROC_SQL}
            WHERE p.prosecdef
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND n.nspname !~ '^pg_toast'
            ORDER BY 1`,
        );
        const expected = [...allowlist.functions].sort((a, b) =>
          a.signature < b.signature ? -1 : 1,
        );
        expect(rows.map((r) => r.signature)).toEqual(expected.map((f) => f.signature));
        for (const [i, r] of rows.entries()) {
          const f = expected[i];
          expect(r.owner, r.signature).toBe(f?.owner);
          expect(r.config, r.signature).toEqual([allowlist.searchPath]);
          expect(r.executors, r.signature).toEqual([...(f?.execute ?? [])].sort());
          expect(r.public_exec, r.signature).toBe(false);
          // jamais un rôle de connexion (migrator compris) comme propriétaire
          expect(LOGIN_ROLES as readonly string[], r.signature).not.toContain(r.owner);
        }
      },
      { database: 'production' },
    );
  });

  it('RLS-16 : toute fonction de core, app, platform a search_path = pg_catalog, pg_temp ; aucune n’est exécutable par PUBLIC', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<ProcRow>(
          `${PROC_SQL} WHERE n.nspname = ANY($1::text[]) ORDER BY 1`,
          [PROJECT_SCHEMAS],
        );
        expect(rows.length).toBeGreaterThan(allowlist.functions.length);
        for (const r of rows) {
          expect(r.config, r.signature).toEqual([allowlist.searchPath]);
          expect(r.public_exec, r.signature).toBe(false);
        }
      },
      { database: 'production' },
    );
  });

  it('RLS-16 : app_api ne peut créer aucun objet dans pg_temp (TEMP retiré) pour masquer un nom', async () => {
    await withRole('app_api', async (client) => {
      await expect(
        client.query('CREATE TEMP TABLE iam_user_account (id uuid)'),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        client.query(
          `CREATE FUNCTION pg_temp.actor_kind() RETURNS text LANGUAGE sql AS $$ SELECT 'STAFF' $$`,
        ),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});
