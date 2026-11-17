-- 0122 — AVL / PAY : réservation sur demande (hold REQUEST), autorisation à l'envoi, capture par
-- jambes à l'acceptation de l'hôte, VOID total au refus ou à l'expiration (partie serveur 223c).
-- US-223 ; 19 US-223 (DoR 1 et 2, critères US-060), US-219 (critères 4 à 6) ; 16 HDB-002,
-- BKG-011 ; 08 BR-BOOK-01, E7 (règles 1, 2), TJ03 ; 17 §2.5 « Hold de demande REQUEST » (table,
-- deltas SQL, exigences de sécurité 1 à 4, exigences d'argent a à c), §3.2.4, §4.3, §7.2 ;
-- ADR-063, ADR-133, ADR-139, ADR-142 ; ADR-146 (cette migration). Suites fermées : N-127, reste de
-- N-128 (côté base), N-198. Appliquée sous `migrator`, après 0121 (paramètre
-- booking_request_mode_enabled, faux dans chaque pays).
--
-- Cette migration :
--   1. `booking_checkout_hold` : type REQUEST, statut AWAITING_HOST, motif REQUEST_DECLINED,
--      colonne `request_respond_by` (heure limite de réponse de l'hôte, écrite une seule fois) et
--      ses contrôles ; AWAITING_HOST compte parmi les holds vivants (index unique partiel
--      one_live_hold_per_guest_vehicle recréé, garde entre hôtes `platform.guest_hold_guard`) ;
--      déclencheur `hold_guarded_columns` : `kind` toujours gardé, `request_respond_by` et
--      l'échéance écrits seulement par le passage PAYMENT_IN_FLIGHT → AWAITING_HOST, libération
--      du voyageur refusée après l'acceptation ;
--   2. checkout : une annonce sur demande devient un hold REQUEST si booking_request_mode_enabled
--      est vrai dans le pays (sinon REQUEST_MODE_UNAVAILABLE, inchangé) ; pose par
--      `core.booking_place_hold_kind` (corps de 0097, type posé une fois à l'insertion) ;
--   3. T1 / T2 : l'ordre du voyageur d'une demande est une autorisation AUTH (capture MANUAL,
--      montant et jambes du devis engagé) ; seulement un moyen dont SUPPORTS_PREAUTH et
--      SUPPORTS_VOID sont validés ; jamais la capture de l'hôte rendue ni affinée par le voyageur ;
--   4. preuve de l'autorisation (travailleur booking_conversion) : `core.booking_request_authorized`
--      passe le hold en AWAITING_HOST (request_respond_by = platform.now() + booking_request_
--      expiry_hours), aucune disposition ; hold déjà sorti : VOID ; l'autorisation d'une demande
--      est exclue de la réparation des dispositions et, réglée, de l'oracle C12 ;
--   5. commandes de l'hôte titulaire par jeton (EXECUTE app_api) : acceptation (CAPTURE rattachée
--      à l'AUTH, montant explicite de chaque jambe, Σ jambes = total du devis ≤ AUTH, sinon
--      LEG_SUM_MISMATCH et aucune capture), affinage de la capture, refus (RELEASED,
--      REQUEST_DECLINED, VOID) ; IDOR : FORBIDDEN journalisé sans révéler l'état ; lecture des
--      demandes du compte ; lecture de la demande par le voyageur ;
--   6. expiration (travailleur hold_expiry) : AWAITING_HOST échu ⇒ EXPIRED, créneau libéré, VOID ;
--   7. capture refusée (core.booking_record_payment_failure) : RELEASED (PAYMENT_DECLINED), VOID ;
--   8. VOID total : opération VOID (aucune jambe) et commande VOID de la boîte d'envoi
--      (`payment_command`, clé hold:{hold}:VOID:{opération}:a1), exécutée par le consommateur
--      payment_command (US-061, lot C) ; escalade : métrique request_void_pending_30m de la
--      supervision (alerte OPS_REQUEST_VOID_PENDING) ; aucun débit n'est jamais créé.
--
-- Issues rendues (jsonb / table, jamais une erreur) : AUTH_REQUIRED, FORBIDDEN (compte d'un autre,
-- hold inconnu ou d'un autre compte, hold qui n'est pas une demande : même réponse),
-- REQUEST_EXPIRED, INVALID_TRANSITION, TERMS_REACCEPT_REQUIRED (CGU de l'hôte, N-66),
-- GUEST_NOT_ELIGIBLE, START_PASSED, LEG_SUM_MISMATCH, PARAM_MISSING, CAPTURE_ORDER, RETRY_SAME_KEY,
-- CAPTURING, ACCEPTED, DECLINED, RECORDED. Erreurs (SQLSTATE, contrainte) : celles de T1 / T2 ;
-- hold_kind_valid (23514).
--
-- Expand / contract : contraintes CHECK recréées sous le même nom et ÉLARGIES ; colonne NULL
-- ajoutée ; index recréé sous le même nom, élargi ; fonctions remplacées sous leur propriétaire,
-- mêmes signatures ; fonctions, droits et politiques AJOUTÉS. Aucune donnée existante ne change :
-- tant que booking_request_mode_enabled est faux, aucun hold REQUEST n'est créé.
--
-- Retour arrière (aucun hold REQUEST en base) : réappliquer 0097 (pose), 0112 (checkout, T1),
--   0040 (T2), 0116 (conditions, conversion, opérations dues), 0041 (refus reçu, candidats),
--   0045 (oracle), 0037 (garde des colonnes, garde entre hôtes), 0051 (supervision) ;
--   DROP FUNCTION des fonctions créées ci-dessous ; DROP POLICY cmd_hold_request_* et
--   worker_ops_monitor_read ; recréer l'index et les contraintes de 0004 / 0040 ; DROP COLUMN
--   request_respond_by ; REVOKE des droits accordés ci-dessous.

-- 1. Hold de demande (17 §2.5 deltas, §3.2.4) ------------------------------------------------------
ALTER TABLE core.booking_checkout_hold
  ADD COLUMN request_respond_by timestamptz,
  DROP CONSTRAINT hold_kind_valid,
  ADD CONSTRAINT hold_kind_valid CHECK (kind IN ('CHECKOUT', 'REQUEST')),
  DROP CONSTRAINT hold_status_valid,
  ADD CONSTRAINT hold_status_valid CHECK (status IN
    ('ACTIVE', 'AWAITING_HOST', 'PAYMENT_IN_FLIGHT', 'CONVERTED', 'EXPIRED', 'RELEASED',
     'COMPENSATED')),
  DROP CONSTRAINT hold_release_reason_valid,
  ADD CONSTRAINT hold_release_reason_valid CHECK (release_reason IN
    ('GUEST_ABANDON', 'PAYMENT_DECLINED', 'SUPERSEDED_BY_PAID_HOLD', 'REVIEW_REJECTED',
     'HOST_UNAVAILABLE', 'REQUEST_DECLINED')),
  ADD CONSTRAINT hold_request_respond_by_kind CHECK (kind = 'REQUEST' OR request_respond_by IS NULL),
  ADD CONSTRAINT hold_awaiting_host_request CHECK (status <> 'AWAITING_HOST'
    OR (kind = 'REQUEST' AND request_respond_by IS NOT NULL));
COMMENT ON COLUMN core.booking_checkout_hold.request_respond_by IS
  'Heure limite de réponse de l''hôte (hold REQUEST, 17 §2.5) : platform.now() + '
  'booking_request_expiry_hours au passage en AWAITING_HOST ; écrite une fois. US-223.';

-- une demande AWAITING_HOST est un hold vivant (17 §2.5 « Nombre ») ; l'expiration passe par le
-- statut, jamais par une horloge dans le prédicat
DROP INDEX core.one_live_hold_per_guest_vehicle;
CREATE UNIQUE INDEX one_live_hold_per_guest_vehicle
  ON core.booking_checkout_hold (guest_user_id, vehicle_id)
  WHERE (status IN ('ACTIVE', 'AWAITING_HOST', 'PAYMENT_IN_FLIGHT'));

-- Garde des colonnes (corps de 0037, changements marqués US-223c)
CREATE OR REPLACE FUNCTION core.booking_hold_guarded_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  -- US-223c : passage d'une demande autorisée en attente de l'hôte (seule écriture de l'heure
  -- limite, de l'échéance alignée sur elle et de la remise à NULL de la borne de paiement)
  v_awaiting boolean := OLD.kind = 'REQUEST' AND OLD.status = 'PAYMENT_IN_FLIGHT'
                        AND NEW.status = 'AWAITING_HOST' AND OLD.request_respond_by IS NULL
                        AND NEW.request_respond_by IS NOT NULL;
BEGIN
  IF NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
     OR NEW.guest_user_id IS DISTINCT FROM OLD.guest_user_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.occupancy_id IS DISTINCT FROM OLD.occupancy_id
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.review_required IS DISTINCT FROM OLD.review_required
     OR (OLD.release_requested_at IS NOT NULL
         AND NEW.release_requested_at IS DISTINCT FROM OLD.release_requested_at)
     OR (OLD.payment_in_flight_until IS NOT NULL AND NEW.payment_in_flight_until IS NOT NULL
         AND NEW.payment_in_flight_until > OLD.payment_in_flight_until)
     OR (OLD.payment_in_flight_until IS NOT NULL AND NEW.payment_in_flight_until IS NULL
         AND NOT (OLD.status = 'PAYMENT_IN_FLIGHT' AND NEW.status = 'ACTIVE')
         AND NOT v_awaiting)
     OR (NEW.expires_at IS DISTINCT FROM OLD.expires_at
         AND NOT (OLD.review_required AND OLD.reviewed_at IS NULL AND NEW.reviewed_at IS NOT NULL)
         AND NOT (v_awaiting AND NEW.expires_at = NEW.request_respond_by))
     -- US-223c : heure limite écrite une fois, au passage en AWAITING_HOST ; jamais prolongée
     OR (NEW.request_respond_by IS DISTINCT FROM OLD.request_respond_by AND NOT v_awaiting)
     -- US-223c : une demande acceptée ou en attente n'est plus « abandonnée » par le voyageur
     OR (OLD.release_requested_at IS NULL AND NEW.release_requested_at IS NOT NULL
         AND OLD.request_respond_by IS NOT NULL)
  THEN
    RAISE EXCEPTION 'checkout_hold: guarded column changed'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'hold_guarded_columns',
            DETAIL = pg_catalog.format('hold %s', OLD.id);
  END IF;
  RETURN NEW;
END
$fn$;

-- Garde entre hôtes (corps de 0037 sous guard_owner) : une demande en attente compte parmi les
-- holds vivants du voyageur (max_active_holds_per_guest)
GRANT CREATE ON SCHEMA platform TO guard_owner;
SET LOCAL ROLE guard_owner;
CREATE OR REPLACE FUNCTION platform.guest_hold_guard(p_period tstzrange)
  RETURNS TABLE (live_holds integer, trip_overlap boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT (SELECT pg_catalog.count(*) FROM core.booking_checkout_hold h
           WHERE h.guest_user_id = app.actor_id()
             AND h.status IN ('ACTIVE', 'AWAITING_HOST', 'PAYMENT_IN_FLIGHT'))::integer,
         EXISTS (SELECT 1 FROM core.booking_guest_occupancy g
                  WHERE g.guest_user_id = app.actor_id() AND g.active AND g.period && p_period)
   WHERE app.actor_kind() = 'GUEST' AND app.actor_id() IS NOT NULL
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA platform FROM guard_owner;

-- 2. Boîte d'envoi : commande VOID (17 §3.2.7, §4.3 ; exigence d'argent c) -------------------------
-- Une seule commande par opération VOID (clé stockée, ON CONFLICT DO NOTHING : rejeu sans effet) ;
-- exécutée APRÈS le COMMIT par le consommateur payment_command (US-061, lot C), jamais dans la
-- transaction qui la décide.
ALTER TABLE core.payment_payment_command
  DROP CONSTRAINT payment_command_kind_valid,
  ADD CONSTRAINT payment_command_kind_valid CHECK (operation_kind IN ('CANCEL_ORDER', 'VOID')),
  ADD CONSTRAINT payment_command_void_key CHECK (
    operation_kind <> 'VOID'
    OR idem_plain = 'hold:' || hold_id::text || ':VOID:' || operation_id::text || ':a1');

-- 3. Paramètres lus par les commandes de demande --------------------------------------------------
-- Booléen d'un paramètre de portée pays en vigueur (même forme que booking_param_int, 0037) ;
-- absent ou d'un autre type : NULL (l'appelant refuse : fail-closed).
CREATE FUNCTION core.booking_param_bool(p_key text, p_country text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'boolean' THEN (v.value #>> '{}')::boolean END
    FROM core.config_param_value v CROSS JOIN t
   WHERE v.key = p_key
     AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts
     AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;
COMMENT ON FUNCTION core.booking_param_bool(text, text) IS
  'Valeur booléenne en vigueur d''un paramètre de pays ; absente ou mal typée : NULL (fail-closed). '
  'US-223.';
REVOKE ALL ON FUNCTION core.booking_param_bool(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_param_bool(text, text) TO cmd_hold_owner;
-- politique ajoutée à côté de cmd_hold_read (permissives : OU), sans recopier sa liste
CREATE POLICY cmd_hold_request_param_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('booking_request_mode_enabled', 'booking_request_expiry_hours'));

-- 4. Droits de cmd_hold_owner (au plus juste) -------------------------------------------------------
-- hold : heure limite, motif ; contexte de l'hôte (app.org_id) ; comptes d'hôte de la session ; CGU
-- de l'hôte (N-66)
GRANT SELECT (request_respond_by, payment_attempts, released_at, released_by)
  ON core.booking_checkout_hold TO cmd_hold_owner;
GRANT UPDATE (request_respond_by, expires_at, payment_in_flight_until)
  ON core.booking_checkout_hold TO cmd_hold_owner;
GRANT EXECUTE ON FUNCTION core.iam_host_accounts(bytea), core.ctr_host_terms_required(uuid, text)
  TO cmd_hold_owner;
-- autorisation de la demande : compte marchand, preuve et clé de l'AUTH (capture rattachée, VOID)
GRANT SELECT (psp_account_id, proof_type, idem_plain) ON core.payment_payment_operation
  TO cmd_hold_owner;
GRANT SELECT (operation_kind) ON core.payment_payment_command TO cmd_hold_owner;

-- Politiques des demandes (17 §2.5 exigences de sécurité 1 et 2) : l'hôte titulaire (contexte
-- posé par la commande après la vérification de la session : actor_kind HOST, org_id du compte),
-- l'expiration (hold_expiry) et la preuve de l'autorisation (booking_conversion). Le voyageur
-- n'a aucun droit sur une demande en attente (cmd_hold_upd inchangée).
CREATE POLICY cmd_hold_request_upd ON core.booking_checkout_hold FOR UPDATE TO cmd_hold_owner
  USING (kind = 'REQUEST' AND (
           (app.actor_kind() = 'HOST' AND org_id = app.org_id() AND status = 'AWAITING_HOST')
        OR (app.actor_kind() = 'WORKER' AND app.worker_name() = 'hold_expiry'
            AND status = 'AWAITING_HOST')
        OR (app.actor_kind() = 'WORKER' AND app.worker_name() = 'booking_conversion'
            AND status = 'PAYMENT_IN_FLIGHT')))
  WITH CHECK (kind = 'REQUEST' AND (
           (app.actor_kind() = 'HOST' AND org_id = app.org_id()
            AND status IN ('PAYMENT_IN_FLIGHT', 'RELEASED'))
        OR (app.actor_kind() = 'WORKER' AND app.worker_name() = 'hold_expiry'
            AND status = 'EXPIRED')
        OR (app.actor_kind() = 'WORKER' AND app.worker_name() = 'booking_conversion'
            AND status = 'AWAITING_HOST')));
-- occupation HOLD d'une demande : désactivée au refus ou à l'expiration
CREATE POLICY cmd_hold_request_occ_upd ON core.booking_vehicle_occupancy FOR UPDATE
  TO cmd_hold_owner
  USING (kind = 'HOLD' AND active AND ref_type = 'HOLD'
         AND (app.actor_kind() = 'HOST'
              OR (app.actor_kind() = 'WORKER' AND app.worker_name() = 'hold_expiry')))
  WITH CHECK (kind = 'HOLD' AND NOT active AND deactivated_reason IN ('HOLD_EXPIRED', 'HOLD_RELEASED')
              AND (app.actor_kind() = 'HOST'
                   OR (app.actor_kind() = 'WORKER' AND app.worker_name() = 'hold_expiry')));
-- autorisation du voyageur (T1 d'une demande) : AUTH PENDING de son hold REQUEST en vol
CREATE POLICY cmd_hold_request_auth_ins ON core.payment_payment_operation FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'GUEST' AND purpose = 'RENT' AND kind = 'AUTH'
              AND status = 'PENDING' AND trip_id IS NULL AND psp_account_id IS NOT NULL
              AND EXISTS (SELECT 1 FROM core.booking_checkout_hold h
                           WHERE h.id = payment_payment_operation.hold_id
                             AND h.guest_user_id = app.actor_id() AND h.kind = 'REQUEST'
                             AND h.status = 'PAYMENT_IN_FLIGHT'));
-- capture de l'acceptation (hôte du compte, demande en vol) ; VOID d'une demande terminée
CREATE POLICY cmd_hold_request_pay_ins ON core.payment_payment_operation FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (purpose = 'RENT' AND status = 'PENDING' AND trip_id IS NULL
              AND psp_account_id IS NOT NULL
              AND ((kind = 'CAPTURE' AND app.actor_kind() = 'HOST'
                    AND EXISTS (SELECT 1 FROM core.booking_checkout_hold h
                                 WHERE h.id = payment_payment_operation.hold_id
                                   AND h.kind = 'REQUEST' AND h.org_id = app.org_id()
                                   AND h.status = 'PAYMENT_IN_FLIGHT'
                                   AND h.request_respond_by IS NOT NULL))
                OR (kind = 'VOID'
                    AND (app.actor_kind() = 'HOST'
                         OR (app.actor_kind() = 'WORKER'
                             AND app.worker_name() IN ('hold_expiry', 'booking_conversion')))
                    AND EXISTS (SELECT 1 FROM core.booking_checkout_hold h
                                 WHERE h.id = payment_payment_operation.hold_id
                                   AND h.kind = 'REQUEST'
                                   AND h.status IN ('ACTIVE', 'EXPIRED', 'RELEASED',
                                                    'COMPENSATED')))));
-- affinage de la capture par l'hôte (PENDING → SUBMITTED avec la référence du PSP)
CREATE POLICY cmd_hold_request_pay_upd ON core.payment_payment_operation FOR UPDATE
  TO cmd_hold_owner
  USING (app.actor_kind() = 'HOST' AND purpose = 'RENT' AND kind = 'CAPTURE' AND status = 'PENDING'
         AND EXISTS (SELECT 1 FROM core.booking_checkout_hold h
                      WHERE h.id = payment_payment_operation.hold_id AND h.kind = 'REQUEST'
                        AND h.org_id = app.org_id()))
  WITH CHECK (app.actor_kind() = 'HOST' AND status = 'SUBMITTED');
-- jambes de la capture de l'acceptation (montant explicite de chaque jambe, 08 E7 règle 2)
CREATE POLICY cmd_hold_request_leg_ins ON core.payment_payment_operation_leg FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'HOST' AND trip_id IS NULL
              AND EXISTS (SELECT 1 FROM core.payment_payment_operation o
                            JOIN core.booking_checkout_hold h ON h.id = o.hold_id
                           WHERE o.id = payment_payment_operation_leg.operation_id
                             AND o.kind = 'CAPTURE' AND o.status = 'PENDING'
                             AND o.purpose = 'RENT' AND h.kind = 'REQUEST'
                             AND h.org_id = app.org_id()));
CREATE POLICY cmd_hold_request_opevent_ins ON core.payment_payment_operation_event FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'HOST' AND source = 'API_RESPONSE' AND raw_ref IS NULL
              AND status = 'SUBMITTED' AND outcome = 'APPLIED'
              AND EXISTS (SELECT 1 FROM core.payment_payment_operation o
                            JOIN core.booking_checkout_hold h ON h.id = o.hold_id
                           WHERE o.id = payment_payment_operation_event.operation_id
                             AND o.kind = 'CAPTURE' AND h.kind = 'REQUEST'
                             AND h.org_id = app.org_id()));
-- commande VOID de l'opération VOID d'une demande
CREATE POLICY cmd_hold_request_command_ins ON core.payment_payment_command FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (operation_kind = 'VOID' AND status = 'PENDING'
              AND (app.actor_kind() = 'HOST'
                   OR (app.actor_kind() = 'WORKER'
                       AND app.worker_name() IN ('hold_expiry', 'booking_conversion')))
              AND EXISTS (SELECT 1 FROM core.payment_payment_operation o
                            JOIN core.booking_checkout_hold h ON h.id = o.hold_id
                           WHERE o.id = payment_payment_command.operation_id
                             AND o.hold_id = payment_payment_command.hold_id
                             AND o.kind = 'VOID' AND h.kind = 'REQUEST'));
-- événements booking.request.* (17 annexe des événements) ; refus d'accès de l'hôte journalisé
CREATE POLICY cmd_hold_request_event_ins ON core.outbox_outbox_event FOR INSERT TO cmd_hold_owner
  WITH CHECK (aggregate_type = 'checkout_hold'
              AND ((app.actor_kind() = 'HOST' AND actor_role = 'HOST'
                    AND actor_user_id = app.actor_id()
                    AND type IN ('booking.request.accepted', 'booking.request.declined',
                                 'booking.request.access_denied'))
                OR (app.actor_kind() = 'WORKER' AND actor_role = 'SYSTEM'
                    AND app.worker_name() IN ('hold_expiry', 'booking_conversion')
                    AND type IN ('booking.request.received', 'booking.request.expired',
                                 'booking.request.void_requested'))));

-- lecture de la supervision : commandes VOID en attente (escalade, exigence d'argent c)
CREATE POLICY worker_ops_monitor_read ON core.payment_payment_command FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'ops_monitor');

-- lecture des demandes par l'hôte (host_view_owner, comme les trips de l'hôte, 0101)
GRANT SELECT (kind, status, org_id, country_code, vehicle_id, guest_user_id, request_respond_by)
  ON core.booking_checkout_hold TO host_view_owner;
GRANT EXECUTE ON FUNCTION core.booking_checkout_capture_terms(uuid) TO host_view_owner;


-- 5. Commandes et lectures sous cmd_hold_owner (SECURITY DEFINER, liste blanche RLS-15) ------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 5.1 Pose d'un hold d'un type donné (corps de 0097 recopié, changements marqués US-223c) ;
-- SECURITY INVOKER, aucun EXECUTE : appelée par les commandes de cmd_hold_owner seulement
CREATE FUNCTION core.booking_place_hold_kind(
  p_vehicle_id uuid,
  p_start      timestamptz,
  p_end        timestamptz,
  p_flagged    boolean,
  p_kind       text
)
  RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest      uuid := app.actor_id();
  v_org        uuid;
  v_country    text;
  v_holder     uuid;
  v_org_status text;
  v_buffer     integer;
  v_ttl        integer;
  v_max_total  integer;
  v_max_live   integer;
  v_rate       integer;
  v_grace      integer;
  v_order      text;
  v_review     boolean;
  v_minutes    integer;
  v_live       integer;
  v_overlap    boolean;
  v_recent     integer;
  v_now        timestamptz;
  v_expires_at timestamptz;
  v_period     tstzrange;
  v_hold       uuid := pg_catalog.gen_random_uuid();
  v_occupancy  uuid := pg_catalog.gen_random_uuid();
  v_max_days   integer;
  v_notice     integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  -- US-223c : type du hold posé une fois, à la pose (colonne gardée) ; REQUEST : demande à l'hôte
  IF p_kind IS NULL OR p_kind NOT IN ('CHECKOUT', 'REQUEST') THEN
    RAISE EXCEPTION 'hold: invalid kind'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hold_kind_valid';
  END IF;
  -- US-049 (RT-CONC-02) : bornes finies (une fin infinie occuperait le véhicule sans limite)
  IF p_vehicle_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT pg_catalog.isfinite(p_start)
     OR NOT pg_catalog.isfinite(p_end) OR p_end <= p_start OR p_start <= platform.now() THEN
    RAISE EXCEPTION 'hold: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;

  SELECT p.org_id, p.country_code INTO v_org, v_country
    FROM core.booking_vehicle_party(p_vehicle_id) AS p;
  IF v_org IS NULL OR v_country IS NULL THEN
    RAISE EXCEPTION 'hold: vehicle unknown'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_vehicle_unknown';
  END IF;
  SELECT o.holder_user_id, o.status INTO v_holder, v_org_status
    FROM core.iam_organization o
   WHERE o.id = v_org AND o.country_code = v_country;
  IF v_org_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'hold: host not active'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_host_not_active';
  END IF;
  -- self_booking_forbidden (16 BKG-012, ACC-014 ; OQ-P2P-09). US-049 (F-RLS-02) : le titulaire et
  -- tout membre du compte d'hôte du véhicule. US-127 (ADR-110) : aussi tout membre d'un autre
  -- compte d'hôte du titulaire (autre pays) et tout compte lié à l'une de ces personnes (constat
  -- de l'ops, même identité vérifiée, même téléphone). Le même refus, sans détail, avant toute
  -- lecture de l'occupation ; le signalement à l'ops est la commande
  -- core.booking_cmd_report_self_booking (transaction distincte : ce refus annule celle-ci)
  IF core.risk_self_booking_signal(v_guest, v_org) IS NOT NULL THEN
    RAISE EXCEPTION 'hold: self booking'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_self_booking';
  END IF;
  -- US-109 (16 ADM-005, BKG-012 ; 08 BR-ACC-10) : une restriction ACTIVE du voyageur refuse toute
  -- réservation ; celle du titulaire du compte d'hôte ferme ses véhicules (L1-PM-33)
  IF EXISTS (SELECT 1 FROM core.iam_restriction r WHERE r.user_id = v_guest AND r.active) THEN
    RAISE EXCEPTION 'hold: account restricted'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_account_restricted';
  END IF;
  IF EXISTS (SELECT 1 FROM core.iam_restriction r WHERE r.user_id = v_holder AND r.active) THEN
    RAISE EXCEPTION 'hold: host not active'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_host_not_active';
  END IF;
  -- US-122 (ADR-124, F2-D-03 ; 16 VER-004 « paiement refusé ») : consentement biométrique
  -- retiré (vérification courante en RECHECK, CONSENT_WITHDRAWN) : aucune réservation. Le
  -- contrôle complet de l'éligibilité du conducteur à la pose reste à US-209
  IF core.kyc_consent_withdrawn(v_guest) THEN
    RAISE EXCEPTION 'hold: biometric consent withdrawn'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_kyc_consent_withdrawn';
  END IF;

  v_buffer    := core.booking_param_int('buffer_minutes', v_country);
  v_ttl       := core.booking_param_int('hold_ttl_minutes', v_country);
  v_max_total := core.booking_param_int('hold_max_total_minutes', v_country);
  v_max_live  := core.booking_param_int('max_active_holds_per_guest', v_country);
  v_rate      := core.booking_param_int('hold_creations_per_guest_vehicle_hour', v_country);
  v_grace     := core.booking_param_int('sweep_grace_s', v_country);
  v_max_days  := core.booking_param_int('max_trip_days', v_country);  -- US-049 (RT-CONC-02)
  v_review    := COALESCE(p_flagged, true)
                 AND COALESCE(core.booking_param_text('flagged_booking_payment_order', v_country),
                              'REVIEW_BEFORE_CHARGE') IS DISTINCT FROM 'PAY_THEN_REVIEW';
  IF v_review THEN
    v_minutes := core.booking_param_int('review_hold_minutes', v_country);
  ELSE
    v_minutes := LEAST(v_ttl, v_max_total);
  END IF;
  -- US-119 (16 CAL-003, 08 BR-BOOK-04) : préavis du lieu de remise du véhicule, sinon du pays
  v_notice    := core.catalog_effective_notice_minutes(p_vehicle_id);
  IF v_buffer IS NULL OR v_ttl IS NULL OR v_max_total IS NULL OR v_max_live IS NULL
     OR v_rate IS NULL OR v_grace IS NULL OR v_minutes IS NULL OR v_minutes < 1
     OR v_max_days IS NULL OR v_max_days < 1 OR v_notice IS NULL THEN
    RAISE EXCEPTION 'hold: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  -- US-049 (RT-CONC-02) : durée de location au plus max_trip_days jours du pays (17 §7.2, ADM-031)
  IF p_end - p_start > pg_catalog.make_interval(days => v_max_days) THEN
    RAISE EXCEPTION 'hold: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;
  -- US-119 : départ au plus tôt à platform.now() + préavis (borne incluse : 3 h pile acceptée,
  -- 2 h 59 refusée)
  IF p_start < platform.now() + pg_catalog.make_interval(mins => v_notice) THEN
    RAISE EXCEPTION 'hold: advance notice too short'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_notice_too_short';
  END IF;
  v_period := core.booking_occupied_period(p_start, p_end, v_buffer);

  -- 0. verrous : guest puis véhicule (ordre global, 17 §2.5, VERIF_16-M2)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || p_vehicle_id::text, 0));

  -- 2a. expiration ciblée : texte EXPIRY_2A_SQL de test/support/expiry-2a.ts (17 §2.5,
  -- VERIF_16-M14, VERIF_17-A3 / A6), aux paramètres près (égalité vérifiée par expiry-2a.test.ts)
  WITH t AS (SELECT platform.now() AS ts),
     due AS (
       SELECT h.id, h.occupancy_id
         FROM core.booking_checkout_hold h, t
        WHERE (h.vehicle_id = p_vehicle_id OR h.guest_user_id = v_guest)
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

  -- 2b. contrôles entre hôtes, sous le verrou du voyageur (17 §2.3, RLS-3, RLS-4) : holds vivants
  -- tous hôtes confondus, chevauchement avec ses trips (période sans tampon, BR-BOOK-08)
  SELECT g.live_holds, g.trip_overlap INTO v_live, v_overlap
    FROM platform.guest_hold_guard(pg_catalog.tstzrange(p_start, p_end, '[)')) AS g;
  IF v_live IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF v_overlap THEN
    RAISE EXCEPTION 'hold: guest overlap'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_guest_overlap';
  END IF;
  IF v_live >= v_max_live THEN
    RAISE EXCEPTION 'hold: live hold limit reached'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_guest_limit';
  END IF;
  -- rotation (17 §2.5 M5) : poses du voyageur sur ce véhicule dans l'heure glissante
  v_now := platform.now();
  SELECT pg_catalog.count(*)::integer INTO v_recent
    FROM core.booking_checkout_hold h
   WHERE h.guest_user_id = v_guest AND h.vehicle_id = p_vehicle_id
     AND h.created_at > v_now - pg_catalog.make_interval(hours => 1);
  IF v_recent >= v_rate THEN
    RAISE EXCEPTION 'hold: rate limited'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_rate_limited';
  END IF;

  -- 2c. occupation HOLD [début, fin + tampon) puis hold ; pas de guest_occupancy (17 §2.5)
  v_expires_at := v_now + pg_catalog.make_interval(mins => v_minutes);
  -- 23P01 vehicle_occupancy_no_overlap possible ici : créneau pris (2d : VEHICLE_UNAVAILABLE)
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          ref_type, ref_id, created_by)
  VALUES (v_occupancy, p_vehicle_id, v_org, v_country, 'HOLD', 'CHECKOUT', v_period, true,
          v_expires_at, 'HOLD', v_hold, v_guest);
  -- 23505 one_live_hold_per_guest_vehicle possible ici : hold vivant du même voyageur
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
          expires_at, review_required, created_at, created_by)
  VALUES (v_hold, v_guest, p_vehicle_id, v_org, v_country, v_occupancy, p_kind, 'ACTIVE',
          v_expires_at, v_review, v_now, v_guest);

  -- booking.hold.created (17 §2.5 : seul événement avant la preuve de paiement) ; aucune donnée
  -- du voyageur dans le contenu (l'acteur est dans l'enveloppe)
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.hold.created', 1, 'checkout_hold', v_hold, 0, v_country, v_guest, 'GUEST',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', v_hold, 'vehicle_id', p_vehicle_id,
                                        'org_id', v_org, 'expires_at', v_expires_at,
                                        'review_required', v_review),
          v_hold::text);
  RETURN v_hold;
