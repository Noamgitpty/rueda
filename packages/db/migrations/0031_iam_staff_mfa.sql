-- 0031 — IAM : authentification forte du staff (TOTP), sessions de staff liées à la MFA,
-- propriétaire dédié `iam_staff_owner`. US-012 ; 16 ADM-001 (« 2FA TOTP obligatoire pour tout
-- rôle interne », erreurs FORBIDDEN, 2FA_REQUIRED) ; 17 §2.3 (« Limite de la RLS », B8, RLS-18 ;
-- « Fonctions de politique »), §3.2.1 (`auth_factor`, `session`) ; ADR-052, ADR-053, ADR-062.
-- Appliquée sous `migrator`.
--
-- Reports traités (passations US-010 et US-011) :
--   1. `p_mfa_level` libre dans `iam_cmd_open_session` : une session naît TOUJOURS au niveau
--      `NONE` (refus explicite de toute autre valeur, et politique d'insertion qui l'exige) ; le
--      seul chemin vers `TOTP` est `core.iam_staff_cmd_elevate` ci-dessous ;
--   2. RLS-18 RÉDUITE (pas fermée) : le contexte STAFF n'a plus d'effet sans la preuve de
--      possession d'une session de staff VIVANTE et ÉLEVÉE par TOTP. `app.has_staff_role` et
--      `app.staff_case_covers` exigent désormais que `app.session_token_hash` (empreinte SHA-256
--      du jeton, posée par la couche d'accès) désigne une session de l'acteur, non révoquée, non
--      expirée, de niveau `TOTP`. Or `app_api` ne lit pas `iam_session` : connaître l'UUID d'un
--      ADMIN ne suffit plus. Et l'élévation exige une preuve HMAC-SHA-256 calculée par l'API avec
--      une clé (`iam_mfa_proof_key`) qu'aucun rôle applicatif ne lit : du SQL arbitraire sous
--      `app_api` ne peut plus fabriquer une session de staff élevée (« session persistante
--      forgée »). Limite restante (ADR-062) : qui lit la mémoire ou l'environnement du processus
--      API (clé de preuve, jetons en vol) garde tous les pouvoirs ; la clé est un secret géré hors
--      dépôt (aucune valeur ici), installé par l'exploitation (procédure du runbook) ;
--   3. sessions de staff de 8 h : inchangé (0011).
--
-- TOTP (RFC 6238, SHA-1, 6 chiffres, pas de 30 s : PROPOSÉ, ADR-062) : le secret n'est JAMAIS en
-- base ; `auth_factor.secret_ref` référence le coffre (port de l'API ; FAKE en test, jamais en
-- production). L'API vérifie le code, puis présente à la base le pas (`step`) reconnu et la
-- preuve. La base juge seule : pas à ±1 de `platform.now()`, pas strictement croissant (aucun
-- rejeu), facteur non verrouillé, 5 échecs => verrou 15 min (PROPOSÉ, ADR-062).
--
-- Enrôlement : un facteur naît « en attente » (créé par un ADMIN / SUPERADMIN, 0032, ou par la
-- procédure d'amorçage du premier ADMIN), avec l'empreinte d'un code d'enrôlement à usage unique
-- remis hors bande. Sans facteur vivant, le staff ne peut rien faire (critère 2 d'US-012).
--
-- Retour arrière (avant toute donnée de 0032) :
--   restaurer app.has_staff_role, app.staff_case_covers (0024) et core.iam_cmd_open_session
--   (0011) sous leurs propriétaires ; DROP FUNCTION core.iam_staff_cmd_begin(bytea),
--   core.iam_staff_cmd_enroll_reveal(bytea, bytea), core.iam_staff_cmd_elevate(bytea, uuid,
--   bigint, bytea), core.iam_staff_cmd_mfa_failed(bytea), core.iam_staff_session(bytea),
--   core.iam_staff_audit(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid),
--   core.iam_hmac_sha256(bytea, bytea), core.iam_mfa_proof(bytea, bytea, uuid, bigint),
--   core.iam_totp_step_now(), app.session_token_hash(); DROP TABLE core.iam_mfa_proof_key;
--   DROP POLICY iam_staff_* ON <tables> ; REVOKE ALL … FROM iam_staff_owner ;
--   ALTER TABLE core.iam_auth_factor DROP COLUMN last_used_step, failed_attempts, locked_until,
--     enrollment_code_hash, enrollment_expires_at.

-- 1. Facteur TOTP : anti-rejeu, verrou, enrôlement ----------------------------------------------
ALTER TABLE core.iam_auth_factor
  ADD COLUMN last_used_step        bigint,
  ADD COLUMN failed_attempts       integer NOT NULL DEFAULT 0,
  ADD COLUMN locked_until          timestamptz,
  ADD COLUMN enrollment_code_hash  bytea,                       -- [C4] SHA-256 du code remis
  ADD COLUMN enrollment_expires_at timestamptz,
  ADD CONSTRAINT auth_factor_failed_nonneg CHECK (failed_attempts >= 0),
  ADD CONSTRAINT auth_factor_step_nonneg CHECK (last_used_step IS NULL OR last_used_step >= 0),
  ADD CONSTRAINT auth_factor_enrollment_sha256 CHECK (
    enrollment_code_hash IS NULL OR pg_catalog.octet_length(enrollment_code_hash) = 32),
  ADD CONSTRAINT auth_factor_enrollment_complete CHECK (
    (enrollment_code_hash IS NULL) = (enrollment_expires_at IS NULL)),
  -- un TOTP vivant est soit actif (enabled_at), soit en attente avec son code d'enrôlement
  ADD CONSTRAINT auth_factor_totp_state CHECK (
    kind <> 'TOTP' OR disabled_at IS NOT NULL
    OR (enabled_at IS NOT NULL AND enrollment_code_hash IS NULL)
    OR (enabled_at IS NULL AND enrollment_code_hash IS NOT NULL));
-- un seul TOTP vivant (actif ou en attente) par compte
CREATE UNIQUE INDEX auth_factor_one_live_totp
  ON core.iam_auth_factor (user_id) WHERE (kind = 'TOTP' AND disabled_at IS NULL);

-- 2. Clé de preuve de l'élévation (secret géré : AUCUNE valeur dans le dépôt) ------------------
-- Installée par l'exploitation sous `migrator` (runbook, ADR-062), ou par la fixture de test 9600.
-- Absente => aucune élévation possible => aucun pouvoir de staff (fail-closed).
CREATE TABLE core.iam_mfa_proof_key (
  id           smallint    CONSTRAINT mfa_proof_key_pkey PRIMARY KEY
    CONSTRAINT mfa_proof_key_single CHECK (id = 1),
  key          bytea       NOT NULL                                   -- [C4]
    CONSTRAINT mfa_proof_key_length CHECK (pg_catalog.octet_length(key) BETWEEN 32 AND 64),
  installed_at timestamptz NOT NULL DEFAULT platform.now()
);
ALTER TABLE core.iam_mfa_proof_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.iam_mfa_proof_key FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.iam_mfa_proof_key TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.iam_mfa_proof_key FROM PUBLIC;
COMMENT ON TABLE core.iam_mfa_proof_key IS
  'Clé HMAC de la preuve d''élévation MFA du staff (ADR-062). Lue par iam_staff_owner seulement ; '
  'installée hors application. Absente => aucune élévation. US-012.';

-- 3. Primitives (SECURITY INVOKER ; EXECUTE au seul iam_staff_owner) ----------------------------
-- HMAC-SHA-256 (RFC 2104) sur sha256() natif : aucune extension de plus (ADR-052). Vecteurs
-- RFC 4231 vérifiés par test/l0/l0-iam-staff-mfa.test.ts.
CREATE FUNCTION core.iam_hmac_sha256(p_key bytea, p_msg bytea)
  RETURNS bytea
  LANGUAGE plpgsql
  IMMUTABLE
  STRICT
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_key  bytea := p_key;
  v_ipad bytea;
  v_opad bytea;
  i      integer;
BEGIN
  IF pg_catalog.octet_length(v_key) > 64 THEN
    v_key := pg_catalog.sha256(v_key);
  END IF;
  v_key := v_key || pg_catalog.decode(pg_catalog.repeat('00', 64 - pg_catalog.octet_length(v_key)), 'hex');
  v_ipad := v_key;
  v_opad := v_key;
  FOR i IN 0..63 LOOP
    v_ipad := pg_catalog.set_byte(v_ipad, i, pg_catalog.get_byte(v_key, i) # 54);   -- 0x36
    v_opad := pg_catalog.set_byte(v_opad, i, pg_catalog.get_byte(v_key, i) # 92);   -- 0x5c
  END LOOP;
  RETURN pg_catalog.sha256(v_opad || pg_catalog.sha256(v_ipad || p_msg));
END
$fn$;

-- Message de la preuve (forme v1, ADR-062) :
--   UTF-8('rueda-staff-mfa-v1') || empreinte du jeton (32) || UUID du facteur (16) || pas (int8 BE)
CREATE FUNCTION core.iam_mfa_proof(p_key bytea, p_token_hash bytea, p_factor_id uuid, p_step bigint)
  RETURNS bytea
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.iam_hmac_sha256(
           p_key,
           pg_catalog.convert_to('rueda-staff-mfa-v1', 'UTF8') || p_token_hash
             || pg_catalog.uuid_send(p_factor_id) || pg_catalog.int8send(p_step))
$fn$;

-- Pas TOTP courant (RFC 6238 : T = floor(unix / 30)) à l'horloge de la base.
CREATE FUNCTION core.iam_totp_step_now()
  RETURNS bigint
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.floor(EXTRACT(EPOCH FROM platform.now()) / 30)::bigint
$fn$;

-- 4. Contexte : empreinte du jeton de la session (preuve de possession) --------------------------
-- 64 caractères hexadécimaux ; absent ou mal formé => NULL => aucun pouvoir de staff.
CREATE FUNCTION app.session_token_hash()
  RETURNS bytea
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN v.s ~ '^[0-9a-f]{64}$' THEN pg_catalog.decode(v.s, 'hex') END
    FROM (SELECT pg_catalog.lower(NULLIF(pg_catalog.current_setting('app.session_token_hash', true), '')) AS s) AS v
$fn$;
COMMENT ON FUNCTION app.session_token_hash() IS
  'Contexte app.session_token_hash (SHA-256 hex du jeton de session) ; mal formé => NULL. US-012.';
REVOKE ALL ON FUNCTION app.session_token_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.session_token_hash() TO app_api, app_worker, policy_fn_owner;

-- 5. Fonctions de politique : le rôle de staff exige une session élevée de l'acteur -------------
GRANT SELECT (token_hash, user_id, mfa_level, expires_at, revoked_at)
  ON core.iam_session TO policy_fn_owner;
CREATE POLICY policy_fn_read ON core.iam_session FOR SELECT TO policy_fn_owner USING (true);

-- `migrator` ne peut remplacer une fonction d'un autre propriétaire qu'en devenant lui
-- (SET TRUE, INHERIT FALSE : ADR-044 amendé) ; CREATE sur le schéma le temps du remplacement.
GRANT CREATE ON SCHEMA app TO policy_fn_owner;
SET LOCAL ROLE policy_fn_owner;

CREATE OR REPLACE FUNCTION app.has_staff_role(p_role text, p_country text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           app.actor_kind() = 'STAFF'
           AND p_country = ANY (app.country_scope())
           AND EXISTS (SELECT 1
                         FROM core.iam_staff_role_assignment AS a
                         JOIN core.iam_user_account AS u ON u.id = a.user_id
                        WHERE a.user_id = app.actor_id()
                          AND a.role = p_role
                          AND p_country = ANY (a.country_scope)
                          AND (a.expires_at IS NULL OR a.expires_at > platform.now())
                          AND u.status = 'ACTIVE')
           -- US-012 (RLS-18 réduite) : session vivante de l'acteur, élevée par TOTP
           AND EXISTS (SELECT 1
                         FROM core.iam_session AS s
                        WHERE s.token_hash = app.session_token_hash()
                          AND s.user_id = app.actor_id()
                          AND s.mfa_level = 'TOTP'
                          AND s.revoked_at IS NULL
                          AND s.expires_at > platform.now()),
           false)
$fn$;

CREATE OR REPLACE FUNCTION app.staff_case_covers(p_object_type text, p_object_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           app.actor_kind() = 'STAFF'
           AND p_object_type = 'TRIP'
           AND EXISTS (SELECT 1
                         FROM core.iam_session AS s
                        WHERE s.token_hash = app.session_token_hash()
                          AND s.user_id = app.actor_id()
                          AND s.mfa_level = 'TOTP'
                          AND s.revoked_at IS NULL
                          AND s.expires_at > platform.now())
           AND EXISTS (SELECT 1
                         FROM core.support_support_case AS c
                        WHERE c.trip_id = p_object_id
                          AND c.assignee_id = app.actor_id()
                          AND c.status IN ('OPEN', 'PENDING')
                          AND c.country_code = ANY (app.country_scope())
                          AND EXISTS (SELECT 1
                                        FROM core.iam_staff_role_assignment AS a
                                        JOIN core.iam_user_account AS u ON u.id = a.user_id
                                       WHERE a.user_id = c.assignee_id
                                         AND a.role IN ('OPS_AGENT', 'SUPPORT_AGENT')
                                         AND c.country_code = ANY (a.country_scope)
                                         AND (a.expires_at IS NULL OR a.expires_at > platform.now())
                                         AND u.status = 'ACTIVE')),
           false)
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM policy_fn_owner;

-- 6. Ouverture de session : niveau NONE seulement (report US-010) --------------------------------
ALTER POLICY iam_auth_insert ON core.iam_session
  WITH CHECK (revoked_at IS NULL AND mfa_level = 'NONE');

GRANT CREATE ON SCHEMA core TO iam_auth_owner;
SET LOCAL ROLE iam_auth_owner;

CREATE OR REPLACE FUNCTION core.iam_cmd_open_session(
  p_session_id uuid,
  p_user_id    uuid,
  p_token_hash bytea,
  p_ttl_s      integer,
  p_mfa_level  text,
  p_ip         inet,
  p_user_agent text
)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now     timestamptz := platform.now();
  v_ttl     interval;
  v_status  text;
  v_expires timestamptz;
BEGIN
  IF p_ttl_s IS NULL OR p_ttl_s NOT BETWEEN 300 AND 2592000 THEN
    RAISE EXCEPTION 'iam : durée de session hors bornes' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- US-012 : une session naît sans MFA ; l'élévation passe par core.iam_staff_cmd_elevate
  IF p_mfa_level IS DISTINCT FROM 'NONE' THEN
    RAISE EXCEPTION 'iam : niveau MFA refusé à l''ouverture' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- FOR SHARE : une fermeture concurrente du compte attend la fin de l'ouverture
  SELECT u.status INTO v_status FROM core.iam_user_account AS u WHERE u.id = p_user_id FOR SHARE;
  IF v_status IS NULL OR v_status IN ('CLOSED', 'BANNED') THEN
    RETURN NULL;
  END IF;
  v_ttl := pg_catalog.make_interval(secs => p_ttl_s);
  IF EXISTS (SELECT 1 FROM core.iam_staff_role_assignment AS a
              WHERE a.user_id = p_user_id AND (a.expires_at IS NULL OR a.expires_at > v_now)) THEN
    v_ttl := LEAST(v_ttl, interval '8 hours');
  END IF;
  v_expires := v_now + v_ttl;
  INSERT INTO core.iam_session (id, user_id, token_hash, expires_at, ip, user_agent, mfa_level, created_at)
  VALUES (p_session_id, p_user_id, p_token_hash, v_expires, p_ip,
          pg_catalog.left(p_user_agent, 512), 'NONE', v_now);
  RETURN v_expires;
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;

-- 7. Propriétaire iam_staff_owner : droits au plus juste ----------------------------------------
GRANT USAGE ON SCHEMA core, platform TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION platform.now() TO iam_staff_owner;
REVOKE ALL ON FUNCTION core.iam_hmac_sha256(bytea, bytea), core.iam_mfa_proof(bytea, bytea, uuid, bigint),
  core.iam_totp_step_now() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_hmac_sha256(bytea, bytea), core.iam_mfa_proof(bytea, bytea, uuid, bigint),
  core.iam_totp_step_now() TO iam_staff_owner;

GRANT SELECT (key) ON core.iam_mfa_proof_key TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.iam_mfa_proof_key FOR SELECT TO iam_staff_owner USING (true);

GRANT SELECT (id, status) ON core.iam_user_account TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.iam_user_account FOR SELECT TO iam_staff_owner USING (true);

-- sessions : lecture ; élévation NONE -> TOTP ; révocation (suspension, réinitialisation, 0032)
GRANT SELECT (id, user_id, token_hash, expires_at, revoked_at, mfa_level) ON core.iam_session
  TO iam_staff_owner;
GRANT UPDATE (mfa_level, revoked_at, revoked_reason) ON core.iam_session TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.iam_session FOR SELECT TO iam_staff_owner USING (true);
CREATE POLICY iam_staff_update ON core.iam_session FOR UPDATE TO iam_staff_owner
  USING (revoked_at IS NULL)
  WITH CHECK ((revoked_at IS NULL AND mfa_level = 'TOTP')
              OR (revoked_at IS NOT NULL AND revoked_reason = 'ADMIN'));

-- rôles : lecture ; seule écriture admise = mettre fin à un rôle en cours (expires_at <= maintenant)
GRANT SELECT (id, user_id, role, country_scope, expires_at) ON core.iam_staff_role_assignment
  TO iam_staff_owner;
GRANT UPDATE (expires_at) ON core.iam_staff_role_assignment TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.iam_staff_role_assignment FOR SELECT TO iam_staff_owner
  USING (true);
CREATE POLICY iam_staff_update ON core.iam_staff_role_assignment FOR UPDATE TO iam_staff_owner
  USING (expires_at IS NULL OR expires_at > platform.now())
  WITH CHECK (expires_at IS NOT NULL AND expires_at <= platform.now());

-- matrice des permissions : lecture
GRANT SELECT (role, permission_code, valid_from, valid_to) ON core.iam_role_permission
  TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.iam_role_permission FOR SELECT TO iam_staff_owner USING (true);

-- facteurs : lecture ; création d'un TOTP en attente ; activation, échecs, verrou, désactivation
GRANT SELECT (id, user_id, kind, secret_ref, enabled_at, disabled_at, last_used_step,
              failed_attempts, locked_until, enrollment_code_hash, enrollment_expires_at)
  ON core.iam_auth_factor TO iam_staff_owner;
GRANT INSERT (id, user_id, kind, secret_ref, enrollment_code_hash, enrollment_expires_at)
  ON core.iam_auth_factor TO iam_staff_owner;
GRANT UPDATE (enabled_at, disabled_at, last_used_step, failed_attempts, locked_until,
              enrollment_code_hash, enrollment_expires_at)
  ON core.iam_auth_factor TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.iam_auth_factor FOR SELECT TO iam_staff_owner USING (true);
CREATE POLICY iam_staff_insert ON core.iam_auth_factor FOR INSERT TO iam_staff_owner
  WITH CHECK (kind = 'TOTP' AND enabled_at IS NULL AND disabled_at IS NULL
              AND enrollment_code_hash IS NOT NULL);
-- un facteur désactivé ne revit jamais
CREATE POLICY iam_staff_update ON core.iam_auth_factor FOR UPDATE TO iam_staff_owner
  USING (kind = 'TOTP' AND disabled_at IS NULL) WITH CHECK (kind = 'TOTP');

-- journal d'audit : écriture (la chaîne attribue id, at, prev_hash, hash) et relecture sans C2
GRANT INSERT (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after,
              reason, request_id)
  ON core.audit_audit_log TO iam_staff_owner;
GRANT SELECT (id, at, actor_user_id, actor_role, action_code, subject_type, subject_id, before,
              after, reason, request_id)
  ON core.audit_audit_log TO iam_staff_owner;
CREATE POLICY iam_staff_insert ON core.audit_audit_log FOR INSERT TO iam_staff_owner
  WITH CHECK (true);
CREATE POLICY iam_staff_select ON core.audit_audit_log FOR SELECT TO iam_staff_owner USING (true);

-- 8. Aides internes (SECURITY INVOKER ; exécutées par les commandes sous iam_staff_owner) -------
-- Session vivante d'un compte ACTIVE désignée par l'empreinte du jeton (preuve de possession).
CREATE FUNCTION core.iam_staff_session(p_token_hash bytea,
                                       OUT user_id uuid, OUT session_id uuid, OUT mfa_level text)
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.user_id, s.id, s.mfa_level
    FROM core.iam_session AS s
    JOIN core.iam_user_account AS u ON u.id = s.user_id
   WHERE s.token_hash = p_token_hash
     AND s.revoked_at IS NULL
     AND s.expires_at > platform.now()
     AND u.status = 'ACTIVE'
$fn$;

-- Écriture au journal (toujours EN DERNIER dans une commande : la tête de chaîne est un verrou
-- global jusqu'au COMMIT, passation US-009). Rend l'identifiant attribué par la chaîne.
CREATE FUNCTION core.iam_staff_audit(p_actor uuid, p_role text, p_action text, p_subject_type text,
                                     p_subject_id uuid, p_before jsonb, p_after jsonb,
                                     p_reason text, p_request_id uuid)
  RETURNS bigint
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.audit_audit_log AS l
         (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after, reason,
          request_id)
  VALUES (p_actor, p_role, p_action, p_subject_type, p_subject_id, p_before, p_after,
          NULLIF(pg_catalog.left(p_reason, 1000), ''), p_request_id)
  RETURNING l.id
$fn$;

REVOKE ALL ON FUNCTION core.iam_staff_session(bytea),
  core.iam_staff_audit(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_staff_session(bytea),
  core.iam_staff_audit(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid) TO iam_staff_owner;

-- 9. Commandes MFA du staff (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) --------
-- Une commande = un appel = une instruction (ADR-056) ; l'audit est écrit en dernier.

-- État d'accès d'une session à la console. Issues :
--   AUTH_REQUIRED (session absente, expirée, révoquée ou compte non ACTIVE ; rien n'est journalisé :
--   aucun acteur), NOT_STAFF, TOTP_NOT_ENROLLED, ENROLLMENT_REQUIRED, LOCKED (journalisés),
--   MFA_REQUIRED (facteur actif, session pas encore élevée), ELEVATED.
-- `secret_ref` n'est rendu que pour un facteur ACTIF (vérification du code par l'API) ; celui d'un
-- facteur en attente ne l'est que contre le code d'enrôlement (iam_staff_cmd_enroll_reveal).
CREATE FUNCTION core.iam_staff_cmd_begin(p_token_hash bytea)
  RETURNS TABLE (outcome text, user_id uuid, factor_id uuid, secret_ref text,
                 last_used_step bigint, roles jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now   timestamptz := platform.now();
  v_s     record;
  v_f     record;
  v_roles jsonb;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::uuid, NULL::text, NULL::bigint, NULL::jsonb;
    RETURN;
  END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role', a.role, 'countries',
           pg_catalog.to_jsonb(a.country_scope)) ORDER BY a.role)
    INTO v_roles
    FROM core.iam_staff_role_assignment AS a
   WHERE a.user_id = v_s.user_id AND (a.expires_at IS NULL OR a.expires_at > v_now);
  IF v_roles IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'USER', 'STAFF_ACCESS_DENIED', 'USER', v_s.user_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', 'NOT_STAFF'), NULL, NULL);
    RETURN QUERY SELECT 'NOT_STAFF'::text, v_s.user_id, NULL::uuid, NULL::text, NULL::bigint, NULL::jsonb;
    RETURN;
  END IF;
  SELECT f.id, f.secret_ref, f.enabled_at, f.last_used_step, f.locked_until, f.enrollment_expires_at
    INTO v_f
    FROM core.iam_auth_factor AS f
   WHERE f.user_id = v_s.user_id AND f.kind = 'TOTP' AND f.disabled_at IS NULL;
  IF v_f.id IS NULL OR (v_f.enabled_at IS NULL AND v_f.enrollment_expires_at <= v_now) THEN
    -- critère 2 d'US-012 : un compte staff sans TOTP n'a accès à rien
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER', v_s.user_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED'), NULL, NULL);
    RETURN QUERY SELECT 'TOTP_NOT_ENROLLED'::text, v_s.user_id, NULL::uuid, NULL::text, NULL::bigint, v_roles;
    RETURN;
  END IF;
  IF v_f.locked_until IS NOT NULL AND v_f.locked_until > v_now THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER', v_s.user_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', 'TOTP_LOCKED'), NULL, NULL);
    RETURN QUERY SELECT 'LOCKED'::text, v_s.user_id, v_f.id, NULL::text, NULL::bigint, v_roles;
    RETURN;
  END IF;
  IF v_f.enabled_at IS NULL THEN
    RETURN QUERY SELECT 'ENROLLMENT_REQUIRED'::text, v_s.user_id, v_f.id, NULL::text, NULL::bigint, v_roles;
    RETURN;
  END IF;
  IF v_s.mfa_level = 'TOTP' THEN
    RETURN QUERY SELECT 'ELEVATED'::text, v_s.user_id, v_f.id, NULL::text, NULL::bigint, v_roles;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'MFA_REQUIRED'::text, v_s.user_id, v_f.id, v_f.secret_ref, v_f.last_used_step, v_roles;
END
$fn$;

-- Enrôlement, étape 1 : le code remis hors bande ouvre la référence du secret du facteur en
-- attente (l'API en tire le QR code). Mauvais code : échec compté (verrou à 5) et journalisé.
CREATE FUNCTION core.iam_staff_cmd_enroll_reveal(p_token_hash bytea, p_code_hash bytea)
  RETURNS TABLE (outcome text, factor_id uuid, secret_ref text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := platform.now();
  v_s   record;
  v_f   record;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT f.id, f.secret_ref, f.enrollment_code_hash, f.enrollment_expires_at, f.locked_until,
         f.failed_attempts
    INTO v_f
    FROM core.iam_auth_factor AS f
   WHERE f.user_id = v_s.user_id AND f.kind = 'TOTP' AND f.disabled_at IS NULL
     AND f.enabled_at IS NULL
     FOR UPDATE;
  IF v_f.id IS NULL OR v_f.enrollment_expires_at <= v_now
     OR NOT EXISTS (SELECT 1 FROM core.iam_staff_role_assignment AS a
                     WHERE a.user_id = v_s.user_id
                       AND (a.expires_at IS NULL OR a.expires_at > v_now)) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ENROLLMENT_REFUSED', 'USER', v_s.user_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', 'NO_PENDING_FACTOR'), NULL, NULL);
    RETURN QUERY SELECT 'REFUSED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_f.locked_until IS NOT NULL AND v_f.locked_until > v_now THEN
    RETURN QUERY SELECT 'LOCKED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_code_hash IS NULL OR v_f.enrollment_code_hash <> p_code_hash THEN
    UPDATE core.iam_auth_factor AS f
       SET failed_attempts = f.failed_attempts + 1,
           locked_until = CASE WHEN f.failed_attempts + 1 >= 5 THEN v_now + interval '15 minutes' END
     WHERE f.id = v_f.id;
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ENROLLMENT_REFUSED', 'AUTH_FACTOR', v_f.id,
                                 NULL, pg_catalog.jsonb_build_object('reason', 'BAD_CODE',
                                   'failedAttempts', v_f.failed_attempts + 1), NULL, NULL);
    RETURN QUERY SELECT 'REFUSED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, v_f.id, v_f.secret_ref;
