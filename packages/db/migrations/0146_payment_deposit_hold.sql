-- 0146 — PAY : caution de la plateforme figée au checkout (`deposit_hold`), vue du voyageur sans
-- champ [C2], minuterie de ré-autorisation.
-- US-701 ; 19 US-701 (critères 3 et 4), US-225 (critère 3 : ré-autorisation avant l'échéance,
-- refusée ⇒ ops, sans débit) ; 16 PAY-011, PAY-036 ; 08 BR-PAY-06 (« Moment de l'évaluation »,
-- « Fail-closed », « Montant unique », « Libération à heure fixe », « Mécanisme »), E4 ;
-- 17 v6 §3.2.7 (`deposit_hold`), §0.1 ; ADR-164 (rails, US-225), ADR-169 (cette migration).
-- Suites d'US-225 fermées : S-2 (table, branchement au checkout, minuterie de ré-autorisation),
-- S-7 (vue du voyageur sans `triggers` ni `params_snapshot`). Appliquée sous `migrator`.
--
-- Cette migration :
--   1. `core.payment_deposit_hold` : UNE décision par hold de checkout (le trip n'existe pas encore
--      au checkout : il est retrouvé par `booking_checkout_hold.converted_trip_id`, écart PROPOSÉ à
--      17 §3.2.7 `trip_id`, ADR-169) ; mécanisme (`NOT_REQUIRED` ou un rail ; un checkout refusé
--      n'écrit AUCUNE ligne, 08), déclencheurs et instantané des paramètres [C2], montant en unités
--      mineures, `H_requise`, `V`, échéancier (`auth_at`, `release_at`, `decision_at`,
--      `reauth_due_at`), état de 16 PAY-011 ; identité figée, transitions gardées, aucune
--      suppression ; RLS ENABLE + FORCE, AUCUN droit direct d'app_api ni d'app_worker (lecture et
--      écriture par les seules fonctions ci-dessous) ;
--   2. `core.payment_deposit_checkout(jeton, hold)` (app_api) : contexte du hold du voyageur de la
--      session (pays, devise et période du devis ENGAGÉ, classe du véhicule, compte marchand du
--      pays, `platform.now()`) ou décision figée réduite à ce que le voyageur peut lire (mécanisme,
--      montant, devise, libération) ;
--   3. `core.payment_cmd_record_deposit_decision(jeton, hold, décision)` (app_api) : écriture
--      unique, revérifie ce que la base sait (fail-closed) : devise du devis, montant =
--      `deposit_amount[pays][classe]`, aucun `NOT_REQUIRED` sur un pays ou une classe déclencheurs
--      (paramètre absent ⇒ déclencheur vrai), rail « débit puis remboursement » refusé tant que
--      `funds_holding_enabled[pays]` = false (17 §0.1) ; une décision déjà figée n'est jamais
--      réécrite (`EXISTING`) ;
--   4. `core.payment_deposit_reauth_due(lot)` et `core.payment_cmd_deposit_transition(…)`
--      (app_worker, nom `payment_command`) : file des ré-autorisations échues et transitions
--      `AUTHORIZED` (pose, lot C), `REAUTHORIZED`, `REAUTH_REFUSED` ; les transitions de décision
--      (capture, VOID, remboursement, expiration) appartiennent à US-702.
--
-- Erreurs (SQLSTATE, contrainte) traduites par packages/db/src/errors.ts, sans DETAIL :
--   deposit_decision_mismatch (23514) → INVARIANT_VIOLATION ; deposit_rail_closed (55000) →
--   FORBIDDEN ; deposit_hold_guarded (55000) → INVARIANT_VIOLATION ;
--   deposit_hold_command_forbidden (42501) → FORBIDDEN ; deposit_hold_hold_unique (23505) →
--   INVARIANT_VIOLATION.
-- Issues rendues (texte, jamais une erreur) : AUTH_REQUIRED, HOLD_NOT_FOUND (hold d'un autre
-- voyageur : même réponse), QUOTE_UNAVAILABLE, HOLD_NOT_PAYABLE, RECORDED, EXISTING, APPLIED, STALE.
--
-- Expand / contract : une table, six fonctions, deux déclencheurs et des politiques AJOUTÉS ; deux
-- droits de colonne et deux politiques de lecture de la configuration AJOUTÉS à cmd_hold_owner ;
-- rien de modifié ni de retiré. `catalog_deposit_policy.amount_minor` n'est pas touché (sa lecture
-- par la fiche est une suite, N-89).
--
-- Retour arrière :
--   DROP FUNCTION core.payment_deposit_checkout(bytea, uuid),
--     core.payment_cmd_record_deposit_decision(bytea, uuid, jsonb),
--     core.payment_deposit_reauth_due(integer),
--     core.payment_cmd_deposit_transition(uuid, text, integer, timestamptz, timestamptz,
--                                         timestamptz, text),
--     core.payment_deposit_amount_param(text, text);
--   DROP TABLE core.payment_deposit_hold; DROP FUNCTION core.payment_deposit_hold_guard();
--   DROP POLICY cmd_hold_deposit_read ON core.config_param_value;
--   DROP POLICY cmd_hold_deposit_read ON core.config_param_definition;
--   REVOKE SELECT (conversion_operation_id) ON core.booking_checkout_hold FROM cmd_hold_owner.

