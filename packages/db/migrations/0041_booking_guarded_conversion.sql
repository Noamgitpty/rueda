-- 0041 — AVL : conversion gardée, ré-acquisition, compensation, refus reçu, balayages.
-- US-024 ; 16 BKG-014 ; 08 BR-BOOK-10, SM-1 (HOLD -> BOOKED sur preuve de paiement), EC-51 ;
-- 17 §2.3 (rôles d'exécution : conversion, compensation et balayages sous app_worker, une politique
-- explicite par travailleur), §2.5 (étape 3d / 3e, étape 4 avec 2 bis, A4, bloc C, étape 5, A6 :
-- disposition_sweeper ; C2 à C4 bis, C6 à C8, C13 à C15 bis, C17, C18, C20), §2.8 (capacités),
-- L0-07 ; ADR-035, ADR-048, ADR-056, ADR-063 ; ADR-065. Appliquée sous `migrator`.
--
-- Fonctions (toutes SECURITY INVOKER, exécutées par app_worker sous un travailleur de la liste
-- booking_conversion / disposition_sweeper / payment_intent_sweeper, avec les politiques de 0007 ;
-- aucune entrée client, la preuve est l'opération SUCCEEDED déjà appliquée par webhook_ingest ou par
-- le travailleur de commandes, avec son historique payment_operation_event) :
--   - core.booking_convert_payment(opération) : étape 4 (verrous voyageur → véhicule, rejeu exact
--     par payment_disposition, verrou du hold sans prédicat de statut, contrôles de preuve et 2 bis,
--     conversion ou ré-acquisition sous la contrainte d'exclusion avec résolution A4, trip BOOKED,
--     guest_occupancy, disposition CONVERSION, événements) ou compensation (bloc C) ;
--   - core.booking_open_compensation(hold, opération, motif) : bloc C et action par capacité
--     validée (étape 5 : VOID / LET_EXPIRE pour une autorisation, REFUND_API / BANK_TRANSFER_REFUND
--     pour un débit capturé ; fail-closed) ;
--   - core.booking_record_payment_failure(opération) : refus REÇU (étape 3e) : retour en ACTIVE si
--     une tentative reste et que le hold n'est pas échu, sinon RELEASED (PAYMENT_DECLINED) ;
--   - core.booking_intents_due(lot) et core.booking_record_poll(opération) : payment_intent_sweeper
--     (étape 3d, A3) : ordres à lire dès borne − sweep_lead_s ; écriture de last_polled_at et
--     conversion (ou refus) dans la même transaction, sous les verrous ;
--   - core.booking_disposition_candidates(lot) et core.booking_disposition_repair(opération) :
--     disposition_sweeper (A6, C17) : opération SUCCEEDED sans disposition depuis
--     disposition_repair_after_minutes ⇒ étape 4 rejouée ; échecs comptés
--     (core.booking_disposition_repair_log) ; alerte P1 (booking.payment.disposition_overdue) à
--     disposition_alert_minutes.
-- Une SEULE fonction SECURITY DEFINER : core.booking_conversion_eligibility(hold) (cmd_hold_owner,
-- liste blanche RLS-15, EXECUTE au seul app_worker) : véhicule toujours publié chez le même hôte,
-- hôte ACTIVE, voyageur ≠ titulaire (2 bis (ii) et (iii)) ; elle lit le catalogue et le compte d'hôte
-- sans ouvrir iam_organization aux travailleurs.
--
-- Chaque transaction appelante suit 17 §2.5 « Reprise » : 40P01 / 40001 ⇒ annulation complète et
-- rejeu (au plus 3) ; aucun effet externe n'est fait ici (CANCEL_ORDER et la compensation sont des
-- lignes : boîte d'envoi, hold_compensation et événements de l'outbox).
--
-- Retour arrière (aucun écrivain de production avant US-003 / US-061) :
--   DROP FUNCTION core.booking_convert_payment(uuid), core.booking_open_compensation(uuid, uuid, text),
--     core.booking_record_payment_failure(uuid), core.booking_intents_due(integer),
--     core.booking_record_poll(uuid), core.booking_disposition_candidates(integer),
--     core.booking_disposition_repair(uuid), core.booking_conversion_eligibility(uuid);
--   DROP TABLE core.booking_disposition_repair_log;
--   DROP POLICY worker_select_conversion ON core.payment_payment_operation_leg;
--   DROP POLICY worker_select_disposition ON core.payment_payment_operation_event;
--   REVOKE UPDATE (payment_attempts, payment_in_flight_until) ON core.booking_checkout_hold FROM app_worker;
--   REVOKE EXECUTE ON FUNCTION core.booking_vehicle_party(uuid), core.booking_occupied_period(…)
--     FROM app_worker (si accordés ici).

-- 1. Droits complémentaires des travailleurs de conversion (17 §2.3, une politique par travailleur) --
-- refus reçu (étape 3e) : compteur de refus et retour en ACTIVE (borne remise à NULL, trigger
-- hold_guarded_columns : seulement avec PAYMENT_IN_FLIGHT -> ACTIVE)
GRANT UPDATE (payment_attempts, payment_in_flight_until) ON core.booking_checkout_hold TO app_worker;
-- jambes de l'opération reçue (contrôle de la preuve, étape 4.2)
CREATE POLICY worker_select_conversion ON core.payment_payment_operation_leg FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper'));
-- instant où la réussite est connue (premier événement SUCCEEDED appliqué, C11 (iii))
CREATE POLICY worker_select_disposition ON core.payment_payment_operation_event FOR SELECT
  TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'disposition_sweeper');

-- Journal des essais de disposition_sweeper (17 §2.5 A6 : « compte ses essais par opération »)
CREATE TABLE core.booking_disposition_repair_log (
  operation_id    uuid        PRIMARY KEY
    CONSTRAINT disposition_repair_operation_fk REFERENCES core.payment_payment_operation (id),
  attempts        integer     NOT NULL
    CONSTRAINT disposition_repair_attempts_positive CHECK (attempts >= 1),
  first_failed_at timestamptz NOT NULL,
  last_attempt_at timestamptz NOT NULL,
  last_error      text        NOT NULL
    CONSTRAINT disposition_repair_error_format CHECK (last_error ~ '^[0-9A-Z]{5}(:[a-z0-9_]{1,63})?$'),
  alerted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT platform.now(),
  updated_at      timestamptz NOT NULL DEFAULT platform.now(),
  row_version     integer     NOT NULL DEFAULT 0
);

CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_disposition_repair_log
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

COMMENT ON TABLE core.booking_disposition_repair_log IS
  'Essais de disposition_sweeper par opération (17 §2.5 A6) : SQLSTATE et contrainte seulement, '
  'jamais un message PostgreSQL. US-024. Classe D.';

ALTER TABLE core.booking_disposition_repair_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_disposition_repair_log FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_disposition_repair_log TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.booking_disposition_repair_log FROM PUBLIC;
GRANT SELECT, INSERT ON core.booking_disposition_repair_log TO app_worker;
GRANT UPDATE (attempts, last_attempt_at, last_error, alerted_at)
  ON core.booking_disposition_repair_log TO app_worker;
CREATE POLICY worker_select ON core.booking_disposition_repair_log FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'disposition_sweeper');
CREATE POLICY worker_insert_sweeper ON core.booking_disposition_repair_log FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'disposition_sweeper');
CREATE POLICY worker_update_sweeper ON core.booking_disposition_repair_log FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'disposition_sweeper')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'disposition_sweeper');

-- 2. Éligibilité à la conversion (17 §2.5 étape 4, 2 bis (ii) et (iii)) --------------------------
-- SECURITY DEFINER sous cmd_hold_owner, qui lit déjà le compte d'hôte (statut, titulaire) et le
-- catalogue (core.booking_vehicle_party, fail-closed avant US-115). Réservée aux travailleurs de
-- conversion ; ne renvoie qu'un code, jamais une donnée du compte.
CREATE FUNCTION core.booking_conversion_eligibility(p_hold_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid;
  v_vehicle uuid;
  v_org     uuid;
  v_country text;
  v_holder  uuid;
  v_status  text;
  r_party   record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('booking_conversion', 'disposition_sweeper',
                                  'payment_intent_sweeper') THEN
    RAISE EXCEPTION 'conversion: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id, ch.org_id, ch.country_code
    INTO v_guest, v_vehicle, v_org, v_country
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id;
  IF v_guest IS NULL THEN
    RETURN 'UNKNOWN_HOLD';
  END IF;
  SELECT p.org_id, p.country_code INTO r_party FROM core.booking_vehicle_party(v_vehicle) AS p;
  IF r_party.org_id IS DISTINCT FROM v_org OR r_party.country_code IS DISTINCT FROM v_country THEN
    RETURN 'VEHICLE_NOT_LISTED';
  END IF;
  SELECT o.holder_user_id, o.status INTO v_holder, v_status
    FROM core.iam_organization o
   WHERE o.id = v_org AND o.country_code = v_country;
  IF v_status IS DISTINCT FROM 'ACTIVE' THEN
    RETURN 'HOST_NOT_ACTIVE';
  END IF;
  IF v_holder = v_guest THEN
    RETURN 'SELF_BOOKING';
  END IF;
  RETURN 'ELIGIBLE';
END
$fn$;

COMMENT ON FUNCTION core.booking_conversion_eligibility(uuid) IS
  'Éligibilité à la conversion (17 §2.5, 2 bis (ii) / (iii)) : ELIGIBLE ou un code de refus. '
  'Travailleurs de conversion seulement. US-024.';

REVOKE ALL ON FUNCTION core.booking_conversion_eligibility(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_conversion_eligibility(uuid) TO app_worker;
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
ALTER FUNCTION core.booking_conversion_eligibility(uuid) OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 3. Bloc C : compensation d'un paiement sans créneau (17 §2.5 étape 4 « bloc C », étape 5) -------
-- Même transaction que la décision : hold_compensation (OPEN), payment_disposition (COMPENSATION ;
-- clé primaire = invariant XOR), hold COMPENSATED (terminal ; inchangé s'il est déjà CONVERTED ou
-- COMPENSATED), occupation HOLD inactive (HOLD_COMPENSATED ; une ligne TRIP n'est jamais touchée),
-- événements booking.hold.compensated et booking.hold.compensation_required (le remboursement,
-- refund_instance et sa commande, est créé par leur consommateur : US-223). Action par capacité
-- VALIDÉE du PSP et du moyen de l'opération (fail-closed) : autorisation seule ⇒ VOID si
-- SUPPORTS_VOID, sinon LET_EXPIRE ; débit capturé ⇒ REFUND_API si SUPPORTS_REFUND, sinon
-- BANK_TRANSFER_REFUND (virement ordonné par Kmino et exécuté par le PSP, SM-8). Aucun trip, aucun
-- règlement, aucune part de l'hôte. INVARIANT_VIOLATION : alerte P1 en plus.
CREATE FUNCTION core.booking_open_compensation(p_hold_id uuid, p_operation_id uuid, p_reason text)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_comp    uuid := pg_catalog.gen_random_uuid();
  v_now     timestamptz := platform.now();
  v_action  text;
  v_updated integer;
  r_op      record;
  r_hold    record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('booking_conversion', 'disposition_sweeper',
                                  'payment_intent_sweeper') THEN
    RAISE EXCEPTION 'conversion: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  SELECT op.kind, op.provider, op.method, op.country_code, op.amount_minor, op.currency
    INTO r_op
    FROM core.payment_payment_operation op
   WHERE op.id = p_operation_id AND op.hold_id = p_hold_id;
  SELECT ch.occupancy_id, ch.vehicle_id, ch.org_id, ch.country_code INTO r_hold
    FROM core.booking_checkout_hold ch WHERE ch.id = p_hold_id;
  IF r_op.kind IS NULL OR r_hold.occupancy_id IS NULL THEN
    RAISE EXCEPTION 'conversion: operation not of this hold'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'disposition_rent_payment_only';
  END IF;

  IF r_op.kind = 'AUTH' THEN
    v_action := CASE WHEN core.payment_capability_bool(r_op.provider, r_op.country_code, r_op.method,
                                                       'SUPPORTS_VOID')
                     THEN 'VOID' ELSE 'LET_EXPIRE' END;
  ELSE
    v_action := CASE WHEN core.payment_capability_bool(r_op.provider, r_op.country_code, r_op.method,
                                                       'SUPPORTS_REFUND')
                     THEN 'REFUND_API' ELSE 'BANK_TRANSFER_REFUND' END;
  END IF;

  INSERT INTO core.booking_hold_compensation (id, hold_id, reason, operation_id, action, status)
  VALUES (v_comp, p_hold_id, p_reason, p_operation_id, v_action, 'OPEN');
  INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, hold_compensation_id)
  VALUES (p_operation_id, p_hold_id, 'COMPENSATION', v_comp);
  UPDATE core.booking_checkout_hold
     SET status = 'COMPENSATED', compensated_at = v_now
   WHERE id = p_hold_id AND status NOT IN ('CONVERTED', 'COMPENSATED');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  UPDATE core.booking_vehicle_occupancy
     SET active = false, deactivated_reason = 'HOLD_COMPENSATED'
   WHERE id = r_hold.occupancy_id AND kind = 'HOLD';

  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.hold.compensated', 1, 'checkout_hold', p_hold_id, 3, r_hold.country_code,
          'SYSTEM', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'operation_id', p_operation_id,
                                        'hold_compensation_id', v_comp, 'reason', p_reason,
                                        'action', v_action, 'vehicle_id', r_hold.vehicle_id,
                                        'org_id', r_hold.org_id),
          p_hold_id::text),
         ('booking.hold.compensation_required', 1, 'checkout_hold', p_hold_id, 3,
          r_hold.country_code, 'SYSTEM', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'operation_id', p_operation_id,
                                        'hold_compensation_id', v_comp, 'reason', p_reason,
                                        'action', v_action,
                                        'amount_minor', r_op.amount_minor::text,
                                        'currency', r_op.currency),
          p_hold_id::text);
  IF p_reason = 'INVARIANT_VIOLATION' THEN
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_role, correlation_id, payload, partition_key)
    VALUES ('booking.alert.invariant_violation', 1, 'checkout_hold', p_hold_id, 3,
            r_hold.country_code, 'SYSTEM', pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'operation_id', p_operation_id,
                                          'severity', 'P1'),
            p_hold_id::text);
  END IF;
  RETURN pg_catalog.jsonb_build_object('outcome', 'COMPENSATED', 'reason', p_reason,
                                       'compensationId', v_comp, 'action', v_action,
                                       'holdUpdated', v_updated = 1);
