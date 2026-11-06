# Contribuer à rueda

Ce dépôt est développé **à 100 % par des agents** Claude Code (19 §1.5) ; le fondateur est le seul humain. Ce guide suffit à un agent neuf pour travailler sans casser les frontières. En cas de doute, la spécification fait foi : `docs/specs/` (point d'entrée : `docs/specs/CLAUDE_BUILD_HANDOFF.md`). Les décisions d'architecture sont dans `docs/adr/`.

**Règle absolue : aucun push sur `main`.** Ni `git push origin main`, ni force-push, ni fusion locale poussée. Seul l'orchestrateur fusionne, par demande de fusion, après les revues requises (19 §1.4 point 9, §1.5).

## 1. Environnement (Windows)

- **Installation depuis zéro par Docker** (pile `compose.yaml`, graines PA / PY, FAKE, suite de tests) : [docs/ops/INSTALL.md](docs/ops/INSTALL.md), guide prouvé par le job CI `guide-installation`. Chaque module (`apps/api/src/modules/<code>/`) et chaque paquet (`packages/<x>/`) a un README avec ses sections `Responsabilité`, `Entités`, `Événements`, `Ports` et `Commandes de test` (contrôlées par les tests).
- **Node.js 26.13** (ligne LTS active), figé par `.nvmrc` et `engines` ; **pnpm 10.34.9** (`packageManager`). Détails et raisons : [ADR-041](docs/adr/ADR-041-chaine-outils-node-pnpm.md).
- Avant toute commande `node` ou `pnpm`, mettre le bon Node en tête du `PATH` (un Node 22 situé dans `AppData\Local\hermes\node` peut passer devant) :
  - PowerShell : `$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;$env:Path"`
  - Git Bash : `export PATH="/c/Program Files/nodejs:/c/Users/<utilisateur>/AppData/Roaming/npm:$PATH"` (écrire le chemin Unix : `$APPDATA` vaut `C:\…` en bash et casse le lanceur pnpm).
  - Vérifier : `node -v` → `v26.13.0`, `pnpm -v` → `10.34.9`.
- Les agents n'installent rien globalement et ne demandent jamais de droits administrateur (handoff §5).
- Fraîcheur des dépendances : `pnpm-workspace.yaml` impose `minimumReleaseAge` = 14 jours. Versions exactes (pas de `^`), `pnpm-lock.yaml` toujours commité.

## 2. Commandes

| Commande                            | Effet                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`    | installation reproductible (CI et agents)                                                                                     |
| `pnpm lint`                         | ESLint (dont frontières de modules et horloge SQL dans le TypeScript) **puis** contrôle d'horloge de tous les fichiers `.sql` |
| `pnpm lint:sql`                     | contrôle d'horloge des fichiers `.sql` seul                                                                                   |
| `pnpm typecheck`                    | `tsc --noEmit` dans chaque paquet (Turborepo)                                                                                 |
| `pnpm test:unit`                    | Vitest dans chaque paquet (dont les tests à fixtures des règles de lint)                                                      |
| `pnpm test:int`, `pnpm test:l0`     | PostgreSQL réel (US-005) : intégration et preuves L0 sous les rôles de production ; voir `packages/db/README.md`              |
| `pnpm test:money`                   | vecteurs dorés T, TJ, TA en USD et PYG, puis moteur d'argent comparé aux oracles Python (10 000 cas)                          |
| `pnpm test:e2e`                     | build de production du site, puis parcours Playwright (360 px, 390 px, tablette, PWA)                                         |
| `pnpm lint:changelog`               | fragment de CHANGELOG de la branche, comparé à `origin/main` (`changelog.d/README.md`)                                        |
| `pnpm build`                        | build de l'API (`tsc`) et des deux applications Next.js                                                                       |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                                      |

Avant toute demande de fusion : `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build && pnpm format:check`, tout vert. **Comment lancer chaque famille de tests** (intégration, vecteurs dorés et oracles, L0, C1–C20, RLS-1 à RLS-28, fuzz, e2e, accessibilité), où elles vivent et quel job de CI les joue : [docs/qa/STRATEGIE_TESTS.md](docs/qa/STRATEGIE_TESTS.md). Des noms du handoff §7, `test:rls` et `test:concurrency` ne sont pas créés (preuves dans `test:l0` et `test:c11`) et `test:nightly` est réservé à US-047 (ADR-086).

## 3. Branches et worktrees (handoff §4.3)

- **Une story = une branche = un worktree.** Branche : `story/US-xxx-<slug>` (slug en minuscules, mots séparés par `-`, sans accent ; ex. `story/US-006-preuves-l0-01-03-08`). Worktree : `../wt/US-xxx` (dossier frère du dépôt).
- Démarrage, toujours depuis `origin/main` à jour (jamais depuis une autre branche de story) :
  ```bash
  git fetch origin
  git worktree add ../wt/US-006 -b story/US-006-preuves-l0-01-03-08 origin/main
  cd ../wt/US-006 && pnpm install --frozen-lockfile
  ```
- Travail dans `../wt/US-xxx`, commits fréquents. Le push de la branche de story (`git push -u origin story/US-xxx-<slug>`) est fait par l'agent **seulement si l'orchestrateur le lui demande** ; jamais vers `main`.
- Après fusion par l'orchestrateur : `git worktree remove ../wt/US-xxx && git branch -d story/US-xxx-<slug>`.
- **Jamais deux agents sur la même migration** (19 §1.5) ; jamais deux agents dans le même worktree.
- Partage de pile `git stash` entre worktrees : ne pas utiliser `git stash` nu ; préférer un commit de travail temporaire.

## 4. Commits

- Format du titre : `<type>(US-xxx): <résumé à l'impératif>` ; types : `feat`, `fix`, `test`, `docs`, `refactor`, `chore`, `build`, `ci`. Corps en français.
- **Pieds obligatoires** (19 §1.9 point 6, handoff §4.3) :
  ```
  Agent-Role: back-end
  Agent-Model: claude-opus-5-5
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```
  `Agent-Role` vaut le rôle de 19 §1.5 : c'est le nom d'un fichier de `docs/team/roles/` sans `.md`, soit `orchestrateur`, `back-end`, `donnees`, `front-end`, `integrations`, `design`, `revue-code`, `qa`, `securite`, `argent`, `architecture`, `ux` ou `red-team` ; `Agent-Model` l'identifiant exact du modèle.
- Jamais `--no-verify`, jamais de réécriture de l'historique d'une branche partagée.

## 5. Cycle d'une story (19 §1.5, handoff §4.3)

1. **Spécification** : l'orchestrateur vérifie la DoR (19 §1.3) et précise le plan de test.
2. **Maquette** par l'agent de design si la story a `Revue design : OUI`.
3. **Implémentation** dans le worktree et la branche dédiés.
4. **Tests** : unitaires, intégration sur PostgreSQL réel, rôles de production (`app_api`, `app_worker`, `app_anon`), variantes PA et PY, adaptateurs `FAKE` normal et hostile.
5. **Revues indépendantes** : code, QA, architecture ; + argent (autre famille de modèle) si un montant bouge ; + sécurité si authentification, RLS, rôles, secrets, webhooks, fichiers ou données C2/C3 ; + design si visible. Écarts → retour à l'étape 3.
6. **Fusion** par l'orchestrateur, déploiement en préproduction.
7. **Démo et acceptation** du fondateur (refus → retour à l'étape 3).
8. **Passation** : `docs/team/handoffs/US-xxx.md` (Fait / Reste / Prochaine commande exacte / Pièges / Paramètres / Tests / Décisions) et documentation à jour (DoD, 19 §1.4 point 6).

Une story « argent » ou « sécurité » n'est jamais revue par l'agent qui l'a écrite ni par le même modèle. La Definition of Done complète est en 19 §1.4.

### 5.1 Revues requises par type de story

La règle qui fait foi est la donnée [`docs/team/review-requirements.json`](docs/team/review-requirements.json), lue par le job `revues` **depuis `origin/main`** : une PR ne peut pas alléger son propre contrôle. Les rôles exigés pour une PR sont l'**union** de trois listes :

1. `default` : la revue `code`, pour toute story ;
2. `stories.US-xxx.require` : les revues propres à la story (par exemple `US-024` : code, architecture, securite, argent, qa) ;
3. `pathRules` : les revues imposées par les chemins touchés, **quelle que soit la story**.

| Rôle (nom du rapport) | Exigé quand                                                                                                                                                                                                                                                                                                                                                       | Relecteur                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `code`                | toujours (`default`)                                                                                                                                                                                                                                                                                                                                              | autre modèle que l'auteur                                                           |
| `qa`                  | la story le demande (tests d'acceptation, concurrence, argent)                                                                                                                                                                                                                                                                                                    | autre modèle que l'auteur ; tests écrits depuis 16 et 19, sans lire d'abord le code |
| `architecture`        | la story le demande ; ou le diff touche `packages/db/`, `apps/api/src/modules/dependency-graph.ts`, `docs/specs/` ou `CLAUDE.md`                                                                                                                                                                                                                                  | autre modèle que l'auteur                                                           |
| `argent`              | un montant est calculé, déplacé, remboursé ou facturé ; ou le diff touche `packages/money/`, `docs/specs/08_BUSINESS_RULES.md`, `docs/specs/17_DATA_MODEL_AND_ARCHITECTURE.md` ou `docs/specs/tools/`                                                                                                                                                             | **famille B** ; à défaut, autre modèle Claude marqué « revue dégradée » (TECH-007)  |
| `securite`            | authentification, RLS, rôles, `SECURITY DEFINER`, secrets, webhooks, fichiers, données C2/C3 ; ou le diff touche `packages/db/`, `packages/fake-adapters/`, `packages/config/`, `.github/`, `scripts/ci/`, `scripts/team/`, `docs/team/review-requirements.json`, `docs/specs/tools/registry.json`, `docs/specs/17_DATA_MODEL_AND_ARCHITECTURE.md` ou `CLAUDE.md` | **famille B** ; à défaut, « revue dégradée »                                        |
| `ux`                  | la story porte `Revue design : OUI` (écran, texte visible, e-mail, SMS, PDF)                                                                                                                                                                                                                                                                                      | autre modèle que l'auteur                                                           |

Pour connaître les revues d'une branche avant d'ouvrir la PR : `node scripts/ci/check-story-reviews.mjs --branch "$(git branch --show-current)" --base origin/main`. Il échoue tant que des rapports manquent, et il nomme les rôles attendus.

Autres règles de `review-requirements.json`, vérifiées par le même job (détail : [docs/ops/CI.md](docs/ops/CI.md), « Revues ») :

- un fichier sous `packages/<x>/` exige que la story figure dans `pathOwners` ; un paquet absent de la liste fait échouer le job (fail-closed) ;
- un fichier de `docs/team/` qui nomme une autre story (`handoffs/US-yyy.md`, `reviews/US-yyy/`) fait échouer le job, sauf si `related` déclare cette story ; les `sharedPaths` (BOARD, RESUME_HERE, DECISIONS, QUESTIONS, RISKS, COMME_TURO, sessions, health, weekly, incidents) sont libres ;
- les branches `docs/team-…` et `chore/…` (`branchPrefixes`) ne touchent que `docs/team/`, et jamais les `nonStoryForbiddenPaths` (rapports, passations, portes, la règle elle-même).

### 5.2 Flux de revue

1. L'auteur pousse sa branche, ouvre la PR **en brouillon** et attend la CI complète verte. En brouillon, le job `revues` est informatif ; tous les autres sont bloquants.
2. L'orchestrateur lance chaque relecteur : un **nouvel agent**, sans le contexte de l'auteur, sur un **autre modèle** (`team.model.review`, OPERATING_RULES §4). Le relecteur lit [`docs/team/roles/`](docs/team/roles/) (son rôle), la story, la passation et le diff. Il ne modifie pas le code.
3. Le relecteur écrit `docs/team/reviews/US-xxx/<rôle>-<AAAA-MM-JJ>.md` selon [`docs/team/reviews/TEMPLATE.md`](docs/team/reviews/TEMPLATE.md), et le commite avec `Agent-Role: <rôle>` et son `Agent-Model:`. Une seconde passe le même jour prend un suffixe (`code-2026-11-05b.md`) : seul le **dernier** fichier par ordre alphabétique compte. Le rapport contient :
   - `Relecteur : <rôle> / <modèle>`, avec la mention « revue dégradée » pour `argent` et `securite` tant que la famille B manque ;
   - `Entrées : diff <sha de base>..<sha revu>` ; le sha revu doit être un ancêtre de la pointe ;
   - le tableau des constats (gravité CRITIQUE, MAJEUR ou MINEUR) ;
   - `Verdict : APPROUVÉ` ou `Verdict : CHANGEMENTS DEMANDÉS`. Un APPROUVÉ qui laisse un constat CRITIQUE non « corrigé » ni « résolu » est refusé.
4. CHANGEMENTS DEMANDÉS : l'auteur corrige dans la même branche, puis l'orchestrateur relance une revue complète. Une revue interrompue est relancée en entier.
5. **Revue périmée** : un fichier livré par la PR et modifié après le sha revu rend la revue périmée, y compris quand la modification vient d'une fusion de `main` qui touche le même fichier. Il faut alors refaire la revue au nouveau sha. Seuls les rapports et la passation de la story, et les `sharedPaths`, n'entrent pas dans ce calcul.
6. Contrôle automatique : `scripts/team/check-reviews.mjs` vérifie la présence des rapports, le gabarit, le verdict et la fraîcheur. Il vérifie aussi que le modèle du relecteur diffère de celui de l'auteur, lu dans les pieds `Agent-Model:` des commits. Un commit de relecteur qui touche autre chose que `docs/team/reviews/` compte comme un commit d'auteur.

### 5.3 Règles de fusion

- **Seul l'orchestrateur fusionne**, par demande de fusion, jamais en local ni par push sur `main`. Un agent de story ne fusionne jamais.
- Conditions (DEC-FONDATEUR-15) : **toute la CI verte** sur la pointe, PR passée de brouillon à prête (le job `revues` devient alors bloquant), et **toutes les revues exigées APPROUVÉ** au sha fusionné. Les statuts à exiger sont listés dans [docs/ops/CI.md](docs/ops/CI.md).
- PR qui touche `.github/`, `scripts/ci/`, `scripts/team/` ou `docs/team/review-requirements.json` : il faut en plus une revue `securite` APPROUVÉ **au sha fusionné**. L'orchestrateur vérifie aussi dans le diff de `.github/workflows/ci.yml` que le job `revues` est intact : copie des scripts depuis `origin/<base>`, exécution avec `--root`, aucun `continue-on-error` hors brouillon.
- Toujours interdits : push direct ou force-push sur `main`, `--no-verify`, relancer un job pour masquer un échec, affaiblir un contrôle pour faire passer une PR, passer un interrupteur de mise en service à `true` (`p2p_private_hosts_enabled`, `insurer_contract_active`, `funds_holding_enabled`, `payouts_enabled`). Ces interrupteurs ne changent que par la commande à deux personnes de 17 v6, sur décision écrite du fondateur.
- Après la fusion : `git worktree remove ../wt/US-xxx && git branch -d story/US-xxx-<slug>`. L'orchestrateur met à jour `docs/team/BOARD.md`.

### 5.4 Reprendre le travail en tant qu'humain

Le dépôt est fait pour des agents, mais tout s'applique à la main :

- **Identité** : les commits portent l'identité git du dépôt (option A, TECH-003). Un humain met en pied `Agent-Role: <rôle>` et `Agent-Model: human` (PROPOSÉ). Le contrôle des revues compare les modèles, et `human` diffère de tout modèle Claude. Deux limites :
  - un humain ne peut pas être à la fois auteur et relecteur d'une même story : les deux portent `human`, et le contrôle refuse alors la revue (« même modèle que l'auteur »), ce qui est voulu ;
  - pour `argent` et `securite`, la ligne `Relecteur :` du rapport humain doit porter « famille B » (relecteur indépendant de la famille A) ou « revue dégradée », sinon le rapport est refusé.
- **Faire une revue** : suivre le §5.2 point 3, avec le gabarit. Le rapport est un fichier commité sur la branche de la story, pas un commentaire GitHub.
- **Lancer les tests** : [docs/qa/STRATEGIE_TESTS.md](docs/qa/STRATEGIE_TESTS.md). Sans Docker ni PostgreSQL local, se fier à la CI (`gh pr checks <n>`).
- **État du projet** : `docs/team/RESUME_HERE.md`, `docs/team/BOARD.md`, puis la passation `docs/team/handoffs/US-xxx.md` de la story reprise.

## 6. Structure du dépôt

```
apps/
  api/                  NestJS (ESM) : src/main.ts (API HTTP) et src/worker.ts (travailleur pg-boss), une image, deux processus
    src/modules/<code>/ un module Nest par bounded context (17 §2.2) + BUS (socle, 17 §2.1)
    src/modules/dependency-graph.ts  graphe des dépendances autorisées (donnée lue par le lint)
  web/                  Next.js (App Router), mobile-first : guest, console agence, comptoir
  backoffice/           Next.js séparé : back-office interne (domaine distinct)
packages/
  config/               ESLint partagé (règles maison), tsconfig partagés, contrôle d'horloge SQL
  db/                   schémas par module (schemas.ts), migrations SQL, amorçage des rôles, exécuteur et harnais de tests (US-005), liste blanche de l'horloge
  i18n/                 catalogues es / en / fr / pt, profils de locale (config/locales.json), formats d'affichage (US-014)
docs/adr/               ADR du dépôt (report dans 17 §8.1)
docs/specs/             spécification figée : ne pas modifier
docs/team/              artefacts entre agents (US-029)
```

## 7. Modules et frontières (17 §2.1, §2.2)

- Chaque module `apps/api/src/modules/<code>/` contient :
  - `index.ts` : **seul point d'entrée public** (ce que les autres modules ont le droit d'importer) ;
  - `<code>.module.ts` : le module Nest (`IamModule`, `AvlModule`…) ;
  - `internal/` : tout le reste (services, dépôts, SQL), privé ;
  - `README.md` : une ligne, responsabilité et dépendances autorisées.
- **Règle `rueda/module-boundaries`** (dans `pnpm lint`) :
  - importer `modules/<x>/internal/…`, `modules/<x>/<x>.module.ts` ou tout autre fichier que `index.ts` depuis l'extérieur du module `<x>` est une erreur, y compris depuis `app.module.ts` ;
  - un module ne peut importer que les modules autorisés par `dependency-graph.ts` (colonne « Dépend de » de 17 §2.2 et flèches pleines de §2.1). Tout module hors socle peut aussi dépendre du **socle CFG, AUD, BUS**. Dans le socle, BUS ne dépend de personne ; CFG et AUD ne dépendent que de BUS, pour publier leurs événements par l'outbox ;
  - un répertoire de module absent du graphe est une erreur.
- Le graphe est **acyclique** (test `dependency-graph.test.ts`). Ajouter une dépendance = décision d'architecture : ADR, report dans 17 §2.2, revue de l'agent architecture.
- Les données d'un autre module ne se lisent que par son interface (requête exposée ou événement) ; aucune écriture SQL dans les tables d'un autre module ; jointures inter-schémas en lecture seulement dans RPT (17 §2.1).
- Seuls les imports relatifs existent dans `apps/api` (pas d'alias de chemin) : c'est ce qui rend la règle fiable. Ne pas introduire d'alias sans adapter la règle.

## 8. SQL et horloge (17 §1.3, ADR-030)

- L'horloge qui fait foi est celle de la base : **`platform.now()`**, et elle seule. Interdits dans le SQL métier : `now()`, `current_timestamp` (`CURRENT_TIMESTAMP`), `localtimestamp`, `transaction_timestamp()`, `statement_timestamp()`, `timeofday()`, `current_date`, `current_time`, `localtime`, les littéraux `'now'`, `'today'`, `'tomorrow'`, `'yesterday'`, et `clock_timestamp()`.
- **Exception unique** : le fichier qui définit `platform.now()` (`clock_timestamp()` en production) figure dans `packages/db/sql-clock-allowlist.json`, avec une justification. Seul `clock_timestamp()` peut y être toléré ; toute entrée nouvelle passe par l'agent architecture.
- Contrôle : `pnpm lint` analyse tous les fichiers `.sql` (`packages/config/sql-clock/cli.ts`) et, dans le TypeScript, les gabarits étiquetés `sql` et les chaînes qui ressemblent à du SQL (`rueda/no-sql-clock`).
- **Requêtes paramétrées seules** (17 §2.3 RLS-18, US-049, ADR-088) : dans le code exécuté sous un rôle applicatif (`apps/*/src`, `packages/*/src`, hors tests et outils d'administration de `@rueda/db`), le texte passé à `query()` est fixe (littéral, gabarit sans interpolation, constante du module) et les valeurs passent en paramètres liés ; un gabarit interpolé, une concaténation ou un appel de fonction fait échouer `pnpm lint` (`rueda/no-dynamic-sql`). Une exception se déclare ligne à ligne avec sa raison (`// eslint-disable-next-line rueda/no-dynamic-sql -- …`) et se relit en revue sécurité.
- Les commentaires (`--`, `/* */` imbriqués) et les chaînes `'…'` ne déclenchent pas l'erreur. Un identifiant `"…"` non plus, sauf s'il est appelé ou qualifié : `"now"()` et `"pg_catalog"."now"()` sont détectés. Le contenu des chaînes dollar (`$$…$$`, `$tag$…$tag$`) est analysé comme du code (corps de fonctions).
- Le serveur applicatif ne calcule jamais un instant d'expiration et ne passe jamais « l'heure courante » en paramètre (17 §1.3).

## 9. Base de données : schémas et tables (17 §2.1, §10 point 3)

- **Cible** : un schéma PostgreSQL par module, **avec les noms qu'utilise le SQL de 17**. La donnée de référence est `packages/db/schemas.ts` (`MODULE_SCHEMAS`). Un test vérifie que chaque module du graphe y a un schéma.

  | Module                        | Schéma                                                            | Origine                                                 |
  | ----------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------- |
  | AVL                           | `booking`                                                         | 17 (`booking.checkout_hold`, `booking.trip`…)           |
  | CAT                           | `catalog`                                                         | 17 (`catalog.vehicle_is_free`…)                         |
  | PAY                           | `payment`                                                         | 17 (`payment.payment_operation`)                        |
  | FIN                           | `finance`                                                         | 17 (`finance.commission_statement`)                     |
  | CFG                           | `config`                                                          | 17 (`config.currency`)                                  |
  | IAM, KYC, PRC, CTR, STL, PYO  | `iam`, `kyc`, `pricing`, `contract`, `settlement`, `payout`       | PROPOSÉ (préfixe des événements de 17 §2.2)             |
  | TRP                           | `trip_ops`                                                        | PROPOSÉ (pas `trip` : la table `trip` appartient à AVL) |
  | CLM, MSG, NTF, REV, SUP, RISK | `claim`, `messaging`, `notification`, `review`, `support`, `risk` | PROPOSÉ                                                 |
  | AUD, RPT, BUS                 | `audit`, `reporting`, `outbox`                                    | PROPOSÉ                                                 |

- **Schémas transverses** (17) : `platform` pour les fonctions de plateforme (`platform.now()`, `platform.guest_hold_guard()`) ; `app` pour le contexte de session et les aides RLS (`app.org_id()`, `app.has_permission()`).
- **Bêta pilote (D1, 17 §10 point 3)** : un schéma unique `core` (PROPOSÉ, car 17 ne le nomme pas). Chaque table y est **préfixée par son schéma cible** : `booking_checkout_hold`, `booking_trip`, `catalog_listing`, `config_currency`, `payment_payment_operation` (`betaTableName()`). Les noms d'entités et de colonnes restent ceux de 17 §3 : aucune table « bêta » jetable (17 §10 principe 1). Le passage au schéma par module sera un renommage mécanique (`core.booking_trip` → `booking.trip`). Le préfixe exact est à reporter dans 17 §10 point 3 par l'orchestrateur.
- Un nom PROPOSÉ peut être changé par US-005 tant qu'aucune migration ne l'utilise. Un nom d'origine 17 ne change pas sans ADR.
- Migrations dans `packages/db/migrations/`, additives et réversibles ; outil et format fixés par US-005 (ADR-044, `packages/db/README.md`).
- **Numérotation des migrations** : numéro strictement supérieur au plus grand de `origin/main` au moment de la fusion ; renuméroter à chaque mise à jour de la branche ; aucune plage réservée ; production contiguë depuis `0000`, tests ≥ `9000`. Contrôle : `packages/db/src/numbering.test.ts`. Détail : `packages/db/migrations/README.md`.

## 10. Nommage

| Élément                   | Convention                                        | Exemple                          |
| ------------------------- | ------------------------------------------------- | -------------------------------- |
| Code de module            | code de 17 §2.2, majuscules                       | `AVL`                            |
| Répertoire de module      | code en minuscules                                | `apps/api/src/modules/avl/`      |
| Module Nest               | code en PascalCase + `Module`                     | `AvlModule` dans `avl.module.ts` |
| Fichiers TypeScript       | `kebab-case.ts`, tests `*.test.ts` à côté du code | `checkout-hold.service.ts`       |
| Classes, types            | `PascalCase`                                      | `CheckoutHold`                   |
| Variables, fonctions      | `camelCase`                                       | `computeSettlement`              |
| Constantes                | `SCREAMING_SNAKE_CASE`                            | `MODULE_CODES`                   |
| Entités, tables, colonnes | noms de 17 §3, `snake_case`, anglais              | `checkout_hold.expires_at`       |
| Événements de domaine     | noms de 17 §4.5 : `<contexte>.<entité>.<fait>`    | `booking.hold.expired`           |
| Paramètres                | noms de 17 §7.2, en points                        | `payment_in_flight_margin_s`     |
| Variables d'environnement | `SCREAMING_SNAKE_CASE`                            | `PORT`                           |
| Branches                  | `story/US-xxx-<slug>`                             | `story/US-001-depot-conventions` |

- **Langue** : code, identifiants, entités, codes d'erreur en **anglais** ; documentation, récits, commentaires et messages de commit en **français** ; textes d'interface en espagnol neutre LATAM (es-PA, es-PY), en anglais (19 §1.1), en français (DEC-FONDATEUR-17) et en portugais du Brésil (pt-BR, DEC-FONDATEUR-18).
- Marque : non choisie (DEC-MARQUE). Utiliser le provisoire `{brand_name}` (constante `BRAND_NAME` de chaque application), jamais un nom en dur.

## 11. Codes d'erreur (16 A.8, 17 §4)

- Codes stables en `SCREAMING_SNAKE_CASE` (majuscules) **sans préfixe** : `VEHICLE_UNAVAILABLE`, `SETTLEMENT_EXISTS`, `INVALID_TRANSITION`, `GUEST_OVERLAP`. Le préfixe `ERR_` de la version 1 est supprimé : ne jamais l'utiliser.
- Le catalogue de référence est 16 A.8 (et les codes de 08 BR-BOOK-11, repris tels quels) ; un code nouveau est un nom de référence PROPOSÉ, ajouté au catalogue dans la même story.
- Un code publié ne change plus (les clients s'y fient). Il ne transporte jamais le `DETAIL` PostgreSQL ; le message est localisé es/en, sans détail technique pour le guest.

## 12. Style et interface

- TypeScript strict (`tsconfig.base.json`) ; Prettier pour la mise en forme ; ESLint pour le reste.
- **Aucun style codé en dur** dans un composant (couleurs, typographies, espacements, rayons, ombres, mouvements) : tout vient des jetons de design (US-030). Tout texte passe par le catalogue i18n (US-014) ou un bloc de contenu éditable.
- Aucun secret dans le dépôt (`.env` est ignoré ; seul `.env.example` est versionné, noms seulement).

## 13. Documentation et décisions

- Chaque story met à jour : README du module touché, OpenAPI si l'API change, schéma et migrations si la base change, inventaire des variables d'environnement, CHANGELOG, et un **ADR** pour toute décision d'architecture (`docs/adr/ADR-NNN-<titre>.md`, gabarit Contexte / Décision / Conséquences / Alternatives, report dans 17 §8.1) — 19 §1.4 point 6.
- `docs/specs/` est un instantané figé : ne pas le modifier hors demande de fusion approuvée.
