<!-- Fichier GÉNÉRÉ depuis une base PostgreSQL 16 migrée par les migrations de production (US-038, ADR-079) : ne pas modifier à la main. -->
<!-- Régénérer : job CI « base de données » (test:int, schema-doc) : copier le document imprimé, ou RUEDA_DOCS_WRITE=1 pnpm --filter @rueda/db test:int sur un banc local. La CI échoue si ce fichier n'est plus à jour. -->

# Schéma de la base (production)

Lu dans le catalogue (`pg_catalog`) d'une base jetable du banc, après les seules migrations de `packages/db/migrations/` (sans les migrations de test), sous le rôle `app_api`. Fait foi pour l'état réel ; la cible est 17 §3 (écarts : `docs/team/PROPOSITIONS.md`).

## Synthèse

- 52 migrations ; 65 tables ; 2 vues ; 334 politiques RLS ; 65 fonctions `SECURITY DEFINER` ; 88 autres fonctions.
- Tables sans RLS `ENABLE` + `FORCE` : aucune.
- Rôles applicatifs avec `SUPERUSER` ou `BYPASSRLS` : aucun.

## Historique des migrations

| Migration | Objet |
| --------- | ----- |
| `0000_platform_now` | schéma `platform`, horloge de la base `platform.now()`, journal des migrations. |
| `0001_role_grants` | droits minimaux des rôles de production sur les objets de plateforme. |
| `0002_app_session_context` | schéma transverse `app` : lecture du contexte de session posé par la couche d'accès. |
| `0003_core_schema` | schéma unique de la Bêta pilote `core` et colonnes d'audit des tables mutables. |
| `0004_booking_occupancy_hold_trip` | AVL : occupations, holds de checkout, trips, compensations (schéma de preuve L0). |
| `0005_payment_operation_webhook_inbox` | PAY : opérations de paiement et boîte de réception des webhooks (schéma de preuve L0). |
| `0006_booking_disposition_invariants` | AVL : disposition des paiements (XOR) et invariants gardés par triggers. |
| `0007_avl_pay_worker_grants` | droits et politiques RLS des travailleurs (app_worker) sur les tables AVL et PAY. |
| `0008_config_country` | configuration pays (CFG) : devises, pays, paramètres versionnés, fériés, taxes par |
| `0009_config_seed` | graines de la configuration pays (US-013 ; 17 §7.2 ; ADR-024, ADR-033). |
| `0010_iam_identity` | IAM : comptes, vérification d'email, facteurs, sessions, OTP, comptes d'hôte, appartenances, |
| `0011_iam_auth_commands` | IAM : commandes de l'adaptateur interne du port d'authentification (comptes, sessions, |
| `0012_outbox_tables` | BUS : outbox transactionnelle, reçus de consommation, lettres mortes, tâches planifiées. |
| `0013_outbox_functions` | BUS : fonctions du relais, de la file et de la consommation idempotente. |
| `0014_outbox_grants` | BUS : droits et politiques RLS de l'outbox, de la file, des reçus et des lettres mortes. |
| `0015_outbox_monitoring` | BUS : métriques de l'outbox et des files (âge, profondeur, lettres mortes). |
| `0016_audit_subject_key` | AUD : clés de données par sujet (crypto-shredding) et garde des registres en ajout seul. |
| `0017_audit_log_chain` | AUD : journal d'audit en ajout seul, chaîné par hachage SHA-256. |
| `0018_audit_data_access_log` | AUD : journal d'accès aux données personnelles (ajout seul). |
| `0019_audit_file_asset` | AUD : métadonnées des fichiers (magasin de preuves) avec empreinte SHA-256 à la réception. |
| `0020_audit_subject_key_destruction` | AUD : procédure de destruction d'une clé de sujet (crypto-shredding), tracée. |
| `0021_audit_grants` | AUD : droits et politiques RLS des rôles de production sur les tables d'audit. |
| `0022_security_definer_owners` | propriétaires NOLOGIN dédiés des fonctions SECURITY DEFINER existantes. |
| `0023_avl_iam_foreign_keys` | clés étrangères AVL → IAM et cohérence pays du compte d'hôte. |
| `0024_app_context_policy_functions` | contexte de session complet, dossier de support (sous-ensemble) et fonctions de politique. |
| `0025_rls_actor_country_policies` | lectures d'app_api : politiques RLS par type d'acteur et par pays. |
| `0026_audit_owner_subject_key_scope` | AUD : propriétaire dédié du trigger de chaîne et cloisonnement des clés par sujet. |
| `0027_settlement_versions_legs` | STL : règlements persistés, versions, supersession et jambes. |
| `0028_payment_psp_port` | PAY : port PaymentProvider, comptes et capacités PSP, jambes, événements d'opération, |
| `0029_payment_pan_detector_layouts` | PAY : détecteur de PAN sans faux positif sur les identifiants structurés (UUID), en |
| `0030_ntf_notification_dispatch` | NTF : journal des envois de notifications (`notification_dispatch`). US-021 ; 17 §2.13, |
| `0031_iam_notification_contact` | IAM : coordonnées d'un destinataire de notification, pour le seul travailleur |
| `0032_booking_single_occupancy` | AVL : table d'occupation unique, blocages de l'hôte et tampons autonomes. |
| `0033_iam_staff_mfa` | IAM : authentification forte du staff (TOTP), sessions de staff liées à la MFA, |
| `0034_staff_console` | Console interne : matrice des permissions du staff, actions de console (`manual_action`), |
| `0035_host_permissions_minimization` | Rôle P2P_HOST : permissions de l'hôte, politiques RLS de l'hôte sur les jambes, |
| `0036_settlement_money_tables_finance` | Tables d'argent sans écriture directe, avances de Kmino, assureur, double validation |
| `0037_booking_hold_commands` | AVL : holds de checkout, commandes de pose et de libération, tâche d'expiration. |
| `0038_payment_outbox_tightening` | PAY et BUS : reports de sécurité confiés à US-023. |
| `0039_payment_marketplace_legs` | PAY / STL : port de place de marché (sous-marchands, capacités bloquantes) et écrivain des |
| `0040_booking_payment_intent` | AVL / PAY : intention de paiement (T1), affinage de l'ordre (T2), annulation d'ordre par la |
| `0041_booking_guarded_conversion` | AVL : conversion gardée, ré-acquisition, compensation, refus reçu, balayages. |
| `0042_config_brand` | CFG : socle de marque modifiable — versions de thème (`brand_version`), actifs de marque |
| `0043_config_brand_portuguese` | CFG : portugais du Brésil, quatrième langue des actifs et des blocs de contenu de marque. |
| `0044_config_country_portuguese` | graine complémentaire : langue « pt » ajoutée aux pays (locales et noms). |
| `0045_booking_production_oracle` | AVL : oracle de production C12 (lecture seule, alerte P1) et garde d'environnement de T1 |
| `0046_config_rate_limit_params` | graine complémentaire : paramètres « rate_limit_* » (US-052 ; 17 §7.2). |
| `0047_risk_rate_limit` | RISK : compteurs de débit partagés entre instances, plafond journalier de SMS par pays |
| `0048_security_env_guard_fail_closed` | Gardes d'environnement fail-closed sur NULL (C19) : PAY. |
| `0049_staff_read_access_outcome` | Console : issue d'accès des lectures du staff (403 au lieu d'une liste vide). |
| `0050_platform_environment_declaration` | Environnement de déploiement DÉCLARÉ (US-003, ADR-078 ; 17 §6.5 point 1, C19). |
| `0051_audit_staff_data_access_ops_monitor` | AUD : lectures de données personnelles par le staff journalisées ; supervision. |

## Rôles

| Rôle | LOGIN | SUPERUSER | BYPASSRLS | INHERIT | Membre de |
| ---- | ----- | --------- | --------- | ------- | --------- |
| `app_anon` | oui | non | non | oui | — |
| `app_api` | oui | non | non | oui | — |
| `app_worker` | oui | non | non | oui | — |
| `audit_chain_owner` | non | non | non | oui | — |
| `catalog_probe_owner` | non | non | non | oui | — |
| `cmd_golive_owner` | non | non | non | oui | — |
| `cmd_hold_owner` | non | non | non | oui | — |
| `cmd_money_owner` | non | non | non | oui | — |
| `guard_owner` | non | non | non | oui | — |
| `host_view_owner` | non | non | non | oui | — |
| `iam_auth_owner` | non | non | non | oui | — |
| `iam_staff_owner` | non | non | non | oui | — |
| `integrity_owner` | non | non | non | oui | — |
| `migrator` | oui | non | non | oui | audit_chain_owner (NOINHERIT), catalog_probe_owner (NOINHERIT), cmd_golive_owner (NOINHERIT), cmd_hold_owner (NOINHERIT), cmd_money_owner (NOINHERIT), guard_owner (NOINHERIT), host_view_owner (NOINHERIT), iam_auth_owner (NOINHERIT), iam_staff_owner (NOINHERIT), integrity_owner (NOINHERIT), policy_fn_owner (NOINHERIT), risk_limit_owner (NOINHERIT) |
| `policy_fn_owner` | non | non | non | oui | — |
| `risk_limit_owner` | non | non | non | oui | — |

## Schémas

| Schéma | Propriétaire | Droits |
| ------ | ------------ | ------ |
| `app` | `migrator` | app_api: USAGE ; app_worker: USAGE ; catalog_probe_owner: USAGE ; cmd_hold_owner: USAGE ; cmd_money_owner: USAGE ; guard_owner: USAGE ; host_view_owner: USAGE ; migrator: CREATE, USAGE ; policy_fn_owner: USAGE |
| `core` | `migrator` | app_api: USAGE ; app_worker: USAGE ; audit_chain_owner: USAGE ; cmd_hold_owner: USAGE ; cmd_money_owner: USAGE ; guard_owner: USAGE ; host_view_owner: USAGE ; iam_auth_owner: USAGE ; iam_staff_owner: USAGE ; integrity_owner: USAGE ; migrator: CREATE, USAGE ; policy_fn_owner: USAGE ; risk_limit_owner: USAGE |
| `platform` | `migrator` | app_api: USAGE ; app_worker: USAGE ; audit_chain_owner: USAGE ; catalog_probe_owner: USAGE ; cmd_golive_owner: USAGE ; cmd_hold_owner: USAGE ; cmd_money_owner: USAGE ; guard_owner: USAGE ; host_view_owner: USAGE ; iam_auth_owner: USAGE ; iam_staff_owner: USAGE ; integrity_owner: USAGE ; migrator: CREATE, USAGE ; policy_fn_owner: USAGE ; risk_limit_owner: USAGE |

## Tables

### `core.audit_audit_log`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `bigint` | oui | — |
| `at` | `timestamp with time zone` | oui | — |
| `actor_user_id` | `uuid` | non | — |
| `actor_role` | `text` | oui | — |
| `action_code` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `before` | `jsonb` | non | — |
| `after` | `jsonb` | non | — |
| `reason` | `text` | non | — |
| `ip_enc` | `bytea` | non | — |
| `ip_key_subject_type` | `text` | non | — |
| `ip_key_subject_id` | `uuid` | non | — |
| `c2_withheld` | `boolean` | oui | `false` |
| `request_id` | `uuid` | non | — |
| `prev_hash` | `bytea` | oui | — |
| `hash` | `bytea` | oui | — |

Contraintes :

- `audit_log_action_code_format` : `CHECK (action_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `audit_log_actor_role_format` : `CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `audit_log_after_object` : `CHECK (jsonb_typeof(after) = 'object'::text)`
- `audit_log_before_object` : `CHECK (jsonb_typeof(before) = 'object'::text)`
- `audit_log_hash_size` : `CHECK (octet_length(hash) = 32)`
- `audit_log_ip_envelope` : `CHECK (octet_length(ip_enc) >= 29 AND SUBSTRING(ip_enc FROM 1 FOR 1) = decode('01'::text, 'hex'::text))`
- `audit_log_ip_key_complete` : `CHECK ((ip_enc IS NULL) = (ip_key_subject_type IS NULL) AND (ip_key_subject_type IS NULL) = (ip_key_subject_id IS NULL))`
- `audit_log_ip_key_fk` : `FOREIGN KEY (ip_key_subject_type, ip_key_subject_id) REFERENCES core.audit_subject_key(subject_type, subject_id)`
- `audit_log_ip_key_is_actor` : `CHECK (ip_key_subject_type IS NULL OR ip_key_subject_type = 'USER'::text AND ip_key_subject_id = actor_user_id)`
- `audit_log_pkey` : `PRIMARY KEY (id)`
- `audit_log_prev_hash_size` : `CHECK (octet_length(prev_hash) = 32)`
- `audit_log_reason_length` : `CHECK (char_length(reason) >= 1 AND char_length(reason) <= 1000)`
- `audit_log_subject_type_format` : `CHECK (subject_type ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `audit_log_withheld_has_no_ip` : `CHECK (NOT (c2_withheld AND ip_enc IS NOT NULL))`

Index :

- `audit_log_subject_idx` : `CREATE INDEX audit_log_subject_idx ON core.audit_audit_log USING btree (subject_type, subject_id)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `(app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text]))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() IS NOT NULL))`
- `worker_select_verifier` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'audit_chain_verifier'::text))`

Déclencheurs :

- `audit_log_append_only` : `CREATE TRIGGER audit_log_append_only BEFORE DELETE OR UPDATE ON core.audit_audit_log FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('audit_log_append_only')`
- `audit_log_no_truncate` : `CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON core.audit_audit_log FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('audit_log_append_only')`
- `zz_audit_log_chain` : `CREATE TRIGGER zz_audit_log_chain BEFORE INSERT ON core.audit_audit_log FOR EACH ROW EXECUTE FUNCTION core.audit_log_chain()`

### `core.audit_chain_head`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `chain` | `text` | oui | — |
| `last_id` | `bigint` | oui | — |
| `last_hash` | `bytea` | oui | — |

Contraintes :

- `audit_chain_head_chain_valid` : `CHECK (chain = 'audit_log'::text)`
- `audit_chain_head_last_hash_size` : `CHECK (octet_length(last_hash) = 32)`
- `audit_chain_head_last_id_valid` : `CHECK (last_id >= 0)`
- `audit_chain_head_pkey` : `PRIMARY KEY (chain)`

Politiques RLS :

- `audit_chain_advance` (UPDATE, PERMISSIVE, audit_chain_owner) USING `(chain = 'audit_log'::text)` WITH CHECK `(chain = 'audit_log'::text)`
- `audit_chain_read` (SELECT, PERMISSIVE, audit_chain_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_select_verifier` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'audit_chain_verifier'::text))`

Déclencheurs :

- `audit_chain_head_guard` : `CREATE TRIGGER audit_chain_head_guard BEFORE DELETE OR UPDATE ON core.audit_chain_head FOR EACH ROW EXECUTE FUNCTION core.audit_chain_head_guard()`
- `audit_chain_head_no_truncate` : `CREATE TRIGGER audit_chain_head_no_truncate BEFORE TRUNCATE ON core.audit_chain_head FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('audit_chain_head_guard')`

### `core.audit_data_access_log`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `at` | `timestamp with time zone` | oui | `platform.now()` |
| `actor_user_id` | `uuid` | non | — |
| `actor_role` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `field_or_file` | `text` | oui | — |
| `purpose` | `text` | oui | — |
| `access_kind` | `text` | oui | — |
| `case_ref` | `text` | non | — |
| `request_id` | `uuid` | non | — |

Contraintes :

- `data_access_log_access_kind_valid` : `CHECK (access_kind = ANY (ARRAY['READ_C3'::text, 'READ_C2_SUPPORT'::text, 'BULK_EXPORT'::text, 'BREAK_GLASS'::text]))`
- `data_access_log_actor_role_format` : `CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `data_access_log_case_ref_format` : `CHECK (case_ref ~ '^[A-Za-z0-9_.:-]{1,64}$'::text)`
- `data_access_log_field_or_file_format` : `CHECK (field_or_file ~ '^[A-Za-z0-9_.:-]{1,160}$'::text)`
- `data_access_log_pkey` : `PRIMARY KEY (id)`
- `data_access_log_purpose_length` : `CHECK (char_length(purpose) >= 1 AND char_length(purpose) <= 500)`
- `data_access_log_subject_type_format` : `CHECK (subject_type ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`

Index :

- `data_access_log_subject_idx` : `CREATE INDEX data_access_log_subject_idx ON core.audit_data_access_log USING btree (subject_type, subject_id)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `(app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text]))`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() IS NOT NULL))`

Déclencheurs :

- `data_access_log_append_only` : `CREATE TRIGGER data_access_log_append_only BEFORE DELETE OR UPDATE ON core.audit_data_access_log FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('data_access_log_append_only')`
- `data_access_log_no_truncate` : `CREATE TRIGGER data_access_log_no_truncate BEFORE TRUNCATE ON core.audit_data_access_log FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('data_access_log_append_only')`

### `core.audit_file_asset`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `bucket` | `text` | oui | — |
| `storage_key` | `text` | oui | — |
| `mime` | `text` | oui | — |
| `bytes` | `bigint` | oui | — |
| `sha256` | `bytea` | oui | — |
| `uploader_user_id` | `uuid` | non | — |
| `source` | `text` | oui | — |
| `device_captured_at` | `timestamp with time zone` | non | — |
| `server_received_at` | `timestamp with time zone` | oui | `platform.now()` |
| `classification` | `text` | oui | — |
| `retention_class` | `text` | oui | — |
| `enc_subject_type` | `text` | non | — |
| `enc_subject_id` | `uuid` | non | — |
| `legal_hold_until` | `timestamp with time zone` | non | — |
| `deleted_at` | `timestamp with time zone` | non | — |

Contraintes :

- `file_asset_bucket_valid` : `CHECK (bucket = ANY (ARRAY['PUBLIC_LISTING'::text, 'PRIVATE_EVIDENCE'::text, 'KYC'::text, 'DOCUMENTS'::text, 'BRAND'::text]))`
- `file_asset_bytes_valid` : `CHECK (bytes >= 0)`
- `file_asset_classification_valid` : `CHECK (classification = ANY (ARRAY['C0'::text, 'C1'::text, 'C2'::text, 'C3'::text, 'C4'::text]))`
- `file_asset_enc_key_complete` : `CHECK ((enc_subject_type IS NULL) = (enc_subject_id IS NULL))`
- `file_asset_enc_key_fk` : `FOREIGN KEY (enc_subject_type, enc_subject_id) REFERENCES core.audit_subject_key(subject_type, subject_id)`
- `file_asset_mime_format` : `CHECK (mime ~ '^[a-z]+/[a-z0-9][a-z0-9.+-]{0,126}$'::text)`
- `file_asset_no_secret` : `CHECK (classification <> 'C4'::text)`
- `file_asset_personal_encrypted` : `CHECK ((classification <> ALL (ARRAY['C2'::text, 'C3'::text])) OR enc_subject_type IS NOT NULL)`
- `file_asset_pkey` : `PRIMARY KEY (id)`
- `file_asset_public_bucket` : `CHECK ((bucket <> ALL (ARRAY['PUBLIC_LISTING'::text, 'BRAND'::text])) OR classification = 'C0'::text AND enc_subject_type IS NULL)`
- `file_asset_retention_class_format` : `CHECK (retention_class ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `file_asset_sha256_size` : `CHECK (octet_length(sha256) = 32)`
- `file_asset_source_valid` : `CHECK (source = ANY (ARRAY['IN_APP_CAMERA'::text, 'STAFF_UPLOAD'::text, 'GENERATED'::text, 'PROVIDER'::text]))`
- `file_asset_storage_key_format` : `CHECK (storage_key ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]*$'::text AND char_length(storage_key) <= 512)`
- `file_asset_storage_unique` : `UNIQUE (bucket, storage_key)`

Index :

- `file_asset_enc_subject_idx` : `CREATE INDEX file_asset_enc_subject_idx ON core.audit_file_asset USING btree (enc_subject_type, enc_subject_id) WHERE (enc_subject_type IS NOT NULL)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `(app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text]))`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((bucket = 'BRAND'::text) AND (classification = 'C0'::text) AND (source = 'STAFF_UPLOAD'::text) AND (enc_subject_type IS NULL) AND (retention_class = 'BRAND_PUBLIC'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() IS NOT NULL))`
- `worker_select_verifier` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'evidence_verifier'::text))`

Déclencheurs :

- `file_asset_immutable` : `CREATE TRIGGER file_asset_immutable BEFORE DELETE OR UPDATE ON core.audit_file_asset FOR EACH ROW EXECUTE FUNCTION core.audit_file_asset_guard()`
- `file_asset_no_truncate` : `CREATE TRIGGER file_asset_no_truncate BEFORE TRUNCATE ON core.audit_file_asset FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('file_asset_immutable')`

### `core.audit_subject_key`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `wrapped_dek` | `bytea` | non | — |
| `kms_key_id` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `destroyed_at` | `timestamp with time zone` | non | — |
| `destroy_request_id` | `uuid` | non | — |

Contraintes :

- `subject_key_destroy_has_request` : `CHECK (destroyed_at IS NULL OR destroy_request_id IS NOT NULL)`
- `subject_key_destroyed_has_no_dek` : `CHECK ((destroyed_at IS NULL) = (wrapped_dek IS NOT NULL))`
- `subject_key_kms_key_id_format` : `CHECK (kms_key_id ~ '^[A-Za-z0-9:/_.+=-]{1,255}$'::text)`
- `subject_key_pkey` : `PRIMARY KEY (subject_type, subject_id)`
- `subject_key_type_valid` : `CHECK (subject_type = ANY (ARRAY['USER'::text, 'ORG'::text, 'PLATFORM'::text]))`
- `subject_key_wrapped_dek_size` : `CHECK (octet_length(wrapped_dek) >= 32 AND octet_length(wrapped_dek) <= 1024)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `((app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text])) AND (((subject_type = 'USER'::text) AND (subject_id = app.actor_id())) OR ((subject_type = 'ORG'::text) AND (subject_id = app.org_id()) AND app.is_org_holder())))`
- `api_select` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text])) AND (((subject_type = 'USER'::text) AND (subject_id = app.actor_id())) OR ((subject_type = 'ORG'::text) AND (subject_id = app.org_id()) AND app.is_org_holder())))`
- `audit_chain_lock` (UPDATE, PERMISSIVE, audit_chain_owner) USING `true` WITH CHECK `false`
- `audit_chain_read` (SELECT, PERMISSIVE, audit_chain_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() IS NOT NULL))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() IS NOT NULL))`

