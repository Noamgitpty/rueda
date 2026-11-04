/**
 * US-046 (ADR-081 ; ADR-078 point 6) : la règle expand / contract est IMPOSÉE par `pnpm lint:sql`.
 * Toute contraction de premier niveau d'une migration de production (suppression, renommage,
 * changement de type, SET NOT NULL, colonne NOT NULL sans défaut, retrait d'un droit d'un rôle
 * applicatif, TRUNCATE, DELETE, UPDATE) échoue, sauf dérogation nominative et justifiée.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lintExpandContract } from './lint-tree.ts';
import { scanExpandContract } from './scan.ts';
import { CONTRACT_KINDS } from './scan.ts';
import type { ContractKind } from './scan.ts';
import { PACKAGE_ROOT } from '../paths.ts';

const repoRoot = join(PACKAGE_ROOT, '..', '..');

const cli = join(PACKAGE_ROOT, 'src', 'expand-contract', 'cli.ts');
const kinds = (sql: string): ContractKind[] => scanExpandContract(sql).map((f) => f.kind);

describe('scanExpandContract : contractions refusées', () => {
  it.each<[string, ContractKind]>([
    ['DROP TABLE core.booking_trip;', 'drop-object'],
    ['DROP VIEW IF EXISTS core.booking_host_guest_v;', 'drop-object'],
    ['drop schema legacy cascade;', 'drop-object'],
    ['DROP TYPE core.trip_status;', 'drop-object'],
    ['DROP SEQUENCE core.s;', 'drop-object'],
    ['DROP FUNCTION core.f(uuid);', 'drop-function'],
    ['DROP PROCEDURE core.p();', 'drop-function'],
    ['ALTER TABLE core.t DROP COLUMN email;', 'drop-column'],
    ['ALTER TABLE core.t DROP email;', 'drop-column'],
    ['ALTER TABLE core.t ADD COLUMN a int, DROP COLUMN IF EXISTS b;', 'drop-column'],
    ['ALTER TABLE core.t RENAME COLUMN a TO b;', 'rename'],
    ['ALTER TABLE core.t RENAME TO u;', 'rename'],
    ['ALTER TABLE core.t RENAME CONSTRAINT c1 TO c2;', 'rename'],
    ['ALTER FUNCTION core.f(uuid) RENAME TO g;', 'rename'],
    ['ALTER INDEX core.i RENAME TO j;', 'rename'],
    ['ALTER TABLE core.t ALTER COLUMN amount TYPE numeric;', 'alter-column-type'],
    [
      'ALTER TABLE core.t ALTER amount SET DATA TYPE bigint USING amount::bigint;',
      'alter-column-type',
    ],
    ['ALTER TABLE core.t ALTER COLUMN a SET NOT NULL;', 'set-not-null'],
    ['ALTER TABLE core.t ADD COLUMN org_id uuid NOT NULL;', 'add-column-not-null-without-default'],
    [
      'ALTER TABLE core.t ADD org_id uuid NOT NULL REFERENCES core.o (id);',
      'add-column-not-null-without-default',
    ],
    ['REVOKE SELECT ON core.t FROM app_api;', 'revoke-app-role'],
    ['REVOKE SELECT (guest_user_id) ON core.t FROM app_worker, migrator;', 'revoke-app-role'],
    ['REVOKE EXECUTE ON FUNCTION core.f() FROM app_anon;', 'revoke-app-role'],
    ['TRUNCATE core.t;', 'truncate'],
    ['DELETE FROM core.t WHERE true;', 'data-delete'],
    ['WITH x AS (SELECT 1) DELETE FROM core.t;', 'data-delete'],
    ["UPDATE core.t SET a = 'b';", 'data-update'],
    ['DO $$ BEGIN UPDATE core.t SET a = 1; END $$;', 'data-update'],
    // natures ajoutées après la revue (code, constat 2)
    ['DROP POLICY p ON core.t;', 'drop-policy'],
    ['DROP POLICY IF EXISTS p ON core.t;', 'drop-policy'],
    ['ALTER TABLE core.t DROP CONSTRAINT c;', 'drop-constraint'],
    ['DROP TRIGGER tr ON core.t;', 'drop-trigger'],
    ['DROP INDEX core.i;', 'drop-index'],
    ['DROP INDEX CONCURRENTLY IF EXISTS core.i;', 'drop-index'],
    ['ALTER TABLE core.t ALTER COLUMN a DROP DEFAULT;', 'drop-default'],
    ['ALTER TABLE core.t ALTER COLUMN id DROP IDENTITY;', 'drop-default'],
    ['ALTER TABLE core.t SET SCHEMA archive;', 'set-schema'],
    ['ALTER FUNCTION core.f() SET SCHEMA archive;', 'set-schema'],
    ['ALTER TABLE core.t NO FORCE ROW LEVEL SECURITY;', 'disable-rls'],
    ['ALTER TABLE core.t DISABLE ROW LEVEL SECURITY;', 'disable-rls'],
    ['ALTER TABLE core.t DISABLE TRIGGER tr;', 'disable-trigger'],
    ['ALTER ROLE app_api SET search_path = public;', 'role-change'],
    ['DROP OWNED BY app_worker;', 'role-change'],
    ['REASSIGN OWNED BY app_api TO migrator;', 'role-change'],
    ['DROP EXTENSION btree_gist;', 'drop-object'],
    ['DROP DOMAIN core.d;', 'drop-object'],
    // contournements du lint (revue code, constats 1 et 3) : structure de contrôle et SQL dynamique
    [
      'DO $do$ BEGIN IF true THEN ALTER TABLE core.t DROP COLUMN a; END IF; END $do$;',
      'drop-column',
    ],
    [
      'DO $do$ BEGIN IF EXISTS (SELECT 1 FROM core.t) THEN NULL; ELSE DROP TABLE core.t; END IF; END $do$;',
      'drop-object',
    ],
    ['DO $$ BEGIN LOOP DELETE FROM core.t; EXIT; END LOOP; END $$;', 'data-delete'],
    ['DO $$ BEGIN IF x THEN UPDATE core.t SET a = 1; END IF; END $$;', 'data-update'],
    ['DO $$ BEGIN IF x THEN DROP POLICY p ON core.t; END IF; END $$;', 'drop-policy'],
    [
      'DO $$ BEGIN IF x THEN ALTER TABLE core.t NO FORCE ROW LEVEL SECURITY; END IF; END $$;',
      'disable-rls',
    ],
    [
      'DO $$ BEGIN IF x THEN REVOKE SELECT ON core.t FROM app_api; END IF; END $$;',
      'revoke-app-role',
    ],
    ["DO $$ BEGIN EXECUTE 'ALTER TABLE core.t DROP COLUMN a'; END $$;", 'dynamic-sql'],
    ["DO $$ BEGIN IF x THEN EXECUTE format('DROP TABLE %I', 't'); END IF; END $$;", 'dynamic-sql'],
    ["DO $$ DECLARE t text; BEGIN EXECUTE format('x'); END $$;", 'dynamic-sql'],
    [
      'CREATE FUNCTION core.f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN IF true THEN ALTER TABLE core.t DROP COLUMN a; END IF; END $fn$;',
      'drop-column',
    ],
    [
      "CREATE OR REPLACE FUNCTION core.f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN EXECUTE 'TRUNCATE core.t'; END $fn$;",
      'dynamic-sql',
    ],
    [
      'CREATE PROCEDURE core.p() LANGUAGE plpgsql AS $p$ BEGIN DROP TRIGGER tr ON core.t; END $p$;',
      'drop-trigger',
    ],
  ])('%s → %s', (sql, kind) => {
    expect(kinds(sql)).toContain(kind);
  });
});

describe('scanExpandContract : extensions admises', () => {
  it.each([
    ['CREATE TABLE core.t (id uuid PRIMARY KEY, a text NOT NULL);'],
    ["ALTER TABLE core.t ADD COLUMN a text NOT NULL DEFAULT 'x';"],
    ['ALTER TABLE core.t ADD COLUMN a text;'],
    ['ALTER TABLE core.t ADD COLUMN h uuid GENERATED ALWAYS AS (id) STORED NOT NULL;'],
    ['ALTER TABLE core.t ADD CONSTRAINT c CHECK (a IS NOT NULL);'],
    ['ALTER TABLE core.t ALTER COLUMN a DROP NOT NULL;'],
    // remplacement sous le même nom dans la même migration
    ['DROP POLICY p ON core.t;\nCREATE POLICY p ON core.t FOR SELECT TO app_api USING (true);'],
    [
      'DROP TRIGGER tr ON core.t;\nCREATE TRIGGER tr BEFORE UPDATE ON core.t FOR EACH ROW EXECUTE FUNCTION f();',
    ],
    ['ALTER TABLE core.t DROP CONSTRAINT c;\nALTER TABLE core.t ADD CONSTRAINT c CHECK (a > 0);'],
    ['DROP INDEX core.i;\nCREATE UNIQUE INDEX i ON core.t (a);'],
    // PL/pgSQL : verrou, ON CONFLICT, droit EXECUTE, RAISE ; métier d'une fonction (plus bas)
    ['DO $$ BEGIN PERFORM 1 FROM core.t FOR UPDATE; END $$;'],
    ['DO $$ BEGIN INSERT INTO core.t VALUES (1) ON CONFLICT (a) DO UPDATE SET b = 1; END $$;'],
    ['DO $$ BEGIN GRANT EXECUTE ON FUNCTION core.f() TO app_api; END $$;'],
    ["DO $$ BEGIN IF x THEN RAISE EXCEPTION 'refus'; END IF; END $$;"],
    ['REVOKE ALL ON core.t FROM PUBLIC;'],
    ['REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;'],
    ["INSERT INTO core.t (a) VALUES ('DROP TABLE core.x');"],
    ['-- DROP TABLE core.t;\nSELECT 1;'],
    ['/* ALTER TABLE core.t DROP COLUMN a; */ SELECT 1;'],
    [
      'CREATE FUNCTION core.f() RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN DELETE FROM core.t; UPDATE core.t SET a = 1; END $fn$;',
    ],
    ["COMMENT ON TABLE core.t IS 'pas de DROP COLUMN ici';"],
    ['ALTER TABLE core.t ENABLE ROW LEVEL SECURITY;'],
    ['ALTER TABLE core.t FORCE ROW LEVEL SECURITY;'],
    ['ALTER TABLE core.t ENABLE TRIGGER tr;'],
    ['CREATE TRIGGER tr BEFORE UPDATE OR DELETE ON core.t FOR EACH ROW EXECUTE FUNCTION core.g();'],
  ])('%s', (sql) => {
    expect(kinds(sql)).toEqual([]);
  });

  it('numérote la ligne du début de l’instruction', () => {
    const sql =
      'CREATE TABLE core.t (a int);\n\n-- commentaire\nALTER TABLE core.t\n  DROP COLUMN a;\n';
    expect(scanExpandContract(sql)).toMatchObject([{ kind: 'drop-column', line: 4 }]);
  });
});

