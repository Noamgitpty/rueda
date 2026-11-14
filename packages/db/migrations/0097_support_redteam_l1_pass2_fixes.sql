-- 0097 — SUP / STL / RISK / KYC / AUD / BKG / CAT : correctifs de la passe n° 2 de la red team du lot 1.
-- US-122 ; rapport docs/team/redteam/L1-passe2.md (constats F2-C-01 à C-05, F2-A03-01, F2-D-01 à
-- D-03, F2-U-02, F2-T-01, F2-T-02 ; F2-U-01 est corrigé dans l'API) ; 17 §2.3 (« un agent ne
-- décide pas sur son propre dossier », RLS-24), §5, §10 ; 16 ADM-001, ADM-005, VER-004, LEG-009,
-- HST-012 ; 08 BR-ACC-06, BR-TRUST-09 ; ADR-122 (garde unique), ADR-124 (cette migration,
-- PROPOSÉ). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-124, PROPOSÉS) :
--   1. la garde UNIQUE `core.support_actor_conflict` (ADR-122) est appelée par TOUTES les entrées
--      de la console qui prennent, lisent ou décident un sujet : prise d'un élément de file (toutes
--      files), dossier KYC, dossier d'hôte, constat de comptes liés, actions FINANCE à deux
--      personnes (demande ET approbation, aucun montant touché) ; issue SELF_FORBIDDEN, journalisée.
--      Personnes d'un sujet : pour USER_ACCOUNT et IDENTITY_VERIFICATION, aussi le titulaire et les
--      membres de tous les comptes d'hôte de la personne (F2-C-05) ; RISK_ASSESSMENT jugé ;
--   2. droits des personnes : une demande gelée passée son échéance est signalée en retard ; un
--      effacement KYC refusé (FAILED) est repris (nouveau retrait, ou commande de la personne) ;
--      aucun hold après le retrait du consentement biométrique ;
--   3. téléversements : taille d'une photo, photos d'une galerie et dépôts de pièces par minute
--      bornés par pays (graine 0098 ; absent ou mal formé : refus) ;
--   4. hôte défaillant : la fiche 360° liste les trips à venir de ses comptes d'hôte (sans le
--      voyageur) ; la pose d'une restriction prévient chaque voyageur d'un trip à venir ;
--   5. doublon d'identité d'hôte (comme Turo, sans étape de plus) : la même personne qu'un hôte
--      déjà approuvé n'est jamais approuvée, ni par l'ops ni automatiquement ; revue de l'ops par
--      le constat de comptes liés.
--
-- Expand / contract : fonctions, droits et politiques ajoutés ; corps remplacés à signature,
-- propriétaire et droits identiques (chaque définition reprise est recopiée à l'identique, seuls
-- les blocs marqués US-122 changent). Le COMPORTEMENT se resserre volontairement. La version N de
-- l'API traduit une issue inconnue en refus (FORBIDDEN, LISTING_UNAVAILABLE), sans rien écrire.
--
-- Retour arrière :
--   réappliquer core.support_staff_claim_item de 0064, core.support_staff_kyc_dossier et
--     core.support_staff_profile de 0076, core.support_staff_host_dossier de 0081,
--     core.risk_staff_decide_account_link de 0080, core.support_subject_parties,
--     core.support_staff_vehicle_item et core.support_staff_catalog_item de 0093 (sous
--     iam_staff_owner) ; core.settlement_cmd_request_finance_action et
--     core.settlement_cmd_approve_finance_action de 0036 (sous cmd_money_owner) ;
--     core.privacy_worker_dsr_overdue de 0090 (sous privacy_cmd_owner) ;
--     core.kyc_cmd_biometric_consent de 0072, core.kyc_manual_action_host_verification_decision de
--     0075, core.kyc_host_auto_approve de 0081 (sous kyc_cmd_owner) ; core.booking_cmd_place_hold
--     de 0080 (sous cmd_hold_owner) ; core.catalog_cmd_add_listing_photo de 0067 et
--     core.catalog_cmd_add_vehicle_document de 0077 (sous catalog_cmd_owner) ;
--     core.iam_manual_action_restriction de 0064 (sous iam_auth_owner) ;
--   DROP FUNCTION core.support_staff_conflict(uuid, text, uuid), core.support_person_people(uuid),
--     core.kyc_cmd_retry_erasure(bytea, uuid), core.kyc_consent_withdrawn(uuid),
--     core.booking_notify_host_restricted(uuid, uuid, text, uuid),
--     core.kyc_host_identity_duplicate(uuid) ;
--   DROP POLICY iam_staff_party_read ON core.risk_assessment ; DROP POLICY kyc_cmd_erasure_reopen
--     ON core.kyc_erasure_request ; DROP POLICY catalog_cmd_upload_read ON
--     core.config_param_definition, core.config_param_value ; DROP POLICY cmd_hold_trip_notice_ins
--     ON core.outbox_outbox_event ; DROP POLICY risk_host_duplicate_read ON
--     core.kyc_host_verification ; révoquer les droits accordés ci-dessous ;
--   graine 0098 : voir son en-tête.

-- 1. Séparation des tâches : la garde unique d'ADR-122 sur toutes les entrées de la console ------
-- 1.1 Lectures d'iam_staff_owner : sujet d'une évaluation de risque (colonnes d'identifiants)
GRANT SELECT (id, subject_type, subject_id, org_id) ON core.risk_assessment TO iam_staff_owner;
CREATE POLICY iam_staff_party_read ON core.risk_assessment FOR SELECT TO iam_staff_owner
  USING (true);

-- 1.2 Personnes d'un sujet (sous iam_staff_owner, SECURITY INVOKER, EXECUTE à personne)
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Personnes liées à une personne par un compte d'hôte (F2-C-05) : elle-même, et le titulaire et
-- les membres ACTIVE / INVITED de tous les comptes d'hôte dont elle est titulaire ou membre (tous
-- pays). Personne absente : aucune.
CREATE FUNCTION core.support_person_people(p_user uuid)
  RETURNS uuid[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT ARRAY(
    SELECT p_user WHERE p_user IS NOT NULL
    UNION
    SELECT x.user_id
      FROM (SELECT o.id FROM core.iam_organization AS o WHERE o.holder_user_id = p_user
            UNION
            SELECT m.org_id FROM core.iam_membership AS m
             WHERE m.user_id = p_user AND m.status IN ('ACTIVE', 'INVITED')) AS a(org_id)
      CROSS JOIN LATERAL pg_catalog.unnest(core.support_org_people(a.org_id)) AS x(user_id))
$fn$;

-- Personnes concernées par un sujet de la console ; NULL = type inconnu (conflit présumé).
-- Définition de 0093, deux changements marqués US-122 (ADR-124) : USER_ACCOUNT et
-- IDENTITY_VERIFICATION comptent aussi les comptes d'hôte de la personne (F2-C-05) ;
-- RISK_ASSESSMENT (file RISK_BOOKING) est jugé (F2-C-01 : la prise d'un élément est gardée dans
-- toutes les files).
CREATE OR REPLACE FUNCTION core.support_subject_parties(p_subject_type text, p_subject_id uuid)
  RETURNS uuid[]
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  IF p_subject_type IS NULL OR p_subject_id IS NULL THEN
    RETURN NULL;
  END IF;
  CASE p_subject_type
    WHEN 'USER_ACCOUNT' THEN
      -- US-122 (F2-C-05) : la personne et les personnes de ses comptes d'hôte
      RETURN core.support_person_people(p_subject_id);
    WHEN 'IDENTITY_VERIFICATION' THEN
      -- US-122 (F2-C-05) : idem pour la personne vérifiée
      RETURN core.support_person_people(
               (SELECT v.user_id FROM core.kyc_identity_verification AS v WHERE v.id = p_subject_id));
    WHEN 'ORGANIZATION' THEN
      RETURN core.support_org_people(p_subject_id);
    WHEN 'LISTING' THEN
      SELECT l.org_id INTO r FROM core.catalog_listing AS l WHERE l.id = p_subject_id;
      RETURN core.support_org_people(r.org_id);
    WHEN 'VEHICLE' THEN
      SELECT x.org_id INTO r FROM core.catalog_vehicle AS x WHERE x.id = p_subject_id;
      RETURN core.support_org_people(r.org_id);
    WHEN 'VEHICLE_CLAIM' THEN
      SELECT c.org_id, c.claimant_user_id, x.org_id AS target_org INTO r
        FROM core.catalog_vehicle_claim AS c
        LEFT JOIN core.catalog_vehicle AS x ON x.id = c.target_vehicle_id
       WHERE c.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.claimant_user_id], NULL)
             || core.support_org_people(r.org_id) || core.support_org_people(r.target_org);
    WHEN 'CATALOG_ADDITION_REQUEST' THEN
      SELECT a.org_id, a.requested_by INTO r
        FROM core.catalog_addition_request AS a WHERE a.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.requested_by], NULL) || core.support_org_people(r.org_id);
    WHEN 'TRIP' THEN
      SELECT t.guest_user_id, t.org_id INTO r FROM core.booking_trip AS t WHERE t.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.guest_user_id], NULL) || core.support_org_people(r.org_id);
    WHEN 'SUPPORT_CASE' THEN
      SELECT c.requester_user_id, c.trip_id INTO r
        FROM core.support_support_case AS c WHERE c.id = p_subject_id;
      RETURN pg_catalog.array_remove(ARRAY[r.requester_user_id], NULL)
             || CASE WHEN r.trip_id IS NULL THEN '{}'::uuid[]
                     ELSE COALESCE(core.support_subject_parties('TRIP', r.trip_id), '{}'::uuid[]) END;
    WHEN 'PLATFORM_ADVANCE' THEN
      SELECT a.org_id, a.trip_id INTO r
        FROM core.settlement_platform_advance AS a WHERE a.id = p_subject_id;
      RETURN core.support_org_people(r.org_id)
             || CASE WHEN r.trip_id IS NULL THEN '{}'::uuid[]
                     ELSE COALESCE(core.support_subject_parties('TRIP', r.trip_id), '{}'::uuid[]) END;
    WHEN 'RISK_ASSESSMENT' THEN
      -- US-122 (F2-C-01) : compte d'hôte de l'évaluation et son sujet (personne ou trip) ; un sujet
      -- d'une autre sorte (HOLD : aucune évaluation n'en porte au lot 1) : conflit présumé
      SELECT a.subject_type, a.subject_id, a.org_id INTO r
        FROM core.risk_assessment AS a WHERE a.id = p_subject_id;
      IF r.subject_type IS NULL THEN
        RETURN '{}'::uuid[];
      ELSIF r.subject_type = 'USER' THEN
        RETURN core.support_org_people(r.org_id) || core.support_person_people(r.subject_id);
      ELSIF r.subject_type = 'TRIP' THEN
        RETURN core.support_org_people(r.org_id)
               || COALESCE(core.support_subject_parties('TRIP', r.subject_id), '{}'::uuid[]);
      END IF;
      RETURN NULL;
    WHEN 'INSURER_BORDEREAU' THEN
      RETURN '{}'::uuid[];
    ELSE
      RETURN NULL;
  END CASE;
