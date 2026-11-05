# ADR-085 — CHANGELOG par fragments, exigé par la CI, et notes de version pour le fondateur

- **Statut** : PROPOSÉ (US-040, agent back-end, claude-opus-5-5, 2026-11-04). Revues exigées : code (story) ; **sécurité** (`scripts/ci/`, `.github/`), sur un autre modèle que l'auteur. À reporter dans 17 §8.1 (journal des ADR) et §12 (portes CI).
- **Sources** : 19 US-040 (critères : entrée de CHANGELOG obligatoire à chaque fusion, contrôle CI ; notes de version en français à chaque mise en production), 19 §1.4 (DoD, point 8 « CHANGELOG ») ; revues d'architecture US-011 et US-062 (« aucun CHANGELOG dans le dépôt ») ; ADR-083 (contrôle anti-oubli comparable).

## Contexte

La DoD demande une entrée de CHANGELOG par story, mais le dépôt n'en avait pas. Les PR sont nombreuses et parallèles (jusqu'à dix ouvertes à la fois). Un `CHANGELOG.md` où chaque PR ajoute une ligne sous « Non publié » crée un conflit git à presque chaque fusion, puisque les lignes sont ajoutées au même endroit. Dans ce dépôt, ce conflit coûte cher : résoudre un conflit par une fusion de `main` rend périmées les revues (règle de fraîcheur de `check-story-reviews.mjs`).

## Décision

1. **`CHANGELOG.md`** au format Keep a Changelog, en français, catégories `Ajouté`, `Modifié`, `Corrigé`, `Retiré`, `Obsolète`, `Sécurité`, regroupées par **lot** (`### Lot L0 — …`) et par **module** (`#### …`). Chaque entrée cite sa story et sa PR. L'historique de `main` (75 PR fusionnées au 2026-11-04, de #1 à #77) y est reconstitué sous « Non publié », d'après `git log --merges` et les titres des PR.
2. **Fragments** : chaque PR ajoute `changelog.d/<branche>.md` (format : `changelog.d/README.md`). Un fichier par PR, donc aucun conflit.
3. **Contrôle** `scripts/ci/changelog.mjs check`, job `changelog` de `ci.yml` (PR seulement, `fetch-depth: 0`, pointe de la PR). Diff `merge-base(origin/main, HEAD)..HEAD`, sans renommages. Si un fichier de **code livré** est touché, il faut au moins un fragment ajouté ou modifié, bien formé, et qui cite une story de la branche (`story/US-xxx-…`). **Fail-closed** : base introuvable, diff vide, fragment illisible ou mal formé, entrée sans catégorie ni story font échouer le job.
4. **Exemptions en dur** : tout `docs/`, les `*.md` hors de `scripts/` et `.github/`, `CHANGELOG.md` et `changelog.d/`. Les rapports de revue, les passations et les README ne demandent donc rien. Une **exemption justifiée** est un fragment `exemption: US-xxx — <raison ≥ 20 caractères>`, visible dans le diff et relu en revue de code.
5. **Script pris sur la base**, comme pour le job `revues` : le job copie `scripts/ci/changelog.mjs` depuis `origin/<base>`, hors du dépôt, puis l'exécute avec `--root` sur la pointe. Une PR ne peut donc pas affaiblir le contrôle qui la juge. **Amorçage** : si le script est réellement absent de l'arbre de la base (`git ls-tree` vide ; la PR d'US-040 elle-même), c'est celui de la PR qui sert, avec un avertissement « AMORÇAGE ». Toute autre erreur (base introuvable, lecture git en échec) fait échouer le job. Les textes non fiables (noms de fichiers, exemptions) sont neutralisés avant d'être écrits au journal (`%`, retours à la ligne, `::`), pour qu'aucune commande de workflow ne puisse être injectée. Une story citée seulement dans un commentaire HTML ne compte pas. Le script n'importe que des modules Node.
6. **Versement** : `node scripts/ci/changelog.mjs release --version x.y.z --date AAAA-MM-JJ`, lancé par l'orchestrateur avant une mise en production. La commande refuse si `docs/NOTES_DE_VERSION.md` n'a pas de section `## x.y.z`, c'est-à-dire les notes en français pour le fondateur (second critère). Sinon, elle verse « Non publié » et les fragments sous `## [x.y.z] — date`, par lot et par module. Elle ajoute les numéros de PR (lus dans le sujet `Merge pull request #n` du commit de fusion qui a ajouté le fragment), puis supprime les fragments. Les exemptions ne sont pas versées.
7. **Notes de version** `docs/NOTES_DE_VERSION.md` : en français, sans jargon, pour le fondateur. Un premier point couvre le lot 0. US-040 n'impose pas d'autres langues : c'est un document interne, et non un texte visible du produit.

## Alternatives écartées

- **Une ligne sous « Non publié » de `CHANGELOG.md` par PR** : conflits systématiques entre PR parallèles, et revues périmées à chaque résolution.
- **Contrôle dans `pnpm lint` (job `qualité`)** : ce job extrait le commit de fusion en profondeur 1, sans la base, et le diff serait impossible à calculer. Un job dédié avec tout l'historique est plus simple et ne ralentit pas `qualité`. `pnpm lint:changelog` permet de lancer le contrôle en local.
- **changesets / towncrier** : nouvelle dépendance pour un besoin couvert par environ 300 lignes sans dépendance. changesets vise des paquets publiés, et towncrier exige Python dans le job.

## Conséquences

- Toute PR de story qui touche du code ajoute un fragment, sinon le job `changelog` est rouge. Les PR ouvertes avant la fusion d'US-040 (#79) n'y sont soumises qu'après avoir fusionné `main`, puisque `ci.yml` est lu depuis la PR. Elles ajoutent alors leur fragment.
- Les branches `chore/` et `docs/team-` ne touchent que `docs/team/` : elles sont exemptées automatiquement.
- Élargir les exemptions ou changer les règles touche `scripts/ci/`, donc exige une revue sécurité (DEC-FONDATEUR-15).

## Limites

- Le contrôle vérifie la présence et la forme d'une entrée, pas sa justesse : la revue de code juge si l'entrée décrit bien la PR.
- Une PR peut modifier le fragment d'une autre story déjà fusionnée pour passer le contrôle. Elle doit pourtant y citer une story de sa propre branche : la modification se voit donc dans le diff relu.
