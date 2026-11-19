-- 0155 — Correctifs des constats de la red team argent du lot 2 (US-222d ; rapport
-- docs/team/redteam/L2-argent.md, PR #254 : F-L2-ARG-01 à 04). 08 E7 (règles 5, 7), BR-PAY-11,
-- TJ14a / TJ14b ; 16 A.8 ; 17 v6 §2.3, §2.9 ; pré-mortem du lot 2 RT-L2-M01, M12, M18, L2-PM-03,
-- L2-PM-30, L2-PM-43 ; ADR-176 (cette migration). Appliquée sous `migrator`.
--
-- Cette migration :
--   1. F-L2-ARG-01 — `core.pricing_cmd_freeze_quote` (CREATE OR REPLACE depuis 0118, même
--      signature, propriétaire et droits) : une ligne lue de la demande (PROMO_PLATFORM, PROMO_HOST,
--      EXTRAS, ADDITIONAL_DRIVER_FEE, YOUNG_DRIVER_FEE, DELIVERY_FEE) n'a aucune source en base en
--      bêta : son montant recalculé est 0 ; tout autre montant ⇒ QUOTE_MISMATCH, rien de figé
--      (défaut fail-closed, comme les crédits refusés en bêta, N-367). Jugé après la règle des
--      jambes (LEG_AMOUNT_NEGATIVE, TJ13a / TJ13c, inchangée). Le reste est recopié ;
--   2. F-L2-ARG-02 / 03 — signal « paiement hors plateforme » (comme Turo, COMME_TURO.md) :
--      catalogue de motifs `core.catalog_offplatform_pattern` (es / en / fr / pt-BR, écrit par
--      migration seulement, aucune constante pays : moyens de paiement, espèces, virement,
--      commission contournée), aide `core.catalog_text_offers_offplatform_payment(text)` (texte
--      normalisé, minuscules, sans accents), file GRAY_MARKET DÉCLARÉE (permission
--      `ops.review_listing_host`, délai `listing_review_sla_h` du pays, PROPOSÉ) ;
--      `core.catalog_cmd_create_location` (CREATE OR REPLACE depuis 0084) : zone ou ville
--      publiques qui proposent un paiement hors plateforme ⇒ LOCATION_AREA_OFF_PLATFORM /
--      LOCATION_CITY_OFF_PLATFORM et compte d'hôte dans la file GRAY_MARKET ; libellé ou adresse du
--      lieu (chiffres légitimes) ⇒ lieu créé, signalé dans la file GRAY_MARKET (jamais refusé) ;
--   3. F-L2-ARG-04 — chargeback, à défaut de l'imputation complète de TJ14a / TJ14b (US-709) :
--      a. gel de la jambe HOST du trip dès qu'un CHARGEBACK non échoué y est enregistré (et à
--         chaque changement de statut ou de trip) par un déclencheur SECURITY DEFINER
--         (`core.settlement_freeze_host_on_chargeback`, cmd_money_owner) ; `frozen_reason`
--         CHARGEBACK ; droit de colonne `frozen, frozen_reason` accordé à cmd_money_owner avec une
--         politique qui n'admet QUE le gel de la jambe HOST d'un trip qui porte un chargeback ;
--         garde `core.settlement_trip_leg_balance_guard` (CREATE OR REPLACE depuis 0027) : un gel
--         ne se lève jamais et ne vise que la jambe HOST d'un trip à chargeback (le dégel est la
--         décision FIN d'US-709) ; une jambe gelée refuse déjà tout mouvement (`leg_frozen`) ;
--      b. faits du contrôle FIN `CHARGEBACK_UNIMPUTED` : `core.finance_chargeback_facts()`
--         (cmd_money_owner, EXECUTE app_worker, travailleur `reconciliation` seulement) : un
--         chargeback SUCCEEDED sans mouvement de jambe est un écart du rapprochement nocturne.
--
-- Erreurs (SQLSTATE, contrainte) traduites par packages/db/src/errors.ts, sans DETAIL :
--   gray_market_unavailable (55000) → INVARIANT_VIOLATION ; trip_leg_balance_freeze_forbidden
--   (23000) → INVARIANT_VIOLATION.
--
-- Expand / contract : une table, un déclencheur, trois fonctions, une politique et un droit de
-- colonne AJOUTÉS ; une ligne de file AJOUTÉE ; trois fonctions REMPLACÉES à signature,
-- propriétaire et droits identiques. Le COMPORTEMENT se resserre volontairement : un devis portant
-- une promotion, une option ou une livraison n'est plus figé (le checkout le refusait déjà,
-- QUOTE_LINE_NOT_SUPPORTED, N-129) ; une zone ou une ville qui propose un paiement hors plateforme
-- est refusée ; un chargeback gèle la jambe HOST. La version N de l'API traduit une issue inconnue
-- en refus (QUOTE_UNAVAILABLE, LISTING_UNAVAILABLE) sans rien écrire de plus.
--
-- Retour arrière :
--   rejouer core.pricing_cmd_freeze_quote de 0118 (sous cmd_money_owner),
--     core.catalog_cmd_create_location de 0084 (sous catalog_cmd_owner) et
--     core.settlement_trip_leg_balance_guard de 0027 (sous migrator) ;
--   DROP TRIGGER payment_operation_chargeback_freeze ON core.payment_payment_operation ;
--   DROP FUNCTION core.settlement_freeze_host_on_chargeback(), core.finance_chargeback_facts(),
--     core.catalog_text_offers_offplatform_payment(text) ;
--   DROP POLICY cmd_money_chargeback_freeze ON core.settlement_trip_leg_balance ;
--   REVOKE UPDATE (frozen, frozen_reason) ON core.settlement_trip_leg_balance FROM cmd_money_owner ;
--   DELETE FROM core.support_review_queue_item WHERE queue = 'GRAY_MARKET' (après revue) ;
--   DELETE FROM core.support_review_queue WHERE queue = 'GRAY_MARKET' ;
--   DROP TABLE core.catalog_offplatform_pattern.

