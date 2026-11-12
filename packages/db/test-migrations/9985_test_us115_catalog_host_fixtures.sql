-- 9985 — fixtures des preuves des lieux, véhicules et annonces de l'hôte (US-115, migration 0067).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` ; la base `rueda_test_*_prod` garde la clé étrangère de 0067
-- sans relais (test l0-us115 : un véhicule absent du catalogue y est refusé).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. Relais du catalogue pour les fixtures HISTORIQUES (9001, 9002, 9300, 9310, 9880, aides
--      TypeScript) qui posent des occupations, des holds et des trips sur des identifiants de
--      véhicule libres, écrits avant que le catalogue n'existe : avant l'insertion d'une ligne,
--      le véhicule est inscrit au catalogue pour le compte et le pays de la ligne s'il n'y est pas
--      encore (lieu « Fixture » du compte, plaque dérivée de l'identifiant). Un véhicule déjà au
--      catalogue d'un AUTRE compte n'est jamais réattribué : la clé étrangère refuse la ligne.
--      `test_fixture.register_vehicle` (9750) inscrit aussi le véhicule au catalogue quand son
--      compte est de ce pays (un enregistrement incohérent à dessein reste au seul registre).
--   2. Statut forcé d'un compte d'hôte (activation : US-123) et d'une annonce (publication :
--      US-118), pour éprouver la soumission, la projection publique et les gardes de réservation
--      sur la VRAIE table.
--   3. Relecture brute d'une ligne (colonnes que les rôles applicatifs ne lisent pas) : les
--      attendus viennent de 19 US-115 et de 17 §3.2.3, jamais de cette relecture.
--
-- Retour arrière : DROP TRIGGER us115_catalog_relay ON core.booking_vehicle_occupancy,
--   core.booking_checkout_hold, core.booking_trip ; DROP FUNCTION
--   test_fixture.us115_catalog_relay(), test_fixture.ensure_catalog_vehicle(uuid, uuid, text),
--   test_fixture.us115_set_org_status(uuid, text), test_fixture.us115_set_listing_status(uuid,
--   text), test_fixture.us115_location_row(uuid), test_fixture.us115_vehicle_row(uuid),
--   test_fixture.us115_listing_row(uuid), test_fixture.us115_photo_files(uuid),
--   test_fixture.us115_market_variant(text), test_fixture.us115_trip_paid(uuid),
--   test_fixture.us115_price_ceiling_version(text, text, jsonb) ; DELETE des
--   variantes « US115 market » (sous migrator, garde de 0063 levée) ; recréer
--   test_fixture.register_vehicle de 9750.

