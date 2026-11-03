-- 0032 — Console interne : matrice des permissions du staff, actions de console (`manual_action`),
-- suspension d'un membre du staff, réinitialisation de son TOTP, lecture du journal.
-- US-012 ; 16 ADM-001 (« action interdite => 403 journalisé », « perte du TOTP => réinitialisation
-- par un autre admin, journalisée »), NFR-08 ; 17 §2.3 (matrice), §3.2.13 (`manual_action`,
-- `audit_log`), §10 (catalogue des actions de console, NN9) ; ADR-056 (un appel = une
-- instruction), ADR-062. Appliquée sous `migrator`.
--
-- Principes (ADR-062) :
--   - chaque commande de console est UN appel de fonction SECURITY DEFINER (propriétaire
--     iam_staff_owner, EXECUTE au seul app_api) qui, dans cet ordre : retrouve la session par
--     l'empreinte de son jeton (preuve de possession), exige le niveau TOTP, relit en base les
--     rôles EN COURS, leur portée pays et la matrice `iam_role_permission`, agit ou refuse, puis
--     écrit l'audit EN DERNIER (passation US-009) ;
--   - un refus (MFA absente, permission absente, pays hors portée, sujet introuvable) ne lève pas
--     d'erreur : il est JOURNALISÉ puis rendu comme issue (l'API répond 403) ; un sujet introuvable
--     et un sujet hors portée donnent la même issue `FORBIDDEN` (aucun oracle d'existence) ;
--   - le pays d'un sujet est relu en base (jamais reçu du client) ;
--   - aucun identifiant de personne autre que le SUJET visé n'est reçu : l'acteur est toujours
--     celui de la session.
--
-- Matrice : seules les permissions des commandes de cette story sont semées (17 §2.3, colonnes
-- staff) ; les autres arrivent avec leur story (US-062 crée app.has_permission). `lim.` de 17 est
-- appliqué par la commande : `iam.staff_roles_write` d'un ADMIN ne vise pas un ADMIN / SUPERADMIN ;
-- `audit.read` d'un OPS / FINANCE ne rend que ses propres lignes.
--
-- Report US-011 (passation, 2 ter) : `config_param_value.approved_by` (identifiant du personnel)
-- n'est plus lisible par app_api ; lecture par colonnes (§ 5).
--
-- Retour arrière :
--   DROP FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb),
--     core.iam_staff_cmd_suspend(bytea, uuid, uuid, text),
--     core.iam_staff_cmd_reset_totp(bytea, uuid, uuid, text, uuid, text, bytea, integer),
--     core.iam_staff_audit_read(bytea, bigint, integer),
--     core.iam_staff_permitted(uuid, text, text[], text[]);
--   DROP TABLE core.support_manual_action, core.support_manual_action_catalog;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-012%';
--   REVOKE SELECT ON core.config_param_value FROM app_api; GRANT SELECT ON … TO app_api.

-- 1. Matrice des permissions du staff (17 §2.3, colonnes SUPPORT à SUPERADMIN ; PROPOSÉ) --------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('OPS_AGENT',  'ops.platform_cancel',    'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3'),
  ('ADMIN',      'ops.platform_cancel',    'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3'),
  ('OPS_AGENT',  'trip.declare_no_show',   'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3'),
  ('ADMIN',      'trip.declare_no_show',   'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3'),
  ('OPS_AGENT',  'claim.declare',          'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3'),
  ('ADMIN',      'claim.declare',          'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3'),
  ('ADMIN',      'iam.staff_roles_write',  'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3 (lim. : non-admin)'),
  ('SUPERADMIN', 'iam.staff_roles_write',  'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3'),
  ('OPS_AGENT',  'audit.read',             'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3 (lim. : ses objets)'),
  ('FINANCE',    'audit.read',             'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3 (lim.)'),
  ('ADMIN',      'audit.read',             'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3'),
  ('SUPERADMIN', 'audit.read',             'PLATFORM', '2026-11-03T00:00:00Z', 'US-012 : matrice 17 §2.3');

