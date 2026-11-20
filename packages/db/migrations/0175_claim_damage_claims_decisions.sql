-- 0175 — CLM : déclarations de dommage de l'hôte et d'incident du voyageur, décisions motivées par
-- gabarit, exécution par Kmino (débit MIT séparé, franchise de l'hôte au host_ledger, déclaration à
-- l'assureur partenaire journalisée) et gel du versement de l'hôte pendant la réclamation.
-- US-309 ; 19 US-309 (critères 1 à 4) ; 16 CLM-001 / CLM-002, CLM-006, ADM-008, LEG-024, EC-12,
-- EC-13, EC-41, EC-47, EC-56 ; 08 BR-DAMAGE-01 à 04 et 06, BR-PAY-09 bis (REQ-PAY-DMG-02, 05, 06,
-- « Jambes d'un débit de dommage »), BR-PROT-06, E7 règle 7, BR-REIMB-03, BR-TT-05, BR-FUEL-03 ;
-- 17 v6 §2.2 (CLM), §2.3 (`claim.declare`, `dispute.decide`), §3.2.11 (`decision`) ; 22 OQ-BR-24,
-- OQ-P2P-03 ; ADR-122 / ADR-177 (séparation des tâches), ADR-184 (dossier de preuve), ADR-187
-- (host_ledger), ADR-189 (débits post-trip, « Pour US-309 »), ADR-195 (cette migration, PROPOSÉ).
-- Pré-mortem du lot 3 : L3-PM-03, 24, 27, 28, 34, 55 ; red team RT-L3-S03, M04, H09, V04, P03.
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-195, PROPOSÉS, fail-closed, comme Turo adapté au PA / PY) :
--   1. Déclaration (RECORD_CLAIM) : l'ops enregistre, depuis un dossier de support CLAIM OUVERT du
--      trip qui lui est assigné (ADMIN : tout dossier de son pays), la déclaration de dommage de
--      l'hôte ou d'incident du voyageur (`declaredBy` HOST ou GUEST, `kind` DAMAGE ou INCIDENT).
--      Déclarant relu en base (titulaire du compte d'hôte ou voyageur du trip, jamais reçu).
--      Délai : `claim_deadline` = max(fin prévue, retour effectif) + `claim_declaration_window_h`
--      (08 BR-DAMAGE-01, R15), à l'heure de la base au moment de l'enregistrement ; au-delà ⇒
--      `CLAIM_DEADLINE_PASSED` (aucune écriture, refus journalisé) ; paramètre absent ⇒
--      `CLAIM_WINDOW_UNKNOWN` (refus). Une déclaration vivante par (trip, déclarant, nature).
--   2. Gel (16 CLM-001, US-314) : tant qu'une réclamation du trip n'a pas de décision exécutée, le
--      lot de versement de l'hôte qui porte ce trip est ON_HOLD (motif `CLAIM`, relu à la
--      préparation, à la compensation et avant l'envoi) ; quel que soit le déclarant (hôte contre
--      le voyageur, ou voyageur contre l'hôte) : la décision peut débiter l'hôte ; levé par la
--      seule décision exécutée.
--   3. Décision (ISSUE_DECISION) par gabarit, `dispute.decide`, aperçu sans écriture puis
--      enregistrement : faits (motif écrit de 20 à 2 000 caractères, sinon
--      `DECISION_RATIONALE_REQUIRED` ; jamais « définitive » : `DECISION_FINALITY_FORBIDDEN`,
--      OQ-BR-24), preuves relues par la base, règle (par issue), montants, recours (toujours cité,
--      rendu par la console). Lignes saisies par l'ops (16 CLM-006 bêta : « montants par jambe
--      saisis par l'ops et contrôlés ») : réparation ⇒ HOST, recours de l'assureur ⇒ INSURER,
--      frais de traitement ⇒ PLATFORM, sa taxe ⇒ TAX_THIRD_PARTY ; parking de récupération
--      (BR-TT-05) et frais non imputable au voyageur (BR-FUEL-03) EXCLUS par le gabarit
--      (`NOT_RECHARGEABLE`, jamais dans le montant). Σ des jambes ≠ montant ⇒ `LEG_SUM_MISMATCH`.
--      Retenue (montant > 0) sans séries de photos de départ ET de retour ⇒
--      `CLAIM_DECISION_WITHOUT_EVIDENCE` (LEG-024). Plafonds avant tout débit (ADR-189 c) :
--      montant ≤ franchise du voyageur acceptée au contrat signé (« montant accepté », BR-DAMAGE-06,
--      REQ-PAY-DMG-06 ; inconnue ⇒ `CLAIM_CAP_UNKNOWN`) ; réparation imputée et franchise de l'hôte
--      ≤ coût de réparation constaté. Accord écrit postérieur au constat (REQ-PAY-DMG-05) : pièce
--      du seau des preuves, jamais un booléen seul (ADR-189 b).
--   4. Conflit d'intérêts (ADR-122, ADR-177, RT-L3-H09) : jamais un agent partie au trip, co-hôte
--      ou compte lié, ADMIN compris ; refus journalisé. Seuil de la décision ADMIN (16 CLM-006
--      « décision au-delà d'un seuil, PROPOSÉ ») : aucun seuil fixé ⇒ toute décision qui débite le
--      voyageur ou l'hôte est réservée à ADMIN (`DECISION_ADMIN_REQUIRED`).
--   5. Exécution par Kmino, jamais par l'hôte (travailleur `payment_command`) : débit SÉPARÉ du
--      voyageur par `core.payment_cmd_notify_post_trip_charge` (but DAMAGE, motif DAMAGE_SEPARATE,
--      origine `CLAIM_DECISION`, montant explicite de chaque jambe, BR-PAY-09 bis ; jamais la
--      caution, REQ-PAY-DMG-02, L3-PM-24) ; franchise de l'hôte = écriture
--      `CLAIM_HOST_DEDUCTIBLE` (débit) du host_ledger (E7 règle 7), jamais une jambe ; déclaration
--      à l'assureur partenaire journalisée (`core.claim_insurer_declaration`, sans engagement de
--      prise en charge, OQ-P2P-03), envoyée par le port de l'assureur seulement quand
--      `insurer_contract_active[pays]` est vrai (lu en base, absent ⇒ faux ; FAKE en tests).
--   6. Écritures par commandes seulement ; RLS ENABLE + FORCE ; aucun droit applicatif sur les
--      tables ; heure de la base ; aucune constante de pays ; aucun interrupteur écrit.
--
-- Codes (packages/db/src/errors.ts) : claim_command_forbidden (42501) → FORBIDDEN ;
-- claim_record_immutable (23000) → IMMUTABLE_RECORD ; claim_decision_conflict (23000) →
-- IDEMPOTENCY_CONFLICT.
--
-- Expand / contract : tables, fonctions, politiques et colonne `claim_decision_id` du host_ledger
-- AJOUTÉES ; motif `CLAIM_HOST_DEDUCTIBLE` ajouté aux contraintes du host_ledger (remplacées sous
-- le même nom, élargies) ; `core.payout_batch_hold_reasons` remplacée à signature identique (corps
-- de 0167 recopié, un bloc marqué US-309). La version N de l'API n'appelle pas les nouvelles
-- fonctions.
--
-- Retour arrière (jamais en production : nouvelle migration) :
--   réappliquer core.payout_batch_hold_reasons de 0167 (sous cmd_money_owner) ;
--   DROP FUNCTION core.support_staff_record_claim(bytea, uuid, uuid, uuid, text, text, text),
--     core.support_staff_claim(bytea, uuid, uuid),
--     core.support_staff_issue_decision(bytea, uuid, uuid, jsonb, boolean),
--     core.claim_cmd_record_claim(uuid, uuid, uuid, text, text, text, uuid, text, uuid),
--     core.claim_cmd_issue_decision(uuid, uuid, uuid, text, uuid, jsonb, boolean),
--     core.claim_claim_view(uuid), core.claim_decisions_due(integer),
--     core.claim_cmd_execute_decision(uuid, uuid), core.claim_cmd_defer_decision(uuid, text),
--     core.claim_insurer_declarations_due(integer),
--     core.claim_cmd_record_insurer_declaration(uuid, text), core.claim_trip_facts(uuid),
--     core.claim_record_guard() ;
--   DROP POLICY cmd_money_ins_claim_deductible ON core.settlement_host_ledger_entry ;
--   remettre host_ledger_reason_valid, host_ledger_link_shape et les deux uniques de 0167 ;
--   ALTER TABLE core.settlement_host_ledger_entry DROP COLUMN claim_decision_id ;
--   DROP TABLE core.claim_insurer_declaration, core.claim_decision, core.claim_damage_claim ;
--   DROP POLICY cmd_hold_claim_param_read ON core.config_param_value.

-- 1. Tables ---------------------------------------------------------------------------------------

-- 1.1 Déclaration (17 §2.2 `claim`, `incident_report` ; classe A : jamais supprimée)
CREATE TABLE core.claim_damage_claim (
  id                uuid        CONSTRAINT claim_damage_claim_pkey PRIMARY KEY,
  trip_id           uuid        NOT NULL,
  country_code      text        NOT NULL
    CONSTRAINT claim_damage_claim_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency          text        NOT NULL
    CONSTRAINT claim_damage_claim_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  -- dossier de support CLAIM par lequel la déclaration est arrivée (assigné à l'agent)
  case_id           uuid        NOT NULL
    CONSTRAINT claim_damage_claim_case_fk REFERENCES core.support_support_case (id),
  declared_by       text        NOT NULL
    CONSTRAINT claim_damage_claim_declared_by_valid CHECK (declared_by IN ('HOST', 'GUEST')),
  kind              text        NOT NULL
    CONSTRAINT claim_damage_claim_kind_valid CHECK (kind IN ('DAMAGE', 'INCIDENT')),
  -- déclarant relu en base : titulaire du compte d'hôte (HOST) ou voyageur du trip (GUEST)
  declarant_user_id uuid        NOT NULL
    CONSTRAINT claim_damage_claim_declarant_fk REFERENCES core.iam_user_account (id),
  recorded_by       uuid        NOT NULL
    CONSTRAINT claim_damage_claim_recorded_by_fk REFERENCES core.iam_user_account (id),
  recorded_role     text        NOT NULL
    CONSTRAINT claim_damage_claim_role_valid CHECK (recorded_role IN ('OPS_AGENT', 'ADMIN')),
  request_id        uuid        NOT NULL
    CONSTRAINT claim_damage_claim_request_unique UNIQUE,
  -- [C2] résumé de la déclaration écrit par l'agent (consigne : aucun nom ni contact)
  description       text        NOT NULL
    CONSTRAINT claim_damage_claim_description_length
      CHECK (pg_catalog.char_length(description) BETWEEN 10 AND 1000),
  trip_end_at       timestamptz NOT NULL,
  deadline_at       timestamptz NOT NULL,
  reported_at       timestamptz NOT NULL DEFAULT platform.now(),
  status            text        NOT NULL DEFAULT 'REPORTED'
    CONSTRAINT claim_damage_claim_status_valid CHECK (status IN ('REPORTED', 'DECIDED')),
  decided_at        timestamptz,
  CONSTRAINT claim_damage_claim_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  CONSTRAINT claim_damage_claim_in_time CHECK (reported_at <= deadline_at),
  CONSTRAINT claim_damage_claim_deadline_after_end CHECK (deadline_at >= trip_end_at),
  CONSTRAINT claim_damage_claim_decided_shape CHECK ((status = 'DECIDED') = (decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX claim_damage_claim_live_unique ON core.claim_damage_claim
  (trip_id, declared_by, kind) WHERE (status = 'REPORTED');
CREATE INDEX claim_damage_claim_trip_idx ON core.claim_damage_claim (trip_id);
COMMENT ON TABLE core.claim_damage_claim IS
  'CLM claim / incident_report (17 §2.2) : déclaration de dommage de l''hôte ou d''incident du '
  'voyageur enregistrée par l''ops dans le délai (claim_deadline, heure de la base), depuis un '
  'dossier de support CLAIM. Écrite par core.claim_cmd_record_claim seulement. US-309 (ADR-195).';

-- 1.2 Décision motivée (17 §3.2.11 `decision`, classe A ; une par déclaration)
CREATE TABLE core.claim_decision (
  id                        uuid        CONSTRAINT claim_decision_pkey PRIMARY KEY,
  claim_id                  uuid        NOT NULL
    CONSTRAINT claim_decision_claim_fk REFERENCES core.claim_damage_claim (id)
    CONSTRAINT claim_decision_claim_unique UNIQUE,
  trip_id                   uuid        NOT NULL,
  country_code              text        NOT NULL
    CONSTRAINT claim_decision_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency                  text        NOT NULL
    CONSTRAINT claim_decision_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  outcome                   text        NOT NULL
    CONSTRAINT claim_decision_outcome_valid CHECK (outcome IN
      ('GUEST_LIABLE', 'NO_GUEST_CHARGE', 'INELIGIBLE')),
  -- le dommage relève de la protection : déclaration à l'assureur partenaire
  covered                   boolean     NOT NULL,
  repair_cost_minor         bigint      NOT NULL
    CONSTRAINT claim_decision_repair_nonneg CHECK (repair_cost_minor >= 0),
  -- débit séparé du voyageur (franchise du voyageur, BR-PAY-09 bis) et ses jambes explicites
  charge_amount_minor       bigint      NOT NULL
    CONSTRAINT claim_decision_charge_nonneg CHECK (charge_amount_minor >= 0),
  leg_host_minor            bigint      NOT NULL
    CONSTRAINT claim_decision_host_nonneg CHECK (leg_host_minor >= 0),
  leg_insurer_minor         bigint      NOT NULL
    CONSTRAINT claim_decision_insurer_nonneg CHECK (leg_insurer_minor >= 0),
  leg_tax_third_party_minor bigint      NOT NULL
    CONSTRAINT claim_decision_tax_nonneg CHECK (leg_tax_third_party_minor >= 0),
  leg_platform_minor        bigint      NOT NULL
    CONSTRAINT claim_decision_platform_nonneg CHECK (leg_platform_minor >= 0),
  -- franchise de l'hôte selon son plan (BR-PROT-06) : ajustement du host_ledger, jamais une jambe
  host_deductible_minor     bigint      NOT NULL
    CONSTRAINT claim_decision_deductible_nonneg CHECK (host_deductible_minor >= 0),
  -- franchise du voyageur acceptée au contrat signé (plafond relu à la décision)
  guest_cap_minor           bigint
    CONSTRAINT claim_decision_cap_nonneg CHECK (guest_cap_minor IS NULL OR guest_cap_minor >= 0),
  lines                     jsonb       NOT NULL
    CONSTRAINT claim_decision_lines_array CHECK (pg_catalog.jsonb_typeof(lines) = 'array'),
  excluded                  jsonb       NOT NULL
    CONSTRAINT claim_decision_excluded_array CHECK (pg_catalog.jsonb_typeof(excluded) = 'array'),
  evidence                  jsonb       NOT NULL
    CONSTRAINT claim_decision_evidence_object CHECK (pg_catalog.jsonb_typeof(evidence) = 'object'),
  -- [C2] faits du gabarit écrits par l'agent (consigne : aucun nom ni contact)
  facts                     text        NOT NULL
    CONSTRAINT claim_decision_facts_length CHECK (pg_catalog.char_length(facts) BETWEEN 20 AND 2000),
  -- accord écrit du voyageur postérieur au constat (REQ-PAY-DMG-05) : pièce du seau des preuves
  guest_agreement_file_id   uuid
    CONSTRAINT claim_decision_agreement_fk REFERENCES core.audit_file_asset (id),
  decided_by                uuid        NOT NULL
    CONSTRAINT claim_decision_decided_by_fk REFERENCES core.iam_user_account (id),
  decided_role              text        NOT NULL
    CONSTRAINT claim_decision_role_valid CHECK (decided_role IN ('OPS_AGENT', 'ADMIN')),
  request_id                uuid        NOT NULL
    CONSTRAINT claim_decision_request_unique UNIQUE,
  decided_at                timestamptz NOT NULL DEFAULT platform.now(),
  execution_status          text        NOT NULL
    CONSTRAINT claim_decision_execution_valid CHECK (execution_status IN ('PENDING', 'DONE', 'BLOCKED')),
  execution_code            text
    CONSTRAINT claim_decision_execution_code_format CHECK (
      execution_code IS NULL OR execution_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  charge_id                 uuid
    CONSTRAINT claim_decision_charge_fk REFERENCES core.payment_post_trip_charge (id),
  executed_at               timestamptz,
  next_check_at             timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT claim_decision_legs_sum CHECK (
    leg_host_minor + leg_insurer_minor + leg_tax_third_party_minor + leg_platform_minor
      = charge_amount_minor),
  -- issue et montants : seule une retenue débite le voyageur ; une déclaration inéligible ne
  -- déclare rien à l'assureur et ne débite pas l'hôte ; la franchise de l'hôte suppose la protection
  CONSTRAINT claim_decision_outcome_shape CHECK (
    ((outcome = 'GUEST_LIABLE') = (charge_amount_minor > 0))
    AND (outcome <> 'INELIGIBLE' OR (NOT covered AND host_deductible_minor = 0))
    AND (host_deductible_minor = 0 OR covered)),
  CONSTRAINT claim_decision_caps CHECK (
    (charge_amount_minor = 0 OR (guest_cap_minor IS NOT NULL AND charge_amount_minor <= guest_cap_minor))
    AND leg_host_minor + leg_insurer_minor <= repair_cost_minor
    AND host_deductible_minor <= repair_cost_minor),
  CONSTRAINT claim_decision_executed_shape CHECK (
    (execution_status = 'DONE') = (executed_at IS NOT NULL)
    AND (execution_status <> 'BLOCKED' OR execution_code IS NOT NULL))
);
CREATE INDEX claim_decision_due_idx ON core.claim_decision (next_check_at)
  WHERE (execution_status = 'PENDING');
CREATE INDEX claim_decision_trip_idx ON core.claim_decision (trip_id);
COMMENT ON TABLE core.claim_decision IS
  'CLM decision (17 §3.2.11) : décision motivée par gabarit d''une déclaration (ADM-008, LEG-024), '
  'jamais « définitive » ; débit séparé du voyageur aux jambes explicites, franchise de l''hôte, '
  'déclaration à l''assureur ; exécutée par Kmino (travailleur payment_command). US-309 (ADR-195).';

-- 1.3 Déclaration à l'assureur partenaire (journal ; sans engagement de prise en charge)
CREATE TABLE core.claim_insurer_declaration (
  id            uuid        CONSTRAINT claim_insurer_declaration_pkey PRIMARY KEY,
  decision_id   uuid        NOT NULL
    CONSTRAINT claim_insurer_declaration_decision_fk REFERENCES core.claim_decision (id)
    CONSTRAINT claim_insurer_declaration_decision_unique UNIQUE,
  claim_id      uuid        NOT NULL
    CONSTRAINT claim_insurer_declaration_claim_fk REFERENCES core.claim_damage_claim (id),
  trip_id       uuid        NOT NULL,
  country_code  text        NOT NULL
    CONSTRAINT claim_insurer_declaration_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  status        text        NOT NULL DEFAULT 'PENDING'
    CONSTRAINT claim_insurer_declaration_status_valid CHECK (status IN ('PENDING', 'SENT')),
  recorded_at   timestamptz NOT NULL DEFAULT platform.now(),
  sent_at       timestamptz,
  -- référence rendue par le port de l'assureur (FAKE en tests) ; jamais une donnée personnelle
  provider_ref  text
    CONSTRAINT claim_insurer_declaration_ref_format CHECK (
      provider_ref IS NULL OR provider_ref ~ '^[A-Za-z0-9:._-]{1,100}$'),
  CONSTRAINT claim_insurer_declaration_sent_shape CHECK (
    (status = 'SENT') = (sent_at IS NOT NULL) AND (status = 'SENT') = (provider_ref IS NOT NULL))
);
COMMENT ON TABLE core.claim_insurer_declaration IS
  'CLM : déclaration d''un dommage couvert à l''assureur partenaire (16 CLM-001 / CLM-006), '
  'journalisée à l''exécution de la décision, envoyée par le port de l''assureur seulement quand '
  'insurer_contract_active[pays] est vrai ; aucun engagement de prise en charge (OQ-P2P-03). '
  'US-309 (ADR-195).';

-- 1.4 Gardes : registres immuables, transitions bornées, jamais de DELETE ni de TRUNCATE
CREATE FUNCTION core.claim_record_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'claim_damage_claim' THEN
    IF OLD.status = 'REPORTED' AND NEW.status = 'DECIDED' AND NEW.decided_at IS NOT NULL
       AND (NEW.id, NEW.trip_id, NEW.country_code, NEW.currency, NEW.case_id, NEW.declared_by,
            NEW.kind, NEW.declarant_user_id, NEW.recorded_by, NEW.recorded_role, NEW.request_id,
            NEW.description, NEW.trip_end_at, NEW.deadline_at, NEW.reported_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.trip_id, OLD.country_code, OLD.currency, OLD.case_id, OLD.declared_by,
            OLD.kind, OLD.declarant_user_id, OLD.recorded_by, OLD.recorded_role, OLD.request_id,
            OLD.description, OLD.trip_end_at, OLD.deadline_at, OLD.reported_at) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'claim_decision' THEN
    -- seules l'exécution et sa relance changent : PENDING → DONE | BLOCKED, BLOCKED → PENDING ;
    -- le débit est rattaché une fois
    IF (NEW.id, NEW.claim_id, NEW.trip_id, NEW.country_code, NEW.currency, NEW.outcome,
        NEW.covered, NEW.repair_cost_minor, NEW.charge_amount_minor, NEW.leg_host_minor,
        NEW.leg_insurer_minor, NEW.leg_tax_third_party_minor, NEW.leg_platform_minor,
        NEW.host_deductible_minor, NEW.guest_cap_minor, NEW.lines, NEW.excluded, NEW.evidence,
        NEW.facts, NEW.guest_agreement_file_id, NEW.decided_by, NEW.decided_role, NEW.request_id,
        NEW.decided_at)
       IS NOT DISTINCT FROM
       (OLD.id, OLD.claim_id, OLD.trip_id, OLD.country_code, OLD.currency, OLD.outcome,
        OLD.covered, OLD.repair_cost_minor, OLD.charge_amount_minor, OLD.leg_host_minor,
        OLD.leg_insurer_minor, OLD.leg_tax_third_party_minor, OLD.leg_platform_minor,
        OLD.host_deductible_minor, OLD.guest_cap_minor, OLD.lines, OLD.excluded, OLD.evidence,
        OLD.facts, OLD.guest_agreement_file_id, OLD.decided_by, OLD.decided_role, OLD.request_id,
        OLD.decided_at)
       AND (OLD.charge_id IS NULL OR NEW.charge_id IS NOT DISTINCT FROM OLD.charge_id)
       AND (OLD.execution_status = 'PENDING'
            OR (OLD.execution_status = 'BLOCKED' AND NEW.execution_status IN ('BLOCKED', 'PENDING'))
            OR (OLD.execution_status = 'DONE' AND NEW.execution_status = 'DONE'
                AND NEW.executed_at IS NOT DISTINCT FROM OLD.executed_at)) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'claim_insurer_declaration' THEN
    IF OLD.status = 'PENDING' AND NEW.status = 'SENT'
       AND (NEW.id, NEW.decision_id, NEW.claim_id, NEW.trip_id, NEW.country_code, NEW.recorded_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.decision_id, OLD.claim_id, OLD.trip_id, OLD.country_code, OLD.recorded_at) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'claim: % refused on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'claim_record_immutable';
END
$fn$;
COMMENT ON FUNCTION core.claim_record_guard() IS
  'Garde des registres de sinistres : déclaration REPORTED → DECIDED seulement ; décision figée '
  '(seule son exécution change) ; déclaration à l''assureur PENDING → SENT ; jamais de DELETE ni '
  'de TRUNCATE. US-309 (ADR-195).';
REVOKE ALL ON FUNCTION core.claim_record_guard() FROM PUBLIC;
CREATE TRIGGER claim_record_immutable BEFORE UPDATE OR DELETE ON core.claim_damage_claim
  FOR EACH ROW EXECUTE FUNCTION core.claim_record_guard();
CREATE TRIGGER claim_record_immutable BEFORE UPDATE OR DELETE ON core.claim_decision
  FOR EACH ROW EXECUTE FUNCTION core.claim_record_guard();
CREATE TRIGGER claim_record_immutable BEFORE UPDATE OR DELETE ON core.claim_insurer_declaration
  FOR EACH ROW EXECUTE FUNCTION core.claim_record_guard();
CREATE TRIGGER claim_record_no_truncate BEFORE TRUNCATE ON core.claim_damage_claim
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_record_immutable');
CREATE TRIGGER claim_record_no_truncate BEFORE TRUNCATE ON core.claim_decision
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_record_immutable');
CREATE TRIGGER claim_record_no_truncate BEFORE TRUNCATE ON core.claim_insurer_declaration
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_record_immutable');

-- 1.5 RLS : aucun droit applicatif ; commandes sous cmd_money_owner, lecture de l'en-tête par la
-- porte du staff (iam_staff_owner)
ALTER TABLE core.claim_damage_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.claim_damage_claim FORCE ROW LEVEL SECURITY;
ALTER TABLE core.claim_decision ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.claim_decision FORCE ROW LEVEL SECURITY;
ALTER TABLE core.claim_insurer_declaration ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.claim_insurer_declaration FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.claim_damage_claim TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.claim_decision TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.claim_insurer_declaration TO migrator USING (true)
  WITH CHECK (true);
REVOKE ALL ON core.claim_damage_claim, core.claim_decision, core.claim_insurer_declaration
  FROM PUBLIC;

GRANT SELECT, INSERT ON core.claim_damage_claim TO cmd_money_owner;
GRANT UPDATE (status, decided_at) ON core.claim_damage_claim TO cmd_money_owner;
CREATE POLICY cmd_money_claim_sel ON core.claim_damage_claim FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_claim_ins ON core.claim_damage_claim FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'STAFF' AND status = 'REPORTED');
CREATE POLICY cmd_money_claim_upd ON core.claim_damage_claim FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'STAFF' AND status = 'REPORTED')
  WITH CHECK (app.actor_kind() = 'STAFF' AND status = 'DECIDED');

GRANT SELECT, INSERT ON core.claim_decision TO cmd_money_owner;
GRANT UPDATE (execution_status, execution_code, charge_id, executed_at, next_check_at)
  ON core.claim_decision TO cmd_money_owner;
CREATE POLICY cmd_money_claim_sel ON core.claim_decision FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_claim_ins ON core.claim_decision FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'STAFF');
CREATE POLICY cmd_money_claim_upd ON core.claim_decision FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

GRANT SELECT, INSERT ON core.claim_insurer_declaration TO cmd_money_owner;
GRANT UPDATE (status, sent_at, provider_ref) ON core.claim_insurer_declaration TO cmd_money_owner;
CREATE POLICY cmd_money_claim_sel ON core.claim_insurer_declaration FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_claim_ins ON core.claim_insurer_declaration FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND status = 'PENDING');
CREATE POLICY cmd_money_claim_upd ON core.claim_insurer_declaration FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

-- en-tête d'une déclaration (pays, trip, dossier, état) pour la porte du staff ; jamais le texte
GRANT SELECT (id, trip_id, country_code, case_id, status) ON core.claim_damage_claim
  TO iam_staff_owner;
CREATE POLICY iam_staff_claim_sel ON core.claim_damage_claim FOR SELECT TO iam_staff_owner
  USING (true);

-- 2. host_ledger : franchise de l'hôte d'une décision (08 E7 règle 7, BR-PROT-06) ------------------
ALTER TABLE core.settlement_host_ledger_entry
  ADD COLUMN claim_decision_id uuid
    CONSTRAINT host_ledger_claim_decision_fk REFERENCES core.claim_decision (id);

ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_reason_valid,
  ADD CONSTRAINT host_ledger_reason_valid CHECK (reason IN
    ('HOST_CANCELLATION_PENALTY', 'RELEASED_LEG_ADVANCE', 'CHARGEBACK_CLAWBACK', 'PAYOUT_NETTING',
     'RECEIVABLE_WRITE_OFF', 'CLAIM_HOST_DEDUCTIBLE'));

-- forme de 0167, élargie : la franchise d'une décision cite sa décision et aucun règlement (comme
-- la compensation, sans trip : le relevé de gains d'US-217 ne lit que les écritures d'un trip) ;
-- c'est toujours un débit de l'hôte
ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_link_shape,
  ADD CONSTRAINT host_ledger_link_shape CHECK (
    ((reason = 'PAYOUT_NETTING') = (payout_batch_id IS NOT NULL))
    AND ((reason = 'CLAIM_HOST_DEDUCTIBLE') = (claim_decision_id IS NOT NULL))
    AND ((reason IN ('PAYOUT_NETTING', 'CLAIM_HOST_DEDUCTIBLE')) = (settlement_id IS NULL))
    AND ((settlement_id IS NULL) = (trip_id IS NULL))
    AND ((settlement_id IS NULL) = (segment_no IS NULL))
    AND ((settlement_id IS NULL) = (settlement_version IS NULL))
    AND ((reason = 'CHARGEBACK_CLAWBACK') = (chargeback_operation_id IS NOT NULL))
    AND ((reason = 'RECEIVABLE_WRITE_OFF') = (write_off_approval_id IS NOT NULL))
    AND (reason NOT IN ('CHARGEBACK_CLAWBACK', 'CLAIM_HOST_DEDUCTIBLE') OR amount_minor < 0)
    AND (reason NOT IN ('PAYOUT_NETTING', 'RECEIVABLE_WRITE_OFF') OR amount_minor > 0)),
  ADD CONSTRAINT host_ledger_claim_decision_unique UNIQUE (claim_decision_id);

-- idempotence de 0167 : même nom, même sens ; une franchise par décision ne se confond pas
ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_entry_settlement_reason_unique,
  ADD CONSTRAINT host_ledger_entry_settlement_reason_unique
    UNIQUE NULLS NOT DISTINCT (settlement_id, reason, advance_id, chargeback_operation_id,
                               payout_batch_id, write_off_approval_id, claim_decision_id);
ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_entry_version_reason_unique,
  ADD CONSTRAINT host_ledger_entry_version_reason_unique
    UNIQUE NULLS NOT DISTINCT (trip_id, segment_no, settlement_version, reason, advance_id,
                               chargeback_operation_id, payout_batch_id, write_off_approval_id,
                               claim_decision_id);

COMMENT ON COLUMN core.settlement_host_ledger_entry.claim_decision_id IS
  'Décision de sinistre dont l''écriture est la franchise de l''hôte (CLAIM_HOST_DEDUCTIBLE, débit, '
  '08 E7 règle 7) ; une par décision. US-309 (ADR-195).';

GRANT INSERT (claim_decision_id) ON core.settlement_host_ledger_entry TO cmd_money_owner;
CREATE POLICY cmd_money_ins_claim_deductible ON core.settlement_host_ledger_entry FOR INSERT
  TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND reason = 'CLAIM_HOST_DEDUCTIBLE' AND amount_minor < 0
              AND claim_decision_id IS NOT NULL);

-- 3. Faits d'un trip pour la déclaration et la décision (cmd_hold_owner) ---------------------------
-- fin, délai, séries de photos, franchise du voyageur acceptée au contrat signé
GRANT SELECT (id, country_code, currency, org_id, guest_user_id, status, scheduled_end)
  ON core.booking_trip TO cmd_hold_owner;
GRANT SELECT (trip_id, to_status, kind, at) ON core.booking_trip_state_log TO cmd_hold_owner;
CREATE POLICY cmd_hold_claim_param_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key = 'claim_declaration_window_h');

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- Fin du trip = max(fin prévue, premier retour) (08 BR-DAMAGE-01, R15 : « la lecture la plus
-- protectrice pour l'hôte ») ; délai = fin + `claim_declaration_window_h` en vigueur maintenant
-- (absent ou mal formé : NULL, l'appelant refuse) ; séries SUBMITTED de départ et de retour (un côté
-- suffit, US-303 / US-315) ; franchise du voyageur du dernier contrat SIGNÉ par lui (« montant
-- accepté », REQ-PAY-DMG-01 / 06 ; absente : NULL). Trip inconnu : aucune ligne.
CREATE FUNCTION core.claim_trip_facts(p_trip_id uuid)
  RETURNS TABLE (trip_id uuid, country_code text, currency text, org_id uuid, guest_user_id uuid,
                 holder_user_id uuid, status text, end_at timestamptz, window_hours integer,
                 deadline_at timestamptz, checkin_photos boolean, checkout_photos boolean,
                 accepted_deductible_minor bigint)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t       record;
  v_now   timestamptz := platform.now();
  v_ret   timestamptz;
  v_end   timestamptz;
  v_h     jsonb;
  v_hours integer;
  v_cap   text;
BEGIN
  SELECT x.id, x.country_code, x.currency, x.org_id, x.guest_user_id, x.status, x.scheduled_end,
         o.holder_user_id
    INTO t
    FROM core.booking_trip AS x
    LEFT JOIN core.iam_organization AS o ON o.id = x.org_id
   WHERE x.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_catalog.min(l.at) INTO v_ret
    FROM core.booking_trip_state_log AS l
   WHERE l.trip_id = t.id AND l.to_status = 'RETURNED' AND l.kind = 'TRANSITION';
  v_end := GREATEST(t.scheduled_end, COALESCE(v_ret, t.scheduled_end));
  SELECT v.value INTO v_h
    FROM core.config_param_value AS v
   WHERE v.key = 'claim_declaration_window_h' AND v.country_code::text = t.country_code
     AND v.scope_type = 'COUNTRY' AND v.valid_from <= v_now
     AND (v.valid_to IS NULL OR v.valid_to > v_now)
   ORDER BY v.valid_from DESC
   LIMIT 1;
  IF pg_catalog.jsonb_typeof(v_h) = 'number' AND (v_h #>> '{}') ~ '^[1-9][0-9]{0,3}$' THEN
    v_hours := (v_h #>> '{}')::integer;
  END IF;
  SELECT d.terms #>> '{protection,deductibleMinor}' INTO v_cap
    FROM core.contract_generated_document AS d
   WHERE d.trip_id = t.id
     AND EXISTS (SELECT 1 FROM core.contract_signature AS s
                  WHERE s.document_id = d.id AND s.signer_role = 'GUEST')
   ORDER BY d.version DESC, d.generated_at DESC
   LIMIT 1;
  RETURN QUERY
  SELECT t.id, t.country_code, t.currency, t.org_id, t.guest_user_id, t.holder_user_id, t.status,
         v_end, v_hours,
         CASE WHEN v_hours IS NOT NULL THEN v_end + pg_catalog.make_interval(hours => v_hours) END,
         EXISTS (SELECT 1 FROM core.trip_ops_inspection AS i
                  WHERE i.trip_id = t.id AND i.kind = 'CHECKIN' AND i.status = 'SUBMITTED'),
         EXISTS (SELECT 1 FROM core.trip_ops_inspection AS i
                  WHERE i.trip_id = t.id AND i.kind = 'CHECKOUT' AND i.status = 'SUBMITTED'),
         CASE WHEN v_cap ~ '^(0|[1-9][0-9]{0,14})$' THEN v_cap::bigint END;
END
$fn$;
COMMENT ON FUNCTION core.claim_trip_facts(uuid) IS
  'Interne (US-309, ADR-195) : fin du trip (max(fin prévue, retour)), délai de déclaration '
  '(claim_declaration_window_h en vigueur), séries de photos de départ et de retour, franchise du '
  'voyageur acceptée au contrat signé. Aucune donnée nominative. EXECUTE cmd_money_owner.';
REVOKE ALL ON FUNCTION core.claim_trip_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_trip_facts(uuid) TO cmd_money_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 4. Commandes d'argent (cmd_money_owner) ---------------------------------------------------------
-- lectures complémentaires au plus juste : opération de carte du loyer (moyen débité), pièce de
-- l'accord écrit
GRANT SELECT (id, trip_id, hold_id, kind, method, purpose, status, currency, created_at)
  ON core.payment_payment_operation TO cmd_money_owner;
GRANT SELECT (source_hold_id) ON core.booking_trip TO cmd_money_owner;

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 4.1 Enregistrement d'une déclaration (appelé par la porte du staff, qui a déjà jugé la session,
-- la permission, le dossier et la séparation des tâches). Issues : RECORDED (déclaration écrite),
-- ALREADY_RECORDED (rejeu du même identifiant de requête), CLAIM_DEADLINE_PASSED,
-- CLAIM_WINDOW_UNKNOWN (paramètre absent), CLAIM_TRIP_NOT_ELIGIBLE (trip non commencé, annulé),
-- CLAIM_ALREADY_OPEN (une déclaration vivante du même déclarant et de la même nature),
-- REQUEST_INVALID (identifiant pris par une autre déclaration). Entrée mal formée : 22023.
CREATE FUNCTION core.claim_cmd_record_claim(p_claim_id uuid, p_trip_id uuid, p_case_id uuid,
                                            p_declared_by text, p_kind text, p_description text,
                                            p_agent uuid, p_role text, p_request_id uuid)
  RETURNS TABLE (outcome text, claim_id uuid, deadline_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  f      record;
  v_old  core.claim_damage_claim%ROWTYPE;
  v_now  timestamptz;
  v_desc text := pg_catalog.btrim(p_description);
  v_who  uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RAISE EXCEPTION 'claim: record reserved to the staff console'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_command_forbidden';
  END IF;
  IF p_claim_id IS NULL OR p_trip_id IS NULL OR p_case_id IS NULL OR p_agent IS NULL
     OR p_request_id IS NULL OR p_declared_by IS NULL OR p_declared_by NOT IN ('HOST', 'GUEST')
     OR p_kind IS NULL OR p_kind NOT IN ('DAMAGE', 'INCIDENT')
     OR p_role IS NULL OR p_role NOT IN ('OPS_AGENT', 'ADMIN')
     OR v_desc IS NULL OR pg_catalog.char_length(v_desc) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'claim: invalid input' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- une déclaration à la fois par trip (verrou consultatif de transaction)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim.record:' || p_trip_id::text, 0));
  SELECT * INTO v_old FROM core.claim_damage_claim AS c WHERE c.request_id = p_request_id;
  IF v_old.id IS NOT NULL THEN
    IF v_old.trip_id = p_trip_id AND v_old.declared_by = p_declared_by AND v_old.kind = p_kind THEN
      RETURN QUERY SELECT 'ALREADY_RECORDED'::text, v_old.id, v_old.deadline_at;
    ELSE
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz;
    END IF;
    RETURN;
  END IF;
  SELECT * INTO f FROM core.claim_trip_facts(p_trip_id);
  IF f.trip_id IS NULL OR f.status NOT IN ('IN_PROGRESS', 'OVERDUE', 'RETURNED', 'TERMINATED_EARLY',
                                            'POST_TRIP', 'COMPLETED', 'IN_DISPUTE') THEN
    RETURN QUERY SELECT 'CLAIM_TRIP_NOT_ELIGIBLE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF f.deadline_at IS NULL THEN
    RETURN QUERY SELECT 'CLAIM_WINDOW_UNKNOWN'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- heure de la base APRÈS le verrou (16 CLM-001 : « le lendemain à 10:01 » ⇒ refus)
  v_now := platform.now();
  IF v_now > f.deadline_at THEN
    RETURN QUERY SELECT 'CLAIM_DEADLINE_PASSED'::text, NULL::uuid, f.deadline_at;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.claim_damage_claim AS c
              WHERE c.trip_id = p_trip_id AND c.declared_by = p_declared_by AND c.kind = p_kind
                AND c.status = 'REPORTED') THEN
    RETURN QUERY SELECT 'CLAIM_ALREADY_OPEN'::text, NULL::uuid, f.deadline_at;
    RETURN;
  END IF;
  v_who := CASE p_declared_by WHEN 'HOST' THEN f.holder_user_id ELSE f.guest_user_id END;
  IF v_who IS NULL THEN
    RETURN QUERY SELECT 'CLAIM_TRIP_NOT_ELIGIBLE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  INSERT INTO core.claim_damage_claim
         (id, trip_id, country_code, currency, case_id, declared_by, kind, declarant_user_id,
          recorded_by, recorded_role, request_id, description, trip_end_at, deadline_at,
          reported_at)
  VALUES (p_claim_id, p_trip_id, f.country_code, f.currency, p_case_id, p_declared_by, p_kind,
          v_who, p_agent, p_role, p_request_id, v_desc, f.end_at, f.deadline_at, v_now);
  RETURN QUERY SELECT 'RECORDED'::text, p_claim_id, f.deadline_at;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_record_claim(uuid, uuid, uuid, text, text, text, uuid, text, uuid) IS
  'Déclaration de dommage ou d''incident dans le délai (claim_deadline, heure de la base) ; '
  'déclarant relu en base. Appelée par la porte du staff. EXECUTE iam_staff_owner. US-309 (ADR-195).';

-- 4.2 Gabarit et enregistrement d'une décision. Entrée (jsonb, montants en texte d'entier) :
--   outcome (GUEST_LIABLE, NO_GUEST_CHARGE, INELIGIBLE), covered (booléen), repairCostMinor,
--   amountMinor (débit du voyageur), lines [{category, amountMinor}] (20 au plus),
--   hostDeductibleMinor, facts (texte), guestAgreementFileId (facultatif, jugée par la porte).
-- Catégories : REPAIR ⇒ HOST ; INSURER_RECOVERY ⇒ INSURER ; PROCESSING_FEE ⇒ PLATFORM ;
--   PROCESSING_FEE_TAX ⇒ TAX_THIRD_PARTY ; RECOVERY_PARKING (BR-TT-05) et NOT_ATTRIBUTABLE
--   (BR-FUEL-03) : EXCLUES (NOT_RECHARGEABLE), jamais dans le montant.
-- Issues : PREVIEW (aperçu, rien d'écrit), DECIDED, ALREADY_DECIDED (rejeu), CLAIM_NOT_FOUND,
--   CLAIM_ALREADY_DECIDED, DECISION_RATIONALE_REQUIRED, DECISION_FINALITY_FORBIDDEN,
--   LEG_SUM_MISMATCH, DECISION_OUTCOME_MISMATCH, CLAIM_DECISION_WITHOUT_EVIDENCE,
--   CLAIM_CAP_UNKNOWN, DAMAGE_ABOVE_ACCEPTED_AMOUNT, DAMAGE_ABOVE_REPAIR_COST,
--   DECISION_ADMIN_REQUIRED. Entrée mal formée : 22023.
CREATE FUNCTION core.claim_cmd_issue_decision(p_decision_id uuid, p_claim_id uuid, p_agent uuid,
                                              p_role text, p_request_id uuid, p_input jsonb,
                                              p_preview boolean)
  RETURNS TABLE (outcome text, decision_id uuid, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  c          core.claim_damage_claim%ROWTYPE;
  v_old      core.claim_decision%ROWTYPE;
  f          record;
  v_outcome  text := p_input ->> 'outcome';
  v_covered  boolean;
  v_facts    text := pg_catalog.btrim(p_input ->> 'facts');
  v_repair   bigint;
  v_amount   bigint;
  v_deduct   bigint;
  v_agree    uuid;
  v_line     jsonb;
  v_cat      text;
  v_minor    bigint;
  v_leg      text;
  v_rule     text;
  v_l        bigint[] := ARRAY[0, 0, 0, 0]::bigint[];
  v_sum      numeric := 0;
  v_lines    jsonb := '[]'::jsonb;
  v_excl     jsonb := '[]'::jsonb;
  v_evidence jsonb;
  v_body     jsonb;
  v_code     text;
  v_int      constant text := '^(0|[1-9][0-9]{0,14})$';
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RAISE EXCEPTION 'claim: decision reserved to the staff console'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_command_forbidden';
  END IF;
  -- forme de l'entrée (montants : texte d'un entier ≥ 0, jamais un nombre JSON)
  IF p_decision_id IS NULL OR p_claim_id IS NULL OR p_agent IS NULL OR p_request_id IS NULL
     OR p_role IS NULL OR p_role NOT IN ('OPS_AGENT', 'ADMIN') OR p_preview IS NULL
     OR p_input IS NULL OR pg_catalog.jsonb_typeof(p_input) <> 'object'
     OR v_outcome IS NULL OR v_outcome NOT IN ('GUEST_LIABLE', 'NO_GUEST_CHARGE', 'INELIGIBLE')
     OR pg_catalog.jsonb_typeof(p_input -> 'covered') IS DISTINCT FROM 'boolean'
     OR pg_catalog.jsonb_typeof(p_input -> 'repairCostMinor') IS DISTINCT FROM 'string'
     OR (p_input ->> 'repairCostMinor') !~ v_int
     OR pg_catalog.jsonb_typeof(p_input -> 'amountMinor') IS DISTINCT FROM 'string'
     OR (p_input ->> 'amountMinor') !~ v_int
     OR pg_catalog.jsonb_typeof(p_input -> 'hostDeductibleMinor') IS DISTINCT FROM 'string'
     OR (p_input ->> 'hostDeductibleMinor') !~ v_int
     OR pg_catalog.jsonb_typeof(p_input -> 'lines') IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_input -> 'lines') > 20
     OR (p_input ? 'facts' AND pg_catalog.jsonb_typeof(p_input -> 'facts') <> 'string')
     OR (p_input ? 'guestAgreementFileId'
         AND pg_catalog.jsonb_typeof(p_input -> 'guestAgreementFileId') NOT IN ('string', 'null'))
     OR (p_input - ARRAY['outcome', 'covered', 'repairCostMinor', 'amountMinor',
                         'hostDeductibleMinor', 'lines', 'facts', 'guestAgreementFileId'])
        <> '{}'::jsonb THEN
    RAISE EXCEPTION 'claim: invalid decision input' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_covered := (p_input ->> 'covered')::boolean;
  v_repair := (p_input ->> 'repairCostMinor')::bigint;
  v_amount := (p_input ->> 'amountMinor')::bigint;
  v_deduct := (p_input ->> 'hostDeductibleMinor')::bigint;
  IF (p_input ->> 'guestAgreementFileId') IS NOT NULL THEN
    IF (p_input ->> 'guestAgreementFileId')
       !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'claim: invalid agreement file' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_agree := (p_input ->> 'guestAgreementFileId')::uuid;
  END IF;

  SELECT * INTO c FROM core.claim_damage_claim AS x WHERE x.id = p_claim_id FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN QUERY SELECT 'CLAIM_NOT_FOUND'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_old FROM core.claim_decision AS d WHERE d.claim_id = c.id;
  IF v_old.id IS NOT NULL THEN
    IF v_old.request_id = p_request_id AND NOT p_preview THEN
      RETURN QUERY SELECT 'ALREADY_DECIDED'::text, v_old.id, core.claim_claim_view(c.id);
    ELSE
      RETURN QUERY SELECT 'CLAIM_ALREADY_DECIDED'::text, v_old.id, NULL::jsonb;
    END IF;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.claim_decision AS d WHERE d.request_id = p_request_id) THEN
    RAISE EXCEPTION 'claim: request id already used by another decision'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'claim_decision_conflict';
  END IF;

  -- gabarit : faits écrits, jamais « définitive » (OQ-BR-24 : les voies de recours sont citées)
  IF v_facts IS NULL OR pg_catalog.char_length(v_facts) < 20 THEN
    RETURN QUERY SELECT 'DECISION_RATIONALE_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF pg_catalog.char_length(v_facts) > 2000 THEN
    RAISE EXCEPTION 'claim: facts too long' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_facts ~* '(definitiv|définitiv|inapelable|sin (derecho a )?apelaci|sans (appel|recours)|sem (direito a )?recurso|irrecorr|final and binding|not subject to appeal)' THEN
    RETURN QUERY SELECT 'DECISION_FINALITY_FORBIDDEN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;

  -- lignes : catégorie fermée ⇒ jambe ; non refacturables exclues par le gabarit
  FOR v_line IN SELECT x FROM pg_catalog.jsonb_array_elements(p_input -> 'lines') AS x LOOP
    IF pg_catalog.jsonb_typeof(v_line) <> 'object'
       OR (v_line - ARRAY['category', 'amountMinor']) <> '{}'::jsonb
       OR pg_catalog.jsonb_typeof(v_line -> 'category') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_line -> 'amountMinor') IS DISTINCT FROM 'string'
       OR (v_line ->> 'amountMinor') !~ v_int THEN
      RAISE EXCEPTION 'claim: invalid decision line' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    v_cat := v_line ->> 'category';
    v_minor := (v_line ->> 'amountMinor')::bigint;
    v_leg := CASE v_cat WHEN 'REPAIR' THEN 'HOST' WHEN 'INSURER_RECOVERY' THEN 'INSURER'
                        WHEN 'PROCESSING_FEE' THEN 'PLATFORM'
                        WHEN 'PROCESSING_FEE_TAX' THEN 'TAX_THIRD_PARTY' END;
    v_rule := CASE v_cat WHEN 'RECOVERY_PARKING' THEN 'BR-TT-05'
                         WHEN 'NOT_ATTRIBUTABLE' THEN 'BR-FUEL-03' END;
    IF v_leg IS NULL AND v_rule IS NULL THEN
      RAISE EXCEPTION 'claim: unknown line category' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF v_rule IS NOT NULL THEN
      v_excl := v_excl || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                  'category', v_cat, 'amountMinor', v_minor::text, 'code', 'NOT_RECHARGEABLE',
                  'rule', v_rule));
      CONTINUE;
    END IF;
    v_lines := v_lines || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                 'category', v_cat, 'leg', v_leg, 'amountMinor', v_minor::text));
    v_l[CASE v_leg WHEN 'HOST' THEN 1 WHEN 'INSURER' THEN 2 WHEN 'TAX_THIRD_PARTY' THEN 3
                   ELSE 4 END] :=
      v_l[CASE v_leg WHEN 'HOST' THEN 1 WHEN 'INSURER' THEN 2 WHEN 'TAX_THIRD_PARTY' THEN 3
                     ELSE 4 END] + v_minor;
    v_sum := v_sum + v_minor;
  END LOOP;
  IF v_sum <> v_amount THEN
    RETURN QUERY SELECT 'LEG_SUM_MISMATCH'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('amountMinor', v_amount::text,
                          'legsSumMinor', v_sum::text, 'excluded', v_excl);
    RETURN;
  END IF;
  IF (v_outcome = 'GUEST_LIABLE') <> (v_amount > 0)
     OR (v_outcome = 'INELIGIBLE' AND (v_covered OR v_deduct > 0))
     OR (v_deduct > 0 AND NOT v_covered) THEN
    RETURN QUERY SELECT 'DECISION_OUTCOME_MISMATCH'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;

  -- preuves relues par la base (LEG-024 : aucune retenue sans photos de départ ET de retour)
  SELECT * INTO f FROM core.claim_trip_facts(c.trip_id);
  v_evidence := pg_catalog.jsonb_build_object('checkinPhotos', COALESCE(f.checkin_photos, false),
                                               'checkoutPhotos', COALESCE(f.checkout_photos, false),
                                               'guestAgreement', v_agree IS NOT NULL);
  v_code := CASE
    WHEN v_outcome = 'GUEST_LIABLE'
         AND NOT (COALESCE(f.checkin_photos, false) AND COALESCE(f.checkout_photos, false))
      THEN 'CLAIM_DECISION_WITHOUT_EVIDENCE'
    -- plafonds avant tout débit (ADR-189 c ; REQ-PAY-DMG-06, BR-DAMAGE-06)
    WHEN v_amount > 0 AND f.accepted_deductible_minor IS NULL THEN 'CLAIM_CAP_UNKNOWN'
    WHEN v_amount > f.accepted_deductible_minor THEN 'DAMAGE_ABOVE_ACCEPTED_AMOUNT'
    WHEN v_l[1] + v_l[2] > v_repair OR v_deduct > v_repair THEN 'DAMAGE_ABOVE_REPAIR_COST'
    -- seuil de la décision ADMIN non fixé (16 CLM-006, PROPOSÉ) : tout débit ⇒ ADMIN
    WHEN (v_amount > 0 OR v_deduct > 0) AND p_role <> 'ADMIN' THEN 'DECISION_ADMIN_REQUIRED'
    ELSE NULL END;
  v_body := pg_catalog.jsonb_build_object(
    'claimId', c.id, 'tripId', c.trip_id, 'currency', c.currency, 'outcome', v_outcome,
    'covered', v_covered, 'repairCostMinor', v_repair::text, 'amountMinor', v_amount::text,
    'legs', pg_catalog.jsonb_build_object('HOST', v_l[1]::text, 'INSURER', v_l[2]::text,
                                          'TAX_THIRD_PARTY', v_l[3]::text,
                                          'PLATFORM', v_l[4]::text),
    'lines', v_lines, 'excluded', v_excl, 'hostDeductibleMinor', v_deduct::text,
    'guestCapMinor', f.accepted_deductible_minor::text, 'evidence', v_evidence,
    'adminRequired', v_amount > 0 OR v_deduct > 0);
  IF v_code IS NOT NULL THEN
    RETURN QUERY SELECT v_code, NULL::uuid, v_body;
    RETURN;
  END IF;
  IF p_preview THEN
    RETURN QUERY SELECT 'PREVIEW'::text, NULL::uuid, v_body;
    RETURN;
  END IF;

  INSERT INTO core.claim_decision
         (id, claim_id, trip_id, country_code, currency, outcome, covered, repair_cost_minor,
          charge_amount_minor, leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
          leg_platform_minor, host_deductible_minor, guest_cap_minor, lines, excluded, evidence,
          facts, guest_agreement_file_id, decided_by, decided_role, request_id, execution_status,
          executed_at)
  VALUES (p_decision_id, c.id, c.trip_id, c.country_code, c.currency, v_outcome, v_covered,
          v_repair, v_amount, v_l[1], v_l[2], v_l[3], v_l[4], v_deduct,
          f.accepted_deductible_minor, v_lines, v_excl, v_evidence, v_facts, v_agree, p_agent,
          p_role, p_request_id,
          -- rien à exécuter (aucun débit, aucune franchise, rien à déclarer) : exécutée d'emblée
          CASE WHEN v_amount > 0 OR v_deduct > 0 OR v_covered THEN 'PENDING' ELSE 'DONE' END,
          CASE WHEN v_amount > 0 OR v_deduct > 0 OR v_covered THEN NULL ELSE platform.now() END);
  UPDATE core.claim_damage_claim AS x SET status = 'DECIDED', decided_at = platform.now()
   WHERE x.id = c.id;
  RETURN QUERY SELECT 'DECIDED'::text, p_decision_id, core.claim_claim_view(c.id);
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_issue_decision(uuid, uuid, uuid, text, uuid, jsonb, boolean) IS
  'Gabarit et enregistrement de la décision motivée d''une déclaration (ADM-008, LEG-024) : faits, '
  'preuves relues, lignes et jambes explicites, exclusions BR-TT-05 / BR-FUEL-03, plafonds, ADMIN '
  'pour tout débit ; aperçu sans écriture. EXECUTE iam_staff_owner. US-309 (ADR-195).';

