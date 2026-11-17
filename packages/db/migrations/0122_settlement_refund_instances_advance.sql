-- 0122 — PAY / STL : instance de remboursement (SM-8), avance de Kmino sur une jambe déjà versée,
-- décision FINANCE à deux personnes rejugée à l'approbation, versement borné à l'enregistrement.
-- US-224 (partie 224b, argent / back-end) ; 19 US-224 (critères 1 et 4, notes techniques) ;
-- 16 PAY-021 ; 08 E1, E4, E7 (règles 3 bis, 5, 6), SM-8, BR-PAY-08 ; 17 v6 §2.8, §2.9 (avance de
-- Kmino, règles 1 et 2), §3.2.7 (`refund_instance`), §3.2.8 (`platform_advance`), §4.3 ; ADR-145 ;
-- ADR-147 (cette migration). Suites du BOARD : S-03 (avance TJ18b), N-13 (a) (ordre PLANNED),
-- N-119 (FINANCE), suites des revues de la PR #198 (LEG_RELEASE borné, surcharge à 13 arguments).
-- Appliquée sous `migrator`, en une transaction. Générée en partie : corps de 0036
-- (`settlement_platform_advance_guard`), 0097 (actions FINANCE) et 0116
-- (`settlement_cmd_apply_leg_movement`) recopiés à l'identique, blocs marqués « US-224b ».
--
-- Cette migration :
--   1. `core.payment_refund_instance` (SM-8) : une instance par (règlement, opération remboursée,
--      `instance_seq`), exécutant `PLATFORM_API` seulement, rail natif en bêta, crédit cash refusé
--      tant que `funds_holding_enabled[pays]` = false, jambes demandées et ordre `REFUND` PENDING
--      créés ensemble sous le verrou du trip (17 §4.3 point 1) ; `PLANNED` → `SUBMITTED` (envoi
--      autorisé) ou `SUPERSEDED` (version n+1, déclencheur sur `settlement_settlement`) ; aucun
--      autre état n'a encore d'écrivain (fail-closed) ;
--   2. avance de Kmino (08 E7 règle 3 bis, TJ18b / TJ18d) : la part `HOST` d'un remboursement qui
--      dépasse ce que la jambe a encore (déjà versée à l'hôte) est portée sur `PLATFORM` ; une
--      `platform_advance` `PLANNED` (créance de l'hôte, cause `RELEASED_LEG`, financée par le solde
--      `PLATFORM` du pays) est créée avec l'instance ; l'envoi est BLOQUÉ (`ADVANCE_CAP_UNSET`,
--      `HOST_ADVANCE_CAP`, `PLATFORM_BALANCE_UNKNOWN`) jusqu'à la décision FINANCE à deux personnes
--      (`DECIDE_ADVANCE`) ; l'avance devient `OPEN` au report du remboursement ; le remboursement du
--      voyageur n'est jamais réduit ;
--   3. garde à l'enregistrement (`payment_assert_settlement_order`, 0121) : état des jambes commun
--      (`payment_trip_leg_state`) ; ordres d'une instance remplacée hors des en-cours ; part avancée
--      comptée pour `HOST`, jamais pour `PLATFORM` ; avance ≤ jambe `HOST` versée ; `LEG_RELEASE`
--      borné par l'encaissé de chaque jambe, en-cours compris, et par la jambe retenue de la version
--      en tête (suite des revues de la PR #198) ;
--   4. report sur les soldes (`settlement_cmd_apply_leg_movement`, corps de 0116) : même partage de
--      la part avancée ; l'avance passe `OPEN` ;
--   5. actions FINANCE (corps de 0097) : `DECIDE_ADVANCE` admis sur une avance `PLANNED` ; le conflit
--      du demandeur est rejugé à l'approbation (N-119) ;
--   6. retrait de `core.payment_cmd_record_operation` à 13 arguments (aucun appelant de production).
--
-- Hors de cette migration (passation docs/team/handoffs/US-224.md, partie 224c) : écran S10 et
-- lecture du remboursement par le voyageur et l'hôte, hôte défaillant (BR-TRUST-09), file ops sur
-- MISMATCH (N-196, première phrase), états SM-8 au-delà de SUBMITTED, annulation remboursée avec
-- US-215 (N-131, N-201, GL-21).
--
-- Expand / contract : une table, cinq fonctions et trois déclencheurs AJOUTÉS ; un CHECK élargi
-- (états PLANNED / CANCELLED d'une avance), deux politiques recréées sous leur nom (insertion
-- resserrée : aucune avance RELEASED_LEG créée OPEN), une vue recréée (mêmes colonnes) ; corps de
-- six fonctions remplacés à signature, propriétaire et droits identiques ; une surcharge retirée
-- (dérogation inscrite dans expand-contract-allowlist.json).
--
-- Retour arrière :
--   réappliquer les définitions de 0036 (settlement_platform_advance_guard, host_advance_v, politiques
--   cmd_money_ins / cmd_advance_upd de l'avance, CHECK platform_advance_status_valid), de 0097
--   (actions FINANCE), de 0116 (settlement_cmd_apply_leg_movement), de 0121
--   (payment_assert_settlement_order et la commande à 13 arguments, sous cmd_money_owner) ;
--   DROP TRIGGER refund_instance_supersede ON core.settlement_settlement;
--   DROP TRIGGER refund_instance_gate ON core.payment_payment_operation;
--   DROP FUNCTION core.payment_cmd_plan_refund(uuid, uuid, uuid, uuid, integer, text, jsonb, text, text),
--     core.payment_cmd_submit_refund(uuid), core.payment_refund_advance_block(uuid),
--     core.payment_trip_leg_state(uuid), core.payment_refund_instance_gate(),
--     core.payment_refund_instance_supersede(), core.payment_refund_instance_guard();
--   DROP TABLE core.payment_refund_instance;
--   DROP POLICY cmd_money_advance_cap_read ON core.config_param_value;
--   REVOKE INSERT (status) ON core.settlement_platform_advance FROM cmd_money_owner.

-- 1. Instance de remboursement (SM-8, 17 §3.2.7) ------------------------------------------------
CREATE TABLE core.payment_refund_instance (
  id                    uuid        PRIMARY KEY,
  origin_type           text        NOT NULL
    CONSTRAINT refund_instance_origin_valid CHECK (origin_type IN
      ('SETTLEMENT', 'DEPOSIT', 'DAMAGE_OVERCHARGE', 'INCIDENTAL_REVISION', 'HOLD_COMPENSATION')),
  origin_id             uuid        NOT NULL,
  settlement_id         uuid,
  settlement_version    integer,
  trip_id               uuid        NOT NULL,
  country_code          text        NOT NULL
    CONSTRAINT refund_instance_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency              text        NOT NULL
    CONSTRAINT refund_instance_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  refunded_operation_id uuid        NOT NULL
    CONSTRAINT refund_instance_refunded_operation_fk REFERENCES core.payment_payment_operation (id),
  instance_seq          integer     NOT NULL
    CONSTRAINT refund_instance_seq_positive CHECK (instance_seq >= 1),
  attempt_no            integer     NOT NULL DEFAULT 1
    CONSTRAINT refund_instance_attempt_positive CHECK (attempt_no >= 1),
  -- révision P2P (US-055) : Kmino ordonne tout remboursement au PSP, jamais un tiers
  executor              text        NOT NULL DEFAULT 'PLATFORM_API'
    CONSTRAINT refund_instance_executor_platform CHECK (executor = 'PLATFORM_API'),
  rail                  text        NOT NULL
    CONSTRAINT refund_instance_rail_valid CHECK (rail IN
      ('NATIVE_PARTIAL', 'ROLLBACK_AND_RECHARGE', 'BANK_TRANSFER', 'CREDIT_CASH')),
  -- jambes demandées par le règlement (`settlementOrders`), entiers en texte ; l'ordre envoyé au
  -- PSP (jambes de `payment_operation_leg`) en diffère par la part avancée (règle 3 bis)
  requested_legs        jsonb       NOT NULL,
  amount_trip_minor     bigint      NOT NULL
    CONSTRAINT refund_instance_amount_positive CHECK (amount_trip_minor > 0),
  operation_id          uuid        NOT NULL,
  advance_id            uuid
    CONSTRAINT refund_instance_advance_fk REFERENCES core.settlement_platform_advance (id),
  status                text        NOT NULL DEFAULT 'PLANNED'
    CONSTRAINT refund_instance_status_valid CHECK (status IN
      ('PLANNED', 'BLOCKED_CHARGEBACK', 'PENDING_CUSTOMER_CHOICE', 'PENDING_BANK_DETAILS',
       'SUBMITTED', 'SENT', 'CONFIRMED', 'FAILED', 'CREDITED', 'CANCELLED', 'SUPERSEDED')),
  blocked_reason        text
    CONSTRAINT refund_instance_blocked_reason_valid CHECK (blocked_reason IN
      ('ADVANCE_CAP_UNSET', 'HOST_ADVANCE_CAP', 'PLATFORM_BALANCE_UNKNOWN')),
  issued_at             timestamptz,
  created_at            timestamptz NOT NULL DEFAULT platform.now(),
  updated_at            timestamptz NOT NULL DEFAULT platform.now(),
  row_version           integer     NOT NULL DEFAULT 0,
  -- bêta : seules les instances d'un règlement ont un écrivain (caution, dommages, frais annexes et
  -- compensation d'un hold : US-225, lot 5, US-024)
  CONSTRAINT refund_instance_origin_beta CHECK (origin_type = 'SETTLEMENT'),
  CONSTRAINT refund_instance_settlement_shape CHECK (
    (origin_type = 'SETTLEMENT') = (settlement_id IS NOT NULL)
    AND (settlement_id IS NULL) = (settlement_version IS NULL)
    AND (settlement_id IS NULL OR origin_id = settlement_id)),
  CONSTRAINT refund_instance_blocked_shape CHECK (
    blocked_reason IS NULL OR (status = 'PLANNED' AND advance_id IS NOT NULL)),
  -- date d'émission (BR-PAY-08 : jamais une date de réception) posée à l'envoi autorisé
  CONSTRAINT refund_instance_issued_shape CHECK (
    (status NOT IN ('PLANNED', 'SUPERSEDED') OR issued_at IS NULL)
    AND (status NOT IN ('SUBMITTED', 'SENT', 'CONFIRMED') OR issued_at IS NOT NULL)),
  CONSTRAINT refund_instance_key UNIQUE (origin_type, origin_id, refunded_operation_id, instance_seq),
  CONSTRAINT refund_instance_operation_unique UNIQUE (operation_id),
  -- l'instance est écrite avant son ordre (la garde de l'ordre lit son avance) : contrôle au COMMIT
  CONSTRAINT refund_instance_operation_fk FOREIGN KEY (operation_id)
    REFERENCES core.payment_payment_operation (id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT refund_instance_settlement_fk FOREIGN KEY (settlement_id, trip_id, settlement_version)
    REFERENCES core.settlement_settlement (id, trip_id, version),
  CONSTRAINT refund_instance_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code)
);
CREATE INDEX refund_instance_trip_idx ON core.payment_refund_instance (trip_id);
CREATE INDEX refund_instance_advance_idx ON core.payment_refund_instance (advance_id)
  WHERE advance_id IS NOT NULL;
COMMENT ON TABLE core.payment_refund_instance IS
  'PAY refund_instance (SM-8, 17 §3.2.7) : remboursement ordonné par Kmino, jambes demandées, ordre '
  'REFUND et avance éventuelle (règle 3 bis). US-224 (224b), ADR-147.';

-- Garde (tous rôles) : création PLANNED seulement, crédit cash fermé tant que
-- funds_holding_enabled[pays] = false (17 §3.2.7) ; identité figée ; transitions de 224b seulement.
CREATE FUNCTION core.payment_refund_instance_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' OR NEW.issued_at IS NOT NULL THEN
      RAISE EXCEPTION 'refund_instance: created PLANNED only'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'refund_instance_transition';
    END IF;
    IF NEW.rail = 'CREDIT_CASH' AND NOT core.config_go_live('funds_holding_enabled', NEW.country_code) THEN
      RAISE EXCEPTION 'refund_instance: cash credit closed while funds holding is disabled'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_credit_cash_closed';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.origin_type IS DISTINCT FROM OLD.origin_type
     OR NEW.origin_id IS DISTINCT FROM OLD.origin_id OR NEW.settlement_id IS DISTINCT FROM OLD.settlement_id
     OR NEW.settlement_version IS DISTINCT FROM OLD.settlement_version
     OR NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.refunded_operation_id IS DISTINCT FROM OLD.refunded_operation_id
     OR NEW.instance_seq IS DISTINCT FROM OLD.instance_seq OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
     OR NEW.executor IS DISTINCT FROM OLD.executor OR NEW.rail IS DISTINCT FROM OLD.rail
     OR NEW.requested_legs IS DISTINCT FROM OLD.requested_legs
     OR NEW.amount_trip_minor IS DISTINCT FROM OLD.amount_trip_minor
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.advance_id IS DISTINCT FROM OLD.advance_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.issued_at IS NOT NULL AND NEW.issued_at IS DISTINCT FROM OLD.issued_at) THEN
    RAISE EXCEPTION 'refund_instance: identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'refund_instance_immutable';
  END IF;
  IF NOT ((OLD.status = 'PLANNED' AND NEW.status IN ('PLANNED', 'SUBMITTED', 'SUPERSEDED'))
          OR (OLD.status = NEW.status AND NEW.blocked_reason IS NOT DISTINCT FROM OLD.blocked_reason
              AND NEW.issued_at IS NOT DISTINCT FROM OLD.issued_at)) THEN
    RAISE EXCEPTION 'refund_instance: transition % -> % refused', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'refund_instance_transition';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_refund_instance_guard() FROM PUBLIC;

CREATE TRIGGER refund_instance_guard BEFORE INSERT OR UPDATE ON core.payment_refund_instance
  FOR EACH ROW EXECUTE FUNCTION core.payment_refund_instance_guard();
CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_refund_instance
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
CREATE TRIGGER money_no_delete BEFORE DELETE ON core.payment_refund_instance
  FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.payment_refund_instance
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete();

ALTER TABLE core.payment_refund_instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_refund_instance FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payment_refund_instance TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.payment_refund_instance FROM PUBLIC;

-- lectures : FINANCE / ADMIN du pays (17 §2.3 « tables financières ») ; travailleurs d'argent.
-- Voyageur, hôte, ops : par les lectures de l'écran S10 (224c), jamais par la table.
GRANT SELECT ON core.payment_refund_instance TO app_api, app_worker;
CREATE POLICY fin_read ON core.payment_refund_instance FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));
CREATE POLICY worker_money_read ON core.payment_refund_instance FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'reconciliation'));

