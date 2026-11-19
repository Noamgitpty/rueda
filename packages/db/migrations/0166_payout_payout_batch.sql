-- 0166 — PYO : lots de versement à l'hôte (SM-6) depuis la jambe HOST ; écrivain unique de
-- `trip_leg_balance.release_at` (S-06).
-- US-708 ; ADR-185 ; 19 US-708 (critères 1 à 3) ; 16 PYO-002 ; 08 BR-PAYOUT-02 (R08), E7 règle 6,
-- SM-6 ; 17 v6 §0.1 (interrupteurs), §2.8 (`releaseLeg`, `payout`, clés), §2.9, §3.2.9
-- (`payout_batch`, `payout_item`), §7.2 (`payout_business_day_offset`, `first_payout_business_day`,
-- `payout_batch_local_time`) ; 22 OQ-P2P-08 (J+2 ouvrés, premier à J+5), OQ-PAY-05 ; pré-mortem du
-- lot 3 : L3-PM-30 à L3-PM-38 ; red team RT-L3-V01 à V06. Appliquée sous `migrator`.
--
-- Principes (ADR-185, PROPOSÉ, « comme Turo » sauf l'écart assumé J+2 / J+5 d'OQ-P2P-08) :
--   - préparation (travailleur `payment_command`, tâche `payout_scheduler`) : un trip COMPLETED,
--     sa fin effective (première transition RETURNED du journal d'état, celle de 0153 et
--     d'US-315) connue, sa jambe HOST encaissée ; `payout_at` = N-ième jour ouvré du PAYS après la
--     date locale de la fin effective (fuseau du trip, figé à la réservation), à l'heure locale
--     `payout_batch_local_time` ; N = `payout_business_day_offset` (2), ou
--     `first_payout_business_day` (5) tant qu'aucun lot n'a été émis vers le compte de versement
--     courant de l'hôte (premier versement, compte changé compris) ; samedi et dimanche ne sont
--     pas ouvrés ; fériés : `config_holiday_calendar`, dernière version du pays. Calendrier
--     absent pour une année traversée, paramètre absent ou illisible ⇒ AUCUN lot, rien n'est
--     écrit (fail-closed : les gains restent chez le PSP) ;
--   - ÉCRIVAIN UNIQUE de `trip_leg_balance.release_at` (S-06, L3-PM-32) :
--     `core.payout_cmd_prepare_trip`, une fois (NULL → valeur), jambe HOST, trip COMPLETED,
--     valeur ≥ fin effective + 24 h (fenêtre de déclaration). Le déclencheur
--     `trip_leg_balance_release_at_guard` refuse toute autre écriture, par tout rôle sauf
--     `migrator` (fixture de test 9940 d'US-049, jamais un rôle applicatif) ;
--   - lots par (compte d'hôte, devise, type, `payout_at`, compte PSP) : un lot ouvert (jamais
--     compensé) reçoit les trips du même jour ; un trip n'entre que dans UN lot (UNIQUE trip,
--     segment, jambe) ; montant d'un item = jambe HOST encore à libérer (encaissé − débits, en vol
--     compris ; plafonné par la jambe retenue du règlement en tête s'il existe) ; brut = Σ items ;
--     compensation (`netted`) = min(brut, dette du `host_ledger` de l'hôte dans la devise non
--     encore compensée par un autre lot) ; net = brut − compensation (08 BR-PAYOUT-02, SM-6b) ;
--   - motifs de retenue relus à la préparation, à la compensation, avant chaque `releaseLeg` et
--     avant `payout` (L3-PM-30, L3-PM-34) : `PAYOUTS_DISABLED` (`payouts_enabled[pays]`, absent
--     ⇒ false, `core.config_go_live`), `FUNDS_HOLDING_DISABLED` et `VARIANT_B_UNAVAILABLE`
--     (variante B, `PLATFORM_MOR`), `HOST_PAYOUT_RAIL_UNAVAILABLE` (capacité bloquante inconnue
--     = non), `SUBMERCHANT_INACTIVE`, `PAYOUT_ACCOUNT_*` (garde d'US-707), `CHARGEBACK` /
--     `DISPUTE` / `CLAIM` (jambe HOST gelée, chargeback non échoué, trip en litige),
--     `TRIP_NOT_COMPLETED` ; un motif ⇒ `ON_HOLD`, levé seulement quand la base ne le lit plus
--     (un gel de jambe ne se lève que par la décision FIN, garde de 0155) ;
--   - variante A : un ordre `LEG_RELEASE` par item, clé `release:{trip}:{segment}:HOST:i{n}`,
--     `n` + 1 seulement après un refus REÇU (`FAILED`) ; le déclencheur
--     `payment_operation_leg_payout_item_guard` (avant les gardes de 0054) exige un lot READY,
--     la clé, le rang et le montant de l'item, et refuse un second ordre HOST vivant du trip ;
--     puis `payout` du lot, clé `payout:{lot}:r{n}` ; aucune transition vers INITIATED si
--     `payouts_enabled[pays]` = false ou, en variante B, si `funds_holding_enabled[pays]` = false
--     (déclencheur, tout rôle) ;
--   - aucun interrupteur écrit ; aucune constante de pays ; heure de la base (`platform.now()`).
--
-- Écarts PROPOSÉS avec 17 §3.2.9 (ADR-185, à reporter) : colonnes en plus `country_code`,
-- `variant`, `psp_account_id`, `payout_account_id`, `first_payout`, `netted_at`, `attempt_no`,
-- `initiated_at`, `paid_at` ; `segment_no` au lieu de `segment_id` ; `rail` non stocké (rail du
-- PSP, lot C) ; plafond `payout_rail_cap` non posé (aucun rail réel avant le lot C) ; état
-- `NETTING` transitoire (la compensation et l'état READY / ZERO_NET sont posés dans la même
-- commande) ; exécution de la variante B (versement depuis un compte de Kmino) non construite :
-- retenue `VARIANT_B_UNAVAILABLE` (lot C).
--
-- Codes (packages/db/src/errors.ts) : payout_command_forbidden (42501) → FORBIDDEN ;
-- payout_release_batch_not_ready, payout_batch_transition (55000 / 23000) → INVALID_TRANSITION ;
-- payout_release_item_mismatch, payout_release_duplicate, trip_leg_balance_release_at_guarded →
-- INVARIANT_VIOLATION ; payout_batch_payouts_disabled, payout_batch_funds_holding_disabled →
-- FORBIDDEN ; payout_batch_immutable, payout_item_immutable → IMMUTABLE_RECORD.
--
-- Expand / contract : tables, fonctions, déclencheurs, droits et politiques AJOUTÉS ; une
-- politique ÉLARGIE (`cmd_money_sel` de `config_param_value` : + trois clés du calendrier, même
-- nom, ADR-081) ; droits de colonnes ajoutés à cmd_money_owner (`release_at` en écriture, journal
-- d'état du trip et fériés en lecture). Rien de retiré.
--
-- Retour arrière (base sans dépendance ; jamais en production : nouvelle migration à la place) :
--   DROP TRIGGER payment_operation_leg_payout_item_guard ON core.payment_payment_operation_leg ;
--   DROP TRIGGER trip_leg_balance_release_at_guard ON core.settlement_trip_leg_balance ;
--   DROP FUNCTION core.payout_cmd_record_payout_result(uuid, text, text),
--     core.payout_cmd_initiate_batch(uuid), core.payout_release_items(uuid),
--     core.payout_cmd_recheck_batch(uuid), core.payout_cmd_net_batch(uuid),
--     core.payout_batches_due(integer), core.payout_cmd_prepare_trip(uuid),
--     core.payout_trips_to_prepare(integer), core.payout_refresh_batch(uuid, boolean),
--     core.payout_batch_hold_reasons(uuid), core.payout_item_amount(uuid),
--     core.payout_schedule(uuid, boolean), core.payout_business_day(text, date, integer),
--     core.payout_effective_end(uuid), core.payout_release_item_guard(),
--     core.settlement_release_at_guard(), core.payout_payout_batch_guard(),
--     core.payout_payout_item_guard() ;
--   DROP TABLE core.payout_payout_item, core.payout_payout_batch ;
--   ALTER POLICY cmd_money_sel ON core.config_param_value (liste de 0159) ;
--   DROP POLICY cmd_money_payout_sel ON core.config_holiday_calendar ;
--   DROP POLICY cmd_money_payout_log_sel ON core.booking_trip_state_log ;
--   REVOKE UPDATE (release_at) ON core.settlement_trip_leg_balance FROM cmd_money_owner ;
--   REVOKE SELECT ON core.config_holiday_calendar FROM cmd_money_owner ;
--   REVOKE SELECT (trip_id, to_status, kind, at) ON core.booking_trip_state_log FROM cmd_money_owner.

-- 1. Tables ---------------------------------------------------------------------------------------

-- Lot de versement (17 §3.2.9 `payout_batch`, SM-6 ; classe B : jamais supprimé)
CREATE TABLE core.payout_payout_batch (
  id                uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT payout_payout_batch_pkey PRIMARY KEY,
  org_id            uuid        NOT NULL,                  -- compte d'hôte (personne physique)
  country_code      text        NOT NULL
    CONSTRAINT payout_batch_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- devise des trips du lot (08 E5 : aucune conversion, un lot = une devise)
  currency          text        NOT NULL
    CONSTRAINT payout_batch_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  kind              text        NOT NULL DEFAULT 'FINAL'
    CONSTRAINT payout_batch_kind_valid CHECK (kind IN
      ('FINAL', 'CXL_EARNINGS', 'INVOICE_SHARE', 'PARTIAL_WEEKLY')),
  -- variante d'exécution du compte PSP des trips (17 §3.2.7 `collection_mode`) : A ou B
  variant           text        NOT NULL
    CONSTRAINT payout_batch_variant_valid CHECK (variant IN ('SPLIT_AT_SOURCE', 'PLATFORM_MOR')),
  psp_account_id    uuid        NOT NULL
    CONSTRAINT payout_batch_psp_account_fk REFERENCES core.payment_psp_account (id),
  -- compte de versement courant à la préparation (premier versement : J+5) ; NULL sans compte
  payout_account_id uuid
    CONSTRAINT payout_batch_payout_account_fk REFERENCES core.payout_payout_account (id),
  first_payout      boolean     NOT NULL,
  status            text        NOT NULL
    CONSTRAINT payout_batch_status_valid CHECK (status IN
      ('SCHEDULED', 'ON_HOLD', 'NETTING', 'READY', 'ZERO_NET', 'INITIATED', 'IN_TRANSIT', 'PAID',
       'FAILED')),
  -- `payout_at` des trips du lot (08 BR-PAYOUT-02, R08)
  scheduled_for     timestamptz NOT NULL,
  gross_minor       bigint      NOT NULL DEFAULT 0,
  netted_minor      bigint      NOT NULL DEFAULT 0,
  net_minor         bigint      NOT NULL DEFAULT 0,
  hold_reasons      text[]      NOT NULL DEFAULT ARRAY[]::text[],
  -- compensation faite (SCHEDULED → NETTING → READY / ZERO_NET) : le lot ne reçoit plus de trip
  netted_at         timestamptz,
  -- rang du versement (`payout:{lot}:r{n}`), + 1 après un refus reçu seulement
  attempt_no        integer     NOT NULL DEFAULT 0
    CONSTRAINT payout_batch_attempt_valid CHECK (attempt_no >= 0),
  idempotency_key   text
    CONSTRAINT payout_batch_idempotency_key_unique UNIQUE
    CONSTRAINT payout_batch_idempotency_key_format CHECK (idempotency_key ~ '^payout:[0-9a-f-]{36}:r[1-9][0-9]{0,5}$'),
  provider_ref      text
    CONSTRAINT payout_batch_provider_ref_format CHECK (provider_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  initiated_at      timestamptz,
  paid_at           timestamptz,
  row_version       integer     NOT NULL DEFAULT 0
    CONSTRAINT payout_batch_row_version_valid CHECK (row_version >= 0),
  created_at        timestamptz NOT NULL DEFAULT platform.now(),
  updated_at        timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT payout_batch_org_country_fk FOREIGN KEY (org_id, country_code)
    REFERENCES core.iam_organization (id, country_code),
  CONSTRAINT payout_batch_amounts CHECK (
    gross_minor >= 0 AND netted_minor >= 0 AND netted_minor <= gross_minor
    AND net_minor = gross_minor - netted_minor),
  CONSTRAINT payout_batch_hold_shape CHECK ((status = 'ON_HOLD') = (cardinality(hold_reasons) > 0)),
  CONSTRAINT payout_batch_netted_shape CHECK (
    status NOT IN ('NETTING', 'READY', 'ZERO_NET', 'INITIATED', 'IN_TRANSIT', 'PAID', 'FAILED')
    OR netted_at IS NOT NULL),
  CONSTRAINT payout_batch_zero_net CHECK (status <> 'ZERO_NET' OR net_minor = 0),
  CONSTRAINT payout_batch_ready_net CHECK (
    status NOT IN ('READY', 'INITIATED', 'IN_TRANSIT', 'PAID') OR net_minor > 0),
  CONSTRAINT payout_batch_sent_shape CHECK (
    status NOT IN ('INITIATED', 'IN_TRANSIT', 'PAID')
    OR (idempotency_key IS NOT NULL AND initiated_at IS NOT NULL AND attempt_no >= 1)),
  CONSTRAINT payout_batch_paid_shape CHECK ((status = 'PAID') = (paid_at IS NOT NULL))
);
-- un seul lot OUVERT (non compensé) par hôte, devise, type, échéance et compte PSP
CREATE UNIQUE INDEX payout_payout_batch_open_unique
  ON core.payout_payout_batch (org_id, currency, kind, scheduled_for, psp_account_id)
  WHERE netted_at IS NULL;
CREATE INDEX payout_payout_batch_due_idx ON core.payout_payout_batch (scheduled_for)
  WHERE status NOT IN ('PAID', 'ZERO_NET');
CREATE INDEX payout_payout_batch_org_idx ON core.payout_payout_batch (org_id, currency);
COMMENT ON TABLE core.payout_payout_batch IS
  'Lot de versement à l''hôte (SM-6) par compte d''hôte, devise, type et payout_at ; montants en '
  'unités mineures (brut = Σ items, compensation du host_ledger, net) ; motifs de retenue relus à '
  'chaque étape. US-708 (ADR-185).';

-- Item d'un lot : une libération de la jambe HOST d'un trip (17 §3.2.9 `payout_item`, classe A)
CREATE TABLE core.payout_payout_item (
  id                   uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT payout_payout_item_pkey PRIMARY KEY,
  batch_id             uuid        NOT NULL
    CONSTRAINT payout_item_batch_fk REFERENCES core.payout_payout_batch (id),
  trip_id              uuid        NOT NULL,
  segment_no           integer     NOT NULL
    CONSTRAINT payout_item_segment_beta CHECK (segment_no = 1),
  leg                  text        NOT NULL
    CONSTRAINT payout_item_leg_host CHECK (leg = 'HOST'),
  org_id               uuid        NOT NULL,
  country_code         text        NOT NULL
    CONSTRAINT payout_item_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency             text        NOT NULL
    CONSTRAINT payout_item_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  amount_minor         bigint      NOT NULL DEFAULT 0
    CONSTRAINT payout_item_amount_nonneg CHECK (amount_minor >= 0),
  -- rang de la libération (`release:{trip}:{segment}:HOST:i{n}`) ; ordre vivant
  release_attempt      integer     NOT NULL DEFAULT 0
    CONSTRAINT payout_item_attempt_valid CHECK (release_attempt >= 0),
  release_operation_id uuid
    CONSTRAINT payout_item_release_operation_unique UNIQUE
    CONSTRAINT payout_item_release_operation_fk REFERENCES core.payment_payment_operation (id),
  created_at           timestamptz NOT NULL DEFAULT platform.now(),
  updated_at           timestamptz NOT NULL DEFAULT platform.now(),
  -- un trip n'entre que dans UN lot (L3-PM-33, RT-L3-V03)
  CONSTRAINT payout_item_trip_leg_unique UNIQUE (trip_id, segment_no, leg),
  CONSTRAINT payout_item_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  CONSTRAINT payout_item_release_shape CHECK (release_operation_id IS NULL OR release_attempt >= 1)
);
CREATE INDEX payout_payout_item_batch_idx ON core.payout_payout_item (batch_id);
COMMENT ON TABLE core.payout_payout_item IS
  'Item d''un lot de versement : jambe HOST d''un trip (un trip, un lot), montant explicite, '
  'ordre LEG_RELEASE de rang n. US-708 (ADR-185).';

-- 2. Gardes (SECURITY INVOKER) -------------------------------------------------------------------

-- 2.1 Lot : jamais supprimé ; identité figée ; transitions de SM-6 ; aucune émission (INITIATED)
-- si `payouts_enabled[pays]` = false ou, en variante B, si `funds_holding_enabled[pays]` = false,
-- par AUCUN rôle (17 §3.2.9, SM-6, L3-PM-30, L3-PM-31). migrator (fixtures de test) n'est dispensé
-- que de la règle des transitions, jamais de celle des interrupteurs.
CREATE FUNCTION core.payout_payout_batch_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'payout_batch: no delete'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_batch_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.variant IS DISTINCT FROM OLD.variant
     OR NEW.psp_account_id IS DISTINCT FROM OLD.psp_account_id
     OR NEW.payout_account_id IS DISTINCT FROM OLD.payout_account_id
     OR NEW.first_payout IS DISTINCT FROM OLD.first_payout
     OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.netted_at IS NOT NULL AND NEW.netted_at IS DISTINCT FROM OLD.netted_at)
     OR NEW.attempt_no < OLD.attempt_no
     -- montants figés une fois le lot compensé (sauf à la compensation elle-même)
     OR (OLD.netted_at IS NOT NULL
         AND (NEW.gross_minor IS DISTINCT FROM OLD.gross_minor
              OR NEW.netted_minor IS DISTINCT FROM OLD.netted_minor
              OR NEW.net_minor IS DISTINCT FROM OLD.net_minor)) THEN
    RAISE EXCEPTION 'payout_batch: identity and netted amounts are immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_batch_immutable';
  END IF;
  IF NEW.status = 'INITIATED' AND OLD.status IS DISTINCT FROM 'INITIATED' THEN
    -- 17 §0.1 : interrupteurs lus en base, absent ⇒ false (core.config_go_live)
    IF NOT core.config_go_live('payouts_enabled', NEW.country_code) THEN
      RAISE EXCEPTION 'payout_batch: payouts are disabled in %', NEW.country_code
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_batch_payouts_disabled';
    END IF;
    IF NEW.variant = 'PLATFORM_MOR'
       AND NOT core.config_go_live('funds_holding_enabled', NEW.country_code) THEN
      RAISE EXCEPTION 'payout_batch: funds holding is disabled in %', NEW.country_code
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_batch_funds_holding_disabled';
    END IF;
  END IF;
  IF current_user <> 'migrator' AND NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status, NEW.status) IN (
       ('SCHEDULED', 'ON_HOLD'), ('ON_HOLD', 'SCHEDULED'),
       ('SCHEDULED', 'READY'), ('SCHEDULED', 'ZERO_NET'), ('SCHEDULED', 'NETTING'),
       ('ON_HOLD', 'READY'), ('ON_HOLD', 'ZERO_NET'), ('ON_HOLD', 'NETTING'),
       ('NETTING', 'READY'), ('NETTING', 'ZERO_NET'), ('NETTING', 'ON_HOLD'),
       ('READY', 'ON_HOLD'), ('READY', 'INITIATED'),
       ('INITIATED', 'IN_TRANSIT'), ('INITIATED', 'PAID'), ('INITIATED', 'FAILED'),
       ('IN_TRANSIT', 'PAID'), ('IN_TRANSIT', 'FAILED'),
       ('FAILED', 'ON_HOLD'))) THEN
    RAISE EXCEPTION 'payout_batch: transition % -> % refused', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_batch_transition';
  END IF;
  -- un lot ON_HOLD après sa compensation ne revient qu'à READY (jamais SCHEDULED)
  IF current_user <> 'migrator' AND OLD.status = 'ON_HOLD' AND NEW.status = 'SCHEDULED'
     AND OLD.netted_at IS NOT NULL THEN
    RAISE EXCEPTION 'payout_batch: a netted batch returns to READY only'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_batch_transition';
  END IF;
  -- ON_HOLD → READY : seulement un lot déjà compensé (sinon il passe par la compensation)
  IF current_user <> 'migrator' AND OLD.status = 'ON_HOLD' AND NEW.status = 'READY'
     AND OLD.netted_at IS NULL AND NEW.netted_at IS NULL THEN
    RAISE EXCEPTION 'payout_batch: READY requires the netting'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_batch_transition';
  END IF;
  NEW.row_version := OLD.row_version + 1;
  NEW.updated_at := platform.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payout_payout_batch_guard() FROM PUBLIC;
CREATE TRIGGER payout_payout_batch_guard BEFORE UPDATE OR DELETE ON core.payout_payout_batch
  FOR EACH ROW EXECUTE FUNCTION core.payout_payout_batch_guard();
CREATE TRIGGER payout_payout_batch_no_truncate BEFORE TRUNCATE ON core.payout_payout_batch
  FOR EACH STATEMENT EXECUTE FUNCTION core.payout_payout_batch_guard();

-- 2.2 Item : jamais supprimé ; identité figée ; montant figé dès qu'un ordre est rattaché ; rang
-- monotone ; ordre remplacé seulement après un refus reçu (FAILED).
CREATE FUNCTION core.payout_payout_item_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'payout_item: no delete'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_item_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.segment_no IS DISTINCT FROM OLD.segment_no
     OR NEW.leg IS DISTINCT FROM OLD.leg OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.release_attempt < OLD.release_attempt
     OR (OLD.release_operation_id IS NOT NULL AND NEW.amount_minor IS DISTINCT FROM OLD.amount_minor)
     OR (OLD.release_operation_id IS NOT NULL
         AND NEW.release_operation_id IS DISTINCT FROM OLD.release_operation_id
         AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                          WHERE o.id = OLD.release_operation_id AND o.status = 'FAILED')) THEN
    RAISE EXCEPTION 'payout_item: identity, amount after release and live order are immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_item_immutable';
  END IF;
  NEW.updated_at := platform.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payout_payout_item_guard() FROM PUBLIC;
