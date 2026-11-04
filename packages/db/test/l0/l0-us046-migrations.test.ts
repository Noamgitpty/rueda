/**
 * US-046 — tests des migrations (19 §1.8 « migrations : montée et descente sur les graines PA et
 * PY ; migration de données sous FORCE (RLS-19) » ; 17 §11 L0-05, RLS-19 ; ADR-078 point 6 ;
 * ADR-081).
 *
 * Sur une base vierge du banc (`migrationDatabase`, amorcée sans migration), sous `migrator` (seul
 * rôle des migrations, jamais SUPERUSER ni BYPASSRLS ; RLS FORCÉE sur toutes les tables) :
 * 1. chaque migration de production s'applique SEULE, dans l'ordre, de zéro ;
 * 2. les graines réalistes PA et PY (support/migration-seeds.ts) sont posées dès que leurs tables
 *    existent : chaque migration suivante s'applique donc sur une base PEUPLÉE ;
 * 3. « descente » = retour arrière d'US-003 SANS migration descendante (expand / contract) : après
 *    chaque migration, tout ce que la version précédente utilisait existe encore à l'identique
 *    (tables, vues, colonnes et leurs types, nullabilité, fonctions, droits des rôles
 *    applicatifs), sauf contraction déclarée et justifiée dans expand-contract-allowlist.json ;
 * 4. comptes de lignes et contenu des lignes existantes égaux avant / après chaque migration (seule
 *    une migration qui déclare un INSERT ajoute des lignes ; seule une migration de données
 *    déclarée réécrit des lignes) ; contrôles d'intégrité (contraintes validées, FK sans orpheline, RLS ENABLE +
 *    FORCE, lecture de `migrator`) tenus après chaque migration, chaîne d'audit valide à la fin ;
 * 5. RLS-19 : `migrator` voit exactement les lignes posées (aucune ligne cachée par la RLS forcée) ;
 * 6. idempotence (second passage vide) et refus de rejouer : migration appliquée modifiée, absente
 *    ou renommée refusée par l'exécuteur ; migration rejouée sous un numéro neuf refusée par la base
 *    et annulée en entier, sur cette même base.
 * La numérotation contiguë est prouvée par numbering.test.ts (US-008) ; la règle statique par le
 * lint sql-expand-contract.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { topLevelStatements } from '../../src/expand-contract/scan.ts';
import { AUDIT_CHAIN_SELECT, fromDbRow, verifyAuditChain } from '../../src/audit/index.ts';
import type { AuditChainDbRow } from '../../src/audit/index.ts';
import { listMigrations, runMigrations } from '../../src/migrate.ts';
import { MIGRATIONS_DIR, PACKAGE_ROOT } from '../../src/paths.ts';
import { benchInfo, connectMigratorForMigrationTest, withRole } from '../../src/testing/index.ts';
import { MIGRATION_SEEDS } from '../support/migration-seeds.ts';

const SCHEMAS = ['core', 'platform', 'app'];
const APP_ROLES = ['app_api', 'app_worker', 'app_anon'];

interface AllowEntry {
  readonly path: string;
  readonly line: number;
  readonly kind: string;
  readonly populated?: boolean;
  readonly dataTables?: readonly string[];
}
const ALLOWLIST = (
  JSON.parse(readFileSync(join(PACKAGE_ROOT, 'expand-contract-allowlist.json'), 'utf8')) as {
    entries: AllowEntry[];
  }
).entries;
const allowFor = (version: string): AllowEntry[] =>
  ALLOWLIST.filter((e) => e.path.split('/').at(-1)?.startsWith(`${version}_`) === true);

interface Column {
  readonly type: string;
  readonly notnull: boolean;
}
interface Relation {
  readonly kind: string;
  readonly columns: Map<string, Column>;
}
interface Catalog {
  readonly relations: Map<string, Relation>;
  readonly functions: Set<string>;
  readonly privileges: Set<string>;
}

async function readCatalog(c: pg.ClientBase): Promise<Catalog> {
  const relations = new Map<string, Relation>();
  const cols = await c.query<{
    rel: string;
    kind: string;
    col: string;
    type: string;
    notnull: boolean;
  }>(
    `SELECT n.nspname || '.' || cl.relname AS rel, cl.relkind::text AS kind, a.attname AS col,
            pg_catalog.format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull
       FROM pg_catalog.pg_class cl
       JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
       JOIN pg_catalog.pg_attribute a ON a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = ANY($1) AND cl.relkind IN ('r', 'p', 'v', 'm')
      ORDER BY 1, a.attnum`,
    [SCHEMAS],
  );
  for (const r of cols.rows) {
    const rel = relations.get(r.rel) ?? { kind: r.kind, columns: new Map<string, Column>() };
    rel.columns.set(r.col, { type: r.type, notnull: r.notnull });
    relations.set(r.rel, rel);
  }
  const fns = await c.query<{ sig: string }>(
    `SELECT p.oid::regprocedure::text AS sig
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ANY($1)`,
    [SCHEMAS],
  );
  const privs = await c.query<{ p: string }>(
    `SELECT r.rolname || ' ' || a.privilege_type || ' ' || n.nspname || '.' || cl.relname AS p
       FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
       CROSS JOIN LATERAL pg_catalog.aclexplode(cl.relacl) a
       JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = ANY($1) AND r.rolname = ANY($2)
     UNION ALL
     SELECT r.rolname || ' ' || a.privilege_type || ' ' || n.nspname || '.' || cl.relname || '.' || att.attname
       FROM pg_catalog.pg_attribute att
       JOIN pg_catalog.pg_class cl ON cl.oid = att.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
       CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
       JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = ANY($1) AND r.rolname = ANY($2) AND att.attnum > 0 AND NOT att.attisdropped
     UNION ALL
     SELECT r.rolname || ' ' || a.privilege_type || ' ' || p.oid::regprocedure::text
       FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
       JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = ANY($1) AND r.rolname = ANY($2)
     UNION ALL
     SELECT r.rolname || ' ' || a.privilege_type || ' schema ' || n.nspname
       FROM pg_catalog.pg_namespace n
       CROSS JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a
       JOIN pg_catalog.pg_roles r ON r.oid = a.grantee
      WHERE n.nspname = ANY($1) AND r.rolname = ANY($2)`,
    [SCHEMAS, APP_ROLES],
  );
  return {
    relations,
    functions: new Set(fns.rows.map((r) => r.sig)),
    privileges: new Set(privs.rows.map((r) => r.p)),
  };
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const q = (ident: string): string => {
  if (!IDENT.test(ident)) throw new Error(`identifiant inattendu : ${ident}`);
  return `"${ident}"`;
};
const qrel = (rel: string): string => rel.split('.').map(q).join('.');

/** Empreinte de chaque ligne, sur les colonnes données (multiensemble trié). */
async function rowHashes(
  c: pg.ClientBase,
  rel: string,
  columns: readonly string[],
): Promise<string[]> {
  const { rows } = await c.query<{ h: string }>(
    `SELECT pg_catalog.md5(ROW(${columns.map(q).join(', ')})::text) AS h FROM ${qrel(rel)}`,
  );
  return rows.map((r) => r.h).sort();
}

