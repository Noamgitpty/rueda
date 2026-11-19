-- 9931 — fixtures des preuves du gel de jambe au chargeback (US-222d, migration 0155, ADR-176).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : atteindre `core.settlement_trip_leg_balance` SOUS migrator (aucun rôle applicatif n'a le
-- droit d'en écrire `frozen`) pour prouver que la garde `core.settlement_trip_leg_balance_guard`
-- refuse à TOUS les rôles un dégel ou une requalification de gel (`trip_leg_balance_freeze_forbidden`)
-- et admet le gel d'une autre jambe (part INSURER, 08 E7 règle 7) ; relire le gel d'une jambe.
-- SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique ; la transaction appelante
-- reste sous un rôle de production (app_worker) et est ANNULÉE.
--
-- Retour arrière : DROP FUNCTION test_fixture.us222d_set_leg_freeze(uuid, text, boolean, text),
--   test_fixture.us222d_leg_freeze(uuid, text).

CREATE FUNCTION test_fixture.us222d_set_leg_freeze(p_trip_id uuid, p_leg text, p_frozen boolean,
                                                   p_reason text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  UPDATE core.settlement_trip_leg_balance AS b
     SET frozen = p_frozen, frozen_reason = p_reason
   WHERE b.trip_id = p_trip_id AND b.segment_no = 1 AND b.leg = p_leg;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

CREATE FUNCTION test_fixture.us222d_leg_freeze(p_trip_id uuid, p_leg text)
  RETURNS TABLE (frozen boolean, frozen_reason text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT b.frozen, b.frozen_reason
    FROM core.settlement_trip_leg_balance AS b
   WHERE b.trip_id = p_trip_id AND b.segment_no = 1 AND b.leg = p_leg
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us222d_set_leg_freeze(uuid, text, boolean, text),
  test_fixture.us222d_leg_freeze(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us222d_set_leg_freeze(uuid, text, boolean, text),
  test_fixture.us222d_leg_freeze(uuid, text) TO app_worker;
