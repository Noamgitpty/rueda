/**
 * Vérification d'une base RESTAURÉE (US-051, ADR-082 ; runbook docs/ops/BACKUP_RESTORE.md, étape
 * « Vérifier »). Outil d'exploitation, sans dépendance de test : le même code vérifie la
 * restauration de la préproduction locale (exercice chronométré, job CI « reprise ») et celle d'une
 * base gérée dans le cloud (même CLI, `node packages/db/src/restore/cli.ts`).
 *
 * Contrôles, chacun nommé dans le rapport (aucune donnée personnelle, aucun secret : comptes,
 * codes, versions et empreintes seulement) :
 *   roles        rôles gérés présents ; aucun SUPERUSER ni BYPASSRLS ; rôles applicatifs LOGIN ;
 *   rls          RLS ENABLE + FORCE sur toute table des schémas core, platform et app ;
 *   migrations   toutes les migrations de production du dépôt appliquées, sommes identiques ;
 *   environment  environnement DÉCLARÉ de la base (`platform.declared_environment()`, table
 *                restaurée avec elle, migration 0050), lu sous app_api = environnement attendu ;
 *   l0-05        app_api et app_worker : rôle courant de production, sans SUPERUSER ni BYPASSRLS ;
 *   audit_chain  chaîne d'audit vérifiable de bout en bout contre sa tête (travailleur
 *                `audit_chain_verifier`, rôle app_worker) ;
 *   c12          oracle de production C12 à zéro (travailleur `booking_oracle`, lecture seule) ;
 *   money        invariants d'argent : Σ jambes d'une opération = son montant ; Σ variations d'un
 *                règlement = − remboursement du voyageur ; aucun solde de jambe négatif (17,
 *                « Invariants par jambe ») ;
 *   occupancy    aucune occupation orpheline : toute occupation HOLD active a son hold vivant, tout
 *                hold vivant a son occupation active.
 *
 * Les contrôles `roles`, `rls`, `migrations`, `money` et `occupancy` lisent le catalogue et toutes
 * les lignes : ils tournent sous le rôle d'ADMINISTRATION de l'instance (celui du job de base), dans
 * une transaction en LECTURE SEULE. Les autres tournent sous les rôles de PRODUCTION.
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { AUDIT_CHAIN_SELECT, fromDbRow, verifyAuditChain } from '../audit/chain.ts';
import type { AuditChainDbRow } from '../audit/chain.ts';
import { listMigrations } from '../migrate.ts';
import { MIGRATIONS_DIR } from '../paths.ts';
import { LOGIN_ROLES, MANAGED_ROLES } from '../roles.ts';
import { setSessionContext } from '../session-context.ts';

/** Schémas de l'application (tables sous RLS ENABLE + FORCE, 17 §2.3). */
export const APP_SCHEMAS = ['core', 'platform', 'app'] as const;

export interface RestoreCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface RestoreConnections {
  /** Rôle d'administration de l'instance (lecture seule ici). */
  readonly admin: pg.ClientBase;
  readonly api: pg.ClientBase;
  readonly worker: pg.ClientBase;
}

export interface RestoreExpectations {
  /** Environnement déclaré attendu (`preproduction`, `production`). */
  readonly environment: string;
}

