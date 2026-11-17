-- 9963 — Fixtures de TEST d'US-224b (ADR-147) : avance de Kmino PLANNED posée directement (sujet
-- d'une décision FINANCE, comme la crée core.payment_cmd_plan_refund) et passage forcé à OPEN sous
-- migrator, sans décision, que la garde advance_transition_guard doit refuser à TOUS les rôles
-- (advance_decision_required). Jamais en production (test-migrations/ seulement). SECURITY DEFINER
-- sous migrator (politique migrator_all) ; l'appelant reste sous un rôle de production.
--
-- Retour arrière : DROP FUNCTION test_fixture.us224b_insert_planned_advance(uuid, uuid, bigint),
--   test_fixture.us224b_force_advance_open(uuid).

CREATE FUNCTION test_fixture.us224b_insert_planned_advance(p_id uuid, p_trip_id uuid,
                                                          p_amount bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.settlement_platform_advance
         (id, country_code, currency, trip_id, org_id, cause, amount_minor, funded_from,
          receivable_minor, status)
  SELECT p_id, t.country_code, t.currency, t.id, t.org_id, 'RELEASED_LEG', p_amount,
         'COUNTRY_PLATFORM_BALANCE', p_amount, 'PLANNED'
    FROM core.booking_trip AS t
   WHERE t.id = p_trip_id
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us224b_insert_planned_advance(uuid, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us224b_insert_planned_advance(uuid, uuid, bigint)
  TO app_api, app_worker;

CREATE FUNCTION test_fixture.us224b_force_advance_open(p_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_platform_advance SET status = 'OPEN' WHERE id = p_id
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us224b_force_advance_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us224b_force_advance_open(uuid) TO app_api, app_worker;
