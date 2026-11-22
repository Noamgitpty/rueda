-- 9906 — fixtures des preuves des sinistres entre particuliers (US-318, migration 0178). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique) : poser les états
-- que d'autres chemins écrivent (trip OVERDUE à l'étape T24H de l'escalade d'US-306, dossier de
-- vol pour la preuve du gel), relire les registres (aucun rôle applicatif ne les lit) et tenter une
-- écriture interdite. Les attendus des tests viennent de 19 US-318, 16 TRP-038 / CLM-002 et 08
-- (BR-RETURN-04, BR-TT-02 à 04, BR-PRICE-15), jamais de ces fixtures. AUCUNE fixture n'écrit un
-- interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us318_* (voir la liste des droits en fin de fichier).

-- Trip OVERDUE dont le dossier de retard est à l'étape T24H (escalade « plainte » d'US-306)
CREATE FUNCTION test_fixture.us318_overdue_t24h(p_trip uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t record;
BEGIN
  SELECT x.id, x.country_code, x.scheduled_end INTO t FROM core.booking_trip AS x
   WHERE x.id = p_trip;
  UPDATE core.booking_trip SET status = 'OVERDUE' WHERE id = p_trip;
  INSERT INTO core.trip_ops_overdue_case (trip_id, country_code, stage, scheduled_end,
                                          detection_minutes, detected_at, use_until,
                                          occupancy_until)
  VALUES (t.id, t.country_code, 'T24H', t.scheduled_end, 30,
          t.scheduled_end + interval '30 minutes', t.scheduled_end + interval '25 hours',
          t.scheduled_end + interval '27 hours');
END
$fn$;

-- Dossier de vol posé directement (preuve du gel du versement sous app_worker)
CREATE FUNCTION test_fixture.us318_insert_theft_case(p_trip uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.claim_theft_case (id, trip_id, country_code, org_id)
  SELECT pg_catalog.gen_random_uuid(), t.id, t.country_code, t.org_id
    FROM core.booking_trip AS t WHERE t.id = p_trip
  RETURNING id
$fn$;

CREATE FUNCTION test_fixture.us318_theft_case(p_trip uuid)
  RETURNS TABLE (id uuid, status text, insurer_status text, insurer_ref text, opened_at timestamptz,
                 closed_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.id, x.status, x.insurer_status, x.insurer_ref, x.opened_at, x.closed_at
    FROM core.claim_theft_case AS x WHERE x.trip_id = p_trip
$fn$;

CREATE FUNCTION test_fixture.us318_incidents(p_trip uuid)
  RETURNS TABLE (id uuid, case_id uuid, reporter_user_id uuid, kind text, third_party boolean,
                 police_report boolean, photo_file_ids uuid[], reported_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.id, x.case_id, x.reporter_user_id, x.kind, x.third_party, x.police_report,
         x.photo_file_ids, x.reported_at
    FROM core.claim_incident_report AS x WHERE x.trip_id = p_trip
$fn$;

CREATE FUNCTION test_fixture.us318_traffic_charges(p_trip uuid)
  RETURNS TABLE (id uuid, kind text, declared_by uuid, amount_minor bigint, admin_fee_minor bigint,
                 total_minor bigint, leg_host_minor bigint, leg_insurer_minor bigint,
                 leg_tax_third_party_minor bigint, leg_platform_minor bigint,
                 deadline_at timestamptz, declared_at timestamptz, execution_status text,
                 execution_code text, charge_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.id, x.kind, x.declared_by, x.amount_minor, x.admin_fee_minor, x.total_minor,
         x.leg_host_minor, x.leg_insurer_minor, x.leg_tax_third_party_minor, x.leg_platform_minor,
         x.deadline_at, x.declared_at, x.execution_status, x.execution_code, x.charge_id
    FROM core.claim_traffic_charge AS x WHERE x.trip_id = p_trip
$fn$;

-- État d'une refacturation lu par objet (jamais par la file globale) : exécution, essais, échue
CREATE FUNCTION test_fixture.us318_traffic_charge(p_id uuid)
  RETURNS TABLE (execution_status text, execution_code text, failed_attempts integer, due boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.execution_status, x.execution_code, x.failed_attempts,
         x.execution_status = 'PENDING' AND x.next_check_at <= platform.now()
    FROM core.claim_traffic_charge AS x WHERE x.id = p_id
$fn$;

-- Débit séparé d'US-703 notifié pour une refacturation
CREATE FUNCTION test_fixture.us318_post_trip_charges(p_traffic_charge uuid)
  RETURNS TABLE (id uuid, purpose text, reason text, origin_type text, amount_minor bigint,
                 leg_host_minor bigint, leg_insurer_minor bigint, leg_tax_third_party_minor bigint,
                 leg_platform_minor bigint, guest_agreed boolean, status text,
                 tender_operation_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.id, c.purpose, c.reason, c.origin_type, c.amount_minor, c.leg_host_minor,
         c.leg_insurer_minor, c.leg_tax_third_party_minor, c.leg_platform_minor,
         c.guest_agreed_at IS NOT NULL, c.status, c.tender_operation_id
    FROM core.payment_post_trip_charge AS c
   WHERE c.origin_type = 'TRAFFIC_CHARGE' AND c.origin_id = p_traffic_charge
$fn$;

-- Écritures interdites (la garde claim_p2p_guard s'applique aussi sous migrator)
CREATE FUNCTION test_fixture.us318_try_write(p_what text, p_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_what = 'THEFT_DELETE' THEN
    DELETE FROM core.claim_theft_case WHERE id = p_id;
  ELSIF p_what = 'THEFT_REOPEN' THEN
    UPDATE core.claim_theft_case SET status = 'THEFT_INVESTIGATION', closed_at = NULL
     WHERE id = p_id;
  ELSIF p_what = 'INCIDENT_UPDATE' THEN
    UPDATE core.claim_incident_report SET third_party = NOT third_party WHERE id = p_id;
  ELSIF p_what = 'TRAFFIC_AMOUNT' THEN
    UPDATE core.claim_traffic_charge SET amount_minor = amount_minor + 1,
                                         leg_host_minor = leg_host_minor + 1,
                                         total_minor = total_minor + 1
     WHERE id = p_id;
  ELSIF p_what = 'TRAFFIC_DELETE' THEN
    DELETE FROM core.claim_traffic_charge WHERE id = p_id;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us318_overdue_t24h(uuid),
  test_fixture.us318_insert_theft_case(uuid),
  test_fixture.us318_theft_case(uuid),
  test_fixture.us318_incidents(uuid),
  test_fixture.us318_traffic_charges(uuid),
  test_fixture.us318_post_trip_charges(uuid),
  test_fixture.us318_try_write(text, uuid),
  test_fixture.us318_traffic_charge(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us318_overdue_t24h(uuid),
  test_fixture.us318_insert_theft_case(uuid),
  test_fixture.us318_theft_case(uuid),
  test_fixture.us318_incidents(uuid),
  test_fixture.us318_traffic_charges(uuid),
  test_fixture.us318_post_trip_charges(uuid),
  test_fixture.us318_try_write(text, uuid),
  test_fixture.us318_traffic_charge(uuid)
TO app_worker, app_api;
