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
| `dependances`           | `pnpm audit --prod --audit-level high`                                                                                                                                                                                                             | **non** (voir « Dépendances »)                  |
| `diagrammes`            | rendu `mmdc` (mermaid-cli 12.0.0) de chaque bloc ` ```mermaid ` de `docs/` ([`scripts/ci/render-mermaid.mjs`](../../scripts/ci/render-mermaid.mjs)), après un témoin invalide qui doit échouer                                                     | oui                                             |

« Bloquant » signifie que le job passe au rouge. Pour qu'un job rouge **empêche la fusion**, il faut que la protection de `main` exige ces statuts. C'est le rôle d'US-050 ; le dépôt n'est pas encore protégé. Statuts à exiger : `qualité (lint, types, unitaires, build, format)`, `base de données (PostgreSQL 16 réel, test:int, test:l0)`, `oracles de la spécification (Python 3.12)`, `revues indépendantes (check-reviews)`, `analyse des secrets (gitleaks)` et `rendu mmdc des diagrammes`.

Les jobs non bloquants sont faits avec `continue-on-error` **sur l'étape** : l'étape échoue, le job reste vert, et une annotation (`::warning`) apparaît dans le résumé du run.

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

Les stories sont déduites du nom de branche (`story/US-002-…` → `US-002` ; `story/US-001-US-029-…` → les deux). Une branche hors convention ne contrôle rien et le dit dans le journal.

Les rôles exigés sont lus dans [`docs/team/review-requirements.json`](../team/review-requirements.json) : `default` (`code`), plus les rôles propres à la story (`stories`), plus `architecture` si le diff `origin/main...HEAD` touche `apps/api/src/modules/dependency-graph.ts` ou `packages/db/`.

Le job se place sur la pointe de la branche (`head.sha`), avec tout l'historique (`fetch-depth: 0`). `check-reviews.mjs` prend `--base` (défaut `main`) pour lire `origin/main..HEAD` en CI.

En brouillon, l'échec est seulement informatif. Quand la PR passe en « prête », le job est relancé et devient bloquant.

### Dépendances

Choix : **non bloquant pour l'instant.** Le 2026-10-31, `pnpm audit --prod --audit-level high` remonte 2 vulnérabilités élevées, toutes deux transitives par `@nestjs/platform-express` :

- `body-parser` 2.3.0 : corrigé en 2.4.0, publié le 2026-10-22 ;
- `multer` 2.4.0 : corrigé en 2.5.0, publié le 2026-10-22.

La politique `minimumReleaseAge` (14 jours) interdit ces correctifs avant le **2026-11-05**. À partir de cette date, la suite est la suivante :

1. monter `@nestjs/platform-express`, ou ajouter un `overrides` dans `pnpm-workspace.yaml` ;
2. vérifier que l'audit est vert ;
3. retirer `continue-on-error` de l'étape, pour atteindre « 0 vulnérabilité critique ou élevée » (handoff §7).

### Diagrammes

mermaid-cli est installé hors de l'espace de travail pnpm, en version exacte, avec `--ignore-scripts`, et utilise le Chrome du runner sans bac à sable. Il n'est pas ajouté aux dépendances, car puppeteer est trop lourd pour l'installation de chacun.

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
pnpm audit --prod --audit-level high
```

`scripts/ci/pg-smoke.sh`, gitleaks et `mmdc` demandent Docker, un binaire gitleaks ou Chrome. Ils ne tournent qu'en CI : le poste du fondateur n'a pas Docker (ADR-043).

Inspecter un run : `gh pr checks <n>`, `gh run view <id> --log-failed`, `gh run rerun <id> --failed`.
