-- 0161 — SUP : demande d'aide pendant le trip (voyageur ou hôte), réponse automatique hors plage
-- et mesure du délai de première réponse (M6).
-- US-310 ; 19 US-310 (critères 1 à 3) ; 16 SUP-004 / SUP-011 (« ticket(trip_id, channel, lang,
-- first_response_at, resolved_at) », états OPEN → PENDING → RESOLVED, « hors plage → message
-- automatique », M6), SUP-020 (plage publiée couverte par un planning validé) ; 17 §2.3, §3.2.13
-- (`support_case`), §4.5 ; 08 BR-PROT-05 ; 10b S17 ; ADR-174 (numéros de la configuration pays),
-- ADR-122 / ADR-156 (garde de séparation des tâches) ; ADR-182 (cette migration, PROPOSÉ).
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-182, PROPOSÉS) :
--   1. Une demande d'aide est un dossier `core.support_support_case` du canal IN_APP, lié au trip,
--      ouvert par la personne de la SESSION (IDOR : jamais un identifiant de personne reçu) qui est
--      le voyageur du trip ou le titulaire de son compte d'hôte ; tout autre appelant, ou un trip
--      inconnu, reçoit la même issue NOT_FOUND, sans écriture. Données minimisées : un motif fermé
--      (`help_topic` : ACCIDENT, BREAKDOWN, HANDOVER, SAFETY, OTHER), le rôle de la personne dans le
--      trip, l'indicateur « hors plage » ; aucun texte libre, aucun téléphone, aucune position.
--   2. Idempotence par l'identifiant de la demande (DUPLICATE pour la même personne, le même trip et
--      le même motif ; sinon refus 22023) et au plus UNE demande vivante (OPEN, PENDING) par
--      personne, trip et motif (EXISTS rend la demande vivante ; aucun second événement).
--   3. « Hors plage » est jugé par la base, à son horloge (`platform.now()`) et au fuseau du pays du
--      trip (`config_country.time_zone`), contre la plage du support transmise par l'API depuis la
--      configuration pays (`help.supportHours`, donnée du fondateur, SUP-020) : `null` (plage non
--      publiée) ⇒ toujours hors plage (fail-closed : la réponse automatique part, aucun délai n'est
--      promis). Une plage mal formée est refusée (22023).
--   4. Événement `support.help_request.received` (ajout au catalogue de 17 §4.5, PROPOSÉ) : case_id,
--      trip_id, requester_user_id, requester_role, topic, off_hours, auto_reply (GUEST, HOST ou
--      NONE) ; NTF envoie la réponse automatique dans la langue du compte quand auto_reply ≠ NONE.
--      Aucune autre donnée personnelle que l'identifiant du compte destinataire.
--   5. M6 : la PREMIÈRE action d'un agent sur une demande d'aide (`support_staff_set_case_status`)
--      pose `first_response_at` ; RESOLVED pose `resolved_at` ; un agent qui détient
--      `support.case_write` dans le pays prend une demande d'aide non assignée par cette première
--      action (assignee_id), toujours sous la garde ADR-122 (jamais sur un dossier qui le concerne).
--      `core.support_staff_help_requests` liste les demandes vivantes (sans donnée personnelle) et
--      la mesure M6 des 28 derniers jours, par pays permis.
--
-- Expand / contract : colonnes ajoutées NULL (les dossiers existants restent valides) ; trois
-- fonctions ajoutées ; `core.support_staff_set_case_status` remplacée à signature, propriétaire et
-- droits identiques (définition de 0132 recopiée, blocs US-310 marqués). La version N de l'API
-- n'appelle pas les nouvelles fonctions ; la version N + 1 les appelle.
--
-- Retour arrière :
--   réappliquer core.support_staff_set_case_status de 0132 (CREATE OR REPLACE, sous
--     iam_staff_owner) ;
--   DROP FUNCTION core.support_cmd_open_help_request(bytea, uuid, uuid, text, jsonb),
--     core.support_trip_help_context(bytea, uuid), core.support_staff_help_requests(bytea, text, integer) ;
--   DROP POLICY iam_staff_help_insert ON core.support_support_case ;
--   DROP POLICY iam_staff_help_event ON core.outbox_outbox_event ;
--   DROP INDEX core.support_case_help_live_unique, core.support_case_help_country_idx ;
--   ALTER TABLE core.support_support_case DROP CONSTRAINT support_case_help_shape,
--     DROP CONSTRAINT support_case_first_response_after, DROP CONSTRAINT support_case_resolved_after,
--     DROP COLUMN help_topic, DROP COLUMN requester_role, DROP COLUMN off_hours,
--     DROP COLUMN first_response_at, DROP COLUMN resolved_at ;
--   révoquer les droits accordés ci-dessous.

