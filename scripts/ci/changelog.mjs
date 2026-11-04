#!/usr/bin/env node
// CHANGELOG par fragments (US-040, ADR-085). Deux commandes :
//
//   check   : une PR qui modifie du code livré doit ajouter (ou modifier) un fragment valide
//             `changelog.d/<nom>.md` qui cite une story de la branche. Job `changelog` de ci.yml.
//   release : à une mise en production, l'orchestrateur verse les fragments dans la section de
//             version de CHANGELOG.md, numéros de PR compris, puis supprime les fragments. Refusé
//             si docs/NOTES_DE_VERSION.md n'a pas la section de cette version (notes en français).
//
// Pourquoi des fragments : deux PR parallèles qui ajoutent une ligne au même endroit de
// CHANGELOG.md se heurtent à chaque fusion. Un fichier par PR ne se heurte jamais.
//
// Format d'un fragment (un ou plusieurs blocs ; lignes `<!-- … -->` ignorées) :
//
//   lot: L0
//   module: Équipe et CI
//   - Ajouté : contrôle d'entrée de CHANGELOG sur chaque PR (US-040)
//
// ou, pour une PR de code sans effet à consigner (exemption justifiée, relue en revue de code) :
//
//   exemption: US-040 — <raison d'au moins 20 caractères>
//
// Exemptions automatiques (en dur ; les changer touche scripts/ci/, donc revue sécurité) : une PR
// dont tous les fichiers sont sous docs/, ou des *.md hors de scripts/ et .github/ (rapports de
// revue, passations, README, CHANGELOG.md, fragments).
//
// Fail-closed : base introuvable, diff vide, fragment illisible ou mal formé = échec.
// Autonome (modules Node seulement) : le job le copie depuis la base et l'exécute hors du dépôt.
//
// Usage :
//   node scripts/ci/changelog.mjs check [--branch <nom>] [--base origin/main] [--head HEAD] [--root .]
//   node scripts/ci/changelog.mjs release --version <x.y.z> --date <AAAA-MM-JJ> [--root .]

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FRAGMENT_DIR = 'changelog.d';
export const CHANGELOG = 'CHANGELOG.md';
export const RELEASE_NOTES = 'docs/NOTES_DE_VERSION.md';
export const CATEGORIES = ['Ajouté', 'Modifié', 'Corrigé', 'Retiré', 'Obsolète', 'Sécurité'];
const UNRELEASED = '## [Non publié]';
const STORY_RE = /US-\d{3}/g;
const STORY_ONE = /US-\d{3}/;
const LOT_RE = /^(L[0-5]|LC)$/;

/** Retire les commentaires HTML `<!-- … -->`, y compris sur plusieurs lignes. */
export function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, ' ');
}

/**
 * Neutralise un texte non fiable (noms de fichiers, exemption) avant de l'écrire dans le journal
 * du workflow : `%`, retours à la ligne et `::` ne peuvent plus former une commande de workflow
 * (`::warning`, `::add-mask`…). Revue sécurité US-040 n° 4.
 */
export function escapeWorkflow(text) {
  return String(text)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/::/g, ': :');
}

/** Un fichier qui ne compte pas comme « code livré ». */
export function isExemptPath(file) {
  if (file.startsWith('docs/')) return true;
  if (file === CHANGELOG || file.startsWith(`${FRAGMENT_DIR}/`)) return true;
  if (file.endsWith('.md') && !file.startsWith('scripts/') && !file.startsWith('.github/')) {
    return true;
  }
  return false;
}

/** Stories d'une branche `story/US-xxx-US-yyy-<slug>` ; [] pour une autre branche. */
export function branchStories(branch) {
  const m = /^story\/((?:US-\d{3}-)+)/.exec(branch ?? '');
  return m ? (m[1].match(STORY_RE) ?? []) : [];
}

/**
 * Analyse un fragment. Rend { blocks: [{lot, module, bullets}], exemption, stories, errors }.
 */
