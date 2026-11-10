/**
 * US-049 (F-RLS-04) : la liste de l'amorçage SQL est exactement `SIDE_EFFECT_FUNCTIONS`, et les
 * verrous consultatifs utilisés par l'application n'y sont pas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SIDE_EFFECT_FUNCTIONS } from './catalog-functions.ts';
import { BOOTSTRAP_DIR } from './paths.ts';

describe('fonctions de pg_catalog retirées à PUBLIC (amorçage § 3)', () => {
  it('l’amorçage retire exactement la liste partagée', () => {
    const sql = readFileSync(join(BOOTSTRAP_DIR, '0000_instance_roles.sql'), 'utf8');
    const m = /p\.proname IN \(([^)]*)\)/.exec(sql);
    expect(m).not.toBeNull();
    const names = [...(m?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(names).toEqual([...SIDE_EFFECT_FUNCTIONS].sort());
  });

  it('les verrous consultatifs et set_config restent exécutables (utilisés par l’application)', () => {
    for (const name of ['pg_advisory_xact_lock', 'pg_advisory_lock', 'set_config']) {
      expect(SIDE_EFFECT_FUNCTIONS as readonly string[]).not.toContain(name);
    }
  });
});
