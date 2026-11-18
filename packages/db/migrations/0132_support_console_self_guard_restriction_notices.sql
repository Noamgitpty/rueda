-- 0132 — SUP / IAM / BKG : séparation des tâches sur les cinq entrées de la console restées hors de
-- la garde, et avis du voyageur quand la restriction de son hôte est posée puis levée.
-- US-215 (partie 215c) ; suites du BOARD N-116 et N-126 (revues d'US-122, passe n° 2 #152) ;
-- 17 §2.3 (« un agent ne décide pas sur son propre dossier », RLS-24), §4.5 ; 08 BR-TRUST-09 ;
-- ADR-122 (garde unique), ADR-124 (point 1 « non gardées, suivi » ; point 6, F2-T-02) ; ADR-156
-- (cette migration, PROPOSÉ). Appliquée sous `migrator`, en une transaction.
--
-- 1. N-116 : `core.support_actor_conflict` (ADR-122) est appelée par les cinq entrées de la console
--    qu'ADR-124 laissait hors de la garde :
--      - `core.support_staff_profile` (fiche 360°) : sujet USER_ACCOUNT de la fiche ;
--      - `core.support_staff_add_note` (note interne) : sujet USER_ACCOUNT de la note ;
--      - `core.support_staff_open_case` (dossier de support) : USER_ACCOUNT du demandeur ;
--      - `core.support_staff_set_case_status` (état d'un dossier) : SUPPORT_CASE (demandeur et
--        parties de son trip) ;
--      - `core.iam_staff_cmd_data_access` (porte des lectures C3) : SUPPORT_CASE du dossier qui
--        justifie l'accès ET sujet lu (`USER` lu comme USER_ACCOUNT ; un type que la garde ne
--        connaît pas vaut conflit, fail-closed, comme ADR-122).
--    Issue SELF_FORBIDDEN, journalisée STAFF_FORBIDDEN (`reason` = `SELF`), pour tous les rôles
--    (ADMIN compris), avant toute lecture ou écriture du sujet ; aucune ligne d'accès, aucune note,
--    aucun dossier, aucun changement d'état. L'API rend déjà 403 STAFF_SELF_FORBIDDEN pour cette
--    issue (`refusalOf`, US-122) ; la porte C3 la reçoit comme un refus (fail-closed).
--    Les cas légitimes sont inchangés : seuls les blocs marqués US-215c changent, le reste de
--    chaque définition est recopié à l'identique (0097 pour la fiche, 0064 pour la note et les
--    dossiers, 0051 pour la porte C3).
-- 2. N-126 : la pose d'une restriction ne prévient les voyageurs que si la personne n'était sous
--    AUCUNE restriction active (une seconde restriction d'une autre sorte n'envoie plus un second
--    avis) ; la levée de la DERNIÈRE restriction active émet `booking.trip.host_restriction_lifted`
--    pour chaque trip à venir des comptes d'hôte de la personne (même charge : trip_id,
--    guest_user_id, org_id ; jamais le motif), rendu par le gabarit NTF
--    EVT_TRIP_HOST_RESTRICTION_LIFTED. Les poses et levées d'une même personne sont sérialisées
--    par un verrou consultatif de la personne (en plus du verrou de la sorte, pris après lui).
--
-- Expand / contract : corps remplacés à signature, propriétaire et droits identiques ; une
-- fonction ajoutée (`core.booking_notify_host_restriction_lifted`) ; la politique
-- `cmd_hold_trip_notice_ins` admet le second type d'événement (même rôle, même agrégat, acteur
-- exigé). Le COMPORTEMENT se resserre volontairement (refus SELF_FORBIDDEN). La version N de l'API
-- traduit déjà SELF_FORBIDDEN (console) et une issue inconnue en refus (porte C3).
--
-- Retour arrière :
--   réappliquer core.support_staff_profile et core.iam_manual_action_restriction de 0097 (sous
--     iam_staff_owner, iam_auth_owner), core.support_staff_add_note, core.support_staff_open_case
--     et core.support_staff_set_case_status de 0064 (CREATE OR REPLACE, sous iam_staff_owner),
--     core.iam_staff_cmd_data_access de 0051 (idem) ;
--   ALTER POLICY cmd_hold_trip_notice_ins ON core.outbox_outbox_event
--     WITH CHECK (type = 'booking.trip.host_restricted' AND aggregate_type = 'trip'
--                 AND actor_user_id IS NOT NULL) ;
--   DROP FUNCTION core.booking_notify_host_restriction_lifted(uuid, uuid, text, uuid).