END
$fn$;
COMMENT ON FUNCTION core.booking_place_hold_kind(uuid, timestamptz, timestamptz, boolean, text) IS
  'Pose d''un hold CHECKOUT ou REQUEST (type écrit une fois, à l''insertion). SECURITY INVOKER, '
  'appelée par core.booking_cmd_place_hold et core.booking_cmd_checkout. US-023, US-223.';

-- Pose d'un hold du checkout : même signature, mêmes droits ; type CHECKOUT
CREATE OR REPLACE FUNCTION core.booking_cmd_place_hold(
  p_vehicle_id uuid,
  p_start      timestamptz,
  p_end        timestamptz,
  p_flagged    boolean
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN core.booking_place_hold_kind(p_vehicle_id, p_start, p_end, p_flagged, 'CHECKOUT');
END
$fn$;

-- 5.2 Checkout (corps de 0112 recopié, changements marqués US-223c, étape 2)
CREATE OR REPLACE FUNCTION core.booking_cmd_checkout(p_token_hash bytea, p_quote_id uuid,
                                                     p_driver_first text, p_driver_last text,
                                                     p_manual_confirmed boolean,
                                                     p_documents jsonb)
  RETURNS TABLE (outcome text, hold_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user       uuid;
  q            record;
  v_vehicle    uuid;
  v_status     text;
  v_instant    boolean;
  v_trans      text;
  v_org        uuid;
  v_country    text;
  v_terms      record;
  v_rows       jsonb := '[]'::jsonb;
  v_hold       uuid;
  v_exp        timestamptz;
  v_prev_kind  text;
  v_prev_actor text;
  v_constraint text;
  v_code       text;
  v_risk       record;  -- US-209
  v_kind       text := 'CHECKOUT';  -- US-223c
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- verrou du voyageur, la clé de la pose du hold (ordre voyageur → véhicule, 17 §2.5) : deux
  -- checkouts du même devis l'un après l'autre
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_user::text, 0));

  -- 1. devis du voyageur (16 PRC-025, BKG-001)
  SELECT pq.id, pq.listing_id, pq.country_code, pq.status, pq.period, pq.expires_at INTO q
    FROM core.pricing_quote AS pq
   WHERE pq.id = p_quote_id AND pq.guest_user_id = v_user;
  IF q.id IS NULL THEN
    RETURN QUERY SELECT 'QUOTE_NOT_FOUND'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.booking_checkout_acceptance AS a WHERE a.quote_id = q.id) THEN
    RETURN QUERY SELECT 'QUOTE_ALREADY_USED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF q.status IS DISTINCT FROM 'FROZEN' OR q.expires_at IS NULL OR q.expires_at <= platform.now()
  THEN
    RETURN QUERY SELECT 'QUOTE_EXPIRED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- N-129 : seules les lignes rejouées par la base (0102, 0110) engagent un prix
  IF EXISTS (SELECT 1 FROM core.pricing_quote_line AS ln
              WHERE ln.quote_id = q.id
                AND ln.line_type NOT IN ('TRIP_PRICE', 'TRIP_FEE', 'PROTECTION')) THEN
    RETURN QUERY SELECT 'QUOTE_LINE_NOT_SUPPORTED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- US-226 (16 PRT-011) : aucun trip sans protection
  IF NOT EXISTS (SELECT 1 FROM core.pricing_quote_line AS ln
                  WHERE ln.quote_id = q.id AND ln.line_type = 'PROTECTION') THEN
    RETURN QUERY SELECT 'PROTECTION_LEVEL_REQUIRED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- US-226 (16 PRT-001) : aucune réservation sans contrat d'assureur actif dans le pays
  IF NOT core.config_go_live('insurer_contract_active', q.country_code::text) THEN
    RETURN QUERY SELECT 'INSURER_CONTRACT_INACTIVE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- 2. annonce publiée, hôte activable, réservation immédiate (N-128)
  SELECT l.vehicle_id, l.status, l.instant_book, v.transmission, v.org_id, v.country_code
    INTO v_vehicle, v_status, v_instant, v_trans, v_org, v_country
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id
   WHERE l.id = q.listing_id;
  IF v_status IS DISTINCT FROM 'LISTED' OR v_country IS DISTINCT FROM q.country_code::text
     OR NOT core.catalog_search_host_open(v_org, v_country) THEN
    RETURN QUERY SELECT 'LISTING_UNAVAILABLE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- US-223c (ADR-146 ; 17 §2.5 « Hold de demande REQUEST ») : une annonce sur demande devient une
  -- demande à l'hôte (hold REQUEST) seulement si le mode est ouvert dans le pays
  -- (booking_request_mode_enabled, faux par défaut) ; sinon REQUEST_MODE_UNAVAILABLE, jamais un
  -- hold INSTANT (N-128, DoR 2 d'US-223)
  IF v_instant IS DISTINCT FROM true THEN
    IF core.booking_param_bool('booking_request_mode_enabled', v_country) IS DISTINCT FROM true
    THEN
      RETURN QUERY SELECT 'REQUEST_MODE_UNAVAILABLE'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    v_kind := 'REQUEST';
  END IF;

  -- 3. conducteur (16 BKG-025, BKG-002)
  IF v_trans = 'MANUAL' AND p_manual_confirmed IS DISTINCT FROM true THEN
    RETURN QUERY SELECT 'MANUAL_TRANSMISSION_NOT_CONFIRMED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF NOT core.iam_holder_name_matches(v_user, p_driver_first, p_driver_last) THEN
    RETURN QUERY SELECT 'DRIVER_MUST_BE_ACCOUNT_HOLDER'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- 3 bis. US-209 (16 BKG-012, ADM-029, VER-007 ; ADR-135) : conducteur et règles de risque
  -- jugés AVANT la pose ; un conducteur inéligible est refusé APRÈS la pose, dans la
  -- sous-transaction : l'auto-réservation reste jugée et signalée en premier (US-127)
  SELECT * INTO v_risk
    FROM core.booking_checkout_risk(v_user, v_vehicle, pg_catalog.lower(q.period),
                                    pg_catalog.upper(q.period), v_country);

  -- 4. documents acceptés puis pose du hold, ensemble : un refus de la pose annule aussi les
  -- consentements (sous-transaction). Aucune demande (NULL) : rien d'accepté (la liste des
  -- versions à afficher n'est jamais une acceptation)
  IF p_documents IS NULL THEN
    RETURN QUERY SELECT 'TERMS_NOT_ACCEPTED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  BEGIN
    FOR v_terms IN SELECT * FROM core.ctr_checkout_terms(v_user, v_country, p_documents) LOOP
      IF v_terms.outcome <> 'DONE' OR v_terms.consent_id IS NULL THEN
        RETURN QUERY SELECT CASE WHEN v_terms.outcome = 'DONE' THEN 'TERMS_NOT_ACCEPTED'
                                 ELSE v_terms.outcome END, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;
      v_rows := v_rows || pg_catalog.jsonb_build_object(
        'kind', v_terms.doc_kind, 'template', v_terms.template_id, 'version', v_terms.doc_version,
        'locale', v_terms.locale, 'consent', v_terms.consent_id);
    END LOOP;
    IF pg_catalog.jsonb_array_length(v_rows) <> 3 THEN
      RAISE EXCEPTION 'checkout: terms incomplete'
        USING ERRCODE = 'internal_error', CONSTRAINT = 'booking_checkout_terms_incomplete';
    END IF;
    -- la pose lit le voyageur dans le contexte de session : celui de la session vérifiée,
    -- remis à sa valeur précédente aussitôt (annulé avec la sous-transaction en cas de refus)
    v_prev_kind := pg_catalog.current_setting('app.actor_kind', true);
    v_prev_actor := pg_catalog.current_setting('app.actor_id', true);
    PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
    PERFORM pg_catalog.set_config('app.actor_id', v_user::text, true);
    -- US-209 : réservation signalée (ADM-029) ⇒ hold de revue selon flagged_booking_payment_order
    -- US-223c : type du hold (CHECKOUT ou REQUEST) posé à la pose, jamais après
    v_hold := core.booking_place_hold_kind(v_vehicle, pg_catalog.lower(q.period),
                                           pg_catalog.upper(q.period), v_risk.flagged, v_kind);
    -- US-209 : conducteur inéligible ⇒ refus, la pose et les consentements sont annulés
    IF v_risk.outcome IS DISTINCT FROM 'ELIGIBLE' THEN
      RAISE EXCEPTION 'checkout: driver not eligible'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'checkout_driver_ineligible';
    END IF;
    -- US-209 : journal explicable (BR-TRUST-01) et file RISK_BOOKING si signalée (ADM-029),
    -- dans la sous-transaction : une mise en file impossible annule aussi la pose
    PERFORM core.booking_checkout_record_risk(v_hold, v_user, v_org, v_country, v_risk.rules,
                                              v_risk.score, v_risk.flagged);
    PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_prev_kind, ''), true);
    PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_prev_actor, ''), true);
  EXCEPTION
    WHEN object_not_in_prerequisite_state OR check_violation OR exclusion_violation
         OR unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      v_code := CASE v_constraint
        WHEN 'vehicle_occupancy_no_overlap' THEN 'DATES_UNAVAILABLE'
        WHEN 'hold_notice_too_short' THEN 'DATES_NOTICE_TOO_SHORT'
        WHEN 'occupancy_period_invalid' THEN 'QUOTE_EXPIRED'
        WHEN 'hold_guest_overlap' THEN 'GUEST_OVERLAP'
        WHEN 'one_live_hold_per_guest_vehicle' THEN 'HOLD_ALREADY_LIVE'
        WHEN 'hold_guest_limit' THEN 'HOLD_LIMIT_REACHED'
        WHEN 'hold_rate_limited' THEN 'HOLD_RATE_LIMITED'
        WHEN 'hold_self_booking' THEN 'SELF_BOOKING_FORBIDDEN'
        WHEN 'hold_account_restricted' THEN 'ACCOUNT_RESTRICTED'
        -- US-209 (N-122) : un seul code stable pour le consentement biométrique retiré
        WHEN 'hold_kyc_consent_withdrawn' THEN 'KYC_BIOMETRIC_CONSENT_MISSING'
        WHEN 'hold_host_not_active' THEN 'LISTING_UNAVAILABLE'
        WHEN 'hold_vehicle_unknown' THEN 'LISTING_UNAVAILABLE'
        WHEN 'hold_param_missing' THEN 'BOOKING_UNAVAILABLE'
        -- US-209 : KYC_NOT_APPROVED, KYC_BIOMETRIC_CONSENT_MISSING, KYC_LICENSE_EXPIRED,
        -- AGE_CLASS_MISMATCH ou BOOKING_UNAVAILABLE (paramètre absent)
        WHEN 'checkout_driver_ineligible' THEN COALESCE(v_risk.outcome, 'BOOKING_UNAVAILABLE')
        WHEN 'checkout_review_queue_unavailable' THEN 'BOOKING_UNAVAILABLE'
      END;
      IF v_code IS NULL THEN
        RAISE;
      END IF;
      -- US-127 (ADR-110) : la tentative refusée est signalée à l'ops hors de la sous-transaction
      -- annulée (le signalement reste, le hold et les consentements non)
      IF v_code = 'SELF_BOOKING_FORBIDDEN' THEN
        v_prev_kind := pg_catalog.current_setting('app.actor_kind', true);
        v_prev_actor := pg_catalog.current_setting('app.actor_id', true);
        PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
        PERFORM pg_catalog.set_config('app.actor_id', v_user::text, true);
        PERFORM core.booking_cmd_report_self_booking(v_vehicle);
        PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_prev_kind, ''), true);
        PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_prev_actor, ''), true);
      END IF;
      RETURN QUERY SELECT v_code, NULL::uuid, NULL::timestamptz;
      RETURN;
  END;

  -- 5. rattachement (16 BKG-008 : version exacte retrouvable après la réservation)
  SELECT h.expires_at INTO v_exp FROM core.booking_checkout_hold AS h WHERE h.id = v_hold;
  INSERT INTO core.booking_checkout_acceptance (hold_id, quote_id, guest_user_id, country_code,
                                                manual_confirmed_at)
  VALUES (v_hold, q.id, v_user, v_country,
          CASE WHEN v_trans = 'MANUAL' THEN platform.now() END);
  INSERT INTO core.booking_checkout_terms (hold_id, doc_kind, template_id, doc_version, locale,
                                           consent_id)
  SELECT v_hold, r ->> 'kind', (r ->> 'template')::uuid, (r ->> 'version')::integer,
         r ->> 'locale', (r ->> 'consent')::uuid
    FROM pg_catalog.jsonb_array_elements(v_rows) AS x(r);
  RETURN QUERY SELECT 'DONE'::text, v_hold, v_exp;
