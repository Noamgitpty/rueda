-- 9954 — fixtures des correctifs de la red team du lot 1 (US-122, migrations 0093 et 0094). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Paramètre ABSENT dans la transaction de l'appelant, qui l'ANNULE ensuite : la version ouverte du
-- plafond de contestations est fermée 10 ms plus tard (seule écriture que la garde
-- core.config_param_value_guard admet sur une valeur existante ; une valeur mal formée ne peut pas
-- être écrite, la garde de type la refuse). Clé fermée. SECURITY DEFINER sous migrator,
-- search_path figé, EXECUTE au seul app_api. Les attendus du test viennent du rapport de la red
-- team et d'ADR-122, jamais de cette fixture.
--
-- Retour arrière : DROP FUNCTION test_fixture.us122_param_close(text, text).

CREATE FUNCTION test_fixture.us122_param_close(p_key text, p_country text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_key NOT IN ('plate_claims_open_per_host') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- même motif que us123_param_version (9986) : platform.now() vaut clock_timestamp(), la garde
  -- refuse un valid_to déjà passé quand elle le relit ; on ferme donc 10 ms plus tard, puis on
  -- attend que la fermeture soit en vigueur
  UPDATE core.config_param_value AS v
     SET valid_to = platform.now() + pg_catalog.make_interval(secs => 0.01)
   WHERE v.key = p_key AND v.country_code = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_to IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM pg_catalog.pg_sleep(0.05);
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us122_param_close(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us122_param_close(text, text) TO app_api;
