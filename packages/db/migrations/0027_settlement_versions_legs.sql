-- 0027 — STL : règlements persistés, versions, supersession et jambes.
-- US-018 ; 08 E1, E4 (version, calcul unique, verrou, supersession), E7 (jambes, règles 3, 3 bis,
-- 5, 8) ; 17 v6 §2.3 (SQL des tables d'argent, RLS-2, RLS-21, RLS-25, RLS-28), §2.9, §3.2.8, §4.3
-- point 8 ; ADR-054 (moteur), ADR-057 (persistance). Appliquée sous `migrator`.
--
-- Bêta (D1, 17 §10 point 3) : schéma unique `core`, tables préfixées par le schéma cible
-- `settlement_` (`settlement.settlement` → `core.settlement_settlement`).
--
-- Principes :
--   - un règlement n'est JAMAIS modifié : la version n+1 le remplace par supersession
--     (`supersedes_id`), la version n reste lisible telle quelle (08 E4) ; triggers
--     `settlement_immutable` sur l'en-tête, les lignes, les taxes et les jambes ;
--   - une seule version n par (trip, segment) : verrou `FOR UPDATE` du trip, contrôle optimiste de
--     `trip.row_version`, puis `UNIQUE (trip_id, segment_no, version)` et `UNIQUE (supersedes_id)` :
--     second événement ⇒ `SETTLEMENT_EXISTS` (08 règle de qualification 5, EC-54) ;
--   - jambes explicites HOST / INSURER / TAX_THIRD_PARTY / PLATFORM (08 E7) : jambe retenue
--     `kept_minor` ≥ 0, base `basis_minor` (état capturé pour v1, jambe signée de la version n pour
--     n+1) et variation signée `variation_minor = kept − advance − basis` ;
--   - jambe PLATFORM retenue négative (drapeau `negativeLeg` du moteur, 08 E7 règle 5, TJ13 b) :
--     elle n'est jamais écrite négative ; `kept_minor = 0` et `advance_minor` = montant que Kmino
--     doit avancer ; `negative_leg = true` signale la revue FIN : le remboursement n'est jamais
--     réduit et les ordres qui en découlent restent `PLANNED` jusqu'à la décision FIN (PROPOSÉ,
--     fail-closed, ADR-057) ; aucune créance sur l'hôte (sa part est due) ;
--   - invariants vérifiés en base par le trigger différé `settlement_balanced` (08 E7, 17 §2.9
--     « Invariants par jambe ») : Σ jambes signées = retenu TTC, Σ variations = − remboursement
--     (v1) ou − écart de remboursement depuis la version n (v n+1, 08 E4),
--     HOST = hostFromGuest, TAX_THIRD_PARTY = taxe retenue des groupes tiers, base = version n ou
--     état capturé (et `trip_leg_balance.captured_minor` quand il existe) ;
--   - écritures par la seule commande `core.settlement_cmd_record` (SECURITY DEFINER, propriétaire
--     `cmd_money_owner` NOLOGIN, EXECUTE au seul app_worker sous `app.worker_name = 'settlement'`) ;
--     aucune écriture de table par app_api ni app_worker (RLS-21) ;
--   - lectures (RLS ENABLE + FORCE, GRANT par colonnes, aucun identifiant du personnel) :
--     hôte TITULAIRE : jambe HOST de ses trips seulement (RLS-2, RLS-28) ; en-tête, lignes, taxes :
--     ADMIN / FINANCE du pays ; jambes : ADMIN / FINANCE, OPS / SUPPORT sur dossier assigné
--     (RLS-23) ; voyageur : rien (vue dédiée plus tard) ;
--     travailleurs de la liste blanche de 17 §2.3 ;
--   - `trip_leg_balance` : table, contraintes et lectures ; son écrivain
--     (`cmd_apply_leg_movement`, montants lus de `payment_operation_leg`, jamais d'un paramètre
--     libre) arrive avec les opérations par jambe (US-061 / US-223).
--
-- Retour arrière :
--   DROP FUNCTION core.settlement_cmd_record(uuid, uuid, integer, integer, uuid, integer, jsonb);
--   DROP TABLE core.settlement_settlement_leg, core.settlement_settlement_tax_line,
--     core.settlement_settlement_line, core.settlement_trip_leg_balance, core.settlement_settlement;
--   DROP FUNCTION core.settlement_assert_balanced(), core.settlement_guard_immutable(),
--     core.settlement_trip_leg_balance_guard();
--   DROP POLICY money_read ON core.booking_trip; DROP POLICY money_lock ON core.booking_trip;
--   REVOKE ALL ON core.booking_trip FROM cmd_money_owner;
--   REVOKE USAGE ON SCHEMA core, app FROM cmd_money_owner;
--   REVOKE EXECUTE ON FUNCTION app.actor_kind(), app.worker_name() FROM cmd_money_owner;

-- 1. Tables --------------------------------------------------------------------------------------

