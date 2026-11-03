#!/usr/bin/env node
// Contrôle « revues présentes, relecteur ≠ auteur » (US-029 critère 2, US-050).
// Usage : node scripts/team/check-reviews.mjs US-001 --require code,qa [--author-model claude-opus-5-5] [--root .] [--base main] [--exempt a/,b.md]
// Sans --author-model, le modèle de l'auteur est lu dans les pieds `Agent-Model:` des commits `<base>..HEAD`
// (`--base` vaut `main` par défaut ; la CI passe `--base origin/main`, US-002).
// `--root` désigne le dépôt contrôlé, distinct du dossier du script : la CI exécute ce fichier tel qu'il
// est sur la branche de base, contre la pointe de la PR (US-050).
// Revue périmée (US-050) : un fichier livré par la PR et modifié après le sha revu fait échouer, sauf
// rapports docs/team/reviews/<story>/, passation docs/team/handoffs/<story>.md et chemins `--exempt`.
// Code de sortie 0 si tout est conforme, 1 sinon (bloque la fusion quand US-002 le branche en CI).
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Rôles dont la revue doit venir d'une autre famille (19 §1.9 point 4) ; sinon « revue dégradée » explicite.
const FAMILY_B_ROLES = new Set(['argent', 'securite']);

// Rôles de vérification : leurs commits (rapports) ne comptent pas comme « auteur ».
// Les alias `revue-<rôle>` (nom du fichier docs/team/roles/revue-*.md) valent le rôle court.
export const REVIEW_ROLES = new Set([
  'revue-code',
  'qa',
  'securite',
  'argent',
  'architecture',
  'ux',
  'red-team',
  'revue-ux',
  'revue-architecture',
  'revue-securite',
  'revue-argent',
  'revue-qa',
]);

