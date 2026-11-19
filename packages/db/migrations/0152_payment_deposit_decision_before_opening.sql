-- 0152 — PAY : décision de la caution, corrections « avant ouverture d'un pays » (US-702b).
-- Réserves des revues de la PR 248 (US-702, 0150 ; docs/team/reviews/US-702/) : argent n° 8 et 9,
-- sécurité n° 8, architecture n° 7 et 8 ; 08 BR-PAY-06 (« Mécanisme », « Libération à heure fixe,
-- jamais suspendue » : `release_at = (checkout_at ?? scheduled_end) + 72 h`, `deposit_decision_at =
-- min(release_at, auth_expiry − deposit_safety_h)`, « un retour tardif ne prolonge jamais
-- l'autorisation »), 08 E3 repli 4 (« montant bloqué et date d'expiration ») ; 17 v6 §3.2.7, §4.5 ;
-- ADR-169 (0146), ADR-172 (0150, mise à jour US-702b). Appliquée sous `migrator`.
--
-- Cette migration :
--   1. `core.payment_cmd_record_deposit_decision` (CREATE OR REPLACE depuis 0150) : la validité V
--      reçue de l'API ne peut plus avancer la décision AU-DELÀ de la règle : le rail se revérifie en
--      base (pré-autorisation unique ⇔ `H_requise ≤ V`, `H_requise = (release_at − auth_at) +
--      marge_h` ; ré-autorisation ⇔ `V > deposit_reauth_lead_h`), sinon refus
--      `deposit_decision_mismatch` (fail-closed) ; `marge_h` absent ou illisible ⇒ refus. La
--      décision d'une pré-autorisation unique ne tombe donc jamais plus de `deposit_safety_h` avant
--      la libération (T57 : fin + 70 h) : aucun VOID anticipé. Le reste est recopié ;
--   2. `core.payment_deposit_effective_schedule(…)` (SECURITY INVOKER, aucun EXECUTE : appelée par
--      les fonctions de cmd_hold_owner) : libération EFFECTIVE `(retour réel ?? fin prévue) + délai
--      figé` — le retour réel est la première transition `RETURNED` du journal d'état du trip (heure
--      de la base, `booking_trip_state_log`, immuable), le délai est celui figé dans `release_at` à
--      l'écriture de la décision — et décision EFFECTIVE : retour à l'heure ou anticipé ⇒
--      `min(decision_at, libération effective)` ; retour tardif ⇒ `min(libération effective,
--      auth_expiry − deposit_safety_h)`, jamais avant `decision_at` (un retour tardif ne prolonge
--      jamais l'autorisation, 08 BR-PAY-06) ; `deposit_safety_h` absent ou illisible ⇒ `decision_at`
--      figé (fail-closed : jamais après l'expiration) ;
--   3. `core.payment_deposit_decision_due` et `core.payment_cmd_deposit_decide` (CREATE OR REPLACE
--      depuis 0150, mêmes signatures, mêmes droits) : file et garde sur la décision EFFECTIVE ;
--      charge utile de `deposit.decision.executed` ÉTENDUE de `notice` (`RELEASED`,
--      `PARTIALLY_CAPTURED`, `BLOCKED_UNTIL_EXPIRY` : état `EXPIRED` écrit avant l'expiration de
--      l'autorisation, c'est-à-dire VOID refusé ou non pris en charge, 08 E3 repli 4) et de
--      `auth_expiry_at` (date d'expiration annoncée au voyageur) ;
--   4. `core.payment_deposit_reauth_due` (CREATE OR REPLACE depuis 0146, même signature) :
--      `release_at` rendu = `min(release_at, libération effective)` : un retour anticipé évite une
--      ré-autorisation inutile, un retour tardif n'en ajoute aucune (08 BR-PAY-06).
--
-- Erreurs (SQLSTATE, contrainte) traduites par packages/db/src/errors.ts, sans DETAIL :
--   deposit_decision_mismatch (23514) → INVARIANT_VIOLATION ; deposit_hold_guarded (55000) →
--   INVARIANT_VIOLATION ; deposit_hold_command_forbidden (42501) → FORBIDDEN (inchangés).
--
-- Expand / contract : une fonction AJOUTÉE (sans EXECUTE) ; quatre fonctions REMPLACÉES à signature
-- et droits identiques ; la politique de lecture de la configuration de cmd_hold_owner ÉLARGIE à
-- `marge_h` ; lecture de la colonne `at` du journal d'état ACCORDÉE à cmd_hold_owner ; deux clés
-- AJOUTÉES à la charge utile de l'événement (version 1 inchangée : ajout seulement). Rien de retiré.
--
-- Retour arrière :
--   recréer core.payment_cmd_record_deposit_decision, core.payment_deposit_decision_due et
--     core.payment_cmd_deposit_decide depuis 0150, core.payment_deposit_reauth_due depuis 0146 ;
--   DROP FUNCTION core.payment_deposit_effective_schedule(timestamptz, timestamptz, timestamptz,
--     text, uuid);
--   REVOKE SELECT (at) ON core.booking_trip_state_log FROM cmd_hold_owner;
--   ALTER POLICY cmd_hold_deposit_read ON core.config_param_value USING (key IN
--     ('deposit_always_required', 'deposit_trigger_classes', 'deposit_amount',
--      'funds_holding_enabled', 'auth_lead_h', 'release_delay_h', 'deposit_safety_h',
--      'deposit_reauth_lead_h'));

-- 1. Droits complémentaires de cmd_hold_owner ------------------------------------------------------
-- `marge_h` de `H_requise` (08 BR-PAY-06 « Mécanisme ») relue par l'écriture de la décision
ALTER POLICY cmd_hold_deposit_read ON core.config_param_value
  USING (key IN ('deposit_always_required', 'deposit_trigger_classes', 'deposit_amount',
                 'funds_holding_enabled', 'auth_lead_h', 'release_delay_h', 'deposit_safety_h',
                 'deposit_reauth_lead_h', 'marge_h'));
-- heure du retour réel (première transition RETURNED, heure de la base) ; la politique
-- cmd_trip_log_sel de 0099 couvre déjà la lecture des lignes
GRANT SELECT (at) ON core.booking_trip_state_log TO cmd_hold_owner;

-- 2. Fonctions (cmd_hold_owner, liste blanche RLS-15) -------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- Échéancier EFFECTIF de la décision (08 BR-PAY-06) ; SECURITY INVOKER, aucun EXECUTE : appelée par
-- la file, la transition finale et la file des ré-autorisations (propriétaire cmd_hold_owner).
-- `release_at` et `decision_at` figés à l'écriture de la décision (garde de 0146) ne changent pas :
-- seule leur lecture tient compte du retour réel.
CREATE FUNCTION core.payment_deposit_effective_schedule(p_release_at     timestamptz,
                                                        p_decision_at    timestamptz,
                                                        p_auth_expiry_at timestamptz,
                                                        p_country        text,
                                                        p_trip_id        uuid)
  RETURNS TABLE (release_at timestamptz, decision_at timestamptz)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH r AS (
    -- (retour réel ?? fin prévue) + délai figé = release_at décalé de (retour réel − fin prévue)
    SELECT p_release_at + COALESCE(
             (SELECT pg_catalog.min(l.at) FROM core.booking_trip_state_log AS l
               WHERE l.trip_id = p_trip_id AND l.to_status = 'RETURNED'
                 AND l.kind = 'TRANSITION')
             - (SELECT t.scheduled_end FROM core.booking_trip AS t WHERE t.id = p_trip_id),
             interval '0') AS eff,
           core.payment_deposit_amount_param('deposit_safety_h', p_country) AS safety
  )
  SELECT r.eff,
         CASE
           -- retour à l'heure ou anticipé : libération (et décision) au plus tard à la règle
           WHEN r.eff <= p_release_at THEN LEAST(p_decision_at, r.eff)
           -- retour tardif : jamais au-delà de l'expiration moins la marge, jamais avant decision_at
           WHEN pg_catalog.jsonb_typeof(r.safety) = 'number'
                AND (r.safety #>> '{}') ~ '^(0|[1-9][0-9]{0,5})$'
             THEN GREATEST(p_decision_at,
                           LEAST(r.eff, p_auth_expiry_at - pg_catalog.make_interval(
                                          hours => (r.safety #>> '{}')::integer)))
           -- marge illisible : décision figée (fail-closed, jamais après l'expiration)
           ELSE p_decision_at
         END
    FROM r
$fn$;
REVOKE ALL ON FUNCTION core.payment_deposit_effective_schedule(timestamptz, timestamptz,
  timestamptz, text, uuid) FROM PUBLIC;
COMMENT ON FUNCTION core.payment_deposit_effective_schedule(timestamptz, timestamptz, timestamptz,
                                                            text, uuid) IS
  'Libération et décision effectives de la caution : (retour réel ?? fin prévue) + délai figé, '
  'décision min(libération, expiration − deposit_safety_h), jamais avant decision_at sur retour '
  'tardif (08 BR-PAY-06). SECURITY INVOKER, aucun EXECUTE. US-702b (ADR-172).';

-- Écriture unique de la décision (avant T1), recopiée de 0150 ; seul le contrôle du rail par V
-- change (US-702b).
CREATE OR REPLACE FUNCTION core.payment_cmd_record_deposit_decision(p_token_hash bytea,
                                                                    p_hold_id uuid,
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
  v_now        timestamptz := platform.now();
  v_hours      jsonb;
  v_lead_h     integer;
  v_delay_h    integer;
  v_safety_h   integer;
  v_rlead_h    integer;
  v_marge_h    integer;
  v_v_h        integer;
  v_provider   text;
  v_auth_at    timestamptz;
  v_release_at timestamptz;
  v_decision   timestamptz;
  v_reauth_due timestamptz;
  v_expiry     timestamptz;
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
    IF v_mech NOT IN ('PREAUTH_SINGLE', 'REAUTH', 'CHARGE_THEN_REFUND') THEN
      RAISE EXCEPTION 'caution : mécanisme inconnu'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'deposit_decision_mismatch';
    END IF;
    -- US-702 : échéancier RECALCULÉ (08 BR-PAY-06 « Libération à heure fixe », « Mécanisme » ;
    -- ADR-169 point 5) ; une durée absente ou illisible ⇒ refus (failMode BLOCK de 0009 / 0142)
    FOREACH v_hours IN ARRAY ARRAY[
      core.payment_deposit_amount_param('auth_lead_h', v_hold.country_code),
      core.payment_deposit_amount_param('release_delay_h', v_hold.country_code),
      core.payment_deposit_amount_param('deposit_safety_h', v_hold.country_code),
      core.payment_deposit_amount_param('deposit_reauth_lead_h', v_hold.country_code),
      core.payment_deposit_amount_param('marge_h', v_hold.country_code),
      p_decision -> 'vHours'] LOOP
      IF pg_catalog.jsonb_typeof(v_hours) IS DISTINCT FROM 'number'
         OR (v_hours #>> '{}') !~ '^(0|[1-9][0-9]{0,5})$' THEN
        RAISE EXCEPTION 'caution : durée de l''échéancier absente ou illisible'
          USING ERRCODE = 'check_violation', CONSTRAINT = 'deposit_decision_mismatch';
      END IF;
    END LOOP;
    v_lead_h := (core.payment_deposit_amount_param('auth_lead_h', v_hold.country_code)
                 #>> '{}')::integer;
    v_delay_h := (core.payment_deposit_amount_param('release_delay_h', v_hold.country_code)
                  #>> '{}')::integer;
    v_safety_h := (core.payment_deposit_amount_param('deposit_safety_h', v_hold.country_code)
                   #>> '{}')::integer;
    v_rlead_h := (core.payment_deposit_amount_param('deposit_reauth_lead_h', v_hold.country_code)
                  #>> '{}')::integer;
    v_marge_h := (core.payment_deposit_amount_param('marge_h', v_hold.country_code)
                  #>> '{}')::integer;
    -- V (validité du PSP, US-225) : instantané de la décision, borné ; il ne fait qu'AVANCER la
    -- décision (min), jamais la retarder au-delà de la libération ; US-702b : il ne peut plus
    -- l'avancer AU-DELÀ de la règle (voir le contrôle du rail ci-dessous)
    v_v_h := (p_decision #>> '{vHours}')::integer;
    v_auth_at := GREATEST(v_now, v_t.scheduled_start - pg_catalog.make_interval(hours => v_lead_h));
    v_release_at := v_t.scheduled_end + pg_catalog.make_interval(hours => v_delay_h);
    v_expiry := v_auth_at + pg_catalog.make_interval(hours => v_v_h);
    -- US-702b (revues argent n° 8 et sécurité n° 8 d'US-702) : le rail se revérifie en base, comme
    -- au choix du rail (08 BR-PAY-06 « Mécanisme ») ; une validité qui ne le justifie pas ⇒ refus
    -- (fail-closed). Pré-autorisation unique ⇔ `H_requise ≤ V`, avec `H_requise = (début − auth_at)
    -- + (fin − début) + release_delay + marge` = `(release_at − auth_at) + marge` : la décision
    -- `min(release_at, auth_at + V − deposit_safety_h)` ne tombe donc jamais plus de
    -- `deposit_safety_h` avant la libération (T57 : fin + 70 h), quel que soit V reçu de l'API.
    -- Ré-autorisation ⇔ V > deposit_reauth_lead_h (sinon la ré-autorisation tomberait avant la pose).
    IF (v_mech = 'PREAUTH_SINGLE'
        AND v_expiry < v_release_at + pg_catalog.make_interval(hours => v_marge_h))
       OR (v_mech = 'REAUTH' AND v_v_h <= v_rlead_h) THEN
      RAISE EXCEPTION 'caution : validité de l''autorisation insuffisante pour ce rail'
        USING ERRCODE = 'check_violation', CONSTRAINT = 'deposit_decision_mismatch';
    END IF;
    IF v_mech = 'PREAUTH_SINGLE' THEN
      v_decision := LEAST(v_release_at, v_expiry - pg_catalog.make_interval(hours => v_safety_h));
      v_reauth_due := NULL;
    ELSIF v_mech = 'REAUTH' THEN
      v_decision := v_release_at;
      v_reauth_due := CASE
        WHEN v_release_at <= v_expiry - pg_catalog.make_interval(hours => v_safety_h) THEN NULL
        ELSE v_expiry - pg_catalog.make_interval(hours => v_rlead_h) END;
    ELSE
      v_decision := v_release_at;
      v_reauth_due := NULL;
    END IF;
  END IF;
  -- compte marchand de Kmino du pays : même choix que payment_deposit_checkout et T1 (0116)
  SELECT a.provider INTO v_provider
    FROM core.payment_psp_account AS a
   WHERE a.country_code = v_hold.country_code AND a.status = 'ACTIVE'
     AND (a.environment = 'LIVE'
          OR COALESCE(platform.deployment_env(), 'production') IN ('test', 'development', 'staging'))
   ORDER BY (a.environment = 'LIVE') DESC, a.provider, a.id
   LIMIT 1;
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
  VALUES (v_hold.id, v_hold.country_code, v_t.currency,
          v_provider,
          v_mech, v_triggers, p_decision -> 'paramsSnapshot', v_amount,
          (p_decision ->> 'hRequiredHours')::integer,
          CASE WHEN v_mech = 'NOT_REQUIRED' THEN (p_decision ->> 'vHours')::integer ELSE v_v_h END,
          v_auth_at, v_release_at, v_decision, v_reauth_due,
          CASE WHEN v_mech = 'NOT_REQUIRED' THEN NULL ELSE 'PLANNED' END);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_prev_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_prev_actor, ''), true);
  RETURN 'RECORDED';
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_record_deposit_decision(bytea, uuid, jsonb) IS
  'Décision de la caution du hold du checkout du voyageur de la session, figée une fois avant le '
  'paiement ; montant, pays, classe, rail (b) et rail par V revérifiés ; fournisseur et échéancier '
  'recalculés par la base. SECURITY DEFINER, EXECUTE app_api. US-701, US-702, US-702b (ADR-169, '
  'ADR-172).';

-- File des ré-autorisations échues, recopiée de 0146 ; seule la libération rendue change (US-702b).
CREATE OR REPLACE FUNCTION core.payment_deposit_reauth_due(p_limit integer)
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
         d.provider, d.auth_provider_reference, d.auth_expiry_at,
         -- US-702b : retour réel avant la fin prévue ⇒ libération plus tôt (08 BR-PAY-06) ; un
         -- retour tardif ne prolonge jamais l'autorisation (jamais au-delà de release_at)
         LEAST(d.release_at, e.release_at), d.reauth_seq, t.ts
    FROM core.payment_deposit_hold AS d
    CROSS JOIN t
    JOIN core.booking_checkout_hold AS h ON h.id = d.hold_id AND h.status = 'CONVERTED'
    CROSS JOIN LATERAL core.payment_deposit_effective_schedule(d.release_at, d.decision_at,
                                                               d.auth_expiry_at, d.country_code,
                                                               h.converted_trip_id) AS e
    JOIN core.booking_trip_segment AS s ON s.trip_id = h.converted_trip_id AND s.seq = 1
   WHERE app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
     AND d.mechanism = 'REAUTH' AND d.status = 'AUTHORIZED'
     AND d.reauth_due_at IS NOT NULL AND d.reauth_due_at <= t.ts
     AND d.provider IS NOT NULL AND d.auth_provider_reference IS NOT NULL
   ORDER BY d.reauth_due_at, d.id
   LIMIT GREATEST(LEAST(p_limit, 500), 0)
$fn$;
COMMENT ON FUNCTION core.payment_deposit_reauth_due(integer) IS
  'Cautions REAUTH autorisées dont la ré-autorisation est échue (platform.now()), libération '
  'effective (jamais au-delà de release_at), sans champ [C2]. SECURITY DEFINER, EXECUTE app_worker '
  '(payment_command). US-701, US-702b (ADR-169, ADR-172).';

-- File des décisions échues, recopiée de 0150 ; heure de décision EFFECTIVE (US-702b). Rien d'autre
-- n'est lu : une réclamation, une facture ou des frais d'assistance ne suspendent jamais la
-- libération (08 BR-PAY-06).
CREATE OR REPLACE FUNCTION core.payment_deposit_decision_due(p_limit integer)
  RETURNS TABLE (deposit_id         uuid,
                 trip_id            uuid,
                 segment_id         uuid,
                 tender_id          uuid,
                 country_code       text,
                 currency           text,
                 provider           text,
                 provider_reference text,
                 mechanism          text,
                 amount_minor       bigint,
                 decision_at        timestamptz,
                 auth_expiry_at     timestamptz,
                 reauth_seq         integer,
                 now                timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT d.id, h.converted_trip_id, s.id, h.conversion_operation_id, d.country_code, d.currency,
         d.provider, d.auth_provider_reference, d.mechanism, d.amount_minor, e.decision_at,
         d.auth_expiry_at, d.reauth_seq, t.ts
    FROM core.payment_deposit_hold AS d
    CROSS JOIN t
    JOIN core.booking_checkout_hold AS h ON h.id = d.hold_id AND h.status = 'CONVERTED'
    -- US-702b : heure de décision EFFECTIVE (retour réel, 08 BR-PAY-06)
    CROSS JOIN LATERAL core.payment_deposit_effective_schedule(d.release_at, d.decision_at,
                                                               d.auth_expiry_at, d.country_code,
                                                               h.converted_trip_id) AS e
    JOIN core.booking_trip_segment AS s ON s.trip_id = h.converted_trip_id AND s.seq = 1
   WHERE app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
     AND d.status = 'AUTHORIZED'
     AND (e.decision_at <= t.ts OR d.auth_expiry_at <= t.ts)
     AND d.provider IS NOT NULL AND d.auth_provider_reference IS NOT NULL
   ORDER BY e.decision_at, d.id
   LIMIT GREATEST(LEAST(p_limit, 500), 0)
$fn$;
COMMENT ON FUNCTION core.payment_deposit_decision_due(integer) IS
  'Cautions autorisées dont la décision effective est échue ou l''autorisation expirée '
  '(platform.now()), sans champ [C2]. SECURITY DEFINER, EXECUTE app_worker (payment_command). '
  'US-702, US-702b (ADR-172).';

-- Transition FINALE, recopiée de 0150 ; garde sur la décision EFFECTIVE et avis « bloqué jusqu'à
-- l'expiration » (US-702b).
CREATE OR REPLACE FUNCTION core.payment_cmd_deposit_decide(p_deposit_id uuid, p_expected_seq integer,
                                                p_status text, p_captured_minor bigint,
                                                p_released_minor bigint)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_d        record;
  v_h        record;
  v_now      timestamptz := platform.now();
  v_version  integer;
  v_decision timestamptz;
  v_notice   text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'caution : décision réservée au travailleur payment_command'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'deposit_hold_command_forbidden';
  END IF;
  SELECT d.id, d.hold_id, d.country_code, d.currency, d.mechanism, d.status, d.reauth_seq,
         d.decision_at, d.auth_expiry_at, d.release_at
    INTO v_d
    FROM core.payment_deposit_hold AS d WHERE d.id = p_deposit_id FOR UPDATE;
  IF v_d.id IS NULL OR v_d.reauth_seq IS DISTINCT FROM p_expected_seq
     OR v_d.status IS DISTINCT FROM 'AUTHORIZED' THEN
    RETURN 'STALE';
  END IF;
  SELECT h.converted_trip_id INTO v_h FROM core.booking_checkout_hold AS h WHERE h.id = v_d.hold_id;
  -- US-702b : heure de décision EFFECTIVE, la même que la file (retour réel, 08 BR-PAY-06)
  SELECT e.decision_at INTO v_decision
    FROM core.payment_deposit_effective_schedule(v_d.release_at, v_d.decision_at,
                                                 v_d.auth_expiry_at, v_d.country_code,
                                                 v_h.converted_trip_id) AS e;
  IF p_status IS NULL
     OR p_status NOT IN ('PARTIALLY_CAPTURED', 'VOIDED', 'REFUNDED', 'EXPIRED')
     -- 08 BR-PAY-06 : jamais avant l'heure de décision, sauf une autorisation déjà expirée
     OR NOT (COALESCE(v_decision <= v_now, false)
             OR (p_status = 'EXPIRED' AND COALESCE(v_d.auth_expiry_at <= v_now, false)))
     -- jamais de capture après l'expiration de l'autorisation
     OR (p_status = 'PARTIALLY_CAPTURED' AND COALESCE(v_d.auth_expiry_at <= v_now, false))
     -- remboursement ⇔ rail « débit puis remboursement » (seul rail sans autorisation à annuler)
     OR ((p_status = 'REFUNDED') <> (v_d.mechanism = 'CHARGE_THEN_REFUND')) THEN
    RAISE EXCEPTION 'caution : décision finale refusée'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'deposit_hold_guarded';
  END IF;
  -- montants contrôlés par deposit_hold_final_shape (Σ = montant, capture seulement si partielle)
  UPDATE core.payment_deposit_hold
     SET status = p_status, captured_minor = p_captured_minor, released_minor = p_released_minor,
         decision_executed_at = v_now, reauth_due_at = NULL
   WHERE id = p_deposit_id
  RETURNING row_version INTO v_version;
  -- US-702b (08 E3 repli 4) : une autorisation laissée expirer (VOID refusé ou non pris en charge,
  -- état EXPIRED avant l'expiration) n'est PAS libérée : l'avis dit le montant bloqué et la date
  -- d'expiration de l'autorisation, jamais « libérée »
  v_notice := CASE
    WHEN p_status = 'EXPIRED' AND COALESCE(v_d.auth_expiry_at > v_now, false)
      THEN 'BLOCKED_UNTIL_EXPIRY'
    WHEN p_status = 'PARTIALLY_CAPTURED' THEN 'PARTIALLY_CAPTURED'
    ELSE 'RELEASED' END;
  -- journal et avis au voyageur (NTF) : identifiants, état et montants seulement, jamais [C2]
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('deposit.decision.executed', 1, 'deposit_hold', p_deposit_id, v_version,
          v_d.country_code, NULL, 'SYSTEM', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object(
            'deposit_id', p_deposit_id, 'trip_id', v_h.converted_trip_id, 'status', p_status,
            'captured_minor', p_captured_minor::text, 'released_minor', p_released_minor::text,
            'currency', v_d.currency, 'decided_at', v_now, 'notice', v_notice,
            'auth_expiry_at', v_d.auth_expiry_at),
          COALESCE(v_h.converted_trip_id, p_deposit_id)::text);
  RETURN 'APPLIED';
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_deposit_decide(uuid, integer, text, bigint, bigint) IS
  'Transition finale de deposit_hold (PARTIALLY_CAPTURED, VOIDED, REFUNDED, EXPIRED) gardée par '
  'le rang, l''heure de décision effective et l''expiration ; événement deposit.decision.executed '
  '(notice, auth_expiry_at). SECURITY DEFINER, EXECUTE app_worker (payment_command). US-702, '
  'US-702b (ADR-172).';

-- les fonctions remplacées gardent leurs droits (0146, 0150) ; la nouvelle n'a aucun EXECUTE
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
