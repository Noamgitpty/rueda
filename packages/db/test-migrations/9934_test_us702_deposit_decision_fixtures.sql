-- 9934 — fixtures des preuves de la décision de la caution (US-702, migration 0150 ; ADR-172).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- `us702_converted_deposit` : caution AUTORISÉE d'un hold de checkout CONVERTI en trip, rail au
-- choix (`PREAUTH_SINGLE`, `REAUTH`, `CHARGE_THEN_REFUND`), même construction que
-- `us701_converted_deposit` (9945 : annonce de 9998, trip et opération de loyer de 9300, segment
-- n° 1), écrite directement sous le propriétaire : la pose réelle à `auth_at` n'existe pas avant le
-- lot C (S-1 d'ADR-164). Appelée par app_worker dans des transactions de test ANNULÉES ; elle sert à
-- éprouver la file de la décision et la transition finale de 0150 sous le rôle de production. Les
-- attendus du test viennent de 08 BR-PAY-06 (T57, T58, T73), jamais de cette fixture. Aucun
-- interrupteur de mise en service n'est écrit.
--
-- `us702_deposit_schedule` : lecture, pour la preuve, du fournisseur et de l'échéancier écrits par
-- `payment_cmd_record_deposit_decision` (aucun droit applicatif sur la table) ; jamais [C2].
--
-- Retour arrière : DROP FUNCTION test_fixture.us702_converted_deposit(text, text, text, timestamptz,
--   timestamptz, bigint, text, timestamptz, timestamptz, timestamptz, text),
--   test_fixture.us702_deposit_schedule(uuid);

CREATE FUNCTION test_fixture.us702_converted_deposit(p_country text, p_currency text,
                                                     p_timezone text, p_start timestamptz,
                                                     p_end timestamptz, p_amount_minor bigint,
                                                     p_mechanism text,
                                                     p_auth_expiry timestamptz,
                                                     p_release timestamptz,
                                                     p_decision timestamptz,
                                                     p_provider_reference text)
  RETURNS TABLE (deposit_id uuid, hold_id uuid, trip_id uuid, segment_id uuid, tender_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_l       record;
  v_guest   uuid := pg_catalog.gen_random_uuid();
  v_trip    uuid := pg_catalog.gen_random_uuid();
  v_op      uuid := pg_catalog.gen_random_uuid();
  v_hold    uuid := pg_catalog.gen_random_uuid();
  v_occ     uuid := pg_catalog.gen_random_uuid();
  v_seg     uuid;
  v_deposit uuid;
BEGIN
  SELECT * INTO v_l FROM test_fixture.us208_listed_listing(p_country, 4000, 'AUTOMATIC', true);
  PERFORM test_fixture.rls_insert_trip(v_trip, v_guest, v_l.org_id, v_l.vehicle_id, p_country,
                                       p_currency, p_timezone, p_start, p_end);
  PERFORM test_fixture.rls_insert_trip_operation(v_op, v_trip, p_amount_minor);
  SELECT s.id INTO v_seg FROM core.booking_trip_segment AS s WHERE s.trip_id = v_trip AND s.seq = 1;
  IF v_seg IS NULL THEN
    v_seg := pg_catalog.gen_random_uuid();
    INSERT INTO core.booking_trip_segment (id, trip_id, seq, period)
    VALUES (v_seg, v_trip, 1, pg_catalog.tstzrange(p_start, p_end, '[)'));
  END IF;
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          deactivated_reason, ref_type, ref_id)
  VALUES (v_occ, v_l.vehicle_id, v_l.org_id, p_country, 'HOLD', 'CHECKOUT',
          pg_catalog.tstzrange(p_start, p_end, '[)'), false, p_start, 'HOLD_RELEASED', 'HOLD',
          v_hold);
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
          expires_at, converted_trip_id, conversion_operation_id)
  VALUES (v_hold, v_guest, v_l.vehicle_id, v_l.org_id, p_country, v_occ, 'CHECKOUT', 'CONVERTED',
          p_start, v_trip, v_op);
  INSERT INTO core.payment_deposit_hold
         (hold_id, country_code, currency, provider, mechanism, triggers, params_snapshot,
          amount_minor, h_required_hours, v_hours_snapshot, auth_at, auth_expiry_at,
          auth_provider_reference, release_at, decision_at, reauth_due_at, status)
  VALUES (v_hold, p_country, p_currency, 'FAKE', p_mechanism, ARRAY['CLASS'],
          '{"version": 1, "riskEvaluated": false}'::jsonb, p_amount_minor, 168, 168,
          p_start - interval '24 hours', p_auth_expiry, p_provider_reference, p_release,
          p_decision, NULL, 'AUTHORIZED')
  RETURNING id INTO v_deposit;
  RETURN QUERY SELECT v_deposit, v_hold, v_trip, v_seg, v_op;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us702_converted_deposit(text, text, text, timestamptz,
  timestamptz, bigint, text, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us702_converted_deposit(text, text, text, timestamptz,
  timestamptz, bigint, text, timestamptz, timestamptz, timestamptz, text) TO app_worker;

CREATE FUNCTION test_fixture.us702_deposit_schedule(p_hold_id uuid)
  RETURNS TABLE (provider text, v_hours_snapshot integer, auth_at timestamptz,
                 release_at timestamptz, decision_at timestamptz, reauth_due_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.provider, d.v_hours_snapshot, d.auth_at, d.release_at, d.decision_at, d.reauth_due_at
    FROM core.payment_deposit_hold AS d WHERE d.hold_id = p_hold_id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us702_deposit_schedule(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us702_deposit_schedule(uuid) TO app_api;
