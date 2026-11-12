/**
 * Intégration du schéma IAM (US-010, migrations 0010, 0011 et test 9200), sous les rôles de
 * production (assertion L0-05 par withRole) :
 * - RLS ENABLE + FORCE sur toutes les tables iam_*, politique migrator_all (17 §2.3, B9), plus
 *   (US-011) les politiques des propriétaires iam_auth_owner / policy_fn_owner et les lectures
 *   d'app_api par acteur (0025) ;
 * - aucun droit d'ÉCRITURE de table pour app_api, app_worker, app_anon ; lecture d'app_api bornée
 *   à user_account (sans password_hash), organization et membership (US-011) ;
 * - commandes core.iam_* : SECURITY DEFINER, propriétaire iam_auth_owner (US-011, ADR-053),
 *   search_path figé, EXECUTE au seul app_api (liste blanche RLS-15 : l0-rls-15-security-definer) ;
 * - contraintes structurelles de 17 §3.2.1 utiles à US-011 (titulaire du compte d'hôte, portée
 *   par pays du staff, rôles).
 */
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { register, uuid } from '../support/iam.ts';

const IAM_TABLES = [
  'iam_auth_factor',
  'iam_email_verification',
  'iam_membership',
  'iam_mfa_proof_key',
  'iam_organization',
  'iam_otp_challenge',
  'iam_restriction',
  'iam_role_permission',
  'iam_session',
  'iam_staff_role_assignment',
  'iam_user_account',
] as const;

// Politiques attendues par table (US-010 : migrator_all ; US-011 : 0022, 0024, 0025 ; US-012 :
// 0033, iam_staff_owner et lecture des sessions par policy_fn_owner ; US-062 : 0035, 0036,
// matrice lue par policy_fn_owner, voyageur minimisé par host_view_owner, commandes FINANCE ;
// US-101 : 0060, pays d'un compte d'hôte lu par la console).
const IAM_POLICIES: Record<(typeof IAM_TABLES)[number], string> = {
  iam_auth_factor:
    'iam_staff_insert:iam_staff_owner;iam_staff_select:iam_staff_owner;iam_staff_update:iam_staff_owner;migrator_all:migrator',
  iam_email_verification:
    'iam_auth_insert:iam_auth_owner;iam_auth_select:iam_auth_owner;iam_auth_update:iam_auth_owner;migrator_all:migrator',
  // US-049 (0056) : lecture des appartenances par les commandes de hold (auto-réservation)
  // US-107 (0061) : ouverture du compte d'hôte par les commandes d'iam_auth_owner
  iam_membership:
    'cmd_hold_read:cmd_hold_owner;iam_auth_insert:iam_auth_owner;iam_auth_select:iam_auth_owner;membership_host_read:app_api;membership_staff_read:app_api;migrator_all:migrator;policy_fn_read:policy_fn_owner',
  iam_organization:
    'cmd_hold_read:cmd_hold_owner;cmd_money_sel:cmd_money_owner;iam_auth_insert:iam_auth_owner;iam_auth_select:iam_auth_owner;iam_staff_select:iam_staff_owner;kyc_cmd_host_update:kyc_cmd_owner;kyc_cmd_read:kyc_cmd_owner;migrator_all:migrator;organization_holder_read:app_api;organization_staff_read:app_api;policy_fn_read:policy_fn_owner',
  iam_mfa_proof_key: 'iam_staff_select:iam_staff_owner;migrator_all:migrator',
  // US-104 (0066) : défis OTP écrits par les seules commandes d'iam_auth_owner
  iam_otp_challenge:
    'iam_auth_delete:iam_auth_owner;iam_auth_insert:iam_auth_owner;iam_auth_select:iam_auth_owner;iam_auth_update:iam_auth_owner;migrator_all:migrator',
  // US-109 (0064) : restrictions manuelles par le gestionnaire de console d'iam_auth_owner, lues
  // par la pose d'un hold (cmd_hold_owner) et par la fiche 360° (iam_staff_owner)
  iam_restriction:
    'cmd_hold_read:cmd_hold_owner;iam_auth_insert:iam_auth_owner;iam_auth_select:iam_auth_owner;iam_auth_update:iam_auth_owner;iam_staff_select:iam_staff_owner;migrator_all:migrator',
  // US-125 (0073) : session, rôles et matrice lus par les commandes des interrupteurs
  iam_role_permission:
    'cmd_golive_sel:cmd_golive_owner;cmd_money_sel:cmd_money_owner;iam_staff_select:iam_staff_owner;migrator_all:migrator;policy_fn_read:policy_fn_owner',
  iam_session:
    'cmd_golive_sel:cmd_golive_owner;cmd_money_sel:cmd_money_owner;iam_auth_insert:iam_auth_owner;iam_auth_select:iam_auth_owner;iam_auth_update:iam_auth_owner;iam_staff_select:iam_staff_owner;iam_staff_update:iam_staff_owner;migrator_all:migrator;policy_fn_read:policy_fn_owner',
  iam_staff_role_assignment:
    'cmd_golive_sel:cmd_golive_owner;cmd_money_sel:cmd_money_owner;iam_auth_select:iam_auth_owner;iam_staff_select:iam_staff_owner;iam_staff_update:iam_staff_owner;migrator_all:migrator;policy_fn_read:policy_fn_owner',
  iam_user_account:
    'cmd_golive_sel:cmd_golive_owner;cmd_money_sel:cmd_money_owner;host_view_read:host_view_owner;iam_auth_insert:iam_auth_owner;iam_auth_select:iam_auth_owner;iam_auth_update:iam_auth_owner;iam_staff_select:iam_staff_owner;kyc_cmd_read:kyc_cmd_owner;migrator_all:migrator;policy_fn_read:policy_fn_owner;user_account_self_read:app_api',
};

