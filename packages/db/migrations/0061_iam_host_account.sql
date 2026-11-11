-- 0061 — IAM : compte d'hôte d'une personne physique (titulaire, nom affiché), libre-service et action de console CREATE_HOST_ACCOUNT.
-- US-107 ; 19 US-107 ; 17 §2.2, §2.3 (« Compte d'hôte » : `organization` P2P_HOST_INDIVIDUAL, une
-- personne physique, mono-pays), §3.2.1 (`organization`, `membership`), §10 (catalogue des
-- actions de console, `CREATE_HOST_ACCOUNT`) ; 08 BR-ACC-06 ; 16 HST-049, A.8 ; DEC-FONDATEUR-13,
-- DEC-FONDATEUR-19 ; ADR-092 (cadre des actions), ADR-096 (cette migration). Appliquée sous
-- `migrator`.
--
-- Principes (ADR-096) :
--   - UNE commande de domaine, `core.iam_host_open_account` (SECURITY INVOKER, exécutée sous
--     iam_auth_owner par ses deux appelants), qui ouvre le compte d'hôte d'une personne déjà
--     inscrite : organisation `P2P_HOST_INDIVIDUAL` au statut `ONBOARDING` et appartenance
--     `P2P_HOST` titulaire `ACTIVE`, dans la même instruction, plus l'audit `HOST_ACCOUNT_OPENED` ;
--   - deux appelants, mêmes règles : le libre-service `core.iam_cmd_open_host_account` (session
--     désignée par l'empreinte de son jeton, jamais par un identifiant reçu du client ; EXECUTE au
--     seul app_api) et le gestionnaire de console `core.iam_manual_action_create_host_account`,
--     lié à `CREATE_HOST_ACCOUNT` par le cadre d'US-101 (SECURITY DEFINER, iam_auth_owner,
--     EXECUTE au seul iam_staff_owner : garde de liaison d'ADR-092) ;
--   - particuliers seulement (DEC-FONDATEUR-13, BR-ACC-06) : toute demande qui n'est pas celle
--     d'une personne physique est refusée (`HOST_ENTITY_NOT_ALLOWED`) ; l'organisation ne porte
--     aucune raison sociale : son nom affiché est le PRÉNOM légal du titulaire, recopié par la
--     commande, jamais une saisie (minimisation, PROPOSÉ) ; aucun numéro fiscal à l'ouverture
--     (`tax_id` NULL : vérification de l'hôte, US-123) ;
--   - une personne, un compte d'hôte par pays (UQ `(country_code, holder_user_id)` de 0010 ; 17
--     §2.3 : deux pays = deux comptes) : une seconde demande dans le même pays rend
--     `HOST_ACCOUNT_EXISTS`, quel que soit le statut du premier compte (PROPOSÉ) ;
--   - aucune limite de véhicules (DEC-FONDATEUR-19) : rien n'est compté ici ;
--   - le compte n'est jamais ouvert `ACTIVE` : l'activation reste la règle de 17 §2.4
--     (vérification `APPROVED`, sous-marchand `ACTIVE`, interrupteurs du pays ; US-123). Un compte
--     non `ACTIVE` ne reçoit aucune réservation (`hold_host_not_active` de 0037,
--     `HOST_NOT_ACTIVATED`) ;
--   - âge (OQ-P2P-01, défaut 21 ans : `host_min_age_years[pays]`) : refusé si la date de
--     naissance connue est trop récente (`HOST_UNDER_AGE`) ; paramètre absent : refus
--     (`PARAM_MISSING`, fail-closed) ; date de naissance inconnue (aucune commande ne l'écrit
--     avant le KYC) : le compte s'ouvre `ONBOARDING` et l'âge est revérifié à la vérification
--     (US-123) avant toute activation (PROPOSÉ) ;
--   - compte de la personne `ACTIVE` exigé (e-mail vérifié, ni restreint, ni fermé, ni banni) :
--     sinon `HOST_ACCOUNT_NOT_ELIGIBLE` (OQ-P2P-01 « compte vérifié », PROPOSÉ) ;
--   - action de console : sujet `USER_ACCOUNT` (la personne inscrite, à sa demande, 17 §10),
--     pays du compte d'hôte = pays du compte de la personne (`core.ctr_account_country`, celui de
--     sa dernière acceptation des CGU) ; sans pays déclaré, le résolveur ne rend rien et la
--     console refuse (FORBIDDEN, journalisé) : la personne ouvre alors son compte en libre-service
--     (PROPOSÉ). Permission `ops.review_listing_host` (17 §10) ; aucune saisie (`input` vide).
--
-- Retour arrière :
--   DELETE FROM core.support_manual_action_handler WHERE action_code = 'CREATE_HOST_ACCOUNT';
--   DELETE FROM core.support_manual_action_catalog WHERE action_code = 'CREATE_HOST_ACCOUNT';
--   DELETE FROM core.support_manual_action_subject WHERE subject_type = 'USER_ACCOUNT';
--   contrainte manual_action_catalog_subject_valid de 0060 ;
--   DROP FUNCTION core.iam_manual_action_create_host_account(bytea, uuid, text, uuid, jsonb, text,
--     uuid, text), core.iam_cmd_open_host_account(bytea, text, text), core.iam_host_accounts(bytea),
--     core.iam_host_open_account(uuid, text, text, uuid, text, text, uuid, text),
--     core.support_country_of_user_account(uuid);
--   DROP POLICY iam_auth_select, iam_auth_insert ON core.iam_organization, core.iam_membership ;
--   DROP POLICY iam_auth_host_read ON core.config_param_value ;
--   DROP POLICY iam_auth_host_insert ON core.audit_audit_log ;
--   DROP POLICY iam_staff_select ON core.contract_consent ;
--   révoquer les droits accordés ci-dessous.

