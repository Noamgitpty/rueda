#!/usr/bin/env node
// Journal des déploiements (US-003, ADR-078 ; runbook docs/ops/DEPLOY.md).
//
// Un fichier JSON Lines, en ajout seul : une ligne par étape de déploiement ou de retour arrière.
// En préproduction et en production cloud, le pipeline écrit les mêmes lignes dans le résumé du run
// GitHub Actions (journaux conservés au moins 1 an, OPERATING_RULES §6) et dans le compartiment
// privé à verrouillage d'objet (`ops/deployments/`, infra/opentofu) ; en local, dans un fichier.
//
// Ligne : { at, environment, action, release, image, outcome, from?, reason? }
//   action  : DEPLOY | ROLLBACK
//   outcome : STARTED | SUCCEEDED | FAILED
//   image   : identifiant immuable (sha256:… ou référence @sha256:…), jamais une étiquette mobile.
//
// Usage :
//   node scripts/deploy/journal.mjs record  --journal F --environment E --action A --outcome O
//                                           --release R --image I [--from I] [--reason TEXTE]
//   node scripts/deploy/journal.mjs current  --journal F --environment E   (dernière image servie)
//   node scripts/deploy/journal.mjs previous --journal F --environment E   (cible d'un retour arrière)
//   node scripts/deploy/journal.mjs check-promotion --journal F --image I --from-environment E
//        (refuse une image jamais servie avec succès dans E : porte « préproduction d'abord »)
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const ACTIONS = ['DEPLOY', 'ROLLBACK'];
export const OUTCOMES = ['STARTED', 'SUCCEEDED', 'FAILED'];
const ENVIRONMENT = /^[a-z][a-z0-9-]{0,40}$/;
/** Identifiant d'image immuable : sha256:<64 hex>, ou <dépôt>@sha256:<64 hex>. */
export const IMMUTABLE_IMAGE = /^(?:[a-z0-9][a-z0-9._/:-]{0,250}@)?sha256:[0-9a-f]{64}$/;
const RELEASE = /^[A-Za-z0-9._-]{1,80}$/;

export function validateEntry(e) {
  const errors = [];
  if (!ENVIRONMENT.test(e.environment ?? '')) errors.push('environment invalide');
  if (!ACTIONS.includes(e.action)) errors.push('action invalide');
  if (!OUTCOMES.includes(e.outcome)) errors.push('outcome invalide');
  if (!RELEASE.test(e.release ?? '')) errors.push('release invalide');
  if (!IMMUTABLE_IMAGE.test(e.image ?? ''))
    errors.push('image non immuable (empreinte sha256 attendue)');
  if (e.from !== undefined && !IMMUTABLE_IMAGE.test(e.from)) errors.push('from non immuable');
  if (e.reason !== undefined && !/^[\p{L}\p{N} .,;:()'«»_/-]{1,200}$/u.test(e.reason)) {
    errors.push('reason invalide (texte court, sans caractère de contrôle)');
  }
  return errors;
}

export function parseJournal(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l, i) => {
      let e;
      try {
        e = JSON.parse(l);
      } catch {
        throw new Error(`journal : ligne ${i + 1} illisible`);
      }
      const errors = validateEntry(e);
      if (errors.length) throw new Error(`journal : ligne ${i + 1} : ${errors.join(', ')}`);
      return e;
    });
}

/** Images servies avec succès dans `environment`, dans l'ordre (déploiements et retours arrière). */
export function servedHistory(entries, environment) {
  return entries.filter((e) => e.environment === environment && e.outcome === 'SUCCEEDED');
}

/** Dernière image servie avec succès, ou null. */
export function currentImage(entries, environment) {
  const h = servedHistory(entries, environment);
  return h.length ? h[h.length - 1] : null;
}

/**
 * Cible d'un retour arrière : la dernière image servie avec succès AVANT l'image courante et
 * différente d'elle (un retour arrière sur un retour arrière remonte encore d'un cran).
 */
export function previousImage(entries, environment) {
  const h = servedHistory(entries, environment);
  if (h.length === 0) return null;
  const current = h[h.length - 1];
  // historique « effectif » : chaque ROLLBACK réussi annule le déploiement qu'il remplace
  const stack = [];
  for (const e of h) {
    if (e.action === 'ROLLBACK') {
      while (stack.length && stack[stack.length - 1].image !== e.image) stack.pop();
      if (!stack.length) stack.push(e);
    } else if (!stack.length || stack[stack.length - 1].image !== e.image) {
      stack.push(e);
    }
  }
  for (let i = stack.length - 2; i >= 0; i--) {
    if (stack[i].image !== current.image) return stack[i];
  }
  return null;
}

/** Porte de promotion : l'image doit avoir été servie avec succès dans l'environnement amont. */
export function checkPromotion(entries, image, fromEnvironment) {
  return servedHistory(entries, fromEnvironment).some(
    (e) => e.image === image && e.action === 'DEPLOY',
  );
}

function main(argv) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      journal: { type: 'string' },
      environment: { type: 'string' },
      action: { type: 'string' },
      outcome: { type: 'string' },
      release: { type: 'string' },
      image: { type: 'string' },
      from: { type: 'string' },
      reason: { type: 'string' },
      'from-environment': { type: 'string' },
    },
  });
  const file = values.journal;
  if (!file) throw new Error('--journal obligatoire');
  const entries = existsSync(file) ? parseJournal(readFileSync(file, 'utf8')) : [];
  switch (command) {
    case 'record': {
      const entry = {
        at: new Date().toISOString(),
        environment: values.environment,
        action: values.action,
        release: values.release,
        image: values.image,
        outcome: values.outcome,
        ...(values.from ? { from: values.from } : {}),
        ...(values.reason ? { reason: values.reason } : {}),
      };
      const errors = validateEntry(entry);
      if (errors.length) throw new Error(errors.join(', '));
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(entry)}\n`);
      console.log(JSON.stringify(entry));
      return 0;
    }
    case 'current':
    case 'previous': {
      const e = (command === 'current' ? currentImage : previousImage)(entries, values.environment);
      if (!e) return 3;
      console.log(`${e.image} ${e.release}`);
      return 0;
    }
    case 'check-promotion': {
      if (!IMMUTABLE_IMAGE.test(values.image ?? '')) throw new Error('image non immuable');
      if (checkPromotion(entries, values.image, values['from-environment'])) return 0;
      console.error(
        `promotion refusée : ${values.image} n'a jamais été servie avec succès en ${values['from-environment']}`,
      );
      return 4;
    }
    default:
      throw new Error(`commande inconnue : ${command}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`journal : ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
