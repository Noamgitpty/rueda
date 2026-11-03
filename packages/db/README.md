# packages/db — base de données PostgreSQL (`@rueda/db`)

Migrations SQL versionnées, exécuteur de migrations minimal et harnais de tests sur PostgreSQL réel (US-005 ; 17 §1.3, §2.3, §11 L0-05 / L0-06 ; ADR-030, ADR-035, ADR-043, ADR-044). Pilote `pg`, aucun ORM pour l'instant (Kysely ou Drizzle plus tard, 17 §6.1).

## Arborescence

| Chemin                               | Rôle                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bootstrap/0000_instance_roles.sql`  | **Amorçage idempotent**, exécuté par un administrateur dans la base cible avant les migrations : rôles d'instance (créés s'ils manquent, attributs réimposés à chaque passage), droits sur la base, `REVOKE CREATE ON SCHEMA public`, `btree_gist`. Non suivi : rejoué à chaque fois.                                    |
| `migrations/NNNN_<nom>.sql`          | Migrations de production, appliquées **sous `migrator`**, une transaction chacune, suivies dans `platform.schema_migration` (somme SHA-256 : une migration appliquée est immuable).                                                                                                                                      |
| `test-migrations/9NNN_<nom>.sql`     | Migrations **de test seulement** (horloge virtuelle). Jamais appliquées hors du harnais.                                                                                                                                                                                                                                 |
| `schemas.ts`                         | Correspondance **code de module → schéma PostgreSQL** (`MODULE_SCHEMAS`), schémas transverses (`SHARED_SCHEMAS`) et nommage Bêta (`BETA_SCHEMA`, `betaTableName()`), US-001. `schemas.test.ts` vérifie que chaque module du graphe (`apps/api/src/modules/dependency-graph.ts`) a un schéma. Export `@rueda/db/schemas`. |
| `sql-clock-allowlist.json`           | Liste blanche de la règle d'horloge (CONTRIBUTING « SQL et horloge ») : `0000_platform_now.sql` et `9000_test_virtual_clock.sql`, `clock_timestamp()` seulement.                                                                                                                                                         |
| `src/migrate.ts`, `src/bootstrap.ts` | Exécuteur (`runMigrations`, `planMigrations`, `listMigrations`) et amorçage (`runBootstrap`, `setRolePasswords`).                                                                                                                                                                                                        |
| `src/testing/`                       | Harnais de tests (`@rueda/db/testing`) : source de la base, banc jetable, connexions sous les rôles de production, transaction de test.                                                                                                                                                                                  |

Migrations actuelles :

- `0000_platform_now` : schéma `platform`, `platform.now()` = `clock_timestamp()` `VOLATILE`, `platform.schema_migration` sous RLS `ENABLE` + `FORCE` ;
- `0001_role_grants` : droits minimaux ;
- `0002_app_session_context` à `0007_avl_pay_worker_grants` : schéma de preuve AVL / PAY (US-006, section « Schéma AVL / PAY ») ;
- tests : `9000_test_virtual_clock`, `9001_test_l0_fixtures`.

## Schéma AVL / PAY (US-006 ; 17 §2.5, §3.2.4, §3.2.7, §11 ; ADR-047)

Sous-ensemble **exact** des entités de 17 (noms d'entités et de colonnes de 17, schéma Bêta `core`, préfixe du schéma cible) : réutilisé tel quel par US-019, US-022 à US-024, ce n'est pas un prototype. Les colonnes manquantes arrivent par migrations additives.

| Table                              | Contraintes clés                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.booking_vehicle_occupancy`   | exclusion `vehicle_occupancy_no_overlap` `EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active)` ; `period_valid` (`[début, fin)` borné) ; `hold_has_ttl`, `trip_has_no_ttl` ; `trip_occupancy_has_ref` ; `inactive_has_reason` ; index uniques `occupancy_ical_uid_unique`, `one_active_occupancy_per_trip` |
| `core.booking_checkout_hold`       | `hold_kind_valid` (`CHECKOUT` seul ; `REQUEST` avec US-219), `hold_status_valid`, `hold_converted_has_trip`, `hold_conversion_op_unique` ; index `one_live_hold_per_guest_vehicle` (`ACTIVE`, `PAYMENT_IN_FLIGHT`) ; index de 2a `(vehicle_id, status)`, `(guest_user_id, status)` ; trigger `hold_terminal_status`          |
| `core.booking_trip`                | états SM-1, `trip_period_valid`, `trip_terminated_has_reason`, `trip_source_hold_unique` ; trigger différé `trip_has_active_occupancy`                                                                                                                                                                                       |
| `core.booking_guest_occupancy`     | exclusion `guest_no_overlap` (trips seulement, sans tampon)                                                                                                                                                                                                                                                                  |
| `core.booking_hold_compensation`   | `hold_compensation_operation_unique` (une opération compensée une fois)                                                                                                                                                                                                                                                      |
| `core.booking_payment_disposition` | PK `payment_disposition_pkey` = XOR conversion / compensation ; `one_conversion_per_hold` ; triggers `disposition_rent_payment_only`, `disposition_matches_hold` ; immuable                                                                                                                                                  |
| `core.payment_payment_operation`   | cohérence `kind` / `purpose`, `amount_minor > 0` (bigint, unités mineures), `idem_plain` unique                                                                                                                                                                                                                              |
| `core.payment_webhook_inbox`       | `webhook_inbox_dedup` `UNIQUE NULLS NOT DISTINCT (provider, psp_account_id, dedup_key)`                                                                                                                                                                                                                                      |