-- 1. N-116 : la garde unique sur les cinq entrées restantes (sous iam_staff_owner) --------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- 1.1 Fiche 360° (définition de 0097 recopiée ; bloc US-215c)
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
  -- US-215c (N-116, ADR-156 ; ADR-122) : jamais une personne qui concerne l'agent (elle-même, une
  -- personne de ses comptes d'hôte, un compte lié), quel que soit le rôle ; refus journalisé
  IF v_role IS NOT NULL
     AND core.support_actor_conflict(v_s.user_id, 'USER_ACCOUNT', p_user_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_FORBIDDEN', 'USER_ACCOUNT', p_user_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF',
                                   'attempted', 'DATA_ACCESS', 'permission', 'support.read_profile',
                                   'access_kind', 'READ_C2_SUPPORT',
                                   'country', v_country),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::jsonb;
    RETURN;
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

-- 1.2 Note interne (définition de 0064 recopiée ; bloc US-215c)
CREATE OR REPLACE FUNCTION core.support_staff_add_note(p_token_hash bytea, p_request_id uuid, p_user_id uuid,
                                            p_body text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_country text;
  v_role    text;
  v_cover   text;
  v_prev    record;
  v_body    text := pg_catalog.btrim(p_body);
BEGIN
  IF p_request_id IS NULL OR p_user_id IS NULL OR v_body IS NULL
     OR pg_catalog.char_length(v_body) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'note : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('support.internal_note:' || p_request_id::text, 0));
  SELECT n.id, n.subject_id, n.author_user_id INTO v_prev
    FROM core.support_internal_note AS n WHERE n.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.subject_id = p_user_id AND v_prev.author_user_id = v_s.user_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, pg_catalog.jsonb_build_object('noteId', v_prev.id);
      RETURN;
    END IF;
    RAISE EXCEPTION 'note : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_country := core.ctr_account_country(p_user_id);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.write_note', ARRAY[v_country], NULL);
  END IF;
  -- US-215c (N-116, ADR-156 ; ADR-122) : jamais une personne qui concerne l'agent (elle-même, une
  -- personne de ses comptes d'hôte, un compte lié), quel que soit le rôle ; refus journalisé
  IF v_role IS NOT NULL
     AND core.support_actor_conflict(v_s.user_id, 'USER_ACCOUNT', p_user_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_FORBIDDEN', 'USER_ACCOUNT', p_user_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF',
                                   'attempted', 'INTERNAL_NOTE', 'permission', 'support.write_note',
                                   'country', v_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::jsonb;
    RETURN;
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
                                   'attempted', 'INTERNAL_NOTE', 'permission', 'support.write_note')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL THEN 'CASE_REQUIRED' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  INSERT INTO core.support_internal_note (id, subject_type, subject_id, country_code,
                                          author_user_id, author_role, body)
  VALUES (p_request_id, 'USER_ACCOUNT', p_user_id, v_country, v_s.user_id, v_role, v_body);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'INTERNAL_NOTE_ADDED', 'USER_ACCOUNT', p_user_id,
                               NULL,
                               pg_catalog.jsonb_build_object('country', v_country,
                                 'noteId', p_request_id),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'ADDED'::text, pg_catalog.jsonb_build_object('noteId', p_request_id);
END
$fn$;

