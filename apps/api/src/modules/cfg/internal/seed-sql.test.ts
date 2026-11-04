/**
 * US-013 — la migration de graines 0009 est générée depuis les données (source unique). Pour la
 * régénérer après une modification des données (avant toute application en environnement
 * partagé : une migration appliquée est immuable, ADR-044) :
 *   RUEDA_WRITE_CFG_SEED=1 pnpm --filter @rueda/api test:unit
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadRepositoryConfig } from './load.js';
import { NAME_LANGUAGES } from './model.js';
import {
  POST_SEED_LANGUAGES,
  POST_SEED_PARAMS,
  renderLanguageSeedSql,
  renderParamSeedSql,
  renderSeedSql,
  SEED_MIGRATION_FILE,
} from './seed-sql.js';

const migrationUrl = (file: string): URL =>
  new URL(`../../../../../../packages/db/migrations/${file}`, import.meta.url);
const seedUrl = migrationUrl(SEED_MIGRATION_FILE);
const config = loadRepositoryConfig();
const rendered = renderSeedSql(config);

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

  it('0009 reste rendue sans les langues ajoutées après elle (immuable, ADR-044)', () => {
    const countryLine = rendered.split('\n').filter((l) => l.startsWith("  ('P"));
    expect(countryLine.length).toBeGreaterThan(0);
    for (const { language } of POST_SEED_LANGUAGES) {
      expect(rendered).not.toContain(`"${language}":`);
      expect(rendered).not.toMatch(new RegExp(`ARRAY\\[[^\\]]*'${language}'`));
    }
  });

  it('toute langue de nom de pays est dans 0009 ou dans une graine complémentaire', () => {
    const seeded = new Set(['es', 'en', 'fr']);
    for (const lang of NAME_LANGUAGES) {
      expect(seeded.has(lang) || POST_SEED_LANGUAGES.some((l) => l.language === lang)).toBe(true);
    }
  });

  it.each(POST_SEED_LANGUAGES)(
    'graine complémentaire $file identique au rendu des données (langue $language)',
    ({ language, file }) => {
      const delta = renderLanguageSeedSql(config, language);
      if (process.env['RUEDA_WRITE_CFG_SEED'] === '1')
        writeFileSync(migrationUrl(file), delta, 'utf8');
      expect(readFileSync(migrationUrl(file), 'utf8').replaceAll('\r\n', '\n')).toBe(delta);
      for (const c of config.countries.values()) {
        expect(delta).toContain(`WHERE code = '${c.code}';`);
        expect(delta).toContain(`"${language}":`);
      }
      // la garde de 0008 est rétablie après les mises à jour
      expect(delta.indexOf('ENABLE TRIGGER config_country_guard')).toBeGreaterThan(
        delta.lastIndexOf('UPDATE core.config_country'),
      );
    },
  );

  it('0009 reste rendue sans les paramètres ajoutés après elle (immuable, ADR-044, ADR-075)', () => {
    for (const { prefix } of POST_SEED_PARAMS) expect(rendered).not.toContain(`'${prefix}`);
  });

  it.each(POST_SEED_PARAMS)(
    'graine complémentaire $file identique au rendu des paramètres $prefix*',
    ({ prefix, file }) => {
      const delta = renderParamSeedSql(config, prefix);
      if (process.env['RUEDA_WRITE_CFG_SEED'] === '1')
        writeFileSync(migrationUrl(file), delta, 'utf8');
      expect(readFileSync(migrationUrl(file), 'utf8').replaceAll('\r\n', '\n')).toBe(delta);
      const keys = [...config.definitions.keys()].filter((k) => k.startsWith(prefix));
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(delta).toContain(`('${key}', '`);
        for (const c of config.countries.values())
          expect(delta).toContain(`('${key}', '${c.code}'`);
      }
      // aucun autre paramètre, aucun valid_from écrit
      expect(delta).not.toMatch(/valid_from,|currency, value/);
    },
  );

  it('apostrophes des textes doublées (littéraux SQL)', () => {
    // params.json : status « contrat d'assureur (à fixer) … ».
    expect(rendered).toContain("'contrat d''assureur (à fixer)");
    expect(rendered).not.toContain("d'assureur");
  });
});
