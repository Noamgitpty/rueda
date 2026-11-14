-- 9952 — fixtures de la red team du lot 1, passe n° 2 (US-122). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Trois lectures seulement, sans aucune écriture : l'état d'un compte (demande d'effacement : le
-- compte est-il resté intact ?), l'état d'une demande de personne et les événements de l'outbox qui citent l'un des identifiants
-- donnés (notification d'un voyageur : un événement le concerne-t-il ?). SECURITY DEFINER sous
-- migrator, search_path figé, EXECUTE au seul app_api. Les attendus des tests viennent de 19, de
-- 08 et du rapport de la red team, jamais de ces fonctions.
--
-- Retour arrière : DROP FUNCTION test_fixture.us122b_user(uuid), test_fixture.us122b_dsr_of_user(uuid),
--   test_fixture.us122b_events_mentioning(text[]).

CREATE FUNCTION test_fixture.us122b_user(p_user uuid)
  RETURNS TABLE (status text, legal_first_name text, legal_last_name text,
                 pseudonymized_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT u.status, u.legal_first_name, u.legal_last_name, u.pseudonymized_at
    FROM core.iam_user_account AS u WHERE u.id = p_user
$fn$;

CREATE FUNCTION test_fixture.us122b_events_mentioning(p_needles text[])
  RETURNS TABLE (type text, aggregate_type text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_type
    FROM core.outbox_outbox_event AS e
   WHERE EXISTS (SELECT 1 FROM pg_catalog.unnest(p_needles) AS n
                  WHERE pg_catalog.position(n IN e.payload::text) > 0)
   ORDER BY e.type
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us122b_user(uuid),
  test_fixture.us122b_events_mentioning(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us122b_user(uuid),
  test_fixture.us122b_events_mentioning(text[]) TO app_api;

-- Demande de personne (lecture) d'un compte : type, état, échéance et marque de retard. Sert à
-- vérifier, dans la transaction du test, ce qu'une passe du travailleur a fait d'une demande.
CREATE FUNCTION test_fixture.us122b_dsr_of_user(p_user uuid)
  RETURNS TABLE (kind text, status text, due_at timestamptz, overdue_alerted_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.kind, d.status, d.due_at, d.overdue_alerted_at
    FROM core.audit_data_subject_request AS d WHERE d.user_id = p_user
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us122b_dsr_of_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us122b_dsr_of_user(uuid) TO app_api, app_worker;
