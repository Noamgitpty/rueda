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

export function parseReview(text) {
  const reviewer = /^Relecteur\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const verdicts = [...text.matchAll(/^Verdict\s*:\s*(APPROUVÉ|CHANGEMENTS DEMANDÉS)\s*$/gm)];
  const verdict = verdicts.length ? verdicts[verdicts.length - 1][1] : null;
  const familyB = /famille\s*B/i.test(reviewer ?? '') && !/revue dégradée/i.test(text);
  const degraded = /revue dégradée/i.test(text);
  return { reviewer, verdict, familyB, degraded };
}

export function checkReviews({ story, required, authorModels, root = '.' }) {
  const errors = [];
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
    if (!r.reviewer) errors.push(`${latest} : ligne « Relecteur : » absente`);
    if (r.verdict !== 'APPROUVÉ') errors.push(`${latest} : verdict « ${r.verdict ?? 'absent'} » (APPROUVÉ requis)`);
    const reviewerLine = (r.reviewer ?? '').toLowerCase();
    for (const m of authorModels) {
      if (m && reviewerLine.includes(m.toLowerCase())) {
        errors.push(`${latest} : le relecteur utilise le même modèle que l'auteur (${m})`);
      }
    }
    if (FAMILY_B_ROLES.has(role) && !r.familyB && !r.degraded) {
      errors.push(`${latest} : revue ${role} ni en famille B ni marquée « revue dégradée »`);
    }
  }
  return errors;
}

function authorModelsFromGit(root) {
  try {
    const log = execFileSync('git', ['-C', root, 'log', 'main..HEAD', '--format=%B'], { encoding: 'utf8' });
    return [...new Set([...log.matchAll(/^Agent-Model:\s*(\S+)/gm)].map((m) => m[1]))];
  } catch {
    return [];
  }
}

function main(argv) {
  const story = argv[0];
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (!story || !/^US-\d{3}$/.test(story)) {
    console.error('usage : check-reviews.mjs US-xxx --require code,qa [--author-model m] [--root .]');
    return 2;
  }
  const root = opt('root') ?? '.';
  const required = (opt('require') ?? 'code').split(',').filter(Boolean);
  const authorModels = opt('author-model') ? [opt('author-model')] : authorModelsFromGit(root);
  const errors = checkReviews({ story, required, authorModels, root });
  if (errors.length) {
    for (const e of errors) console.error(`ÉCHEC ${e}`);
    return 1;
  }
  console.log(`OK ${story} : revues ${required.join(', ')} présentes, approuvées, relecteur ≠ auteur`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