type Data = Map<string, { columns: string[]; hashes: string[] }>;

async function readData(c: pg.ClientBase, catalog: Catalog): Promise<Data> {
  const data: Data = new Map();
  for (const [rel, r] of catalog.relations) {
    if (r.kind !== 'r' && r.kind !== 'p') continue;
    const columns = [...r.columns.keys()];
    data.set(rel, { columns, hashes: await rowHashes(c, rel, columns) });
  }
  return data;
}

/** Contrôles d'intégrité : contraintes validées, FK sans orpheline, RLS ENABLE + FORCE, lecture de migrator. */
async function integrity(c: pg.ClientBase): Promise<string[]> {
  const problems: string[] = [];
  const cons = await c.query<{
    rel: string;
    name: string;
    contype: string;
    validated: boolean;
    cols: string[];
    frel: string | null;
    fcols: string[] | null;
  }>(
    `SELECT n.nspname || '.' || cl.relname AS rel, co.conname AS name, co.contype::text AS contype,
            co.convalidated AS validated,
            ARRAY(SELECT a.attname::text FROM unnest(co.conkey) WITH ORDINALITY k(n, o)
                    JOIN pg_catalog.pg_attribute a ON a.attrelid = co.conrelid AND a.attnum = k.n ORDER BY k.o) AS cols,
            CASE WHEN co.contype = 'f' THEN fn.nspname || '.' || fcl.relname END AS frel,
            CASE WHEN co.contype = 'f' THEN ARRAY(SELECT a.attname::text FROM unnest(co.confkey) WITH ORDINALITY k(n, o)
                    JOIN pg_catalog.pg_attribute a ON a.attrelid = co.confrelid AND a.attnum = k.n ORDER BY k.o) END AS fcols
       FROM pg_catalog.pg_constraint co
       JOIN pg_catalog.pg_class cl ON cl.oid = co.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
       LEFT JOIN pg_catalog.pg_class fcl ON fcl.oid = co.confrelid
       LEFT JOIN pg_catalog.pg_namespace fn ON fn.oid = fcl.relnamespace
      WHERE n.nspname = ANY($1) AND co.contype IN ('c', 'f')`,
    [SCHEMAS],
  );
  for (const k of cons.rows) {
    // CHECK : PostgreSQL le vérifie sur les lignes existantes quand il est ajouté, sauf NOT VALID ;
    // une contrainte (CHECK ou FK) laissée NOT VALID sur une base peuplée est un défaut d'intégrité
    if (!k.validated) {
      problems.push(`${k.rel} : contrainte ${k.name} NOT VALID (lignes existantes non contrôlées)`);
      continue;
    }
    if (k.contype === 'c') continue;
    // clé étrangère : aucune orpheline (triggers de FK désactivés ou réplication contournés)
    const fcols = k.fcols ?? [];
    const notNull = k.cols.map((col) => `t.${q(col)} IS NOT NULL`).join(' AND ');
    const match = k.cols.map((col, i) => `f.${q(fcols[i] as string)} = t.${q(col)}`).join(' AND ');
    const sql = `SELECT count(*)::int AS n FROM ${qrel(k.rel)} t WHERE ${notNull}
               AND NOT EXISTS (SELECT 1 FROM ${qrel(k.frel as string)} f WHERE ${match})`;
    const { rows } = await c.query<{ n: number }>(sql);
    if ((rows[0]?.n ?? 0) > 0) problems.push(`${k.rel} : ${rows[0]?.n} ligne(s) violent ${k.name}`);
  }
  const rls = await c.query<{
    rel: string;
    enabled: boolean;
    forced: boolean;
    migrator_reads: boolean;
  }>(
    `SELECT n.nspname || '.' || cl.relname AS rel, cl.relrowsecurity AS enabled,
            cl.relforcerowsecurity AS forced,
            EXISTS (SELECT 1 FROM pg_catalog.pg_policy p
                     WHERE p.polrelid = cl.oid AND p.polpermissive AND p.polcmd IN ('r', '*')
                       AND (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'migrator') = ANY (p.polroles)
                       AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true') AS migrator_reads
       FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
      WHERE n.nspname = ANY($1) AND cl.relkind IN ('r', 'p')`,
    [SCHEMAS],
  );
  for (const r of rls.rows) {
    if (!r.enabled || !r.forced) problems.push(`${r.rel} : RLS non ENABLE + FORCE`);
    if (!r.migrator_reads)
      problems.push(`${r.rel} : aucune politique de lecture complète de migrator (RLS-19, B9)`);
  }
  return problems;
}

