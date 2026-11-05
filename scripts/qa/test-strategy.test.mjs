// US-039, ADR-086 : la stratégie de test (docs/qa/STRATEGIE_TESTS.md) et le guide de contribution
// restent lançables. Échoue si une commande `pnpm …` citée n'existe pas, si une suite `test:*` n'est
// pas documentée (mot entier), si un job de CI cité n'existe pas (son existence, pas son contenu),
// si un chemin de la colonne « Emplacement » ou un script lancé par bash / node / python manque, si
// un lien relatif est cassé, si la liste ASVS perd un contrôle d'ADR-077, ou si CONTRIBUTING ne
// décrit plus les rôles et chemins de docs/team/review-requirements.json.
// Ne fait que LIRE .github/ et scripts/ci/ (aucune porte de fusion n'en dépend).
// node --test scripts/qa/ (pnpm test:unit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STRATEGY = 'docs/qa/STRATEGIE_TESTS.md';
const CONTRIBUTING = 'CONTRIBUTING.md';
const WORKFLOWS = ['.github/workflows/ci.yml', '.github/workflows/nightly.yml'];

/** Noms du handoff §7 qu'US-039 ne crée pas : cités seulement s'ils sont marqués comme tels. */
export const RESERVED = ['test:rls', 'test:concurrency', 'test:nightly'];
const RESERVED_MARK = /réservé|pas créés?|non créés?/;

/** Commandes intégrées de pnpm, sans script à vérifier. */
const PNPM_BUILTINS = new Set(['install', 'exec', 'dlx', 'add', 'why', 'audit']);

const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
const readJson = (path) => JSON.parse(read(path));

