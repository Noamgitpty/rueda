-- 0039 — AVL / PAY : intention de paiement (T1), affinage de l'ordre (T2), annulation d'ordre par la
-- boîte d'envoi (CANCEL_ORDER) et libération après annulation confirmée.
-- US-024 ; 16 BKG-014 ; 08 BR-BOOK-10 ; 17 §2.3 (rôles d'exécution des commandes : T1 et T2 sous
-- cmd_hold_owner), §2.5 (étape 3 a à f, étape 6 temps 1 et 2, C15, C15 bis, C16), §2.8 (capacités,
-- fail-closed), §3.2.7 (payment_command), §4.3 ; ADR-035, ADR-053, ADR-056, ADR-059, ADR-063 ;
-- ADR-065. Appliquée sous `migrator`.
--
-- Cette migration :
--   1. core.booking_hold_payment_terms(hold) : conditions de paiement du hold (devis ACCEPTÉ :
--      montant, devise, jambes de capture, période commerciale, fuseau). FAIL-CLOSED : aucune ligne
--      tant que le module PRC (devis) et le catalogue n'existent pas ; T1 refuse alors tout paiement
--      (QUOTE_UNAVAILABLE). La base de test la remplace (test-migrations/9800). PROPOSÉ, ADR-065 ;
--   2. lecture fail-closed des capacités PSP (core.payment_capability_value / _bool / _int) : seule
--      la version en vigueur à platform.now() et VALIDATED_* compte ; inconnue = « non » ;
--   3. core.payment_payment_command : boîte d'envoi monétaire (17 §3.2.7, §4.3), réduite pour
--      l'instant à la commande CANCEL_ORDER (clé hold:{hold}:CANCEL:{opération}:a1, UNIQUE : une
--      seule commande quel que soit le nombre de rejeux, C16) ; les commandes VOID / REFUND de la
--      compensation arrivent avec refund_instance (US-223) ;
--   4. T1 core.booking_cmd_start_payment(hold, compte PSP, moyen) et T2
--      core.booking_cmd_record_order(hold, opération, référence PSP, expiration de l'ordre) :
--      SECURITY DEFINER sous cmd_hold_owner, EXECUTE au seul app_api, voyageur de la session
--      (liste blanche RLS-15) ;
--   5. core.booking_cmd_release_own_hold (0037) remplacée : la libération différée écrit en plus la
--      commande CANCEL_ORDER de chaque ordre vivant connu quand SUPPORTS_ORDER_CANCEL est validé
--      (étape 6, temps 1) ; corps inchangé par ailleurs ;
--   6. tâche core.booking_release_cancelled_holds(lot) (étape 6, temps 2, travailleur hold_expiry) :
--      libère un hold dont la libération est demandée et dont toutes les annulations sont
--      confirmées (DONE), sans opération SUCCEEDED non disposée.
--
-- Erreurs (SQLSTATE, contrainte) traduites par packages/db/src/errors.ts, sans DETAIL :
--   hold_forbidden (42501)                → FORBIDDEN ;
--   hold_not_payable (55000)              → HOLD_EXPIRED (« reserva expirada », le voyageur repart
--                                           d'un nouveau hold ; aucun appel au PSP) ;
--   hold_payment_terminal (55000)         → INVALID_TRANSITION (hold déjà converti) ;
--   hold_review_before_payment (23514)    → BOOKING_UNDER_REVIEW (UXQ-08) ;
--   payment_quote_unavailable (55000)     → QUOTE_UNAVAILABLE ;
--   payment_start_passed (55000)          → START_PASSED (tolérance conversion_start_tolerance_minutes) ;
--   payment_attempts_exhausted (55000)    → PAYMENT_ATTEMPTS_EXHAUSTED (payment_attempts_per_hold) ;
--   payment_method_unavailable (55000)    → PAYMENT_METHOD_UNAVAILABLE ;
--   payment_operation_account_active (23000) → PSP_ACCOUNT_INACTIVE ;
--   psp_account_fake_forbidden (23000)    → FAKE_FORBIDDEN_IN_PRODUCTION (C19) ;
--   hold_param_missing (55000)            → PARAM_MISSING.
-- Forme d'appel : commandCallSql (ADR-056 point 4, ADR-063 point 7), une instruction.
--
-- Retour arrière (tables vides) :
--   DROP FUNCTION core.booking_cmd_start_payment(uuid, uuid, text),
--     core.booking_cmd_record_order(uuid, uuid, text, timestamptz),
--     core.booking_release_cancelled_holds(integer), core.booking_hold_payment_terms(uuid),
--     core.payment_capability_value(text, text, text, text),
--     core.payment_capability_bool(text, text, text, text),
--     core.payment_capability_int(text, text, text, text);
--   réappliquer la définition de 0037 de core.booking_cmd_release_own_hold(uuid) ;
--   DROP TABLE core.payment_payment_command ;
--   DROP POLICY cmd_hold_pay_ins, cmd_hold_pay_upd ON core.payment_payment_operation ;
--   DROP POLICY cmd_hold_leg_sel, cmd_hold_leg_ins ON core.payment_payment_operation_leg ;
--   DROP POLICY cmd_hold_opevent_ins ON core.payment_payment_operation_event ;
--   DROP POLICY cmd_hold_read ON core.payment_psp_account, core.payment_psp_capability ;
--   recréer cmd_hold_read de core.config_param_value et cmd_hold_event_ins de l'outbox (0037) ;
--   REVOKE les droits accordés ci-dessous à cmd_hold_owner et app_worker.

-- 1. Conditions de paiement du hold : devis accepté (17 §2.5 étape 3a, étape 4.2 et 2 bis (iv)) --
-- Fail-closed (CLAUDE.md point 7) : sans devis ni catalogue, aucune ligne. La story du devis (PRC)
-- remplace ce corps par la lecture de quote (ACCEPTED, montant figé, jambes de capture) et du lieu
-- de remise (fuseau). SECURITY INVOKER.
CREATE FUNCTION core.booking_hold_payment_terms(p_hold_id uuid)
  RETURNS TABLE (amount_minor    bigint,
                 currency        text,
                 legs            jsonb,
                 scheduled_start timestamptz,
                 scheduled_end   timestamptz,
                 timezone        text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT NULL::bigint, NULL::text, NULL::jsonb, NULL::timestamptz, NULL::timestamptz, NULL::text
   WHERE false
$fn$;

COMMENT ON FUNCTION core.booking_hold_payment_terms(uuid) IS
  'Devis accepté du hold (montant, devise, jambes de capture, période, fuseau). PROPOSÉ fail-closed : '
  'aucune ligne avant le module PRC (devis) et le catalogue. US-024, ADR-065.';

REVOKE ALL ON FUNCTION core.booking_hold_payment_terms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_hold_payment_terms(uuid) TO cmd_hold_owner, app_worker;

-- 2. Capacités PSP, lecture fail-closed (17 §2.8 ; même règle que pay/internal/capabilities.ts) ----
-- Par moyen (précis, puis '*'), version la plus récente en vigueur à platform.now() ; seule une
-- version VALIDATED_SANDBOX ou VALIDATED_CONTRACT compte. Réseau '*' seulement (les capacités lues
-- ici ne dépendent pas du réseau). SECURITY INVOKER.
CREATE FUNCTION core.payment_capability_value(p_provider text, p_country text, p_method text,
                                              p_capability text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts),
       cur AS (
         SELECT DISTINCT ON (c.method) c.method, c.value, c.status
           FROM core.payment_psp_capability c, t
          WHERE c.provider = p_provider
            AND c.country_code = p_country
            AND c.capability = p_capability
            AND c.network = '*'
            AND c.method IN (COALESCE(p_method, '*'), '*')
            AND c.valid_from <= t.ts
          ORDER BY c.method, c.valid_from DESC
       )
  SELECT cur.value
    FROM cur
   WHERE cur.status IN ('VALIDATED_SANDBOX', 'VALIDATED_CONTRACT')
   ORDER BY (cur.method = '*')
   LIMIT 1
$fn$;

CREATE FUNCTION core.payment_capability_bool(p_provider text, p_country text, p_method text,
                                             p_capability text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(core.payment_capability_value(p_provider, p_country, p_method, p_capability)
                  = 'true'::jsonb, false)
$fn$;

CREATE FUNCTION core.payment_capability_int(p_provider text, p_country text, p_method text,
                                            p_capability text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                   AND (v.value #>> '{}') ~ '^[0-9]{1,9}$'
              THEN (v.value #>> '{}')::integer
              ELSE 0 END
    FROM (SELECT core.payment_capability_value(p_provider, p_country, p_method, p_capability)
                   AS value) AS v
$fn$;

COMMENT ON FUNCTION core.payment_capability_value(text, text, text, text) IS
  'Capacité PSP en vigueur et VALIDATED_* (moyen précis puis *), sinon NULL (fail-closed). US-024.';
COMMENT ON FUNCTION core.payment_capability_bool(text, text, text, text) IS
  'Capacité booléenne validée ; inconnue = false (17 §2.8). US-024.';
COMMENT ON FUNCTION core.payment_capability_int(text, text, text, text) IS
  'Capacité entière validée ; inconnue = 0 (17 §2.8). US-024.';

REVOKE ALL ON FUNCTION core.payment_capability_value(text, text, text, text),
  core.payment_capability_bool(text, text, text, text),
  core.payment_capability_int(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_capability_value(text, text, text, text),
  core.payment_capability_bool(text, text, text, text),
  core.payment_capability_int(text, text, text, text) TO cmd_hold_owner, app_worker;

GRANT SELECT ON core.payment_psp_capability TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.payment_psp_capability FOR SELECT TO cmd_hold_owner USING (true);

-- 3. Boîte d'envoi monétaire : commande CANCEL_ORDER (17 §3.2.7 payment_command, §4.3) -------------
-- Écrite DANS la transaction qui la décide, exécutée APRÈS le COMMIT par le travailleur de commandes
-- (17 §2.5 « aucun effet externe dans une transaction rejouable ») ; la clé stockée rend tout
-- rejeu sans effet (ON CONFLICT DO NOTHING : une seule commande, donc un seul cancelOrder, C16).
CREATE TABLE core.payment_payment_command (
  id              uuid        PRIMARY KEY,
  operation_kind  text        NOT NULL
    CONSTRAINT payment_command_kind_valid CHECK (operation_kind IN ('CANCEL_ORDER')),
  idem_plain      text        NOT NULL
    CONSTRAINT payment_command_idem_unique UNIQUE,
  operation_id    uuid        NOT NULL               -- ordre visé (opération de loyer du hold)
    CONSTRAINT payment_command_operation_fk REFERENCES core.payment_payment_operation (id),
  hold_id         uuid        NOT NULL
    CONSTRAINT payment_command_hold_fk REFERENCES core.booking_checkout_hold (id),
  country_code    text        NOT NULL
    CONSTRAINT payment_command_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  status          text        NOT NULL DEFAULT 'PENDING'
    CONSTRAINT payment_command_status_valid CHECK (status IN
      ('PENDING', 'IN_FLIGHT', 'DONE', 'UNKNOWN', 'ABANDONED')),
  next_attempt_at timestamptz NOT NULL DEFAULT platform.now(),
  attempts        integer     NOT NULL DEFAULT 0
    CONSTRAINT payment_command_attempts_nonnegative CHECK (attempts >= 0),
  last_error      text,
  partition_key   text        NOT NULL,              -- = hold_id (17 §3.2.7, F32)
  created_at      timestamptz NOT NULL DEFAULT platform.now(),
  updated_at      timestamptz NOT NULL DEFAULT platform.now(),
  row_version     integer     NOT NULL DEFAULT 0,
  CONSTRAINT payment_command_cancel_key CHECK (
    operation_kind <> 'CANCEL_ORDER'
    OR idem_plain = 'hold:' || hold_id::text || ':CANCEL:' || operation_id::text || ':a1')
);

CREATE INDEX payment_command_hold_idx ON core.payment_payment_command (hold_id);
CREATE INDEX payment_command_due_idx ON core.payment_payment_command (next_attempt_at)
  WHERE (status IN ('PENDING', 'UNKNOWN'));

CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_payment_command
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
CREATE TRIGGER no_delete BEFORE DELETE ON core.payment_payment_command
  FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete();

COMMENT ON TABLE core.payment_payment_command IS
  'PAY payment_command (17 §3.2.7, §4.3), réduite à CANCEL_ORDER (US-024). Une commande par clé ; '
  'exécutée après le COMMIT par le travailleur payment_command (US-061). Classe B.';

ALTER TABLE core.payment_payment_command ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_payment_command FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payment_payment_command TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.payment_payment_command FROM PUBLIC;

-- Écrivains : commandes du voyageur (T2, libération ; cmd_hold_owner), conversion (hold supplanté,
-- C18 ; app_worker). Lecteurs : travailleur de commandes (exécution), libération (temps 2).
GRANT SELECT (id, idem_plain, operation_id, hold_id, status)
  ON core.payment_payment_command TO cmd_hold_owner;
GRANT INSERT (id, operation_kind, idem_plain, operation_id, hold_id, country_code, partition_key)
  ON core.payment_payment_command TO cmd_hold_owner;
CREATE POLICY cmd_hold_command_sel ON core.payment_payment_command FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_command_ins ON core.payment_payment_command FOR INSERT TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'GUEST' AND operation_kind = 'CANCEL_ORDER' AND status = 'PENDING'
              AND EXISTS (SELECT 1 FROM core.booking_checkout_hold h
                           WHERE h.id = payment_payment_command.hold_id
                             AND h.guest_user_id = app.actor_id()));

GRANT SELECT ON core.payment_payment_command TO app_worker;
GRANT INSERT (id, operation_kind, idem_plain, operation_id, hold_id, country_code, partition_key)
  ON core.payment_payment_command TO app_worker;
GRANT UPDATE (status, next_attempt_at, attempts, last_error) ON core.payment_payment_command TO app_worker;
CREATE POLICY worker_select ON core.payment_payment_command FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('payment_command', 'booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper',
          'hold_expiry'));
CREATE POLICY worker_insert_conversion ON core.payment_payment_command FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN
              ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper')
              AND operation_kind = 'CANCEL_ORDER' AND status = 'PENDING');
CREATE POLICY worker_update_command ON core.payment_payment_command FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

-- 4. Droits de cmd_hold_owner pour T1 et T2 (au plus juste) --------------------------------------
GRANT SELECT (payment_attempts) ON core.booking_checkout_hold TO cmd_hold_owner;
GRANT UPDATE (payment_in_flight_until) ON core.booking_checkout_hold TO cmd_hold_owner;
-- opération de loyer : lecture (rejeu, ordre existant), insertion PENDING (T1), passage
-- PENDING -> SUBMITTED avec la référence PSP (T2) ; jamais un montant modifié
GRANT SELECT ON core.payment_payment_operation TO cmd_hold_owner;
GRANT INSERT (id, hold_id, psp_account_id, country_code, provider, method, kind, purpose,
              amount_minor, currency, attempt_no, status, idem_plain, idem_sent)
  ON core.payment_payment_operation TO cmd_hold_owner;
GRANT UPDATE (status, provider_reference) ON core.payment_payment_operation TO cmd_hold_owner;
CREATE POLICY cmd_hold_pay_ins ON core.payment_payment_operation FOR INSERT TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'GUEST' AND purpose = 'RENT' AND kind = 'CAPTURE'
              AND status = 'PENDING' AND trip_id IS NULL AND psp_account_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM core.booking_checkout_hold h
                           WHERE h.id = payment_payment_operation.hold_id
                             AND h.guest_user_id = app.actor_id()
                             AND h.status = 'PAYMENT_IN_FLIGHT'));
CREATE POLICY cmd_hold_pay_upd ON core.payment_payment_operation FOR UPDATE TO cmd_hold_owner
  USING (app.actor_kind() = 'GUEST' AND purpose = 'RENT' AND status = 'PENDING'
         AND EXISTS (SELECT 1 FROM core.booking_checkout_hold h
                      WHERE h.id = payment_payment_operation.hold_id
                        AND h.guest_user_id = app.actor_id()))
  WITH CHECK (app.actor_kind() = 'GUEST' AND status = 'SUBMITTED');
-- jambes de capture du devis (08 E7 règle 2), insérées avec l'opération (contrôle différé 0028)
GRANT SELECT, INSERT ON core.payment_payment_operation_leg TO cmd_hold_owner;
CREATE POLICY cmd_hold_leg_sel ON core.payment_payment_operation_leg FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_leg_ins ON core.payment_payment_operation_leg FOR INSERT TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'GUEST' AND trip_id IS NULL
              AND EXISTS (SELECT 1 FROM core.payment_payment_operation o
                            JOIN core.booking_checkout_hold h ON h.id = o.hold_id
                           WHERE o.id = payment_payment_operation_leg.operation_id
                             AND o.status = 'PENDING' AND o.purpose = 'RENT'
                             AND h.guest_user_id = app.actor_id()));
-- historique des statuts (17 §3.2.7 : chaque changement est écrit) : SUBMITTED reçu de l'API
GRANT INSERT (id, operation_id, status, source, outcome, raw_ref)
  ON core.payment_payment_operation_event TO cmd_hold_owner;
CREATE POLICY cmd_hold_opevent_ins ON core.payment_payment_operation_event FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'GUEST' AND source = 'API_RESPONSE' AND raw_ref IS NULL);
-- compte marchand de Kmino du pays (owner_type PLATFORM par CHECK) et garde FAKE (C19)
GRANT SELECT (id, provider, country_code, environment, status) ON core.payment_psp_account
  TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.payment_psp_account FOR SELECT TO cmd_hold_owner USING (true);
GRANT USAGE ON SCHEMA platform TO cmd_hold_owner;
GRANT EXECUTE ON FUNCTION platform.deployment_env() TO cmd_hold_owner;

-- Clés lues par les commandes de hold (0037 + paiement)
DROP POLICY cmd_hold_read ON core.config_param_value;
CREATE POLICY cmd_hold_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('buffer_minutes', 'hold_ttl_minutes', 'hold_max_total_minutes',
                 'max_active_holds_per_guest', 'hold_creations_per_guest_vehicle_hour',
                 'sweep_grace_s', 'flagged_booking_payment_order', 'review_hold_minutes',
                 'payment_in_flight_margin_s', 'psp_call_timeout_s',
                 'conversion_start_tolerance_minutes', 'payment_attempts_per_hold'));

