// US-051, ADR-082 : les exercices exécutent les runbooks TELS QU'ÉCRITS. Ces tests vérifient
// l'extraction des blocs et que chaque étape appelée par un exercice existe, une seule fois, dans
// son runbook (un bloc renommé ou supprimé ferait échouer l'exercice ; ici, dès les unitaires).
// node --test scripts/ops/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, runbookBlocks } from './runbook.mjs';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('extraction : blocs indentés, ordre conservé, autres blocs ignorés', () => {
  const md = [
    'texte',
    '```bash a',
    'echo 1',
    '```',
    '1. étape',
    '',
    '   ```bash a',
    '   echo "2" \\',
    '     suite',
    '   ```',
    '```bash b',
    'echo 3',
    '```',
  ].join('\r\n');
  assert.deepEqual(runbookBlocks(md, 'a'), ['echo 1', 'echo "2" \\\n  suite']);
  assert.deepEqual(runbookBlocks(md, 'b'), ['echo 3']);
  assert.deepEqual(runbookBlocks(md, 'c'), []);
  assert.throws(() => runbookBlocks('```bash a\necho', 'a'), /non fermé/);
  assert.throws(() => runbookBlocks(md, 'A;rm'), /étape invalide/);
});

/** Étapes appelées par un exercice, extraites de son code (jamais recopiées ici). */
function stepsCalled(file, pattern) {
  return [...read(file).matchAll(pattern)].map((m) => m[1]);
}

test('restauration : chaque étape appelée par l’exercice existe une fois dans BACKUP_RESTORE.md', () => {
  const md = read('docs/ops/BACKUP_RESTORE.md');
  const steps = stepsCalled(
    'packages/db/test/drill/restore-drill.test.ts',
    /runbook\('([a-z-]+)'/g,
  );
  const inner = stepsCalled(
    'packages/db/test/drill/restore-drill.test.ts',
    /runbook\(\s*'([a-z-]+)'/g,
  );
  const all = new Set([...steps, ...inner]);
  assert.deepEqual([...all].sort(), [
    'exercice-bascule',
    'exercice-restauration',
    'exercice-sauvegarde',
    'exercice-verification',
  ]);
  for (const s of all) assert.equal(runbookBlocks(md, s).length, 1, s);
});

test('rotation : chaque étape appelée par la répétition existe une fois dans SECRET_ROTATION.md', () => {
  const md = read('docs/ops/SECRET_ROTATION.md');
  const steps = new Set(stepsCalled('scripts/ops/rotation-drill.sh', /^step ([a-z-]+)$/gm));
  assert.ok(steps.size >= 10, `${steps.size} étapes`);
  for (const s of steps) assert.equal(runbookBlocks(md, s).length, 1, s);
  // tout bloc « rotation-* » du runbook est joué par la répétition
  const declared = [...md.matchAll(/^\s*```bash (rotation-[a-z-]+)\s*$/gm)].map((m) => m[1]);
  assert.deepEqual([...new Set(declared)].sort(), [...steps].sort());
});

test('aucune valeur secrète écrite dans les runbooks ni dans les scripts d’exercice', () => {
  for (const f of [
    'docs/ops/BACKUP_RESTORE.md',
    'docs/ops/SECRET_ROTATION.md',
    'scripts/ops/restore-drill.sh',
    'scripts/ops/rotation-drill.sh',
    'infra/local/rotate-secrets.sh',
  ]) {
    const text = read(f);
    assert.doesNotMatch(text, /[0-9a-f]{40,}/i, `${f} : longue valeur hexadécimale`);
    assert.doesNotMatch(text, /PASSWORD=[^"$\s\\]/, `${f} : mot de passe en clair`);
  }
});