-- 2. Actions de console (17 §3.2.13 `manual_action`, §10 catalogue ; SUP) ----------------------
-- Catalogue fermé : action -> permission, mode, type de sujet. `available` = la commande de
-- domaine existe ; sinon la console refuse proprement (issue UNAVAILABLE, journalisée) au lieu
-- d'imiter un changement d'état (17 §10 NN9 : « commande de domaine réelle »).
CREATE TABLE core.support_manual_action_catalog (
  action_code     text    CONSTRAINT manual_action_catalog_pkey PRIMARY KEY
    CONSTRAINT manual_action_catalog_code_format CHECK (action_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  permission_code text    NOT NULL
    CONSTRAINT manual_action_catalog_permission_format CHECK (permission_code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  mode            text    NOT NULL
    CONSTRAINT manual_action_catalog_mode_valid CHECK (mode IN ('DOMAIN_COMMAND', 'RECORD_ONLY')),
  subject_type    text    NOT NULL
    CONSTRAINT manual_action_catalog_subject_valid CHECK (subject_type IN ('TRIP')),
  available       boolean NOT NULL
);
INSERT INTO core.support_manual_action_catalog (action_code, permission_code, mode, subject_type, available)
VALUES
  ('CANCEL_TRIP_PLATFORM', 'ops.platform_cancel',  'DOMAIN_COMMAND', 'TRIP', false),  -- US-208
  ('DECLARE_NO_SHOW',      'trip.declare_no_show', 'DOMAIN_COMMAND', 'TRIP', false),  -- story du no-show
  ('RECORD_CLAIM',         'claim.declare',        'RECORD_ONLY',    'TRIP', true);
ALTER TABLE core.support_manual_action_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.support_manual_action_catalog FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.support_manual_action_catalog TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.support_manual_action_catalog FROM PUBLIC;
COMMENT ON TABLE core.support_manual_action_catalog IS
  'Catalogue fermé des actions de console (17 §10) : permission, mode, sujet, disponibilité. US-012.';

CREATE TABLE core.support_manual_action (
  id                uuid        CONSTRAINT manual_action_pkey PRIMARY KEY,
  action_code       text        NOT NULL REFERENCES core.support_manual_action_catalog (action_code),
  mode              text        NOT NULL
    CONSTRAINT manual_action_mode_valid CHECK (mode IN ('DOMAIN_COMMAND', 'RECORD_ONLY')),
  subject_type      text        NOT NULL,
  subject_id        uuid        NOT NULL,
  country_code      text        NOT NULL
    CONSTRAINT manual_action_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  actor_user_id     uuid        NOT NULL REFERENCES core.iam_user_account (id),
  actor_role        text        NOT NULL,
  input             jsonb       NOT NULL DEFAULT '{}'::jsonb          -- références, aucune C3
    CONSTRAINT manual_action_input_object CHECK (pg_catalog.jsonb_typeof(input) = 'object'),
  evidence_file_ids uuid[]      NOT NULL DEFAULT '{}',
  reason            text        NOT NULL                              -- [C2] motif
    CONSTRAINT manual_action_reason_length CHECK (pg_catalog.char_length(pg_catalog.btrim(reason)) BETWEEN 10 AND 1000),
  emitted_event_ids uuid[]      NOT NULL DEFAULT '{}',
  audit_log_id      bigint      REFERENCES core.audit_audit_log (id),
  request_id        uuid        NOT NULL,
  at                timestamptz NOT NULL DEFAULT platform.now(),
  -- idempotence (17 §3.2.13)
  CONSTRAINT manual_action_idempotent UNIQUE (action_code, subject_id, request_id)
);
ALTER TABLE core.support_manual_action ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.support_manual_action FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.support_manual_action TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.support_manual_action FROM PUBLIC;
COMMENT ON TABLE core.support_manual_action IS
  'SUP manual_action (17 §3.2.13) : chaque opération manuelle passe par une action de console '
  'motivée et journalisée. Écrite par core.iam_staff_cmd_manual_action seulement. US-012.';

-- 3. Droits d'iam_staff_owner sur ces objets -----------------------------------------------------
GRANT SELECT ON core.support_manual_action_catalog TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.support_manual_action_catalog FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (id, action_code, subject_id, request_id, audit_log_id) ON core.support_manual_action
  TO iam_staff_owner;
GRANT INSERT (id, action_code, mode, subject_type, subject_id, country_code, actor_user_id,
              actor_role, input, reason, request_id)
  ON core.support_manual_action TO iam_staff_owner;
GRANT UPDATE (audit_log_id) ON core.support_manual_action TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.support_manual_action FOR SELECT TO iam_staff_owner USING (true);
CREATE POLICY iam_staff_insert ON core.support_manual_action FOR INSERT TO iam_staff_owner
  WITH CHECK (audit_log_id IS NULL);
-- seule écriture admise après coup : rattacher la ligne d'audit, une fois
CREATE POLICY iam_staff_update ON core.support_manual_action FOR UPDATE TO iam_staff_owner
  USING (audit_log_id IS NULL) WITH CHECK (audit_log_id IS NOT NULL);

-- pays d'un trip (sujet des actions de console)
GRANT SELECT (id, country_code) ON core.booking_trip TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.booking_trip FOR SELECT TO iam_staff_owner USING (true);

-- 4. Commandes de console ------------------------------------------------------------------------
-- Rôle EN COURS de p_user qui détient p_permission (matrice en vigueur) sur TOUS les pays
-- p_countries, parmi p_roles s'il est donné ; NULL sinon. Aide interne (SECURITY INVOKER).
CREATE FUNCTION core.iam_staff_permitted(p_user uuid, p_permission text, p_countries text[],
                                         p_roles text[])
  RETURNS text
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.role
    FROM core.iam_staff_role_assignment AS a
    JOIN core.iam_role_permission AS p ON p.role = a.role
   WHERE a.user_id = p_user
     AND (a.expires_at IS NULL OR a.expires_at > platform.now())
     AND pg_catalog.cardinality(p_countries) >= 1
     AND pg_catalog.array_position(p_countries, NULL) IS NULL
     AND p_countries <@ a.country_scope
     AND (p_roles IS NULL OR a.role = ANY (p_roles))
     AND p.permission_code = p_permission
     AND p.valid_from <= platform.now()
     AND (p.valid_to IS NULL OR p.valid_to > platform.now())
   ORDER BY a.role
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION core.iam_staff_permitted(uuid, text, text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_staff_permitted(uuid, text, text[], text[]) TO iam_staff_owner;

-- Action de console sur un trip. Issues : AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, UNAVAILABLE,
-- RECORDED, DUPLICATE. Tout sauf AUTH_REQUIRED (aucun acteur) et DUPLICATE (déjà journalisé) est
-- journalisé. Motif de 10 à 1000 caractères et `input` objet de 4 Kio au plus, sinon 22023.
CREATE FUNCTION core.iam_staff_cmd_manual_action(p_token_hash bytea, p_request_id uuid,
                                                 p_action_code text, p_subject_id uuid,
                                                 p_reason text, p_input jsonb)
  RETURNS TABLE (outcome text, action_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s       record;
  v_cat     record;
  v_country text;
  v_role    text;
  v_why     text;
  v_id      uuid;
  v_audit   bigint;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT c.action_code, c.permission_code, c.mode, c.subject_type, c.available INTO v_cat
    FROM core.support_manual_action_catalog AS c WHERE c.action_code = p_action_code;
  IF v_cat.action_code IS NULL OR p_request_id IS NULL OR p_subject_id IS NULL
     OR p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 1000
     OR (p_input IS NOT NULL AND (pg_catalog.jsonb_typeof(p_input) <> 'object'
                                  OR pg_catalog.octet_length(p_input::text) > 4096)) THEN
    RAISE EXCEPTION 'console : action, motif ou données invalides' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', v_cat.action_code), p_reason, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- pays du sujet, relu en base
  SELECT t.country_code INTO v_country FROM core.booking_trip AS t WHERE t.id = p_subject_id;
  IF v_country IS NULL THEN
    v_why := 'SUBJECT_NOT_FOUND';
  ELSE
    v_role := core.iam_staff_permitted(v_s.user_id, v_cat.permission_code, ARRAY[v_country], NULL);
    IF v_role IS NULL THEN
      v_why := CASE
                 WHEN EXISTS (SELECT 1
                                FROM core.iam_staff_role_assignment AS a
                                JOIN core.iam_role_permission AS p ON p.role = a.role
                               WHERE a.user_id = v_s.user_id
                                 AND (a.expires_at IS NULL OR a.expires_at > platform.now())
                                 AND p.permission_code = v_cat.permission_code
                                 AND p.valid_from <= platform.now()
                                 AND (p.valid_to IS NULL OR p.valid_to > platform.now()))
                 THEN 'COUNTRY_SCOPE' ELSE 'PERMISSION' END;
    END IF;
  END IF;
  IF v_why IS NOT NULL THEN
    -- 16 ADM-001 : action interdite => 403 journalisé
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_why,
                                   'attempted', v_cat.action_code,
                                   'permission', v_cat.permission_code), p_reason, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT m.id INTO v_id FROM core.support_manual_action AS m
   WHERE m.action_code = v_cat.action_code AND m.subject_id = p_subject_id
     AND m.request_id = p_request_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_id;
    RETURN;
  END IF;
  IF NOT v_cat.available THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'MANUAL_ACTION_UNAVAILABLE', v_cat.subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('attempted', v_cat.action_code,
                                   'country', v_country), p_reason, p_request_id);
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;
  v_id := p_request_id;   -- identifiant stable de l'action (idempotence par request_id)
  INSERT INTO core.support_manual_action (id, action_code, mode, subject_type, subject_id, country_code,
                                          actor_user_id, actor_role, input, reason, request_id)
  VALUES (v_id, v_cat.action_code, v_cat.mode, v_cat.subject_type, p_subject_id, v_country,
          v_s.user_id, v_role, COALESCE(p_input, '{}'::jsonb), pg_catalog.btrim(p_reason), p_request_id);
  v_audit := core.iam_staff_audit(v_s.user_id, v_role, 'MANUAL_ACTION_RECORDED', v_cat.subject_type,
                                  p_subject_id, NULL,
                                  pg_catalog.jsonb_build_object('manualActionId', v_id,
                                    'action', v_cat.action_code, 'mode', v_cat.mode,
                                    'country', v_country), p_reason, p_request_id);
  UPDATE core.support_manual_action AS m SET audit_log_id = v_audit WHERE m.id = v_id;
  RETURN QUERY SELECT 'RECORDED'::text, v_id;
END
$fn$;

-- Autorité sur un membre du staff (suspension, réinitialisation du TOTP) : jamais soi-même ;
-- `iam.staff_roles_write` sur TOUS les pays des rôles en cours de la cible ; cible ADMIN ou
-- SUPERADMIN => SUPERADMIN seulement (17 §2.3 : ADMIN « lim. (non-admin) »). Rend le rôle qui
-- autorise, ou le motif du refus préfixé de « ! ». Aide interne (SECURITY INVOKER).
CREATE FUNCTION core.iam_staff_authority(p_actor uuid, p_target uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_countries  text[];
  v_privileged boolean;
  v_role       text;
BEGIN
  IF p_target IS NULL OR p_target = p_actor THEN
    RETURN '!SELF';
  END IF;
  SELECT pg_catalog.array_agg(DISTINCT c ORDER BY c), pg_catalog.bool_or(a.role IN ('ADMIN', 'SUPERADMIN'))
    INTO v_countries, v_privileged
    FROM core.iam_staff_role_assignment AS a
    CROSS JOIN LATERAL pg_catalog.unnest(a.country_scope) AS c
   WHERE a.user_id = p_target AND (a.expires_at IS NULL OR a.expires_at > platform.now());
  IF v_countries IS NULL THEN
    RETURN '!TARGET_NOT_STAFF';
  END IF;
  v_role := core.iam_staff_permitted(p_actor, 'iam.staff_roles_write', v_countries,
                                     CASE WHEN v_privileged THEN ARRAY['SUPERADMIN'] END);
  IF v_role IS NULL THEN
    RETURN CASE WHEN core.iam_staff_permitted(p_actor, 'iam.staff_roles_write', v_countries, NULL) IS NOT NULL
                THEN '!TARGET_PRIVILEGED' ELSE '!PERMISSION_OR_COUNTRY' END;
  END IF;
  RETURN v_role;
END
$fn$;
REVOKE ALL ON FUNCTION core.iam_staff_authority(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_staff_authority(uuid, uuid) TO iam_staff_owner;

-- Suspension d'un membre du staff : tous ses rôles en cours prennent fin, toutes ses sessions
-- sont révoquées (ADMIN), ses facteurs sont désactivés. Il perd tout. Issues : AUTH_REQUIRED,
-- MFA_REQUIRED, FORBIDDEN, DONE.
CREATE FUNCTION core.iam_staff_cmd_suspend(p_token_hash bytea, p_request_id uuid, p_target uuid,
                                           p_reason text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now      timestamptz := platform.now();
  v_s        record;
  v_auth     text;
  v_before   jsonb;
  v_sessions integer;
  v_factors  integer;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  IF p_request_id IS NULL OR p_reason IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'console : motif invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER',
                                 COALESCE(p_target, v_s.user_id), NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'SUSPEND_STAFF'), p_reason, p_request_id);
    RETURN 'MFA_REQUIRED';
  END IF;
  v_auth := core.iam_staff_authority(v_s.user_id, p_target);
  IF v_auth LIKE '!%' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER',
                                 COALESCE(p_target, v_s.user_id), NULL,
                                 pg_catalog.jsonb_build_object('reason', pg_catalog.substr(v_auth, 2),
                                   'attempted', 'SUSPEND_STAFF',
                                   'permission', 'iam.staff_roles_write'), p_reason, p_request_id);
    RETURN 'FORBIDDEN';
  END IF;
  SELECT pg_catalog.jsonb_build_object('roles', pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'role', a.role, 'countries', pg_catalog.to_jsonb(a.country_scope)) ORDER BY a.role))
    INTO v_before
    FROM core.iam_staff_role_assignment AS a
   WHERE a.user_id = p_target AND (a.expires_at IS NULL OR a.expires_at > v_now);
  UPDATE core.iam_staff_role_assignment AS a SET expires_at = v_now
   WHERE a.user_id = p_target AND (a.expires_at IS NULL OR a.expires_at > v_now);
  UPDATE core.iam_session AS s SET revoked_at = v_now, revoked_reason = 'ADMIN'
   WHERE s.user_id = p_target AND s.revoked_at IS NULL;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  UPDATE core.iam_auth_factor AS f SET disabled_at = v_now
   WHERE f.user_id = p_target AND f.kind = 'TOTP' AND f.disabled_at IS NULL;
  GET DIAGNOSTICS v_factors = ROW_COUNT;
  PERFORM core.iam_staff_audit(v_s.user_id, v_auth, 'STAFF_SUSPENDED', 'USER', p_target, v_before,
                               pg_catalog.jsonb_build_object('roles', '[]'::jsonb,
                                 'sessionsRevoked', v_sessions, 'factorsDisabled', v_factors),
                               p_reason, p_request_id);
  RETURN 'DONE';
