/**
 * `pnpm lint:sql` (inclus dans `pnpm lint`) : échoue si une migration de production lit
 * `platform.deployment_env()` autrement que par `COALESCE(platform.deployment_env(), 'production')`
 * (fail-closed sur NULL, C19 ; US-043, ADR-077).
 *
 * Usage : node packages/config/sql-env-guard/cli.ts [--root <dossier>] [--allowlist <fichier>]
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { lintEnvGuards } from './lint-tree.ts';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    allowlist: { type: 'string' },
  },
});

const root = resolve(values.root ?? process.cwd());
const result = lintEnvGuards(root, values.allowlist ? resolve(values.allowlist) : undefined);

for (const error of result.allowlistErrors) console.error(`sql-env-guard: ${error}`);
for (const f of result.findings) {
  console.error(`${f.file}:${f.line}:${f.column}  error  ${f.message}  rueda/sql-env-guard`);
}

if (result.findings.length > 0 || result.allowlistErrors.length > 0) {
  console.error(
    `\nsql-env-guard : ${result.findings.length} erreur(s), ` +
      `${result.allowlistErrors.length} erreur(s) de liste blanche, ${result.filesScanned} migration(s).`,
  );
  process.exitCode = 1;
} else {
  console.log(`sql-env-guard : OK (${result.filesScanned} migration(s) analysée(s)).`);
}
