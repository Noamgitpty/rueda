-- 0150 — PAY : décision de la caution à l'heure de décision (libération automatique, transitions
-- finales) et échéancier recalculé par la base.
-- US-702 ; 19 US-702 (critères 1 et 2 : T58 « VOID 300,00 puis MIT 12,00 » ; « fin + 72 h ⇒ VOID
-- automatique, journalisé, notifié au voyageur ; une réclamation de dommage ne la suspend jamais ») ;
-- 16 PAY-011 / PAY-012 (« États », « Notifications ») ; 08 BR-PAY-06 (« Libération à heure fixe,
-- jamais suspendue », T57, T58) ; 17 v6 §3.2.7 (`deposit_hold`), §4.5 (`deposit.decision.executed`),
-- §0.1 ; ADR-169 (0146), ADR-172 (cette migration). Appliquée sous `migrator`.
--
-- Cette migration :
--   1. `core.payment_deposit_hold` : colonnes AJOUTÉES `captured_minor`, `released_minor`
--      (unités mineures, Σ = montant de la caution) et `decision_executed_at` (heure de la base),
--      posées UNE fois par la transition finale ; un état final ⇔ ces trois colonnes ; aucune
--      capture dans `VOIDED`, `EXPIRED`, `REFUNDED` ; une capture > 0 dans `PARTIALLY_CAPTURED`.
--      La garde de 0146 (état final figé, décision et identité figées) est inchangée ;
--   2. `core.payment_cmd_record_deposit_decision` (CREATE OR REPLACE depuis 0146) : `provider`,
--      `auth_at`, `release_at`, `decision_at` et `reauth_due_at` RECALCULÉS par la base au lieu d'être
--      écrits tels que reçus de l'API (revues argent et sécurité d'US-701) : compte marchand du pays
--      (même choix que `payment_deposit_checkout` et T1), `auth_at = max(platform.now(), début −
--      auth_lead_h)`, `release_at = fin du devis engagé + release_delay_h`, `decision_at` et
--      `reauth_due_at` selon 08 BR-PAY-06 (ADR-169 point 5) ; paramètre de durée absent ou illisible ⇒
--      refus (fail-closed). Le reste de la commande est recopié de 0146 sans changement ;
--   3. `core.payment_deposit_decision_due(lot)` (app_worker, `payment_command`) : cautions AUTORISÉES
--      dont la décision est échue (`decision_at ≤ platform.now()`) ou dont l'autorisation a expiré,
--      hold converti en trip ; aucune lecture d'une réclamation, d'une facture ni d'un frais
--      d'assistance : rien ne suspend la libération (08 BR-PAY-06) ;
--   4. `core.payment_cmd_deposit_decide(…)` (app_worker, `payment_command`) : transition FINALE gardée
--      (rang attendu ; jamais avant `decision_at` sauf expiration ; jamais de capture après
--      `auth_expiry_at` ; `REFUNDED` ⇔ rail « débit puis remboursement ») et événement
--      `deposit.decision.executed` (17 §4.5) dans la même transaction (journal et avis au voyageur,
--      NTF), sans aucune donnée [C2].
--
-- Erreurs (SQLSTATE, contrainte) traduites par packages/db/src/errors.ts, sans DETAIL :
--   deposit_decision_mismatch (23514) → INVARIANT_VIOLATION ; deposit_hold_guarded (55000) →
--   INVARIANT_VIOLATION ; deposit_hold_command_forbidden (42501) → FORBIDDEN ;
--   deposit_hold_final_shape (23514) → INVARIANT_VIOLATION (contrainte de table).
-- Issues rendues (texte) : APPLIED, STALE (et celles de 0146 pour l'écriture de la décision).
--
-- Expand / contract : trois colonnes NULL, une contrainte, un index, deux fonctions, une politique
-- AJOUTÉS ; une fonction REMPLACÉE (même signature, mêmes droits) ; la politique de lecture de la
-- configuration de cmd_hold_owner ÉLARGIE à quatre durées de 08 BR-PAY-06. Rien de retiré.
--
-- Retour arrière :
--   DROP FUNCTION core.payment_deposit_decision_due(integer),
--     core.payment_cmd_deposit_decide(uuid, integer, text, bigint, bigint);
--   DROP POLICY cmd_hold_deposit_event_ins ON core.outbox_outbox_event;
--   ALTER POLICY cmd_hold_deposit_read ON core.config_param_value USING (key IN
--     ('deposit_always_required', 'deposit_trigger_classes', 'deposit_amount', 'funds_holding_enabled'));
--   ALTER TABLE core.payment_deposit_hold DROP CONSTRAINT deposit_hold_final_shape,
--     DROP COLUMN captured_minor, DROP COLUMN released_minor, DROP COLUMN decision_executed_at;
--   DROP INDEX core.deposit_hold_decision_due_idx;
--   puis recréer core.payment_cmd_record_deposit_decision depuis 0146.

-- 1. Colonnes de la décision exécutée --------------------------------------------------------------
ALTER TABLE core.payment_deposit_hold
  ADD COLUMN captured_minor       bigint,
  ADD COLUMN released_minor       bigint,
  ADD COLUMN decision_executed_at timestamptz,
  -- 16 PAY-011 « États » : un état final porte la décision exécutée, et seulement lui ; Σ = montant
  ADD CONSTRAINT deposit_hold_final_shape CHECK (
    COALESCE(status IN ('PARTIALLY_CAPTURED', 'VOIDED', 'REFUNDED', 'EXPIRED'), false)
      = (decision_executed_at IS NOT NULL)
    AND (decision_executed_at IS NULL) = (captured_minor IS NULL)
    AND (decision_executed_at IS NULL) = (released_minor IS NULL)
    AND (decision_executed_at IS NULL
         OR (captured_minor >= 0 AND released_minor >= 0
             AND captured_minor + released_minor = amount_minor
             AND (status = 'PARTIALLY_CAPTURED') = (captured_minor > 0))));
CREATE INDEX deposit_hold_decision_due_idx ON core.payment_deposit_hold (decision_at)
  WHERE status = 'AUTHORIZED';
COMMENT ON COLUMN core.payment_deposit_hold.captured_minor IS
  'Frais annexes capturés sur la caution à la décision (unités mineures) ; NULL avant. US-702.';
COMMENT ON COLUMN core.payment_deposit_hold.released_minor IS
  'Part libérée (VOID, expiration) ou remboursée (rail b) à la décision ; NULL avant. US-702.';

-- transition finale (travailleur payment_command, politique cmd_hold_upd de 0146)
GRANT UPDATE (captured_minor, released_minor, decision_executed_at)
  ON core.payment_deposit_hold TO cmd_hold_owner;

-- 2. Droits complémentaires de cmd_hold_owner ------------------------------------------------------
-- durées de 08 BR-PAY-06 relues par l'écriture de la décision (échéancier recalculé en base)
ALTER POLICY cmd_hold_deposit_read ON core.config_param_value
  USING (key IN ('deposit_always_required', 'deposit_trigger_classes', 'deposit_amount',
                 'funds_holding_enabled', 'auth_lead_h', 'release_delay_h', 'deposit_safety_h',
                 'deposit_reauth_lead_h'));
-- événement de la décision exécutée (17 §4.5), acteur SYSTEM, travailleur payment_command
CREATE POLICY cmd_hold_deposit_event_ins ON core.outbox_outbox_event FOR INSERT TO cmd_hold_owner
  WITH CHECK (aggregate_type = 'deposit_hold' AND type = 'deposit.decision.executed'
              AND actor_role = 'SYSTEM' AND actor_user_id IS NULL
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

-- 3. Fonctions (cmd_hold_owner, liste blanche RLS-15) -------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- Écriture unique de la décision (avant T1), recopiée de 0146 ; seul l'échéancier change : il est
-- RECALCULÉ ici (les champs `provider`, `authAt`, `releaseAt`, `decisionAt`, `reauthDueAt` de l'API
-- sont ignorés : une API compromise ne peut ni choisir le connecteur ni raccourcir la libération).
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
    -- V (validité du PSP, US-225) : instantané de la décision, borné ; il ne fait qu'AVANCER la
    -- décision (min), jamais la retarder au-delà de la libération
    v_v_h := (p_decision #>> '{vHours}')::integer;
    v_auth_at := GREATEST(v_now, v_t.scheduled_start - pg_catalog.make_interval(hours => v_lead_h));
    v_release_at := v_t.scheduled_end + pg_catalog.make_interval(hours => v_delay_h);
    v_expiry := v_auth_at + pg_catalog.make_interval(hours => v_v_h);
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
  'paiement ; montant, pays, classe et rail (b) revérifiés ; fournisseur et échéancier recalculés '
  'par la base (US-702). SECURITY DEFINER, EXECUTE app_api. US-701, US-702 (ADR-169, ADR-172).';

-- File des décisions échues (travailleur payment_command) : caution AUTORISÉE, hold converti en
-- trip ; décision échue à l'heure de la base, ou autorisation expirée (jamais de capture ensuite).
-- Rien d'autre n'est lu : une réclamation, une facture ou des frais d'assistance ne suspendent
-- jamais la libération (08 BR-PAY-06). Clé 08 E4 : trip, segment n° 1, opération de loyer.
CREATE FUNCTION core.payment_deposit_decision_due(p_limit integer)
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
         d.provider, d.auth_provider_reference, d.mechanism, d.amount_minor, d.decision_at,
         d.auth_expiry_at, d.reauth_seq, t.ts
    FROM core.payment_deposit_hold AS d
    CROSS JOIN t
    JOIN core.booking_checkout_hold AS h ON h.id = d.hold_id AND h.status = 'CONVERTED'
    JOIN core.booking_trip_segment AS s ON s.trip_id = h.converted_trip_id AND s.seq = 1
   WHERE app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
     AND d.status = 'AUTHORIZED'
     AND (d.decision_at <= t.ts OR d.auth_expiry_at <= t.ts)
     AND d.provider IS NOT NULL AND d.auth_provider_reference IS NOT NULL
   ORDER BY d.decision_at, d.id
   LIMIT GREATEST(LEAST(p_limit, 500), 0)
$fn$;
COMMENT ON FUNCTION core.payment_deposit_decision_due(integer) IS
  'Cautions autorisées dont la décision est échue ou l''autorisation expirée (platform.now()), sans '
  'champ [C2]. SECURITY DEFINER, EXECUTE app_worker (payment_command). US-702 (ADR-172).';

-- Transition FINALE de la décision (16 PAY-011 « États ») et événement deposit.decision.executed
-- dans la même transaction ; rang attendu : un passage concurrent ou un rejeu tardif rend STALE
-- sans rien écrire.
CREATE FUNCTION core.payment_cmd_deposit_decide(p_deposit_id uuid, p_expected_seq integer,
                                                p_status text, p_captured_minor bigint,
                                                p_released_minor bigint)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_d       record;
  v_h       record;
  v_now     timestamptz := platform.now();
  v_version integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'caution : décision réservée au travailleur payment_command'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'deposit_hold_command_forbidden';
  END IF;
  SELECT d.id, d.hold_id, d.country_code, d.currency, d.mechanism, d.status, d.reauth_seq,
         d.decision_at, d.auth_expiry_at
    INTO v_d
    FROM core.payment_deposit_hold AS d WHERE d.id = p_deposit_id FOR UPDATE;
  IF v_d.id IS NULL OR v_d.reauth_seq IS DISTINCT FROM p_expected_seq
     OR v_d.status IS DISTINCT FROM 'AUTHORIZED' THEN
    RETURN 'STALE';
  END IF;
  IF p_status IS NULL
     OR p_status NOT IN ('PARTIALLY_CAPTURED', 'VOIDED', 'REFUNDED', 'EXPIRED')
     -- 08 BR-PAY-06 : jamais avant l'heure de décision, sauf une autorisation déjà expirée
     OR NOT (v_d.decision_at <= v_now
             OR (p_status = 'EXPIRED' AND COALESCE(v_d.auth_expiry_at <= v_now, false)))
     -- jamais de capture après l'expiration de l'autorisation
     OR (p_status = 'PARTIALLY_CAPTURED' AND COALESCE(v_d.auth_expiry_at <= v_now, false))
     -- remboursement ⇔ rail « débit puis remboursement » (seul rail sans autorisation à annuler)
     OR ((p_status = 'REFUNDED') <> (v_d.mechanism = 'CHARGE_THEN_REFUND')) THEN
    RAISE EXCEPTION 'caution : décision finale refusée'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'deposit_hold_guarded';
  END IF;
  SELECT h.converted_trip_id INTO v_h FROM core.booking_checkout_hold AS h WHERE h.id = v_d.hold_id;
  -- montants contrôlés par deposit_hold_final_shape (Σ = montant, capture seulement si partielle)
  UPDATE core.payment_deposit_hold
     SET status = p_status, captured_minor = p_captured_minor, released_minor = p_released_minor,
         decision_executed_at = v_now, reauth_due_at = NULL
   WHERE id = p_deposit_id
  RETURNING row_version INTO v_version;
  -- journal et avis au voyageur (NTF) : identifiants, état et montants seulement, jamais [C2]
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('deposit.decision.executed', 1, 'deposit_hold', p_deposit_id, v_version,
          v_d.country_code, NULL, 'SYSTEM', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object(
            'deposit_id', p_deposit_id, 'trip_id', v_h.converted_trip_id, 'status', p_status,
            'captured_minor', p_captured_minor::text, 'released_minor', p_released_minor::text,
            'currency', v_d.currency, 'decided_at', v_now),
          COALESCE(v_h.converted_trip_id, p_deposit_id)::text);
  RETURN 'APPLIED';
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_deposit_decide(uuid, integer, text, bigint, bigint) IS
  'Transition finale de deposit_hold (PARTIALLY_CAPTURED, VOIDED, REFUNDED, EXPIRED) gardée par '
  'le rang, l''heure de décision et l''expiration ; événement deposit.decision.executed. SECURITY '
  'DEFINER, EXECUTE app_worker (payment_command). US-702 (ADR-172).';

-- droits posés par le propriétaire (un REVOKE de migrator, non propriétaire, serait sans effet) ;
-- la fonction remplacée garde ses droits de 0146 (EXECUTE app_api)
REVOKE ALL ON FUNCTION core.payment_deposit_decision_due(integer),
  core.payment_cmd_deposit_decide(uuid, integer, text, bigint, bigint)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_deposit_decision_due(integer),
  core.payment_cmd_deposit_decide(uuid, integer, text, bigint, bigint)
  TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
