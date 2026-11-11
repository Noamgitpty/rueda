-- 9990 — fixtures des preuves des files de revue et de la fiche 360° (US-109, migration 0064). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) :
--   - SONDE PRODUCTRICE : mise en file et clôture par les VRAIES fonctions
--     core.support_enqueue_review et core.support_close_review_item, appelées depuis une commande
--     SECURITY DEFINER dont le propriétaire NOLOGIN (cmd_golive_owner, comme les sondes de 9960)
--     n'a reçu QUE le droit EXECUTE : c'est exactement ce qu'une story productrice accordera ;
--   - recul d'un élément dans le temps (création et échéance reculées du même intervalle : le
--     délai posé par la base est conservé), pour éprouver le retard sans horloge truquée ;
--   - relectures des lignes que les rôles applicatifs ne lisent pas (éléments, journal d'accès,
--     notes, restrictions, fichiers) : les attendus du test viennent de 19 US-109, 16 ADM-005 /
--     ADM-029 / ADM-032 et 17 §2.3, jamais de ces relectures ;
--   - clé de sujet de TEST (octets aléatoires, aucune clé maîtresse : identifiant « fake-kms ») ;
--   - activation d'un compte d'hôte et restriction posée directement (titulaire sans pays déclaré,
--     que la console ne peut pas viser) pour éprouver la garde de la pose d'un hold.
--
-- Retour arrière : DROP FUNCTION test_fixture.us109_* (voir la liste des droits en fin de fichier) ;
--   REVOKE USAGE ON SCHEMA core FROM cmd_golive_owner.

