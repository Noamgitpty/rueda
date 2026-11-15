-- 9991 — fixtures des preuves de la lecture des trips de l'hôte (US-219, migration 0100). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE à app_api) : profil du voyageur
-- d'un trip que les commandes du lot 1 ne posent pas en une étape (date de naissance, vérification
-- d'identité APPROVED courante, pseudonymisation) ; ce sont des DONNÉES d'entrée. Les attendus des
-- tests viennent de 19 US-219, de 16 HDB-002 et de 17 `host_guest_v`, jamais de ce fichier.
--
-- Retour arrière : DROP FUNCTION test_fixture.us219_guest_profile(uuid, date, text, boolean, boolean).

CREATE FUNCTION test_fixture.us219_guest_profile(p_user uuid, p_dob date, p_country text,
                                                 p_verified boolean, p_pseudonymized boolean)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE core.iam_user_account
     SET date_of_birth = p_dob,
         pseudonymized_at = CASE WHEN p_pseudonymized THEN platform.now() END
   WHERE id = p_user;
  IF p_verified THEN
    INSERT INTO core.kyc_identity_verification (user_id, country_code, status, approved_at,
                                                expires_at)
    VALUES (p_user, p_country, 'APPROVED', platform.now(), platform.now() + interval '1 year');
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us219_guest_profile(uuid, date, text, boolean, boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us219_guest_profile(uuid, date, text, boolean, boolean)
  TO app_api;
