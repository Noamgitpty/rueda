-- 0118 — PRC / CAT : distance figée dans le devis, conditions d'annulation du checkout, fenêtre
-- de dernière minute en paramètre du pays.
-- US-205 (partie 205b) ; 19 US-205 (critère 1 : « gratuite jusqu'au 13/01 10:00 », dernière minute
-- « gratuite pendant 1 h après la réservation » ; critère 2 : « 600 km incluidos » et le même prix
-- du km sur la fiche, le checkout, le contrat et le reçu) ; 16 LST-010, LST-012, PRC-025 ; 08
-- BR-CXL-01 (formulation exécutable : freeUntil = lastMinute ? min(bookedAt + 60 min, start) :
-- start − 24 h), BR-CXL-06, BR-MILEAGE-01 ; 17 §3.2.5 ; ADR-138 (205a), ADR-140 (cette
-- migration). Graine du paramètre : 0117 (générée). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-140, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - distance figée avec le devis : mode, km inclus (km par jour × jours facturables du rejeu) et
--     prix du km supplémentaire de l'annonce, écrits par la commande de gel à partir de l'annonce
--     publiée (jamais du client) ; un devis qui porte la distance dans ses documents canoniques
--     (prc.quote/3, champ `mileage` facultatif) la voit rejouée, tout écart ⇒ QUOTE_MISMATCH ; les
--     devis antérieurs restent lisibles (colonnes NULL : aucune distance promise) ;
--   - lecture du devis figé pour le checkout (`core.pricing_checkout_terms`) : documents canoniques
--     (l'API rejoue le devis et en tire la retenue d'une annulation hors fenêtre par le moteur de
--     règlement unique) et distance figée, pour le seul voyageur de la session ;
--   - annulation de la fiche et du checkout : fenêtre de dernière minute lue du paramètre
--     `last_minute_free_window_minutes` (0117 ; 60 min, PROPOSÉ) et `freeUntil` de dernière minute
--     = min(maintenant + fenêtre, départ) : jamais une annulation gratuite promise après le début ;
--     paramètre absent ⇒ aucune promesse (NULL).
--
-- Expand / contract : colonnes, contrainte et fonction AJOUTÉES ; commande de gel remplacée (même
-- signature, propriétaire et droits) ; `core.catalog_public_terms` supprimée puis recréée (une
-- colonne de retour de plus ; même propriétaire, mêmes droits) ; politique de lecture des
-- paramètres de catalog_cmd_owner élargie.
--
-- Retour arrière :
--   DROP FUNCTION core.pricing_checkout_terms(bytea, uuid) ;
--   rejouer core.pricing_cmd_freeze_quote de 0110 et core.catalog_public_terms de 0115 (DROP puis
--     CREATE) ; recréer la politique catalog_cmd_terms_read de 0115 ;
--   ALTER TABLE core.pricing_quote DROP CONSTRAINT pricing_quote_mileage_complete, DROP COLUMN
--     extra_km_price_minor, DROP COLUMN included_km, DROP COLUMN mileage_mode.

-- 1. Distance figée du devis (17 §3.2.5 `quote`) -------------------------------------------------
ALTER TABLE core.pricing_quote
  ADD COLUMN mileage_mode text
    CONSTRAINT pricing_quote_mileage_mode_valid CHECK (mileage_mode IN ('UNLIMITED', 'INCLUDED')),
  ADD COLUMN included_km integer
    CONSTRAINT pricing_quote_included_km_valid CHECK (included_km >= 1),
  ADD COLUMN extra_km_price_minor bigint
    CONSTRAINT pricing_quote_extra_km_price_valid CHECK (extra_km_price_minor >= 0),
  ADD CONSTRAINT pricing_quote_mileage_complete CHECK (
    (mileage_mode IS NULL AND included_km IS NULL AND extra_km_price_minor IS NULL)
    OR (mileage_mode = 'UNLIMITED' AND included_km IS NULL AND extra_km_price_minor IS NULL)
    OR (mileage_mode = 'INCLUDED' AND included_km IS NOT NULL
        AND extra_km_price_minor IS NOT NULL));
COMMENT ON COLUMN core.pricing_quote.mileage_mode IS
  'Distance de l''annonce figée au gel (16 LST-012) : UNLIMITED ou INCLUDED ; NULL : devis figé '
  'avant US-205b, aucune distance promise. US-205 (ADR-140).';
