-- 9920 — fixtures du journal d'accès aux données personnelles du staff (US-004, migration 0051).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Aucun rôle applicatif ne LIT `core.audit_data_access_log` (ajout seul ; la lecture passe par la
-- ligne chaînée `STAFF_DATA_ACCESS` du journal d'audit). Pour prouver ce que la porte écrit, et que
-- même le propriétaire ne peut pas réécrire le registre, ces fixtures SECURITY DEFINER sous
-- migrator (propriétaire) :
--   1. test_fixture.us004_data_access_rows(acteur) : lignes du registre écrites pour un acteur ;
--   2. test_fixture.us004_owner_tamper_data_access(op, id) : UPDATE ou DELETE d'une ligne par le
--      propriétaire, refusés par le trigger de 0018 (le test annule toujours sa transaction) ;
--   3. EXECUTE de test_fixture.insert_payment_operation (9001) accordé aussi à app_worker : la
--      preuve du moniteur (l0-us004-ops-monitor) écrit une opération UNKNOWN et la lit sous
--      ops_monitor dans la MÊME transaction annulée.
--
-- Retour arrière : DROP FUNCTION test_fixture.us004_data_access_rows(uuid),
--   test_fixture.us004_owner_tamper_data_access(text, uuid) ;
--   REVOKE EXECUTE ON FUNCTION test_fixture.insert_payment_operation(…) FROM app_worker.

CREATE FUNCTION test_fixture.us004_data_access_rows(p_actor uuid)
  RETURNS TABLE (id uuid, actor_role text, subject_type text, subject_id uuid, field_or_file text,
                 purpose text, access_kind text, case_ref text, request_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.id, l.actor_role, l.subject_type, l.subject_id, l.field_or_file, l.purpose,
         l.access_kind, l.case_ref, l.request_id
    FROM core.audit_data_access_log AS l
   WHERE l.actor_user_id = p_actor
   ORDER BY l.at, l.id
$fn$;

CREATE FUNCTION test_fixture.us004_owner_tamper_data_access(p_op text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_op
    WHEN 'UPDATE' THEN
      UPDATE core.audit_data_access_log SET purpose = 'altered by owner' WHERE id = p_id;
    WHEN 'DELETE' THEN
      DELETE FROM core.audit_data_access_log WHERE id = p_id;
    ELSE
      RAISE EXCEPTION 'opération inconnue %', p_op;
  END CASE;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us004_data_access_rows(uuid),
  test_fixture.us004_owner_tamper_data_access(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us004_data_access_rows(uuid),
  test_fixture.us004_owner_tamper_data_access(text, uuid) TO app_api;

GRANT EXECUTE ON FUNCTION
  test_fixture.insert_payment_operation(uuid, uuid, text, text, bigint, text, text, text)
TO app_worker;