CREATE TRIGGER payout_payout_item_guard BEFORE UPDATE OR DELETE ON core.payout_payout_item
  FOR EACH ROW EXECUTE FUNCTION core.payout_payout_item_guard();
CREATE TRIGGER payout_payout_item_no_truncate BEFORE TRUNCATE ON core.payout_payout_item
  FOR EACH STATEMENT EXECUTE FUNCTION core.payout_payout_item_guard();

-- 3. RLS : aucun rôle applicatif ne lit ni n'écrit les lots ; commandes de cmd_money_owner -------
ALTER TABLE core.payout_payout_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payout_payout_batch FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payout_payout_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payout_payout_item FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payout_payout_batch TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.payout_payout_item TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.payout_payout_batch, core.payout_payout_item FROM PUBLIC;

GRANT SELECT, INSERT ON core.payout_payout_batch TO cmd_money_owner;
GRANT UPDATE (status, gross_minor, netted_minor, net_minor, hold_reasons, netted_at, attempt_no,
              idempotency_key, provider_ref, initiated_at, paid_at, row_version, updated_at)
  ON core.payout_payout_batch TO cmd_money_owner;
GRANT SELECT, INSERT ON core.payout_payout_item TO cmd_money_owner;
GRANT UPDATE (amount_minor, release_attempt, release_operation_id, updated_at)
  ON core.payout_payout_item TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.payout_payout_batch FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.payout_payout_batch FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND status IN ('SCHEDULED', 'ON_HOLD') AND netted_at IS NULL
              AND idempotency_key IS NULL AND attempt_no = 0);