-- 1. F-L2-ARG-01 : gel du devis (sous son propriétaire, CREATE accordé le temps du remplacement ;
-- propriétaire, EXECUTE et entrée de security-definer-allowlist.json inchangés) -----------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

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
  -- US-222d (F-L2-ARG-01) : une ligne lue de la demande n'engage un montant que si la base la
  -- recalcule depuis sa source ; en bêta, aucune promotion (PROMO_PLATFORM, PROMO_HOST), aucune
  -- option (EXTRAS, ADDITIONAL_DRIVER_FEE, YOUNG_DRIVER_FEE) ni livraison (DELIVERY_FEE) n'a de
  -- source en base : leur montant recalculé est 0, tout autre montant ⇒ QUOTE_MISMATCH (défaut
  -- fail-closed, comme les crédits refusés en bêta, N-367). Chaque ligne rouvre avec le module qui
  -- lui donne une source (promotion, options, livraison), revue argent. Jugée après la règle des
  -- jambes (LEG_AMOUNT_NEGATIVE, TJ13a / TJ13c, inchangée) et avant la comparaison des sorties ;
  -- la route HTTP n'en envoie aucune (parseQuoteDemand) : rien ne change pour elle.
  IF v_amounts[2] <> 0 OR v_amounts[3] <> 0 OR v_amounts[6] <> 0 OR v_amounts[8] <> 0
     OR v_amounts[9] <> 0 OR v_amounts[10] <> 0 THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
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
  'US-208, US-226, US-205 (ADR-125, ADR-129, ADR-133, ADR-136, ADR-140) ; ligne de la demande '
  'sans source en base (promotion, option, livraison) non nulle ⇒ QUOTE_MISMATCH (US-222d, '
  'F-L2-ARG-01, ADR-176).';


RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 2. F-L2-ARG-02 / 03 : paiement hors plateforme proposé par l'hôte -------------------------------