export function parseFragment(text) {
  const errors = [];
  const blocks = [];
  let exemption = null;
  let lot = null;
  let current = null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const where = `ligne ${i + 1}`;
    if (line === '' || /^<!--.*-->$/.test(line)) return;
    let m;
    if ((m = /^exemption\s*:\s*(.*)$/i.exec(line))) {
      if (exemption !== null) errors.push(`${where} : exemption en double`);
      exemption = m[1].trim();
      return;
    }
    if ((m = /^lot\s*:\s*(.*)$/i.exec(line))) {
      lot = m[1].trim();
      if (!LOT_RE.test(lot)) errors.push(`${where} : lot « ${lot} » invalide (L0 à L5 ou LC)`);
      current = null;
      return;
    }
    if ((m = /^module\s*:\s*(.*)$/i.exec(line))) {
      const module = m[1].trim();
      if (module === '') errors.push(`${where} : module vide`);
      if (lot === null) errors.push(`${where} : « module: » sans « lot: » avant`);
      current = { lot, module, bullets: [] };
      blocks.push(current);
      return;
    }
    if ((m = /^- (.+)$/.exec(line))) {
      if (!current) {
        errors.push(`${where} : entrée hors d'un bloc « lot: » / « module: »`);
        return;
      }
      const entry = m[1].trim();
      const cat = new RegExp(`^(${CATEGORIES.join('|')}) : \\S`);
      if (!cat.test(entry)) {
        errors.push(`${where} : l'entrée doit commencer par « ${CATEGORIES.join(' | ')} : »`);
      }
      if (!STORY_ONE.test(stripComments(entry)))
        errors.push(`${where} : l'entrée ne cite aucune story (US-xxx)`);
      current.bullets.push(entry);
      return;
    }
    errors.push(`${where} : ligne non reconnue « ${line.slice(0, 60)} »`);
  });
  if (exemption !== null) {
    if (blocks.length > 0) errors.push('exemption et entrées dans le même fragment');
    if (!/US-\d{3}/.test(exemption)) errors.push('exemption : aucune story citée (US-xxx)');
    const reason = exemption
      .replace(/US-\d{3}/g, '')
      .replace(/[\s—–:-]+/g, ' ')
      .trim();
    if (reason.length < 20)
      errors.push('exemption : raison absente ou trop courte (20 caractères)');
  } else {
    if (blocks.length === 0) errors.push('fragment sans entrée ni exemption');
    for (const b of blocks) {
      if (b.bullets.length === 0) errors.push(`module « ${b.module} » sans entrée`);
    }
  }
  // Une story citée seulement dans un commentaire HTML ne compte pas (revue code US-040 n° 3).
  const stories = new Set(stripComments(text).match(STORY_RE) ?? []);
  return { blocks, exemption, stories, errors };
}