-- Événements des commandes du voyageur : + booking.hold.payment_in_flight (17 §2.5 étape 3a)
DROP POLICY cmd_hold_event_ins ON core.outbox_outbox_event;
CREATE POLICY cmd_hold_event_ins ON core.outbox_outbox_event FOR INSERT TO cmd_hold_owner
  WITH CHECK (aggregate_type = 'checkout_hold'
              AND type IN ('booking.hold.created', 'booking.hold.released',
                           'booking.hold.release_deferred', 'booking.hold.payment_in_flight')
              AND app.actor_kind() = 'GUEST' AND actor_role = 'GUEST'
              AND actor_user_id = app.actor_id());

-- 5. T1 : intention de paiement (17 §2.5 étape 3a, VERIF_16-N3, VERIF_17-B1) ---------------------
-- Transaction courte validée AVANT tout appel au PSP. Verrous voyageur → véhicule → hold.
--   hold ACTIVE : contrôles (revue, devis, début, compte, tentatives), puis
--     UPDATE … SET status = 'PAYMENT_IN_FLIGHT' WHERE status = 'ACTIVE' AND expires_at > now ;
--     zéro ligne ⇒ HOLD_EXPIRED et aucun appel ; borne provisoire = min(now + psp_call_timeout_s +
--     ORDER_TTL_SECONDS + payment_in_flight_margin_s, base + hold_max_total_minutes), base =
--     created_at (reviewed_at pour un hold de revue) ; TTL inconnu ⇒ base + hold_max_total_minutes ;
--     opération PENDING (clé hold:{hold}:CAPTURE:a{n}, n = refus reçus + 1) et ses quatre jambes
--     de capture du devis ; booking.hold.payment_in_flight ⇒ NEW_ORDER ;
--   hold PAYMENT_IN_FLIGHT (double clic, retour arrière, VERIF_17-B1) : ordre connu et vivant ⇒
--     EXISTING_ORDER (même opération, même clé, aucun nouvel ordre) ; ordre inconnu (T2 jamais
--     écrite) ⇒ RETRY_SAME_KEY si SUPPORTS_LOOKUP_BY_MERCHANT_REF est validé (getOperation puis
--     même clé), sinon VERIFYING (« pago en verificación », attente du balayage) ;
--   hold EXPIRED / RELEASED / COMPENSATED ⇒ HOLD_EXPIRED ; CONVERTED ⇒ INVALID_TRANSITION.
-- Renvoie un jsonb (montants en texte : bigint exact).
CREATE FUNCTION core.booking_cmd_start_payment(p_hold_id uuid, p_psp_account_id uuid, p_method text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
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
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_attempts_exhausted';
  END IF;

  -- compte marchand de Kmino du pays, ACTIVE, jamais un FAKE en production (17 §4.3 point 5.7)
  SELECT a.provider, a.country_code, a.status INTO r_account
    FROM core.payment_psp_account a WHERE a.id = p_psp_account_id;
  IF r_account.provider IS NULL OR r_account.status <> 'ACTIVE' OR r_account.country_code <> v_country THEN
    RAISE EXCEPTION 'payment: PSP account not active'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_account_active';
  END IF;
  IF r_account.provider = 'FAKE' AND platform.deployment_env() = 'production' THEN
    RAISE EXCEPTION 'payment: FAKE provider forbidden in production (C19)'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'psp_account_fake_forbidden';
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

-- 6. T2 : affinage après l'appel createHostedPayment (17 §2.5 étape 3c, VERIF_17 T2) --------------
-- Verrous voyageur → véhicule → hold. Ordre connu : opération PENDING -> SUBMITTED avec la
-- référence PSP (jamais une rétrogradation : une opération SUCCEEDED, preuve arrivée avant T2,
-- reste SUCCEEDED, C15 bis (h)) ; borne affinée vers le bas seulement :
-- least(borne, expiration réelle de l'ordre + payment_in_flight_margin_s).
-- Ramification si le hold n'est plus en vol : CONVERTED / COMPENSATED ⇒ rien n'est annulé (le
-- voyageur est redirigé vers le résultat) ; EXPIRED / RELEASED ⇒ le voyageur n'est pas redirigé
-- vers le paiement, et CANCEL_ORDER est écrite si SUPPORTS_ORDER_CANCEL est validé. Renvoie
-- RECORDED, CONVERTED, COMPENSATED ou EXPIRED.
CREATE FUNCTION core.booking_cmd_record_order(
  p_hold_id            uuid,
  p_operation_id       uuid,
  p_provider_reference text,
  p_order_expires_at   timestamptz
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid := app.actor_id();
  v_owner   uuid;
  v_vehicle uuid;
  v_country text;
  v_status  text;
  v_margin  integer;
  v_live    boolean;
  r_op      record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL OR p_hold_id IS NULL
     OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF p_provider_reference IS NULL OR p_provider_reference !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'payment: invalid provider reference' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id, ch.country_code INTO v_owner, v_vehicle, v_country
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id;
  IF v_owner IS DISTINCT FROM v_guest THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  SELECT o.status, o.provider, o.method, o.provider_reference INTO r_op
    FROM core.payment_payment_operation o
   WHERE o.id = p_operation_id AND o.hold_id = p_hold_id AND o.purpose = 'RENT'
     AND o.kind = 'CAPTURE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  v_margin := core.booking_param_int('payment_in_flight_margin_s', v_country);
  IF v_margin IS NULL THEN
    RAISE EXCEPTION 'payment: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  SELECT ch.status INTO v_status
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id
     FOR UPDATE;
  v_live := FOUND;
  IF NOT v_live THEN
    SELECT ch.status INTO v_status FROM core.booking_checkout_hold ch WHERE ch.id = p_hold_id;
  END IF;

  -- l'ordre existe chez le PSP : il est enregistré (le balayage pourra le lire), jamais rétrogradé
  IF r_op.status = 'PENDING' THEN
    UPDATE core.payment_payment_operation
       SET status = 'SUBMITTED', provider_reference = p_provider_reference
     WHERE id = p_operation_id AND status = 'PENDING';
    INSERT INTO core.payment_payment_operation_event (id, operation_id, status, source, outcome, raw_ref)
    VALUES (pg_catalog.gen_random_uuid(), p_operation_id, 'SUBMITTED', 'API_RESPONSE', 'APPLIED', NULL);
  END IF;

  IF v_live THEN
    IF v_status = 'PAYMENT_IN_FLIGHT' AND p_order_expires_at IS NOT NULL THEN
      UPDATE core.booking_checkout_hold
         SET payment_in_flight_until = LEAST(payment_in_flight_until,
                                             p_order_expires_at
                                               + pg_catalog.make_interval(secs => v_margin)),
             updated_by = v_guest
       WHERE id = p_hold_id AND status = 'PAYMENT_IN_FLIGHT';
    END IF;
    RETURN 'RECORDED';
  END IF;

  IF v_status IN ('CONVERTED', 'COMPENSATED') THEN
    RETURN v_status;
  END IF;

  -- EXPIRED / RELEASED : l'ordre ne doit plus être payé ; annulation si la capacité est validée
  IF core.payment_capability_bool(r_op.provider, v_country, r_op.method, 'SUPPORTS_ORDER_CANCEL') THEN
    INSERT INTO core.payment_payment_command
           (id, operation_kind, idem_plain, operation_id, hold_id, country_code, partition_key)
    VALUES (pg_catalog.gen_random_uuid(), 'CANCEL_ORDER',
            'hold:' || p_hold_id::text || ':CANCEL:' || p_operation_id::text || ':a1',
            p_operation_id, p_hold_id, v_country, p_hold_id::text)
    ON CONFLICT ON CONSTRAINT payment_command_idem_unique DO NOTHING;
  END IF;
  RETURN 'EXPIRED';
END
$fn$;

COMMENT ON FUNCTION core.booking_cmd_start_payment(uuid, uuid, text) IS
  'Commande : intention de paiement T1 (17 §2.5 étape 3a), voyageur de la session. US-024.';
COMMENT ON FUNCTION core.booking_cmd_record_order(uuid, uuid, text, timestamptz) IS
  'Commande : affinage T2 (17 §2.5 étape 3c), ramification EXPIRED / RELEASED ⇒ CANCEL_ORDER. US-024.';

REVOKE ALL ON FUNCTION core.booking_cmd_start_payment(uuid, uuid, text),
  core.booking_cmd_record_order(uuid, uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_cmd_start_payment(uuid, uuid, text),
  core.booking_cmd_record_order(uuid, uuid, text, timestamptz) TO app_api;

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
ALTER FUNCTION core.booking_cmd_start_payment(uuid, uuid, text) OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_cmd_record_order(uuid, uuid, text, timestamptz) OWNER TO cmd_hold_owner;

-- 7. Libération de son hold (0037) : + CANCEL_ORDER des ordres vivants connus (étape 6, temps 1) --
-- `migrator` ne remplace une fonction d'un autre propriétaire qu'en devenant lui (ADR-044 amendé) ;
-- CREATE sur le schéma accordé ci-dessus le temps du remplacement.
SET LOCAL ROLE cmd_hold_owner;

CREATE OR REPLACE FUNCTION core.booking_cmd_release_own_hold(p_hold_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid := app.actor_id();
  v_vehicle uuid;
  v_owner   uuid;
  v_country text;
  v_grace   integer;
  v_now     timestamptz;
  v_blocked boolean;
  v_status  text;
  h         record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL OR p_hold_id IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id, ch.country_code INTO v_owner, v_vehicle, v_country
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id;
  IF v_owner IS DISTINCT FROM v_guest THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  v_grace := core.booking_param_int('sweep_grace_s', v_country);
  IF v_grace IS NULL THEN
    RAISE EXCEPTION 'hold: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;

  -- verrous guest → véhicule → hold (17 §2.5 étape 6) ; vehicle_id n'est modifiable par personne
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  -- FOR UPDATE applique la politique UPDATE (cmd_hold_upd) : seul un hold vivant est verrouillé
  SELECT ch.status, ch.occupancy_id, ch.org_id, ch.payment_in_flight_until, ch.last_polled_at,
         ch.release_requested_at
    INTO h
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id
     FOR UPDATE;
  IF NOT FOUND THEN
    SELECT ch.status INTO v_status FROM core.booking_checkout_hold ch WHERE ch.id = p_hold_id;
    IF v_status IN ('EXPIRED', 'RELEASED') THEN
      RETURN 'NOOP';
    END IF;
    RAISE EXCEPTION 'hold: terminal, cannot be released'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_release_terminal';
  END IF;
  IF h.release_requested_at IS NOT NULL THEN
    RETURN 'DEFERRED';
  END IF;

  v_now := platform.now();
  v_blocked := (h.status = 'PAYMENT_IN_FLIGHT' AND h.payment_in_flight_until > v_now)
    OR EXISTS (SELECT 1 FROM core.payment_payment_operation o
                WHERE o.hold_id = p_hold_id AND o.purpose = 'RENT'
                  AND ( ( o.status IN ('PENDING', 'SUBMITTED', 'UNKNOWN')
                          AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
                          AND v_now < h.payment_in_flight_until + pg_catalog.make_interval(secs => v_grace) )
                     OR ( o.status = 'SUCCEEDED'
                          AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                           WHERE d.operation_id = o.id) ) ));

  IF v_blocked THEN
    UPDATE core.booking_checkout_hold
       SET release_requested_at = v_now, released_by = v_guest, release_reason = 'GUEST_ABANDON',
           updated_by = v_guest
     WHERE id = p_hold_id;
    -- US-024 (étape 6, temps 1) : annulation active de chaque ordre vivant connu quand
    -- SUPPORTS_ORDER_CANCEL est validé ; exécutée après le COMMIT par la boîte d'envoi (clé
    -- stockée : un rejeu n'écrit rien de plus). Sans la capacité : libération différée seule.
    INSERT INTO core.payment_payment_command
           (id, operation_kind, idem_plain, operation_id, hold_id, country_code, partition_key)
    SELECT pg_catalog.gen_random_uuid(), 'CANCEL_ORDER',
           'hold:' || p_hold_id::text || ':CANCEL:' || o.id::text || ':a1',
           o.id, p_hold_id, v_country, p_hold_id::text
      FROM core.payment_payment_operation o
     WHERE o.hold_id = p_hold_id AND o.purpose = 'RENT'
       AND o.status IN ('PENDING', 'SUBMITTED', 'UNKNOWN')
       AND o.provider_reference IS NOT NULL
       AND core.payment_capability_bool(o.provider, v_country, o.method, 'SUPPORTS_ORDER_CANCEL')
    ON CONFLICT ON CONSTRAINT payment_command_idem_unique DO NOTHING;
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_user_id, actor_role, correlation_id, payload, partition_key)
    VALUES ('booking.hold.release_deferred', 1, 'checkout_hold', p_hold_id, 1, v_country, v_guest,
            'GUEST', pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'vehicle_id', v_vehicle,
                                          'org_id', h.org_id, 'reason', 'GUEST_ABANDON'),
            p_hold_id::text);
    RETURN 'DEFERRED';
  END IF;

  UPDATE core.booking_checkout_hold
     SET status = 'RELEASED', released_at = v_now, released_by = v_guest,
         release_reason = 'GUEST_ABANDON', updated_by = v_guest
   WHERE id = p_hold_id;
  UPDATE core.booking_vehicle_occupancy
     SET active = false, deactivated_reason = 'HOLD_RELEASED', updated_by = v_guest
   WHERE id = h.occupancy_id AND kind = 'HOLD' AND active;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.hold.released', 1, 'checkout_hold', p_hold_id, 1, v_country, v_guest, 'GUEST',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'vehicle_id', v_vehicle,
                                        'org_id', h.org_id, 'reason', 'GUEST_ABANDON'),
          p_hold_id::text);
  RETURN 'RELEASED';
