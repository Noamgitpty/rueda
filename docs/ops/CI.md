# Intégration continue (US-002)

GitHub Actions, dépôt privé `Noamgitpty/rueda`. Deux workflows :

- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) : sur chaque demande de fusion (ouverte, mise à jour, rouverte, passée de brouillon à prête), chaque push vers `main`, et à la main (`workflow_dispatch`). Il est aussi appelé par la nuit (`workflow_call`).
- [`.github/workflows/nightly.yml`](../../.github/workflows/nightly.yml) : chaque nuit à 03:17 UTC sur `main`, et à la main. Une PR qui modifie ce fichier le rejoue aussi, pour le vérifier avant la fusion : `schedule` et `workflow_dispatch` ne s'appliquent qu'à la branche par défaut.

Règles communes :

- **Actions tierces épinglées par SHA de commit**, avec le tag en commentaire (`uses: actions/checkout@3d3c42e… # v7.0.1`). Chaque version choisie a été publiée **depuis plus de 14 jours**, comme le veut la politique `minimumReleaseAge` d'US-001. Pour monter une version : relever le SHA du tag avec `gh api repos/<owner>/<action>/commits/<tag> --jq .sha`, puis changer le SHA et le commentaire ensemble.
- `permissions: contents: read` par défaut. Seul le job `secrets` ajoute `pull-requests: read`, dont gitleaks a besoin pour lister les commits de la PR. `persist-credentials: false` partout.
- `concurrency` : un groupe par workflow, par événement et par PR (ou par ref). Une PR mise à jour annule son run en cours ; un push sur `main` et la nuit ne s'annulent jamais.
- **Aucun secret n'est nécessaire.** Seul le `GITHUB_TOKEN` automatique est utilisé. gitleaks ne demande pas de licence pour un dépôt de compte personnel.
- Node vient de `.nvmrc` (26.13.0) et pnpm de `packageManager` (10.34.9) ; Python est en 3.12.

## Jobs de `ci.yml`