**Invariant I-OCC** (17 §2.5) : tout trip dans un état qui tient le créneau a exactement une occupation `TRIP` active (`ref_id = trip.id`, même véhicule). Les états concernés sont `BOOKED`, `CHECKIN_OPEN`, `START_WINDOW_EXPIRED`, `IN_PROGRESS`, `OVERDUE` et `UNRETURNED` (lecture de SM-1, PROPOSÉ). L'invariant est vérifié au `COMMIT` par trois triggers différés (`trip_has_active_occupancy`, `occupancy_trip_guard`, `occupancy_trip_ref_valid`) ; la borne « au plus une » est structurelle (index `one_active_occupancy_per_trip`). Les fonctions de trigger qui lisent d'autres lignes sont `SECURITY DEFINER` sous `migrator` : voir ADR-047.

**Clés étrangères en attente** : `vehicle_id`, `guest_user_id`, `org_id`, `quote_id`, `listing_id`, `psp_account_id`, `refund_instance_id` sont des `uuid` sans FK tant que la table cible n'existe pas ; la story qui la crée ajoute la contrainte. Codes pays et devises : format seulement (la liste fait foi dans la configuration, US-008).

**Droits** (17 §2.3, VERIF_17-A1, A2) :

- `PUBLIC`, `app_anon` et `app_api` n'ont **aucun** droit sur ces tables. Les lectures filtrées d'`app_api` arrivent avec US-011, les commandes `cmd_*` sous `cmd_hold_owner` avec US-023.
- Personne n'a `DELETE`.
- `app_worker` reçoit des colonnes bornées par `GRANT UPDATE (colonnes)` et une politique par commande SQL. Chaque politique exige `app.actor_kind() = 'WORKER'` et un nom de travailleur de la liste. Sans contexte, aucune ligne n'est visible et aucune écriture n'est possible.

| Travailleur (`app.worker_name`, PROPOSÉ)                              | Rôle (17 §2.5)                                                                                                              |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `booking_conversion`, `disposition_sweeper`, `payment_intent_sweeper` | étape 4 (conversion, ré-acquisition avec 2a partie véhicule), étape 5 (compensation, bloc C)                                |
| `hold_expiry`                                                         | étape 7 (expiration) et libération effective : hold vivant → `EXPIRED` / `RELEASED`, occupation `HOLD` désactivée seulement |
| `trip_lifecycle`                                                      | transitions SM-1 qui désactivent ou raccourcissent l'occupation `TRIP`                                                      |
| `webhook_ingest`                                                      | `webhook_inbox`, statut des opérations (17 §4.4)                                                                            |

**Traduction des erreurs** (`translateDbError`, `src/errors.ts`) : la traduction se fait par le couple (SQLSTATE, contrainte), et seuls `code` et `retryable` sont renvoyés, jamais de `DETAIL`. Une contrainte inconnue donne `INTERNAL_ERROR`.

