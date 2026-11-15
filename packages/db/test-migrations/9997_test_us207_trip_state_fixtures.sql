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
--     journal n'est écrite ;
--   - sonde de la garde trip_transition_guard (revue QA n° 2, revue architecture n° 4) :
--     `us207_guard_probe` appartient à cmd_hold_owner (le propriétaire des commandes, qui a le
--     droit UPDATE (status) et n'est PAS exempté de la garde) et écrit l'état EN DIRECT, sans
--     passer par une commande, avec ou sans ligne de journal : la garde elle-même doit refuser
--     (trip_transition_unlogged, trip_transition_forbidden). Toujours DANS une transaction annulée.
--
-- Retour arrière : DROP FUNCTION test_fixture.us207_state_log(uuid), test_fixture.us207_segment(uuid),
--   test_fixture.us207_driver(uuid), test_fixture.us207_transitions(), test_fixture.us207_events(uuid),
--   test_fixture.us207_force_status(uuid, text), test_fixture.us207_segment_id(uuid),
--   test_fixture.us207_guard_probe(uuid, text, text, text).

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

CREATE FUNCTION test_fixture.us207_segment_id(p_trip uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.id FROM core.booking_trip_segment AS s WHERE s.trip_id = p_trip AND s.seq = 1
$fn$;

-- Écriture directe de l'état sous cmd_hold_owner (garde active) : ligne de journal facultative
-- (p_log_from → p_log_to, de la transaction courante), puis UPDATE de status. Aucune condition
-- ajoutée : seuls les droits, les politiques (travailleur trip_lifecycle) et la garde jouent.
CREATE FUNCTION test_fixture.us207_guard_probe(p_trip uuid, p_status text, p_log_from text,
                                               p_log_to text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_log_to IS NOT NULL THEN
    INSERT INTO core.booking_trip_state_log
           (id, trip_id, from_status, to_status, kind, reason_code, actor_role)
    VALUES (pg_catalog.gen_random_uuid(), p_trip, p_log_from, p_log_to, 'TRANSITION',
            'TEST_GUARD_PROBE', 'SYSTEM');
  END IF;
  UPDATE core.booking_trip SET status = p_status WHERE id = p_trip;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'us207_guard_probe: trip % not updated', p_trip;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us207_state_log(uuid), test_fixture.us207_segment(uuid),
  test_fixture.us207_driver(uuid), test_fixture.us207_transitions(), test_fixture.us207_events(uuid),
  test_fixture.us207_force_status(uuid, text), test_fixture.us207_segment_id(uuid),
  test_fixture.us207_guard_probe(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us207_state_log(uuid), test_fixture.us207_segment(uuid),
  test_fixture.us207_driver(uuid), test_fixture.us207_transitions(), test_fixture.us207_events(uuid),
  test_fixture.us207_force_status(uuid, text), test_fixture.us207_segment_id(uuid),
  test_fixture.us207_guard_probe(uuid, text, text, text) TO app_worker, app_api;

-- Transfert de la sonde au propriétaire des commandes (précédent : 9400, 9700, 9940) ; CREATE le
-- temps du transfert. EXECUTE accordé avant : migrator n'est plus propriétaire ensuite.
GRANT CREATE ON SCHEMA test_fixture TO cmd_hold_owner;
ALTER FUNCTION test_fixture.us207_guard_probe(uuid, text, text, text) OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_hold_owner;
