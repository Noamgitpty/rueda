-- 0141 — PAY : remboursement réparti sur les moyens d'origine (TJ16c / TJ16d) et reprise après un
-- échec confirmé (SM-8 FAILED → PENDING_CUSTOMER_CHOICE).
-- US-224 (partie 224f, argent / back-end) ; 19 US-224 critère 6 (« Given la variante PY, When TJ08b,
-- TJ16c, TJ16d et TJ18c, TJ18d sont rejoués, Then les montants viennent de l'oracle à l'unité
-- près ») ; BOARD N-238 ; 08 E2 (imputation incrémentale : « chaque moyen reçoit refundable[m] −
-- absorbé[m], donc jamais plus que son reliquat »), E3 (rails, `CREDIT_CASH` ouvert en production
-- seulement si `funds_holding_enabled[pays]` = true), E4 (`instance_seq`, `attempt_no` : « il
-- n'augmente que sur la transition FAILED → PENDING_CUSTOMER_CHOICE (ou un nouveau rail) après rejet
-- confirmé »), E7 règle 10 (cascade entre opérations, TJ16), SM-8 ; 17 v6 §3.2.7, §4.3 ; ADR-147,
-- ADR-150 ; ADR-166 (cette migration). Appliquée sous `migrator`, en une transaction. Générée en
-- partie : corps de 0123 (`payment_cmd_plan_refund`) et de 0127 (`payment_refund_instance_guard`,
-- `payment_refund_instance_supersede`) recopiés à l'identique, blocs marqués « US-224f ».
--
-- Principes (ADR-166, PROPOSÉS, fail-closed) :
--   1. le montant de chaque moyen est décidé par 08 E2 et ses jambes par la cascade de la règle 10
--      dans `@rueda/money` (`tenderRefundOrders`), appelé par le processeur des annulations (STL) ;
--      la base tient, pour TOUT appelant, l'invariant de E2 « jamais plus que son reliquat » :
--      Σ instances du moyen (toutes versions, hors CANCELLED et SUPERSEDED, FAILED et
--      PENDING_CUSTOMER_CHOICE compris) ≤ payé par ce moyen (`refund_exceeds_tender`), en plus de la
--      garde du trip (0121, `refund_exceeds_collected`) et de la contrainte différée de 0124
--      (Σ REFUND = remboursement du voyageur) ;
--   2. rail natif (`NATIVE_PARTIAL`, `ROLLBACK_AND_RECHARGE`) sur une carte seulement
--      (`refund_rail_not_native`) ; un moyen non natif exige le choix du voyageur, un crédit cash
--      recréé exige `funds_holding_enabled` : tous deux fermés en bêta (0123 inchangé :
--      `refund_rail_unavailable`, `refund_credit_cash_closed`) ; TJ16d (crédit cash recréé) n'est
--      donc jamais exécuté en bêta et le règlement qui l'exigerait n'est pas écrit (garé, alerte) ;
--   3. reprise après un échec CONFIRMÉ (ordre FAILED, aucun fonds sorti) : l'instance passe
--      PENDING_CUSTOMER_CHOICE avec attempt_no + 1 (`core.payment_cmd_refund_await_choice`,
--      travailleur payment_command, appelée par l'ordonnanceur après l'alerte FIN) ; aucune
--      conversion en crédit, aucun autre rail n'est ouvert en bêta (08 E3 : « sans réponse du guest
--      au choix du rail, aucune conversion automatique en crédit ») ; l'obligation reste engagée
--      (08 E1) et une version n+1 la remplace (SUPERSEDED).
--
-- Hors de cette migration (ADR-166, passation docs/team/handoffs/US-224.md, partie 224f) : choix du
-- rail par le voyageur (S10) et virement vers un compte vérifié à son nom (OQ-BR-12, lot C) ; crédit
-- cash recréé (ouverture de `funds_holding_enabled` par décision écrite du fondateur) ; relances
-- J+1 / J+3 / J+7 et sort des sommes non réclamées (OQ-BR-44) ; chargebacks perdus dans le reliquat
-- d'un moyen (E5) ; refus d'un encaissement par crédit tant que les crédits n'existent pas.
--
-- Expand / contract : une fonction AJOUTÉE, un droit de colonne AJOUTÉ (attempt_no) ; corps de trois
-- fonctions remplacés à signature, propriétaire et droits identiques ; rien n'est retiré.
--
-- Retour arrière :
--   réappliquer les définitions de 0123 (payment_cmd_plan_refund, sous cmd_money_owner) et de 0127
--   (payment_refund_instance_guard, payment_refund_instance_supersede) ;
--   DROP FUNCTION core.payment_cmd_refund_await_choice(uuid);
--   REVOKE UPDATE (attempt_no) ON core.payment_refund_instance FROM cmd_money_owner.

