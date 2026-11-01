#!/usr/bin/env node
// Job CI « revues » (US-002) : déduit les stories US-xxx du nom de branche `story/US-xxx-…`,
// calcule les rôles de revue exigés (docs/team/review-requirements.json) et lance
// `node scripts/team/check-reviews.mjs US-xxx --require <rôles> --base <base>` pour chacune.
// Usage : node scripts/ci/check-story-reviews.mjs --branch story/US-002-x [--base origin/main] [--root .]
// Code de sortie : 0 si conforme (ou branche hors story : rien à contrôler), 1 sinon, 2 si usage invalide.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// `story/US-001-US-029-integration` → ['US-001', 'US-029'] ; hors `story/` → [].
export function storiesFromBranch(branch) {
  const m = /^story\/((?:US-\d{3}-)+)/.exec(`${branch ?? ''}-`);
  if (!m) return [];
  return [...new Set(m[1].match(/US-\d{3}/g))];
}

// Un chemin de règle finissant par « / » couvre le répertoire ; sinon correspondance exacte.
const touches = (file, path) => (path.endsWith('/') ? file.startsWith(path) : file === path);

export function requiredRoles(story, changedFiles, config) {
  const roles = new Set(config.default ?? []);
  for (const r of config.stories?.[story] ?? []) roles.add(r);
  for (const rule of config.pathRules ?? []) {
    if (changedFiles.some((f) => rule.paths.some((p) => touches(f, p)))) {
      for (const r of rule.require) roles.add(r);
    }
  }
  return [...roles].sort();
}

function changedFilesFromGit(root, base) {
  const out = execFileSync('git', ['-C', root, 'diff', '--name-only', `${base}...HEAD`], {
    encoding: 'utf8',
  });
  return out.split(/\r?\n/).filter(Boolean);
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
  const stories = storiesFromBranch(branch);
  if (!stories.length) {
    console.log(`branche « ${branch} » hors convention story/US-xxx-… : aucune revue contrôlée`);
    return 0;
  }
  const config = JSON.parse(
    readFileSync(join(root, 'docs', 'team', 'review-requirements.json'), 'utf8'),
  );
  const changed = changedFilesFromGit(root, base);
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
