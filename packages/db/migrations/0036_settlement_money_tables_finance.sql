-- 0036 — Tables d'argent sans écriture directe, avances de Kmino, assureur, double validation
-- FINANCE et créance de l'hôte (`host_advance_v`).
-- US-062 ; 17 §2.3 (SQL des tables d'argent, commandes FINANCE à deux personnes, RLS-21 à
-- RLS-26), §2.9 (avance de Kmino, insurer_ledger), §3.2.8, §3.2.9 (`finance_approval`) ;
-- réserves de la revue sécurité US-056 (passation US-056, « Réserves », points 3 à 5) ;
-- ADR-027, ADR-053, ADR-057, ADR-062, ADR-064. Appliquée sous `migrator`.
--
-- Bêta (D1) : schéma unique `core`, préfixe `settlement_` (`settlement.platform_advance` →
-- `core.settlement_platform_advance`).
--
-- Périmètre : les TABLES, leurs gardes, leur RLS et les deux commandes FINANCE à deux personnes.
-- Les écrivains métier arrivent avec leurs stories, qui ne recréent rien (ALTER seulement) :
-- création d'une avance (US-224, règle 3 bis ; US-709), bordereaux et `insurer_ledger_state`
-- (US-227, avec les tables `insurer` / `insurer_contract` et leurs clés étrangères), écritures E4
-- du grand livre (lot du grand livre). Les politiques d'écriture de ces travailleurs sont posées
-- ici, au plus juste, pour que la règle ne dépende pas de leur story.
--
-- Principes :
--   - RLS ENABLE + FORCE, `migrator_all` ; aucune écriture de table par app_api, app_worker ni
--     app_anon (RLS-21) ; DELETE et TRUNCATE refusés à tous les rôles (triggers) ;
--   - lecture d'app_api PAR COLONNES : aucun identifiant du personnel (`requested_by`,
--     `approved_by`, `decided_by`, `decision_second_by`, `written_off_by`, `write_off_second_by`,
--     `issued_by`, `second_validated_by`) ni référence PSP ; FINANCE / ADMIN du pays seulement
--     (RLS-7, RLS-23) ; l'hôte TITULAIRE lit ses avances de cause RELEASED_LEG par
--     `host_advance_v` (RLS-26) ; OPS, SUPPORT, voyageur, co-hôte : rien (RLS-22, RLS-23, RLS-28) ;
--   - décisions FINANCE à deux personnes (RLS-24) : `cmd_request_finance_action` puis
--     `cmd_approve_finance_action`, propriétaire cmd_money_owner, EXECUTE au seul app_api.
--     Forme d'appel d'ADR-056 / ADR-062 : un appel = une instruction, en autocommit ; l'identité
--     vient de la SESSION désignée par l'empreinte de son jeton (preuve de possession, niveau
--     TOTP), jamais d'un réglage `app.*` modifiable par le rôle applicatif (réserve 5 d'US-056),
--     ni d'un paramètre ; demandeur ≠ approbateur, même dans une seconde session de la même
--     personne (`CHECK (approved_by <> requested_by)`) ; refus journalisés, audit écrit en dernier ;
--   - les effets (`decided_by` / `decision_second_by`, `written_off_*`, `issued_by` /
--     `second_validated_by`) ne sont acceptés par les triggers de garde QUE s'ils recopient une
--     demande APPROUVÉE de la même action sur le même sujet par ces deux personnes : même une
--     future commande défectueuse sous cmd_money_owner ne peut pas passer une avance en perte
--     seule ; la politique `cmd_advance_upd` ne laisse jamais un travailleur écrire `WRITTEN_OFF`
--     (réserve 3 d'US-056) ;
--   - le GRANT de `platform_advance` ne cite que des colonnes existantes (réserve 4 d'US-056 ;
--     `trip_id` est déjà porté par `settlement_leg` et `payment_operation_leg`, 0027 et 0028).
--
-- Retour arrière :
--   DROP VIEW core.settlement_host_advance_v;
--   DROP FUNCTION core.settlement_cmd_request_finance_action(bytea, uuid, text, uuid, text),
--     core.settlement_cmd_approve_finance_action(bytea, uuid),
--     core.settlement_advance_approvers(bytea, uuid);
--   DROP TABLE core.settlement_insurer_bordereau_line, core.settlement_insurer_bordereau,
--     core.settlement_insurer_ledger_state, core.settlement_platform_advance,
--     core.settlement_finance_approval;
--   DROP FUNCTION core.settlement_no_delete(), core.settlement_finance_approval_guard(),
--     core.settlement_platform_advance_guard(), core.settlement_insurer_bordereau_guard();
--   DROP POLICY cmd_money_* ON core.iam_session, core.iam_user_account,
--     core.iam_staff_role_assignment, core.iam_role_permission, core.audit_audit_log;
--   REVOKE … FROM cmd_money_owner (droits IAM et audit ci-dessous).

-- 1. Tables --------------------------------------------------------------------------------------

-- Décision FINANCE à deux personnes (17 §2.3, §3.2.9).
CREATE TABLE core.settlement_finance_approval (
  id           uuid        PRIMARY KEY,                          -- = identifiant de la demande
  action       text        NOT NULL
    CONSTRAINT finance_approval_action_valid CHECK (action IN
      ('DECIDE_ADVANCE', 'WRITE_OFF_RECEIVABLE', 'ISSUE_BORDEREAU')),
  subject_id   uuid        NOT NULL,                             -- platform_advance.id ou insurer_bordereau.id
  country_code text        NOT NULL
    CONSTRAINT finance_approval_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  reason       text        NOT NULL                              -- [C2] motif
    CONSTRAINT finance_approval_reason_length CHECK (
      pg_catalog.char_length(pg_catalog.btrim(reason)) BETWEEN 10 AND 1000),
  requested_by uuid        NOT NULL REFERENCES core.iam_user_account (id),
  requested_at timestamptz NOT NULL DEFAULT platform.now(),
  approved_by  uuid        REFERENCES core.iam_user_account (id),
  approved_at  timestamptz,
  status       text        NOT NULL
    CONSTRAINT finance_approval_status_valid CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT finance_approval_two_people CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT finance_approval_approved_shape CHECK ((status = 'APPROVED') = (approved_by IS NOT NULL)),
  CONSTRAINT finance_approval_approved_at CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE UNIQUE INDEX finance_approval_one_pending ON core.settlement_finance_approval (action, subject_id)
  WHERE (status = 'PENDING');
COMMENT ON TABLE core.settlement_finance_approval IS
  'STL finance_approval (17 §3.2.9) : demande puis approbation par deux personnes distinctes. US-062.';

-- Avance de Kmino (17 §2.9, §3.2.8).
CREATE TABLE core.settlement_platform_advance (
  id                    uuid        PRIMARY KEY,
  country_code          text        NOT NULL
    CONSTRAINT platform_advance_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency              text        NOT NULL
    CONSTRAINT platform_advance_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  trip_id               uuid,
  -- hôte débiteur (cause RELEASED_LEG). Le lien « org_id = compte d'hôte du trip » n'est pas une
  -- contrainte : la commande de création (US-224) le relira du trip, comme la fixture 9700.
  org_id                uuid,
  insurer_id            uuid,                                   -- clé étrangère : US-227 (table insurer)
  cause                 text        NOT NULL
    CONSTRAINT platform_advance_cause_valid CHECK (cause IN
      ('RELEASED_LEG', 'CREDIT_BEYOND_PLATFORM', 'CHARGEBACK_LOSS', 'HOST_COMPENSATION')),
  amount_minor          bigint      NOT NULL
    CONSTRAINT platform_advance_amount_positive CHECK (amount_minor > 0),
  funded_from           text        NOT NULL
    CONSTRAINT platform_advance_funded_from_valid CHECK (funded_from IN
      ('TRIP_PLATFORM_LEG', 'COUNTRY_PLATFORM_BALANCE')),
  receivable_minor      bigint      NOT NULL DEFAULT 0,
  recovered_minor       bigint      NOT NULL DEFAULT 0,
  status                text        NOT NULL DEFAULT 'OPEN'
    CONSTRAINT platform_advance_status_valid CHECK (status IN ('OPEN', 'RECOVERING', 'RECOVERED', 'WRITTEN_OFF')),
  decided_by            uuid        REFERENCES core.iam_user_account (id),
  decision_second_by    uuid        REFERENCES core.iam_user_account (id),
  decision_approval_id  uuid        REFERENCES core.settlement_finance_approval (id),
  written_off_at        timestamptz,
  written_off_by        uuid        REFERENCES core.iam_user_account (id),
  write_off_second_by   uuid        REFERENCES core.iam_user_account (id),
  write_off_approval_id uuid        REFERENCES core.settlement_finance_approval (id),
  created_at            timestamptz NOT NULL DEFAULT platform.now(),
  updated_at            timestamptz NOT NULL DEFAULT platform.now(),
  row_version           integer     NOT NULL DEFAULT 0,
  CONSTRAINT platform_advance_amounts CHECK (
    receivable_minor >= 0 AND recovered_minor >= 0 AND recovered_minor <= receivable_minor
    AND receivable_minor <= amount_minor),
  CONSTRAINT platform_advance_released_leg CHECK (
    cause <> 'RELEASED_LEG'
    OR (receivable_minor = amount_minor AND (org_id IS NOT NULL OR insurer_id IS NOT NULL))),
  CONSTRAINT platform_advance_no_receivable CHECK (
    cause NOT IN ('CREDIT_BEYOND_PLATFORM', 'CHARGEBACK_LOSS') OR receivable_minor = 0),
  CONSTRAINT platform_advance_decision_pair CHECK (
    (decided_by IS NULL) = (decision_second_by IS NULL)
    AND (decided_by IS NULL) = (decision_approval_id IS NULL)
    AND (decided_by IS NULL OR decided_by <> decision_second_by)),
  CONSTRAINT platform_advance_write_off_pair CHECK (
    (written_off_by IS NULL) = (write_off_second_by IS NULL)
    AND (written_off_by IS NULL) = (write_off_approval_id IS NULL)
    AND (written_off_by IS NULL) = (written_off_at IS NULL)
    AND (written_off_by IS NULL OR written_off_by <> write_off_second_by)),
  CONSTRAINT platform_advance_written_off_shape CHECK ((status = 'WRITTEN_OFF') = (written_off_by IS NOT NULL)),
  CONSTRAINT platform_advance_recovered_shape CHECK (status <> 'RECOVERED' OR recovered_minor = receivable_minor),
  CONSTRAINT platform_advance_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  CONSTRAINT platform_advance_org_country_fk FOREIGN KEY (org_id, country_code)
    REFERENCES core.iam_organization (id, country_code)
);
CREATE INDEX platform_advance_org_idx ON core.settlement_platform_advance (org_id)
  WHERE (cause = 'RELEASED_LEG');
CREATE INDEX platform_advance_trip_idx ON core.settlement_platform_advance (trip_id);
COMMENT ON TABLE core.settlement_platform_advance IS
  'STL platform_advance (17 §2.9, §3.2.8) : avance de Kmino ; décision au-delà d''un plafond et '
  'passage en perte par deux personnes seulement. US-062 (structure) ; écrivains US-224, US-709.';

-- Position de l'assureur par (assureur, pays, devise) (17 §2.9 insurer_ledger).
CREATE TABLE core.settlement_insurer_ledger_state (
  insurer_id        uuid        NOT NULL,                       -- clé étrangère : US-227
  country_code      text        NOT NULL
    CONSTRAINT insurer_ledger_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency          text        NOT NULL
    CONSTRAINT insurer_ledger_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  payable_minor     bigint      NOT NULL DEFAULT 0,
  frozen_minor      bigint      NOT NULL DEFAULT 0,
  receivable_minor  bigint      NOT NULL DEFAULT 0,
  next_bordereau_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT platform.now(),
  updated_at        timestamptz NOT NULL DEFAULT platform.now(),
  row_version       integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (insurer_id, country_code, currency),
  CONSTRAINT insurer_ledger_amounts_nonneg CHECK (
    payable_minor >= 0 AND frozen_minor >= 0 AND receivable_minor >= 0)
);
COMMENT ON TABLE core.settlement_insurer_ledger_state IS
  'STL insurer_ledger_state (17 §3.2.8) : prime due à l''assureur. US-062 (structure) ; US-227.';

-- Bordereau de l'assureur (17 §3.2.8) : émis par deux personnes (ISSUE_BORDEREAU).
CREATE TABLE core.settlement_insurer_bordereau (
  id                  uuid        PRIMARY KEY,
  insurer_id          uuid        NOT NULL,                     -- clé étrangère : US-227
  insurer_contract_id uuid        NOT NULL,                     -- clé étrangère : US-227
  country_code        text        NOT NULL
    CONSTRAINT insurer_bordereau_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency            text        NOT NULL
    CONSTRAINT insurer_bordereau_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  period              tstzrange   NOT NULL
    CONSTRAINT insurer_bordereau_period_nonempty CHECK (NOT pg_catalog.isempty(period)),
  total_minor         bigint      NOT NULL
    CONSTRAINT insurer_bordereau_total_nonneg CHECK (total_minor >= 0),
  status              text        NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT insurer_bordereau_status_valid CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'DISPUTED')),
  issued_by           uuid        REFERENCES core.iam_user_account (id),
  second_validated_by uuid        REFERENCES core.iam_user_account (id),
  approval_id         uuid        REFERENCES core.settlement_finance_approval (id),
  issued_at           timestamptz,
  paid_at             timestamptz,
  psp_release_ref     text,
  created_at          timestamptz NOT NULL DEFAULT platform.now(),
  updated_at          timestamptz NOT NULL DEFAULT platform.now(),
  row_version         integer     NOT NULL DEFAULT 0,
  CONSTRAINT insurer_bordereau_issue_pair CHECK (
    (issued_by IS NULL) = (second_validated_by IS NULL)
    AND (issued_by IS NULL) = (approval_id IS NULL)
    AND (issued_by IS NULL) = (issued_at IS NULL)
    AND (issued_by IS NULL OR issued_by <> second_validated_by)),
  CONSTRAINT insurer_bordereau_issued_shape CHECK ((status = 'DRAFT') = (issued_by IS NULL)),
  CONSTRAINT insurer_bordereau_paid_shape CHECK ((status = 'PAID') = (paid_at IS NOT NULL)),
  CONSTRAINT insurer_bordereau_id_country_unique UNIQUE (id, country_code)
);
COMMENT ON TABLE core.settlement_insurer_bordereau IS
  'STL insurer_bordereau (17 §3.2.8) : émission à deux personnes. US-062 (structure) ; US-227.';

