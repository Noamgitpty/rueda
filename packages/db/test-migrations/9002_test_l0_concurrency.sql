-- 9002 — fixtures des preuves L0-02 et L0-04 (US-007). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle de ces fonctions : tenir lieu, en attendant leurs stories, des écrivains qui n'existent pas
-- encore, sans donner aux rôles applicatifs un droit de table qu'ils n'auront pas en production :
--   - l0_place_hold : la commande booking.cmd_place_hold (US-023, propriétaire cmd_hold_owner),
--     réduite aux étapes de 17 §2.5 qui portent la concurrence : (0) verrous consultatifs du guest
--     puis du véhicule (ordre global, VERIF_16-M2), (2a) expiration ciblée, texte de la
--     spécification, (2c) insertion de l'occupation HOLD puis du hold. `p_vehicle_lock = false`
--     est l'INJECTION de L0-02 : la même pose sans le verrou du véhicule. Renvoie les holds
--     expirés par 2a (identifiants), pour la preuve L0-04 côté commande ;
--   - l0_place_hold_timed : la même pose, instrumentée (instants serveur d'obtention du verrou
--     du véhicule et de fin de commande) pour la série C1 transactionnelle ;
--   - l0_ensure_parties : comptes du voyageur et compte d'hôte (titulaire, appartenance P2P_HOST),
--     créés AVANT une course : depuis US-011 (0023), guest_user_id et (org_id, country_code) sont
--     des clés étrangères vers IAM ; les créer pendant la course mesurerait IAM, pas l'exclusion ;
--   - l0_set_payment_in_flight : la transaction T1 de cmd_start_payment (17 §2.5 étape 3a) ;
--   - l0_seed_expiry_bench : le volume de L0-04 (10 000 holds, 1 000 véhicules) en une instruction
--     par table ; l0_analyze : statistiques du planificateur après ce volume.
-- SECURITY DEFINER sous migrator (propriétaire des tables, politique migrator_all) : la
-- transaction appelante reste sous app_api, et les triggers différés sont évalués au COMMIT de
-- CETTE transaction. Aucun SQL dynamique, search_path figé, noms qualifiés.
-- Aucune constante pays : pays, devise et montant sont des paramètres (CLAUDE.md point 3).
--
-- Retour arrière : DROP FUNCTION test_fixture.l0_place_hold(…), test_fixture.l0_place_hold_timed(…), test_fixture.l0_ensure_parties(…),
--   test_fixture.l0_set_payment_in_flight(…), test_fixture.l0_seed_expiry_bench(…),
--   test_fixture.l0_analyze();

CREATE FUNCTION test_fixture.l0_ensure_parties(
  p_guest_ids    uuid[],
  p_org_id       uuid,
  p_country_code text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_holder uuid;
BEGIN
  INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale, status)
  SELECT g, pg_catalog.format('l0-guest-%s@fixture.test', g), 'Fixture', 'Guest', 'en', 'ACTIVE'
    FROM pg_catalog.unnest(p_guest_ids) AS g
  ON CONFLICT (id) DO NOTHING;
  IF p_org_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM core.iam_organization AS o WHERE o.id = p_org_id) THEN
    v_holder := pg_catalog.gen_random_uuid();
    INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale, status)
    VALUES (v_holder, pg_catalog.format('l0-holder-%s@fixture.test', v_holder), 'Fixture', 'Host', 'en', 'ACTIVE');
    INSERT INTO core.iam_organization (id, holder_user_id, country_code, status)
    VALUES (p_org_id, v_holder, p_country_code, 'ACTIVE');
    INSERT INTO core.iam_membership (id, user_id, org_id, role, status)
    VALUES (pg_catalog.gen_random_uuid(), v_holder, p_org_id, 'P2P_HOST', 'ACTIVE');
  END IF;
END
$fn$;

