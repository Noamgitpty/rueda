-- 9938 — fixture des preuves de l'hôte figé de la constancia et de l'hôte du checkout S05 (US-212,
-- partie 212b, migration 0146 ; BOARD N-345, N-346). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   `us212b_rename` : nom légal d'un compte changé APRÈS la réservation (forme d'une nouvelle
--   vérification d'identité, US-103), pour prouver que la constancia lit le nom FIGÉ du contrat et
--   que S05 lit le nom courant du compte.
-- Appelée SEULEMENT dans une transaction ANNULÉE. AUCUNE fixture n'écrit un interrupteur de mise en
-- service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us212b_rename(uuid, text, text).

CREATE FUNCTION test_fixture.us212b_rename(p_user uuid, p_first text, p_last text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_user_account AS u
     SET legal_first_name = p_first, legal_last_name = p_last
   WHERE u.id = p_user
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us212b_rename(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us212b_rename(uuid, text, text) TO app_api;
