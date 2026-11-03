/**
 * Intégration du banc (US-005) : base jetable, migrations sous migrator, droits minimaux.
 * Tout tourne sous les rôles de production (assertion L0-05 en tête, via withRole).
 */
import { describe, expect, it } from 'vitest';
import { listMigrations, MIGRATIONS_DIR, TEST_MIGRATIONS_DIR } from '../../src/index.ts';
import {
  benchInfo,
  TEST_DATABASE_PREFIX,
  withRole,
  withTestTransaction,
} from '../../src/testing/index.ts';

describe('banc PostgreSQL', () => {
  it('connexion directe à une base jetable rueda_test_*', async () => {
    const info = benchInfo();
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ db: string; port: string; version: string }>(
        `SELECT current_database() AS db, current_setting('port') AS port,
                current_setting('server_version_num') AS version`,
      );
      expect(rows[0]?.db).toBe(info.database);
      expect(rows[0]?.db.startsWith(TEST_DATABASE_PREFIX)).toBe(true);
      // Connexion directe : le port du serveur est celui de la configuration (pas de pooler).
      // Sous Testcontainers, Docker publie le port interne 5432 du conteneur sur un port
      // aléatoire de l'hôte : le serveur voit donc 5432, et le client le port publié.
      const expectedPort = info.sourceKind === 'testcontainers' ? 5432 : info.port;
      expect(Number(rows[0]?.port)).toBe(expectedPort);
      // Même version majeure que la production (17 §11) : PostgreSQL 16.
      expect(Math.floor(Number(rows[0]?.version) / 10_000)).toBe(16);
    });
  });

  it('btree_gist est installé', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM pg_catalog.pg_extension WHERE extname = 'btree_gist'`,
      );
      expect(rows[0]?.n).toBe('1');
    });
  });

  it('les objets de plateforme appartiennent à migrator', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ kind: string; owner: string }>(
        `SELECT 'schema' AS kind, pg_catalog.pg_get_userbyid(nspowner) AS owner
           FROM pg_catalog.pg_namespace WHERE nspname = 'platform'
         UNION ALL
         SELECT 'table', pg_catalog.pg_get_userbyid(relowner)
           FROM pg_catalog.pg_class WHERE oid = 'platform.schema_migration'::regclass`,
      );
      expect(rows).toEqual([
        { kind: 'schema', owner: 'migrator' },
        { kind: 'table', owner: 'migrator' },
      ]);
    });
  });

  it('platform.schema_migration : RLS ENABLE + FORCE, illisible pour les rôles applicatifs', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ rls: boolean; force: boolean }>(
        `SELECT relrowsecurity AS rls, relforcerowsecurity AS force
           FROM pg_catalog.pg_class WHERE oid = 'platform.schema_migration'::regclass`,
      );
      expect(rows[0]).toEqual({ rls: true, force: true });
      await expect(client.query('SELECT * FROM platform.schema_migration')).rejects.toMatchObject({
        code: '42501',
      });
    });
  });

  it('migrations appliquées sous migrator : production + test dans la base principale, production seule dans la base de contrôle', async () => {
    const info = benchInfo();
    const ids = (dirs: string[]): string[] =>
      listMigrations(dirs).map((m) => `${m.version}_${m.name}`);
    expect(info.appliedMigrations.main).toEqual(ids([MIGRATIONS_DIR, TEST_MIGRATIONS_DIR]));
    expect(info.appliedMigrations.production).toEqual(ids([MIGRATIONS_DIR]));
    expect(info.appliedMigrations.production).not.toContain('9000_test_virtual_clock');
    // Le banc a rejoué l'exécuteur une seconde fois (idempotence) ; ici, simple contrôle sous
    // un rôle de production que la base de contrôle est bien distincte.
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{ db: string }>('SELECT current_database() AS db');
        expect(rows[0]?.db).toBe(info.productionDatabase);
      },
      { database: 'production' },
    );
  });
});

describe('droits minimaux (0001_role_grants)', () => {
  it('app_api et app_worker exécutent platform.now() ; app_anon non', async () => {
    for (const role of ['app_api', 'app_worker'] as const) {
      await withRole(role, async (client) => {
        await expect(client.query('SELECT platform.now()')).resolves.toBeDefined();
      });
    }
    await withRole('app_anon', async (client) => {
      await expect(client.query('SELECT platform.now()')).rejects.toMatchObject({ code: '42501' });
    });
  });

  it('PUBLIC n’a pas EXECUTE sur platform.now()', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ acl: string }>(
        `SELECT coalesce(p.proacl::text, '') AS acl
           FROM pg_catalog.pg_proc p WHERE p.oid = 'platform.now()'::regprocedure`,
      );
      const acl = rows[0]?.acl ?? '';
      expect(acl).not.toMatch(/(^|[{,])=X/);
      expect(acl).toMatch(/app_api=X/);
      expect(acl).toMatch(/cmd_hold_owner=X/);
    });
  });

  for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
    it(`${role} ne crée rien dans public ni dans platform, ni de schéma`, async () => {
      await withRole(role, async (client) => {
        await expect(client.query('CREATE TABLE public.intruder (id int)')).rejects.toMatchObject({
          code: '42501',
        });
        await expect(client.query('CREATE TABLE platform.intruder (id int)')).rejects.toMatchObject(
          { code: '42501' },
        );
        await expect(client.query('CREATE SCHEMA intruder')).rejects.toMatchObject({
          code: '42501',
        });
      });
    });
  }
});

describe('transaction de test', () => {
  it('ROLLBACK par défaut, RESET ALL à la restitution', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        await tx.query(`SET LOCAL statement_timeout = '1234ms'`);
        await tx.query(`SET application_name = 'changed-in-test'`);
      });
      const { rows } = await client.query<{ st: string; app: string }>(
        `SELECT current_setting('statement_timeout') AS st, current_setting('application_name') AS app`,
      );
      expect(rows[0]?.st).not.toBe('1234ms');
      expect(rows[0]?.app).toBe('rueda-test-app_api');
    });
  });

  it('une erreur dans le test annule la transaction et restitue la connexion propre', async () => {
    await withRole('app_worker', async (client) => {
      await expect(
        withTestTransaction(client, { virtualNow: '2030-01-01T00:00:00Z' }, async (tx) => {
          await tx.query('SELECT 1/0');
        }),
      ).rejects.toMatchObject({ code: '22012' });
      const { rows } = await client.query<{ setting: string | null; idle: boolean }>(
        `SELECT current_setting('app.virtual_now', true) AS setting,
                pg_catalog.pg_current_xact_id_if_assigned() IS NULL AS idle`,
      );
      expect(rows[0]?.setting ?? '').toBe('');
      expect(rows[0]?.idle).toBe(true);
    });
  });
});