export function parseReview(text) {
  const reviewer = /^Relecteur\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  // Modèle du relecteur = premier mot après « rôle / » (le reste de la ligne peut citer l'auteur).
  const reviewerModel = /^[^/]+\/\s*\**([^\s(,*]+)/.exec(reviewer ?? '')?.[1] ?? null;
  const inputs = /^Entrées\s*:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? null;
  const reviewedSha = /\.\.([0-9a-f]{7,40})\b/.exec(inputs ?? '')?.[1] ?? null;
  const hasTable = /^\|\s*#\s*\|/m.test(text);
  const verdicts = [...text.matchAll(/^Verdict\s*:\s*(APPROUVÉ|CHANGEMENTS DEMANDÉS)\s*$/gm)];
  const verdict = verdicts.length ? verdicts[verdicts.length - 1][1] : null;
  // Constat CRITIQUE non clos : ligne de tableau gravité CRITIQUE dont la décision ne dit pas corrigé / résolu.
  const openCritical = text
    .split(/\r?\n/)
    .filter(
      (l) =>
        /^\|[^|]*\|\s*\**CRITIQUE\**\s*\|/.test(l) &&
        !/(?<!non\s)(?<!pas\s)(corrigé|résolu)/i.test(l),
    ).length;
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

// Un chemin finissant par « / » couvre le répertoire ; sinon correspondance exacte.
const under = (file, path) => (path.endsWith('/') ? file.startsWith(path) : file === path);

// Chemins qu'une revue n'a pas à couvrir : rapports et passation de la story, plus `exempt`
// (les `sharedPaths` de docs/team/review-requirements.json, transmis par la CI).
export function reviewExemptPaths(story, exempt = []) {
  return [`docs/team/reviews/${story}/`, `docs/team/handoffs/${story}.md`, ...exempt];
}

export function checkReviews({
  story,
  required,
  authorModels,
  root = '.',
  isAncestor = null,
  staleFiles = null,
  exempt = [],
}) {
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
      if (r.reviewerModel && r.reviewerModel.toLowerCase().startsWith(m.toLowerCase())) {
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
      else if (staleFiles) {
        const free = reviewExemptPaths(story, exempt);
        let stale;
        try {
          stale = staleFiles(r.reviewedSha).filter(({ file }) => !free.some((p) => under(file, p)));
        } catch {
          stale = [{ file: '(diff git impossible à calculer)' }];
        }
        for (const { file, baseMoved } of stale) {
          errors.push(
            `revue ${role} périmée : ${file} modifié après ${r.reviewedSha}` +
              (baseMoved ? ' (la base a aussi changé ce fichier depuis la revue)' : ''),
          );
        }
      }
    }
  }
  return errors;
}

// Modèles des commits d'auteur sur <base>..HEAD. `log` : messages séparés par \u0000 ;
// `filesOf(i)` : fichiers du i-ème commit (null si inconnus). Un commit signé d'un rôle de
// vérification n'est écarté que si TOUS ses fichiers sont sous docs/team/reviews/ (US-050) :
// un relecteur qui écrit du code compte comme auteur. Fichiers inconnus ou commit vide : auteur.
export function authorModelsFromLog(log, filesOf = () => null) {
  const models = new Set();
  log.split('\u0000').forEach((msg, i) => {
    const role = /^Agent-Role:\s*(\S+)/m.exec(msg)?.[1];
    const model = /^Agent-Model:\s*(\S+)/m.exec(msg)?.[1];
    if (!model) return;
    const files = REVIEW_ROLES.has(role) ? filesOf(i) : null;
    const reportsOnly =
      Array.isArray(files) &&
      files.length > 0 &&
      files.every((f) => f.startsWith('docs/team/reviews/'));
    if (!reportsOnly) models.add(model);
  });
  return [...models];
}

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

// Fichiers modifiés entre deux arbres. `--no-renames` : chemin de départ et chemin d'arrivée.
const diffNames = (root, a, b) =>
  git(root, ['diff', '--name-only', '--no-renames', '-z', a, b, '--']).split('\0').filter(Boolean);

export function authorModelsFromGit(root, base) {
  try {
    const shas = git(root, ['log', '--format=%H', `${base}..HEAD`])
      .split('\n')
      .filter(Boolean);
    const log = shas.map((sha) => git(root, ['show', '-s', '--format=%B', sha])).join('\u0000');
    // Fichiers d'un commit par rapport à son premier parent (une fusion de main compte donc tout
    // ce qu'elle apporte) ; null si le calcul échoue (commit racine…) : le commit compte comme auteur.
    const filesOf = (i) => {
      try {
        return diffNames(root, `${shas[i]}^1`, shas[i]);
      } catch {
        return null;
      }
    };
    return authorModelsFromLog(log, filesOf);
  } catch {
    return [];
  }
}

// Fichiers qui rendent périmée la revue du sha X (US-050). Livré par la PR : diff
// merge-base(base, HEAD)..HEAD. Un fichier livré est périmé s'il diffère de son état en X (modifié
// après la revue), ou si la base l'a changé entre merge-base(base, X) et merge-base(base, HEAD) : la
// modification livrée n'est alors plus celle que le relecteur a vue (résolution de conflit qui
// annule un correctif de main, rapport d'une PR déjà fusionnée réutilisé…). Un fichier que seule la
// base a changé (`git merge origin/main`) n'est pas livré : il est ignoré.
export function gitStaleFiles(root, base) {
  return (sha) => {
    const mb = git(root, ['merge-base', base, 'HEAD']).trim();
    const mbx = git(root, ['merge-base', base, sha]).trim();
    const after = new Set(diffNames(root, sha, 'HEAD'));
    const baseMoved = new Set(diffNames(root, mbx, mb));
    return diffNames(root, mb, 'HEAD')
      .filter((file) => after.has(file) || baseMoved.has(file))
      .sort()
      .map((file) => ({ file, baseMoved: !after.has(file) }));
  };
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

// Lecture des arguments de la ligne de commande (exportée pour les tests).
export function parseArgs(argv) {
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const base = opt('base') ?? 'main';
  return {
    story: argv[0],
    root: opt('root') ?? '.',
    required: (opt('require') ?? '').split(',').filter(Boolean),
    authorModel: opt('author-model'),
    exempt: (opt('exempt') ?? '').split(',').filter(Boolean),
    // Une base qui commence par « - » serait lue par git comme une option : refusée.
    base: /^[A-Za-z0-9._/-]+$/.test(base) && !base.startsWith('-') ? base : null,
  };
}

function main(argv) {
  const { story, root, required, authorModel, base, exempt } = parseArgs(argv);
  if (!story || !/^US-\d{3}$/.test(story) || !base) {
    console.error(
      'usage : check-reviews.mjs US-xxx --require code,qa [--author-model m] [--root .] [--base main] [--exempt a/,b.md]',
    );
    return 2;
  }
  const authorModels = authorModel ? [authorModel] : authorModelsFromGit(root, base);
  const errors = checkReviews({
    story,
    required,
    authorModels,
    root,
    isAncestor: gitIsAncestor(root),
    staleFiles: gitStaleFiles(root, base),
    exempt,
  });
  if (errors.length) {
    for (const e of errors) console.error(`ÉCHEC ${e}`);
    return 1;
  }
  console.log(
    `OK ${story} : revues ${required.join(', ')} présentes, approuvées, à jour, relecteur ≠ auteur`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
