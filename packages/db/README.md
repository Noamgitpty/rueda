# packages/db — base de données PostgreSQL (`@rueda/db`)

Migrations SQL versionnées, exécuteur de migrations minimal et harnais de tests sur PostgreSQL réel (US-005 ; 17 §1.3, §2.3, §11 L0-05 / L0-06 ; ADR-030, ADR-035, ADR-043, ADR-044). Pilote `pg`, aucun ORM pour l'instant (Kysely ou Drizzle plus tard, 17 §6.1).

## Responsabilité

Porter le schéma PostgreSQL 16 de la plateforme (migrations versionnées, RLS `ENABLE` + `FORCE`, commandes `SECURITY DEFINER`), son exécuteur de migrations et le harnais de tests qui tourne sous les rôles de production.

## Entités

Les tables sont décrites dans les sections de ce fichier, sans recopie ici : disponibilité et paiement (« Schéma AVL / PAY »), audit et clés par sujet (« Audit, clés par sujet et magasin de preuves »), outbox et file (« Outbox et file »), identité (« Schéma IAM »), occupation et holds (« Table d'occupation unique », « Holds de checkout et commandes »), règlements et jambes (« Règlements et jambes », « Rôle P2P_HOST, tables d'argent et minimisation »), comptes et capacités PSP (« Port PaymentProvider », « Port de place de marché »), marque (« Socle de marque »). Liste des migrations : section « Arborescence ».

## Événements

Le paquet ne publie pas d'événement de domaine lui-même : il fournit l'outbox transactionnelle (`core.outbox_outbox_event`, enveloppe 17 §4.1), la file de tâches et les reçus d'idempotence. Voir la section « Outbox et file ».

## Ports

- `FileStore`, `UploadScanner` et `KeyWrapper`, déclarés par `@rueda/db/audit` (section « Audit, clés par sujet et magasin de preuves ») ; FAKE fournis par `@rueda/fake-adapters/files` et `FakeKeyWrapper` (`@rueda/db/testing`).
- Côté base des ports de paiement : sections « Port PaymentProvider » et « Port de place de marché ».

## Arborescence

