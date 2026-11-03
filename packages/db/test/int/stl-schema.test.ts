/**
 * Schéma STL (US-018, migration 0027) : socle RLS, politiques par rôle, droits au plus juste du
 * propriétaire `cmd_money_owner`, triggers d'immuabilité et trigger différé des invariants.
 * Sources : 17 §2.3 (SQL des tables d'argent), §3.2.8 ; ADR-053, ADR-057.
 */
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';

const STL_TABLES = [
  'settlement_settlement',
  'settlement_settlement_line',
  'settlement_settlement_tax_line',
  'settlement_settlement_leg',
  'settlement_trip_leg_balance',
] as const;
/** Tables d'argent d'US-062 (0036) : leurs politiques et droits sont prouvés par l0-us062-*.test.ts. */
const US062_TABLES = [
  'settlement_finance_approval',
  'settlement_platform_advance',
  'settlement_insurer_ledger_state',
  'settlement_insurer_bordereau',
  'settlement_insurer_bordereau_line',
] as const;
/** Tables en ajout seul : un règlement n'est jamais modifié (08 E4). */
const APPEND_ONLY = STL_TABLES.filter((t) => t !== 'settlement_trip_leg_balance');

describe('schéma STL (US-018, 0027)', () => {
  it('RLS ENABLE + FORCE, propriétaire migrator, politique migrator_all', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{
        t: string;
        rls: boolean;
        force: boolean;
        owner: string;
        m: boolean;
      }>(
        `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
                         WHERE p.polrelid = c.oid AND p.polname = 'migrator_all') AS m
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p') AND c.relname ~ '^settlement_'
          ORDER BY 1`,
      );
      expect(rows.map((r) => r.t)).toEqual([...STL_TABLES, ...US062_TABLES].sort());
      for (const r of rows) {
        expect(r, r.t).toMatchObject({ rls: true, force: true, owner: 'migrator', m: true });
      }
    });
  });

  it('politiques : app_api en lecture seule, app_worker en lecture seule, cmd_money_owner SELECT / INSERT ; aucune DELETE ni ALL', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ t: string; pol: string; cmd: string; roles: string }>(
        `SELECT c.relname AS t, p.polname AS pol, p.polcmd::text AS cmd,
                pg_catalog.array_to_string(ARRAY(
                  SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END
                    FROM pg_catalog.unnest(p.polroles) AS r ORDER BY 1), ',') AS roles
           FROM pg_catalog.pg_policy p
           JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname = ANY ($1::text[])`,
        [STL_TABLES],
      );
      for (const r of rows) {
        const label = `${r.t}.${r.pol}`;
        if (r.pol === 'migrator_all') {
          expect(r.roles, label).toBe('migrator');
          continue;
        }
        expect(['r', 'a'], label).toContain(r.cmd); // SELECT ou INSERT, jamais UPDATE / DELETE / ALL
        if (r.cmd === 'a') expect(r.roles, label).toBe('cmd_money_owner');
        expect(['app_api', 'app_worker', 'cmd_money_owner'], label).toContain(r.roles);
      }
      // trip_leg_balance : aucune politique d'écriture tant que son écrivain n'existe pas
      expect(
        rows.filter(
          (r) => r.t === 'settlement_trip_leg_balance' && r.cmd !== 'r' && r.pol !== 'migrator_all',
        ),
      ).toEqual([]);
    });
  });

  it('droits : app_api / app_worker / app_anon sans aucune écriture ; cmd_money_owner INSERT seulement sur les tables en ajout seul', async () => {
    await withRole('app_worker', async (client) => {
      for (const t of STL_TABLES) {
        for (const role of ['app_api', 'app_worker', 'app_anon', 'cmd_money_owner']) {
          for (const priv of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
            const { rows } = await client.query<{ ok: boolean }>(
              `SELECT pg_catalog.has_table_privilege($1, ('core.' || $2)::regclass, $3)
                      OR (($3 IN ('INSERT', 'UPDATE'))
                          AND pg_catalog.has_any_column_privilege($1, ('core.' || $2)::regclass, $3)) AS ok`,
              [role, t, priv],
            );
            const allowed =
              role === 'cmd_money_owner' &&
              priv === 'INSERT' &&
              (APPEND_ONLY as readonly string[]).includes(t);
            expect(rows[0]?.ok, `${role} ${priv} ${t}`).toBe(allowed);
          }
        }
      }
      // trip : lecture des champs de portée et verrou ; UPDATE sur row_version seulement (WITH CHECK false)
      const trip = await client.query<{ col: string }>(
        `SELECT a.attname::text AS col FROM pg_catalog.pg_attribute a
          WHERE a.attrelid = 'core.booking_trip'::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND pg_catalog.has_column_privilege('cmd_money_owner', a.attrelid, a.attnum, 'UPDATE')`,
      );
      expect(trip.rows.map((r) => r.col)).toEqual(['row_version']);
      const lock = await client.query<{ chk: string }>(
        `SELECT pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS chk FROM pg_catalog.pg_policy p
          WHERE p.polrelid = 'core.booking_trip'::regclass AND p.polname = 'money_lock'`,
      );
      expect(lock.rows[0]?.chk).toBe('false');
    });
  });

  it('triggers : immuabilité des règlements, garde de trip_leg_balance, invariants différés', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{
        t: string;
        trg: string;
        deferrable: boolean;
        deferred: boolean;
      }>(
        `SELECT c.relname AS t, g.tgname AS trg, g.tgdeferrable AS deferrable, g.tginitdeferred AS deferred
           FROM pg_catalog.pg_trigger g JOIN pg_catalog.pg_class c ON c.oid = g.tgrelid
          WHERE c.relname = ANY ($1::text[]) AND NOT g.tgisinternal ORDER BY 1, 2`,
        [STL_TABLES],
      );
      const names = rows.map((r) => `${r.t}.${r.trg}`);
      for (const t of APPEND_ONLY) expect(names).toContain(`${t}.settlement_immutable`);
      expect(names).toContain('settlement_trip_leg_balance.trip_leg_balance_guard');
      const balanced = rows.find((r) => r.trg === 'settlement_balanced');
      expect(balanced).toMatchObject({
        t: 'settlement_settlement',
        deferrable: true,
        deferred: true,
      });
    });
  });
});