END
$fn$;

-- 5.3 T1 (corps de 0112 recopié, changements marqués US-223c)
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
  v_elig        text;  -- US-209
  v_kind        text;  -- US-223c : CHECKOUT ou REQUEST
  v_respond     timestamptz;
  v_op_kind     text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL OR p_hold_id IS NULL THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id, ch.country_code, ch.kind, ch.request_respond_by
    INTO v_owner, v_vehicle, v_country, v_kind, v_respond
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
    -- US-223c : demande acceptée, capture de l'hôte en cours : rien n'est rendu au voyageur
    -- (jamais l'opération CAPTURE ni sa clé), il attend la preuve
    IF v_respond IS NOT NULL THEN
      RETURN pg_catalog.jsonb_build_object(
        'outcome', 'VERIFYING', 'operationId', NULL, 'idemSent', NULL,
        'providerReference', NULL, 'amountMinor', NULL, 'currency', NULL,
        'attemptNo', NULL, 'legs', NULL, 'captureMode', 'MANUAL',
        'paymentInFlightUntil', r_hold.payment_in_flight_until);
    END IF;
    SELECT o.id, o.idem_sent, o.provider_reference, o.status, o.provider, o.method,
           o.amount_minor, o.currency, o.attempt_no
      INTO r_op
      FROM core.payment_payment_operation o
     WHERE o.hold_id = p_hold_id AND o.purpose = 'RENT'
       -- US-223c : l'ordre du voyageur d'une demande est l'autorisation (capture MANUAL)
       AND o.kind = CASE WHEN v_kind = 'REQUEST' THEN 'AUTH' ELSE 'CAPTURE' END
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
      'captureMode', CASE WHEN v_kind = 'REQUEST' THEN 'MANUAL' ELSE 'AUTO' END,
      'paymentInFlightUntil', r_hold.payment_in_flight_until);
  END IF;

  -- hold ACTIVE : aucune intention de paiement avant reviewed_at (UXQ-08)
  IF r_hold.review_required AND r_hold.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'payment: booking under review'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hold_review_before_payment';
  END IF;
  -- US-209 (N-53, N-95, N-122 ; L2-PM-21) : contrôles bloquants du voyageur relus avant toute
  -- intention de paiement (restriction, consentement, éligibilité du conducteur)
  v_elig := core.booking_guest_eligibility(p_hold_id);
  IF v_elig IS DISTINCT FROM 'ELIGIBLE' THEN
    RAISE EXCEPTION 'payment: guest not eligible'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = CASE v_elig
                           WHEN 'ACCOUNT_RESTRICTED' THEN 'hold_account_restricted'
                           WHEN 'KYC_BIOMETRIC_CONSENT_MISSING' THEN 'hold_kyc_consent_missing'
                           WHEN 'KYC_NOT_APPROVED' THEN 'hold_kyc_not_approved'
                           WHEN 'KYC_LICENSE_EXPIRED' THEN 'hold_kyc_license_expired'
                           WHEN 'AGE_CLASS_MISMATCH' THEN 'hold_age_class_mismatch'
                           ELSE 'hold_param_missing'
                         END;
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
  -- US-223c (17 §2.5 « Moyens de paiement » d'une demande) : seulement un moyen dont
  -- SUPPORTS_PREAUTH ET SUPPORTS_VOID sont validés pour ce PSP et ce moyen (inconnue = non)
  IF v_kind = 'REQUEST'
     AND NOT (core.payment_capability_bool(r_account.provider, v_country, p_method,
                                           'SUPPORTS_PREAUTH')
              AND core.payment_capability_bool(r_account.provider, v_country, p_method,
                                               'SUPPORTS_VOID')) THEN
    RAISE EXCEPTION 'payment: method unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_method_unavailable';
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
  -- US-223c : demande ⇒ autorisation AUTH (capture MANUAL), jambes du devis figées dès l'envoi ;
  -- sinon capture AUTO
  v_op_kind := CASE WHEN v_kind = 'REQUEST' THEN 'AUTH' ELSE 'CAPTURE' END;
  v_key := pg_catalog.format('hold:%s:%s:a%s', p_hold_id, v_op_kind, v_attempt);
  -- capture AUTO : opération CAPTURE, jambes de capture du devis (08 E7 règle 2)
  INSERT INTO core.payment_payment_operation
         (id, hold_id, psp_account_id, country_code, provider, method, kind, purpose, amount_minor,
          currency, attempt_no, status, idem_plain, idem_sent)
  VALUES (v_op, p_hold_id, p_psp_account_id, v_country, r_account.provider, p_method, v_op_kind,
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
    'captureMode', CASE WHEN v_kind = 'REQUEST' THEN 'MANUAL' ELSE 'AUTO' END,
    'paymentInFlightUntil', v_bound);
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_start_payment(uuid, uuid, text) IS
  'Commande : intention de paiement T1 (17 §2.5 étape 3a), voyageur de la session ; aucune avant la '
  'revue (UXQ-08) ni pour un voyageur devenu inéligible (US-209) ; environnement NULL = production '
  '(fail-closed) ; demande (REQUEST) : autorisation AUTH, capture MANUAL, moyen PREAUTH et VOID '
  'validés. US-024, US-025, US-209, US-223.';

-- 5.4 T2 (corps de 0040 recopié, changements marqués US-223c)
CREATE OR REPLACE FUNCTION core.booking_cmd_record_order(
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
  v_kind    text;         -- US-223c
  v_respond timestamptz;  -- US-223c
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL OR p_hold_id IS NULL
     OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF p_provider_reference IS NULL OR p_provider_reference !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'payment: invalid provider reference' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id, ch.country_code, ch.kind, ch.request_respond_by
    INTO v_owner, v_vehicle, v_country, v_kind, v_respond
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id;
  -- US-223c : la capture d'une demande acceptée appartient à l'hôte, jamais au voyageur
  IF v_owner IS DISTINCT FROM v_guest OR v_respond IS NOT NULL THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  SELECT o.status, o.provider, o.method, o.provider_reference INTO r_op
    FROM core.payment_payment_operation o
   WHERE o.id = p_operation_id AND o.hold_id = p_hold_id AND o.purpose = 'RENT'
     -- US-223c : l'ordre du voyageur d'une demande est son autorisation (AUTH)
     AND o.kind = CASE WHEN v_kind = 'REQUEST' THEN 'AUTH' ELSE 'CAPTURE' END;
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

-- 5.5 Conditions de paiement du hold (corps de 0116 recopié) : aussi une demande
CREATE OR REPLACE FUNCTION core.booking_checkout_capture_terms(p_hold_id uuid)
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
     -- US-223c : demande à l'hôte (REQUEST) : même devis engagé au checkout
     AND h.kind IN ('CHECKOUT', 'REQUEST')
     AND q.guest_user_id = h.guest_user_id
     AND q.country_code = h.country_code
     AND q.status = 'FROZEN'
$fn$;

-- 7. VOID total d'une demande (17 §2.5 exigence d'argent b et c) ------------------------------------
-- Opération VOID (aucune jambe : contrôle différé payment_operation_legs_check) de l'autorisation
-- p_auth_op, puis sa commande VOID dans la boîte d'envoi (clé stockée : une seule commande quel
-- que soit le nombre de rejeux). Aucun débit, aucune variation de jambe (≠ VOID du reliquat après
-- une capture partielle, TJ03). Appelée par le refus de l'hôte, l'expiration (hold_expiry), la
-- preuve tardive d'une autorisation et la capture refusée (booking_conversion) ; la politique
-- cmd_hold_request_pay_ins n'admet qu'une demande terminée.
CREATE FUNCTION core.booking_request_void(p_hold_id uuid, p_auth_op uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_void uuid;
  v_key  text;
  r_auth record;
BEGIN
  IF NOT (app.actor_kind() IS NOT DISTINCT FROM 'HOST'
          OR (app.actor_kind() IS NOT DISTINCT FROM 'WORKER'
              AND app.worker_name() IN ('hold_expiry', 'booking_conversion'))) THEN
    RAISE EXCEPTION 'request: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  SELECT o.id, o.psp_account_id, o.country_code, o.provider, o.method, o.amount_minor, o.currency,
         o.attempt_no
    INTO r_auth
    FROM core.payment_payment_operation AS o
    JOIN core.booking_checkout_hold AS h ON h.id = o.hold_id
   WHERE o.id = p_auth_op AND o.hold_id = p_hold_id AND o.purpose = 'RENT' AND o.kind = 'AUTH'
     AND h.kind = 'REQUEST';
  IF r_auth.id IS NULL THEN
    RAISE EXCEPTION 'request: authorization of another hold'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'request_void_authorization';
  END IF;
  v_key := pg_catalog.format('hold:%s:VOID:a%s', p_hold_id, r_auth.attempt_no);
  SELECT o.id INTO v_void FROM core.payment_payment_operation AS o WHERE o.idem_plain = v_key;
  IF v_void IS NULL THEN
    v_void := pg_catalog.gen_random_uuid();
    INSERT INTO core.payment_payment_operation
           (id, hold_id, psp_account_id, country_code, provider, method, kind, purpose,
            amount_minor, currency, attempt_no, status, idem_plain, idem_sent)
    VALUES (v_void, p_hold_id, r_auth.psp_account_id, r_auth.country_code, r_auth.provider,
            r_auth.method, 'VOID', 'RENT', r_auth.amount_minor, r_auth.currency,
            r_auth.attempt_no, 'PENDING', v_key, v_key);
  END IF;
  INSERT INTO core.payment_payment_command
         (id, operation_kind, idem_plain, operation_id, hold_id, country_code, partition_key)
  VALUES (pg_catalog.gen_random_uuid(), 'VOID',
          'hold:' || p_hold_id::text || ':VOID:' || v_void::text || ':a1',
          v_void, p_hold_id, r_auth.country_code, p_hold_id::text)
  ON CONFLICT ON CONSTRAINT payment_command_idem_unique DO NOTHING;
  RETURN v_void;
END
$fn$;
COMMENT ON FUNCTION core.booking_request_void(uuid, uuid) IS
  'VOID total de l''autorisation d''une demande terminée : opération VOID sans jambe et commande '
  'VOID de la boîte d''envoi (une seule par clé). Hôte (refus), hold_expiry, booking_conversion. '
  'US-223 (ADR-146).';

-- 8. Preuve de l'autorisation d'une demande (17 §2.5 « Envoi ») -------------------------------------
-- Appelée par core.booking_convert_payment (travailleur booking_conversion) pour l'AUTH prouvée
-- d'un hold REQUEST : jamais de trip ni de disposition. Hold en vol de la tentative en cours ⇒
-- AWAITING_HOST, request_respond_by = expires_at = platform.now() + booking_request_expiry_hours
-- (écrits une fois, déclencheur hold_guarded_columns), occupation HOLD gardée jusque-là,
-- booking.request.received ; hold sorti (EXPIRED, RELEASED, COMPENSATED, ACTIVE) ⇒ VOID ; demande
-- déjà en attente ou acceptée ⇒ REPLAY (rien).
CREATE FUNCTION core.booking_request_authorized(p_operation_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid;
  v_vehicle uuid;
  v_hours   integer;
  v_now     timestamptz;
  v_respond timestamptz;
  n         integer;
  r_op      record;
  r_hold    record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'booking_conversion' THEN
    RAISE EXCEPTION 'conversion: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  SELECT o.hold_id, o.status, o.kind, o.proof_type, o.attempt_no INTO r_op
    FROM core.payment_payment_operation AS o
   WHERE o.id = p_operation_id AND o.purpose = 'RENT';
  IF r_op.hold_id IS NULL OR r_op.kind IS DISTINCT FROM 'AUTH'
     OR r_op.status IS DISTINCT FROM 'SUCCEEDED' OR r_op.proof_type IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_APPLICABLE');
  END IF;
  SELECT h.guest_user_id, h.vehicle_id INTO v_guest, v_vehicle
    FROM core.booking_checkout_hold AS h
   WHERE h.id = r_op.hold_id AND h.kind = 'REQUEST';
  IF v_guest IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_APPLICABLE');
  END IF;
  -- verrous voyageur puis véhicule (ordre global, 17 §2.5 M2), comme la conversion
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  SELECT h.status, h.request_respond_by, h.payment_attempts, h.occupancy_id, h.org_id,
         h.country_code
    INTO r_hold
    FROM core.booking_checkout_hold AS h
   WHERE h.id = r_op.hold_id;
  IF r_hold.request_respond_by IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'REPLAY');
  END IF;
  IF r_hold.status = 'PAYMENT_IN_FLIGHT' AND r_op.attempt_no = r_hold.payment_attempts + 1 THEN
    v_hours := core.booking_param_int('booking_request_expiry_hours', r_hold.country_code);
    IF v_hours IS NULL OR v_hours < 1 THEN
      RAISE EXCEPTION 'request: parameter missing'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
    END IF;
    v_now := platform.now();
    v_respond := v_now + pg_catalog.make_interval(hours => v_hours);
    UPDATE core.booking_checkout_hold
       SET status = 'AWAITING_HOST', request_respond_by = v_respond, expires_at = v_respond,
           payment_in_flight_until = NULL
     WHERE id = r_op.hold_id AND status = 'PAYMENT_IN_FLIGHT' AND request_respond_by IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 1 THEN
      -- créneau « demande en attente » du calendrier de l'hôte jusqu'à l'heure limite
      UPDATE core.booking_vehicle_occupancy
         SET expires_at = v_respond
       WHERE id = r_hold.occupancy_id AND kind = 'HOLD' AND active;
      INSERT INTO core.outbox_outbox_event
             (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_role, correlation_id, payload, partition_key)
      VALUES ('booking.request.received', 1, 'checkout_hold', r_op.hold_id, 1,
              r_hold.country_code, 'SYSTEM', pg_catalog.gen_random_uuid(),
              pg_catalog.jsonb_build_object('hold_id', r_op.hold_id, 'vehicle_id', v_vehicle,
                                            'org_id', r_hold.org_id,
                                            'request_respond_by', v_respond),
              r_op.hold_id::text);
      RETURN pg_catalog.jsonb_build_object('outcome', 'AWAITING_HOST', 'respondBy', v_respond);
    END IF;
  END IF;
  IF r_hold.status NOT IN ('ACTIVE', 'EXPIRED', 'RELEASED', 'COMPENSATED') THEN
    -- tentative périmée d'un hold encore en vol : rien (l'oracle C12 la signale si elle dure)
    RETURN pg_catalog.jsonb_build_object('outcome', 'WAITING');
  END IF;
  -- autorisation prouvée après la sortie du hold : annulée, jamais capturée
  PERFORM core.booking_request_void(r_op.hold_id, p_operation_id);
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.request.void_requested', 1, 'checkout_hold', r_op.hold_id, 2,
          r_hold.country_code, 'SYSTEM', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', r_op.hold_id, 'operation_id', p_operation_id,
                                        'reason', 'LATE_AUTHORIZATION'),
          r_op.hold_id::text);
  RETURN pg_catalog.jsonb_build_object('outcome', 'VOID_REQUESTED');
