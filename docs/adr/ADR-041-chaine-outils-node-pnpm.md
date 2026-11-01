# ADR-041 — Chaîne d'outils : Node.js 26.13 et pnpm 10.34.9

- **Statut** : DÉCIDÉ (orchestrateur, lot 0, 2026-10-31) ; à reporter dans 17 §8.1 (nouvelle ligne, 17 s'arrête à ADR-040)
- **Story** : US-001
- **Références** : 17 §6.1 (« TypeScript de bout en bout (Node.js LTS) », monorepo pnpm + Turborepo) ; handoff §5, P-03 et P-04

## Contexte

Le handoff (§5, 2026-10-30) relevait **Node.js v22.23.2** sur le poste et demandait de figer une version LTS encore maintenue (P-03). Il prévoyait aussi d'installer pnpm par `corepack enable` (P-04). Le poste a depuis reçu Node.js **26.13.0**, installé à l'emplacement officiel `C:\Program Files\nodejs`.

Vérification du calendrier officiel (`nodejs/Release`, `schedule.json`, consulté le 2026-10-31) :

| Ligne  | Début      | LTS active     | Maintenance | Fin de vie |
| ------ | ---------- | -------------- | ----------- | ---------- |
| 22     | 2024-04-24 | 2024-10-29     | 2025-10-21  | 2027-04-30 |
| 24     | 2025-05-06 | 2025-10-28     | 2026-10-20  | 2028-04-30 |
| **26** | 2026-05-05 | **2026-10-28** | 2027-10-20  | 2029-04-30 |

Au 2026-10-31, **Node 26 est donc la ligne LTS active** (depuis le 2026-10-28). Node 24 est passé en maintenance et Node 22 y est depuis 2025.

Node 25 et les versions suivantes **n'embarquent plus corepack**. Le P-04 du handoff (`corepack enable`) n'est donc plus applicable tel quel.

## Décision

- **Node.js 26.13** officiel (`C:\Program Files\nodejs`), figé par :
  - `.nvmrc` = `26.13.0` ;
  - `package.json` → `"engines": { "node": ">=26.13 <27" }`.
- **pnpm 10.34.9**, figé par `"packageManager": "pnpm@10.34.9"`. Il est installé **globalement pour l'utilisateur** dans `%APPDATA%\npm` (aucun droit administrateur). Cette décision **remplace P-04** du handoff.
- **TypeScript 6.0.3**, et non 7.x : `typescript-eslint` 8.71 exige `typescript >=4.8.4 <6.1.0`. Le passage à TypeScript 7 attendra la compatibilité de `typescript-eslint`.
- Fraîcheur : `pnpm-workspace.yaml` impose `minimumReleaseAge: 20160` (aucune version publiée depuis moins de 14 jours). Les versions sont exactes et `pnpm-lock.yaml` est commité.
- Node 26 sait exécuter directement du TypeScript à syntaxe effaçable (suppression native des types). La configuration ESLint racine (`eslint.config.mjs`) en profite pour importer les règles maison (`packages/config/eslint/*.ts`) et le graphe des modules (`dependency-graph.ts`) sans étape de compilation. Ces fichiers doivent donc rester en syntaxe effaçable : pas d'`enum`, pas de `namespace`, pas de propriétés de paramètre.

## Conséquences

- **Piège du PATH** : un Node 22 se trouve dans `C:\Users\<utilisateur>\AppData\Local\hermes\node`. Il peut passer **en premier dans le PATH** et faire échouer `engines`, la suppression native des types ou pnpm. Avant toute commande, chaque agent met donc en tête du PATH :
  - PowerShell : `$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:Path"` ;
  - Git Bash : `export PATH="/c/Program Files/nodejs:/c/Users/<utilisateur>/AppData/Roaming/npm:$PATH"`. Il ne faut pas écrire `$APPDATA/npm` en bash : la variable vaut `C:\…` et le lanceur `pnpm` résout alors un chemin erroné.

  Il vérifie ensuite que `node -v` affiche `v26.13.0`.

- La CI (US-002) devra installer la même version, lue depuis `.nvmrc`, et pnpm 10.34.9, lu depuis `packageManager`. Elle n'a pas besoin de corepack.
- Passage à Node 27 (LTS prévue le 2027-10-20) : il faudra un nouvel ADR et mettre à jour `.nvmrc` et `engines`.

## Alternatives

- **Rester sur Node 22** (le Node installé d'après le handoff) : rejeté. La ligne est en maintenance et sa fin de vie tombe le 2027-04-30, pendant le build probable.
- **Node 24** : rejeté. La ligne est en maintenance depuis le 2026-10-20 alors que Node 26 est la LTS active.
- **corepack** (P-04) : impossible sans installation séparée, puisque corepack n'est plus livré avec Node.
- **npm ou Yarn** : rejetés. 17 §6.1 retient pnpm + Turborepo.