CREATE FUNCTION test_fixture.us109_enqueue(p_queue text, p_subject_type text, p_subject_id uuid,
                                           p_country text)
  RETURNS TABLE (outcome text, item_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.outcome, r.item_id
    FROM core.support_enqueue_review(p_queue, p_subject_type, p_subject_id, p_country, NULL) AS r
$fn$;

CREATE FUNCTION test_fixture.us109_close(p_item uuid, p_status text, p_decision text)
  RETURNS TABLE (outcome text, item_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.outcome, r.item_id
    FROM core.support_close_review_item(p_item, p_status, p_decision, NULL) AS r
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us109_enqueue(text, text, uuid, text),
  test_fixture.us109_close(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us109_enqueue(text, text, uuid, text),
  test_fixture.us109_close(uuid, text, text) TO app_api;
-- sonde productrice : propriétaire NOLOGIN qui ne reçoit que l'EXECUTE des deux fonctions, plus
-- l'USAGE du schéma core sans lequel une fonction de ce schéma n'est pas résoluble (tout
-- propriétaire producteur l'a déjà : cmd_money_owner, cmd_hold_owner…). Base de test seulement :
-- aucun droit sur une table ni sur une autre fonction ; app_api n'a toujours pas EXECUTE sur
-- core.support_enqueue_review ni core.support_close_review_item.
GRANT USAGE ON SCHEMA core TO cmd_golive_owner;
GRANT CREATE ON SCHEMA test_fixture TO cmd_golive_owner;
ALTER FUNCTION test_fixture.us109_enqueue(text, text, uuid, text) OWNER TO cmd_golive_owner;
ALTER FUNCTION test_fixture.us109_close(uuid, text, text) OWNER TO cmd_golive_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_golive_owner;
SET LOCAL ROLE iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.support_enqueue_review(text, text, uuid, text, uuid),
  core.support_close_review_item(uuid, text, text, uuid) TO cmd_golive_owner;
RESET ROLE;

CREATE FUNCTION test_fixture.us109_backdate_item(p_item uuid, p_minutes integer)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.support_review_queue_item
     SET created_at = created_at - pg_catalog.make_interval(mins => p_minutes),
         sla_due_at = sla_due_at - pg_catalog.make_interval(mins => p_minutes)
   WHERE id = p_item
$fn$;

CREATE FUNCTION test_fixture.us109_item(p_item uuid)
  RETURNS TABLE (queue text, subject_type text, subject_id uuid, country_code text, status text,
                 assignee_id uuid, sla_minutes double precision, overdue boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id,
         (EXTRACT(EPOCH FROM (i.sla_due_at - i.created_at)) / 60)::double precision,
         i.sla_due_at <= platform.now()
    FROM core.support_review_queue_item AS i WHERE i.id = p_item
$fn$;

CREATE FUNCTION test_fixture.us109_access_log(p_request uuid)
  RETURNS TABLE (actor_user_id uuid, actor_role text, subject_type text, subject_id uuid,
                 field_or_file text, purpose text, access_kind text, case_ref text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.actor_user_id, l.actor_role, l.subject_type, l.subject_id, l.field_or_file, l.purpose,
         l.access_kind, l.case_ref
    FROM core.audit_data_access_log AS l WHERE l.request_id = p_request
   ORDER BY l.at, l.id
$fn$;

CREATE FUNCTION test_fixture.us109_notes(p_user uuid)
  RETURNS TABLE (id uuid, author_user_id uuid, author_role text, country_code text, body text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT n.id, n.author_user_id, n.author_role, n.country_code, n.body
    FROM core.support_internal_note AS n
   WHERE n.subject_type = 'USER_ACCOUNT' AND n.subject_id = p_user
   ORDER BY n.created_at, n.id
$fn$;

CREATE FUNCTION test_fixture.us109_restrictions(p_user uuid)
  RETURNS TABLE (id uuid, kind text, active boolean, reason text, source_ref text,
                 created_by uuid, lifted boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.id, r.kind, r.active, r.reason, r.source_ref, r.created_by, r.lifted_at IS NOT NULL
    FROM core.iam_restriction AS r WHERE r.user_id = p_user
   ORDER BY r.created_at, r.id
$fn$;

CREATE FUNCTION test_fixture.us109_case(p_case uuid)
  RETURNS TABLE (requester_user_id uuid, country_code text, channel text, category text,
                 priority text, status text, assignee_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.requester_user_id, c.country_code, c.channel, c.category, c.priority, c.status,
         c.assignee_id
    FROM core.support_support_case AS c WHERE c.id = p_case
$fn$;

CREATE FUNCTION test_fixture.us109_file(p_id uuid)
  RETURNS TABLE (bucket text, storage_key text, mime text, bytes bigint, sha256 bytea,
                 uploader_user_id uuid, source text, classification text, enc_subject_type text,
                 enc_subject_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT f.bucket, f.storage_key, f.mime, f.bytes, f.sha256, f.uploader_user_id, f.source,
         f.classification, f.enc_subject_type, f.enc_subject_id
    FROM core.audit_file_asset AS f WHERE f.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us109_subject_key(p_user uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.audit_subject_key (subject_type, subject_id, wrapped_dek, kms_key_id)
  VALUES ('USER', p_user, pg_catalog.sha256(pg_catalog.convert_to(p_user::text, 'UTF8')) || pg_catalog.sha256(pg_catalog.convert_to(p_user::text || ':2', 'UTF8')), 'fake-kms:test')
  ON CONFLICT (subject_type, subject_id) DO NOTHING
$fn$;

CREATE FUNCTION test_fixture.us109_activate_org(p_org uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_organization SET status = 'ACTIVE' WHERE id = p_org
$fn$;

CREATE FUNCTION test_fixture.us109_holder_of(p_org uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.holder_user_id FROM core.iam_organization AS o WHERE o.id = p_org
$fn$;

CREATE FUNCTION test_fixture.us109_restrict_directly(p_user uuid, p_kind text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_restriction (id, user_id, kind, active, reason)
  VALUES (pg_catalog.gen_random_uuid(), p_user, p_kind, true, 'fixture US-109')
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us109_backdate_item(uuid, integer),
  test_fixture.us109_item(uuid),
  test_fixture.us109_access_log(uuid),
  test_fixture.us109_notes(uuid),
  test_fixture.us109_restrictions(uuid),
  test_fixture.us109_case(uuid),
  test_fixture.us109_file(uuid),
  test_fixture.us109_subject_key(uuid),
  test_fixture.us109_activate_org(uuid),
  test_fixture.us109_holder_of(uuid),
  test_fixture.us109_restrict_directly(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us109_backdate_item(uuid, integer),
  test_fixture.us109_item(uuid),
  test_fixture.us109_access_log(uuid),
  test_fixture.us109_notes(uuid),
  test_fixture.us109_restrictions(uuid),
  test_fixture.us109_case(uuid),
  test_fixture.us109_file(uuid),
  test_fixture.us109_subject_key(uuid),
  test_fixture.us109_activate_org(uuid),
  test_fixture.us109_holder_of(uuid),
  test_fixture.us109_restrict_directly(uuid, text) TO app_api;
