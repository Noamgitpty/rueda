/**
 * L0-05 (partiel, US-005) — 17 §11 : assertion de rôle en tête de chaque test, inventaire
 * `pg_roles` sans rôle applicatif `rolsuper` ni `rolbypassrls`. US-011 : appartenances des
 * propriétaires NOLOGIN (amendement d'ADR-044, ADR-053) ; le reste de L0-05 (RLS-1 à RLS-20,
 * `pg_proc` RLS-15, contexte absent) est dans `l0-rls-*.test.ts`.
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

  it('appartenances : seulement <propriétaire> TO migrator, INHERIT FALSE, SET TRUE, ADMIN FALSE (ADR-044 amendé, US-011)', async () => {
    await withRole('app_anon', async (client) => {
      const { rows } = await client.query<{
        grp: string;
        mem: string;
        admin_option: boolean;
        inherit_option: boolean;
        set_option: boolean;
      }>(
        `SELECT g.rolname AS grp, m.rolname AS mem, am.admin_option, am.inherit_option, am.set_option
           FROM pg_catalog.pg_auth_members am
           JOIN pg_catalog.pg_roles g ON g.oid = am.roleid
           JOIN pg_catalog.pg_roles m ON m.oid = am.member
          WHERE g.rolname = ANY($1::text[]) OR m.rolname = ANY($1::text[])
          ORDER BY 1, 2`,
        [MANAGED_ROLES],
      );
      // une ligne par propriétaire (concédant unique : l'administrateur de l'amorçage)
      expect(rows.map((r) => `${r.grp}>${r.mem}`)).toEqual(
        [...OWNER_ROLES].sort().map((o) => `${o}>${MIGRATOR_ROLE}`),
      );
      for (const r of rows) {
        expect(r, r.grp).toMatchObject({
          admin_option: false,
          inherit_option: false,
          set_option: true,
        });
      }
    });
  });

  it('migrator n’hérite d’aucun propriétaire ; aucun rôle applicatif n’est membre de quoi que ce soit', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        who: string;
        owner: string;
        usage: boolean;
        can_set: boolean;
      }>(
        `SELECT w.who, o.owner,
                pg_catalog.pg_has_role(w.who, o.owner, 'USAGE') AS usage,
                pg_catalog.pg_has_role(w.who, o.owner, 'SET') AS can_set
           FROM unnest($1::text[]) AS o(owner),
                unnest($2::text[]) AS w(who)`,
        [OWNER_ROLES, [MIGRATOR_ROLE, ...APP_ROLES]],
      );
      for (const r of rows) {
        // USAGE = privilèges hérités : jamais ; SET : migrator seulement (ALTER … OWNER TO)
        expect(r.usage, `${r.who}/${r.owner}`).toBe(false);
        expect(r.can_set, `${r.who}/${r.owner}`).toBe(r.who === MIGRATOR_ROLE);
      }
      // aucun propriétaire n'hérite de migrator ni d'un rôle applicatif
      const { rows: up } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM unnest($1::text[]) AS o(owner), unnest($2::text[]) AS t(target)
          WHERE pg_catalog.pg_has_role(o.owner, t.target, 'MEMBER')`,
        [OWNER_ROLES, [MIGRATOR_ROLE, ...APP_ROLES]],
      );
      expect(up[0]?.n).toBe(0);
    });
  });

  it('les propriétaires NOLOGIN ne possèdent aucune table ni aucun schéma ; ni TEMP ni CREATE sur la base pour les rôles applicatifs', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ owner: string; kind: string }>(
        `SELECT pg_catalog.pg_get_userbyid(c.relowner) AS owner, c.relkind::text AS kind
           FROM pg_catalog.pg_class c
          WHERE pg_catalog.pg_get_userbyid(c.relowner) = ANY($1::text[])
         UNION ALL
         SELECT pg_catalog.pg_get_userbyid(n.nspowner), 'schema'
           FROM pg_catalog.pg_namespace n
          WHERE pg_catalog.pg_get_userbyid(n.nspowner) = ANY($1::text[])`,
        [OWNER_ROLES],
      );
      expect(rows).toEqual([]);
      // revue sécurité US-005, constat 2 ; RLS-16 : aucun objet temporaire possible
      const { rows: db } = await client.query<{ role: string; temp: boolean; can_create: boolean }>(
        `SELECT r.role,
                pg_catalog.has_database_privilege(r.role, pg_catalog.current_database(), 'TEMP') AS temp,
                pg_catalog.has_database_privilege(r.role, pg_catalog.current_database(), 'CREATE') AS can_create
           FROM unnest($1::text[]) AS r(role) ORDER BY 1`,
        [[...APP_ROLES, ...OWNER_ROLES]],
      );
      for (const r of db) expect(r, r.role).toMatchObject({ temp: false, can_create: false });
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
