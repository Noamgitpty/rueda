-- 0006 — AVL : disposition des paiements (XOR) et invariants gardés par triggers.
-- US-006 ; 17 §2.5 (I-OCC, contraintes v3 / v4 : N1, N2, M4, B5), §3.2.4 ; 08 BR-BOOK-10,
-- SM-1 ; preuves L0-01, L0-03, L0-08 (17 §11). ADR-047 (fonctions de trigger d'intégrité).
-- Appliquée sous `migrator`.
--
-- Fonctions de trigger d'INTÉGRITÉ (I-OCC, disposition) : SECURITY DEFINER, propriétaire
-- migrator, search_path figé, EXECUTE retiré à PUBLIC (ADR-047). Raison : un trigger différé
-- s'exécute au COMMIT sous le rôle courant de la session (PostgreSQL 16) — qui peut être app_api
-- après une commande cmd_* — ou sous le rôle qui a déclenché l'événement (PostgreSQL 18). Sous
-- les droits de l'appelant, la RLS lui cacherait des lignes et rendrait la vérification fausse.
-- Une fonction RETURNS trigger n'est pas appelable directement ; elle ne reçoit aucune entrée
-- client (seulement les identifiants de la ligne modifiée) et n'exécute aucun SQL dynamique.
--
-- Codes : chaque refus lève SQLSTATE 23000 avec un nom de CONSTRAINT stable ; la couche d'accès le
-- traduit en code métier sans DETAIL (packages/db/src/errors.ts, L0-08).
--
-- Retour arrière :
--   DROP TRIGGER occupancy_trip_ref_valid, occupancy_trip_guard ON core.booking_vehicle_occupancy;
--   DROP TRIGGER trip_has_active_occupancy ON core.booking_trip;
--   DROP TRIGGER hold_conversion_matches_disposition, hold_terminal_status ON core.booking_checkout_hold;
--   DROP TABLE core.booking_payment_disposition;
--   DROP FUNCTION core.booking_assert_trip_occupancy(), core.booking_assert_conversion_disposition(),
--     core.booking_assert_rent_payment_operation(), core.booking_hold_terminal_guard();

-- 1. Disposition d'une opération de loyer reçue sur un hold (17 §2.5, corrigé VERIF_16-N1, N2) ---
CREATE TABLE core.booking_payment_disposition (
  -- PK = invariant XOR : une opération est convertie OU compensée, jamais les deux
  operation_id         uuid        CONSTRAINT payment_disposition_pkey PRIMARY KEY
    REFERENCES core.payment_payment_operation (id),
  hold_id              uuid        NOT NULL REFERENCES core.booking_checkout_hold (id),
  disposition          text        NOT NULL
    CONSTRAINT payment_disposition_valid CHECK (disposition IN ('CONVERSION', 'COMPENSATION')),
  trip_id              uuid        REFERENCES core.booking_trip (id),
  hold_compensation_id uuid        REFERENCES core.booking_hold_compensation (id),
  decided_at           timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT disposition_conversion_has_trip CHECK ((disposition = 'CONVERSION') = (trip_id IS NOT NULL)),
  CONSTRAINT disposition_compensation_has_ref CHECK (
    (disposition = 'COMPENSATION') = (hold_compensation_id IS NOT NULL))
);

-- un seul paiement convertit un hold (N2)
CREATE UNIQUE INDEX one_conversion_per_hold
  ON core.booking_payment_disposition (hold_id) WHERE (disposition = 'CONVERSION');

ALTER TABLE core.booking_payment_disposition ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_payment_disposition FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_payment_disposition TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.booking_payment_disposition FROM PUBLIC;

COMMENT ON TABLE core.booking_payment_disposition IS
  'AVL payment_disposition (17 §2.5). Immuable (aucun droit UPDATE / DELETE). Classe A.';

-- 2. États terminaux du hold (17 §2.5 (iii), corrigé VERIF_16-N1) ----------------------------
-- Toute sortie de CONVERTED ou de COMPENSATED est refusée ; le no-op COMPENSATED -> COMPENSATED
-- (bloc C sur un hold déjà compensé) est toléré. Aucune lecture : pas besoin de SECURITY DEFINER.
CREATE FUNCTION core.booking_hold_terminal_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.converted_trip_id IS DISTINCT FROM OLD.converted_trip_id
     OR NEW.conversion_operation_id IS DISTINCT FROM OLD.conversion_operation_id THEN
    RAISE EXCEPTION 'checkout_hold: status % is terminal', OLD.status
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'hold_terminal_status',
            DETAIL = pg_catalog.format('hold %s: %s -> %s', OLD.id, OLD.status, NEW.status);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER hold_terminal_status
  BEFORE UPDATE ON core.booking_checkout_hold
  FOR EACH ROW
  WHEN (OLD.status IN ('CONVERTED', 'COMPENSATED'))
  EXECUTE FUNCTION core.booking_hold_terminal_guard();

-- 3. Seule une opération de PAIEMENT de LOYER réussie du hold reçoit une disposition (B5 (i)) ---
CREATE FUNCTION core.booking_assert_rent_payment_operation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  op record;
BEGIN
  SELECT o.hold_id, o.purpose, o.kind, o.status
    INTO op
    FROM core.payment_payment_operation o
   WHERE o.id = NEW.operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_disposition: unknown operation'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'disposition_rent_payment_only',
            DETAIL = pg_catalog.format('operation %s', NEW.operation_id);
  END IF;
  IF op.purpose <> 'RENT'
     OR op.kind NOT IN ('AUTH', 'CAPTURE')          -- LINK_PAYMENT : sans objet (P2P)
     OR op.hold_id IS DISTINCT FROM NEW.hold_id
     OR op.status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'payment_disposition: not a succeeded rent payment of this hold'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'disposition_rent_payment_only',
            DETAIL = pg_catalog.format('operation %s', NEW.operation_id);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER disposition_rent_payment_only
  BEFORE INSERT ON core.booking_payment_disposition
  FOR EACH ROW EXECUTE FUNCTION core.booking_assert_rent_payment_operation();

-- 4. conversion_operation_id et la ligne CONVERSION sont une seule vérité (B5 (ii)), et un hold
--    COMPENSATED a sa disposition COMPENSATION (même transaction, 17 §2.5 « bloc C »). Différé :
--    l'état FINAL de la transaction est relu au COMMIT.
CREATE FUNCTION core.booking_assert_conversion_disposition()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_hold uuid;
  h      record;
BEGIN
  IF TG_TABLE_NAME = 'booking_checkout_hold' THEN
    v_hold := NEW.id;
  ELSE
    v_hold := NEW.hold_id;
  END IF;

  SELECT ch.status, ch.converted_trip_id, ch.conversion_operation_id
    INTO h
    FROM core.booking_checkout_hold ch
   WHERE ch.id = v_hold;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF h.status = 'CONVERTED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM core.booking_payment_disposition d
       WHERE d.hold_id = v_hold AND d.disposition = 'CONVERSION'
         AND d.operation_id = h.conversion_operation_id
         AND d.trip_id = h.converted_trip_id) THEN
      RAISE EXCEPTION 'checkout_hold: CONVERTED without its CONVERSION disposition'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'hold_conversion_matches_disposition',
              DETAIL = pg_catalog.format('hold %s', v_hold);
    END IF;
  ELSIF EXISTS (
      SELECT 1 FROM core.booking_payment_disposition d
       WHERE d.hold_id = v_hold AND d.disposition = 'CONVERSION') THEN
    RAISE EXCEPTION 'checkout_hold: CONVERSION disposition on a hold that is not CONVERTED'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'hold_conversion_matches_disposition',
            DETAIL = pg_catalog.format('hold %s, status %s', v_hold, h.status);
  END IF;

  IF h.status = 'COMPENSATED' AND NOT EXISTS (
      SELECT 1 FROM core.booking_payment_disposition d
       WHERE d.hold_id = v_hold AND d.disposition = 'COMPENSATION') THEN
    RAISE EXCEPTION 'checkout_hold: COMPENSATED without a COMPENSATION disposition'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'hold_conversion_matches_disposition',
            DETAIL = pg_catalog.format('hold %s', v_hold);
  END IF;
  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER hold_conversion_matches_disposition
  AFTER INSERT OR UPDATE OF status, converted_trip_id, conversion_operation_id
  ON core.booking_checkout_hold
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.booking_assert_conversion_disposition();

