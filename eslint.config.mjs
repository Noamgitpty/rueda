// Configuration ESLint racine (flat config). Les règles maison sont dans packages/config/eslint ;
// le graphe des dépendances entre modules est une donnée de apps/api (17 §2.2).
// Node 26 charge directement les fichiers .ts importés ici (suppression native des types).
import { fileURLToPath } from 'node:url';
import { toModuleBoundariesOptions } from './apps/api/src/modules/dependency-graph.ts';
import {
  loadCountryExemptions,
  loadCountryTokens,
} from './packages/config/country-constants/tokens.ts';
import { createConfig } from './packages/config/eslint/index.ts';

// Jetons « propres à un pays » tirés des données CFG (US-013, ADR-024) : rueda/no-country-constants.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default createConfig({
  moduleBoundaries: toModuleBoundariesOptions(),
  countryTokens: loadCountryTokens(repoRoot),
  countryExemptions: loadCountryExemptions(repoRoot).files,
});