CREATE FUNCTION test_fixture.l0_place_hold(
  p_hold_id       uuid,
  p_occupancy_id  uuid,
  p_guest_id      uuid,
  p_vehicle_id    uuid,
  p_org_id        uuid,
  p_country_code  text,
  p_period        tstzrange,
  p_ttl           interval,
  p_vehicle_lock  boolean,
  p_sweep_grace_s integer
)
  RETURNS uuid[]
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_expired    uuid[];
  v_expires_at timestamptz;
BEGIN
  -- 0. verrous : guest puis véhicule (ordre global, 17 §2.5, VERIF_16-M2)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || p_guest_id::text, 0));
  IF p_vehicle_lock THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || p_vehicle_id::text, 0));
  END IF;

  -- 2a. expiration ciblée : texte EXPIRY_2A_SQL de test/support/expiry-2a.ts (17 §2.5,
  -- VERIF_16-M14, VERIF_17-A3 / A6), à l'identique aux paramètres près ; la dernière instruction
  -- est enveloppée dans une CTE pour renvoyer les holds expirés (ref_id d'une occupation HOLD =
  -- identifiant du hold). Égalité vérifiée par test/support/expiry-2a.test.ts.
  WITH t AS (SELECT platform.now() AS ts),
     due AS (
       SELECT h.id, h.occupancy_id
         FROM core.booking_checkout_hold h, t
        WHERE (h.vehicle_id = p_vehicle_id OR h.guest_user_id = p_guest_id)
          AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
          AND h.expires_at <= t.ts
          AND (h.payment_in_flight_until IS NULL OR h.payment_in_flight_until <= t.ts)
          AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation o
                           WHERE o.hold_id = h.id AND o.purpose = 'RENT'
                             AND ( ( o.status IN ('PENDING','SUBMITTED','UNKNOWN')
                                     AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
                                     AND t.ts < h.payment_in_flight_until + make_interval(secs => p_sweep_grace_s) )
                                OR ( o.status = 'SUCCEEDED'
                                     AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                                      WHERE d.operation_id = o.id) ) ))
        FOR UPDATE OF h SKIP LOCKED
     ), expired AS (
       UPDATE core.booking_checkout_hold SET status = 'EXPIRED', expired_at = (SELECT ts FROM t)
        WHERE id IN (SELECT id FROM due)
       RETURNING occupancy_id
     ), deactivated AS (
     UPDATE core.booking_vehicle_occupancy
        SET active = false, deactivated_reason = 'HOLD_EXPIRED'
      WHERE id IN (SELECT occupancy_id FROM expired)
        AND kind = 'HOLD'
     RETURNING ref_id
     )
  SELECT COALESCE(pg_catalog.array_agg(ref_id), '{}') INTO v_expired FROM deactivated;

  -- 2c. occupation HOLD (23P01 vehicle_occupancy_no_overlap possible : créneau pris), puis hold
  v_expires_at := platform.now() + p_ttl;
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          ref_type, ref_id)
  VALUES (p_occupancy_id, p_vehicle_id, p_org_id, p_country_code, 'HOLD', 'CHECKOUT', p_period,
          true, v_expires_at, 'HOLD', p_hold_id);
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status, expires_at)
  VALUES (p_hold_id, p_guest_id, p_vehicle_id, p_org_id, p_country_code, p_occupancy_id,
          'CHECKOUT', 'ACTIVE', v_expires_at);
  RETURN v_expired;
END
$fn$;

