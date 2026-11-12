-- 0075 — KYC : inscription et vérification individuelle de l'hôte, filtrage des sanctions, profil
-- fiscal chiffré et activation du compte d'hôte.
-- US-123 ; 19 US-123 (critères 1 à 6) ; 16 HST-049 / FIN-008 (parcours, états, erreurs), VER-028
-- (sanctions), A.8 (`HOST_UNDER_AGE`, `HOST_ENTITY_NOT_ALLOWED`, `HOST_TAX_ID_REQUIRED`,
-- `HOST_SANCTIONS_HIT`, `HOST_SCREENING_MISSING`, `HOST_NOT_ACTIVATED`, `PENDING_ACTIVATION`,
-- `HOST_PAYOUT_RAIL_UNAVAILABLE`, `INSURER_CONTRACT_INACTIVE`) ; 08 BR-ACC-06, BR-PAYOUT-05 ;
-- 17 §0.1 (interrupteurs), §2.4 (KYC de l'hôte, règle d'activation), §3.2.1 (`organization`),
-- §3.2.2 (`host_verification`, `sanctions_screening`), §4.5 (`kyc.host_verification.decided`,
-- `iam.organization.created`, `iam.organization.status_changed`), §10 (`HOST_VERIFICATION_DECISION`) ;
-- 22 OQ-P2P-01, OQ-P2P-07, OQ-PAY-09 ; BOARD N-28, N-38, N-66 ; ADR-105 (cette migration).
-- Appliquée sous `migrator`.
--
-- Principes (ADR-105, PROPOSÉ) :
--   - FAITS VÉRIFIÉS du KYC (N-28, N-38) : la date de naissance et le pays de résidence lus par le
--     fournisseur d'identité arrivent avec le rappel signé ; `core.kyc_cmd_decide_with_facts`
--     appelle la commande de 0072 INCHANGÉE puis, si le rappel est appliqué, consigne ces deux
--     champs (`core.kyc_identity_subject`) dans la même instruction. Règle de priorité : la valeur
--     VÉRIFIÉE du dossier d'identité courant fait foi ; à défaut, la date déclarée du compte et le
--     pays du compte d'hôte. Une date de naissance inconnue n'est jamais « majeure » ;
--   - dossier `core.kyc_host_verification` (un par compte d'hôte), soumis par la personne de la
--     session : KYC `APPROVED`, âge ≥ `host_min_age_years[pays]` (OQ-P2P-01), résidence vérifiée
--     égale au pays du compte d'hôte ; sinon REFUS, rien n'est écrit. Puis pièces manquantes :
--     filtrage des sanctions (`HOST_SCREENING_MISSING`), profil fiscal si
--     `p2p_host_requires_tax_id[pays]` (absent = exigé ; OQ-P2P-07 ; au Paraguay, le seul type admis
--     est le RUC : `config_country.host_tax_id_kinds`), CGU de l'hôte (`TERMS_REACCEPT_REQUIRED`,
--     N-66). Dossier incomplet = `DOCS_PENDING` ; complet = `IN_REVIEW` (décision de l'ops) ;
--   - filtrage des sanctions (VER-028) : résultat du port `SanctionsScreener` consigné
--     (`core.kyc_sanctions_screening`) : version des listes, résultat, référence OPAQUE de la
--     correspondance chez le prestataire ; AUCUNE donnée de la liste (nom, alias, programme) n'est
--     copiée. Correspondance (potentielle ou confirmée) ⇒ dossier `BLOCKED` (statut PROPOSÉ),
--     motif `HOST_SANCTIONS_HIT` journalisé (audit : code seulement), jamais activable ;
--   - profil fiscal (FIN-008) chiffré par la clé du SUJET (compte d'hôte, enveloppe v1 de
--     `@rueda/db/audit`, AAD `rueda.c2.v1|core.kyc_host_tax_profile.tax_id_enc|ORG:<id>`) : la base
--     ne voit jamais le numéro en clair (crypto-shredding par destruction de la clé) ; type de
--     numéro pris dans la configuration du pays, régime facultatif ; une personne morale est
--     refusée (`HOST_ENTITY_NOT_ALLOWED`, BR-ACC-06) ;
--   - décision de l'ops `HOST_VERIFICATION_DECISION` (cadre d'US-101) : APPROVED revérifie TOUT
--     (KYC, âge, résidence, filtrage, profil fiscal, CGU) ; puis l'ACTIVATION est tentée ; un
--     dossier approuvé dont l'activation est bloquée laisse le compte `PENDING_ACTIVATION`. Une
--     décision APPROVED sur un dossier déjà approuvé est une nouvelle tentative d'activation : son
--     blocage est un refus motivé ;
--   - activation (17 §2.4) : dossier `APPROVED`, âge revérifié (N-38), profil fiscal, CGU,
--     sous-marchand `ACTIVE` chez le PSP, `p2p_private_hosts_enabled[pays]` ET
--     `insurer_contract_active[pays]` lus par `core.config_go_live` (absent = false). Garde EN BASE
--     en plus de la commande : la politique d'écriture du compte d'hôte n'admet `ACTIVE` que si
--     `core.kyc_host_activation_allowed` est vraie. AUCUN interrupteur n'est écrit ici (17 §0.1) ;
--   - événements (17 §4.5) : `kyc.host_verification.decided`, `iam.organization.status_changed`
--     à chaque changement de statut du compte, `iam.organization.created` UNE fois, à la première
--     activation (N-38).
--
-- Écarts PROPOSÉS avec 17 §3.2.2 (à reporter, ADR-105) : `host_verification` gagne `country_code`,
-- `missing` (codes des pièces manquantes), `reason_code`, `residence_verified`, `activated_at`,
-- `row_version` et le statut `BLOCKED` ; `vehicle_title_checked` et `lender_consent_file_id`
-- restent à US-124, `host_terms_consent_id` est remplacé par la lecture de
-- `core.ctr_host_terms_required` (N-66) ; `sanctions_screening` gagne `host_verification_id`,
-- `provider`, `request_key`, `match_ref` ; profil fiscal en table propre (`kyc_host_tax_profile`)
-- au lieu de `organization.tax_id` (colonne en clair de 0010, laissée NULL).
--
-- Retour arrière :
--   DELETE FROM core.support_manual_action_handler WHERE action_code IN ('HOST_VERIFICATION_DECISION',
--     'HOST_SCREENING_REVIEW') ; DELETE FROM core.support_manual_action_catalog WHERE action_code =
--     'HOST_SCREENING_REVIEW' ; DROP FUNCTION core.kyc_manual_action_host_screening_review(…) ;
--   DROP FUNCTION core.kyc_manual_action_host_verification_decision(bytea, uuid, text, uuid, jsonb,
--     text, uuid, text), core.kyc_cmd_host_record_screening(bytea, uuid, text, text, text, jsonb,
--     text), core.kyc_cmd_host_submit(bytea, uuid), core.kyc_cmd_host_save_tax_profile(bytea, uuid,
--     text, bytea, text, text), core.kyc_host_state(bytea, uuid),
--     core.kyc_cmd_decide_with_facts(text, text, text, text, text, numeric, numeric, jsonb, jsonb),
--     core.kyc_host_try_activate(uuid, uuid, text), core.kyc_host_refresh(uuid),
--     core.kyc_host_activation_allowed(uuid, text), core.kyc_host_blockers(uuid),
--     core.kyc_host_gates(uuid), core.kyc_host_param(text, text), core.kyc_host_emit_org(uuid, text,
--     integer, text, text, uuid, text, text);
--   DROP TABLE core.kyc_host_tax_profile, core.kyc_sanctions_screening, core.kyc_host_verification,
--     core.kyc_identity_subject;
--   DROP POLICY kyc_cmd_read, kyc_cmd_host_update ON core.iam_organization ;
--   DROP POLICY kyc_cmd_host_read ON core.config_param_value, core.config_param_definition,
--     core.payment_psp_submerchant ; DROP POLICY kyc_cmd_host_event_ins ON core.outbox_outbox_event ;
--   DROP POLICY kyc_cmd_host_audit_insert ON core.audit_audit_log ; révoquer les droits ci-dessous.

-- 1. Droits de kyc_cmd_owner (propriétaire NOLOGIN des commandes KYC, amorçage) -----------------
GRANT EXECUTE ON FUNCTION core.config_go_live(text, text) TO kyc_cmd_owner;

-- comptes d'hôte de la session et CGU de l'hôte (fonctions d'iam_auth_owner : seul leur
-- propriétaire accorde EXECUTE)
SET LOCAL ROLE iam_auth_owner;
GRANT EXECUTE ON FUNCTION core.iam_host_accounts(bytea), core.ctr_host_terms_required(uuid, text)
  TO kyc_cmd_owner;
RESET ROLE;

-- file de revue HOST_VERIFICATION (US-109) : mise en file d'un dossier complet, clôture à la
-- décision (fonctions d'iam_staff_owner)
SET LOCAL ROLE iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.support_enqueue_review(text, text, uuid, text, uuid),
  core.support_close_review_item(uuid, text, text, uuid) TO kyc_cmd_owner;
RESET ROLE;

-- personne : date de naissance DÉCLARÉE (repli de la règle de priorité) en plus des colonnes de
-- 0072 (politique kyc_cmd_read de 0072 : USING true)
GRANT SELECT (date_of_birth) ON core.iam_user_account TO kyc_cmd_owner;

-- pays : types de numéro fiscal admis (données de configuration, jamais une constante)
GRANT SELECT (host_tax_id_kinds) ON core.config_country TO kyc_cmd_owner;

-- paramètres de l'hôte et interrupteurs du pays (lus par core.config_go_live sous ce rôle)
GRANT SELECT (key, go_live_switch) ON core.config_param_definition TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_host_read ON core.config_param_definition FOR SELECT TO kyc_cmd_owner
  USING (key IN ('p2p_private_hosts_enabled', 'insurer_contract_active'));
CREATE POLICY kyc_cmd_host_read ON core.config_param_value FOR SELECT TO kyc_cmd_owner
  USING (key IN ('host_min_age_years', 'p2p_host_requires_tax_id', 'p2p_private_hosts_enabled',
                 'insurer_contract_active'));

-- compte d'hôte : lecture ; seul changement admis, ONBOARDING → PENDING_ACTIVATION → ACTIVE, et
-- ACTIVE seulement si la règle d'activation est vraie (garde en base, 17 §2.4 ; politique posée
-- plus bas, après la fonction de garde)
GRANT SELECT (id, kind, holder_user_id, country_code, status, row_version) ON core.iam_organization
  TO kyc_cmd_owner;
