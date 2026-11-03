import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MODULE_CODES,
  MODULES,
  SOCLE_MODULES,
  allowedDependencies,
  findCycle,
  moduleDir,
  toModuleBoundariesOptions,
} from './dependency-graph.js';
import type { ModuleCode } from './dependency-graph.js';

const modulesRoot = dirname(fileURLToPath(import.meta.url));

describe('graphe des dépendances entre modules (17 §2.2)', () => {
  it('est acyclique, socle implicite compris', () => {
    expect(findCycle()).toBeNull();
  });

  it('détecte un cycle quand on en introduit un', () => {
    const withCycle = (code: ModuleCode): readonly ModuleCode[] =>
      code === 'CFG' ? ['AVL'] : allowedDependencies(code);
    expect(findCycle(withCycle)).not.toBeNull();
  });

  it('BUS ne dépend de personne ; CFG et AUD ne dépendent que de BUS (outbox)', () => {
    expect(allowedDependencies('BUS')).toEqual([]);
    expect(allowedDependencies('CFG')).toEqual(['BUS']);
    expect(allowedDependencies('AUD')).toEqual(['BUS']);
  });

  it('tout module hors socle peut dépendre de CFG, AUD et BUS', () => {
    for (const code of MODULE_CODES) {
      if (SOCLE_MODULES.includes(code)) continue;
      expect(allowedDependencies(code)).toEqual(expect.arrayContaining([...SOCLE_MODULES]));
    }
  });

  it('reprend les dépendances explicites de 17 §2.2 (échantillon)', () => {
    expect(MODULES.AVL.dependsOn).toEqual(['PRC', 'PAY', 'CTR', 'KYC', 'RISK', 'CAT', 'CFG']);
    expect(MODULES.STL.dependsOn).toEqual(['PRC', 'PAY', 'CFG']);
    expect(MODULES.PAY.dependsOn).not.toContain('STL'); // rupture du cycle STL ↔ PAY (§2.1)
    expect(allowedDependencies('IAM')).not.toContain('AVL');
    expect(allowedDependencies('SUP')).not.toContain('RPT');
    expect(allowedDependencies('RPT')).toContain('SUP');
  });

  it("aucun module ne s'autorise lui-même", () => {
    for (const code of MODULE_CODES) expect(allowedDependencies(code)).not.toContain(code);
  });

  it('les options de lint couvrent tous les modules', () => {
    const options = toModuleBoundariesOptions();
    expect(Object.keys(options.modules).sort()).toEqual(MODULE_CODES.map(moduleDir).sort());
  });
});

const README_SECTIONS = [
  'Responsabilité',
  'Entités',
  'Événements',
  'Ports',
  'Commandes de test',
] as const;

describe('structure des modules (US-001, US-035)', () => {
  const dirs = readdirSync(modulesRoot).filter((d) => statSync(join(modulesRoot, d)).isDirectory());

  it('un répertoire par module du graphe, et rien d’autre', () => {
    expect(dirs.sort()).toEqual(MODULE_CODES.map(moduleDir).sort());
  });

  it.each(MODULE_CODES.map((c) => [c]))(
    '%s a index.ts, <x>.module.ts, internal/ et un README complet',
    (code) => {
      const dir = join(modulesRoot, moduleDir(code));
      expect(existsSync(join(dir, 'index.ts'))).toBe(true);
      expect(existsSync(join(dir, `${moduleDir(code)}.module.ts`))).toBe(true);
      expect(statSync(join(dir, 'internal')).isDirectory()).toBe(true);
      const readme = readFileSync(join(dir, 'README.md'), 'utf8').trim();
      // US-035 : responsabilité, entités, événements, ports et commandes de test (titres `##`,
      // chacun suivi d'un texte). Même règle pour packages/* : scripts/ci/readmes.test.mjs.
      for (const title of README_SECTIONS) {
        expect(readme, `${code} : section « ${title} »`).toMatch(
          new RegExp(`^## ${title}[ \\t]*\\n+(?!#)\\S`, 'm'),
        );
      }
      expect(readme).toContain(`**${code} — `);
      for (const dep of MODULES[code].dependsOn) expect(readme).toContain(dep);
    },
  );
});