-- 1. Table ----------------------------------------------------------------------------------------
CREATE TABLE core.payment_deposit_hold (
  id                      uuid        PRIMARY KEY DEFAULT platform.uuid_v7(),
  hold_id                 uuid        NOT NULL
    CONSTRAINT deposit_hold_hold_fk REFERENCES core.booking_checkout_hold (id)
    CONSTRAINT deposit_hold_hold_unique UNIQUE,
  country_code            text        NOT NULL
    CONSTRAINT deposit_hold_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency                text        NOT NULL
    CONSTRAINT deposit_hold_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  -- fournisseur du compte marchand du pays à la décision (NULL : aucun ; aucune pose possible)
  provider                text
    CONSTRAINT deposit_hold_provider_format CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  -- REFUSED de 17 §3.2.7 jamais écrit : un checkout refusé n'écrit aucune ligne (08 BR-PAY-06)
  mechanism               text        NOT NULL
    CONSTRAINT deposit_hold_mechanism_valid CHECK (mechanism IN
      ('NOT_REQUIRED', 'PREAUTH_SINGLE', 'REAUTH', 'CHARGE_THEN_REFUND')),
  -- [C2] déclencheurs vrais (liste fermée), jamais lus par le voyageur ni l'hôte
  triggers                text[]      NOT NULL
    CONSTRAINT deposit_hold_triggers_valid CHECK (
      triggers <@ ARRAY['AGE', 'CLASS', 'COUNTRY', 'RISK']::text[]
      AND pg_catalog.array_position(triggers, NULL) IS NULL),
  -- [C2] valeurs des paramètres lues, âge ENTIER du plus jeune conducteur, risk_evaluated ;
  -- aucune date de naissance ni autre donnée personnelle
  params_snapshot         jsonb       NOT NULL
    CONSTRAINT deposit_hold_snapshot_object CHECK (pg_catalog.jsonb_typeof(params_snapshot) = 'object'),
  amount_minor            bigint      NOT NULL
    CONSTRAINT deposit_hold_amount_nonnegative CHECK (amount_minor >= 0),
  h_required_hours        integer
    CONSTRAINT deposit_hold_h_required_positive CHECK (h_required_hours > 0),
  v_hours_snapshot        integer
    CONSTRAINT deposit_hold_v_nonnegative CHECK (v_hours_snapshot >= 0),
  auth_at                 timestamptz,
  auth_expiry_at          timestamptz,
  auth_provider_reference text
    CONSTRAINT deposit_hold_provider_reference_format CHECK (
      auth_provider_reference ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  release_at              timestamptz,
  decision_at             timestamptz,
  reauth_due_at           timestamptz,
  -- rang de la dernière ré-autorisation tentée (clé 08 E4 `i{reauth_seq}`)
  reauth_seq              integer     NOT NULL DEFAULT 0
    CONSTRAINT deposit_hold_reauth_seq_nonnegative CHECK (reauth_seq >= 0),
  status                  text
    CONSTRAINT deposit_hold_status_valid CHECK (status IN
      ('PLANNED', 'AUTHORIZED', 'PARTIALLY_CAPTURED', 'VOIDED', 'REFUNDED', 'EXPIRED')),
  decided_at              timestamptz NOT NULL DEFAULT platform.now(),
  created_at              timestamptz NOT NULL DEFAULT platform.now(),
  updated_at              timestamptz NOT NULL DEFAULT platform.now(),
  row_version             integer     NOT NULL DEFAULT 0,
  -- 17 §3.2.7 : NOT_REQUIRED ⇔ triggers vide ⇔ montant 0, sans opération ni minuterie
  CONSTRAINT deposit_hold_not_required_shape CHECK (
    (mechanism = 'NOT_REQUIRED') = (pg_catalog.cardinality(triggers) = 0)
    AND (mechanism = 'NOT_REQUIRED') = (amount_minor = 0)),
  CONSTRAINT deposit_hold_not_required_empty CHECK (
    mechanism <> 'NOT_REQUIRED'
    OR (status IS NULL AND h_required_hours IS NULL AND v_hours_snapshot IS NULL
        AND auth_at IS NULL AND auth_expiry_at IS NULL AND auth_provider_reference IS NULL
        AND release_at IS NULL AND decision_at IS NULL AND reauth_due_at IS NULL
        AND reauth_seq = 0)),
  CONSTRAINT deposit_hold_required_shape CHECK (
    mechanism = 'NOT_REQUIRED'
    OR (status IS NOT NULL AND h_required_hours IS NOT NULL AND v_hours_snapshot IS NOT NULL
        AND auth_at IS NOT NULL AND release_at IS NOT NULL AND decision_at IS NOT NULL)),
  -- jamais de décision après la libération ni après l'expiration de l'autorisation (08 BR-PAY-06) ;
  -- rail (a) : une décision au-delà de l'expiration en cours n'est admise que tant qu'une
  -- ré-autorisation est planifiée AVANT cette expiration (refusée : décision ramenée avant elle)
  CONSTRAINT deposit_hold_decision_window CHECK (
    decision_at IS NULL
    OR (decision_at <= release_at AND decision_at >= auth_at
        AND (auth_expiry_at IS NULL OR decision_at <= auth_expiry_at
             OR (mechanism = 'REAUTH' AND reauth_due_at IS NOT NULL)))),
  -- minuterie de ré-autorisation : rail (a) seulement, avant l'expiration connue
  CONSTRAINT deposit_hold_reauth_shape CHECK (
    reauth_due_at IS NULL
    OR (mechanism = 'REAUTH' AND status IN ('PLANNED', 'AUTHORIZED')
        AND (auth_expiry_at IS NULL OR reauth_due_at < auth_expiry_at))),
  -- autorisation posée : référence du PSP ; expiration connue sauf débit (rail b)
  CONSTRAINT deposit_hold_authorized_shape CHECK (
    status IS DISTINCT FROM 'AUTHORIZED'
    OR (auth_provider_reference IS NOT NULL
        AND (mechanism = 'CHARGE_THEN_REFUND' OR auth_expiry_at IS NOT NULL)))
);
CREATE INDEX deposit_hold_reauth_due_idx ON core.payment_deposit_hold (reauth_due_at)
  WHERE reauth_due_at IS NOT NULL;
COMMENT ON TABLE core.payment_deposit_hold IS
  'PAY deposit_hold (17 §3.2.7) : décision de la caution figée au checkout, une par hold ; '
  'triggers et params_snapshot [C2] (SYSTEM et ops seulement). US-701, ADR-169.';

-- Garde (tous rôles) : décision et identité figées ; NOT_REQUIRED jamais modifiée ; transitions de
-- 16 PAY-011 seulement (PLANNED → AUTHORIZED → AUTHORIZED | état final), un état final est figé.
CREATE FUNCTION core.payment_deposit_hold_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF OLD.mechanism = 'NOT_REQUIRED'
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.hold_id IS DISTINCT FROM OLD.hold_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.mechanism IS DISTINCT FROM OLD.mechanism OR NEW.triggers IS DISTINCT FROM OLD.triggers
     OR NEW.params_snapshot IS DISTINCT FROM OLD.params_snapshot
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.h_required_hours IS DISTINCT FROM OLD.h_required_hours
     OR NEW.v_hours_snapshot IS DISTINCT FROM OLD.v_hours_snapshot
     OR NEW.auth_at IS DISTINCT FROM OLD.auth_at OR NEW.release_at IS DISTINCT FROM OLD.release_at
     OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.reauth_seq < OLD.reauth_seq
     OR (OLD.auth_provider_reference IS NOT NULL
         AND NEW.auth_provider_reference IS DISTINCT FROM OLD.auth_provider_reference)
     OR OLD.status IN ('PARTIALLY_CAPTURED', 'VOIDED', 'REFUNDED', 'EXPIRED')
     OR (OLD.status = 'PLANNED' AND NEW.status NOT IN ('PLANNED', 'AUTHORIZED'))
     OR (OLD.status = 'AUTHORIZED' AND NEW.status = 'PLANNED') THEN
    RAISE EXCEPTION 'deposit_hold : décision figée ou transition refusée'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'deposit_hold_guarded';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_deposit_hold_guard() FROM PUBLIC;

CREATE TRIGGER deposit_hold_guard BEFORE UPDATE ON core.payment_deposit_hold
  FOR EACH ROW EXECUTE FUNCTION core.payment_deposit_hold_guard();
CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_deposit_hold
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
CREATE TRIGGER money_no_delete BEFORE DELETE ON core.payment_deposit_hold
  FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.payment_deposit_hold
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete();

ALTER TABLE core.payment_deposit_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_deposit_hold FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payment_deposit_hold TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.payment_deposit_hold FROM PUBLIC;
-- aucun droit d'app_api, d'app_worker ni d'app_anon : lecture et écriture par les fonctions de
-- cmd_hold_owner ci-dessous ; lecture ops (triggers, params_snapshot) : suite (console O01)

-- commandes (cmd_hold_owner) : écriture par le voyageur de la session (checkout), transitions par
-- le travailleur payment_command
GRANT SELECT ON core.payment_deposit_hold TO cmd_hold_owner;
GRANT INSERT (hold_id, country_code, currency, provider, mechanism, triggers, params_snapshot,
              amount_minor, h_required_hours, v_hours_snapshot, auth_at, release_at, decision_at,
              reauth_due_at, status)
  ON core.payment_deposit_hold TO cmd_hold_owner;
GRANT UPDATE (status, auth_expiry_at, auth_provider_reference, decision_at, reauth_due_at,
              reauth_seq)
  ON core.payment_deposit_hold TO cmd_hold_owner;
CREATE POLICY cmd_hold_sel ON core.payment_deposit_hold FOR SELECT TO cmd_hold_owner USING (true);
CREATE POLICY cmd_hold_ins ON core.payment_deposit_hold FOR INSERT TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'GUEST' AND (status IS NULL OR status = 'PLANNED')
              AND reauth_seq = 0 AND auth_expiry_at IS NULL AND auth_provider_reference IS NULL);
