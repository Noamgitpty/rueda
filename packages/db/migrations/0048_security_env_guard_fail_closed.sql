-- 0048 — Gardes d'environnement fail-closed sur NULL (C19) : PAY.
-- US-043 ; 17 §6.5 point 1 (environnement de la base), §6.6 (exigences de sécurité), §2.8 (C19) ;
-- report de la revue sécurité d'US-024 via US-025 (passation US-025, « Reste » 3, visé à US-003,
-- repris par US-043) ; ADR-077. Appliquée sous `migrator`.
--
-- Défaut corrigé : `platform.deployment_env() = 'production'` vaut NULL (et non TRUE) quand
-- l'environnement de la base est NULL ; un `IF NULL` ne lève pas, un `NOT (… AND NULL)` ne filtre
-- pas toujours. Une garde « jamais un FAKE en production » s'ouvrait alors (fail-open). Chaque
-- garde lit désormais `COALESCE(platform.deployment_env(), 'production')` : un environnement
-- inconnu vaut « production » (fail-closed), comme T1 depuis 0045.
--
-- Fonctions remplacées (corps inchangé par ailleurs, même signature, même propriétaire, mêmes droits,
-- entrées RLS-15 inchangées) :
--   1. core.payment_psp_account_fake_guard()        trigger, propriétaire migrator (0028) ;
--   2. core.payment_cmd_record_operation(…)          cmd_money_owner (0028) ;
--   3. core.payment_resolve_webhook_account(…)       cmd_money_owner (0028 ; déjà fermée sur NULL
--      par `NOT (… AND NULL)` dans un WHERE, réécrite pour une règle unique et vérifiable) ;
--   4. core.payment_cmd_receive_webhook(…)           cmd_money_owner (0028) ;
--   5. core.payment_startup_guard()                  cmd_money_owner (0028 ; rendait NULL, que
--      l'API lisait comme « pas production » : démarrage admis avec des comptes FAKE) ;
--   6. core.payment_cmd_register_submerchant(…)      cmd_money_owner (0039).
-- core.booking_cmd_start_payment (T1) l'est déjà (0045). Contrôles qui empêchent une nouvelle garde
-- ouverte : lint `pnpm lint:sql` (packages/config/sql-env-guard, toute lecture de
-- platform.deployment_env() hors COALESCE(…, 'production') dans une migration est refusée, sauf les
-- lectures historiques remplacées ici, listées dans packages/db/env-guard-allowlist.json) et test L0
-- `l0-us043-env-guard.test.ts` (pg_proc de la base de production : aucune fonction ne lit
-- l'environnement hors COALESCE ; NULL ⇒ refus pour chacune des six fonctions, en PA et en PY).
--
-- Retour arrière : réappliquer les définitions de 0028 (fonctions 1 à 5) et de 0039 (fonction 6),
-- les cinq commandes sous cmd_money_owner comme ci-dessous.

-- 1. Trigger de garde FAKE (propriétaire migrator, SECURITY INVOKER) ----------------------------
CREATE OR REPLACE FUNCTION core.payment_psp_account_fake_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.provider = 'FAKE' AND COALESCE(platform.deployment_env(), 'production') = 'production' THEN
    RAISE EXCEPTION 'psp_account: FAKE provider forbidden in production (C19)'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'psp_account_fake_forbidden';
  END IF;
  RETURN NEW;
END
$fn$;

-- 2 à 6. Commandes de cmd_money_owner -------------------------------------------------------------
-- `migrator` ne remplace une fonction d'un autre propriétaire qu'en devenant lui (ADR-044 amendé) ;
-- CREATE sur le schéma accordé le temps du remplacement (comme 0045). Propriétaire, EXECUTE et
-- entrées RLS-15 inchangés (CREATE OR REPLACE conserve les droits).
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

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
          amount_minor, currency, attempt_no, status, idem_plain, idem_sent)
  VALUES (p_id, p_hold_id, p_trip_id, p_psp_account_id, v_country, v_provider, p_method, p_kind,
          p_purpose, p_amount_minor, p_currency, p_attempt_no, 'PENDING', p_idem_plain, p_idem_sent)
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
       OR v_same_legs IS NOT TRUE THEN
      RAISE EXCEPTION 'payment: same idempotency key, different content'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_idempotency_conflict';
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
  operation_id := v_inserted;
  replayed := false;
  RETURN NEXT;
END
$fn$;

CREATE OR REPLACE FUNCTION core.payment_resolve_webhook_account(p_provider text, p_public_webhook_id text)
  RETURNS TABLE (account_id uuid, webhook_secret_ref text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.id, a.webhook_secret_ref
    FROM core.payment_psp_account AS a
   WHERE a.provider = p_provider
     AND a.public_webhook_id = p_public_webhook_id
     AND NOT (a.provider = 'FAKE' AND COALESCE(platform.deployment_env(), 'production') = 'production')
$fn$;

CREATE OR REPLACE FUNCTION core.payment_cmd_receive_webhook(
  p_account_id        uuid,
  p_provider_event_id text,
  p_dedup_key         bytea,
  p_signature_valid   boolean,
  p_signed_at         timestamptz,
  p_headers           jsonb,
  p_normalized        jsonb
)
  RETURNS TABLE (outcome text, inbox_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_provider text;
  v_now      timestamptz := platform.now();
  v_status   text;
  v_id       uuid := gen_random_uuid();
  v_inserted uuid;
BEGIN
  SELECT a.provider INTO v_provider FROM core.payment_psp_account AS a WHERE a.id = p_account_id;
  IF NOT FOUND OR (v_provider = 'FAKE' AND COALESCE(platform.deployment_env(), 'production') = 'production') THEN
    outcome := 'NOT_FOUND';
    inbox_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;
  IF p_dedup_key IS NULL OR length(p_dedup_key) NOT BETWEEN 16 AND 64 THEN
    RAISE EXCEPTION 'payment: invalid dedup key' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_status := CASE
                WHEN p_signature_valid IS NOT TRUE THEN 'REJECTED_SIGNATURE'
                WHEN p_signed_at IS NOT NULL
                     AND (p_signed_at < v_now - interval '5 minutes'
                          OR p_signed_at > v_now + interval '5 minutes') THEN 'QUARANTINED'
                ELSE 'RECEIVED'
              END;
  INSERT INTO core.payment_webhook_inbox AS w
         (id, provider, psp_account_id, provider_event_id, dedup_key, signature_valid, headers,
          processing_status, error, normalized_events)
  VALUES (v_id, v_provider, p_account_id, p_provider_event_id, p_dedup_key,
          p_signature_valid IS TRUE, p_headers, v_status,
          CASE v_status WHEN 'QUARANTINED' THEN 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE' END,
          CASE WHEN v_status = 'REJECTED_SIGNATURE' THEN NULL ELSE p_normalized END)
  ON CONFLICT ON CONSTRAINT webhook_inbox_dedup DO NOTHING
  RETURNING w.id INTO v_inserted;
  IF v_inserted IS NULL THEN
    outcome := 'DUPLICATE';
    inbox_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_status <> 'REJECTED_SIGNATURE' THEN
    UPDATE core.payment_psp_account AS a SET last_webhook_at = v_now WHERE a.id = p_account_id;
  END IF;
  outcome := v_status;
  inbox_id := v_inserted;
  RETURN NEXT;
END
$fn$;

CREATE OR REPLACE FUNCTION core.payment_startup_guard()
  RETURNS TABLE (deployment_env text, fake_accounts integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(platform.deployment_env(), 'production'),
         (SELECT count(*)::integer FROM core.payment_psp_account AS a WHERE a.provider = 'FAKE')
$fn$;

CREATE OR REPLACE FUNCTION core.payment_cmd_register_submerchant(
  p_id             uuid,
  p_org_id         uuid,
  p_psp_account_id uuid,
  p_attempt_no     integer
)
  RETURNS TABLE (submerchant_id uuid, idem_plain text, replayed boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_provider    text;
  v_country     text;
  v_status      text;
  v_mode        text;
  v_org_country text;
  v_org_status  text;
  v_currency    text;
  v_missing     text[];
  v_idem        text;
  v_existing    core.payment_psp_submerchant%ROWTYPE;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: register_submerchant reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_id IS NULL OR p_org_id IS NULL OR p_attempt_no IS NULL OR p_attempt_no < 1 THEN
    RAISE EXCEPTION 'payment: invalid submerchant request' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- compte marchand de Kmino ACTIVE, jamais un FAKE en production (17 §4.3 point 5.7, C19)
  SELECT a.provider, a.country_code, a.status, a.collection_mode
    INTO v_provider, v_country, v_status, v_mode
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

  -- hôte du même pays que le compte, ni suspendu ni sorti
  SELECT o.country_code, o.status INTO v_org_country, v_org_status
    FROM core.iam_organization AS o WHERE o.id = p_org_id;
  IF NOT FOUND OR v_org_country <> v_country THEN
    RAISE EXCEPTION 'payment: host and PSP account country mismatch'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'psp_submerchant_org_mismatch';
  END IF;
  IF v_org_status IN ('SUSPENDED', 'OFFBOARDED') THEN
    RAISE EXCEPTION 'payment: host % cannot be registered', v_org_status
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'psp_submerchant_org_inactive';
  END IF;

  -- règle d'activation (17 §2.8) : toutes les capacités bloquantes validées pour la variante
  v_missing := core.payment_missing_blocking_capabilities(v_provider, v_country, v_mode);
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'payment: host payout rail unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'host_payout_rail_unavailable',
            DETAIL = array_to_string(v_missing, ', ');
  END IF;

  v_idem := format('submerchant:%s:a%s', p_org_id, p_attempt_no);
  SELECT * INTO v_existing FROM core.payment_psp_submerchant AS s WHERE s.idem_plain = v_idem;
  IF FOUND THEN
    IF v_existing.psp_account_id IS DISTINCT FROM p_psp_account_id THEN
      RAISE EXCEPTION 'payment: same idempotency key, different content'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_idempotency_conflict';
    END IF;
    submerchant_id := v_existing.id;
    idem_plain := v_idem;
    replayed := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- tentative n > 1 : seulement après le refus (REJECTED) de toutes les précédentes, à la suite
  IF p_attempt_no > 1 AND NOT EXISTS (
       SELECT 1 FROM core.payment_psp_submerchant AS s
        WHERE s.psp_account_id = p_psp_account_id AND s.org_id = p_org_id
          AND s.attempt_no = p_attempt_no - 1) THEN
    RAISE EXCEPTION 'payment: submerchant attempt % out of sequence', p_attempt_no
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'psp_submerchant_attempt_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS s
              WHERE s.psp_account_id = p_psp_account_id AND s.org_id = p_org_id
                AND s.kyc_status <> 'REJECTED') THEN
    RAISE EXCEPTION 'payment: a live submerchant already exists for this host'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'psp_submerchant_attempt_invalid';
  END IF;

  -- devise de versement : celle du pays (configuration, 08 E7 règle 9 : aucune conversion)
  SELECT c.currency INTO v_currency FROM core.config_country AS c WHERE c.code = v_country;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'payment: country % not configured', v_country
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'psp_submerchant_country_unconfigured';
  END IF;

  INSERT INTO core.payment_psp_submerchant
         (id, psp_account_id, org_id, country_code, attempt_no, idem_plain, payout_currency)
  VALUES (p_id, p_psp_account_id, p_org_id, v_country, p_attempt_no, v_idem, v_currency);
  submerchant_id := p_id;
  idem_plain := v_idem;
  replayed := false;
  RETURN NEXT;
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