CREATE TABLE core.settlement_settlement (
  id                      uuid        PRIMARY KEY,
  trip_id                 uuid        NOT NULL,
  -- Bêta : un trip = un segment (aucune table de segments). Un second segment ouvrirait une seconde
  -- chaîne de versions, donc un second remboursement : refusé. À retirer par la migration qui
  -- introduira les segments (FK vers la table des segments, migration additive).
  segment_no              integer     NOT NULL
    CONSTRAINT settlement_segment_beta CHECK (segment_no = 1),
  version                 integer     NOT NULL
    CONSTRAINT settlement_version_positive CHECK (version >= 1),
  supersedes_id           uuid,
  org_id                  uuid        NOT NULL,       -- compte d'hôte du trip (portée RLS)
  country_code            text        NOT NULL
    CONSTRAINT settlement_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency                text        NOT NULL
    CONSTRAINT settlement_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  kind                    text        NOT NULL
    CONSTRAINT settlement_kind_valid CHECK (kind IN ('CANCELLATION', 'TERMINATION', 'COMPLETION')),
  engine_version          text        NOT NULL
    CONSTRAINT settlement_engine_version_format CHECK (engine_version ~ '^[a-z][a-z0-9-]{0,30}/[0-9]{1,6}$'),
  requested_reason        text        NOT NULL
    CONSTRAINT settlement_requested_reason_format CHECK (requested_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  reason                  text        NOT NULL
    CONSTRAINT settlement_reason_format CHECK (reason ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  origin                  text        NOT NULL
    CONSTRAINT settlement_origin_format CHECK (origin ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  qualification           text        NOT NULL
    CONSTRAINT settlement_qualification_valid CHECK (qualification IN
      ('VOLUNTARY', 'FAULT_PRE_START', 'NO_SHOW', 'FULL')),
  target_state            text        NOT NULL
    CONSTRAINT settlement_target_state_format CHECK (target_state ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  host_eligible           boolean     NOT NULL,
  total_paid_minor        bigint      NOT NULL,
  guest_refund_minor      bigint      NOT NULL,
  tax_refund_minor        bigint      NOT NULL,
  retained_minor          bigint      NOT NULL,
  retained_tax_minor      bigint      NOT NULL,
  host_from_guest_minor   bigint      NOT NULL,
  host_compensation_minor bigint      NOT NULL,
  host_earnings_minor     bigint      NOT NULL,
  platform_net_minor      bigint      NOT NULL,       -- seul montant signé de l'en-tête (17 §3.2.8)
  host_penalty_minor      bigint      NOT NULL,       -- hors jambes : ajustement du host_ledger (E7 règle 7)
  negative_leg            boolean     NOT NULL,       -- revue FIN requise (E7 règle 5)
  -- entrées canoniques du moteur (`canonicalJson`, texte exact) : rejouables avant tout ordre
  -- (ADR-057) ; leur empreinte est contrôlée en base (settlement_inputs_hash_match)
  inputs                  text        NOT NULL,
  inputs_hash             bytea       NOT NULL
    CONSTRAINT settlement_inputs_hash_sha256 CHECK (octet_length(inputs_hash) = 32),
  param_snapshot_hash     bytea       NOT NULL
    CONSTRAINT settlement_param_hash_sha256 CHECK (octet_length(param_snapshot_hash) = 32),
  created_at              timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT settlement_amounts_nonneg CHECK (
    total_paid_minor >= 0 AND guest_refund_minor >= 0 AND tax_refund_minor >= 0
    AND retained_tax_minor >= 0 AND retained_minor + retained_tax_minor >= 0
    AND host_from_guest_minor >= 0 AND host_compensation_minor >= 0 AND host_penalty_minor >= 0),
  -- 17 §3.2.8 : remboursement + Σ retenu + taxe retenue = total du segment
  CONSTRAINT settlement_balance CHECK (
    guest_refund_minor + retained_minor + retained_tax_minor = total_paid_minor),
  CONSTRAINT settlement_earnings CHECK (
    host_earnings_minor = host_from_guest_minor + host_compensation_minor),
  CONSTRAINT settlement_platform_net CHECK (platform_net_minor = retained_minor - host_earnings_minor),
  CONSTRAINT settlement_inputs_hash_match CHECK (
    pg_catalog.sha256(pg_catalog.convert_to(
      'rueda.settlement.inputs/1' || pg_catalog.chr(10) || inputs, 'UTF8')) = inputs_hash),
  CONSTRAINT settlement_inputs_engine CHECK ((inputs::jsonb ->> 'engineVersion') = engine_version),
  CONSTRAINT settlement_version_unique UNIQUE (trip_id, segment_no, version),
  CONSTRAINT settlement_supersedes_unique UNIQUE (supersedes_id),
  CONSTRAINT settlement_supersession_shape CHECK ((version = 1) = (supersedes_id IS NULL)),
  CONSTRAINT settlement_scope_unique UNIQUE (id, trip_id, segment_no, org_id, country_code),
  CONSTRAINT settlement_segment_unique UNIQUE (id, trip_id, segment_no),
  -- la version remplacée appartient au même trip et au même segment
  CONSTRAINT settlement_supersedes_fk FOREIGN KEY (supersedes_id, trip_id, segment_no)
    REFERENCES core.settlement_settlement (id, trip_id, segment_no),
  CONSTRAINT settlement_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  CONSTRAINT settlement_org_country_fk FOREIGN KEY (org_id, country_code)
    REFERENCES core.iam_organization (id, country_code)
);
CREATE INDEX settlement_org_idx ON core.settlement_settlement (org_id);

COMMENT ON TABLE core.settlement_settlement IS
  'Règlement versionné d''un segment de trip (08 E4, 17 §3.2.8) ; immuable, remplacé par supersession. US-018.';

CREATE TABLE core.settlement_settlement_line (
  settlement_id  uuid   NOT NULL REFERENCES core.settlement_settlement (id),
  line_type      text   NOT NULL
    CONSTRAINT settlement_line_type_format CHECK (line_type ~ '^[a-z][A-Za-z]{0,62}$'),
  amount_minor   bigint NOT NULL,                      -- signé : une promo est une ligne négative
  refund_minor   bigint NOT NULL,
  retained_minor bigint NOT NULL,
  PRIMARY KEY (settlement_id, line_type),
  CONSTRAINT settlement_line_split CHECK (refund_minor + retained_minor = amount_minor)
);

CREATE TABLE core.settlement_settlement_tax_line (
  settlement_id      uuid    NOT NULL REFERENCES core.settlement_settlement (id),
  tax_group          text    NOT NULL
    CONSTRAINT settlement_tax_group_format CHECK (tax_group ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$'),
  third_party        boolean NOT NULL,                 -- groupe collecté pour un tiers (jambe TAX_THIRD_PARTY)
  tax_paid_minor     bigint  NOT NULL,
  tax_refund_minor   bigint  NOT NULL,
  retained_tax_minor bigint  NOT NULL,
  PRIMARY KEY (settlement_id, tax_group),
  CONSTRAINT settlement_tax_line_nonneg CHECK (
    tax_paid_minor >= 0 AND tax_refund_minor >= 0 AND retained_tax_minor >= 0),
  CONSTRAINT settlement_tax_line_split CHECK (tax_refund_minor + retained_tax_minor = tax_paid_minor)
);

CREATE TABLE core.settlement_settlement_leg (
  settlement_id   uuid    NOT NULL,
  trip_id         uuid    NOT NULL,                    -- dénormalisés : portée RLS sans fonction de recherche
  segment_no      integer NOT NULL,
  org_id          uuid    NOT NULL,
  country_code    text    NOT NULL,
  leg             text    NOT NULL
    CONSTRAINT settlement_leg_valid CHECK (leg IN ('HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM')),
  kept_minor      bigint  NOT NULL
    CONSTRAINT settlement_leg_kept_nonneg CHECK (kept_minor >= 0),           -- LEG_AMOUNT_NEGATIVE
  advance_minor   bigint  NOT NULL
    CONSTRAINT settlement_leg_advance_nonneg CHECK (advance_minor >= 0),
  basis_minor     bigint  NOT NULL,                    -- état capturé (v1) ou jambe signée de la version n
  variation_minor bigint  NOT NULL,                    -- variation signée (08 E7 règle 3)
  PRIMARY KEY (settlement_id, leg),
  -- seule la jambe PLATFORM peut manquer (complément) : Kmino avance, la jambe retenue vaut 0
  CONSTRAINT settlement_leg_advance_platform CHECK (
    advance_minor = 0 OR (leg = 'PLATFORM' AND kept_minor = 0)),
  CONSTRAINT settlement_leg_variation CHECK (
    variation_minor = kept_minor - advance_minor - basis_minor),
  CONSTRAINT settlement_leg_settlement_fk FOREIGN KEY (settlement_id, trip_id, segment_no, org_id, country_code)
    REFERENCES core.settlement_settlement (id, trip_id, segment_no, org_id, country_code)
);
CREATE INDEX settlement_leg_trip_idx ON core.settlement_settlement_leg (trip_id, segment_no);
CREATE INDEX settlement_leg_org_idx ON core.settlement_settlement_leg (org_id) WHERE (leg = 'HOST');

-- Soldes par trip, segment et jambe (17 §2.9, §3.2.8) : devise du trip, jamais négatifs.
CREATE TABLE core.settlement_trip_leg_balance (
  trip_id               uuid        NOT NULL,
  segment_no            integer     NOT NULL
    CONSTRAINT trip_leg_balance_segment_beta CHECK (segment_no = 1),   -- bêta : voir settlement
  leg                   text        NOT NULL
    CONSTRAINT trip_leg_balance_leg_valid CHECK (leg IN ('HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM')),
  org_id                uuid        NOT NULL,
  country_code          text        NOT NULL,
  currency              text        NOT NULL
    CONSTRAINT trip_leg_balance_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  captured_minor        bigint      NOT NULL DEFAULT 0,
  refunded_minor        bigint      NOT NULL DEFAULT 0,
  reallocated_in_minor  bigint      NOT NULL DEFAULT 0,
  reallocated_out_minor bigint      NOT NULL DEFAULT 0,
  released_minor        bigint      NOT NULL DEFAULT 0,
  frozen                boolean     NOT NULL DEFAULT false,
  frozen_reason         text
    CONSTRAINT trip_leg_balance_frozen_reason_valid CHECK (frozen_reason IN ('CHARGEBACK', 'DISPUTE', 'CLAIM')),
  release_at            timestamptz,
  row_version           integer     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT platform.now(),
  updated_at            timestamptz NOT NULL DEFAULT platform.now(),
  PRIMARY KEY (trip_id, segment_no, leg),
  CONSTRAINT trip_leg_balance_amounts_nonneg CHECK (
    captured_minor >= 0 AND refunded_minor >= 0 AND reallocated_in_minor >= 0
    AND reallocated_out_minor >= 0 AND released_minor >= 0),
  CONSTRAINT trip_leg_balance_nonneg CHECK (
    captured_minor + reallocated_in_minor - refunded_minor - reallocated_out_minor - released_minor >= 0),
  CONSTRAINT trip_leg_balance_frozen_shape CHECK (frozen = (frozen_reason IS NOT NULL)),
  CONSTRAINT trip_leg_balance_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  CONSTRAINT trip_leg_balance_org_country_fk FOREIGN KEY (org_id, country_code)
    REFERENCES core.iam_organization (id, country_code)
);
CREATE INDEX trip_leg_balance_org_idx ON core.settlement_trip_leg_balance (org_id) WHERE (leg = 'HOST');

-- 2. Triggers de garde (sans lecture : pas de SECURITY DEFINER) -----------------------------------

CREATE FUNCTION core.settlement_guard_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION '%: un règlement n''est jamais modifié (contre-passation par version n+1)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_immutable';
END
$fn$;
REVOKE ALL ON FUNCTION core.settlement_guard_immutable() FROM PUBLIC;

CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON core.settlement_settlement
  FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON core.settlement_settlement_line
  FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON core.settlement_settlement_tax_line
  FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON core.settlement_settlement_leg
  FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement_line
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement_tax_line
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_settlement_leg
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable();

-- trip_leg_balance : aucun DELETE ; cumuls monotones (une correction est un mouvement inverse
-- explicite) ; identité de la ligne figée (17 §2.3 leg_balance_monotonic).
CREATE FUNCTION core.settlement_trip_leg_balance_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'trip_leg_balance: aucune suppression'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_leg_balance_no_delete';
  END IF;
  IF NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.segment_no IS DISTINCT FROM OLD.segment_no
     OR NEW.leg IS DISTINCT FROM OLD.leg OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.captured_minor < OLD.captured_minor OR NEW.refunded_minor < OLD.refunded_minor
     OR NEW.reallocated_in_minor < OLD.reallocated_in_minor
     OR NEW.reallocated_out_minor < OLD.reallocated_out_minor
     OR NEW.released_minor < OLD.released_minor THEN
    RAISE EXCEPTION 'trip_leg_balance: cumuls monotones, identité figée'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_leg_balance_monotonic';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.settlement_trip_leg_balance_guard() FROM PUBLIC;

CREATE TRIGGER trip_leg_balance_guard BEFORE UPDATE OR DELETE ON core.settlement_trip_leg_balance
  FOR EACH ROW EXECUTE FUNCTION core.settlement_trip_leg_balance_guard();
CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_trip_leg_balance
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
CREATE TRIGGER trip_leg_balance_no_truncate BEFORE TRUNCATE ON core.settlement_trip_leg_balance
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable();

-- 3. RLS : ENABLE + FORCE, socle migrator_all ----------------------------------------------------

ALTER TABLE core.settlement_settlement ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_settlement FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_settlement_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_settlement_line FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_settlement_tax_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_settlement_tax_line FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_settlement_leg ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_settlement_leg FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_trip_leg_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_trip_leg_balance FORCE ROW LEVEL SECURITY;

CREATE POLICY migrator_all ON core.settlement_settlement TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_settlement_line TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_settlement_tax_line TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_settlement_leg TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_trip_leg_balance TO migrator USING (true) WITH CHECK (true);

-- 4. Lectures d'app_api, par colonnes (aucune colonne d'identifiant du personnel n'existe) --------

GRANT SELECT (id, trip_id, segment_no, version, supersedes_id, org_id, country_code, currency, kind,
              engine_version, requested_reason, reason, origin, qualification, target_state,
              host_eligible, total_paid_minor, guest_refund_minor, tax_refund_minor, retained_minor,
              retained_tax_minor, host_from_guest_minor, host_compensation_minor, host_earnings_minor,
              platform_net_minor, host_penalty_minor, negative_leg, inputs, inputs_hash,
              param_snapshot_hash, created_at)
  ON core.settlement_settlement TO app_api;
GRANT SELECT (settlement_id, line_type, amount_minor, refund_minor, retained_minor)
  ON core.settlement_settlement_line TO app_api;
GRANT SELECT (settlement_id, tax_group, third_party, tax_paid_minor, tax_refund_minor, retained_tax_minor)
  ON core.settlement_settlement_tax_line TO app_api;
GRANT SELECT (settlement_id, trip_id, segment_no, org_id, country_code, leg, kept_minor, advance_minor,
              basis_minor, variation_minor)
  ON core.settlement_settlement_leg TO app_api;
GRANT SELECT (trip_id, segment_no, leg, org_id, country_code, currency, captured_minor, refunded_minor,
              reallocated_in_minor, reallocated_out_minor, released_minor, frozen, frozen_reason,
              release_at, created_at, updated_at)
  ON core.settlement_trip_leg_balance TO app_api;

-- En-tête : ADMIN et FINANCE du pays seulement (marge plateforme, pénalité, compensation). OPS et
-- SUPPORT, même sur dossier, ne lisent que les jambes (17 §2.3, RLS-23) ; voyageur et hôte : rien.
CREATE POLICY settlement_staff_read ON core.settlement_settlement FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code) OR app.has_staff_role('FINANCE', country_code)));
-- Lignes et taxes : visibles exactement quand l'en-tête l'est (sous-requête sous la RLS d'app_api).
CREATE POLICY settlement_line_read ON core.settlement_settlement_line FOR SELECT TO app_api
  USING (EXISTS (SELECT 1 FROM core.settlement_settlement AS s
                  WHERE s.id = settlement_settlement_line.settlement_id));
CREATE POLICY settlement_tax_line_read ON core.settlement_settlement_tax_line FOR SELECT TO app_api
  USING (EXISTS (SELECT 1 FROM core.settlement_settlement AS s
                  WHERE s.id = settlement_settlement_tax_line.settlement_id));
-- Jambes : hôte TITULAIRE, jambe HOST de ses trips (RLS-2, RLS-28 ; jamais un co-hôte) ; staff.
-- `app.has_permission('finance.read_org_statements')` de 17 §2.3 s'ajoutera avec US-062 : il ne
-- peut que restreindre (le titulaire a toutes les permissions de son compte).
CREATE POLICY settlement_leg_host_read ON core.settlement_settlement_leg FOR SELECT TO app_api
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id() AND leg = 'HOST'
         AND app.is_org_holder() AND app.vehicle_scope() IS NULL);
CREATE POLICY settlement_leg_staff_read ON core.settlement_settlement_leg FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code) OR app.has_staff_role('FINANCE', country_code)
              OR app.staff_case_covers('TRIP', trip_id)));
