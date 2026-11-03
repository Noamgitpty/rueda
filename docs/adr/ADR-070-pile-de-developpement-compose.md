# ADR-070 — Pile de développement local par `docker compose`, secrets tirés au démarrage, guide prouvé en CI

- **Statut** : PROPOSÉ (US-035, agent back-end, 2026-11-03). Revues exigées : code ; **sécurité** (`.github/`, `scripts/ci/`, `packages/db/`, `packages/fake-adapters/`, `packages/config/`) ; **architecture** (`packages/db/`) ; **argent** (`packages/money/`, README seulement). À reporter dans 17 §6.5 et §8.1.
- **Stories** : US-035 ; s'appuient dessus US-041 (e2e), US-003 (image et pipeline de production, boucles du travailleur). **Sources** : 19 US-035 ; 17 §6.5 (environnements), §11 (L0-05), §12 ; DEC-FONDATEUR-08 ; ADR-041 (Node, pnpm), ADR-043 (banc PostgreSQL), ADR-044 (migrations), ADR-058 (FAKE), C19.

## Contexte

US-035 demande qu'un repreneur installe le projet depuis un poste vierge qui n'a que Docker, avec PostgreSQL, l'API, les travailleurs, les FAKE et les graines PA / PY, puis fasse passer la suite de tests ; et que ce guide soit **prouvé**. Trois contraintes : aucun secret dans le dépôt (CLAUDE.md), aucun FAKE actif en production (C19), et des tests qui tournent sous les rôles de production (L0-05).

Deux obstacles techniques : la base de production déclare `platform.deployment_env() = 'production'` (0028, fail-closed), donc une API lancée en `development` sur une base migrée refuse de démarrer (garde « application et base discordantes ») ; et les rôles PostgreSQL sont communs à toute l'instance, donc le banc de tests change leurs mots de passe.

## Décision