END
$fn$;

-- Élévation (ou fin d'enrôlement) : l'API a vérifié le code TOTP du pas p_step et présente la
-- preuve HMAC. Issues : ELEVATED, ENROLLED, AUTH_REQUIRED, NOT_STAFF, REFUSED (preuve, pas hors
-- fenêtre ou rejoué, facteur inconnu ; journalisé), LOCKED, UNAVAILABLE (aucune clé installée).
CREATE FUNCTION core.iam_staff_cmd_elevate(p_token_hash bytea, p_factor_id uuid, p_step bigint,
                                           p_proof bytea)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now    timestamptz := platform.now();
  v_s      record;
  v_f      record;
  v_key    bytea;
  v_reason text;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.iam_staff_role_assignment AS a
                  WHERE a.user_id = v_s.user_id AND (a.expires_at IS NULL OR a.expires_at > v_now)) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'USER', 'STAFF_ACCESS_DENIED', 'USER', v_s.user_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', 'NOT_STAFF'), NULL, NULL);
    RETURN 'NOT_STAFF';
  END IF;
  SELECT k.key INTO v_key FROM core.iam_mfa_proof_key AS k WHERE k.id = 1;
  IF v_key IS NULL THEN
    RETURN 'UNAVAILABLE';
  END IF;
  SELECT f.id, f.enabled_at, f.last_used_step, f.locked_until, f.enrollment_expires_at,
         f.failed_attempts
    INTO v_f
    FROM core.iam_auth_factor AS f
   WHERE f.id = p_factor_id AND f.user_id = v_s.user_id AND f.kind = 'TOTP' AND f.disabled_at IS NULL
     FOR UPDATE;
  IF v_f.id IS NULL THEN
    v_reason := 'UNKNOWN_FACTOR';
  ELSIF v_f.locked_until IS NOT NULL AND v_f.locked_until > v_now THEN
    RETURN 'LOCKED';
  ELSIF v_f.enabled_at IS NULL AND v_f.enrollment_expires_at <= v_now THEN
    v_reason := 'ENROLLMENT_EXPIRED';
  ELSIF p_proof IS NULL OR p_step IS NULL
        OR core.iam_mfa_proof(v_key, p_token_hash, v_f.id, p_step) <> p_proof THEN
    v_reason := 'BAD_PROOF';
  ELSIF pg_catalog.abs(p_step - core.iam_totp_step_now()) > 1 THEN
    v_reason := 'STEP_OUT_OF_WINDOW';
  ELSIF v_f.last_used_step IS NOT NULL AND p_step <= v_f.last_used_step THEN
    v_reason := 'STEP_REPLAYED';
  END IF;
  IF v_reason IS NOT NULL THEN
    IF v_f.id IS NOT NULL THEN
      UPDATE core.iam_auth_factor AS f
         SET failed_attempts = f.failed_attempts + 1,
             locked_until = CASE WHEN f.failed_attempts + 1 >= 5 THEN v_now + interval '15 minutes' END
       WHERE f.id = v_f.id;
    END IF;
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_MFA_REFUSED', 'USER', v_s.user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason), NULL, NULL);
    RETURN 'REFUSED';
  END IF;

  UPDATE core.iam_auth_factor AS f
     SET last_used_step = p_step, failed_attempts = 0, locked_until = NULL,
         enabled_at = COALESCE(f.enabled_at, v_now),
         enrollment_code_hash = NULL, enrollment_expires_at = NULL
   WHERE f.id = v_f.id;
  UPDATE core.iam_session AS s SET mfa_level = 'TOTP' WHERE s.id = v_s.session_id;
  PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF',
                               CASE WHEN v_f.enabled_at IS NULL THEN 'STAFF_TOTP_ENROLLED'
                                    ELSE 'STAFF_MFA_VERIFIED' END,
                               'USER', v_s.user_id, NULL,
                               pg_catalog.jsonb_build_object('factorId', v_f.id), NULL, NULL);
  RETURN CASE WHEN v_f.enabled_at IS NULL THEN 'ENROLLED' ELSE 'ELEVATED' END;
