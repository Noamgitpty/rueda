-- 0072 — KYC : vérification d'identité par parcours hébergé et consentement biométrique.
-- US-105 ; 19 US-105 ; 16 VER-001 (« Given DOCS_SUBMITTED, When le webhook signé approved arrive
-- deux fois, Then une seule transition APPROVED ; signature invalide ⇒ rejet journalisé ; permis
-- expirant avant la fin du trip ⇒ KYC_LICENSE_EXPIRED »), VER-002 / VER-003 (scores seulement),
-- VER-004 (« aucun consentement biométrique ⇒ KYC_BIOMETRIC_CONSENT_MISSING, aucune session ;
-- nouvelle version du texte ⇒ toute nouvelle session exige cette version ») ; 08 BR-VERIF-01,
-- BR-VERIF-04 ; 17 §1.5 point 3 (zéro copie d'image, scores C3, rétentions les plus courtes),
-- §3.2.2 (`identity_verification`, `identity_document`, `liveness_check`), §3.2.6 (`consent`),
-- §4.5 (`kyc.verification.status_changed` : user_id, from, to, reason_code), §7.2
-- (`biometric_appeal_retention_days`) ; ADR-029 ; ADR-102 (cette migration). Appliquée sous
-- `migrator`.
--
-- Principes (ADR-102) :
--   - parcours HÉBERGÉ chez le fournisseur (port IdentityProvider, adaptateur FAKE seulement,
--     ADR-007) : l'application n'envoie ni pièce ni selfie et n'en reçoit aucun ; la base ne garde
--     que la référence de session, la décision, le code motif, les scores [C3] et les champs
--     minimaux du permis (type, pays, échéance, classe, caractère définitif, référence chez le
--     fournisseur). AUCUNE colonne d'image ni de fichier : une copie pour un dossier de
--     contestation viendra par une migration propre (17 §3.2.2 `front_file_id`, `copy_reason`) ;
--   - consentement biométrique SÉPARÉ, versionné (gabarit `BIOMETRIC_CONSENT` du registre de 0059,
--     contexte `KYC`) : sans acceptation de la version EN VIGUEUR, l'ouverture d'une vérification
--     est refusée AVANT toute écriture et l'API n'appelle pas le fournisseur ;
--   - deux temps pour l'ouverture : `core.kyc_cmd_open_verification` juge (session, compte,
--     téléphone vérifié, consentement, état) et prépare la tentative ; l'API appelle le
--     fournisseur avec la clé d'idempotence (vérification, tentative), puis
--     `core.kyc_cmd_record_session` pose la session (SM-3 `DOCS_SUBMITTED`) ;
--   - décision par rappel SIGNÉ : la signature est vérifiée par l'adaptateur (corps brut) ;
--     `core.kyc_cmd_apply_decision` est idempotente par (fournisseur, identifiant d'événement) :
--     un rappel rejoué rend DUPLICATE et n'écrit rien ; deux rappels distincts pour la même
--     session sont sérialisés par le verrou de ligne : une seule transition `APPROVED` ;
--     un rappel rejeté (signature, fraîcheur, forme) est journalisé
--     (`core.kyc_webhook_rejection`, empreinte du corps seulement, jamais le corps) ;
--   - la base juge l'issue à son horloge : `APPROVED` seulement si le fournisseur approuve ET si le
--     permis est un permis de conduire définitif, non expiré à la décision ; sinon
--     `MANUAL_REVIEW` avec un code motif (décision de l'ops : US-106). Seuils de score propres :
--     aucun paramètre en 17 §7.2, la décision du fournisseur fait foi (PROPOSÉ) ;
--   - rétention des scores : décision + `biometric_appeal_retention_days` du pays du dossier ;
--     paramètre absent (pays « à fixer ») ⇒ 0 jour, la valeur la plus courte (OQ-BR-25, PROPOSÉ) ;
--   - contrôle bloquant du paiement : `core.kyc_driver_eligibility` rend KYC_LICENSE_EXPIRED si
--     le permis expire avant la fin du trip (fin du jour d'échéance dans le fuseau du pays du
--     trip), à poser par US-209 ;
--   - KYC de production désactivé tant que le registre LEG-010 n'est pas validé (OQ-MK-09,
--     défaut PROPOSÉ ; RISKS L1-PM-05) : garde EN BASE (`COALESCE(platform.deployment_env(),
--     'production') = 'production'` ⇒ `PRODUCTION_BLOCKED`, rien n'est écrit) dans l'ouverture et la
--     décision, reprise par US-111 ; en plus, aucun fournisseur n'est compilé dans l'image de
--     production (ouverture 503, rappel 404) ;
--   - RETRAIT du consentement biométrique (VER-004 ; RISKS L1-PM-39) : la commande révoque le
--     consentement, efface les scores [C3] et les références chez le fournisseur, inscrit une
--     demande d'effacement par session (`kyc_erasure_request`, datée ; l'API l'exécute par le port
--     `IdentityProvider.requestErasure` et en consigne l'attestation), repasse le dossier en
--     `RECHECK` (réservation bloquée), émet `kyc.consent.withdrawn` et un événement d'état, et
--     journalise l'audit. Un rappel reçu sans consentement en vigueur n'écrit rien
--     (`CONSENT_WITHDRAWN`) ; l'éligibilité au paiement le refuse aussi ;
--   - purge : le travailleur `kyc_score_pruner` efface les scores arrivés à `retention_until` et
--     les rejets de rappels de plus de 90 jours (PROPOSÉ) ; le journal des rejets est plafonné
--     (600 par minute et par fournisseur, PROPOSÉ).
--
-- Écarts PROPOSÉS avec 17 §3.2.2 (à reporter, ADR-102) : `identity_verification` gagne
-- `country_code` (pays du dossier, porteur des paramètres), `attempt` (tentative courante, clé
-- d'idempotence du fournisseur), `hosted_url` et `session_expires_at` (reprise d'une session
-- vivante), `row_version` ; `doc_type` prend des types neutres (NATIONAL_ID, FOREIGN_RESIDENT_ID au lieu des noms de pièces
-- propres à un pays : lint « aucune constante pays », ADR-024) ; `risk_tier`, `appeal_deadline_at`,
-- `more_info_deadline_at` et, pour
-- `identity_document`, `number_enc`, `number_bidx`, `front_file_id`, `back_file_id`,
-- `copy_reason` sont reportés (aucun écrivain dans cette story) ; `liveness_check.selfie_file_id`
-- n'existe pas (zéro copie) ; `liveness_check.erased_at` (scores effacés) ; nouvelles tables
-- techniques `kyc_provider_event` (idempotence des rappels), `kyc_webhook_rejection` (journal des
-- rejets) et `kyc_erasure_request` (demandes d'effacement au fournisseur).
--
-- Retour arrière :
--   DROP FUNCTION core.kyc_identity_state(bytea, text),
--     core.kyc_cmd_biometric_consent(bytea, text, integer, boolean),
--     core.kyc_cmd_open_verification(bytea, text, text),
--     core.kyc_cmd_record_session(bytea, uuid, integer, text, text, text, timestamptz),
--     core.kyc_cmd_apply_decision(text, text, text, text, text, numeric, numeric, jsonb),
--     core.kyc_cmd_record_webhook_rejection(text, text, bytea, integer),
--     core.kyc_driver_eligibility(bytea, timestamptz, text),
--     core.kyc_pending_erasures(bytea), core.kyc_cmd_record_erasure(bytea, uuid, text, text),
--     core.kyc_worker_prune(integer),
--     core.kyc_biometric_template(text, text), core.kyc_consent_current(uuid, text),
--     core.kyc_retention_days(text), core.kyc_emit_status(uuid, uuid, integer, text, text, text,
--     text, uuid, text);
--   DROP TABLE core.kyc_erasure_request, core.kyc_webhook_rejection, core.kyc_provider_event, core.kyc_liveness_check,
--     core.kyc_identity_document, core.kyc_identity_verification;
--   DELETE FROM core.contract_document_template WHERE kind = 'BIOMETRIC_CONSENT' (base sans
--     consentement biométrique seulement) ; DROP POLICY kyc_cmd_* sur les tables de 0010, 0012,
--     0059 et de la configuration ; révoquer les droits accordés ci-dessous.

-- 1. Socle de kyc_cmd_owner (propriétaire NOLOGIN des commandes KYC, amorçage) --------------------
GRANT USAGE ON SCHEMA core, platform TO kyc_cmd_owner;
GRANT EXECUTE ON FUNCTION platform.now(), platform.uuid_v7(), platform.deployment_env()
  TO kyc_cmd_owner;

-- session de la personne (fonction d'iam_auth_owner : seul son propriétaire accorde EXECUTE)
SET LOCAL ROLE iam_auth_owner;
GRANT EXECUTE ON FUNCTION core.iam_session_resolve(bytea) TO kyc_cmd_owner;
RESET ROLE;

-- compte : statut, e-mail et téléphone vérifiés, langue, pseudonymisation (jamais un nom ni un
-- contact)
GRANT SELECT (id, status, email_verified_at, phone_verified_at, pseudonymized_at, preferred_locale)
  ON core.iam_user_account TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_read ON core.iam_user_account FOR SELECT TO kyc_cmd_owner USING (true);

-- pays de la configuration (code, fuseau) et durée de rétention biométrique du pays
GRANT SELECT (code, time_zone) ON core.config_country TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_read ON core.config_country FOR SELECT TO kyc_cmd_owner USING (true);
GRANT SELECT (key, country_code, scope_type, value, valid_from, valid_to)
  ON core.config_param_value TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_read ON core.config_param_value FOR SELECT TO kyc_cmd_owner
  USING (key = 'biometric_appeal_retention_days');

-- consentement biométrique : gabarits et consentements de ce seul genre, ajout seul (0059)
GRANT SELECT ON core.contract_document_template TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_read ON core.contract_document_template FOR SELECT TO kyc_cmd_owner
  USING (kind = 'BIOMETRIC_CONSENT');
GRANT SELECT ON core.contract_consent TO kyc_cmd_owner;
GRANT INSERT (user_id, template_id, doc_kind, doc_version, locale, accepted, accepted_at, context,
              country_code, c2_withheld)
  ON core.contract_consent TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_read ON core.contract_consent FOR SELECT TO kyc_cmd_owner
  USING (doc_kind = 'BIOMETRIC_CONSENT');
CREATE POLICY kyc_cmd_insert ON core.contract_consent FOR INSERT TO kyc_cmd_owner
  WITH CHECK (doc_kind = 'BIOMETRIC_CONSENT' AND context = 'KYC' AND c2_withheld
              AND ip_enc IS NULL AND user_agent_enc IS NULL);

-- événement kyc.verification.status_changed (17 §4.5)
GRANT INSERT (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  ON core.outbox_outbox_event TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_event_ins ON core.outbox_outbox_event FOR INSERT TO kyc_cmd_owner
  WITH CHECK (((type = 'kyc.verification.status_changed'
                AND aggregate_type = 'identity_verification')
               OR (type = 'kyc.consent.withdrawn' AND aggregate_type = 'user_account'))
              AND actor_role IN ('GUEST', 'SYSTEM'));

-- journal d'audit : retrait du consentement et effacement chez le fournisseur (la chaîne attribue
-- id, at, hachages)
GRANT INSERT (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after)
  ON core.audit_audit_log TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_audit_insert ON core.audit_audit_log FOR INSERT TO kyc_cmd_owner
  WITH CHECK (action_code IN ('KYC_CONSENT_WITHDRAWN', 'KYC_ERASURE_RECORDED')
              AND subject_type = 'USER_ACCOUNT');

-- 2. Tables (17 §3.2.2) ----------------------------------------------------------------------------
-- 2.1 Vérification courante d'une personne (SM-3). Une seule vérification courante par personne.
CREATE TABLE core.kyc_identity_verification (
  id                    uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_identity_verification_pkey PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES core.iam_user_account (id),
  -- pays du dossier (pays de délivrance du permis, parmi les pays de la configuration) : porteur
  -- des paramètres (rétention) ; jamais la résidence (suite N-28)
  country_code          char(2)     NOT NULL REFERENCES core.config_country (code),
  status                text        NOT NULL
    CONSTRAINT kyc_identity_verification_status_valid CHECK (status IN (
      'NOT_STARTED', 'PHONE_VERIFIED', 'DOCS_SUBMITTED', 'AUTO_CHECKS', 'MANUAL_REVIEW',
      'MORE_INFO_REQUIRED', 'APPROVED', 'RECHECK', 'EXPIRED', 'REVOKED', 'REJECTED', 'APPEAL',
      'REJECTED_FINAL', 'BANNED')),
  is_current            boolean     NOT NULL DEFAULT true,
  -- tentative courante : clé d'idempotence du fournisseur (vérification, tentative)
  attempt               integer     NOT NULL DEFAULT 1
    CONSTRAINT kyc_identity_verification_attempt_positive CHECK (attempt >= 1),
  provider              text
    CONSTRAINT kyc_identity_verification_provider_format
      CHECK (provider IS NULL OR provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  provider_session_ref  text
    CONSTRAINT kyc_identity_verification_session_ref_length
      CHECK (provider_session_ref IS NULL OR pg_catalog.length(provider_session_ref) BETWEEN 1 AND 200),
  -- adresse de la session hébergée (aucune donnée du sujet : contrôlé par l'adaptateur)
  hosted_url            text
    CONSTRAINT kyc_identity_verification_hosted_url_format
      CHECK (hosted_url IS NULL OR (hosted_url ~ '^https://' AND pg_catalog.length(hosted_url) <= 500)),
  session_expires_at    timestamptz,
  decision_reason_code  text
    CONSTRAINT kyc_identity_verification_reason_format
      CHECK (decision_reason_code IS NULL OR decision_reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  reviewed_by           uuid        REFERENCES core.iam_user_account (id),
  approved_at           timestamptz,
  -- fin de validité du permis (fin du jour d'échéance dans le fuseau du pays du dossier)
  expires_at            timestamptz,
  row_version           integer     NOT NULL DEFAULT 0
    CONSTRAINT kyc_identity_verification_row_version_valid CHECK (row_version >= 0),
  created_at            timestamptz NOT NULL DEFAULT platform.now(),
  updated_at            timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT kyc_identity_verification_session_pair
    CHECK ((provider_session_ref IS NULL) = (session_expires_at IS NULL)),
  CONSTRAINT kyc_identity_verification_session_provider
    CHECK (provider_session_ref IS NULL OR provider IS NOT NULL),
  CONSTRAINT kyc_identity_verification_approved_coherent
    CHECK (status <> 'APPROVED' OR (approved_at IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE UNIQUE INDEX kyc_identity_verification_current_unique
  ON core.kyc_identity_verification (user_id) WHERE is_current;
CREATE UNIQUE INDEX kyc_identity_verification_session_unique
  ON core.kyc_identity_verification (provider, provider_session_ref)
  WHERE provider_session_ref IS NOT NULL;
COMMENT ON TABLE core.kyc_identity_verification IS
  'KYC identity_verification (17 §3.2.2, SM-3) : vérification courante par personne, parcours '
  'hébergé du fournisseur ; référence de session et décision seulement, aucune image. Écrite par '
  'les commandes 0072 seulement. US-105 (ADR-102).';

-- 2.2 Champs minimaux du permis rendus par le fournisseur (aucune image, aucun numéro).
CREATE TABLE core.kyc_identity_document (
  id                     uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_identity_document_pkey PRIMARY KEY,
  verification_id        uuid        NOT NULL REFERENCES core.kyc_identity_verification (id),
  -- personne du dossier (sujet : export et effacement, US-536)
  user_id                uuid        NOT NULL REFERENCES core.iam_user_account (id),
  attempt                integer     NOT NULL
    CONSTRAINT kyc_identity_document_attempt_positive CHECK (attempt >= 1),
  doc_type               text        NOT NULL
    CONSTRAINT kyc_identity_document_type_valid
      CHECK (doc_type IN ('DRIVER_LICENSE', 'NATIONAL_ID', 'FOREIGN_RESIDENT_ID', 'PASSPORT', 'IDP')),
  -- pays de délivrance (code ISO, pas forcément un pays de la configuration)
  issuing_country        char(2)     NOT NULL
    CONSTRAINT kyc_identity_document_country_format CHECK (issuing_country ~ '^[A-Z]{2}$'),
  expiry_date            date,                                               -- [C2]
  license_class          text                                                -- [C2]
    CONSTRAINT kyc_identity_document_class_length
      CHECK (license_class IS NULL OR pg_catalog.length(license_class) BETWEEN 1 AND 20),
  -- VER-006 : un permis provisoire n'est pas accepté ; NULL = inconnu (revue)
  is_permanent           boolean,
  provider_document_ref  text
    CONSTRAINT kyc_identity_document_ref_length
      CHECK (provider_document_ref IS NULL OR pg_catalog.length(provider_document_ref) BETWEEN 1 AND 200),
  status                 text        NOT NULL
    CONSTRAINT kyc_identity_document_status_valid CHECK (status IN ('ACCEPTED', 'IN_REVIEW')),
  -- ≥ 15 mois après la dernière opération monétaire du dernier trip (REQ-PAY-DMG-11, OQ-BR-25) :
  -- posé par la clôture monétaire (US-2xx) ; NULL tant qu'aucun trip n'en dépend
  retention_until        timestamptz,
  created_at             timestamptz NOT NULL DEFAULT platform.now()
);
CREATE INDEX kyc_identity_document_verification_idx
  ON core.kyc_identity_document (verification_id, attempt);
COMMENT ON TABLE core.kyc_identity_document IS
  'KYC identity_document (17 §3.2.2) : champs minimaux du permis rendus par le fournisseur (type, '
  'pays, échéance, classe, définitif, référence) ; aucune image ni numéro. US-105 (ADR-102).';

-- 2.3 Scores de liveness et de face match [C3] ; aucune copie du selfie.
CREATE TABLE core.kyc_liveness_check (
  id                    uuid          NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_liveness_check_pkey PRIMARY KEY,
  verification_id       uuid          NOT NULL REFERENCES core.kyc_identity_verification (id),
  -- personne du dossier (sujet : export et effacement, US-536)
  user_id               uuid          NOT NULL REFERENCES core.iam_user_account (id),
  attempt               integer       NOT NULL
    CONSTRAINT kyc_liveness_check_attempt_positive CHECK (attempt >= 1),
  liveness_score        numeric(5,4)                                        -- [C3]
    CONSTRAINT kyc_liveness_check_liveness_range
      CHECK (liveness_score IS NULL OR liveness_score BETWEEN 0 AND 1),
  face_match_score      numeric(5,4)                                        -- [C3]
    CONSTRAINT kyc_liveness_check_face_range
      CHECK (face_match_score IS NULL OR face_match_score BETWEEN 0 AND 1),
  result                text          NOT NULL
    CONSTRAINT kyc_liveness_check_result_valid CHECK (result IN ('APPROVED', 'DECLINED', 'REVIEW')),
  provider_session_ref  text
    CONSTRAINT kyc_liveness_check_session_ref_length
      CHECK (provider_session_ref IS NULL OR pg_catalog.length(provider_session_ref) BETWEEN 1 AND 200),
  -- décision + biometric_appeal_retention_days du pays (17 §3.2.2 ; plafond VER-004 ≤ 3 ans)
  retention_until       timestamptz   NOT NULL,
  -- scores et référence effacés (retrait du consentement ou échéance de rétention)
  erased_at             timestamptz,
  created_at            timestamptz   NOT NULL DEFAULT platform.now(),
  CONSTRAINT kyc_liveness_check_erased_coherent CHECK (
    (erased_at IS NULL AND provider_session_ref IS NOT NULL)
    OR (erased_at IS NOT NULL AND liveness_score IS NULL AND face_match_score IS NULL
        AND provider_session_ref IS NULL))
);
CREATE INDEX kyc_liveness_check_verification_idx ON core.kyc_liveness_check (verification_id);
CREATE INDEX kyc_liveness_check_retention_idx ON core.kyc_liveness_check (retention_until)
  WHERE erased_at IS NULL;
COMMENT ON TABLE core.kyc_liveness_check IS
  'KYC liveness_check (17 §3.2.2) : scores de liveness et de face match [C3] et décision du '
  'fournisseur ; aucune image. Rétention : décision + biometric_appeal_retention_days. US-105.';

-- 2.4 Rappels acceptés : idempotence par (fournisseur, identifiant d'événement).
CREATE TABLE core.kyc_provider_event (
  id            uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_provider_event_pkey PRIMARY KEY,
  provider      text        NOT NULL
    CONSTRAINT kyc_provider_event_provider_format CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  event_id      text        NOT NULL
    CONSTRAINT kyc_provider_event_event_id_length CHECK (pg_catalog.length(event_id) BETWEEN 1 AND 200),
  session_ref   text        NOT NULL
    CONSTRAINT kyc_provider_event_session_ref_length CHECK (pg_catalog.length(session_ref) BETWEEN 1 AND 200),
  decision      text        NOT NULL
    CONSTRAINT kyc_provider_event_decision_valid CHECK (decision IN ('APPROVED', 'DECLINED', 'REVIEW')),
  outcome       text
    CONSTRAINT kyc_provider_event_outcome_valid
      CHECK (outcome IS NULL OR outcome IN ('APPLIED', 'STALE', 'CONSENT_WITHDRAWN')),
  received_at   timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT kyc_provider_event_unique UNIQUE (provider, event_id)
);
COMMENT ON TABLE core.kyc_provider_event IS
  'KYC : rappels de décision acceptés (signature vérifiée), un par (fournisseur, événement) ; '
  'un rappel rejoué n''écrit rien. US-105 (ADR-102).';

-- 2.5 Rappels rejetés (signature, fraîcheur, forme) : empreinte du corps seulement.
CREATE TABLE core.kyc_webhook_rejection (
  id            uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_webhook_rejection_pkey PRIMARY KEY,
  provider      text        NOT NULL
    CONSTRAINT kyc_webhook_rejection_provider_format CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  reason        text        NOT NULL
    CONSTRAINT kyc_webhook_rejection_reason_valid
      CHECK (reason IN ('BAD_SIGNATURE', 'STALE', 'MALFORMED')),
  body_sha256   bytea       NOT NULL
    CONSTRAINT kyc_webhook_rejection_sha256 CHECK (pg_catalog.octet_length(body_sha256) = 32),
  body_length   integer     NOT NULL
    CONSTRAINT kyc_webhook_rejection_length_valid CHECK (body_length >= 0),
  received_at   timestamptz NOT NULL DEFAULT platform.now()
);
CREATE INDEX kyc_webhook_rejection_received_idx
  ON core.kyc_webhook_rejection (provider, received_at);

-- 2.6 Demandes d'effacement au fournisseur (retrait du consentement, VER-004 : « la demande de
-- purge au fournisseur est tracée avec date »). La référence de session n'est gardée que le temps
-- de la demande : effacée quand le fournisseur atteste l'effacement.
CREATE TABLE core.kyc_erasure_request (
  id                    uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_erasure_request_pkey PRIMARY KEY,
  user_id               uuid        NOT NULL REFERENCES core.iam_user_account (id),
  verification_id       uuid        NOT NULL REFERENCES core.kyc_identity_verification (id),
  provider              text        NOT NULL
    CONSTRAINT kyc_erasure_request_provider_format CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  provider_session_ref  text
    CONSTRAINT kyc_erasure_request_session_ref_length
      CHECK (provider_session_ref IS NULL OR pg_catalog.length(provider_session_ref) BETWEEN 1 AND 200),
  status                text        NOT NULL DEFAULT 'PENDING'
    CONSTRAINT kyc_erasure_request_status_valid CHECK (status IN ('PENDING', 'DONE', 'FAILED')),
  attestation_ref       text
    CONSTRAINT kyc_erasure_request_attestation_length
      CHECK (attestation_ref IS NULL OR pg_catalog.length(attestation_ref) BETWEEN 1 AND 200),
  requested_at          timestamptz NOT NULL DEFAULT platform.now(),
  completed_at          timestamptz,
  CONSTRAINT kyc_erasure_request_done_coherent CHECK (
    (status = 'PENDING' AND completed_at IS NULL AND provider_session_ref IS NOT NULL)
    OR (status = 'FAILED' AND completed_at IS NOT NULL AND provider_session_ref IS NOT NULL)
    OR (status = 'DONE' AND completed_at IS NOT NULL AND provider_session_ref IS NULL))
);
CREATE INDEX kyc_erasure_request_user_idx ON core.kyc_erasure_request (user_id, status);
COMMENT ON TABLE core.kyc_erasure_request IS
  'KYC : demandes d''effacement au fournisseur (retrait du consentement biométrique, VER-004), '
  'datées ; référence de session effacée quand le fournisseur atteste. US-105 (ADR-102).';
COMMENT ON TABLE core.kyc_webhook_rejection IS
  'KYC : journal des rappels rejetés (signature invalide, périmés, mal formés) ; empreinte '
  'SHA-256 et longueur du corps, jamais le corps. US-105 (ADR-102).';

-- 3. RLS : aucun droit de table pour les rôles applicatifs --------------------------------------
ALTER TABLE core.kyc_identity_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_identity_verification FORCE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_identity_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_identity_document FORCE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_liveness_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_liveness_check FORCE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_provider_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_provider_event FORCE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_webhook_rejection ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_webhook_rejection FORCE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_erasure_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_erasure_request FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.kyc_identity_verification TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.kyc_identity_document TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.kyc_liveness_check TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.kyc_provider_event TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.kyc_webhook_rejection TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.kyc_erasure_request TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.kyc_identity_verification, core.kyc_identity_document, core.kyc_liveness_check,
  core.kyc_provider_event, core.kyc_webhook_rejection, core.kyc_erasure_request FROM PUBLIC;

-- kyc_cmd_owner : ses commandes seules
GRANT SELECT, INSERT ON core.kyc_identity_verification TO kyc_cmd_owner;
GRANT UPDATE (country_code, status, attempt, provider, provider_session_ref, hosted_url,
              session_expires_at, decision_reason_code, approved_at, expires_at, row_version,
              updated_at)
  ON core.kyc_identity_verification TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.kyc_identity_verification FOR SELECT TO kyc_cmd_owner
  USING (true);
-- une vérification naît courante, sans session ni décision
CREATE POLICY kyc_cmd_insert ON core.kyc_identity_verification FOR INSERT TO kyc_cmd_owner
  WITH CHECK (is_current AND status = 'PHONE_VERIFIED' AND provider_session_ref IS NULL
              AND approved_at IS NULL AND reviewed_by IS NULL);
-- seule la vérification courante change (les transitions sont jugées par les commandes ; le
-- retrait du consentement fait passer un dossier APPROVED en RECHECK)
CREATE POLICY kyc_cmd_update ON core.kyc_identity_verification FOR UPDATE TO kyc_cmd_owner
  USING (is_current) WITH CHECK (is_current);
GRANT SELECT, INSERT ON core.kyc_identity_document, core.kyc_liveness_check TO kyc_cmd_owner;
-- effacement : référence du document ; scores et référence de session (retrait, rétention)
GRANT UPDATE (provider_document_ref) ON core.kyc_identity_document TO kyc_cmd_owner;
GRANT UPDATE (liveness_score, face_match_score, provider_session_ref, erased_at)
  ON core.kyc_liveness_check TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_update ON core.kyc_identity_document FOR UPDATE TO kyc_cmd_owner
  USING (provider_document_ref IS NOT NULL) WITH CHECK (provider_document_ref IS NULL);
CREATE POLICY kyc_cmd_update ON core.kyc_liveness_check FOR UPDATE TO kyc_cmd_owner
  USING (erased_at IS NULL) WITH CHECK (erased_at IS NOT NULL);
CREATE POLICY kyc_cmd_select ON core.kyc_identity_document FOR SELECT TO kyc_cmd_owner USING (true);
CREATE POLICY kyc_cmd_insert ON core.kyc_identity_document FOR INSERT TO kyc_cmd_owner
  WITH CHECK (true);
CREATE POLICY kyc_cmd_select ON core.kyc_liveness_check FOR SELECT TO kyc_cmd_owner USING (true);
CREATE POLICY kyc_cmd_insert ON core.kyc_liveness_check FOR INSERT TO kyc_cmd_owner
  WITH CHECK (true);
GRANT SELECT, INSERT ON core.kyc_provider_event TO kyc_cmd_owner;
GRANT UPDATE (outcome) ON core.kyc_provider_event TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.kyc_provider_event FOR SELECT TO kyc_cmd_owner USING (true);
CREATE POLICY kyc_cmd_insert ON core.kyc_provider_event FOR INSERT TO kyc_cmd_owner
  WITH CHECK (outcome IS NULL);
CREATE POLICY kyc_cmd_update ON core.kyc_provider_event FOR UPDATE TO kyc_cmd_owner
  USING (outcome IS NULL) WITH CHECK (outcome IS NOT NULL);
GRANT SELECT, INSERT, DELETE ON core.kyc_webhook_rejection TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.kyc_webhook_rejection FOR SELECT TO kyc_cmd_owner
  USING (true);
CREATE POLICY kyc_cmd_insert ON core.kyc_webhook_rejection FOR INSERT TO kyc_cmd_owner
  WITH CHECK (true);
-- purge au-delà de 90 jours seulement (PROPOSÉ)
CREATE POLICY kyc_cmd_delete ON core.kyc_webhook_rejection FOR DELETE TO kyc_cmd_owner
  USING (received_at < platform.now() - pg_catalog.make_interval(days => 90));
GRANT SELECT, INSERT ON core.kyc_erasure_request TO kyc_cmd_owner;
GRANT UPDATE (provider_session_ref, status, attestation_ref, completed_at)
  ON core.kyc_erasure_request TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.kyc_erasure_request FOR SELECT TO kyc_cmd_owner USING (true);
CREATE POLICY kyc_cmd_insert ON core.kyc_erasure_request FOR INSERT TO kyc_cmd_owner
  WITH CHECK (status = 'PENDING');
CREATE POLICY kyc_cmd_update ON core.kyc_erasure_request FOR UPDATE TO kyc_cmd_owner
  USING (status = 'PENDING') WITH CHECK (status IN ('DONE', 'FAILED'));

-- 4. Primitives (SECURITY INVOKER ; EXECUTE au seul kyc_cmd_owner) ---------------------------------
-- Gabarit du consentement biométrique en vigueur : documents du pays s'il en existe un en vigueur,
-- sinon documents communs ; plus haute version en vigueur ; langue demandée, sinon celle qui fait
-- foi (mêmes règles que core.ctr_current_template de 0059, pour ce seul genre).
CREATE FUNCTION core.kyc_biometric_template(p_country text, p_language text)
  RETURNS SETOF core.contract_document_template
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t0 AS (SELECT platform.now() AS ts),
  scope AS (
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM core.contract_document_template AS t, t0
              WHERE t.kind = 'BIOMETRIC_CONSENT' AND t.country_code = p_country
                AND t.valid_from <= t0.ts)
           THEN p_country END AS country
  ), latest AS (
    SELECT pg_catalog.max(t.version) AS version
      FROM core.contract_document_template AS t, scope, t0
     WHERE t.kind = 'BIOMETRIC_CONSENT' AND t.country_code IS NOT DISTINCT FROM scope.country
       AND t.valid_from <= t0.ts
  )
  SELECT t.*
    FROM core.contract_document_template AS t, scope, latest
   WHERE t.kind = 'BIOMETRIC_CONSENT' AND t.country_code IS NOT DISTINCT FROM scope.country
     AND t.version = latest.version
     AND (t.locale = p_language OR t.is_authoritative)
   ORDER BY (t.locale = p_language) DESC
   LIMIT 1
$fn$;

-- Consentement biométrique courant de la personne : dernière ligne de ce genre, acceptée, et pour
-- la version EN VIGUEUR dans la portée du pays (VER-004 : une nouvelle version exige une nouvelle
-- acceptation). Rend la version acceptée, ou NULL.
CREATE FUNCTION core.kyc_consent_current(p_user uuid, p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH cur AS (SELECT t.version, t.country_code
                 FROM core.kyc_biometric_template(p_country, 'es') AS t),
  latest AS (
    SELECT c.accepted, c.doc_version, g.country_code
      FROM core.contract_consent AS c
      JOIN core.contract_document_template AS g ON g.id = c.template_id
     WHERE c.user_id = p_user AND c.doc_kind = 'BIOMETRIC_CONSENT'
     ORDER BY c.seq DESC LIMIT 1
  )
  SELECT l.doc_version FROM latest AS l, cur
   WHERE l.accepted AND l.doc_version = cur.version
     AND l.country_code IS NOT DISTINCT FROM cur.country_code
$fn$;

-- Durée de rétention des scores (jours) du pays : `biometric_appeal_retention_days` en vigueur ;
-- absente ou mal formée ⇒ 0 (la valeur la plus courte, OQ-BR-25, PROPOSÉ).
CREATE FUNCTION core.kyc_retention_days(p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT COALESCE((
    SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                     AND (v.value #>> '{}') ~ '^[0-9]{1,4}$'
                THEN (v.value #>> '{}')::integer END
      FROM core.config_param_value AS v CROSS JOIN t
     WHERE v.key = 'biometric_appeal_retention_days'
       AND v.country_code::text = p_country
       AND v.scope_type = 'COUNTRY'
       AND v.valid_from <= t.ts
       AND (v.valid_to IS NULL OR v.valid_to > t.ts)
     ORDER BY v.valid_from DESC
     LIMIT 1), 0)
$fn$;

-- Événement kyc.verification.status_changed (17 §4.5 : user_id, from, to, reason_code).
CREATE FUNCTION core.kyc_emit_status(p_verification uuid, p_user uuid, p_version integer,
                                     p_from text, p_to text, p_reason text, p_country text,
                                     p_actor uuid, p_actor_role text)
  RETURNS void
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('kyc.verification.status_changed', 1, 'identity_verification', p_verification,
          p_version, p_country, p_actor, p_actor_role, pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('user_id', p_user, 'from', p_from, 'to', p_to,
                                        'reason_code', p_reason),
          p_user::text)
$fn$;

REVOKE ALL ON FUNCTION core.kyc_biometric_template(text, text), core.kyc_consent_current(uuid, text),
  core.kyc_retention_days(text),
  core.kyc_emit_status(uuid, uuid, integer, text, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_biometric_template(text, text),
  core.kyc_consent_current(uuid, text), core.kyc_retention_days(text),
  core.kyc_emit_status(uuid, uuid, integer, text, text, text, text, uuid, text) TO kyc_cmd_owner;

-- 5. État de la vérification de la personne de la session (SECURITY DEFINER, EXECUTE app_api) ----
-- Ses seules données : statut SM-3, pays du dossier, code motif, échéance du permis, session
-- hébergée vivante, téléphone vérifié (pré-requis de l'ouverture), consentement (version en
-- vigueur, version acceptée, texte dans sa langue).
-- Portée du consentement : pays du dossier s'il existe, sinon `p_country` (pays du parcours).
-- Session invalide : AUTH_REQUIRED et rien d'autre.
CREATE FUNCTION core.kyc_identity_state(p_token_hash bytea, p_country text)
  RETURNS TABLE (outcome text, status text, country_code text, reason_code text,
                 license_expires_on date, session_live boolean, phone_verified boolean,
                 consent_version integer,
                 consent_accepted_version integer, consent_locale text, consent_title text,
                 consent_body text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_now     timestamptz := platform.now();
  v_v       record;
  v_lang    text;
  v_country text;
  v_t       core.contract_document_template%ROWTYPE;
  v_exp     date;
  v_phone   boolean;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::text, NULL::text, NULL::date,
                        NULL::boolean, NULL::boolean, NULL::integer, NULL::integer, NULL::text,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT pg_catalog.split_part(u.preferred_locale, '-', 1), u.phone_verified_at IS NOT NULL
    INTO v_lang, v_phone
    FROM core.iam_user_account AS u WHERE u.id = v_user;
  SELECT v.* INTO v_v FROM core.kyc_identity_verification AS v
   WHERE v.user_id = v_user AND v.is_current;
  v_country := COALESCE(v_v.country_code::text,
                        CASE WHEN p_country ~ '^[A-Z]{2}$' THEN p_country END);
  SELECT * INTO v_t FROM core.kyc_biometric_template(v_country, v_lang);
  IF v_v.id IS NOT NULL THEN
    SELECT d.expiry_date INTO v_exp FROM core.kyc_identity_document AS d
     WHERE d.verification_id = v_v.id AND d.attempt = v_v.attempt
     ORDER BY d.created_at DESC LIMIT 1;
  END IF;
  RETURN QUERY SELECT 'OK'::text, COALESCE(v_v.status, 'NOT_STARTED'), v_v.country_code::text,
    v_v.decision_reason_code, v_exp,
    COALESCE(v_v.status = 'DOCS_SUBMITTED' AND v_v.session_expires_at > v_now, false),
    COALESCE(v_phone, false), v_t.version, core.kyc_consent_current(v_user, v_country), v_t.locale, v_t.title, v_t.body_md;
END
$fn$;

-- 6. Consentement biométrique (SECURITY DEFINER, EXECUTE app_api) ---------------------------------
-- `p_version` : version AFFICHÉE et acceptée ; elle doit être la version en vigueur (sinon
-- VERSION_CHANGED, rien n'est écrit). `p_accepted` = false : RETRAIT (VER-004 ; RISKS L1-PM-39),
-- possible quel que soit l'état du compte et du dossier : ligne de retrait sur la version en
-- vigueur, puis, si un dossier existe, demandes d'effacement datées (une par référence de session
-- connue), scores [C3] et références effacés, dossier repassé en `RECHECK` (tentative suivante,
-- session effacée : un rappel tardif est inconnu), événements `kyc.verification.status_changed` et
-- `kyc.consent.withdrawn`, audit `KYC_CONSENT_WITHDRAWN`. L'effacement chez le fournisseur est
-- exécuté par l'API (`core.kyc_pending_erasures`, `core.kyc_cmd_record_erasure`).
-- Issues : RECORDED, AUTH_REQUIRED, NOT_ELIGIBLE (acceptation : compte fermé, pseudonymisé ou
-- e-mail non vérifié), COUNTRY_UNKNOWN, CONSENT_UNAVAILABLE (aucun texte en vigueur :
-- fail-closed), VERSION_CHANGED.
CREATE FUNCTION core.kyc_cmd_biometric_consent(p_token_hash bytea, p_country text,
                                               p_version integer, p_accepted boolean)
  RETURNS TABLE (outcome text, version integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_acc     record;
  v_country text;
  v_t       core.contract_document_template%ROWTYPE;
  v_v       record;
  v_now     timestamptz := platform.now();
  v_n       integer := 0;
BEGIN
  IF p_accepted IS NULL THEN
    RAISE EXCEPTION 'kyc : consentement invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT u.id, u.status, u.email_verified_at, u.pseudonymized_at, u.preferred_locale INTO v_acc
    FROM core.iam_user_account AS u WHERE u.id = v_user;
  -- le retrait reste possible pour tout compte qui a une session (droit de la personne)
  IF p_accepted AND (v_acc.id IS NULL OR v_acc.email_verified_at IS NULL
                     OR v_acc.pseudonymized_at IS NOT NULL
                     OR v_acc.status NOT IN ('ACTIVE', 'RESTRICTED')) THEN
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::integer;
    RETURN;
  END IF;
  -- portée : pays du dossier courant s'il existe, sinon (retrait) celui du dernier consentement
  -- biométrique, sinon le pays du parcours (connu de la config)
  SELECT v.country_code::text INTO v_country FROM core.kyc_identity_verification AS v
   WHERE v.user_id = v_user AND v.is_current;
  IF v_country IS NULL AND NOT p_accepted THEN
    SELECT c.country_code::text INTO v_country FROM core.contract_consent AS c
     WHERE c.user_id = v_user AND c.doc_kind = 'BIOMETRIC_CONSENT'
     ORDER BY c.seq DESC LIMIT 1;
  END IF;
  IF v_country IS NULL THEN
    IF p_country IS NULL
       OR NOT EXISTS (SELECT 1 FROM core.config_country AS k WHERE k.code::text = p_country) THEN
      RETURN QUERY SELECT 'COUNTRY_UNKNOWN'::text, NULL::integer;
      RETURN;
    END IF;
    v_country := p_country;
  END IF;
  SELECT * INTO v_t FROM core.kyc_biometric_template(v_country,
                                                     pg_catalog.split_part(v_acc.preferred_locale, '-', 1));
  IF v_t.id IS NULL THEN
    RETURN QUERY SELECT 'CONSENT_UNAVAILABLE'::text, NULL::integer;
    RETURN;
  END IF;
  IF p_accepted AND p_version IS DISTINCT FROM v_t.version THEN
    RETURN QUERY SELECT 'VERSION_CHANGED'::text, v_t.version;
    RETURN;
  END IF;
  -- consentement, ouverture et décision d'une personne : un seul à la fois
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.verification:' || v_user::text, 0));
  INSERT INTO core.contract_consent (user_id, template_id, doc_kind, doc_version, locale, accepted,
                                     accepted_at, context, country_code, c2_withheld)
  VALUES (v_user, v_t.id, v_t.kind, v_t.version, v_t.locale, p_accepted, v_now, 'KYC',
          v_country, true);
  IF p_accepted THEN
    RETURN QUERY SELECT 'RECORDED'::text, v_t.version;
    RETURN;
  END IF;

  -- retrait : effacement et réexamen du dossier courant
  SELECT v.* INTO v_v FROM core.kyc_identity_verification AS v
   WHERE v.user_id = v_user AND v.is_current;
  IF v_v.id IS NOT NULL THEN
    INSERT INTO core.kyc_erasure_request (user_id, verification_id, provider, provider_session_ref)
    SELECT v_user, v_v.id, v_v.provider, r.ref
      FROM (SELECT v_v.provider_session_ref AS ref WHERE v_v.provider_session_ref IS NOT NULL
            UNION
            SELECT l.provider_session_ref FROM core.kyc_liveness_check AS l
             WHERE l.verification_id = v_v.id AND l.erased_at IS NULL) AS r
     WHERE v_v.provider IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE core.kyc_liveness_check AS l
       SET liveness_score = NULL, face_match_score = NULL, provider_session_ref = NULL,
           erased_at = v_now
     WHERE l.verification_id = v_v.id AND l.erased_at IS NULL;
    UPDATE core.kyc_identity_document AS d SET provider_document_ref = NULL
     WHERE d.verification_id = v_v.id AND d.provider_document_ref IS NOT NULL;
    IF v_v.status IN ('PHONE_VERIFIED', 'DOCS_SUBMITTED', 'AUTO_CHECKS', 'MANUAL_REVIEW',
                      'MORE_INFO_REQUIRED', 'APPROVED', 'RECHECK') THEN
      UPDATE core.kyc_identity_verification AS v
         SET status = 'RECHECK', decision_reason_code = 'CONSENT_WITHDRAWN',
             attempt = v_v.attempt + 1, provider_session_ref = NULL, hosted_url = NULL,
             session_expires_at = NULL, approved_at = NULL, expires_at = NULL,
             row_version = v_v.row_version + 1, updated_at = v_now
       WHERE v.id = v_v.id;
      IF v_v.status <> 'RECHECK' THEN
        PERFORM core.kyc_emit_status(v_v.id, v_user, v_v.row_version + 1, v_v.status, 'RECHECK',
                                     'CONSENT_WITHDRAWN', v_v.country_code::text, v_user, 'GUEST');
      END IF;
    END IF;
  END IF;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('kyc.consent.withdrawn', 1, 'user_account', v_user, 0, v_country, v_user, 'GUEST',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('user_id', v_user, 'verification_id', v_v.id,
                                        'version', v_t.version, 'withdrawn_at', v_now,
                                        'erasure_requests', v_n),
          v_user::text);
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (v_user, 'GUEST', 'KYC_CONSENT_WITHDRAWN', 'USER_ACCOUNT', v_user,
          pg_catalog.jsonb_build_object('status', COALESCE(v_v.status, 'NOT_STARTED')),
          pg_catalog.jsonb_build_object('status', CASE WHEN v_v.id IS NULL THEN 'NOT_STARTED'
                                                       ELSE 'RECHECK' END,
                                        'version', v_t.version, 'erasureRequests', v_n,
                                        'country', v_country));
  RETURN QUERY SELECT 'RECORDED'::text, v_t.version;
END
$fn$;

-- 6 bis. Demandes d'effacement en attente de la personne de la session (SECURITY DEFINER, EXECUTE
-- app_api) : identifiant, fournisseur et référence de session à effacer chez lui.
CREATE FUNCTION core.kyc_pending_erasures(p_token_hash bytea)
  RETURNS TABLE (request_id uuid, provider text, session_ref text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT e.id, e.provider, e.provider_session_ref
    FROM core.kyc_erasure_request AS e
   WHERE e.user_id = v_user AND e.status = 'PENDING'
   ORDER BY e.requested_at, e.id;
END
$fn$;

-- 6 ter. Issue d'une demande d'effacement (SECURITY DEFINER, EXECUTE app_api) : DONE (attestation
-- du fournisseur ; la référence de session est effacée) ou FAILED (refus du fournisseur ; l'ops
-- reprend). Une panne laisse la demande PENDING (l'API n'appelle pas cette commande). Issues :
-- RECORDED, AUTH_REQUIRED, NOT_FOUND (demande d'un autre, inconnue ou déjà close).
CREATE FUNCTION core.kyc_cmd_record_erasure(p_token_hash bytea, p_request_id uuid, p_outcome text,
                                            p_attestation_ref text)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_id   uuid;
BEGIN
  IF p_outcome IS NULL OR p_outcome NOT IN ('DONE', 'FAILED')
     OR (p_attestation_ref IS NOT NULL AND pg_catalog.length(p_attestation_ref) NOT BETWEEN 1 AND 200)
     OR (p_outcome = 'DONE' AND p_attestation_ref IS NULL) THEN
    RAISE EXCEPTION 'kyc : issue d''effacement invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text;
    RETURN;
  END IF;
  UPDATE core.kyc_erasure_request AS e
     SET status = p_outcome, attestation_ref = p_attestation_ref, completed_at = platform.now(),
         provider_session_ref = CASE WHEN p_outcome = 'DONE' THEN NULL
                                     ELSE e.provider_session_ref END
   WHERE e.id = p_request_id AND e.user_id = v_user AND e.status = 'PENDING'
  RETURNING e.id INTO v_id;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text;
    RETURN;
  END IF;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (v_user, 'GUEST', 'KYC_ERASURE_RECORDED', 'USER_ACCOUNT', v_user,
          pg_catalog.jsonb_build_object('status', 'PENDING', 'requestId', v_id),
          pg_catalog.jsonb_build_object('status', p_outcome, 'requestId', v_id));
  RETURN QUERY SELECT 'RECORDED'::text;
END
$fn$;

-- 7. Ouverture d'une vérification (SECURITY DEFINER, EXECUTE app_api) -----------------------------
-- Juge AVANT toute écriture, dans cet ordre : session, pays du dossier (pays de la configuration),
-- compte (e-mail vérifié, actif ou restreint, non pseudonymisé), téléphone vérifié (SM-3
-- `PHONE_VERIFIED`), consentement biométrique à la version en vigueur, état courant. Issues :
--   READY (tentative prête : l'API appelle le fournisseur avec la clé (vérification, tentative)),
--   IN_PROGRESS (session hébergée vivante : son adresse est rendue, rien n'est écrit),
--   AUTH_REQUIRED, COUNTRY_UNKNOWN, NOT_ELIGIBLE, PHONE_NOT_VERIFIED, CONSENT_MISSING,
--   IN_REVIEW (décision en cours : AUTO_CHECKS, MANUAL_REVIEW), ALREADY_APPROVED,
--   PROVIDER_INVALID, PRODUCTION_BLOCKED (base de production : KYC fermé, OQ-MK-09, L1-PM-05).
-- Rien n'est écrit hors READY. Une tentative SANS session posée est rendue telle quelle (même
-- pays, même fournisseur) : un double clic rejoue la même clé chez le fournisseur, y compris après
-- une expiration ou un retrait. Tentative nouvelle (compteur + 1, session effacée) quand une
-- session expirée est encore posée ou quand le pays du dossier change. Dossier `RECHECK` (après un
-- retrait du consentement) ou `MORE_INFO_REQUIRED` : nouvelle session admise.
CREATE FUNCTION core.kyc_cmd_open_verification(p_token_hash bytea, p_country text, p_provider text)
  RETURNS TABLE (outcome text, verification_id uuid, attempt integer, hosted_url text,
                 session_expires_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_now  timestamptz := platform.now();
  v_acc  record;
  v_v    record;
  v_id   uuid;
BEGIN
  -- garde fail-closed en base (L1-PM-05) : environnement inconnu = production
  IF COALESCE(platform.deployment_env(), 'production') = 'production' THEN
    RETURN QUERY SELECT 'PRODUCTION_BLOCKED'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;
  IF p_provider IS NULL OR p_provider !~ '^[A-Z][A-Z0-9_]{1,31}$' THEN
    RETURN QUERY SELECT 'PROVIDER_INVALID'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;
  IF p_country IS NULL
     OR NOT EXISTS (SELECT 1 FROM core.config_country AS k WHERE k.code::text = p_country) THEN
    RETURN QUERY SELECT 'COUNTRY_UNKNOWN'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;
  SELECT u.id, u.status, u.email_verified_at, u.phone_verified_at, u.pseudonymized_at INTO v_acc
    FROM core.iam_user_account AS u WHERE u.id = v_user;
  IF v_acc.id IS NULL OR v_acc.email_verified_at IS NULL OR v_acc.pseudonymized_at IS NOT NULL
     OR v_acc.status NOT IN ('ACTIVE', 'RESTRICTED') THEN
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;
  IF v_acc.phone_verified_at IS NULL THEN
    RETURN QUERY SELECT 'PHONE_NOT_VERIFIED'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;

  -- une ouverture à la fois par personne (deux onglets)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.verification:' || v_user::text, 0));
  -- lecture sans FOR UPDATE : la politique UPDATE masquerait un dossier APPROVED ; le verrou
  -- consultatif ci-dessus sérialise l'ouverture, la session posée et la décision d'une personne
  SELECT v.* INTO v_v FROM core.kyc_identity_verification AS v
   WHERE v.user_id = v_user AND v.is_current;

  -- consentement de la portée du pays demandé ET, s'il diffère, de celle du dossier courant
  IF core.kyc_consent_current(v_user, p_country) IS NULL THEN
    RETURN QUERY SELECT 'CONSENT_MISSING'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;

  IF v_v.id IS NULL THEN
    v_id := platform.uuid_v7();
    INSERT INTO core.kyc_identity_verification (id, user_id, country_code, status, provider)
    VALUES (v_id, v_user, p_country, 'PHONE_VERIFIED', p_provider);
    RETURN QUERY SELECT 'READY'::text, v_id, 1, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_v.status = 'APPROVED' THEN
    RETURN QUERY SELECT 'ALREADY_APPROVED'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;
  IF v_v.status IN ('AUTO_CHECKS', 'MANUAL_REVIEW') THEN
    RETURN QUERY SELECT 'IN_REVIEW'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;
  IF v_v.status NOT IN ('PHONE_VERIFIED', 'DOCS_SUBMITTED', 'MORE_INFO_REQUIRED', 'RECHECK') THEN
    -- EXPIRED, REVOKED, REJECTED, APPEAL, REJECTED_FINAL, BANNED : décision de l'ops
    RETURN QUERY SELECT 'NOT_ELIGIBLE'::text, NULL::uuid, NULL::integer, NULL::text,
                        NULL::timestamptz;
    RETURN;
  END IF;
  IF v_v.status = 'DOCS_SUBMITTED' AND v_v.session_expires_at > v_now THEN
    RETURN QUERY SELECT 'IN_PROGRESS'::text, v_v.id, v_v.attempt, v_v.hosted_url,
                        v_v.session_expires_at;
    RETURN;
  END IF;
  IF v_v.provider_session_ref IS NULL
     AND v_v.country_code::text = p_country AND v_v.provider IS NOT DISTINCT FROM p_provider THEN
    -- tentative préparée, aucune session encore posée : même clé (double clic, nouvel essai)
    RETURN QUERY SELECT 'READY'::text, v_v.id, v_v.attempt, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  UPDATE core.kyc_identity_verification AS v
     SET attempt = v_v.attempt + 1, country_code = p_country, provider = p_provider,
         provider_session_ref = NULL, hosted_url = NULL, session_expires_at = NULL,
         updated_at = v_now
   WHERE v.id = v_v.id;
  RETURN QUERY SELECT 'READY'::text, v_v.id, v_v.attempt + 1, NULL::text, NULL::timestamptz;
END
$fn$;

-- 8. Session hébergée posée (SECURITY DEFINER, EXECUTE app_api) -----------------------------------
-- Après l'appel au fournisseur : pose la référence de session de la tentative COURANTE de la
-- personne de la session et passe le dossier à `DOCS_SUBMITTED` (16 VER-001, SM-3). Issues :
-- RECORDED (événement émis si l'état change), AUTH_REQUIRED, NOT_FOUND (vérification d'un autre
-- ou inconnue), SUPERSEDED (tentative dépassée, état changé entre-temps ou session déjà posée
-- avec une autre référence), INVALID (expiration passée ou adresse refusée). Session déjà posée
-- avec la même référence : RECORDED sans écriture (rejeu).
CREATE FUNCTION core.kyc_cmd_record_session(p_token_hash bytea, p_verification_id uuid,
                                            p_attempt integer, p_provider text,
                                            p_session_ref text, p_hosted_url text,
                                            p_expires_at timestamptz)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_now  timestamptz := platform.now();
  v_v    record;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text;
    RETURN;
  END IF;
  IF p_session_ref IS NULL OR pg_catalog.length(p_session_ref) NOT BETWEEN 1 AND 200
     OR p_hosted_url IS NULL OR p_hosted_url !~ '^https://' OR pg_catalog.length(p_hosted_url) > 500
     OR p_expires_at IS NULL OR p_expires_at <= v_now THEN
    RETURN QUERY SELECT 'INVALID'::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.verification:' || v_user::text, 0));
  SELECT v.* INTO v_v FROM core.kyc_identity_verification AS v
   WHERE v.id = p_verification_id AND v.user_id = v_user AND v.is_current;
  IF v_v.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text;
    RETURN;
  END IF;
  IF v_v.provider_session_ref IS NOT NULL THEN
    RETURN QUERY SELECT CASE WHEN v_v.provider_session_ref = p_session_ref
                              AND v_v.attempt = p_attempt AND v_v.provider = p_provider
                             THEN 'RECORDED' ELSE 'SUPERSEDED' END::text;
    RETURN;
  END IF;
  IF v_v.attempt IS DISTINCT FROM p_attempt OR v_v.provider IS DISTINCT FROM p_provider
     OR v_v.status NOT IN ('PHONE_VERIFIED', 'DOCS_SUBMITTED', 'MORE_INFO_REQUIRED', 'RECHECK') THEN
    RETURN QUERY SELECT 'SUPERSEDED'::text;
    RETURN;
  END IF;
  UPDATE core.kyc_identity_verification AS v
     SET provider_session_ref = p_session_ref, hosted_url = p_hosted_url,
         session_expires_at = p_expires_at, status = 'DOCS_SUBMITTED',
         decision_reason_code = NULL, row_version = v_v.row_version + 1, updated_at = v_now
   WHERE v.id = v_v.id;
  IF v_v.status <> 'DOCS_SUBMITTED' THEN
    PERFORM core.kyc_emit_status(v_v.id, v_user, v_v.row_version + 1, v_v.status,
                                 'DOCS_SUBMITTED', NULL, v_v.country_code::text, v_user, 'GUEST');
  END IF;
  RETURN QUERY SELECT 'RECORDED'::text;
END
$fn$;

-- 9. Décision du fournisseur (rappel signé, vérifié par l'adaptateur ; SECURITY DEFINER, EXECUTE
-- app_api, sans session : le rappel vient du fournisseur) ----------------------------------------
-- Idempotente par (fournisseur, identifiant d'événement) : un rappel rejoué rend DUPLICATE sans
-- rien écrire (17 §4.4). Le dossier est celui de la session du fournisseur ET de la référence
-- opaque du sujet (identifiant de la vérification), recoupées. Seul un dossier `DOCS_SUBMITTED`
-- est décidé (sinon STALE : une seule transition par session). Transitions : DOCS_SUBMITTED →
-- AUTO_CHECKS, puis AUTO_CHECKS → APPROVED si le fournisseur approuve ET si le document est un
-- permis de conduire définitif dont l'échéance n'est pas passée (fin du jour d'échéance dans le
-- fuseau du pays du dossier), sinon → MANUAL_REVIEW avec un code motif (PROVIDER_REVIEW,
-- PROVIDER_DECLINED, DOCUMENT_MISSING, DOCUMENT_NOT_LICENSE, LICENSE_PROVISIONAL,
-- LICENSE_EXPIRED). Écrit les champs minimaux du permis et les scores [C3] (rétention : décision
-- + biometric_appeal_retention_days) ; AUCUNE image (le port n'en transporte pas). Session
-- inconnue : rien n'est écrit, l'identifiant d'événement n'est pas consommé (un rejeu plus tard
-- peut aboutir). Consentement biométrique absent ou retiré : l'événement est consommé, rien
-- d'autre (aucun score, aucune transition). Issues : APPLIED (statut final rendu), DUPLICATE,
-- UNKNOWN_SESSION, STALE, CONSENT_WITHDRAWN, PRODUCTION_BLOCKED (base de production).
CREATE FUNCTION core.kyc_cmd_apply_decision(p_provider text, p_event_id text, p_session_ref text,
                                            p_subject_ref text, p_decision text,
                                            p_liveness numeric, p_face_match numeric,
                                            p_document jsonb)
  RETURNS TABLE (outcome text, status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now      timestamptz := platform.now();
  v_event    uuid;
  v_user     uuid;
  v_v        record;
  v_tz       text;
  v_type     text;
  v_country  text;
  v_expiry   date;
  v_class    text;
  v_perm     boolean;
  v_ref      text;
  v_doc_ok   boolean := false;
  v_end      timestamptz;
  v_final    text;
  v_reason   text;
  v_version  integer;
BEGIN
  IF p_provider IS NULL OR p_provider !~ '^[A-Z][A-Z0-9_]{1,31}$'
     OR p_event_id IS NULL OR pg_catalog.length(p_event_id) NOT BETWEEN 1 AND 200
     OR p_session_ref IS NULL OR pg_catalog.length(p_session_ref) NOT BETWEEN 1 AND 200
     OR p_subject_ref IS NULL OR pg_catalog.length(p_subject_ref) NOT BETWEEN 1 AND 200
     OR p_decision IS NULL OR p_decision NOT IN ('APPROVED', 'DECLINED', 'REVIEW')
     OR (p_liveness IS NOT NULL AND p_liveness NOT BETWEEN 0 AND 1)
     OR (p_face_match IS NOT NULL AND p_face_match NOT BETWEEN 0 AND 1)
     OR (p_document IS NOT NULL AND pg_catalog.jsonb_typeof(p_document) <> 'object') THEN
    RAISE EXCEPTION 'kyc : décision invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF COALESCE(platform.deployment_env(), 'production') = 'production' THEN
    RETURN QUERY SELECT 'PRODUCTION_BLOCKED'::text, NULL::text;
    RETURN;
  END IF;
  -- dossier de la session ET du sujet ; puis verrou de la personne (même clé que l'ouverture) et
  -- relecture : deux rappels distincts de la même session sont sérialisés, le second voit l'état
  -- décidé par le premier (STALE)
  SELECT v.user_id INTO v_user FROM core.kyc_identity_verification AS v
   WHERE v.provider = p_provider AND v.provider_session_ref = p_session_ref
     AND v.id::text = p_subject_ref AND v.is_current;
  IF v_user IS NULL THEN
    -- rien n'est écrit : l'événement n'est pas consommé
    RETURN QUERY SELECT 'UNKNOWN_SESSION'::text, NULL::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.verification:' || v_user::text, 0));
  SELECT v.* INTO v_v FROM core.kyc_identity_verification AS v
   WHERE v.provider = p_provider AND v.provider_session_ref = p_session_ref
     AND v.id::text = p_subject_ref AND v.is_current;
  IF v_v.id IS NULL THEN
    RETURN QUERY SELECT 'UNKNOWN_SESSION'::text, NULL::text;
    RETURN;
  END IF;
  -- sous le verrou de la personne : idempotence par (fournisseur, événement)
  INSERT INTO core.kyc_provider_event (provider, event_id, session_ref, decision)
  VALUES (p_provider, p_event_id, p_session_ref, p_decision)
  ON CONFLICT ON CONSTRAINT kyc_provider_event_unique DO NOTHING
  RETURNING id INTO v_event;
  IF v_event IS NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, NULL::text;
    RETURN;
  END IF;
  -- consentement biométrique retiré (ou nouvelle version non acceptée) : aucune donnée écrite
  IF core.kyc_consent_current(v_user, v_v.country_code::text) IS NULL THEN
    UPDATE core.kyc_provider_event AS e SET outcome = 'CONSENT_WITHDRAWN' WHERE e.id = v_event;
    RETURN QUERY SELECT 'CONSENT_WITHDRAWN'::text, v_v.status;
    RETURN;
  END IF;
  IF v_v.status <> 'DOCS_SUBMITTED' THEN
    UPDATE core.kyc_provider_event AS e SET outcome = 'STALE' WHERE e.id = v_event;
    RETURN QUERY SELECT 'STALE'::text, v_v.status;
    RETURN;
  END IF;

  -- champs minimaux du permis (forme vérifiée ; tout autre champ du rappel est ignoré)
  IF p_document IS NOT NULL THEN
    v_type := p_document ->> 'kind';
    v_country := p_document ->> 'country';
    v_class := NULLIF(pg_catalog.btrim(COALESCE(p_document ->> 'licenseClass', '')), '');
    v_ref := NULLIF(pg_catalog.btrim(COALESCE(p_document ->> 'providerDocumentRef', '')), '');
    v_perm := CASE pg_catalog.jsonb_typeof(p_document -> 'isPermanent')
                WHEN 'boolean' THEN (p_document ->> 'isPermanent')::boolean END;
    IF COALESCE(p_document ->> 'expiresOn', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      BEGIN
        v_expiry := (p_document ->> 'expiresOn')::date;
      EXCEPTION WHEN others THEN
        v_expiry := NULL;
      END;
    END IF;
    v_doc_ok := v_type IN ('DRIVER_LICENSE', 'NATIONAL_ID', 'FOREIGN_RESIDENT_ID', 'PASSPORT', 'IDP')
                AND COALESCE(v_country ~ '^[A-Z]{2}$', false)
                AND (v_class IS NULL OR pg_catalog.length(v_class) <= 20)
                AND (v_ref IS NULL OR pg_catalog.length(v_ref) <= 200);
  END IF;

  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code = v_v.country_code;
  IF v_doc_ok AND v_expiry IS NOT NULL THEN
    v_end := ((v_expiry + 1)::timestamp AT TIME ZONE v_tz);
  END IF;
  v_reason := CASE
    WHEN p_decision = 'REVIEW' THEN 'PROVIDER_REVIEW'
    WHEN p_decision = 'DECLINED' THEN 'PROVIDER_DECLINED'
    WHEN NOT v_doc_ok THEN 'DOCUMENT_MISSING'
    WHEN v_type <> 'DRIVER_LICENSE' THEN 'DOCUMENT_NOT_LICENSE'
    WHEN v_perm IS NOT TRUE THEN 'LICENSE_PROVISIONAL'
    WHEN v_end IS NULL OR v_end <= v_now THEN 'LICENSE_EXPIRED'
    ELSE NULL END;
  v_final := CASE WHEN v_reason IS NULL THEN 'APPROVED' ELSE 'MANUAL_REVIEW' END;

  IF v_doc_ok THEN
    INSERT INTO core.kyc_identity_document (verification_id, user_id, attempt, doc_type,
                                            issuing_country, expiry_date, license_class,
                                            is_permanent, provider_document_ref, status)
    VALUES (v_v.id, v_v.user_id, v_v.attempt, v_type, v_country, v_expiry, v_class, v_perm, v_ref,
            CASE WHEN v_final = 'APPROVED' THEN 'ACCEPTED' ELSE 'IN_REVIEW' END);
  END IF;
  INSERT INTO core.kyc_liveness_check (verification_id, user_id, attempt, liveness_score,
                                       face_match_score, result, provider_session_ref,
                                       retention_until)
  VALUES (v_v.id, v_v.user_id, v_v.attempt, p_liveness, p_face_match, p_decision, p_session_ref,
          v_now + pg_catalog.make_interval(days => core.kyc_retention_days(v_v.country_code::text)));

  -- deux transitions journalisées : DOCS_SUBMITTED → AUTO_CHECKS → décision
  v_version := v_v.row_version + 2;
  UPDATE core.kyc_identity_verification AS v
     SET status = v_final, decision_reason_code = v_reason,
         approved_at = CASE WHEN v_final = 'APPROVED' THEN v_now END,
         expires_at = CASE WHEN v_final = 'APPROVED' THEN v_end END,
         row_version = v_version, updated_at = v_now
   WHERE v.id = v_v.id;
  PERFORM core.kyc_emit_status(v_v.id, v_v.user_id, v_v.row_version + 1, 'DOCS_SUBMITTED',
                               'AUTO_CHECKS', NULL, v_v.country_code::text, NULL, 'SYSTEM');
  PERFORM core.kyc_emit_status(v_v.id, v_v.user_id, v_version, 'AUTO_CHECKS', v_final, v_reason,
                               v_v.country_code::text, NULL, 'SYSTEM');
  UPDATE core.kyc_provider_event AS e SET outcome = 'APPLIED' WHERE e.id = v_event;
  RETURN QUERY SELECT 'APPLIED'::text, v_final;
END
$fn$;

-- 10. Rappel rejeté (SECURITY DEFINER, EXECUTE app_api) --------------------------------------------
-- Journal du rejet (signature invalide, périmé, mal formé) : fournisseur, motif, empreinte et
-- longueur du corps ; jamais le corps (16 VER-001 : « rejeté et journalisé »). Plafond : 600
-- rejets par minute et par fournisseur (PROPOSÉ) ; au-delà, rien n'est écrit (la route rend
-- toujours 401).
CREATE FUNCTION core.kyc_cmd_record_webhook_rejection(p_provider text, p_reason text,
                                                      p_body_sha256 bytea, p_body_length integer)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_provider IS NULL OR p_provider !~ '^[A-Z][A-Z0-9_]{1,31}$'
     OR p_reason IS NULL OR p_reason NOT IN ('BAD_SIGNATURE', 'STALE', 'MALFORMED')
     OR p_body_sha256 IS NULL OR pg_catalog.octet_length(p_body_sha256) <> 32
     OR p_body_length IS NULL OR p_body_length < 0 THEN
    RAISE EXCEPTION 'kyc : rejet invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM (
        SELECT 1 FROM core.kyc_webhook_rejection AS r
         WHERE r.provider = p_provider
           AND r.received_at > platform.now() - pg_catalog.make_interval(mins => 1)
         LIMIT 600) AS x) >= 600 THEN
    RETURN;
  END IF;
  INSERT INTO core.kyc_webhook_rejection (provider, reason, body_sha256, body_length)
  VALUES (p_provider, p_reason, p_body_sha256, p_body_length);
END
$fn$;

-- 11. Éligibilité du conducteur au paiement (SECURITY DEFINER, EXECUTE app_api) -------------------
-- Contrôle bloquant du paiement (16 VER-001 : « Given un permis expirant avant la fin du trip,
-- When le guest paie, Then KYC_LICENSE_EXPIRED »), à poser par US-209. Le permis vaut jusqu'à la
-- fin de son jour d'échéance dans le fuseau du PAYS DU TRIP ; il est expiré pour le trip si la fin
-- du trip tombe à cet instant ou après. Issues : ELIGIBLE, AUTH_REQUIRED, COUNTRY_UNKNOWN,
-- REQUEST_INVALID (fin absente), KYC_NOT_APPROVED (aucune vérification approuvée),
-- KYC_BIOMETRIC_CONSENT_MISSING (consentement retiré ou version non acceptée), KYC_LICENSE_EXPIRED.
CREATE FUNCTION core.kyc_driver_eligibility(p_token_hash bytea, p_trip_end timestamptz,
                                            p_trip_country text)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  v_tz     text;
  v_v      record;
  v_expiry date;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text;
    RETURN;
  END IF;
  IF p_trip_end IS NULL THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text;
    RETURN;
  END IF;
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = p_trip_country;
  IF v_tz IS NULL THEN
    RETURN QUERY SELECT 'COUNTRY_UNKNOWN'::text;
    RETURN;
  END IF;
  SELECT v.id, v.status, v.attempt, v.country_code INTO v_v FROM core.kyc_identity_verification AS v
   WHERE v.user_id = v_user AND v.is_current;
  IF v_v.id IS NULL OR v_v.status <> 'APPROVED' THEN
    RETURN QUERY SELECT 'KYC_NOT_APPROVED'::text;
    RETURN;
  END IF;
  IF core.kyc_consent_current(v_user, v_v.country_code::text) IS NULL THEN
    RETURN QUERY SELECT 'KYC_BIOMETRIC_CONSENT_MISSING'::text;
    RETURN;
  END IF;
  SELECT d.expiry_date INTO v_expiry FROM core.kyc_identity_document AS d
   WHERE d.verification_id = v_v.id AND d.attempt = v_v.attempt AND d.status = 'ACCEPTED'
     AND d.doc_type = 'DRIVER_LICENSE'
   ORDER BY d.created_at DESC LIMIT 1;
  IF v_expiry IS NULL OR p_trip_end >= ((v_expiry + 1)::timestamp AT TIME ZONE v_tz) THEN
    RETURN QUERY SELECT 'KYC_LICENSE_EXPIRED'::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'ELIGIBLE'::text;
END
$fn$;

-- 12. Purge (SECURITY DEFINER, EXECUTE app_worker, `kyc_score_pruner`) --------------------------
-- Efface les scores [C3] et la référence de session arrivés à `retention_until` (décision +
-- biometric_appeal_retention_days ; 0 jour sans paramètre) et supprime les rejets de rappels de
-- plus de 90 jours (PROPOSÉ), par lots. Rend le nombre de lignes traitées.
CREATE FUNCTION core.kyc_worker_prune(p_batch integer)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := platform.now();
  v_a   integer;
  v_b   integer;
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'kyc_score_pruner' THEN
    RAISE EXCEPTION 'kyc : réservé au travailleur kyc_score_pruner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'kyc : lot de purge invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE core.kyc_liveness_check AS l
     SET liveness_score = NULL, face_match_score = NULL, provider_session_ref = NULL,
         erased_at = v_now
   WHERE l.id IN (SELECT o.id FROM core.kyc_liveness_check AS o
                   WHERE o.erased_at IS NULL AND o.retention_until <= v_now
                   ORDER BY o.retention_until LIMIT p_batch);
  GET DIAGNOSTICS v_a = ROW_COUNT;
  DELETE FROM core.kyc_webhook_rejection AS r
   WHERE r.id IN (SELECT o.id FROM core.kyc_webhook_rejection AS o
                   WHERE o.received_at < v_now - pg_catalog.make_interval(days => 90)
                   ORDER BY o.received_at LIMIT p_batch);
  GET DIAGNOSTICS v_b = ROW_COUNT;
  RETURN v_a + v_b;
END
$fn$;

COMMENT ON FUNCTION core.kyc_pending_erasures(bytea) IS
  'Demandes d''effacement en attente de la personne de la session (retrait du consentement). '
  'SECURITY DEFINER, EXECUTE app_api. US-105 (ADR-102).';
COMMENT ON FUNCTION core.kyc_cmd_record_erasure(bytea, uuid, text, text) IS
  'Issue d''une demande d''effacement au fournisseur (attestation), journalisée. SECURITY '
  'DEFINER, EXECUTE app_api. US-105 (ADR-102).';
COMMENT ON FUNCTION core.kyc_worker_prune(integer) IS
  'Purge des scores à échéance et des rejets de rappels de plus de 90 jours, travailleur '
  'kyc_score_pruner. SECURITY DEFINER, EXECUTE app_worker. US-105 (ADR-102).';
COMMENT ON FUNCTION core.kyc_identity_state(bytea, text) IS
  'État de la vérification d''identité de la session (SM-3, échéance du permis, consentement '
  'biométrique). SECURITY DEFINER, EXECUTE app_api. US-105 (ADR-102).';
COMMENT ON FUNCTION core.kyc_cmd_biometric_consent(bytea, text, integer, boolean) IS
  'Consentement biométrique (VER-004) : acceptation de la version en vigueur ou retrait, contexte '
  'KYC. SECURITY DEFINER, EXECUTE app_api. US-105 (ADR-102).';
COMMENT ON FUNCTION core.kyc_cmd_open_verification(bytea, text, text) IS
  'Ouverture d''une vérification : session, compte, téléphone, consentement à la version en '
  'vigueur, état ; aucune écriture hors READY. SECURITY DEFINER, EXECUTE app_api. US-105.';
COMMENT ON FUNCTION core.kyc_cmd_record_session(bytea, uuid, integer, text, text, text, timestamptz) IS
  'Session hébergée du fournisseur posée sur la tentative courante (SM-3 DOCS_SUBMITTED). '
  'SECURITY DEFINER, EXECUTE app_api. US-105 (ADR-102).';
COMMENT ON FUNCTION core.kyc_cmd_apply_decision(text, text, text, text, text, numeric, numeric, jsonb) IS
  'Décision du fournisseur (rappel signé) : idempotente par événement, une transition par '
  'session, scores C3 et champs minimaux du permis, aucune image. SECURITY DEFINER, EXECUTE '
  'app_api. US-105 (ADR-102).';
COMMENT ON FUNCTION core.kyc_cmd_record_webhook_rejection(text, text, bytea, integer) IS
  'Journal d''un rappel KYC rejeté (empreinte du corps). SECURITY DEFINER, EXECUTE app_api. US-105.';
COMMENT ON FUNCTION core.kyc_driver_eligibility(bytea, timestamptz, text) IS
  'Contrôle bloquant du paiement : vérification approuvée et permis valable jusqu''à la fin du '
  'trip (KYC_LICENSE_EXPIRED). SECURITY DEFINER, EXECUTE app_api. US-105 (ADR-102).';

REVOKE ALL ON FUNCTION core.kyc_identity_state(bytea, text),
  core.kyc_cmd_biometric_consent(bytea, text, integer, boolean),
  core.kyc_cmd_open_verification(bytea, text, text),
  core.kyc_cmd_record_session(bytea, uuid, integer, text, text, text, timestamptz),
  core.kyc_cmd_apply_decision(text, text, text, text, text, numeric, numeric, jsonb),
  core.kyc_cmd_record_webhook_rejection(text, text, bytea, integer),
  core.kyc_driver_eligibility(bytea, timestamptz, text), core.kyc_pending_erasures(bytea),
  core.kyc_cmd_record_erasure(bytea, uuid, text, text), core.kyc_worker_prune(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_identity_state(bytea, text),
  core.kyc_cmd_biometric_consent(bytea, text, integer, boolean),
  core.kyc_cmd_open_verification(bytea, text, text),
  core.kyc_cmd_record_session(bytea, uuid, integer, text, text, text, timestamptz),
  core.kyc_cmd_apply_decision(text, text, text, text, text, numeric, numeric, jsonb),
  core.kyc_cmd_record_webhook_rejection(text, text, bytea, integer),
  core.kyc_driver_eligibility(bytea, timestamptz, text), core.kyc_pending_erasures(bytea),
  core.kyc_cmd_record_erasure(bytea, uuid, text, text) TO app_api;
GRANT EXECUTE ON FUNCTION core.kyc_worker_prune(integer) TO app_worker;

-- Propriétaire NOLOGIN (mécanique de 0059 / 0066 : CREATE le temps du transfert seulement).
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_biometric_template(text, text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_consent_current(uuid, text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_retention_days(text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_emit_status(uuid, uuid, integer, text, text, text, text, uuid, text)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_identity_state(bytea, text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_biometric_consent(bytea, text, integer, boolean) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_open_verification(bytea, text, text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_record_session(bytea, uuid, integer, text, text, text, timestamptz)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_apply_decision(text, text, text, text, text, numeric, numeric, jsonb)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_record_webhook_rejection(text, text, bytea, integer)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_driver_eligibility(bytea, timestamptz, text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_pending_erasures(bytea) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_record_erasure(bytea, uuid, text, text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_worker_prune(integer) OWNER TO kyc_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 13. Graine : consentement biométrique, version 1 BROUILLON commune aux pays (textes PROVISOIRES,
-- OQ-BR-24, OQ-MK-09). En vigueur dès l'origine (date antérieure à toute horloge de test). À
-- remplacer par le texte validé par le juridique avant toute collecte réelle (registre LEG-010).
INSERT INTO core.contract_document_template
       (kind, country_code, locale, version, is_major, title, body_md, content_hash,
        legal_review_ref, is_authoritative, valid_from)
SELECT 'BIOMETRIC_CONSENT', NULL, d.locale, 1, true, d.title, d.body,
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), NULL, d.locale = 'es',
       '2000-01-01T00:00:00Z'
  FROM (VALUES
    ('es', 'Consentimiento para la verificación biométrica (BORRADOR)',
     E'**BORRADOR — pendiente de validación jurídica.** Este texto es provisional.\n\n1. Para verificar tu identidad, nuestro proveedor de verificación compara una selfie y una prueba de vida con la foto de tu licencia de conducir. Esto usa datos biométricos.\n2. Las imágenes quedan en los sistemas del proveedor: nosotros no guardamos ninguna copia. Solo conservamos el resultado, los puntajes y una referencia.\n3. Los datos biométricos se borran en el plazo más corto posible y nunca después de 3 años.\n4. Puedes retirar este consentimiento en cualquier momento. Sin él no podemos verificarte, y no podrás reservar ni publicar un auto.\n\nEl texto en español hace fe.'),
    ('en', 'Consent to biometric verification (DRAFT)',
     E'**DRAFT — pending legal review.** This text is provisional.\n\n1. To verify your identity, our verification provider compares a selfie and a liveness check with the photo on your driver''s license. This uses biometric data.\n2. The images stay in the provider''s systems: we keep no copy. We only keep the result, the scores and a reference.\n3. Biometric data is deleted as soon as possible and never later than 3 years.\n4. You can withdraw this consent at any time. Without it we cannot verify you, and you cannot book or list a car.\n\nThe Spanish text prevails.'),
    ('fr', 'Consentement à la vérification biométrique (BROUILLON)',
     E'**BROUILLON — en attente de validation juridique.** Ce texte est provisoire.\n\n1. Pour vérifier ton identité, notre prestataire de vérification compare un selfie et une preuve de vie à la photo de ton permis de conduire. Cela utilise des données biométriques.\n2. Les images restent chez le prestataire : nous n''en gardons aucune copie. Nous ne gardons que le résultat, les scores et une référence.\n3. Les données biométriques sont effacées dans le délai le plus court possible, jamais après 3 ans.\n4. Tu peux retirer ce consentement à tout moment. Sans lui, nous ne pouvons pas te vérifier, et tu ne peux ni réserver ni publier une voiture.\n\nLe texte espagnol fait foi.'),
    ('pt', 'Consentimento para a checagem biométrica (RASCUNHO)',
     E'**RASCUNHO — aguardando validação jurídica.** Este texto é provisório.\n\n1. Para confirmar sua identidade, nosso fornecedor de checagem compara uma selfie e uma prova de vida com a foto da sua carteira de motorista. Isso usa dados biométricos.\n2. As imagens ficam nos sistemas do fornecedor: não guardamos nenhuma cópia. Guardamos apenas o resultado, as pontuações e uma referência.\n3. Os dados biométricos são apagados no prazo mais curto possível, nunca depois de 3 anos.\n4. Você pode retirar este consentimento a qualquer momento. Sem ele não podemos confirmar sua identidade, e você não poderá reservar nem anunciar um carro.\n\nO texto em espanhol prevalece.')
  ) AS d(locale, title, body);
