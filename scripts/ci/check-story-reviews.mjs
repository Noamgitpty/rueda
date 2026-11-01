#!/usr/bin/env node
// Job CI « revues » (US-002). Ne fait pas confiance au seul nom de branche :
// 1. liste blanche de branches : `story/US-xxx-<slug>` ou un préfixe déclaré dans
//    docs/team/review-requirements.json (`branchPrefixes`) ; toute autre branche échoue ;
// 2. branche à préfixe déclaré : le diff ne touche que ses `allowedPaths`, jamais les
//    `nonStoryForbiddenPaths` (rapports de revue, passations, la règle elle-même) ;
// 3. branche de story : le diff est recoupé avec la story. Un fichier de docs/team/ qui nomme
//    une autre story (passation, revue) échoue, sauf story déclarée `related` ; un répertoire
//    packages/<x>/ doit lister la story dans `pathOwners` (paquet absent : échec) ;
//    les `sharedPaths` (BOARD, RESUME_HERE…) sont tolérés ;
// 4. pour chaque story, `node scripts/team/check-reviews.mjs US-xxx --require <rôles> --base <base>`.
// Les règles sont lues sur la branche de base (une PR ne peut pas affaiblir son propre contrôle) ;
// si la base n'a pas encore le fichier (amorçage), celui de HEAD est utilisé, avec un avertissement.
// Usage : node scripts/ci/check-story-reviews.mjs --branch <nom> [--base origin/main] [--root .]
// Code de sortie : 0 si conforme, 1 sinon, 2 si usage invalide.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CONFIG_PATH = 'docs/team/review-requirements.json';
// story/US-002-integration-continue, story/US-001-US-029-socle, story/US-005 (minuscules, chiffres, tirets).
const STORY_BRANCH = /^story\/(US-\d{3}(?:-US-\d{3})*)(?:-[a-z0-9]+)*$/;

// Stories d'une branche de story conforme ; [] sinon.
export function storiesFromBranch(branch) {
  const m = STORY_BRANCH.exec(branch ?? '');
  return m ? [...new Set(m[1].match(/US-\d{3}/g))] : [];
}

// Un chemin finissant par « / » couvre le répertoire ; sinon correspondance exacte.
const under = (file, path) => (path.endsWith('/') ? file.startsWith(path) : file === path);
const anyUnder = (file, paths = []) => paths.some((p) => under(file, p));

const storyRule = (config, story) => {
  const r = config.stories?.[story];
  return Array.isArray(r) ? { require: r, related: [] } : (r ?? {});
};

export function requiredRoles(story, changedFiles, config) {
  const roles = new Set(config.default ?? []);
  for (const r of storyRule(config, story).require ?? []) roles.add(r);
  for (const rule of config.pathRules ?? []) {
    if (changedFiles.some((f) => anyUnder(f, rule.paths))) {
      for (const r of rule.require) roles.add(r);
    }
  }
  return [...roles].sort();
}

// Décide quoi contrôler pour une branche et son diff. Retourne { stories, errors, note }.
export function evaluateBranch({ branch, changedFiles, config }) {
  const errors = [];
  const stories = storiesFromBranch(branch);
  if (!stories.length) {
    const p = (config.branchPrefixes ?? []).find((x) => (branch ?? '').startsWith(x.prefix));
    if (!p) {
      errors.push(
        `branche « ${branch} » hors liste blanche (story/US-xxx-<slug> ou préfixe de ${CONFIG_PATH})`,
      );
      return { stories, errors };
    }
    if (!/^[a-z0-9/-]+$/.test(branch.slice(p.prefix.length)) || branch === p.prefix) {
      errors.push(`branche « ${branch} » : suffixe invalide après « ${p.prefix} »`);
    }
    for (const f of changedFiles) {
      if (anyUnder(f, config.nonStoryForbiddenPaths)) {
        errors.push(`${f} : interdit hors branche de story (préfixe « ${p.prefix} »)`);
      } else if (!anyUnder(f, p.allowedPaths)) {
        errors.push(`${f} : hors des chemins permis au préfixe « ${p.prefix} »`);
      }
    }
    return { stories, errors, note: `préfixe « ${p.prefix} » : aucune revue de story exigée` };
  }
  const allowed = new Set(stories);
  for (const s of stories) for (const r of storyRule(config, s).related ?? []) allowed.add(r);
  for (const f of changedFiles) {
    if (anyUnder(f, config.sharedPaths)) continue;
    if (f.startsWith('docs/team/')) {
      for (const other of new Set(f.match(/US-\d{3}/g) ?? [])) {
        if (!allowed.has(other)) {
          errors.push(
            `${f} : appartient à ${other}, absente de la branche (${stories.join(', ')})`,
          );
        }
      }
    }
    const pkg = /^packages\/[^/]+\//.exec(f)?.[0];
    if (pkg) {
      const owners = config.pathOwners?.[pkg];
      if (!Array.isArray(owners)) {
        errors.push(`${f} : paquet ${pkg} absent de pathOwners (${CONFIG_PATH})`);
      } else if (!stories.some((s) => owners.includes(s))) {
        errors.push(
          `${f} : ${pkg} réservé à ${owners.join(', ')} (branche : ${stories.join(', ')})`,
        );
      }
    }
  }
  return { stories, errors };
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

// Fichiers touchés par <base>...HEAD. `--no-renames` : un renommage compte comme suppression
// de l'ancien chemin + ajout du nouveau, et les deux chemins sont contrôlés (sinon déplacer
// packages/db/x vers docs/team/ ne montrerait que l'arrivée ; seconde revue sécurité).
// `-z` : noms bruts, sans guillemets ni échappement de core.quotePath.
export function changedFiles(root, base) {
  return git(root, ['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`])
    .split('\0')
    .filter(Boolean);
}

export function loadConfig(root, base) {
  try {
    return { config: JSON.parse(git(root, ['show', `${base}:${CONFIG_PATH}`])), from: base };
  } catch {
    return { config: JSON.parse(readFileSync(join(root, CONFIG_PATH), 'utf8')), from: 'HEAD' };
  }
}

function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const branch = opt('branch');
  const base = opt('base') ?? 'origin/main';
  const root = opt('root') ?? '.';
  if (!branch || !/^[A-Za-z0-9._/-]+$/.test(base) || base.startsWith('-')) {
    console.error('usage : check-story-reviews.mjs --branch <nom> [--base origin/main] [--root .]');
    return 2;
  }
  const { config, from } = loadConfig(root, base);
  if (from !== base) {
    console.log(
      `::warning title=revues::${CONFIG_PATH} absent de ${base} : règles lues sur HEAD (amorçage)`,
    );
  }
  const changed = changedFiles(root, base);
  const { stories, errors, note } = evaluateBranch({ branch, changedFiles: changed, config });
  for (const e of errors) console.error(`ÉCHEC ${e}`);
  if (errors.length) return 1;
  if (note) {
    console.log(`OK ${branch} : ${note} (${changed.length} fichier(s) dans les chemins permis)`);
    return 0;
  }
  let failed = 0;
  for (const story of stories) {
    const roles = requiredRoles(story, changed, config);
    console.log(`${story} : revues exigées ${roles.join(', ')}`);
    const res = spawnSync(
      process.execPath,
      [
        join(root, 'scripts', 'team', 'check-reviews.mjs'),
        story,
        '--require',
        roles.join(','),
        '--base',
        base,
        '--root',
        root,
      ],
      { stdio: 'inherit' },
    );
    if (res.status !== 0) failed++;
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
