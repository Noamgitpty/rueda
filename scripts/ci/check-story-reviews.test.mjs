// Tests du job « revues » (node --test scripts/ci/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requiredRoles, storiesFromBranch } from './check-story-reviews.mjs';

const config = JSON.parse(
  readFileSync(new URL('../../docs/team/review-requirements.json', import.meta.url), 'utf8'),
);

test('stories déduites du nom de branche', () => {
  assert.deepEqual(storiesFromBranch('story/US-002-integration-continue'), ['US-002']);
  assert.deepEqual(storiesFromBranch('story/US-001-US-029-integration'), ['US-001', 'US-029']);
  assert.deepEqual(storiesFromBranch('story/US-005'), ['US-005']);
  assert.deepEqual(storiesFromBranch('docs/team-sante'), []);
  assert.deepEqual(storiesFromBranch('feature/US-002-x'), []);
  assert.deepEqual(storiesFromBranch('story/US-02-x'), []);
});

test('défaut : code seul', () => {
  assert.deepEqual(requiredRoles('US-002', ['README.md', '.github/workflows/ci.yml'], config), [
    'code',
  ]);
});

test('graphe des dépendances ou packages/db touchés : + architecture', () => {
  const graph = ['apps/api/src/modules/dependency-graph.ts'];
  assert.deepEqual(requiredRoles('US-002', graph, config), ['architecture', 'code']);
  const db = ['packages/db/migrations/0001.sql'];
  assert.deepEqual(requiredRoles('US-002', db, config), ['architecture', 'code']);
  // Un fichier voisin ne déclenche pas la règle.
  assert.deepEqual(requiredRoles('US-002', ['packages/dbx/a.ts'], config), ['code']);
});

test('rôles propres à une story ajoutés au défaut', () => {
  assert.deepEqual(requiredRoles('US-001', [], config), ['architecture', 'code']);
});
