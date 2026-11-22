-- 9912 — fixtures des preuves de l'escalade de non-restitution et de la vue des retards (US-306,
-- migration 0173). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER, search_path figé ; aucun SQL dynamique) :
--   1. `us306_records` (migrator) : relecture des lignes qu'aucun rôle applicatif ne lit (état du
--      trip, étape du dossier, escalades, événements `trip.overdue.escalated`, action de console
--      et son motif, transitions du trip, occupation TRIP) ;
--   2. `us306_stage_probe` (cmd_hold_owner, garde active) : réécriture directe de l'étape du dossier
--      sous les seuls droits et politiques de cmd_hold_owner (contexte posé par le test) ;
--   3. `us306_escalation_probe` (cmd_hold_owner, garde active) : réécriture ou suppression directe
--      d'une escalade ;
--   4. `us306_link` (migrator) : constat « comptes liés » (LINKED) entre deux personnes, décidé par
--      une troisième, tel que l'écrit la commande de l'ops d'US-127 (preuve de la garde ADR-122 :
--      un agent lié au voyageur d'un trip ne le voit ni ne l'escalade).
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1) ni un paramètre.
--
-- Retour arrière : DROP FUNCTION test_fixture.us306_records(uuid),
--   test_fixture.us306_stage_probe(uuid, text), test_fixture.us306_escalation_probe(uuid, text),
--   test_fixture.us306_link(uuid, uuid, uuid).

CREATE FUNCTION test_fixture.us306_records(p_trip uuid)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'status', t.status,
    'holderUserId', (SELECT o.holder_user_id FROM core.iam_organization AS o WHERE o.id = t.org_id),
    'stage', (SELECT c.stage FROM core.trip_ops_overdue_case AS c WHERE c.trip_id = t.id),
    'escalations', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                      'id', e.id, 'fromStage', e.from_stage, 'stage', e.stage,
                                      'countryCode', e.country_code,
                                      'documents', pg_catalog.to_jsonb(e.documents),
                                      'escalatedAt', e.escalated_at, 'dueAt', e.due_at,
                                      'eventId', e.event_id)
                                      ORDER BY e.escalated_at, e.id)
                               FROM core.trip_ops_overdue_escalation AS e
                              WHERE e.trip_id = t.id), '[]'::jsonb),
    'events', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'id', ev.id, 'countryCode', ev.country_code,
                                 'actorRole', ev.actor_role, 'actorUserId', ev.actor_user_id,
                                 'correlationId', ev.correlation_id, 'payload', ev.payload)
                                 ORDER BY ev.occurred_at, ev.id)
                          FROM core.outbox_outbox_event AS ev
                         WHERE ev.aggregate_type = 'trip' AND ev.aggregate_id = t.id
                           AND ev.type = 'trip.overdue.escalated'), '[]'::jsonb),
    'actions', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                  'id', m.id, 'outcome', m.outcome, 'reason', m.reason,
                                  'input', m.input, 'countryCode', m.country_code,
                                  'actorUserId', m.actor_user_id, 'actorRole', m.actor_role,
                                  'emittedEventIds', pg_catalog.to_jsonb(m.emitted_event_ids),
                                  'audited', m.audit_log_id IS NOT NULL)
                                  ORDER BY m.at, m.id)
                           FROM core.support_manual_action AS m
                          WHERE m.action_code = 'ESCALATE_OVERDUE' AND m.subject_id = t.id),
                        '[]'::jsonb),
    'transitions', (SELECT pg_catalog.count(*) FROM core.booking_trip_state_log AS l
                     WHERE l.trip_id = t.id),
    'occupancyActive', (SELECT pg_catalog.bool_or(o.active)
                          FROM core.booking_vehicle_occupancy AS o
                         WHERE o.kind = 'TRIP' AND o.ref_type = 'TRIP' AND o.ref_id = t.id))
    FROM core.booking_trip AS t WHERE t.id = p_trip
$fn$;

-- Réécriture directe de l'étape du dossier sous cmd_hold_owner (garde active ; contexte posé par
-- le test) : `p_stage` est écrite telle quelle. Seuls les droits, les politiques et la garde jouent.
CREATE FUNCTION test_fixture.us306_stage_probe(p_trip uuid, p_stage text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  UPDATE core.trip_ops_overdue_case SET stage = p_stage WHERE trip_id = p_trip;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

-- Réécriture (`UPDATE`) ou suppression (`DELETE`) directe d'une escalade sous cmd_hold_owner.
CREATE FUNCTION test_fixture.us306_escalation_probe(p_trip uuid, p_op text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  IF p_op = 'UPDATE' THEN
    UPDATE core.trip_ops_overdue_escalation SET escalated_at = escalated_at + interval '1 hour'
     WHERE trip_id = p_trip;
  ELSIF p_op = 'DELETE' THEN
    DELETE FROM core.trip_ops_overdue_escalation WHERE trip_id = p_trip;
  ELSE
    RAISE EXCEPTION 'us306_escalation_probe: unknown operation';
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

CREATE FUNCTION test_fixture.us306_link(p_a uuid, p_b uuid, p_decider uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.risk_account_link (id, user_low, user_high, decision, signal, decided_by,
                                      decided_at)
  VALUES (pg_catalog.gen_random_uuid(), LEAST(p_a, p_b), GREATEST(p_a, p_b), 'LINKED',
          'SAME_PHONE', p_decider, platform.now())
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us306_link(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us306_link(uuid, uuid, uuid) TO app_api;

REVOKE ALL ON FUNCTION test_fixture.us306_records(uuid),
  test_fixture.us306_stage_probe(uuid, text), test_fixture.us306_escalation_probe(uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us306_records(uuid),
  test_fixture.us306_stage_probe(uuid, text), test_fixture.us306_escalation_probe(uuid, text)
  TO app_worker, app_api;

-- Transfert des sondes au propriétaire des commandes (précédent : 9917) ; CREATE le temps du
-- transfert. EXECUTE accordé avant : migrator n'est plus propriétaire ensuite. La sonde de
-- suppression doit pouvoir être tentée : DELETE accordé à aucun rôle (42501 attendu).
GRANT CREATE ON SCHEMA test_fixture TO cmd_hold_owner;
ALTER FUNCTION test_fixture.us306_stage_probe(uuid, text) OWNER TO cmd_hold_owner;
ALTER FUNCTION test_fixture.us306_escalation_probe(uuid, text) OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_hold_owner;
