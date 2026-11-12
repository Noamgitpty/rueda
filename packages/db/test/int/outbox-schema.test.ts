/**
 * Intégration du schéma de l'outbox (US-008, migrations 0012 à 0015 ; 17 §4.1, §4.2 ; ADR-050).
 * Vérifie, sous les rôles de production :
 * - RLS ENABLE + FORCE, propriétaire migrator, politique `migrator_all` (CLAUDE.md point 5) ;
 * - droits : rien pour PUBLIC ni app_anon ; aucun DELETE ni TRUNCATE ; app_api n'écrit que
 *   l'enveloppe d'un événement et l'ajout d'une tâche, sans lecture ; colonnes bornées ;
 * - politiques : aucune pour PUBLIC, aucune DELETE ni ALL hors migrator_all ;
 * - fonctions : SECURITY INVOKER, search_path figé, sans EXECUTE pour PUBLIC ;
 * - UUID v7 (17 §4.1) horodaté par platform.now().
 */
import { describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';
import { outboxTx } from '../support/outbox.ts';

const OUTBOX_TABLES = [
  'outbox_dead_letter',
  'outbox_inbox_receipt',
  'outbox_outbox_event',
  'outbox_scheduled_job',
] as const;

const OUTBOX_FUNCTIONS = [
  'core.outbox_begin_receipt(uuid)',
  'core.outbox_claim_jobs(integer,interval)',
  'core.outbox_complete_job(uuid)',
  'core.outbox_enqueue(text,jsonb,text,uuid,timestamp with time zone,interval,integer)',
  'core.outbox_fail_job(uuid,text,interval)',
  'core.outbox_mark_published(uuid[])',
  'core.outbox_metrics()',
  'core.outbox_reap_expired_jobs()',
  'core.outbox_record_relay_failure(uuid[],text)',
  'core.outbox_relay_claim(integer)',
  'platform.uuid_v7()',
] as const;

describe('schéma outbox (US-008)', () => {
  it('quatre tables core.outbox_* : RLS ENABLE + FORCE, propriétaire migrator, migrator_all', async () => {
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
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p') AND c.relname ~ '^outbox_'
          ORDER BY c.relname`,
      );
      expect(rows.map((r) => r.relname)).toEqual([...OUTBOX_TABLES]);
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

  it('droits : rien pour app_anon ; aucun DELETE ni TRUNCATE ; app_api en écriture seule, bornée', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ grant: string }>(
        `SELECT r.role || ':' || t.tbl || ':' || p.priv AS grant
           FROM unnest($1::text[]) AS t(tbl),
                unnest(ARRAY['app_api', 'app_anon', 'app_worker']) AS r(role),
                unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(priv)
          WHERE CASE WHEN p.priv IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                     THEN pg_catalog.has_any_column_privilege(r.role, 'core.' || t.tbl, p.priv)
                     ELSE pg_catalog.has_table_privilege(r.role, 'core.' || t.tbl, p.priv) END
          ORDER BY 1`,
        [OUTBOX_TABLES],
      );
      expect(rows.map((r) => r.grant)).toEqual([
        'app_api:outbox_outbox_event:INSERT',
        'app_api:outbox_scheduled_job:INSERT',
        'app_worker:outbox_dead_letter:INSERT',
        'app_worker:outbox_dead_letter:SELECT',
        'app_worker:outbox_inbox_receipt:INSERT',
        'app_worker:outbox_inbox_receipt:SELECT',
        'app_worker:outbox_outbox_event:INSERT',
        'app_worker:outbox_outbox_event:SELECT',
        'app_worker:outbox_outbox_event:UPDATE',
        'app_worker:outbox_scheduled_job:INSERT',
        'app_worker:outbox_scheduled_job:SELECT',
        'app_worker:outbox_scheduled_job:UPDATE',
      ]);

      // un producteur ne choisit ni l'heure du fait, ni la publication, ni les tentatives
      const { rows: cols } = await client.query<{ col: string }>(
        `SELECT r.role || ':' || c.tbl || '.' || c.col || ':' || c.priv AS col
           FROM (VALUES
                   ('outbox_outbox_event', 'occurred_at', 'INSERT'),
                   ('outbox_outbox_event', 'created_at', 'INSERT'),
                   ('outbox_outbox_event', 'published_at', 'INSERT'),
                   ('outbox_outbox_event', 'attempts', 'INSERT'),
                   ('outbox_outbox_event', 'last_error', 'INSERT'),
                   ('outbox_outbox_event', 'type', 'UPDATE'),
                   ('outbox_outbox_event', 'payload', 'UPDATE'),
                   ('outbox_outbox_event', 'occurred_at', 'UPDATE'),
                   ('outbox_scheduled_job', 'state', 'INSERT'),
                   ('outbox_scheduled_job', 'attempts', 'INSERT'),
                   ('outbox_scheduled_job', 'locked_until', 'INSERT'),
                   ('outbox_scheduled_job', 'name', 'UPDATE'),
                   ('outbox_scheduled_job', 'payload', 'UPDATE'),
                   ('outbox_scheduled_job', 'max_attempts', 'UPDATE'),
                   ('outbox_inbox_receipt', 'processed_at', 'INSERT'),
                   ('outbox_dead_letter', 'replayed_at', 'INSERT'),
                   ('outbox_dead_letter', 'parked_at', 'INSERT')
                ) AS c(tbl, col, priv),
                unnest(ARRAY['app_api', 'app_worker']) AS r(role)
          WHERE pg_catalog.has_column_privilege(r.role, 'core.' || c.tbl, c.col, c.priv)`,
      );
      expect(cols.map((c) => c.col)).toEqual([]);
    });
  });

  it('politiques : aucune pour PUBLIC ; aucune DELETE ni ALL hors migrator_all ; rôles de production seulement', async () => {
    await withRole('app_worker', async (client) => {
      const { rows } = await client.query<{ pol: string; roles: string; cmd: string }>(
        `SELECT c.relname || '.' || p.polname AS pol, p.polcmd::text AS cmd,
                pg_catalog.array_to_string(ARRAY(
                  SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(r) END
                    FROM pg_catalog.unnest(p.polroles) AS r ORDER BY 1), ',') AS roles
           FROM pg_catalog.pg_policy p
           JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname ~ '^outbox_'
          ORDER BY 1`,
      );
      expect(rows.length).toBeGreaterThan(OUTBOX_TABLES.length);
      for (const r of rows) {
        if (r.pol.endsWith('.migrator_all')) {
          expect(r.roles, r.pol).toBe('migrator');
          continue;
        }
        // commandes de hold (0037, US-023) : insertion de leurs seuls événements booking.hold.*
        if (r.pol === 'outbox_outbox_event.cmd_hold_event_ins') {
          expect(r).toMatchObject({ roles: 'cmd_hold_owner', cmd: 'a' });
          continue;
        }
        // commandes de l'OTP (0066, US-104) : insertion de leurs seuls événements
        // iam.otp.requested et iam.phone.verified
        if (r.pol === 'outbox_outbox_event.iam_auth_otp_event_ins') {
          expect(r).toMatchObject({ roles: 'iam_auth_owner', cmd: 'a' });
          continue;
        }
        // décision de la file d'ajout au catalogue (0074, US-114) : insertion de son seul
        // événement catalog.addition_request.resolved
        if (r.pol === 'outbox_outbox_event.catalog_cmd_event_insert') {
          expect(r).toMatchObject({ roles: 'catalog_cmd_owner', cmd: 'a' });
          continue;
        }
        // vérification d'identité (0072, US-105) : insertion de ses seuls événements
        // kyc.verification.status_changed
        // vérification de l'hôte (0075, US-123) : kyc.host_verification.decided,
        // iam.organization.status_changed et iam.organization.created seulement
        if (r.pol === 'outbox_outbox_event.kyc_cmd_host_event_ins') {
          expect(r).toMatchObject({ roles: 'kyc_cmd_owner', cmd: 'a' });
          continue;
        }
        if (r.pol === 'outbox_outbox_event.kyc_cmd_event_ins') {
          expect(r).toMatchObject({ roles: 'kyc_cmd_owner', cmd: 'a' });
          continue;
        }
        // interrupteurs à deux personnes (0073, US-125) : insertion de config.param.changed seulement
        if (r.pol === 'outbox_outbox_event.cmd_golive_event_ins') {
          expect(r).toMatchObject({ roles: 'cmd_golive_owner', cmd: 'a' });
          continue;
        }
        expect(['app_api', 'app_worker'], r.pol).toContain(r.roles);
        expect(['r', 'a', 'w'], r.pol).toContain(r.cmd);
      }
    });
  });

  it('fonctions : SECURITY INVOKER, search_path figé, EXECUTE ni à PUBLIC ni à app_anon ; app_api : enqueue seulement', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        fn: string;
        secdef: boolean;
        owner: string;
        config: string[] | null;
        api: boolean;
        anon: boolean;
        worker: boolean;
        public_exec: boolean;
      }>(
        `SELECT p.oid::regprocedure::text AS fn, p.prosecdef AS secdef,
                pg_catalog.pg_get_userbyid(p.proowner) AS owner, p.proconfig AS config,
                pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE') AS api,
                pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE') AS anon,
                pg_catalog.has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
                COALESCE(p.proacl::text ~ '(^|[{,])=X', true) AS public_exec
           FROM pg_catalog.pg_proc p
          WHERE p.oid = ANY ($1::regprocedure[])
          ORDER BY 1`,
        [OUTBOX_FUNCTIONS],
      );
      // regprocedure s'affiche sans espace après les virgules
      expect(rows.map((r) => r.fn).sort()).toEqual([...OUTBOX_FUNCTIONS].sort());
      for (const r of rows) {
        expect(r, r.fn).toMatchObject({
          secdef: false,
          owner: 'migrator',
          anon: false,
          worker: true,
          public_exec: false,
        });
        expect(r.config, r.fn).toEqual(['search_path=pg_catalog, pg_temp']);
      }
      expect(rows.filter((r) => r.api).map((r) => r.fn)).toEqual([
        'core.outbox_enqueue(text,jsonb,text,uuid,timestamp with time zone,interval,integer)',
        'platform.uuid_v7()',
      ]);
    });
  });

  it('platform.uuid_v7() : version 7, variante RFC 9562, 48 bits = millisecondes de platform.now()', async () => {
    await withRole('app_api', async (client) => {
      for (const virtualNow of ['2031-07-01T08:00:00.123Z', '2031-07-01T08:00:01.000Z']) {
        await outboxTx(client, { virtualNow }, async (tx) => {
          const { rows } = await tx.query<{ id: string }>('SELECT platform.uuid_v7()::text AS id');
          const id = rows[0]?.id ?? '';
          expect(id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          );
          const ms = Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
          expect(ms).toBe(Date.parse(virtualNow));
        });
      }
      // ordre : un identifiant plus tardif trie après (relais ORDER BY id, 17 §4.2)
      const ids: string[] = [];
      for (const virtualNow of ['2031-07-01T08:00:00.000Z', '2031-07-01T08:00:00.001Z']) {
        await outboxTx(client, { virtualNow }, async (tx) => {
          const { rows } = await tx.query<{ id: string }>('SELECT platform.uuid_v7()::text AS id');
          ids.push(rows[0]?.id ?? '');
        });
      }
      expect([...ids].sort()).toEqual(ids);
    });
  });
});
