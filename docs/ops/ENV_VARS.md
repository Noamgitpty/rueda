# Inventaire des variables d'environnement

> **Noms seulement** : aucune valeur secrète ici ni dans le dépôt (CLAUDE.md « Interdits »). Chaque story qui ajoute une variable la déclare ici (19 §1.4 point 6).

| Variable                           | Composant                      | Obligatoire               | Secret                      | Description                                                                                                                                   | Story  |
| ---------------------------------- | ------------------------------ | ------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `PORT`                             | `apps/api` (API HTTP)          | non (défaut de `main.ts`) | non                         | port d'écoute de l'API                                                                                                                        | US-001 |
| `RUEDA_PG_ADMIN_URL`               | `packages/db` (harnais, tests) | en local (P-07)           | non : **sans mot de passe** | URL d'administration PostgreSQL, ex. `postgres://postgres@localhost:5432/postgres` ; une URL qui porte un mot de passe est refusée            | US-005 |
| `RUEDA_PG_SUPERUSER_PASSWORD_FILE` | `packages/db` (harnais, tests) | avec `RUEDA_PG_ADMIN_URL` | le **fichier** est secret   | chemin d'un fichier **hors dépôt** contenant le mot de passe du superutilisateur (une ligne) ; le contenu n'est jamais affiché ni journalisé  | US-005 |
| `RUEDA_PG_TESTCONTAINERS`          | `packages/db` (harnais, tests) | en CI (`1`)               | non                         | `1` : à défaut de `RUEDA_PG_ADMIN_URL`, démarre `postgres:16` par Testcontainers (Docker requis)                                              | US-005 |
| `DOCKER_*`, `TESTCONTAINERS_*`     | Testcontainers (bibliothèque)  | non                       | selon la variable           | réglages propres à Testcontainers / Docker (hôte Docker, Ryuk…), transmis par Turborepo aux tâches `test:int` et `test:l0` (`passThroughEnv`) | US-005 |

Turborepo filtre l'environnement des tâches (mode strict) : les variables `RUEDA_PG_*`, `DOCKER_*` et `TESTCONTAINERS_*` sont transmises explicitement à `test:int` et `test:l0` dans `turbo.json`.