-- 1.3 Ouverture d'un dossier de support (définition de 0064 recopiée ; bloc US-215c)
CREATE OR REPLACE FUNCTION core.support_staff_open_case(p_token_hash bytea, p_request_id uuid,
                                             p_requester uuid, p_category text, p_priority text,
                                             p_channel text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_country text;
  v_role    text;
  v_prev    record;
BEGIN
  IF p_request_id IS NULL OR p_requester IS NULL
     OR p_category IS NULL OR p_category NOT IN ('TRIP', 'PAYMENT', 'ACCOUNT', 'LISTING', 'CLAIM',
                                                 'SAFETY', 'OTHER')
     OR p_priority IS NULL OR p_priority NOT IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')
     OR p_channel IS NULL OR p_channel NOT IN ('WHATSAPP', 'EMAIL', 'PHONE', 'IN_APP') THEN
    RAISE EXCEPTION 'dossier : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('support.case:' || p_request_id::text, 0));
  SELECT c.id, c.requester_user_id, c.assignee_id INTO v_prev
    FROM core.support_support_case AS c WHERE c.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.requester_user_id = p_requester AND v_prev.assignee_id = v_s.user_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, pg_catalog.jsonb_build_object('caseId', v_prev.id);
      RETURN;
    END IF;
    RAISE EXCEPTION 'dossier : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_country := core.ctr_account_country(p_requester);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.case_write', ARRAY[v_country], NULL);
  END IF;
  -- US-215c (N-116, ADR-156 ; ADR-122) : jamais un dossier dont l'agent est le demandeur, ou dont
  -- le demandeur le concerne (personne de ses comptes d'hôte, compte lié) ; refus journalisé
  IF v_role IS NOT NULL
     AND core.support_actor_conflict(v_s.user_id, 'USER_ACCOUNT', p_requester) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_FORBIDDEN', 'USER_ACCOUNT',
                                 p_requester, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF',
                                   'attempted', 'SUPPORT_CASE_OPEN', 'permission', 'support.case_write',
                                   'country', v_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER_ACCOUNT',
                                 p_requester, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_country IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION' END,
                                   'attempted', 'SUPPORT_CASE_OPEN', 'permission', 'support.case_write')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  INSERT INTO core.support_support_case (id, requester_user_id, country_code, channel, category,
                                         priority, status, assignee_id, created_by, updated_by)
  VALUES (p_request_id, p_requester, v_country, p_channel, p_category, p_priority, 'OPEN',
          v_s.user_id, v_s.user_id, v_s.user_id);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'SUPPORT_CASE_OPENED', 'SUPPORT_CASE',
                               p_request_id, NULL,
                               pg_catalog.jsonb_build_object('country', v_country,
                                 'category', p_category, 'priority', p_priority,
                                 'channel', p_channel),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'OPENED'::text, pg_catalog.jsonb_build_object('caseId', p_request_id,
                                                                     'country', v_country);
END
$fn$;

-- 1.4 État d'un dossier de support (définition de 0064 recopiée ; bloc US-215c)
CREATE OR REPLACE FUNCTION core.support_staff_set_case_status(p_token_hash bytea, p_request_id uuid,
                                                   p_case_id uuid, p_status text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_case record;
  v_role text;
BEGIN
  IF p_request_id IS NULL OR p_case_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('PENDING', 'RESOLVED', 'CLOSED') THEN
    RAISE EXCEPTION 'dossier : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT c.id, c.country_code, c.status, c.assignee_id, c.category INTO v_case
    FROM core.support_support_case AS c WHERE c.id = p_case_id FOR UPDATE;
  IF v_case.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.case_write',
                                       ARRAY[v_case.country_code], NULL);
  END IF;
  IF v_role IS NULL OR v_case.category = 'BREAK_GLASS' OR v_case.status = 'CLOSED'
     OR (v_role <> 'ADMIN' AND v_case.assignee_id IS DISTINCT FROM v_s.user_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'SUPPORT_CASE', p_case_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_case.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        WHEN v_role IS NULL THEN 'PERMISSION' ELSE 'CASE' END,
                                   'attempted', 'SUPPORT_CASE_STATUS')
                                 || CASE WHEN v_case.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_case.country_code) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL THEN 'CASE_REQUIRED' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  -- US-215c (N-116, ADR-156 ; ADR-122) : jamais un dossier qui concerne l'agent (demandeur, parties
  -- de son trip, compte lié), ADMIN compris ; refus journalisé, état inchangé
  IF core.support_actor_conflict(v_s.user_id, 'SUPPORT_CASE', p_case_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_FORBIDDEN', 'SUPPORT_CASE', p_case_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF',
                                   'attempted', 'SUPPORT_CASE_STATUS',
                                   'country', v_case.country_code),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  UPDATE core.support_support_case AS c SET status = p_status, updated_by = v_s.user_id
   WHERE c.id = p_case_id;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'SUPPORT_CASE_STATUS_CHANGED', 'SUPPORT_CASE',
                               p_case_id, pg_catalog.jsonb_build_object('status', v_case.status),
                               pg_catalog.jsonb_build_object('country', v_case.country_code,
                                 'status', p_status),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'UPDATED'::text, pg_catalog.jsonb_build_object('caseId', p_case_id,
                                                                      'status', p_status);