CREATE TABLE core.settlement_insurer_bordereau_line (
  bordereau_id uuid    NOT NULL,
  country_code text    NOT NULL,                                -- dénormalisé (portée RLS)
  trip_id      uuid    NOT NULL,
  segment_no   integer NOT NULL
    CONSTRAINT insurer_bordereau_line_segment_beta CHECK (segment_no = 1),
  amount_minor bigint  NOT NULL
    CONSTRAINT insurer_bordereau_line_amount_nonneg CHECK (amount_minor >= 0),
  PRIMARY KEY (bordereau_id, trip_id, segment_no),
  CONSTRAINT insurer_bordereau_line_trip_once UNIQUE (trip_id, segment_no),
  CONSTRAINT insurer_bordereau_line_bordereau_fk FOREIGN KEY (bordereau_id, country_code)
    REFERENCES core.settlement_insurer_bordereau (id, country_code),
  CONSTRAINT insurer_bordereau_line_trip_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code)
);
COMMENT ON TABLE core.settlement_insurer_bordereau_line IS
  'STL insurer_bordereau_line (17 §3.2.8) : ajout seul. US-062 (structure) ; US-227.';

-- 2. Gardes (tous rôles ; pas de SECURITY DEFINER) -----------------------------------------------

-- Ni DELETE ni TRUNCATE (17 §2.3 « triggers no_delete sur toutes ces tables »).
CREATE FUNCTION core.settlement_no_delete()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION '%: aucune suppression (table d''argent)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'money_no_delete';
END
$fn$;
REVOKE ALL ON FUNCTION core.settlement_no_delete() FROM PUBLIC;

