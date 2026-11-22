-- 0177 — CLM : frais annexes demandés par l'hôte (facture SM-5), délai de réponse du voyageur
-- (payer ou contester avec preuves), décision de l'ops après contestation et débit par Kmino
-- (débit MIT `DELAYED_CHARGES` séparé d'US-703, montant explicite de chaque jambe, jamais la
-- caution).
-- US-706 ; 19 US-706 (critères 1 et 2) ; 16 CLM-021 (`GUEST_RESPONSE_WINDOW_OPEN`,
-- `CLAIM_EVIDENCE_MISSING`), ADM-008 ; 08 BR-REIMB-01, BR-REIMB-02 (`invoice_guest_response_h`,
-- 72 h), BR-REIMB-03, BR-REIMB-05, BR-PAY-06 (« Jambes des frais annexes »), BR-PROT-08,
-- BR-FUEL-01 à 03, BR-RETURN-05, REQ-PAY-DMG-09 / 10, SM-5, vecteur T69 ; 19 US-315 critère 5
-- (repris) ; ADR-122 / ADR-177 (séparation des tâches), ADR-189 (débits post-trip, « Pour US-309 /
-- US-706 »), ADR-195 (décisions motivées), ADR-197 (cette migration, PROPOSÉ).
-- Pré-mortem du lot 3 : L3-PM-24, 25, 26, 28 ; red team RT-L3-S01, S02, M04, H09.
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-197, PROPOSÉS, fail-closed, comme Turo adapté au PA / PY) :
--   1. Liste fermée (BR-REIMB-01, BR-PAY-06) : la demande de l'hôte porte un type de la liste ;
--      cette story traite FUEL, CLEANING et SMOKING (part de l'hôte 100 %, BR-PROT-08) ; les autres
--      types de la liste sont traités ailleurs (retard : US-305, calculé par la plateforme ;
--      péages et amendes : US-318 ; kilométrage et recharge : suite, part du plan et gabarit de
--      photos) et refusés ici (`INCIDENTAL_TYPE_NOT_SUPPORTED`) ; tout autre type : refus
--      `INCIDENTAL_TYPE_NOT_ALLOWED`. Aucune écriture.
--   2. Pièces (16 CLM-021 « demande sans preuve ⇒ refusée avant notification », RT-L3-S01 / S02) :
--      chaque pièce est une photo d'une série de départ ou de retour du trip (US-303 / US-315),
--      reçue par le serveur (heure serveur), jamais un fichier quelconque ; aucune pièce, pièce
--      inconnue ou d'un autre trip ⇒ `CLAIM_EVIDENCE_MISSING`. Carburant : jauge au départ ET au
--      retour (BR-FUEL-01) et niveau de retour inférieur au départ, lu dans les validations de la
--      remise et du retour des DEUX parties, au plus favorable au voyageur ; nettoyage et tabac :
--      photo de l'intérieur au retour (un véhicule seulement non lavé mais rangé n'est pas
--      facturable, BR-RETURN-05 ⇒ `INCIDENTAL_NOT_BILLABLE`).
--   3. Contrôles plus stricts que Turo en paramètres du pays (DEC-FONDATEUR-22 ; revue architecture
--      n° 2) : `incidental_evidence_trip_photos_only` (vrai, PROPOSÉ : fraude évidente ; faux :
--      fichiers déposés par l'hôte admis aussi) ; `incidental_fuel_extras_block` (faux : vrai ⇒
--      carburant refusé si un Extra est vendu au devis, BR-FUEL-02, `INCIDENTAL_FUEL_PREPAID`) ;
--      `incidental_fuel_early_end_block` (faux : vrai ⇒ carburant refusé après une fin anticipée,
--      BR-FUEL-03). Absents ⇒ `PARAM_MISSING`. Une demande rejetée par l'ops n'est jamais redemandée
--      (doublon hors annulation de l'hôte). La demande émet `invoice.status_changed` (outbox) :
--      NTF avise le voyageur (`EVT_INVOICE_TO_GUEST`, 16 CLM-021).
--   4. Montant : saisi par l'hôte, plafonné par paramètre du pays (carburant : `fuel_refill_max`,
--      0009, à fixer ; nettoyage et tabac : `incidental_cleaning_max_minor`) ; plafond absent ou
--      illisible ⇒ `PARAM_MISSING` (aucune demande). Jambes figées à la demande (BR-PROT-08,
--      « Jambes des frais annexes ») : HOST = montant, INSURER = TAX_THIRD_PARTY = PLATFORM = 0
--      (vecteur T69 de 08 : carburant 12,00 ⇒ HOST 12,00, PLATFORM 0,00) ; aucun frais de gestion
--      (BR-PRICE-15 [NOUS] : paramètre non défini, suite).
--   5. Délais à l'heure de la base (`platform.now()`, jamais l'heure du client) : demande au plus
--      tard à fin effective + `incidental_host_window_h` (BR-REIMB-01 R09 ; au-delà :
--      `INCIDENTAL_WINDOW_CLOSED`, EXPIRED_WINDOW de SM-5) ; notification à la demande (heure
--      serveur, `notified_at`) ; réponse du voyageur jusqu'à `response_due_at` = `notified_at` +
--      `invoice_guest_response_h` (clé de 08, L3-PM-26 ; 72 h) EXCLU ; paramètre absent ⇒
--      `PARAM_MISSING`. Une demande vivante par (trip, type) (doublon, BR-REIMB-05).
--   6. Réponse du voyageur (SM-5 AWAITING_GUEST) : payer (`ACCEPTED`, accord écrit postérieur à la
--      demande, REQ-PAY-DMG-05) ou contester avec un motif écrit et au moins une photo du trip
--      (`DISPUTED`, BR-REIMB-03) ; à `response_due_at` ou après : `GUEST_RESPONSE_WINDOW_CLOSED`
--      (la fenêtre ne se rouvre jamais, BR-REIMB-02). L'hôte peut annuler tant qu'aucune décision
--      ni aucun débit n'existe (`CANCELLED_BY_HOST`).
--   7. Décision de l'ops après contestation (US-309, ADR-195 ; `dispute.decide`) : motif écrit
--      (20 à 2 000 caractères, jamais « définitif », OQ-BR-24), débiter (`DECIDED_CHARGE`,
--      réservé à ADMIN comme toute décision qui débite le voyageur, ADR-195) ou rejeter
--      (`REJECTED`) ; garde de séparation des tâches d'ADR-122 / ADR-177 (L3-PM-28, RT-L3-H09).
--   8. Débit par Kmino (travailleur `payment_command`), jamais par l'hôte, sous le verrou du trip
--      puis de la demande : payé par le voyageur, décision de débit de l'ops, ou silence du
--      voyageur relu à l'heure de la base APRÈS `response_due_at` ; une demande contestée n'est
--      jamais débitée avant la décision (`INCIDENTAL_DISPUTED`) ; avant l'échéance, aucun débit
--      (`GUEST_RESPONSE_WINDOW_OPEN`). Débit séparé d'US-703 : `payment_cmd_notify_post_trip_charge`
--      (but INCIDENTAL, motif DELAYED_CHARGES, origine `INCIDENTAL_INVOICE`, montant explicite de
--      chaque jambe, moyen = opération de carte du loyer prouvée), puis les règles des réseaux
--      d'US-703 (préavis, accord écrit, délai, relances, dette). Jamais la caution (aucune
--      opération DEPOSIT_*, L3-PM-24). La contrainte `claim_incidental_charge_after_window` prouve
--      en base qu'un débit sans réponse n'existe jamais avant l'échéance.
--   9. Écritures par commandes seulement ; RLS ENABLE + FORCE ; aucun droit applicatif sur la
--      table ; aucune constante de pays (hors du bloc généré des paramètres) ; aucun interrupteur
--      écrit.
--
-- Codes (packages/db/src/errors.ts) : claim_incidental_forbidden (42501) → FORBIDDEN ;
-- claim_incidental_immutable (23000) → IMMUTABLE_RECORD.
--
-- Expand / contract : table, fonctions et politiques AJOUTÉES ; aucune colonne ni fonction
-- existante modifiée. La version N de l'API n'appelle pas les nouvelles fonctions.
--
-- Retour arrière (jamais en production : nouvelle migration) :
--   DROP FUNCTION core.support_staff_incidental(bytea, uuid, uuid),
--     core.support_staff_decide_incidental(bytea, uuid, uuid, text, text),
--     core.support_staff_incidental_gate(uuid, uuid, text, text, uuid),
--     core.claim_incidental_view(bytea, uuid), core.claim_cmd_submit_incidental(bytea, uuid, uuid,
--     text, bigint, text, uuid[]), core.claim_cmd_cancel_incidental(bytea, uuid),
--     core.claim_cmd_accept_incidental(bytea, uuid), core.claim_cmd_dispute_incidental(bytea, uuid,
--     text, uuid[]), core.claim_cmd_decide_incidental(uuid, uuid, text, uuid, text, text),
--     core.claim_incidental_staff_view(uuid), core.claim_incidental_invoices_due(integer),
--     core.claim_cmd_charge_incidental(uuid, uuid), core.claim_cmd_defer_incidental(uuid, text),
--     core.claim_incidental_param(text, text), core.claim_incidental_bool(text, text),
--     core.claim_incidental_party(bytea, uuid), core.claim_incidental_host_files(uuid, uuid),
--     core.claim_incidental_trip_facts(uuid), core.claim_incidental_trip_photos(uuid),
--     core.claim_incidental_guard() ;
--   DROP POLICY cmd_money_incidental_param_read ON core.config_param_value ;
--   DROP POLICY cmd_money_incidental_event ON core.outbox_outbox_event ; révoquer les droits
--     d'insertion d'outbox et d'EXECUTE platform.uuid_v7() de cmd_money_owner, et les colonnes de
--     core.audit_file_asset accordées à cmd_hold_owner ;
--   DROP TABLE core.claim_incidental_invoice ;
--   REVOKE EXECUTE ON FUNCTION app.actor_id() FROM cmd_money_owner ;
--   DELETE des valeurs puis des définitions des paramètres du bloc généré (section 5).

-- 1. Table ---------------------------------------------------------------------------------------