CREATE POLICY leg_host_read ON core.settlement_trip_leg_balance FOR SELECT TO app_api
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id() AND leg = 'HOST'
         AND app.is_org_holder() AND app.vehicle_scope() IS NULL);
CREATE POLICY leg_staff_read ON core.settlement_trip_leg_balance FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code) OR app.has_staff_role('FINANCE', country_code)
              OR app.staff_case_covers('TRIP', trip_id)));

-- 5. Lectures des travailleurs (liste blanche de 17 §2.3), aucune écriture ------------------------

GRANT SELECT ON core.settlement_settlement, core.settlement_settlement_line,
  core.settlement_settlement_tax_line, core.settlement_settlement_leg,
  core.settlement_trip_leg_balance TO app_worker;
CREATE POLICY worker_money_read ON core.settlement_settlement FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));
CREATE POLICY worker_money_read ON core.settlement_settlement_line FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));
CREATE POLICY worker_money_read ON core.settlement_settlement_tax_line FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));
CREATE POLICY worker_money_read ON core.settlement_settlement_leg FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));
CREATE POLICY worker_money_read ON core.settlement_trip_leg_balance FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));

-- 6. Propriétaire des commandes d'argent : droits au plus juste ----------------------------------

GRANT USAGE ON SCHEMA core, app TO cmd_money_owner;
GRANT EXECUTE ON FUNCTION app.actor_kind(), app.worker_name() TO cmd_money_owner;