| Job                     | Contenu                                                                                                                                                                                                                                            | Bloquant                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `qualite`               | `pnpm install --frozen-lockfile`, `lint`, `typecheck`, `test:unit` (dont `node --test scripts/team/ scripts/ci/`), `build`, `format:check`                                                                                                         | oui                                             |
| `base-de-donnees`       | fumée du banc ([`scripts/ci/pg-smoke.sh`](../../scripts/ci/pg-smoke.sh) : `postgres:16` réel, version ≥ 16, `CREATE EXTENSION btree_gist`, connexion directe sans pooler), puis `pnpm test:int` et `pnpm test:l0` avec `RUEDA_PG_TESTCONTAINERS=1` | oui (voir plus bas ce qu'il prouve aujourd'hui) |
| `oracles`               | tests du contrôle, puis [`scripts/ci/check-spec-tools.py`](../../scripts/ci/check-spec-tools.py) : les contrôles de `docs/specs/00_README.md` §4, exécutés avec `python -I -X utf8`                                                                | oui                                             |
| `revues` (PR seulement) | [`scripts/ci/check-story-reviews.mjs`](../../scripts/ci/check-story-reviews.mjs) → `scripts/team/check-reviews.mjs US-xxx --require <rôles> --base origin/main`, scripts pris **sur la base** et appliqués à la pointe de la PR                    | oui sur une PR prête ; informatif en brouillon  |
| `secrets`               | gitleaks (`gitleaks/gitleaks-action` v3.0.0) : commits de la PR, ou du push ; tout l'historique la nuit                                                                                                                                            | oui                                             |
| `dependances`           | [`scripts/ci/audit-gate.mjs`](../../scripts/ci/audit-gate.mjs) : `pnpm audit --prod`, gravité élevée et critique, exceptions GHSA datées                                                                                                           | oui (voir « Dépendances »)                      |
| `diagrammes`            | rendu `mmdc` (mermaid-cli 12.0.0) de chaque bloc ` ```mermaid ` de `docs/` ([`scripts/ci/render-mermaid.mjs`](../../scripts/ci/render-mermaid.mjs)), après un témoin invalide qui doit échouer                                                     | oui                                             |

« Bloquant » signifie que le job passe au rouge. Pour qu'un job rouge **empêche la fusion**, il faut que la protection de `main` exige ces statuts. C'est le rôle d'US-050 ; le dépôt n'est pas encore protégé. En attendant, DEC-FONDATEUR-15 interdit à l'orchestrateur de fusionner tant que l'un de ces statuts n'est pas vert. Statuts à exiger : `qualité (lint, types, unitaires, build, format)`, `base de données (PostgreSQL 16 réel, test:int, test:l0)`, `oracles de la spécification (Python 3.12)`, `revues indépendantes (check-reviews)`, `analyse des secrets (gitleaks)`, `analyse des dépendances (pnpm audit)` et `rendu mmdc des diagrammes`.

Seule exception : en brouillon, l'étape du job `revues` porte `continue-on-error`. L'étape échoue, mais le job reste vert.

### Base de données : comment le job devient une vraie preuve

Le harnais d'US-005 lit `RUEDA_PG_TESTCONTAINERS=1` et démarre `postgres:16` par Testcontainers sur le Docker du runner (ADR-043 : **la CI fait foi** pour l'intégration et les preuves L0).

- **Depuis la fusion d'US-005 (PR #18)**, `test:int` et `test:l0` lancent les vrais tests (`turbo run test:int` et `turbo run test:l0`, dont ceux de `@rueda/db` sous les rôles de production) ; le job est **bloquant** sans changement du workflow. Le script `scripts/not-yet-implemented.mjs` n'est plus appelé. L'étape de fumée (PostgreSQL 16 réel avec `btree_gist`) reste en place ; la retirer est une modification de `.github/`, soumise à la revue sécurité.
- Si le harnais demande l'autre mode (`RUEDA_PG_ADMIN_URL` + `RUEDA_PG_SUPERUSER_PASSWORD_FILE`, natif P-07), il reste réservé au poste local. La CI garde Testcontainers.
- Les commandes `test:rls`, `test:concurrency` et `test:money` s'ajouteront à ce job quand leurs stories les créeront (handoff §7). La matrice PA / PY (19 US-002, notes techniques) sera ajoutée quand un test dépendra du pays.

### Oracles

`check-spec-tools.py` lit dans le **registre des oracles** [`docs/specs/tools/registry.json`](../specs/tools/registry.json) les motifs attendus de chaque script (`RÉSULTAT : OK`, `ERREURS 0`, `Vecteurs executes: 48 | ecarts: 0`, `ECARTS sur T01-T48 : 0`, `38/38`, `T49-T65 : ecarts = 0`, `0 ecart`…), ses motifs interdits (nouvel identifiant cité sans définition, `ECART(S)`) et ses comptes (`counts`). Le code de sortie doit aussi valoir 0.

- **Pourquoi un fichier de données (US-050).** Toute PR qui touche `scripts/ci/` exige une revue sécurité et les garde-fous compensatoires de DEC-FONDATEUR-15 (ci-dessous). Avec le registre, une révision des specs qui ajoute un oracle ou un vecteur ne touche que `docs/specs/tools/`, sous revues argent et sécurité. La marche à suivre est dans `docs/specs/00_README.md` §4.
- **Ce qui reste dans le script** (fail-closed). Le registre ne peut ni exclure un script, ni retirer un oracle plancher, ni annuler un compte obligatoire : ces éléments restent en dur et ne changent que par une PR qui touche `scripts/ci/`, donc sous les garde-fous de DEC-FONDATEUR-15. Il peut en revanche **relâcher un motif** (par exemple `(58)?`, ou un `forbid` retiré). C'est pourquoi `docs/specs/tools/registry.json` exige une revue **argent** et une revue **sécurité** (pathRules de `docs/team/review-requirements.json`, revue sécurité 03g). Restent en dur :
  - `EXCLUDED` : `verify_cxl_tests.py` (déclassé) et `verif24_stats.py` (absent de la liste de 00 §4), nommés comme tels dans la sortie ;
  - `FLOOR_ORACLES` : les 17 oracles d'aujourd'hui, dont tous ceux d'argent. Retirer l'un d'eux du registre fait échouer le contrôle ;
  - `REQUIRED_COUNTS` : `check_legs.py`, `verif11_settlement.py` et `verif12_t49plus.py` doivent déclarer `vecteurs` (entier ≥ 1), et ce nombre doit figurer dans un de leurs motifs `require` ;
  - `COMMON_FORBID` : une trace Python échoue toujours.
- **Le registre est validé avant toute exécution.** Le contrôle échoue, sans lancer aucun oracle, dans ces cas :
  - registre absent, illisible ou vide, ou `version` différente de 1 ;
  - clé inconnue (par exemple `skip`) ou en double ;
  - nom qui n'est pas un simple `*.py` de `docs/specs/tools/`, ou script absent ;
  - script à la fois inscrit au registre et exclu ;
  - motif invalide, ou motif `require` qui accepte une sortie vide.
- Si un script de `docs/specs/tools/` n'est ni au registre ni exclu, le contrôle échoue (« script non classé »).
- `verif18_stale.py` et `verif15_conf.py` n'ont pas de verdict : ils sont faits pour une lecture humaine. Pour eux, seuls le code de sortie et l'absence d'erreur sont contrôlés.
- Les scripts écrivent dans `docs/specs/verification/`. Ils tournent donc sur une **copie temporaire** de `docs/specs/`, qui n'est jamais modifiée.

### Revues

Depuis la revue sécurité du 2026-11-01 (constat MAJEUR 1), le nom de branche ne suffit plus : c'est l'auteur de la PR qui le choisit. [`check-story-reviews.mjs`](../../scripts/ci/check-story-reviews.mjs) applique donc les règles suivantes, dans l'ordre.

1. **Liste blanche de branches.**
   - Sont acceptées : `story/US-xxx-<slug>` (minuscules, chiffres, tirets ; plusieurs stories : `story/US-001-US-029-…`) et les préfixes déclarés dans `branchPrefixes` (`docs/team-`, `chore/`).
   - **Toute autre branche échoue** : `fix/x`, `story/us-002-x`, `story/US-002-x;rm`…
2. **Branche à préfixe déclaré.**
   - Le diff ne touche que ses `allowedPaths` (`docs/team/`).
   - Il ne touche jamais les `nonStoryForbiddenPaths` : rapports de revue, passations, `gates/`, et la règle elle-même.
   - Aucune revue de story n'est alors exigée.
3. **Branche de story, recoupée avec le diff `origin/main...HEAD`.**
   - Un fichier de `docs/team/` qui nomme une autre story (`handoffs/US-yyy.md`, `reviews/US-yyy/`) fait échouer le job, sauf si `stories.US-xxx.related` déclare cette story (cas US-001 ↔ US-029).
   - Les `sharedPaths` sont tolérés : BOARD, RESUME_HERE, DECISIONS, QUESTIONS, RISKS, COMME_TURO, sessions, health, weekly, incidents.
   - `docs/team/COMME_TURO.md` (journal de DEC-FONDATEUR-16) est alimenté en parallèle par toutes les stories. Sans cette tolérance, chaque fusion d'une autre story y créait un conflit, et la règle de fraîcheur (point 5) rendait toutes les revues périmées. Le journal ne contient ni code ni règle de contrôle. Le chemin libre est exact : `COMME_TURO.md.bak` ne l'est pas.
   - Un fichier sous `packages/<x>/` exige que la story figure dans `pathOwners[packages/<x>/]`.
   - Un paquet absent de `pathOwners` fait échouer le job (fail-closed). Une story qui crée un paquet le fait donc d'abord déclarer sur `main` par l'orchestrateur.
4. **Rôles exigés.**
   - Ils valent `default` (`code`), plus `stories.US-xxx.require`, plus `architecture` si le diff touche `dependency-graph.ts` ou `packages/db/`.
   - Depuis US-050, `securite` s'ajoute aussi dès que le diff touche `.github/`, `scripts/ci/`, `scripts/team/` ou `docs/team/review-requirements.json`.
   - Le job lance ensuite `scripts/team/check-reviews.mjs US-xxx --require <rôles> --base origin/main --root <pointe> --exempt <chemins libres>`.
5. **Revue à jour** (US-050, revues sécurité 03c et 03d, constat 4). Un rapport APPROUVÉ sur le sha X ne suffit plus parce que X est un ancêtre de HEAD.
   - Un fichier **livré** par la PR, c'est-à-dire présent dans le diff `merge-base(origin/main, HEAD)..HEAD`, rend la revue périmée dans deux cas :
     - il a changé depuis X ;
     - la base l'a changé entre `merge-base(origin/main, X)` et `merge-base(origin/main, HEAD)`.
   - Le message est alors « revue <rôle> périmée : <fichier> modifié après <X> ».
   - Seuls sont libres :
     - les rapports `docs/team/reviews/<story>/` et la passation `docs/team/handoffs/<story>.md` des stories de la branche ;
     - les `sharedPaths`.
   - Tous les diffs portent `--no-renames` : un renommage compte par son chemin de départ et par son chemin d'arrivée.
   - **Fusions de main.** Un fichier que seule la base a changé (`git merge origin/main`) n'est pas livré par la PR : il ne périme pas la revue. Le second cas couvre deux situations. D'abord, une résolution de conflit qui remet un fichier dans son état revu en annulant un correctif de main. Ensuite, un rapport d'une PR déjà fusionnée, réutilisé par une nouvelle PR de la même story. Dans les deux cas, la modification livrée n'est plus celle que le relecteur a vue.
   - Conséquence voulue (fail-closed) : si main et la PR modifient le même fichier, la fusion de main périme la revue, qu'il faut alors refaire.
   - Si le calcul git échoue, le job échoue aussi.
6. **Relecteur qui écrit du code** (revue sécurité 03b, constat 2). Un commit signé d'un rôle de revue (`REVIEW_ROLES`) n'est écarté des modèles d'auteur que si **tous** ses fichiers sont sous `docs/team/reviews/`.
   - Les fichiers sont comparés au premier parent : une fusion compte avec tout ce qu'elle apporte.
   - Sinon, son modèle compte comme auteur. C'est aussi le cas d'un commit vide, ou d'un commit dont les fichiers sont introuvables.

Les règles de [`docs/team/review-requirements.json`](../team/review-requirements.json) sont **lues sur la branche de base** (`git show origin/main:…`). Une PR ne peut donc pas affaiblir son propre contrôle (constat MINEUR 2).

- Tant que `main` n'a pas ce fichier, c'est celui de HEAD qui sert, avec un avertissement. C'est l'amorçage, le cas de la PR d'US-002.
- **Les scripts aussi viennent de la base** depuis US-050 (revues sécurité 03b, 03c et 03d, constats 3 et 5).
  - Le job copie `scripts/ci/check-story-reviews.mjs` et `scripts/team/check-reviews.mjs` par `git show origin/<base>:…` dans `$RUNNER_TEMP/revues-base/`.
  - Il les exécute avec `--root "$GITHUB_WORKSPACE"`, la pointe de la PR. C'est elle qui fournit le diff, l'historique et les rapports.
  - `check-story-reviews.mjs` lance le `check-reviews.mjs` **voisin de lui-même**, jamais celui de `--root`.
  - Si un script manque sur la base, l'étape échoue.
- **Un changement de ces scripts, comme de ce JSON, ne prend effet qu'après sa fusion.** La PR qui le porte est contrôlée par la version de `main`, et ses tests (`node --test scripts/ci/ scripts/team/`, job `qualite`) prouvent le nouveau comportement.
- **Amorçage d'US-050.** La PR qui introduit l'exécution depuis la base est encore contrôlée par l'ancien `check-story-reviews.mjs` de `main`. Celui-ci lance le `check-reviews.mjs` **de la PR** et ne transmet pas `--exempt`, ce qui est plus strict : aucun `sharedPath` n'est libre. L'exécution de bout en bout depuis la base ne vaut donc qu'à partir de la PR suivante.
  - La pathRule `securite` ne vaut pas pour cette PR : ses revues sécurité sont exigées par `stories.US-050`.
  - La fraîcheur des revues est contrôlée par le code de la PR elle-même. La PR est donc fusionnée **au SHA revu**. Toute modification ultérieure de `scripts/`, `.github/` ou du JSON impose de nouvelles revues code et sécurité.
- **Limite : `ci.yml` est lu depuis la PR** (revue sécurité 03e, constat 1). Sur `pull_request`, GitHub exécute les workflows de la branche de la PR. Seuls les deux scripts sont pris sur la base. Une PR qui touche `.github/` peut retirer le job `revues`, le passer en `continue-on-error` ou remplacer les lignes qui copient les scripts. La pathRule `securite` est évaluée par ce même job, et ne protège donc rien dans ce cas. Pour une telle PR, un « tout vert » ne prouve rien.
- **Règle d'exploitation (DEC-FONDATEUR-15, exclusion levée par le fondateur le 2026-11-02).** L'orchestrateur fusionne seul **toutes** les PR, y compris celles qui touchent `.github/`, `scripts/ci/`, `scripts/team/` ou `docs/team/review-requirements.json`, **seulement si** toute la CI est verte et toutes les revues exigées sont APPROUVÉ. Pour ces chemins, garde-fous compensatoires obligatoires :
  - revue sécurité APPROUVÉ **au SHA fusionné** ;
  - avant la fusion, l'orchestrateur vérifie dans le diff de `.github/workflows/ci.yml` que le job `revues` et chacune de ses étapes existent toujours (copie des scripts depuis `origin/<base>`, exécution avec `--root`), sans `continue-on-error` hors brouillon ni condition qui le désactive, et que les scripts de contrôle sont toujours pris sur la base ; sinon, pas de fusion ;
  - le relecteur sécurité fait la même vérification à la main dans le `ci.yml` de la PR.
  - Toujours interdits : push direct sur `main`, force-push, contourner ou affaiblir un contrôle pour faire passer une PR, passer un interrupteur de mise en service à `true`.
- **Parade définitive, recommandée (décision du fondateur à venir).** Une protection de branche sur `main`, avec les statuts exigés, demande GitHub Pro pour un dépôt privé. CODEOWNERS et une revue humaine sur ces chemins en font partie. La pathRule `securite` ne remplace pas cette revue humaine.

Le job se place sur la pointe de la branche (`head.sha`), avec tout l'historique (`fetch-depth: 0`). En brouillon, son échec reste informatif. Quand la PR passe en « prête », le job est relancé et devient bloquant. Les contournements sont couverts par `scripts/ci/check-story-reviews.test.mjs`.

### Dépendances

Le job est **bloquant** depuis la revue sécurité du 2026-11-01 (constat 9). [`audit-gate.mjs`](../../scripts/ci/audit-gate.mjs) lit la sortie de `pnpm audit --prod --json` et applique les règles suivantes :

- toute vulnérabilité de gravité élevée ou critique fait échouer le job, sauf si une exception **nommée et datée** de [`docs/ops/audit-exceptions.json`](audit-exceptions.json) la couvre (GHSA, paquet, date d'expiration au sens du dernier jour toléré en UTC, justification) ;
- une exception expirée fait échouer le job, même si la vulnérabilité a disparu : il faut alors la retirer du fichier ;
- une sortie d'audit illisible, par exemple quand le registre est indisponible, fait échouer le job (fail-closed) ;
- une vulnérabilité modérée ou faible ne bloque pas.

Deux exceptions sont en vigueur. Les deux vulnérabilités sont transitives par `@nestjs/platform-express`. Leurs correctifs ont été publiés le 2026-10-22, et `minimumReleaseAge` (14 jours) les interdit avant le 2026-11-05.

| GHSA                  | Paquet                        | Expire le  |
| --------------------- | ----------------------------- | ---------- |
| `GHSA-27r3-jxmh-p828` | `body-parser` 2.3.0 (→ 2.4.0) | 2026-11-06 |
| `GHSA-q7qp-rjg7-q26m` | `multer` 2.4.0 (→ 2.5.0)      | 2026-11-06 |

Le 2026-11-05 ou le 2026-11-06, il faut monter `@nestjs/platform-express` ou ajouter un `overrides` dans `pnpm-workspace.yaml`, puis retirer les deux exceptions. Sinon, la CI sera rouge à partir du 2026-11-07.

Toute nouvelle exception est une décision : elle est consignée dans `docs/team/DECISIONS.md` et passe en revue sécurité.

### Diagrammes

mermaid-cli 12.0.0 et **toutes ses dépendances** sont figés par [`scripts/ci/mermaid/package-lock.json`](../../scripts/ci/mermaid/package-lock.json). Ils sont installés par `npm ci --ignore-scripts`, hors de l'espace de travail pnpm.

- Le lockfile a été généré avec `npm install --package-lock-only --before=2026-10-17` : chaque version a plus de 14 jours.
- Pour monter la version : modifier `scripts/ci/mermaid/package.json`, puis lancer `npm install --prefix scripts/ci/mermaid --package-lock-only --ignore-scripts --before=<aujourd'hui moins 14 jours>`.
- mmdc utilise le Chrome du runner, sans bac à sable.
- mermaid-cli n'est pas ajouté aux dépendances du dépôt : puppeteer serait trop lourd pour l'installation de chacun.

