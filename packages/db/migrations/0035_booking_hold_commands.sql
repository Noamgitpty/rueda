-- 0035 — AVL : holds de checkout, commandes de pose et de libération, tâche d'expiration.
-- US-023 ; 16 BKG-014 ; 08 BR-BOOK-08, BR-BOOK-10, BR-BOOK-11 ; 17 §2.3 (droits d'écriture,
-- rôles d'exécution des commandes, fonction de garde, RLS-3, RLS-4, RLS-11, RLS-13, RLS-14,
-- RLS-15), §2.5 (type de hold, revue avant le débit, étape 2, étape 6, étape 7), §3.2.4 ;
-- ADR-035, ADR-048, ADR-053, ADR-056, ADR-060 ; ADR-063. Appliquée sous `migrator`.
--
-- Cette migration :
--   1. garde les colonnes du hold pour TOUS les rôles (trigger hold_guarded_columns) et refuse
--      toute suppression des preuves (trigger no_delete sur le hold, la disposition et la
--      compensation) ; une revue ouverte interdit tout paiement (CHECK hold_review_before_payment) ;
--   2. lit les paramètres du pays (core.booking_param_int, core.booking_param_text) et le compte
--      d'hôte d'un véhicule (core.booking_vehicle_party : fail-closed, AUCUN véhicule connu tant
--      que le catalogue n'existe pas, US-115) ;
--   3. crée la fonction de garde entre hôtes platform.guest_hold_guard (propriétaire guard_owner,
--      17 §2.3) : holds vivants du voyageur de la session et chevauchement avec ses trips ;
--   4. crée les commandes SECURITY DEFINER sous cmd_hold_owner (liste blanche RLS-15), EXECUTE au
--      seul app_api, sans identifiant de personne en paramètre :
--        - core.booking_cmd_place_hold(véhicule, début, fin, signalée) : étape 2 de 17 §2.5 ;
--        - core.booking_cmd_release_own_hold(hold) : étape 6, temps 1 (libération immédiate ou
--          différée) ;
--   5. crée la tâche d'expiration core.booking_expire_due_holds(lot) (étape 7), SECURITY INVOKER,
--      exécutée par app_worker sous le travailleur hold_expiry ;
--   6. index checkout_hold_guest_status_idx : conservé (report US-007) ; ses lecteurs sont la
--      limite de rotation et la fonction de garde, voir ADR-063.
--
-- Erreurs : (SQLSTATE, contrainte) traduits par packages/db/src/errors.ts, sans DETAIL :
--   hold_forbidden (42501)               → FORBIDDEN (pas de voyageur en session ; hold d'un tiers
--                                          ou inconnu : même réponse, rien n'est révélé) ;
--   occupancy_period_invalid (23514)     → INVALID_PERIOD ;
--   hold_vehicle_unknown (55000)         → VEHICLE_UNAVAILABLE (véhicule inconnu : même réponse
--                                          qu'un créneau pris) ;
--   hold_host_not_active (55000)         → HOST_NOT_ACTIVATED ;
--   hold_self_booking (55000)            → SELF_BOOKING_FORBIDDEN ;
--   hold_param_missing (55000)           → PARAM_MISSING ;
--   hold_guest_limit (55000)             → HOLD_LIMIT_REACHED (RLS-3) ;
--   hold_guest_overlap (55000)           → GUEST_OVERLAP (RLS-4, BR-BOOK-08) ;
--   hold_rate_limited (55000)            → HOLD_RATE_LIMITED (429, 17 §2.5 M5) ;
--   hold_release_terminal (55000)        → INVALID_TRANSITION ;
--   vehicle_occupancy_no_overlap (23P01) → VEHICLE_UNAVAILABLE ;
--   one_live_hold_per_guest_vehicle (23505) → HOLD_ALREADY_LIVE ;
--   hold_guarded_columns, booking_record_no_delete (23000) → IMMUTABLE_RECORD ;
--   hold_review_before_payment (23514)   → BOOKING_UNDER_REVIEW.
-- Forme d'appel (ADR-056 point 4, ADR-063) : un appel = une instruction en autocommit (contexte
-- app.* posé dans la même instruction, `commandCallSql` de packages/db/src/session-context.ts),
-- ou transaction courte BEGIN, SET LOCAL, un seul appel, COMMIT / ROLLBACK immédiat.
--
-- Tables vides en production à ce stade : les contraintes ajoutées sont validées immédiatement.
--
-- Retour arrière :
--   DROP FUNCTION core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean),
--     core.booking_cmd_release_own_hold(uuid), core.booking_expire_due_holds(integer),
--     platform.guest_hold_guard(tstzrange), core.booking_vehicle_party(uuid),
--     core.booking_param_int(text, text), core.booking_param_text(text, text);
--   DROP TRIGGER hold_guarded_columns ON core.booking_checkout_hold;
--   DROP TRIGGER no_delete ON core.booking_checkout_hold, core.booking_payment_disposition,
--     core.booking_hold_compensation;
--   DROP FUNCTION core.booking_hold_guarded_columns(), core.booking_no_delete();
--   ALTER TABLE core.booking_checkout_hold DROP CONSTRAINT hold_review_before_payment;
--   DROP POLICY cmd_hold_sel, cmd_hold_ins, cmd_hold_upd, guard_read ON core.booking_checkout_hold;
--   DROP POLICY cmd_occ_ins, cmd_occ_upd ON core.booking_vehicle_occupancy;
--   DROP POLICY guard_read ON core.booking_guest_occupancy;
--   DROP POLICY cmd_hold_read ON core.payment_payment_operation, core.booking_payment_disposition;
--   DROP POLICY cmd_hold_event_ins ON core.outbox_outbox_event;
--   recréer cmd_hold_read de core.config_param_value sur la seule clé buffer_minutes (0032) ;
--   REVOKE les droits accordés ci-dessous à cmd_hold_owner et guard_owner.

-- 1. Gardes du hold (17 §2.3 « Droits d'écriture sur les tables de réservation », RLS-13) --------
-- Pour TOUS les rôles (commandes, travailleurs, migrator) : identité, véhicule, compte, pays,
-- occupation, devis, type, date de création et drapeau de revue ne changent jamais ; l'échéance
-- ne change qu'une fois, à l'approbation d'une revue (reviewed_at posé dans la même instruction,
-- travailleur de revue) ; la borne de paiement ne peut qu'être affinée vers le bas, ou remise à
-- NULL par le retour en ACTIVE après un refus reçu (17 §2.5 étape 3e) ; une libération demandée
-- ne se retire pas. Aucune lecture : SECURITY INVOKER.
CREATE FUNCTION core.booking_hold_guarded_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
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
         AND NOT (OLD.status = 'PAYMENT_IN_FLIGHT' AND NEW.status = 'ACTIVE'))
     OR (NEW.expires_at IS DISTINCT FROM OLD.expires_at
         AND NOT (OLD.review_required AND OLD.reviewed_at IS NULL AND NEW.reviewed_at IS NOT NULL))
  THEN
    RAISE EXCEPTION 'checkout_hold: guarded column changed'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'hold_guarded_columns',
            DETAIL = pg_catalog.format('hold %s', OLD.id);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER hold_guarded_columns
  BEFORE UPDATE ON core.booking_checkout_hold
  FOR EACH ROW EXECUTE FUNCTION core.booking_hold_guarded_columns();