END
$fn$;
COMMENT ON FUNCTION core.booking_request_authorized(uuid) IS
  'Autorisation prouvée d''une demande : AWAITING_HOST et heure limite (booking_request_expiry_'
  'hours), ou VOID si le hold est sorti ; aucune disposition. Travailleur booking_conversion. '
  'US-223 (ADR-146).';

-- 9. Commandes de l'hôte titulaire (17 §2.5 exigences de sécurité 1 et 2) ---------------------------
-- Porte commune (SECURITY INVOKER, appelée par les commandes SECURITY DEFINER de cmd_hold_owner,
-- aucun EXECUTE) : session valide, compte d'hôte TITULAIRE de la session (iam_host_accounts : jamais
-- un co-hôte), hold REQUEST de CE compte et de son pays ; sinon FORBIDDEN, journalisé
-- (booking.request.access_denied), le même pour un hold inconnu, d'un autre compte ou qui n'est
-- pas une demande, sans rien révéler de son état. Contexte posé pour les politiques :
-- app.actor_kind = HOST, app.actor_id = la personne, app.org_id = le compte.
CREATE FUNCTION core.booking_request_host_gate(p_token_hash bytea, p_org uuid, p_hold_id uuid,
                                               p_action text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_user    uuid;
  v_country text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', 'HOST', true);
  PERFORM pg_catalog.set_config('app.actor_id', v_user::text, true);
  PERFORM pg_catalog.set_config('app.org_id', COALESCE(p_org::text, ''), true);
  IF p_org IS NOT NULL THEN
    SELECT a.country_code INTO v_country
      FROM core.iam_host_accounts(p_token_hash) AS a
     WHERE a.org_id = p_org;
  END IF;
  IF v_country IS NULL OR p_hold_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM core.booking_checkout_hold AS h
                     WHERE h.id = p_hold_id AND h.kind = 'REQUEST' AND h.org_id = p_org
                       AND h.country_code = v_country) THEN
    IF p_hold_id IS NOT NULL THEN
      INSERT INTO core.outbox_outbox_event
             (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, payload, partition_key)
      VALUES ('booking.request.access_denied', 1, 'checkout_hold', p_hold_id, 0, v_country, v_user,
              'HOST', pg_catalog.gen_random_uuid(),
              pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'org_id', p_org,
                                            'action', p_action),
              p_hold_id::text);
    END IF;
    RETURN 'FORBIDDEN';
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.booking_request_host_gate(bytea, uuid, uuid, text) IS
  'Porte des commandes de demande : hôte titulaire du compte du hold REQUEST ; FORBIDDEN '
  'journalisé sinon, sans état. Contexte HOST posé. Aucun EXECUTE. US-223 (ADR-146).';