CREATE POLICY cmd_money_upd ON core.payout_payout_batch FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
CREATE POLICY cmd_money_sel ON core.payout_payout_item FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.payout_payout_item FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND release_operation_id IS NULL AND release_attempt = 0);
CREATE POLICY cmd_money_upd ON core.payout_payout_item FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

-- 4. Lectures et écriture de colonnes de cmd_money_owner -----------------------------------------
-- calendrier du versement (en plus des clés de 0159 ; même nom de politique : remplacement admis,
-- ADR-081)
ALTER POLICY cmd_money_sel ON core.config_param_value
  USING (key IN ('payouts_enabled', 'insurer_contract_active', 'funds_holding_enabled',
                 'payout_account_rails', 'payout_account_change_hold_h',
                 'payout_business_day_offset', 'first_payout_business_day',
                 'payout_batch_local_time'));
-- fériés du pays (17 §1.3, §7.1 point 8), lecture seule
GRANT SELECT ON core.config_holiday_calendar TO cmd_money_owner;
CREATE POLICY cmd_money_payout_sel ON core.config_holiday_calendar FOR SELECT TO cmd_money_owner
  USING (true);
-- fin effective du trip : première transition RETURNED (heure de la base ; 0153, US-315)
GRANT SELECT (trip_id, to_status, kind, at) ON core.booking_trip_state_log TO cmd_money_owner;
CREATE POLICY cmd_money_payout_log_sel ON core.booking_trip_state_log FOR SELECT
  TO cmd_money_owner USING (true);
