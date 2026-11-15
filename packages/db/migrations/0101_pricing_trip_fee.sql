-- 0101 — PRC : trip fee du voyageur recalculé par la base dans le devis figé.
-- US-704 ; 19 US-704 (« Given le trip A, When le devis est calculé, Then la ligne TRIP_FEE (F 18,00)
-- est présente et va à la jambe PLATFORM (TJ01) ») ; 16 PRC-012 ; 08 BR-PRICE-06 (barème [NOUS]
-- appliqué tel quel, Q-004 : 15 % (≤ 6 j), 12 % (7–29 j), 8 % (≥ 30 j), minimum du pays), E7
-- (F entièrement dans PLATFORM) ; 17 §7.2 (`trip_fee_schedule`, failMode BLOCK) ; suivi des revues
-- d'US-202 (la commande ne rejouait que TRIP_PRICE, TRIP_FEE était pris tel quel de l'API) ;
-- pré-mortem du lot 2 : L2-PM-03, L2-PM-06, L2-PM-14 ; ADR-129 (complète ADR-125).
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-129, PROPOSÉS) :
--   - moteur `prc.quote/2` : TRIP_FEE est une ligne CALCULÉE, comme TRIP_PRICE ; la demande n'en
--     porte jamais (QUOTE_MISMATCH) ; `prc.quote/1` (F fourni par l'appelant) n'est plus figé ;
--   - la base recalcule F avec SON barème `trip_fee_schedule[pays]` en vigueur à platform.now()
--     (`core.pricing_trip_fee`, même arithmétique que `tripFeeOf` du moteur et que 08 :
--     roundHalfUp de `settlement_verify_round`, minimum, tranche par jours facturables) ; tout écart
--     des sorties de l'API ⇒ QUOTE_MISMATCH, rien d'écrit ; barème absent ou mal formé ⇒
--     QUOTE_UNAVAILABLE (fail-closed, jamais un trip fee nul par défaut) ;
--   - F suit la règle fiscale de sa ligne (`tax_line_config`) et reste dans la jambe PLATFORM
--     (complément) : il n'entre jamais dans hostFromGuest (08 A02) ;
--   - aucune constante de pays : barème, devise et taxes lus des tables de configuration.
--
-- Expand / contract : fonction et valeur de contrainte AJOUTÉES ; commande remplacée (même
-- signature, mêmes propriétaire et droits) ; lecture de cmd_money_owner élargie à une clé.
--
-- Retour arrière :
--   rejouer la définition de core.pricing_cmd_freeze_quote de 0100 (CREATE OR REPLACE, sous
--     cmd_money_owner, CREATE accordé le temps du remplacement) ;
--   DROP FUNCTION core.pricing_trip_fee(numeric, numeric, jsonb) ;
--   ALTER POLICY cmd_money_quote_read ON core.config_param_value USING (key IN ('grace_minutes',
--     'max_trip_days', 'host_default_plan', 'host_share_pct', 'delivery_share_pct',
--     'extras_share_pct')) ;
--   ALTER TABLE core.pricing_quote DROP CONSTRAINT pricing_quote_engine_known, ADD CONSTRAINT
--     pricing_quote_engine_known CHECK (engine_version IN ('prc.quote/1')) (si aucun devis /2).

-- 1. Version du moteur ----------------------------------------------------------------------------
-- `prc.quote/1` reste admis pour l'historique (aucun devis /1 n'a été figé hors tests : aucune route
-- avant US-208) ; la commande ne fige plus que `prc.quote/2`.
ALTER TABLE core.pricing_quote DROP CONSTRAINT pricing_quote_engine_known;
ALTER TABLE core.pricing_quote ADD CONSTRAINT pricing_quote_engine_known
  CHECK (engine_version IN ('prc.quote/1', 'prc.quote/2'));
COMMENT ON TABLE core.pricing_quote IS
  'Devis figé (16 PRC-025) : entrées et sorties canoniques du moteur prc.quote/2 (trip fee calculé, '
  'US-704), empreintes SHA-256, montants rejoués par la base. Écrit par '
  'core.pricing_cmd_freeze_quote seulement ; seule transition FROZEN → SUPERSEDED. US-202, US-704, '
  'ADR-125, ADR-129.';

