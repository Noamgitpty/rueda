-- 0090 — AUD : registre Ley 81 (traitements, sous-traitants, règles de rétention), demandes des personnes, pseudonymisation des trips clos.
-- US-111 ; 19 US-111 (critères 1 à 3) ; 16 LEG-009 / LEG-010 ; 17 §1.5 points 3 et 4, §3.1.3
-- (classe E), §3.2.13 (`data_subject_request`, `subprocessor`), §7.2 ; 08 BR-ACC-09 ; ADR-018,
-- ADR-026, ADR-029 ; NN8, NN9 ; ADR-118 (cette migration, PROPOSÉ). Appliquée sous `migrator`.
-- Paramètres lus : `privacy_register_validated`, `privacy_dsr_response_days` (graine 0089) et
-- `evidence_retention_months` (0009).
--
-- Principes (ADR-118) :
--   - registre en tables de RÉFÉRENCE (classe C, écrites par migration seulement, revue) :
--     sous-traitants (`audit_subprocessor`, tous simulés ou auto-hébergés aujourd'hui), traitements
--     (`audit_processing_activity`) et règles de rétention (`audit_retention_rule`, chaque durée
--     est un paramètre PAR PAYS, jamais une constante). Le texte juridique est un gabarit à
--     valider par l'avocat (docs/legal/), hors base ;
--   - critère 1 : `core.privacy_kyc_register_gate(pays)` rend `KYC_PRODUCTION_BLOCKED_NO_REGISTER`
--     en production (environnement inconnu = production) tant que le registre du pays n'est pas
--     validé (`privacy_register_validated`, fail-closed FALSE) ou qu'aucun fournisseur KYC
--     contractuel en vigueur n'est inscrit. Hors production : rien (données synthétiques, ADM-034) ;
--   - critère 2 : le travailleur `privacy_request` pseudonymise les colonnes C2 des trips clos
--     sans litige quand `evidence_retention_months` (≥ 15 mois, REQ-PAY-DMG-11) est écoulé
--     depuis la dernière date du trip (fin prévue, dernière mise à jour du trip, dernière
--     opération monétaire) ; chaque trip traité est inscrit une fois au journal
--     `audit_retention_log` (ajout seul). Lignes comptables, opérations, jambes, audit chaîné et
--     preuves : jamais touchés (17 §3.1.3 classe E). Paramètre absent : rien n'est purgé ;
--   - critère 3 : `HANDLE_DSR` devient une action d'état liée à
--     `core.privacy_manual_action_dsr` (cadre d'US-101) : saisie fermée `kind` et `step`, une
--     demande par dossier de support, échéance = réception + `privacy_dsr_response_days` du pays
--     du dossier (paramètre absent : refus `DSR_DELAY_UNKNOWN`) ; machine d'états fermée ; le
--     travailleur signale une fois chaque demande en retard ;
--   - aucune écriture directe : commandes SECURITY DEFINER du propriétaire NOLOGIN
--     `privacy_cmd_owner`, search_path figé, `platform.now()` ; RLS ENABLE + FORCE.
--
-- Expand / contract : tables, fonctions, politiques et droits ajoutés ; ligne de référence
-- HANDLE_DSR du catalogue passée de RECORD_ONLY à DOMAIN_COMMAND (saisie `kind`, `step`) : la
-- version N, qui l'envoyait sans saisie, reçoit un refus métier (`DSR_INPUT_REQUIRED`) au lieu
-- d'un enregistrement ; aucune donnée n'est modifiée ni perdue.
--
-- Retour arrière (base sans dépendance) :
--   DELETE FROM core.support_manual_action_handler WHERE action_code = 'HANDLE_DSR';
--   UPDATE core.support_manual_action_catalog SET mode = 'RECORD_ONLY', available = true,
--     input_keys = '{}', input_values = '{}' WHERE action_code = 'HANDLE_DSR';
--   DROP FUNCTION core.privacy_manual_action_dsr(bytea, uuid, text, uuid, jsonb, text, uuid, text),
--     core.privacy_kyc_register_gate(text), core.privacy_worker_retention_sweep(integer),
--     core.privacy_worker_dsr_overdue(integer), core.privacy_worker_stale_kyc_erasures(integer),
--     core.privacy_param(text, text), core.privacy_worker_guard(),
--     core.privacy_append_only();
--   DROP TABLE core.audit_retention_log, core.audit_data_subject_request,
--     core.audit_processing_activity, core.audit_retention_rule, core.audit_subprocessor;
--   DROP POLICY privacy_cmd_* (tables existantes ci-dessous) ; révoquer les droits de
--   privacy_cmd_owner.

-- 1. Sous-traitants (17 §3.2.13 `subprocessor` ; LEG-010) ----------------------------------------
-- Mode : SIMULATED (adaptateur FAKE, aucune donnée réelle), SELF_HOSTED (exécuté chez notre
-- hébergeur, aucun tiers de plus), PLANNED (retenu, aucun contrat ni donnée réelle),
-- CONTRACTED (contrat signé : `contract_ref` obligatoire). Aucune donnée C3 vers un sous-traitant
-- qui n'est pas CONTRACTED et en vigueur (contrôle de configuration, garde du critère 1).
CREATE TABLE core.audit_subprocessor (
  code                 text        PRIMARY KEY
    CONSTRAINT audit_subprocessor_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  service              text        NOT NULL
    CONSTRAINT audit_subprocessor_service_valid
      CHECK (service IN ('KYC', 'HOSTING', 'EMAIL', 'SMS', 'WHATSAPP_BSP', 'OBSERVABILITY',
                         'PSP', 'ANTIVIRUS', 'MAP_TILES')),
  name                 text        NOT NULL
    CONSTRAINT audit_subprocessor_name_length CHECK (pg_catalog.char_length(name) BETWEEN 2 AND 120),
  mode                 text        NOT NULL
    CONSTRAINT audit_subprocessor_mode_valid
      CHECK (mode IN ('SIMULATED', 'SELF_HOSTED', 'PLANNED', 'CONTRACTED')),
  -- pays de traitement (codes ISO 3166-1 alpha-2) ; vide : aucun traitement réel
  processing_countries text[]      NOT NULL DEFAULT '{}'
    CONSTRAINT audit_subprocessor_countries_format
      CHECK (pg_catalog.array_to_string(processing_countries, ',') ~ '^([A-Z]{2}(,[A-Z]{2})*)?$'),
  data_classes         text[]      NOT NULL
    CONSTRAINT audit_subprocessor_classes_valid
      CHECK (pg_catalog.cardinality(data_classes) > 0 AND data_classes <@ ARRAY['C1', 'C2', 'C3']),
  contract_ref         text
    CONSTRAINT audit_subprocessor_contract_length
      CHECK (contract_ref IS NULL OR pg_catalog.char_length(contract_ref) BETWEEN 3 AND 200),
  transfer_safeguard   text
    CONSTRAINT audit_subprocessor_safeguard_valid
      CHECK (transfer_safeguard IS NULL
             OR transfer_safeguard IN ('NONE_REQUIRED', 'CONSENT', 'CONTRACTUAL_CLAUSES',
                                       'ADEQUATE_COUNTRY')),
  retention_terms      text
    CONSTRAINT audit_subprocessor_retention_length
      CHECK (retention_terms IS NULL OR pg_catalog.char_length(retention_terms) BETWEEN 3 AND 500),
  valid_from           timestamptz NOT NULL,
  valid_to             timestamptz,
  story                text        NOT NULL
    CONSTRAINT audit_subprocessor_story_format CHECK (story ~ '^US-[0-9]{3}$'),
  CONSTRAINT audit_subprocessor_contracted CHECK (
    mode <> 'CONTRACTED' OR (contract_ref IS NOT NULL AND transfer_safeguard IS NOT NULL)),
  CONSTRAINT audit_subprocessor_period CHECK (valid_to IS NULL OR valid_to > valid_from)
);
COMMENT ON TABLE core.audit_subprocessor IS
  'AUD : registre des sous-traitants (LEG-010, Ley 81) ; référence écrite par migration seulement. '
  'Aucune donnée C3 vers un sous-traitant non CONTRACTED ou hors de sa période. US-111 (ADR-118).';

INSERT INTO core.audit_subprocessor
       (code, service, name, mode, processing_countries, data_classes, contract_ref,
        transfer_safeguard, retention_terms, valid_from, story)
VALUES
  ('KYC_FAKE', 'KYC', 'Adaptateur FAKE du fournisseur de vérification d''identité', 'SIMULATED',
   '{}', '{C2,C3}', NULL, NULL,
   'aucune donnée réelle ; fournisseur réel choisi au lot C (US-605), rétention la plus courte '
   'proposée, attestation de suppression par session', '2026-11-13T00:00:00Z', 'US-111'),
  ('SMS_FAKE', 'SMS', 'Adaptateur FAKE du canal SMS', 'SIMULATED', '{}', '{C2}', NULL, NULL,
   'aucun envoi réel avant le lot C', '2026-11-13T00:00:00Z', 'US-111'),
  ('EMAIL_FAKE', 'EMAIL', 'Adaptateur FAKE du canal e-mail', 'SIMULATED', '{}', '{C2}', NULL, NULL,
   'aucun envoi réel avant le lot C', '2026-11-13T00:00:00Z', 'US-111'),
  ('ANTIVIRUS_CLAMAV', 'ANTIVIRUS', 'ClamAV auto-hébergé (DEC-FONDATEUR-20)', 'SELF_HOSTED',
   '{US}', '{C2,C3}', NULL, 'NONE_REQUIRED',
   'analyse en mémoire chez notre hébergeur, aucun fichier conservé par l''antivirus',
   '2026-11-13T00:00:00Z', 'US-111'),
  ('HOSTING_AWS', 'HOSTING', 'Hébergeur, région us-east-1 (ADR-006, US-003)', 'PLANNED',
   '{US}', '{C1,C2,C3}', NULL, NULL,
   'durées de la plateforme ; sauvegardes : rétention des sauvegardes (registre d''effacement '
   're-appliqué après restauration, 17 §3.1.3 point 8)', '2026-11-13T00:00:00Z', 'US-111'),
  ('PSP_FAKE', 'PSP', 'Adaptateur FAKE du PSP de place de marché', 'SIMULATED', '{}', '{C2}', NULL,
   NULL, 'aucun paiement réel avant la porte go / no-go du PSP (lot C)', '2026-11-13T00:00:00Z',
   'US-111');

-- 2. Règles de rétention (16 LEG-009 retention_policy ; 17 §7.2) ---------------------------------
-- Chaque durée est un PARAMÈTRE PAR PAYS (aucune constante) ; l'action dit ce qui arrive à
-- l'échéance ; `enforced_by` nomme le travailleur qui l'applique, ou MANUAL (procédure tracée en
-- attendant l'outil du lot 5, US-536, NN8).
CREATE TABLE core.audit_retention_rule (
  code        text PRIMARY KEY
    CONSTRAINT audit_retention_rule_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  param_key   text NOT NULL REFERENCES core.config_param_definition (key),
  anchor      text NOT NULL
    CONSTRAINT audit_retention_rule_anchor_valid
      CHECK (anchor IN ('TRIP_LAST_ACTIVITY', 'KYC_DECISION', 'VEHICLE_LAST_TRIP', 'EVENT',
                        'RECEIVED')),
  action      text NOT NULL
    CONSTRAINT audit_retention_rule_action_valid
      CHECK (action IN ('PSEUDONYMISATION', 'PURGE', 'CRYPTO_SHREDDING', 'KEEP')),
  tables      text[] NOT NULL
    CONSTRAINT audit_retention_rule_tables_format
      CHECK (pg_catalog.cardinality(tables) > 0
             AND pg_catalog.array_to_string(tables, ',') ~ '^(core\.[a-z][a-z0-9_]*)(,core\.[a-z][a-z0-9_]*)*$'),
  enforced_by text NOT NULL
    CONSTRAINT audit_retention_rule_enforced_valid
      CHECK (enforced_by ~ '^(MANUAL|WORKER:[a-z][a-z0-9_]{1,62})$'),
  story       text NOT NULL
    CONSTRAINT audit_retention_rule_story_format CHECK (story ~ '^US-[0-9]{3}$')
);
COMMENT ON TABLE core.audit_retention_rule IS
  'AUD : règles de rétention (LEG-009) ; durée = paramètre par pays, action à l''échéance, '
  'travailleur ou procédure manuelle tracée. Référence écrite par migration. US-111 (ADR-118).';

INSERT INTO core.audit_retention_rule (code, param_key, anchor, action, tables, enforced_by, story)
VALUES
  ('TRIP_CLOSED', 'evidence_retention_months', 'TRIP_LAST_ACTIVITY', 'PSEUDONYMISATION',
   '{core.booking_trip}', 'WORKER:privacy_request', 'US-111'),
  ('BIOMETRIC_SCORES', 'biometric_appeal_retention_days', 'KYC_DECISION', 'PURGE',
   '{core.kyc_liveness_check}', 'WORKER:kyc_score_pruner', 'US-105'),
  ('VEHICLE_ATTESTATION', 'privacy_vehicle_attestation_retention_months', 'VEHICLE_LAST_TRIP',
   'KEEP', '{core.catalog_vehicle_attestation}', 'MANUAL', 'US-111'),
  ('AUDIT_LOG', 'audit_log_retention_years', 'EVENT', 'CRYPTO_SHREDDING',
   '{core.audit_audit_log,core.audit_data_access_log}', 'MANUAL', 'US-111'),
  ('WEBHOOK_RAW_BODY', 'webhook_raw_body_retention_days', 'RECEIVED', 'PURGE',
   '{core.payment_webhook_inbox}', 'MANUAL', 'US-111');

-- 3. Registre des traitements (16 LEG-010 ; finalités, bases légales, catégories, destinataires,
-- sous-traitants, durées) : codes seulement ; libellés et texte juridique dans le gabarit
-- docs/legal/ (à valider par l'avocat). Responsable : Kmino, marchand de référence (UXQ-11,
-- défaut PROPOSÉ : coordonnées bancaires jamais visibles de l'hôte).
CREATE TABLE core.audit_processing_activity (
  code            text    PRIMARY KEY
    CONSTRAINT audit_processing_activity_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  legal_basis     text    NOT NULL
    CONSTRAINT audit_processing_activity_basis_valid
      CHECK (legal_basis IN ('CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'LEGITIMATE_INTEREST')),
  data_classes    text[]  NOT NULL
    CONSTRAINT audit_processing_activity_classes_valid
      CHECK (pg_catalog.cardinality(data_classes) > 0 AND data_classes <@ ARRAY['C1', 'C2', 'C3']),
  -- biométrie ou autre donnée sensible : consentement exprès séparé (VER-004, OQ-MK-09)
  sensitive       boolean NOT NULL,
  recipients      text[]  NOT NULL DEFAULT '{}'
    CONSTRAINT audit_processing_activity_recipients_valid
      CHECK (recipients <@ ARRAY['HOST', 'GUEST', 'INSURER', 'PSP', 'AUTHORITY']),
  subprocessors   text[]  NOT NULL DEFAULT '{}',
  retention_rules text[]  NOT NULL DEFAULT '{}',
  collected_in_beta boolean NOT NULL,
  story           text    NOT NULL
    CONSTRAINT audit_processing_activity_story_format CHECK (story ~ '^US-[0-9]{3}$'),
  CONSTRAINT audit_processing_activity_sensitive_consent CHECK (NOT sensitive OR legal_basis = 'CONSENT')
);
COMMENT ON TABLE core.audit_processing_activity IS
  'AUD : registre des traitements (LEG-010, Ley 81, Ley 7593) ; codes seulement, texte dans le '
  'gabarit docs/legal/ validé par l''avocat. Référence écrite par migration. US-111 (ADR-118).';

INSERT INTO core.audit_processing_activity
       (code, legal_basis, data_classes, sensitive, recipients, subprocessors, retention_rules,
        collected_in_beta, story)
VALUES
  ('ACCOUNT', 'CONTRACT', '{C1,C2}', false, '{}', '{HOSTING_AWS,EMAIL_FAKE}', '{AUDIT_LOG}', true,
   'US-111'),
  ('PHONE_VERIFICATION', 'CONTRACT', '{C2}', false, '{}', '{HOSTING_AWS,SMS_FAKE}', '{}', true,
   'US-111'),
  ('IDENTITY_BIOMETRICS', 'CONSENT', '{C2,C3}', true, '{}', '{HOSTING_AWS,KYC_FAKE}',
   '{BIOMETRIC_SCORES}', true, 'US-111'),
  ('HOST_VERIFICATION', 'LEGAL_OBLIGATION', '{C2,C3}', false, '{}', '{HOSTING_AWS}', '{}', true,
   'US-111'),
  ('VEHICLE_LISTING', 'CONTRACT', '{C1,C2}', false, '{GUEST}', '{HOSTING_AWS,ANTIVIRUS_CLAMAV}',
   '{VEHICLE_ATTESTATION}', true, 'US-111'),
  ('BOOKING_PAYMENT', 'CONTRACT', '{C1,C2}', false, '{HOST,INSURER,PSP}',
   '{HOSTING_AWS,PSP_FAKE}', '{TRIP_CLOSED,WEBHOOK_RAW_BODY}', true, 'US-111'),
  ('NOTIFICATIONS', 'CONTRACT', '{C2}', false, '{}', '{HOSTING_AWS,EMAIL_FAKE,SMS_FAKE}', '{}',
   true, 'US-111'),
  ('DATA_SUBJECT_REQUESTS', 'LEGAL_OBLIGATION', '{C2}', false, '{AUTHORITY}', '{HOSTING_AWS}',
   '{AUDIT_LOG}', true, 'US-111'),
  ('SECURITY_AUDIT', 'LEGITIMATE_INTEREST', '{C1,C2}', false, '{AUTHORITY}', '{HOSTING_AWS}',
   '{AUDIT_LOG}', true, 'US-111'),
  -- UXQ-11 (défaut PROPOSÉ) : Kmino seul responsable, coordonnées invisibles de l'hôte ; non
  -- collectées par la plateforme en Bêta (remboursement par le PSP)
  ('REFUND_BANK_TRANSFER', 'CONTRACT', '{C3}', false, '{PSP}', '{HOSTING_AWS}', '{}', false,
   'US-111');

-- 4. Demandes des personnes (17 §3.2.13 `data_subject_request` ; LEG-010 ; BR-ACC-09) -----------
CREATE TABLE core.audit_data_subject_request (
  id                   uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT audit_data_subject_request_pkey PRIMARY KEY,
  -- dossier de support par lequel la demande est arrivée (une demande par dossier)
  support_case_id      uuid        NOT NULL REFERENCES core.support_support_case (id)
    CONSTRAINT audit_data_subject_request_case_unique UNIQUE,
  user_id              uuid        REFERENCES core.iam_user_account (id),
  country_code         text        NOT NULL
    CONSTRAINT audit_data_subject_request_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  kind                 text        NOT NULL
    CONSTRAINT audit_data_subject_request_kind_valid
      CHECK (kind IN ('ACCESS', 'RECTIFICATION', 'DELETION', 'OPPOSITION', 'PORTABILITY')),
  status               text        NOT NULL
    CONSTRAINT audit_data_subject_request_status_valid
      CHECK (status IN ('RECEIVED', 'VERIFYING', 'IN_PROGRESS', 'BLOCKED_LEGAL_HOLD', 'DONE',
                        'REJECTED')),
  received_at          timestamptz NOT NULL,
  -- échéance : réception + privacy_dsr_response_days du pays (délai légal À DÉCIDER, OQ-MK-09)
  due_at               timestamptz NOT NULL,
  identity_verified_at timestamptz,
  closed_at            timestamptz,
  handled_by           uuid        NOT NULL REFERENCES core.iam_user_account (id),
  updated_at           timestamptz NOT NULL,
  overdue_alerted_at   timestamptz,
  CONSTRAINT audit_data_subject_request_due CHECK (due_at > received_at),
  CONSTRAINT audit_data_subject_request_closed CHECK (
    (status IN ('DONE', 'REJECTED')) = (closed_at IS NOT NULL)),
  CONSTRAINT audit_data_subject_request_verified CHECK (
    status IN ('RECEIVED', 'VERIFYING', 'REJECTED') OR identity_verified_at IS NOT NULL)
);
CREATE INDEX audit_data_subject_request_due_idx ON core.audit_data_subject_request (due_at)
  WHERE (closed_at IS NULL);
COMMENT ON TABLE core.audit_data_subject_request IS
  'AUD : demandes des personnes (accès, rectification, suppression, opposition, portabilité) ; '
  'échéance suivie, état par HANDLE_DSR seulement. Effacement : procédure manuelle tracée (NN8, '
  'outil US-536). US-111 (ADR-118).';

-- 5. Journal des purges (ajout seul ; « purge journalisée », 16 LEG-009) ------------------------
CREATE TABLE core.audit_retention_log (
  id           uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT audit_retention_log_pkey PRIMARY KEY,
  rule_code    text        NOT NULL REFERENCES core.audit_retention_rule (code),
  subject_type text        NOT NULL
    CONSTRAINT audit_retention_log_subject_valid CHECK (subject_type IN ('TRIP')),
  subject_id   uuid        NOT NULL,
  country_code text        NOT NULL
    CONSTRAINT audit_retention_log_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  action       text        NOT NULL
    CONSTRAINT audit_retention_log_action_valid CHECK (action IN ('PSEUDONYMISATION', 'PURGE')),
  -- colonnes effectivement remplacées (vide : rien à remplacer, trip clos quand même traité)
  columns      text[]      NOT NULL,
  -- échéance atteinte (dernière date du trip + durée du pays) et instant du traitement
  due_at       timestamptz NOT NULL,
  at           timestamptz NOT NULL,
  CONSTRAINT audit_retention_log_once UNIQUE (rule_code, subject_id),
  CONSTRAINT audit_retention_log_after_due CHECK (at >= due_at)
);
COMMENT ON TABLE core.audit_retention_log IS
  'AUD : journal des purges et pseudonymisations (LEG-009), une ligne par sujet et par règle ; '
  'ajout seul, aucune donnée personnelle. US-111 (ADR-118).';

CREATE FUNCTION core.privacy_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_retention_log : registre en ajout seul (% refusé)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$fn$;
REVOKE ALL ON FUNCTION core.privacy_append_only() FROM PUBLIC;
CREATE TRIGGER audit_retention_log_append_only BEFORE UPDATE OR DELETE ON core.audit_retention_log
  FOR EACH ROW EXECUTE FUNCTION core.privacy_append_only();
CREATE TRIGGER audit_retention_log_no_truncate BEFORE TRUNCATE ON core.audit_retention_log
  FOR EACH STATEMENT EXECUTE FUNCTION core.privacy_append_only();

-- 6. RLS (ENABLE + FORCE) et droits ---------------------------------------------------------------
ALTER TABLE core.audit_subprocessor ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_subprocessor FORCE ROW LEVEL SECURITY;
ALTER TABLE core.audit_retention_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_retention_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE core.audit_processing_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_processing_activity FORCE ROW LEVEL SECURITY;
ALTER TABLE core.audit_data_subject_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_data_subject_request FORCE ROW LEVEL SECURITY;
ALTER TABLE core.audit_retention_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_retention_log FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.audit_subprocessor TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.audit_retention_rule TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.audit_processing_activity TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.audit_data_subject_request TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.audit_retention_log TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.audit_subprocessor, core.audit_retention_rule, core.audit_processing_activity,
  core.audit_data_subject_request, core.audit_retention_log FROM PUBLIC;

-- privacy_cmd_owner : lecture du registre ; demandes et journal par ses seules commandes
GRANT SELECT ON core.audit_subprocessor, core.audit_retention_rule TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.audit_subprocessor FOR SELECT TO privacy_cmd_owner
  USING (true);
CREATE POLICY privacy_cmd_read ON core.audit_retention_rule FOR SELECT TO privacy_cmd_owner
  USING (true);
GRANT SELECT, INSERT ON core.audit_data_subject_request TO privacy_cmd_owner;
GRANT UPDATE (status, identity_verified_at, closed_at, handled_by, updated_at, overdue_alerted_at)
  ON core.audit_data_subject_request TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.audit_data_subject_request FOR SELECT TO privacy_cmd_owner
  USING (true);
CREATE POLICY privacy_cmd_insert ON core.audit_data_subject_request FOR INSERT
  TO privacy_cmd_owner WITH CHECK (status = 'RECEIVED');
-- une demande close ne bouge plus
CREATE POLICY privacy_cmd_update ON core.audit_data_subject_request FOR UPDATE
  TO privacy_cmd_owner USING (closed_at IS NULL) WITH CHECK (true);
GRANT SELECT, INSERT ON core.audit_retention_log TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.audit_retention_log FOR SELECT TO privacy_cmd_owner
  USING (true);
CREATE POLICY privacy_cmd_insert ON core.audit_retention_log FOR INSERT TO privacy_cmd_owner
  WITH CHECK (true);

-- tables existantes : le strict nécessaire
GRANT SELECT (key, country_code, scope_type, value, valid_from, valid_to)
  ON core.config_param_value TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.config_param_value FOR SELECT TO privacy_cmd_owner
  USING (key IN ('privacy_register_validated', 'privacy_dsr_response_days',
                 'evidence_retention_months'));
GRANT SELECT (id, requester_user_id, country_code) ON core.support_support_case TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.support_support_case FOR SELECT TO privacy_cmd_owner
  USING (true);
-- trips clos : seules les colonnes C2 de 17 §3.1.4 (motifs) sont remplacées par un marqueur
GRANT SELECT (id, country_code, status, scheduled_end, updated_at, termination_reason,
              cancellation_reason) ON core.booking_trip TO privacy_cmd_owner;
GRANT UPDATE (termination_reason, cancellation_reason) ON core.booking_trip TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.booking_trip FOR SELECT TO privacy_cmd_owner USING (true);
CREATE POLICY privacy_cmd_pseudonymise ON core.booking_trip FOR UPDATE TO privacy_cmd_owner
  USING (status IN ('COMPLETED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST', 'CANCELLED_BY_PLATFORM',
                    'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST', 'NO_SHOW_HOST'))
  WITH CHECK ((termination_reason IS NULL OR termination_reason = 'PSEUDONYMISED')
              AND (cancellation_reason IS NULL OR cancellation_reason = 'PSEUDONYMISED'));
GRANT SELECT (trip_id, updated_at) ON core.payment_payment_operation TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.payment_payment_operation FOR SELECT TO privacy_cmd_owner
  USING (true);
-- demandes d'effacement au fournisseur KYC (US-105) : états et dates seulement, jamais la
-- référence de session
GRANT SELECT (status, requested_at, completed_at) ON core.kyc_erasure_request TO privacy_cmd_owner;
CREATE POLICY privacy_cmd_read ON core.kyc_erasure_request FOR SELECT TO privacy_cmd_owner
  USING (true);

GRANT EXECUTE ON FUNCTION platform.now(), platform.uuid_v7(), platform.deployment_env()
  TO privacy_cmd_owner;

-- 7. Primitives (SECURITY INVOKER ; EXECUTE au seul privacy_cmd_owner) ----------------------------
-- Valeur en vigueur (jsonb) d'un paramètre de portée pays, NULL si absente.
CREATE FUNCTION core.privacy_param(p_key text, p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT v.value
    FROM core.config_param_value AS v CROSS JOIN t
   WHERE v.key = p_key
     AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts
     AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION core.privacy_param(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.privacy_param(text, text) TO privacy_cmd_owner;

-- Réservé au travailleur `privacy_request` (contexte posé par la couche BUS).
CREATE FUNCTION core.privacy_worker_guard()
  RETURNS void
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'privacy_request' THEN
    RAISE EXCEPTION 'aud : réservé au travailleur privacy_request'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION core.privacy_worker_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.privacy_worker_guard() TO privacy_cmd_owner;

-- 8. Critère 1 : garde du KYC de production (SECURITY DEFINER, EXECUTE app_api) -----------------
-- NULL : rien ne s'y oppose ; sinon le code du refus. Environnement inconnu = production
-- (L1-PM-05). Production : registre du pays validé (privacy_register_validated = true, absent =
-- false) ET un fournisseur KYC CONTRACTED en vigueur inscrit au registre des sous-traitants.
CREATE FUNCTION core.privacy_kyc_register_gate(p_country text)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := platform.now();
BEGIN
  IF p_country IS NULL OR p_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'aud : pays invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF COALESCE(platform.deployment_env(), 'production') <> 'production' THEN
    RETURN NULL;
  END IF;
  IF core.privacy_param('privacy_register_validated', p_country) IS DISTINCT FROM 'true'::jsonb
     OR NOT EXISTS (SELECT 1 FROM core.audit_subprocessor AS s
                     WHERE s.service = 'KYC' AND s.mode = 'CONTRACTED'
                       AND s.valid_from <= v_now AND (s.valid_to IS NULL OR s.valid_to > v_now)) THEN
    RETURN 'KYC_PRODUCTION_BLOCKED_NO_REGISTER';
  END IF;
  RETURN NULL;
END
$fn$;

-- 9. Critère 3 : HANDLE_DSR, commande liée (cadre d'US-101, signature imposée) ---------------------
-- Saisie fermée : `kind` (type de demande) et `step` (étape). Sujet : le dossier de support.
-- Machine d'états : (aucune) → RECEIVED ; RECEIVED → VERIFYING | IN_PROGRESS | REJECTED ;
-- VERIFYING → IN_PROGRESS | REJECTED ; IN_PROGRESS → BLOCKED_LEGAL_HOLD | DONE | REJECTED ;
-- BLOCKED_LEGAL_HOLD → IN_PROGRESS | DONE | REJECTED ; DONE et REJECTED : finals. Passer en
-- IN_PROGRESS atteste l'identité vérifiée (motif et pièces journalisés par le cadre). Refus
-- métier (aucune écriture) : DSR_INPUT_REQUIRED, DSR_NOT_OPEN, DSR_ALREADY_OPEN, DSR_KIND_MISMATCH,
-- DSR_TRANSITION_INVALID, DSR_DELAY_UNKNOWN. Issue DONE, ref_id = la demande.
CREATE FUNCTION core.privacy_manual_action_dsr(p_token_hash bytea, p_action_id uuid,
                                             p_action_code text, p_subject_id uuid,
                                             p_input jsonb, p_reason text,
                                             p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now   timestamptz := platform.now();
  v_kind  text := p_input ->> 'kind';
  v_step  text := p_input ->> 'step';
  v_case  record;
  v_dsr   record;
  v_days  jsonb;
  v_id    uuid;
BEGIN
  IF p_action_code IS DISTINCT FROM 'HANDLE_DSR' OR p_subject_id IS NULL OR p_actor IS NULL
     OR p_actor_role IS NULL THEN
    RAISE EXCEPTION 'dsr : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_step IS NULL THEN
    RETURN QUERY SELECT 'DSR_INPUT_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  SELECT c.id, c.requester_user_id, c.country_code INTO v_case
    FROM core.support_support_case AS c WHERE c.id = p_subject_id;
  -- une demande par dossier ; deux agents sur le même dossier : sérialisés
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('audit.dsr:' || p_subject_id::text, 0));
  SELECT d.id, d.kind, d.status, d.identity_verified_at INTO v_dsr
    FROM core.audit_data_subject_request AS d WHERE d.support_case_id = p_subject_id;

  IF v_dsr.id IS NULL THEN
    IF v_step <> 'RECEIVED' THEN
      RETURN QUERY SELECT 'DSR_NOT_OPEN'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    IF v_kind IS NULL THEN
      RETURN QUERY SELECT 'DSR_INPUT_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    v_days := core.privacy_param('privacy_dsr_response_days', v_case.country_code::text);
    IF v_days IS NULL OR pg_catalog.jsonb_typeof(v_days) <> 'number'
       OR (v_days #>> '{}') !~ '^[0-9]{1,3}$' OR (v_days #>> '{}')::integer < 1 THEN
      RETURN QUERY SELECT 'DSR_DELAY_UNKNOWN'::text, NULL::uuid, '{}'::uuid[];
      RETURN;
    END IF;
    v_id := platform.uuid_v7();
    INSERT INTO core.audit_data_subject_request
           (id, support_case_id, user_id, country_code, kind, status, received_at, due_at,
            handled_by, updated_at)
    VALUES (v_id, p_subject_id, v_case.requester_user_id, v_case.country_code, v_kind, 'RECEIVED',
            v_now, v_now + pg_catalog.make_interval(days => (v_days #>> '{}')::integer), p_actor,
            v_now);
    RETURN QUERY SELECT 'DONE'::text, v_id, '{}'::uuid[];
    RETURN;
  END IF;

  IF v_step = 'RECEIVED' THEN
    RETURN QUERY SELECT 'DSR_ALREADY_OPEN'::text, v_dsr.id, '{}'::uuid[];
    RETURN;
  END IF;
  IF v_kind IS NOT NULL AND v_kind <> v_dsr.kind THEN
    RETURN QUERY SELECT 'DSR_KIND_MISMATCH'::text, v_dsr.id, '{}'::uuid[];
    RETURN;
  END IF;
  IF NOT ((v_dsr.status = 'RECEIVED' AND v_step IN ('VERIFYING', 'IN_PROGRESS', 'REJECTED'))
       OR (v_dsr.status = 'VERIFYING' AND v_step IN ('IN_PROGRESS', 'REJECTED'))
       OR (v_dsr.status = 'IN_PROGRESS' AND v_step IN ('BLOCKED_LEGAL_HOLD', 'DONE', 'REJECTED'))
       OR (v_dsr.status = 'BLOCKED_LEGAL_HOLD' AND v_step IN ('IN_PROGRESS', 'DONE', 'REJECTED'))) THEN
    RETURN QUERY SELECT 'DSR_TRANSITION_INVALID'::text, v_dsr.id, '{}'::uuid[];
    RETURN;
  END IF;
  UPDATE core.audit_data_subject_request AS d
     SET status = v_step,
         identity_verified_at = CASE WHEN v_step = 'IN_PROGRESS'
                                     THEN COALESCE(d.identity_verified_at, v_now)
                                     ELSE d.identity_verified_at END,
         closed_at = CASE WHEN v_step IN ('DONE', 'REJECTED') THEN v_now END,
         handled_by = p_actor,
         updated_at = v_now
   WHERE d.id = v_dsr.id;
  RETURN QUERY SELECT 'DONE'::text, v_dsr.id, '{}'::uuid[];
END
$fn$;

-- 10. Critère 2 et suivi : travailleur `privacy_request` (SECURITY DEFINER, EXECUTE app_worker) --
-- Trips clos sans litige dont `evidence_retention_months` du pays est écoulé depuis la dernière
-- date du trip : motifs C2 remplacés par le marqueur PSEUDONYMISED, une ligne au journal par trip.
-- Pays sans durée : aucun trip traité (conservation, jamais une purge à l'aveugle). Lignes
-- verrouillées ailleurs : sautées (passe suivante). Rend le nombre de trips traités.
CREATE FUNCTION core.privacy_worker_retention_sweep(p_batch integer)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz := platform.now();
  v_t    record;
  v_cols text[];
  v_n    integer := 0;
BEGIN
  PERFORM core.privacy_worker_guard();
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'aud : lot de purge invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_t IN
    WITH months AS (
      SELECT c.country_code, (c.v #>> '{}')::integer AS n
        FROM (SELECT DISTINCT t.country_code,
                     core.privacy_param('evidence_retention_months', t.country_code) AS v
                FROM core.booking_trip AS t) AS c
       WHERE pg_catalog.jsonb_typeof(c.v) = 'number' AND (c.v #>> '{}') ~ '^[0-9]{1,3}$'
         AND (c.v #>> '{}')::integer >= 1
    ), due AS (
      SELECT t.id, t.country_code, t.termination_reason, t.cancellation_reason,
             GREATEST(t.scheduled_end, t.updated_at,
                      (SELECT pg_catalog.max(o.updated_at) FROM core.payment_payment_operation AS o
                        WHERE o.trip_id = t.id))
               + pg_catalog.make_interval(months => m.n) AS due_at
        FROM core.booking_trip AS t
        JOIN months AS m ON m.country_code = t.country_code
       WHERE t.status IN ('COMPLETED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST',
                          'CANCELLED_BY_PLATFORM', 'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST',
                          'NO_SHOW_HOST')
         AND NOT EXISTS (SELECT 1 FROM core.audit_retention_log AS l
                          WHERE l.rule_code = 'TRIP_CLOSED' AND l.subject_id = t.id)
    )
    SELECT d.* FROM due AS d WHERE d.due_at <= v_now ORDER BY d.due_at LIMIT p_batch
  LOOP
    -- relu et verrouillé : un trip rouvert (litige) ou verrouillé ailleurs n'est pas traité
    PERFORM 1 FROM core.booking_trip AS t
      WHERE t.id = v_t.id
        AND t.status IN ('COMPLETED', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST',
                         'CANCELLED_BY_PLATFORM', 'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST',
                         'NO_SHOW_HOST')
      FOR UPDATE SKIP LOCKED;
    CONTINUE WHEN NOT FOUND;
    v_cols := ARRAY[]::text[];
    IF v_t.termination_reason IS NOT NULL AND v_t.termination_reason <> 'PSEUDONYMISED' THEN
      v_cols := v_cols || 'termination_reason'::text;
    END IF;
    IF v_t.cancellation_reason IS NOT NULL AND v_t.cancellation_reason <> 'PSEUDONYMISED' THEN
      v_cols := v_cols || 'cancellation_reason'::text;
    END IF;
    IF pg_catalog.cardinality(v_cols) > 0 THEN
      UPDATE core.booking_trip AS t
         SET termination_reason = CASE WHEN t.termination_reason IS NULL THEN NULL
                                       ELSE 'PSEUDONYMISED' END,
             cancellation_reason = CASE WHEN t.cancellation_reason IS NULL THEN NULL
                                        ELSE 'PSEUDONYMISED' END
       WHERE t.id = v_t.id;
    END IF;
    INSERT INTO core.audit_retention_log (rule_code, subject_type, subject_id, country_code,
                                          action, columns, due_at, at)
    VALUES ('TRIP_CLOSED', 'TRIP', v_t.id, v_t.country_code, 'PSEUDONYMISATION', v_cols,
            v_t.due_at, v_now);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;

-- Demandes des personnes passées au-delà de leur échéance sans réponse : marquées UNE fois,
-- comptées par pays (une alerte par pays). Rend seulement les pays qui ont un nouveau retard.
CREATE FUNCTION core.privacy_worker_dsr_overdue(p_batch integer)
  RETURNS TABLE (country_code text, overdue integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now timestamptz := platform.now();
BEGIN
  PERFORM core.privacy_worker_guard();
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'aud : lot invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
    WITH late AS (
      SELECT d.id FROM core.audit_data_subject_request AS d
       WHERE d.closed_at IS NULL AND d.status <> 'BLOCKED_LEGAL_HOLD'
         AND d.overdue_alerted_at IS NULL AND d.due_at <= v_now
       ORDER BY d.due_at LIMIT p_batch
       FOR UPDATE SKIP LOCKED
    ), marked AS (
      UPDATE core.audit_data_subject_request AS d SET overdue_alerted_at = v_now
        FROM late WHERE d.id = late.id
      RETURNING d.country_code
    )
    SELECT m.country_code, pg_catalog.count(*)::integer FROM marked AS m
     GROUP BY m.country_code ORDER BY m.country_code;
END
$fn$;

-- Demandes d'effacement au fournisseur KYC (US-105) restées PENDING ou FAILED au-delà de
-- p_after_minutes : comptées (reprise par l'ops ; nouvel essai automatique quand un fournisseur
-- réel sera branché au travailleur, lot C). Aucune référence de session lue.
CREATE FUNCTION core.privacy_worker_stale_kyc_erasures(p_after_minutes integer)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := platform.now();
BEGIN
  PERFORM core.privacy_worker_guard();
  IF p_after_minutes IS NULL OR p_after_minutes < 1 OR p_after_minutes > 100000 THEN
    RAISE EXCEPTION 'aud : délai invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN (SELECT pg_catalog.count(*)::integer FROM core.kyc_erasure_request AS e
           WHERE (e.status = 'PENDING'
                  AND e.requested_at <= v_now - pg_catalog.make_interval(mins => p_after_minutes))
              OR (e.status = 'FAILED'));
END
$fn$;

COMMENT ON FUNCTION core.privacy_kyc_register_gate(text) IS
  'Garde du KYC de production (LEG-010) : KYC_PRODUCTION_BLOCKED_NO_REGISTER tant que le registre '
  'du pays n''est pas validé ou qu''aucun fournisseur KYC contractuel n''est inscrit ; NULL hors '
  'production. SECURITY DEFINER, EXECUTE app_api. US-111 (ADR-118).';
COMMENT ON FUNCTION core.privacy_manual_action_dsr(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à HANDLE_DSR (cadre d''US-101) : ouverture et étapes d''une demande de personne, '
  'échéance privacy_dsr_response_days. EXECUTE iam_staff_owner. US-111 (ADR-118).';
COMMENT ON FUNCTION core.privacy_worker_retention_sweep(integer) IS
  'Pseudonymisation des trips clos sans litige à échéance (evidence_retention_months), journalisée '
  'dans audit_retention_log ; travailleur privacy_request. SECURITY DEFINER, EXECUTE app_worker. '
  'US-111 (ADR-118).';
COMMENT ON FUNCTION core.privacy_worker_dsr_overdue(integer) IS
  'Demandes des personnes en retard, signalées une fois, comptées par pays ; travailleur '
  'privacy_request. SECURITY DEFINER, EXECUTE app_worker. US-111 (ADR-118).';
COMMENT ON FUNCTION core.privacy_worker_stale_kyc_erasures(integer) IS
  'Demandes d''effacement KYC en attente ou en échec, comptées ; travailleur privacy_request. '
  'SECURITY DEFINER, EXECUTE app_worker. US-111 (ADR-118).';

REVOKE ALL ON FUNCTION core.privacy_kyc_register_gate(text),
  core.privacy_manual_action_dsr(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  core.privacy_worker_retention_sweep(integer), core.privacy_worker_dsr_overdue(integer),
  core.privacy_worker_stale_kyc_erasures(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.privacy_kyc_register_gate(text) TO app_api;
GRANT EXECUTE ON FUNCTION core.privacy_manual_action_dsr(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.privacy_worker_retention_sweep(integer),
  core.privacy_worker_dsr_overdue(integer), core.privacy_worker_stale_kyc_erasures(integer)
  TO app_worker;

-- Propriétaire NOLOGIN (CREATE le temps du transfert seulement).
GRANT CREATE ON SCHEMA core TO privacy_cmd_owner;
ALTER FUNCTION core.privacy_kyc_register_gate(text) OWNER TO privacy_cmd_owner;
ALTER FUNCTION core.privacy_manual_action_dsr(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO privacy_cmd_owner;
ALTER FUNCTION core.privacy_worker_retention_sweep(integer) OWNER TO privacy_cmd_owner;
ALTER FUNCTION core.privacy_worker_dsr_overdue(integer) OWNER TO privacy_cmd_owner;
ALTER FUNCTION core.privacy_worker_stale_kyc_erasures(integer) OWNER TO privacy_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM privacy_cmd_owner;

-- 11. Catalogue des actions : HANDLE_DSR devient une action d'état liée ---------------------------
-- 17 §10 (NN9) en faisait une action d'enregistrement seul faute de table cible en Bêta : la table
-- existe désormais (PROPOSÉ, ADR-118). Permission et sujet inchangés (data.export, SUPPORT_CASE).
UPDATE core.support_manual_action_catalog
   SET mode = 'DOMAIN_COMMAND',
       input_keys = '{kind,step}',
       input_values = '{"kind": ["ACCESS", "RECTIFICATION", "DELETION", "OPPOSITION", "PORTABILITY"],
                        "step": ["RECEIVED", "VERIFYING", "IN_PROGRESS", "BLOCKED_LEGAL_HOLD",
                                 "DONE", "REJECTED"]}'::jsonb
 WHERE action_code = 'HANDLE_DSR';

-- Liaison (garde d'ADR-092 à l'INSERT : signature, SECURITY DEFINER, propriétaire NOLOGIN autre
-- qu'iam_staff_owner, EXECUTE à iam_staff_owner et à aucun rôle applicatif)
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('HANDLE_DSR',
        'core.privacy_manual_action_dsr(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-111');