-- commandes (cmd_money_owner) : création par payment_command ; envoi autorisé par payment_command ;
-- supersession par le travailleur settlement (déclencheur de settlement_cmd_record)
GRANT SELECT ON core.payment_refund_instance TO cmd_money_owner;
GRANT INSERT (id, origin_type, origin_id, settlement_id, settlement_version, trip_id, country_code,
              currency, refunded_operation_id, instance_seq, rail, requested_legs, amount_trip_minor,
              operation_id, advance_id, blocked_reason)
  ON core.payment_refund_instance TO cmd_money_owner;
GRANT UPDATE (status, blocked_reason, issued_at) ON core.payment_refund_instance TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.payment_refund_instance FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.payment_refund_instance FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND status = 'PLANNED');
CREATE POLICY cmd_money_upd ON core.payment_refund_instance FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('settlement', 'payment_command'))
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('settlement', 'payment_command'));

-- garde du statut de l'ordre (integrity_owner, ci-dessous) : statut et ordre seulement
GRANT SELECT (operation_id, status) ON core.payment_refund_instance TO integrity_owner;
CREATE POLICY integrity_read ON core.payment_refund_instance FOR SELECT TO integrity_owner
  USING (true);

-- 2. Avance de Kmino : états PLANNED (aucun fonds) et CANCELLED (remplacée) ----------------------
ALTER TABLE core.settlement_platform_advance
  DROP CONSTRAINT platform_advance_status_valid,
  ADD CONSTRAINT platform_advance_status_valid CHECK (status IN
    ('PLANNED', 'OPEN', 'RECOVERING', 'RECOVERED', 'WRITTEN_OFF', 'CANCELLED'));

-- garde (corps de 0036 recopié ; blocs marqués US-224b)
CREATE OR REPLACE FUNCTION core.settlement_platform_advance_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.insurer_id IS DISTINCT FROM OLD.insurer_id
     OR NEW.cause IS DISTINCT FROM OLD.cause OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.funded_from IS DISTINCT FROM OLD.funded_from
     OR NEW.receivable_minor IS DISTINCT FROM OLD.receivable_minor
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.recovered_minor < OLD.recovered_minor
     OR (OLD.status IN ('RECOVERED', 'WRITTEN_OFF') AND NEW.status IS DISTINCT FROM OLD.status)
     OR (OLD.status = 'RECOVERING' AND NEW.status = 'OPEN')
     -- US-224b : PLANNED (avance attendue, aucun fonds) -> OPEN | CANCELLED ; CANCELLED final
     OR (NEW.status = 'PLANNED' AND OLD.status <> 'PLANNED')
     OR (NEW.status = 'CANCELLED' AND OLD.status NOT IN ('PLANNED', 'CANCELLED'))
     OR (OLD.status = 'CANCELLED' AND NEW.status IS DISTINCT FROM OLD.status)
     OR (OLD.status IN ('PLANNED', 'CANCELLED') AND NEW.recovered_minor <> 0)
     OR (OLD.status IN ('RECOVERED', 'WRITTEN_OFF') AND NEW.recovered_minor IS DISTINCT FROM OLD.recovered_minor)
     OR (OLD.decided_by IS NOT NULL
         AND (NEW.decided_by, NEW.decision_second_by, NEW.decision_approval_id)
             IS DISTINCT FROM (OLD.decided_by, OLD.decision_second_by, OLD.decision_approval_id))
     OR (OLD.written_off_by IS NOT NULL
         AND (NEW.written_off_by, NEW.write_off_second_by, NEW.write_off_approval_id, NEW.written_off_at)
             IS DISTINCT FROM (OLD.written_off_by, OLD.write_off_second_by, OLD.write_off_approval_id,
                               OLD.written_off_at)) THEN
    RAISE EXCEPTION 'platform_advance: identité figée, transition ou recouvrement invalide'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'advance_transition_guard';
  END IF;
  IF (OLD.decided_by IS NULL AND NEW.decided_by IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM core.settlement_finance_approval AS f
                       WHERE f.id = NEW.decision_approval_id AND f.action = 'DECIDE_ADVANCE'
                         AND f.subject_id = NEW.id AND f.status = 'APPROVED'
                         AND f.requested_by = NEW.decided_by AND f.approved_by = NEW.decision_second_by))
     OR (OLD.written_off_by IS NULL AND NEW.written_off_by IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM core.settlement_finance_approval AS f
                          WHERE f.id = NEW.write_off_approval_id AND f.action = 'WRITE_OFF_RECEIVABLE'
                            AND f.subject_id = NEW.id AND f.status = 'APPROVED'
                            AND f.requested_by = NEW.written_off_by
                            AND f.approved_by = NEW.write_off_second_by)) THEN
    RAISE EXCEPTION 'platform_advance: décision FINANCE sans demande approuvée par deux personnes'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'advance_two_person_rule';
  END IF;
  -- US-224b (08 E7 règle 3 bis, 17 §2.9 règles 1 et 2) : une avance de Kmino sur une jambe déjà
  -- versée ne devient effective (OPEN, créance de l'hôte) qu'après la décision FINANCE à deux
  -- personnes : solde PLATFORM du pays non lu en bêta, plafond par hôte
  IF OLD.status = 'PLANNED' AND NEW.status = 'OPEN' AND NEW.decided_by IS NULL THEN
    RAISE EXCEPTION 'platform_advance: avance sans décision FINANCE à deux personnes'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'advance_decision_required';
  END IF;
  RETURN NEW;
END
$fn$;

-- créance visible de l'hôte titulaire : une avance effective seulement (jamais PLANNED ni CANCELLED)
CREATE OR REPLACE VIEW core.settlement_host_advance_v WITH (security_invoker = true) AS
  SELECT a.id, a.trip_id, a.country_code, a.currency, a.amount_minor, a.receivable_minor,
         a.recovered_minor, a.receivable_minor - a.recovered_minor AS outstanding_minor,
         a.status, a.created_at
    FROM core.settlement_platform_advance AS a
   WHERE a.cause = 'RELEASED_LEG' AND a.status NOT IN ('PLANNED', 'CANCELLED');

GRANT INSERT (status) ON core.settlement_platform_advance TO cmd_money_owner;
-- avance créée PLANNED par l'instance de remboursement (payment_command), jamais OPEN pour une
-- jambe versée (la décision FINANCE précède) ; les autres causes (US-709) restent créées OPEN
DROP POLICY cmd_money_ins ON core.settlement_platform_advance;
CREATE POLICY cmd_money_ins ON core.settlement_platform_advance FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('settlement', 'payout', 'payment_command')
              AND recovered_minor = 0 AND decided_by IS NULL AND written_off_by IS NULL
              AND (status = 'PLANNED' OR (status = 'OPEN' AND cause <> 'RELEASED_LEG')));