END
$fn$;

COMMENT ON FUNCTION core.booking_open_compensation(uuid, uuid, text) IS
  'Bloc C (17 §2.5) : compensation, disposition COMPENSATION, hold COMPENSATED, action par capacité '
  'validée (étape 5). Travailleurs de conversion. US-024.';

-- 4. Conversion atomique et gardée (17 §2.5 étape 4, esquisse SQL) --------------------------------
-- Résultats (jsonb) : NOT_APPLICABLE (pas un paiement de loyer d'un hold), NOT_SUCCEEDED (aucune
-- preuve), REPLAY (opération déjà disposée : résultat déjà décidé ; une preuve tardive d'une
-- opération déjà compensée est journalisée booking.payment.late_ignored), CONVERTED (trip BOOKED,
-- reacquired si le hold était EXPIRED / RELEASED), COMPENSATED (motif). Erreur
-- conversion_review_pending (55000) : hold de revue sans reviewed_at, impossible par T1 ; aucune
-- disposition, disposition_sweeper alerte.
CREATE FUNCTION core.booking_convert_payment(p_operation_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest      uuid;
  v_vehicle    uuid;
  v_now        timestamptz;
  v_tolerance  integer;
  v_grace      integer;
  v_reason     text;
  v_late       boolean;
  v_trip       uuid := pg_catalog.gen_random_uuid();
  v_try        integer := 0;
  v_conflict   boolean;
  v_constraint text;
  v_legs_ok    boolean;
  v_foreign    boolean;
  v_same_paid  boolean;
  v_unpaid     uuid[];
  v_h2         uuid;
  n            integer;
  r_op         record;
  r_disp       record;
  r_hold       record;
  r_terms      record;
  r_occ        record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('booking_conversion', 'disposition_sweeper',
                                  'payment_intent_sweeper') THEN
    RAISE EXCEPTION 'conversion: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  SELECT op.hold_id, op.status, op.purpose, op.kind, op.amount_minor, op.currency,
         op.country_code
    INTO r_op
    FROM core.payment_payment_operation op
   WHERE op.id = p_operation_id;
  IF NOT FOUND OR r_op.hold_id IS NULL OR r_op.purpose <> 'RENT'
     OR r_op.kind NOT IN ('AUTH', 'CAPTURE') THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_APPLICABLE');
  END IF;
  IF r_op.status <> 'SUCCEEDED' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_SUCCEEDED', 'status', r_op.status);
  END IF;
  -- voyageur et véhicule : colonnes gardées, jamais modifiées (lues avant les verrous)
  SELECT ch.guest_user_id, ch.vehicle_id INTO v_guest, v_vehicle
    FROM core.booking_checkout_hold ch WHERE ch.id = r_op.hold_id;
  IF v_guest IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_APPLICABLE');
  END IF;

  -- 0. verrous voyageur puis véhicule (ordre global, VERIF_16-M2) ; rejeu exact
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  SELECT d.disposition, d.trip_id, d.hold_compensation_id INTO r_disp
    FROM core.booking_payment_disposition d WHERE d.operation_id = p_operation_id;
  IF FOUND THEN
    IF r_disp.disposition = 'COMPENSATION' THEN
      -- preuve tardive d'une opération déjà compensée (C13, E2) : journalisée, ignorée
      INSERT INTO core.outbox_outbox_event
             (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_role, correlation_id, payload, partition_key)
      VALUES ('booking.payment.late_ignored', 1, 'checkout_hold', r_op.hold_id, 4, r_op.country_code,
              'SYSTEM', pg_catalog.gen_random_uuid(),
              pg_catalog.jsonb_build_object('hold_id', r_op.hold_id, 'operation_id', p_operation_id,
                                            'hold_compensation_id', r_disp.hold_compensation_id),
              r_op.hold_id::text);
    END IF;
    RETURN pg_catalog.jsonb_build_object('outcome', 'REPLAY', 'disposition', r_disp.disposition,
                                         'tripId', r_disp.trip_id,
                                         'compensationId', r_disp.hold_compensation_id);
  END IF;

  -- 1. verrou de ligne du hold, SANS prédicat de statut (la tâche d'expiration le saute)
  SELECT ch.id, ch.status, ch.occupancy_id, ch.org_id, ch.country_code, ch.review_required,
         ch.reviewed_at
    INTO r_hold
    FROM core.booking_checkout_hold ch
   WHERE ch.id = r_op.hold_id
     FOR UPDATE;
  IF r_hold.status = 'CONVERTED' THEN
    -- autre opération que celle qui a converti (sinon REPLAY) : jamais un second rattachement
    RETURN core.booking_open_compensation(r_hold.id, p_operation_id, 'DUPLICATE_PAYMENT');
  ELSIF r_hold.status = 'COMPENSATED' THEN
    -- jamais de trip, même si le créneau est redevenu libre (VERIF_16-N1)
    RETURN core.booking_open_compensation(r_hold.id, p_operation_id,
                                          'LATE_PAYMENT_AFTER_COMPENSATION');
  END IF;
  IF r_hold.review_required AND r_hold.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'conversion: review pending'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'conversion_review_pending';
  END IF;

  -- 2. preuve contre le devis accepté ; 2 bis : début, catalogue, hôte, voyageur
  v_tolerance := core.booking_param_int('conversion_start_tolerance_minutes', r_hold.country_code);
  v_grace     := core.booking_param_int('sweep_grace_s', r_hold.country_code);
  IF v_tolerance IS NULL OR v_grace IS NULL THEN
    RAISE EXCEPTION 'conversion: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  v_now := platform.now();
  SELECT t.amount_minor, t.currency, t.legs, t.scheduled_start, t.scheduled_end, t.timezone
    INTO r_terms
    FROM core.booking_hold_payment_terms(r_hold.id) AS t;
  SELECT pg_catalog.lower(vo.period) AS lo, pg_catalog.upper(vo.period) AS hi INTO r_occ
    FROM core.booking_vehicle_occupancy vo WHERE vo.id = r_hold.occupancy_id;
  SELECT pg_catalog.count(*) = 4
         AND pg_catalog.bool_and(CASE WHEN (r_terms.legs ->> l.leg) ~ '^[0-9]{1,18}$'
                                      THEN l.amount_minor = (r_terms.legs ->> l.leg)::bigint
                                      ELSE false END)
         AND CASE WHEN pg_catalog.jsonb_typeof(r_terms.legs) = 'object'
                  THEN (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(r_terms.legs)) = 4
                  ELSE false END
    INTO v_legs_ok
    FROM core.payment_payment_operation_leg l
   WHERE l.operation_id = p_operation_id;
  IF r_terms.amount_minor IS NULL OR r_terms.timezone IS NULL
     OR r_op.country_code IS DISTINCT FROM r_hold.country_code
     OR r_op.amount_minor IS DISTINCT FROM r_terms.amount_minor
     OR r_op.currency IS DISTINCT FROM r_terms.currency
     OR v_legs_ok IS NOT TRUE
     OR r_terms.scheduled_start IS DISTINCT FROM r_occ.lo
     OR r_terms.scheduled_end IS NULL OR r_terms.scheduled_end <= r_terms.scheduled_start
     OR r_terms.scheduled_end > r_occ.hi THEN
    v_reason := 'ELIGIBILITY_CHANGED';                -- devis invalidé ou preuve ≠ devis (iv)
  ELSIF r_terms.scheduled_start < v_now - pg_catalog.make_interval(mins => v_tolerance) THEN
    v_reason := 'START_PASSED';                       -- (i) : jamais un trip après son début
  ELSIF core.booking_conversion_eligibility(r_hold.id) <> 'ELIGIBLE' THEN
    v_reason := 'ELIGIBILITY_CHANGED';                -- (ii), (iii)
  END IF;
  IF v_reason IS NOT NULL THEN
    RETURN core.booking_open_compensation(r_hold.id, p_operation_id, v_reason);
  END IF;

  -- 3. conversion (ACTIVE, PAYMENT_IN_FLIGHT : même si expires_at est dépassé) ou ré-acquisition
  --    sous la contrainte (EXPIRED, RELEASED) ; d'abord l'expiration ciblée 2a, partie véhicule,
  --    sous le verrou du véhicule déjà tenu (VERIF_17 T3, C4 bis)
  v_late := r_hold.status IN ('EXPIRED', 'RELEASED');
  IF v_late THEN
    -- 2a : texte EXPIRY_2A_SQL de test/support/expiry-2a.ts, partie véhicule seule
    WITH t AS (SELECT platform.now() AS ts),
       due AS (
         SELECT h.id, h.occupancy_id
           FROM core.booking_checkout_hold h, t
          WHERE (h.vehicle_id = v_vehicle OR h.guest_user_id = NULL::uuid)
            AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
            AND h.expires_at <= t.ts
            AND (h.payment_in_flight_until IS NULL OR h.payment_in_flight_until <= t.ts)
            AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation o
                             WHERE o.hold_id = h.id AND o.purpose = 'RENT'
                               AND ( ( o.status IN ('PENDING','SUBMITTED','UNKNOWN')
                                       AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
                                       AND t.ts < h.payment_in_flight_until + make_interval(secs => v_grace) )
                                  OR ( o.status = 'SUCCEEDED'
                                       AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                                        WHERE d.operation_id = o.id) ) ))
          FOR UPDATE OF h SKIP LOCKED
       ), expired AS (
         UPDATE core.booking_checkout_hold SET status = 'EXPIRED', expired_at = (SELECT ts FROM t)
          WHERE id IN (SELECT id FROM due)
         RETURNING occupancy_id
       )
       UPDATE core.booking_vehicle_occupancy
          SET active = false, deactivated_reason = 'HOLD_EXPIRED'
        WHERE id IN (SELECT occupancy_id FROM expired)
          AND kind = 'HOLD';
  END IF;

  LOOP
    v_try := v_try + 1;
    v_conflict := false;
    -- bloc = SAVEPOINT reacquire : toute erreur annule l'occupation, le trip et la disposition
    BEGIN
      UPDATE core.booking_vehicle_occupancy
         SET kind = 'TRIP', active = true, expires_at = NULL, deactivated_reason = NULL,
             ref_type = 'TRIP', ref_id = v_trip
       WHERE id = r_hold.occupancy_id AND kind = 'HOLD';
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 1 THEN
        v_reason := 'INVARIANT_VIOLATION';            -- occupation absente ou déjà TRIP
      ELSE
        -- 4. trip BOOKED (SM-1 HOLD -> BOOKED), occupation du voyageur (sans tampon)
        INSERT INTO core.booking_trip
               (id, guest_user_id, org_id, vehicle_id, country_code, currency, timezone,
                scheduled_start, scheduled_end, status, source_hold_id)
        VALUES (v_trip, v_guest, r_hold.org_id, v_vehicle, r_hold.country_code, r_op.currency,
                r_terms.timezone, r_terms.scheduled_start, r_terms.scheduled_end, 'BOOKED',
                r_hold.id);
        INSERT INTO core.booking_guest_occupancy (id, guest_user_id, period, active, trip_id)
        VALUES (pg_catalog.gen_random_uuid(), v_guest,
                pg_catalog.tstzrange(r_terms.scheduled_start, r_terms.scheduled_end, '[)'), true,
                v_trip);
        -- 5. disposition CONVERSION (PK : XOR) puis hold CONVERTED
        INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, trip_id)
        VALUES (p_operation_id, r_hold.id, 'CONVERSION', v_trip);
        UPDATE core.booking_checkout_hold
           SET status = 'CONVERTED', converted_trip_id = v_trip,
               conversion_operation_id = p_operation_id
         WHERE id = r_hold.id;
        INSERT INTO core.outbox_outbox_event
               (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
                actor_role, correlation_id, payload, partition_key)
        SELECT e.type, 1, e.agg_type, e.agg_id, e.version, r_hold.country_code, 'SYSTEM',
               pg_catalog.gen_random_uuid(), e.payload, e.partition
          FROM (VALUES
                  ('booking.hold.converted', 'checkout_hold', r_hold.id, 3,
                   pg_catalog.jsonb_build_object('hold_id', r_hold.id, 'trip_id', v_trip,
                                                 'operation_id', p_operation_id,
                                                 'reacquired', v_late),
                   r_hold.id::text),
                  ('booking.trip.booked', 'trip', v_trip, 0,
                   pg_catalog.jsonb_build_object('trip_id', v_trip, 'hold_id', r_hold.id,
                                                 'vehicle_id', v_vehicle, 'org_id', r_hold.org_id,
                                                 'scheduled_start', r_terms.scheduled_start,
                                                 'scheduled_end', r_terms.scheduled_end),
                   v_trip::text),
                  ('booking.hold.reacquired', 'checkout_hold', r_hold.id, 3,
                   pg_catalog.jsonb_build_object('hold_id', r_hold.id, 'trip_id', v_trip,
                                                 'previous_status', r_hold.status),
                   r_hold.id::text))
               AS e(type, agg_type, agg_id, version, payload, partition)
         WHERE e.type <> 'booking.hold.reacquired' OR v_late;
      END IF;
    EXCEPTION WHEN exclusion_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'guest_no_overlap' THEN
        v_reason := 'GUEST_OVERLAP';                  -- le voyageur a déjà un trip sur ces dates
      ELSIF v_constraint = 'vehicle_occupancy_no_overlap' THEN
        v_conflict := true;
      ELSE
        RAISE;
      END IF;
    END;

    IF v_reason IS NOT NULL THEN
      RETURN core.booking_open_compensation(r_hold.id, p_operation_id, v_reason);
    END IF;
    IF NOT v_conflict THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'CONVERTED', 'tripId', v_trip,
                                           'reacquired', v_late);
    END IF;
    IF NOT v_late OR v_try > 1 THEN
      RETURN core.booking_open_compensation(
        r_hold.id, p_operation_id,
        CASE WHEN NOT v_late THEN 'INVARIANT_VIOLATION'
             WHEN r_hold.status = 'RELEASED' THEN 'SLOT_LOST_AFTER_RELEASE'
             ELSE 'SLOT_LOST_AFTER_EXPIRY' END);
    END IF;

    -- Résolution selon l'occupation en conflit (VERIF_17-A4), lue sous le verrou du véhicule :
    --   autre voyageur, blocage, tampon, trip d'un tiers ⇒ SLOT_LOST_* ;
    --   hold du même voyageur déjà payé, ou trip du même voyageur ⇒ DUPLICATE_PAYMENT ;
    --   seulement des holds vivants NON payés du même voyageur ⇒ supplantés (RELEASED,
    --   SUPERSEDED_BY_PAID_HOLD, CANCEL_ORDER de leurs ordres vivants), puis UNE nouvelle tentative.
    --   « Priorité au payeur » (reacquire_preempts_unpaid_hold, M13) : non retenue, non construite.
    SELECT COALESCE(pg_catalog.bool_or(c.cls = 'FOREIGN'), false),
           COALESCE(pg_catalog.bool_or(c.cls = 'SAME_PAID'), false),
           pg_catalog.array_agg(c.hold_id) FILTER (WHERE c.cls = 'SAME_UNPAID')
      INTO v_foreign, v_same_paid, v_unpaid
      FROM (SELECT vo.id,
                   CASE
                     WHEN vo.kind = 'HOLD' AND h2.guest_user_id = v_guest
                          AND h2.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
                          AND EXISTS (SELECT 1 FROM core.payment_payment_operation o2
                                       WHERE o2.hold_id = h2.id AND o2.purpose = 'RENT'
                                         AND o2.status = 'SUCCEEDED')
                       THEN 'SAME_PAID'
                     WHEN vo.kind = 'HOLD' AND h2.guest_user_id = v_guest
                          AND h2.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
                       THEN 'SAME_UNPAID'
                     WHEN vo.kind = 'TRIP' AND tr.guest_user_id = v_guest
                       THEN 'SAME_PAID'
                     ELSE 'FOREIGN'
                   END AS cls,
                   h2.id AS hold_id
              FROM core.booking_vehicle_occupancy vo
              LEFT JOIN core.booking_checkout_hold h2
                     ON vo.kind = 'HOLD' AND h2.occupancy_id = vo.id
              LEFT JOIN core.booking_trip tr
                     ON vo.kind = 'TRIP' AND tr.id = vo.ref_id
             WHERE vo.vehicle_id = v_vehicle AND vo.active AND vo.id <> r_hold.occupancy_id
               AND vo.period && (SELECT o.period FROM core.booking_vehicle_occupancy o
                                  WHERE o.id = r_hold.occupancy_id)) AS c;

    IF v_foreign OR (NOT v_same_paid AND v_unpaid IS NULL) THEN
      RETURN core.booking_open_compensation(
        r_hold.id, p_operation_id,
        CASE WHEN r_hold.status = 'RELEASED' THEN 'SLOT_LOST_AFTER_RELEASE'
             ELSE 'SLOT_LOST_AFTER_EXPIRY' END);
    END IF;
    IF v_same_paid THEN
      RETURN core.booking_open_compensation(r_hold.id, p_operation_id, 'DUPLICATE_PAYMENT');
    END IF;

    FOREACH v_h2 IN ARRAY v_unpaid LOOP
      WITH released AS (
        UPDATE core.booking_checkout_hold
           SET status = 'RELEASED', released_at = v_now, release_reason = 'SUPERSEDED_BY_PAID_HOLD'
         WHERE id = v_h2 AND status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
        RETURNING id, occupancy_id, vehicle_id, org_id, country_code
      ), occupancy AS (
        UPDATE core.booking_vehicle_occupancy vo
           SET active = false, deactivated_reason = 'HOLD_RELEASED'
          FROM released
         WHERE vo.id = released.occupancy_id AND vo.kind = 'HOLD' AND vo.active
      )
      INSERT INTO core.outbox_outbox_event
             (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_role, correlation_id, payload, partition_key)
      SELECT 'booking.hold.released', 1, 'checkout_hold', released.id, 2, released.country_code,
             'SYSTEM', pg_catalog.gen_random_uuid(),
             pg_catalog.jsonb_build_object('hold_id', released.id, 'vehicle_id', released.vehicle_id,
                                           'org_id', released.org_id,
                                           'reason', 'SUPERSEDED_BY_PAID_HOLD',
                                           'superseded_by', r_hold.id),
             released.id::text
        FROM released;
      -- ordres vivants de H2 : annulation par la boîte d'envoi si la capacité est validée
      INSERT INTO core.payment_payment_command
             (id, operation_kind, idem_plain, operation_id, hold_id, country_code, partition_key)
      SELECT pg_catalog.gen_random_uuid(), 'CANCEL_ORDER',
             'hold:' || v_h2::text || ':CANCEL:' || o.id::text || ':a1',
             o.id, v_h2, o.country_code, v_h2::text
        FROM core.payment_payment_operation o
       WHERE o.hold_id = v_h2 AND o.purpose = 'RENT'
         AND o.status IN ('PENDING', 'SUBMITTED', 'UNKNOWN')
         AND o.provider_reference IS NOT NULL
         AND core.payment_capability_bool(o.provider, o.country_code, o.method,
                                          'SUPPORTS_ORDER_CANCEL')
      ON CONFLICT ON CONSTRAINT payment_command_idem_unique DO NOTHING;
    END LOOP;
  END LOOP;
