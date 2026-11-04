#!/usr/bin/env node
// Contrôle « inventaire des variables d'environnement » (US-037, 17 §6.6, ADR-083).
//
// Toute variable d'environnement LUE ou POSÉE par le dépôt doit figurer dans
// docs/ops/ENV_VARS.md (première colonne d'un tableau, entre accents graves ; `PREFIXE_*` couvre
// une famille). Sinon : liste des oublis (fichier:ligne) et code de sortie 1. Fail-closed : un
// inventaire illisible, ou un balayage qui ne trouve rien, est un échec.
//
// Sources balayées (fichiers suivis par git) :
//   - TS / JS : `process.env.X`, `process.env['X']`, `env.X`, `env['X']`, `env[CONST]` (constante
//     littérale du même fichier), `const { X } = process.env`, clés d'un objet `env: { X: … }` (vitest, Playwright), et tout littéral `'RUEDA_…'`
//     (préfixe du projet : `env[name]` alimenté par une table de noms) ;
//   - shell (*.sh) : `$X` / `${X…}` non affectée dans le script, `export X=`, `-e X` / `--env X`
//     (docker), tout `RUEDA_…` ;
//   - compose : interpolation `${X}`, clés MAJUSCULES (blocs `environment`), `X="$$(…)"` ;
//   - workflows GitHub : `${{ vars.X }}`, `${{ secrets.X }}`, `${{ env.X }}`, clés des blocs `env:` ;
//   - IaC OpenTofu (*.tf, *.hcl) : `name = "X"` (définitions de tâche) et littéraux `"RUEDA_…"` ;
//   - Dockerfile : `ENV X=…` ; turbo.json : listes `*Env` ; fichiers `.env.example` : `X=`.
//
// Exclusions EN DUR (ne changent que par une PR sous revue sécurité, scripts/ci/) : docs, *.md,
// lockfile, et ce contrôle avec son test (ils contiennent des noms de variables fictifs exprès).
//
// Usage : node scripts/ci/check-env-inventory.mjs [--inventory docs/ops/ENV_VARS.md] [--root .]
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_INVENTORY = 'docs/ops/ENV_VARS.md';

const SELF = new Set([
  'scripts/ci/check-env-inventory.mjs',
  'scripts/ci/check-env-inventory.test.mjs',
]);
const EXCLUDED = (file) =>
  SELF.has(file) ||
  file.startsWith('docs/') ||
  file.endsWith('.md') ||
  file === 'pnpm-lock.yaml' ||
  file.includes('node_modules/');

// Variables du shell lui-même (jamais lues dans l'environnement du projet).
const SHELL_BUILTINS = new Set([
  'BASH_SOURCE',
  'BASH_REMATCH',
  'BASH_LINENO',
  'FUNCNAME',
  'LINENO',
  'IFS',
  'OPTARG',
  'OPTIND',
  'PIPESTATUS',
  'PWD',
  'OLDPWD',
  'RANDOM',
  'SECONDS',
  'REPLY',
  'EUID',
  'UID',
]);