-- écrivain unique de release_at (S-06) : la politique cmd_money_upd de 0039 (payment_command)
-- couvre déjà la ligne ; le déclencheur 5.1 borne la valeur et l'écrivain
GRANT UPDATE (release_at) ON core.settlement_trip_leg_balance TO cmd_money_owner;

-- 5. Déclencheurs sur les tables d'argent existantes ----------------------------------------------

-- 5.0 Fin effective d'un trip (SECURITY INVOKER, aucun EXECUTE ; propriétaire cmd_money_owner)
CREATE FUNCTION core.payout_effective_end(p_trip_id uuid)
  RETURNS timestamptz
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.min(l.at)
    FROM core.booking_trip_state_log AS l
   WHERE l.trip_id = p_trip_id AND l.to_status = 'RETURNED' AND l.kind = 'TRANSITION'
$fn$;

-- 5.1 release_at : une fois, jambe HOST, trip COMPLETED, ≥ fin effective + 24 h ; aucun autre
-- écrivain (S-06, L3-PM-32, RT-L3-V06). migrator seul dispensé (fixture 9940, jamais en production).
CREATE FUNCTION core.settlement_release_at_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_status text;
  v_end    timestamptz;
BEGIN
  IF current_user = 'migrator' OR NEW.release_at IS NOT DISTINCT FROM OLD.release_at THEN
    RETURN NEW;
  END IF;
  SELECT t.status INTO v_status FROM core.booking_trip AS t WHERE t.id = NEW.trip_id;
  v_end := core.payout_effective_end(NEW.trip_id);
  IF OLD.release_at IS NOT NULL OR NEW.release_at IS NULL OR NEW.leg <> 'HOST'
     OR v_status IS DISTINCT FROM 'COMPLETED' OR v_end IS NULL
     OR NEW.release_at < v_end + interval '24 hours' THEN
    RAISE EXCEPTION 'trip_leg_balance: release_at is written once by the payout preparation'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'trip_leg_balance_release_at_guarded';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.settlement_release_at_guard() FROM PUBLIC;
CREATE TRIGGER trip_leg_balance_release_at_guard
  BEFORE UPDATE OF release_at ON core.settlement_trip_leg_balance
  FOR EACH ROW EXECUTE FUNCTION core.settlement_release_at_guard();

-- 5.2 Ordre LEG_RELEASE de la jambe HOST (variante A, critère 3) : un seul ordre vivant par
-- (trip, segment, HOST) ; s'il existe un item de lot pour le trip, l'ordre est celui de l'item
-- (lot READY, clé `release:{trip}:1:HOST:i{n}`, rang n = rang de l'item + 1, montant de l'item) et
-- y est rattaché. Trigger d'instruction AFTER INSERT des jambes, nommé pour passer AVANT la garde
-- `payment_operation_leg_release_guard` de 0054 (ordre alphabétique) : un ordre hors lot (preuves
-- de 0054, S-04) garde le seul refus de 0054 / 0123. SECURITY DEFINER sous cmd_money_owner, aucun
-- EXECUTE (comme le gel de 0155) : d'autres propriétaires insèrent des jambes (encaissement,
-- caution) avec des droits de colonnes restreints sur `payment_payment_operation` ; seul un ordre
-- LEG_RELEASE (commande de payment_command) atteint les lots.
CREATE FUNCTION core.payout_release_item_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r         record;
  v_batch   uuid;
  v_status  text;
  v_variant text;
  v_country text;
  v_item    record;
BEGIN
  FOR r IN
    SELECT o.id, o.trip_id, o.idem_plain, o.amount_minor, o.attempt_no
      FROM core.payment_payment_operation AS o
     WHERE o.id IN (SELECT n.operation_id FROM new_legs AS n
                     WHERE n.leg = 'HOST' AND n.amount_minor > 0)
       AND o.kind = 'LEG_RELEASE' AND o.trip_id IS NOT NULL
     ORDER BY o.id
  LOOP
    -- un seul versement vivant de la jambe HOST du trip (L3-PM-33)
    IF EXISTS (SELECT 1
                 FROM core.payment_payment_operation AS o2
                 JOIN core.payment_payment_operation_leg AS l2 ON l2.operation_id = o2.id
                WHERE o2.trip_id = r.trip_id AND o2.id <> r.id AND o2.kind = 'LEG_RELEASE'
                  AND o2.status <> 'FAILED' AND l2.leg = 'HOST' AND l2.amount_minor > 0) THEN
      RAISE EXCEPTION 'payout: a live HOST release already exists for trip %', r.trip_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_release_duplicate';
    END IF;
    SELECT i.batch_id INTO v_batch
      FROM core.payout_payout_item AS i
     WHERE i.trip_id = r.trip_id AND i.segment_no = 1 AND i.leg = 'HOST';
    IF v_batch IS NULL THEN
      CONTINUE;
    END IF;
    -- ordre des verrous : trip (tenu par la commande), lot, item
    SELECT b.status, b.variant, b.country_code INTO v_status, v_variant, v_country
      FROM core.payout_payout_batch AS b WHERE b.id = v_batch FOR UPDATE;
    SELECT i.id, i.amount_minor, i.release_attempt, i.release_operation_id INTO v_item
      FROM core.payout_payout_item AS i
     WHERE i.trip_id = r.trip_id AND i.segment_no = 1 AND i.leg = 'HOST'
       FOR UPDATE;
    IF v_status IS DISTINCT FROM 'READY' THEN
      RAISE EXCEPTION 'payout: batch of trip % is not ready (%)', r.trip_id, v_status
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_release_batch_not_ready';
    END IF;
    -- variante B (fonds détenus par Kmino) : refus avant tout ordre sans l'interrupteur (L3-PM-31)
    IF v_variant = 'PLATFORM_MOR' AND NOT core.config_go_live('funds_holding_enabled', v_country) THEN
      RAISE EXCEPTION 'payout: funds holding is disabled in %', v_country
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_batch_funds_holding_disabled';
    END IF;
    IF r.idem_plain IS DISTINCT FROM
         pg_catalog.format('release:%s:1:HOST:i%s', r.trip_id, v_item.release_attempt + 1)
       OR r.attempt_no IS DISTINCT FROM v_item.release_attempt + 1
       OR r.amount_minor IS DISTINCT FROM v_item.amount_minor
       OR (v_item.release_operation_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS o3
                            WHERE o3.id = v_item.release_operation_id AND o3.status = 'FAILED')) THEN
      RAISE EXCEPTION 'payout: release of trip % differs from its payout item', r.trip_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_release_item_mismatch';
    END IF;
    UPDATE core.payout_payout_item AS i
       SET release_operation_id = r.id, release_attempt = v_item.release_attempt + 1
     WHERE i.id = v_item.id;
  END LOOP;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION core.payout_release_item_guard() FROM PUBLIC;
CREATE TRIGGER payment_operation_leg_payout_item_guard
  AFTER INSERT ON core.payment_payment_operation_leg
  REFERENCING NEW TABLE AS new_legs
  FOR EACH STATEMENT EXECUTE FUNCTION core.payout_release_item_guard();

-- 6. Fonctions internes (SECURITY INVOKER, aucun EXECUTE ; propriétaire cmd_money_owner) ---------

-- 6.1 N-ième jour ouvré du pays après `p_from` (samedi, dimanche et fériés de la dernière version
-- du calendrier exclus) ; NULL si N est hors de [1, 60] ou si le calendrier du pays manque pour
-- une année traversée (fail-closed, L3-PM-37).
CREATE FUNCTION core.payout_business_day(p_country text, p_from date, p_n integer)
  RETURNS date
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_version integer;
  v_day     date := p_from;
  v_count   integer := 0;
  v_year    integer;