/** Décision du contrôle à partir du diff (pur, testable sans git). */
export function evaluate({ changes, branch, readFile }) {
  const errors = [];
  const notes = [];
  if (changes.length === 0) {
    return { errors: ['diff vide : base mal résolue ou branche sans commit (fail-closed)'], notes };
  }
  const code = changes.filter((c) => !isExemptPath(c.path)).map((c) => c.path);
  if (code.length === 0) {
    notes.push(`exemption automatique : ${changes.length} fichier(s), documentation seulement`);
    return { errors, notes };
  }
  const fragments = changes.filter(
    (c) =>
      c.path.startsWith(`${FRAGMENT_DIR}/`) &&
      c.path.endsWith('.md') &&
      c.path !== `${FRAGMENT_DIR}/README.md` &&
      (c.status === 'A' || c.status === 'M'),
  );
  if (fragments.length === 0) {
    errors.push(
      `code livré sans entrée de CHANGELOG : ajouter ${FRAGMENT_DIR}/<branche>.md ` +
        `(format : ${FRAGMENT_DIR}/README.md). Fichiers : ${code.slice(0, 5).join(', ')}` +
        (code.length > 5 ? ` (+${code.length - 5})` : ''),
    );
    return { errors, notes };
  }
  const wanted = branchStories(branch);
  let cites = false;
  for (const f of fragments) {
    if (f.path.slice(FRAGMENT_DIR.length + 1).includes('/')) {
      errors.push(`${f.path} : sous-répertoire interdit dans ${FRAGMENT_DIR}/`);
      continue;
    }
    let text;
    try {
      text = readFile(f.path);
    } catch {
      errors.push(`${f.path} : illisible`);
      continue;
    }
    const p = parseFragment(text);
    for (const e of p.errors) errors.push(`${f.path} : ${e}`);
    if (wanted.length === 0 || wanted.some((s) => p.stories.has(s))) cites = true;
    notes.push(
      p.exemption !== null
        ? `${f.path} : exemption (${p.exemption})`
        : `${f.path} : ${p.blocks.reduce((n, b) => n + b.bullets.length, 0)} entrée(s)`,
    );
  }
  if (!cites) {
    errors.push(`aucun fragment ne cite une story de la branche (${wanted.join(', ')})`);
  }
  return { errors, notes };
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Changements de la PR : merge-base(base, head)..head, sans renommages. */
export function collectChanges(root, base, head) {
  const mb = git(root, ['merge-base', base, head]).trim();
  const out = git(root, ['diff', '--name-status', '--no-renames', '-z', `${mb}..${head}`]);
  const parts = out.split('\0').filter((s) => s !== '');
  const changes = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    changes.push({ status: parts[i][0], path: parts[i + 1] });
  }
  return { mergeBase: mb, changes };
}

export function runCheck({ root, base, head, branch }) {
  let changes;
  try {
    ({ changes } = collectChanges(root, base, head));
  } catch (e) {
    return { errors: [`calcul git impossible (${base}…${head}) : ${e.message.split('\n')[0]}`] };
  }
  const readFile = (p) => git(root, ['show', `${head}:${p}`]);
  return evaluate({ changes, branch, readFile });
}

// ---------------------------------------------------------------------------------------------
// Release : versement des fragments dans CHANGELOG.md.

/** Analyse le corps d'une section : { preamble: [lignes], lots: Map(lot -> {title, modules}) }. */
export function parseSection(lines) {
  const preamble = [];
  const lots = new Map();
  let lot = null;
  let mod = null;
  for (const line of lines) {
    let m;
    if ((m = /^### Lot (L[0-5]|LC)\b(.*)$/.exec(line))) {
      lot = lots.get(m[1]) ?? { title: line, modules: new Map() };
      lots.set(m[1], lot);
      mod = null;
    } else if ((m = /^#### (.+)$/.exec(line)) && lot) {
      mod = lot.modules.get(m[1]) ?? [];
      lot.modules.set(m[1], mod);
    } else if (mod && /^- /.test(line)) {
      mod.push(line.slice(2));
    } else if (!lot) {
      preamble.push(line);
    } else if (line.trim() !== '') {
      throw new Error(`ligne hors module dans ${UNRELEASED} : « ${line.slice(0, 60)} »`);
    }
  }
  return { preamble, lots };
}

/** Ajoute le numéro de PR dans la parenthèse finale, ou en fin d'entrée. */
export function withPr(entry, pr) {
  return /\)$/.test(entry) ? entry.replace(/\)$/, `, #${pr})`) : `${entry} (#${pr})`;
}

export function renderLots(lots) {
  const out = [];
  const order = [...lots.keys()].sort();
  for (const k of order) {
    const lot = lots.get(k);
    out.push(lot.title, '');
    for (const [name, bullets] of lot.modules) {
      if (bullets.length === 0) continue;
      out.push(`#### ${name}`, '', ...bullets.map((b) => `- ${b}`), '');
    }
  }
  return out;
}

/**
 * Pur : rend le nouveau CHANGELOG. `fragments` = [{ path, text, pr }] (pr : numéro ou null).
 */