// Commandes SECURITY DEFINER core.iam_* et leur propriétaire (US-010 : iam_auth ; US-012 : iam_staff).
const IAM_COMMANDS: Record<string, string> = {
  'core.iam_auth_lookup(text)': 'iam_auth_owner',
  'core.iam_cmd_open_session(uuid,uuid,bytea,integer,text,inet,text)': 'iam_auth_owner',
  'core.iam_cmd_register(uuid,text,text,text,text,text,uuid,bytea,integer,inet)': 'iam_auth_owner',
  // US-102 (0059) : inscription avec consentements versionnés
  'core.iam_cmd_register_with_consents(uuid,text,text,text,text,text,uuid,bytea,integer,inet,text,jsonb,boolean)':
    'iam_auth_owner',
  // US-107 (0061) : ouverture du compte d'hôte en libre-service, comptes d'hôte de la session
  'core.iam_cmd_open_host_account(bytea,text,text)': 'iam_auth_owner',
  'core.iam_host_accounts(bytea)': 'iam_auth_owner',
  // US-104 (0066) : OTP du téléphone (état, demande, saisie) par la personne de la session
  'core.iam_cmd_phone_otp_request(bytea,text,text)': 'iam_auth_owner',
  'core.iam_cmd_phone_otp_verify(bytea,bytea[])': 'iam_auth_owner',
  'core.iam_phone_otp_state(bytea)': 'iam_auth_owner',
  'core.iam_cmd_revoke_all_sessions(bytea)': 'iam_auth_owner',
  'core.iam_cmd_revoke_session(bytea,text)': 'iam_auth_owner',
  'core.iam_cmd_verify_email(bytea)': 'iam_auth_owner',
  'core.iam_session_resolve(bytea)': 'iam_auth_owner',
  'core.iam_staff_audit_read(bytea,bigint,integer)': 'iam_staff_owner',
  'core.iam_staff_cmd_begin(bytea)': 'iam_staff_owner',
  // porte des lectures de données personnelles par le staff (US-004, 0051)
  'core.iam_staff_cmd_data_access(bytea,uuid,uuid,text,uuid,text,text,text)': 'iam_staff_owner',
  'core.iam_staff_cmd_elevate(bytea,uuid,bigint,bytea)': 'iam_staff_owner',
  'core.iam_staff_cmd_enroll_reveal(bytea,bytea)': 'iam_staff_owner',
  'core.iam_staff_cmd_manual_action(bytea,uuid,text,uuid,text,jsonb)': 'iam_staff_owner',
  // cadre des actions de console (US-101, 0060) : pièces, commande de domaine liée
  'core.iam_staff_cmd_manual_action(bytea,uuid,text,uuid,text,jsonb,uuid[])': 'iam_staff_owner',
  'core.iam_staff_cmd_mfa_attempt(bytea)': 'iam_staff_owner',
  'core.iam_staff_cmd_reset_totp(bytea,uuid,uuid,text,uuid,text,bytea,integer)': 'iam_staff_owner',
  'core.iam_staff_cmd_suspend(bytea,uuid,uuid,text)': 'iam_staff_owner',
  // US-043 (0049) : issue d'accès des lectures de la console, sans écriture
  'core.iam_staff_read_access(bytea,text,text)': 'iam_staff_owner',
};

