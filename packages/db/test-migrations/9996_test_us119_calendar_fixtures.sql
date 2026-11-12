-- 9996 — fixtures des preuves historiques de pose de hold face au préavis (US-119, migration 0071).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Depuis 0071, `core.booking_cmd_place_hold` refuse un départ dans le préavis du lieu du véhicule
-- (défaut du pays : 180 min). Deux preuves antérieures éprouvent des bornes PLUS proches que tout
-- préavis : C20 (US-024, réservation de dernière minute, départ deux minutes après la pose) et
-- RT-CONC-02 (US-049, borne « maintenant + 1 s » de la pose). Elles fixent pour les lieux de LEUR
-- compte d'hôte un préavis nul (0 : jamais proposé à l'hôte, la commande exige 60 à 10 080), pour
-- garder la borne qu'elles prouvent ; le préavis lui-même est prouvé par l0-us119.
--
-- Retour arrière : DROP FUNCTION test_fixture.us119_set_org_notice(uuid, integer),
--   test_fixture.us119_set_vehicle_class(uuid, text), test_fixture.us119_close_country_notice(text).
CREATE FUNCTION test_fixture.us119_set_org_notice(p_org uuid, p_minutes integer)
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH u AS (
    UPDATE core.catalog_location SET advance_notice_minutes = p_minutes
     WHERE org_id = p_org
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM u
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us119_set_org_notice(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us119_set_org_notice(uuid, integer) TO app_api, app_worker;

-- Classe de valeur forcée d'un véhicule (la variante LUXE n'existe pas dans la graine du
-- catalogue) : prouve le plancher de la classe (`advance_notice_minutes` portée CATEGORY).
CREATE FUNCTION test_fixture.us119_set_vehicle_class(p_vehicle uuid, p_class text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.catalog_vehicle SET value_class = p_class WHERE id = p_vehicle
$fn$;

-- Fermeture, à platform.now(), du défaut du pays `advance_notice_minutes` (portée COUNTRY) :
-- prouve PARAM_MISSING (fail-closed). À n'appeler que dans une transaction de test ANNULÉE.
CREATE FUNCTION test_fixture.us119_close_country_notice(p_country text)
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH u AS (
    UPDATE core.config_param_value SET valid_to = platform.now()
     WHERE key = 'advance_notice_minutes' AND country_code = p_country
       AND scope_type = 'COUNTRY' AND valid_to IS NULL
    RETURNING 1
  )
  SELECT pg_catalog.count(*)::integer FROM u
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us119_set_vehicle_class(uuid, text),
  test_fixture.us119_close_country_notice(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us119_set_vehicle_class(uuid, text),
  test_fixture.us119_close_country_notice(text) TO app_api, app_worker;