END
$fn$;

COMMENT ON FUNCTION core.booking_convert_payment(uuid) IS
  'Conversion atomique et gardée (17 §2.5 étape 4) : trip BOOKED ou compensation, jamais les deux. '
  'Travailleurs booking_conversion, disposition_sweeper, payment_intent_sweeper. US-024.';

-- 5. Refus REÇU (17 §2.5 étape 3e, VERIF_16-M5) ---------------------------------------------------
-- Opération de loyer FAILED de la tentative en cours : un refus reçu ne débite rien. Le hold revient
-- ACTIVE (borne remise à NULL) si expires_at n'est pas dépassé et qu'il reste une tentative
-- (payment_attempts_per_hold) ; sinon RELEASED (PAYMENT_DECLINED), occupation libérée. Rien n'est
-- fait tant qu'une autre opération du hold peut encore être payée ou attend sa disposition.
CREATE FUNCTION core.booking_record_payment_failure(p_operation_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid;
  v_vehicle uuid;
  v_max     integer;
  v_now     timestamptz;
  r_op      record;
  r_hold    record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('booking_conversion', 'disposition_sweeper',
                                  'payment_intent_sweeper') THEN
    RAISE EXCEPTION 'conversion: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  SELECT op.hold_id, op.status, op.purpose, op.kind, op.attempt_no INTO r_op
    FROM core.payment_payment_operation op WHERE op.id = p_operation_id;
  IF NOT FOUND OR r_op.hold_id IS NULL OR r_op.purpose <> 'RENT'
     OR r_op.kind NOT IN ('AUTH', 'CAPTURE') OR r_op.status <> 'FAILED' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOOP');
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id INTO v_guest, v_vehicle
    FROM core.booking_checkout_hold ch WHERE ch.id = r_op.hold_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  SELECT ch.id, ch.status, ch.payment_attempts, ch.expires_at, ch.occupancy_id, ch.org_id,
         ch.country_code
    INTO r_hold
    FROM core.booking_checkout_hold ch WHERE ch.id = r_op.hold_id FOR UPDATE;
  IF r_hold.status <> 'PAYMENT_IN_FLIGHT' OR r_op.attempt_no <> r_hold.payment_attempts + 1 THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOOP');   -- refus déjà traité ou périmé
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation o
              WHERE o.hold_id = r_hold.id AND o.purpose = 'RENT' AND o.id <> p_operation_id
                AND ( o.status IN ('PENDING', 'SUBMITTED', 'UNKNOWN')
                   OR ( o.status = 'SUCCEEDED'
                        AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                         WHERE d.operation_id = o.id) ) )) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'WAITING');
  END IF;
  v_max := core.booking_param_int('payment_attempts_per_hold', r_hold.country_code);
  IF v_max IS NULL THEN
    RAISE EXCEPTION 'conversion: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  v_now := platform.now();
  IF r_hold.expires_at > v_now AND r_hold.payment_attempts + 1 < v_max THEN
    UPDATE core.booking_checkout_hold
       SET status = 'ACTIVE', payment_in_flight_until = NULL,
           payment_attempts = payment_attempts + 1
     WHERE id = r_hold.id;
    RETURN pg_catalog.jsonb_build_object('outcome', 'RETRY_ALLOWED',
                                         'paymentAttempts', r_hold.payment_attempts + 1);
  END IF;
  UPDATE core.booking_checkout_hold
     SET status = 'RELEASED', released_at = v_now, release_reason = 'PAYMENT_DECLINED',
         payment_attempts = payment_attempts + 1
   WHERE id = r_hold.id;
  UPDATE core.booking_vehicle_occupancy
     SET active = false, deactivated_reason = 'HOLD_RELEASED'
   WHERE id = r_hold.occupancy_id AND kind = 'HOLD' AND active;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.hold.released', 1, 'checkout_hold', r_hold.id, 2, r_hold.country_code, 'SYSTEM',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', r_hold.id, 'vehicle_id', v_vehicle,
                                        'org_id', r_hold.org_id, 'reason', 'PAYMENT_DECLINED'),
          r_hold.id::text);
  RETURN pg_catalog.jsonb_build_object('outcome', 'RELEASED',
                                       'paymentAttempts', r_hold.payment_attempts + 1);
