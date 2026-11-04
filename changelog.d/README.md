# Fragments de CHANGELOG (`changelog.d/`)

Chaque PR qui modifie du **code livré** ajoute ici **un fichier** `changelog.d/<branche>.md` (par exemple `US-040-changelog.md`). Le job CI `changelog` ([`scripts/ci/changelog.mjs`](../scripts/ci/changelog.mjs), ADR-085) échoue sinon. Un fichier par PR : deux PR parallèles ne se heurtent jamais, contrairement à des lignes ajoutées au même endroit de `CHANGELOG.md`.

## Format

```text
lot: L0
module: Réservation
- Ajouté : conversion gardée du hold en réservation (US-024)
- Corrigé : la compensation libère aussi le tampon (US-024)
```

- `lot:` vaut `L0` à `L5` ou `LC` (lots de `docs/specs/19_DEVELOPMENT_BACKLOG.md`), puis `module:` donne le module ; plusieurs blocs `lot:` / `module:` sont permis.
- Chaque entrée commence par une catégorie : `Ajouté`, `Modifié`, `Corrigé`, `Retiré`, `Obsolète` ou `Sécurité`, suivie de « : ». Elle cite au moins une story (`US-xxx`). Au moins un fragment de la PR cite une story de la branche.
- Le numéro de PR n'est pas à écrire : il est ajouté au versement, depuis le commit de fusion.
- Les lignes `<!-- … -->` sont ignorées.

## Exemptions

- **Automatique** : une PR dont tous les fichiers sont sous `docs/`, ou des `*.md` hors de `scripts/` et `.github/` (rapports de revue, passations, README, notes). Aucun fragment n'est demandé.
- **Justifiée** : une PR de code sans effet à consigner (renommage interne, test seul…) ajoute un fragment d'une seule ligne, relu en revue de code :

  ```text
  exemption: US-040 — test de non-régression seul, aucun comportement livré ne change
  ```

  La raison fait au moins 20 caractères. Les exemptions disparaissent au versement : leur trace ne reste alors que dans l'historique git (le fragment, sa PR et la revue de code).

## Versement

À une mise en production, l'orchestrateur écrit d'abord la section `## x.y.z` de [`docs/NOTES_DE_VERSION.md`](../docs/NOTES_DE_VERSION.md) (en français, pour le fondateur), puis lance :

```bash
node scripts/ci/changelog.mjs release --version x.y.z --date AAAA-MM-JJ
```

La commande refuse si les notes manquent. Sinon, elle verse le contenu de « Non publié » et des fragments dans `## [x.y.z] — date` de `CHANGELOG.md`, par lot et par module, ajoute les numéros de PR, puis supprime les fragments. Le commit qui en résulte ne touche que des `*.md` : il est exempté.

Contrôle local avant de pousser : `pnpm lint:changelog` (compare à `origin/main`).
