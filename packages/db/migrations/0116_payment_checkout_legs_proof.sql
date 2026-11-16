-- 0116 — PAY / AVL / PRC / STL : paiement par jambes au checkout, Kmino marchand de référence,
-- preuve par webhook (partie serveur 223a).
-- US-223 ; 19 US-223 ; 16 PAY-034, PAY-002, PAY-006 ; 08 E7 (règles 1, 2, 5, 10), BR-PAY-01,
-- BR-BOOK-10, BR-TRUST-02, TJ01, TJ08a, TJ09a, TJ09c, TJ10a ; 17 §2.5 (étapes 3 à 7, C6, C8, C14,
-- C20), §2.8 (capacités, fail-closed), §2.9, §3.2.5, §3.2.7, §4.4 (points 2 à 8) ; ADR-059,
-- ADR-065, ADR-088 (décision 9, « Limites »), ADR-090, ADR-133 ; ADR-139 (cette migration).
-- Suites fermées : S-02 (RC-5 pour POLL et API_RESPONSE, rattachement par une référence fournie par
-- l'appelant, horodatage signé NULL), N-157 (lien hold → devis par booking_checkout_acceptance),
-- N-160 (un devis, un hold, un trip), N-161 (seules les colonnes rejouées par la base sont lues),
-- N-18 (traduction de payment_operation_leg_pkey, côté src/errors.ts). Appliquée sous `migrator`.
--
-- Cette migration :
--   1. journal des statuts (`payment_operation_event`) : issues `UNPROVEN` et `MISMATCH` écrites
--      (S-02 : « une issue UNPROVEN … est écrite dans les événements ») ;
--   2. `core.payment_cmd_receive_webhook` : horodatage signé NULL d'un webhook à signature valide
--      ⇒ QUARANTINED et `signed_at_out_of_tolerance` (fail-closed ; corps de 0058 sinon inchangé) ;
--   3. `core.payment_cmd_apply_operation_status` (réécrite, mêmes signature, propriétaire et
--      droits) :
--        a. rattachement de la preuve signée à CETTE opération : par sa référence PSP quand elle
--           est connue, sinon par NOTRE clé (`merchantReference` = `idem_sent`) ; la référence
--           passée par l'appelant n'est plus jamais un critère de rattachement (S-02) ; la
--           référence enregistrée est celle de l'événement signé ;
--        b. montant reçu : un webhook signé SUCCEEDED qui porte un montant ou une devise différents
--           de l'opération ⇒ `MISMATCH`, rien n'est appliqué (19 US-223 : « 120,00 reçus pour un
--           devis de 128,40 ⇒ MISMATCH et aucun trip ») ; pour un paiement de loyer (AUTH,
--           CAPTURE), un webhook sans montant ni devise ne prouve rien (`UNPROVEN`) ;
--        c. POLL et API_RESPONSE terminaux sur un compte LIVE ⇒ `UNPROVEN` (aucune lecture
--           authentifiée avant le connecteur réel, lot C ; ADR-088 « Limites ») ; sur un compte de
--           bac à sable : POLL ⇒ preuve `POLL`, API_RESPONSE ⇒ statut sans preuve (inchangé,
--           caractérisé) ;
--        d. statut déjà terminal SANS preuve (réponse d'API) puis webhook signé du même statut ⇒
--           `DUPLICATE` et la preuve `WEBHOOK_SIGNED` est posée (la conversion peut alors partir) ;
--        e. `UNPROVEN` et `MISMATCH` journalisés (raw_ref seulement s'il désigne une ligne de la
--           boîte de réception) ;
--   4. conditions de paiement du hold lues dans le devis figé ENGAGÉ au checkout
--      (`booking_checkout_acceptance`, N-157) : `core.booking_checkout_capture_terms` (SECURITY
--      DEFINER, cmd_hold_owner) ; montant = `total_minor`, jambes = colonnes `leg_*_minor`
--      rejouées par la base (jamais `outputs` ni `inputs`, N-161), période du devis, fuseau du
--      véhicule ; `core.booking_hold_payment_terms` (0040, fail-closed) la lit désormais ;
--   5. version de prix n° 1 du trip = devis du checkout, posée par la conversion
--      (`core.pricing_bind_checkout_trip`, SECURITY DEFINER, cmd_money_owner) ;
--      `core.pricing_cmd_version_trip_price` refuse un devis engagé au checkout (QUOTE_MISMATCH)
--      et un devis échu (QUOTE_EXPIRED) (N-160) ;
--   6. `core.booking_convert_payment` (0041 recopiée) : SUCCEEDED sans preuve ⇒ `NOT_PROVEN`
--      (aucun trip) ; version de prix n° 1 posée avec le trip ;
--   7. `core.settlement_cmd_apply_leg_movement` (0054 recopiée) : aucun mouvement de jambe sans
--      preuve (`leg_movement_unproven`) ;
--   8. commandes du voyageur par jeton de session (cmd_hold_owner, EXECUTE app_api), comme le
--      checkout d'US-208 : `core.booking_cmd_checkout_pay` (T1 sur le hold de SON checkout, compte
--      marchand de Kmino du pays), `core.booking_cmd_checkout_record_order` (T2) et la lecture
--      `core.booking_checkout_payment` (état du hold, trip né, statut de l'ordre ; aucun montant
--      de jambe) ;
--   9. `core.booking_conversion_due(lot)` : opérations à convertir (SUCCEEDED prouvées sans
--      disposition) ou à traiter comme refus (FAILED de la tentative en cours), travailleur
--      booking_conversion (SECURITY INVOKER).
--
-- Erreurs (SQLSTATE, contrainte) traduites par packages/db/src/errors.ts, sans DETAIL :
--   leg_movement_unproven (55000) → PAYMENT_UNPROVEN ; celles de T1 / T2 (0040, 0045, 0112).
-- Issues rendues (jsonb / text, jamais une erreur) : AUTH_REQUIRED, HOLD_NOT_FOUND (hold d'un autre
-- voyageur ou sans checkout : même réponse), PAYMENT_UNAVAILABLE (aucun compte marchand ACTIVE du
-- pays), puis celles de T1 et T2 ; pricing_cmd_version_trip_price : + QUOTE_EXPIRED.
--
-- Expand / contract : contrainte CHECK recréée sous le même nom et ÉLARGIE (deux issues de plus) ;
-- fonctions remplacées sous leur propriétaire ; fonctions, droits et politiques AJOUTÉS. Resserrement
-- fail-closed de comportement (S-02) : aucune version servie n'appelle les nouvelles commandes ; les
-- webhooks à horodatage absent, les preuves sans montant d'un loyer et les POLL / API_RESPONSE d'un
-- compte LIVE ne sont plus acceptés (aucun compte LIVE n'existe avant le lot C).
--
-- Retour arrière : réappliquer 0058 (réception, application du statut), 0054 (mouvement de jambe),
--   0041 (conversion), 0100 (version de prix, sous cmd_money_owner) et 0040
--   (booking_hold_payment_terms) ; DROP FUNCTION core.booking_cmd_checkout_pay(bytea, uuid, text),
--   core.booking_cmd_checkout_record_order(bytea, uuid, uuid, text, timestamptz),
--   core.booking_checkout_payment(bytea, uuid), core.booking_checkout_capture_terms(uuid),
--   core.pricing_bind_checkout_trip(uuid), core.booking_conversion_due(integer) ;
--   recréer payment_operation_event_outcome_valid de 0028 (après suppression des lignes UNPROVEN /
--   MISMATCH, tables vides en production à ce stade) ; DROP POLICY cmd_money_checkout_read ON
--   core.booking_checkout_acceptance ; DROP POLICY cmd_hold_country_read ON core.config_country ; REVOKE les droits accordés ci-dessous.

-- 1. Journal des statuts : UNPROVEN et MISMATCH (S-02) ----------------------------------------------
ALTER TABLE core.payment_payment_operation_event
  DROP CONSTRAINT payment_operation_event_outcome_valid,
  ADD CONSTRAINT payment_operation_event_outcome_valid CHECK (outcome IN
    ('APPLIED', 'DUPLICATE', 'STALE', 'CONFLICT', 'UNPROVEN', 'MISMATCH'));

-- 2. Droits complémentaires (au plus juste) -------------------------------------------------------
-- cmd_hold_owner : conditions de paiement lues dans le devis engagé (jambes rejouées par la base),
-- fuseau du véhicule, trip né du hold (lecture du voyageur)
GRANT SELECT (leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor, leg_platform_minor)
  ON core.pricing_quote TO cmd_hold_owner;
GRANT SELECT (timezone) ON core.catalog_vehicle TO cmd_hold_owner;
GRANT SELECT (code, time_zone) ON core.config_country TO cmd_hold_owner;
CREATE POLICY cmd_hold_country_read ON core.config_country FOR SELECT TO cmd_hold_owner USING (true);
GRANT SELECT (converted_trip_id) ON core.booking_checkout_hold TO cmd_hold_owner;
-- cmd_money_owner : lien hold → devis (version n° 1 du trip, refus d'un devis du checkout)
GRANT SELECT (hold_id, quote_id) ON core.booking_checkout_acceptance TO cmd_money_owner;
CREATE POLICY cmd_money_checkout_read ON core.booking_checkout_acceptance FOR SELECT
  TO cmd_money_owner USING (true);
GRANT SELECT (source_hold_id, status) ON core.booking_trip TO cmd_money_owner;

-- 3. Conditions de paiement du hold : devis engagé au checkout (N-157, N-161) -----------------------
-- SECURITY DEFINER (cmd_hold_owner, liste blanche RLS-15) : lue par T1 (cmd_hold_owner) et par la
-- conversion (app_worker), qui n'ont aucun droit sur pricing_quote hors de ce chemin. Aucune ligne
-- pour un hold sans checkout, un devis d'un autre voyageur ou d'un autre pays, ou SUPERSEDED :
-- T1 refuse alors (QUOTE_UNAVAILABLE) et la conversion compense (ELIGIBILITY_CHANGED), fail-closed.
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

CREATE FUNCTION core.booking_checkout_capture_terms(p_hold_id uuid)
  RETURNS TABLE (amount_minor    bigint,
                 currency        text,
                 legs            jsonb,
                 scheduled_start timestamptz,
                 scheduled_end   timestamptz,
                 timezone        text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT q.total_minor, q.currency,
         pg_catalog.jsonb_build_object(
           'HOST', q.leg_host_minor::text,
           'INSURER', q.leg_insurer_minor::text,
           'TAX_THIRD_PARTY', q.leg_tax_third_party_minor::text,
           'PLATFORM', q.leg_platform_minor::text),
         pg_catalog.lower(q.period), pg_catalog.upper(q.period), COALESCE(v.timezone, k.time_zone)
    FROM core.booking_checkout_hold AS h
    JOIN core.booking_checkout_acceptance AS a
      ON a.hold_id = h.id AND a.guest_user_id = h.guest_user_id
    JOIN core.pricing_quote AS q ON q.id = a.quote_id
    -- fuseau du véhicule (lieu de remise) ; à défaut, celui du pays
    LEFT JOIN core.catalog_vehicle AS v ON v.id = h.vehicle_id
    JOIN core.config_country AS k ON k.code::text = h.country_code
   WHERE h.id = p_hold_id
     AND h.kind = 'CHECKOUT'
     AND q.guest_user_id = h.guest_user_id
     AND q.country_code = h.country_code
     AND q.status = 'FROZEN'
$fn$;
COMMENT ON FUNCTION core.booking_checkout_capture_terms(uuid) IS
  'Conditions de paiement d''un hold CHECKOUT : devis engagé (booking_checkout_acceptance), total et '
  'jambes rejoués par la base (colonnes leg_*_minor), période du devis, fuseau du véhicule (sinon '
  'du pays). Aucune '
  'ligne sinon (fail-closed). US-223 (ADR-139).';
REVOKE ALL ON FUNCTION core.booking_checkout_capture_terms(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_checkout_capture_terms(uuid) TO app_worker;

-- 8. Commandes du voyageur par jeton de session (T1, T2, lecture) -----------------------------------
-- Comme core.booking_cmd_checkout (0108, 0112) : la session est vérifiée ici, puis le contexte du
-- voyageur (app.actor_kind, app.actor_id) est posé le temps de l'appel de T1 / T2, puis remis ; une
-- erreur annule l'instruction (et le contexte avec elle). Le hold doit être celui du checkout de CE
-- voyageur : sinon la même réponse qu'un hold inconnu (IDOR, 17 §2.3).
CREATE FUNCTION core.booking_cmd_checkout_pay(p_token_hash bytea, p_hold_id uuid, p_method text)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user       uuid;
  v_country    text;
  v_account    uuid;
  v_provider   text;
  v_prev_kind  text;
  v_prev_actor text;
  v_result     jsonb;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'AUTH_REQUIRED');
  END IF;
  SELECT h.country_code INTO v_country
    FROM core.booking_checkout_hold AS h
    JOIN core.booking_checkout_acceptance AS a ON a.hold_id = h.id
   WHERE h.id = p_hold_id AND h.guest_user_id = v_user AND a.guest_user_id = v_user;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'HOLD_NOT_FOUND');
  END IF;
  -- compte marchand de Kmino du pays (owner_type PLATFORM par CHECK) : ACTIVE ; un compte de bac à
  -- sable n'est retenu que dans un environnement non productif connu (T1 le refuse de toute façon
  -- ailleurs) ; environnement NULL = production (fail-closed, 0045)
  SELECT a.id, a.provider INTO v_account, v_provider
    FROM core.payment_psp_account AS a
   WHERE a.country_code = v_country AND a.status = 'ACTIVE'
     AND (a.environment = 'LIVE'
          OR COALESCE(platform.deployment_env(), 'production') IN ('test', 'development', 'staging'))
   ORDER BY (a.environment = 'LIVE') DESC, a.provider, a.id
   LIMIT 1;
  IF v_account IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'PAYMENT_UNAVAILABLE');
  END IF;
  v_prev_kind := pg_catalog.current_setting('app.actor_kind', true);
  v_prev_actor := pg_catalog.current_setting('app.actor_id', true);
  PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
  PERFORM pg_catalog.set_config('app.actor_id', v_user::text, true);
  v_result := core.booking_cmd_start_payment(p_hold_id, v_account, p_method);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_prev_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_prev_actor, ''), true);
  RETURN v_result || pg_catalog.jsonb_build_object('holdId', p_hold_id, 'pspAccountId', v_account,
                                                   'provider', v_provider, 'method', p_method);
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_checkout_pay(bytea, uuid, text) IS
  'Intention de paiement (T1, 17 §2.5 étape 3a) du hold du checkout du voyageur de la session, sur '
  'le compte marchand de Kmino du pays ; montant et jambes du devis engagé. SECURITY DEFINER, '
  'EXECUTE app_api. US-223 (ADR-139).';