-- 1. Relais du catalogue -------------------------------------------------------------------------
CREATE FUNCTION test_fixture.ensure_catalog_vehicle(p_vehicle_id uuid, p_org_id uuid, p_country text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_holder uuid;
  v_tz     text;
  v_loc    uuid;
BEGIN
  IF p_vehicle_id IS NULL OR p_org_id IS NULL OR p_country IS NULL
     OR EXISTS (SELECT 1 FROM core.catalog_vehicle WHERE id = p_vehicle_id) THEN
    RETURN;
  END IF;
  SELECT o.holder_user_id INTO v_holder
    FROM core.iam_organization o
   WHERE o.id = p_org_id AND o.country_code = p_country;
  SELECT k.time_zone INTO v_tz FROM core.config_country k WHERE k.code::text = p_country;
  IF v_holder IS NULL OR v_tz IS NULL THEN
    RETURN;
  END IF;
  SELECT l.id INTO v_loc
    FROM core.catalog_location l
   WHERE l.org_id = p_org_id AND l.place_label = 'Fixture'
   ORDER BY l.created_at, l.id
   LIMIT 1;
  IF v_loc IS NULL THEN
    v_loc := pg_catalog.gen_random_uuid();
    INSERT INTO core.catalog_location (id, org_id, country_code, kind, place_label, address_line, city,
                                       timezone, created_by)
    VALUES (v_loc, p_org_id, p_country, 'HOME', 'Fixture', 'Fixture 1', 'Fixture', v_tz, v_holder);
  END IF;
  INSERT INTO core.catalog_vehicle (id, org_id, country_code, home_location_id, timezone, plate,
                                    make_text, model_text, year, transmission, seats, fuel_type,
                                    created_by)
  VALUES (p_vehicle_id, p_org_id, p_country, v_loc, v_tz,
          'T' || pg_catalog.upper(pg_catalog.left(pg_catalog.replace(p_vehicle_id::text, '-', ''), 11)),
          'Fixture', 'Fixture', 2020, 'MANUAL', 5, 'GASOLINE', v_holder)
  ON CONFLICT DO NOTHING;
END
$fn$;

CREATE FUNCTION test_fixture.us115_catalog_relay()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM test_fixture.ensure_catalog_vehicle(NEW.vehicle_id, NEW.org_id, NEW.country_code);
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us115_catalog_relay() FROM PUBLIC;

CREATE TRIGGER us115_catalog_relay BEFORE INSERT ON core.booking_vehicle_occupancy
  FOR EACH ROW EXECUTE FUNCTION test_fixture.us115_catalog_relay();
CREATE TRIGGER us115_catalog_relay BEFORE INSERT ON core.booking_checkout_hold
  FOR EACH ROW EXECUTE FUNCTION test_fixture.us115_catalog_relay();
CREATE TRIGGER us115_catalog_relay BEFORE INSERT ON core.booking_trip
  FOR EACH ROW EXECUTE FUNCTION test_fixture.us115_catalog_relay();

CREATE OR REPLACE FUNCTION test_fixture.register_vehicle(p_vehicle_id uuid, p_org_id uuid, p_country_code text)
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
  -- US-115 : au catalogue aussi, si le compte est bien de ce pays (sinon : registre seul)
  PERFORM test_fixture.ensure_catalog_vehicle(p_vehicle_id, p_org_id, p_country_code);
END
$fn$;

-- 2. Statuts forcés --------------------------------------------------------------------------------
CREATE FUNCTION test_fixture.us115_set_org_status(p_org uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_organization SET status = p_status WHERE id = p_org
$fn$;

CREATE FUNCTION test_fixture.us115_set_listing_status(p_listing uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.catalog_listing SET status = p_status WHERE id = p_listing
$fn$;

-- 3. Relectures brutes -------------------------------------------------------------------------------
CREATE FUNCTION test_fixture.us115_location_row(p_id uuid)
  RETURNS TABLE (org_id uuid, country_code text, kind text, place_label text, address_line text,
                 city text, area_label text, geo_lat numeric, geo_lng numeric,
                 geo_public_lat numeric, geo_public_lng numeric, timezone text, created_by uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.org_id, l.country_code, l.kind, l.place_label, l.address_line, l.city, l.area_label,
         l.geo[1]::numeric, l.geo[0]::numeric, l.geo_public[1]::numeric, l.geo_public[0]::numeric,
         l.timezone, l.created_by
    FROM core.catalog_location l WHERE l.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us115_vehicle_row(p_id uuid)
  RETURNS TABLE (org_id uuid, country_code text, home_location_id uuid, plate text, vin text,
                 variant_id uuid, value_class text, plate_category text, eligibility_status text,
                 insurer_eligibility text, created_by uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.org_id, v.country_code, v.home_location_id, v.plate, v.vin, v.variant_id, v.value_class,
         v.plate_category, v.eligibility_status, v.insurer_eligibility, v.created_by
    FROM core.catalog_vehicle v WHERE v.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us115_listing_row(p_id uuid)
  RETURNS TABLE (vehicle_id uuid, org_id uuid, country_code text, status text,
                 daily_price_minor bigint, currency text, mileage_mode text,
                 included_km_per_day integer, extra_km_price_minor bigint, instant_book boolean,
                 submitted_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.vehicle_id, l.org_id, l.country_code, l.status, l.daily_price_minor, l.currency,
         l.mileage_mode, l.included_km_per_day, l.extra_km_price_minor, l.instant_book,
         l.submitted_at
    FROM core.catalog_listing l WHERE l.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us115_photo_files(p_listing uuid)
  RETURNS TABLE (photo_id uuid, photo_position smallint, status text, bucket text, storage_key text,
                 mime text, classification text, source text, uploader_user_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p.id, p.position, p.status, f.bucket, f.storage_key, f.mime, f.classification, f.source,
         f.uploader_user_id
    FROM core.catalog_listing_photo p
    JOIN core.audit_file_asset f ON f.id = p.file_id
   WHERE p.listing_id = p_listing
   ORDER BY p.position
$fn$;

-- Variante propre à un marché (aucune dans la graine v1) : copie d'une variante ACTIVE dont le
-- modèle et la marque sont ACTIVE, marquée du pays donné (réserve de la revue d'US-113).
CREATE FUNCTION test_fixture.us115_market_variant(p_country text)
  RETURNS TABLE (variant_id uuid, year_from integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v record;
BEGIN
  SELECT x.* INTO v
    FROM core.catalog_vehicle_variant x
    JOIN core.catalog_vehicle_model o ON o.id = x.model_id AND o.status = 'ACTIVE'
    JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
   WHERE x.status = 'ACTIVE' AND x.market IS NULL
   ORDER BY x.id
   LIMIT 1;
  INSERT INTO core.catalog_vehicle_variant (id, model_id, year_from, year_to, trim_name,
                                            transmission, fuel_type, drive, seats, doors,
                                            value_class, market, status, source, license_note)
  VALUES (pg_catalog.gen_random_uuid(), v.model_id, v.year_from, v.year_to, 'US115 market',
          v.transmission, v.fuel_type, v.drive, v.seats, v.doors, v.value_class, p_country,
          'ACTIVE', 'OPS_CURATED', 'fixture de test US-115')
  ON CONFLICT ON CONSTRAINT catalog_vehicle_variant_natural_key DO NOTHING;
  RETURN QUERY
    SELECT x.id, x.year_from FROM core.catalog_vehicle_variant x
     WHERE x.model_id = v.model_id AND x.trim_name = 'US115 market' AND x.market = p_country
       AND x.year_from = v.year_from AND x.transmission = v.transmission
       AND x.fuel_type = v.fuel_type AND x.drive = v.drive;
END
$fn$;

-- Montant payé d'un trip (opérations du trip) : le prix figé au trip, relu après un changement
-- de prix de l'annonce (19 US-115 critère 3).
CREATE FUNCTION test_fixture.us115_trip_paid(p_trip uuid)
  RETURNS bigint
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(pg_catalog.sum(o.amount_minor), 0)::bigint
    FROM core.payment_payment_operation o WHERE o.trip_id = p_trip
$fn$;

-- Nouvelle version d'un paramètre de plafond du prix (price_ceiling_*) valable à platform.now(),
-- écrite dans la transaction de l'appelant, qui l'ANNULE ensuite (comme config_flag_order de
-- 9750) : prouve PARAM_MISSING (fail-closed) pour une valeur nulle ou mal formée. Clés fermées.
CREATE FUNCTION test_fixture.us115_price_ceiling_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key NOT IN ('price_ceiling_daily_minor', 'price_ceiling_extra_km_minor') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- valid_from absent : la garde le pose à platform.now() (jamais rétroactif, 16 ADM-014)
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-115 (annulé)');
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us115_market_variant(text), test_fixture.us115_trip_paid(uuid),
  test_fixture.us115_price_ceiling_version(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us115_market_variant(text), test_fixture.us115_trip_paid(uuid),
  test_fixture.us115_price_ceiling_version(text, text, jsonb) TO app_api, app_worker;

REVOKE ALL ON FUNCTION test_fixture.ensure_catalog_vehicle(uuid, uuid, text),
  test_fixture.us115_set_org_status(uuid, text), test_fixture.us115_set_listing_status(uuid, text),
  test_fixture.us115_location_row(uuid), test_fixture.us115_vehicle_row(uuid),
  test_fixture.us115_listing_row(uuid), test_fixture.us115_photo_files(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.ensure_catalog_vehicle(uuid, uuid, text),
  test_fixture.us115_set_org_status(uuid, text), test_fixture.us115_set_listing_status(uuid, text),
  test_fixture.us115_location_row(uuid), test_fixture.us115_vehicle_row(uuid),
  test_fixture.us115_listing_row(uuid), test_fixture.us115_photo_files(uuid) TO app_api, app_worker;
