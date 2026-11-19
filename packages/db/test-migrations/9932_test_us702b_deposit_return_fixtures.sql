-- 9932 — fixtures des preuves des corrections « avant ouverture » de la décision de la caution
-- (US-702b, migration 0153 ; ADR-172). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- `us702b_record_return` : retour réel du véhicule à l'heure donnée, sous la forme où la base le
-- garde (transition `RETURNED` du journal d'état du trip, `booking_trip_state_log`, heure de la
-- base), écrit directement sous le propriétaire : le check-out du retour (S-4, TRP) n'a pas encore
-- de commande. Appelée par app_worker dans des transactions de test ANNULÉES, sur un trip de
-- `us702_converted_deposit` (9934) ; elle sert à éprouver la libération effective de 0153 sous le
-- rôle de production. Les attendus du test viennent de 08 BR-PAY-06 (`(checkout_at ??
-- scheduled_end) + 72 h`, `min(release_at, auth_expiry − deposit_safety_h)`), jamais de cette
-- fixture. Aucun interrupteur de mise en service n'est écrit.
--
-- `us702b_conversion_disposition` : disposition `CONVERSION` du hold converti de
-- `us701_converted_deposit` (9945 ; opération de loyer et trip du hold), que la contrainte différée
-- `hold_conversion_matches_disposition` exige au COMMIT : elle ne sert qu'aux preuves à deux
-- connexions de `l0-us702b-deposit-race.test.ts` (groupe isolé), dont la mise en place est validée.
--
-- Retour arrière : DROP FUNCTION test_fixture.us702b_record_return(uuid, timestamptz),
--   test_fixture.us702b_conversion_disposition(uuid);

CREATE FUNCTION test_fixture.us702b_record_return(p_trip_id uuid, p_at timestamptz)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.booking_trip_state_log
         (id, trip_id, from_status, to_status, kind, reason_code, actor_role, at)
  VALUES (pg_catalog.gen_random_uuid(), p_trip_id, 'IN_PROGRESS', 'RETURNED', 'TRANSITION',
          'TEST_RETURN', 'SYSTEM', p_at)
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us702b_record_return(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us702b_record_return(uuid, timestamptz) TO app_worker;

CREATE FUNCTION test_fixture.us702b_conversion_disposition(p_hold_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, trip_id)
  SELECT h.conversion_operation_id, h.id, 'CONVERSION', h.converted_trip_id
    FROM core.booking_checkout_hold AS h
   WHERE h.id = p_hold_id AND h.status = 'CONVERTED'
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us702b_conversion_disposition(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us702b_conversion_disposition(uuid) TO app_worker;
