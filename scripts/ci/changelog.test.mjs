// Tests du contrôle d'entrée de CHANGELOG et du versement (US-040, ADR-085 ; node --test scripts/ci/).
// Les échecs volontaires (code sans fragment, fragment mal formé, autre story, diff vide) prouvent
// que le contrôle ne passe pas à vide ; ils sont joués sur un vrai dépôt git jetable, par la CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRelease,
  branchStories,
  evaluate,
  isExemptPath,
  parseFragment,
  runRelease,
} from './changelog.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'changelog.mjs');
const OK = 'lot: L0\nmodule: Équipe et CI\n- Ajouté : contrôle du CHANGELOG (US-040)\n';

// --- Dépôt jetable -----------------------------------------------------------------------------

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'changelog-'));
  const g = (...a) =>
    execFileSync(
      'git',
      ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  g('init', '-q', '-b', 'main');
  g('config', 'core.hooksPath', join(dir, 'aucun-hook'));
  put('packages/x/index.ts', 'export const a = 1;\n');
  put('docs/a.md', '# a\n');
  put('CHANGELOG.md', '# Changelog\n\n## [Non publié]\n\nIntro.\n');
  g('add', '-A');
  g('commit', '-q', '-m', 'base');
  g('checkout', '-q', '-b', 'story/US-040-changelog');
  const commit = (files) => {
    for (const [p, t] of Object.entries(files)) put(p, t);
    g('add', '-A');
    g('commit', '-q', '--allow-empty', '-m', 'pr');
  };
  const check = (branch = 'story/US-040-changelog') =>
    spawnSync(
      process.execPath,
      [CLI, 'check', '--branch', branch, '--base', 'main', '--root', dir],
      {
        encoding: 'utf8',
      },
    );
  return { dir, g, put, commit, check, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('ÉCHEC VOLONTAIRE : code livré sans fragment', () => {
  const r = repo();
  try {
    r.commit({ 'packages/x/index.ts': 'export const a = 2;\n' });
    const out = r.check();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /code livré sans entrée de CHANGELOG.*packages\/x\/index\.ts/);
  } finally {
    r.done();
  }
});

test('code livré avec un fragment valide de la story : succès', () => {
  const r = repo();
  try {
    r.commit({ 'packages/x/index.ts': 'export const a = 2;\n', 'changelog.d/US-040.md': OK });
    const out = r.check();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /1 entrée\(s\)/);
  } finally {
    r.done();
  }
});

test('ÉCHEC VOLONTAIRE : fragment qui ne cite pas une story de la branche', () => {
  const r = repo();
  try {
    r.commit({
      'packages/x/index.ts': 'export const a = 2;\n',
      'changelog.d/US-040.md': OK.replace('US-040', 'US-999'),
    });
    const out = r.check();
    assert.equal(out.status, 1);
    assert.match(out.stderr, /aucun fragment ne cite une story de la branche \(US-040\)/);
  } finally {
    r.done();
  }
});

test('ÉCHEC VOLONTAIRE : fragment mal formé', () => {
  const r = repo();
  try {
    r.commit({
      'packages/x/index.ts': 'export const a = 2;\n',
      'changelog.d/US-040.md': 'lot: L0\nmodule: CI\n- un ajout sans catégorie (US-040)\n',
    });
    const out = r.check();
    assert.equal(out.status, 1);
    assert.match(out.stderr, /doit commencer par/);
  } finally {
    r.done();
  }
});

test('ÉCHEC VOLONTAIRE : fragment supprimé ne compte pas', () => {
  const r = repo();
  try {
    r.commit({ 'changelog.d/ancien.md': OK });
    r.g('checkout', '-q', 'main');
    r.g('merge', '-q', '--no-ff', '-m', 'm', 'story/US-040-changelog');
    r.g('checkout', '-q', '-b', 'story/US-041-x');
    r.g('rm', '-q', 'changelog.d/ancien.md');
    r.commit({ 'packages/x/index.ts': 'export const a = 3;\n' });
    const out = r.check('story/US-041-x');
    assert.equal(out.status, 1);
    assert.match(out.stderr, /sans entrée de CHANGELOG/);
  } finally {
    r.done();
  }
});