BEGIN
  IF p_country IS NULL OR p_from IS NULL OR p_n IS NULL OR p_n < 1 OR p_n > 60 THEN
    RETURN NULL;
  END IF;
  SELECT pg_catalog.max(h.version) INTO v_version
    FROM core.config_holiday_calendar AS h WHERE h.country_code::text = p_country;
  IF v_version IS NULL THEN
    RETURN NULL;
  END IF;
  WHILE v_count < p_n LOOP
    v_day := v_day + 1;
    IF EXTRACT(ISODOW FROM v_day) < 6
       AND NOT EXISTS (SELECT 1 FROM core.config_holiday_calendar AS h
                        WHERE h.country_code::text = p_country AND h.version = v_version
                          AND h.date = v_day) THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  FOR v_year IN EXTRACT(YEAR FROM p_from)::integer .. EXTRACT(YEAR FROM v_day)::integer LOOP
    IF NOT EXISTS (SELECT 1 FROM core.config_holiday_calendar AS h
                    WHERE h.country_code::text = p_country AND h.version = v_version
                      AND h.date >= pg_catalog.make_date(v_year, 1, 1)
                      AND h.date < pg_catalog.make_date(v_year + 1, 1, 1)) THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN v_day;
END
$fn$;

-- 6.2 `payout_at` d'un trip (08 BR-PAYOUT-02, R08) : N-ième jour ouvré du pays après la date LOCALE
-- de la fin effective (fuseau du trip), à `payout_batch_local_time` minutes après minuit local ;
-- N = premier versement ? `first_payout_business_day` : `payout_business_day_offset`. NULL si une
-- donnée manque ou est illisible.
CREATE FUNCTION core.payout_schedule(p_trip_id uuid, p_first boolean)
  RETURNS timestamptz
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_end     timestamptz := core.payout_effective_end(p_trip_id);
  v_tz      text;
  v_country text;
  v_n       jsonb;
  v_minutes jsonb;
  v_day     date;