describe('scanExpandContract : un contre-exemple par nature (mutation du lint)', () => {
  // chaque nature de CONTRACT_KINDS a au moins un contre-exemple refusé, dont la forme IF … THEN
  const SAMPLE: Record<ContractKind, string> = {
    'drop-object': 'DROP VIEW core.v',
    'drop-function': 'DROP FUNCTION core.f()',
    'drop-column': 'ALTER TABLE core.t DROP COLUMN a',
    'drop-policy': 'DROP POLICY p ON core.t',
    'drop-constraint': 'ALTER TABLE core.t DROP CONSTRAINT c',
    'drop-trigger': 'DROP TRIGGER tr ON core.t',
    'drop-index': 'DROP INDEX core.i',
    'drop-default': 'ALTER TABLE core.t ALTER COLUMN a DROP DEFAULT',
    rename: 'ALTER TABLE core.t RENAME COLUMN a TO b',
    'set-schema': 'ALTER TABLE core.t SET SCHEMA x',
    'alter-column-type': 'ALTER TABLE core.t ALTER COLUMN a TYPE text',
    'set-not-null': 'ALTER TABLE core.t ALTER COLUMN a SET NOT NULL',
    'add-column-not-null-without-default': 'ALTER TABLE core.t ADD COLUMN b int NOT NULL',
    'revoke-app-role': 'REVOKE SELECT ON core.t FROM app_api',
    'disable-rls': 'ALTER TABLE core.t NO FORCE ROW LEVEL SECURITY',
    'disable-trigger': 'ALTER TABLE core.t DISABLE TRIGGER tr',
    'role-change': 'ALTER ROLE app_api NOBYPASSRLS',
    'dynamic-sql': "EXECUTE 'SELECT 1'",
    truncate: 'TRUNCATE core.t',
    'data-delete': 'DELETE FROM core.t',
    'data-update': 'UPDATE core.t SET a = 1',
  };

  it('chaque nature est couverte', () => {
    expect(Object.keys(SAMPLE).sort()).toEqual([...CONTRACT_KINDS].sort());
  });

  it.each([...CONTRACT_KINDS])('%s : premier niveau et bloc DO derrière IF … THEN', (kind) => {
    const sql = SAMPLE[kind];
    expect(kinds(`${sql};`)).toContain(kind);
    expect(kinds(`DO $do$ BEGIN IF true THEN ${sql}; END IF; END $do$;`)).toContain(kind);
    expect(kinds(`DO $do$ BEGIN IF a THEN NULL; ELSIF b THEN ${sql}; END IF; END $do$;`)).toContain(
      kind,
    );
  });
});