COMMENT ON COLUMN core.pricing_quote.included_km IS
  'Km inclus sur la période : km par jour de l''annonce × jours facturables du devis (19 US-205 '
  'critère 2) ; NULL si illimité. US-205 (ADR-140).';
COMMENT ON COLUMN core.pricing_quote.extra_km_price_minor IS
  'Prix du km supplémentaire de l''annonce au gel, unités mineures de la devise du devis ; NULL si '
  'illimité. US-205 (ADR-140).';

-- 2. Commande de gel remplacée (sous son propriétaire, CREATE accordé le temps du remplacement ;
-- propriétaire, EXECUTE et entrée de security-definer-allowlist.json inchangés) -----------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;
-- 2.1 Figer un devis : rejeu complet par la base (0110) ; US-205b : distance de l'annonce figée et,
-- si les documents la portent, rejouée.
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
  v_ver     text;
  v_v3      boolean;
  v_start   numeric;
  v_end     numeric;
  v_grace   numeric;
  v_max     numeric;
  v_days    numeric;
  v_plan    jsonb;
  v_vplan   text;
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
  v_rate    numeric;
  v_valid   numeric;
  -- US-226 : protection du voyageur
  v_level   text;
  v_age     numeric;
  v_grid    jsonb;
  v_terms   jsonb;
  v_min     jsonb;
  v_minrank numeric;
  v_rank    numeric;
  v_need    jsonb;
  v_price   numeric[];
  v_daily   numeric;
  v_bound   numeric;
  v_share   numeric[];
  v_ins     numeric := 0;
  -- US-205b : distance de l'annonce figée avec le devis
  v_mil_in  jsonb;
  v_mil_out jsonb;
  v_km      numeric;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- US-208 (N-130) : documents canoniques bornés en taille avant toute empreinte
  IF pg_catalog.octet_length(p_inputs) > 65536 OR pg_catalog.octet_length(p_outputs) > 65536 THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
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
  v_ver := v_out ->> 'engineVersion';
  IF pg_catalog.jsonb_typeof(v_req) IS DISTINCT FROM 'object' OR v_start IS NULL OR v_end IS NULL
     OR v_end <= v_start
     OR pg_catalog.jsonb_typeof(v_req -> 'lines') IS DISTINCT FROM 'object'
     OR v_ver IS NULL OR v_ver NOT IN ('prc.quote/2', 'prc.quote/3')
     OR (v_out ->> 'currency') IS DISTINCT FROM l.currency
     OR core.pricing_minor(v_req -> 'dailyRate') IS DISTINCT FROM l.daily_price_minor::numeric THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  v_v3 := v_ver = 'prc.quote/3';
  -- US-226 : un devis /3 porte un niveau de protection (aucun trip sans protection, 16 PRT-011) et
  -- un âge déclaré entier ou nul ; un devis /2 n'en porte aucun
  IF v_v3 THEN
    IF pg_catalog.jsonb_typeof(v_req -> 'protectionLevel') IS DISTINCT FROM 'string'
       OR (v_req ->> 'protectionLevel') = '' THEN
      RETURN QUERY SELECT 'PROTECTION_LEVEL_REQUIRED'::text, NULL::uuid;
      RETURN;
    END IF;
    v_level := v_req ->> 'protectionLevel';
    IF v_level !~ '^[A-Z][A-Z_]{0,31}$' THEN
      RETURN QUERY SELECT 'PROTECTION_LEVEL_NOT_ELIGIBLE'::text, NULL::uuid;
      RETURN;
    END IF;
    IF pg_catalog.jsonb_typeof(v_req -> 'driverAge') IS NOT DISTINCT FROM 'null'
       OR NOT (v_req ? 'driverAge') THEN
      v_age := NULL;
    ELSE
      v_age := core.pricing_ms(v_req -> 'driverAge');
      IF v_age IS NULL OR v_age < 0 OR v_age > 150 THEN
        RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
        RETURN;
      END IF;
    END IF;
    -- 16 PRT-001 : aucune vente de protection sans contrat d'assureur actif dans le pays
    IF NOT core.config_go_live('insurer_contract_active', l.country_code) THEN
      RETURN QUERY SELECT 'INSURER_CONTRACT_INACTIVE'::text, NULL::uuid;
      RETURN;
    END IF;
  ELSIF (v_req ? 'protectionLevel' AND pg_catalog.jsonb_typeof(v_req -> 'protectionLevel') <> 'null')
        OR (v_req ? 'driverAge' AND pg_catalog.jsonb_typeof(v_req -> 'driverAge') <> 'null') THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  -- un devis ne se fige que pour une période à venir
  IF pg_catalog.to_timestamp(v_start / 1000) <= platform.now() THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- paramètres du pays de l'annonce, en vigueur à platform.now() ; US-226 : plan du véhicule
  -- (devis /3), sinon host_default_plan ; plan absent de host_share_pct ⇒ QUOTE_UNAVAILABLE
  v_grace := core.pricing_ms(core.pricing_param('grace_minutes', l.country_code));
  v_max := core.pricing_ms(core.pricing_param('max_trip_days', l.country_code));
  IF v_v3 THEN
    v_vplan := core.catalog_listing_earnings_plan(p_listing_id);
  END IF;
  v_plan := COALESCE(pg_catalog.to_jsonb(v_vplan),
                     core.pricing_param('host_default_plan', l.country_code));
  IF pg_catalog.jsonb_typeof(v_plan) = 'string' THEN
    v_host := core.pricing_ratio(core.pricing_param('host_share_pct', l.country_code)
                                 -> (v_plan #>> '{}'));
  END IF;
  v_deliv := COALESCE(core.pricing_ratio(core.pricing_param('delivery_share_pct', l.country_code)),
                      v_host);
  v_extras := COALESCE(core.pricing_ratio(core.pricing_param('extras_share_pct', l.country_code)),
                       v_host);
  -- US-208 : durée de validité du devis figé (16 PRC-025 : QUOTE_EXPIRED au-delà) et débit des
  -- devis figés du voyageur (N-130) ; absents ou mal formés ⇒ QUOTE_UNAVAILABLE (BLOCK)
  v_valid := core.pricing_ms(core.pricing_param('quote_validity_minutes', l.country_code));
  v_rate := core.pricing_ms(core.pricing_param('quote_freezes_per_guest_hour', l.country_code));
  IF v_grace IS NULL OR v_grace < 0 OR v_max IS NULL OR v_max < 1 OR v_host IS NULL
     OR v_valid IS NULL OR v_valid < 1 OR v_valid > 1440 OR v_rate IS NULL OR v_rate < 1 THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;
  -- débit : devis figés par ce voyageur sur l'heure glissante, tous véhicules ; deux gels
  -- concurrents du même voyageur l'un après l'autre (verrou de transaction)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pricing_quote:freeze:' || v_user::text, 0));
  IF (SELECT pg_catalog.count(*) FROM core.pricing_quote AS q
       WHERE q.guest_user_id = v_user
         AND q.frozen_at > platform.now() - pg_catalog.make_interval(hours => 1)) >= v_rate THEN
    RETURN QUERY SELECT 'QUOTE_RATE_LIMITED'::text, NULL::uuid;
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

  -- lignes : prix du trip et trip fee calculés ici (et la protection d'un devis /3), les autres
  -- lues de la demande (ni TRIP_PRICE ni TRIP_FEE fournis : L2-PM-03, US-704 ; ni PROTECTION
  -- dans un devis /3 : US-226)
  IF (v_req -> 'lines') ?| ARRAY['TRIP_PRICE', 'TRIP_FEE']
     OR (v_v3 AND (v_req -> 'lines') ? 'PROTECTION') THEN
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
  -- assistance renforcée : non rejouée par la base (aucune grille de prix) ; protection d'un devis
  -- /2 : part de l'assureur non figée
  IF v_amounts[7] <> 0 OR (NOT v_v3 AND v_amounts[5] <> 0) THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- US-226 : protection du voyageur (16 PRC-018, PRT-001, PRT-002, PRT-011 ; 08 BR-PRICE-11, E7)
  IF v_v3 THEN
    v_grid := core.pricing_param('protection_grid', l.country_code);
    IF pg_catalog.jsonb_typeof(v_grid) IS DISTINCT FROM 'object' THEN
      RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
      RETURN;
    END IF;
    -- minimum du pays (absent : niveau de plus petit rang)
    v_min := core.pricing_param('guest_protection_min_level', l.country_code);
    IF v_min IS NULL THEN
      SELECT pg_catalog.min(core.pricing_ms(e.value -> 'rank')) INTO v_minrank
        FROM pg_catalog.jsonb_each(v_grid) AS e;
    ELSIF pg_catalog.jsonb_typeof(v_min) = 'string' THEN
      v_minrank := core.pricing_ms(v_grid -> (v_min #>> '{}') -> 'rank');
    END IF;
    IF v_minrank IS NULL OR v_minrank < 1 THEN
      RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
      RETURN;
    END IF;
    v_terms := v_grid -> v_level;
    IF pg_catalog.jsonb_typeof(v_terms) IS DISTINCT FROM 'object' THEN
      RETURN QUERY SELECT 'PROTECTION_LEVEL_NOT_ELIGIBLE'::text, NULL::uuid;
      RETURN;
    END IF;
    v_rank := core.pricing_ms(v_terms -> 'rank');
    v_price := core.pricing_ratio(v_terms -> 'price');
    v_need := v_terms -> 'minDriverAge';
    IF v_rank IS NULL OR v_rank < 1 OR v_price IS NULL
       OR (pg_catalog.jsonb_typeof(v_need) IS DISTINCT FROM 'null'
           AND core.pricing_ms(v_need) IS NULL) THEN
      RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
      RETURN;
    END IF;
    IF v_rank < v_minrank
       OR (pg_catalog.jsonb_typeof(v_need) = 'number'
           AND (v_age IS NULL OR v_age < core.pricing_ms(v_need))) THEN
      RETURN QUERY SELECT 'PROTECTION_LEVEL_NOT_ELIGIBLE'::text, NULL::uuid;
      RETURN;
    END IF;
    -- prix journalier = roundHalfUp(prix journalier net × part), borné par plancher et plafond
    v_daily := core.settlement_verify_round(l.daily_price_minor::numeric, v_price[1], v_price[2]);
    FOR v_key IN SELECT pg_catalog.unnest(ARRAY['dailyFloorMinor', 'dailyCeilingMinor']) LOOP
      IF pg_catalog.jsonb_typeof(v_terms -> v_key) IS NOT DISTINCT FROM 'null' THEN
        CONTINUE;
      END IF;
      v_bound := core.pricing_minor(v_terms -> v_key);
      IF v_bound IS NULL OR v_bound < 0 THEN
        RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
        RETURN;
      END IF;
      v_daily := CASE WHEN v_key = 'dailyFloorMinor' THEN GREATEST(v_daily, v_bound)
                      ELSE LEAST(v_daily, v_bound) END;
    END LOOP;
    v_amounts[5] := v_daily * v_days;
    -- prime due à l'assureur : roundHalfUp(PROTECTION × insurer_premium_share[niveau]) ; part
    -- absente ⇒ aucune vente (jamais une prime nulle)
    v_share := core.pricing_ratio(core.pricing_param('insurer_premium_share', l.country_code)
                                  -> v_level);
    IF v_share IS NULL THEN
      RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
      RETURN;
    END IF;
    v_ins := core.settlement_verify_round(v_amounts[5], v_share[1], v_share[2]);
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

  -- jambes de la capture du total (08 E7) : HOST = hostFromGuest, INSURER = prime due (devis /3,
  -- 0 sinon), TAX_THIRD_PARTY = taxe des groupes third_party, PLATFORM = complément
  v_hfg := core.settlement_verify_host_from_guest(v_amounts, v_host, v_deliv, v_extras);
  IF v_total - v_hfg - v_ins - v_tax3 < 0 THEN
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
     OR core.pricing_minor(v_out -> 'legs' -> 'INSURER') IS DISTINCT FROM v_ins
     OR core.pricing_minor(v_out -> 'legs' -> 'TAX_THIRD_PARTY') IS DISTINCT FROM v_tax3
     OR core.pricing_minor(v_out -> 'legs' -> 'PLATFORM')
        IS DISTINCT FROM v_total - v_hfg - v_ins - v_tax3
     OR (v_v3 AND ((v_out ->> 'protectionLevel') IS DISTINCT FROM v_level
                   OR (v_out ->> 'hostPlan') IS DISTINCT FROM (v_plan #>> '{}')))
  THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  -- US-205b : distance de l'annonce figée avec le devis (16 LST-012 ; 08 BR-MILEAGE-01 ; 19 US-205
  -- critère 2 : « 600 km incluidos » et le même prix du km au checkout, au contrat et au reçu) :
  -- km inclus = km par jour × jours facturables du rejeu ; la demande et les sorties de l'API, si
  -- elles portent la distance, sont exactement celles de l'annonce et du rejeu, sinon
  -- QUOTE_MISMATCH ; un devis qui ne la porte pas (client antérieur) reçoit celle de l'annonce
  IF l.mileage_mode = 'INCLUDED' AND l.included_km_per_day IS NOT NULL
     AND l.extra_km_price_minor IS NOT NULL THEN
    v_km := l.included_km_per_day::numeric * v_days;
    v_mil_in := pg_catalog.jsonb_build_object('mode', 'INCLUDED', 'kmPerDay',
                                              l.included_km_per_day, 'extraKmPrice',
                                              l.extra_km_price_minor::text);
    v_mil_out := v_mil_in || pg_catalog.jsonb_build_object('includedKm', v_km);
  ELSIF l.mileage_mode = 'UNLIMITED' THEN
    v_mil_in := pg_catalog.jsonb_build_object('mode', 'UNLIMITED');
    v_mil_out := v_mil_in;
  ELSE
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  IF (v_req ? 'mileage') <> (v_out ? 'mileage')
     OR (v_req ? 'mileage' AND (v_req -> 'mileage') IS DISTINCT FROM v_mil_in)
     OR (v_out ? 'mileage' AND (v_out -> 'mileage') IS DISTINCT FROM v_mil_out) THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO core.pricing_quote (id, guest_user_id, listing_id, country_code, currency,
                                  engine_version, period, billable_days, subtotal_minor,
                                  tax_total_minor, tax_third_party_minor, total_minor,
                                  leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
                                  leg_platform_minor, inputs, inputs_hash, outputs, outputs_hash,
                                  expires_at, protection_level, host_plan_code, driver_age,
                                  mileage_mode, included_km, extra_km_price_minor)
  VALUES (v_id, v_user, p_listing_id, l.country_code, l.currency, v_ver,
          pg_catalog.tstzrange(pg_catalog.to_timestamp(v_start / 1000),
                               pg_catalog.to_timestamp(v_end / 1000), '[)'),
          v_days::integer, v_sub::bigint, v_tax::bigint, v_tax3::bigint, v_total::bigint,
          v_hfg::bigint, v_ins::bigint, v_tax3::bigint, (v_total - v_hfg - v_ins - v_tax3)::bigint,
          p_inputs, p_inputs_hash, p_outputs, p_outputs_hash,
          platform.now() + pg_catalog.make_interval(mins => v_valid::integer),
          v_level, CASE WHEN v_v3 THEN v_plan #>> '{}' END, v_age::smallint,
          l.mileage_mode, v_km::integer,
          CASE WHEN l.mileage_mode = 'INCLUDED' THEN l.extra_km_price_minor END);
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

COMMENT ON FUNCTION core.pricing_cmd_freeze_quote(bytea, uuid, text, text, text, text) IS
  'Fige un devis du voyageur de la session sur une annonce LISTED : documents bornés, débit '
  'quote_freezes_per_guest_hour, empreintes vérifiées, devis rejoué par la base avec sa '
  'configuration (jours facturables, prix du trip, trip fee, protection du voyageur et prime de '
  'l''assureur en prc.quote/3, plan du véhicule, taxe par ligne, total, jambes, distance de '
  'l''annonce) ; tout écart ⇒ QUOTE_MISMATCH ; pays sans contrat d''assureur actif ⇒ '
  'INSURER_CONTRACT_INACTIVE ; expires_at = gel + quote_validity_minutes ; distance de l''annonce '
  'figée (mode, km inclus, prix du km). SECURITY DEFINER, EXECUTE app_api. US-202, US-704, '
  'US-208, US-226, US-205 (ADR-125, ADR-129, ADR-133, ADR-136, ADR-140).';

-- 2.2 Devis figé du voyageur de la session, pour le checkout (US-205b) : documents canoniques
-- (rejoués par l'API : retenue d'une annulation hors fenêtre par le moteur de règlement) et
-- distance figée. Devis inconnu ou d'un autre voyageur : aucune ligne (même réponse).
CREATE FUNCTION core.pricing_checkout_terms(p_token_hash bytea, p_quote_id uuid)
  RETURNS TABLE (quote_id uuid, engine_version text, inputs text, inputs_hash text,
                 outputs text, outputs_hash text, total_minor bigint, currency text,
                 frozen_at timestamptz, mileage_mode text, included_km integer,
                 extra_km_price_minor bigint)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT q.id, q.engine_version, q.inputs, q.inputs_hash, q.outputs, q.outputs_hash,
         q.total_minor, q.currency, q.frozen_at, q.mileage_mode, q.included_km,
         q.extra_km_price_minor
    FROM core.pricing_quote AS q
   WHERE q.id = p_quote_id
     AND q.guest_user_id = (SELECT s.user_id FROM core.iam_session_resolve(p_token_hash) AS s)
$fn$;
COMMENT ON FUNCTION core.pricing_checkout_terms(bytea, uuid) IS
  'Devis figé du voyageur de la session pour le checkout : documents canoniques et empreintes '
  '(rejeu par l''API, retenue hors fenêtre gratuite du moteur de règlement), distance figée ; '
  'aucune ligne sinon. SECURITY DEFINER, EXECUTE app_api. US-205 (ADR-140).';
REVOKE ALL ON FUNCTION core.pricing_checkout_terms(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.pricing_checkout_terms(bytea, uuid) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 3. Conditions publiques d'une annonce : fenêtre de dernière minute du pays (US-205b) -----------
ALTER POLICY catalog_cmd_terms_read ON core.config_param_value
  USING (key IN ('free_cancel_lead', 'last_minute_threshold', 'insurer_rc_minimum',
                 'last_minute_free_window_minutes'));

GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;
DROP FUNCTION core.catalog_public_terms(uuid, timestamptz);
CREATE FUNCTION core.catalog_public_terms(p_listing_id uuid, p_start timestamptz)
  RETURNS TABLE (listing_id uuid, currency text, timezone text, read_at timestamptz,
                 free_cancel_lead_hours integer, last_minute_threshold_hours integer,
                 last_minute boolean, free_until timestamptz,
                 last_minute_window_minutes integer, mileage_mode text,
                 included_km_per_day integer, extra_km_price_minor bigint,
                 deposit_amount_minor bigint, protection_offered boolean, insurer_name text,
                 insurer_license_ref text, broker_name text, broker_license_ref text,
                 contract_version integer, rc_amount_minor bigint, deductibles jsonb,
                 exclusions jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now   timestamptz := platform.now();
  v_l     record;
  v_lead  jsonb;
  v_thr   jsonb;
  v_win   jsonb;
  v_min   jsonb;
  v_cov   record;
  v_c     record;
BEGIN
  SELECT l.id, l.country_code, l.currency, l.mileage_mode, l.included_km_per_day,
         l.extra_km_price_minor, v.timezone, v.year, v.value_class, v.plate_category
    INTO v_l
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id AND v.org_id = l.org_id
   WHERE l.id = p_listing_id AND l.status = 'LISTED';
  IF v_l.id IS NULL THEN
    RETURN;
  END IF;
  listing_id := v_l.id;
  currency := v_l.currency;
  timezone := v_l.timezone;
  read_at := v_now;
  mileage_mode := v_l.mileage_mode;
  included_km_per_day := v_l.included_km_per_day;
  extra_km_price_minor := v_l.extra_km_price_minor;
  protection_offered := false;

  -- 3.1 Annulation (BR-CXL-01, OQ-BR-30) : paramètres du pays, entiers d'heures et fenêtre de
  -- dernière minute en minutes (US-205b, last_minute_free_window_minutes) ; un absent ⇒ NULL
  v_lead := core.catalog_plan_param('free_cancel_lead', v_l.country_code);
  v_thr := core.catalog_plan_param('last_minute_threshold', v_l.country_code);
  v_win := core.catalog_plan_param('last_minute_free_window_minutes', v_l.country_code);
  IF pg_catalog.jsonb_typeof(v_lead) = 'number' AND (v_lead #>> '{}') ~ '^[0-9]{1,4}$'
     AND pg_catalog.jsonb_typeof(v_thr) = 'number' AND (v_thr #>> '{}') ~ '^[0-9]{1,4}$'
     AND pg_catalog.jsonb_typeof(v_win) = 'number' AND (v_win #>> '{}') ~ '^[0-9]{1,4}$' THEN
    free_cancel_lead_hours := (v_lead #>> '{}')::integer;
    last_minute_threshold_hours := (v_thr #>> '{}')::integer;
    last_minute_window_minutes := (v_win #>> '{}')::integer;
    -- freeUntil de BR-CXL-01 si la réservation avait lieu maintenant (bookedAt = platform.now()) :
    -- dernière minute (départ à moins du seuil, comparaison stricte) ⇒ min(bookedAt + fenêtre,
    -- départ) (08 : jamais une annulation gratuite après le début) ; sinon départ − free_cancel_lead
    -- (borne incluse)
    IF p_start IS NOT NULL AND p_start > v_now THEN
      last_minute := p_start - v_now
                     < pg_catalog.make_interval(hours => last_minute_threshold_hours);
      IF last_minute THEN
        free_until := LEAST(v_now + pg_catalog.make_interval(mins => last_minute_window_minutes),
                            p_start);
      ELSE
        free_until := p_start - pg_catalog.make_interval(hours => free_cancel_lead_hours);
      END IF;
    END IF;
  END IF;

  -- 3.2 Caution de la plateforme (même règle que les cartes, 0105 ; NULL : mention générique)
  SELECT CASE WHEN dp.amount_minor > 0 AND dp.currency = v_l.currency THEN dp.amount_minor END
    INTO deposit_amount_minor
    FROM core.catalog_deposit_policy AS dp
   WHERE dp.country_code = v_l.country_code AND dp.value_class = v_l.value_class
     AND dp.valid_from <= v_now
   ORDER BY dp.valid_from DESC
   LIMIT 1;

  -- 3.3 Protection de l'assureur partenaire : rien sans interrupteur, contrat, couverture,
  -- conditions, même devise et RC au minimum du pays (19 US-205 critères 3 et 4)
  IF NOT core.config_go_live('insurer_contract_active', v_l.country_code) THEN
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT * INTO v_cov
    FROM core.settlement_insurer_vehicle_coverage(v_l.country_code, v_l.timezone, v_l.year,
                                                  v_l.value_class, v_l.plate_category);
  IF v_cov.outcome IS DISTINCT FROM 'COVERED' OR v_cov.contract_id IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT c.version, c.currency, c.rc_amount_minor, c.deductibles, c.exclusions,
         i.name AS insurer_name, i.license_ref AS insurer_license_ref,
         b.name AS broker_name, b.license_ref AS broker_license_ref, b.status AS broker_status
    INTO v_c
    FROM core.settlement_insurer_contract AS c
    JOIN core.settlement_insurer AS i ON i.id = c.insurer_id AND i.country_code = c.country_code
    LEFT JOIN core.settlement_insurer AS b ON b.id = c.broker_id AND b.country_code = c.country_code
   WHERE c.id = v_cov.contract_id AND i.status = 'ACTIVE';
  v_min := core.catalog_plan_param('insurer_rc_minimum', v_l.country_code);
  IF v_c.currency IS NULL OR v_c.currency <> v_l.currency
     OR v_min IS NULL OR pg_catalog.jsonb_typeof(v_min) <> 'string'
     OR (v_min #>> '{}') !~ '^[0-9]{1,15}$'
     OR v_c.rc_amount_minor < (v_min #>> '{}')::bigint
     OR (v_c.broker_name IS NOT NULL AND v_c.broker_status IS DISTINCT FROM 'ACTIVE') THEN
    RETURN NEXT;
    RETURN;
  END IF;
  protection_offered := true;
  insurer_name := v_c.insurer_name;
  insurer_license_ref := v_c.insurer_license_ref;
  broker_name := v_c.broker_name;
  broker_license_ref := v_c.broker_license_ref;
  contract_version := v_c.version;
  rc_amount_minor := v_c.rc_amount_minor;
  deductibles := v_c.deductibles;
  exclusions := v_c.exclusions;
  RETURN NEXT;
END
$fn$;
COMMENT ON FUNCTION core.catalog_public_terms(uuid, timestamptz) IS
  'Conditions publiques d''une annonce LISTED : annulation (paramètres du pays dont la fenêtre de '
  'dernière minute, freeUntil de BR-CXL-01 à platform.now() pour un départ donné : départ − '
  'free_cancel_lead, ou min(maintenant + fenêtre, départ) en dernière minute), distance, caution '
  'de la plateforme, protection de l''assureur partenaire seulement si insurer_contract_active, '
  'contrat en vigueur couvrant le véhicule, conditions posées, même devise et RC >= '
  'insurer_rc_minimum. SECURITY DEFINER, EXECUTE app_api. US-205 (ADR-138, ADR-140).';

REVOKE ALL ON FUNCTION core.catalog_public_terms(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_public_terms(uuid, timestamptz) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
