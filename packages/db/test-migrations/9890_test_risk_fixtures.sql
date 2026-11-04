-- 9890 — fixtures des preuves de la limitation de débit (US-052, migration 0047). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : relire, sous `migrator` (politique migrator_all), les compteurs et le journal des abus
-- qu'aucun rôle applicatif ne lit, pour vérifier ce que les commandes ont écrit (empreintes de
-- 32 octets, agrégation par heure). SECURITY DEFINER sous migrator, search_path figé, aucun SQL
-- dynamique. Filtre par empreinte : un test ne voit que ses propres lignes.
--
-- Retour arrière : DROP FUNCTION test_fixture.risk_abuse_rows(bytea),
--   test_fixture.risk_counter_rows(bytea), test_fixture.risk_abuse_by_kind(text, text);

CREATE FUNCTION test_fixture.risk_abuse_rows(p_key_hash bytea)
  RETURNS TABLE (kind text, scope text, country_code text, occurrences integer, signals text[],
                 key_size integer, bucket_start timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.kind, e.scope, e.country_code::text, e.occurrences, e.signals,
         pg_catalog.octet_length(e.key_hash), e.bucket_start
    FROM core.risk_abuse_event AS e WHERE e.key_hash = p_key_hash
   ORDER BY e.bucket_start, e.kind, e.scope
$fn$;

CREATE FUNCTION test_fixture.risk_counter_rows(p_key_hash bytea)
  RETURNS TABLE (scope text, country_code text, hits integer, window_start timestamptz,
                 window_end timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.scope, c.country_code::text, c.hits, c.window_start, c.window_end
    FROM core.risk_rate_counter AS c WHERE c.key_hash = p_key_hash
   ORDER BY c.window_start, c.scope
$fn$;

-- Journal du plafond SMS d'un pays (empreinte fixe du pays, sans donnée personnelle).
CREATE FUNCTION test_fixture.risk_abuse_by_kind(p_kind text, p_country text)
  RETURNS TABLE (scope text, occurrences integer, bucket_start timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.scope, e.occurrences, e.bucket_start
    FROM core.risk_abuse_event AS e
   WHERE e.kind = p_kind AND e.country_code = p_country
   ORDER BY e.bucket_start
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.risk_abuse_rows(bytea),
  test_fixture.risk_counter_rows(bytea),
  test_fixture.risk_abuse_by_kind(text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.risk_abuse_rows(bytea),
  test_fixture.risk_counter_rows(bytea),
  test_fixture.risk_abuse_by_kind(text, text)
TO app_api, app_worker;