CREATE CONSTRAINT TRIGGER disposition_matches_hold
  AFTER INSERT ON core.booking_payment_disposition
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.booking_assert_conversion_disposition();

-- 5. Invariant I-OCC (17 §2.5, 08 BR-BOOK-10) ------------------------------------------------
-- Tout trip non terminal (BOOKED à OVERDUE / UNRETURNED) possède exactement une occupation
-- kind = 'TRIP', active, ref_id = trip.id, du véhicule du trip. Vérifié au COMMIT :
--   (1)     trip_has_active_occupancy : création du trip, changement d'état, de véhicule ou de période ;
--   (1 bis) occupancy_trip_guard : désactivation, suppression, changement de ref_id ou de kind
--           d'une ligne TRIP (corrigé VERIF_16-M4) ;
--   (1 ter) occupancy_trip_ref_valid : une ligne TRIP active désigne un trip existant du même
--           véhicule (pas d'occupation TRIP orpheline après une conversion avortée).
-- La borne « au plus une » est structurelle (index one_active_occupancy_per_trip, 0004).
-- États qui tiennent le créneau (SM-1 de 08 ; PROPOSÉ, reporté dans packages/db/README.md) :
-- BOOKED, CHECKIN_OPEN, START_WINDOW_EXPIRED, IN_PROGRESS, OVERDUE, UNRETURNED. Aucun état terminal
-- ne revient vers ces états dans SM-1 : une lecture READ COMMITTED de l'état suffit (ADR-047).
CREATE FUNCTION core.booking_assert_trip_occupancy()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_constraint text;
  v_trip       uuid;
  v_ref_vehicle uuid;
  o            record;
  t            record;
  n            integer;
BEGIN
  v_constraint := TG_ARGV[0];
  IF TG_TABLE_NAME = 'booking_trip' THEN
    v_trip := NEW.id;
  ELSIF v_constraint = 'occupancy_trip_ref_valid' THEN
    SELECT vo.kind, vo.active, vo.ref_id, vo.vehicle_id
      INTO o
      FROM core.booking_vehicle_occupancy vo
     WHERE vo.id = NEW.id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF o.kind <> 'TRIP' OR NOT o.active THEN
      RETURN NULL;                     -- plus une ligne TRIP active : occupancy_trip_guard statue
    END IF;
    SELECT tr.vehicle_id INTO v_ref_vehicle FROM core.booking_trip tr WHERE tr.id = o.ref_id;
    IF NOT FOUND OR v_ref_vehicle IS DISTINCT FROM o.vehicle_id THEN
      RAISE EXCEPTION 'I-OCC: active TRIP occupancy without a trip of the same vehicle'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = v_constraint,
              DETAIL = pg_catalog.format('occupancy %s, ref_id %s', NEW.id, o.ref_id);
    END IF;
    v_trip := o.ref_id;
  ELSE
    IF OLD.ref_type IS DISTINCT FROM 'TRIP' OR OLD.ref_id IS NULL THEN
      RETURN NULL;
    END IF;
    v_trip := OLD.ref_id;
  END IF;

  SELECT tr.status, tr.vehicle_id INTO t FROM core.booking_trip tr WHERE tr.id = v_trip;
  IF NOT FOUND THEN
    RETURN NULL;                       -- aucun trip à protéger (occupancy_trip_ref_valid statue)
  END IF;

  IF t.status IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE',
                  'UNRETURNED') THEN
    SELECT count(*) INTO n
      FROM core.booking_vehicle_occupancy vo
     WHERE vo.kind = 'TRIP' AND vo.active
       AND vo.ref_type = 'TRIP' AND vo.ref_id = v_trip
       AND vo.vehicle_id = t.vehicle_id;
    IF n <> 1 THEN
      RAISE EXCEPTION 'I-OCC: non-terminal trip without exactly one active TRIP occupancy'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = v_constraint,
              DETAIL = pg_catalog.format('trip %s, status %s, active TRIP occupancies %s',
                                         v_trip, t.status, n);
    END IF;
  END IF;
  RETURN NULL;
END
$fn$;

CREATE CONSTRAINT TRIGGER trip_has_active_occupancy
  AFTER INSERT OR UPDATE OF status, vehicle_id, scheduled_start, scheduled_end
  ON core.booking_trip
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.booking_assert_trip_occupancy('trip_has_active_occupancy');

CREATE CONSTRAINT TRIGGER occupancy_trip_guard
  AFTER UPDATE OR DELETE ON core.booking_vehicle_occupancy
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.kind = 'TRIP')
  EXECUTE FUNCTION core.booking_assert_trip_occupancy('occupancy_trip_guard');

CREATE CONSTRAINT TRIGGER occupancy_trip_ref_valid
  AFTER INSERT OR UPDATE ON core.booking_vehicle_occupancy
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.kind = 'TRIP' AND NEW.active)
  EXECUTE FUNCTION core.booking_assert_trip_occupancy('occupancy_trip_ref_valid');

REVOKE ALL ON FUNCTION core.booking_hold_terminal_guard(), core.booking_assert_rent_payment_operation(),
  core.booking_assert_conversion_disposition(), core.booking_assert_trip_occupancy() FROM PUBLIC;
