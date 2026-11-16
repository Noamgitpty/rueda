-- 9968 — fixtures des preuves de la décision de l'ops sur une réservation signalée (US-209, partie
-- 209b, migration 0117). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique), appelée
-- SEULEMENT dans des transactions de test ANNULÉES :
--   1. `us209b_review` : relecture brute de l'évaluation d'un hold, de son élément RISK_BOOKING, de
--      l'occupation et des événements du hold (aucun rôle applicatif ne les lit) : les attendus
--      viennent de 16, 17 et 19, jamais de cette relecture ;
--   2. `us209b_manual_action` : ligne manual_action d'une demande (motif, saisie, issue).
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us209b_* (voir la liste des droits en fin de fichier).

CREATE FUNCTION test_fixture.us209b_review(p_hold_id uuid)
  RETURNS TABLE (assessment_id uuid, decision text, reviewed_by uuid, decided_at timestamptz,
                 item_id uuid, item_status text, item_decision text, item_assignee uuid,
                 occupancy_active boolean, occupancy_expires_at timestamptz,
                 deactivated_reason text, release_reason text, released_at timestamptz,
                 expired_at timestamptz, released_by uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.id, a.decision, a.reviewed_by, a.decided_at, i.id, i.status, i.decision,
         i.assignee_id, o.active, o.expires_at, o.deactivated_reason, h.release_reason,
         h.released_at, h.expired_at, h.released_by
    FROM core.booking_checkout_hold AS h
    JOIN core.booking_vehicle_occupancy AS o ON o.id = h.occupancy_id
    LEFT JOIN core.risk_assessment AS a ON a.subject_type = 'HOLD' AND a.subject_id = h.id
    LEFT JOIN core.support_review_queue_item AS i
      ON i.queue = 'RISK_BOOKING' AND i.subject_type = 'RISK_ASSESSMENT' AND i.subject_id = a.id
   WHERE h.id = p_hold_id
   ORDER BY i.created_at DESC NULLS LAST
   LIMIT 1
$fn$;

CREATE FUNCTION test_fixture.us209b_events(p_hold_id uuid)
  RETURNS TABLE (type text, actor_user_id uuid, actor_role text, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.actor_user_id, e.actor_role, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_type = 'checkout_hold' AND e.aggregate_id = p_hold_id
   ORDER BY e.occurred_at, e.id
$fn$;

CREATE FUNCTION test_fixture.us209b_manual_action(p_id uuid)
  RETURNS TABLE (action_code text, subject_type text, subject_id uuid, country_code text,
                 actor_user_id uuid, reason text, input jsonb, outcome text, domain_ref uuid,
                 audit_linked boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT m.action_code, m.subject_type, m.subject_id, m.country_code, m.actor_user_id, m.reason,
         m.input, m.outcome, m.domain_ref, m.audit_log_id IS NOT NULL
    FROM core.support_manual_action AS m
   WHERE m.id = p_id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us209b_review(uuid), test_fixture.us209b_events(uuid),
  test_fixture.us209b_manual_action(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us209b_review(uuid), test_fixture.us209b_events(uuid),
  test_fixture.us209b_manual_action(uuid)
  TO app_api;
