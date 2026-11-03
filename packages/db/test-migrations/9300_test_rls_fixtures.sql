-- 9300 — fixtures des tests RLS par acteur et par pays (US-011). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : remplacer les écrivains qui n'existent pas encore (parcours hôte et voyageur, console
-- US-012) pour poser un monde de test, sans donner aux rôles applicatifs un droit de table qu'ils
-- n'auront pas en production. SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique.
--
--   - ensure_party : depuis 0023, guest_user_id et (org_id, country_code) des holds et trips sont
--     des clés étrangères vers IAM ; les preuves L0 d'US-006 posent des identifiants libres. Cette
--     fonction crée, s'ils manquent, le compte du voyageur et le compte d'hôte (avec son titulaire
--     et son appartenance P2P_HOST actifs) ; place_hold l'appelle désormais (CREATE OR REPLACE :
--     propriétaire et droits de 9001 conservés) ;
--   - rls_insert_trip : un trip BOOKED complet (occupation TRIP active, trip, occupation du
--     voyageur) dans une transaction, ce qui satisfait I-OCC au COMMIT ;
--   - rls_insert_trip_operation : une opération de loyer rattachée à un trip ;
--   - rls_insert_support_case : un dossier de support assigné (console US-012).
--
-- Retour arrière : DROP FUNCTION test_fixture.ensure_party(uuid, uuid, text),
--   test_fixture.rls_insert_trip(…), test_fixture.rls_insert_trip_operation(…),
--   test_fixture.rls_insert_support_case(…) ; recréer place_hold de 9001.

CREATE FUNCTION test_fixture.ensure_party(p_guest_id uuid, p_org_id uuid, p_country_code text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_holder uuid;
BEGIN
  IF p_guest_id IS NOT NULL THEN
    INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale, status)
    VALUES (p_guest_id, pg_catalog.format('guest-%s@fixture.test', p_guest_id), 'Fixture', 'Guest', 'en', 'ACTIVE')
    ON CONFLICT (id) DO NOTHING;
  END IF;
  IF p_org_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM core.iam_organization AS o WHERE o.id = p_org_id) THEN
    v_holder := pg_catalog.gen_random_uuid();
    INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale, status)
    VALUES (v_holder, pg_catalog.format('holder-%s@fixture.test', v_holder), 'Fixture', 'Host', 'en', 'ACTIVE');
    INSERT INTO core.iam_organization (id, holder_user_id, country_code, status)
    VALUES (p_org_id, v_holder, p_country_code, 'ACTIVE');
    INSERT INTO core.iam_membership (id, user_id, org_id, role, status)
    VALUES (pg_catalog.gen_random_uuid(), v_holder, p_org_id, 'P2P_HOST', 'ACTIVE');
  END IF;
END
$fn$;

CREATE OR REPLACE FUNCTION test_fixture.place_hold(
  p_hold_id      uuid,
  p_occupancy_id uuid,
  p_guest_id     uuid,
  p_vehicle_id   uuid,
  p_org_id       uuid,
  p_country_code text,
  p_period       tstzrange,
  p_ttl          interval
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_expires_at timestamptz := platform.now() + p_ttl;
BEGIN
  PERFORM test_fixture.ensure_party(p_guest_id, p_org_id, p_country_code);
  -- 23P01 (vehicle_occupancy_no_overlap) possible ici : créneau pris
  -- US-022 (0032) : compte d'hôte et pays de l'occupation = ceux du hold
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          ref_type, ref_id)
  VALUES (p_occupancy_id, p_vehicle_id, p_org_id, p_country_code, 'HOLD', 'CHECKOUT', p_period,
          true, v_expires_at, 'HOLD', p_hold_id);
  -- 23505 (one_live_hold_per_guest_vehicle) possible ici : hold vivant du même guest
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status, expires_at)
  VALUES (p_hold_id, p_guest_id, p_vehicle_id, p_org_id, p_country_code, p_occupancy_id,
          'CHECKOUT', 'ACTIVE', v_expires_at);
END
$fn$;

CREATE FUNCTION test_fixture.rls_insert_trip(
  p_trip_id    uuid,
  p_guest_id   uuid,
  p_org_id     uuid,
  p_vehicle_id uuid,
  p_country    text,
  p_currency   text,
  p_timezone   text,
  p_start      timestamptz,
  p_end        timestamptz
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM test_fixture.ensure_party(p_guest_id, p_org_id, p_country);
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, ref_type, ref_id)
  VALUES (pg_catalog.gen_random_uuid(), p_vehicle_id, p_org_id, p_country, 'TRIP', 'CHECKOUT',
          pg_catalog.tstzrange(p_start, p_end, '[)'), true, 'TRIP', p_trip_id);
  INSERT INTO core.booking_trip (id, public_ref, guest_user_id, org_id, vehicle_id, country_code,
                                 currency, timezone, scheduled_start, scheduled_end, status)
  VALUES (p_trip_id, pg_catalog.format('T-%s', p_trip_id), p_guest_id,
          p_org_id, p_vehicle_id, p_country, p_currency, p_timezone, p_start, p_end, 'BOOKED');
  INSERT INTO core.booking_guest_occupancy (id, guest_user_id, period, active, trip_id)
  VALUES (pg_catalog.gen_random_uuid(), p_guest_id, pg_catalog.tstzrange(p_start, p_end, '[)'),
          true, p_trip_id);
END
$fn$;

CREATE FUNCTION test_fixture.rls_insert_trip_operation(
  p_operation_id uuid,
  p_trip_id      uuid,
  p_amount_minor bigint
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.payment_payment_operation
         (id, trip_id, psp_account_id, country_code, provider, kind, purpose, amount_minor, currency,
          attempt_no, status, idem_plain, idem_sent)
  SELECT p_operation_id, t.id, test_fixture.fixture_psp_account(t.country_code), t.country_code,
         'FAKE', 'CAPTURE', 'RENT', p_amount_minor, t.currency,
         1, 'SUCCEEDED', pg_catalog.format('trip:%s:op:%s', t.id, p_operation_id),
         pg_catalog.format('test:%s', p_operation_id)
    FROM core.booking_trip AS t
   WHERE t.id = p_trip_id;
  -- US-023 (0038) : quatre jambes (fixture 9001)
  SELECT test_fixture.fixture_operation_legs(p_operation_id, 'CAPTURE', t.org_id, t.id,
                                             t.country_code, p_amount_minor)
    FROM core.booking_trip AS t
   WHERE t.id = p_trip_id;
$fn$;

CREATE FUNCTION test_fixture.rls_insert_support_case(
  p_case_id     uuid,
  p_country     text,
  p_trip_id     uuid,
  p_assignee_id uuid,
  p_status      text,
  p_category    text,
  p_reason      text
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.support_support_case (id, country_code, trip_id, channel, category, status,
                                         assignee_id, reason)
  VALUES (p_case_id, p_country, p_trip_id, 'INTERNAL', p_category, p_status, p_assignee_id, p_reason)
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.ensure_party(uuid, uuid, text),
  test_fixture.rls_insert_trip(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz),
  test_fixture.rls_insert_trip_operation(uuid, uuid, bigint),
  test_fixture.rls_insert_support_case(uuid, text, uuid, uuid, text, text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.ensure_party(uuid, uuid, text),
  test_fixture.rls_insert_trip(uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz),
  test_fixture.rls_insert_trip_operation(uuid, uuid, bigint),
  test_fixture.rls_insert_support_case(uuid, text, uuid, uuid, text, text, text)
TO app_api, app_worker;