Déclencheurs :

- `subject_key_immutable` : `CREATE TRIGGER subject_key_immutable BEFORE DELETE OR UPDATE ON core.audit_subject_key FOR EACH ROW EXECUTE FUNCTION core.audit_subject_key_guard()`
- `subject_key_no_truncate` : `CREATE TRIGGER subject_key_no_truncate BEFORE TRUNCATE ON core.audit_subject_key FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('subject_key_immutable')`

### `core.booking_checkout_hold`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `guest_user_id` | `uuid` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `quote_id` | `uuid` | non | — |
| `occupancy_id` | `uuid` | oui | — |
| `kind` | `text` | oui | `'CHECKOUT'::text` |
| `status` | `text` | oui | — |
| `expires_at` | `timestamp with time zone` | oui | — |
| `payment_in_flight_until` | `timestamp with time zone` | non | — |
| `payment_attempts` | `integer` | oui | `0` |
| `expired_at` | `timestamp with time zone` | non | — |
| `release_requested_at` | `timestamp with time zone` | non | — |
| `released_at` | `timestamp with time zone` | non | — |
| `released_by` | `uuid` | non | — |
| `release_reason` | `text` | non | — |
| `review_required` | `boolean` | oui | `false` |
| `reviewed_at` | `timestamp with time zone` | non | — |
| `last_polled_at` | `timestamp with time zone` | non | — |
| `converted_trip_id` | `uuid` | non | — |
| `conversion_operation_id` | `uuid` | non | — |
| `compensated_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `booking_checkout_hold_occupancy_id_fkey` : `FOREIGN KEY (occupancy_id) REFERENCES core.booking_vehicle_occupancy(id)`
- `booking_checkout_hold_pkey` : `PRIMARY KEY (id)`
- `checkout_hold_conversion_operation_fk` : `FOREIGN KEY (conversion_operation_id) REFERENCES core.payment_payment_operation(id)`
- `checkout_hold_converted_trip_fk` : `FOREIGN KEY (converted_trip_id) REFERENCES core.booking_trip(id)`
- `checkout_hold_guest_fk` : `FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account(id)`
- `checkout_hold_occupancy_party_fk` : `FOREIGN KEY (occupancy_id, vehicle_id, org_id, country_code) REFERENCES core.booking_vehicle_occupancy(id, vehicle_id, org_id, country_code)`
- `checkout_hold_occupancy_unique` : `UNIQUE (occupancy_id)`
- `checkout_hold_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `hold_conversion_matches_disposition` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `hold_conversion_op_unique` : `UNIQUE (conversion_operation_id)`
- `hold_converted_has_trip` : `CHECK (status <> 'CONVERTED'::text OR converted_trip_id IS NOT NULL AND conversion_operation_id IS NOT NULL)`
- `hold_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `hold_kind_valid` : `CHECK (kind = 'CHECKOUT'::text)`
- `hold_payment_attempts_nonnegative` : `CHECK (payment_attempts >= 0)`
- `hold_release_reason_valid` : `CHECK (release_reason = ANY (ARRAY['GUEST_ABANDON'::text, 'PAYMENT_DECLINED'::text, 'SUPERSEDED_BY_PAID_HOLD'::text, 'REVIEW_REJECTED'::text, 'HOST_UNAVAILABLE'::text]))`
- `hold_review_before_payment` : `CHECK (NOT review_required OR reviewed_at IS NOT NULL OR (status = ANY (ARRAY['ACTIVE'::text, 'EXPIRED'::text, 'RELEASED'::text])))`
- `hold_status_valid` : `CHECK (status = ANY (ARRAY['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text, 'CONVERTED'::text, 'EXPIRED'::text, 'RELEASED'::text, 'COMPENSATED'::text]))`

Index :

- `checkout_hold_guest_status_idx` : `CREATE INDEX checkout_hold_guest_status_idx ON core.booking_checkout_hold USING btree (guest_user_id, status)`
- `checkout_hold_org_idx` : `CREATE INDEX checkout_hold_org_idx ON core.booking_checkout_hold USING btree (org_id)`
- `checkout_hold_vehicle_status_idx` : `CREATE INDEX checkout_hold_vehicle_status_idx ON core.booking_checkout_hold USING btree (vehicle_id, status)`
- `one_live_hold_per_guest_vehicle` : `CREATE UNIQUE INDEX one_live_hold_per_guest_vehicle ON core.booking_checkout_hold USING btree (guest_user_id, vehicle_id) WHERE (status = ANY (ARRAY['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text]))`

Politiques RLS :

- `cmd_hold_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()) AND (kind = 'CHECKOUT'::text) AND (status = 'ACTIVE'::text) AND ((org_id, country_code) = ( SELECT p.org_id, p.country_code FROM core.booking_vehicle_party(booking_checkout_hold.vehicle_id) p(org_id, country_code))))`
- `cmd_hold_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_hold_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'GUEST'::text) AND (status = ANY (ARRAY['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text])))` WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (status = ANY (ARRAY['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text, 'EXPIRED'::text, 'RELEASED'::text])))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `guard_read` (SELECT, PERMISSIVE, guard_owner) USING `true`
- `hold_guest_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()))`
- `hold_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR ((converted_trip_id IS NOT NULL) AND app.staff_case_covers('TRIP'::text, converted_trip_id))))`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text, 'booking_oracle'::text])))`
- `worker_update_conversion` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`
- `worker_update_expiry` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND (status = ANY (ARRAY['ACTIVE'::text, 'PAYMENT_IN_FLIGHT'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND (status = ANY (ARRAY['EXPIRED'::text, 'RELEASED'::text])))`

Déclencheurs :

- `hold_conversion_matches_disposition` : `CREATE CONSTRAINT TRIGGER hold_conversion_matches_disposition AFTER INSERT OR UPDATE OF status, converted_trip_id, conversion_operation_id ON core.booking_checkout_hold DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.booking_assert_conversion_disposition()`
- `hold_guarded_columns` : `CREATE TRIGGER hold_guarded_columns BEFORE UPDATE ON core.booking_checkout_hold FOR EACH ROW EXECUTE FUNCTION core.booking_hold_guarded_columns()`
- `hold_terminal_status` : `CREATE TRIGGER hold_terminal_status BEFORE UPDATE ON core.booking_checkout_hold FOR EACH ROW WHEN (old.status = ANY (ARRAY['CONVERTED'::text, 'COMPENSATED'::text])) EXECUTE FUNCTION core.booking_hold_terminal_guard()`
- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_checkout_hold FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_checkout_hold FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.booking_disposition_repair_log`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `operation_id` | `uuid` | oui | — |
| `attempts` | `integer` | oui | — |
| `first_failed_at` | `timestamp with time zone` | oui | — |
| `last_attempt_at` | `timestamp with time zone` | oui | — |
| `last_error` | `text` | oui | — |
| `alerted_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `booking_disposition_repair_log_pkey` : `PRIMARY KEY (operation_id)`
- `disposition_repair_attempts_positive` : `CHECK (attempts >= 1)`
- `disposition_repair_error_format` : `CHECK (last_error ~ '^[0-9A-Z]{5}(:[a-z0-9_]{1,63})?$'::text)`
- `disposition_repair_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_sweeper` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'disposition_sweeper'::text))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'disposition_sweeper'::text))`
- `worker_update_sweeper` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'disposition_sweeper'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'disposition_sweeper'::text))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_disposition_repair_log FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.booking_guest_occupancy`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `guest_user_id` | `uuid` | oui | — |
| `period` | `tstzrange` | oui | — |
| `active` | `boolean` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `booking_guest_occupancy_pkey` : `PRIMARY KEY (id)`
- `booking_guest_occupancy_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `guest_no_overlap` : `EXCLUDE USING gist (guest_user_id WITH =, period WITH &&) WHERE (active)`
- `guest_occupancy_guest_fk` : `FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account(id)`
- `guest_occupancy_trip_unique` : `UNIQUE (trip_id)`
- `period_valid` : `CHECK (period IS NOT NULL AND NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period) AND lower_inc(period) AND NOT upper_inc(period))`

Politiques RLS :

- `guard_read` (SELECT, PERMISSIVE, guard_owner) USING `true`
- `guest_occupancy_guest_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND active)`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'trip_lifecycle'::text])))`
- `worker_update_trip` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_guest_occupancy FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.booking_hold_compensation`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `hold_id` | `uuid` | oui | — |
| `reason` | `text` | oui | — |
| `operation_id` | `uuid` | oui | — |
| `action` | `text` | oui | — |
| `refund_instance_id` | `uuid` | non | — |
| `status` | `text` | oui | `'OPEN'::text` |
| `opened_at` | `timestamp with time zone` | oui | `platform.now()` |
| `closed_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `booking_hold_compensation_hold_id_fkey` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `booking_hold_compensation_pkey` : `PRIMARY KEY (id)`
- `hold_compensation_action_valid` : `CHECK (action = ANY (ARRAY['VOID'::text, 'LET_EXPIRE'::text, 'REFUND_API'::text, 'BANK_TRANSFER_REFUND'::text, 'OPS_LOOKUP'::text]))`
- `hold_compensation_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `hold_compensation_operation_unique` : `UNIQUE (operation_id)`
- `hold_compensation_reason_valid` : `CHECK (reason = ANY (ARRAY['SLOT_LOST_AFTER_EXPIRY'::text, 'SLOT_LOST_AFTER_RELEASE'::text, 'GUEST_OVERLAP'::text, 'INVARIANT_VIOLATION'::text, 'DUPLICATE_PAYMENT'::text, 'LATE_PAYMENT_AFTER_COMPENSATION'::text, 'ELIGIBILITY_CHANGED'::text, 'START_PASSED'::text, 'ORPHAN_PAYMENT'::text]))`
- `hold_compensation_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'EXECUTING'::text, 'DONE'::text, 'ESCALATED'::text]))`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (status = 'OPEN'::text))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`

Déclencheurs :

- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_hold_compensation FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_hold_compensation FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.booking_payment_disposition`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `operation_id` | `uuid` | oui | — |
| `hold_id` | `uuid` | oui | — |
| `disposition` | `text` | oui | — |
| `trip_id` | `uuid` | non | — |
| `hold_compensation_id` | `uuid` | non | — |
| `decided_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `booking_payment_disposition_hold_compensation_id_fkey` : `FOREIGN KEY (hold_compensation_id) REFERENCES core.booking_hold_compensation(id)`
- `booking_payment_disposition_hold_id_fkey` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `booking_payment_disposition_operation_id_fkey` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `booking_payment_disposition_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`
- `disposition_compensation_has_ref` : `CHECK ((disposition = 'COMPENSATION'::text) = (hold_compensation_id IS NOT NULL))`
- `disposition_conversion_has_trip` : `CHECK ((disposition = 'CONVERSION'::text) = (trip_id IS NOT NULL))`
- `disposition_matches_hold` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `payment_disposition_pkey` : `PRIMARY KEY (operation_id)`
- `payment_disposition_valid` : `CHECK (disposition = ANY (ARRAY['CONVERSION'::text, 'COMPENSATION'::text]))`

Index :

- `one_conversion_per_hold` : `CREATE UNIQUE INDEX one_conversion_per_hold ON core.booking_payment_disposition USING btree (hold_id) WHERE (disposition = 'CONVERSION'::text)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text, 'booking_oracle'::text])))`

Déclencheurs :

- `disposition_matches_hold` : `CREATE CONSTRAINT TRIGGER disposition_matches_hold AFTER INSERT ON core.booking_payment_disposition DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.booking_assert_conversion_disposition()`
- `disposition_rent_payment_only` : `CREATE TRIGGER disposition_rent_payment_only BEFORE INSERT ON core.booking_payment_disposition FOR EACH ROW EXECUTE FUNCTION core.booking_assert_rent_payment_operation()`
- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_payment_disposition FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`

### `core.booking_trip`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `public_ref` | `text` | non | — |
| `guest_user_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `listing_id` | `uuid` | non | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `timezone` | `text` | oui | — |
| `scheduled_start` | `timestamp with time zone` | oui | — |
| `scheduled_end` | `timestamp with time zone` | oui | — |
| `booked_at` | `timestamp with time zone` | oui | `platform.now()` |
| `status` | `text` | oui | — |
| `requirements_status` | `text` | oui | `'NONE'::text` |
| `payment_status` | `text` | oui | `'CONFIRMED'::text` |
| `source_hold_id` | `uuid` | non | — |
| `termination_reason` | `text` | non | — |
| `cancellation_reason` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `booking_trip_pkey` : `PRIMARY KEY (id)`
- `booking_trip_source_hold_id_fkey` : `FOREIGN KEY (source_hold_id) REFERENCES core.booking_checkout_hold(id)`
- `trip_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `trip_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `trip_guest_fk` : `FOREIGN KEY (guest_user_id) REFERENCES core.iam_user_account(id)`
- `trip_has_active_occupancy` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `trip_id_country_unique` : `UNIQUE (id, country_code)`
- `trip_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `trip_payment_status_valid` : `CHECK (payment_status = ANY (ARRAY['CONFIRMED'::text, 'REFUNDED_PARTIAL'::text, 'REFUNDED'::text]))`
- `trip_period_valid` : `CHECK (scheduled_start < scheduled_end)`
- `trip_public_ref_unique` : `UNIQUE (public_ref)`
- `trip_requirements_status_valid` : `CHECK (requirements_status = ANY (ARRAY['NONE'::text, 'PENDING'::text, 'SATISFIED'::text, 'FAILED'::text]))`
- `trip_source_hold_unique` : `UNIQUE (source_hold_id)`
- `trip_status_valid` : `CHECK (status = ANY (ARRAY['BOOKED'::text, 'CHECKIN_OPEN'::text, 'START_WINDOW_EXPIRED'::text, 'IN_PROGRESS'::text, 'OVERDUE'::text, 'RETURNED'::text, 'UNRETURNED'::text, 'TERMINATED_EARLY'::text, 'VEHICLE_LOST'::text, 'POST_TRIP'::text, 'COMPLETED'::text, 'IN_DISPUTE'::text, 'CANCELLED_BY_GUEST'::text, 'CANCELLED_BY_HOST'::text, 'CANCELLED_BY_PLATFORM'::text, 'REFUSED_AT_PICKUP'::text, 'NO_SHOW_GUEST'::text, 'NO_SHOW_HOST'::text]))`
- `trip_terminated_has_reason` : `CHECK (status <> 'TERMINATED_EARLY'::text OR termination_reason IS NOT NULL)`

Index :

- `trip_guest_idx` : `CREATE INDEX trip_guest_idx ON core.booking_trip USING btree (guest_user_id)`
- `trip_org_vehicle_idx` : `CREATE INDEX trip_org_vehicle_idx ON core.booking_trip USING btree (org_id, vehicle_id)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `host_view_read` (SELECT, PERMISSIVE, host_view_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `money_lock` (UPDATE, PERMISSIVE, cmd_money_owner) USING `true` WITH CHECK `false`
- `money_read` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `trip_guest_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'GUEST'::text) AND (guest_user_id = app.actor_id()))`
- `trip_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND app.host_covers_vehicle(vehicle_id))`
- `trip_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR app.staff_case_covers('TRIP'::text, id)))`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (status = 'BOOKED'::text))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'trip_lifecycle'::text, 'booking_oracle'::text])))`
- `worker_update_trip` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_trip FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`
- `trip_has_active_occupancy` : `CREATE CONSTRAINT TRIGGER trip_has_active_occupancy AFTER INSERT OR UPDATE OF status, vehicle_id, scheduled_start, scheduled_end ON core.booking_trip DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.booking_assert_trip_occupancy('trip_has_active_occupancy')`

### `core.booking_vehicle_occupancy`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `vehicle_id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `source` | `text` | oui | — |
| `period` | `tstzrange` | oui | — |
| `active` | `boolean` | oui | — |
| `expires_at` | `timestamp with time zone` | non | — |
| `deactivated_reason` | `text` | non | — |
| `ref_type` | `text` | non | — |
| `ref_id` | `uuid` | non | — |
| `ical_uid` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |

Contraintes :

- `booking_vehicle_occupancy_pkey` : `PRIMARY KEY (id)`
- `hold_has_ttl` : `CHECK (kind <> 'HOLD'::text OR expires_at IS NOT NULL)`
- `inactive_has_reason` : `CHECK (active OR deactivated_reason IS NOT NULL)`
- `occupancy_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `occupancy_deactivated_reason_valid` : `CHECK (deactivated_reason = ANY (ARRAY['HOLD_EXPIRED'::text, 'HOLD_RELEASED'::text, 'HOLD_COMPENSATED'::text, 'TRIP_TERMINAL'::text, 'SHORTENED'::text, 'BLOCK_REMOVED'::text]))`
- `occupancy_kind_valid` : `CHECK (kind = ANY (ARRAY['TRIP'::text, 'HOLD'::text, 'HOST_BLOCK'::text, 'BUFFER'::text]))`
- `occupancy_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `occupancy_party_unique` : `UNIQUE (id, vehicle_id, org_id, country_code)`
- `occupancy_source_valid` : `CHECK (source = ANY (ARRAY['CHECKOUT'::text, 'MANUAL'::text, 'ICAL'::text, 'SYSTEM'::text]))`
- `occupancy_trip_guard` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `occupancy_trip_ref_valid` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `occupancy_vehicle_single_org` : `EXCLUDE USING gist (vehicle_id WITH =, org_id WITH <>)`
- `period_valid` : `CHECK (period IS NOT NULL AND NOT isempty(period) AND NOT lower_inf(period) AND NOT upper_inf(period) AND lower_inc(period) AND NOT upper_inc(period))`
- `trip_has_no_ttl` : `CHECK (kind <> 'TRIP'::text OR expires_at IS NULL)`
- `trip_occupancy_has_ref` : `CHECK (kind <> 'TRIP'::text OR ref_type = 'TRIP'::text AND ref_id IS NOT NULL)`
- `vehicle_occupancy_no_overlap` : `EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active)`

Index :

- `occupancy_ical_uid_unique` : `CREATE UNIQUE INDEX occupancy_ical_uid_unique ON core.booking_vehicle_occupancy USING btree (vehicle_id, ical_uid) WHERE (source = 'ICAL'::text)`
- `occupancy_org_vehicle_idx` : `CREATE INDEX occupancy_org_vehicle_idx ON core.booking_vehicle_occupancy USING btree (org_id, vehicle_id)`
- `one_active_occupancy_per_trip` : `CREATE UNIQUE INDEX one_active_occupancy_per_trip ON core.booking_vehicle_occupancy USING btree (ref_id) WHERE ((kind = 'TRIP'::text) AND active)`

Politiques RLS :

- `cmd_block_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((kind = 'HOST_BLOCK'::text) AND (source = 'MANUAL'::text) AND active AND (expires_at IS NULL) AND (ref_type IS NULL) AND (ref_id IS NULL) AND (app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()))`
- `cmd_block_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'HOST_BLOCK'::text) AND (source = 'MANUAL'::text) AND active AND (app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()))` WITH CHECK `((kind = 'HOST_BLOCK'::text) AND (source = 'MANUAL'::text) AND (NOT active) AND (deactivated_reason = 'BLOCK_REMOVED'::text) AND (app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()))`
- `cmd_buffer_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((kind = 'BUFFER'::text) AND (source = 'SYSTEM'::text) AND active AND (expires_at IS NULL) AND (ref_type = 'TRIP'::text) AND (ref_id IS NOT NULL) AND (app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text))`
- `cmd_occ_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((kind = 'HOLD'::text) AND (source = 'CHECKOUT'::text) AND active AND (expires_at IS NOT NULL) AND (ref_type = 'HOLD'::text) AND (ref_id IS NOT NULL) AND (app.actor_kind() = 'GUEST'::text))`
- `cmd_occ_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_occ_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((kind = 'HOLD'::text) AND active AND (app.actor_kind() = 'GUEST'::text))` WITH CHECK `((kind = 'HOLD'::text) AND (NOT active) AND (app.actor_kind() = 'GUEST'::text) AND (deactivated_reason = ANY (ARRAY['HOLD_EXPIRED'::text, 'HOLD_RELEASED'::text])))`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `occupancy_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND app.host_covers_vehicle(vehicle_id))`
- `occupancy_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND app.has_staff_role('ADMIN'::text, country_code))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text, 'trip_lifecycle'::text, 'booking_oracle'::text])))`
- `worker_update_conversion` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`
- `worker_update_expiry` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND (kind = 'HOLD'::text) AND active)` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'hold_expiry'::text) AND (kind = 'HOLD'::text) AND (NOT active))`
- `worker_update_trip` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text) AND (kind = 'TRIP'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'trip_lifecycle'::text) AND (kind = 'TRIP'::text))`

Déclencheurs :

