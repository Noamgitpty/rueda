/**
 * `pnpm lint:sql` (inclus dans `pnpm lint`) : échoue si un fichier `.sql` lit l'horloge
 * autrement que par `platform.now()` (17 §1.3, ADR-030).
 *
 * Usage : node packages/config/sql-clock/cli.ts [--root <dossier>] [--allowlist <fichier>]
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { lintSqlTree } from './lint-tree.ts';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    allowlist: { type: 'string' },
  },
});

const root = resolve(values.root ?? process.cwd());
const result = lintSqlTree(root, values.allowlist ? resolve(values.allowlist) : undefined);

for (const error of result.allowlistErrors) console.error(`sql-clock: ${error}`);
for (const f of result.findings) {
  console.error(`${f.file}:${f.line}:${f.column}  error  ${f.message}  rueda/no-sql-clock`);
}

if (result.findings.length > 0 || result.allowlistErrors.length > 0) {
  console.error(
    `\nsql-clock : ${result.findings.length} erreur(s), ` +
      `${result.allowlistErrors.length} erreur(s) de liste blanche, ${result.filesScanned} fichier(s) SQL.`,
  );
  process.exitCode = 1;
} else {
  console.log(`sql-clock : OK (${result.filesScanned} fichier(s) SQL analysé(s)).`);
}
