-- 0097 — SUP / STL / RISK / KYC / AUD / BKG / CAT : correctifs de la passe n° 2 de la red team du lot 1.
-- US-122 ; rapport docs/team/redteam/L1-passe2.md (constats F2-C-01 à C-05, F2-A03-01, F2-D-01 à
-- D-03, F2-U-02, F2-T-01, F2-T-02) ; 17 §2.3 (« un agent ne décide pas sur son propre dossier »,
-- RLS-24), §5, §10 ; 16 ADM-001, ADM-005, VER-004, LEG-009 ; 08 BR-ACC-06, BR-TRUST-09 ;
-- ADR-122 (garde unique), ADR-124 (cette migration, PROPOSÉ). Appliquée sous `migrator`, en une
-- transaction.
--
-- Principes (ADR-124, PROPOSÉS) :
--   - la garde UNIQUE `core.support_actor_conflict` (ADR-122) est appelée par TOUTES les entrées
--     de la console qui prennent, lisent ou décident un sujet : prise d'un élément de file (toutes
--     files), dossier KYC, dossier d'hôte, constat de comptes liés, actions FINANCE à deux
--     personnes (demande ET approbation) ; issue SELF_FORBIDDEN, journalisée ;
--   - personnes d'un sujet : pour USER_ACCOUNT et IDENTITY_VERIFICATION, aussi le titulaire et les
--     membres de tous les comptes d'hôte de la personne (F2-C-05) ; RISK_ASSESSMENT jugé ;
--   - (sections suivantes) doublon d'identité d'hôte, droits des personnes, téléversements,
--     hôte défaillant : voir chaque section.
--
-- Expand / contract : fonctions, droits et politiques ajoutés ; corps remplacés à signature,
-- propriétaire et droits identiques (chaque définition reprise est recopiée à l'identique, seuls
-- les blocs marqués US-122 changent). Le COMPORTEMENT se resserre volontairement. La version N de
-- l'API traduit une issue inconnue en refus (FORBIDDEN), sans rien écrire de plus.
--
-- Retour arrière :
--   réappliquer core.support_staff_claim_item de 0064, core.support_staff_kyc_dossier de 0076,
--     core.support_staff_host_dossier de 0081, core.risk_staff_decide_account_link de 0080,
--     core.support_subject_parties de 0093 (sous iam_staff_owner) ;
--     core.settlement_cmd_request_finance_action et core.settlement_cmd_approve_finance_action de
--     0036 (sous cmd_money_owner) ; puis les définitions citées dans les sections suivantes ;
--   DROP FUNCTION core.support_staff_conflict(uuid, text, uuid), core.support_person_people(uuid) ;
--   DROP POLICY iam_staff_party_read ON core.risk_assessment ; révoquer les droits accordés.

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

-- 1.3 Entrées de la console sous iam_staff_owner (définitions de 0064, 0076, 0081, 0080
-- recopiées à l'identique ; seuls les blocs marqués US-122 (ADR-124) changent) ------------
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
