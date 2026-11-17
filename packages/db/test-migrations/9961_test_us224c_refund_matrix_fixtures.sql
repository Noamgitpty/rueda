-- 9961 — Fixtures de TEST d'US-224c (ADR-150) : instance de remboursement posée directement dans le
-- monde de la matrice d'autorisations (l0-us043-authorization-matrix), pour que chaque cellule de
-- lecture de core.payment_refund_instance soit éprouvée sur des lignes réelles (revue sécurité de la
-- PR #202, constat 1 : fin de l'exception `sans_donnees`). L'instance porte sur le règlement en tête
-- du trip et sur son encaissement ; son ordre REFUND est une ligne brute PENDING (jamais envoyée,
-- aucune jambe), d'un montant d'une unité. Jamais en production (test-migrations/ seulement).
-- SECURITY DEFINER sous migrator (politique migrator_all) ; l'appelant reste sous un rôle de
-- production. Les commandes de production (planification, envoi, ordonnanceur) sont éprouvées par
-- l0-us224b-refund-instances et l0-us224c-refund-scheduler.
--
-- Retour arrière : DROP FUNCTION test_fixture.us224c_insert_refund_instance(uuid, uuid, uuid).

CREATE FUNCTION test_fixture.us224c_insert_refund_instance(p_instance_id uuid, p_operation_id uuid,
                                                          p_trip_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip    record;
  v_stl     record;
  v_capture uuid;
BEGIN
  SELECT t.id, t.country_code, t.currency INTO v_trip FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  SELECT s.id, s.version INTO v_stl
    FROM core.settlement_settlement AS s
   WHERE s.trip_id = p_trip_id
   ORDER BY s.version DESC
   LIMIT 1;
  SELECT o.id INTO v_capture
    FROM core.payment_payment_operation AS o
   WHERE o.trip_id = p_trip_id AND o.kind = 'CAPTURE'
   ORDER BY o.created_at
   LIMIT 1;
  IF v_trip.id IS NULL OR v_stl.id IS NULL OR v_capture IS NULL THEN
    RAISE EXCEPTION 'us224c_insert_refund_instance: trip, règlement ou encaissement absent';
  END IF;
  INSERT INTO core.payment_payment_operation
         (id, trip_id, psp_account_id, country_code, provider, kind, purpose, amount_minor, currency,
          attempt_no, status, idem_plain, idem_sent)
  VALUES (p_operation_id, p_trip_id, NULL, v_trip.country_code, 'FAKE', 'REFUND', 'RENT', 1,
          v_trip.currency, 1, 'PENDING', pg_catalog.format('raw:%s', p_operation_id),
          pg_catalog.format('raw:%s', p_operation_id));
  INSERT INTO core.payment_refund_instance
         (id, origin_type, origin_id, settlement_id, settlement_version, trip_id, country_code,
          currency, refunded_operation_id, instance_seq, rail, requested_legs, amount_trip_minor,
          operation_id)
  VALUES (p_instance_id, 'SETTLEMENT', v_stl.id, v_stl.id, v_stl.version, p_trip_id,
          v_trip.country_code, v_trip.currency, v_capture, 1, 'NATIVE_PARTIAL',
          '{"HOST": "0", "INSURER": "0", "TAX_THIRD_PARTY": "0", "PLATFORM": "1"}'::jsonb, 1,
          p_operation_id);
END
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us224c_insert_refund_instance(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us224c_insert_refund_instance(uuid, uuid, uuid) TO app_worker;
