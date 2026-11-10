-- 0056 — AVL : véhicule du compte exigé pour les blocages ; auto-réservation d'un membre refusée ; périodes bornées.
-- US-049 (porte du lot 0, correctifs de la red team RLS : docs/team/redteam/L0-rls.md, F-RLS-01
-- et F-RLS-02) ; 16 CAL-011, BKG-012, ACC-014 ; 17 §2.3 (« org_id = catalog.vehicle_org(vehicle_id),
-- jamais choisi par le client », RLS-15), §2.5 ; ADR-053, ADR-060, ADR-063 ; ADR-089. Appliquée
-- sous `migrator`.
--
-- 1. F-RLS-01 (PROPOSÉ critique, RT-RLS-17 « squatting ») : `core.booking_cmd_place_host_block`
--    n'autorisait que par `app.host_covers_vehicle(véhicule)`, vrai pour TOUT identifiant chez un
--    titulaire (portée NULL) ; le seul contrôle de propriété portait sur les occupations déjà
--    présentes. Un hôte gelait donc le calendrier d'un véhicule d'autrui encore inoccupé (puis
--    l'exclusion occupancy_vehicle_single_org refusait toute occupation du vrai propriétaire), et
--    la commande écrivait une occupation pour n'importe quel UUID. Désormais la commande exige que
--    `core.booking_vehicle_party(véhicule)` (le catalogue, US-115 ; registre de test 9750 dans la
--    base de test) désigne le compte ET le pays de la session ; un véhicule inconnu est refusé
--    (fail-closed, même réponse `occupancy_host_forbidden`). Conséquence assumée : en production,
--    où le catalogue n'existe pas encore, AUCUN blocage n'est possible (comme aucun hold : 0037),
--    jusqu'à US-115. La levée (`booking_cmd_remove_host_block`) fait le même contrôle (défense en
--    profondeur : un blocage ne se lève que sur un véhicule du compte).
--    La clé étrangère (vehicle_id, org_id, country_code) vers catalog_vehicle prévue par ADR-060
--    ne peut pas être posée au lot 0 : la table du catalogue n'existe pas. Elle vient avec US-115,
--    qui remplace aussi le corps de booking_vehicle_party (ADR-089).
--    `booking_cmd_place_buffer` n'est pas concerné : le tampon reprend le véhicule, le compte et le
--    pays du trip, jamais un argument (0032).
-- 2. F-RLS-02 (PROPOSÉ critique, RT-RLS-13) : `self_booking_forbidden` ne comparait que le
--    titulaire du compte d'hôte. `core.booking_cmd_place_hold` refuse aussi tout MEMBRE du compte
--    d'hôte du véhicule (titulaire ou co-hôte, appartenance ACTIVE ou INVITED : un compte lié au
--    véhicule, 16 BKG-012 / ACC-014), avec la même erreur `hold_self_booking`
--    (SELF_BOOKING_FORBIDDEN), dans les deux pays. Les autres liens (carte, appareil) restent à la
--    revue KYC (16 ACC-014, lot 2). Corps de 0037 recopié à l'identique, hors ce contrôle et le
--    point 3.
-- 3. RT-CONC-02, partie « fin infinie » (red team concurrence, docs/team/redteam/L0-concurrence.md,
--    PROPOSÉ faible) : `booking_cmd_place_hold` acceptait une fin `infinity` (période occupée
--    [début, infini)). La pose exige désormais deux bornes finies (`isfinite`) et une durée
--    fin - début d'au plus `max_trip_days` jours du pays du véhicule (17 §7.2 : 30 j, ADM-031,
--    « décidé (bêta) » ; graine 0009) : au-delà, `occupancy_period_invalid` (INVALID_PERIOD) ;
--    paramètre absent ou mal formé, `hold_param_missing` (PARAM_MISSING), comme les autres
--    paramètres de la pose (fail-closed). La politique cmd_hold_read de config_param_value est
--    recréée sous le même nom avec cette clé en plus (liste de 0040 inchangée sinon).
--    `booking_cmd_place_host_block` avait le même défaut (début `-infinity` ou fin `infinity`
--    acceptés) : bornes finies exigées. Aucun plafond de durée pour un blocage : l'hôte bloque son
--    propre véhicule aussi longtemps qu'il le veut (BR-BOOK-07), sur ses seuls véhicules depuis le
--    point 1.
--
-- Droits ajoutés (au plus juste) : SELECT (org_id, user_id, status) de core.iam_membership pour
-- cmd_hold_owner, sous la politique cmd_hold_read (lecture seule, propriétaire NOLOGIN ; aucun rôle
-- applicatif ne gagne de droit) ; la clé max_trip_days lisible par cmd_hold_owner. Propriétaires, EXECUTE et entrées RLS-15 inchangés.
--
-- Expand / contract : aucune contraction de SCHÉMA ni de DROIT (corps de fonctions remplacés à
-- signature et propriétaire identiques, un droit et une politique ajoutés, une politique recréée
-- sous le même nom). Le COMPORTEMENT, lui, se resserre en fail-closed, volontairement : plus aucun
-- blocage possible en production avant le catalogue (US-115), hold refusé aux membres du compte
-- d'hôte, durée d'un hold plafonnée par max_trip_days, bornes infinies refusées. La version N
-- servie appelle les mêmes commandes et reçoit FORBIDDEN, SELF_BOOKING_FORBIDDEN, INVALID_PERIOD,
-- codes qu'elle traduit déjà.
--
-- Retour arrière :
--   réappliquer les définitions de 0032 de core.booking_cmd_place_host_block(uuid, timestamptz,
--   timestamptz) et core.booking_cmd_remove_host_block(uuid), et celle de 0037 de
--   core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean) (sous cmd_hold_owner,
--   CREATE sur core accordé le temps du remplacement, comme ci-dessous) ;
--   DROP POLICY cmd_hold_read ON core.iam_membership;
--   recréer cmd_hold_read de core.config_param_value avec la liste de clés de 0040 ;
--   REVOKE SELECT (org_id, user_id, status) ON core.iam_membership FROM cmd_hold_owner.

