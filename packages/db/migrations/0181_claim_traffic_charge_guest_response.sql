-- 0181 — CLM : refacturation des amendes, péages et fourrières — référence unique par trip,
-- délai de réponse du voyageur (payer ou contester), décision de l'ops après contestation,
-- plafond du pays. Correctifs des constats de la red team du lot 3 F-L3-SIN-01 (débit en double) et
-- F-L3-SIN-02 (débit sans réponse ni recours).
-- US-318 (suite) ; 19 US-318 critère 3 ; 08 BR-TT-02 (« 48 h pour payer/contester »), BR-TT-03,
-- BR-REIMB-02, BR-REIMB-03, BR-REIMB-05 (« doublons », « montant non justifié » interdits) ;
-- 16 CLM-021 ; ADR-122 (séparation des tâches), ADR-195 (décisions motivées), ADR-197 (frais
-- annexes, mécanique reprise), ADR-198 (refacturation, 0178) ; ADR-201 (cette migration, PROPOSÉ).
-- Red team : docs/team/redteam/L3-donnees-sinistres.md (RT-L3-S04). Appliquée sous `migrator`, en une
-- transaction.
--
-- Principes (ADR-201, PROPOSÉS, fail-closed, comme Turo adapté au PA / PY) :
--   1. Référence obligatoire (F-L3-SIN-01) : toute déclaration porte la référence de l'avis, du PV
--      ou du reçu (3 à 40 caractères, lettres et chiffres ASCII, espaces, « . », « / », « - ») ; sa
--      clé normalisée (majuscules, lettres et chiffres seulement) est UNIQUE PAR TRIP, quels que
--      soient la nature, l'heure, le montant et la photo : deux photos du même PV, une heure à
--      + 1 s, un montant à + 1 ou une autre nature ne font qu'une refacturation. Doublon ⇒
--      `TRAFFIC_DUPLICATE` (rien d'écrit ; l'identifiant de la refacturation existante est rendu à
--      l'hôte) ; référence absente ⇒ `TRAFFIC_REFERENCE_REQUIRED`. Les déclarations d'un même trip
--      sont sérialisées par un verrou consultatif du trip ; l'index unique partiel
--      `claim_traffic_charge_reference_unique` est la garde de dernier recours.
--   2. Plafond (F-L3-SIN-02) : montant déclaré > `traffic_guest_charge_max_minor[pays]` ⇒
--      `TRAFFIC_AMOUNT_ABOVE_CAP` (rien d'écrit : l'hôte passe par le support) ; paramètre absent ou
--      illisible ⇒ `TRAFFIC_CAP_UNKNOWN` (aucune refacturation, fail-closed).
--   3. Délai de réponse (F-L3-SIN-02 ; 08 BR-TT-02 : 48 h) : la déclaration est notifiée au voyageur
--      (`invoice.status_changed`, agrégat `traffic_charge`, règle NTF `EVT_INVOICE_TO_GUEST`
--      d'US-706) ; il a jusqu'à `response_due_at` = déclaration + `traffic_guest_response_h`
--      (EXCLU) pour payer (`ACCEPTED`) ou contester avec un motif écrit et, s'il le veut, des photos
--      du trip (`DISPUTED`) ; la fenêtre ne se rouvre jamais. Paramètre absent ⇒
--      `TRAFFIC_RESPONSE_WINDOW_UNKNOWN`.
--   4. Débit par Kmino seulement (travailleur `payment_command`) : payé par le voyageur, décision de
--      débit de l'ops (ADMIN, ADR-195), ou silence du voyageur relu APRÈS l'échéance. Jamais avant
--      l'échéance (`GUEST_RESPONSE_WINDOW_OPEN`), jamais une refacturation contestée avant la
--      décision (`TRAFFIC_DISPUTED`). Rejet de l'ops ⇒ `REJECTED`, exécution `VOID`, jamais débitée.
--      La contrainte `claim_traffic_charge_charge_after_window` prouve en base qu'aucun débit
--      n'existe hors de ces trois bases.
--   5. Décision de l'ops après contestation : mêmes règles qu'US-706 (motif de 20 à 2 000
--      caractères, jamais « définitif », débit réservé à ADMIN, permission `dispute.decide` dans le
--      pays, session élevée, séparation des tâches d'ADR-122, décisions et refus journalisés) ;
--      liste « à revoir » de la console (refacturations contestées sans décision).
--   6. Mécanique d'US-706 réutilisée : `core.claim_incidental_party` (partie de la session),
--      `core.claim_incidental_trip_photos` (pièces de la contestation), événement et gabarit NTF,
--      `core.iam_staff_permitted`, `core.support_actor_conflict`, `core.iam_staff_audit` ;
--      codes `GUEST_RESPONSE_WINDOW_CLOSED`, `INCIDENTAL_DISPUTE_REASON_REQUIRED`,
--      `CLAIM_EVIDENCE_MISSING`, `DECISION_*`.
--   7. Refacturations antérieures (`rules_version` = 1, écrites par 0178) : jamais débitées
--      automatiquement ; le travailleur les passe en BLOCKED `GUEST_RESPONSE_MISSING` (fail-closed,
--      alerte `CLAIM_TRAFFIC_BLOCKED`). Aucune n'existe hors des bases de test (bêta non ouverte).
--   8. Écritures par commandes seulement ; RLS ENABLE + FORCE (inchangée) ; aucun droit applicatif
--      sur la table ; heure de la base ; aucune constante de pays hors du bloc généré ; aucun
--      interrupteur écrit. Aucune politique nouvelle pour `cmd_hold_owner` (coût de planification de
--      la pose, ADR-199) : les paramètres et l'avis passent par des fonctions de `cmd_money_owner`.
--
-- Codes (packages/db/src/errors.ts, inchangés) : claim_p2p_command_forbidden (42501) → FORBIDDEN ;
-- claim_p2p_record_immutable (23000) → IMMUTABLE_RECORD.
--
-- Expand / contract : colonnes (nulles ou à défaut), contraintes, index, fonctions, politiques et
-- droits AJOUTÉS ; `claim_traffic_charge_execution_valid` recréée sous son nom (+ VOID) ;
-- `core.claim_p2p_guard`, `core.claim_cmd_declare_traffic_charge` (8 arguments : rend
-- `TRAFFIC_REFERENCE_REQUIRED`), `core.claim_host_trip_claims`, `core.claim_traffic_charges_due` et
-- `core.claim_cmd_execute_traffic_charge` remplacées à signature identique (corps de 0178 recopiés
-- puis élargis). La version N de l'API, qui n'envoie pas de référence, reçoit un refus explicite.
--
-- Retour arrière (jamais en production : nouvelle migration) :
--   réappliquer les corps de 0178 de core.claim_p2p_guard (migrator),
--     core.claim_cmd_declare_traffic_charge (8 arguments) et core.claim_host_trip_claims
--     (cmd_hold_owner), core.claim_traffic_charges_due et core.claim_cmd_execute_traffic_charge
--     (cmd_money_owner) ;
--   DROP FUNCTION core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text, timestamptz, bigint,
--     uuid, boolean, text), core.claim_traffic_guest_terms(text),
--     core.claim_traffic_notify_guest(uuid),
--     core.claim_traffic_charge_eligible(smallint, text, text, timestamptz, timestamptz, timestamptz),
--     core.claim_traffic_guest_view(bytea, uuid), core.claim_cmd_accept_traffic_charge(bytea, uuid),
--     core.claim_cmd_dispute_traffic_charge(bytea, uuid, text, uuid[]),
--     core.claim_cmd_decide_traffic_charge(uuid, uuid, text, uuid, text, text),
--     core.claim_traffic_staff_view(uuid), core.claim_traffic_review_list(uuid[]),
--     core.support_staff_traffic_gate(uuid, uuid, text, text, uuid),
--     core.support_staff_traffic_charge(bytea, uuid, uuid),
--     core.support_staff_decide_traffic_charge(bytea, uuid, uuid, text, text),
--     core.support_staff_traffic_review(bytea, uuid) ;
--   DROP POLICY cmd_money_traffic_party_upd, iam_staff_traffic_sel, cmd_hold_traffic_ins_v2 ON
--     core.claim_traffic_charge ; DROP POLICY cmd_money_traffic_guest_param_read ON
--     core.config_param_value ; DROP POLICY cmd_money_traffic_event ON core.outbox_outbox_event ;
--   révoquer les colonnes accordées à cmd_money_owner et à iam_staff_owner ;
--   DROP INDEX core.claim_traffic_charge_reference_unique, core.claim_traffic_charge_review_idx ;
--   remettre claim_traffic_charge_execution_valid (PENDING, DONE, BLOCKED) — base sans VOID ;
--   DROP des contraintes claim_traffic_charge_v1_shape … _charge_after_window, puis des colonnes
--     ajoutées ;
--   DELETE des valeurs puis des définitions des paramètres « traffic_guest_* ».

-- 0. Paramètres du pays (bloc généré, POST_SEED_PARAMS « traffic_guest_ », embedded) ---------------

-- 0181 — graine complémentaire : paramètres « traffic_guest_* » (US-318 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « traffic_guest_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('traffic_guest_charge_max_minor', 'MONEY', NULL, ARRAY['COUNTRY']::text[], true, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-TT-02 à 04, BR-REIMB-05 (« montant non justifié » interdit) ; red team F-L3-SIN-02 ; ADR-201 : plafond du montant d’une amende, d’un péage ou d’une fourrière déclaré par l’hôte, en unités mineures de la devise du pays (frais de gestion non compris) ; au-delà, la déclaration est refusée (TRAFFIC_AMOUNT_ABOVE_CAP) et l’hôte passe par le support ; absent ou mal formé : aucune refacturation (TRAFFIC_TERMS_UNKNOWN, fail-closed)', 'PROPOSÉ (ADR-201) : 1 000,00 USD au Panama ; 7 500 000 PYG au Paraguay (même conversion que incidental_cleaning_max_minor) ; Turo n’a pas de plafond publié, mais ne débite jamais sans délai de réponse ; à confirmer par le fondateur'),
  ('traffic_guest_response_h', 'DURATION', 'h', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-TT-02 (« 48 h pour payer/contester »), BR-TT-03 (mêmes délais), BR-REIMB-02 / 03 ; red team F-L3-SIN-02 ; ADR-201 : délai du voyageur pour payer ou contester une amende, un péage ou une fourrière refacturés, compté depuis la déclaration (heure de la base), échéance exclue ; aucun débit avant ; absent ou hors [1 ; 720] : aucune refacturation (TRAFFIC_TERMS_UNKNOWN, fail-closed)', 'PROPOSÉ comme Turo (ADR-201, 08 BR-TT-02) : 48 h au PA / PY');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('traffic_guest_charge_max_minor', 'PA', 'COUNTRY', NULL, NULL, '"100000"'::jsonb, 'graine US-318 : défauts PROPOSÉS (08 BR-TT-02, BR-TT-03, BR-REIMB-05 ; ADR-201)'),
  ('traffic_guest_charge_max_minor', 'PY', 'COUNTRY', NULL, NULL, '"7500000"'::jsonb, 'graine US-318 : défauts PROPOSÉS (08 BR-TT-02, BR-TT-03, BR-REIMB-05 ; ADR-201)'),
  ('traffic_guest_response_h', 'PA', 'COUNTRY', NULL, NULL, '48'::jsonb, 'graine US-318 : défauts PROPOSÉS (08 BR-TT-02, BR-TT-03, BR-REIMB-05 ; ADR-201)'),
  ('traffic_guest_response_h', 'PY', 'COUNTRY', NULL, NULL, '48'::jsonb, 'graine US-318 : défauts PROPOSÉS (08 BR-TT-02, BR-TT-03, BR-REIMB-05 ; ADR-201)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'traffic\_guest\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre traffic_guest_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;

-- 1. Table -----------------------------------------------------------------------------------------

-- 1.1 Colonnes : version des règles (1 : 0178, 2 : cette migration), voyageur relu en base,
-- référence et sa clé, délai et plafond figés, réponse du voyageur, décision de l'ops, base du débit
ALTER TABLE core.claim_traffic_charge
  ADD COLUMN rules_version smallint NOT NULL DEFAULT 1
    CONSTRAINT claim_traffic_charge_rules_version_valid CHECK (rules_version IN (1, 2)),
  ADD COLUMN guest_user_id uuid
    CONSTRAINT claim_traffic_charge_guest_fk REFERENCES core.iam_user_account (id),
  -- référence de l'avis, du PV ou du reçu (jamais un nom ni un contact : format fermé)
  ADD COLUMN reference text
    CONSTRAINT claim_traffic_charge_reference_format CHECK (
      reference IS NULL
      OR (pg_catalog.char_length(reference) BETWEEN 3 AND 40
          AND reference ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*[A-Za-z0-9]$'
          AND pg_catalog.char_length(pg_catalog.regexp_replace(pg_catalog.upper(reference),
                                                               '[^A-Z0-9]', '', 'g')) >= 3)),
  ADD COLUMN reference_key text GENERATED ALWAYS AS (
    pg_catalog.regexp_replace(pg_catalog.upper(reference), '[^A-Z0-9]', '', 'g')) STORED,
  ADD COLUMN response_hours integer
    CONSTRAINT claim_traffic_charge_response_hours_range CHECK (
      response_hours IS NULL OR response_hours BETWEEN 1 AND 720),
  ADD COLUMN response_due_at timestamptz,
  ADD COLUMN cap_minor bigint
    CONSTRAINT claim_traffic_charge_cap_nonneg CHECK (cap_minor IS NULL OR cap_minor >= 0),
  ADD COLUMN guest_status text
    CONSTRAINT claim_traffic_charge_guest_status_valid CHECK (
      guest_status IS NULL
      OR guest_status IN ('AWAITING_GUEST', 'ACCEPTED', 'DISPUTED', 'DECIDED_CHARGE', 'REJECTED')),
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN disputed_at timestamptz,
  -- [C2] motif de la contestation écrit par le voyageur (consigne : aucun nom ni contact)
  ADD COLUMN dispute_reason text
    CONSTRAINT claim_traffic_charge_dispute_reason_length CHECK (
      dispute_reason IS NULL OR pg_catalog.char_length(dispute_reason) BETWEEN 20 AND 1000),
  ADD COLUMN dispute_evidence_file_ids uuid[]
    CONSTRAINT claim_traffic_charge_dispute_evidence_shape CHECK (
      dispute_evidence_file_ids IS NULL
      OR (pg_catalog.cardinality(dispute_evidence_file_ids) BETWEEN 1 AND 10
          AND pg_catalog.array_position(dispute_evidence_file_ids, NULL) IS NULL)),
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN decided_by uuid
    CONSTRAINT claim_traffic_charge_decided_by_fk REFERENCES core.iam_user_account (id),
  ADD COLUMN decided_role text
    CONSTRAINT claim_traffic_charge_decided_role_valid CHECK (
      decided_role IS NULL OR decided_role IN ('OPS_AGENT', 'ADMIN')),
  ADD COLUMN decision_request_id uuid
    CONSTRAINT claim_traffic_charge_decision_request_unique UNIQUE,
  -- [C2] motif de la décision écrit par l'agent (consigne : aucun nom ni contact)
  ADD COLUMN decision_rationale text
    CONSTRAINT claim_traffic_charge_rationale_length CHECK (
      decision_rationale IS NULL OR pg_catalog.char_length(decision_rationale) BETWEEN 20 AND 2000),
  ADD COLUMN charge_basis text
    CONSTRAINT claim_traffic_charge_charge_basis_valid CHECK (
      charge_basis IS NULL OR charge_basis IN ('GUEST_ACCEPTED', 'NO_RESPONSE', 'OPS_DECISION'));

-- exécution : VOID (rejet de l'ops, jamais débitée) ajouté, contrainte recréée sous son nom
ALTER TABLE core.claim_traffic_charge
  DROP CONSTRAINT claim_traffic_charge_execution_valid,
  ADD CONSTRAINT claim_traffic_charge_execution_valid CHECK (
    execution_status IN ('PENDING', 'DONE', 'BLOCKED', 'VOID'));

ALTER TABLE core.claim_traffic_charge
  -- version 1 (0178) : aucune des données de cette migration
  ADD CONSTRAINT claim_traffic_charge_v1_shape CHECK (
    rules_version = 2
    OR (guest_user_id IS NULL AND reference IS NULL AND response_hours IS NULL
        AND response_due_at IS NULL AND cap_minor IS NULL AND guest_status IS NULL
        AND accepted_at IS NULL AND disputed_at IS NULL AND decided_at IS NULL
        AND charge_basis IS NULL AND execution_status <> 'VOID')),
  -- version 2 : référence, voyageur, délai et plafond figés à la déclaration ; montant sous le
  -- plafond ; échéance = déclaration + délai
  ADD CONSTRAINT claim_traffic_charge_v2_shape CHECK (
    rules_version = 1
    OR (guest_user_id IS NOT NULL AND reference IS NOT NULL AND response_hours IS NOT NULL
        AND response_due_at IS NOT NULL AND cap_minor IS NOT NULL AND guest_status IS NOT NULL
        AND amount_minor <= cap_minor
        AND response_due_at = declared_at + pg_catalog.make_interval(hours => response_hours))),
  -- une réponse du voyageur est toujours AVANT l'échéance, jamais les deux
  ADD CONSTRAINT claim_traffic_charge_response_in_window CHECK (
    (accepted_at IS NULL OR (accepted_at >= declared_at AND accepted_at < response_due_at))
    AND (disputed_at IS NULL OR (disputed_at >= declared_at AND disputed_at < response_due_at))
    AND (accepted_at IS NULL OR disputed_at IS NULL)),
  ADD CONSTRAINT claim_traffic_charge_dispute_shape CHECK (
    (disputed_at IS NULL) = (dispute_reason IS NULL)
    AND (disputed_at IS NOT NULL OR dispute_evidence_file_ids IS NULL)),
  -- décision : seulement après une contestation
  ADD CONSTRAINT claim_traffic_charge_decision_shape CHECK (
    (decided_at IS NULL) = (decided_by IS NULL) AND (decided_at IS NULL) = (decided_role IS NULL)
    AND (decided_at IS NULL) = (decision_request_id IS NULL)
    AND (decided_at IS NULL) = (decision_rationale IS NULL)
    AND (decided_at IS NULL OR (disputed_at IS NOT NULL AND decided_at >= disputed_at))),
  ADD CONSTRAINT claim_traffic_charge_status_shape CHECK (
    rules_version = 1
    OR ((guest_status <> 'AWAITING_GUEST'
         OR (accepted_at IS NULL AND disputed_at IS NULL AND decided_at IS NULL))
        AND (guest_status <> 'ACCEPTED' OR (accepted_at IS NOT NULL AND decided_at IS NULL))
        AND (guest_status <> 'DISPUTED' OR (disputed_at IS NOT NULL AND decided_at IS NULL))
        AND (guest_status NOT IN ('DECIDED_CHARGE', 'REJECTED') OR decided_at IS NOT NULL)
        AND ((guest_status = 'REJECTED') = (execution_status = 'VOID')))),
  -- base du débit cohérente avec la réponse ; un débit sans réponse n'existe jamais avant
  -- l'échéance ; une décision de débit est ADMIN (F-L3-SIN-02)
  ADD CONSTRAINT claim_traffic_charge_charge_after_window CHECK (
    rules_version = 1
    OR ((execution_status = 'DONE') = (charge_basis IS NOT NULL)
        AND (charge_basis IS NULL
             OR (charge_basis = 'GUEST_ACCEPTED' AND guest_status = 'ACCEPTED'
                 AND executed_at >= accepted_at)
             OR (charge_basis = 'NO_RESPONSE' AND guest_status = 'AWAITING_GUEST'
                 AND executed_at >= response_due_at)
             OR (charge_basis = 'OPS_DECISION' AND guest_status = 'DECIDED_CHARGE'
                 AND decided_role = 'ADMIN' AND executed_at >= decided_at))));

-- une refacturation par référence et par trip (F-L3-SIN-01) ; version 2 (les lignes de 0178 n'ont
-- pas de référence)
CREATE UNIQUE INDEX claim_traffic_charge_reference_unique
  ON core.claim_traffic_charge (trip_id, reference_key) WHERE (rules_version = 2);
-- liste « à revoir » de la console : contestées sans décision
CREATE INDEX claim_traffic_charge_review_idx ON core.claim_traffic_charge (disputed_at)
  WHERE (guest_status = 'DISPUTED');
COMMENT ON COLUMN core.claim_traffic_charge.reference IS
  'Référence de l''avis, du PV ou du reçu saisie par l''hôte (format fermé) ; clé normalisée '
  'reference_key unique par trip (F-L3-SIN-01). US-318 suite (ADR-201).';
COMMENT ON COLUMN core.claim_traffic_charge.guest_status IS
  'Réponse du voyageur et décision de l''ops : AWAITING_GUEST → ACCEPTED | DISPUTED → '
  'DECIDED_CHARGE | REJECTED (F-L3-SIN-02, 08 BR-TT-02). US-318 suite (ADR-201).';

-- 1.2 Garde (0178, même signature, corps recopié) : la refacturation reste figée ; seules
-- l'exécution, la réponse du voyageur (une fois) et la décision de l'ops (une fois) changent
CREATE OR REPLACE FUNCTION core.claim_p2p_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'claim_theft_case' THEN
    -- THEFT_INVESTIGATION → RETURNED (une fois) ; déclaration PENDING → SENT | WITHDRAWN
    IF (NEW.id, NEW.trip_id, NEW.country_code, NEW.org_id, NEW.opened_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.trip_id, OLD.country_code, OLD.org_id, OLD.opened_at)
       AND (NEW.status = OLD.status AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at
            OR (OLD.status = 'THEFT_INVESTIGATION' AND NEW.status = 'RETURNED'))
       AND (NEW.insurer_status = OLD.insurer_status
            AND NEW.insurer_sent_at IS NOT DISTINCT FROM OLD.insurer_sent_at
            AND NEW.insurer_ref IS NOT DISTINCT FROM OLD.insurer_ref
            OR (OLD.insurer_status = 'PENDING' AND NEW.insurer_status IN ('SENT', 'WITHDRAWN'))) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'claim_traffic_charge' THEN
    -- l'exécution change : PENDING → DONE | BLOCKED | VOID, le débit rattaché une fois ; la réponse
    -- du voyageur et la décision de l'ops sont écrites une fois, avant toute exécution (0181)
    IF (NEW.id, NEW.trip_id, NEW.country_code, NEW.currency, NEW.org_id, NEW.declared_by, NEW.kind,
        NEW.occurred_at, NEW.file_id, NEW.amount_minor, NEW.fee_bps, NEW.admin_fee_minor,
        NEW.total_minor, NEW.leg_host_minor, NEW.leg_insurer_minor, NEW.leg_tax_third_party_minor,
        NEW.leg_platform_minor, NEW.trip_start_at, NEW.trip_end_at, NEW.deadline_at,
        NEW.request_id, NEW.declared_at, NEW.rules_version, NEW.guest_user_id, NEW.reference,
        NEW.response_hours, NEW.response_due_at, NEW.cap_minor)
       IS NOT DISTINCT FROM
       (OLD.id, OLD.trip_id, OLD.country_code, OLD.currency, OLD.org_id, OLD.declared_by, OLD.kind,
        OLD.occurred_at, OLD.file_id, OLD.amount_minor, OLD.fee_bps, OLD.admin_fee_minor,
        OLD.total_minor, OLD.leg_host_minor, OLD.leg_insurer_minor, OLD.leg_tax_third_party_minor,
        OLD.leg_platform_minor, OLD.trip_start_at, OLD.trip_end_at, OLD.deadline_at,
        OLD.request_id, OLD.declared_at, OLD.rules_version, OLD.guest_user_id, OLD.reference,
        OLD.response_hours, OLD.response_due_at, OLD.cap_minor)
       AND (OLD.charge_id IS NULL OR NEW.charge_id IS NOT DISTINCT FROM OLD.charge_id)
       AND NEW.failed_attempts >= OLD.failed_attempts
       AND (OLD.execution_status = 'PENDING'
            OR (OLD.execution_status = NEW.execution_status
                AND NEW.executed_at IS NOT DISTINCT FROM OLD.executed_at
                AND NEW.guest_status IS NOT DISTINCT FROM OLD.guest_status))
       AND (NEW.guest_status IS NOT DISTINCT FROM OLD.guest_status
            OR (OLD.guest_status = 'AWAITING_GUEST' AND NEW.guest_status IN ('ACCEPTED', 'DISPUTED'))
            OR (OLD.guest_status = 'DISPUTED' AND NEW.guest_status IN ('DECIDED_CHARGE', 'REJECTED')))
       AND (OLD.accepted_at IS NULL OR NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at)
       AND (OLD.disputed_at IS NULL
            OR (NEW.disputed_at, NEW.dispute_reason, NEW.dispute_evidence_file_ids)
               IS NOT DISTINCT FROM
               (OLD.disputed_at, OLD.dispute_reason, OLD.dispute_evidence_file_ids))
       AND (OLD.decided_at IS NULL
            OR (NEW.decided_at, NEW.decided_by, NEW.decided_role, NEW.decision_request_id,
                NEW.decision_rationale)
               IS NOT DISTINCT FROM
               (OLD.decided_at, OLD.decided_by, OLD.decided_role, OLD.decision_request_id,
                OLD.decision_rationale))
       AND (OLD.charge_basis IS NULL OR NEW.charge_basis IS NOT DISTINCT FROM OLD.charge_basis) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'claim p2p: % refused on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'claim_p2p_record_immutable';
END
$fn$;
COMMENT ON FUNCTION core.claim_p2p_guard() IS
  'Garde des registres d''US-318 : dossier de vol THEFT_INVESTIGATION → RETURNED, déclaration à '
  'l''assureur PENDING → SENT | WITHDRAWN ; incident immuable ; refacturation figée (seules son '
  'exécution, la réponse du voyageur et la décision de l''ops changent, une fois chacune) ; jamais '
  'de DELETE ni de TRUNCATE. US-318 (ADR-198, ADR-201).';
REVOKE ALL ON FUNCTION core.claim_p2p_guard() FROM PUBLIC;

-- 1.3 Écriture de la déclaration (cmd_hold_owner) : version 2 seulement, en attente du voyageur
CREATE POLICY cmd_hold_traffic_ins_v2 ON core.claim_traffic_charge AS RESTRICTIVE FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (rules_version = 2 AND guest_status = 'AWAITING_GUEST' AND accepted_at IS NULL
              AND disputed_at IS NULL AND decided_at IS NULL AND charge_basis IS NULL);

-- 1.4 Réponse du voyageur et décision du staff (cmd_money_owner, contexte posé par la commande)
GRANT UPDATE (guest_status, accepted_at, disputed_at, dispute_reason, dispute_evidence_file_ids,
              decided_at, decided_by, decided_role, decision_request_id, decision_rationale,
              charge_basis)
  ON core.claim_traffic_charge TO cmd_money_owner;
CREATE POLICY cmd_money_traffic_party_upd ON core.claim_traffic_charge FOR UPDATE
  TO cmd_money_owner
  USING ((app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id())
         OR app.actor_kind() = 'STAFF')
  WITH CHECK ((app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id()
               AND guest_status IN ('ACCEPTED', 'DISPUTED'))
              OR (app.actor_kind() = 'STAFF' AND guest_status IN ('DECIDED_CHARGE', 'REJECTED')));
-- en-tête pour la porte du staff (pays, trip, état) ; jamais les textes
GRANT SELECT (id, trip_id, country_code, rules_version, guest_status, disputed_at, execution_status)
  ON core.claim_traffic_charge TO iam_staff_owner;
CREATE POLICY iam_staff_traffic_sel ON core.claim_traffic_charge FOR SELECT TO iam_staff_owner
  USING (true);
-- délai et plafond du pays (17 §7.2, ce groupe), lus par cmd_money_owner seulement
CREATE POLICY cmd_money_traffic_guest_param_read ON core.config_param_value FOR SELECT
  TO cmd_money_owner
  USING (key IN ('traffic_guest_response_h', 'traffic_guest_charge_max_minor'));
-- avis au voyageur (NTF `EVT_INVOICE_TO_GUEST`, US-706) : invoice.status_changed, agrégat
-- traffic_charge, acteur HOST (le titulaire de la session)
CREATE POLICY cmd_money_traffic_event ON core.outbox_outbox_event FOR INSERT
  TO cmd_money_owner
  WITH CHECK (type = 'invoice.status_changed' AND aggregate_type = 'traffic_charge'
              AND actor_role = 'HOST' AND actor_user_id IS NOT NULL);

-- 2. Réponse du voyageur, décision de l'ops, travailleur (cmd_money_owner) ---------------------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 2.1 Refacturation à exécuter maintenant : prédicat unique de la file et de l'exécution (fonction
-- pure). Version 1 : sortie de la file par un BLOCKED (fail-closed). Version 2 : payée, décidée,
-- ou en attente du voyageur échéance PASSÉE ; jamais contestée, jamais avant l'échéance.
CREATE FUNCTION core.claim_traffic_charge_eligible(p_rules_version smallint, p_execution text,
                                                   p_guest text, p_due timestamptz,
                                                   p_next timestamptz, p_now timestamptz)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(p_execution = 'PENDING' AND p_next <= p_now
                  AND (p_rules_version = 1
                       OR p_guest IN ('ACCEPTED', 'DECIDED_CHARGE')
                       OR (p_guest = 'AWAITING_GUEST' AND p_now >= p_due)), false)
$fn$;
COMMENT ON FUNCTION core.claim_traffic_charge_eligible(smallint, text, text, timestamptz,
  timestamptz, timestamptz) IS
  'Interne : une refacturation est-elle à exécuter maintenant (payée, décidée, ou échéance du '
  'voyageur passée sans réponse) ; jamais contestée, jamais avant l''échéance. US-318 suite '
  '(ADR-201).';
REVOKE ALL ON FUNCTION core.claim_traffic_charge_eligible(smallint, text, text, timestamptz,
  timestamptz, timestamptz) FROM PUBLIC;

-- 2.2 Délai du voyageur et plafond du pays en vigueur (NULL : absent ou mal formé, l'appelant
-- refuse). Lu pour la déclaration (cmd_hold_owner) sans politique nouvelle de cmd_hold_owner.
CREATE FUNCTION core.claim_traffic_guest_terms(p_country text)
  RETURNS TABLE (response_hours integer, cap_minor bigint)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_h   jsonb := core.claim_incidental_param('traffic_guest_response_h', p_country);
  v_cap jsonb := core.claim_incidental_param('traffic_guest_charge_max_minor', p_country);
BEGIN
  RETURN QUERY SELECT
    CASE WHEN pg_catalog.jsonb_typeof(v_h) = 'number' AND (v_h #>> '{}') ~ '^[1-9][0-9]{0,2}$'
              AND (v_h #>> '{}')::integer <= 720
         THEN (v_h #>> '{}')::integer END,
    CASE WHEN pg_catalog.jsonb_typeof(v_cap) IN ('string', 'number')
              AND (v_cap #>> '{}') ~ '^(0|[1-9][0-9]{0,14})$'
         THEN (v_cap #>> '{}')::bigint END;
END
$fn$;
COMMENT ON FUNCTION core.claim_traffic_guest_terms(text) IS
  'Interne : délai de réponse du voyageur (traffic_guest_response_h) et plafond du montant '
  '(traffic_guest_charge_max_minor) du pays ; NULL si absents. EXECUTE cmd_hold_owner. US-318 '
  'suite (ADR-201).';
REVOKE ALL ON FUNCTION core.claim_traffic_guest_terms(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_traffic_guest_terms(text) TO cmd_hold_owner;

-- 2.3 Avis au voyageur d'une refacturation déclarée (même événement que les frais annexes d'US-706,
-- règle NTF EVT_INVOICE_TO_GUEST) ; relu en base, une fois par refacturation. Rend true si l'avis
-- est écrit.
CREATE FUNCTION core.claim_traffic_notify_guest(p_traffic_charge_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  x core.claim_traffic_charge%ROWTYPE;
BEGIN
  SELECT * INTO x FROM core.claim_traffic_charge AS c
   WHERE c.id = p_traffic_charge_id AND c.rules_version = 2 AND c.guest_status = 'AWAITING_GUEST';
  IF x.id IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('invoice.status_changed', 1, 'traffic_charge', x.id, 0, x.country_code, x.declared_by,
          'HOST', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object(
            'invoice_id', x.id, 'trip_id', x.trip_id, 'status', 'AWAITING_GUEST',
            'fee_type', x.kind, 'amount_minor', x.total_minor::text, 'currency', x.currency,
            'response_due_at', pg_catalog.to_char(x.response_due_at AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
          x.trip_id::text);
  RETURN true;
END
$fn$;
COMMENT ON FUNCTION core.claim_traffic_notify_guest(uuid) IS
  'Interne : avis invoice.status_changed (AWAITING_GUEST) d''une refacturation déclarée ; voyageur '
  'lu en base par NTF ; jamais le motif ni la référence. EXECUTE cmd_hold_owner. US-318 suite '
  '(ADR-201).';
REVOKE ALL ON FUNCTION core.claim_traffic_notify_guest(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_traffic_notify_guest(uuid) TO cmd_hold_owner;

-- 2.4 Refacturations du trip vues par son voyageur (S12 : payer ou contester) : nature, fait,
-- référence, montants et jambes, échéance, état, pièce de l'hôte (identifiant), motif de sa
-- contestation et motif de la décision ; photos du trip proposées comme pièces tant qu'une réponse
-- est possible. NULL pour toute autre personne (hôte compris : il a sa vue).
CREATE FUNCTION core.claim_traffic_guest_view(p_token_hash bytea, p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p     record;
  v_now timestamptz := platform.now();
  v_cur text;
  v_c   jsonb;
  v_any boolean;
BEGIN
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, p_trip_id);
  IF p.user_id IS NULL OR p.role <> 'GUEST' THEN
    RETURN NULL;
  END IF;
  SELECT t.currency::text INTO v_cur FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', x.id, 'kind', x.kind,
           'occurredAt', pg_catalog.to_char(x.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'reference', x.reference,
           'amountMinor', x.amount_minor::text, 'adminFeeMinor', x.admin_fee_minor::text,
           'totalMinor', x.total_minor::text,
           'legs', pg_catalog.jsonb_build_object('HOST', x.leg_host_minor::text,
                                                 'INSURER', x.leg_insurer_minor::text,
                                                 'TAX_THIRD_PARTY', x.leg_tax_third_party_minor::text,
                                                 'PLATFORM', x.leg_platform_minor::text),
           'declaredAt', pg_catalog.to_char(x.declared_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'responseDueAt', pg_catalog.to_char(x.response_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'status', x.guest_status, 'executionStatus', x.execution_status,
           'canRespond', x.guest_status = 'AWAITING_GUEST' AND x.execution_status = 'PENDING'
                         AND v_now < x.response_due_at,
           'evidenceFileId', x.file_id,
           'disputeReason', x.dispute_reason,
           'decidedAt', pg_catalog.to_char(x.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'decisionRationale', x.decision_rationale)
           ORDER BY x.declared_at, x.reference_key), '[]'::jsonb),
         COALESCE(pg_catalog.bool_or(x.guest_status = 'AWAITING_GUEST'
                                     AND x.execution_status = 'PENDING'
                                     AND v_now < x.response_due_at), false)
    INTO v_c, v_any
    FROM core.claim_traffic_charge AS x
   WHERE x.trip_id = p_trip_id AND x.rules_version = 2 AND x.guest_user_id = p.user_id;
  RETURN pg_catalog.jsonb_build_object(
    'tripId', p_trip_id, 'currency', v_cur, 'charges', v_c,
    'photos', CASE WHEN v_any THEN COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'fileId', ph.file_id, 'kind', ph.kind, 'slot', ph.slot_code,
               'takenBy', ph.taken_by_role,
               'receivedAt', pg_catalog.to_char(ph.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
        FROM core.claim_incidental_trip_photos(p_trip_id) AS ph), '[]'::jsonb)
      ELSE '[]'::jsonb END);
END
$fn$;
COMMENT ON FUNCTION core.claim_traffic_guest_view(bytea, uuid) IS
  'Refacturations d''amendes, péages et fourrières du trip vues par son voyageur (payer ou '
  'contester avant l''échéance) ; aucune donnée nominative de l''hôte. SECURITY DEFINER, EXECUTE '
  'app_api. US-318 suite (ADR-201).';

-- 2.5 Paiement par le voyageur (AWAITING_GUEST → ACCEPTED, accord écrit) ; débit par Kmino ensuite.
-- Issues : ACCEPTED, ALREADY_ACCEPTED, NOT_FOUND, GUEST_RESPONSE_WINDOW_CLOSED (à l'échéance ou
-- après), TRAFFIC_NOT_OPEN (contestée, décidée, exécutée).
CREATE FUNCTION core.claim_cmd_accept_traffic_charge(p_token_hash bytea, p_traffic_charge_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip  uuid;
  p       record;
  x       core.claim_traffic_charge%ROWTYPE;
  v_now   timestamptz;
  v_kind  text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor text := pg_catalog.current_setting('app.actor_id', true);
BEGIN
  SELECT c.trip_id INTO v_trip FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id;
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, v_trip);
  IF v_trip IS NULL OR p.user_id IS NULL OR p.role <> 'GUEST' THEN
    RETURN 'NOT_FOUND';
  END IF;
  -- verrou du trip d'abord (ordre de l'exécution), puis lecture simple (jamais FOR UPDATE : la
  -- politique UPDATE ne voit la ligne qu'une fois le contexte posé)
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO x FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id;
  v_now := platform.now();
  IF x.id IS NULL OR x.rules_version <> 2 OR x.guest_user_id IS DISTINCT FROM p.user_id THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF x.accepted_at IS NOT NULL THEN
    RETURN 'ALREADY_ACCEPTED';
  END IF;
  IF x.guest_status <> 'AWAITING_GUEST' OR x.execution_status <> 'PENDING' THEN
    RETURN 'TRAFFIC_NOT_OPEN';
  END IF;
  IF v_now >= x.response_due_at THEN
    RETURN 'GUEST_RESPONSE_WINDOW_CLOSED';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  UPDATE core.claim_traffic_charge AS c
     SET guest_status = 'ACCEPTED', accepted_at = v_now, next_check_at = v_now
   WHERE c.id = x.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim: traffic charge update refused' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  RETURN 'ACCEPTED';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_accept_traffic_charge(bytea, uuid) IS
  'Paiement d''une refacturation par le voyageur du trip avant l''échéance (accord écrit) ; débit '
  'par Kmino ensuite. EXECUTE app_api. US-318 suite (ADR-201).';

-- 2.6 Contestation par le voyageur (AWAITING_GUEST → DISPUTED) : motif écrit (20 à 1 000
-- caractères) et, s'il le veut, jusqu'à 10 photos des séries du trip (aucune exigée : une amende se
-- conteste souvent sans photo, jamais plus lourd que Turo). Issues : DISPUTED, ALREADY_DISPUTED,
-- NOT_FOUND, GUEST_RESPONSE_WINDOW_CLOSED, TRAFFIC_NOT_OPEN, INCIDENTAL_DISPUTE_REASON_REQUIRED,
-- CLAIM_EVIDENCE_MISSING (pièce étrangère au trip ou plus de 10).
CREATE FUNCTION core.claim_cmd_dispute_traffic_charge(p_token_hash bytea, p_traffic_charge_id uuid,
                                                      p_reason text, p_evidence uuid[])
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip   uuid;
  p        record;
  x        core.claim_traffic_charge%ROWTYPE;
  v_now    timestamptz;
  v_ev     uuid[];
  v_n      integer;
  v_known  integer;
  v_reason text := pg_catalog.btrim(p_reason);
  v_kind   text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor  text := pg_catalog.current_setting('app.actor_id', true);
BEGIN
  SELECT c.trip_id INTO v_trip FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id;
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, v_trip);
  IF v_trip IS NULL OR p.user_id IS NULL OR p.role <> 'GUEST' THEN
    RETURN 'NOT_FOUND';
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO x FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id;
  v_now := platform.now();
  IF x.id IS NULL OR x.rules_version <> 2 OR x.guest_user_id IS DISTINCT FROM p.user_id THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF x.disputed_at IS NOT NULL THEN
    RETURN 'ALREADY_DISPUTED';
  END IF;
  IF x.guest_status <> 'AWAITING_GUEST' OR x.execution_status <> 'PENDING' THEN
    RETURN 'TRAFFIC_NOT_OPEN';
  END IF;
  IF v_now >= x.response_due_at THEN
    RETURN 'GUEST_RESPONSE_WINDOW_CLOSED';
  END IF;
  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) NOT BETWEEN 20 AND 1000 THEN
    RETURN 'INCIDENTAL_DISPUTE_REASON_REQUIRED';
  END IF;
  SELECT pg_catalog.array_agg(DISTINCT e ORDER BY e) INTO v_ev
    FROM pg_catalog.unnest(COALESCE(p_evidence, '{}'::uuid[])) AS e WHERE e IS NOT NULL;
  v_n := COALESCE(pg_catalog.cardinality(v_ev), 0);
  SELECT pg_catalog.count(DISTINCT ph.file_id)::integer INTO v_known
    FROM core.claim_incidental_trip_photos(v_trip) AS ph
   WHERE ph.file_id = ANY (COALESCE(v_ev, '{}'::uuid[]));
  IF v_n > 10 OR v_known <> v_n THEN
    RETURN 'CLAIM_EVIDENCE_MISSING';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  UPDATE core.claim_traffic_charge AS c
     SET guest_status = 'DISPUTED', disputed_at = v_now, dispute_reason = v_reason,
         dispute_evidence_file_ids = CASE WHEN v_n = 0 THEN NULL ELSE v_ev END
   WHERE c.id = x.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim: traffic charge update refused' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  RETURN 'DISPUTED';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_dispute_traffic_charge(bytea, uuid, text, uuid[]) IS
  'Contestation d''une refacturation par le voyageur avant l''échéance (motif, photos du trip '
  'facultatives) ; aucun débit avant la décision de l''ops. EXECUTE app_api. US-318 suite (ADR-201).';

-- 2.7 Décision de l'ops après contestation (appelée par la porte du staff, qui a jugé la session,
-- la permission, le pays et la séparation des tâches ; mêmes règles qu'US-706). Issues : DECIDED,
-- ALREADY_DECIDED, NOT_FOUND, TRAFFIC_NOT_DISPUTED, DECISION_RATIONALE_REQUIRED,
-- DECISION_FINALITY_FORBIDDEN, DECISION_ADMIN_REQUIRED, REQUEST_INVALID.
CREATE FUNCTION core.claim_cmd_decide_traffic_charge(p_traffic_charge_id uuid, p_agent uuid,
                                                     p_role text, p_request_id uuid,
                                                     p_outcome text, p_rationale text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip uuid;
  x      core.claim_traffic_charge%ROWTYPE;
  v_rat  text := pg_catalog.btrim(p_rationale);
  v_now  timestamptz;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RAISE EXCEPTION 'claim: decide_traffic_charge reserved to the staff gate'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  IF p_request_id IS NULL OR p_agent IS NULL OR p_role IS NULL OR p_role NOT IN ('OPS_AGENT', 'ADMIN')
     OR p_outcome IS NULL OR p_outcome NOT IN ('CHARGE', 'REJECT') THEN
    RETURN 'REQUEST_INVALID';
  END IF;
  SELECT c.trip_id INTO v_trip FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id;
  IF v_trip IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO x FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id FOR UPDATE;
  v_now := platform.now();
  IF x.decision_request_id = p_request_id THEN
    RETURN 'ALREADY_DECIDED';
  END IF;
  IF x.rules_version <> 2 OR x.guest_status <> 'DISPUTED' OR x.execution_status <> 'PENDING' THEN
    RETURN 'TRAFFIC_NOT_DISPUTED';
  END IF;
  IF v_rat IS NULL OR pg_catalog.char_length(v_rat) NOT BETWEEN 20 AND 2000 THEN
    RETURN 'DECISION_RATIONALE_REQUIRED';
  END IF;
  -- jamais une décision « définitive » (OQ-BR-24 ; même lecture que 0175 et 0177)
  IF v_rat ~* '(definitiv|définitiv|inapelable|sin (derecho a )?apelaci|sans (appel|recours)|sem (direito a )?recurso|irrecorr|final and binding|not subject to appeal)' THEN
    RETURN 'DECISION_FINALITY_FORBIDDEN';
  END IF;
  -- toute décision qui débite le voyageur est réservée à ADMIN (ADR-195)
  IF p_outcome = 'CHARGE' AND p_role <> 'ADMIN' THEN
    RETURN 'DECISION_ADMIN_REQUIRED';
  END IF;
  UPDATE core.claim_traffic_charge AS c
     SET guest_status = CASE p_outcome WHEN 'CHARGE' THEN 'DECIDED_CHARGE' ELSE 'REJECTED' END,
         execution_status = CASE p_outcome WHEN 'CHARGE' THEN 'PENDING' ELSE 'VOID' END,
         decided_at = v_now, decided_by = p_agent, decided_role = p_role,
         decision_request_id = p_request_id, decision_rationale = v_rat, next_check_at = v_now
   WHERE c.id = x.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim: traffic charge update refused' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  RETURN 'DECIDED';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_decide_traffic_charge(uuid, uuid, text, uuid, text, text) IS
  'Décision motivée de l''ops sur une refacturation contestée (débiter : ADMIN ; rejeter : jamais '
  'débitée), jamais « définitive ». Appelée par la porte du staff. EXECUTE iam_staff_owner. US-318 '
  'suite (ADR-201).';

-- 2.8 Vue d'une refacturation pour la console (aucune donnée nominative ; textes du voyageur et de
-- l'agent, consigne : aucun nom ni contact)
CREATE FUNCTION core.claim_traffic_staff_view(p_traffic_charge_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
           'id', x.id, 'tripId', x.trip_id, 'country', x.country_code, 'currency', x.currency,
           'kind', x.kind, 'reference', x.reference,
           'occurredAt', pg_catalog.to_char(x.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'amountMinor', x.amount_minor::text, 'adminFeeMinor', x.admin_fee_minor::text,
           'totalMinor', x.total_minor::text, 'capMinor', x.cap_minor::text,
           'legs', pg_catalog.jsonb_build_object('HOST', x.leg_host_minor::text,
                                                 'INSURER', x.leg_insurer_minor::text,
                                                 'TAX_THIRD_PARTY', x.leg_tax_third_party_minor::text,
                                                 'PLATFORM', x.leg_platform_minor::text),
           'evidenceFileId', x.file_id,
           'declaredAt', pg_catalog.to_char(x.declared_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'responseDueAt', pg_catalog.to_char(x.response_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'status', x.guest_status, 'executionStatus', x.execution_status,
           'acceptedAt', pg_catalog.to_char(x.accepted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'disputedAt', pg_catalog.to_char(x.disputed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'disputeReason', x.dispute_reason,
           'disputeEvidence', COALESCE(pg_catalog.to_jsonb(x.dispute_evidence_file_ids), '[]'::jsonb),
           'decision', CASE WHEN x.decided_at IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
             'outcome', CASE x.guest_status WHEN 'DECIDED_CHARGE' THEN 'CHARGE' ELSE 'REJECT' END,
             'role', x.decided_role, 'rationale', x.decision_rationale,
             'decidedAt', pg_catalog.to_char(x.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END,
           'chargeBasis', x.charge_basis,
           'decidable', x.rules_version = 2 AND x.guest_status = 'DISPUTED'
                        AND x.execution_status = 'PENDING')
    FROM core.claim_traffic_charge AS x WHERE x.id = p_traffic_charge_id
$fn$;
COMMENT ON FUNCTION core.claim_traffic_staff_view(uuid) IS
  'Interne : vue d''une refacturation pour la console (montants, jambes, référence, pièce, '
  'contestation, décision). EXECUTE iam_staff_owner. US-318 suite (ADR-201).';

-- 2.9 Détail des refacturations « à revoir » choisies par la porte (ordre conservé)
CREATE FUNCTION core.claim_traffic_review_list(p_ids uuid[])
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', x.id, 'tripId', x.trip_id, 'country', x.country_code, 'currency', x.currency,
           'kind', x.kind, 'totalMinor', x.total_minor::text,
           'disputedAt', pg_catalog.to_char(x.disputed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
           ORDER BY k.ord), '[]'::jsonb)
    FROM pg_catalog.unnest(COALESCE(p_ids, '{}'::uuid[])) WITH ORDINALITY AS k(id, ord)
    JOIN core.claim_traffic_charge AS x ON x.id = k.id
$fn$;
COMMENT ON FUNCTION core.claim_traffic_review_list(uuid[]) IS
  'Interne : détail des refacturations contestées à décider (liste de la console). EXECUTE '
  'iam_staff_owner. US-318 suite (ADR-201).';

REVOKE ALL ON FUNCTION core.claim_traffic_guest_view(bytea, uuid),
  core.claim_cmd_accept_traffic_charge(bytea, uuid),
  core.claim_cmd_dispute_traffic_charge(bytea, uuid, text, uuid[]),
  core.claim_cmd_decide_traffic_charge(uuid, uuid, text, uuid, text, text),
  core.claim_traffic_staff_view(uuid), core.claim_traffic_review_list(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_traffic_guest_view(bytea, uuid),
  core.claim_cmd_accept_traffic_charge(bytea, uuid),
  core.claim_cmd_dispute_traffic_charge(bytea, uuid, text, uuid[]) TO app_api;
GRANT EXECUTE ON FUNCTION core.claim_cmd_decide_traffic_charge(uuid, uuid, text, uuid, text, text),
  core.claim_traffic_staff_view(uuid), core.claim_traffic_review_list(uuid[]) TO iam_staff_owner;

-- 2.10 File du travailleur (0178, même signature) : prédicat 2.1, plus anciennes d'abord
CREATE OR REPLACE FUNCTION core.claim_traffic_charges_due(p_limit integer)
  RETURNS TABLE (traffic_charge_id uuid)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now timestamptz := platform.now();
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: traffic_charges_due reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  RETURN QUERY
  SELECT x.id FROM core.claim_traffic_charge AS x
   WHERE x.execution_status = 'PENDING' AND x.next_check_at <= v_now
     AND core.claim_traffic_charge_eligible(x.rules_version, x.execution_status, x.guest_status,
                                            x.response_due_at, x.next_check_at, v_now)
   ORDER BY x.next_check_at, x.declared_at, x.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END
$fn$;
COMMENT ON FUNCTION core.claim_traffic_charges_due(integer) IS
  'Travailleur payment_command : refacturations à exécuter (payées, décidées, ou échéance du '
  'voyageur passée sans réponse ; jamais contestées). EXECUTE app_worker. US-318 (ADR-198, ADR-201).';

-- 2.11 Exécution par Kmino (0178, même signature, corps recopié) : sous le verrou du trip puis de
-- la refacturation, l'éligibilité est relue à l'heure de la base (APRÈS les verrous). Issues :
-- DONE (rejeu : même issue), BLOCKED (`NO_CARD_TENDER`, `TRIP_UNKNOWN`, `GUEST_RESPONSE_MISSING` :
-- version 1), NOT_DUE (`GUEST_RESPONSE_WINDOW_OPEN`, `TRAFFIC_DISPUTED` ; rien d'écrit), VOID
-- (rejet de l'ops), NOT_FOUND.
CREATE OR REPLACE FUNCTION core.claim_cmd_execute_traffic_charge(p_traffic_charge_id uuid,
                                                                 p_charge_id uuid)
  RETURNS TABLE (outcome text, code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t        record;
  x        core.claim_traffic_charge%ROWTYPE;
  v_trip   uuid;
  v_tender uuid;
  v_now    timestamptz;
  v_basis  text;
  r        record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: execute_traffic_charge reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  IF p_traffic_charge_id IS NULL OR p_charge_id IS NULL THEN
    RAISE EXCEPTION 'claim: invalid execution input' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT c.trip_id INTO v_trip FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  SELECT b.id, b.country_code, b.currency, b.source_hold_id INTO t
    FROM core.booking_trip AS b WHERE b.id = v_trip FOR UPDATE;
  SELECT * INTO x FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id FOR UPDATE;
  v_now := platform.now();
  IF x.execution_status <> 'PENDING' THEN
    RETURN QUERY SELECT x.execution_status, x.execution_code;
    RETURN;
  END IF;
  IF x.rules_version = 1 THEN
    -- refacturation de 0178 sans délai de réponse : jamais débitée automatiquement (fail-closed)
    UPDATE core.claim_traffic_charge AS c
       SET execution_status = 'BLOCKED', execution_code = 'GUEST_RESPONSE_MISSING'
     WHERE c.id = x.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'GUEST_RESPONSE_MISSING'::text;
    RETURN;
  END IF;
  IF x.guest_status = 'DISPUTED' THEN
    RETURN QUERY SELECT 'NOT_DUE'::text, 'TRAFFIC_DISPUTED'::text;
    RETURN;
  END IF;
  IF NOT core.claim_traffic_charge_eligible(x.rules_version, x.execution_status, x.guest_status,
                                            x.response_due_at, LEAST(x.next_check_at, v_now),
                                            v_now) THEN
    RETURN QUERY SELECT 'NOT_DUE'::text, 'GUEST_RESPONSE_WINDOW_OPEN'::text;
    RETURN;
  END IF;
  v_basis := CASE x.guest_status WHEN 'ACCEPTED' THEN 'GUEST_ACCEPTED'
                                 WHEN 'DECIDED_CHARGE' THEN 'OPS_DECISION'
                                 ELSE 'NO_RESPONSE' END;
  IF t.id IS NULL OR t.country_code <> x.country_code OR t.currency <> x.currency THEN
    UPDATE core.claim_traffic_charge AS c
       SET execution_status = 'BLOCKED', execution_code = 'TRIP_UNKNOWN'
     WHERE c.id = x.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'TRIP_UNKNOWN'::text;
    RETURN;
  END IF;
  SELECT o.id INTO v_tender
    FROM core.payment_payment_operation AS o
   WHERE (o.trip_id = t.id OR (t.source_hold_id IS NOT NULL AND o.hold_id = t.source_hold_id))
     AND o.kind IN ('AUTH', 'CAPTURE') AND o.method = 'CARD' AND o.purpose = 'RENT'
     AND o.status = 'SUCCEEDED' AND o.currency = t.currency
   ORDER BY (o.kind = 'CAPTURE') DESC, o.created_at, o.id
   LIMIT 1;
  IF v_tender IS NULL THEN
    UPDATE core.claim_traffic_charge AS c
       SET execution_status = 'BLOCKED', execution_code = 'NO_CARD_TENDER'
     WHERE c.id = x.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'NO_CARD_TENDER'::text;
    RETURN;
  END IF;
  -- débit séparé d'US-703 : montant explicite de chaque jambe ; accord écrit = paiement du voyageur
  SELECT * INTO r FROM core.payment_cmd_notify_post_trip_charge(
    p_charge_id, t.id, 'INCIDENTAL', 'DELAYED_CHARGES', 'TRAFFIC_CHARGE', x.id, NULL, v_tender,
    x.total_minor,
    pg_catalog.jsonb_build_object('HOST', x.leg_host_minor::text,
                                  'INSURER', x.leg_insurer_minor::text,
                                  'TAX_THIRD_PARTY', x.leg_tax_third_party_minor::text,
                                  'PLATFORM', x.leg_platform_minor::text),
    v_basis = 'GUEST_ACCEPTED');
  UPDATE core.claim_traffic_charge AS c
     SET execution_status = 'DONE', execution_code = NULL, charge_id = r.charge_id,
         executed_at = v_now, charge_basis = v_basis
   WHERE c.id = x.id;
  RETURN QUERY SELECT 'DONE'::text, NULL::text;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_execute_traffic_charge(uuid, uuid) IS
  'Exécution d''une refacturation par Kmino : payée, décidée par l''ops (ADMIN) ou échéance du '
  'voyageur passée sans réponse ; jamais contestée ni avant l''échéance ; débit séparé du voyageur '
  '(US-703, but INCIDENTAL, motif DELAYED_CHARGES, jambes explicites, jamais la caution). '
  'Travailleur payment_command. EXECUTE app_worker. US-318 (ADR-198, ADR-201).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 3. Déclaration et vue de l'hôte (cmd_hold_owner, EXECUTE app_api) -----------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 3.1 Amende, péage ou fourrière déclarés par le titulaire (0178 2.6 recopiée, élargie : référence
-- obligatoire et unique par trip, plafond, délai du voyageur, avis). Issues de 0178 (NOT_FOUND,
-- TRAFFIC_TRIP_NOT_ENDED, TRAFFIC_WINDOW_UNKNOWN, TRAFFIC_FEE_UNKNOWN,
-- TRAFFIC_CHARGE_DEADLINE_PASSED, TRAFFIC_OUTSIDE_TRIP, TRAFFIC_EVIDENCE_REQUIRED, PREVIEW,
-- DECLARED, DUPLICATE), plus : TRAFFIC_REFERENCE_REQUIRED (référence absente),
-- TRAFFIC_RESPONSE_WINDOW_UNKNOWN / TRAFFIC_CAP_UNKNOWN (paramètre absent),
-- TRAFFIC_AMOUNT_ABOVE_CAP (montant au-delà du plafond du pays ; `body.capMinor`),
-- TRAFFIC_DUPLICATE (référence déjà refacturée sur ce trip ; `body.chargeId`). Rien n'est écrit
-- hors DECLARED. Une référence mal formée lève 22023 (entrée invalide).
CREATE FUNCTION core.claim_cmd_declare_traffic_charge(p_token_hash bytea, p_request_id uuid,
                                                      p_trip_id uuid, p_kind text,
                                                      p_occurred_at timestamptz,
                                                      p_amount_minor bigint, p_file_id uuid,
                                                      p_preview boolean, p_reference text)
  RETURNS TABLE (outcome text, charge_id uuid, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p      record;
  f      record;
  g      record;
  v_old  core.claim_traffic_charge%ROWTYPE;
  v_legs bigint[];
  v_now  timestamptz;
  v_id   uuid;
  v_ok   boolean;
  v_ref  text := NULLIF(pg_catalog.btrim(p_reference), '');
  v_key  text;
  v_dup  uuid;
  v_due  timestamptz;
  v_guest uuid;
BEGIN
  IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('TOLL', 'FINE', 'IMPOUND')
     OR p_occurred_at IS NULL OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_amount_minor > 1000000000000 OR p_file_id IS NULL OR p_preview IS NULL
     OR (v_ref IS NOT NULL
         AND (pg_catalog.char_length(v_ref) NOT BETWEEN 3 AND 40
              OR v_ref !~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*[A-Za-z0-9]$'
              OR pg_catalog.char_length(pg_catalog.regexp_replace(pg_catalog.upper(v_ref),
                                                                  '[^A-Z0-9]', '', 'g')) < 3)) THEN
    RAISE EXCEPTION 'refacturation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, 'TRAFFIC');
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF v_ref IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_REFERENCE_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  v_key := pg_catalog.regexp_replace(pg_catalog.upper(v_ref), '[^A-Z0-9]', '', 'g');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim.traffic:' || p_request_id::text, 0));
  -- déclarations d'un même trip sérialisées (F-L3-SIN-01 : course de deux déclarations du même PV)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim.traffic.trip:' || p.trip_id::text, 0));
  SELECT * INTO v_old FROM core.claim_traffic_charge AS x WHERE x.request_id = p_request_id;
  IF v_old.id IS NOT NULL AND NOT p_preview THEN
    IF v_old.trip_id = p.trip_id AND v_old.declared_by = p.user_id AND v_old.kind = p_kind
       AND v_old.occurred_at = p_occurred_at AND v_old.amount_minor = p_amount_minor
       AND v_old.file_id = p_file_id AND v_old.reference IS NOT DISTINCT FROM v_ref THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_old.id, pg_catalog.jsonb_build_object(
        'amountMinor', v_old.amount_minor::text, 'adminFeeMinor', v_old.admin_fee_minor::text,
        'totalMinor', v_old.total_minor::text,
        'deadlineAt', pg_catalog.to_char(v_old.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'responseDueAt', pg_catalog.to_char(v_old.response_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
      RETURN;
    END IF;
    RAISE EXCEPTION 'refacturation : identifiant de requête déjà utilisé'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO f FROM core.claim_traffic_facts(p.trip_id);
  IF f.trip_id IS NULL OR f.holder_user_id IS DISTINCT FROM p.user_id THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF f.end_at IS NULL OR NOT p.open THEN
    RETURN QUERY SELECT 'TRAFFIC_TRIP_NOT_ENDED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF f.deadline_at IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_WINDOW_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF f.fee_bps IS NULL OR f.fee_bps > 10000 THEN
    RETURN QUERY SELECT 'TRAFFIC_FEE_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  -- délai du voyageur et plafond du pays (0181) ; absents : aucune refacturation
  SELECT * INTO g FROM core.claim_traffic_guest_terms(f.country_code);
  IF g.response_hours IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_RESPONSE_WINDOW_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF g.cap_minor IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_CAP_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  -- pièces de la série verrouillées ; heure de la base lue APRÈS les verrous
  PERFORM 1 FROM core.trip_ops_inspection AS i
   WHERE i.trip_id = p.trip_id AND i.kind = 'TRAFFIC' AND i.performer_role = 'HOST'
   FOR UPDATE;
  v_now := platform.now();
  IF v_now > f.deadline_at THEN
    RETURN QUERY SELECT 'TRAFFIC_CHARGE_DEADLINE_PASSED'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                                      'tripEndAt', pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    RETURN;
  END IF;
  IF p_occurred_at < f.start_at OR p_occurred_at > f.end_at OR p_occurred_at > v_now
     OR f.start_at >= f.end_at THEN
    RETURN QUERY SELECT 'TRAFFIC_OUTSIDE_TRIP'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('tripStartAt', pg_catalog.to_char(f.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                                      'tripEndAt', pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    RETURN;
  END IF;
  IF p_amount_minor > g.cap_minor THEN
    RETURN QUERY SELECT 'TRAFFIC_AMOUNT_ABOVE_CAP'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('capMinor', g.cap_minor::text,
                                                      'currency', f.currency);
    RETURN;
  END IF;
  -- une refacturation par référence et par trip (F-L3-SIN-01), quelles que soient la nature,
  -- l'heure, le montant et la photo
  SELECT x.id INTO v_dup FROM core.claim_traffic_charge AS x
   WHERE x.trip_id = p.trip_id AND x.reference_key = v_key;
  IF v_dup IS NOT NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_DUPLICATE'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('chargeId', v_dup);
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1
                   FROM core.trip_ops_inspection_photo AS ph
                   JOIN core.trip_ops_inspection AS i ON i.id = ph.inspection_id
                  WHERE ph.file_id = p_file_id AND i.trip_id = p.trip_id AND i.kind = 'TRAFFIC'
                    AND i.performer_role = 'HOST' AND i.performed_by = p.user_id)
         AND NOT EXISTS (SELECT 1 FROM core.claim_traffic_charge AS x WHERE x.file_id = p_file_id)
    INTO v_ok;
  IF NOT v_ok THEN
    RETURN QUERY SELECT 'TRAFFIC_EVIDENCE_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  v_legs := core.claim_traffic_charge_legs(p_amount_minor, f.fee_bps);
  v_due := v_now + pg_catalog.make_interval(hours => g.response_hours);
  IF p_preview THEN
    RETURN QUERY SELECT 'PREVIEW'::text, NULL::uuid, pg_catalog.jsonb_build_object(
      'amountMinor', p_amount_minor::text, 'adminFeeMinor', v_legs[4]::text,
      'totalMinor', (v_legs[1] + v_legs[4])::text, 'currency', f.currency, 'feeBps', f.fee_bps,
      'reference', v_ref, 'responseHours', g.response_hours, 'capMinor', g.cap_minor::text,
      'deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'legs', pg_catalog.jsonb_build_object('HOST', v_legs[1]::text, 'INSURER', v_legs[2]::text,
                                            'TAX_THIRD_PARTY', v_legs[3]::text,
                                            'PLATFORM', v_legs[4]::text));
    RETURN;
  END IF;
  SELECT t.guest_user_id INTO v_guest FROM core.booking_trip AS t WHERE t.id = p.trip_id;
  v_id := pg_catalog.gen_random_uuid();
  INSERT INTO core.claim_traffic_charge
         (id, trip_id, country_code, currency, org_id, declared_by, kind, occurred_at, file_id,
          amount_minor, fee_bps, admin_fee_minor, total_minor, leg_host_minor, leg_insurer_minor,
          leg_tax_third_party_minor, leg_platform_minor, trip_start_at, trip_end_at, deadline_at,
          request_id, declared_at, next_check_at, rules_version, guest_user_id, reference,
          response_hours, response_due_at, cap_minor, guest_status)
  VALUES (v_id, p.trip_id, f.country_code, f.currency, f.org_id, p.user_id, p_kind, p_occurred_at,
          p_file_id, p_amount_minor, f.fee_bps, v_legs[4], v_legs[1] + v_legs[4], v_legs[1],
          v_legs[2], v_legs[3], v_legs[4], f.start_at, f.end_at, f.deadline_at, p_request_id,
          v_now, v_due, 2, v_guest, v_ref, g.response_hours, v_due, g.cap_minor,
          'AWAITING_GUEST');
  -- avis au voyageur, dans la transaction de la déclaration (US-706 : EVT_INVOICE_TO_GUEST)
  IF NOT core.claim_traffic_notify_guest(v_id) THEN
    RAISE EXCEPTION 'refacturation : avis au voyageur impossible'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  RETURN QUERY SELECT 'DECLARED'::text, v_id, pg_catalog.jsonb_build_object(
    'amountMinor', p_amount_minor::text, 'adminFeeMinor', v_legs[4]::text,
    'totalMinor', (v_legs[1] + v_legs[4])::text,
    'deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'responseDueAt', pg_catalog.to_char(v_due AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'legs', pg_catalog.jsonb_build_object('HOST', v_legs[1]::text, 'INSURER', v_legs[2]::text,
                                          'TAX_THIRD_PARTY', v_legs[3]::text,
                                          'PLATFORM', v_legs[4]::text));
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text, timestamptz,
  bigint, uuid, boolean, text) IS
  'Amende, péage ou fourrière déclarés par le titulaire du compte d''hôte de la session : pièce de '
  'sa série TRAFFIC, référence unique par trip, montant sous le plafond du pays, dans le délai du '
  'pays (08 BR-TT-02) ; jambes explicites ; voyageur avisé, délai de réponse figé. SECURITY '
  'DEFINER, EXECUTE app_api. US-318 (ADR-198, ADR-201).';

-- 3.2 Signature de 0178 (sans référence), gardée pour la version N de l'API : même contrôle de la
-- session, puis TRAFFIC_REFERENCE_REQUIRED (jamais une refacturation sans référence)
CREATE OR REPLACE FUNCTION core.claim_cmd_declare_traffic_charge(p_token_hash bytea,
                                                                 p_request_id uuid,
                                                                 p_trip_id uuid, p_kind text,
                                                                 p_occurred_at timestamptz,
                                                                 p_amount_minor bigint,
                                                                 p_file_id uuid,
                                                                 p_preview boolean)
  RETURNS TABLE (outcome text, charge_id uuid, body jsonb)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.outcome, d.charge_id, d.body
    FROM core.claim_cmd_declare_traffic_charge(p_token_hash, p_request_id, p_trip_id, p_kind,
                                               p_occurred_at, p_amount_minor, p_file_id,
                                               p_preview, NULL::text) AS d
$fn$;
COMMENT ON FUNCTION core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text, timestamptz,
  bigint, uuid, boolean) IS
  'Signature de 0178 sans référence : rend TRAFFIC_REFERENCE_REQUIRED (ou NOT_FOUND), n''écrit '
  'jamais (F-L3-SIN-01). SECURITY DEFINER, EXECUTE app_api. US-318 (ADR-198, ADR-201).';

-- 3.3 Sinistres du trip vus par son titulaire (0178 2.7, même signature, corps recopié, élargi :
-- délai du voyageur et plafond du pays, référence, réponse du voyageur et décision par refacturation)
CREATE OR REPLACE FUNCTION core.claim_host_trip_claims(p_token_hash bytea, p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p   record;
  f   record;
  g   record;
  v_t jsonb;
BEGIN
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, 'TRAFFIC');
  IF p.user_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO f FROM core.claim_traffic_facts(p.trip_id);
  IF f.trip_id IS NULL OR f.holder_user_id IS DISTINCT FROM p.user_id THEN
    RETURN NULL;
  END IF;
  SELECT * INTO g FROM core.claim_traffic_guest_terms(f.country_code);
  SELECT pg_catalog.jsonb_build_object('status', x.status, 'openedAt', pg_catalog.to_char(x.opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                       'closedAt', pg_catalog.to_char(x.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'insurerStatus', x.insurer_status)
    INTO v_t
    FROM core.claim_theft_case AS x WHERE x.trip_id = p.trip_id;
  RETURN pg_catalog.jsonb_build_object(
    'tripId', p.trip_id, 'country', f.country_code, 'currency', f.currency,
    'open', p.open AND f.end_at IS NOT NULL AND f.deadline_at IS NOT NULL
            AND f.fee_bps IS NOT NULL AND g.response_hours IS NOT NULL AND g.cap_minor IS NOT NULL
            AND platform.now() <= f.deadline_at,
    'tripStartAt', pg_catalog.to_char(f.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'tripEndAt', pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'feeBps', f.fee_bps, 'responseHours', g.response_hours, 'capMinor', g.cap_minor::text,
    'theft', v_t,
    'charges', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', x.id, 'kind', x.kind, 'occurredAt', pg_catalog.to_char(x.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'reference', x.reference,
               'amountMinor', x.amount_minor::text, 'adminFeeMinor', x.admin_fee_minor::text,
               'totalMinor', x.total_minor::text, 'declaredAt', pg_catalog.to_char(x.declared_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'responseDueAt', pg_catalog.to_char(x.response_due_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'guestStatus', x.guest_status,
               'status', x.execution_status) ORDER BY x.declared_at, x.occurred_at, x.request_id)
        FROM core.claim_traffic_charge AS x WHERE x.trip_id = p.trip_id), '[]'::jsonb),
    'evidence', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'fileId', ph.file_id, 'slot', ph.slot_code, 'receivedAt', pg_catalog.to_char(ph.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'used', EXISTS (SELECT 1 FROM core.claim_traffic_charge AS x
                                WHERE x.file_id = ph.file_id))
               ORDER BY ph.received_at, ph.slot_code)
        FROM core.trip_ops_inspection_photo AS ph
        JOIN core.trip_ops_inspection AS i ON i.id = ph.inspection_id
       WHERE i.trip_id = p.trip_id AND i.kind = 'TRAFFIC' AND i.performer_role = 'HOST'),
      '[]'::jsonb));
END
$fn$;
COMMENT ON FUNCTION core.claim_host_trip_claims(bytea, uuid) IS
  'Sinistres d''un trip vus par le titulaire du compte d''hôte de la session : délai, frais, délai '
  'du voyageur et plafond du pays, dossier de vol et déclaration à l''assureur, refacturations '
  '(référence, réponse du voyageur), pièces. Aucune donnée nominative. SECURITY DEFINER, EXECUTE '
  'app_api. US-318 (ADR-198, ADR-201).';

REVOKE ALL ON FUNCTION core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text, timestamptz,
  bigint, uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text,
  timestamptz, bigint, uuid, boolean, text) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 4. Portes du staff (iam_staff_owner, EXECUTE app_api ; mécanique d'US-706) ---------------------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Porte commune : refacturation, permission dans son pays, séparation des tâches (ADR-122). Rend
-- (refus, rôle, pays, trip) ; refus journalisé ici. Refacturation inconnue : même issue qu'une
-- permission absente (aucune existence révélée).
CREATE FUNCTION core.support_staff_traffic_gate(p_user uuid, p_traffic_charge_id uuid,
                                                p_permission text, p_attempted text,
                                                p_request_id uuid)
  RETURNS TABLE (deny text, role text, country_code text, trip_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_i    record;
  v_role text;
  v_deny text;
BEGIN
  SELECT x.id, x.trip_id, x.country_code INTO v_i
    FROM core.claim_traffic_charge AS x WHERE x.id = p_traffic_charge_id;
  IF v_i.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(p_user, p_permission, ARRAY[v_i.country_code], NULL);
  END IF;
  v_deny := CASE
    WHEN v_i.id IS NULL OR v_role IS NULL THEN 'PERMISSION'
    WHEN core.support_actor_conflict(p_user, 'TRIP', v_i.trip_id) THEN 'SELF'
    ELSE NULL END;
  IF v_deny IS NOT NULL THEN
    PERFORM core.iam_staff_audit(p_user, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 CASE WHEN v_i.id IS NULL THEN 'TRAFFIC_CHARGE' ELSE 'TRIP' END,
                                 COALESCE(v_i.trip_id, p_traffic_charge_id), NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_i.id IS NULL THEN 'SUBJECT_NOT_FOUND' ELSE v_deny END,
                                   'attempted', p_attempted, 'permission', p_permission,
                                   'traffic_charge_id', p_traffic_charge_id)
                                 || CASE WHEN v_i.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_i.country_code) END
                                 || CASE WHEN v_deny = 'SELF'
                                         THEN '{"guard": "SEPARATION_OF_DUTIES"}'::jsonb
                                         ELSE '{}'::jsonb END,
                                 NULL, p_request_id);
  END IF;
  RETURN QUERY SELECT v_deny, v_role, v_i.country_code, v_i.trip_id;
END
$fn$;
COMMENT ON FUNCTION core.support_staff_traffic_gate(uuid, uuid, text, text, uuid) IS
  'Interne (US-318 suite) : porte d''une refacturation (permission dans son pays, garde ADR-122) ; '
  'refus journalisés. Aucun EXECUTE (propriétaire seul).';
REVOKE ALL ON FUNCTION core.support_staff_traffic_gate(uuid, uuid, text, text, uuid) FROM PUBLIC;

-- 4.1 Lecture d'une refacturation (dispute.decide). Issues : OK, AUTH_REQUIRED, MFA_REQUIRED,
-- FORBIDDEN (inconnue ou permission absente dans son pays), SELF_FORBIDDEN.
CREATE FUNCTION core.support_staff_traffic_charge(p_token_hash bytea, p_request_id uuid,
                                                  p_traffic_charge_id uuid)
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
  IF p_request_id IS NULL OR p_traffic_charge_id IS NULL THEN
    RAISE EXCEPTION 'refacturation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
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
  SELECT * INTO g FROM core.support_staff_traffic_gate(v_s.user_id, p_traffic_charge_id,
                                                       'dispute.decide', 'TRAFFIC_READ',
                                                       p_request_id);
  IF g.deny IS NOT NULL THEN
    RETURN QUERY SELECT CASE g.deny WHEN 'SELF' THEN 'SELF_FORBIDDEN' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, core.claim_traffic_staff_view(p_traffic_charge_id);
END
$fn$;
COMMENT ON FUNCTION core.support_staff_traffic_charge(bytea, uuid, uuid) IS
  'Console : vue d''une refacturation ; session élevée, dispute.decide dans le pays, garde ADR-122. '
  'EXECUTE app_api. US-318 suite (ADR-201).';

-- 4.2 Décision sur une refacturation contestée (dispute.decide). Issues : celles de la porte, puis
-- celles de core.claim_cmd_decide_traffic_charge. Décision et refus journalisés.
CREATE FUNCTION core.support_staff_decide_traffic_charge(p_token_hash bytea, p_request_id uuid,
                                                         p_traffic_charge_id uuid, p_outcome text,
                                                         p_rationale text)
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
  v_r text;
BEGIN
  IF p_request_id IS NULL OR p_traffic_charge_id IS NULL THEN
    RAISE EXCEPTION 'refacturation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'TRAFFIC_CHARGE',
                                 p_traffic_charge_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DECIDE_TRAFFIC',
                                   'permission', 'dispute.decide'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO g FROM core.support_staff_traffic_gate(v_s.user_id, p_traffic_charge_id,
                                                       'dispute.decide', 'DECIDE_TRAFFIC',
                                                       p_request_id);
  IF g.deny IS NOT NULL THEN
    RETURN QUERY SELECT CASE g.deny WHEN 'SELF' THEN 'SELF_FORBIDDEN' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  v_r := core.claim_cmd_decide_traffic_charge(p_traffic_charge_id, v_s.user_id, g.role,
                                              p_request_id, p_outcome, p_rationale);
  IF v_r = 'DECIDED' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, g.role, 'TRAFFIC_DECISION_ISSUED', 'TRIP',
                                 g.trip_id, NULL,
                                 pg_catalog.jsonb_build_object('country', g.country_code,
                                   'traffic_charge_id', p_traffic_charge_id,
                                   'outcome', p_outcome),
                                 NULL, p_request_id);
  ELSIF v_r <> 'ALREADY_DECIDED' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, g.role, 'TRAFFIC_DECISION_REFUSED', 'TRIP',
                                 g.trip_id, NULL,
                                 pg_catalog.jsonb_build_object('country', g.country_code,
                                   'traffic_charge_id', p_traffic_charge_id, 'code', v_r),
                                 NULL, p_request_id);
  END IF;
  RETURN QUERY SELECT v_r,
                      CASE WHEN v_r IN ('DECIDED', 'ALREADY_DECIDED')
                           THEN core.claim_traffic_staff_view(p_traffic_charge_id) END;
END
$fn$;
COMMENT ON FUNCTION core.support_staff_decide_traffic_charge(bytea, uuid, uuid, text, text) IS
  'Console (DECIDE_TRAFFIC) : décision motivée sur une refacturation contestée ; session élevée, '
  'dispute.decide dans le pays, garde ADR-122, débit réservé à ADMIN ; décision et refus '
  'journalisés. EXECUTE app_api. US-318 suite (ADR-201).';

-- 4.3 Refacturations contestées à décider (liste « à revoir » de la console) : pays où l'agent
-- détient dispute.decide, trips qui le concernent écartés AVANT la limite (ADR-122), 500 au plus
-- (troncature signalée). Issues : OK, AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN (aucun pays).
CREATE FUNCTION core.support_staff_traffic_review(p_token_hash bytea, p_request_id uuid)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s         record;
  v_countries text[];
  v_ids       uuid[];
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'refacturations à revoir : entrée invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER', v_s.user_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'READ', 'permission', 'dispute.decide',
                                   'field_or_file', 'traffic_review'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT pg_catalog.array_agg(cc.code::text ORDER BY cc.code) INTO v_countries
    FROM core.config_country AS cc
   WHERE core.iam_staff_permitted(v_s.user_id, 'dispute.decide', ARRAY[cc.code::text], NULL)
         IS NOT NULL;
  IF v_countries IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER', v_s.user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION',
                                   'attempted', 'READ', 'permission', 'dispute.decide',
                                   'field_or_file', 'traffic_review'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT pg_catalog.array_agg(k.id ORDER BY k.disputed_at, k.id) INTO v_ids
    FROM (SELECT x.id, x.disputed_at
            FROM core.claim_traffic_charge AS x
           WHERE x.guest_status = 'DISPUTED' AND x.rules_version = 2
             AND x.execution_status = 'PENDING' AND x.country_code = ANY (v_countries)
             AND NOT core.support_actor_conflict(v_s.user_id, 'TRIP', x.trip_id)
           ORDER BY x.disputed_at, x.id
           LIMIT 501) AS k;
  RETURN QUERY SELECT 'OK'::text,
                      pg_catalog.jsonb_build_object(
                        'countries', pg_catalog.to_jsonb(v_countries),
                        'truncated', COALESCE(pg_catalog.cardinality(v_ids), 0) > 500,
                        'charges', core.claim_traffic_review_list(
                                     COALESCE(v_ids[1:500], '{}'::uuid[])));
END
$fn$;
COMMENT ON FUNCTION core.support_staff_traffic_review(bytea, uuid) IS
  'Console : refacturations contestées à décider des pays où l''agent détient dispute.decide ; '
  'trips qui le concernent écartés (ADR-122) ; refus journalisés ; aucune donnée nominative. '
  'EXECUTE app_api. US-318 suite (ADR-201).';

REVOKE ALL ON FUNCTION core.support_staff_traffic_charge(bytea, uuid, uuid),
  core.support_staff_decide_traffic_charge(bytea, uuid, uuid, text, text),
  core.support_staff_traffic_review(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_traffic_charge(bytea, uuid, uuid),
  core.support_staff_decide_traffic_charge(bytea, uuid, uuid, text, text),
  core.support_staff_traffic_review(bytea, uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