/** Tables cibles d'un INSERT de premier niveau dans la migration (graines de référence). */
function insertedTables(sql: string): Set<string> {
  const out = new Set<string>();
  for (const st of topLevelStatements(sql)) {
    // instruction de premier niveau ou du corps d'un bloc DO (mots-clés PL/pgSQL en tête retirés)
    const text = st.text
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^((begin|declare|then|else|loop)\b ?)+/i, '');
    const m = /^insert into ([a-z_]+\.[a-z_0-9]+)/i.exec(text);
    if (m) out.add((m[1] as string).toLowerCase());
  }
  return out;
}

/** Écarts de la version N (avant) à la version N + 1 (après) qui casseraient le retour arrière. */
function contractions(before: Catalog, after: Catalog): Array<{ kind: string[]; what: string }> {
  const out: Array<{ kind: string[]; what: string }> = [];
  for (const [rel, r] of before.relations) {
    const a = after.relations.get(rel);
    if (!a) {
      out.push({ kind: ['drop-object', 'rename'], what: `relation ${rel} supprimée` });
      continue;
    }
    for (const [col, def] of r.columns) {
      const ac = a.columns.get(col);
      if (!ac)
        out.push({
          kind: ['drop-column', 'rename', 'drop-object'],
          what: `colonne ${rel}.${col} supprimée`,
        });
      else {
        if (ac.type !== def.type)
          out.push({
            kind: ['alter-column-type'],
            what: `type de ${rel}.${col} : ${def.type} → ${ac.type}`,
          });
        if (r.kind !== 'v' && !def.notnull && ac.notnull)
          out.push({ kind: ['set-not-null'], what: `${rel}.${col} rendue NOT NULL` });
      }
    }
  }
  for (const f of before.functions) {
    if (!after.functions.has(f))
      out.push({ kind: ['drop-function', 'rename'], what: `fonction ${f} supprimée` });
  }
  for (const p of before.privileges) {
    if (!after.privileges.has(p)) {
      out.push({
        kind: ['revoke-app-role', 'drop-function', 'drop-object', 'drop-column'],
        what: `droit retiré : ${p}`,
      });
    }
  }
  return out;
}