END
$fn$;

-- Code TOTP faux (constaté par l'API, qui seule connaît le secret) : échec compté, verrou à 5.
CREATE FUNCTION core.iam_staff_cmd_mfa_failed(p_token_hash bytea)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := platform.now();
  v_s   record;
  v_n   integer;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  UPDATE core.iam_auth_factor AS f
     SET failed_attempts = f.failed_attempts + 1,
         locked_until = CASE WHEN f.failed_attempts + 1 >= 5 THEN v_now + interval '15 minutes' END
   WHERE f.user_id = v_s.user_id AND f.kind = 'TOTP' AND f.disabled_at IS NULL
  RETURNING f.failed_attempts INTO v_n;
  PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_MFA_REFUSED', 'USER', v_s.user_id, NULL,
                               pg_catalog.jsonb_build_object('reason', 'BAD_CODE',
                                 'failedAttempts', COALESCE(v_n, 0)), NULL, NULL);
  RETURN CASE WHEN COALESCE(v_n, 0) >= 5 THEN 'LOCKED' ELSE 'COUNTED' END;
END
$fn$;

COMMENT ON FUNCTION core.iam_staff_cmd_begin(bytea) IS
  'État d''accès d''une session à la console (TOTP obligatoire) ; refus journalisés. US-012.';