/** Lecture des coordonnées pour NTF (US-021, migration 0031), exécutable par app_worker seul. */
const NOTIFICATION_CONTACT = 'core.iam_notification_contact(uuid)';
/**
 * Émission et purge des codes OTP (US-104, migration 0066) : exécutables par app_worker SEUL (et
 * par les seuls travailleurs `iam_otp_sender` et `iam_otp_pruner`, garde dans la fonction).
 */
const OTP_WORKER_FUNCTIONS = [
  'core.iam_worker_otp_issue(uuid,bytea)',
  'core.iam_worker_otp_prune(integer)',
];
/**
 * Gestionnaire de console de CREATE_HOST_ACCOUNT (US-107, 0061) : exécutable par iam_staff_owner
 * SEUL, jamais par un rôle applicatif (garde des liaisons d'ADR-092 : il reçoit l'acteur).
 */
const HOST_ACCOUNT_HANDLER =
  'core.iam_manual_action_create_host_account(bytea,uuid,text,uuid,jsonb,text,uuid,text)';
/** Gestionnaire de console de RESTRICT_ACCOUNT / LIFT_RESTRICTION (US-109, 0064) : même règle. */
const RESTRICTION_HANDLER =
  'core.iam_manual_action_restriction(bytea,uuid,text,uuid,jsonb,text,uuid,text)';