-- 1. Garde de l'instance (corps de 0127, blocs marqués US-224f) ---------------------------------
CREATE OR REPLACE FUNCTION core.payment_refund_instance_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' OR NEW.issued_at IS NOT NULL OR NEW.fin_alert IS NOT NULL THEN
      RAISE EXCEPTION 'refund_instance: created PLANNED only'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'refund_instance_transition';
    END IF;
    IF NEW.rail = 'CREDIT_CASH' AND NOT core.config_go_live('funds_holding_enabled', NEW.country_code) THEN
      RAISE EXCEPTION 'refund_instance: cash credit closed while funds holding is disabled'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_credit_cash_closed';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.origin_type IS DISTINCT FROM OLD.origin_type
     OR NEW.origin_id IS DISTINCT FROM OLD.origin_id OR NEW.settlement_id IS DISTINCT FROM OLD.settlement_id
     OR NEW.settlement_version IS DISTINCT FROM OLD.settlement_version
     OR NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.refunded_operation_id IS DISTINCT FROM OLD.refunded_operation_id
     OR NEW.instance_seq IS DISTINCT FROM OLD.instance_seq
     -- US-224f (08 E4, SM-8) : attempt_no n'augmente que sur FAILED → PENDING_CUSTOMER_CHOICE
     OR (NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
         AND NOT (OLD.status = 'FAILED' AND NEW.status = 'PENDING_CUSTOMER_CHOICE'))
     OR NEW.executor IS DISTINCT FROM OLD.executor OR NEW.rail IS DISTINCT FROM OLD.rail
     OR NEW.requested_legs IS DISTINCT FROM OLD.requested_legs
     OR NEW.amount_trip_minor IS DISTINCT FROM OLD.amount_trip_minor
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.advance_id IS DISTINCT FROM OLD.advance_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.issued_at IS NOT NULL AND NEW.issued_at IS DISTINCT FROM OLD.issued_at) THEN
    RAISE EXCEPTION 'refund_instance: identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'refund_instance_immutable';
  END IF;
  IF NOT ((OLD.status = 'PLANNED' AND NEW.status IN ('PLANNED', 'SUBMITTED', 'SUPERSEDED'))
          -- US-224c (08 SM-8) : l'ordre envoyé suit le PSP ; un échec n'est remplacé que par une
          -- version n+1 ; aucun retour en arrière, aucun saut (CONFIRMED passe toujours par SENT)
          OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('SENT', 'FAILED'))
          OR (OLD.status = 'SENT' AND NEW.status IN ('CONFIRMED', 'FAILED'))
          OR (OLD.status = 'FAILED' AND NEW.status = 'SUPERSEDED')
          -- US-224f (08 SM-8, E4) : rejet confirmé ⇒ choix d'un autre rail par le voyageur, nouvelle
          -- tentative (attempt_no + 1, jamais un rejeu de la même clé) ; sans mouvement de fonds,
          -- remplacée par une version n+1
          OR (OLD.status = 'FAILED' AND NEW.status = 'PENDING_CUSTOMER_CHOICE'
              AND NEW.attempt_no = OLD.attempt_no + 1)
          OR (OLD.status = 'PENDING_CUSTOMER_CHOICE' AND NEW.status = 'SUPERSEDED')
          OR (OLD.status = NEW.status AND NEW.blocked_reason IS NOT DISTINCT FROM OLD.blocked_reason
              AND NEW.issued_at IS NOT DISTINCT FROM OLD.issued_at)) THEN
    RAISE EXCEPTION 'refund_instance: transition % -> % refused', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'refund_instance_transition';
  END IF;
  RETURN NEW;
END
$fn$;

-- 2. Supersession (corps de 0127, bloc marqué US-224f) -------------------------------------------
CREATE OR REPLACE FUNCTION core.payment_refund_instance_supersede()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- US-224c (08 SM-8) : PLANNED et FAILED (rejet confirmé) n'ont déplacé aucun fonds ; US-224f :
  -- PENDING_CUSTOMER_CHOICE non plus (08 SM-8, supersession : « sans mouvement de fonds »)
  UPDATE core.settlement_platform_advance AS a
     SET status = 'CANCELLED'
   WHERE a.status = 'PLANNED'
     AND a.id IN (SELECT ri.advance_id FROM core.payment_refund_instance AS ri
                   WHERE ri.trip_id = NEW.trip_id AND ri.status IN ('PLANNED', 'FAILED', 'PENDING_CUSTOMER_CHOICE')
                     AND ri.advance_id IS NOT NULL);
  UPDATE core.payment_refund_instance AS ri
     SET status = 'SUPERSEDED', blocked_reason = NULL
   WHERE ri.trip_id = NEW.trip_id AND ri.status IN ('PLANNED', 'FAILED', 'PENDING_CUSTOMER_CHOICE');
  RETURN NULL;
