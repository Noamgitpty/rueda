-- 9901 — fixtures de la preuve d'ouverture de session (US-410, migration 0185, ADR-205). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (et à ses copies).
--
-- Rôle : remplacer le geste HORS APPLICATION que la production confie à l'exploitation
-- (installation de la clé sous `migrator`, runbook docs/ops/SECRET_ROTATION.md § 3.4) :
--   - la clé courante (id 1) est posée ici, une fois : une clé de TEST dérivée d'une chaîne
--     publique (la même dérivation que TEST_SESSION_OPEN_KEY de src/testing/session-open.ts),
--     jamais un secret. Les tests signent leurs ouvertures avec elle par node:crypto ;
--   - us410_rotate_session_open_key appelle la fonction de PRODUCTION de rotation telle quelle,
--     dans la transaction de l'appelant (les tests la rendent par ROLLBACK) ;
--   - us410_delete_session_open_key retire les clés, à n'appeler que dans une transaction annulée
--     (preuve « aucune clé => aucune session ») ;
--   - us410_session_open_key_slots rend les emplacements occupés, jamais une clé.
-- Aucune fixture ne rend une clé ni n'ouvre une session sans preuve.
--
-- Retour arrière : DROP FUNCTION test_fixture.us410_rotate_session_open_key(text, bytea),
--   test_fixture.us410_delete_session_open_key(), test_fixture.us410_session_open_key_slots();
--   DELETE FROM core.iam_session_open_key.

INSERT INTO core.iam_session_open_key (id, key)
VALUES (1, pg_catalog.sha256(pg_catalog.convert_to(
             'rueda-test-session-open-key (valeur de test publique)', 'UTF8')));

CREATE FUNCTION test_fixture.us410_rotate_session_open_key(p_action text, p_key bytea)
  RETURNS text
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.iam_session_open_key_rotate(p_action, p_key)
$fn$;

CREATE FUNCTION test_fixture.us410_delete_session_open_key()
  RETURNS void
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  DELETE FROM core.iam_session_open_key
$fn$;

CREATE FUNCTION test_fixture.us410_session_open_key_slots()
  RETURNS smallint[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(pg_catalog.array_agg(k.id ORDER BY k.id), '{}'::smallint[])
    FROM core.iam_session_open_key AS k
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us410_rotate_session_open_key(text, bytea),
  test_fixture.us410_delete_session_open_key(),
  test_fixture.us410_session_open_key_slots() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us410_rotate_session_open_key(text, bytea),
  test_fixture.us410_delete_session_open_key(),
  test_fixture.us410_session_open_key_slots() TO app_api;