-- Preuves (17 §2.3) : aucune suppression du hold, de la disposition ni de la compensation, même
-- par migrator (aucun rôle applicatif n'a DELETE ; le trigger couvre les rôles propriétaires).
CREATE FUNCTION core.booking_no_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION '%: delete refused (proof record)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation',
          CONSTRAINT = 'booking_record_no_delete';
END
$fn$;

CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_checkout_hold
  FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_payment_disposition
  FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON core.booking_hold_compensation
  FOR EACH ROW EXECUTE FUNCTION core.booking_no_delete();

-- Revue avant le débit (UXQ-08, défaut fail-closed REVIEW_BEFORE_CHARGE, 17 §2.5) : un hold de
-- revue n'entre en paiement (ni conversion, ni compensation, qui supposent un paiement) qu'après
-- reviewed_at. Garde structurelle de « aucune intention de paiement avant reviewed_at », quelle
-- que soit la commande de paiement (cmd_start_payment, US-024).
ALTER TABLE core.booking_checkout_hold
  ADD CONSTRAINT hold_review_before_payment CHECK (
    NOT review_required OR reviewed_at IS NOT NULL
    OR status IN ('ACTIVE', 'EXPIRED', 'RELEASED'));

REVOKE ALL ON FUNCTION core.booking_hold_guarded_columns(), core.booking_no_delete() FROM PUBLIC;

COMMENT ON FUNCTION core.booking_hold_guarded_columns() IS
  'Trigger hold_guarded_columns (17 §2.3, RLS-13) : colonnes du hold gardées pour tous les rôles. US-023.';
COMMENT ON FUNCTION core.booking_no_delete() IS
  'Trigger no_delete (17 §2.3) : hold, disposition et compensation ne se suppriment pas. US-023.';

-- Index (report d'US-007, ADR-056 point 6) : checkout_hold_guest_status_idx n'est pas pris par 2a
-- (le planificateur préfère one_live_hold_per_guest_vehicle), mais il sert la limite de rotation
-- (holds d'un voyageur sur un véhicule dans l'heure, tous statuts : l'index partiel ne couvre que
-- les holds vivants). Il est conservé.
COMMENT ON INDEX core.checkout_hold_guest_status_idx IS
  'Lecteurs : limite de rotation de core.booking_cmd_place_hold (tous statuts) et, au choix du '
  'planificateur, branche guest de 2a et fonction de garde. US-007, US-023 (ADR-063).';

-- 2. Paramètres du pays et compte d'hôte du véhicule ------------------------------------------
-- Valeur en vigueur à platform.now(), portée COUNTRY (17 §7.1) ; absente ou mal formée ⇒ NULL et
-- l'appelant refuse (fail_mode BLOCK). SECURITY INVOKER : sous cmd_hold_owner, la politique
-- cmd_hold_read ne lui montre que les clés de ses commandes.
CREATE FUNCTION core.booking_param_int(p_key text, p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
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
   LIMIT 1
$fn$;

CREATE FUNCTION core.booking_param_text(p_key text, p_country text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'string' THEN v.value #>> '{}' END
    FROM core.config_param_value v CROSS JOIN t
   WHERE v.key = p_key
     AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts
     AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

-- Compte d'hôte et pays d'un véhicule publié (17 §2.3 : org_id = catalog.vehicle_org(vehicle_id),
-- jamais choisi par le client). Le catalogue n'existe pas encore : la fonction ne connaît AUCUN
-- véhicule (fail-closed, CLAUDE.md point 7) et toute pose est refusée en production. US-115
-- remplace ce corps par la lecture de catalog_vehicle / listing (véhicule publié seulement). La
-- base de test la remplace par un registre de test (test-migrations/9700).
CREATE FUNCTION core.booking_vehicle_party(p_vehicle_id uuid)
  RETURNS TABLE (org_id uuid, country_code text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT NULL::uuid, NULL::text WHERE false
$fn$;

COMMENT ON FUNCTION core.booking_param_int(text, text) IS
  'Paramètre entier du pays en vigueur à platform.now() ; NULL si absent ou mal formé. US-023.';
COMMENT ON FUNCTION core.booking_param_text(text, text) IS
  'Paramètre texte (ENUM) du pays en vigueur à platform.now() ; NULL si absent. US-023.';
COMMENT ON FUNCTION core.booking_vehicle_party(uuid) IS
  'Compte d''hôte et pays d''un véhicule publié. PROPOSÉ fail-closed : aucun véhicule avant le '
  'catalogue (US-115, qui remplace ce corps). US-023, ADR-063.';

REVOKE ALL ON FUNCTION core.booking_param_int(text, text), core.booking_param_text(text, text),
  core.booking_vehicle_party(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_param_int(text, text), core.booking_param_text(text, text)
  TO cmd_hold_owner, app_worker;
GRANT EXECUTE ON FUNCTION core.booking_vehicle_party(uuid) TO cmd_hold_owner;

-- Clés lues par les commandes de hold (0032 : buffer_minutes seule)
DROP POLICY cmd_hold_read ON core.config_param_value;
CREATE POLICY cmd_hold_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('buffer_minutes', 'hold_ttl_minutes', 'hold_max_total_minutes',
                 'max_active_holds_per_guest', 'hold_creations_per_guest_vehicle_hour',
                 'sweep_grace_s', 'flagged_booking_payment_order', 'review_hold_minutes'));

-- 3. Fonction de garde entre hôtes (17 §2.3 « Invariants par voyageur entre hôtes ») -----------
-- Aucun identifiant de personne en paramètre : elle compte les lignes du voyageur de la session ;
-- elle ne renvoie qu'un entier et un booléen ; aucune ligne pour un autre type d'acteur (RLS-11).
-- Appelée par la pose SOUS le verrou consultatif du voyageur : deux onglets ou deux hôtes ne
-- peuvent pas dépasser la limite (RLS-3).
GRANT USAGE ON SCHEMA core TO guard_owner;
GRANT EXECUTE ON FUNCTION app.actor_id() TO guard_owner;
GRANT SELECT (guest_user_id, status) ON core.booking_checkout_hold TO guard_owner;
GRANT SELECT (guest_user_id, period, active) ON core.booking_guest_occupancy TO guard_owner;
CREATE POLICY guard_read ON core.booking_checkout_hold FOR SELECT TO guard_owner USING (true);
CREATE POLICY guard_read ON core.booking_guest_occupancy FOR SELECT TO guard_owner USING (true);

CREATE FUNCTION platform.guest_hold_guard(p_period tstzrange)
  RETURNS TABLE (live_holds integer, trip_overlap boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT (SELECT pg_catalog.count(*) FROM core.booking_checkout_hold h
           WHERE h.guest_user_id = app.actor_id()
             AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT'))::integer,
         EXISTS (SELECT 1 FROM core.booking_guest_occupancy g
                  WHERE g.guest_user_id = app.actor_id() AND g.active AND g.period && p_period)
   WHERE app.actor_kind() = 'GUEST' AND app.actor_id() IS NOT NULL
$fn$;

COMMENT ON FUNCTION platform.guest_hold_guard(tstzrange) IS
  'Garde entre hôtes (17 §2.3) : holds vivants du voyageur de la session, chevauchement avec ses '
  'trips. Aucune ligne hors session GUEST (RLS-11). US-023.';

REVOKE ALL ON FUNCTION platform.guest_hold_guard(tstzrange) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.guest_hold_guard(tstzrange) TO app_api, cmd_hold_owner;
GRANT CREATE ON SCHEMA platform TO guard_owner;
ALTER FUNCTION platform.guest_hold_guard(tstzrange) OWNER TO guard_owner;
REVOKE CREATE ON SCHEMA platform FROM guard_owner;

-- 4. Droits de cmd_hold_owner pour les holds (au plus juste, colonne par colonne) ----------------
GRANT SELECT (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
              expires_at, payment_in_flight_until, last_polled_at, release_requested_at,
              review_required, reviewed_at, created_at)
  ON core.booking_checkout_hold TO cmd_hold_owner;
GRANT INSERT (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
              expires_at, review_required, created_at, created_by)
  ON core.booking_checkout_hold TO cmd_hold_owner;
GRANT UPDATE (status, expired_at, release_requested_at, released_at, released_by, release_reason,
              updated_by)
  ON core.booking_checkout_hold TO cmd_hold_owner;
-- filtres A3 / A6 de 2a et de la libération (17 §2.3)
GRANT SELECT (id, hold_id, purpose, status) ON core.payment_payment_operation TO cmd_hold_owner;
GRANT SELECT (operation_id) ON core.booking_payment_disposition TO cmd_hold_owner;
-- compte d'hôte du véhicule : titulaire (auto-réservation) et statut (hôte activable)
GRANT SELECT (holder_user_id, status) ON core.iam_organization TO cmd_hold_owner;
-- événements booking.hold.* (17 §2.5 : avant la preuve de paiement, seulement des événements de
-- hold) ; identifiant et heures posés par la base
GRANT EXECUTE ON FUNCTION platform.uuid_v7() TO cmd_hold_owner;
GRANT INSERT (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  ON core.outbox_outbox_event TO cmd_hold_owner;

-- Politiques par commande SQL (aucune politique DELETE, aucun droit DELETE), réservées au
-- voyageur de la session (17 §2.3).
-- Lecture de tous les holds : 2a expire les holds échus de tiers sur le véhicule (RLS-14) ; rien
-- n'en est renvoyé au client.
CREATE POLICY cmd_hold_sel ON core.booking_checkout_hold FOR SELECT TO cmd_hold_owner USING (true);
CREATE POLICY cmd_hold_ins ON core.booking_checkout_hold FOR INSERT TO cmd_hold_owner
  WITH CHECK (app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id()
              AND kind = 'CHECKOUT' AND status = 'ACTIVE'
              AND (org_id, country_code) = (SELECT p.org_id, p.country_code
                                              FROM core.booking_vehicle_party(vehicle_id) AS p));
-- sortie d'un hold vivant vers EXPIRED (2a) ou RELEASED (libération) ; jamais CONVERTED ni
-- COMPENSATED (travailleurs de conversion seulement)
CREATE POLICY cmd_hold_upd ON core.booking_checkout_hold FOR UPDATE TO cmd_hold_owner
  USING (app.actor_kind() = 'GUEST' AND status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT'))
  WITH CHECK (app.actor_kind() = 'GUEST'
              AND status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT', 'EXPIRED', 'RELEASED'));
-- occupation HOLD du voyageur (avec TTL et référence au hold), puis sa seule désactivation
CREATE POLICY cmd_occ_ins ON core.booking_vehicle_occupancy FOR INSERT TO cmd_hold_owner
  WITH CHECK (kind = 'HOLD' AND source = 'CHECKOUT' AND active AND expires_at IS NOT NULL
              AND ref_type = 'HOLD' AND ref_id IS NOT NULL AND app.actor_kind() = 'GUEST');
CREATE POLICY cmd_occ_upd ON core.booking_vehicle_occupancy FOR UPDATE TO cmd_hold_owner
  USING (kind = 'HOLD' AND active AND app.actor_kind() = 'GUEST')
  WITH CHECK (kind = 'HOLD' AND NOT active AND app.actor_kind() = 'GUEST'
              AND deactivated_reason IN ('HOLD_EXPIRED', 'HOLD_RELEASED'));
CREATE POLICY cmd_hold_read ON core.payment_payment_operation FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_read ON core.booking_payment_disposition FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_event_ins ON core.outbox_outbox_event FOR INSERT TO cmd_hold_owner
  WITH CHECK (aggregate_type = 'checkout_hold'
              AND type IN ('booking.hold.created', 'booking.hold.released',
                           'booking.hold.release_deferred')
              AND app.actor_kind() = 'GUEST' AND actor_role = 'GUEST'
              AND actor_user_id = app.actor_id());

-- 5. Pose d'un hold (17 §2.5 étape 2 ; 16 BKG-014) ---------------------------------------------
-- p_flagged : signal des règles de risque de la réservation (ADM-029, VER-007), évalué par l'API
-- au checkout ; NULL vaut « signalée » (fail-closed). Conséquence décidée ici selon
-- flagged_booking_payment_order (UXQ-08, défaut REVIEW_BEFORE_CHARGE ; valeur absente ou inconnue
-- ⇒ revue avant le débit) : hold `review_required`, TTL review_hold_minutes.
-- Sans revue : TTL = min(hold_ttl_minutes, hold_max_total_minutes) (BR-BOOK-10 test 8).
-- Contrôles avant les verrous (lectures seules, aucune donnée d'un tiers) ; puis verrous guest →
-- véhicule (17 §2.5 M2), 2a (texte de 17, test/support/expiry-2a.ts), contrôles entre hôtes
-- sous le verrou du voyageur, insertion. Rien de 2a n'est renvoyé au client (RLS-14).
CREATE FUNCTION core.booking_cmd_place_hold(
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
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF p_vehicle_id IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start
     OR p_start <= platform.now() THEN
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
  -- self_booking_forbidden (16 BKG-012, Bêta : contrôle hôte / voyageur à la pose)
  IF v_holder = v_guest THEN
    RAISE EXCEPTION 'hold: self booking'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_self_booking';
  END IF;

  v_buffer    := core.booking_param_int('buffer_minutes', v_country);
  v_ttl       := core.booking_param_int('hold_ttl_minutes', v_country);
  v_max_total := core.booking_param_int('hold_max_total_minutes', v_country);
  v_max_live  := core.booking_param_int('max_active_holds_per_guest', v_country);
  v_rate      := core.booking_param_int('hold_creations_per_guest_vehicle_hour', v_country);
  v_grace     := core.booking_param_int('sweep_grace_s', v_country);
  v_review    := COALESCE(p_flagged, true)
                 AND COALESCE(core.booking_param_text('flagged_booking_payment_order', v_country),
                              'REVIEW_BEFORE_CHARGE') IS DISTINCT FROM 'PAY_THEN_REVIEW';
  IF v_review THEN
    v_minutes := core.booking_param_int('review_hold_minutes', v_country);
  ELSE
    v_minutes := LEAST(v_ttl, v_max_total);
  END IF;
  IF v_buffer IS NULL OR v_ttl IS NULL OR v_max_total IS NULL OR v_max_live IS NULL
     OR v_rate IS NULL OR v_grace IS NULL OR v_minutes IS NULL OR v_minutes < 1 THEN
    RAISE EXCEPTION 'hold: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
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

-- 6. Libération de son hold par le voyageur (17 §2.5 étape 6, temps 1) -------------------------
-- Hold inconnu ou d'un autre voyageur : FORBIDDEN, sans distinguer (rien n'est révélé). Hold déjà
-- échu ou libéré : NOOP (rejeu idempotent). Hold converti ou compensé : INVALID_TRANSITION.
-- Ordre PSP pouvant encore être payé (filtre A3 / A6 de 2a, ou borne de paiement non échue) :
-- libération DIFFÉRÉE (release_requested_at, booking.hold.release_deferred) ; la tâche
-- d'expiration libère à l'échéance. L'annulation active de l'ordre (CANCEL_ORDER par la boîte
-- d'envoi quand SUPPORTS_ORDER_CANCEL est validé) relève d'US-024 : capacité inconnue = « non ».
-- Sinon libération immédiate : RELEASED, occupation inactive (HOLD_RELEASED).
CREATE FUNCTION core.booking_cmd_release_own_hold(p_hold_id uuid)
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

COMMENT ON FUNCTION core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean) IS
  'Commande : pose d''un hold CHECKOUT (17 §2.5 étape 2), voyageur de la session. US-023.';
COMMENT ON FUNCTION core.booking_cmd_release_own_hold(uuid) IS
  'Commande : libération de son hold, immédiate ou différée (17 §2.5 étape 6, temps 1). US-023.';

REVOKE ALL ON FUNCTION core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean),
  core.booking_cmd_release_own_hold(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean),
  core.booking_cmd_release_own_hold(uuid) TO app_api;

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
ALTER FUNCTION core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean) OWNER TO cmd_hold_owner;
ALTER FUNCTION core.booking_cmd_release_own_hold(uuid) OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 7. Tâche d'expiration (17 §2.5 étape 7) ------------------------------------------------------
-- Même filtre que 2a (A3 / A6), sans filtre de véhicule ni de guest, par lots, SKIP LOCKED (jamais
-- d'attente sur une conversion) ; traite aussi les libérations différées (release_requested_at
-- posé, borne de paiement échue) ⇒ RELEASED. Une désactivation ne viole jamais l'exclusion : pas
-- de verrou consultatif (17 §2.5). sweep_grace_s du pays du hold ; absent ⇒ le hold n'est pas
-- libéré tant qu'une opération non terminale existe (fail-closed). SECURITY INVOKER : droits et
-- politiques du travailleur hold_expiry (0007). Événements booking.hold.expired / .released.
CREATE FUNCTION core.booking_expire_due_holds(p_limit integer)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS DISTINCT FROM 'hold_expiry' THEN
    RAISE EXCEPTION 'hold expiry: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'hold expiry: batch size out of bounds' USING ERRCODE = '22023';
  END IF;
  WITH t AS (SELECT platform.now() AS ts),
     due AS (
       SELECT h.id, h.occupancy_id, (h.release_requested_at IS NOT NULL) AS release
         FROM core.booking_checkout_hold h
        CROSS JOIN t
        CROSS JOIN LATERAL (SELECT core.booking_param_int('sweep_grace_s', h.country_code) AS g) AS p
        WHERE h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
          AND (h.expires_at <= t.ts OR h.release_requested_at IS NOT NULL)
          AND (h.payment_in_flight_until IS NULL OR h.payment_in_flight_until <= t.ts)
          AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation o
                           WHERE o.hold_id = h.id AND o.purpose = 'RENT'
                             AND ( ( o.status IN ('PENDING','SUBMITTED','UNKNOWN')
                                     AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
                                     AND (p.g IS NULL
                                          OR t.ts < h.payment_in_flight_until + make_interval(secs => p.g)) )
                                OR ( o.status = 'SUCCEEDED'
                                     AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                                      WHERE d.operation_id = o.id) ) ))
        ORDER BY h.expires_at
        LIMIT p_limit
        FOR UPDATE OF h SKIP LOCKED
     ), done AS (
       UPDATE core.booking_checkout_hold AS ch
          SET status      = CASE WHEN due.release THEN 'RELEASED' ELSE 'EXPIRED' END,
              expired_at  = CASE WHEN due.release THEN ch.expired_at ELSE t.ts END,
              released_at = CASE WHEN due.release THEN t.ts ELSE ch.released_at END
         FROM due, t
        WHERE ch.id = due.id
       RETURNING ch.id, ch.occupancy_id, ch.status, ch.vehicle_id, ch.org_id, ch.country_code,
                 ch.release_reason
     ), occupancy AS (
       UPDATE core.booking_vehicle_occupancy AS vo
          SET active = false,
              deactivated_reason = CASE WHEN done.status = 'RELEASED' THEN 'HOLD_RELEASED'
                                        ELSE 'HOLD_EXPIRED' END
         FROM done
        WHERE vo.id = done.occupancy_id AND vo.kind = 'HOLD' AND vo.active
     ), events AS (
       INSERT INTO core.outbox_outbox_event
              (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
               actor_role, correlation_id, payload, partition_key)
       SELECT CASE WHEN done.status = 'RELEASED' THEN 'booking.hold.released'
                   ELSE 'booking.hold.expired' END,
              1, 'checkout_hold', done.id, 2, done.country_code, 'SYSTEM',
              pg_catalog.gen_random_uuid(),
              pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                'hold_id', done.id, 'vehicle_id', done.vehicle_id, 'org_id', done.org_id,
                'reason', CASE WHEN done.status = 'RELEASED' THEN done.release_reason END)),
              done.id::text
         FROM done
     )
  SELECT pg_catalog.count(*)::integer INTO n FROM done;
  RETURN n;
END
$fn$;

COMMENT ON FUNCTION core.booking_expire_due_holds(integer) IS
  'Tâche d''expiration (17 §2.5 étape 7), travailleur hold_expiry : holds échus et libérations '
  'différées, filtre A3 / A6, SKIP LOCKED, par lots. US-023.';

REVOKE ALL ON FUNCTION core.booking_expire_due_holds(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_expire_due_holds(integer) TO app_worker;
