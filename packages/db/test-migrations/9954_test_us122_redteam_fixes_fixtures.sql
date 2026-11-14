-- 9954 — fixtures des correctifs de la red team du lot 1 (US-122, migrations 0093 et 0094). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Valeur du plafond de contestations ouvertes posée dans la transaction de l'appelant, qui
-- l'ANNULE ensuite (comme us124_param_version) : repli fail-closed d'une valeur mal formée. Clé
-- fermée. SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api. Les attendus
-- du test viennent du rapport de la red team et d'ADR-122, jamais de cette fixture.
--
-- Retour arrière : DROP FUNCTION test_fixture.us122_param_version(text, text, jsonb).

CREATE FUNCTION test_fixture.us122_param_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key NOT IN ('plate_claims_open_per_host') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-122 (annulé)');
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us122_param_version(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us122_param_version(text, text, jsonb) TO app_api;