test('ÉCHEC VOLONTAIRE : diff vide (base mal résolue)', () => {
  const r = repo();
  try {
    const out = r.check();
    assert.equal(out.status, 1);
    assert.match(out.stderr, /diff vide/);
  } finally {
    r.done();
  }
});

test('ÉCHEC VOLONTAIRE : base introuvable', () => {
  const r = repo();
  try {
    r.commit({ 'packages/x/index.ts': 'export const a = 2;\n', 'changelog.d/US-040.md': OK });
    const out = spawnSync(
      process.execPath,
      [CLI, 'check', '--branch', 'story/US-040-x', '--base', 'origin/absente', '--root', r.dir],
      { encoding: 'utf8' },
    );
    assert.equal(out.status, 1);
    assert.match(out.stderr, /calcul git impossible/);
  } finally {
    r.done();
  }
});

test('documentation seule (rapports, passation, docs/) : exemption automatique', () => {
  const r = repo();
  try {
    r.commit({
      'docs/team/reviews/US-040/code-2026-11-04.md': 'APPROUVÉ\n',
      'docs/a.md': '# a modifié\n',
      'packages/x/README.md': '# x\n',
    });
    const out = r.check();
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /exemption automatique/);
  } finally {
    r.done();
  }
});

test('exemption justifiée par fragment : succès ; raison trop courte : échec', () => {
  const r = repo();
  try {
    r.commit({
      'packages/x/index.ts': 'export const a = 2;\n',
      'changelog.d/US-040.md': 'exemption: US-040 — ok\n',
    });
    assert.equal(r.check().status, 1);
    r.commit({
      'changelog.d/US-040.md':
        'exemption: US-040 — renommage interne sans effet visible ni changement de comportement\n',
    });
    const out = r.check();
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /exemption/);
  } finally {
    r.done();
  }
});

// --- Fonctions pures ---------------------------------------------------------------------------

test('chemins exemptés et chemins de code livré', () => {
  for (const p of [
    'docs/x.py',
    'docs/team/handoffs/US-040.md',
    'README.md',
    'apps/web/README.md',
  ]) {
    assert.equal(isExemptPath(p), true, p);
  }
  for (const p of [
    'apps/api/src/main.ts',
    'package.json',
    'pnpm-lock.yaml',
    '.github/workflows/ci.yml',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'scripts/ci/fixtures/mermaid-invalide.md',
    'scripts/ci/changelog.mjs',
  ]) {
    assert.equal(isExemptPath(p), false, p);
  }
});

test('stories de la branche', () => {
  assert.deepEqual(branchStories('story/US-052-US-021-anti-abus'), ['US-052', 'US-021']);
  assert.deepEqual(branchStories('story/US-040-changelog'), ['US-040']);
  assert.deepEqual(branchStories('chore/x'), []);
});

test('fragment : plusieurs blocs, catégories, erreurs', () => {
  const p = parseFragment(
    '<!-- c -->\nlot: L0\nmodule: A\n- Ajouté : a (US-001)\nlot: L1\nmodule: B\n- Corrigé : b (US-002)\n',
  );
  assert.deepEqual(p.errors, []);
  assert.equal(p.blocks.length, 2);
  assert.equal(p.blocks[1].lot, 'L1');
  assert.ok(parseFragment('lot: L9\nmodule: A\n- Ajouté : a (US-001)\n').errors[0].includes('L9'));
  assert.ok(parseFragment('module: A\n- Ajouté : a (US-001)\n').errors.length > 0);
  assert.ok(parseFragment('lot: L0\nmodule: A\n- Ajouté : a\n').errors[0].includes('story'));
  assert.ok(parseFragment('lot: L0\nmodule: A\n').errors.length > 0);
  assert.ok(parseFragment('').errors.length > 0);
  assert.ok(parseFragment('du texte libre\n').errors.length > 0);
  assert.ok(parseFragment(`exemption: US-001 — raison suffisamment longue\n${OK}`).errors.length);
});

