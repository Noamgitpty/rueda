-- 9980 — fixtures des preuves du compte d'hôte (US-107, migration 0061). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) :
--   - pose de la date de naissance d'une personne (aucune commande ne l'écrit avant le KYC) ;
--   - relecture des comptes d'hôte d'une personne et de leur appartenance titulaire, colonnes
--     comprises que les rôles applicatifs ne lisent pas (created_by) : les attendus du test
--     viennent de 19 US-107 et de 17 §3.2.1, jamais de cette relecture.
--
-- Retour arrière : DROP FUNCTION test_fixture.us107_set_birth_date(uuid, date),
--   test_fixture.us107_host_rows(uuid).

CREATE FUNCTION test_fixture.us107_set_birth_date(p_user uuid, p_birth date)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_user_account SET date_of_birth = p_birth WHERE id = p_user
$fn$;

CREATE FUNCTION test_fixture.us107_host_rows(p_user uuid)
  RETURNS TABLE (org_id uuid, kind text, country_code text, display_name text, tax_id text,
                 org_status text, plan_code text, legal_entity_id uuid, org_created_by uuid,
                 member_user uuid, member_role text, member_status text, members bigint)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.id, o.kind, o.country_code, o.display_name, o.tax_id, o.status, o.plan_code,
         o.legal_entity_id, o.created_by, m.user_id, m.role, m.status,
         (SELECT pg_catalog.count(*) FROM core.iam_membership AS x WHERE x.org_id = o.id)
    FROM core.iam_organization AS o
    LEFT JOIN core.iam_membership AS m ON m.org_id = o.id AND m.role = 'P2P_HOST'
   WHERE o.holder_user_id = p_user
   ORDER BY o.country_code
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us107_set_birth_date(uuid, date),
  test_fixture.us107_host_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us107_set_birth_date(uuid, date),
  test_fixture.us107_host_rows(uuid) TO app_api;