END
$fn$;

-- Réinitialisation du TOTP d'un membre du staff par un AUTRE (16 ADM-001) : facteurs vivants
-- désactivés, sessions révoquées, nouveau facteur en attente (référence du secret dans le coffre,
-- empreinte du code d'enrôlement remis hors bande, durée 300 s à 7 j). Issues : AUTH_REQUIRED,
-- MFA_REQUIRED, FORBIDDEN, DONE.
CREATE FUNCTION core.iam_staff_cmd_reset_totp(p_token_hash bytea, p_request_id uuid, p_target uuid,
                                              p_reason text, p_factor_id uuid, p_secret_ref text,
                                              p_code_hash bytea, p_ttl_s integer)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now      timestamptz := platform.now();
  v_s        record;
  v_auth     text;
  v_sessions integer;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  IF p_request_id IS NULL OR p_factor_id IS NULL OR p_secret_ref IS NULL OR p_code_hash IS NULL
     OR p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 1000
     OR p_ttl_s IS NULL OR p_ttl_s NOT BETWEEN 300 AND 604800 THEN
    RAISE EXCEPTION 'console : paramètres invalides' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER',
                                 COALESCE(p_target, v_s.user_id), NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'RESET_STAFF_TOTP'), p_reason, p_request_id);
    RETURN 'MFA_REQUIRED';
  END IF;
  v_auth := core.iam_staff_authority(v_s.user_id, p_target);
  IF v_auth LIKE '!%' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER',
                                 COALESCE(p_target, v_s.user_id), NULL,
                                 pg_catalog.jsonb_build_object('reason', pg_catalog.substr(v_auth, 2),
                                   'attempted', 'RESET_STAFF_TOTP',
                                   'permission', 'iam.staff_roles_write'), p_reason, p_request_id);
    RETURN 'FORBIDDEN';
  END IF;
  UPDATE core.iam_auth_factor AS f SET disabled_at = v_now
   WHERE f.user_id = p_target AND f.kind = 'TOTP' AND f.disabled_at IS NULL;
  UPDATE core.iam_session AS s SET revoked_at = v_now, revoked_reason = 'ADMIN'
   WHERE s.user_id = p_target AND s.revoked_at IS NULL;
  GET DIAGNOSTICS v_sessions = ROW_COUNT;
  INSERT INTO core.iam_auth_factor (id, user_id, kind, secret_ref, enrollment_code_hash,
                                    enrollment_expires_at)
  VALUES (p_factor_id, p_target, 'TOTP', p_secret_ref, p_code_hash,
          v_now + pg_catalog.make_interval(secs => p_ttl_s));
  PERFORM core.iam_staff_audit(v_s.user_id, v_auth, 'STAFF_TOTP_RESET', 'USER', p_target, NULL,
                               pg_catalog.jsonb_build_object('factorId', p_factor_id,
                                 'sessionsRevoked', v_sessions), p_reason, p_request_id);
  RETURN 'DONE';
