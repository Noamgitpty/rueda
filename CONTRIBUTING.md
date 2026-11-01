# Contribuer à rueda

Ce dépôt est développé **à 100 % par des agents** Claude Code (19 §1.5) ; le fondateur est le seul humain. Ce guide suffit à un agent neuf pour travailler sans casser les frontières. En cas de doute, la spécification fait foi : `docs/specs/` (point d'entrée : `docs/specs/CLAUDE_BUILD_HANDOFF.md`). Les décisions d'architecture sont dans `docs/adr/`.

**Règle absolue : aucun push sur `main`.** Ni `git push origin main`, ni force-push, ni fusion locale poussée. Seul l'orchestrateur fusionne, par demande de fusion, après les revues requises (19 §1.4 point 9, §1.5).

## 1. Environnement (Windows)

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
| `pnpm test:int`, `pnpm test:l0`     | emplacements réservés : « pas encore implémenté (US-005) », code de sortie 0                                                  |
| `pnpm build`                        | build de l'API (`tsc`) et des deux applications Next.js                                                                       |
| `pnpm format` / `pnpm format:check` | Prettier                                                                                                                      |

Avant toute demande de fusion : `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm build`, tout vert. Les autres commandes de handoff §7 (`test:rls`, `test:concurrency`, `test:money`, `test:e2e`, `test:nightly`) seront ajoutées par leurs stories avec ces noms exacts.

## 3. Branches et worktrees (handoff §4.3)

- **Une story = une branche = un worktree.** Branche : `story/US-xxx-<slug>` (slug en minuscules, mots séparés par `-`, sans accent ; ex. `story/US-006-preuves-l0-01-03-08`). Worktree : `../wt/US-xxx` (dossier frère du dépôt).
- Démarrage :
  ```bash
  git switch main && git pull --ff-only
  git worktree add ../wt/US-006 -b story/US-006-preuves-l0-01-03-08 main
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
  db/                   schémas par module (schemas.ts), migrations SQL (US-005), liste blanche de l'horloge
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
- Migrations dans `packages/db/migrations/`, additives et réversibles ; outil et format fixés par US-005.

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

- **Langue** : code, identifiants, entités, codes d'erreur en **anglais** ; documentation, récits, commentaires et messages de commit en **français** ; textes d'interface en espagnol neutre LATAM (es-PA, es-PY) et en anglais (19 §1.1).
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
