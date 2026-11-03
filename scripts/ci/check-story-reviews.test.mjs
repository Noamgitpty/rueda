// Tests du job « revues » (node --test scripts/ci/), contournements compris.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CHECK_REVIEWS,
  changedFiles,
  evaluateBranch,
  requiredRoles,
  reviewExempt,
  storiesFromBranch,
} from './check-story-reviews.mjs';

// Dépôt git temporaire : `files` commités sur main, puis `moves` (git mv) commités sur `branch`.
function repoWithRename(branch, files, moves) {
  const root = mkdtempSync(join(tmpdir(), 'rueda-rename-'));
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-C',
        root,
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t.invalid',
        '-c',
        'diff.renames=copies',
        ...args,
      ],
      { stdio: 'pipe' },
    );
  git('init', '-q', '-b', 'main');
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), `contenu de ${f}\n`.repeat(20));
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('switch', '-q', '-c', branch);
  for (const [from, to] of moves) {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    git('mv', from, to);
  }
  git('commit', '-q', '-m', 'renommage');
  return root;
}

const config = JSON.parse(
  readFileSync(new URL('../../docs/team/review-requirements.json', import.meta.url), 'utf8'),
);
const ev = (branch, changedFiles = []) => evaluateBranch({ branch, changedFiles, config });

test('stories déduites d’un nom de branche de story conforme', () => {
  assert.deepEqual(storiesFromBranch('story/US-002-integration-continue'), ['US-002']);
  assert.deepEqual(storiesFromBranch('story/US-001-US-029-integration'), ['US-001', 'US-029']);
  assert.deepEqual(storiesFromBranch('story/US-001-029-socle'), ['US-001']);
  assert.deepEqual(storiesFromBranch('story/US-005'), ['US-005']);
});

test('noms de branche piégés ou hors convention : aucune story', () => {
  for (const b of [
    'docs/team-sante',
    'feature/US-002-x',
    'story/US-02-x',
    'story/us-002-x',
    'Story/US-002-x',
    'story/US-002-X',
    'story/US-002-x;rm',
    'story/US-002-x y',
    'story/US-002_x',
    'story/US-002-x/../main',
    'xstory/US-002-x',
  ]) {
    assert.deepEqual(storiesFromBranch(b), [], b);
  }
});

test('branche hors liste blanche : échec (plus de vert « rien à contrôler »)', () => {
  for (const b of ['fix/x', 'docs/x', 'main', 'feature/US-002-x', 'story/us-002-x']) {
    assert.match(ev(b, ['README.md']).errors[0], /hors liste blanche/, b);
  }
});

test('préfixe déclaré limité à docs/team/ : succès sans revue', () => {
  const r = ev('docs/team-sante-02', ['docs/team/BOARD.md', 'docs/team/health/s02.md']);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.stories, []);
  assert.match(r.note, /aucune revue/);
  assert.deepEqual(ev('chore/menage', ['docs/team/RISKS.md']).errors, []);
});

test('préfixe déclaré qui touche du code : échec', () => {
  const r = ev('chore/menage', ['docs/team/BOARD.md', 'apps/api/src/main.ts']);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /apps\/api\/src\/main.ts : hors des chemins permis/);
  assert.match(ev('docs/team-x', ['.github/workflows/ci.yml']).errors[0], /hors des chemins/);
});

test('préfixe déclaré : rapports de revue, passations et règle interdits', () => {
  for (const f of [
    'docs/team/reviews/US-002/code-2026-11-01.md',
    'docs/team/handoffs/US-002.md',
    'docs/team/review-requirements.json',
  ]) {
    assert.match(ev('docs/team-x', [f]).errors[0], /interdit hors branche de story/, f);
  }
});

test('préfixe nu ou suffixe piégé : échec', () => {
  assert.match(ev('chore/', ['docs/team/BOARD.md']).errors[0], /suffixe invalide/);
  assert.match(ev('chore/X;y', ['docs/team/BOARD.md']).errors[0], /suffixe invalide/);
});