GRANT UPDATE (status, updated_by) ON core.iam_organization TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_read ON core.iam_organization FOR SELECT TO kyc_cmd_owner USING (true);

-- sous-marchand du PSP : statut KYC et compte marchand (17 §3.2.7) ; capacités BLOQUANTES du PSP
-- de ce compte (17 §2.4 condition (1), §2.8 : inconnue = « non »), lues par
-- core.payment_missing_blocking_capabilities sous ce rôle
GRANT SELECT (org_id, kyc_status, psp_account_id) ON core.payment_psp_submerchant TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_host_read ON core.payment_psp_submerchant FOR SELECT TO kyc_cmd_owner
  USING (true);
GRANT SELECT (id, provider, country_code, collection_mode) ON core.payment_psp_account
  TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_host_read ON core.payment_psp_account FOR SELECT TO kyc_cmd_owner
  USING (true);
GRANT SELECT (capability, kind, blocking) ON core.payment_psp_capability_catalog TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_host_read ON core.payment_psp_capability_catalog FOR SELECT TO kyc_cmd_owner
  USING (true);
GRANT SELECT (provider, country_code, method, network, capability, value, status, valid_from)
  ON core.payment_psp_capability TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_host_read ON core.payment_psp_capability FOR SELECT TO kyc_cmd_owner
  USING (true);
GRANT EXECUTE ON FUNCTION core.payment_missing_blocking_capabilities(text, text, text)
  TO kyc_cmd_owner;

-- événements de l'hôte (17 §4.5) ; identifiant posé par la commande (rendu à la console sans
-- relire la table)
GRANT INSERT (id) ON core.outbox_outbox_event TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_host_event_ins ON core.outbox_outbox_event FOR INSERT TO kyc_cmd_owner
  WITH CHECK (((type IN ('kyc.host_verification.decided', 'kyc.host_screening.flagged')
                AND aggregate_type = 'host_verification')
               OR (type IN ('iam.organization.status_changed', 'iam.organization.created')
                   AND aggregate_type = 'organization'))
              AND actor_role IN ('GUEST', 'OPS_AGENT', 'ADMIN', 'SYSTEM'));

-- journal d'audit : décisions, filtrage, profil fiscal et activation de l'hôte (codes seulement) ;
-- motif et demande de la console en plus des colonnes de 0072
GRANT INSERT (reason, request_id) ON core.audit_audit_log TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_host_audit_insert ON core.audit_audit_log FOR INSERT TO kyc_cmd_owner
  WITH CHECK (action_code IN ('HOST_VERIFICATION_SUBMITTED', 'HOST_SANCTIONS_SCREENED',
                              'HOST_TAX_PROFILE_SAVED', 'HOST_VERIFICATION_DECIDED',
                              'HOST_ACCOUNT_STATUS_CHANGED', 'HOST_SCREENING_REVIEWED')
              AND subject_type = 'ORGANIZATION');

-- 2. Tables ------------------------------------------------------------------------------------
-- 2.1 Faits vérifiés par le fournisseur d'identité (date de naissance, pays de résidence) : un
-- enregistrement par tentative décidée ; aucune image, aucun numéro de pièce.
CREATE TABLE core.kyc_identity_subject (
  id                 uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_identity_subject_pkey PRIMARY KEY,
  verification_id    uuid        NOT NULL REFERENCES core.kyc_identity_verification (id),
  user_id            uuid        NOT NULL REFERENCES core.iam_user_account (id),
  attempt            integer     NOT NULL
    CONSTRAINT kyc_identity_subject_attempt_positive CHECK (attempt >= 1),
  date_of_birth      date                                                   -- [C2]
    CONSTRAINT kyc_identity_subject_birth_range CHECK (date_of_birth IS NULL OR date_of_birth >= DATE '1900-01-01'),
  residence_country  char(2)
    CONSTRAINT kyc_identity_subject_residence_format
      CHECK (residence_country IS NULL OR residence_country ~ '^[A-Z]{2}$'),
  created_at         timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT kyc_identity_subject_attempt_unique UNIQUE (verification_id, attempt)
);
CREATE INDEX kyc_identity_subject_user_idx ON core.kyc_identity_subject (user_id);
COMMENT ON TABLE core.kyc_identity_subject IS
  'KYC : date de naissance et pays de résidence VÉRIFIÉS par le fournisseur d''identité (rappel '
  'signé), par tentative ; source prioritaire de l''âge et de la résidence de l''hôte (N-28, '
  'N-38). US-123 (ADR-105).';