-- 1. Colonnes de la demande d'aide (16 SUP-004 « Données ») -----------------------------------------
ALTER TABLE core.support_support_case
  ADD COLUMN help_topic        text
    CONSTRAINT support_case_help_topic_valid CHECK (help_topic IN
      ('ACCIDENT', 'BREAKDOWN', 'HANDOVER', 'SAFETY', 'OTHER')),
  ADD COLUMN requester_role    text
    CONSTRAINT support_case_requester_role_valid CHECK (requester_role IN ('GUEST', 'HOST')),
  ADD COLUMN off_hours         boolean,
  ADD COLUMN first_response_at timestamptz,
  ADD COLUMN resolved_at       timestamptz,
  -- une demande d'aide porte toujours son motif, le rôle du demandeur, l'indicateur hors plage, le
  -- trip et le canal IN_APP ; un dossier du staff n'en porte aucun
  ADD CONSTRAINT support_case_help_shape CHECK (
    (help_topic IS NULL AND requester_role IS NULL AND off_hours IS NULL)
    OR (help_topic IS NOT NULL AND requester_role IS NOT NULL AND off_hours IS NOT NULL
        AND trip_id IS NOT NULL AND requester_user_id IS NOT NULL AND channel = 'IN_APP'
        AND category IN ('TRIP', 'SAFETY'))),
  ADD CONSTRAINT support_case_first_response_after
    CHECK (first_response_at IS NULL OR first_response_at >= created_at),
  ADD CONSTRAINT support_case_resolved_after
    CHECK (resolved_at IS NULL OR resolved_at >= created_at);

-- au plus une demande vivante par personne, trip et motif (ADR-182 point 2)
CREATE UNIQUE INDEX support_case_help_live_unique ON core.support_support_case
  (requester_user_id, trip_id, help_topic)
  WHERE (help_topic IS NOT NULL AND status IN ('OPEN', 'PENDING'));
-- liste de la console et mesure M6 par pays
CREATE INDEX support_case_help_country_idx ON core.support_support_case (country_code, created_at)
  WHERE (help_topic IS NOT NULL);

COMMENT ON COLUMN core.support_support_case.help_topic IS
  'Motif fermé d''une demande d''aide du trip (ACCIDENT, BREAKDOWN, HANDOVER, SAFETY, OTHER) ; NULL : '
  'dossier ouvert par le staff. Aucun texte libre (minimisation). US-310 (ADR-182).';
COMMENT ON COLUMN core.support_support_case.requester_role IS
  'Rôle du demandeur dans le trip (GUEST : voyageur ; HOST : titulaire du compte d''hôte). US-310.';
COMMENT ON COLUMN core.support_support_case.off_hours IS
  'Demande reçue hors de la plage publiée du support (jugé par la base au fuseau du pays ; plage non '
  'publiée : true). US-310 (ADR-182, SUP-020).';
COMMENT ON COLUMN core.support_support_case.first_response_at IS
  'Première action d''un agent sur la demande d''aide (M6 = first_response_at - created_at). US-310.';
COMMENT ON COLUMN core.support_support_case.resolved_at IS
  'Première résolution (RESOLVED) de la demande d''aide. US-310.';