-- Variante MESURÉE de la pose (revue sécurité US-007, constat 1) : mêmes verrous, puis
-- l0_place_hold (verrous ré-entrants). Renvoie, et pour une pose perdante (23P01) remonte dans
-- le HINT, l'instant où le verrou du véhicule est obtenu et l'instant où la commande a fini,
-- horloge du serveur (platform.now(), réelle sans horloge virtuelle). Les verrous sont pris HORS
-- du bloc EXCEPTION : le sous-transaction annulé ne les rend pas, la pose perdante les garde
-- jusqu'au ROLLBACK du client, comme la commande réelle dans une transaction explicite.
CREATE FUNCTION test_fixture.l0_place_hold_timed(
  p_hold_id       uuid,
  p_occupancy_id  uuid,
  p_guest_id      uuid,
  p_vehicle_id    uuid,
  p_org_id        uuid,
  p_country_code  text,
  p_period        tstzrange,
  p_ttl           interval,
  p_vehicle_lock  boolean,
  p_sweep_grace_s integer
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_locked_at timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || p_guest_id::text, 0));
  IF p_vehicle_lock THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || p_vehicle_id::text, 0));
  END IF;
  v_locked_at := platform.now();
  BEGIN
    PERFORM test_fixture.l0_place_hold(p_hold_id, p_occupancy_id, p_guest_id, p_vehicle_id,
                                       p_org_id, p_country_code, p_period, p_ttl, p_vehicle_lock,
                                       p_sweep_grace_s);
  EXCEPTION WHEN exclusion_violation THEN
    RAISE EXCEPTION 'vehicle_occupancy_no_overlap'
      USING ERRCODE = 'exclusion_violation',
            CONSTRAINT = 'vehicle_occupancy_no_overlap',
            HINT = pg_catalog.json_build_object(
                     'lockedAtMs', pg_catalog.date_part('epoch', v_locked_at) * 1000,
                     'doneAtMs', pg_catalog.date_part('epoch', platform.now()) * 1000)::text;
  END;
  RETURN pg_catalog.json_build_object(
           'lockedAtMs', pg_catalog.date_part('epoch', v_locked_at) * 1000,
           'doneAtMs', pg_catalog.date_part('epoch', platform.now()) * 1000)::text;
END
$fn$;

CREATE FUNCTION test_fixture.l0_set_payment_in_flight(p_hold_id uuid, p_until timestamptz)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  UPDATE core.booking_checkout_hold
     SET status = 'PAYMENT_IN_FLIGHT', payment_in_flight_until = p_until
   WHERE id = p_hold_id AND status = 'ACTIVE';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'l0_set_payment_in_flight: hold % not ACTIVE', p_hold_id;
  END IF;
END
$fn$;