export function applyRelease({ changelog, fragments, version, date }) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const start = lines.indexOf(UNRELEASED);
  if (start < 0) throw new Error(`${CHANGELOG} : section « ${UNRELEASED} » absente`);
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  if (lines.some((l) => l.startsWith(`## [${version}]`))) {
    throw new Error(`${CHANGELOG} : la version ${version} existe déjà`);
  }
  const { preamble, lots } = parseSection(lines.slice(start + 1, end));
  for (const f of fragments) {
    const p = parseFragment(f.text);
    if (p.errors.length) throw new Error(`${f.path} : ${p.errors.join(' ; ')}`);
    for (const b of p.blocks) {
      const lot = lots.get(b.lot) ?? { title: `### Lot ${b.lot}`, modules: new Map() };
      lots.set(b.lot, lot);
      const mod = lot.modules.get(b.module) ?? [];
      lot.modules.set(b.module, mod);
      for (const e of b.bullets) {
        mod.push(f.pr && !/#\d+/.test(e) ? withPr(e, f.pr) : e);
      }
    }
  }
  const trimmed = [...preamble];
  while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop();
  const released = [`## [${version}] — ${date}`, '', ...renderLots(lots)];
  return [...lines.slice(0, start + 1), ...trimmed, '', ...released, ...lines.slice(end)].join(
    '\n',
  );
}

export function runRelease({ root, version, date }) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('--version x.y.z exigé');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('--date AAAA-MM-JJ exigé');
  const notes = readFileSync(join(root, RELEASE_NOTES), 'utf8');
  if (!new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm').test(notes)) {
    throw new Error(
      `${RELEASE_NOTES} : section « ## ${version} » absente (notes de version en français exigées)`,
    );
  }
  const dir = join(root, FRAGMENT_DIR);
  const names = existsSync(dir)
    ? readdirSync(dir).filter((n) => n.endsWith('.md') && n !== 'README.md')
    : [];
  const fragments = names.sort().map((n) => {
    const path = `${FRAGMENT_DIR}/${n}`;
    let pr;
    try {
      const subj = git(root, [
        'log',
        '--first-parent',
        '--diff-filter=A',
        '--format=%s',
        '--',
        path,
      ])
        .trim()
        .split('\n')
        .pop();
      pr = /^Merge pull request #(\d+)/.exec(subj ?? '')?.[1] ?? null;
    } catch {
      pr = null;
    }
    return { path, text: readFileSync(join(root, path), 'utf8'), pr };
  });
  const file = join(root, CHANGELOG);
  writeFileSync(
    file,
    applyRelease({ changelog: readFileSync(file, 'utf8'), fragments, version, date }),
  );
  for (const f of fragments) rmSync(join(root, f.path));
  return fragments.length;
}

function parseArgs(argv) {
  const o = { cmd: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--') || argv[i + 1] === undefined)
      throw new Error(`argument invalide : ${k}`);
    o[k.slice(2)] = argv[++i];
  }
  return o;
}

function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`changelog : ${escapeWorkflow(e.message)}`);
    process.exit(2);
  }
  const root = o.root ?? '.';
  if (o.cmd === 'check') {
    const r = runCheck({
      root,
      base: o.base ?? 'origin/main',
      head: o.head ?? 'HEAD',
      branch: o.branch ?? '',
    });
    for (const n of r.notes ?? []) console.log(`changelog : ${escapeWorkflow(n)}`);
    if (r.errors.length) {
      for (const e of r.errors) console.error(`::error title=changelog::${escapeWorkflow(e)}`);
      process.exit(1);
    }
    console.log('changelog : OK');
  } else if (o.cmd === 'release') {
    try {
      const n = runRelease({ root, version: o.version, date: o.date });
      console.log(`changelog : version ${o.version} écrite, ${n} fragment(s) versé(s)`);
    } catch (e) {
      console.error(`changelog : ${escapeWorkflow(e.message)}`);
      process.exit(1);
    }
  } else {
    console.error('usage : changelog.mjs check|release …');
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