-- 2. Lecture du barème par le rejeu (au plus juste : une clé de plus) ------------------------------
ALTER POLICY cmd_money_quote_read ON core.config_param_value
  USING (key IN ('grace_minutes', 'max_trip_days', 'host_default_plan', 'host_share_pct',
                 'delivery_share_pct', 'extras_share_pct', 'trip_fee_schedule'));

-- 3. Trip fee (fonction pure, SECURITY INVOKER, sans lecture de table) ---------------------------
-- max(roundHalfUp(P × rateBps / 10 000), minMinor), rateBps de la première tranche dont maxDays
-- couvre les jours facturables (`null` : sans borne, dernière tranche seulement). Barème mal formé
-- (pas d'objet, aucune tranche, maxDays non entier ou non croissant, `null` avant la fin, rateBps
-- hors de 0..10 000, minMinor absent ou négatif) ou durée non couverte ⇒ NULL.
CREATE FUNCTION core.pricing_trip_fee(p_trip_price numeric, p_days numeric, p_schedule jsonb)
  RETURNS numeric
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_tier  jsonb;
  v_n     integer;
  v_i     integer := 0;
  v_prev  numeric := 0;
  v_max   numeric;
  v_bps   numeric;
  v_rate  numeric;
  v_min   numeric;
BEGIN
  IF p_trip_price IS NULL OR p_days IS NULL OR p_days < 1
     OR pg_catalog.jsonb_typeof(p_schedule) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p_schedule -> 'tiers') IS DISTINCT FROM 'array' THEN
    RETURN NULL;
  END IF;
  v_min := core.pricing_minor(p_schedule -> 'minMinor');
  v_n := pg_catalog.jsonb_array_length(p_schedule -> 'tiers');
  IF v_min IS NULL OR v_min < 0 OR v_n = 0 THEN
    RETURN NULL;
  END IF;
  FOR v_tier IN SELECT t.value FROM pg_catalog.jsonb_array_elements(p_schedule -> 'tiers') AS t LOOP
    v_i := v_i + 1;
    IF pg_catalog.jsonb_typeof(v_tier) IS DISTINCT FROM 'object'
       OR pg_catalog.jsonb_typeof(v_tier -> 'rateBps') IS DISTINCT FROM 'number'
       OR (v_tier ->> 'rateBps') !~ '^[0-9]{1,5}$' THEN
      RETURN NULL;
    END IF;
    v_bps := (v_tier ->> 'rateBps')::numeric;
    IF v_bps > 10000 THEN
      RETURN NULL;
    END IF;
    IF pg_catalog.jsonb_typeof(v_tier -> 'maxDays') = 'null' THEN
      IF v_i <> v_n THEN
        RETURN NULL;
      END IF;
      v_max := NULL;
    ELSIF pg_catalog.jsonb_typeof(v_tier -> 'maxDays') = 'number'
          AND (v_tier ->> 'maxDays') ~ '^[0-9]{1,9}$' THEN
      v_max := (v_tier ->> 'maxDays')::numeric;
      IF v_max <= v_prev THEN
        RETURN NULL;
      END IF;
      v_prev := v_max;
    ELSE
      RETURN NULL;
    END IF;
    IF v_rate IS NULL AND (v_max IS NULL OR p_days <= v_max) THEN
      v_rate := v_bps;
    END IF;
  END LOOP;
  IF v_rate IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN GREATEST(core.settlement_verify_round(p_trip_price, v_rate, 10000), v_min);