-- 1. Droits d'iam_auth_owner (propriétaire des commandes du compte d'hôte) ------------------------
-- Lecture de la personne (statut, prénom légal, date de naissance), du pays et du paramètre d'âge ;
-- écriture de l'organisation et de l'appartenance titulaire, au statut d'ouverture SEULEMENT.
GRANT SELECT (id, status, legal_first_name, date_of_birth, pseudonymized_at)
  ON core.iam_user_account TO iam_auth_owner;
GRANT SELECT (code, time_zone) ON core.config_country TO iam_auth_owner;
GRANT SELECT (key, country_code, scope_type, value, valid_from, valid_to)
  ON core.config_param_value TO iam_auth_owner;
CREATE POLICY iam_auth_host_read ON core.config_param_value FOR SELECT TO iam_auth_owner
  USING (key = 'host_min_age_years');

GRANT SELECT (id, kind, holder_user_id, country_code, display_name, status)
  ON core.iam_organization TO iam_auth_owner;
GRANT INSERT (id, kind, holder_user_id, country_code, display_name, status, created_by, updated_by)
  ON core.iam_organization TO iam_auth_owner;
CREATE POLICY iam_auth_select ON core.iam_organization FOR SELECT TO iam_auth_owner USING (true);
-- une ouverture : personne physique, statut ONBOARDING, aucun numéro fiscal ni plan ni entité
CREATE POLICY iam_auth_insert ON core.iam_organization FOR INSERT TO iam_auth_owner
  WITH CHECK (kind = 'P2P_HOST_INDIVIDUAL' AND status = 'ONBOARDING' AND tax_id IS NULL
              AND plan_code IS NULL AND legal_entity_id IS NULL);

GRANT SELECT (id, user_id, org_id, role, status) ON core.iam_membership TO iam_auth_owner;
GRANT INSERT (id, user_id, org_id, role, status, created_by, updated_by)
  ON core.iam_membership TO iam_auth_owner;
CREATE POLICY iam_auth_select ON core.iam_membership FOR SELECT TO iam_auth_owner USING (true);
-- le titulaire seulement (les co-hôtes viendront avec FLT-001, P1)
CREATE POLICY iam_auth_insert ON core.iam_membership FOR INSERT TO iam_auth_owner
  WITH CHECK (role = 'P2P_HOST' AND status = 'ACTIVE'
              AND pg_catalog.cardinality(vehicle_scope) = 0
              AND pg_catalog.cardinality(permission_overrides) = 0);

-- journal d'audit : l'ouverture d'un compte d'hôte seulement (la chaîne attribue id, at, hachages)
GRANT INSERT (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after,
              reason, request_id)
  ON core.audit_audit_log TO iam_auth_owner;
CREATE POLICY iam_auth_host_insert ON core.audit_audit_log FOR INSERT TO iam_auth_owner
  WITH CHECK (action_code = 'HOST_ACCOUNT_OPENED' AND subject_type = 'ORGANIZATION');