END
$fn$;

-- 1.5 Porte des lectures C3 (définition de 0051 recopiée ; bloc US-215c)
CREATE OR REPLACE FUNCTION core.iam_staff_cmd_data_access(p_token_hash bytea, p_request_id uuid,
                                               p_case_id uuid, p_subject_type text,
                                               p_subject_id uuid, p_field_or_file text,
                                               p_access_kind text, p_purpose text)
  RETURNS TABLE (outcome text, access_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s       record;
  v_case    record;
  v_role    text;
  v_reason  text;
  v_id      uuid;
  v_purpose text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_case_id IS NULL OR p_subject_id IS NULL
     OR p_subject_type IS NULL OR p_subject_type !~ '^[A-Z][A-Z0-9_]{1,63}$'
     OR p_field_or_file IS NULL OR p_field_or_file !~ '^[A-Za-z0-9_.:-]{1,160}$'
     OR p_access_kind IS NULL OR p_access_kind NOT IN ('READ_C3', 'BREAK_GLASS')
     OR v_purpose IS NULL OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'accès aux données : entrée invalide ou type d''accès non pris en charge'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', p_subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive',
                                   'access_kind', p_access_kind, 'field_or_file', p_field_or_file),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT c.country_code, c.status, c.assignee_id, c.category INTO v_case
    FROM core.support_support_case AS c WHERE c.id = p_case_id;
  IF v_case.country_code IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'kyc.read_sensitive',
                                       ARRAY[v_case.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_case.country_code IS NULL THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN v_case.status NOT IN ('OPEN', 'PENDING') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_case.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    WHEN (p_access_kind = 'BREAK_GLASS') <> (v_case.category = 'BREAK_GLASS') THEN 'CASE'
    -- US-215c (N-116, ADR-156 ; ADR-122) : jamais un dossier ni un sujet qui concerne l'agent,
    -- ADMIN et bris de glace compris ; `USER` est lu comme USER_ACCOUNT ; un type de sujet que la
    -- garde ne connaît pas vaut conflit (fail-closed)
    WHEN core.support_actor_conflict(v_s.user_id, 'SUPPORT_CASE', p_case_id)
      OR core.support_actor_conflict(v_s.user_id,
           CASE WHEN p_subject_type = 'USER' THEN 'USER_ACCOUNT' ELSE p_subject_type END,
           p_subject_id) THEN 'SELF'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 p_subject_type, p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive',
                                   'access_kind', p_access_kind, 'field_or_file', p_field_or_file,
                                   'case_id', p_case_id)
                                 || CASE WHEN v_case.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_case.country_code) END,
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_reason = 'SELF' THEN 'SELF_FORBIDDEN'  -- US-215c
                             ELSE 'FORBIDDEN' END::text, NULL::uuid;
    RETURN;
  END IF;
  v_id := pg_catalog.gen_random_uuid();
  INSERT INTO core.audit_data_access_log
         (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
          access_kind, case_ref, request_id)
  VALUES (v_id, v_s.user_id, v_role, p_subject_type, p_subject_id, p_field_or_file, v_purpose,
          p_access_kind, p_case_id::text, p_request_id);
  -- audit EN DERNIER (passation US-009 : tête de chaîne tenue jusqu'au COMMIT)
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_DATA_ACCESS', p_subject_type,
                               p_subject_id, NULL,
                               pg_catalog.jsonb_build_object('country', v_case.country_code,
                                 'access_kind', p_access_kind, 'field_or_file', p_field_or_file,
                                 'case_id', p_case_id, 'data_access_id', v_id),
                               v_purpose, p_request_id);
  RETURN QUERY SELECT 'GRANTED'::text, v_id;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 2. N-126 : avis des voyageurs à la pose et à la levée de la restriction de leur hôte ----------