END
$fn$;

-- 3. Commandes de cmd_money_owner (ADR-044 amendé : CREATE le temps du remplacement) -------------
GRANT UPDATE (attempt_no) ON core.payment_refund_instance TO cmd_money_owner;
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 3.1 Planification (corps de 0123, blocs marqués US-224f) : rail natif sur la carte seulement ;
-- jamais plus que le payé d'un moyen (08 E2). Signature, propriétaire et droits inchangés.
CREATE OR REPLACE FUNCTION core.payment_cmd_plan_refund(
  p_instance_id           uuid,
  p_operation_id          uuid,
  p_settlement_id         uuid,
  p_refunded_operation_id uuid,
  p_instance_seq          integer,
  p_rail                  text,
  p_legs                  jsonb,
  p_idem_plain            text,
  p_idem_sent             text
)
  RETURNS TABLE (instance_id uuid, operation_id uuid, advance_id uuid, status text,
                 blocked_reason text, replayed boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_stl      record;
  v_trip     record;
  v_src      record;
  v_prev     record;
  v_keys     text[];
  v_leg      text;
  v_value    text;
  v_req      numeric[] := ARRAY[0, 0, 0, 0];
  v_amount   numeric := 0;
  v_avail    numeric;
  v_released numeric;
  v_shift    numeric := 0;
  v_adv      uuid;
  v_block    text;
  v_legs     jsonb;
  v_replayed boolean;
  v_engaged  numeric;
  i          integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: plan_refund reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_instance_id IS NULL OR p_operation_id IS NULL OR p_settlement_id IS NULL
     OR p_refunded_operation_id IS NULL OR p_instance_seq IS NULL OR p_instance_seq < 1
     OR p_rail IS NULL
     OR p_rail NOT IN ('NATIVE_PARTIAL', 'ROLLBACK_AND_RECHARGE', 'BANK_TRANSFER', 'CREDIT_CASH') THEN
    RAISE EXCEPTION 'payment: invalid refund instance' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- jambes demandées : exactement HOST, INSURER, TAX_THIRD_PARTY, PLATFORM, entiers ≥ 0 en texte
  IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'object' THEN
    RAISE EXCEPTION 'payment: legs required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_legs) AS k;
  IF v_keys IS DISTINCT FROM ARRAY['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'] THEN
    RAISE EXCEPTION 'payment: legs must be HOST, INSURER, TAX_THIRD_PARTY, PLATFORM'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR i IN 1..4 LOOP
    v_leg := (ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'])[i];
    IF jsonb_typeof(p_legs -> v_leg) <> 'string' THEN
      RAISE EXCEPTION 'payment: leg % must be an integer string', v_leg
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_value := p_legs ->> v_leg;
    IF v_value !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'payment: leg % must be a non-negative integer string', v_leg
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_req[i] := v_value::numeric;
    v_amount := v_amount + v_req[i];
  END LOOP;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'payment: refund amount must be positive' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT s.id, s.trip_id, s.version INTO v_stl
    FROM core.settlement_settlement AS s WHERE s.id = p_settlement_id;
  IF v_stl.id IS NULL THEN
    RAISE EXCEPTION 'payment: refund instance without a known settlement'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_refund_without_settlement';
  END IF;
  -- verrou du trip AVANT toute écriture (même ordre que la garde et le report)
  SELECT t.id, t.org_id, t.country_code, t.currency INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = v_stl.trip_id FOR UPDATE;

  -- rails (E3) : bêta, remboursement natif seulement ; crédit cash fermé tant que
  -- funds_holding_enabled[pays] = false ; virement : aucune coordonnée bancaire stockée en bêta
  IF p_rail = 'CREDIT_CASH' AND NOT core.config_go_live('funds_holding_enabled', v_trip.country_code) THEN
    RAISE EXCEPTION 'payment: cash credit closed while funds holding is disabled'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_credit_cash_closed';
  END IF;
  IF p_rail IN ('BANK_TRANSFER', 'CREDIT_CASH') THEN
    RAISE EXCEPTION 'payment: refund rail % not available in beta', p_rail
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_rail_unavailable';
  END IF;

  -- rejeu : même clé (règlement, opération remboursée, rang) ⇒ même contenu exigé
  SELECT ri.id, ri.operation_id, ri.advance_id, ri.status, ri.blocked_reason, ri.rail,
         ri.requested_legs
    INTO v_prev
    FROM core.payment_refund_instance AS ri
   WHERE ri.origin_type = 'SETTLEMENT' AND ri.origin_id = p_settlement_id
     AND ri.refunded_operation_id = p_refunded_operation_id AND ri.instance_seq = p_instance_seq;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.id <> p_instance_id OR v_prev.operation_id <> p_operation_id
       OR v_prev.rail <> p_rail OR v_prev.requested_legs <> p_legs
       OR NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                       WHERE o.id = v_prev.operation_id AND o.idem_plain = p_idem_plain
                         AND o.idem_sent = p_idem_sent) THEN
      RAISE EXCEPTION 'payment: same refund instance key, different content'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'refund_instance_idempotency_conflict';
    END IF;
    RETURN QUERY SELECT v_prev.id, v_prev.operation_id, v_prev.advance_id, v_prev.status,
                        v_prev.blocked_reason, true;
    RETURN;
  END IF;

  -- opération remboursée : un encaissement réussi du loyer de ce trip (moyen et compte du PSP)
  SELECT o.id, o.psp_account_id, o.method, o.amount_minor, o.currency INTO v_src
    FROM core.payment_payment_operation AS o
   WHERE o.id = p_refunded_operation_id AND o.trip_id = v_trip.id AND o.status = 'SUCCEEDED'
     AND o.kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
     AND o.purpose IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION');
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'payment: refunded operation is not a succeeded rent collection of the trip'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'refund_instance_origin_invalid';
  END IF;
  -- US-224f (08 E2, E3) : un moyen n'est remboursé que dans la devise du trip (aucune conversion en
  -- bêta) ; un rail natif (remboursement partiel, rollback) n'existe que pour la carte, le seul
  -- moyen natif de la bêta : un moyen non natif (Yappy, QR, virement) exige le choix du voyageur
  -- (SM-8 PENDING_CUSTOMER_CHOICE), fermé en bêta
  IF v_src.currency IS DISTINCT FROM v_trip.currency THEN
    RAISE EXCEPTION 'payment: refunded operation is not in the trip currency'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'refund_instance_origin_invalid';
  END IF;
  IF p_rail IN ('NATIVE_PARTIAL', 'ROLLBACK_AND_RECHARGE') AND v_src.method IS DISTINCT FROM 'CARD' THEN
    RAISE EXCEPTION 'payment: native refund rail on a non-native payment method'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_rail_not_native';
  END IF;

  -- 08 E7 règle 3 bis : la part HOST au-delà de ce que la jambe a encore (en-cours déduits), si la
  -- jambe a été versée à l'hôte, est portée sur PLATFORM et avancée par Kmino ; le remboursement
  -- du voyageur n'est jamais réduit
  SELECT st.available - st.pending_debit, st.released INTO v_avail, v_released
    FROM core.payment_trip_leg_state(v_trip.id) AS st WHERE st.leg = 'HOST';
  IF v_req[1] > GREATEST(COALESCE(v_avail, 0), 0) AND COALESCE(v_released, 0) > 0 THEN
    v_shift := v_req[1] - GREATEST(COALESCE(v_avail, 0), 0);
  END IF;
  v_legs := jsonb_build_object('HOST', (v_req[1] - v_shift)::text, 'INSURER', v_req[2]::text,
                               'TAX_THIRD_PARTY', v_req[3]::text,
                               'PLATFORM', (v_req[4] + v_shift)::text);
  IF v_shift > 0 THEN
    v_adv := gen_random_uuid();
    INSERT INTO core.settlement_platform_advance
           (id, country_code, currency, trip_id, org_id, cause, amount_minor, funded_from,
            receivable_minor, status)
    VALUES (v_adv, v_trip.country_code, v_trip.currency, v_trip.id, v_trip.org_id, 'RELEASED_LEG',
            v_shift::bigint, 'COUNTRY_PLATFORM_BALANCE', v_shift::bigint, 'PLANNED');
    v_block := core.payment_refund_advance_block(v_adv);
  END IF;

  INSERT INTO core.payment_refund_instance
         (id, origin_type, origin_id, settlement_id, settlement_version, trip_id, country_code,
          currency, refunded_operation_id, instance_seq, rail, requested_legs, amount_trip_minor,
          operation_id, advance_id, blocked_reason)
  VALUES (p_instance_id, 'SETTLEMENT', p_settlement_id, p_settlement_id, v_stl.version, v_trip.id,
          v_trip.country_code, v_trip.currency, p_refunded_operation_id, p_instance_seq, p_rail,
          p_legs, v_amount::bigint, p_operation_id, v_adv, v_block);

  -- ordre REFUND PENDING (jamais envoyé avant payment_cmd_submit_refund), gardé à l'enregistrement
  SELECT r.replayed INTO v_replayed
    FROM core.payment_cmd_record_operation(p_operation_id, NULL, v_trip.id, v_src.psp_account_id,
                                           v_src.method, 'REFUND', 'RENT', v_amount::bigint,
                                           v_trip.currency, 1, p_idem_plain, p_idem_sent, v_legs,
                                           p_settlement_id, v_stl.version) AS r;
  IF v_replayed THEN
    -- clé d'idempotence déjà prise par un ordre sans cette instance
    RAISE EXCEPTION 'payment: refund order key already used by another order'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'refund_instance_idempotency_conflict';
  END IF;

  -- US-224f (08 E2 : « chaque moyen reçoit refundable[m] − absorbé[m], donc jamais plus que son
  -- reliquat ») : Σ des instances du moyen, toutes versions, hors CANCELLED et SUPERSEDED (FAILED et
  -- PENDING_CUSTOMER_CHOICE compris : l'obligation subsiste, seul le rail a échoué), ≤ payé par ce
  -- moyen. Contrôlé APRÈS la garde du trip (les refus existants gardent leur contrainte), sous le
  -- verrou du trip.
  SELECT COALESCE(pg_catalog.sum(ri.amount_trip_minor), 0) INTO v_engaged
    FROM core.payment_refund_instance AS ri
   WHERE ri.refunded_operation_id = p_refunded_operation_id AND ri.id <> p_instance_id
     AND ri.status NOT IN ('CANCELLED', 'SUPERSEDED');
  IF v_engaged + v_amount > v_src.amount_minor THEN
    RAISE EXCEPTION 'payment: refund exceeds what this payment method paid'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_exceeds_tender';
  END IF;

  RETURN QUERY SELECT p_instance_id, p_operation_id, v_adv, 'PLANNED'::text, v_block, false;
END
$fn$;

-- 3.2 Reprise après un échec confirmé (08 SM-8 FAILED → PENDING_CUSTOMER_CHOICE, E4 attempt_no + 1) :
-- sous le verrou du trip, l'instance FAILED dont l'ordre est FAILED (rejet reçu, aucun fonds sorti)
-- attend le choix d'un autre rail par le voyageur. Rien n'est envoyé ni converti.
CREATE FUNCTION core.payment_cmd_refund_await_choice(p_instance_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip uuid;
  v_i    record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: refund_await_choice reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_instance_id IS NULL THEN
    RAISE EXCEPTION 'payment: refund instance required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT ri.trip_id INTO v_trip FROM core.payment_refund_instance AS ri WHERE ri.id = p_instance_id;
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'payment: unknown refund instance'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_instance_unknown';
  END IF;
  -- même ordre de verrous que la planification, l'envoi et le report ; relu sous le verrou
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT ri.status, o.status AS operation_status INTO v_i
    FROM core.payment_refund_instance AS ri
    JOIN core.payment_payment_operation AS o ON o.id = ri.operation_id
   WHERE ri.id = p_instance_id;
  IF v_i.status = 'PENDING_CUSTOMER_CHOICE' THEN
    RETURN 'DUPLICATE';
  END IF;
  IF v_i.status = 'SUPERSEDED' THEN
    RETURN 'SUPERSEDED';
  END IF;
  -- seul un rejet CONFIRMÉ ouvre une nouvelle tentative : un ordre sans statut final (UNKNOWN,
  -- SUBMITTED) garde la même clé (08 E4, EC-29)
  IF v_i.status <> 'FAILED' OR v_i.operation_status IS DISTINCT FROM 'FAILED' THEN
    RAISE EXCEPTION 'payment: refund instance % is not a confirmed failure', p_instance_id
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_instance_not_failed';
  END IF;
  UPDATE core.payment_refund_instance AS ri
     SET status = 'PENDING_CUSTOMER_CHOICE', attempt_no = ri.attempt_no + 1
   WHERE ri.id = p_instance_id;
  RETURN 'AWAITING_CHOICE';
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_refund_await_choice(uuid) IS
  'SM-8 FAILED → PENDING_CUSTOMER_CHOICE (attempt_no + 1) après un rejet confirmé du PSP ; aucun '
  'autre rail ouvert en bêta. Travailleur payment_command. US-224 (224f), ADR-166.';
REVOKE ALL ON FUNCTION core.payment_cmd_refund_await_choice(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_cmd_refund_await_choice(uuid) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