END
$fn$;

-- Garde unique appelée depuis un autre propriétaire (cmd_money_owner, actions FINANCE) : même
-- jugement que core.support_actor_conflict, lu sous iam_staff_owner. SECURITY DEFINER, EXECUTE à
-- cmd_money_owner seulement (aucun rôle applicatif).
CREATE FUNCTION core.support_staff_conflict(p_actor uuid, p_subject_type text, p_subject_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.support_actor_conflict(p_actor, p_subject_type, p_subject_id)
$fn$;
COMMENT ON FUNCTION core.support_person_people(uuid) IS
  'Personne et personnes de ses comptes d''hôte (titulaire ou membre ; titulaires et membres '
  'ACTIVE / INVITED). Aide interne sous iam_staff_owner. US-122 (ADR-124, F2-C-05).';
COMMENT ON FUNCTION core.support_subject_parties(text, uuid) IS
  'Personnes concernées par un sujet de la console (NULL : type inconnu) ; personne et '
  'vérification d''identité : aussi les personnes de ses comptes d''hôte. Aide interne sous '
  'iam_staff_owner. US-122 (ADR-122, ADR-124).';
COMMENT ON FUNCTION core.support_staff_conflict(uuid, text, uuid) IS
  'Garde de séparation des tâches (core.support_actor_conflict) pour un autre propriétaire de '
  'commande (cmd_money_owner). SECURITY DEFINER, aucun rôle applicatif. US-122 (ADR-124, F2-C-04).';
REVOKE ALL ON FUNCTION core.support_person_people(uuid), core.support_staff_conflict(uuid, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_conflict(uuid, text, uuid) TO cmd_money_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 1.3 Entrées de la console sous iam_staff_owner (définitions de 0064, 0076, 0081, 0080 et
-- 0093 recopiées à l'identique ; seuls les blocs marqués US-122 (ADR-124) changent) -------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;
CREATE OR REPLACE FUNCTION core.support_staff_claim_item(p_token_hash bytea, p_request_id uuid, p_item_id uuid)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_item record;
  v_role text;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'files : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'REVIEW_ITEM_CLAIM'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT i.id, i.queue, i.country_code, i.status, i.assignee_id, q.permission_code,
         i.subject_type, i.subject_id INTO v_item
    FROM core.support_review_queue_item AS i
    JOIN core.support_review_queue AS q ON q.queue = i.queue
   WHERE i.id = p_item_id
   FOR UPDATE OF i;
  IF v_item.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, v_item.permission_code,
                                       ARRAY[v_item.country_code], NULL);
  END IF;
  IF v_role IS NULL OR v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_item.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        WHEN v_role IS NULL THEN 'PERMISSION' ELSE 'CLOSED' END,
                                   'attempted', 'REVIEW_ITEM_CLAIM')
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  -- US-122 (ADR-124, F2-C-01, F2-C-02) : jamais la prise d'un élément qui concerne l'agent
  -- (garde unique d'ADR-122), quelle que soit la file ; refus journalisé, aucun effet
  IF core.support_actor_conflict(v_s.user_id, v_item.subject_type, v_item.subject_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_FORBIDDEN', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF',
                                   'attempted', 'REVIEW_ITEM_CLAIM', 'country', v_item.country_code,
                                   'guard', 'SEPARATION_OF_DUTIES'), NULL, p_request_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_item.assignee_id IS NOT NULL AND v_item.assignee_id <> v_s.user_id THEN
    RETURN QUERY SELECT 'TAKEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_item.assignee_id IS NULL THEN
    UPDATE core.support_review_queue_item AS i
       SET status = 'IN_REVIEW', assignee_id = v_s.user_id, assigned_at = platform.now(),
           updated_by = v_s.user_id
     WHERE i.id = p_item_id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'REVIEW_ITEM_CLAIMED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('country', v_item.country_code,
                                   'queue', v_item.queue), NULL, p_request_id);
  END IF;
  RETURN QUERY SELECT 'CLAIMED'::text, pg_catalog.jsonb_build_object('itemId', p_item_id);
END
$fn$;
CREATE OR REPLACE FUNCTION core.support_staff_kyc_dossier(p_token_hash bytea, p_request_id uuid,
                                                          p_item_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_item    record;
  v_role    text;
  v_reason  text;
  v_access  uuid;
  v_user    record;
  v_kyc     jsonb;
  v_purpose text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR v_purpose IS NULL
     OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'dossier KYC : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id
    INTO v_item
    FROM core.support_review_queue_item AS i WHERE i.id = p_item_id;
  IF v_item.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'kyc.read_sensitive',
                                       ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'CASE'
    WHEN v_item.queue <> 'KYC' OR v_item.subject_type <> 'USER_ACCOUNT' THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    -- pays de l'élément = pays de la personne (revue sécurité US-109, n° 3)
    WHEN core.ctr_account_country(v_item.subject_id) IS DISTINCT FROM v_item.country_code
      THEN 'COUNTRY'
    -- US-122 (ADR-124, F2-C-01, F2-C-02) : jamais le dossier d'un sujet qui concerne l'agent
    WHEN core.support_actor_conflict(v_s.user_id, v_item.subject_type, v_item.subject_id)
      THEN 'SELF'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive',
                                   'access_kind', 'READ_C3', 'field_or_file', 'kyc_dossier')
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 v_purpose, p_request_id);
    -- permission détenue mais élément hors file KYC, clos ou non assigné : CASE_REQUIRED ;
    -- pays discordant : FORBIDDEN
    RETURN QUERY SELECT CASE WHEN v_reason = 'SELF' THEN 'SELF_FORBIDDEN'
                             WHEN v_role IS NOT NULL AND v_reason <> 'COUNTRY' THEN 'CASE_REQUIRED'
                             ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  -- journal D'ABORD (même instruction : sans journal, pas de donnée)
  v_access := core.support_staff_log_access(v_s.user_id, v_role, 'USER_ACCOUNT', v_item.subject_id,
                                            'kyc_dossier', 'READ_C3', v_purpose,
                                            'item:' || p_item_id::text, p_request_id,
                                            v_item.country_code);
  SELECT u.legal_first_name, u.legal_last_name, u.date_of_birth, u.residence_country,
         u.pseudonymized_at
    INTO v_user
    FROM core.iam_user_account AS u WHERE u.id = v_item.subject_id;
  -- US-106 : vérification courante (seule lecture des tables KYC par le staff, ADR-106)
  v_kyc := core.kyc_staff_dossier(v_item.subject_id);
  RETURN QUERY SELECT 'GRANTED'::text, pg_catalog.jsonb_build_object(
    'itemId', p_item_id, 'userId', v_item.subject_id, 'country', v_item.country_code,
    'accessId', v_access, 'kycStatus', v_kyc ->> 'status',
    'verification', v_kyc -> 'verification',
    'pseudonymized', v_user.pseudonymized_at IS NOT NULL,
    'legalFirstName', v_user.legal_first_name, 'legalLastName', v_user.legal_last_name,
    'dateOfBirth', v_user.date_of_birth, 'residenceCountry', v_user.residence_country);
END
$fn$;
CREATE OR REPLACE FUNCTION core.support_staff_host_dossier(p_token_hash bytea, p_request_id uuid,
                                                p_item_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s        record;
  v_item     record;
  v_role     text;
  v_reason   text;
  v_access   uuid;
  v_dossier  jsonb;
  v_evidence uuid[];
  v_purpose  text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR v_purpose IS NULL
     OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'dossier de l''hôte : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS',
                                   'permission', 'ops.review_listing_host'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id
    INTO v_item
    FROM core.support_review_queue_item AS i WHERE i.id = p_item_id;
  IF v_item.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'ops.review_listing_host',
                                       ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'CASE'
    WHEN v_item.queue <> 'HOST_VERIFICATION' OR v_item.subject_type <> 'ORGANIZATION' THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN core.support_country_of_organization(v_item.subject_id) IS DISTINCT FROM v_item.country_code
      THEN 'COUNTRY'
    -- US-122 (ADR-124, F2-C-01, F2-C-02) : jamais le dossier d'un sujet qui concerne l'agent
    WHEN core.support_actor_conflict(v_s.user_id, v_item.subject_type, v_item.subject_id)
      THEN 'SELF'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', 'DATA_ACCESS',
                                   'permission', 'ops.review_listing_host',
                                   'access_kind', 'READ_C2_SUPPORT', 'field_or_file', 'host_dossier')
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_reason = 'SELF' THEN 'SELF_FORBIDDEN'
                             WHEN v_role IS NOT NULL AND v_reason <> 'COUNTRY' THEN 'CASE_REQUIRED'
                             ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  -- journal D'ABORD (même instruction : sans journal, pas de donnée)
  v_access := core.support_staff_log_access(v_s.user_id, v_role, 'ORGANIZATION', v_item.subject_id,
                                            'host_dossier', 'READ_C2_SUPPORT', v_purpose,
                                            'item:' || p_item_id::text, p_request_id,
                                            v_item.country_code);
  v_dossier := core.kyc_staff_host_dossier(v_item.subject_id);
  IF v_dossier -> 'screening' ->> 'manualActionId' IS NOT NULL THEN
    SELECT m.evidence_file_ids INTO v_evidence
      FROM core.support_manual_action AS m
     WHERE m.id = (v_dossier -> 'screening' ->> 'manualActionId')::uuid;
  END IF;
  RETURN QUERY SELECT 'GRANTED'::text,
    COALESCE(v_dossier, '{}'::jsonb)
    || pg_catalog.jsonb_build_object('itemId', p_item_id, 'accessId', v_access,
                                     'evidenceFileIds',
                                     pg_catalog.to_jsonb(COALESCE(v_evidence, '{}'::uuid[])));
