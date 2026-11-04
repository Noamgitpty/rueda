/**
 * US-038, critères 1 et 2 (partie code) — la documentation générée est À JOUR : le texte régénéré
 * depuis le code et le contrat est identique au fichier commité, sinon `pnpm test:unit` échoue
 * (donc la CI). `RUEDA_DOCS_WRITE=1` réécrit les fichiers au lieu d'échouer.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowedDependencies, MODULE_CODES, MODULES } from '../../modules/dependency-graph.js';
import type { ModuleCode } from '../../modules/dependency-graph.js';
import { repositoryContract } from '../openapi-contract.js';
import { apiReferenceDocument, importedModules, modulesDocument, REPO_ROOT } from './generate.js';

const write = process.env['RUEDA_DOCS_WRITE'] === '1';

function inSync(relativePath: string, expected: string): void {
  const file = join(REPO_ROOT, relativePath);
  if (write) writeFileSync(file, expected, 'utf8');
  const actual = existsSync(file) ? readFileSync(file, 'utf8').replaceAll('\r\n', '\n') : '';
  expect(
    actual === expected,
    `${relativePath} n'est plus à jour : RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/api exec vitest run src/testing/docs`,
  ).toBe(true);
}

describe('documentation générée depuis le code (ADR-079)', () => {
  it('docs/architecture/modules.md est à jour (graphe, schémas, imports réels, routes)', () => {
    inSync('docs/architecture/modules.md', modulesDocument());
  });

  it('docs/architecture/api.md est à jour (référence du contrat OpenAPI)', () => {
    inSync('docs/architecture/api.md', apiReferenceDocument(repositoryContract().document));
  });

  it('les imports réels ne sortent jamais du graphe (lecture indépendante du lint)', () => {
    const outside = MODULE_CODES.flatMap((code) => {
      const allowed = new Set<string>(allowedDependencies(code));
      return importedModules(code)
        .filter((dep) => !allowed.has(dep))
        .map((dep) => `${code} -> ${dep}`);
    });
    expect(outside).toEqual([]);
  });

  it('le lecteur d’imports voit réellement les dépendances (témoin : SUP importe IAM et CFG)', () => {
    expect(importedModules('SUP')).toEqual(expect.arrayContaining(['IAM', 'CFG', 'RISK']));
  });
});

/**
 * Écarts ASSUMÉS entre le graphe du code et la colonne « Dépend de » de 17 §2.2, chacun reporté
 * (RESUME_HERE « Reports à faire dans docs/specs/ », docs/team/PROPOSITIONS.md) : le socle CFG et
 * AUD publie par l'outbox (BUS), lecture de la revue d'architecture d'US-001.
 */
const SPEC_GAPS: Readonly<Partial<Record<ModuleCode, readonly ModuleCode[]>>> = {
  CFG: ['BUS'],
  AUD: ['BUS'],
};

/** Colonne « Dépend de » de 17 §2.2, par module ; `null` pour « tous ». */
function specDependencies(): Map<string, ModuleCode[] | null> {
  const text = readFileSync(
    join(REPO_ROOT, 'docs/specs/17_DATA_MODEL_AND_ARCHITECTURE.md'),
    'utf8',
  );
  const section = text.slice(text.indexOf('### 2.2'), text.indexOf('### 2.3'));
  const out = new Map<string, ModuleCode[] | null>();
  for (const line of section.split('\n')) {
    const m = /^\| \*\*([A-Z]+)\*\* \|/.exec(line);
    if (m === null) continue;
    const cells = line.split('|');
    const deps = (cells[cells.length - 3] ?? '').replace(/\([^)]*\)/g, '');
    out.set(
      m[1] as string,
      /tous/.test(deps) ? null : MODULE_CODES.filter((c) => new RegExp(`\\b${c}\\b`).test(deps)),
    );
  }
  return out;
}

describe('graphe des modules = 17 §2.2 (spécification qui fait foi)', () => {
  it('chaque module du graphe a sa ligne dans 17 §2.2 (BUS excepté, socle de §2.1)', () => {
    const spec = specDependencies();
    expect(MODULE_CODES.filter((c) => c !== 'BUS' && !spec.has(c))).toEqual([]);
  });

  it('dépendances explicites du code = colonne « Dépend de » de 17 §2.2, écarts assumés exceptés', () => {
    const drift: string[] = [];
    for (const [code, deps] of specDependencies()) {
      if (deps === null) continue; // « tous (lecture) » : SUP et RPT, développés par le graphe
      const spec = MODULES[code as ModuleCode];
      if (spec === undefined) continue;
      const expected = new Set([...deps, ...(SPEC_GAPS[code as ModuleCode] ?? [])]);
      const actual = new Set(spec.dependsOn);
      for (const d of actual) if (!expected.has(d)) drift.push(`${code} -> ${d} : absent de 17`);
      for (const d of expected) if (!actual.has(d)) drift.push(`${code} -> ${d} : absent du code`);
    }
    expect(drift).toEqual([]);
  });
});