-- 2.2 Dossier de vérification de l'hôte (17 §3.2.2 host_verification) : un par compte d'hôte.
CREATE TABLE core.kyc_host_verification (
  id                        uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_host_verification_pkey PRIMARY KEY,
  org_id                    uuid        NOT NULL
    CONSTRAINT kyc_host_verification_org_unique UNIQUE,
  user_id                   uuid        NOT NULL REFERENCES core.iam_user_account (id),
  country_code              text        NOT NULL
    CONSTRAINT kyc_host_verification_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  status                    text        NOT NULL
    CONSTRAINT kyc_host_verification_status_valid CHECK (status IN (
      'OPEN', 'DOCS_PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'REVOKED', 'BLOCKED')),
  identity_verification_id  uuid        REFERENCES core.kyc_identity_verification (id),
  age_ok                    boolean     NOT NULL DEFAULT false,
  -- résidence lue par le fournisseur d'identité (true) ou pays déclaré du compte d'hôte (false)
  residence_verified        boolean     NOT NULL DEFAULT false,
  tax_id_checked_at         timestamptz,
  sanctions_screening_id    uuid,
  missing                   text[]      NOT NULL DEFAULT '{}'
    CONSTRAINT kyc_host_verification_missing_valid CHECK (
      pg_catalog.array_position(missing, NULL) IS NULL
      AND missing <@ ARRAY['HOST_SCREENING_MISSING', 'HOST_TAX_ID_REQUIRED',
                           'TERMS_REACCEPT_REQUIRED', 'HOST_KYC_REQUIRED']::text[]),
  reason_code               text
    CONSTRAINT kyc_host_verification_reason_format
      CHECK (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  decided_by                uuid        REFERENCES core.iam_user_account (id),
  decided_at                timestamptz,
  activated_at              timestamptz,
  row_version               integer     NOT NULL DEFAULT 0
    CONSTRAINT kyc_host_verification_row_version_valid CHECK (row_version >= 0),
  created_at                timestamptz NOT NULL DEFAULT platform.now(),
  updated_at                timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT kyc_host_verification_org_fk FOREIGN KEY (org_id, user_id)
    REFERENCES core.iam_organization (id, holder_user_id),
  CONSTRAINT kyc_host_verification_decided_coherent CHECK (
    (status IN ('APPROVED', 'REJECTED', 'REVOKED')) = (decided_at IS NOT NULL)),
  CONSTRAINT kyc_host_verification_approved_complete CHECK (
    status <> 'APPROVED' OR (age_ok AND pg_catalog.cardinality(missing) = 0
                             AND identity_verification_id IS NOT NULL
                             AND sanctions_screening_id IS NOT NULL)),
  CONSTRAINT kyc_host_verification_blocked_reason CHECK (status <> 'BLOCKED' OR reason_code IS NOT NULL),
  CONSTRAINT kyc_host_verification_activated_approved CHECK (activated_at IS NULL OR status = 'APPROVED')
);
CREATE INDEX kyc_host_verification_user_idx ON core.kyc_host_verification (user_id);
COMMENT ON TABLE core.kyc_host_verification IS
  'KYC host_verification (17 §3.2.2) : dossier de vérification individuelle de l''hôte, un par '
  'compte d''hôte ; écrit par les commandes 0075 seulement. US-123 (ADR-105).';

-- 2.3 Filtrage des sanctions (17 §3.2.2 sanctions_screening ; VER-028) : version des listes,
-- résultat et référence opaque ; aucune donnée de la liste.
CREATE TABLE core.kyc_sanctions_screening (
  id                    uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_sanctions_screening_pkey PRIMARY KEY,
  subject_type          text        NOT NULL DEFAULT 'PERSON'
    CONSTRAINT kyc_sanctions_screening_subject_type_valid CHECK (subject_type = 'PERSON'),
  subject_id            uuid        NOT NULL REFERENCES core.iam_user_account (id),
  host_verification_id  uuid        NOT NULL REFERENCES core.kyc_host_verification (id),
  provider              text        NOT NULL
    CONSTRAINT kyc_sanctions_screening_provider_format CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  request_key           text        NOT NULL
    CONSTRAINT kyc_sanctions_screening_request_key_format
      CHECK (request_key ~ '^screening:[0-9a-f-]{36}:a[1-9][0-9]{0,2}$'),
  -- { LISTE : version } : codes de listes et versions, jamais une entrée de liste
  lists_version         jsonb       NOT NULL
    CONSTRAINT kyc_sanctions_screening_lists_object CHECK (pg_catalog.jsonb_typeof(lists_version) = 'object'),
  result                text        NOT NULL
    CONSTRAINT kyc_sanctions_screening_result_valid
      CHECK (result IN ('CLEAR', 'POTENTIAL_MATCH', 'CONFIRMED_MATCH')),
  -- référence OPAQUE du dossier de correspondance chez le prestataire (jamais un nom)
  match_ref             text
    CONSTRAINT kyc_sanctions_screening_match_ref_format
      CHECK (match_ref IS NULL OR match_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  screened_at           timestamptz NOT NULL,
  -- revue humaine (US-108) ; NULL pour un filtrage automatique
  reviewer              uuid        REFERENCES core.iam_user_account (id),
  created_at            timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT kyc_sanctions_screening_request_unique UNIQUE (provider, request_key),
  CONSTRAINT kyc_sanctions_screening_match_ref_coherent CHECK (result <> 'CLEAR' OR match_ref IS NULL)
);
CREATE INDEX kyc_sanctions_screening_dossier_idx
  ON core.kyc_sanctions_screening (host_verification_id, created_at);
ALTER TABLE core.kyc_host_verification
  ADD CONSTRAINT kyc_host_verification_screening_fk FOREIGN KEY (sanctions_screening_id)
    REFERENCES core.kyc_sanctions_screening (id);
COMMENT ON TABLE core.kyc_sanctions_screening IS
  'KYC sanctions_screening (17 §3.2.2, VER-028) : filtrage d''une personne contre les listes de '
  'sanctions ; version des listes, résultat, référence opaque ; aucune donnée de la liste. '
  'US-123 (ADR-105).';

-- 2.4 Profil fiscal de l'hôte (FIN-008) : numéro chiffré par la clé du compte d'hôte.
CREATE TABLE core.kyc_host_tax_profile (
  id                       uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_host_tax_profile_pkey PRIMARY KEY,
  org_id                   uuid        NOT NULL
    CONSTRAINT kyc_host_tax_profile_org_unique UNIQUE,
  user_id                  uuid        NOT NULL REFERENCES core.iam_user_account (id),
  country_code             text        NOT NULL
    CONSTRAINT kyc_host_tax_profile_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- type de numéro (config_country.host_tax_id_kinds du pays)
  tax_id_kind              text        NOT NULL
    CONSTRAINT kyc_host_tax_profile_kind_format CHECK (tax_id_kind ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  -- enveloppe v1 (0x01 || nonce || texte chiffré || étiquette) par la clé du sujet [C2]
  tax_id_enc               bytea       NOT NULL
    CONSTRAINT kyc_host_tax_profile_envelope CHECK (
      pg_catalog.octet_length(tax_id_enc) BETWEEN 30 AND 128
      AND pg_catalog.get_byte(tax_id_enc, 0) = 1),
  tax_id_key_subject_type  text        NOT NULL DEFAULT 'ORG'
    CONSTRAINT kyc_host_tax_profile_key_type_valid CHECK (tax_id_key_subject_type = 'ORG'),
  tax_id_key_subject_id    uuid        NOT NULL,
  -- régime déclaré (code de la configuration fiscale du pays, facultatif ; FIN-008 SIMPLIFIÉ)
  regime                   text
    CONSTRAINT kyc_host_tax_profile_regime_format CHECK (regime IS NULL OR regime ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  taxpayer_kind            text        NOT NULL DEFAULT 'INDIVIDUAL'
    CONSTRAINT kyc_host_tax_profile_individual CHECK (taxpayer_kind = 'INDIVIDUAL'),
  row_version              integer     NOT NULL DEFAULT 0
    CONSTRAINT kyc_host_tax_profile_row_version_valid CHECK (row_version >= 0),
  created_at               timestamptz NOT NULL DEFAULT platform.now(),
  updated_at               timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT kyc_host_tax_profile_org_fk FOREIGN KEY (org_id, user_id)
    REFERENCES core.iam_organization (id, holder_user_id),
  CONSTRAINT kyc_host_tax_profile_key_is_org CHECK (tax_id_key_subject_id = org_id)
);
COMMENT ON TABLE core.kyc_host_tax_profile IS
  'KYC / FIN-008 : profil fiscal de l''hôte (type de numéro, numéro chiffré par la clé du compte '
  'd''hôte, régime) ; la base ne voit jamais le numéro en clair. US-123 (ADR-105).';

-- 3. RLS : aucun droit de table pour les rôles applicatifs -------------------------------------
ALTER TABLE core.kyc_identity_subject ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_identity_subject FORCE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_host_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_host_verification FORCE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_sanctions_screening ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_sanctions_screening FORCE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_host_tax_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_host_tax_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.kyc_identity_subject TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.kyc_host_verification TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.kyc_sanctions_screening TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.kyc_host_tax_profile TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.kyc_identity_subject, core.kyc_host_verification, core.kyc_sanctions_screening,
  core.kyc_host_tax_profile FROM PUBLIC;

-- kyc_cmd_owner : ses commandes seules ; aucune suppression
GRANT SELECT, INSERT ON core.kyc_identity_subject TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.kyc_identity_subject FOR SELECT TO kyc_cmd_owner USING (true);
CREATE POLICY kyc_cmd_insert ON core.kyc_identity_subject FOR INSERT TO kyc_cmd_owner WITH CHECK (true);

GRANT SELECT, INSERT ON core.kyc_host_verification TO kyc_cmd_owner;
GRANT UPDATE (status, identity_verification_id, age_ok, residence_verified, tax_id_checked_at,
              sanctions_screening_id, missing, reason_code, decided_by, decided_at, activated_at,
              row_version, updated_at)
  ON core.kyc_host_verification TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.kyc_host_verification FOR SELECT TO kyc_cmd_owner USING (true);
-- un dossier naît ouvert, non décidé
CREATE POLICY kyc_cmd_insert ON core.kyc_host_verification FOR INSERT TO kyc_cmd_owner
  WITH CHECK (status IN ('OPEN', 'DOCS_PENDING', 'IN_REVIEW') AND decided_at IS NULL
              AND activated_at IS NULL);
-- un dossier refusé ou révoqué ne change plus (les autres transitions sont jugées par les
-- commandes : un dossier bloqué n'est jamais approuvé, contrôle de la décision)
CREATE POLICY kyc_cmd_update ON core.kyc_host_verification FOR UPDATE TO kyc_cmd_owner
  USING (status NOT IN ('REJECTED', 'REVOKED'))
  WITH CHECK (true);

GRANT SELECT, INSERT ON core.kyc_sanctions_screening TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.kyc_sanctions_screening FOR SELECT TO kyc_cmd_owner USING (true);
CREATE POLICY kyc_cmd_insert ON core.kyc_sanctions_screening FOR INSERT TO kyc_cmd_owner
  WITH CHECK (true);

GRANT SELECT, INSERT ON core.kyc_host_tax_profile TO kyc_cmd_owner;
GRANT UPDATE (tax_id_kind, tax_id_enc, regime, row_version, updated_at)
  ON core.kyc_host_tax_profile TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.kyc_host_tax_profile FOR SELECT TO kyc_cmd_owner USING (true);
CREATE POLICY kyc_cmd_insert ON core.kyc_host_tax_profile FOR INSERT TO kyc_cmd_owner
  WITH CHECK (true);
CREATE POLICY kyc_cmd_update ON core.kyc_host_tax_profile FOR UPDATE TO kyc_cmd_owner
  USING (true) WITH CHECK (true);

-- 4. Primitives (SECURITY INVOKER ; EXECUTE au seul kyc_cmd_owner) ------------------------------
-- Valeur d'un paramètre de pays en vigueur à platform.now() ; NULL si absent.
CREATE FUNCTION core.kyc_host_param(p_key text, p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT v.value
    FROM core.config_param_value AS v CROSS JOIN t
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

-- Contrôles d'un compte d'hôte, à l'horloge de la base (une ligne) :
--   kyc_id         : vérification d'identité courante APPROUVÉE de la personne (sinon NULL) ;
--   age            : OK, UNDER_AGE, UNVERIFIED (date inconnue), PARAM_MISSING ;
--   residence      : VERIFIED (résidence vérifiée = pays du compte), DECLARED (aucune résidence
--                    vérifiée : pays du compte d'hôte), MISMATCH ;
--   tax            : OK, MISSING (exigé et absent) ;
--   terms_ok       : CGU de l'hôte acceptées dans la version exigée (N-66) ;
--   screening_id / screening_result : dernier filtrage du dossier ;
--   submerchant_ok : un sous-marchand ACTIVE chez le PSP, sur un compte marchand du pays ;
--   capabilities_ok : toutes les capacités BLOQUANTES du PSP de ce compte validées
--                    (`VALIDATED_*`, variante du compte ; inconnue = « non », 17 §2.4, §2.8) ;
--   p2p_open, insurer_open : interrupteurs du pays (absent = false).
CREATE FUNCTION core.kyc_host_gates(p_org uuid)
  RETURNS TABLE (org_id uuid, user_id uuid, country_code text, org_status text, kyc_id uuid,
                 age text, residence text, tax text, terms_ok boolean, screening_id uuid,
                 screening_result text, submerchant_ok boolean, capabilities_ok boolean,
                 p2p_open boolean, insurer_open boolean)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_org      record;
  v_kyc      record;
  v_birth    date;
  v_res      text;
  v_tz       text;
  v_min      jsonb;
  v_age      text;
  v_resid    text;
  v_req      jsonb;
  v_tax      text;
  v_scr      record;
BEGIN
  SELECT o.id, o.holder_user_id, o.country_code, o.status INTO v_org
    FROM core.iam_organization AS o WHERE o.id = p_org AND o.kind = 'P2P_HOST_INDIVIDUAL';
  IF v_org.id IS NULL THEN
    RETURN;
  END IF;
  SELECT v.id, v.attempt INTO v_kyc FROM core.kyc_identity_verification AS v
   WHERE v.user_id = v_org.holder_user_id AND v.is_current AND v.status = 'APPROVED';
  -- règle de priorité : faits VÉRIFIÉS de la vérification courante approuvée, sinon déclarés
  IF v_kyc.id IS NOT NULL THEN
    SELECT s.date_of_birth, s.residence_country::text INTO v_birth, v_res
      FROM core.kyc_identity_subject AS s
     WHERE s.verification_id = v_kyc.id AND s.attempt = v_kyc.attempt;
  END IF;
  IF v_birth IS NULL THEN
    SELECT u.date_of_birth INTO v_birth FROM core.iam_user_account AS u
     WHERE u.id = v_org.holder_user_id;
  END IF;
  -- âge minimal du pays (OQ-P2P-01), au jour du fuseau du pays
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = v_org.country_code;
  v_min := core.kyc_host_param('host_min_age_years', v_org.country_code);
  IF v_min IS NULL OR pg_catalog.jsonb_typeof(v_min) <> 'number'
     OR (v_min #>> '{}') !~ '^[0-9]{1,3}$' OR v_tz IS NULL THEN
    v_age := 'PARAM_MISSING';
  ELSIF v_birth IS NULL THEN
    v_age := 'UNVERIFIED';
  ELSIF v_birth > (platform.now() AT TIME ZONE v_tz)::date
                  - pg_catalog.make_interval(years => (v_min #>> '{}')::integer) THEN
    v_age := 'UNDER_AGE';
  ELSE
    v_age := 'OK';
  END IF;
  v_resid := CASE WHEN v_res IS NULL THEN 'DECLARED'
                  WHEN v_res = v_org.country_code THEN 'VERIFIED'
                  ELSE 'MISMATCH' END;
  -- profil fiscal : exigé si le paramètre vaut true ou s'il est absent (fail-closed, OQ-P2P-07)
  v_req := core.kyc_host_param('p2p_host_requires_tax_id', v_org.country_code);
  IF v_req IS NOT DISTINCT FROM 'false'::jsonb
     OR EXISTS (SELECT 1 FROM core.kyc_host_tax_profile AS p
                  JOIN core.config_country AS k ON k.code::text = p.country_code
                 WHERE p.org_id = v_org.id AND p.country_code = v_org.country_code
                   AND p.tax_id_kind = ANY (k.host_tax_id_kinds)) THEN
    v_tax := 'OK';
  ELSE
    v_tax := 'MISSING';
  END IF;
  SELECT s.id, s.result INTO v_scr
    FROM core.kyc_host_verification AS h
    JOIN core.kyc_sanctions_screening AS s ON s.id = h.sanctions_screening_id
   WHERE h.org_id = v_org.id;
  RETURN QUERY SELECT
    v_org.id, v_org.holder_user_id, v_org.country_code, v_org.status, v_kyc.id, v_age, v_resid,
    v_tax, NOT core.ctr_host_terms_required(v_org.holder_user_id, v_org.country_code),
    v_scr.id, v_scr.result,
    EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS m
              JOIN core.payment_psp_account AS a ON a.id = m.psp_account_id
             WHERE m.org_id = v_org.id AND m.kyc_status = 'ACTIVE'
               AND a.country_code = v_org.country_code),
    EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS m
              JOIN core.payment_psp_account AS a ON a.id = m.psp_account_id
             WHERE m.org_id = v_org.id AND m.kyc_status = 'ACTIVE'
               AND a.country_code = v_org.country_code
               AND pg_catalog.cardinality(core.payment_missing_blocking_capabilities(
                     a.provider, a.country_code, a.collection_mode)) = 0),
    core.config_go_live('p2p_private_hosts_enabled', v_org.country_code),
    core.config_go_live('insurer_contract_active', v_org.country_code);
END
$fn$;

-- Blocages de l'ACTIVATION d'un compte d'hôte (17 §2.4), dans cet ordre : âge revérifié (N-38),
-- résidence, profil fiscal, CGU de l'hôte, dossier non approuvé, sous-marchand non ACTIVE,
-- capacité bloquante du PSP non validée, pays fermé aux hôtes particuliers, contrat d'assureur
-- inactif. Tableau vide = activable.
CREATE FUNCTION core.kyc_host_blockers(p_org uuid)
  RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  g  record;
  b  text[] := '{}';
BEGIN
  SELECT * INTO g FROM core.kyc_host_gates(p_org);
  IF g.org_id IS NULL THEN
    RETURN ARRAY['HOST_NOT_ACTIVATED'];
  END IF;
  IF g.age = 'UNDER_AGE' THEN b := b || 'HOST_UNDER_AGE'::text;
  ELSIF g.age = 'UNVERIFIED' THEN b := b || 'HOST_AGE_UNVERIFIED'::text;
  ELSIF g.age <> 'OK' THEN b := b || 'PARAM_MISSING'::text;
  END IF;
  IF g.residence = 'MISMATCH' THEN b := b || 'HOST_RESIDENCE_MISMATCH'::text; END IF;
  IF g.tax <> 'OK' THEN b := b || 'HOST_TAX_ID_REQUIRED'::text; END IF;
  IF NOT g.terms_ok THEN b := b || 'TERMS_REACCEPT_REQUIRED'::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM core.kyc_host_verification AS h
                  WHERE h.org_id = p_org AND h.status = 'APPROVED') THEN
    b := b || 'HOST_VERIFICATION_NOT_APPROVED'::text;
  END IF;
  IF NOT g.submerchant_ok THEN b := b || 'SUBMERCHANT_NOT_ACTIVE'::text; END IF;
  -- capacité bloquante inconnue ou non validée : hôte non activable (CLAUDE.md contrainte 4)
  IF NOT g.capabilities_ok THEN b := b || 'PSP_CAPABILITY_MISSING'::text; END IF;
  IF NOT g.p2p_open THEN b := b || 'P2P_HOSTS_DISABLED'::text; END IF;
  IF NOT g.insurer_open THEN b := b || 'INSURER_CONTRACT_INACTIVE'::text; END IF;
  RETURN b;
END
$fn$;

-- Garde EN BASE de l'activation (politique d'écriture du compte d'hôte) : vraie seulement si la
-- règle de 17 §2.4 est remplie à cet instant, interrupteurs compris.
CREATE FUNCTION core.kyc_host_activation_allowed(p_org uuid, p_country text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_org IS NOT NULL AND p_country IS NOT NULL
     AND core.config_go_live('p2p_private_hosts_enabled', p_country)
     AND core.config_go_live('insurer_contract_active', p_country)
     AND pg_catalog.cardinality(core.kyc_host_blockers(p_org)) = 0
$fn$;

-- Événement du compte d'hôte (17 §4.5 : org_id, from, to) ; rend son identifiant.
CREATE FUNCTION core.kyc_host_emit_org(p_org uuid, p_type text, p_version integer, p_from text,
                                       p_to text, p_actor uuid, p_actor_role text, p_country text)
  RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := platform.uuid_v7();
BEGIN
  INSERT INTO core.outbox_outbox_event
         (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES (v_id, p_type, 1, 'organization', p_org, p_version, p_country,
          CASE WHEN p_actor_role = 'SYSTEM' THEN NULL ELSE p_actor END, p_actor_role,
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('org_id', p_org, 'from', p_from, 'to', p_to),
          p_org::text);
  RETURN v_id;
END
$fn$;

-- Statut d'un dossier encore ouvert recalculé (pièces manquantes) ; un dossier décidé ou bloqué
-- ne change pas. Rend le statut.
CREATE FUNCTION core.kyc_host_refresh(p_dossier uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  h        record;
  g        record;
  v_miss   text[] := '{}';
  v_status text;
BEGIN
  SELECT d.* INTO h FROM core.kyc_host_verification AS d WHERE d.id = p_dossier;
  IF h.id IS NULL OR h.status NOT IN ('OPEN', 'DOCS_PENDING', 'IN_REVIEW') THEN
    RETURN h.status;
  END IF;
  SELECT * INTO g FROM core.kyc_host_gates(h.org_id);
  IF g.kyc_id IS NULL THEN v_miss := v_miss || 'HOST_KYC_REQUIRED'::text; END IF;
  IF g.screening_id IS NULL THEN v_miss := v_miss || 'HOST_SCREENING_MISSING'::text; END IF;
  IF g.tax <> 'OK' THEN v_miss := v_miss || 'HOST_TAX_ID_REQUIRED'::text; END IF;
  IF NOT g.terms_ok THEN v_miss := v_miss || 'TERMS_REACCEPT_REQUIRED'::text; END IF;
  v_status := CASE WHEN pg_catalog.cardinality(v_miss) = 0 THEN 'IN_REVIEW' ELSE 'DOCS_PENDING' END;
  -- dossier complet : file de revue de l'ops (échéance du pays ; paramètre absent : pas de file,
  -- le dossier reste visible dans la console)
  IF v_status = 'IN_REVIEW' AND h.status <> 'IN_REVIEW' THEN
    PERFORM 1 FROM core.support_enqueue_review('HOST_VERIFICATION', 'ORGANIZATION', h.org_id,
                                                g.country_code, h.user_id);
  END IF;
  UPDATE core.kyc_host_verification AS d
     SET status = v_status, missing = v_miss, identity_verification_id = g.kyc_id,
         age_ok = (g.age = 'OK'), residence_verified = (g.residence = 'VERIFIED'),
         tax_id_checked_at = CASE WHEN g.tax = 'OK' THEN COALESCE(d.tax_id_checked_at, platform.now()) END,
         row_version = d.row_version + 1, updated_at = platform.now()
   WHERE d.id = h.id;
  RETURN v_status;
END
$fn$;

-- Tentative d'activation d'un compte d'hôte dont le dossier est approuvé (17 §2.4) : ACTIVE si
-- aucun blocage (garde en base par la politique d'écriture), sinon PENDING_ACTIVATION. Le compte
-- n'est jamais écrit par une instruction qui ne change pas son statut. Événements :
-- iam.organization.status_changed à chaque changement, iam.organization.created à la première
-- activation seulement (N-38).
CREATE FUNCTION core.kyc_host_try_activate(p_org uuid, p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, blockers text[], event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_org     record;
  v_b       text[];
  v_to      text;
  v_ver     integer;
  v_events  uuid[] := '{}';
  v_first   boolean;
BEGIN
  SELECT o.id, o.status, o.country_code INTO v_org FROM core.iam_organization AS o WHERE o.id = p_org;
  IF v_org.id IS NULL OR v_org.status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_NOT_ACTIVATED'::text, ARRAY['HOST_NOT_ACTIVATED']::text[], '{}'::uuid[];
    RETURN;
  END IF;
  IF v_org.status = 'ACTIVE' THEN
    RETURN QUERY SELECT 'ALREADY_ACTIVE'::text, '{}'::text[], '{}'::uuid[];
    RETURN;
  END IF;
  v_b := core.kyc_host_blockers(p_org);
  v_to := CASE WHEN pg_catalog.cardinality(v_b) = 0 THEN 'ACTIVE' ELSE 'PENDING_ACTIVATION' END;
  IF v_to <> v_org.status THEN
    UPDATE core.iam_organization AS o SET status = v_to, updated_by = p_actor
     WHERE o.id = p_org AND o.status = v_org.status
    RETURNING o.row_version INTO v_ver;
    IF v_ver IS NULL THEN
      RAISE EXCEPTION 'kyc : compte d''hôte modifié pendant l''activation'
        USING ERRCODE = 'serialization_failure';
    END IF;
    v_events := v_events || core.kyc_host_emit_org(p_org, 'iam.organization.status_changed', v_ver,
                                                   v_org.status, v_to, p_actor, p_actor_role,
                                                   v_org.country_code);
    INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                      subject_id, before, after)
    VALUES (p_actor, p_actor_role, 'HOST_ACCOUNT_STATUS_CHANGED', 'ORGANIZATION', p_org,
            pg_catalog.jsonb_build_object('status', v_org.status),
            pg_catalog.jsonb_build_object('country', v_org.country_code,
                                          'countries', pg_catalog.jsonb_build_array(v_org.country_code),
                                          'status', v_to, 'blockers', pg_catalog.to_jsonb(v_b)));
  END IF;
  IF v_to = 'ACTIVE' THEN
    SELECT h.activated_at IS NULL INTO v_first FROM core.kyc_host_verification AS h
     WHERE h.org_id = p_org AND h.status = 'APPROVED';
    UPDATE core.kyc_host_verification AS h
       SET activated_at = COALESCE(h.activated_at, platform.now()),
           row_version = h.row_version + 1, updated_at = platform.now()
     WHERE h.org_id = p_org AND h.status = 'APPROVED';
    IF COALESCE(v_first, false) THEN
      v_events := v_events || core.kyc_host_emit_org(p_org, 'iam.organization.created', v_ver,
                                                     NULL, 'ACTIVE', p_actor, p_actor_role,
                                                     v_org.country_code);
    END IF;
    RETURN QUERY SELECT 'ACTIVATED'::text, '{}'::text[], v_events;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'PENDING_ACTIVATION'::text, v_b, v_events;
END
$fn$;

REVOKE ALL ON FUNCTION core.kyc_host_param(text, text), core.kyc_host_gates(uuid),
  core.kyc_host_blockers(uuid), core.kyc_host_activation_allowed(uuid, text),
  core.kyc_host_emit_org(uuid, text, integer, text, text, uuid, text, text),
  core.kyc_host_refresh(uuid), core.kyc_host_try_activate(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_host_param(text, text), core.kyc_host_gates(uuid),
  core.kyc_host_blockers(uuid), core.kyc_host_activation_allowed(uuid, text),
  core.kyc_host_emit_org(uuid, text, integer, text, text, uuid, text, text),
  core.kyc_host_refresh(uuid), core.kyc_host_try_activate(uuid, uuid, text) TO kyc_cmd_owner;

-- Politique d'écriture du compte d'hôte par kyc_cmd_owner : depuis ONBOARDING ou
-- PENDING_ACTIVATION seulement ; vers PENDING_ACTIVATION, ou vers ACTIVE si la garde est vraie.
CREATE POLICY kyc_cmd_host_update ON core.iam_organization FOR UPDATE TO kyc_cmd_owner
  USING (kind = 'P2P_HOST_INDIVIDUAL' AND status IN ('ONBOARDING', 'PENDING_ACTIVATION'))
  WITH CHECK (kind = 'P2P_HOST_INDIVIDUAL'
              AND (status = 'PENDING_ACTIVATION'
                   OR (status = 'ACTIVE' AND core.kyc_host_activation_allowed(id, country_code))));

-- 5. Décision du fournisseur avec les faits vérifiés (SECURITY DEFINER, EXECUTE app_api) ---------
-- Appelle core.kyc_cmd_apply_decision (0072, inchangée) puis, si le rappel est APPLIQUÉ, consigne
-- la date de naissance et le pays de résidence lus par le fournisseur pour la tentative décidée.
-- Champ mal formé : ignoré (NULL), jamais une erreur qui perdrait la décision.
CREATE FUNCTION core.kyc_cmd_decide_with_facts(p_provider text, p_event_id text,
                                                  p_session_ref text, p_subject_ref text,
                                                  p_decision text, p_liveness numeric,
                                                  p_face_match numeric, p_document jsonb,
                                                  p_subject jsonb)
  RETURNS TABLE (outcome text, status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_r      record;
  v_v      record;
  v_birth  date;
  v_res    text;
BEGIN
  SELECT d.outcome, d.status INTO v_r
    FROM core.kyc_cmd_apply_decision(p_provider, p_event_id, p_session_ref, p_subject_ref,
                                     p_decision, p_liveness, p_face_match, p_document) AS d;
  IF v_r.outcome = 'APPLIED' AND p_subject IS NOT NULL
     AND pg_catalog.jsonb_typeof(p_subject) = 'object' THEN
    SELECT v.id, v.user_id, v.attempt INTO v_v FROM core.kyc_identity_verification AS v
     WHERE v.provider = p_provider AND v.provider_session_ref = p_session_ref
       AND v.id::text = p_subject_ref AND v.is_current;
    IF COALESCE(p_subject ->> 'dateOfBirth', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      BEGIN
        v_birth := (p_subject ->> 'dateOfBirth')::date;
      EXCEPTION WHEN others THEN
        v_birth := NULL;
      END;
      IF v_birth < DATE '1900-01-01' OR v_birth > (platform.now())::date THEN
        v_birth := NULL;
      END IF;
    END IF;
    v_res := CASE WHEN COALESCE(p_subject ->> 'residenceCountry', '') ~ '^[A-Z]{2}$'
                  THEN p_subject ->> 'residenceCountry' END;
    IF v_v.id IS NOT NULL AND (v_birth IS NOT NULL OR v_res IS NOT NULL) THEN
      INSERT INTO core.kyc_identity_subject (verification_id, user_id, attempt, date_of_birth,
                                             residence_country)
      VALUES (v_v.id, v_v.user_id, v_v.attempt, v_birth, v_res)
      ON CONFLICT ON CONSTRAINT kyc_identity_subject_attempt_unique DO NOTHING;
    END IF;
  END IF;
  RETURN QUERY SELECT v_r.outcome, v_r.status;
END
$fn$;

-- 6. Lecture de l'état de l'hôte de la session (SECURITY DEFINER, EXECUTE app_api) --------------
-- Ses seules données, pour SON compte d'hôte : statut du compte et du dossier, pièces manquantes,
-- contrôles (sans date de naissance ni numéro fiscal), types de numéro admis dans le pays, blocages
-- de l'activation (pays fermé compris). Correspondance de sanctions : JAMAIS révélée (VER-028,
-- tipping-off) : un dossier `BLOCKED` est rendu comme `IN_REVIEW`, sans pièce manquante.
-- Issues : OK, AUTH_REQUIRED, FORBIDDEN (compte d'un autre ou inconnu : rien n'est révélé).
CREATE FUNCTION core.kyc_host_state(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (outcome text, country_code text, org_status text, verification_status text,
                 missing text[], kyc_approved boolean, age_status text, residence_status text,
                 tax_required boolean, tax_saved boolean, tax_kind text, tax_kinds text[],
                 terms_ok boolean, screening_done boolean, blockers text[])
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user  uuid;
  v_ok    boolean;
  g       record;
  h       record;
  v_kind  text;
  v_kinds text[];
  v_req   jsonb;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::text, NULL::text, NULL::text[],
      NULL::boolean, NULL::text, NULL::text, NULL::boolean, NULL::boolean, NULL::text,
      NULL::text[], NULL::boolean, NULL::boolean, NULL::text[];
    RETURN;
  END IF;
  v_ok := EXISTS (SELECT 1 FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org);
  IF NOT v_ok THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::text, NULL::text, NULL::text, NULL::text[],
      NULL::boolean, NULL::text, NULL::text, NULL::boolean, NULL::boolean, NULL::text,
      NULL::text[], NULL::boolean, NULL::boolean, NULL::text[];
    RETURN;
  END IF;
  SELECT * INTO g FROM core.kyc_host_gates(p_org);
  SELECT d.status, d.missing INTO h FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  SELECT p.tax_id_kind INTO v_kind FROM core.kyc_host_tax_profile AS p WHERE p.org_id = p_org;
  SELECT k.host_tax_id_kinds INTO v_kinds FROM core.config_country AS k
   WHERE k.code::text = g.country_code;
  v_req := core.kyc_host_param('p2p_host_requires_tax_id', g.country_code);
  RETURN QUERY SELECT 'OK'::text, g.country_code, g.org_status,
    CASE WHEN h.status = 'BLOCKED' THEN 'IN_REVIEW' ELSE h.status END,
    CASE WHEN h.status = 'BLOCKED' THEN '{}'::text[] ELSE COALESCE(h.missing, '{}'::text[]) END,
    g.kyc_id IS NOT NULL,
    CASE WHEN g.age = 'PARAM_MISSING' THEN 'UNVERIFIED' ELSE g.age END, g.residence,
    v_req IS DISTINCT FROM 'false'::jsonb, g.tax = 'OK' AND v_kind IS NOT NULL, v_kind,
    COALESCE(v_kinds, '{}'::text[]), g.terms_ok, g.screening_id IS NOT NULL,
    CASE WHEN g.org_status = 'ACTIVE' THEN '{}'::text[] ELSE core.kyc_host_blockers(p_org) END;
END
$fn$;

-- 7. Profil fiscal (SECURITY DEFINER, EXECUTE app_api) -------------------------------------------
-- Le numéro arrive CHIFFRÉ par l'API (clé du compte d'hôte) : la base n'en voit que l'enveloppe.
-- Issues : SAVED, AUTH_REQUIRED, FORBIDDEN, HOST_ENTITY_NOT_ALLOWED (personne morale),
-- HOST_TAX_ID_KIND_INVALID (type non admis dans le pays), REQUEST_INVALID (enveloppe ou régime
-- mal formés), HOST_VERIFICATION_LOCKED (dossier en revue, décidé ou bloqué : nouvelle revue,
-- hors bêta).
CREATE FUNCTION core.kyc_cmd_host_save_tax_profile(p_token_hash bytea, p_org uuid, p_kind text,
                                                   p_tax_id_enc bytea, p_regime text,
                                                   p_taxpayer_kind text)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_country text;
  v_kinds   text[];
  v_status  text;
  v_prev    uuid;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text;
    RETURN;
  END IF;
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text;
    RETURN;
  END IF;
  -- personne physique seulement (BR-ACC-06, DEC-FONDATEUR-13)
  IF p_taxpayer_kind IS DISTINCT FROM 'INDIVIDUAL' THEN
    RETURN QUERY SELECT 'HOST_ENTITY_NOT_ALLOWED'::text;
    RETURN;
  END IF;
  SELECT k.host_tax_id_kinds INTO v_kinds FROM core.config_country AS k WHERE k.code::text = v_country;
  IF p_kind IS NULL OR v_kinds IS NULL OR NOT (p_kind = ANY (v_kinds)) THEN
    RETURN QUERY SELECT 'HOST_TAX_ID_KIND_INVALID'::text;
    RETURN;
  END IF;
  IF p_tax_id_enc IS NULL OR pg_catalog.octet_length(p_tax_id_enc) NOT BETWEEN 30 AND 128
     OR pg_catalog.get_byte(p_tax_id_enc, 0) <> 1
     OR (p_regime IS NOT NULL AND p_regime !~ '^[A-Z][A-Z0-9_]{1,31}$') THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.host:' || p_org::text, 0));
  SELECT d.status INTO v_status FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  -- dossier en revue, décidé ou bloqué : verrouillé (en revue et bloqué indiscernables, VER-028)
  IF v_status IN ('IN_REVIEW', 'APPROVED', 'REJECTED', 'REVOKED', 'BLOCKED') THEN
    RETURN QUERY SELECT 'HOST_VERIFICATION_LOCKED'::text;
    RETURN;
  END IF;
  SELECT p.id INTO v_prev FROM core.kyc_host_tax_profile AS p WHERE p.org_id = p_org;
  IF v_prev IS NULL THEN
    INSERT INTO core.kyc_host_tax_profile (org_id, user_id, country_code, tax_id_kind, tax_id_enc,
                                           tax_id_key_subject_id, regime)
    VALUES (p_org, v_user, v_country, p_kind, p_tax_id_enc, p_org, p_regime);
  ELSE
    UPDATE core.kyc_host_tax_profile AS p
       SET tax_id_kind = p_kind, tax_id_enc = p_tax_id_enc, regime = p_regime,
           row_version = p.row_version + 1, updated_at = platform.now()
     WHERE p.id = v_prev;
  END IF;
  -- audit : type seulement, jamais le numéro
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (v_user, 'GUEST', 'HOST_TAX_PROFILE_SAVED', 'ORGANIZATION', p_org, NULL,
          pg_catalog.jsonb_build_object('country', v_country,
                                        'countries', pg_catalog.jsonb_build_array(v_country),
                                        'kind', p_kind, 'replaced', v_prev IS NOT NULL));
  RETURN QUERY SELECT 'SAVED'::text;
END
$fn$;

-- 8. Soumission du dossier par l'hôte (SECURITY DEFINER, EXECUTE app_api) -----------------------
-- Refus (rien n'est écrit) : AUTH_REQUIRED, FORBIDDEN, HOST_ACCOUNT_NOT_ELIGIBLE (compte d'hôte
-- suspendu ou sorti), HOST_KYC_REQUIRED (vérification d'identité non approuvée), PARAM_MISSING,
-- HOST_AGE_UNVERIFIED (date de naissance inconnue), HOST_UNDER_AGE, HOST_RESIDENCE_MISMATCH.
-- Sinon SUBMITTED (dossier créé ou recalculé) ou DECIDED (dossier décidé ou bloqué : inchangé).
-- Si aucun filtrage n'est consigné : clé de la demande de filtrage et référence de la session
-- d'identité approuvée chez le fournisseur (le prestataire de filtrage la reprend ; aucun nom ne
-- sort de l'application).
CREATE FUNCTION core.kyc_cmd_host_submit(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (outcome text, verification_id uuid, status text, missing text[],
                 screening_key text, identity_provider text, identity_session_ref text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  g        record;
  h        record;
  v_id     uuid;
  v_status text;
  v_kyc    record;
  v_new    boolean := false;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text[], NULL::text,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org) THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::text, NULL::text[], NULL::text,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.host:' || p_org::text, 0));
  SELECT * INTO g FROM core.kyc_host_gates(p_org);
  SELECT d.id, d.status INTO h FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  IF h.status IN ('APPROVED', 'REJECTED', 'REVOKED', 'BLOCKED') THEN
    RETURN QUERY SELECT 'DECIDED'::text, h.id, h.status, NULL::text[], NULL::text, NULL::text,
                        NULL::text;
    RETURN;
  END IF;
  IF g.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_NOT_ELIGIBLE'::text, NULL::uuid, NULL::text, NULL::text[],
                        NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF g.kyc_id IS NULL THEN
    RETURN QUERY SELECT 'HOST_KYC_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text[], NULL::text,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  IF g.age <> 'OK' THEN
    RETURN QUERY SELECT CASE g.age WHEN 'UNDER_AGE' THEN 'HOST_UNDER_AGE'
                                   WHEN 'UNVERIFIED' THEN 'HOST_AGE_UNVERIFIED'
                                   ELSE 'PARAM_MISSING' END::text,
                        NULL::uuid, NULL::text, NULL::text[], NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF g.residence = 'MISMATCH' THEN
    RETURN QUERY SELECT 'HOST_RESIDENCE_MISMATCH'::text, NULL::uuid, NULL::text, NULL::text[],
                        NULL::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  v_id := h.id;
  IF v_id IS NULL THEN
    INSERT INTO core.kyc_host_verification (org_id, user_id, country_code, status)
    VALUES (p_org, v_user, g.country_code, 'OPEN')
    RETURNING id INTO v_id;
    v_new := true;
  END IF;
  v_status := core.kyc_host_refresh(v_id);
  SELECT d.status, d.missing INTO h FROM core.kyc_host_verification AS d WHERE d.id = v_id;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (v_user, 'GUEST', 'HOST_VERIFICATION_SUBMITTED', 'ORGANIZATION', p_org, NULL,
          pg_catalog.jsonb_build_object('country', g.country_code,
                                        'countries', pg_catalog.jsonb_build_array(g.country_code),
                                        'verificationId', v_id, 'status', h.status,
                                        'missing', pg_catalog.to_jsonb(h.missing), 'created', v_new));
  SELECT v.provider, v.provider_session_ref INTO v_kyc
    FROM core.kyc_identity_verification AS v WHERE v.id = g.kyc_id;
  RETURN QUERY SELECT 'SUBMITTED'::text, v_id, h.status, h.missing,
    CASE WHEN g.screening_id IS NULL THEN pg_catalog.format('screening:%s:a1', v_id) END,
    CASE WHEN g.screening_id IS NULL THEN v_kyc.provider END,
    CASE WHEN g.screening_id IS NULL THEN v_kyc.provider_session_ref END;
END
$fn$;

-- 9. Résultat du filtrage des sanctions (SECURITY DEFINER, EXECUTE app_api) ----------------------
-- Consigné par l'API après l'appel au port `SanctionsScreener` (clé rendue par la soumission).
-- Idempotent par (prestataire, clé) ; un second filtrage d'un dossier déjà filtré est refusé.
-- Correspondance ⇒ dossier BLOCKED, motif HOST_SANCTIONS_HIT journalisé (code seulement).
-- Issues : RECORDED, DUPLICATE, AUTH_REQUIRED, FORBIDDEN, NOT_FOUND (aucun dossier),
-- REQUEST_INVALID, ALREADY_SCREENED.
CREATE FUNCTION core.kyc_cmd_host_record_screening(p_token_hash bytea, p_org uuid, p_provider text,
                                                   p_request_key text, p_result text,
                                                   p_lists_version jsonb, p_match_ref text)
  RETURNS TABLE (outcome text, status text, missing text[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  h        record;
  v_scr    uuid;
  v_status text;
  v_ver    integer;
  v_k      text;
  v_v      jsonb;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::text[];
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org) THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::text, NULL::text[];
    RETURN;
  END IF;
  IF p_provider IS NULL OR p_provider !~ '^[A-Z][A-Z0-9_]{1,31}$'
     OR p_result IS NULL OR p_result NOT IN ('CLEAR', 'POTENTIAL_MATCH', 'CONFIRMED_MATCH')
     OR p_lists_version IS NULL OR pg_catalog.jsonb_typeof(p_lists_version) <> 'object'
     OR (p_match_ref IS NOT NULL AND p_match_ref !~ '^[A-Za-z0-9_.:-]{1,128}$')
     OR (p_result = 'CLEAR' AND p_match_ref IS NOT NULL) THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::text[];
    RETURN;
  END IF;
  -- versions des listes : 1 à 16 codes et versions courts, jamais une entrée de liste
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_lists_version)) NOT BETWEEN 1 AND 16 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::text[];
    RETURN;
  END IF;
  FOR v_k, v_v IN SELECT e.key, e.value FROM pg_catalog.jsonb_each(p_lists_version) AS e LOOP
    IF v_k !~ '^[A-Z][A-Z0-9_]{1,31}$' OR pg_catalog.jsonb_typeof(v_v) <> 'string'
       OR (v_v #>> '{}') !~ '^[A-Za-z0-9_.:-]{1,64}$' THEN
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::text[];
      RETURN;
    END IF;
  END LOOP;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.host:' || p_org::text, 0));
  SELECT d.id, d.status, d.sanctions_screening_id, d.country_code INTO h
    FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  IF h.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text[];
    RETURN;
  END IF;
  IF p_request_key IS DISTINCT FROM pg_catalog.format('screening:%s:a1', h.id) THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::text[];
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.kyc_sanctions_screening AS s
              WHERE s.provider = p_provider AND s.request_key = p_request_key) THEN
    SELECT d.status, d.missing INTO h FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
    RETURN QUERY SELECT 'DUPLICATE'::text, h.status, h.missing;
    RETURN;
  END IF;
  IF h.sanctions_screening_id IS NOT NULL OR h.status NOT IN ('OPEN', 'DOCS_PENDING', 'IN_REVIEW') THEN
    RETURN QUERY SELECT 'ALREADY_SCREENED'::text, h.status, NULL::text[];
    RETURN;
  END IF;
  INSERT INTO core.kyc_sanctions_screening (subject_id, host_verification_id, provider, request_key,
                                            lists_version, result, match_ref, screened_at)
  VALUES (v_user, h.id, p_provider, p_request_key, p_lists_version, p_result, p_match_ref,
          platform.now())
  RETURNING id INTO v_scr;
  IF p_result = 'CLEAR' THEN
    UPDATE core.kyc_host_verification AS d
       SET sanctions_screening_id = v_scr, row_version = d.row_version + 1, updated_at = platform.now()
     WHERE d.id = h.id;
    v_status := core.kyc_host_refresh(h.id);
  ELSE
    UPDATE core.kyc_host_verification AS d
       SET sanctions_screening_id = v_scr, status = 'BLOCKED', reason_code = 'HOST_SANCTIONS_HIT',
           row_version = d.row_version + 1, updated_at = platform.now()
     WHERE d.id = h.id
    RETURNING d.row_version INTO v_ver;
    v_status := 'BLOCKED';
    -- escalade (VER-028) : file de revue de l'ops et événement interne pour l'ADMIN ; codes et
    -- identifiants seulement, aucune donnée de la liste
    PERFORM 1 FROM core.support_enqueue_review('HOST_VERIFICATION', 'ORGANIZATION', p_org,
                                                h.country_code, v_user);
    INSERT INTO core.outbox_outbox_event
           (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_user_id, actor_role, correlation_id, payload, partition_key)
    VALUES (platform.uuid_v7(), 'kyc.host_screening.flagged', 1, 'host_verification', h.id, v_ver,
            h.country_code, NULL, 'SYSTEM', pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('org_id', p_org, 'verification_id', h.id,
                                          'reason_code', 'HOST_SANCTIONS_HIT'),
            p_org::text);
  END IF;
  -- motif journalisé : résultat et code seulement ; ni versions des listes ni référence
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (v_user, 'GUEST', 'HOST_SANCTIONS_SCREENED', 'ORGANIZATION', p_org, NULL,
          pg_catalog.jsonb_build_object('country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code),
                                        'verificationId', h.id, 'result', p_result,
                                        'reasonCode', CASE WHEN p_result <> 'CLEAR'
                                                           THEN 'HOST_SANCTIONS_HIT' END));
  SELECT d.status, d.missing INTO h FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  RETURN QUERY SELECT 'RECORDED'::text, h.status, h.missing;
END
$fn$;

COMMENT ON FUNCTION core.kyc_cmd_decide_with_facts(text, text, text, text, text, numeric, numeric, jsonb, jsonb) IS
  'Décision du fournisseur d''identité (0072, inchangée) et faits vérifiés (date de naissance, '
  'résidence) de la tentative décidée. SECURITY DEFINER, EXECUTE app_api. US-123 (ADR-105).';
COMMENT ON FUNCTION core.kyc_host_state(bytea, uuid) IS
  'État de la vérification de l''hôte de la session pour son compte d''hôte (dossier, pièces '
  'manquantes, blocages de l''activation). SECURITY DEFINER, EXECUTE app_api. US-123 (ADR-105).';
COMMENT ON FUNCTION core.kyc_cmd_host_save_tax_profile(bytea, uuid, text, bytea, text, text) IS
  'Profil fiscal de l''hôte : type admis dans le pays, numéro chiffré par la clé du compte '
  'd''hôte, personne physique seulement. SECURITY DEFINER, EXECUTE app_api. US-123 (ADR-105).';
COMMENT ON FUNCTION core.kyc_cmd_host_submit(bytea, uuid) IS
  'Soumission du dossier de l''hôte : KYC approuvé, âge, résidence ; pièces manquantes ; '
  'demande de filtrage. SECURITY DEFINER, EXECUTE app_api. US-123 (ADR-105).';
COMMENT ON FUNCTION core.kyc_cmd_host_record_screening(bytea, uuid, text, text, text, jsonb, text) IS
  'Résultat du filtrage des sanctions de l''hôte (version des listes, résultat, référence '
  'opaque) ; correspondance ⇒ BLOCKED. SECURITY DEFINER, EXECUTE app_api. US-123 (ADR-105).';

REVOKE ALL ON FUNCTION
  core.kyc_cmd_decide_with_facts(text, text, text, text, text, numeric, numeric, jsonb, jsonb),
  core.kyc_host_state(bytea, uuid),
  core.kyc_cmd_host_save_tax_profile(bytea, uuid, text, bytea, text, text),
  core.kyc_cmd_host_submit(bytea, uuid),
  core.kyc_cmd_host_record_screening(bytea, uuid, text, text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.kyc_cmd_decide_with_facts(text, text, text, text, text, numeric, numeric, jsonb, jsonb),
  core.kyc_host_state(bytea, uuid),
  core.kyc_cmd_host_save_tax_profile(bytea, uuid, text, bytea, text, text),
  core.kyc_cmd_host_submit(bytea, uuid),
  core.kyc_cmd_host_record_screening(bytea, uuid, text, text, text, jsonb, text) TO app_api;

-- 10. Action de console HOST_VERIFICATION_DECISION (cadre d'US-101, ADR-092) ---------------------
-- Gestionnaire lié (signature imposée) : sujet = compte d'hôte ; `decision` ∈ {APPROVED, REJECTED}
-- (catalogue de 0060). APPROVED : revérifie tout puis approuve le dossier (IN_REVIEW) et tente
-- l'activation ; dossier déjà approuvé : nouvelle tentative d'activation, refusée tant qu'un
-- blocage demeure (code de 16 A.8). REJECTED : dossier non décidé refusé. Issue DONE (ref_id =
-- dossier) ou le code du refus métier (la console rend REFUSED ; rien n'est écrit).
CREATE FUNCTION core.kyc_manual_action_host_verification_decision(p_token_hash bytea,
                                                                  p_action_id uuid,
                                                                  p_action_code text,
                                                                  p_subject_id uuid,
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
  v_decision text := p_input ->> 'decision';
  h          record;
  g          record;
  v_refusal  text;
  v_events   uuid[] := '{}';
  v_ev       uuid;
  v_act      record;
  v_q        record;
  v_ver      integer;
BEGIN
  IF p_action_code IS DISTINCT FROM 'HOST_VERIFICATION_DECISION' OR p_subject_id IS NULL
     OR p_actor IS NULL OR p_actor_role IS NULL
     OR v_decision IS NULL OR v_decision NOT IN ('APPROVED', 'REJECTED') THEN
    RAISE EXCEPTION 'vérification d''hôte : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.host:' || p_subject_id::text, 0));
  SELECT d.* INTO h FROM core.kyc_host_verification AS d WHERE d.org_id = p_subject_id;
  IF h.id IS NULL THEN
    RETURN QUERY SELECT 'HOST_VERIFICATION_NOT_READY'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  IF v_decision = 'REJECTED' THEN
    IF h.status NOT IN ('OPEN', 'DOCS_PENDING', 'IN_REVIEW', 'BLOCKED') THEN
      RETURN QUERY SELECT 'HOST_VERIFICATION_DECIDED'::text, h.id, '{}'::uuid[];
      RETURN;
    END IF;
    UPDATE core.kyc_host_verification AS d
       SET status = 'REJECTED', decided_by = p_actor, decided_at = platform.now(),
           reason_code = COALESCE(d.reason_code, 'OPS_REJECTED'),
           row_version = d.row_version + 1, updated_at = platform.now()
     WHERE d.id = h.id
    RETURNING d.row_version INTO v_ver;
  ELSE
    -- APPROVED : dossier prêt, puis tous les contrôles revérifiés à l'horloge de la base
    IF h.status = 'BLOCKED' THEN
      RETURN QUERY SELECT 'HOST_SANCTIONS_HIT'::text, h.id, '{}'::uuid[];
      RETURN;
    ELSIF h.status IN ('REJECTED', 'REVOKED') THEN
      RETURN QUERY SELECT 'HOST_VERIFICATION_DECIDED'::text, h.id, '{}'::uuid[];
      RETURN;
    END IF;
    SELECT * INTO g FROM core.kyc_host_gates(p_subject_id);
    v_refusal := CASE
      WHEN g.kyc_id IS NULL THEN 'HOST_KYC_REQUIRED'
      WHEN g.age = 'UNDER_AGE' THEN 'HOST_UNDER_AGE'
      WHEN g.age = 'UNVERIFIED' THEN 'HOST_AGE_UNVERIFIED'
      WHEN g.age <> 'OK' THEN 'PARAM_MISSING'
      WHEN g.residence = 'MISMATCH' THEN 'HOST_RESIDENCE_MISMATCH'
      WHEN g.screening_id IS NULL THEN 'HOST_SCREENING_MISSING'
      WHEN g.screening_result <> 'CLEAR' THEN 'HOST_SANCTIONS_HIT'
      WHEN g.tax <> 'OK' THEN 'HOST_TAX_ID_REQUIRED'
      WHEN NOT g.terms_ok THEN 'TERMS_REACCEPT_REQUIRED'
      WHEN h.status NOT IN ('IN_REVIEW', 'APPROVED') THEN 'HOST_VERIFICATION_NOT_READY'
      END;
    IF v_refusal IS NOT NULL THEN
      RETURN QUERY SELECT v_refusal, h.id, '{}'::uuid[];
      RETURN;
    END IF;
    IF h.status = 'APPROVED' THEN
      -- nouvelle tentative d'activation : un blocage restant est un refus motivé (16 A.8)
      SELECT * INTO v_act FROM core.kyc_host_try_activate(p_subject_id, p_actor, p_actor_role);
      IF v_act.outcome = 'ACTIVATED' THEN
        RETURN QUERY SELECT 'DONE'::text, h.id, v_act.event_ids;
        RETURN;
      ELSIF v_act.outcome = 'ALREADY_ACTIVE' THEN
        RETURN QUERY SELECT 'HOST_ALREADY_ACTIVE'::text, h.id, '{}'::uuid[];
        RETURN;
      END IF;
      RETURN QUERY SELECT CASE
          WHEN 'SUBMERCHANT_NOT_ACTIVE' = ANY (v_act.blockers) THEN 'HOST_PAYOUT_RAIL_UNAVAILABLE'
          WHEN 'PSP_CAPABILITY_MISSING' = ANY (v_act.blockers) THEN 'HOST_PAYOUT_RAIL_UNAVAILABLE'
          WHEN 'P2P_HOSTS_DISABLED' = ANY (v_act.blockers) THEN 'HOST_PAYOUT_RAIL_UNAVAILABLE'
          WHEN 'INSURER_CONTRACT_INACTIVE' = ANY (v_act.blockers) THEN 'INSURER_CONTRACT_INACTIVE'
          ELSE COALESCE(v_act.blockers[1], 'HOST_NOT_ACTIVATED') END::text,
        h.id, v_act.event_ids;
      RETURN;
    END IF;
    UPDATE core.kyc_host_verification AS d
       SET status = 'APPROVED', decided_by = p_actor, decided_at = platform.now(),
           identity_verification_id = g.kyc_id, age_ok = true,
           residence_verified = (g.residence = 'VERIFIED'), missing = '{}',
           row_version = d.row_version + 1, updated_at = platform.now()
     WHERE d.id = h.id
    RETURNING d.row_version INTO v_ver;
  END IF;

  v_ev := platform.uuid_v7();
  INSERT INTO core.outbox_outbox_event
         (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  VALUES (v_ev, 'kyc.host_verification.decided', 1, 'host_verification', h.id, v_ver,
          h.country_code, p_actor, p_actor_role, pg_catalog.gen_random_uuid(), p_action_id,
          pg_catalog.jsonb_build_object('org_id', p_subject_id, 'verification_id', h.id,
                                        'decision', v_decision),
          p_subject_id::text);
  v_events := v_events || v_ev;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after, reason, request_id)
  VALUES (p_actor, p_actor_role, 'HOST_VERIFICATION_DECIDED', 'ORGANIZATION', p_subject_id,
          pg_catalog.jsonb_build_object('status', h.status),
          pg_catalog.jsonb_build_object('country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code),
                                        'verificationId', h.id, 'decision', v_decision),
          NULLIF(pg_catalog.left(pg_catalog.btrim(p_reason), 1000), ''), p_action_id);
  -- élément vivant de la file de revue clôturé par la décision
  SELECT q.outcome, q.item_id INTO v_q
    FROM core.support_enqueue_review('HOST_VERIFICATION', 'ORGANIZATION', p_subject_id,
                                     h.country_code, p_actor) AS q;
  IF v_q.outcome IN ('CREATED', 'EXISTS') THEN
    PERFORM 1 FROM core.support_close_review_item(v_q.item_id, 'DONE', v_decision, p_actor);
  END IF;
  IF v_decision = 'APPROVED' THEN
    -- activation tentée aussitôt : sinon le compte reste PENDING_ACTIVATION (fail-closed)
    SELECT * INTO v_act FROM core.kyc_host_try_activate(p_subject_id, p_actor, p_actor_role);
    v_events := v_events || COALESCE(v_act.event_ids, '{}'::uuid[]);
  END IF;
  RETURN QUERY SELECT 'DONE'::text, h.id, v_events;
END
$fn$;
COMMENT ON FUNCTION core.kyc_manual_action_host_verification_decision(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à HOST_VERIFICATION_DECISION (cadre d''US-101) : décision de l''ops sur le '
  'dossier de l''hôte, contrôles revérifiés, activation tentée (17 §2.4). EXECUTE '
  'iam_staff_owner. US-123 (ADR-105).';
REVOKE ALL ON FUNCTION core.kyc_manual_action_host_verification_decision(bytea, uuid, text, uuid,
                                                                         jsonb, text, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_manual_action_host_verification_decision(bytea, uuid, text, uuid,
                                                                            jsonb, text, uuid, text)
  TO iam_staff_owner;


-- 10 bis. Action de console HOST_SCREENING_REVIEW (PROPOSÉE, ADR-105 ; VER-028 parcours
-- alternatif) : revue humaine d'une correspondance de sanctions escaladée. Sujet = compte d'hôte ;
-- `decision` ∈ {CLEARED, CONFIRMED} ; motif obligatoire (cadre d'US-101) ; permission `kyc.decide`
-- (OPS_AGENT, ADMIN : VER-028 « Permissions »). CLEARED (faux positif) : nouveau filtrage CLEAR
-- signé du relecteur, dossier recalculé (pièces manquantes ou revue) ; CONFIRMED : filtrage
-- CONFIRMED_MATCH, dossier REJECTED (motif HOST_SANCTIONS_HIT), événement de décision. Élément de
-- la file clôturé ; audit `HOST_SCREENING_REVIEWED` (codes seulement). Issue DONE ou
-- HOST_SCREENING_NOT_BLOCKED (dossier absent ou non bloqué : rien n'est écrit).
CREATE FUNCTION core.kyc_manual_action_host_screening_review(p_token_hash bytea, p_action_id uuid,
                                                             p_action_code text,
                                                             p_subject_id uuid, p_input jsonb,
                                                             p_reason text, p_actor uuid,
                                                             p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_decision text := p_input ->> 'decision';
  h          record;
  v_scr      uuid := platform.uuid_v7();
  v_ver      integer;
  v_ev       uuid;
  v_events   uuid[] := '{}';
  v_q        record;
BEGIN
  IF p_action_code IS DISTINCT FROM 'HOST_SCREENING_REVIEW' OR p_subject_id IS NULL
     OR p_actor IS NULL OR p_actor_role IS NULL
     OR v_decision IS NULL OR v_decision NOT IN ('CLEARED', 'CONFIRMED') THEN
    RAISE EXCEPTION 'revue de filtrage : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.host:' || p_subject_id::text, 0));
  SELECT d.* INTO h FROM core.kyc_host_verification AS d WHERE d.org_id = p_subject_id;
  IF h.id IS NULL OR h.status <> 'BLOCKED' THEN
    RETURN QUERY SELECT 'HOST_SCREENING_NOT_BLOCKED'::text, h.id, '{}'::uuid[];
    RETURN;
  END IF;
  INSERT INTO core.kyc_sanctions_screening (id, subject_id, host_verification_id, provider,
                                            request_key, lists_version, result, match_ref,
                                            screened_at, reviewer)
  VALUES (v_scr, h.user_id, h.id, 'MANUAL', pg_catalog.format('screening:%s:a2', h.id), '{}'::jsonb,
          CASE v_decision WHEN 'CLEARED' THEN 'CLEAR' ELSE 'CONFIRMED_MATCH' END, NULL,
          platform.now(), p_actor);
  -- élément vivant de la file de revue clôturé par la revue
  SELECT q.outcome, q.item_id INTO v_q
    FROM core.support_enqueue_review('HOST_VERIFICATION', 'ORGANIZATION', p_subject_id,
                                     h.country_code, p_actor) AS q;
  IF v_q.outcome IN ('CREATED', 'EXISTS') THEN
    PERFORM 1 FROM core.support_close_review_item(v_q.item_id, 'DONE', v_decision, p_actor);
  END IF;
  IF v_decision = 'CLEARED' THEN
    UPDATE core.kyc_host_verification AS d
       SET sanctions_screening_id = v_scr, status = 'DOCS_PENDING', reason_code = NULL,
           row_version = d.row_version + 1, updated_at = platform.now()
     WHERE d.id = h.id;
    PERFORM core.kyc_host_refresh(h.id);
  ELSE
    UPDATE core.kyc_host_verification AS d
       SET sanctions_screening_id = v_scr, status = 'REJECTED', decided_by = p_actor,
           decided_at = platform.now(), row_version = d.row_version + 1, updated_at = platform.now()
     WHERE d.id = h.id
    RETURNING d.row_version INTO v_ver;
    v_ev := platform.uuid_v7();
    INSERT INTO core.outbox_outbox_event
           (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
    VALUES (v_ev, 'kyc.host_verification.decided', 1, 'host_verification', h.id, v_ver,
            h.country_code, p_actor, p_actor_role, pg_catalog.gen_random_uuid(), p_action_id,
            pg_catalog.jsonb_build_object('org_id', p_subject_id, 'verification_id', h.id,
                                          'decision', 'REJECTED'),
            p_subject_id::text);
    v_events := v_events || v_ev;
  END IF;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after, reason, request_id)
  VALUES (p_actor, p_actor_role, 'HOST_SCREENING_REVIEWED', 'ORGANIZATION', p_subject_id,
          pg_catalog.jsonb_build_object('status', 'BLOCKED'),
          pg_catalog.jsonb_build_object('country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code),
                                        'verificationId', h.id, 'decision', v_decision),
          NULLIF(pg_catalog.left(pg_catalog.btrim(p_reason), 1000), ''), p_action_id);
  RETURN QUERY SELECT 'DONE'::text, h.id, v_events;
END
$fn$;
COMMENT ON FUNCTION core.kyc_manual_action_host_screening_review(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à HOST_SCREENING_REVIEW (cadre d''US-101) : revue humaine d''une correspondance de '
  'sanctions (faux positif levé ou correspondance confirmée). EXECUTE iam_staff_owner. US-123.';
REVOKE ALL ON FUNCTION core.kyc_manual_action_host_screening_review(bytea, uuid, text, uuid, jsonb,
                                                                    text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_manual_action_host_screening_review(bytea, uuid, text, uuid, jsonb,
                                                                       text, uuid, text)
  TO iam_staff_owner;

INSERT INTO core.support_manual_action_catalog
       (action_code, permission_code, mode, subject_type, available, input_keys, input_values,
        requires_approval)
VALUES ('HOST_SCREENING_REVIEW', 'kyc.decide', 'DOMAIN_COMMAND', 'ORGANIZATION', false,
        '{decision}', '{"decision": ["CLEARED", "CONFIRMED"]}', false);

-- 11. Propriétaire NOLOGIN (mécanique de 0059 / 0072 : CREATE le temps du transfert seulement) ---
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_param(text, text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_gates(uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_blockers(uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_activation_allowed(uuid, text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_emit_org(uuid, text, integer, text, text, uuid, text, text)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_refresh(uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_try_activate(uuid, uuid, text) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_decide_with_facts(text, text, text, text, text, numeric, numeric, jsonb, jsonb)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_state(bytea, uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_host_save_tax_profile(bytea, uuid, text, bytea, text, text)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_host_submit(bytea, uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_cmd_host_record_screening(bytea, uuid, text, text, text, jsonb, text)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_manual_action_host_verification_decision(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_manual_action_host_screening_review(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO kyc_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 12. Liaison (garde d'ADR-092 au moment de l'INSERT : signature, SECURITY DEFINER, propriétaire
-- NOLOGIN autre qu'iam_staff_owner, EXECUTE à iam_staff_owner et à aucun rôle applicatif)
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('HOST_VERIFICATION_DECISION',
        'core.kyc_manual_action_host_verification_decision(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-123');
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('HOST_SCREENING_REVIEW',
        'core.kyc_manual_action_host_screening_review(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-123');
