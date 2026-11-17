-- 9963 — fixtures des preuves du contrat de location et de sa signature (US-211, partie 211a,
-- migration 0122). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. `us211_world` : monde complet d'un trip BOOKED tel que le checkout et la conversion
--      l'écrivent (hôte nommé, véhicule et plaque, lieu de remise, annonce LISTED, devis figé
--      prc.quote/3 avec protection et distance, hold de checkout, trip et ses occupations,
--      conducteur approuvé, contrat d'assureur en vigueur, caution du pays) ; valeurs posées par le
--      test, tirées de 08 et des oracles, jamais de cette fixture. Appelée SEULEMENT dans une
--      transaction ANNULÉE (aucune donnée de monde validée, aucun interrupteur écrit) ;
--   2. `us211_document` : version de contrat posée sans le travailleur (empreinte fournie), pour
--      les preuves de la signature (données validées, deux sessions) et de la garde de remise ;
--   3. `us211_sign` : contrat signé par le voyageur (forme écrite par la commande de signature),
--      pour les preuves qui amènent un trip à IN_PROGRESS (US-207, US-218, L0 d'occupation) ;
--   4. relectures (`us211_documents`, `us211_signatures`, `us211_events`, `us211_segment_contract`,
--      `us211_holder`) des lignes qu'aucun rôle applicatif ne lit ;
--   5. `us211_try_update` : écriture interdite d'une version enregistrée (immuabilité).
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us211_* (voir la liste des droits en fin de fichier).

CREATE FUNCTION test_fixture.us211_world(
  p_country      text,
  p_guest        uuid,
  p_guest_first  text,
  p_guest_last   text,
  p_guest_locale text,
  p_host_first   text,
  p_host_last    text,
  p_plate        text,
  p_title_holder text,
  p_start        timestamptz,
  p_end          timestamptz,
  p_lines        jsonb,
  p_level        text,
  p_included_km  integer,
  p_extra_km     bigint,
  p_deductibles  jsonb,
  p_rc           bigint,
  p_deposit      bigint
)
  RETURNS TABLE (trip_id uuid, org_id uuid, vehicle_id uuid, holder_id uuid, quote_id uuid,
                 hold_id uuid, listing_id uuid)
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
  v_trip     uuid := pg_catalog.gen_random_uuid();
  v_insurer  uuid := platform.uuid_v7();
  v_holder   uuid;
  v_currency text;
  v_tz       text;
  v_total    bigint;
  v_hash     text := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('{}', 'UTF8')), 'hex');
