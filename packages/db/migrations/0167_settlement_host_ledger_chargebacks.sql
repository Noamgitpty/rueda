-- 0167 — STL / PYO : grand livre de l'hôte complet (SM-6b), imputation des chargebacks perdus,
-- compensation `NETTING` au grand livre, ajustement de versement et passage en perte à deux
-- personnes.
-- US-709 (reste du lot 3 ; la partie 709a est 0129) ; ADR-187 ; 19 US-709 (critères 1 à 4) ;
-- 16 PYO-007 ; 08 E5 (« Reprise », « Chargeback perdu pendant un remboursement bloqué »), E7
-- règles 3 bis et 7, SM-6b ; 17 v6 §2.9 (avance de Kmino, recouvrement, passage en perte), §3.2.8
-- (`host_ledger_state`), RLS-2, RLS-26, RLS-28 ; vecteurs T53, T54, T55, T67, TJ14a à TJ14c,
-- TJ18b, TJ18d ; BOARD N-270 à N-277, N-402, N-415 ; pré-mortem L3-PM-39 à L3-PM-44 ; red team
-- RT-L3-V07 à V10, RT-L3-H01. Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-187, PROPOSÉS, fail-closed ; « comme Turo » : un solde négatif de l'hôte est
-- retenu sur ses gains suivants) :
--   1. `core.settlement_host_ledger_entry` (0129, 0139) : trois motifs de plus —
--      `CHARGEBACK_CLAWBACK` (débit, une écriture par chargeback, rattachée au règlement
--      d'annulation du trip), `PAYOUT_NETTING` (crédit, une écriture par lot de versement compensé,
--      sans règlement, rattachée au lot par une clé étrangère composite qui fige hôte, pays et
--      devise) et `RECEIVABLE_WRITE_OFF` (crédit, une écriture par décision FINANCE à deux
--      personnes, rattachée au règlement de la créance) ; les uniques d'idempotence de 0139 sont
--      recréées sous leur nom avec les nouvelles références ;
--   2. INVARIANT DE COMPENSATION (L3-PM-42) : un crédit n'est jamais écrit au-delà de la dette de
--      (hôte, devise) — Σ crédits ≤ Σ débits, donc Σ compensé ≤ dette —, contrôlé à l'insertion
--      sous le verrou consultatif `payout.netting:{hôte}:{devise}` d'US-708 (0165) : un seul
--      écrivain de la compensation, aucune autre sérialisation ; jamais entre devises ni entre
--      comptes d'hôte ; le `host_ledger` ne porte aucune dette du voyageur (le double
--      remboursement d'un chargeback est une créance `guest_receivable` de l'imputation, jamais une
--      écriture de l'hôte : N-88, ADR-110 n° 7) ;
--   3. `core.settlement_host_ledger_state` (SM-6b, 17 §3.2.8) : projection par (hôte, devise) —
--      `BALANCED`, `NEGATIVE`, `WRITTEN_OFF` —, solde, avances ouvertes, `since`, `next_action_at`
--      (30 j, 17 §3.2.8) ; écrite par un déclencheur de chaque écriture et de chaque avance, et
--      rien d'autre. `DIRECT_DEBIT`, `PAYMENT_PLAN` et `COLLECTIONS` ne sont pas construits (aucun
--      rail de prélèvement en bêta) : un solde négatif reste `NEGATIVE`, compensé sur les gains
--      suivants ; l'événement `host_ledger.state_changed` est renvoyé (aucun consommateur) ;
--   4. IMPUTATION D'UN CHARGEBACK PERDU (critères 1 et 2 ; N-402) : `core.settlement_cmd_impute_
--      chargeback(uuid)`, appelée par le déclencheur de 0155 quand un CHARGEBACK devient
--      SUCCEEDED (fonds repris par la banque), sous `payment_command` ou `webhook_ingest` ; formule
--      cumulative de 08 E5 recalculée en base sur ses propres faits (encaissé, remboursements
--      appliqués, retenue du règlement en tête, part de l'hôte, versé par les lots émis, reprises
--      passées) : reprise `max(0, versé − payable après)`, 0 sur un trip réalisé (EC-31) ;
--      jambes de E7 règle 7 (`HOST` = − reprise, `INSURER` = `TAX_THIRD_PARTY` = 0, `PLATFORM` =
--      le reste), double remboursement en `guest_receivable`, perte en `chargeback_loss_expense`,
--      tout dans la devise du trip (montant du chargeback dans la devise du trip, sinon refus
--      `CURRENCY_MISMATCH`). Une imputation par chargeback (clé primaire, RT-L3-V08). Faits
--      incomplets (remboursement en vol ou bloqué, T67 : renvoyé), devise différente, montant
--      au-delà de l'encaissé, faits incohérents ⇒ RIEN n'est écrit, le gel reste, le contrôle FIN
--      `CHARGEBACK_UNIMPUTED` le signale (fail-closed) ;
--   5. GEL ET DÉGEL (N-415, L3-PM-40) : un chargeback ouvert gèle les jambes `HOST` et `INSURER`
--      du trip (08 E7 règle 7 : part assureur exclue du bordereau) ; décidé — gagné (`FAILED`) ou
--      perdu et imputé —, et aucun autre chargeback ouvert sur le trip ⇒ dégel des deux jambes
--      par la base elle-même ; la garde de 0155 ne laisse lever QUE ce gel-là, dans ce cas-là (un
--      gel de litige ou de réclamation ne se lève toujours pas) ; le motif de retenue `CHARGEBACK`
--      d'un lot ne compte que les chargebacks ouverts ; le contrôle FIN compte une imputation ;
--   6. COMPENSATION (critère 3) : `core.payout_refresh_batch` (0165) écrit la compensation d'un lot
--      au grand livre (`PAYOUT_NETTING`, montant compensé du lot) quand le lot est compensé
--      (READY / ZERO_NET), puis l'impute aux avances de Kmino ouvertes de l'hôte dans la devise,
--      les plus anciennes d'abord (`recovered_minor`, `RECOVERING` / `RECOVERED`), lues par l'hôte
--      dans `host_advance_v` (RLS-26, sans identifiant du personnel) ; la dette compensable est le
--      solde négatif du grand livre (les compensations passées y sont déjà) ;
--   7. AJUSTEMENT DE VERSEMENT (`adjustPayout`, 08 E7 règle 7) : la part compensée d'un lot est
--      reprise chez le PSP AVANT le versement (`core.payout_cmd_adjustment`, clé
--      `adjust:{lot}:r1`, montant compensé explicite, puis `core.payout_cmd_record_adjustment`) ;
--      aucune émission (`INITIATED`) d'un lot compensé sans ajustement réussi, par aucun rôle ;
--      `SUPPORTS_PAYOUT_ADJUSTMENT` et `SUPPORTS_NEGATIVE_BALANCE_RECOVERY` sont des capacités
--      bloquantes (0039) : inconnues ⇒ `HOST_PAYOUT_RAIL_UNAVAILABLE`, rien n'est envoyé ;
--   8. PASSAGE EN PERTE (`WRITE_OFF_RECEIVABLE`, 17 §2.9 règle 4) : la décision FINANCE à deux
--      personnes de 0036 / 0123 / 0156 (inchangée : seul chemin, aucun passage automatique) passe
--      l'avance `WRITTEN_OFF` ; la base écrit alors le crédit `RECEIVABLE_WRITE_OFF` du reste dû,
--      dans la devise de la créance, rattaché à la décision. `host_receivable_writeoff_days` (180 j,
--      valeur de test) n'est pas une garde de la base : 17 §2.9 admet aussi l'épuisement de SM-6b,
--      jugé par les deux personnes de FINANCE (PROPOSÉ, ADR-187).
--
-- Aucun interrupteur n'est lu autrement qu'avant (0165) ni écrit ; aucune constante de pays ;
-- heure de la base (`platform.now()`) ; argent en `bigint` d'unités mineures, division entière
-- vers −∞ sur des valeurs ≥ 0 (`div`), aucun prorata.
--
-- Codes (packages/db/src/errors.ts) :
--   host_ledger_credit_exceeds_debt (23000)      → INVARIANT_VIOLATION ;
--   host_ledger_link_shape (23514)               → INVARIANT_VIOLATION ;
--   host_ledger_clawback_unique, host_ledger_netting_unique, host_ledger_write_off_unique (23505)
--                                                 → INVARIANT_VIOLATION ;
--   chargeback_imputation_shape (23514)           → INVARIANT_VIOLATION ;
--   payout_batch_adjustment_required (55000)     → INVALID_TRANSITION ;
--   payout_batch_adjustment_guard (23000)         → INVARIANT_VIOLATION.
--
-- Expand / contract : colonnes facultatives, tables, fonctions, déclencheurs, droits et politiques
-- AJOUTÉS ; CHECK du motif ÉLARGI, colonnes de rattachement au règlement rendues facultatives
-- (toute écriture existante garde ses valeurs ; la forme est fixée par `host_ledger_link_shape`) ;
-- deux uniques recréées sous leur nom ; six fonctions REMPLACÉES à signature, propriétaire et
-- droits identiques (garde des soldes de 0155, déclencheur du gel de 0155, faits FIN de 0155,
-- motifs de retenue et compensation de 0165) ; une politique ÉLARGIE sous son nom (gel de 0155 à
-- la jambe INSURER, ADR-081).
--
-- Retour arrière (base sans dépendance ; jamais en production : nouvelle migration à la place) :
--   rejouer core.settlement_trip_leg_balance_guard, core.settlement_freeze_host_on_chargeback,
--     core.finance_chargeback_facts (0155), core.payout_batch_hold_reasons,
--     core.payout_refresh_batch (0165) ;
--   ALTER POLICY cmd_money_chargeback_freeze (0155) ;
--   DROP TRIGGER host_ledger_credit_guard, host_ledger_state_projected ON core.settlement_host_ledger_entry ;
--   DROP TRIGGER advance_ledger_projected ON core.settlement_platform_advance ;
--   DROP TRIGGER payout_batch_adjustment_guard ON core.payout_payout_batch ;
--   DROP FUNCTION core.settlement_cmd_impute_chargeback(uuid), core.settlement_release_chargeback_freeze(uuid),
--     core.settlement_trip_chargeback_open(uuid), core.settlement_refresh_host_ledger_state(uuid, text),
--     core.settlement_host_ledger_credit_guard(), core.settlement_host_ledger_state_projected(),
--     core.settlement_advance_ledger_projected(),
--     core.payout_payout_batch_adjustment_guard(), core.payout_cmd_adjustment(uuid),
--     core.payout_cmd_record_adjustment(uuid, text, text) ;
--   DROP POLICY cmd_money_chargeback_unfreeze ON core.settlement_trip_leg_balance ;
--   DROP POLICY cmd_money_ins_clawback, cmd_money_ins_netting, cmd_money_ins_write_off
--     ON core.settlement_host_ledger_entry ;
--   DROP TABLE core.settlement_chargeback_imputation, core.settlement_host_ledger_state ;
--   DELETE des écritures des trois nouveaux motifs (sous migrator, déclencheurs d'immuabilité
--     désactivés), puis recréer les contraintes de 0139 et les NOT NULL de 0129 ;
--   ALTER TABLE core.settlement_host_ledger_entry DROP COLUMN chargeback_operation_id,
--     DROP COLUMN payout_batch_id, DROP COLUMN write_off_approval_id ;
--   ALTER TABLE core.payout_payout_batch DROP COLUMN adjustment_status, DROP COLUMN adjustment_key,
--     DROP COLUMN adjustment_provider_ref, DROP CONSTRAINT payout_batch_ledger_scope_unique.

-- 1. host_ledger : motifs, rattachements et uniques -----------------------------------------------

-- portée complète d'un lot (hôte, pays, devise) : cible de la clé étrangère de la compensation
ALTER TABLE core.payout_payout_batch
  ADD CONSTRAINT payout_batch_ledger_scope_unique UNIQUE (id, org_id, country_code, currency);

ALTER TABLE core.settlement_host_ledger_entry
  ALTER COLUMN trip_id DROP NOT NULL,
  ALTER COLUMN segment_no DROP NOT NULL,
  ALTER COLUMN settlement_id DROP NOT NULL,
  ALTER COLUMN settlement_version DROP NOT NULL,
  ADD COLUMN chargeback_operation_id uuid
    CONSTRAINT host_ledger_chargeback_fk REFERENCES core.payment_payment_operation (id),
  ADD COLUMN payout_batch_id uuid,
  ADD COLUMN write_off_approval_id uuid
    CONSTRAINT host_ledger_write_off_fk REFERENCES core.settlement_finance_approval (id);

ALTER TABLE core.settlement_host_ledger_entry
  ADD CONSTRAINT host_ledger_netting_batch_fk
    FOREIGN KEY (payout_batch_id, org_id, country_code, currency)
    REFERENCES core.payout_payout_batch (id, org_id, country_code, currency);

ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_reason_valid,
  ADD CONSTRAINT host_ledger_reason_valid CHECK (reason IN
    ('HOST_CANCELLATION_PENALTY', 'RELEASED_LEG_ADVANCE', 'CHARGEBACK_CLAWBACK', 'PAYOUT_NETTING',
     'RECEIVABLE_WRITE_OFF'));

-- forme : la compensation cite son lot et aucun règlement ; toute autre écriture cite un règlement
-- complet ; la reprise cite son chargeback (débit) ; la perte cite sa décision FINANCE (crédit) ;
-- la compensation est un crédit
ALTER TABLE core.settlement_host_ledger_entry
  ADD CONSTRAINT host_ledger_link_shape CHECK (
    ((reason = 'PAYOUT_NETTING') = (payout_batch_id IS NOT NULL))
    AND ((reason = 'PAYOUT_NETTING') = (settlement_id IS NULL))
    AND ((settlement_id IS NULL) = (trip_id IS NULL))
    AND ((settlement_id IS NULL) = (segment_no IS NULL))
    AND ((settlement_id IS NULL) = (settlement_version IS NULL))
    AND ((reason = 'CHARGEBACK_CLAWBACK') = (chargeback_operation_id IS NOT NULL))
    AND ((reason = 'RECEIVABLE_WRITE_OFF') = (write_off_approval_id IS NOT NULL))
    AND (reason <> 'CHARGEBACK_CLAWBACK' OR amount_minor < 0)
    AND (reason NOT IN ('PAYOUT_NETTING', 'RECEIVABLE_WRITE_OFF') OR amount_minor > 0)),
  ADD CONSTRAINT host_ledger_clawback_unique UNIQUE (chargeback_operation_id),
  ADD CONSTRAINT host_ledger_netting_unique UNIQUE (payout_batch_id),
  ADD CONSTRAINT host_ledger_write_off_unique UNIQUE (write_off_approval_id);

-- idempotence de 0129 / 0139 : même nom, même sens pour les motifs existants (nouvelles références
-- NULL, NULLS NOT DISTINCT) ; plusieurs reprises (une par chargeback) et plusieurs compensations
-- (une par lot) ne se confondent pas
ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_entry_settlement_reason_unique,
  ADD CONSTRAINT host_ledger_entry_settlement_reason_unique
    UNIQUE NULLS NOT DISTINCT (settlement_id, reason, advance_id, chargeback_operation_id,
                               payout_batch_id, write_off_approval_id);
ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_entry_version_reason_unique,
  ADD CONSTRAINT host_ledger_entry_version_reason_unique
    UNIQUE NULLS NOT DISTINCT (trip_id, segment_no, settlement_version, reason, advance_id,
                               chargeback_operation_id, payout_batch_id, write_off_approval_id);

COMMENT ON COLUMN core.settlement_host_ledger_entry.chargeback_operation_id IS
  'Chargeback perdu dont l''écriture est la reprise sur l''hôte (08 E5) ; une par chargeback. US-709.';
COMMENT ON COLUMN core.settlement_host_ledger_entry.payout_batch_id IS
  'Lot de versement dont l''écriture est la compensation (NETTING, SM-6b) ; une par lot. US-709.';
COMMENT ON COLUMN core.settlement_host_ledger_entry.write_off_approval_id IS
  'Décision FINANCE à deux personnes (WRITE_OFF_RECEIVABLE) du passage en perte. US-709.';

-- 2. Invariant : un crédit ne dépasse jamais la dette de (hôte, devise) --------------------------
-- SECURITY INVOKER : lit sous la RLS de l'écrivain (cmd_money_owner, migrator). Verrou consultatif
-- de la compensation d'US-708 (même clé, même transaction : réentrant) : un seul écrivain.
CREATE FUNCTION core.settlement_host_ledger_credit_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_balance bigint;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
            'payout.netting:' || NEW.org_id::text || ':' || NEW.currency, 0));
  SELECT COALESCE(pg_catalog.sum(e.amount_minor), 0)::bigint INTO v_balance
    FROM core.settlement_host_ledger_entry AS e
   WHERE e.org_id = NEW.org_id AND e.currency = NEW.currency;
  IF v_balance + NEW.amount_minor > 0 THEN
    RAISE EXCEPTION 'host_ledger: crédit au-delà de la dette de l''hôte dans la devise %', NEW.currency
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'host_ledger_credit_exceeds_debt';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION core.settlement_host_ledger_credit_guard() IS
  'Garde du host_ledger : un crédit (compensation, passage en perte) n''excède jamais la dette de '
  '(hôte, devise), sous le verrou payout.netting:{hôte}:{devise} (US-708). US-709 (ADR-187).';
REVOKE ALL ON FUNCTION core.settlement_host_ledger_credit_guard() FROM PUBLIC;
CREATE TRIGGER host_ledger_credit_guard BEFORE INSERT ON core.settlement_host_ledger_entry
  FOR EACH ROW WHEN (NEW.amount_minor > 0)
  EXECUTE FUNCTION core.settlement_host_ledger_credit_guard();

-- 3. Imputation des chargebacks perdus (table) ----------------------------------------------------

CREATE TABLE core.settlement_chargeback_imputation (
  operation_id              uuid        NOT NULL
    CONSTRAINT settlement_chargeback_imputation_pkey PRIMARY KEY
    CONSTRAINT chargeback_imputation_operation_fk REFERENCES core.payment_payment_operation (id),
  trip_id                   uuid        NOT NULL,
  segment_no                integer     NOT NULL
    CONSTRAINT chargeback_imputation_segment_beta CHECK (segment_no = 1),
  org_id                    uuid        NOT NULL,
  country_code              text        NOT NULL
    CONSTRAINT chargeback_imputation_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- devise du trip (08 E5 : aucune écriture entre devises)
  currency                  text        NOT NULL
    CONSTRAINT chargeback_imputation_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  settlement_id             uuid,
  settlement_version        integer,
  -- CANCELLATION : gains d'annulation ou de no-show (reprise possible) ; REALIZED : trip réalisé
  -- ou sans règlement d'annulation, aucune reprise (EC-31)
  earnings_kind             text        NOT NULL
    CONSTRAINT chargeback_imputation_earnings_valid CHECK (earnings_kind IN ('CANCELLATION', 'REALIZED')),
  lost_trip_minor           bigint      NOT NULL,
  collected_before_minor    bigint      NOT NULL,
  refund_committed_minor    bigint      NOT NULL,
  owed_minor                bigint      NOT NULL,
  host_from_guest_minor     bigint      NOT NULL,
  host_paid_minor           bigint      NOT NULL,
  retained_before_minor     bigint      NOT NULL,
  retained_after_minor      bigint      NOT NULL,
  host_payable_after_minor  bigint      NOT NULL,
  clawback_minor            bigint      NOT NULL,
  host_unpaid_cancelled_minor bigint    NOT NULL,
  guest_receivable_minor    bigint      NOT NULL,
  loss_expense_minor        bigint      NOT NULL,
  -- jambes du chargeback (08 E7 règle 7), signées : Σ = − montant perdu
  host_leg_minor            bigint      NOT NULL,
  insurer_leg_minor         bigint      NOT NULL,
  tax_third_party_leg_minor bigint      NOT NULL,
  platform_leg_minor        bigint      NOT NULL,
  imputed_at                timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT chargeback_imputation_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  CONSTRAINT chargeback_imputation_settlement_fk FOREIGN KEY (settlement_id, trip_id, settlement_version)
    REFERENCES core.settlement_settlement (id, trip_id, version),
  CONSTRAINT chargeback_imputation_shape CHECK (
    lost_trip_minor > 0 AND collected_before_minor >= lost_trip_minor
    AND refund_committed_minor >= 0 AND owed_minor >= 0 AND host_from_guest_minor >= 0
    AND host_paid_minor >= 0 AND retained_before_minor >= retained_after_minor
    AND retained_after_minor >= 0 AND host_payable_after_minor >= 0
    AND clawback_minor >= 0 AND clawback_minor <= host_paid_minor
    AND host_unpaid_cancelled_minor >= 0 AND guest_receivable_minor >= 0 AND loss_expense_minor >= 0
    AND guest_receivable_minor + loss_expense_minor + clawback_minor + host_unpaid_cancelled_minor
        = lost_trip_minor
    AND host_leg_minor = -clawback_minor AND insurer_leg_minor = 0 AND tax_third_party_leg_minor = 0
    AND host_leg_minor + insurer_leg_minor + tax_third_party_leg_minor + platform_leg_minor
        = -lost_trip_minor
    AND (earnings_kind = 'CANCELLATION' OR (clawback_minor = 0 AND host_unpaid_cancelled_minor = 0))
    AND ((settlement_id IS NULL) = (settlement_version IS NULL))
    AND (earnings_kind <> 'CANCELLATION' OR settlement_id IS NOT NULL))
);
CREATE INDEX chargeback_imputation_trip_idx ON core.settlement_chargeback_imputation (trip_id);
COMMENT ON TABLE core.settlement_chargeback_imputation IS
  'Imputation d''un chargeback perdu (08 E5, E7 règle 7) : faits relus, reprise sur l''hôte, '
  'double remboursement (guest_receivable), perte de Kmino et jambes ; une par chargeback ; '
  'immuable. US-709 (ADR-187).';

CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON core.settlement_chargeback_imputation
  FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_chargeback_imputation
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable();

ALTER TABLE core.settlement_chargeback_imputation ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_chargeback_imputation FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.settlement_chargeback_imputation TO migrator
  USING (true) WITH CHECK (true);
REVOKE ALL ON core.settlement_chargeback_imputation FROM PUBLIC;
-- aucun identifiant du personnel ni référence PSP : FINANCE et ADMIN du pays (comme 0129)
GRANT SELECT ON core.settlement_chargeback_imputation TO app_api;
CREATE POLICY fin_read ON core.settlement_chargeback_imputation FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));
GRANT SELECT, INSERT ON core.settlement_chargeback_imputation TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.settlement_chargeback_imputation FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_ins ON core.settlement_chargeback_imputation FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('payment_command', 'webhook_ingest'));

-- 4. host_ledger_state (SM-6b) -------------------------------------------------------------------

CREATE TABLE core.settlement_host_ledger_state (
  org_id              uuid        NOT NULL,
  currency            text        NOT NULL
    CONSTRAINT host_ledger_state_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  country_code        text        NOT NULL
    CONSTRAINT host_ledger_state_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  state               text        NOT NULL
    CONSTRAINT host_ledger_state_valid CHECK (state IN
      ('BALANCED', 'NEGATIVE', 'DIRECT_DEBIT', 'PAYMENT_PLAN', 'COLLECTIONS', 'WRITTEN_OFF')),
  -- projection du host_ledger (Σ des écritures, jamais > 0 : garde de la section 2)
  balance_minor       bigint      NOT NULL
    CONSTRAINT host_ledger_state_balance_nonpositive CHECK (balance_minor <= 0),
  -- Σ des avances de Kmino ouvertes de l'hôte (plafond host_advance_cap_minor, 17 §2.9)
  open_advances_minor bigint      NOT NULL
    CONSTRAINT host_ledger_state_advances_nonneg CHECK (open_advances_minor >= 0),
  since               timestamptz NOT NULL,
  next_action_at      timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT platform.now(),
  row_version         integer     NOT NULL DEFAULT 0,
  CONSTRAINT settlement_host_ledger_state_pkey PRIMARY KEY (org_id, currency),
  CONSTRAINT host_ledger_state_org_country_fk FOREIGN KEY (org_id, country_code)
    REFERENCES core.iam_organization (id, country_code),
  CONSTRAINT host_ledger_state_shape CHECK (
    (state = 'NEGATIVE') = (balance_minor < 0) AND ((state = 'NEGATIVE') = (next_action_at IS NOT NULL)))
);
COMMENT ON TABLE core.settlement_host_ledger_state IS
  'host_ledger_state (SM-6b, 17 §3.2.8) : état du solde de l''hôte par (compte d''hôte, devise), '
  'projeté de chaque écriture du host_ledger et de chaque avance ; aucune compensation entre '
  'devises. US-709 (ADR-187).';

CREATE TRIGGER money_no_delete BEFORE DELETE ON core.settlement_host_ledger_state
  FOR EACH ROW EXECUTE FUNCTION core.settlement_no_delete();
CREATE TRIGGER money_no_truncate BEFORE TRUNCATE ON core.settlement_host_ledger_state
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_no_delete();

ALTER TABLE core.settlement_host_ledger_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_host_ledger_state FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.settlement_host_ledger_state TO migrator
  USING (true) WITH CHECK (true);
REVOKE ALL ON core.settlement_host_ledger_state FROM PUBLIC;
GRANT SELECT ON core.settlement_host_ledger_state TO app_api;
CREATE POLICY fin_read ON core.settlement_host_ledger_state FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));
-- un seul écrivain : la fonction de projection ci-dessous (aucun EXECUTE), appelée par les
-- déclencheurs de chaque écrivain du host_ledger et des avances, dans le contexte de celui-ci
GRANT SELECT, INSERT ON core.settlement_host_ledger_state TO cmd_money_owner;
GRANT UPDATE (state, balance_minor, open_advances_minor, since, next_action_at, updated_at,
              row_version)
  ON core.settlement_host_ledger_state TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.settlement_host_ledger_state FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_ins ON core.settlement_host_ledger_state FOR INSERT TO cmd_money_owner
  WITH CHECK (true);
CREATE POLICY cmd_money_upd ON core.settlement_host_ledger_state FOR UPDATE TO cmd_money_owner
  USING (true) WITH CHECK (true);

-- 5. Écritures de cmd_money_owner sur le host_ledger ---------------------------------------------

GRANT SELECT (chargeback_operation_id, payout_batch_id, write_off_approval_id)
  ON core.settlement_host_ledger_entry TO app_api;
GRANT INSERT (chargeback_operation_id, payout_batch_id, write_off_approval_id)
  ON core.settlement_host_ledger_entry TO cmd_money_owner;
-- reprise d'un chargeback perdu (imputation, déclencheur du statut du chargeback)
CREATE POLICY cmd_money_ins_clawback ON core.settlement_host_ledger_entry FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('payment_command', 'webhook_ingest')
              AND reason = 'CHARGEBACK_CLAWBACK' AND amount_minor < 0
              AND chargeback_operation_id IS NOT NULL);
-- compensation d'un lot (compensation à l'échéance, travailleur payment_command)
CREATE POLICY cmd_money_ins_netting ON core.settlement_host_ledger_entry FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND reason = 'PAYOUT_NETTING' AND amount_minor > 0 AND payout_batch_id IS NOT NULL);
-- passage en perte (approbation FINANCE à deux personnes, staff du pays)
CREATE POLICY cmd_money_ins_write_off ON core.settlement_host_ledger_entry FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
              AND reason = 'RECEIVABLE_WRITE_OFF' AND amount_minor > 0
              AND write_off_approval_id IS NOT NULL);

-- 6. Ajustement de versement : colonnes et garde -------------------------------------------------

ALTER TABLE core.payout_payout_batch
  ADD COLUMN adjustment_status text
    CONSTRAINT payout_batch_adjustment_status_valid CHECK (adjustment_status IN
      ('SUBMITTED', 'SUCCEEDED', 'FAILED')),
  ADD COLUMN adjustment_key text
    CONSTRAINT payout_batch_adjustment_key_unique UNIQUE
    CONSTRAINT payout_batch_adjustment_key_format CHECK (adjustment_key ~ '^adjust:[0-9a-f-]{36}:r1$'),
  ADD COLUMN adjustment_provider_ref text
    CONSTRAINT payout_batch_adjustment_ref_format CHECK (adjustment_provider_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  ADD CONSTRAINT payout_batch_adjustment_shape CHECK (
    (adjustment_status IS NULL) = (adjustment_key IS NULL)
    AND (adjustment_status IS NULL OR (netted_minor > 0 AND netted_at IS NOT NULL)));
COMMENT ON COLUMN core.payout_payout_batch.adjustment_status IS
  'Ajustement de versement (adjustPayout) de la part compensée, avant le versement : SUBMITTED, '
  'SUCCEEDED, FAILED ; NULL sans compensation. US-709 (ADR-187).';

-- Aucune émission d'un lot compensé sans ajustement réussi (tout rôle) ; l'ajustement ne se
-- rejoue pas autrement (clé fixe, état final figé).
CREATE FUNCTION core.payout_payout_batch_adjustment_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF (OLD.adjustment_key IS NOT NULL AND NEW.adjustment_key IS DISTINCT FROM OLD.adjustment_key)
     OR (OLD.adjustment_status IN ('SUCCEEDED', 'FAILED')
         AND (NEW.adjustment_status, NEW.adjustment_provider_ref)
             IS DISTINCT FROM (OLD.adjustment_status, OLD.adjustment_provider_ref))
     OR (OLD.adjustment_status = 'SUBMITTED' AND NEW.adjustment_status IS NULL) THEN
    RAISE EXCEPTION 'payout_batch: adjustment is written once'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payout_batch_adjustment_guard';
  END IF;
  IF NEW.status = 'INITIATED' AND OLD.status IS DISTINCT FROM 'INITIATED'
     AND NEW.netted_minor > 0 AND NEW.adjustment_status IS DISTINCT FROM 'SUCCEEDED' THEN
    RAISE EXCEPTION 'payout_batch: the netted part is adjusted before the payout'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'payout_batch_adjustment_required';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payout_payout_batch_adjustment_guard() FROM PUBLIC;
CREATE TRIGGER payout_batch_adjustment_guard BEFORE UPDATE ON core.payout_payout_batch
  FOR EACH ROW EXECUTE FUNCTION core.payout_payout_batch_adjustment_guard();

GRANT UPDATE (adjustment_status, adjustment_key, adjustment_provider_ref)
  ON core.payout_payout_batch TO cmd_money_owner;

-- 7. Chargeback ouvert ou décidé : prédicat, garde des soldes, politiques ------------------------

-- Un chargeback est OUVERT tant qu'il n'est ni gagné / rejeté (FAILED) ni perdu ET imputé.
-- SECURITY INVOKER (cmd_money_owner, migrator : leurs politiques de lecture).
CREATE FUNCTION core.settlement_trip_chargeback_open(p_trip_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                  WHERE o.trip_id = p_trip_id AND o.kind = 'CHARGEBACK' AND o.status <> 'FAILED'
                    AND NOT EXISTS (SELECT 1 FROM core.settlement_chargeback_imputation AS i
                                     WHERE i.operation_id = o.id))
$fn$;
COMMENT ON FUNCTION core.settlement_trip_chargeback_open(uuid) IS
  'Vrai si un chargeback du trip n''est pas décidé (ni FAILED, ni perdu et imputé). US-709 (ADR-187).';
REVOKE ALL ON FUNCTION core.settlement_trip_chargeback_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.settlement_trip_chargeback_open(uuid) TO cmd_money_owner;

-- Garde des soldes (corps de 0155 recopié, propriétaire migrator ; la règle du gel change) : un gel
-- ne se lève ni ne se requalifie jamais, SAUF le gel CHARGEBACK des jambes HOST et INSURER d'un
-- trip dont aucun chargeback n'est plus ouvert (gagné, ou perdu et imputé : N-415, 08 E7 règle 7).
CREATE OR REPLACE FUNCTION core.settlement_trip_leg_balance_guard()
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
  -- US-222d (F-L2-ARG-04), US-709 (N-415) : un gel n'est jamais requalifié ; seul le gel
  -- CHARGEBACK de HOST / INSURER se lève, et seulement quand aucun chargeback du trip n'est ouvert
  IF OLD.frozen AND (NOT NEW.frozen OR NEW.frozen_reason IS DISTINCT FROM OLD.frozen_reason)
     AND NOT (OLD.frozen_reason = 'CHARGEBACK' AND OLD.leg IN ('HOST', 'INSURER')
              AND NOT NEW.frozen AND NEW.frozen_reason IS NULL
              AND NOT core.settlement_trip_chargeback_open(OLD.trip_id)) THEN
    RAISE EXCEPTION 'trip_leg_balance: un gel n''est levé que par la décision du chargeback'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'trip_leg_balance_freeze_forbidden';
  END IF;
  RETURN NEW;
END
$fn$;

-- gel à l'ouverture : HOST et INSURER (08 E7 règle 7 ; même nom de politique, ADR-081)
ALTER POLICY cmd_money_chargeback_freeze ON core.settlement_trip_leg_balance
  USING (leg IN ('HOST', 'INSURER') AND NOT frozen)
  WITH CHECK (leg IN ('HOST', 'INSURER') AND frozen AND frozen_reason = 'CHARGEBACK'
              AND EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                           WHERE o.trip_id = settlement_trip_leg_balance.trip_id
                             AND o.kind = 'CHARGEBACK' AND o.status <> 'FAILED'));
-- dégel à la décision : la garde ci-dessus exige qu'aucun chargeback du trip ne soit ouvert
CREATE POLICY cmd_money_chargeback_unfreeze ON core.settlement_trip_leg_balance FOR UPDATE
  TO cmd_money_owner
  USING (leg IN ('HOST', 'INSURER') AND frozen AND frozen_reason = 'CHARGEBACK')
  WITH CHECK (leg IN ('HOST', 'INSURER') AND NOT frozen AND frozen_reason IS NULL);

-- 8. Fonctions de cmd_money_owner ----------------------------------------------------------------

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 8.1 Projection SM-6b de (hôte, devise) : solde, avances ouvertes, état (seul écrivain)
CREATE FUNCTION core.settlement_refresh_host_ledger_state(p_org_id uuid, p_currency text)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_country text;
  v_balance bigint;
  v_open    bigint;
  v_last    text;
  v_state   text;
  v_now     timestamptz := platform.now();
BEGIN
  SELECT e.country_code INTO v_country
    FROM core.settlement_host_ledger_entry AS e
   WHERE e.org_id = p_org_id AND e.currency = p_currency
   LIMIT 1;
  IF v_country IS NULL THEN
    SELECT a.country_code INTO v_country
      FROM core.settlement_platform_advance AS a
     WHERE a.org_id = p_org_id AND a.currency = p_currency
     LIMIT 1;
  END IF;
  IF v_country IS NULL THEN
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.sum(e.amount_minor), 0)::bigint INTO v_balance
    FROM core.settlement_host_ledger_entry AS e
   WHERE e.org_id = p_org_id AND e.currency = p_currency;
  SELECT e.reason INTO v_last
    FROM core.settlement_host_ledger_entry AS e
   WHERE e.org_id = p_org_id AND e.currency = p_currency
   ORDER BY e.created_at DESC, e.id DESC
   LIMIT 1;
  SELECT COALESCE(pg_catalog.sum(a.receivable_minor - a.recovered_minor), 0)::bigint INTO v_open
    FROM core.settlement_platform_advance AS a
   WHERE a.org_id = p_org_id AND a.currency = p_currency AND a.cause = 'RELEASED_LEG'
     AND a.status IN ('OPEN', 'RECOVERING');
  v_state := CASE WHEN v_balance < 0 THEN 'NEGATIVE'
                  WHEN v_last = 'RECEIVABLE_WRITE_OFF' THEN 'WRITTEN_OFF'
                  ELSE 'BALANCED' END;
  INSERT INTO core.settlement_host_ledger_state AS x
         (org_id, currency, country_code, state, balance_minor, open_advances_minor, since,
          next_action_at)
  VALUES (p_org_id, p_currency, v_country, v_state, v_balance, v_open, v_now,
          CASE WHEN v_state = 'NEGATIVE' THEN v_now + interval '30 days' END)
  ON CONFLICT ON CONSTRAINT settlement_host_ledger_state_pkey DO UPDATE
     SET state = EXCLUDED.state, balance_minor = EXCLUDED.balance_minor,
         open_advances_minor = EXCLUDED.open_advances_minor,
         since = CASE WHEN x.state = EXCLUDED.state THEN x.since ELSE EXCLUDED.since END,
         next_action_at = CASE WHEN EXCLUDED.state <> 'NEGATIVE' THEN NULL
                               WHEN x.state = 'NEGATIVE' THEN x.next_action_at
                               ELSE EXCLUDED.next_action_at END,
         updated_at = v_now, row_version = x.row_version + 1
   WHERE (x.state, x.balance_minor, x.open_advances_minor)
         IS DISTINCT FROM (EXCLUDED.state, EXCLUDED.balance_minor, EXCLUDED.open_advances_minor);
END
$fn$;
COMMENT ON FUNCTION core.settlement_refresh_host_ledger_state(uuid, text) IS
  'Projection SM-6b de (compte d''hôte, devise) : solde du host_ledger, avances ouvertes, état '
  '(BALANCED, NEGATIVE, WRITTEN_OFF). Appelée par les déclencheurs seulement (aucun EXECUTE). '
  'US-709 (ADR-187).';
REVOKE ALL ON FUNCTION core.settlement_refresh_host_ledger_state(uuid, text) FROM PUBLIC;

-- 8.2 Dégel des jambes HOST et INSURER d'un trip dont aucun chargeback n'est plus ouvert
CREATE FUNCTION core.settlement_release_chargeback_freeze(p_trip_id uuid)
  RETURNS integer
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  IF core.settlement_trip_chargeback_open(p_trip_id) THEN
    RETURN 0;
  END IF;
  UPDATE core.settlement_trip_leg_balance AS b
     SET frozen = false, frozen_reason = NULL
   WHERE b.trip_id = p_trip_id AND b.segment_no = 1 AND b.leg IN ('HOST', 'INSURER')
     AND b.frozen AND b.frozen_reason = 'CHARGEBACK';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$fn$;
COMMENT ON FUNCTION core.settlement_release_chargeback_freeze(uuid) IS
  'Dégel des jambes HOST et INSURER (gel CHARGEBACK) d''un trip dont aucun chargeback n''est plus '
  'ouvert (08 E7 règle 7 : gagné, ou perdu et imputé). Aucun EXECUTE. US-709 (ADR-187).';
REVOKE ALL ON FUNCTION core.settlement_release_chargeback_freeze(uuid) FROM PUBLIC;

-- 8.3 Imputation d'un chargeback perdu (08 E5, E7 règle 7 ; critères 1 et 2). Faits relus en base,
-- jamais reçus : encaissé (captures, débits MIT, dettes RENT moins les pertes déjà imputées),
-- remboursements appliqués aux soldes, règlement en tête, versé par les lots émis, reprises passées.
-- Issues : IMPUTED, ALREADY_IMPUTED, NOT_A_CHARGEBACK, NOT_LOST, CURRENCY_MISMATCH,
-- REFUND_IN_FLIGHT, LOST_EXCEEDS_COLLECTED, FIN_REVIEW_REQUIRED (rien n'est écrit sauf IMPUTED).
CREATE FUNCTION core.settlement_cmd_impute_chargeback(p_operation_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  o           record;
  t           record;
  s           record;
  v_collected bigint;
  v_lost_prev bigint;
  v_committed bigint;
  v_owed      bigint;
  v_cancel    boolean;
  v_hfg       bigint := 0;
  v_items     bigint := 0;
  v_clawed    bigint := 0;
  v_paid      bigint := 0;
  v_rb        bigint;
  v_ra        bigint;
  v_pb        bigint;
  v_pa        bigint;
  v_claw      bigint := 0;
  v_unpaid    bigint := 0;
  v_lost_ret  bigint;
  v_guest     bigint;
  v_loss      bigint;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR COALESCE(app.worker_name() NOT IN ('payment_command', 'webhook_ingest'), true) THEN
    RAISE EXCEPTION 'host_ledger: imputation réservée aux travailleurs du paiement'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'host_ledger_command_forbidden';
  END IF;
  SELECT x.id, x.trip_id, x.kind, x.status, x.amount_minor, x.currency INTO o
    FROM core.payment_payment_operation AS x WHERE x.id = p_operation_id;
  IF o.id IS NULL OR o.kind IS DISTINCT FROM 'CHARGEBACK' OR o.trip_id IS NULL THEN
    RETURN 'NOT_A_CHARGEBACK';
  END IF;
  IF o.status IS DISTINCT FROM 'SUCCEEDED' THEN
    RETURN 'NOT_LOST';
  END IF;
  -- une imputation à la fois par trip (verrou du trip, comme les commandes d'argent de 0027)
  SELECT x.id, x.org_id, x.country_code, x.currency INTO t
    FROM core.booking_trip AS x WHERE x.id = o.trip_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM core.settlement_chargeback_imputation AS i WHERE i.operation_id = o.id) THEN
    RETURN 'ALREADY_IMPUTED';
  END IF;
  -- 08 E5 : tout est dans la devise du trip ; jamais d'écriture entre devises
  IF o.currency IS DISTINCT FROM t.currency THEN
    RETURN 'CURRENCY_MISMATCH';
  END IF;
  -- remboursement en vol, bloqué ou non reporté : faits incomplets (T67 : renvoyé), revue FIN
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation AS x
              WHERE x.trip_id = o.trip_id AND x.kind IN ('REFUND', 'CREDIT_REISSUE')
                AND (x.status NOT IN ('SUCCEEDED', 'FAILED')
                     OR (x.status = 'SUCCEEDED'
                         AND NOT EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m
                                          WHERE m.operation_id = x.id))))
     OR EXISTS (SELECT 1 FROM core.payment_refund_instance AS ri
                 WHERE ri.trip_id = o.trip_id
                   AND ri.status IN ('PLANNED', 'BLOCKED_CHARGEBACK', 'PENDING_CUSTOMER_CHOICE',
                                     'PENDING_BANK_DETAILS', 'SUBMITTED', 'FAILED')) THEN
    RETURN 'REFUND_IN_FLIGHT';
  END IF;
  SELECT COALESCE(pg_catalog.sum(x.amount_minor), 0)::bigint INTO v_collected
    FROM core.payment_payment_operation AS x
   WHERE x.trip_id = o.trip_id AND x.status = 'SUCCEEDED'
     AND x.kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
     AND x.purpose IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION');
  SELECT COALESCE(pg_catalog.sum(i.lost_trip_minor), 0)::bigint INTO v_lost_prev
    FROM core.settlement_chargeback_imputation AS i WHERE i.trip_id = o.trip_id;
  v_collected := v_collected - v_lost_prev;
  IF o.amount_minor > v_collected THEN
    RETURN 'LOST_EXCEEDS_COLLECTED';
  END IF;
  SELECT COALESCE(pg_catalog.sum(b.refunded_minor), 0)::bigint INTO v_committed
    FROM core.settlement_trip_leg_balance AS b
   WHERE b.trip_id = o.trip_id AND b.segment_no = 1;
  SELECT x.id, x.version, x.kind, x.total_paid_minor, x.guest_refund_minor,
         x.host_from_guest_minor, x.org_id, x.country_code, x.currency INTO s
    FROM core.settlement_settlement AS x
   WHERE x.trip_id = o.trip_id AND x.segment_no = 1
     AND NOT EXISTS (SELECT 1 FROM core.settlement_settlement AS n WHERE n.supersedes_id = x.id);
  v_cancel := COALESCE(s.kind = 'CANCELLATION', false);
  v_owed := CASE WHEN s.id IS NOT NULL THEN s.total_paid_minor - s.guest_refund_minor
                 ELSE GREATEST(0, v_collected - v_committed) END;
  IF v_cancel THEN
    v_hfg := s.host_from_guest_minor;
    -- versé : jambe HOST des lots ÉMIS (INITIATED, IN_TRANSIT, PAID), nette des reprises passées
    SELECT COALESCE(pg_catalog.sum(i.amount_minor), 0)::bigint INTO v_items
      FROM core.payout_payout_item AS i
      JOIN core.payout_payout_batch AS x ON x.id = i.batch_id
     WHERE i.trip_id = o.trip_id AND i.segment_no = 1 AND i.leg = 'HOST'
       AND x.status IN ('INITIATED', 'IN_TRANSIT', 'PAID');
    SELECT COALESCE(-pg_catalog.sum(e.amount_minor), 0)::bigint INTO v_clawed
      FROM core.settlement_host_ledger_entry AS e
     WHERE e.trip_id = o.trip_id AND e.reason = 'CHARGEBACK_CLAWBACK';
    v_paid := GREATEST(0, LEAST(v_hfg, v_items) - v_clawed);
  END IF;
  -- formule cumulative de 08 E5 (valeurs ≥ 0 : div = floor)
  v_rb := LEAST(GREATEST(v_collected - v_committed, 0), v_owed);
  v_ra := LEAST(GREATEST(v_collected - o.amount_minor - v_committed, 0), v_owed);
  v_pb := CASE WHEN v_owed = 0 THEN 0
               ELSE pg_catalog.div(v_hfg::numeric * v_rb, v_owed::numeric)::bigint END;
  v_pa := CASE WHEN v_owed = 0 THEN 0
               ELSE pg_catalog.div(v_hfg::numeric * v_ra, v_owed::numeric)::bigint END;
  IF v_cancel THEN
    v_claw := GREATEST(0, v_paid - v_pa);
    v_unpaid := GREATEST(0, v_pb - v_paid) - GREATEST(0, v_pa - v_paid);
  END IF;
  v_lost_ret := v_rb - v_ra;
  v_guest := o.amount_minor - v_lost_ret;
  v_loss := v_lost_ret - v_claw - v_unpaid;
  IF v_guest < 0 OR v_loss < 0 OR (v_cancel AND v_hfg > v_owed) THEN
    RETURN 'FIN_REVIEW_REQUIRED';
  END IF;
  INSERT INTO core.settlement_chargeback_imputation
         (operation_id, trip_id, segment_no, org_id, country_code, currency, settlement_id,
          settlement_version, earnings_kind, lost_trip_minor, collected_before_minor,
          refund_committed_minor, owed_minor, host_from_guest_minor, host_paid_minor,
          retained_before_minor, retained_after_minor, host_payable_after_minor, clawback_minor,
          host_unpaid_cancelled_minor, guest_receivable_minor, loss_expense_minor, host_leg_minor,
          insurer_leg_minor, tax_third_party_leg_minor, platform_leg_minor)
  VALUES (o.id, o.trip_id, 1, t.org_id, t.country_code, t.currency, s.id, s.version,
          CASE WHEN v_cancel THEN 'CANCELLATION' ELSE 'REALIZED' END, o.amount_minor, v_collected,
          v_committed, v_owed, v_hfg, v_paid, v_rb, v_ra, v_pa, v_claw, v_unpaid, v_guest, v_loss,
          -v_claw, 0, 0, -(o.amount_minor - v_claw));
  -- reprise au host_ledger[hôte][devise du trip] seulement, rattachée au règlement d'annulation
  IF v_claw > 0 THEN
    INSERT INTO core.settlement_host_ledger_entry
           (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
            settlement_version, reason, amount_minor, chargeback_operation_id)
    VALUES (pg_catalog.gen_random_uuid(), s.org_id, s.country_code, s.currency, o.trip_id, 1, s.id,
            s.version, 'CHARGEBACK_CLAWBACK', -v_claw, o.id);
  END IF;
  PERFORM core.settlement_release_chargeback_freeze(o.trip_id);
  RETURN 'IMPUTED';
END
$fn$;
COMMENT ON FUNCTION core.settlement_cmd_impute_chargeback(uuid) IS
  'Imputation d''un chargeback perdu (08 E5, E7 règle 7) : reprise max(0, versé − payable après) '
  'au host_ledger de la devise du trip (0 sur un trip réalisé), double remboursement et perte de '
  'Kmino, jambes ; une par chargeback ; faits incomplets ⇒ rien. Appelée par le déclencheur du '
  'statut du chargeback (aucun EXECUTE). US-709 (ADR-187).';
REVOKE ALL ON FUNCTION core.settlement_cmd_impute_chargeback(uuid) FROM PUBLIC;

-- 8.4 Déclencheur du chargeback (0155, même signature et propriétaire) : ouvert ⇒ gel HOST et
-- INSURER ; perdu (SUCCEEDED) ⇒ gel puis imputation (qui dégèle) ; gagné / rejeté (FAILED) ⇒ dégel
-- si aucun autre chargeback du trip n'est ouvert.
CREATE OR REPLACE FUNCTION core.settlement_freeze_host_on_chargeback()
  RETURNS trigger
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.kind IS DISTINCT FROM 'CHARGEBACK' OR NEW.trip_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'FAILED' THEN
    PERFORM core.settlement_release_chargeback_freeze(NEW.trip_id);
    RETURN NULL;
  END IF;
  UPDATE core.settlement_trip_leg_balance AS b
     SET frozen = true, frozen_reason = 'CHARGEBACK'
   WHERE b.trip_id = NEW.trip_id AND b.segment_no = 1 AND b.leg IN ('HOST', 'INSURER')
     AND NOT b.frozen;
  IF NEW.status = 'SUCCEEDED' AND app.actor_kind() = 'WORKER'
     AND app.worker_name() IN ('payment_command', 'webhook_ingest') THEN
    PERFORM core.settlement_cmd_impute_chargeback(NEW.id);
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_freeze_host_on_chargeback() IS
  'Déclencheur du chargeback : ouvert ⇒ gel des jambes HOST et INSURER (CHARGEBACK ; 08 E7 règle '
  '7) ; perdu ⇒ imputation (US-709) ; gagné ⇒ dégel, si aucun autre chargeback du trip n''est '
  'ouvert. SECURITY DEFINER sous cmd_money_owner, aucun EXECUTE. US-222d (ADR-176), US-709 (ADR-187).';

-- 8.5 Faits du contrôle FIN CHARGEBACK_UNIMPUTED (0155, même signature) : imputé = une imputation
-- (US-709) ou un mouvement de jambe ; le contrôle est conservé, jamais neutralisé (L3-PM-40)
CREATE OR REPLACE FUNCTION core.finance_chargeback_facts()
  RETURNS TABLE (country_code text, imputed boolean, host_frozen boolean)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'reconciliation' THEN
    RAISE EXCEPTION 'finance: chargeback facts are read by the reconciliation worker only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  SELECT o.country_code,
         (EXISTS (SELECT 1 FROM core.settlement_chargeback_imputation AS i WHERE i.operation_id = o.id)
          OR EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m WHERE m.operation_id = o.id)),
         COALESCE((SELECT b.frozen FROM core.settlement_trip_leg_balance AS b
                    WHERE b.trip_id = o.trip_id AND b.segment_no = 1 AND b.leg = 'HOST'), false)
    FROM core.payment_payment_operation AS o
   WHERE o.kind = 'CHARGEBACK' AND o.status = 'SUCCEEDED';
END
$fn$;
COMMENT ON FUNCTION core.finance_chargeback_facts() IS
  'Faits du contrôle FIN CHARGEBACK_UNIMPUTED : par chargeback SUCCEEDED, pays, imputation (US-709 : '
  'une imputation ; sinon un mouvement de jambe) et gel de la jambe HOST. Travailleur '
  'reconciliation seulement. US-222d (ADR-176), US-709 (ADR-187).';

-- 8.6 Motifs de retenue d'un lot (0165, même signature) : le motif CHARGEBACK ne compte que les
-- chargebacks OUVERTS (un chargeback perdu et imputé est décidé : le lot n'est plus retenu)
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
  )
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT reasons.r ORDER BY reasons.r), ARRAY[]::text[])
    FROM reasons WHERE reasons.r IS NOT NULL
$fn$;

-- 8.7 Compensation d'un lot (0165, même signature) : dette = solde négatif du host_ledger de
-- (hôte, devise) — les compensations passées y sont déjà (`PAYOUT_NETTING`) ; un lot compensé
-- avant 0167 sans écriture compte encore (aucun en production) ; à la compensation (READY /
-- ZERO_NET), écriture `PAYOUT_NETTING` puis recouvrement des avances ouvertes, les plus anciennes
-- d'abord. Verrou consultatif d'US-708 inchangé (un seul écrivain).
CREATE OR REPLACE FUNCTION core.payout_refresh_batch(p_batch_id uuid, p_netting boolean)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_b       record;
  v_gross   bigint;
  v_debt    bigint;
  v_other   bigint;
  v_netted  bigint;
  v_reasons text[];
  v_status  text;
  v_left    bigint;
  v_part    bigint;
  a         record;
BEGIN
  SELECT x.id, x.org_id, x.country_code, x.currency, x.netted_at INTO v_b
    FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id;
  IF v_b.id IS NULL OR v_b.netted_at IS NOT NULL THEN
    RETURN;
  END IF;
  IF p_netting THEN
    UPDATE core.payout_payout_item AS i
       SET amount_minor = core.payout_item_amount(i.trip_id)
     WHERE i.batch_id = p_batch_id AND i.release_operation_id IS NULL
       AND i.amount_minor IS DISTINCT FROM core.payout_item_amount(i.trip_id);
  END IF;
  SELECT COALESCE(pg_catalog.sum(i.amount_minor), 0)::bigint INTO v_gross
    FROM core.payout_payout_item AS i WHERE i.batch_id = p_batch_id;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
            'payout.netting:' || v_b.org_id::text || ':' || v_b.currency, 0));
  SELECT GREATEST(0, -COALESCE(pg_catalog.sum(e.amount_minor), 0))::bigint INTO v_debt
    FROM core.settlement_host_ledger_entry AS e
   WHERE e.org_id = v_b.org_id AND e.currency = v_b.currency;
  SELECT COALESCE(pg_catalog.sum(x.netted_minor), 0)::bigint INTO v_other
    FROM core.payout_payout_batch AS x
   WHERE x.org_id = v_b.org_id AND x.currency = v_b.currency AND x.id <> p_batch_id
     AND x.netted_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM core.settlement_host_ledger_entry AS e
                      WHERE e.payout_batch_id = x.id);
  v_netted := LEAST(v_gross, GREATEST(0, v_debt - v_other));
  v_reasons := core.payout_batch_hold_reasons(p_batch_id);
  v_status := CASE
                WHEN pg_catalog.cardinality(v_reasons) > 0 THEN 'ON_HOLD'
                WHEN NOT p_netting THEN 'SCHEDULED'
                WHEN v_gross - v_netted > 0 THEN 'READY'
                ELSE 'ZERO_NET'
              END;
  UPDATE core.payout_payout_batch AS x
     SET gross_minor = v_gross, netted_minor = v_netted, net_minor = v_gross - v_netted,
         hold_reasons = v_reasons, status = v_status,
         netted_at = CASE WHEN v_status IN ('READY', 'ZERO_NET') THEN platform.now() END,
         next_check_at = CASE WHEN p_netting AND v_status = 'ON_HOLD'
                              THEN platform.now() + interval '15 minutes' END
   WHERE x.id = p_batch_id
     AND (p_netting
          OR x.gross_minor IS DISTINCT FROM v_gross OR x.netted_minor IS DISTINCT FROM v_netted
          OR x.hold_reasons IS DISTINCT FROM v_reasons OR x.status IS DISTINCT FROM v_status);
  -- US-709 : la compensation du lot au grand livre (SM-6b), une fois, montant figé du lot
  IF v_status IN ('READY', 'ZERO_NET') AND v_netted > 0 THEN
    INSERT INTO core.settlement_host_ledger_entry
           (id, org_id, country_code, currency, reason, amount_minor, payout_batch_id)
    VALUES (pg_catalog.gen_random_uuid(), v_b.org_id, v_b.country_code, v_b.currency,
            'PAYOUT_NETTING', v_netted, p_batch_id);
    -- recouvrement des avances de Kmino de l'hôte dans la devise, les plus anciennes d'abord
    v_left := v_netted;
    FOR a IN
      SELECT x.id, x.receivable_minor - x.recovered_minor AS open
        FROM core.settlement_platform_advance AS x
       WHERE x.org_id = v_b.org_id AND x.currency = v_b.currency AND x.cause = 'RELEASED_LEG'
         AND x.status IN ('OPEN', 'RECOVERING') AND x.receivable_minor > x.recovered_minor
       ORDER BY x.created_at, x.id
         FOR UPDATE
    LOOP
      EXIT WHEN v_left <= 0;
      v_part := LEAST(v_left, a.open);
      UPDATE core.settlement_platform_advance AS x
         SET recovered_minor = x.recovered_minor + v_part,
             status = CASE WHEN x.recovered_minor + v_part = x.receivable_minor THEN 'RECOVERED'
                           ELSE 'RECOVERING' END
       WHERE x.id = a.id;
      v_left := v_left - v_part;
    END LOOP;
  END IF;
END
$fn$;

-- 8.8 Ajustement de versement de la part compensée (adjustPayout), avant le versement : lot
-- READY, part compensée > 0, chaque item libéré, motifs relus (sous les verrous des trips puis du
-- lot). Issues : ADJUST (à envoyer : clé posée, SUBMITTED), REPLAY (déjà SUBMITTED : lecture
-- d'abord), DONE (SUCCEEDED), FAILED (revue FIN, jamais renvoyé), NONE (rien de compensé),
-- RELEASE_PENDING, ON_HOLD, l'état du lot sinon.
CREATE FUNCTION core.payout_cmd_adjustment(p_batch_id uuid)
  RETURNS TABLE (outcome text, idempotency_key text, amount_minor bigint, currency text,
                 submerchant_reference text, provider_ref text, hold_reasons text[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_b       record;
  v_reasons text[] := ARRAY[]::text[];
  v_outcome text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payout: commands are reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'payout_command_forbidden';
  END IF;
  PERFORM 1 FROM core.booking_trip AS t
   WHERE t.id IN (SELECT i.trip_id FROM core.payout_payout_item AS i WHERE i.batch_id = p_batch_id)
   ORDER BY t.id
     FOR UPDATE;
  SELECT x.id, x.status, x.netted_minor, x.adjustment_status INTO v_b
    FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    v_outcome := 'UNKNOWN';
  ELSIF v_b.status <> 'READY' THEN
    v_outcome := v_b.status;
  ELSIF v_b.netted_minor = 0 THEN
    v_outcome := 'NONE';
  ELSIF v_b.adjustment_status = 'SUCCEEDED' THEN
    v_outcome := 'DONE';
  ELSIF v_b.adjustment_status = 'FAILED' THEN
    v_outcome := 'FAILED';
  ELSIF EXISTS (SELECT 1 FROM core.payout_payout_item AS i
                 WHERE i.batch_id = p_batch_id AND i.amount_minor > 0
                   AND NOT EXISTS (SELECT 1
                                     FROM core.payment_payment_operation AS o
                                     JOIN core.settlement_leg_movement AS m ON m.operation_id = o.id
                                    WHERE o.id = i.release_operation_id AND o.status = 'SUCCEEDED')) THEN
    v_outcome := 'RELEASE_PENDING';
  ELSE
    v_reasons := core.payout_batch_hold_reasons(p_batch_id);
    IF pg_catalog.cardinality(v_reasons) > 0 THEN
      UPDATE core.payout_payout_batch AS x
         SET status = 'ON_HOLD', hold_reasons = v_reasons,
             next_check_at = platform.now() + interval '15 minutes'
       WHERE x.id = p_batch_id;
      v_outcome := 'ON_HOLD';
    ELSIF v_b.adjustment_status = 'SUBMITTED' THEN
      v_outcome := 'REPLAY';
    ELSE
      UPDATE core.payout_payout_batch AS x
         SET adjustment_status = 'SUBMITTED',
             adjustment_key = pg_catalog.format('adjust:%s:r1', p_batch_id)
       WHERE x.id = p_batch_id;
      v_outcome := 'ADJUST';
    END IF;
  END IF;
  IF v_outcome IN ('ADJUST', 'REPLAY', 'DONE', 'FAILED') THEN
    RETURN QUERY
      SELECT v_outcome, x.adjustment_key, x.netted_minor, x.currency,
             (SELECT s.provider_submerchant_ref FROM core.payment_psp_submerchant AS s
               WHERE s.psp_account_id = x.psp_account_id AND s.org_id = x.org_id
                 AND s.kyc_status = 'ACTIVE'
               ORDER BY s.attempt_no DESC LIMIT 1),
             x.adjustment_provider_ref, v_reasons
        FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id;
  ELSE
    RETURN QUERY SELECT v_outcome, NULL::text, NULL::bigint, NULL::text, NULL::text, NULL::text,
                        v_reasons;
  END IF;
END
$fn$;
COMMENT ON FUNCTION core.payout_cmd_adjustment(uuid) IS
  'Ajustement de versement (adjustPayout) de la part compensée d''un lot READY, avant le versement '
  '(clé adjust:{lot}:r1, montant compensé). Travailleur payment_command. US-709 (ADR-187).';

-- 8.9 Résultat de l'ajustement reçu du PSP : SUCCEEDED / FAILED (état final), sinon inchangé
CREATE FUNCTION core.payout_cmd_record_adjustment(p_batch_id uuid, p_status text,
                                                  p_provider_ref text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_status text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payout: commands are reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'payout_command_forbidden';
  END IF;
  SELECT x.adjustment_status INTO v_status
    FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id FOR UPDATE;
  IF v_status = 'SUBMITTED' AND p_status IN ('SUCCEEDED', 'FAILED') THEN
    UPDATE core.payout_payout_batch AS x
       SET adjustment_status = p_status,
           adjustment_provider_ref = COALESCE(p_provider_ref, x.adjustment_provider_ref)
     WHERE x.id = p_batch_id;
    v_status := p_status;
  END IF;
  RETURN COALESCE(v_status, 'NONE');
END
$fn$;
COMMENT ON FUNCTION core.payout_cmd_record_adjustment(uuid, text, text) IS
  'Résultat de l''ajustement de versement reçu du PSP (SUCCEEDED, FAILED ; sinon inchangé). '
  'Travailleur payment_command. US-709 (ADR-187).';

REVOKE ALL ON FUNCTION core.payout_cmd_adjustment(uuid),
  core.payout_cmd_record_adjustment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payout_cmd_adjustment(uuid),
  core.payout_cmd_record_adjustment(uuid, text, text) TO app_worker;

RESET ROLE;

-- 9. Déclencheurs : projection SM-6b, passage en perte ------------------------------------------
-- Fonctions créées par migrator (propriétaire des tables, qui pose les déclencheurs), puis
-- transférées à cmd_money_owner, propriétaire des écritures qu'elles font (comme 0129, 0139).

CREATE FUNCTION core.settlement_host_ledger_state_projected()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM core.settlement_refresh_host_ledger_state(NEW.org_id, NEW.currency);
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_host_ledger_state_projected() IS
  'Déclencheur host_ledger_state_projected : chaque écriture du host_ledger projette l''état SM-6b '
  'de (hôte, devise), dans la même transaction. US-709 (ADR-187).';
REVOKE ALL ON FUNCTION core.settlement_host_ledger_state_projected() FROM PUBLIC;
CREATE TRIGGER host_ledger_state_projected AFTER INSERT ON core.settlement_host_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION core.settlement_host_ledger_state_projected();

-- Après une avance : crédit du passage en perte (reste dû, rattaché au règlement de la créance,
-- décision FINANCE citée), puis projection SM-6b (avances ouvertes)
CREATE FUNCTION core.settlement_advance_ledger_projected()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  e record;
BEGIN
  IF NEW.cause <> 'RELEASED_LEG' OR NEW.org_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'WRITTEN_OFF' AND OLD.status IS DISTINCT FROM 'WRITTEN_OFF'
     AND NEW.receivable_minor > NEW.recovered_minor THEN
    SELECT x.org_id, x.country_code, x.currency, x.trip_id, x.segment_no, x.settlement_id,
           x.settlement_version INTO e
      FROM core.settlement_host_ledger_entry AS x
     WHERE x.advance_id = NEW.id AND x.reason = 'RELEASED_LEG_ADVANCE';
    IF e.org_id IS NOT NULL THEN
      INSERT INTO core.settlement_host_ledger_entry
             (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
              settlement_version, reason, amount_minor, write_off_approval_id)
      VALUES (pg_catalog.gen_random_uuid(), e.org_id, e.country_code, e.currency, e.trip_id,
              e.segment_no, e.settlement_id, e.settlement_version, 'RECEIVABLE_WRITE_OFF',
              NEW.receivable_minor - NEW.recovered_minor, NEW.write_off_approval_id);
      RETURN NULL;
    END IF;
  END IF;
  PERFORM core.settlement_refresh_host_ledger_state(NEW.org_id, NEW.currency);
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_advance_ledger_projected() IS
  'Déclencheur advance_ledger_projected : avance passée en perte par deux personnes ⇒ crédit '
  'RECEIVABLE_WRITE_OFF du reste dû au host_ledger ; toute avance ⇒ projection SM-6b. US-709 (ADR-187).';
REVOKE ALL ON FUNCTION core.settlement_advance_ledger_projected() FROM PUBLIC;
CREATE TRIGGER advance_ledger_projected
  AFTER INSERT OR UPDATE OF status, recovered_minor ON core.settlement_platform_advance
  FOR EACH ROW EXECUTE FUNCTION core.settlement_advance_ledger_projected();

ALTER FUNCTION core.settlement_host_ledger_state_projected() OWNER TO cmd_money_owner;
ALTER FUNCTION core.settlement_advance_ledger_projected() OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 10. Reprise de l'existant : projection SM-6b des écritures déjà présentes ----------------------
INSERT INTO core.settlement_host_ledger_state
       (org_id, currency, country_code, state, balance_minor, open_advances_minor, since,
        next_action_at)
SELECT e.org_id, e.currency, o.country_code,
       CASE WHEN pg_catalog.sum(e.amount_minor) < 0 THEN 'NEGATIVE' ELSE 'BALANCED' END,
       pg_catalog.sum(e.amount_minor)::bigint,
       COALESCE((SELECT pg_catalog.sum(a.receivable_minor - a.recovered_minor)
                   FROM core.settlement_platform_advance AS a
                  WHERE a.org_id = e.org_id AND a.currency = e.currency
                    AND a.cause = 'RELEASED_LEG' AND a.status IN ('OPEN', 'RECOVERING')), 0)::bigint,
       platform.now(),
       CASE WHEN pg_catalog.sum(e.amount_minor) < 0 THEN platform.now() + interval '30 days' END
  FROM core.settlement_host_ledger_entry AS e
  JOIN core.iam_organization AS o ON o.id = e.org_id
 GROUP BY e.org_id, e.currency, o.country_code;