- `occupancy_trip_guard` : `CREATE CONSTRAINT TRIGGER occupancy_trip_guard AFTER DELETE OR UPDATE ON core.booking_vehicle_occupancy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (old.kind = 'TRIP'::text) EXECUTE FUNCTION core.booking_assert_trip_occupancy('occupancy_trip_guard')`
- `occupancy_trip_ref_valid` : `CREATE CONSTRAINT TRIGGER occupancy_trip_ref_valid AFTER INSERT OR UPDATE ON core.booking_vehicle_occupancy DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (new.kind = 'TRIP'::text AND new.active) EXECUTE FUNCTION core.booking_assert_trip_occupancy('occupancy_trip_ref_valid')`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_vehicle_occupancy FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.config_brand_asset`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `file_asset_id` | `uuid` | oui | — |
| `storage_key` | `text` | oui | — |
| `mime` | `text` | oui | — |
| `bytes` | `bigint` | oui | — |
| `sha256` | `bytea` | oui | — |
| `alt_text_es` | `text` | non | — |
| `alt_text_en` | `text` | non | — |
| `alt_text_fr` | `text` | non | — |
| `license_note` | `text` | oui | — |
| `uploaded_by` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `request_id` | `uuid` | oui | — |
| `alt_text_pt` | `text` | non | — |

Contraintes :

- `brand_asset_alt_all_locales` : `CHECK (COALESCE(kind = 'FONT'::text OR char_length(btrim(alt_text_es)) >= 1 AND char_length(btrim(alt_text_es)) <= 300 AND char_length(btrim(alt_text_en)) >= 1 AND char_length(btrim(alt_text_en)) <= 300 AND char_length(btrim(alt_text_fr)) >= 1 AND char_length(btrim(alt_text_fr)) <= 300 AND char_length(btrim(alt_text_pt)) >= 1 AND char_length(btrim(alt_text_pt)) <= 300, false))`
- `brand_asset_bytes_valid` : `CHECK (bytes >= 1 AND bytes <= 10485760)`
- `brand_asset_file_unique` : `UNIQUE (file_asset_id)`
- `brand_asset_kind_valid` : `CHECK (kind = ANY (ARRAY['LOGO'::text, 'FAVICON'::text, 'PWA_ICON'::text, 'HERO_IMAGE'::text, 'FONT'::text]))`
- `brand_asset_license_length` : `CHECK (char_length(btrim(license_note)) >= 3 AND char_length(btrim(license_note)) <= 1000)`
- `brand_asset_mime_valid` : `CHECK (kind = 'FONT'::text AND mime = 'font/woff2'::text OR kind <> 'FONT'::text AND (mime = ANY (ARRAY['image/png'::text, 'image/jpeg'::text, 'image/webp'::text])))`
- `brand_asset_pkey` : `PRIMARY KEY (id)`
- `brand_asset_request_unique` : `UNIQUE (request_id)`
- `brand_asset_sha256_size` : `CHECK (octet_length(sha256) = 32)`
- `brand_asset_storage_key_format` : `CHECK (storage_key ~ '^brand/[0-9a-f-]{36}$'::text)`
- `config_brand_asset_file_asset_id_fkey` : `FOREIGN KEY (file_asset_id) REFERENCES core.audit_file_asset(id)`
- `config_brand_asset_uploaded_by_fkey` : `FOREIGN KEY (uploaded_by) REFERENCES core.iam_user_account(id)`

Politiques RLS :

- `api_read_published` (SELECT, PERMISSIVE, app_api) USING `((EXISTS ( SELECT 1 FROM core.config_brand_version v WHERE ((v.status = 'PUBLISHED'::text) AND (((config_brand_asset.id = v.logo_asset_id) OR (config_brand_asset.id = v.favicon_asset_id)) OR (config_brand_asset.id = v.pwa_icon_asset_id))))) OR (EXISTS ( SELECT 1 FROM core.config_content_block b WHERE ((b.status = 'PUBLISHED'::text) AND (b.asset_id = config_brand_asset.id)))))`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `brand_asset_immutable` : `CREATE TRIGGER brand_asset_immutable BEFORE DELETE OR UPDATE ON core.config_brand_asset FOR EACH ROW EXECUTE FUNCTION core.cfg_brand_asset_guard()`
- `brand_asset_no_truncate` : `CREATE TRIGGER brand_asset_no_truncate BEFORE TRUNCATE ON core.config_brand_asset FOR EACH STATEMENT EXECUTE FUNCTION core.cfg_brand_no_truncate()`

### `core.config_brand_version`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `version_no` | `integer` | oui | — |
| `status` | `text` | oui | — |
| `brand_name` | `text` | oui | — |
| `tokens` | `jsonb` | oui | — |
| `tokens_schema_version` | `integer` | oui | — |
| `logo_asset_id` | `uuid` | non | — |
| `favicon_asset_id` | `uuid` | non | — |
| `pwa_icon_asset_id` | `uuid` | non | — |
| `email_skin` | `jsonb` | non | — |
| `whatsapp_skin` | `jsonb` | non | — |
| `contrast_check` | `jsonb` | non | — |
| `copied_from_id` | `uuid` | non | — |
| `created_by` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `published_by` | `uuid` | non | — |
| `published_at` | `timestamp with time zone` | non | — |
| `archived_at` | `timestamp with time zone` | non | — |
| `request_id` | `uuid` | oui | — |

Contraintes :

- `brand_version_archive_complete` : `CHECK ((status = 'ARCHIVED'::text) = (archived_at IS NOT NULL))`
- `brand_version_contrast_passed` : `CHECK (COALESCE(status = 'DRAFT'::text OR core.cfg_brand_contrast_valid(contrast_check) AND (contrast_check ->> 'tokensSha256'::text) = core.cfg_brand_tokens_sha256(tokens), false))`
- `brand_version_email_skin_object` : `CHECK (email_skin IS NULL OR jsonb_typeof(email_skin) = 'object'::text)`
- `brand_version_name_valid` : `CHECK (char_length(btrim(brand_name)) >= 1 AND char_length(btrim(brand_name)) <= 60 AND brand_name !~ '[[:cntrl:]<>{}]'::text)`
- `brand_version_no_positive` : `CHECK (version_no > 0)`
- `brand_version_no_unique` : `UNIQUE (version_no)`
- `brand_version_pkey` : `PRIMARY KEY (id)`
- `brand_version_publication_complete` : `CHECK ((status = 'DRAFT'::text) = (published_at IS NULL) AND (published_at IS NULL) = (published_by IS NULL))`
- `brand_version_request_unique` : `UNIQUE (request_id)`
- `brand_version_schema_positive` : `CHECK (tokens_schema_version > 0)`
- `brand_version_status_valid` : `CHECK (status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text]))`
- `brand_version_tokens_object` : `CHECK (jsonb_typeof(tokens) = 'object'::text AND octet_length(tokens::text) <= 131072)`
- `brand_version_whatsapp_skin_object` : `CHECK (whatsapp_skin IS NULL OR jsonb_typeof(whatsapp_skin) = 'object'::text)`
- `config_brand_version_copied_from_id_fkey` : `FOREIGN KEY (copied_from_id) REFERENCES core.config_brand_version(id)`
- `config_brand_version_created_by_fkey` : `FOREIGN KEY (created_by) REFERENCES core.iam_user_account(id)`
- `config_brand_version_favicon_asset_id_fkey` : `FOREIGN KEY (favicon_asset_id) REFERENCES core.config_brand_asset(id)`
- `config_brand_version_logo_asset_id_fkey` : `FOREIGN KEY (logo_asset_id) REFERENCES core.config_brand_asset(id)`
- `config_brand_version_published_by_fkey` : `FOREIGN KEY (published_by) REFERENCES core.iam_user_account(id)`
- `config_brand_version_pwa_icon_asset_id_fkey` : `FOREIGN KEY (pwa_icon_asset_id) REFERENCES core.config_brand_asset(id)`

Index :

- `brand_version_one_published` : `CREATE UNIQUE INDEX brand_version_one_published ON core.config_brand_version USING btree ((true)) WHERE (status = 'PUBLISHED'::text)`

Politiques RLS :

- `api_read_published` (SELECT, PERMISSIVE, app_api) USING `(status = 'PUBLISHED'::text)`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `(status = 'DRAFT'::text)`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text]))` WITH CHECK `(status = ANY (ARRAY['PUBLISHED'::text, 'ARCHIVED'::text]))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `brand_version_immutable` : `CREATE TRIGGER brand_version_immutable BEFORE INSERT OR DELETE OR UPDATE ON core.config_brand_version FOR EACH ROW EXECUTE FUNCTION core.cfg_brand_version_guard()`
- `brand_version_no_truncate` : `CREATE TRIGGER brand_version_no_truncate BEFORE TRUNCATE ON core.config_brand_version FOR EACH STATEMENT EXECUTE FUNCTION core.cfg_brand_no_truncate()`

### `core.config_content_block`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `block_key` | `text` | oui | — |
| `locale` | `text` | oui | — |
| `country_code` | `character(2)` | non | — |
| `version_no` | `integer` | oui | — |
| `status` | `text` | oui | — |
| `body_md` | `text` | oui | — |
| `asset_id` | `uuid` | non | — |
| `copied_from_id` | `uuid` | non | — |
| `created_by` | `uuid` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `published_by` | `uuid` | non | — |
| `published_at` | `timestamp with time zone` | non | — |
| `archived_at` | `timestamp with time zone` | non | — |
| `request_id` | `uuid` | oui | — |

Contraintes :

- `config_content_block_asset_id_fkey` : `FOREIGN KEY (asset_id) REFERENCES core.config_brand_asset(id)`
- `config_content_block_copied_from_id_fkey` : `FOREIGN KEY (copied_from_id) REFERENCES core.config_content_block(id)`
- `config_content_block_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `config_content_block_created_by_fkey` : `FOREIGN KEY (created_by) REFERENCES core.iam_user_account(id)`
- `config_content_block_published_by_fkey` : `FOREIGN KEY (published_by) REFERENCES core.iam_user_account(id)`
- `content_block_archive_complete` : `CHECK ((status = 'ARCHIVED'::text) = (archived_at IS NOT NULL))`
- `content_block_body_allowed` : `CHECK (core.cfg_brand_body_allowed(body_md))`
- `content_block_key_format` : `CHECK (block_key ~ '^[a-z][a-z0-9_]{0,39}(\.[a-z][a-z0-9_]{0,39}){1,5}$'::text AND char_length(block_key) <= 120)`
- `content_block_key_not_legal` : `CHECK (block_key !~ '^legal\.'::text)`
- `content_block_locale_valid` : `CHECK (locale = ANY (ARRAY['es'::text, 'en'::text, 'fr'::text, 'pt'::text]))`
- `content_block_pkey` : `PRIMARY KEY (id)`
- `content_block_publication_complete` : `CHECK ((status = 'DRAFT'::text) = (published_at IS NULL) AND (published_at IS NULL) = (published_by IS NULL))`
- `content_block_request_unique` : `UNIQUE (request_id, locale)`
- `content_block_status_valid` : `CHECK (status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text, 'ARCHIVED'::text]))`
- `content_block_version_positive` : `CHECK (version_no > 0)`
- `content_block_version_unique` : `UNIQUE NULLS NOT DISTINCT (block_key, country_code, version_no, locale)`

Index :

- `content_block_one_published` : `CREATE UNIQUE INDEX content_block_one_published ON core.config_content_block USING btree (block_key, locale, country_code) NULLS NOT DISTINCT WHERE (status = 'PUBLISHED'::text)`

Politiques RLS :

- `api_read_published` (SELECT, PERMISSIVE, app_api) USING `(status = 'PUBLISHED'::text)`
- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `(status = 'DRAFT'::text)`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(status = ANY (ARRAY['DRAFT'::text, 'PUBLISHED'::text]))` WITH CHECK `(status = ANY (ARRAY['PUBLISHED'::text, 'ARCHIVED'::text]))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `content_block_immutable` : `CREATE TRIGGER content_block_immutable BEFORE INSERT OR DELETE OR UPDATE ON core.config_content_block FOR EACH ROW EXECUTE FUNCTION core.cfg_content_block_guard()`
- `content_block_no_truncate` : `CREATE TRIGGER content_block_no_truncate BEFORE TRUNCATE ON core.config_content_block FOR EACH STATEMENT EXECUTE FUNCTION core.cfg_brand_no_truncate()`

### `core.config_country`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `code` | `character(2)` | oui | — |
| `currency` | `character(3)` | oui | — |
| `time_zone` | `text` | oui | — |
| `legal_locale` | `text` | oui | — |
| `default_locale` | `text` | oui | — |
| `locales` | `text[]` | oui | — |
| `names` | `jsonb` | oui | — |
| `host_tax_id_kinds` | `text[]` | oui | — |

Contraintes :

- `config_country_check` : `CHECK (legal_locale = ANY (locales))`
- `config_country_check1` : `CHECK (default_locale = ANY (locales))`
- `config_country_code_check` : `CHECK (code ~ '^[A-Z]{2}$'::text)`
- `config_country_currency_fkey` : `FOREIGN KEY (currency) REFERENCES core.config_currency(code)`
- `config_country_locales_check` : `CHECK (cardinality(locales) > 0)`
- `config_country_names_check` : `CHECK (jsonb_typeof(names) = 'object'::text)`
- `config_country_pkey` : `PRIMARY KEY (code)`
- `config_country_time_zone_check` : `CHECK (time_zone <> ''::text)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_limit_select` (SELECT, PERMISSIVE, risk_limit_owner) USING `true`

Déclencheurs :

- `config_country_guard` : `CREATE TRIGGER config_country_guard BEFORE DELETE OR UPDATE ON core.config_country FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `config_country_no_truncate` : `CREATE TRIGGER config_country_no_truncate BEFORE TRUNCATE ON core.config_country FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_currency`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `code` | `character(3)` | oui | — |
| `exponent` | `smallint` | oui | — |

Contraintes :

- `config_currency_code_check` : `CHECK (code ~ '^[A-Z]{3}$'::text)`
- `config_currency_exponent_check` : `CHECK (exponent >= 0 AND exponent <= 18)`
- `config_currency_pkey` : `PRIMARY KEY (code)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `config_currency_guard` : `CREATE TRIGGER config_currency_guard BEFORE DELETE OR UPDATE ON core.config_currency FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `config_currency_no_truncate` : `CREATE TRIGGER config_currency_no_truncate BEFORE TRUNCATE ON core.config_currency FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_holiday_calendar`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `country_code` | `character(2)` | oui | — |
| `date` | `date` | oui | — |
| `name` | `text` | oui | — |
| `version` | `integer` | oui | — |

Contraintes :

- `config_holiday_calendar_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `config_holiday_calendar_name_check` : `CHECK (name <> ''::text)`
- `config_holiday_calendar_pkey` : `PRIMARY KEY (country_code, date, version)`
- `config_holiday_calendar_version_check` : `CHECK (version > 0)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `config_holiday_calendar_guard` : `CREATE TRIGGER config_holiday_calendar_guard BEFORE DELETE OR UPDATE ON core.config_holiday_calendar FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `config_holiday_calendar_no_truncate` : `CREATE TRIGGER config_holiday_calendar_no_truncate BEFORE TRUNCATE ON core.config_holiday_calendar FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_param_definition`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `key` | `text` | oui | — |
| `type` | `text` | oui | — |
| `unit` | `text` | non | — |
| `allowed_scopes` | `text[]` | oui | — |
| `currency_bound` | `boolean` | oui | `false` |
| `fail_mode` | `text` | oui | — |
| `optional` | `boolean` | oui | `false` |
| `go_live_switch` | `boolean` | oui | `false` |
| `not_applicable_in` | `text[]` | oui | `'{}'::text[]` |
| `allowed_values` | `text[]` | non | — |
| `source_ref` | `text` | oui | — |
| `status` | `text` | oui | — |

Contraintes :

- `config_param_definition_allowed_scopes_check` : `CHECK (cardinality(allowed_scopes) > 0 AND allowed_scopes <@ ARRAY['NETWORK'::text, 'PSP'::text, 'ORG'::text, 'CATEGORY'::text, 'COUNTRY'::text])`
- `config_param_definition_check` : `CHECK (fail_mode <> 'FALSE'::text OR type = 'BOOL'::text)`
- `config_param_definition_check1` : `CHECK (fail_mode <> 'ZERO'::text OR (type = ANY (ARRAY['INT'::text, 'DURATION'::text, 'MONEY'::text, 'BPS'::text])))`
- `config_param_definition_check2` : `CHECK (NOT currency_bound OR (type = ANY (ARRAY['MONEY'::text, 'JSON'::text])))`
- `config_param_definition_check3` : `CHECK ((type = 'ENUM'::text) = (allowed_values IS NOT NULL AND cardinality(allowed_values) > 0))`
- `config_param_definition_check4` : `CHECK (NOT go_live_switch OR type = 'BOOL'::text AND fail_mode = 'FALSE'::text AND allowed_scopes = ARRAY['COUNTRY'::text] AND NOT optional)`
- `config_param_definition_fail_mode_check` : `CHECK (fail_mode = ANY (ARRAY['BLOCK'::text, 'FALSE'::text, 'ZERO'::text]))`
- `config_param_definition_key_check` : `CHECK (key ~ '^[a-z][a-z0-9_]*$'::text)`
- `config_param_definition_pkey` : `PRIMARY KEY (key)`
- `config_param_definition_type_check` : `CHECK (type = ANY (ARRAY['INT'::text, 'BOOL'::text, 'DURATION'::text, 'MONEY'::text, 'BPS'::text, 'ENUM'::text, 'JSON'::text]))`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `config_param_definition_guard` : `CREATE TRIGGER config_param_definition_guard BEFORE DELETE OR UPDATE ON core.config_param_definition FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `config_param_definition_no_truncate` : `CREATE TRIGGER config_param_definition_no_truncate BEFORE TRUNCATE ON core.config_param_definition FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.config_param_value`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `gen_random_uuid()` |
| `key` | `text` | oui | — |
| `country_code` | `character(2)` | oui | — |
| `scope_type` | `text` | oui | — |
| `scope_id` | `text` | non | — |
| `network` | `text` | non | — |
| `currency` | `character(3)` | non | — |
| `value` | `jsonb` | oui | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `valid_to` | `timestamp with time zone` | non | — |
| `approved_by` | `uuid` | non | — |
| `decision_ref` | `text` | non | — |
| `change_reason` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `name` | oui | `CURRENT_USER` |

Contraintes :

- `config_param_value_change_reason_check` : `CHECK (change_reason <> ''::text)`
- `config_param_value_check` : `CHECK (valid_to IS NULL OR valid_to > valid_from)`
- `config_param_value_check1` : `CHECK ((scope_type = ANY (ARRAY['COUNTRY'::text, 'NETWORK'::text])) = (scope_id IS NULL))`
- `config_param_value_check2` : `CHECK ((scope_type = 'NETWORK'::text) = (network IS NOT NULL))`
- `config_param_value_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `config_param_value_currency_fkey` : `FOREIGN KEY (currency) REFERENCES core.config_currency(code)`
- `config_param_value_key_country_code_scope_type_scope_id_net_key` : `UNIQUE NULLS NOT DISTINCT (key, country_code, scope_type, scope_id, network, valid_from)`
- `config_param_value_key_fkey` : `FOREIGN KEY (key) REFERENCES core.config_param_definition(key)`
- `config_param_value_pkey` : `PRIMARY KEY (id)`
- `config_param_value_scope_type_check` : `CHECK (scope_type = ANY (ARRAY['NETWORK'::text, 'PSP'::text, 'ORG'::text, 'CATEGORY'::text, 'COUNTRY'::text]))`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `(key = ANY (ARRAY['buffer_minutes'::text, 'hold_ttl_minutes'::text, 'hold_max_total_minutes'::text, 'max_active_holds_per_guest'::text, 'hold_creations_per_guest_vehicle_hour'::text, 'sweep_grace_s'::text, 'flagged_booking_payment_order'::text, 'review_hold_minutes'::text, 'payment_in_flight_margin_s'::text, 'psp_call_timeout_s'::text, 'conversion_start_tolerance_minutes'::text, 'payment_attempts_per_hold'::text]))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `config_param_value_guard` : `CREATE TRIGGER config_param_value_guard BEFORE INSERT OR DELETE OR UPDATE ON core.config_param_value FOR EACH ROW EXECUTE FUNCTION core.config_param_value_guard()`
- `config_param_value_no_truncate` : `CREATE TRIGGER config_param_value_no_truncate BEFORE TRUNCATE ON core.config_param_value FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.finance_legal_entity`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `gen_random_uuid()` |
| `country_code` | `character(2)` | oui | — |
| `name` | `text` | oui | — |
| `country_of_incorporation` | `character(2)` | oui | — |
| `tax_id` | `text` | oui | — |
| `invoicing_regime` | `text` | oui | — |

Contraintes :

- `finance_legal_entity_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `finance_legal_entity_country_code_key` : `UNIQUE (country_code)`
- `finance_legal_entity_country_of_incorporation_check` : `CHECK (country_of_incorporation ~ '^[A-Z]{2}$'::text)`
- `finance_legal_entity_invoicing_regime_check` : `CHECK (invoicing_regime ~ '^[A-Z][A-Z0-9_]*$'::text)`
- `finance_legal_entity_name_check` : `CHECK (name <> ''::text)`
- `finance_legal_entity_pkey` : `PRIMARY KEY (id)`
- `finance_legal_entity_tax_id_check` : `CHECK (tax_id <> ''::text)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `finance_legal_entity_guard` : `CREATE TRIGGER finance_legal_entity_guard BEFORE DELETE OR UPDATE ON core.finance_legal_entity FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `finance_legal_entity_no_truncate` : `CREATE TRIGGER finance_legal_entity_no_truncate BEFORE TRUNCATE ON core.finance_legal_entity FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.iam_auth_factor`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `secret_ref` | `text` | oui | — |
| `enabled_at` | `timestamp with time zone` | non | — |
| `disabled_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |
| `last_used_step` | `bigint` | non | — |
| `failed_attempts` | `integer` | oui | `0` |
| `locked_until` | `timestamp with time zone` | non | — |
| `enrollment_code_hash` | `bytea` | non | — |
| `enrollment_expires_at` | `timestamp with time zone` | non | — |

Contraintes :

- `auth_factor_enrollment_complete` : `CHECK ((enrollment_code_hash IS NULL) = (enrollment_expires_at IS NULL))`
- `auth_factor_enrollment_sha256` : `CHECK (enrollment_code_hash IS NULL OR octet_length(enrollment_code_hash) = 32)`
- `auth_factor_failed_nonneg` : `CHECK (failed_attempts >= 0)`
- `auth_factor_kind_valid` : `CHECK (kind = ANY (ARRAY['TOTP'::text, 'PHONE_OTP'::text]))`
- `auth_factor_secret_ref_format` : `CHECK (secret_ref ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]+$'::text AND length(secret_ref) <= 512)`
- `auth_factor_step_nonneg` : `CHECK (last_used_step IS NULL OR last_used_step >= 0)`
- `auth_factor_totp_state` : `CHECK (kind <> 'TOTP'::text OR disabled_at IS NOT NULL OR enabled_at IS NOT NULL AND enrollment_code_hash IS NULL OR enabled_at IS NULL AND enrollment_code_hash IS NOT NULL)`
- `iam_auth_factor_pkey` : `PRIMARY KEY (id)`
- `iam_auth_factor_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`

