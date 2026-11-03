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
| `country-data-allowlist.json`        | Liste blanche du contrôle « aucune constante pays » des migrations (US-013, ADR-049) : seules les graines générées (`0009_config_seed.sql`) peuvent nommer une devise, un fuseau, un pays, une locale régionale ou une taxe.                                                                                             |
| `src/migrate.ts`, `src/bootstrap.ts` | Exécuteur (`runMigrations`, `planMigrations`, `listMigrations`) et amorçage (`runBootstrap`, `setRolePasswords`).                                                                                                                                                                                                        |
| `src/testing/`                       | Harnais de tests (`@rueda/db/testing`) : source de la base, banc jetable, connexions sous les rôles de production, transaction de test.                                                                                                                                                                                  |

Migrations actuelles :

- `0000_platform_now` : schéma `platform`, `platform.now()` = `clock_timestamp()` `VOLATILE`, `platform.schema_migration` sous RLS `ENABLE` + `FORCE` ;
- `0001_role_grants` : droits minimaux ;
- `0002_app_session_context` à `0007_avl_pay_worker_grants` : schéma de preuve AVL / PAY (US-006, section « Schéma AVL / PAY ») ;
- `0008_config_country` (US-013) : tables de configuration pays dans `core` (schéma créé par `0003_core_schema`), gardes `PARAM_RETROACTIVE` / immuabilité / interrupteurs, `core.config_go_live`, RLS `ENABLE` + `FORCE`, lecture seule pour `app_api` et `app_worker` ;
- `0009_config_seed` (US-013) : graines PA / PY **générées** depuis `apps/api/src/modules/cfg/data/`, ne pas éditer (ADR-049) ;
- `0010_iam_identity`, `0011_iam_auth_commands` (US-010) : schéma IAM et commandes d'authentification (section « Schéma IAM ») ;
- `0012_outbox_tables` à `0015_outbox_monitoring` : outbox, reçus, lettres mortes, file de tâches, métriques (US-008, section « Outbox et file ») ; numérotation : `migrations/README.md` ;
- tests : `9000_test_virtual_clock`, `9001_test_l0_fixtures`, `9100_test_config_writer` (écriture de test pour `app_worker` sur deux tables de configuration, base principale seulement), `9200_test_iam_fixtures` (US-010).

## Schéma AVL / PAY (US-006 ; 17 §2.5, §3.2.4, §3.2.7, §11 ; ADR-048)

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

**Invariant I-OCC** (17 §2.5) : tout trip dans un état qui tient le créneau a exactement une occupation `TRIP` active (`ref_id = trip.id`, même véhicule). Les états concernés sont `BOOKED`, `CHECKIN_OPEN`, `START_WINDOW_EXPIRED`, `IN_PROGRESS`, `OVERDUE` et `UNRETURNED` (lecture de SM-1, PROPOSÉ). L'invariant est vérifié au `COMMIT` par trois triggers différés (`trip_has_active_occupancy`, `occupancy_trip_guard`, `occupancy_trip_ref_valid`) ; la borne « au plus une » est structurelle (index `one_active_occupancy_per_trip`). Les fonctions de trigger qui lisent d'autres lignes sont `SECURITY DEFINER` sous `migrator` : voir ADR-048.

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

## Audit, clés par sujet et magasin de preuves (US-009 ; 17 §1.7, §3.1.3, §3.2.13 ; ADR-051)

Migrations `0016` à `0021`, schéma Bêta `core` :