- Codes repris de 17 et de 16 :
  - `vehicle_occupancy_no_overlap` → `VEHICLE_UNAVAILABLE` ;
  - `guest_no_overlap` → `GUEST_OVERLAP` ;
  - `one_conversion_per_hold` → `DUPLICATE_PAYMENT` ;
  - `hold_terminal_status` → `INVALID_TRANSITION` ;
  - triggers I-OCC et disposition → `INVARIANT_VIOLATION`.
- Codes PROPOSÉS, à reporter dans 16 A.8 :
  - `one_live_hold_per_guest_vehicle` → `HOLD_ALREADY_LIVE` ;
  - `webhook_inbox_dedup` → `WEBHOOK_DUPLICATE` (réponse 200 sans traitement) ;
  - `payment_disposition_pkey` et `hold_compensation_operation_unique` → `DISPOSITION_EXISTS` ;
  - `40P01` et `40001` → `RETRY` (rejeu de la transaction entière).

**Fixtures de test** (`test-migrations/9001`, base principale seulement) : `test_fixture.place_hold` remplace `cmd_place_hold` (US-023) et `test_fixture.insert_payment_operation` remplace `cmd_start_payment`. `test_fixture.delete_occupancy` force une suppression qu'aucun rôle ne peut faire : elle est refusée par la clé étrangère du hold (`23503`), et `occupancy_trip_guard` couvre aussi `DELETE`. Ces fonctions sont `SECURITY DEFINER` sous `migrator` ; la transaction appelante reste sous `app_api` ou `app_worker`.

## Rôles (17 §2.3, ADR-035)

| Rôle                                                                      | Attributs                                                           | Usage                                                      |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| `migrator`                                                                | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE` | propriétaire des objets ; migrations seulement             |
| `app_api`, `app_worker`, `app_anon`                                       | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE` | exécution de l'application **et de tous les tests**        |
| `guard_owner`, `catalog_probe_owner`, `policy_fn_owner`, `cmd_hold_owner` | `NOLOGIN`, sans mot de passe, sans membre                           | propriétaires des familles de fonctions `SECURITY DEFINER` |

Droits actuels : `USAGE` sur `platform` et `EXECUTE` sur `platform.now()` pour `app_api`, `app_worker` et les quatre propriétaires ; rien pour `app_anon` ni pour `PUBLIC` ; `ALTER DEFAULT PRIVILEGES FOR ROLE migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. Aucun mot de passe dans le SQL : le harnais (ou, plus tard, le gestionnaire de secrets) les pose, en envoyant un vérificateur SCRAM-SHA-256 et jamais le mot de passe en clair.

## Commandes

```bash
pnpm test:unit   # sans base : correspondance des schémas, exécuteur (plan, sommes), masquage des secrets, SCRAM, source
pnpm test:int    # PostgreSQL réel : banc, migrations, droits minimaux, transaction de test
pnpm test:l0     # preuves L0-01, L0-03, L0-05 (partiel), L0-06, L0-08 sous les rôles de production
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

- **Cible** : un schéma par module, avec les noms du SQL de 17 quand ils existent :
  - `booking` (AVL) ;
  - `catalog` (CAT) ;
  - `payment` (PAY) ;
  - `finance` (FIN) ;
  - `config` (CFG).

  Les autres noms sont PROPOSÉS : `iam`, `kyc`, `pricing`, `contract`, `settlement`, `payout`, `trip_ops`, `claim`, `messaging`, `notification`, `review`, `support`, `risk`, `audit`, `reporting`, `outbox`. Le tableau complet, avec la preuve de chaque nom, est dans `schemas.ts`.

- **Schémas transverses** (17) : `platform` (`platform.now()`, `platform.guest_hold_guard()`) et `app` (`app.org_id()`, `app.has_permission()`).
- **Bêta pilote (D1)** : schéma unique `core` (PROPOSÉ). Chaque table est préfixée par son schéma cible : `booking_checkout_hold`, `catalog_listing`, `config_currency`. Le passage au schéma par module sera un renommage mécanique, sans changement des noms d'entités.
- `now()`, `current_timestamp` et les autres horloges sont interdits dans le SQL métier : utiliser `platform.now()` (17 §1.3, ADR-030).