Index :

- `auth_factor_one_live_totp` : `CREATE UNIQUE INDEX auth_factor_one_live_totp ON core.iam_auth_factor USING btree (user_id) WHERE ((kind = 'TOTP'::text) AND (disabled_at IS NULL))`
- `auth_factor_user_idx` : `CREATE INDEX auth_factor_user_idx ON core.iam_auth_factor USING btree (user_id)`

Politiques RLS :

- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `((kind = 'TOTP'::text) AND (enabled_at IS NULL) AND (disabled_at IS NULL) AND (enrollment_code_hash IS NOT NULL))`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `((kind = 'TOTP'::text) AND (disabled_at IS NULL))` WITH CHECK `(kind = 'TOTP'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_auth_factor FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_email_verification`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_auth_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `email` | `text` | oui | — |
| `token_hash` | `bytea` | oui | — |
| `sent_at` | `timestamp with time zone` | oui | — |
| `expires_at` | `timestamp with time zone` | oui | — |
| `consumed_at` | `timestamp with time zone` | non | — |
| `ip` | `inet` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `email_verification_token_sha256` : `CHECK (octet_length(token_hash) = 32)`
- `email_verification_token_unique` : `UNIQUE (token_hash)`
- `email_verification_window` : `CHECK (expires_at > sent_at)`
- `iam_email_verification_pkey` : `PRIMARY KEY (id)`
- `iam_email_verification_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`

Index :

- `email_verification_user_idx` : `CREATE INDEX email_verification_user_idx ON core.iam_email_verification USING btree (user_id)`

Politiques RLS :

- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `(consumed_at IS NULL)`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_auth_update` (UPDATE, PERMISSIVE, iam_auth_owner) USING `(consumed_at IS NULL)` WITH CHECK `(consumed_at IS NOT NULL)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_email_verification FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_membership`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `role` | `text` | oui | — |
| `vehicle_scope` | `uuid[]` | oui | `'{}'::uuid[]` |
| `permission_overrides` | `text[]` | oui | `'{}'::text[]` |
| `status` | `text` | oui | `'INVITED'::text` |
| `invite_expires_at` | `timestamp with time zone` | non | — |
| `holder_ref` | `uuid` | non | `CASE WHEN (role = 'P2P_HOST'::text) THEN user_id ELSE NULL::uuid END` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_membership_org_id_fkey` : `FOREIGN KEY (org_id) REFERENCES core.iam_organization(id)`
- `iam_membership_pkey` : `PRIMARY KEY (id)`
- `iam_membership_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `membership_holder_matches_org` : `FOREIGN KEY (org_id, holder_ref) REFERENCES core.iam_organization(id, holder_user_id)`
- `membership_role_valid` : `CHECK (role = ANY (ARRAY['P2P_HOST'::text, 'CO_HOST'::text]))`
- `membership_scope_cohost_only` : `CHECK (role = 'CO_HOST'::text OR cardinality(vehicle_scope) = 0)`
- `membership_scope_no_null` : `CHECK (array_position(vehicle_scope, NULL::uuid) IS NULL)`
- `membership_status_valid` : `CHECK (status = ANY (ARRAY['INVITED'::text, 'ACTIVE'::text, 'REMOVED'::text]))`
- `membership_user_org_role_unique` : `UNIQUE (user_id, org_id, role)`

Index :

- `membership_one_active_holder` : `CREATE UNIQUE INDEX membership_one_active_holder ON core.iam_membership USING btree (org_id) WHERE ((role = 'P2P_HOST'::text) AND (status = 'ACTIVE'::text))`
- `membership_user_idx` : `CREATE INDEX membership_user_idx ON core.iam_membership USING btree (user_id) WHERE (status = 'ACTIVE'::text)`

Politiques RLS :

- `membership_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (app.is_org_holder() OR ((user_id = app.actor_id()) AND (status = 'ACTIVE'::text))))`
- `membership_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (EXISTS ( SELECT 1 FROM core.iam_organization o WHERE ((o.id = iam_membership.org_id) AND (o.country_code = ANY (app.country_scope())) AND app.has_staff_role('ADMIN'::text, o.country_code)))))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_membership FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_mfa_proof_key`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `smallint` | oui | — |
| `key` | `bytea` | oui | — |
| `installed_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `mfa_proof_key_length` : `CHECK (octet_length(key) >= 32 AND octet_length(key) <= 64)`
- `mfa_proof_key_pkey` : `PRIMARY KEY (id)`
- `mfa_proof_key_single` : `CHECK (id = 1)`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.iam_organization`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `kind` | `text` | oui | `'P2P_HOST_INDIVIDUAL'::text` |
| `holder_user_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `display_name` | `text` | non | — |
| `tax_id` | `text` | non | — |
| `status` | `text` | oui | `'ONBOARDING'::text` |
| `plan_code` | `text` | non | — |
| `legal_entity_id` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_organization_holder_user_id_fkey` : `FOREIGN KEY (holder_user_id) REFERENCES core.iam_user_account(id)`
- `iam_organization_pkey` : `PRIMARY KEY (id)`
- `organization_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `organization_country_holder_unique` : `UNIQUE (country_code, holder_user_id)`
- `organization_id_country_unique` : `UNIQUE (id, country_code)`
- `organization_id_holder_unique` : `UNIQUE (id, holder_user_id)`
- `organization_kind_valid` : `CHECK (kind = 'P2P_HOST_INDIVIDUAL'::text)`
- `organization_status_valid` : `CHECK (status = ANY (ARRAY['ONBOARDING'::text, 'PENDING_ACTIVATION'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'OFFBOARDED'::text]))`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `organization_holder_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (id = app.org_id()) AND app.is_org_holder())`
- `organization_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code)))`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_organization FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_otp_challenge`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | non | — |
| `phone_e164` | `text` | non | — |
| `channel` | `text` | oui | — |
| `code_hash` | `bytea` | oui | — |
| `expires_at` | `timestamp with time zone` | oui | — |
| `attempts` | `integer` | oui | `0` |
| `locked_until` | `timestamp with time zone` | non | — |
| `purpose` | `text` | oui | — |
| `consumed_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_otp_challenge_pkey` : `PRIMARY KEY (id)`
- `iam_otp_challenge_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `otp_challenge_attempts_nonneg` : `CHECK (attempts >= 0)`
- `otp_challenge_channel_valid` : `CHECK (channel = ANY (ARRAY['WHATSAPP'::text, 'SMS'::text, 'EMAIL'::text]))`
- `otp_challenge_phone_e164` : `CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text)`
- `otp_challenge_purpose_valid` : `CHECK (purpose = ANY (ARRAY['PHONE_VERIFY'::text, 'SIGNATURE'::text, 'LOGIN'::text]))`
- `otp_challenge_target` : `CHECK (user_id IS NOT NULL OR phone_e164 IS NOT NULL)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_otp_challenge FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_restriction`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `kind` | `text` | oui | — |
| `active` | `boolean` | oui | `true` |
| `reason` | `text` | non | — |
| `source_ref` | `text` | non | — |
| `lifted_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_restriction_pkey` : `PRIMARY KEY (id)`
- `iam_restriction_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `restriction_kind_valid` : `CHECK (kind = ANY (ARRAY['UNPAID_BALANCE'::text, 'CHARGEBACK'::text, 'PAYMENT_PLAN_ACTIVE'::text, 'TS_HOLD'::text, 'KYC_REVOKED'::text, 'POLICY_VIOLATION'::text]))`
- `restriction_lifted_consistent` : `CHECK (active = (lifted_at IS NULL))`

Index :

- `restriction_user_active_idx` : `CREATE INDEX restriction_user_active_idx ON core.iam_restriction USING btree (user_id) WHERE active`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_restriction FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_role_permission`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `role` | `text` | oui | — |
| `permission_code` | `text` | oui | — |
| `scope_rule` | `text` | oui | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `valid_to` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `approved_by` | `uuid` | non | — |
| `change_reason` | `text` | oui | — |

Contraintes :

- `role_permission_code_format` : `CHECK (permission_code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'::text)`
- `role_permission_pkey` : `PRIMARY KEY (role, permission_code, valid_from)`
- `role_permission_role_valid` : `CHECK (role = ANY (ARRAY['GUEST'::text, 'P2P_HOST'::text, 'CO_HOST'::text, 'SUPPORT_AGENT'::text, 'OPS_AGENT'::text, 'FINANCE'::text, 'ADMIN'::text, 'SUPERADMIN'::text]))`
- `role_permission_scope_valid` : `CHECK (scope_rule = ANY (ARRAY['ORG'::text, 'VEHICLE'::text, 'SELF'::text, 'PLATFORM'::text]))`
- `role_permission_window` : `CHECK (valid_to IS NULL OR valid_to > valid_from)`

Politiques RLS :

- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`

### `core.iam_session`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_auth_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `token_hash` | `bytea` | oui | — |
| `expires_at` | `timestamp with time zone` | oui | — |
| `ip` | `inet` | non | — |
| `user_agent` | `text` | non | — |
| `revoked_at` | `timestamp with time zone` | non | — |
| `revoked_reason` | `text` | non | — |
| `mfa_level` | `text` | oui | `'NONE'::text` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_session_pkey` : `PRIMARY KEY (id)`
- `iam_session_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `session_mfa_level_valid` : `CHECK (mfa_level = ANY (ARRAY['NONE'::text, 'OTP'::text, 'TOTP'::text]))`
- `session_revocation_complete` : `CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))`
- `session_revoked_reason_valid` : `CHECK (revoked_reason = ANY (ARRAY['LOGOUT'::text, 'LOGOUT_ALL'::text, 'ROTATED'::text, 'EMAIL_VERIFIED'::text, 'ADMIN'::text, 'PASSWORD_CHANGED'::text, 'ACCOUNT_CLOSED'::text]))`
- `session_token_sha256` : `CHECK (octet_length(token_hash) = 32)`
- `session_token_unique` : `UNIQUE (token_hash)`
- `session_user_agent_length` : `CHECK (user_agent IS NULL OR length(user_agent) <= 512)`
- `session_window` : `CHECK (expires_at > created_at)`

Index :

- `session_user_live_idx` : `CREATE INDEX session_user_live_idx ON core.iam_session USING btree (user_id) WHERE (revoked_at IS NULL)`

Politiques RLS :

- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `((revoked_at IS NULL) AND (mfa_level = 'NONE'::text))`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_auth_update` (UPDATE, PERMISSIVE, iam_auth_owner) USING `(revoked_at IS NULL)` WITH CHECK `(revoked_at IS NOT NULL)`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(revoked_at IS NULL)` WITH CHECK `(((revoked_at IS NULL) AND (mfa_level = 'TOTP'::text)) OR ((revoked_at IS NOT NULL) AND (revoked_reason = 'ADMIN'::text)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`

Déclencheurs :

- `session_guarded_columns` : `CREATE TRIGGER session_guarded_columns BEFORE UPDATE ON core.iam_session FOR EACH ROW EXECUTE FUNCTION core.iam_session_guard()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_session FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_staff_role_assignment`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `user_id` | `uuid` | oui | — |
| `role` | `text` | oui | — |
| `country_scope` | `text[]` | oui | — |
| `granted_by` | `uuid` | non | — |
| `expires_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_staff_role_assignment_granted_by_fkey` : `FOREIGN KEY (granted_by) REFERENCES core.iam_user_account(id)`
- `iam_staff_role_assignment_pkey` : `PRIMARY KEY (id)`
- `iam_staff_role_assignment_user_id_fkey` : `FOREIGN KEY (user_id) REFERENCES core.iam_user_account(id)`
- `staff_country_scope_format` : `CHECK (cardinality(country_scope) >= 1 AND array_position(country_scope, NULL::text) IS NULL AND array_to_string(country_scope, ','::text) ~ '^[A-Z]{2}(,[A-Z]{2})*$'::text)`
- `staff_no_self_grant` : `CHECK (granted_by IS NULL OR granted_by <> user_id)`
- `staff_role_valid` : `CHECK (role = ANY (ARRAY['SUPPORT_AGENT'::text, 'OPS_AGENT'::text, 'FINANCE'::text, 'ADMIN'::text, 'SUPERADMIN'::text]))`

Index :

- `staff_role_user_idx` : `CREATE INDEX staff_role_user_idx ON core.iam_staff_role_assignment USING btree (user_id)`

Politiques RLS :

- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `((expires_at IS NULL) OR (expires_at > platform.now()))` WITH CHECK `((expires_at IS NOT NULL) AND (expires_at <= platform.now()))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_staff_role_assignment FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.iam_user_account`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_auth_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `email` | `text` | oui | — |
| `email_verified_at` | `timestamp with time zone` | non | — |
| `phone_e164` | `text` | non | — |
| `phone_verified_at` | `timestamp with time zone` | non | — |
| `phone_line_type` | `text` | non | — |
| `password_hash` | `text` | non | — |
| `legal_first_name` | `text` | oui | — |
| `legal_last_name` | `text` | oui | — |
| `display_name` | `text` | non | — |
| `date_of_birth` | `date` | non | — |
| `preferred_locale` | `text` | oui | — |
| `residence_country` | `text` | non | — |
| `status` | `text` | oui | `'PENDING_EMAIL'::text` |
| `pseudonymized_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `iam_user_account_pkey` : `PRIMARY KEY (id)`
- `user_account_email_normalized` : `CHECK (email = lower(email) AND email = btrim(email) AND length(email) >= 3 AND length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'::text)`
- `user_account_email_unique` : `UNIQUE (email)`
- `user_account_legal_names_present` : `CHECK (length(btrim(legal_first_name)) >= 1 AND length(btrim(legal_first_name)) <= 100 AND length(btrim(legal_last_name)) >= 1 AND length(btrim(legal_last_name)) <= 100)`
- `user_account_locale_format` : `CHECK (preferred_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)`
- `user_account_password_hash_argon2id` : `CHECK (password_hash IS NULL OR password_hash ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'::text)`
- `user_account_phone_e164` : `CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'::text)`
- `user_account_residence_format` : `CHECK (residence_country IS NULL OR residence_country ~ '^[A-Z]{2}$'::text)`
- `user_account_status_valid` : `CHECK (status = ANY (ARRAY['PENDING_EMAIL'::text, 'ACTIVE'::text, 'RESTRICTED'::text, 'CLOSED'::text, 'BANNED'::text]))`

Index :

- `user_account_phone_verified_unique` : `CREATE UNIQUE INDEX user_account_phone_verified_unique ON core.iam_user_account USING btree (phone_e164) WHERE (phone_verified_at IS NOT NULL)`

Politiques RLS :

- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `host_view_read` (SELECT, PERMISSIVE, host_view_owner) USING `true`
- `iam_auth_insert` (INSERT, PERMISSIVE, iam_auth_owner) WITH CHECK `(status = 'PENDING_EMAIL'::text)`
- `iam_auth_select` (SELECT, PERMISSIVE, iam_auth_owner) USING `true`
- `iam_auth_update` (UPDATE, PERMISSIVE, iam_auth_owner) USING `(status = ANY (ARRAY['PENDING_EMAIL'::text, 'ACTIVE'::text, 'RESTRICTED'::text]))` WITH CHECK `((status = ANY (ARRAY['ACTIVE'::text, 'RESTRICTED'::text])) AND (email_verified_at IS NOT NULL))`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`
- `user_account_self_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text])) AND (id = app.actor_id()))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_user_account FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.ntf_notification_dispatch`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : aucun

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `event_id` | `uuid` | oui | — |
| `event_type` | `text` | oui | — |
| `country_code` | `text` | non | — |
| `correlation_id` | `uuid` | oui | — |
| `recipient_user_id` | `uuid` | oui | — |
| `recipient_role` | `text` | oui | — |
| `channel` | `text` | oui | — |
| `template_key` | `text` | oui | — |
| `template_version` | `integer` | oui | — |
| `variables` | `jsonb` | oui | `'{}'::jsonb` |
| `status` | `text` | oui | `'QUEUED'::text` |
| `attempts` | `smallint` | oui | `0` |
| `locale` | `text` | non | — |
| `provider_message_id` | `text` | non | — |
| `rendered_hash` | `bytea` | non | — |
| `last_error` | `text` | non | — |
| `fallback_of` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `notification_dispatch_attempts_range` : `CHECK (attempts >= 0 AND attempts <= 3)`
- `notification_dispatch_channel_valid` : `CHECK (channel = ANY (ARRAY['EMAIL'::text, 'SMS'::text]))`
- `notification_dispatch_country_format` : `CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'::text)`
- `notification_dispatch_error_code` : `CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{0,63}$'::text)`
- `notification_dispatch_event_type_format` : `CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'::text)`
- `notification_dispatch_hash_sha256` : `CHECK (rendered_hash IS NULL OR octet_length(rendered_hash) = 32)`
- `notification_dispatch_locale_format` : `CHECK (locale IS NULL OR locale ~ '^[a-z]{2}(-[A-Z]{2})?$'::text)`
- `notification_dispatch_not_own_fallback` : `CHECK (fallback_of IS NULL OR fallback_of <> id)`
- `notification_dispatch_provider_ref` : `CHECK (provider_message_id IS NULL OR length(provider_message_id) >= 1 AND length(provider_message_id) <= 200)`
- `notification_dispatch_role_format` : `CHECK (recipient_role ~ '^[A-Z][A-Z0-9_]{0,31}$'::text)`
- `notification_dispatch_sent_has_ref` : `CHECK ((status <> ALL (ARRAY['SENT'::text, 'DELIVERED'::text])) OR provider_message_id IS NOT NULL AND rendered_hash IS NOT NULL)`
- `notification_dispatch_status_valid` : `CHECK (status = ANY (ARRAY['QUEUED'::text, 'SENT'::text, 'DELIVERED'::text, 'FAILED'::text, 'FALLBACK_TRIGGERED'::text, 'SUPPRESSED'::text]))`
- `notification_dispatch_template_format` : `CHECK (template_key ~ '^EVT_[A-Z0-9_]{1,60}$'::text)`
- `notification_dispatch_template_version` : `CHECK (template_version >= 1)`
- `notification_dispatch_unique` : `UNIQUE (event_id, recipient_user_id, channel)`
- `notification_dispatch_variables_object` : `CHECK (jsonb_typeof(variables) = 'object'::text)`
- `ntf_notification_dispatch_fallback_of_fkey` : `FOREIGN KEY (fallback_of) REFERENCES core.ntf_notification_dispatch(id)`
- `ntf_notification_dispatch_pkey` : `PRIMARY KEY (id)`
- `ntf_notification_dispatch_recipient_user_id_fkey` : `FOREIGN KEY (recipient_user_id) REFERENCES core.iam_user_account(id)`

Index :

- `notification_dispatch_fallback_idx` : `CREATE INDEX notification_dispatch_fallback_idx ON core.ntf_notification_dispatch USING btree (fallback_of) WHERE (fallback_of IS NOT NULL)`
- `notification_dispatch_recipient_idx` : `CREATE INDEX notification_dispatch_recipient_idx ON core.ntf_notification_dispatch USING btree (recipient_user_id)`

Politiques RLS :

- `iam_auth_select_queued` (SELECT, PERMISSIVE, iam_auth_owner) USING `(status = 'QUEUED'::text)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `ntf_sender_update` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'ntf_sender'::text) AND (status = 'QUEUED'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'ntf_sender'::text))`
- `ntf_worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['ntf_dispatcher'::text, 'ntf_sender'::text])) AND (status = 'QUEUED'::text) AND (attempts = 0) AND ((fallback_of IS NULL) OR (app.worker_name() = 'ntf_sender'::text)))`
- `ntf_worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['ntf_dispatcher'::text, 'ntf_sender'::text])))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.ntf_notification_dispatch FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.outbox_dead_letter`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `consumer` | `text` | oui | — |
| `event_id` | `uuid` | non | — |
| `job_id` | `uuid` | oui | — |
| `attempts` | `integer` | oui | — |
| `last_error` | `text` | non | — |
| `parked_at` | `timestamp with time zone` | oui | `platform.now()` |
| `replayed_at` | `timestamp with time zone` | non | — |
| `replayed_by` | `uuid` | non | — |

Contraintes :

- `dead_letter_attempts_positive` : `CHECK (attempts >= 1)`
- `dead_letter_consumer_format` : `CHECK (consumer ~ '^[a-z][a-z0-9_]{0,62}$'::text)`
- `dead_letter_job_unique` : `UNIQUE (job_id)`
- `dead_letter_last_error_length` : `CHECK (length(last_error) <= 200)`
- `dead_letter_replay_shape` : `CHECK ((replayed_at IS NULL) = (replayed_by IS NULL))`
- `outbox_dead_letter_pkey` : `PRIMARY KEY (id)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_own` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (consumer = app.worker_name()))`
- `worker_select_monitor` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'bus_monitor'::text))`
- `worker_select_own` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (consumer = app.worker_name()))`

### `core.outbox_inbox_receipt`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `consumer` | `text` | oui | — |
| `event_id` | `uuid` | oui | — |
| `processed_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `inbox_receipt_consumer_format` : `CHECK (consumer ~ '^[a-z][a-z0-9_]{0,62}$'::text)`
- `inbox_receipt_pkey` : `PRIMARY KEY (consumer, event_id)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_own` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (consumer = app.worker_name()))`
- `worker_select_own` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (consumer = app.worker_name()))`

### `core.outbox_outbox_event`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `type` | `text` | oui | — |
| `schema_version` | `integer` | oui | — |
| `occurred_at` | `timestamp with time zone` | oui | `platform.now()` |
| `aggregate_type` | `text` | oui | — |
| `aggregate_id` | `uuid` | oui | — |
| `aggregate_version` | `bigint` | oui | — |
| `country_code` | `text` | non | — |
| `actor_user_id` | `uuid` | non | — |
| `actor_role` | `text` | oui | — |
| `correlation_id` | `uuid` | oui | — |
| `causation_id` | `uuid` | non | — |
| `payload` | `jsonb` | oui | — |
| `partition_key` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `published_at` | `timestamp with time zone` | non | — |
| `attempts` | `integer` | oui | `0` |
| `last_error` | `text` | non | — |

Contraintes :

