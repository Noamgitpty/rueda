/**
 * US-013 — la migration de graines 0003 est générée depuis les données (source unique). Pour la
 * régénérer après une modification des données (avant toute application en environnement
 * partagé : une migration appliquée est immuable, ADR-044) :
 *   RUEDA_WRITE_CFG_SEED=1 pnpm --filter @rueda/api test:unit
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadRepositoryConfig } from './load.js';
import { renderSeedSql, SEED_MIGRATION_FILE } from './seed-sql.js';

const seedUrl = new URL(
  `../../../../../../packages/db/migrations/${SEED_MIGRATION_FILE}`,
  import.meta.url,
);
const rendered = renderSeedSql(loadRepositoryConfig());

describe('migration de graines', () => {
  if (process.env['RUEDA_WRITE_CFG_SEED'] === '1') writeFileSync(seedUrl, rendered, 'utf8');

  it(`${SEED_MIGRATION_FILE} est identique au rendu des données`, () => {
    expect(readFileSync(seedUrl, 'utf8').replaceAll('\r\n', '\n')).toBe(rendered);
  });

  it('aucun valid_from écrit (la garde de la base pose platform.now())', () => {
    const inserts = rendered.split('\n').filter((l) => l.startsWith('INSERT INTO'));
    expect(inserts.length).toBeGreaterThan(0);
    for (const line of inserts) expect(line).not.toMatch(/valid_from|currency, value/);
  });

  it('interrupteurs graines à false, jamais true', () => {
    for (const key of [
      'p2p_private_hosts_enabled',
      'insurer_contract_active',
      'funds_holding_enabled',
      'payouts_enabled',
    ]) {
      const lines = rendered.split('\n').filter((l) => l.includes(`('${key}', 'P`));
      expect(lines).toHaveLength(2);
      for (const line of lines) expect(line).toContain(`'false'::jsonb`);
    }
  });

  it('apostrophes des textes doublées (littéraux SQL)', () => {
    // params.json : status « contrat d'assureur (à fixer) … ».
    expect(rendered).toContain("'contrat d''assureur (à fixer)");
    expect(rendered).not.toContain("d'assureur");
  });
});
