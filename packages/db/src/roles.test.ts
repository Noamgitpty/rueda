/**
 * Cohérence de la liste des rôles entre TypeScript et l'amorçage SQL (US-011, ADR-053) : un
 * propriétaire ajouté d'un seul côté ne serait ni créé ni accordé à migrator, ou ne serait pas
 * inventorié par L0-05.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_DIR } from './paths.ts';
import { LOGIN_ROLES, OWNER_ROLES } from './roles.ts';

const sql = readFileSync(join(BOOTSTRAP_DIR, '0000_instance_roles.sql'), 'utf8');

describe('rôles gérés', () => {
  it('v_owners de l’amorçage = OWNER_ROLES', () => {
    const m = /v_owners text\[\] := ARRAY\[([^\]]+)\]/.exec(sql);
    expect(m).not.toBeNull();
    const fromSql = [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(fromSql).toEqual([...OWNER_ROLES]);
  });

  it('chaque rôle est créé par la boucle de l’amorçage, LOGIN ou NOLOGIN comme attendu', () => {
    const created = [...sql.matchAll(/\('([a-z_]+)',\s+(true|false)\)/g)].map((x) => [x[1], x[2]]);
    expect(Object.fromEntries(created)).toEqual({
      ...Object.fromEntries(LOGIN_ROLES.map((r) => [r, 'true'])),
      ...Object.fromEntries(OWNER_ROLES.map((r) => [r, 'false'])),
    });
  });
});
