-- 9917 — fixtures des preuves de la détection automatique des retards (US-305, migration 0168).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER, search_path figé ; aucun SQL dynamique) :
--   1. `us305_records` (migrator) : relecture des lignes qu'aucun rôle applicatif ne lit (état du
--      trip et marque « à risque », dossier de retard, occupation TRIP, transitions vers OVERDUE,
--      événements du trip) ;
--   2. `us305_money` (migrator) : empreinte des écritures d'argent du trip (règlements, soldes et
--      `release_at` des jambes, mouvements de jambe, opérations de paiement du hold, grand livre
--      de l'hôte), comparée avant et après la détection ;
--   3. `us305_case_probe` (cmd_hold_owner, garde active) : réécriture d'un fait figé du dossier, ou
--      recul de la prolongation, sous les seuls droits et politiques de cmd_hold_owner.
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1) ni un paramètre.
--
-- Retour arrière : DROP FUNCTION test_fixture.us305_records(uuid), test_fixture.us305_money(uuid),
--   test_fixture.us305_case_probe(uuid, text).

CREATE FUNCTION test_fixture.us305_records(p_trip uuid)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'status', t.status,
    'atRiskReason', t.at_risk_reason,
    'holderUserId', (SELECT o.holder_user_id FROM core.iam_organization AS o WHERE o.id = t.org_id),
    'case', (SELECT pg_catalog.jsonb_build_object(
                      'stage', c.stage, 'countryCode', c.country_code,
                      'scheduledEnd', c.scheduled_end, 'detectionMinutes', c.detection_minutes,
                      'detectedAt', c.detected_at, 'useUntil', c.use_until,
                      'occupancyUntil', c.occupancy_until, 'bounded', c.bounded,
                      'nextTripId', c.next_trip_id)
               FROM core.trip_ops_overdue_case AS c WHERE c.trip_id = t.id),
    'occupancy', (SELECT pg_catalog.jsonb_build_object(
                           'lower', pg_catalog.lower(o.period), 'upper', pg_catalog.upper(o.period),
                           'active', o.active)
                    FROM core.booking_vehicle_occupancy AS o
                   WHERE o.kind = 'TRIP' AND o.ref_type = 'TRIP' AND o.ref_id = t.id
                   ORDER BY o.active DESC LIMIT 1),
    'overdueTransitions', (SELECT pg_catalog.count(*) FROM core.booking_trip_state_log AS l
                            WHERE l.trip_id = t.id AND l.to_status = 'OVERDUE'),
    'events', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'type', e.type, 'countryCode', e.country_code,
                                 'actorRole', e.actor_role, 'payload', e.payload)
                                 ORDER BY e.id)
                          FROM core.outbox_outbox_event AS e
                         WHERE e.aggregate_type = 'trip' AND e.aggregate_id = t.id
                           AND (e.type IN ('trip.overdue.detected', 'trip.at_risk.flagged')
                                OR (e.type = 'trip.status_changed'
                                    AND e.payload ->> 'to' = 'OVERDUE'))), '[]'::jsonb))
    FROM core.booking_trip AS t WHERE t.id = p_trip
$fn$;

CREATE FUNCTION test_fixture.us305_money(p_trip uuid)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'settlements', (SELECT pg_catalog.count(*) FROM core.settlement_settlement AS s
                     WHERE s.trip_id = p_trip),
    'legBalances', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) ORDER BY b.leg)
                               FROM core.settlement_trip_leg_balance AS b
                              WHERE b.trip_id = p_trip), '[]'::jsonb),
    'legMovements', (SELECT pg_catalog.count(*) FROM core.settlement_leg_movement AS m
                      WHERE m.trip_id = p_trip),
    'operations', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                     'id', op.id, 'kind', op.kind, 'status', op.status,
                                     'amountMinor', op.amount_minor) ORDER BY op.id)
                              FROM core.payment_payment_operation AS op
                              JOIN core.booking_trip AS t ON t.source_hold_id = op.hold_id
                             WHERE t.id = p_trip), '[]'::jsonb),
    'hostLedger', (SELECT pg_catalog.count(*) FROM core.settlement_host_ledger_entry AS h
                   WHERE h.trip_id = p_trip))
$fn$;

-- Réécriture directe du dossier sous cmd_hold_owner (garde active, contexte trip_overdue posé par
-- le test) : `END` réécrit la fin prévue figée ; `SHRINK` recule la prolongation tacite. Aucune
-- condition ajoutée : seuls les droits, les politiques et la garde jouent.
CREATE FUNCTION test_fixture.us305_case_probe(p_trip uuid, p_op text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  IF p_op = 'END' THEN
    UPDATE core.trip_ops_overdue_case SET scheduled_end = scheduled_end + interval '1 hour'
     WHERE trip_id = p_trip;
  ELSIF p_op = 'SHRINK' THEN
    UPDATE core.trip_ops_overdue_case SET use_until = use_until - interval '1 hour'
     WHERE trip_id = p_trip;
  ELSE
    RAISE EXCEPTION 'us305_case_probe: unknown operation';
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us305_records(uuid), test_fixture.us305_money(uuid),
  test_fixture.us305_case_probe(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us305_records(uuid), test_fixture.us305_money(uuid),
  test_fixture.us305_case_probe(uuid, text) TO app_worker, app_api;

-- Transfert de la sonde au propriétaire des commandes (précédent : 9997) ; CREATE le temps du
-- transfert. EXECUTE accordé avant : migrator n'est plus propriétaire ensuite.
GRANT CREATE ON SCHEMA test_fixture TO cmd_hold_owner;
ALTER FUNCTION test_fixture.us305_case_probe(uuid, text) OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_hold_owner;
