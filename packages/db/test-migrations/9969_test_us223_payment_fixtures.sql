-- 9969 — fixtures des preuves du paiement par jambes au checkout (US-223, partie 223a, migration
-- 0116). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER, search_path figé ; aucun SQL dynamique) :
--   1. `us223_checkout_acceptance` (migrator) : devis figé engagé au checkout d'un hold de fixture
--      (forme écrite par core.pricing_cmd_freeze_quote puis core.booking_cmd_checkout : montant,
--      jambes, période, validité), SANS passer par ces commandes, qui exigent les interrupteurs de
--      mise en service : les preuves de conversion et de concurrence COMMITENT leurs données (deux
--      sessions) et aucun interrupteur n'est jamais ouvert hors d'une transaction annulée (17 §0.1) ;
--      montants posés par le test, tirés des vecteurs de 08 (jamais de cette fixture) ;
--   2. `us223_trip_price_versions` (migrator) : relecture brute des versions de prix d'un trip
--      (aucun rôle applicatif ne lit pricing_trip_price_version) ;
--   3. `us223_duplicate_leg` (cmd_money_owner, contexte du travailleur payment_command) : seconde
--      ligne de la même jambe d'une opération, que seule une commande d'argent fautive écrirait ;
--      prouve la traduction de payment_operation_leg_pkey sans DETAIL (N-18, L0-08).
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us223_checkout_acceptance(uuid, bigint, text, jsonb,
--   timestamptz, timestamptz), test_fixture.us223_trip_price_versions(uuid),
--   test_fixture.us223_duplicate_leg(uuid, text).

CREATE FUNCTION test_fixture.us223_checkout_acceptance(
  p_hold_id      uuid,
  p_total_minor  bigint,
  p_currency     text,
  p_legs         jsonb,
  p_start        timestamptz,
  p_end          timestamptz
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_quote  uuid := pg_catalog.gen_random_uuid();
  v_guest  uuid;
  v_country text;
  v_tax    bigint := (p_legs ->> 'TAX_THIRD_PARTY')::bigint;
  v_hash   text := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('{}', 'UTF8')), 'hex');
BEGIN
  SELECT h.guest_user_id, h.country_code INTO v_guest, v_country
    FROM core.booking_checkout_hold AS h WHERE h.id = p_hold_id;
  IF v_guest IS NULL THEN
    RAISE EXCEPTION 'us223_checkout_acceptance: hold % unknown', p_hold_id;
  END IF;
  INSERT INTO core.pricing_quote
         (id, guest_user_id, listing_id, country_code, currency, status, engine_version, period,
          billable_days, subtotal_minor, tax_total_minor, tax_third_party_minor, total_minor,
          leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor, leg_platform_minor,
          inputs, inputs_hash, outputs, outputs_hash, frozen_at, expires_at)
  VALUES (v_quote, v_guest, pg_catalog.gen_random_uuid(), v_country, p_currency, 'FROZEN',
          'prc.quote/1', pg_catalog.tstzrange(p_start, p_end, '[)'), 1,
          p_total_minor - v_tax, v_tax, v_tax, p_total_minor,
          (p_legs ->> 'HOST')::bigint, (p_legs ->> 'INSURER')::bigint, v_tax,
          (p_legs ->> 'PLATFORM')::bigint,
          '{}', v_hash, '{}', v_hash, platform.now(), platform.now() + interval '30 minutes');
  INSERT INTO core.booking_checkout_acceptance (hold_id, quote_id, guest_user_id, country_code)
  VALUES (p_hold_id, v_quote, v_guest, v_country);
  RETURN v_quote;
END
$fn$;

CREATE FUNCTION test_fixture.us223_trip_price_versions(p_trip_id uuid)
  RETURNS TABLE (version integer, quote_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.version, v.quote_id
    FROM core.pricing_trip_price_version AS v
   WHERE v.trip_id = p_trip_id
   ORDER BY v.version
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us223_checkout_acceptance(uuid, bigint, text, jsonb, timestamptz, timestamptz),
  test_fixture.us223_trip_price_versions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us223_checkout_acceptance(uuid, bigint, text, jsonb, timestamptz, timestamptz),
  test_fixture.us223_trip_price_versions(uuid) TO app_api, app_worker;

-- Seconde ligne d'une jambe existante, écrite comme une commande d'argent fautive : propriétaire
-- cmd_money_owner (droits et politiques de 0028), contexte du travailleur payment_command posé ici.
CREATE FUNCTION test_fixture.us223_duplicate_leg(p_operation_id uuid, p_leg text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM pg_catalog.set_config('app.actor_kind', 'WORKER', true);
  PERFORM pg_catalog.set_config('app.worker_name', 'payment_command', true);
  INSERT INTO core.payment_payment_operation_leg
         (operation_id, leg, org_id, trip_id, country_code, amount_minor)
  SELECT l.operation_id, l.leg, l.org_id, l.trip_id, l.country_code, l.amount_minor
    FROM core.payment_payment_operation_leg AS l
   WHERE l.operation_id = p_operation_id AND l.leg = p_leg;
END
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us223_duplicate_leg(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us223_duplicate_leg(uuid, text) TO app_worker;
GRANT CREATE ON SCHEMA test_fixture TO cmd_money_owner;
ALTER FUNCTION test_fixture.us223_duplicate_leg(uuid, text) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_money_owner;