test('evaluate : branche hors story, fragment valide sans contrainte de story', () => {
  const r = evaluate({
    changes: [
      { status: 'M', path: 'apps/api/x.ts' },
      { status: 'A', path: 'changelog.d/a.md' },
    ],
    branch: 'chore/x',
    readFile: () => OK.replace('US-040', 'US-001'),
  });
  assert.deepEqual(r.errors, []);
});

// --- Versement ---------------------------------------------------------------------------------

const BASE_LOG = [
  '# Changelog',
  '',
  '## [Non publié]',
  '',
  'Intro.',
  '',
  '### Lot L0 — Socle',
  '',
  '#### Équipe et CI',
  '',
  '- Ajouté : intégration continue (US-002, #2)',
  '',
].join('\n');

test('versement : fragments regroupés par lot et module, numéro de PR ajouté', () => {
  const out = applyRelease({
    changelog: BASE_LOG,
    fragments: [
      { path: 'changelog.d/a.md', text: OK, pr: '80' },
      {
        path: 'changelog.d/b.md',
        text: 'lot: L1\nmodule: Hôtes\n- Ajouté : x (US-100)\n',
        pr: null,
      },
      {
        path: 'changelog.d/c.md',
        text: 'exemption: US-041 — rien de visible pour personne\n',
        pr: '81',
      },
    ],
    version: '0.1.0',
    date: '2026-11-10',
  });
  assert.match(out, /## \[Non publié\]\n\nIntro\.\n\n## \[0\.1\.0\] — 2026-11-10\n/);
  assert.match(
    out,
    /- Ajouté : intégration continue \(US-002, #2\)\n- Ajouté : contrôle du CHANGELOG \(US-040, #80\)/,
  );
  assert.match(out, /### Lot L1\n\n#### Hôtes\n\n- Ajouté : x \(US-100\)/);
  assert.doesNotMatch(out, /US-041/);
  assert.throws(() =>
    applyRelease({ changelog: out, fragments: [], version: '0.1.0', date: '2026-11-11' }),
  );
});

test('versement refusé sans notes de version en français ; accepté avec, fragments supprimés', () => {
  const r = repo();
  try {
    r.put('CHANGELOG.md', BASE_LOG);
    r.put('docs/NOTES_DE_VERSION.md', '# Notes\n');
    r.put('changelog.d/US-040.md', OK);
    assert.throws(
      () => runRelease({ root: r.dir, version: '0.1.0', date: '2026-11-10' }),
      /NOTES_DE_VERSION/,
    );
    r.put('docs/NOTES_DE_VERSION.md', '# Notes\n\n## 0.1.0 — 10 novembre 2026\n\nTexte.\n');
    assert.equal(runRelease({ root: r.dir, version: '0.1.0', date: '2026-11-10' }), 1);
    assert.equal(existsSync(join(r.dir, 'changelog.d/US-040.md')), false);
    assert.match(
      readFileSync(join(r.dir, 'CHANGELOG.md'), 'utf8'),
      /contrôle du CHANGELOG \(US-040\)/,
    );
  } finally {
    r.done();
  }
});

test('le CHANGELOG du dépôt est versable (structure Non publié / Lot / module lisible)', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const out = applyRelease({
    changelog: text,
    fragments: [],
    version: '9.9.9',
    date: '2026-01-01',
  });
  const entries = (s) => (s.match(/^- /gm) ?? []).length;
  assert.equal(entries(out), entries(text));
  assert.ok(entries(text) >= 74, `au moins une entrée par PR fusionnée (${entries(text)})`);
  for (const n of [1, 2, 18, 40, 65, 77]) assert.match(text, new RegExp(`#${n}\\b`));
});
