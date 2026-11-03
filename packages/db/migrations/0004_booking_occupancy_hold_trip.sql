-- 0004 — AVL : occupations, holds de checkout, trips, compensations (schéma de preuve L0).
-- US-006 ; 17 §2.5 « Contraintes (spécification de schéma) », §3.2.4 ; 08 BR-BOOK-05, BR-BOOK-08,
-- BR-BOOK-10 ; ADR-002. Appliquée sous `migrator`.
--
-- Sous-ensemble EXACT des entités de 17 §3.2.4 (noms d'entités et de colonnes de 17, préfixe Bêta
-- `booking_`) : réutilisé tel quel par US-022 à US-024, ce n'est pas un prototype jetable. Les
-- colonnes et contraintes non nécessaires aux preuves L0-01 / L0-03 / L0-08 seront ajoutées par
-- migrations additives (voir packages/db/README.md, « Schéma AVL »).
--
-- Clés étrangères vers des tables qui n'existent pas encore (catalog_vehicle, iam_user,
-- iam_organization, pricing_quote, catalog_listing) : colonnes `uuid NOT NULL` sans FK, à
-- compléter par la story qui crée la table cible. Aucune constante propre à un pays : codes pays
-- et devises contrôlés par leur format seulement (la liste fait foi dans config, US-008).
--
-- Retour arrière (tables vides) :
--   DROP TABLE core.booking_hold_compensation, core.booking_guest_occupancy;
--   ALTER TABLE core.booking_checkout_hold DROP CONSTRAINT checkout_hold_converted_trip_fk;
--   DROP TABLE core.booking_trip, core.booking_checkout_hold, core.booking_vehicle_occupancy;

-- 1. Occupation d'un véhicule (17 §2.5 « Sources de vérité ») ---------------------------------
CREATE TABLE core.booking_vehicle_occupancy (
  id                 uuid        PRIMARY KEY,
  vehicle_id         uuid        NOT NULL,          -- FK catalog_vehicle : story du catalogue
  kind               text        NOT NULL
    CONSTRAINT occupancy_kind_valid CHECK (kind IN ('TRIP', 'HOLD', 'HOST_BLOCK', 'BUFFER')),
  source             text        NOT NULL
    CONSTRAINT occupancy_source_valid CHECK (source IN ('CHECKOUT', 'MANUAL', 'ICAL', 'SYSTEM')),
  period             tstzrange   NOT NULL,          -- [début, fin + tampon) pour TRIP et HOLD
  active             boolean     NOT NULL,          -- seul prédicat de l'exclusion
  expires_at         timestamptz,                   -- HOLD seulement
  deactivated_reason text
    CONSTRAINT occupancy_deactivated_reason_valid CHECK (deactivated_reason IN
      ('HOLD_EXPIRED', 'HOLD_RELEASED', 'HOLD_COMPENSATED', 'TRIP_TERMINAL', 'SHORTENED',
       'BLOCK_REMOVED')),                          -- remis à NULL à la ré-acquisition (M4)
  ref_type           text,
  ref_id             uuid,
  ical_uid           text,
  created_at         timestamptz NOT NULL DEFAULT platform.now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT platform.now(),
  updated_by         uuid,
  row_version        integer     NOT NULL DEFAULT 0,
  -- 17 §2.5, corrigé VERIF_14-F20 : intervalle semi-ouvert [début, fin), borné, non vide
  CONSTRAINT period_valid CHECK (
        period IS NOT NULL AND NOT isempty(period)
    AND NOT lower_inf(period) AND NOT upper_inf(period)
    AND lower_inc(period) AND NOT upper_inc(period)),
  CONSTRAINT hold_has_ttl CHECK (kind <> 'HOLD' OR expires_at IS NOT NULL),
  CONSTRAINT trip_has_no_ttl CHECK (kind <> 'TRIP' OR expires_at IS NULL),
  -- I-OCC : une ligne TRIP désigne son trip (ref_id = trip.id)
  CONSTRAINT trip_occupancy_has_ref CHECK (kind <> 'TRIP' OR (ref_type = 'TRIP' AND ref_id IS NOT NULL)),
  -- une ligne inactive dit pourquoi (classe B : désactivation, jamais suppression)
  CONSTRAINT inactive_has_reason CHECK (active OR deactivated_reason IS NOT NULL),
  -- BR-BOOK-10 : jamais deux occupations actives chevauchantes d'un même véhicule (btree_gist)
  CONSTRAINT vehicle_occupancy_no_overlap
    EXCLUDE USING gist (vehicle_id WITH =, period WITH &&) WHERE (active)
);

