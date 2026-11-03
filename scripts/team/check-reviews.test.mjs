// Tests du contrôle des revues (node --test scripts/team/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  authorModelsFromGit,
  authorModelsFromLog,
  checkReviews,
  parseArgs,
  parseReview,
} from './check-reviews.mjs';

const SCRIPT = fileURLToPath(new URL('./check-reviews.mjs', import.meta.url));

// Dépôt git temporaire : `commit(files, msg)` écrit puis commite ; `git(...)` lance une commande.
function gitRepo() {
  const root = mkdtempSync(join(tmpdir(), 'rueda-stale-'));
  const git = (...args) =>
    execFileSync(
      'git',
      ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  const commit = (files, msg = 'x') => {
    for (const [f, body] of Object.entries(files)) {
      mkdirSync(dirname(join(root, f)), { recursive: true });
      writeFileSync(join(root, f), body);
    }
    git('add', '-A');
    git('commit', '-q', '-m', msg);
    return git('rev-parse', '--short=12', 'HEAD');
  };
  git('init', '-q', '-b', 'main');
  commit({ 'a.ts': 'a0\n', 'b.ts': 'b0\n' }, 'base');
  return { root, git, commit, done: () => rmSync(root, { recursive: true, force: true }) };
}

const REPORT = 'docs/team/reviews/US-001/code-2026-10-31.md';
// Lance le vrai CLI (câblage compris) sur le dépôt ; retourne { status, err }.
const cli = (root, extra = []) => {
  const r = spawnSync(
    process.execPath,
    [
      SCRIPT,
      'US-001',
      '--require',
      'code',
      '--author-model',
      'claude-opus-5-5',
      '--root',
      root,
      ...extra,
    ],
    { encoding: 'utf8' },
  );
  return { status: r.status, err: r.stderr };
};

function repoWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'reviews-'));
  const dir = join(root, 'docs', 'team', 'reviews', 'US-001');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return root;
}

const AUTHOR = ['claude-opus-5-5'];
// Chaque commit d'un journal de test ne touche qu'un rapport de revue (US-050 : condition de l'exclusion).
const reportFiles = () => ['docs/team/reviews/US-001/code-2026-10-31.md'];
const report = ({
  who = 'claude-sonnet-5-5',
  family = '(famille A, autre modèle que l’auteur claude-opus-5-5)',
  rows = '',
  verdict = 'APPROUVÉ',
  sha = 'abc1234',
} = {}) =>
  `# Revue code — US-001 — 2026-10-31\nRelecteur : revue-code / ${who} ${family}\nEntrées : diff e74d350..${sha}, story US-001\n| # | Gravité | Constat | Preuve | Décision |\n|---|---|---|---|---|\n${rows}\nVerdict : ${verdict}\n`;
const run = (files, opts = {}) =>
  checkReviews({
    story: 'US-001',
    required: ['code'],
    authorModels: AUTHOR,
    root: repoWith(files),
    ...opts,
  });

test('rapport absent : échec', () => {
  assert.match(run({})[0], /absent/);
});

test('rapport conforme citant le modèle de l’auteur : succès (pas de faux positif)', () => {
  assert.deepEqual(run({ 'code-2026-10-31.md': report() }), []);
});

test('relecteur = modèle de l’auteur : échec', () => {
  const files = { 'code-2026-10-31.md': report({ who: 'claude-opus-5-5', family: '' }) };
  assert.match(run(files)[0], /même modèle/);
});

test('modèle de l’auteur introuvable : échec explicite', () => {
  assert.match(run({ 'code-2026-10-31.md': report() }, { authorModels: [] })[0], /introuvable/);
});

test('--require vide : échec', () => {
  assert.match(run({ 'code-2026-10-31.md': report() }, { required: [] })[0], /aucune revue/);
});

test('rapport de deux lignes (gabarit incomplet) : échec', () => {
  const short = 'Relecteur : revue-code / claude-sonnet-5-5\nVerdict : APPROUVÉ\n';
  assert.ok(run({ 'code-2026-10-31.md': short }).some((e) => /gabarit incomplet/.test(e)));
});

