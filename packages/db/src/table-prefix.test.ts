/**
 * US-038 — incohérence relevée par US-035 : chaque table de la Bêta (`core.<schéma cible>_<entité>`,
 * D1, `betaTableName`) porte en préfixe le schéma cible d'un module de `MODULE_SCHEMAS`. Une table
 * hors convention fait échouer la CI, sauf écart TRACÉ ci-dessous (docs/team/PROPOSITIONS.md).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULE_SCHEMAS } from '../schemas.ts';
import { MIGRATIONS_DIR } from './paths.ts';

/** Écarts tracés : table → raison et suite. */
const TRACED: Readonly<Record<string, string>> = {
  ntf_notification_dispatch:
    'préfixe `ntf_` au lieu de `notification_` (0030, US-018) : renommage par une migration de la prochaine story NTF (PROP-038-03)',
};

function coreTables(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?core\.([a-z0-9_]+)/gi)) {
      names.add((m[1] as string).toLowerCase());
    }
  }
  return [...names].sort();
}

describe('préfixe des tables de la Bêta = schéma cible d’un module', () => {
  const schemas = Object.values(MODULE_SCHEMAS).map((s) => s.schema);

  it('toute table core.* commence par « <schéma cible>_ », écarts tracés exceptés', () => {
    const tables = coreTables();
    expect(tables.length).toBeGreaterThan(20);
    const off = tables.filter(
      (t) => !schemas.some((s) => t.startsWith(`${s}_`)) && TRACED[t] === undefined,
    );
    expect(off).toEqual([]);
  });

  it('chaque écart tracé existe encore (sinon le retirer de la liste)', () => {
    const tables = coreTables();
    expect(Object.keys(TRACED).filter((t) => !tables.includes(t))).toEqual([]);
  });
});