-- 1.1 Demande de remboursement de l'hôte (SM-5 ; 16 CLM-021 « reimbursement_request » ; classe A :
-- jamais supprimée). Les états de SM-5 absents ici (DRAFT, SUBMITTED, AUTO_REJECTED,
-- EXPIRED_WINDOW) sont des refus de la commande : rien n'est écrit (validation automatique en
-- amont, BR-REIMB-05 [NOUS]). PAID, UNPAID, PAYMENT_PLAN et COLLECTIONS sont les états du débit
-- d'US-703 (`payment_post_trip_charge`, dette), relus par la vue.
CREATE TABLE core.claim_incidental_invoice (
  id                        uuid        CONSTRAINT claim_incidental_invoice_pkey PRIMARY KEY,
  trip_id                   uuid        NOT NULL,
  country_code              text        NOT NULL
    CONSTRAINT claim_incidental_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency                  text        NOT NULL
    CONSTRAINT claim_incidental_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  org_id                    uuid        NOT NULL,
  -- demandeur relu en base : titulaire du compte d'hôte du trip ; voyageur du trip
  host_user_id              uuid        NOT NULL
    CONSTRAINT claim_incidental_host_fk REFERENCES core.iam_user_account (id),
  guest_user_id             uuid        NOT NULL
    CONSTRAINT claim_incidental_guest_fk REFERENCES core.iam_user_account (id),
  request_id                uuid        NOT NULL
    CONSTRAINT claim_incidental_request_unique UNIQUE,
  fee_type                  text        NOT NULL
    CONSTRAINT claim_incidental_fee_type_valid CHECK (fee_type IN ('FUEL', 'CLEANING', 'SMOKING')),
  amount_minor              bigint      NOT NULL
    CONSTRAINT claim_incidental_amount_positive CHECK (amount_minor > 0),
  leg_host_minor            bigint      NOT NULL,
  leg_insurer_minor         bigint      NOT NULL,
  leg_tax_third_party_minor bigint      NOT NULL,
  leg_platform_minor        bigint      NOT NULL,
  -- [C2] motif écrit par l'hôte (consigne : aucun nom ni contact)
  description               text        NOT NULL
    CONSTRAINT claim_incidental_description_length
      CHECK (pg_catalog.char_length(description) BETWEEN 10 AND 500),
  -- photos des séries du trip (core.trip_ops_inspection_photo.file_id), relues à la demande
  evidence_file_ids         uuid[]      NOT NULL
    CONSTRAINT claim_incidental_evidence_shape CHECK (
      pg_catalog.cardinality(evidence_file_ids) BETWEEN 1 AND 10
      AND pg_catalog.array_position(evidence_file_ids, NULL) IS NULL),
  trip_end_at               timestamptz NOT NULL,
  host_deadline_at          timestamptz NOT NULL,
  notified_at               timestamptz NOT NULL DEFAULT platform.now(),
  response_hours            integer     NOT NULL
    CONSTRAINT claim_incidental_response_hours_range CHECK (response_hours BETWEEN 1 AND 720),
  response_due_at           timestamptz NOT NULL,
  status                    text        NOT NULL DEFAULT 'AWAITING_GUEST'
    CONSTRAINT claim_incidental_status_valid CHECK (status IN
      ('AWAITING_GUEST', 'ACCEPTED', 'DISPUTED', 'DECIDED_CHARGE', 'CHARGED', 'REJECTED',
       'CANCELLED_BY_HOST')),
  accepted_at               timestamptz,
  disputed_at               timestamptz,
  -- [C2] motif de la contestation écrit par le voyageur (consigne : aucun nom ni contact)
  dispute_reason            text
    CONSTRAINT claim_incidental_dispute_reason_length CHECK (
      dispute_reason IS NULL OR pg_catalog.char_length(dispute_reason) BETWEEN 20 AND 1000),
  dispute_evidence_file_ids uuid[]
    CONSTRAINT claim_incidental_dispute_evidence_shape CHECK (
      dispute_evidence_file_ids IS NULL
      OR (pg_catalog.cardinality(dispute_evidence_file_ids) BETWEEN 1 AND 10
          AND pg_catalog.array_position(dispute_evidence_file_ids, NULL) IS NULL)),
  decided_at                timestamptz,
  decided_by                uuid
    CONSTRAINT claim_incidental_decided_by_fk REFERENCES core.iam_user_account (id),
  decided_role              text
    CONSTRAINT claim_incidental_decided_role_valid CHECK (
      decided_role IS NULL OR decided_role IN ('OPS_AGENT', 'ADMIN')),
  decision_request_id       uuid
    CONSTRAINT claim_incidental_decision_request_unique UNIQUE,
  -- [C2] motif de la décision écrit par l'agent (consigne : aucun nom ni contact)
  decision_rationale        text
    CONSTRAINT claim_incidental_rationale_length CHECK (
      decision_rationale IS NULL OR pg_catalog.char_length(decision_rationale) BETWEEN 20 AND 2000),
  cancelled_at              timestamptz,
  charge_basis              text
    CONSTRAINT claim_incidental_charge_basis_valid CHECK (
      charge_basis IS NULL OR charge_basis IN ('GUEST_ACCEPTED', 'NO_RESPONSE', 'OPS_DECISION')),
  charge_id                 uuid
    CONSTRAINT claim_incidental_charge_fk REFERENCES core.payment_post_trip_charge (id)
    CONSTRAINT claim_incidental_charge_unique UNIQUE,
  charged_at                timestamptz,
  -- file du travailleur : prochaine relecture ; dernier code d'un report (jamais un message)
  next_check_at             timestamptz NOT NULL,
  execution_code            text
    CONSTRAINT claim_incidental_execution_code_format CHECK (
      execution_code IS NULL OR execution_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  CONSTRAINT claim_incidental_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  -- jambes figées à la demande : part de l'hôte 100 % (BR-PROT-08, T69), aucun prorata
  CONSTRAINT claim_incidental_legs_host_only CHECK (
    leg_host_minor = amount_minor AND leg_insurer_minor = 0 AND leg_tax_third_party_minor = 0
    AND leg_platform_minor = 0),
  CONSTRAINT claim_incidental_deadlines CHECK (
    host_deadline_at >= trip_end_at AND notified_at <= host_deadline_at
    AND response_due_at = notified_at + pg_catalog.make_interval(hours => response_hours)),
  -- une réponse du voyageur (payer, contester) est toujours AVANT l'échéance, jamais les deux
  CONSTRAINT claim_incidental_response_in_window CHECK (
    (accepted_at IS NULL OR (accepted_at >= notified_at AND accepted_at < response_due_at))
    AND (disputed_at IS NULL OR (disputed_at >= notified_at AND disputed_at < response_due_at))
    AND (accepted_at IS NULL OR disputed_at IS NULL)),
  CONSTRAINT claim_incidental_dispute_shape CHECK (
    (disputed_at IS NULL) = (dispute_reason IS NULL)
    AND (disputed_at IS NULL) = (dispute_evidence_file_ids IS NULL)),
  CONSTRAINT claim_incidental_decision_shape CHECK (
    (decided_at IS NULL) = (decided_by IS NULL) AND (decided_at IS NULL) = (decided_role IS NULL)
    AND (decided_at IS NULL) = (decision_request_id IS NULL)
    AND (decided_at IS NULL) = (decision_rationale IS NULL)
    AND (decided_at IS NULL OR (disputed_at IS NOT NULL AND decided_at >= disputed_at))),
  CONSTRAINT claim_incidental_status_shape CHECK (
    (status <> 'ACCEPTED' OR accepted_at IS NOT NULL)
    AND (status <> 'DISPUTED' OR (disputed_at IS NOT NULL AND decided_at IS NULL))
    AND (status NOT IN ('DECIDED_CHARGE', 'REJECTED') OR decided_at IS NOT NULL)
    AND ((status = 'CANCELLED_BY_HOST') = (cancelled_at IS NOT NULL))
    AND ((status = 'CHARGED') = (charge_id IS NOT NULL))
    AND ((status = 'CHARGED') = (charged_at IS NOT NULL))
    AND ((status = 'CHARGED') = (charge_basis IS NOT NULL))),
  -- base du débit cohérente avec la réponse ; un débit sans réponse n'existe jamais avant
  -- l'échéance (19 US-706 critère 1, L3-PM-26, RT-L3-S02) ; une décision de débit est ADMIN
  CONSTRAINT claim_incidental_charge_after_window CHECK (
    charge_basis IS NULL
    OR (charge_basis = 'GUEST_ACCEPTED' AND accepted_at IS NOT NULL AND charged_at >= accepted_at)
    OR (charge_basis = 'NO_RESPONSE' AND accepted_at IS NULL AND disputed_at IS NULL
        AND charged_at >= response_due_at)
    OR (charge_basis = 'OPS_DECISION' AND decided_at IS NOT NULL AND decided_role = 'ADMIN'
        AND charged_at >= decided_at))
);
-- une demande par (trip, type) hors annulation de l'hôte (doublon, BR-REIMB-05) : un rejet de l'ops
-- est définitif, l'hôte ne redemande pas le même frais (revue code n° 1)
CREATE UNIQUE INDEX claim_incidental_live_unique ON core.claim_incidental_invoice (trip_id, fee_type)
  WHERE (status <> 'CANCELLED_BY_HOST');
CREATE INDEX claim_incidental_trip_idx ON core.claim_incidental_invoice (trip_id);
CREATE INDEX claim_incidental_due_idx ON core.claim_incidental_invoice (next_check_at)
  WHERE (status IN ('AWAITING_GUEST', 'ACCEPTED', 'DECIDED_CHARGE'));
COMMENT ON TABLE core.claim_incidental_invoice IS
  'CLM : frais annexe demandé par l''hôte (facture SM-5, 16 CLM-021) dans la liste fermée, avec '
  'photos du trip, réponse du voyageur sous invoice_guest_response_h (payer ou contester), décision '
  'de l''ops après contestation, débit séparé par Kmino (US-703, jambes explicites, jamais la '
  'caution). Écrite par les commandes core.claim_cmd_*_incidental seulement. US-706 (ADR-197).';

-- 1.2 Garde : champs de la demande figés, transitions de SM-5 bornées, jamais de DELETE
CREATE FUNCTION core.claim_incidental_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.trip_id, NEW.country_code, NEW.currency, NEW.org_id, NEW.host_user_id,
          NEW.guest_user_id, NEW.request_id, NEW.fee_type, NEW.amount_minor, NEW.leg_host_minor,
          NEW.leg_insurer_minor, NEW.leg_tax_third_party_minor, NEW.leg_platform_minor,
          NEW.description, NEW.evidence_file_ids, NEW.trip_end_at, NEW.host_deadline_at,
          NEW.notified_at, NEW.response_hours, NEW.response_due_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.trip_id, OLD.country_code, OLD.currency, OLD.org_id, OLD.host_user_id,
          OLD.guest_user_id, OLD.request_id, OLD.fee_type, OLD.amount_minor, OLD.leg_host_minor,
          OLD.leg_insurer_minor, OLD.leg_tax_third_party_minor, OLD.leg_platform_minor,
          OLD.description, OLD.evidence_file_ids, OLD.trip_end_at, OLD.host_deadline_at,
          OLD.notified_at, OLD.response_hours, OLD.response_due_at)
     -- champs posés une fois
     AND (OLD.accepted_at IS NULL OR NEW.accepted_at IS NOT DISTINCT FROM OLD.accepted_at)
     AND (OLD.disputed_at IS NULL
          OR (NEW.disputed_at, NEW.dispute_reason, NEW.dispute_evidence_file_ids)
             IS NOT DISTINCT FROM (OLD.disputed_at, OLD.dispute_reason, OLD.dispute_evidence_file_ids))
     AND (OLD.decided_at IS NULL
          OR (NEW.decided_at, NEW.decided_by, NEW.decided_role, NEW.decision_request_id,
              NEW.decision_rationale)
             IS NOT DISTINCT FROM (OLD.decided_at, OLD.decided_by, OLD.decided_role,
                                   OLD.decision_request_id, OLD.decision_rationale))
     AND (OLD.cancelled_at IS NULL OR NEW.cancelled_at IS NOT DISTINCT FROM OLD.cancelled_at)
     AND (OLD.charge_id IS NULL
          OR (NEW.charge_id, NEW.charged_at, NEW.charge_basis)
             IS NOT DISTINCT FROM (OLD.charge_id, OLD.charged_at, OLD.charge_basis))
     -- transitions de SM-5 (le même état : report de la file seulement)
     AND (NEW.status = OLD.status
          OR (OLD.status = 'AWAITING_GUEST'
              AND NEW.status IN ('ACCEPTED', 'DISPUTED', 'CHARGED', 'CANCELLED_BY_HOST'))
          OR (OLD.status = 'ACCEPTED' AND NEW.status = 'CHARGED')
          OR (OLD.status = 'DISPUTED'
              AND NEW.status IN ('DECIDED_CHARGE', 'REJECTED', 'CANCELLED_BY_HOST'))
          OR (OLD.status = 'DECIDED_CHARGE' AND NEW.status = 'CHARGED')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'claim: % refused on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'claim_incidental_immutable';
END
$fn$;
COMMENT ON FUNCTION core.claim_incidental_guard() IS
  'Garde des frais annexes : demande figée, champs de réponse, de décision et de débit posés une '
  'fois, transitions de SM-5 seulement ; jamais de DELETE ni de TRUNCATE. US-706 (ADR-197).';
REVOKE ALL ON FUNCTION core.claim_incidental_guard() FROM PUBLIC;
CREATE TRIGGER claim_incidental_immutable BEFORE UPDATE OR DELETE ON core.claim_incidental_invoice
  FOR EACH ROW EXECUTE FUNCTION core.claim_incidental_guard();
CREATE TRIGGER claim_incidental_no_truncate BEFORE TRUNCATE ON core.claim_incidental_invoice
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_incidental_immutable');

-- 1.3 RLS : aucun droit applicatif ; commandes sous cmd_money_owner (partie de la session posée
-- par la commande, staff, travailleur payment_command) ; en-tête lu par la porte du staff
ALTER TABLE core.claim_incidental_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.claim_incidental_invoice FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.claim_incidental_invoice TO migrator USING (true)
  WITH CHECK (true);
REVOKE ALL ON core.claim_incidental_invoice FROM PUBLIC;

-- identité de la partie posée par la commande, relue par les politiques
GRANT EXECUTE ON FUNCTION app.actor_id() TO cmd_money_owner;
GRANT SELECT, INSERT ON core.claim_incidental_invoice TO cmd_money_owner;
GRANT UPDATE (status, accepted_at, disputed_at, dispute_reason, dispute_evidence_file_ids,
              decided_at, decided_by, decided_role, decision_request_id, decision_rationale,
              cancelled_at, charge_basis, charge_id, charged_at, next_check_at, execution_code)
  ON core.claim_incidental_invoice TO cmd_money_owner;
CREATE POLICY cmd_money_incidental_sel ON core.claim_incidental_invoice FOR SELECT
  TO cmd_money_owner USING (true);
-- demande : le titulaire du compte d'hôte, contexte posé par la commande
CREATE POLICY cmd_money_incidental_ins ON core.claim_incidental_invoice FOR INSERT
  TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'HOST' AND host_user_id = app.actor_id()
              AND status = 'AWAITING_GUEST');