CREATE FUNCTION core.booking_cmd_checkout_record_order(p_token_hash bytea, p_hold_id uuid,
                                                       p_operation_id uuid,
                                                       p_provider_reference text,
                                                       p_order_expires_at timestamptz)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user       uuid;
  v_prev_kind  text;
  v_prev_actor text;
  v_result     text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  IF NOT EXISTS (SELECT 1
                   FROM core.booking_checkout_hold AS h
                   JOIN core.booking_checkout_acceptance AS a ON a.hold_id = h.id
                  WHERE h.id = p_hold_id AND h.guest_user_id = v_user
                    AND a.guest_user_id = v_user) THEN
    RETURN 'HOLD_NOT_FOUND';
  END IF;
  v_prev_kind := pg_catalog.current_setting('app.actor_kind', true);
  v_prev_actor := pg_catalog.current_setting('app.actor_id', true);
  PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
  PERFORM pg_catalog.set_config('app.actor_id', v_user::text, true);
  v_result := core.booking_cmd_record_order(p_hold_id, p_operation_id, p_provider_reference,
                                            p_order_expires_at);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_prev_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_prev_actor, ''), true);
  RETURN v_result;
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_checkout_record_order(bytea, uuid, uuid, text, timestamptz) IS
  'Affinage après createHostedPayment (T2, 17 §2.5 étape 3c) du hold du checkout du voyageur de la '
  'session. SECURITY DEFINER, EXECUTE app_api. US-223 (ADR-139).';

