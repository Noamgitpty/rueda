-- 0102 — REV : avis recueillis par l'ops, agrégats (note moyenne, nombre de trips) et note du voyageur.
-- US-218 ; 19 US-218 (« Given un avis recueilli par e-mail, When l'ops l'enregistre (`RECORD_REVIEW`),
-- Then il est rattaché au trip et journalisé » ; « Given 3 avis (5, 4, 3) et 2 trips non notés, When
-- l'agrégat est calculé, Then moyenne 4,0 et 5 trips ») ; 16 REV-001 / REV-010 (« trip non noté
-- exclu » de la moyenne ; bêta pilote : « nombre de trips et moyenne globale seulement, badge
-- Nuevo » ; REVIEW_WINDOW_CLOSED) ; 08 BR-REVIEW-01 (fenêtre de 10 jours après la fin,
-- `review_window_days`, pour le voyageur et pour l'hôte), BR-REVIEW-03 (note globale 1 à 5 et
-- sous-notes), BR-REVIEW-05 (« trip non noté exclu de la moyenne ») ; 17 §2.2 (REV), §3.2.12
-- (`review` : UQ `(trip_id, author_user_id, subject_type)`, « trip COMPLETED requis » ;
-- `rating_aggregate` : `count`, `avg_overall_x100`), §3.2.13 et §10 (`manual_action`,
-- `RECORD_REVIEW`), §2.3 (`host_guest_v` : note du voyageur) ; ADR-092 (cadre des actions de
-- console), ADR-126 (l'état du trip ne s'écrit que par les commandes d'US-207), ADR-128
-- (`core.booking_host_trips`) ; ADR-130 (cette migration). Appliquée sous `migrator`, en une
-- transaction.
--
-- Principes (ADR-130, PROPOSÉS) :
--   - RECORD_REVIEW devient une action d'ÉTAT liée (comme HANDLE_DSR en 0090) : 17 §10 en faisait
--     une action d'enregistrement seul faute de table cible en Bêta ; la table existe désormais.
--     Saisie FERMÉE du cadre (jamais un nombre) : `authorRole` ∈ {GUEST, HOST} (qui a donné l'avis
--     reçu par e-mail) et `overall` ∈ {ONE … FIVE} (note globale, BR-REVIEW-03). Le texte de l'avis
--     n'est PAS recopié (donnée C2) : l'e-mail reste une pièce de l'action. Sous-notes absentes
--     (bêta pilote SIMPLIFIÉ de 16 REV-001) ;
--   - commande liée `core.review_manual_action_record_review` (SECURITY DEFINER, propriétaire NOLOGIN
--     `review_cmd_owner`, EXECUTE au seul iam_staff_owner) : le cadre a déjà jugé session, TOTP,
--     permission, portée pays, saisie, idempotence et séparation des tâches ; la commande juge le
--     DOMAINE, à partir de l'état qui fait foi EN BASE :
--       * trip `COMPLETED` (lu dans booking_trip, écrit par les seules commandes d'US-207) ;
--       * fenêtre : `platform.now()` ≤ fin + `review_window_days` du pays du trip ; la fin est le
--         PREMIER des deux : fin prévue, ou retour enregistré (journal d'état : RETURNED,
--         TERMINATED_EARLY, VEHICLE_LOST) ; paramètre absent ou mal formé : refus (fail-closed) ;
--       * auteur relu en base, jamais reçu : voyageur du trip (GUEST) ou titulaire du compte d'hôte
--         du trip (HOST) ;
--       * une fois par partie et par trip : UQ `(trip_id, author_user_id, subject_type)` ; un second
--         enregistrement (même en parallèle) rend REVIEW_ALREADY_RECORDED, sans écriture ;
--     voyageur → deux lignes (sujets VEHICLE et HOST, même note) ; hôte → une ligne (sujet GUEST) ;
--     l'avis est PUBLISHED à l'enregistrement (la publication en double aveugle de REV-004 arrive
--     avec US-317) ; l'action et l'audit sont écrits par le cadre (0060 / 0093) ;
--   - `review_rating_aggregate` : projection tenue dans la MÊME transaction (upsert atomique) ;
--     moyenne ×100 arrondie au demi supérieur, recalculée par une contrainte (jamais saisie) ;
--     seuls les avis PUBLISHED comptent (un trip non noté n'entre pas dans la moyenne) ;
--   - nombre de trips (16 REV-010) : trips du compte d'hôte (ou du véhicule) à l'état COMPLETED ou
--     IN_DISPUTE (réalisés), compté à la lecture, jamais stocké ;
--   - lecture publique `core.review_listing_ratings(annonces)` (SECURITY DEFINER, review_cmd_owner,
--     EXECUTE au seul app_api) : par annonce LISTED, nombre de trips, nombre d'avis et moyenne du
--     véhicule et de l'hôte ; ni identifiant de compte, ni auteur, ni texte ; annonce inconnue ou non
--     LISTED : aucune ligne ; 100 annonces au plus ;
--   - note du voyageur vue par l'hôte (17 `host_guest_v`, ADR-128) : `core.booking_host_trips` (0101)
--     et `core.booking_host_guest_rows` (0035) rendent la moyenne des avis des hôtes sur ce voyageur
--     (NULL sans avis ou compte pseudonymisé) ; host_view_owner ne lit que les agrégats GUEST
--     (moyenne), jamais un avis ;
--   - registres immuables : un avis ne change plus (UPDATE, DELETE, TRUNCATE refusés à tout rôle,
--     migrator compris ; la modération de BR-REVIEW-07 arrive avec US-527) ; aucun droit des rôles
--     applicatifs sur les tables ; RLS ENABLE + FORCE ; aucune constante de pays.
--
-- Issues de la commande liée (colonne `outcome`, PROPOSÉES par ADR-130 sauf REVIEW_WINDOW_CLOSED de
-- 16) : DONE, REVIEW_INPUT_REQUIRED, REVIEW_TRIP_NOT_COMPLETED, REVIEW_WINDOW_CLOSED,
-- REVIEW_WINDOW_UNKNOWN, REVIEW_AUTHOR_UNKNOWN, REVIEW_ALREADY_RECORDED.
-- Erreur (SQLSTATE 23000, contrainte) traduite par packages/db/src/errors.ts :
--   review_record_immutable → IMMUTABLE_RECORD.
--
-- Expand / contract : tables, fonctions, déclencheurs, politiques et droits ajoutés ; ligne de
-- référence RECORD_REVIEW du catalogue passée de RECORD_ONLY à DOMAIN_COMMAND (saisie `authorRole`,
-- `overall`) : la version N, qui l'envoyait sans saisie, reçoit un refus métier
-- (`REVIEW_INPUT_REQUIRED`) au lieu d'un enregistrement ; aucune donnée n'est modifiée ni perdue.
-- Corps de core.booking_host_trips (0101) et core.booking_host_guest_rows (0035) remplacés à
-- signature, propriétaire et droits identiques (définitions recopiées, seule la note change).
--
-- Retour arrière (base sans dépendance) :
--   DELETE FROM core.support_manual_action_handler WHERE action_code = 'RECORD_REVIEW';
--   UPDATE core.support_manual_action_catalog SET mode = 'RECORD_ONLY', available = true,
--     input_keys = '{}', input_values = '{}' WHERE action_code = 'RECORD_REVIEW';
--   réappliquer core.booking_host_trips de 0101 et core.booking_host_guest_rows de 0035 (sous
--     host_view_owner) ;
--   DROP FUNCTION core.review_listing_ratings(uuid[]),
--     core.review_manual_action_record_review(bytea, uuid, text, uuid, jsonb, text, uuid, text),
--     core.review_record_guard();
--   DROP TABLE core.review_rating_aggregate, core.review_review;
--   DROP POLICY review_cmd_read ON core.booking_trip, core.booking_trip_state_log,
--     core.iam_organization, core.catalog_listing, core.config_param_value ;
--   révoquer les droits de review_cmd_owner et de host_view_owner accordés ci-dessous.

-- 1. Tables (17 §3.2.12) --------------------------------------------------------------------------

-- Avis d'une partie sur un trip. Voyageur : sujets VEHICLE (véhicule du trip) et HOST (compte
-- d'hôte du trip) ; hôte : sujet GUEST (voyageur du trip). Aucun texte (donnée C2) : l'avis reçu par
-- e-mail reste une pièce de l'action de console.
CREATE TABLE core.review_review (
  id                   uuid        CONSTRAINT review_review_pkey PRIMARY KEY,
  trip_id              uuid        NOT NULL
    CONSTRAINT review_review_trip_fkey REFERENCES core.booking_trip (id),
  country_code         text        NOT NULL
    CONSTRAINT review_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  author_user_id       uuid        NOT NULL
    CONSTRAINT review_review_author_fkey REFERENCES core.iam_user_account (id),
  author_role          text        NOT NULL
    CONSTRAINT review_author_role_valid CHECK (author_role IN ('GUEST', 'HOST')),
  subject_type         text        NOT NULL
    CONSTRAINT review_subject_type_valid CHECK (subject_type IN ('VEHICLE', 'HOST', 'GUEST')),
  subject_id           uuid        NOT NULL,
  -- note globale 1 à 5 (BR-REVIEW-03)
  overall              smallint    NOT NULL
    CONSTRAINT review_overall_range CHECK (overall BETWEEN 1 AND 5),
  -- sous-notes du voyageur (BR-REVIEW-03) : absentes en bêta pilote (16 REV-001 SIMPLIFIÉ)
  cleanliness          smallint
    CONSTRAINT review_cleanliness_range CHECK (cleanliness BETWEEN 1 AND 5),
  communication        smallint
    CONSTRAINT review_communication_range CHECK (communication BETWEEN 1 AND 5),
  convenience          smallint
    CONSTRAINT review_convenience_range CHECK (convenience BETWEEN 1 AND 5),
  accuracy             smallint
    CONSTRAINT review_accuracy_range CHECK (accuracy BETWEEN 1 AND 5),
  maintenance          smallint
    CONSTRAINT review_maintenance_range CHECK (maintenance BETWEEN 1 AND 5),
  status               text        NOT NULL
    CONSTRAINT review_status_valid CHECK (status IN ('PENDING', 'PUBLISHED', 'HIDDEN', 'REMOVED')),
  -- OPS_RECORDED : avis recueilli hors de l'application et enregistré par l'ops (US-218) ;
  -- l'avis dans l'application (US-317) ajoutera sa valeur
  source               text        NOT NULL
    CONSTRAINT review_source_valid CHECK (source IN ('OPS_RECORDED')),
  -- action de console qui l'a enregistré (support_manual_action.id, écrite après la commande liée
  -- dans la même transaction) et agent qui l'a saisie
  manual_action_id     uuid,
  recorded_by          uuid,
  published_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT review_unique_per_party UNIQUE (trip_id, author_user_id, subject_type),
  CONSTRAINT review_subject_matches_author CHECK (
    (author_role = 'GUEST' AND subject_type IN ('VEHICLE', 'HOST'))
    OR (author_role = 'HOST' AND subject_type = 'GUEST')),
  CONSTRAINT review_ops_recorded_traced CHECK (
    source <> 'OPS_RECORDED' OR (manual_action_id IS NOT NULL AND recorded_by IS NOT NULL)),
  CONSTRAINT review_published_dated CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL)
                                           OR status IN ('HIDDEN', 'REMOVED'))
);
CREATE INDEX review_review_subject_idx ON core.review_review (subject_type, subject_id);
COMMENT ON TABLE core.review_review IS
  'Avis d''une partie sur un trip COMPLETED (17 §3.2.12) : note globale, sujet, statut ; aucun texte. '
  'Une fois par partie, par trip et par sujet. Immuable. US-218 (ADR-130).';

