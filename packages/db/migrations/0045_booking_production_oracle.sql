-- 0045 — AVL : oracle de production C12 (lecture seule, alerte P1) et garde d'environnement de T1
-- fail-closed sur NULL.
-- US-025 ; 19 US-025 ; 17 §2.5 (plan de test C11, C12), §11 L0-09, §2.3 (« app_worker, une politique
-- explicite par travailleur »), §6.3 (alertes), §6.5 point 1 (environnement de la base) ; ADR-035,
-- ADR-053, ADR-056, ADR-065 ; ADR-068. Appliquée sous `migrator`.
--
-- Cette migration :
--   1. core.booking_production_oracle() : les CINQ contrôles de l'oracle C12 (17 §2.5), comptés sur
--      toute la base, par contrôle et par pays. SECURITY INVOKER, STABLE (aucune écriture : elle
--      tourne dans une transaction READ ONLY), exécutable par le seul travailleur `booking_oracle`
--      (contexte vérifié dans le corps : un contexte erroné lève 42501 au lieu de rendre des zéros
--      trompeurs, la RLS masquant tout). Elle ne lit AUCUNE donnée personnelle : identifiants,
--      statuts, horodatages et pays seulement ; elle ne rend que des comptes ;
--   2. core.booking_production_oracle_alert() : rejoue l'oracle (jamais des comptes fournis par
--      l'appelant) et, si un contrôle est non nul, écrit UNE alerte P1
--      `booking.alert.production_oracle` dans l'outbox (comptes seulement, aucun identifiant). C'est
--      sa seule écriture ;
--   3. lectures du travailleur `booking_oracle` : ajouté aux politiques SELECT existantes des six
--      tables lues (hold, occupation, trip, disposition, opération, événement d'opération), par
--      ALTER POLICY. Aucun droit nouveau sur une table (app_worker a déjà SELECT : 0007, 0028) ;
--   4. T1 core.booking_cmd_start_payment remplacée (report de la revue sécurité d'US-024) :
--      l'environnement de la base est lu une fois et `COALESCE(platform.deployment_env(),
--      'production')` ; avec `NOT IN` et `= 'production'`, un NULL ouvrait les deux gardes (FAKE en
--      production, compte SANDBOX hors environnement de test). Corps inchangé par ailleurs.
--
-- Contrôles de C12 (17 §2.5), codes PROPOSÉS (ADR-068) :
--   TRIP_WITHOUT_ACTIVE_OCCUPANCY        trip non terminal sans occupation TRIP active de son
--                                        véhicule (I-OCC) ;
--   SUCCEEDED_WITHOUT_DISPOSITION        opération de loyer SUCCEEDED sans payment_disposition plus
--                                        de 20 min après l'instant où sa réussite est connue (premier
--                                        payment_operation_event SUCCEEDED appliqué, à défaut
--                                        updated_at : même définition que disposition_sweeper) ;
--   COMPENSATED_HOLD_WITH_TRIP           hold COMPENSATED qui a un trip (converted_trip_id, trip
--                                        source ou disposition CONVERSION) ;
--   HOLD_WITH_TWO_CONVERSIONS            hold avec deux dispositions CONVERSION ou plus ;
--   INACTIVE_TRIP_OCCUPANCY_OF_LIVE_TRIP occupation TRIP inactive d'un trip non terminal.
-- États non terminaux d'un trip : ceux d'I-OCC (0006 ; SM-1 de 08, PROPOSÉ) : BOOKED, CHECKIN_OPEN,
-- START_WINDOW_EXPIRED, IN_PROGRESS, OVERDUE, UNRETURNED. La borne de 20 min est celle de 17 §2.5
-- (C11 (iii), C12), commune aux deux pays : ce n'est pas une constante de pays.
--
-- Erreurs : oracle_forbidden (42501) → FORBIDDEN (packages/db/src/errors.ts).
--
-- Retour arrière :
--   DROP FUNCTION core.booking_production_oracle_alert(), core.booking_production_oracle();
--   ALTER POLICY des six politiques vers leurs listes de 0007, 0028 et 0041 (sans booking_oracle) ;
--   réappliquer la définition de 0040 de core.booking_cmd_start_payment(uuid, uuid, text) (sous
--   cmd_hold_owner, comme ci-dessous).

-- 1. Lectures du travailleur booking_oracle (SELECT seulement) ----------------------------------
-- Ajouté à la liste des travailleurs des politiques SELECT EXISTANTES (ALTER POLICY), plutôt que par
-- de nouvelles politiques permissives : une politique de plus est un OR de plus, évalué ligne à ligne
-- par les balayages qui parcourent toute la table (mesuré en CI : preuves US-024 1,7 fois plus
-- lentes avec six politiques ajoutées, ADR-068). Aucun droit de table nouveau.
ALTER POLICY worker_select ON core.booking_checkout_hold
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'hold_expiry',
          'booking_oracle'));
ALTER POLICY worker_select ON core.booking_vehicle_occupancy
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'hold_expiry',
          'trip_lifecycle', 'booking_oracle'));
ALTER POLICY worker_select ON core.booking_trip
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'trip_lifecycle',
          'booking_oracle'));
ALTER POLICY worker_select ON core.booking_payment_disposition
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'hold_expiry',
          'booking_oracle'));
ALTER POLICY worker_select ON core.payment_payment_operation
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'hold_expiry',
          'webhook_ingest', 'booking_oracle'));
ALTER POLICY worker_select_disposition ON core.payment_payment_operation_event
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('disposition_sweeper', 'booking_oracle'));

-- 2. Oracle C12 (17 §2.5) : lecture seule, comptes par contrôle et par pays ----------------------
-- Cinq lignes, toujours, dans l'ordre de 17 : (code, violations, {pays: violations}).
CREATE FUNCTION core.booking_production_oracle()
  RETURNS TABLE (check_code text, violations bigint, by_country jsonb)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'booking_oracle' THEN
    RAISE EXCEPTION 'oracle: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'oracle_forbidden';
  END IF;
  v_now := platform.now();
  RETURN QUERY
    WITH live_trip AS (
      SELECT t.id, t.vehicle_id, t.country_code
        FROM core.booking_trip t
       WHERE t.status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS',
                          'OVERDUE', 'UNRETURNED')
    ),
    found AS (
      SELECT 'TRIP_WITHOUT_ACTIVE_OCCUPANCY'::text AS code, lt.country_code AS cc
        FROM live_trip lt
       WHERE NOT EXISTS (SELECT 1 FROM core.booking_vehicle_occupancy o
                          WHERE o.kind = 'TRIP' AND o.active AND o.ref_type = 'TRIP'
                            AND o.ref_id = lt.id AND o.vehicle_id = lt.vehicle_id)
      UNION ALL
      SELECT 'SUCCEEDED_WITHOUT_DISPOSITION', o.country_code
        FROM core.payment_payment_operation o
       WHERE o.purpose = 'RENT' AND o.kind IN ('AUTH', 'CAPTURE') AND o.status = 'SUCCEEDED'
         AND o.hold_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                          WHERE d.operation_id = o.id)
         AND COALESCE((SELECT pg_catalog.min(e.at) FROM core.payment_payment_operation_event e
                        WHERE e.operation_id = o.id AND e.status = 'SUCCEEDED'
                          AND e.outcome = 'APPLIED'),
                      o.updated_at) <= v_now - pg_catalog.make_interval(mins => 20)
      UNION ALL
      SELECT 'COMPENSATED_HOLD_WITH_TRIP', h.country_code
        FROM core.booking_checkout_hold h
       WHERE h.status = 'COMPENSATED'
         AND (h.converted_trip_id IS NOT NULL
              OR EXISTS (SELECT 1 FROM core.booking_trip t WHERE t.source_hold_id = h.id)
              OR EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                          WHERE d.hold_id = h.id AND d.disposition = 'CONVERSION'))
      UNION ALL
      SELECT 'HOLD_WITH_TWO_CONVERSIONS', h.country_code
        FROM core.booking_checkout_hold h
       WHERE (SELECT pg_catalog.count(*) FROM core.booking_payment_disposition d
               WHERE d.hold_id = h.id AND d.disposition = 'CONVERSION') > 1
      UNION ALL
      SELECT 'INACTIVE_TRIP_OCCUPANCY_OF_LIVE_TRIP', lt.country_code
        FROM live_trip lt
       WHERE EXISTS (SELECT 1 FROM core.booking_vehicle_occupancy o
                      WHERE o.kind = 'TRIP' AND NOT o.active AND o.ref_id = lt.id)
    ),
    per_country AS (
      SELECT f.code, f.cc, pg_catalog.count(*) AS n FROM found f GROUP BY f.code, f.cc
    )
    SELECT c.code,
           COALESCE(pg_catalog.sum(p.n), 0)::bigint,
           COALESCE(pg_catalog.jsonb_object_agg(p.cc, p.n) FILTER (WHERE p.cc IS NOT NULL),
                    '{}'::jsonb)
      FROM (VALUES (1, 'TRIP_WITHOUT_ACTIVE_OCCUPANCY'),
                   (2, 'SUCCEEDED_WITHOUT_DISPOSITION'),
                   (3, 'COMPENSATED_HOLD_WITH_TRIP'),
                   (4, 'HOLD_WITH_TWO_CONVERSIONS'),
                   (5, 'INACTIVE_TRIP_OCCUPANCY_OF_LIVE_TRIP')) AS c(ord, code)
      LEFT JOIN per_country p ON p.code = c.code
     GROUP BY c.ord, c.code
     ORDER BY c.ord;
END
$fn$;

-- 3. Alerte de l'oracle (17 §6.3) : une alerte P1 dans l'outbox si un contrôle est non nul -------
-- Comptes seulement (aucun identifiant de trip, de hold ni de personne). Rejoue l'oracle dans la
-- même transaction : l'appelant ne fournit aucun chiffre.
CREATE FUNCTION core.booking_production_oracle_alert()
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_checks     jsonb;
  v_countries  jsonb;
  v_total      bigint;
  v_event      uuid;
BEGIN
  SELECT pg_catalog.jsonb_object_agg(r.check_code, r.violations),
         pg_catalog.jsonb_object_agg(r.check_code, r.by_country),
         pg_catalog.sum(r.violations)::bigint
    INTO v_checks, v_countries, v_total
    FROM core.booking_production_oracle() AS r;
  IF v_total > 0 THEN
    v_event := pg_catalog.gen_random_uuid();
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_role, correlation_id, payload, partition_key)
    VALUES ('booking.alert.production_oracle', 1, 'production_oracle', v_event, 0, NULL, 'SYSTEM',
            pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('severity', 'P1', 'checks', v_checks,
                                          'by_country', v_countries, 'violations', v_total,
                                          'checked_at', platform.now()),
            'production_oracle');
  END IF;
  RETURN pg_catalog.jsonb_build_object('violations', v_total, 'checks', v_checks,
                                       'alerted', v_total > 0, 'alert_id', v_event);
END
$fn$;

COMMENT ON FUNCTION core.booking_production_oracle() IS
  'Oracle C12 (17 §2.5) : cinq contrôles comptés par pays, lecture seule, travailleur '
  'booking_oracle. US-025, ADR-068.';
COMMENT ON FUNCTION core.booking_production_oracle_alert() IS
  'Oracle C12 rejoué ; alerte P1 booking.alert.production_oracle (comptes seulement) si un '
  'contrôle est non nul. US-025, ADR-068.';

REVOKE ALL ON FUNCTION core.booking_production_oracle(), core.booking_production_oracle_alert()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_production_oracle(), core.booking_production_oracle_alert()
  TO app_worker;

-- 4. T1 : environnement de la base fail-closed sur NULL (report de la revue sécurité d'US-024) ----
-- `migrator` ne remplace une fonction d'un autre propriétaire qu'en devenant lui (ADR-044 amendé) ;
-- CREATE sur le schéma accordé le temps du remplacement (comme 0040). Droits (EXECUTE au seul
-- app_api), propriétaire et entrée RLS-15 inchangés.
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

CREATE OR REPLACE FUNCTION core.booking_cmd_start_payment(p_hold_id uuid, p_psp_account_id uuid, p_method text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_env         text;
  v_guest       uuid := app.actor_id();
  v_owner       uuid;
  v_vehicle     uuid;
  v_country     text;
  v_status      text;
  v_now         timestamptz;
  v_margin      integer;
  v_timeout     integer;
  v_max_total   integer;
  v_tolerance   integer;
  v_max_tries   integer;
  v_order_ttl   integer;
  v_base        timestamptz;
  v_bound       timestamptz;
  v_attempt     integer;
  v_key         text;
  v_op          uuid := pg_catalog.gen_random_uuid();
  v_keys        text[];
  v_leg         text;
  v_outcome     text;
  n             integer;
  r_hold        record;
  r_op          record;
  r_terms       record;
  r_account     record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL OR p_hold_id IS NULL THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id, ch.country_code INTO v_owner, v_vehicle, v_country
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id;
  IF v_owner IS DISTINCT FROM v_guest THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('CARD', 'YAPPY', 'CLAVE', 'QR', 'PIX', 'BANK_TRANSFER') THEN
    RAISE EXCEPTION 'payment: method unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_method_unavailable';
  END IF;

  -- verrous voyageur → véhicule → hold (17 §2.5, ordre global M2)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  -- FOR UPDATE applique la politique UPDATE (cmd_hold_upd) : seul un hold vivant est verrouillé
  SELECT ch.status, ch.expires_at, ch.payment_in_flight_until, ch.payment_attempts,
         ch.review_required, ch.reviewed_at, ch.created_at, ch.org_id
    INTO r_hold
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id
     FOR UPDATE;
  IF NOT FOUND THEN
    SELECT ch.status INTO v_status FROM core.booking_checkout_hold ch WHERE ch.id = p_hold_id;
    IF v_status = 'CONVERTED' THEN
      RAISE EXCEPTION 'payment: hold already converted'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_payment_terminal';
    END IF;
    RAISE EXCEPTION 'payment: hold not payable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_not_payable';
  END IF;
  v_now := platform.now();

  -- Paiement déjà en vol : jamais un second ordre sans lecture (VERIF_17-B1)
  IF r_hold.status = 'PAYMENT_IN_FLIGHT' THEN
    SELECT o.id, o.idem_sent, o.provider_reference, o.status, o.provider, o.method,
           o.amount_minor, o.currency, o.attempt_no
      INTO r_op
      FROM core.payment_payment_operation o
     WHERE o.hold_id = p_hold_id AND o.purpose = 'RENT' AND o.kind = 'CAPTURE'
     ORDER BY o.attempt_no DESC, o.created_at DESC
     LIMIT 1;
    IF r_op.id IS NULL THEN
      v_outcome := 'VERIFYING';
    ELSIF r_op.provider_reference IS NOT NULL AND r_op.status IN ('PENDING', 'SUBMITTED')
          AND v_now < r_hold.payment_in_flight_until THEN
      v_outcome := 'EXISTING_ORDER';
    ELSIF r_op.provider_reference IS NULL AND r_op.status IN ('PENDING', 'UNKNOWN')
          AND v_now < r_hold.payment_in_flight_until
          AND core.payment_capability_bool(r_op.provider, v_country, r_op.method,
                                           'SUPPORTS_LOOKUP_BY_MERCHANT_REF') THEN
      v_outcome := 'RETRY_SAME_KEY';
    ELSE
      v_outcome := 'VERIFYING';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', v_outcome,
      'operationId', r_op.id,
      'idemSent', CASE WHEN v_outcome <> 'VERIFYING' THEN r_op.idem_sent END,
      'providerReference', CASE WHEN v_outcome = 'EXISTING_ORDER' THEN r_op.provider_reference END,
      'amountMinor', r_op.amount_minor::text,
      'currency', r_op.currency,
      'attemptNo', r_op.attempt_no,
      'legs', (SELECT pg_catalog.jsonb_object_agg(l.leg, l.amount_minor::text)
                 FROM core.payment_payment_operation_leg l WHERE l.operation_id = r_op.id),
      'paymentInFlightUntil', r_hold.payment_in_flight_until);
  END IF;

  -- hold ACTIVE : aucune intention de paiement avant reviewed_at (UXQ-08)
  IF r_hold.review_required AND r_hold.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'payment: booking under review'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hold_review_before_payment';
  END IF;
  SELECT t.amount_minor, t.currency, t.legs, t.scheduled_start
    INTO r_terms
    FROM core.booking_hold_payment_terms(p_hold_id) AS t;
  IF r_terms.amount_minor IS NULL OR r_terms.amount_minor <= 0 OR r_terms.currency IS NULL
     OR r_terms.legs IS NULL OR pg_catalog.jsonb_typeof(r_terms.legs) <> 'object'
     OR r_terms.scheduled_start IS NULL THEN
    RAISE EXCEPTION 'payment: quote unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_quote_unavailable';
  END IF;
  SELECT pg_catalog.array_agg(k ORDER BY k) INTO v_keys
    FROM pg_catalog.jsonb_object_keys(r_terms.legs) AS k;
  IF v_keys IS DISTINCT FROM ARRAY['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'] THEN
    RAISE EXCEPTION 'payment: quote unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_quote_unavailable';
  END IF;
  FOREACH v_leg IN ARRAY v_keys LOOP
    IF pg_catalog.jsonb_typeof(r_terms.legs -> v_leg) <> 'string'
       OR (r_terms.legs ->> v_leg) !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'payment: quote unavailable'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_quote_unavailable';
    END IF;
  END LOOP;

  v_margin    := core.booking_param_int('payment_in_flight_margin_s', v_country);
  v_timeout   := core.booking_param_int('psp_call_timeout_s', v_country);
  v_max_total := core.booking_param_int('hold_max_total_minutes', v_country);
  v_tolerance := core.booking_param_int('conversion_start_tolerance_minutes', v_country);
  v_max_tries := core.booking_param_int('payment_attempts_per_hold', v_country);
  IF v_margin IS NULL OR v_timeout IS NULL OR v_max_total IS NULL OR v_tolerance IS NULL
     OR v_max_tries IS NULL THEN
    RAISE EXCEPTION 'payment: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  -- un trip n'est jamais créé après son début prévu (2 bis (i)) : on ne débite pas pour rien
  IF r_terms.scheduled_start < v_now - pg_catalog.make_interval(mins => v_tolerance) THEN
    RAISE EXCEPTION 'payment: start passed'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_start_passed';
  END IF;
  IF r_hold.payment_attempts >= v_max_tries THEN
    RAISE EXCEPTION 'payment: attempts exhausted'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_attempts_exceeded';
  END IF;

  -- compte marchand de Kmino du pays, ACTIVE, jamais un FAKE en production (17 §4.3 point 5.7)
  SELECT a.provider, a.country_code, a.status, a.collection_mode, a.environment INTO r_account
    FROM core.payment_psp_account a WHERE a.id = p_psp_account_id;
  IF r_account.provider IS NULL OR r_account.status <> 'ACTIVE' OR r_account.country_code <> v_country THEN
    RAISE EXCEPTION 'payment: PSP account not active'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_account_active';
  END IF;
  -- environnement de la base lu UNE fois ; NULL vaut « production » (fail-closed, revue sécurité
  -- US-024, report vers US-025) : ni la garde FAKE ni la garde SANDBOX ne s'ouvrent sur un NULL
  v_env := COALESCE(platform.deployment_env(), 'production');
  IF r_account.provider = 'FAKE' AND v_env = 'production' THEN
    RAISE EXCEPTION 'payment: FAKE provider forbidden in production (C19)'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'psp_account_fake_forbidden';
  END IF;
  -- compte de bac à sable seulement dans un environnement non productif connu (revue sécurité US-024,
  -- majeur 1) : environnement de la BASE (platform.deployment_env(), 17 §6.5 point 1 ; production
  -- par défaut) ; toute autre valeur, production comprise, exige un compte LIVE (fail-closed)
  IF r_account.environment IS DISTINCT FROM 'LIVE'
     AND v_env NOT IN ('test', 'development', 'staging') THEN
    RAISE EXCEPTION 'payment: sandbox PSP account outside a test environment'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_account_active';
  END IF;

  -- capacités bloquantes du PSP du pays (17 §2.8 ; report d'US-061, ADR-066) : une seule manque ⇒
  -- aucun paiement (fail-closed), le même refus que l'activation d'un hôte
  IF pg_catalog.cardinality(core.payment_missing_blocking_capabilities(
       r_account.provider, v_country, r_account.collection_mode)) > 0 THEN
    RAISE EXCEPTION 'payment: blocking PSP capability missing'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'host_payout_rail_unavailable';
  END IF;

  -- borne provisoire (17 §2.5 étape 3a)
  v_order_ttl := core.payment_capability_int(r_account.provider, v_country, p_method,
                                             'ORDER_TTL_SECONDS');
  v_base := CASE WHEN r_hold.review_required THEN r_hold.reviewed_at ELSE r_hold.created_at END
            + pg_catalog.make_interval(mins => v_max_total);
  IF v_order_ttl > 0 THEN
    v_bound := LEAST(v_now + pg_catalog.make_interval(secs => v_timeout + v_order_ttl + v_margin),
                     v_base);
  ELSE
    v_bound := v_base;
  END IF;

  UPDATE core.booking_checkout_hold
     SET status = 'PAYMENT_IN_FLIGHT', payment_in_flight_until = v_bound, updated_by = v_guest
   WHERE id = p_hold_id AND status = 'ACTIVE' AND expires_at > v_now;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'payment: hold not payable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_not_payable';
  END IF;

  v_attempt := r_hold.payment_attempts + 1;
  v_key := pg_catalog.format('hold:%s:CAPTURE:a%s', p_hold_id, v_attempt);
  -- capture AUTO : opération CAPTURE, jambes de capture du devis (08 E7 règle 2)
  INSERT INTO core.payment_payment_operation
         (id, hold_id, psp_account_id, country_code, provider, method, kind, purpose, amount_minor,
          currency, attempt_no, status, idem_plain, idem_sent)
  VALUES (v_op, p_hold_id, p_psp_account_id, v_country, r_account.provider, p_method, 'CAPTURE',
          'RENT', r_terms.amount_minor, r_terms.currency, v_attempt, 'PENDING', v_key, v_key);
  INSERT INTO core.payment_payment_operation_leg
         (operation_id, leg, org_id, trip_id, country_code, amount_minor)
  SELECT v_op, k, r_hold.org_id, NULL, v_country, (r_terms.legs ->> k)::bigint
    FROM pg_catalog.unnest(v_keys) AS k;

  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.hold.payment_in_flight', 1, 'checkout_hold', p_hold_id, 1, v_country, v_guest,
          'GUEST', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'operation_id', v_op,
                                        'attempt_no', v_attempt,
                                        'payment_in_flight_until', v_bound),
          p_hold_id::text);

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'NEW_ORDER',
    'operationId', v_op,
    'idemSent', v_key,
    'providerReference', NULL,
    'amountMinor', r_terms.amount_minor::text,
    'currency', r_terms.currency,
    'attemptNo', v_attempt,
    'legs', r_terms.legs,
    'paymentInFlightUntil', v_bound);
END
$fn$;

-- (propriétaire : seul lui peut commenter la fonction)
COMMENT ON FUNCTION core.booking_cmd_start_payment(uuid, uuid, text) IS
  'Commande : intention de paiement T1 (17 §2.5 étape 3a), voyageur de la session ; environnement '
  'NULL = production (fail-closed). US-024, US-025.';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