async function readOnly<T>(client: pg.ClientBase, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function asWorker<T>(
  client: pg.ClientBase,
  workerName: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await setSessionContext(client, { kind: 'WORKER', workerName });
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

const check = (name: string, ok: boolean, detail: string): RestoreCheck => ({ name, ok, detail });

export async function checkRoles(admin: pg.ClientBase): Promise<RestoreCheck> {
  const { rows } = await admin.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcanlogin: boolean;
  }>(
    `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_catalog.pg_roles
      WHERE rolname = ANY($1::text[]) ORDER BY rolname`,
    [[...MANAGED_ROLES]],
  );
  const found = new Map(rows.map((r) => [r.rolname, r]));
  const missing = MANAGED_ROLES.filter((r) => !found.has(r));
  const privileged = rows.filter((r) => r.rolsuper || r.rolbypassrls).map((r) => r.rolname);
  const noLogin = LOGIN_ROLES.filter((r) => found.get(r)?.rolcanlogin !== true);
  const ok = missing.length === 0 && privileged.length === 0 && noLogin.length === 0;
  return check(
    'roles',
    ok,
    ok
      ? `${rows.length} rôles gérés, aucun SUPERUSER ni BYPASSRLS`
      : `absents : ${missing.join(', ') || '—'} ; privilégiés : ${privileged.join(', ') || '—'} ; sans LOGIN : ${noLogin.join(', ') || '—'}`,
  );
}

export async function checkRls(admin: pg.ClientBase): Promise<RestoreCheck> {
  const { rows } = await admin.query<{ rel: string; enabled: boolean; forced: boolean }>(
    `SELECT n.nspname || '.' || c.relname AS rel, c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced
       FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p')
      ORDER BY 1`,
    [[...APP_SCHEMAS]],
  );
  const bad = rows.filter((r) => !r.enabled || !r.forced).map((r) => r.rel);
  return check(
    'rls',
    rows.length > 0 && bad.length === 0,
    bad.length === 0 ? `${rows.length} tables en ENABLE + FORCE` : `sans FORCE : ${bad.join(', ')}`,
  );
}

export async function checkMigrations(admin: pg.ClientBase): Promise<RestoreCheck> {
  const expected = listMigrations([MIGRATIONS_DIR]);
  const { rows } = await admin.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM platform.schema_migration ORDER BY version',
  );
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));
  const missing = expected.filter((m) => !applied.has(m.version)).map((m) => m.version);
  const altered = expected
    .filter((m) => applied.has(m.version) && applied.get(m.version) !== m.checksum)
    .map((m) => m.version);
  const last = expected.at(-1)?.version ?? '—';
  const ok = missing.length === 0 && altered.length === 0;
  return check(
    'migrations',
    ok,
    ok
      ? `${expected.length} migrations de production appliquées, dernière ${last}`
      : `absentes : ${missing.join(', ') || '—'} ; sommes différentes : ${altered.join(', ') || '—'}`,
  );
}

export async function checkProductionRoles(
  api: pg.ClientBase,
  worker: pg.ClientBase,
  expected: RestoreExpectations,
): Promise<RestoreCheck[]> {
  const who = async (client: pg.ClientBase) =>
    (
      await client.query<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>(
        `SELECT current_user, r.rolsuper, r.rolbypassrls
           FROM pg_catalog.pg_roles r WHERE r.rolname = current_user`,
      )
    ).rows[0];
  const a = await who(api);
  const w = await who(worker);
  const prod = (r: typeof a, role: string): boolean =>
    r !== undefined && r.current_user === role && !r.rolsuper && !r.rolbypassrls;
  const okRoles = prod(a, 'app_api') && prod(w, 'app_worker');
  const env = (
    await api.query<{ env: string | null }>('SELECT platform.declared_environment() AS env')
  ).rows[0]?.env;
  return [
    check(
      'l0-05',
      okRoles,
      okRoles
        ? 'app_api et app_worker : rôles de production, sans SUPERUSER ni BYPASSRLS'
        : `rôles inattendus : ${a?.current_user ?? '?'}, ${w?.current_user ?? '?'}`,
    ),
    check(
      'environment',
      env === expected.environment,
      `base « ${env ?? 'non déclarée'} », attendue « ${expected.environment} »`,
    ),
  ];
}

export async function checkAuditChain(worker: pg.ClientBase): Promise<RestoreCheck> {
  return asWorker(worker, 'audit_chain_verifier', async () => {
    const head = await worker.query<{ last_id: string; last_hash: Buffer }>(
      `SELECT last_id::text AS last_id, last_hash FROM core.audit_chain_head WHERE chain = 'audit_log'`,
    );
    const h = head.rows[0];
    if (h === undefined) return check('audit_chain', true, 'journal vide (aucune tête)');
    const { rows } = await worker.query<AuditChainDbRow>(AUDIT_CHAIN_SELECT, [h.last_id]);
    const result = verifyAuditChain(rows.map(fromDbRow), {
      lastId: h.last_id,
      lastHash: h.last_hash,
    });
    return result.ok
      ? check('audit_chain', true, `${result.count} lignes chaînées, tête ${result.lastId}`)
      : check('audit_chain', false, `rupture ${result.break.reason} à la ligne ${result.break.id}`);
  });
}

export async function checkOracleC12(worker: pg.ClientBase): Promise<RestoreCheck> {
  return asWorker(worker, 'booking_oracle', async () => {
    const { rows } = await worker.query<{ check_code: string; violations: string }>(
      'SELECT check_code, violations::text AS violations FROM core.booking_production_oracle()',
    );
    const bad = rows.filter((r) => r.violations !== '0');
    return check(
      'c12',
      rows.length > 0 && bad.length === 0,
      bad.length === 0
        ? `${rows.length} contrôles à zéro`
        : bad.map((r) => `${r.check_code} = ${r.violations}`).join(', '),
    );
  });
}