-- 2. Droits d'iam_staff_owner, au plus juste --------------------------------------------------------
GRANT SELECT (help_topic, requester_role, off_hours, first_response_at, resolved_at)
  ON core.support_support_case TO iam_staff_owner;
GRANT INSERT (trip_id, help_topic, requester_role, off_hours)
  ON core.support_support_case TO iam_staff_owner;
GRANT UPDATE (assignee_id, first_response_at, resolved_at)
  ON core.support_support_case TO iam_staff_owner;
-- une demande d'aide : canal IN_APP, ouverte, non assignée, sans motif C2 (politique permissive,
-- s'ajoute à iam_staff_insert de 0064 qui reste celle des dossiers du staff)
CREATE POLICY iam_staff_help_insert ON core.support_support_case FOR INSERT TO iam_staff_owner
  WITH CHECK (help_topic IS NOT NULL AND channel = 'IN_APP' AND status = 'OPEN'
              AND assignee_id IS NULL AND reason IS NULL AND category <> 'BREAK_GLASS');
GRANT SELECT (time_zone) ON core.config_country TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.iam_session_resolve(bytea) TO iam_staff_owner;
-- événement de la demande (acteur = la personne, rôle GUEST ou HOST)
CREATE POLICY iam_staff_help_event ON core.outbox_outbox_event FOR INSERT TO iam_staff_owner
  WITH CHECK (type = 'support.help_request.received' AND aggregate_type = 'support_case'
              AND actor_user_id IS NOT NULL AND actor_role IN ('GUEST', 'HOST'));

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- 3. Contexte d'aide d'un trip pour la personne de la session ----------------------------------------
-- Rôle (GUEST, HOST) et pays du trip ; tout autre appelant ou un trip inconnu : NOT_FOUND (même
-- réponse, IDOR). Aucune donnée personnelle rendue.
CREATE FUNCTION core.support_trip_help_context(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (outcome text, requester_role text, country_code text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_t    record;
  v_role text;
BEGIN
  IF p_trip_id IS NULL THEN
    RAISE EXCEPTION 'aide : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT t.id, t.country_code, t.guest_user_id, o.holder_user_id INTO v_t
    FROM core.booking_trip AS t
    JOIN core.iam_organization AS o ON o.id = t.org_id
   WHERE t.id = p_trip_id;
  v_role := CASE WHEN v_t.id IS NULL THEN NULL
                 WHEN v_t.guest_user_id = v_user THEN 'GUEST'
                 WHEN v_t.holder_user_id = v_user THEN 'HOST' END;
  IF v_role IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'DONE'::text, v_role, v_t.country_code::text;
END
$fn$;

-- 4. Demande d'aide du trip (ADR-182 points 1 à 4) ---------------------------------------------------
CREATE FUNCTION core.support_cmd_open_help_request(p_token_hash bytea, p_request_id uuid,
                                                   p_trip_id uuid, p_topic text,
                                                   p_support_hours jsonb)
  RETURNS TABLE (outcome text, case_id uuid, off_hours boolean, requester_role text,
                 country_code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user  uuid;
  v_t     record;
  v_role  text;
  v_prev  record;
  v_tz    text;
  v_now   timestamptz;
  v_local time;
  v_off   boolean;
  v_cat   text;
  v_prio  text;
  v_from  text;
  v_to    text;
BEGIN
  IF p_request_id IS NULL OR p_trip_id IS NULL OR p_topic IS NULL
     OR p_topic NOT IN ('ACCIDENT', 'BREAKDOWN', 'HANDOVER', 'SAFETY', 'OTHER') THEN
    RAISE EXCEPTION 'aide : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- plage du support (configuration pays) : null, ou exactement { from, to } en HH:MM, from < to
  IF p_support_hours IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_support_hours) <> 'object'
       OR (SELECT pg_catalog.array_agg(k ORDER BY k)
             FROM pg_catalog.jsonb_object_keys(p_support_hours) AS k) IS DISTINCT FROM
          ARRAY['from', 'to']::text[]
       OR pg_catalog.jsonb_typeof(p_support_hours -> 'from') <> 'string'
       OR pg_catalog.jsonb_typeof(p_support_hours -> 'to') <> 'string' THEN
      RAISE EXCEPTION 'aide : plage invalide' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_from := p_support_hours ->> 'from';
    v_to := p_support_hours ->> 'to';
    IF v_from !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR v_to !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       OR v_from >= v_to THEN
      RAISE EXCEPTION 'aide : plage invalide' USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;
  -- personne de la SESSION (IDOR : jamais un identifiant de personne reçu)
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::boolean, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT t.id, t.country_code, t.guest_user_id, o.holder_user_id INTO v_t
    FROM core.booking_trip AS t
    JOIN core.iam_organization AS o ON o.id = t.org_id
   WHERE t.id = p_trip_id;
  v_role := CASE WHEN v_t.id IS NULL THEN NULL
                 WHEN v_t.guest_user_id = v_user THEN 'GUEST'
                 WHEN v_t.holder_user_id = v_user THEN 'HOST' END;
  IF v_role IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::boolean, NULL::text, NULL::text;
    RETURN;
  END IF;
  -- sérialisation : la demande (rejeu), puis la personne, le trip et le motif (demande vivante)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('support.help:' || p_request_id::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'support.help:' || v_user::text || ':' || p_trip_id::text || ':' || p_topic, 0));
  SELECT c.id, c.requester_user_id, c.trip_id, c.help_topic, c.off_hours INTO v_prev
    FROM core.support_support_case AS c WHERE c.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.requester_user_id = v_user AND v_prev.trip_id = p_trip_id
       AND v_prev.help_topic IS NOT DISTINCT FROM p_topic THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_prev.id, v_prev.off_hours, v_role,
                          v_t.country_code::text;
      RETURN;
    END IF;
    RAISE EXCEPTION 'aide : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT c.id, c.off_hours INTO v_prev
    FROM core.support_support_case AS c
   WHERE c.requester_user_id = v_user AND c.trip_id = p_trip_id AND c.help_topic = p_topic
     AND c.status IN ('OPEN', 'PENDING');
  IF v_prev.id IS NOT NULL THEN
    RETURN QUERY SELECT 'EXISTS'::text, v_prev.id, v_prev.off_hours, v_role, v_t.country_code::text;
    RETURN;
  END IF;
  -- hors plage : horloge de la base, fuseau du pays du trip (ADR-182 point 3)
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code = v_t.country_code;
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'aide : pays du trip non configuré' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_now := platform.now();
  v_local := (v_now AT TIME ZONE v_tz)::time;
  v_off := p_support_hours IS NULL OR v_local < v_from::time OR v_local >= v_to::time;
  v_cat := CASE WHEN p_topic IN ('ACCIDENT', 'SAFETY') THEN 'SAFETY' ELSE 'TRIP' END;
  v_prio := CASE WHEN p_topic IN ('ACCIDENT', 'SAFETY') THEN 'URGENT'
                 WHEN p_topic IN ('BREAKDOWN', 'HANDOVER') THEN 'HIGH'
                 ELSE 'NORMAL' END;
  INSERT INTO core.support_support_case (id, requester_user_id, country_code, trip_id, channel,
                                         category, priority, status, assignee_id, help_topic,
                                         requester_role, off_hours, created_by, updated_by)
  VALUES (p_request_id, v_user, v_t.country_code, p_trip_id, 'IN_APP', v_cat, v_prio, 'OPEN', NULL,
          p_topic, v_role, v_off, v_user, v_user);
  -- réponse automatique hors plage (NTF), dans la langue du compte ; aucune donnée personnelle
  -- autre que l'identifiant du compte destinataire
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('support.help_request.received', 1, 'support_case', p_request_id, 0, v_t.country_code,
          v_user, v_role, pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object(
            'case_id', p_request_id, 'trip_id', p_trip_id, 'requester_user_id', v_user,
            'requester_role', v_role, 'topic', p_topic, 'off_hours', v_off,
            'auto_reply', CASE WHEN v_off THEN v_role ELSE 'NONE' END),
          p_request_id::text);
  RETURN QUERY SELECT 'OPENED'::text, p_request_id, v_off, v_role, v_t.country_code::text;
END
$fn$;

-- 5. Demandes d'aide vivantes et mesure M6, pour la console (ADR-182 point 5) -----------------------
CREATE FUNCTION core.support_staff_help_requests(p_token_hash bytea, p_country text,
                                                 p_limit integer)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s         record;
  v_now       timestamptz := platform.now();
  v_countries text[];
  v_items     jsonb;
  v_m6        jsonb;
BEGIN
  IF (p_country IS NOT NULL AND p_country !~ '^[A-Z]{2}$')
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'aide : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
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
  -- pays où l'acteur détient support.case_write par un rôle en cours (filtre facultatif)
  SELECT pg_catalog.array_agg(k.code::text ORDER BY k.code) INTO v_countries
    FROM core.config_country AS k
   WHERE (p_country IS NULL OR k.code = p_country)
     AND core.iam_staff_permitted(v_s.user_id, 'support.case_write', ARRAY[k.code::text], NULL)
         IS NOT NULL;
  IF v_countries IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'SUPPORT_CASE',
                                 pg_catalog.gen_random_uuid(), NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION',
                                   'attempted', 'HELP_REQUEST_READ',
                                   'permission', 'support.case_write')
                                 || CASE WHEN p_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', p_country) END,
                                 NULL, NULL);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  -- demandes vivantes : identifiants, motif, rôle, priorité, état, dates ; aucune donnée personnelle
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'caseId', x.id, 'tripId', x.trip_id, 'country', x.country_code, 'topic', x.help_topic,
           'requesterRole', x.requester_role, 'priority', x.priority, 'status', x.status,
           'offHours', x.off_hours, 'createdAt', x.created_at,
           'firstResponseAt', x.first_response_at, 'assigned', x.assignee_id IS NOT NULL,
           'assignedToMe', x.assignee_id IS NOT DISTINCT FROM v_s.user_id)
           ORDER BY x.prio_rank, x.created_at, x.id), '[]'::jsonb)
    INTO v_items
    FROM (SELECT c.*, CASE c.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1
                                      WHEN 'NORMAL' THEN 2 ELSE 3 END AS prio_rank
            FROM core.support_support_case AS c
           WHERE c.help_topic IS NOT NULL AND c.country_code = ANY (v_countries)
             AND c.status IN ('OPEN', 'PENDING')
           ORDER BY prio_rank, c.created_at, c.id
           LIMIT p_limit) AS x;
  -- M6 (16 §M6 « mesuré, cible fixée après 4 semaines ») : demandes des 28 derniers jours
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'country', m.country, 'opened', m.opened, 'answered', m.answered,
           'medianSeconds', m.median_s, 'p90Seconds', m.p90_s) ORDER BY m.country)
    INTO v_m6
    FROM (SELECT k.country,
                 pg_catalog.count(c.id) AS opened,
                 pg_catalog.count(c.first_response_at) AS answered,
                 (pg_catalog.percentile_disc(0.5) WITHIN GROUP (ORDER BY
                    pg_catalog.date_part('epoch', c.first_response_at - c.created_at)))::bigint
                   AS median_s,
                 (pg_catalog.percentile_disc(0.9) WITHIN GROUP (ORDER BY
                    pg_catalog.date_part('epoch', c.first_response_at - c.created_at)))::bigint
                   AS p90_s
            FROM pg_catalog.unnest(v_countries) AS k(country)
            LEFT JOIN core.support_support_case AS c
              ON c.country_code = k.country AND c.help_topic IS NOT NULL
             AND c.created_at >= v_now - pg_catalog.make_interval(days => 28)
           GROUP BY k.country) AS m;
  RETURN QUERY SELECT 'OK'::text, pg_catalog.jsonb_build_object('items', v_items, 'm6', v_m6,
                                                                'windowDays', 28);
