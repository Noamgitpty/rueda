-- 9600 — fixtures des tests NTF (US-021). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : poser le numéro d'un compte (vérifié ou non) en attendant la story de vérification du
-- téléphone (ACC-014), sans donner à app_api un droit qu'il n'aura pas en production.
-- SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique.
--
-- Retour arrière : DROP FUNCTION test_fixture.ntf_set_phone(uuid, text, boolean);

CREATE FUNCTION test_fixture.ntf_set_phone(p_user_id uuid, p_phone text, p_verified boolean)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_user_account
     SET phone_e164 = p_phone,
         phone_verified_at = CASE WHEN p_verified THEN platform.now() END
   WHERE id = p_user_id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.ntf_set_phone(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.ntf_set_phone(uuid, text, boolean) TO app_api;
