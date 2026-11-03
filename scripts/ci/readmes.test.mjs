// US-035 : chaque module et chaque paquet a un README qui décrit responsabilité, entités,
// événements, ports et commandes de test (titres `##`, chacun suivi d'un texte).
// Modules de l'API : même règle dans apps/api/src/modules/dependency-graph.test.ts.
// node --test scripts/ci/ (pnpm test:unit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const README_SECTIONS = [
  'Responsabilité',
  'Entités',
  'Événements',
  'Ports',
  'Commandes de test',
];

/** Sections manquantes ou vides d'un README. */
export function missingSections(markdown) {
  const text = markdown.replace(/\r\n/g, '\n');
  return README_SECTIONS.filter(
    (title) => !new RegExp(`^## ${title}[ \\t]*\\n+(?!#)\\S`, 'm').test(text),
  );
}

const dirsOf = (parent) =>
  readdirSync(join(ROOT, parent))
    .filter((d) => statSync(join(ROOT, parent, d)).isDirectory())
    .map((d) => `${parent}/${d}`);

test('le contrôle repère une section absente ou vide', () => {
  const full = README_SECTIONS.map((t) => `## ${t}\n\ntexte\n`).join('\n');
  assert.deepEqual(missingSections(full), []);
  assert.deepEqual(missingSections(full.replace('## Ports\n\ntexte', '## Ports\n\n## Autre')), [
    'Ports',
  ]);
  assert.deepEqual(missingSections(full.replace('## Entités', '### Entités')), ['Entités']);
});

for (const dir of [...dirsOf('packages'), ...dirsOf('apps/api/src/modules')]) {
  test(`${dir}/README.md : responsabilité, entités, événements, ports, commandes de test`, () => {
    const path = join(ROOT, dir, 'README.md');
    assert.ok(existsSync(path), `${dir}/README.md absent`);
    assert.deepEqual(missingSections(readFileSync(path, 'utf8')), [], `${dir}/README.md incomplet`);
  });
}