-- 17 §3.2.4 : un événement iCal par véhicule
CREATE UNIQUE INDEX occupancy_ical_uid_unique
  ON core.booking_vehicle_occupancy (vehicle_id, ical_uid) WHERE (source = 'ICAL');
-- I-OCC « exactement une » occupation TRIP active par trip : la borne haute est structurelle,
-- la borne basse est vérifiée au COMMIT par les triggers différés (0006).
CREATE UNIQUE INDEX one_active_occupancy_per_trip
  ON core.booking_vehicle_occupancy (ref_id) WHERE (kind = 'TRIP' AND active);

CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_vehicle_occupancy
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

COMMENT ON TABLE core.booking_vehicle_occupancy IS
  'AVL vehicle_occupancy (17 §2.5, §3.2.4). Exclusion GiST WHERE (active). Écrit par commandes et '
  'travailleurs seulement ; toute écriture sous le verrou consultatif du véhicule (M2). Classe B.';

-- 2. Hold de checkout (17 §2.5 « Type de hold », §3.2.4) --------------------------------------
CREATE TABLE core.booking_checkout_hold (
  id                      uuid        PRIMARY KEY,
  guest_user_id           uuid        NOT NULL,     -- FK iam_user
  vehicle_id              uuid        NOT NULL,     -- FK catalog_vehicle
  org_id                  uuid        NOT NULL,     -- compte d'hôte du véhicule ; FK iam_organization
  country_code            text        NOT NULL
    CONSTRAINT hold_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  quote_id                uuid,                     -- FK pricing_quote
  occupancy_id            uuid        NOT NULL
    CONSTRAINT checkout_hold_occupancy_unique UNIQUE
    REFERENCES core.booking_vehicle_occupancy (id),
  -- 17 §2.5 : hold CHECKOUT seul ; REQUEST (et AWAITING_HOST, request_respond_by) arrive avec US-219
  kind                    text        NOT NULL DEFAULT 'CHECKOUT'
    CONSTRAINT hold_kind_valid CHECK (kind = 'CHECKOUT'),
  status                  text        NOT NULL
    CONSTRAINT hold_status_valid CHECK (status IN
      ('ACTIVE', 'PAYMENT_IN_FLIGHT', 'CONVERTED', 'EXPIRED', 'RELEASED', 'COMPENSATED')),
  expires_at              timestamptz NOT NULL,
  payment_in_flight_until timestamptz,
  payment_attempts        integer     NOT NULL DEFAULT 0
    CONSTRAINT hold_payment_attempts_nonnegative CHECK (payment_attempts >= 0), -- borne : paramètre
  expired_at              timestamptz,
  release_requested_at    timestamptz,
  released_at             timestamptz,
  released_by             uuid,
  release_reason          text
    CONSTRAINT hold_release_reason_valid CHECK (release_reason IN
      ('GUEST_ABANDON', 'PAYMENT_DECLINED', 'SUPERSEDED_BY_PAID_HOLD', 'REVIEW_REJECTED',
       'HOST_UNAVAILABLE')),
  review_required         boolean     NOT NULL DEFAULT false,
  reviewed_at             timestamptz,
  last_polled_at          timestamptz,
  converted_trip_id       uuid,                     -- FK ajoutée après booking_trip
  conversion_operation_id uuid                      -- FK payment_operation : 0005
    CONSTRAINT hold_conversion_op_unique UNIQUE,
  compensated_at          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT platform.now(),
  created_by              uuid,
  updated_at              timestamptz NOT NULL DEFAULT platform.now(),
  updated_by              uuid,
  row_version             integer     NOT NULL DEFAULT 0,
  CONSTRAINT hold_converted_has_trip CHECK (status <> 'CONVERTED'
      OR (converted_trip_id IS NOT NULL AND conversion_operation_id IS NOT NULL))
);