-- Demande FINANCE : identité figée ; PENDING -> APPROVED | REJECTED | EXPIRED ; état final figé.
CREATE FUNCTION core.settlement_finance_approval_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.subject_id IS DISTINCT FROM OLD.subject_id OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.requested_by IS DISTINCT FROM OLD.requested_by
     OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
     OR OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'finance_approval: identité figée, seule une demande PENDING change d''état'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'finance_approval_guarded';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.settlement_finance_approval_guard() FROM PUBLIC;

-- Avance : identité figée ; RECOVERED et WRITTEN_OFF terminaux ; recouvrement croissant ;
-- décision et perte écrites une fois, et SEULEMENT en recopie d'une demande approuvée par deux
-- personnes (même action, même sujet, mêmes demandeur et approbateur).
CREATE FUNCTION core.settlement_platform_advance_guard()
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
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.settlement_platform_advance_guard() FROM PUBLIC;

-- Bordereau : identité figée ; DRAFT -> ISSUED (seulement en recopie d'une demande
-- ISSUE_BORDEREAU approuvée par deux personnes) -> PAID | DISPUTED ; DISPUTED -> PAID ; PAID final ;
-- montant et période figés hors DRAFT (une correction = bordereau suivant).
CREATE FUNCTION core.settlement_insurer_bordereau_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.insurer_id IS DISTINCT FROM OLD.insurer_id
     OR NEW.insurer_contract_id IS DISTINCT FROM OLD.insurer_contract_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.status <> 'DRAFT'
         AND ((NEW.period, NEW.total_minor, NEW.issued_by, NEW.second_validated_by, NEW.approval_id,
               NEW.issued_at)
              IS DISTINCT FROM (OLD.period, OLD.total_minor, OLD.issued_by, OLD.second_validated_by,
                                OLD.approval_id, OLD.issued_at)))
     OR NOT ((OLD.status = NEW.status AND OLD.status <> 'PAID')
             OR (OLD.status = 'DRAFT' AND NEW.status = 'ISSUED')
             OR (OLD.status = 'ISSUED' AND NEW.status IN ('PAID', 'DISPUTED'))
             OR (OLD.status = 'DISPUTED' AND NEW.status = 'PAID')) THEN
    RAISE EXCEPTION 'insurer_bordereau: identité figée ou transition invalide'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'bordereau_transition_guard';
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'ISSUED'
     AND NOT EXISTS (SELECT 1 FROM core.settlement_finance_approval AS f
                      WHERE f.id = NEW.approval_id AND f.action = 'ISSUE_BORDEREAU'
                        AND f.subject_id = NEW.id AND f.status = 'APPROVED'
                        AND f.requested_by = NEW.issued_by AND f.approved_by = NEW.second_validated_by) THEN
    RAISE EXCEPTION 'insurer_bordereau: émission sans demande approuvée par deux personnes'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'bordereau_two_person_rule';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.settlement_insurer_bordereau_guard() FROM PUBLIC;

