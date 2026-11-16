-- 9973 — fixtures des preuves des conditions affichées sur la fiche (US-205, migration 0113).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé) : le contrat d'assureur n'est écrit par
-- AUCUNE commande (décision écrite du fondateur, US-227) ; ces fixtures l'écrivent à sa place,
-- appelées SEULEMENT dans des transactions de test ANNULÉES, jamais validées :
--   - `us205_insurer_contract` : assureur (et courtier) ACTIVE et contrat en vigueur depuis la
--     veille, avec ses conditions (devise, RC, franchises, exclusions) passées à la garde de 0113 ;
--   - `us205_set_terms` : pose ou change les conditions d'un contrat existant (garde d'immuabilité) ;
--   - `us205_set_rc_minimum` : nouvelle valeur d'`insurer_rc_minimum` du pays ;
--   - `us205_set_insurer_status` : assureur ou courtier ACTIVE / INACTIVE.
-- Les attendus des tests viennent de 19 US-205, 16 LST-010 / LST-012 / LST-013 / PRT-003 et de 08
-- BR-CXL-01, jamais de ces fixtures. AUCUNE fixture n'écrit un interrupteur (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us205_* (voir la liste des droits en fin de fichier).

CREATE FUNCTION test_fixture.us205_insurer_contract(p_country text, p_currency text,
                                                    p_rc_minor bigint, p_deductibles jsonb,
                                                    p_exclusions jsonb, p_broker boolean)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_insurer  uuid := platform.uuid_v7();
  v_broker   uuid;
  v_contract uuid := platform.uuid_v7();
  v_from     timestamptz := platform.now() - interval '1 day';
BEGIN
  INSERT INTO core.settlement_insurer (id, country_code, name, kind, license_ref, status)
  VALUES (v_insurer, p_country, 'Aseguradora de prueba', 'INSURER', 'SSRP-TEST-1', 'ACTIVE');
  IF p_broker THEN
    v_broker := platform.uuid_v7();
    INSERT INTO core.settlement_insurer (id, country_code, name, kind, license_ref, status)
    VALUES (v_broker, p_country, 'Corredor de prueba', 'BROKER', NULL, 'ACTIVE');
  END IF;
  INSERT INTO core.settlement_insurer_contract (id, insurer_id, country_code, version,
                                                vehicle_eligibility, signed_at, valid_from,
                                                broker_id, currency, rc_amount_minor,
                                                deductibles, exclusions)
  VALUES (v_contract, v_insurer, p_country,
          (SELECT COALESCE(pg_catalog.max(c.version), 0) + 1
             FROM core.settlement_insurer_contract AS c WHERE c.country_code = p_country),
          pg_catalog.jsonb_build_object('maxVehicleAgeYears', 30,
                                        'valueClasses',
                                        pg_catalog.jsonb_build_array('STANDARD', 'PREMIUM'),
                                        'usages', pg_catalog.jsonb_build_array('PARTICULAR')),
          v_from, v_from, v_broker, p_currency, p_rc_minor, p_deductibles, p_exclusions);
  RETURN v_contract;
END
$fn$;

CREATE FUNCTION test_fixture.us205_set_terms(p_contract uuid, p_rc_minor bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_insurer_contract SET rc_amount_minor = p_rc_minor WHERE id = p_contract
$fn$;

CREATE FUNCTION test_fixture.us205_set_rc_minimum(p_country text, p_value text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES ('insurer_rc_minimum', p_country, 'COUNTRY', pg_catalog.to_jsonb(p_value),
          'test US-205 (transaction annulée)')
$fn$;

CREATE FUNCTION test_fixture.us205_set_insurer_status(p_contract uuid, p_broker boolean,
                                                      p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_insurer AS i SET status = p_status
    FROM core.settlement_insurer_contract AS c
   WHERE c.id = p_contract
     AND i.id = CASE WHEN p_broker THEN c.broker_id ELSE c.insurer_id END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us205_insurer_contract(text, text, bigint, jsonb, jsonb, boolean),
  test_fixture.us205_set_terms(uuid, bigint), test_fixture.us205_set_rc_minimum(text, text),
  test_fixture.us205_set_insurer_status(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us205_insurer_contract(text, text, bigint, jsonb, jsonb, boolean),
  test_fixture.us205_set_terms(uuid, bigint), test_fixture.us205_set_rc_minimum(text, text),
  test_fixture.us205_set_insurer_status(uuid, boolean, text) TO app_api;
