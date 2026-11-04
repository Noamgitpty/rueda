/**
 * Document du schéma GÉNÉRÉ depuis la vraie base (US-038, ADR-079) : `docs/architecture/schema.md`.
 *
 * `introspectSchema` lit le catalogue PostgreSQL (`pg_catalog`, lisible par tout rôle) d'une base
 * migrée par les migrations de PRODUCTION ; `renderSchemaDocument` en fait un Markdown
 * déterministe (aucun OID, aucun nom de base, tri par nom). Le test d'intégration
 * `test/int/schema-doc.test.ts` le compare au fichier commité sous `app_api` : un écart fait
 * échouer `pnpm test:int` (donc la CI). Contenu : historique des migrations, rôles et
 * appartenances, schémas, tables (RLS ENABLE / FORCE, droits par rôle, colonnes, contraintes,
 * index, politiques, déclencheurs), vues, fonctions `SECURITY DEFINER` (propriétaire,
 * `search_path`, droit EXECUTE) et autres fonctions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { MIGRATIONS_DIR } from './paths.ts';
import { MANAGED_ROLES } from './roles.ts';

/** Schémas documentés (ceux que créent les migrations). */
export const DOCUMENTED_SCHEMAS = ['app', 'core', 'platform'] as const;

export interface RoleRow {
  readonly name: string;
  readonly login: boolean;
  readonly superuser: boolean;
  readonly bypassrls: boolean;
  readonly inherit: boolean;
  readonly memberOf: string;
}
export interface SchemaRow {
  readonly name: string;
  readonly owner: string;
  readonly usage: string;
}
export interface TableRow {
  readonly schema: string;
  readonly name: string;
  readonly kind: 'table' | 'partitioned table' | 'view' | 'materialized view';
  readonly owner: string;
  readonly rls: boolean;
  readonly forceRls: boolean;
  readonly grants: string;
}
export interface ColumnRow {
  readonly table: string;
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly defaultExpr: string | null;
}
export interface DefinitionRow {
  readonly table: string;
  readonly name: string;
  readonly definition: string;
}
export interface PolicyRow {
  readonly table: string;
  readonly name: string;
  readonly command: string;
  readonly permissive: boolean;
  readonly roles: string;
  readonly using: string | null;
  readonly withCheck: string | null;
}
export interface FunctionRow {
  readonly schema: string;
  readonly signature: string;
  readonly result: string;
  readonly securityDefiner: boolean;
  readonly owner: string;
  readonly config: string;
  readonly execute: string;
}
export interface MigrationRow {
  readonly id: string;
  readonly summary: string;
}

export interface SchemaSnapshot {
  readonly migrations: readonly MigrationRow[];
  readonly roles: readonly RoleRow[];
  readonly schemas: readonly SchemaRow[];
  readonly tables: readonly TableRow[];
  readonly columns: readonly ColumnRow[];
  readonly constraints: readonly DefinitionRow[];
  readonly indexes: readonly DefinitionRow[];
  readonly triggers: readonly DefinitionRow[];
  readonly policies: readonly PolicyRow[];
  readonly functions: readonly FunctionRow[];
}

// ---- Introspection --------------------------------------------------------------------------

/** Droits d'un ACL agrégés par bénéficiaire : `app_api: SELECT, INSERT ; PUBLIC: …`. */
const ACL = (acl: string) => `
  COALESCE((
    SELECT string_agg(g.grantee || ': ' || g.privs, ' ; ' ORDER BY g.grantee)
      FROM (
        SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END AS grantee,
               string_agg(a.privilege_type, ', ' ORDER BY a.privilege_type) AS privs
          FROM pg_catalog.aclexplode(${acl}) a
         GROUP BY 1
      ) g
  ), '')`;

const NS = `n.nspname = ANY($1::text[])`;
/** Objets d'une extension (btree_gist…) exclus. */
const NOT_EXTENSION = (catalog: string, oid: string) => `NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_depend d
   WHERE d.classid = '${catalog}'::regclass AND d.objid = ${oid} AND d.deptype = 'e')`;

