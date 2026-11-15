-- 9997 — fixtures des preuves de la machine à états du trip (US-207, migration 0099). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE à app_worker et app_api) :
--   - relectures des lignes qu'aucun rôle applicatif ne lit (journal d'état, segment, conducteur,
--     table des transitions, événements du trip) : les attendus des tests viennent de 08 SM-1,
--     BR-CXL, de 16 TRP-045 et de 17 §3.2.4, §4.5, §7.2, jamais de ces relectures ;
--   - état forcé d'un trip (sous migrator, exempté de la garde trip_transition_guard) : point de
--     départ de l'épreuve « chaque paire interdite », DANS une transaction annulée ; aucune ligne de
--     journal n'est écrite.
--
-- Retour arrière : DROP FUNCTION test_fixture.us207_state_log(uuid), test_fixture.us207_segment(uuid),
--   test_fixture.us207_driver(uuid), test_fixture.us207_transitions(), test_fixture.us207_events(uuid),
--   test_fixture.us207_force_status(uuid, text).

CREATE FUNCTION test_fixture.us207_state_log(p_trip uuid)
  RETURNS TABLE (from_status text, to_status text, kind text, reason_code text, origin text,
                 actor_role text, actor_user_id uuid, settlement_id uuid, at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.from_status, l.to_status, l.kind, l.reason_code, l.origin, l.actor_role,
         l.actor_user_id, l.settlement_id, l.at
    FROM core.booking_trip_state_log AS l
   WHERE l.trip_id = p_trip
   ORDER BY l.at, (l.from_status IS NOT NULL), l.created_at
$fn$;

CREATE FUNCTION test_fixture.us207_segment(p_trip uuid)
  RETURNS TABLE (seq integer, lo timestamptz, hi timestamptz, billable_days integer,
                 payment_status text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.seq, lower(s.period), upper(s.period), s.billable_days, s.payment_status
    FROM core.booking_trip_segment AS s
   WHERE s.trip_id = p_trip
   ORDER BY s.seq
$fn$;

CREATE FUNCTION test_fixture.us207_driver(p_trip uuid)
  RETURNS TABLE (user_id uuid, role text, approved boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.user_id, d.role, d.approved_at IS NOT NULL
    FROM core.booking_trip_driver AS d
   WHERE d.trip_id = p_trip
   ORDER BY d.role, d.user_id
$fn$;

CREATE FUNCTION test_fixture.us207_transitions()
  RETURNS TABLE (from_status text, to_status text, via text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.from_status, t.to_status, t.via
    FROM core.booking_trip_transition AS t
   ORDER BY t.from_status, t.to_status
$fn$;

CREATE FUNCTION test_fixture.us207_events(p_trip uuid)
  RETURNS TABLE (type text, aggregate_version bigint, actor_role text, country_code text,
                 payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_version, e.actor_role, e.country_code, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_type = 'trip' AND e.aggregate_id = p_trip
     AND e.type IN ('trip.status_changed', 'trip.cancellation.qualified')
   ORDER BY e.aggregate_version, e.type
$fn$;

CREATE FUNCTION test_fixture.us207_force_status(p_trip uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.booking_trip
     SET status = p_status,
         termination_reason = CASE WHEN p_status = 'TERMINATED_EARLY'
                                   THEN 'TERM_BREAKDOWN_NOT_GUEST' END
   WHERE id = p_trip
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us207_state_log(uuid), test_fixture.us207_segment(uuid),
  test_fixture.us207_driver(uuid), test_fixture.us207_transitions(), test_fixture.us207_events(uuid),
  test_fixture.us207_force_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us207_state_log(uuid), test_fixture.us207_segment(uuid),
  test_fixture.us207_driver(uuid), test_fixture.us207_transitions(), test_fixture.us207_events(uuid),
  test_fixture.us207_force_status(uuid, text) TO app_worker, app_api;