CREATE TRIGGER finance_approval_guard BEFORE UPDATE ON core.settlement_finance_approval
  FOR EACH ROW EXECUTE FUNCTION core.settlement_finance_approval_guard();
CREATE TRIGGER advance_transition_guard BEFORE UPDATE ON core.settlement_platform_advance
  FOR EACH ROW EXECUTE FUNCTION core.settlement_platform_advance_guard();
CREATE TRIGGER bordereau_transition_guard BEFORE UPDATE ON core.settlement_insurer_bordereau
  FOR EACH ROW EXECUTE FUNCTION core.settlement_insurer_bordereau_guard();
CREATE TRIGGER settlement_immutable BEFORE UPDATE ON core.settlement_insurer_bordereau_line
  FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_platform_advance
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_insurer_ledger_state
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
CREATE TRIGGER touch_row BEFORE UPDATE ON core.settlement_insurer_bordereau
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_finance_approval
  FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_platform_advance
  FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_insurer_ledger_state
  FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_insurer_bordereau
  FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_insurer_bordereau_line
  FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_finance_approval
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_platform_advance
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_insurer_ledger_state
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_insurer_bordereau
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_insurer_bordereau_line
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete();

-- 3. RLS : ENABLE + FORCE, socle migrator_all ----------------------------------------------------

