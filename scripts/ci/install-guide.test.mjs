// US-035, ADR-070 : invariants de la pile de développement local et du guide prouvé en CI.
// Lecture textuelle (pas d'analyseur YAML : aucune dépendance). node --test scripts/ci/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const compose = read('compose.yaml');
const guide = read('docs/ops/INSTALL.md');
const envExample = read('.env.example');

/** Blocs ```bash guide du guide, dans l'ordre (même extraction que run-install-guide.sh). */
export function guideBlocks(markdown) {
  const blocks = [];
  let current = null;
  for (const line of markdown.split('\n')) {
    if (current === null && /^```bash guide\s*$/.test(line)) current = [];
    else if (current !== null && line.startsWith('```')) {
      blocks.push(current.join('\n'));
      current = null;
    } else if (current !== null) current.push(line);
  }
  return blocks;
}

test('le guide démarre la pile, la vérifie, lance les tests et remet les rôles en état', () => {
  const steps = guideBlocks(guide).join('\n');
  const order = [
    'docker compose up --build -d',
    'bash scripts/dev/smoke.sh',
    'docker compose stop worker api',
    'docker compose --profile tests run --rm tests',
    'docker compose run --rm db-setup',
    'docker compose start api worker',
    'bash scripts/dev/smoke.sh',
  ];
  let at = -1;
  for (const step of order) {
    const i = steps.indexOf(step, at + 1);
    assert.ok(i > at, `étape absente ou dans le désordre : ${step}`);
    at = i;
  }
});

test('ports publiés sur 127.0.0.1 seulement', () => {
  const published = [...compose.matchAll(/^\s*- '([^']*:\d+)'\s*$/gm)].map((m) => m[1]);
  assert.ok(published.length >= 2);
  for (const p of published) assert.match(p, /^127\.0\.0\.1:/, p);
});

test('aucun secret en clair dans compose.yaml ni .env.example', () => {
  // seules formes admises : un chemin de fichier de secret, jamais une valeur
  for (const m of compose.matchAll(/^\s*(\w*(?:PASSWORD|SECRET|TOKEN|KEY)\w*)\s*:\s*(.*)$/gim)) {
    assert.match(m[2], /^\/run\/rueda-secrets(\/[a-z_]+\/password)?$/, `${m[1]} : ${m[2]}`);
  }
  assert.doesNotMatch(compose, /POSTGRES_PASSWORD\s*:/);
  assert.doesNotMatch(compose, /postgres(ql)?:\/\/[^@\s]*:[^@\s]*@/);
  for (const line of envExample.split('\n').filter((l) => /^\w+=/.test(l))) {
    assert.match(line, /^RUEDA_DEV_\w*PORT=\d+$/, `.env.example : ${line}`);
  }
});

test('chaque service Node de la pile pose RUEDA_ENV=development, jamais production', () => {
  assert.doesNotMatch(compose, /RUEDA_ENV:\s*'?(production|preproduction)/);
  for (const service of ['db-setup', 'api', 'worker', 'fakes']) {
    const block = compose.split(/\n {2}(?=[a-z-]+:\n)/).find((b) => b.startsWith(`${service}:`));
    assert.ok(block, `service ${service} absent`);
    assert.match(block, /RUEDA_ENV: development/, `${service} sans RUEDA_ENV=development`);
  }
  assert.match(read('docker/dev/Dockerfile'), /^ENV RUEDA_ENV=development$/m);
});

test('l’API et le travailleur ne montent que le secret de leur rôle', () => {
  const blockOf = (service) =>
    compose.split(/\n {2}(?=[a-z-]+:\n)/).find((b) => b.startsWith(`${service}:`)) ?? '';
  for (const [service, role] of [
    ['api', 'app-api'],
    ['worker', 'app-worker'],
  ]) {
    const secrets = [...blockOf(service).matchAll(/secret-([a-z-]+):/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(secrets)], [role], service);
  }
});
