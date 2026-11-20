-- 0168 — TRP / AVL : détection automatique des retards, prolongation tacite de l'occupation et
-- trip suivant « à risque » (bêta).
-- US-305 ; 19 US-305 (« Given une fin à 10:00 et overdue_detection_minutes = 30, When il est
-- 10:29, Then pas d'OVERDUE ; à 10:30, OVERDUE et une seule alerte au voyageur, à l'hôte et à
-- l'ops » ; « Given un trip OVERDUE étendu pendant qu'un hold est posé sur la période suivante,
-- Then aucun chevauchement actif et le trip suivant est marqué à risque (C10) » ; variante PY) ;
-- 16 TRP-035 (détection sans check-out à fin + overdue_detection_minutes, tâche planifiée chaque
-- minute, EVT_TRIP_OVERDUE au voyageur et à l'hôte ; « seuls les trips réservés ensuite
-- l'appliquent » ; conflit avec le trip suivant ⇒ alerte ops, EC-19) ; 08 BR-RETURN-03
-- (franchise 0–29 min, détection à 30 min), BR-BOOK-05 (tampon [début, fin + tampon)), SM-1
-- (IN_PROGRESS → OVERDUE) ; 17 §2.5 (« Retard et prolongation tacite » ; C10 ; verrous voyageur
-- puis véhicule), §3.2.4 (`trip.at_risk_reason` = PREVIOUS_OVERDUE), §3.2.10 (`overdue_case`),
-- §4.5 (`trip.overdue.detected`), §7.2 (`overdue_detection_minutes`,
-- `overdue_occupancy_step_minutes`, `buffer_minutes`) ; 22 OQ-BR-04, OQ-BR-39 (défaut : détection
-- à 30 min, grille et frontière retard / extension paramétrées) ; pré-mortem du lot 3 : L3-PM-09,
-- L3-PM-13, L3-PM-15, L3-PM-16, L3-PM-55 ; ADR-188 (cette migration). Appliquée sous `migrator`,
-- en une transaction.
--
-- Principes (ADR-188, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - un seul écrivain : le travailleur `trip_overdue` (tâche périodique pg-boss, 60 s), un trip
--     par transaction, par `core.trip_cmd_detect_overdue` (SECURITY DEFINER, `cmd_hold_owner`,
--     EXECUTE au seul `app_worker`) ; liste des trips à traiter par `core.trip_overdue_due` ;
--   - verrous consultatifs du voyageur puis du véhicule du trip (ordre global de 17 §2.5, celui de
--     core.booking_trip_lock et de la remise), puis ligne du trip FOR UPDATE ; heure SERVEUR lue
--     APRÈS les verrous (platform.now()), jamais l'heure d'un appareil ni d'un champ reçu ;
--   - seuil = `overdue_detection_minutes` du pays EN VIGUEUR À LA RÉSERVATION (`booked_at`) : un
--     changement publié ensuite ne s'applique qu'aux trips réservés après lui (16 TRP-035) ;
--     absent ⇒ PARAM_MISSING (aucune détection devinée, le travailleur alerte l'ops) ;
--   - un trip IN_PROGRESS dont platform.now() ≥ fin prévue + seuil passe OVERDUE (motif
--     OVERDUE_DETECTED) par core.booking_trip_apply_transition (0099, inchangée : journal d'état,
--     trip.status_changed) ; un trip rendu (RETURNED) ou dans tout autre état n'est jamais touché ;
--   - le dossier de retard `trip_ops_overdue_case` (17 `overdue_case`, une ligne par trip, étape
--     T30M) est ouvert dans la même transaction et l'événement `trip.overdue.detected` n'est écrit
--     QU'À son ouverture : une minuterie rejouée, deux travailleurs ou un trip déjà OVERDUE ne
--     produisent jamais une seconde alerte (contrainte d'unicité et verrous) ;
--   - prolongation tacite (17 §2.5, F21) : à l'entrée en OVERDUE, puis chaque fois que la
--     prolongation précédente est épuisée, la période de l'occupation TRIP devient
--     [début, now() + overdue_occupancy_step_minutes + buffer_minutes), jamais raccourcie ; si une
--     occupation active suivante du véhicule (hold, trip, blocage, tampon) commence avant, la
--     période s'arrête à son début (aucun chevauchement : l'exclusion GiST tient, la pose d'un
--     hold concurrent attend le verrou du véhicule) ; si cette occupation est un TRIP, il est
--     marqué à risque (`at_risk_reason` = PREVIOUS_OVERDUE) UNE fois et `trip.at_risk.flagged`
--     part (hôte et ops) ; un hold qui borne est revu au passage suivant (C10 : s'il devient un
--     trip, ce trip est marqué) ;
--   - aucun montant, aucune écriture d'argent, aucun `release_at` : le frais de retard
--     (`lateFee` = max(grille, extension), BR-RETURN-03, OQ-BR-04) est porté par US-703, qui lit
--     le dossier (fin prévue, seuil, détection) et la fin effective (première ligne RETURNED du
--     journal d'état, 0163) ;
--   - aucun interrupteur lu ni écrit ; aucune constante de pays ; aucune escalade (T2H à T24H,
--     UNRETURNED : US-306, US-523).
--
-- Écarts PROPOSÉS à 17 (ADR-188) : `overdue_case` porte aussi la fin prévue, le seuil appliqué, la
-- fin de la prolongation tacite, la borne et le trip suivant marqué ; `actions`,
-- `gps_requested_at` et `police_report_ref` arrivent avec l'escalade (US-306, US-318) ;
-- `trip.at_risk.flagged` est un événement nouveau (17 §4.5 à compléter).
--
-- Erreurs (SQLSTATE, contrainte) traduites par packages/db/src/errors.ts, sans DETAIL :
--   trip_command_forbidden (42501)      → FORBIDDEN (contexte autre que le travailleur trip_overdue) ;
--   trip_param_missing (55000)          → PARAM_MISSING (seuil, pas ou tampon du pays absents) ;
--   trip_overdue_batch_invalid (23514)  → INVARIANT_VIOLATION (taille de lot hors [1, 1000]) ;
--   trip_overdue_case_immutable (23000) → IMMUTABLE_RECORD (suppression ou réécriture du dossier) ;
--   trip_has_active_occupancy (23000)   → INVARIANT_VIOLATION (aucune occupation TRIP active, I-OCC).
--
-- Expand / contract : une colonne (`booking_trip.at_risk_reason`), une table, des fonctions, des
-- droits et des politiques AJOUTÉS. Rien de retiré.
--
-- Retour arrière (base sans détection des retards) :
--   DROP FUNCTION core.trip_cmd_detect_overdue(uuid), core.trip_overdue_due(integer),
--     core.trip_overdue_param_at(text, text, timestamptz) ;
--   DROP TABLE core.trip_ops_overdue_case ; DROP FUNCTION core.trip_overdue_case_guard() ;
--   DROP POLICY cmd_trip_overdue_upd ON core.booking_trip ;
--   DROP POLICY cmd_trip_overdue_occ_upd ON core.booking_vehicle_occupancy ;
--   DROP POLICY cmd_trip_overdue_event_ins ON core.outbox_outbox_event ;
--   DROP POLICY cmd_hold_overdue_param_read ON core.config_param_value ;
--   REVOKE UPDATE (at_risk_reason), SELECT (at_risk_reason) ON core.booking_trip FROM cmd_hold_owner ;
--   REVOKE UPDATE (period), SELECT (period) ON core.booking_vehicle_occupancy FROM cmd_hold_owner ;
--   ALTER TABLE core.booking_trip DROP COLUMN at_risk_reason.

-- 1. Trip suivant « à risque » (17 §3.2.4 `at_risk_reason`, F21) ------------------------------------
ALTER TABLE core.booking_trip
  ADD COLUMN at_risk_reason text
    CONSTRAINT trip_at_risk_reason_valid
      CHECK (at_risk_reason IS NULL OR at_risk_reason = 'PREVIOUS_OVERDUE');
COMMENT ON COLUMN core.booking_trip.at_risk_reason IS
  'Trip à risque (17 §3.2.4, F21) : PREVIOUS_OVERDUE quand la prolongation tacite du trip '
  'précédent du même véhicule, en retard, est bornée par son occupation. Posé une fois par le '
  'travailleur trip_overdue (core.trip_cmd_detect_overdue). US-305 (ADR-188).';

-- 2. Dossier de retard (17 §3.2.10 `overdue_case`, classe B) ---------------------------------------
CREATE TABLE core.trip_ops_overdue_case (
  id                uuid        NOT NULL DEFAULT pg_catalog.gen_random_uuid()
    CONSTRAINT trip_overdue_case_pkey PRIMARY KEY,
  trip_id           uuid        NOT NULL REFERENCES core.booking_trip (id)
    CONSTRAINT trip_overdue_case_trip_unique UNIQUE,
  country_code      text        NOT NULL
    CONSTRAINT trip_overdue_case_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- étape de 17 ; US-305 n'écrit que T30M (l'escalade T2H à T24H et RESOLVED : US-306, US-523)
  stage             text        NOT NULL DEFAULT 'T30M'
    CONSTRAINT trip_overdue_case_stage_valid
      CHECK (stage IN ('T30M', 'T2H', 'T6H', 'T24H', 'RESOLVED')),
  -- faits figés à l'ouverture, lus par US-703 (frais de retard) : fin prévue, seuil appliqué
  scheduled_end     timestamptz NOT NULL,
  detection_minutes integer     NOT NULL
    CONSTRAINT trip_overdue_case_minutes_range CHECK (detection_minutes BETWEEN 0 AND 1440),
  detected_at       timestamptz NOT NULL,
  -- prolongation tacite : utilisation réputée jusqu'à `use_until` (sans tampon) ; borne haute de
  -- l'occupation posée (`occupancy_until`, tampon compris, bornée par l'occupation suivante)
  use_until         timestamptz NOT NULL,
  occupancy_until   timestamptz NOT NULL,
  bounded           boolean     NOT NULL DEFAULT false,
  -- trip suivant du même véhicule marqué à risque (PREVIOUS_OVERDUE), une fois
  next_trip_id      uuid        REFERENCES core.booking_trip (id),
  updated_at        timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT trip_overdue_case_detected_after_end CHECK (detected_at >= scheduled_end),
  CONSTRAINT trip_overdue_case_next_differs CHECK (next_trip_id IS DISTINCT FROM trip_id)
);
COMMENT ON TABLE core.trip_ops_overdue_case IS
  'TRP overdue_case (17 §3.2.10, 16 TRP-035) : dossier de retard d''un trip, ouvert à la '
  'détection (étape T30M) avec la fin prévue et le seuil appliqué ; prolongation tacite de '
  'l''occupation et trip suivant marqué à risque. Écrit par core.trip_cmd_detect_overdue '
  'seulement (travailleur trip_overdue) ; jamais supprimé. US-305 (ADR-188).';

-- Dossier : faits figés (trip, pays, fin prévue, seuil, détection) jamais réécrits ; jamais
-- supprimé. migrator exempté (propriétaire, aucun code applicatif ne tourne sous lui, L0-05).
CREATE FUNCTION core.trip_overdue_case_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF current_user = 'migrator' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE'
     OR NEW.id IS DISTINCT FROM OLD.id OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.scheduled_end IS DISTINCT FROM OLD.scheduled_end
     OR NEW.detection_minutes IS DISTINCT FROM OLD.detection_minutes
     OR NEW.detected_at IS DISTINCT FROM OLD.detected_at
     OR NEW.stage IS DISTINCT FROM OLD.stage
     OR (OLD.next_trip_id IS NOT NULL AND NEW.next_trip_id IS DISTINCT FROM OLD.next_trip_id)
     OR NEW.use_until < OLD.use_until OR NEW.occupancy_until < OLD.occupancy_until THEN
    RAISE EXCEPTION 'overdue case: frozen facts are immutable'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'trip_overdue_case_immutable';
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER trip_overdue_case_guard BEFORE UPDATE OR DELETE ON core.trip_ops_overdue_case
  FOR EACH ROW EXECUTE FUNCTION core.trip_overdue_case_guard();
REVOKE ALL ON FUNCTION core.trip_overdue_case_guard() FROM PUBLIC;

ALTER TABLE core.trip_ops_overdue_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_overdue_case FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.trip_ops_overdue_case TO migrator USING (true)
  WITH CHECK (true);
REVOKE ALL ON core.trip_ops_overdue_case FROM PUBLIC;

-- 3. Droits et politiques de cmd_hold_owner (au plus juste) ---------------------------------------
GRANT SELECT, INSERT ON core.trip_ops_overdue_case TO cmd_hold_owner;
GRANT UPDATE (use_until, occupancy_until, bounded, next_trip_id, updated_at)
  ON core.trip_ops_overdue_case TO cmd_hold_owner;
CREATE POLICY cmd_hold_overdue_sel ON core.trip_ops_overdue_case FOR SELECT TO cmd_hold_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_overdue');
CREATE POLICY cmd_hold_overdue_ins ON core.trip_ops_overdue_case FOR INSERT TO cmd_hold_owner
  WITH CHECK (stage = 'T30M' AND app.actor_kind() = 'WORKER'
              AND app.worker_name() = 'trip_overdue');
CREATE POLICY cmd_hold_overdue_upd ON core.trip_ops_overdue_case FOR UPDATE TO cmd_hold_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_overdue')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_overdue');

-- 3.1 Trip : transition IN_PROGRESS → OVERDUE (paire de SM-1, journal de la même transaction : garde
-- trip_transition_guard de 0099) et marque « à risque » d'un trip pas encore commencé ; travailleur
-- trip_overdue seulement
GRANT SELECT (id, status, guest_user_id, org_id, vehicle_id, country_code, scheduled_start,
              scheduled_end, booked_at, row_version, at_risk_reason)
  ON core.booking_trip TO cmd_hold_owner;
GRANT UPDATE (at_risk_reason) ON core.booking_trip TO cmd_hold_owner;
CREATE POLICY cmd_trip_overdue_upd ON core.booking_trip FOR UPDATE TO cmd_hold_owner
  USING (status IN ('IN_PROGRESS', 'BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED')
         AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_overdue')
  WITH CHECK ((status = 'OVERDUE'
               OR (status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED')
                   AND at_risk_reason = 'PREVIOUS_OVERDUE'))
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_overdue');

-- 3.2 Occupation TRIP d'un trip OVERDUE : période prolongée, toujours active
GRANT SELECT (period) ON core.booking_vehicle_occupancy TO cmd_hold_owner;
GRANT UPDATE (period) ON core.booking_vehicle_occupancy TO cmd_hold_owner;
CREATE POLICY cmd_trip_overdue_occ_upd ON core.booking_vehicle_occupancy FOR UPDATE
  TO cmd_hold_owner
  USING (kind = 'TRIP' AND ref_type = 'TRIP' AND active
         AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_overdue'
         AND EXISTS (SELECT 1 FROM core.booking_trip AS t
                      WHERE t.id = booking_vehicle_occupancy.ref_id AND t.status = 'OVERDUE'))
  WITH CHECK (kind = 'TRIP' AND ref_type = 'TRIP' AND active
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_overdue'
              AND EXISTS (SELECT 1 FROM core.booking_trip AS t
                           WHERE t.id = booking_vehicle_occupancy.ref_id
                             AND t.status = 'OVERDUE'));

-- 3.3 Événements du retard (17 §4.5) : système seulement, travailleur trip_overdue
CREATE POLICY cmd_trip_overdue_event_ins ON core.outbox_outbox_event FOR INSERT TO cmd_hold_owner
  WITH CHECK (aggregate_type = 'trip'
              AND type IN ('trip.overdue.detected', 'trip.at_risk.flagged')
              AND actor_role = 'SYSTEM' AND actor_user_id IS NULL
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_overdue');

-- 3.4 Paramètres lus : seuil (à la réservation) et pas de la prolongation tacite ; le tampon est
-- déjà lu par cmd_hold_read (0032)
CREATE POLICY cmd_hold_overdue_param_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('overdue_detection_minutes', 'overdue_occupancy_step_minutes'));

-- 4. Fonctions (cmd_hold_owner) -----------------------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 4.1 Valeur entière d'un paramètre COUNTRY en vigueur à un instant donné (la réservation pour le
-- seuil, 16 TRP-035) ; absente ou mal formée ⇒ NULL et l'appelant refuse. SECURITY INVOKER,
-- interne (mêmes règles que core.booking_param_int de 0037, à un instant choisi).
CREATE FUNCTION core.trip_overdue_param_at(p_key text, p_country text, p_at timestamptz)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                   AND (v.value #>> '{}') ~ '^[0-9]{1,6}$'
              THEN (v.value #>> '{}')::integer END
    FROM core.config_param_value AS v
   WHERE v.key = p_key
     AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= p_at
     AND (v.valid_to IS NULL OR v.valid_to > p_at)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;
COMMENT ON FUNCTION core.trip_overdue_param_at(text, text, timestamptz) IS
  'Interne : paramètre entier COUNTRY en vigueur à un instant (seuil du retard à la réservation, '
  '16 TRP-035) ; NULL si absent. US-305 (ADR-188).';

-- 4.2 Trips à traiter : IN_PROGRESS échus (fin prévue + seuil à la réservation ≤ maintenant ; seuil
-- absent : le trip est listé et la commande refuse PARAM_MISSING, jamais un retard ignoré en
-- silence), OVERDUE sans dossier, OVERDUE dont la prolongation est épuisée ou bornée. Lot borné,
-- plus anciens d'abord.
CREATE FUNCTION core.trip_overdue_due(p_batch integer)
  RETURNS TABLE (trip_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now timestamptz := platform.now();
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'trip_overdue' THEN
    RAISE EXCEPTION 'trip overdue: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'trip_command_forbidden';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 1000 THEN
    RAISE EXCEPTION 'trip overdue: batch size out of range'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'trip_overdue_batch_invalid';
  END IF;
  RETURN QUERY
  SELECT t.id
    FROM core.booking_trip AS t
    LEFT JOIN core.trip_ops_overdue_case AS c ON c.trip_id = t.id
   WHERE (t.status = 'IN_PROGRESS'
          AND t.scheduled_end + pg_catalog.make_interval(mins => COALESCE(
                core.trip_overdue_param_at('overdue_detection_minutes', t.country_code,
                                           t.booked_at), 0)) <= v_now)
      OR (t.status = 'OVERDUE'
          AND (c.id IS NULL OR c.use_until <= v_now OR c.bounded))
   ORDER BY t.scheduled_end, t.id
   LIMIT p_batch;
END
$fn$;
COMMENT ON FUNCTION core.trip_overdue_due(integer) IS
  'Trips à traiter par le travailleur trip_overdue (retards échus, prolongations épuisées ou '
  'bornées), lot borné. SECURITY DEFINER, EXECUTE app_worker. US-305 (ADR-188).';

-- 4.3 Détection, prolongation tacite et trip suivant à risque, pour UN trip (une transaction).
-- Issues (`outcome`) : DETECTED (IN_PROGRESS → OVERDUE, dossier ouvert, trip.overdue.detected),
-- CASE_OPENED (trip déjà OVERDUE sans dossier : dossier et événement, sans transition), EXTENDED
-- (prolongation posée), UNCHANGED, NOT_DUE (pas encore en retard : rien n'est écrit), SKIPPED
-- (trip inconnu, rendu ou dans un autre état : rien n'est écrit). `nextAtRisk` : trip suivant
-- marqué dans cette transaction.
CREATE FUNCTION core.trip_cmd_detect_overdue(p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest    uuid;
  v_vehicle  uuid;
  t          record;
  c          record;
  occ        record;
  nxt        record;
  v_now      timestamptz;
  v_minutes  integer;
  v_step     integer;
  v_buffer   integer;
  v_use      timestamptz;
  v_desired  timestamptz;
  v_upper    timestamptz;
  v_bounded  boolean := false;
  v_outcome  text;
  v_version  integer;
  v_holder   uuid;
  v_next     record;
  v_at_risk  boolean := false;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'trip_overdue' THEN
    RAISE EXCEPTION 'trip overdue: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'trip_command_forbidden';
  END IF;
  -- guest_user_id et vehicle_id ne changent jamais : les verrous pris sont bien ceux du trip
  SELECT tr.guest_user_id, tr.vehicle_id INTO v_guest, v_vehicle
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  IF v_guest IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('tripId', p_trip_id, 'outcome', 'SKIPPED');
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  SELECT tr.id, tr.status, tr.country_code, tr.org_id, tr.scheduled_end, tr.booked_at
    INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id FOR UPDATE;
  -- heure lue APRÈS l'attente des verrous (17 §1.3 point 1) : un retour validé pendant l'attente
  -- est vu (RETURNED), jamais rattrapé par une détection
  v_now := platform.now();
  IF t.status NOT IN ('IN_PROGRESS', 'OVERDUE') THEN
    RETURN pg_catalog.jsonb_build_object('tripId', t.id, 'outcome', 'SKIPPED',
                                         'status', t.status);
  END IF;
  SELECT oc.id, oc.use_until, oc.occupancy_until, oc.bounded, oc.next_trip_id
    INTO c
    FROM core.trip_ops_overdue_case AS oc WHERE oc.trip_id = t.id;

  IF c.id IS NULL THEN
    v_minutes := core.trip_overdue_param_at('overdue_detection_minutes', t.country_code,
                                            t.booked_at);
    IF v_minutes IS NULL THEN
      RAISE EXCEPTION 'trip overdue: parameter overdue_detection_minutes missing'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
    END IF;
    IF v_now < t.scheduled_end + pg_catalog.make_interval(mins => v_minutes) THEN
      RETURN pg_catalog.jsonb_build_object('tripId', t.id, 'outcome', 'NOT_DUE',
                                           'status', t.status);
    END IF;
  END IF;

  v_step := core.booking_param_int('overdue_occupancy_step_minutes', t.country_code);
  v_buffer := core.booking_buffer_minutes(t.country_code);
  IF v_step IS NULL OR v_step < 1 OR v_buffer IS NULL THEN
    RAISE EXCEPTION 'trip overdue: parameter overdue_occupancy_step_minutes or buffer_minutes missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
  END IF;

  IF t.status = 'IN_PROGRESS' THEN
    -- SM-1 : IN_PROGRESS → OVERDUE (paire de la table, journal, trip.status_changed)
    v_version := core.booking_trip_apply_transition(t.id, 'IN_PROGRESS', 'OVERDUE',
                                                    'OVERDUE_DETECTED', NULL, 'SYSTEM',
                                                    'TRANSITION', '{}'::jsonb);
    v_outcome := 'DETECTED';
  ELSIF c.id IS NULL THEN
    SELECT tr.row_version INTO v_version FROM core.booking_trip AS tr WHERE tr.id = t.id;
    v_outcome := 'CASE_OPENED';
  ELSE
    v_outcome := 'UNCHANGED';
  END IF;

  -- prolongation tacite (17 §2.5) : épuisée (ou première) ⇒ maintenant + pas ; borne : début de
  -- l'occupation active suivante du véhicule (exclusion GiST respectée, jamais de chevauchement)
  v_use := c.use_until;
  IF v_use IS NULL OR v_use <= v_now THEN
    v_use := v_now + pg_catalog.make_interval(mins => v_step);
  END IF;
  v_desired := v_use + pg_catalog.make_interval(mins => v_buffer);
  SELECT o.id, pg_catalog.lower(o.period) AS lo, pg_catalog.upper(o.period) AS up
    INTO occ
    FROM core.booking_vehicle_occupancy AS o
   WHERE o.kind = 'TRIP' AND o.ref_type = 'TRIP' AND o.ref_id = t.id AND o.active;
  IF occ.id IS NULL THEN
    -- I-OCC (0006) : un trip qui tient le créneau a exactement une occupation TRIP active
    RAISE EXCEPTION 'trip overdue: no active TRIP occupancy'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_has_active_occupancy';
  END IF;
  SELECT pg_catalog.lower(o.period) AS lo, o.kind, o.ref_type, o.ref_id
    INTO nxt
    FROM core.booking_vehicle_occupancy AS o
   WHERE o.vehicle_id = v_vehicle AND o.active AND o.id <> occ.id
     AND pg_catalog.lower(o.period) >= occ.lo
   ORDER BY pg_catalog.lower(o.period), o.id
   LIMIT 1;
  v_upper := v_desired;
  IF nxt.lo IS NOT NULL AND nxt.lo < v_desired THEN
    v_upper := nxt.lo;
    v_bounded := true;
  END IF;
  IF v_upper > occ.up THEN
    UPDATE core.booking_vehicle_occupancy
       SET period = pg_catalog.tstzrange(occ.lo, v_upper, '[)')
     WHERE id = occ.id;
    IF v_outcome = 'UNCHANGED' THEN
      v_outcome := 'EXTENDED';
    END IF;
  ELSE
    v_upper := occ.up;
  END IF;

  SELECT o.holder_user_id INTO v_holder FROM core.iam_organization AS o WHERE o.id = t.org_id;

  IF c.id IS NULL THEN
    INSERT INTO core.trip_ops_overdue_case (trip_id, country_code, stage, scheduled_end,
                                            detection_minutes, detected_at, use_until,
                                            occupancy_until, bounded, updated_at)
    VALUES (t.id, t.country_code, 'T30M', t.scheduled_end, v_minutes, v_now, v_use, v_upper,
            v_bounded, v_now);
    -- l'alerte (voyageur, hôte, ops) part UNE fois : à l'ouverture du dossier seulement
    INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_role, correlation_id, payload, partition_key)
    VALUES ('trip.overdue.detected', 1, 'trip', t.id, v_version, t.country_code, 'SYSTEM',
            pg_catalog.gen_random_uuid(),
            pg_catalog.jsonb_build_object('trip_id', t.id, 'stage', 'T30M',
                                          'guest_user_id', v_guest, 'host_user_id', v_holder,
                                          'scheduled_end', t.scheduled_end,
                                          'detected_at', v_now),
            t.id::text);
  ELSE
    UPDATE core.trip_ops_overdue_case
       SET use_until = v_use, occupancy_until = v_upper, bounded = v_bounded, updated_at = v_now
     WHERE id = c.id;
  END IF;

  -- trip suivant du même véhicule (C10) : marqué à risque une fois, s'il n'a pas commencé
  IF v_bounded AND nxt.kind = 'TRIP' AND nxt.ref_type = 'TRIP' THEN
    UPDATE core.booking_trip AS tr
       SET at_risk_reason = 'PREVIOUS_OVERDUE'
     WHERE tr.id = nxt.ref_id AND tr.at_risk_reason IS NULL
       AND tr.status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED')
    RETURNING tr.id, tr.row_version, tr.country_code, tr.scheduled_start, tr.org_id
      INTO v_next;
    IF v_next.id IS NOT NULL THEN
      v_at_risk := true;
      UPDATE core.trip_ops_overdue_case SET next_trip_id = v_next.id WHERE trip_id = t.id;
      INSERT INTO core.outbox_outbox_event
             (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_role, correlation_id, payload, partition_key)
      SELECT 'trip.at_risk.flagged', 1, 'trip', v_next.id, v_next.row_version,
             v_next.country_code, 'SYSTEM', pg_catalog.gen_random_uuid(),
             pg_catalog.jsonb_build_object('trip_id', v_next.id, 'reason', 'PREVIOUS_OVERDUE',
                                           'host_user_id', o.holder_user_id,
                                           'scheduled_start', v_next.scheduled_start),
             v_next.id::text
        FROM core.iam_organization AS o WHERE o.id = v_next.org_id;
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object('tripId', t.id, 'outcome', v_outcome,
                                       'status', 'OVERDUE', 'occupancyUntil', v_upper,
                                       'useUntil', v_use, 'bounded', v_bounded,
                                       'nextAtRisk', v_at_risk);
END
$fn$;
COMMENT ON FUNCTION core.trip_cmd_detect_overdue(uuid) IS
  'Commande du travailleur trip_overdue : détection du retard (IN_PROGRESS → OVERDUE à fin prévue '
  '+ overdue_detection_minutes en vigueur à la réservation, heure serveur après les verrous du '
  'voyageur puis du véhicule), dossier et alerte une fois, prolongation tacite de l''occupation '
  'bornée par l''occupation suivante, trip suivant marqué à risque (C10). Aucune écriture '
  'd''argent. SECURITY DEFINER, EXECUTE app_worker. US-305 (ADR-188).';

REVOKE ALL ON FUNCTION core.trip_overdue_param_at(text, text, timestamptz),
  core.trip_overdue_due(integer), core.trip_cmd_detect_overdue(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.trip_overdue_due(integer), core.trip_cmd_detect_overdue(uuid)
  TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