ALTER TABLE core.settlement_finance_approval ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_finance_approval FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_platform_advance ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_platform_advance FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer_ledger_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer_ledger_state FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer_bordereau ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer_bordereau FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer_bordereau_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer_bordereau_line FORCE ROW LEVEL SECURITY;

CREATE POLICY migrator_all ON core.settlement_finance_approval TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_platform_advance TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_insurer_ledger_state TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_insurer_bordereau TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_insurer_bordereau_line TO migrator USING (true) WITH CHECK (true);

REVOKE ALL ON core.settlement_finance_approval, core.settlement_platform_advance,
  core.settlement_insurer_ledger_state, core.settlement_insurer_bordereau,
  core.settlement_insurer_bordereau_line FROM PUBLIC;

-- 4. Lectures d'app_api, par colonnes (aucun identifiant du personnel) ---------------------------

GRANT SELECT (id, action, subject_id, country_code, reason, requested_at, approved_at, status)
  ON core.settlement_finance_approval TO app_api;
GRANT SELECT (id, country_code, currency, trip_id, org_id, cause, amount_minor, funded_from,
              receivable_minor, recovered_minor, status, written_off_at, created_at, updated_at)
  ON core.settlement_platform_advance TO app_api;
GRANT SELECT (insurer_id, country_code, currency, payable_minor, frozen_minor, receivable_minor,
              next_bordereau_at, created_at, updated_at)
  ON core.settlement_insurer_ledger_state TO app_api;
GRANT SELECT (id, insurer_id, insurer_contract_id, country_code, currency, period, total_minor, status,
              issued_at, paid_at, created_at, updated_at)
  ON core.settlement_insurer_bordereau TO app_api;
GRANT SELECT (bordereau_id, country_code, trip_id, segment_no, amount_minor)
  ON core.settlement_insurer_bordereau_line TO app_api;

