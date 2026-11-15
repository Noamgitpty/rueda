-- 0099 — AVL : machine à états du trip (SM-1, SM-1b), segment, conducteur principal, journal d'état.
-- US-207 ; 19 US-207 (« Given un trip IN_PROGRESS, When une annulation est demandée, Then
-- TRIP_TRANSITION_FORBIDDEN » ; « Given T25, When une annulation guest arrive à T+75 min, Then elle
-- est requalifiée GUEST_NO_SHOW » ; « Given chaque transition, When elle a lieu, Then trip_state_log
-- et trip.status_changed sont écrits ») ; 16 TRP-045 (transitions gardées, journalisées ; verrou par
-- trip, premier gagnant ; TRIP_TRANSITION_FORBIDDEN, TRIP_CONCURRENT_UPDATE) ; 08 SM-1 (diagramme,
-- invariants 1, 2, 3, 4, 7), SM-1b, règles de qualification 1 à 3 de BR-CXL, table de décision
-- BR-CXL (colonne « État SM-1 »), motifs 22 à 26 ; vecteurs T05, T06, T25 ; 11 EC-54 ; 17 §2.5
-- (verrous voyageur → véhicule, I-OCC), §3.1.2 (journal d'état de chaque machine), §3.2.4 (`trip`,
-- `trip_segment`, `trip_driver`, `trip_state_log`), §4.5 (`trip.status_changed`,
-- `trip.cancellation.qualified`), §7.2 (`no_show_grace_minutes`, `overdue_detection_minutes`) ;
-- pré-mortem du lot 2 : L2-PM-24, L2-PM-09, L2-PM-13, L2-PM-23 ; ADR-048, ADR-053, ADR-060,
-- ADR-065 ; ADR-126 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-126, PROPOSÉS) :
--   - la table des transitions est EN BASE (`core.booking_trip_transition`, 36 paires de SM-1 ;
--     QUOTE et HOLD vivent sur le hold, la boucle IN_PROGRESS → IN_PROGRESS des modifications n'est
--     pas un changement d'état). Toute paire absente ⇒ TRIP_TRANSITION_FORBIDDEN ;
--   - on écrit l'état UNIQUEMENT par deux commandes (`SECURITY DEFINER`, `cmd_hold_owner`,
--     EXECUTE au seul `app_worker`, travailleur `trip_lifecycle`) :
--       `core.booking_cmd_trip_transition` (cycle de vie : CHECKIN_OPEN, START_WINDOW_EXPIRED,
--         IN_PROGRESS, OVERDUE, RETURNED, UNRETURNED, TERMINATED_EARLY, VEHICLE_LOST, POST_TRIP,
--         COMPLETED, IN_DISPUTE) ;
--       `core.booking_cmd_trip_cancel` (annulations et no-shows : motif qualifié par les règles 1
--         à 3 de BR-CXL, état cible = fonction du motif qualifié, jamais de l'initiateur) ;
--     le droit UPDATE (status, cancellation_reason, termination_reason) est RETIRÉ à app_worker ;
--   - chaque transition, dans UNE transaction, sous les verrous consultatifs du voyageur puis du
--     véhicule (ordre global de 17 §2.5) et le verrou de ligne du trip : ligne `trip_state_log`,
--     changement d'état, occupations libérées si l'état cible ne tient plus le créneau (liste
--     d'I-OCC, 0006), événement `trip.status_changed` dans l'outbox (et
--     `trip.cancellation.qualified` pour une annulation) ;
--   - garde structurelle `trip_transition_guard` (BEFORE UPDATE OF status) : la paire est dans la
--     table ET une ligne du journal (même trip, même paire) a été écrite dans la MÊME transaction ;
--     sinon refus. `migrator` (propriétaire des tables, aucun code applicatif ne tourne sous lui,
--     L0-05) en est exempté : il peut de toute façon désactiver un trigger ;
--   - naissance du trip (SM-1 HOLD → BOOKED, conversion gardée d'US-024, 0041, inchangée) : triggers
--     de la table `booking_trip` : état BOOKED exigé, `no_show_at` figé (début + no_show_grace_minutes
--     du pays), segment n° 1, conducteur PRIMARY (le titulaire), journal (NULL → BOOKED,
--     HOLD_CONVERTED) et `trip.status_changed` ;
--   - le règlement (invariant 4 de SM-1) n'est PAS calculé ici : `settlement_id` du journal reste NULL
--     jusqu'à US-215 / US-224, qui appellent le moteur dans la même transaction que la commande.
--
-- Erreurs (SQLSTATE, contrainte) traduites par packages/db/src/errors.ts, sans DETAIL :
--   trip_transition_forbidden (55000)   → TRIP_TRANSITION_FORBIDDEN (paire absente, motif hors de la
--                                         table, trip inconnu : même réponse) ;
--   trip_concurrent_update (55000)      → TRIP_CONCURRENT_UPDATE (row_version attendue différente) ;
--   trip_no_show_too_early (55000)      → REJECTED_TOO_EARLY (règle de qualification 3) ;
--   trip_transition_too_early (55000)   → REJECTED_TOO_EARLY (START_WINDOW_EXPIRED avant no_show_at,
--                                         OVERDUE avant fin + overdue_detection_minutes) ;
--   trip_param_missing (55000)          → PARAM_MISSING ;
--   trip_command_forbidden (42501)      → FORBIDDEN ;
--   trip_transition_unlogged (23000)    → INVARIANT_VIOLATION ;
--   trip_segment_missing (23000)        → INVARIANT_VIOLATION (segment n° 1 absent, fail-closed) ;
--   trip_state_log_immutable (23000)    → IMMUTABLE_RECORD.
--
-- Expand / contract : colonnes, tables, fonctions, triggers et politiques ajoutés ; politique
-- cmd_hold_read de config_param_value recréée sous le même nom avec deux clés de plus ; UN droit
-- retiré à un rôle applicatif (UPDATE de status, cancellation_reason et termination_reason du trip
-- à app_worker, dérogation inscrite dans expand-contract-allowlist.json : aucune version servie
-- n'écrit l'état d'un trip, les seuls écrivains étaient des tests).
--
-- Retour arrière :
--   GRANT UPDATE (status, termination_reason, cancellation_reason) ON core.booking_trip TO app_worker;
--   DROP FUNCTION core.booking_cmd_trip_transition(uuid, text, text, integer),
--     core.booking_cmd_trip_cancel(uuid, text, text, text, boolean, integer),
--     core.booking_trip_apply_transition(uuid, text, text, text, text, text, text, jsonb),
--     core.booking_trip_lock(uuid, integer), core.booking_trip_holds_slot(text),
--     core.booking_cancellation_target(text) ;
--   DROP TRIGGER trip_transition_guard, trip_birth_defaults, trip_birth_records, trip_period_sync
--     ON core.booking_trip ;
--   DROP FUNCTION core.booking_trip_transition_guard(), core.booking_trip_birth_defaults(),
--     core.booking_trip_birth_records(), core.booking_trip_period_sync(),
--     core.booking_trip_state_log_immutable() ;
--   DROP TABLE core.booking_trip_state_log, core.booking_trip_driver, core.booking_trip_segment,
--     core.booking_trip_transition ;
--   ALTER TABLE core.booking_trip DROP COLUMN no_show_at, DROP COLUMN checkin_validated_at,
--     DROP COLUMN cancel_initiator, DROP COLUMN cancel_requested_at ;
--   recréer cmd_hold_read de config_param_value sans les deux clés (définition de 0071) ;
--   DROP POLICY cmd_trip_upd ON core.booking_trip ; DROP POLICY cmd_trip_occ_upd ON
--     core.booking_vehicle_occupancy ; DROP POLICY cmd_trip_guest_occ_sel, cmd_trip_guest_occ_upd
--     ON core.booking_guest_occupancy ; DROP POLICY cmd_trip_event_ins ON core.outbox_outbox_event ;
--   révoquer les droits de cmd_hold_owner accordés ci-dessous.

-- 1. Colonnes du trip (17 §3.2.4) ------------------------------------------------------------------
ALTER TABLE core.booking_trip
  -- noShowAt = début + no_show_grace_minutes du pays, figé à la réservation (17 §3.2.4, BR-CXL-08)
  ADD COLUMN no_show_at           timestamptz,
  -- invariant 1 de SM-1 : IN_PROGRESS exige un check-in validé (posé par la transition elle-même)
  ADD COLUMN checkin_validated_at timestamptz,
  -- initiateur d'une annulation : audit et pénalités seulement, jamais la branche (BR-CXL)
  ADD COLUMN cancel_initiator     text
    CONSTRAINT trip_cancel_initiator_valid CHECK (cancel_initiator IS NULL OR cancel_initiator IN
      ('GUEST', 'HOST', 'CO_HOST', 'PLATFORM', 'SYSTEM')),
  -- heure SERVEUR de la demande d'annulation (règle de qualification 1)
  ADD COLUMN cancel_requested_at  timestamptz;

COMMENT ON COLUMN core.booking_trip.no_show_at IS
  'noShowAt = scheduled_start + no_show_grace_minutes du pays, figé à la naissance du trip '
  '(trigger trip_birth_defaults). NULL seulement pour un trip antérieur à 0099. US-207.';
COMMENT ON COLUMN core.booking_trip.checkin_validated_at IS
  'Check-in validé (SM-1 invariant 1), posé par la transition vers IN_PROGRESS. US-207.';

-- 2. Table des transitions de SM-1 (08 SM-1 ; classe C, écrite par migration seulement) -----------
-- via = commande qui porte la transition : TRANSITION (cycle de vie) ou CANCEL (annulation et
-- no-show, motif qualifié). Aucune paire ne sort d'un état d'annulation ou de no-show (invariant 7 :
-- une requalification SM-7 est une écriture d'audit, US ultérieure) ; aucun état terminal ne revient
-- vers un état qui tient le créneau (hypothèse de lecture d'I-OCC, 0006).
CREATE TABLE core.booking_trip_transition (
  from_status text NOT NULL,
  to_status   text NOT NULL,
  via         text NOT NULL
    CONSTRAINT trip_transition_via_valid CHECK (via IN ('TRANSITION', 'CANCEL')),
  CONSTRAINT trip_transition_pkey PRIMARY KEY (from_status, to_status),
  CONSTRAINT trip_transition_states_valid CHECK (
    from_status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE',
                    'RETURNED', 'UNRETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP',
                    'COMPLETED', 'IN_DISPUTE')
    AND to_status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE',
                      'RETURNED', 'UNRETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP',
                      'COMPLETED', 'IN_DISPUTE', 'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST',
                      'CANCELLED_BY_PLATFORM', 'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST',
                      'NO_SHOW_HOST')
    AND from_status <> to_status),
  -- une annulation ou un no-show passe par la commande d'annulation, jamais l'inverse
  CONSTRAINT trip_transition_via_matches CHECK (
    (via = 'CANCEL') = (to_status IN ('CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST',
                                      'CANCELLED_BY_PLATFORM', 'REFUSED_AT_PICKUP',
                                      'NO_SHOW_GUEST', 'NO_SHOW_HOST')))
);
COMMENT ON TABLE core.booking_trip_transition IS
  'Transitions autorisées de SM-1 (08), une ligne par paire. Écrite par migration seulement ; lue '
  'par les commandes de trip et par le trigger trip_transition_guard. US-207, ADR-126.';
ALTER TABLE core.booking_trip_transition ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_trip_transition FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_trip_transition TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.booking_trip_transition FROM PUBLIC;

INSERT INTO core.booking_trip_transition (from_status, to_status, via) VALUES
  -- BOOKED : ouverture du check-in (T−24 h, BR-PICKUP-01) ou annulation
  ('BOOKED', 'CHECKIN_OPEN', 'TRANSITION'),
  ('BOOKED', 'CANCELLED_BY_GUEST', 'CANCEL'),
  ('BOOKED', 'CANCELLED_BY_HOST', 'CANCEL'),
  ('BOOKED', 'CANCELLED_BY_PLATFORM', 'CANCEL'),
  -- CHECKIN_OPEN
  ('CHECKIN_OPEN', 'CANCELLED_BY_GUEST', 'CANCEL'),
  ('CHECKIN_OPEN', 'CANCELLED_BY_HOST', 'CANCEL'),
  ('CHECKIN_OPEN', 'CANCELLED_BY_PLATFORM', 'CANCEL'),
  ('CHECKIN_OPEN', 'REFUSED_AT_PICKUP', 'CANCEL'),
  ('CHECKIN_OPEN', 'NO_SHOW_GUEST', 'CANCEL'),
  ('CHECKIN_OPEN', 'NO_SHOW_HOST', 'CANCEL'),
  ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'TRANSITION'),
  ('CHECKIN_OPEN', 'IN_PROGRESS', 'TRANSITION'),
  -- START_WINDOW_EXPIRED (noShowAt atteint sans check-in)
  ('START_WINDOW_EXPIRED', 'NO_SHOW_GUEST', 'CANCEL'),
  ('START_WINDOW_EXPIRED', 'NO_SHOW_HOST', 'CANCEL'),
  ('START_WINDOW_EXPIRED', 'IN_PROGRESS', 'TRANSITION'),
  ('START_WINDOW_EXPIRED', 'CANCELLED_BY_HOST', 'CANCEL'),
  ('START_WINDOW_EXPIRED', 'CANCELLED_BY_PLATFORM', 'CANCEL'),
  ('START_WINDOW_EXPIRED', 'CANCELLED_BY_GUEST', 'CANCEL'),
  ('START_WINDOW_EXPIRED', 'REFUSED_AT_PICKUP', 'CANCEL'),
  -- IN_PROGRESS : jamais d'annulation (invariant 2), fin forcée par TERMINATED_EARLY
  ('IN_PROGRESS', 'OVERDUE', 'TRANSITION'),
  ('IN_PROGRESS', 'RETURNED', 'TRANSITION'),
  ('IN_PROGRESS', 'TERMINATED_EARLY', 'TRANSITION'),
  ('OVERDUE', 'IN_PROGRESS', 'TRANSITION'),
  ('OVERDUE', 'RETURNED', 'TRANSITION'),
  ('OVERDUE', 'UNRETURNED', 'TRANSITION'),
  ('UNRETURNED', 'RETURNED', 'TRANSITION'),
  ('UNRETURNED', 'VEHICLE_LOST', 'TRANSITION'),
  ('TERMINATED_EARLY', 'RETURNED', 'TRANSITION'),
  ('TERMINATED_EARLY', 'VEHICLE_LOST', 'TRANSITION'),
  ('TERMINATED_EARLY', 'POST_TRIP', 'TRANSITION'),
  ('VEHICLE_LOST', 'POST_TRIP', 'TRANSITION'),
  ('RETURNED', 'POST_TRIP', 'TRANSITION'),
  ('POST_TRIP', 'COMPLETED', 'TRANSITION'),
  ('POST_TRIP', 'IN_DISPUTE', 'TRANSITION'),
  ('COMPLETED', 'IN_DISPUTE', 'TRANSITION'),
  ('IN_DISPUTE', 'COMPLETED', 'TRANSITION');

-- 3. Segment de trip (17 §3.2.4 ; Bêta : un seul segment, 17 §10) ----------------------------------
CREATE TABLE core.booking_trip_segment (
  id             uuid        CONSTRAINT booking_trip_segment_pkey PRIMARY KEY,
  trip_id        uuid        NOT NULL
    CONSTRAINT booking_trip_segment_trip_fkey REFERENCES core.booking_trip (id),
  seq            integer     NOT NULL
    -- Bêta : un segment par trip (trip ≤ 30 j, 17 §10) ; les segments mensuels viendront en P1
    CONSTRAINT trip_segment_beta_single CHECK (seq = 1),
  period         tstzrange   NOT NULL
    CONSTRAINT trip_segment_period_valid CHECK (NOT isempty(period) AND lower_inc(period)
                                                AND NOT upper_inc(period)
                                                AND lower(period) IS NOT NULL
                                                AND upper(period) IS NOT NULL),
  -- renseignés par le devis et le contrat (US-202, US-211) ; NULL = inconnu
  billable_days  integer
    CONSTRAINT trip_segment_billable_days_positive CHECK (billable_days IS NULL OR billable_days >= 1),
  price_version  integer
    CONSTRAINT trip_segment_price_version_positive CHECK (price_version IS NULL OR price_version >= 1),
  due_at         timestamptz,
  payment_status text        NOT NULL DEFAULT 'CONFIRMED'
    CONSTRAINT trip_segment_payment_status_valid CHECK (payment_status IN
      ('CONFIRMED', 'REFUNDED_PARTIAL', 'REFUNDED')),
  created_at     timestamptz NOT NULL DEFAULT platform.now(),
  updated_at     timestamptz NOT NULL DEFAULT platform.now(),
  row_version    integer     NOT NULL DEFAULT 0,
  CONSTRAINT trip_segment_seq_unique UNIQUE (trip_id, seq)
);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_trip_segment
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_trip_segment
  FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete();
COMMENT ON TABLE core.booking_trip_segment IS
  'Segment de trip (17 §3.2.4). Bêta : exactement un segment (seq = 1), écrit à la naissance du trip '
  '(trigger trip_birth_records), période recopiée de scheduled_start / scheduled_end '
  '(trip_period_sync). Aucun droit applicatif. US-207.';
ALTER TABLE core.booking_trip_segment ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_trip_segment FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_trip_segment TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.booking_trip_segment FROM PUBLIC;

-- 4. Conducteurs du trip (17 §3.2.4 ; Bêta : PRIMARY seul, conducteur additionnel via l'ops) ------
CREATE TABLE core.booking_trip_driver (
  trip_id     uuid        NOT NULL
    CONSTRAINT booking_trip_driver_trip_fkey REFERENCES core.booking_trip (id),
  user_id     uuid        NOT NULL
    CONSTRAINT booking_trip_driver_user_fkey REFERENCES core.iam_user_account (id),
  role        text        NOT NULL
    -- Bêta : le titulaire est le conducteur principal (BR-BOOK-08) ; ADDITIONAL arrive en P1
    CONSTRAINT trip_driver_beta_primary CHECK (role = 'PRIMARY'),
  -- approbation du conducteur (SM-1 invariant 1) : à la conversion, qui rejoue l'éligibilité du
  -- voyageur (17 §2.5, 2 bis (iii)) ; PROPOSÉ (ADR-126)
  approved_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT booking_trip_driver_pkey PRIMARY KEY (trip_id, user_id)
);
-- exactement un PRIMARY par trip : « au plus » ici, « au moins » par trip_birth_records
CREATE UNIQUE INDEX one_primary_driver_per_trip ON core.booking_trip_driver (trip_id)
  WHERE (role = 'PRIMARY');
CREATE INDEX trip_driver_user_idx ON core.booking_trip_driver (user_id);
CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_trip_driver
  FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete();
COMMENT ON TABLE core.booking_trip_driver IS
  'Conducteurs d''un trip (17 §3.2.4). Bêta : une ligne PRIMARY (le voyageur titulaire), écrite à '
  'la naissance du trip (trigger trip_birth_records). Aucun droit applicatif. US-207.';
ALTER TABLE core.booking_trip_driver ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_trip_driver FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_trip_driver TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.booking_trip_driver FROM PUBLIC;

-- 5. Journal d'état du trip (17 §3.1.2, §3.2.4 ; classe A, immuable ; SM-1 invariant 7) ------------
CREATE TABLE core.booking_trip_state_log (
  id            uuid        CONSTRAINT booking_trip_state_log_pkey PRIMARY KEY,
  trip_id       uuid        NOT NULL
    CONSTRAINT booking_trip_state_log_trip_fkey REFERENCES core.booking_trip (id),
  -- NULL : naissance du trip (SM-1 HOLD → BOOKED, l'état HOLD vit sur le hold)
  from_status   text,
  to_status     text        NOT NULL,
  -- AUDIT_CORRECTION : requalification SM-7 d'un état terminal (invariant 7), aucun écrivain encore
  kind          text        NOT NULL
    CONSTRAINT trip_state_log_kind_valid CHECK (kind IN ('TRANSITION', 'AUDIT_CORRECTION')),
  -- motif qualifié (annulation), motif de fin (TERM_*), ou code de l'événement de cycle de vie
  reason_code   text        NOT NULL
    CONSTRAINT trip_state_log_reason_format CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  -- origine de la qualification (BR-CXL) : EVENT, LATE_GUEST_CANCELLATION,
  -- REQUALIFIED_NO_EVIDENCE, PICKUP_CHECK ; NULL hors annulation
  origin        text
    CONSTRAINT trip_state_log_origin_valid CHECK (origin IS NULL OR origin IN
      ('EVENT', 'LATE_GUEST_CANCELLATION', 'REQUALIFIED_NO_EVIDENCE', 'PICKUP_CHECK')),
  actor_user_id uuid,
  actor_role    text        NOT NULL
    CONSTRAINT trip_state_log_actor_role_format CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  at            timestamptz NOT NULL DEFAULT platform.now(),
  -- règlement de la transition (SM-1 invariant 4) : posé par US-215 / US-224
  settlement_id uuid
    CONSTRAINT booking_trip_state_log_settlement_fkey REFERENCES core.settlement_settlement (id),
  -- transaction qui a écrit la ligne : la garde trip_transition_guard exige la ligne de la MÊME
  -- transaction que le changement d'état (identifiant de la transaction de premier niveau)
  xact_id       xid8        NOT NULL DEFAULT pg_catalog.pg_current_xact_id(),
  created_at    timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT trip_state_log_states_valid CHECK (
    (from_status IS NULL OR from_status IN
      ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE', 'RETURNED',
       'UNRETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP', 'COMPLETED', 'IN_DISPUTE',
       'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST', 'CANCELLED_BY_PLATFORM', 'REFUSED_AT_PICKUP',
       'NO_SHOW_GUEST', 'NO_SHOW_HOST'))
    AND to_status IN
      ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE', 'RETURNED',
       'UNRETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP', 'COMPLETED', 'IN_DISPUTE',
       'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST', 'CANCELLED_BY_PLATFORM', 'REFUSED_AT_PICKUP',
       'NO_SHOW_GUEST', 'NO_SHOW_HOST')),
  -- la naissance est la seule ligne sans état de départ, et elle mène à BOOKED
  CONSTRAINT trip_state_log_birth_shape CHECK (
    (from_status IS NULL) = (to_status = 'BOOKED' AND kind = 'TRANSITION'
                             AND reason_code = 'HOLD_CONVERTED')),
  CONSTRAINT trip_state_log_actor_shape CHECK (actor_role <> 'SYSTEM' OR actor_user_id IS NULL)
);
CREATE INDEX trip_state_log_trip_idx ON core.booking_trip_state_log (trip_id, at);
COMMENT ON TABLE core.booking_trip_state_log IS
  'Journal d''état du trip (17 §3.1.2, §3.2.4), une ligne par transition SM-1, écrite dans la même '
  'transaction que le changement d''état. Classe A : aucun UPDATE ni DELETE (triggers). Aucun droit '
  'applicatif. US-207, ADR-126.';
ALTER TABLE core.booking_trip_state_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_trip_state_log FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_trip_state_log TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.booking_trip_state_log FROM PUBLIC;

CREATE FUNCTION core.booking_trip_state_log_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'trip_state_log: update refused (append-only record)'
    USING ERRCODE = 'integrity_constraint_violation',
          CONSTRAINT = 'trip_state_log_immutable';
END
$fn$;
CREATE TRIGGER trip_state_log_immutable BEFORE UPDATE ON core.booking_trip_state_log
  FOR EACH ROW EXECUTE FUNCTION core.booking_trip_state_log_immutable();
CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_trip_state_log
  FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete();

-- Trips antérieurs à 0099 (aucun en production : la conversion n'y a jamais tourné) : segment et
-- conducteur principal, pour que l'invariant « un segment, un PRIMARY » vaille pour tous les trips.
-- Aucune ligne de journal inventée ; no_show_at reste NULL (les commandes refusent alors
-- PARAM_MISSING sur les transitions qui en dépendent, fail-closed).
INSERT INTO core.booking_trip_segment (id, trip_id, seq, period)
SELECT pg_catalog.gen_random_uuid(), t.id, 1,
       pg_catalog.tstzrange(t.scheduled_start, t.scheduled_end, '[)')
  FROM core.booking_trip AS t;
INSERT INTO core.booking_trip_driver (trip_id, user_id, role, approved_at)
SELECT t.id, t.guest_user_id, 'PRIMARY', t.booked_at
  FROM core.booking_trip AS t;

-- 6. Fonctions pures de SM-1 (SECURITY INVOKER ; EXECUTE au seul cmd_hold_owner) -----------------
-- États qui tiennent le créneau (I-OCC, 0006 ; PROPOSÉ, packages/db/README.md) : la même liste que
-- core.booking_assert_trip_occupancy.
CREATE FUNCTION core.booking_trip_holds_slot(p_status text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE',
                      'UNRETURNED')
$fn$;

-- État cible d'un motif qualifié (colonne « État SM-1 » de la table de décision BR-CXL, 08) :
-- sous-ensemble bêta du moteur de règlement (packages/money, REASONS) ; motif inconnu ⇒ NULL
-- (refus). Jamais une fonction de l'initiateur (invariant 3).
CREATE FUNCTION core.booking_cancellation_target(p_reason text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE p_reason
           WHEN 'GUEST_CANCELLED'             THEN 'CANCELLED_BY_GUEST'     -- n° 1
           WHEN 'GUEST_NO_SHOW'               THEN 'NO_SHOW_GUEST'          -- n° 2
           WHEN 'HOST_CANCELLED_DUE_TO_GUEST' THEN 'NO_SHOW_GUEST'          -- n° 3
           WHEN 'PLATFORM_INCOMPLETE_STEPS'   THEN 'CANCELLED_BY_PLATFORM'  -- n° 4
           WHEN 'GUEST_FRAUD_PROVEN'          THEN 'CANCELLED_BY_PLATFORM'  -- n° 5
           WHEN 'HOST_CANCELLED'              THEN 'CANCELLED_BY_HOST'      -- n° 6
           WHEN 'HOST_NO_SHOW'                THEN 'NO_SHOW_HOST'           -- n° 7
           WHEN 'PLATFORM_TRUST_SAFETY'       THEN 'CANCELLED_BY_PLATFORM'  -- n° 12
           WHEN 'HOST_ACCOUNT_CLOSED'         THEN 'CANCELLED_BY_PLATFORM'  -- n° 13
           WHEN 'PLATFORM_REVIEW_DELAY'       THEN 'CANCELLED_BY_PLATFORM'  -- n° 17
           WHEN 'PSP_FAILURE'                 THEN 'CANCELLED_BY_PLATFORM'  -- n° 18
         END
$fn$;

REVOKE ALL ON FUNCTION core.booking_trip_holds_slot(text), core.booking_cancellation_target(text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_trip_holds_slot(text), core.booking_cancellation_target(text)
  TO cmd_hold_owner;

-- 7. Garde structurelle des changements d'état (L2-PM-24) ----------------------------------------
-- SECURITY INVOKER : la seule voie d'un rôle de production vers UPDATE (status) est la commande
-- (cmd_hold_owner, qui lit la table des transitions et le journal) ; app_worker n'a plus ce droit.
-- migrator (propriétaire, fixtures de test) est exempté : il peut de toute façon désactiver le
-- trigger (ADR-126 n° 3).
CREATE FUNCTION core.booking_trip_transition_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF current_user = 'migrator' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.booking_trip_transition tt
                  WHERE tt.from_status = OLD.status AND tt.to_status = NEW.status) THEN
    RAISE EXCEPTION 'trip: transition not allowed by SM-1'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'trip_transition_forbidden',
            DETAIL = pg_catalog.format('trip %s: %s -> %s', OLD.id, OLD.status, NEW.status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.booking_trip_state_log l
                  WHERE l.trip_id = OLD.id AND l.from_status = OLD.status
                    AND l.to_status = NEW.status AND l.kind = 'TRANSITION'
                    AND l.xact_id = pg_catalog.pg_current_xact_id()) THEN
    RAISE EXCEPTION 'trip: state change without its trip_state_log row'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'trip_transition_unlogged',
            DETAIL = pg_catalog.format('trip %s: %s -> %s', OLD.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER trip_transition_guard
  BEFORE UPDATE OF status ON core.booking_trip
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION core.booking_trip_transition_guard();

-- 8. Naissance du trip (SM-1 HOLD → BOOKED) : triggers de la table -------------------------------
-- 8.1 Avant l'insertion : état BOOKED exigé de TOUT écrivain, no_show_at figé, colonnes de cycle de
-- vie remises à NULL (l'INSERT « * » d'app_worker ne peut rien y poser).
CREATE FUNCTION core.booking_trip_birth_defaults()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_grace integer;
BEGIN
  IF NEW.status IS DISTINCT FROM 'BOOKED' THEN
    RAISE EXCEPTION 'trip: a trip is born BOOKED (SM-1 HOLD -> BOOKED)'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'trip_transition_forbidden',
            DETAIL = pg_catalog.format('trip %s: born %s', NEW.id, NEW.status);
  END IF;
  v_grace := core.booking_param_int('no_show_grace_minutes', NEW.country_code);
  IF v_grace IS NULL THEN
    RAISE EXCEPTION 'trip: parameter no_show_grace_minutes missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing',
            DETAIL = pg_catalog.format('country %s', NEW.country_code);
  END IF;
  NEW.no_show_at := NEW.scheduled_start + pg_catalog.make_interval(mins => v_grace);
  NEW.checkin_validated_at := NULL;
  NEW.cancel_initiator := NULL;
  NEW.cancel_requested_at := NULL;
  NEW.cancellation_reason := NULL;
  NEW.termination_reason := NULL;
  RETURN NEW;
END
$fn$;

-- 8.2 Après l'insertion : segment n° 1, conducteur PRIMARY, journal et événement de la naissance.
CREATE FUNCTION core.booking_trip_birth_records()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO core.booking_trip_segment (id, trip_id, seq, period)
  VALUES (pg_catalog.gen_random_uuid(), NEW.id, 1,
          pg_catalog.tstzrange(NEW.scheduled_start, NEW.scheduled_end, '[)'));
  INSERT INTO core.booking_trip_driver (trip_id, user_id, role, approved_at)
  VALUES (NEW.id, NEW.guest_user_id, 'PRIMARY', platform.now());
  INSERT INTO core.booking_trip_state_log
         (id, trip_id, from_status, to_status, kind, reason_code, actor_role)
  VALUES (pg_catalog.gen_random_uuid(), NEW.id, NULL, 'BOOKED', 'TRANSITION', 'HOLD_CONVERTED',
          'SYSTEM');
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_role, correlation_id, payload, partition_key)
  VALUES ('trip.status_changed', 1, 'trip', NEW.id, NEW.row_version, NEW.country_code, 'SYSTEM',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('trip_id', NEW.id, 'from', NULL, 'to', 'BOOKED',
                                        'reason', 'HOLD_CONVERTED', 'settlement_id', NULL),
          NEW.id::text);
  RETURN NULL;
END
$fn$;

-- 8.3 Période du segment = période du trip (raccourcissement par trip_lifecycle, CAL-004)
CREATE FUNCTION core.booking_trip_period_sync()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE core.booking_trip_segment
     SET period = pg_catalog.tstzrange(NEW.scheduled_start, NEW.scheduled_end, '[)')
   WHERE trip_id = NEW.id AND seq = 1;
  RETURN NULL;
END
$fn$;

CREATE TRIGGER trip_birth_defaults BEFORE INSERT ON core.booking_trip
  FOR EACH ROW EXECUTE FUNCTION core.booking_trip_birth_defaults();
CREATE TRIGGER trip_birth_records AFTER INSERT ON core.booking_trip
  FOR EACH ROW EXECUTE FUNCTION core.booking_trip_birth_records();
CREATE TRIGGER trip_period_sync AFTER UPDATE OF scheduled_start, scheduled_end ON core.booking_trip
  FOR EACH ROW
  WHEN (OLD.scheduled_start IS DISTINCT FROM NEW.scheduled_start
        OR OLD.scheduled_end IS DISTINCT FROM NEW.scheduled_end)
  EXECUTE FUNCTION core.booking_trip_period_sync();

-- 9. Droits de cmd_hold_owner (au plus juste) ----------------------------------------------------
GRANT SELECT (row_version, no_show_at, checkin_validated_at) ON core.booking_trip TO cmd_hold_owner;
GRANT UPDATE (status, cancellation_reason, termination_reason, cancel_initiator,
              cancel_requested_at, checkin_validated_at, updated_by)
  ON core.booking_trip TO cmd_hold_owner;
GRANT SELECT ON core.booking_trip_transition TO cmd_hold_owner;
GRANT SELECT (id, trip_id, seq), INSERT (id, trip_id, seq, period), UPDATE (period)
  ON core.booking_trip_segment TO cmd_hold_owner;
GRANT SELECT (trip_id, role, approved_at), INSERT (trip_id, user_id, role, approved_at)
  ON core.booking_trip_driver TO cmd_hold_owner;
GRANT SELECT (trip_id, from_status, to_status, kind, xact_id),
      INSERT (id, trip_id, from_status, to_status, kind, reason_code, origin, actor_user_id,
              actor_role)
  ON core.booking_trip_state_log TO cmd_hold_owner;
GRANT SELECT (trip_id, active), UPDATE (active) ON core.booking_guest_occupancy TO cmd_hold_owner;

-- Politiques : écritures réservées aux fonctions de cmd_hold_owner (aucun code client sous ce rôle) ;
-- les triggers de naissance tournent sous tout écrivain du trip (conversion, fixtures) : pas de
-- condition de contexte sur leurs insertions, la commande porte la sienne.
CREATE POLICY cmd_trip_read ON core.booking_trip_transition FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_trip_seg_sel ON core.booking_trip_segment FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_trip_seg_ins ON core.booking_trip_segment FOR INSERT TO cmd_hold_owner
  WITH CHECK (seq = 1);
CREATE POLICY cmd_trip_seg_upd ON core.booking_trip_segment FOR UPDATE TO cmd_hold_owner
  USING (seq = 1) WITH CHECK (seq = 1);
CREATE POLICY cmd_trip_driver_sel ON core.booking_trip_driver FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_trip_driver_ins ON core.booking_trip_driver FOR INSERT TO cmd_hold_owner
  WITH CHECK (role = 'PRIMARY');
CREATE POLICY cmd_trip_log_sel ON core.booking_trip_state_log FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_trip_log_ins ON core.booking_trip_state_log FOR INSERT TO cmd_hold_owner
  WITH CHECK (kind = 'TRANSITION');
-- changement d'état : travailleur trip_lifecycle seulement (commandes de 10.)
CREATE POLICY cmd_trip_upd ON core.booking_trip FOR UPDATE TO cmd_hold_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle');
-- libération du créneau à l'entrée dans un état qui ne le tient plus (I-OCC)
CREATE POLICY cmd_trip_occ_upd ON core.booking_vehicle_occupancy FOR UPDATE TO cmd_hold_owner
  USING (kind = 'TRIP' AND active
         AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle')
  WITH CHECK (kind = 'TRIP' AND NOT active AND deactivated_reason = 'TRIP_TERMINAL'
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle');
CREATE POLICY cmd_trip_guest_occ_sel ON core.booking_guest_occupancy FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_trip_guest_occ_upd ON core.booking_guest_occupancy FOR UPDATE TO cmd_hold_owner
  USING (active AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle')
  WITH CHECK (NOT active AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle');
-- événements du trip (17 §4.5) : système seulement, aucune personne en acteur
CREATE POLICY cmd_trip_event_ins ON core.outbox_outbox_event FOR INSERT TO cmd_hold_owner
  WITH CHECK (aggregate_type = 'trip'
              AND type IN ('trip.status_changed', 'trip.cancellation.qualified')
              AND actor_role = 'SYSTEM' AND actor_user_id IS NULL);
-- paramètres lus : + no_show_grace_minutes (no_show_at) et overdue_detection_minutes (OVERDUE)
DROP POLICY cmd_hold_read ON core.config_param_value;
CREATE POLICY cmd_hold_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('buffer_minutes', 'hold_ttl_minutes', 'hold_max_total_minutes',
                 'max_active_holds_per_guest', 'hold_creations_per_guest_vehicle_hour',
                 'sweep_grace_s', 'flagged_booking_payment_order', 'review_hold_minutes',
                 'payment_in_flight_margin_s', 'psp_call_timeout_s',
                 'conversion_start_tolerance_minutes', 'payment_attempts_per_hold',
                 'max_trip_days', 'advance_notice_minutes',
                 'no_show_grace_minutes', 'overdue_detection_minutes'));

-- 10. Commandes de transition (SECURITY DEFINER, cmd_hold_owner ; EXECUTE app_worker) -------------
-- 10.1 Verrous et lecture du trip : voyageur puis véhicule (ordre global de 17 §2.5, le même que la
-- conversion), puis ligne du trip FOR UPDATE ; row_version attendue (verrou optimiste, 16 TRP-045).
-- Interne : SECURITY INVOKER, appelée par les commandes sous cmd_hold_owner seulement.
CREATE FUNCTION core.booking_trip_lock(p_trip_id uuid, p_expected_row_version integer)
  RETURNS TABLE (id uuid, status text, country_code text, scheduled_end timestamptz,
                 row_version integer, no_show_at timestamptz, checkin_validated_at timestamptz)
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_guest   uuid;
  v_vehicle uuid;
  t         record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'trip_lifecycle' THEN
    RAISE EXCEPTION 'trip: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'trip_command_forbidden';
  END IF;
  -- guest_user_id et vehicle_id ne changent jamais : les verrous pris sont bien ceux du trip
  SELECT tr.guest_user_id, tr.vehicle_id INTO v_guest, v_vehicle
    FROM core.booking_trip tr WHERE tr.id = p_trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip: unknown trip'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_transition_forbidden';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  SELECT tr.id, tr.status, tr.country_code, tr.scheduled_end, tr.row_version, tr.no_show_at,
         tr.checkin_validated_at
    INTO t
    FROM core.booking_trip tr WHERE tr.id = p_trip_id FOR UPDATE;
  IF p_expected_row_version IS NOT NULL AND t.row_version <> p_expected_row_version THEN
    RAISE EXCEPTION 'trip: concurrent update'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_concurrent_update',
            DETAIL = pg_catalog.format('trip %s: row_version %s, expected %s', t.id,
                                       t.row_version, p_expected_row_version);
  END IF;
  RETURN QUERY SELECT t.id, t.status, t.country_code, t.scheduled_end, t.row_version,
                      t.no_show_at, t.checkin_validated_at;
END
$fn$;

-- 10.2 Application d'une transition déjà autorisée : journal (AVANT le changement d'état, exigé par
-- trip_transition_guard), état, créneau libéré si l'état cible ne le tient plus, événements.
-- Interne : SECURITY INVOKER, appelée par les commandes sous cmd_hold_owner seulement.
CREATE FUNCTION core.booking_trip_apply_transition(
  p_trip_id    uuid,
  p_from       text,
  p_to         text,
  p_reason     text,
  p_origin     text,
  p_actor_role text,
  p_via        text,
  p_extra      jsonb
)
  RETURNS integer
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_version integer;
  v_country text;
  v_segment uuid;
BEGIN
  -- 17 §4.5 : trip.cancellation.qualified porte le segment (le règlement est clé sur
  -- (trip, segment, version), 08 invariant 4). Bêta : le segment n° 1, écrit à la naissance (ou par
  -- le rattrapage de 0099) et jamais supprimé (no_delete) ; absent ⇒ refus (fail-closed).
  IF p_via = 'CANCEL' THEN
    SELECT s.id INTO v_segment FROM core.booking_trip_segment s
     WHERE s.trip_id = p_trip_id AND s.seq = 1;
    IF v_segment IS NULL THEN
      RAISE EXCEPTION 'trip: segment 1 missing'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_segment_missing';
    END IF;
  END IF;

  INSERT INTO core.booking_trip_state_log
         (id, trip_id, from_status, to_status, kind, reason_code, origin, actor_role)
  VALUES (pg_catalog.gen_random_uuid(), p_trip_id, p_from, p_to, 'TRANSITION', p_reason, p_origin,
          p_actor_role);

  IF p_via = 'CANCEL' THEN
    UPDATE core.booking_trip
       SET status = p_to, cancellation_reason = p_reason,
           cancel_initiator = p_extra ->> 'initiator',
           cancel_requested_at = (p_extra ->> 'requestedAt')::timestamptz
     WHERE id = p_trip_id
    RETURNING row_version, country_code INTO v_version, v_country;
  ELSIF p_to = 'TERMINATED_EARLY' THEN
    UPDATE core.booking_trip SET status = p_to, termination_reason = p_reason
     WHERE id = p_trip_id
    RETURNING row_version, country_code INTO v_version, v_country;
  ELSIF p_to = 'IN_PROGRESS' AND p_from IN ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    UPDATE core.booking_trip SET status = p_to, checkin_validated_at = platform.now()
     WHERE id = p_trip_id
    RETURNING row_version, country_code INTO v_version, v_country;
  ELSE
    UPDATE core.booking_trip SET status = p_to
     WHERE id = p_trip_id
    RETURNING row_version, country_code INTO v_version, v_country;
  END IF;

  -- I-OCC : un état qui ne tient plus le créneau libère l'occupation du véhicule et celle du
  -- voyageur, dans la même transaction (vérifiée au COMMIT par les triggers différés de 0006)
  IF core.booking_trip_holds_slot(p_from) AND NOT core.booking_trip_holds_slot(p_to) THEN
    UPDATE core.booking_vehicle_occupancy
       SET active = false, deactivated_reason = 'TRIP_TERMINAL'
     WHERE kind = 'TRIP' AND ref_type = 'TRIP' AND ref_id = p_trip_id AND active;
    UPDATE core.booking_guest_occupancy SET active = false WHERE trip_id = p_trip_id AND active;
  END IF;

  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_role, correlation_id, payload, partition_key)
  SELECT e.type, 1, 'trip', p_trip_id, v_version, v_country, 'SYSTEM',
         pg_catalog.gen_random_uuid(), e.payload, p_trip_id::text
    FROM (VALUES
            ('trip.cancellation.qualified',
             pg_catalog.jsonb_build_object('trip_id', p_trip_id, 'segment_id', v_segment,
                                           'requested_reason', p_extra ->> 'requestedReason',
                                           'reason', p_reason, 'origin', p_origin,
                                           'initiator', p_extra ->> 'initiator',
                                           'requested_at', p_extra ->> 'requestedAt',
                                           'to', p_to)),
            ('trip.status_changed',
             pg_catalog.jsonb_build_object('trip_id', p_trip_id, 'from', p_from, 'to', p_to,
                                           'reason', p_reason, 'settlement_id', NULL)))
         AS e(type, payload)
   WHERE e.type = 'trip.status_changed' OR p_via = 'CANCEL';
  RETURN v_version;
END
$fn$;

-- 10.3 Transition de cycle de vie (SM-1, via = TRANSITION). Gardes :
--   START_WINDOW_EXPIRED : platform.now() ≥ no_show_at ;
--   OVERDUE              : platform.now() ≥ scheduled_end + overdue_detection_minutes du pays ;
--   IN_PROGRESS depuis CHECKIN_OPEN ou START_WINDOW_EXPIRED : motif CHECKIN_VALIDATED et
--                          conducteur PRIMARY approuvé (invariant 1) ; check-in horodaté ici ;
--   TERMINATED_EARLY     : motif de fin obligatoire, motifs 22 à 26 (invariant 4).
-- Les minuteries (TRP) et les preuves du check-in (photos, identité) appellent cette commande ;
-- elles arrivent avec leurs stories.
CREATE FUNCTION core.booking_cmd_trip_transition(
  p_trip_id              uuid,
  p_to_status            text,
  p_reason_code          text,
  p_expected_row_version integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t         record;
  v_via     text;
  v_minutes integer;
  v_version integer;
BEGIN
  SELECT * INTO t FROM core.booking_trip_lock(p_trip_id, p_expected_row_version);
  SELECT tt.via INTO v_via FROM core.booking_trip_transition tt
   WHERE tt.from_status = t.status AND tt.to_status = p_to_status;
  IF v_via IS DISTINCT FROM 'TRANSITION' OR p_reason_code IS NULL
     OR p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' OR p_reason_code = 'HOLD_CONVERTED' THEN
    RAISE EXCEPTION 'trip: transition not allowed by SM-1'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_transition_forbidden',
            DETAIL = pg_catalog.format('trip %s: %s -> %s', t.id, t.status, p_to_status);
  END IF;

  IF p_to_status = 'START_WINDOW_EXPIRED' THEN
    IF t.no_show_at IS NULL THEN
      RAISE EXCEPTION 'trip: no_show_at unknown'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
    END IF;
    IF platform.now() < t.no_show_at THEN
      RAISE EXCEPTION 'trip: start window not expired yet'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_transition_too_early';
    END IF;
  ELSIF p_to_status = 'OVERDUE' THEN
    v_minutes := core.booking_param_int('overdue_detection_minutes', t.country_code);
    IF v_minutes IS NULL THEN
      RAISE EXCEPTION 'trip: parameter overdue_detection_minutes missing'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
    END IF;
    IF platform.now() < t.scheduled_end + pg_catalog.make_interval(mins => v_minutes) THEN
      RAISE EXCEPTION 'trip: not overdue yet'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_transition_too_early';
    END IF;
  ELSIF p_to_status = 'IN_PROGRESS' AND t.status IN ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    IF p_reason_code <> 'CHECKIN_VALIDATED' OR NOT EXISTS (
         SELECT 1 FROM core.booking_trip_driver d
          WHERE d.trip_id = t.id AND d.role = 'PRIMARY' AND d.approved_at IS NOT NULL) THEN
      RAISE EXCEPTION 'trip: IN_PROGRESS requires a validated check-in and an approved driver'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_transition_forbidden';
    END IF;
  ELSIF p_to_status = 'TERMINATED_EARLY' THEN
    IF p_reason_code NOT IN ('TERM_BREAKDOWN_NOT_GUEST', 'TERM_PLATFORM_NOT_GUEST',
                             'TERM_GUEST_FAULT', 'TERM_PAYMENT_FAILURE',
                             'TERM_ACCIDENT_PENDING') THEN
      RAISE EXCEPTION 'trip: TERMINATED_EARLY requires a termination reason (22 to 26)'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_transition_forbidden';
    END IF;
  END IF;

  v_version := core.booking_trip_apply_transition(t.id, t.status, p_to_status, p_reason_code,
                                                  NULL, 'SYSTEM', 'TRANSITION', '{}'::jsonb);
  RETURN pg_catalog.jsonb_build_object('tripId', t.id, 'from', t.status, 'status', p_to_status,
                                       'reason', p_reason_code, 'rowVersion', v_version);
END
$fn$;

-- 10.4 Annulation ou no-show (via = CANCEL). Qualification (08 BR-CXL, `qualify`), à l'heure
-- SERVEUR de la demande (platform.now()) :
--   règle 1 : GUEST_CANCELLED reçu à ≥ no_show_at sans check-in validé ⇒ GUEST_NO_SHOW,
--             origine LATE_GUEST_CANCELLATION (T25) ;
--   règle 2 : HOST_CANCELLED_DUE_TO_GUEST sans sous-motif de la liste ou sans preuve validée ⇒
--             HOST_CANCELLED, origine REQUALIFIED_NO_EVIDENCE ;
--   règle 3 : GUEST_NO_SHOW avant no_show_at ⇒ refus REJECTED_TOO_EARLY, sauf sous-motif constaté
--             au retrait (origine PICKUP_CHECK) ;
-- puis état cible = core.booking_cancellation_target(motif qualifié) (invariant 3) et paire de la
-- table (invariant 2 : rien depuis IN_PROGRESS). Le premier événement validé sous verrou gagne ; le
-- second trouve un état terminal ⇒ TRIP_TRANSITION_FORBIDDEN (EC-54 ; SETTLEMENT_EXISTS du règlement :
-- US-215).
CREATE FUNCTION core.booking_cmd_trip_cancel(
  p_trip_id              uuid,
  p_reason               text,
  p_initiator            text,
  p_sub_reason           text,
  p_evidence_validated   boolean,
  p_expected_row_version integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t         record;
  v_now     timestamptz := platform.now();
  v_reason  text := p_reason;
  v_origin  text := 'EVENT';
  v_target  text;
  v_version integer;
BEGIN
  SELECT * INTO t FROM core.booking_trip_lock(p_trip_id, p_expected_row_version);
  IF core.booking_cancellation_target(p_reason) IS NULL
     OR p_initiator IS NULL
     OR p_initiator NOT IN ('GUEST', 'HOST', 'CO_HOST', 'PLATFORM', 'SYSTEM') THEN
    RAISE EXCEPTION 'trip: cancellation reason or initiator outside the decision table'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_transition_forbidden';
  END IF;
  -- Paire d'abord (critère 1, inconditionnel) : l'état courant doit avoir une sortie CANCEL vers
  -- l'un des états cibles que le motif demandé peut atteindre après qualification (règle 1 :
  -- GUEST_CANCELLED ou GUEST_NO_SHOW ; règle 2 : HOST_CANCELLED_DUE_TO_GUEST ou HOST_CANCELLED ;
  -- sinon le motif lui-même). Un trip IN_PROGRESS reçoit donc TRIP_TRANSITION_FORBIDDEN avant toute
  -- qualification (jamais REJECTED_TOO_EARLY ni PARAM_MISSING) ; la paire exacte est revérifiée
  -- après qualification.
  IF NOT EXISTS (
       SELECT 1 FROM core.booking_trip_transition tt
        WHERE tt.from_status = t.status AND tt.via = 'CANCEL'
          AND tt.to_status IN (
                core.booking_cancellation_target(p_reason),
                CASE p_reason
                  WHEN 'GUEST_CANCELLED' THEN core.booking_cancellation_target('GUEST_NO_SHOW')
                  WHEN 'HOST_CANCELLED_DUE_TO_GUEST'
                    THEN core.booking_cancellation_target('HOST_CANCELLED')
                END)) THEN
    RAISE EXCEPTION 'trip: transition not allowed by SM-1'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_transition_forbidden',
            DETAIL = pg_catalog.format('trip %s: %s -> ? (%s)', t.id, t.status, p_reason);
  END IF;

  IF p_reason = 'GUEST_CANCELLED' THEN                                         -- règle 1
    IF t.no_show_at IS NULL THEN
      RAISE EXCEPTION 'trip: no_show_at unknown'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
    END IF;
    IF v_now >= t.no_show_at AND t.checkin_validated_at IS NULL THEN
      v_reason := 'GUEST_NO_SHOW';
      v_origin := 'LATE_GUEST_CANCELLATION';
    END IF;
  ELSIF p_reason = 'HOST_CANCELLED_DUE_TO_GUEST' THEN                          -- règle 2
    IF p_sub_reason IS NULL
       OR p_sub_reason NOT IN ('INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT',
                               'LICENSE_NOT_UPLOADED_1H')
       OR p_evidence_validated IS DISTINCT FROM true THEN
      v_reason := 'HOST_CANCELLED';
      v_origin := 'REQUALIFIED_NO_EVIDENCE';
    END IF;
  ELSIF p_reason = 'GUEST_NO_SHOW' THEN                                        -- règle 3
    IF t.no_show_at IS NULL THEN
      RAISE EXCEPTION 'trip: no_show_at unknown'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
    END IF;
    IF v_now < t.no_show_at THEN
      IF p_sub_reason IS NULL
         OR p_sub_reason NOT IN ('INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT') THEN
        RAISE EXCEPTION 'trip: no-show declared before noShowAt'
          USING ERRCODE = 'object_not_in_prerequisite_state',
                CONSTRAINT = 'trip_no_show_too_early';
      END IF;
      v_origin := 'PICKUP_CHECK';
    END IF;
  END IF;

  v_target := core.booking_cancellation_target(v_reason);
  IF NOT EXISTS (SELECT 1 FROM core.booking_trip_transition tt
                  WHERE tt.from_status = t.status AND tt.to_status = v_target
                    AND tt.via = 'CANCEL') THEN
    RAISE EXCEPTION 'trip: transition not allowed by SM-1'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_transition_forbidden',
            DETAIL = pg_catalog.format('trip %s: %s -> %s (%s)', t.id, t.status, v_target, v_reason);
  END IF;

  v_version := core.booking_trip_apply_transition(
    t.id, t.status, v_target, v_reason, v_origin, p_initiator, 'CANCEL',
    pg_catalog.jsonb_build_object('initiator', p_initiator, 'requestedReason', p_reason,
                                  'requestedAt', v_now));
  RETURN pg_catalog.jsonb_build_object('tripId', t.id, 'from', t.status, 'status', v_target,
                                       'reason', v_reason, 'origin', v_origin,
                                       'requestedReason', p_reason, 'rowVersion', v_version);
END
$fn$;

COMMENT ON FUNCTION core.booking_cmd_trip_transition(uuid, text, text, integer) IS
  'Commande : transition de cycle de vie de SM-1 (table core.booking_trip_transition, via '
  'TRANSITION), travailleur trip_lifecycle ; journal et trip.status_changed. US-207.';
COMMENT ON FUNCTION core.booking_cmd_trip_cancel(uuid, text, text, text, boolean, integer) IS
  'Commande : annulation ou no-show, motif qualifié (règles 1 à 3 de BR-CXL), état cible = fonction '
  'du motif ; journal, trip.cancellation.qualified et trip.status_changed. US-207.';

-- 11. Droits d'exécution et propriétaires --------------------------------------------------------
REVOKE ALL ON FUNCTION core.booking_trip_transition_guard(), core.booking_trip_birth_defaults(),
  core.booking_trip_birth_records(), core.booking_trip_period_sync(),
  core.booking_trip_state_log_immutable(),
  core.booking_trip_lock(uuid, integer),
  core.booking_trip_apply_transition(uuid, text, text, text, text, text, text, jsonb),
  core.booking_cmd_trip_transition(uuid, text, text, integer),
  core.booking_cmd_trip_cancel(uuid, text, text, text, boolean, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_cmd_trip_transition(uuid, text, text, integer),
  core.booking_cmd_trip_cancel(uuid, text, text, text, boolean, integer) TO app_worker;

-- Transfert au propriétaire dédié (ADR-053, amendement d'ADR-044) : CREATE le temps du transfert.
-- Les fonctions internes (lock, apply) appartiennent aussi à cmd_hold_owner : seules ses commandes
-- les exécutent (aucun EXECUTE accordé).
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
ALTER FUNCTION core.booking_trip_birth_defaults() OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_trip_birth_records() OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_trip_period_sync() OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_trip_lock(uuid, integer) OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_trip_apply_transition(uuid, text, text, text, text, text, text, jsonb)
  OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_cmd_trip_transition(uuid, text, text, integer) OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_cmd_trip_cancel(uuid, text, text, text, boolean, integer)
  OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
-- (EXECUTE d'app_worker accordé avant le transfert : migrator n'est plus propriétaire ensuite.)

-- 12. L'état d'un trip ne s'écrit plus que par commande (CLAUDE.md point 5) ----------------------
-- Dérogation expand / contract (retrait d'un droit d'un rôle applicatif) : aucune version servie
-- n'écrit l'état d'un trip ; app_worker garde UPDATE (scheduled_start, scheduled_end) pour le
-- raccourcissement (CAL-004), recopié dans le segment par trip_period_sync.
REVOKE UPDATE (status, cancellation_reason, termination_reason) ON core.booking_trip FROM app_worker;
