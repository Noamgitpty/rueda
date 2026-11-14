-- 9958 — fixtures des preuves du registre des incidents de sécurité (US-112, migration 0094). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE à app_api ; relecture aussi à app_worker) :
--   1. test_fixture.us112_incident : relecture d'une ligne du registre (aucun rôle applicatif ne
--      le lit) ;
--   2. test_fixture.us112_events : événements `security.incident.opened` d'un incident (les rôles
--      applicatifs ne lisent pas l'outbox) ;
--   3. test_fixture.us112_tamper : écriture DIRECTE sous `migrator` (politique migrator_all) pour
--      éprouver la garde du registre : suppression, TRUNCATE, réécriture d'une échéance ou d'un
--      fait daté, écriture d'une ligne close. À n'appeler que dans une transaction annulée.
-- Les attendus des tests viennent de 19 US-112, de 17 §3.2.13 et §6.4 et d'OQ-MK-09 (données de
-- configuration), jamais de ces fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us112_incident(uuid), test_fixture.us112_events(uuid),
--   test_fixture.us112_tamper(text, uuid).

CREATE FUNCTION test_fixture.us112_incident(p_id uuid)
  RETURNS TABLE (country_code text, kind text, severity text, personal_data_involved boolean,
                 subjects_count_estimate integer, detected_at timestamptz, reported_at timestamptz,
                 reported_by uuid, authority_notification_due_at timestamptz,
                 subjects_notification_due_at timestamptz, contained_at timestamptz,
                 authority_notified_at timestamptz, subjects_notified_at timestamptz,
                 closed_at timestamptz, status text, postmortem_file_id uuid,
                 opened_alerted_at timestamptz, authority_overdue_alerted_at timestamptz,
                 subjects_overdue_alerted_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.country_code::text, i.kind, i.severity, i.personal_data_involved,
         i.subjects_count_estimate, i.detected_at, i.reported_at, i.reported_by,
         i.authority_notification_due_at, i.subjects_notification_due_at, i.contained_at,
         i.authority_notified_at, i.subjects_notified_at, i.closed_at, i.status,
         i.postmortem_file_id, i.opened_alerted_at, i.authority_overdue_alerted_at,
         i.subjects_overdue_alerted_at
    FROM core.audit_security_incident AS i WHERE i.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us112_events(p_id uuid)
  RETURNS TABLE (type text, aggregate_type text, country_code text, actor_user_id uuid,
                 actor_role text, correlation_id uuid, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_type, e.country_code, e.actor_user_id, e.actor_role,
         e.correlation_id, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.type = 'security.incident.opened' AND e.aggregate_id = p_id
   ORDER BY e.id
$fn$;

CREATE FUNCTION test_fixture.us112_tamper(p_what text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_what
    WHEN 'delete' THEN
      DELETE FROM core.audit_security_incident WHERE id = p_id;
    WHEN 'truncate' THEN
      TRUNCATE core.audit_security_incident;
    WHEN 'move_due' THEN
      UPDATE core.audit_security_incident
         SET authority_notification_due_at = authority_notification_due_at + interval '30 days'
       WHERE id = p_id;
    WHEN 'move_detected' THEN
      UPDATE core.audit_security_incident SET detected_at = detected_at + interval '1 hour'
       WHERE id = p_id;
    WHEN 'erase_notice' THEN
      UPDATE core.audit_security_incident SET authority_notified_at = NULL WHERE id = p_id;
    WHEN 'touch' THEN
      UPDATE core.audit_security_incident SET severity = severity WHERE id = p_id;
    ELSE
      RAISE EXCEPTION 'us112_tamper : cas inconnu %', p_what;
  END CASE;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us112_incident(uuid), test_fixture.us112_events(uuid),
  test_fixture.us112_tamper(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us112_incident(uuid), test_fixture.us112_events(uuid),
  test_fixture.us112_tamper(text, uuid) TO app_api;
-- marques du travailleur relues dans sa propre transaction (annulée)
GRANT EXECUTE ON FUNCTION test_fixture.us112_incident(uuid) TO app_worker;
