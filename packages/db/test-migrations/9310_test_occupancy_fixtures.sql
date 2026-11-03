-- 9310 — fixtures des preuves structurelles d'US-022 (revue QA US-022, constat 1). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : écrire une occupation ou un hold SANS passer par les commandes de 0032, pour atteindre
-- les contraintes que la pré-vérification des commandes masque :
--   - occ_insert_raw : occupation (HOST_BLOCK ou HOLD) avec le compte et le pays choisis par le
--     test ⇒ prouve `occupancy_vehicle_single_org` (23P01) ;
--   - hold_insert_raw : hold rattaché à une occupation existante, avec le véhicule, le compte et
--     le pays choisis par le test ⇒ prouve `checkout_hold_occupancy_party_fk` (23503).
-- C'est le chemin qu'emprunteront cmd_place_hold (US-023) et les fixtures de pose, sans contrôle
-- préalable. SECURITY DEFINER sous migrator (propriétaire des tables, politique migrator_all) ;
-- la transaction appelante reste sous app_api. Aucun SQL dynamique, search_path figé.
--
-- Retour arrière : DROP FUNCTION test_fixture.occ_insert_raw(uuid, uuid, uuid, text, text, tstzrange),
--   test_fixture.hold_insert_raw(uuid, uuid, uuid, uuid, uuid, text);

CREATE FUNCTION test_fixture.occ_insert_raw(
  p_id           uuid,
  p_vehicle_id   uuid,
  p_org_id       uuid,
  p_country_code text,
  p_kind         text,
  p_period       tstzrange
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at)
  VALUES (p_id, p_vehicle_id, p_org_id, p_country_code, p_kind,
          CASE WHEN p_kind = 'HOLD' THEN 'CHECKOUT' ELSE 'MANUAL' END, p_period, true,
          CASE WHEN p_kind = 'HOLD' THEN platform.now() + pg_catalog.make_interval(mins => 10) END);
END
$fn$;

CREATE FUNCTION test_fixture.hold_insert_raw(
  p_hold_id      uuid,
  p_occupancy_id uuid,
  p_guest_id     uuid,
  p_vehicle_id   uuid,
  p_org_id       uuid,
  p_country_code text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM test_fixture.ensure_party(p_guest_id, NULL, NULL);
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status, expires_at)
  VALUES (p_hold_id, p_guest_id, p_vehicle_id, p_org_id, p_country_code, p_occupancy_id,
          'CHECKOUT', 'ACTIVE', platform.now() + pg_catalog.make_interval(mins => 10));
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.occ_insert_raw(uuid, uuid, uuid, text, text, tstzrange),
  test_fixture.hold_insert_raw(uuid, uuid, uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.occ_insert_raw(uuid, uuid, uuid, text, text, tstzrange),
  test_fixture.hold_insert_raw(uuid, uuid, uuid, uuid, uuid, text) TO app_api;
