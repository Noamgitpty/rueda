-- 9915 — fixtures des preuves des avis réciproques en double aveugle (US-317, migration 0170).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique, EXECUTE à app_api et
-- app_worker) :
--   1. test_fixture.us317_trip : trip BOOKED de la fixture d'US-525 (`us525_trip`, 9926 : voyageur
--      « Ana Pérez », hôte « María José Gómez ») ;
--   2. test_fixture.us317_return : fin effective du trip (ligne RETURNED du journal d'état à l'heure
--      de la base, ADR-183) ; test_fixture.us317_status : statut du trip écrit directement (trip
--      annulé, trip COMPLETED pour le nombre de trips) ;
--   3. test_fixture.us317_ops_review : avis de l'ops (US-218) écrit directement (chemin RECORD_REVIEW
--      prouvé par l0-us218) ;
--   4. test_fixture.us317_submissions / us317_reviews / us317_aggregate / us317_events : relecture de
--      ce qu'aucun rôle applicatif ne lit (scellé, registre, agrégat, boîte d'envoi) ;
--   5. test_fixture.us317_force_write : écriture DIRECTE du scellé par son propriétaire (liste
--      fermée) : preuve que la garde refuse même hors des rôles applicatifs.
-- Appelées dans une transaction ANNULÉE, sauf la course à deux connexions (fichier isolé). AUCUN
-- interrupteur de mise en service écrit (17 §0.1). Les attendus des tests viennent de 19 US-317,
-- 16 REV-001 / REV-002 / REV-004 / LST-020, 08 BR-REVIEW, 22 OQ-P2P-06 et d'ADR-190, jamais de ces
-- fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us317_trip(text, uuid, uuid, timestamptz,
--   timestamptz), test_fixture.us317_return(uuid), test_fixture.us317_status(uuid, text),
--   test_fixture.us317_ops_review(uuid, text, smallint), test_fixture.us317_submissions(uuid),
--   test_fixture.us317_reviews(uuid), test_fixture.us317_aggregate(text, uuid),
--   test_fixture.us317_events(uuid), test_fixture.us317_force_write(uuid, text).

CREATE FUNCTION test_fixture.us317_trip(p_country text, p_org uuid, p_guest uuid,
                                        p_start timestamptz, p_end timestamptz)
  RETURNS TABLE (trip_id uuid, org_id uuid, vehicle_id uuid, holder_id uuid, listing_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v record;
  v_listing uuid;
BEGIN
  -- plpgsql : corps résolu à l'appel (9926, qui définit us525_trip, s'applique après 9915) ;
  -- annonce relue par une instruction SUIVANTE (l'instantané de l'appel ne voit pas le trip créé)
  SELECT x.trip_id, x.org_id, x.vehicle_id, x.holder_id INTO v
    FROM test_fixture.us525_trip(p_country, p_org, p_guest, 'Ana', 'María José', p_start, p_end)
         AS x;
  SELECT t.listing_id INTO v_listing FROM core.booking_trip AS t WHERE t.id = v.trip_id;
  RETURN QUERY SELECT v.trip_id, v.org_id, v.vehicle_id, v.holder_id, v_listing;
END
$fn$;

-- Fin effective : ligne RETURNED du journal d'état, à l'heure de la base, puis statut RETURNED
CREATE FUNCTION test_fixture.us317_return(p_trip uuid)
  RETURNS timestamptz
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_at timestamptz;
BEGIN
  INSERT INTO core.booking_trip_state_log (id, trip_id, from_status, to_status, kind, reason_code,
                                           actor_role)
  VALUES (pg_catalog.gen_random_uuid(), p_trip, 'IN_PROGRESS', 'RETURNED', 'TRANSITION',
          'CHECKOUT_VALIDATED', 'SYSTEM')
  RETURNING at INTO v_at;
  UPDATE core.booking_trip SET status = 'RETURNED' WHERE id = p_trip;
  RETURN v_at;
END
$fn$;

