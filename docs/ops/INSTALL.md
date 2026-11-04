# Installer le projet depuis zéro (pile de développement local)

> US-035 (PLT-003, DEC-FONDATEUR-08) ; décision : [ADR-070](../adr/ADR-070-pile-de-developpement-compose.md). **Ce guide est prouvé par la CI** : le job `guide d'installation` de `.github/workflows/ci.yml` exécute, sur un runner vierge qui n'a que Docker, chaque bloc `bash guide` de ce fichier, dans l'ordre (`scripts/ci/run-install-guide.sh`). Un bloc qui ne marche plus fait échouer la CI.

Ce guide donne, sur un poste qui n'a que **Docker**, une pile locale complète :

| Service        | Rôle                                                                                                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `secrets-init` | tire au hasard, au premier lancement, le mot de passe de chaque rôle PostgreSQL ; un volume Docker par rôle ; rien dans le dépôt ni dans `.env`                                                                                                                         |
| `postgres`     | PostgreSQL 16 (`postgres:16`, comme le banc de la CI), port `127.0.0.1:5432`                                                                                                                                                                                            |
| `db-setup`     | base `rueda_dev` : amorçage des rôles, migrations de production **dont les graines PA et PY** (configuration pays générée depuis `apps/api/src/modules/cfg/data/`), surcouche « development », puis vérification sous les rôles de production `app_api` et `app_worker` |
| `api`          | API NestJS sous `app_api`, port `127.0.0.1:3000`                                                                                                                                                                                                                        |
| `worker`       | travailleur sous `app_worker` (US-003) : relais de l'outbox, files, tâches périodiques (`hold_expiry`, `disposition_sweeper`, `booking_oracle`, `risk_pruner`) et notifications ; reste en marche                                                                       |
| `fakes`        | adaptateurs FAKE (PSP, identité, facture électronique, messagerie, fichiers, antivirus, signature, cartes) : chacun démarre sous `development`, puis refuse `production`, `preproduction` et `RUEDA_ENV` absent                                                         |
| `tests`        | profil `tests` : suite unitaire, intégration et preuves L0 contre ce PostgreSQL, sous les rôles de production                                                                                                                                                           |

**Réservé au développement.** Ni ce `compose.yaml`, ni l'image `docker/dev/Dockerfile`, ni la surcouche `packages/db/dev-overlay/` ne servent en préproduction ou en production (US-003). Les FAKE ne sont actifs que parce que `RUEDA_ENV` vaut `development` ; ailleurs, ils refusent de se construire et l'API refuse de démarrer (C19).

**Aucune donnée personnelle.** La base ne contient que la configuration des pays (devises, fuseaux, locales, taxes, paramètres). Aucun compte, aucun nom, aucun e-mail, aucun téléphone n'est créé. Les tests créent leurs propres données synthétiques dans des bases jetables `rueda_test_*`, supprimées à la fin.

## 1. Prérequis

- **Docker** avec **Compose v2** (`docker compose version`), par exemple Docker Engine 26 ou plus, ou Docker Desktop. Environ 4 Go de disque libres.
- **git** et **bash** (Linux, macOS ; sous Windows : Git Bash ou WSL).
- Ports libres sur `127.0.0.1` : `5432` (PostgreSQL) et `3000` (API). Pour en changer : `RUEDA_DEV_PG_PORT` et `RUEDA_DEV_API_PORT` dans `.env`.

Node.js et pnpm ne sont **pas** requis sur le poste : tout tourne dans l'image de développement (Node 26.13, pnpm 10.34.9). Pour développer hors conteneur, voir la section 6.

```bash
git clone https://github.com/Noamgitpty/rueda.git
cd rueda
```

## 2. Configurer et démarrer

`.env` ne contient que des ports, jamais un secret. Il est facultatif.

```bash guide
[ -f .env ] || cp .env.example .env
docker compose version
docker compose up --build -d
```

Le premier lancement construit l'image de développement (installation figée des dépendances, compilation de l'API), puis enchaîne `secrets-init`, `postgres`, `db-setup`, `api`, `worker` et `fakes`. Comptez quelques minutes.

## 3. Vérifier la pile

`scripts/dev/smoke.sh` attend que tout soit prêt, puis contrôle :

1. `secrets-init` et `db-setup` terminés avec le code 0 ;
2. graines PA et PY lisibles sous `app_api` et `app_worker`, base déclarée `development` ;
3. API en bonne santé : `GET /brand/content?locale=es` répond 200, `GET /auth/session` sans cookie répond 401 ;
4. travailleur démarré (`worker.started` journalisé) et toujours en marche ;
5. FAKE : bilan vert ;
6. garde C19 : la même API lancée avec `RUEDA_ENV=production` refuse de démarrer.

```bash guide
bash scripts/dev/smoke.sh
docker compose logs --no-color db-setup
```

La sortie de `db-setup` se termine par `base de développement prête`, avec, pour `app_api` et `app_worker`, la liste des pays et de leurs paramètres.