-- 2. Commande de domaine (SECURITY INVOKER : droits d'iam_auth_owner, ses seuls appelants) --------
-- Issues : DONE (compte ouvert, org_id), HOST_ENTITY_NOT_ALLOWED, COUNTRY_UNKNOWN,
-- HOST_ACCOUNT_NOT_ELIGIBLE, PARAM_MISSING, HOST_UNDER_AGE, HOST_ACCOUNT_EXISTS. Aucune erreur
-- pour un refus métier : l'appelant décide de sa réponse (HTTP ou console) ; rien n'est écrit.
-- Deux demandes concurrentes de la même personne dans le même pays sont sérialisées (verrou
-- consultatif de transaction) : la seconde voit le compte de la première (HOST_ACCOUNT_EXISTS).
CREATE FUNCTION core.iam_host_open_account(p_user uuid, p_country text, p_holder_kind text,
                                           p_actor uuid, p_actor_role text, p_source text,
                                           p_request_id uuid, p_reason text)
  RETURNS TABLE (outcome text, org_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    record;
  v_tz      text;
  v_min_age integer;
  v_today   date;
  v_org     uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF p_user IS NULL OR p_country IS NULL OR p_actor IS NULL OR p_actor_role IS NULL
     OR p_source IS NULL OR p_source NOT IN ('SELF_SERVICE', 'CONSOLE') THEN
    RAISE EXCEPTION 'compte d''hôte : demande invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- particuliers seulement : la demande déclare une personne physique (DEC-FONDATEUR-13)
  IF p_holder_kind IS DISTINCT FROM 'INDIVIDUAL' THEN
    RETURN QUERY SELECT 'HOST_ENTITY_NOT_ALLOWED'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = p_country;
  IF v_tz IS NULL THEN
    RETURN QUERY SELECT 'COUNTRY_UNKNOWN'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT u.id, u.status, u.legal_first_name, u.date_of_birth, u.pseudonymized_at INTO v_user
    FROM core.iam_user_account AS u WHERE u.id = p_user;
  IF v_user.id IS NULL OR v_user.status <> 'ACTIVE' OR v_user.pseudonymized_at IS NOT NULL THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_NOT_ELIGIBLE'::text, NULL::uuid;
    RETURN;
  END IF;
  -- âge minimal du pays (OQ-P2P-01) : paramètre en vigueur à platform.now(), entier attendu
  WITH t AS (SELECT platform.now() AS ts)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number' AND (v.value #>> '{}') ~ '^[0-9]{1,3}$'
              THEN (v.value #>> '{}')::integer END
    INTO v_min_age
    FROM core.config_param_value AS v CROSS JOIN t
   WHERE v.key = 'host_min_age_years' AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY' AND v.valid_from <= t.ts
     AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1;
  IF v_min_age IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid;
    RETURN;
  END IF;
  -- date du jour au fuseau du pays ; une date de naissance inconnue est revérifiée au KYC (US-123)
  v_today := (platform.now() AT TIME ZONE v_tz)::date;
  IF v_user.date_of_birth IS NOT NULL
     AND v_user.date_of_birth > v_today - pg_catalog.make_interval(years => v_min_age) THEN
    RETURN QUERY SELECT 'HOST_UNDER_AGE'::text, NULL::uuid;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('iam.host_account:' || p_user::text || ':' || p_country, 0));
  -- une personne, un compte d'hôte par pays, quel qu'en soit le statut (BR-ACC-06, 17 §2.3)
  IF EXISTS (SELECT 1 FROM core.iam_organization AS o
              WHERE o.holder_user_id = p_user AND o.country_code = p_country) THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_EXISTS'::text, NULL::uuid;
    RETURN;
  END IF;

  -- nom affiché aux voyageurs : le prénom légal du titulaire, jamais une saisie ni une raison sociale
  INSERT INTO core.iam_organization (id, kind, holder_user_id, country_code, display_name, status,
                                     created_by, updated_by)
  VALUES (v_org, 'P2P_HOST_INDIVIDUAL', p_user, p_country,
          pg_catalog.btrim(v_user.legal_first_name), 'ONBOARDING', p_actor, p_actor);
  INSERT INTO core.iam_membership (id, user_id, org_id, role, status, created_by, updated_by)
  VALUES (pg_catalog.gen_random_uuid(), p_user, v_org, 'P2P_HOST', 'ACTIVE', p_actor, p_actor);
  -- audit : jamais le nom affiché (C2) ; le pays porte la portée de lecture du journal du staff
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after, reason, request_id)
  VALUES (p_actor, p_actor_role, 'HOST_ACCOUNT_OPENED', 'ORGANIZATION', v_org, NULL,
          pg_catalog.jsonb_build_object('country', p_country, 'countries', pg_catalog.jsonb_build_array(p_country),
                                        'holderUserId', p_user, 'source', p_source,
                                        'status', 'ONBOARDING', 'kind', 'P2P_HOST_INDIVIDUAL'),
          NULLIF(pg_catalog.left(pg_catalog.btrim(p_reason), 1000), ''), p_request_id);
  RETURN QUERY SELECT 'DONE'::text, v_org;
END
$fn$;
COMMENT ON FUNCTION core.iam_host_open_account(uuid, text, text, uuid, text, text, uuid, text) IS
  'Ouverture d''un compte d''hôte (organization P2P_HOST_INDIVIDUAL ONBOARDING + membership '
  'P2P_HOST titulaire + audit) : personne physique, une par pays, compte ACTIVE, âge du pays. '
  'Appelée sous iam_auth_owner par le libre-service et la console. US-107 (ADR-096).';
REVOKE ALL ON FUNCTION core.iam_host_open_account(uuid, text, text, uuid, text, text, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_host_open_account(uuid, text, text, uuid, text, text, uuid, text)
  TO iam_auth_owner;

-- 3. Libre-service (SECURITY DEFINER, iam_auth_owner, EXECUTE au seul app_api) -------------------
-- La personne est celle de la session (empreinte du jeton) ; session invalide : AUTH_REQUIRED.
CREATE FUNCTION core.iam_cmd_open_host_account(p_token_hash bytea, p_country text,
                                               p_holder_kind text)
  RETURNS TABLE (outcome text, org_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_country IS NULL OR p_country !~ '^[A-Z]{2}$' THEN
    RETURN QUERY SELECT 'COUNTRY_UNKNOWN'::text, NULL::uuid;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT r.outcome, r.org_id
      FROM core.iam_host_open_account(v_user, p_country, p_holder_kind, v_user, 'GUEST',
                                      'SELF_SERVICE', NULL, NULL) AS r;
END
$fn$;

-- Comptes d'hôte du titulaire de la session (rôle P2P_HOST à la reconnexion, 19 US-107) : ses
-- seules appartenances titulaires ACTIVE ; jamais un compte d'un autre. Session invalide : 0 ligne.
CREATE FUNCTION core.iam_host_accounts(p_token_hash bytea)
  RETURNS TABLE (org_id uuid, country_code text, role text, org_status text, display_name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.id, o.country_code, m.role, o.status, o.display_name
    FROM core.iam_session_resolve(p_token_hash) AS s
    JOIN core.iam_membership AS m ON m.user_id = s.user_id
    JOIN core.iam_organization AS o ON o.id = m.org_id AND o.holder_user_id = s.user_id
   WHERE m.role = 'P2P_HOST' AND m.status = 'ACTIVE'
   ORDER BY o.country_code, o.id
$fn$;

COMMENT ON FUNCTION core.iam_cmd_open_host_account(bytea, text, text) IS
  'Ouverture en libre-service du compte d''hôte de la personne de la session (aucun identifiant '
  'reçu du client). SECURITY DEFINER, EXECUTE app_api. US-107 (ADR-096).';
COMMENT ON FUNCTION core.iam_host_accounts(bytea) IS
  'Comptes d''hôte titulaires de la personne de la session (rôle P2P_HOST). SECURITY DEFINER, '
  'EXECUTE app_api. US-107 (ADR-096).';
REVOKE ALL ON FUNCTION core.iam_cmd_open_host_account(bytea, text, text),
  core.iam_host_accounts(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_cmd_open_host_account(bytea, text, text),
  core.iam_host_accounts(bytea) TO app_api;

-- 4. Action de console CREATE_HOST_ACCOUNT (cadre d'US-101, ADR-092) ------------------------------
-- 4.1 Type de sujet USER_ACCOUNT : la personne inscrite ; son pays est celui de son compte
-- (dernière acceptation des CGU, 0059). Contrainte du catalogue remplacée sous le même nom
-- (élargie, jamais restreinte).
ALTER TABLE core.support_manual_action_catalog DROP CONSTRAINT manual_action_catalog_subject_valid;
ALTER TABLE core.support_manual_action_catalog ADD CONSTRAINT manual_action_catalog_subject_valid
  CHECK (subject_type IN ('TRIP', 'ORGANIZATION', 'IDENTITY_VERIFICATION', 'LISTING',
                          'SUPPORT_CASE', 'PLATFORM_ADVANCE', 'INSURER_BORDEREAU', 'USER_ACCOUNT'));

GRANT SELECT (user_id, doc_kind, accepted, seq, country_code) ON core.contract_consent
  TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.contract_consent FOR SELECT TO iam_staff_owner USING (true);
GRANT EXECUTE ON FUNCTION core.ctr_account_country(uuid) TO iam_staff_owner;

CREATE FUNCTION core.support_country_of_user_account(p_id uuid)
  RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp
AS $fn$ SELECT core.ctr_account_country(p_id) $fn$;
COMMENT ON FUNCTION core.support_country_of_user_account(uuid) IS
  'Résolveur du type USER_ACCOUNT : pays du compte de la personne (core.ctr_account_country) ; '
  'NULL sans pays déclaré. US-107 (ADR-096).';
REVOKE ALL ON FUNCTION core.support_country_of_user_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_country_of_user_account(uuid) TO iam_staff_owner;

INSERT INTO core.support_manual_action_subject (subject_type, resolver, story)
VALUES ('USER_ACCOUNT', 'core.support_country_of_user_account(uuid)'::regprocedure, 'US-107');

-- 4.2 Catalogue : action d'état, permission de 17 §10, aucune saisie
INSERT INTO core.support_manual_action_catalog
       (action_code, permission_code, mode, subject_type, available, input_keys, input_values,
        requires_approval)
VALUES ('CREATE_HOST_ACCOUNT', 'ops.review_listing_host', 'DOMAIN_COMMAND', 'USER_ACCOUNT', false,
        '{}', '{}', false);

-- 4.3 Gestionnaire lié (signature imposée par support_manual_action_handler_check) : la personne
-- est le sujet ; le pays est relu par le même résolveur que la console ; l'acteur et son rôle
-- viennent du cadre (EXECUTE au seul iam_staff_owner : jamais forgeables par un rôle applicatif).
-- Issue DONE (ref_id = compte d'hôte) ou le code du refus métier (la console rend REFUSED).
CREATE FUNCTION core.iam_manual_action_create_host_account(p_token_hash bytea, p_action_id uuid,
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
  v_country text;
  v_r       record;
BEGIN
  IF p_action_code IS DISTINCT FROM 'CREATE_HOST_ACCOUNT' OR p_subject_id IS NULL
     OR p_actor IS NULL OR p_actor_role IS NULL THEN
    RAISE EXCEPTION 'compte d''hôte : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_country := core.ctr_account_country(p_subject_id);
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'COUNTRY_UNKNOWN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- le sujet est un compte de personne inscrite : une personne physique par construction
  SELECT r.outcome, r.org_id INTO v_r
    FROM core.iam_host_open_account(p_subject_id, v_country, 'INDIVIDUAL', p_actor, p_actor_role,
                                    'CONSOLE', p_action_id, p_reason) AS r;
  RETURN QUERY SELECT v_r.outcome, v_r.org_id, '{}'::uuid[];
END
$fn$;
COMMENT ON FUNCTION core.iam_manual_action_create_host_account(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à CREATE_HOST_ACCOUNT (cadre d''US-101) : ouverture du compte d''hôte de la '
  'personne sujet, mêmes règles que le libre-service. EXECUTE iam_staff_owner. US-107 (ADR-096).';
REVOKE ALL ON FUNCTION core.iam_manual_action_create_host_account(bytea, uuid, text, uuid, jsonb,
                                                                  text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_manual_action_create_host_account(bytea, uuid, text, uuid, jsonb,
                                                                     text, uuid, text) TO iam_staff_owner;

-- Propriétaire NOLOGIN (mécanique de 0059 : CREATE le temps du transfert seulement).
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
ALTER FUNCTION core.iam_cmd_open_host_account(bytea, text, text) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_host_accounts(bytea) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_manual_action_create_host_account(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO iam_auth_owner;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;

-- 4.4 Liaison (garde d'ADR-092 au moment de l'INSERT : signature, SECURITY DEFINER, propriétaire
-- NOLOGIN autre qu'iam_staff_owner, EXECUTE à iam_staff_owner et à aucun rôle applicatif)
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('CREATE_HOST_ACCOUNT',
        'core.iam_manual_action_create_host_account(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-107');