-- 1. Lecture des appartenances par les commandes de hold --------------------------------------
GRANT SELECT (org_id, user_id, status) ON core.iam_membership TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.iam_membership FOR SELECT TO cmd_hold_owner USING (true);

-- Clés lues par les commandes de hold : liste de 0040 + max_trip_days (RT-CONC-02). Même nom,
-- même table : remplacement admis (ADR-081).
DROP POLICY cmd_hold_read ON core.config_param_value;
CREATE POLICY cmd_hold_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('buffer_minutes', 'hold_ttl_minutes', 'hold_max_total_minutes',
                 'max_active_holds_per_guest', 'hold_creations_per_guest_vehicle_hour',
                 'sweep_grace_s', 'flagged_booking_payment_order', 'review_hold_minutes',
                 'payment_in_flight_margin_s', 'psp_call_timeout_s',
                 'conversion_start_tolerance_minutes', 'payment_attempts_per_hold',
                 'max_trip_days'));

-- `migrator` ne remplace une fonction d'un autre propriétaire qu'en devenant lui (ADR-044
-- amendé) ; CREATE sur le schéma accordé le temps du remplacement (comme 0040, 0045, 0053).
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 2. Blocage manuel : véhicule du compte et du pays de la session (F-RLS-01) -------------------
CREATE OR REPLACE FUNCTION core.booking_cmd_place_host_block(
  p_vehicle_id uuid,
  p_start      timestamptz,
  p_end        timestamptz
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_actor       uuid := app.actor_id();
  v_org         uuid := app.org_id();
  v_country     text;
  v_party_org   uuid;
  v_party_cntry text;
  v_id          uuid := pg_catalog.gen_random_uuid();
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'HOST' OR v_actor IS NULL OR v_org IS NULL
     OR p_vehicle_id IS NULL OR NOT app.host_covers_vehicle(p_vehicle_id) THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;
  SELECT o.country_code INTO v_country FROM core.iam_organization o WHERE o.id = v_org;
  IF v_country IS NULL THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;
  -- US-049 (F-RLS-01) : le véhicule appartient au compte ET au pays de la session, selon le
  -- catalogue (booking_vehicle_party, jamais un argument) ; véhicule inconnu, d'un autre compte ou
  -- du même titulaire dans un autre pays : même réponse que hors portée (rien n'est révélé)
  SELECT p.org_id, p.country_code INTO v_party_org, v_party_cntry
    FROM core.booking_vehicle_party(p_vehicle_id) AS p;
  IF v_party_org IS DISTINCT FROM v_org OR v_party_cntry IS DISTINCT FROM v_country THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;
  -- US-049 (RT-CONC-02) : bornes finies (ni -infinity ni infinity)
  IF p_start IS NULL OR p_end IS NULL OR NOT pg_catalog.isfinite(p_start)
     OR NOT pg_catalog.isfinite(p_end) OR p_end <= p_start OR p_end <= platform.now() THEN
    RAISE EXCEPTION 'host block: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || p_vehicle_id::text, 0));

  -- véhicule d'un autre compte d'hôte (ou du même titulaire dans un autre pays) : même réponse
  -- que hors portée ; l'exclusion occupancy_vehicle_single_org reste le filet structurel
  IF EXISTS (SELECT 1 FROM core.booking_vehicle_occupancy vo
              WHERE vo.vehicle_id = p_vehicle_id AND vo.org_id <> v_org) THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;

  -- 23P01 vehicle_occupancy_no_overlap possible ici : créneau pris
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, created_by)
  VALUES (v_id, p_vehicle_id, v_org, v_country, 'HOST_BLOCK', 'MANUAL',
          pg_catalog.tstzrange(p_start, p_end, '[)'), true, v_actor);
  RETURN v_id;
END
$fn$;

-- 3. Levée d'un blocage : même contrôle de propriété (défense en profondeur) -------------------
CREATE OR REPLACE FUNCTION core.booking_cmd_remove_host_block(p_block_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_actor     uuid := app.actor_id();
  v_org       uuid := app.org_id();
  v_party_org uuid;
  b           record;
  n           integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'HOST' OR v_actor IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;
  SELECT vo.vehicle_id, vo.org_id, vo.kind, vo.source
    INTO b
    FROM core.booking_vehicle_occupancy vo
   WHERE vo.id = p_block_id;
  IF NOT FOUND OR b.kind <> 'HOST_BLOCK' OR b.source <> 'MANUAL' OR b.org_id <> v_org
     OR NOT app.host_covers_vehicle(b.vehicle_id) THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;
  -- US-049 (F-RLS-01) : le véhicule du blocage est bien, au catalogue, un véhicule du compte
  SELECT p.org_id INTO v_party_org FROM core.booking_vehicle_party(b.vehicle_id) AS p;
  IF v_party_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'host block: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'occupancy_host_forbidden';
  END IF;

  -- vehicle_id n'est modifiable par personne : le verrou pris est bien celui du véhicule du blocage
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || b.vehicle_id::text, 0));
  UPDATE core.booking_vehicle_occupancy
     SET active = false, deactivated_reason = 'BLOCK_REMOVED', updated_by = v_actor
   WHERE id = p_block_id AND active;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END
