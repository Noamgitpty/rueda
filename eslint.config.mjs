// Configuration ESLint racine (flat config). Les règles maison sont dans packages/config/eslint ;
// le graphe des dépendances entre modules est une donnée de apps/api (17 §2.2).
// Node 26 charge directement les fichiers .ts importés ici (suppression native des types).
import { toModuleBoundariesOptions } from './apps/api/src/modules/dependency-graph.ts';
import { createConfig } from './packages/config/eslint/index.ts';

export default createConfig({ moduleBoundaries: toModuleBoundariesOptions() });