const multisetMinus = (a: readonly string[], b: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  for (const h of b) counts.set(h, (counts.get(h) ?? 0) + 1);
  const missing: string[] = [];
  for (const h of a) {
    const n = counts.get(h) ?? 0;
    if (n > 0) counts.set(h, n - 1);
    else missing.push(h);
  }
  return missing;
};

async function count(c: pg.ClientBase, rel: string): Promise<number> {
  const { rows } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${qrel(rel)}`);
  return rows[0]?.n ?? 0;
}

describe('US-046 — migrations de zéro, une par une, sur base peuplée PA et PY (RLS-19, expand / contract)', () => {
  it('chaque migration s’applique seule, garde le schéma de la version N et ne perd ni n’altère aucune ligne', async () => {
    // L0-05 : la base des migrations n'expose aucun rôle applicatif privilégié
    await withRole('app_api', async () => undefined, { database: 'migrations' });
    const migrator = await connectMigratorForMigrationTest();
    const problems: string[] = [];
    const seeded = new Set<string>();
    const migrations = listMigrations([MIGRATIONS_DIR]);
    try {
      expect(migrations.length).toBeGreaterThan(50);
      // les graines visent des migrations qui existent, et pas avant une migration qui exige
      // des tables vides (dérogation populated: false)
      for (const seed of MIGRATION_SEEDS) {
        expect(migrations.some((m) => m.version === seed.after)).toBe(true);
      }
      // de zéro : aucune migration n'a encore été appliquée sur cette base
      const fresh = await migrator.query<{ present: boolean }>(
        `SELECT pg_catalog.to_regclass('platform.schema_migration') IS NOT NULL AS present`,
      );
      expect(fresh.rows[0]?.present).toBe(false);
      let before = await readCatalog(migrator);
      let beforeData = await readData(migrator, before);
      for (const m of migrations) {
        const applied = await runMigrations(migrator, [MIGRATIONS_DIR], { through: m.version });
        expect(applied.map((a) => a.version)).toEqual([m.version]);
        const after = await readCatalog(migrator);
        const allow = allowFor(m.version);
        const allowedKinds = new Set(allow.map((e) => e.kind));
        // descente : la version N fonctionne-t-elle encore sur ce schéma ?
        for (const c of contractions(before, after)) {
          if (!c.kind.some((k) => allowedKinds.has(k))) {
            problems.push(`${m.version}_${m.name} : ${c.what} (contraction sans dérogation)`);
          }
        }
        // données : comptes et lignes existantes inchangés
        const inserted = insertedTables(m.sql);
        const rewritten = new Set(allow.flatMap((e) => e.dataTables ?? []));
        for (const [rel, prev] of beforeData) {
          // journal de l'exécuteur : une ligne par migration, écrite par runMigrations
          if (rel === 'platform.schema_migration') continue;
          const rel2 = after.relations.get(rel);
          if (!rel2) continue; // signalé ci-dessus
          const cols = prev.columns.filter((col) => rel2.columns.has(col));
          const now = await rowHashes(migrator, rel, cols);
          if (now.length < prev.hashes.length) {
            problems.push(
              `${m.version}_${m.name} : ${rel} perd ${prev.hashes.length - now.length} ligne(s)`,
            );
          } else if (now.length > prev.hashes.length && !inserted.has(rel)) {
            problems.push(`${m.version}_${m.name} : ${rel} gagne des lignes sans INSERT déclaré`);
          }
          if (rewritten.has(rel)) {
            if (now.length !== prev.hashes.length) {
              problems.push(
                `${m.version}_${m.name} : migration de données sur ${rel} sans comptes égaux`,
              );
            }
          } else if (cols.length === prev.columns.length) {
            const lost = multisetMinus(prev.hashes, now);
            if (lost.length > 0) {
              problems.push(
                `${m.version}_${m.name} : ${lost.length} ligne(s) de ${rel} modifiée(s) ou perdue(s)`,
              );
            }
          }
        }
        for (const p of await integrity(migrator)) problems.push(`${m.version}_${m.name} : ${p}`);

        // graines posées juste après cette migration (base peuplée pour les suivantes)
        for (const seed of MIGRATION_SEEDS.filter((s) => s.after === m.version)) {
          const counts = new Map<string, number>();
          for (const rel of Object.keys(seed.rows)) counts.set(rel, await count(migrator, rel));
          await migrator.query('BEGIN');
          try {
            for (const sql of seed.sql) await migrator.query(sql);
            await migrator.query('COMMIT');
          } catch (error) {
            await migrator.query('ROLLBACK');
            throw new Error(
              `graines « ${seed.id} » refusées après ${m.version} : ${String(error)}`,
              {
                cause: error,
              },
            );
          }
          // RLS-19 : sous RLS forcée, migrator voit exactement les lignes posées
          for (const [rel, n] of Object.entries(seed.rows)) {
            expect(await count(migrator, rel), `${seed.id} : ${rel}`).toBe(
              (counts.get(rel) ?? 0) + n,
            );
            seeded.add(rel);
          }
          for (const p of await integrity(migrator)) problems.push(`graines ${seed.id} : ${p}`);
        }
        before = after;
        beforeData = await readData(migrator, after);
      }
      expect(problems).toEqual([]);

      // base peuplée de bout en bout : toutes les graines sont là, la chaîne d'audit est valide
      expect([...seeded].sort()).toEqual(
        [...new Set(MIGRATION_SEEDS.flatMap((s) => Object.keys(s.rows)))].sort(),
      );
      const head = await migrator.query<{ last_id: string; last_hash: Buffer }>(
        `SELECT last_id::text AS last_id, last_hash FROM core.audit_chain_head WHERE chain = 'audit_log'`,
      );
      const h = head.rows[0];
      if (!h) throw new Error('tête de chaîne absente');
      const chain = await migrator.query<AuditChainDbRow>(AUDIT_CHAIN_SELECT, [h.last_id]);
      expect(chain.rows.length).toBeGreaterThan(0);
      expect(
        verifyAuditChain(chain.rows.map(fromDbRow), { lastId: h.last_id, lastHash: h.last_hash }),
      ).toMatchObject({ ok: true });

      // idempotence : un second passage n'applique rien
      expect(await runMigrations(migrator, [MIGRATIONS_DIR])).toEqual([]);
      const applied = await migrator.query<{ version: string }>(
        'SELECT version FROM platform.schema_migration ORDER BY version',
      );
      expect(applied.rows.map((r) => r.version)).toEqual(migrations.map((x) => x.version));
    } finally {
      await migrator.end();
    }
  }, 900_000);

  it('refus de rejouer : migration appliquée modifiée, absente, renommée ou rejouée sous un autre numéro', async () => {
    await withRole('app_api', async () => undefined, { database: 'migrations' });
    const migrator = await connectMigratorForMigrationTest();
    const dir = mkdtempSync(join(tmpdir(), 'rueda-us046-'));
    try {
      const files = listMigrations([MIGRATIONS_DIR]);
      // la base des migrations est entièrement migrée par le test précédent (même fichier)
      const { rows } = await migrator.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM platform.schema_migration',
      );
      expect(rows[0]?.n).toBe(files.length);
      for (const f of files) copyFileSync(f.path, join(dir, `${f.version}_${f.name}.sql`));
      const last = files.at(-1);
      const first = files[0];
      if (!last || !first) throw new Error('migrations attendues');
      // 1. une migration appliquée modifiée (somme SHA-256) : refusée, rien n'est appliqué
      writeFileSync(join(dir, `${last.version}_${last.name}.sql`), `${last.sql}\n-- modifiée\n`);
      await expect(runMigrations(migrator, [dir])).rejects.toThrow(
        /modifiée depuis son application/,
      );
      copyFileSync(last.path, join(dir, `${last.version}_${last.name}.sql`));
      // 2. une migration appliquée absente des fichiers : refusée
      rmSync(join(dir, `${first.version}_${first.name}.sql`));
      await expect(runMigrations(migrator, [dir])).rejects.toThrow(/absente des fichiers/);
      copyFileSync(first.path, join(dir, `${first.version}_${first.name}.sql`));
      // 3. rejouer une migration appliquée sous un numéro neuf : la base la refuse (objets déjà
      //    présents) et la transaction est annulée en entier (rien d'inscrit, rien de créé)
      const replayed = [...files].reverse().find((f) => /^\s*CREATE TABLE/im.test(f.sql));
      if (!replayed) throw new Error('migration créant une table attendue');
      const next = String(Number(last.version) + 1).padStart(4, '0');
      writeFileSync(join(dir, `${next}_rejouee.sql`), replayed.sql);
      await expect(runMigrations(migrator, [dir])).rejects.toThrow(
        /échec de la migration .*_rejouee/,
      );
      rmSync(join(dir, `${next}_rejouee.sql`));
      // 4. une migration appliquée renommée (même numéro, autre nom) : refusée, le nom et la somme
      //    font foi (une migration plus ancienne que la dernière appliquée : migrate.test.ts)
      rmSync(join(dir, `${last.version}_${last.name}.sql`));
      writeFileSync(join(dir, `${last.version}_autre_nom.sql`), last.sql);
      await expect(runMigrations(migrator, [dir])).rejects.toThrow(
        /modifiée depuis son application/,
      );
      // la base n'a pas bougé
      const after = await migrator.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM platform.schema_migration',
      );
      expect(after.rows[0]?.n).toBe(files.length);
      expect(benchInfo().migrationDatabase).toMatch(/_mig$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      await migrator.end();
    }
  });
});