export const SCHEMA_SQL = {
  roles: `
    SELECT r.rolname AS name, r.rolcanlogin AS login, r.rolsuper AS superuser,
           r.rolbypassrls AS bypassrls, r.rolinherit AS inherit,
           COALESCE((
             SELECT string_agg(g.rolname || CASE WHEN m.inherit_option THEN '' ELSE ' (NOINHERIT)' END
                                 || CASE WHEN m.set_option THEN '' ELSE ' (NOSET)' END,
                               ', ' ORDER BY g.rolname)
               FROM pg_catalog.pg_auth_members m
               JOIN pg_catalog.pg_roles g ON g.oid = m.roleid
              WHERE m.member = r.oid), '') AS "memberOf"
      FROM pg_catalog.pg_roles r
     WHERE r.rolname = ANY($1::text[])
     ORDER BY r.rolname`,
  schemas: `
    SELECT n.nspname AS name, pg_catalog.pg_get_userbyid(n.nspowner) AS owner,
           ${ACL('n.nspacl')} AS usage
      FROM pg_catalog.pg_namespace n
     WHERE ${NS}
     ORDER BY n.nspname`,
  tables: `
    SELECT n.nspname AS schema, c.relname AS name,
           CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table'
                          WHEN 'v' THEN 'view' ELSE 'materialized view' END AS kind,
           pg_catalog.pg_get_userbyid(c.relowner) AS owner,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS "forceRls",
           ${ACL('c.relacl')} AS grants
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE ${NS} AND c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition
       AND ${NOT_EXTENSION('pg_class', 'c.oid')}
     ORDER BY n.nspname, c.relname`,
  columns: `
    SELECT n.nspname || '.' || c.relname AS "table", a.attname AS name,
           pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS "notNull",
           pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS "defaultExpr"
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
     WHERE ${NS} AND c.relkind IN ('r', 'p', 'v', 'm') AND NOT c.relispartition
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY 1, a.attnum`,
  constraints: `
    SELECT n.nspname || '.' || c.relname AS "table", k.conname AS name,
           pg_catalog.pg_get_constraintdef(k.oid, true) AS definition
      FROM pg_catalog.pg_constraint k
      JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE ${NS} AND NOT c.relispartition
     ORDER BY 1, 2`,
  indexes: `
    SELECT n.nspname || '.' || t.relname AS "table", i.relname AS name,
           pg_catalog.pg_get_indexdef(i.oid) AS definition
      FROM pg_catalog.pg_index x
      JOIN pg_catalog.pg_class i ON i.oid = x.indexrelid
      JOIN pg_catalog.pg_class t ON t.oid = x.indrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
     WHERE ${NS} AND NOT t.relispartition
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conindid = i.oid
                          AND k.contype IN ('p', 'u', 'x'))
     ORDER BY 1, 2`,
  triggers: `
    SELECT n.nspname || '.' || c.relname AS "table", g.tgname AS name,
           pg_catalog.pg_get_triggerdef(g.oid, true) AS definition
      FROM pg_catalog.pg_trigger g
      JOIN pg_catalog.pg_class c ON c.oid = g.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE ${NS} AND NOT g.tgisinternal
     ORDER BY 1, 2`,
  policies: `
    SELECT n.nspname || '.' || c.relname AS "table", p.polname AS name,
           CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE'
                         WHEN 'd' THEN 'DELETE' ELSE 'ALL' END AS command,
           p.polpermissive AS permissive,
           CASE WHEN p.polroles = '{0}' THEN 'PUBLIC' ELSE (
             SELECT string_agg(pg_catalog.pg_get_userbyid(r), ', ' ORDER BY pg_catalog.pg_get_userbyid(r))
               FROM unnest(p.polroles) AS r) END AS roles,
           pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS "using",
           pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS "withCheck"
      FROM pg_catalog.pg_policy p
      JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE ${NS}
     ORDER BY 1, 2`,
  functions: `
    SELECT n.nspname AS schema,
           p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' AS signature,
           pg_catalog.pg_get_function_result(p.oid) AS result,
           p.prosecdef AS "securityDefiner",
           pg_catalog.pg_get_userbyid(p.proowner) AS owner,
           COALESCE(array_to_string(p.proconfig, ' ; '), '') AS config,
           ${ACL("COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))")} AS execute
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE ${NS} AND ${NOT_EXTENSION('pg_proc', 'p.oid')}
     ORDER BY 1, 2`,
} as const;

/** Première ligne de commentaire d'une migration, sans le numéro (« 0003 — … »). */
export function migrationSummary(sql: string): string {
  const first = sql.split('\n').find((l) => l.startsWith('--')) ?? '';
  return first
    .replace(/^--\s*/, '')
    .replace(/^\d{4}\s*[—–-]\s*/, '')
    .trim();
}

/**
 * Lit le schéma d'une base (rôle quelconque : le catalogue est lisible par tous). `applied` :
 * migrations appliquées (`NNNN_nom`), résumées par la première ligne de leur fichier.
 */