-- 17 §2.5 : au plus un hold vivant par (guest, véhicule) ; l'expiration passe par status, jamais
-- par une horloge dans le prédicat (non immuable).
CREATE UNIQUE INDEX one_live_hold_per_guest_vehicle
  ON core.booking_checkout_hold (guest_user_id, vehicle_id)
  WHERE (status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT'));
-- Les deux index de l'expiration ciblée 2a (17 §2.5, plan mesuré par L0-04, US-007)
CREATE INDEX checkout_hold_vehicle_status_idx ON core.booking_checkout_hold (vehicle_id, status);
CREATE INDEX checkout_hold_guest_status_idx ON core.booking_checkout_hold (guest_user_id, status);

CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_checkout_hold
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

COMMENT ON TABLE core.booking_checkout_hold IS
  'AVL checkout_hold (17 §2.5, §3.2.4). CONVERTED et COMPENSATED terminaux (trigger 0006). '
  'Aucune écriture par app_api : commandes cmd_* (US-023) et travailleurs (app_worker).';

-- 3. Trip (17 §3.2.4 ; SM-1 de 08) ------------------------------------------------------------
CREATE TABLE core.booking_trip (
  id                  uuid        PRIMARY KEY,
  public_ref          text
    CONSTRAINT trip_public_ref_unique UNIQUE,
  guest_user_id       uuid        NOT NULL,         -- FK iam_user
  org_id              uuid        NOT NULL,         -- FK iam_organization
  vehicle_id          uuid        NOT NULL,         -- FK catalog_vehicle
  listing_id          uuid,                         -- FK catalog_listing
  country_code        text        NOT NULL
    CONSTRAINT trip_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency            text        NOT NULL
    CONSTRAINT trip_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  timezone            text        NOT NULL,         -- figé à la réservation
  scheduled_start     timestamptz NOT NULL,
  scheduled_end       timestamptz NOT NULL,
  booked_at           timestamptz NOT NULL DEFAULT platform.now(),
  status              text        NOT NULL
    CONSTRAINT trip_status_valid CHECK (status IN
      ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS', 'OVERDUE', 'RETURNED',
       'UNRETURNED', 'TERMINATED_EARLY', 'VEHICLE_LOST', 'POST_TRIP', 'COMPLETED', 'IN_DISPUTE',
       'CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST', 'CANCELLED_BY_PLATFORM', 'REFUSED_AT_PICKUP',
       'NO_SHOW_GUEST', 'NO_SHOW_HOST')),
  requirements_status text        NOT NULL DEFAULT 'NONE'
    CONSTRAINT trip_requirements_status_valid CHECK (requirements_status IN
      ('NONE', 'PENDING', 'SATISFIED', 'FAILED')),
  -- un trip n'existe qu'avec une preuve de paiement : pas d'état « en attente » (VERIF_14-F4)
  payment_status      text        NOT NULL DEFAULT 'CONFIRMED'
    CONSTRAINT trip_payment_status_valid CHECK (payment_status IN
      ('CONFIRMED', 'REFUNDED_PARTIAL', 'REFUNDED')),
  source_hold_id      uuid
    CONSTRAINT trip_source_hold_unique UNIQUE
    REFERENCES core.booking_checkout_hold (id),
  termination_reason  text,
  cancellation_reason text,
  created_at          timestamptz NOT NULL DEFAULT platform.now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT platform.now(),
  updated_by          uuid,
  row_version         integer     NOT NULL DEFAULT 0,
  CONSTRAINT trip_period_valid CHECK (scheduled_start < scheduled_end),
  -- SM-1 invariant 4
  CONSTRAINT trip_terminated_has_reason CHECK (status <> 'TERMINATED_EARLY' OR termination_reason IS NOT NULL)
);

CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_trip
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

ALTER TABLE core.booking_checkout_hold
  ADD CONSTRAINT checkout_hold_converted_trip_fk
  FOREIGN KEY (converted_trip_id) REFERENCES core.booking_trip (id);

