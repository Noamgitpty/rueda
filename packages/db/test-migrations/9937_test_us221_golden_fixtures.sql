-- 9937 — fixtures des parcours dorés « réservation » (US-221). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   `us221_listing_city` : ville du lieu de remise du véhicule d'une annonce de fixture (9998), posée
--   à une valeur propre au test, pour que la recherche publique (US-201, au plus 50 résultats, les
--   plus récemment publiés d'abord) rende l'annonce du parcours quelle que soit la base partagée.
--   Appelée SEULEMENT dans une transaction ANNULÉE. AUCUN interrupteur de mise en service écrit
--   (17 §0.1) ; aucun montant.
--
-- Retour arrière : DROP FUNCTION test_fixture.us221_listing_city(uuid, text).

CREATE FUNCTION test_fixture.us221_listing_city(p_listing_id uuid, p_city text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  UPDATE core.catalog_location AS cl
     SET city = p_city
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS cv ON cv.id = l.vehicle_id AND cv.org_id = l.org_id
   WHERE l.id = p_listing_id AND cl.id = cv.home_location_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'us221_listing_city: listing % has no home location', p_listing_id;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us221_listing_city(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us221_listing_city(uuid, text) TO app_api;