CREATE POLICY cmd_hold_upd ON core.payment_deposit_hold FOR UPDATE TO cmd_hold_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

-- 2. Droits complémentaires de cmd_hold_owner (au plus juste) --------------------------------------
-- paramètres de la caution revérifiés par la commande ; interrupteur funds_holding_enabled lu par
-- core.config_go_live (politiques ajoutées à côté des autres : permissives, OU)
CREATE POLICY cmd_hold_deposit_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('deposit_always_required', 'deposit_trigger_classes', 'deposit_amount',
                 'funds_holding_enabled'));
CREATE POLICY cmd_hold_deposit_read ON core.config_param_definition FOR SELECT TO cmd_hold_owner
  USING (key = 'funds_holding_enabled');
-- moyen de paiement du trip (opération de loyer convertie) : `tender_id` de la clé 08 E4
GRANT SELECT (conversion_operation_id) ON core.booking_checkout_hold TO cmd_hold_owner;

-- 3. Fonctions (cmd_hold_owner, liste blanche RLS-15) -------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- Valeur en vigueur d'un paramètre de pays (portée COUNTRY) ; NULL : absent. SECURITY INVOKER :
-- appelée par les commandes ci-dessous sous cmd_hold_owner (politique cmd_hold_deposit_read).
CREATE FUNCTION core.payment_deposit_amount_param(p_key text, p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT v.value
    FROM core.config_param_value AS v CROSS JOIN t
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;
REVOKE ALL ON FUNCTION core.payment_deposit_amount_param(text, text) FROM PUBLIC;

-- Contexte de la caution du hold du checkout du voyageur de la session ; décision figée réduite à
-- ce que le voyageur peut lire (jamais triggers ni params_snapshot). Hold d'un autre voyageur ou
-- sans checkout : HOLD_NOT_FOUND (IDOR, 17 §2.3).
CREATE FUNCTION core.payment_deposit_checkout(p_token_hash bytea, p_hold_id uuid)
  RETURNS TABLE (outcome         text,
                 country_code    text,
                 currency        text,
                 value_class     text,
                 scheduled_start timestamptz,
                 scheduled_end   timestamptz,
                 provider        text,
                 now             timestamptz,
                 mechanism       text,
                 amount_minor    bigint,
                 release_at      timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_hold record;
  v_dep  record;
  v_t    record;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    outcome := 'AUTH_REQUIRED';
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT h.id, h.country_code, h.vehicle_id INTO v_hold
    FROM core.booking_checkout_hold AS h
    JOIN core.booking_checkout_acceptance AS a ON a.hold_id = h.id
   WHERE h.id = p_hold_id AND h.guest_user_id = v_user AND a.guest_user_id = v_user;
  IF v_hold.id IS NULL THEN
    outcome := 'HOLD_NOT_FOUND';
    RETURN NEXT;
    RETURN;
  END IF;
  now := platform.now();
  country_code := v_hold.country_code;
  SELECT d.mechanism, d.amount_minor, d.currency, d.release_at INTO v_dep
    FROM core.payment_deposit_hold AS d WHERE d.hold_id = v_hold.id;
  IF v_dep.mechanism IS NOT NULL THEN
    outcome := 'DONE';
    mechanism := v_dep.mechanism;
    amount_minor := v_dep.amount_minor;
    currency := v_dep.currency;
    release_at := v_dep.release_at;
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT * INTO v_t FROM core.booking_checkout_capture_terms(v_hold.id);
  IF v_t.currency IS NULL THEN
    outcome := 'QUOTE_UNAVAILABLE';
    RETURN NEXT;
    RETURN;
  END IF;
  outcome := 'DONE';
  currency := v_t.currency;
  scheduled_start := v_t.scheduled_start;
  scheduled_end := v_t.scheduled_end;
  SELECT v.value_class INTO value_class FROM core.catalog_vehicle AS v WHERE v.id = v_hold.vehicle_id;
  -- compte marchand de Kmino du pays : même choix que T1 (0116)
  SELECT a.provider INTO provider
    FROM core.payment_psp_account AS a
   WHERE a.country_code = v_hold.country_code AND a.status = 'ACTIVE'
     AND (a.environment = 'LIVE'
          OR COALESCE(platform.deployment_env(), 'production') IN ('test', 'development', 'staging'))
   ORDER BY (a.environment = 'LIVE') DESC, a.provider, a.id
   LIMIT 1;
  RETURN NEXT;
END
$fn$;
COMMENT ON FUNCTION core.payment_deposit_checkout(bytea, uuid) IS
  'Caution du hold du checkout du voyageur de la session : contexte de la décision, ou décision '
  'figée sans champ [C2] (S-7). SECURITY DEFINER, EXECUTE app_api. US-701 (ADR-169).';

-- Écriture unique de la décision (avant T1). Revérifie ce que la base sait ; une incohérence est une
-- panne du programme (exception), jamais un succès.
CREATE FUNCTION core.payment_cmd_record_deposit_decision(p_token_hash bytea, p_hold_id uuid,
                                                         p_decision jsonb)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user       uuid;
  v_hold       record;
  v_t          record;
  v_class      text;
  v_mech       text := p_decision ->> 'mechanism';
  v_triggers   text[];
  v_amount     bigint;
  v_always     jsonb;
  v_classes    jsonb;
  v_amounts    jsonb;
  v_prev_kind  text;
  v_prev_actor text;
  v_locked     boolean;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  SELECT h.id, h.country_code, h.vehicle_id, h.status INTO v_hold
    FROM core.booking_checkout_hold AS h
    JOIN core.booking_checkout_acceptance AS a ON a.hold_id = h.id
   WHERE h.id = p_hold_id AND h.guest_user_id = v_user AND a.guest_user_id = v_user;
  IF v_hold.id IS NULL THEN
    RETURN 'HOLD_NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_deposit_hold AS d WHERE d.hold_id = v_hold.id) THEN
    RETURN 'EXISTING';
  END IF;
  IF v_hold.status NOT IN ('ACTIVE', 'PAYMENT_IN_FLIGHT') THEN
    RETURN 'HOLD_NOT_PAYABLE';
  END IF;
  SELECT * INTO v_t FROM core.booking_checkout_capture_terms(v_hold.id);
  IF v_t.currency IS NULL THEN
    RETURN 'QUOTE_UNAVAILABLE';
  END IF;
  SELECT v.value_class INTO v_class FROM core.catalog_vehicle AS v WHERE v.id = v_hold.vehicle_id;
  IF pg_catalog.jsonb_typeof(p_decision -> 'triggers') IS DISTINCT FROM 'array'
     OR (p_decision ->> 'amountMinor') !~ '^(0|[1-9][0-9]{0,17})$' THEN
    RAISE EXCEPTION 'caution : décision illisible'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'deposit_decision_mismatch';
  END IF;
  v_triggers := ARRAY(SELECT pg_catalog.jsonb_array_elements_text(p_decision -> 'triggers'));
  v_amount := (p_decision ->> 'amountMinor')::bigint;
  v_always := core.payment_deposit_amount_param('deposit_always_required', v_hold.country_code);
  v_classes := core.payment_deposit_amount_param('deposit_trigger_classes', v_hold.country_code);
  v_amounts := core.payment_deposit_amount_param('deposit_amount', v_hold.country_code);
  IF v_mech = 'NOT_REQUIRED' THEN
    -- fail-closed (08 BR-PAY-06) : paramètre absent ou illisible, classe inconnue ⇒ déclencheur vrai
    IF v_always IS DISTINCT FROM 'false'::jsonb
       OR pg_catalog.jsonb_typeof(v_classes) IS DISTINCT FROM 'array'
       OR v_class IS NULL
       OR v_classes ? v_class THEN
      RAISE EXCEPTION 'caution : aucune caution refusée pour ce pays ou cette classe'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'deposit_decision_mismatch';
    END IF;
  ELSE
    -- montant unique (08 « Montant unique ») : deposit_amount[pays][classe], jamais inventé
    IF v_class IS NULL OR pg_catalog.jsonb_typeof(v_amounts) IS DISTINCT FROM 'object'
       OR (v_amounts ->> v_class) IS NULL
       OR (v_amounts ->> v_class) !~ '^[1-9][0-9]{0,17}$'
       OR (v_amounts ->> v_class)::bigint <> v_amount THEN
      RAISE EXCEPTION 'caution : montant différent de deposit_amount'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'deposit_decision_mismatch';
    END IF;
    -- aucun fonds de tiers détenu (17 §0.1) : rail (b) fermé tant que l'interrupteur est faux
    IF v_mech = 'CHARGE_THEN_REFUND'
       AND NOT core.config_go_live('funds_holding_enabled', v_hold.country_code) THEN
      RAISE EXCEPTION 'caution : débit puis remboursement fermé (funds_holding_enabled)'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'deposit_rail_closed';
    END IF;
  END IF;
  -- contexte du voyageur (comme T1, 0116) le temps du verrou et de l'écriture, puis remis ; une
  -- erreur annule l'instruction (et le contexte avec elle)
  v_prev_kind := pg_catalog.current_setting('app.actor_kind', true);
  v_prev_actor := pg_catalog.current_setting('app.actor_id', true);
  PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
  PERFORM pg_catalog.set_config('app.actor_id', v_user::text, true);
  -- verrou du hold (politique cmd_hold_upd : hold vivant du voyageur) : deux onglets ne figent
  -- jamais deux décisions ; la décision est relue sous le verrou
  PERFORM 1 FROM core.booking_checkout_hold AS h WHERE h.id = v_hold.id FOR UPDATE;
  v_locked := FOUND;
  IF NOT v_locked OR EXISTS (SELECT 1 FROM core.payment_deposit_hold AS d
                              WHERE d.hold_id = v_hold.id) THEN
    PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_prev_kind, ''), true);
    PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_prev_actor, ''), true);
    RETURN CASE WHEN v_locked THEN 'EXISTING' ELSE 'HOLD_NOT_PAYABLE' END;
  END IF;
  INSERT INTO core.payment_deposit_hold (hold_id, country_code, currency, provider, mechanism,
                                         triggers, params_snapshot, amount_minor,
                                         h_required_hours, v_hours_snapshot, auth_at, release_at,
                                         decision_at, reauth_due_at, status)
  VALUES (v_hold.id, v_hold.country_code, v_t.currency, NULLIF(p_decision ->> 'provider', ''),
          v_mech, v_triggers, p_decision -> 'paramsSnapshot', v_amount,
          (p_decision ->> 'hRequiredHours')::integer, (p_decision ->> 'vHours')::integer,
          (p_decision ->> 'authAt')::timestamptz, (p_decision ->> 'releaseAt')::timestamptz,
          (p_decision ->> 'decisionAt')::timestamptz, (p_decision ->> 'reauthDueAt')::timestamptz,
          CASE WHEN v_mech = 'NOT_REQUIRED' THEN NULL ELSE 'PLANNED' END);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_prev_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_prev_actor, ''), true);
  RETURN 'RECORDED';
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_record_deposit_decision(bytea, uuid, jsonb) IS
  'Décision de la caution du hold du checkout du voyageur de la session, figée une fois avant le '
  'paiement ; montant, pays, classe et rail (b) revérifiés. SECURITY DEFINER, EXECUTE app_api. '
  'US-701 (ADR-169).';

