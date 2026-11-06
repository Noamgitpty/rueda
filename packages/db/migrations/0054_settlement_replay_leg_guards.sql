-- 0054 — STL / PAY : correctifs de la red team argent de la porte du lot 0 (US-049).
-- 08 E1, E4 (calcul unique, version, supersession), E7 (jambes explicites, règles 1, 3, 3 bis, 6),
-- BR-PAYOUT ; 17 §0.1 (interrupteurs de mise en service), §2.9 (soldes par jambe, invariants),
-- §3.2.8, §4.3 point 8 ; ADR-057, ADR-059, ADR-066 ; ADR-083 (ce correctif). Rapport :
-- docs/team/redteam/L0-argent.md (RC-1 à RC-5). Appliquée sous `migrator`.
--
-- Cette migration (ajout seul : aucune table ni colonne modifiée) :
--   1. RC-1 — rejeu indépendant des entrées d'un règlement en base. `core.settlement_verify_cxl_beta_1
--      (inputs)` recalcule, depuis les seules entrées canoniques `inputs` (trip, événement, paramètres
--      figés), tout ce que le moteur `cxl-beta/1` de `@rueda/money` écrit : qualification, lignes
--      remboursées et retenues, taxes par groupe, en-tête, jambes retenues et état capturé. C'est un
--      VÉRIFICATEUR (comme les oracles Python de docs/specs/tools) : il ne produit aucun montant
--      stocké ; le montant stocké reste celui du moteur, et la base refuse tout règlement dont un
--      seul champ diffère du rejeu (`settlement_replay_mismatch`). Une version de moteur ou une
--      nature de règlement que le vérificateur ne connaît pas est refusée (fail-closed,
--      `settlement_replay_unsupported`) ;
--   2. RC-1 — `core.settlement_assert_balanced()` (trigger différé de 0027) remplacée : contrôles
--      de 0027 inchangés et dans le même ordre (mêmes codes d'erreur), puis (a) une version n+1 porte
--      sur le MÊME trip canonique et la même version du moteur que la version n
--      (`settlement_trip_inputs_changed`, ARG-04c côté base), (b) rejeu des entrées comparé champ par
--      champ à la version stockée (ARG-23b, 23c, 23e). Pour une v1, la base des variations est
--      comparée à l'état capturé recalculé (en plus de `trip_leg_balance` quand il est tenu) ;
--   3. RC-2 — `core.settlement_cmd_apply_leg_movement` remplacée : un REFUND du périmètre loyer exige
--      un règlement du segment (`leg_refund_without_settlement`) et, jambe par jambe, Σ remboursé
--      (après l'opération) ≤ max(0, − Σ variations de la chaîne de versions), et Σ remboursé ≤
--      remboursement de la dernière version (`leg_refund_exceeds_settlement`). La chaîne est
--      linéaire (une seule version par rang, 0027) : la dernière version est l'ordre de référence,
--      un ordre d'une version remplacée ne peut donc pas s'y ajouter. Jamais de prorata : une
--      ventilation autre que celle du règlement dépasse une jambe dès que le total est atteint
--      (ARG-33b, ARG-33c). Contrôles de solde de 0039 inchangés et AVANT ce plafond ;
--   4. RC-3 — versement d'une jambe (`LEG_RELEASE`) gardé EN BASE, fail-closed, à l'enregistrement de
--      l'ordre (trigger d'instruction sur `payment_payment_operation_leg` : l'ordre n'est jamais
--      créé, donc jamais transmis au PSP) et de nouveau au report sur les soldes :
--      `core.settlement_release_blocker(opération)` exige, dans cet ordre, trip `COMPLETED`
--      (`leg_release_trip_not_completed`), `trip_leg_balance.release_at` posé et atteint pour chaque
--      jambe versée (`leg_release_not_due`), sous-marchand ACTIVE de l'hôte sur ce compte pour la jambe
--      HOST (`leg_release_submerchant_inactive`), `insurer_contract_active[pays]` pour la jambe INSURER
--      (`leg_release_insurer_inactive`), enfin `payouts_enabled[pays]` (`leg_release_payouts_disabled`).
--      Les interrupteurs sont lus par `core.config_go_live` (fail-closed : absent ⇒ false) ; ils
--      valent false et ne changent que par la commande à deux personnes (US-125), jamais ici ;
--   5. RC-3 — tout mouvement de jambe sur un compte dont le mode d'encaissement n'est pas
--      SPLIT_AT_SOURCE exige `funds_holding_enabled[pays]` (`leg_funds_holding_disabled`) : défense en
--      profondeur derrière le CHECK `psp_account_platform_mor_closed` de 0028 ;
--   6. droits au plus juste de `cmd_money_owner` pour ces lectures (statut du trip, configuration).
--
-- Non traités ici (ADR-083) : RC-4 (capture non bornée par le devis : aucune source de prix avant le
-- module PRC) et RC-5 (preuve WEBHOOK_SIGNED sans webhook : les tests de la red team se
-- contredisent, voir le rapport).
--
-- Erreurs (packages/db/src/errors.ts) : settlement_replay_mismatch, settlement_replay_unsupported,
-- settlement_replay_input_invalid, settlement_trip_inputs_changed (23000) → INVARIANT_VIOLATION ;
-- leg_refund_without_settlement, leg_refund_exceeds_settlement (55000) → INVARIANT_VIOLATION ;
-- leg_release_trip_not_completed, leg_release_not_due (55000) → INVALID_TRANSITION ;
-- leg_release_submerchant_inactive (55000) → HOST_PAYOUT_RAIL_UNAVAILABLE ;
-- leg_release_insurer_inactive, leg_release_payouts_disabled, leg_funds_holding_disabled (55000) →
-- FORBIDDEN.
--
-- Retour arrière :
--   DROP TRIGGER payment_operation_leg_release_guard ON core.payment_payment_operation_leg;
--   DROP FUNCTION core.payment_operation_leg_release_guard(), core.settlement_release_blocker(uuid),
--     core.settlement_verify_cxl_beta_1(jsonb), core.settlement_verify_legs(jsonb, text, numeric[],
--     boolean[], numeric[], numeric), core.settlement_verify_host_from_guest(numeric[], numeric[],
--     numeric[], numeric[]), core.settlement_verify_alloc_host(numeric, numeric[]),
--     core.settlement_verify_round(numeric, numeric, numeric), core.settlement_verify_floor_div(numeric,
--     numeric), core.settlement_verify_minor(jsonb, text), core.settlement_verify_ratio(jsonb),
--     core.settlement_verify_int(jsonb), core.settlement_verify_flag(jsonb, text);
--   DROP POLICY cmd_money_sel ON core.config_param_value, core.config_param_definition;
--   REVOKE SELECT ON core.config_param_value, core.config_param_definition FROM cmd_money_owner;
--   REVOKE SELECT (status) ON core.booking_trip FROM cmd_money_owner;
--   REVOKE EXECUTE ON FUNCTION core.config_go_live(text, text) FROM cmd_money_owner;
--   réappliquer core.settlement_assert_balanced() de 0027 et
--   core.settlement_cmd_apply_leg_movement(uuid) de 0039 (sous cmd_money_owner, comme ci-dessous).

-- 1. Droits de lecture de cmd_money_owner -------------------------------------------------------
GRANT SELECT (status) ON core.booking_trip TO cmd_money_owner;
GRANT SELECT ON core.config_param_value, core.config_param_definition TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.config_param_value FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.config_param_definition FOR SELECT TO cmd_money_owner USING (true);
GRANT EXECUTE ON FUNCTION core.config_go_live(text, text) TO cmd_money_owner;

-- 2. Vérificateur du moteur cxl-beta/1 (fonctions pures, SECURITY INVOKER) -----------------------
-- Arithmétique exacte en `numeric` entier (aucune division non entière), recopiée du pseudo-code
-- de 08 (BR-PRICE-14, BR-CXL) : floorDiv, roundHalfUp(a × n / d) = floor((2·a·n + d) / (2·d)),
-- allocHost (au plus proche, égalité → plateforme). Entrée mal formée ⇒ refus.

CREATE FUNCTION core.settlement_verify_floor_div(p_num numeric, p_den numeric)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN pg_catalog.mod(p_num, p_den) <> 0 AND ((p_num < 0) <> (p_den < 0))
              THEN pg_catalog.div(p_num, p_den) - 1
              ELSE pg_catalog.div(p_num, p_den) END
$fn$;

-- roundHalfUp(a × n / d), d > 0 (contrôlé par l'appelant)
CREATE FUNCTION core.settlement_verify_round(p_amount numeric, p_num numeric, p_den numeric)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.settlement_verify_floor_div(2 * p_amount * p_num + p_den, 2 * p_den)
$fn$;

-- allocHost(m, part) : part = {num, den}, 0 ≤ num ≤ den (contrôlé par settlement_verify_ratio)
CREATE FUNCTION core.settlement_verify_alloc_host(p_amount numeric, p_share numeric[])
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN 2 * (x.product - x.fl * p_share[2]) <= p_share[2] THEN x.fl ELSE x.fl + 1 END
    FROM (SELECT p_amount * p_share[1] AS product,
                 core.settlement_verify_floor_div(p_amount * p_share[1], p_share[2]) AS fl) AS x
$fn$;

-- Entier JSON (instant en ms, jours, paramètre) : nombre entier sûr (|n| < 2^53).
CREATE FUNCTION core.settlement_verify_int(p_value jsonb)
  RETURNS numeric
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'number'
     OR NOT COALESCE((p_value #>> '{}') ~ '^-?[0-9]{1,16}$', false)
     OR abs((p_value #>> '{}')::numeric) > 9007199254740991 THEN
    RAISE EXCEPTION 'settlement replay: integer expected'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;
  RETURN (p_value #>> '{}')::numeric;
END
$fn$;

-- Drapeau exigé par une branche (requireFlag) : booléen JSON, sinon refus.
CREATE FUNCTION core.settlement_verify_flag(p_value jsonb, p_name text)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'boolean' THEN
    RAISE EXCEPTION 'settlement replay: flag % required', p_name
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;
  RETURN p_value = 'true'::jsonb;
END
$fn$;

-- Montant `{amountMinor: {$bigint}, currency}` de la devise attendue.
CREATE FUNCTION core.settlement_verify_minor(p_value jsonb, p_currency text)
  RETURNS numeric
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'object'
     OR (p_value ->> 'currency') IS DISTINCT FROM p_currency
     OR pg_catalog.jsonb_typeof(p_value -> 'amountMinor') IS DISTINCT FROM 'object'
     OR NOT COALESCE((p_value -> 'amountMinor' ->> '$bigint') ~ '^-?[0-9]{1,19}$', false) THEN
    RAISE EXCEPTION 'settlement replay: money of currency % expected', p_currency
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;
  RETURN (p_value -> 'amountMinor' ->> '$bigint')::numeric;
END
$fn$;

-- Part {num, den} dans [0 ; 1], den > 0.
CREATE FUNCTION core.settlement_verify_ratio(p_value jsonb)
  RETURNS numeric[]
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_num numeric;
  v_den numeric;
BEGIN
  IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'object'
     OR NOT COALESCE((p_value -> 'num' ->> '$bigint') ~ '^-?[0-9]{1,19}$', false)
     OR NOT COALESCE((p_value -> 'den' ->> '$bigint') ~ '^[0-9]{1,19}$', false) THEN
    RAISE EXCEPTION 'settlement replay: ratio expected'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;
  v_num := (p_value -> 'num' ->> '$bigint')::numeric;
  v_den := (p_value -> 'den' ->> '$bigint')::numeric;
  IF v_den <= 0 OR v_num < 0 OR v_num > v_den THEN
    RAISE EXCEPTION 'settlement replay: share outside [0 ; 1]'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;
  RETURN ARRAY[v_num, v_den];
END
$fn$;

-- hostFromGuest(retenu) = max(0, allocHost(P) + promoHost + allocHost(D) + allocHost(Extras)).
-- Indices des lignes : 1 tripPrice, 2 promoPlatform, 3 promoHost, 4 tripFee, 5 protection,
-- 6 extras, 7 enhancedRoadside, 8 additionalDriver, 9 youngDriver, 10 delivery.
CREATE FUNCTION core.settlement_verify_host_from_guest(p_lines numeric[], p_host numeric[],
                                                       p_delivery numeric[], p_extras numeric[])
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT GREATEST(0, core.settlement_verify_alloc_host(p_lines[1], p_host) + p_lines[3]
                     + core.settlement_verify_alloc_host(p_lines[10], p_delivery)
                     + core.settlement_verify_alloc_host(p_lines[6], p_extras))
$fn$;

-- 08 E7 legs(trip, retenu, taxe retenue par groupe, hostFromGuest) : {HOST, INSURER,
-- TAX_THIRD_PARTY, PLATFORM} ; la plateforme prend le complément (Σ jambes = retenu TTC).
CREATE FUNCTION core.settlement_verify_legs(p_trip jsonb, p_currency text, p_lines numeric[],
                                            p_tax_third boolean[], p_tax_kept numeric[],
                                            p_host_from_guest numeric)
  RETURNS numeric[]
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_insurer numeric := 0;
  v_tax3    numeric := 0;
  v_total   numeric := 0;
  v_share   numeric[];
  v_i       integer;
BEGIN
  -- part assureur : exigée dès que la ligne retenue n'est pas nulle (absente ⇒ refus, jamais 0)
  IF p_lines[5] <> 0 THEN
    v_share := core.settlement_verify_ratio(p_trip -> 'insurerPremiumShareFrozen');
    v_insurer := v_insurer + core.settlement_verify_round(p_lines[5], v_share[1], v_share[2]);
  END IF;
  IF p_lines[7] <> 0 THEN
    v_share := core.settlement_verify_ratio(p_trip -> 'insurerRoadsideShareFrozen');
    v_insurer := v_insurer + core.settlement_verify_round(p_lines[7], v_share[1], v_share[2]);
  END IF;
  FOR v_i IN 1 .. 10 LOOP
    v_total := v_total + p_lines[v_i];
  END LOOP;
  FOR v_i IN 1 .. COALESCE(pg_catalog.array_length(p_tax_kept, 1), 0) LOOP
    v_total := v_total + p_tax_kept[v_i];
    IF p_tax_third[v_i] THEN
      v_tax3 := v_tax3 + p_tax_kept[v_i];
    END IF;
  END LOOP;
  RETURN ARRAY[p_host_from_guest, v_insurer, v_tax3,
               v_total - p_host_from_guest - v_insurer - v_tax3];
END
$fn$;

-- Rejeu de computeCancellationSettlement (cxl-beta/1, sous-ensemble bêta) sur les entrées
-- canoniques. Rend les sorties comparables à la version stockée (montants en chaînes d'entiers).
CREATE FUNCTION core.settlement_verify_cxl_beta_1(p_inputs jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  c_lines     CONSTANT text[] := ARRAY['tripPrice', 'promoPlatform', 'promoHost', 'tripFee',
                                       'protection', 'extras', 'enhancedRoadside',
                                       'additionalDriver', 'youngDriver', 'delivery'];
  c_beta      CONSTANT text[] := ARRAY['GUEST_CANCELLED', 'GUEST_NO_SHOW',
                                       'HOST_CANCELLED_DUE_TO_GUEST', 'PLATFORM_INCOMPLETE_STEPS',
                                       'GUEST_FRAUD_PROVEN', 'HOST_CANCELLED', 'HOST_NO_SHOW',
                                       'PLATFORM_TRUST_SAFETY', 'HOST_ACCOUNT_CLOSED',
                                       'PLATFORM_REVIEW_DELAY', 'PSP_FAILURE'];
  c_no_show   CONSTANT text[] := ARRAY['INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED',
                                       'OTHER_DRIVER_SENT', 'LICENSE_NOT_UPLOADED_1H'];
  c_pickup    CONSTANT text[] := ARRAY['INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED',
                                       'OTHER_DRIVER_SENT'];
  c_minute    CONSTANT numeric := 60000;
  c_hour      CONSTANT numeric := 3600000;
  t           jsonb;
  e           jsonb;
  p           jsonb;
  g           jsonb;
  v_cur       text;
  v_days      numeric;
  v_rate      text;
  v_start     numeric;
  v_booked    numeric;
  v_total     numeric;
  v_hs        numeric[];
  v_ds        numeric[];
  v_es        numeric[];
  v_line      numeric[] := pg_catalog.array_fill(0::numeric, ARRAY[10]);
  v_refund    numeric[] := pg_catalog.array_fill(0::numeric, ARRAY[10]);
  v_ret       numeric[] := pg_catalog.array_fill(0::numeric, ARRAY[10]);
  v_key       text;
  v_i         integer;
  v_k         integer;
  v_idx       integer;
  v_ids       text[] := '{}';
  v_third     boolean[] := '{}';
  v_paid      numeric[] := '{}';
  v_tref      numeric[] := '{}';
  v_tkept     numeric[] := '{}';
  v_groups    jsonb[] := '{}';
  v_sum       numeric := 0;
  v_grace     numeric;
  v_lmh       numeric;
  v_fcl       numeric;
  v_no_show   numeric;
  v_free      numeric;
  v_req       text;
  v_reason    text;
  v_origin    text;
  v_at        numeric;
  v_sub       text;
  v_qual      text;
  v_comp_kind text;
  v_target    text;
  v_pen_kind  text;
  v_done      boolean := false;
  v_jn        numeric;
  v_jd        numeric;
  v_comp      numeric := 0;
  v_penalty   numeric := 0;
  v_fee       jsonb;
  v_eligible  boolean;
  v_base      numeric;
  v_refd      numeric;
  v_n         numeric;
  v_d         numeric;
  v_hfg       numeric;
  v_tax_ref   numeric := 0;
  v_retained  numeric := 0;
  v_ret_tax   numeric := 0;
  v_guest     numeric;
  v_capture   numeric[];
  v_settled   numeric[];
  v_lines_out jsonb := '{}'::jsonb;
  v_tax_out   jsonb := '{}'::jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_inputs) IS DISTINCT FROM 'object'
     OR (p_inputs ->> 'engineVersion') IS DISTINCT FROM 'cxl-beta/1' THEN
    RAISE EXCEPTION 'settlement replay: engine version not verifiable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_unsupported';
  END IF;
  t := p_inputs -> 'trip';
  e := p_inputs -> 'event';
  p := p_inputs -> 'params';
  IF pg_catalog.jsonb_typeof(t) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(e) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(t -> 'lines') IS DISTINCT FROM 'object'
     OR pg_catalog.jsonb_typeof(t -> 'taxGroups') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'settlement replay: trip, event and params required'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;

  -- validateTrip ---------------------------------------------------------------------------------
  v_cur := t -> 'currency' ->> 'code';
  v_days := core.settlement_verify_int(t -> 'days');
  v_rate := t ->> 'rateType';
  v_start := core.settlement_verify_int(t -> 'startAtMs');
  v_booked := core.settlement_verify_int(t -> 'bookedAtMs');
  IF NOT COALESCE(v_cur ~ '^[A-Z]{3}$', false) OR v_days < 1
     OR v_rate IS NULL OR v_rate NOT IN ('REFUNDABLE', 'NON_REFUNDABLE') OR v_booked > v_start THEN
    RAISE EXCEPTION 'settlement replay: invalid trip'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;
  FOR v_key IN SELECT y.k FROM pg_catalog.jsonb_object_keys(t -> 'lines') AS y(k) LOOP
    v_idx := pg_catalog.array_position(c_lines, v_key);
    IF v_idx IS NULL THEN
      RAISE EXCEPTION 'settlement replay: unknown line %', v_key
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
    END IF;
    v_line[v_idx] := core.settlement_verify_minor(t -> 'lines' -> v_key, v_cur);
  END LOOP;
  FOR g IN SELECT x.value FROM pg_catalog.jsonb_array_elements(t -> 'taxGroups') WITH ORDINALITY AS x(value, ordinality)
            ORDER BY x.ordinality LOOP
    IF pg_catalog.jsonb_typeof(g -> 'id') IS DISTINCT FROM 'string'
       OR (g ->> 'id') = ANY (v_ids)
       OR pg_catalog.jsonb_typeof(g -> 'thirdParty') IS DISTINCT FROM 'boolean'
       OR pg_catalog.jsonb_typeof(g -> 'lines') IS DISTINCT FROM 'array'
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(g -> 'lines') AS y(l)
                   WHERE pg_catalog.jsonb_typeof(l) IS DISTINCT FROM 'string'
                      OR pg_catalog.array_position(c_lines, l #>> '{}') IS NULL) THEN
      RAISE EXCEPTION 'settlement replay: invalid tax group'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
    END IF;
    v_ids := v_ids || (g ->> 'id');
    v_third := v_third || ((g -> 'thirdParty') = 'true'::jsonb);
    v_paid := v_paid || core.settlement_verify_minor(g -> 'taxPaid', v_cur);
    v_groups := v_groups || g;
  END LOOP;
  v_hs := core.settlement_verify_ratio(t -> 'hostSharePctFrozen');
  v_ds := core.settlement_verify_ratio(t -> 'deliverySharePct');
  v_es := core.settlement_verify_ratio(t -> 'extrasSharePct');
  v_total := core.settlement_verify_minor(t -> 'totalPaid', v_cur);
  FOR v_i IN 1 .. 10 LOOP
    v_sum := v_sum + v_line[v_i];
  END LOOP;
  FOR v_k IN 1 .. COALESCE(pg_catalog.array_length(v_paid, 1), 0) LOOP
    v_sum := v_sum + v_paid[v_k];
  END LOOP;
  IF v_sum <> v_total THEN
    RAISE EXCEPTION 'settlement replay: total paid differs from lines and tax'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;

  -- validateParams --------------------------------------------------------------------------------
  v_grace := core.settlement_verify_int(p -> 'noShowGraceMinutes');
  v_lmh := core.settlement_verify_int(p -> 'lastMinuteThresholdHours');
  v_fcl := core.settlement_verify_int(p -> 'freeCancelLeadHours');
  IF v_grace < 0 OR v_lmh < 0 OR v_fcl < 0 THEN
    RAISE EXCEPTION 'settlement replay: invalid params'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;

  -- qualify (règles 1 à 3 de 08) -----------------------------------------------------------------
  v_req := e ->> 'reason';
  IF pg_catalog.jsonb_typeof(e -> 'reason') IS DISTINCT FROM 'string' OR NOT (v_req = ANY (c_beta)) THEN
    RAISE EXCEPTION 'settlement replay: reason outside the beta subset'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;
  v_at := core.settlement_verify_int(e -> 'requestedAtMs');
  v_sub := CASE WHEN pg_catalog.jsonb_typeof(e -> 'subReason') = 'string' THEN e ->> 'subReason' END;
  v_no_show := v_start + v_grace * c_minute;
  v_reason := v_req;
  v_origin := 'EVENT';
  IF v_req = 'GUEST_CANCELLED' AND v_at >= v_no_show THEN
    IF NOT core.settlement_verify_flag(e -> 'checkinValidated', 'checkinValidated') THEN
      v_reason := 'GUEST_NO_SHOW';
      v_origin := 'LATE_GUEST_CANCELLATION';
    END IF;
  ELSIF v_req = 'HOST_CANCELLED_DUE_TO_GUEST' THEN
    IF NOT (COALESCE(v_sub = ANY (c_no_show), false)
            AND COALESCE((e -> 'evidenceValidated') = 'true'::jsonb, false)) THEN
      v_reason := 'HOST_CANCELLED';
      v_origin := 'REQUALIFIED_NO_EVIDENCE';
    END IF;
  ELSIF v_req = 'GUEST_NO_SHOW' AND v_at < v_no_show THEN
    IF NOT COALESCE(v_sub = ANY (c_pickup), false) THEN
      RAISE EXCEPTION 'settlement replay: no-show declared too early'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
    END IF;
    v_origin := 'PICKUP_CHECK';
  END IF;

  -- table de décision (lignes bêta de 08) ----------------------------------------------------------
  SELECT r.q, r.c, r.s, r.k INTO v_qual, v_comp_kind, v_target, v_pen_kind
    FROM (VALUES
            ('GUEST_CANCELLED', 'VOLUNTARY', 'NONE', 'CANCELLED_BY_GUEST', 'NONE'),
            ('GUEST_NO_SHOW', 'NO_SHOW', 'NONE', 'NO_SHOW_GUEST', 'NONE'),
            ('HOST_CANCELLED_DUE_TO_GUEST', 'NO_SHOW', 'NONE', 'NO_SHOW_GUEST', 'NONE'),
            ('PLATFORM_INCOMPLETE_STEPS', 'FAULT_PRE_START', 'NONE', 'CANCELLED_BY_PLATFORM', 'NONE'),
            ('GUEST_FRAUD_PROVEN', 'FAULT_PRE_START', 'NONE', 'CANCELLED_BY_PLATFORM', 'NONE'),
            ('HOST_CANCELLED', 'FULL', 'NONE', 'CANCELLED_BY_HOST', 'HOST_CXL'),
            ('HOST_NO_SHOW', 'FULL', 'NONE', 'NO_SHOW_HOST', 'HOST_NO_SHOW'),
            ('PLATFORM_TRUST_SAFETY', 'FULL', 'LATE_CXL_AFTER_FREE_WINDOW', 'CANCELLED_BY_PLATFORM', 'NONE'),
            ('HOST_ACCOUNT_CLOSED', 'FULL', 'NONE', 'CANCELLED_BY_PLATFORM', 'NONE'),
            ('PLATFORM_REVIEW_DELAY', 'FULL', 'LATE_CXL_AFTER_FREE_WINDOW', 'CANCELLED_BY_PLATFORM', 'NONE'),
            ('PSP_FAILURE', 'FULL', 'LATE_CXL_AFTER_FREE_WINDOW', 'CANCELLED_BY_PLATFORM', 'NONE'))
           AS r(reason, q, c, s, k)
   WHERE r.reason = v_reason;

  -- freeUntil (BR-CXL-01, R03) : fenêtre gratuite d'1 h d'une réservation de dernière minute
  IF v_start - v_booked < v_lmh * c_hour THEN
    v_free := LEAST(v_booked + c_hour, v_start);
  ELSE
    v_free := v_start - v_fcl * c_hour;
  END IF;

  -- lignes remboursées ----------------------------------------------------------------------------
  IF v_qual = 'FULL' THEN
    v_refund := v_line;
    v_done := true;
    -- compensation financée par la plateforme : seul `true` exact active l'option A (T61)
    IF COALESCE((p -> 'platformFundedHostCompensation') = 'true'::jsonb, false)
       AND v_comp_kind = 'LATE_CXL_AFTER_FREE_WINDOW' AND v_at > v_free THEN
      IF v_days > 2 THEN v_jn := 1; v_jd := 1; ELSE v_jn := 1; v_jd := 2; END IF;
      v_comp := GREATEST(0,
        core.settlement_verify_alloc_host(
          core.settlement_verify_round(v_line[1], v_jn, v_jd * v_days), v_hs)
        + core.settlement_verify_round(v_line[3], v_jn, v_jd * v_days)
        + core.settlement_verify_alloc_host(core.settlement_verify_round(v_line[10], 1, 2), v_ds));
    END IF;
  ELSIF v_qual = 'VOLUNTARY' THEN
    IF v_rate = 'NON_REFUNDABLE' AND v_at <= LEAST(v_booked + 24 * c_hour, v_start) THEN
      v_refund := v_line;
      v_done := true;
    ELSIF v_rate = 'REFUNDABLE' AND v_at <= v_free THEN
      v_refund := v_line;
      v_done := true;
    END IF;
  END IF;
  IF NOT v_done THEN
    IF v_rate = 'NON_REFUNDABLE' THEN
      -- seul le conducteur additionnel non approuvé est remboursé (BR-PRICE-08)
      IF v_line[8] <> 0
         AND NOT core.settlement_verify_flag(e -> 'additionalDriverApproved',
                                             'additionalDriverApproved') THEN
        v_refund[8] := v_line[8];
      END IF;
    ELSE
      IF v_qual = 'NO_SHOW' THEN
        IF v_days > 2 THEN v_jn := 2; v_jd := 1; ELSE v_jn := 3; v_jd := 4; END IF;
      ELSE
        IF v_days > 2 THEN v_jn := 1; v_jd := 1; ELSE v_jn := 1; v_jd := 2; END IF;
      END IF;
      v_ret[1] := core.settlement_verify_round(v_line[1], v_jn, v_jd * v_days);
      v_ret[2] := core.settlement_verify_round(v_line[2], v_jn, v_jd * v_days);
      v_ret[3] := core.settlement_verify_round(v_line[3], v_jn, v_jd * v_days);
      v_ret[4] := core.settlement_verify_round(v_line[4], v_jn, v_jd * v_days);
      v_ret[10] := core.settlement_verify_round(v_line[10], 1, 2);
      FOR v_i IN 1 .. 10 LOOP
        v_refund[v_i] := v_line[v_i] - v_ret[v_i];
      END LOOP;
    END IF;
  END IF;

  -- settle ------------------------------------------------------------------------------------------
  FOR v_i IN 1 .. 10 LOOP
    v_ret[v_i] := v_line[v_i] - v_refund[v_i];
    v_retained := v_retained + v_ret[v_i];
  END LOOP;
  FOR v_k IN 1 .. COALESCE(pg_catalog.array_length(v_paid, 1), 0) LOOP
    v_base := 0;
    v_refd := 0;
    FOR v_key IN SELECT l #>> '{}' FROM pg_catalog.jsonb_array_elements(v_groups[v_k] -> 'lines') AS y(l)
    LOOP
      v_idx := pg_catalog.array_position(c_lines, v_key);
      v_base := v_base + v_line[v_idx];
      v_refd := v_refd + v_refund[v_idx];
    END LOOP;
    -- prorata de la base taxable remboursée (A04), garde base nulle (m02)
    IF v_base = 0 THEN
      v_tref := v_tref || 0::numeric;
    ELSE
      v_n := v_refd;
      v_d := v_base;
      IF v_d < 0 THEN
        v_n := -v_n;
        v_d := -v_d;
      END IF;
      v_tref := v_tref || core.settlement_verify_round(v_paid[v_k], v_n, v_d);
    END IF;
    v_tkept := v_tkept || (v_paid[v_k] - v_tref[v_k]);
    v_tax_ref := v_tax_ref + v_tref[v_k];
    v_ret_tax := v_ret_tax + v_tkept[v_k];
  END LOOP;

  -- hostEligible (BR-CXL-08, VERIF_09-M07)
  IF v_qual IN ('VOLUNTARY', 'FAULT_PRE_START') THEN
    v_eligible := true;
  ELSIF v_qual = 'FULL' THEN
    v_eligible := false;
  ELSIF v_reason = 'HOST_CANCELLED_DUE_TO_GUEST' THEN
    v_eligible := true;
  ELSIF v_origin = 'LATE_GUEST_CANCELLATION' THEN
    v_eligible := NOT core.settlement_verify_flag(e -> 'hostNoShowReportedBefore',
                                                  'hostNoShowReportedBefore');
  ELSE
    v_eligible := core.settlement_verify_flag(e -> 'hostMessageTraced', 'hostMessageTraced')
                  AND v_no_show <= v_at AND v_at <= v_start + 72 * c_hour;
  END IF;
  v_hfg := CASE WHEN v_eligible
                THEN core.settlement_verify_host_from_guest(v_ret, v_hs, v_ds, v_es) ELSE 0 END;

  v_guest := v_tax_ref;
  FOR v_i IN 1 .. 10 LOOP
    v_guest := v_guest + v_refund[v_i];
  END LOOP;
  IF v_guest + v_retained + v_ret_tax <> v_total THEN
    RAISE EXCEPTION 'settlement replay: refund + retained + retained tax <> total paid'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;

  v_capture := core.settlement_verify_legs(t, v_cur, v_line, v_third, v_paid,
                 core.settlement_verify_host_from_guest(v_line, v_hs, v_ds, v_es));
  v_settled := core.settlement_verify_legs(t, v_cur, v_ret, v_third, v_tkept, v_hfg);
  -- HOST planchéré à 0, INSURER et TAX_THIRD_PARTY ≥ 0 : seule PLATFORM peut être négative
  IF v_settled[1] < 0 OR v_settled[2] < 0 OR v_settled[3] < 0 THEN
    RAISE EXCEPTION 'settlement replay: negative non-platform leg'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
  END IF;

  -- pénalité de l'hôte (BR-CXL-13) : barème par devise, absent quand il est dû ⇒ refus
  IF v_pen_kind <> 'NONE' AND NOT COALESCE((e -> 'hostPenaltyWaived') = 'true'::jsonb, false) THEN
    IF pg_catalog.jsonb_typeof(p -> 'hostPenalty') IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'settlement replay: host penalty schedule missing'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_input_invalid';
    END IF;
    IF v_pen_kind = 'HOST_NO_SHOW' THEN
      v_fee := p -> 'hostPenalty' -> 'hostNoShow';
    ELSIF v_start - v_at > 24 * c_hour THEN
      v_fee := p -> 'hostPenalty' -> 'cxlEarly';
    ELSE
      v_fee := p -> 'hostPenalty' -> 'cxlLate';
    END IF;
    v_penalty := core.settlement_verify_minor(v_fee, v_cur);
  END IF;

  FOR v_i IN 1 .. 10 LOOP
    v_lines_out := v_lines_out || pg_catalog.jsonb_build_object(c_lines[v_i],
      pg_catalog.jsonb_build_array(v_line[v_i]::bigint::text, v_refund[v_i]::bigint::text,
                                   v_ret[v_i]::bigint::text));
  END LOOP;
  FOR v_k IN 1 .. COALESCE(pg_catalog.array_length(v_paid, 1), 0) LOOP
    v_tax_out := v_tax_out || pg_catalog.jsonb_build_object(v_ids[v_k],
      pg_catalog.jsonb_build_array(v_third[v_k]::text, v_paid[v_k]::bigint::text,
                                   v_tref[v_k]::bigint::text, v_tkept[v_k]::bigint::text));
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'kind', 'CANCELLATION',
    'engineVersion', 'cxl-beta/1',
    'currency', v_cur,
    'requestedReason', v_req,
    'reason', v_reason,
    'origin', v_origin,
    'qualification', v_qual,
    'targetState', v_target,
    'hostEligible', v_eligible,
    'negativeLeg', v_settled[4] < 0,
    'totalPaidMinor', v_total::bigint::text,
    'guestRefundMinor', v_guest::bigint::text,
    'taxRefundMinor', v_tax_ref::bigint::text,
    'retainedMinor', v_retained::bigint::text,
    'retainedTaxMinor', v_ret_tax::bigint::text,
    'hostFromGuestMinor', v_hfg::bigint::text,
    'hostCompensationMinor', v_comp::bigint::text,
    'hostEarningsMinor', (v_hfg + v_comp)::bigint::text,
    'platformNetMinor', (v_retained - v_hfg - v_comp)::bigint::text,
    'hostPenaltyMinor', v_penalty::bigint::text,
    'lines', v_lines_out,
    'taxGroups', v_tax_out,
    'settled', pg_catalog.jsonb_build_object(
      'HOST', v_settled[1]::bigint::text, 'INSURER', v_settled[2]::bigint::text,
      'TAX_THIRD_PARTY', v_settled[3]::bigint::text, 'PLATFORM', v_settled[4]::bigint::text),
    'capture', pg_catalog.jsonb_build_object(
      'HOST', v_capture[1]::bigint::text, 'INSURER', v_capture[2]::bigint::text,
      'TAX_THIRD_PARTY', v_capture[3]::bigint::text, 'PLATFORM', v_capture[4]::bigint::text));
END
$fn$;

COMMENT ON FUNCTION core.settlement_verify_cxl_beta_1(jsonb) IS
  'Vérificateur indépendant du moteur cxl-beta/1 (08 BR-CXL, E7) : rejoue les entrées canoniques '
  'd''un règlement ; ne produit aucun montant stocké. US-049, ADR-083.';

-- 3. Versement d'une jambe (RC-3) : première condition non remplie, ou NULL ---------------------
CREATE FUNCTION core.settlement_release_blocker(p_operation_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip    uuid;
  v_country text;
  v_account uuid;
  v_kind    text;
  v_status  text;
  v_org     uuid;
  v_now     timestamptz := platform.now();
BEGIN
  SELECT o.trip_id, o.country_code, o.psp_account_id, o.kind
    INTO v_trip, v_country, v_account, v_kind
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND OR v_kind IS DISTINCT FROM 'LEG_RELEASE' OR v_trip IS NULL THEN
    RETURN 'leg_release_trip_not_completed';
  END IF;
  SELECT t.status, t.org_id INTO v_status, v_org FROM core.booking_trip AS t WHERE t.id = v_trip;
  -- 08 BR-PAYOUT : la jambe HOST reste chez le PSP jusqu'à la fin du trajet
  IF v_status IS DISTINCT FROM 'COMPLETED' THEN
    RETURN 'leg_release_trip_not_completed';
  END IF;
  -- 08 E7 règle 6 : versement différé jusqu'à release_at (payout_at), posé et atteint
  IF EXISTS (SELECT 1
               FROM core.payment_payment_operation_leg AS l
               LEFT JOIN core.settlement_trip_leg_balance AS b
                 ON b.trip_id = v_trip AND b.segment_no = 1 AND b.leg = l.leg
              WHERE l.operation_id = p_operation_id AND l.amount_minor > 0
                AND (b.release_at IS NULL OR b.release_at > v_now)) THEN
    RETURN 'leg_release_not_due';
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
              WHERE l.operation_id = p_operation_id AND l.leg = 'HOST' AND l.amount_minor > 0)
     AND NOT EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS s
                      WHERE s.psp_account_id = v_account AND s.org_id = v_org
                        AND s.kyc_status = 'ACTIVE') THEN
    RETURN 'leg_release_submerchant_inactive';
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
              WHERE l.operation_id = p_operation_id AND l.leg = 'INSURER' AND l.amount_minor > 0)
     AND NOT core.config_go_live('insurer_contract_active', v_country) THEN
    RETURN 'leg_release_insurer_inactive';
  END IF;
  -- 17 §0.1 : interrupteur du pays, false en production, lu fail-closed
  IF NOT core.config_go_live('payouts_enabled', v_country) THEN
    RETURN 'leg_release_payouts_disabled';
  END IF;
  RETURN NULL;
END
$fn$;

COMMENT ON FUNCTION core.settlement_release_blocker(uuid) IS
  'Garde du versement d''une jambe (LEG_RELEASE) : trip COMPLETED, release_at atteint, sous-marchand '
  'ACTIVE, interrupteurs du pays. Rend la première contrainte violée ou NULL. US-049, ADR-083.';

-- Garde à l'enregistrement de l'ordre : un LEG_RELEASE refusé n'est jamais créé (donc jamais
-- transmis au PSP). Trigger d'instruction : les quatre jambes de l'opération sont visibles.
CREATE FUNCTION core.payment_operation_leg_release_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r       record;
  v_block text;
BEGIN
  FOR r IN
    SELECT DISTINCT n.operation_id
      FROM new_legs AS n
      JOIN core.payment_payment_operation AS o ON o.id = n.operation_id
     WHERE o.kind = 'LEG_RELEASE'
  LOOP
    v_block := core.settlement_release_blocker(r.operation_id);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'payment: leg release of operation % refused (%)', r.operation_id, v_block
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = v_block;
    END IF;
  END LOOP;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER payment_operation_leg_release_guard
  AFTER INSERT ON core.payment_payment_operation_leg
  REFERENCING NEW TABLE AS new_legs
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_operation_leg_release_guard();

REVOKE ALL ON FUNCTION
  core.settlement_verify_floor_div(numeric, numeric),
  core.settlement_verify_round(numeric, numeric, numeric),
  core.settlement_verify_alloc_host(numeric, numeric[]),
  core.settlement_verify_int(jsonb),
  core.settlement_verify_flag(jsonb, text),
  core.settlement_verify_minor(jsonb, text),
  core.settlement_verify_ratio(jsonb),
  core.settlement_verify_host_from_guest(numeric[], numeric[], numeric[], numeric[]),
  core.settlement_verify_legs(jsonb, text, numeric[], boolean[], numeric[], numeric),
  core.settlement_verify_cxl_beta_1(jsonb),
  core.settlement_release_blocker(uuid),
  core.payment_operation_leg_release_guard()
  FROM PUBLIC;
-- le trigger différé et les commandes (cmd_money_owner) appellent le vérificateur et la garde ;
-- app_worker peut rejouer des entrées (lecture pure, aucune donnée lue en base)
GRANT EXECUTE ON FUNCTION
  core.settlement_verify_floor_div(numeric, numeric),
  core.settlement_verify_round(numeric, numeric, numeric),
  core.settlement_verify_alloc_host(numeric, numeric[]),
  core.settlement_verify_int(jsonb),
  core.settlement_verify_flag(jsonb, text),
  core.settlement_verify_minor(jsonb, text),
  core.settlement_verify_ratio(jsonb),
  core.settlement_verify_host_from_guest(numeric[], numeric[], numeric[], numeric[]),
  core.settlement_verify_legs(jsonb, text, numeric[], boolean[], numeric[], numeric),
  core.settlement_verify_cxl_beta_1(jsonb)
  TO cmd_money_owner, app_worker;
GRANT EXECUTE ON FUNCTION core.settlement_release_blocker(uuid) TO cmd_money_owner;

-- 4. Fonctions de cmd_money_owner remplacées (ADR-044 amendé : CREATE le temps du remplacement) --
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 4.1 Invariants d'un règlement (0027 §7) + trip figé entre versions + rejeu des entrées (RC-1).
CREATE OR REPLACE FUNCTION core.settlement_assert_balanced()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s            record;
  v_trip_org   uuid;
  v_trip_cur   text;
  v_legs       integer;
  v_signed     bigint;
  v_variation  bigint;
  v_advance    bigint;
  v_basis      bigint;
  v_host       bigint;
  v_tax3       bigint;
  v_line_amt   bigint;
  v_line_ref   bigint;
  v_line_ret   bigint;
  v_tax_paid   bigint;
  v_tax_ref    bigint;
  v_tax_ret    bigint;
  v_tax3_ret   bigint;
  v_mismatch   integer;
  v_captured   integer;
  v_prev_ref   bigint;
  v_expected   jsonb;
  v_actual     jsonb;
  v_lines_j    jsonb;
  v_taxes_j    jsonb;
  v_settled_j  jsonb;
  v_basis_j    jsonb;
BEGIN
  SELECT * INTO s FROM core.settlement_settlement AS x WHERE x.id = NEW.id;

  SELECT t.org_id, t.currency INTO v_trip_org, v_trip_cur
    FROM core.booking_trip AS t WHERE t.id = s.trip_id;
  IF v_trip_org IS DISTINCT FROM s.org_id OR v_trip_cur IS DISTINCT FROM s.currency THEN
    RAISE EXCEPTION 'settlement %: compte d''hôte ou devise différents du trip', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_mismatch';
  END IF;

  -- remboursement de la version remplacée : Σ variations = − (remboursement v n+1 − remboursement v n)
  v_prev_ref := 0;
  IF s.supersedes_id IS NOT NULL THEN
    SELECT p.guest_refund_minor INTO v_prev_ref
      FROM core.settlement_settlement AS p WHERE p.id = s.supersedes_id;
  END IF;

  SELECT count(*)::integer, COALESCE(sum(l.kept_minor - l.advance_minor), 0),
         COALESCE(sum(l.variation_minor), 0), COALESCE(sum(l.advance_minor), 0),
         COALESCE(sum(l.basis_minor), 0),
         COALESCE(sum(l.kept_minor) FILTER (WHERE l.leg = 'HOST'), 0),
         COALESCE(sum(l.kept_minor) FILTER (WHERE l.leg = 'TAX_THIRD_PARTY'), 0)
    INTO v_legs, v_signed, v_variation, v_advance, v_basis, v_host, v_tax3
    FROM core.settlement_settlement_leg AS l WHERE l.settlement_id = s.id;

  SELECT COALESCE(sum(x.amount_minor), 0), COALESCE(sum(x.refund_minor), 0),
         COALESCE(sum(x.retained_minor), 0)
    INTO v_line_amt, v_line_ref, v_line_ret
    FROM core.settlement_settlement_line AS x WHERE x.settlement_id = s.id;
  SELECT COALESCE(sum(x.tax_paid_minor), 0), COALESCE(sum(x.tax_refund_minor), 0),
         COALESCE(sum(x.retained_tax_minor), 0),
         COALESCE(sum(x.retained_tax_minor) FILTER (WHERE x.third_party), 0)
    INTO v_tax_paid, v_tax_ref, v_tax_ret, v_tax3_ret
    FROM core.settlement_settlement_tax_line AS x WHERE x.settlement_id = s.id;

  IF v_legs <> 4
     OR v_signed <> s.retained_minor + s.retained_tax_minor          -- Σ jambes = retenu TTC
     OR v_variation <> v_prev_ref - s.guest_refund_minor              -- Σ variations = − Δ remboursement
     OR v_host <> s.host_from_guest_minor                             -- HOST = hostFromGuest (E7)
     OR v_tax3 <> v_tax3_ret                                          -- TAX_THIRD_PARTY = taxe tiers retenue
     OR v_line_amt + v_tax_paid <> s.total_paid_minor                 -- lignes + taxes = total payé
     OR v_line_ref + v_tax_ref <> s.guest_refund_minor
     OR v_line_ret <> s.retained_minor
     OR v_tax_ref <> s.tax_refund_minor
     OR v_tax_ret <> s.retained_tax_minor THEN
    RAISE EXCEPTION 'settlement %: invariants de montant ou de jambe violés', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_unbalanced';
  END IF;

  IF s.negative_leg IS DISTINCT FROM (v_advance > 0) THEN
    RAISE EXCEPTION 'settlement %: drapeau negative_leg incohérent avec les avances', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_negative_leg_flag';
  END IF;

  -- Base de la variation : version n (supersession) ou état capturé (v1).
  SELECT count(*)::integer INTO v_captured
    FROM core.settlement_trip_leg_balance AS b
   WHERE b.trip_id = s.trip_id AND b.segment_no = s.segment_no;
  IF s.supersedes_id IS NOT NULL AND v_captured = 0 THEN
    -- une requalification suppose des fonds capturés tenus par jambe (ADR-057)
    RAISE EXCEPTION 'settlement %: version n+1 sans état capturé tenu (trip_leg_balance)', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_capture_missing';
  END IF;
  IF s.supersedes_id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_mismatch
      FROM core.settlement_settlement_leg AS cur
      LEFT JOIN core.settlement_settlement_leg AS prev
        ON prev.settlement_id = s.supersedes_id AND prev.leg = cur.leg
     WHERE cur.settlement_id = s.id
       AND (prev.leg IS NULL OR cur.basis_minor <> prev.kept_minor - prev.advance_minor);
  ELSE
    IF v_captured > 0 THEN
      SELECT count(*)::integer INTO v_mismatch
        FROM core.settlement_settlement_leg AS cur
        LEFT JOIN core.settlement_trip_leg_balance AS b
          ON b.trip_id = s.trip_id AND b.segment_no = s.segment_no AND b.leg = cur.leg
       WHERE cur.settlement_id = s.id
         AND (b.leg IS NULL OR cur.basis_minor <> b.captured_minor);
    ELSE
      -- état capturé non tenu : jambes ≥ 0 (E7 règle 5) et Σ = total payé ; l'égalité jambe par
      -- jambe à l'état capturé RECALCULÉ est contrôlée par le rejeu ci-dessous (US-049, RC-1)
      SELECT count(*)::integer INTO v_mismatch
        FROM core.settlement_settlement_leg AS cur
       WHERE cur.settlement_id = s.id AND cur.basis_minor < 0;
      IF v_basis <> s.total_paid_minor THEN
        v_mismatch := v_mismatch + 1;
      END IF;
    END IF;
  END IF;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'settlement %: base des variations différente de la version n ou de la capture', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_basis_mismatch';
  END IF;

  -- US-049 (RC-1) : la version n+1 porte sur le même devis figé que la version n (08 E1, BR-CXL-03)
  IF s.supersedes_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM core.settlement_settlement AS p
                      WHERE p.id = s.supersedes_id AND p.engine_version = s.engine_version
                        AND (p.inputs::jsonb -> 'trip') = (s.inputs::jsonb -> 'trip')) THEN
    RAISE EXCEPTION 'settlement %: trip ou version du moteur différents de la version n', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_inputs_changed';
  END IF;

  -- US-049 (RC-1) : rejeu indépendant des entrées ; tout champ différent ⇒ refus (08 E4)
  IF s.kind IS DISTINCT FROM 'CANCELLATION' OR s.engine_version IS DISTINCT FROM 'cxl-beta/1' THEN
    RAISE EXCEPTION 'settlement %: nature ou version du moteur sans vérificateur', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_unsupported';
  END IF;
  v_expected := core.settlement_verify_cxl_beta_1(s.inputs::jsonb);

  SELECT COALESCE(pg_catalog.jsonb_object_agg(x.line_type, pg_catalog.jsonb_build_array(
           x.amount_minor::text, x.refund_minor::text, x.retained_minor::text)), '{}'::jsonb)
    INTO v_lines_j
    FROM core.settlement_settlement_line AS x WHERE x.settlement_id = s.id;
  SELECT COALESCE(pg_catalog.jsonb_object_agg(x.tax_group, pg_catalog.jsonb_build_array(
           x.third_party::text, x.tax_paid_minor::text, x.tax_refund_minor::text,
           x.retained_tax_minor::text)), '{}'::jsonb)
    INTO v_taxes_j
    FROM core.settlement_settlement_tax_line AS x WHERE x.settlement_id = s.id;
  SELECT COALESCE(pg_catalog.jsonb_object_agg(l.leg, (l.kept_minor - l.advance_minor)::text), '{}'::jsonb),
         COALESCE(pg_catalog.jsonb_object_agg(l.leg, l.basis_minor::text), '{}'::jsonb)
    INTO v_settled_j, v_basis_j
    FROM core.settlement_settlement_leg AS l WHERE l.settlement_id = s.id;

  v_actual := pg_catalog.jsonb_build_object(
    'kind', s.kind,
    'engineVersion', s.engine_version,
    'currency', s.currency,
    'requestedReason', s.requested_reason,
    'reason', s.reason,
    'origin', s.origin,
    'qualification', s.qualification,
    'targetState', s.target_state,
    'hostEligible', s.host_eligible,
    'negativeLeg', s.negative_leg,
    'totalPaidMinor', s.total_paid_minor::text,
    'guestRefundMinor', s.guest_refund_minor::text,
    'taxRefundMinor', s.tax_refund_minor::text,
    'retainedMinor', s.retained_minor::text,
    'retainedTaxMinor', s.retained_tax_minor::text,
    'hostFromGuestMinor', s.host_from_guest_minor::text,
    'hostCompensationMinor', s.host_compensation_minor::text,
    'hostEarningsMinor', s.host_earnings_minor::text,
    'platformNetMinor', s.platform_net_minor::text,
    'hostPenaltyMinor', s.host_penalty_minor::text,
    'lines', v_lines_j,
    'taxGroups', v_taxes_j,
    'settled', v_settled_j);
  IF s.supersedes_id IS NULL THEN
    -- v1 : base des variations = état capturé recalculé depuis les entrées
    v_actual := v_actual || pg_catalog.jsonb_build_object('capture', v_basis_j);
  ELSE
    v_expected := v_expected - 'capture';
  END IF;
  IF v_actual IS DISTINCT FROM v_expected THEN
    RAISE EXCEPTION 'settlement %: montants différents du rejeu des entrées', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_replay_mismatch';
  END IF;
  RETURN NULL;
END
$fn$;

-- 4.2 Report d'une opération réussie sur les soldes par jambe (0039 §7.3) + gardes RC-2 et RC-3.
CREATE OR REPLACE FUNCTION core.settlement_cmd_apply_leg_movement(p_operation_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip_id     uuid;
  v_kind        text;
  v_purpose     text;
  v_status      text;
  v_currency    text;
  v_account     uuid;
  v_org         uuid;
  v_country     text;
  v_trip_cur    text;
  v_mode        text;
  v_n           integer;
  r             record;
  v_debit       bigint;
  v_avail       bigint;
  v_block       text;
  v_head_refund bigint;
  v_over        integer;
  v_after       bigint;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'settlement: apply_leg_movement reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT o.trip_id, o.kind, o.purpose, o.currency, o.psp_account_id
    INTO v_trip_id, v_kind, v_purpose, v_currency, v_account
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND OR v_trip_id IS NULL OR v_account IS NULL THEN
    RAISE EXCEPTION 'settlement: operation % has no trip leg to move', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- verrou du trip : un seul écrivain des soldes du trip à la fois (17 §2.9, §4.3 point 1)
  SELECT t.org_id, t.country_code, t.currency INTO v_org, v_country, v_trip_cur
    FROM core.booking_trip AS t WHERE t.id = v_trip_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m WHERE m.operation_id = p_operation_id) THEN
    RETURN 'DUPLICATE';
  END IF;

  -- statut relu SOUS le verrou du trip
  SELECT o.status INTO v_status FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF v_status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'settlement: operation % is %, not SUCCEEDED', p_operation_id, v_status
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_not_succeeded';
  END IF;
  IF v_purpose NOT IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION')
     OR v_kind NOT IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION', 'REFUND', 'LEG_REALLOCATION',
                       'LEG_RELEASE')
     OR v_currency IS DISTINCT FROM v_trip_cur THEN
    RAISE EXCEPTION 'settlement: operation % (% / %) is outside the rent leg perimeter',
                    p_operation_id, v_kind, v_purpose
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;
  SELECT count(*)::integer INTO v_n
    FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = p_operation_id;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'settlement: operation % has % legs, 4 expected', p_operation_id, v_n
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- US-049 (RC-3) : fonds détenus par Kmino (mode autre que SPLIT_AT_SOURCE) seulement si
  -- funds_holding_enabled[pays] (17 §0.1, lecture fail-closed) ; défense derrière le CHECK de 0028
  SELECT a.collection_mode INTO v_mode FROM core.payment_psp_account AS a WHERE a.id = v_account;
  IF v_mode IS DISTINCT FROM 'SPLIT_AT_SOURCE'
     AND NOT core.config_go_live('funds_holding_enabled', v_country) THEN
    RAISE EXCEPTION 'settlement: funds holding is disabled for %', v_country
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_funds_holding_disabled';
  END IF;

  -- quatre lignes de solde du segment (bêta : segment 1), créées à zéro au premier mouvement
  INSERT INTO core.settlement_trip_leg_balance (trip_id, segment_no, leg, org_id, country_code, currency)
  SELECT v_trip_id, 1, l.leg, v_org, v_country, v_trip_cur
    FROM unnest(ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM']) AS l(leg)
  ON CONFLICT (trip_id, segment_no, leg) DO NOTHING;

  -- US-049 (RC-3) : versement gardé (trip terminé, release_at, sous-marchand, interrupteurs),
  -- relu ici sous le verrou du trip en plus de l'enregistrement de l'ordre
  IF v_kind = 'LEG_RELEASE' THEN
    v_block := core.settlement_release_blocker(p_operation_id);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'settlement: leg release of operation % refused (%)', p_operation_id, v_block
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = v_block;
    END IF;
  END IF;

  -- contrôle des débits sur les soldes verrouillés (17 §4.3 point 8, 08 E7 règle 3 bis)
  FOR r IN
    SELECT l.leg, l.amount_minor, b.captured_minor, b.refunded_minor, b.reallocated_in_minor,
           b.reallocated_out_minor, b.released_minor, b.frozen
      FROM core.payment_payment_operation_leg AS l
      JOIN core.settlement_trip_leg_balance AS b
        ON b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
     WHERE l.operation_id = p_operation_id
     ORDER BY array_position(ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'], l.leg)
       FOR UPDATE OF b
  LOOP
    v_debit := CASE
                 WHEN v_kind IN ('REFUND', 'LEG_RELEASE') THEN r.amount_minor
                 WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(-r.amount_minor, 0)
                 ELSE 0
               END;
    IF v_debit > 0 THEN
      IF r.frozen THEN
        RAISE EXCEPTION 'settlement: leg % of trip % is frozen', r.leg, v_trip_id
          USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_frozen';
      END IF;
      v_avail := r.captured_minor + r.reallocated_in_minor - r.refunded_minor
                 - r.reallocated_out_minor - r.released_minor;
      IF v_debit > v_avail THEN
        IF r.released_minor > 0 THEN
          RAISE EXCEPTION 'settlement: leg % of trip % already released', r.leg, v_trip_id
            USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_already_released';
        END IF;
        RAISE EXCEPTION 'settlement: debit % exceeds leg % balance %', v_debit, r.leg, v_avail
          USING ERRCODE = 'object_not_in_prerequisite_state',
                CONSTRAINT = 'leg_movement_exceeds_balance';
      END IF;
    END IF;
  END LOOP;

  -- US-049 (RC-2) : un remboursement est borné par le règlement du segment, jambe par jambe
  -- (08 E7 règle 1 : jambes explicites, jamais un prorata) : Σ remboursé ≤ max(0, − Σ variations
  -- de la chaîne de versions) et Σ remboursé ≤ remboursement de la dernière version.
  IF v_kind = 'REFUND' THEN
    SELECT s.guest_refund_minor INTO v_head_refund
      FROM core.settlement_settlement AS s
     WHERE s.trip_id = v_trip_id AND s.segment_no = 1
     ORDER BY s.version DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'settlement: refund of operation % without a settlement', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_without_settlement';
    END IF;
    SELECT count(*) FILTER (WHERE b.refunded_minor + l.amount_minor > GREATEST(-e.variation, 0)),
           COALESCE(sum(b.refunded_minor + l.amount_minor), 0)
      INTO v_over, v_after
      FROM core.payment_payment_operation_leg AS l
      JOIN core.settlement_trip_leg_balance AS b
        ON b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
      LEFT JOIN (SELECT sl.leg, sum(sl.variation_minor) AS variation
                   FROM core.settlement_settlement_leg AS sl
                  WHERE sl.trip_id = v_trip_id AND sl.segment_no = 1
                  GROUP BY sl.leg) AS e
        ON e.leg = l.leg
     WHERE l.operation_id = p_operation_id;
    IF v_over > 0 OR v_after > v_head_refund THEN
      RAISE EXCEPTION 'settlement: refund of operation % exceeds the settlement legs', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_exceeds_settlement';
    END IF;
  END IF;

  UPDATE core.settlement_trip_leg_balance AS b
     SET captured_minor = b.captured_minor
                          + CASE WHEN v_kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
                                 THEN l.amount_minor ELSE 0 END,
         refunded_minor = b.refunded_minor
                          + CASE WHEN v_kind = 'REFUND' THEN l.amount_minor ELSE 0 END,
         reallocated_in_minor = b.reallocated_in_minor
                          + CASE WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(l.amount_minor, 0)
                                 ELSE 0 END,
         reallocated_out_minor = b.reallocated_out_minor
                          + CASE WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(-l.amount_minor, 0)
                                 ELSE 0 END,
         released_minor = b.released_minor
                          + CASE WHEN v_kind = 'LEG_RELEASE' THEN l.amount_minor ELSE 0 END
    FROM core.payment_payment_operation_leg AS l
   WHERE l.operation_id = p_operation_id
     AND b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
     AND l.amount_minor <> 0;

  INSERT INTO core.settlement_leg_movement (operation_id, trip_id, segment_no, country_code, kind)
  VALUES (p_operation_id, v_trip_id, 1, v_country, v_kind);
  RETURN 'APPLIED';
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