const NAME = '[A-Z][A-Z0-9_]*';
const PROJECT_LITERAL = /['"`](RUEDA_[A-Z0-9_]+)['"`]/g;
const ENV_RECEIVER = /^(?:env|environment|[a-z][\w$]*Env)$/;

function kindOf(file) {
  const name = basename(file);
  if (/\.(?:[cm]?[jt]sx?)$/.test(file)) return 'js';
  if (/\.(?:sh|bash)$/.test(file)) return 'sh';
  if (/^\.github\/(?:workflows|actions)\/.*\.ya?ml$/.test(file)) return 'workflow';
  if (/^(?:docker-)?compose[^/]*\.ya?ml$/.test(name)) return 'compose';
  if (/\.(?:tf|hcl)$/.test(file)) return 'tofu';
  if (name === 'Dockerfile' || name.endsWith('.Dockerfile')) return 'dockerfile';
  if (name === 'turbo.json') return 'turbo';
  if (name === '.env.example' || name.endsWith('.env.example')) return 'dotenv';
  return null;
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

function* matches(regex, text, group = 1) {
  regex.lastIndex = 0;
  for (let m = regex.exec(text); m !== null; m = regex.exec(text)) {
    yield { name: m[group], line: lineOf(text, m.index), m };
  }
}

function scanJs(text) {
  const out = [];
  const dot = /\b([A-Za-z_$][\w$]*)\??\.([A-Z][A-Z0-9_]*)\b/g;
  for (const { m, line } of matches(dot, text)) {
    if (ENV_RECEIVER.test(m[1])) out.push({ name: m[2], line });
  }
  const bracket = /\b([A-Za-z_$][\w$]*)\??\.?\[\s*(['"`])([A-Z][A-Z0-9_]*)\2\s*\]/g;
  for (const { m, line } of matches(bracket, text)) {
    if (ENV_RECEIVER.test(m[1])) out.push({ name: m[3], line });
  }
  const byConst = /\b([A-Za-z_$][\w$]*)\??\.?\[\s*([A-Za-z_$][\w$]*)\s*\]/g;
  for (const { m, line } of matches(byConst, text)) {
    if (!ENV_RECEIVER.test(m[1])) continue;
    const def = new RegExp(`\\b${m[2].replace(/\$/g, '\\$')}\\s*=\\s*(['"\`])(${NAME})\\1`).exec(
      text,
    );
    if (def) out.push({ name: def[2], line });
  }
  const destructure = /\{([^{}]*)\}\s*=\s*(?:process\.)?env\b/g;
  for (const { m, line } of matches(destructure, text)) {
    for (const part of m[1].split(',')) {
      const key = /^\s*([A-Z][A-Z0-9_]*)\b/.exec(part);
      if (key) out.push({ name: key[1], line });
    }
  }
  const envObject = /\benv\s*:\s*\{([^{}]*)\}/g;
  for (const { m, line } of matches(envObject, text)) {
    for (const key of m[1].matchAll(/(?:^|[,{\s])['"]?([A-Z][A-Z0-9_]*)['"]?\s*:/g)) {
      out.push({ name: key[1], line });
    }
  }
  for (const hit of matches(PROJECT_LITERAL, text)) out.push(hit);
  return out;
}

function scanShell(text) {
  const out = [];
  const assigned = new Set();
  for (const { m } of matches(
    new RegExp(`^\\s*(?:local\\s+|readonly\\s+|declare\\s+-?\\w*\\s+)?(${NAME})=`, 'gm'),
    text,
  )) {
    assigned.add(m[1]);
  }
  for (const { m } of matches(
    new RegExp(`\\b(?:for|read(?:\\s+-\\w+)*)\\s+(${NAME})\\b`, 'g'),
    text,
  ))
    assigned.add(m[1]);
  for (const hit of matches(new RegExp(`\\$\\{?(${NAME})`, 'g'), text)) {
    if (!assigned.has(hit.name) && !SHELL_BUILTINS.has(hit.name) && !/^\d/.test(hit.name))
      out.push(hit);
  }
  for (const hit of matches(new RegExp(`^\\s*export\\s+(${NAME})=?`, 'gm'), text)) out.push(hit);
  const dockerEnv = new RegExp(`(?:^|\\s)(?:-e|--env)[\\s=]+(${NAME})(?==|\\s|$)`, 'gm');
  for (const hit of matches(dockerEnv, text)) out.push(hit);
  for (const hit of matches(/\b(RUEDA_[A-Z0-9_]+)\b/g, text)) out.push(hit);
  return out;
}

function scanCompose(text) {
  const out = [];
  for (const hit of matches(new RegExp(`(?<!\\$)\\$\\{(${NAME})`, 'g'), text)) out.push(hit);
  for (const hit of matches(new RegExp(`^\\s+(${NAME}):(?:\\s|$)`, 'gm'), text)) out.push(hit);
  for (const hit of matches(new RegExp(`\\b(${NAME})="?\\$\\$\\(`, 'g'), text)) out.push(hit);
  return out;
}

function scanWorkflow(text) {
  const out = [];
  for (const hit of matches(/\$\{\{[^}]*?\b(?:vars|secrets|env)\.([A-Za-z_][A-Za-z0-9_]*)/g, text))
    out.push(hit);
  const lines = text.split('\n');
  let envIndent = -1;
  lines.forEach((raw, i) => {
    const indent = raw.search(/\S/);
    if (indent < 0 || raw.trimStart().startsWith('#')) return;
    if (envIndent >= 0 && indent <= envIndent) envIndent = -1;
    if (envIndent >= 0) {
      const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(raw);
      if (key) out.push({ name: key[1], line: i + 1 });
      return;
    }
    if (/^\s*env:\s*(?:#.*)?$/.test(raw)) envIndent = indent;
  });
  return out;
}

function scanTofu(text) {
  const out = [];
  for (const hit of matches(new RegExp(`\\bname\\s*=\\s*"(${NAME})"`, 'g'), text)) out.push(hit);
  for (const hit of matches(/"(RUEDA_[A-Z0-9_]+)"/g, text)) out.push(hit);
  return out;
}

function scanDockerfile(text) {
  const out = [];
  const env = /^\s*ENV\s+((?:[^\n]*\\\n)*[^\n]*)/gm;
  for (const { m, line } of matches(env, text)) {
    const body = m[1];
    const pairs = [...body.matchAll(new RegExp(`(?:^|\\s)(${NAME})=`, 'g'))];
    if (pairs.length > 0) {
      for (const p of pairs) out.push({ name: p[1], line: line + lineOf(body, p.index) - 1 });
    } else {
      const legacy = new RegExp(`^(${NAME})\\s`).exec(body);
      if (legacy) out.push({ name: legacy[1], line });
    }
  }
  return out;
}

function scanTurbo(text) {
  const out = [];
  const list = /"(?:env|passThroughEnv|globalEnv|globalPassThroughEnv)"\s*:\s*\[([^\]]*)\]/g;
  for (const { m, line } of matches(list, text)) {
    for (const item of m[1].matchAll(/"([^"]+)"/g)) out.push({ name: item[1], line });
  }
  return out;
}

function scanDotenv(text) {
  return [...matches(new RegExp(`^\\s*(?:export\\s+)?(${NAME})=`, 'gm'), text)];
}

const SCANNERS = {
  js: scanJs,
  sh: scanShell,
  workflow: scanWorkflow,
  compose: scanCompose,
  tofu: scanTofu,
  dockerfile: scanDockerfile,
  turbo: scanTurbo,
  dotenv: scanDotenv,
};

/** Lectures et poses de variables d'un fichier : [{ name, line }]. */
export function scanFile(file, text) {
  const kind = kindOf(file);
  if (kind === null || EXCLUDED(file)) return [];
  const seen = new Set();
  const out = [];
  for (const { name, line } of SCANNERS[kind](text)) {
    const key = `${name}:${line}`;
    if (seen.has(key)) continue; // même lecture vue par deux motifs
    seen.add(key);
    out.push({ name, line, file, kind });
  }
  return out;
}

/** Noms déclarés par l'inventaire : première colonne des tableaux, entre accents graves. */
export function parseInventory(markdown) {
  const names = new Set();
  for (const row of markdown.split('\n')) {
    if (!/^\s*\|/.test(row) || /^\s*\|\s*-/.test(row)) continue;
    const first = row.split('|')[1] ?? '';
    for (const m of first.matchAll(/`([A-Za-z_][A-Za-z0-9_]*\*?)`/g)) names.add(m[1]);
  }
  return names;
}

export function covers(inventory, name) {
  if (inventory.has(name)) return true;
  for (const entry of inventory) {
    if (entry.endsWith('*') && name.startsWith(entry.slice(0, -1))) return true;
  }
  return false;
}

export function listTrackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f !== '');
}

/**
 * Contrôle complet. `files` : chemins relatifs à `root` (défaut : fichiers suivis par git) ;
 * `read` : lecteur de fichier (défaut : disque).
 */
export function checkInventory({
  root = '.',
  files = listTrackedFiles(root),
  inventoryText,
  read = (f) => readFileSync(join(root, f), 'utf8'),
}) {
  const errors = [];
  const inventory = parseInventory(inventoryText);
  if (inventory.size === 0) {
    return { errors: ['inventaire vide ou illisible (fail-closed)'], reads: [], stale: [] };
  }
  const reads = [];
  for (const file of files) {
    if (kindOf(file) === null || EXCLUDED(file)) continue;
    let text;
    try {
      text = read(file);
    } catch {
      continue; // fichier suivi supprimé de l'arbre de travail
    }
    reads.push(...scanFile(file, text));
  }
  if (reads.length === 0) errors.push('aucune variable trouvée : balayage à vide (fail-closed)');
  const missing = new Map();
  for (const r of reads) {
    if (covers(inventory, r.name)) continue;
    if (!missing.has(r.name)) missing.set(r.name, []);
    missing.get(r.name).push(`${r.file}:${r.line}`);
  }
  for (const [name, where] of [...missing].sort(([a], [b]) => a.localeCompare(b))) {
    errors.push(
      `${name} absente de l'inventaire (${where.slice(0, 3).join(', ')}${where.length > 3 ? ', …' : ''})`,
    );
  }
  const used = new Set(reads.map((r) => r.name));
  const stale = [...inventory].filter((entry) =>
    entry.endsWith('*')
      ? ![...used].some((n) => n.startsWith(entry.slice(0, -1)))
      : !used.has(entry),
  );
  return { errors, reads, stale };
}

function main(argv) {
  const opt = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const root = opt('root', '.');
  const inventoryPath = opt('inventory', DEFAULT_INVENTORY);
  let inventoryText;
  try {
    inventoryText = readFileSync(resolve(root, inventoryPath), 'utf8');
  } catch (error) {
    console.error(`inventaire illisible : ${inventoryPath} (${error.message})`);
    return 1;
  }
  const { errors, reads, stale } = checkInventory({ root, inventoryText });
  const distinct = new Set(reads.map((r) => r.name)).size;
  if (stale.length > 0) {
    console.log(
      `information : ${stale.length} entrée(s) de l'inventaire sans lecture balayée (lues par un outil tiers, par Node.js ou à venir) : ${stale.join(', ')}`,
    );
  }
  if (errors.length > 0) {
    console.error(`inventaire des variables (${inventoryPath}) : ${errors.length} écart(s)`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error(
      'Ajouter chaque variable à docs/ops/ENV_VARS.md (nom, usage, environnements, propriétaire, SANS valeur).',
    );
    return 1;
  }
  console.log(
    `inventaire des variables : ${reads.length} lectures, ${distinct} variables, toutes inventoriées`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = main(process.argv.slice(2));
}