-- cmd_advance_upd (0036) : mêmes règles, états PLANNED / CANCELLED en plus ; un travailleur ne
-- décide jamais ni ne passe en perte ; le staff décide (commande d'approbation) dans son pays
DROP POLICY cmd_advance_upd ON core.settlement_platform_advance;
CREATE POLICY cmd_advance_upd ON core.settlement_platform_advance FOR UPDATE TO cmd_money_owner
  USING ((app.actor_kind() = 'WORKER'
          AND app.worker_name() IN ('settlement', 'payout', 'payment_command')
          AND status IN ('PLANNED', 'OPEN', 'RECOVERING'))
      OR (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
          AND status IN ('PLANNED', 'OPEN', 'RECOVERING')))
  WITH CHECK ((app.actor_kind() = 'WORKER'
               AND app.worker_name() IN ('settlement', 'payout', 'payment_command')
               AND status IN ('PLANNED', 'OPEN', 'RECOVERING', 'RECOVERED', 'CANCELLED')
               AND written_off_by IS NULL)
           OR (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
               AND status IN ('PLANNED', 'OPEN', 'RECOVERING', 'WRITTEN_OFF')));

-- plafond par hôte (17 §2.9 règle 2) lu par les commandes d'argent, et rien d'autre
CREATE POLICY cmd_money_advance_cap_read ON core.config_param_value FOR SELECT TO cmd_money_owner
  USING (key = 'host_advance_cap_minor');

-- 3. État des jambes d'un trip, commun à la garde et à l'instance (SECURITY INVOKER) -------------
-- Ordres de règlement non échoués du trip (en vol compris), hors ceux d'une instance remplacée ;
-- part avancée par Kmino (règle 3 bis) retirée de PLATFORM et comptée pour HOST dans les bornes du
-- règlement (remboursé, mouvement), jamais dans ses débits (la jambe HOST n'est pas débitée).
CREATE FUNCTION core.payment_trip_leg_state(p_trip uuid)
  RETURNS TABLE (leg text, rank integer, moved numeric, refunded numeric, pending_debit numeric,
                 pending_release numeric, available numeric, released numeric, frozen boolean,
                 variation numeric)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH legs(leg, rank) AS (
         VALUES ('HOST', 1), ('INSURER', 2), ('TAX_THIRD_PARTY', 3), ('PLATFORM', 4)),
       orders AS (
         SELECT o.id, o.kind,
                EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m
                         WHERE m.operation_id = o.id) AS applied,
                COALESCE((SELECT a.amount_minor
                            FROM core.payment_refund_instance AS i
                            JOIN core.settlement_platform_advance AS a ON a.id = i.advance_id
                           WHERE i.operation_id = o.id AND a.status <> 'CANCELLED'), 0)::numeric AS adv
           FROM core.payment_payment_operation AS o
          WHERE o.trip_id = p_trip
            AND o.kind IN ('REFUND', 'LEG_REALLOCATION', 'LEG_RELEASE')
            AND o.purpose IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION')
            AND o.status <> 'FAILED'
            AND NOT EXISTS (SELECT 1 FROM core.payment_refund_instance AS s
                             WHERE s.operation_id = o.id AND s.status = 'SUPERSEDED')),
       lines AS (
         SELECT l.leg, ord.kind, ord.applied,
                l.amount_minor::numeric
                - CASE WHEN ord.kind = 'REFUND' AND l.leg = 'PLATFORM' THEN ord.adv ELSE 0 END AS amount
           FROM orders AS ord
           JOIN core.payment_payment_operation_leg AS l ON l.operation_id = ord.id),
       mv AS (
         SELECT x.leg,
                sum(CASE x.kind WHEN 'REFUND' THEN -x.amount
                                WHEN 'LEG_REALLOCATION' THEN x.amount
                                ELSE 0 END) AS moved,
                sum(CASE WHEN x.kind = 'REFUND' THEN x.amount ELSE 0 END) AS refunded,
                sum(CASE WHEN x.applied THEN 0
                         WHEN x.kind IN ('REFUND', 'LEG_RELEASE') THEN x.amount
                         ELSE greatest(-x.amount, 0) END) AS pending_debit,
                sum(CASE WHEN NOT x.applied AND x.kind = 'LEG_RELEASE' THEN x.amount ELSE 0 END)
                  AS pending_release
           FROM lines AS x
          GROUP BY x.leg),
       adv AS (
         SELECT COALESCE(sum(ord.adv), 0) AS total FROM orders AS ord WHERE ord.kind = 'REFUND'),
       chain AS (
         SELECT sl.leg, sum(sl.variation_minor) AS variation
           FROM core.settlement_settlement_leg AS sl
          WHERE sl.trip_id = p_trip AND sl.segment_no = 1
          GROUP BY sl.leg)
  SELECT legs.leg, legs.rank,
         COALESCE(mv.moved, 0) - CASE WHEN legs.leg = 'HOST' THEN adv.total ELSE 0 END,
         COALESCE(mv.refunded, 0) + CASE WHEN legs.leg = 'HOST' THEN adv.total ELSE 0 END,
         COALESCE(mv.pending_debit, 0),
         COALESCE(mv.pending_release, 0),
         COALESCE(b.captured_minor + b.reallocated_in_minor - b.refunded_minor
                  - b.reallocated_out_minor - b.released_minor, 0)::numeric,
         COALESCE(b.released_minor, 0)::numeric,
         COALESCE(b.frozen, false),
         COALESCE(ch.variation, 0)::numeric
    FROM legs
   CROSS JOIN adv
    LEFT JOIN mv ON mv.leg = legs.leg
    LEFT JOIN chain AS ch ON ch.leg = legs.leg
    LEFT JOIN core.settlement_trip_leg_balance AS b
      ON b.trip_id = p_trip AND b.segment_no = 1 AND b.leg = legs.leg
   ORDER BY legs.rank
$fn$;
COMMENT ON FUNCTION core.payment_trip_leg_state(uuid) IS
  'État des jambes d''un trip (ordres en vol, part avancée, soldes, chaîne de versions) lu sous le '
  'verrou du trip par la garde des ordres et l''instance de remboursement. US-224 (224b), ADR-147.';
REVOKE ALL ON FUNCTION core.payment_trip_leg_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_trip_leg_state(uuid) TO cmd_money_owner;

-- Motif qui retient l'envoi d'un remboursement avancé (NULL : décision FINANCE prise). 17 §2.9 :
-- plafond par hôte absent ⇒ BLOCK ; avances ouvertes de l'hôte + celle-ci au-delà du plafond ;
-- sinon le solde PLATFORM du pays, qui n'est pas lu en bêta (FAKE) : jamais présumé suffisant.
CREATE FUNCTION core.payment_refund_advance_block(p_advance_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  a      record;
  v_cap  text;
  v_open numeric;
BEGIN
  SELECT x.id, x.org_id, x.country_code, x.currency, x.amount_minor, x.decided_by INTO a
    FROM core.settlement_platform_advance AS x WHERE x.id = p_advance_id;
  IF a.id IS NULL THEN
    RETURN 'ADVANCE_CAP_UNSET';
  END IF;
  IF a.decided_by IS NOT NULL THEN
    RETURN NULL;
  END IF;
  SELECT v.value #>> '{}' INTO v_cap
    FROM core.config_param_value AS v
   WHERE v.key = 'host_advance_cap_minor' AND v.country_code::text = a.country_code
     AND v.scope_type = 'COUNTRY' AND v.currency::text = a.currency
     AND v.valid_from <= platform.now() AND (v.valid_to IS NULL OR v.valid_to > platform.now())
   ORDER BY v.valid_from DESC
   LIMIT 1;
  IF v_cap IS NULL OR v_cap !~ '^[0-9]{1,19}$' THEN
    RETURN 'ADVANCE_CAP_UNSET';
  END IF;
  SELECT COALESCE(sum(o.receivable_minor - o.recovered_minor), 0) INTO v_open
    FROM core.settlement_platform_advance AS o
   WHERE o.org_id = a.org_id AND o.currency = a.currency AND o.cause = 'RELEASED_LEG'
     AND o.status IN ('OPEN', 'RECOVERING');
  IF v_open + a.amount_minor > v_cap::numeric THEN
    RETURN 'HOST_ADVANCE_CAP';
  END IF;
  RETURN 'PLATFORM_BALANCE_UNKNOWN';
END
$fn$;
COMMENT ON FUNCTION core.payment_refund_advance_block(uuid) IS
  'Motif de blocage d''une avance de Kmino non décidée (plafond par hôte, solde PLATFORM du pays '
  'non lu en bêta) ; NULL après la décision FINANCE à deux personnes. US-224 (224b), ADR-147.';
REVOKE ALL ON FUNCTION core.payment_refund_advance_block(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_refund_advance_block(uuid) TO cmd_money_owner;

-- 4. Garde d'un ordre de règlement (corps de 0121 réécrit ; blocs marqués US-224b) ---------------
CREATE OR REPLACE FUNCTION core.payment_assert_settlement_order(p_operation_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip     uuid;
  v_kind     text;
  v_stl      uuid;
  v_version  integer;
  v_refund   bigint;
  v_negative boolean;
  v_total    numeric := 0;
  v_debit    numeric;
  v_credit   numeric;
  v_take     numeric;
  r          record;
  v_legs     text[] := ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'];
  v_var      numeric[] := ARRAY[0, 0, 0, 0];
  v_moved    numeric[] := ARRAY[0, 0, 0, 0];
  v_expected numeric[] := ARRAY[0, 0, 0, 0];
  v_one      numeric;
  v_cap      numeric;
  i          integer;
  v_adv_this numeric := 0;
  v_adv_all  numeric := 0;
  v_released numeric := 0;
  v_platform numeric := 0;
BEGIN
  SELECT o.trip_id, o.kind, o.settlement_id, o.settlement_version
    INTO v_trip, v_kind, v_stl, v_version
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND OR v_trip IS NULL
     OR v_kind NOT IN ('REFUND', 'LEG_REALLOCATION', 'LEG_RELEASE') THEN
    RETURN;                                   -- hors ordres de règlement d'un trip
  END IF;

  -- verrou du trip : même ordre que settlement_cmd_record et settlement_cmd_apply_leg_movement ;
  -- deux ordres concurrents du même trip sont sérialisés et le second voit le premier validé
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;

  IF v_stl IS NULL THEN
    IF v_kind = 'REFUND' THEN
      RAISE EXCEPTION 'payment: refund of operation % without a settlement', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_without_settlement';
    END IF;
    -- LEG_RELEASE d'un trip qui n'a AUCUN règlement (trajet terminé sans annulation : aucun
    -- règlement de fin en bêta) : gardé par settlement_release_blocker (0054) et, US-224b, borné
    -- ci-dessous par l'encaissé de chaque jambe ; dès qu'un règlement existe, sa version en tête
    -- est exigée
    IF v_kind <> 'LEG_RELEASE'
       OR EXISTS (SELECT 1 FROM core.settlement_settlement AS s WHERE s.trip_id = v_trip) THEN
      RAISE EXCEPTION 'payment: % of operation % without a settlement', v_kind, p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'operation_settlement_required';
    END IF;
  -- S-02 : la version portée est la dernière de la chaîne (aucune version ne la remplace)
  ELSIF EXISTS (SELECT 1 FROM core.settlement_settlement AS s WHERE s.supersedes_id = v_stl) THEN
    RAISE EXCEPTION 'payment: settlement version % of operation % is superseded', v_version,
                    p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'operation_settlement_superseded';
  END IF;

  -- US-224b (suite des revues de la PR #198) : un versement est borné dès l'enregistrement par ce
  -- que la jambe a encore, en comptant les débits en vol (remboursements, autres versements), et,
  -- si le trip a un règlement, par la jambe retenue de la version en tête (cumul des versements)
  IF v_kind = 'LEG_RELEASE' THEN
    FOR r IN
      SELECT st.leg, st.pending_debit, st.pending_release, st.available, st.released, st.frozen,
             COALESCE(n.amount_minor, 0)::numeric AS amount,
             COALESCE(sl.kept_minor - sl.advance_minor, 0)::numeric AS kept
        FROM core.payment_trip_leg_state(v_trip) AS st
        LEFT JOIN core.payment_payment_operation_leg AS n
          ON n.operation_id = p_operation_id AND n.leg = st.leg
        LEFT JOIN core.settlement_settlement_leg AS sl
          ON sl.settlement_id = v_stl AND sl.leg = st.leg
       ORDER BY st.rank
    LOOP
      IF r.amount > 0 THEN
        IF r.frozen THEN
          RAISE EXCEPTION 'payment: leg % of trip % is frozen', r.leg, v_trip
            USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_frozen';
        END IF;
        IF r.pending_debit > r.available THEN
          IF r.released > 0 THEN
            RAISE EXCEPTION 'payment: leg % of trip % already released', r.leg, v_trip
              USING ERRCODE = 'object_not_in_prerequisite_state',
                    CONSTRAINT = 'leg_already_released';
          END IF;
          RAISE EXCEPTION 'payment: release of leg % of trip % exceeds its balance', r.leg, v_trip
            USING ERRCODE = 'object_not_in_prerequisite_state',
                  CONSTRAINT = 'leg_movement_exceeds_balance';
        END IF;
        IF v_stl IS NOT NULL AND r.released + r.pending_release > r.kept THEN
          RAISE EXCEPTION 'payment: releases of leg % of trip % exceed its retained amount', r.leg,
                          v_trip
            USING ERRCODE = 'object_not_in_prerequisite_state',
                  CONSTRAINT = 'leg_release_exceeds_retained';
        END IF;
      END IF;
    END LOOP;
    RETURN;
  END IF;

  SELECT s.guest_refund_minor, s.negative_leg INTO v_refund, v_negative
    FROM core.settlement_settlement AS s WHERE s.id = v_stl;
  -- 08 E7 règle 5 : jambe PLATFORM retenue négative ⇒ aucun ordre avant la décision FIN (224c) ;
  -- le remboursement n'est jamais réduit, il n'est pas encore envoyé
  IF v_negative THEN
    RAISE EXCEPTION 'payment: settlement of operation % awaits a FIN decision', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'operation_settlement_fin_review';
  END IF;

  -- 08 E7 règle 3 (revue argent #198 n° 2) : la réaffectation du règlement est passée AVANT tout
  -- remboursement, et elle est exactement celle du règlement (même règle que `settlementOrders`)
  FOR i IN 1..4 LOOP
    SELECT COALESCE(sum(sl.variation_minor), 0) INTO v_one
      FROM core.settlement_settlement_leg AS sl
     WHERE sl.trip_id = v_trip AND sl.segment_no = 1 AND sl.leg = v_legs[i];
    v_var[i] := v_one;
    SELECT COALESCE(sum(l.amount_minor), 0) INTO v_one
      FROM core.payment_payment_operation AS o
      JOIN core.payment_payment_operation_leg AS l ON l.operation_id = o.id
     WHERE o.trip_id = v_trip AND o.kind = 'LEG_REALLOCATION' AND o.status <> 'FAILED'
       AND o.purpose IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION') AND l.leg = v_legs[i];
    v_moved[i] := v_one;
  END LOOP;
  v_credit := 0;
  FOR i IN 1..4 LOOP
    IF v_var[i] > 0 THEN
      v_expected[i] := v_var[i];
      v_credit := v_credit + v_var[i];
    END IF;
  END LOOP;
  FOR i IN 1..4 LOOP
    IF v_var[i] < 0 AND v_credit > 0 THEN
      v_take := LEAST(-v_var[i], v_credit);
      v_expected[i] := -v_take;
      v_credit := v_credit - v_take;
    END IF;
  END LOOP;
  IF v_moved IS DISTINCT FROM v_expected THEN
    IF v_kind = 'LEG_REALLOCATION' THEN
      RAISE EXCEPTION 'payment: reallocation of operation % differs from the settlement', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_reallocation_mismatch';
    END IF;
    RAISE EXCEPTION 'payment: refund of operation % before the settlement reallocation', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_reallocation_pending';
  END IF;

  -- US-224b (08 E7 règle 3 bis) : part de cet ordre avancée par Kmino (instance de remboursement) ;
  -- toutes les avances du trip ne remplacent jamais plus que ce qui a été versé de la jambe HOST,
  -- et la part avancée est portée par la jambe PLATFORM de l'ordre
  IF v_kind = 'REFUND' THEN
    SELECT COALESCE(sum(a.amount_minor), 0) INTO v_adv_this
      FROM core.payment_refund_instance AS ri
      JOIN core.settlement_platform_advance AS a ON a.id = ri.advance_id
     WHERE ri.operation_id = p_operation_id AND a.status <> 'CANCELLED';
    SELECT COALESCE(sum(a.amount_minor), 0) INTO v_adv_all
      FROM core.payment_refund_instance AS ri
      JOIN core.payment_payment_operation AS o ON o.id = ri.operation_id
      JOIN core.settlement_platform_advance AS a ON a.id = ri.advance_id
     WHERE ri.trip_id = v_trip AND ri.status <> 'SUPERSEDED' AND o.status <> 'FAILED'
       AND a.status <> 'CANCELLED';
    IF v_adv_all > 0 THEN
      SELECT COALESCE(b.released_minor, 0) INTO v_released
        FROM core.settlement_trip_leg_balance AS b
       WHERE b.trip_id = v_trip AND b.segment_no = 1 AND b.leg = 'HOST';
      SELECT COALESCE(l.amount_minor, 0) INTO v_platform
        FROM core.payment_payment_operation_leg AS l
       WHERE l.operation_id = p_operation_id AND l.leg = 'PLATFORM';
      IF v_adv_all > COALESCE(v_released, 0) OR v_adv_this > COALESCE(v_platform, 0) THEN
        RAISE EXCEPTION 'payment: advance of trip % exceeds the released HOST leg', v_trip
          USING ERRCODE = 'object_not_in_prerequisite_state',
                CONSTRAINT = 'advance_exceeds_released_leg';
      END IF;
    END IF;
  END IF;

  FOR r IN
    SELECT st.leg, st.rank, st.moved, st.refunded, st.pending_debit, st.available, st.released,
           st.frozen, st.variation,
           COALESCE(n.amount_minor, 0)::numeric
           - CASE WHEN v_kind = 'REFUND' AND st.leg = 'PLATFORM' THEN v_adv_this ELSE 0 END AS amount
      FROM core.payment_trip_leg_state(v_trip) AS st
      LEFT JOIN core.payment_payment_operation_leg AS n
        ON n.operation_id = p_operation_id AND n.leg = st.leg
     ORDER BY st.rank
  LOOP
    v_debit := CASE WHEN v_kind = 'REFUND' THEN r.amount ELSE greatest(-r.amount, 0) END;
    IF v_debit > 0 THEN
      IF r.frozen THEN
        RAISE EXCEPTION 'payment: leg % of trip % is frozen', r.leg, v_trip
          USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_frozen';
      END IF;
      -- 16 PAY-021 : jamais plus que ce qui a été encaissé sur la jambe (soldes reportés, moins
      -- les débits déjà ordonnés et pas encore reportés)
      IF r.pending_debit > r.available THEN
        IF r.released > 0 THEN
          RAISE EXCEPTION 'payment: leg % of trip % already released', r.leg, v_trip
            USING ERRCODE = 'object_not_in_prerequisite_state',
                  CONSTRAINT = 'leg_already_released';
        END IF;
        RAISE EXCEPTION 'payment: debits on leg % of trip % exceed what was collected', r.leg,
                        v_trip
          USING ERRCODE = 'object_not_in_prerequisite_state',
                CONSTRAINT = 'refund_exceeds_collected';
      END IF;
    END IF;
    -- RC-2 / S-02 : mouvement cumulé de la jambe dans le sens et la limite de la variation de la
    -- chaîne de versions (08 E7 règles 1 et 3 : montant explicite par jambe, jamais de prorata) ;
    -- US-224b : la part avancée de cet ordre compte pour HOST
    IF (r.amount <> 0 OR (r.leg = 'HOST' AND v_adv_this > 0))
       AND (r.moved < LEAST(0, r.variation) OR r.moved > GREATEST(0, r.variation)) THEN
      RAISE EXCEPTION 'payment: operation % exceeds leg % of the settlement', p_operation_id, r.leg
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_exceeds_settlement';
    END IF;
    -- revue argent finale #198 : remboursement cumulé de la jambe plafonné à EXACTEMENT ce que lui
    -- donne le règlement après la réaffectation (`settlementOrders`)
    v_cap := CASE WHEN v_var[r.rank] < 0 THEN -v_var[r.rank] + v_expected[r.rank] ELSE 0 END;
    IF r.refunded > v_cap THEN
      RAISE EXCEPTION 'payment: refunds of leg % exceed the settlement', r.leg
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_exceeds_settlement';
    END IF;
    v_total := v_total + r.refunded;
  END LOOP;
  -- 08 E1 : Σ remboursé (part avancée comprise) ≤ remboursement de la version en tête
  IF v_total > v_refund THEN
    RAISE EXCEPTION 'payment: refunds of trip % exceed the settlement refund', v_trip
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_refund_exceeds_settlement';
  END IF;
END
$fn$;

-- 5. Statut d'un ordre d'instance : jamais envoyé ni prouvé avant l'envoi autorisé ---------------
-- SECURITY DEFINER sous integrity_owner (lecture de l'instance quel que soit l'écrivain du statut :
-- cmd_money_owner, cmd_hold_owner, app_worker) ; un échec (FAILED) reste possible.
CREATE FUNCTION core.payment_refund_instance_gate()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'FAILED'
     AND EXISTS (SELECT 1 FROM core.payment_refund_instance AS i
                  WHERE i.operation_id = NEW.id AND i.status IN ('PLANNED', 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'payment: operation % belongs to a refund instance not submitted', NEW.id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'refund_instance_not_submitted';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION core.payment_refund_instance_gate() IS
  'Garde : l''ordre d''une instance PLANNED ou SUPERSEDED ne change d''état que vers FAILED (SM-8). '
  'US-224 (224b), ADR-147.';
REVOKE ALL ON FUNCTION core.payment_refund_instance_gate() FROM PUBLIC;
-- déclencheur créé AVANT le transfert (CREATE TRIGGER exige EXECUTE du créateur, comme 0028)
CREATE TRIGGER refund_instance_gate BEFORE UPDATE OF status ON core.payment_payment_operation
  FOR EACH ROW EXECUTE FUNCTION core.payment_refund_instance_gate();
GRANT CREATE ON SCHEMA core TO integrity_owner;
ALTER FUNCTION core.payment_refund_instance_gate() OWNER TO integrity_owner;
REVOKE CREATE ON SCHEMA core FROM integrity_owner;

-- 6. Supersession (SM-8) : à la création de la version n+1, sous le verrou du trip pris par
-- settlement_cmd_record, les instances PLANNED (sans mouvement de fonds) passent SUPERSEDED et
-- leur avance attendue CANCELLED ; une instance SUBMITTED reste engagée.
CREATE FUNCTION core.payment_refund_instance_supersede()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE core.settlement_platform_advance AS a
     SET status = 'CANCELLED'
   WHERE a.status = 'PLANNED'
     AND a.id IN (SELECT ri.advance_id FROM core.payment_refund_instance AS ri
                   WHERE ri.trip_id = NEW.trip_id AND ri.status = 'PLANNED'
                     AND ri.advance_id IS NOT NULL);
  UPDATE core.payment_refund_instance AS ri
     SET status = 'SUPERSEDED', blocked_reason = NULL
   WHERE ri.trip_id = NEW.trip_id AND ri.status = 'PLANNED';
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_refund_instance_supersede() FROM PUBLIC;
CREATE TRIGGER refund_instance_supersede AFTER INSERT ON core.settlement_settlement
  FOR EACH ROW WHEN (NEW.supersedes_id IS NOT NULL)
  EXECUTE FUNCTION core.payment_refund_instance_supersede();

-- 7. Commandes de cmd_money_owner (ADR-044 amendé : CREATE le temps du remplacement) -------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 7.1 Planification d'un remboursement (17 §4.3 point 1) : sous le verrou du trip, l'instance
-- (jambes demandées), l'avance attendue (règle 3 bis) puis l'ordre REFUND PENDING par la commande
-- d'enregistrement (garde du règlement comprise). Rejeu au même contenu ⇒ instance existante.
CREATE FUNCTION core.payment_cmd_plan_refund(
  p_instance_id           uuid,
  p_operation_id          uuid,
  p_settlement_id         uuid,
  p_refunded_operation_id uuid,
  p_instance_seq          integer,
  p_rail                  text,
  p_legs                  jsonb,
  p_idem_plain            text,
  p_idem_sent             text
)
  RETURNS TABLE (instance_id uuid, operation_id uuid, advance_id uuid, status text,
                 blocked_reason text, replayed boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_stl      record;
  v_trip     record;
  v_src      record;
  v_prev     record;
  v_keys     text[];
  v_leg      text;
  v_value    text;
  v_req      numeric[] := ARRAY[0, 0, 0, 0];
  v_amount   numeric := 0;
  v_avail    numeric;
  v_released numeric;
  v_shift    numeric := 0;
  v_adv      uuid;
  v_block    text;
  v_legs     jsonb;
  v_replayed boolean;
  i          integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: plan_refund reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_instance_id IS NULL OR p_operation_id IS NULL OR p_settlement_id IS NULL
     OR p_refunded_operation_id IS NULL OR p_instance_seq IS NULL OR p_instance_seq < 1
     OR p_rail IS NULL
     OR p_rail NOT IN ('NATIVE_PARTIAL', 'ROLLBACK_AND_RECHARGE', 'BANK_TRANSFER', 'CREDIT_CASH') THEN
    RAISE EXCEPTION 'payment: invalid refund instance' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- jambes demandées : exactement HOST, INSURER, TAX_THIRD_PARTY, PLATFORM, entiers ≥ 0 en texte
  IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'object' THEN
    RAISE EXCEPTION 'payment: legs required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_legs) AS k;
  IF v_keys IS DISTINCT FROM ARRAY['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'] THEN
    RAISE EXCEPTION 'payment: legs must be HOST, INSURER, TAX_THIRD_PARTY, PLATFORM'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR i IN 1..4 LOOP
    v_leg := (ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'])[i];
    IF jsonb_typeof(p_legs -> v_leg) <> 'string' THEN
      RAISE EXCEPTION 'payment: leg % must be an integer string', v_leg
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_value := p_legs ->> v_leg;
    IF v_value !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'payment: leg % must be a non-negative integer string', v_leg
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_req[i] := v_value::numeric;
    v_amount := v_amount + v_req[i];
  END LOOP;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'payment: refund amount must be positive' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT s.id, s.trip_id, s.version INTO v_stl
    FROM core.settlement_settlement AS s WHERE s.id = p_settlement_id;
  IF v_stl.id IS NULL THEN
    RAISE EXCEPTION 'payment: refund instance without a known settlement'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_refund_without_settlement';
  END IF;
  -- verrou du trip AVANT toute écriture (même ordre que la garde et le report)
  SELECT t.id, t.org_id, t.country_code, t.currency INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = v_stl.trip_id FOR UPDATE;

  -- rails (E3) : bêta, remboursement natif seulement ; crédit cash fermé tant que
  -- funds_holding_enabled[pays] = false ; virement : aucune coordonnée bancaire stockée en bêta
  IF p_rail = 'CREDIT_CASH' AND NOT core.config_go_live('funds_holding_enabled', v_trip.country_code) THEN
    RAISE EXCEPTION 'payment: cash credit closed while funds holding is disabled'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_credit_cash_closed';
  END IF;
  IF p_rail IN ('BANK_TRANSFER', 'CREDIT_CASH') THEN
    RAISE EXCEPTION 'payment: refund rail % not available in beta', p_rail
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_rail_unavailable';
  END IF;

  -- rejeu : même clé (règlement, opération remboursée, rang) ⇒ même contenu exigé
  SELECT ri.id, ri.operation_id, ri.advance_id, ri.status, ri.blocked_reason, ri.rail,
         ri.requested_legs
    INTO v_prev
    FROM core.payment_refund_instance AS ri
   WHERE ri.origin_type = 'SETTLEMENT' AND ri.origin_id = p_settlement_id
     AND ri.refunded_operation_id = p_refunded_operation_id AND ri.instance_seq = p_instance_seq;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.id <> p_instance_id OR v_prev.operation_id <> p_operation_id
       OR v_prev.rail <> p_rail OR v_prev.requested_legs <> p_legs
       OR NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                       WHERE o.id = v_prev.operation_id AND o.idem_plain = p_idem_plain
                         AND o.idem_sent = p_idem_sent) THEN
      RAISE EXCEPTION 'payment: same refund instance key, different content'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'refund_instance_idempotency_conflict';
    END IF;
    RETURN QUERY SELECT v_prev.id, v_prev.operation_id, v_prev.advance_id, v_prev.status,
                        v_prev.blocked_reason, true;
    RETURN;
  END IF;

  -- opération remboursée : un encaissement réussi du loyer de ce trip (moyen et compte du PSP)
  SELECT o.id, o.psp_account_id, o.method INTO v_src
    FROM core.payment_payment_operation AS o
   WHERE o.id = p_refunded_operation_id AND o.trip_id = v_trip.id AND o.status = 'SUCCEEDED'
     AND o.kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
     AND o.purpose IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION');
  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'payment: refunded operation is not a succeeded rent collection of the trip'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'refund_instance_origin_invalid';
  END IF;

  -- 08 E7 règle 3 bis : la part HOST au-delà de ce que la jambe a encore (en-cours déduits), si la
  -- jambe a été versée à l'hôte, est portée sur PLATFORM et avancée par Kmino ; le remboursement
  -- du voyageur n'est jamais réduit
  SELECT st.available - st.pending_debit, st.released INTO v_avail, v_released
    FROM core.payment_trip_leg_state(v_trip.id) AS st WHERE st.leg = 'HOST';
  IF v_req[1] > GREATEST(COALESCE(v_avail, 0), 0) AND COALESCE(v_released, 0) > 0 THEN
    v_shift := v_req[1] - GREATEST(COALESCE(v_avail, 0), 0);
  END IF;
  v_legs := jsonb_build_object('HOST', (v_req[1] - v_shift)::text, 'INSURER', v_req[2]::text,
                               'TAX_THIRD_PARTY', v_req[3]::text,
                               'PLATFORM', (v_req[4] + v_shift)::text);
  IF v_shift > 0 THEN
    v_adv := gen_random_uuid();
    INSERT INTO core.settlement_platform_advance
           (id, country_code, currency, trip_id, org_id, cause, amount_minor, funded_from,
            receivable_minor, status)
    VALUES (v_adv, v_trip.country_code, v_trip.currency, v_trip.id, v_trip.org_id, 'RELEASED_LEG',
            v_shift::bigint, 'COUNTRY_PLATFORM_BALANCE', v_shift::bigint, 'PLANNED');
    v_block := core.payment_refund_advance_block(v_adv);
  END IF;

  INSERT INTO core.payment_refund_instance
         (id, origin_type, origin_id, settlement_id, settlement_version, trip_id, country_code,
          currency, refunded_operation_id, instance_seq, rail, requested_legs, amount_trip_minor,
          operation_id, advance_id, blocked_reason)
  VALUES (p_instance_id, 'SETTLEMENT', p_settlement_id, p_settlement_id, v_stl.version, v_trip.id,
          v_trip.country_code, v_trip.currency, p_refunded_operation_id, p_instance_seq, p_rail,
          p_legs, v_amount::bigint, p_operation_id, v_adv, v_block);

  -- ordre REFUND PENDING (jamais envoyé avant payment_cmd_submit_refund), gardé à l'enregistrement
  SELECT r.replayed INTO v_replayed
    FROM core.payment_cmd_record_operation(p_operation_id, NULL, v_trip.id, v_src.psp_account_id,
                                           v_src.method, 'REFUND', 'RENT', v_amount::bigint,
                                           v_trip.currency, 1, p_idem_plain, p_idem_sent, v_legs,
                                           p_settlement_id, v_stl.version) AS r;
  IF v_replayed THEN
    -- clé d'idempotence déjà prise par un ordre sans cette instance
    RAISE EXCEPTION 'payment: refund order key already used by another order'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'refund_instance_idempotency_conflict';
  END IF;

  RETURN QUERY SELECT p_instance_id, p_operation_id, v_adv, 'PLANNED'::text, v_block, false;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_plan_refund(uuid, uuid, uuid, uuid, integer, text, jsonb, text,
                                               text) IS
  'Planifie un remboursement (SM-8 PLANNED) : instance, avance de Kmino attendue (règle 3 bis) et '
  'ordre REFUND PENDING gardé, sous le verrou du trip. Travailleur payment_command. US-224 (224b), ADR-147.';
REVOKE ALL ON FUNCTION core.payment_cmd_plan_refund(uuid, uuid, uuid, uuid, integer, text, jsonb,
                                                  text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_cmd_plan_refund(uuid, uuid, uuid, uuid, integer, text, jsonb,
                                                     text, text) TO app_worker;

-- 7.2 Envoi autorisé (SM-8 PLANNED → SUBMITTED) : version en tête, avance décidée par deux
-- personnes s'il y en a une ; sinon BLOCKED avec son motif (alerte FIN par l'appelant).
CREATE FUNCTION core.payment_cmd_submit_refund(p_instance_id uuid)
  RETURNS TABLE (outcome text, blocked_reason text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_trip  uuid;
  v_i     record;
  v_block text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: submit_refund reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_instance_id IS NULL THEN
    RAISE EXCEPTION 'payment: refund instance required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT ri.trip_id INTO v_trip FROM core.payment_refund_instance AS ri WHERE ri.id = p_instance_id;
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'payment: unknown refund instance'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_instance_unknown';
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  -- relu SOUS le verrou du trip (une version n+1 a pu la remplacer pendant l'attente)
  SELECT ri.status, ri.settlement_id, ri.advance_id INTO v_i
    FROM core.payment_refund_instance AS ri WHERE ri.id = p_instance_id;
  IF v_i.status = 'SUPERSEDED' THEN
    RETURN QUERY SELECT 'SUPERSEDED'::text, NULL::text;
    RETURN;
  END IF;
  IF v_i.status <> 'PLANNED' THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, NULL::text;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.settlement_settlement AS s WHERE s.supersedes_id = v_i.settlement_id) THEN
    RAISE EXCEPTION 'payment: settlement of refund instance % is superseded', p_instance_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'operation_settlement_superseded';
  END IF;
  IF v_i.advance_id IS NOT NULL THEN
    v_block := core.payment_refund_advance_block(v_i.advance_id);
    IF v_block IS NOT NULL THEN
      UPDATE core.payment_refund_instance AS ri SET blocked_reason = v_block
       WHERE ri.id = p_instance_id AND ri.blocked_reason IS DISTINCT FROM v_block;
      RETURN QUERY SELECT 'BLOCKED'::text, v_block;
      RETURN;
    END IF;
  END IF;
  UPDATE core.payment_refund_instance AS ri
     SET status = 'SUBMITTED', blocked_reason = NULL, issued_at = platform.now()
   WHERE ri.id = p_instance_id;
  RETURN QUERY SELECT 'SUBMITTED'::text, NULL::text;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_submit_refund(uuid) IS
  'Autorise l''envoi d''un remboursement planifié (SM-8 SUBMITTED, date d''émission) ; avance de '
  'Kmino : décision FINANCE à deux personnes exigée, sinon BLOCKED. Travailleur payment_command. '
  'US-224 (224b), ADR-147.';
REVOKE ALL ON FUNCTION core.payment_cmd_submit_refund(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_cmd_submit_refund(uuid) TO app_worker;

-- 7.3 Report sur les soldes (corps de 0116 recopié ; blocs marqués US-224b)
CREATE OR REPLACE FUNCTION core.settlement_cmd_apply_leg_movement(p_operation_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip_id     uuid;
  v_kind        text;
  v_purpose     text;
  v_status      text;
  v_currency    text;
  v_account     uuid;
  v_org         uuid;
  v_country     text;
  v_trip_cur    text;
  v_mode        text;
  v_n           integer;
  r             record;
  v_debit       bigint;
  v_avail       bigint;
  v_block       text;
  v_head_refund bigint;
  v_over        integer;
  v_after       bigint;
  v_adv         bigint := 0;
  v_adv_id      uuid;
  v_adv_ok      boolean;
  v_adv_prev    bigint := 0;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'settlement: apply_leg_movement reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT o.trip_id, o.kind, o.purpose, o.currency, o.psp_account_id
    INTO v_trip_id, v_kind, v_purpose, v_currency, v_account
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND OR v_trip_id IS NULL OR v_account IS NULL THEN
    RAISE EXCEPTION 'settlement: operation % has no trip leg to move', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- verrou du trip : un seul écrivain des soldes du trip à la fois (17 §2.9, §4.3 point 1)
  SELECT t.org_id, t.country_code, t.currency INTO v_org, v_country, v_trip_cur
    FROM core.booking_trip AS t WHERE t.id = v_trip_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m WHERE m.operation_id = p_operation_id) THEN
    RETURN 'DUPLICATE';
  END IF;

  -- statut relu SOUS le verrou du trip
  SELECT o.status INTO v_status FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF v_status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'settlement: operation % is %, not SUCCEEDED', p_operation_id, v_status
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_not_succeeded';
  END IF;
  -- US-223 (S-02, RC-5) : aucun mouvement de jambe sans preuve rattachée (webhook signé, ou lecture
  -- d'un compte de bac à sable) ; un SUCCEEDED rendu par l'API laisse la preuve à NULL
  IF (SELECT o.proof_type FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id)
     IS NULL THEN
    RAISE EXCEPTION 'settlement: operation % has no attached proof', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_movement_unproven';
  END IF;
  -- US-224b (08 E7 règle 3 bis) : remboursement dont une part est avancée par Kmino (jambe HOST
  -- déjà versée à l'hôte) : l'avance doit être décidée par deux personnes ; sa part n'est jamais
  -- prise sur la jambe PLATFORM du trip (elle vient du solde PLATFORM du pays) et elle compte
  -- comme un remboursement de la jambe HOST dans les bornes du règlement
  IF v_kind = 'REFUND' THEN
    SELECT a.id, a.amount_minor, a.decided_by IS NOT NULL INTO v_adv_id, v_adv, v_adv_ok
      FROM core.payment_refund_instance AS i
      JOIN core.settlement_platform_advance AS a ON a.id = i.advance_id
     WHERE i.operation_id = p_operation_id AND a.status = 'PLANNED';
    IF v_adv_id IS NOT NULL AND v_adv_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'settlement: advance of operation % awaits a FIN decision', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'advance_decision_required';
    END IF;
    v_adv := COALESCE(v_adv, 0);
    SELECT COALESCE(sum(a.amount_minor), 0) INTO v_adv_prev
      FROM core.settlement_platform_advance AS a
      JOIN core.payment_refund_instance AS i ON i.advance_id = a.id
     WHERE i.trip_id = v_trip_id AND a.cause = 'RELEASED_LEG'
       AND a.status IN ('OPEN', 'RECOVERING', 'RECOVERED', 'WRITTEN_OFF');
  END IF;
  IF v_purpose NOT IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION')
     OR v_kind NOT IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION', 'REFUND', 'LEG_REALLOCATION',
                       'LEG_RELEASE')
     OR v_currency IS DISTINCT FROM v_trip_cur THEN
    RAISE EXCEPTION 'settlement: operation % (% / %) is outside the rent leg perimeter',
                    p_operation_id, v_kind, v_purpose
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;
  SELECT count(*)::integer INTO v_n
    FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = p_operation_id;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'settlement: operation % has % legs, 4 expected', p_operation_id, v_n
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- US-049 (RC-3) : fonds détenus par Kmino (mode autre que SPLIT_AT_SOURCE) seulement si
  -- funds_holding_enabled[pays] (17 §0.1, lecture fail-closed) ; défense derrière le CHECK de 0028
  SELECT a.collection_mode INTO v_mode FROM core.payment_psp_account AS a WHERE a.id = v_account;
  IF v_mode IS DISTINCT FROM 'SPLIT_AT_SOURCE'
     AND NOT core.config_go_live('funds_holding_enabled', v_country) THEN
    RAISE EXCEPTION 'settlement: funds holding is disabled for %', v_country
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_funds_holding_disabled';
  END IF;

  -- quatre lignes de solde du segment (bêta : segment 1), créées à zéro au premier mouvement
  INSERT INTO core.settlement_trip_leg_balance (trip_id, segment_no, leg, org_id, country_code, currency)
  SELECT v_trip_id, 1, l.leg, v_org, v_country, v_trip_cur
    FROM unnest(ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM']) AS l(leg)
  ON CONFLICT (trip_id, segment_no, leg) DO NOTHING;

  -- US-049 (RC-3) : versement gardé (trip terminé, release_at, sous-marchand, interrupteurs),
  -- relu ici sous le verrou du trip en plus de l'enregistrement de l'ordre
  IF v_kind = 'LEG_RELEASE' THEN
    v_block := core.settlement_release_blocker(p_operation_id);
    IF v_block IS NOT NULL THEN
      RAISE EXCEPTION 'settlement: leg release of operation % refused (%)', p_operation_id, v_block
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = v_block;
    END IF;
  END IF;

  -- contrôle des débits sur les soldes verrouillés (17 §4.3 point 8, 08 E7 règle 3 bis)
  FOR r IN
    SELECT l.leg, l.amount_minor, b.captured_minor, b.refunded_minor, b.reallocated_in_minor,
           b.reallocated_out_minor, b.released_minor, b.frozen
      FROM core.payment_payment_operation_leg AS l
      JOIN core.settlement_trip_leg_balance AS b
        ON b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
     WHERE l.operation_id = p_operation_id
     ORDER BY array_position(ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'], l.leg)
       FOR UPDATE OF b
  LOOP
    v_debit := CASE
                 WHEN v_kind = 'REFUND' AND r.leg = 'PLATFORM' THEN r.amount_minor - v_adv
                 WHEN v_kind IN ('REFUND', 'LEG_RELEASE') THEN r.amount_minor
                 WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(-r.amount_minor, 0)
                 ELSE 0
               END;
    IF v_debit > 0 THEN
      IF r.frozen THEN
        RAISE EXCEPTION 'settlement: leg % of trip % is frozen', r.leg, v_trip_id
          USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_frozen';
      END IF;
      v_avail := r.captured_minor + r.reallocated_in_minor - r.refunded_minor
                 - r.reallocated_out_minor - r.released_minor;
      IF v_debit > v_avail THEN
        IF r.released_minor > 0 THEN
          RAISE EXCEPTION 'settlement: leg % of trip % already released', r.leg, v_trip_id
            USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_already_released';
        END IF;
        RAISE EXCEPTION 'settlement: debit % exceeds leg % balance %', v_debit, r.leg, v_avail
          USING ERRCODE = 'object_not_in_prerequisite_state',
                CONSTRAINT = 'leg_movement_exceeds_balance';
      END IF;
    END IF;
  END LOOP;

  -- US-049 (RC-2) : un remboursement est borné par le règlement du segment, jambe par jambe
  -- (08 E7 règle 1 : jambes explicites, jamais un prorata) : Σ remboursé ≤ max(0, − Σ variations
  -- de la chaîne de versions) et Σ remboursé ≤ remboursement de la dernière version.
  IF v_kind = 'REFUND' THEN
    SELECT s.guest_refund_minor INTO v_head_refund
      FROM core.settlement_settlement AS s
     WHERE s.trip_id = v_trip_id AND s.segment_no = 1
     ORDER BY s.version DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'settlement: refund of operation % without a settlement', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_without_settlement';
    END IF;
    -- US-224b : la part avancée compte pour HOST (avances déjà reportées comprises), jamais pour
    -- PLATFORM ; le total remboursé au voyageur la compte une fois
    SELECT count(*) FILTER (WHERE b.refunded_minor + l.amount_minor
                                  - CASE WHEN l.leg = 'PLATFORM' THEN v_adv ELSE 0 END
                                  + CASE WHEN l.leg = 'HOST' THEN v_adv + v_adv_prev ELSE 0 END
                                  > GREATEST(-e.variation, 0)),
           COALESCE(sum(b.refunded_minor + l.amount_minor
                        - CASE WHEN l.leg = 'PLATFORM' THEN v_adv ELSE 0 END), 0)
           + v_adv + v_adv_prev
      INTO v_over, v_after
      FROM core.payment_payment_operation_leg AS l
      JOIN core.settlement_trip_leg_balance AS b
        ON b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
      LEFT JOIN (SELECT sl.leg, sum(sl.variation_minor) AS variation
                   FROM core.settlement_settlement_leg AS sl
                  WHERE sl.trip_id = v_trip_id AND sl.segment_no = 1
                  GROUP BY sl.leg) AS e
        ON e.leg = l.leg
     WHERE l.operation_id = p_operation_id;
    IF v_over > 0 OR v_after > v_head_refund THEN
      RAISE EXCEPTION 'settlement: refund of operation % exceeds the settlement legs', p_operation_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'leg_refund_exceeds_settlement';
    END IF;
  END IF;

  UPDATE core.settlement_trip_leg_balance AS b
     SET captured_minor = b.captured_minor
                          + CASE WHEN v_kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
                                 THEN l.amount_minor ELSE 0 END,
         refunded_minor = b.refunded_minor
                          + CASE WHEN v_kind = 'REFUND'
                                 THEN l.amount_minor - CASE WHEN l.leg = 'PLATFORM' THEN v_adv ELSE 0 END
                                 ELSE 0 END,
         reallocated_in_minor = b.reallocated_in_minor
                          + CASE WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(l.amount_minor, 0)
                                 ELSE 0 END,
         reallocated_out_minor = b.reallocated_out_minor
                          + CASE WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(-l.amount_minor, 0)
                                 ELSE 0 END,
         released_minor = b.released_minor
                          + CASE WHEN v_kind = 'LEG_RELEASE' THEN l.amount_minor ELSE 0 END
    FROM core.payment_payment_operation_leg AS l
   WHERE l.operation_id = p_operation_id
     AND b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
     AND l.amount_minor <> 0;

  -- US-224b : l'avance décidée devient effective avec le mouvement (créance de l'hôte, SM-6b)
  IF v_adv_id IS NOT NULL THEN
    UPDATE core.settlement_platform_advance AS a SET status = 'OPEN' WHERE a.id = v_adv_id;
  END IF;

  INSERT INTO core.settlement_leg_movement (operation_id, trip_id, segment_no, country_code, kind)
  VALUES (p_operation_id, v_trip_id, 1, v_country, v_kind);
  RETURN 'APPLIED';
END
$fn$;

-- 7.4 Actions FINANCE à deux personnes (corps de 0097 recopiés ; blocs marqués US-224b)
CREATE OR REPLACE FUNCTION core.settlement_cmd_request_finance_action(p_token_hash bytea, p_request_id uuid,
                                                          p_action text, p_subject_id uuid,
                                                          p_reason text)
  RETURNS TABLE (outcome text, approval_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_perm    text;
  v_type    text;
  v_country text;
  v_role    text;
  v_why     text;
  v_prev    record;
  v_pending uuid;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('DECIDE_ADVANCE', 'WRITE_OFF_RECEIVABLE', 'ISSUE_BORDEREAU')
     OR p_request_id IS NULL OR p_subject_id IS NULL OR p_reason IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'finance : action, sujet ou motif invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_perm := CASE p_action WHEN 'ISSUE_BORDEREAU' THEN 'finance.insurer_bordereau'
                          ELSE 'finance.platform_advance' END;
  v_type := CASE p_action WHEN 'ISSUE_BORDEREAU' THEN 'INSURER_BORDEREAU' ELSE 'PLATFORM_ADVANCE' END;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', v_type, p_subject_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', p_action), p_reason, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- sujet ÉLIGIBLE et pays relus en base (jamais reçus du client)
  IF p_action = 'DECIDE_ADVANCE' THEN
    SELECT a.country_code INTO v_country FROM core.settlement_platform_advance AS a
     WHERE a.id = p_subject_id AND a.status IN ('PLANNED', 'OPEN') AND a.decided_by IS NULL;
  ELSIF p_action = 'WRITE_OFF_RECEIVABLE' THEN
    SELECT a.country_code INTO v_country FROM core.settlement_platform_advance AS a
     WHERE a.id = p_subject_id AND a.status IN ('OPEN', 'RECOVERING')
       AND a.receivable_minor > a.recovered_minor;
  ELSE
    SELECT b.country_code INTO v_country FROM core.settlement_insurer_bordereau AS b
     WHERE b.id = p_subject_id AND b.status = 'DRAFT';
  END IF;
  IF v_country IS NULL THEN
    v_why := 'SUBJECT_NOT_FOUND';
  ELSE
    v_role := core.iam_staff_permitted(v_s.user_id, v_perm, ARRAY[v_country], NULL);
    IF v_role IS NULL OR NOT (v_country = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
      v_why := 'PERMISSION_OR_COUNTRY';
    END IF;
  END IF;
  IF v_why IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', v_type, p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_why, 'attempted', p_action,
                                   'permission', v_perm), p_reason, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- US-122 (ADR-124, F2-C-04) : jamais une décision FINANCE sur un sujet qui concerne le
  -- demandeur (titulaire, co-hôte du compte de l'avance, compte lié) ; refus journalisé, aucune
  -- écriture ; aucun montant n'est lu ni changé
  IF core.support_staff_conflict(v_s.user_id, v_type, p_subject_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_FORBIDDEN', v_type, p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SELF', 'attempted', p_action,
                                   'permission', v_perm, 'guard', 'SEPARATION_OF_DUTIES'),
                                 p_reason, p_request_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- idempotence par identifiant de demande
  SELECT f.id, f.action, f.subject_id, f.requested_by INTO v_prev
    FROM core.settlement_finance_approval AS f WHERE f.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.action = p_action AND v_prev.subject_id = p_subject_id AND v_prev.requested_by = v_s.user_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_prev.id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'finance : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT f.id INTO v_pending FROM core.settlement_finance_approval AS f
   WHERE f.action = p_action AND f.subject_id = p_subject_id AND f.status = 'PENDING';
  IF v_pending IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_PENDING'::text, v_pending;
    RETURN;
  END IF;
  -- aucun effet d'argent : la demande seule
  INSERT INTO core.settlement_finance_approval (id, action, subject_id, country_code, reason,
                                                requested_by, status)
  VALUES (p_request_id, p_action, p_subject_id, v_country, pg_catalog.btrim(p_reason), v_s.user_id,
          'PENDING');
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_REQUESTED', v_type, p_subject_id,
                               NULL, pg_catalog.jsonb_build_object('approvalId', p_request_id,
                                 'action', p_action, 'country', v_country), p_reason, p_request_id);
  RETURN QUERY SELECT 'REQUESTED'::text, p_request_id;
END
$fn$;
CREATE OR REPLACE FUNCTION core.settlement_cmd_approve_finance_action(p_token_hash bytea, p_approval_id uuid)
  RETURNS TABLE (outcome text, approval_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_f    record;
  v_perm text;
  v_type text;
  v_role text;
  v_now  timestamptz;
  v_ok   boolean;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION 'finance : demande absente' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT f.id, f.action, f.subject_id, f.country_code, f.reason, f.requested_by, f.status INTO v_f
    FROM core.settlement_finance_approval AS f WHERE f.id = p_approval_id;
  v_type := CASE v_f.action WHEN 'ISSUE_BORDEREAU' THEN 'INSURER_BORDEREAU'
                            WHEN 'DECIDE_ADVANCE' THEN 'PLATFORM_ADVANCE'
                            WHEN 'WRITE_OFF_RECEIVABLE' THEN 'PLATFORM_ADVANCE'
                            ELSE 'FINANCE_APPROVAL' END;
  v_perm := CASE v_f.action WHEN 'ISSUE_BORDEREAU' THEN 'finance.insurer_bordereau'
                            ELSE 'finance.platform_advance' END;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', v_type,
                                 COALESCE(v_f.subject_id, p_approval_id), NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'APPROVE_FINANCE_ACTION'), NULL, p_approval_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_f.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, v_perm, ARRAY[v_f.country_code], NULL);
  END IF;
  IF v_role IS NULL OR NOT (v_f.country_code = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', v_type,
                                 COALESCE(v_f.subject_id, p_approval_id), NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_f.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION_OR_COUNTRY' END,
                                   'attempted', 'APPROVE_FINANCE_ACTION', 'permission', v_perm),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_f.status <> 'PENDING' THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_f.id;
    RETURN;
  END IF;
  -- deux personnes distinctes : l'identité est celle de la SESSION (une seconde session du
  -- demandeur est la même personne) ; refus journalisé, aucun effet d'argent
  IF v_f.requested_by = v_s.user_id THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_SELF_APPROVAL_DENIED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'SELF_APPROVAL'::text, v_f.id;
    RETURN;
  END IF;
  -- US-122 (ADR-124, F2-C-04) : l'approbateur n'est pas non plus une personne du sujet
  -- (titulaire, co-hôte, compte lié) ; refus journalisé, aucun effet d'argent
  IF core.support_staff_conflict(v_s.user_id, v_type, v_f.subject_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_SELF_APPROVAL_DENIED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code,
                                   'reason', 'SELF', 'guard', 'SEPARATION_OF_DUTIES'),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, v_f.id;
    RETURN;
  END IF;
  -- verrous : la demande, puis le sujet ; le sujet doit être resté éligible
  PERFORM 1 FROM core.settlement_finance_approval AS f WHERE f.id = v_f.id AND f.status = 'PENDING'
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_f.id;
    RETURN;
  END IF;
  -- US-224b (N-119) : le conflit du DEMANDEUR est rejugé à l'approbation (il a pu devenir
  -- titulaire, co-hôte du compte ou compte lié depuis sa demande) ; la demande est rejetée,
  -- refus journalisé, aucun effet d'argent ; même issue que le conflit de l'approbateur
  IF core.support_staff_conflict(v_f.requested_by, v_type, v_f.subject_id) THEN
    UPDATE core.settlement_finance_approval AS f SET status = 'REJECTED' WHERE f.id = v_f.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_REJECTED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code,
                                   'reason', 'REQUESTER_CONFLICT', 'guard', 'SEPARATION_OF_DUTIES'),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, v_f.id;
    RETURN;
  END IF;
  IF v_f.action = 'DECIDE_ADVANCE' THEN
    PERFORM 1 FROM core.settlement_platform_advance AS a
     WHERE a.id = v_f.subject_id AND a.status IN ('PLANNED', 'OPEN') AND a.decided_by IS NULL
       FOR UPDATE;
  ELSIF v_f.action = 'WRITE_OFF_RECEIVABLE' THEN
    PERFORM 1 FROM core.settlement_platform_advance AS a
     WHERE a.id = v_f.subject_id AND a.status IN ('OPEN', 'RECOVERING')
       AND a.receivable_minor > a.recovered_minor FOR UPDATE;
  ELSE
    PERFORM 1 FROM core.settlement_insurer_bordereau AS b
     WHERE b.id = v_f.subject_id AND b.status = 'DRAFT' FOR UPDATE;
  END IF;
  v_ok := FOUND;
  v_now := platform.now();
  IF NOT v_ok THEN
    UPDATE core.settlement_finance_approval AS f SET status = 'REJECTED' WHERE f.id = v_f.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_REJECTED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code,
                                   'reason', 'SUBJECT_CHANGED'), NULL, p_approval_id);
    RETURN QUERY SELECT 'SUBJECT_CHANGED'::text, v_f.id;
    RETURN;
  END IF;
  UPDATE core.settlement_finance_approval AS f
     SET status = 'APPROVED', approved_by = v_s.user_id, approved_at = v_now
   WHERE f.id = v_f.id;
  IF v_f.action = 'DECIDE_ADVANCE' THEN
    UPDATE core.settlement_platform_advance AS a
       SET decided_by = v_f.requested_by, decision_second_by = v_s.user_id,
           decision_approval_id = v_f.id
     WHERE a.id = v_f.subject_id;
  ELSIF v_f.action = 'WRITE_OFF_RECEIVABLE' THEN
    UPDATE core.settlement_platform_advance AS a
       SET status = 'WRITTEN_OFF', written_off_by = v_f.requested_by, write_off_second_by = v_s.user_id,
           write_off_approval_id = v_f.id, written_off_at = v_now
     WHERE a.id = v_f.subject_id;
  ELSE
    UPDATE core.settlement_insurer_bordereau AS b
       SET status = 'ISSUED', issued_by = v_f.requested_by, second_validated_by = v_s.user_id,
           approval_id = v_f.id, issued_at = v_now
     WHERE b.id = v_f.subject_id;
  END IF;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_APPROVED', v_type, v_f.subject_id,
                               NULL, pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                 'action', v_f.action, 'country', v_f.country_code,
                                 'requestedBy', v_f.requested_by), NULL, p_approval_id);
  RETURN QUERY SELECT 'APPROVED'::text, v_f.id;
END
$fn$;

-- 7.5 Retrait de la commande à 13 arguments (0028, 0048, 0121) : aucun appelant de production
-- (PgOperationRecorder passe par la commande à 15 arguments) ; suite des revues de la PR #198
DROP FUNCTION core.payment_cmd_record_operation(uuid, uuid, uuid, uuid, text, text, text, bigint,
                                                text, integer, text, text, jsonb);

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
