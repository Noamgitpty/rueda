/**
 * `pnpm lint:sql` (inclus dans `pnpm lint`) : échoue si une migration de production contient une
 * contraction (suppression, renommage, changement de type, SET NOT NULL, colonne NOT NULL sans
 * défaut, retrait d'un droit applicatif, TRUNCATE, DELETE, UPDATE) qui n'est pas une dérogation
 * justifiée de packages/db/expand-contract-allowlist.json (US-046, ADR-081 ; ADR-078 point 6).
 *
 * Usage : node packages/db/src/expand-contract/cli.ts [--root <dossier>] [--allowlist <fichier>]
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { lintExpandContract } from './lint-tree.ts';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    allowlist: { type: 'string' },
  },
});

const root = resolve(values.root ?? process.cwd());
const result = lintExpandContract(root, values.allowlist ? resolve(values.allowlist) : undefined);

for (const error of result.allowlistErrors) console.error(`sql-expand-contract: ${error}`);
for (const f of result.findings) {
  console.error(
    `${f.file}:${f.line}  error  ${f.kind} : ${f.message}  rueda/sql-expand-contract\n    ${f.statement}`,
  );
}

if (result.findings.length > 0 || result.allowlistErrors.length > 0) {
  console.error(
    `\nsql-expand-contract : ${result.findings.length} contraction(s) sans dérogation, ` +
      `${result.allowlistErrors.length} erreur(s) de dérogation, ${result.filesScanned} migration(s). ` +
      'Découper en expand puis contract (docs/ops/DEPLOY.md), ou inscrire une dérogation justifiée.',
  );
  process.exitCode = 1;
} else {
  console.log(`sql-expand-contract : OK (${result.filesScanned} migration(s) analysée(s)).`);
}
