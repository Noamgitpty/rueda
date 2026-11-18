-- 9936 — fixtures des preuves du report de la capture convertie (US-221 partie 221b, migration
-- 0146, ADR-170). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. `us221b_proven_capture` : encaissement PROUVÉ (CAPTURE de loyer SUCCEEDED, preuve
--      WEBHOOK_SIGNED, quatre jambes données par l'appelant, montant = Σ jambes) rattaché à un trip
--      de fixture et JAMAIS porté sur les soldes : la forme qu'avait un trip réservé avant 0146
--      (défaut D2 de la passation US-221) ; appelée SEULEMENT dans une transaction annulée ;
--   2. `us221b_capture_state` : rattachement et report d'une opération (trip de l'opération et de
--      ses jambes, mouvements), lecture des preuves sous app_worker.
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us221b_proven_capture(uuid, uuid, jsonb),
--   test_fixture.us221b_capture_state(uuid).

CREATE FUNCTION test_fixture.us221b_proven_capture(p_operation_id uuid, p_trip_id uuid,
                                                   p_legs jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t record;
BEGIN
  SELECT x.org_id, x.country_code, x.currency INTO t FROM core.booking_trip AS x
   WHERE x.id = p_trip_id;
  INSERT INTO core.payment_payment_operation
         (id, trip_id, psp_account_id, country_code, provider, kind, purpose, amount_minor, currency,
          attempt_no, status, idem_plain, idem_sent, proof_type)
  SELECT p_operation_id, p_trip_id, test_fixture.fixture_psp_account(t.country_code),
         t.country_code, 'FAKE', 'CAPTURE', 'RENT',
         (SELECT pg_catalog.sum((l.value #>> '{}')::bigint)
            FROM pg_catalog.jsonb_each(p_legs) AS l),
         t.currency, 1, 'SUCCEEDED', pg_catalog.format('us221b:%s', p_operation_id),
         pg_catalog.format('us221b:%s', p_operation_id), 'WEBHOOK_SIGNED';
  INSERT INTO core.payment_payment_operation_leg
         (operation_id, leg, org_id, trip_id, country_code, amount_minor)
  SELECT p_operation_id, l.key, t.org_id, p_trip_id, t.country_code, (l.value #>> '{}')::bigint
    FROM pg_catalog.jsonb_each(p_legs) AS l;
END
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

REVOKE ALL ON FUNCTION test_fixture.us221b_proven_capture(uuid, uuid, jsonb),
  test_fixture.us221b_capture_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us221b_proven_capture(uuid, uuid, jsonb),
  test_fixture.us221b_capture_state(uuid) TO app_worker;
