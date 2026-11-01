#!/usr/bin/env node
// Contrôle « revues présentes, relecteur ≠ auteur » (US-029 critère 2, US-050).
// Usage : node scripts/team/check-reviews.mjs US-001 --require code,qa [--author-model claude-opus-5-5] [--root .]
// Sans --author-model, le modèle de l'auteur est lu dans les pieds `Agent-Model:` des commits `main..HEAD`.
// Code de sortie 0 si tout est conforme, 1 sinon (bloque la fusion quand US-002 le branche en CI).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Rôles dont la revue doit venir d'une autre famille (19 §1.9 point 4) ; sinon « revue dégradée » explicite.
const FAMILY_B_ROLES = new Set(['argent', 'securite']);

// Rôles de vérification : leurs commits (rapports) ne comptent pas comme « auteur ».
export const REVIEW_ROLES = new Set([
  'revue-code',
  'qa',
  'securite',
  'argent',
  'architecture',
  'ux',
  'red-team',
]);

export function parseReview(text) {
  const reviewer = /^Relecteur\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  // Modèle du relecteur = premier mot après « rôle / » (le reste de la ligne peut citer l'auteur).
  const reviewerModel = /^[^/]+\/\s*([^\s(,]+)/.exec(reviewer ?? '')?.[1] ?? null;
  const inputs = /^Entrées\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const reviewedSha = /\.\.([0-9a-f]{7,40})\b/.exec(inputs ?? '')?.[1] ?? null;
  const hasTable = /^\|\s*#\s*\|/m.test(text);
  const verdicts = [...text.matchAll(/^Verdict\s*:\s*(APPROUVÉ|CHANGEMENTS DEMANDÉS)\s*$/gm)];
  const verdict = verdicts.length ? verdicts[verdicts.length - 1][1] : null;
  // Constat CRITIQUE non clos : ligne de tableau gravité CRITIQUE dont la décision ne dit pas corrigé / résolu.
  const openCritical = text
    .split(/\r?\n/)
    .filter((l) => /^\|[^|]*\|\s*CRITIQUE\s*\|/.test(l) && !/corrigé|résolu/i.test(l)).length;
  const degraded = /revue dégradée/i.test(text);
  const familyB = /famille\s*B/i.test(reviewer ?? '') && !degraded;
  return {
    reviewer,
    reviewerModel,
    inputs,
    reviewedSha,
    hasTable,
    verdict,
    openCritical,
    familyB,
    degraded,
  };
}

export function checkReviews({ story, required, authorModels, root = '.', isAncestor = null }) {
  const errors = [];
  if (!required.length) errors.push(`${story} : aucune revue requise demandée (--require vide)`);
  if (!authorModels.length) {
    errors.push(
      `${story} : modèle de l'auteur introuvable (pieds Agent-Model absents ; passer --author-model)`,
    );
  }
  const dir = join(root, 'docs', 'team', 'reviews', story);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
  for (const role of required) {
    const matches = files.filter((f) => f.startsWith(`${role}-`)).sort();
    if (!matches.length) {
      errors.push(`${story} : rapport de revue « ${role} » absent (${dir}/${role}-<date>.md)`);
      continue;
    }
    const latest = matches[matches.length - 1];
    const r = parseReview(readFileSync(join(dir, latest), 'utf8'));
    if (!r.reviewer || !r.reviewerModel)
      errors.push(`${latest} : ligne « Relecteur : <rôle> / <modèle> » absente`);
    if (!r.inputs || !r.hasTable)
      errors.push(
        `${latest} : gabarit incomplet (ligne « Entrées : » ou tableau des constats absent)`,
      );
    if (r.verdict !== 'APPROUVÉ')
      errors.push(`${latest} : verdict « ${r.verdict ?? 'absent'} » (APPROUVÉ requis)`);
    if (r.verdict === 'APPROUVÉ' && r.openCritical)
      errors.push(`${latest} : APPROUVÉ avec ${r.openCritical} constat(s) CRITIQUE non clos`);
    for (const m of authorModels) {
      if (r.reviewerModel && r.reviewerModel.toLowerCase() === m.toLowerCase()) {
        errors.push(`${latest} : le relecteur utilise le même modèle que l'auteur (${m})`);
      }
    }
    if (FAMILY_B_ROLES.has(role) && !r.familyB && !r.degraded) {
      errors.push(`${latest} : revue ${role} ni en famille B ni marquée « revue dégradée »`);
    }
    if (isAncestor) {
      if (!r.reviewedSha)
        errors.push(`${latest} : sha revu absent de « Entrées : » (format <base>..<sha>)`);
      else if (!isAncestor(r.reviewedSha))
        errors.push(`${latest} : le sha revu ${r.reviewedSha} n'est pas un ancêtre de HEAD`);
    }
  }
  return errors;
}

// Modèles des commits d'auteur (hors rôles de vérification) sur main..HEAD.
export function authorModelsFromLog(log) {
  const models = new Set();
  for (const msg of log.split('\u0000')) {
    const role = /^Agent-Role:\s*(\S+)/m.exec(msg)?.[1];
    const model = /^Agent-Model:\s*(\S+)/m.exec(msg)?.[1];
    if (model && !REVIEW_ROLES.has(role)) models.add(model);
  }
  return [...models];
}

function authorModelsFromGit(root) {
  try {
    const log = execFileSync('git', ['-C', root, 'log', 'main..HEAD', '--format=%B%x00'], {
      encoding: 'utf8',
    });
    return authorModelsFromLog(log);
  } catch {
    return [];
  }
}

function gitIsAncestor(root) {
  return (sha) => {
    try {
      execFileSync('git', ['-C', root, 'merge-base', '--is-ancestor', sha, 'HEAD'], {
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  };
}

function main(argv) {
  const story = argv[0];
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (!story || !/^US-\d{3}$/.test(story)) {
    console.error(
      'usage : check-reviews.mjs US-xxx --require code,qa [--author-model m] [--root .]',
    );
    return 2;
  }
  const root = opt('root') ?? '.';
  const required = (opt('require') ?? '').split(',').filter(Boolean);
  const authorModels = opt('author-model') ? [opt('author-model')] : authorModelsFromGit(root);
  const errors = checkReviews({
    story,
    required,
    authorModels,
    root,
    isAncestor: gitIsAncestor(root),
  });
  if (errors.length) {
    for (const e of errors) console.error(`ÉCHEC ${e}`);
    return 1;
  }
  console.log(
    `OK ${story} : revues ${required.join(', ')} présentes, approuvées, relecteur ≠ auteur`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
