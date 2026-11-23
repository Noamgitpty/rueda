-- 9903 — fixtures de la suite des frais annexes (US-706 suite, migration 0182, ADR-202). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique) : poser une nouvelle
-- version de la fenêtre des photos d'un nettoyage (`incidental_cleaning_photo_window_h`, 0182),
-- seule clé admise (les autres clés des frais annexes passent par us706_param_version de 9907).
-- Les attendus des tests viennent de 08 BR-REIMB-01 et de 16 CLM-021, jamais de cette fixture.
-- Appelée SEULEMENT dans une transaction ANNULÉE. AUCUNE fixture n'écrit un interrupteur de mise
-- en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us706s_param_version(text, text, jsonb).

CREATE FUNCTION test_fixture.us706s_param_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key IS DISTINCT FROM 'incidental_cleaning_photo_window_h' THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-706 suite (annulé)');
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us706s_param_version(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us706s_param_version(text, text, jsonb)
  TO app_api, app_worker;
