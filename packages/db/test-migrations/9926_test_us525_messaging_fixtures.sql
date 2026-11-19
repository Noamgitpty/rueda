-- 9926 — fixtures des preuves de la messagerie par trip et du signal du marché gris (US-525,
-- migration 0161). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle :
--   1. test_fixture.us525_trip (SECURITY DEFINER sous migrator) : trip BOOKED tel que le checkout
--      et la conversion l'écrivent (corps de `us214_trip`, 9948), sur un compte d'hôte NOUVEAU ou
--      EXISTANT (deux véhicules d'un même compte : RLS-9) ; voyageur et titulaire nommés ;
--   2. test_fixture.us525_person / us525_member (SECURITY DEFINER sous migrator) : personne
--      inscrite (visiteur sans trip) et appartenance d'un co-hôte (portée, statut, permissions
--      unitaires du titulaire) ;
--   3. test_fixture.us525_message / us525_review_items (SECURITY DEFINER sous migrator) :
--      relecture de la preuve (texte reçu, texte servi, statut, signaux) et des éléments de la file
--      GRAY_MARKET d'un fil ; aucun rôle applicatif ne lit ces tables ;
--   4. test_fixture.us525_force_write (SECURITY DEFINER sous migrator, propriétaire des tables) :
--      écriture DIRECTE d'un message (suppression, réécriture du texte, masquage) : preuve que la
--      garde refuse même hors des rôles applicatifs ;
--   5. test_fixture.us525_public_text_offers (SECURITY DEFINER sous catalog_cmd_owner, comme les
--      sondes de 9929 sous cmd_param_owner) : la règle des textes publics de l'hôte de 0155, lue
--      avec les droits de son propriétaire : preuve que les motifs MESSAGE ne s'y appliquent pas.
-- Appelées SEULEMENT dans une transaction ANNULÉE. AUCUN interrupteur de mise en service écrit
-- (17 §0.1). Les attendus des tests viennent de 19 US-525, 16 MSG-001 / MSG-007 et 17 §2.3, jamais
-- de ces fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us525_trip(text, uuid, uuid, text, text,
--   timestamptz, timestamptz), test_fixture.us525_person(text),
--   test_fixture.us525_member(uuid, text, uuid[], text, text, text[]),
--   test_fixture.us525_message(uuid), test_fixture.us525_review_items(uuid),
--   test_fixture.us525_force_write(uuid, text), test_fixture.us525_public_text_offers(text) ;
--   REVOKE USAGE ON SCHEMA test_fixture FROM catalog_cmd_owner.

CREATE FUNCTION test_fixture.us525_trip(
  p_country     text,
  p_org         uuid,
  p_guest       uuid,
  p_guest_first text,
  p_host_first  text,
  p_start       timestamptz,
  p_end         timestamptz
)
  RETURNS TABLE (trip_id uuid, org_id uuid, vehicle_id uuid, holder_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_org      uuid := COALESCE(p_org, pg_catalog.gen_random_uuid());
  v_vehicle  uuid := pg_catalog.gen_random_uuid();
  v_listing  uuid := pg_catalog.gen_random_uuid();
  v_quote    uuid := pg_catalog.gen_random_uuid();
  v_hold     uuid := pg_catalog.gen_random_uuid();
  v_hold_occ uuid := pg_catalog.gen_random_uuid();
  v_trip     uuid := pg_catalog.gen_random_uuid();
  v_holder   uuid;
  v_currency text;
  v_tz       text;
  v_total    bigint := 1000;
  v_hash     text := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('{}', 'UTF8')), 'hex');
BEGIN
  SELECT k.currency::text, k.time_zone INTO v_currency, v_tz
    FROM core.config_country AS k WHERE k.code::text = p_country;
  INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale,
                                     status)
  VALUES (p_guest, pg_catalog.format('guest-%s@fixture.test', p_guest), p_guest_first, 'Pérez',
          'es', 'ACTIVE')
  ON CONFLICT (id) DO NOTHING;
  IF p_org IS NULL THEN
    v_holder := test_fixture.create_org(v_org, p_country, 'ACTIVE');
    UPDATE core.iam_user_account SET legal_first_name = p_host_first, legal_last_name = 'Gómez'
     WHERE id = v_holder;
  ELSE
    SELECT o.holder_user_id INTO v_holder FROM core.iam_organization AS o WHERE o.id = v_org;
  END IF;
  PERFORM test_fixture.ensure_catalog_vehicle(v_vehicle, v_org, p_country);
  INSERT INTO core.catalog_listing (id, vehicle_id, org_id, country_code, status, daily_price_minor,
                                    currency, mileage_mode, included_km_per_day,
                                    extra_km_price_minor, created_by)
  VALUES (v_listing, v_vehicle, v_org, p_country, 'DRAFT', v_total, v_currency, 'UNLIMITED', NULL,
          NULL, v_holder);
  UPDATE core.catalog_listing SET status = 'LISTED' WHERE id = v_listing;
  INSERT INTO core.pricing_quote
         (id, guest_user_id, listing_id, country_code, currency, status, engine_version, period,
          billable_days, subtotal_minor, tax_total_minor, tax_third_party_minor, total_minor,
          leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor, leg_platform_minor,
          inputs, inputs_hash, outputs, outputs_hash, frozen_at, expires_at)
  VALUES (v_quote, p_guest, v_listing, p_country, v_currency, 'FROZEN', 'prc.quote/1',
          pg_catalog.tstzrange(p_start, p_end, '[)'), 1, v_total, 0, 0, v_total, v_total, 0, 0, 0,
          '{}', v_hash, '{}', v_hash, platform.now(), platform.now() + interval '30 minutes');
  INSERT INTO core.pricing_quote_line (quote_id, seq, line_type, amount_minor, tax_group, rate_bps,
                                       tax_minor, third_party)
  VALUES (v_quote, 1, 'TRIP_PRICE', v_total, NULL, NULL, 0, false);
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
  RETURN QUERY SELECT v_trip, v_org, v_vehicle, v_holder;
