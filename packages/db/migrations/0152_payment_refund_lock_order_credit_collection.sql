-- 0152 — PAY : durcissement argent n° 2 d'US-224 (suites des revues de #239, partie 224f : BOARD
-- N-364, N-367 ; ADR-150 et ADR-166 complétés, PROPOSÉ). Appliquée sous `migrator`, en une
-- transaction.
--
-- 1. N-364 (revue concurrence de #239) : ordre des verrous de la marque de l'alerte FIN. La
--    transaction de l'ordonnanceur qui signale un rejet confirmé posait `fin_alert` sur l'instance
--    (verrou de LIGNE de l'instance) PUIS appelait `core.payment_cmd_refund_await_choice`, qui prend
--    le verrou du TRIP ; la supersession (nouvelle version du règlement, `settlement_cmd_record`)
--    prend le trip PUIS met à jour les instances : interblocage `40P01` possible. Désormais
--    `core.payment_cmd_refund_mark_alerted` prend le verrou du trip avant la ligne de l'instance
--    (ordre unique : trip puis instance, quel que soit l'ordre des appels) ; l'ordonnanceur appelle
--    en outre `await_choice` AVANT la marque (défense en profondeur) ; commentaire de 0141:367
--    corrigé. Corps de 0127 et de 0141 recopiés à l'identique, blocs marqués « N-364 ».
-- 2. N-367 (passation US-224, partie 224f) : `core.payment_cmd_record_operation` refuse un
--    encaissement par crédit — `CREDIT_REDEMPTION`, ou `AUTH`, `CAPTURE`, `MIT_CHARGE`,
--    `DEBT_COLLECTION`, `DEPOSIT_AUTH`, `DEPOSIT_CAPTURE` d'un moyen `CREDIT_CASH` /
--    `CREDIT_PROMO` (casse ignorée) — tant que les crédits n'existent pas (aucun module, aucun
--    passif `credit_*_liability`) : `payment_operation_credit_unavailable` (55000), rien n'est écrit,
--    même au rejeu. Fail-closed, PROPOSÉ (ADR-166 n° 9) : un crédit imputé sans avoir été émis
--    deviendrait un moyen d'origine remboursable (08 E2). Corps de 0121 recopié, bloc marqué
--    « N-367 ».
--
-- Expand / contract : trois corps remplacés à signature, propriétaire (cmd_money_owner), SECURITY
-- DEFINER et droits identiques ; rien n'est ajouté ni retiré. Aucun appelant de production
-- n'enregistre un encaissement par crédit (l'API N n'en émet aucun).
--
-- Retour arrière :
--   réappliquer core.payment_cmd_record_operation (15 arguments) de 0121,
--   core.payment_cmd_refund_mark_alerted de 0127 et core.payment_cmd_refund_await_choice de 0141
--   (sous cmd_money_owner, avec GRANT / REVOKE CREATE ON SCHEMA core comme ici).

-- 1. Commandes de cmd_money_owner (ADR-044 amendé : CREATE le temps du remplacement) -------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 1.1 N-367 : enregistrement d'un ordre (corps de 0121 recopié, bloc marqué « N-367 »)
CREATE OR REPLACE FUNCTION core.payment_cmd_record_operation(
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
  -- US-224 (N-367, ADR-166 n° 9, PROPOSÉ, fail-closed) : aucun crédit n'existe en bêta (ni module,
  -- ni passif `credit_*_liability`, 08 E2 et grand livre) : un encaissement par crédit (utilisation
  -- `CREDIT_REDEMPTION`, ou encaissement d'un moyen `CREDIT_CASH` / `CREDIT_PROMO`) est refusé
  -- AVANT toute écriture et avant le rejeu, sinon il deviendrait un moyen d'origine remboursable
  -- (08 E2) sans qu'aucun crédit n'ait été émis
  IF p_kind = 'CREDIT_REDEMPTION'
     OR (p_kind IN ('AUTH', 'CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION', 'DEPOSIT_AUTH',
                    'DEPOSIT_CAPTURE')
         AND pg_catalog.upper(p_method) IN ('CREDIT_CASH', 'CREDIT_PROMO')) THEN
    RAISE EXCEPTION 'payment: collection by credit refused while credits do not exist'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'payment_operation_credit_unavailable';
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

-- 1.2 N-364 : marque de l'alerte FIN (corps de 0127 recopié, verrou du trip ajouté)
CREATE OR REPLACE FUNCTION core.payment_cmd_refund_mark_alerted(p_instance_id uuid, p_key text)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: refund_mark_alerted reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_instance_id IS NULL OR p_key IS NULL OR p_key !~ '^[A-Z][A-Z0-9_:]{0,79}$' THEN
    RAISE EXCEPTION 'payment: invalid alert key' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- US-224 (N-364) : verrou du trip AVANT la ligne de l'instance, même ordre que la planification,
  -- l'envoi, le report, l'attente du choix et la supersession (trip puis instance) ; sans lui, la
  -- marque tenait l'instance et l'attente du choix attendait le trip tenu par une supersession qui
  -- attendait l'instance (40P01). Instance inconnue : rien (FALSE), comme avant.
  SELECT ri.trip_id INTO v_trip FROM core.payment_refund_instance AS ri WHERE ri.id = p_instance_id;
  IF v_trip IS NULL THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  UPDATE core.payment_refund_instance AS ri SET fin_alert = p_key
   WHERE ri.id = p_instance_id AND ri.fin_alert IS DISTINCT FROM p_key;
  RETURN FOUND;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_refund_mark_alerted(uuid, text) IS
  'Pose la dernière alerte FIN levée pour une instance de remboursement (code technique seul), '
  'sous le verrou du trip puis de l''instance. Travailleur payment_command. US-224 (224c, N-364), '
  'ADR-150.';

-- 1.3 N-364 : attente du choix (corps de 0141 recopié, commentaire de l'ordre des verrous corrigé)
CREATE OR REPLACE FUNCTION core.payment_cmd_refund_await_choice(p_instance_id uuid)
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
  -- verrou du trip PUIS ligne de l'instance (planification, envoi, report, marque de l'alerte et
  -- supersession prennent le même ordre ; US-224, N-364 : l'appelant ne touche jamais l'instance
  -- avant, dans sa transaction) ; relu sous le verrou
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

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