$fn$;

-- 4. Pose d'un hold : aucun membre du compte d'hôte du véhicule (F-RLS-02) ---------------------
-- Corps de 0037 recopié à l'identique, hors le contrôle self_booking_forbidden (étape marquée
-- US-049).
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
  IF v_buffer IS NULL OR v_ttl IS NULL OR v_max_total IS NULL OR v_max_live IS NULL
     OR v_rate IS NULL OR v_grace IS NULL OR v_minutes IS NULL OR v_minutes < 1
     OR v_max_days IS NULL OR v_max_days < 1 THEN
    RAISE EXCEPTION 'hold: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  -- US-049 (RT-CONC-02) : durée de location au plus max_trip_days jours du pays (17 §7.2, ADM-031)
  IF p_end - p_start > pg_catalog.make_interval(days => v_max_days) THEN
    RAISE EXCEPTION 'hold: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
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

-- commentaires posés sous le propriétaire (COMMENT exige d'en être le propriétaire)
COMMENT ON FUNCTION core.booking_cmd_place_host_block(uuid, timestamptz, timestamptz) IS
  'Commande : blocage manuel de l''hôte (BR-BOOK-07, CAL-011), sur un véhicule du compte et du pays '
  'de la session selon booking_vehicle_party (fail-closed : véhicule inconnu refusé). US-022, US-049.';
COMMENT ON FUNCTION core.booking_cmd_remove_host_block(uuid) IS
  'Commande : levée d''un blocage manuel de son compte (BLOCK_REMOVED), véhicule du compte selon '
  'booking_vehicle_party. US-022, US-049.';
COMMENT ON FUNCTION core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean) IS
  'Commande : pose d''un hold de checkout (17 §2.5 étape 2) ; refusée au titulaire et à tout membre '
  'du compte d''hôte du véhicule (SELF_BOOKING_FORBIDDEN). US-023, US-049.';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
