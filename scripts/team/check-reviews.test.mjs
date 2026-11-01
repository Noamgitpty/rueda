// Tests du contrôle des revues (node --test scripts/team/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorModelsFromLog, checkReviews, parseReview } from './check-reviews.mjs';

function repoWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'reviews-'));
  const dir = join(root, 'docs', 'team', 'reviews', 'US-001');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return root;
}

const AUTHOR = ['claude-opus-5-5'];
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
  assert.deepEqual(authorModelsFromLog(log), ['claude-opus-5-5']);
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