CREATE FUNCTION test_fixture.us317_status(p_trip uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.booking_trip SET status = p_status WHERE id = p_trip
$fn$;

-- Avis recueilli par l'ops (US-218), publié à l'enregistrement : voyageur ⇒ sujets VEHICLE et HOST
CREATE FUNCTION test_fixture.us317_ops_review(p_trip uuid, p_role text, p_overall smallint)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_t      record;
  v_author uuid;
BEGIN
  SELECT t.id, t.country_code, t.org_id, t.vehicle_id, t.guest_user_id INTO v_t
    FROM core.booking_trip AS t WHERE t.id = p_trip;
  IF p_role = 'GUEST' THEN
    v_author := v_t.guest_user_id;
  ELSE
    SELECT o.holder_user_id INTO v_author FROM core.iam_organization AS o WHERE o.id = v_t.org_id;
  END IF;
  INSERT INTO core.review_review (id, trip_id, country_code, author_user_id, author_role,
                                  subject_type, subject_id, overall, status, source,
                                  manual_action_id, recorded_by, published_at)
  SELECT pg_catalog.gen_random_uuid(), v_t.id, v_t.country_code, v_author, p_role, s.subject_type,
         s.subject_id, p_overall, 'PUBLISHED', 'OPS_RECORDED', pg_catalog.gen_random_uuid(),
         pg_catalog.gen_random_uuid(), platform.now()
    FROM (VALUES ('VEHICLE', v_t.vehicle_id), ('HOST', v_t.org_id), ('GUEST', v_t.guest_user_id))
         AS s(subject_type, subject_id)
   WHERE (p_role = 'GUEST' AND s.subject_type IN ('VEHICLE', 'HOST'))
      OR (p_role = 'HOST' AND s.subject_type = 'GUEST');
END
$fn$;

CREATE FUNCTION test_fixture.us317_submissions(p_trip uuid)
  RETURNS TABLE (id uuid, author_role text, author_user_id uuid, overall smallint, body text,
                 contact_masked boolean, submitted_at timestamptz, window_closes_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.id, s.author_role, s.author_user_id, s.overall, s.body, s.contact_masked,
         s.submitted_at, s.window_closes_at
    FROM core.review_submission AS s
   WHERE s.trip_id = p_trip
   ORDER BY s.submitted_at, s.author_role
$fn$;

CREATE FUNCTION test_fixture.us317_reviews(p_trip uuid)
  RETURNS TABLE (id uuid, author_role text, subject_type text, subject_id uuid, overall smallint,
                 body text, status text, source text, submission_id uuid,
                 published_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.id, r.author_role, r.subject_type, r.subject_id, r.overall, r.body, r.status, r.source,
         r.submission_id, r.published_at
    FROM core.review_review AS r
   WHERE r.trip_id = p_trip
   ORDER BY r.subject_type
$fn$;

CREATE FUNCTION test_fixture.us317_aggregate(p_subject_type text, p_subject_id uuid)
  RETURNS TABLE (review_count integer, overall_sum integer, avg_overall_x100 integer)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.review_count, a.overall_sum, a.avg_overall_x100
    FROM core.review_rating_aggregate AS a
   WHERE a.subject_type = p_subject_type AND a.subject_id = p_subject_id
$fn$;

-- Événements d'avis (« review.* ») de la boîte d'envoi portant sur le trip : aucun n'est attendu
-- (la naissance du trip en écrit d'autres)
CREATE FUNCTION test_fixture.us317_events(p_trip uuid)
  RETURNS TABLE (type text, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE (e.aggregate_id = p_trip OR e.payload ->> 'trip_id' = p_trip::text)
     AND e.type LIKE 'review%'
   ORDER BY e.occurred_at, e.id
$fn$;

-- Écriture directe du scellé par son propriétaire (liste fermée) ; rend SQLSTATE:contrainte ou OK
CREATE FUNCTION test_fixture.us317_force_write(p_submission uuid, p_kind text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_constraint text;
BEGIN
  BEGIN
    IF p_kind = 'UPDATE' THEN
      UPDATE core.review_submission SET overall = 5 WHERE id = p_submission;
    ELSIF p_kind = 'DELETE' THEN
      DELETE FROM core.review_submission WHERE id = p_submission;
    ELSE
      RETURN 'KIND_UNKNOWN';
    END IF;
    RETURN 'OK';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
    RETURN SQLSTATE || ':' || COALESCE(v_constraint, '');
  END;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us317_trip(text, uuid, uuid, timestamptz, timestamptz),
  test_fixture.us317_return(uuid), test_fixture.us317_status(uuid, text),
  test_fixture.us317_ops_review(uuid, text, smallint), test_fixture.us317_submissions(uuid),
  test_fixture.us317_reviews(uuid), test_fixture.us317_aggregate(text, uuid),
  test_fixture.us317_events(uuid), test_fixture.us317_force_write(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us317_trip(text, uuid, uuid, timestamptz, timestamptz),
  test_fixture.us317_return(uuid), test_fixture.us317_status(uuid, text),
  test_fixture.us317_ops_review(uuid, text, smallint), test_fixture.us317_submissions(uuid),
  test_fixture.us317_reviews(uuid), test_fixture.us317_aggregate(text, uuid),
  test_fixture.us317_events(uuid), test_fixture.us317_force_write(uuid, text)
  TO app_api, app_worker;
