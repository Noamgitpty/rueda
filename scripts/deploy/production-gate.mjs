#!/usr/bin/env node
// Porte d'ACCORD DU FONDATEUR avant toute action en production (US-003 durcissement, ADR-084 ;
// revue sécurité US-003, constat 2). Lancée par .github/workflows/deploy.yml, AVANT les
// identifiants AWS, pour `deploy production` ET `rollback production`.
//
// L'approbation d'un environnement GitHub est un réglage du dépôt : s'il manque, GitHub crée
// l'environnement SANS protection au premier run et le job part sans accord. Cette porte refuse
// donc (fail-closed) tant que le réglage n'est pas en place, et exige l'accord du run courant :
//   1. l'environnement existe et porte une règle `required_reviewers` avec au moins un approbateur ;
//   2. il restreint les branches qui peuvent y déployer (`deployment_branch_policy` non nul) ;
//   3. le run courant a été APPROUVÉ pour cet environnement, par une personne (pas un bot) qui
//      n'est ni l'auteur du déclenchement ni l'acteur du run : le compte des agents ne peut pas
//      s'auto-approuver, même s'il figurait parmi les approbateurs ;
//   4. aucun refus n'est enregistré pour cet environnement sur ce run.
// Les deux documents viennent de l'API GitHub, lus avec le jeton éphémère du job (`actions: read`) :
//   GET /repos/<dépôt>/environments/<env>            (--environment-json)
//   GET /repos/<dépôt>/actions/runs/<run>/approvals  (--approvals-json)
//
// Usage : node scripts/deploy/production-gate.mjs --environment production
//           --environment-json F --approvals-json F --actor LOGIN --triggering-actor LOGIN
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** Erreurs de la porte (liste vide = accord vérifié). Entrées : documents JSON de l'API GitHub. */
export function checkProductionGate({
  environmentName,
  environment,
  approvals,
  actor,
  triggeringActor,
}) {
  const errors = [];
  if (typeof environmentName !== 'string' || environmentName === '') {
    return ['environnement visé absent'];
  }
  if (!environment || environment.name !== environmentName) {
    errors.push(`environnement GitHub « ${environmentName} » introuvable`);
    return errors;
  }
  const rules = Array.isArray(environment.protection_rules) ? environment.protection_rules : [];
  const reviewers = rules
    .filter((r) => r && r.type === 'required_reviewers')
    .flatMap((r) => (Array.isArray(r.reviewers) ? r.reviewers : []));
  if (reviewers.length === 0) {
    errors.push(`« ${environmentName} » n'exige aucun approbateur (required reviewers)`);
  }
  if (!environment.deployment_branch_policy) {
    errors.push(
      `« ${environmentName} » accepte toutes les branches (deployment_branch_policy absente)`,
    );
  }

  const forThis = (Array.isArray(approvals) ? approvals : []).filter(
    (a) =>
      a &&
      Array.isArray(a.environments) &&
      a.environments.some((e) => e && e.name === environmentName),
  );
  if (forThis.some((a) => a.state !== 'approved')) {
    errors.push(`un refus est enregistré pour « ${environmentName} » sur ce run`);
  }
  const excluded = new Set(
    [actor, triggeringActor].filter((l) => typeof l === 'string' && l !== ''),
  );
  if (excluded.size === 0) errors.push('acteur du run inconnu');
  const valid = forThis.filter(
    (a) =>
      a.state === 'approved' &&
      a.user &&
      typeof a.user.login === 'string' &&
      a.user.login !== '' &&
      a.user.type !== 'Bot' &&
      !excluded.has(a.user.login),
  );
  if (valid.length === 0) {
    errors.push(
      `aucune approbation de « ${environmentName} » sur ce run par une personne autre que celle qui l'a lancé`,
    );
  }
  return errors;
}

function main() {
  const { values } = parseArgs({
    options: {
      environment: { type: 'string' },
      'environment-json': { type: 'string' },
      'approvals-json': { type: 'string' },
      actor: { type: 'string' },
      'triggering-actor': { type: 'string' },
    },
  });
  let environment;
  let approvals;
  try {
    environment = JSON.parse(readFileSync(values['environment-json'] ?? '', 'utf8'));
    approvals = JSON.parse(readFileSync(values['approvals-json'] ?? '', 'utf8'));
  } catch {
    console.error('::error title=porte de production::réponses de l’API GitHub illisibles');
    process.exit(1);
  }
  const errors = checkProductionGate({
    environmentName: values.environment,
    environment,
    approvals,
    actor: values.actor,
    triggeringActor: values['triggering-actor'],
  });
  if (errors.length) {
    for (const e of errors) console.error(`::error title=porte de production::${e}`);
    console.error('Voir docs/ops/DEPLOY.md §4 étape 0 (environnement protégé) et §5.');
    process.exit(1);
  }
  console.log(
    `porte de production : environnement « ${values.environment} » protégé, run approuvé`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
