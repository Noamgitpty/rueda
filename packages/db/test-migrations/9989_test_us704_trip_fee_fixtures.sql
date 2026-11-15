-- 9989 — fixtures des preuves du trip fee rejoué par la base (US-704, migration 0101). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. nouvelle version de `trip_fee_schedule` d'un pays, valable à platform.now() de la
--      transaction de test (annulée ensuite) : prouve que la commande lit le barème EN VIGUEUR de
--      la base, et refuse un barème mal formé (la garde de 0008 n'exige qu'une valeur JSON non
--      nulle : la forme est contrôlée par core.pricing_trip_fee) ;
--   2. fermeture (valid_to = platform.now()) de la version ouverte : barème absent.
-- Les gardes de config_param_value (non-rétroactivité, immuabilité) s'appliquent : ces fonctions ne
-- les contournent pas.
--
-- Retour arrière : DROP FUNCTION test_fixture.us704_set_trip_fee_schedule(text, jsonb),
--   test_fixture.us704_close_trip_fee_schedule(text).

CREATE FUNCTION test_fixture.us704_set_trip_fee_schedule(p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  -- valid_from et devise posés par la garde de 0008 (platform.now(), devise du pays)
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES ('trip_fee_schedule', p_country, 'COUNTRY', p_value, 'test US-704 : barème de test')
$fn$;

CREATE FUNCTION test_fixture.us704_close_trip_fee_schedule(p_country text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.config_param_value
     SET valid_to = platform.now()
   WHERE key = 'trip_fee_schedule' AND country_code = p_country AND scope_type = 'COUNTRY'
     AND valid_to IS NULL
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us704_set_trip_fee_schedule(text, jsonb),
  test_fixture.us704_close_trip_fee_schedule(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us704_set_trip_fee_schedule(text, jsonb),
  test_fixture.us704_close_trip_fee_schedule(text) TO app_api;