describe('lintExpandContract (arborescence + dérogations)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  const tree = (files: Record<string, string>, allowlist?: unknown): string => {
    dir = mkdtempSync(join(tmpdir(), 'rueda-expand-contract-'));
    const migrations = join(dir, 'packages', 'db', 'migrations');
    mkdirSync(migrations, { recursive: true });
    for (const [name, sql] of Object.entries(files)) writeFileSync(join(migrations, name), sql);
    if (allowlist !== undefined) {
      writeFileSync(
        join(dir, 'packages', 'db', 'expand-contract-allowlist.json'),
        JSON.stringify(allowlist),
      );
    }
    return dir;
  };
  const JUST = 'justification suffisamment longue pour une dérogation nominative';

  it('les migrations du dépôt sont conformes (dérogations comprises)', () => {
    const result = lintExpandContract(repoRoot);
    expect(result.allowlistErrors).toEqual([]);
    expect(result.findings).toEqual([]);
    expect(result.filesScanned).toBeGreaterThan(50);
  });

  it('une contraction sans dérogation échoue ; avec dérogation exacte, elle passe', () => {
    const root = tree({ '0001_x.sql': 'SELECT 1;\nALTER TABLE core.t DROP COLUMN a;\n' });
    expect(lintExpandContract(root).findings).toMatchObject([
      { file: 'packages/db/migrations/0001_x.sql', line: 2, kind: 'drop-column' },
    ]);
    rmSync(root, { recursive: true, force: true });
    const ok = tree(
      { '0001_x.sql': 'SELECT 1;\nALTER TABLE core.t DROP COLUMN a;\n' },
      {
        entries: [
          {
            path: 'packages/db/migrations/0001_x.sql',
            line: 2,
            kind: 'drop-column',
            justification: JUST,
          },
        ],
      },
    );
    expect(lintExpandContract(ok)).toMatchObject({ findings: [], allowlistErrors: [] });
  });

  it('dérogation périmée, de mauvaise nature, sans justification ou données sans tables : erreurs', () => {
    const root = tree(
      { '0001_x.sql': 'UPDATE core.t SET a = 1;\n' },
      {
        entries: [
          {
            path: 'packages/db/migrations/0001_x.sql',
            line: 1,
            kind: 'drop-column',
            justification: JUST,
          },
          {
            path: 'packages/db/migrations/0001_x.sql',
            line: 1,
            kind: 'data-update',
            justification: JUST,
          },
          {
            path: 'packages/db/migrations/0001_x.sql',
            line: 1,
            kind: 'rename',
            justification: 'court',
          },
        ],
      },
    );
    const result = lintExpandContract(root);
    expect(result.findings).toMatchObject([{ kind: 'data-update', line: 1 }]);
    expect(result.allowlistErrors).toEqual([
      'dérogation 1 (packages/db/migrations/0001_x.sql:1) : migration de données sans dataTables',
      'dérogation 2 (packages/db/migrations/0001_x.sql:1) : justification manquante ou trop courte',
      'packages/db/migrations/0001_x.sql:1 (drop-column) : aucune contraction à tolérer ici',
    ]);
  });

  it('la CLI échoue (code 1) sur une contraction et nomme le fichier et la ligne', () => {
    const root = tree({ '0001_x.sql': 'ALTER TABLE core.t RENAME COLUMN a TO b;\n' });
    let output = '';
    let status = 0;
    try {
      execFileSync(process.execPath, [cli, '--root', root], { encoding: 'utf8', stdio: 'pipe' });
    } catch (error) {
      const e = error as { status: number; stderr: string };
      status = e.status;
      output = e.stderr;
    }
    expect(status).toBe(1);
    expect(output).toContain('packages/db/migrations/0001_x.sql:1');
    expect(output).toContain('rename');
  });
});