- `outbox_event_actor_role_format` : `CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{0,31}$'::text)`
- `outbox_event_actor_shape` : `CHECK ((actor_role = 'SYSTEM'::text) = (actor_user_id IS NULL))`
- `outbox_event_aggregate_type_format` : `CHECK (aggregate_type ~ '^[a-z][a-z0-9_]{0,62}$'::text)`
- `outbox_event_aggregate_version_valid` : `CHECK (aggregate_version >= 0)`
- `outbox_event_attempts_valid` : `CHECK (attempts >= 0)`
- `outbox_event_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `outbox_event_last_error_length` : `CHECK (length(last_error) <= 200)`
- `outbox_event_partition_key_length` : `CHECK (length(partition_key) >= 1 AND length(partition_key) <= 200)`
- `outbox_event_payload_object` : `CHECK (jsonb_typeof(payload) = 'object'::text)`
- `outbox_event_schema_version_positive` : `CHECK (schema_version >= 1)`
- `outbox_event_type_format` : `CHECK (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'::text AND length(type) <= 120)`
- `outbox_outbox_event_pkey` : `PRIMARY KEY (id)`

Index :

- `outbox_event_unpublished_idx` : `CREATE INDEX outbox_event_unpublished_idx ON core.outbox_outbox_event USING btree (id) WHERE (published_at IS NULL)`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `(app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text]))`
- `cmd_hold_event_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((aggregate_type = 'checkout_hold'::text) AND (type = ANY (ARRAY['booking.hold.created'::text, 'booking.hold.released'::text, 'booking.hold.release_deferred'::text, 'booking.hold.payment_in_flight'::text])) AND (app.actor_kind() = 'GUEST'::text) AND (actor_role = 'GUEST'::text) AND (actor_user_id = app.actor_id()))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() IS NOT NULL))`
- `worker_select_monitor` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['bus_monitor'::text, 'ops_monitor'::text])))`
- `worker_select_relay` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'outbox_relay'::text))`
- `worker_update_relay` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'outbox_relay'::text) AND (published_at IS NULL))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'outbox_relay'::text))`

### `core.outbox_scheduled_job`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | `platform.uuid_v7()` |
| `name` | `text` | oui | — |
| `run_at` | `timestamp with time zone` | oui | `platform.now()` |
| `payload` | `jsonb` | oui | `'{}'::jsonb` |
| `singleton_key` | `text` | non | — |
| `event_id` | `uuid` | non | — |
| `state` | `text` | oui | `'CREATED'::text` |
| `attempts` | `integer` | oui | `0` |
| `max_attempts` | `integer` | oui | `5` |
| `locked_until` | `timestamp with time zone` | non | — |
| `last_error` | `text` | non | — |
| `completed_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `outbox_scheduled_job_pkey` : `PRIMARY KEY (id)`
- `scheduled_job_active_is_leased` : `CHECK ((state = 'ACTIVE'::text) = (locked_until IS NOT NULL))`
- `scheduled_job_attempts_valid` : `CHECK (attempts >= 0 AND attempts <= max_attempts)`
- `scheduled_job_completed_at` : `CHECK ((state = 'COMPLETED'::text) = (completed_at IS NOT NULL))`
- `scheduled_job_last_error_length` : `CHECK (length(last_error) <= 200)`
- `scheduled_job_max_attempts_valid` : `CHECK (max_attempts >= 1 AND max_attempts <= 25)`
- `scheduled_job_name_format` : `CHECK (name ~ '^[a-z][a-z0-9_]{0,62}$'::text)`
- `scheduled_job_payload_object` : `CHECK (jsonb_typeof(payload) = 'object'::text)`
- `scheduled_job_singleton_key_length` : `CHECK (length(singleton_key) >= 1 AND length(singleton_key) <= 200)`
- `scheduled_job_state_valid` : `CHECK (state = ANY (ARRAY['CREATED'::text, 'ACTIVE'::text, 'COMPLETED'::text, 'FAILED'::text]))`

Index :

- `scheduled_job_due_idx` : `CREATE INDEX scheduled_job_due_idx ON core.outbox_scheduled_job USING btree (name, run_at) WHERE (state = ANY (ARRAY['CREATED'::text, 'ACTIVE'::text]))`
- `scheduled_job_singleton` : `CREATE UNIQUE INDEX scheduled_job_singleton ON core.outbox_scheduled_job USING btree (name, singleton_key) WHERE ((singleton_key IS NOT NULL) AND (state = ANY (ARRAY['CREATED'::text, 'ACTIVE'::text])))`

Politiques RLS :

- `api_insert` (INSERT, PERMISSIVE, app_api) WITH CHECK `((app.actor_kind() = ANY (ARRAY['GUEST'::text, 'HOST'::text, 'STAFF'::text])) AND (state = 'CREATED'::text) AND (attempts = 0) AND (event_id IS NULL))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() IS NOT NULL) AND (state = 'CREATED'::text) AND (attempts = 0))`
- `worker_select_monitor` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'bus_monitor'::text))`
- `worker_select_own_queue` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (name = app.worker_name()))`
- `worker_update_own_queue` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (name = app.worker_name()))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (name = app.worker_name()))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.outbox_scheduled_job FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_payment_command`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `operation_kind` | `text` | oui | — |
| `idem_plain` | `text` | oui | — |
| `operation_id` | `uuid` | oui | — |
| `hold_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `status` | `text` | oui | `'PENDING'::text` |
| `next_attempt_at` | `timestamp with time zone` | oui | `platform.now()` |
| `attempts` | `integer` | oui | `0` |
| `last_error` | `text` | non | — |
| `partition_key` | `text` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `payment_command_attempts_nonnegative` : `CHECK (attempts >= 0)`
- `payment_command_cancel_key` : `CHECK (operation_kind <> 'CANCEL_ORDER'::text OR idem_plain = (((('hold:'::text \|\| hold_id::text) \|\| ':CANCEL:'::text) \|\| operation_id::text) \|\| ':a1'::text))`
- `payment_command_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payment_command_hold_fk` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `payment_command_idem_unique` : `UNIQUE (idem_plain)`
- `payment_command_kind_valid` : `CHECK (operation_kind = 'CANCEL_ORDER'::text)`
- `payment_command_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `payment_command_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'IN_FLIGHT'::text, 'DONE'::text, 'UNKNOWN'::text, 'ABANDONED'::text]))`
- `payment_payment_command_pkey` : `PRIMARY KEY (id)`

Index :

- `payment_command_due_idx` : `CREATE INDEX payment_command_due_idx ON core.payment_payment_command USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['PENDING'::text, 'UNKNOWN'::text]))`
- `payment_command_hold_idx` : `CREATE INDEX payment_command_hold_idx ON core.payment_payment_command USING btree (hold_id)`

Politiques RLS :

- `cmd_hold_command_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (operation_kind = 'CANCEL_ORDER'::text) AND (status = 'PENDING'::text) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_command.hold_id) AND (h.guest_user_id = app.actor_id())))) AND (EXISTS ( SELECT 1 FROM core.payment_payment_operation o WHERE ((o.id = payment_payment_command.operation_id) AND (o.hold_id = payment_payment_command.hold_id)))))`
- `cmd_hold_command_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_conversion` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])) AND (operation_kind = 'CANCEL_ORDER'::text) AND (status = 'PENDING'::text))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text])))`
- `worker_update_command` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`

Déclencheurs :

- `no_delete` : `CREATE TRIGGER no_delete BEFORE DELETE ON core.payment_payment_command FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_payment_command FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_payment_operation`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `hold_id` | `uuid` | non | — |
| `trip_id` | `uuid` | non | — |
| `country_code` | `text` | oui | — |
| `provider` | `text` | oui | — |
| `method` | `text` | non | — |
| `kind` | `text` | oui | — |
| `purpose` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `currency` | `text` | oui | — |
| `attempt_no` | `integer` | oui | — |
| `status` | `text` | oui | — |
| `idem_plain` | `text` | oui | — |
| `idem_sent` | `text` | oui | — |
| `provider_reference` | `text` | non | — |
| `proof_type` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |
| `psp_account_id` | `uuid` | oui | — |

Contraintes :

- `payment_operation_amount_positive` : `CHECK (amount_minor > 0)`
- `payment_operation_attempt_positive` : `CHECK (attempt_no >= 1)`
- `payment_operation_auth_capture_purpose` : `CHECK ((kind <> ALL (ARRAY['AUTH'::text, 'CAPTURE'::text])) OR (purpose = ANY (ARRAY['RENT'::text, 'RENT_SHORTFALL'::text])))`
- `payment_operation_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payment_operation_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `payment_operation_deposit_kind` : `CHECK ((kind = ANY (ARRAY['DEPOSIT_AUTH'::text, 'DEPOSIT_CAPTURE'::text, 'DEPOSIT_VOID'::text])) = (purpose = 'DEPOSIT'::text))`
- `payment_operation_has_subject` : `CHECK (trip_id IS NOT NULL OR hold_id IS NOT NULL)`
- `payment_operation_idem_plain_unique` : `UNIQUE (idem_plain)`
- `payment_operation_kind_valid` : `CHECK (kind = ANY (ARRAY['AUTH'::text, 'CAPTURE'::text, 'VOID'::text, 'REFUND'::text, 'MIT_CHARGE'::text, 'DEBT_COLLECTION'::text, 'CREDIT_REDEMPTION'::text, 'CREDIT_REISSUE'::text, 'CHARGEBACK'::text, 'CHARGEBACK_REVERSAL'::text, 'DEPOSIT_AUTH'::text, 'DEPOSIT_CAPTURE'::text, 'DEPOSIT_VOID'::text, 'LEG_REALLOCATION'::text, 'LEG_RELEASE'::text]))`
- `payment_operation_legs_check` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `payment_operation_mit_purpose` : `CHECK (kind <> 'MIT_CHARGE'::text OR (purpose = ANY (ARRAY['RENT_SHORTFALL'::text, 'NO_SHOW_RETENTION'::text, 'INCIDENTAL'::text, 'DAMAGE'::text, 'OTHER_DEBT'::text])))`
- `payment_operation_proof_type_valid` : `CHECK (proof_type = ANY (ARRAY['WEBHOOK_SIGNED'::text, 'POLL'::text]))`
- `payment_operation_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `payment_operation_psp_account_fk` : `FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account(id)`
- `payment_operation_purpose_valid` : `CHECK (purpose = ANY (ARRAY['RENT'::text, 'RENT_SHORTFALL'::text, 'NO_SHOW_RETENTION'::text, 'DEPOSIT'::text, 'INCIDENTAL'::text, 'DAMAGE'::text, 'OTHER_DEBT'::text]))`
- `payment_operation_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'SUBMITTED'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'UNKNOWN'::text]))`
- `payment_payment_operation_hold_id_fkey` : `FOREIGN KEY (hold_id) REFERENCES core.booking_checkout_hold(id)`
- `payment_payment_operation_pkey` : `PRIMARY KEY (id)`
- `payment_payment_operation_trip_id_fkey` : `FOREIGN KEY (trip_id) REFERENCES core.booking_trip(id)`

Index :

- `payment_operation_hold_idx` : `CREATE INDEX payment_operation_hold_idx ON core.payment_payment_operation USING btree (hold_id) WHERE (hold_id IS NOT NULL)`
- `payment_operation_provider_reference_unique` : `CREATE UNIQUE INDEX payment_operation_provider_reference_unique ON core.payment_payment_operation USING btree (psp_account_id, provider_reference) WHERE (provider_reference IS NOT NULL)`
- `payment_operation_trip_idx` : `CREATE INDEX payment_operation_trip_idx ON core.payment_payment_operation USING btree (trip_id) WHERE (trip_id IS NOT NULL)`

Politiques RLS :

- `cmd_hold_pay_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (purpose = 'RENT'::text) AND (kind = 'CAPTURE'::text) AND (status = 'PENDING'::text) AND (trip_id IS NULL) AND (psp_account_id IS NOT NULL) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.guest_user_id = app.actor_id()) AND (h.status = 'PAYMENT_IN_FLIGHT'::text)))))`
- `cmd_hold_pay_upd` (UPDATE, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'GUEST'::text) AND (purpose = 'RENT'::text) AND (status = 'PENDING'::text) AND (EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.guest_user_id = app.actor_id())))))` WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (status = 'SUBMITTED'::text))`
- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (status = 'PENDING'::text) AND (psp_account_id IS NOT NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])) AND (psp_account_id IS NOT NULL))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (psp_account_id IS NOT NULL))`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `operation_guest_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'GUEST'::text) AND ((EXISTS ( SELECT 1 FROM core.booking_checkout_hold h WHERE ((h.id = payment_payment_operation.hold_id) AND (h.guest_user_id = app.actor_id())))) OR (EXISTS ( SELECT 1 FROM core.booking_trip t WHERE (t.id = payment_payment_operation.trip_id)))))`
- `operation_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR ((trip_id IS NOT NULL) AND app.staff_case_covers('TRIP'::text, trip_id))))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'hold_expiry'::text, 'webhook_ingest'::text, 'booking_oracle'::text, 'ops_monitor'::text])))`
- `worker_select_payment_command` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `worker_update_status` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'webhook_ingest'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'webhook_ingest'::text])))`

Déclencheurs :

- `payment_operation_legs_check` : `CREATE CONSTRAINT TRIGGER payment_operation_legs_check AFTER INSERT ON core.payment_payment_operation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.payment_assert_operation_legs()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_payment_operation FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_payment_operation_event`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `operation_id` | `uuid` | oui | — |
| `status` | `text` | oui | — |
| `source` | `text` | oui | — |
| `outcome` | `text` | oui | — |
| `raw_ref` | `uuid` | non | — |
| `at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `payment_operation_event_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `payment_operation_event_outcome_valid` : `CHECK (outcome = ANY (ARRAY['APPLIED'::text, 'DUPLICATE'::text, 'STALE'::text, 'CONFLICT'::text]))`
- `payment_operation_event_raw_ref_fk` : `FOREIGN KEY (raw_ref) REFERENCES core.payment_webhook_inbox(id)`
- `payment_operation_event_source_valid` : `CHECK (source = ANY (ARRAY['API_RESPONSE'::text, 'WEBHOOK'::text, 'POLL'::text, 'MANUAL_OPS'::text]))`
- `payment_operation_event_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'SUBMITTED'::text, 'SUCCEEDED'::text, 'FAILED'::text, 'UNKNOWN'::text]))`
- `payment_payment_operation_event_pkey` : `PRIMARY KEY (id)`

Index :

- `payment_operation_event_operation_idx` : `CREATE INDEX payment_operation_event_operation_idx ON core.payment_payment_operation_event USING btree (operation_id, at)`

Politiques RLS :

- `cmd_hold_opevent_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (source = 'API_RESPONSE'::text) AND (raw_ref IS NULL) AND (status = 'SUBMITTED'::text) AND (outcome = 'APPLIED'::text) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_checkout_hold h ON ((h.id = o.hold_id))) WHERE ((o.id = payment_payment_operation_event.operation_id) AND (o.purpose = 'RENT'::text) AND (h.guest_user_id = app.actor_id())))))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])))`
- `worker_select_disposition` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['disposition_sweeper'::text, 'booking_oracle'::text])))`

### `core.payment_payment_operation_leg`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; integrity_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `operation_id` | `uuid` | oui | — |
| `leg` | `text` | oui | — |
| `org_id` | `uuid` | non | — |
| `trip_id` | `uuid` | non | — |
| `country_code` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `beneficiary_ref` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `payment_operation_leg_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `payment_operation_leg_name` : `CHECK (leg = ANY (ARRAY['HOST'::text, 'INSURER'::text, 'TAX_THIRD_PARTY'::text, 'PLATFORM'::text]))`
- `payment_operation_leg_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `payment_operation_leg_pkey` : `PRIMARY KEY (operation_id, leg)`
- `payment_operation_legs_check` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`

Politiques RLS :

- `cmd_hold_leg_ins` (INSERT, PERMISSIVE, cmd_hold_owner) WITH CHECK `((app.actor_kind() = 'GUEST'::text) AND (trip_id IS NULL) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_checkout_hold h ON ((h.id = o.hold_id))) WHERE ((o.id = payment_payment_operation_leg.operation_id) AND (o.status = 'PENDING'::text) AND (o.purpose = 'RENT'::text) AND (h.guest_user_id = app.actor_id())))))`
- `cmd_hold_leg_sel` (SELECT, PERMISSIVE, cmd_hold_owner) USING `((app.actor_kind() = 'GUEST'::text) AND (EXISTS ( SELECT 1 FROM (core.payment_payment_operation o JOIN core.booking_checkout_hold h ON ((h.id = o.hold_id))) WHERE ((o.id = payment_payment_operation_leg.operation_id) AND (h.guest_user_id = app.actor_id())))))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `integrity_read` (SELECT, PERMISSIVE, integrity_owner) USING `true`
- `leg_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (leg = 'HOST'::text) AND app.is_org_holder() AND (app.vehicle_scope() IS NULL) AND app.has_permission('finance.read_org_statements'::text))`
- `leg_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR ((trip_id IS NOT NULL) AND app.staff_case_covers('TRIP'::text, trip_id))))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'webhook_ingest'::text])))`
- `worker_select_conversion` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text])))`

Déclencheurs :

- `payment_operation_legs_check` : `CREATE CONSTRAINT TRIGGER payment_operation_legs_check AFTER INSERT ON core.payment_payment_operation_leg DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.payment_assert_operation_legs()`

### `core.payment_psp_account`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `provider` | `text` | oui | — |
| `owner_type` | `text` | oui | `'PLATFORM'::text` |
| `country_code` | `text` | oui | — |
| `environment` | `text` | oui | — |
| `collection_mode` | `text` | oui | `'SPLIT_AT_SOURCE'::text` |
| `credentials_ref` | `text` | non | — |
| `webhook_secret_ref` | `text` | non | — |
| `public_webhook_id` | `text` | oui | — |
| `status` | `text` | oui | `'PENDING_VALIDATION'::text` |
| `gate_decision_ref` | `text` | non | — |
| `last_webhook_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `payment_psp_account_pkey` : `PRIMARY KEY (id)`
- `psp_account_collection_mode_valid` : `CHECK (collection_mode = ANY (ARRAY['SPLIT_AT_SOURCE'::text, 'PLATFORM_MOR'::text]))`
- `psp_account_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `psp_account_credentials_ref_format` : `CHECK (credentials_ref ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]{1,255}$'::text)`
- `psp_account_environment_valid` : `CHECK (environment = ANY (ARRAY['SANDBOX'::text, 'LIVE'::text]))`
- `psp_account_fake_sandbox_only` : `CHECK (provider <> 'FAKE'::text OR environment = 'SANDBOX'::text)`
- `psp_account_live_gate` : `CHECK (status <> 'ACTIVE'::text OR environment <> 'LIVE'::text OR gate_decision_ref IS NOT NULL)`
- `psp_account_owner_platform` : `CHECK (owner_type = 'PLATFORM'::text)`
- `psp_account_platform_mor_closed` : `CHECK (collection_mode <> 'PLATFORM_MOR'::text)`
- `psp_account_provider_valid` : `CHECK (provider = ANY (ARRAY['TILOPAY'::text, 'DLOCAL'::text, 'BAC'::text, 'PAGUELOFACIL'::text, 'BANCARD_VPOS'::text, 'UPAY'::text, 'EBANX'::text, 'FAKE'::text]))`
- `psp_account_public_webhook_id_format` : `CHECK (public_webhook_id ~ '^[A-Za-z0-9_-]{16,64}$'::text)`
- `psp_account_public_webhook_id_unique` : `UNIQUE (public_webhook_id)`
- `psp_account_status_valid` : `CHECK (status = ANY (ARRAY['PENDING_VALIDATION'::text, 'ACTIVE'::text, 'SUSPENDED'::text]))`
- `psp_account_webhook_secret_ref_format` : `CHECK (webhook_secret_ref ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]{1,255}$'::text)`

Index :

