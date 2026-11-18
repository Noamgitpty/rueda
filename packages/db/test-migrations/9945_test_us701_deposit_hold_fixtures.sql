-- 9945 — fixtures des preuves de la caution figée au checkout (US-701, migration 0144 ; ADR-169).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- `us701_converted_deposit` : caution AUTORISÉE d'un hold de checkout CONVERTI en trip (annonce de
-- la fixture 9998, trip et opération de loyer de la fixture 9300, segment n° 1), écrite directement
-- sous le propriétaire : la pose réelle à `auth_at` n'existe pas avant le lot C (S-1 d'ADR-164).
-- Appelée par app_worker dans des transactions de test ANNULÉES (la contrainte différée de la
-- conversion n'est jamais évaluée) ; elle sert à éprouver la file de la minuterie et les transitions
-- de 0144 sous le rôle de production. Les attendus du test viennent de 08 BR-PAY-06 (T57, T59),
-- jamais de cette fixture. Aucun interrupteur de mise en service n'est écrit.
--
-- Retour arrière : DROP FUNCTION test_fixture.us701_converted_deposit(text, text, text, timestamptz,
--   timestamptz, bigint, timestamptz, timestamptz, timestamptz, timestamptz, text);

CREATE FUNCTION test_fixture.us701_converted_deposit(p_country text, p_currency text,
                                                     p_timezone text, p_start timestamptz,
                                                     p_end timestamptz, p_amount_minor bigint,
                                                     p_auth_expiry timestamptz,
                                                     p_release timestamptz,
                                                     p_decision timestamptz,
                                                     p_reauth_due timestamptz,
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
  -- segment n° 1 : créé avec le trip s'il existe déjà, sinon posé ici
  SELECT s.id INTO v_seg FROM core.booking_trip_segment AS s WHERE s.trip_id = v_trip AND s.seq = 1;
  IF v_seg IS NULL THEN
    v_seg := pg_catalog.gen_random_uuid();
    INSERT INTO core.booking_trip_segment (id, trip_id, seq, period)
    VALUES (v_seg, v_trip, 1, pg_catalog.tstzrange(p_start, p_end, '[)'));
  END IF;
  -- occupation du hold inactive (le trip tient le créneau)
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
  VALUES (v_hold, p_country, p_currency, 'FAKE', 'REAUTH', ARRAY['CLASS'],
          '{"version": 1, "riskEvaluated": false}'::jsonb, p_amount_minor, 169, 168,
          p_start - interval '24 hours', p_auth_expiry, p_provider_reference, p_release,
          p_decision, p_reauth_due, 'AUTHORIZED')
  RETURNING id INTO v_deposit;
  RETURN QUERY SELECT v_deposit, v_hold, v_trip, v_seg, v_op;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us701_converted_deposit(text, text, text, timestamptz,
  timestamptz, bigint, timestamptz, timestamptz, timestamptz, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us701_converted_deposit(text, text, text, timestamptz,
  timestamptz, bigint, timestamptz, timestamptz, timestamptz, timestamptz, text) TO app_worker;