-- Acceptation (17 §2.5 « Acceptation » ; exigence d'argent a) : AWAITING_HOST → PAYMENT_IN_FLIGHT
-- tant que request_respond_by > platform.now() (zéro ligne ⇒ REQUEST_EXPIRED si l'heure limite
-- est passée, sinon INVALID_TRANSITION), puis opération CAPTURE rattachée à l'AUTH prouvée, au
-- montant du devis engagé et au montant EXPLICITE de chaque jambe ; Σ jambes = total du devis ≤
-- montant de l'AUTH, même devise, sinon LEG_SUM_MISMATCH et rien n'est écrit. L'API appelle
-- ensuite capture(amount, legs) avec la clé stockée, puis l'affinage. Rejeu sur une capture en
-- vol : RETRY_SAME_KEY (capture jamais enregistrée, recherche par NOTRE clé d'abord, N-108) ou
-- CAPTURING (rien à faire) ; hold converti : ACCEPTED.
CREATE FUNCTION core.booking_request_accept(p_token_hash bytea, p_org uuid,
                                                        p_hold_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_gate      text;
  v_user      uuid;
  v_guest     uuid;
  v_vehicle   uuid;
  v_country   text;
  v_now       timestamptz;
  v_margin    integer;
  v_timeout   integer;
  v_tolerance integer;
  v_bound     timestamptz;
  v_key       text;
  v_op        uuid := pg_catalog.gen_random_uuid();
  v_keys      text[];
  v_leg       text;
  v_sum       bigint := 0;
  v_elig      text;
  n           integer;
  r_hold      record;
  r_terms     record;
  r_auth      record;
  r_cap       record;
BEGIN
  v_gate := core.booking_request_host_gate(p_token_hash, p_org, p_hold_id, 'ACCEPT');
  IF v_gate IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', v_gate);
  END IF;
  v_user := app.actor_id();
  SELECT h.guest_user_id, h.vehicle_id, h.country_code INTO v_guest, v_vehicle, v_country
    FROM core.booking_checkout_hold AS h WHERE h.id = p_hold_id;
  -- verrous voyageur → véhicule → hold (ordre global, 17 §2.5 M2) : une seule issue face à
  -- l'expiration concurrente (FOR UPDATE : la politique ne verrouille qu'une demande en attente)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  v_now := platform.now();
  SELECT h.status, h.request_respond_by, h.occupancy_id INTO r_hold
    FROM core.booking_checkout_hold AS h
   WHERE h.id = p_hold_id
     FOR UPDATE;
  IF NOT FOUND THEN
    SELECT h.status, h.request_respond_by INTO r_hold
      FROM core.booking_checkout_hold AS h WHERE h.id = p_hold_id;
    IF r_hold.status = 'CONVERTED' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'ACCEPTED');
    END IF;
    IF r_hold.status = 'PAYMENT_IN_FLIGHT' AND r_hold.request_respond_by IS NOT NULL THEN
      -- capture en vol : jamais une seconde capture ; reprise par la même clé si elle n'a jamais
      -- été enregistrée et que le PSP permet de la chercher par NOTRE clé (N-108)
      SELECT o.id, o.idem_sent, o.status, o.provider, o.method, o.provider_reference,
             o.amount_minor, o.currency
        INTO r_cap
        FROM core.payment_payment_operation AS o
       WHERE o.hold_id = p_hold_id AND o.purpose = 'RENT' AND o.kind = 'CAPTURE'
       ORDER BY o.attempt_no DESC, o.created_at DESC
       LIMIT 1;
      IF r_cap.id IS NOT NULL AND r_cap.status = 'PENDING' AND r_cap.provider_reference IS NULL
         AND core.payment_capability_bool(r_cap.provider, v_country, r_cap.method,
                                          'SUPPORTS_LOOKUP_BY_MERCHANT_REF') THEN
        SELECT t.legs INTO r_terms FROM core.booking_hold_payment_terms(p_hold_id) AS t;
        SELECT o.provider_reference INTO r_auth
          FROM core.payment_payment_operation AS o
         WHERE o.hold_id = p_hold_id AND o.purpose = 'RENT' AND o.kind = 'AUTH'
           AND o.status = 'SUCCEEDED' AND o.proof_type IS NOT NULL
         ORDER BY o.attempt_no DESC
         LIMIT 1;
        RETURN pg_catalog.jsonb_build_object(
          'outcome', 'RETRY_SAME_KEY', 'operationId', r_cap.id, 'idemSent', r_cap.idem_sent,
          'amountMinor', r_cap.amount_minor::text, 'currency', r_cap.currency,
          'legs', r_terms.legs, 'provider', r_cap.provider, 'method', r_cap.method,
          'authorizationReference', r_auth.provider_reference);
      END IF;
      RETURN pg_catalog.jsonb_build_object('outcome', 'CAPTURING');
    END IF;
    IF r_hold.status = 'EXPIRED'
       OR (r_hold.status = 'AWAITING_HOST' AND r_hold.request_respond_by <= v_now) THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'REQUEST_EXPIRED');
    END IF;
    RETURN pg_catalog.jsonb_build_object('outcome', 'INVALID_TRANSITION');
  END IF;
  -- heure de la base (17 §1.3) : une acceptation tardive renvoie REQUEST_EXPIRED
  IF r_hold.request_respond_by <= v_now THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'REQUEST_EXPIRED');
  END IF;
  -- N-66 / N-127 : CGU de l'hôte acceptées dans leur version exigée (16 LEG-001)
  IF core.ctr_host_terms_required(v_user, v_country) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'TERMS_REACCEPT_REQUIRED');
  END IF;
  -- contrôles bloquants du voyageur relus avant toute capture (US-209) : aucun débit d'un
  -- voyageur devenu inéligible ; la demande reste en attente (l'hôte peut la refuser)
  v_elig := core.booking_guest_eligibility(p_hold_id);
  IF v_elig IS DISTINCT FROM 'ELIGIBLE' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'GUEST_NOT_ELIGIBLE');
  END IF;

  -- devis engagé au checkout (montant, devise, jambes rejoués par la base, N-157 / N-161)
  SELECT t.amount_minor, t.currency, t.legs, t.scheduled_start INTO r_terms
    FROM core.booking_hold_payment_terms(p_hold_id) AS t;
  -- autorisation prouvée de la demande (la tentative qui l'a fait passer en attente)
  SELECT o.id, o.amount_minor, o.currency, o.provider, o.method, o.psp_account_id,
         o.provider_reference, o.attempt_no
    INTO r_auth
    FROM core.payment_payment_operation AS o
   WHERE o.hold_id = p_hold_id AND o.purpose = 'RENT' AND o.kind = 'AUTH'
     AND o.status = 'SUCCEEDED' AND o.proof_type IS NOT NULL
   ORDER BY o.attempt_no DESC
   LIMIT 1;
  IF r_auth.id IS NULL OR r_auth.provider_reference IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'INVALID_TRANSITION');
  END IF;
  -- 08 E7 règles 1 et 2 ; 17 §2.5 exigence d'argent a : Σ jambes = montant capturé = total du
  -- devis figé ≤ montant de l'AUTH, même devise ; sinon aucune capture
  IF r_terms.amount_minor IS NULL OR r_terms.amount_minor <= 0 OR r_terms.legs IS NULL
     OR pg_catalog.jsonb_typeof(r_terms.legs) <> 'object' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'LEG_SUM_MISMATCH');
  END IF;
  SELECT pg_catalog.array_agg(k ORDER BY k) INTO v_keys
    FROM pg_catalog.jsonb_object_keys(r_terms.legs) AS k;
  IF v_keys IS DISTINCT FROM ARRAY['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'] THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'LEG_SUM_MISMATCH');
  END IF;
  FOREACH v_leg IN ARRAY v_keys LOOP
    IF pg_catalog.jsonb_typeof(r_terms.legs -> v_leg) <> 'string'
       OR (r_terms.legs ->> v_leg) !~ '^[0-9]{1,18}$' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'LEG_SUM_MISMATCH');
    END IF;
    v_sum := v_sum + (r_terms.legs ->> v_leg)::bigint;
  END LOOP;
  IF v_sum <> r_terms.amount_minor OR r_terms.amount_minor > r_auth.amount_minor
     OR r_terms.currency IS DISTINCT FROM r_auth.currency THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'LEG_SUM_MISMATCH');
  END IF;

  v_margin    := core.booking_param_int('payment_in_flight_margin_s', v_country);
  v_timeout   := core.booking_param_int('psp_call_timeout_s', v_country);
  v_tolerance := core.booking_param_int('conversion_start_tolerance_minutes', v_country);
  IF v_margin IS NULL OR v_timeout IS NULL OR v_tolerance IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'PARAM_MISSING');
  END IF;
  -- un trip n'est jamais créé après son début prévu : on ne capture pas pour rien
  IF r_terms.scheduled_start IS NULL
     OR r_terms.scheduled_start < v_now - pg_catalog.make_interval(mins => v_tolerance) THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'START_PASSED');
  END IF;

  v_bound := v_now + pg_catalog.make_interval(secs => v_timeout + v_margin);
  UPDATE core.booking_checkout_hold
     SET status = 'PAYMENT_IN_FLIGHT', payment_in_flight_until = v_bound, updated_by = v_user
   WHERE id = p_hold_id AND status = 'AWAITING_HOST' AND request_respond_by > v_now;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'REQUEST_EXPIRED');
  END IF;
  v_key := pg_catalog.format('hold:%s:CAPTURE:a%s', p_hold_id, r_auth.attempt_no);
  INSERT INTO core.payment_payment_operation
         (id, hold_id, psp_account_id, country_code, provider, method, kind, purpose, amount_minor,
          currency, attempt_no, status, idem_plain, idem_sent)
  VALUES (v_op, p_hold_id, r_auth.psp_account_id, v_country, r_auth.provider, r_auth.method,
          'CAPTURE', 'RENT', r_terms.amount_minor, r_terms.currency, r_auth.attempt_no, 'PENDING',
          v_key, v_key);
  INSERT INTO core.payment_payment_operation_leg
         (operation_id, leg, org_id, trip_id, country_code, amount_minor)
  SELECT v_op, k, p_org, NULL, v_country, (r_terms.legs ->> k)::bigint
    FROM pg_catalog.unnest(v_keys) AS k;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.request.accepted', 1, 'checkout_hold', p_hold_id, 2, v_country, v_user, 'HOST',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'vehicle_id', v_vehicle,
                                        'org_id', p_org, 'operation_id', v_op,
                                        'decision', 'ACCEPTED'),
          p_hold_id::text);
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'CAPTURE_ORDER',
    'operationId', v_op,
    'idemSent', v_key,
    'amountMinor', r_terms.amount_minor::text,
    'currency', r_terms.currency,
    'legs', r_terms.legs,
    'provider', r_auth.provider,
    'method', r_auth.method,
    'authorizationReference', r_auth.provider_reference,
    'paymentInFlightUntil', v_bound);
