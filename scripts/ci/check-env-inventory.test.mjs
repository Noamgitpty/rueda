// Tests du contrôle « inventaire des variables d'environnement » (US-037 ; node --test scripts/ci/).
// Les noms `ZZ_*` et `RUEDA_ZZ_*` sont fictifs : ce fichier est exclu du balayage du dépôt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  scanFile,
  parseInventory,
  covers,
  checkInventory,
  listTrackedFiles,
  DEFAULT_INVENTORY,
} from './check-env-inventory.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./check-env-inventory.mjs', import.meta.url));
const REAL_INVENTORY = readFileSync(join(ROOT, DEFAULT_INVENTORY), 'utf8');
const names = (file, text) => [...new Set(scanFile(file, text).map((r) => r.name))].sort();
const inv = (...n) => n.map((x) => `| \`${x}\` | usage |`).join('\n');

// --- détection par source -------------------------------------------------------------------

test('TS : process.env.X, process.env["X"], env?.X, env[CONST], déstructuration, env: {…}, littéral RUEDA_', () => {
  const ts = [
    'const a = process.env.ZZ_DOT;',
    "const b = process.env['ZZ_BRACKET'];",
    'const c = env?.ZZ_OPTIONAL;',
    "const FLAG = 'ZZ_CONST';",
    'const d = env[FLAG];',
    'const { ZZ_DESTR, ZZ_DESTR2: renamed } = process.env;',
    "const e = benchEnv['ZZ_SUFFIX'];",
    "export default { test: { env: { ZZ_VITEST: 'test' } } };",
    "const NAMES = ['RUEDA_ZZ_TABLE'];",
  ].join('\n');
  assert.deepEqual(names('apps/api/src/x.ts', ts), [
    'RUEDA_ZZ_TABLE',
    'ZZ_BRACKET',
    'ZZ_CONST',
    'ZZ_DESTR',
    'ZZ_DESTR2',
    'ZZ_DOT',
    'ZZ_OPTIONAL',
    'ZZ_SUFFIX',
    'ZZ_VITEST',
  ]);
});

test('TS : un objet qui ne s’appelle pas env, et les minuscules, ne comptent pas', () => {
  const ts = "const a = config.ZZ_NOT_ENV; const b = row['ZZ_ROW']; const c = process.env.lower;";
  assert.deepEqual(names('apps/api/src/x.ts', ts), []);
});

test('TS : numéro de ligne exact', () => {
  const [hit] = scanFile('a.mjs', '\n\nconst x = process.env.ZZ_LINE;\n');
  assert.equal(hit.line, 3);
  assert.equal(hit.file, 'a.mjs');
});

test('shell : lues non affectées, export, -e de docker, RUEDA_ ; locales et internes ignorées', () => {
  const sh = [
    '#!/usr/bin/env bash',
    'ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
    'TIMEOUT_S="${ZZ_TIMEOUT:-300}"',
    'echo "$ROOT $TIMEOUT_S $ZZ_READ $1 $PWD"',
    'export ZZ_EXPORTED="x"',
    'docker run -e ZZ_DOCKER=1 --env ZZ_DOCKER2 img',
    'RUEDA_ZZ_ASSIGNED=1',
    'for V in a b; do echo "$V"; done',
  ].join('\n');
  assert.deepEqual(names('scripts/x.sh', sh), [
    'RUEDA_ZZ_ASSIGNED',
    'ZZ_DOCKER',
    'ZZ_DOCKER2',
    'ZZ_EXPORTED',
    'ZZ_READ',
    'ZZ_TIMEOUT',
  ]);
});

test('compose : interpolation, clés MAJUSCULES, X="$$(…)" ; $$ n’est pas une interpolation', () => {
  const yaml = [
    'services:',
    '  api:',
    '    image: ${ZZ_IMAGE:?obligatoire}',
    "    command: ['sh', '-c', 'ZZ_SECRET=\"$$(cat /run/x)\" exec node; echo $${ZZ_SHELL_ONLY}']",
    '    environment:',
    '      ZZ_KEY: valeur',
    "    ports: ['127.0.0.1:${ZZ_PORT:-3000}:3000']",
  ].join('\n');
  assert.deepEqual(names('infra/local/compose.yaml', yaml), [
    'ZZ_IMAGE',
    'ZZ_KEY',
    'ZZ_PORT',
    'ZZ_SECRET',
  ]);
});