BEGIN
  SELECT k.currency::text, k.time_zone INTO v_currency, v_tz
    FROM core.config_country AS k WHERE k.code::text = p_country;
  SELECT pg_catalog.sum((e.x ->> 'amountMinor')::bigint) INTO v_total
    FROM pg_catalog.jsonb_array_elements(p_lines) AS e(x);

  -- voyageur (nom légal, langue)
  INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale,
                                     status)
  VALUES (p_guest, pg_catalog.format('guest-%s@fixture.test', p_guest), p_guest_first, p_guest_last,
          p_guest_locale, 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;
  -- hôte titulaire nommé, véhicule, lieu, annonce LISTED avec distance incluse
  v_holder := test_fixture.create_org(v_org, p_country, 'ACTIVE');
  UPDATE core.iam_user_account SET legal_first_name = p_host_first, legal_last_name = p_host_last
   WHERE id = v_holder;
  PERFORM test_fixture.ensure_catalog_vehicle(v_vehicle, v_org, p_country);
  UPDATE core.catalog_vehicle
     SET plate = p_plate, make_text = 'Toyota', model_text = 'Yaris', year = 2022,
         title_holder = p_title_holder, value_class = 'STANDARD'
   WHERE id = v_vehicle;
  INSERT INTO core.catalog_listing (id, vehicle_id, org_id, country_code, status, daily_price_minor,
                                    currency, mileage_mode, included_km_per_day,
                                    extra_km_price_minor, created_by)
  VALUES (v_listing, v_vehicle, v_org, p_country, 'DRAFT', v_total, v_currency, 'INCLUDED',
          GREATEST(p_included_km / 3, 1), p_extra_km, v_holder);
  UPDATE core.catalog_listing SET status = 'LISTED' WHERE id = v_listing;

  -- devis figé prc.quote/3 (protection et distance figées), lignes sans taxe
  INSERT INTO core.pricing_quote
         (id, guest_user_id, listing_id, country_code, currency, status, engine_version, period,
          billable_days, subtotal_minor, tax_total_minor, tax_third_party_minor, total_minor,
          leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor, leg_platform_minor,
          inputs, inputs_hash, outputs, outputs_hash, frozen_at, expires_at, protection_level,
          host_plan_code, mileage_mode, included_km, extra_km_price_minor)
  VALUES (v_quote, p_guest, v_listing, p_country, v_currency, 'FROZEN', 'prc.quote/3',
          pg_catalog.tstzrange(p_start, p_end, '[)'), 3, v_total, 0, 0, v_total, v_total, 0, 0, 0,
          '{}', v_hash, '{}', v_hash, platform.now(), platform.now() + interval '30 minutes',
          p_level, 'ESTANDAR', 'INCLUDED', p_included_km, p_extra_km);
  INSERT INTO core.pricing_quote_line (quote_id, seq, line_type, amount_minor, tax_group, rate_bps,
                                       tax_minor, third_party)
  SELECT v_quote, e.n::integer, e.x ->> 'type', (e.x ->> 'amountMinor')::bigint, NULL, NULL, 0, false
    FROM pg_catalog.jsonb_array_elements(p_lines) WITH ORDINALITY AS e(x, n);

  -- hold de checkout (occupation de hold hors de la période du trip) puis trip BOOKED
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          ref_type, ref_id)
  VALUES (v_hold_occ, v_vehicle, v_org, p_country, 'HOLD', 'CHECKOUT',
          pg_catalog.tstzrange(p_start - interval '400 days', p_start - interval '399 days', '[)'),
          true, platform.now() + interval '10 minutes', 'HOLD', v_hold);
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
          expires_at, quote_id)
  VALUES (v_hold, p_guest, v_vehicle, v_org, p_country, v_hold_occ, 'CHECKOUT', 'ACTIVE',
          platform.now() + interval '10 minutes', v_quote);
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, ref_type, ref_id)
  VALUES (pg_catalog.gen_random_uuid(), v_vehicle, v_org, p_country, 'TRIP', 'CHECKOUT',
          pg_catalog.tstzrange(p_start, p_end, '[)'), true, 'TRIP', v_trip);
  INSERT INTO core.booking_trip (id, public_ref, guest_user_id, org_id, vehicle_id, listing_id,
                                 country_code, currency, timezone, scheduled_start, scheduled_end,
                                 booked_at, status, source_hold_id)
  VALUES (v_trip, pg_catalog.format('K-%s', pg_catalog.upper(pg_catalog.left(v_trip::text, 8))),
          p_guest, v_org, v_vehicle, v_listing, p_country, v_currency, v_tz, p_start, p_end,
          platform.now(), 'BOOKED', v_hold);
  INSERT INTO core.booking_guest_occupancy (id, guest_user_id, period, active, trip_id)
  VALUES (pg_catalog.gen_random_uuid(), p_guest, pg_catalog.tstzrange(p_start, p_end, '[)'), true,
          v_trip);
  UPDATE core.booking_trip_driver SET approved_at = platform.now()
   WHERE trip_id = v_trip AND role = 'PRIMARY';

  -- contrat de l'assureur partenaire en vigueur depuis la veille, caution du pays
  INSERT INTO core.settlement_insurer (id, country_code, name, kind, license_ref, status)
  VALUES (v_insurer, p_country, 'Aseguradora de prueba', 'INSURER', 'SSRP-TEST-211', 'ACTIVE');
  INSERT INTO core.settlement_insurer_contract (id, insurer_id, country_code, version,
                                                vehicle_eligibility, signed_at, valid_from,
                                                currency, rc_amount_minor, deductibles,
                                                exclusions)
  VALUES (platform.uuid_v7(), v_insurer, p_country,
          (SELECT COALESCE(pg_catalog.max(c.version), 0) + 1
             FROM core.settlement_insurer_contract AS c WHERE c.country_code = p_country),
          pg_catalog.jsonb_build_object('maxVehicleAgeYears', 30,
                                        'valueClasses', pg_catalog.jsonb_build_array('STANDARD'),
                                        'usages', pg_catalog.jsonb_build_array('PARTICULAR')),
          platform.now() - interval '1 day', platform.now() - interval '1 day', v_currency, p_rc,
          p_deductibles,
          '{"es":"Exclusiones de prueba","en":"Test exclusions","fr":"Exclusions de test","pt-BR":"Exclusões de teste"}'::jsonb);
  INSERT INTO core.catalog_deposit_policy (id, country_code, value_class, amount_minor, currency,
                                           accepted_methods, covered_items, valid_from)
  VALUES (pg_catalog.gen_random_uuid(), p_country, 'STANDARD', p_deposit, v_currency,
          ARRAY['CARD_PREAUTH']::text[], ARRAY['FUEL']::text[], platform.now() - interval '1 day');

  RETURN QUERY SELECT v_trip, v_org, v_vehicle, v_holder, v_quote, v_hold, v_listing;