END
$fn$;
CREATE OR REPLACE FUNCTION core.risk_staff_decide_account_link(p_token_hash bytea, p_request_id uuid,
                                                    p_user_a uuid, p_user_b uuid,
                                                    p_decision text, p_signal text)
  RETURNS TABLE (outcome text, link_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_low     uuid;
  v_high    uuid;
  v_c_low   text;
  v_c_high  text;
  v_role    text;
  v_why     text;
  v_link    record;
  v_id      uuid;
BEGIN
  IF p_request_id IS NULL OR p_user_a IS NULL OR p_user_b IS NULL OR p_user_a = p_user_b
     OR p_decision IS NULL OR p_decision NOT IN ('LINKED', 'NOT_LINKED')
     OR p_signal IS NULL OR p_signal NOT IN ('SAME_CARD', 'SAME_DEVICE', 'SAME_DRIVER_LICENSE',
                                             'SAME_IDENTITY', 'SAME_PHONE', 'OTHER') THEN
    RAISE EXCEPTION 'comptes liés : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_low  := LEAST(p_user_a, p_user_b);
  v_high := GREATEST(p_user_a, p_user_b);
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER', v_low, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'ACCOUNT_LINK_DECISION'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- pays des deux comptes, relus en base ; permission dans les DEUX ; jamais un lien qui concerne
  -- l'acteur lui-même
  v_c_low  := core.ctr_account_country(v_low);
  v_c_high := core.ctr_account_country(v_high);
  -- US-122 (ADR-124, F2-C-03) : ni l'un des deux comptes, ni une personne de l'un d'eux
  -- (co-hôte, membre d'un de ses comptes d'hôte) ou un compte lié (LINKED) à l'une d'elles
  IF v_s.user_id IN (v_low, v_high)
     OR core.support_actor_conflict(v_s.user_id, 'USER_ACCOUNT', v_low)
     OR core.support_actor_conflict(v_s.user_id, 'USER_ACCOUNT', v_high) THEN
    v_why := 'SELF';
  ELSIF v_c_low IS NULL OR v_c_high IS NULL THEN
    v_why := 'SUBJECT_NOT_FOUND';
  ELSE
    v_role := core.iam_staff_permitted(v_s.user_id, 'kyc.decide',
                                       ARRAY(SELECT DISTINCT c FROM pg_catalog.unnest(
                                               ARRAY[v_c_low, v_c_high]) AS c ORDER BY c),
                                       NULL);
    IF v_role IS NULL THEN
      v_why := 'PERMISSION';
    END IF;
  END IF;
  IF v_why IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN', 'USER',
                                 v_low, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_why,
                                   'attempted', 'ACCOUNT_LINK_DECISION')
                                 || CASE WHEN v_c_low IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_c_low) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;

  -- une ligne par paire : verrou de la paire, relecture, puis écriture
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'risk.account_link:' || v_low::text || ':' || v_high::text, 0));
  SELECT l.id, l.decision, l.signal INTO v_link
    FROM core.risk_account_link AS l
   WHERE l.user_low = v_low AND l.user_high = v_high
   FOR UPDATE;
  IF v_link.id IS NOT NULL AND v_link.decision = p_decision AND v_link.signal = p_signal THEN
    RETURN QUERY SELECT 'UNCHANGED'::text, v_link.id;
    RETURN;
  END IF;
  IF v_link.id IS NULL THEN
    v_id := pg_catalog.gen_random_uuid();
    INSERT INTO core.risk_account_link (id, user_low, user_high, decision, signal, decided_by,
                                        decided_at)
    VALUES (v_id, v_low, v_high, p_decision, p_signal, v_s.user_id, platform.now());
  ELSE
    v_id := v_link.id;
    UPDATE core.risk_account_link AS l
       SET decision = p_decision, signal = p_signal, decided_by = v_s.user_id,
           decided_at = platform.now()
     WHERE l.id = v_id;
  END IF;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'ACCOUNT_LINK_DECIDED', 'USER', v_low,
                               CASE WHEN v_link.id IS NULL THEN NULL
                                    ELSE pg_catalog.jsonb_build_object('decision', v_link.decision,
                                           'signal', v_link.signal) END,
                               pg_catalog.jsonb_build_object('country', v_c_low,
                                 'otherCountry', v_c_high, 'otherUser', v_high, 'linkId', v_id,
                                 'decision', p_decision, 'signal', p_signal),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'RECORDED'::text, v_id;
END
$fn$;
CREATE OR REPLACE FUNCTION core.support_staff_vehicle_item(p_user uuid, p_item_id uuid, p_subject_type text,
                                                p_attempted text, p_request_id uuid,
                                                OUT refusal text, OUT role text,
                                                OUT subject_id uuid, OUT country_code text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_item   record;
  v_reason text;
BEGIN
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id,
         q.permission_code
    INTO v_item
    FROM core.support_review_queue_item AS i
    JOIN core.support_review_queue AS q ON q.queue = i.queue
   WHERE i.id = p_item_id
     FOR UPDATE OF i;
  IF v_item.id IS NOT NULL THEN
    role := core.iam_staff_permitted(p_user, v_item.permission_code, ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'SUBJECT_NOT_FOUND'
    WHEN v_item.queue <> 'LISTING' OR v_item.subject_type <> p_subject_type THEN 'CASE'
    WHEN role IS NULL THEN 'PERMISSION'
    -- US-122 (ADR-124) : un sujet qui concerne l'agent est refusé comme tel avant tout
    -- contrôle de prise en charge (la prise de l'élément lui est refusée aussi)
    WHEN core.support_actor_conflict(p_user, v_item.subject_type, v_item.subject_id)
      THEN 'SELF'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM p_user THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(p_user, COALESCE(role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', p_attempted)
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 NULL, p_request_id);
    refusal := CASE WHEN v_reason = 'SELF' THEN 'SELF_FORBIDDEN'
                    WHEN role IS NOT NULL AND v_reason = 'CASE' THEN 'CASE_REQUIRED'
                    ELSE 'FORBIDDEN' END;
    RETURN;
  END IF;
  -- US-122 (ADR-122, F-L1-C-03) : jamais un élément dont le sujet concerne l'acteur (titulaire ou
  -- membre du compte, demandeur, compte du véhicule contesté, compte lié LINKED) ; journalisé
  IF core.support_actor_conflict(p_user, v_item.subject_type, v_item.subject_id) THEN
    PERFORM core.iam_staff_audit(p_user, role, 'STAFF_FORBIDDEN', 'REVIEW_QUEUE_ITEM', p_item_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF',
                                   'attempted', p_attempted, 'country', v_item.country_code),
                                 NULL, p_request_id);
    refusal := 'SELF_FORBIDDEN';
    RETURN;
  END IF;
  subject_id := v_item.subject_id;
  country_code := v_item.country_code;
END
$fn$;
CREATE OR REPLACE FUNCTION core.support_staff_catalog_item(p_user uuid, p_item_id uuid, p_attempted text,
                                                p_request_id uuid,
                                                OUT refusal text, OUT role text,
                                                OUT subject_id uuid, OUT country_code text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_item   record;
  v_reason text;
BEGIN
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id,
         q.permission_code
    INTO v_item
    FROM core.support_review_queue_item AS i
    JOIN core.support_review_queue AS q ON q.queue = i.queue
   WHERE i.id = p_item_id
     FOR UPDATE OF i;
  IF v_item.id IS NOT NULL THEN
    role := core.iam_staff_permitted(p_user, v_item.permission_code, ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'SUBJECT_NOT_FOUND'
    WHEN v_item.queue <> 'CATALOG_ADDITION' OR v_item.subject_type <> 'CATALOG_ADDITION_REQUEST'
      THEN 'CASE'
    WHEN role IS NULL THEN 'PERMISSION'
    -- US-122 (ADR-124) : un sujet qui concerne l'agent est refusé comme tel avant tout
    -- contrôle de prise en charge (la prise de l'élément lui est refusée aussi)
    WHEN core.support_actor_conflict(p_user, v_item.subject_type, v_item.subject_id)
      THEN 'SELF'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM p_user THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(p_user, COALESCE(role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', p_attempted)
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 NULL, p_request_id);
    refusal := CASE WHEN v_reason = 'SELF' THEN 'SELF_FORBIDDEN'
                    WHEN role IS NOT NULL AND v_reason = 'CASE' THEN 'CASE_REQUIRED'
                    ELSE 'FORBIDDEN' END;
    RETURN;
  END IF;
  -- US-122 (ADR-122, F-L1-C-03) : jamais un élément dont le sujet concerne l'acteur (titulaire ou
  -- membre du compte, demandeur, compte du véhicule contesté, compte lié LINKED) ; journalisé
  IF core.support_actor_conflict(p_user, v_item.subject_type, v_item.subject_id) THEN
    PERFORM core.iam_staff_audit(p_user, role, 'STAFF_FORBIDDEN', 'REVIEW_QUEUE_ITEM', p_item_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF',
                                   'attempted', p_attempted, 'country', v_item.country_code),
                                 NULL, p_request_id);
    refusal := 'SELF_FORBIDDEN';
    RETURN;
  END IF;
  subject_id := v_item.subject_id;
  country_code := v_item.country_code;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 1.4 Actions FINANCE à deux personnes sous cmd_money_owner (définitions de 0036 recopiées à
-- l'identique ; seuls les blocs marqués US-122 (ADR-124) changent ; aucun montant touché) -----
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;
CREATE OR REPLACE FUNCTION core.settlement_cmd_request_finance_action(p_token_hash bytea, p_request_id uuid,
                                                          p_action text, p_subject_id uuid,
                                                          p_reason text)
  RETURNS TABLE (outcome text, approval_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_perm    text;
  v_type    text;
  v_country text;
  v_role    text;
  v_why     text;
  v_prev    record;
  v_pending uuid;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('DECIDE_ADVANCE', 'WRITE_OFF_RECEIVABLE', 'ISSUE_BORDEREAU')
     OR p_request_id IS NULL OR p_subject_id IS NULL OR p_reason IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'finance : action, sujet ou motif invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_perm := CASE p_action WHEN 'ISSUE_BORDEREAU' THEN 'finance.insurer_bordereau'
                          ELSE 'finance.platform_advance' END;
  v_type := CASE p_action WHEN 'ISSUE_BORDEREAU' THEN 'INSURER_BORDEREAU' ELSE 'PLATFORM_ADVANCE' END;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', v_type, p_subject_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', p_action), p_reason, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- sujet ÉLIGIBLE et pays relus en base (jamais reçus du client)
  IF p_action = 'DECIDE_ADVANCE' THEN
    SELECT a.country_code INTO v_country FROM core.settlement_platform_advance AS a
     WHERE a.id = p_subject_id AND a.status = 'OPEN' AND a.decided_by IS NULL;
  ELSIF p_action = 'WRITE_OFF_RECEIVABLE' THEN
    SELECT a.country_code INTO v_country FROM core.settlement_platform_advance AS a
     WHERE a.id = p_subject_id AND a.status IN ('OPEN', 'RECOVERING')
       AND a.receivable_minor > a.recovered_minor;
  ELSE
    SELECT b.country_code INTO v_country FROM core.settlement_insurer_bordereau AS b
     WHERE b.id = p_subject_id AND b.status = 'DRAFT';
  END IF;
  IF v_country IS NULL THEN
    v_why := 'SUBJECT_NOT_FOUND';
  ELSE
    v_role := core.iam_staff_permitted(v_s.user_id, v_perm, ARRAY[v_country], NULL);
    IF v_role IS NULL OR NOT (v_country = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
      v_why := 'PERMISSION_OR_COUNTRY';
    END IF;
  END IF;
  IF v_why IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', v_type, p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_why, 'attempted', p_action,
                                   'permission', v_perm), p_reason, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- US-122 (ADR-124, F2-C-04) : jamais une décision FINANCE sur un sujet qui concerne le
  -- demandeur (titulaire, co-hôte du compte de l'avance, compte lié) ; refus journalisé, aucune
  -- écriture ; aucun montant n'est lu ni changé
  IF core.support_staff_conflict(v_s.user_id, v_type, p_subject_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_FORBIDDEN', v_type, p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF', 'attempted', p_action,
                                   'permission', v_perm, 'guard', 'SEPARATION_OF_DUTIES'),
                                 p_reason, p_request_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- idempotence par identifiant de demande
  SELECT f.id, f.action, f.subject_id, f.requested_by INTO v_prev
    FROM core.settlement_finance_approval AS f WHERE f.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.action = p_action AND v_prev.subject_id = p_subject_id AND v_prev.requested_by = v_s.user_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_prev.id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'finance : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT f.id INTO v_pending FROM core.settlement_finance_approval AS f
   WHERE f.action = p_action AND f.subject_id = p_subject_id AND f.status = 'PENDING';
  IF v_pending IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_PENDING'::text, v_pending;
    RETURN;
  END IF;
  -- aucun effet d'argent : la demande seule
  INSERT INTO core.settlement_finance_approval (id, action, subject_id, country_code, reason,
                                                requested_by, status)
  VALUES (p_request_id, p_action, p_subject_id, v_country, pg_catalog.btrim(p_reason), v_s.user_id,
          'PENDING');
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_REQUESTED', v_type, p_subject_id,
                               NULL, pg_catalog.jsonb_build_object('approvalId', p_request_id,
                                 'action', p_action, 'country', v_country), p_reason, p_request_id);
  RETURN QUERY SELECT 'REQUESTED'::text, p_request_id;
END
$fn$;
CREATE OR REPLACE FUNCTION core.settlement_cmd_approve_finance_action(p_token_hash bytea, p_approval_id uuid)
  RETURNS TABLE (outcome text, approval_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_f    record;
  v_perm text;
  v_type text;
  v_role text;
  v_now  timestamptz;
  v_ok   boolean;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION 'finance : demande absente' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT f.id, f.action, f.subject_id, f.country_code, f.reason, f.requested_by, f.status INTO v_f
    FROM core.settlement_finance_approval AS f WHERE f.id = p_approval_id;
  v_type := CASE v_f.action WHEN 'ISSUE_BORDEREAU' THEN 'INSURER_BORDEREAU'
                            WHEN 'DECIDE_ADVANCE' THEN 'PLATFORM_ADVANCE'
                            WHEN 'WRITE_OFF_RECEIVABLE' THEN 'PLATFORM_ADVANCE'
                            ELSE 'FINANCE_APPROVAL' END;
  v_perm := CASE v_f.action WHEN 'ISSUE_BORDEREAU' THEN 'finance.insurer_bordereau'
                            ELSE 'finance.platform_advance' END;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', v_type,
                                 COALESCE(v_f.subject_id, p_approval_id), NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'APPROVE_FINANCE_ACTION'), NULL, p_approval_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_f.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, v_perm, ARRAY[v_f.country_code], NULL);
  END IF;
  IF v_role IS NULL OR NOT (v_f.country_code = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', v_type,
                                 COALESCE(v_f.subject_id, p_approval_id), NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_f.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION_OR_COUNTRY' END,
                                   'attempted', 'APPROVE_FINANCE_ACTION', 'permission', v_perm),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_f.status <> 'PENDING' THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_f.id;
    RETURN;
  END IF;
  -- deux personnes distinctes : l'identité est celle de la SESSION (une seconde session du
  -- demandeur est la même personne) ; refus journalisé, aucun effet d'argent
  IF v_f.requested_by = v_s.user_id THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_SELF_APPROVAL_DENIED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'SELF_APPROVAL'::text, v_f.id;
    RETURN;
  END IF;
  -- US-122 (ADR-124, F2-C-04) : l'approbateur n'est pas non plus une personne du sujet
  -- (titulaire, co-hôte, compte lié) ; refus journalisé, aucun effet d'argent
  IF core.support_staff_conflict(v_s.user_id, v_type, v_f.subject_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_SELF_APPROVAL_DENIED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code,
                                   'reason', 'SELF', 'guard', 'SEPARATION_OF_DUTIES'),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, v_f.id;
    RETURN;
  END IF;
  -- verrous : la demande, puis le sujet ; le sujet doit être resté éligible
  PERFORM 1 FROM core.settlement_finance_approval AS f WHERE f.id = v_f.id AND f.status = 'PENDING'
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_f.id;
    RETURN;
  END IF;
  IF v_f.action = 'DECIDE_ADVANCE' THEN
    PERFORM 1 FROM core.settlement_platform_advance AS a
     WHERE a.id = v_f.subject_id AND a.status = 'OPEN' AND a.decided_by IS NULL FOR UPDATE;
  ELSIF v_f.action = 'WRITE_OFF_RECEIVABLE' THEN
    PERFORM 1 FROM core.settlement_platform_advance AS a
     WHERE a.id = v_f.subject_id AND a.status IN ('OPEN', 'RECOVERING')
       AND a.receivable_minor > a.recovered_minor FOR UPDATE;
  ELSE
    PERFORM 1 FROM core.settlement_insurer_bordereau AS b
     WHERE b.id = v_f.subject_id AND b.status = 'DRAFT' FOR UPDATE;
  END IF;
  v_ok := FOUND;
  v_now := platform.now();
  IF NOT v_ok THEN
    UPDATE core.settlement_finance_approval AS f SET status = 'REJECTED' WHERE f.id = v_f.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_REJECTED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code,
                                   'reason', 'SUBJECT_CHANGED'), NULL, p_approval_id);
    RETURN QUERY SELECT 'SUBJECT_CHANGED'::text, v_f.id;
    RETURN;
  END IF;
  UPDATE core.settlement_finance_approval AS f
     SET status = 'APPROVED', approved_by = v_s.user_id, approved_at = v_now
   WHERE f.id = v_f.id;
  IF v_f.action = 'DECIDE_ADVANCE' THEN
    UPDATE core.settlement_platform_advance AS a
       SET decided_by = v_f.requested_by, decision_second_by = v_s.user_id,
           decision_approval_id = v_f.id
     WHERE a.id = v_f.subject_id;
  ELSIF v_f.action = 'WRITE_OFF_RECEIVABLE' THEN
    UPDATE core.settlement_platform_advance AS a
       SET status = 'WRITTEN_OFF', written_off_by = v_f.requested_by, write_off_second_by = v_s.user_id,
           write_off_approval_id = v_f.id, written_off_at = v_now
     WHERE a.id = v_f.subject_id;
  ELSE
    UPDATE core.settlement_insurer_bordereau AS b
       SET status = 'ISSUED', issued_by = v_f.requested_by, second_validated_by = v_s.user_id,
           approval_id = v_f.id, issued_at = v_now
     WHERE b.id = v_f.subject_id;
  END IF;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_APPROVED', v_type, v_f.subject_id,
                               NULL, pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                 'action', v_f.action, 'country', v_f.country_code,
                                 'requestedBy', v_f.requested_by), NULL, p_approval_id);
  RETURN QUERY SELECT 'APPROVED'::text, v_f.id;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 2. Droits des personnes (F2-D-01 à D-03) --------------------------------------------------------