-- 4.3 Vue d'une déclaration pour la console (aucune donnée nominative ; le texte de la déclaration
-- et les faits de la décision sont des résumés de l'agent)
CREATE FUNCTION core.claim_claim_view(p_claim_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  c core.claim_damage_claim%ROWTYPE;
  d core.claim_decision%ROWTYPE;
  i core.claim_insurer_declaration%ROWTYPE;
  f record;
  v_ts constant text := 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
BEGIN
  SELECT * INTO c FROM core.claim_damage_claim AS x WHERE x.id = p_claim_id;
  IF c.id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO d FROM core.claim_decision AS x WHERE x.claim_id = c.id;
  IF d.id IS NOT NULL THEN
    SELECT * INTO i FROM core.claim_insurer_declaration AS x WHERE x.decision_id = d.id;
  END IF;
  SELECT * INTO f FROM core.claim_trip_facts(c.trip_id);
  RETURN pg_catalog.jsonb_build_object(
    'claimId', c.id, 'tripId', c.trip_id, 'caseId', c.case_id, 'country', c.country_code,
    'currency', c.currency, 'declaredBy', c.declared_by, 'kind', c.kind,
    'description', c.description, 'status', c.status,
    'reportedAt', pg_catalog.to_char(c.reported_at AT TIME ZONE 'UTC', v_ts),
    'tripEndAt', pg_catalog.to_char(c.trip_end_at AT TIME ZONE 'UTC', v_ts),
    'deadlineAt', pg_catalog.to_char(c.deadline_at AT TIME ZONE 'UTC', v_ts),
    'evidence', pg_catalog.jsonb_build_object('checkinPhotos', COALESCE(f.checkin_photos, false),
                                              'checkoutPhotos', COALESCE(f.checkout_photos, false)),
    'guestCapMinor', f.accepted_deductible_minor::text,
    'decision', CASE WHEN d.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'decisionId', d.id, 'outcome', d.outcome, 'covered', d.covered,
      'repairCostMinor', d.repair_cost_minor::text, 'amountMinor', d.charge_amount_minor::text,
      'legs', pg_catalog.jsonb_build_object('HOST', d.leg_host_minor::text,
                                            'INSURER', d.leg_insurer_minor::text,
                                            'TAX_THIRD_PARTY', d.leg_tax_third_party_minor::text,
                                            'PLATFORM', d.leg_platform_minor::text),
      'lines', d.lines, 'excluded', d.excluded,
      'hostDeductibleMinor', d.host_deductible_minor::text, 'evidence', d.evidence,
      'facts', d.facts, 'decidedRole', d.decided_role,
      'decidedAt', pg_catalog.to_char(d.decided_at AT TIME ZONE 'UTC', v_ts),
      'execution', d.execution_status, 'executionCode', d.execution_code,
      'insurerDeclaration', i.status) END);