test('APPROUVÉ avec un CRITIQUE non clos : échec ; CRITIQUE corrigé : succès', () => {
  const open = '| 1 | CRITIQUE | fuite | a.ts:1 | à corriger |';
  assert.match(run({ 'code-2026-10-31.md': report({ rows: open }) })[0], /CRITIQUE non clos/);
  const closed = '| 1 | CRITIQUE | fuite | a.ts:1 | corrigé en 1234abc |';
  assert.deepEqual(run({ 'code-2026-10-31.md': report({ rows: closed }) }), []);
});

test('changements demandés : échec ; le dernier rapport fait foi', () => {
  const bad = report({ verdict: 'CHANGEMENTS DEMANDÉS' });
  assert.equal(run({ 'code-2026-10-31.md': bad }).length, 1);
  assert.deepEqual(run({ 'code-2026-10-30.md': bad, 'code-2026-10-31.md': report() }), []);
});

test('revue argent sans famille B ni « revue dégradée » : échec', () => {
  const files = { 'argent-2026-10-31.md': report({ family: '(famille A)' }) };
  assert.match(run(files, { required: ['argent'] })[0], /famille B/);
  const ok = { 'argent-2026-10-31.md': report({ family: '(famille A, revue dégradée)' }) };
  assert.deepEqual(run(ok, { required: ['argent'] }), []);
});

test('sha revu qui n’est pas un ancêtre de HEAD : échec', () => {
  const files = { 'code-2026-10-31.md': report({ sha: 'deadbee' }) };
  assert.match(run(files, { isAncestor: () => false })[0], /pas un ancêtre/);
  assert.deepEqual(run(files, { isAncestor: () => true }), []);
});

test('les commits des relecteurs ne comptent pas comme auteur', () => {
  const log =
    'feat\n\nAgent-Role: back-end\nAgent-Model: claude-opus-5-5\n\u0000' +
    'docs(review)\n\nAgent-Role: revue-code\nAgent-Model: claude-sonnet-5-5\n\u0000';
  assert.deepEqual(authorModelsFromLog(log, reportFiles), ['claude-opus-5-5']);
});

test('parseReview lit relecteur, modèle, sha et verdict', () => {
  const r = parseReview(report());
  assert.equal(r.verdict, 'APPROUVÉ');
  assert.equal(r.reviewerModel, 'claude-sonnet-5-5');
  assert.equal(r.reviewedSha, 'abc1234');
});

test('CRITIQUE « non corrigé » ou en gras : échec ; modèle suffixé d’une date : même modèle', () => {
  const notFixed = '| 1 | **CRITIQUE** | fuite | a.ts:1 | non corrigé |';
  assert.match(run({ 'code-2026-10-31.md': report({ rows: notFixed }) })[0], /CRITIQUE non clos/);
  const dated = report({ who: 'Claude-Opus-5-5-20260101', family: '' });
  assert.match(run({ 'code-2026-10-31.md': dated })[0], /même modèle/);
});

test('--base : main par défaut, origin/main en CI, option déguisée refusée', () => {
  assert.equal(parseArgs(['US-001', '--require', 'code']).base, 'main');
  const ci = parseArgs(['US-002', '--require', 'code,architecture', '--base', 'origin/main']);
  assert.equal(ci.base, 'origin/main');
  assert.deepEqual(ci.required, ['code', 'architecture']);
  assert.equal(parseArgs(['US-001', '--base', '--output=x']).base, null);
});

test('alias revue-<rôle> : pas un auteur ; rôle inconnu ou absent : auteur', () => {
  const sonnet = 'Agent-Model: claude-sonnet-5-5\n\u0000';
  const log =
    'feat\n\nAgent-Role: design\nAgent-Model: claude-opus-5-5\n\u0000' +
    'docs(review)\n\nAgent-Role: revue-ux\n' +
    sonnet +
    'docs(review)\n\nAgent-Role: revue-architecture\n' +
    sonnet;
  assert.deepEqual(authorModelsFromLog(log, reportFiles), ['claude-opus-5-5']);
  assert.deepEqual(authorModelsFromLog('x\n\nAgent-Role: revue-design\n' + sonnet, reportFiles), [
    'claude-sonnet-5-5',
  ]);
  assert.deepEqual(authorModelsFromLog('x\n\n' + sonnet, reportFiles), ['claude-sonnet-5-5']);
});