COMMENT ON FUNCTION core.iam_staff_cmd_enroll_reveal(bytea, bytea) IS
  'Enrôlement TOTP : code hors bande => référence du secret ; échecs comptés et journalisés. US-012.';
COMMENT ON FUNCTION core.iam_staff_cmd_elevate(bytea, uuid, bigint, bytea) IS
  'Élévation NONE -> TOTP sur preuve HMAC, pas à ±1, sans rejeu ; journalisée. US-012.';
COMMENT ON FUNCTION core.iam_staff_cmd_mfa_failed(bytea) IS
  'Code TOTP faux : échec compté (verrou 15 min à 5), journalisé. US-012.';

REVOKE ALL ON FUNCTION core.iam_staff_cmd_begin(bytea), core.iam_staff_cmd_enroll_reveal(bytea, bytea),
  core.iam_staff_cmd_elevate(bytea, uuid, bigint, bytea), core.iam_staff_cmd_mfa_failed(bytea)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_staff_cmd_begin(bytea), core.iam_staff_cmd_enroll_reveal(bytea, bytea),
  core.iam_staff_cmd_elevate(bytea, uuid, bigint, bytea), core.iam_staff_cmd_mfa_failed(bytea)
  TO app_api;

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_cmd_begin(bytea) OWNER TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_cmd_enroll_reveal(bytea, bytea) OWNER TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_cmd_elevate(bytea, uuid, bigint, bytea) OWNER TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_cmd_mfa_failed(bytea) OWNER TO iam_staff_owner;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