-- Trip : lecture des champs de portée et verrou FOR UPDATE (qui exige un droit UPDATE sur une
-- colonne) ; toute modification réelle est refusée par WITH CHECK (false).
GRANT SELECT (id, org_id, country_code, currency, row_version) ON core.booking_trip TO cmd_money_owner;
GRANT UPDATE (row_version) ON core.booking_trip TO cmd_money_owner;
CREATE POLICY money_read ON core.booking_trip FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY money_lock ON core.booking_trip FOR UPDATE TO cmd_money_owner
  USING (true) WITH CHECK (false);

GRANT SELECT ON core.settlement_settlement, core.settlement_settlement_line,
  core.settlement_settlement_tax_line, core.settlement_settlement_leg,
  core.settlement_trip_leg_balance TO cmd_money_owner;
GRANT INSERT ON core.settlement_settlement, core.settlement_settlement_line,
  core.settlement_settlement_tax_line, core.settlement_settlement_leg TO cmd_money_owner;

-- Une politique par commande SQL ; le travailleur est contrôlé dans la politique, pas seulement
-- dans le corps de la fonction ; aucune politique UPDATE ni DELETE.
CREATE POLICY cmd_money_sel ON core.settlement_settlement FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.settlement_settlement_line FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.settlement_settlement_tax_line FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.settlement_settlement_leg FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.settlement_trip_leg_balance FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.settlement_settlement FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'settlement');
CREATE POLICY cmd_money_ins ON core.settlement_settlement_line FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'settlement');
CREATE POLICY cmd_money_ins ON core.settlement_settlement_tax_line FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'settlement');
CREATE POLICY cmd_money_ins ON core.settlement_settlement_leg FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'settlement');