- `audit_subject_key` : une DEK par sujet (`USER`, `ORG`, `PLATFORM`), **enveloppée** par le KMS (`wrapped_dek`, C4). Seule modification admise : la destruction (`wrapped_dek = NULL`, `destroyed_at`).
- `audit_audit_log` : journal en ajout seul, **chaîné** par SHA-256. Le trigger `zz_audit_log_chain` (`SECURITY DEFINER`) attribue `id`, `at`, `prev_hash`, `hash` sous le verrou de `audit_chain_head`. Forme canonique v1 : ADR-051. **Écrire l'audit en dernier dans la transaction** (la tête reste verrouillée jusqu'au COMMIT).
- `audit_data_access_log` : lectures C3, consultations C2 du support, exports (ADM-032) ; ajout seul, références seulement.
- `audit_file_asset` : empreinte SHA-256 des octets reçus, heure serveur ; fichier C2 / C3 chiffré par la clé de son sujet ; empreinte et emplacement figés. `receiveFile` écrit la ligne avant le dépôt ; le port `FileStore` est en création seule (jamais d'écrasement).
- `core.audit_destroy_subject_key(type, id, demande, motif)` : crypto-shredding, refusé sous gel légal ; **aucun rôle applicatif** (procédure manuelle en Bêta, NN8).

Aucun `UPDATE`, `DELETE` ni `TRUNCATE` pour les rôles applicatifs ; triggers de refus pour tous, propriétaire compris. Écriture : `app_api` (contexte `GUEST`, `HOST`, `STAFF`) et `app_worker` (contexte `WORKER` nommé), par colonnes. Lecture des registres : travailleurs `audit_chain_verifier` (journal, tête) et `evidence_verifier` (fichiers) seulement (noms PROPOSÉS).

Code TypeScript (`@rueda/db/audit`) : `appendAuditLog` (IP de l'acteur chiffrée, repli `c2_withheld` si le KMS est injoignable), `recordDataAccess`, `verifyAuditChain` (vérificateur indépendant du SQL), `SubjectKeyStore` (cache `subject_dek_cache_ttl_s`, PROPOSÉ 300 s), `seal` / `open` (enveloppe v1), `receiveFile` / `verifyFileAsset`, ports `KeyWrapper` et `FileStore`. Adaptateurs **FAKE** (`FakeKeyWrapper`, `InMemoryFileStore`) : `@rueda/db/testing` seulement, refusés si `NODE_ENV = production`.

Codes PROPOSÉS : `audit_log_append_only`, `data_access_log_append_only`, `audit_chain_head_guard`, `subject_key_immutable`, `file_asset_immutable` → `IMMUTABLE_RECORD` ; `audit_log_key_destroyed`, `subject_key_not_live` → `SUBJECT_ERASED` ; `subject_key_legal_hold` → `LEGAL_HOLD_ACTIVE`.

**Fixtures de test** (`test-migrations/9150`) : `destroy_subject_key`, `set_file_legal_hold`, `owner_tamper_audit_log` (simule un propriétaire qui altère le journal, à n'appeler que dans une transaction annulée) et `lock_audit_log` (à prendre avant toute écriture quand le trigger est désactivé, pour éviter un interblocage).

## Outbox et file (US-008 ; 17 §4.1, §4.2 ; ADR-050)

| Table                       | Contraintes et droits clés                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core.outbox_outbox_event`  | enveloppe 17 §4.1 (formats en CHECK, `actor_role = 'SYSTEM'` ⇔ pas d'utilisateur) ; `id` UUID v7 (`platform.uuid_v7()`) ; index partiel des non publiés. INSERT (colonnes de l'enveloppe seulement) pour `app_api` (acteur GUEST / HOST / STAFF) et `app_worker` (travailleur nommé) ; lecture et `published_at` pour `outbox_relay` seul, une fois. |
| `core.outbox_scheduled_job` | `name` = `app.worker_name` ; `scheduled_job_singleton` (une tâche vivante par nom et clé) ; `attempts ≤ max_attempts` (5 par défaut, 17 §4.2) ; bail `locked_until`. Ajout par `app_api` / `app_worker` (naît `CREATED`) ; lecture et mise à jour par le travailleur de la file seulement.                                                           |
| `core.outbox_inbox_receipt` | PK `(consumer, event_id)` ; `consumer = app.worker_name()` imposé par la RLS.                                                                                                                                                                                                                                                                        |
| `core.outbox_dead_letter`   | une ligne par tâche épuisée (`job_id` unique) ; `consumer = app.worker_name()`.                                                                                                                                                                                                                                                                      |

Fonctions `SECURITY INVOKER` (`search_path` figé, `EXECUTE` à `app_worker` ; `app_api` : `outbox_enqueue` et `platform.uuid_v7()` seulement) : `outbox_relay_claim`, `outbox_mark_published`, `outbox_record_relay_failure`, `outbox_enqueue`, `outbox_claim_jobs`, `outbox_begin_receipt`, `outbox_complete_job`, `outbox_fail_job`, `outbox_reap_expired_jobs`, `outbox_metrics` (lecture par `bus_monitor` seulement, 0015). Personne n'a `DELETE`. Tests : `test/int/outbox-schema.test.ts`, `test/l0/outbox-idempotence.test.ts`.

## Schéma IAM (US-010 ; 17 §2.3, §3.2.1 ; ADR-052)

Tables `core.iam_*` (entités de 17 §3.2.1) : `user_account`, `email_verification`, `auth_factor`, `session`, `otp_challenge`, `organization` (compte d'hôte), `membership`, `staff_role_assignment`, `role_permission`, `restriction`. RLS `ENABLE` + `FORCE`, seule politique `migrator_all`, **aucun droit de table** pour `app_api`, `app_worker`, `app_anon`. Les politiques par acteur et par pays sont l'objet de US-011.

Identités prévues pour US-011 : `user_account.id` (`app.actor_id`), `organization.id` / `country_code` / `holder_user_id` (`app.org_id`, `app.is_org_holder()`), `membership.vehicle_scope` (`app.vehicle_scope`), `staff_role_assignment.role` / `country_scope` (`app.country_scope`), `role_permission` (`app.has_permission`).

Contraintes notables : `user_account_password_hash_argon2id` (seule une chaîne PHC argon2id est stockée), `user_account_email_normalized`, `session_token_sha256` (32 octets), trigger `session_guarded_columns` (révocation définitive, aucune prolongation), `membership_holder_matches_org` (le `P2P_HOST` est le titulaire), `membership_one_active_holder`, `organization_country_holder_unique`, `staff_country_scope_format`, `staff_no_self_grant`.

Commandes (`0011`, `SECURITY DEFINER` sous `migrator`, `search_path` figé, `EXECUTE` au seul `app_api`, famille `iam_auth` pour la liste blanche RLS-15) : `core.iam_cmd_register`, `iam_cmd_verify_email`, `iam_auth_lookup`, `iam_cmd_open_session` (300 s à 30 j, 8 h si rôle interne), `iam_session_resolve`, `iam_cmd_revoke_session`, `iam_cmd_revoke_all_sessions`.

**FK en attente** : les colonnes `guest_user_id` et `org_id` des tables AVL ne pointent pas encore vers `iam_user_account` / `iam_organization` (les fixtures L0 de US-006 posent des identifiants libres) ; `organization.legal_entity_id` attend `config` (US-008).

Fixtures de test (`test-migrations/9200`) : statut d'un compte, rôle interne, compte d'hôte, appartenance, lecture brute des sessions et des comptes, écritures forcées refusées par `session_guarded_columns`.

> > > > > > > origin/main

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