END
$fn$;

CREATE FUNCTION test_fixture.us525_person(p_first text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.iam_user_account (id, email, legal_first_name, legal_last_name, preferred_locale,
                                     status)
  VALUES (v_id, pg_catalog.format('person-%s@fixture.test', v_id), p_first, 'Fixture', 'es',
          'ACTIVE');
  RETURN v_id;
END
$fn$;

-- Co-hôte d'un compte d'hôte : portée, statut (INVITED, ACTIVE, REMOVED), permissions unitaires
CREATE FUNCTION test_fixture.us525_member(p_org uuid, p_role text, p_scope uuid[], p_status text,
                                          p_first text, p_overrides text[])
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := test_fixture.us525_person(p_first);
BEGIN
  INSERT INTO core.iam_membership (id, user_id, org_id, role, vehicle_scope, permission_overrides,
                                   status)
  VALUES (pg_catalog.gen_random_uuid(), v_id, p_org, p_role, p_scope, p_overrides, p_status);
  RETURN v_id;
END
$fn$;

CREATE FUNCTION test_fixture.us525_message(p_message uuid)
  RETURNS TABLE (body text, body_masked text, status text, author_role text, author_user_id uuid,
                 flags jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT m.body, m.body_masked, m.status, m.author_role, m.author_user_id,
         COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'kind', f.kind, 'matched', pg_catalog.to_jsonb(f.matched),
                            'reviewItem', f.review_item_id IS NOT NULL)
                          ORDER BY f.kind)
                     FROM core.messaging_message_flag AS f WHERE f.message_id = m.id), '[]'::jsonb)
    FROM core.messaging_message AS m
   WHERE m.id = p_message
$fn$;

-- Éléments de la file GRAY_MARKET du fil d'un trip
CREATE FUNCTION test_fixture.us525_review_items(p_trip uuid)
  RETURNS TABLE (queue text, subject_type text, country_code text, status text, flag_items bigint)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.queue, i.subject_type, i.country_code, i.status,
         (SELECT pg_catalog.count(*) FROM core.messaging_message_flag AS f
            JOIN core.messaging_message AS m ON m.id = f.message_id
           WHERE m.thread_id = th.id AND f.review_item_id = i.id)
    FROM core.messaging_message_thread AS th
    JOIN core.support_review_queue_item AS i
      ON i.subject_type = 'MESSAGE_THREAD' AND i.subject_id = th.id
   WHERE th.trip_id = p_trip
   ORDER BY i.created_at, i.id
$fn$;

-- Écriture directe d'un message par le propriétaire des tables (liste fermée, sans SQL dynamique)
CREATE FUNCTION test_fixture.us525_force_write(p_message uuid, p_what text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_what
    WHEN 'DELETE' THEN
      DELETE FROM core.messaging_message WHERE id = p_message;
    WHEN 'REWRITE' THEN
      UPDATE core.messaging_message SET body_masked = 'réécrit' WHERE id = p_message;
    WHEN 'HIDE' THEN
      UPDATE core.messaging_message SET hidden_at = platform.now() WHERE id = p_message;
    WHEN 'DELETE_FLAG' THEN
      DELETE FROM core.messaging_message_flag WHERE message_id = p_message;
    ELSE
      RAISE EXCEPTION 'us525_force_write: % inconnu', p_what;
  END CASE;
END
$fn$;

-- Règle des textes publics de l'hôte (0155), avec les droits de son propriétaire
CREATE FUNCTION test_fixture.us525_public_text_offers(p_text text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.catalog_text_offers_offplatform_payment(p_text)
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us525_trip(text, uuid, uuid, text, text, timestamptz,
                                               timestamptz),
  test_fixture.us525_person(text), test_fixture.us525_member(uuid, text, uuid[], text, text, text[]),
  test_fixture.us525_message(uuid), test_fixture.us525_review_items(uuid),
  test_fixture.us525_force_write(uuid, text), test_fixture.us525_public_text_offers(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us525_trip(text, uuid, uuid, text, text, timestamptz,
                                                  timestamptz),
  test_fixture.us525_person(text), test_fixture.us525_member(uuid, text, uuid[], text, text, text[]),
  test_fixture.us525_message(uuid), test_fixture.us525_review_items(uuid),
  test_fixture.us525_force_write(uuid, text), test_fixture.us525_public_text_offers(text)
  TO app_api;

-- droits posés AVANT le changement de propriétaire (l'ACL suit la fonction)
GRANT USAGE ON SCHEMA test_fixture TO catalog_cmd_owner;
GRANT CREATE ON SCHEMA test_fixture TO catalog_cmd_owner;
ALTER FUNCTION test_fixture.us525_public_text_offers(text) OWNER TO catalog_cmd_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM catalog_cmd_owner;