export async function introspectSchema(
  client: pg.ClientBase,
  applied: readonly string[],
): Promise<SchemaSnapshot> {
  const schemas = [...DOCUMENTED_SCHEMAS];
  const q = async <R extends pg.QueryResultRow>(sql: string, param: readonly string[]) =>
    (await client.query<R>(sql, [param])).rows;
  return {
    migrations: applied.map((id) => ({
      id,
      summary: migrationSummary(readFileSync(join(MIGRATIONS_DIR, `${id}.sql`), 'utf8')),
    })),
    roles: await q<RoleRow>(SCHEMA_SQL.roles, MANAGED_ROLES),
    schemas: await q<SchemaRow>(SCHEMA_SQL.schemas, schemas),
    tables: await q<TableRow>(SCHEMA_SQL.tables, schemas),
    columns: await q<ColumnRow>(SCHEMA_SQL.columns, schemas),
    constraints: await q<DefinitionRow>(SCHEMA_SQL.constraints, schemas),
    indexes: await q<DefinitionRow>(SCHEMA_SQL.indexes, schemas),
    triggers: await q<DefinitionRow>(SCHEMA_SQL.triggers, schemas),
    policies: await q<PolicyRow>(SCHEMA_SQL.policies, schemas),
    functions: await q<FunctionRow>(SCHEMA_SQL.functions, schemas),
  };
}

// ---- Rendu ---------------------------------------------------------------------------------

export const SCHEMA_DOC_PATH = 'docs/architecture/schema.md';
export const SCHEMA_DOC_COMMAND =
  'job CI « base de données » (test:int, schema-doc) : copier le document imprimé, ou RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/db test:int sur un banc local';

const cell = (text: string): string =>
  text.replaceAll('|', '\\|').replaceAll('\n', ' ').replace(/\s+/g, ' ').trim();
const code = (text: string): string => `\`${cell(text).replaceAll('`', "'")}\``;
const yes = (b: boolean): string => (b ? 'oui' : 'non');

function byTable<T extends { readonly table: string }>(rows: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.table, [...(m.get(r.table) ?? []), r]);
  return m;
}

