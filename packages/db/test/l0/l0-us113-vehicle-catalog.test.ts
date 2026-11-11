/**
 * Preuves du catalogue de référence des véhicules (US-113, migration 0063 ; 16 HST-050 ; 17 §3.2.3,
 * ADR-034 ; ADR-094) sous les rôles de production (assertion L0-05 en tête par withRole) :
 * - socle : RLS ENABLE + FORCE, migrator_all, propriétaire migrator, aucun droit ni politique pour
 *   PUBLIC ; app_api lit des colonnes nommées (ni provenance ni vérificateur) ; app_worker et
 *   app_anon ne lisent rien ; aucune écriture applicative (42501) ;
 * - critère 1 : `source` et `license_note` NOT NULL + CHECK non vides sur les trois tables ; la
 *   fixture 9970 a joué, sous migrator, des instructions de graine dont une ligne n'avait pas de
 *   licence : elles ont échoué en entier et aucune de leurs lignes n'est chargée (marque témoin
 *   présente, lignes « zz-us113-rejet-* » absentes) ;
 * - graine (base « production » du banc, migrations de production seules) : exactement les lignes
 *   des données `apps/api/src/modules/cat/data/vehicle-catalog.json`, toutes ACTIVE, toutes avec
 *   source et licence, aucune consommation EPA (OQ-CAT-01 b ouverte), aucune ligne de test ;
 *   catalogue commun aux pays (`market` nul) : PA et PY voient les mêmes lignes ;
 * - visibilité : ACTIVE et RETIRED lisibles, PENDING_REVIEW invisible (file de l'ops, US-114).
 * Valeurs attendues : 17 §3.2.3, 19 US-113 et les données de graine, jamais les politiques testées.
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';

const TABLES = [
  'catalog_vehicle_make',
  'catalog_vehicle_model',
  'catalog_vehicle_variant',
] as const;

/** Colonnes lisibles par app_api (0063), triées. */
const API_COLUMNS: Readonly<Record<(typeof TABLES)[number], readonly string[]>> = {
  catalog_vehicle_make: ['aliases', 'country_origin', 'id', 'name', 'slug', 'status'],
  catalog_vehicle_model: [
    'aliases',
    'body_type',
    'doors_default',
    'id',
    'make_id',
    'name',
    'seats_default',
    'slug',
    'status',
  ],
  catalog_vehicle_variant: [
    'cargo_l',
    'consumption_l_100km',
    'consumption_source',
    'doors',
    'drive',
    'engine_cc',
    'engine_cylinders',
    'fuel_type',
    'id',
    'market',
    'model_id',
    'power_hp',
    'seats',
    'status',
    'transmission',
    'trim_name',
    'value_class',
    'year_from',
    'year_to',
  ],
};

interface SeedDoc {
  makes: Array<{
    slug: string;
    name: string;
    models: Array<{
      slug: string;
      variants: Array<{
        variantCode: string;
        transmission: string;
        fuelType: string;
        drive: string;
        seats: number;
      }>;
    }>;
  }>;
}
const SEED = JSON.parse(
  readFileSync(
    new URL('../../../../apps/api/src/modules/cat/data/vehicle-catalog.json', import.meta.url),
    'utf8',
  ),
) as SeedDoc;
const SEED_MODELS = SEED.makes.flatMap((m) => m.models);
const SEED_VARIANTS = SEED_MODELS.flatMap((o) => o.variants);

async function sqlState(client: pg.ClientBase, sql: string): Promise<string> {
  await client.query('SAVEPOINT s');
  try {
    await client.query(sql);
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code ?? 'inconnu';
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT s');
  }
}