## 4. Lancer la suite de tests

La suite tourne dans un conteneur, contre le PostgreSQL de la pile, comme en CI : tests unitaires de chaque paquet, puis `test:int` et `test:l0`. Le banc de `@rueda/db` crée ses bases jetables `rueda_test_*` et ne touche pas à `rueda_dev`. Chaque test vérifie d'abord qu'il tourne sous un rôle de production (L0-05).

```bash guide
docker compose --profile tests run --rm tests
```

Le banc change les mots de passe des rôles PostgreSQL (ils sont communs à toute l'instance). Après les tests, `db-setup` remet les mots de passe de la pile, puis on revérifie :

```bash guide
docker compose run --rm db-setup
docker compose restart api
bash scripts/dev/smoke.sh
```

## 5. Arrêter, repartir de zéro

```bash
docker compose down        # arrête, garde la base et les secrets
docker compose down -v     # supprime aussi la base et les secrets (tirés à nouveau au prochain lancement)
```

Après un changement de code : `docker compose up --build -d`. Après une nouvelle migration : `docker compose run --rm db-setup` (idempotent). Une base locale qui a déjà reçu la surcouche accepte les nouvelles migrations : la surcouche n'est pas suivie dans `platform.schema_migration` et elle est rejouée à chaque passage.

Une commande de test précise, dans l'image : `docker compose --profile tests run --rm tests pnpm --filter @rueda/api exec vitest run src/modules/pay`. Chaque README de module (`apps/api/src/modules/<code>/README.md`) et de paquet (`packages/<x>/README.md`) donne ses commandes de test.

## 6. Développer sur le poste (sans conteneur pour le code)

Node.js 26.13 et pnpm 10.34.9 en tête du `PATH` ([CONTRIBUTING.md](../../CONTRIBUTING.md) §1, [ADR-041](../adr/ADR-041-chaine-outils-node-pnpm.md)), puis :

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test:unit
```

Pour `pnpm test:int` et `pnpm test:l0` sur le poste, deux possibilités (`packages/db/README.md`, « Fonctionnement du harnais ») :

- `RUEDA_PG_TESTCONTAINERS=1` : le banc démarre lui-même `postgres:16` par Testcontainers (Docker requis) ;
- le PostgreSQL de cette pile : `RUEDA_PG_ADMIN_URL=postgres://postgres@localhost:5432/postgres` et `RUEDA_PG_SUPERUSER_PASSWORD_FILE` pointant vers un fichier **hors dépôt** qui contient le mot de passe de `postgres`. Ce mot de passe est dans le volume `rueda-dev_secret-postgres` ; ne le copiez jamais dans le dépôt, un ticket ou un journal.

## 7. Dépannage

| Symptôme                                        | Cause probable et remède                                                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `port is already allocated`                     | un autre PostgreSQL ou une autre API écoute déjà : changer `RUEDA_DEV_PG_PORT` ou `RUEDA_DEV_API_PORT` dans `.env`                              |
| `db-setup` échoue sur `password authentication` | les rôles ont été changés par un banc de tests : `docker compose run --rm db-setup` ; sinon `docker compose down -v` puis reprendre à l'étape 2 |
| l'API s'arrête avec `démarrage refusé (C19)`    | `RUEDA_ENV` n'est pas `development`, ou la base n'a pas reçu la surcouche : relancer `db-setup`                                                 |
| l'API s'arrête avec `PARAM_MISSING`             | `RUEDA_ENV` absent ou `production` : la pile locale pose `development` ; ne pas l'enlever                                                       |
| `migration … plus ancienne que la dernière`     | branche plus ancienne que la base locale : `docker compose down -v` puis reprendre à l'étape 2                                                  |
| journaux                                        | `docker compose logs --no-color <service>` ; aucun secret n'y figure (`secrets-init` n'écrit que le nom des rôles)                              |

## 8. Limites (au 2026-11-03)

- **Travailleur** : ses boucles tournent depuis US-003 (`apps/api/src/worker.ts`) ; `smoke.sh` exige qu'il journalise `worker.started` et reste en marche. Aucun canal de notification réel avant le lot C : les envois échouent en `CHANNEL_UNAVAILABLE` (rien ne part). La préproduction et la production utilisent une autre image, sans FAKE (`docker/prod/Dockerfile`, `docs/ops/DEPLOY.md`).
- **Fronts** : `apps/web` et `apps/backoffice` ne sont pas dans la pile ; sur le poste : `pnpm --filter @rueda/web dev` et `pnpm --filter @rueda/backoffice dev` (`RUEDA_API_URL=http://127.0.0.1:3000`, `docs/ops/ENV_VARS.md`).
- **FAKE** : ce sont des bibliothèques en mémoire, sans serveur ; l'API de développement n'a pas encore de registre FAKE branché (le registre de production est vide jusqu'au lot C). Le service `fakes` prouve qu'ils démarrent sous `development` et refusent ailleurs ; les suites de contrat les exercent dans `tests`.
