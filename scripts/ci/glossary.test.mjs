// US-038, critère 4 — « Given un terme métier, When il apparaît, Then le glossaire ES / FR / EN
// le contient (point de départ : 17 annexe B) ». Contrôles de docs/glossary.md :
// - chaque terme de 17 annexe B a sa ligne dans « Termes métier » (colonne « 17 annexe B ») ;
// - chaque ligne des deux tableaux a ses quatre langues (es, fr, en, pt) ;
// - aucune traduction espagnole n'emploie le vocabulaire exclu (loueur, agence, « huésped »,
//   « fianza ») ; la colonne Remarque peut le citer pour l'interdire.
// Lancé par `pnpm test:unit` (node --test scripts/ci/).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

/** Lignes d'un tableau Markdown (sans l'en-tête ni le séparateur), cellules nettoyées. */
export function tableRows(markdown, heading) {
  const start = markdown.indexOf(heading);
  assert.notEqual(start, -1, `section introuvable : ${heading}`);
  const rest = markdown.slice(start + heading.length);
  const end = rest.search(/\n## /);
  const section = end === -1 ? rest : rest.slice(0, end);
  const rows = section
    .split('\n')
    .filter((l) => l.startsWith('|'))
    .map((l) =>
      l
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((c) => c.trim()),
    );
  return rows.slice(2);
}

const glossary = read('docs/glossary.md');
const annexB = tableRows(read('docs/specs/17_DATA_MODEL_AND_ARCHITECTURE.md'), '## Annexe B');
const business = tableRows(glossary, '## Termes métier');
const interfaceRows = tableRows(glossary, '# Glossaire ES / FR / EN / PT');

test('chaque terme de 17 annexe B a sa ligne dans les termes métier', () => {
  assert.ok(annexB.length >= 20, `annexe B : ${annexB.length} termes lus`);
  const listed = new Set(business.map((r) => r[0]));
  const missing = annexB.map((r) => r[0]).filter((term) => !listed.has(term));
  assert.deepEqual(missing, []);
});

test('chaque terme a ses quatre langues (es, fr, en, pt)', () => {
  for (const [label, rows, first] of [
    ['termes métier', business, 1],
    ['interface', interfaceRows, 0],
  ]) {
    assert.ok(rows.length > 0, label);
    for (const row of rows) {
      if (row[0] === 'Termes historiques') continue;
      const langs = row.slice(first, first + 4);
      assert.equal(langs.length, 4, `${label} : ${row.join(' | ')}`);
      for (const value of langs) {
        assert.ok(value !== '' && value !== '—', `${label} : langue vide dans « ${row[first]} »`);
      }
    }
  }
});

test('aucune traduction espagnole n’emploie le vocabulaire exclu', () => {
  const excluded = /\b(mostrador|agencia|flota|huésped|fianza)\b/i;
  for (const [rows, es] of [
    [business, 1],
    [interfaceRows, 0],
  ]) {
    for (const row of rows) {
      assert.doesNotMatch(row[es] ?? '', excluded, `espagnol exclu : ${row[es]}`);
    }
  }
});

test('lecteur de tableau : témoin', () => {
  const md = '## T\n\n| a | b |\n| - | - |\n| 1 | x \\| y |\n\n## U\n| z |\n';
  assert.deepEqual(tableRows(md, '## T'), [['1', 'x \\| y']]);
});