-- 2.1 Reprise d'un effacement refusé : FAILED -> PENDING (la référence de session est conservée
-- par FAILED, exigée par PENDING) ; aucune autre transition ouverte par cette politique
CREATE POLICY kyc_cmd_erasure_reopen ON core.kyc_erasure_request FOR UPDATE TO kyc_cmd_owner
  USING (status = 'FAILED') WITH CHECK (status = 'PENDING' AND completed_at IS NULL);
-- journal de la reprise (KYC_ERASURE_RETRIED, sujet la personne) : seul code ajouté
CREATE POLICY kyc_cmd_erasure_audit_insert ON core.audit_audit_log FOR INSERT TO kyc_cmd_owner
  WITH CHECK (action_code = 'KYC_ERASURE_RETRIED' AND subject_type = 'USER_ACCOUNT');

-- 2.3 Sous kyc_cmd_owner : reprise par la personne et lecture du consentement retiré
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
SET LOCAL ROLE kyc_cmd_owner;

-- Reprise d'une demande d'effacement refusée par le fournisseur (F2-D-02 ; 16 VER-004) : la
-- personne de la session remet SA demande FAILED à traiter (PENDING) ; l'API la rejoue auprès du
-- fournisseur. Issues : RECORDED, AUTH_REQUIRED, NOT_FOUND (demande d'un autre, inconnue ou non
-- FAILED). Une seule personne suffit : aucun argent, aucune décision sur autrui (17 §10).
CREATE FUNCTION core.kyc_cmd_retry_erasure(p_token_hash bytea, p_request_id uuid)
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
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'kyc : demande d''effacement absente' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text;
    RETURN;
  END IF;
  UPDATE core.kyc_erasure_request AS e
     SET status = 'PENDING', completed_at = NULL, attestation_ref = NULL
   WHERE e.id = p_request_id AND e.user_id = v_user AND e.status = 'FAILED'
  RETURNING e.id INTO v_id;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text;
    RETURN;
  END IF;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (v_user, 'GUEST', 'KYC_ERASURE_RETRIED', 'USER_ACCOUNT', v_user,
          pg_catalog.jsonb_build_object('status', 'FAILED', 'requestId', v_id),
          pg_catalog.jsonb_build_object('status', 'PENDING', 'requestId', v_id));
  RETURN QUERY SELECT 'RECORDED'::text;
END
$fn$;