COMMENT ON TABLE core.booking_trip IS
  'AVL trip (17 §3.2.4, SM-1). I-OCC : trip non terminal => exactement une occupation TRIP active '
  '(triggers différés, 0006). Sous-ensemble de colonnes ; le reste arrive avec US-024.';

-- 4. Occupation d'un guest : trips seulement (17 §2.5, BR-BOOK-08, corrigé VERIF_14-F3) -------
CREATE TABLE core.booking_guest_occupancy (
  id            uuid        PRIMARY KEY,
  guest_user_id uuid        NOT NULL,               -- FK iam_user
  period        tstzrange   NOT NULL,               -- sans tampon
  active        boolean     NOT NULL,
  trip_id       uuid        NOT NULL
    CONSTRAINT guest_occupancy_trip_unique UNIQUE
    REFERENCES core.booking_trip (id),
  created_at    timestamptz NOT NULL DEFAULT platform.now(),
  updated_at    timestamptz NOT NULL DEFAULT platform.now(),
  row_version   integer     NOT NULL DEFAULT 0,
  CONSTRAINT period_valid CHECK (
        period IS NOT NULL AND NOT isempty(period)
    AND NOT lower_inf(period) AND NOT upper_inf(period)
    AND lower_inc(period) AND NOT upper_inc(period)),
  CONSTRAINT guest_no_overlap
    EXCLUDE USING gist (guest_user_id WITH =, period WITH &&) WHERE (active)
);

CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_guest_occupancy
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- 5. Compensation d'un paiement sans créneau (17 §2.5 étape 5, §3.2.4, corrigé VERIF_14-F2) ---
CREATE TABLE core.booking_hold_compensation (
  id                 uuid        PRIMARY KEY,
  hold_id            uuid        NOT NULL REFERENCES core.booking_checkout_hold (id),
  reason             text        NOT NULL
    CONSTRAINT hold_compensation_reason_valid CHECK (reason IN
      ('SLOT_LOST_AFTER_EXPIRY', 'SLOT_LOST_AFTER_RELEASE', 'GUEST_OVERLAP', 'INVARIANT_VIOLATION',
       'DUPLICATE_PAYMENT', 'LATE_PAYMENT_AFTER_COMPENSATION', 'ELIGIBILITY_CHANGED',
       'START_PASSED', 'ORPHAN_PAYMENT')),
  operation_id       uuid        NOT NULL           -- FK payment_operation : 0005
    CONSTRAINT hold_compensation_operation_unique UNIQUE,   -- une opération compensée une fois (B5)
  action             text        NOT NULL
    CONSTRAINT hold_compensation_action_valid CHECK (action IN
      ('VOID', 'LET_EXPIRE', 'REFUND_API', 'BANK_TRANSFER_REFUND', 'OPS_LOOKUP')),
  refund_instance_id uuid,                          -- FK refund_instance : US-024
  status             text        NOT NULL DEFAULT 'OPEN'
    CONSTRAINT hold_compensation_status_valid CHECK (status IN
      ('OPEN', 'EXECUTING', 'DONE', 'ESCALATED')),
  opened_at          timestamptz NOT NULL DEFAULT platform.now(),
  closed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT platform.now(),
  updated_at         timestamptz NOT NULL DEFAULT platform.now(),
  row_version        integer     NOT NULL DEFAULT 0
);

CREATE TRIGGER touch_row BEFORE UPDATE ON core.booking_hold_compensation
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- 6. RLS partout (CLAUDE.md point 5 ; 17 §2.3, B9) : ENABLE + FORCE, migrator soumis à FORCE ----
ALTER TABLE core.booking_vehicle_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_vehicle_occupancy FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_vehicle_occupancy TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.booking_checkout_hold ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_checkout_hold FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_checkout_hold TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.booking_trip ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_trip FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_trip TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.booking_guest_occupancy ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_guest_occupancy FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_guest_occupancy TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.booking_hold_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_hold_compensation FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_hold_compensation TO migrator USING (true) WITH CHECK (true);

REVOKE ALL ON core.booking_vehicle_occupancy, core.booking_checkout_hold, core.booking_trip,
              core.booking_guest_occupancy, core.booking_hold_compensation FROM PUBLIC;