-- Agrégat par sujet (17 §3.2.12 `rating_aggregate`) : avis PUBLISHED seulement. La moyenne ×100
-- est arrondie au demi supérieur et RECALCULÉE par la contrainte (jamais une saisie).
CREATE TABLE core.review_rating_aggregate (
  subject_type     text        NOT NULL
    CONSTRAINT rating_aggregate_subject_type_valid CHECK (subject_type IN ('VEHICLE', 'HOST', 'GUEST')),
  subject_id       uuid        NOT NULL,
  review_count     integer     NOT NULL
    CONSTRAINT rating_aggregate_count_positive CHECK (review_count >= 1),
  overall_sum      integer     NOT NULL,
  avg_overall_x100 integer     NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT review_rating_aggregate_pkey PRIMARY KEY (subject_type, subject_id),
  CONSTRAINT rating_aggregate_sum_range
    CHECK (overall_sum BETWEEN review_count AND 5 * review_count),
  CONSTRAINT rating_aggregate_avg_exact
    CHECK (avg_overall_x100 = (overall_sum * 200 + review_count) / (2 * review_count))
);
COMMENT ON TABLE core.review_rating_aggregate IS
  'Projection des avis PUBLISHED par sujet (VEHICLE, HOST, GUEST) : nombre, somme, moyenne ×100 '
  'arrondie au demi supérieur (contrainte). Tenue par la commande d''enregistrement dans la même '
  'transaction. US-218 (ADR-130).';

