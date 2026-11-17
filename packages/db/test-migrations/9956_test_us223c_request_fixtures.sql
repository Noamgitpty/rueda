-- 9956 — fixtures des preuves de la réservation sur demande (US-223 partie 223c, migration 0124).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER, search_path figé ; aucun SQL dynamique) :
--   1. `us223c_place_request_hold` (cmd_hold_owner) : pose d'un hold REQUEST par la VRAIE pose
--      (`core.booking_place_hold_kind`, la même que le checkout d'une annonce sur demande), dans le
--      contexte du voyageur posé par l'appelant (commandCallSql), SANS passer par
--      `core.booking_cmd_checkout`, qui exige les interrupteurs de mise en service et le paramètre
--      booking_request_mode_enabled : les preuves du mode sur demande COMMITENT leurs données (deux
--      sessions, travailleurs) et aucun interrupteur ni réglage pays n'est jamais ouvert hors d'une
--      transaction annulée (17 §0.1). Le checkout réel d'une annonce sur demande est prouvé dans une
--      transaction annulée (l0-us223-request-checkout) ;
--   2. `us223c_set_request_mode` (migrator) : nouvelle valeur de booking_request_mode_enabled d'un
--      pays, comme la console de configuration, à platform.now() ; appelée SEULEMENT dans une
--      transaction annulée (l0-us223-request-checkout), jamais par une preuve qui commite.
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us223c_place_request_hold(uuid, timestamptz,
--   timestamptz), test_fixture.us223c_set_request_mode(text, boolean).

CREATE FUNCTION test_fixture.us223c_place_request_hold(p_vehicle_id uuid, p_start timestamptz,
                                                       p_end timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN core.booking_place_hold_kind(p_vehicle_id, p_start, p_end, false, 'REQUEST');
END
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us223c_place_request_hold(uuid, timestamptz, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us223c_place_request_hold(uuid, timestamptz, timestamptz)
  TO app_api;
GRANT CREATE ON SCHEMA test_fixture TO cmd_hold_owner;
ALTER FUNCTION test_fixture.us223c_place_request_hold(uuid, timestamptz, timestamptz)
  OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_hold_owner;

CREATE FUNCTION test_fixture.us223c_set_request_mode(p_country text, p_value boolean)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- valid_from (platform.now()) posé par la garde de 0008
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES ('booking_request_mode_enabled', p_country, 'COUNTRY', pg_catalog.to_jsonb(p_value),
          'test US-223c : valeur de test, transaction annulée');
END
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us223c_set_request_mode(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us223c_set_request_mode(text, boolean) TO app_api;
