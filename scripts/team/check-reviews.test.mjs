// Tests du contrôle des revues (node --test scripts/team/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkReviews, parseReview } from './check-reviews.mjs';

function repoWith(files) {
  const root = mkdtempSync(join(tmpdir(), 'reviews-'));
  const dir = join(root, 'docs', 'team', 'reviews', 'US-001');
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return root;
}

const ok = (who) => `# Revue code — US-001\nRelecteur : revue-code / ${who} (famille A)\n\nVerdict : APPROUVÉ\n`;

test('rapport absent : échec', () => {
  const errors = checkReviews({ story: 'US-001', required: ['code'], authorModels: [], root: repoWith({}) });
  assert.match(errors[0], /absent/);
});

test('rapport approuvé par un autre modèle : succès', () => {
  const root = repoWith({ 'code-2026-10-31.md': ok('claude-sonnet-5-5') });
  assert.deepEqual(checkReviews({ story: 'US-001', required: ['code'], authorModels: ['claude-opus-5-5'], root }), []);
});

test('relecteur = modèle de l’auteur : échec', () => {
  const root = repoWith({ 'code-2026-10-31.md': ok('claude-opus-5-5') });
  const errors = checkReviews({ story: 'US-001', required: ['code'], authorModels: ['claude-opus-5-5'], root });
  assert.match(errors[0], /même modèle/);
});

test('changements demandés : échec ; le dernier rapport fait foi', () => {
  const bad = ok('claude-sonnet-5-5').replace('APPROUVÉ', 'CHANGEMENTS DEMANDÉS');
  let root = repoWith({ 'code-2026-10-31.md': bad });
  assert.equal(checkReviews({ story: 'US-001', required: ['code'], authorModels: [], root }).length, 1);
  root = repoWith({ 'code-2026-10-30.md': bad, 'code-2026-10-31.md': ok('claude-sonnet-5-5') });
  assert.deepEqual(checkReviews({ story: 'US-001', required: ['code'], authorModels: [], root }), []);
});

test('revue argent sans famille B ni mention « revue dégradée » : échec', () => {
  const root = repoWith({ 'argent-2026-10-31.md': ok('claude-sonnet-5-5').replace('(famille A)', '') });
  const errors = checkReviews({ story: 'US-001', required: ['argent'], authorModels: [], root });
  assert.match(errors[0], /famille B/);
  const root2 = repoWith({ 'argent-2026-10-31.md': ok('claude-sonnet-5-5').replace('(famille A)', '(famille A, revue dégradée)') });
  assert.deepEqual(checkReviews({ story: 'US-001', required: ['argent'], authorModels: [], root: root2 }), []);
});

test('parseReview lit relecteur et verdict', () => {
  const r = parseReview(ok('claude-sonnet-5-5'));
  assert.equal(r.verdict, 'APPROUVÉ');
  assert.match(r.reviewer, /sonnet/);
});
