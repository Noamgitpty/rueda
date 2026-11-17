-- 0121 — STL / PAY : ordres de remboursement et de jambe rattachés à la version du règlement,
-- bornés dès l'enregistrement ; rejeu d'un règlement ; preuve signée d'un remboursement avec son
-- montant.
-- US-224 (partie 224a, argent / back-end) ; 19 US-224 (critères 2 et 3, « jamais au prorata »,
-- `REFUND_EXCEEDS_COLLECTED`) ; 16 PAY-021 ; 08 E1, E4, E7 (règles 1, 3, 3 bis, 5, 10), SM-8 ;
-- 17 v6 §2.8, §2.9, §3.2.7 (`payment_operation.settlement_id`), §4.3 points 1 et 8 ; ADR-088
-- (« Alternatives écartées » : colonnes de règlement et garde à l'enregistrement, reportées),
-- ADR-090, ADR-139 ; ADR-145 (cette migration). Suites du BOARD : S-02 (phrases 1 et 2), N-196
-- (preuve sans montant), N-13 (code `REFUND_OUT_OF_RANGE` côté appelant : TypeScript, STL).
-- Appliquée sous `migrator`, en une transaction.
--
-- Cette migration :
--   1. `payment_operation.settlement_id` / `settlement_version` (17 §3.2.7) : un ordre REFUND,
--      LEG_REALLOCATION ou LEG_RELEASE d'un trip porte l'identifiant ET la version du règlement
--      dont il découle ; clé étrangère composite (règlement, trip, version) : le règlement est
--      celui du trip de l'ordre et la version est la sienne ; immuables (aucun UPDATE accordé) ;
--   2. `core.payment_cmd_record_operation` à 15 arguments (règlement et version en plus) ; la
--      commande à 13 arguments de 0048 l'appelle sans règlement (signature, propriétaire, droits
--      et entrée RLS-15 inchangés) : un ordre de trip REFUND / LEG_* sans règlement est refusé ;
--   3. garde à l'enregistrement `core.payment_assert_settlement_order` (appelée par la commande,
--      sous le verrou du trip, après l'insertion des jambes, donc après la garde de versement de
--      0054) : règlement exigé (`leg_refund_without_settlement`, `operation_settlement_required`),
--      version en tête (`operation_settlement_superseded`), aucun ordre d'une version à jambe
--      négative avant la décision FIN (`operation_settlement_fin_review`, 08 E7 règle 5) ; puis,
--      jambe par jambe, en comptant TOUS les ordres non échoués du trip (en vol compris) :
--      jambe gelée (`leg_frozen`), débits en cours > solde encaissé de la jambe
--      (`leg_already_released` si la jambe a été versée, sinon `refund_exceeds_collected` ⇒
--      `REFUND_EXCEEDS_COLLECTED`), mouvement cumulé hors de [min(0, V) ; max(0, V)] où V est la
--      variation cumulée de la chaîne de versions, ou Σ remboursé > remboursement de la version en
--      tête (`leg_refund_exceeds_settlement`). Jamais de prorata : à total égal, une autre
--      ventilation sort d'au moins une jambe (TJ10c) ;
--   4. `core.settlement_cmd_record` : la MÊME version rejouée (même contenu) rend le règlement
--      existant au lieu de `SETTLEMENT_EXISTS` (S-02, phrase 2) ;
--   5. `core.payment_cmd_apply_operation_status` (corps de 0116 recopié, bloc marqué US-224) :
--      un webhook SUCCEEDED sans montant ne prouve plus aucun ordre qui déplace des fonds
--      (MIT_CHARGE, DEBT_COLLECTION, REFUND, LEG_REALLOCATION, LEG_RELEASE, DEPOSIT_CAPTURE en
--      plus d'AUTH / CAPTURE) ⇒ UNPROVEN (N-196).
--
-- Hors de cette migration (partie 224b, passation docs/team/handoffs/US-224.md) : instance
-- `refund_instance` (SM-8, `PLANNED`), avance de Kmino (TJ18b, `platform_advance`,
-- `host_advance_cap_minor`), décision FINANCE à deux personnes (N-119), file ops sur MISMATCH,
-- annulation remboursée (N-201), écrans. Le plafond d'un versement par la jambe retenue
-- (`LEG_RELEASE`) reste à US-125.
--
-- Expand / contract : deux colonnes NULL, deux CHECK, une clé étrangère, une contrainte d'unicité
-- et deux fonctions AJOUTÉES ; corps de trois commandes remplacés à signature, propriétaire et
-- droits identiques. Les ordres existants (aucun en production) gardent un règlement NULL.
--
-- Retour arrière :
--   réappliquer les définitions de 0048 (payment_cmd_record_operation à 13 arguments), de 0027
--   (settlement_cmd_record) et de 0116 (payment_cmd_apply_operation_status), sous cmd_money_owner ;
--   DROP FUNCTION core.payment_cmd_record_operation(uuid, uuid, uuid, uuid, text, text, text,
--     bigint, text, integer, text, text, jsonb, uuid, integer),
--     core.payment_assert_settlement_order(uuid);
--   ALTER TABLE core.payment_payment_operation DROP CONSTRAINT payment_operation_settlement_fk,
--     DROP CONSTRAINT payment_operation_settlement_shape,
--     DROP CONSTRAINT payment_operation_settlement_kind, DROP COLUMN settlement_version,
--     DROP COLUMN settlement_id;
--   ALTER TABLE core.settlement_settlement DROP CONSTRAINT settlement_id_trip_version_unique;

-- 1. Rattachement d'un ordre à la version de son règlement -------------------------------------
ALTER TABLE core.settlement_settlement
  ADD CONSTRAINT settlement_id_trip_version_unique UNIQUE (id, trip_id, version);

ALTER TABLE core.payment_payment_operation
  ADD COLUMN settlement_id      uuid,
  ADD COLUMN settlement_version integer,
  ADD CONSTRAINT payment_operation_settlement_shape
    CHECK ((settlement_id IS NULL) = (settlement_version IS NULL)),
  -- seuls les ordres de jambe d'un trip découlent d'un règlement, et seulement dans le périmètre
  -- du loyer (la caution, les dommages et les frais annexes ont leur propre origine : US-225, lot 5)
  ADD CONSTRAINT payment_operation_settlement_kind
    CHECK (settlement_id IS NULL
           OR (trip_id IS NOT NULL
               AND kind IN ('REFUND', 'LEG_REALLOCATION', 'LEG_RELEASE')
               AND purpose IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION'))),
  ADD CONSTRAINT payment_operation_settlement_fk
    FOREIGN KEY (settlement_id, trip_id, settlement_version)
    REFERENCES core.settlement_settlement (id, trip_id, version);
CREATE INDEX payment_operation_settlement_idx ON core.payment_payment_operation (settlement_id)
  WHERE settlement_id IS NOT NULL;

COMMENT ON COLUMN core.payment_payment_operation.settlement_id IS
  'Règlement dont découle un ordre REFUND / LEG_REALLOCATION / LEG_RELEASE du trip (17 §3.2.7, S-02). US-224.';
COMMENT ON COLUMN core.payment_payment_operation.settlement_version IS
  'Version du règlement à l''enregistrement de l''ordre ; refusée si elle est déjà remplacée. US-224.';

-- 2. Garde d'un ordre de règlement, à l'enregistrement ------------------------------------------
-- SECURITY INVOKER : appelée par payment_cmd_record_operation (SECURITY DEFINER, cmd_money_owner),
-- elle lit sous les politiques de cmd_money_owner (cmd_money_sel, money_lock). Lève à la première
-- condition violée ; ne rend rien sinon. Mêmes noms de contrainte que le report sur les soldes
-- (0054, 0116) quand la règle est la même : le refus est seulement plus tôt.
CREATE FUNCTION core.payment_assert_settlement_order(p_operation_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip     uuid;
  v_kind     text;
  v_stl      uuid;
  v_version  integer;
  v_refund   bigint;
  v_negative boolean;
  v_total    numeric := 0;
  v_debit    numeric;
  v_credit   numeric;
  v_take     numeric;
  r          record;
  v_legs     text[] := ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'];
  v_var      numeric[] := ARRAY[0, 0, 0, 0];
  v_moved    numeric[] := ARRAY[0, 0, 0, 0];
  v_expected numeric[] := ARRAY[0, 0, 0, 0];
  i          integer;
BEGIN
  SELECT o.trip_id, o.kind, o.settlement_id, o.settlement_version
    INTO v_trip, v_kind, v_stl, v_version
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND OR v_trip IS NULL
     OR v_kind NOT IN ('REFUND', 'LEG_REALLOCATION', 'LEG_RELEASE') THEN
    RETURN;                                   -- hors ordres de règlement d'un trip
  END IF;

  -- verrou du trip : même ordre que settlement_cmd_record et settlement_cmd_apply_leg_movement ;
  -- deux ordres concurrents du même trip sont sérialisés et le second voit le premier validé
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;

  IF v_stl IS NULL THEN
    IF v_kind = 'REFUND' THEN
      RAISE EXCEPTION 'payment: refund of operation % without a settlement', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_without_settlement';
    END IF;
    -- LEG_RELEASE d'un trip qui n'a AUCUN règlement (trajet terminé sans annulation : aucun
    -- règlement de fin en bêta) : gardé par settlement_release_blocker (0054) seul ; dès qu'un
    -- règlement existe, sa version en tête est exigée
    IF v_kind = 'LEG_RELEASE'
       AND NOT EXISTS (SELECT 1 FROM core.settlement_settlement AS s WHERE s.trip_id = v_trip) THEN
      RETURN;
    END IF;
    RAISE EXCEPTION 'payment: % of operation % without a settlement', v_kind, p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'operation_settlement_required';
  END IF;
  -- S-02 : la version portée est la dernière de la chaîne (aucune version ne la remplace)
  IF EXISTS (SELECT 1 FROM core.settlement_settlement AS s WHERE s.supersedes_id = v_stl) THEN
    RAISE EXCEPTION 'payment: settlement version % of operation % is superseded', v_version,
                    p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'operation_settlement_superseded';
  END IF;
  -- versement : gardé par settlement_release_blocker (0054) ; son plafond par la jambe retenue de
  -- la version en tête est porté par US-125
  IF v_kind = 'LEG_RELEASE' THEN
    RETURN;
  END IF;

  SELECT s.guest_refund_minor, s.negative_leg INTO v_refund, v_negative
    FROM core.settlement_settlement AS s WHERE s.id = v_stl;
  -- 08 E7 règle 5 : jambe PLATFORM retenue négative ⇒ ordre PLANNED jusqu'à la décision FIN sur
  -- l'avance de Kmino (224b) ; le remboursement n'est jamais réduit, il n'est pas encore envoyé
  IF v_negative THEN
    RAISE EXCEPTION 'payment: settlement of operation % awaits a FIN decision', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'operation_settlement_fin_review';
  END IF;

  -- 08 E7 règle 3 (revue argent #198 n° 2) : la réaffectation du règlement est passée AVANT tout
  -- remboursement, et elle est exactement celle du règlement : chaque variation positive est prise
  -- sur les jambes en baisse dans l'ordre HOST → INSURER → TAX_THIRD_PARTY → PLATFORM (même règle
  -- que `settlementOrders` de @rueda/money, comparée ici, aucun montant produit). Sans cela, un
  -- remboursement à la ventilation fautive (TJ05b : HOST 131,25 + INSURER 6,97) tiendrait dans les
  -- plafonds par jambe et bloquerait ensuite la réaffectation due à PLATFORM.
  FOR i IN 1..4 LOOP
    SELECT COALESCE(sum(sl.variation_minor), 0) INTO v_var[i]
      FROM core.settlement_settlement_leg AS sl
     WHERE sl.trip_id = v_trip AND sl.segment_no = 1 AND sl.leg = v_legs[i];
    SELECT COALESCE(sum(l.amount_minor), 0) INTO v_moved[i]
      FROM core.payment_payment_operation AS o
      JOIN core.payment_payment_operation_leg AS l ON l.operation_id = o.id
     WHERE o.trip_id = v_trip AND o.kind = 'LEG_REALLOCATION' AND o.status <> 'FAILED'
       AND o.purpose IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION') AND l.leg = v_legs[i];
  END LOOP;
  v_credit := 0;
  FOR i IN 1..4 LOOP
    IF v_var[i] > 0 THEN
      v_expected[i] := v_var[i];
      v_credit := v_credit + v_var[i];
    END IF;
  END LOOP;
  FOR i IN 1..4 LOOP
    IF v_var[i] < 0 AND v_credit > 0 THEN
      v_take := LEAST(-v_var[i], v_credit);
      v_expected[i] := -v_take;
      v_credit := v_credit - v_take;
    END IF;
  END LOOP;
  IF v_moved IS DISTINCT FROM v_expected THEN
    IF v_kind = 'LEG_REALLOCATION' THEN
      RAISE EXCEPTION 'payment: reallocation of operation % differs from the settlement', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_reallocation_mismatch';
    END IF;
    RAISE EXCEPTION 'payment: refund of operation % before the settlement reallocation', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_reallocation_pending';
  END IF;

  FOR r IN
    WITH legs(leg, rank) AS (
           VALUES ('HOST', 1), ('INSURER', 2), ('TAX_THIRD_PARTY', 3), ('PLATFORM', 4)),
         orders AS (
           -- ordres de règlement non échoués du trip (en vol compris), celui-ci compris
           SELECT o.id, o.kind,
                  EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m
                           WHERE m.operation_id = o.id) AS applied
             FROM core.payment_payment_operation AS o
            WHERE o.trip_id = v_trip
              AND o.kind IN ('REFUND', 'LEG_REALLOCATION', 'LEG_RELEASE')
              AND o.purpose IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION')
              AND o.status <> 'FAILED'),
         moved AS (
           SELECT l.leg,
                  -- mouvement signé de la jambe (remboursement : débit ; réaffectation : signe de la ligne)
                  sum(CASE ord.kind WHEN 'REFUND' THEN -l.amount_minor
                                    WHEN 'LEG_REALLOCATION' THEN l.amount_minor
                                    ELSE 0 END) AS moved,
                  sum(CASE WHEN ord.kind = 'REFUND' THEN l.amount_minor ELSE 0 END) AS refunded,
                  -- débits pas encore reportés sur les soldes
                  sum(CASE WHEN ord.applied THEN 0
                           WHEN ord.kind IN ('REFUND', 'LEG_RELEASE') THEN l.amount_minor
                           ELSE greatest(-l.amount_minor, 0) END) AS pending_debit
             FROM orders AS ord
             JOIN core.payment_payment_operation_leg AS l ON l.operation_id = ord.id
            GROUP BY l.leg),
         chain AS (
           SELECT sl.leg, sum(sl.variation_minor) AS variation
             FROM core.settlement_settlement_leg AS sl
            WHERE sl.trip_id = v_trip AND sl.segment_no = 1
            GROUP BY sl.leg)
    SELECT legs.leg,
           COALESCE(n.amount_minor, 0)::numeric AS amount,
           COALESCE(mv.moved, 0)::numeric AS moved,
           COALESCE(mv.refunded, 0)::numeric AS refunded,
           COALESCE(mv.pending_debit, 0)::numeric AS pending_debit,
           COALESCE(ch.variation, 0)::numeric AS variation,
           COALESCE(b.captured_minor + b.reallocated_in_minor - b.refunded_minor
                    - b.reallocated_out_minor - b.released_minor, 0)::numeric AS available,
           COALESCE(b.released_minor, 0) AS released,
           COALESCE(b.frozen, false) AS frozen
      FROM legs
      LEFT JOIN core.payment_payment_operation_leg AS n
        ON n.operation_id = p_operation_id AND n.leg = legs.leg
      LEFT JOIN moved AS mv ON mv.leg = legs.leg
      LEFT JOIN chain AS ch ON ch.leg = legs.leg
      LEFT JOIN core.settlement_trip_leg_balance AS b
        ON b.trip_id = v_trip AND b.segment_no = 1 AND b.leg = legs.leg
     ORDER BY legs.rank
  LOOP
    v_debit := CASE WHEN v_kind = 'REFUND' THEN r.amount ELSE greatest(-r.amount, 0) END;
    IF v_debit > 0 THEN
      IF r.frozen THEN
        RAISE EXCEPTION 'payment: leg % of trip % is frozen', r.leg, v_trip
          USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_frozen';
      END IF;
      -- 16 PAY-021 : jamais plus que ce qui a été encaissé sur la jambe (soldes reportés, moins
      -- les débits déjà ordonnés et pas encore reportés)
      IF r.pending_debit > r.available THEN
        IF r.released > 0 THEN
          RAISE EXCEPTION 'payment: leg % of trip % already released', r.leg, v_trip
            USING ERRCODE = 'object_not_in_prerequisite_state',
                  CONSTRAINT = 'leg_already_released';
        END IF;
        RAISE EXCEPTION 'payment: debits on leg % of trip % exceed what was collected', r.leg,
                        v_trip
          USING ERRCODE = 'object_not_in_prerequisite_state',
                CONSTRAINT = 'refund_exceeds_collected';
      END IF;
    END IF;
    -- RC-2 / S-02 : mouvement cumulé de la jambe dans le sens et la limite de la variation de la
    -- chaîne de versions (08 E7 règles 1 et 3 : montant explicite par jambe, jamais de prorata)
    IF r.amount <> 0
       AND (r.moved < LEAST(0, r.variation) OR r.moved > GREATEST(0, r.variation)) THEN
      RAISE EXCEPTION 'payment: operation % exceeds leg % of the settlement', p_operation_id, r.leg
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_exceeds_settlement';
    END IF;
    v_total := v_total + r.refunded;
  END LOOP;
  -- 08 E1 : Σ remboursé ≤ remboursement de la version en tête
  IF v_total > v_refund THEN
    RAISE EXCEPTION 'payment: refunds of trip % exceed the settlement refund', v_trip
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_refund_exceeds_settlement';
  END IF;
END
$fn$;

COMMENT ON FUNCTION core.payment_assert_settlement_order(uuid) IS
  'Garde d''un ordre REFUND / LEG_REALLOCATION / LEG_RELEASE de trip à l''enregistrement : règlement '
  'en tête, encaissé par jambe, bornes de la chaîne de versions, en-cours compris (S-02, RC-2). US-224, ADR-145.';
REVOKE ALL ON FUNCTION core.payment_assert_settlement_order(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_assert_settlement_order(uuid) TO cmd_money_owner;

-- 3. Commandes de cmd_money_owner (ADR-044 amendé : CREATE le temps du remplacement) -------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 3.1 Enregistrement d'un ordre (corps de 0048 recopié ; blocs marqués US-224)
CREATE FUNCTION core.payment_cmd_record_operation(
  p_id                 uuid,
  p_hold_id            uuid,
  p_trip_id            uuid,
  p_psp_account_id     uuid,
  p_method             text,
  p_kind               text,
  p_purpose            text,
  p_amount_minor       bigint,
  p_currency           text,
  p_attempt_no         integer,
  p_idem_plain         text,
  p_idem_sent          text,
  p_legs               jsonb,
  p_settlement_id      uuid,
  p_settlement_version integer
)
  RETURNS TABLE (operation_id uuid, replayed boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_provider    text;
  v_country     text;
  v_status      text;
  v_org         uuid;
  v_subject_cty text;
  v_trip_cur    text;
  v_keys        text[];
  v_leg         text;
  v_value       text;
  v_inserted    uuid;
  v_sum         numeric := 0;
  v_pos         numeric := 0;
  v_neg         boolean := false;
  v_existing    core.payment_payment_operation%ROWTYPE;
  v_same_legs   boolean;
  v_no_legs     boolean := p_kind IN ('VOID', 'DEPOSIT_VOID', 'DEPOSIT_AUTH', 'CHARGEBACK',
                                      'CHARGEBACK_REVERSAL');
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: record_operation reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_idem_plain IS NULL OR length(p_idem_plain) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'payment: invalid idempotency key' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- valeur transmise au PSP : idem_plain, ou hex(sha256(idem_plain)) (08 E4, 17 §2.8)
  IF p_idem_sent IS DISTINCT FROM p_idem_plain
     AND p_idem_sent IS DISTINCT FROM encode(sha256(convert_to(p_idem_plain, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'payment: idem_sent is neither idem_plain nor its SHA-256'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- compte marchand ACTIVE, jamais un FAKE en production (17 §4.3 point 5.7)
  SELECT a.provider, a.country_code, a.status INTO v_provider, v_country, v_status
    FROM core.payment_psp_account AS a WHERE a.id = p_psp_account_id;
  IF NOT FOUND OR v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'payment: PSP account not active'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_account_active';
  END IF;
  IF v_provider = 'FAKE' AND COALESCE(platform.deployment_env(), 'production') = 'production' THEN
    RAISE EXCEPTION 'payment: FAKE provider forbidden in production (C19)'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'psp_account_fake_forbidden';
  END IF;

  -- US-224 : un ordre de règlement d'un trip prend le verrou du trip AVANT d'insérer l'opération
  -- (la clé étrangère vers le trip y poserait un verrou partagé : deux ordres concurrents
  -- s'interbloqueraient en montant au verrou exclusif de la garde)
  IF p_trip_id IS NOT NULL AND p_kind IN ('REFUND', 'LEG_REALLOCATION', 'LEG_RELEASE') THEN
    PERFORM 1 FROM core.booking_trip AS t WHERE t.id = p_trip_id FOR UPDATE;
  END IF;

  -- objet de l'opération : même pays que le compte ; devise du trip (17 §3.1.5)
  IF p_trip_id IS NOT NULL THEN
    SELECT t.org_id, t.country_code, t.currency INTO v_org, v_subject_cty, v_trip_cur
      FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  ELSE
    SELECT h.org_id, h.country_code INTO v_org, v_subject_cty
      FROM core.booking_checkout_hold AS h WHERE h.id = p_hold_id;
  END IF;
  IF v_subject_cty IS NULL OR v_subject_cty <> v_country
     OR (v_trip_cur IS NOT NULL AND v_trip_cur <> p_currency) THEN
    RAISE EXCEPTION 'payment: operation subject, account country or currency mismatch'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_subject_mismatch';
  END IF;

  -- jambes : exactement HOST, INSURER, TAX_THIRD_PARTY, PLATFORM, entiers en texte (bigint)
  IF v_no_legs THEN
    IF p_legs IS NOT NULL THEN
      RAISE EXCEPTION 'payment: % carries no leg', p_kind USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSE
    IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'object' THEN
      RAISE EXCEPTION 'payment: legs required' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_legs) AS k;
    IF v_keys IS DISTINCT FROM ARRAY['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'] THEN
      RAISE EXCEPTION 'payment: legs must be HOST, INSURER, TAX_THIRD_PARTY, PLATFORM'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    FOREACH v_leg IN ARRAY v_keys LOOP
      IF jsonb_typeof(p_legs -> v_leg) <> 'string' THEN
        RAISE EXCEPTION 'payment: leg % must be an integer string', v_leg
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_value := p_legs ->> v_leg;
      IF v_value !~ '^-?[0-9]{1,18}$' THEN
        RAISE EXCEPTION 'payment: leg % must be an integer string', v_leg
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_sum := v_sum + v_value::numeric;
      IF v_value::numeric > 0 THEN
        v_pos := v_pos + v_value::numeric;
      ELSIF v_value::numeric < 0 THEN
        v_neg := true;
      END IF;
    END LOOP;
    -- contrôle immédiat (le contrôle différé payment_operation_legs_check le refait au COMMIT) :
    -- Σ jambes = montant et chaque jambe ≥ 0 ; LEG_REALLOCATION : Σ = 0 (08 E7 règles 1, 3, 5)
    IF p_kind = 'LEG_REALLOCATION' THEN
      IF v_sum <> 0 OR v_pos <> p_amount_minor THEN
        RAISE EXCEPTION 'payment: reallocation legs must sum to zero'
          USING ERRCODE = 'integrity_constraint_violation',
                CONSTRAINT = 'payment_operation_leg_sum';
      END IF;
    ELSE
      IF v_neg THEN
        RAISE EXCEPTION 'payment: negative leg'
          USING ERRCODE = 'integrity_constraint_violation',
                CONSTRAINT = 'payment_operation_leg_negative';
      END IF;
      IF v_sum <> p_amount_minor THEN
        RAISE EXCEPTION 'payment: legs do not sum to the operation amount'
          USING ERRCODE = 'integrity_constraint_violation',
                CONSTRAINT = 'payment_operation_leg_sum';
      END IF;
    END IF;
  END IF;

  INSERT INTO core.payment_payment_operation AS o
         (id, hold_id, trip_id, psp_account_id, country_code, provider, method, kind, purpose,
          amount_minor, currency, attempt_no, status, idem_plain, idem_sent, settlement_id,
          settlement_version)
  VALUES (p_id, p_hold_id, p_trip_id, p_psp_account_id, v_country, v_provider, p_method, p_kind,
          p_purpose, p_amount_minor, p_currency, p_attempt_no, 'PENDING', p_idem_plain, p_idem_sent,
          p_settlement_id, p_settlement_version)
  ON CONFLICT ON CONSTRAINT payment_operation_idem_plain_unique DO NOTHING
  RETURNING o.id INTO v_inserted;

  IF v_inserted IS NULL THEN
    -- même clé : rejeu à l'identique, ou conflit d'idempotence
    SELECT * INTO v_existing FROM core.payment_payment_operation AS o
     WHERE o.idem_plain = p_idem_plain;
    IF v_no_legs THEN
      SELECT NOT EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
                          WHERE l.operation_id = v_existing.id)
        INTO v_same_legs;
    ELSE
      SELECT count(*) = 4 AND bool_and(l.amount_minor = (p_legs ->> l.leg)::bigint)
        INTO v_same_legs
        FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = v_existing.id;
    END IF;
    IF v_existing.kind IS DISTINCT FROM p_kind
       OR v_existing.purpose IS DISTINCT FROM p_purpose
       OR v_existing.amount_minor IS DISTINCT FROM p_amount_minor
       OR v_existing.currency IS DISTINCT FROM p_currency
       OR v_existing.hold_id IS DISTINCT FROM p_hold_id
       OR v_existing.trip_id IS DISTINCT FROM p_trip_id
       OR v_existing.psp_account_id IS DISTINCT FROM p_psp_account_id
       OR v_existing.method IS DISTINCT FROM p_method
       OR v_existing.attempt_no IS DISTINCT FROM p_attempt_no
       OR v_existing.idem_sent IS DISTINCT FROM p_idem_sent
       -- US-224 (S-02) : même clé, autre règlement ou autre version ⇒ conflit
       OR v_existing.settlement_id IS DISTINCT FROM p_settlement_id
       OR v_existing.settlement_version IS DISTINCT FROM p_settlement_version
       OR v_same_legs IS NOT TRUE THEN
      RAISE EXCEPTION 'payment: same idempotency key, different content'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_idempotency_conflict';
    END IF;
    -- revues #198 : un ordre de règlement jamais envoyé (PENDING) rejoué repasse la garde : celui
    -- d'une version remplacée entre-temps ne revient pas comme rejeu (operation_settlement_superseded)
    IF v_existing.status = 'PENDING' AND p_trip_id IS NOT NULL
       AND p_kind IN ('REFUND', 'LEG_REALLOCATION', 'LEG_RELEASE') THEN
      PERFORM core.payment_assert_settlement_order(v_existing.id);
    END IF;
    operation_id := v_existing.id;
    replayed := true;
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT v_no_legs THEN
    INSERT INTO core.payment_payment_operation_leg (operation_id, leg, org_id, trip_id, country_code,
                                                    amount_minor)
    SELECT v_inserted, k, v_org, p_trip_id, v_country, (p_legs ->> k)::bigint
      FROM unnest(v_keys) AS k;
  END IF;
  -- US-224 (S-02, phrase 1 ; RC-2 à l'enregistrement) : un ordre REFUND / LEG_REALLOCATION /
  -- LEG_RELEASE d'un trip porte la version en tête de son règlement et reste dans ses bornes,
  -- en-cours compris, sous le verrou du trip ; sinon il n'est jamais créé (donc jamais envoyé)
  PERFORM core.payment_assert_settlement_order(v_inserted);
  operation_id := v_inserted;
  replayed := false;
  RETURN NEXT;
END
$fn$;

COMMENT ON FUNCTION core.payment_cmd_record_operation(uuid, uuid, uuid, uuid, text, text, text,
                                                   bigint, text, integer, text, text, jsonb, uuid,
                                                   integer) IS
  'Enregistre un ordre PENDING et ses jambes (17 §4.3) ; un ordre REFUND / LEG_* de trip porte son '
  'règlement et sa version, gardés à l''enregistrement (S-02). Travailleur payment_command. US-019, US-224.';
REVOKE ALL ON FUNCTION core.payment_cmd_record_operation(uuid, uuid, uuid, uuid, text, text, text,
                                                       bigint, text, integer, text, text, jsonb,
                                                       uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_cmd_record_operation(uuid, uuid, uuid, uuid, text, text, text,
                                                          bigint, text, integer, text, text, jsonb,
                                                          uuid, integer) TO app_worker;

-- 3.2 Commande à 13 arguments (0028, 0048) : même contrat, sans règlement. Tout ordre de trip
-- REFUND / LEG_* passé par elle est refusé par la garde (fail-closed) ; les autres natures sont
-- inchangées. Signature, propriétaire, droits et entrée RLS-15 conservés.
CREATE OR REPLACE FUNCTION core.payment_cmd_record_operation(
  p_id             uuid,
  p_hold_id        uuid,
  p_trip_id        uuid,
  p_psp_account_id uuid,
  p_method         text,
  p_kind           text,
  p_purpose        text,
  p_amount_minor   bigint,
  p_currency       text,
  p_attempt_no     integer,
  p_idem_plain     text,
  p_idem_sent      text,
  p_legs           jsonb
)
  RETURNS TABLE (operation_id uuid, replayed boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN QUERY
    SELECT r.operation_id, r.replayed
      FROM core.payment_cmd_record_operation(p_id, p_hold_id, p_trip_id, p_psp_account_id, p_method,
                                             p_kind, p_purpose, p_amount_minor, p_currency,
                                             p_attempt_no, p_idem_plain, p_idem_sent, p_legs,
                                             NULL::uuid, NULL::integer) AS r;
END
$fn$;

-- 3.3 Enregistrement d'une version de règlement (corps de 0027 recopié ; bloc marqué US-224)
CREATE OR REPLACE FUNCTION core.settlement_cmd_record(
  p_settlement_id    uuid,
  p_trip_id          uuid,
  p_segment_no       integer,
  p_version          integer,
  p_supersedes_id    uuid,
  p_trip_row_version integer,
  p_record           jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_org          uuid;
  v_country      text;
  v_currency     text;
  v_row_version  integer;
  v_head_id      uuid;
  v_head_version integer;
  v_existing     uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS DISTINCT FROM 'settlement' THEN
    RAISE EXCEPTION 'settlement_cmd_record : réservé au travailleur settlement'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_record IS NULL OR pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object'
     OR (p_record ->> 'format') IS DISTINCT FROM '1'
     OR pg_catalog.jsonb_typeof(p_record -> 'lines') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(p_record -> 'taxGroups') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(p_record -> 'legs') IS DISTINCT FROM 'array'
     OR p_segment_no IS NULL OR p_version IS NULL THEN
    RAISE EXCEPTION 'settlement_cmd_record : charge utile invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Bêta : un seul segment par trip (voir la colonne segment_no)
  IF p_segment_no <> 1 THEN
    RAISE EXCEPTION 'settlement_cmd_record : segment % hors bêta', p_segment_no
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_segment_unsupported';
  END IF;

  -- les invariants sont contrôlés après l'insertion complète, dans cet appel
  SET CONSTRAINTS core.settlement_balanced DEFERRED;

  -- 08 E4 : verrou du trip et contrôle optimiste de sa version
  SELECT t.org_id, t.country_code, t.currency, t.row_version
    INTO v_org, v_country, v_currency, v_row_version
    FROM core.booking_trip AS t
   WHERE t.id = p_trip_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_cmd_record : trip inconnu'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_unknown';
  END IF;
  -- US-224 (S-02, phrase 2 ; L2-PM-05) : rejeu de la MÊME version après un COMMIT perdu ⇒ le
  -- règlement existant, rien n'est écrit. Même version, même remplacée, mêmes entrées canoniques
  -- (texte exact et empreinte), mêmes paramètres figés, même moteur, mêmes montants et mêmes
  -- jambes ; l'identifiant proposé par l'appelant peut différer (nouvel essai). Contrôlé AVANT la
  -- version optimiste du trip : la transition qui a suivi le premier enregistrement l'a avancée.
  -- Tout écart reste refusé plus bas (settlement_version_taken ⇒ SETTLEMENT_EXISTS).
  SELECT s.id INTO v_existing
    FROM core.settlement_settlement AS s
   WHERE s.trip_id = p_trip_id AND s.segment_no = p_segment_no AND s.version = p_version
     AND s.supersedes_id IS NOT DISTINCT FROM p_supersedes_id
     AND s.inputs = (p_record ->> 'inputs')
     AND s.inputs_hash = pg_catalog.decode(p_record ->> 'inputsHash', 'hex')
     AND s.param_snapshot_hash = pg_catalog.decode(p_record ->> 'paramSnapshotHash', 'hex')
     AND s.engine_version = (p_record ->> 'engineVersion')
     AND s.kind = (p_record ->> 'kind')
     AND s.currency = (p_record ->> 'currency')
     AND s.reason = (p_record ->> 'reason')
     AND s.qualification = (p_record ->> 'qualification')
     AND s.guest_refund_minor::text = (p_record ->> 'guestRefundMinor')
     AND s.tax_refund_minor::text = (p_record ->> 'taxRefundMinor')
     AND s.retained_minor::text = (p_record ->> 'retainedMinor')
     AND s.host_earnings_minor::text = (p_record ->> 'hostEarningsMinor')
     AND s.platform_net_minor::text = (p_record ->> 'platformNetMinor')
     AND s.host_penalty_minor::text = (p_record ->> 'hostPenaltyMinor')
     AND s.negative_leg::text = (p_record ->> 'negativeLeg')
     -- revues #198 : aussi chaque montant affiché ou déclaré (lignes, taxes, gains) et l'état
     AND s.total_paid_minor::text = (p_record ->> 'totalPaidMinor')
     AND s.retained_tax_minor::text = (p_record ->> 'retainedTaxMinor')
     AND s.host_from_guest_minor::text = (p_record ->> 'hostFromGuestMinor')
     AND s.host_compensation_minor::text = (p_record ->> 'hostCompensationMinor')
     AND s.origin = (p_record ->> 'origin')
     AND s.requested_reason = (p_record ->> 'requestedReason')
     AND s.target_state = (p_record ->> 'targetState')
     AND s.host_eligible::text = (p_record ->> 'hostEligible')
     AND pg_catalog.jsonb_array_length(p_record -> 'lines')
         = (SELECT count(*) FROM core.settlement_settlement_line AS sl WHERE sl.settlement_id = s.id)
     AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.jsonb_array_elements(p_record -> 'lines') AS e
            WHERE NOT EXISTS (
                    SELECT 1 FROM core.settlement_settlement_line AS sl
                     WHERE sl.settlement_id = s.id AND sl.line_type = (e ->> 'line')
                       AND sl.amount_minor::text = (e ->> 'amountMinor')
                       AND sl.refund_minor::text = (e ->> 'refundMinor')
                       AND sl.retained_minor::text = (e ->> 'retainedMinor')))
     AND pg_catalog.jsonb_array_length(p_record -> 'taxGroups')
         = (SELECT count(*) FROM core.settlement_settlement_tax_line AS st
             WHERE st.settlement_id = s.id)
     AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.jsonb_array_elements(p_record -> 'taxGroups') AS e
            WHERE NOT EXISTS (
                    SELECT 1 FROM core.settlement_settlement_tax_line AS st
                     WHERE st.settlement_id = s.id AND st.tax_group = (e ->> 'groupId')
                       AND st.third_party::text = (e ->> 'thirdParty')
                       AND st.tax_paid_minor::text = (e ->> 'taxPaidMinor')
                       AND st.tax_refund_minor::text = (e ->> 'taxRefundMinor')
                       AND st.retained_tax_minor::text = (e ->> 'retainedTaxMinor')))
     AND pg_catalog.jsonb_array_length(p_record -> 'legs') = 4
     AND NOT EXISTS (
           SELECT 1
             FROM pg_catalog.jsonb_array_elements(p_record -> 'legs') AS e
            WHERE NOT EXISTS (
                    SELECT 1 FROM core.settlement_settlement_leg AS l
                     WHERE l.settlement_id = s.id AND l.leg = (e ->> 'leg')
                       AND l.kept_minor::text = (e ->> 'keptMinor')
                       AND l.advance_minor::text = (e ->> 'advanceMinor')
                       AND l.basis_minor::text = (e ->> 'basisMinor')
                       AND l.variation_minor::text = (e ->> 'variationMinor')));
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_row_version IS DISTINCT FROM p_trip_row_version THEN
    RAISE EXCEPTION 'settlement_cmd_record : trip modifié depuis le calcul'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_version';
  END IF;
  IF (p_record ->> 'currency') IS DISTINCT FROM v_currency THEN
    RAISE EXCEPTION 'settlement_cmd_record : devise différente du trip'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_mismatch';
  END IF;

  -- 08 règle de qualification 5 : la version n existe déjà ⇒ 409 SETTLEMENT_EXISTS
  SELECT s.id, s.version INTO v_head_id, v_head_version
    FROM core.settlement_settlement AS s
   WHERE s.trip_id = p_trip_id AND s.segment_no = p_segment_no
   ORDER BY s.version DESC
   LIMIT 1;
  IF p_version <= COALESCE(v_head_version, 0) THEN
    RAISE EXCEPTION 'settlement_cmd_record : version % déjà réglée', p_version
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_version_taken';
  END IF;
  IF p_version <> COALESCE(v_head_version, 0) + 1 OR p_supersedes_id IS DISTINCT FROM v_head_id THEN
    RAISE EXCEPTION 'settlement_cmd_record : la version n+1 remplace exactement la dernière version'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_supersession_invalid';
  END IF;

  INSERT INTO core.settlement_settlement
         (id, trip_id, segment_no, version, supersedes_id, org_id, country_code, currency, kind,
          engine_version, requested_reason, reason, origin, qualification, target_state,
          host_eligible, total_paid_minor, guest_refund_minor, tax_refund_minor, retained_minor,
          retained_tax_minor, host_from_guest_minor, host_compensation_minor, host_earnings_minor,
          platform_net_minor, host_penalty_minor, negative_leg, inputs, inputs_hash,
          param_snapshot_hash)
  VALUES (p_settlement_id, p_trip_id, p_segment_no, p_version, p_supersedes_id, v_org, v_country,
          v_currency, p_record ->> 'kind', p_record ->> 'engineVersion',
          p_record ->> 'requestedReason', p_record ->> 'reason', p_record ->> 'origin',
          p_record ->> 'qualification', p_record ->> 'targetState',
          (p_record ->> 'hostEligible')::boolean,
          (p_record ->> 'totalPaidMinor')::bigint, (p_record ->> 'guestRefundMinor')::bigint,
          (p_record ->> 'taxRefundMinor')::bigint, (p_record ->> 'retainedMinor')::bigint,
          (p_record ->> 'retainedTaxMinor')::bigint, (p_record ->> 'hostFromGuestMinor')::bigint,
          (p_record ->> 'hostCompensationMinor')::bigint, (p_record ->> 'hostEarningsMinor')::bigint,
          (p_record ->> 'platformNetMinor')::bigint, (p_record ->> 'hostPenaltyMinor')::bigint,
          (p_record ->> 'negativeLeg')::boolean, p_record ->> 'inputs',
          pg_catalog.decode(p_record ->> 'inputsHash', 'hex'),
          pg_catalog.decode(p_record ->> 'paramSnapshotHash', 'hex'));

  INSERT INTO core.settlement_settlement_line
         (settlement_id, line_type, amount_minor, refund_minor, retained_minor)
  SELECT p_settlement_id, e ->> 'line', (e ->> 'amountMinor')::bigint, (e ->> 'refundMinor')::bigint,
         (e ->> 'retainedMinor')::bigint
    FROM pg_catalog.jsonb_array_elements(p_record -> 'lines') AS e;

  INSERT INTO core.settlement_settlement_tax_line
         (settlement_id, tax_group, third_party, tax_paid_minor, tax_refund_minor, retained_tax_minor)
  SELECT p_settlement_id, e ->> 'groupId', (e ->> 'thirdParty')::boolean,
         (e ->> 'taxPaidMinor')::bigint, (e ->> 'taxRefundMinor')::bigint,
         (e ->> 'retainedTaxMinor')::bigint
    FROM pg_catalog.jsonb_array_elements(p_record -> 'taxGroups') AS e;

  INSERT INTO core.settlement_settlement_leg
         (settlement_id, trip_id, segment_no, org_id, country_code, leg, kept_minor, advance_minor,
          basis_minor, variation_minor)
  SELECT p_settlement_id, p_trip_id, p_segment_no, v_org, v_country, e ->> 'leg',
         (e ->> 'keptMinor')::bigint, (e ->> 'advanceMinor')::bigint, (e ->> 'basisMinor')::bigint,
         (e ->> 'variationMinor')::bigint
    FROM pg_catalog.jsonb_array_elements(p_record -> 'legs') AS e;

  SET CONSTRAINTS core.settlement_balanced IMMEDIATE;
  RETURN p_settlement_id;
END
$fn$;

-- 3.4 Statut d'une opération (corps de 0116 recopié ; bloc marqué US-224, N-196)
CREATE OR REPLACE FUNCTION core.payment_cmd_apply_operation_status(
  p_operation_id       uuid,
  p_status             text,
  p_source             text,
  p_raw_ref            uuid,
  p_provider_reference text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_current   text;
  v_reference text;
  v_account   uuid;
  v_idem_sent text;
  v_amount    bigint;
  v_currency  text;
  v_kind      text;
  v_purpose   text;
  v_proof     text;
  v_env       text;
  v_rank_cur  integer;
  v_rank_new  integer;
  v_outcome   text;
  v_terminal  boolean;
  v_event     jsonb;
  v_event_ref text;
  v_mismatch  boolean := false;
  v_raw       uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('payment_command', 'webhook_ingest') THEN
    RAISE EXCEPTION 'payment: apply_operation_status reserved to payment workers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN') THEN
    RAISE EXCEPTION 'payment: invalid status' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_terminal := p_status IN ('SUCCEEDED', 'FAILED');
  SELECT o.status, o.provider_reference, o.psp_account_id, o.idem_sent, o.amount_minor,
         o.currency, o.kind, o.purpose, o.proof_type
    INTO v_current, v_reference, v_account, v_idem_sent, v_amount, v_currency, v_kind,
         v_purpose, v_proof
    FROM core.payment_payment_operation AS o
   WHERE o.id = p_operation_id AND o.psp_account_id IS NOT NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  SELECT a.environment INTO v_env FROM core.payment_psp_account AS a WHERE a.id = v_account;

  -- preuve signée d'un statut terminal (17 §4.4 points 2 et 8 ; US-049, 0055, 0058) : webhook à
  -- signature valide, reçu par la commande de réception, jamais hors tolérance d'horodatage, sur le
  -- compte de l'opération, du statut appliqué, et rattaché à CETTE opération. US-223 (S-02) : par sa
  -- référence PSP si elle est connue, sinon par NOTRE clé ; jamais par la référence que l'appelant
  -- passe (un travailleur ne peut pas attacher le webhook de A à B avant que A porte sa référence)
  IF p_source = 'WEBHOOK' AND v_terminal THEN
    SELECT x.e INTO v_event
      FROM core.payment_webhook_inbox AS w,
           pg_catalog.jsonb_array_elements(
             CASE WHEN pg_catalog.jsonb_typeof(w.normalized_events) = 'array'
                  THEN w.normalized_events ELSE '[]'::jsonb END) AS x(e)
     WHERE w.id = p_raw_ref
       AND w.psp_account_id = v_account
       AND w.signature_valid
       AND w.received_by_command
       AND NOT w.signed_at_out_of_tolerance
       AND w.processing_status IN ('RECEIVED', 'QUARANTINED', 'PROCESSED')
       AND NOT (w.processing_status = 'QUARANTINED'
                AND w.error IS NOT DISTINCT FROM 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE')
       AND pg_catalog.jsonb_typeof(x.e) = 'object'
       AND x.e ->> 'status' = p_status
       AND CASE WHEN v_reference IS NOT NULL
                THEN x.e ->> 'providerReference' = v_reference
                ELSE x.e ->> 'merchantReference' = v_idem_sent END
     LIMIT 1;
    IF v_event IS NOT NULL THEN
      v_event_ref := v_event ->> 'providerReference';
      IF v_event_ref IS NULL OR v_event_ref !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
        v_event := NULL;                              -- référence illisible : aucune preuve
      ELSIF p_status = 'SUCCEEDED' THEN
        -- US-223 : montant reçu ≠ montant de l'ordre ⇒ MISMATCH ; un loyer exige le montant
        IF (v_event ? 'amountMinor') OR (v_event ? 'currency') THEN
          v_mismatch := (v_event ->> 'amountMinor') IS DISTINCT FROM v_amount::text
                        OR (v_event ->> 'currency') IS DISTINCT FROM v_currency;
        -- US-224 (N-196) : tout ordre qui déplace des fonds exige le montant reçu (avant :
        -- AUTH / CAPTURE du loyer seulement ; MIT_CHARGE, REFUND, LEG_* étaient prouvables sans
        -- montant). Sans montant ni devise ⇒ aucune preuve ⇒ UNPROVEN. Liste BLANCHE (revues de
        -- la PR #198) : seules VOID, DEPOSIT_VOID, DEPOSIT_AUTH et CHARGEBACK, qui ne déplacent
        -- aucun fonds par l'ordre, en restent dispensées ; toute nature future exige le montant.
        ELSIF v_kind NOT IN ('VOID', 'DEPOSIT_VOID', 'DEPOSIT_AUTH', 'CHARGEBACK') THEN
          v_event := NULL;
        END IF;
      END IF;
    END IF;
  END IF;

  v_rank_cur := CASE v_current WHEN 'PENDING' THEN 0 WHEN 'SUBMITTED' THEN 1 WHEN 'UNKNOWN' THEN 1
                               ELSE 2 END;
  v_rank_new := CASE p_status WHEN 'SUBMITTED' THEN 1 WHEN 'UNKNOWN' THEN 1 ELSE 2 END;

  IF p_status = v_current THEN
    v_outcome := 'DUPLICATE';
    -- US-223 : statut terminal posé sans preuve (réponse d'API) ; le webhook signé du même statut,
    -- sans écart de montant, pose la preuve
    IF p_source = 'WEBHOOK' AND v_terminal AND v_event IS NOT NULL AND NOT v_mismatch
       AND v_proof IS DISTINCT FROM 'WEBHOOK_SIGNED' THEN
      UPDATE core.payment_payment_operation AS o
         SET proof_type = 'WEBHOOK_SIGNED',
             provider_reference = COALESCE(o.provider_reference, v_event_ref)
       WHERE o.id = p_operation_id;
    END IF;
  ELSIF v_rank_new < v_rank_cur THEN
    v_outcome := 'STALE';
  ELSIF v_rank_cur = 2 THEN
    v_outcome := 'CONFLICT';                     -- SUCCEEDED contre FAILED
  ELSIF v_reference IS NOT NULL AND p_provider_reference IS NOT NULL
        AND v_reference <> p_provider_reference THEN
    v_outcome := 'CONFLICT';                     -- référence PSP contradictoire
  ELSIF p_source = 'MANUAL_OPS' AND v_terminal THEN
    -- US-049 (RC-5, 0058) : aucune action du staff journalisée ne prouve encore un statut terminal
    v_outcome := 'UNPROVEN';
  ELSIF p_source IN ('POLL', 'API_RESPONSE') AND v_terminal
        AND (v_env IS DISTINCT FROM 'SANDBOX'
             OR COALESCE(platform.deployment_env(), 'production')
                NOT IN ('test', 'development', 'staging')) THEN
    -- US-223 (S-02, ADR-088 « Limites ») : aucune réponse de lecture ni de création authentifiée
    -- avant le connecteur réel (lot C) ; un compte LIVE n'admet que la preuve signée ; un compte
    -- de bac à sable seulement dans un environnement non productif connu (environnement NULL =
    -- production, même défaut fail-closed que T1 et la réception)
    v_outcome := 'UNPROVEN';
  ELSIF p_source = 'WEBHOOK' AND v_terminal AND v_mismatch THEN
    v_outcome := 'MISMATCH';                     -- US-223 : montant ou devise reçus ≠ ordre
  ELSIF p_source = 'WEBHOOK' AND v_terminal AND v_event IS NULL THEN
    v_outcome := 'UNPROVEN';                     -- US-049 (RC-5) : aucune preuve signée rattachée
  ELSE
    v_outcome := 'APPLIED';
    UPDATE core.payment_payment_operation AS o
       SET status = p_status,
           provider_reference = COALESCE(o.provider_reference,
                                         CASE WHEN p_source = 'WEBHOOK' AND v_terminal
                                              THEN v_event_ref ELSE p_provider_reference END),
           proof_type = CASE
                          WHEN v_terminal AND p_source = 'WEBHOOK' THEN 'WEBHOOK_SIGNED'
                          WHEN v_terminal AND p_source = 'POLL' THEN 'POLL'
                          ELSE o.proof_type
                        END
     WHERE o.id = p_operation_id;
  END IF;

  -- chaque statut reçu est écrit (17 §3.2.7), refus de preuve compris (US-223, S-02) ; raw_ref
  -- seulement s'il désigne une ligne de la boîte de réception
  SELECT w.id INTO v_raw FROM core.payment_webhook_inbox AS w WHERE w.id = p_raw_ref;
  INSERT INTO core.payment_payment_operation_event (id, operation_id, status, source, outcome, raw_ref)
  VALUES (gen_random_uuid(), p_operation_id, p_status, p_source, v_outcome, v_raw);
  RETURN v_outcome;
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