ALTER TABLE core.review_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.review_review FORCE ROW LEVEL SECURITY;
ALTER TABLE core.review_rating_aggregate ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.review_rating_aggregate FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.review_review TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.review_rating_aggregate TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.review_review, core.review_rating_aggregate FROM PUBLIC;

-- 2. Immuabilité des avis (tout rôle, migrator compris) -------------------------------------------
CREATE FUNCTION core.review_record_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'review record is immutable'
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'review_record_immutable';
END
$fn$;
REVOKE ALL ON FUNCTION core.review_record_guard() FROM PUBLIC;
CREATE TRIGGER review_review_guard BEFORE UPDATE OR DELETE ON core.review_review
  FOR EACH ROW EXECUTE FUNCTION core.review_record_guard();
CREATE TRIGGER review_review_no_truncate BEFORE TRUNCATE ON core.review_review
  FOR EACH STATEMENT EXECUTE FUNCTION core.review_record_guard();
CREATE TRIGGER review_rating_aggregate_no_truncate BEFORE TRUNCATE ON core.review_rating_aggregate
  FOR EACH STATEMENT EXECUTE FUNCTION core.review_record_guard();

-- 3. Droits de review_cmd_owner (au plus juste) ---------------------------------------------------
GRANT SELECT, INSERT ON core.review_review TO review_cmd_owner;
CREATE POLICY review_cmd_sel ON core.review_review FOR SELECT TO review_cmd_owner USING (true);
CREATE POLICY review_cmd_ins ON core.review_review FOR INSERT TO review_cmd_owner
  WITH CHECK (status = 'PUBLISHED' AND source = 'OPS_RECORDED');
