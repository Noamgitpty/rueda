-- 9850 — fixtures des preuves du port de place de marché (US-061). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : poser le GEL d'une jambe (`frozen`, chargeback ouvert, 08 E7 règle 7), que seul un futur
-- écrivain métier posera (story des chargebacks), pour prouver que `settlement_cmd_apply_leg_movement`
-- refuse tout débit d'une jambe gelée. SECURITY DEFINER sous migrator, search_path figé, aucun SQL
-- dynamique ; la transaction appelante reste sous un rôle de production.
--
-- Retour arrière : DROP FUNCTION test_fixture.marketplace_freeze_leg(uuid, text).

CREATE FUNCTION test_fixture.marketplace_freeze_leg(p_trip_id uuid, p_leg text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_trip_leg_balance AS b
     SET frozen = true, frozen_reason = 'CHARGEBACK'
   WHERE b.trip_id = p_trip_id AND b.segment_no = 1 AND b.leg = p_leg
$fn$;

REVOKE ALL ON FUNCTION test_fixture.marketplace_freeze_leg(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.marketplace_freeze_leg(uuid, text) TO app_worker;