END
$fn$;

-- 6. État d'un dossier de support (définition de 0132 recopiée ; blocs US-310) ----------------------
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
  v_take boolean;
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
  SELECT c.id, c.country_code, c.status, c.assignee_id, c.category, c.help_topic INTO v_case
    FROM core.support_support_case AS c WHERE c.id = p_case_id FOR UPDATE;
  IF v_case.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.case_write',
                                       ARRAY[v_case.country_code], NULL);
  END IF;
  -- US-310 (ADR-182 point 5) : une demande d'aide non assignée est prise par la première action
  -- d'un agent qui détient support.case_write dans son pays (après la garde ADR-122 ci-dessous)
  v_take := v_role IS NOT NULL AND v_case.help_topic IS NOT NULL AND v_case.assignee_id IS NULL;
  IF v_role IS NULL OR v_case.category = 'BREAK_GLASS' OR v_case.status = 'CLOSED'
     OR (v_role <> 'ADMIN' AND NOT v_take
         AND v_case.assignee_id IS DISTINCT FROM v_s.user_id) THEN
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
  -- US-310 : prise d'une demande d'aide non assignée ; M6 (première action) et résolution
  UPDATE core.support_support_case AS c
     SET status = p_status, updated_by = v_s.user_id,
         assignee_id = CASE WHEN v_take THEN v_s.user_id ELSE c.assignee_id END,
         first_response_at = CASE WHEN c.help_topic IS NOT NULL
                                  THEN COALESCE(c.first_response_at, platform.now())
                                  ELSE c.first_response_at END,
         resolved_at = CASE WHEN c.help_topic IS NOT NULL AND p_status = 'RESOLVED'
                            THEN COALESCE(c.resolved_at, platform.now())
                            ELSE c.resolved_at END
   WHERE c.id = p_case_id;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'SUPPORT_CASE_STATUS_CHANGED', 'SUPPORT_CASE',
                               p_case_id, pg_catalog.jsonb_build_object('status', v_case.status),
                               pg_catalog.jsonb_build_object('country', v_case.country_code,
                                 'status', p_status)
                               || CASE WHEN v_take THEN pg_catalog.jsonb_build_object('taken', true)
                                       ELSE '{}'::jsonb END,
                               NULL, p_request_id);
  RETURN QUERY SELECT 'UPDATED'::text, pg_catalog.jsonb_build_object('caseId', p_case_id,
                                                                      'status', p_status);
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

