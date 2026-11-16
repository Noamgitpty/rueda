-- 9971 — fixtures des preuves de la distance figée dans le devis et des conditions du checkout
-- (US-205 partie 205b, migrations 0117 et 0118). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé), appelées SEULEMENT dans des transactions
-- de test ANNULÉES, jamais validées :
--   - `us205b_set_listing_mileage` : distance d'une annonce de fixture (mode, km par jour, prix du
--     km), dans les bornes de `catalog_listing_mileage_valid` (0067) ;
--   - `us205b_set_window` : nouvelle valeur de `last_minute_free_window_minutes` du pays (0117) ;
--   - `us205b_quote_mileage` : distance figée d'un devis (colonnes de 0118), pour la preuve.
-- Les attendus des tests viennent de 19 US-205 (critère 2 : 200 km / j × 3 jours = 600 km) et de 08
-- BR-CXL-01, jamais de ces fixtures. AUCUNE fixture n'écrit un interrupteur (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us205b_* (voir la liste des droits en fin de fichier).

CREATE FUNCTION test_fixture.us205b_set_listing_mileage(p_listing_id uuid, p_mode text,
                                                        p_km integer, p_extra_minor bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.catalog_listing
     SET mileage_mode = p_mode, included_km_per_day = p_km, extra_km_price_minor = p_extra_minor
   WHERE id = p_listing_id
$fn$;

CREATE FUNCTION test_fixture.us205b_set_window(p_country text, p_minutes integer)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES ('last_minute_free_window_minutes', p_country, 'COUNTRY', pg_catalog.to_jsonb(p_minutes),
          'test US-205b (transaction annulée)')
$fn$;

CREATE FUNCTION test_fixture.us205b_quote_mileage(p_quote_id uuid)
  RETURNS TABLE (mileage_mode text, included_km integer, extra_km_price_minor bigint)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT q.mileage_mode, q.included_km, q.extra_km_price_minor
    FROM core.pricing_quote AS q
   WHERE q.id = p_quote_id
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us205b_set_listing_mileage(uuid, text, integer, bigint),
  test_fixture.us205b_set_window(text, integer),
  test_fixture.us205b_quote_mileage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us205b_set_listing_mileage(uuid, text, integer, bigint),
  test_fixture.us205b_set_window(text, integer),
  test_fixture.us205b_quote_mileage(uuid) TO app_api;
