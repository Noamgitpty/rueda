// US-003 : journal des déploiements (scripts/deploy/journal.mjs). node --test scripts/deploy/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  checkPromotion,
  currentImage,
  parseJournal,
  previousImage,
  validateEntry,
} from './journal.mjs';

const CLI = fileURLToPath(new URL('./journal.mjs', import.meta.url));
const img = (c) => `sha256:${c.repeat(64)}`;
const A = img('a');
const B = img('b');
const D = img('d');
const E = 'preproduction';
const at = '2026-11-04T00:00:00.000Z';
const entry = (action, image, outcome = 'SUCCEEDED', environment = E) => ({
  at,
  environment,
  action,
  release: 'r1',
  image,
  outcome,
});

test('image immuable exigée : une étiquette mobile est refusée', () => {
  assert.deepEqual(validateEntry(entry('DEPLOY', A)), []);
  assert.deepEqual(
    validateEntry(entry('DEPLOY', `123.dkr.ecr.us-east-1.amazonaws.com/rueda@${A}`)),
    [],
  );
  for (const bad of ['rueda:latest', 'rueda:1.0', 'sha256:abc', `${A}x`]) {
    assert.match(validateEntry(entry('DEPLOY', bad)).join(), /image non immuable/, bad);
  }
  assert.match(validateEntry({ ...entry('DEPLOY', A), action: 'DROP' }).join(), /action/);
  assert.match(validateEntry({ ...entry('DEPLOY', A), reason: 'a\nb' }).join(), /reason/);
});

test('version courante et cible du retour arrière ; un échec ne compte pas comme servi', () => {
  const j = [
    entry('DEPLOY', A, 'STARTED'),
    entry('DEPLOY', A),
    entry('DEPLOY', D, 'STARTED'),
    entry('DEPLOY', D, 'FAILED'),
    entry('ROLLBACK', A), // retour arrière automatique
  ];
  assert.equal(currentImage(j, E).image, A);
  assert.equal(previousImage(j, E), null);
  j.push(entry('DEPLOY', B));
  assert.equal(currentImage(j, E).image, B);
  assert.equal(previousImage(j, E).image, A);
  j.push(entry('ROLLBACK', A)); // retour arrière manuel
  assert.equal(currentImage(j, E).image, A);
  assert.equal(previousImage(j, E), null, 'B a été retirée : rien sous A');
  assert.equal(currentImage(j, 'production'), null);
});

test('porte « préproduction d’abord » : seule une image déployée avec succès en préproduction est promue', () => {
  const j = [entry('DEPLOY', A), entry('DEPLOY', D, 'FAILED'), entry('ROLLBACK', B)];
  assert.equal(checkPromotion(j, A, E), true);
  assert.equal(checkPromotion(j, D, E), false);
  assert.equal(checkPromotion(j, B, E), false, 'un retour arrière n’est pas une promotion');
  assert.equal(checkPromotion(j, A, 'autre'), false);
});

test('journal illisible ou altéré : refusé', () => {
  assert.throws(() => parseJournal('{'), /ligne 1 illisible/);
  assert.throws(() => parseJournal(JSON.stringify({ ...entry('DEPLOY', 'x:y') })), /ligne 1/);
});

test('CLI : record, current, previous, check-promotion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'journal-'));
  const file = join(dir, 'sub', 'deployments.jsonl');
  const run = (...args) =>
    spawnSync(process.execPath, [CLI, ...args, '--journal', file], { encoding: 'utf8' });
  try {
    const rec = (action, image, outcome) =>
      run(
        'record',
        '--environment',
        E,
        '--action',
        action,
        '--outcome',
        outcome,
        '--release',
        'r1',
        '--image',
        image,
      );
    assert.equal(rec('DEPLOY', A, 'SUCCEEDED').status, 0);
    assert.equal(rec('DEPLOY', B, 'SUCCEEDED').status, 0);
    assert.equal(rec('DEPLOY', 'rueda:latest', 'SUCCEEDED').status, 1);
    assert.equal(run('current', '--environment', E).stdout.trim(), `${B} r1`);
    assert.equal(run('previous', '--environment', E).stdout.trim(), `${A} r1`);
    assert.equal(run('previous', '--environment', 'production').status, 3);
    assert.equal(run('check-promotion', '--image', A, '--from-environment', E).status, 0);
    assert.equal(run('check-promotion', '--image', D, '--from-environment', E).status, 4);
    assert.equal(parseJournal(readFileSync(file, 'utf8')).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
