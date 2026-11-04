/**
 * Rendu du document du schéma (US-038) sur un instantané fabriqué ici : déterministe, échappement
 * des cellules, synthèse RLS et rôles honnête (une table sans FORCE, un rôle BYPASSRLS se voient).
 */
import { describe, expect, it } from 'vitest';
import { migrationSummary, renderSchemaDocument } from './schema-doc.ts';
import type { SchemaSnapshot } from './schema-doc.ts';

const SNAPSHOT: SchemaSnapshot = {
  migrations: [{ id: '0001_role_grants', summary: 'droits | des rôles' }],
  roles: [
    {
      name: 'app_api',
      login: true,
      superuser: false,
      bypassrls: false,
      inherit: true,
      memberOf: '',
    },
  ],
  schemas: [{ name: 'core', owner: 'migrator', usage: 'app_api: USAGE' }],
  tables: [
    {
      schema: 'core',
      name: 'demo',
      kind: 'table',
      owner: 'migrator',
      rls: true,
      forceRls: true,
      grants: 'app_api: INSERT, SELECT',
    },
  ],
  columns: [
    { table: 'core.demo', name: 'id', type: 'uuid', notNull: true, defaultExpr: null },
    {
      table: 'core.demo',
      name: 'label',
      type: 'text',
      notNull: false,
      defaultExpr: "'a|b'::text",
    },
  ],
  constraints: [{ table: 'core.demo', name: 'demo_pkey', definition: 'PRIMARY KEY (id)' }],
  indexes: [],
  triggers: [],
  policies: [
    {
      table: 'core.demo',
      name: 'demo_read',
      command: 'SELECT',
      permissive: true,
      roles: 'app_api',
      using: 'true',
      withCheck: null,
    },
  ],
  functions: [
    {
      schema: 'core',
      signature: 'cmd_demo(p uuid)',
      result: 'void',
      securityDefiner: true,
      owner: 'guard_owner',
      config: 'search_path=pg_catalog, core',
      execute: 'app_api: EXECUTE ; guard_owner: EXECUTE',
    },
  ],
};

describe('rendu du document du schéma', () => {
  it('déterministe, cellules échappées, sections attendues', () => {
    const doc = renderSchemaDocument(SNAPSHOT);
    expect(renderSchemaDocument(SNAPSHOT)).toBe(doc);
    expect(doc).toContain('| `0001_role_grants` | droits \\| des rôles |');
    expect(doc).toContain('### `core.demo`');
    expect(doc).toContain('- RLS : ENABLE + FORCE ; propriétaire `migrator`');
    expect(doc).toContain("| `label` | `text` | non | `'a\\|b'::text` |");
    expect(doc).toContain('- `demo_read` (SELECT, PERMISSIVE, app_api) USING `true`');
    expect(doc).toContain('Tables sans RLS `ENABLE` + `FORCE` : aucune.');
    expect(doc).toContain('| `core.cmd_demo(p uuid)` | `void` | `guard_owner` |');
  });

  it('une table sans FORCE et un rôle BYPASSRLS apparaissent dans la synthèse', () => {
    const doc = renderSchemaDocument({
      ...SNAPSHOT,
      tables: [{ ...(SNAPSHOT.tables[0] as SchemaSnapshot['tables'][number]), forceRls: false }],
      roles: [{ ...(SNAPSHOT.roles[0] as SchemaSnapshot['roles'][number]), bypassrls: true }],
    });
    expect(doc).toContain('Tables sans RLS `ENABLE` + `FORCE` : `core.demo`.');
    expect(doc).toContain('`SUPERUSER` ou `BYPASSRLS` : `app_api`.');
    expect(doc).toContain('(**sans FORCE**)');
  });

  it('résumé de migration : première ligne de commentaire, sans le numéro', () => {
    expect(migrationSummary('-- 0003 — schéma unique `core`\n-- suite\nSELECT 1;')).toBe(
      'schéma unique `core`',
    );
    expect(migrationSummary('SELECT 1;')).toBe('');
  });
});