END
$fn$;

-- Version de contrat posée sans le travailleur : version suivante du segment n° 1, remplace la
-- précédente ; gabarits communs en vigueur ; partie nominative minimale.
CREATE FUNCTION test_fixture.us211_document(p_trip uuid, p_sha256 bytea, p_trigger text)
  RETURNS TABLE (document_id uuid, version integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_seg  uuid;
  v_prev record;
  v_id   uuid := platform.uuid_v7();
  v_es   uuid;
  v_en   uuid;
  v_cc   text;
BEGIN
  SELECT s.id, t.country_code INTO v_seg, v_cc
    FROM core.booking_trip_segment AS s JOIN core.booking_trip AS t ON t.id = s.trip_id
   WHERE s.trip_id = p_trip AND s.seq = 1;
  SELECT d.id, d.version INTO v_prev FROM core.contract_generated_document AS d
   WHERE d.subject_id = v_seg
     AND NOT EXISTS (SELECT 1 FROM core.contract_generated_document AS n WHERE n.supersedes_id = d.id);
  SELECT t.id INTO v_es FROM core.contract_document_template AS t
   WHERE t.kind = 'RENTAL_CONTRACT' AND t.country_code IS NULL AND t.locale = 'es'
   ORDER BY t.version DESC LIMIT 1;
  SELECT t.id INTO v_en FROM core.contract_document_template AS t
   WHERE t.kind = 'RENTAL_CONTRACT' AND t.country_code IS NULL AND t.locale = 'en'
   ORDER BY t.version DESC LIMIT 1;
  INSERT INTO core.contract_generated_document
         (id, kind, template_id, courtesy_template_id, subject_type, subject_id, trip_id,
          country_code, locale, version, supersedes_id, trigger_key, terms, derived,
          renderer_version, sha256)
  VALUES (v_id, 'RENTAL_CONTRACT', v_es, v_en, 'TRIP_SEGMENT', v_seg, p_trip, v_cc, 'en',
          COALESCE(v_prev.version, 0) + 1, v_prev.id, p_trigger, '{"schema":"ctr.rental/1"}',
          '{"brand":"Marca"}', 'ctr.pdf/1', p_sha256);
  INSERT INTO core.contract_document_party (document_id, identity, body)
  VALUES (v_id, '{"guestName":"Fixture"}', '[{"s":"p","t":"fixture"}]');
  UPDATE core.booking_trip_segment SET contract_document_id = v_id WHERE id = v_seg;
  RETURN QUERY SELECT v_id, COALESCE(v_prev.version, 0) + 1;
END
$fn$;

-- Contrat signé par le voyageur (forme de core.booking_cmd_sign_contract ; sceau de test)
CREATE FUNCTION test_fixture.us211_sign(p_trip uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_doc   uuid;
  v_sha   bytea;
  v_guest uuid;
BEGIN
  SELECT t.guest_user_id INTO v_guest FROM core.booking_trip AS t WHERE t.id = p_trip;
  SELECT d.id, d.sha256 INTO v_doc, v_sha FROM core.contract_generated_document AS d
   WHERE d.trip_id = p_trip
     AND NOT EXISTS (SELECT 1 FROM core.contract_generated_document AS n WHERE n.supersedes_id = d.id);
  IF v_doc IS NULL THEN
    SELECT x.document_id INTO v_doc
      FROM test_fixture.us211_document(p_trip, pg_catalog.sha256(pg_catalog.convert_to(p_trip::text, 'UTF8')),
                                       'fixture:' || p_trip::text) AS x;
    SELECT d.sha256 INTO v_sha FROM core.contract_generated_document AS d WHERE d.id = v_doc;
  END IF;
  INSERT INTO core.contract_signature (document_id, trip_id, signer_user_id, signer_role, method,
                                       document_sha256, seal_sha256, c2_withheld)
  VALUES (v_doc, p_trip, v_guest, 'GUEST', 'CLICKWRAP', v_sha,
          pg_catalog.sha256(pg_catalog.convert_to('seal:' || v_doc::text, 'UTF8')), true)
  ON CONFLICT (document_id, signer_user_id) DO NOTHING;
  RETURN v_doc;
END
$fn$;

CREATE FUNCTION test_fixture.us211_documents(p_trip uuid)
  RETURNS TABLE (id uuid, version integer, supersedes_id uuid, trigger_key text, locale text,
                 terms jsonb, derived jsonb, sha256 text, renderer_version text, identity jsonb,
                 body jsonb, template_locale text, courtesy_locale text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.id, d.version, d.supersedes_id, d.trigger_key, d.locale, d.terms, d.derived,
         pg_catalog.encode(d.sha256, 'hex'), d.renderer_version, p.identity, p.body, te.locale,
         tc.locale
    FROM core.contract_generated_document AS d
    JOIN core.contract_document_party AS p ON p.document_id = d.id
    JOIN core.contract_document_template AS te ON te.id = d.template_id
    JOIN core.contract_document_template AS tc ON tc.id = d.courtesy_template_id
   WHERE d.trip_id = p_trip
   ORDER BY d.version
$fn$;

CREATE FUNCTION test_fixture.us211_signatures(p_trip uuid)
  RETURNS TABLE (id uuid, document_id uuid, signer_user_id uuid, signer_role text, method text,
                 signed_at timestamptz, document_sha256 text, seal_sha256 text, ip_enc bytea,
                 user_agent_enc bytea, c2_withheld boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.id, s.document_id, s.signer_user_id, s.signer_role, s.method, s.signed_at,
         pg_catalog.encode(s.document_sha256, 'hex'), pg_catalog.encode(s.seal_sha256, 'hex'),
         s.ip_enc, s.user_agent_enc, s.c2_withheld
    FROM core.contract_signature AS s
   WHERE s.trip_id = p_trip
   ORDER BY s.signed_at, s.id
$fn$;

CREATE FUNCTION test_fixture.us211_events(p_trip uuid)
  RETURNS TABLE (type text, aggregate_id uuid, aggregate_version bigint, actor_role text,
                 actor_user_id uuid, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_id, e.aggregate_version::bigint, e.actor_role, e.actor_user_id,
         e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_type = 'contract_document' AND e.partition_key = p_trip::text
   ORDER BY e.aggregate_version, e.type
$fn$;

CREATE FUNCTION test_fixture.us211_segment_contract(p_trip uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.contract_document_id FROM core.booking_trip_segment AS s
   WHERE s.trip_id = p_trip AND s.seq = 1
$fn$;

-- Gabarits RENTAL_CONTRACT en vigueur de la portée commune (quatre langues)
CREATE FUNCTION test_fixture.us211_templates()
  RETURNS TABLE (locale text, body_md text, draft boolean, authoritative boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.locale, t.body_md, t.legal_review_ref IS NULL, t.is_authoritative
    FROM core.contract_document_template AS t
   WHERE t.kind = 'RENTAL_CONTRACT' AND t.country_code IS NULL
     AND t.version = (SELECT max(x.version) FROM core.contract_document_template AS x
                       WHERE x.kind = 'RENTAL_CONTRACT' AND x.country_code IS NULL)
   ORDER BY t.locale
$fn$;

-- Titulaire du compte d'hôte d'un trip (session de l'hôte ouverte par le test)
CREATE FUNCTION test_fixture.us211_holder(p_trip uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.holder_user_id FROM core.booking_trip AS t
    JOIN core.iam_organization AS o ON o.id = t.org_id
   WHERE t.id = p_trip
$fn$;

-- Écriture interdite d'une version (le trigger d'immuabilité refuse, même sous migrator)
CREATE FUNCTION test_fixture.us211_try_update(p_document uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.contract_generated_document
     SET sha256 = pg_catalog.sha256(pg_catalog.convert_to('tampered', 'UTF8'))
   WHERE id = p_document
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us211_world(text, uuid, text, text, text, text, text, text, text,
                                                timestamptz, timestamptz, jsonb, text, integer,
                                                bigint, jsonb, bigint, bigint),
  test_fixture.us211_document(uuid, bytea, text), test_fixture.us211_sign(uuid),
  test_fixture.us211_documents(uuid), test_fixture.us211_signatures(uuid),
  test_fixture.us211_events(uuid), test_fixture.us211_segment_contract(uuid),
  test_fixture.us211_holder(uuid), test_fixture.us211_templates(), test_fixture.us211_try_update(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us211_world(text, uuid, text, text, text, text, text, text,
                                                   text, timestamptz, timestamptz, jsonb, text,
                                                   integer, bigint, jsonb, bigint, bigint),
  test_fixture.us211_document(uuid, bytea, text), test_fixture.us211_sign(uuid),
  test_fixture.us211_documents(uuid), test_fixture.us211_signatures(uuid),
  test_fixture.us211_events(uuid), test_fixture.us211_segment_contract(uuid),
  test_fixture.us211_holder(uuid), test_fixture.us211_templates(), test_fixture.us211_try_update(uuid)
  TO app_api, app_worker;