-- FINANCE et ADMIN du pays seulement (17 §2.3 fin_read) : jamais OPS, SUPPORT, l'hôte, le voyageur.
CREATE POLICY fin_read ON core.settlement_finance_approval FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));
CREATE POLICY fin_read ON core.settlement_platform_advance FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));
CREATE POLICY fin_read ON core.settlement_insurer_ledger_state FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));
CREATE POLICY fin_read ON core.settlement_insurer_bordereau FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));
CREATE POLICY fin_read ON core.settlement_insurer_bordereau_line FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));
-- Hôte TITULAIRE : ses avances de cause RELEASED_LEG (sa créance, 08 E7 règle 3 bis), servies
-- par host_advance_v ; jamais un co-hôte, même muni de la permission (RLS-26, RLS-28).
CREATE POLICY advance_host_read ON core.settlement_platform_advance FOR SELECT TO app_api
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id() AND cause = 'RELEASED_LEG'
         AND app.is_org_holder() AND app.vehicle_scope() IS NULL
         AND app.has_permission('finance.read_org_statements'));

CREATE VIEW core.settlement_host_advance_v WITH (security_invoker = true) AS
  SELECT a.id, a.trip_id, a.country_code, a.currency, a.amount_minor, a.receivable_minor,
         a.recovered_minor, a.receivable_minor - a.recovered_minor AS outstanding_minor,
         a.status, a.created_at
    FROM core.settlement_platform_advance AS a
   WHERE a.cause = 'RELEASED_LEG';
COMMENT ON VIEW core.settlement_host_advance_v IS
  'host_advance_v (17 §2.3, RLS-26) : créance de l''hôte titulaire, sans identifiant du personnel. US-062.';
REVOKE ALL ON core.settlement_host_advance_v FROM PUBLIC;
GRANT SELECT ON core.settlement_host_advance_v TO app_api;

-- 5. Lectures des travailleurs (liste blanche de 17 §2.3), aucune écriture ------------------------

-- par colonnes pour les avances et les bordereaux : aucun identifiant du personnel (revue
-- sécurité US-062) ; position de l'assureur et lignes : tables entières (aucun identifiant)
GRANT SELECT (id, country_code, currency, trip_id, org_id, insurer_id, cause, amount_minor,
              funded_from, receivable_minor, recovered_minor, status, decision_approval_id,
              written_off_at, write_off_approval_id, created_at, updated_at, row_version)
  ON core.settlement_platform_advance TO app_worker;
GRANT SELECT (id, insurer_id, insurer_contract_id, country_code, currency, period, total_minor,
              status, approval_id, issued_at, paid_at, psp_release_ref, created_at, updated_at,
              row_version)
  ON core.settlement_insurer_bordereau TO app_worker;
GRANT SELECT ON core.settlement_insurer_ledger_state, core.settlement_insurer_bordereau_line
  TO app_worker;
CREATE POLICY worker_money_read ON core.settlement_platform_advance FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));
CREATE POLICY worker_money_read ON core.settlement_insurer_ledger_state FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));
CREATE POLICY worker_money_read ON core.settlement_insurer_bordereau FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));
CREATE POLICY worker_money_read ON core.settlement_insurer_bordereau_line FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));

-- 6. Propriétaire des commandes d'argent : droits au plus juste ----------------------------------

GRANT EXECUTE ON FUNCTION app.country_scope() TO cmd_money_owner;

GRANT SELECT ON core.settlement_finance_approval, core.settlement_platform_advance,
  core.settlement_insurer_ledger_state, core.settlement_insurer_bordereau,
  core.settlement_insurer_bordereau_line TO cmd_money_owner;
GRANT INSERT (id, action, subject_id, country_code, reason, requested_by, status)
  ON core.settlement_finance_approval TO cmd_money_owner;
GRANT UPDATE (approved_by, approved_at, status) ON core.settlement_finance_approval TO cmd_money_owner;
GRANT INSERT (id, country_code, currency, trip_id, org_id, insurer_id, cause, amount_minor,
              funded_from, receivable_minor)
  ON core.settlement_platform_advance TO cmd_money_owner;
GRANT UPDATE (recovered_minor, status, decided_by, decision_second_by, decision_approval_id,
              written_off_by, write_off_second_by, write_off_approval_id, written_off_at)
  ON core.settlement_platform_advance TO cmd_money_owner;
GRANT INSERT (insurer_id, country_code, currency, payable_minor, frozen_minor, receivable_minor,
              next_bordereau_at)
  ON core.settlement_insurer_ledger_state TO cmd_money_owner;
GRANT UPDATE (payable_minor, frozen_minor, receivable_minor, next_bordereau_at)
  ON core.settlement_insurer_ledger_state TO cmd_money_owner;
