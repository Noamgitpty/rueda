/**
 * Intégration du schéma de preuve AVL / PAY (US-006, migrations 0002 à 0007 et test 9001).
 * Vérifie, sous les rôles de production, ce que les preuves L0 supposent :
 * - RLS ENABLE + FORCE sur toutes les tables `core`, politique `migrator_all` (CLAUDE.md point 5) ;
 * - droits : rien pour PUBLIC, app_anon, app_api ; aucun DELETE ; app_worker borné (17 §2.3, A1) ;
 * - contexte absent ⇒ 0 ligne, sans erreur ; écriture refusée (fail-closed) ;
 * - fonctions de trigger d'intégrité : SECURITY DEFINER, search_path figé, sans EXECUTE (ADR-048) ;
 * - triggers I-OCC différés (DEFERRABLE INITIALLY DEFERRED) ;
 * - fixtures de test absentes de la base de production.
 */
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';
import { inTx, uuid } from '../support/avl.ts';

const CORE_TABLES = [
  'booking_vehicle_occupancy',
  'booking_checkout_hold',
  'booking_trip',
  'booking_guest_occupancy',
  'booking_hold_compensation',
  'booking_payment_disposition',
  'payment_payment_operation',
  'payment_webhook_inbox',
] as const;

// Tables de configuration pays (US-013, 0008) : même socle RLS (ENABLE + FORCE, migrator_all),
// mais lecture de référence pour app_api et app_worker ; leurs politiques et droits sont vérifiés
// par config-country.test.ts. Les contrôles de politiques AVL / PAY ci-dessous portent donc sur CORE_TABLES.
const CONFIG_TABLES = [
  'config_currency',
  'config_country',
  'config_param_definition',
  'config_param_value',
  'config_holiday_calendar',
  'pricing_tax_line_config',
  'finance_legal_entity',
] as const;

const INTEGRITY_FUNCTIONS = [
  'core.booking_assert_trip_occupancy()',
  'core.booking_assert_conversion_disposition()',
  'core.booking_assert_rent_payment_operation()',
] as const;

