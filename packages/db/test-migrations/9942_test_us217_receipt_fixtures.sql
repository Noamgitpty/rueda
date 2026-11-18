-- 9942 — Fixtures de TEST d'US-217a (0133, ADR-161) : reçu des gains de l'hôte et du trip fee.
-- Jamais en production (test-migrations/ seulement). SECURITY DEFINER sous migrator (politique
-- migrator_all) ; l'appelant reste sous un rôle de production (L0-05).
--
--   - us217_trip_quote : devis figé (prc.quote/3) rattaché à un trip de fixture comme version de
--     prix n° 1, avec ses lignes typées et leur taxe de ligne, sans passer par
--     core.pricing_cmd_freeze_quote ni le checkout (qui exigent les interrupteurs de mise en
--     service ; aucun interrupteur n'est jamais ouvert, 17 §0.1). Montants, taxes de ligne, plan et
--     part posés par le test, tirés des vecteurs de l'export des oracles (jamais de cette fixture) ;
--     les totaux du devis sont les sommes des lignes reçues, les jambes celles du vecteur de capture.
--
-- Retour arrière : DROP FUNCTION test_fixture.us217_trip_quote(uuid, jsonb, jsonb, text, text);

CREATE FUNCTION test_fixture.us217_trip_quote(
  p_trip_id uuid,
  p_lines   jsonb,   -- [{ "type", "amount", "taxGroup", "rateBps", "tax" }] (montants en texte)
  p_legs    jsonb,   -- { "HOST", "INSURER", "TAX_THIRD_PARTY", "PLATFORM" } (texte)
  p_plan    text,
  p_share   text     -- part de l'hôte figée, « n/d »
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_quote uuid := pg_catalog.gen_random_uuid();
  t       record;
  v_sub   bigint;
  v_tax   bigint;
  v_hash  text := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('{}', 'UTF8')), 'hex');
BEGIN
  SELECT tr.id, tr.guest_user_id, tr.country_code, tr.currency, tr.scheduled_start, tr.scheduled_end
    INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RAISE EXCEPTION 'us217_trip_quote: trip % unknown', p_trip_id;
  END IF;
  SELECT COALESCE(pg_catalog.sum((l ->> 'amount')::bigint), 0),
         COALESCE(pg_catalog.sum((l ->> 'tax')::bigint), 0)
    INTO v_sub, v_tax
    FROM pg_catalog.jsonb_array_elements(p_lines) AS l;
  INSERT INTO core.pricing_quote
         (id, guest_user_id, listing_id, country_code, currency, status, engine_version, period,
          billable_days, subtotal_minor, tax_total_minor, tax_third_party_minor, total_minor,
          leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor, leg_platform_minor,
          inputs, inputs_hash, outputs, outputs_hash, frozen_at, protection_level, host_plan_code)
  VALUES (v_quote, t.guest_user_id, pg_catalog.gen_random_uuid(), t.country_code, t.currency,
          'FROZEN', 'prc.quote/3', pg_catalog.tstzrange(t.scheduled_start, t.scheduled_end, '[)'),
          1, v_sub, v_tax, (p_legs ->> 'TAX_THIRD_PARTY')::bigint, v_sub + v_tax,
          (p_legs ->> 'HOST')::bigint, (p_legs ->> 'INSURER')::bigint,
          (p_legs ->> 'TAX_THIRD_PARTY')::bigint, (p_legs ->> 'PLATFORM')::bigint,
          '{}', v_hash, pg_catalog.jsonb_build_object('hostSharePct', p_share)::text, v_hash,
          platform.now(), 'STANDARD', p_plan);
  INSERT INTO core.pricing_quote_line
         (quote_id, seq, line_type, amount_minor, tax_group, rate_bps, tax_minor, third_party)
  SELECT v_quote, x.ord::integer, x.l ->> 'type', (x.l ->> 'amount')::bigint, x.l ->> 'taxGroup',
         (x.l ->> 'rateBps')::integer, (x.l ->> 'tax')::bigint, false
    FROM pg_catalog.jsonb_array_elements(p_lines) WITH ORDINALITY AS x(l, ord);
  INSERT INTO core.pricing_trip_price_version (trip_id, version, quote_id)
  VALUES (p_trip_id, 1, v_quote);
  RETURN v_quote;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us217_trip_quote(uuid, jsonb, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us217_trip_quote(uuid, jsonb, jsonb, text, text)
  TO app_worker;
