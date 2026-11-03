-- 9001 — fixtures des preuves L0 (US-006). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` ; la base `rueda_test_*_prod` ne reçoit pas ce fichier (test
-- d'intégration « fixtures absentes de la base de production »).
--
-- Rôle de ces fonctions : remplacer, en attendant leurs stories, les écrivains qui n'existent pas
-- encore, sans donner aux rôles applicatifs un droit qu'ils n'auront pas en production :
--   - place_hold : la commande booking.cmd_place_hold (US-023, propriétaire cmd_hold_owner),
--     ici réduite à l'insertion de l'occupation HOLD puis du hold (étape 2c de 17 §2.5) ;
--   - insert_payment_operation : la commande cmd_start_payment (T1, US-024) ; depuis US-023
--     (0038), avec le compte PSP de test du pays et quatre jambes ;
--   - delete_occupancy : une suppression qu'AUCUN rôle applicatif ne peut faire (aucun DELETE
--     accordé), pour prouver qu'elle reste refusée même forcée par le propriétaire (L0-03 : la
--     clé étrangère du hold refuse dès l'instruction ; le trigger différé occupancy_trip_guard
--     couvre DELETE en défense en profondeur).
-- SECURITY DEFINER sous migrator (propriétaire des tables, politique migrator_all) : la
-- transaction appelante reste sous app_api / app_worker, et les triggers différés sont évalués
-- au COMMIT de CETTE transaction. Aucun SQL dynamique, search_path figé.
--
-- Retour arrière : DROP SCHEMA test_fixture CASCADE;

CREATE SCHEMA test_fixture;
REVOKE ALL ON SCHEMA test_fixture FROM PUBLIC;
GRANT USAGE ON SCHEMA test_fixture TO app_api, app_worker;

CREATE FUNCTION test_fixture.place_hold(
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

-- US-023 (0038) : toute opération porte un compte PSP et, si elle déplace des fonds, ses quatre
-- jambes (contrôle différé de 0028). Compte FAKE SANDBOX de test du pays (créé au besoin,
-- PENDING_VALIDATION : plusieurs fixtures peuvent le créer en parallèle sans conflit d'unicité) et
-- jambes de test : HOST = montant, les trois autres à zéro (aucune règle de partage ici ; les
-- montants par jambe des vecteurs TJ sont éprouvés par l0-pay-port et l0-pay-legs-rls).
CREATE FUNCTION test_fixture.fixture_psp_account(p_country_code text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  SELECT a.id INTO v_id
    FROM core.payment_psp_account a
   WHERE a.provider = 'FAKE' AND a.country_code = p_country_code
     AND a.public_webhook_id LIKE 'fixture-%'
   ORDER BY a.created_at
   LIMIT 1;
  IF v_id IS NULL THEN
    v_id := pg_catalog.gen_random_uuid();
    INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id)
    VALUES (v_id, 'FAKE', p_country_code, 'SANDBOX', 'PENDING_VALIDATION',
            'fixture-' || pg_catalog.replace(v_id::text, '-', ''));
  END IF;
  RETURN v_id;
END
$fn$;

CREATE FUNCTION test_fixture.fixture_operation_legs(
  p_operation_id uuid,
  p_kind         text,
  p_org_id       uuid,
  p_trip_id      uuid,
  p_country_code text,
  p_amount_minor bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_kind IN ('VOID', 'DEPOSIT_VOID', 'DEPOSIT_AUTH', 'CHARGEBACK', 'CHARGEBACK_REVERSAL') THEN
    RETURN;
  END IF;
  INSERT INTO core.payment_payment_operation_leg (operation_id, leg, org_id, trip_id, country_code, amount_minor)
  SELECT p_operation_id, l.leg, p_org_id, p_trip_id, p_country_code,
         CASE WHEN l.leg = 'HOST' THEN p_amount_minor ELSE 0 END
    FROM (VALUES ('HOST'), ('INSURER'), ('TAX_THIRD_PARTY'), ('PLATFORM')) AS l(leg);
END
$fn$;

CREATE FUNCTION test_fixture.insert_payment_operation(
  p_operation_id uuid,
  p_hold_id      uuid,
  p_country_code text,
  p_currency     text,
  p_amount_minor bigint,
  p_kind         text,
  p_purpose      text,
  p_status       text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO core.payment_payment_operation
         (id, hold_id, psp_account_id, country_code, provider, kind, purpose, amount_minor, currency,
          attempt_no, status, idem_plain, idem_sent)
  VALUES (p_operation_id, p_hold_id, test_fixture.fixture_psp_account(p_country_code),
          p_country_code, 'FAKE', p_kind, p_purpose, p_amount_minor, p_currency, 1, p_status,
          pg_catalog.format('hold:%s:%s:op:%s', p_hold_id, p_kind, p_operation_id),
          pg_catalog.format('test:%s', p_operation_id));
  PERFORM test_fixture.fixture_operation_legs(
    p_operation_id, p_kind, (SELECT h.org_id FROM core.booking_checkout_hold h WHERE h.id = p_hold_id),
    NULL, p_country_code, p_amount_minor);
END
$fn$;

CREATE FUNCTION test_fixture.delete_occupancy(p_occupancy_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  DELETE FROM core.booking_vehicle_occupancy WHERE id = p_occupancy_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.fixture_psp_account(text),
  test_fixture.fixture_operation_legs(uuid, text, uuid, uuid, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.fixture_psp_account(text) TO app_api, app_worker;
REVOKE ALL ON FUNCTION test_fixture.place_hold(uuid, uuid, uuid, uuid, uuid, text, tstzrange, interval),
  test_fixture.insert_payment_operation(uuid, uuid, text, text, bigint, text, text, text),
  test_fixture.delete_occupancy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.place_hold(uuid, uuid, uuid, uuid, uuid, text, tstzrange, interval),
  test_fixture.insert_payment_operation(uuid, uuid, text, text, bigint, text, text, text)
  TO app_api;
GRANT EXECUTE ON FUNCTION test_fixture.delete_occupancy(uuid) TO app_worker;
