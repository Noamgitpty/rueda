-- 9984 — fixtures des preuves de la décision KYC de l'ops (US-106, migration 0076). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE à app_api et app_worker) :
-- relectures des lignes que les rôles applicatifs ne lisent pas (éléments de la file KYC d'une
-- personne, vérification courante avec son auteur, événements d'un élément de file). Les attendus
-- des tests viennent de 19 US-106, 16 ADM-002 / VER-002 / VER-006 et 17 §3.2.2, §4.5, §7.2,
-- jamais de ces relectures. Aucune écriture.
--
-- Retour arrière : DROP FUNCTION test_fixture.us106_items(uuid),
--   test_fixture.us106_verification(uuid), test_fixture.us106_item_events(uuid).

CREATE FUNCTION test_fixture.us106_items(p_user uuid)
  RETURNS TABLE (id uuid, status text, decision text, assignee_id uuid, country_code text,
                 sla_minutes double precision, breached boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.status, i.decision, i.assignee_id, i.country_code,
         (EXTRACT(EPOCH FROM (i.sla_due_at - i.created_at)) / 60)::double precision,
         i.sla_breached_at IS NOT NULL
    FROM core.support_review_queue_item AS i
   WHERE i.queue = 'KYC' AND i.subject_type = 'USER_ACCOUNT' AND i.subject_id = p_user
   ORDER BY i.created_at, i.id
$fn$;

CREATE FUNCTION test_fixture.us106_verification(p_user uuid)
  RETURNS TABLE (id uuid, status text, decision_reason_code text, reviewed_by uuid,
                 approved boolean, expires_at timestamptz, attempt integer)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.id, v.status, v.decision_reason_code, v.reviewed_by, v.approved_at IS NOT NULL,
         v.expires_at, v.attempt
    FROM core.kyc_identity_verification AS v
   WHERE v.user_id = p_user AND v.is_current
$fn$;

CREATE FUNCTION test_fixture.us106_item_events(p_item uuid)
  RETURNS TABLE (type text, country_code text, actor_role text, actor_user_id uuid, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.country_code, e.actor_role, e.actor_user_id, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_type = 'review_queue_item' AND e.aggregate_id = p_item
   ORDER BY e.created_at, e.id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us106_items(uuid), test_fixture.us106_verification(uuid),
  test_fixture.us106_item_events(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us106_items(uuid), test_fixture.us106_verification(uuid),
  test_fixture.us106_item_events(uuid) TO app_api, app_worker;