-- 7. Invariants d'un règlement : trigger différé, relu à l'état final de la transaction ----------
-- SECURITY DEFINER : au COMMIT, l'appelant (app_worker) ne voit pas ces lignes sous la RLS.
CREATE FUNCTION core.settlement_assert_balanced()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s            record;
  v_trip_org   uuid;
  v_trip_cur   text;
  v_legs       integer;
  v_signed     bigint;
  v_variation  bigint;
  v_advance    bigint;
  v_basis      bigint;
  v_host       bigint;
  v_tax3       bigint;
  v_line_amt   bigint;
  v_line_ref   bigint;
  v_line_ret   bigint;
  v_tax_paid   bigint;
  v_tax_ref    bigint;
  v_tax_ret    bigint;
  v_tax3_ret   bigint;
  v_mismatch   integer;
  v_captured   integer;
  v_prev_ref   bigint;
BEGIN
  SELECT * INTO s FROM core.settlement_settlement AS x WHERE x.id = NEW.id;

  SELECT t.org_id, t.currency INTO v_trip_org, v_trip_cur
    FROM core.booking_trip AS t WHERE t.id = s.trip_id;
  IF v_trip_org IS DISTINCT FROM s.org_id OR v_trip_cur IS DISTINCT FROM s.currency THEN
    RAISE EXCEPTION 'settlement %: compte d''hôte ou devise différents du trip', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_mismatch';
  END IF;

  -- remboursement de la version remplacée : Σ variations = − (remboursement v n+1 − remboursement v n)
  v_prev_ref := 0;
  IF s.supersedes_id IS NOT NULL THEN
    SELECT p.guest_refund_minor INTO v_prev_ref
      FROM core.settlement_settlement AS p WHERE p.id = s.supersedes_id;
  END IF;

  SELECT count(*)::integer, COALESCE(sum(l.kept_minor - l.advance_minor), 0),
         COALESCE(sum(l.variation_minor), 0), COALESCE(sum(l.advance_minor), 0),
         COALESCE(sum(l.basis_minor), 0),
         COALESCE(sum(l.kept_minor) FILTER (WHERE l.leg = 'HOST'), 0),
         COALESCE(sum(l.kept_minor) FILTER (WHERE l.leg = 'TAX_THIRD_PARTY'), 0)
    INTO v_legs, v_signed, v_variation, v_advance, v_basis, v_host, v_tax3
    FROM core.settlement_settlement_leg AS l WHERE l.settlement_id = s.id;

  SELECT COALESCE(sum(x.amount_minor), 0), COALESCE(sum(x.refund_minor), 0),
         COALESCE(sum(x.retained_minor), 0)
    INTO v_line_amt, v_line_ref, v_line_ret
    FROM core.settlement_settlement_line AS x WHERE x.settlement_id = s.id;
  SELECT COALESCE(sum(x.tax_paid_minor), 0), COALESCE(sum(x.tax_refund_minor), 0),
         COALESCE(sum(x.retained_tax_minor), 0),
         COALESCE(sum(x.retained_tax_minor) FILTER (WHERE x.third_party), 0)
    INTO v_tax_paid, v_tax_ref, v_tax_ret, v_tax3_ret
    FROM core.settlement_settlement_tax_line AS x WHERE x.settlement_id = s.id;

  IF v_legs <> 4
     OR v_signed <> s.retained_minor + s.retained_tax_minor          -- Σ jambes = retenu TTC
     OR v_variation <> v_prev_ref - s.guest_refund_minor              -- Σ variations = − Δ remboursement
     OR v_host <> s.host_from_guest_minor                             -- HOST = hostFromGuest (E7)
     OR v_tax3 <> v_tax3_ret                                          -- TAX_THIRD_PARTY = taxe tiers retenue
     OR v_line_amt + v_tax_paid <> s.total_paid_minor                 -- lignes + taxes = total payé
     OR v_line_ref + v_tax_ref <> s.guest_refund_minor
     OR v_line_ret <> s.retained_minor
     OR v_tax_ref <> s.tax_refund_minor
     OR v_tax_ret <> s.retained_tax_minor THEN
    RAISE EXCEPTION 'settlement %: invariants de montant ou de jambe violés', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_unbalanced';
  END IF;

  IF s.negative_leg IS DISTINCT FROM (v_advance > 0) THEN
    RAISE EXCEPTION 'settlement %: drapeau negative_leg incohérent avec les avances', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_negative_leg_flag';
  END IF;

  -- Base de la variation : version n (supersession) ou état capturé (v1).
  SELECT count(*)::integer INTO v_captured
    FROM core.settlement_trip_leg_balance AS b
   WHERE b.trip_id = s.trip_id AND b.segment_no = s.segment_no;
  IF s.supersedes_id IS NOT NULL AND v_captured = 0 THEN
    -- une requalification suppose des fonds capturés tenus par jambe (ADR-057)
    RAISE EXCEPTION 'settlement %: version n+1 sans état capturé tenu (trip_leg_balance)', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_capture_missing';
  END IF;
  IF s.supersedes_id IS NOT NULL THEN
    SELECT count(*)::integer INTO v_mismatch
      FROM core.settlement_settlement_leg AS cur
      LEFT JOIN core.settlement_settlement_leg AS prev
        ON prev.settlement_id = s.supersedes_id AND prev.leg = cur.leg
     WHERE cur.settlement_id = s.id
       AND (prev.leg IS NULL OR cur.basis_minor <> prev.kept_minor - prev.advance_minor);
  ELSE
    IF v_captured > 0 THEN
      SELECT count(*)::integer INTO v_mismatch
        FROM core.settlement_settlement_leg AS cur
        LEFT JOIN core.settlement_trip_leg_balance AS b
          ON b.trip_id = s.trip_id AND b.segment_no = s.segment_no AND b.leg = cur.leg
       WHERE cur.settlement_id = s.id
         AND (b.leg IS NULL OR cur.basis_minor <> b.captured_minor);
    ELSE
      -- état capturé calculé par le moteur : jambes ≥ 0 (E7 règle 5) et Σ = total payé.
      -- LIMITE (ADR-057) : une redistribution entre jambes passe ici ; aucun ordre autre que
      -- PLANNED sans rejeu des entrées `inputs` ni trip_leg_balance tenu (DoR US-061, 223, 224).
      SELECT count(*)::integer INTO v_mismatch
        FROM core.settlement_settlement_leg AS cur
       WHERE cur.settlement_id = s.id AND cur.basis_minor < 0;
      IF v_basis <> s.total_paid_minor THEN
        v_mismatch := v_mismatch + 1;
      END IF;
    END IF;
  END IF;
  IF v_mismatch > 0 THEN
    RAISE EXCEPTION 'settlement %: base des variations différente de la version n ou de la capture', s.id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_basis_mismatch';
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION core.settlement_assert_balanced() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER settlement_balanced
  AFTER INSERT ON core.settlement_settlement
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.settlement_assert_balanced();