GRANT SELECT, INSERT ON core.review_rating_aggregate TO review_cmd_owner;
GRANT UPDATE (review_count, overall_sum, avg_overall_x100, updated_at)
  ON core.review_rating_aggregate TO review_cmd_owner;
CREATE POLICY review_cmd_sel ON core.review_rating_aggregate FOR SELECT TO review_cmd_owner
  USING (true);
CREATE POLICY review_cmd_ins ON core.review_rating_aggregate FOR INSERT TO review_cmd_owner
  WITH CHECK (true);
CREATE POLICY review_cmd_upd ON core.review_rating_aggregate FOR UPDATE TO review_cmd_owner
  USING (true) WITH CHECK (true);

-- trip : état qui fait foi, parties, pays, fin prévue ; journal d'état : instant du retour
GRANT SELECT (id, country_code, status, org_id, vehicle_id, guest_user_id, scheduled_end)
  ON core.booking_trip TO review_cmd_owner;
CREATE POLICY review_cmd_read ON core.booking_trip FOR SELECT TO review_cmd_owner USING (true);
GRANT SELECT (trip_id, to_status, at) ON core.booking_trip_state_log TO review_cmd_owner;
CREATE POLICY review_cmd_read ON core.booking_trip_state_log FOR SELECT TO review_cmd_owner
  USING (true);
-- titulaire du compte d'hôte du trip (auteur d'un avis d'hôte)
GRANT SELECT (id, holder_user_id) ON core.iam_organization TO review_cmd_owner;
CREATE POLICY review_cmd_read ON core.iam_organization FOR SELECT TO review_cmd_owner USING (true);
-- annonces publiées (lecture publique des notes)
GRANT SELECT (id, vehicle_id, org_id, status) ON core.catalog_listing TO review_cmd_owner;
CREATE POLICY review_cmd_read ON core.catalog_listing FOR SELECT TO review_cmd_owner
  USING (status = 'LISTED');
-- fenêtre de notation (08 BR-REVIEW-01) seulement
GRANT SELECT (key, country_code, scope_type, value, valid_from, valid_to)
  ON core.config_param_value TO review_cmd_owner;
CREATE POLICY review_cmd_read ON core.config_param_value FOR SELECT TO review_cmd_owner
  USING (key = 'review_window_days');

GRANT USAGE ON SCHEMA core, platform TO review_cmd_owner;
GRANT EXECUTE ON FUNCTION platform.now(), platform.uuid_v7() TO review_cmd_owner;