-- réponse du voyageur, annulation par l'hôte, décision du staff, débit et report du travailleur
CREATE POLICY cmd_money_incidental_upd ON core.claim_incidental_invoice FOR UPDATE
  TO cmd_money_owner
  USING ((app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id())
         OR (app.actor_kind() = 'HOST' AND host_user_id = app.actor_id())
         OR app.actor_kind() = 'STAFF'
         OR (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'))
  WITH CHECK ((app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id()
               AND status IN ('ACCEPTED', 'DISPUTED'))
              OR (app.actor_kind() = 'HOST' AND host_user_id = app.actor_id()
                  AND status = 'CANCELLED_BY_HOST')
              OR (app.actor_kind() = 'STAFF' AND status IN ('DECIDED_CHARGE', 'REJECTED'))
              OR (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
                  AND status IN ('AWAITING_GUEST', 'ACCEPTED', 'DECIDED_CHARGE', 'CHARGED')));

-- en-tête (pays, trip, état) pour la porte du staff ; jamais les textes
GRANT SELECT (id, trip_id, country_code, status) ON core.claim_incidental_invoice
  TO iam_staff_owner;
CREATE POLICY iam_staff_incidental_sel ON core.claim_incidental_invoice FOR SELECT
  TO iam_staff_owner USING (true);

-- 2. Faits du trip (cmd_hold_owner) --------------------------------------------------------------
GRANT SELECT (id, country_code, currency, org_id, guest_user_id, status, scheduled_start, scheduled_end,
              timezone, source_hold_id)
  ON core.booking_trip TO cmd_hold_owner;

-- fichiers déposés par l'hôte (2.3) : déposant, suppression, réception, source
GRANT SELECT (uploader_user_id, deleted_at, server_received_at, source)
  ON core.audit_file_asset TO cmd_hold_owner;
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 2.1 Faits du trip pour une demande : parties, fin effective (première transition RETURNED, 08
-- BR-REIMB-01 « end_effective » ; NULL : trip non rendu), fin anticipée (transition
-- TERMINATED_EARLY), niveaux de carburant des validations de la remise (CHECKIN) et du retour
-- (CHECKOUT) des deux parties, au plus favorable au voyageur (départ : le plus BAS ; retour : le
-- plus HAUT ; NULL si un côté manque), Extra vendu au devis du trip (BR-FUEL-02). Trip inconnu :
-- aucune ligne. SECURITY DEFINER, EXECUTE cmd_money_owner.
CREATE FUNCTION core.claim_incidental_trip_facts(p_trip_id uuid)
  RETURNS TABLE (trip_id uuid, country_code text, currency text, org_id uuid, guest_user_id uuid,
                 holder_user_id uuid, status text, timezone text, start_at timestamptz,
                 end_at timestamptz,
                 terminated_early boolean, fuel_out smallint, fuel_in smallint,
                 extras_sold boolean)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t       record;
  v_end   timestamptz;
  v_early boolean;
  v_out   smallint;
  v_in    smallint;
  v_n_out integer;
  v_n_in  integer;
  v_extra boolean;
BEGIN
  SELECT x.id, x.country_code, x.currency, x.org_id, x.guest_user_id, x.status, x.timezone,
         x.scheduled_start, x.source_hold_id, o.holder_user_id
    INTO t
    FROM core.booking_trip AS x
    LEFT JOIN core.iam_organization AS o ON o.id = x.org_id
   WHERE x.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_catalog.min(l.at) INTO v_end
    FROM core.booking_trip_state_log AS l
   WHERE l.trip_id = t.id AND l.to_status = 'RETURNED' AND l.kind = 'TRANSITION';
  v_early := EXISTS (SELECT 1 FROM core.booking_trip_state_log AS l
                      WHERE l.trip_id = t.id AND l.to_status = 'TERMINATED_EARLY')
             OR t.status = 'TERMINATED_EARLY';
  SELECT pg_catalog.min(v.fuel_eighths), pg_catalog.count(*) INTO v_out, v_n_out
    FROM core.trip_ops_handover_validation AS v
   WHERE v.trip_id = t.id AND v.kind = 'CHECKIN';
  SELECT pg_catalog.max(v.fuel_eighths), pg_catalog.count(*) INTO v_in, v_n_in
    FROM core.trip_ops_handover_validation AS v
   WHERE v.trip_id = t.id AND v.kind = 'CHECKOUT';
  -- Extra vendu : une ligne EXTRAS au devis du hold d'origine ; sans devis, aucun Extra n'a pu
  -- être vendu (les Extras ne se vendent que par une ligne du devis)
  v_extra := t.source_hold_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM core.booking_checkout_hold AS h
                           JOIN core.pricing_quote_line AS q ON q.quote_id = h.quote_id
                          WHERE h.id = t.source_hold_id AND q.line_type = 'EXTRAS');
  RETURN QUERY
  SELECT t.id, t.country_code, t.currency, t.org_id, t.guest_user_id, t.holder_user_id, t.status,
         t.timezone, t.scheduled_start, v_end, v_early,
         CASE WHEN v_n_out > 0 THEN v_out END, CASE WHEN v_n_in > 0 THEN v_in END, v_extra;
END
$fn$;
COMMENT ON FUNCTION core.claim_incidental_trip_facts(uuid) IS
  'Interne (US-706, ADR-197) : parties du trip, fin effective, fin anticipée, niveaux de carburant '
  'au départ et au retour au plus favorable au voyageur, Extra vendu au devis. Aucune donnée '
  'nominative. EXECUTE cmd_money_owner.';
REVOKE ALL ON FUNCTION core.claim_incidental_trip_facts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_incidental_trip_facts(uuid) TO cmd_money_owner;

-- 2.2 Photos des séries du trip (pièces possibles) : fichier, côté (départ, retour), emplacement,
-- groupe, auteur, heure serveur de réception. Seules les séries SUBMITTED comptent.
CREATE FUNCTION core.claim_incidental_trip_photos(p_trip_id uuid)
  RETURNS TABLE (file_id uuid, kind text, slot_code text, slot_group text, taken_by_role text,
                 received_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p.file_id, i.kind, p.slot_code, s.slot_group, p.taken_by_role, p.received_at
    FROM core.trip_ops_inspection AS i
    JOIN core.trip_ops_inspection_photo AS p ON p.inspection_id = i.id
    JOIN core.trip_ops_photo_slot AS s
      ON s.template_version = i.template_version AND s.slot_code = p.slot_code
   WHERE i.trip_id = p_trip_id AND i.status = 'SUBMITTED'
   ORDER BY i.kind, s.position, p.taken_by_role, p.received_at, p.file_id
$fn$;
COMMENT ON FUNCTION core.claim_incidental_trip_photos(uuid) IS
  'Interne (US-706, ADR-197) : photos des séries SUBMITTED du trip (départ, retour), avec leur '
  'emplacement, leur groupe et l''heure serveur de réception. EXECUTE cmd_money_owner.';
REVOKE ALL ON FUNCTION core.claim_incidental_trip_photos(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_incidental_trip_photos(uuid) TO cmd_money_owner;

-- 2.3 Fichiers du seau des preuves déposés par l'hôte depuis le début prévu du trip (pièces admises
-- quand `incidental_evidence_trip_photos_only[pays]` vaut faux, DEC-FONDATEUR-22). Lecture au plus
-- juste (politique cmd_hold_evidence_file_sel de 0164 : seau PRIVATE_EVIDENCE seulement).
CREATE FUNCTION core.claim_incidental_host_files(p_trip_id uuid, p_user uuid)
  RETURNS TABLE (file_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT f.id
    FROM core.audit_file_asset AS f
    JOIN core.booking_trip AS t ON t.id = p_trip_id
   WHERE f.bucket = 'PRIVATE_EVIDENCE' AND f.uploader_user_id = p_user AND f.deleted_at IS NULL
     AND f.source IN ('IN_APP_CAMERA', 'HOST_UPLOAD') AND f.server_received_at >= t.scheduled_start
$fn$;
COMMENT ON FUNCTION core.claim_incidental_host_files(uuid, uuid) IS
  'Interne (US-706, ADR-197) : fichiers du seau des preuves déposés par l''hôte depuis le début '
  'prévu du trip (pièces hors photos du trip, selon le paramètre du pays). EXECUTE cmd_money_owner.';
REVOKE ALL ON FUNCTION core.claim_incidental_host_files(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_incidental_host_files(uuid, uuid) TO cmd_money_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 3. Commandes (cmd_money_owner) -----------------------------------------------------------------
-- paramètres lus au plus juste (délai de l'hôte, délai du voyageur, plafonds)
CREATE POLICY cmd_money_incidental_param_read ON core.config_param_value FOR SELECT
  TO cmd_money_owner
  USING (key IN ('incidental_host_window_h', 'invoice_guest_response_h',
                 'incidental_cleaning_max_minor', 'fuel_refill_max',
                 'incidental_evidence_trip_photos_only', 'incidental_fuel_extras_block',
                 'incidental_fuel_early_end_block'));
-- avis au voyageur (NTF, 16 CLM-021 `EVT_INVOICE_TO_GUEST`) : invoice.status_changed seulement,
-- agrégat incidental_invoice, acteur HOST (le titulaire de la session)
GRANT INSERT (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, payload, partition_key)
  ON core.outbox_outbox_event TO cmd_money_owner;
GRANT EXECUTE ON FUNCTION platform.uuid_v7() TO cmd_money_owner;
CREATE POLICY cmd_money_incidental_event ON core.outbox_outbox_event FOR INSERT
  TO cmd_money_owner
  WITH CHECK (type = 'invoice.status_changed' AND aggregate_type = 'incidental_invoice'
              AND actor_role = 'HOST' AND actor_user_id IS NOT NULL);
-- moyen débité : opération de carte du loyer (lecture de 0175, rappelée)
GRANT SELECT (id, trip_id, hold_id, kind, method, purpose, status, currency, created_at)
  ON core.payment_payment_operation TO cmd_money_owner;
GRANT SELECT (source_hold_id) ON core.booking_trip TO cmd_money_owner;

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 3.1 Paramètre du pays en vigueur maintenant (jsonb ; NULL : absent). SECURITY INVOKER, interne.
CREATE FUNCTION core.claim_incidental_param(p_key text, p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH n AS (SELECT platform.now() AS ts)
  SELECT v.value
    FROM core.config_param_value AS v, n
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= n.ts AND (v.valid_to IS NULL OR v.valid_to > n.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;
COMMENT ON FUNCTION core.claim_incidental_param(text, text) IS
  'Interne (US-706) : valeur en vigueur d''un paramètre du pays lu par les frais annexes.';
REVOKE ALL ON FUNCTION core.claim_incidental_param(text, text) FROM PUBLIC;

-- Paramètre booléen du pays en vigueur (NULL : absent ou illisible, l'appelant refuse).
CREATE FUNCTION core.claim_incidental_bool(p_key text, p_country text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v) = 'boolean' THEN (v #>> '{}')::boolean END
    FROM (SELECT core.claim_incidental_param(p_key, p_country) AS v) AS x
$fn$;
COMMENT ON FUNCTION core.claim_incidental_bool(text, text) IS
  'Interne (US-706) : paramètre booléen du pays lu par les frais annexes ; NULL si absent.';
REVOKE ALL ON FUNCTION core.claim_incidental_bool(text, text) FROM PUBLIC;

-- 3.2 Partie de la session sur un trip : GUEST (voyageur) ou HOST (titulaire du compte d'hôte) ;
-- aucune ligne pour toute autre personne ou un trip inconnu. SECURITY INVOKER, interne.
CREATE FUNCTION core.claim_incidental_party(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (user_id uuid, role text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  f      record;
BEGIN
  IF p_token_hash IS NULL OR p_trip_id IS NULL THEN
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  SELECT x.guest_user_id, x.holder_user_id INTO f FROM core.claim_incidental_trip_facts(p_trip_id) AS x;
  IF v_user = f.guest_user_id THEN
    RETURN QUERY SELECT v_user, 'GUEST'::text;
  ELSIF v_user = f.holder_user_id THEN
    RETURN QUERY SELECT v_user, 'HOST'::text;
  END IF;
END
$fn$;
COMMENT ON FUNCTION core.claim_incidental_party(bytea, uuid) IS
  'Interne (US-706) : partie de la session sur un trip (GUEST voyageur, HOST titulaire) ; rien '
  'pour toute autre personne.';
REVOKE ALL ON FUNCTION core.claim_incidental_party(bytea, uuid) FROM PUBLIC;

-- 3.3 Demande d'un frais annexe par l'hôte (titulaire du compte d'hôte du trip). Issues :
--   SUBMITTED (demande écrite et notifiée, réponse attendue jusqu'à response_due_at) ;
--   ALREADY_SUBMITTED (rejeu du même identifiant de requête : la même demande) ;
--   NOT_FOUND (session absente, trip inconnu ou d'une autre personne : même issue) ;
--   INCIDENTAL_TYPE_NOT_ALLOWED (hors de la liste fermée) ; INCIDENTAL_TYPE_NOT_SUPPORTED (type de
--   la liste traité par une autre story) ; INCIDENTAL_TRIP_NOT_ENDED (trip non rendu) ;
--   INCIDENTAL_WINDOW_CLOSED (au-delà du délai de l'hôte) ; CLAIM_EVIDENCE_MISSING (aucune pièce,
--   pièce étrangère au trip, jauges ou intérieur manquants) ; INCIDENTAL_NOT_BILLABLE (niveau de
--   carburant non inférieur, fin anticipée, aucune photo de l'intérieur) ; INCIDENTAL_FUEL_PREPAID
--   (Extra vendu) ; INCIDENTAL_AMOUNT_ABOVE_CAP ; INCIDENTAL_DUPLICATE (demande vivante du même
--   type) ; PARAM_MISSING (délai ou plafond absent ou illisible) ; REQUEST_INVALID (motif ou montant
--   mal formé). Toute issue autre que SUBMITTED / ALREADY_SUBMITTED n'écrit rien.
CREATE FUNCTION core.claim_cmd_submit_incidental(p_token_hash bytea, p_trip_id uuid,
                                                 p_request_id uuid, p_fee_type text,
                                                 p_amount_minor bigint, p_description text,
                                                 p_evidence uuid[])
  RETURNS TABLE (outcome text, invoice_id uuid, response_due_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p        record;
  f        record;
  v_old    core.claim_incidental_invoice%ROWTYPE;
  v_now    timestamptz;
  v_win    jsonb;
  v_resp   jsonb;
  v_cap    jsonb;
  v_win_h  integer;
  v_resp_h integer;
  v_cap_m  bigint;
  v_ev     uuid[];
  v_n      integer;
  v_known  integer;
  v_fuel_o boolean;
  v_fuel_i boolean;
  v_inner  boolean;
  v_id     uuid := pg_catalog.gen_random_uuid();
  v_kind   text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor  text := pg_catalog.current_setting('app.actor_id', true);
  v_desc   text := pg_catalog.btrim(p_description);
  v_due    timestamptz;
  v_only   boolean;
  v_extras boolean;
  v_early  boolean;
  v_files  integer := 0;
BEGIN
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, p_trip_id);
  IF p.user_id IS NULL OR p.role <> 'HOST' THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_request_id IS NULL THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- verrou du trip (un seul écrivain d'argent du trip), puis lecture de l'heure
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = p_trip_id FOR UPDATE;
  v_now := platform.now();
  -- rejeu : la même requête rend la même demande, quel que soit le contenu reçu
  SELECT * INTO v_old FROM core.claim_incidental_invoice AS x WHERE x.request_id = p_request_id;
  IF v_old.id IS NOT NULL THEN
    IF v_old.trip_id <> p_trip_id OR v_old.host_user_id <> p.user_id THEN
      RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz;
    ELSE
      RETURN QUERY SELECT 'ALREADY_SUBMITTED'::text, v_old.id, v_old.response_due_at;
    END IF;
    RETURN;
  END IF;
  -- liste fermée de BR-REIMB-01 / BR-PAY-06
  IF p_fee_type IS NULL OR p_fee_type NOT IN ('FUEL', 'CLEANING', 'SMOKING', 'EV_CHARGE',
                                               'MILEAGE', 'TOLL', 'TICKET', 'LATE_RETURN') THEN
    RETURN QUERY SELECT 'INCIDENTAL_TYPE_NOT_ALLOWED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_fee_type NOT IN ('FUEL', 'CLEANING', 'SMOKING') THEN
    RETURN QUERY SELECT 'INCIDENTAL_TYPE_NOT_SUPPORTED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_desc IS NULL OR pg_catalog.char_length(v_desc) NOT BETWEEN 10 AND 500
     OR p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT * INTO f FROM core.claim_incidental_trip_facts(p_trip_id);
  IF f.end_at IS NULL THEN
    RETURN QUERY SELECT 'INCIDENTAL_TRIP_NOT_ENDED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- délais du pays (heure de la base) ; absents ou mal formés : aucune demande
  v_win := core.claim_incidental_param('incidental_host_window_h', f.country_code);
  v_resp := core.claim_incidental_param('invoice_guest_response_h', f.country_code);
  IF pg_catalog.jsonb_typeof(v_win) = 'number' AND (v_win #>> '{}') ~ '^[1-9][0-9]{0,3}$' THEN
    v_win_h := (v_win #>> '{}')::integer;
  END IF;
  IF pg_catalog.jsonb_typeof(v_resp) = 'number' AND (v_resp #>> '{}') ~ '^[1-9][0-9]{0,2}$'
     AND (v_resp #>> '{}')::integer <= 720 THEN
    v_resp_h := (v_resp #>> '{}')::integer;
  END IF;
  -- contrôles plus stricts que Turo en paramètres du pays (DEC-FONDATEUR-22, ADR-197 n° 4)
  v_only := core.claim_incidental_bool('incidental_evidence_trip_photos_only', f.country_code);
  v_extras := core.claim_incidental_bool('incidental_fuel_extras_block', f.country_code);
  v_early := core.claim_incidental_bool('incidental_fuel_early_end_block', f.country_code);
  IF v_win_h IS NULL OR v_resp_h IS NULL OR v_only IS NULL OR v_extras IS NULL
     OR v_early IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_now > f.end_at + pg_catalog.make_interval(hours => v_win_h) THEN
    RETURN QUERY SELECT 'INCIDENTAL_WINDOW_CLOSED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- pièces : chaque fichier est une photo d'une série SUBMITTED du trip (aucune existence révélée)
  SELECT pg_catalog.array_agg(DISTINCT e ORDER BY e) INTO v_ev
    FROM pg_catalog.unnest(p_evidence) AS e WHERE e IS NOT NULL;
  v_n := COALESCE(pg_catalog.cardinality(v_ev), 0);
  SELECT pg_catalog.count(DISTINCT ph.file_id)::integer,
         COALESCE(pg_catalog.bool_or(ph.kind = 'CHECKIN' AND ph.slot_group = 'FUEL'), false),
         COALESCE(pg_catalog.bool_or(ph.kind = 'CHECKOUT' AND ph.slot_group = 'FUEL'), false),
         COALESCE(pg_catalog.bool_or(ph.kind = 'CHECKOUT' AND ph.slot_group = 'INTERIOR'), false)
    INTO v_known, v_fuel_o, v_fuel_i, v_inner
    FROM core.claim_incidental_trip_photos(p_trip_id) AS ph
   WHERE ph.file_id = ANY (COALESCE(v_ev, '{}'::uuid[]));
  -- photos du trip seulement (vrai) ; sinon aussi les fichiers déposés par l'hôte depuis le début
  IF NOT v_only THEN
    SELECT pg_catalog.count(DISTINCT hf.file_id)::integer INTO v_files
      FROM core.claim_incidental_host_files(p_trip_id, p.user_id) AS hf
     WHERE hf.file_id = ANY (COALESCE(v_ev, '{}'::uuid[]))
       AND NOT EXISTS (SELECT 1 FROM core.claim_incidental_trip_photos(p_trip_id) AS ph
                        WHERE ph.file_id = hf.file_id);
  END IF;
  IF v_n = 0 OR v_n > 10 OR v_known + v_files <> v_n
     OR (p_fee_type = 'FUEL' AND NOT (v_fuel_o AND v_fuel_i)) THEN
    RETURN QUERY SELECT 'CLAIM_EVIDENCE_MISSING'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- règles de non-facturation (BR-FUEL-01 à 03, BR-RETURN-05)
  IF p_fee_type = 'FUEL' THEN
    IF v_extras AND f.extras_sold THEN
      RETURN QUERY SELECT 'INCIDENTAL_FUEL_PREPAID'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
    IF (v_early AND f.terminated_early) OR f.fuel_out IS NULL OR f.fuel_in IS NULL OR f.fuel_in >= f.fuel_out THEN
      RETURN QUERY SELECT 'INCIDENTAL_NOT_BILLABLE'::text, NULL::uuid, NULL::timestamptz;
      RETURN;
    END IF;
  -- nettoyage : photo de l'intérieur au retour, ou (photos du trip non exigées) fichier de l'hôte
  ELSIF NOT v_inner AND (v_only OR v_files = 0) THEN
    RETURN QUERY SELECT 'INCIDENTAL_NOT_BILLABLE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- plafond du pays (unités mineures de la devise) ; absent ou illisible : aucune demande
  v_cap := core.claim_incidental_param(CASE p_fee_type WHEN 'FUEL' THEN 'fuel_refill_max'
                                                       ELSE 'incidental_cleaning_max_minor' END,
                                       f.country_code);
  IF pg_catalog.jsonb_typeof(v_cap) IN ('string', 'number')
     AND (v_cap #>> '{}') ~ '^(0|[1-9][0-9]{0,14})$' THEN
    v_cap_m := (v_cap #>> '{}')::bigint;
  END IF;
  IF v_cap_m IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_amount_minor > v_cap_m THEN
    RETURN QUERY SELECT 'INCIDENTAL_AMOUNT_ABOVE_CAP'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.claim_incidental_invoice AS x
              WHERE x.trip_id = p_trip_id AND x.fee_type = p_fee_type
                AND x.status <> 'CANCELLED_BY_HOST') THEN
    RETURN QUERY SELECT 'INCIDENTAL_DUPLICATE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  v_due := v_now + pg_catalog.make_interval(hours => v_resp_h);
  PERFORM pg_catalog.set_config('app.actor_kind', 'HOST', true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  INSERT INTO core.claim_incidental_invoice
         (id, trip_id, country_code, currency, org_id, host_user_id, guest_user_id, request_id,
          fee_type, amount_minor, leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
          leg_platform_minor, description, evidence_file_ids, trip_end_at, host_deadline_at,
          notified_at, response_hours, response_due_at, next_check_at)
  VALUES (v_id, f.trip_id, f.country_code, f.currency, f.org_id, p.user_id, f.guest_user_id,
          p_request_id, p_fee_type, p_amount_minor, p_amount_minor, 0, 0, 0, v_desc, v_ev,
          f.end_at, f.end_at + pg_catalog.make_interval(hours => v_win_h), v_now, v_resp_h, v_due,
          v_due);
  -- avis au voyageur (NTF : parties du trip lues en base ; aucun texte de l'hôte dans l'avis)
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('invoice.status_changed', 1, 'incidental_invoice', v_id, 0, f.country_code, p.user_id,
          'HOST', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object(
            'invoice_id', v_id, 'trip_id', f.trip_id, 'status', 'AWAITING_GUEST',
            'fee_type', p_fee_type, 'amount_minor', p_amount_minor::text, 'currency', f.currency,
            'response_due_at', pg_catalog.to_char(v_due AT TIME ZONE 'UTC',
                                                  'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
          f.trip_id::text);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  RETURN QUERY SELECT 'SUBMITTED'::text, v_id, v_due;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_submit_incidental(bytea, uuid, uuid, text, bigint, text, uuid[]) IS
  'Demande d''un frais annexe par le titulaire du compte d''hôte (liste fermée, photos du trip, '
  'délai de l''hôte, plafond du pays, jambes figées HOST 100 %) ; notifiée à l''heure de la base, '
  'réponse du voyageur sous invoice_guest_response_h. EXECUTE app_api. US-706 (ADR-197).';

-- 3.4 Annulation par l'hôte (SM-5 CANCELLED_BY_HOST) tant qu'aucune décision ni aucun débit
-- n'existe. Issues : CANCELLED, ALREADY_CANCELLED, NOT_FOUND, INCIDENTAL_NOT_CANCELLABLE.
CREATE FUNCTION core.claim_cmd_cancel_incidental(p_token_hash bytea, p_invoice_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip  uuid;
  p       record;
  i       core.claim_incidental_invoice%ROWTYPE;
  v_kind  text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor text := pg_catalog.current_setting('app.actor_id', true);
BEGIN
  SELECT x.trip_id INTO v_trip FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id;
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, v_trip);
  IF v_trip IS NULL OR p.user_id IS NULL OR p.role <> 'HOST' THEN
    RETURN 'NOT_FOUND';
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  -- relue APRÈS le verrou du trip (tout écrivain de la demande le prend d'abord) : lecture simple,
  -- jamais FOR UPDATE ici (les politiques UPDATE ne voient la ligne qu'une fois le contexte posé)
  SELECT * INTO i FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id;
  IF i.id IS NULL OR i.host_user_id IS DISTINCT FROM p.user_id THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF i.status = 'CANCELLED_BY_HOST' THEN
    RETURN 'ALREADY_CANCELLED';
  END IF;
  IF i.status NOT IN ('AWAITING_GUEST', 'DISPUTED') THEN
    RETURN 'INCIDENTAL_NOT_CANCELLABLE';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', 'HOST', true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  UPDATE core.claim_incidental_invoice AS x
     SET status = 'CANCELLED_BY_HOST', cancelled_at = platform.now()
   WHERE x.id = i.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim: incidental update refused' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'claim_incidental_forbidden';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  RETURN 'CANCELLED';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_cancel_incidental(bytea, uuid) IS
  'Annulation d''un frais annexe par l''hôte qui l''a demandé, avant toute décision et tout débit. '
  'EXECUTE app_api. US-706 (ADR-197).';

-- 3.5 Paiement par le voyageur (SM-5 AWAITING_GUEST → ACCEPTED) : accord écrit postérieur à la
-- demande (REQ-PAY-DMG-05), débit par Kmino ensuite. Issues : ACCEPTED, ALREADY_ACCEPTED,
-- NOT_FOUND, GUEST_RESPONSE_WINDOW_CLOSED (à l'échéance ou après), INCIDENTAL_NOT_OPEN (contestée,
-- annulée, décidée).
CREATE FUNCTION core.claim_cmd_accept_incidental(p_token_hash bytea, p_invoice_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip  uuid;
  p       record;
  i       core.claim_incidental_invoice%ROWTYPE;
  v_now   timestamptz;
  v_kind  text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor text := pg_catalog.current_setting('app.actor_id', true);
BEGIN
  SELECT x.trip_id INTO v_trip FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id;
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, v_trip);
  IF v_trip IS NULL OR p.user_id IS NULL OR p.role <> 'GUEST' THEN
    RETURN 'NOT_FOUND';
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  -- relue APRÈS le verrou du trip (tout écrivain de la demande le prend d'abord) : lecture simple,
  -- jamais FOR UPDATE ici (les politiques UPDATE ne voient la ligne qu'une fois le contexte posé)
  SELECT * INTO i FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id;
  -- heure lue APRÈS les verrous (17 §1.3 point 1)
  v_now := platform.now();
  IF i.id IS NULL OR i.guest_user_id IS DISTINCT FROM p.user_id THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF i.accepted_at IS NOT NULL THEN
    RETURN 'ALREADY_ACCEPTED';
  END IF;
  IF i.status <> 'AWAITING_GUEST' THEN
    RETURN 'INCIDENTAL_NOT_OPEN';
  END IF;
  IF v_now >= i.response_due_at THEN
    RETURN 'GUEST_RESPONSE_WINDOW_CLOSED';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  UPDATE core.claim_incidental_invoice AS x
     SET status = 'ACCEPTED', accepted_at = v_now, next_check_at = v_now, execution_code = NULL
   WHERE x.id = i.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim: incidental update refused' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'claim_incidental_forbidden';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  RETURN 'ACCEPTED';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_accept_incidental(bytea, uuid) IS
  'Paiement d''un frais annexe par le voyageur du trip avant l''échéance (accord écrit) ; débit par '
  'Kmino ensuite. EXECUTE app_api. US-706 (ADR-197).';

-- 3.6 Contestation par le voyageur avec preuves (SM-5 AWAITING_GUEST → DISPUTED, BR-REIMB-03) :
-- motif écrit (20 à 1 000 caractères) et au moins une photo d'une série du trip. Issues : DISPUTED,
-- ALREADY_DISPUTED, NOT_FOUND, GUEST_RESPONSE_WINDOW_CLOSED, INCIDENTAL_NOT_OPEN,
-- INCIDENTAL_DISPUTE_REASON_REQUIRED, CLAIM_EVIDENCE_MISSING.
CREATE FUNCTION core.claim_cmd_dispute_incidental(p_token_hash bytea, p_invoice_id uuid,
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
  i        core.claim_incidental_invoice%ROWTYPE;
  v_now    timestamptz;
  v_ev     uuid[];
  v_n      integer;
  v_known  integer;
  v_reason text := pg_catalog.btrim(p_reason);
  v_kind   text := pg_catalog.current_setting('app.actor_kind', true);
  v_actor  text := pg_catalog.current_setting('app.actor_id', true);
BEGIN
  SELECT x.trip_id INTO v_trip FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id;
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, v_trip);
  IF v_trip IS NULL OR p.user_id IS NULL OR p.role <> 'GUEST' THEN
    RETURN 'NOT_FOUND';
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  -- relue APRÈS le verrou du trip (tout écrivain de la demande le prend d'abord) : lecture simple,
  -- jamais FOR UPDATE ici (les politiques UPDATE ne voient la ligne qu'une fois le contexte posé)
  SELECT * INTO i FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id;
  v_now := platform.now();
  IF i.id IS NULL OR i.guest_user_id IS DISTINCT FROM p.user_id THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF i.disputed_at IS NOT NULL THEN
    RETURN 'ALREADY_DISPUTED';
  END IF;
  IF i.status <> 'AWAITING_GUEST' THEN
    RETURN 'INCIDENTAL_NOT_OPEN';
  END IF;
  IF v_now >= i.response_due_at THEN
    RETURN 'GUEST_RESPONSE_WINDOW_CLOSED';
  END IF;
  IF v_reason IS NULL OR pg_catalog.char_length(v_reason) NOT BETWEEN 20 AND 1000 THEN
    RETURN 'INCIDENTAL_DISPUTE_REASON_REQUIRED';
  END IF;
  SELECT pg_catalog.array_agg(DISTINCT e ORDER BY e) INTO v_ev
    FROM pg_catalog.unnest(p_evidence) AS e WHERE e IS NOT NULL;
  v_n := COALESCE(pg_catalog.cardinality(v_ev), 0);
  SELECT pg_catalog.count(DISTINCT ph.file_id)::integer INTO v_known
    FROM core.claim_incidental_trip_photos(v_trip) AS ph
   WHERE ph.file_id = ANY (COALESCE(v_ev, '{}'::uuid[]));
  IF v_n = 0 OR v_n > 10 OR v_known <> v_n THEN
    RETURN 'CLAIM_EVIDENCE_MISSING';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
  PERFORM pg_catalog.set_config('app.actor_id', p.user_id::text, true);
  UPDATE core.claim_incidental_invoice AS x
     SET status = 'DISPUTED', disputed_at = v_now, dispute_reason = v_reason,
         dispute_evidence_file_ids = v_ev
   WHERE x.id = i.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim: incidental update refused' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'claim_incidental_forbidden';
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_actor, ''), true);
  RETURN 'DISPUTED';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_dispute_incidental(bytea, uuid, text, uuid[]) IS
  'Contestation d''un frais annexe par le voyageur avant l''échéance, avec motif et photos du trip ; '
  'aucun débit avant la décision de l''ops. EXECUTE app_api. US-706 (ADR-197).';

-- 3.7 Vue des frais annexes d'un trip pour une partie (hôte titulaire ou voyageur) : demandes,
-- état, échéance, état du débit d'US-703, pièces de CHAQUE demande (côté, emplacement, auteur,
-- heure serveur : revue ux n° 1, le voyageur voit les preuves avant de payer), plafonds du pays
-- (hôte) ; identifiants des photos du trip seulement quand ils servent (hôte qui peut demander,
-- voyageur qui peut contester ; revue sécurité). Aucune donnée
-- nominative de l'autre partie ; le motif de la contestation n'est rendu qu'au voyageur qui l'a
-- écrit et à l'hôte du trip (BR-REIMB-03 : l'hôte peut annuler au vu de la contestation).
-- `{ "outcome": "NOT_FOUND" }` pour toute autre personne.
CREATE FUNCTION core.claim_incidental_view(p_token_hash bytea, p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  p       record;
  f       record;
  v_now   timestamptz := platform.now();
  v_win   jsonb;
  v_win_h integer;
  v_list  jsonb;
  v_ph    jsonb;
  v_iso   text := 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';
  v_can   boolean;
  v_open  boolean;
  v_caps  jsonb;
BEGIN
  SELECT * INTO p FROM core.claim_incidental_party(p_token_hash, p_trip_id);
  IF p.user_id IS NULL THEN
    RETURN '{"outcome": "NOT_FOUND"}'::jsonb;
  END IF;
  SELECT * INTO f FROM core.claim_incidental_trip_facts(p_trip_id);
  v_win := core.claim_incidental_param('incidental_host_window_h', f.country_code);
  IF pg_catalog.jsonb_typeof(v_win) = 'number' AND (v_win #>> '{}') ~ '^[1-9][0-9]{0,3}$' THEN
    v_win_h := (v_win #>> '{}')::integer;
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'id', i.id, 'feeType', i.fee_type, 'amountMinor', i.amount_minor::text,
           'status', i.status,
           'notifiedAt', pg_catalog.to_char(i.notified_at AT TIME ZONE 'UTC', v_iso),
           'responseDueAt', pg_catalog.to_char(i.response_due_at AT TIME ZONE 'UTC', v_iso),
           'windowOpen', i.status = 'AWAITING_GUEST' AND v_now < i.response_due_at,
           'description', i.description,
           'evidenceCount', pg_catalog.cardinality(i.evidence_file_ids),
           'evidence', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                         'kind', ph.kind, 'slotCode', ph.slot_code, 'slotGroup', ph.slot_group,
                         'takenBy', ph.taken_by_role,
                         'receivedAt', pg_catalog.to_char(ph.received_at AT TIME ZONE 'UTC', v_iso))
                         ORDER BY ph.kind, ph.received_at, ph.slot_code)
                         FROM core.claim_incidental_trip_photos(p_trip_id) AS ph
                        WHERE ph.file_id = ANY (i.evidence_file_ids)), '[]'::jsonb),
           'disputeReason', i.dispute_reason,
           'decision', CASE WHEN i.decided_at IS NULL THEN NULL
                            WHEN i.status = 'REJECTED' THEN 'REJECTED' ELSE 'CHARGE' END,
           'decisionRationale', i.decision_rationale,
           'chargeStatus', CASE WHEN i.charge_id IS NULL THEN NULL
                                WHEN c.status = 'CHARGED' THEN 'PAID'
                                WHEN c.status = 'UNPAID' THEN 'UNPAID'
                                ELSE 'PROCESSING' END)
           ORDER BY i.notified_at DESC, i.fee_type), '[]'::jsonb)
    INTO v_list
    FROM core.claim_incidental_invoice AS i
    LEFT JOIN core.payment_post_trip_charge AS c ON c.id = i.charge_id
   WHERE i.trip_id = p_trip_id;
  v_can := p.role = 'HOST' AND f.end_at IS NOT NULL AND v_win_h IS NOT NULL
           AND v_now <= f.end_at + pg_catalog.make_interval(hours => v_win_h);
  v_open := p.role = 'GUEST'
            AND EXISTS (SELECT 1 FROM core.claim_incidental_invoice AS i
                         WHERE i.trip_id = p_trip_id AND i.status = 'AWAITING_GUEST'
                           AND v_now < i.response_due_at);
  -- identifiants des photos : à l'hôte qui peut demander, au voyageur qui peut contester
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'fileId', ph.file_id, 'kind', ph.kind, 'slotCode', ph.slot_code,
           'slotGroup', ph.slot_group, 'takenBy', ph.taken_by_role)), '[]'::jsonb)
    INTO v_ph
    FROM core.claim_incidental_trip_photos(p_trip_id) AS ph
   WHERE v_can OR v_open;
  -- plafonds du pays (aide du montant de l'hôte ; revue ux n° 3) ; NULL : non fixé
  IF p.role = 'HOST' THEN
    v_caps := pg_catalog.jsonb_build_object(
      'FUEL', core.claim_incidental_param('fuel_refill_max', f.country_code) #>> '{}',
      'CLEANING', core.claim_incidental_param('incidental_cleaning_max_minor', f.country_code) #>> '{}',
      'SMOKING', core.claim_incidental_param('incidental_cleaning_max_minor', f.country_code) #>> '{}');
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'OK', 'viewerRole', p.role, 'currency', f.currency, 'timezone', f.timezone,
    'endedAt', CASE WHEN f.end_at IS NULL THEN NULL
                    ELSE pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', v_iso) END,
    'hostDeadlineAt', CASE WHEN f.end_at IS NULL OR v_win_h IS NULL THEN NULL
                           ELSE pg_catalog.to_char((f.end_at + pg_catalog.make_interval(
                                  hours => v_win_h)) AT TIME ZONE 'UTC', v_iso) END,
    'canSubmit', v_can,
    'feeTypes', '["FUEL", "CLEANING", "SMOKING"]'::jsonb,
    'caps', v_caps,
    'invoices', v_list, 'photos', v_ph);
END
$fn$;
COMMENT ON FUNCTION core.claim_incidental_view(bytea, uuid) IS
  'Vue des frais annexes d''un trip pour l''hôte titulaire ou le voyageur (demandes, échéance, '
  'état du débit, photos du trip utilisables comme pièces). EXECUTE app_api. US-706 (ADR-197).';

-- 3.8 Décision de l'ops après contestation (appelée par la porte du staff, qui a jugé la session,
-- la permission, le pays et la séparation des tâches). Issues : DECIDED, ALREADY_DECIDED (rejeu
-- de la même requête), NOT_FOUND, INCIDENTAL_NOT_DISPUTED, DECISION_RATIONALE_REQUIRED,
-- DECISION_FINALITY_FORBIDDEN, DECISION_ADMIN_REQUIRED (débit décidé par un OPS_AGENT),
-- REQUEST_INVALID.
CREATE FUNCTION core.claim_cmd_decide_incidental(p_invoice_id uuid, p_agent uuid, p_role text,
                                                 p_request_id uuid, p_outcome text,
                                                 p_rationale text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip uuid;
  i      core.claim_incidental_invoice%ROWTYPE;
  v_rat  text := pg_catalog.btrim(p_rationale);
  v_now  timestamptz;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RAISE EXCEPTION 'claim: decide_incidental reserved to the staff gate'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_incidental_forbidden';
  END IF;
  IF p_request_id IS NULL OR p_agent IS NULL OR p_role IS NULL OR p_role NOT IN ('OPS_AGENT', 'ADMIN')
     OR p_outcome IS NULL OR p_outcome NOT IN ('CHARGE', 'REJECT') THEN
    RETURN 'REQUEST_INVALID';
  END IF;
  SELECT x.trip_id INTO v_trip FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id;
  IF v_trip IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO i FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id FOR UPDATE;
  v_now := platform.now();
  IF i.decision_request_id = p_request_id THEN
    RETURN 'ALREADY_DECIDED';
  END IF;
  IF i.status <> 'DISPUTED' THEN
    RETURN 'INCIDENTAL_NOT_DISPUTED';
  END IF;
  IF v_rat IS NULL OR pg_catalog.char_length(v_rat) NOT BETWEEN 20 AND 2000 THEN
    RETURN 'DECISION_RATIONALE_REQUIRED';
  END IF;
  -- jamais une décision « définitive » (OQ-BR-24 ; même lecture que 0175)
  IF v_rat ~* '(definitiv|définitiv|inapelable|sin (derecho a )?apelaci|sans (appel|recours)|sem (direito a )?recurso|irrecorr|final and binding|not subject to appeal)' THEN
    RETURN 'DECISION_FINALITY_FORBIDDEN';
  END IF;
  -- toute décision qui débite le voyageur est réservée à ADMIN (ADR-195, aucun seuil fixé)
  IF p_outcome = 'CHARGE' AND p_role <> 'ADMIN' THEN
    RETURN 'DECISION_ADMIN_REQUIRED';
  END IF;
  UPDATE core.claim_incidental_invoice AS x
     SET status = CASE p_outcome WHEN 'CHARGE' THEN 'DECIDED_CHARGE' ELSE 'REJECTED' END,
         decided_at = v_now, decided_by = p_agent, decided_role = p_role,
         decision_request_id = p_request_id, decision_rationale = v_rat,
         next_check_at = v_now, execution_code = NULL
   WHERE x.id = i.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim: incidental update refused' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'claim_incidental_forbidden';
  END IF;
  RETURN 'DECIDED';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_decide_incidental(uuid, uuid, text, uuid, text, text) IS
  'Décision motivée de l''ops sur un frais annexe contesté (débiter : ADMIN ; rejeter), jamais '
  '« définitive ». Appelée par la porte du staff. EXECUTE iam_staff_owner. US-706 (ADR-197).';

-- 3.9 Vue d'une demande pour la console (aucune donnée nominative ; textes de l'hôte, du voyageur
-- et de l'agent, consigne : aucun nom ni contact)
CREATE FUNCTION core.claim_incidental_staff_view(p_invoice_id uuid)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
           'id', i.id, 'tripId', i.trip_id, 'country', i.country_code, 'currency', i.currency,
           'feeType', i.fee_type, 'amountMinor', i.amount_minor::text,
           'legs', pg_catalog.jsonb_build_object('HOST', i.leg_host_minor::text,
                     'INSURER', i.leg_insurer_minor::text,
                     'TAX_THIRD_PARTY', i.leg_tax_third_party_minor::text,
                     'PLATFORM', i.leg_platform_minor::text),
           'status', i.status, 'description', i.description,
           'evidence', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                         'kind', ph.kind, 'slotCode', ph.slot_code, 'takenBy', ph.taken_by_role))
                         FROM core.claim_incidental_trip_photos(i.trip_id) AS ph
                        WHERE ph.file_id = ANY (i.evidence_file_ids)), '[]'::jsonb),
           'disputeEvidence', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                         'kind', ph.kind, 'slotCode', ph.slot_code, 'takenBy', ph.taken_by_role))
                         FROM core.claim_incidental_trip_photos(i.trip_id) AS ph
                        WHERE ph.file_id = ANY (i.dispute_evidence_file_ids)), '[]'::jsonb),
           'notifiedAt', pg_catalog.to_char(i.notified_at AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'responseDueAt', pg_catalog.to_char(i.response_due_at AT TIME ZONE 'UTC',
                                               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'disputedAt', pg_catalog.to_char(i.disputed_at AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'disputeReason', i.dispute_reason,
           'decidedRole', i.decided_role, 'decisionRationale', i.decision_rationale,
           'chargeBasis', i.charge_basis)
    FROM core.claim_incidental_invoice AS i WHERE i.id = p_invoice_id
$fn$;
COMMENT ON FUNCTION core.claim_incidental_staff_view(uuid) IS
  'Console : vue d''un frais annexe (montant, jambes, pièces, contestation, décision). EXECUTE '
  'iam_staff_owner. US-706 (ADR-197).';

-- 3.10 File du travailleur payment_command : demandes à débiter (payées, décidées, ou sans réponse
-- dont l'échéance est passée à l'heure de la base), plus anciennes d'abord
CREATE FUNCTION core.claim_incidental_invoices_due(p_limit integer)
  RETURNS TABLE (invoice_id uuid)
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
    RAISE EXCEPTION 'claim: incidental_invoices_due reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_incidental_forbidden';
  END IF;
  RETURN QUERY
  SELECT i.id FROM core.claim_incidental_invoice AS i
   WHERE i.next_check_at <= v_now
     AND (i.status IN ('ACCEPTED', 'DECIDED_CHARGE')
          OR (i.status = 'AWAITING_GUEST' AND i.response_due_at <= v_now))
   ORDER BY i.next_check_at, i.notified_at, i.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END
$fn$;
COMMENT ON FUNCTION core.claim_incidental_invoices_due(integer) IS
  'Travailleur payment_command : frais annexes à débiter (payés, décidés, ou échéance passée sans '
  'réponse). EXECUTE app_worker. US-706 (ADR-197).';

-- 3.11 Débit d'un frais annexe par Kmino (travailleur payment_command), sous le verrou du trip puis
-- de la demande, à l'heure de la base lue APRÈS les verrous. Issues : CHARGED (ordre de débit
-- d'US-703 notifié aux jambes explicites ; rejeu : même issue), NOT_DUE (`code` :
-- GUEST_RESPONSE_WINDOW_OPEN avant l'échéance, INCIDENTAL_DISPUTED en attente de décision ; rien
-- n'est écrit), BLOCKED (`NO_CARD_TENDER` : aucune opération de carte prouvée du loyer, relue dans
-- 24 h), DONE (`code` : REJECTED, CANCELLED_BY_HOST : rien à débiter), NOT_FOUND.
CREATE FUNCTION core.claim_cmd_charge_incidental(p_invoice_id uuid, p_charge_id uuid)
  RETURNS TABLE (outcome text, code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t        record;
  i        core.claim_incidental_invoice%ROWTYPE;
  v_trip   uuid;
  v_now    timestamptz;
  v_tender uuid;
  v_basis  text;
  r        record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: charge_incidental reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_incidental_forbidden';
  END IF;
  IF p_invoice_id IS NULL OR p_charge_id IS NULL THEN
    RAISE EXCEPTION 'claim: invalid charge input' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.trip_id INTO v_trip FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  -- ordre des verrous de notify (trip, puis débit) : trip, puis demande
  SELECT x.id, x.currency, x.source_hold_id INTO t
    FROM core.booking_trip AS x WHERE x.id = v_trip FOR UPDATE;
  SELECT * INTO i FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id FOR UPDATE;
  v_now := platform.now();
  IF i.status = 'CHARGED' THEN
    RETURN QUERY SELECT 'CHARGED'::text, i.charge_basis;
    RETURN;
  END IF;
  IF i.status IN ('REJECTED', 'CANCELLED_BY_HOST') THEN
    RETURN QUERY SELECT 'DONE'::text, i.status;
    RETURN;
  END IF;
  IF i.status = 'DISPUTED' THEN
    RETURN QUERY SELECT 'NOT_DUE'::text, 'INCIDENTAL_DISPUTED'::text;
    RETURN;
  END IF;
  IF i.status = 'AWAITING_GUEST' AND v_now < i.response_due_at THEN
    RETURN QUERY SELECT 'NOT_DUE'::text, 'GUEST_RESPONSE_WINDOW_OPEN'::text;
    RETURN;
  END IF;
  v_basis := CASE i.status WHEN 'ACCEPTED' THEN 'GUEST_ACCEPTED'
                           WHEN 'DECIDED_CHARGE' THEN 'OPS_DECISION'
                           ELSE 'NO_RESPONSE' END;
  -- moyen débité : opération de carte du loyer prouvée (jamais la caution, L3-PM-24)
  SELECT o.id INTO v_tender
    FROM core.payment_payment_operation AS o
   WHERE (o.trip_id = t.id OR (t.source_hold_id IS NOT NULL AND o.hold_id = t.source_hold_id))
     AND o.kind IN ('AUTH', 'CAPTURE') AND o.method = 'CARD' AND o.purpose = 'RENT'
     AND o.status = 'SUCCEEDED' AND o.currency = t.currency
   ORDER BY (o.kind = 'CAPTURE') DESC, o.created_at, o.id
   LIMIT 1;
  IF v_tender IS NULL THEN
    UPDATE core.claim_incidental_invoice AS x
       SET next_check_at = v_now + interval '1 day', execution_code = 'NO_CARD_TENDER'
     WHERE x.id = i.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'claim: incidental update refused' USING ERRCODE = 'insufficient_privilege',
        CONSTRAINT = 'claim_incidental_forbidden';
    END IF;
    RETURN QUERY SELECT 'BLOCKED'::text, 'NO_CARD_TENDER'::text;
    RETURN;
  END IF;
  -- débit séparé d'US-703 : montant explicite de chaque jambe ; accord écrit = paiement du voyageur
  SELECT * INTO r FROM core.payment_cmd_notify_post_trip_charge(
    p_charge_id, t.id, 'INCIDENTAL', 'DELAYED_CHARGES', 'INCIDENTAL_INVOICE', i.id, NULL, v_tender,
    i.amount_minor,
    pg_catalog.jsonb_build_object('HOST', i.leg_host_minor::text,
                                  'INSURER', i.leg_insurer_minor::text,
                                  'TAX_THIRD_PARTY', i.leg_tax_third_party_minor::text,
                                  'PLATFORM', i.leg_platform_minor::text),
    v_basis = 'GUEST_ACCEPTED');
  UPDATE core.claim_incidental_invoice AS x
     SET status = 'CHARGED', charge_id = r.charge_id, charged_at = v_now, charge_basis = v_basis,
         execution_code = NULL
   WHERE x.id = i.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim: incidental update refused' USING ERRCODE = 'insufficient_privilege',
      CONSTRAINT = 'claim_incidental_forbidden';
  END IF;
  RETURN QUERY SELECT 'CHARGED'::text, v_basis;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_charge_incidental(uuid, uuid) IS
  'Débit d''un frais annexe par Kmino : payé, décidé par l''ops, ou échéance passée sans réponse ; '
  'débit séparé d''US-703 aux jambes explicites, jamais la caution, jamais une demande contestée '
  'avant la décision. Travailleur payment_command. EXECUTE app_worker. US-706 (ADR-197).';

-- 3.12 Report d'un débit en échec (erreur de la base attrapée par le travailleur) : +15 min
CREATE FUNCTION core.claim_cmd_defer_incidental(p_invoice_id uuid, p_code text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: defer_incidental reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_incidental_forbidden';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Z][A-Z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'claim: invalid code' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE core.claim_incidental_invoice AS x
     SET next_check_at = platform.now() + interval '15 minutes', execution_code = p_code
   WHERE x.id = p_invoice_id AND x.status IN ('AWAITING_GUEST', 'ACCEPTED', 'DECIDED_CHARGE');
  RETURN CASE WHEN FOUND THEN 'DEFERRED' ELSE 'NOT_DUE' END;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_defer_incidental(uuid, text) IS
  'Travailleur payment_command : débit d''un frais annexe en échec repoussé de 15 min (PROPOSÉ), '
  'code seulement. EXECUTE app_worker. US-706 (ADR-197).';

REVOKE ALL ON FUNCTION
  core.claim_cmd_submit_incidental(bytea, uuid, uuid, text, bigint, text, uuid[]),
  core.claim_cmd_cancel_incidental(bytea, uuid),
  core.claim_cmd_accept_incidental(bytea, uuid),
  core.claim_cmd_dispute_incidental(bytea, uuid, text, uuid[]),
  core.claim_incidental_view(bytea, uuid),
  core.claim_cmd_decide_incidental(uuid, uuid, text, uuid, text, text),
  core.claim_incidental_staff_view(uuid),
  core.claim_incidental_invoices_due(integer),
  core.claim_cmd_charge_incidental(uuid, uuid),
  core.claim_cmd_defer_incidental(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.claim_cmd_submit_incidental(bytea, uuid, uuid, text, bigint, text, uuid[]),
  core.claim_cmd_cancel_incidental(bytea, uuid),
  core.claim_cmd_accept_incidental(bytea, uuid),
  core.claim_cmd_dispute_incidental(bytea, uuid, text, uuid[]),
  core.claim_incidental_view(bytea, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION
  core.claim_cmd_decide_incidental(uuid, uuid, text, uuid, text, text),
  core.claim_incidental_staff_view(uuid) TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION
  core.claim_incidental_invoices_due(integer),
  core.claim_cmd_charge_incidental(uuid, uuid),
  core.claim_cmd_defer_incidental(uuid, text) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 4. Portes du staff (iam_staff_owner, EXECUTE app_api) ------------------------------------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Porte commune : demande, permission dans son pays, séparation des tâches (ADR-122). Rend
-- (refus, rôle, pays, trip) ; refus journalisé ici. Demande inconnue : même issue qu'une
-- permission absente (aucune existence révélée).
CREATE FUNCTION core.support_staff_incidental_gate(p_user uuid, p_invoice_id uuid,
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
    FROM core.claim_incidental_invoice AS x WHERE x.id = p_invoice_id;
  IF v_i.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(p_user, p_permission, ARRAY[v_i.country_code], NULL);
  END IF;
  v_deny := CASE
    WHEN v_i.id IS NULL OR v_role IS NULL THEN 'PERMISSION'
    WHEN core.support_actor_conflict(p_user, 'TRIP', v_i.trip_id) THEN 'SELF'
    ELSE NULL END;
  IF v_deny IS NOT NULL THEN
    PERFORM core.iam_staff_audit(p_user, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 CASE WHEN v_i.id IS NULL THEN 'INCIDENTAL_INVOICE' ELSE 'TRIP' END,
                                 COALESCE(v_i.trip_id, p_invoice_id), NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_i.id IS NULL THEN 'SUBJECT_NOT_FOUND' ELSE v_deny END,
                                   'attempted', p_attempted, 'permission', p_permission,
                                   'invoice_id', p_invoice_id)
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
COMMENT ON FUNCTION core.support_staff_incidental_gate(uuid, uuid, text, text, uuid) IS
  'Interne (US-706) : porte d''un frais annexe (permission dans son pays, garde ADR-122) ; refus '
  'journalisés. Aucun EXECUTE (propriétaire seul).';
REVOKE ALL ON FUNCTION core.support_staff_incidental_gate(uuid, uuid, text, text, uuid) FROM PUBLIC;

-- 4.1 Lecture d'un frais annexe (dispute.decide). Issues : OK, AUTH_REQUIRED, MFA_REQUIRED,
-- FORBIDDEN (demande inconnue ou permission absente dans son pays), SELF_FORBIDDEN.
CREATE FUNCTION core.support_staff_incidental(p_token_hash bytea, p_request_id uuid,
                                              p_invoice_id uuid)
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
  IF p_request_id IS NULL OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'frais annexe : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
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
  SELECT * INTO g FROM core.support_staff_incidental_gate(v_s.user_id, p_invoice_id,
                                                          'dispute.decide', 'INCIDENTAL_READ',
                                                          p_request_id);
  IF g.deny IS NOT NULL THEN
    RETURN QUERY SELECT CASE g.deny WHEN 'SELF' THEN 'SELF_FORBIDDEN' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, core.claim_incidental_staff_view(p_invoice_id);
END
$fn$;
COMMENT ON FUNCTION core.support_staff_incidental(bytea, uuid, uuid) IS
  'Console : vue d''un frais annexe ; session élevée, dispute.decide dans le pays, garde ADR-122. '
  'EXECUTE app_api. US-706 (ADR-197).';

-- 4.2 Décision sur un frais annexe contesté (dispute.decide). Issues : celles de la porte, puis
-- celles de core.claim_cmd_decide_incidental. Décision et refus journalisés.
CREATE FUNCTION core.support_staff_decide_incidental(p_token_hash bytea, p_request_id uuid,
                                                     p_invoice_id uuid, p_outcome text,
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
  IF p_request_id IS NULL OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'frais annexe : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'INCIDENTAL_INVOICE',
                                 p_invoice_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DECIDE_INCIDENTAL',
                                   'permission', 'dispute.decide'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO g FROM core.support_staff_incidental_gate(v_s.user_id, p_invoice_id,
                                                          'dispute.decide', 'DECIDE_INCIDENTAL',
                                                          p_request_id);
  IF g.deny IS NOT NULL THEN
    RETURN QUERY SELECT CASE g.deny WHEN 'SELF' THEN 'SELF_FORBIDDEN' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  v_r := core.claim_cmd_decide_incidental(p_invoice_id, v_s.user_id, g.role, p_request_id,
                                          p_outcome, p_rationale);
  IF v_r = 'DECIDED' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, g.role, 'INCIDENTAL_DECISION_ISSUED', 'TRIP',
                                 g.trip_id, NULL,
                                 pg_catalog.jsonb_build_object('country', g.country_code,
                                   'invoice_id', p_invoice_id, 'outcome', p_outcome),
                                 NULL, p_request_id);
  ELSIF v_r <> 'ALREADY_DECIDED' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, g.role, 'INCIDENTAL_DECISION_REFUSED', 'TRIP',
                                 g.trip_id, NULL,
                                 pg_catalog.jsonb_build_object('country', g.country_code,
                                   'invoice_id', p_invoice_id, 'code', v_r),
                                 NULL, p_request_id);
  END IF;
  RETURN QUERY SELECT v_r,
                      CASE WHEN v_r IN ('DECIDED', 'ALREADY_DECIDED')
                           THEN core.claim_incidental_staff_view(p_invoice_id) END;
END
$fn$;
COMMENT ON FUNCTION core.support_staff_decide_incidental(bytea, uuid, uuid, text, text) IS
  'Console (DECIDE_INCIDENTAL) : décision motivée sur un frais annexe contesté ; session élevée, '
  'dispute.decide dans le pays, garde ADR-122, débit réservé à ADMIN ; décision et refus '
  'journalisés. EXECUTE app_api. US-706 (ADR-197).';

REVOKE ALL ON FUNCTION core.support_staff_incidental(bytea, uuid, uuid),
  core.support_staff_decide_incidental(bytea, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_incidental(bytea, uuid, uuid),
  core.support_staff_decide_incidental(bytea, uuid, uuid, text, text) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 5. Paramètres `incidental_host_window_h`, `incidental_cleaning_max_minor` et des trois contrôles
-- de DEC-FONDATEUR-22 (`incidental_evidence_trip_photos_only`, `incidental_fuel_extras_block`,
-- `incidental_fuel_early_end_block`) : bloc GÉNÉRÉ depuis
-- apps/api/src/modules/cfg/data/params.json (`renderParamSeedSql`, groupe `embedded` de
-- POST_SEED_PARAMS) ; seed-sql.test.ts exige ce bloc à l'identique. Ne pas l'éditer à la main.
-- 0177 — graine complémentaire : paramètres « incidental_host_window_h* » (US-706 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « incidental_host_window_h » ou vaut incidental_cleaning_max_minor, incidental_evidence_trip_photos_only, incidental_fuel_early_end_block, incidental_fuel_extras_block ;
-- jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('incidental_cleaning_max_minor', 'MONEY', NULL, ARRAY['COUNTRY']::text[], true, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-REIMB-01 (nettoyage / tabac : 150 $ chez Turo) ; 16 CLM-021 ; ADR-197 : plafond d’un frais annexe de nettoyage ou de tabac demandé par l’hôte, en unités mineures de la devise du pays ; au-delà, la demande est refusée ; absent ou mal formé : aucune demande de nettoyage ni de tabac (fail-closed)', 'PROPOSÉ comme Turo (ADR-197) : 150,00 USD au Panama ; 1 125 000 PYG au Paraguay (même conversion que price_ceiling_extra_km_minor, à confirmer par le fondateur)'),
  ('incidental_evidence_trip_photos_only', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-REIMB-01, BR-PICKUP-03 ; 16 CLM-021 ; DEC-FONDATEUR-22 ; ADR-197 : vrai : les pièces d’un frais annexe sont des photos des séries de départ ou de retour du trip (heure serveur, empreinte) ; faux : aussi les fichiers du seau des preuves déposés par l’hôte depuis le début du trip ; absent : aucune demande (fail-closed)', 'PROPOSÉ (ADR-197) : vrai, contrôle gardé contre une fraude évidente (photo antidatée ou d’un autre véhicule, L3-PM-02) ; Turo demande aussi des photos à métadonnées'),
  ('incidental_fuel_early_end_block', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-FUEL-03 ; 16 CLM-021 ; DEC-FONDATEUR-22 ; ADR-197 : vrai : carburant refusé après une fin anticipée du trip (la cause n’est pas en base) ; faux : le voyageur conteste si la fin anticipée vient de l’hôte ou du véhicule ; absent : aucune demande (fail-closed)', 'PROPOSÉ comme Turo (ADR-197) : faux ; Turo ne refuse que la fin anticipée causée par l’hôte ou le véhicule'),
  ('incidental_fuel_extras_block', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-FUEL-02 ; 16 CLM-021 ; DEC-FONDATEUR-22 ; ADR-197 : vrai : carburant refusé dès qu’un Extra est vendu au devis du trip (l’Extra « carburant prépayé » n’est pas distingué) ; faux : seul le voyageur conteste ; absent : aucune demande (fail-closed)', 'PROPOSÉ comme Turo (ADR-197) : faux ; Turo ne refuse que l’Extra carburant prépayé, qui n’existe pas encore ici'),
  ('incidental_host_window_h', 'DURATION', 'h', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-REIMB-01 (échéances exécutables, R09 : `deadline = end_effective + 72 h` pour le carburant, le nettoyage et le tabac) ; 16 CLM-021 ; ADR-197 : délai de l’hôte pour demander un frais annexe après la fin effective du trip ; au-delà, la demande est refusée (EXPIRED_WINDOW de SM-5) ; absent ou mal formé : aucune demande (fail-closed)', 'PROPOSÉ comme Turo (ADR-197) : 72 h après la fin du trip, comme la règle de Turo la plus récente (08 BR-FUEL-01, H59)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('incidental_cleaning_max_minor', 'PA', 'COUNTRY', NULL, NULL, '"15000"'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)'),
  ('incidental_cleaning_max_minor', 'PY', 'COUNTRY', NULL, NULL, '"1125000"'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)'),
  ('incidental_evidence_trip_photos_only', 'PA', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)'),
  ('incidental_evidence_trip_photos_only', 'PY', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)'),
  ('incidental_fuel_early_end_block', 'PA', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)'),
  ('incidental_fuel_early_end_block', 'PY', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)'),
  ('incidental_fuel_extras_block', 'PA', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)'),
  ('incidental_fuel_extras_block', 'PY', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)'),
  ('incidental_host_window_h', 'PA', 'COUNTRY', NULL, NULL, '72'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)'),
  ('incidental_host_window_h', 'PY', 'COUNTRY', NULL, NULL, '72'::jsonb, 'graine US-706 : défauts PROPOSÉS (08 BR-REIMB-01 ; 16 CLM-021 ; ADR-197)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE (d.key LIKE 'incidental\_host\_window\_h%' OR d.key = ANY (ARRAY['incidental_cleaning_max_minor', 'incidental_evidence_trip_photos_only', 'incidental_fuel_early_end_block', 'incidental_fuel_extras_block']::text[]))
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre incidental_host_window_h* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