GRANT INSERT (id, insurer_id, insurer_contract_id, country_code, currency, period, total_minor)
  ON core.settlement_insurer_bordereau TO cmd_money_owner;
GRANT UPDATE (status, issued_by, second_validated_by, approval_id, issued_at)
  ON core.settlement_insurer_bordereau TO cmd_money_owner;
GRANT INSERT ON core.settlement_insurer_bordereau_line TO cmd_money_owner;

-- Une politique par commande SQL ; acteur et travailleur contrôlés dans la politique ; aucune
-- politique DELETE.
CREATE POLICY cmd_money_sel ON core.settlement_finance_approval FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.settlement_platform_advance FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.settlement_insurer_ledger_state FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.settlement_insurer_bordereau FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.settlement_insurer_bordereau_line FOR SELECT TO cmd_money_owner USING (true);

CREATE POLICY cmd_money_ins ON core.settlement_finance_approval FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'STAFF' AND status = 'PENDING' AND approved_by IS NULL
              AND country_code = ANY (app.country_scope()));
CREATE POLICY cmd_money_upd ON core.settlement_finance_approval FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'STAFF' AND status = 'PENDING')
  WITH CHECK (app.actor_kind() = 'STAFF' AND status IN ('APPROVED', 'REJECTED')
              AND country_code = ANY (app.country_scope()));

-- avance : créée OUVERTE par le règlement ou les versements (US-224, US-709), sans décision ;
CREATE POLICY cmd_money_ins ON core.settlement_platform_advance FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('settlement', 'payout')
              AND status = 'OPEN' AND recovered_minor = 0
              AND decided_by IS NULL AND written_off_by IS NULL);
-- cmd_advance_upd (17 §2.3 ; réserve 3 d'US-056) : un travailleur fait avancer le recouvrement,
-- JAMAIS jusqu'à WRITTEN_OFF ni jusqu'à une décision ; le staff (commande d'approbation) décide ou
-- passe en perte dans sa portée pays. Les triggers exigent en plus la demande approuvée.
CREATE POLICY cmd_advance_upd ON core.settlement_platform_advance FOR UPDATE TO cmd_money_owner
  USING ((app.actor_kind() = 'WORKER' AND app.worker_name() IN ('settlement', 'payout')
          AND status IN ('OPEN', 'RECOVERING'))
      OR (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
          AND status IN ('OPEN', 'RECOVERING')))
  WITH CHECK ((app.actor_kind() = 'WORKER' AND app.worker_name() IN ('settlement', 'payout')
               AND status IN ('OPEN', 'RECOVERING', 'RECOVERED') AND written_off_by IS NULL)
           OR (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
               AND status IN ('OPEN', 'RECOVERING', 'WRITTEN_OFF')));

CREATE POLICY cmd_money_ins ON core.settlement_insurer_ledger_state FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('settlement', 'bordereau'));
CREATE POLICY cmd_money_upd ON core.settlement_insurer_ledger_state FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('settlement', 'bordereau'))
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('settlement', 'bordereau'));

CREATE POLICY cmd_money_ins ON core.settlement_insurer_bordereau FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'bordereau' AND status = 'DRAFT');
-- émission : seulement par la commande d'approbation (staff de la portée pays)
CREATE POLICY cmd_money_upd ON core.settlement_insurer_bordereau FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope()) AND status = 'DRAFT')
  WITH CHECK (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope()) AND status = 'ISSUED');

CREATE POLICY cmd_money_ins ON core.settlement_insurer_bordereau_line FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'bordereau');

-- Session de staff, matrice et journal (aides de la console, ADR-062 ; SECURITY INVOKER) :
-- lectures au plus juste par politiques dédiées, écriture au journal en ajout seul.
GRANT SELECT (id, user_id, token_hash, expires_at, revoked_at, mfa_level) ON core.iam_session
  TO cmd_money_owner;
GRANT SELECT (id, status) ON core.iam_user_account TO cmd_money_owner;
GRANT SELECT (user_id, role, country_scope, expires_at) ON core.iam_staff_role_assignment
  TO cmd_money_owner;
GRANT SELECT (role, permission_code, valid_from, valid_to) ON core.iam_role_permission
  TO cmd_money_owner;
GRANT INSERT (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after,
              reason, request_id)
  ON core.audit_audit_log TO cmd_money_owner;