-- 2.1 Catalogue de motifs (comme Turo : refuser et signaler toute invitation à payer hors de la
-- plateforme ; COMME_TURO.md). Expressions régulières de PostgreSQL appliquées au texte normalisé
-- (NFKC, caractères invisibles retirés, minuscules, accents retirés), en mots entiers (\m, \M).
-- Aucun pays : une langue (es, en, fr, pt) ou '*' (nom propre d'un moyen de paiement). Écrit par
-- migration seulement (revue sécurité) ; il réduit le risque sans prétendre à l'exhaustivité
-- (ADR-114, ADR-176).
CREATE TABLE core.catalog_offplatform_pattern (
  code    text CONSTRAINT catalog_offplatform_pattern_pkey PRIMARY KEY
    CONSTRAINT catalog_offplatform_pattern_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  lang    text NOT NULL
    CONSTRAINT catalog_offplatform_pattern_lang_valid CHECK (lang IN ('*', 'es', 'en', 'fr', 'pt')),
  pattern text NOT NULL
    CONSTRAINT catalog_offplatform_pattern_pattern_size CHECK (pg_catalog.char_length(pattern)
                                                               BETWEEN 3 AND 300),
  story   text NOT NULL
    CONSTRAINT catalog_offplatform_pattern_story_format CHECK (story ~ '^US-[0-9]{3}$')
);
ALTER TABLE core.catalog_offplatform_pattern ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_offplatform_pattern FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.catalog_offplatform_pattern TO migrator
  USING (true) WITH CHECK (true);
REVOKE ALL ON core.catalog_offplatform_pattern FROM PUBLIC;
GRANT SELECT (pattern) ON core.catalog_offplatform_pattern TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.catalog_offplatform_pattern FOR SELECT
  TO catalog_cmd_owner USING (true);
COMMENT ON TABLE core.catalog_offplatform_pattern IS
  'Motifs du signal « paiement hors plateforme » dans les textes de l''hôte (moyens de paiement, '
  'espèces, virement, commission contournée ; es, en, fr, pt-BR ; aucun pays). Écrit par migration '
  'seulement, lu par catalog_cmd_owner. US-222d (F-L2-ARG-02, ADR-176).';

INSERT INTO core.catalog_offplatform_pattern (code, lang, pattern, story) VALUES
  -- moyens de paiement nommés (noms propres, toutes langues)
  ('WALLET_NAMED', '*',
   '\m(yappy|pix|zelle|venmo|paypal|nequi|cash ?app|tigo ?money|western ?union|moneygram)\M',
   'US-222'),
  -- espèces
  ('ES_CASH', 'es', '\m(efectivo|en mano|al contado)\M', 'US-222'),
  ('EN_CASH', 'en', '\m(cash|in hand)\M', 'US-222'),
  ('FR_CASH', 'fr', '\m(en especes|en liquide|en cash|de la main a la main)\M', 'US-222'),
  ('PT_CASH', 'pt', '\m(em dinheiro|dinheiro vivo|em especie)\M', 'US-222'),
  -- virement ou paiement direct
  ('ES_TRANSFER', 'es',
   '\m(transferencia|deposito bancario|pago directo|pago aparte|pago por fuera|pagame|pagarme|paga(s|r)? directo)\M',
   'US-222'),
  ('EN_TRANSFER', 'en',
   '\m(bank transfer|wire transfer|pay me|pay directly|direct payment|pay outside)\M', 'US-222'),
  ('FR_TRANSFER', 'fr',
   '\m(virement|paiement direct|payez[- ]moi|payer directement|paiement hors)\M', 'US-222'),
  ('PT_TRANSFER', 'pt',
   '\m(transferencia|deposito bancario|pagamento direto|pagamento por fora|paga direto|pague direto|direto comigo)\M',
   'US-222'),
  -- commission ou plateforme contournées
  ('ES_FEE_BYPASS', 'es',
   '\m(sin (la )?comision|ahorra(te|s)? (la )?comision|fuera de (la )?(app|aplicacion|plataforma))\M',
   'US-222'),
  ('EN_FEE_BYPASS', 'en',
   '\m((skip|avoid|no|without|save) (the )?(app|platform|service|booking) (fee|fees|commission)|off[- ]?(the[- ])?(app|platform))\M',
   'US-222'),
  ('FR_FEE_BYPASS', 'fr',
   '\m(sans (la )?commission|hors (de la )?(plateforme|application|appli))\M', 'US-222'),
  ('PT_FEE_BYPASS', 'pt',
   '\m(sem (a )?comissao|sem (a )?taxa (do|da) (app|aplicativo|plataforma)|fora do (app|aplicativo)|fora da plataforma)\M',
   'US-222');

-- 2.2 File GRAY_MARKET déclarée (US-109 la laissait à « sa story ») : permission et délai de la
-- file LISTING (revue de l'annonce par l'ops ; PROPOSÉ, ADR-176) ; un élément vivant par sujet
INSERT INTO core.support_review_queue (queue, permission_code, sla_param_key, sla_unit_minutes, story)
VALUES ('GRAY_MARKET', 'ops.review_listing_host', 'listing_review_sla_h', 60, 'US-222');

-- 2.3 Aide et commande de création du lieu (sous catalog_cmd_owner)
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

-- Vrai si le texte porte un motif du catalogue, après normalisation (NFKC, invisibles retirés),
-- minuscules et accents retirés (« comisión » = « comision », « transferência » = « transferencia »).
CREATE FUNCTION core.catalog_text_offers_offplatform_payment(p_text text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (
    SELECT pg_catalog.translate(pg_catalog.lower(core.catalog_public_text_norm(p_text)),
                                'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn') AS v
  )
  SELECT p_text IS NOT NULL
         AND EXISTS (SELECT 1 FROM core.catalog_offplatform_pattern AS m, t WHERE t.v ~ m.pattern)
$fn$;
COMMENT ON FUNCTION core.catalog_text_offers_offplatform_payment(text) IS
  'Proposition de paiement hors plateforme dans un texte de l''hôte (motifs de '
  'core.catalog_offplatform_pattern sur le texte normalisé, sans accents). Aide interne sous '
  'catalog_cmd_owner. US-222d (F-L2-ARG-02, F-L2-ARG-03, ADR-176).';
REVOKE ALL ON FUNCTION core.catalog_text_offers_offplatform_payment(text) FROM PUBLIC;

-- Lieu de remise (corps de 0084 recopié ; deux étapes ajoutées, F-L2-ARG-02 et 03)
CREATE OR REPLACE FUNCTION core.catalog_cmd_create_location(p_token_hash bytea, p_org uuid,
                                                            p_kind text, p_label text,
                                                            p_address_line text, p_city text,
                                                            p_area_label text, p_lat numeric,
                                                            p_lng numeric)
  RETURNS TABLE (outcome text, location_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h    record;
  v_tz text;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_q  text;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('HOME', 'POI', 'AIRPORT')
     OR p_label IS NULL OR pg_catalog.btrim(p_label) = '' OR pg_catalog.char_length(p_label) > 80
     OR p_address_line IS NULL OR pg_catalog.btrim(p_address_line) = ''
     OR pg_catalog.char_length(p_address_line) > 200
     OR p_city IS NULL OR pg_catalog.btrim(p_city) = '' OR pg_catalog.char_length(p_city) > 80
     OR (p_area_label IS NOT NULL AND (pg_catalog.btrim(p_area_label) = ''
                                       OR pg_catalog.char_length(p_area_label) > 80))
     OR ((p_lat IS NULL) <> (p_lng IS NULL))
     OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN QUERY SELECT 'LOCATION_FIELD_INVALID'::text, NULL::uuid;
    RETURN;
  END IF;
  -- zone publique (16 HST-011, OQ-P2P-05) : jamais une adresse exacte (BOARD N-62)
  IF core.catalog_area_label_is_address(p_area_label) THEN
    RETURN QUERY SELECT 'LOCATION_AREA_ADDRESS'::text, NULL::uuid;
    RETURN;
  END IF;
  -- ville affichée : même filtre (texte libre public)
  IF core.catalog_area_label_is_address(p_city) THEN
    RETURN QUERY SELECT 'LOCATION_CITY_INVALID'::text, NULL::uuid;
    RETURN;
  END IF;
  -- US-222d (F-L2-ARG-02, comme Turo) : proposition de paiement hors plateforme dans un texte
  -- PUBLIC (zone, ville ; motifs du catalogue core.catalog_offplatform_pattern) ⇒ texte refusé ET
  -- compte d'hôte signalé à l'ops (file GRAY_MARKET, un élément vivant par compte) ; le refus est
  -- une issue (aucune exception) : l'élément de file est écrit dans la même transaction
  IF core.catalog_text_offers_offplatform_payment(p_area_label)
     OR core.catalog_text_offers_offplatform_payment(p_city) THEN
    SELECT q.outcome INTO v_q
      FROM core.support_enqueue_review('GRAY_MARKET', 'ORGANIZATION', p_org, h.country_code,
                                       h.user_id) AS q;
    IF v_q IS DISTINCT FROM 'CREATED' AND v_q IS DISTINCT FROM 'EXISTS' THEN
      RAISE EXCEPTION 'catalog: gray market queue unavailable (%)', v_q
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'gray_market_unavailable';
    END IF;
    RETURN QUERY SELECT CASE WHEN core.catalog_text_offers_offplatform_payment(p_area_label)
                             THEN 'LOCATION_AREA_OFF_PLATFORM'
                             ELSE 'LOCATION_CITY_OFF_PLATFORM' END::text, NULL::uuid;
    RETURN;
  END IF;
  -- fuseau du pays du compte d'hôte (17 §3.2.3 : « un véhicule hérite du fuseau de son lieu »)
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = h.country_code;
  IF v_tz IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  INSERT INTO core.catalog_location (id, org_id, country_code, kind, place_label, address_line, city,
                                     area_label, geo, timezone, created_by)
  VALUES (v_id, p_org, h.country_code, p_kind, pg_catalog.btrim(p_label),
          pg_catalog.btrim(p_address_line), pg_catalog.btrim(p_city),
          NULLIF(pg_catalog.btrim(p_area_label), ''),
          CASE WHEN p_lat IS NOT NULL
               THEN pg_catalog.point(pg_catalog.round(p_lng, 6)::double precision,
                                     pg_catalog.round(p_lat, 6)::double precision) END,
          v_tz, h.user_id);
  -- US-222d (F-L2-ARG-03, comme Turo, jamais plus lourd) : libellé et adresse du lieu, montrés au
  -- voyageur après la réservation, portent des chiffres légitimes : une proposition de paiement
  -- hors plateforme n'y est PAS refusée, le lieu est signalé à l'ops (file GRAY_MARKET) ; file
  -- indisponible ⇒ rien d'écrit (exception, fail-closed : jamais un signal perdu)
  IF core.catalog_text_offers_offplatform_payment(p_label)
     OR core.catalog_text_offers_offplatform_payment(p_address_line) THEN
    SELECT q.outcome INTO v_q
      FROM core.support_enqueue_review('GRAY_MARKET', 'LOCATION', v_id, h.country_code,
                                       h.user_id) AS q;
    IF v_q IS DISTINCT FROM 'CREATED' THEN
      RAISE EXCEPTION 'catalog: gray market queue unavailable (%)', v_q
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'gray_market_unavailable';
    END IF;
  END IF;
  RETURN QUERY SELECT 'DONE'::text, v_id;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_create_location(bytea, uuid, text, text, text, text, text, numeric, numeric) IS
  'Lieu de remise du compte d''hôte de la session (pays et fuseau du compte) ; zone affichée sans '
  'adresse exacte (LOCATION_AREA_ADDRESS). SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099) ; '
  'US-118 (ADR-114) ; proposition de paiement hors plateforme dans la zone ou la ville ⇒ '
  'LOCATION_AREA_OFF_PLATFORM / LOCATION_CITY_OFF_PLATFORM et compte signalé (GRAY_MARKET), dans '
  'le libellé ou l''adresse ⇒ lieu créé et signalé (GRAY_MARKET). US-222d (ADR-176).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 3. F-L2-ARG-04 : chargeback sans imputation -----------------------------------------------------

-- 3.1 Garde des soldes (corps de 0027 recopié, propriétaire migrator ; une règle ajoutée) : le gel
-- ne se lève jamais (le dégel est la décision FIN d'US-709) et ne vise que la jambe HOST d'un trip
-- qui porte un chargeback non échoué (08 E7 règle 7 « ouvert » : lots de l'hôte ON_HOLD ;
-- BR-PAY-11).
CREATE OR REPLACE FUNCTION core.settlement_trip_leg_balance_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'trip_leg_balance: aucune suppression'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_leg_balance_no_delete';
  END IF;
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.segment_no IS DISTINCT FROM OLD.segment_no
     OR NEW.leg IS DISTINCT FROM OLD.leg OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.captured_minor < OLD.captured_minor OR NEW.refunded_minor < OLD.refunded_minor
     OR NEW.reallocated_in_minor < OLD.reallocated_in_minor
     OR NEW.reallocated_out_minor < OLD.reallocated_out_minor
     OR NEW.released_minor < OLD.released_minor THEN
    RAISE EXCEPTION 'trip_leg_balance: cumuls monotones, identité figée'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_leg_balance_monotonic';
  END IF;
  -- US-222d (F-L2-ARG-04) : gel de la jambe HOST par un chargeback seulement, jamais levé ici
  IF NEW.frozen IS DISTINCT FROM OLD.frozen
     OR NEW.frozen_reason IS DISTINCT FROM OLD.frozen_reason THEN
    IF OLD.frozen OR NOT NEW.frozen OR NEW.frozen_reason IS DISTINCT FROM 'CHARGEBACK'
       OR NEW.leg <> 'HOST'
       OR NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                       WHERE o.trip_id = NEW.trip_id AND o.kind = 'CHARGEBACK'
                         AND o.status <> 'FAILED') THEN
      RAISE EXCEPTION 'trip_leg_balance: gel réservé à la jambe HOST d''un trip à chargeback'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'trip_leg_balance_freeze_forbidden';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;

-- 3.2 Droit de colonne et politique du gel (cmd_money_owner ; s'ajoute aux politiques de 0039 et
-- 0149 : seul le gel de la jambe HOST d'un trip à chargeback, dans tout contexte de paiement —
-- payment_command, webhook_ingest)
GRANT UPDATE (frozen, frozen_reason) ON core.settlement_trip_leg_balance TO cmd_money_owner;
CREATE POLICY cmd_money_chargeback_freeze ON core.settlement_trip_leg_balance FOR UPDATE
  TO cmd_money_owner
  USING (leg = 'HOST' AND NOT frozen)
  WITH CHECK (leg = 'HOST' AND frozen AND frozen_reason = 'CHARGEBACK'
              AND EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                           WHERE o.trip_id = settlement_trip_leg_balance.trip_id
                             AND o.kind = 'CHARGEBACK' AND o.status <> 'FAILED'));

-- 3.3 Déclencheur du gel (créé sous migrator, propriétaire cmd_money_owner ensuite, comme les
-- déclencheurs d'intégrité de 0028) : un CHARGEBACK enregistré, ou qui change de statut ou de
-- trip, gèle la jambe HOST de son trip (idempotent) ; FAILED (chargeback gagné ou rejeté) ne gèle
-- ni ne dégèle rien (décision FIN, US-709).
CREATE FUNCTION core.settlement_freeze_host_on_chargeback()
  RETURNS trigger
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.kind = 'CHARGEBACK' AND NEW.trip_id IS NOT NULL AND NEW.status <> 'FAILED' THEN
    UPDATE core.settlement_trip_leg_balance AS b
       SET frozen = true, frozen_reason = 'CHARGEBACK'
     WHERE b.trip_id = NEW.trip_id AND b.segment_no = 1 AND b.leg = 'HOST' AND NOT b.frozen;
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_freeze_host_on_chargeback() IS
  'Déclencheur : un CHARGEBACK non échoué gèle la jambe HOST de son trip (frozen_reason '
  'CHARGEBACK ; 08 E7 règle 7, BR-PAY-11) avant tout versement, jusqu''à la décision FIN '
  '(US-709). SECURITY DEFINER sous cmd_money_owner, aucun EXECUTE. US-222d (F-L2-ARG-04, ADR-176).';
REVOKE ALL ON FUNCTION core.settlement_freeze_host_on_chargeback() FROM PUBLIC;
CREATE TRIGGER payment_operation_chargeback_freeze
  AFTER INSERT OR UPDATE OF status, trip_id ON core.payment_payment_operation
  FOR EACH ROW WHEN (NEW.kind = 'CHARGEBACK')
  EXECUTE FUNCTION core.settlement_freeze_host_on_chargeback();
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.settlement_freeze_host_on_chargeback() OWNER TO cmd_money_owner;

-- 3.4 Faits du contrôle FIN CHARGEBACK_UNIMPUTED (lecture de l'argent, famille cmd_money)
SET LOCAL ROLE cmd_money_owner;
CREATE FUNCTION core.finance_chargeback_facts()
  RETURNS TABLE (country_code text, imputed boolean, host_frozen boolean)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'reconciliation' THEN
    RAISE EXCEPTION 'finance: chargeback facts are read by the reconciliation worker only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- un chargeback SUCCEEDED (fonds repris par la banque) est imputé s'il a déplacé une jambe
  -- (TJ14a / TJ14b, US-709) ; sinon, écart du rapprochement (aucun identifiant rendu)
  RETURN QUERY
  SELECT o.country_code,
         EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m WHERE m.operation_id = o.id),
         COALESCE((SELECT b.frozen FROM core.settlement_trip_leg_balance AS b
                    WHERE b.trip_id = o.trip_id AND b.segment_no = 1 AND b.leg = 'HOST'), false)
    FROM core.payment_payment_operation AS o
   WHERE o.kind = 'CHARGEBACK' AND o.status = 'SUCCEEDED';
END
$fn$;
COMMENT ON FUNCTION core.finance_chargeback_facts() IS
  'Faits du contrôle FIN CHARGEBACK_UNIMPUTED : par chargeback SUCCEEDED, pays, imputation (un '
  'mouvement de jambe) et gel de la jambe HOST. Travailleur reconciliation seulement (EXECUTE '
  'app_worker). US-222d (F-L2-ARG-04, ADR-176).';
REVOKE ALL ON FUNCTION core.finance_chargeback_facts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.finance_chargeback_facts() TO app_worker;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
