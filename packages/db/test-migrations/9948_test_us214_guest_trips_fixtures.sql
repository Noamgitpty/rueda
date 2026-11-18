-- 9948 — fixtures des preuves de « Mis viajes » et du détail du trip du voyageur (US-214,
-- migration 0134). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   `us214_request` : demande de réservation (hold REQUEST) d'un voyageur EXISTANT, en attente de
--   l'hôte (AWAITING_HOST), telle que la pose (0126) puis la preuve de l'autorisation l'écrivent :
--   hôte nommé, véhicule, lieu, annonce, devis figé, occupation du hold, passage ACTIVE →
--   PAYMENT_IN_FLIGHT → AWAITING_HOST avec l'heure limite (seule écriture que la garde des colonnes
--   admet). Valeurs posées par le test, jamais tirées de cette fixture. Appelée SEULEMENT dans une
--   transaction ANNULÉE. AUCUN interrupteur de mise en service écrit (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us214_request(text, uuid, text, text, text,
--   timestamptz, timestamptz, bigint, timestamptz).

CREATE FUNCTION test_fixture.us214_request(
  p_country    text,
  p_guest      uuid,
  p_host_first text,
  p_host_last  text,
  p_city       text,
  p_start      timestamptz,
  p_end        timestamptz,
  p_total      bigint,
  p_respond_by timestamptz
)
  RETURNS TABLE (hold_id uuid, org_id uuid, vehicle_id uuid, holder_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_org      uuid := pg_catalog.gen_random_uuid();
  v_vehicle  uuid := pg_catalog.gen_random_uuid();
  v_listing  uuid := pg_catalog.gen_random_uuid();
  v_quote    uuid := pg_catalog.gen_random_uuid();
  v_hold     uuid := pg_catalog.gen_random_uuid();
  v_hold_occ uuid := pg_catalog.gen_random_uuid();
  v_holder   uuid;
  v_currency text;
  v_hash     text := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('{}', 'UTF8')), 'hex');
BEGIN
  SELECT k.currency::text INTO v_currency FROM core.config_country AS k
   WHERE k.code::text = p_country;
  v_holder := test_fixture.create_org(v_org, p_country, 'ACTIVE');
  UPDATE core.iam_user_account SET legal_first_name = p_host_first, legal_last_name = p_host_last
   WHERE id = v_holder;
  PERFORM test_fixture.ensure_catalog_vehicle(v_vehicle, v_org, p_country);
  UPDATE core.catalog_vehicle SET make_text = 'Kia', model_text = 'Rio', year = 2021
   WHERE id = v_vehicle;
  UPDATE core.catalog_location AS cl SET city = p_city
    FROM core.catalog_vehicle AS cv
   WHERE cv.id = v_vehicle AND cl.id = cv.home_location_id;
  INSERT INTO core.catalog_listing (id, vehicle_id, org_id, country_code, status, daily_price_minor,
                                    currency, mileage_mode, included_km_per_day,
                                    extra_km_price_minor, created_by)
  VALUES (v_listing, v_vehicle, v_org, p_country, 'DRAFT', p_total, v_currency, 'UNLIMITED', NULL,
          NULL, v_holder);
  UPDATE core.catalog_listing SET status = 'LISTED' WHERE id = v_listing;

  INSERT INTO core.pricing_quote
         (id, guest_user_id, listing_id, country_code, currency, status, engine_version, period,
          billable_days, subtotal_minor, tax_total_minor, tax_third_party_minor, total_minor,
          leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor, leg_platform_minor,
          inputs, inputs_hash, outputs, outputs_hash, frozen_at, expires_at)
  VALUES (v_quote, p_guest, v_listing, p_country, v_currency, 'FROZEN', 'prc.quote/1',
          pg_catalog.tstzrange(p_start, p_end, '[)'), 2, p_total, 0, 0, p_total, p_total, 0, 0, 0,
          '{}', v_hash, '{}', v_hash, platform.now(), platform.now() + interval '30 minutes');

  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          ref_type, ref_id)
  VALUES (v_hold_occ, v_vehicle, v_org, p_country, 'HOLD', 'CHECKOUT',
          pg_catalog.tstzrange(p_start, p_end, '[)'), true, p_respond_by, 'HOLD', v_hold);
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
          expires_at, quote_id)
  VALUES (v_hold, p_guest, v_vehicle, v_org, p_country, v_hold_occ, 'REQUEST', 'ACTIVE',
          platform.now() + interval '10 minutes', v_quote);
  -- autorisation en vol, puis preuve : en attente de l'hôte (heure limite écrite une fois)
  UPDATE core.booking_checkout_hold SET status = 'PAYMENT_IN_FLIGHT' WHERE id = v_hold;
  UPDATE core.booking_checkout_hold
     SET status = 'AWAITING_HOST', request_respond_by = p_respond_by, expires_at = p_respond_by
   WHERE id = v_hold;

  RETURN QUERY SELECT v_hold, v_org, v_vehicle, v_holder;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us214_request(text, uuid, text, text, text, timestamptz,
                                                  timestamptz, bigint, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us214_request(text, uuid, text, text, text, timestamptz,
                                                     timestamptz, bigint, timestamptz)
  TO app_api;
