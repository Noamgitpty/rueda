-- 9951 — fixtures des correctifs de la passe n° 2 de la red team du lot 1 (US-122, migrations
-- 0097 et 0098). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Paramètre de téléversement ABSENT dans la transaction de l'appelant, qui l'ANNULE ensuite :
-- même motif que test_fixture.us122_param_close (9954), pour les seules clés upload_*. Clés
-- fermées. SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api. Les attendus
-- du test viennent d'ADR-124, jamais de cette fixture.
--
-- Retour arrière : DROP FUNCTION test_fixture.us122c_param_close(text, text).

CREATE FUNCTION test_fixture.us122c_param_close(p_key text, p_country text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  IF p_key NOT IN ('upload_photo_max_kb', 'upload_gallery_photos_max',
                   'upload_documents_per_minute') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE core.config_param_value AS v
     SET valid_to = platform.now() + pg_catalog.make_interval(secs => 0.01)
   WHERE v.key = p_key AND v.country_code = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_to IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM pg_catalog.pg_sleep(0.05);
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us122c_param_close(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us122c_param_close(text, text) TO app_api;