-- Volume de L0-04. Créneau k = i % p_holds_per_vehicle du véhicule i / p_holds_per_vehicle,
-- guest i % p_guests. Répartition par k % 10 (mélange plausible d'un catalogue en service) :
--   0 à 5 EXPIRED (opération FAILED), 6 RELEASED (opération FAILED), 7 COMPENSATED (opération
--   SUCCEEDED, hold_compensation et disposition COMPENSATION), 8 ACTIVE non échu (sans opération),
--   9 PAYMENT_IN_FLIGHT non échu (opération PENDING).
-- Les périodes d'un véhicule sont disjointes (exclusion) ; deux holds d'un même guest portent sur
-- deux véhicules distincts dès que p_guests est un multiple de p_holds_per_vehicle et que
-- p_vehicles * p_holds_per_vehicle <= 2 * p_guests (au plus 2 holds vivants par guest).
CREATE FUNCTION test_fixture.l0_seed_expiry_bench(
  p_org_id            uuid,
  p_country_code      text,
  p_currency          text,
  p_amount_minor      bigint,
  p_vehicles          integer,
  p_holds_per_vehicle integer,
  p_guests            integer
)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_seed  text        := pg_catalog.gen_random_uuid()::text;
  v_now   timestamptz := platform.now();
  v_holds integer     := p_vehicles * p_holds_per_vehicle;
  v_account uuid      := test_fixture.fixture_psp_account(p_country_code);
BEGIN
  IF p_holds_per_vehicle < 10 OR p_vehicles * p_holds_per_vehicle > 2 * p_guests
     OR p_guests % p_holds_per_vehicle <> 0 THEN
    RAISE EXCEPTION 'l0_seed_expiry_bench: invalid shape';
  END IF;
  PERFORM test_fixture.l0_ensure_parties('{}', p_org_id, p_country_code);
  INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale, status)
  SELECT pg_catalog.md5(v_seed || ':g:' || g)::uuid,
         pg_catalog.format('l0-bench-%s@fixture.test', pg_catalog.md5(v_seed || ':g:' || g)),
         'Fixture', 'Guest', 'en', 'ACTIVE'
    FROM pg_catalog.generate_series(0, p_guests - 1) AS g;

  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          deactivated_reason, ref_type, ref_id)
  SELECT pg_catalog.md5(v_seed || ':o:' || s.i)::uuid,
         pg_catalog.md5(v_seed || ':v:' || (s.i / p_holds_per_vehicle))::uuid,
         p_org_id, p_country_code,
         'HOLD', 'CHECKOUT',
         pg_catalog.tstzrange(v_now + pg_catalog.make_interval(days => 30 + 3 * s.k),
                              v_now + pg_catalog.make_interval(days => 32 + 3 * s.k), '[)'),
         s.c IN (8, 9),
         CASE WHEN s.c = 8 THEN v_now + pg_catalog.make_interval(mins => 10)
              WHEN s.c = 9 THEN v_now + pg_catalog.make_interval(mins => 5)
              ELSE v_now - pg_catalog.make_interval(days => 1) END,
         CASE WHEN s.c <= 5 THEN 'HOLD_EXPIRED' WHEN s.c = 6 THEN 'HOLD_RELEASED'
              WHEN s.c = 7 THEN 'HOLD_COMPENSATED' END,
         'HOLD', pg_catalog.md5(v_seed || ':h:' || s.i)::uuid
    FROM (SELECT i, i % p_holds_per_vehicle AS k, (i % p_holds_per_vehicle) % 10 AS c
            FROM pg_catalog.generate_series(0, v_holds - 1) AS i) AS s;

  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
          expires_at, payment_in_flight_until, expired_at, released_at, release_reason, compensated_at)
  SELECT pg_catalog.md5(v_seed || ':h:' || s.i)::uuid,
         pg_catalog.md5(v_seed || ':g:' || (s.i % p_guests))::uuid,
         pg_catalog.md5(v_seed || ':v:' || (s.i / p_holds_per_vehicle))::uuid,
         p_org_id, p_country_code,
         pg_catalog.md5(v_seed || ':o:' || s.i)::uuid,
         'CHECKOUT',
         CASE WHEN s.c <= 5 THEN 'EXPIRED' WHEN s.c = 6 THEN 'RELEASED' WHEN s.c = 7 THEN 'COMPENSATED'
              WHEN s.c = 8 THEN 'ACTIVE' ELSE 'PAYMENT_IN_FLIGHT' END,
         CASE WHEN s.c = 8 THEN v_now + pg_catalog.make_interval(mins => 10)
              WHEN s.c = 9 THEN v_now + pg_catalog.make_interval(mins => 5)
              ELSE v_now - pg_catalog.make_interval(days => 1) END,
         CASE WHEN s.c = 9 THEN v_now + pg_catalog.make_interval(mins => 15) END,
         CASE WHEN s.c <= 5 THEN v_now - pg_catalog.make_interval(days => 1) END,
         CASE WHEN s.c = 6 THEN v_now - pg_catalog.make_interval(days => 1) END,
         CASE WHEN s.c = 6 THEN 'GUEST_ABANDON' END,
         CASE WHEN s.c = 7 THEN v_now - pg_catalog.make_interval(days => 1) END
    FROM (SELECT i, (i % p_holds_per_vehicle) % 10 AS c
            FROM pg_catalog.generate_series(0, v_holds - 1) AS i) AS s;

  INSERT INTO core.payment_payment_operation
         (id, hold_id, psp_account_id, country_code, provider, kind, purpose, amount_minor, currency,
          attempt_no, status, idem_plain, idem_sent)
  SELECT pg_catalog.md5(v_seed || ':p:' || s.i)::uuid,
         pg_catalog.md5(v_seed || ':h:' || s.i)::uuid,
         v_account, p_country_code, 'FAKE', 'CAPTURE', 'RENT', p_amount_minor, p_currency, 1,
         CASE WHEN s.c <= 6 THEN 'FAILED' WHEN s.c = 7 THEN 'SUCCEEDED' ELSE 'PENDING' END,
         pg_catalog.format('l0:%s:%s', v_seed, s.i), pg_catalog.format('l0-sent:%s:%s', v_seed, s.i)
    FROM (SELECT i, (i % p_holds_per_vehicle) % 10 AS c
            FROM pg_catalog.generate_series(0, v_holds - 1) AS i) AS s
   WHERE s.c <> 8;
  -- US-023 (0036) : quatre jambes par opération (HOST = montant), comme fixture_operation_legs
  INSERT INTO core.payment_payment_operation_leg (operation_id, leg, org_id, trip_id, country_code, amount_minor)
  SELECT pg_catalog.md5(v_seed || ':p:' || s.i)::uuid, l.leg, p_org_id, NULL, p_country_code,
         CASE WHEN l.leg = 'HOST' THEN p_amount_minor ELSE 0 END
    FROM pg_catalog.generate_series(0, v_holds - 1) AS s(i)
   CROSS JOIN (VALUES ('HOST'), ('INSURER'), ('TAX_THIRD_PARTY'), ('PLATFORM')) AS l(leg)
   WHERE (s.i % p_holds_per_vehicle) % 10 <> 8;

  INSERT INTO core.booking_hold_compensation (id, hold_id, reason, operation_id, action, status)
  SELECT pg_catalog.md5(v_seed || ':c:' || s.i)::uuid,
         pg_catalog.md5(v_seed || ':h:' || s.i)::uuid,
         'SLOT_LOST_AFTER_EXPIRY',
         pg_catalog.md5(v_seed || ':p:' || s.i)::uuid,
         'REFUND_API', 'OPEN'
    FROM pg_catalog.generate_series(0, v_holds - 1) AS s(i)
   WHERE (s.i % p_holds_per_vehicle) % 10 = 7;

  INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, hold_compensation_id)
  SELECT pg_catalog.md5(v_seed || ':p:' || s.i)::uuid,
         pg_catalog.md5(v_seed || ':h:' || s.i)::uuid,
         'COMPENSATION',
         pg_catalog.md5(v_seed || ':c:' || s.i)::uuid
    FROM pg_catalog.generate_series(0, v_holds - 1) AS s(i)
   WHERE (s.i % p_holds_per_vehicle) % 10 = 7;

  RETURN v_holds;
