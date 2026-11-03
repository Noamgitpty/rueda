/**
 * `pnpm lint:country` (inclus dans `pnpm lint`) : échoue si une migration SQL hors liste blanche
 * contient une constante propre à un pays (US-013, ADR-024). Le TypeScript est couvert par la
 * règle ESLint `rueda/no-country-constants`.
 *
 * Usage : node packages/config/country-constants/cli.ts [--root <dossier>] [--allowlist <fichier>]
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_COUNTRY_ALLOWLIST, lintSqlCountryConstants } from './sql.ts';
import { loadCountryTokens } from './tokens.ts';

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    allowlist: { type: 'string' },
    data: { type: 'string' },
  },
});

const root = resolve(values.root ?? process.cwd());
const tokens = loadCountryTokens(resolve(values.data ?? root));
const result = lintSqlCountryConstants(root, tokens, values.allowlist ?? DEFAULT_COUNTRY_ALLOWLIST);

for (const error of result.allowlistErrors) console.error(`country-constants: ${error}`);
for (const f of result.findings) {
  console.error(
    `${f.file}:${f.line}  error  « ${f.token} » est propre à un pays : graine générée depuis les données CFG seulement (ADR-024)  rueda/no-country-constants`,
  );
}
if (result.findings.length > 0 || result.allowlistErrors.length > 0) {
  console.error(
    `\ncountry-constants : ${result.findings.length} erreur(s), ${result.allowlistErrors.length} erreur(s) de liste blanche, ${result.filesScanned} fichier(s) SQL.`,
  );
  process.exitCode = 1;
} else {
  console.log(`country-constants : OK (${result.filesScanned} fichier(s) SQL analysé(s)).`);
}