test('workflow : vars, secrets, env et clés des blocs env: (tous niveaux)', () => {
  const yml = [
    'env:',
    "  ZZ_GLOBAL: '1'",
    'jobs:',
    '  a:',
    '    env:',
    '      ZZ_JOB: ${{ vars.ZZ_VAR }}',
    '    steps:',
    '      - run: echo',
    '        env:',
    '          ZZ_STEP: ${{ secrets.ZZ_SECRET }}',
    '        with:',
    '          not_env: ${{ env.ZZ_ENV_EXPR }}',
  ].join('\n');
  assert.deepEqual(names('.github/workflows/x.yml', yml), [
    'ZZ_ENV_EXPR',
    'ZZ_GLOBAL',
    'ZZ_JOB',
    'ZZ_SECRET',
    'ZZ_STEP',
    'ZZ_VAR',
  ]);
});

test('IaC : name = "X" des définitions de tâche et littéraux "RUEDA_…" ; FARGATE ignoré', () => {
  const tf = [
    '{ name = "ZZ_TASK", value = "1" },',
    'secrets = { k = "RUEDA_ZZ_VAULT" }',
    'launch_type = "FARGATE"',
  ].join('\n');
  assert.deepEqual(names('infra/opentofu/modules/x/service.tf', tf), ['RUEDA_ZZ_VAULT', 'ZZ_TASK']);
});

test('Dockerfile (ENV sur plusieurs lignes), turbo.json, .env.example', () => {
  assert.deepEqual(
    names(
      'docker/prod/Dockerfile',
      'FROM x\nENV ZZ_A=1 \\\n    ZZ_B=2\nENV ZZ_LEGACY valeur\nARG ZZ_ARG=1\n',
    ),
    ['ZZ_A', 'ZZ_B', 'ZZ_LEGACY'],
  );
  assert.deepEqual(names('turbo.json', '{"tasks":{"t":{"passThroughEnv":["ZZ_*","ZZ_T"]}}}'), [
    'ZZ_*',
    'ZZ_T',
  ]);
  assert.deepEqual(names('apps/web/.env.example', '# commentaire\nZZ_DOT_ENV=\n'), ['ZZ_DOT_ENV']);
});

test('exclusions : docs, *.md et le contrôle lui-même ne sont pas balayés', () => {
  assert.deepEqual(names('docs/ops/x.ts', 'process.env.ZZ'), []);
  assert.deepEqual(names('README.md', 'process.env.ZZ'), []);
  assert.deepEqual(names('scripts/ci/check-env-inventory.test.mjs', 'process.env.ZZ'), []);
  assert.deepEqual(names('assets/logo.svg', 'process.env.ZZ'), []);
});

// --- inventaire ------------------------------------------------------------------------------

test('inventaire : première colonne seulement, plusieurs noms par cellule, familles PREFIXE_*', () => {
  const md = [
    '| Variable | Usage |',
    '| --- | --- |',
    '| `ZZ_A`, `ZZ_B` | lit `ZZ_NOT_FIRST_COLUMN` |',
    '| `ZZ_FAM_*` | famille |',
  ].join('\n');
  const set = parseInventory(md);
  assert.deepEqual([...set].sort(), ['ZZ_A', 'ZZ_B', 'ZZ_FAM_*']);
  assert.ok(covers(set, 'ZZ_FAM_X'));
  assert.ok(covers(set, 'ZZ_FAM_*'));
  assert.ok(!covers(set, 'ZZ_NOT_FIRST_COLUMN'));
  assert.ok(!covers(set, 'ZZ_FA'));
});

test('échec volontaire : une lecture absente de l’inventaire fait échouer, avec fichier:ligne', () => {
  const files = { 'apps/api/src/a.ts': 'process.env.ZZ_KNOWN;\nprocess.env.ZZ_FORGOTTEN;\n' };
  const r = checkInventory({
    files: Object.keys(files),
    read: (f) => files[f],
    inventoryText: inv('ZZ_KNOWN'),
  });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^ZZ_FORGOTTEN absente de l'inventaire \(apps\/api\/src\/a\.ts:2\)$/);
  const ok = checkInventory({
    files: Object.keys(files),
    read: (f) => files[f],
    inventoryText: inv('ZZ_KNOWN', 'ZZ_FORGOTTEN'),
  });
  assert.deepEqual(ok.errors, []);
});

test('fail-closed : inventaire vide, ou balayage qui ne trouve rien', () => {
  const files = { 'a.ts': 'process.env.ZZ;' };
  const read = (f) => files[f];
  assert.match(
    checkInventory({ files: ['a.ts'], read, inventoryText: '' }).errors[0],
    /inventaire vide/,
  );
  assert.match(
    checkInventory({ files: ['README.md'], read: () => 'x', inventoryText: inv('ZZ') }).errors[0],
    /balayage à vide/,
  );
});