-- Lecture du paiement (S06) : état du hold, trip né de la conversion, échéances, statut de la
-- dernière opération de loyer. Aucun montant de jambe ni référence PSP rendu au client.
CREATE FUNCTION core.booking_checkout_payment(p_token_hash bytea, p_hold_id uuid)
  RETURNS TABLE (outcome                 text,
                 hold_status             text,
                 trip_id                 uuid,
                 expires_at              timestamptz,
                 payment_in_flight_until timestamptz,
                 operation_status        text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  h      record;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::uuid, NULL::timestamptz,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  SELECT ch.id, ch.status, ch.converted_trip_id, ch.expires_at, ch.payment_in_flight_until
    INTO h
    FROM core.booking_checkout_hold AS ch
    JOIN core.booking_checkout_acceptance AS a ON a.hold_id = ch.id
   WHERE ch.id = p_hold_id AND ch.guest_user_id = v_user AND a.guest_user_id = v_user;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'HOLD_NOT_FOUND'::text, NULL::text, NULL::uuid, NULL::timestamptz,
                        NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'DONE'::text, h.status, h.converted_trip_id, h.expires_at, h.payment_in_flight_until,
         (SELECT o.status
            FROM core.payment_payment_operation AS o
           WHERE o.hold_id = h.id AND o.purpose = 'RENT'
           ORDER BY o.attempt_no DESC, o.created_at DESC
           LIMIT 1);
END
$fn$;
COMMENT ON FUNCTION core.booking_checkout_payment(bytea, uuid) IS
  'Lecture du paiement du hold du checkout du voyageur de la session : état, trip né, échéances, '
  'statut de l''ordre ; aucun montant de jambe. SECURITY DEFINER, EXECUTE app_api. US-223.';

REVOKE ALL ON FUNCTION core.booking_cmd_checkout_pay(bytea, uuid, text),
  core.booking_cmd_checkout_record_order(bytea, uuid, uuid, text, timestamptz),
  core.booking_checkout_payment(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_cmd_checkout_pay(bytea, uuid, text),
  core.booking_cmd_checkout_record_order(bytea, uuid, uuid, text, timestamptz),
  core.booking_checkout_payment(bytea, uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- booking_hold_payment_terms (0040, migrator, SECURITY INVOKER) : la story du devis la remplace
-- comme prévu par 0040 ; même signature, mêmes droits (cmd_hold_owner, app_worker)
CREATE OR REPLACE FUNCTION core.booking_hold_payment_terms(p_hold_id uuid)
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
  SELECT t.amount_minor, t.currency, t.legs, t.scheduled_start, t.scheduled_end, t.timezone
    FROM core.booking_checkout_capture_terms(p_hold_id) AS t
$fn$;
COMMENT ON FUNCTION core.booking_hold_payment_terms(uuid) IS
  'Devis accepté du hold : devis engagé au checkout (core.booking_checkout_capture_terms), montant '
  'et jambes rejoués par la base. Aucune ligne sans checkout (fail-closed). US-024, US-223.';

-- 6. Conversion (0041 recopiée, changements marqués US-223) -----------------------------------------
CREATE OR REPLACE FUNCTION core.booking_convert_payment(p_operation_id uuid)
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
         op.country_code, op.proof_type
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
  -- US-223 (S-02, RC-5) : SUCCEEDED sans preuve rattachée (réponse d'API) ⇒ aucun trip ; la
  -- conversion attend le webhook signé (ou la lecture d'un compte de bac à sable)
  IF r_op.proof_type IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_PROVEN');
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
        -- US-223 (N-160) : version de prix n° 1 du trip = devis engagé au checkout du hold
        -- (aucune ligne pour un hold sans checkout)
        PERFORM core.pricing_bind_checkout_trip(v_trip);
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
  'Conversion atomique et gardée (17 §2.5 étape 4) : trip BOOKED ou compensation, jamais les deux ; '
  'aucun trip sans preuve rattachée (NOT_PROVEN) ; version de prix n° 1 = devis du checkout. '
  'Travailleurs booking_conversion, disposition_sweeper, payment_intent_sweeper. US-024, US-223.';

-- 9. Opérations à traiter par le travailleur booking_conversion (SECURITY INVOKER) -----------------
-- CONVERT : opération de loyer d'un hold SUCCEEDED, preuve rattachée, sans disposition ; FAIL : refus
-- reçu de la tentative en cours d'un hold en vol (core.booking_record_payment_failure). Une
-- opération par transaction côté travailleur (verrous voyageur → véhicule d'un seul hold).
CREATE FUNCTION core.booking_conversion_due(p_limit integer)
  RETURNS TABLE (operation_id uuid, action text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'booking_conversion' THEN
    RAISE EXCEPTION 'conversion: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'conversion: batch size out of bounds' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT x.id, x.action
    FROM (SELECT o.id, 'CONVERT'::text AS action, o.created_at
            FROM core.payment_payment_operation AS o
           WHERE o.hold_id IS NOT NULL AND o.purpose = 'RENT' AND o.kind IN ('AUTH', 'CAPTURE')
             AND o.status = 'SUCCEEDED' AND o.proof_type IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition AS d
                              WHERE d.operation_id = o.id)
          UNION ALL
          SELECT o.id, 'FAIL'::text, o.created_at
            FROM core.payment_payment_operation AS o
            JOIN core.booking_checkout_hold AS h ON h.id = o.hold_id
           WHERE o.purpose = 'RENT' AND o.kind IN ('AUTH', 'CAPTURE') AND o.status = 'FAILED'
             AND h.status = 'PAYMENT_IN_FLIGHT' AND o.attempt_no = h.payment_attempts + 1) AS x
   ORDER BY x.created_at, x.id
   LIMIT p_limit;
END
$fn$;
COMMENT ON FUNCTION core.booking_conversion_due(integer) IS
  'Opérations de loyer à convertir (SUCCEEDED prouvées sans disposition) ou à traiter comme refus '
  '(FAILED de la tentative en cours), travailleur booking_conversion. US-223 (ADR-139).';
REVOKE ALL ON FUNCTION core.booking_conversion_due(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_conversion_due(integer) TO app_worker;

-- 5. et 2, 3, 7 : commandes d'argent (sous leur propriétaire cmd_money_owner) ----------------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 5. Version de prix n° 1 du trip né d'un hold du checkout (N-160) : appelée par la conversion, dans
-- sa transaction, juste après la naissance du trip. Hold sans checkout (fixtures, hold de lien de
-- paiement) : rien. Devis absent, SUPERSEDED, d'un autre voyageur, d'une autre période ou d'une
-- autre devise que le trip : erreur (la conversion entière est annulée, disposition_sweeper alerte).
CREATE FUNCTION core.pricing_bind_checkout_trip(p_trip_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t       record;
  q       record;
  v_quote uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('booking_conversion', 'disposition_sweeper',
                                  'payment_intent_sweeper') THEN
    RAISE EXCEPTION 'pricing: bind_checkout_trip reserved to the conversion workers'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  SELECT b.id, b.source_hold_id, b.guest_user_id, b.country_code, b.currency, b.scheduled_start,
         b.scheduled_end, b.status
    INTO t
    FROM core.booking_trip AS b
   WHERE b.id = p_trip_id;
  IF NOT FOUND OR t.source_hold_id IS NULL THEN
    RETURN 0;
  END IF;
  SELECT a.quote_id INTO v_quote
    FROM core.booking_checkout_acceptance AS a WHERE a.hold_id = t.source_hold_id;
  IF v_quote IS NULL THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM core.pricing_trip_price_version AS v WHERE v.trip_id = p_trip_id) THEN
    RETURN 0;
  END IF;
  SELECT x.status, x.guest_user_id, x.country_code, x.currency, x.period INTO q
    FROM core.pricing_quote AS x WHERE x.id = v_quote;
  IF q.status IS DISTINCT FROM 'FROZEN' OR q.guest_user_id IS DISTINCT FROM t.guest_user_id
     OR q.country_code IS DISTINCT FROM t.country_code OR q.currency IS DISTINCT FROM t.currency
     OR q.period IS DISTINCT FROM pg_catalog.tstzrange(t.scheduled_start, t.scheduled_end, '[)') THEN
    RAISE EXCEPTION 'pricing: checkout quote % does not match trip %', v_quote, p_trip_id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'pricing_checkout_trip_mismatch';
  END IF;
  INSERT INTO core.pricing_trip_price_version (trip_id, version, quote_id)
  VALUES (p_trip_id, 1, v_quote);
  RETURN 1;
END
$fn$;
COMMENT ON FUNCTION core.pricing_bind_checkout_trip(uuid) IS
  'Version de prix n° 1 du trip = devis engagé au checkout de son hold (un devis, un hold, un trip, '
  'N-160). Travailleurs de conversion seulement. SECURITY DEFINER. US-223 (ADR-139).';
REVOKE ALL ON FUNCTION core.pricing_bind_checkout_trip(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.pricing_bind_checkout_trip(uuid) TO app_worker;

-- 5 bis. Version de prix du trip (0100 recopiée, changements marqués US-223)
CREATE OR REPLACE FUNCTION core.pricing_cmd_version_trip_price(p_token_hash bytea, p_trip_id uuid,
                                                    p_quote_id uuid)
  RETURNS TABLE (outcome text, version integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  t         record;
  q         record;
  v_prev    uuid;
  v_version integer;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::integer;
    RETURN;
  END IF;
  -- verrou du trip : une version à la fois (premier gagnant)
  SELECT b.id, b.guest_user_id, b.listing_id, b.country_code, b.currency, b.status,
         b.scheduled_start, b.scheduled_end
    INTO t
    FROM core.booking_trip AS b
   WHERE b.id = p_trip_id
     FOR UPDATE;
  -- IDOR : le trip d'un autre voyageur répond comme un trip inconnu
  IF NOT FOUND OR t.guest_user_id IS DISTINCT FROM v_user THEN
    RETURN QUERY SELECT 'TRIP_NOT_FOUND'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT x.id, x.guest_user_id, x.listing_id, x.country_code, x.currency, x.status, x.period,
         x.expires_at
    INTO q
    FROM core.pricing_quote AS x
   WHERE x.id = p_quote_id;
  IF NOT FOUND OR q.guest_user_id IS DISTINCT FROM v_user THEN
    RETURN QUERY SELECT 'QUOTE_NOT_FOUND'::text, NULL::integer;
    RETURN;
  END IF;
  -- US-223 (N-160) : un devis échu n'est jamais rattaché (validité quote_validity_minutes)
  IF q.expires_at IS NULL OR q.expires_at <= platform.now() THEN
    RETURN QUERY SELECT 'QUOTE_EXPIRED'::text, NULL::integer;
    RETURN;
  END IF;
  -- US-223 (N-160) : un devis engagé au checkout (booking_checkout_acceptance) n'appartient qu'à
  -- son hold ; la version n° 1 du trip né de ce hold est posée par la conversion
  -- (core.pricing_bind_checkout_trip), jamais par cette commande
  IF q.status <> 'FROZEN'
     OR EXISTS (SELECT 1 FROM core.booking_checkout_acceptance AS a WHERE a.quote_id = p_quote_id)
     OR EXISTS (SELECT 1 FROM core.pricing_trip_price_version AS v WHERE v.quote_id = p_quote_id)
     OR t.status NOT IN ('BOOKED', 'CHECKIN_OPEN', 'IN_PROGRESS')
     OR q.country_code <> t.country_code OR q.currency <> t.currency
     OR (t.listing_id IS NOT NULL AND t.listing_id <> q.listing_id)
     OR q.period <> pg_catalog.tstzrange(t.scheduled_start, t.scheduled_end, '[)') THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT v.quote_id, v.version INTO v_prev, v_version
    FROM core.pricing_trip_price_version AS v
   WHERE v.trip_id = p_trip_id
   ORDER BY v.version DESC
   LIMIT 1;
  v_version := COALESCE(v_version, 0) + 1;
  IF v_prev IS NOT NULL THEN
    UPDATE core.pricing_quote SET status = 'SUPERSEDED', superseded_at = platform.now()
     WHERE id = v_prev AND status = 'FROZEN';
  END IF;
  INSERT INTO core.pricing_trip_price_version (trip_id, version, quote_id)
  VALUES (p_trip_id, v_version, p_quote_id);
  RETURN QUERY SELECT 'DONE'::text, v_version;
END
$fn$;

-- 2. Réception des webhooks (0058 recopiée, changement marqué US-223)
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
                -- US-223 (S-02) : horodatage signé absent ⇒ hors fenêtre (fail-closed), comme un
                -- horodatage hors de ± 5 min ; jamais « dans la fenêtre » par défaut
                WHEN p_signed_at IS NULL
                     OR p_signed_at < v_now - interval '5 minutes'
                     OR p_signed_at > v_now + interval '5 minutes' THEN 'QUARANTINED'
                ELSE 'RECEIVED'
              END;
  -- US-049 (0058) : la réception par cette commande et le hors-tolérance de l'horodatage signé
  -- sont posés ici, une fois, dans des colonnes que personne ne réécrit (trigger
  -- webhook_inbox_proof_columns_immutable)
  INSERT INTO core.payment_webhook_inbox AS w
         (id, provider, psp_account_id, provider_event_id, dedup_key, signature_valid, headers,
          processing_status, error, normalized_events, received_by_command,
          signed_at_out_of_tolerance)
  VALUES (v_id, v_provider, p_account_id, p_provider_event_id, p_dedup_key,
          p_signature_valid IS TRUE, p_headers, v_status,
          CASE v_status WHEN 'QUARANTINED' THEN 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE' END,
          CASE WHEN v_status = 'REJECTED_SIGNATURE' THEN NULL ELSE p_normalized END,
          true, v_status = 'QUARANTINED')
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

-- 3. Application d'un statut (réécrite, voir l'en-tête ; règles de rang de 0028 inchangées)
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
        ELSIF v_purpose IN ('RENT', 'RENT_SHORTFALL') AND v_kind IN ('AUTH', 'CAPTURE') THEN
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
        AND v_env IS DISTINCT FROM 'SANDBOX' THEN
    -- US-223 (S-02, ADR-088 « Limites ») : aucune réponse de lecture ni de création authentifiée
    -- avant le connecteur réel (lot C) ; un compte LIVE n'admet que la preuve signée
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

-- 7. Mouvements de jambe (0054 recopiée, changement marqué US-223)
CREATE OR REPLACE FUNCTION core.settlement_cmd_apply_leg_movement(p_operation_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip_id     uuid;
  v_kind        text;
  v_purpose     text;
  v_status      text;
  v_currency    text;
  v_account     uuid;
  v_org         uuid;
  v_country     text;
  v_trip_cur    text;
  v_mode        text;
  v_n           integer;
  r             record;
  v_debit       bigint;
  v_avail       bigint;
  v_block       text;
  v_head_refund bigint;
  v_over        integer;
  v_after       bigint;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'settlement: apply_leg_movement reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT o.trip_id, o.kind, o.purpose, o.currency, o.psp_account_id
    INTO v_trip_id, v_kind, v_purpose, v_currency, v_account
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND OR v_trip_id IS NULL OR v_account IS NULL THEN
    RAISE EXCEPTION 'settlement: operation % has no trip leg to move', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- verrou du trip : un seul écrivain des soldes du trip à la fois (17 §2.9, §4.3 point 1)
  SELECT t.org_id, t.country_code, t.currency INTO v_org, v_country, v_trip_cur
    FROM core.booking_trip AS t WHERE t.id = v_trip_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m WHERE m.operation_id = p_operation_id) THEN
    RETURN 'DUPLICATE';
  END IF;

  -- statut relu SOUS le verrou du trip
  SELECT o.status INTO v_status FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF v_status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'settlement: operation % is %, not SUCCEEDED', p_operation_id, v_status
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_not_succeeded';
  END IF;
  -- US-223 (S-02, RC-5) : aucun mouvement de jambe sans preuve rattachée (webhook signé, ou lecture
  -- d'un compte de bac à sable) ; un SUCCEEDED rendu par l'API laisse la preuve à NULL
  IF (SELECT o.proof_type FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id)
     IS NULL THEN
    RAISE EXCEPTION 'settlement: operation % has no attached proof', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_movement_unproven';
  END IF;
  IF v_purpose NOT IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION')
     OR v_kind NOT IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION', 'REFUND', 'LEG_REALLOCATION',
                       'LEG_RELEASE')
     OR v_currency IS DISTINCT FROM v_trip_cur THEN
    RAISE EXCEPTION 'settlement: operation % (% / %) is outside the rent leg perimeter',
                    p_operation_id, v_kind, v_purpose
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;
  SELECT count(*)::integer INTO v_n
    FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = p_operation_id;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'settlement: operation % has % legs, 4 expected', p_operation_id, v_n
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- US-049 (RC-3) : fonds détenus par Kmino (mode autre que SPLIT_AT_SOURCE) seulement si
  -- funds_holding_enabled[pays] (17 §0.1, lecture fail-closed) ; défense derrière le CHECK de 0028
  SELECT a.collection_mode INTO v_mode FROM core.payment_psp_account AS a WHERE a.id = v_account;
  IF v_mode IS DISTINCT FROM 'SPLIT_AT_SOURCE'
     AND NOT core.config_go_live('funds_holding_enabled', v_country) THEN
    RAISE EXCEPTION 'settlement: funds holding is disabled for %', v_country
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_funds_holding_disabled';
  END IF;

  -- quatre lignes de solde du segment (bêta : segment 1), créées à zéro au premier mouvement
  INSERT INTO core.settlement_trip_leg_balance (trip_id, segment_no, leg, org_id, country_code, currency)
  SELECT v_trip_id, 1, l.leg, v_org, v_country, v_trip_cur
    FROM unnest(ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM']) AS l(leg)
  ON CONFLICT (trip_id, segment_no, leg) DO NOTHING;

  -- US-049 (RC-3) : versement gardé (trip terminé, release_at, sous-marchand, interrupteurs),
  -- relu ici sous le verrou du trip en plus de l'enregistrement de l'ordre
  IF v_kind = 'LEG_RELEASE' THEN
    v_block := core.settlement_release_blocker(p_operation_id);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'settlement: leg release of operation % refused (%)', p_operation_id, v_block
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = v_block;
    END IF;
  END IF;

  -- contrôle des débits sur les soldes verrouillés (17 §4.3 point 8, 08 E7 règle 3 bis)
  FOR r IN
    SELECT l.leg, l.amount_minor, b.captured_minor, b.refunded_minor, b.reallocated_in_minor,
           b.reallocated_out_minor, b.released_minor, b.frozen
      FROM core.payment_payment_operation_leg AS l
      JOIN core.settlement_trip_leg_balance AS b
        ON b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
     WHERE l.operation_id = p_operation_id
     ORDER BY array_position(ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'], l.leg)
       FOR UPDATE OF b
  LOOP
    v_debit := CASE
                 WHEN v_kind IN ('REFUND', 'LEG_RELEASE') THEN r.amount_minor
                 WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(-r.amount_minor, 0)
                 ELSE 0
               END;
    IF v_debit > 0 THEN
      IF r.frozen THEN
        RAISE EXCEPTION 'settlement: leg % of trip % is frozen', r.leg, v_trip_id
          USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_frozen';
      END IF;
      v_avail := r.captured_minor + r.reallocated_in_minor - r.refunded_minor
                 - r.reallocated_out_minor - r.released_minor;
      IF v_debit > v_avail THEN
        IF r.released_minor > 0 THEN
          RAISE EXCEPTION 'settlement: leg % of trip % already released', r.leg, v_trip_id
            USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_already_released';
        END IF;
        RAISE EXCEPTION 'settlement: debit % exceeds leg % balance %', v_debit, r.leg, v_avail
          USING ERRCODE = 'object_not_in_prerequisite_state',
                CONSTRAINT = 'leg_movement_exceeds_balance';
      END IF;
    END IF;
  END LOOP;

  -- US-049 (RC-2) : un remboursement est borné par le règlement du segment, jambe par jambe
  -- (08 E7 règle 1 : jambes explicites, jamais un prorata) : Σ remboursé ≤ max(0, − Σ variations
  -- de la chaîne de versions) et Σ remboursé ≤ remboursement de la dernière version.
  IF v_kind = 'REFUND' THEN
    SELECT s.guest_refund_minor INTO v_head_refund
      FROM core.settlement_settlement AS s
     WHERE s.trip_id = v_trip_id AND s.segment_no = 1
     ORDER BY s.version DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'settlement: refund of operation % without a settlement', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_without_settlement';
    END IF;
    SELECT count(*) FILTER (WHERE b.refunded_minor + l.amount_minor > GREATEST(-e.variation, 0)),
           COALESCE(sum(b.refunded_minor + l.amount_minor), 0)
      INTO v_over, v_after
      FROM core.payment_payment_operation_leg AS l
      JOIN core.settlement_trip_leg_balance AS b
        ON b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
      LEFT JOIN (SELECT sl.leg, sum(sl.variation_minor) AS variation
                   FROM core.settlement_settlement_leg AS sl
                  WHERE sl.trip_id = v_trip_id AND sl.segment_no = 1
                  GROUP BY sl.leg) AS e
        ON e.leg = l.leg
     WHERE l.operation_id = p_operation_id;
    IF v_over > 0 OR v_after > v_head_refund THEN
      RAISE EXCEPTION 'settlement: refund of operation % exceeds the settlement legs', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_exceeds_settlement';
    END IF;
  END IF;

  UPDATE core.settlement_trip_leg_balance AS b
     SET captured_minor = b.captured_minor
                          + CASE WHEN v_kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
                                 THEN l.amount_minor ELSE 0 END,
         refunded_minor = b.refunded_minor
                          + CASE WHEN v_kind = 'REFUND' THEN l.amount_minor ELSE 0 END,
         reallocated_in_minor = b.reallocated_in_minor
                          + CASE WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(l.amount_minor, 0)
                                 ELSE 0 END,
         reallocated_out_minor = b.reallocated_out_minor
                          + CASE WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(-l.amount_minor, 0)
                                 ELSE 0 END,
         released_minor = b.released_minor
                          + CASE WHEN v_kind = 'LEG_RELEASE' THEN l.amount_minor ELSE 0 END
    FROM core.payment_payment_operation_leg AS l
   WHERE l.operation_id = p_operation_id
     AND b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
     AND l.amount_minor <> 0;

  INSERT INTO core.settlement_leg_movement (operation_id, trip_id, segment_no, country_code, kind)
  VALUES (p_operation_id, v_trip_id, 1, v_country, v_kind);
  RETURN 'APPLIED';
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
