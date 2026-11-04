-- 9930 — fixtures de la rotation de la clé de preuve MFA (US-051, migration 0052). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (et à ses copies).
--
-- En production, les gestes de rotation (core.iam_mfa_proof_key_rotate) se jouent sous `migrator`
-- (runbook docs/ops/SECRET_ROTATION.md, CLI packages/db/src/rotation/cli.ts). Pour les éprouver sans
-- connexion `migrator` dans les tests (CLAUDE.md point 6), cette fixture SECURITY DEFINER sous
-- migrator appelle la fonction de PRODUCTION telle quelle, dans la transaction de l'appelant ; les
-- tests rendent la transaction par ROLLBACK. Les clés sont des valeurs de TEST (dérivées de
-- chaînes publiques dans le test), jamais des secrets.
--
-- Retour arrière : DROP FUNCTION test_fixture.us051_rotate_mfa_key(text, bytea),
--   test_fixture.us051_mfa_key_slots().

CREATE FUNCTION test_fixture.us051_rotate_mfa_key(p_action text, p_key bytea)
  RETURNS text
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.iam_mfa_proof_key_rotate(p_action, p_key)
$fn$;

-- Emplacements occupés (1, 2), sans les clés.
CREATE FUNCTION test_fixture.us051_mfa_key_slots()
  RETURNS smallint[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(pg_catalog.array_agg(k.id ORDER BY k.id), '{}'::smallint[])
    FROM core.iam_mfa_proof_key AS k
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us051_rotate_mfa_key(text, bytea),
  test_fixture.us051_mfa_key_slots() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us051_rotate_mfa_key(text, bytea),
  test_fixture.us051_mfa_key_slots() TO app_api;