- `psp_account_one_active` : `CREATE UNIQUE INDEX psp_account_one_active ON core.payment_psp_account USING btree (provider, country_code, environment) WHERE (status = 'ACTIVE'::text)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `true` WITH CHECK `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `psp_account_fake_guard` : `CREATE TRIGGER psp_account_fake_guard BEFORE INSERT OR UPDATE ON core.payment_psp_account FOR EACH ROW EXECUTE FUNCTION core.payment_psp_account_fake_guard()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_psp_account FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_psp_capability`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; cmd_hold_owner: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `provider` | `text` | oui | — |
| `country_code` | `text` | oui | — |
| `method` | `text` | oui | — |
| `network` | `text` | oui | `'*'::text` |
| `capability` | `text` | oui | — |
| `value` | `jsonb` | oui | — |
| `status` | `text` | oui | — |
| `source` | `text` | oui | — |
| `validated_at` | `timestamp with time zone` | non | — |
| `valid_from` | `timestamp with time zone` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `psp_capability_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `psp_capability_method_valid` : `CHECK (method = ANY (ARRAY['*'::text, 'CARD'::text, 'YAPPY'::text, 'CLAVE'::text, 'QR'::text, 'PIX'::text, 'BANK_TRANSFER'::text]))`
- `psp_capability_name_format` : `CHECK (capability ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `psp_capability_network_valid` : `CHECK (network = ANY (ARRAY['*'::text, 'VISA'::text, 'MASTERCARD'::text, 'AMEX'::text]))`
- `psp_capability_pkey` : `PRIMARY KEY (provider, country_code, method, network, capability, valid_from)`
- `psp_capability_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `psp_capability_source_present` : `CHECK (source <> ''::text)`
- `psp_capability_status_valid` : `CHECK (status = ANY (ARRAY['VALIDATED_SANDBOX'::text, 'VALIDATED_CONTRACT'::text, 'DOCUMENTED'::text, 'UNKNOWN'::text]))`
- `psp_capability_validated_dated` : `CHECK ((status <> ALL (ARRAY['VALIDATED_SANDBOX'::text, 'VALIDATED_CONTRACT'::text])) OR validated_at IS NOT NULL)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `reference_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`

### `core.payment_psp_capability_catalog`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; cmd_hold_owner: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `capability` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `blocking` | `text` | oui | — |
| `source` | `text` | oui | — |

Contraintes :

- `payment_psp_capability_catalog_pkey` : `PRIMARY KEY (capability)`
- `psp_capability_catalog_blocking_valid` : `CHECK (blocking = ANY (ARRAY['YES'::text, 'NO'::text, 'VARIANT_A'::text]))`
- `psp_capability_catalog_kind_valid` : `CHECK (kind = ANY (ARRAY['bool'::text, 'int'::text, 'enum'::text]))`
- `psp_capability_catalog_name_format` : `CHECK (capability ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `psp_capability_catalog_source_present` : `CHECK (source <> ''::text)`

Politiques RLS :

- `cmd_hold_read` (SELECT, PERMISSIVE, cmd_hold_owner) USING `true`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `reference_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`

### `core.payment_psp_submerchant`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `psp_account_id` | `uuid` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `attempt_no` | `integer` | oui | — |
| `idem_plain` | `text` | oui | — |
| `provider_submerchant_ref` | `text` | non | — |
| `kyc_status` | `text` | oui | `'PENDING'::text` |
| `payout_currency` | `text` | oui | — |
| `activated_at` | `timestamp with time zone` | non | — |
| `suspended_reason` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `payment_psp_submerchant_pkey` : `PRIMARY KEY (id)`
- `psp_submerchant_account_fk` : `FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account(id)`
- `psp_submerchant_active_dated` : `CHECK (kyc_status <> 'ACTIVE'::text OR activated_at IS NOT NULL)`
- `psp_submerchant_active_ref` : `CHECK ((kyc_status <> ALL (ARRAY['ACTIVE'::text, 'SUSPENDED'::text])) OR provider_submerchant_ref IS NOT NULL)`
- `psp_submerchant_attempt_positive` : `CHECK (attempt_no >= 1)`
- `psp_submerchant_attempt_unique` : `UNIQUE (psp_account_id, org_id, attempt_no)`
- `psp_submerchant_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `psp_submerchant_currency_format` : `CHECK (payout_currency ~ '^[A-Z]{3}$'::text)`
- `psp_submerchant_idem_unique` : `UNIQUE (idem_plain)`
- `psp_submerchant_kyc_status_valid` : `CHECK (kyc_status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'SUSPENDED'::text, 'REJECTED'::text]))`
- `psp_submerchant_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `psp_submerchant_reason_length` : `CHECK (length(suspended_reason) >= 1 AND length(suspended_reason) <= 200)`
- `psp_submerchant_ref_format` : `CHECK (provider_submerchant_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'::text)`
- `psp_submerchant_suspended_reason` : `CHECK ((kyc_status = 'SUSPENDED'::text) = (suspended_reason IS NOT NULL))`

Index :

- `psp_submerchant_one_live` : `CREATE UNIQUE INDEX psp_submerchant_one_live ON core.payment_psp_submerchant USING btree (psp_account_id, org_id) WHERE (kyc_status <> 'REJECTED'::text)`
- `psp_submerchant_org_idx` : `CREATE INDEX psp_submerchant_org_idx ON core.payment_psp_submerchant USING btree (org_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (kyc_status = 'PENDING'::text) AND (provider_submerchant_ref IS NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `submerchant_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND app.is_org_holder())`
- `submerchant_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['payment_command'::text, 'payout'::text, 'reconciliation'::text])))`

Déclencheurs :

- `psp_submerchant_guard` : `CREATE TRIGGER psp_submerchant_guard BEFORE DELETE OR UPDATE ON core.payment_psp_submerchant FOR EACH ROW EXECUTE FUNCTION core.payment_psp_submerchant_guard()`
- `psp_submerchant_no_truncate` : `CREATE TRIGGER psp_submerchant_no_truncate BEFORE TRUNCATE ON core.payment_psp_submerchant FOR EACH STATEMENT EXECUTE FUNCTION core.payment_psp_submerchant_guard()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_psp_submerchant FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.payment_webhook_inbox`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `provider` | `text` | oui | — |
| `psp_account_id` | `uuid` | non | — |
| `provider_event_id` | `text` | non | — |
| `dedup_key` | `bytea` | oui | — |
| `received_at` | `timestamp with time zone` | oui | `platform.now()` |
| `signature_valid` | `boolean` | oui | — |
| `headers` | `jsonb` | non | — |
| `raw_body_enc` | `bytea` | non | — |
| `processing_status` | `text` | oui | `'RECEIVED'::text` |
| `processed_at` | `timestamp with time zone` | non | — |
| `error` | `text` | non | — |
| `normalized_events` | `jsonb` | non | — |
| `processing_attempts` | `integer` | oui | `0` |

Contraintes :

- `payment_webhook_inbox_pkey` : `PRIMARY KEY (id)`
- `webhook_inbox_dedup` : `UNIQUE NULLS NOT DISTINCT (provider, psp_account_id, dedup_key)`
- `webhook_inbox_no_pan` : `CHECK (NOT core.payment_text_has_pan(headers::text) AND NOT core.payment_text_has_pan(normalized_events::text) AND NOT core.payment_text_has_pan(provider_event_id))`
- `webhook_inbox_normalized_events_array` : `CHECK (normalized_events IS NULL OR jsonb_typeof(normalized_events) = 'array'::text)`
- `webhook_inbox_processing_attempts_nonneg` : `CHECK (processing_attempts >= 0)`
- `webhook_inbox_processing_status_valid` : `CHECK (processing_status = ANY (ARRAY['RECEIVED'::text, 'PROCESSED'::text, 'DUPLICATE'::text, 'QUARANTINED'::text, 'FAILED'::text, 'REJECTED_SIGNATURE'::text]))`
- `webhook_inbox_provider_format` : `CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)`
- `webhook_inbox_psp_account_fk` : `FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account(id)`

Index :

- `webhook_inbox_psp_account_idx` : `CREATE INDEX webhook_inbox_psp_account_idx ON core.payment_webhook_inbox USING btree (psp_account_id) WHERE (psp_account_id IS NOT NULL)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `(psp_account_id IS NOT NULL)`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_insert_ingest` (INSERT, PERMISSIVE, app_worker) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'webhook_ingest'::text))`
- `worker_select` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['webhook_ingest'::text, 'booking_conversion'::text, 'disposition_sweeper'::text, 'payment_intent_sweeper'::text, 'ops_monitor'::text])))`
- `worker_update_ingest` (UPDATE, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'webhook_ingest'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'webhook_ingest'::text))`

### `core.pricing_tax_line_config`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_api: SELECT ; app_worker: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `country_code` | `character(2)` | oui | — |
| `line_type` | `text` | oui | — |
| `taxable` | `boolean` | oui | — |
| `rate_group` | `text` | non | — |
| `rate_bps` | `integer` | non | — |
| `third_party` | `boolean` | oui | `false` |
| `version` | `integer` | oui | — |
| `valid_from` | `timestamp with time zone` | oui | — |

Contraintes :

- `pricing_tax_line_config_check` : `CHECK (taxable = (rate_group IS NOT NULL))`
- `pricing_tax_line_config_check1` : `CHECK (taxable = (rate_bps IS NOT NULL))`
- `pricing_tax_line_config_check2` : `CHECK (taxable OR NOT third_party)`
- `pricing_tax_line_config_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `pricing_tax_line_config_line_type_check` : `CHECK (line_type = ANY (ARRAY['TRIP_PRICE'::text, 'PROMO_PLATFORM'::text, 'PROMO_HOST'::text, 'TRIP_FEE'::text, 'PROTECTION'::text, 'EXTRAS'::text, 'ENHANCED_ROADSIDE'::text, 'ADDITIONAL_DRIVER_FEE'::text, 'YOUNG_DRIVER_FEE'::text, 'DELIVERY_FEE'::text]))`
- `pricing_tax_line_config_pkey` : `PRIMARY KEY (country_code, line_type, version)`
- `pricing_tax_line_config_rate_bps_check` : `CHECK (rate_bps >= 0 AND rate_bps <= 10000)`
- `pricing_tax_line_config_version_check` : `CHECK (version > 0)`

Politiques RLS :

- `app_read` (SELECT, PERMISSIVE, app_api, app_worker) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `pricing_tax_line_config_guard` : `CREATE TRIGGER pricing_tax_line_config_guard BEFORE DELETE OR UPDATE ON core.pricing_tax_line_config FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard()`
- `pricing_tax_line_config_insert_guard` : `CREATE TRIGGER pricing_tax_line_config_insert_guard BEFORE INSERT ON core.pricing_tax_line_config FOR EACH ROW EXECUTE FUNCTION core.config_tax_line_guard()`
- `pricing_tax_line_config_no_truncate` : `CREATE TRIGGER pricing_tax_line_config_no_truncate BEFORE TRUNCATE ON core.pricing_tax_line_config FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate()`

### `core.risk_abuse_event`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; risk_limit_owner: DELETE, SELECT

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `bigint` | oui | — |
| `kind` | `text` | oui | — |
| `scope` | `text` | oui | — |
| `key_hash` | `bytea` | oui | — |
| `country_code` | `character(2)` | non | — |
| `bucket_start` | `timestamp with time zone` | oui | — |
| `first_at` | `timestamp with time zone` | oui | — |
| `last_at` | `timestamp with time zone` | oui | — |
| `occurrences` | `integer` | oui | — |
| `signals` | `text[]` | oui | `'{}'::text[]` |

Contraintes :

- `risk_abuse_event_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `risk_abuse_event_key_size` : `CHECK (octet_length(key_hash) = 32)`
- `risk_abuse_event_kind_valid` : `CHECK (kind = ANY (ARRAY['RATE_LIMITED'::text, 'SMS_DAILY_CAP_REACHED'::text, 'BOT_SUSPECTED'::text, 'BOT_CHALLENGED'::text]))`
- `risk_abuse_event_occurrences_valid` : `CHECK (occurrences >= 1 AND occurrences <= 2000000000)`
- `risk_abuse_event_pkey` : `PRIMARY KEY (id)`
- `risk_abuse_event_scope_format` : `CHECK (scope ~ '^[a-z][a-z0-9_]{1,47}$'::text)`
- `risk_abuse_event_signals_valid` : `CHECK (signals <@ ARRAY['REGULAR_RHYTHM'::text, 'NO_BROWSER_HEADERS'::text, 'SIGNUP_BURST'::text] AND array_position(signals, NULL::text) IS NULL)`
- `risk_abuse_event_times_valid` : `CHECK (first_at <= last_at AND bucket_start <= first_at)`
- `risk_abuse_event_unique` : `UNIQUE (kind, scope, key_hash, bucket_start)`

Index :

- `risk_abuse_event_board_idx` : `CREATE INDEX risk_abuse_event_board_idx ON core.risk_abuse_event USING btree (country_code, bucket_start)`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_limit_all` (ALL, PERMISSIVE, risk_limit_owner) USING `true` WITH CHECK `true`

### `core.risk_rate_counter`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ; risk_limit_owner: DELETE, INSERT, SELECT, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `scope` | `text` | oui | — |
| `key_hash` | `bytea` | oui | — |
| `window_start` | `timestamp with time zone` | oui | — |
| `window_end` | `timestamp with time zone` | oui | — |
| `country_code` | `character(2)` | non | — |
| `hits` | `integer` | oui | — |

Contraintes :

- `risk_rate_counter_country_code_fkey` : `FOREIGN KEY (country_code) REFERENCES core.config_country(code)`
- `risk_rate_counter_hits_valid` : `CHECK (hits >= 1 AND hits <= 2000000000)`
- `risk_rate_counter_key_size` : `CHECK (octet_length(key_hash) = 32)`
- `risk_rate_counter_pkey` : `PRIMARY KEY (scope, key_hash, window_start)`
- `risk_rate_counter_scope_format` : `CHECK (scope ~ '^[a-z][a-z0-9_]{1,47}$'::text)`
- `risk_rate_counter_window_valid` : `CHECK (window_end > window_start)`

Index :

- `risk_rate_counter_window_end_idx` : `CREATE INDEX risk_rate_counter_window_end_idx ON core.risk_rate_counter USING btree (window_end)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `risk_limit_all` (ALL, PERMISSIVE, risk_limit_owner) USING `true` WITH CHECK `true`

### `core.settlement_finance_approval`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `action` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `reason` | `text` | oui | — |
| `requested_by` | `uuid` | oui | — |
| `requested_at` | `timestamp with time zone` | oui | `platform.now()` |
| `approved_by` | `uuid` | non | — |
| `approved_at` | `timestamp with time zone` | non | — |
| `status` | `text` | oui | — |

Contraintes :

- `finance_approval_action_valid` : `CHECK (action = ANY (ARRAY['DECIDE_ADVANCE'::text, 'WRITE_OFF_RECEIVABLE'::text, 'ISSUE_BORDEREAU'::text]))`
- `finance_approval_approved_at` : `CHECK ((approved_by IS NULL) = (approved_at IS NULL))`
- `finance_approval_approved_shape` : `CHECK ((status = 'APPROVED'::text) = (approved_by IS NOT NULL))`
- `finance_approval_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `finance_approval_reason_length` : `CHECK (char_length(btrim(reason)) >= 10 AND char_length(btrim(reason)) <= 1000)`
- `finance_approval_status_valid` : `CHECK (status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'EXPIRED'::text]))`
- `finance_approval_two_people` : `CHECK (approved_by IS NULL OR approved_by <> requested_by)`
- `settlement_finance_approval_approved_by_fkey` : `FOREIGN KEY (approved_by) REFERENCES core.iam_user_account(id)`
- `settlement_finance_approval_pkey` : `PRIMARY KEY (id)`
- `settlement_finance_approval_requested_by_fkey` : `FOREIGN KEY (requested_by) REFERENCES core.iam_user_account(id)`

Index :

- `finance_approval_one_pending` : `CREATE UNIQUE INDEX finance_approval_one_pending ON core.settlement_finance_approval USING btree (action, subject_id) WHERE (status = 'PENDING'::text)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = 'PENDING'::text) AND (approved_by IS NULL) AND (country_code = ANY (app.country_scope())))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'STAFF'::text) AND (status = 'PENDING'::text))` WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (status = ANY (ARRAY['APPROVED'::text, 'REJECTED'::text])) AND (country_code = ANY (app.country_scope())))`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `finance_approval_guard` : `CREATE TRIGGER finance_approval_guard BEFORE UPDATE ON core.settlement_finance_approval FOR EACH ROW EXECUTE FUNCTION core.settlement_finance_approval_guard()`
- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_finance_approval FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_finance_approval FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`

### `core.settlement_insurer_bordereau`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `insurer_id` | `uuid` | oui | — |
| `insurer_contract_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `period` | `tstzrange` | oui | — |
| `total_minor` | `bigint` | oui | — |
| `status` | `text` | oui | `'DRAFT'::text` |
| `issued_by` | `uuid` | non | — |
| `second_validated_by` | `uuid` | non | — |
| `approval_id` | `uuid` | non | — |
| `issued_at` | `timestamp with time zone` | non | — |
| `paid_at` | `timestamp with time zone` | non | — |
| `psp_release_ref` | `text` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `insurer_bordereau_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `insurer_bordereau_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `insurer_bordereau_id_country_unique` : `UNIQUE (id, country_code)`
- `insurer_bordereau_issue_pair` : `CHECK ((issued_by IS NULL) = (second_validated_by IS NULL) AND (issued_by IS NULL) = (approval_id IS NULL) AND (issued_by IS NULL) = (issued_at IS NULL) AND (issued_by IS NULL OR issued_by <> second_validated_by))`
- `insurer_bordereau_issued_shape` : `CHECK ((status = 'DRAFT'::text) = (issued_by IS NULL))`
- `insurer_bordereau_paid_shape` : `CHECK ((status = 'PAID'::text) = (paid_at IS NOT NULL))`
- `insurer_bordereau_period_nonempty` : `CHECK (NOT isempty(period))`
- `insurer_bordereau_status_valid` : `CHECK (status = ANY (ARRAY['DRAFT'::text, 'ISSUED'::text, 'PAID'::text, 'DISPUTED'::text]))`
- `insurer_bordereau_total_nonneg` : `CHECK (total_minor >= 0)`
- `settlement_insurer_bordereau_approval_id_fkey` : `FOREIGN KEY (approval_id) REFERENCES core.settlement_finance_approval(id)`
- `settlement_insurer_bordereau_issued_by_fkey` : `FOREIGN KEY (issued_by) REFERENCES core.iam_user_account(id)`
- `settlement_insurer_bordereau_pkey` : `PRIMARY KEY (id)`
- `settlement_insurer_bordereau_second_validated_by_fkey` : `FOREIGN KEY (second_validated_by) REFERENCES core.iam_user_account(id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'bordereau'::text) AND (status = 'DRAFT'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (status = 'DRAFT'::text))` WITH CHECK `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (status = 'ISSUED'::text))`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `bordereau_transition_guard` : `CREATE TRIGGER bordereau_transition_guard BEFORE UPDATE ON core.settlement_insurer_bordereau FOR EACH ROW EXECUTE FUNCTION core.settlement_insurer_bordereau_guard()`
- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_insurer_bordereau FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_insurer_bordereau FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_insurer_bordereau FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.settlement_insurer_bordereau_line`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `bordereau_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `amount_minor` | `bigint` | oui | — |

Contraintes :

