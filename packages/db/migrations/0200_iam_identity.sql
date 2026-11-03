-- 0200 — IAM : comptes, vérification d'email, facteurs, sessions, OTP, comptes d'hôte, appartenances,
-- rôles internes, permissions, restrictions. US-010 ; 17 §2.3, §3.1.2, §3.1.4, §3.2.1 ; 16 ACC-001 ;
-- 08 BR-ACC-01 ; ADR-052. Appliquée sous `migrator`.
--
-- Entités de 17 §3.2.1 (noms d'entités et de colonnes de 17, schéma Bêta `core`, préfixe `iam_`).
-- `org_guest_block` (BR-BOOK-11) n'est pas créée ici : elle n'est pas dans les notes de US-010.
--
-- Écarts PROPOSÉS avec 17 (ADR-052, à reporter dans 17 §3.2.1) :
--   - `email` : `text` en minuscules (CHECK) au lieu de `citext` : aucune extension de plus à
--     installer par l'amorçage ; la normalisation (trim, minuscules) est faite par l'API ;
--   - `user_account.status` : ajout de `PENDING_EMAIL` (16 ACC-001, état initial PROPOSÉ) ;
--   - `session.token_hash` (SHA-256 du jeton, 32 octets) et `session.revoked_reason` : 17 ne dit
--     pas comment la session est retrouvée ; le jeton en clair n'est jamais stocké (C4) ;
--   - `staff_role_assignment.country_scope text[] NN` (17 §2.3 « Portée par pays ») ;
--   - `role_permission` porte les colonnes de configuration versionnée (17 §3.1.2, classe C).
--
-- Droits : AUCUN droit de table pour app_api, app_worker, app_anon ni PUBLIC. Les écritures et
-- lectures de l'authentification passent par les commandes de 0201 ; les lectures filtrées par
-- acteur et par pays (politiques RLS) arrivent avec US-011. RLS ENABLE + FORCE partout.
--
-- Clés étrangères en attente : `organization.legal_entity_id` (config, US-008) ; les colonnes
-- `guest_user_id` / `org_id` des tables AVL (0004) ne reçoivent pas encore de FK vers ces tables :
-- les fixtures L0 de US-006 posent des identifiants libres (voir la passation US-010).
--
-- Aucune constante propre à un pays : codes pays par leur format seulement (liste dans config).
--
-- Retour arrière (tables vides) :
--   DROP TABLE core.iam_restriction, core.iam_role_permission, core.iam_staff_role_assignment,
--     core.iam_membership, core.iam_organization, core.iam_otp_challenge, core.iam_session,
--     core.iam_auth_factor, core.iam_email_verification, core.iam_user_account;
--   DROP FUNCTION core.iam_session_guard();

-- 1. Compte (17 §3.2.1 user_account ; classe B/E) ---------------------------------------------
CREATE TABLE core.iam_user_account (
  id                uuid        PRIMARY KEY,                       -- UUID v7, généré par l'API
  email             text        NOT NULL,                          -- [C2]
  email_verified_at timestamptz,
  phone_e164        text,                                          -- [C2]
  phone_verified_at timestamptz,
  phone_line_type   text,                                          -- VER-013 (VoIP refusé)
  password_hash     text,                                          -- [C4] argon2id ; NULL = SSO
  legal_first_name  text        NOT NULL,                          -- [C2] tel que sur le permis
  legal_last_name   text        NOT NULL,                          -- [C2]
  display_name      text,                                          -- [C2]
  date_of_birth     date,                                          -- [C2]
  preferred_locale  text        NOT NULL,
  residence_country text,
  status            text        NOT NULL DEFAULT 'PENDING_EMAIL',
  pseudonymized_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT platform.now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT platform.now(),
  updated_by        uuid,
  row_version       integer     NOT NULL DEFAULT 0,
  CONSTRAINT user_account_email_unique UNIQUE (email),
  -- normalisée par l'API (trim + minuscules) ; format minimal, longueur RFC 5321
  CONSTRAINT user_account_email_normalized CHECK (
        email = pg_catalog.lower(email) AND email = pg_catalog.btrim(email)
    AND pg_catalog.length(email) BETWEEN 3 AND 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  -- critère US-010 : seul un hachage robuste est stocké (argon2id au format PHC, 17 §3.1.4 C4)
  CONSTRAINT user_account_password_hash_argon2id CHECK (
    password_hash IS NULL OR password_hash ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'),
  CONSTRAINT user_account_legal_names_present CHECK (
        pg_catalog.length(pg_catalog.btrim(legal_first_name)) BETWEEN 1 AND 100
    AND pg_catalog.length(pg_catalog.btrim(legal_last_name)) BETWEEN 1 AND 100),
  CONSTRAINT user_account_phone_e164 CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT user_account_locale_format CHECK (preferred_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT user_account_residence_format CHECK (residence_country IS NULL OR residence_country ~ '^[A-Z]{2}$'),
  CONSTRAINT user_account_status_valid CHECK (
    status IN ('PENDING_EMAIL', 'ACTIVE', 'RESTRICTED', 'CLOSED', 'BANNED'))
);
-- ACC-014 : un numéro vérifié n'appartient qu'à un compte
CREATE UNIQUE INDEX user_account_phone_verified_unique
  ON core.iam_user_account (phone_e164) WHERE (phone_verified_at IS NOT NULL);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_user_account
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
COMMENT ON TABLE core.iam_user_account IS
  'IAM user_account (17 §3.2.1). Un compte sert à voyager et à être hôte (ACC-001). Classe B/E. US-010.';

-- 2. Vérification d'email (17 §3.2.1, VERIF_14-F29 ; purge 30 j après consommation) ------------
CREATE TABLE core.iam_email_verification (
  id          uuid        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES core.iam_user_account (id),
  email       text        NOT NULL,                                -- [C2] adresse prouvée
  token_hash  bytea       NOT NULL,                                -- [C4] SHA-256 du jeton
  sent_at     timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  ip          inet,                                                -- [C2]
  created_at  timestamptz NOT NULL DEFAULT platform.now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT platform.now(),
  updated_by  uuid,
  row_version integer     NOT NULL DEFAULT 0,
  CONSTRAINT email_verification_token_unique UNIQUE (token_hash),
  CONSTRAINT email_verification_token_sha256 CHECK (pg_catalog.octet_length(token_hash) = 32),
  CONSTRAINT email_verification_window CHECK (expires_at > sent_at)
);
CREATE INDEX email_verification_user_idx ON core.iam_email_verification (user_id);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_email_verification
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- 3. Facteur d'authentification (17 §3.2.1 ; TOTP obligatoire pour le staff : US-012) ----------
CREATE TABLE core.iam_auth_factor (
  id          uuid        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES core.iam_user_account (id),
  kind        text        NOT NULL
    CONSTRAINT auth_factor_kind_valid CHECK (kind IN ('TOTP', 'PHONE_OTP')),
  secret_ref  text        NOT NULL,     -- [C4] RÉFÉRENCE au coffre / KMS, jamais le secret
  enabled_at  timestamptz,
  disabled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT platform.now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT platform.now(),
  updated_by  uuid,
  row_version integer     NOT NULL DEFAULT 0,
  CONSTRAINT auth_factor_secret_ref_format CHECK (secret_ref ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]{1,500}$')
);
CREATE INDEX auth_factor_user_idx ON core.iam_auth_factor (user_id);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_auth_factor
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- 4. Session (17 §3.2.1 ; purge 90 j) -----------------------------------------------------------
CREATE TABLE core.iam_session (
  id             uuid        PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES core.iam_user_account (id),
  token_hash     bytea       NOT NULL,                             -- [C4] SHA-256 du jeton
  expires_at     timestamptz NOT NULL,
  ip             inet,                                             -- [C2]
  user_agent     text,                                             -- [C2]
  revoked_at     timestamptz,
  revoked_reason text,
  mfa_level      text        NOT NULL DEFAULT 'NONE',
  created_at     timestamptz NOT NULL DEFAULT platform.now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT platform.now(),
  updated_by     uuid,
  row_version    integer     NOT NULL DEFAULT 0,
  CONSTRAINT session_token_unique UNIQUE (token_hash),
  CONSTRAINT session_token_sha256 CHECK (pg_catalog.octet_length(token_hash) = 32),
  CONSTRAINT session_window CHECK (expires_at > created_at),
  CONSTRAINT session_user_agent_length CHECK (user_agent IS NULL OR pg_catalog.length(user_agent) <= 512),
  CONSTRAINT session_mfa_level_valid CHECK (mfa_level IN ('NONE', 'OTP', 'TOTP')),
  CONSTRAINT session_revoked_reason_valid CHECK (revoked_reason IN
    ('LOGOUT', 'LOGOUT_ALL', 'ROTATED', 'ADMIN', 'PASSWORD_CHANGED', 'ACCOUNT_CLOSED')),
  CONSTRAINT session_revocation_complete CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX session_user_live_idx ON core.iam_session (user_id) WHERE (revoked_at IS NULL);

-- Défense en profondeur (17 §2.3, comme hold_guarded_columns) : quel que soit l'écrivain, une
-- session ne change ni de titulaire ni de jeton, n'est jamais prolongée et une révocation est
-- définitive. Fonction de trigger ordinaire (ne lit que OLD / NEW) : ni SECURITY DEFINER ni EXECUTE.
CREATE FUNCTION core.iam_session_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.token_hash <> OLD.token_hash
     OR NEW.created_at <> OLD.created_at OR NEW.expires_at > OLD.expires_at
     OR (OLD.revoked_at IS NOT NULL AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
                                         OR NEW.revoked_reason IS DISTINCT FROM OLD.revoked_reason)) THEN
    RAISE EXCEPTION 'session : colonne gardée'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'session_guarded_columns';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.iam_session_guard() FROM PUBLIC;
CREATE TRIGGER session_guarded_columns BEFORE UPDATE ON core.iam_session
  FOR EACH ROW EXECUTE FUNCTION core.iam_session_guard();
CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_session
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
COMMENT ON TABLE core.iam_session IS
  'IAM session (17 §3.2.1). Jeton opaque côté client ; seul son SHA-256 est stocké. Écrite par les '
  'commandes core.iam_cmd_* (0201) seulement. Révocation définitive (session_guarded_columns). US-010.';

-- 5. Défi OTP (17 §3.2.1, VER-013 : 10 min, 5 essais, blocage 1 h ; purge 30 j) ----------------
CREATE TABLE core.iam_otp_challenge (
  id           uuid        PRIMARY KEY,
  user_id      uuid        REFERENCES core.iam_user_account (id),
  phone_e164   text,                                               -- [C2]
  channel      text        NOT NULL
    CONSTRAINT otp_challenge_channel_valid CHECK (channel IN ('WHATSAPP', 'SMS', 'EMAIL')),
  code_hash    bytea       NOT NULL,                               -- [C4]
  expires_at   timestamptz NOT NULL,
  attempts     integer     NOT NULL DEFAULT 0,
  locked_until timestamptz,
  purpose      text        NOT NULL
    CONSTRAINT otp_challenge_purpose_valid CHECK (purpose IN ('PHONE_VERIFY', 'SIGNATURE', 'LOGIN')),
  consumed_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT platform.now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT platform.now(),
  updated_by   uuid,
  row_version  integer     NOT NULL DEFAULT 0,
  -- la borne de 5 essais est un paramètre (otp_max_attempts, 17 §7.2) : seule la positivité est ici
  CONSTRAINT otp_challenge_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT otp_challenge_phone_e164 CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT otp_challenge_target CHECK (user_id IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_otp_challenge
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- 6. Compte d'hôte (17 §2.3 « Compte d'hôte », §3.2.1 organization ; classe B) ------------------
-- Une personne physique titulaire, mono-pays : porte la portée RLS org_id (US-011).
CREATE TABLE core.iam_organization (
  id              uuid        PRIMARY KEY,
  kind            text        NOT NULL DEFAULT 'P2P_HOST_INDIVIDUAL'
    CONSTRAINT organization_kind_valid CHECK (kind = 'P2P_HOST_INDIVIDUAL'),
  holder_user_id  uuid        NOT NULL REFERENCES core.iam_user_account (id),
  country_code    text        NOT NULL
    CONSTRAINT organization_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  display_name    text,                                             -- [C2]
  tax_id          text,                                             -- [C2]
  status          text        NOT NULL DEFAULT 'ONBOARDING'
    CONSTRAINT organization_status_valid CHECK (status IN
      ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'OFFBOARDED')),
  plan_code       text,                                             -- défaut = host_default_plan (config)
  legal_entity_id uuid,                                             -- FK config (US-008)
  created_at      timestamptz NOT NULL DEFAULT platform.now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT platform.now(),
  updated_by      uuid,
  row_version     integer     NOT NULL DEFAULT 0,
  CONSTRAINT organization_country_holder_unique UNIQUE (country_code, holder_user_id),
  -- cible de la clé étrangère « titulaire » de membership
  CONSTRAINT organization_id_holder_unique UNIQUE (id, holder_user_id)
);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_organization
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- 7. Appartenance (17 §3.2.1 membership ; classe B) ---------------------------------------------
CREATE TABLE core.iam_membership (
  id                   uuid        PRIMARY KEY,
  user_id              uuid        NOT NULL REFERENCES core.iam_user_account (id),
  org_id               uuid        NOT NULL REFERENCES core.iam_organization (id),
  role                 text        NOT NULL
    CONSTRAINT membership_role_valid CHECK (role IN ('P2P_HOST', 'CO_HOST')),
  vehicle_scope        uuid[]      NOT NULL DEFAULT '{}',          -- co-hôte ; vide = aucun véhicule
  permission_overrides text[]      NOT NULL DEFAULT '{}',
  status               text        NOT NULL DEFAULT 'INVITED'
    CONSTRAINT membership_status_valid CHECK (status IN ('INVITED', 'ACTIVE', 'REMOVED')),
  invite_expires_at    timestamptz,
  -- = user_id pour le titulaire, NULL sinon : la FK ci-dessous ne s'applique qu'au titulaire
  holder_ref           uuid GENERATED ALWAYS AS (CASE WHEN role = 'P2P_HOST' THEN user_id END) STORED,
  created_at           timestamptz NOT NULL DEFAULT platform.now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT platform.now(),
  updated_by           uuid,
  row_version          integer     NOT NULL DEFAULT 0,
  CONSTRAINT membership_user_org_role_unique UNIQUE (user_id, org_id, role),
  -- 17 §3.2.1 : le P2P_HOST d'un compte d'hôte est organization.holder_user_id
  CONSTRAINT membership_holder_matches_org FOREIGN KEY (org_id, holder_ref)
    REFERENCES core.iam_organization (id, holder_user_id),
  CONSTRAINT membership_scope_cohost_only CHECK (role = 'CO_HOST' OR pg_catalog.cardinality(vehicle_scope) = 0),
  CONSTRAINT membership_scope_no_null CHECK (pg_catalog.array_position(vehicle_scope, NULL) IS NULL)
);
-- exactement un P2P_HOST actif par compte d'hôte (borne haute structurelle)
CREATE UNIQUE INDEX membership_one_active_holder
  ON core.iam_membership (org_id) WHERE (role = 'P2P_HOST' AND status = 'ACTIVE');
CREATE INDEX membership_user_idx ON core.iam_membership (user_id) WHERE (status = 'ACTIVE');
CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_membership
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- 8. Rôle interne (17 §2.3, §3.2.1 staff_role_assignment ; classe B) ----------------------------
CREATE TABLE core.iam_staff_role_assignment (
  id            uuid        PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES core.iam_user_account (id),
  role          text        NOT NULL
    CONSTRAINT staff_role_valid CHECK (role IN
      ('SUPPORT_AGENT', 'OPS_AGENT', 'FINANCE', 'ADMIN', 'SUPERADMIN')),
  -- 17 §2.3 « Portée par pays » : {PA}, {PY} ou {PA,PY} ; posée en app.country_scope (US-011)
  country_scope text[]      NOT NULL,
  granted_by    uuid        REFERENCES core.iam_user_account (id),  -- NULL = procédure d'amorçage
  expires_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT platform.now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT platform.now(),
  updated_by    uuid,
  row_version   integer     NOT NULL DEFAULT 0,
  CONSTRAINT staff_country_scope_format CHECK (
        pg_catalog.cardinality(country_scope) >= 1
    AND pg_catalog.array_position(country_scope, NULL) IS NULL
    AND pg_catalog.array_to_string(country_scope, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'),
  -- séparation des tâches : personne ne s'attribue un rôle
  CONSTRAINT staff_no_self_grant CHECK (granted_by IS NULL OR granted_by <> user_id)
);
CREATE INDEX staff_role_user_idx ON core.iam_staff_role_assignment (user_id);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_staff_role_assignment
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- 9. Matrice des permissions (17 §2.3, §3.2.1 role_permission ; classe C, versionnée) -----------
CREATE TABLE core.iam_role_permission (
  role            text        NOT NULL
    CONSTRAINT role_permission_role_valid CHECK (role IN
      ('GUEST', 'P2P_HOST', 'CO_HOST', 'SUPPORT_AGENT', 'OPS_AGENT', 'FINANCE', 'ADMIN', 'SUPERADMIN')),
  permission_code text        NOT NULL
    CONSTRAINT role_permission_code_format CHECK (permission_code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  scope_rule      text        NOT NULL
    CONSTRAINT role_permission_scope_valid CHECK (scope_rule IN ('ORG', 'VEHICLE', 'SELF', 'PLATFORM')),
  valid_from      timestamptz NOT NULL,
  valid_to        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT platform.now(),
  created_by      uuid,
  approved_by     uuid,
  change_reason   text        NOT NULL,
  CONSTRAINT role_permission_pkey PRIMARY KEY (role, permission_code, valid_from),
  CONSTRAINT role_permission_window CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- 10. Restriction de compte (17 §3.2.1 restriction ; lue par BKG-012 ; classe B) ----------------
CREATE TABLE core.iam_restriction (
  id          uuid        PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES core.iam_user_account (id),
  kind        text        NOT NULL
    CONSTRAINT restriction_kind_valid CHECK (kind IN ('UNPAID_BALANCE', 'CHARGEBACK',
      'PAYMENT_PLAN_ACTIVE', 'TS_HOLD', 'KYC_REVOKED', 'POLICY_VIOLATION')),
  active      boolean     NOT NULL DEFAULT true,
  reason      text,                                                -- [C2]
  source_ref  text,
  lifted_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT platform.now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT platform.now(),
  updated_by  uuid,
  row_version integer     NOT NULL DEFAULT 0,
  CONSTRAINT restriction_lifted_consistent CHECK (active = (lifted_at IS NULL))
);
CREATE INDEX restriction_user_active_idx ON core.iam_restriction (user_id) WHERE (active);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.iam_restriction
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- 11. RLS partout (CLAUDE.md point 5 ; 17 §2.3, B9) : ENABLE + FORCE, migrator soumis à FORCE ---
-- Aucune autre politique ici : sans droit de table, app_api / app_worker / app_anon n'atteignent
-- même pas la RLS (42501). Les politiques par type d'acteur et par pays sont l'objet de US-011.
ALTER TABLE core.iam_user_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_user_account FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_user_account TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.iam_email_verification ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_email_verification FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_email_verification TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.iam_auth_factor ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_auth_factor FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_auth_factor TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.iam_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_session FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_session TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.iam_otp_challenge ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_otp_challenge FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_otp_challenge TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.iam_organization ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_organization FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_organization TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.iam_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_membership FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_membership TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.iam_staff_role_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_staff_role_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_staff_role_assignment TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.iam_role_permission ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_role_permission FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_role_permission TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.iam_restriction ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_restriction FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_restriction TO migrator USING (true) WITH CHECK (true);

REVOKE ALL ON core.iam_user_account, core.iam_email_verification, core.iam_auth_factor,
  core.iam_session, core.iam_otp_challenge, core.iam_organization, core.iam_membership,
  core.iam_staff_role_assignment, core.iam_role_permission, core.iam_restriction FROM PUBLIC;