END
$fn$;
COMMENT ON FUNCTION core.claim_claim_view(uuid) IS
  'Vue d''une déclaration pour la console : délai, preuves, plafond, décision et son exécution, '
  'déclaration à l''assureur. Aucune donnée nominative. EXECUTE iam_staff_owner. US-309 (ADR-195).';

-- 4.4 File des décisions à exécuter (travailleur payment_command), plus anciennes d'abord
CREATE FUNCTION core.claim_decisions_due(p_limit integer)
  RETURNS TABLE (decision_id uuid)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: decisions_due reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_command_forbidden';
  END IF;
  RETURN QUERY
  SELECT d.id FROM core.claim_decision AS d
   WHERE d.execution_status = 'PENDING' AND d.next_check_at <= platform.now()
   ORDER BY d.next_check_at, d.decided_at, d.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END
$fn$;
COMMENT ON FUNCTION core.claim_decisions_due(integer) IS
  'Travailleur payment_command : décisions à exécuter (PENDING échues). EXECUTE app_worker. US-309.';

-- 4.5 Exécution d'une décision par Kmino (travailleur payment_command), sous le verrou du trip puis
-- de la décision. Issues : DONE (débit notifié, franchise écrite, déclaration journalisée ; rejeu :
-- même issue), BLOCKED (`NO_CARD_TENDER` : aucune opération de carte prouvée du loyer, revue de
-- l'ops ; `TRIP_UNKNOWN`), NOT_FOUND. Le débit est celui d'US-703 : montant explicite de chaque
-- jambe, but DAMAGE, motif DAMAGE_SEPARATE, jamais la caution ; accord écrit = pièce présente.
CREATE FUNCTION core.claim_cmd_execute_decision(p_decision_id uuid, p_charge_id uuid)
  RETURNS TABLE (outcome text, code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t        record;
  d        core.claim_decision%ROWTYPE;
  v_tender uuid;
  r        record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: execute_decision reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_command_forbidden';
  END IF;
  IF p_decision_id IS NULL OR p_charge_id IS NULL THEN
    RAISE EXCEPTION 'claim: invalid execution input' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.trip_id INTO d.trip_id FROM core.claim_decision AS x WHERE x.id = p_decision_id;
  IF d.trip_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  -- ordre des verrous de notify (trip, puis débit) : trip, puis décision
  SELECT x.id, x.org_id, x.country_code, x.currency, x.source_hold_id INTO t
    FROM core.booking_trip AS x WHERE x.id = d.trip_id FOR UPDATE;
  SELECT * INTO d FROM core.claim_decision AS x WHERE x.id = p_decision_id FOR UPDATE;
  IF d.execution_status <> 'PENDING' THEN
    RETURN QUERY SELECT d.execution_status, d.execution_code;
    RETURN;
  END IF;
  IF t.id IS NULL OR t.country_code <> d.country_code OR t.currency <> d.currency THEN
    UPDATE core.claim_decision AS x SET execution_status = 'BLOCKED', execution_code = 'TRIP_UNKNOWN'
     WHERE x.id = d.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'TRIP_UNKNOWN'::text;
    RETURN;
  END IF;

  -- (1) débit séparé du voyageur (US-703) : moyen = opération de carte du loyer prouvée
  IF d.charge_amount_minor > 0 AND d.charge_id IS NULL THEN
    SELECT o.id INTO v_tender
      FROM core.payment_payment_operation AS o
     WHERE (o.trip_id = t.id OR (t.source_hold_id IS NOT NULL AND o.hold_id = t.source_hold_id))
       AND o.kind IN ('AUTH', 'CAPTURE') AND o.method = 'CARD' AND o.purpose = 'RENT'
       AND o.status = 'SUCCEEDED' AND o.currency = t.currency
     ORDER BY (o.kind = 'CAPTURE') DESC, o.created_at, o.id
     LIMIT 1;
    IF v_tender IS NULL THEN
      UPDATE core.claim_decision AS x
         SET execution_status = 'BLOCKED', execution_code = 'NO_CARD_TENDER'
       WHERE x.id = d.id;
      RETURN QUERY SELECT 'BLOCKED'::text, 'NO_CARD_TENDER'::text;
      RETURN;
    END IF;
    SELECT * INTO r FROM core.payment_cmd_notify_post_trip_charge(
      p_charge_id, t.id, 'DAMAGE', 'DAMAGE_SEPARATE', 'CLAIM_DECISION', d.id, NULL, v_tender,
      d.charge_amount_minor,
      pg_catalog.jsonb_build_object('HOST', d.leg_host_minor::text,
                                    'INSURER', d.leg_insurer_minor::text,
                                    'TAX_THIRD_PARTY', d.leg_tax_third_party_minor::text,
                                    'PLATFORM', d.leg_platform_minor::text),
      d.guest_agreement_file_id IS NOT NULL);
    UPDATE core.claim_decision AS x SET charge_id = r.charge_id WHERE x.id = d.id;
  END IF;

  -- (2) franchise de l'hôte : débit du host_ledger (E7 règle 7), jamais une jambe ni un débit du
  -- voyageur ; une écriture par décision
  IF d.host_deductible_minor > 0
     AND NOT EXISTS (SELECT 1 FROM core.settlement_host_ledger_entry AS e
                      WHERE e.claim_decision_id = d.id) THEN
    INSERT INTO core.settlement_host_ledger_entry
           (id, org_id, country_code, currency, reason, amount_minor, claim_decision_id)
    VALUES (pg_catalog.gen_random_uuid(), t.org_id, t.country_code, t.currency,
            'CLAIM_HOST_DEDUCTIBLE', -d.host_deductible_minor, d.id);
  END IF;

  -- (3) déclaration à l'assureur partenaire, journalisée (envoi : travailleur, interrupteur du pays)
  IF d.covered AND NOT EXISTS (SELECT 1 FROM core.claim_insurer_declaration AS x
                                WHERE x.decision_id = d.id) THEN
    INSERT INTO core.claim_insurer_declaration (id, decision_id, claim_id, trip_id, country_code)
    VALUES (pg_catalog.gen_random_uuid(), d.id, d.claim_id, d.trip_id, d.country_code);
  END IF;

  UPDATE core.claim_decision AS x
     SET execution_status = 'DONE', execution_code = NULL, executed_at = platform.now()
   WHERE x.id = d.id;
  RETURN QUERY SELECT 'DONE'::text, NULL::text;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_execute_decision(uuid, uuid) IS
  'Exécution d''une décision par Kmino : débit séparé du voyageur (US-703, jambes explicites, jamais '
  'la caution), franchise de l''hôte au host_ledger, déclaration à l''assureur journalisée. '
  'Travailleur payment_command. EXECUTE app_worker. US-309 (ADR-195).';

-- 4.6 Report d'une exécution en échec (erreur de la base attrapée par le travailleur) : +15 min
CREATE FUNCTION core.claim_cmd_defer_decision(p_decision_id uuid, p_code text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: defer_decision reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_command_forbidden';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Z][A-Z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'claim: invalid code' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE core.claim_decision AS x
     SET next_check_at = platform.now() + interval '15 minutes', execution_code = p_code
   WHERE x.id = p_decision_id AND x.execution_status = 'PENDING';
  RETURN CASE WHEN FOUND THEN 'DEFERRED' ELSE 'NOT_DUE' END;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_defer_decision(uuid, text) IS
  'Travailleur payment_command : exécution en échec repoussée de 15 min (PROPOSÉ), code seulement. '
  'EXECUTE app_worker. US-309 (ADR-195).';

-- 4.7 Déclarations à envoyer à l'assureur : seulement si insurer_contract_active[pays] (lu en base,
-- absent ⇒ faux). Aucune donnée nominative : nature, pays, devise, coût constaté, heure.
CREATE FUNCTION core.claim_insurer_declarations_due(p_limit integer)
  RETURNS TABLE (declaration_id uuid, claim_id uuid, country_code text, currency text, kind text,
                 repair_cost_minor bigint, reported_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: insurer_declarations_due reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_command_forbidden';
  END IF;
  RETURN QUERY
  SELECT i.id, i.claim_id, i.country_code, d.currency, c.kind, d.repair_cost_minor, c.reported_at
    FROM core.claim_insurer_declaration AS i
    JOIN core.claim_decision AS d ON d.id = i.decision_id
    JOIN core.claim_damage_claim AS c ON c.id = i.claim_id
   WHERE i.status = 'PENDING' AND core.config_go_live('insurer_contract_active', i.country_code)
   ORDER BY i.recorded_at, i.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END
$fn$;
COMMENT ON FUNCTION core.claim_insurer_declarations_due(integer) IS
  'Travailleur payment_command : déclarations à l''assureur en attente, du seul pays dont '
  'insurer_contract_active est vrai (absent ⇒ faux). EXECUTE app_worker. US-309 (ADR-195).';

CREATE FUNCTION core.claim_cmd_record_insurer_declaration(p_declaration_id uuid, p_provider_ref text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  i core.claim_insurer_declaration%ROWTYPE;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: record_insurer_declaration reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_command_forbidden';
  END IF;
  IF p_provider_ref IS NULL OR p_provider_ref !~ '^[A-Za-z0-9:._-]{1,100}$' THEN
    RAISE EXCEPTION 'claim: invalid provider reference' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO i FROM core.claim_insurer_declaration AS x WHERE x.id = p_declaration_id FOR UPDATE;
  IF i.id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF i.status = 'SENT' THEN
    RETURN 'ALREADY_SENT';
  END IF;
  -- l'interrupteur est relu sous le verrou (fermé entre la file et l'envoi : rien n'est reporté)
  IF NOT core.config_go_live('insurer_contract_active', i.country_code) THEN
    RETURN 'INSURER_CONTRACT_INACTIVE';
  END IF;
  UPDATE core.claim_insurer_declaration AS x
     SET status = 'SENT', sent_at = platform.now(), provider_ref = p_provider_ref
   WHERE x.id = i.id;
  RETURN 'SENT';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_record_insurer_declaration(uuid, text) IS
  'Travailleur payment_command : déclaration à l''assureur envoyée (référence du port), '
  'interrupteur relu. EXECUTE app_worker. US-309 (ADR-195).';

-- 4.8 Motifs de retenue d'un lot (0167, même signature) : corps recopié ; bloc US-309 marqué.
CREATE OR REPLACE FUNCTION core.payout_batch_hold_reasons(p_batch_id uuid)
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH b AS (
    SELECT x.id, x.org_id, x.country_code, x.currency, x.variant, x.psp_account_id,
           x.scheduled_for, a.provider
      FROM core.payout_payout_batch AS x
      JOIN core.payment_psp_account AS a ON a.id = x.psp_account_id
     WHERE x.id = p_batch_id),
  reasons(r) AS (
    SELECT 'PAYOUTS_DISABLED' FROM b WHERE NOT core.config_go_live('payouts_enabled', b.country_code)
    UNION ALL
    SELECT 'FUNDS_HOLDING_DISABLED' FROM b
     WHERE b.variant = 'PLATFORM_MOR' AND NOT core.config_go_live('funds_holding_enabled', b.country_code)
    UNION ALL
    SELECT 'VARIANT_B_UNAVAILABLE' FROM b WHERE b.variant = 'PLATFORM_MOR'
    UNION ALL
    SELECT 'HOST_PAYOUT_RAIL_UNAVAILABLE' FROM b
     WHERE pg_catalog.cardinality(
             core.payment_missing_blocking_capabilities(b.provider, b.country_code, b.variant)) > 0
    UNION ALL
    SELECT 'SUBMERCHANT_INACTIVE' FROM b
     WHERE NOT EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS s
                        WHERE s.psp_account_id = b.psp_account_id AND s.org_id = b.org_id
                          AND s.kyc_status = 'ACTIVE')
    UNION ALL
    SELECT h.r FROM b,
           pg_catalog.unnest(core.payout_payout_account_hold(b.org_id, b.currency, b.scheduled_for))
             AS h(r)
    UNION ALL
    SELECT lb.frozen_reason
      FROM core.payout_payout_item AS i
      JOIN core.settlement_trip_leg_balance AS lb
        ON lb.trip_id = i.trip_id AND lb.segment_no = i.segment_no AND lb.leg = i.leg
     WHERE i.batch_id = p_batch_id AND lb.frozen
    UNION ALL
    SELECT 'CHARGEBACK'
      FROM core.payout_payout_item AS i
     WHERE i.batch_id = p_batch_id AND core.settlement_trip_chargeback_open(i.trip_id)
    UNION ALL
    SELECT CASE WHEN t.status = 'IN_DISPUTE' THEN 'DISPUTE' ELSE 'TRIP_NOT_COMPLETED' END
      FROM core.payout_payout_item AS i
      JOIN core.booking_trip AS t ON t.id = i.trip_id
     WHERE i.batch_id = p_batch_id AND t.status <> 'COMPLETED'
    -- US-309 (ADR-195) : réclamation de dommage ou d'incident du trip sans décision exécutée,
    -- quel que soit le déclarant ; levée par la seule décision exécutée (L3-PM-34, RT-L3-V04)
    UNION ALL
    SELECT 'CLAIM'
      FROM core.payout_payout_item AS i
     WHERE i.batch_id = p_batch_id
       AND EXISTS (SELECT 1 FROM core.claim_damage_claim AS c
                     LEFT JOIN core.claim_decision AS d ON d.claim_id = c.id
                    WHERE c.trip_id = i.trip_id
                      AND (d.id IS NULL OR d.execution_status <> 'DONE'))
  )
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT reasons.r ORDER BY reasons.r), ARRAY[]::text[])
    FROM reasons WHERE reasons.r IS NOT NULL
$fn$;

REVOKE ALL ON FUNCTION core.claim_cmd_record_claim(uuid, uuid, uuid, text, text, text, uuid, text, uuid),
  core.claim_cmd_issue_decision(uuid, uuid, uuid, text, uuid, jsonb, boolean),
  core.claim_claim_view(uuid), core.claim_decisions_due(integer),
  core.claim_cmd_execute_decision(uuid, uuid), core.claim_cmd_defer_decision(uuid, text),
  core.claim_insurer_declarations_due(integer),
  core.claim_cmd_record_insurer_declaration(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.claim_cmd_record_claim(uuid, uuid, uuid, text, text, text, uuid, text, uuid),
  core.claim_cmd_issue_decision(uuid, uuid, uuid, text, uuid, jsonb, boolean),
  core.claim_claim_view(uuid) TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.claim_decisions_due(integer),
  core.claim_cmd_execute_decision(uuid, uuid), core.claim_cmd_defer_decision(uuid, text),
  core.claim_insurer_declarations_due(integer),
  core.claim_cmd_record_insurer_declaration(uuid, text) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 5. Portes du staff (iam_staff_owner, EXECUTE app_api) ---------------------------------------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- 5.1 RECORD_CLAIM. Issues : AUTH_REQUIRED (rien n'est écrit), MFA_REQUIRED, FORBIDDEN (permission
-- `claim.declare` absente dans le pays du dossier), CASE_REQUIRED (dossier inconnu, d'un autre
-- trip, non CLAIM, clos, non assigné à l'agent hors ADMIN), SELF_FORBIDDEN (ADR-122), puis les
-- issues de core.claim_cmd_record_claim. Refus journalisés ; audit chaîné en dernier.
CREATE FUNCTION core.support_staff_record_claim(p_token_hash bytea, p_request_id uuid,
                                                p_trip_id uuid, p_case_id uuid, p_declared_by text,
                                                p_kind text, p_description text)
  RETURNS TABLE (outcome text, claim_id uuid, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_case record;
  v_role text;
  v_deny text;
  r      record;
BEGIN
  IF p_request_id IS NULL OR p_trip_id IS NULL OR p_case_id IS NULL OR p_declared_by IS NULL
     OR p_declared_by NOT IN ('HOST', 'GUEST') OR p_kind IS NULL OR p_kind NOT IN ('DAMAGE', 'INCIDENT')
     OR p_description IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_description)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'déclaration : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'TRIP', p_trip_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'RECORD_CLAIM', 'permission', 'claim.declare'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  SELECT c.country_code, c.status, c.assignee_id, c.trip_id, c.category INTO v_case
    FROM core.support_support_case AS c WHERE c.id = p_case_id;
  IF v_case.country_code IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'claim.declare', ARRAY[v_case.country_code],
                                       NULL);
  END IF;
  v_deny := CASE
    WHEN v_case.country_code IS NULL THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN v_case.trip_id IS DISTINCT FROM p_trip_id OR v_case.category <> 'CLAIM' THEN 'CASE'
    WHEN v_case.status NOT IN ('OPEN', 'PENDING') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_case.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    WHEN core.support_actor_conflict(v_s.user_id, 'TRIP', p_trip_id) THEN 'SELF'
    ELSE NULL END;
  IF v_deny IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN', 'TRIP',
                                 p_trip_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_deny,
                                   'attempted', 'RECORD_CLAIM', 'permission', 'claim.declare',
                                   'case_id', p_case_id)
                                 || CASE WHEN v_case.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_case.country_code) END
                                 || CASE WHEN v_deny = 'SELF'
                                         THEN '{"guard": "SEPARATION_OF_DUTIES"}'::jsonb
                                         ELSE '{}'::jsonb END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT CASE v_deny WHEN 'PERMISSION' THEN 'FORBIDDEN'
                                    WHEN 'SELF' THEN 'SELF_FORBIDDEN'
                                    ELSE 'CASE_REQUIRED' END::text,
                        NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO r FROM core.claim_cmd_record_claim(pg_catalog.gen_random_uuid(), p_trip_id,
                                                   p_case_id, p_declared_by, p_kind,
                                                   p_description, v_s.user_id, v_role,
                                                   p_request_id);
  IF r.outcome NOT IN ('RECORDED', 'ALREADY_RECORDED') THEN
    -- refus métier journalisé (délai, trip, déclaration vivante), aucune écriture de déclaration
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'CLAIM_REFUSED', 'TRIP', p_trip_id, NULL,
                                 pg_catalog.jsonb_build_object('country', v_case.country_code,
                                   'code', r.outcome, 'case_id', p_case_id,
                                   'declared_by', p_declared_by, 'kind', p_kind)
                                 || CASE WHEN r.deadline_at IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('deadline_at',
                                                r.deadline_at) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT r.outcome, NULL::uuid,
                        CASE WHEN r.deadline_at IS NULL THEN NULL
                             ELSE pg_catalog.jsonb_build_object('deadlineAt',
                                    pg_catalog.to_char(r.deadline_at AT TIME ZONE 'UTC',
                                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END;
    RETURN;
  END IF;
  IF r.outcome = 'RECORDED' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'CLAIM_RECORDED', 'TRIP', p_trip_id, NULL,
                                 pg_catalog.jsonb_build_object('country', v_case.country_code,
                                   'claim_id', r.claim_id, 'case_id', p_case_id,
                                   'declared_by', p_declared_by, 'kind', p_kind),
                                 NULL, p_request_id);
  END IF;
  RETURN QUERY SELECT r.outcome, r.claim_id, core.claim_claim_view(r.claim_id);
END
$fn$;
COMMENT ON FUNCTION core.support_staff_record_claim(bytea, uuid, uuid, uuid, text, text, text) IS
  'Console (RECORD_CLAIM) : déclaration de dommage de l''hôte ou d''incident du voyageur depuis un '
  'dossier de support CLAIM ouvert du trip assigné à l''agent ; session élevée, claim.declare dans '
  'le pays, garde ADR-122 ; refus journalisés. EXECUTE app_api. US-309 (ADR-195).';

-- Porte commune aux lectures et décisions : déclaration, dossier, permission, séparation des tâches.
-- Rend (refus, rôle, pays, trip) ; refus journalisé ici.
CREATE FUNCTION core.support_staff_claim_gate(p_user uuid, p_claim_id uuid, p_permission text,
                                              p_attempted text, p_request_id uuid)
  RETURNS TABLE (deny text, role text, country_code text, trip_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_c    record;
  v_case record;
  v_role text;
  v_deny text;
BEGIN
  SELECT c.id, c.trip_id, c.country_code, c.case_id INTO v_c
    FROM core.claim_damage_claim AS c WHERE c.id = p_claim_id;
  IF v_c.id IS NOT NULL THEN
    SELECT s.status, s.assignee_id INTO v_case
      FROM core.support_support_case AS s WHERE s.id = v_c.case_id;
    v_role := core.iam_staff_permitted(p_user, p_permission, ARRAY[v_c.country_code], NULL);
  END IF;
  v_deny := CASE
    -- déclaration inconnue : même issue qu'une permission absente (aucune existence révélée)
    WHEN v_c.id IS NULL THEN 'PERMISSION'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN v_case.status IS NULL OR v_case.status = 'CLOSED' THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_case.assignee_id IS DISTINCT FROM p_user THEN 'CASE'
    WHEN core.support_actor_conflict(p_user, 'TRIP', v_c.trip_id) THEN 'SELF'
    ELSE NULL END;
  IF v_deny IS NOT NULL THEN
    PERFORM core.iam_staff_audit(p_user, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 CASE WHEN v_c.id IS NULL THEN 'CLAIM' ELSE 'TRIP' END,
                                 COALESCE(v_c.trip_id, p_claim_id), NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_c.id IS NULL THEN 'SUBJECT_NOT_FOUND' ELSE v_deny END,
                                   'attempted', p_attempted, 'permission', p_permission,
                                   'claim_id', p_claim_id)
                                 || CASE WHEN v_c.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_c.country_code) END
                                 || CASE WHEN v_deny = 'SELF'
                                         THEN '{"guard": "SEPARATION_OF_DUTIES"}'::jsonb
                                         ELSE '{}'::jsonb END,
                                 NULL, p_request_id);
  END IF;
  RETURN QUERY SELECT v_deny, v_role, v_c.country_code, v_c.trip_id;
