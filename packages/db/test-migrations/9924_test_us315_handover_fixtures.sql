-- 9924 — fixtures des preuves de la remise et du retour entre particuliers (US-315, migration 0163).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. `us315_payment` : opération de loyer du hold du trip (AUTH, RENT, SUCCEEDED) avec la preuve
--      voulue (`WEBHOOK_SIGNED`, `POLL`, ou NULL : aucune opération), telle que la conversion
--      l'aurait trouvée ; montant posé par le test ;
--   2. `us315_deposit` : décision de caution du hold du trip (`NOT_REQUIRED`, `PLANNED`,
--      `AUTHORIZED`), forme de 0146 ; montant posé par le test ;
--   3. `us315_restrict` : restriction active d'un compte (forme de 9967) ; `us315_birth` : date de
--      naissance d'un compte (valeur posée par le test) ;
--   4. `us315_records` : relecture des lignes qu'aucun rôle applicatif ne lit (contrôle du permis,
--      validations, clés remises, occupations, état, heures) ;
--   5. `us315_try_update` / `us315_try_delete` : écriture interdite d'une validation (ajout seul).
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1). Appelées dans une
-- transaction ANNULÉE, sauf la preuve de concurrence (données validées, identifiants uniques).
--
-- Retour arrière : DROP FUNCTION test_fixture.us315_payment(uuid, text, bigint),
--   test_fixture.us315_deposit(uuid, text, bigint), test_fixture.us315_restrict(uuid),
--   test_fixture.us315_birth(uuid, date), test_fixture.us315_records(uuid), test_fixture.us315_try_update(uuid),
--   test_fixture.us315_try_delete(uuid).

CREATE FUNCTION test_fixture.us315_payment(p_trip uuid, p_proof text, p_amount bigint)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t    record;
  v_op uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF p_proof IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT tr.source_hold_id, tr.country_code, tr.currency INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip;
  INSERT INTO core.payment_payment_operation
         (id, hold_id, psp_account_id, country_code, provider, kind, purpose, amount_minor, currency,
          attempt_no, status, idem_plain, idem_sent, proof_type)
  VALUES (v_op, t.source_hold_id, test_fixture.fixture_psp_account(t.country_code),
          t.country_code, 'FAKE', 'AUTH', 'RENT', p_amount, t.currency, 1, 'SUCCEEDED',
          pg_catalog.format('hold:%s:AUTH:op:%s', t.source_hold_id, v_op),
          pg_catalog.format('test:%s', v_op), p_proof);
  RETURN v_op;
END
$fn$;

CREATE FUNCTION test_fixture.us315_deposit(p_trip uuid, p_state text, p_amount bigint)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t record;
BEGIN
  SELECT tr.source_hold_id, tr.country_code, tr.currency, tr.scheduled_start, tr.scheduled_end
    INTO t FROM core.booking_trip AS tr WHERE tr.id = p_trip;
  IF p_state = 'NOT_REQUIRED' THEN
    INSERT INTO core.payment_deposit_hold
           (hold_id, country_code, currency, provider, mechanism, triggers, params_snapshot,
            amount_minor)
    VALUES (t.source_hold_id, t.country_code, t.currency, 'FAKE', 'NOT_REQUIRED', '{}'::text[],
            '{"version": 1, "riskEvaluated": false}'::jsonb, 0);
  ELSIF p_state IN ('PLANNED', 'AUTHORIZED') THEN
    INSERT INTO core.payment_deposit_hold
           (hold_id, country_code, currency, provider, mechanism, triggers, params_snapshot,
            amount_minor, h_required_hours, v_hours_snapshot, auth_at, auth_expiry_at,
            auth_provider_reference, release_at, decision_at, status)
    VALUES (t.source_hold_id, t.country_code, t.currency, 'FAKE', 'PREAUTH_SINGLE',
            ARRAY['CLASS'], '{"version": 1, "riskEvaluated": false}'::jsonb, p_amount, 168, 168,
            t.scheduled_start - interval '24 hours', t.scheduled_end + interval '96 hours',
            CASE WHEN p_state = 'AUTHORIZED' THEN 'fake-auth-us315' END,
            t.scheduled_end + interval '72 hours', t.scheduled_end + interval '70 hours', p_state);
  END IF;