-- note du voyageur vue par l'hôte (host_guest_v) : moyenne des agrégats GUEST, jamais un avis
GRANT SELECT (subject_type, subject_id, avg_overall_x100)
  ON core.review_rating_aggregate TO host_view_owner;
CREATE POLICY host_view_read ON core.review_rating_aggregate FOR SELECT TO host_view_owner
  USING (subject_type = 'GUEST');

-- 4. Commande liée à RECORD_REVIEW (cadre d'ADR-092) -----------------------------------------------
-- Signature imposée par core.support_manual_action_handler_check ; créée sous migrator, EXECUTE au
-- seul iam_staff_owner, puis cédée à review_cmd_owner. L'agent (p_actor) est déjà jugé par le cadre.
CREATE FUNCTION core.review_manual_action_record_review(p_token_hash bytea, p_action_id uuid,
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
  v_role    text := p_input ->> 'authorRole';
  v_overall smallint;
  v_trip    record;
  v_days    jsonb;
  v_end     timestamptz;
  v_author  uuid;
  v_now     timestamptz := platform.now();
  v_ids     uuid[];
  v_first   uuid;
BEGIN
  v_overall := CASE p_input ->> 'overall'
                 WHEN 'ONE' THEN 1 WHEN 'TWO' THEN 2 WHEN 'THREE' THEN 3 WHEN 'FOUR' THEN 4
                 WHEN 'FIVE' THEN 5 END;
  IF p_action_code IS DISTINCT FROM 'RECORD_REVIEW' OR v_role IS NULL OR v_overall IS NULL
     OR v_role NOT IN ('GUEST', 'HOST') OR p_actor IS NULL OR p_action_id IS NULL THEN
    RETURN QUERY SELECT 'REVIEW_INPUT_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- état qui fait foi en base (US-207) : trip COMPLETED seulement
  SELECT t.id, t.country_code, t.status, t.org_id, t.vehicle_id, t.guest_user_id, t.scheduled_end
    INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = p_subject_id;
  IF v_trip.id IS NULL OR v_trip.status IS DISTINCT FROM 'COMPLETED' THEN
    RETURN QUERY SELECT 'REVIEW_TRIP_NOT_COMPLETED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- fenêtre (08 BR-REVIEW-01) : fin = premier de la fin prévue et du retour enregistré ;
  -- paramètre du pays du trip, absent ou mal formé : refus (fail-closed)
  SELECT v.value INTO v_days
    FROM core.config_param_value AS v
   WHERE v.key = 'review_window_days' AND v.country_code::text = v_trip.country_code
     AND v.scope_type = 'COUNTRY' AND v.valid_from <= v_now
     AND (v.valid_to IS NULL OR v.valid_to > v_now)
   ORDER BY v.valid_from DESC
   LIMIT 1;
  IF v_days IS NULL OR pg_catalog.jsonb_typeof(v_days) <> 'number'
     OR (v_days #>> '{}') !~ '^[1-9][0-9]{0,2}$' THEN
    RETURN QUERY SELECT 'REVIEW_WINDOW_UNKNOWN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  v_end := LEAST(v_trip.scheduled_end,
                 (SELECT pg_catalog.min(l.at) FROM core.booking_trip_state_log AS l
                   WHERE l.trip_id = v_trip.id
                     AND l.to_status IN ('RETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST')));
  IF v_now > v_end + pg_catalog.make_interval(days => (v_days #>> '{}')::integer) THEN
    RETURN QUERY SELECT 'REVIEW_WINDOW_CLOSED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- auteur relu en base, jamais reçu
  IF v_role = 'GUEST' THEN
    v_author := v_trip.guest_user_id;
  ELSE
    SELECT o.holder_user_id INTO v_author FROM core.iam_organization AS o WHERE o.id = v_trip.org_id;
  END IF;
  IF v_author IS NULL THEN
    RETURN QUERY SELECT 'REVIEW_AUTHOR_UNKNOWN'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;

  -- une fois par partie et par trip (UQ) : deux enregistrements concurrents, le second attend le
  -- premier puis ne trouve rien à insérer. Sujets dans un ordre fixe (VEHICLE, HOST, GUEST).
  WITH s(ord, subject_type, subject_id) AS (
    SELECT * FROM (VALUES (1, 'VEHICLE', v_trip.vehicle_id), (2, 'HOST', v_trip.org_id))
             AS g(ord, subject_type, subject_id) WHERE v_role = 'GUEST'
    UNION ALL
    SELECT 3, 'GUEST', v_trip.guest_user_id WHERE v_role = 'HOST'
  ), ins AS (
    INSERT INTO core.review_review AS r
           (id, trip_id, country_code, author_user_id, author_role, subject_type, subject_id,
            overall, status, source, manual_action_id, recorded_by, published_at)
    SELECT platform.uuid_v7(), v_trip.id, v_trip.country_code, v_author, v_role, s.subject_type,
           s.subject_id, v_overall, 'PUBLISHED', 'OPS_RECORDED', p_action_id, p_actor, v_now
      FROM s ORDER BY s.ord
    ON CONFLICT ON CONSTRAINT review_unique_per_party DO NOTHING
    RETURNING r.id, r.subject_type
  )
  SELECT pg_catalog.array_agg(ins.id ORDER BY ins.subject_type DESC) INTO v_ids FROM ins;
  IF v_ids IS NULL THEN
    RETURN QUERY SELECT 'REVIEW_ALREADY_RECORDED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF pg_catalog.cardinality(v_ids) <> (CASE WHEN v_role = 'GUEST' THEN 2 ELSE 1 END) THEN
    -- un seul des deux sujets du voyageur déjà noté : état incohérent, tout est annulé
    RAISE EXCEPTION 'review : enregistrement partiel refusé'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  v_first := v_ids[1];

  -- agrégats des sujets notés, même transaction (upsert atomique, ordre fixe des sujets)
  INSERT INTO core.review_rating_aggregate AS a
         (subject_type, subject_id, review_count, overall_sum, avg_overall_x100, updated_at)
  SELECT r.subject_type, r.subject_id, 1, r.overall, r.overall * 100, v_now
    FROM core.review_review AS r
   WHERE r.id = ANY (v_ids)
   ORDER BY CASE r.subject_type WHEN 'VEHICLE' THEN 1 WHEN 'HOST' THEN 2 ELSE 3 END
  ON CONFLICT ON CONSTRAINT review_rating_aggregate_pkey DO UPDATE
     SET review_count = a.review_count + 1,
         overall_sum = a.overall_sum + EXCLUDED.overall_sum,
         avg_overall_x100 = ((a.overall_sum + EXCLUDED.overall_sum) * 200 + (a.review_count + 1))
                            / (2 * (a.review_count + 1)),
         updated_at = EXCLUDED.updated_at;

  RETURN QUERY SELECT 'DONE'::text, v_first, '{}'::uuid[];
END
$fn$;

COMMENT ON FUNCTION core.review_manual_action_record_review(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à RECORD_REVIEW (ADR-092) : avis reçu par e-mail rattaché à un trip COMPLETED, '
  'dans la fenêtre review_window_days, une fois par partie ; agrégats tenus. SECURITY DEFINER, '
  'EXECUTE iam_staff_owner. US-218 (ADR-130).';

-- 5. Lecture publique des notes d'annonces (16 REV-010) -------------------------------------------
CREATE FUNCTION core.review_listing_ratings(p_listing_ids uuid[])
  RETURNS TABLE (listing_id uuid, vehicle_trip_count integer, vehicle_review_count integer,
                 vehicle_avg_x100 integer, host_trip_count integer, host_review_count integer,
                 host_avg_x100 integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.id,
         (SELECT pg_catalog.count(*)::integer FROM core.booking_trip AS t
           WHERE t.vehicle_id = l.vehicle_id AND t.status IN ('COMPLETED', 'IN_DISPUTE')),
         COALESCE(va.review_count, 0), va.avg_overall_x100,
         (SELECT pg_catalog.count(*)::integer FROM core.booking_trip AS t
           WHERE t.org_id = l.org_id AND t.status IN ('COMPLETED', 'IN_DISPUTE')),
         COALESCE(ha.review_count, 0), ha.avg_overall_x100
    FROM core.catalog_listing AS l
    LEFT JOIN core.review_rating_aggregate AS va
      ON va.subject_type = 'VEHICLE' AND va.subject_id = l.vehicle_id
    LEFT JOIN core.review_rating_aggregate AS ha
      ON ha.subject_type = 'HOST' AND ha.subject_id = l.org_id
   WHERE p_listing_ids IS NOT NULL
     AND pg_catalog.cardinality(p_listing_ids) <= 100
     AND l.id = ANY (p_listing_ids)
     AND l.status = 'LISTED'
   ORDER BY l.id
$fn$;

COMMENT ON FUNCTION core.review_listing_ratings(uuid[]) IS
  'Notes publiques d''annonces LISTED (16 REV-010) : nombre de trips réalisés, nombre d''avis et '
  'moyenne ×100 du véhicule et de l''hôte ; ni compte, ni auteur, ni texte ; 100 annonces au plus. '
  'SECURITY DEFINER, EXECUTE app_api. US-218 (ADR-130).';

REVOKE ALL ON FUNCTION core.review_manual_action_record_review(bytea, uuid, text, uuid, jsonb, text, uuid, text),
  core.review_listing_ratings(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.review_manual_action_record_review(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.review_listing_ratings(uuid[]) TO app_api;

-- Propriétaire NOLOGIN (CREATE le temps du transfert seulement).
GRANT CREATE ON SCHEMA core TO review_cmd_owner;
ALTER FUNCTION core.review_manual_action_record_review(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO review_cmd_owner;
ALTER FUNCTION core.review_listing_ratings(uuid[]) OWNER TO review_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM review_cmd_owner;

-- 6. Catalogue des actions : RECORD_REVIEW devient une action d'état liée --------------------------
-- 17 §10 (NN9) en faisait une action d'enregistrement seul faute de table cible en Bêta : la table
-- existe désormais (PROPOSÉ, ADR-130). Permission et sujet inchangés (ops.review_listing_host, TRIP).
UPDATE core.support_manual_action_catalog
   SET mode = 'DOMAIN_COMMAND',
       input_keys = '{authorRole,overall}',
       input_values = '{"authorRole": ["GUEST", "HOST"],
                        "overall": ["ONE", "TWO", "THREE", "FOUR", "FIVE"]}'::jsonb
 WHERE action_code = 'RECORD_REVIEW';

-- Liaison (garde d'ADR-092 à l'INSERT : signature, SECURITY DEFINER, propriétaire NOLOGIN autre
-- qu'iam_staff_owner, EXECUTE à iam_staff_owner et à aucun rôle applicatif)
INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('RECORD_REVIEW',
        'core.review_manual_action_record_review(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-218');

-- 7. Note du voyageur vue par l'hôte (host_guest_v, ADR-128) -------------------------------------
-- Définitions de 0101 et de 0035 recopiées à l'identique ; seule la colonne de la note change.
GRANT CREATE ON SCHEMA core TO host_view_owner;
SET LOCAL ROLE host_view_owner;

CREATE OR REPLACE FUNCTION core.booking_host_trips(p_token_hash bytea, p_org uuid, p_tab text,
                                        p_vehicle_id uuid, p_from date, p_to date,
                                        p_trip_id uuid, p_limit integer)
  RETURNS TABLE (outcome text, trip_id uuid, public_ref text, tab text, status text,
                 vehicle_id uuid, scheduled_start timestamptz, scheduled_end timestamptz,
                 timezone text, booked_at timestamptz, payment_status text, currency text,
                 host_leg_minor bigint, guest_first_name text, guest_age_years integer,
                 guest_rating numeric, guest_verified boolean)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_country text;
BEGIN
  IF (p_tab IS NOT NULL AND p_tab NOT IN ('UPCOMING', 'IN_PROGRESS', 'DONE', 'CANCELLED'))
     OR p_limit IS NULL OR p_limit < 1 OR p_limit > 200
     OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_to < p_from) THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::text,
                        NULL::timestamptz, NULL::text, NULL::text, NULL::bigint, NULL::text,
                        NULL::integer, NULL::numeric, NULL::boolean;
    RETURN;
  END IF;
  -- compte d'hôte titulaire de la session (IDOR : jamais un identifiant d'hôte reçu)
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a
   WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
                        NULL::uuid, NULL::timestamptz, NULL::timestamptz, NULL::text,
                        NULL::timestamptz, NULL::text, NULL::text, NULL::bigint, NULL::text,
                        NULL::integer, NULL::numeric, NULL::boolean;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'DONE'::text, t.id, t.public_ref, x.tab, t.status, t.vehicle_id, t.scheduled_start,
         t.scheduled_end, t.timezone, t.booked_at, t.payment_status, t.currency,
         CASE WHEN x.tab = 'CANCELLED' THEN NULL::bigint
              ELSE (SELECT l.amount_minor
                      FROM core.booking_checkout_hold AS h
                      JOIN core.payment_payment_operation_leg AS l
                        ON l.operation_id = h.conversion_operation_id AND l.leg = 'HOST'
                     WHERE h.id = t.source_hold_id)
         END,
         CASE WHEN u.pseudonymized_at IS NULL THEN u.legal_first_name END,
         CASE WHEN u.pseudonymized_at IS NULL AND u.date_of_birth IS NOT NULL
              THEN pg_catalog.date_part('year',
                     pg_catalog.age((platform.now() AT TIME ZONE t.timezone)::date::timestamp,
                                    u.date_of_birth::timestamp))::integer
         END,
         -- US-218 (ADR-130) : moyenne des avis des hôtes sur ce voyageur, deux décimales ; NULL
         -- sans avis ou pour un compte pseudonymisé
         CASE WHEN u.pseudonymized_at IS NULL
              THEN (SELECT pg_catalog.round(ra.avg_overall_x100::numeric / 100, 2)
                      FROM core.review_rating_aggregate AS ra
                     WHERE ra.subject_type = 'GUEST' AND ra.subject_id = t.guest_user_id)
         END,
         EXISTS (SELECT 1 FROM core.kyc_identity_verification AS v
                  WHERE v.user_id = t.guest_user_id AND v.is_current AND v.status = 'APPROVED'
                    AND (v.expires_at IS NULL OR v.expires_at > platform.now()))
    FROM core.booking_trip AS t
    JOIN core.iam_user_account AS u ON u.id = t.guest_user_id
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN t.status IN ('BOOKED', 'CHECKIN_OPEN') THEN 'UPCOMING'
               WHEN t.status IN ('START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE', 'UNRETURNED')
                 THEN 'IN_PROGRESS'
               WHEN t.status IN ('RETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP',
                                 'COMPLETED', 'IN_DISPUTE') THEN 'DONE'
               ELSE 'CANCELLED'
             END) AS x(tab)
   WHERE t.org_id = p_org
     AND t.country_code = v_country
     AND (p_trip_id IS NULL OR t.id = p_trip_id)
     AND (p_tab IS NULL OR x.tab = p_tab)
     AND (p_vehicle_id IS NULL OR t.vehicle_id = p_vehicle_id)
     AND (p_from IS NULL OR t.scheduled_end > (p_from::timestamp AT TIME ZONE t.timezone))
     AND (p_to IS NULL OR t.scheduled_start < ((p_to + 1)::timestamp AT TIME ZONE t.timezone))
   ORDER BY CASE x.tab WHEN 'UPCOMING' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'DONE' THEN 2
                       ELSE 3 END,
            CASE WHEN x.tab = 'UPCOMING' THEN t.scheduled_start
                 WHEN x.tab = 'IN_PROGRESS' THEN t.scheduled_end END ASC NULLS LAST,
            t.scheduled_start DESC, t.id
   LIMIT p_limit;
END
$fn$;

CREATE OR REPLACE FUNCTION core.booking_host_guest_rows()
  RETURNS TABLE (trip_id uuid, first_name text, age_years integer, rating numeric,
                 verification_status text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.id,
         CASE WHEN u.pseudonymized_at IS NULL THEN u.legal_first_name END,
         CASE WHEN u.pseudonymized_at IS NULL AND u.date_of_birth IS NOT NULL
              THEN pg_catalog.date_part('year',
                     pg_catalog.age((platform.now() AT TIME ZONE t.timezone)::date::timestamp,
                                    u.date_of_birth::timestamp))::integer
         END,
         -- US-218 (ADR-130) : moyenne des avis des hôtes sur ce voyageur (rating_aggregate)
         CASE WHEN u.pseudonymized_at IS NULL
              THEN (SELECT pg_catalog.round(ra.avg_overall_x100::numeric / 100, 2)
                      FROM core.review_rating_aggregate AS ra
                     WHERE ra.subject_type = 'GUEST' AND ra.subject_id = t.guest_user_id)
         END,
         NULL::text          -- statut de vérification : identity_verification (KYC du voyageur)
    FROM core.booking_trip AS t
    JOIN core.iam_user_account AS u ON u.id = t.guest_user_id
   WHERE app.actor_kind() = 'HOST'
     AND t.org_id = app.org_id()
     AND app.host_covers_vehicle(t.vehicle_id)
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM host_view_owner;