COMMENT ON FUNCTION core.support_trip_help_context(bytea, uuid) IS
  'Rôle (GUEST, HOST) et pays d''un trip pour la personne de la session (aide S17) ; trip d''autrui ou '
  'inconnu : NOT_FOUND. SECURITY DEFINER, EXECUTE app_api. US-310 (ADR-182).';
COMMENT ON FUNCTION core.support_cmd_open_help_request(bytea, uuid, uuid, text, jsonb) IS
  'Demande d''aide du trip par son voyageur ou le titulaire de son compte d''hôte (SUP-004) : dossier '
  'IN_APP minimisé (motif fermé), hors plage jugé à l''horloge de la base au fuseau du pays, '
  'événement support.help_request.received (réponse automatique NTF). Idempotente ; une demande '
  'vivante par personne, trip et motif. SECURITY DEFINER, EXECUTE app_api. US-310 (ADR-182).';
COMMENT ON FUNCTION core.support_staff_help_requests(bytea, text, integer) IS
  'Demandes d''aide vivantes (sans donnée personnelle) et mesure M6 des 28 derniers jours, par pays '
  'où l''agent détient support.case_write (TOTP exigé ; refus journalisé). SECURITY DEFINER, EXECUTE '
  'app_api. US-310 (ADR-182).';

REVOKE ALL ON FUNCTION core.support_trip_help_context(bytea, uuid),
  core.support_cmd_open_help_request(bytea, uuid, uuid, text, jsonb),
  core.support_staff_help_requests(bytea, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_trip_help_context(bytea, uuid),
  core.support_cmd_open_help_request(bytea, uuid, uuid, text, jsonb),
  core.support_staff_help_requests(bytea, text, integer) TO app_api;