- `insurer_bordereau_line_amount_nonneg` : `CHECK (amount_minor >= 0)`
- `insurer_bordereau_line_bordereau_fk` : `FOREIGN KEY (bordereau_id, country_code) REFERENCES core.settlement_insurer_bordereau(id, country_code)`
- `insurer_bordereau_line_segment_beta` : `CHECK (segment_no = 1)`
- `insurer_bordereau_line_trip_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `insurer_bordereau_line_trip_once` : `UNIQUE (trip_id, segment_no)`
- `settlement_insurer_bordereau_line_pkey` : `PRIMARY KEY (bordereau_id, trip_id, segment_no)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'bordereau'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_insurer_bordereau_line FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_insurer_bordereau_line FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE UPDATE ON core.settlement_insurer_bordereau_line FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_insurer_ledger_state`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `insurer_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `payable_minor` | `bigint` | oui | `0` |
| `frozen_minor` | `bigint` | oui | `0` |
| `receivable_minor` | `bigint` | oui | `0` |
| `next_bordereau_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `insurer_ledger_amounts_nonneg` : `CHECK (payable_minor >= 0 AND frozen_minor >= 0 AND receivable_minor >= 0)`
- `insurer_ledger_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `insurer_ledger_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `settlement_insurer_ledger_state_pkey` : `PRIMARY KEY (insurer_id, country_code, currency)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'bordereau'::text])))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'bordereau'::text])))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'bordereau'::text])))`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_insurer_ledger_state FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_insurer_ledger_state FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_insurer_ledger_state FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.settlement_leg_movement`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `operation_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `country_code` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `applied_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `leg_movement_kind_valid` : `CHECK (kind = ANY (ARRAY['CAPTURE'::text, 'MIT_CHARGE'::text, 'DEBT_COLLECTION'::text, 'REFUND'::text, 'LEG_REALLOCATION'::text, 'LEG_RELEASE'::text]))`
- `leg_movement_operation_fk` : `FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation(id)`
- `leg_movement_segment_beta` : `CHECK (segment_no = 1)`
- `leg_movement_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `settlement_leg_movement_pkey` : `PRIMARY KEY (operation_id)`

Index :

- `leg_movement_trip_idx` : `CREATE INDEX leg_movement_trip_idx ON core.settlement_leg_movement USING btree (trip_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_leg_movement FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_leg_movement FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_platform_advance`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `trip_id` | `uuid` | non | — |
| `org_id` | `uuid` | non | — |
| `insurer_id` | `uuid` | non | — |
| `cause` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `funded_from` | `text` | oui | — |
| `receivable_minor` | `bigint` | oui | `0` |
| `recovered_minor` | `bigint` | oui | `0` |
| `status` | `text` | oui | `'OPEN'::text` |
| `decided_by` | `uuid` | non | — |
| `decision_second_by` | `uuid` | non | — |
| `decision_approval_id` | `uuid` | non | — |
| `written_off_at` | `timestamp with time zone` | non | — |
| `written_off_by` | `uuid` | non | — |
| `write_off_second_by` | `uuid` | non | — |
| `write_off_approval_id` | `uuid` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `platform_advance_amount_positive` : `CHECK (amount_minor > 0)`
- `platform_advance_amounts` : `CHECK (receivable_minor >= 0 AND recovered_minor >= 0 AND recovered_minor <= receivable_minor AND receivable_minor <= amount_minor)`
- `platform_advance_cause_valid` : `CHECK (cause = ANY (ARRAY['RELEASED_LEG'::text, 'CREDIT_BEYOND_PLATFORM'::text, 'CHARGEBACK_LOSS'::text, 'HOST_COMPENSATION'::text]))`
- `platform_advance_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `platform_advance_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `platform_advance_decision_pair` : `CHECK ((decided_by IS NULL) = (decision_second_by IS NULL) AND (decided_by IS NULL) = (decision_approval_id IS NULL) AND (decided_by IS NULL OR decided_by <> decision_second_by))`
- `platform_advance_funded_from_valid` : `CHECK (funded_from = ANY (ARRAY['TRIP_PLATFORM_LEG'::text, 'COUNTRY_PLATFORM_BALANCE'::text]))`
- `platform_advance_no_receivable` : `CHECK ((cause <> ALL (ARRAY['CREDIT_BEYOND_PLATFORM'::text, 'CHARGEBACK_LOSS'::text])) OR receivable_minor = 0)`
- `platform_advance_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `platform_advance_recovered_shape` : `CHECK (status <> 'RECOVERED'::text OR recovered_minor = receivable_minor)`
- `platform_advance_released_leg` : `CHECK (cause <> 'RELEASED_LEG'::text OR receivable_minor = amount_minor AND (org_id IS NOT NULL OR insurer_id IS NOT NULL))`
- `platform_advance_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'RECOVERING'::text, 'RECOVERED'::text, 'WRITTEN_OFF'::text]))`
- `platform_advance_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `platform_advance_write_off_pair` : `CHECK ((written_off_by IS NULL) = (write_off_second_by IS NULL) AND (written_off_by IS NULL) = (write_off_approval_id IS NULL) AND (written_off_by IS NULL) = (written_off_at IS NULL) AND (written_off_by IS NULL OR written_off_by <> write_off_second_by))`
- `platform_advance_written_off_shape` : `CHECK ((status = 'WRITTEN_OFF'::text) = (written_off_by IS NOT NULL))`
- `settlement_platform_advance_decided_by_fkey` : `FOREIGN KEY (decided_by) REFERENCES core.iam_user_account(id)`
- `settlement_platform_advance_decision_approval_id_fkey` : `FOREIGN KEY (decision_approval_id) REFERENCES core.settlement_finance_approval(id)`
- `settlement_platform_advance_decision_second_by_fkey` : `FOREIGN KEY (decision_second_by) REFERENCES core.iam_user_account(id)`
- `settlement_platform_advance_pkey` : `PRIMARY KEY (id)`
- `settlement_platform_advance_write_off_approval_id_fkey` : `FOREIGN KEY (write_off_approval_id) REFERENCES core.settlement_finance_approval(id)`
- `settlement_platform_advance_write_off_second_by_fkey` : `FOREIGN KEY (write_off_second_by) REFERENCES core.iam_user_account(id)`
- `settlement_platform_advance_written_off_by_fkey` : `FOREIGN KEY (written_off_by) REFERENCES core.iam_user_account(id)`

Index :

- `platform_advance_org_idx` : `CREATE INDEX platform_advance_org_idx ON core.settlement_platform_advance USING btree (org_id) WHERE (cause = 'RELEASED_LEG'::text)`
- `platform_advance_trip_idx` : `CREATE INDEX platform_advance_trip_idx ON core.settlement_platform_advance USING btree (trip_id)`

Politiques RLS :

- `advance_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (cause = 'RELEASED_LEG'::text) AND app.is_org_holder() AND (app.vehicle_scope() IS NULL) AND app.has_permission('finance.read_org_statements'::text))`
- `cmd_advance_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `(((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payout'::text])) AND (status = ANY (ARRAY['OPEN'::text, 'RECOVERING'::text]))) OR ((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (status = ANY (ARRAY['OPEN'::text, 'RECOVERING'::text]))))` WITH CHECK `(((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payout'::text])) AND (status = ANY (ARRAY['OPEN'::text, 'RECOVERING'::text, 'RECOVERED'::text])) AND (written_off_by IS NULL)) OR ((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (status = ANY (ARRAY['OPEN'::text, 'RECOVERING'::text, 'WRITTEN_OFF'::text]))))`
- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payout'::text])) AND (status = 'OPEN'::text) AND (recovered_minor = 0) AND (decided_by IS NULL) AND (written_off_by IS NULL))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `fin_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('FINANCE'::text, country_code) OR app.has_staff_role('ADMIN'::text, country_code)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `advance_transition_guard` : `CREATE TRIGGER advance_transition_guard BEFORE UPDATE ON core.settlement_platform_advance FOR EACH ROW EXECUTE FUNCTION core.settlement_platform_advance_guard()`
- `money_no_delete` : `CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_platform_advance FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete()`
- `money_no_truncate` : `CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_platform_advance FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete()`
- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_platform_advance FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `core.settlement_settlement`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `version` | `integer` | oui | — |
| `supersedes_id` | `uuid` | non | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `kind` | `text` | oui | — |
| `engine_version` | `text` | oui | — |
| `requested_reason` | `text` | oui | — |
| `reason` | `text` | oui | — |
| `origin` | `text` | oui | — |
| `qualification` | `text` | oui | — |
| `target_state` | `text` | oui | — |
| `host_eligible` | `boolean` | oui | — |
| `total_paid_minor` | `bigint` | oui | — |
| `guest_refund_minor` | `bigint` | oui | — |
| `tax_refund_minor` | `bigint` | oui | — |
| `retained_minor` | `bigint` | oui | — |
| `retained_tax_minor` | `bigint` | oui | — |
| `host_from_guest_minor` | `bigint` | oui | — |
| `host_compensation_minor` | `bigint` | oui | — |
| `host_earnings_minor` | `bigint` | oui | — |
| `platform_net_minor` | `bigint` | oui | — |
| `host_penalty_minor` | `bigint` | oui | — |
| `negative_leg` | `boolean` | oui | — |
| `inputs` | `text` | oui | — |
| `inputs_hash` | `bytea` | oui | — |
| `param_snapshot_hash` | `bytea` | oui | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `settlement_amounts_nonneg` : `CHECK (total_paid_minor >= 0 AND guest_refund_minor >= 0 AND tax_refund_minor >= 0 AND retained_tax_minor >= 0 AND (retained_minor + retained_tax_minor) >= 0 AND host_from_guest_minor >= 0 AND host_compensation_minor >= 0 AND host_penalty_minor >= 0)`
- `settlement_balance` : `CHECK ((guest_refund_minor + retained_minor + retained_tax_minor) = total_paid_minor)`
- `settlement_balanced` : `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `settlement_country_code_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `settlement_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `settlement_earnings` : `CHECK (host_earnings_minor = (host_from_guest_minor + host_compensation_minor))`
- `settlement_engine_version_format` : `CHECK (engine_version ~ '^[a-z][a-z0-9-]{0,30}/[0-9]{1,6}$'::text)`
- `settlement_inputs_engine` : `CHECK ((inputs::jsonb ->> 'engineVersion'::text) = engine_version)`
- `settlement_inputs_hash_match` : `CHECK (sha256(convert_to(('rueda.settlement.inputs/1'::text \|\| chr(10)) \|\| inputs, 'UTF8'::name)) = inputs_hash)`
- `settlement_inputs_hash_sha256` : `CHECK (octet_length(inputs_hash) = 32)`
- `settlement_kind_valid` : `CHECK (kind = ANY (ARRAY['CANCELLATION'::text, 'TERMINATION'::text, 'COMPLETION'::text]))`
- `settlement_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `settlement_origin_format` : `CHECK (origin ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `settlement_param_hash_sha256` : `CHECK (octet_length(param_snapshot_hash) = 32)`
- `settlement_platform_net` : `CHECK (platform_net_minor = (retained_minor - host_earnings_minor))`
- `settlement_qualification_valid` : `CHECK (qualification = ANY (ARRAY['VOLUNTARY'::text, 'FAULT_PRE_START'::text, 'NO_SHOW'::text, 'FULL'::text]))`
- `settlement_reason_format` : `CHECK (reason ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `settlement_requested_reason_format` : `CHECK (requested_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `settlement_scope_unique` : `UNIQUE (id, trip_id, segment_no, org_id, country_code)`
- `settlement_segment_beta` : `CHECK (segment_no = 1)`
- `settlement_segment_unique` : `UNIQUE (id, trip_id, segment_no)`
- `settlement_settlement_pkey` : `PRIMARY KEY (id)`
- `settlement_supersedes_fk` : `FOREIGN KEY (supersedes_id, trip_id, segment_no) REFERENCES core.settlement_settlement(id, trip_id, segment_no)`
- `settlement_supersedes_unique` : `UNIQUE (supersedes_id)`
- `settlement_supersession_shape` : `CHECK ((version = 1) = (supersedes_id IS NULL))`
- `settlement_target_state_format` : `CHECK (target_state ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `settlement_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `settlement_version_positive` : `CHECK (version >= 1)`
- `settlement_version_unique` : `UNIQUE (trip_id, segment_no, version)`

Index :

- `settlement_org_idx` : `CREATE INDEX settlement_org_idx ON core.settlement_settlement USING btree (org_id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'settlement'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `settlement_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `settlement_balanced` : `CREATE CONSTRAINT TRIGGER settlement_balanced AFTER INSERT ON core.settlement_settlement DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.settlement_assert_balanced()`
- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_settlement FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_settlement_leg`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `settlement_id` | `uuid` | oui | — |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `leg` | `text` | oui | — |
| `kept_minor` | `bigint` | oui | — |
| `advance_minor` | `bigint` | oui | — |
| `basis_minor` | `bigint` | oui | — |
| `variation_minor` | `bigint` | oui | — |

Contraintes :

- `settlement_leg_advance_nonneg` : `CHECK (advance_minor >= 0)`
- `settlement_leg_advance_platform` : `CHECK (advance_minor = 0 OR leg = 'PLATFORM'::text AND kept_minor = 0)`
- `settlement_leg_kept_nonneg` : `CHECK (kept_minor >= 0)`
- `settlement_leg_settlement_fk` : `FOREIGN KEY (settlement_id, trip_id, segment_no, org_id, country_code) REFERENCES core.settlement_settlement(id, trip_id, segment_no, org_id, country_code)`
- `settlement_leg_valid` : `CHECK (leg = ANY (ARRAY['HOST'::text, 'INSURER'::text, 'TAX_THIRD_PARTY'::text, 'PLATFORM'::text]))`
- `settlement_leg_variation` : `CHECK (variation_minor = (kept_minor - advance_minor - basis_minor))`
- `settlement_settlement_leg_pkey` : `PRIMARY KEY (settlement_id, leg)`

Index :

- `settlement_leg_org_idx` : `CREATE INDEX settlement_leg_org_idx ON core.settlement_settlement_leg USING btree (org_id) WHERE (leg = 'HOST'::text)`
- `settlement_leg_trip_idx` : `CREATE INDEX settlement_leg_trip_idx ON core.settlement_settlement_leg USING btree (trip_id, segment_no)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'settlement'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `settlement_leg_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (leg = 'HOST'::text) AND app.is_org_holder() AND (app.vehicle_scope() IS NULL) AND app.has_permission('finance.read_org_statements'::text))`
- `settlement_leg_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR app.staff_case_covers('TRIP'::text, trip_id)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_settlement_leg FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement_leg FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_settlement_line`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `settlement_id` | `uuid` | oui | — |
| `line_type` | `text` | oui | — |
| `amount_minor` | `bigint` | oui | — |
| `refund_minor` | `bigint` | oui | — |
| `retained_minor` | `bigint` | oui | — |

Contraintes :

- `settlement_line_split` : `CHECK ((refund_minor + retained_minor) = amount_minor)`
- `settlement_line_type_format` : `CHECK (line_type ~ '^[a-z][A-Za-z]{0,62}$'::text)`
- `settlement_settlement_line_pkey` : `PRIMARY KEY (settlement_id, line_type)`
- `settlement_settlement_line_settlement_id_fkey` : `FOREIGN KEY (settlement_id) REFERENCES core.settlement_settlement(id)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'settlement'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `settlement_line_read` (SELECT, PERMISSIVE, app_api) USING `(EXISTS ( SELECT 1 FROM core.settlement_settlement s WHERE (s.id = settlement_settlement_line.settlement_id)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_settlement_line FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement_line FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_settlement_tax_line`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: INSERT, SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `settlement_id` | `uuid` | oui | — |
| `tax_group` | `text` | oui | — |
| `third_party` | `boolean` | oui | — |
| `tax_paid_minor` | `bigint` | oui | — |
| `tax_refund_minor` | `bigint` | oui | — |
| `retained_tax_minor` | `bigint` | oui | — |

Contraintes :

- `settlement_settlement_tax_line_pkey` : `PRIMARY KEY (settlement_id, tax_group)`
- `settlement_settlement_tax_line_settlement_id_fkey` : `FOREIGN KEY (settlement_id) REFERENCES core.settlement_settlement(id)`
- `settlement_tax_group_format` : `CHECK (tax_group ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$'::text)`
- `settlement_tax_line_nonneg` : `CHECK (tax_paid_minor >= 0 AND tax_refund_minor >= 0 AND retained_tax_minor >= 0)`
- `settlement_tax_line_split` : `CHECK ((tax_refund_minor + retained_tax_minor) = tax_paid_minor)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'settlement'::text))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `settlement_tax_line_read` (SELECT, PERMISSIVE, app_api) USING `(EXISTS ( SELECT 1 FROM core.settlement_settlement s WHERE (s.id = settlement_settlement_tax_line.settlement_id)))`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `settlement_immutable` : `CREATE TRIGGER settlement_immutable BEFORE DELETE OR UPDATE ON core.settlement_settlement_tax_line FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable()`
- `settlement_immutable_truncate` : `CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement_tax_line FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.settlement_trip_leg_balance`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : app_worker: SELECT ; cmd_money_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `trip_id` | `uuid` | oui | — |
| `segment_no` | `integer` | oui | — |
| `leg` | `text` | oui | — |
| `org_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `currency` | `text` | oui | — |
| `captured_minor` | `bigint` | oui | `0` |
| `refunded_minor` | `bigint` | oui | `0` |
| `reallocated_in_minor` | `bigint` | oui | `0` |
| `reallocated_out_minor` | `bigint` | oui | `0` |
| `released_minor` | `bigint` | oui | `0` |
| `frozen` | `boolean` | oui | `false` |
| `frozen_reason` | `text` | non | — |
| `release_at` | `timestamp with time zone` | non | — |
| `row_version` | `integer` | oui | `0` |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `settlement_trip_leg_balance_pkey` : `PRIMARY KEY (trip_id, segment_no, leg)`
- `trip_leg_balance_amounts_nonneg` : `CHECK (captured_minor >= 0 AND refunded_minor >= 0 AND reallocated_in_minor >= 0 AND reallocated_out_minor >= 0 AND released_minor >= 0)`
- `trip_leg_balance_currency_format` : `CHECK (currency ~ '^[A-Z]{3}$'::text)`
- `trip_leg_balance_frozen_reason_valid` : `CHECK (frozen_reason = ANY (ARRAY['CHARGEBACK'::text, 'DISPUTE'::text, 'CLAIM'::text]))`
- `trip_leg_balance_frozen_shape` : `CHECK (frozen = (frozen_reason IS NOT NULL))`
- `trip_leg_balance_leg_valid` : `CHECK (leg = ANY (ARRAY['HOST'::text, 'INSURER'::text, 'TAX_THIRD_PARTY'::text, 'PLATFORM'::text]))`
- `trip_leg_balance_nonneg` : `CHECK ((captured_minor + reallocated_in_minor - refunded_minor - reallocated_out_minor - released_minor) >= 0)`
- `trip_leg_balance_org_country_fk` : `FOREIGN KEY (org_id, country_code) REFERENCES core.iam_organization(id, country_code)`
- `trip_leg_balance_segment_beta` : `CHECK (segment_no = 1)`
- `trip_leg_balance_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`

Index :

- `trip_leg_balance_org_idx` : `CREATE INDEX trip_leg_balance_org_idx ON core.settlement_trip_leg_balance USING btree (org_id) WHERE (leg = 'HOST'::text)`

Politiques RLS :

- `cmd_money_ins` (INSERT, PERMISSIVE, cmd_money_owner) WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text) AND (captured_minor = 0) AND (refunded_minor = 0) AND (reallocated_in_minor = 0) AND (reallocated_out_minor = 0) AND (released_minor = 0) AND (NOT frozen))`
- `cmd_money_sel` (SELECT, PERMISSIVE, cmd_money_owner) USING `true`
- `cmd_money_upd` (UPDATE, PERMISSIVE, cmd_money_owner) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))` WITH CHECK `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = 'payment_command'::text))`
- `leg_host_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'HOST'::text) AND (org_id = app.org_id()) AND (leg = 'HOST'::text) AND app.is_org_holder() AND (app.vehicle_scope() IS NULL) AND app.has_permission('finance.read_org_statements'::text))`
- `leg_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR app.has_staff_role('FINANCE'::text, country_code) OR app.staff_case_covers('TRIP'::text, trip_id)))`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `worker_money_read` (SELECT, PERMISSIVE, app_worker) USING `((app.actor_kind() = 'WORKER'::text) AND (app.worker_name() = ANY (ARRAY['settlement'::text, 'payment_command'::text, 'payout'::text, 'bordereau'::text, 'reconciliation'::text])))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_trip_leg_balance FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`
- `trip_leg_balance_guard` : `CREATE TRIGGER trip_leg_balance_guard BEFORE DELETE OR UPDATE ON core.settlement_trip_leg_balance FOR EACH ROW EXECUTE FUNCTION core.settlement_trip_leg_balance_guard()`
- `trip_leg_balance_no_truncate` : `CREATE TRIGGER trip_leg_balance_no_truncate BEFORE TRUNCATE ON core.settlement_trip_leg_balance FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable()`

### `core.support_manual_action`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `action_code` | `text` | oui | — |
| `mode` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `subject_id` | `uuid` | oui | — |
| `country_code` | `text` | oui | — |
| `actor_user_id` | `uuid` | oui | — |
| `actor_role` | `text` | oui | — |
| `input` | `jsonb` | oui | `'{}'::jsonb` |
| `evidence_file_ids` | `uuid[]` | oui | `'{}'::uuid[]` |
| `reason` | `text` | oui | — |
| `emitted_event_ids` | `uuid[]` | oui | `'{}'::uuid[]` |
| `audit_log_id` | `bigint` | non | — |
| `request_id` | `uuid` | oui | — |
| `at` | `timestamp with time zone` | oui | `platform.now()` |

Contraintes :

- `manual_action_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `manual_action_idempotent` : `UNIQUE (action_code, subject_id, request_id)`
- `manual_action_input_object` : `CHECK (jsonb_typeof(input) = 'object'::text)`
- `manual_action_mode_valid` : `CHECK (mode = ANY (ARRAY['DOMAIN_COMMAND'::text, 'RECORD_ONLY'::text]))`
- `manual_action_pkey` : `PRIMARY KEY (id)`
- `manual_action_reason_length` : `CHECK (char_length(btrim(reason)) >= 10 AND char_length(btrim(reason)) <= 1000)`
- `support_manual_action_action_code_fkey` : `FOREIGN KEY (action_code) REFERENCES core.support_manual_action_catalog(action_code)`
- `support_manual_action_actor_user_id_fkey` : `FOREIGN KEY (actor_user_id) REFERENCES core.iam_user_account(id)`
- `support_manual_action_audit_log_id_fkey` : `FOREIGN KEY (audit_log_id) REFERENCES core.audit_audit_log(id)`

Politiques RLS :

- `iam_staff_insert` (INSERT, PERMISSIVE, iam_staff_owner) WITH CHECK `(audit_log_id IS NULL)`
- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `iam_staff_update` (UPDATE, PERMISSIVE, iam_staff_owner) USING `(audit_log_id IS NULL)` WITH CHECK `(audit_log_id IS NOT NULL)`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.support_manual_action_catalog`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : iam_staff_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `action_code` | `text` | oui | — |
| `permission_code` | `text` | oui | — |
| `mode` | `text` | oui | — |
| `subject_type` | `text` | oui | — |
| `available` | `boolean` | oui | — |

Contraintes :

- `manual_action_catalog_code_format` : `CHECK (action_code ~ '^[A-Z][A-Z0-9_]{1,63}$'::text)`
- `manual_action_catalog_mode_valid` : `CHECK (mode = ANY (ARRAY['DOMAIN_COMMAND'::text, 'RECORD_ONLY'::text]))`
- `manual_action_catalog_permission_format` : `CHECK (permission_code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'::text)`
- `manual_action_catalog_pkey` : `PRIMARY KEY (action_code)`
- `manual_action_catalog_subject_valid` : `CHECK (subject_type = 'TRIP'::text)`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

### `core.support_support_case`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `id` | `uuid` | oui | — |
| `requester_user_id` | `uuid` | non | — |
| `country_code` | `text` | oui | — |
| `trip_id` | `uuid` | non | — |
| `channel` | `text` | oui | — |
| `category` | `text` | oui | — |
| `priority` | `text` | oui | `'NORMAL'::text` |
| `status` | `text` | oui | `'OPEN'::text` |
| `assignee_id` | `uuid` | non | — |
| `reason` | `text` | non | — |
| `sla_due_at` | `timestamp with time zone` | non | — |
| `created_at` | `timestamp with time zone` | oui | `platform.now()` |
| `created_by` | `uuid` | non | — |
| `updated_at` | `timestamp with time zone` | oui | `platform.now()` |
| `updated_by` | `uuid` | non | — |
| `row_version` | `integer` | oui | `0` |

Contraintes :

- `support_case_break_glass_reason` : `CHECK (category <> 'BREAK_GLASS'::text OR reason IS NOT NULL AND length(btrim(reason)) >= 10 AND length(btrim(reason)) <= 2000)`
- `support_case_category_valid` : `CHECK (category = ANY (ARRAY['TRIP'::text, 'PAYMENT'::text, 'ACCOUNT'::text, 'LISTING'::text, 'CLAIM'::text, 'SAFETY'::text, 'OTHER'::text, 'BREAK_GLASS'::text]))`
- `support_case_channel_valid` : `CHECK (channel = ANY (ARRAY['WHATSAPP'::text, 'EMAIL'::text, 'PHONE'::text, 'IN_APP'::text, 'INTERNAL'::text]))`
- `support_case_country_format` : `CHECK (country_code ~ '^[A-Z]{2}$'::text)`
- `support_case_priority_valid` : `CHECK (priority = ANY (ARRAY['LOW'::text, 'NORMAL'::text, 'HIGH'::text, 'URGENT'::text]))`
- `support_case_status_valid` : `CHECK (status = ANY (ARRAY['OPEN'::text, 'PENDING'::text, 'RESOLVED'::text, 'CLOSED'::text]))`
- `support_case_trip_country_fk` : `FOREIGN KEY (trip_id, country_code) REFERENCES core.booking_trip(id, country_code)`
- `support_support_case_assignee_id_fkey` : `FOREIGN KEY (assignee_id) REFERENCES core.iam_user_account(id)`
- `support_support_case_pkey` : `PRIMARY KEY (id)`
- `support_support_case_requester_user_id_fkey` : `FOREIGN KEY (requester_user_id) REFERENCES core.iam_user_account(id)`

Index :

- `support_case_trip_assignee_idx` : `CREATE INDEX support_case_trip_assignee_idx ON core.support_support_case USING btree (trip_id, assignee_id) WHERE (status = ANY (ARRAY['OPEN'::text, 'PENDING'::text]))`

Politiques RLS :