1. **`compose.yaml` à la racine, réservé au développement local et à la CI.** Services : `secrets-init`, `postgres` (`postgres:16`, comme le banc), `db-setup`, `api`, `worker`, `fakes` ; profil `tests`. Ports publiés sur `127.0.0.1` seulement. `RUEDA_ENV=development` explicite sur chaque service Node.
2. **Secrets tirés au démarrage, un volume par rôle.** `secrets-init` (image `postgres:16`, script `docker/dev/init-secrets.sh`) tire 32 octets aléatoires par rôle (`postgres`, `migrator`, `app_api`, `app_worker`, `app_anon`) au premier lancement et les garde ensuite. Chaque service ne monte que le volume des rôles dont il a besoin, en lecture seule : l'API ne voit que `app_api`, le travailleur que `app_worker`. Aucun mot de passe dans le dépôt, dans `.env` (qui ne porte que des ports) ni dans une variable de compose ; l'API reçoit `PGPASSWORD` par lecture du fichier au lancement de son processus. `docker compose down -v` détruit base et secrets.
3. **Image de développement** `docker/dev/Dockerfile` : Node 26.13, pnpm 10.34.9, installation figée, API compilée, utilisateur `node`. Elle contient les dépendances de développement, donc `@rueda/fake-adapters` : elle n'est **jamais** une image de préproduction ou de production (US-003 construit celle-ci sans FAKE, US-020 critère 2).
4. **Base de développement** par `packages/db/src/dev/` (`cli.ts`, `setup.ts`) : refus hors `RUEDA_ENV=development` ; création de `rueda_dev` (un nom `rueda_test_*` est refusé : le banc supprime ces bases) ; amorçage et mots de passe (`runBootstrap`, `setRolePasswords`, ceux du banc) ; migrations de **production** sous `migrator` (dont 0009, graines PA / PY générées depuis les données CFG) ; puis la **surcouche** `packages/db/dev-overlay/` ; enfin vérification sous `app_api` et `app_worker` (rôle courant, ni SUPERUSER ni BYPASSRLS, base `development`, chaque pays des données CFG présent avec sa devise et des paramètres). Les pays attendus sont lus dans `countries.json`, jamais écrits dans le code.
5. **Surcouche de développement** `dev-overlay/0000_dev_deployment_env.sql` : `CREATE OR REPLACE` de `platform.deployment_env()` qui rend `development`. Elle n'ajoute ni droit, ni politique, ni donnée (test `src/dev/setup.test.ts`). Elle n'est **pas** suivie dans `platform.schema_migration` (comme l'amorçage) et elle est rejouée à chaque passage : une base locale accepte donc les migrations suivantes. Pendant de la migration de test `9500` (« test ») et de la future migration d'environnement d'US-003 ; le pipeline de production n'applique que `migrations/`.
6. **FAKE** : ce sont des bibliothèques sans serveur. Le service `fakes` (`packages/fake-adapters/src/dev/smoke.ts`) construit chaque FAKE sous `development`, fait un appel simple, puis prouve qu'il refuse `production`, `preproduction` et `RUEDA_ENV` absent. L'API de développement ne branche pas de registre FAKE (registre de production vide jusqu'au lot C) : c'est hors périmètre.
7. **Tests dans la pile** : le service `tests` lance `test:unit`, `test:int` et `test:l0` de chaque paquet, avec `RUEDA_PG_ADMIN_URL` (sans mot de passe) et `RUEDA_PG_SUPERUSER_PASSWORD_FILE` vers le volume du superutilisateur, c'est-à-dire la source « native » du banc (ADR-043). Le banc crée ses bases jetables `rueda_test_*` sur la même instance ; il change les mots de passe des rôles : le guide relance `db-setup` ensuite.
8. **Guide prouvé** : `docs/ops/INSTALL.md` marque ses étapes exécutables par des blocs `bash guide`. Le job CI `guide d'installation` (runner `ubuntu-latest`, **sans** `setup-node` ni `pnpm` : seulement Docker, bash et git) les extrait et les exécute dans l'ordre (`scripts/ci/run-install-guide.sh`), puis détruit la pile. `scripts/dev/smoke.sh` vérifie la pile, dont la contre-épreuve C19 : la même API lancée avec `RUEDA_ENV=production` doit s'arrêter avec « démarrage refusé (C19) ». Un test unitaire (`scripts/ci/install-guide.test.mjs`) garde les invariants du compose (ports locaux, aucun secret, `RUEDA_ENV`) et du guide.
9. **README par module** : cinq sections obligatoires (`Responsabilité`, `Entités`, `Événements`, `Ports`, `Commandes de test`), contrôlées pour `apps/api/src/modules/*` par `dependency-graph.test.ts` et pour `packages/*` par `scripts/ci/readmes.test.mjs`.

## Conséquences

- Le travailleur n'a pas encore de boucle (US-003) : dans la pile, il initialise son contexte puis sort avec le code 0, que `smoke.sh` exige. Le critère « les travailleurs démarrent » est donc tenu au sens de ce démarrage ; les boucles arrivent avec US-003, sans changer le compose.
- Les fronts Next.js ne sont pas dans la pile (lancés sur le poste) ; US-041 pourra les ajouter pour l'e2e.
- Le job du guide dure plus longtemps que `base de données` (construction de l'image, puis la suite entière) ; il tourne en parallèle des autres.
- Image `postgres:16` et `node:26.13.0-slim` désignées par étiquette, comme le banc Testcontainers ; l'épinglage par empreinte est laissé à US-003 (images de production).

## Alternatives écartées

- **Mots de passe dans `.env`** (même générés) : un fichier en clair sur le poste, monté dans tous les services ; écarté au profit d'un volume par rôle.
- **Migration suivie `NNNN_dev_…`** : l'exécuteur refuse ensuite toute migration de numéro inférieur, donc chaque nouvelle migration de production casserait les bases locales.
- **Lancer l'API avec `RUEDA_ENV=production`** sur la base de développement : refusé par la configuration (`PARAM_MISSING`) et contraire à C19.
- **Tests sur le poste avec Node** : exige Node et pnpm, alors que le critère part d'un poste « avec Docker » ; reste documenté (guide, section 6).
