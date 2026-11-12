-- 9992 — fixtures des preuves des interrupteurs à deux personnes (US-125, migration 0073). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, comme test_fixture.hold_force_write de 9750, search_path
-- figé, EXECUTE au seul app_api) :
--   1. test_fixture.us125_migrator_write : une écriture DIRECTE de config_param_value exécutée
--      sous `migrator` (revue qa US-125 n° 1), pour éprouver la branche (a) de la garde : graine
--      à false acceptée ; true, clé non canonique, demande liée, UPDATE et DELETE refusés. À
--      n'appeler que dans une transaction annulée.
--   2. test_fixture.us125_events : événements `config.param.changed` émis pour une clé et un pays
--      (relecture : les rôles applicatifs ne lisent pas l'outbox).
-- Les attendus des tests viennent de 19 US-125 et de 17 §2.3 / RLS-27, jamais de ces fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us125_migrator_write(text, text, text),
--   test_fixture.us125_events(text, text).

CREATE FUNCTION test_fixture.us125_migrator_write(p_what text, p_key text, p_country text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_what
    WHEN 'insert_false' THEN
      INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
      VALUES (p_key, p_country, 'COUNTRY', 'false'::jsonb, 'US-125 : graine de test sous migrator');
    WHEN 'insert_true' THEN
      INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
      VALUES (p_key, p_country, 'COUNTRY', 'true'::jsonb, 'US-125 : écriture directe sous migrator');
    WHEN 'insert_false_with_request' THEN
      INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason,
                                           go_live_request_id)
      VALUES (p_key, p_country, 'COUNTRY', 'false'::jsonb, 'US-125 : demande forgée',
              pg_catalog.gen_random_uuid());
    WHEN 'update' THEN
      UPDATE core.config_param_value SET valid_to = platform.now() + interval '1 day'
       WHERE key = p_key AND country_code = p_country AND valid_to IS NULL;
    WHEN 'delete' THEN
      DELETE FROM core.config_param_value WHERE key = p_key AND country_code = p_country;
    ELSE
      RAISE EXCEPTION 'us125_migrator_write : cas inconnu %', p_what;
  END CASE;
END
$fn$;

CREATE FUNCTION test_fixture.us125_events(p_key text, p_country text)
  RETURNS TABLE (type text, aggregate_type text, country_code text, actor_user_id uuid,
                 actor_role text, correlation_id uuid, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_type, e.country_code, e.actor_user_id, e.actor_role,
         e.correlation_id, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.type = 'config.param.changed' AND e.payload ->> 'key' = p_key
     AND e.country_code = p_country
   ORDER BY e.id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us125_migrator_write(text, text, text),
  test_fixture.us125_events(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us125_migrator_write(text, text, text),
  test_fixture.us125_events(text, text) TO app_api;