/** Paquets de l'espace de travail : nom → scripts, plus la racine sous la clé « (racine) ». */
export function workspace(root = ROOT) {
  const packages = new Map();
  for (const parent of ['apps', 'packages']) {
    for (const dir of readdirSync(join(root, parent))) {
      const file = join(root, parent, dir, 'package.json');
      if (!statSync(join(root, parent, dir)).isDirectory() || !existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8'));
      packages.set(pkg.name, { dir: `${parent}/${dir}`, scripts: pkg.scripts ?? {} });
    }
  }
  const rootScripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  const turboTasks = Object.keys(JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8')).tasks);
  return { packages, rootScripts, turboTasks };
}

/**
 * Commandes `pnpm …` d'un document Markdown : contenu des `code` en ligne et des blocs, découpé
 * sur `&&`, `||` et `;`. Rend [{ line, command }] (la commande commence à `pnpm`).
 */
export function pnpmCommands(markdown) {
  const out = [];
  const lines = markdown.split('\n');
  let fenced = false;
  lines.forEach((text, i) => {
    if (/^\s*```/.test(text)) {
      fenced = !fenced;
      return;
    }
    const chunks = fenced
      ? [text.replace(/\s#.*$/, '')]
      : [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const chunk of chunks) {
      for (const part of chunk.split(/&&|\|\||;/)) {
        const at = part.search(/(^|\s)pnpm\s/);
        if (at < 0) continue;
        out.push({ line: i + 1, text, command: part.slice(at).trim() });
      }
    }
  });
  return out;
}

/** Vérifie une commande `pnpm …` ; rend un message d'erreur, ou null si elle existe. */
export function checkCommand(command, { packages, rootScripts, turboTasks }) {
  const tokens = command.split(/\s+/).slice(1);
  let filter = null;
  const rest = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '--filter' || t === '-F') filter = tokens[++i];
    else if (t.startsWith('--filter=')) filter = t.slice('--filter='.length);
    else rest.push(t);
  }
  let [script, ...args] = rest.filter((t, i) => !(i === 0 && t.startsWith('-')));
  if (rest[0]?.startsWith('-') && !script) return null; // `pnpm -v`
  if (!script || PNPM_BUILTINS.has(script)) return null;
  if (script === 'run') [script, ...args] = args;
  if (script === 'turbo') {
    const task = args[0] === 'run' ? args[1] : args[0];
    return turboTasks.includes(task) ? null : `tâche Turborepo inconnue « ${task} » (${command})`;
  }
  if (filter) {
    const pkg = packages.get(filter);
    if (!pkg) return `paquet inconnu « ${filter} » (${command})`;
    return script in pkg.scripts
      ? null
      : `script « ${script} » absent de ${pkg.dir}/package.json (${command})`;
  }
  return script in rootScripts
    ? null
    : `script « ${script} » absent du package.json racine (${command})`;
}

/** Erreurs de commandes d'un document : commande inexistante, sauf nom réservé marqué comme tel. */
export function commandErrors(markdown, ws) {
  const errors = [];
  for (const { line, text, command } of pnpmCommands(markdown)) {
    const error = checkCommand(command, ws);
    if (!error) continue;
    const name = command.split(/\s+/)[1];
    if (RESERVED.includes(name) && RESERVED_MARK.test(text)) continue;
    errors.push(`ligne ${line} : ${error}`);
  }
  return errors;
}

/** Jobs d'un workflow GitHub : clés de second niveau sous `jobs:` (indentation de deux espaces). */
export function workflowJobs(yaml) {
  const jobs = new Set();
  let inJobs = false;
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) inJobs = /^jobs:\s*$/.test(line);
    else if (inJobs) {
      const m = /^ {2}([A-Za-z0-9_-]+):\s*(#.*)?$/.exec(line);
      if (m) jobs.add(m[1]);
    }
  }
  return jobs;
}

/** Valeurs entre accents graves de la colonne `header` du premier tableau qui la porte. */
export function tableColumn(markdown, header) {
  const lines = markdown.split('\n');
  const start = lines.findIndex(
    (l) => l.startsWith('|') && l.split('|').some((c) => c.trim() === header),
  );
  if (start < 0) return null;
  const cells = (l) =>
    l
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
  const index = cells(lines[start]).indexOf(header);
  const values = [];
  for (const l of lines.slice(start + 2)) {
    if (!l.startsWith('|')) break;
    values.push(...[...(cells(l)[index] ?? '').matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  }
  return values;
}

/** Liens relatifs cassés d'un document (ancres ignorées). */
export function brokenLinks(markdown, docPath, root = ROOT) {
  const broken = [];
  for (const [, target] of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/i.test(target) || target.startsWith('#')) continue;
    const path = decodeURIComponent(target.split('#')[0]);
    if (!existsSync(join(root, dirname(docPath), path))) broken.push(target);
  }
  return broken;
}

/** Le mot `word` figure-t-il entier dans `text` (pas de `[\w:-]` collé avant ni après) ? */
export function hasWord(text, word) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w:-])${escaped}(?![\\w:-])`).test(text);
}

/** Chemins sans joker (`*`, `{`, `<`) entre accents graves d'une colonne, absents du dépôt. */
export function missingPaths(values, root = ROOT) {
  return values.filter(
    (v) =>
      v.includes('/') && !v.startsWith('@') && !/[*{<\s]/.test(v) && !existsSync(join(root, v)),
  );
}

/** Scripts lancés par `bash`, `node` ou `python` dans du code en ligne, absents du dépôt. */
export function missingScripts(markdown, root = ROOT) {
  const missing = [];
  for (const [, code] of markdown.matchAll(/`([^`]+)`/g)) {
    for (const [, path] of code.matchAll(
      /(?:^|\s)(?:bash|node|python)\s[^`]*?((?:scripts|packages|docs)\/\S+)/g,
    )) {
      if (!existsSync(join(root, path))) missing.push(path);
    }
  }
  return missing;
}

// ── Tests des aides (cas d'échec voulus) ────────────────────────────────────────────────────

test('hasWord compare par mot entier', () => {
  assert.equal(hasWord('lancer `pnpm test:int`', 'test:int'), true);
  assert.equal(hasWord('lancer `pnpm test:int`', 'test:in'), false);
  assert.equal(hasWord('test:unit-x', 'test:unit'), false);
  assert.equal(hasWord('(test:c11)', 'test:c11'), true);
});

test('missingPaths et missingScripts repèrent un chemin ou un script absent', () => {
  assert.deepEqual(
    missingPaths(['package.json', 'scripts/qa/', 'nulle/part.ts', 'a/*.ts', 'l0-05']),
    ['nulle/part.ts'],
  );
  assert.deepEqual(
    missingScripts(
      '`bash scripts/ops/restore-drill.sh` `python -I -X utf8 scripts/ci/absent.py --x` `node scripts/qa/x.mjs`',
    ),
    ['scripts/ci/absent.py', 'scripts/qa/x.mjs'],
  );
});

const fakeWs = {
  packages: new Map([['@x/a', { dir: 'packages/a', scripts: { 'test:unit': 'vitest' } }]]),
  rootScripts: { lint: 'eslint', 'test:unit': 'turbo' },
  turboTasks: ['build', 'test:unit'],
};

test('checkCommand : script racine, script de paquet, tâche turbo, commandes intégrées', () => {
  assert.equal(checkCommand('pnpm lint', fakeWs), null);
  assert.equal(checkCommand('pnpm run lint', fakeWs), null);
  assert.equal(checkCommand('pnpm --filter @x/a test:unit', fakeWs), null);
  assert.equal(checkCommand('pnpm --filter=@x/a test:unit --project p', fakeWs), null);
  assert.equal(checkCommand('pnpm turbo run build --filter=@x/a', fakeWs), null);
  assert.equal(checkCommand('pnpm install --frozen-lockfile', fakeWs), null);
  assert.equal(checkCommand('pnpm --filter @x/a exec vitest run', fakeWs), null);
  assert.equal(checkCommand('pnpm -v', fakeWs), null);
  assert.match(checkCommand('pnpm test:rls', fakeWs), /absent du package.json racine/);
  assert.match(checkCommand('pnpm --filter @x/a test:int', fakeWs), /absent de packages\/a/);
  assert.match(checkCommand('pnpm --filter @x/zz test:unit', fakeWs), /paquet inconnu/);
  assert.match(checkCommand('pnpm turbo run deploy', fakeWs), /tâche Turborepo inconnue/);
});

test('commandErrors : chaînes &&, blocs de code, variables en tête, noms réservés', () => {
  const md = [
    'Lancer `pnpm lint && pnpm test:nope` puis `RUEDA_X=1 pnpm --filter @x/a test:unit`.',
    '```bash',
    'pnpm test:unit   # commentaire',
    'pnpm build',
    '```',
    '`pnpm test:rls` : nom réservé, non créé.',
    '`pnpm test:concurrency` est disponible.',
  ].join('\n');
  assert.deepEqual(commandErrors(md, fakeWs), [
    'ligne 1 : script « test:nope » absent du package.json racine (pnpm test:nope)',
    'ligne 4 : script « build » absent du package.json racine (pnpm build)',
    'ligne 7 : script « test:concurrency » absent du package.json racine (pnpm test:concurrency)',
  ]);
});

test('workflowJobs et tableColumn lisent les jobs et la colonne « Job CI »', () => {
  const yaml =
    'on:\n  push:\njobs:\n  qualite:\n    steps:\n      - run: x\n  e2e-web: # e2e\n    x: 1\nenv:\n  A: 1\n';
  assert.deepEqual([...workflowJobs(yaml)], ['qualite', 'e2e-web']);
  const md =
    '| Famille | Job CI |\n| --- | --- |\n| a | `qualite`, `x` (à venir) |\n| b | `y` |\n\n| Job CI |\n| - |\n| `z` |';
  assert.deepEqual(tableColumn(md, 'Job CI'), ['qualite', 'x', 'y']);
  assert.equal(tableColumn('pas de tableau', 'Job CI'), null);
});

test('brokenLinks repère un lien relatif cassé, ignore URL et ancres', () => {
  const md =
    '[a](../../package.json) [b](nulle-part.md) [c](https://x.y) [d](#ancre) [e](../../CONTRIBUTING.md#x)';
  assert.deepEqual(brokenLinks(md, STRATEGY), ['nulle-part.md']);
});

// ── Contrôles du dépôt ──────────────────────────────────────────────────────────────────────

const ws = workspace();
const strategy = read(STRATEGY);
const contributing = read(CONTRIBUTING);

test('chaque commande pnpm citée par la stratégie et par CONTRIBUTING existe', () => {
  assert.deepEqual(commandErrors(strategy, ws), [], STRATEGY);
  assert.deepEqual(commandErrors(contributing, ws), [], CONTRIBUTING);
});

test('chaque suite test:* d’un package.json est décrite dans la stratégie', () => {
  const missing = [];
  const all = [['(racine)', ws.rootScripts], ...[...ws.packages].map(([n, p]) => [n, p.scripts])];
  for (const [name, scripts] of all) {
    for (const script of Object.keys(scripts).filter((s) => s.startsWith('test:'))) {
      if (!hasWord(strategy, script)) missing.push(`${name} ${script}`);
    }
  }
  assert.deepEqual(missing, [], 'ajouter la suite à docs/qa/STRATEGIE_TESTS.md');
});

test('chaque job de la colonne « Job CI » existe dans ci.yml ou nightly.yml', () => {
  const jobs = new Set(WORKFLOWS.flatMap((w) => [...workflowJobs(read(w))]));
  const cited = tableColumn(strategy, 'Job CI');
  assert.ok(cited && cited.length > 10, 'colonne « Job CI » introuvable ou presque vide');
  assert.deepEqual(
    cited.filter((j) => !jobs.has(j)),
    [],
  );
});

test('les noms réservés du handoff §7 sont créés ou marqués comme non créés', () => {
  for (const name of RESERVED) {
    if (name in ws.rootScripts) continue;
    const lines = strategy.split('\n').filter((l) => l.includes(`\`pnpm ${name}\``));
    assert.ok(lines.length > 0, `${name} : ni créé ni mentionné dans ${STRATEGY}`);
    assert.ok(
      lines.every((l) => RESERVED_MARK.test(l)),
      `${name} : cité sans être marqué réservé`,
    );
  }
});

test('la stratégie couvre chaque famille exigée par US-039', () => {
  const families = [
    ['unitaires', /^\| Unitaires/m],
    ['intégration', /^\| Intégration/m],
    ['vecteurs dorés T01–T68', /T01–T68/],
    ['vecteurs TJ01–TJ21', /TJ01–TJ21/],
    ['oracles', /check-spec-tools\.py/],
    ['concurrence C1–C20', /^\| Concurrence C1–C20/m],
    ['isolation RLS-1 à RLS-28', /^\| Isolation RLS-1 à RLS-28/m],
    ['preuves L0', /^\| Preuves L0-01 à L0-09/m],
    ['fuzz', /^\| Fuzz C11/m],
    // Libellé exact « … PA / USD et PY / PYG » : le lint des constantes de pays interdit de l'écrire ici.
    ['parcours dorés e2e des deux pays', /^\| Parcours dorés e2e /m],
    ['accessibilité', /^\| Accessibilité/m],
    ['sécurité', /^\| Sécurité \(ASVS niveau 2/m],
    [
      'contrôles ASVS niveau 2 retenus',
      /^### 3\.9 Sécurité : contrôles OWASP ASVS niveau 2 retenus/m,
    ],
    ['données personnelles', /^\| Données personnelles/m],
    ['gabarits', /^\| Gabarits de notification/m],
  ];
  assert.deepEqual(
    families.filter(([, re]) => !re.test(strategy)).map(([n]) => n),
    [],
  );
});

test('ASVS : les contrôles couverts par ADR-077 ont une ligne, chaque ligne une preuve ou « prévu »', () => {
  const asvs = strategy.slice(strategy.indexOf('### 3.9'), strategy.indexOf('### 3.10'));
  const rows = asvs.split('\n').filter((l) => /^\| V\d/.test(l));
  const ids = rows.map((l) => l.split('|')[1].trim());
  for (const id of ['V4', 'V8.3', 'V12.1', 'V13.1', 'V14.4']) {
    assert.ok(
      ids.some((cell) => cell.split(/,\s*/).includes(id)),
      `ligne ASVS ${id} absente`,
    );
  }
  for (const row of rows) {
    const [, , , proof, story] = row.split('|').map((c) => c.trim());
    assert.ok(/`[^`]+`|prévu/.test(proof), `preuve absente : ${row}`);
    assert.match(story, /US-\d{3}|à attribuer/, `story absente : ${row}`);
  }
});

test('chemins de la colonne « Emplacement » et scripts lancés existent', () => {
  const places = tableColumn(strategy, 'Emplacement');
  assert.ok(places && places.length > 20, 'colonne « Emplacement » introuvable ou presque vide');
  assert.deepEqual(missingPaths(places), []);
  assert.deepEqual(missingScripts(strategy), [], STRATEGY);
  assert.deepEqual(missingScripts(contributing), [], CONTRIBUTING);
});

test('aucun lien relatif cassé dans la stratégie ni dans CONTRIBUTING', () => {
  assert.deepEqual(brokenLinks(strategy, STRATEGY), []);
  assert.deepEqual(brokenLinks(contributing, CONTRIBUTING), []);
});

test('CONTRIBUTING décrit worktrees, branches, revues par type de story et fusion', () => {
  for (const heading of [
    '## 3. Branches et worktrees',
    '### 5.1 Revues requises par type de story',
    '### 5.2 Flux de revue',
    '### 5.3 Règles de fusion',
    '### 5.4 Reprendre le travail en tant qu',
  ]) {
    assert.ok(contributing.includes(heading), `section absente : ${heading}`);
  }
  const rules = readJson('docs/team/review-requirements.json');
  const roles = new Set([
    ...rules.default,
    ...Object.values(rules.stories).flatMap((s) => s.require),
    ...rules.pathRules.flatMap((r) => r.require),
  ]);
  const rows = new Set([...contributing.matchAll(/^\| `([a-z-]+)` +\|/gm)].map((m) => m[1]));
  const undescribed = [...roles].filter((r) => !rows.has(r));
  assert.deepEqual(undescribed, [], 'rôle de revue sans ligne dans le tableau du §5.1');
  const paths = [...new Set(rules.pathRules.flatMap((r) => r.paths))];
  assert.deepEqual(
    paths.filter((p) => !contributing.includes(`\`${p}\``)),
    [],
    'chemin protégé non cité au §5.1',
  );
});
