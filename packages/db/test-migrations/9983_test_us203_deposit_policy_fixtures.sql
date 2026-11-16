-- 9983 — fixtures des preuves des cartes de résultats (US-203, migration 0105). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique), appelées
-- SEULEMENT dans des transactions de test ANNULÉES :
--   1. `us203_set_deposit_policy` : poser une version de la caution de la plateforme pour un pays
--      et une classe de valeur (`core.catalog_deposit_policy`, 17 §3.2.3), table sans écrivain
--      applicatif en bêta (jalon J-ADM-031). Les montants sont les « valeurs de test du
--      mécanisme » de 08 (T70), jamais des montants recommandés ;
--   2. `us203_trip_occupancy` : occupation TRIP active d'un véhicule (trip confirmé), comme celle
--      que pose la conversion (0006) ; le trip désigné n'existe pas : la vérification différée de
--      I-OCC (au COMMIT) n'est jamais atteinte, la transaction de test étant annulée.
--
-- Retour arrière : DROP FUNCTION test_fixture.us203_set_deposit_policy(text, text, bigint, text,
--   timestamptz), test_fixture.us203_trip_occupancy(uuid, uuid, text, tstzrange).

CREATE FUNCTION test_fixture.us203_set_deposit_policy(p_country text, p_class text,
                                                      p_amount_minor bigint, p_currency text,
                                                      p_valid_from timestamptz DEFAULT NULL)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.catalog_deposit_policy (id, country_code, value_class, amount_minor, currency,
                                           accepted_methods, covered_items, valid_from)
  VALUES (pg_catalog.gen_random_uuid(), p_country, p_class, p_amount_minor, p_currency,
          ARRAY['CARD_PREAUTH'], ARRAY['FUEL', 'CLEANING', 'TOLLS', 'LATE_RETURN'],
          COALESCE(p_valid_from, platform.now()))
  RETURNING id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us203_set_deposit_policy(text, text, bigint, text, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us203_set_deposit_policy(text, text, bigint, text,
                                                                timestamptz) TO app_api;

CREATE FUNCTION test_fixture.us203_trip_occupancy(p_vehicle uuid, p_org uuid, p_country text,
                                                  p_period tstzrange)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, ref_type, ref_id)
  VALUES (pg_catalog.gen_random_uuid(), p_vehicle, p_org, p_country, 'TRIP', 'CHECKOUT', p_period,
          true, 'TRIP', pg_catalog.gen_random_uuid())
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us203_trip_occupancy(uuid, uuid, text, tstzrange) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us203_trip_occupancy(uuid, uuid, text, tstzrange) TO app_api;
