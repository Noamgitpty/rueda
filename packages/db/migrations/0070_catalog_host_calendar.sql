-- 0070 — CAT / AVL : calendrier par véhicule, blocages de l'hôte par commande et préavis par lieu.
-- US-119 ; 19 US-119 ; 16 CAL-001 / CAL-002, CAL-003 / CAL-004, CAL-011 ; 08 BR-BOOK-04, BR-BOOK-05,
-- BR-BOOK-07 ; 17 §2.3 (sondes publiques `catalog.vehicle_is_free`, RLS-15, RLS-17), §2.5, §3.2.3
-- (`location.advance_notice_minutes`), §3.2.4, §7.2 (`advance_notice_minutes` : 180, 1 440 classe
-- LUXE) ; ADR-060, ADR-063, ADR-089, ADR-099 ; ADR-100 (cette migration). Appliquée sous
-- `migrator`, en une transaction.
--
-- Principes (ADR-100, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - la table d'occupation unique (0004, 0032) reste la SEULE source de la disponibilité ; un
--     blocage est une occupation HOST_BLOCK écrite UNIQUEMENT par la commande de 0032 / 0056
--     (`core.booking_cmd_place_host_block`, cmd_hold_owner, verrou du véhicule, exclusion GiST) ;
--     cette migration n'ajoute AUCUN écrivain de l'occupation ;
--   - l'espace de l'hôte s'authentifie comme les commandes d'US-115 : par l'empreinte du jeton de
--     session (`core.catalog_host_context`), jamais par un identifiant reçu. Les commandes
--     `core.catalog_cmd_place_host_block` / `core.catalog_cmd_remove_host_block` (catalog_cmd_owner)
--     vérifient la session, le compte d'hôte et le véhicule du catalogue, convertissent l'heure
--     LOCALE saisie dans le fuseau du véhicule (lu du catalogue, hérité du pays : L1-PM-22), posent
--     le contexte `app.*` de l'hôte de la SESSION pour l'instruction, appellent la commande de
--     0032 / 0056 (qui rejoue ses propres gardes : portée, catalogue, compte, pays) puis effacent
--     ce contexte ; les refus de la base deviennent des issues (VEHICLE_UNAVAILABLE sans aucun
--     détail sur l'occupation en cause, INVALID_PERIOD, VEHICLE_NOT_FOUND) ;
--   - blocage par jour ou par heure, au pas de 30 min (08 BR-BOOK-03) ; blocage d'un véhicule
--     publié (annonce LISTED) seulement, comme la commande de 0056 (VEHICLE_NOT_LISTED avant) ;
--   - préavis minimum par lieu de remise (`advance_notice_minutes`, 17 §3.2.3 ; 16 CAL-003) :
--     NULL = défaut du pays (`advance_notice_minutes`, portée COUNTRY) ; valeur de l'hôte de 60 à
--     10 080 min (1 h à 7 jours), au pas de 30 min ; plancher de la classe du véhicule (portée
--     CATEGORY, 1 440 min pour LUXE : 08 BR-BOOK-04 « préavis minimal imposé ») ; défaut du pays
--     absent sans valeur de l'hôte : PARAM_MISSING (fail-closed). Le lieu de remise d'un hold est
--     le lieu du véhicule (`home_location_id`) : un seul lieu en bêta ;
--   - pose d'un hold : départ avant `platform.now()` + préavis ⇒ `hold_notice_too_short`
--     (DATES_NOTICE_TOO_SHORT, 16 CAL-003) ; corps de 0064 recopié à l'identique hors ce contrôle ;
--   - calendrier (16 CAL-001, bêta : liste) : occupations ACTIVES non terminées du véhicule, type
--     et bornes locales seulement ; jamais le voyageur, ni la référence (`ref_id`) d'un hold ou
--     d'un trip, ni l'occupation d'un autre véhicule ;
--   - sonde de disponibilité `core.catalog_vehicle_is_free(véhicule, période)` (17 §2.3, RLS-17 ;
--     propriétaire catalog_probe_owner) : NULL hors annonce LISTED, période arrondie à l'heure,
--     booléen seul ; la recherche (US-201) la branche avec sa limite de débit
--     (`availability_probe_per_minute`).
--
-- Expand / contract : une colonne facultative, des fonctions, des droits et des politiques
-- ajoutés ; politiques `catalog_cmd_read` (config_param_value) et `cmd_hold_read`
-- (config_param_value) recréées sous le même nom avec une clé de plus ; corps de
-- `core.booking_cmd_place_hold` remplacé à signature et propriétaire identiques. Le COMPORTEMENT
-- se resserre, volontairement : un départ dans le préavis est refusé (16 CAL-003).
--
-- Retour arrière :
--   réappliquer core.booking_cmd_place_hold de 0064 (sous cmd_hold_owner) ;
--   DROP FUNCTION core.catalog_cmd_place_host_block(bytea, uuid, uuid, timestamp, timestamp),
--     core.catalog_cmd_remove_host_block(bytea, uuid, uuid, uuid),
--     core.catalog_cmd_set_location_notice(bytea, uuid, uuid, integer),
--     core.catalog_host_vehicle_calendar(bytea, uuid, uuid),
--     core.catalog_host_vehicle_occupancies(bytea, uuid, uuid),
--     core.catalog_vehicle_is_free(uuid, tstzrange),
--     core.catalog_effective_notice_minutes(uuid) ;
--   DROP POLICY catalog_cmd_read ON core.booking_vehicle_occupancy ; DROP POLICY probe_read ON
--     core.catalog_listing, core.booking_vehicle_occupancy ; DROP POLICY cmd_hold_read ON
--     core.catalog_location ; recréer catalog_cmd_read et cmd_hold_read de config_param_value
--     sans la clé advance_notice_minutes ; révoquer les droits accordés ci-dessous ;
--   ALTER TABLE core.catalog_location DROP COLUMN advance_notice_minutes.

-- 1. Préavis du lieu de remise (17 §3.2.3 `advance_notice_minutes`) ------------------------------
ALTER TABLE core.catalog_location
  ADD COLUMN advance_notice_minutes integer
    CONSTRAINT catalog_location_notice_valid
    CHECK (advance_notice_minutes IS NULL
           OR (advance_notice_minutes BETWEEN 60 AND 10080 AND advance_notice_minutes % 30 = 0));
COMMENT ON COLUMN core.catalog_location.advance_notice_minutes IS
  'Préavis minimum de l''hôte pour ce lieu (16 CAL-003, 08 BR-BOOK-04), en minutes, 60 à 10 080 '
  'au pas de 30 ; NULL : défaut du pays (advance_notice_minutes). US-119 (ADR-100).';

-- 2. Préavis en vigueur d'un véhicule (SECURITY INVOKER : exécutée sous cmd_hold_owner à la pose
-- d'un hold et sous catalog_cmd_owner au calendrier ; chacun lit sous sa propre RLS) ------------
-- Valeur du lieu du véhicule, sinon défaut du pays ; au moins le plancher de la classe du véhicule
-- (portée CATEGORY) ; NULL si le véhicule est inconnu ou si le défaut du pays manque sans valeur
-- du lieu (l'appelant refuse : fail_mode BLOCK).
CREATE FUNCTION core.catalog_effective_notice_minutes(p_vehicle_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_country text;
  v_class   text;
  v_host    integer;
  v_default integer;
  v_floor   integer;
  v_now     timestamptz := platform.now();
BEGIN
  SELECT cv.country_code, cv.value_class, l.advance_notice_minutes
    INTO v_country, v_class, v_host
    FROM core.catalog_vehicle AS cv
    JOIN core.catalog_location AS l ON l.id = cv.home_location_id
   WHERE cv.id = p_vehicle_id;
  IF v_country IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT (pv.value #>> '{}')::integer INTO v_default
    FROM core.config_param_value AS pv
   WHERE pv.key = 'advance_notice_minutes' AND pv.country_code::text = v_country
     AND pv.scope_type = 'COUNTRY' AND pv.valid_from <= v_now
     AND (pv.valid_to IS NULL OR pv.valid_to > v_now)
     AND pg_catalog.jsonb_typeof(pv.value) = 'number' AND (pv.value #>> '{}') ~ '^[0-9]{1,5}$'
   ORDER BY pv.valid_from DESC
   LIMIT 1;
  IF v_class IS NOT NULL THEN
    SELECT (pv.value #>> '{}')::integer INTO v_floor
      FROM core.config_param_value AS pv
     WHERE pv.key = 'advance_notice_minutes' AND pv.country_code::text = v_country
       AND pv.scope_type = 'CATEGORY' AND pv.scope_id = v_class AND pv.valid_from <= v_now
       AND (pv.valid_to IS NULL OR pv.valid_to > v_now)
       AND pg_catalog.jsonb_typeof(pv.value) = 'number' AND (pv.value #>> '{}') ~ '^[0-9]{1,5}$'
     ORDER BY pv.valid_from DESC
     LIMIT 1;
  END IF;
  IF COALESCE(v_host, v_default) IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN GREATEST(COALESCE(v_host, v_default), COALESCE(v_floor, 0));
END
$fn$;
COMMENT ON FUNCTION core.catalog_effective_notice_minutes(uuid) IS
  'Préavis en vigueur d''un véhicule (16 CAL-003, 08 BR-BOOK-04) : valeur de son lieu, sinon défaut '
  'du pays, au moins le plancher de sa classe ; NULL si inconnu ou paramètre absent. US-119.';
REVOKE ALL ON FUNCTION core.catalog_effective_notice_minutes(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_effective_notice_minutes(uuid)
  TO cmd_hold_owner, catalog_cmd_owner;

-- 3. Droits de catalog_cmd_owner (commandes et lectures du calendrier) ---------------------------
-- préavis du lieu : la seule colonne modifiable
GRANT UPDATE (advance_notice_minutes) ON core.catalog_location TO catalog_cmd_owner;
-- portée CATEGORY du préavis (plancher de la classe du véhicule)
GRANT SELECT (scope_id) ON core.config_param_value TO catalog_cmd_owner;
-- clé du préavis lisible (liste de 0067 + advance_notice_minutes ; même nom, même table :
-- remplacement admis, ADR-081)
DROP POLICY catalog_cmd_read ON core.config_param_value;
CREATE POLICY catalog_cmd_read ON core.config_param_value FOR SELECT TO catalog_cmd_owner
  USING (key IN ('price_display_step_minor', 'listing_min_photos', 'price_ceiling_daily_minor',
                'price_ceiling_extra_km_minor', 'p2p_private_hosts_enabled',
                'advance_notice_minutes'));
-- occupations ACTIVES, colonnes du calendrier seulement : ni ref_type / ref_id (aucune donnée du
-- voyageur), ni expires_at, ni ical_uid, ni colonne d'audit ; aucune écriture
GRANT SELECT (id, vehicle_id, org_id, country_code, kind, source, period, active)
  ON core.booking_vehicle_occupancy TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.booking_vehicle_occupancy FOR SELECT TO catalog_cmd_owner
  USING (active);

-- 4. Droits de cmd_hold_owner (préavis à la pose d'un hold) ---------------------------------------
GRANT SELECT (home_location_id, value_class) ON core.catalog_vehicle TO cmd_hold_owner;
GRANT SELECT (id, advance_notice_minutes) ON core.catalog_location TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.catalog_location FOR SELECT TO cmd_hold_owner USING (true);
GRANT SELECT (scope_id) ON core.config_param_value TO cmd_hold_owner;
-- clés lues par les commandes de hold : liste de 0056 + advance_notice_minutes
DROP POLICY cmd_hold_read ON core.config_param_value;
CREATE POLICY cmd_hold_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('buffer_minutes', 'hold_ttl_minutes', 'hold_max_total_minutes',
                 'max_active_holds_per_guest', 'hold_creations_per_guest_vehicle_hour',
                 'sweep_grace_s', 'flagged_booking_payment_order', 'review_hold_minutes',
                 'payment_in_flight_margin_s', 'psp_call_timeout_s',
                 'conversion_start_tolerance_minutes', 'payment_attempts_per_hold',
                 'max_trip_days', 'advance_notice_minutes'));

-- 5. Sous cmd_hold_owner : EXECUTE des commandes de blocage pour catalog_cmd_owner, et pose d'un
-- hold avec le préavis --------------------------------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- seul le propriétaire accorde EXECUTE : catalog_cmd_owner appelle les commandes de 0032 / 0056,
-- qui s'exécutent sous cmd_hold_owner et rejouent leurs gardes (liste blanche RLS-15)
GRANT EXECUTE ON FUNCTION core.booking_cmd_place_host_block(uuid, timestamptz, timestamptz),
  core.booking_cmd_remove_host_block(uuid) TO catalog_cmd_owner;

-- Corps de 0064 recopié à l'identique, plus le contrôle du préavis (étape marquée US-119), placé
-- après la lecture des paramètres et avant tout verrou.
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
  -- self_booking_forbidden (16 BKG-012, Bêta : contrôle hôte / voyageur à la pose). US-049
  -- (F-RLS-02) : le titulaire, et tout membre du compte d'hôte du véhicule (co-hôte compris,
  -- appartenance active ou en attente), quel que soit le pays
  IF v_holder = v_guest
     OR EXISTS (SELECT 1 FROM core.iam_membership m
                 WHERE m.org_id = v_org AND m.user_id = v_guest
                   AND m.status IN ('ACTIVE', 'INVITED')) THEN
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
  VALUES (v_hold, v_guest, p_vehicle_id, v_org, v_country, v_occupancy, 'CHECKOUT', 'ACTIVE',
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

COMMENT ON FUNCTION core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean) IS
  'Commande : pose d''un hold de checkout (17 §2.5 étape 2) ; refusée au titulaire et à tout membre '
  'du compte d''hôte du véhicule (SELF_BOOKING_FORBIDDEN), à un voyageur restreint '
  '(ACCOUNT_RESTRICTED), sur le véhicule d''un titulaire restreint (HOST_NOT_ACTIVATED) et pour un '
  'départ dans le préavis du lieu (DATES_NOTICE_TOO_SHORT). US-023, US-049, US-109, US-119.';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 6. Commandes et lectures de l'hôte (SECURITY DEFINER, catalog_cmd_owner, EXECUTE au seul app_api)
-- Issues métier rendues, jamais levées (l'appelant traduit en HTTP). Un véhicule, un lieu ou un
-- blocage d'un autre compte rend la même issue qu'un identifiant inconnu (L1-PM-11).

-- Contexte app.* de l'hôte de la SESSION, posé pour l'instruction et effacé après l'appel : la
-- commande de 0032 / 0056 (politiques cmd_block_ins / cmd_block_upd, app.host_covers_vehicle) le
-- lit. Aucun paramètre de personne : l'acteur vient de la session (catalog_host_context).
-- 6.1 Pose d'un blocage (16 CAL-002 ; 08 BR-BOOK-07 : refusé s'il chevauche un trip, un hold, un
-- autre blocage ou un tampon). Heures LOCALES du véhicule, au pas de 30 min, [début, fin).
CREATE FUNCTION core.catalog_cmd_place_host_block(p_token_hash bytea, p_org uuid, p_vehicle_id uuid,
                                                  p_start_local timestamp, p_end_local timestamp)
  RETURNS TABLE (outcome text, block_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h          record;
  v_tz       text;
  v_id       uuid;
  v_con      text;
  v_outcome  text;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT cv.timezone INTO v_tz
    FROM core.catalog_vehicle AS cv
   WHERE cv.id = p_vehicle_id AND cv.org_id = p_org AND cv.country_code = h.country_code;
  IF v_tz IS NULL THEN
    RETURN QUERY SELECT 'VEHICLE_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.catalog_listing AS l
                  WHERE l.vehicle_id = p_vehicle_id AND l.status = 'LISTED') THEN
    RETURN QUERY SELECT 'VEHICLE_NOT_LISTED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_start_local IS NULL OR p_end_local IS NULL OR NOT pg_catalog.isfinite(p_start_local)
     OR NOT pg_catalog.isfinite(p_end_local) OR p_end_local <= p_start_local
     OR pg_catalog.date_trunc('minute', p_start_local) <> p_start_local
     OR pg_catalog.date_trunc('minute', p_end_local) <> p_end_local
     OR pg_catalog.date_part('minute', p_start_local)::integer % 30 <> 0
     OR pg_catalog.date_part('minute', p_end_local)::integer % 30 <> 0 THEN
    RETURN QUERY SELECT 'INVALID_PERIOD'::text, NULL::uuid;
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config('app.actor_kind', 'HOST', true),
          pg_catalog.set_config('app.actor_id', h.user_id::text, true),
          pg_catalog.set_config('app.org_id', p_org::text, true),
          pg_catalog.set_config('app.vehicle_scope', '', true),
          pg_catalog.set_config('app.country_scope', '', true),
          pg_catalog.set_config('app.worker_name', '', true);
  BEGIN
    -- fuseau du véhicule (catalogue, hérité du pays) : l'heure saisie est une heure LOCALE
    v_id := core.booking_cmd_place_host_block(p_vehicle_id,
                                              p_start_local AT TIME ZONE v_tz,
                                              p_end_local AT TIME ZONE v_tz);
    v_outcome := 'DONE';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    v_outcome := CASE v_con
                   WHEN 'vehicle_occupancy_no_overlap' THEN 'VEHICLE_UNAVAILABLE'
                   WHEN 'occupancy_period_invalid' THEN 'INVALID_PERIOD'
                   WHEN 'occupancy_host_forbidden' THEN 'VEHICLE_NOT_FOUND'
                   WHEN 'occupancy_vehicle_single_org' THEN 'VEHICLE_NOT_FOUND'
                 END;
    IF v_outcome IS NULL THEN
      RAISE;
    END IF;
  END;
  PERFORM pg_catalog.set_config('app.actor_kind', '', true),
          pg_catalog.set_config('app.actor_id', '', true),
          pg_catalog.set_config('app.org_id', '', true);
  RETURN QUERY SELECT v_outcome, v_id;
END
$fn$;

-- 6.2 Levée d'un blocage manuel actif de ce véhicule (BLOCK_REMOVED) ; blocage déjà levé, d'un
-- autre véhicule ou inconnu : BLOCK_NOT_FOUND, sans distinguer les cas.
CREATE FUNCTION core.catalog_cmd_remove_host_block(p_token_hash bytea, p_org uuid,
                                                   p_vehicle_id uuid, p_block_id uuid)
  RETURNS TABLE (outcome text, block_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h          record;
  v_con      text;
  v_outcome  text;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.catalog_vehicle AS cv
                  WHERE cv.id = p_vehicle_id AND cv.org_id = p_org
                    AND cv.country_code = h.country_code) THEN
    RETURN QUERY SELECT 'VEHICLE_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  -- blocage manuel ACTIF de CE véhicule (la politique catalog_cmd_read ne montre que les
  -- occupations actives)
  IF NOT EXISTS (SELECT 1 FROM core.booking_vehicle_occupancy AS vo
                  WHERE vo.id = p_block_id AND vo.vehicle_id = p_vehicle_id AND vo.org_id = p_org
                    AND vo.kind = 'HOST_BLOCK' AND vo.source = 'MANUAL') THEN
    RETURN QUERY SELECT 'BLOCK_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;

  PERFORM pg_catalog.set_config('app.actor_kind', 'HOST', true),
          pg_catalog.set_config('app.actor_id', h.user_id::text, true),
          pg_catalog.set_config('app.org_id', p_org::text, true),
          pg_catalog.set_config('app.vehicle_scope', '', true),
          pg_catalog.set_config('app.country_scope', '', true),
          pg_catalog.set_config('app.worker_name', '', true);
  BEGIN
    PERFORM core.booking_cmd_remove_host_block(p_block_id);
    v_outcome := 'DONE';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
    v_outcome := CASE v_con WHEN 'occupancy_host_forbidden' THEN 'BLOCK_NOT_FOUND' END;
    IF v_outcome IS NULL THEN
      RAISE;
    END IF;
  END;
  PERFORM pg_catalog.set_config('app.actor_kind', '', true),
          pg_catalog.set_config('app.actor_id', '', true),
          pg_catalog.set_config('app.org_id', '', true);
  RETURN QUERY SELECT v_outcome, CASE WHEN v_outcome = 'DONE' THEN p_block_id END;
END
$fn$;

-- 6.3 Préavis d'un lieu de remise (16 CAL-003) : 60 à 10 080 min au pas de 30, ou NULL (défaut du
-- pays). Un trip ou un hold déjà posé n'est jamais touché : le préavis ne joue qu'à la pose.
CREATE FUNCTION core.catalog_cmd_set_location_notice(p_token_hash bytea, p_org uuid,
                                                     p_location_id uuid, p_minutes integer)
  RETURNS TABLE (outcome text, location_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h record;
  n integer;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_minutes IS NOT NULL AND (p_minutes NOT BETWEEN 60 AND 10080 OR p_minutes % 30 <> 0) THEN
    RETURN QUERY SELECT 'NOTICE_INVALID'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE core.catalog_location AS l
     SET advance_notice_minutes = p_minutes
   WHERE l.id = p_location_id AND l.org_id = p_org AND l.country_code = h.country_code;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN QUERY SELECT 'LOCATION_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'DONE'::text, p_location_id;
END
$fn$;

-- 6.4 En-tête du calendrier d'un véhicule : fuseau, annonce publiée, lieu, préavis de l'hôte et
-- préavis en vigueur. Une ligne, `outcome` d'abord (VEHICLE_NOT_FOUND pour un véhicule d'autrui).
CREATE FUNCTION core.catalog_host_vehicle_calendar(p_token_hash bytea, p_org uuid, p_vehicle_id uuid)
  RETURNS TABLE (outcome text, timezone text, listed boolean, location_id uuid,
                 notice_minutes integer, effective_notice_minutes integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h record;
  v record;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::text, NULL::boolean, NULL::uuid, NULL::integer,
                        NULL::integer;
    RETURN;
  END IF;
  SELECT cv.timezone AS tz, cv.home_location_id AS loc, l.advance_notice_minutes AS notice,
         EXISTS (SELECT 1 FROM core.catalog_listing AS li
                  WHERE li.vehicle_id = cv.id AND li.status = 'LISTED') AS listed
    INTO v
    FROM core.catalog_vehicle AS cv
    JOIN core.catalog_location AS l ON l.id = cv.home_location_id
   WHERE cv.id = p_vehicle_id AND cv.org_id = p_org AND cv.country_code = h.country_code;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'VEHICLE_NOT_FOUND'::text, NULL::text, NULL::boolean, NULL::uuid,
                        NULL::integer, NULL::integer;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'DONE'::text, v.tz, v.listed, v.loc, v.notice,
                      core.catalog_effective_notice_minutes(p_vehicle_id);
END
$fn$;

-- 6.5 Occupations du calendrier (16 CAL-001, bêta : liste) : actives, non terminées, de CE
-- véhicule du compte ; type, source et bornes locales (fuseau du véhicule), au plus 500, par début.
-- Jamais le voyageur ni la référence d'un hold ou d'un trip. Véhicule d'autrui : aucune ligne.
CREATE FUNCTION core.catalog_host_vehicle_occupancies(p_token_hash bytea, p_org uuid,
                                                      p_vehicle_id uuid)
  RETURNS TABLE (occupancy_id uuid, kind text, source text, starts_at timestamptz,
                 ends_at timestamptz, start_local text, end_local text, removable boolean)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT vo.id, vo.kind, vo.source, pg_catalog.lower(vo.period), pg_catalog.upper(vo.period),
         pg_catalog.to_char(pg_catalog.lower(vo.period) AT TIME ZONE cv.timezone,
                            'YYYY-MM-DD"T"HH24:MI'),
         pg_catalog.to_char(pg_catalog.upper(vo.period) AT TIME ZONE cv.timezone,
                            'YYYY-MM-DD"T"HH24:MI'),
         (vo.kind = 'HOST_BLOCK' AND vo.source = 'MANUAL')
    FROM core.catalog_host_context(p_token_hash, p_org) AS h
    JOIN core.catalog_vehicle AS cv
      ON cv.id = p_vehicle_id AND cv.org_id = p_org AND cv.country_code = h.country_code
    JOIN core.booking_vehicle_occupancy AS vo
      ON vo.vehicle_id = cv.id AND vo.org_id = p_org AND vo.active
   WHERE h.outcome = 'OK' AND pg_catalog.upper(vo.period) > platform.now()
   ORDER BY pg_catalog.lower(vo.period), vo.id
   LIMIT 500
$fn$;

COMMENT ON FUNCTION core.catalog_cmd_place_host_block(bytea, uuid, uuid, timestamp, timestamp) IS
  'Commande de l''hôte de la session : blocage d''un véhicule publié de son compte, heures locales '
  'du véhicule au pas de 30 min, par la commande booking_cmd_place_host_block (exclusion GiST, '
  'verrou du véhicule). US-119 (ADR-100).';
COMMENT ON FUNCTION core.catalog_cmd_remove_host_block(bytea, uuid, uuid, uuid) IS
  'Commande de l''hôte de la session : levée d''un blocage manuel d''un véhicule de son compte, par '
  'booking_cmd_remove_host_block. US-119 (ADR-100).';
COMMENT ON FUNCTION core.catalog_cmd_set_location_notice(bytea, uuid, uuid, integer) IS
  'Commande de l''hôte de la session : préavis minimum d''un lieu de remise (60 à 10 080 min, pas '
  'de 30 ; NULL = défaut du pays). US-119 (ADR-100).';
COMMENT ON FUNCTION core.catalog_host_vehicle_calendar(bytea, uuid, uuid) IS
  'Lecture de l''hôte de la session : en-tête du calendrier d''un véhicule (fuseau, publication, '
  'lieu, préavis). US-119 (ADR-100).';
COMMENT ON FUNCTION core.catalog_host_vehicle_occupancies(bytea, uuid, uuid) IS
  'Lecture de l''hôte de la session : occupations actives à venir d''un véhicule de son compte, '
  'sans donnée du voyageur. US-119 (ADR-100).';

REVOKE ALL ON FUNCTION
  core.catalog_cmd_place_host_block(bytea, uuid, uuid, timestamp, timestamp),
  core.catalog_cmd_remove_host_block(bytea, uuid, uuid, uuid),
  core.catalog_cmd_set_location_notice(bytea, uuid, uuid, integer),
  core.catalog_host_vehicle_calendar(bytea, uuid, uuid),
  core.catalog_host_vehicle_occupancies(bytea, uuid, uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.catalog_cmd_place_host_block(bytea, uuid, uuid, timestamp, timestamp),
  core.catalog_cmd_remove_host_block(bytea, uuid, uuid, uuid),
  core.catalog_cmd_set_location_notice(bytea, uuid, uuid, integer),
  core.catalog_host_vehicle_calendar(bytea, uuid, uuid),
  core.catalog_host_vehicle_occupancies(bytea, uuid, uuid)
TO app_api;

GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_place_host_block(bytea, uuid, uuid, timestamp, timestamp)
  OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_remove_host_block(bytea, uuid, uuid, uuid) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_set_location_notice(bytea, uuid, uuid, integer)
  OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_host_vehicle_calendar(bytea, uuid, uuid) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_host_vehicle_occupancies(bytea, uuid, uuid) OWNER TO catalog_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 7. Sonde de disponibilité (17 §2.3 `catalog.vehicle_is_free`, RLS-17) --------------------------
-- Propriétaire dédié catalog_probe_owner (NOLOGIN, lecture seule de deux tables par politique) ;
-- booléen seul ; NULL hors annonce LISTED ou période mal formée ; période arrondie à l'heure (début
-- à l'heure inférieure, fin à l'heure supérieure, en UTC) : ni bornes exactes ni hold révélés.
GRANT USAGE ON SCHEMA core TO catalog_probe_owner;
GRANT SELECT (vehicle_id, status) ON core.catalog_listing TO catalog_probe_owner;
CREATE POLICY probe_read ON core.catalog_listing FOR SELECT TO catalog_probe_owner
  USING (status = 'LISTED');
GRANT SELECT (vehicle_id, period, active) ON core.booking_vehicle_occupancy TO catalog_probe_owner;
CREATE POLICY probe_read ON core.booking_vehicle_occupancy FOR SELECT TO catalog_probe_owner
  USING (active);

CREATE FUNCTION core.catalog_vehicle_is_free(p_vehicle_id uuid, p_period tstzrange)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_lo timestamptz;
  v_hi timestamptz;
BEGIN
  IF p_vehicle_id IS NULL OR p_period IS NULL OR pg_catalog.isempty(p_period)
     OR pg_catalog.lower_inf(p_period) OR pg_catalog.upper_inf(p_period)
     OR NOT pg_catalog.isfinite(pg_catalog.lower(p_period))
     OR NOT pg_catalog.isfinite(pg_catalog.upper(p_period)) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.catalog_listing AS l
                  WHERE l.vehicle_id = p_vehicle_id AND l.status = 'LISTED') THEN
    RETURN NULL;
  END IF;
  v_lo := pg_catalog.date_trunc('hour', pg_catalog.lower(p_period), 'UTC');
  v_hi := pg_catalog.date_trunc('hour', pg_catalog.upper(p_period), 'UTC');
  IF v_hi < pg_catalog.upper(p_period) THEN
    v_hi := v_hi + pg_catalog.make_interval(hours => 1);
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM core.booking_vehicle_occupancy AS vo
                      WHERE vo.vehicle_id = p_vehicle_id AND vo.active
                        AND vo.period && pg_catalog.tstzrange(v_lo, v_hi, '[)'));
END
$fn$;
COMMENT ON FUNCTION core.catalog_vehicle_is_free(uuid, tstzrange) IS
  'Sonde (17 §2.3, RLS-17) : véhicule publié libre sur la période arrondie à l''heure ; NULL hors '
  'annonce LISTED ; booléen seul. Branchée à la recherche par US-201. US-119 (ADR-100).';
REVOKE ALL ON FUNCTION core.catalog_vehicle_is_free(uuid, tstzrange) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_vehicle_is_free(uuid, tstzrange) TO app_api;
GRANT CREATE ON SCHEMA core TO catalog_probe_owner;
ALTER FUNCTION core.catalog_vehicle_is_free(uuid, tstzrange) OWNER TO catalog_probe_owner;
REVOKE CREATE ON SCHEMA core FROM catalog_probe_owner;