export function renderSchemaDocument(s: SchemaSnapshot): string {
  const out: string[] = [
    '<!-- Fichier GÉNÉRÉ depuis une base PostgreSQL 16 migrée par les migrations de production (US-038, ADR-079) : ne pas modifier à la main. -->',
    `<!-- Régénérer : ${SCHEMA_DOC_COMMAND}. La CI échoue si ce fichier n'est plus à jour. -->`,
    '',
    '# Schéma de la base (production)',
    '',
    "Lu dans le catalogue (`pg_catalog`) d'une base jetable du banc, après les seules migrations de `packages/db/migrations/` (sans les migrations de test), sous le rôle `app_api`. Fait foi pour l'état réel ; la cible est 17 §3 (écarts : `docs/team/PROPOSITIONS.md`).",
    '',
  ];
  const tables = s.tables.filter((t) => t.kind === 'table' || t.kind === 'partitioned table');
  const views = s.tables.filter((t) => t.kind === 'view' || t.kind === 'materialized view');
  const definers = s.functions.filter((f) => f.securityDefiner);
  const noForce = tables.filter((t) => !t.rls || !t.forceRls).map((t) => `${t.schema}.${t.name}`);
  out.push(
    '## Synthèse',
    '',
    `- ${s.migrations.length} migrations ; ${tables.length} tables ; ${views.length} vues ; ${s.policies.length} politiques RLS ; ${definers.length} fonctions \`SECURITY DEFINER\` ; ${s.functions.length - definers.length} autres fonctions.`,
    `- Tables sans RLS \`ENABLE\` + \`FORCE\` : ${noForce.length === 0 ? 'aucune' : noForce.map((t) => `\`${t}\``).join(', ')}.`,
    `- Rôles applicatifs avec \`SUPERUSER\` ou \`BYPASSRLS\` : ${
      s.roles
        .filter((r) => r.superuser || r.bypassrls)
        .map((r) => `\`${r.name}\``)
        .join(', ') || 'aucun'
    }.`,
    '',
    '## Historique des migrations',
    '',
    '| Migration | Objet |',
    '| --------- | ----- |',
    ...s.migrations.map((m) => `| \`${m.id}\` | ${cell(m.summary)} |`),
    '',
    '## Rôles',
    '',
    '| Rôle | LOGIN | SUPERUSER | BYPASSRLS | INHERIT | Membre de |',
    '| ---- | ----- | --------- | --------- | ------- | --------- |',
    ...s.roles.map(
      (r) =>
        `| \`${r.name}\` | ${yes(r.login)} | ${yes(r.superuser)} | ${yes(r.bypassrls)} | ${yes(r.inherit)} | ${cell(r.memberOf) || '—'} |`,
    ),
    '',
    '## Schémas',
    '',
    '| Schéma | Propriétaire | Droits |',
    '| ------ | ------------ | ------ |',
    ...s.schemas.map((n) => `| \`${n.name}\` | \`${n.owner}\` | ${cell(n.usage) || '—'} |`),
    '',
    '## Tables',
    '',
  );
  const columns = byTable(s.columns);
  const constraints = byTable(s.constraints);
  const indexes = byTable(s.indexes);
  const policies = byTable(s.policies);
  const triggers = byTable(s.triggers);
  for (const t of tables) {
    const id = `${t.schema}.${t.name}`;
    out.push(
      `### \`${id}\``,
      '',
      `- RLS : ${t.rls ? 'ENABLE' : '**désactivée**'}${t.forceRls ? ' + FORCE' : ' (**sans FORCE**)'} ; propriétaire \`${t.owner}\``,
      `- Droits : ${cell(t.grants) || 'aucun'}`,
      '',
      '| Colonne | Type | NOT NULL | Défaut |',
      '| ------- | ---- | -------- | ------ |',
      ...(columns.get(id) ?? []).map(
        (c) =>
          `| \`${c.name}\` | \`${cell(c.type)}\` | ${yes(c.notNull)} | ${c.defaultExpr === null ? '—' : code(c.defaultExpr)} |`,
      ),
      '',
    );
    const cons = constraints.get(id) ?? [];
    if (cons.length > 0) {
      out.push(
        'Contraintes :',
        '',
        ...cons.map((k) => `- \`${k.name}\` : ${code(k.definition)}`),
        '',
      );
    }
    const idx = indexes.get(id) ?? [];
    if (idx.length > 0) {
      out.push('Index :', '', ...idx.map((k) => `- \`${k.name}\` : ${code(k.definition)}`), '');
    }
    const pols = policies.get(id) ?? [];
    if (pols.length > 0) {
      out.push(
        'Politiques RLS :',
        '',
        ...pols.map(
          (p) =>
            `- \`${p.name}\` (${p.command}, ${p.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'}, ${cell(p.roles)})` +
            `${p.using === null ? '' : ` USING ${code(p.using)}`}${p.withCheck === null ? '' : ` WITH CHECK ${code(p.withCheck)}`}`,
        ),
        '',
      );
    }
    const trg = triggers.get(id) ?? [];
    if (trg.length > 0) {
      out.push(
        'Déclencheurs :',
        '',
        ...trg.map((k) => `- \`${k.name}\` : ${code(k.definition)}`),
        '',
      );
    }
  }
  out.push('## Vues', '');
  if (views.length === 0) out.push('Aucune.', '');
  for (const v of views) {
    const id = `${v.schema}.${v.name}`;
    out.push(
      `### \`${id}\``,
      '',
      `- ${v.kind} ; propriétaire \`${v.owner}\` ; droits : ${cell(v.grants) || 'aucun'}`,
      `- Colonnes : ${(columns.get(id) ?? []).map((c) => `\`${c.name}\` ${cell(c.type)}`).join(', ')}`,
      '',
    );
  }
  out.push(
    '## Fonctions `SECURITY DEFINER`',
    '',
    'Chacune a un propriétaire `NOLOGIN` dédié (ADR-053) et un `search_path` figé ; EXECUTE accordé nommément (jamais PUBLIC). Liste blanche : `packages/db/security-definer-allowlist.json`.',
    '',
    '| Fonction | Résultat | Propriétaire | Configuration | EXECUTE |',
    '| -------- | -------- | ------------ | ------------- | ------- |',
    ...definers.map(
      (f) =>
        `| ${code(`${f.schema}.${f.signature}`)} | ${code(f.result)} | \`${f.owner}\` | ${cell(f.config) || '—'} | ${cell(f.execute) || '—'} |`,
    ),
    '',
    '## Autres fonctions',
    '',
    '| Fonction | Résultat | Propriétaire | EXECUTE |',
    '| -------- | -------- | ------------ | ------- |',
    ...s.functions
      .filter((f) => !f.securityDefiner)
      .map(
        (f) =>
          `| ${code(`${f.schema}.${f.signature}`)} | ${code(f.result)} | \`${f.owner}\` | ${cell(f.execute) || '—'} |`,
      ),
    '',
  );
  return out.join('\n');
}