-- Consentement biométrique retiré (F2-D-03) : la vérification courante de la personne est en
-- RECHECK pour CONSENT_WITHDRAWN. Personne absente : vrai (fail-closed).
CREATE FUNCTION core.kyc_consent_withdrawn(p_user uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_user IS NULL
      OR EXISTS (SELECT 1 FROM core.kyc_identity_verification AS v
                  WHERE v.user_id = p_user AND v.is_current AND v.status = 'RECHECK'
                    AND v.decision_reason_code = 'CONSENT_WITHDRAWN')
$fn$;
COMMENT ON FUNCTION core.kyc_cmd_retry_erasure(bytea, uuid) IS
  'Reprise d''une demande d''effacement refusée par le fournisseur (FAILED -> PENDING) par la '
  'personne de la session, journalisée. SECURITY DEFINER, EXECUTE app_api. US-122 (ADR-124, F2-D-02).';
COMMENT ON FUNCTION core.kyc_consent_withdrawn(uuid) IS
  'Consentement biométrique retiré (vérification courante RECHECK / CONSENT_WITHDRAWN) ; personne '
  'absente : vrai. SECURITY DEFINER, EXECUTE cmd_hold_owner. US-122 (ADR-124, F2-D-03).';
REVOKE ALL ON FUNCTION core.kyc_cmd_retry_erasure(bytea, uuid), core.kyc_consent_withdrawn(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_cmd_retry_erasure(bytea, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION core.kyc_consent_withdrawn(uuid) TO cmd_hold_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 2.2 Demandes en retard, gelées comprises (définition de 0090 recopiée ; bloc US-122) -----
GRANT CREATE ON SCHEMA core TO privacy_cmd_owner;
SET LOCAL ROLE privacy_cmd_owner;
CREATE OR REPLACE FUNCTION core.privacy_worker_dsr_overdue(p_batch integer)
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
       -- US-122 (ADR-124, F2-D-01) : une demande gelée (BLOCKED_LEGAL_HOLD) passée son échéance
       -- est signalée comme les autres : un gel ne rend jamais une demande invisible
       WHERE d.closed_at IS NULL
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
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM privacy_cmd_owner;

-- 2.4 Consentement biométrique : un retrait reprend les effacements refusés (définition de 0072
-- recopiée ; bloc US-122) ; sous kyc_cmd_owner
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
SET LOCAL ROLE kyc_cmd_owner;
CREATE OR REPLACE FUNCTION core.kyc_cmd_biometric_consent(p_token_hash bytea, p_country text,
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

  -- US-122 (ADR-124, F2-D-02) : un nouveau retrait reprend aussi les demandes d'effacement que
  -- le fournisseur a refusées (FAILED) : elles redeviennent à traiter, jamais abandonnées
  UPDATE core.kyc_erasure_request AS e
     SET status = 'PENDING', completed_at = NULL, attestation_ref = NULL
   WHERE e.user_id = v_user AND e.status = 'FAILED';
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
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 2.5 Pose d'un hold : consentement biométrique retiré refusé (définition de 0080 recopiée ;
-- bloc US-122) ; sous cmd_hold_owner
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;
CREATE OR REPLACE FUNCTION core.booking_cmd_place_hold(
  p_vehicle_id uuid,
  p_start      timestamptz,
  p_end        timestamptz,
  p_flagged    boolean
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest      uuid := app.actor_id();
  v_org        uuid;
  v_country    text;
  v_holder     uuid;
  v_org_status text;
  v_buffer     integer;
  v_ttl        integer;
  v_max_total  integer;
  v_max_live   integer;
  v_rate       integer;
  v_grace      integer;
  v_order      text;
  v_review     boolean;
  v_minutes    integer;
  v_live       integer;
  v_overlap    boolean;
  v_recent     integer;
  v_now        timestamptz;
  v_expires_at timestamptz;
  v_period     tstzrange;
  v_hold       uuid := pg_catalog.gen_random_uuid();
  v_occupancy  uuid := pg_catalog.gen_random_uuid();
  v_max_days   integer;
  v_notice     integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  -- US-049 (RT-CONC-02) : bornes finies (une fin infinie occuperait le véhicule sans limite)
  IF p_vehicle_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT pg_catalog.isfinite(p_start)
     OR NOT pg_catalog.isfinite(p_end) OR p_end <= p_start OR p_start <= platform.now() THEN
    RAISE EXCEPTION 'hold: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;

  SELECT p.org_id, p.country_code INTO v_org, v_country
    FROM core.booking_vehicle_party(p_vehicle_id) AS p;
  IF v_org IS NULL OR v_country IS NULL THEN
    RAISE EXCEPTION 'hold: vehicle unknown'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_vehicle_unknown';
  END IF;
  SELECT o.holder_user_id, o.status INTO v_holder, v_org_status
    FROM core.iam_organization o
   WHERE o.id = v_org AND o.country_code = v_country;
  IF v_org_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'hold: host not active'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_host_not_active';
  END IF;
  -- self_booking_forbidden (16 BKG-012, ACC-014 ; OQ-P2P-09). US-049 (F-RLS-02) : le titulaire et
  -- tout membre du compte d'hôte du véhicule. US-127 (ADR-110) : aussi tout membre d'un autre
  -- compte d'hôte du titulaire (autre pays) et tout compte lié à l'une de ces personnes (constat
  -- de l'ops, même identité vérifiée, même téléphone). Le même refus, sans détail, avant toute
  -- lecture de l'occupation ; le signalement à l'ops est la commande
  -- core.booking_cmd_report_self_booking (transaction distincte : ce refus annule celle-ci)
  IF core.risk_self_booking_signal(v_guest, v_org) IS NOT NULL THEN
    RAISE EXCEPTION 'hold: self booking'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_self_booking';
  END IF;
  -- US-109 (16 ADM-005, BKG-012 ; 08 BR-ACC-10) : une restriction ACTIVE du voyageur refuse toute
  -- réservation ; celle du titulaire du compte d'hôte ferme ses véhicules (L1-PM-33)
  IF EXISTS (SELECT 1 FROM core.iam_restriction r WHERE r.user_id = v_guest AND r.active) THEN
    RAISE EXCEPTION 'hold: account restricted'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_account_restricted';
  END IF;
  IF EXISTS (SELECT 1 FROM core.iam_restriction r WHERE r.user_id = v_holder AND r.active) THEN
    RAISE EXCEPTION 'hold: host not active'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_host_not_active';
  END IF;
  -- US-122 (ADR-124, F2-D-03 ; 16 VER-004 « paiement refusé ») : consentement biométrique
  -- retiré (vérification courante en RECHECK, CONSENT_WITHDRAWN) : aucune réservation. Le
  -- contrôle complet de l'éligibilité du conducteur à la pose reste à US-209
  IF core.kyc_consent_withdrawn(v_guest) THEN
    RAISE EXCEPTION 'hold: biometric consent withdrawn'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_kyc_consent_withdrawn';
  END IF;

  v_buffer    := core.booking_param_int('buffer_minutes', v_country);
  v_ttl       := core.booking_param_int('hold_ttl_minutes', v_country);
  v_max_total := core.booking_param_int('hold_max_total_minutes', v_country);
  v_max_live  := core.booking_param_int('max_active_holds_per_guest', v_country);
  v_rate      := core.booking_param_int('hold_creations_per_guest_vehicle_hour', v_country);
  v_grace     := core.booking_param_int('sweep_grace_s', v_country);
  v_max_days  := core.booking_param_int('max_trip_days', v_country);  -- US-049 (RT-CONC-02)
  v_review    := COALESCE(p_flagged, true)
                 AND COALESCE(core.booking_param_text('flagged_booking_payment_order', v_country),
                              'REVIEW_BEFORE_CHARGE') IS DISTINCT FROM 'PAY_THEN_REVIEW';
  IF v_review THEN
    v_minutes := core.booking_param_int('review_hold_minutes', v_country);
  ELSE
    v_minutes := LEAST(v_ttl, v_max_total);
  END IF;
  -- US-119 (16 CAL-003, 08 BR-BOOK-04) : préavis du lieu de remise du véhicule, sinon du pays
  v_notice    := core.catalog_effective_notice_minutes(p_vehicle_id);
  IF v_buffer IS NULL OR v_ttl IS NULL OR v_max_total IS NULL OR v_max_live IS NULL
     OR v_rate IS NULL OR v_grace IS NULL OR v_minutes IS NULL OR v_minutes < 1
     OR v_max_days IS NULL OR v_max_days < 1 OR v_notice IS NULL THEN
    RAISE EXCEPTION 'hold: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  -- US-049 (RT-CONC-02) : durée de location au plus max_trip_days jours du pays (17 §7.2, ADM-031)
  IF p_end - p_start > pg_catalog.make_interval(days => v_max_days) THEN
    RAISE EXCEPTION 'hold: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;
  -- US-119 : départ au plus tôt à platform.now() + préavis (borne incluse : 3 h pile acceptée,
  -- 2 h 59 refusée)
  IF p_start < platform.now() + pg_catalog.make_interval(mins => v_notice) THEN
    RAISE EXCEPTION 'hold: advance notice too short'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_notice_too_short';
  END IF;
  v_period := core.booking_occupied_period(p_start, p_end, v_buffer);

  -- 0. verrous : guest puis véhicule (ordre global, 17 §2.5, VERIF_16-M2)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || p_vehicle_id::text, 0));

  -- 2a. expiration ciblée : texte EXPIRY_2A_SQL de test/support/expiry-2a.ts (17 §2.5,
  -- VERIF_16-M14, VERIF_17-A3 / A6), aux paramètres près (égalité vérifiée par expiry-2a.test.ts)
  WITH t AS (SELECT platform.now() AS ts),
     due AS (
       SELECT h.id, h.occupancy_id
         FROM core.booking_checkout_hold h, t
        WHERE (h.vehicle_id = p_vehicle_id OR h.guest_user_id = v_guest)
          AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
          AND h.expires_at <= t.ts
          AND (h.payment_in_flight_until IS NULL OR h.payment_in_flight_until <= t.ts)
          AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation o
                           WHERE o.hold_id = h.id AND o.purpose = 'RENT'
                             AND ( ( o.status IN ('PENDING','SUBMITTED','UNKNOWN')
                                     AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
                                     AND t.ts < h.payment_in_flight_until + make_interval(secs => v_grace) )
                                OR ( o.status = 'SUCCEEDED'
                                     AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                                      WHERE d.operation_id = o.id) ) ))
        FOR UPDATE OF h SKIP LOCKED
     ), expired AS (
       UPDATE core.booking_checkout_hold SET status = 'EXPIRED', expired_at = (SELECT ts FROM t)
        WHERE id IN (SELECT id FROM due)
       RETURNING occupancy_id
     )
     UPDATE core.booking_vehicle_occupancy
        SET active = false, deactivated_reason = 'HOLD_EXPIRED'
      WHERE id IN (SELECT occupancy_id FROM expired)
        AND kind = 'HOLD';

  -- 2b. contrôles entre hôtes, sous le verrou du voyageur (17 §2.3, RLS-3, RLS-4) : holds vivants
  -- tous hôtes confondus, chevauchement avec ses trips (période sans tampon, BR-BOOK-08)
  SELECT g.live_holds, g.trip_overlap INTO v_live, v_overlap
    FROM platform.guest_hold_guard(pg_catalog.tstzrange(p_start, p_end, '[)')) AS g;
  IF v_live IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF v_overlap THEN
    RAISE EXCEPTION 'hold: guest overlap'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_guest_overlap';
  END IF;
  IF v_live >= v_max_live THEN
    RAISE EXCEPTION 'hold: live hold limit reached'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_guest_limit';
  END IF;
  -- rotation (17 §2.5 M5) : poses du voyageur sur ce véhicule dans l'heure glissante
  v_now := platform.now();
  SELECT pg_catalog.count(*)::integer INTO v_recent
    FROM core.booking_checkout_hold h
   WHERE h.guest_user_id = v_guest AND h.vehicle_id = p_vehicle_id
     AND h.created_at > v_now - pg_catalog.make_interval(hours => 1);
  IF v_recent >= v_rate THEN
    RAISE EXCEPTION 'hold: rate limited'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_rate_limited';
  END IF;

  -- 2c. occupation HOLD [début, fin + tampon) puis hold ; pas de guest_occupancy (17 §2.5)
  v_expires_at := v_now + pg_catalog.make_interval(mins => v_minutes);
  -- 23P01 vehicle_occupancy_no_overlap possible ici : créneau pris (2d : VEHICLE_UNAVAILABLE)
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          ref_type, ref_id, created_by)
  VALUES (v_occupancy, p_vehicle_id, v_org, v_country, 'HOLD', 'CHECKOUT', v_period, true,
          v_expires_at, 'HOLD', v_hold, v_guest);
  -- 23505 one_live_hold_per_guest_vehicle possible ici : hold vivant du même voyageur
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
          expires_at, review_required, created_at, created_by)
  VALUES (v_hold, v_guest, p_vehicle_id, v_org, v_country, v_occupancy, 'CHECKOUT', 'ACTIVE',
          v_expires_at, v_review, v_now, v_guest);

  -- booking.hold.created (17 §2.5 : seul événement avant la preuve de paiement) ; aucune donnée
  -- du voyageur dans le contenu (l'acteur est dans l'enveloppe)
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.hold.created', 1, 'checkout_hold', v_hold, 0, v_country, v_guest, 'GUEST',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', v_hold, 'vehicle_id', p_vehicle_id,
                                        'org_id', v_org, 'expires_at', v_expires_at,
                                        'review_required', v_review),
          v_hold::text);
  RETURN v_hold;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 3. Téléversements : plafonds par pays de la base (F2-U-02 ; graine 0098, PROPOSÉS) --------
