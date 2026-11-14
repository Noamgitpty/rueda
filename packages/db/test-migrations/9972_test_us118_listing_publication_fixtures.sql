-- 9972 — fixtures des preuves de la publication d'une annonce (US-118, migrations 0084 et 0085). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Relectures (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) de
-- l'annonce (statut et dates) ; la valeur de `listing_manual_review_required` posée dans une
-- transaction de test ANNULÉE ; une zone affichée posée sans passer par la commande (lieu écrit
-- avant le filtre de 0084). Les attendus du test viennent de 19 US-118, 16 HST-016 / HST-026 /
-- ADM-003, 08 SM-2 / BR-LIST-09, 22 OQ-BR-29 et du BOARD N-62, jamais de ces fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us118_listing(uuid),
--   test_fixture.us118_param_version(text, text, jsonb), test_fixture.us118_set_area(uuid, text), test_fixture.us118_set_city(uuid, text).

-- Statut et dates d'une annonce.
CREATE FUNCTION test_fixture.us118_listing(p_listing uuid)
  RETURNS TABLE (status text, submitted_at timestamptz, published_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.status, l.submitted_at, l.published_at
    FROM core.catalog_listing l WHERE l.id = p_listing
$fn$;

-- Nouvelle version d'un paramètre de la publication valable à platform.now(), écrite dans la
-- transaction de l'appelant, qui l'ANNULE ensuite (comme us124_param_version). Clés fermées.
CREATE FUNCTION test_fixture.us118_param_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key NOT IN ('listing_manual_review_required') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-118 (annulé)');
END
$fn$;

-- Zone affichée d'un lieu posée directement (lieu antérieur au filtre de la commande, 0084).
CREATE FUNCTION test_fixture.us118_set_area(p_location uuid, p_area text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.catalog_location SET area_label = p_area WHERE id = p_location
$fn$;

-- Ville d'un lieu posée directement (lieu antérieur au filtre de la commande, 0084).
CREATE FUNCTION test_fixture.us118_set_city(p_location uuid, p_city text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.catalog_location SET city = p_city WHERE id = p_location
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us118_listing(uuid), test_fixture.us118_set_city(uuid, text),
  test_fixture.us118_param_version(text, text, jsonb), test_fixture.us118_set_area(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us118_listing(uuid), test_fixture.us118_set_city(uuid, text),
  test_fixture.us118_param_version(text, text, jsonb), test_fixture.us118_set_area(uuid, text)
  TO app_api;
