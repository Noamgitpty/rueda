-- 9956 — Fixtures de TEST d'US-215 (215a, ADR-148) : lecture d'une demande d'annulation et des
-- occupations d'un trip, pour les preuves L0 sous les rôles de production (app_api, app_worker).
-- Aucune écriture. Jamais en production (test-migrations/ seulement). SECURITY DEFINER sous
-- migrator (politique migrator_all) ; le journal d'état et les événements du trip sont lus par les
-- fixtures d'US-207 (9997 : us207_state_log, us207_events).
--
-- Retour arrière : DROP FUNCTION test_fixture.us215_cancellation(uuid),
--   test_fixture.us215_occupancy(uuid).

CREATE FUNCTION test_fixture.us215_cancellation(p_id uuid)
  RETURNS TABLE (trip_id uuid, action_code text, requested_reason text, initiator text,
                 sub_reason text, status text, settlement_id uuid, cost_bearer text,
                 outcome_code text, requested_at timestamptz, requested_by uuid,
                 decided boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.trip_id, c.action_code, c.requested_reason, c.initiator, c.sub_reason, c.status,
         c.settlement_id, c.cost_bearer, c.outcome_code, c.requested_at, c.requested_by,
         c.decided_at IS NOT NULL
    FROM core.booking_trip_cancellation AS c
   WHERE c.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us215_occupancy(p_trip uuid)
  RETURNS TABLE (vehicle_active boolean, guest_active boolean, cancel_initiator text,
                 cancel_requested_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM core.booking_vehicle_occupancy AS v
                  WHERE v.kind = 'TRIP' AND v.ref_type = 'TRIP' AND v.ref_id = t.id AND v.active),
         EXISTS (SELECT 1 FROM core.booking_guest_occupancy AS g
                  WHERE g.trip_id = t.id AND g.active),
         t.cancel_initiator, t.cancel_requested_at
    FROM core.booking_trip AS t
   WHERE t.id = p_trip
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us215_cancellation(uuid), test_fixture.us215_occupancy(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us215_cancellation(uuid), test_fixture.us215_occupancy(uuid)
  TO app_worker, app_api;