END
$fn$;

-- Lecture du journal par la console (`audit.read`) : ADMIN / SUPERADMIN, tout le journal ;
-- OPS / FINANCE (lim.), leurs propres lignes. Jamais l'IP chiffrée (C2). Page de 1 à 200 lignes,
-- de la plus récente à la plus ancienne, avant p_before_id s'il est donné. Session non élevée ou
-- sans permission : aucune ligne, refus journalisé.
CREATE FUNCTION core.iam_staff_audit_read(p_token_hash bytea, p_before_id bigint, p_limit integer)
  RETURNS TABLE (id bigint, at timestamptz, actor_user_id uuid, actor_role text, action_code text,
                 subject_type text, subject_id uuid, reason text, before jsonb, after jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s     record;
  v_full  boolean;
  v_any   boolean;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_catalog.bool_or(a.role IN ('ADMIN', 'SUPERADMIN')), pg_catalog.bool_or(true)
    INTO v_full, v_any
    FROM core.iam_staff_role_assignment AS a
    JOIN core.iam_role_permission AS p ON p.role = a.role
   WHERE a.user_id = v_s.user_id
     AND (a.expires_at IS NULL OR a.expires_at > platform.now())
     AND p.permission_code = 'audit.read'
     AND p.valid_from <= platform.now()
     AND (p.valid_to IS NULL OR p.valid_to > platform.now());
  IF v_s.mfa_level <> 'TOTP' OR v_any IS NOT TRUE THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF',
                                 CASE WHEN v_s.mfa_level <> 'TOTP' THEN 'STAFF_ACCESS_DENIED'
                                      ELSE 'STAFF_FORBIDDEN' END,
                                 'AUDIT_LOG', v_s.user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_s.mfa_level <> 'TOTP' THEN '2FA_REQUIRED' ELSE 'PERMISSION' END,
                                   'attempted', 'AUDIT_READ', 'permission', 'audit.read'), NULL, NULL);
    RETURN;
  END IF;
  RETURN QUERY
    SELECT l.id, l.at, l.actor_user_id, l.actor_role, l.action_code, l.subject_type, l.subject_id,
           l.reason, l.before, l.after
      FROM core.audit_audit_log AS l
     WHERE (p_before_id IS NULL OR l.id < p_before_id)
       AND (v_full OR l.actor_user_id = v_s.user_id)
     ORDER BY l.id DESC
     LIMIT v_limit;