// --- US-050 : revue périmée (diff <sha revu>..HEAD, fusions de main ignorées) ---

// Branche de story : a.ts modifié au sha revu X, puis rapport APPROUVÉ sur X.
function reviewedBranch() {
  const r = gitRepo();
  r.git('switch', '-q', '-c', 'story/US-001-x');
  const x = r.commit({ 'a.ts': 'a1\n' }, 'feat');
  r.commit({ [REPORT]: report({ sha: x }) }, 'docs(review)');
  return { ...r, x };
}

test('après le sha revu, seuls rapports, passation et chemins partagés : revue à jour', () => {
  const r = reviewedBranch();
  try {
    assert.equal(cli(r.root).status, 0, cli(r.root).err);
    r.commit({ 'docs/team/handoffs/US-001.md': 'passation\n', 'docs/team/BOARD.md': 'b\n' });
    r.commit({ 'docs/team/reviews/US-001/securite-2026-10-31.md': 'autre rapport\n' });
    assert.equal(cli(r.root, ['--exempt', 'docs/team/BOARD.md']).status, 0);
    // Sans --exempt, BOARD.md n'est pas un chemin libre : la revue est périmée.
    const strict = cli(r.root);
    assert.equal(strict.status, 1);
    assert.match(strict.err, /revue code périmée : docs\/team\/BOARD.md modifié après/);
  } finally {
    r.done();
  }
});

test('code modifié après le sha revu : revue périmée (renommage compris)', () => {
  const r = reviewedBranch();
  try {
    r.commit({ 'a.ts': 'a2\n' });
    const res = cli(r.root);
    assert.equal(res.status, 1);
    assert.ok(res.err.includes(`revue code périmée : a.ts modifié après ${r.x}`), res.err);
    // Une passation d'une autre story n'est pas libre non plus.
    r.git('reset', '-q', '--hard', 'HEAD~1');
    r.commit({ 'docs/team/handoffs/US-002.md': 'x\n' });
    assert.match(cli(r.root).err, /handoffs\/US-002.md modifié après/);
    // Renommage vers les rapports : le chemin de départ reste contrôlé.
    r.git('reset', '-q', '--hard', 'HEAD~1');
    r.git('mv', 'a.ts', 'docs/team/reviews/US-001/a.ts');
    r.git('commit', '-q', '-m', 'mv');
    assert.match(cli(r.root).err, /revue code périmée : a.ts modifié après/);
  } finally {
    r.done();
  }
});

test('fusion de main après la revue (fichiers de la base seulement) : pas périmée', () => {
  const r = reviewedBranch();
  try {
    r.git('switch', '-q', 'main');
    r.commit({ 'b.ts': 'b1\n', 'c.ts': 'c1\n' }, 'main avance');
    r.git('switch', '-q', 'story/US-001-x');
    r.git('merge', '-q', '--no-edit', 'main');
    const res = cli(r.root);
    assert.equal(res.status, 0, res.err);
  } finally {
    r.done();
  }
});

test('fusion de main qui annule un correctif de la base : périmée', () => {
  const r = reviewedBranch();
  try {
    r.git('switch', '-q', 'main');
    r.commit({ 'a.ts': 'correctif\n' }, 'correctif sur main');
    r.git('switch', '-q', 'story/US-001-x');
    // -s ours : la branche garde a.ts tel qu'au sha revu et annule le correctif de main.
    r.git('merge', '-q', '-s', 'ours', '--no-edit', 'main');
    const res = cli(r.root);
    assert.equal(res.status, 1);
    assert.match(res.err, /revue code périmée : a.ts modifié après .*la base a aussi changé/);
  } finally {
    r.done();
  }
});

