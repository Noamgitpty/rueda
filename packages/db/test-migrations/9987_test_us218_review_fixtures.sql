-- 9987 — fixtures des preuves des avis enregistrés par l'ops (US-218, migration 0104). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique ; EXECUTE à app_api) :
--   1. annonce LISTED d'un véhicule créé par les vraies commandes d'US-115 (la publication par
--      l'ops relève d'US-118) : DONNÉE d'entrée de la lecture publique des notes ;
--   2. relecture brute des avis d'un trip et de l'agrégat d'un sujet (aucun rôle applicatif ne les
--      lit) : les attendus des tests viennent de 19 US-218, de 16 REV-001 / REV-010 et de 08
--      BR-REVIEW, jamais de ces relectures ;
--   3. tentatives d'écriture directe sous migrator (immuabilité, tous rôles).
--
-- Retour arrière : DROP FUNCTION test_fixture.us218_list_vehicle(uuid),
--   test_fixture.us218_reviews(uuid), test_fixture.us218_aggregate(text, uuid),
--   test_fixture.us218_try_write(uuid, text).

CREATE FUNCTION test_fixture.us218_list_vehicle(p_vehicle uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_listing uuid := pg_catalog.gen_random_uuid();
  v_org     uuid;
  v_country text;
  v_holder  uuid;
  v_currency text;
BEGIN
  SELECT v.org_id, o.country_code::text, o.holder_user_id INTO v_org, v_country, v_holder
    FROM core.catalog_vehicle AS v JOIN core.iam_organization AS o ON o.id = v.org_id
   WHERE v.id = p_vehicle;
  SELECT k.currency::text INTO v_currency FROM core.config_country AS k WHERE k.code::text = v_country;
  INSERT INTO core.catalog_listing (id, vehicle_id, org_id, country_code, status, daily_price_minor,
                                    currency, mileage_mode, created_by)
  VALUES (v_listing, p_vehicle, v_org, v_country, 'DRAFT', 5000, v_currency, 'UNLIMITED', v_holder);
  UPDATE core.catalog_listing SET status = 'LISTED' WHERE id = v_listing;
  RETURN v_listing;
END
$fn$;

CREATE FUNCTION test_fixture.us218_reviews(p_trip uuid)
  RETURNS TABLE (id uuid, country_code text, author_user_id uuid, author_role text,
                 subject_type text, subject_id uuid, overall smallint, status text, source text,
                 manual_action_id uuid, recorded_by uuid, published_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.id, r.country_code, r.author_user_id, r.author_role, r.subject_type, r.subject_id,
         r.overall, r.status, r.source, r.manual_action_id, r.recorded_by, r.published_at
    FROM core.review_review AS r
   WHERE r.trip_id = p_trip
   ORDER BY r.subject_type
$fn$;

CREATE FUNCTION test_fixture.us218_aggregate(p_subject_type text, p_subject_id uuid)
  RETURNS TABLE (review_count integer, overall_sum integer, avg_overall_x100 integer)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.review_count, a.overall_sum, a.avg_overall_x100
    FROM core.review_rating_aggregate AS a
   WHERE a.subject_type = p_subject_type AND a.subject_id = p_subject_id
$fn$;

-- Écriture directe sous migrator : 'UPDATE' (note), 'DELETE' ; rend SQLSTATE:contrainte ou 'OK'.
CREATE FUNCTION test_fixture.us218_try_write(p_review uuid, p_kind text)
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
      UPDATE core.review_review SET overall = 1 WHERE id = p_review;
    ELSIF p_kind = 'DELETE' THEN
      DELETE FROM core.review_review WHERE id = p_review;
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

REVOKE ALL ON FUNCTION test_fixture.us218_list_vehicle(uuid), test_fixture.us218_reviews(uuid),
  test_fixture.us218_aggregate(text, uuid), test_fixture.us218_try_write(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us218_list_vehicle(uuid), test_fixture.us218_reviews(uuid),
  test_fixture.us218_aggregate(text, uuid), test_fixture.us218_try_write(uuid, text) TO app_api;