describe('socle RLS et droits (0063)', () => {
  it('trois tables : RLS ENABLE + FORCE, migrator_all, propriétaire migrator', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        relname: string;
        rls: boolean;
        force: boolean;
        owner: string;
        policies: string[];
      }>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                ARRAY(SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                               SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END
                                 FROM pg_catalog.unnest(p.polroles) AS r ORDER BY 1), ',')
                        FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1) AS policies
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p')
            AND c.relname ~ '^catalog_vehicle_(make|model|variant)$'
          ORDER BY c.relname`,
      );
      expect(rows.map((r) => r.relname)).toEqual([...TABLES]);
      for (const r of rows) {
        expect(r, r.relname).toMatchObject({ rls: true, force: true, owner: 'migrator' });
        // US-115 (0066) : lecture du statut, du marché et des années par les commandes de l'hôte
        // (catalog_cmd_owner, propriétaire NOLOGIN), jamais par un rôle applicatif de plus
        expect(r.policies, r.relname).toEqual([
          'api_read:app_api',
          'catalog_cmd_read:catalog_cmd_owner',
          'migrator_all:migrator',
        ]);
      }
    });
  });

  it.each(TABLES)(
    '%s : colonnes lisibles par app_api, rien pour app_worker ni app_anon',
    async (t) => {
      await withRole('app_api', async (client) => {
        // ACL lues dans pg_catalog (information_schema ne montre que les droits du rôle courant)
        const { rows } = await client.query<{
          grantee: string;
          privilege: string;
          column_name: string;
        }>(
          `SELECT CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END
                  AS grantee,
                x.privilege_type AS privilege, a.attname AS column_name
           FROM pg_catalog.pg_attribute a, pg_catalog.aclexplode(a.attacl) x
          WHERE a.attrelid = ('core.' || $1)::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND (x.grantee = 0 OR pg_catalog.pg_get_userbyid(x.grantee) IN ('app_api', 'app_worker', 'app_anon'))
          ORDER BY 1, 2, 3`,
          [t],
        );
        expect(rows.every((r) => r.grantee === 'app_api' && r.privilege === 'SELECT')).toBe(true);
        expect(rows.map((r) => r.column_name)).toEqual(API_COLUMNS[t]);
        const table = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n
           FROM pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) x
          WHERE c.oid = ('core.' || $1)::regclass
            AND (x.grantee = 0 OR pg_catalog.pg_get_userbyid(x.grantee) IN ('app_api', 'app_worker', 'app_anon'))`,
          [t],
        );
        expect(table.rows[0]?.n).toBe(0);
      });
    },
  );

  it.each(['app_api', 'app_worker', 'app_anon'] as const)(
    '%s : aucune écriture (INSERT, UPDATE, DELETE, TRUNCATE ⇒ 42501)',
    async (role) => {
      await withRole(role, async (client) => {
        await client.query('BEGIN');
        try {
          for (const t of TABLES) {
            expect(
              await sqlState(client, `INSERT INTO core.${t} (id) VALUES (gen_random_uuid())`),
              t,
            ).toBe('42501');
            expect(await sqlState(client, `UPDATE core.${t} SET status = 'RETIRED'`), t).toBe(
              '42501',
            );
            expect(await sqlState(client, `DELETE FROM core.${t}`), t).toBe('42501');
            expect(await sqlState(client, `TRUNCATE core.${t}`), t).toBe('42501');
          }
        } finally {
          await client.query('ROLLBACK');
        }
      });
    },
  );

  it.each(['app_worker', 'app_anon'] as const)(
    '%s ne lit aucune table du catalogue (42501)',
    async (role) => {
      await withRole(role, async (client) => {
        await client.query('BEGIN');
        try {
          for (const t of TABLES) {
            expect(await sqlState(client, `SELECT id FROM core.${t}`), t).toBe('42501');
          }
        } finally {
          await client.query('ROLLBACK');
        }
      });
    },
  );

  it('app_api ne lit ni la provenance ni le vérificateur (42501)', async () => {
    await withRole('app_api', async (client) => {
      await client.query('BEGIN');
      try {
        for (const t of TABLES) {
          for (const col of ['source', 'source_ref', 'license_note', 'created_at']) {
            expect(await sqlState(client, `SELECT ${col} FROM core.${t}`), `${t}.${col}`).toBe(
              '42501',
            );
          }
        }
        for (const col of ['verified_by', 'verified_at']) {
          expect(
            await sqlState(client, `SELECT ${col} FROM core.catalog_vehicle_variant`),
            col,
          ).toBe('42501');
        }
      } finally {
        await client.query('ROLLBACK');
      }
    });
  });
});