END
$fn$;

-- (propriétaire : seul lui peut commenter la fonction)
COMMENT ON FUNCTION core.booking_cmd_release_own_hold(uuid) IS
  'Commande : libération de son hold, immédiate ou différée, avec CANCEL_ORDER des ordres vivants '
  'connus si SUPPORTS_ORDER_CANCEL est validé (17 §2.5 étape 6, temps 1). US-023, US-024.';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 8. Libération après annulation confirmée (17 §2.5 étape 6, temps 2) -----------------------------
-- Travailleur hold_expiry, SECURITY INVOKER (politiques de 0007). Un hold dont la libération est
-- demandée est libéré dès que TOUTES ses commandes CANCEL_ORDER sont DONE (annulation confirmée par
-- le PSP, ou ordre déjà expiré), qu'aucune opération de loyer n'est SUCCEEDED sans disposition (A6)
-- et que toute opération non terminale a son annulation confirmée. Sinon, la tâche d'expiration le
-- libère à la borne de paiement (+ sweep_grace_s), comme sans la capacité. Une désactivation ne viole
-- jamais l'exclusion : pas de verrou consultatif, SKIP LOCKED (une conversion en cours est sautée ;
-- si elle convertit, rien n'est fait).
CREATE FUNCTION core.booking_release_cancelled_holds(p_limit integer)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS DISTINCT FROM 'hold_expiry' THEN
    RAISE EXCEPTION 'hold release: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'hold release: batch size out of bounds' USING ERRCODE = '22023';
  END IF;
  WITH t AS (SELECT platform.now() AS ts),
     due AS (
       SELECT h.id
         FROM core.booking_checkout_hold h
        WHERE h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
          AND h.release_requested_at IS NOT NULL
          AND EXISTS (SELECT 1 FROM core.payment_payment_command c
                       WHERE c.hold_id = h.id AND c.operation_kind = 'CANCEL_ORDER')
          AND NOT EXISTS (SELECT 1 FROM core.payment_payment_command c
                           WHERE c.hold_id = h.id AND c.operation_kind = 'CANCEL_ORDER'
                             AND c.status <> 'DONE')
          AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation o
                           WHERE o.hold_id = h.id AND o.purpose = 'RENT'
                             AND ( ( o.status = 'SUCCEEDED'
                                     AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                                      WHERE d.operation_id = o.id) )
                                OR ( o.status IN ('PENDING', 'SUBMITTED', 'UNKNOWN')
                                     AND NOT EXISTS (SELECT 1 FROM core.payment_payment_command c
                                                      WHERE c.operation_id = o.id
                                                        AND c.operation_kind = 'CANCEL_ORDER'
                                                        AND c.status = 'DONE') ) ))
        ORDER BY h.release_requested_at
        LIMIT p_limit
        FOR UPDATE OF h SKIP LOCKED
     ), done AS (
       UPDATE core.booking_checkout_hold AS ch
          SET status = 'RELEASED', released_at = t.ts
         FROM due, t
        WHERE ch.id = due.id
       RETURNING ch.id, ch.occupancy_id, ch.vehicle_id, ch.org_id, ch.country_code, ch.release_reason
     ), occupancy AS (
       UPDATE core.booking_vehicle_occupancy AS vo
          SET active = false, deactivated_reason = 'HOLD_RELEASED'
         FROM done
        WHERE vo.id = done.occupancy_id AND vo.kind = 'HOLD' AND vo.active
     ), events AS (
       INSERT INTO core.outbox_outbox_event
              (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
               actor_role, correlation_id, payload, partition_key)
       SELECT 'booking.hold.released', 1, 'checkout_hold', done.id, 2, done.country_code, 'SYSTEM',
              pg_catalog.gen_random_uuid(),
              pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                'hold_id', done.id, 'vehicle_id', done.vehicle_id, 'org_id', done.org_id,
                'reason', done.release_reason, 'order_cancelled', true)),
              done.id::text
         FROM done
     )
  SELECT pg_catalog.count(*)::integer INTO n FROM done;
  RETURN n;
END
$fn$;

COMMENT ON FUNCTION core.booking_release_cancelled_holds(integer) IS
  'Libération après annulation confirmée (17 §2.5 étape 6, temps 2), travailleur hold_expiry. US-024.';

REVOKE ALL ON FUNCTION core.booking_release_cancelled_holds(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_release_cancelled_holds(integer) TO app_worker;
