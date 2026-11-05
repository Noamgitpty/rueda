// US-003 (durcissement, ADR-084) : porte d'accord du fondateur (scripts/deploy/production-gate.mjs).
// Les documents sont écrits à la main au format de l'API GitHub (environnement, approbations d'un
// run) ; logins fictifs. node --test scripts/deploy/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkProductionGate } from './production-gate.mjs';

const CLI = fileURLToPath(new URL('./production-gate.mjs', import.meta.url));
const BOT = 'agent-bot';
const FOUNDER = 'fondateur';

const protectedEnv = (over = {}) => ({
  id: 1,
  name: 'production',
  protection_rules: [
    {
      id: 2,
      type: 'required_reviewers',
      prevent_self_review: true,
      reviewers: [{ type: 'User', reviewer: { login: FOUNDER, type: 'User' } }],
    },
  ],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  ...over,
});
const approval = (login, state = 'approved', env = 'production', type = 'User') => ({
  state,
  comment: '',
  environments: [{ id: 1, name: env }],
  user: { login, type },
});
const gate = (environment, approvals, actor = BOT, triggeringActor = BOT) =>
  checkProductionGate({
    environmentName: 'production',
    environment,
    approvals,
    actor,
    triggeringActor,
  });

test('environnement protégé et run approuvé par le fondateur : accepté', () => {
  assert.deepEqual(gate(protectedEnv(), [approval(FOUNDER)]), []);
});

test('environnement absent (ou autre environnement) : refusé', () => {
  assert.match(gate(null, [approval(FOUNDER)]).join(), /introuvable/);
  assert.match(
    gate(protectedEnv({ name: 'preproduction' }), [approval(FOUNDER)]).join(),
    /introuvable/,
  );
});

test('environnement créé sans protection par le premier run : refusé', () => {
  const errors = gate(protectedEnv({ protection_rules: [], deployment_branch_policy: null }), []);
  assert.match(errors.join(), /aucun approbateur/);
  assert.match(errors.join(), /toutes les branches/);
  assert.match(errors.join(), /aucune approbation/);
});

test('règle sans approbateur, ou seulement un délai d’attente : refusé', () => {
  for (const rules of [
    [{ id: 2, type: 'required_reviewers', reviewers: [] }],
    [{ id: 3, type: 'wait_timer', wait_timer: 5 }],
  ]) {
    assert.match(
      gate(protectedEnv({ protection_rules: rules }), [approval(FOUNDER)]).join(),
      /aucun approbateur/,
    );
  }
});

test('toutes les branches permises : refusé', () => {
  assert.match(
    gate(protectedEnv({ deployment_branch_policy: null }), [approval(FOUNDER)]).join(),
    /toutes les branches/,
  );
});

test('aucune approbation sur ce run : refusé', () => {
  assert.match(gate(protectedEnv(), []).join(), /aucune approbation/);
  assert.match(
    gate(protectedEnv(), [approval(FOUNDER, 'approved', 'preproduction')]).join(),
    /aucune approbation/,
  );
});

test('auto-approbation par le compte qui a lancé le run (ou relancé) : refusée', () => {
  assert.match(gate(protectedEnv(), [approval(BOT)]).join(), /aucune approbation/);
  assert.match(
    gate(protectedEnv(), [approval('relanceur')], FOUNDER, 'relanceur').join(),
    /aucune approbation/,
  );
  assert.match(
    gate(protectedEnv(), [approval(FOUNDER)], FOUNDER, FOUNDER).join(),
    /aucune approbation/,
  );
});

test('approbation par un bot : refusée', () => {
  assert.match(
    gate(protectedEnv(), [approval('github-actions[bot]', 'approved', 'production', 'Bot')]).join(),
    /aucune approbation/,
  );
});

test('refus enregistré pour production : refusé même avec une approbation', () => {
  assert.match(
    gate(protectedEnv(), [approval(FOUNDER), approval('autre', 'rejected')]).join(),
    /refus/,
  );
});

test('acteur inconnu : refusé (fail-closed)', () => {
  assert.match(gate(protectedEnv(), [approval(FOUNDER)], '', '').join(), /acteur du run inconnu/);
});

test('entrées malformées : refus, jamais d’exception', () => {
  for (const [env, approvals] of [
    [{}, {}],
    [protectedEnv({ protection_rules: 'x' }), 'x'],
    [
      protectedEnv(),
      [
        null,
        { state: 'approved' },
        { environments: 'production', state: 'approved', user: { login: FOUNDER } },
      ],
    ],
  ]) {
    assert.notDeepEqual(gate(env, approvals), []);
  }
  assert.deepEqual(
    checkProductionGate({
      environmentName: '',
      environment: protectedEnv(),
      approvals: [approval(FOUNDER)],
      actor: BOT,
    }),
    ['environnement visé absent'],
  );
});

test('CLI : code 0 si accord vérifié, 1 sinon ou si une réponse est illisible', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rueda-gate-'));
  try {
    const env = join(dir, 'environment.json');
    const ok = join(dir, 'ok.json');
    const none = join(dir, 'none.json');
    const bad = join(dir, 'bad.json');
    writeFileSync(env, JSON.stringify(protectedEnv()));
    writeFileSync(ok, JSON.stringify([approval(FOUNDER)]));
    writeFileSync(none, '[]');
    writeFileSync(bad, '<html>');
    const run = (approvals) =>
      spawnSync(
        process.execPath,
        [
          CLI,
          '--environment',
          'production',
          '--environment-json',
          env,
          '--approvals-json',
          approvals,
          '--actor',
          BOT,
          '--triggering-actor',
          BOT,
        ],
        { encoding: 'utf8' },
      );
    assert.equal(run(ok).status, 0);
    const refused = run(none);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /::error title=porte de production::/);
    assert.equal(run(bad).status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