test('branche d’une story qui livre la passation d’une autre : échec', () => {
  const r = ev('story/US-001-x', ['docs/team/handoffs/US-002.md', '.github/workflows/ci.yml']);
  assert.match(r.errors[0], /appartient à US-002/);
});

test('branche d’une story qui écrit les revues d’une autre : échec', () => {
  const r = ev('story/US-002-x', ['docs/team/reviews/US-001/code-2026-11-02.md']);
  assert.match(r.errors[0], /appartient à US-001/);
});

test('fichiers de sa propre story et story déclarée related : succès', () => {
  const own = ['docs/team/handoffs/US-002.md', 'docs/team/reviews/US-002/code-2026-11-02.md'];
  assert.deepEqual(ev('story/US-002-x', own).errors, []);
  assert.deepEqual(ev('story/US-001-x', ['docs/team/handoffs/US-029.md']).errors, []);
});

test('fichiers partagés (BOARD, RESUME_HERE, sessions) tolérés même s’ils nomment une story', () => {
  const shared = ['docs/team/BOARD.md', 'docs/team/sessions/US-005-notes.md'];
  assert.deepEqual(ev('story/US-002-x', shared).errors, []);
});

test('packages/<x> : la story doit en être propriétaire ; paquet inconnu : échec', () => {
  assert.match(
    ev('story/US-002-x', ['packages/db/schemas.ts']).errors[0],
    /réservé à US-001, US-005/,
  );
  assert.deepEqual(ev('story/US-005-banc', ['packages/db/migrations/0001.sql']).errors, []);
  assert.match(ev('story/US-098-zzz', ['packages/zzz/src/a.ts']).errors[0], /absent de pathOwners/);
  // packages/dbx/ n'est pas packages/db/.
  assert.match(ev('story/US-005-x', ['packages/dbx/a.ts']).errors[0], /packages\/dbx\//);
});

test('défaut : code seul', () => {
  assert.deepEqual(requiredRoles('US-099', ['README.md', 'apps/web/src/page.tsx'], config), [
    'code',
  ]);
});

test('workflows, scripts du contrôle et règle des revues touchés : + sécurité (US-050)', () => {
  for (const f of [
    '.github/workflows/ci.yml',
    '.github/CODEOWNERS',
    'scripts/ci/check-story-reviews.mjs',
    'scripts/team/check-reviews.mjs',
    'docs/team/review-requirements.json',
  ]) {
    assert.deepEqual(requiredRoles('US-099', [f], config), ['code', 'securite'], f);
  }
  assert.deepEqual(requiredRoles('US-099', ['scripts/not-yet-implemented.mjs'], config), ['code']);
  assert.deepEqual(requiredRoles('US-099', ['.githubx/a.yml'], config), ['code']);
});

test('chemins libres transmis à check-reviews : sharedPaths et rapports / passations de la branche', () => {
  const ex = reviewExempt(['US-001', 'US-029'], config);
  for (const p of [
    'docs/team/BOARD.md',
    'docs/team/sessions/',
    'docs/team/reviews/US-029/',
    'docs/team/handoffs/US-029.md',
    'docs/team/reviews/US-001/',
  ]) {
    assert.ok(ex.includes(p), p);
  }
  assert.ok(!ex.some((p) => p.startsWith('packages/') || p.startsWith('scripts/')));
  assert.deepEqual(reviewExempt([], { sharedPaths: ['a,b', 'c/'] }), ['c/']);
});

test('check-reviews lancé depuis le dossier du script, jamais depuis --root (US-050)', () => {
  assert.equal(CHECK_REVIEWS, fileURLToPath(new URL('../team/check-reviews.mjs', import.meta.url)));
  // Dépôt contrôlé dont le check-reviews.mjs est truqué (toujours « OK ») et sans aucun rapport.
  const root = repoWithRename(
    'story/US-099-x',
    ['README.md', 'docs/team/review-requirements.json', 'scripts/team/check-reviews.mjs'],
    [['README.md', 'LISEZMOI.md']],
  );
  try {
    writeFileSync(join(root, 'scripts/team/check-reviews.mjs'), 'process.exit(0);\n');
    // Règles (JSON de la base illisible : repli sur l'arbre, comme à l'amorçage) : défaut `code`.
    writeFileSync(join(root, 'docs/team/review-requirements.json'), '{"default":["code"]}\n');
    const res = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./check-story-reviews.mjs', import.meta.url)),
        '--branch',
        'story/US-099-x',
        '--base',
        'main',
        '--root',
        root,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.match(res.stderr, /rapport de revue « code » absent/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graphe des dépendances ou packages/db touchés : + architecture', () => {
  const graph = ['apps/api/src/modules/dependency-graph.ts'];
  assert.deepEqual(requiredRoles('US-099', graph, config), ['architecture', 'code']);
  const db = ['packages/db/migrations/0001.sql'];
  assert.deepEqual(requiredRoles('US-099', db, config), ['architecture', 'code', 'securite']);
  assert.deepEqual(requiredRoles('US-099', ['packages/dbx/a.ts'], config), ['code']);
});

test('rôles propres à une story ajoutés au défaut', () => {
  assert.deepEqual(requiredRoles('US-001', [], config), ['architecture', 'code']);
});

test('renommage réel vers docs/team/ : les deux chemins sont vus, la branche à préfixe échoue', () => {
  const cases = [
    ['packages/db/schema.ts', 'docs/team/schema.ts', /packages\/db\/schema.ts : hors des chemins/],
    [
      'docs/team/reviews/US-005/x.md',
      'docs/team/x.md',
      /reviews\/US-005\/x.md : interdit hors branche de story/,
    ],
  ];
  for (const [from, to, expected] of cases) {
    // diff.renames=copies dans le dépôt : --no-renames doit l'emporter sur la configuration.
    const root = repoWithRename('chore/x', [from], [[from, to]]);
    try {
      const files = changedFiles(root, 'main');
      assert.deepEqual([...files].sort(), [from, to].sort());
      const r = evaluateBranch({ branch: 'chore/x', changedFiles: files, config });
      assert.ok(
        r.errors.some((e) => expected.test(e)),
        r.errors.join('\n'),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('renommage réel hors de la story : le chemin de départ est recoupé', () => {
  const from = 'docs/team/handoffs/US-005.md';
  const root = repoWithRename('story/US-002-x', [from], [[from, 'docs/team/handoffs/notes.md']]);
  try {
    const r = evaluateBranch({
      branch: 'story/US-002-x',
      changedFiles: changedFiles(root, 'main'),
      config,
    });
    assert.match(r.errors[0], /US-005.md : appartient à US-005/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('docs/specs/ ou CLAUDE.md touchés : + architecture ; stories de révision P2P (US-053 à US-060)', () => {
  assert.deepEqual(requiredRoles('US-099', ['docs/specs/22_OPEN_QUESTIONS.md'], config), [
    'architecture',
    'code',
  ]);
  assert.deepEqual(requiredRoles('US-099', ['CLAUDE.md'], config), [
    'architecture',
    'code',
    'securite',
  ]);
  assert.deepEqual(requiredRoles('US-099', ['docs/specs/08_BUSINESS_RULES.md'], config), [
    'architecture',
    'argent',
    'code',
  ]);
  assert.deepEqual(
    requiredRoles('US-099', ['docs/specs/17_DATA_MODEL_AND_ARCHITECTURE.md'], config),
    ['architecture', 'argent', 'code', 'securite'],
  );
  assert.deepEqual(requiredRoles('US-099', ['docs/specs/tools/oracle.py'], config), [
    'architecture',
    'argent',
    'code',
  ]);
  // Registre des oracles : relâcher un motif affaiblit un contrôle, d'où + sécurité (US-050 03g).
  assert.deepEqual(requiredRoles('US-099', ['docs/specs/tools/registry.json'], config), [
    'architecture',
    'argent',
    'code',
    'securite',
  ]);
  assert.deepEqual(requiredRoles('US-099', ['docs/specs/tools/registry.json.bak'], config), [
    'architecture',
    'argent',
    'code',
  ]);
  assert.deepEqual(requiredRoles('US-099', ['docs/specs.md'], config), ['code']);
  assert.deepEqual(requiredRoles('US-055', [], config), ['argent', 'code', 'qa']);
  assert.deepEqual(requiredRoles('US-056', [], config), [
    'architecture',
    'argent',
    'code',
    'securite',
  ]);
});

test('lot 0 : paquets déclarés pour les stories qui les créent ou les modifient (US-050)', () => {
  assert.deepEqual(ev('story/US-006-preuves-l0', ['packages/db/migrations/0002.sql']).errors, []);
  assert.deepEqual(ev('story/US-016-oracle', ['packages/money/test/golden.test.ts']).errors, []);
  assert.deepEqual(ev('story/US-030-jetons', ['packages/design-tokens/tokens.json']).errors, []);
  assert.deepEqual(ev('story/US-019-psp', ['packages/fake-adapters/src/psp.ts']).errors, []);
  // Propriété exacte : US-030 ne touche pas packages/db/, US-016 ne touche pas les jetons.
  assert.match(ev('story/US-030-jetons', ['packages/db/a.sql']).errors[0], /réservé à/);
  assert.match(ev('story/US-016-x', ['packages/design-tokens/a.json']).errors[0], /réservé à/);
  // packages/design-tokensx/ n'est pas packages/design-tokens/.
  assert.match(
    ev('story/US-030-x', ['packages/design-tokensx/a.json']).errors[0],
    /absent de pathOwners/,
  );
});

test('lot 0 : revues exigées par story (19 Revue design, contrainte 1)', () => {
  assert.deepEqual(requiredRoles('US-006', ['packages/db/migrations/0002.sql'], config), [
    'architecture',
    'code',
    'qa',
    'securite',
  ]);
  assert.deepEqual(requiredRoles('US-016', ['packages/money/src/a.ts'], config), [
    'argent',
    'code',
    'qa',
  ]);
  assert.deepEqual(requiredRoles('US-030', ['packages/design-tokens/a.json'], config), [
    'code',
    'ux',
  ]);
  assert.deepEqual(requiredRoles('US-011', [], config), ['architecture', 'code', 'qa', 'securite']);
  assert.deepEqual(requiredRoles('US-062', [], config), [
    'architecture',
    'argent',
    'code',
    'qa',
    'securite',
  ]);
});

test('lot 0 : chaque story US-0xx de 19 §3.1 a ses revues ; chaque paquet du dépôt a ses propriétaires', () => {
  const backlog = readFileSync(
    new URL('../../docs/specs/19_DEVELOPMENT_BACKLOG.md', import.meta.url),
    'utf8',
  );
  const lot0 = backlog.split('### 3.1 Lot 0')[1].split('### 3.2 ')[0];
  const ids = [...lot0.matchAll(/^#### (US-\d{3}) /gm)].map((m) => m[1]);
  assert.ok(ids.length >= 50, `stories du lot 0 lues : ${ids.length}`);
  for (const id of ['US-061', 'US-062', ...ids]) {
    const r = config.stories[id];
    assert.ok(Array.isArray(r?.require) && r.require.includes('code'), id);
    const story = lot0.split(`#### ${id} `)[1].split('\n#### ')[0];
    if (/\*\*Revue design\*\* : OUI/.test(story)) assert.ok(r.require.includes('ux'), `${id} : ux`);
  }
  const pkgs = readdirSync(new URL('../../packages/', import.meta.url), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => `packages/${d.name}/`);
  for (const p of pkgs) assert.ok(Array.isArray(config.pathOwners[p]), p);
});

test('paquets sensibles : revues exigées pour toute story, documentation comprise (US-050 03i)', () => {
  // US-035 (README) et US-038 (documentation) sont propriétaires, mais la règle de chemin l'emporte.
  const cases = [
    ['US-035', 'packages/money/README.md', ['argent', 'code']],
    ['US-035', 'packages/money/src/money.ts', ['argent', 'code']],
    ['US-035', 'packages/db/README.md', ['architecture', 'code', 'securite']],
    ['US-038', 'packages/db/migrations/0009.sql', ['architecture', 'code', 'securite']],
    ['US-035', 'packages/fake-adapters/src/psp.ts', ['code', 'securite']],
    ['US-035', 'packages/config/sql-clock/cli.ts', ['code', 'securite']],
    ['US-030', 'packages/config/eslint/index.js', ['code', 'securite', 'ux']],
    ['US-099', 'packages/moneyx/a.ts', ['code']],
    ['US-099', 'packages/fake-adaptersx/a.ts', ['code']],
  ];
  for (const [story, file, roles] of cases) {
    assert.deepEqual(requiredRoles(story, [file], config), roles, `${story} ${file}`);
    if (!file.includes('x/')) {
      assert.deepEqual(
        ev(`story/${story}-x`, [file]).errors,
        [],
        `${story} propriétaire de ${file}`,
      );
    }
  }
});

test('lot 0 : rôles exacts des stories sensibles (argent, sécurité, qa, architecture)', () => {
  const A = 'architecture',
    M = 'argent',
    C = 'code',
    Q = 'qa',
    S = 'securite',
    U = 'ux';
  const expected = {
    'US-003': [A, C, S],
    'US-004': [A, C, S],
    'US-006': [A, C, Q, S],
    'US-007': [A, C, Q, S],
    'US-008': [A, C, Q],
    'US-009': [A, C, S],
    'US-010': [A, C, S],
    'US-011': [A, C, Q, S],
    'US-012': [C, S, U],
    'US-013': [A, M, C, Q],
    'US-016': [M, C, Q],
    'US-017': [M, C, Q],
    'US-018': [A, M, C, Q, S],
    'US-019': [A, M, C, Q, S],
    'US-020': [A, C, S],
    'US-022': [A, C, Q, S],
    'US-023': [A, C, Q, S],
    'US-024': [A, M, C, Q, S],
    'US-025': [A, C, Q, S],
    'US-034': [A, C, S],
    'US-037': [C, S],
    'US-042': [M, C, Q],
    'US-043': [C, Q, S],
    'US-046': [A, C, Q, S],
    'US-047': [M, C, Q],
    'US-049': [A, M, C, S],
    'US-051': [C, S],
    'US-052': [C, S],
    'US-061': [A, M, C, Q, S],
    'US-062': [A, M, C, Q, S],
  };
  for (const [story, roles] of Object.entries(expected)) {
    assert.deepEqual(requiredRoles(story, [], config), roles, story);
  }
});

test('packages/i18n : les stories qui ajoutent des textes visibles en sont propriétaires (DEC-FONDATEUR-17)', () => {
  for (const s of ['US-010', 'US-013', 'US-102', 'US-106']) {
    const r = ev(`story/${s}-x`, ['packages/i18n/src/catalogs/fr.ts']);
    assert.ok(!r.errors.some((e) => /packages\/i18n/.test(e)), `${s} : ${r.errors.join(' ; ')}`);
  }
  assert.match(
    ev('story/US-099-x', ['packages/i18n/src/catalogs/fr.ts']).errors[0],
    /packages\/i18n/,
  );
});

test('packages/config : les stories qui ajoutent des règles de lint en sont propriétaires, avec revue sécurité', () => {
  const r = ev('story/US-017-x', ['packages/config/eslint/index.ts']);
  assert.ok(!r.errors.some((e) => /packages\/config/.test(e)), r.errors.join(' ; '));
  assert.ok(
    requiredRoles('US-017', ['packages/config/eslint/index.ts'], config).includes('securite'),
  );
  assert.match(
    ev('story/US-099-x', ['packages/config/eslint/index.ts']).errors[0],
    /packages\/config/,
  );
});