END
$fn$;

COMMENT ON FUNCTION core.booking_record_payment_failure(uuid) IS
  'Refus reçu (17 §2.5 étape 3e) : retour en ACTIVE ou RELEASED (PAYMENT_DECLINED). US-024.';

-- 6. payment_intent_sweeper (17 §2.5 étape 3d, VERIF_17-A3) ---------------------------------------
-- Ordres à lire : opérations de loyer non terminales d'un hold en vol, dès borne − sweep_lead_s,
-- tant qu'aucune lecture n'a eu lieu à ou après la borne. Le travailleur lit le PSP (getOperation,
-- hors transaction), applique le statut (core.payment_cmd_apply_operation_status, travailleur de
-- commandes), puis appelle core.booking_record_poll.
CREATE FUNCTION core.booking_intents_due(p_limit integer)
  RETURNS TABLE (operation_id       uuid,
                 hold_id            uuid,
                 provider           text,
                 method             text,
                 country_code       text,
                 psp_account_id     uuid,
                 idem_sent          text,
                 provider_reference text,
                 status             text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_intent_sweeper' THEN
    RAISE EXCEPTION 'sweeper: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'sweeper: batch size out of bounds' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT o.id, o.hold_id, o.provider, o.method, o.country_code, o.psp_account_id, o.idem_sent,
           o.provider_reference, o.status
      FROM core.booking_checkout_hold h
      JOIN core.payment_payment_operation o
        ON o.hold_id = h.id AND o.purpose = 'RENT'
       AND o.status IN ('PENDING', 'SUBMITTED', 'UNKNOWN')
     CROSS JOIN LATERAL (SELECT core.booking_param_int('sweep_lead_s', h.country_code) AS lead) p
     WHERE h.status = 'PAYMENT_IN_FLIGHT'
       AND p.lead IS NOT NULL
       AND platform.now() >= h.payment_in_flight_until - pg_catalog.make_interval(secs => p.lead)
       AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
     ORDER BY h.payment_in_flight_until, o.id
     LIMIT p_limit;
END
$fn$;

-- Lecture faite : last_polled_at et décision dans la MÊME transaction, sous les verrous voyageur →
-- véhicule → hold (17 §2.5 étape 3d (iii)) : une réponse « payé » est convertie avant toute
-- libération ; « refusé » suit l'étape 3e ; sinon (UNKNOWN, SUBMITTED) seule la lecture est notée.
CREATE FUNCTION core.booking_record_poll(p_operation_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid;
  v_vehicle uuid;
  r_op      record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_intent_sweeper' THEN
    RAISE EXCEPTION 'sweeper: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  SELECT op.hold_id, op.status, op.purpose INTO r_op
    FROM core.payment_payment_operation op WHERE op.id = p_operation_id;
  IF NOT FOUND OR r_op.hold_id IS NULL OR r_op.purpose <> 'RENT' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_APPLICABLE');
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id INTO v_guest, v_vehicle
    FROM core.booking_checkout_hold ch WHERE ch.id = r_op.hold_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  PERFORM 1 FROM core.booking_checkout_hold ch WHERE ch.id = r_op.hold_id FOR UPDATE;
  UPDATE core.booking_checkout_hold
     SET last_polled_at = platform.now()
   WHERE id = r_op.hold_id AND status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT');
  IF r_op.status = 'SUCCEEDED' THEN
    RETURN core.booking_convert_payment(p_operation_id);
  ELSIF r_op.status = 'FAILED' THEN
    RETURN core.booking_record_payment_failure(p_operation_id);
  END IF;
  RETURN pg_catalog.jsonb_build_object('outcome', 'POLLED', 'status', r_op.status);
END
$fn$;

COMMENT ON FUNCTION core.booking_intents_due(integer) IS
  'payment_intent_sweeper (17 §2.5 étape 3d) : ordres à lire dès borne − sweep_lead_s. US-024.';
COMMENT ON FUNCTION core.booking_record_poll(uuid) IS
  'payment_intent_sweeper : last_polled_at et décision (conversion, refus) sous les verrous. US-024.';

-- 7. disposition_sweeper (17 §2.5 A6, C17) --------------------------------------------------------
-- Instant où la réussite est connue : premier payment_operation_event SUCCEEDED appliqué (C11 (iii)),
-- à défaut la dernière mise à jour de l'opération.
CREATE FUNCTION core.booking_disposition_candidates(p_limit integer)
  RETURNS TABLE (operation_id uuid, success_known_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'disposition_sweeper' THEN
    RAISE EXCEPTION 'sweeper: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'sweeper: batch size out of bounds' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT o.id, k.at
      FROM core.payment_payment_operation o
     CROSS JOIN LATERAL (
       SELECT COALESCE((SELECT pg_catalog.min(e.at) FROM core.payment_payment_operation_event e
                         WHERE e.operation_id = o.id AND e.status = 'SUCCEEDED'
                           AND e.outcome = 'APPLIED'),
                       o.updated_at) AS at) k
     CROSS JOIN LATERAL (
       SELECT core.booking_param_int('disposition_repair_after_minutes', o.country_code) AS m) p
     WHERE o.purpose = 'RENT' AND o.kind IN ('AUTH', 'CAPTURE') AND o.status = 'SUCCEEDED'
       AND o.hold_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d WHERE d.operation_id = o.id)
       AND p.m IS NOT NULL
       AND k.at <= platform.now() - pg_catalog.make_interval(mins => p.m)
     ORDER BY k.at, o.id
     LIMIT p_limit;
END
$fn$;

-- Une opération par transaction (même ordre de verrous que la conversion) : étape 4 rejouée dans un
-- bloc (SAVEPOINT) ; un échec est compté (SQLSTATE et contrainte seulement) et, à
-- disposition_alert_minutes depuis la réussite, une alerte P1 part une fois.
CREATE FUNCTION core.booking_disposition_repair(p_operation_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_result     jsonb;
  v_state      text;
  v_constraint text;
  v_error      text;
  v_now        timestamptz;
  v_known      timestamptz;
  v_alert      integer;
  v_country    text;
  v_alerted    boolean := false;
  r_log        record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'disposition_sweeper' THEN
    RAISE EXCEPTION 'sweeper: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  BEGIN
    v_result := core.booking_convert_payment(p_operation_id);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
    v_error := v_state || CASE WHEN v_constraint ~ '^[a-z0-9_]{1,63}$' THEN ':' || v_constraint
                               ELSE '' END;
  END;
  IF v_error IS NULL THEN
    RETURN v_result;
  END IF;

  v_now := platform.now();
  SELECT o.country_code,
         COALESCE((SELECT pg_catalog.min(e.at) FROM core.payment_payment_operation_event e
                    WHERE e.operation_id = o.id AND e.status = 'SUCCEEDED' AND e.outcome = 'APPLIED'),
                  o.updated_at)
    INTO v_country, v_known
    FROM core.payment_payment_operation o WHERE o.id = p_operation_id;
  INSERT INTO core.booking_disposition_repair_log AS r
         (operation_id, attempts, first_failed_at, last_attempt_at, last_error)
  VALUES (p_operation_id, 1, v_now, v_now, v_error)
  ON CONFLICT (operation_id) DO UPDATE
     SET attempts = r.attempts + 1, last_attempt_at = EXCLUDED.last_attempt_at,
         last_error = EXCLUDED.last_error
  RETURNING r.attempts, r.alerted_at INTO r_log;

  v_alert := core.booking_param_int('disposition_alert_minutes', v_country);
  -- paramètre absent : alerte immédiate (fail-closed)
  IF r_log.alerted_at IS NULL
     AND (v_alert IS NULL OR v_known IS NULL
          OR v_now >= v_known + pg_catalog.make_interval(mins => v_alert)) THEN
    UPDATE core.booking_disposition_repair_log SET alerted_at = v_now
     WHERE operation_id = p_operation_id;
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_role, correlation_id, payload, partition_key)
    VALUES ('booking.payment.disposition_overdue', 1, 'payment_operation', p_operation_id, 0,
            v_country, 'SYSTEM', pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('operation_id', p_operation_id, 'severity', 'P1',
                                          'attempts', r_log.attempts, 'last_error', v_error,
                                          'success_known_at', v_known),
            p_operation_id::text);
    v_alerted := true;
  END IF;
  RETURN pg_catalog.jsonb_build_object('outcome', 'FAILED', 'error', v_error,
                                       'attempts', r_log.attempts, 'alerted', v_alerted);
END
$fn$;

COMMENT ON FUNCTION core.booking_disposition_candidates(integer) IS
  'disposition_sweeper (17 §2.5 A6) : opérations SUCCEEDED sans disposition depuis '
  'disposition_repair_after_minutes. US-024.';
COMMENT ON FUNCTION core.booking_disposition_repair(uuid) IS
  'disposition_sweeper : étape 4 rejouée, échecs comptés, alerte P1 à disposition_alert_minutes. '
  'US-024.';

REVOKE ALL ON FUNCTION core.booking_open_compensation(uuid, uuid, text),
  core.booking_convert_payment(uuid), core.booking_record_payment_failure(uuid),
  core.booking_intents_due(integer), core.booking_record_poll(uuid),
  core.booking_disposition_candidates(integer), core.booking_disposition_repair(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_open_compensation(uuid, uuid, text),
  core.booking_convert_payment(uuid), core.booking_record_payment_failure(uuid),
  core.booking_intents_due(integer), core.booking_record_poll(uuid),
  core.booking_disposition_candidates(integer), core.booking_disposition_repair(uuid) TO app_worker;
