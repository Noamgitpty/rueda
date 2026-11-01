# packages/db — base de données PostgreSQL (`@rueda/db`)

Migrations SQL versionnées, exécuteur de migrations minimal et harnais de tests sur PostgreSQL réel (US-005 ; 17 §1.3, §2.3, §11 L0-05 / L0-06 ; ADR-030, ADR-035, ADR-043, ADR-044). Pilote `pg`, aucun ORM pour l'instant (Kysely ou Drizzle plus tard, 17 §6.1).

## Arborescence

| Chemin                               | Rôle                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/0000_instance_roles.sql`  | **Amorçage idempotent**, exécuté par un administrateur dans la base cible avant les migrations : rôles d'instance (créés s'ils manquent, attributs réimposés à chaque passage), droits sur la base, `REVOKE CREATE ON SCHEMA public`, `btree_gist`. Non suivi : rejoué à chaque fois. |
| `migrations/NNNN_<nom>.sql`          | Migrations de production, appliquées **sous `migrator`**, une transaction chacune, suivies dans `platform.schema_migration` (somme SHA-256 : une migration appliquée est immuable).                                                                                                   |
| `test-migrations/9NNN_<nom>.sql`     | Migrations **de test seulement** (horloge virtuelle). Jamais appliquées hors du harnais.                                                                                                                                                                                              |
| `sql-clock-allowlist.json`           | Liste blanche de la règle d'horloge (CONTRIBUTING « SQL et horloge ») : `0000_platform_now.sql` et `9000_test_virtual_clock.sql`, `clock_timestamp()` seulement.                                                                                                                      |
| `src/migrate.ts`, `src/bootstrap.ts` | Exécuteur (`runMigrations`, `planMigrations`, `listMigrations`) et amorçage (`runBootstrap`, `setRolePasswords`).                                                                                                                                                                     |
| `src/testing/`                       | Harnais de tests (`@rueda/db/testing`) : source de la base, banc jetable, connexions sous les rôles de production, transaction de test.                                                                                                                                               |

Migrations actuelles : `0000_platform_now` (schéma `platform`, `platform.now()` = `clock_timestamp()` `VOLATILE`, `platform.schema_migration` sous RLS `ENABLE` + `FORCE`), `0001_role_grants` (droits minimaux), test `9000_test_virtual_clock`.

## Rôles (17 §2.3, ADR-035)

| Rôle                                                                      | Attributs                                                           | Usage                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `migrator`                                                                | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE` | propriétaire des objets ; migrations seulement             |
| `app_api`, `app_worker`, `app_anon`                                       | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE` | exécution de l'application **et de tous les tests**        |
| `guard_owner`, `catalog_probe_owner`, `policy_fn_owner`, `cmd_hold_owner` | `NOLOGIN`, sans mot de passe, sans membre                           | propriétaires des familles de fonctions `SECURITY DEFINER` |

Droits actuels : `USAGE` sur `platform` et `EXECUTE` sur `platform.now()` pour `app_api`, `app_worker` et les quatre propriétaires ; rien pour `app_anon` ni pour `PUBLIC` ; `ALTER DEFAULT PRIVILEGES FOR ROLE migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. Aucun mot de passe dans le SQL : le harnais (ou, plus tard, le gestionnaire de secrets) les pose, en envoyant un vérificateur SCRAM-SHA-256 et jamais le mot de passe en clair.

## Commandes

```bash
pnpm test:unit   # sans base : exécuteur (plan, sommes), masquage des secrets, SCRAM, source
pnpm test:int    # PostgreSQL réel : banc, migrations, droits minimaux, transaction de test
pnpm test:l0     # preuves L0-05 (partiel) et L0-06 sous les rôles de production
```

Variables (noms seulement, inventaire : `docs/ops/ENV_VARS.md`) :