END
$fn$;

-- ANALYZE (sans VACUUM) est permis dans une fonction ; migrator possède les tables.
CREATE FUNCTION test_fixture.l0_analyze()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  ANALYZE core.booking_checkout_hold;
  ANALYZE core.booking_vehicle_occupancy;
  ANALYZE core.payment_payment_operation;
  ANALYZE core.booking_payment_disposition;
  ANALYZE core.booking_hold_compensation;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.l0_ensure_parties(uuid[], uuid, text),
  test_fixture.l0_place_hold(uuid, uuid, uuid, uuid, uuid, text, tstzrange, interval, boolean, integer),
  test_fixture.l0_place_hold_timed(uuid, uuid, uuid, uuid, uuid, text, tstzrange, interval, boolean, integer),
  test_fixture.l0_set_payment_in_flight(uuid, timestamptz),
  test_fixture.l0_seed_expiry_bench(uuid, text, text, bigint, integer, integer, integer),
  test_fixture.l0_analyze()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.l0_ensure_parties(uuid[], uuid, text),
  test_fixture.l0_place_hold(uuid, uuid, uuid, uuid, uuid, text, tstzrange, interval, boolean, integer),
  test_fixture.l0_place_hold_timed(uuid, uuid, uuid, uuid, uuid, text, tstzrange, interval, boolean, integer),
  test_fixture.l0_set_payment_in_flight(uuid, timestamptz),
  test_fixture.l0_seed_expiry_bench(uuid, text, text, bigint, integer, integer, integer),
  test_fixture.l0_analyze()
  TO app_api;