END
$fn$;
COMMENT ON FUNCTION core.booking_request_accept(bytea, uuid, uuid) IS
  'Acceptation d''une demande par l''hôte titulaire de la session : capture par jambes rattachée à '
  'l''AUTH (Σ jambes = total du devis ≤ AUTH), ou REQUEST_EXPIRED / FORBIDDEN sans état. SECURITY '
  'INVOKER (commande core.booking_cmd_accept_booking_request). US-223 (ADR-146).';

-- Affinage de la capture après capture(amount, legs) chez le PSP : PENDING → SUBMITTED avec la
-- référence rendue ; jamais rétrogradée (preuve déjà appliquée : rien).
CREATE FUNCTION core.booking_request_record_capture(p_token_hash bytea, p_org uuid,
                                                        p_hold_id uuid, p_operation_id uuid,
                                                        p_provider_reference text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_gate text;
  n      integer;
BEGIN
  IF p_provider_reference IS NULL OR p_provider_reference !~ '^[A-Za-z0-9._:-]{1,128}$' THEN
    RAISE EXCEPTION 'payment: invalid provider reference' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_gate := core.booking_request_host_gate(p_token_hash, p_org, p_hold_id, 'RECORD_CAPTURE');
  IF v_gate IS NOT NULL THEN
    RETURN v_gate;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                  WHERE o.id = p_operation_id AND o.hold_id = p_hold_id AND o.purpose = 'RENT'
                    AND o.kind = 'CAPTURE') THEN
    RETURN 'FORBIDDEN';
  END IF;
  UPDATE core.payment_payment_operation
     SET status = 'SUBMITTED', provider_reference = p_provider_reference
   WHERE id = p_operation_id AND status = 'PENDING';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN
    INSERT INTO core.payment_payment_operation_event
           (id, operation_id, status, source, outcome, raw_ref)
    VALUES (pg_catalog.gen_random_uuid(), p_operation_id, 'SUBMITTED', 'API_RESPONSE', 'APPLIED',
            NULL);
  END IF;
  RETURN 'RECORDED';
END
$fn$;
COMMENT ON FUNCTION core.booking_request_record_capture(bytea, uuid, uuid, uuid, text) IS
  'Affinage de la capture d''une demande acceptée (référence du PSP) par l''hôte titulaire. '
  'INVOKER (commande core.booking_cmd_request_record_capture). US-223 (ADR-146).';

-- Refus (17 §2.5 « Refus ») : RELEASED (REQUEST_DECLINED), occupation désactivée, VOID total de
-- l'autorisation, booking.request.declined ; aucun débit. Rejeu : DECLINED.
CREATE FUNCTION core.booking_request_decline(p_token_hash bytea, p_org uuid,
                                                         p_hold_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_gate    text;
  v_user    uuid;
  v_guest   uuid;
  v_vehicle uuid;
  v_country text;
  v_now     timestamptz;
  v_auth    uuid;
  n         integer;
  r_hold    record;
BEGIN
  v_gate := core.booking_request_host_gate(p_token_hash, p_org, p_hold_id, 'DECLINE');
  IF v_gate IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', v_gate);
  END IF;
  v_user := app.actor_id();
  SELECT h.guest_user_id, h.vehicle_id, h.country_code INTO v_guest, v_vehicle, v_country
    FROM core.booking_checkout_hold AS h WHERE h.id = p_hold_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  v_now := platform.now();
  SELECT h.status, h.request_respond_by, h.occupancy_id INTO r_hold
    FROM core.booking_checkout_hold AS h
   WHERE h.id = p_hold_id
     FOR UPDATE;
  IF NOT FOUND THEN
    SELECT h.status, h.request_respond_by, h.release_reason INTO r_hold
      FROM core.booking_checkout_hold AS h WHERE h.id = p_hold_id;
    IF r_hold.status = 'RELEASED' AND r_hold.release_reason = 'REQUEST_DECLINED' THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'DECLINED');
    END IF;
    IF r_hold.status = 'EXPIRED'
       OR (r_hold.status = 'AWAITING_HOST' AND r_hold.request_respond_by <= v_now) THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'REQUEST_EXPIRED');
    END IF;
    RETURN pg_catalog.jsonb_build_object('outcome', 'INVALID_TRANSITION');
  END IF;
  IF r_hold.request_respond_by <= v_now THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'REQUEST_EXPIRED');
  END IF;
  UPDATE core.booking_checkout_hold
     SET status = 'RELEASED', released_at = v_now, released_by = v_user,
         release_reason = 'REQUEST_DECLINED', updated_by = v_user
   WHERE id = p_hold_id AND status = 'AWAITING_HOST';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'INVALID_TRANSITION');
  END IF;
  UPDATE core.booking_vehicle_occupancy
     SET active = false, deactivated_reason = 'HOLD_RELEASED', updated_by = v_user
   WHERE id = r_hold.occupancy_id AND kind = 'HOLD' AND active;
  SELECT o.id INTO v_auth
    FROM core.payment_payment_operation AS o
   WHERE o.hold_id = p_hold_id AND o.purpose = 'RENT' AND o.kind = 'AUTH' AND o.status = 'SUCCEEDED'
   ORDER BY o.attempt_no DESC
   LIMIT 1;
  IF v_auth IS NOT NULL THEN
    PERFORM core.booking_request_void(p_hold_id, v_auth);
  END IF;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.request.declined', 1, 'checkout_hold', p_hold_id, 2, v_country, v_user, 'HOST',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'vehicle_id', v_vehicle,
                                        'org_id', p_org, 'decision', 'DECLINED'),
          p_hold_id::text);
  RETURN pg_catalog.jsonb_build_object('outcome', 'DECLINED');