// --- dépôt réel : ni à vide, ni aveugle ------------------------------------------------------

const realFiles = listTrackedFiles(ROOT).filter((f) => f !== DEFAULT_INVENTORY);
const real = checkInventory({ root: ROOT, files: realFiles, inventoryText: REAL_INVENTORY });

test('dépôt réel : toutes les variables lues sont inventoriées', () => {
  assert.deepEqual(real.errors, []);
});

test('dépôt réel : le balayage n’est pas à vide (toutes les sources contribuent)', () => {
  const distinct = new Set(real.reads.map((r) => r.name));
  assert.ok(distinct.size >= 80, `seulement ${distinct.size} variables trouvées`);
  const kinds = new Set(real.reads.map((r) => r.kind));
  for (const k of ['js', 'sh', 'workflow', 'compose', 'tofu', 'dockerfile', 'turbo', 'dotenv']) {
    assert.ok(kinds.has(k), `aucune lecture de type ${k}`);
  }
  // lectures connues, une par source (si l'une disparaît, le balayage a perdu une source)
  const at = (name, file) =>
    assert.ok(
      real.reads.some((r) => r.name === name && r.file === file),
      `${name} non trouvée dans ${file}`,
    );
  at('RUEDA_RATE_LIMIT_KEY', 'apps/api/src/modules/risk/internal/production.ts');
  at('RUEDA_API_TRUST_PROXY', 'apps/api/src/main.ts');
  at('WEB_LAB_PWA_IOS_ENABLED', 'apps/web/app/lab/pwa-ios/lab-flag.ts');
  at('RUEDA_DB_MIGRATOR_PASSWORD', 'packages/db/src/deploy/setup.ts');
  at('PGHOST', 'infra/opentofu/modules/environment/service.tf');
  at('RUEDA_STAFF_MFA_PROOF_KEY', 'infra/opentofu/modules/environment/secrets.tf');
  at('RUEDA_DEPLOY_ROLE_ARN', '.github/workflows/deploy.yml');
  at('RUEDA_SMOKE_TIMEOUT_S', 'scripts/dev/smoke.sh');
  at('RUEDA_IMAGE', 'infra/local/compose.yaml');
  at('NODE_ENV', 'docker/prod/Dockerfile');
});

test('dépôt réel, échec volontaire : retirer une ligne de l’inventaire fait échouer', () => {
  for (const name of [
    'RUEDA_RATE_LIMIT_KEY',
    'RUEDA_STAFF_MFA_PROOF_KEY',
    'RUEDA_DEPLOY_ROLE_ARN',
    'WEB_BRAND_API_URL',
    'THEME_PALETTE',
  ]) {
    const without = REAL_INVENTORY.split('\n')
      .filter((row) => !(row.split('|')[1] ?? '').includes(`\`${name}\``))
      .join('\n');
    assert.notEqual(without, REAL_INVENTORY, `${name} n'a pas de ligne dans l'inventaire`);
    const r = checkInventory({ root: ROOT, files: realFiles, inventoryText: without });
    assert.ok(
      r.errors.some((e) => e.startsWith(`${name} absente`)),
      `${name} retirée sans échec : ${r.errors.join(' ; ')}`,
    );
  }
});

test('dépôt réel, échec volontaire : une nouvelle lecture non inventoriée fait échouer', () => {
  const extra = 'apps/api/src/zz-nouvelle-lecture.ts';
  const r = checkInventory({
    root: ROOT,
    files: [...realFiles, extra],
    inventoryText: REAL_INVENTORY,
    read: (f) =>
      f === extra
        ? "export const k = process.env['RUEDA_ZZ_NOUVELLE'];\n"
        : readFileSync(join(ROOT, f), 'utf8'),
  });
  assert.deepEqual(r.errors, [`RUEDA_ZZ_NOUVELLE absente de l'inventaire (${extra}:1)`]);
});

test('ligne de commande : code 1 sur un oubli, 0 sur l’inventaire du dépôt', () => {
  const dir = mkdtempSync(join(tmpdir(), 'env-inventory-'));
  try {
    const partial = join(dir, 'ENV_VARS.md');
    writeFileSync(partial, inv('PORT'));
    const ko = spawnSync(process.execPath, [SCRIPT, '--root', ROOT, '--inventory', partial], {
      encoding: 'utf8',
    });
    assert.equal(ko.status, 1, ko.stdout + ko.stderr);
    assert.match(ko.stderr, /RUEDA_RATE_LIMIT_KEY absente de l'inventaire/);
    const ok = spawnSync(process.execPath, [SCRIPT, '--root', ROOT], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /toutes inventoriées/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