/** Invariants d'argent (17, « Invariants par jambe ») : nombre de violations par invariant. */
export const MONEY_INVARIANTS_SQL = `
  SELECT
    (SELECT count(*) FROM (
       SELECT o.id FROM core.payment_payment_operation o
         JOIN core.payment_payment_operation_leg l ON l.operation_id = o.id
        GROUP BY o.id, o.amount_minor HAVING sum(l.amount_minor) <> o.amount_minor) x
    )::text AS operation_legs_sum,
    (SELECT count(*) FROM (
       SELECT s.id FROM core.settlement_settlement s
         JOIN core.settlement_settlement_leg l ON l.settlement_id = s.id
        GROUP BY s.id, s.guest_refund_minor HAVING sum(l.variation_minor) <> -s.guest_refund_minor) x
    )::text AS settlement_variation_sum,
    (SELECT count(*) FROM core.settlement_trip_leg_balance b
      WHERE b.refunded_minor + b.released_minor + b.reallocated_out_minor
            > b.captured_minor + b.reallocated_in_minor
         OR b.captured_minor < 0 OR b.refunded_minor < 0 OR b.released_minor < 0
    )::text AS leg_balance_negative`;

export async function checkMoney(admin: pg.ClientBase): Promise<RestoreCheck> {
  const row = (await admin.query<Record<string, string>>(MONEY_INVARIANTS_SQL)).rows[0] ?? {};
  const bad = Object.entries(row).filter(([, v]) => v !== '0');
  return check(
    'money',
    bad.length === 0,
    bad.length === 0
      ? 'jambes, variations et soldes cohérents'
      : bad.map(([k, v]) => `${k} = ${v}`).join(', '),
  );
}

/** Occupations et holds : aucune occupation orpheline (17 §2.5, I-OCC). */
export const OCCUPANCY_ORPHANS_SQL = `
  SELECT
    (SELECT count(*) FROM core.booking_vehicle_occupancy o
      WHERE o.kind = 'HOLD' AND o.active
        AND NOT EXISTS (SELECT 1 FROM core.booking_checkout_hold h
                         WHERE h.occupancy_id = o.id
                           AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')))::text AS hold_occupancy_without_live_hold,
    (SELECT count(*) FROM core.booking_checkout_hold h
       JOIN core.booking_vehicle_occupancy o ON o.id = h.occupancy_id
      WHERE h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT') AND NOT o.active)::text AS live_hold_without_occupancy`;

export async function checkOccupancy(admin: pg.ClientBase): Promise<RestoreCheck> {
  const row = (await admin.query<Record<string, string>>(OCCUPANCY_ORPHANS_SQL)).rows[0] ?? {};
  const bad = Object.entries(row).filter(([, v]) => v !== '0');
  return check(
    'occupancy',
    bad.length === 0,
    bad.length === 0
      ? 'aucune occupation orpheline'
      : bad.map(([k, v]) => `${k} = ${v}`).join(', '),
  );
}

/** Tous les contrôles, dans l'ordre du rapport. */
export async function verifyRestoredDatabase(
  conn: RestoreConnections,
  expected: RestoreExpectations,
): Promise<RestoreCheck[]> {
  const catalog = await readOnly(conn.admin, async () => [
    await checkRoles(conn.admin),
    await checkRls(conn.admin),
    await checkMigrations(conn.admin),
    await checkMoney(conn.admin),
    await checkOccupancy(conn.admin),
  ]);
  return [
    ...catalog,
    ...(await checkProductionRoles(conn.api, conn.worker, expected)),
    await checkAuditChain(conn.worker),
    await checkOracleC12(conn.worker),
  ];
}

/**
 * Empreinte du CATALOGUE de sécurité (rôles gérés et leurs attributs, appartenances, politiques
 * RLS, drapeaux RLS, droits des tables et des fonctions, propriétaires, SECURITY DEFINER) : égale
 * avant sauvegarde et après restauration ⇔ rôles et RLS intacts. SHA-256 d'un texte trié. Droits
 * absents (NULL) = droits par défaut du propriétaire (`acldefault`) : une restauration LOGIQUE
 * (pg_restore, US-036) n'écrit pas une ACL égale au défaut, sans rien changer aux droits.
 */
export async function catalogFingerprint(admin: pg.ClientBase): Promise<string> {
  return createHash('sha256')
    .update((await catalogLines(admin)).join('\n'), 'utf8')
    .digest('hex');
}

