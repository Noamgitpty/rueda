/**
 * `pnpm lint` (étape « styles ») : échoue si un composant contient une couleur, une police, une
 * taille, une graisse, un espacement, un rayon, une ombre ou une durée codés en dur (US-030).
 *
 * Usage : node packages/tokens/lint/cli.ts [--root <racine du dépôt>]
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { lintStyleTree } from './tree.ts';

const { values } = parseArgs({ options: { root: { type: 'string' } } });
const result = lintStyleTree(resolve(values.root ?? process.cwd()));

for (const f of result.findings) {
  console.error(
    `${f.file}:${f.line}:${f.column}  error  ${f.message} (« ${f.text} »)  rueda/no-hardcoded-style:${f.rule}`,
  );
}
if (result.findings.length > 0) {
  console.error(
    `\nstyles : ${result.findings.length} erreur(s) dans ${result.filesScanned} fichier(s).`,
  );
  process.exitCode = 1;
} else {
  console.log(`styles : OK (${result.filesScanned} fichier(s) de composants analysé(s)).`);
}