-- Défense en profondeur derrière les contrôles de l'API (photo-ingest.ts, ports.ts) : taille
-- déclarée d'une photo (upload_photo_max_kb), photos d'une galerie (upload_gallery_photos_max,
-- refusées exclues : ce n'est pas un plafond d'annonces ni de véhicules, DEC-FONDATEUR-19),
-- dépôts de pièces d'un véhicule sur une minute glissante (upload_documents_per_minute).
-- Valeur absente ou mal formée : refus (fail-closed).
CREATE POLICY catalog_cmd_upload_read ON core.config_param_definition FOR SELECT
  TO catalog_cmd_owner
  USING (key IN ('upload_photo_max_kb', 'upload_gallery_photos_max', 'upload_documents_per_minute'));
CREATE POLICY catalog_cmd_upload_read ON core.config_param_value FOR SELECT
  TO catalog_cmd_owner
  USING (key IN ('upload_photo_max_kb', 'upload_gallery_photos_max', 'upload_documents_per_minute'));
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;
-- (définitions de 0067 et 0077 recopiées à l'identique ; seuls les blocs US-122 changent)
CREATE OR REPLACE FUNCTION core.catalog_cmd_add_listing_photo(p_token_hash bytea, p_org uuid,
                                                   p_listing_id uuid, p_photo_id uuid,
                                                   p_file_id uuid, p_mime text, p_bytes bigint,
                                                   p_sha256 bytea)
  RETURNS TABLE (outcome text, photo_id uuid, storage_key text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h        record;
  v_status text;
  v_pos    smallint;
  v_key    text;
  v_max_kb bigint;
  v_max_n  bigint;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_photo_id IS NULL OR p_file_id IS NULL THEN
    RAISE EXCEPTION 'photo : identifiants manquants' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT l.status INTO v_status
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_status NOT IN ('DRAFT', 'REJECTED', 'BLOCKED_ELIGIBILITY') THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_mime IS NULL OR p_mime NOT IN ('image/jpeg', 'image/png', 'image/webp')
     OR p_bytes IS NULL OR p_bytes <= 0
     OR p_sha256 IS NULL OR pg_catalog.octet_length(p_sha256) <> 32 THEN
    RETURN QUERY SELECT 'PHOTO_FORMAT'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  -- US-122 (ADR-124, F2-U-02) : taille déclarée bornée par le pays, comme celle d'une pièce ;
  -- paramètre absent ou mal formé : refus
  v_max_kb := core.catalog_param_int('upload_photo_max_kb', h.country_code);
  IF v_max_kb IS NULL OR v_max_kb < 1 OR p_bytes > v_max_kb * 1024 THEN
    RETURN QUERY SELECT 'PHOTO_FORMAT'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  -- US-122 (ADR-124, F2-U-02) : photos de la galerie (refusées et retirées exclues), annonce verrouillée
  -- ci-dessus ; paramètre absent ou mal formé : refus
  v_max_n := core.catalog_param_int('upload_gallery_photos_max', h.country_code);
  IF v_max_n IS NULL OR v_max_n < 1
     OR (SELECT pg_catalog.count(*) FROM core.catalog_listing_photo AS p
          WHERE p.listing_id = p_listing_id AND p.status <> 'REJECTED'
            AND p.deleted_at IS NULL) >= v_max_n THEN
    RETURN QUERY SELECT 'PHOTO_LIMIT_REACHED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.max(p.position) + 1, 0)::smallint INTO v_pos
    FROM core.catalog_listing_photo AS p WHERE p.listing_id = p_listing_id;
  v_key := 'listing/' || p_listing_id::text || '/' || p_photo_id::text;
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256,
                                     uploader_user_id, source, classification, retention_class)
  VALUES (p_file_id, 'PUBLIC_LISTING', v_key, p_mime, p_bytes, p_sha256, h.user_id, 'HOST_UPLOAD',
          'C0', 'LISTING_PHOTO');
  INSERT INTO core.catalog_listing_photo (id, listing_id, org_id, country_code, file_id, position,
                                          status, created_by)
  VALUES (p_photo_id, p_listing_id, p_org, h.country_code, p_file_id, v_pos, 'PENDING', h.user_id);
  RETURN QUERY SELECT 'DONE'::text, p_photo_id, v_key;
END
$fn$;
CREATE OR REPLACE FUNCTION core.catalog_cmd_add_vehicle_document(p_token_hash bytea, p_org uuid,
                                                      p_vehicle uuid, p_file_id uuid,
                                                      p_doc_type text, p_mime text,
                                                      p_bytes bigint, p_sha256 bytea,
                                                      p_valid_until date)
  RETURNS TABLE (outcome text, document_id uuid, storage_key text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  w     record;
  v_key text;
  v_max bigint;
BEGIN
  SELECT * INTO w FROM core.catalog_vehicle_writable(p_token_hash, p_org, p_vehicle);
  IF w.outcome <> 'OK' THEN
    RETURN QUERY SELECT w.outcome, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_file_id IS NOT NULL AND EXISTS (SELECT 1 FROM core.catalog_vehicle_document AS d
                                        WHERE d.file_id = p_file_id AND d.vehicle_id = p_vehicle) THEN
    -- rejeu du même dépôt (même requête) : rien n'est réécrit
    RETURN QUERY SELECT 'DUPLICATE'::text, p_file_id,
                        core.catalog_document_key(p_org, p_vehicle, p_file_id);
    RETURN;
  END IF;
  IF p_file_id IS NULL
     OR p_doc_type IS NULL OR p_doc_type NOT IN ('TITLE', 'OWNER_AUTHORIZATION', 'PLATE_VIN_PHOTO',
                                                 'INSPECTION', 'LENDER_CONSENT',
                                                 'COMPULSORY_INSURANCE')
     OR p_mime IS NULL OR p_mime NOT IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')
     OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 10485760
     OR p_sha256 IS NULL OR pg_catalog.octet_length(p_sha256) <> 32
     OR (p_valid_until IS NOT NULL
         AND p_valid_until NOT BETWEEN DATE '1950-01-01' AND DATE '2100-12-31') THEN
    RETURN QUERY SELECT 'VEHICLE_DOCUMENT_INVALID'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  -- US-122 (ADR-124, F2-U-02) : dépôts de pièces du véhicule sur une minute glissante, sous un
  -- verrou du véhicule (deux dépôts concurrents ne passent pas tous deux la borne) ;
  -- paramètre absent ou mal formé : refus
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalog.vehicle_documents:' || p_vehicle::text, 0));
  v_max := core.catalog_param_int('upload_documents_per_minute', w.country_code);
  IF v_max IS NULL OR v_max < 1
     OR (SELECT pg_catalog.count(*) FROM core.catalog_vehicle_document AS d
          WHERE d.vehicle_id = p_vehicle
            AND d.created_at > platform.now() - pg_catalog.make_interval(mins => 1)) >= v_max THEN
    RETURN QUERY SELECT 'DOCUMENT_RATE_LIMITED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  v_key := core.catalog_document_key(p_org, p_vehicle, p_file_id);
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id,
                                     source, classification, retention_class, enc_subject_type,
                                     enc_subject_id)
  VALUES (p_file_id, 'DOCUMENTS', v_key, p_mime, p_bytes, p_sha256, w.user_id, 'HOST_UPLOAD', 'C2',
          'VEHICLE_DOCUMENT', 'USER', w.user_id);
  UPDATE core.catalog_vehicle_document AS d
     SET status = 'SUPERSEDED'
   WHERE d.vehicle_id = p_vehicle AND d.doc_type = p_doc_type AND d.status IN ('SUBMITTED', 'VALID');
  INSERT INTO core.catalog_vehicle_document (id, vehicle_id, org_id, country_code, doc_type, file_id,
                                             mime, bytes, valid_until, uploaded_by)
  VALUES (p_file_id, p_vehicle, p_org, w.country_code, p_doc_type, p_file_id, p_mime, p_bytes,
          p_valid_until, w.user_id);
  UPDATE core.catalog_vehicle AS x SET eligibility_status = 'PENDING' WHERE x.id = p_vehicle;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (w.user_id, 'P2P_HOST', 'VEHICLE_DOCUMENT_RECEIVED', 'VEHICLE', p_vehicle, NULL,
          pg_catalog.jsonb_build_object('orgId', p_org, 'country', w.country_code,
                                        'documentType', p_doc_type, 'fileId', p_file_id,
                                        'mime', p_mime, 'bytes', p_bytes,
                                        'countries', pg_catalog.jsonb_build_array(w.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_file_id, v_key;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 4. Hôte défaillant (F2-T-01, F2-T-02 ; 08 BR-TRUST-09 « suspendre les nouvelles réservations
-- d'un hôte défaillant ; prévenir les voyageurs concernés ») -----------------------------------
-- 4.1 Voyageurs prévenus : un événement booking.trip.host_restricted par trip à venir des comptes
-- d'hôte de la personne restreinte (sous cmd_hold_owner, module BKG ; notification NTF
-- EVT_TRIP_HOST_RESTRICTED, adaptateurs FAKE seulement). Charge : trip_id, guest_user_id, org_id ;
-- jamais le motif ni une donnée de l'hôte.
GRANT SELECT (guest_user_id, scheduled_end) ON core.booking_trip TO cmd_hold_owner;
GRANT INSERT (id) ON core.outbox_outbox_event TO cmd_hold_owner;
CREATE POLICY cmd_hold_trip_notice_ins ON core.outbox_outbox_event FOR INSERT TO cmd_hold_owner
  WITH CHECK (type = 'booking.trip.host_restricted' AND aggregate_type = 'trip'
              AND actor_user_id IS NOT NULL);
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;
CREATE FUNCTION core.booking_notify_host_restricted(p_holder uuid, p_actor uuid,
                                                    p_actor_role text, p_causation uuid)
  RETURNS uuid[]
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r     record;
  v_id  uuid;
  v_ids uuid[] := '{}'::uuid[];
BEGIN
  IF p_holder IS NULL OR p_actor IS NULL OR p_actor_role IS NULL THEN
    RAISE EXCEPTION 'hôte restreint : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR r IN
    SELECT t.id, t.guest_user_id, t.org_id, t.country_code
      FROM core.booking_trip AS t
      JOIN core.iam_organization AS o ON o.id = t.org_id
     WHERE o.holder_user_id = p_holder AND t.status IN ('BOOKED', 'CHECKIN_OPEN')
       AND t.scheduled_end > platform.now()
     ORDER BY t.scheduled_start, t.id
  LOOP
    v_id := platform.uuid_v7();
    INSERT INTO core.outbox_outbox_event
           (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
    VALUES (v_id, 'booking.trip.host_restricted', 1, 'trip', r.id, 0, r.country_code, p_actor,
            p_actor_role, pg_catalog.gen_random_uuid(), p_causation,
            pg_catalog.jsonb_build_object('trip_id', r.id, 'guest_user_id', r.guest_user_id,
                                          'org_id', r.org_id),
            r.id::text);
    v_ids := v_ids || v_id;
  END LOOP;
  RETURN v_ids;
END
$fn$;
COMMENT ON FUNCTION core.booking_notify_host_restricted(uuid, uuid, text, uuid) IS
  'Un événement booking.trip.host_restricted par trip à venir (BOOKED, CHECKIN_OPEN) des comptes '
  'd''hôte de la personne restreinte (08 BR-TRUST-09). SECURITY DEFINER, EXECUTE iam_auth_owner. '
  'US-122 (ADR-124, F2-T-02).';
REVOKE ALL ON FUNCTION core.booking_notify_host_restricted(uuid, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_notify_host_restricted(uuid, uuid, text, uuid)
  TO iam_auth_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 4.2 Pose d'une restriction (définition de 0064 recopiée ; bloc US-122) ; sous iam_auth_owner
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
SET LOCAL ROLE iam_auth_owner;
CREATE OR REPLACE FUNCTION core.iam_manual_action_restriction(p_token_hash bytea, p_action_id uuid,
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
  v_kind text := p_input ->> 'kind';
  v_id   uuid;
  v_ev   uuid[];
BEGIN
  IF p_action_code IS NULL OR p_action_code NOT IN ('RESTRICT_ACCOUNT', 'LIFT_RESTRICTION')
     OR p_action_id IS NULL OR p_subject_id IS NULL OR p_actor IS NULL OR p_actor_role IS NULL
     OR p_reason IS NULL THEN
    RAISE EXCEPTION 'restriction : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('TS_HOLD', 'POLICY_VIOLATION') THEN
    RETURN QUERY SELECT 'KIND_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.iam_user_account AS u WHERE u.id = p_subject_id) THEN
    RETURN QUERY SELECT 'SUBJECT_NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF p_subject_id = p_actor THEN
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  -- membre du staff (rôle en cours) : un ADMIN seulement (PROPOSÉ, ADR-097)
  IF p_actor_role IS DISTINCT FROM 'ADMIN'
     AND EXISTS (SELECT 1 FROM core.iam_staff_role_assignment AS a
                  WHERE a.user_id = p_subject_id
                    AND (a.expires_at IS NULL OR a.expires_at > platform.now())) THEN
    RETURN QUERY SELECT 'STAFF_SUBJECT_ADMIN_ONLY'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('iam.restriction:' || p_subject_id::text || ':' || v_kind, 0));
  SELECT r.id INTO v_id FROM core.iam_restriction AS r
   WHERE r.user_id = p_subject_id AND r.kind = v_kind AND r.active;
  IF p_action_code = 'RESTRICT_ACCOUNT' THEN
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT 'RESTRICTION_EXISTS'::text, v_id, '{}'::uuid[];
      RETURN;
    END IF;
    INSERT INTO core.iam_restriction (id, user_id, kind, active, reason, source_ref, created_by,
                                      updated_by)
    VALUES (p_action_id, p_subject_id, v_kind, true, pg_catalog.btrim(p_reason),
            'manual_action:' || p_action_id::text, p_actor, p_actor);
    -- US-122 (ADR-124, F2-T-02 ; 08 BR-TRUST-09) : chaque voyageur d'un trip à venir des comptes
    -- d'hôte de la personne restreinte est prévenu (un événement par trip, même transaction)
    v_ev := core.booking_notify_host_restricted(p_subject_id, p_actor, p_actor_role, p_action_id);
    RETURN QUERY SELECT 'DONE'::text, p_action_id, v_ev;
    RETURN;
  END IF;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'RESTRICTION_NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  UPDATE core.iam_restriction AS r
     SET active = false, lifted_at = platform.now(), updated_by = p_actor
   WHERE r.id = v_id;
  RETURN QUERY SELECT 'DONE'::text, v_id, '{}'::uuid[];
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;

-- 4.3 Fiche 360° : trips à venir de l'hôte (définition de 0076 recopiée ; bloc US-122) ; sous
-- iam_staff_owner
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;
CREATE OR REPLACE FUNCTION core.support_staff_profile(p_token_hash bytea, p_request_id uuid,
                                                      p_user_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s          record;
  v_country    text;
  v_role       text;
  v_cover      text;
  v_access     uuid;
  v_u          record;
  v_restricted boolean;
  v_purpose    text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_user_id IS NULL OR v_purpose IS NULL
     OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'fiche : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER_ACCOUNT',
                                 p_user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS', 'permission', 'support.read_profile'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  v_country := core.ctr_account_country(p_user_id);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.read_profile', ARRAY[v_country], NULL);
  END IF;
  IF v_role IS NOT NULL THEN
    v_cover := core.support_staff_covers_user(v_s.user_id, v_role, p_user_id, v_country);
  END IF;
  IF v_cover IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'USER_ACCOUNT', p_user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_country IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        WHEN v_role IS NULL THEN 'PERMISSION' ELSE 'CASE' END,
                                   'attempted', 'DATA_ACCESS', 'permission', 'support.read_profile',
                                   'access_kind', 'READ_C2_SUPPORT')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country) END,
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL THEN 'CASE_REQUIRED' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  v_access := core.support_staff_log_access(v_s.user_id, v_role, 'USER_ACCOUNT', p_user_id,
                                            'user_account.profile_360', 'READ_C2_SUPPORT',
                                            v_purpose,
                                            CASE WHEN v_cover LIKE 'scope:%' THEN NULL ELSE v_cover END,
                                            p_request_id, v_country);
  SELECT u.id, u.email, u.email_verified_at, u.phone_e164, u.phone_verified_at, u.legal_first_name,
         u.legal_last_name, u.display_name, u.preferred_locale, u.residence_country, u.status,
         u.pseudonymized_at, u.created_at
    INTO v_u
    FROM core.iam_user_account AS u WHERE u.id = p_user_id;
  v_restricted := EXISTS (SELECT 1 FROM core.iam_restriction AS r
                           WHERE r.user_id = p_user_id AND r.active);
  RETURN QUERY SELECT 'GRANTED'::text, pg_catalog.jsonb_build_object(
    'accessId', v_access, 'country', v_country, 'coverage', pg_catalog.split_part(v_cover, ':', 1),
    'profile', pg_catalog.jsonb_build_object(
      'id', v_u.id, 'email', v_u.email, 'emailVerified', v_u.email_verified_at IS NOT NULL,
      'phone', v_u.phone_e164, 'phoneVerified', v_u.phone_verified_at IS NOT NULL,
      'legalFirstName', v_u.legal_first_name, 'legalLastName', v_u.legal_last_name,
      'displayName', v_u.display_name, 'preferredLocale', v_u.preferred_locale,
      'residenceCountry', v_u.residence_country, 'status', v_u.status,
      'pseudonymized', v_u.pseudonymized_at IS NOT NULL, 'createdAt', v_u.created_at),
    -- statut SM-3 seulement, jamais une pièce ni un score (16 ADM-005) ; US-106
    'kyc', pg_catalog.jsonb_build_object('status', core.kyc_staff_status(p_user_id)),
    'restricted', v_restricted,
    'restrictions', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'active', r.active, 'reason', r.reason,
        'createdAt', r.created_at, 'liftedAt', r.lifted_at) ORDER BY r.created_at DESC)
      FROM core.iam_restriction AS r WHERE r.user_id = p_user_id), '[]'::jsonb),
    'notes', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', n.id, 'authorRole', n.author_role, 'body', n.body, 'createdAt', n.created_at)
        ORDER BY n.created_at DESC)
      FROM (SELECT * FROM core.support_internal_note AS x
             WHERE x.subject_type = 'USER_ACCOUNT' AND x.subject_id = p_user_id
             ORDER BY x.created_at DESC LIMIT 50) AS n), '[]'::jsonb),
    -- une même personne apparaît sous ses deux rôles : hôte et voyageur (OQ-P2P-09)
    'hostAccounts', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'orgId', o.id, 'country', o.country_code, 'status', o.status,
        'displayName', o.display_name,
        'bookable', o.status = 'ACTIVE' AND NOT v_restricted) ORDER BY o.country_code)
      FROM core.iam_organization AS o
     WHERE o.holder_user_id = p_user_id AND o.country_code = v_country), '[]'::jsonb),
    'trips', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', t.id, 'publicRef', t.public_ref, 'status', t.status, 'country', t.country_code,
        'scheduledStart', t.scheduled_start, 'scheduledEnd', t.scheduled_end)
        ORDER BY t.scheduled_start DESC)
      FROM (SELECT x.id, x.public_ref, x.status, x.country_code, x.scheduled_start, x.scheduled_end
              FROM core.booking_trip AS x
             WHERE x.guest_user_id = p_user_id AND x.country_code = v_country
             ORDER BY x.scheduled_start DESC LIMIT 50) AS t), '[]'::jsonb),
    -- US-122 (ADR-124, F2-T-01 ; 08 BR-TRUST-09) : trips à venir des comptes d'hôte de la
    -- personne (hôte défaillant : l'ops les liste) ; jamais le voyageur (RT-L1-D03)
    'hostTrips', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', t.id, 'publicRef', t.public_ref, 'orgId', t.org_id, 'status', t.status,
        'country', t.country_code, 'scheduledStart', t.scheduled_start,
        'scheduledEnd', t.scheduled_end) ORDER BY t.scheduled_start, t.id)
      FROM (SELECT x.id, x.public_ref, x.org_id, x.status, x.country_code, x.scheduled_start,
                   x.scheduled_end
              FROM core.booking_trip AS x
              JOIN core.iam_organization AS o ON o.id = x.org_id
             WHERE o.holder_user_id = p_user_id AND x.country_code = v_country
               AND x.status IN ('BOOKED', 'CHECKIN_OPEN')
               AND x.scheduled_end > platform.now()
             ORDER BY x.scheduled_start, x.id LIMIT 200) AS t), '[]'::jsonb),
    'cases', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', c.id, 'category', c.category, 'status', c.status, 'priority', c.priority,
        'channel', c.channel, 'assignedToMe', c.assignee_id IS NOT DISTINCT FROM v_s.user_id,
        'createdAt', c.created_at) ORDER BY c.created_at DESC)
      FROM core.support_support_case AS c
     WHERE c.requester_user_id = p_user_id AND c.country_code = v_country), '[]'::jsonb),
    'queueItems', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', i.id, 'queue', i.queue, 'status', i.status, 'slaDueAt', i.sla_due_at,
        'overdue', i.status IN ('OPEN', 'IN_REVIEW') AND i.sla_due_at <= platform.now())
        ORDER BY i.created_at DESC)
      FROM core.support_review_queue_item AS i
     WHERE i.subject_type = 'USER_ACCOUNT' AND i.subject_id = p_user_id
       AND i.country_code = v_country), '[]'::jsonb));
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 5. Doublon d'identité d'hôte (F2-A03-01 ; 08 BR-ACC-06 « une personne, un compte d'hôte » ;
-- DEC-FONDATEUR-22 « jamais plus lourd que Turo ») ------------------------------------------
-- Comme Turo (PROPOSÉ, COMME_TURO) : aucun document ni étape de plus pour l'hôte. Contrôle
-- automatique : le titulaire du compte a une identité vérifiée qui est la même personne (signal
-- SAME_IDENTITY d'US-103 / ADR-122 : même date de naissance et sacs de mots du nom inclus)
-- qu'un AUTRE titulaire dont un compte d'hôte est déjà approuvé, sans constat NOT_LINKED de
-- l'ops entre eux. Alors le second dossier n'est jamais approuvé, ni par l'ops
-- (HOST_IDENTITY_DUPLICATE, dossier laissé dans la file) ni par le travailleur
-- (DUPLICATE_IDENTITY, laissé à l'ops) : il n'est pas refusé, il part en revue de l'ops, qui
-- tranche par le constat de comptes liés (US-127) : NOT_LINKED (deux personnes) libère
-- l'approbation, LINKED (même personne) la ferme. Les approbations d'hôte sont sérialisées par
-- un verrou consultatif (deux dossiers jumeaux approuvés en même temps : le second voit le
-- premier).
GRANT SELECT (org_id, status) ON core.kyc_host_verification TO risk_limit_owner;
CREATE POLICY risk_host_duplicate_read ON core.kyc_host_verification FOR SELECT
  TO risk_limit_owner USING (status = 'APPROVED');
GRANT CREATE ON SCHEMA core TO risk_limit_owner;
SET LOCAL ROLE risk_limit_owner;
CREATE FUNCTION core.kyc_host_identity_duplicate(p_org uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH holder AS (
    SELECT o.holder_user_id AS user_id FROM core.iam_organization AS o WHERE o.id = p_org
  ),
  -- identités vérifiées (approuvées une fois) d'une personne : sac de mots du nom lu sur le
  -- permis, sinon du nom déclaré (même lecture que core.risk_self_booking_signal, ADR-122)
  idn AS (
    SELECT s.user_id, s.date_of_birth,
           COALESCE(
             NULLIF((SELECT core.kyc_legal_name_bag(d.holder_given_names, d.holder_surnames)
                       FROM core.kyc_identity_document AS d
                      WHERE d.verification_id = v.id
                      ORDER BY d.created_at DESC, d.id DESC LIMIT 1), '{}'::text[]),
             core.kyc_legal_name_bag(u.legal_first_name, u.legal_last_name)) AS name_bag
      FROM core.kyc_identity_subject AS s
      JOIN core.kyc_identity_verification AS v
        ON v.id = s.verification_id AND v.user_id = s.user_id AND v.first_approved_at IS NOT NULL
      JOIN core.iam_user_account AS u ON u.id = s.user_id AND u.pseudonymized_at IS NULL
     WHERE s.date_of_birth IS NOT NULL
  ),
  me AS (SELECT i.* FROM idn AS i JOIN holder AS h ON h.user_id = i.user_id)
  SELECT (SELECT h.user_id FROM holder AS h) IS NULL
      OR EXISTS (
           SELECT 1
             FROM me
             JOIN idn AS t ON t.date_of_birth = me.date_of_birth AND t.user_id <> me.user_id
            WHERE core.kyc_legal_name_bags_match(me.name_bag, t.name_bag)
              AND EXISTS (SELECT 1
                            FROM core.iam_organization AS o2
                            JOIN core.kyc_host_verification AS hv ON hv.org_id = o2.id
                           WHERE o2.holder_user_id = t.user_id AND hv.status = 'APPROVED')
              AND NOT EXISTS (SELECT 1 FROM core.risk_account_link AS l
                               WHERE l.user_low = LEAST(t.user_id, me.user_id)
                                 AND l.user_high = GREATEST(t.user_id, me.user_id)
                                 AND l.decision = 'NOT_LINKED'))
$fn$;
COMMENT ON FUNCTION core.kyc_host_identity_duplicate(uuid) IS
  'Doublon d''identité d''hôte : le titulaire du compte est la même personne (SAME_IDENTITY) qu''un '
  'autre titulaire déjà approuvé comme hôte, sans constat NOT_LINKED ; compte inconnu : vrai. '
  'SECURITY DEFINER, EXECUTE kyc_cmd_owner. US-122 (ADR-124, F2-A03-01).';
REVOKE ALL ON FUNCTION core.kyc_host_identity_duplicate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_host_identity_duplicate(uuid) TO kyc_cmd_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM risk_limit_owner;

-- 5.2 Décision de l'ops et approbation automatique (définitions de 0075 et 0081 recopiées ;
-- blocs US-122) ; sous kyc_cmd_owner
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
SET LOCAL ROLE kyc_cmd_owner;
CREATE OR REPLACE FUNCTION core.kyc_manual_action_host_verification_decision(p_token_hash bytea,
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
    IF h.status NOT IN ('OPEN', 'DOCS_PENDING', 'IN_REVIEW') THEN
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
    IF h.screening_hold THEN
      RETURN QUERY SELECT 'HOST_SANCTIONS_HIT'::text, h.id, '{}'::uuid[];
      RETURN;
    ELSIF h.status IN ('REJECTED', 'REVOKED') THEN
      RETURN QUERY SELECT 'HOST_VERIFICATION_DECIDED'::text, h.id, '{}'::uuid[];
      RETURN;
    END IF;
    -- US-122 (ADR-124, F2-A03-01) : approbations d'hôte sérialisées, puis doublon d'identité
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('kyc.host_identity_approval', 0));
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
      -- même personne qu'un hôte déjà approuvé : revue de l'ops par le constat de comptes liés
      WHEN h.status = 'IN_REVIEW' AND core.kyc_host_identity_duplicate(p_subject_id)
        THEN 'HOST_IDENTITY_DUPLICATE'
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
CREATE OR REPLACE FUNCTION core.kyc_host_auto_approve(p_org uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  h      record;
  g      record;
  v_ver  integer;
  v_item record;
BEGIN
  SELECT d.* INTO h FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  IF h.id IS NULL OR h.status <> 'IN_REVIEW' THEN
    RETURN 'NOT_READY';
  END IF;
  -- délai uniforme d'abord : avant l'échéance, un dossier propre et un dossier retenu ou signalé
  -- restent identiques (aucune écriture)
  IF NOT core.kyc_host_review_due(h.country_code, COALESCE(h.review_started_at, h.updated_at)) THEN
    RETURN 'NOT_DUE';
  END IF;
  IF h.screening_hold THEN
    RETURN 'HELD';
  END IF;
  IF core.kyc_host_account_signaled(h.user_id) THEN
    RETURN 'SIGNALED';
  END IF;
  -- US-122 (ADR-124, F2-A03-01) : approbations sérialisées ; même personne qu'un hôte déjà
  -- approuvé : jamais d'approbation automatique, dossier laissé à l'ops (file)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.host_identity_approval', 0));
  IF core.kyc_host_identity_duplicate(p_org) THEN
    RETURN 'DUPLICATE_IDENTITY';
  END IF;
  -- revue de l'ops exigée par le pays ; paramètre absent ou mal formé : revue (fail-closed)
  IF core.kyc_host_param('host_review_manual_required', h.country_code) IS DISTINCT FROM 'false'::jsonb THEN
    RETURN 'REVIEW_REQUIRED';
  END IF;
  SELECT i.id, i.assignee_id INTO v_item
    FROM core.support_review_queue_item AS i
   WHERE i.queue = 'HOST_VERIFICATION' AND i.subject_type = 'ORGANIZATION' AND i.subject_id = p_org
     AND i.status IN ('OPEN', 'IN_REVIEW')
   LIMIT 1;
  IF v_item.assignee_id IS NOT NULL THEN
    RETURN 'CLAIMED';
  END IF;
  -- mêmes contrôles que la décision APPROVED de l'ops (0075), à l'horloge de la base
  SELECT * INTO g FROM core.kyc_host_gates(p_org);
  IF g.org_id IS NULL OR g.kyc_id IS NULL OR g.age <> 'OK' OR g.residence = 'MISMATCH'
     OR g.screening_id IS NULL OR g.screening_result IS DISTINCT FROM 'CLEAR'
     OR g.tax <> 'OK' OR NOT g.terms_ok THEN
    RETURN 'NOT_READY';
  END IF;
  UPDATE core.kyc_host_verification AS d
     SET status = 'APPROVED', decided_by = NULL, decided_at = platform.now(),
         identity_verification_id = g.kyc_id, age_ok = true,
         residence_verified = (g.residence = 'VERIFIED'), missing = '{}',
         row_version = d.row_version + 1, updated_at = platform.now()
   WHERE d.id = h.id AND d.status = 'IN_REVIEW' AND NOT d.screening_hold
  RETURNING d.row_version INTO v_ver;
  IF v_ver IS NULL THEN
    RETURN 'NOT_READY';
  END IF;
  INSERT INTO core.outbox_outbox_event
         (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES (platform.uuid_v7(), 'kyc.host_verification.decided', 1, 'host_verification', h.id, v_ver,
          h.country_code, NULL, 'SYSTEM', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('org_id', p_org, 'verification_id', h.id,
                                        'decision', 'APPROVED'),
          p_org::text);
  -- élément vivant de la file (posé par la mise en revue) clôturé : aucune action de l'ops
  IF v_item.id IS NOT NULL THEN
    PERFORM 1 FROM core.support_close_review_item(v_item.id, 'DONE', 'AUTO_APPROVED', NULL);
  END IF;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (NULL, 'SYSTEM', 'HOST_VERIFICATION_DECIDED', 'ORGANIZATION', p_org,
          pg_catalog.jsonb_build_object('status', h.status),
          pg_catalog.jsonb_build_object('country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code),
                                        'verificationId', h.id, 'decision', 'APPROVED',
                                        'mode', 'AUTOMATIC'));
  -- activation tentée aussitôt (17 §2.4) : sinon le compte reste PENDING_ACTIVATION (fail-closed)
  PERFORM 1 FROM core.kyc_host_try_activate(p_org, NULL, 'SYSTEM');
  RETURN 'APPROVED';
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;
