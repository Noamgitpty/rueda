-- 9935 — Fixtures de TEST du durcissement avant l'ouverture d'un pays (migration 0147, ADR-171 ;
-- BOARD N-354, N-342). Jamais en production (test-migrations/ seulement). SECURITY DEFINER sous
-- migrator (politique migrator_all), search_path figé ; l'appelant reste sous un rôle de
-- production (L0-05), dans une transaction de test.
--
--   - hard_restrict : restriction active d'un genre donné (liste fermée de la table) sur une
--     personne (titulaire d'un compte d'hôte de la fixture 9300) ;
--   - hard_membership_status : statut de l'adhésion P2P_HOST du titulaire d'un compte d'hôte
--     (adhésion retirée : REMOVED) ;
--   - hard_add_cohost : co-hôte ACTIVE d'un compte d'hôte (personne neuve), rend son identifiant.
-- Les attendus des tests viennent d'ADR-171, d'ADR-163 et d'ADR-161, jamais de ces fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.hard_restrict(uuid, text),
--   test_fixture.hard_membership_status(uuid, text), test_fixture.hard_add_cohost(uuid).

CREATE FUNCTION test_fixture.hard_restrict(p_user_id uuid, p_kind text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_restriction (id, user_id, kind, active, reason)
  VALUES (pg_catalog.gen_random_uuid(), p_user_id, p_kind, true, 'test durcissement (N-354)')
$fn$;

CREATE FUNCTION test_fixture.hard_membership_status(p_org_id uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_membership AS m
     SET status = p_status
    FROM core.iam_organization AS o
   WHERE o.id = p_org_id AND m.org_id = o.id AND m.user_id = o.holder_user_id
     AND m.role = 'P2P_HOST'
$fn$;

CREATE FUNCTION test_fixture.hard_add_cohost(p_org_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale,
                                     status)
  VALUES (v_user, pg_catalog.format('cohost-%s@fixture.test', v_user), 'Fixture', 'Cohost', 'en',
          'ACTIVE');
  INSERT INTO core.iam_membership (id, user_id, org_id, role, status)
  VALUES (pg_catalog.gen_random_uuid(), v_user, p_org_id, 'CO_HOST', 'ACTIVE');
  RETURN v_user;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.hard_restrict(uuid, text),
  test_fixture.hard_membership_status(uuid, text), test_fixture.hard_add_cohost(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.hard_restrict(uuid, text),
  test_fixture.hard_membership_status(uuid, text), test_fixture.hard_add_cohost(uuid) TO app_api;
