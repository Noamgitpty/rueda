-- 9939 — fixtures des preuves des lieux de prise et de retour (US-514, migration 0143). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. `us514_trip_listing` : annonce d'un trip (lecture d'une colonne que le voyageur ne lit pas
--      directement), pour appeler la lecture du lieu exact de la fiche sur le trip de la fixture
--      9948 ;
--   2. `us514_close_review_window` : ferme à platform.now() la valeur en vigueur de
--      review_window_days d'un pays, comme la console de configuration (paramètre absent) ; appelée
--      SEULEMENT dans une transaction annulée.
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us514_trip_listing(uuid),
--   test_fixture.us514_close_review_window(text).

CREATE FUNCTION test_fixture.us514_trip_listing(p_trip_id uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.listing_id FROM core.booking_trip AS t WHERE t.id = p_trip_id
$fn$;

CREATE FUNCTION test_fixture.us514_close_review_window(p_country text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.config_param_value
     SET valid_to = platform.now()
   WHERE key = 'review_window_days' AND country_code = p_country AND scope_type = 'COUNTRY'
     AND valid_to IS NULL
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us514_trip_listing(uuid),
  test_fixture.us514_close_review_window(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us514_trip_listing(uuid),
  test_fixture.us514_close_review_window(text) TO app_api;
