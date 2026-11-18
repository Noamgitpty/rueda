-- 9936 — fixtures des preuves du report de la capture convertie (US-221 partie 221b, migration
-- 0147, ADR-170). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. `us221b_legacy_conversion` : disposition CONVERSION d'une capture prouvée vers un trip de
--      fixture, SANS report sur les soldes : la forme qu'avait un trip réservé avant 0147 (défaut
--      D2 de la passation US-221) ; appelée SEULEMENT dans une transaction annulée (le contrôle
--      différé de la disposition n'est jamais atteint) ;
--   2. `us221b_capture_state` : rattachement et report d'une opération (trip de l'opération et de
--      ses jambes, mouvements), lecture des preuves sous app_worker.
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us221b_legacy_conversion(uuid, uuid),
--   test_fixture.us221b_capture_state(uuid).

CREATE FUNCTION test_fixture.us221b_legacy_conversion(p_operation_id uuid, p_trip_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  -- disposition CONVERSION posée SANS le report (forme d'avant 0147) ; le contrôle différé de la
  -- disposition (hold CONVERTED) n'est jamais atteint : transaction annulée seulement
  INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, trip_id)
  SELECT o.id, o.hold_id, 'CONVERSION', p_trip_id
    FROM core.payment_payment_operation AS o
   WHERE o.id = p_operation_id
$fn$;

CREATE FUNCTION test_fixture.us221b_capture_state(p_operation_id uuid)
  RETURNS TABLE (operation_trip_id uuid, legs_trip_ids uuid[], movements integer,
                 movement_kind text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.trip_id,
         ARRAY(SELECT DISTINCT l.trip_id FROM core.payment_payment_operation_leg AS l
                WHERE l.operation_id = o.id),
         (SELECT pg_catalog.count(*)::integer FROM core.settlement_leg_movement AS m
           WHERE m.operation_id = o.id),
         (SELECT m.kind FROM core.settlement_leg_movement AS m WHERE m.operation_id = o.id)
    FROM core.payment_payment_operation AS o
   WHERE o.id = p_operation_id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us221b_legacy_conversion(uuid, uuid),
  test_fixture.us221b_capture_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us221b_legacy_conversion(uuid, uuid),
  test_fixture.us221b_capture_state(uuid) TO app_worker;