BEGIN
  SELECT t.timezone, t.country_code INTO v_tz, v_country
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  IF v_end IS NULL OR v_tz IS NULL OR p_first IS NULL THEN
    RETURN NULL;
  END IF;
  v_n := core.payout_param(CASE WHEN p_first THEN 'first_payout_business_day'
                                ELSE 'payout_business_day_offset' END, v_country);
  v_minutes := core.payout_param('payout_batch_local_time', v_country);
  IF v_n IS NULL OR pg_catalog.jsonb_typeof(v_n) <> 'number' OR (v_n #>> '{}') !~ '^[1-9][0-9]?$'
     OR v_minutes IS NULL OR pg_catalog.jsonb_typeof(v_minutes) <> 'number'
     OR (v_minutes #>> '{}') !~ '^(0|[1-9][0-9]{0,3})$'
     OR (v_minutes #>> '{}')::integer > 1439 THEN
    RETURN NULL;
  END IF;
  v_day := core.payout_business_day(v_country, (v_end AT TIME ZONE v_tz)::date,
                                    (v_n #>> '{}')::integer);
  IF v_day IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN (v_day::timestamp + pg_catalog.make_interval(mins => (v_minutes #>> '{}')::integer))
         AT TIME ZONE v_tz;
END
$fn$;

-- 6.3 Jambe HOST encore à libérer d'un trip : encaissé − débits (en vol compris), plafonné par la
-- jambe retenue de la version en tête du règlement s'il en existe une (RC-3, 0123).
CREATE FUNCTION core.payout_item_amount(p_trip_id uuid)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT GREATEST(0, LEAST(
           st.available - st.pending_debit,
           COALESCE((SELECT sl.kept_minor - sl.advance_minor - st.released - st.pending_release
                       FROM core.settlement_settlement AS s
                       JOIN core.settlement_settlement_leg AS sl
                         ON sl.settlement_id = s.id AND sl.leg = 'HOST'
                      WHERE s.trip_id = p_trip_id AND s.segment_no = 1
                        AND NOT EXISTS (SELECT 1 FROM core.settlement_settlement AS n
                                         WHERE n.supersedes_id = s.id)),
                    st.available - st.pending_debit)))::bigint
    FROM core.payment_trip_leg_state(p_trip_id) AS st
   WHERE st.leg = 'HOST'
$fn$;

-- 6.4 Motifs de retenue d'un lot, triés (vide ⇒ rien ne retient le versement)
CREATE FUNCTION core.payout_batch_hold_reasons(p_batch_id uuid)
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
    -- 17 §0.1 : interrupteur du pays, absent ⇒ false
    SELECT 'PAYOUTS_DISABLED' FROM b WHERE NOT core.config_go_live('payouts_enabled', b.country_code)
    UNION ALL
    -- variante B : fonds de tiers (17 §0.1, L3-PM-31) ; exécution non construite (lot C)
    SELECT 'FUNDS_HOLDING_DISABLED' FROM b
     WHERE b.variant = 'PLATFORM_MOR' AND NOT core.config_go_live('funds_holding_enabled', b.country_code)
    UNION ALL
    SELECT 'VARIANT_B_UNAVAILABLE' FROM b WHERE b.variant = 'PLATFORM_MOR'
    UNION ALL
    -- capacité bloquante inconnue = non (17 §2.8, L3-PM-38)
    SELECT 'HOST_PAYOUT_RAIL_UNAVAILABLE' FROM b
     WHERE pg_catalog.cardinality(
             core.payment_missing_blocking_capabilities(b.provider, b.country_code, b.variant)) > 0
    UNION ALL
    SELECT 'SUBMERCHANT_INACTIVE' FROM b
     WHERE NOT EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS s
                        WHERE s.psp_account_id = b.psp_account_id AND s.org_id = b.org_id
                          AND s.kyc_status = 'ACTIVE')
    UNION ALL
    -- compte de versement (US-707) : absent, non vérifié, changé il y a moins de 48 h
    SELECT h.r FROM b,
           pg_catalog.unnest(core.payout_payout_account_hold(b.org_id, b.currency, b.scheduled_for))
             AS h(r)
    UNION ALL
    -- litiges (08 SM-6, BR-PAYOUT-02 ; L3-PM-34) : jambe HOST gelée (chargeback, litige,
    -- réclamation), chargeback non échoué, trip sorti de COMPLETED
    SELECT lb.frozen_reason
      FROM core.payout_payout_item AS i
      JOIN core.settlement_trip_leg_balance AS lb
        ON lb.trip_id = i.trip_id AND lb.segment_no = i.segment_no AND lb.leg = i.leg
     WHERE i.batch_id = p_batch_id AND lb.frozen
    UNION ALL
    SELECT 'CHARGEBACK'
      FROM core.payout_payout_item AS i
     WHERE i.batch_id = p_batch_id
       AND EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                    WHERE o.trip_id = i.trip_id AND o.kind = 'CHARGEBACK' AND o.status <> 'FAILED')
    UNION ALL
    SELECT CASE WHEN t.status = 'IN_DISPUTE' THEN 'DISPUTE' ELSE 'TRIP_NOT_COMPLETED' END
      FROM core.payout_payout_item AS i
      JOIN core.booking_trip AS t ON t.id = i.trip_id
     WHERE i.batch_id = p_batch_id AND t.status <> 'COMPLETED'
  )
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT reasons.r ORDER BY reasons.r), ARRAY[]::text[])
    FROM reasons WHERE reasons.r IS NOT NULL
$fn$;

-- 6.5 Montants et état d'un lot NON compensé : items (recalculés si `p_netting`), brut,
-- compensation de la dette du host_ledger non encore compensée par un autre lot, net ; motifs de
-- retenue ; `p_netting` (échéance atteinte, aucun motif) ⇒ READY (net > 0) ou ZERO_NET.
CREATE FUNCTION core.payout_refresh_batch(p_batch_id uuid, p_netting boolean)
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
BEGIN
  SELECT x.id, x.org_id, x.currency, x.netted_at INTO v_b
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
  -- dette de l'hôte dans la devise (08 E5 : jamais entre devises), solde négatif du host_ledger
  SELECT GREATEST(0, -COALESCE(pg_catalog.sum(e.amount_minor), 0))::bigint INTO v_debt
    FROM core.settlement_host_ledger_entry AS e
   WHERE e.org_id = v_b.org_id AND e.currency = v_b.currency;
  SELECT COALESCE(pg_catalog.sum(x.netted_minor), 0)::bigint INTO v_other
    FROM core.payout_payout_batch AS x
   WHERE x.org_id = v_b.org_id AND x.currency = v_b.currency AND x.id <> p_batch_id
     AND x.netted_at IS NOT NULL;
  v_netted := LEAST(v_gross, GREATEST(0, v_debt - v_other));
  v_reasons := core.payout_batch_hold_reasons(p_batch_id);
  UPDATE core.payout_payout_batch AS x
     SET gross_minor = v_gross, netted_minor = v_netted, net_minor = v_gross - v_netted,
         hold_reasons = v_reasons,
         status = CASE
                    WHEN pg_catalog.cardinality(v_reasons) > 0 THEN 'ON_HOLD'
                    WHEN NOT p_netting THEN 'SCHEDULED'
                    WHEN v_gross - v_netted > 0 THEN 'READY'
                    ELSE 'ZERO_NET'
                  END,
         netted_at = CASE WHEN p_netting AND pg_catalog.cardinality(v_reasons) = 0
                          THEN platform.now() END
   WHERE x.id = p_batch_id;
END
$fn$;

-- 7. Commandes du travailleur payment_command (SECURITY DEFINER, EXECUTE app_worker) -------------

-- 7.1 Trips à préparer : COMPLETED, fin effective connue, jambe HOST, aucun item
CREATE FUNCTION core.payout_trips_to_prepare(p_limit integer)
  RETURNS TABLE (trip_id uuid, country_code text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payout: commands are reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'payout_command_forbidden';
  END IF;
  RETURN QUERY
    SELECT t.id, t.country_code
      FROM core.booking_trip AS t
      JOIN core.settlement_trip_leg_balance AS b
        ON b.trip_id = t.id AND b.segment_no = 1 AND b.leg = 'HOST'
     WHERE t.status = 'COMPLETED'
       AND NOT EXISTS (SELECT 1 FROM core.payout_payout_item AS i
                        WHERE i.trip_id = t.id AND i.segment_no = 1 AND i.leg = 'HOST')
       AND core.payout_effective_end(t.id) IS NOT NULL
     ORDER BY t.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END
$fn$;

-- 7.2 Préparation d'un trip (critères 1 et 2) : payout_at, release_at (écrivain unique), lot, item,
-- montants et motifs. Issues : PREPARED, ALREADY_PREPARED, TRIP_UNKNOWN, NOT_COMPLETED,
-- NO_EFFECTIVE_END, NO_HOST_LEG, NO_CAPTURE, CALENDAR_MISSING (rien n'est écrit sauf PREPARED).
CREATE FUNCTION core.payout_cmd_prepare_trip(p_trip_id uuid)
  RETURNS TABLE (outcome text, batch_id uuid, payout_at timestamptz, status text,
                 hold_reasons text[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_trip    record;
  v_batch   uuid;
  v_psp     uuid;
  v_mode    text;
  v_account uuid;
  v_first   boolean;
  v_at      timestamptz;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payout: commands are reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'payout_command_forbidden';
  END IF;
  -- verrou du trip d'abord (ordre commun : trip, lot, item ; comme les ordres d'argent)
  SELECT t.id, t.org_id, t.country_code, t.currency, t.status INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = p_trip_id FOR UPDATE;
  IF v_trip.id IS NULL THEN
    RETURN QUERY SELECT 'TRIP_UNKNOWN'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  -- rejeu : le trip est déjà dans un lot, rien n'est réécrit (L3-PM-33)
  SELECT i.batch_id INTO v_batch FROM core.payout_payout_item AS i
   WHERE i.trip_id = p_trip_id AND i.segment_no = 1 AND i.leg = 'HOST';
  IF v_batch IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_PREPARED'::text, x.id, x.scheduled_for, x.status, x.hold_reasons
                   FROM core.payout_payout_batch AS x WHERE x.id = v_batch;
    RETURN;
  END IF;
  IF v_trip.status IS DISTINCT FROM 'COMPLETED' THEN
    RETURN QUERY SELECT 'NOT_COMPLETED'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  IF core.payout_effective_end(p_trip_id) IS NULL THEN
    RETURN QUERY SELECT 'NO_EFFECTIVE_END'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.settlement_trip_leg_balance AS lb
                  WHERE lb.trip_id = p_trip_id AND lb.segment_no = 1 AND lb.leg = 'HOST') THEN
    RETURN QUERY SELECT 'NO_HOST_LEG'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  -- compte PSP du trip : celui de l'encaissement réussi (le premier)
  SELECT o.psp_account_id INTO v_psp
    FROM core.payment_payment_operation AS o
   WHERE o.trip_id = p_trip_id AND o.kind = 'CAPTURE' AND o.status = 'SUCCEEDED'
   ORDER BY o.created_at, o.id
   LIMIT 1;
  IF v_psp IS NULL THEN
    RETURN QUERY SELECT 'NO_CAPTURE'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  SELECT a.collection_mode INTO v_mode FROM core.payment_psp_account AS a WHERE a.id = v_psp;
  -- premier versement (J+5) : aucun lot émis vers le compte de versement COURANT de l'hôte
  -- (un compte changé repart au premier versement ; L3-PM-37)
  SELECT a.id INTO v_account FROM core.payout_payout_account AS a
   WHERE a.org_id = v_trip.org_id AND a.status IN ('PENDING', 'VERIFIED');
  v_first := v_account IS NULL
             OR NOT EXISTS (SELECT 1 FROM core.payout_payout_batch AS x
                             WHERE x.org_id = v_trip.org_id AND x.payout_account_id = v_account
                               AND x.status IN ('INITIATED', 'IN_TRANSIT', 'PAID'));
  v_at := core.payout_schedule(p_trip_id, v_first);
  IF v_at IS NULL THEN
    RETURN QUERY SELECT 'CALENDAR_MISSING'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  -- S-06 : écrivain unique de release_at, une fois (garde 5.1)
  UPDATE core.settlement_trip_leg_balance AS lb SET release_at = v_at
   WHERE lb.trip_id = p_trip_id AND lb.segment_no = 1 AND lb.leg = 'HOST' AND lb.release_at IS NULL;
  -- lot ouvert du jour (créé au besoin ; un concurrent qui l'a créé est relu)
  SELECT x.id INTO v_batch FROM core.payout_payout_batch AS x
   WHERE x.org_id = v_trip.org_id AND x.currency = v_trip.currency AND x.kind = 'FINAL'
     AND x.scheduled_for = v_at AND x.psp_account_id = v_psp AND x.netted_at IS NULL
     FOR UPDATE;
  IF v_batch IS NULL THEN
    INSERT INTO core.payout_payout_batch AS x
           (org_id, country_code, currency, kind, variant, psp_account_id, payout_account_id,
            first_payout, status, scheduled_for)
    VALUES (v_trip.org_id, v_trip.country_code, v_trip.currency, 'FINAL', v_mode, v_psp,
            v_account, v_first, 'SCHEDULED', v_at)
    ON CONFLICT DO NOTHING
    RETURNING x.id INTO v_batch;
    IF v_batch IS NULL THEN
      SELECT x.id INTO v_batch FROM core.payout_payout_batch AS x
       WHERE x.org_id = v_trip.org_id AND x.currency = v_trip.currency AND x.kind = 'FINAL'
         AND x.scheduled_for = v_at AND x.psp_account_id = v_psp AND x.netted_at IS NULL
         FOR UPDATE;
    END IF;
  END IF;
  INSERT INTO core.payout_payout_item
         (batch_id, trip_id, segment_no, leg, org_id, country_code, currency, amount_minor)
  VALUES (v_batch, p_trip_id, 1, 'HOST', v_trip.org_id, v_trip.country_code, v_trip.currency,
          core.payout_item_amount(p_trip_id));
  PERFORM core.payout_refresh_batch(v_batch, false);
  RETURN QUERY SELECT 'PREPARED'::text, x.id, x.scheduled_for, x.status, x.hold_reasons
                 FROM core.payout_payout_batch AS x WHERE x.id = v_batch;
END
$fn$;

-- 7.3 Lots à traiter : NET (échéance atteinte, non compensé), RELEASE (READY, ou ON_HOLD après
-- compensation : motifs relus), PAYOUT (INITIATED, IN_TRANSIT : lecture d'abord)
CREATE FUNCTION core.payout_batches_due(p_limit integer)
  RETURNS TABLE (batch_id uuid, step text, status text, country_code text, currency text,
                 provider text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payout: commands are reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'payout_command_forbidden';
  END IF;
  RETURN QUERY
    SELECT x.id,
           CASE WHEN x.netted_at IS NULL THEN 'NET'
                WHEN x.status IN ('READY', 'ON_HOLD') THEN 'RELEASE'
                ELSE 'PAYOUT' END,
           x.status, x.country_code, x.currency, a.provider
      FROM core.payout_payout_batch AS x
      JOIN core.payment_psp_account AS a ON a.id = x.psp_account_id
     WHERE (x.netted_at IS NULL AND x.status IN ('SCHEDULED', 'ON_HOLD')
            AND x.scheduled_for <= platform.now())
        OR (x.netted_at IS NOT NULL AND x.status IN ('READY', 'ON_HOLD', 'INITIATED', 'IN_TRANSIT'))
     ORDER BY x.scheduled_for, x.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
END
$fn$;

-- 7.4 Compensation à l'échéance (SM-6 SCHEDULED → NETTING → READY / ZERO_NET), motifs relus sous
-- les verrous des trips du lot puis du lot. Issues : READY, ZERO_NET, ON_HOLD, NOT_DUE,
-- ALREADY_NETTED, UNKNOWN.
CREATE FUNCTION core.payout_cmd_net_batch(p_batch_id uuid)
  RETURNS TABLE (outcome text, gross_minor bigint, netted_minor bigint, net_minor bigint,
                 hold_reasons text[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_b record;
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
  SELECT x.id, x.netted_at, x.scheduled_for INTO v_b
    FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RETURN QUERY SELECT 'UNKNOWN'::text, NULL::bigint, NULL::bigint, NULL::bigint, NULL::text[];
    RETURN;
  END IF;
  IF v_b.netted_at IS NOT NULL OR v_b.scheduled_for > platform.now() THEN
    RETURN QUERY SELECT CASE WHEN v_b.netted_at IS NOT NULL THEN 'ALREADY_NETTED' ELSE 'NOT_DUE' END,
                        x.gross_minor, x.netted_minor, x.net_minor, x.hold_reasons
                   FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id;
    RETURN;
  END IF;
  PERFORM core.payout_refresh_batch(p_batch_id, true);
  RETURN QUERY SELECT x.status, x.gross_minor, x.netted_minor, x.net_minor, x.hold_reasons
                 FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id;
END
$fn$;

-- 7.5 Motifs relus d'un lot compensé avant l'envoi (READY ⇄ ON_HOLD), sous les verrous des trips
-- puis du lot (gardés jusqu'au COMMIT, donc pendant les appels au PSP). Issues : READY, ON_HOLD,
-- l'état du lot sinon (rien à envoyer).
CREATE FUNCTION core.payout_cmd_recheck_batch(p_batch_id uuid)
  RETURNS TABLE (outcome text, hold_reasons text[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_status  text;
  v_netted  timestamptz;
  v_reasons text[];
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
  SELECT x.status, x.netted_at INTO v_status, v_netted
    FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id FOR UPDATE;
  IF v_status IS NULL OR v_netted IS NULL OR v_status NOT IN ('READY', 'ON_HOLD') THEN
    RETURN QUERY SELECT COALESCE(v_status, 'UNKNOWN'), ARRAY[]::text[];
    RETURN;
  END IF;
  v_reasons := core.payout_batch_hold_reasons(p_batch_id);
  UPDATE core.payout_payout_batch AS x
     SET hold_reasons = v_reasons,
         status = CASE WHEN pg_catalog.cardinality(v_reasons) > 0 THEN 'ON_HOLD' ELSE 'READY' END
   WHERE x.id = p_batch_id
     AND (x.hold_reasons IS DISTINCT FROM v_reasons
          OR x.status IS DISTINCT FROM CASE WHEN pg_catalog.cardinality(v_reasons) > 0
                                             THEN 'ON_HOLD' ELSE 'READY' END);
  RETURN QUERY SELECT CASE WHEN pg_catalog.cardinality(v_reasons) > 0 THEN 'ON_HOLD' ELSE 'READY' END,
                      v_reasons;
END
$fn$;

-- 7.6 Items d'un lot READY et leur ordre LEG_RELEASE (montants et clés STOCKÉS : rien n'est
-- calculé par l'appelant) : clé et rang de l'ordre à enregistrer si aucun ordre vivant, sinon
-- l'ordre vivant (statut, clé envoyée, référence PSP, report sur les soldes).
CREATE FUNCTION core.payout_release_items(p_batch_id uuid)
  RETURNS TABLE (item_id uuid, trip_id uuid, amount_minor bigint, currency text,
                 psp_account_id uuid, next_attempt integer, next_key text, operation_id uuid,
                 operation_status text, idem_sent text, provider_reference text, applied boolean,
                 beneficiary_reference text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payout: commands are reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'payout_command_forbidden';
  END IF;
  RETURN QUERY
    SELECT i.id, i.trip_id, i.amount_minor, i.currency, x.psp_account_id,
           i.release_attempt + 1,
           pg_catalog.format('release:%s:1:HOST:i%s', i.trip_id, i.release_attempt + 1),
           o.id, o.status, o.idem_sent, o.provider_reference,
           (o.id IS NOT NULL AND EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m
                                          WHERE m.operation_id = o.id)),
           (SELECT s.provider_submerchant_ref FROM core.payment_psp_submerchant AS s
             WHERE s.psp_account_id = x.psp_account_id AND s.org_id = x.org_id
               AND s.kyc_status = 'ACTIVE'
             ORDER BY s.attempt_no DESC LIMIT 1)
      FROM core.payout_payout_item AS i
      JOIN core.payout_payout_batch AS x ON x.id = i.batch_id
      LEFT JOIN core.payment_payment_operation AS o ON o.id = i.release_operation_id
     WHERE i.batch_id = p_batch_id AND x.status = 'READY' AND i.amount_minor > 0
     ORDER BY i.trip_id;
END
$fn$;

-- 7.7 Émission du versement du lot (`payout`, clé `payout:{lot}:r{n}`) : lot READY, chaque item à
-- montant positif libéré (ordre SUCCEEDED reporté sur les soldes), motifs relus ; un lot déjà
-- INITIATED ou IN_TRANSIT rend sa clé (REPLAY : lecture d'abord par l'appelant, jamais un renvoi
-- sans lecture). Issues : INITIATED, REPLAY, ON_HOLD, RELEASE_PENDING, l'état du lot sinon.
CREATE FUNCTION core.payout_cmd_initiate_batch(p_batch_id uuid)
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
  v_reasons text[];
  v_outcome text := 'REPLAY';
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
  SELECT x.id, x.status, x.attempt_no, x.org_id, x.psp_account_id INTO v_b
    FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id FOR UPDATE;
  IF v_b.id IS NULL THEN
    RETURN QUERY SELECT 'UNKNOWN'::text, NULL::text, NULL::bigint, NULL::text, NULL::text,
                        NULL::text, ARRAY[]::text[];
    RETURN;
  END IF;
  IF v_b.status = 'READY' THEN
    IF EXISTS (SELECT 1 FROM core.payout_payout_item AS i
                WHERE i.batch_id = p_batch_id AND i.amount_minor > 0
                  AND NOT EXISTS (SELECT 1
                                    FROM core.payment_payment_operation AS o
                                    JOIN core.settlement_leg_movement AS m ON m.operation_id = o.id
                                   WHERE o.id = i.release_operation_id AND o.status = 'SUCCEEDED')) THEN
      RETURN QUERY SELECT 'RELEASE_PENDING'::text, NULL::text, NULL::bigint, NULL::text,
                          NULL::text, NULL::text, ARRAY[]::text[];
      RETURN;
    END IF;
    -- relu À L'ENVOI (L3-PM-30, L3-PM-34) : interrupteur, gel, compte, capacités
    v_reasons := core.payout_batch_hold_reasons(p_batch_id);
    IF pg_catalog.cardinality(v_reasons) > 0 THEN
      UPDATE core.payout_payout_batch AS x SET status = 'ON_HOLD', hold_reasons = v_reasons
       WHERE x.id = p_batch_id;
      RETURN QUERY SELECT 'ON_HOLD'::text, NULL::text, NULL::bigint, NULL::text, NULL::text,
                          NULL::text, v_reasons;
      RETURN;
    END IF;
    UPDATE core.payout_payout_batch AS x
       SET status = 'INITIATED', attempt_no = v_b.attempt_no + 1,
           idempotency_key = pg_catalog.format('payout:%s:r%s', p_batch_id, v_b.attempt_no + 1),
           initiated_at = platform.now()
     WHERE x.id = p_batch_id;
    v_outcome := 'INITIATED';
  ELSIF v_b.status NOT IN ('INITIATED', 'IN_TRANSIT') THEN
    RETURN QUERY SELECT v_b.status, NULL::text, NULL::bigint, NULL::text, NULL::text, NULL::text,
                        ARRAY[]::text[];
    RETURN;
  END IF;
  RETURN QUERY
    SELECT v_outcome, x.idempotency_key, x.net_minor, x.currency,
           (SELECT s.provider_submerchant_ref FROM core.payment_psp_submerchant AS s
             WHERE s.psp_account_id = x.psp_account_id AND s.org_id = x.org_id
               AND s.kyc_status = 'ACTIVE'
             ORDER BY s.attempt_no DESC LIMIT 1),
           x.provider_ref, ARRAY[]::text[]
      FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id;
END
$fn$;

-- 7.8 Résultat du versement reçu du PSP : PENDING / SUBMITTED ⇒ IN_TRANSIT ; SUCCEEDED ⇒ PAID ;
-- FAILED ⇒ FAILED (coordonnées à corriger, SM-6) ; UNKNOWN ⇒ inchangé (lecture d'abord au
-- passage suivant). Rend l'état du lot.
CREATE FUNCTION core.payout_cmd_record_payout_result(p_batch_id uuid, p_status text,
                                                     p_provider_ref text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_status text;
  v_next   text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payout: commands are reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'payout_command_forbidden';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN')
     OR (p_provider_ref IS NOT NULL AND p_provider_ref !~ '^[A-Za-z0-9_.:-]{1,128}$') THEN
    RAISE EXCEPTION 'payout: invalid payout result' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.status INTO v_status FROM core.payout_payout_batch AS x WHERE x.id = p_batch_id FOR UPDATE;
  IF v_status IS NULL OR v_status NOT IN ('INITIATED', 'IN_TRANSIT') OR p_status = 'UNKNOWN' THEN
    RETURN COALESCE(v_status, 'UNKNOWN');
  END IF;
  v_next := CASE p_status WHEN 'SUCCEEDED' THEN 'PAID' WHEN 'FAILED' THEN 'FAILED'
                          ELSE 'IN_TRANSIT' END;
  IF v_next IS DISTINCT FROM v_status OR p_provider_ref IS NOT NULL THEN
    UPDATE core.payout_payout_batch AS x
       SET status = v_next, provider_ref = COALESCE(p_provider_ref, x.provider_ref),
           paid_at = CASE WHEN v_next = 'PAID' THEN platform.now() END
     WHERE x.id = p_batch_id;
  END IF;
  RETURN v_next;
END
$fn$;

-- 8. Commentaires et droits (posés par migrator, encore propriétaire), puis propriétaire --------
COMMENT ON FUNCTION core.payout_effective_end(uuid) IS
  'Fin effective d''un trip : première transition RETURNED du journal d''état. US-708 (ADR-185).';
COMMENT ON FUNCTION core.settlement_release_at_guard() IS
  'Garde de trip_leg_balance.release_at : écrit une fois, jambe HOST, trip COMPLETED, ≥ fin '
  'effective + 24 h ; écrivain unique payout_cmd_prepare_trip (S-06). US-708 (ADR-185).';
COMMENT ON FUNCTION core.payout_release_item_guard() IS
  'Garde des ordres LEG_RELEASE de la jambe HOST : un seul ordre vivant par trip ; l''ordre d''un '
  'item de lot porte sa clé, son rang et son montant, lot READY. US-708 (ADR-185).';
COMMENT ON FUNCTION core.payout_business_day(text, date, integer) IS
  'N-ième jour ouvré du pays (fériés de la dernière version du calendrier, samedi et dimanche '
  'exclus) ; NULL si le calendrier manque. US-708 (ADR-185).';
COMMENT ON FUNCTION core.payout_schedule(uuid, boolean) IS
  'payout_at d''un trip (08 BR-PAYOUT-02) : J+2 ouvrés du pays, J+5 au premier versement, heure '
  'locale du lot. US-708 (ADR-185).';
COMMENT ON FUNCTION core.payout_item_amount(uuid) IS
  'Jambe HOST encore à libérer d''un trip (en vol compris, plafond de la version en tête). US-708.';
COMMENT ON FUNCTION core.payout_batch_hold_reasons(uuid) IS
  'Motifs de retenue d''un lot de versement (interrupteurs, variante B, capacités, sous-marchand, '
  'compte, gels et litiges). US-708 (ADR-185).';
COMMENT ON FUNCTION core.payout_refresh_batch(uuid, boolean) IS
  'Montants (brut, compensation du host_ledger, net), motifs et état d''un lot non compensé. US-708.';
COMMENT ON FUNCTION core.payout_trips_to_prepare(integer) IS
  'Trips COMPLETED à mettre dans un lot de versement. Travailleur payment_command. US-708.';
COMMENT ON FUNCTION core.payout_cmd_prepare_trip(uuid) IS
  'Préparation du versement d''un trip : payout_at, release_at (écrivain unique), lot, item, '
  'montants, motifs. Travailleur payment_command. US-708 (ADR-185).';
COMMENT ON FUNCTION core.payout_batches_due(integer) IS
  'Lots de versement à traiter (compensation, libérations, versement). Travailleur payment_command. US-708.';
COMMENT ON FUNCTION core.payout_cmd_net_batch(uuid) IS
  'Compensation d''un lot à son échéance (READY, ZERO_NET ou ON_HOLD). Travailleur payment_command. US-708.';
COMMENT ON FUNCTION core.payout_cmd_recheck_batch(uuid) IS
  'Motifs relus d''un lot compensé avant l''envoi (READY ou ON_HOLD). Travailleur payment_command. US-708.';
COMMENT ON FUNCTION core.payout_release_items(uuid) IS
  'Items d''un lot READY et leur ordre LEG_RELEASE (clés et montants stockés). Travailleur payment_command. US-708.';
COMMENT ON FUNCTION core.payout_cmd_initiate_batch(uuid) IS
  'Émission du versement d''un lot (clé payout:{lot}:r{n}) après les libérations, motifs relus. '
  'Travailleur payment_command. US-708 (ADR-185).';
COMMENT ON FUNCTION core.payout_cmd_record_payout_result(uuid, text, text) IS
  'Résultat du versement d''un lot reçu du PSP (IN_TRANSIT, PAID, FAILED). Travailleur payment_command. US-708.';

REVOKE ALL ON FUNCTION
  core.payout_effective_end(uuid),
  core.payout_business_day(text, date, integer),
  core.payout_schedule(uuid, boolean),
  core.payout_item_amount(uuid),
  core.payout_batch_hold_reasons(uuid),
  core.payout_refresh_batch(uuid, boolean),
  core.payout_trips_to_prepare(integer),
  core.payout_cmd_prepare_trip(uuid),
  core.payout_batches_due(integer),
  core.payout_cmd_net_batch(uuid),
  core.payout_cmd_recheck_batch(uuid),
  core.payout_release_items(uuid),
  core.payout_cmd_initiate_batch(uuid),
  core.payout_cmd_record_payout_result(uuid, text, text)
FROM PUBLIC;
-- les déclencheurs (5.1, 5.2) s'exécutent sous l'écrivain : cmd_money_owner (commandes d'argent)
-- ou migrator ; la fin effective leur est nécessaire
GRANT EXECUTE ON FUNCTION core.payout_effective_end(uuid) TO cmd_money_owner;
GRANT EXECUTE ON FUNCTION
  core.payout_trips_to_prepare(integer),
  core.payout_cmd_prepare_trip(uuid),
  core.payout_batches_due(integer),
  core.payout_cmd_net_batch(uuid),
  core.payout_cmd_recheck_batch(uuid),
  core.payout_release_items(uuid),
  core.payout_cmd_initiate_batch(uuid),
  core.payout_cmd_record_payout_result(uuid, text, text)
TO app_worker;

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.payout_effective_end(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_business_day(text, date, integer) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_schedule(uuid, boolean) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_item_amount(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_batch_hold_reasons(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_refresh_batch(uuid, boolean) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_trips_to_prepare(integer) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_cmd_prepare_trip(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_batches_due(integer) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_cmd_net_batch(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_cmd_recheck_batch(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_release_items(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_cmd_initiate_batch(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_cmd_record_payout_result(uuid, text, text) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payout_release_item_guard() OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
