-- 9944 — fixtures des preuves de la classe de valeur attribuée à la publication (BOARD N-83,
-- migrations 0131 et 0132 ; ADR-159). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Relecture (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) de la
-- classe d'un véhicule, de sa provenance et de la règle appliquée ; nouvelle valeur du défaut du
-- pays `vehicle_default_value_class`, posée dans une transaction de test ANNULÉE. Les attendus du
-- test viennent de 08 BR-ACC-05, d'ADR-159 et du fichier de paramètres, jamais de ces fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.n83_vehicle_class(uuid),
--   test_fixture.n83_default_class(text, jsonb).

-- Classe, provenance et règle (slugs) d'un véhicule.
CREATE FUNCTION test_fixture.n83_vehicle_class(p_vehicle uuid)
  RETURNS TABLE (value_class text, value_class_source text, rule_make text, rule_model text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.value_class, v.value_class_source, r.make_slug, r.model_slug
    FROM core.catalog_vehicle AS v
    LEFT JOIN core.catalog_value_class_rule AS r ON r.id = v.value_class_rule_id
   WHERE v.id = p_vehicle
$fn$;

-- Nouvelle version du défaut du pays valable à platform.now(), écrite dans la transaction de
-- l'appelant, qui l'ANNULE ensuite (comme us118_param_version). Clé fermée.
CREATE FUNCTION test_fixture.n83_default_class(p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES ('vehicle_default_value_class', p_country, 'COUNTRY', p_value, 'test N-83 (annulé)')
$fn$;

REVOKE ALL ON FUNCTION test_fixture.n83_vehicle_class(uuid),
  test_fixture.n83_default_class(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.n83_vehicle_class(uuid),
  test_fixture.n83_default_class(text, jsonb) TO app_api;