/** Lignes triées de l'empreinte du catalogue (diagnostic d'un écart : US-036). */
export async function catalogLines(admin: pg.ClientBase): Promise<string[]> {
  const { rows } = await admin.query<{ line: string }>(
    `SELECT line FROM (
       SELECT 'role ' || r.rolname || ' ' || r.rolsuper::text || r.rolbypassrls::text || r.rolcanlogin::text
              || r.rolinherit::text || r.rolcreaterole::text || r.rolcreatedb::text AS line
         FROM pg_catalog.pg_roles r WHERE r.rolname = ANY($1::text[])
       UNION ALL
       SELECT 'member ' || g.rolname || ' > ' || m.rolname || ' ' || am.inherit_option::text || am.admin_option::text
         FROM pg_catalog.pg_auth_members am
         JOIN pg_catalog.pg_roles g ON g.oid = am.roleid
         JOIN pg_catalog.pg_roles m ON m.oid = am.member
        WHERE m.rolname = ANY($1::text[]) OR g.rolname = ANY($1::text[])
       UNION ALL
       SELECT 'policy ' || p.schemaname || '.' || p.tablename || ' ' || p.policyname || ' '
              || p.permissive || ' ' || p.cmd || ' ' || p.roles::text || ' '
              || coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
         FROM pg_catalog.pg_policies p WHERE p.schemaname = ANY($2::text[])
       UNION ALL
       SELECT 'rel ' || n.nspname || '.' || c.relname || ' ' || c.relkind::text || ' '
              || c.relrowsecurity::text || c.relforcerowsecurity::text || ' '
              || pg_catalog.pg_get_userbyid(c.relowner) || ' ' || coalesce(c.relacl, pg_catalog.acldefault(CASE c.relkind WHEN 'S' THEN 's' ELSE 'r' END::"char", c.relowner))::text
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($2::text[]) AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
       UNION ALL
       SELECT 'fn ' || p.oid::regprocedure::text || ' ' || pg_catalog.pg_get_userbyid(p.proowner)
              || ' ' || p.prosecdef::text || ' ' || coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))::text || ' '
              || coalesce(p.proconfig::text, '') || ' ' || md5(p.prosrc)
         FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY($2::text[])
     ) x ORDER BY line`,
    [[...MANAGED_ROLES], [...APP_SCHEMAS]],
  );
  return rows.map((r) => r.line);
}

export interface DataFingerprint {
  /** Lignes par table des schémas de l'application (`schéma.table` → nombre). */
  readonly rows: Readonly<Record<string, number>>;
  /** Sommes d'argent par devise (unités mineures, texte : bigint sans perte). */
  readonly money: Readonly<Record<string, string>>;
  /** Tête de la chaîne d'audit (id et hachage hexadécimal), ou `null`. */
  readonly auditHead: { readonly lastId: string; readonly lastHash: string } | null;
}

/** Empreinte des DONNÉES (comptes, sommes d'argent, tête d'audit), sous l'administration. */
export async function dataFingerprint(admin: pg.ClientBase): Promise<DataFingerprint> {
  return readOnly(admin, async () => {
    const tables = await admin.query<{ rel: string }>(
      `SELECT pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname) AS rel
         FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p') ORDER BY 1`,
      [[...APP_SCHEMAS]],
    );
    const rows: Record<string, number> = {};
    for (const { rel } of tables.rows) {
      // identifiants issus du catalogue et cités par quote_ident : aucune donnée externe
      const r = await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${rel}`);
      rows[rel.replace(/"/g, '')] = Number(r.rows[0]?.n ?? '0');
    }
    const sums = await admin.query<{ k: string; v: string }>(
      `SELECT 'payment_operation.' || currency AS k, sum(amount_minor)::text AS v
         FROM core.payment_payment_operation GROUP BY currency
       UNION ALL
       SELECT 'payment_operation_leg.' || o.currency, sum(l.amount_minor)::text
         FROM core.payment_payment_operation_leg l
         JOIN core.payment_payment_operation o ON o.id = l.operation_id GROUP BY o.currency
       UNION ALL
       SELECT 'settlement.guest_refund.' || currency, sum(guest_refund_minor)::text
         FROM core.settlement_settlement GROUP BY currency
       UNION ALL
       SELECT 'trip_leg_balance.captured.' || currency, sum(captured_minor)::text
         FROM core.settlement_trip_leg_balance GROUP BY currency
       ORDER BY 1`,
    );
    const head = await admin.query<{ last_id: string; last_hash: Buffer }>(
      `SELECT last_id::text AS last_id, last_hash FROM core.audit_chain_head WHERE chain = 'audit_log'`,
    );
    const h = head.rows[0];
    return {
      rows,
      money: Object.fromEntries(sums.rows.map((r) => [r.k, r.v])),
      auditHead:
        h === undefined ? null : { lastId: h.last_id, lastHash: h.last_hash.toString('hex') },
    };
  });
}