END
$fn$;

CREATE FUNCTION test_fixture.us315_restrict(p_user uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_restriction (id, user_id, kind, active, reason)
  VALUES (pg_catalog.gen_random_uuid(), p_user, 'POLICY_VIOLATION', true, 'fixture US-315')
$fn$;

CREATE FUNCTION test_fixture.us315_birth(p_user uuid, p_dob date)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_user_account SET date_of_birth = p_dob WHERE id = p_user
$fn$;

CREATE FUNCTION test_fixture.us315_records(p_trip uuid)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'status', t.status,
    'checkinValidatedAt', t.checkin_validated_at,
    'returnedAt', (SELECT pg_catalog.min(l.at) FROM core.booking_trip_state_log AS l
                    WHERE l.trip_id = t.id AND l.to_status = 'RETURNED'),
    'transitions', (SELECT pg_catalog.count(*) FROM core.booking_trip_state_log AS l
                     WHERE l.trip_id = t.id AND l.to_status IN ('IN_PROGRESS', 'RETURNED')),
    'identity', (SELECT pg_catalog.jsonb_build_object('status', c.status, 'checklist', c.checklist,
                                                      'subreason', c.failure_subreason,
                                                      'checkedBy', c.checked_by)
                   FROM core.trip_ops_identity_check AS c WHERE c.trip_id = t.id),
    'validations', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                               'kind', v.kind, 'role', v.performer_role, 'by', v.performed_by,
                               'odometerKm', v.odometer_km, 'fuelEighths', v.fuel_eighths,
                               'method', v.method, 'at', v.validated_at)
                               ORDER BY v.kind, v.validated_at, v.performer_role)
                               FROM core.trip_ops_handover_validation AS v
                              WHERE v.trip_id = t.id), '[]'::jsonb),
    'keys', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'direction', k.direction, 'method', k.method, 'at', k.at, 'by', k.by_user)
                        ORDER BY k.at, k.direction)
                        FROM core.trip_ops_key_handover AS k WHERE k.trip_id = t.id), '[]'::jsonb),
    'vehicleOccupancyActive', (SELECT pg_catalog.count(*) FROM core.booking_vehicle_occupancy AS o
                                WHERE o.kind = 'TRIP' AND o.ref_type = 'TRIP' AND o.ref_id = t.id
                                  AND o.active),
    'guestOccupancyActive', (SELECT pg_catalog.count(*) FROM core.booking_guest_occupancy AS g
                              WHERE g.trip_id = t.id AND g.active))
    FROM core.booking_trip AS t WHERE t.id = p_trip
$fn$;

CREATE FUNCTION test_fixture.us315_try_update(p_trip uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.trip_ops_handover_validation SET odometer_km = odometer_km + 1 WHERE trip_id = p_trip
$fn$;

CREATE FUNCTION test_fixture.us315_try_delete(p_trip uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  DELETE FROM core.trip_ops_key_handover WHERE trip_id = p_trip
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us315_payment(uuid, text, bigint),
  test_fixture.us315_deposit(uuid, text, bigint), test_fixture.us315_restrict(uuid),
  test_fixture.us315_birth(uuid, date), test_fixture.us315_records(uuid),
  test_fixture.us315_try_update(uuid), test_fixture.us315_try_delete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us315_payment(uuid, text, bigint),
  test_fixture.us315_deposit(uuid, text, bigint), test_fixture.us315_restrict(uuid),
  test_fixture.us315_birth(uuid, date), test_fixture.us315_records(uuid),
  test_fixture.us315_try_update(uuid), test_fixture.us315_try_delete(uuid) TO app_api;