describe('critère 1 : une ligne de graine sans licence fait échouer la migration', () => {
  it('source et license_note : NOT NULL et CHECK « non vide » sur les trois tables', async () => {
    await withRole('app_api', async (client) => {
      for (const t of TABLES) {
        const { rows } = await client.query<{ attname: string; attnotnull: boolean }>(
          `SELECT attname, attnotnull FROM pg_catalog.pg_attribute
            WHERE attrelid = ('core.' || $1)::regclass AND attname IN ('source', 'license_note')
            ORDER BY attname`,
          [t],
        );
        expect(rows, t).toEqual([
          { attname: 'license_note', attnotnull: true },
          { attname: 'source', attnotnull: true },
        ]);
        const checks = await client.query<{ def: string }>(
          `SELECT pg_catalog.pg_get_constraintdef(oid) AS def FROM pg_catalog.pg_constraint
            WHERE conrelid = ('core.' || $1)::regclass AND contype = 'c'`,
          [t],
        );
        const defs = checks.rows.map((r) => r.def).join('\n');
        expect(defs, t).toMatch(/btrim\(license_note\) <> ''/);
        expect(defs, t).toMatch(/source = ANY/);
      }
    });
  });

  it('la preuve 9970 a joué : instructions refusées en entier, aucune ligne chargée', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ slug: string; status: string }>(
        `SELECT slug, status FROM core.catalog_vehicle_make WHERE slug LIKE 'zz-us113-%' ORDER BY slug`,
      );
      // témoin RETIRED posé APRÈS les preuves : la fixture est allée au bout
      expect(rows).toContainEqual({ slug: 'zz-us113-preuve', status: 'RETIRED' });
      expect(rows.filter((r) => r.slug.startsWith('zz-us113-rejet-'))).toEqual([]);
      const models = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM core.catalog_vehicle_model WHERE slug IN ('zz-sans-source', 'zz-modele')`,
      );
      expect(models.rows[0]?.n).toBe(0);
    });
  });
});

describe('graine de production (base « production » du banc)', () => {
  it('exactement les marques, modèles et variantes des données, sans ligne de test', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const makes = await client.query<{ slug: string; name: string; status: string }>(
          `SELECT slug, name, status FROM core.catalog_vehicle_make ORDER BY slug`,
        );
        expect(makes.rows.map((r) => r.slug)).toEqual(SEED.makes.map((m) => m.slug).sort());
        expect(makes.rows.every((r) => r.status === 'ACTIVE')).toBe(true);
        const counts = await client.query<{ models: number; variants: number }>(
          `SELECT (SELECT count(*)::int FROM core.catalog_vehicle_model WHERE status = 'ACTIVE') AS models,
                  (SELECT count(*)::int FROM core.catalog_vehicle_variant WHERE status = 'ACTIVE') AS variants`,
        );
        expect(counts.rows[0]).toEqual({
          models: SEED_MODELS.length,
          variants: SEED_VARIANTS.length,
        });
        const epa = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM core.catalog_vehicle_variant WHERE consumption_source IS NOT NULL`,
        );
        expect(epa.rows[0]?.n).toBe(0);
      },
      { database: 'production' },
    );
  });

  it('Toyota Hilux de la graine : places, boîte, carburant, transmission intégrale', async () => {
    const hilux = SEED.makes
      .find((m) => m.slug === 'toyota')
      ?.models.find((o) => o.slug === 'hilux');
    if (!hilux) throw new Error('Hilux absent des données');
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{
          transmission: string;
          fuel_type: string;
          drive: string;
          seats: number;
        }>(
          `SELECT v.transmission, v.fuel_type, v.drive, v.seats
             FROM core.catalog_vehicle_variant v
             JOIN core.catalog_vehicle_model o ON o.id = v.model_id
             JOIN core.catalog_vehicle_make m ON m.id = o.make_id
            WHERE m.slug = 'toyota' AND o.slug = 'hilux'
            ORDER BY v.transmission`,
        );
        expect(rows).toEqual(
          hilux.variants
            .map((v) => ({
              transmission: v.transmission,
              fuel_type: v.fuelType,
              drive: v.drive,
              seats: v.seats,
            }))
            .sort((a, b) => a.transmission.localeCompare(b.transmission)),
        );
      },
      { database: 'production' },
    );
  });

  it.each(COUNTRIES)(
    'catalogue commun aux pays : $country ($currency) voit toutes les variantes (market nul)',
    async ({ country }) => {
      await withRole(
        'app_api',
        async (client) => {
          const { rows } = await client.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM core.catalog_vehicle_variant
              WHERE status = 'ACTIVE' AND (market IS NULL OR market = $1)`,
            [country],
          );
          expect(rows[0]?.n).toBe(SEED_VARIANTS.length);
          const known = await client.query<{ ok: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM core.config_country WHERE code = $1) AS ok`,
            [country],
          );
          expect(known.rows[0]?.ok).toBe(true);
        },
        { database: 'production' },
      );
    },
  );
});

describe('visibilité pour app_api (base de test, fixtures 9970)', () => {
  it('ACTIVE et RETIRED lisibles, PENDING_REVIEW invisible', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ slug: string }>(
        `SELECT slug FROM core.catalog_vehicle_make WHERE slug LIKE 'zz-us113-%' ORDER BY slug`,
      );
      expect(rows.map((r) => r.slug)).toEqual([
        'zz-us113-epa',
        'zz-us113-preuve',
        'zz-us113-retiree',
      ]);
      const statuses = await client.query<{ status: string }>(
        `SELECT DISTINCT status FROM core.catalog_vehicle_variant ORDER BY status`,
      );
      expect(statuses.rows.map((r) => r.status)).toEqual(['ACTIVE', 'RETIRED']);
    });
  });
});
