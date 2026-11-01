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
| `revues` (PR seulement) | [`scripts/ci/check-story-reviews.mjs`](../../scripts/ci/check-story-reviews.mjs) → `scripts/team/check-reviews.mjs US-xxx --require <rôles> --base origin/main`                                                                                    | oui sur une PR prête ; informatif en brouillon  |
| `secrets`               | gitleaks (`gitleaks/gitleaks-action` v3.0.0) : commits de la PR, ou du push ; tout l'historique la nuit                                                                                                                                            | oui                                             |
| `dependances`           | [`scripts/ci/audit-gate.mjs`](../../scripts/ci/audit-gate.mjs) : `pnpm audit --prod`, gravité élevée et critique, exceptions GHSA datées                                                                                                           | oui (voir « Dépendances »)                      |
| `diagrammes`            | rendu `mmdc` (mermaid-cli 12.0.0) de chaque bloc ` ```mermaid ` de `docs/` ([`scripts/ci/render-mermaid.mjs`](../../scripts/ci/render-mermaid.mjs)), après un témoin invalide qui doit échouer                                                     | oui                                             |

« Bloquant » signifie que le job passe au rouge. Pour qu'un job rouge **empêche la fusion**, il faut que la protection de `main` exige ces statuts. C'est le rôle d'US-050 ; le dépôt n'est pas encore protégé. Statuts à exiger : `qualité (lint, types, unitaires, build, format)`, `base de données (PostgreSQL 16 réel, test:int, test:l0)`, `oracles de la spécification (Python 3.12)`, `revues indépendantes (check-reviews)`, `analyse des secrets (gitleaks)`, `analyse des dépendances (pnpm audit)` et `rendu mmdc des diagrammes`.

Seule exception : en brouillon, l'étape du job `revues` porte `continue-on-error`. L'étape échoue, mais le job reste vert.

### Base de données : comment le job devient une vraie preuve

Le job attend ce qu'US-005 apportera. Le harnais lit `RUEDA_PG_TESTCONTAINERS=1` et démarre `postgres:16` par Testcontainers sur le Docker du runner (ADR-043 : **la CI fait foi** pour l'intégration et les preuves L0).

- **Aujourd'hui sur `main`**, `test:int` et `test:l0` affichent seulement « pas encore implémenté (US-005) » et sortent avec 0. Le job est vert, mais il prouve uniquement que le runner fournit un PostgreSQL 16 réel avec `btree_gist` (étape de fumée).
- **À la fusion d'US-005**, les scripts lancent les vrais tests, et le job devient bloquant **sans changer le workflow**. US-005 doit vérifier dans son run que les tests s'exécutent bien, avec un nombre de tests non nul. Elle peut aussi retirer l'étape de fumée, devenue redondante.
- Si le harnais demande l'autre mode (`RUEDA_PG_ADMIN_URL` + `RUEDA_PG_SUPERUSER_PASSWORD_FILE`, natif P-07), il reste réservé au poste local. La CI garde Testcontainers.
- Les commandes `test:rls`, `test:concurrency` et `test:money` s'ajouteront à ce job quand leurs stories les créeront (handoff §7). La matrice PA / PY (19 US-002, notes techniques) sera ajoutée quand un test dépendra du pays.

### Oracles

`check-spec-tools.py` fixe pour chaque script les motifs attendus (`RÉSULTAT : OK`, `ERREURS 0`, `Vecteurs executes: 48 | ecarts: 0`, `ECARTS sur T01-T48 : 0`, `38/38`, `T49-T65 : ecarts = 0`, `0 ecart`…) et les motifs interdits (trace Python, nouvel identifiant cité sans définition, `ECART(S)`). Le code de sortie doit aussi valoir 0.

- `verify_cxl_tests.py` (déclassé) et `verif24_stats.py` (absent de la liste de 00 §4) sont exclus et nommés comme tels dans la sortie. Si un nouveau script apparaît dans `docs/specs/tools/` sans être classé, le contrôle échoue.
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
   - Les `sharedPaths` sont tolérés : BOARD, RESUME_HERE, DECISIONS, QUESTIONS, RISKS, sessions, health, weekly, incidents.
   - Un fichier sous `packages/<x>/` exige que la story figure dans `pathOwners[packages/<x>/]`.
   - Un paquet absent de `pathOwners` fait échouer le job (fail-closed). Une story qui crée un paquet le fait donc d'abord déclarer sur `main` par l'orchestrateur.
4. **Rôles exigés.**
   - Ils valent `default` (`code`), plus `stories.US-xxx.require`, plus `architecture` si le diff touche `dependency-graph.ts` ou `packages/db/`.
   - Le job lance ensuite `scripts/team/check-reviews.mjs US-xxx --require <rôles> --base origin/main`.

Les règles de [`docs/team/review-requirements.json`](../team/review-requirements.json) sont **lues sur la branche de base** (`git show origin/main:…`). Une PR ne peut donc pas affaiblir son propre contrôle (constat MINEUR 2).

- Tant que `main` n'a pas ce fichier, c'est celui de HEAD qui sert, avec un avertissement. C'est l'amorçage, le cas de la PR d'US-002.
- Les scripts eux-mêmes viennent encore de la PR. Les protéger par un CODEOWNERS sur `.github/`, `scripts/ci/`, `scripts/team/` et ce JSON relève d'US-050.

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