test('rapport d’une PR déjà fusionnée réutilisé par une nouvelle PR : périmée', () => {
  const r = gitRepo();
  try {
    const x = r.commit({ 'a.ts': 'a1\n' }, 'PR 1');
    r.commit({ [REPORT]: report({ sha: x }) }, 'revue PR 1');
    r.git('switch', '-q', '-c', 'story/US-001-suite');
    r.commit({ 'b.ts': 'b1\n' }, 'PR 2');
    const res = cli(r.root);
    assert.equal(res.status, 1);
    assert.match(res.err, /revue code périmée : b.ts modifié après/);
    // Revenir sur l'état revu ne suffit pas : la base a changé a.ts depuis merge-base(base, X).
    r.git('reset', '-q', '--hard', 'HEAD~1');
    r.commit({ 'a.ts': 'a0\n' }, 'annule PR 1');
    assert.match(cli(r.root).err, /a.ts modifié après/);
  } finally {
    r.done();
  }
});

test('fraîcheur impossible à calculer : échec (fail-closed)', () => {
  const errors = run(
    { 'code-2026-10-31.md': report() },
    {
      isAncestor: () => true,
      staleFiles: () => {
        throw new Error('git');
      },
    },
  );
  assert.match(errors[0], /revue code périmée : \(diff git impossible à calculer\)/);
});

// --- US-050 : un commit de relecteur qui écrit du code compte comme auteur ---

test('commit d’un rôle de revue hors docs/team/reviews/ : son modèle compte comme auteur', () => {
  const log = 'fix\n\nAgent-Role: revue-code\nAgent-Model: claude-sonnet-5-5\n';
  assert.deepEqual(
    authorModelsFromLog(log, () => [REPORT, 'a.ts']),
    ['claude-sonnet-5-5'],
  );
  assert.deepEqual(
    authorModelsFromLog(log, () => []),
    ['claude-sonnet-5-5'],
  );
  assert.deepEqual(
    authorModelsFromLog(log, () => null),
    ['claude-sonnet-5-5'],
  );
  assert.deepEqual(authorModelsFromLog(log), ['claude-sonnet-5-5']);
  assert.deepEqual(
    authorModelsFromLog(log, () => [REPORT]),
    [],
  );
});

test('dépôt réel : relecteur qui modifie du code, puis rapport du même modèle : échec', () => {
  const r = gitRepo();
  try {
    r.git('switch', '-q', '-c', 'story/US-001-x');
    r.commit({ 'a.ts': 'a1\n' }, 'feat\n\nAgent-Role: back-end\nAgent-Model: claude-opus-5-5');
    const x = r.commit(
      { 'a.ts': 'a2\n', 'docs/team/reviews/US-001/notes.md': 'n\n' },
      'docs(review)\n\nAgent-Role: revue-code\nAgent-Model: claude-sonnet-5-5',
    );
    r.commit(
      { [REPORT]: report({ sha: x }) },
      'docs(review)\n\nAgent-Role: revue-code\nAgent-Model: claude-sonnet-5-5',
    );
    assert.deepEqual(authorModelsFromGit(r.root, 'main').sort(), [
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ]);
    const res = spawnSync(
      process.execPath,
      [SCRIPT, 'US-001', '--require', 'code', '--root', r.root],
      { encoding: 'utf8' },
    );
    assert.equal(res.status, 1);
    assert.match(res.stderr, /même modèle que l’auteur|même modèle que l'auteur/);
  } finally {
    r.done();
  }
});

test('chemin libre exact : docs/team/BOARD.md.bak n’est pas exempté (revue code 03e, constat 5)', () => {
  const stale = [
    { file: 'docs/team/BOARD.md' },
    { file: 'docs/team/BOARD.md.bak' },
    { file: 'docs/team/handoffs/US-001.md.bak' },
  ];
  const errors = run(
    { 'code-2026-10-31.md': report() },
    { isAncestor: () => true, staleFiles: () => stale, exempt: ['docs/team/BOARD.md'] },
  );
  assert.deepEqual(errors, [
    'revue code périmée : docs/team/BOARD.md.bak modifié après abc1234',
    'revue code périmée : docs/team/handoffs/US-001.md.bak modifié après abc1234',
  ]);
});
