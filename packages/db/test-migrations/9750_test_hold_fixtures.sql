-- 9750 — fixtures des commandes de hold (US-023). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` ; la base `rueda_test_*_prod` garde la définition de
-- production de core.booking_vehicle_party (aucun véhicule connu : toute pose refusée).
--
--   1. Registre de véhicules de TEST (test_fixture.vehicle_party) et remplacement de
--      core.booking_vehicle_party : depuis US-115 (0066), d'abord la lecture de production du
--      catalogue (véhicule et annonce LISTED), puis un véhicule enregistré par
--      test_fixture.register_vehicle, sinon le compte et le pays de ses occupations existantes
--      (véhicules des fixtures 9001, 9300) ; inconnu sinon. Le véhicule enregistré est aussi
--      inscrit au catalogue (test_fixture.ensure_catalog_vehicle, fixture 9985) quand son compte
--      est bien de ce pays (clé étrangère de 0066). SECURITY DEFINER sous
--      migrator (comme les autres fixtures) : cmd_hold_owner l'exécute sans aucun droit sur
--      test_fixture.
--   2. test_fixture.l0_cmd_place_hold_timed : la pose RÉELLE (core.booking_cmd_place_hold),
--      instrumentée pour la série C1 transactionnelle de L0-02 (instants serveur d'obtention du
--      verrou du véhicule et de fin de commande, comme l0_place_hold_timed de 9002). SECURITY
--      INVOKER : elle s'exécute sous app_api, avec le contexte de la session ; les verrous pris
--      avant le bloc EXCEPTION survivent à l'échec de la commande, comme dans la forme
--      transactionnelle réelle.
--
--   3. à 5. comptes d'hôte de statut choisi, version annulée de flagged_booking_payment_order,
--      écriture forcée d'une colonne gardée (voir chaque fonction).
--
-- Retour arrière : DROP FUNCTION test_fixture.register_vehicle(uuid, uuid, text),
--   test_fixture.l0_cmd_place_hold_timed(uuid, timestamptz, timestamptz),
--   test_fixture.create_org(uuid, text, text), test_fixture.config_flag_order(text, text),
--   test_fixture.hold_force_write(uuid, text) ; DROP TABLE
--   test_fixture.vehicle_party ; réappliquer la définition de 0037 de core.booking_vehicle_party.

CREATE TABLE test_fixture.vehicle_party (
  vehicle_id   uuid PRIMARY KEY,
  org_id       uuid NOT NULL,
  country_code text NOT NULL
);
REVOKE ALL ON test_fixture.vehicle_party FROM PUBLIC;

CREATE FUNCTION test_fixture.register_vehicle(p_vehicle_id uuid, p_org_id uuid, p_country_code text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM test_fixture.ensure_party(NULL, p_org_id, p_country_code);
  INSERT INTO test_fixture.vehicle_party (vehicle_id, org_id, country_code)
  VALUES (p_vehicle_id, p_org_id, p_country_code)
  ON CONFLICT (vehicle_id) DO NOTHING;
END
$fn$;

CREATE OR REPLACE FUNCTION core.booking_vehicle_party(p_vehicle_id uuid)
  RETURNS TABLE (org_id uuid, country_code text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT x.org_id, x.country_code
    FROM (-- US-115 (0066) : d'abord la définition de production (véhicule du catalogue et annonce
          -- LISTED), puis le registre de test, puis le compte des occupations existantes
          SELECT v.org_id, v.country_code, 0 AS rank
            FROM core.catalog_vehicle v
            JOIN core.catalog_listing l ON l.vehicle_id = v.id
           WHERE v.id = p_vehicle_id AND l.status = 'LISTED'
          UNION ALL
          SELECT r.org_id, r.country_code, 1 AS rank
            FROM test_fixture.vehicle_party r
           WHERE r.vehicle_id = p_vehicle_id
          UNION ALL
          SELECT vo.org_id, vo.country_code, 2 AS rank
            FROM core.booking_vehicle_occupancy vo
           WHERE vo.vehicle_id = p_vehicle_id) AS x
   ORDER BY x.rank
   LIMIT 1
$fn$;

COMMENT ON FUNCTION core.booking_vehicle_party(uuid) IS
  'VERSION DE TEST (test-migrations/9750) : catalogue (annonce LISTED), sinon registre de test, '
  'sinon compte des occupations.';

CREATE FUNCTION test_fixture.l0_cmd_place_hold_timed(
  p_vehicle_id uuid,
  p_start      timestamptz,
  p_end        timestamptz
)
  RETURNS text
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_locked_at timestamptz;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || app.actor_id()::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || p_vehicle_id::text, 0));
  v_locked_at := platform.now();
  BEGIN
    PERFORM core.booking_cmd_place_hold(p_vehicle_id, p_start, p_end, false);
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

-- 3. Compte d'hôte de statut choisi, titulaire renvoyé (auto-réservation, hôte non activé).
CREATE FUNCTION test_fixture.create_org(p_org_id uuid, p_country_code text, p_status text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_holder uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale, status)
  VALUES (v_holder, pg_catalog.format('holder-%s@fixture.test', v_holder), 'Fixture', 'Host', 'en', 'ACTIVE');
  INSERT INTO core.iam_organization (id, holder_user_id, country_code, status)
  VALUES (p_org_id, v_holder, p_country_code, p_status);
  INSERT INTO core.iam_membership (id, user_id, org_id, role, status)
  VALUES (pg_catalog.gen_random_uuid(), v_holder, p_org_id, 'P2P_HOST', 'ACTIVE');
  RETURN v_holder;
END
$fn$;

-- 4. Version de flagged_booking_payment_order valable à platform.now(), écrite dans la
--    transaction de l'appelant (qui l'ANNULE ensuite : l'inventaire des valeurs de
--    config-country reste celui des graines). Branche PAY_THEN_REVIEW d'UXQ-08. Clé unique.
CREATE FUNCTION test_fixture.config_flag_order(p_country_code text, p_value text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, valid_from, change_reason)
  VALUES ('flagged_booking_payment_order', p_country_code, 'COUNTRY', pg_catalog.to_jsonb(p_value),
          platform.now(), 'test US-023 (annulé)');
END
$fn$;

-- 5. Écriture FORCÉE d'une colonne gardée du hold par le propriétaire des tables (migrator) :
--    prouve que le trigger hold_guarded_columns et no_delete refusent même hors des rôles
--    applicatifs (RLS-13, défense en profondeur). Colonnes par liste fermée, sans SQL dynamique.
CREATE FUNCTION test_fixture.hold_force_write(p_hold_id uuid, p_what text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_what
    WHEN 'expires_at' THEN
      UPDATE core.booking_checkout_hold SET expires_at = expires_at + interval '1 day' WHERE id = p_hold_id;
    WHEN 'vehicle_id' THEN
      UPDATE core.booking_checkout_hold SET vehicle_id = pg_catalog.gen_random_uuid() WHERE id = p_hold_id;
    WHEN 'guest_user_id' THEN
      UPDATE core.booking_checkout_hold SET guest_user_id = pg_catalog.gen_random_uuid() WHERE id = p_hold_id;
    WHEN 'review_required' THEN
      UPDATE core.booking_checkout_hold SET review_required = NOT review_required WHERE id = p_hold_id;
    WHEN 'created_at' THEN
      UPDATE core.booking_checkout_hold SET created_at = created_at - interval '1 hour' WHERE id = p_hold_id;
    WHEN 'payment_in_flight_until' THEN
      UPDATE core.booking_checkout_hold
         SET payment_in_flight_until = payment_in_flight_until + interval '1 hour' WHERE id = p_hold_id;
    WHEN 'delete' THEN
      DELETE FROM core.booking_checkout_hold WHERE id = p_hold_id;
    ELSE
      RAISE EXCEPTION 'hold_force_write: %', p_what;
  END CASE;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.register_vehicle(uuid, uuid, text),
  test_fixture.l0_cmd_place_hold_timed(uuid, timestamptz, timestamptz),
  test_fixture.create_org(uuid, text, text), test_fixture.config_flag_order(text, text),
  test_fixture.hold_force_write(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.register_vehicle(uuid, uuid, text),
  test_fixture.l0_cmd_place_hold_timed(uuid, timestamptz, timestamptz),
  test_fixture.create_org(uuid, text, text), test_fixture.config_flag_order(text, text),
  test_fixture.hold_force_write(uuid, text) TO app_api, app_worker;
