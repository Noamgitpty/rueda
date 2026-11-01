// Tests du job « revues » (node --test scripts/ci/), contournements compris.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateBranch, requiredRoles, storiesFromBranch } from './check-story-reviews.mjs';

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
  assert.match(
    ev('story/US-015-money', ['packages/money/src/a.ts']).errors[0],
    /absent de pathOwners/,
  );
  // packages/dbx/ n'est pas packages/db/.
  assert.match(ev('story/US-005-x', ['packages/dbx/a.ts']).errors[0], /packages\/dbx\//);
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
  assert.deepEqual(requiredRoles('US-005', db, config), ['architecture', 'code']);
  assert.deepEqual(requiredRoles('US-002', ['packages/dbx/a.ts'], config), ['code']);
});

test('rôles propres à une story ajoutés au défaut', () => {
  assert.deepEqual(requiredRoles('US-001', [], config), ['architecture', 'code']);
});