END
$fn$;
COMMENT ON FUNCTION core.booking_request_decline(bytea, uuid, uuid) IS
  'Refus d''une demande par l''hôte titulaire de la session : RELEASED (REQUEST_DECLINED), créneau '
  'libéré, VOID total ; aucun débit. INVOKER (commande core.booking_cmd_decline_booking_request). '
  'US-223 (ADR-146).';

-- 10. Expiration des demandes (17 §2.5 « Expiration », tâche du travailleur hold_expiry) ------------
-- Demandes AWAITING_HOST dont l'heure limite est passée (horloge de la base) ⇒ EXPIRED, occupation
-- désactivée (HOLD_EXPIRED), VOID total, booking.request.expired. Lignes verrouillées FOR UPDATE
-- SKIP LOCKED : une acceptation en cours garde sa ligne, une seule issue (l'acceptation relit le
-- statut sous verrou et rend REQUEST_EXPIRED si l'expiration l'a précédée).
CREATE FUNCTION core.booking_cmd_expire_booking_requests(p_limit integer)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz;
  v_n    integer := 0;
  v_auth uuid;
  r      record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'hold_expiry' THEN
    RAISE EXCEPTION 'request expiry: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'request expiry: batch size out of bounds' USING ERRCODE = '22023';
  END IF;
  v_now := platform.now();
  FOR r IN
    WITH due AS (
      SELECT h.id
        FROM core.booking_checkout_hold AS h
       WHERE h.kind = 'REQUEST' AND h.status = 'AWAITING_HOST' AND h.request_respond_by <= v_now
       ORDER BY h.request_respond_by, h.id
       LIMIT p_limit
         FOR UPDATE OF h SKIP LOCKED
    )
    UPDATE core.booking_checkout_hold AS h
       SET status = 'EXPIRED', expired_at = v_now
      FROM due
     WHERE h.id = due.id AND h.status = 'AWAITING_HOST'
    RETURNING h.id, h.occupancy_id, h.vehicle_id, h.org_id, h.country_code
  LOOP
    UPDATE core.booking_vehicle_occupancy
       SET active = false, deactivated_reason = 'HOLD_EXPIRED'
     WHERE id = r.occupancy_id AND kind = 'HOLD' AND active;
    v_auth := NULL;
    SELECT o.id INTO v_auth
      FROM core.payment_payment_operation AS o
     WHERE o.hold_id = r.id AND o.purpose = 'RENT' AND o.kind = 'AUTH' AND o.status = 'SUCCEEDED'
     ORDER BY o.attempt_no DESC
     LIMIT 1;
    IF v_auth IS NOT NULL THEN
      PERFORM core.booking_request_void(r.id, v_auth);
    END IF;
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_role, correlation_id, payload, partition_key)
    VALUES ('booking.request.expired', 1, 'checkout_hold', r.id, 2, r.country_code, 'SYSTEM',
            pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('hold_id', r.id, 'vehicle_id', r.vehicle_id,
                                          'org_id', r.org_id, 'decision', 'EXPIRED'),
            r.id::text);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_expire_booking_requests(integer) IS
  'Expiration des demandes AWAITING_HOST échues (horloge de la base) : EXPIRED, créneau libéré, '
  'VOID total. Travailleur hold_expiry (SECURITY DEFINER, EXECUTE app_worker). US-223 (ADR-146).';

