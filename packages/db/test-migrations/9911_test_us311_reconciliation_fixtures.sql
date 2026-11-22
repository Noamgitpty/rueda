-- 9911 — fixtures des preuves des vues de la bêta et du rapprochement par jambe assisté (US-311,
-- migration 0174). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER, search_path figé ; aucun SQL dynamique ; la transaction appelante reste
-- sous un rôle de production) :
--   1. `us311_operation` (migrator) : opération réussie et prouvée d'un trip (AUTH ou CAPTURE),
--      avec la référence du PSP (état écrit en production par PAY) ; le montant est une ENTRÉE
--      recopiée du vecteur ; `us311_hold_of` : hold d'origine d'un trip ;
--   2. `us311_state` (migrator) : trip en cours, en retard (dossier T30M de 0168) ou terminé, et
--      clés remises (états écrits par TRP, US-305 et US-315) ;
--   3. `us311_records` (migrator) : relecture des passages, éléments, journal d'accès et audit
--      qu'aucun rôle applicatif ne lit ;
--   3 bis. `us311_kpi_oracle` (migrator, lecture seule) : S2 relu indépendamment de la vue, dans
--      l'instantané de l'appelant ;
--   4. `us311_probe` (iam_staff_owner, garde active) : réécriture d'un passage ou d'un élément,
--      ou suppression, sous les seuls droits et politiques d'iam_staff_owner.
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1) ni un paramètre : le seuil
-- J-ADM-031 reste absent (fail-closed : 0).
--
-- Retour arrière : DROP FUNCTION test_fixture.us311_operation(uuid, bigint, text, text),
--   test_fixture.us311_hold_of(uuid), test_fixture.us311_access(uuid),
--   test_fixture.us311_kpi_oracle(text, uuid[]),
--   test_fixture.us311_state(uuid, text), test_fixture.us311_records(uuid),
--   test_fixture.us311_probe(uuid, text).

CREATE FUNCTION test_fixture.us311_operation(p_trip uuid, p_amount bigint, p_ref text,
                                             p_kind text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t    record;
  v_op uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF p_kind NOT IN ('AUTH', 'CAPTURE') THEN
    RAISE EXCEPTION 'us311_operation: nature hors liste' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT tr.source_hold_id, tr.country_code, tr.currency, tr.org_id INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip;
  INSERT INTO core.payment_payment_operation
         (id, hold_id, psp_account_id, country_code, provider, kind, purpose, amount_minor, currency,
          attempt_no, status, idem_plain, idem_sent, proof_type, provider_reference)
  VALUES (v_op, t.source_hold_id, test_fixture.fixture_psp_account(t.country_code),
          t.country_code, 'FAKE', p_kind, 'RENT', p_amount, t.currency, 1, 'SUCCEEDED',
          pg_catalog.format('hold:%s:%s:op:%s', t.source_hold_id, p_kind, v_op),
          pg_catalog.format('test:%s', v_op), 'WEBHOOK_SIGNED', p_ref);
  -- jambes de l'opération (contrainte différée payment_operation_legs_complete : forme de 9001)
  PERFORM test_fixture.fixture_operation_legs(v_op, p_kind, t.org_id, NULL, t.country_code,
                                              p_amount);
  RETURN v_op;
END
$fn$;

-- Hold d'origine d'un trip (référence possible d'une ligne du relevé du PSP)
CREATE FUNCTION test_fixture.us311_hold_of(p_trip uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.source_hold_id FROM core.booking_trip AS t WHERE t.id = p_trip
$fn$;

CREATE FUNCTION test_fixture.us311_state(p_trip uuid, p_state text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t record;
BEGIN
  SELECT tr.id, tr.country_code, tr.scheduled_end, tr.guest_user_id, tr.org_id INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip;
  IF p_state = 'KEYS_OUT' THEN
    UPDATE core.booking_trip SET status = 'IN_PROGRESS' WHERE id = p_trip;
    INSERT INTO core.trip_ops_key_handover (trip_id, direction, method, at, by_user)
    VALUES (p_trip, 'OUT', 'IN_PERSON', platform.now(),
            (SELECT o.holder_user_id FROM core.iam_organization AS o WHERE o.id = t.org_id));
  ELSIF p_state = 'OVERDUE' THEN
    UPDATE core.booking_trip SET status = 'OVERDUE' WHERE id = p_trip;
    INSERT INTO core.trip_ops_overdue_case
           (trip_id, country_code, scheduled_end, detection_minutes, detected_at, use_until,
            occupancy_until)
    VALUES (p_trip, t.country_code, t.scheduled_end, 30, t.scheduled_end + interval '30 minutes',
            t.scheduled_end + interval '90 minutes', t.scheduled_end + interval '120 minutes');
  ELSIF p_state = 'COMPLETED' THEN
    UPDATE core.booking_trip SET status = 'COMPLETED' WHERE id = p_trip;
  ELSE
    RAISE EXCEPTION 'us311_state: état inconnu';
  END IF;
END
$fn$;

CREATE FUNCTION test_fixture.us311_records(p_run uuid)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'run', (SELECT pg_catalog.to_jsonb(r) FROM core.finance_reconciliation_run AS r
             WHERE r.id = p_run),
    'items', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i) ORDER BY i.side, i.ref, i.leg)
                         FROM core.finance_reconciliation_item AS i WHERE i.run_id = p_run),
                      '[]'::jsonb),
    'audit', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'action', a.action_code, 'role', a.actor_role, 'after', a.after)
                                ORDER BY a.id)
                         FROM core.audit_audit_log AS a
                        WHERE a.subject_id = p_run
                           OR a.request_id = (SELECT r.request_id FROM core.finance_reconciliation_run AS r
                                               WHERE r.id = p_run)), '[]'::jsonb))