- local (P-07, PostgreSQL 16 natif) : `RUEDA_PG_ADMIN_URL` (URL **sans** mot de passe, par exemple `postgres://postgres@localhost:5432/postgres`) et `RUEDA_PG_SUPERUSER_PASSWORD_FILE` (chemin d'un fichier **hors dépôt**, une ligne) ;
- CI : `RUEDA_PG_TESTCONTAINERS=1` (démarre `postgres:16` par Testcontainers ; Docker requis). **La CI fait foi** (ADR-043) ; un vert local ne suffit pas.

Sans l'une ou l'autre configuration, `test:int` et `test:l0` **échouent** (jamais de faux vert). Le service Windows `postgresql-x64-16` doit être démarré (action du fondateur, droits administrateur).

## Fonctionnement du harnais

1. `globalSetup` (`src/testing/global-setup.ts`) choisit la source par **une seule fonction** (`resolveAdminSource`) : URL + fichier de mot de passe, sinon Testcontainers.
2. `provisionBench` prend un **verrou consultatif d'instance** dans la base d'administration (une série à la fois par instance : les mots de passe des rôles changent à chaque série), supprime les bases `rueda_test_*` orphelines d'une série interrompue, puis crée deux bases jetables :
   - `rueda_test_<aléa>` : migrations de production **+** `test-migrations/` ;
   - `rueda_test_<aléa>_prod` : migrations de production seules, pour vérifier que le corps de production de `platform.now()` ne lit pas `app.virtual_now` (L0-06).
3. Dans chaque base : amorçage sous l'administrateur, mots de passe aléatoires de la série pour `migrator`, `app_api`, `app_worker`, `app_anon`, migrations sous `migrator`, puis un second passage de l'exécuteur qui doit être vide (idempotence).
4. Les tests utilisent `withRole(role, fn, { database })` ou `connectAs(role)` : connexion **directe** (`pg.Client`, sans pooler) et **assertion L0-05** (`current_user ∈ {app_api, app_worker, app_anon}`, `NOT rolsuper AND NOT rolbypassrls`). `setup-l0-05.ts` fait échouer tout test qui n'a exécuté aucune assertion de rôle.
5. `withTestTransaction(client, { virtualNow, commit }, fn)` : `BEGIN`, `SET LOCAL app.virtual_now` (par `set_config(…, true)`, paramètre lié), contrôle que `platform.now()` vaut l'heure virtuelle (ou, sans heure virtuelle, qu'il est à moins de 120 s de l'horloge du test), `fn`, `ROLLBACK` par défaut, puis `RESET ALL` dans tous les cas.
6. Le teardown supprime les deux bases (`DROP DATABASE … WITH (FORCE)`) et libère le verrou, **même si des tests ont échoué**.
7. `connectForNegativeRoleTest('migrator' | 'admin')` est réservé aux tests **négatifs** de l'assertion L0-05.

Secrets : le mot de passe du superutilisateur est lu dans le fichier, jamais placé dans une URL, jamais affiché ; toute erreur du banc est expurgée (`redactError` : mot de passe d'administration et mots de passe de la série, URL `postgres://user:***@`).

## Écrire une migration

- Nom `NNNN_<module>_<objet>.sql` (minuscules, chiffres, `_`), numéro suivant le dernier ; **jamais** modifier une migration appliquée (somme vérifiée) ; jamais deux agents sur la même migration (19 §1.5).
- Additive ; un commentaire « Retour arrière » décrit l'inverse (l'exécuteur n'a pas encore de migrations descendantes, voir la passation US-005).
- Horloge : `platform.now()` seulement (`now()`, `current_timestamp`… échouent au lint).
- Toute table : `ENABLE` et `FORCE ROW LEVEL SECURITY`, politique `migrator_all … TO migrator` (17 §2.3, B9), aucun droit à `PUBLIC`.

## Conventions (17 §2.1, §10 point 3)

- **Cible** : un schéma PostgreSQL par module (`iam`, `kyc`, `cat`, `avl`, …), nommé d'après le répertoire du module dans `apps/api/src/modules/`.
- **Bêta pilote (D1)** : un schéma unique, et chaque table préfixée par le code du module en minuscules : `avl_trip`, `cfg_country`, `pay_payment_operation`. Le passage au schéma par module est une migration de renommage, sans changement des noms d'entités.
- Fonctions de plateforme (`platform.now()`) : schéma `platform`.