-- File des ré-autorisations échues (travailleur payment_command) : caution REAUTH autorisée, hold
-- converti en trip ; clé 08 E4 (trip, segment n° 1, moyen = opération de loyer convertie).
CREATE FUNCTION core.payment_deposit_reauth_due(p_limit integer)
  RETURNS TABLE (deposit_id         uuid,
                 trip_id            uuid,
                 segment_id         uuid,
                 tender_id          uuid,
                 country_code       text,
                 currency           text,
                 provider           text,
                 provider_reference text,
                 auth_expiry_at     timestamptz,
                 release_at         timestamptz,
                 reauth_seq         integer,
                 now                timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT d.id, h.converted_trip_id, s.id, h.conversion_operation_id, d.country_code, d.currency,
         d.provider, d.auth_provider_reference, d.auth_expiry_at, d.release_at, d.reauth_seq, t.ts
    FROM core.payment_deposit_hold AS d
    CROSS JOIN t
    JOIN core.booking_checkout_hold AS h ON h.id = d.hold_id AND h.status = 'CONVERTED'
    JOIN core.booking_trip_segment AS s ON s.trip_id = h.converted_trip_id AND s.seq = 1
   WHERE app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
     AND d.mechanism = 'REAUTH' AND d.status = 'AUTHORIZED'
     AND d.reauth_due_at IS NOT NULL AND d.reauth_due_at <= t.ts
     AND d.provider IS NOT NULL AND d.auth_provider_reference IS NOT NULL
   ORDER BY d.reauth_due_at, d.id
   LIMIT GREATEST(LEAST(p_limit, 500), 0)
$fn$;
COMMENT ON FUNCTION core.payment_deposit_reauth_due(integer) IS
  'Cautions REAUTH autorisées dont la ré-autorisation est échue (platform.now()), sans champ [C2]. '
  'SECURITY DEFINER, EXECUTE app_worker (payment_command). US-701 (ADR-169).';

-- Transitions de la pose et de la ré-autorisation (16 PAY-011 « États ») ; rang attendu : un
-- passage concurrent ou un rejeu tardif rend STALE sans rien écrire.
CREATE FUNCTION core.payment_cmd_deposit_transition(p_deposit_id uuid, p_event text,
                                                    p_expected_seq integer,
                                                    p_auth_expiry_at timestamptz,
                                                    p_decision_at timestamptz,
                                                    p_reauth_due_at timestamptz,
                                                    p_provider_reference text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_d record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'caution : transition réservée au travailleur payment_command'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'deposit_hold_command_forbidden';
  END IF;
  SELECT d.id, d.mechanism, d.status, d.reauth_seq INTO v_d
    FROM core.payment_deposit_hold AS d WHERE d.id = p_deposit_id FOR UPDATE;
  IF v_d.id IS NULL OR v_d.reauth_seq IS DISTINCT FROM p_expected_seq THEN
    RETURN 'STALE';
  END IF;
  CASE p_event
    WHEN 'AUTHORIZED' THEN
      IF v_d.status IS DISTINCT FROM 'PLANNED' THEN
        RETURN 'STALE';
      END IF;
      UPDATE core.payment_deposit_hold
         SET status = 'AUTHORIZED', auth_expiry_at = p_auth_expiry_at,
             auth_provider_reference = p_provider_reference, decision_at = p_decision_at,
             reauth_due_at = p_reauth_due_at
       WHERE id = p_deposit_id;
    WHEN 'REAUTHORIZED', 'REAUTH_REFUSED' THEN
      IF v_d.status IS DISTINCT FROM 'AUTHORIZED' OR v_d.mechanism <> 'REAUTH' THEN
        RETURN 'STALE';
      END IF;
      -- refusée : aucune nouvelle ré-autorisation, expiration inchangée (aucun débit, 19 US-225)
      UPDATE core.payment_deposit_hold
         SET auth_expiry_at = CASE WHEN p_event = 'REAUTHORIZED' THEN p_auth_expiry_at
                                   ELSE auth_expiry_at END,
             decision_at = p_decision_at,
             reauth_due_at = CASE WHEN p_event = 'REAUTHORIZED' THEN p_reauth_due_at END,
             reauth_seq = reauth_seq + 1
       WHERE id = p_deposit_id;
    ELSE
      RAISE EXCEPTION 'caution : événement inconnu'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'deposit_hold_guarded';
  END CASE;
  RETURN 'APPLIED';
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_deposit_transition(uuid, text, integer, timestamptz,
                                                        timestamptz, timestamptz, text) IS
  'Transitions AUTHORIZED, REAUTHORIZED, REAUTH_REFUSED de deposit_hold (machine d''état gardée). '
  'SECURITY DEFINER, EXECUTE app_worker (payment_command). US-701 (ADR-169).';

-- droits posés par le propriétaire (un REVOKE de migrator, non propriétaire, serait sans effet)
REVOKE ALL ON FUNCTION core.payment_deposit_checkout(bytea, uuid),
  core.payment_cmd_record_deposit_decision(bytea, uuid, jsonb),
  core.payment_deposit_reauth_due(integer),
  core.payment_cmd_deposit_transition(uuid, text, integer, timestamptz, timestamptz, timestamptz,
                                      text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_deposit_checkout(bytea, uuid),
  core.payment_cmd_record_deposit_decision(bytea, uuid, jsonb)
  TO app_api;
GRANT EXECUTE ON FUNCTION core.payment_deposit_reauth_due(integer),
  core.payment_cmd_deposit_transition(uuid, text, integer, timestamptz, timestamptz, timestamptz,
                                      text)
  TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
