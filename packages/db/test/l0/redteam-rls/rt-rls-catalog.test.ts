/**
 * US-049 — red team, axe `rls` : attaques pilotées par le CATALOGUE (jamais par une liste écrite à
 * la main), sous les rôles de production (assertion L0-05 par withRole), sur la base de PRODUCTION
 * du banc (migrations de production seules, sans test_fixture ni horloge virtuelle).
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée.
 * Rapport : docs/team/redteam/L0-rls.md (identifiants RT-RLS-xx).
 * Attendus : 17 §2.3 (rôles, ENABLE + FORCE, aucun BYPASSRLS, app_anon sans accès, RLS-5, RLS-8,
 * RLS-12, RLS-15, RLS-16, RLS-21, RLS-22), 17 §11 L0-05.
 */
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { APP_ROLES, MANAGED_ROLES, OWNER_ROLES } from '../../../src/index.ts';
import { withRole } from '../../../src/testing/index.ts';

const prod = <T>(
  role: (typeof APP_ROLES)[number],
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> => withRole(role, fn, { database: 'production' });

/** Schémas hors catalogue système. */
const USER_SCHEMAS = `n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'`;

/** Relations (tables, partitions, vues, vues matérialisées, tables étrangères, séquences). */
interface Rel {
  readonly schema: string;
  readonly name: string;
  readonly kind: string;
  readonly rls: boolean;
  readonly force: boolean;
}

async function relations(client: pg.Client): Promise<Rel[]> {
  const { rows } = await client.query<Rel>(
    `SELECT n.nspname AS schema, c.relname AS name, c.relkind AS kind,
            c.relrowsecurity AS rls, c.relforcerowsecurity AS force
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE ${USER_SCHEMAS} AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
        -- séquences d'identité : suivies par leur table
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
                         WHERE d.objid = c.oid AND d.deptype = 'i' AND c.relkind = 'S')
      ORDER BY 1, 2`,
  );
  return rows;
}

const qualified = (r: Rel): string => `"${r.schema}"."${r.name}"`;

describe('RT-RLS-01 — inventaire du catalogue : schémas, ENABLE + FORCE, vues, hors-liste', () => {
  it('aucun schéma inattendu (test_fixture, dev-overlay…) dans la base de production', async () => {
    await prod('app_api', async (client) => {
      const { rows } = await client.query<{ nspname: string }>(
        `SELECT n.nspname FROM pg_catalog.pg_namespace n WHERE ${USER_SCHEMAS} ORDER BY 1`,
      );
      expect(rows.map((r) => r.nspname)).toEqual(['app', 'core', 'platform', 'public']);
    });
  });

  it('TOUTE table et partition de TOUT schéma (app et public compris) a ENABLE + FORCE ROW LEVEL SECURITY', async () => {
    await prod('app_api', async (client) => {
      const rels = (await relations(client)).filter((r) => r.kind === 'r' || r.kind === 'p');
      expect(rels.length).toBeGreaterThan(20);
      expect(rels.filter((r) => !(r.rls && r.force)).map(qualified)).toEqual([]);
    });
  });

  it('aucune vue matérialisée ni table étrangère (elles échappent à la RLS) ; toute vue est security_invoker', async () => {
    await prod('app_api', async (client) => {
      const rels = await relations(client);
      expect(rels.filter((r) => r.kind === 'm' || r.kind === 'f').map(qualified)).toEqual([]);
      const { rows } = await client.query<{ v: string }>(
        `SELECT n.nspname || '.' || c.relname AS v
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE ${USER_SCHEMAS} AND c.relkind = 'v'
            AND NOT COALESCE('security_invoker=true' = ANY (c.reloptions), false)`,
      );
      expect(rows).toEqual([]);
    });
  });

  it('aucune table héritée ou partitionnée dont l’enfant échapperait aux drapeaux du parent', async () => {
    await prod('app_api', async (client) => {
      const { rows } = await client.query<{ child: string }>(
        `SELECT c.oid::regclass::text AS child
           FROM pg_catalog.pg_inherits i JOIN pg_catalog.pg_class c ON c.oid = i.inhrelid
          WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity)`,
      );
      expect(rows).toEqual([]);
    });
  });

  it('aucune politique pour PUBLIC ; aucune politique du tout pour app_anon', async () => {
    await prod('app_api', async (client) => {
      const { rows } = await client.query<{ t: string; pol: string }>(
        `SELECT p.polrelid::regclass::text AS t, p.polname AS pol
           FROM pg_catalog.pg_policy p
          WHERE 0 = ANY (p.polroles) OR 'app_anon'::regrole = ANY (p.polroles)`,
      );
      expect(rows).toEqual([]);
    });
  });

  it('politiques USING (true) pour app_api / app_worker : uniquement des tables de référence publique (config_*, pricing_*, entité légale, capacités PSP)', async () => {
    await prod('app_api', async (client) => {
      const { rows } = await client.query<{ t: string; pol: string }>(
        `SELECT p.polrelid::regclass::text AS t, p.polname AS pol
           FROM pg_catalog.pg_policy p
          WHERE p.polcmd IN ('r', '*')
            AND ('app_api'::regrole = ANY (p.polroles) OR 'app_worker'::regrole = ANY (p.polroles))
            AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) IN ('true', '(true)')`,
      );
      const outside = rows.filter(
        (r) =>
          !/^(core\.)?(config_|pricing_|finance_legal_entity|payment_psp_capability)/.test(r.t),
      );
      expect(outside).toEqual([]);
    });
  });
});

describe('RT-RLS-02 — rôles : aucun BYPASSRLS, aucune appartenance, aucun objet possédé', () => {
  it('aucun rôle géré par le projet n’est SUPERUSER ou BYPASSRLS ; au plus le superutilisateur d’amorçage du serveur', async () => {
    await prod('app_api', async (client) => {
      const { rows } = await client.query<{ rolname: string }>(
        `SELECT rolname FROM pg_catalog.pg_roles
          WHERE (rolsuper OR rolbypassrls) AND rolname NOT LIKE 'pg\\_%'`,
      );
      for (const r of rows) expect(MANAGED_ROLES, r.rolname).not.toContain(r.rolname);
      expect(rows.length).toBeLessThanOrEqual(1);
    });
  });

  it('chaque rôle applicatif : aucune appartenance (directe ou héritée) à un autre rôle, SET ROLE impossible', async () => {
    for (const role of APP_ROLES) {
      await prod(role, async (client) => {
        const { rows } = await client.query<{ rolname: string }>(
          `SELECT x.rolname FROM pg_catalog.pg_roles x
            WHERE x.rolname <> $1 AND (pg_catalog.pg_has_role($1, x.oid, 'MEMBER')
                                       OR pg_catalog.pg_has_role($1, x.oid, 'USAGE'))`,
          [role],
        );
        expect(
          rows.map((r) => r.rolname),
          role,
        ).toEqual([]);
        for (const target of [
          ...OWNER_ROLES,
          'migrator',
          'pg_read_all_data',
          'pg_write_all_data',
        ]) {
          await expect(
            client.query(`SET ROLE ${target}`),
            `${role} -> ${target}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
        await expect(client.query('SET SESSION AUTHORIZATION migrator')).rejects.toMatchObject({
          code: '42501',
        });
      });
    }
  });

  it('aucun rôle applicatif ne possède une relation, une fonction, un schéma ni la base (un propriétaire échapperait à la RLS non forcée et pourrait GRANT)', async () => {
    await prod('app_api', async (client) => {
      const { rows } = await client.query<{ what: string; who: string }>(
        `SELECT 'relation ' || c.oid::regclass::text AS what, pg_catalog.pg_get_userbyid(c.relowner) AS who
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE ${USER_SCHEMAS} AND pg_catalog.pg_get_userbyid(c.relowner) = ANY ($1::text[])
         UNION ALL
         SELECT 'fonction ' || p.oid::regprocedure::text, pg_catalog.pg_get_userbyid(p.proowner)
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE ${USER_SCHEMAS} AND pg_catalog.pg_get_userbyid(p.proowner) = ANY ($1::text[])
         UNION ALL
         SELECT 'schéma ' || n.nspname, pg_catalog.pg_get_userbyid(n.nspowner)
           FROM pg_catalog.pg_namespace n
          WHERE pg_catalog.pg_get_userbyid(n.nspowner) = ANY ($1::text[])
         UNION ALL
         SELECT 'base ' || d.datname, pg_catalog.pg_get_userbyid(d.datdba)
           FROM pg_catalog.pg_database d
          WHERE pg_catalog.pg_get_userbyid(d.datdba) = ANY ($1::text[])`,
        [[...APP_ROLES]],
      );
      expect(rows).toEqual([]);
    });
  });

  it('aucun réglage par rôle ou par base ne déplace search_path, role, row_security ni un app.* des rôles gérés', async () => {
    await prod('app_api', async (client) => {
      const { rows } = await client.query<{ who: string; setting: string }>(
        `SELECT COALESCE(pg_catalog.pg_get_userbyid(NULLIF(s.setrole, 0)), '(base)') AS who, c AS setting
           FROM pg_catalog.pg_db_role_setting s, unnest(s.setconfig) AS c
          WHERE s.setdatabase IN (0, (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database()))
            AND (s.setrole = 0 OR pg_catalog.pg_get_userbyid(s.setrole) = ANY ($1::text[]))
            AND c ~ '^(search_path|role|session_authorization|row_security|app\\.|default_transaction_read_only)='`,
        [[...MANAGED_ROLES]],
      );
      expect(rows).toEqual([]);
    });
  });

  it('aucun rôle applicatif ne peut créer dans un schéma, ni de table temporaire, ni de base, ni de rôle', async () => {
    for (const role of APP_ROLES) {
      await prod(role, async (client) => {
        const { rows } = await client.query<{ nspname: string }>(
          `SELECT n.nspname FROM pg_catalog.pg_namespace n
            WHERE ${USER_SCHEMAS} AND pg_catalog.has_schema_privilege($1, n.oid, 'CREATE')`,
          [role],
        );
        expect(rows, role).toEqual([]);
        const db = await client.query<{ temp: boolean; created: boolean }>(
          `SELECT pg_catalog.has_database_privilege($1, current_database(), 'TEMPORARY') AS temp,
                  pg_catalog.has_database_privilege($1, current_database(), 'CREATE') AS created`,
          [role],
        );
        expect(db.rows[0], role).toEqual({ temp: false, created: false });
        const me = await client.query<{ rolcreatedb: boolean; rolcreaterole: boolean }>(
          `SELECT rolcreatedb, rolcreaterole FROM pg_catalog.pg_roles WHERE rolname = $1`,
          [role],
        );
        expect(me.rows[0], role).toEqual({ rolcreatedb: false, rolcreaterole: false });
      });
    }
  });
});

describe('RT-RLS-03 — privilèges de table : ni TRUNCATE, ni TRIGGER, ni REFERENCES ; app_anon n’a RIEN', () => {
  it('aucun rôle applicatif n’a TRUNCATE, TRIGGER ni REFERENCES sur aucune table (TRUNCATE ignore la RLS)', async () => {
    for (const role of APP_ROLES) {
      await prod(role, async (client) => {
        const { rows } = await client.query<{ rel: string }>(
          `SELECT n.nspname || '.' || c.relname AS rel
             FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE ${USER_SCHEMAS} AND c.relkind IN ('r', 'p')
              AND pg_catalog.has_table_privilege($1, c.oid, 'TRUNCATE, TRIGGER, REFERENCES')`,
          [role],
        );
        expect(rows, role).toEqual([]);
      });
    }
  });

  it('app_anon : aucun privilège de table, de colonne ni de séquence sur AUCUNE relation de AUCUN schéma', async () => {
    await prod('app_anon', async (client) => {
      const { rows } = await client.query<{ rel: string }>(
        `SELECT n.nspname || '.' || c.relname AS rel
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE ${USER_SCHEMAS} AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
            AND (pg_catalog.has_table_privilege('app_anon', c.oid,
                   'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                 OR pg_catalog.has_any_column_privilege('app_anon', c.oid,
                   'SELECT, INSERT, UPDATE, REFERENCES'))
         UNION ALL
         SELECT n.nspname || '.' || c.relname
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE ${USER_SCHEMAS} AND c.relkind = 'S'
            AND pg_catalog.has_sequence_privilege('app_anon', c.oid, 'USAGE, SELECT, UPDATE')`,
      );
      expect(rows).toEqual([]);
    });
  });

  it('app_anon : SELECT, INSERT, DELETE et TRUNCATE réels sur chaque table et vue ⇒ 42501 (jamais 0 ligne silencieuse, jamais un succès)', async () => {
    await prod('app_anon', async (client) => {
      const anomalies: string[] = [];
      for (const r of (await relations(client)).filter((x) => x.kind !== 'S')) {
        const t = qualified(r);
        const statements = [`SELECT * FROM ${t} LIMIT 1`];
        if (r.kind === 'r' || r.kind === 'p') {
          statements.push(
            `INSERT INTO ${t} DEFAULT VALUES`,
            `DELETE FROM ${t} WHERE false`,
            `TRUNCATE ${t}`,
          );
        }
        for (const sql of statements) {
          await client.query(sql).then(
            () => anomalies.push(`ACCEPTÉ : ${sql}`),
            (error: { code?: string }) => {
              if (error.code !== '42501') anomalies.push(`${String(error.code)} : ${sql}`);
            },
          );
        }
      }
      expect(anomalies).toEqual([]);
    });
  });

  it('app_anon : EXECUTE sur AUCUNE fonction des schémas du projet, ni sur les fonctions de fichier / d’administration de pg_catalog', async () => {
    await prod('app_anon', async (client) => {
      const project = await client.query<{ f: string }>(
        `SELECT p.oid::regprocedure::text AS f
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname IN ('core', 'app', 'platform')
            AND pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE')`,
      );
      expect(project.rows).toEqual([]);
      const dangerous = await client.query<{ f: string }>(
        `SELECT p.oid::regprocedure::text AS f
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'pg_catalog'
            AND p.proname ~ '^(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_ls_logdir|pg_ls_waldir|pg_stat_file|lo_import|lo_export|pg_reload_conf|pg_rotate_logfile|pg_switch_wal|pg_promote|pg_create_restore_point|pg_backup_start|pg_backup_stop)$'
            AND pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE')`,
      );
      expect(dangerous.rows).toEqual([]);
    });
  });

  it('les rôles applicatifs ne créent pas de slot de réplication (EXECUTE à PUBLIC mais refus interne : pas de rôle REPLICATION)', async () => {
    for (const role of APP_ROLES) {
      await prod(role, async (client) => {
        await expect(
          client.query(`SELECT pg_catalog.pg_create_physical_replication_slot('rt_slot')`),
          role,
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
  });

  it('les rôles applicatifs ne lisent ni pg_authid, ni pg_shadow, ni les statistiques des tables RLS (pg_stats), ni les requêtes des autres rôles', async () => {
    for (const role of APP_ROLES) {
      await prod(role, async (client) => {
        for (const rel of ['pg_catalog.pg_authid', 'pg_catalog.pg_shadow']) {
          await expect(
            client.query(`SELECT * FROM ${rel} LIMIT 1`),
            `${role} ${rel}`,
          ).rejects.toMatchObject({ code: '42501' });
        }
        const stats = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_catalog.pg_stats WHERE schemaname IN ('core', 'app', 'platform')`,
        );
        expect(stats.rows[0]?.n, `${role} pg_stats`).toBe(0);
        const act = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_catalog.pg_stat_activity
            WHERE usename <> current_user AND query IS NOT NULL
              AND query <> '' AND query NOT LIKE '<insufficient privilege>'`,
        );
        expect(act.rows[0]?.n, `${role} pg_stat_activity`).toBe(0);
      });
    }
  });
});

describe('RT-RLS-04 — élévation par réglage de session : row_security, horloge, search_path', () => {
  it('SET row_security = off ne donne AUCUNE ligne de plus : erreur 42501 ou 0 ligne (FORCE)', async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await prod(role, async (client) => {
        for (const table of ['iam_user_account', 'booking_trip', 'payment_payment_operation']) {
          await client.query('BEGIN');
          try {
            await client.query('SET LOCAL row_security = off');
            const outcome = await client
              .query<{ n: number }>(`SELECT count(*)::int AS n FROM core.${table}`)
              .then(
                (r) => r.rows[0]?.n ?? -1,
                (error: { code?: string }) => error.code,
              );
            expect([0, '42501'], `${role} ${table}`).toContain(outcome);
          } finally {
            await client.query('ROLLBACK');
          }
        }
      });
    }
  });

  it('production : app.virtual_now forgé ne déplace PAS platform.now() (horloge de test absente de la production)', async () => {
    await prod('app_api', async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(
          `SELECT pg_catalog.set_config('app.virtual_now', '2001-01-01T00:00:00Z', true)`,
        );
        const { rows } = await client.query<{ epoch_ms: string }>(
          `SELECT (extract(epoch FROM platform.now()) * 1000)::bigint::text AS epoch_ms`,
        );
        // l'horloge de production est l'horloge du serveur : 2001 aurait déplacé l'écart de 25 ans
        expect(Math.abs(Number(rows[0]?.epoch_ms) - Date.now())).toBeLessThan(120_000);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('search_path forgé (pg_temp, public, schémas du projet en tête) : la garde SECURITY DEFINER reste résolue par son search_path figé', async () => {
    await prod('app_api', async (client) => {
      await client.query('BEGIN');
      try {
        await client.query(`SET LOCAL search_path = pg_temp, public, core, app, platform`);
        const guard = await client.query(
          `SELECT * FROM platform.guest_hold_guard('[2031-01-01,2031-01-02)'::tstzrange)`,
        );
        expect(guard.rowCount).toBe(0);
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });

  it('toute fonction SECURITY DEFINER de la base a exactement le search_path pg_catalog, pg_temp (aucune surcharge possible)', async () => {
    await prod('app_api', async (client) => {
      const { rows } = await client.query<{ f: string }>(
        `SELECT p.oid::regprocedure::text AS f
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE p.prosecdef AND ${USER_SCHEMAS}
            AND (p.proconfig IS NULL
                 OR NOT ('search_path=pg_catalog, pg_temp' = ANY (p.proconfig)))`,
      );
      expect(rows).toEqual([]);
    });
  });
});
