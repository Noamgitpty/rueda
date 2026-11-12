-- 9974 — fixtures des preuves du numéro de châssis et de l'historique des engagements (US-124, correctif, migration 0083). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Relectures (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) de
-- l'historique des engagements, que les rôles applicatifs ne lisent pas, et tentative de
-- modification ou de suppression d'un engagement (preuve de l'ajout seul : SQLSTATE rendu). Les
-- attendus du test viennent de 08 BR-LIST-04, d'ISO 3779, de DEC-FONDATEUR-22 et d'ADR-113,
-- jamais de ces relectures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us124_attestations(uuid),
--   test_fixture.us124_attestation_tamper(uuid, text).

-- Engagements d'un véhicule, du plus ancien au plus récent.
CREATE FUNCTION test_fixture.us124_attestations(p_vehicle uuid)
  RETURNS TABLE (statement text, statement_key text, catalog_version integer, locale text,
                 statement_text text, user_id uuid, country_code text, attested_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.statement, a.statement_key, a.catalog_version, a.locale, a.statement_text, a.user_id,
         a.country_code, a.attested_at
    FROM core.catalog_vehicle_attestation a WHERE a.vehicle_id = p_vehicle
   ORDER BY a.attested_at, a.statement
$fn$;

-- Tentative de réécriture (UPDATE) ou d'effacement (DELETE) des engagements d'un véhicule : rend
-- le SQLSTATE levé, ou « OK » si l'instruction est passée (ce qui serait un défaut).
CREATE FUNCTION test_fixture.us124_attestation_tamper(p_vehicle uuid, p_kind text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_kind = 'UPDATE' THEN
    UPDATE core.catalog_vehicle_attestation SET statement_text = 'réécrit'
     WHERE vehicle_id = p_vehicle;
  ELSE
    DELETE FROM core.catalog_vehicle_attestation WHERE vehicle_id = p_vehicle;
  END IF;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us124_attestations(uuid),
  test_fixture.us124_attestation_tamper(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us124_attestations(uuid),
  test_fixture.us124_attestation_tamper(uuid, text) TO app_api;