GRANT SELECT (id) ON core.audit_audit_log TO cmd_money_owner;        -- RETURNING id
CREATE POLICY cmd_money_sel ON core.iam_session FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.iam_user_account FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.iam_staff_role_assignment FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.iam_role_permission FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.audit_audit_log FOR INSERT TO cmd_money_owner WITH CHECK (true);
CREATE POLICY cmd_money_sel ON core.audit_audit_log FOR SELECT TO cmd_money_owner USING (true);
GRANT EXECUTE ON FUNCTION core.iam_staff_session(bytea),
  core.iam_staff_permitted(uuid, text, text[], text[]),
  core.iam_staff_audit(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid),
  core.iam_staff_audit_countries(uuid, text, uuid, jsonb, jsonb) TO cmd_money_owner;

-- 7. Commandes FINANCE à deux personnes (SECURITY DEFINER, cmd_money_owner, EXECUTE app_api) ----
-- Issues (aucune erreur levée pour un refus : il est journalisé puis rendu, l'API répond 403) :
-- AUTH_REQUIRED (aucune session vivante, ou contexte non STAFF : non journalisé, aucun acteur),
-- MFA_REQUIRED, FORBIDDEN (permission, pays, sujet introuvable ou inéligible : même issue, aucun
-- oracle d'existence), DUPLICATE, ALREADY_PENDING, REQUESTED ; puis SELF_APPROVAL, NOT_PENDING,
-- SUBJECT_CHANGED, APPROVED. Motif de 10 à 1000 caractères, sinon 22023.

CREATE FUNCTION core.settlement_cmd_request_finance_action(p_token_hash bytea, p_request_id uuid,
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
     WHERE a.id = p_subject_id AND a.status = 'OPEN' AND a.decided_by IS NULL;
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

CREATE FUNCTION core.settlement_cmd_approve_finance_action(p_token_hash bytea, p_approval_id uuid)
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
  -- verrous : la demande, puis le sujet ; le sujet doit être resté éligible
  PERFORM 1 FROM core.settlement_finance_approval AS f WHERE f.id = v_f.id AND f.status = 'PENDING'
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_f.id;
    RETURN;
  END IF;
  IF v_f.action = 'DECIDE_ADVANCE' THEN
    PERFORM 1 FROM core.settlement_platform_advance AS a
     WHERE a.id = v_f.subject_id AND a.status = 'OPEN' AND a.decided_by IS NULL FOR UPDATE;
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

-- Les deux approbateurs d'une avance (17 §2.3 advance_approvers) : FINANCE / ADMIN de la portée
-- pays, session élevée seulement ; aucune ligne pour tout autre appelant (hôte compris, RLS-26).
CREATE FUNCTION core.settlement_advance_approvers(p_token_hash bytea, p_advance_id uuid)
  RETURNS TABLE (decided_by uuid, decision_second_by uuid, written_off_by uuid,
                 write_off_second_by uuid)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.decided_by, a.decision_second_by, a.written_off_by, a.write_off_second_by
    FROM core.settlement_platform_advance AS a
    CROSS JOIN core.iam_staff_session(p_token_hash) AS s
   WHERE a.id = p_advance_id
     AND app.actor_kind() = 'STAFF'
     AND s.mfa_level = 'TOTP'
     AND a.country_code = ANY (COALESCE(app.country_scope(), '{}'::text[]))
     AND core.iam_staff_permitted(s.user_id, 'finance.platform_advance', ARRAY[a.country_code], NULL)
         IS NOT NULL
$fn$;

COMMENT ON FUNCTION core.settlement_cmd_request_finance_action(bytea, uuid, text, uuid, text) IS
  'Demande FINANCE (DECIDE_ADVANCE, WRITE_OFF_RECEIVABLE, ISSUE_BORDEREAU), sans effet : 17 §2.3. US-062.';
COMMENT ON FUNCTION core.settlement_cmd_approve_finance_action(bytea, uuid) IS
  'Approbation FINANCE par une SECONDE personne, effet dans la même transaction : 17 §2.3. US-062.';
COMMENT ON FUNCTION core.settlement_advance_approvers(bytea, uuid) IS
  'Approbateurs d''une avance, pour FINANCE / ADMIN de la portée pays seulement. US-062.';

REVOKE ALL ON FUNCTION core.settlement_cmd_request_finance_action(bytea, uuid, text, uuid, text),
  core.settlement_cmd_approve_finance_action(bytea, uuid),
  core.settlement_advance_approvers(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.settlement_cmd_request_finance_action(bytea, uuid, text, uuid, text),
  core.settlement_cmd_approve_finance_action(bytea, uuid),
  core.settlement_advance_approvers(bytea, uuid) TO app_api;

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.settlement_cmd_request_finance_action(bytea, uuid, text, uuid, text)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.settlement_cmd_approve_finance_action(bytea, uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.settlement_advance_approvers(bytea, uuid) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