describe('schéma IAM (US-010)', () => {
  it('tables iam_* : RLS ENABLE + FORCE, propriétaire migrator, politiques attendues seulement', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        relname: string;
        rls: boolean;
        force: boolean;
        owner: string;
        policies: string;
      }>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                pg_catalog.array_to_string(ARRAY(
                  SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                           SELECT pg_catalog.pg_get_userbyid(r) FROM pg_catalog.unnest(p.polroles) AS r), ',')
                    FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1), ';') AS policies
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p') AND c.relname ~ '^iam_'
          ORDER BY c.relname`,
      );
      expect(rows.map((r) => r.relname)).toEqual([...IAM_TABLES]);
      for (const r of rows) {
        expect(r, r.relname).toEqual({
          relname: r.relname,
          rls: true,
          force: true,
          owner: 'migrator',
          policies: IAM_POLICIES[r.relname as (typeof IAM_TABLES)[number]],
        });
      }
    });
  });

  it('aucun droit d’écriture IAM pour les rôles applicatifs ; lecture d’app_api bornée (US-011)', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ g: string }>(
        `SELECT r.role || ':' || t.tbl || ':' || p.priv AS g
           FROM unnest($1::text[]) AS t(tbl),
                unnest(ARRAY['app_api', 'app_anon', 'app_worker']) AS r(role),
                unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(priv)
          WHERE pg_catalog.has_table_privilege(r.role, 'core.' || t.tbl, p.priv)`,
        [IAM_TABLES],
      );
      // aucune lecture de TABLE entière : app_api lit par colonnes, liste exacte (US-011)
      expect(rows.map((r) => r.g)).toEqual([]);
      const { rows: cols } = await client.query<{ col: string }>(
        `SELECT t.tbl || '.' || a.attname AS col
           FROM unnest($1::text[]) AS t(tbl)
           JOIN pg_catalog.pg_attribute a ON a.attrelid = ('core.' || t.tbl)::regclass
          WHERE a.attnum > 0 AND NOT a.attisdropped
            AND pg_catalog.has_column_privilege('app_api', ('core.' || t.tbl)::regclass, a.attnum, 'SELECT')`,
        [IAM_TABLES],
      );
      const of = (tbl: string, names: string[]) => names.map((n) => `${tbl}.${n}`);
      expect(cols.map((c) => c.col).sort()).toEqual(
        [
          ...of('iam_user_account', [
            'id',
            'email',
            'email_verified_at',
            'phone_e164',
            'phone_verified_at',
            'legal_first_name',
            'legal_last_name',
            'display_name',
            'date_of_birth',
            'preferred_locale',
            'residence_country',
            'status',
            'created_at',
            'updated_at',
          ]),
          ...of('iam_organization', [
            'id',
            'kind',
            'holder_user_id',
            'country_code',
            'display_name',
            'tax_id',
            'status',
            'plan_code',
            'legal_entity_id',
            'created_at',
            'updated_at',
          ]),
          ...of('iam_membership', [
            'id',
            'user_id',
            'org_id',
            'role',
            'vehicle_scope',
            'permission_overrides',
            'status',
            'invite_expires_at',
            'created_at',
            'updated_at',
          ]),
        ].sort(),
      );
      // ni app_worker ni app_anon : aucune colonne IAM
      const { rows: others } = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM unnest($1::text[]) AS t(tbl), unnest(ARRAY['app_worker', 'app_anon']) AS r(role)
          WHERE pg_catalog.has_any_column_privilege(r.role, ('core.' || t.tbl)::regclass, 'SELECT')`,
        [IAM_TABLES],
      );
      expect(others[0]?.n).toBe(0);
      for (const sql of [
        'SELECT password_hash FROM core.iam_user_account LIMIT 1',
        'SELECT token_hash FROM core.iam_session LIMIT 1',
        `UPDATE core.iam_session SET revoked_at = NULL`,
        `DELETE FROM core.iam_session`,
      ]) {
        await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
    });
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(client.query('SELECT 1 FROM core.iam_session LIMIT 1')).rejects.toMatchObject({
          code: '42501',
        });
      });
    }
  });

  it('commandes IAM : SECURITY DEFINER, propriétaire de leur famille (iam_auth, iam_staff), search_path figé, EXECUTE au seul app_api', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        fn: string;
        secdef: boolean;
        owner: string;
        config: string[] | null;
        api: boolean;
        worker: boolean;
        anon: boolean;
        public_exec: boolean;
      }>(
        `SELECT pg_catalog.regexp_replace(p.oid::regprocedure::text, ', ', ',', 'g') AS fn,
                p.prosecdef AS secdef, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
                p.proconfig AS config,
                pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE') AS api,
                pg_catalog.has_function_privilege('app_worker', p.oid, 'EXECUTE') AS worker,
                pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE') AS anon,
                COALESCE(p.proacl::text ~ '(^|[{,])=X', true) AS public_exec
           FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'core' AND p.proname ~ '^iam_' AND p.prosecdef
          ORDER BY 1`,
      );
      // US-021 (ADR-061) : une seule fonction IAM est exécutable par app_worker, et par lui seul :
      // les coordonnées d'un destinataire de notification (0 ligne hors du travailleur ntf_sender).
      const contact = rows.filter((r) => r.fn === NOTIFICATION_CONTACT);
      expect(contact).toEqual([
        {
          fn: NOTIFICATION_CONTACT,
          secdef: true,
          owner: 'iam_auth_owner',
          config: ['search_path=pg_catalog, pg_temp'],
          api: false,
          worker: true,
          anon: false,
          public_exec: false,
        },
      ]);
      for (const handler of [HOST_ACCOUNT_HANDLER, RESTRICTION_HANDLER]) {
        expect(rows.filter((r) => r.fn === handler)).toEqual([
          {
            fn: handler,
            secdef: true,
            owner: 'iam_auth_owner',
            config: ['search_path=pg_catalog, pg_temp'],
            api: false,
            worker: false,
            anon: false,
            public_exec: false,
          },
        ]);
      }
      expect(rows.filter((r) => OTP_WORKER_FUNCTIONS.includes(r.fn))).toEqual(
        OTP_WORKER_FUNCTIONS.map((fn) => ({
          fn,
          secdef: true,
          owner: 'iam_auth_owner',
          config: ['search_path=pg_catalog, pg_temp'],
          api: false,
          worker: true,
          anon: false,
          public_exec: false,
        })),
      );
      const commands = rows.filter(
        (r) =>
          r.fn !== NOTIFICATION_CONTACT &&
          r.fn !== HOST_ACCOUNT_HANDLER &&
          r.fn !== RESTRICTION_HANDLER &&
          !OTP_WORKER_FUNCTIONS.includes(r.fn),
      );
      expect(commands.map((r) => r.fn)).toEqual(Object.keys(IAM_COMMANDS).sort());
      for (const r of commands) {
        expect(r, r.fn).toMatchObject({
          secdef: true,
          owner: IAM_COMMANDS[r.fn],
          api: true,
          worker: false,
          anon: false,
          public_exec: false,
        });
        expect(r.config, r.fn).toEqual(['search_path=pg_catalog, pg_temp']);
      }
      // la fonction de trigger de session n'est pas SECURITY DEFINER et n'est exécutable par personne
      const { rows: guard } = await client.query<{ secdef: boolean; api: boolean }>(
        `SELECT p.prosecdef AS secdef, pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE') AS api
           FROM pg_catalog.pg_proc p WHERE p.oid = 'core.iam_session_guard()'::regprocedure`,
      );
      expect(guard).toEqual([{ secdef: false, api: false }]);
    });
  });

  it('commandes IAM refusées à app_worker et app_anon (42501)', async () => {
    for (const role of ['app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query(`SELECT * FROM core.iam_session_resolve('\\x00'::bytea)`),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
  });

  it('compte d’hôte : un titulaire par pays ; le P2P_HOST de membership est le titulaire', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const holder = await register(tx);
        const other = await register(tx);
        const orgPa = uuid();
        await tx.query('SELECT test_fixture.iam_insert_organization($1, $2, $3)', [
          orgPa,
          holder.userId,
          'XA',
        ]);
        // même titulaire, autre pays : un second compte d'hôte (17 §2.3)
        await tx.query('SELECT test_fixture.iam_insert_organization($1, $2, $3)', [
          uuid(),
          holder.userId,
          'XB',
        ]);
        await tx.query('SAVEPOINT s');
        await expect(
          tx.query('SELECT test_fixture.iam_insert_organization($1, $2, $3)', [
            uuid(),
            holder.userId,
            'XA',
          ]),
        ).rejects.toMatchObject({
          code: '23505',
          constraint: 'organization_country_holder_unique',
        });
        await tx.query('ROLLBACK TO SAVEPOINT s');
        // P2P_HOST qui n'est pas le titulaire : refusé par la clé étrangère
        await expect(
          tx.query('SELECT test_fixture.iam_insert_membership($1, $2, $3, $4, $5, $6)', [
            uuid(),
            other.userId,
            orgPa,
            'P2P_HOST',
            [],
            'ACTIVE',
          ]),
        ).rejects.toMatchObject({ code: '23503', constraint: 'membership_holder_matches_org' });
        await tx.query('ROLLBACK TO SAVEPOINT s');
        await tx.query('SELECT test_fixture.iam_insert_membership($1, $2, $3, $4, $5, $6)', [
          uuid(),
          holder.userId,
          orgPa,
          'P2P_HOST',
          [],
          'ACTIVE',
        ]);
        // co-hôte avec portée de véhicules : accepté ; portée sur un P2P_HOST : refusée
        await tx.query('SELECT test_fixture.iam_insert_membership($1, $2, $3, $4, $5, $6)', [
          uuid(),
          other.userId,
          orgPa,
          'CO_HOST',
          [uuid()],
          'INVITED',
        ]);
        await tx.query('SAVEPOINT t');
        await expect(
          tx.query(`SELECT test_fixture.iam_insert_organization($1, $2, 'xa')`, [
            uuid(),
            other.userId,
          ]),
        ).rejects.toMatchObject({ code: '23514', constraint: 'organization_country_format' });
        await tx.query('ROLLBACK TO SAVEPOINT t');
      });
    });
  });

  it('rôle interne : portée par pays obligatoire et bien formée ; aucune auto-attribution', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, {}, async (tx) => {
        const staff = await register(tx);
        const admin = await register(tx);
        const grant = (scope: string[], grantedBy: string | null, role = 'OPS_AGENT') =>
          tx.query('SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4, $5, NULL)', [
            uuid(),
            staff.userId,
            role,
            scope,
            grantedBy,
          ]);
        await grant(['XA'], admin.userId);
        await grant(['XA', 'XB'], admin.userId, 'FINANCE');
        for (const [scope, by, constraint] of [
          [[], admin.userId, 'staff_country_scope_format'],
          [['xa'], admin.userId, 'staff_country_scope_format'],
          [['XA', 'XAB'], admin.userId, 'staff_country_scope_format'],
          [['XA'], staff.userId, 'staff_no_self_grant'],
        ] as const) {
          await tx.query('SAVEPOINT s');
          await expect(grant([...scope], by)).rejects.toMatchObject({ code: '23514', constraint });
          await tx.query('ROLLBACK TO SAVEPOINT s');
        }
        await expect(grant(['XA'], admin.userId, 'P2P_HOST')).rejects.toMatchObject({
          code: '23514',
          constraint: 'staff_role_valid',
        });
      });
    });
  });
});