- `iam_staff_select` (SELECT, PERMISSIVE, iam_staff_owner) USING `true`
- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`
- `policy_fn_read` (SELECT, PERMISSIVE, policy_fn_owner) USING `true`
- `support_case_staff_read` (SELECT, PERMISSIVE, app_api) USING `((app.actor_kind() = 'STAFF'::text) AND (country_code = ANY (app.country_scope())) AND (app.has_staff_role('ADMIN'::text, country_code) OR ((assignee_id = app.actor_id()) AND (app.has_staff_role('OPS_AGENT'::text, country_code) OR app.has_staff_role('SUPPORT_AGENT'::text, country_code)))))`

Déclencheurs :

- `touch_row` : `CREATE TRIGGER touch_row BEFORE UPDATE ON core.support_support_case FOR EACH ROW EXECUTE FUNCTION platform.touch_row()`

### `platform.environment_declaration`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : guard_owner: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `singleton` | `boolean` | oui | `true` |
| `environment` | `text` | oui | — |
| `declared_at` | `timestamp with time zone` | oui | `platform.now()` |
| `declared_by` | `text` | oui | `CURRENT_USER` |

Contraintes :

- `environment_declaration_environment_check` : `CHECK (environment = ANY (ARRAY['development'::text, 'preproduction'::text, 'production'::text]))`
- `environment_declaration_pkey` : `PRIMARY KEY (singleton)`
- `environment_declaration_singleton_check` : `CHECK (singleton)`

Politiques RLS :

- `guard_read` (SELECT, PERMISSIVE, guard_owner) USING `true`
- `migrator_declare` (INSERT, PERMISSIVE, migrator) WITH CHECK `true`
- `migrator_delete_refused` (DELETE, PERMISSIVE, migrator) USING `true`
- `migrator_read` (SELECT, PERMISSIVE, migrator) USING `true`
- `migrator_update_refused` (UPDATE, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

Déclencheurs :

- `environment_declaration_no_truncate` : `CREATE TRIGGER environment_declaration_no_truncate BEFORE TRUNCATE ON platform.environment_declaration FOR EACH STATEMENT EXECUTE FUNCTION platform.environment_declaration_immutable()`
- `environment_declaration_no_update` : `CREATE TRIGGER environment_declaration_no_update BEFORE DELETE OR UPDATE ON platform.environment_declaration FOR EACH ROW EXECUTE FUNCTION platform.environment_declaration_immutable()`

### `platform.schema_migration`

- RLS : ENABLE + FORCE ; propriétaire `migrator`
- Droits : migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE

| Colonne | Type | NOT NULL | Défaut |
| ------- | ---- | -------- | ------ |
| `version` | `text` | oui | — |
| `name` | `text` | oui | — |
| `checksum` | `text` | oui | — |
| `applied_at` | `timestamp with time zone` | oui | `platform.now()` |
| `applied_by` | `name` | oui | `CURRENT_USER` |

Contraintes :

- `schema_migration_checksum_check` : `CHECK (checksum ~ '^[0-9a-f]{64}$'::text)`
- `schema_migration_name_check` : `CHECK (name ~ '^[a-z0-9_]+$'::text)`
- `schema_migration_pkey` : `PRIMARY KEY (version)`
- `schema_migration_version_check` : `CHECK (version ~ '^[0-9]{4}$'::text)`

Politiques RLS :

- `migrator_all` (ALL, PERMISSIVE, migrator) USING `true` WITH CHECK `true`

## Vues

### `core.booking_host_guest_v`

- view ; propriétaire `migrator` ; droits : app_api: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- Colonnes : `trip_id` uuid, `first_name` text, `age_years` integer, `rating` numeric, `verification_status` text

### `core.settlement_host_advance_v`

- view ; propriétaire `migrator` ; droits : app_api: SELECT ; migrator: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
- Colonnes : `id` uuid, `trip_id` uuid, `country_code` text, `currency` text, `amount_minor` bigint, `receivable_minor` bigint, `recovered_minor` bigint, `outstanding_minor` bigint, `status` text, `created_at` timestamp with time zone

## Fonctions `SECURITY DEFINER`

Chacune a un propriétaire `NOLOGIN` dédié (ADR-053) et un `search_path` figé ; EXECUTE accordé nommément (jamais PUBLIC). Liste blanche : `packages/db/security-definer-allowlist.json`.

| Fonction | Résultat | Propriétaire | Configuration | EXECUTE |
| -------- | -------- | ------------ | ------------- | ------- |
| `app.has_permission(p_code text)` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.has_staff_role(p_role text, p_country text)` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.host_covers_vehicle(p_vehicle_id uuid)` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE ; host_view_owner: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.is_org_holder()` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.staff_case_covers(p_object_type text, p_object_id uuid)` | `boolean` | `policy_fn_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; policy_fn_owner: EXECUTE |
| `core.audit_log_chain()` | `trigger` | `audit_chain_owner` | search_path=pg_catalog, pg_temp | audit_chain_owner: EXECUTE |
| `core.booking_assert_conversion_disposition()` | `trigger` | `integrity_owner` | search_path=pg_catalog, pg_temp | integrity_owner: EXECUTE |
| `core.booking_assert_rent_payment_operation()` | `trigger` | `integrity_owner` | search_path=pg_catalog, pg_temp | integrity_owner: EXECUTE |
| `core.booking_assert_trip_occupancy()` | `trigger` | `integrity_owner` | search_path=pg_catalog, pg_temp | integrity_owner: EXECUTE |
| `core.booking_cmd_place_buffer(p_trip_id uuid, p_start timestamp with time zone)` | `uuid` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_place_hold(p_vehicle_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_flagged boolean)` | `uuid` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_place_host_block(p_vehicle_id uuid, p_start timestamp with time zone, p_end timestamp with time zone)` | `uuid` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_record_order(p_hold_id uuid, p_operation_id uuid, p_provider_reference text, p_order_expires_at timestamp with time zone)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_release_own_hold(p_hold_id uuid)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_remove_host_block(p_block_id uuid)` | `boolean` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_cmd_start_payment(p_hold_id uuid, p_psp_account_id uuid, p_method text)` | `jsonb` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_conversion_eligibility(p_hold_id uuid)` | `text` | `cmd_hold_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE |
| `core.booking_host_guest_rows()` | `TABLE(trip_id uuid, first_name text, age_years integer, rating numeric, verification_status text)` | `host_view_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; host_view_owner: EXECUTE |
| `core.cfg_brand_cmd_publish(p_token_hash bytea, p_request_id uuid, p_version_id uuid, p_contrast_check jsonb)` | `TABLE(outcome text, version_id uuid, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_brand_cmd_register_asset(p_token_hash bytea, p_request_id uuid, p_asset_id uuid, p_kind text, p_mime text, p_bytes bigint, p_sha256 bytea, p_alt_es text, p_alt_en text, p_alt_fr text, p_alt_pt text, p_license_note text)` | `TABLE(outcome text, asset_id uuid, storage_key text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_brand_cmd_rollback(p_token_hash bytea, p_request_id uuid, p_new_version_id uuid, p_target_id uuid, p_contrast_check jsonb)` | `TABLE(outcome text, version_id uuid, version_no integer, copied_from_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_brand_cmd_save_draft(p_token_hash bytea, p_request_id uuid, p_version_id uuid, p_brand_name text, p_tokens jsonb, p_tokens_schema_version integer, p_logo_asset_id uuid, p_favicon_asset_id uuid, p_pwa_icon_asset_id uuid, p_copied_from_id uuid)` | `TABLE(outcome text, version_id uuid, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_brand_staff_versions(p_token_hash bytea, p_version_id uuid, p_limit integer)` | `TABLE(id uuid, version_no integer, status text, brand_name text, tokens jsonb, tokens_schema_version integer, logo_asset_id uuid, favicon_asset_id uuid, pwa_icon_asset_id uuid, contrast_check jsonb, copied_from_id uuid, created_by uuid, created_at timestamp with time zone, published_by uuid, published_at timestamp with time zone, archived_at timestamp with time zone, tokens_sha256 text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_content_cmd_publish(p_token_hash bytea, p_request_id uuid, p_block_key text, p_country text, p_version_no integer)` | `TABLE(outcome text, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_content_cmd_rollback(p_token_hash bytea, p_request_id uuid, p_block_key text, p_country text, p_target_version_no integer)` | `TABLE(outcome text, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.cfg_content_cmd_save_draft(p_token_hash bytea, p_request_id uuid, p_block_key text, p_country text, p_bodies jsonb, p_asset_id uuid)` | `TABLE(outcome text, version_no integer)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_auth_lookup(p_email text)` | `TABLE(user_id uuid, password_hash text, status text)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_open_session(p_session_id uuid, p_user_id uuid, p_token_hash bytea, p_ttl_s integer, p_mfa_level text, p_ip inet, p_user_agent text)` | `timestamp with time zone` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_register(p_user_id uuid, p_email text, p_password_hash text, p_legal_first_name text, p_legal_last_name text, p_preferred_locale text, p_verification_id uuid, p_verification_token_hash bytea, p_verification_ttl_s integer, p_ip inet)` | `boolean` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_revoke_all_sessions(p_token_hash bytea)` | `integer` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_revoke_session(p_token_hash bytea, p_reason text)` | `boolean` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_cmd_verify_email(p_token_hash bytea)` | `boolean` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_notification_contact(p_user_id uuid)` | `TABLE(email text, phone_e164 text, preferred_locale text, first_name text)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_session_resolve(p_token_hash bytea)` | `TABLE(session_id uuid, user_id uuid, mfa_level text, expires_at timestamp with time zone, email_verified boolean)` | `iam_auth_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_auth_owner: EXECUTE |
| `core.iam_staff_audit_read(p_token_hash bytea, p_before_id bigint, p_limit integer)` | `TABLE(id bigint, at timestamp with time zone, actor_user_id uuid, actor_role text, action_code text, subject_type text, subject_id uuid, reason text, before jsonb, after jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_begin(p_token_hash bytea)` | `TABLE(outcome text, user_id uuid, factor_id uuid, roles jsonb)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_data_access(p_token_hash bytea, p_request_id uuid, p_case_id uuid, p_subject_type text, p_subject_id uuid, p_field_or_file text, p_access_kind text, p_purpose text)` | `TABLE(outcome text, access_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_elevate(p_token_hash bytea, p_factor_id uuid, p_step bigint, p_proof bytea)` | `text` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_enroll_reveal(p_token_hash bytea, p_code_hash bytea)` | `TABLE(outcome text, factor_id uuid, secret_ref text)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_manual_action(p_token_hash bytea, p_request_id uuid, p_action_code text, p_subject_id uuid, p_reason text, p_input jsonb)` | `TABLE(outcome text, action_id uuid)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_mfa_attempt(p_token_hash bytea)` | `TABLE(outcome text, factor_id uuid, secret_ref text, last_used_step bigint)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_reset_totp(p_token_hash bytea, p_request_id uuid, p_target uuid, p_reason text, p_factor_id uuid, p_secret_ref text, p_code_hash bytea, p_ttl_s integer)` | `text` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_cmd_suspend(p_token_hash bytea, p_request_id uuid, p_target uuid, p_reason text)` | `text` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.iam_staff_read_access(p_token_hash bytea, p_permission text, p_scope text)` | `text` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.payment_assert_operation_legs()` | `trigger` | `integrity_owner` | search_path=pg_catalog, pg_temp | integrity_owner: EXECUTE |
| `core.payment_cmd_apply_operation_status(p_operation_id uuid, p_status text, p_source text, p_raw_ref uuid, p_provider_reference text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_receive_webhook(p_account_id uuid, p_provider_event_id text, p_dedup_key bytea, p_signature_valid boolean, p_signed_at timestamp with time zone, p_headers jsonb, p_normalized jsonb)` | `TABLE(outcome text, inbox_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_record_operation(p_id uuid, p_hold_id uuid, p_trip_id uuid, p_psp_account_id uuid, p_method text, p_kind text, p_purpose text, p_amount_minor bigint, p_currency text, p_attempt_no integer, p_idem_plain text, p_idem_sent text, p_legs jsonb)` | `TABLE(operation_id uuid, replayed boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_record_submerchant_status(p_submerchant_id uuid, p_status text, p_provider_ref text, p_reason text)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_cmd_register_submerchant(p_id uuid, p_org_id uuid, p_psp_account_id uuid, p_attempt_no integer)` | `TABLE(submerchant_id uuid, idem_plain text, replayed boolean)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_resolve_webhook_account(p_provider text, p_public_webhook_id text)` | `TABLE(account_id uuid, webhook_secret_ref text)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.payment_startup_guard()` | `TABLE(deployment_env text, fake_accounts integer)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.risk_cmd_hit(p_scope text, p_key_hash bytea, p_country text, p_limit integer, p_window_s integer, p_weight integer)` | `TABLE(allowed boolean, hits integer, retry_after_s integer)` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.risk_cmd_prune(p_batch integer, p_event_retention_days integer)` | `integer` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.risk_cmd_record_abuse(p_kind text, p_scope text, p_key_hash bytea, p_country text, p_signals text[])` | `void` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.risk_cmd_sms_reserve(p_country text, p_cap integer, p_critical boolean)` | `TABLE(allowed boolean, sent_today integer, alert boolean)` | `risk_limit_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; app_worker: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.risk_staff_abuse_board(p_token_hash bytea, p_country text, p_hours integer)` | `TABLE(kind text, scope text, country_code text, bucket_start timestamp with time zone, occurrences bigint, distinct_keys bigint, signals text[], last_at timestamp with time zone)` | `iam_staff_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; iam_staff_owner: EXECUTE |
| `core.settlement_advance_approvers(p_token_hash bytea, p_advance_id uuid)` | `TABLE(decided_by uuid, decision_second_by uuid, written_off_by uuid, write_off_second_by uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_assert_balanced()` | `trigger` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | cmd_money_owner: EXECUTE |
| `core.settlement_cmd_apply_leg_movement(p_operation_id uuid)` | `text` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_cmd_approve_finance_action(p_token_hash bytea, p_approval_id uuid)` | `TABLE(outcome text, approval_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_cmd_record(p_settlement_id uuid, p_trip_id uuid, p_segment_no integer, p_version integer, p_supersedes_id uuid, p_trip_row_version integer, p_record jsonb)` | `uuid` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_worker: EXECUTE ; cmd_money_owner: EXECUTE |
| `core.settlement_cmd_request_finance_action(p_token_hash bytea, p_request_id uuid, p_action text, p_subject_id uuid, p_reason text)` | `TABLE(outcome text, approval_id uuid)` | `cmd_money_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_money_owner: EXECUTE |
| `platform.declared_environment()` | `text` | `guard_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; guard_owner: EXECUTE |
| `platform.guest_hold_guard(p_period tstzrange)` | `TABLE(live_holds integer, trip_overlap boolean)` | `guard_owner` | search_path=pg_catalog, pg_temp | app_api: EXECUTE ; cmd_hold_owner: EXECUTE ; guard_owner: EXECUTE |

## Autres fonctions

| Fonction | Résultat | Propriétaire | EXECUTE |
| -------- | -------- | ------------ | ------- |
| `app.actor_id()` | `uuid` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; guard_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.actor_kind()` | `text` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; catalog_probe_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; guard_owner: EXECUTE ; host_view_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.country_scope()` | `text[]` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.org_id()` | `uuid` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; host_view_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.session_token_hash()` | `bytea` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.vehicle_scope()` | `uuid[]` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `app.worker_name()` | `text` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; catalog_probe_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; guard_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE |
| `core.audit_append_only()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.audit_canon(v text)` | `text` | `migrator` | audit_chain_owner: EXECUTE ; migrator: EXECUTE |
| `core.audit_chain_head_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.audit_destroy_subject_key(p_subject_type text, p_subject_id uuid, p_request_id uuid, p_reason text)` | `bigint` | `migrator` | migrator: EXECUTE |
| `core.audit_file_asset_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.audit_log_canonical(r core.audit_audit_log)` | `text` | `migrator` | audit_chain_owner: EXECUTE ; migrator: EXECUTE |
| `core.audit_subject_key_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_buffer_minutes(p_country text)` | `integer` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_convert_payment(p_operation_id uuid)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_disposition_candidates(p_limit integer)` | `TABLE(operation_id uuid, success_known_at timestamp with time zone)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_disposition_repair(p_operation_id uuid)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_expire_due_holds(p_limit integer)` | `integer` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_hold_guarded_columns()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_hold_payment_terms(p_hold_id uuid)` | `TABLE(amount_minor bigint, currency text, legs jsonb, scheduled_start timestamp with time zone, scheduled_end timestamp with time zone, timezone text)` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_hold_terminal_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_intents_due(p_limit integer)` | `TABLE(operation_id uuid, hold_id uuid, provider text, method text, country_code text, psp_account_id uuid, idem_sent text, provider_reference text, status text)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_no_delete()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.booking_occupied_period(p_start timestamp with time zone, p_end timestamp with time zone, p_buffer_minutes integer)` | `tstzrange` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_open_compensation(p_hold_id uuid, p_operation_id uuid, p_reason text)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_param_int(p_key text, p_country text)` | `integer` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_param_text(p_key text, p_country text)` | `text` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.booking_production_oracle()` | `TABLE(check_code text, violations bigint, by_country jsonb)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_production_oracle_alert()` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_record_payment_failure(p_operation_id uuid)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_record_poll(p_operation_id uuid)` | `jsonb` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_release_cancelled_holds(p_limit integer)` | `integer` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.booking_vehicle_party(p_vehicle_id uuid)` | `TABLE(org_id uuid, country_code text)` | `migrator` | cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_asset_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.cfg_brand_authorize(p_token_hash bytea, p_permission text, p_country text, p_attempted text, p_subject_type text, p_subject_id uuid, p_request_id uuid, OUT outcome text, OUT actor uuid, OUT actor_role text)` | `record` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_body_allowed(p_body text)` | `boolean` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_contrast_valid(p_check jsonb)` | `boolean` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_no_truncate()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.cfg_brand_tokens_sha256(p_tokens jsonb)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.cfg_brand_version_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.cfg_content_block_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_go_live(p_key text, p_country text)` | `boolean` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; migrator: EXECUTE |
| `core.config_no_truncate()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_param_value_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_tax_line_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.config_versioned_row_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.iam_hmac_sha256(p_key bytea, p_msg bytea)` | `bytea` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_mfa_proof(p_key bytea, p_token_hash bytea, p_factor_id uuid, p_step bigint)` | `bytea` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_session_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.iam_staff_audit(p_actor uuid, p_role text, p_action text, p_subject_type text, p_subject_id uuid, p_before jsonb, p_after jsonb, p_reason text, p_request_id uuid)` | `bigint` | `migrator` | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_audit_countries(p_actor uuid, p_subject_type text, p_subject_id uuid, p_before jsonb, p_after jsonb)` | `text[]` | `migrator` | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_authority(p_actor uuid, p_target uuid)` | `text` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_count_attempt(p_factor_id uuid, p_user uuid)` | `boolean` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_permitted(p_user uuid, p_permission text, p_countries text[], p_roles text[])` | `text` | `migrator` | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_staff_session(p_token_hash bytea, OUT user_id uuid, OUT session_id uuid, OUT mfa_level text)` | `record` | `migrator` | cmd_money_owner: EXECUTE ; iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.iam_totp_step_now()` | `bigint` | `migrator` | iam_staff_owner: EXECUTE ; migrator: EXECUTE |
| `core.ops_monitor_metrics(p_since timestamp with time zone, p_webhook_failures integer)` | `TABLE(metric text, label text, country_code text, value bigint)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_begin_receipt(p_event_id uuid)` | `boolean` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_claim_jobs(p_limit integer, p_lease interval)` | `SETOF core.outbox_scheduled_job` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_complete_job(p_job_id uuid)` | `boolean` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_enqueue(p_name text, p_payload jsonb, p_singleton_key text, p_event_id uuid, p_run_at timestamp with time zone, p_delay interval, p_max_attempts integer)` | `boolean` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_fail_job(p_job_id uuid, p_error text, p_backoff_base interval)` | `text` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_mark_published(p_ids uuid[])` | `integer` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_metrics()` | `TABLE(metric text, queue text, value bigint)` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_reap_expired_jobs()` | `SETOF core.outbox_dead_letter` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_record_relay_failure(p_ids uuid[], p_error text)` | `integer` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.outbox_relay_claim(p_limit integer)` | `SETOF core.outbox_outbox_event` | `migrator` | app_worker: EXECUTE ; migrator: EXECUTE |
| `core.payment_capability_bool(p_provider text, p_country text, p_method text, p_capability text)` | `boolean` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_capability_int(p_provider text, p_country text, p_method text, p_capability text)` | `integer` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_capability_value(p_provider text, p_country text, p_method text, p_capability text)` | `jsonb` | `migrator` | app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_missing_blocking_capabilities(p_provider text, p_country text, p_mode text)` | `text[]` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.payment_psp_account_fake_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_psp_submerchant_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.payment_text_has_pan(p_text text)` | `boolean` | `migrator` | app_worker: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `core.risk_log_abuse(p_kind text, p_scope text, p_key_hash bytea, p_country text, p_signals text[])` | `void` | `migrator` | migrator: EXECUTE ; risk_limit_owner: EXECUTE |
| `core.settlement_finance_approval_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_guard_immutable()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_insurer_bordereau_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_no_delete()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_platform_advance_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `core.settlement_trip_leg_balance_guard()` | `trigger` | `migrator` | migrator: EXECUTE |
| `platform.declare_environment(p_environment text)` | `text` | `migrator` | migrator: EXECUTE |
| `platform.deployment_env()` | `text` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; migrator: EXECUTE |
| `platform.environment_declaration_immutable()` | `trigger` | `migrator` | migrator: EXECUTE |
| `platform.now()` | `timestamp with time zone` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; audit_chain_owner: EXECUTE ; catalog_probe_owner: EXECUTE ; cmd_golive_owner: EXECUTE ; cmd_hold_owner: EXECUTE ; cmd_money_owner: EXECUTE ; guard_owner: EXECUTE ; host_view_owner: EXECUTE ; iam_auth_owner: EXECUTE ; iam_staff_owner: EXECUTE ; integrity_owner: EXECUTE ; migrator: EXECUTE ; policy_fn_owner: EXECUTE ; risk_limit_owner: EXECUTE |
| `platform.touch_row()` | `trigger` | `migrator` | migrator: EXECUTE |
| `platform.uuid_v7()` | `uuid` | `migrator` | app_api: EXECUTE ; app_worker: EXECUTE ; cmd_hold_owner: EXECUTE ; migrator: EXECUTE |