Le premier run (2026-11-01) a rendu les **31 diagrammes sur 31** (08, 09b, 10b, 17, 18 et 19). Cela clôt le contrôle `mmdc` resté ouvert dans 08 (A31, m10) et 17 ; le report dans la spécification revient à l'orchestrateur. Le job est donc bloquant.

Avant le rendu, le témoin `scripts/ci/fixtures/mermaid-invalide.md` doit échouer : c'est la preuve que `mmdc` vérifie réellement la syntaxe. Le témoin est rangé hors de `docs/` pour ne pas être compté parmi les diagrammes.

## Nuit (`nightly.yml`)

- `suite-complete` rejoue `ci.yml` à l'identique, sauf le job `revues` (réservé aux PR). Sur `schedule`, gitleaks-action analyse tout l'historique (comportement documenté de l'action, à confirmer au premier run de nuit sur `main`).
- `fuzz-c11` est un **emplacement documenté** : US-025 livrera le fuzz d'entrelacements C11 (1 000 exécutions en CI, ≥ 10 000 la nuit, graine de chaque échec conservée en artefact). D'ici là, l'étape affiche une notice et n'exécute aucun test. Le remplacement attendu est écrit en commentaire dans le workflow.
- Le reste de la régression de nuit (propriétés, mutation, e2e complet, résilience) s'ajoutera avec `pnpm test:nightly` (handoff §7).

## Rejouer en local (Windows, Git Bash)

```bash
export PATH="/c/Program Files/nodejs:/c/Users/<utilisateur>/AppData/Roaming/npm:$PATH"   # node -v → v26.13.0
pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build && pnpm format:check
pnpm test:int && pnpm test:l0        # en local : PostgreSQL natif (RUEDA_PG_ADMIN_URL + RUEDA_PG_SUPERUSER_PASSWORD_FILE, ADR-043)
python -I -X utf8 -m unittest discover -s scripts/ci -p "test_*.py"
python -I -X utf8 scripts/ci/check-spec-tools.py              # oracles (copie temporaire de docs/specs)
node scripts/ci/check-story-reviews.mjs --branch "$(git branch --show-current)" --base main
node scripts/ci/audit-gate.mjs                                # pnpm audit, exceptions datées
```

`scripts/ci/pg-smoke.sh`, gitleaks et `mmdc` demandent Docker, un binaire gitleaks ou Chrome. Ils ne tournent qu'en CI : le poste du fondateur n'a pas Docker (ADR-043).

Inspecter un run : `gh pr checks <n>`, `gh run view <id> --log-failed`, `gh run rerun <id> --failed`.
