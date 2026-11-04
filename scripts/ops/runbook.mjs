// Exécution d'un RUNBOOK tel qu'il est écrit (US-051, ADR-082) : les exercices de restauration et
// de rotation n'ont pas leur propre copie des commandes ; ils lisent le runbook Markdown et
// exécutent ses blocs « ```bash <étape> », dans l'ordre, avec `set -euo pipefail`, depuis la racine
// du dépôt. Un runbook modifié change donc l'exercice ; un bloc manquant le fait échouer.
//
//   node scripts/ops/runbook.mjs <runbook.md> <étape>     # exécute les blocs « bash <étape> »
//
// Les variables de l'étape viennent de l'environnement (voir chaque runbook). Aucune valeur n'est
// affichée par ce script.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const STEP = /^[a-z0-9][a-z0-9-]*$/;

/** Blocs « ```bash <étape> » d'un runbook, dans l'ordre (texte exact, fins de ligne LF). */
export function runbookBlocks(markdown, step) {
  if (!STEP.test(step)) throw new Error(`étape invalide : ${step}`);
  const blocks = [];
  let current = null;
  // un bloc peut être indenté (élément de liste) : son indentation est retirée de chaque ligne
  let indent = 0;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (current === null && line.trim() === `\`\`\`bash ${step}`) {
      current = [];
      indent = line.length - line.trimStart().length;
    } else if (current !== null && line.trim().startsWith('```')) {
      blocks.push(current.join('\n'));
      current = null;
    } else if (current !== null) {
      const lead = line.length - line.trimStart().length;
      current.push(line.slice(Math.min(lead, indent)));
    }
  }
  if (current !== null) throw new Error(`bloc « bash ${step} » non fermé`);
  return blocks;
}

/** Exécute les blocs d'une étape ; lève si aucun bloc ou si bash échoue. */
export function runStep(runbook, step, env = process.env) {
  const blocks = runbookBlocks(readFileSync(join(ROOT, runbook), 'utf8'), step);
  if (blocks.length === 0) throw new Error(`${runbook} : aucun bloc « bash ${step} »`);
  const script = ['set -euo pipefail', ...blocks].join('\n');
  const r = spawnSync('bash', ['-c', script], { cwd: ROOT, env, stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`${runbook} : étape « ${step} » en échec (code ${String(r.status)})`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [runbook, step] = process.argv.slice(2);
  if (runbook === undefined || step === undefined) {
    console.error('usage : node scripts/ops/runbook.mjs <runbook.md> <étape>');
    process.exit(2);
  }
  try {
    runStep(runbook, step);
  } catch (error) {
    console.error(`[runbook] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