-- 2.1 Levée : un événement booking.trip.host_restriction_lifted par trip à venir des comptes
-- d'hôte de la personne (sous cmd_hold_owner, module BKG ; notification NTF
-- EVT_TRIP_HOST_RESTRICTION_LIFTED, adaptateurs FAKE seulement). Même charge que la pose (0097) :
-- trip_id, guest_user_id, org_id ; jamais le motif ni une donnée de l'hôte.
ALTER POLICY cmd_hold_trip_notice_ins ON core.outbox_outbox_event
  WITH CHECK (type IN ('booking.trip.host_restricted', 'booking.trip.host_restriction_lifted')
              AND aggregate_type = 'trip' AND actor_user_id IS NOT NULL);
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;
CREATE FUNCTION core.booking_notify_host_restriction_lifted(p_holder uuid, p_actor uuid,
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
    RAISE EXCEPTION 'restriction levée : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
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
    VALUES (v_id, 'booking.trip.host_restriction_lifted', 1, 'trip', r.id, 0, r.country_code, p_actor,
            p_actor_role, pg_catalog.gen_random_uuid(), p_causation,
            pg_catalog.jsonb_build_object('trip_id', r.id, 'guest_user_id', r.guest_user_id,
                                          'org_id', r.org_id),
            r.id::text);
    v_ids := v_ids || v_id;
  END LOOP;
  RETURN v_ids;
END
$fn$;
COMMENT ON FUNCTION core.booking_notify_host_restriction_lifted(uuid, uuid, text, uuid) IS
  'Un événement booking.trip.host_restriction_lifted par trip à venir (BOOKED, CHECKIN_OPEN) des '
  'comptes d''hôte de la personne dont la dernière restriction est levée (08 BR-TRUST-09). '
  'SECURITY DEFINER, EXECUTE iam_auth_owner. US-215c (ADR-156, N-126).';
REVOKE ALL ON FUNCTION core.booking_notify_host_restriction_lifted(uuid, uuid, text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_notify_host_restriction_lifted(uuid, uuid, text, uuid)
  TO iam_auth_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 2.2 Pose et levée d'une restriction (définition de 0097 recopiée ; blocs US-215c) ; sous
-- iam_auth_owner
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
  -- US-215c (N-126, ADR-156) : poses et levées d'une même personne sérialisées (verrou de la
  -- personne, pris AVANT celui de la sorte) : l'avis aux voyageurs dépend des autres sortes
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('iam.restriction.person:' || p_subject_id::text, 0));
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
    -- d'hôte de la personne restreinte est prévenu (un événement par trip, même transaction).
    -- US-215c (N-126, ADR-156) : une seule fois, quand la personne passe de « aucune restriction
    -- active » à « restreinte » ; une restriction d'une autre sorte déjà active a déjà prévenu
    IF NOT EXISTS (SELECT 1 FROM core.iam_restriction AS r
                    WHERE r.user_id = p_subject_id AND r.active AND r.id <> p_action_id) THEN
      v_ev := core.booking_notify_host_restricted(p_subject_id, p_actor, p_actor_role,
                                                  p_action_id);
    ELSE
      v_ev := '{}'::uuid[];
    END IF;
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
  -- US-215c (N-126, ADR-156 ; 08 BR-TRUST-09) : la levée de la DERNIÈRE restriction active
  -- prévient chaque voyageur d'un trip à venir que son hôte n'est plus restreint
  IF NOT EXISTS (SELECT 1 FROM core.iam_restriction AS r
                  WHERE r.user_id = p_subject_id AND r.active) THEN
    v_ev := core.booking_notify_host_restriction_lifted(p_subject_id, p_actor, p_actor_role,
                                                        p_action_id);
  ELSE
    v_ev := '{}'::uuid[];
  END IF;
  RETURN QUERY SELECT 'DONE'::text, v_id, v_ev;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;
