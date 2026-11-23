-- 0179 — AVL : refus rapide de la pose perdante sous le verrou du véhicule, et paramètres de pays
-- lus par un plan mis en cache (L0-02, N-468).
-- US-007 (suite) ; 17 §2.5 étape 2 (0, 2a à 2d), §6.7 (« création de hold p95 < 300 ms ; 100
-- requêtes concurrentes ⇒ 1 succès exact »), §11 L0-02 (C1) ; ADR-056 (point 4 : pistes de la
-- révision de 17 §2.5), ADR-199 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Constat (ADR-199, « Attribution de la dérive ») : à processeur égal, le p95 de C1 a pris 15 à
-- 18 % du 2026-11-17 au 2026-11-22, par petites marches, aux fusions qui ajoutent ou élargissent
-- une politique de lecture de `core.config_param_value` pour `cmd_hold_owner` (0122, 0124, 0126,
-- 0144, 0146, 0158, 0168, 0175 ; listes élargies par 0150, 0153, 0163, 0171, 0173).
-- `core.booking_param_int` et `core.booking_param_text` sont des fonctions SQL à clause `SET` :
-- PostgreSQL ne les intègre jamais à la requête appelante ; il analyse, réécrit (RLS comprise) et
-- PLANIFIE leur corps à chaque transaction, pour chaque appel. La pose en fait huit ou neuf, et
-- chaque planification porte le OU de toutes les politiques permissives de `cmd_hold_owner`, qui
-- s'allonge à chaque story. Par ailleurs, chaque pose perdante fait sous le verrou du véhicule
-- tout le travail d'une gagnante (2a, 2b, insertion dans sept index dont deux contrôles
-- d'exclusion GiST) avant de recevoir `23P01` : la file de C1 paie ce travail 99 fois.
--
-- Principes (ADR-199, PROPOSÉS) :
--   1. Refus rapide (piste d'ADR-056 point 4) : juste après le verrou du véhicule, une lecture de
--      l'occupation active qui chevauche la période occupée. Si l'occupation en conflit est
--      DÉFINITIVE (2a ne peut pas la libérer : occupation autre que HOLD, ou hold qui n'est pas à
--      la fois ACTIVE / PAYMENT_IN_FLIGHT et échu à platform.now()), la pose est refusée aussitôt
--      avec l'erreur de la contrainte : SQLSTATE `23P01`, contrainte `vehicle_occupancy_no_overlap`
--      (traduite `VEHICLE_UNAVAILABLE`, 17 §2.5 2d ; `DATES_UNAVAILABLE` au checkout), sans
--      `DETAIL` (M9) et sans aucune écriture. Sinon (créneau libre, ou conflit avec un hold échu
--      que 2a peut libérer), la pose suit le chemin inchangé (2a, 2b, 2c) et l'exclusion GiST
--      `vehicle_occupancy_no_overlap` reste la SEULE garde de l'unicité du créneau : le refus
--      rapide ne refuse que ce que l'insertion aurait refusé. Ordre des verrous, texte de 2a,
--      conversion gardée et platform.now() inchangés.
--   2. Paramètres : `core.booking_param_int` et `core.booking_param_text` passent en PL/pgSQL, même
--      requête, mêmes attributs (STABLE, SECURITY INVOKER, search_path figé), même propriétaire et
--      mêmes droits : le plan est gardé par la session (PostgreSQL le revalide à tout changement de
--      politique ou de table, et le refait si le rôle courant change) au lieu d'être refait à
--      chaque transaction. Résultat identique, NULL compris (aucune ligne ⇒ NULL).
--   3. Une seule différence observable, PROPOSÉE (ADR-199, « Ordre des refus ») : une pose sur un
--      créneau définitivement pris reçoit `VEHICLE_UNAVAILABLE` même si un contrôle de 2b (holds
--      vivants, chevauchement des trips du voyageur, rotation) l'aurait aussi refusée ; avant, le
--      refus de 2b passait le premier. Les contrôles faits AVANT le verrou (auto-réservation,
--      restrictions, consentement, paramètres, préavis) gardent leur priorité. Rien n'est écrit
--      dans les deux cas : la pose refusée était déjà annulée en entier.
--   4. Aucune donnée personnelle, aucun interrupteur lu ni écrit, aucune constante de pays.
--
-- Expand / contract : trois fonctions remplacées à signature, propriétaire, droits et résultat
-- identiques. Rien d'ajouté ni de retiré au schéma.
--
-- Retour arrière : corps de core.booking_place_hold_kind de 0126 et de core.booking_param_int /
--   core.booking_param_text de 0037 rétablis (CREATE OR REPLACE, mêmes propriétaires).

-- 1. Paramètres du pays : corps de 0037, en PL/pgSQL (plan gardé par la session) ----------------
CREATE OR REPLACE FUNCTION core.booking_param_int(p_key text, p_country text)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN (
    WITH t AS (SELECT platform.now() AS ts)
    SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                     AND (v.value #>> '{}') ~ '^[0-9]{1,6}$'
                THEN (v.value #>> '{}')::integer END
      FROM core.config_param_value v CROSS JOIN t
     WHERE v.key = p_key
       AND v.country_code::text = p_country
       AND v.scope_type = 'COUNTRY'
       AND v.valid_from <= t.ts
       AND (v.valid_to IS NULL OR v.valid_to > t.ts)
     ORDER BY v.valid_from DESC
     LIMIT 1);
END
$fn$;

CREATE OR REPLACE FUNCTION core.booking_param_text(p_key text, p_country text)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN (
    WITH t AS (SELECT platform.now() AS ts)
    SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'string' THEN v.value #>> '{}' END
      FROM core.config_param_value v CROSS JOIN t
     WHERE v.key = p_key
       AND v.country_code::text = p_country
       AND v.scope_type = 'COUNTRY'
       AND v.valid_from <= t.ts
       AND (v.valid_to IS NULL OR v.valid_to > t.ts)
     ORDER BY v.valid_from DESC
     LIMIT 1);
END
$fn$;

COMMENT ON FUNCTION core.booking_param_int(text, text) IS
  'Paramètre entier du pays en vigueur à platform.now() ; NULL si absent ou mal formé. US-023 ; '
  'PL/pgSQL depuis 0179 (plan gardé par la session, ADR-199).';
COMMENT ON FUNCTION core.booking_param_text(text, text) IS
  'Paramètre texte (ENUM) du pays en vigueur à platform.now() ; NULL si absent. US-023 ; PL/pgSQL '
  'depuis 0179 (plan gardé par la session, ADR-199).';

-- 2. Pose d'un hold : corps de 0126 recopié, refus rapide ajouté (marqué US-007 / ADR-199) -------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

CREATE OR REPLACE FUNCTION core.booking_place_hold_kind(
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

  -- US-007 / ADR-199 (0179) : refus rapide, sous le verrou du véhicule et avant toute écriture. Une
  -- occupation active qui chevauche la période et que 2a ne peut pas libérer (autre qu'un HOLD, ou
  -- hold qui n'est pas ACTIVE / PAYMENT_IN_FLIGHT échu) : l'insertion de 2c échouerait sur
  -- vehicle_occupancy_no_overlap ; même erreur, sans DETAIL (M9), sans rien écrire. Sinon, chemin
  -- inchangé : l'exclusion GiST reste la seule garde de l'unicité du créneau
  IF EXISTS (
       SELECT 1
         FROM core.booking_vehicle_occupancy o
        WHERE o.vehicle_id = p_vehicle_id
          AND o.active
          AND o.period && v_period
          AND (o.kind <> 'HOLD'
               OR EXISTS (SELECT 1 FROM core.booking_checkout_hold h
                           WHERE o.ref_type = 'HOLD' AND h.id = o.ref_id AND h.occupancy_id = o.id
                             AND NOT (h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
                                      AND h.expires_at <= platform.now())))) THEN
    RAISE EXCEPTION 'hold: vehicle unavailable'
      USING ERRCODE = 'exclusion_violation', CONSTRAINT = 'vehicle_occupancy_no_overlap',
            SCHEMA = 'core', TABLE = 'booking_vehicle_occupancy';
  END IF;

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
  'appelée par core.booking_cmd_place_hold et core.booking_cmd_checkout. US-023, US-223 ; refus '
  'rapide sous le verrou du véhicule depuis 0179 (US-007, ADR-199).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
