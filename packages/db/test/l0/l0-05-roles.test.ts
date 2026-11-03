/**
 * L0-05 (partiel, US-005) — 17 §11 : assertion de rôle en tête de chaque test, inventaire
 * `pg_roles` sans rôle applicatif `rolsuper` ni `rolbypassrls`. Le reste de L0-05 (RLS-1 à
 * RLS-20, `pg_proc` RLS-15, contexte absent) arrive avec US-011.
 */
import { describe, expect, it } from 'vitest';
import { APP_ROLES, MIGRATOR_ROLE, OWNER_ROLES, MANAGED_ROLES } from '../../src/index.ts';
import {
  assertProductionRole,
  connectForNegativeRoleTest,
  ProductionRoleAssertionError,
  withRole,
} from '../../src/testing/index.ts';

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolcanlogin: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
}

describe('L0-05 — assertion de rôle', () => {
  for (const role of APP_ROLES) {
    it(`${role} : current_user = ${role}, ni rolsuper ni rolbypassrls`, async () => {
      await withRole(role, async (client) => {
        const result = await client.query<{ current_user: string; session_user: string }>(
          'SELECT current_user, session_user',
        );
        expect(result.rows[0]).toEqual({ current_user: role, session_user: role });
        expect(await assertProductionRole(client, role)).toBe(role);
      });
    });
  }

  it('NÉGATIF : un test qui tourne sous migrator échoue à l’assertion', async () => {
    const client = await connectForNegativeRoleTest('migrator');
    try {
      await expect(assertProductionRole(client)).rejects.toThrow(ProductionRoleAssertionError);
      await expect(assertProductionRole(client)).rejects.toThrow(/current_user = migrator/);
    } finally {
      await client.end();
    }
  });

  it('NÉGATIF : un test qui tourne sous le superutilisateur échoue à l’assertion', async () => {
    const client = await connectForNegativeRoleTest('admin');
    try {
      const me = await client.query<{ rolsuper: boolean }>(
        'SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user',
      );
      expect(me.rows[0]?.rolsuper).toBe(true);
      await expect(assertProductionRole(client)).rejects.toThrow(ProductionRoleAssertionError);
    } finally {
      await client.end();
    }
  });

  it('NÉGATIF : SET ROLE vers un rôle non applicatif est refusé à app_api', async () => {
    await withRole('app_api', async (client) => {
      await expect(client.query(`SET ROLE ${MIGRATOR_ROLE}`)).rejects.toMatchObject({
        code: '42501',
      });
    });
  });
});

describe('L0-05 — inventaire pg_roles', () => {
  it('aucun rôle géré n’a rolsuper ni rolbypassrls ; tous existent', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<RoleRow>(
        `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole,
                rolreplication
           FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
        [MANAGED_ROLES],
      );
      expect(rows.map((r) => r.rolname).sort()).toEqual([...MANAGED_ROLES].sort());
      expect(rows.filter((r) => r.rolsuper || r.rolbypassrls)).toEqual([]);
      expect(rows.filter((r) => r.rolcreatedb || r.rolcreaterole || r.rolreplication)).toEqual([]);
    });
  });

  it('app_api, app_worker, app_anon et migrator se connectent ; les propriétaires sont NOLOGIN', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ rolname: string; rolcanlogin: boolean }>(
        `SELECT rolname, rolcanlogin FROM pg_catalog.pg_roles WHERE rolname = ANY($1::text[])`,
        [MANAGED_ROLES],
      );
      const login = Object.fromEntries(rows.map((r) => [r.rolname, r.rolcanlogin]));
      for (const role of [...APP_ROLES, MIGRATOR_ROLE]) expect(login[role]).toBe(true);
      for (const role of OWNER_ROLES) expect(login[role]).toBe(false);
    });
  });

  it('aucune appartenance : ni membre des propriétaires, ni rôle applicatif membre d’un autre rôle', async () => {
    await withRole('app_anon', async (client) => {
      const { rows } = await client.query<{ grp: string; mem: string }>(
        `SELECT g.rolname AS grp, m.rolname AS mem
           FROM pg_catalog.pg_auth_members am
           JOIN pg_catalog.pg_roles g ON g.oid = am.roleid
           JOIN pg_catalog.pg_roles m ON m.oid = am.member
          WHERE g.rolname = ANY($1::text[]) OR m.rolname = ANY($1::text[])`,
        [MANAGED_ROLES],
      );
      expect(rows).toEqual([]);
    });
  });

  it('les rôles applicatifs ne possèdent aucun objet de la base', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ owner: string; n: string }>(
        `SELECT pg_catalog.pg_get_userbyid(c.relowner) AS owner, count(*)::text AS n
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
          WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema')
            AND pg_catalog.pg_get_userbyid(c.relowner) = ANY($1::text[])
          GROUP BY 1`,
        [[...APP_ROLES]],
      );
      expect(rows).toEqual([]);
    });
  });
});
