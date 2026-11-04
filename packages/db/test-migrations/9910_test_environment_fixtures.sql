-- 9910 — fixtures de la déclaration d'environnement (US-003, migration 0050). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (et à ses copies) ; la base `rueda_test_*_prod` garde les
-- définitions de production.
--
-- La déclaration s'écrit sous `migrator` (job de déploiement). Pour l'éprouver sans connexion
-- `migrator` dans les tests (CLAUDE.md point 6), ces fixtures SECURITY DEFINER sous migrator,
-- propriétaire de la table, jouent le job DANS LA TRANSACTION DE L'APPELANT ; le test rend toujours
-- la transaction par ROLLBACK : rien n'est validé (la base de test reste non déclarée).
--   1. test_fixture.us003_declare(env) : appelle platform.declare_environment(env).
--   2. test_fixture.us003_tamper(op) : tente UPDATE, DELETE ou TRUNCATE de la déclaration.
--   3. test_fixture.us003_declared() : platform.declared_environment() telle que la lit la garde.
--
-- Retour arrière : DROP FUNCTION test_fixture.us003_declare(text), test_fixture.us003_tamper(text),
--   test_fixture.us003_declared().

CREATE FUNCTION test_fixture.us003_declare(p_environment text)
  RETURNS text
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT platform.declare_environment(p_environment)
$fn$;

CREATE FUNCTION test_fixture.us003_tamper(p_op text)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_op
    WHEN 'UPDATE' THEN
      UPDATE platform.environment_declaration SET environment = 'production';
    WHEN 'DELETE' THEN
      DELETE FROM platform.environment_declaration;
    WHEN 'TRUNCATE' THEN
      TRUNCATE platform.environment_declaration;
    ELSE
      RAISE EXCEPTION 'us003_tamper: opération inconnue';
  END CASE;
END
$fn$;

CREATE FUNCTION test_fixture.us003_declared()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.environment FROM platform.environment_declaration AS d WHERE d.singleton
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us003_declare(text), test_fixture.us003_tamper(text),
  test_fixture.us003_declared() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us003_declare(text), test_fixture.us003_tamper(text),
  test_fixture.us003_declared() TO app_worker;