$fn$;

-- Journal d'accès et audit d'une requête (export) : relecture seule
CREATE FUNCTION test_fixture.us311_access(p_request uuid)
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'access', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'kind', d.access_kind, 'role', d.actor_role,
                                 'subjectType', d.subject_type, 'field', d.field_or_file,
                                 'purpose', d.purpose) ORDER BY d.id)
                          FROM core.audit_data_access_log AS d WHERE d.request_id = p_request),
                       '[]'::jsonb),
    'audit', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                'action', a.action_code, 'role', a.actor_role, 'after', a.after)
                                ORDER BY a.id)
                         FROM core.audit_audit_log AS a WHERE a.request_id = p_request),
                      '[]'::jsonb))
$fn$;

-- Lecture indépendante de S2 (18 §1.1, ADR-194 point 5), dans l'instantané de l'appelant : trips
-- terminés (RETURNED, POST_TRIP, COMPLETED) du pays et clés remises (OUT) sans autorisation ni
-- capture réussie et prouvée ; rend aussi lesquels des trips donnés y figurent. Lecture seule.
CREATE FUNCTION test_fixture.us311_kpi_oracle(p_country text, p_trips uuid[])
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH done AS (
    SELECT t.id FROM core.booking_trip AS t
     WHERE t.country_code = p_country AND t.status IN ('RETURNED', 'POST_TRIP', 'COMPLETED')
  ), unpaid AS (
    SELECT t.id
      FROM core.trip_ops_key_handover AS k
      JOIN core.booking_trip AS t ON t.id = k.trip_id
     WHERE k.direction = 'OUT' AND t.country_code = p_country
       AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS op
                        WHERE op.hold_id = t.source_hold_id AND op.kind IN ('AUTH', 'CAPTURE')
                          AND op.status = 'SUCCEEDED' AND op.proof_type IS NOT NULL)
  )
  SELECT pg_catalog.jsonb_build_object(
    'completed', (SELECT pg_catalog.count(*) FROM done),
    'keysWithoutPayment', (SELECT pg_catalog.count(*) FROM unpaid),
    'completedTrips', COALESCE((SELECT pg_catalog.jsonb_agg(d.id ORDER BY d.id) FROM done AS d
                                 WHERE d.id = ANY (p_trips)), '[]'::jsonb),
    'unpaidTrips', COALESCE((SELECT pg_catalog.jsonb_agg(u.id ORDER BY u.id) FROM unpaid AS u
                              WHERE u.id = ANY (p_trips)), '[]'::jsonb))
$fn$;

CREATE FUNCTION test_fixture.us311_probe(p_run uuid, p_op text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  IF p_op = 'RUN_DELTA' THEN
    UPDATE core.finance_reconciliation_run SET status = 'CLOSED', delta_minor = 0 WHERE id = p_run;
  ELSIF p_op = 'RUN_DELETE' THEN
    DELETE FROM core.finance_reconciliation_run WHERE id = p_run;
  ELSIF p_op = 'ITEM_MATCH' THEN
    UPDATE core.finance_reconciliation_item SET resolution = 'OTHER',
           resolution_note = 'tentative de masquer un écart', resolved_by = NULL,
           resolved_at = platform.now()
     WHERE run_id = p_run AND status = 'MATCHED';
  ELSIF p_op = 'ITEM_DELETE' THEN
    DELETE FROM core.finance_reconciliation_item WHERE run_id = p_run;
  ELSE
    RAISE EXCEPTION 'us311_probe: opération inconnue';
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us311_operation(uuid, bigint, text, text),
  test_fixture.us311_kpi_oracle(text, uuid[]),
  test_fixture.us311_hold_of(uuid),
  test_fixture.us311_state(uuid, text), test_fixture.us311_records(uuid),
  test_fixture.us311_access(uuid), test_fixture.us311_probe(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us311_operation(uuid, bigint, text, text),
  test_fixture.us311_kpi_oracle(text, uuid[]),
  test_fixture.us311_hold_of(uuid),
  test_fixture.us311_state(uuid, text), test_fixture.us311_records(uuid),
  test_fixture.us311_access(uuid), test_fixture.us311_probe(uuid, text) TO app_api;

-- Transfert de la sonde au propriétaire des portes (précédent : 9917) ; CREATE le temps du
-- transfert. EXECUTE accordé avant : migrator n'est plus propriétaire ensuite.
GRANT CREATE ON SCHEMA test_fixture TO iam_staff_owner;
ALTER FUNCTION test_fixture.us311_probe(uuid, text) OWNER TO iam_staff_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM iam_staff_owner;
