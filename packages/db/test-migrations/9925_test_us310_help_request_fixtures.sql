-- 9925 — fixtures de la demande d'aide du trip (US-310, migration 0161). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Deux lectures, sans aucune écriture : la ligne d'un dossier de support (colonnes de la demande
-- d'aide, assignation, dates) et les événements de l'outbox d'un dossier (type, rôle de l'acteur,
-- charge utile). SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api. Les
-- attendus des tests viennent de 19 US-310, de 16 SUP-004 et de 10b S17, jamais de ces fonctions.
--
-- Retour arrière : DROP FUNCTION test_fixture.us310_case(uuid), test_fixture.us310_events(uuid).

CREATE FUNCTION test_fixture.us310_case(p_case uuid)
  RETURNS TABLE (requester_user_id uuid, country_code text, trip_id uuid, channel text,
                 category text, priority text, status text, assignee_id uuid, help_topic text,
                 requester_role text, off_hours boolean, created_at timestamptz,
                 first_response_at timestamptz, resolved_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.requester_user_id, c.country_code, c.trip_id, c.channel, c.category, c.priority,
         c.status, c.assignee_id, c.help_topic, c.requester_role, c.off_hours, c.created_at,
         c.first_response_at, c.resolved_at
    FROM core.support_support_case AS c WHERE c.id = p_case
$fn$;

CREATE FUNCTION test_fixture.us310_events(p_case uuid)
  RETURNS TABLE (type text, aggregate_type text, country_code text, actor_user_id uuid,
                 actor_role text, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_type, e.country_code, e.actor_user_id, e.actor_role, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_id = p_case
   ORDER BY e.id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us310_case(uuid), test_fixture.us310_events(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us310_case(uuid), test_fixture.us310_events(uuid) TO app_api;
