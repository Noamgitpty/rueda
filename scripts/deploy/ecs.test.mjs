// US-003 (durcissement, ADR-084) : `scripts/deploy/ecs.sh deploy` journalise `DEPLOY FAILED`
// quand le job de base ne tourne pas, et ne bascule rien. node --test scripts/deploy/.
//
// Sans compte : `aws` et `jq` sont des doubles écrits ici (bash), placés en tête du PATH ; le
// journal passe par le vrai scripts/deploy/journal.mjs (validation des lignes comprise). Le double
// d'`aws` note chaque appel et recopie les objets « déposés » dans le compartiment des preuves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
// bash POSIX : celui du PATH (Linux, CI qui fait foi) ; sous Windows, celui de Git (jamais WSL).
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const BASH = process.platform === 'win32' ? (existsSync(GIT_BASH) ? GIT_BASH : null) : 'bash';
const DIGEST = `sha256:${'a'.repeat(64)}`;

const FAKE_AWS = String.raw`#!/usr/bin/env bash
here="$(cd "$(dirname "$0")" && pwd)"
printf '%s\n' "$*" >>"$here/calls.log"
case "$1 $2" in
  's3 cp')
    if [ "$3" = --recursive ]; then exit 0; fi
    cat >>"$here/evidence.jsonl"
    ;;
  'ecr describe-images')
    case "$*" in *imageTags*) echo 'abc123def456' ;; esac
    ;;
  'ecs describe-task-definition') echo '{}' ;;
  'ecs register-task-definition') echo 'arn:aws:ecs:us-east-1:111111111111:task-definition/rueda-preproduction-x:1' ;;
  'ecs run-task')
    case "$(cat "$here/run-task.mode")" in
      none) echo 'None' ;;
      error) echo 'An error occurred (InvalidParameterException)' >&2; exit 254 ;;
      exit1) echo 'arn:aws:ecs:us-east-1:111111111111:task/rueda-preproduction/0123456789abcdef' ;;
    esac
    ;;
  'ecs wait') exit 0 ;;
  'ecs describe-tasks') echo '1' ;;
  *) echo "appel inattendu : $*" >&2; exit 97 ;;
esac
`;
const FAKE_JQ = `#!/usr/bin/env bash
cat >/dev/null
echo '{}'
`;

// Lance `ecs.sh deploy` avec le double d'aws réglé sur `mode` ; rend { status, stderr, calls, evidence }.
function deploy(mode) {
  const dir = mkdtempSync(join(tmpdir(), 'rueda-ecs-'));
  try {
    writeFileSync(join(dir, 'aws'), FAKE_AWS);
    writeFileSync(join(dir, 'jq'), FAKE_JQ);
    chmodSync(join(dir, 'aws'), 0o755);
    chmodSync(join(dir, 'jq'), 0o755);
    writeFileSync(join(dir, 'run-task.mode'), mode);
    // variables posées DANS bash (chemins POSIX sous Git Bash) ; aucune n'est un identifiant réel
    const script = [
      'set -eu',
      'bin="$(cd "$1" && pwd)"; root="$(cd "$2" && pwd)"',
      'export PATH="$bin:$PATH"',
      'export RUNNER_TEMP="$(mktemp -d)"',
      'export RUEDA_ENVIRONMENT=preproduction RUEDA_AWS_REGION=us-east-1 RUEDA_CLUSTER=rueda-preproduction',
      'export RUEDA_REPOSITORY_URL=111111111111.dkr.ecr.us-east-1.amazonaws.com/rueda/api',
      'export RUEDA_SUBNETS=subnet-0 RUEDA_APP_SECURITY_GROUP=sg-0 RUEDA_EVIDENCE_BUCKET=rueda-preuves',
      'exec bash "$root/scripts/deploy/ecs.sh" deploy "$3"',
    ].join('\n');
    const r = spawnSync(BASH, ['-c', script, 'ecs-test', dir, ROOT, DIGEST], { encoding: 'utf8' });
    const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
    return {
      status: r.status,
      stderr: r.stderr,
      calls: read('calls.log'),
      evidence: read('evidence.jsonl')
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l)),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const skip = BASH === null && 'bash POSIX introuvable (Git pour Windows) : la CI Linux fait foi';

for (const [mode, reason] of [
  ['none', /job de base non lancé \(run-task : aucune tâche\)/],
  ['error', /job de base non lancé \(run-task : aucune tâche\)/],
  ['exit1', /job de base en échec/],
]) {
  test(
    `run-task « ${mode} » : DEPLOY FAILED journalisé, aucune bascule, sortie en 1`,
    { skip },
    () => {
      const r = deploy(mode);
      assert.equal(r.status, 1, r.stderr);
      assert.deepEqual(
        r.evidence.map((e) => `${e.action} ${e.outcome}`),
        ['DEPLOY STARTED', 'DEPLOY FAILED'],
        `journal : ${JSON.stringify(r.evidence)}\n${r.stderr}`,
      );
      const failed = r.evidence[1];
      assert.equal(failed.image, DIGEST);
      assert.equal(failed.environment, 'preproduction');
      assert.match(failed.reason, reason);
      assert.match(failed.reason, /version servie inchangée/);
      assert.match(r.stderr, /::error title=déploiement::/);
      assert.doesNotMatch(r.calls, /update-service/, 'aucune bascule des services');
    },
  );
}