END
$fn$;
REVOKE ALL ON FUNCTION core.pricing_trip_fee(numeric, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.pricing_trip_fee(numeric, numeric, jsonb) TO cmd_money_owner;

-- 4. Commande remplacée (sous son propriétaire, CREATE accordé le temps du remplacement, ADR-044
-- amendé ; propriétaire, EXECUTE et entrée de security-definer-allowlist.json inchangés) --------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 4.1 Figer un devis : rejeu complet par la base, trip fee compris (16 PRC-025, PRC-012, L2-PM-03).
CREATE OR REPLACE FUNCTION core.pricing_cmd_freeze_quote(p_token_hash bytea, p_listing_id uuid,
                                              p_inputs text, p_inputs_hash text,
                                              p_outputs text, p_outputs_hash text)
  RETURNS TABLE (outcome text, quote_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  -- ordre des lignes : celui du moteur (QUOTE_LINE_TYPES), indices du vérificateur de 0054
  c_types   CONSTANT text[] := ARRAY['TRIP_PRICE', 'PROMO_PLATFORM', 'PROMO_HOST', 'TRIP_FEE',
                                     'PROTECTION', 'EXTRAS', 'ENHANCED_ROADSIDE',
                                     'ADDITIONAL_DRIVER_FEE', 'YOUNG_DRIVER_FEE', 'DELIVERY_FEE'];
  v_user    uuid;
  l         record;
  v_in      jsonb;
  v_out     jsonb;
  v_req     jsonb;
  v_start   numeric;
  v_end     numeric;
  v_grace   numeric;
  v_max     numeric;
  v_days    numeric;
  v_plan    jsonb;
  v_host    numeric[];
  v_deliv   numeric[];
  v_extras  numeric[];
  v_fee     numeric;
  v_amounts numeric[] := ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]::numeric[];
  v_taxes   numeric[] := ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]::numeric[];
  v_groups  text[]    := ARRAY[NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL]::text[];
  v_rates   integer[] := ARRAY[NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL]::integer[];
  v_third   boolean[] := ARRAY[false, false, false, false, false, false, false, false, false,
                               false]::boolean[];
  v_key     text;
  v_value   jsonb;
  v_i       integer;
  v_cfg     record;
  v_sub     numeric := 0;
  v_tax     numeric := 0;
  v_tax3    numeric := 0;
  v_total   numeric;
  v_hfg     numeric;
  v_out_lines jsonb := '[]'::jsonb;
  v_id      uuid := pg_catalog.gen_random_uuid();
  v_seq     integer := 0;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT * INTO l FROM core.catalog_public_listing(p_listing_id) AS p;
  IF l.listing_id IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;

  -- empreintes et forme des documents canoniques (frozen.ts)
  IF p_inputs IS NULL OR p_outputs IS NULL OR p_inputs_hash IS NULL OR p_outputs_hash IS NULL
     OR core.pricing_digest(E'rueda.quote.inputs/1\n', p_inputs) <> p_inputs_hash
     OR core.pricing_digest(E'rueda.quote.outputs/1\n', p_outputs) <> p_outputs_hash THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  BEGIN
    v_in := p_inputs::jsonb;
    v_out := p_outputs::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END;
  v_req := v_in -> 'request';
  v_start := core.pricing_ms(v_req -> 'startAtMs');
  v_end := core.pricing_ms(v_req -> 'endAtMs');
  IF pg_catalog.jsonb_typeof(v_req) IS DISTINCT FROM 'object' OR v_start IS NULL OR v_end IS NULL
     OR v_end <= v_start
     OR pg_catalog.jsonb_typeof(v_req -> 'lines') IS DISTINCT FROM 'object'
     OR (v_out ->> 'engineVersion') IS DISTINCT FROM 'prc.quote/2'
     OR (v_out ->> 'currency') IS DISTINCT FROM l.currency
     OR core.pricing_minor(v_req -> 'dailyRate') IS DISTINCT FROM l.daily_price_minor::numeric THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  -- un devis ne se fige que pour une période à venir
  IF pg_catalog.to_timestamp(v_start / 1000) <= platform.now() THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- paramètres du pays de l'annonce, en vigueur à platform.now()
  v_grace := core.pricing_ms(core.pricing_param('grace_minutes', l.country_code));
  v_max := core.pricing_ms(core.pricing_param('max_trip_days', l.country_code));
  v_plan := core.pricing_param('host_default_plan', l.country_code);
  IF pg_catalog.jsonb_typeof(v_plan) = 'string' THEN
    v_host := core.pricing_ratio(core.pricing_param('host_share_pct', l.country_code)
                                 -> (v_plan #>> '{}'));
  END IF;
  v_deliv := COALESCE(core.pricing_ratio(core.pricing_param('delivery_share_pct', l.country_code)),
                      v_host);
  v_extras := COALESCE(core.pricing_ratio(core.pricing_param('extras_share_pct', l.country_code)),
                       v_host);
  IF v_grace IS NULL OR v_grace < 0 OR v_max IS NULL OR v_max < 1 OR v_host IS NULL THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- jours facturables : max(1, ceil((fin − début − tolérance) / 24 h)) (17 §2.6, TA07)
  v_days := GREATEST(1, -core.settlement_verify_floor_div(-(v_end - v_start - v_grace * 60000),
                                                          86400000));
  IF v_days > v_max THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;
  IF core.pricing_ms(v_out -> 'billableDays') IS DISTINCT FROM v_days THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  -- lignes : prix du trip et trip fee calculés ici, les autres lues de la demande (ni TRIP_PRICE
  -- ni TRIP_FEE fournis : L2-PM-03, US-704)
  IF (v_req -> 'lines') ?| ARRAY['TRIP_PRICE', 'TRIP_FEE'] THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  FOR v_key, v_value IN SELECT * FROM pg_catalog.jsonb_each(v_req -> 'lines') LOOP
    v_i := pg_catalog.array_position(c_types, v_key);
    IF v_i IS NULL OR core.pricing_minor(v_value) IS NULL THEN
      RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
      RETURN;
    END IF;
    v_amounts[v_i] := core.pricing_minor(v_value);
  END LOOP;
  v_amounts[1] := l.daily_price_minor::numeric * v_days;
  -- trip fee (US-704 ; 08 BR-PRICE-06 ; 16 PRC-012) : max(roundHalfUp(P × taux de la tranche),
  -- minimum), barème trip_fee_schedule du pays en vigueur ; absent ou mal formé ⇒ QUOTE_UNAVAILABLE
  v_fee := core.pricing_trip_fee(v_amounts[1], v_days,
                                 core.pricing_param('trip_fee_schedule', l.country_code));
  IF v_fee IS NULL THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;
  v_amounts[4] := v_fee;
  FOR v_i IN 2 .. 10 LOOP
    IF v_amounts[v_i] < 0 AND c_types[v_i] NOT IN ('PROMO_PLATFORM', 'PROMO_HOST') THEN
      RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
      RETURN;
    END IF;
  END LOOP;
  -- protection et assistance : part de l'assureur non fixée (contrat, niveau : US-226)
  IF v_amounts[5] <> 0 OR v_amounts[7] <> 0 THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- taxe par ligne selon tax_line_config en vigueur (08 BR-PRICE-12, T43)
  FOR v_i IN 1 .. 10 LOOP
    CONTINUE WHEN v_amounts[v_i] = 0;
    SELECT c.taxable, c.rate_group, c.rate_bps, c.third_party INTO v_cfg
      FROM core.pricing_tax_line_config AS c
     WHERE c.country_code::text = l.country_code AND c.line_type = c_types[v_i]
       AND c.valid_from <= platform.now()
     ORDER BY c.version DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'TAX_CONFIG_MISSING'::text, NULL::uuid;
      RETURN;
    END IF;
    IF v_cfg.taxable THEN
      v_groups[v_i] := v_cfg.rate_group;
      v_rates[v_i] := v_cfg.rate_bps;
      v_taxes[v_i] := core.settlement_verify_round(v_amounts[v_i], v_cfg.rate_bps, 10000);
      v_third[v_i] := v_cfg.third_party;
    END IF;
    v_sub := v_sub + v_amounts[v_i];
    v_tax := v_tax + v_taxes[v_i];
    IF v_third[v_i] THEN
      v_tax3 := v_tax3 + v_taxes[v_i];
    END IF;
    v_out_lines := v_out_lines || pg_catalog.jsonb_build_object(
      'type', c_types[v_i], 'amount', v_amounts[v_i]::text, 'taxGroup', v_groups[v_i],
      'tax', v_taxes[v_i]::text);
  END LOOP;
  v_total := v_sub + v_tax;
  IF v_amounts[1] <= 0 OR v_total <= 0 OR v_total > 9223372036854775807 THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  -- jambes de la capture du total (08 E7) : HOST = hostFromGuest, INSURER = 0 (aucune protection),
  -- TAX_THIRD_PARTY = taxe des groupes third_party, PLATFORM = complément
  v_hfg := core.settlement_verify_host_from_guest(v_amounts, v_host, v_deliv, v_extras);
  IF v_total - v_hfg - v_tax3 < 0 THEN
    RETURN QUERY SELECT 'LEG_AMOUNT_NEGATIVE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- les sorties de l'API doivent être exactement celles du rejeu
  IF (v_out -> 'lines') IS DISTINCT FROM v_out_lines
     OR core.pricing_minor(v_out -> 'subtotal') IS DISTINCT FROM v_sub
     OR core.pricing_minor(v_out -> 'taxTotal') IS DISTINCT FROM v_tax
     OR core.pricing_minor(v_out -> 'taxThirdParty') IS DISTINCT FROM v_tax3
     OR core.pricing_minor(v_out -> 'total') IS DISTINCT FROM v_total
     OR core.pricing_minor(v_out -> 'legs' -> 'HOST') IS DISTINCT FROM v_hfg
     OR core.pricing_minor(v_out -> 'legs' -> 'INSURER') IS DISTINCT FROM 0
     OR core.pricing_minor(v_out -> 'legs' -> 'TAX_THIRD_PARTY') IS DISTINCT FROM v_tax3
     OR core.pricing_minor(v_out -> 'legs' -> 'PLATFORM') IS DISTINCT FROM v_total - v_hfg - v_tax3
  THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO core.pricing_quote (id, guest_user_id, listing_id, country_code, currency,
                                  engine_version, period, billable_days, subtotal_minor,
                                  tax_total_minor, tax_third_party_minor, total_minor,
                                  leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
                                  leg_platform_minor, inputs, inputs_hash, outputs, outputs_hash)
  VALUES (v_id, v_user, p_listing_id, l.country_code, l.currency, 'prc.quote/2',
          pg_catalog.tstzrange(pg_catalog.to_timestamp(v_start / 1000),
                               pg_catalog.to_timestamp(v_end / 1000), '[)'),
          v_days::integer, v_sub::bigint, v_tax::bigint, v_tax3::bigint, v_total::bigint,
          v_hfg::bigint, 0, v_tax3::bigint, (v_total - v_hfg - v_tax3)::bigint,
          p_inputs, p_inputs_hash, p_outputs, p_outputs_hash);
  FOR v_i IN 1 .. 10 LOOP
    CONTINUE WHEN v_amounts[v_i] = 0;
    v_seq := v_seq + 1;
    INSERT INTO core.pricing_quote_line (quote_id, seq, line_type, amount_minor, tax_group,
                                         rate_bps, tax_minor, third_party)
    VALUES (v_id, v_seq, c_types[v_i], v_amounts[v_i]::bigint, v_groups[v_i], v_rates[v_i],
            v_taxes[v_i]::bigint, v_third[v_i]);
  END LOOP;
  RETURN QUERY SELECT 'DONE'::text, v_id;
END
$fn$;

-- commentaire posé par le propriétaire de la commande
COMMENT ON FUNCTION core.pricing_cmd_freeze_quote(bytea, uuid, text, text, text, text) IS
  'Fige un devis prc.quote/2 du voyageur de la session sur une annonce LISTED : empreintes '
  'vérifiées, devis rejoué par la base avec sa configuration (jours facturables, prix du trip, '
  'trip fee du barème trip_fee_schedule, taxe par ligne, total, jambes) ; tout écart ⇒ '
  'QUOTE_MISMATCH. SECURITY DEFINER, EXECUTE app_api. US-202, US-704 (ADR-125, ADR-129).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

COMMENT ON FUNCTION core.pricing_trip_fee(numeric, numeric, jsonb) IS
  'Trip fee du voyageur : max(roundHalfUp(P × taux de la tranche de durée), minimum) selon le '
  'barème trip_fee_schedule ; barème mal formé ⇒ NULL. US-704 (ADR-129), 08 BR-PRICE-06.';