-- 8. Commande : enregistrer la version n d'un règlement -----------------------------------------
-- Appelée par le travailleur `settlement`, dans la transaction de la transition SM-1 (08 E4), avec
-- le résultat du moteur pur (ADR-054) sérialisé par `@rueda/money` (`settlementRecordPayload`,
-- format 1, montants en chaînes d'entiers). Les montants viennent du moteur et sont recontrôlés
-- ici et par `settlement_balanced` ; la portée (compte d'hôte, pays, devise) est relue du trip.
CREATE FUNCTION core.settlement_cmd_record(
  p_settlement_id    uuid,
  p_trip_id          uuid,
  p_segment_no       integer,
  p_version          integer,
  p_supersedes_id    uuid,
  p_trip_row_version integer,
  p_record           jsonb
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_org          uuid;
  v_country      text;
  v_currency     text;
  v_row_version  integer;
  v_head_id      uuid;
  v_head_version integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS DISTINCT FROM 'settlement' THEN
    RAISE EXCEPTION 'settlement_cmd_record : réservé au travailleur settlement'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_record IS NULL OR pg_catalog.jsonb_typeof(p_record) IS DISTINCT FROM 'object'
     OR (p_record ->> 'format') IS DISTINCT FROM '1'
     OR pg_catalog.jsonb_typeof(p_record -> 'lines') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(p_record -> 'taxGroups') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_typeof(p_record -> 'legs') IS DISTINCT FROM 'array'
     OR p_segment_no IS NULL OR p_version IS NULL THEN
    RAISE EXCEPTION 'settlement_cmd_record : charge utile invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Bêta : un seul segment par trip (voir la colonne segment_no)
  IF p_segment_no <> 1 THEN
    RAISE EXCEPTION 'settlement_cmd_record : segment % hors bêta', p_segment_no
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_segment_unsupported';
  END IF;

  -- les invariants sont contrôlés après l'insertion complète, dans cet appel
  SET CONSTRAINTS core.settlement_balanced DEFERRED;

  -- 08 E4 : verrou du trip et contrôle optimiste de sa version
  SELECT t.org_id, t.country_code, t.currency, t.row_version
    INTO v_org, v_country, v_currency, v_row_version
    FROM core.booking_trip AS t
   WHERE t.id = p_trip_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement_cmd_record : trip inconnu'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_unknown';
  END IF;
  IF v_row_version IS DISTINCT FROM p_trip_row_version THEN
    RAISE EXCEPTION 'settlement_cmd_record : trip modifié depuis le calcul'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_version';
  END IF;
  IF (p_record ->> 'currency') IS DISTINCT FROM v_currency THEN
    RAISE EXCEPTION 'settlement_cmd_record : devise différente du trip'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_trip_mismatch';
  END IF;

  -- 08 règle de qualification 5 : la version n existe déjà ⇒ 409 SETTLEMENT_EXISTS
  SELECT s.id, s.version INTO v_head_id, v_head_version
    FROM core.settlement_settlement AS s
   WHERE s.trip_id = p_trip_id AND s.segment_no = p_segment_no
   ORDER BY s.version DESC
   LIMIT 1;
  IF p_version <= COALESCE(v_head_version, 0) THEN
    RAISE EXCEPTION 'settlement_cmd_record : version % déjà réglée', p_version
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_version_taken';
  END IF;
  IF p_version <> COALESCE(v_head_version, 0) + 1 OR p_supersedes_id IS DISTINCT FROM v_head_id THEN
    RAISE EXCEPTION 'settlement_cmd_record : la version n+1 remplace exactement la dernière version'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'settlement_supersession_invalid';
  END IF;

  INSERT INTO core.settlement_settlement
         (id, trip_id, segment_no, version, supersedes_id, org_id, country_code, currency, kind,
          engine_version, requested_reason, reason, origin, qualification, target_state,
          host_eligible, total_paid_minor, guest_refund_minor, tax_refund_minor, retained_minor,
          retained_tax_minor, host_from_guest_minor, host_compensation_minor, host_earnings_minor,
          platform_net_minor, host_penalty_minor, negative_leg, inputs, inputs_hash,
          param_snapshot_hash)
  VALUES (p_settlement_id, p_trip_id, p_segment_no, p_version, p_supersedes_id, v_org, v_country,
          v_currency, p_record ->> 'kind', p_record ->> 'engineVersion',
          p_record ->> 'requestedReason', p_record ->> 'reason', p_record ->> 'origin',
          p_record ->> 'qualification', p_record ->> 'targetState',
          (p_record ->> 'hostEligible')::boolean,
          (p_record ->> 'totalPaidMinor')::bigint, (p_record ->> 'guestRefundMinor')::bigint,
          (p_record ->> 'taxRefundMinor')::bigint, (p_record ->> 'retainedMinor')::bigint,
          (p_record ->> 'retainedTaxMinor')::bigint, (p_record ->> 'hostFromGuestMinor')::bigint,
          (p_record ->> 'hostCompensationMinor')::bigint, (p_record ->> 'hostEarningsMinor')::bigint,
          (p_record ->> 'platformNetMinor')::bigint, (p_record ->> 'hostPenaltyMinor')::bigint,
          (p_record ->> 'negativeLeg')::boolean, p_record ->> 'inputs',
          pg_catalog.decode(p_record ->> 'inputsHash', 'hex'),
          pg_catalog.decode(p_record ->> 'paramSnapshotHash', 'hex'));

  INSERT INTO core.settlement_settlement_line
         (settlement_id, line_type, amount_minor, refund_minor, retained_minor)
  SELECT p_settlement_id, e ->> 'line', (e ->> 'amountMinor')::bigint, (e ->> 'refundMinor')::bigint,
         (e ->> 'retainedMinor')::bigint
    FROM pg_catalog.jsonb_array_elements(p_record -> 'lines') AS e;

  INSERT INTO core.settlement_settlement_tax_line
         (settlement_id, tax_group, third_party, tax_paid_minor, tax_refund_minor, retained_tax_minor)
  SELECT p_settlement_id, e ->> 'groupId', (e ->> 'thirdParty')::boolean,
         (e ->> 'taxPaidMinor')::bigint, (e ->> 'taxRefundMinor')::bigint,
         (e ->> 'retainedTaxMinor')::bigint
    FROM pg_catalog.jsonb_array_elements(p_record -> 'taxGroups') AS e;

  INSERT INTO core.settlement_settlement_leg
         (settlement_id, trip_id, segment_no, org_id, country_code, leg, kept_minor, advance_minor,
          basis_minor, variation_minor)
  SELECT p_settlement_id, p_trip_id, p_segment_no, v_org, v_country, e ->> 'leg',
         (e ->> 'keptMinor')::bigint, (e ->> 'advanceMinor')::bigint, (e ->> 'basisMinor')::bigint,
         (e ->> 'variationMinor')::bigint
    FROM pg_catalog.jsonb_array_elements(p_record -> 'legs') AS e;

  SET CONSTRAINTS core.settlement_balanced IMMEDIATE;
  RETURN p_settlement_id;
END
$fn$;

COMMENT ON FUNCTION core.settlement_cmd_record(uuid, uuid, integer, integer, uuid, integer, jsonb) IS
  'Enregistre la version n d''un règlement (08 E4, E7 ; 17 §2.9) : travailleur settlement seulement. US-018.';

REVOKE ALL ON FUNCTION core.settlement_cmd_record(uuid, uuid, integer, integer, uuid, integer, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.settlement_cmd_record(uuid, uuid, integer, integer, uuid, integer, jsonb)
  TO app_worker;

-- 9. Cession des deux fonctions SECURITY DEFINER à cmd_money_owner (amendement d'ADR-044) --------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.settlement_assert_balanced() OWNER TO cmd_money_owner;
ALTER FUNCTION core.settlement_cmd_record(uuid, uuid, integer, integer, uuid, integer, jsonb)
  OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