END
$fn$;
COMMENT ON FUNCTION core.support_staff_claim_gate(uuid, uuid, text, text, uuid) IS
  'Interne (US-309) : porte d''une déclaration (permission dans son pays, dossier assigné hors '
  'ADMIN, garde ADR-122) ; refus journalisés. Aucun EXECUTE (propriétaire seul).';
REVOKE ALL ON FUNCTION core.support_staff_claim_gate(uuid, uuid, text, text, uuid) FROM PUBLIC;

-- 5.2 Lecture d'une déclaration (claim.declare). Issues : OK, AUTH_REQUIRED, MFA_REQUIRED,
-- FORBIDDEN (déclaration inconnue ou permission absente dans son pays), CASE_REQUIRED,
-- SELF_FORBIDDEN.
CREATE FUNCTION core.support_staff_claim(p_token_hash bytea, p_request_id uuid, p_claim_id uuid)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s record;
  g   record;
BEGIN
  IF p_request_id IS NULL OR p_claim_id IS NULL THEN
    RAISE EXCEPTION 'déclaration : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO g FROM core.support_staff_claim_gate(v_s.user_id, p_claim_id, 'claim.declare',
                                                     'CLAIM_READ', p_request_id);
  IF g.deny IS NOT NULL THEN
    RETURN QUERY SELECT CASE g.deny WHEN 'PERMISSION' THEN 'FORBIDDEN'
                                    WHEN 'SELF' THEN 'SELF_FORBIDDEN'
                                    ELSE 'CASE_REQUIRED' END::text, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, core.claim_claim_view(p_claim_id);