-- 11. Lecture de la demande par le voyageur (S05 « demande envoyée », S06) --------------------------
-- Type du hold, état de la demande, heure limite ; aucun montant ni référence du PSP.
--   AUTHORIZING (autorisation pas encore prouvée), AWAITING_HOST, CAPTURING (acceptée, capture en
--   cours), ACCEPTED (trip né), DECLINED, EXPIRED, CAPTURE_FAILED, COMPENSATED, ENDED (sortie avant
--   l'envoi) ; NULL pour un hold CHECKOUT.
CREATE FUNCTION core.booking_checkout_request(p_token_hash bytea, p_hold_id uuid)
  RETURNS TABLE (outcome text, hold_kind text, request_status text,
                 request_respond_by timestamptz)
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
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT ch.kind, ch.status, ch.request_respond_by AS respond_by, ch.release_reason INTO h
    FROM core.booking_checkout_hold AS ch
    JOIN core.booking_checkout_acceptance AS a ON a.hold_id = ch.id
   WHERE ch.id = p_hold_id AND ch.guest_user_id = v_user AND a.guest_user_id = v_user;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'HOLD_NOT_FOUND'::text, NULL::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'DONE'::text, h.kind,
         CASE
           WHEN h.kind <> 'REQUEST' THEN NULL
           WHEN h.status = 'AWAITING_HOST' THEN 'AWAITING_HOST'
           WHEN h.respond_by IS NULL THEN
             CASE WHEN h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT') THEN 'AUTHORIZING'
                  ELSE 'ENDED' END
           WHEN h.status = 'PAYMENT_IN_FLIGHT' THEN 'CAPTURING'
           WHEN h.status = 'CONVERTED' THEN 'ACCEPTED'
           WHEN h.status = 'RELEASED' AND h.release_reason = 'REQUEST_DECLINED' THEN 'DECLINED'
           WHEN h.status = 'RELEASED' AND h.release_reason = 'PAYMENT_DECLINED' THEN 'CAPTURE_FAILED'
           WHEN h.status = 'EXPIRED' THEN 'EXPIRED'
           WHEN h.status = 'COMPENSATED' THEN 'COMPENSATED'
           ELSE 'ENDED'
         END::text,
         h.respond_by;
END
$fn$;
COMMENT ON FUNCTION core.booking_checkout_request(bytea, uuid) IS
  'Lecture de la demande du hold du checkout du voyageur de la session : type, état de la '
  'demande, heure limite ; aucun montant. SECURITY DEFINER, EXECUTE app_api. US-223 (ADR-146).';

-- Commandes de l'hôte (SECURITY DEFINER, EXECUTE app_api) : le contexte HOST posé par la porte est
-- remis à sa valeur précédente au retour (une erreur annule la transaction, et le contexte avec elle)
CREATE FUNCTION core.booking_request_restore_context(p_prev text[])
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(p_prev[1], ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(p_prev[2], ''), true);
  PERFORM pg_catalog.set_config('app.org_id', COALESCE(p_prev[3], ''), true);
END
$fn$;

CREATE FUNCTION core.booking_cmd_accept_booking_request(p_token_hash bytea, p_org uuid,
                                                        p_hold_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev   text[] := ARRAY[pg_catalog.current_setting('app.actor_kind', true),
                           pg_catalog.current_setting('app.actor_id', true),
                           pg_catalog.current_setting('app.org_id', true)];
  v_result jsonb;
BEGIN
  v_result := core.booking_request_accept(p_token_hash, p_org, p_hold_id);
  PERFORM core.booking_request_restore_context(v_prev);
  RETURN v_result;
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_accept_booking_request(bytea, uuid, uuid) IS
  'Acceptation d''une demande par l''hôte titulaire de la session (core.booking_request_accept). '
  'SECURITY DEFINER, EXECUTE app_api. US-223 (ADR-146).';

CREATE FUNCTION core.booking_cmd_request_record_capture(p_token_hash bytea, p_org uuid,
                                                        p_hold_id uuid, p_operation_id uuid,
                                                        p_provider_reference text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev   text[] := ARRAY[pg_catalog.current_setting('app.actor_kind', true),
                           pg_catalog.current_setting('app.actor_id', true),
                           pg_catalog.current_setting('app.org_id', true)];
  v_result text;
BEGIN
  v_result := core.booking_request_record_capture(p_token_hash, p_org, p_hold_id, p_operation_id,
                                                  p_provider_reference);
  PERFORM core.booking_request_restore_context(v_prev);
  RETURN v_result;
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_request_record_capture(bytea, uuid, uuid, uuid, text) IS
  'Affinage de la capture d''une demande acceptée par l''hôte titulaire de la session. '
  'SECURITY DEFINER, EXECUTE app_api. US-223 (ADR-146).';

CREATE FUNCTION core.booking_cmd_decline_booking_request(p_token_hash bytea, p_org uuid,
                                                         p_hold_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_prev   text[] := ARRAY[pg_catalog.current_setting('app.actor_kind', true),
                           pg_catalog.current_setting('app.actor_id', true),
                           pg_catalog.current_setting('app.org_id', true)];
  v_result jsonb;
BEGIN
  v_result := core.booking_request_decline(p_token_hash, p_org, p_hold_id);
  PERFORM core.booking_request_restore_context(v_prev);
  RETURN v_result;
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_decline_booking_request(bytea, uuid, uuid) IS
  'Refus d''une demande par l''hôte titulaire de la session (core.booking_request_decline). '
  'SECURITY DEFINER, EXECUTE app_api. US-223 (ADR-146).';

REVOKE ALL ON FUNCTION core.booking_request_void(uuid, uuid),
  core.booking_request_authorized(uuid),
  core.booking_request_host_gate(bytea, uuid, uuid, text),
  core.booking_cmd_accept_booking_request(bytea, uuid, uuid),
  core.booking_cmd_request_record_capture(bytea, uuid, uuid, uuid, text),
  core.booking_cmd_decline_booking_request(bytea, uuid, uuid),
  core.booking_cmd_expire_booking_requests(integer),
  core.booking_checkout_request(bytea, uuid),
  core.booking_request_accept(bytea, uuid, uuid),
  core.booking_request_record_capture(bytea, uuid, uuid, uuid, text),
  core.booking_request_decline(bytea, uuid, uuid),
  core.booking_request_restore_context(text[]),
  core.booking_place_hold_kind(uuid, timestamptz, timestamptz, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_cmd_accept_booking_request(bytea, uuid, uuid),
  core.booking_cmd_request_record_capture(bytea, uuid, uuid, uuid, text),
  core.booking_cmd_decline_booking_request(bytea, uuid, uuid),
  core.booking_checkout_request(bytea, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION core.booking_request_void(uuid, uuid),
  core.booking_request_authorized(uuid),
  core.booking_cmd_expire_booking_requests(integer) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 12. Autorisation d'une demande dans les balayages (17 §2.5 deltas : « l'AUTH d'une demande ne
-- reçoit aucune disposition ») ; SECURITY INVOKER, lectures des travailleurs appelants ------------
-- Vrai : AUTH de loyer d'un hold REQUEST.
CREATE FUNCTION core.booking_request_auth(p_operation_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1
                   FROM core.payment_payment_operation AS o
                   JOIN core.booking_checkout_hold AS h ON h.id = o.hold_id
                  WHERE o.id = p_operation_id AND o.kind = 'AUTH' AND o.purpose = 'RENT'
                    AND h.kind = 'REQUEST')
$fn$;
-- Vrai : AUTH d'une demande déjà RÉGLÉE (passée en attente de l'hôte, ou VOID demandé) ; une
-- autorisation prouvée non réglée reste due pour booking_conversion et comptée par l'oracle C12.
CREATE FUNCTION core.booking_request_auth_settled(p_operation_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1
                   FROM core.payment_payment_operation AS o
                   JOIN core.booking_checkout_hold AS h ON h.id = o.hold_id
                  WHERE o.id = p_operation_id AND o.kind = 'AUTH' AND o.purpose = 'RENT'
                    AND h.kind = 'REQUEST'
                    AND (h.request_respond_by IS NOT NULL
                         OR EXISTS (SELECT 1 FROM core.payment_payment_operation AS v
                                     WHERE v.hold_id = o.hold_id AND v.kind = 'VOID'
                                       AND v.purpose = 'RENT' AND v.attempt_no = o.attempt_no)))
$fn$;
COMMENT ON FUNCTION core.booking_request_auth(uuid) IS
  'Vrai pour l''autorisation (AUTH) d''un hold REQUEST : jamais de disposition. US-223 (ADR-146).';
COMMENT ON FUNCTION core.booking_request_auth_settled(uuid) IS
  'Vrai pour l''autorisation d''une demande réglée (attente de l''hôte ou VOID demandé). US-223.';
REVOKE ALL ON FUNCTION core.booking_request_auth(uuid), core.booking_request_auth_settled(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_request_auth(uuid), core.booking_request_auth_settled(uuid)
  TO app_worker;

-- 13. Conversion, opérations dues, refus reçu, candidats, oracle (corps de 0116, 0041, 0045
-- recopiés, changements marqués US-223c) --------------------------------------------------------
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
  -- US-223c (17 §2.5 « Hold de demande REQUEST ») : l'autorisation prouvée d'une demande n'est
  -- jamais convertie ni compensée (aucune disposition) : la demande attend l'hôte (AWAITING_HOST),
  -- ou, si le hold n'est plus vivant, l'autorisation est annulée (VOID total) ; seule la CAPTURE
  -- de l'acceptation devient un trip
  IF r_op.kind = 'AUTH' AND EXISTS (SELECT 1 FROM core.booking_checkout_hold ch
                                     WHERE ch.id = r_op.hold_id AND ch.kind = 'REQUEST') THEN
    RETURN core.booking_request_authorized(p_operation_id);
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
  'aucun trip sans preuve rattachée (NOT_PROVEN) ; version de prix n° 1 = devis du checkout ; '
  'autorisation d''une demande : attente de l''hôte ou VOID (booking_request_authorized). '
  'Travailleurs booking_conversion, disposition_sweeper, payment_intent_sweeper. US-024, US-223.';

CREATE OR REPLACE FUNCTION core.booking_conversion_due(p_limit integer)
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
             -- US-223c : autorisation d'une demande à traiter une seule fois (passage en
             -- AWAITING_HOST, ou VOID si le hold n'est plus vivant) ; jamais une disposition
             AND NOT core.booking_request_auth_settled(o.id)
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
  'Opérations de loyer à convertir (SUCCEEDED prouvées sans disposition ; autorisation d''une '
  'demande non réglée) ou à traiter comme refus (FAILED de la tentative en cours), travailleur '
  'booking_conversion. US-223 (ADR-139, ADR-146).';

CREATE OR REPLACE FUNCTION core.booking_record_payment_failure(p_operation_id uuid)
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
  v_auth    uuid;  -- US-223c
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
         ch.country_code, ch.kind, ch.request_respond_by
    INTO r_hold
    FROM core.booking_checkout_hold ch WHERE ch.id = r_op.hold_id FOR UPDATE;
  IF r_hold.status <> 'PAYMENT_IN_FLIGHT' OR r_op.attempt_no <> r_hold.payment_attempts + 1 THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOOP');   -- refus déjà traité ou périmé
  END IF;
  -- US-223c (17 §2.5 « Capture refusée à l'acceptation ») : capture d'une demande acceptée
  -- refusée ⇒ hold RELEASED (PAYMENT_DECLINED), créneau libéré, aucun trip, VOID de l'autorisation
  -- par la boîte d'envoi (aucune nouvelle tentative : l'hôte a accepté UNE capture)
  IF r_hold.kind = 'REQUEST' AND r_op.kind = 'CAPTURE' AND r_hold.request_respond_by IS NOT NULL THEN
    v_now := platform.now();
    SELECT o.id INTO v_auth
      FROM core.payment_payment_operation o
     WHERE o.hold_id = r_hold.id AND o.purpose = 'RENT' AND o.kind = 'AUTH'
       AND o.status = 'SUCCEEDED' AND o.attempt_no = r_op.attempt_no;
    UPDATE core.booking_checkout_hold
       SET status = 'RELEASED', released_at = v_now, release_reason = 'PAYMENT_DECLINED'
     WHERE id = r_hold.id AND status = 'PAYMENT_IN_FLIGHT';
    UPDATE core.booking_vehicle_occupancy
       SET active = false, deactivated_reason = 'HOLD_RELEASED'
     WHERE id = r_hold.occupancy_id AND kind = 'HOLD' AND active;
    IF v_auth IS NOT NULL THEN
      PERFORM core.booking_request_void(r_hold.id, v_auth);
    END IF;
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_role, correlation_id, payload, partition_key)
    VALUES ('booking.hold.released', 1, 'checkout_hold', r_hold.id, 2, r_hold.country_code,
            'SYSTEM', pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('hold_id', r_hold.id, 'vehicle_id', v_vehicle,
                                          'org_id', r_hold.org_id, 'reason', 'PAYMENT_DECLINED'),
            r_hold.id::text);
    RETURN pg_catalog.jsonb_build_object('outcome', 'RELEASED', 'request', true,
                                         'paymentAttempts', r_hold.payment_attempts);
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
  'Refus reçu (17 §2.5 étape 3e) : retour en ACTIVE ou RELEASED (PAYMENT_DECLINED) ; capture '
  'refusée d''une demande acceptée : RELEASED (PAYMENT_DECLINED) et VOID. US-024, US-223.';

CREATE OR REPLACE FUNCTION core.booking_disposition_candidates(p_limit integer)
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
       -- US-223c : l'autorisation d'une demande ne reçoit jamais de disposition (17 §2.5)
       AND NOT core.booking_request_auth(o.id)
       AND p.m IS NOT NULL
       AND k.at <= platform.now() - pg_catalog.make_interval(mins => p.m)
     ORDER BY k.at, o.id
     LIMIT p_limit;
END
$fn$;

CREATE OR REPLACE FUNCTION core.booking_production_oracle()
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
         -- US-223c (17 §2.5) : l'autorisation d'une demande, réglée (attente de l'hôte, capture
         -- ou VOID demandé), ne reçoit jamais de disposition ; une autorisation non réglée compte
         AND NOT core.booking_request_auth_settled(o.id)
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

CREATE OR REPLACE FUNCTION core.ops_monitor_metrics(p_since timestamptz, p_webhook_failures integer)
  RETURNS TABLE (metric text, label text, country_code text, value bigint)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'ops_monitor' THEN
    RAISE EXCEPTION 'ops_monitor: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'ops_monitor_forbidden';
  END IF;
  IF p_since IS NULL OR p_webhook_failures IS NULL OR p_webhook_failures < 1 THEN
    RAISE EXCEPTION 'ops_monitor: paramètres invalides' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_now := platform.now();
  RETURN QUERY
    SELECT 'outbox_oldest_age_s'::text, NULL::text, NULL::text,
           GREATEST(0, COALESCE(pg_catalog.floor(EXTRACT(epoch FROM v_now - pg_catalog.min(e.created_at))), 0))::bigint
      FROM core.outbox_outbox_event AS e
     WHERE e.published_at IS NULL
    UNION ALL
    SELECT 'webhook_failing', w.provider, NULL, pg_catalog.count(*)::bigint
      FROM core.payment_webhook_inbox AS w
     WHERE w.processing_status IN ('QUARANTINED', 'FAILED')
       AND w.processing_attempts >= p_webhook_failures
     GROUP BY w.provider
    UNION ALL
    SELECT 'webhook_signature_rejected', w.provider, NULL, pg_catalog.count(*)::bigint
      FROM core.payment_webhook_inbox AS w
     WHERE w.processing_status = 'REJECTED_SIGNATURE' AND w.received_at > p_since
     GROUP BY w.provider
    UNION ALL
    SELECT 'payment_unknown_30m', NULL, o.country_code, pg_catalog.count(*)::bigint
      FROM core.payment_payment_operation AS o
     WHERE o.status = 'UNKNOWN' AND o.updated_at < v_now - interval '30 minutes'
     GROUP BY o.country_code
    UNION ALL
    -- US-223c (17 §2.5 exigence d'argent c) : VOID d'une demande non confirmé depuis plus de
    -- 30 min, par pays (escalade au support ; l'autorisation expire d'elle-même chez l'émetteur)
    SELECT 'request_void_pending_30m', NULL, c.country_code, pg_catalog.count(*)::bigint
      FROM core.payment_payment_command AS c
     WHERE c.operation_kind = 'VOID' AND c.status IN ('PENDING', 'IN_FLIGHT', 'UNKNOWN', 'ABANDONED')
       AND c.created_at < v_now - interval '30 minutes'
     GROUP BY c.country_code
    UNION ALL
    SELECT 'p1_event', e.type, e.country_code, pg_catalog.count(*)::bigint
      FROM core.outbox_outbox_event AS e
     WHERE e.created_at > p_since
       AND (e.payload ->> 'severity' = 'P1' OR e.type = 'notification.sms_cap.reached')
     GROUP BY e.type, e.country_code;
END
$fn$;
COMMENT ON FUNCTION core.ops_monitor_metrics(timestamptz, integer) IS
  'Supervision (17 §6.3, ADM-032) : âge de l''outbox, webhooks en échec, opérations UNKNOWN, '
  'VOID de demande en attente, alertes P1 de l''outbox ; comptes seulement ; travailleur '
  'ops_monitor. US-004, ADR-080, US-223.';

-- 15. Demandes du compte d'hôte de la session (écran hôte « solicitudes », 16 HDB-002) -------------
-- host_view_owner, comme les trips de l'hôte (0101, 0104) : compte TITULAIRE de la session
-- (iam_host_accounts ; IDOR : jamais un identifiant d'hôte reçu sans vérification), demandes en
-- attente (AWAITING_HOST) ou acceptées en cours de capture (CAPTURING), heure limite, période et
-- fuseau du devis engagé, gains de la jambe HOST (montant explicite du devis, 08 E7) ; du voyageur :
-- prénom, âge, note, statut de vérification seulement (host_guest_v, 17 §2.3), jamais le permis.
GRANT CREATE ON SCHEMA core TO host_view_owner;
SET LOCAL ROLE host_view_owner;
CREATE FUNCTION core.booking_host_requests(p_token_hash bytea, p_org uuid, p_hold_id uuid,
                                           p_limit integer)
  RETURNS TABLE (outcome text, hold_id uuid, status text, vehicle_id uuid,
                 scheduled_start timestamptz, scheduled_end timestamptz, timezone text,
                 request_respond_by timestamptz, currency text, total_minor bigint,
                 host_leg_minor bigint, guest_first_name text, guest_age_years integer,
                 guest_rating numeric, guest_verified boolean)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_country text;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::uuid,
                        NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::timestamptz,
                        NULL::text, NULL::bigint, NULL::bigint, NULL::text, NULL::integer,
                        NULL::numeric, NULL::boolean;
    RETURN;
  END IF;
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a
   WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::text, NULL::uuid,
                        NULL::timestamptz, NULL::timestamptz, NULL::text, NULL::timestamptz,
                        NULL::text, NULL::bigint, NULL::bigint, NULL::text, NULL::integer,
                        NULL::numeric, NULL::boolean;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'DONE'::text, h.id,
         CASE WHEN h.status = 'AWAITING_HOST' THEN 'AWAITING_HOST' ELSE 'CAPTURING' END::text,
         h.vehicle_id, t.scheduled_start, t.scheduled_end, t.timezone, h.request_respond_by,
         t.currency, t.amount_minor,
         CASE WHEN (t.legs ->> 'HOST') ~ '^[0-9]{1,18}$' THEN (t.legs ->> 'HOST')::bigint END,
         CASE WHEN u.pseudonymized_at IS NULL THEN u.legal_first_name END,
         CASE WHEN u.pseudonymized_at IS NULL AND u.date_of_birth IS NOT NULL
              THEN pg_catalog.date_part('year',
                     pg_catalog.age((platform.now() AT TIME ZONE t.timezone)::date::timestamp,
                                    u.date_of_birth::timestamp))::integer
         END,
         CASE WHEN u.pseudonymized_at IS NULL
              THEN (SELECT pg_catalog.round(ra.avg_overall_x100::numeric / 100, 2)
                      FROM core.review_rating_aggregate AS ra
                     WHERE ra.subject_type = 'GUEST' AND ra.subject_id = h.guest_user_id)
         END,
         EXISTS (SELECT 1 FROM core.kyc_identity_verification AS v
                  WHERE v.user_id = h.guest_user_id AND v.is_current AND v.status = 'APPROVED'
                    AND (v.expires_at IS NULL OR v.expires_at > platform.now()))
    FROM core.booking_checkout_hold AS h
    JOIN core.iam_user_account AS u ON u.id = h.guest_user_id
    CROSS JOIN LATERAL core.booking_checkout_capture_terms(h.id) AS t
   WHERE h.org_id = p_org
     AND h.country_code = v_country
     AND h.kind = 'REQUEST'
     AND (h.status = 'AWAITING_HOST'
          OR (h.status = 'PAYMENT_IN_FLIGHT' AND h.request_respond_by IS NOT NULL))
     AND (p_hold_id IS NULL OR h.id = p_hold_id)
   ORDER BY h.request_respond_by, h.id
   LIMIT p_limit;
END
$fn$;
COMMENT ON FUNCTION core.booking_host_requests(bytea, uuid, uuid, integer) IS
  'Demandes en attente ou en capture du compte d''hôte titulaire de la session : heure limite, '
  'période, total et jambe HOST du devis engagé, voyageur réduit à host_guest_v. SECURITY '
  'DEFINER, EXECUTE app_api. US-223 (ADR-146).';
REVOKE ALL ON FUNCTION core.booking_host_requests(bytea, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_host_requests(bytea, uuid, uuid, integer) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM host_view_owner;