END
$fn$;

COMMENT ON FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb) IS
  'Action de console motivée (17 §3.2.13) : TOTP, permission, portée pays ; refus journalisés. US-012.';
COMMENT ON FUNCTION core.iam_staff_cmd_suspend(bytea, uuid, uuid, text) IS
  'Suspension d''un membre du staff : rôles, sessions et facteurs retirés ; journalisée. US-012.';
COMMENT ON FUNCTION core.iam_staff_cmd_reset_totp(bytea, uuid, uuid, text, uuid, text, bytea, integer) IS
  'Réinitialisation du TOTP d''un autre membre du staff (16 ADM-001) ; journalisée. US-012.';
COMMENT ON FUNCTION core.iam_staff_audit_read(bytea, bigint, integer) IS
  'Lecture du journal par la console (audit.read ; OPS / FINANCE : leurs lignes) ; sans C2. US-012.';

REVOKE ALL ON FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb),
  core.iam_staff_cmd_suspend(bytea, uuid, uuid, text),
  core.iam_staff_cmd_reset_totp(bytea, uuid, uuid, text, uuid, text, bytea, integer),
  core.iam_staff_audit_read(bytea, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb),
  core.iam_staff_cmd_suspend(bytea, uuid, uuid, text),
  core.iam_staff_cmd_reset_totp(bytea, uuid, uuid, text, uuid, text, bytea, integer),
  core.iam_staff_audit_read(bytea, bigint, integer) TO app_api;

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb) OWNER TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_cmd_suspend(bytea, uuid, uuid, text) OWNER TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_cmd_reset_totp(bytea, uuid, uuid, text, uuid, text, bytea, integer)
  OWNER TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_audit_read(bytea, bigint, integer) OWNER TO iam_staff_owner;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 5. Report US-011 : approved_by (identifiant du personnel) fermé à app_api ---------------------
REVOKE SELECT ON core.config_param_value FROM app_api;
GRANT SELECT (id, key, country_code, scope_type, scope_id, network, currency, value, valid_from,
              valid_to, decision_ref, change_reason, created_at, created_by)
  ON core.config_param_value TO app_api;