END
$fn$;
COMMENT ON FUNCTION core.support_staff_claim(bytea, uuid, uuid) IS
  'Console : vue d''une déclaration (délai, preuves, plafond, décision, exécution) ; session '
  'élevée, claim.declare, dossier assigné, garde ADR-122. EXECUTE app_api. US-309 (ADR-195).';

-- 5.3 ISSUE_DECISION (aperçu ou enregistrement ; `dispute.decide`). Issues : celles de la porte,
-- AGREEMENT_FILE_INVALID (pièce de l'accord absente du seau des preuves), puis celles de
-- core.claim_cmd_issue_decision. Décision et refus journalisés ; l'aperçu n'écrit rien.
CREATE FUNCTION core.support_staff_issue_decision(p_token_hash bytea, p_request_id uuid,
                                                  p_claim_id uuid, p_input jsonb,
                                                  p_preview boolean)
  RETURNS TABLE (outcome text, decision_id uuid, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s     record;
  g       record;
  r       record;
  v_agree text := p_input ->> 'guestAgreementFileId';
BEGIN
  IF p_request_id IS NULL OR p_claim_id IS NULL OR p_preview IS NULL OR p_input IS NULL
     OR pg_catalog.jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'décision : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'CLAIM', p_claim_id,
                                 NULL, pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'ISSUE_DECISION', 'permission', 'dispute.decide'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO g FROM core.support_staff_claim_gate(v_s.user_id, p_claim_id, 'dispute.decide',
                                                     'ISSUE_DECISION', p_request_id);
  IF g.deny IS NOT NULL THEN
    RETURN QUERY SELECT CASE g.deny WHEN 'PERMISSION' THEN 'FORBIDDEN'
                                    WHEN 'SELF' THEN 'SELF_FORBIDDEN'
                                    ELSE 'CASE_REQUIRED' END::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  -- accord écrit du voyageur (REQ-PAY-DMG-05) : pièce du seau des preuves, jamais un booléen seul
  IF v_agree IS NOT NULL AND (
       v_agree !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR NOT EXISTS (SELECT 1 FROM core.audit_file_asset AS f
                       WHERE f.id = v_agree::uuid AND f.bucket = 'PRIVATE_EVIDENCE'
                         AND f.deleted_at IS NULL)) THEN
    RETURN QUERY SELECT 'AGREEMENT_FILE_INVALID'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO r FROM core.claim_cmd_issue_decision(pg_catalog.gen_random_uuid(), p_claim_id,
                                                     v_s.user_id, g.role, p_request_id, p_input,
                                                     p_preview);
  IF r.outcome = 'DECIDED' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, g.role, 'CLAIM_DECISION_ISSUED', 'TRIP', g.trip_id,
                                 NULL, pg_catalog.jsonb_build_object('country', g.country_code,
                                   'claim_id', p_claim_id, 'decision_id', r.decision_id,
                                   'outcome', r.body #>> '{decision,outcome}',
                                   'amount_minor', r.body #>> '{decision,amountMinor}',
                                   'host_deductible_minor',
                                   r.body #>> '{decision,hostDeductibleMinor}'),
                                 NULL, p_request_id);
  ELSIF r.outcome NOT IN ('PREVIEW', 'ALREADY_DECIDED') THEN
    PERFORM core.iam_staff_audit(v_s.user_id, g.role, 'CLAIM_DECISION_REFUSED', 'TRIP', g.trip_id,
                                 NULL, pg_catalog.jsonb_build_object('country', g.country_code,
                                   'claim_id', p_claim_id, 'code', r.outcome,
                                   'preview', p_preview),
                                 NULL, p_request_id);
  END IF;
  RETURN QUERY SELECT r.outcome, r.decision_id, r.body;
END
$fn$;
COMMENT ON FUNCTION core.support_staff_issue_decision(bytea, uuid, uuid, jsonb, boolean) IS
  'Console (ISSUE_DECISION) : aperçu du gabarit ou décision motivée d''une déclaration ; session '
  'élevée, dispute.decide dans le pays, dossier assigné, garde ADR-122, accord écrit = pièce du '
  'seau des preuves ; décision et refus journalisés. EXECUTE app_api. US-309 (ADR-195).';

REVOKE ALL ON FUNCTION core.support_staff_record_claim(bytea, uuid, uuid, uuid, text, text, text),
  core.support_staff_claim(bytea, uuid, uuid),
  core.support_staff_issue_decision(bytea, uuid, uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.support_staff_record_claim(bytea, uuid, uuid, uuid, text, text, text),
  core.support_staff_claim(bytea, uuid, uuid),
  core.support_staff_issue_decision(bytea, uuid, uuid, jsonb, boolean) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
