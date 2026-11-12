-- 9975 — fixtures des preuves des CGU de l'hôte (US-126, migration 0070). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) : relecture du
-- pays et de la rétention C2 des consentements `TOS_HOST` d'une personne (colonnes que
-- `core.ctr_consent_history` ne rend pas). Les attendus viennent de 19 US-126 et de 17 §3.2.6,
-- jamais de cette relecture.
--
-- Retour arrière : DROP FUNCTION test_fixture.us126_host_consent_row(uuid).

CREATE FUNCTION test_fixture.us126_host_consent_row(p_user_id uuid)
  RETURNS TABLE (country_code text, c2_withheld boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.country_code::text, c.c2_withheld
    FROM core.contract_consent c
   WHERE c.user_id = p_user_id AND c.doc_kind = 'TOS_HOST'
   ORDER BY c.seq
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us126_host_consent_row(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us126_host_consent_row(uuid) TO app_api;
