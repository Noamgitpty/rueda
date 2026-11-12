-- 9976 — fixtures des preuves de la vérification de l'hôte par exception, du filtrage manuel, du
-- dossier de la console et de la couverture de l'assureur (US-108, migration 0081). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé) :
--   - relectures des lignes que les rôles applicatifs ne lisent pas (filtrage et action liée,
--     élément de file, véhicule, journal d'accès) : les attendus des tests viennent de 19 US-108,
--     16 VER-028 / ADM-004 / HST-019 et 17 §2.4, jamais de ces relectures ;
--   - contrat d'assureur de TEST (`us108_insurer_contract`) et revue exigée par le pays
--     (`us108_set_review_required`), classe de valeur d'un véhicule (`us108_set_value_class`) : appelés SEULEMENT dans des transactions de test ANNULÉES,
--     jamais validées (aucun effet sur les autres preuves).
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us108_* (voir la liste des droits en fin de fichier).

CREATE FUNCTION test_fixture.us108_insurer_contract(p_country text, p_max_age integer,
                                                    p_value_classes text[])
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_insurer  uuid := platform.uuid_v7();
  v_contract uuid := platform.uuid_v7();
  v_from     timestamptz := platform.now() - interval '1 day';
BEGIN
  INSERT INTO core.settlement_insurer (id, country_code, name, kind, status)
  VALUES (v_insurer, p_country, 'Assureur de test', 'INSURER', 'ACTIVE');
  INSERT INTO core.settlement_insurer_contract (id, insurer_id, country_code, version,
                                                vehicle_eligibility, signed_at, valid_from)
  VALUES (v_contract, v_insurer, p_country,
          (SELECT COALESCE(pg_catalog.max(c.version), 0) + 1
             FROM core.settlement_insurer_contract AS c WHERE c.country_code = p_country),
          pg_catalog.jsonb_build_object('maxVehicleAgeYears', p_max_age,
                                        'valueClasses', pg_catalog.to_jsonb(p_value_classes),
                                        'usages', pg_catalog.jsonb_build_array('PARTICULAR')),
          v_from, v_from);
  RETURN v_contract;
END
$fn$;

CREATE FUNCTION test_fixture.us108_set_review_required(p_country text, p_value boolean)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES ('host_manual_review_required', p_country, 'COUNTRY', pg_catalog.to_jsonb(p_value),
          'test US-108 (transaction annulée)')
$fn$;

CREATE FUNCTION test_fixture.us108_screening(p_org uuid)
  RETURNS TABLE (provider text, request_key text, lists_version jsonb, result text,
                 reviewer uuid, manual_action_id uuid, screened_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.provider, s.request_key, s.lists_version, s.result, s.reviewer, s.manual_action_id,
         s.screened_at
    FROM core.kyc_sanctions_screening AS s
    JOIN core.kyc_host_verification AS d ON d.id = s.host_verification_id
   WHERE d.org_id = p_org
   ORDER BY s.created_at, s.id
$fn$;

CREATE FUNCTION test_fixture.us108_manual_action(p_id uuid)
  RETURNS TABLE (action_code text, subject_id uuid, actor_user_id uuid, input jsonb,
                 evidence_file_ids uuid[], reason text, outcome text, domain_ref uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT m.action_code, m.subject_id, m.actor_user_id, m.input, m.evidence_file_ids, m.reason,
         m.outcome, m.domain_ref
    FROM core.support_manual_action AS m WHERE m.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us108_queue_item(p_org uuid)
  RETURNS TABLE (id uuid, status text, decision text, assignee_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.status, i.decision, i.assignee_id
    FROM core.support_review_queue_item AS i
   WHERE i.queue = 'HOST_VERIFICATION' AND i.subject_type = 'ORGANIZATION' AND i.subject_id = p_org
   ORDER BY i.created_at DESC, i.id DESC
$fn$;

CREATE FUNCTION test_fixture.us108_access_log(p_actor uuid)
  RETURNS TABLE (subject_type text, subject_id uuid, field_or_file text, access_kind text,
                 case_ref text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.subject_type, l.subject_id, l.field_or_file, l.access_kind, l.case_ref
    FROM core.audit_data_access_log AS l WHERE l.actor_user_id = p_actor
   ORDER BY l.at, l.id
$fn$;

CREATE FUNCTION test_fixture.us108_vehicle(p_vehicle uuid)
  RETURNS TABLE (year integer, value_class text, plate_category text, timezone text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.year, v.value_class, v.plate_category, v.timezone
    FROM core.catalog_vehicle AS v WHERE v.id = p_vehicle
$fn$;

-- Classe de valeur d'un véhicule de test (transaction annulée seulement).
CREATE FUNCTION test_fixture.us108_set_value_class(p_vehicle uuid, p_class text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.catalog_vehicle SET value_class = p_class WHERE id = p_vehicle
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us108_set_value_class(uuid, text),
  test_fixture.us108_insurer_contract(text, integer, text[]),
  test_fixture.us108_set_review_required(text, boolean), test_fixture.us108_screening(uuid),
  test_fixture.us108_manual_action(uuid), test_fixture.us108_queue_item(uuid),
  test_fixture.us108_access_log(uuid), test_fixture.us108_vehicle(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us108_set_value_class(uuid, text),
  test_fixture.us108_insurer_contract(text, integer, text[]),
  test_fixture.us108_screening(uuid), test_fixture.us108_manual_action(uuid),
  test_fixture.us108_queue_item(uuid), test_fixture.us108_access_log(uuid),
  test_fixture.us108_vehicle(uuid) TO app_api;
GRANT EXECUTE ON FUNCTION test_fixture.us108_set_review_required(text, boolean) TO app_worker;