describe('schéma core (US-006)', () => {
  it('toutes les tables de core : RLS ENABLE + FORCE, politique migrator_all, propriétaire migrator', async () => {
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
      expect(rows.map((r) => r.relname)).toEqual([...CORE_TABLES, ...CONFIG_TABLES].sort());
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

  it('aucune politique pour PUBLIC ; politiques app_worker seulement en plus de migrator_all', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ relname: string; polname: string; roles: string }>(
        `SELECT c.relname, p.polname,
                pg_catalog.array_to_string(ARRAY(
                  SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END
                    FROM pg_catalog.unnest(p.polroles) AS r ORDER BY 1), ',') AS roles
           FROM pg_catalog.pg_policy p
           JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname = ANY($1::text[])`,
        [CORE_TABLES],
      );
      for (const r of rows) {
        const expected = r.polname === 'migrator_all' ? 'migrator' : 'app_worker';
        expect(r.roles, `${r.relname}.${r.polname}`).toBe(expected);
      }
      // aucune politique DELETE (polcmd 'd') ni ALL ('*') hors migrator_all
      const { rows: cmds } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM pg_catalog.pg_policy p
           JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname = ANY($1::text[])
            AND p.polname <> 'migrator_all' AND p.polcmd IN ('d', '*')`,
        [CORE_TABLES],
      );
      expect(cmds[0]?.n).toBe(0);
    });
  });

  it('droits : rien pour app_api ni app_anon ; aucun DELETE pour personne ; app_worker borné', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        role: string;
        tbl: string;
        priv: string;
        has: boolean;
      }>(
        `SELECT r.role, t.tbl, p.priv,
                pg_catalog.has_table_privilege(r.role, 'core.' || t.tbl, p.priv) AS has
           FROM unnest($1::text[]) AS t(tbl),
                unnest(ARRAY['app_api', 'app_anon', 'app_worker']) AS r(role),
                unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p(priv)`,
        [CORE_TABLES],
      );
      const granted = rows.filter((r) => r.has).map((r) => `${r.role}:${r.tbl}:${r.priv}`);
      expect(granted.filter((g) => !g.startsWith('app_worker:'))).toEqual([]);
      expect(granted.filter((g) => /:(DELETE|TRUNCATE)$/.test(g))).toEqual([]);
      // app_worker n'insère ni occupation, ni hold, ni opération (commandes cmd_* : US-023)
      for (const tbl of [
        'booking_vehicle_occupancy',
        'booking_checkout_hold',
        'payment_payment_operation',
      ]) {
        expect(granted).not.toContain(`app_worker:${tbl}:INSERT`);
      }
      // app_worker ne modifie ni les montants ni les identités (droits par colonne)
      const { rows: cols } = await client.query<{ col: string; has: boolean }>(
        `SELECT col, pg_catalog.has_column_privilege('app_worker', $1, col, 'UPDATE') AS has
           FROM unnest(ARRAY['amount_minor', 'currency', 'hold_id', 'kind', 'purpose', 'idem_plain']) AS col`,
        ['core.payment_payment_operation'],
      );
      expect(cols.filter((c) => c.has)).toEqual([]);
    });
  });

  it('app_api : toute écriture directe refusée (42501), lecture aussi (lectures filtrées : US-011)', async () => {
    await withRole('app_api', async (client) => {
      for (const sql of [
        `SELECT 1 FROM core.booking_checkout_hold LIMIT 1`,
        `UPDATE core.booking_checkout_hold SET status = 'EXPIRED'`,
        `INSERT INTO core.booking_vehicle_occupancy (id, vehicle_id, kind, source, period, active, expires_at)
         VALUES (gen_random_uuid(), gen_random_uuid(), 'HOLD', 'CHECKOUT', '[2031-01-01,2031-01-02)', true, '2031-01-01')`,
        `DELETE FROM core.booking_trip`,
      ]) {
        await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
    });
  });

  it('app_worker sans contexte : 0 ligne sans erreur ; écriture refusée par la RLS (fail-closed)', async () => {
    await withRole('app_worker', async (client) => {
      for (const tbl of CORE_TABLES) {
        const { rows } = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM core.${tbl}`,
        );
        expect(rows[0]?.n, tbl).toBe(0);
      }
      await inTx(client, {}, async (tx) => {
        await expect(
          tx.query(
            `INSERT INTO core.payment_webhook_inbox (id, provider, dedup_key, signature_valid)
             VALUES ($1, 'FAKE', '\\x01', true)`,
            [uuid()],
          ),
        ).rejects.toMatchObject({ code: '42501' });
      });
      // travailleur hors liste : idem
      await inTx(client, { worker: 'trip_lifecycle' }, async (tx) => {
        const { rows } = await tx.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM core.payment_webhook_inbox`,
        );
        expect(rows[0]?.n).toBe(0);
      });
    });
  });

  it('fonctions de trigger d’intégrité : SECURITY DEFINER, propriétaire migrator, search_path figé, sans EXECUTE', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{
        fn: string;
        secdef: boolean;
        owner: string;
        config: string[] | null;
        acl: string | null;
        rettype: string;
      }>(
        `SELECT p.oid::regprocedure::text AS fn, p.prosecdef AS secdef,
                pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config,
                p.proacl::text AS acl, p.prorettype::regtype::text AS rettype
           FROM pg_catalog.pg_proc p
          WHERE p.oid = ANY ($1::regprocedure[])`,
        [INTEGRITY_FUNCTIONS],
      );
      expect(rows).toHaveLength(INTEGRITY_FUNCTIONS.length);
      for (const r of rows) {
        expect(r, r.fn).toMatchObject({ secdef: true, owner: 'migrator', rettype: 'trigger' });
        expect(r.config, r.fn).toEqual(['search_path=pg_catalog, pg_temp']);
        // seul le propriétaire : ni PUBLIC (=X) ni rôle applicatif
        expect(r.acl ?? '', r.fn).not.toMatch(/(^|[{,])=X|app_|cmd_|_owner=/);
      }
      // aucune autre fonction SECURITY DEFINER dans core (liste blanche RLS-15, US-011)
      const { rows: others } = await client.query<{ fn: string }>(
        `SELECT p.oid::regprocedure::text AS fn
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('core', 'app', 'platform') AND p.prosecdef
          ORDER BY 1`,
      );
      expect(others.map((o) => o.fn)).toEqual([...INTEGRITY_FUNCTIONS].sort());
    });
  });

  it('triggers I-OCC et disposition : contraintes DEFERRABLE INITIALLY DEFERRED', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{
        tgname: string;
        deferrable: boolean;
        deferred: boolean;
      }>(
        `SELECT t.tgname, t.tgdeferrable AS deferrable, t.tginitdeferred AS deferred
           FROM pg_catalog.pg_trigger t
           JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND t.tgconstraint <> 0 AND NOT t.tgisinternal
          ORDER BY t.tgname`,
      );
      expect(rows).toEqual(
        [
          'disposition_matches_hold',
          'hold_conversion_matches_disposition',
          'occupancy_trip_guard',
          'occupancy_trip_ref_valid',
          'trip_has_active_occupancy',
        ].map((tgname) => ({ tgname, deferrable: true, deferred: true })),
      );
    });
  });

  it('exclusions GiST WHERE (active) et index uniques partiels de 17 §2.5', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ name: string; def: string }>(
        `SELECT c.conname AS name, pg_catalog.pg_get_constraintdef(c.oid) AS def
           FROM pg_catalog.pg_constraint c
          WHERE c.conname IN ('vehicle_occupancy_no_overlap', 'guest_no_overlap')
          ORDER BY 1`,
      );
      expect(rows).toEqual([
        {
          name: 'guest_no_overlap',
          def: 'EXCLUDE USING gist (guest_user_id WITH =, period WITH &&) WHERE (active)',
        },
        {
          name: 'vehicle_occupancy_no_overlap',
          def: 'EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active)',
        },
      ]);
      const { rows: idx } = await client.query<{ name: string; def: string }>(
        `SELECT c.relname AS name, pg_catalog.pg_get_indexdef(c.oid) AS def
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core'
            AND c.relname IN ('one_live_hold_per_guest_vehicle', 'one_conversion_per_hold',
                              'one_active_occupancy_per_trip')
          ORDER BY 1`,
      );
      expect(idx.map((i) => i.name)).toEqual([
        'one_active_occupancy_per_trip',
        'one_conversion_per_hold',
        'one_live_hold_per_guest_vehicle',
      ]);
      expect(idx[2]?.def).toMatch(
        /UNIQUE INDEX .* \(guest_user_id, vehicle_id\) WHERE \(status = ANY \(ARRAY\['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text\]\)\)/,
      );
      expect(idx[1]?.def).toMatch(
        /UNIQUE INDEX .* \(hold_id\) WHERE \(disposition = 'CONVERSION'::text\)/,
      );
    });
  });

  it('contexte de session : app.actor_kind() et app.worker_name() rendent NULL si absents ou invalides', async () => {
    await withRole('app_worker', async (client) => {
      const read = async () =>
        (
          await client.query<{ kind: string | null; name: string | null }>(
            'SELECT app.actor_kind() AS kind, app.worker_name() AS name',
          )
        ).rows[0];
      expect(await read()).toEqual({ kind: null, name: null });
      await inTx(client, {}, async (tx) => {
        await tx.query(
          `SELECT pg_catalog.set_config('app.actor_kind', 'ROOT', true),
                  pg_catalog.set_config('app.worker_name', 'Bad Name;', true)`,
        );
        const { rows } = await tx.query(
          'SELECT app.actor_kind() AS kind, app.worker_name() AS name',
        );
        expect(rows[0]).toEqual({ kind: null, name: null });
      });
      await inTx(client, { worker: 'hold_expiry' }, async (tx) => {
        const { rows } = await tx.query(
          'SELECT app.actor_kind() AS kind, app.worker_name() AS name',
        );
        expect(rows[0]).toEqual({ kind: 'WORKER', name: 'hold_expiry' });
      });
      expect(await read()).toEqual({ kind: null, name: null }); // SET LOCAL : rien ne fuit
    });
  });

  it('fixtures de test (9001) présentes dans la base principale, absentes de la base de production', async () => {
    const query = `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'test_fixture') AS fixtures,
                          EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'core') AS core`;
    await withRole('app_worker', async (client) => {
      expect((await client.query(query)).rows[0]).toEqual({ fixtures: true, core: true });
    });
    await withRole(
      'app_worker',
      async (client) => {
        expect((await client.query(query)).rows[0]).toEqual({ fixtures: false, core: true });
      },
      { database: 'production' },
    );
  });
});