| Chemin                               | Rôle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootstrap/0000_instance_roles.sql`  | **Amorçage idempotent**, exécuté par un administrateur dans la base cible avant les migrations : rôles d'instance (créés s'ils manquent, attributs réimposés à chaque passage), droits sur la base, `REVOKE CREATE ON SCHEMA public`, `btree_gist`, retrait à PUBLIC des fonctions de `pg_catalog` à effet de bord (US-049). Non suivi : rejoué à chaque fois.                                                                                                                               |
| `migrations/NNNN_<nom>.sql`          | Migrations de production, appliquées **sous `migrator`**, une transaction chacune, suivies dans `platform.schema_migration` (somme SHA-256 : une migration appliquée est immuable).                                                                                                                                                                                                                                                                                                          |
| `test-migrations/9NNN_<nom>.sql`     | Migrations **de test seulement** (horloge virtuelle). Jamais appliquées hors du harnais.                                                                                                                                                                                                                                                                                                                                                                                                     |
| `dev-overlay/`, `src/dev/`           | **Développement local seulement** (US-035, ADR-070) : `src/dev/cli.ts` (service `db-setup` de `compose.yaml`) prépare la base `rueda_dev` (amorçage, migrations de production dont les graines PA / PY, puis la surcouche `dev-overlay/0000_dev_deployment_env.sql` qui déclare la base `development`) et vérifie les graines sous `app_api` et `app_worker` ; refuse de tourner hors `RUEDA_ENV=development`. Jamais appliqué par le pipeline de production. Guide : `docs/ops/INSTALL.md`. |
| `schemas.ts`                         | Correspondance **code de module → schéma PostgreSQL** (`MODULE_SCHEMAS`), schémas transverses (`SHARED_SCHEMAS`) et nommage Bêta (`BETA_SCHEMA`, `betaTableName()`), US-001. `schemas.test.ts` vérifie que chaque module du graphe (`apps/api/src/modules/dependency-graph.ts`) a un schéma. Export `@rueda/db/schemas`.                                                                                                                                                                     |
| `sql-clock-allowlist.json`           | Liste blanche de la règle d'horloge (CONTRIBUTING « SQL et horloge ») : `0000_platform_now.sql` et `9000_test_virtual_clock.sql`, `clock_timestamp()` seulement.                                                                                                                                                                                                                                                                                                                             |
| `country-data-allowlist.json`        | Liste blanche du contrôle « aucune constante pays » des migrations (US-013, ADR-049) : seules les graines générées (`0009_config_seed.sql`) peuvent nommer une devise, un fuseau, un pays, une locale régionale ou une taxe.                                                                                                                                                                                                                                                                 |
| `src/migrate.ts`, `src/bootstrap.ts` | Exécuteur (`runMigrations`, `planMigrations`, `listMigrations`) et amorçage (`runBootstrap`, `setRolePasswords`).                                                                                                                                                                                                                                                                                                                                                                            |
| `authorization-matrix.json`          | **Matrice d'autorisations** (US-043, ADR-077) : droits, politiques et prédicats de lecture par acteur et par travailleur de chaque relation ; vérifiée par `test/l0/l0-us043-authorization-matrix.test.ts`.                                                                                                                                                                                                                                                                                  |
| `env-guard-allowlist.json`           | Lectures historiques de `platform.deployment_env()` hors `COALESCE` tolérées par le lint `sql-env-guard`, chacune avec sa migration de remplacement (US-043).                                                                                                                                                                                                                                                                                                                                |
| `security-definer-allowlist.json`    | **Liste blanche RLS-15** (US-011, ADR-053) : toute fonction `SECURITY DEFINER` de la base de production, son propriétaire NOLOGIN, son `search_path` figé et ses rôles `EXECUTE`. Vérifiée par `test/l0/l0-rls-15-security-definer.test.ts` ; ajouter une entrée = revue sécurité.                                                                                                                                                                                                           |
| `src/session-context.ts`             | `setSessionContext` : **la** fonction de la couche d'accès qui pose le contexte `app.*` (`SET LOCAL`, six paramètres toujours écrits, valeurs validées et liées), US-011.                                                                                                                                                                                                                                                                                                                    |
| `src/testing/`                       | Harnais de tests (`@rueda/db/testing`) : source de la base, banc jetable, connexions sous les rôles de production, transaction de test.                                                                                                                                                                                                                                                                                                                                                      |

Migrations actuelles :

- `0000_platform_now` : schéma `platform`, `platform.now()` = `clock_timestamp()` `VOLATILE`, `platform.schema_migration` sous RLS `ENABLE` + `FORCE` ;
- `0001_role_grants` : droits minimaux ;
- `0002_app_session_context` à `0007_avl_pay_worker_grants` : schéma de preuve AVL / PAY (US-006, section « Schéma AVL / PAY ») ;
- `0008_config_country` (US-013) : tables de configuration pays dans `core` (schéma créé par `0003_core_schema`), gardes `PARAM_RETROACTIVE` / immuabilité / interrupteurs, `core.config_go_live`, RLS `ENABLE` + `FORCE`, lecture seule pour `app_api` et `app_worker` ;
- `0009_config_seed` (US-013) : graines PA / PY **générées** depuis `apps/api/src/modules/cfg/data/`, ne pas éditer (ADR-049) ;
- `0010_iam_identity`, `0011_iam_auth_commands` (US-010) : schéma IAM et commandes d'authentification (section « Schéma IAM ») ;
- `0012_outbox_tables` à `0015_outbox_monitoring` : outbox, reçus, lettres mortes, file de tâches, métriques (US-008, section « Outbox et file ») ; numérotation : `migrations/README.md` ;
- `0016_audit_subject_key` à `0021_audit_grants` (US-009) : journal d'audit chaîné, clés par sujet, magasin de preuves (section « Audit… ») ;
- `0022_security_definer_owners` à `0026_audit_owner_subject_key_scope` (US-011) : propriétaires NOLOGIN, clés étrangères AVL → IAM, contexte et fonctions de politique, lectures d'`app_api` par acteur et par pays, clés d'audit par sujet (section « RLS par acteur et par pays ») ;
- `0027_settlement_versions_legs` (US-018) : règlements versionnés, lignes, taxes, jambes et soldes par jambe, commande `core.settlement_cmd_record` (section « Règlements et jambes ») ;
- `0028_payment_psp_port` (US-019) : port PaymentProvider côté base (section « Port PaymentProvider ») ;
- `0029_payment_pan_detector_layouts` (US-019, correctif) : détecteur de PAN sans faux positif sur les UUID, contrainte `webhook_inbox_no_pan` recréée (section « Port PaymentProvider ») ;
- `0032_booking_single_occupancy` (US-022) : compte d'hôte et pays de l'occupation, un véhicule = un compte, période et tampon, commandes de blocage de l'hôte et de tampon autonome, calendrier de l'hôte (section « Table d'occupation unique ») ;
- `0035_host_permissions_minimization` et `0036_settlement_money_tables_finance` (US-062) : permissions de l'hôte (`app.has_permission`), politiques de l'hôte sur les jambes, minimisation (`host_guest_v`), tables d'argent sans écriture directe, avances, assureur, décisions FINANCE à deux personnes, `host_advance_v` (section « Rôle P2P_HOST, tables d'argent et minimisation ») ;
- `0037_booking_hold_commands` (US-023) : gardes du hold (`hold_guarded_columns`, `no_delete`, `hold_review_before_payment`), fonction de garde `platform.guest_hold_guard`, commandes `core.booking_cmd_place_hold` et `core.booking_cmd_release_own_hold`, tâche d'expiration `core.booking_expire_due_holds` (section « Holds de checkout et commandes ») ;
- `0038_payment_outbox_tightening` (US-023, reports d'US-019 et d'US-008) : `payment_operation.psp_account_id` `NOT NULL`, clé étrangère `webhook_inbox.psp_account_id`, tâches de l'API sans `event_id` (section « Holds de checkout et commandes ») ;
- `0054_settlement_replay_leg_guards` (US-049, correctifs de la red team argent) : rejeu des règlements en base, remboursement borné par le règlement, versement gardé (section « Correctifs de la red team argent ») ; fixture de test `9940_test_us049_money_fixtures` (fin de trajet, `release_at`, sous-marchand ACTIVE) ;
- `0056_booking_vehicle_ownership_guards` (US-049, correctifs de la red team RLS et RT-CONC-02) : véhicule du compte exigé pour les blocages, auto-réservation d'un membre refusée, périodes bornées (section « Correctifs de la red team RLS ») ;
- `0057_audit_worker_name_scope` (US-049, F-RLS-06) : clés de sujet et écritures d'audit réservées aux travailleurs nommés (section « Audit ») ;
- `0058_payment_proof_hardening` (US-049, revues de la PR n° 92) : quarantaine d'horodatage non effaçable, preuve WEBHOOK reçue par la commande, MANUAL_OPS terminal refusé, voie directe du statut fermée (section « Correctifs de la red team argent ») ;
- tests : `9000_test_virtual_clock`, `9001_test_l0_fixtures`, `9100_test_config_writer` (écriture de test pour `app_worker` sur deux tables de configuration, base principale seulement), `9150_test_audit_fixtures` (US-009), `9200_test_iam_fixtures` (US-010), `9300_test_rls_fixtures` (US-011 : comptes des fixtures L0, trips, dossiers de support), `9002_test_l0_concurrency` (US-007 : pose avec verrous et 2a, volume de L0-04), `9400_test_settlement_fixtures` (US-018 : état capturé d'un segment, en attendant `cmd_apply_leg_movement`) ; `9310_test_occupancy_fixtures` (US-022 : écriture d'occupations et de holds sans pré-vérification, preuves de `occupancy_vehicle_single_org` et `checkout_hold_occupancy_party_fk`) ; `9500_test_payment_fixtures` (US-019 : `platform.deployment_env()` de test, pilotée par `app.test_deployment_env` ; écriture des comptes PSP et capacités par `app_worker` ; écriture brute d'opérations pour le contrôle différé des jambes) ; `9700_test_host_money_fixtures` (US-062 : avances, bordereaux, position de l'assureur, permission donnée par erreur à un co-hôte, relecture des colonnes du personnel, passage en perte tenté par un travailleur sous `cmd_money_owner`) ; `9750_test_hold_fixtures` (US-023 : registre de véhicules de test à la place du catalogue, pose réelle mesurée, comptes d'hôte de statut choisi, version annulée de `flagged_booking_payment_order`, écriture forcée des colonnes gardées). Depuis US-023, les fixtures d'opérations (9001, 9002, 9300, 9700) posent le compte PSP de test du pays et quatre jambes.

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

- `PUBLIC`, `app_anon` et `app_api` n'ont **aucun** droit d'écriture sur ces tables. Les lectures filtrées d'`app_api` sont arrivées avec US-011 (occupations : US-022) ; les commandes sous `cmd_hold_owner` avec US-022 (blocages, tampons) et US-023 (holds).
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

Aucun `UPDATE`, `DELETE` ni `TRUNCATE` pour les rôles applicatifs ; triggers de refus pour tous, propriétaire compris. Écriture : `app_api` (contexte `GUEST`, `HOST`, `STAFF`) et `app_worker` (contexte `WORKER` nommé), par colonnes. Lecture des registres : travailleurs `audit_chain_verifier` (journal, tête) et `evidence_verifier` (fichiers) seulement (noms PROPOSÉS). Depuis 0057 (US-049, F-RLS-06) : clés de sujet lues par `evidence_ingest`, `evidence_verifier` et `privacy_request`, créées par `evidence_ingest` et `privacy_request` ; écriture du journal d'audit, du journal d'accès et du registre des fichiers par les seuls travailleurs de `authorization-matrix.json`.

Code TypeScript (`@rueda/db/audit`) : `appendAuditLog` (IP de l'acteur chiffrée, repli `c2_withheld` si le KMS est injoignable), `recordDataAccess`, `verifyAuditChain` (vérificateur indépendant du SQL), `SubjectKeyStore` (cache `subject_dek_cache_ttl_s`, PROPOSÉ 300 s), `seal` / `open` (enveloppe v1), `receiveFile` / `verifyFileAsset`, ports `KeyWrapper`, `FileStore` et `UploadScanner` (ces deux derniers à échecs en valeurs, US-020, ADR-058). Adaptateurs **FAKE** : `FakeKeyWrapper` dans `@rueda/db/testing` ; `InMemoryFileStore` et `FakeUploadScanner` dans `@rueda/fake-adapters/files` (dépendance de développement) ; tous refusés hors `RUEDA_ENV` = development | test (garde centrale de `@rueda/fake-adapters`).

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

Tables `core.iam_*` (entités de 17 §3.2.1) : `user_account`, `email_verification`, `auth_factor`, `session`, `otp_challenge`, `organization` (compte d'hôte), `membership`, `staff_role_assignment`, `role_permission`, `restriction`. RLS `ENABLE` + `FORCE`, politique `migrator_all` ; **aucun droit d'écriture** pour `app_api`, `app_worker`, `app_anon`. Depuis US-011 : lecture filtrée par acteur d'`app_api` sur `user_account` (son compte, sans `password_hash`), `organization` et `membership` (section « RLS par acteur et par pays »), politiques des propriétaires `iam_auth_owner` et `policy_fn_owner`.

Identités prévues pour US-011 : `user_account.id` (`app.actor_id`), `organization.id` / `country_code` / `holder_user_id` (`app.org_id`, `app.is_org_holder()`), `membership.vehicle_scope` (`app.vehicle_scope`), `staff_role_assignment.role` / `country_scope` (`app.country_scope`), `role_permission` (`app.has_permission`).

Contraintes notables : `user_account_password_hash_argon2id` (seule une chaîne PHC argon2id est stockée), `user_account_email_normalized`, `session_token_sha256` (32 octets), trigger `session_guarded_columns` (révocation définitive, aucune prolongation), `membership_holder_matches_org` (le `P2P_HOST` est le titulaire), `membership_one_active_holder`, `organization_country_holder_unique`, `staff_country_scope_format`, `staff_no_self_grant`.

Commandes (`0011`, `SECURITY DEFINER`, propriétaire `iam_auth_owner` depuis US-011 (0022), `search_path` figé, `EXECUTE` au seul `app_api`, famille `iam_auth` pour la liste blanche RLS-15) : `core.iam_cmd_register`, `iam_cmd_verify_email`, `iam_auth_lookup`, `iam_cmd_open_session` (300 s à 30 j, 8 h si rôle interne), `iam_session_resolve`, `iam_cmd_revoke_session`, `iam_cmd_revoke_all_sessions`.

**Clés étrangères AVL → IAM** (US-011, 0023) : `guest_user_id` → `iam_user_account` ; `(org_id, country_code)` des holds et trips → `iam_organization (id, country_code)` (un trip porte le pays de son compte d'hôte) ; les fixtures L0 créent les comptes (`test_fixture.ensure_party`, 9300). En attente : `organization.legal_entity_id` (config).

Fixtures de test (`test-migrations/9200`) : statut d'un compte, rôle interne, compte d'hôte, appartenance, lecture brute des sessions et des comptes, écritures forcées refusées par `session_guarded_columns`.

## RLS par acteur et par pays (US-011 ; 17 §2.3 ; ADR-027, ADR-035, ADR-053)

Contexte posé par `setSessionContext` (`app.actor_kind`, `actor_id`, `org_id`, `vehicle_scope`, `country_scope`, `worker_name`), lu par des fonctions `STABLE` fail-closed : absent ou mal formé ⇒ `NULL` ⇒ 0 ligne, sans erreur. **Le contexte ne fait que réduire une portée relue en base** par les fonctions de politique (`SECURITY DEFINER`, propriétaire `policy_fn_owner`, `EXECUTE` à `app_api`) :

| Fonction                            | Vrai si…                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `app.has_staff_role(rôle, pays)`    | acteur `STAFF`, pays dans `app.country_scope()` **et** dans le `country_scope` d'une attribution en cours de ce rôle (RLS-20)     |
| `app.staff_case_covers('TRIP', id)` | dossier `OPEN` / `PENDING` sur ce trip, assigné à l'acteur, pays dans la portée, rôle OPS ou SUPPORT en cours sur ce pays (RLS-6) |
| `app.host_covers_vehicle(véhicule)` | acteur `HOST` membre actif de `app.org_id()` : titulaire = tous les véhicules ; co-hôte = `membership.vehicle_scope` (RLS-9)      |
| `app.is_org_holder()`               | acteur titulaire actif du compte d'hôte de la session (jamais un co-hôte)                                                         |
| `app.has_permission(code)` (US-062) | acteur `HOST` membre actif de `app.org_id()` : matrice en vigueur de son rôle ou permission unitaire du titulaire ; faux sinon    |

Lectures d'`app_api` (0025 ; **aucune écriture de table**, lectures **par colonnes** sans colonnes d'audit `created_by` / `updated_by` / `released_by` ni drapeaux internes, liste exacte : `test/l0/l0-rls-columns.test.ts` ; rôles internes effectifs seulement pour un compte `ACTIVE`) :

| Table                       | GUEST                 | HOST                                                                 | STAFF (toujours borné au pays)                          |
| --------------------------- | --------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `booking_trip`              | les siens             | son compte, sa portée de véhicules ; jamais `guest_user_id` (US-062) | ADMIN, FINANCE ; OPS / SUPPORT : dossier assigné        |
| `booking_checkout_hold`     | les siens             | **aucun** (NOUVELLE-16)                                              | ADMIN, FINANCE ; dossier du trip converti               |
| `booking_guest_occupancy`   | les siennes           | —                                                                    | —                                                       |
| `payment_payment_operation` | de ses holds et trips | —                                                                    | ADMIN, FINANCE ; dossier du trip (colonnes sans clés)   |
| `iam_user_account`          | son compte            | son compte                                                           | son compte (jamais `password_hash`)                     |
| `iam_organization`          | —                     | son compte d'hôte (titulaire)                                        | ADMIN, FINANCE                                          |
| `iam_membership`            | —                     | titulaire : toutes ; co-hôte : la sienne                             | ADMIN                                                   |
| `support_support_case`      | —                     | —                                                                    | ADMIN ; OPS / SUPPORT : dossiers qui leur sont assignés |

`core.support_support_case` (0024) : sous-ensemble de 17 §3.2.13 (pays, trip, canal, catégorie dont `BREAK_GLASS` motivé, statut, `assignee_id`), écrit par la console (US-012). Clés d'audit (0026) : `app_api` n'accède qu'à la clé `USER` de la session et à la clé `ORG` du compte d'hôte de la session pour son titulaire. Limite RLS-18 et nom de travailleur déclaratif : ADR-053. Preuves : `test/l0/l0-rls-actors.test.ts` (RLS-1, 5, 6, 7 partiel, 8, 9, 12, 13, 18, 20, hôte contre hôte, pays contre pays, clés par sujet) et `test/l0/l0-rls-15-security-definer.test.ts` (RLS-15, RLS-16).

## MFA du staff et console interne (US-012 ; 16 ADM-001 ; 17 §2.3, §3.2.13 ; ADR-062)

Migrations `0033_iam_staff_mfa` et `0034_staff_console`, propriétaire NOLOGIN `iam_staff_owner` (famille `iam_staff`, liste blanche RLS-15), fixtures `test-migrations/9650_test_staff_fixtures.sql`.

- **Session née `NONE`** : `iam_cmd_open_session` refuse toute autre valeur (`22023`, report US-010). Seul `core.iam_staff_cmd_elevate` passe une session à `TOTP`. Il exige une preuve HMAC-SHA-256 (`core.iam_mfa_proof`, clé de `core.iam_mfa_proof_key`, illisible par les rôles applicatifs ; absente ⇒ `UNAVAILABLE`), un pas à ±1 de `platform.now()` et un pas strictement croissant. 5 échecs ⇒ facteur verrouillé 15 min.
- **Contexte STAFF lié à une session élevée** : `setSessionContext` pose un septième paramètre, `app.session_token_hash` (SHA-256 hexadécimal du jeton). `app.has_staff_role` et `app.staff_case_covers` exigent une session vivante, de niveau `TOTP`, de l'acteur. Résultats : un rôle sans MFA ne lit rien, et un `actor_id` d'ADMIN forgé ne lit rien (RLS-18 réduite, ADR-062).
- **Commandes** (un appel = une instruction ; audit écrit en dernier ; refus journalisés) :
  - `iam_staff_cmd_begin` (état d'accès : `TOTP_NOT_ENROLLED`, `ENROLLMENT_REQUIRED`, `MFA_REQUIRED`, `LOCKED`, `NOT_STAFF`, `ELEVATED`) ;
  - `iam_staff_cmd_enroll_reveal` ;
  - `iam_staff_cmd_elevate` ;
  - `iam_staff_cmd_mfa_failed` ;
  - `iam_staff_cmd_manual_action` (catalogue `support_manual_action_catalog`, table `support_manual_action`, pays relu en base, idempotence par `request_id`) ;
  - `iam_staff_cmd_suspend` (rôles, sessions et facteurs retirés) ;
  - `iam_staff_cmd_reset_totp` ;
  - `iam_staff_audit_read` (`audit.read`).
- **Matrice** : `iam_role_permission` est semée pour les permissions de ces commandes seulement (colonnes staff de 17 §2.3).
- **Report US-011** : `config_param_value` se lit par colonnes, sans `approved_by`.
- **Monde RLS des tests** : chaque membre du staff de `buildWorld` reçoit une session élevée (fixture). `asActor` complète un contexte STAFF par son empreinte.
- **Preuves** :
  - `test/l0/l0-iam-staff-mfa.test.ts` : RFC 4231, niveau `NONE`, critère 2, enrôlement, élévation, rejeu, fenêtre, verrou, absence de clé, élévation forgée ;
  - `test/l0/l0-staff-console.test.ts` : critère 1, MFA, portée pays, journal, idempotence, suspension, autorité, réinitialisation, `audit.read` ;
  - `test/l0/l0-rls-actors.test.ts` (RLS-18 réduite).

## Preuves de concurrence L0-02 / L0-04 (US-007 ; 17 §2.5, §11 ; ADR-056)

Aucune migration de production : les index de 2a (`checkout_hold_vehicle_status_idx`, `checkout_hold_guest_status_idx`) existent depuis 0004. Fichiers : `test/l0/l0-02-concurrency.test.ts`, `test/l0/l0-04-expiry-plan.test.ts`, aides `test/support/concurrency.ts`, fixtures `test-migrations/9002_test_l0_concurrency.sql`.

- **Pose** : depuis US-023, la commande réelle `core.booking_cmd_place_hold` (contexte et appel en une instruction, `commandCallSql`) pour C1 avec verrou (autocommit), C16 avec verrou, l'annulation et L0-04 ; série transactionnelle mesurée par `test_fixture.l0_cmd_place_hold_timed` (9750). La fixture `test_fixture.l0_place_hold` (9002) ne sert plus qu'à l'**injection** « sans verrou par véhicule » (`p_vehicle_lock = false`), que la commande ne permet pas.
- **Barrière** (`Barrier`) : le meneur tient un verrou consultatif exclusif ; chaque concurrent le demande en mode partagé ; quand `pg_locks` montre tous les concurrents en attente, le meneur relâche. Les entrelacements forcés sont prouvés par `waitUntilBlocked` (ligne non accordée de `pg_locks` pour le pid attendu).
- **Reprise** (`withReplay`) : `40P01` / `40001` ⇒ transaction annulée puis rejouée, au plus 3 fois, attente aléatoire de 5 à 50 ms (17 §2.5). Chaque `40P01` est compté.
- **C1** : 100 connexions `app_api` directes, sur l'horloge réelle. Le conteneur de CI démarre avec `max_connections = 200`. L0-02 tourne **seul**, après les autres fichiers L0 (projet vitest `l0-concurrence`, `sequence.groupOrder: 1`, voir `vitest.l0.config.ts`). Le degré vaut 100, borné par les créneaux libres mesurés au départ (`pg_stat_activity`, ligne `[L0-02] budget de connexions`). Une connexion refusée (`53300`) fait échouer la course aussitôt, sans connexion orpheline. Chaque pose est bornée par `statement_timeout = 60 s`, posé après la chauffe et vérifié avant la barrière (`[L0-02] garde-fou`), et une course encore active à 30 s est consignée (`[L0-02] course bloquée`, bloqueurs compris) (ADR-056, « Budget de connexions du banc »). Le cas « sans verrou » s'exécute dans une **base d'injection**, copie de la base principale créée par le banc, qui seule reçoit `deadlock_timeout = 50ms` (`BENCH_DEADLOCK_TIMEOUT`, `connectAs(…, { database: 'injection' })`). Les séries « avec verrou », dont le p95 a un seuil de 300 ms, restent sur la base principale, au réglage du serveur (1 s), comme en production. Sans verrou, PostgreSQL résout les cycles de la contrainte d'exclusion un par un, à chaque `deadlock_timeout`, et la course « sans verrou » durait environ 1 s par `40P01` (ADR-056, « Cascade d'interblocages de l'injection »). Dans la base d'injection, une victime attend avant son rejeu au-delà de la vidange de la file, soit 3 × degré × `deadlock_timeout` (`cascadeBackoff`, 15 à 22,5 s) : avec l'attente courte de 17 §2.5, elle revenait dans la file et 99 poses finissaient en `RETRY`. Le plafond de 3 rejeux est inchangé. Un second cas, à **file forcée**, provoque la cascade à chaque exécution : un bloqueur garde sa pose ouverte, puis l'annule quand les 100 poses l'attendent. Il exige au moins 99 `40P01`, tous rejoués, et une issue exacte (ADR-056, « Issue déterministe de l'injection »).
- **Échantillon du p95** (ADR-056, « Stabilité de la mesure du p95 ») : chaque connexion fait d'abord 6 poses annulées (`WARM_POSES`), ce qui la fait sortir des 5 exécutions planifiées une à une par le cache de plans de PostgreSQL. Vient ensuite une course complète non mesurée, puis 5 courses mesurées. Le p95 < 300 ms porte sur les 500 poses mesurées, et chaque course, chauffe comprise, doit être exacte (1 hold, 99 `VEHICLE_UNAVAILABLE`, 0 `40P01`, 0 rejeu).
- **Forme d'appel** (ADR-056 point 4) : seuil de 300 ms sur la pose en autocommit (« un appel = une instruction ») ; seconde série C1 en forme transactionnelle de 17 §2.3, consignée sans seuil, avec la détention du verrou du véhicule mesurée côté serveur (`l0_place_hold_timed`).
- **Interblocage déterministe** : ordre inversé (véhicule puis guest) contre ordre de 17 ; un `40P01` réel, rejoué. Tests unitaires sans base : `test/support/replay.test.ts`, `test/support/expiry-2a.test.ts` (texte unique de 2a).
- **Mesures** : lignes `[L0-02]` et `[L0-04]` du journal CI (40P01, rejeux, p50 / p95 / max, plan et temps d'exécution de 2a), à joindre au rapport L0 (US-027).
- **L0-04** : 10 000 holds sur 1 000 véhicules par pays (`l0_seed_expiry_bench`, puis `ANALYZE`) ; plan `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` sous `app_worker` (`hold_expiry`), RLS comprise.

## Table d'occupation unique (US-022 ; 16 CAL-011, CAL-004 ; 08 BR-BOOK-05, BR-BOOK-07 ; 17 §2.5 ; ADR-060)

`core.booking_vehicle_occupancy` est la seule source de vérité de la disponibilité d'un véhicule, tous canaux confondus : `HOLD` (checkout), `TRIP`, `HOST_BLOCK` (blocage manuel de l'hôte), `BUFFER` (tampon autonome). Une seule exclusion GiST `WHERE (active)` ; tout écrivain prend le verrou consultatif du véhicule (17 §2.5 M2).

- **Compte et pays** (0032) : `org_id`, `country_code` `NOT NULL`, clé composée vers `iam_organization (id, country_code)` ; jamais fournis par le client. Exclusion `occupancy_vehicle_single_org` (`vehicle_id WITH =, org_id WITH <>`) : un véhicule n'a d'occupations que d'un compte (PROPOSÉ, en attendant la clé vers `catalog_vehicle`). Clé composée `checkout_hold_occupancy_party_fk` : hold et occupation sur le même véhicule, compte et pays.
- **Période** : `core.booking_occupied_period(début, fin, minutes)` = `[début, fin + minutes)` ; `core.booking_buffer_minutes(pays)` = `buffer_minutes` en vigueur (120 par défaut, 17 §7.2), `NULL` si absent.
- **Commandes** (`SECURITY DEFINER`, `cmd_hold_owner`, liste blanche RLS-15) :

  | Commande                                                  | `EXECUTE`    | Contrôle                                                                                                                                                        |
  | --------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `core.booking_cmd_place_host_block(véhicule, début, fin)` | `app_api`    | `HOST`, `app.host_covers_vehicle`, véhicule du compte et du pays selon `core.booking_vehicle_party` (inconnu : refusé, 0056) ; renvoie l'identifiant du blocage |
  | `core.booking_cmd_remove_host_block(blocage)`             | `app_api`    | blocage `MANUAL` de son compte et de sa portée, véhicule du compte (0056) ; `BLOCK_REMOVED` ; rejeu : `false`                                                   |
  | `core.booking_cmd_place_buffer(trip, début)`              | `app_worker` | travailleur `trip_lifecycle` ; trip ayant rendu le véhicule ; `[début, début + buffer_minutes)`                                                                 |

- **Codes** (`translateDbError`) : `VEHICLE_UNAVAILABLE` (créneau pris, quel que soit le canal), `FORBIDDEN` (identité, portée, compte ou pays ; la levée ne distingue pas un blocage d'un tiers d'un identifiant inconnu ; la pose sur un identifiant de véhicule inconnu, ou d'un autre compte encore inoccupé, est refusée depuis 0056, US-049 F-RLS-01 ; en production, AUCUN blocage n'est donc possible avant le catalogue, comme aucun hold), `INVALID_PERIOD` (PROPOSÉ), `INVALID_TRANSITION`, `PARAM_MISSING`.
- **Lectures d'`app_api`** (par colonnes, sans `ref_type` / `ref_id`, `ical_uid` ni colonnes d'audit) : hôte (son compte, sa portée de véhicules) et ADMIN du pays. Le voyageur ne lit pas la table (sonde de disponibilité, US-201).
- **Limite levée (0056, ADR-089)** : avant 0056, le premier compte qui écrivait une occupation d'un identifiant de véhicule en devenait le compte (ADR-060, « Limites ») ; le compte du véhicule vient désormais du seul catalogue (`booking_vehicle_party`). La clé étrangère `(vehicle_id, org_id, country_code)` vers `catalog_vehicle` vient avec US-115.

Preuves : `test/l0/l0-occ-single-occupancy.test.ts` (PA et PY) : fonctions de période, blocage contre trip, hold et blocage, levée, tampon de 2 h (départ à 13:00 refusé, à 14:00 accepté), I-OCC au COMMIT, tampon autonome, cloisonnement des écritures et des lectures, C1 tous canaux (holds et blocages concurrents, journal CI `[US-022 C1 tous canaux]`). C1 à 100 poses : L0-02 (US-007).

## Holds de checkout et commandes (US-023 ; 16 BKG-014 ; 08 BR-BOOK-08, BR-BOOK-10, BR-BOOK-11 ; 17 §2.3, §2.5 ; ADR-063)

Écriture des holds **uniquement par commandes** (ADR-035) : `app_api` n'a aucun droit d'écriture sur les holds, les occupations, les dispositions ni les compensations.

- **Commandes et fonctions** (aucun identifiant de personne en paramètre : le voyageur est `app.actor_id()` d'une session `GUEST`) :
  - `core.booking_cmd_place_hold(véhicule, début, fin, signalée)` — `SECURITY DEFINER`, `cmd_hold_owner`, `EXECUTE` à `app_api` : 17 §2.5 étape 2. Compte et pays du véhicule (`core.booking_vehicle_party`), hôte `ACTIVE`, pas d'auto-réservation (titulaire, et depuis 0056 tout membre `ACTIVE` ou `INVITED` du compte d'hôte du véhicule : `SELF_BOOKING_FORBIDDEN`), paramètres du pays ; verrous voyageur → véhicule ; 2a (texte unique) ; garde entre hôtes sous le verrou du voyageur ; rotation ; occupation `HOLD` `[début, fin + tampon)` puis hold `ACTIVE` ; `booking.hold.created`. Renvoie l'identifiant du hold, rien d'autre.
  - `core.booking_cmd_release_own_hold(hold)` — `SECURITY DEFINER`, `cmd_hold_owner`, `EXECUTE` à `app_api` : 17 §2.5 étape 6, temps 1. `RELEASED` (occupation `HOLD_RELEASED`) ou, si un ordre PSP peut encore être payé, `DEFERRED` (`release_requested_at`) ; rejeu `NOOP` ; hold d'un tiers ou inconnu : `FORBIDDEN`.
  - `platform.guest_hold_guard(période)` — `SECURITY DEFINER`, `guard_owner`, `EXECUTE` à `app_api` et `cmd_hold_owner` : holds vivants du voyageur de la session, chevauchement avec ses trips ; aucune ligne hors session `GUEST` (RLS-11).
  - `core.booking_expire_due_holds(lot)` — `SECURITY INVOKER`, `EXECUTE` à `app_worker` (`hold_expiry`) : 17 §2.5 étape 7. Holds échus `EXPIRED`, libérations différées échues `RELEASED`, filtre A3 / A6, `SKIP LOCKED`, par lots ; `booking.hold.expired` / `.released`.
- **Durées** : TTL = `min(hold_ttl_minutes, hold_max_total_minutes)` (10, borne 20). Réservation signalée (`p_flagged`, signal des règles de risque ; `NULL` vaut signalée) et `flagged_booking_payment_order` ≠ `PAY_THEN_REVIEW` ⇒ `review_required`, TTL `review_hold_minutes` (120) ; `CHECK hold_review_before_payment` : ni paiement ni conversion avant `reviewed_at`.
- **Gardes** pour tous les rôles : `hold_guarded_columns` (identité, véhicule, compte, pays, occupation, devis, type, création, drapeau de revue ; échéance seulement à l'approbation d'une revue ; borne de paiement seulement à la baisse, ou remise à `NULL` au retour en `ACTIVE`) ; `no_delete` sur le hold, la disposition et la compensation.
- **Compte du véhicule** : `core.booking_vehicle_party` ne connaît **aucun** véhicule en production tant que le catalogue n'existe pas (fail-closed ; US-115 remplace son corps) ; la base de test la remplace par un registre (9750).
- **Codes** (`translateDbError`) : `FORBIDDEN`, `INVALID_PERIOD`, `VEHICLE_UNAVAILABLE` (créneau pris ou véhicule inconnu), `HOST_NOT_ACTIVATED`, `SELF_BOOKING_FORBIDDEN`, `PARAM_MISSING`, `HOLD_LIMIT_REACHED`, `GUEST_OVERLAP`, `HOLD_RATE_LIMITED`, `HOLD_ALREADY_LIVE`, `INVALID_TRANSITION`, `IMMUTABLE_RECORD`, `BOOKING_UNDER_REVIEW`.
- **Forme d'appel** (ADR-056 point 4) : `commandCallSql(contexte, commande, arguments)` (`src/session-context.ts`) produit **une** instruction qui pose le contexte `app.*` puis appelle la commande ; en autocommit, l'erreur rend aussitôt les verrous.
- **Reports d'US-019 et d'US-008** (0038) : `payment_operation.psp_account_id` `NOT NULL` (toute opération qui déplace des fonds porte ses quatre jambes) ; clé étrangère `webhook_inbox_psp_account_fk` ; une tâche déposée par `app_api` n'a jamais d'`event_id` (seul le relais crée des livraisons).
- **Index** `checkout_hold_guest_status_idx` : conservé, lu par la limite de rotation (tous statuts).

Preuves : `test/l0/l0-hold-commands.test.ts` (PA et PY) : critères 1 à 5 d'US-023, RLS-3, RLS-4, RLS-11, RLS-13, RLS-14, C5, C9, libération immédiate et différée, rotation, auto-réservation, hôte non activé ; L0-02 et L0-04 rejoués avec la commande réelle ; `test/l0/l0-08-unique.test.ts` (clé étrangère de la boîte de réception) ; unitaires `src/errors.test.ts`, `src/session-context.test.ts`, `test/support/expiry-2a.test.ts`.

## Conversion gardée, ré-acquisition et compensation (US-024 ; 16 BKG-014 ; 08 BR-BOOK-10, SM-1 ; 17 §2.3, §2.5 étapes 3 à 7, §4.3 ; ADR-065)

Du paiement au trip, ou au remboursement, jamais les deux ni rien (migrations 0040 et 0041).

- **Commandes du voyageur** (`SECURITY DEFINER`, `cmd_hold_owner`, `EXECUTE` à `app_api`, liste blanche RLS-15 ; forme d'appel `commandCallSql`) :
  - `core.booking_cmd_start_payment(hold, compte PSP, moyen)` (T1, étape 3a) renvoie un `jsonb`. `NEW_ORDER` : hold `PAYMENT_IN_FLIGHT`, borne provisoire, opération `CAPTURE` `PENDING` avec la clé `hold:{hold}:CAPTURE:a{n}` et les quatre jambes **du devis**. Hold déjà en vol : `EXISTING_ORDER`, `RETRY_SAME_KEY` ou `VERIFYING`. Montant et jambes ne sont jamais des paramètres. Refus si une capacité bloquante manque (`HOST_PAYOUT_RAIL_UNAVAILABLE`), ou si le compte est `SANDBOX` hors `test` / `development` / `staging` (`PSP_ACCOUNT_INACTIVE`). Une référence PSP est unique par compte.
  - `core.booking_cmd_record_order(hold, opération, référence, expiration)` (T2, étape 3c) : `SUBMITTED` et référence PSP, borne affinée vers le bas. Une opération `SUCCEEDED` n'est jamais rétrogradée. Hold échu ou libéré : `CANCEL_ORDER` si `SUPPORTS_ORDER_CANCEL` est validé.
  - `core.booking_cmd_release_own_hold(hold)` (remplacée) : la libération différée écrit en plus `CANCEL_ORDER` pour chaque ordre vivant connu, si la capacité est validée.
- **Devis fail-closed** : `core.booking_hold_payment_terms(hold)` ne rend **rien** tant que le module PRC n'existe pas (T1 : `QUOTE_UNAVAILABLE`). La base de test la remplace par un registre (9800).
- **Capacités PSP** : `core.payment_capability_value`, `_bool` et `_int` ne comptent que la version en vigueur `VALIDATED_*` (moyen précis, puis `*`). Une capacité inconnue vaut « non ».
- **Boîte d'envoi** `core.payment_payment_command` (`CANCEL_ORDER` seulement) : la clé `hold:{hold}:CANCEL:{opération}:a1` est `UNIQUE` (C16). La commande est exécutée après le `COMMIT` par `payment_command` (US-061). `core.booking_release_cancelled_holds(lot)` (`hold_expiry`, temps 2) libère après confirmation (`DONE`).
- **Conversion** (`SECURITY INVOKER`, `app_worker`, travailleurs `booking_conversion`, `disposition_sweeper`, `payment_intent_sweeper`) :
  - `core.booking_convert_payment(opération)` (étape 4) renvoie un `jsonb` : `CONVERTED` (avec `reacquired`), `COMPENSATED` (motif, action), `REPLAY`, `NOT_SUCCEEDED` ou `NOT_APPLICABLE`.
  - Ordre de travail : verrous voyageur → véhicule ; rejeu par la disposition ; verrou du hold sans prédicat ; preuve contre le devis et 2 bis ; 2a (partie véhicule) avant la ré-acquisition dans un bloc `SAVEPOINT` ; résolution A4 (`SUPERSEDED_BY_PAID_HOLD`, `DUPLICATE_PAYMENT`, `SLOT_LOST_*`) ; `GUEST_OVERLAP`.
  - `core.booking_open_compensation(hold, opération, motif)` (bloc C) choisit l'action par capacité validée : `VOID` / `LET_EXPIRE` pour une autorisation, `REFUND_API` / `BANK_TRANSFER_REFUND` pour un débit capturé. Événements `booking.hold.compensated` et `booking.hold.compensation_required`.
  - `core.booking_conversion_eligibility(hold)` (`SECURITY DEFINER`, `cmd_hold_owner`, `EXECUTE` à `app_worker`) : catalogue, hôte `ACTIVE`, voyageur ≠ titulaire.
  - `core.booking_record_payment_failure(opération)` (refus reçu, étape 3e) : retour en `ACTIVE` ou `RELEASED` (`PAYMENT_DECLINED`).
- **Balayages** (une opération par transaction) :
  - `core.booking_intents_due(lot)` et `core.booking_record_poll(opération)` (`payment_intent_sweeper`, A3) ;
  - `core.booking_disposition_candidates(lot)` et `core.booking_disposition_repair(opération)` (`disposition_sweeper`, A6, C17), avec les essais dans `core.booking_disposition_repair_log` et l'alerte P1 `booking.payment.disposition_overdue`.
- **Codes** : `HOLD_EXPIRED`, `QUOTE_UNAVAILABLE`, `START_PASSED`, `PAYMENT_METHOD_UNAVAILABLE` (PROPOSÉS), `PAYMENT_ATTEMPTS_EXCEEDED` (16 PAY-017), plus `PSP_ACCOUNT_INACTIVE`, `FAKE_FORBIDDEN_IN_PRODUCTION`, `BOOKING_UNDER_REVIEW`, `INVALID_TRANSITION`, `FORBIDDEN`.
- **Paramètres lus** (graine US-013, aucun créé) : `payment_in_flight_margin_s`, `psp_call_timeout_s`, `hold_max_total_minutes`, `conversion_start_tolerance_minutes`, `payment_attempts_per_hold`, `sweep_grace_s`, `sweep_lead_s`, `disposition_repair_after_minutes`, `disposition_alert_minutes`. `reacquire_preempts_unpaid_hold` n'est pas lu : l'option M13 n'est pas retenue.

Preuves : `test/l0/l0-us024-conversion.test.ts` (PA et PY, groupe isolé de `vitest.l0.config.ts`) : C2, C3, C4, C4 bis, C6, C7, C8, C13, C14, C15 (a à e), C15 bis (f à h), C16 (rejeux), C17, C18, C20, et les rôles. Unitaires : `src/errors.test.ts`, `test/support/expiry-2a.test.ts` (2a de la ré-acquisition).

## Fuzz C11 et oracle de production C12 (US-025 ; 17 §2.5 C11, C12, §11 L0-09 ; ADR-068)

Cherche au hasard les entrelacements dangereux et surveille la production chaque nuit (migration 0045, fixture 9880).

- **Oracle C12** (`SECURITY INVOKER`, `app_worker`, travailleur `booking_oracle` seulement ; ajouté par `ALTER POLICY` aux politiques SELECT `worker_select` des tables lues) :
  - `core.booking_production_oracle()` (`STABLE`, transaction `READ ONLY`) rend **cinq lignes** `(check_code, violations, by_country)` : `TRIP_WITHOUT_ACTIVE_OCCUPANCY`, `SUCCEEDED_WITHOUT_DISPOSITION` (plus de 20 min après la réussite connue), `COMPENSATED_HOLD_WITH_TRIP`, `HOLD_WITH_TWO_CONVERSIONS`, `INACTIVE_TRIP_OCCUPANCY_OF_LIVE_TRIP` (codes PROPOSÉS). Aucune donnée personnelle lue ; des comptes seulement. Tout autre contexte : `42501` / `oracle_forbidden` (`FORBIDDEN`), jamais des zéros trompeurs.
  - `core.booking_production_oracle_alert()` rejoue l'oracle et, si un contrôle est non nul, écrit **une** alerte P1 `booking.alert.production_oracle` (comptes par contrôle et par pays) dans l'outbox. La tâche périodique est `registerProductionOracle` (module AVL, 24 h, câblage US-003).
- **T1 fail-closed** (report de la revue sécurité d'US-024) : `core.booking_cmd_start_payment` lit l'environnement une fois, `COALESCE(platform.deployment_env(), 'production')` ; un NULL n'ouvre plus ni la garde FAKE ni la garde SANDBOX.
- **Fuzz C11** (`test/l0/l0-c11-fuzz.test.ts`, base `fuzz` du banc, configuration `vitest.c11.config.ts`, hors de `test:l0`) : 2 pays × 2 hôtes × 3 véhicules × 4 voyageurs, une semaine virtuelle par exécution ; voyageur sous `app_api` (forme d'appel d'ADR-056), travailleurs sous `app_worker` ; FAKE hostile (webhook en double, perdu, hors d'ordre, tardif ; lecture sans réponse ; second débit ; « déjà payé » ; conversion perdue) ; courses de 2 ou 3 actions sur des connexions distinctes. Invariants (i) à (ix) de 17 §2.5 lus par un observateur `booking_oracle` en lecture seule, avec contrôle d'anti-vacuité ; oracle C12 à zéro sur toute la base toutes les 100 exécutions.
- **Modes** (`test/support/c11.ts`) : court par défaut (1 000 exécutions, graine `20251103`, job `fuzz-c11` de `ci.yml`) ; long explicite (nuit : 10 lots parallèles de 1 000, `RUEDA_C11_RUNS=1000`, graine du jour et du lot, job `fuzz-c11` de `nightly.yml`). Commande : `pnpm --filter @rueda/db test:c11`.
- **Rejeu d'un échec** : le journal donne `[C11] ÉCHEC … rejouer : RUEDA_C11_REPLAY=<graine>:<étape>=<ordre>;…` et la trace ; `RUEDA_C11_REPLAY=… pnpm --filter @rueda/db test:c11` rejoue l'exécution seule, courses en série dans l'ordre observé. `RUEDA_C11_FAILURES=<fichier>` consigne les graines d'échec (artefact de nuit).

Preuves : `test/l0/l0-c11-fuzz.test.ts` (C11 ; C12 : zéro sur la base saine, chaque contrôle forgé dans une transaction annulée, seuil de 20 min, alerte par comptes, lecture seule et contexte ; T1 avec environnement NULL, PA et PY). Unitaires : `test/support/c11.test.ts`, `src/errors.test.ts`, `apps/api/src/modules/avl/internal/production-oracle.test.ts`.

## Règlements et jambes (US-018 ; 08 E4, E7 ; 17 §2.3, §2.9, §3.2.8 ; ADR-057)

Migration 0027 : `core.settlement_settlement` (en-tête versionné, `UNIQUE (trip_id, segment_no, version)`, `supersedes_id`), `settlement_settlement_line`, `settlement_settlement_tax_line`, `settlement_settlement_leg` (jambe retenue `kept_minor` ≥ 0, avance `advance_minor` sur `PLATFORM` seulement, base `basis_minor`, variation signée `variation_minor = kept − advance − basis`) et `settlement_trip_leg_balance` (soldes par trip, segment et jambe, toujours ≥ 0, cumuls monotones, aucun `DELETE`).

- **Bêta** : un seul segment par trip (`segment_no = 1`). **Entrées** : `inputs` (texte canonique du moteur), empreinte vérifiée en base contre `inputs_hash`.
- **Immuable** : un règlement n'est jamais modifié ; la version n+1 remplace la dernière version par `supersedes_id`, la version n reste lisible (`settlement_immutable`).
- **Écriture** : seulement `core.settlement_cmd_record(id, trip, segment, version, supersedes, trip_row_version, charge jsonb)` (`SECURITY DEFINER`, `cmd_money_owner`, `EXECUTE` au seul `app_worker`, travailleur `settlement`) : verrou `FOR UPDATE` du trip, contrôle de `row_version` (`SETTLEMENT_STALE`), version suivante exacte (`SETTLEMENT_EXISTS`, EC-54), portée relue du trip. La charge utile vient de `settlementRecordPayload` (`@rueda/money`).
- **Invariants** : `CHECK` de l'en-tête, des lignes et des jambes, puis trigger différé `settlement_balanced` (Σ jambes = retenu TTC, Σ variations = − remboursement ou − écart, `HOST` = `hostFromGuest`, `TAX_THIRD_PARTY`, base = version n ou état capturé, drapeau `negative_leg`).
- **`negative_leg`** : `PLATFORM` retenue négative ⇒ `kept_minor = 0` + `advance_minor`, revue FIN, remboursement jamais réduit (ordres `PLANNED`).
- **Lectures** (par colonnes) : hôte titulaire = jambe `HOST` de ses trips (RLS-2, RLS-28) ; en-tête, lignes et taxes : ADMIN / FINANCE du pays ; jambes : ADMIN / FINANCE, OPS / SUPPORT sur dossier (RLS-23) ; voyageur : rien ; travailleurs `settlement`, `payment_command`, `payout`, `bordereau`, `reconciliation`.
- Codes (`translateDbError`) : `SETTLEMENT_EXISTS`, `SETTLEMENT_STALE`, `SETTLEMENT_UNBALANCED`, `LEG_AMOUNT_NEGATIVE`, `IMMUTABLE_RECORD`, `INVARIANT_VIOLATION`.

Preuves : `test/l0/l0-stl-settlement.test.ts` (TJ02a / b, TJ08a / b, T36, TJ18a, TJ18c, TJ13 b / d, EC-54 avec deux connexions, falsifications, RLS-2, RLS-21, RLS-25, RLS-28, hôte contre hôte, pays contre pays) et `test/int/stl-schema.test.ts` (socle RLS, politiques, droits, triggers).

## Rôle P2P_HOST, tables d'argent et minimisation (US-062 ; 17 §2.3, §2.9, §3.2.8, §3.2.9 ; ADR-064)

Migrations `0035_host_permissions_minimization` et `0036_settlement_money_tables_finance`, propriétaire NOLOGIN `host_view_owner` (famille `host_view`), fixtures `test-migrations/9700_test_host_money_fixtures.sql`.

- **Matrice** (`iam_role_permission`, PROPOSÉ) : `finance.read_org_statements` du `P2P_HOST` ; `finance.platform_advance` et `finance.insurer_bordereau` de `FINANCE` et `ADMIN`. Le `CO_HOST` n'en a aucune. `app.has_permission(code)` relit l'appartenance active et la matrice (ou `membership.permission_overrides`) ; elle ne répond que pour un acteur `HOST`.
- **Jambes** (`settlement_settlement_leg`, `settlement_trip_leg_balance`, `payment_payment_operation_leg`) : l'hôte lit la jambe `HOST` de son compte seulement s'il en est le **titulaire** (`app.is_org_holder()`), sans réduction de portée par véhicule, et avec `finance.read_org_statements`. Un co-hôte muni par erreur de la permission ne lit rien (RLS-28).
- **Minimisation** : `booking_trip.guest_user_id` n'est plus lisible par `app_api`. `core.booking_host_guest_v` (vue `security_invoker` sur `core.booking_host_guest_rows()`, `SECURITY DEFINER`, `host_view_owner`) rend `trip_id`, prénom, âge en années, note et statut de vérification du voyageur des trips de l'hôte (portée véhicule d'un co-hôte comprise). La note et le statut sont `NULL` jusqu'aux stories des avis et du KYC du voyageur.
- **Tables d'argent** (`settlement_finance_approval`, `settlement_platform_advance`, `settlement_insurer_ledger_state`, `settlement_insurer_bordereau`, `settlement_insurer_bordereau_line`) : RLS `ENABLE` + `FORCE`, aucune écriture par `app_api`, `app_worker` ni `app_anon` ; `DELETE` et `TRUNCATE` refusés à tous (`money_no_delete`) ; gardes de transition (`advance_transition_guard`, `bordereau_transition_guard`, `finance_approval_guard`). Lecture d'`app_api` par colonnes, sans identifiant du personnel : FINANCE et ADMIN du pays seulement ; l'hôte titulaire lit sa créance (`RELEASED_LEG`) par `core.settlement_host_advance_v` (RLS-26). Travailleurs de la liste blanche : lecture seule. Les écrivains métier arrivent avec US-224, US-227 et US-709.
- **Décisions FINANCE à deux personnes** (RLS-24) : `core.settlement_cmd_request_finance_action(jeton, demande, action, sujet, motif)` puis `core.settlement_cmd_approve_finance_action(jeton, demande)` (`cmd_money_owner`, `EXECUTE` au seul `app_api`, un appel = une instruction). L'identité vient de la session désignée par l'empreinte du jeton (niveau `TOTP`), jamais d'un réglage `app.*`. Un même utilisateur, même dans une seconde session, ne peut pas approuver sa demande (`SELF_APPROVAL`, journalisé). Les triggers n'acceptent `decided_by` / `decision_second_by`, `written_off_*` ou `issued_by` / `second_validated_by` qu'en recopie d'une demande approuvée. Un travailleur ne passe jamais une avance à `WRITTEN_OFF` (politique `cmd_advance_upd`). `core.settlement_advance_approvers(jeton, avance)` rend les deux approbateurs à FINANCE / ADMIN de la portée seulement.

Preuves : `test/l0/l0-us062-host-money.test.ts` (RLS-2, RLS-21 à RLS-26, RLS-28, minimisation, réserves 3 à 5 d'US-056, en USD et en PYG), `test/l0/l0-rls-columns.test.ts` (colonnes exactes), `test/int/stl-schema.test.ts`, `test/int/iam-schema.test.ts`.

## Port PaymentProvider (US-019 ; 17 §2.8, §3.2.7, §4.3, §4.4, §6.5 ; ADR-059)

Migration `0028_payment_psp_port` :

- `platform.deployment_env()` : environnement de la **base**, `production` par défaut (fail-closed) ; remplacée par la migration d'environnement (US-003) et, en test seulement, par `9500` (paramètre `app.test_deployment_env`). La base de production du banc prouve que la version de production ne lit aucun paramètre.
- `core.payment_psp_account` (compte marchand de Kmino, `owner_type = PLATFORM`, références de coffre seulement) : `CHECK` FAKE ⇒ `SANDBOX` (`psp_account_fake_sandbox_only`), trigger `psp_account_fake_guard` (aucune écriture d'un compte FAKE quand la base est en production, `psp_account_fake_forbidden`), `PLATFORM_MOR` fermé, compte `LIVE` actif seulement avec `gate_decision_ref` (PAY-041), un compte `ACTIVE` par (fournisseur, pays, environnement). Aucun rôle applicatif n'y écrit en production.
- `core.payment_psp_capability` : matrice de capacités ; lecture de référence pour `app_api` et `app_worker` ; seule une valeur `VALIDATED_*` est utilisée côté application.
- `core.payment_payment_operation.psp_account_id` ; `core.payment_payment_operation_leg` (jambes explicites, immuables ; contrôle différé `payment_operation_legs_check`, fonction `core.payment_assert_operation_legs()` de la famille `integrity_trigger`) ; `core.payment_payment_operation_event` (chaque statut reçu, avec `outcome` APPLIED / DUPLICATE / STALE / CONFLICT).
- `core.payment_webhook_inbox.normalized_events` et contrainte `webhook_inbox_no_pan` (détecteur `core.payment_text_has_pan`). **Redéfini par 0029** : UUID écartés (un `evt-<uuid>` était refusé dans environ 0,25 % des cas), fenêtre de 13 à 19 chiffres en groupes séparés par un espace ou un tiret (tout groupage), zéros de tête retirés, premier chiffre de 2 à 8, Luhn ; temps linéaire ; contrainte recréée et validée. Vecteurs communs à l'API : `test/support/pan-vectors.json` (identité vérifiée par `test/support/pan.test.ts`) ; preuve `test/l0/l0-pay-pan.test.ts` (10 000 `evt-<uuid>` à graine fixe, mutant 0028, 64 ko sous `statement_timeout`).
- Commandes `SECURITY DEFINER` de la famille `cmd_money` (propriétaire `cmd_money_owner`) : `payment_cmd_record_operation` (travailleur `payment_command` ; idempotence par `idem_plain`, `IDEMPOTENCY_CONFLICT` si le contenu ou les jambes diffèrent, `LEG_SUM_MISMATCH`, `LEG_AMOUNT_NEGATIVE`), `payment_cmd_apply_operation_status` (travailleurs `payment_command`, `webhook_ingest` ; rangs de 17 §4.4 point 7), `payment_resolve_webhook_account` et `payment_cmd_receive_webhook` (`app_api` ; compte inconnu ou FAKE en production ⇒ `NOT_FOUND` sans écriture ; tolérance de ± 5 min à l'heure de la base), `payment_startup_guard` (`app_api`, `app_worker`).
- Lectures : `app_api` lit la seule jambe `HOST` du titulaire du compte d'hôte, ADMIN et FINANCE du pays toutes les jambes, OPS et SUPPORT celles du trip couvert par leur dossier ouvert (`trip_id` dénormalisé) ; `app_worker` (`payment_command`, `webhook_ingest`) lit jambes et événements.

Preuves : `test/l0/l0-pay-legs-rls.test.ts` (RLS des jambes par acteur et par pays) et `test/l0/l0-pay-port.test.ts` (C19, contrôle différé des jambes au COMMIT, idempotence, jambes, rangs, dédoublonnage, quarantaine, aucun PAN ni CVV, en USD et en PYG ; montants des vecteurs TJ).

## Port de place de marché (US-061 ; 17 §2.8, §2.9, §3.2.7, §4.3 ; ADR-066)

Migration `0039_payment_marketplace_legs` (réservée « 0045 », renumérotée à la fusion derrière US-024) :

- `core.payment_psp_capability_catalog` : les capacités de 17 §2.8, leur type et leur caractère **bloquant** (`YES`, `VARIANT_A`, `NO`) ; `core.payment_missing_blocking_capabilities(fournisseur, pays, variante)` rend les bloquantes non validées (seule la ligne `VALIDATED_*` en vigueur la plus récente, de portée méthode `*` / réseau `*`, compte ; fail-closed).
- `core.payment_psp_submerchant` : une tentative d'enregistrement par ligne (`submerchant:{org_id}:a{n}`), au plus une vivante par (compte, hôte), transitions gardées, aucune suppression ; l'hôte titulaire lit son statut seulement, ADMIN / FINANCE de leur pays, travailleurs `payment_command`, `payout`, `reconciliation`.
- Commandes `cmd_money` (travailleur `payment_command`) : `payment_cmd_register_submerchant` (refus `host_payout_rail_unavailable` ⇒ `HOST_PAYOUT_RAIL_UNAVAILABLE` si une capacité bloquante manque ; compte FAKE refusé en production) et `payment_cmd_record_submerchant_status`.
- `core.settlement_cmd_apply_leg_movement` : **seul écrivain** de `trip_leg_balance` (montants lus de `payment_operation_leg`, sous le verrou du trip, une fois par opération : `core.settlement_leg_movement`) ; débit d'une jambe libérée ou gelée ⇒ `LEG_ALREADY_RELEASED`.

Preuves : `test/l0/l0-pay-marketplace.test.ts` (chaque capacité bloquante `UNKNOWN`, `DOCUMENTED` ou absente, statuts, RLS des sous-marchands, soldes TJ01 / TJ02b / TJ08a / TJ08b, jambe libérée TJ18a à d, gel, réaffectation TJ05b, RLS-25 rejouée) ; fixture `9850` (gel d'une jambe).

## Correctifs de la red team argent (US-049 ; 08 E1, E4, E7 ; 17 §0.1, §2.9, §4.3 ; ADR-088)

Migration `0054_settlement_replay_leg_guards` (ajout seul), fixtures `test-migrations/9940_test_us049_money_fixtures.sql`, rapport `docs/team/redteam/L0-argent.md` :

- **Rejeu en base** (RC-1) : `core.settlement_verify_cxl_beta_1(inputs)` (fonctions `core.settlement_verify_*`, `SECURITY INVOKER`, pures) rejoue le moteur `cxl-beta/1` sur les entrées canoniques ; le trigger différé `settlement_balanced` garde les contrôles de 0027 puis refuse tout écart avec la version enregistrée (`settlement_replay_mismatch`), une version n+1 sur un autre trip (`settlement_trip_inputs_changed`) et une version de moteur sans vérificateur (`settlement_replay_unsupported`). Un vérificateur, pas un second moteur : aucun montant n'est produit en base.
- **Remboursement** (RC-2) : `settlement_cmd_apply_leg_movement` exige un règlement du segment (`leg_refund_without_settlement`) et plafonne, jambe par jambe, Σ remboursé par − Σ variations de la chaîne de versions (`leg_refund_exceeds_settlement`), après les contrôles de solde de 0039.
- **Versement** (RC-3) : `core.settlement_release_blocker(opération)` (trip `COMPLETED`, `release_at` atteint, sous-marchand `ACTIVE`, `insurer_contract_active`, `payouts_enabled`), appelée par le trigger d'instruction `payment_operation_leg_release_guard` (l'ordre refusé n'est jamais créé) et par `settlement_cmd_apply_leg_movement` ; `funds_holding_enabled` exigé pour un compte hors `SPLIT_AT_SOURCE` (`leg_funds_holding_disabled`). Interrupteurs lus par `core.config_go_live` (fail-closed) ; `cmd_money_owner` lit la configuration et le statut du trip.
- Codes : `INVARIANT_VIOLATION`, `INVALID_TRANSITION`, `HOST_PAYOUT_RAIL_UNAVAILABLE`, `FORBIDDEN` (aucun code nouveau).
- **Preuve signée** (RC-5, migration `0055_payment_webhook_proof_guard`) : `payment_cmd_apply_operation_status` n'applique un statut terminal de source `WEBHOOK` que si `raw_ref` désigne un webhook reçu par `payment_cmd_receive_webhook`, signé, du même compte, hors quarantaine d'horodatage et rattaché à l'opération ; sinon `UNPROVEN`. Fixture de test `us049_signed_webhook` (9940).
- **Preuve durcie** (revues de la PR n° 92, migration `0058_payment_proof_hardening`) : `payment_webhook_inbox.received_by_command` et `signed_at_out_of_tolerance`, posés par la seule commande de réception, jamais réécrits (trigger `webhook_inbox_proof_columns_immutable`) ; une preuve WEBHOOK les exige (reçue par la commande, jamais hors tolérance) ; `MANUAL_OPS` terminal ⇒ `UNPROVEN` ; voie directe `worker_update_status` fermée pour tout statut terminal. **Limite** : POLL et API_RESPONSE terminaux restent acceptés sans preuve (RC-5 partiellement corrigée, US-223, ADR-088). Preuves : `test/l0/l0-us049-payment-proof.test.ts` (PA, PY), réceptions par la vraie commande dans la transaction du test (fixture `test-migrations/9950_test_us049_payment_proof_fixtures.sql`). L'aide `receiveProof` (`test/support/avl.ts`) passe par un vrai webhook signé et la commande d'application.
- **Limite** (ADR-088) : capture non bornée par le devis (RC-4, bogue porté par US-202, module PRC ; caractérisation ARG-34a).

Preuves : `test/l0/l0-us049-money-fixes.test.ts` (rejeu de chaque vecteur normatif bêta de l'export comparé à l'oracle, falsifications cohérentes, devis recomposé, remboursement TJ01 / TJ08a avant et après requalification, gardes du versement dans l'ordre, limite connue RC-4, en USD et en PYG), `test/l0/redteam-argent-*.test.ts`, `test/l0/l0-stl-settlement.test.ts` (anciennes limites connues inversées).

## Socle de marque (US-034 ; 17 §3.2.13 ; ADR-036, ADR-067)

Migration `0042_config_brand` (à la suite de `0040`–`0041` d'US-024), fixtures `test-migrations/9870_test_brand_fixtures.sql` :

- `core.config_brand_version` (thème DTCG versionné, une seule `PUBLISHED`, index unique partiel), `core.config_brand_asset` (actif public, copie figée de l'emplacement et de l'empreinte du `file_asset`), `core.config_content_block` (es, en, fr ensemble, par clé et pays ; `legal.*` et Markdown hors règles refusés par contrainte) ; RLS `ENABLE` + `FORCE`, `migrator_all`.
- **Gardes** (tous rôles, `migrator` compris) : un brouillon est immuable ; seules transitions `DRAFT → PUBLISHED` et `PUBLISHED → ARCHIVED` ; ni `DELETE` ni `TRUNCATE` ; un actif est immuable. Une version non brouillon exige un `contrast_check` « passé, aucune paire en échec » (CHECK).
- **Commandes** `SECURITY DEFINER` (`iam_staff_owner`, EXECUTE au seul `app_api`, liste blanche RLS-15) : `cfg_brand_cmd_register_asset` (écrit `audit_file_asset` en bucket `BRAND`, `C0`), `cfg_brand_cmd_save_draft`, `cfg_brand_cmd_publish` (atomique sous verrou consultatif, refus de contraste journalisé), `cfg_brand_cmd_rollback` (nouvelle version copiée puis publiée), `cfg_brand_staff_versions`, `cfg_content_cmd_save_draft`, `cfg_content_cmd_publish`, `cfg_content_cmd_rollback`. Permissions semées : `brand.edit`, `brand.publish` (ADMIN) ; thème commun = permission sur tous les pays déclarés.
- **Lecture publique** : `app_api` lit les versions et blocs `PUBLISHED`, sans colonne d'auteur ni de requête, et les actifs qu'ils référencent ; rien pour `app_worker` ni `app_anon`.

Preuves : `test/l0/l0-brand.test.ts` (droits, publication atomique et 8 publications concurrentes, retour arrière, refus de contraste journalisés, permissions et portée pays, gardes sous `migrator`, actifs, blocs en PA, PY et communs).

## Limitation de débit et anti-abus (US-052 ; 17 §6.6 ; ADR-075)

Migrations `0046_config_rate_limit_params` (graine complémentaire **générée** des 14 paramètres `rate_limit_*`, PA / PY ; 0009 reste immuable) et `0047_risk_rate_limit`, propriétaire NOLOGIN `risk_limit_owner` (famille `risk_limit`), fixtures `test-migrations/9890_test_risk_fixtures.sql` :

- `core.risk_rate_counter` (fenêtre fixe par portée, empreinte HMAC de 32 octets et début de fenêtre) et `core.risk_abuse_event` (refus et soupçons agrégés par heure) : RLS `ENABLE` + `FORCE`, aucun droit de table pour les rôles applicatifs ; aucune donnée personnelle en clair.
- **Commandes** `SECURITY DEFINER` (`risk_limit_owner`, liste blanche RLS-15) : `risk_cmd_hit` (app_api ; fenêtre à `platform.now()`, délai de reprise, refus journalisé), `risk_cmd_sms_reserve` (plafond SMS par jour **local** du pays ; app_api, et app_worker sous `ntf_sender` seulement), `risk_cmd_record_abuse` (app_api), `risk_cmd_prune` (app_worker sous `risk_pruner`).
- **Tableau de sécurité** : `risk_staff_abuse_board` (`iam_staff_owner`, EXECUTE app_api) ; TOTP et permission `security.read_abuse` (ADMIN, SUPERADMIN) ; refus journalisés ; aucune empreinte rendue.

Preuves : `test/l0/l0-risk-rate-limit.test.ts` (droits, fenêtres à l'horloge virtuelle en PA et PY, 30 appels concurrents pour une limite de 5, plafond SMS au jour local, critique toujours accordé, alerte unique, liste blanche des travailleurs, purge, tableau de sécurité et refus journalisés).

## Consentements versionnés et gabarits juridiques (US-102 ; 16 ACC-001, LEG-001, LEG-002 ; 17 §3.1.3, §3.2.6 ; ADR-091)

Migration `0059_ctr_legal_consent` :

- `core.contract_document_template` (classe C, ajout seul) : texte en base, version par (genre, pays, langue), `is_major`, `content_hash` = SHA-256 posé par le déclencheur `document_template_guard`, `country_code` NULL = document commun, `legal_review_ref` NULL = BROUILLON. Graine : version 1 BROUILLON de `TOS_GUEST`, `PRIVACY` et `MARKETING` en es, en, fr et pt.
- `core.contract_consent` (classe A, ajout seul, `consent_guard`) : version exacte (`template_id`), langue, `accepted_at` = `platform.now()`, contexte ; `ip_enc` / `user_agent_enc` [C2] chiffrés par la clé du sujet ou retenus (`c2_withheld`) ; CGU et confidentialité jamais retirées par une ligne.
- **Aucune inscription sans consentement** : déclencheur de contrainte DIFFÉRÉ `ctr_signup_consents_required` sur `core.iam_user_account` (fonction `core.ctr_signup_consents_guard`, `iam_auth_owner`) ; exemptés : connexions `migrator` et superutilisateur (migrations, fixtures). Un test qui crée un compte en autocommit appelle `core.iam_cmd_register_with_consents` (versions NULL = en vigueur).
- Aucun droit de table pour les rôles applicatifs ; commandes `iam_auth_owner` (inscription, état, réacceptation, communications, historique, lecture publique) et `iam_staff_owner` (publication, permission `legal.publish`, journalisée) ; liste blanche RLS-15 mise à jour.

Preuves : `test/l0/l0-ctr-consents.test.ts` (rôle app_api, horloge virtuelle, publication dans une transaction annulée, documents propres à chaque pays).

## Matrice d'autorisations et gardes d'environnement (US-043 ; 17 §2.3, §6.5, §6.6 ; ADR-077)

- **`authorization-matrix.json`** : une entrée par table ou vue des schémas `core`, `app`, `platform` (droits exacts des trois rôles applicatifs, politiques applicables, prédicat de lecture par acteur d'`app_api` et par travailleur). Une relation sans entrée fait échouer la CI. Modifier la matrice = revue sécurité.
- **Preuve** : `test/l0/l0-us043-authorization-matrix.test.ts`, sous les rôles de production, en PA et en PY : inventaire de la base de production (RLS `ENABLE` + `FORCE`, vues `security_invoker`, droits, politiques, séquences, fonctions d'`app_anon`), écritures absentes de la matrice exécutées et refusées (42501), lectures de chaque acteur comparées à l'attendu de la fixture `test-migrations/9900_test_authorization_matrix_fixtures.sql` dans le même instantané (`REPEATABLE READ`).
- **Gardes d'environnement** : `0048_security_env_guard_fail_closed` lit `COALESCE(platform.deployment_env(), 'production')` dans les six fonctions PAY qui ouvraient sur NULL ; le lint `sql-env-guard` (`pnpm lint:sql`, liste des lectures historiques remplacées : `env-guard-allowlist.json`) et `test/l0/l0-us043-env-guard.test.ts` (`pg_proc` de production, NULL ⇒ refus) empêchent toute nouvelle garde ouverte.
- **Lectures de la console** : `0049_staff_read_access_outcome` (`core.iam_staff_read_access`, `iam_staff_owner`) rend l'issue d'accès des lectures `audit.read`, `brand.edit`, `security.read_abuse` quand elles sont vides : 401 / 403 au lieu d'un 200 vide.

## Environnement déclaré et job de déploiement (US-003 ; 17 §6.5 ; ADR-078)

- **Migration 0050** : `platform.environment_declaration` (une ligne au plus, RLS `ENABLE` + `FORCE`, aucun droit applicatif) écrite **une fois** sous `migrator` par `platform.declare_environment(env)` (`development`, `preproduction`, `production` ; même valeur rejouable, autre valeur refusée `environment_declared_once`, 55000), jamais modifiée (trigger sur UPDATE, DELETE, TRUNCATE). `platform.declared_environment()` (SECURITY DEFINER, `guard_owner`, RLS-15) la lit ; `platform.deployment_env()` = `COALESCE(platform.declared_environment(), 'production')` : jamais NULL, base non déclarée ⇒ production. Les bases du banc gardent la version de test (9500).
- **Surcouche de développement** (`dev-overlay/`) : `SELECT platform.declare_environment('development')`.
- **Job de base** (`src/deploy/`, `node packages/db/src/deploy/cli.ts`, image de production) : `RUEDA_ENV` ∈ {preproduction, production} sinon refus ; amorçage et mots de passe sous le rôle d'administration ; migrations sous `migrator` ; déclaration ; vérification sous `app_api` (environnement, aucun compte PSP FAKE). Secrets en variables (`docs/ops/ENV_VARS.md`), messages expurgés. Runbook : `docs/ops/DEPLOY.md`.
- **Preuves** : `test/l0/l0-us003-environment.test.ts` (base de production sous `app_api` et `app_worker` ; immutabilité par la fixture `9910`, transaction annulée) ; `src/deploy/setup.test.ts` (configuration) ; job CI `déploiement local` (job réel sur PostgreSQL 16, redéclaration refusée).

## Journal d'accès du staff et supervision (US-004 ; 16 ADM-032 ; 17 §2.3, §3.2.13, §6.3 ; ADR-080)

- **Migration 0051** : permission `kyc.read_sensitive` (OPS_AGENT : dossier de sa file ; ADMIN : son pays ; PROPOSÉ) ; porte `core.iam_staff_cmd_data_access(jeton, requête, dossier, type de sujet, sujet, champ, type d'accès, motif)` (SECURITY DEFINER, `iam_staff_owner`, EXECUTE au seul `app_api`, RLS-15) : session, TOTP, permission dans le pays du `support_case` (relu en base), dossier ouvert et assigné (sauf ADMIN), `BREAK_GLASS` ⇔ dossier `BREAK_GLASS` ; sur GRANTED une ligne `data_access_log` puis une ligne chaînée `STAFF_DATA_ACCESS` ; refus journalisés sans ligne d'accès ; `READ_C2_SUPPORT` / `BULK_EXPORT` : 22023. `payment_webhook_inbox.processing_attempts` (UPDATE pour `app_worker`). `core.ops_monitor_metrics(depuis, échecs)` (SECURITY INVOKER, travailleur `ops_monitor`, sinon 42501 `ops_monitor_forbidden` → FORBIDDEN) : comptes seulement ; `ops_monitor` ajouté aux politiques SELECT de l'outbox, de la boîte de réception des webhooks et des opérations de paiement (ALTER POLICY).
- **Preuves** : `test/l0/l0-us004-data-access.test.ts` (PA, PY : GRANTED, refus, 22023, inaltérable, chaîne vérifiable, lecture par `audit.read`) avec la fixture `9920` ; `test/l0/l0-us004-ops-monitor.test.ts` (PA, PY : 3 échecs, UNKNOWN > 30 min, alertes P1 de l'outbox, garde du travailleur) ; matrice d'autorisations (`ops_monitor`, `processing_attempts`).

## Restauration testée et rotation des secrets (US-051 ; 16 ADM-032, ADM-035 ; 17 §6.4, §6.6 ; ADR-082)

- **Migration 0053** : `core.iam_mfa_proof_key` admet une clé SUIVANTE (`id` 2) le temps d'une rotation ; `core.iam_staff_cmd_elevate` (SECURITY DEFINER, `iam_staff_owner`, corps de 0033 hors la lecture des clés) accepte la preuve sous l'une des clés installées ; `core.iam_mfa_proof_key_rotate(INSTALL | STAGE | PROMOTE | ABORT, clé)` (SECURITY INVOKER, sous `migrator` seulement, EXECUTE à personne) rend l'état (`CURRENT`, `CURRENT+NEXT`), jamais une clé. CLI : `node packages/db/src/rotation/cli.ts mfa-proof-key <action>` (`src/rotation/`). Fixture `9930` (gestes sous migrator dans une transaction annulée) ; preuve `test/l0/l0-us051-mfa-key-rotation.test.ts`.
- **Vérification d'une base restaurée** (`src/restore/`, dans l'image) : `node packages/db/src/restore/cli.ts` ; contrôles `roles`, `rls`, `migrations`, `environment`, `l0-05`, `audit_chain`, `c12`, `money`, `occupancy` ; empreintes du catalogue de sécurité et des données. Variables : `docs/ops/ENV_VARS.md`.
- **Exercice de restauration** (`test/drill/`, `vitest.drill.config.ts`, `pnpm --filter @rueda/db test:drill`) : lancé SEULEMENT par `scripts/ops/restore-drill.sh` (instance source aux journaux archivés) ; son `globalSetup` prépare une préproduction (job de base, puis fixtures) au lieu du banc ; il exécute les étapes de `docs/ops/BACKUP_RESTORE.md` telles qu'écrites et mesure RTO et RPO. Assertion L0-05 exigée comme ailleurs.

## Correctifs de la red team RLS (US-049 ; porte du lot 0 ; ADR-089)

- **Migration 0056** : `core.booking_cmd_place_host_block` et `core.booking_cmd_remove_host_block` exigent que `core.booking_vehicle_party(véhicule)` désigne le compte (et, pour la pose, le pays) de la session : véhicule d'autrui, même inoccupé, ou inconnu ⇒ `FORBIDDEN` (F-RLS-01, RT-RLS-17) ; `core.booking_cmd_place_hold` refuse tout membre `ACTIVE` ou `INVITED` du compte d'hôte du véhicule (`SELF_BOOKING_FORBIDDEN`, F-RLS-02, RT-RLS-13) ; bornes finies exigées pour le hold et le blocage, durée d'un hold ≤ `max_trip_days` du pays (`INVALID_PERIOD` ; paramètre absent : `PARAM_MISSING` ; RT-CONC-02). Corps recopiés de 0032 et 0037 hors ces contrôles ; propriétaires, EXECUTE et liste blanche RLS-15 inchangés ; `cmd_hold_owner` lit `iam_membership (org_id, user_id, status)` (politique `cmd_hold_read`).
- **Amorçage, § 3** : `REVOKE EXECUTE … FROM PUBLIC` sur les fonctions de `pg_catalog` à effet de bord hors RLS (`pg_logical_emit_message`, `lo_creat`, `lo_create`, `lo_from_bytea`, `lo_import`, `lo_export`, `pg_cancel_backend`, `pg_terminate_backend`), dans chaque base (F-RLS-04) ; avertissement si le rôle d'administration ne peut pas les retirer (service géré).
- **Preuves** : `test/l0/l0-us049-rls-fixes.test.ts` (PA, PY ; base de test et base de production du banc), `test/l0/l0-occ-single-occupancy.test.ts` (cloisonnement des écritures), et les attaques inchangées de `test/l0/redteam-rls/`.
- **Limite non fermée** : F-RLS-03 (`core.iam_cmd_open_session`, RLS-18) ; parade compensatoire `rueda/no-dynamic-sql` (`packages/config`) ; voir ADR-089 et `docs/team/redteam/L0-rls.md`.

## Document du schéma et préfixes (US-038 ; 17 §3 ; ADR-079)

- **`src/schema-doc.ts`** : lit le catalogue (`pg_catalog`) d'une base migrée et rend `docs/architecture/schema.md` (historique des migrations résumé par la première ligne de chaque fichier, rôles, schémas, tables avec RLS, droits, colonnes, contraintes, index, politiques et déclencheurs, vues, fonctions `SECURITY DEFINER` et autres). Rendu déterministe (aucun OID, tri par nom), testé sur un instantané fabriqué (`src/schema-doc.test.ts`).
- **Preuve** : `test/int/schema-doc.test.ts` régénère le document sur la base « production » du banc, sous `app_api` (L0-05), et le compare au fichier commité : un écart fait échouer `test:int`. Une migration ajoutée demande donc de recopier le document imprimé dans le journal du job (marqueurs `----- docs/architecture/schema.md`), ou `RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/db test:int` sur un banc local.
- **Préfixes** : `src/table-prefix.test.ts` exige que toute table `core.*` commence par le schéma cible d'un module (`schemas.ts`) ; seul écart tracé : `ntf_notification_dispatch` (PROP-038-03 de `docs/team/PROPOSITIONS.md`).

## Migrations testées et données personnelles (US-046 ; 17 §3.1.3, §3.1.4, §11 RLS-19 ; ADR-081)

- **Expand / contract imposé** : `pnpm lint:sql` (et `pnpm lint`) lance `src/expand-contract/cli.ts`. Une contraction échoue, au premier niveau, dans un bloc `DO` (quelle que soit la structure de contrôle) ou dans une fonction : vingt et une natures (ADR-081), dont politique, contrainte, déclencheur ou index retiré sans être recréé sous le même nom, défaut retiré, RLS relâchée et `EXECUTE` dynamique. Seule une dérogation de `expand-contract-allowlist.json` (fichier, ligne, nature, justification) la fait passer ; une dérogation périmée échoue aussi.
- **Migrations une par une sur base peuplée** : `test/l0/l0-us046-migrations.test.ts`, sur la base `_mig` du banc (amorcée sans migration), sous `migrator`. Après chaque migration :
  - schéma de la version N conservé (retour arrière d’US-003 sans migration descendante) : colonnes, types, défauts, fonctions, droits, politiques, contraintes, déclencheurs, index, RLS ;
  - lignes et comptes égaux ;
  - contraintes validées, FK sans orpheline, RLS `ENABLE` + `FORCE` et lecture de `migrator` (RLS-19) ;
  - graines PA / PY de `test/support/migration-seeds.ts` posées dès que leurs tables existent.

  En fin de parcours : chaîne d'audit valide, idempotence et refus de rejouer. Option `through` de `runMigrations` : appliquer jusqu'à un numéro.

- **Inventaire** `personal-data-inventory.json` : une classe (C0 à C4) par colonne de production. Par table : classe de suppression, colonnes de sujet, canal d'export. Par colonne C2 / C3 : méthode d'effacement. Une colonne nouvelle **doit** y être classée : `src/privacy/inventory.test.ts` (contre `schema.md`) et `test/l0/l0-us046-personal-data.test.ts` (contre le catalogue) échouent sinon. La cohérence avec `authorization-matrix.json` (US-043) est vérifiée en unitaire.
- **Export** `exportOwnPersonalData` (`@rueda/db/privacy`) : dans la session de la personne, sous `app_api`, tables `self`, colonnes accordées sauf C4. **Effacement** : pour chaque colonne en crypto-shredding de l'inventaire, la destruction de clé est prouvée en PA et en PY.
- Les URL, journaux, alertes et erreurs d'`apps/api` sont contrôlés par `apps/api/src/testing/personal-data-leaks.test.ts`.

## Rôles (17 §2.3, ADR-035)

| Rôle                                                                                                                                                                                                                                 | Attributs                                                                                                | Usage                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `migrator`                                                                                                                                                                                                                           | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`                                      | propriétaire des objets ; migrations seulement                                    |
| `app_api`, `app_worker`, `app_anon`                                                                                                                                                                                                  | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEDB`, `NOCREATEROLE`                                      | exécution de l'application **et de tous les tests**                               |
| `guard_owner`, `catalog_probe_owner`, `policy_fn_owner`, `cmd_hold_owner`, `iam_auth_owner`, `integrity_owner`, `audit_chain_owner`, `cmd_money_owner`, `cmd_golive_owner`, `iam_staff_owner`, `host_view_owner`, `risk_limit_owner` | `NOLOGIN`, sans mot de passe ; seul membre : `migrator`, avec `INHERIT FALSE, SET TRUE` (ADR-044 amendé) | propriétaires des familles de fonctions `SECURITY DEFINER` (liste blanche RLS-15) |

Droits actuels : `USAGE` sur `platform` et `EXECUTE` sur `platform.now()` pour `app_api`, `app_worker` et les propriétaires ; chaque propriétaire n'a ensuite que les droits de table, colonne par colonne, de ses fonctions, et une politique RLS à son nom (ADR-053) ; rien pour `app_anon` ni pour `PUBLIC` ; `ALTER DEFAULT PRIVILEGES FOR ROLE migrator REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. Aucun mot de passe dans le SQL : le harnais (ou, plus tard, le gestionnaire de secrets) les pose, en envoyant un vérificateur SCRAM-SHA-256 et jamais le mot de passe en clair.

## Commandes de test

```bash
pnpm test:unit   # sans base : correspondance des schémas, exécuteur (plan, sommes), masquage des secrets, SCRAM, source
pnpm test:int    # PostgreSQL réel : banc, migrations, droits minimaux, transaction de test
pnpm test:l0     # preuves L0 sous les rôles de production
pnpm --filter @rueda/db test:c11   # fuzz C11 (1 000 exécutions par défaut) et oracle C12
bash scripts/ops/restore-drill.sh  # exercice de restauration chronométré (Docker ; lance test:drill)
```

Variables (noms seulement, inventaire : `docs/ops/ENV_VARS.md`) :

- local (P-07, PostgreSQL 16 natif) : `RUEDA_PG_ADMIN_URL` (URL **sans** mot de passe, par exemple `postgres://postgres@localhost:5432/postgres`) et `RUEDA_PG_SUPERUSER_PASSWORD_FILE` (chemin d'un fichier **hors dépôt**, une ligne) ;
- CI : `RUEDA_PG_TESTCONTAINERS=1` (démarre `postgres:16` par Testcontainers ; Docker requis). **La CI fait foi** (ADR-043) ; un vert local ne suffit pas.

Sans l'une ou l'autre configuration, `test:int` et `test:l0` **échouent** (jamais de faux vert). Le service Windows `postgresql-x64-16` doit être démarré (action du fondateur, droits administrateur).

Installation de PostgreSQL pour ces deux suites : guide `docs/ops/INSTALL.md` (compose de développement), ou `RUEDA_PG_TESTCONTAINERS=1`. Depuis la racine : `pnpm --filter @rueda/db test:unit`, `pnpm --filter @rueda/db test:int`, `pnpm --filter @rueda/db test:l0`.

## Fonctionnement du harnais

1. `globalSetup` (`src/testing/global-setup.ts`) choisit la source par **une seule fonction** (`resolveAdminSource`) : URL + fichier de mot de passe, sinon Testcontainers.
2. `provisionBench` prend un **verrou consultatif d'instance** dans la base d'administration (une série à la fois par instance : les mots de passe des rôles changent à chaque série), supprime les bases `rueda_test_*` orphelines d'une série interrompue, puis crée deux bases jetables :
   - `rueda_test_<aléa>` : migrations de production **+** `test-migrations/` ;
   - `rueda_test_<aléa>_prod` : migrations de production seules, pour vérifier que le corps de production de `platform.now()` ne lit pas `app.virtual_now` (L0-06).
   - deux copies (`TEMPLATE`) de la base principale juste après ses migrations : `_inj` (cas « sans verrou » de L0-02, `deadlock_timeout` court, ADR-056) et `_fuzz` (fuzz C11 et oracle C12, réglages du serveur, ADR-068) ;
   - `rueda_test_<aléa>_mig` : amorcée **sans** migration, réservée au test des migrations une par une (US-046, ADR-081), seule base où un test se connecte sous `migrator` (`connectMigratorForMigrationTest`, RLS-19).
3. Dans chaque base : amorçage sous l'administrateur, mots de passe aléatoires de la série pour `migrator`, `app_api`, `app_worker`, `app_anon`, migrations sous `migrator`, puis un second passage de l'exécuteur qui doit être vide (idempotence).
4. Les tests utilisent `withRole(role, fn, { database })` ou `connectAs(role)` : connexion **directe** (`pg.Client`, sans pooler) et **assertion L0-05** (`current_user ∈ {app_api, app_worker, app_anon}`, `NOT rolsuper AND NOT rolbypassrls`). `setup-l0-05.ts` fait échouer tout test qui n'a exécuté aucune assertion de rôle.
5. `withTestTransaction(client, { virtualNow, commit }, fn)` : `BEGIN`, `SET LOCAL app.virtual_now` (par `set_config(…, true)`, paramètre lié), contrôle que `platform.now()` vaut l'heure virtuelle (ou, sans heure virtuelle, qu'il est à moins de 120 s de l'horloge du test), `fn`, `ROLLBACK` par défaut, puis `RESET ALL` dans tous les cas.
6. Le teardown supprime les deux bases (`DROP DATABASE … WITH (FORCE)`) et libère le verrou, **même si des tests ont échoué**.
7. `connectForNegativeRoleTest('migrator' | 'admin')` est réservé aux tests **négatifs** de l'assertion L0-05.

Secrets : le mot de passe du superutilisateur est lu dans le fichier, jamais placé dans une URL, jamais affiché ; toute erreur du banc est expurgée (`redactError` : mot de passe d'administration et mots de passe de la série, URL `postgres://user:***@`).

## Écrire une migration

- Nom `NNNN_<module>_<objet>.sql` (minuscules, chiffres, `_`), numéro suivant le dernier ; **jamais** modifier une migration appliquée (somme vérifiée) ; jamais deux agents sur la même migration (19 §1.5).
- Additive (**expand / contract imposé** par `pnpm lint:sql`, ADR-081) ; un commentaire « Retour arrière » décrit l'inverse (aucune migration descendante : le retour arrière ressert la version précédente, ADR-078). Une contraction (suppression, renommage, type, `SET NOT NULL`, droit retiré, données réécrites) vient dans une version ultérieure, avec une dérogation justifiée dans `expand-contract-allowlist.json`.
- Toute colonne nouvelle est classée dans `personal-data-inventory.json` (classe, et méthode d'effacement si C2 / C3) dans la même story.
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
