-- 0180 — PYO / PAY / STL : report de la jambe HOST des frais annexes, dommages et amendes débités
-- (débits post-trip MIT hors loyer) sur la jambe HOST du trip, puis dans le versement suivant de
-- l'hôte.
-- US-319 ; BOARD N-463 (revues de #292 US-706 et #293 US-318 ; passation US-703, ADR-189 « Pour
-- US-309 / US-706 ») ; 08 E7 règles 1 et 6, SM-6, BR-REIMB-04 (part de l'hôte : 100 % des frais
-- annexes et amendes), BR-PAY-09 bis, BR-PAYOUT-02 ; 17 v6 §0.1 (interrupteurs, aucun fonds de
-- tiers détenu), §2.8 (`releaseLeg`, clé `release:{trip_id}:{segment_id}:{leg}:i{n}`), §3.2.9 ;
-- ADR-185 (lots, US-708), ADR-187 (grand livre, US-709), ADR-189 (débits post-trip, US-703),
-- ADR-195 (US-309), ADR-197 (US-706), ADR-198 (US-318) ; ADR-200 (cette migration, PROPOSÉ).
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-200, PROPOSÉS, fail-closed, comme Turo : le remboursement d'un frais va à l'hôte
-- avec son versement suivant) :
--   1. Report sur la jambe du trip (critère 1) : `core.payment_cmd_settle_mit_attempt` reporte
--      TOUT débit post-trip débité (SUCCEEDED, preuve rattachée) par
--      `core.settlement_cmd_apply_leg_movement`, aux montants explicites de sa tentative (jambes
--      HOST, INSURER, TAX_THIRD_PARTY, PLATFORM du débit, jamais un prorata) ; `leg_reported` n'est
--      vrai qu'après ce mouvement. Sans preuve ⇒ AWAITING_PROOF (comme le loyer). Le report sur
--      les soldes n'admet un ordre MIT hors loyer que s'il est celui d'une tentative d'un débit
--      post-trip de ce trip et de ce but ; remboursement, encaissement de dette ou réaffectation
--      hors loyer restent refusés (`leg_movement_unsupported`).
--   2. Versement suivant (critère 2) : un débit reporté dont la part HOST est > 0 devient une
--      part d'un item `POST_TRIP_CHARGE` (table de liaison `payout_item_charge`, montant = part
--      HOST explicite du débit) dans le lot OUVERT suivant de l'hôte : `payout_at` = N-ième jour
--      ouvré du pays après la date locale du report (mêmes paramètres et calendrier que le trip,
--      J+5 au premier versement), un item par (lot, trip). Seulement quand l'item du trip lui-même
--      est compensé (montant figé) : la part n'est jamais comptée deux fois. Le montant de l'item du
--      trip exclut les parts des débits post-trip (`core.payout_item_amount`). Clé de la
--      libération : rang suivant de la jambe HOST du trip (`i{n}`, 17 §2.8), un ordre vivant par
--      item ; registre miroir : la jambe HOST du trip reçoit la part (encaissé) puis la libère.
--   3. Débit échoué, remboursé ou contesté (critère 3) : échoué ⇒ jamais reporté (aucun SUCCEEDED) ;
--      aucun remboursement d'un débit post-trip n'existe (refusé au report, ci-dessus) ; chargeback
--      ouvert sur le trip ⇒ jambe HOST gelée et motif CHARGEBACK du lot (0155, 0167) : la part est
--      retenue tant que le motif est ouvert ; chargeback perdu après le débit ⇒ part contre-passée
--      (montant 0 à la compensation, la part reste chez le PSP). Tous les motifs de
--      `core.payout_batch_hold_reasons` s'appliquent à l'item (trip, lot).
--   4. Aucun fonds de tiers détenu (critère 4) : mouvements par `apply_leg_movement` (refus de tout
--      mode autre que SPLIT_AT_SOURCE sans `funds_holding_enabled`), lots en variante B retenus
--      (0165) ; aucun interrupteur écrit ; aucune constante de pays ; heure de la base.
--
-- Codes (packages/db/src/errors.ts) : payout_item_trip_leg_unique, payout_item_charge_batch_trip_unique
-- (23P01) → INVARIANT_VIOLATION ; payout_item_charge_pkey (23505) → INVARIANT_VIOLATION ;
-- payout_item_charge_mismatch (23000) → INVARIANT_VIOLATION ; payout_item_charge_immutable (23000)
-- → IMMUTABLE_RECORD.
--
-- Expand / contract : colonne `payout_payout_item.kind` AJOUTÉE avec un défaut (`TRIP` : la version
-- N insère des items de trip sans la nommer) ; contrainte `payout_item_trip_leg_unique` remplacée
-- sous le même nom (unique → exclusion restreinte aux items TRIP : même règle pour la version N) ;
-- table, fonctions, politiques et droits AJOUTÉS ; corps remplacés à signature, propriétaire et
-- droits identiques (0123, 0165, 0167, 0169, 0172 recopiés, blocs marqués US-319). La version N de
-- l'API n'appelle pas les nouvelles commandes.
--
-- Retour arrière (jamais en production : nouvelle migration à la place) :
--   réappliquer core.settlement_cmd_apply_leg_movement de 0123, core.payment_cmd_settle_mit_attempt
--     de 0169, core.payout_refresh_batch de 0167, core.payout_trips_to_prepare,
--     core.payout_cmd_prepare_trip, core.payout_release_items, core.payout_release_item_guard,
--     core.payout_item_amount et core.payout_schedule de 0165 (sous cmd_money_owner),
--     core.settlement_release_blocker de 0172 et core.payout_payout_item_guard de 0165 (sous
--     migrator) ;
--   DROP FUNCTION core.payout_cmd_prepare_charge(uuid), core.payout_charges_to_prepare(integer),
--     core.payout_release_operation_hold_reasons(uuid), core.payout_next_release_rank(uuid, uuid),
--     core.payout_charge_item_amount(uuid), core.payout_schedule_after(uuid, timestamptz, boolean) ;
--   DROP TABLE core.payout_item_charge ; DROP FUNCTION core.payout_item_charge_guard() ;
--   ALTER TABLE core.payout_payout_item DROP CONSTRAINT payout_item_charge_batch_trip_unique,
--     DROP CONSTRAINT payout_item_trip_leg_unique,
--     ADD CONSTRAINT payout_item_trip_leg_unique UNIQUE (trip_id, segment_no, leg),
--     DROP COLUMN kind (aucun item POST_TRIP_CHARGE ne doit exister).

-- 1. Items de lot : nature (trip ou débit post-trip) et unicités -----------------------------------
ALTER TABLE core.payout_payout_item
  ADD COLUMN kind text NOT NULL DEFAULT 'TRIP'
    CONSTRAINT payout_item_kind_valid CHECK (kind IN ('TRIP', 'POST_TRIP_CHARGE'));
COMMENT ON COLUMN core.payout_payout_item.kind IS
  'TRIP : jambe HOST du trip (un item par trip, L3-PM-33) ; POST_TRIP_CHARGE : parts HOST des '
  'débits post-trip reportés (frais annexes, dommages, amendes), un item par (lot, trip). US-319.';
-- un trip n'entre que dans UN lot pour sa jambe (règle de 0165 inchangée pour les items TRIP) ; au
-- plus un item de débits post-trip par (lot, trip)
ALTER TABLE core.payout_payout_item
  DROP CONSTRAINT payout_item_trip_leg_unique,
  ADD CONSTRAINT payout_item_trip_leg_unique
    EXCLUDE USING btree (trip_id WITH =, segment_no WITH =, leg WITH =) WHERE (kind = 'TRIP'),
  ADD CONSTRAINT payout_item_charge_batch_trip_unique
    EXCLUDE USING btree (batch_id WITH =, trip_id WITH =) WHERE (kind = 'POST_TRIP_CHARGE');

-- 1.1 Parts HOST des débits post-trip rattachées à un item (classe A, ajout seul) : une part par
-- débit, montant = part HOST explicite du débit (jamais un prorata)
CREATE TABLE core.payout_item_charge (
  charge_id    uuid        NOT NULL
    CONSTRAINT payout_item_charge_pkey PRIMARY KEY
    CONSTRAINT payout_item_charge_charge_fk REFERENCES core.payment_post_trip_charge (id),
  item_id      uuid        NOT NULL
    CONSTRAINT payout_item_charge_item_fk REFERENCES core.payout_payout_item (id),
  amount_minor bigint      NOT NULL
    CONSTRAINT payout_item_charge_amount_positive CHECK (amount_minor > 0),
  created_at   timestamptz NOT NULL DEFAULT platform.now()
);
CREATE INDEX payout_item_charge_item_idx ON core.payout_item_charge (item_id);
COMMENT ON TABLE core.payout_item_charge IS
  'PYO : part HOST d''un débit post-trip reporté (frais annexe, dommage, amende) rattachée à un '
  'item POST_TRIP_CHARGE du lot suivant de l''hôte ; montant explicite du débit ; ajout seul. '
  'US-319 (ADR-200).';

-- 1.2 Garde : ajout seul ; la part est celle du débit (même trip, part HOST, débit reporté) et
-- l'item est un item de débits post-trip du même trip, encore sans ordre (SECURITY INVOKER,
-- propriétaire migrator, exécutée sous l'écrivain cmd_money_owner)
CREATE FUNCTION core.payout_item_charge_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'payout_item_charge: insert only'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_item_charge_immutable';
  END IF;
  IF NOT EXISTS (
       SELECT 1
         FROM core.payment_post_trip_charge AS c
         JOIN core.payout_payout_item AS i ON i.id = NEW.item_id
        WHERE c.id = NEW.charge_id AND c.status = 'CHARGED' AND c.leg_reported
          AND c.purpose IN ('INCIDENTAL', 'DAMAGE', 'OTHER_DEBT')
          AND c.leg_host_minor = NEW.amount_minor
          AND i.kind = 'POST_TRIP_CHARGE' AND i.trip_id = c.trip_id AND i.segment_no = 1
          AND i.leg = 'HOST' AND i.currency = c.currency AND i.release_operation_id IS NULL) THEN
    RAISE EXCEPTION 'payout_item_charge: share differs from its post-trip charge'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'payout_item_charge_mismatch';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payout_item_charge_guard() FROM PUBLIC;
CREATE TRIGGER payout_item_charge_guard BEFORE INSERT OR UPDATE OR DELETE ON core.payout_item_charge
  FOR EACH ROW EXECUTE FUNCTION core.payout_item_charge_guard();
CREATE TRIGGER payout_item_charge_no_truncate BEFORE TRUNCATE ON core.payout_item_charge
  FOR EACH STATEMENT EXECUTE FUNCTION core.payout_item_charge_guard();

-- 1.3 RLS : aucun rôle applicatif ; commandes de cmd_money_owner (travailleur payment_command)
ALTER TABLE core.payout_item_charge ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payout_item_charge FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payout_item_charge TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.payout_item_charge FROM PUBLIC;
GRANT SELECT, INSERT ON core.payout_item_charge TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.payout_item_charge FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.payout_item_charge FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

-- 2. Garde des items (0165, même signature, propriétaire migrator) : + nature figée --------
CREATE OR REPLACE FUNCTION core.payout_payout_item_guard()
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
     -- US-319 : la nature de l'item (TRIP, POST_TRIP_CHARGE) est figée
     OR NEW.kind IS DISTINCT FROM OLD.kind
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

-- 3. Fonctions de cmd_money_owner (propriétaire des commandes d'argent) ---------------------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 3.1 Part HOST d'un item de débits post-trip (SECURITY INVOKER, aucun EXECUTE) : Σ des parts
-- explicites rattachées, sauf part contre-passée — chargeback PERDU (SUCCEEDED) sur le trip reçu
-- après l'ordre MIT réussi du débit (fail-closed : la part reste chez le PSP, revue FIN)
CREATE FUNCTION core.payout_charge_item_amount(p_item_id uuid)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(pg_catalog.sum(l.amount_minor), 0)::bigint
    FROM core.payout_item_charge AS l
   WHERE l.item_id = p_item_id
     AND NOT EXISTS (
           SELECT 1
             FROM core.payment_post_trip_charge_attempt AS a
             JOIN core.payment_payment_operation AS m ON m.id = a.operation_id
             JOIN core.payment_payment_operation AS cb
               ON cb.trip_id = m.trip_id AND cb.kind = 'CHARGEBACK' AND cb.status = 'SUCCEEDED'
                  AND cb.created_at >= m.created_at
            WHERE a.charge_id = l.charge_id AND a.settled = 'SUCCEEDED')
$fn$;

-- 3.2 Jambe HOST encore à libérer d'un trip, POUR SON ITEM TRIP (0165, même signature) : encaissé −
-- débits (en vol compris), plafonné par la jambe retenue de la version en tête du règlement s'il en
-- existe une (RC-3, 0123) ; US-319 : hors parts HOST des débits post-trip reportés sur la jambe
-- (`ch`), qui sont versées par leurs propres items, et hors libérations de ces items (`rel`,
-- comprises dans `released` et `pending_release`) — jamais comptées deux fois.
CREATE OR REPLACE FUNCTION core.payout_item_amount(p_trip_id uuid)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH ch AS (
    SELECT COALESCE(pg_catalog.sum(l.amount_minor), 0)::numeric AS v
      FROM core.payment_payment_operation AS o
      JOIN core.payment_payment_operation_leg AS l ON l.operation_id = o.id AND l.leg = 'HOST'
     WHERE o.trip_id = p_trip_id AND o.kind = 'MIT_CHARGE' AND o.status = 'SUCCEEDED'
       AND o.purpose IN ('INCIDENTAL', 'DAMAGE', 'OTHER_DEBT')
       AND EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m WHERE m.operation_id = o.id)),
  rel AS (
    SELECT COALESCE(pg_catalog.sum(o.amount_minor), 0)::numeric AS v
      FROM core.payout_payout_item AS i
      JOIN core.payment_payment_operation AS o ON o.id = i.release_operation_id
     WHERE i.trip_id = p_trip_id AND i.kind = 'POST_TRIP_CHARGE' AND o.status <> 'FAILED')
  SELECT GREATEST(0, LEAST(
           st.available - st.pending_debit - (ch.v - rel.v),
           COALESCE((SELECT sl.kept_minor - sl.advance_minor - st.released - st.pending_release
                            + rel.v
                       FROM core.settlement_settlement AS s
                       JOIN core.settlement_settlement_leg AS sl
                         ON sl.settlement_id = s.id AND sl.leg = 'HOST'
                      WHERE s.trip_id = p_trip_id AND s.segment_no = 1
                        AND NOT EXISTS (SELECT 1 FROM core.settlement_settlement AS n
                                         WHERE n.supersedes_id = s.id)),
                    st.available - st.pending_debit - (ch.v - rel.v))))::bigint
    FROM core.payment_trip_leg_state(p_trip_id) AS st, ch, rel
   WHERE st.leg = 'HOST'
$fn$;

-- 3.3 `payout_at` après un instant donné (0165 §6.2 généralisée) : N-ième jour ouvré du pays après
-- la date LOCALE de `p_from` (fuseau du trip), à `payout_batch_local_time` ; N = premier versement ?
-- `first_payout_business_day` : `payout_business_day_offset` ; jamais avant `p_from` + 24 h (jour
-- ouvré suivant). NULL si une donnée manque ou est illisible. `p_from` : fin effective (trip) ou
-- heure du report (débit post-trip).
CREATE FUNCTION core.payout_schedule_after(p_trip_id uuid, p_from timestamptz, p_first boolean)
  RETURNS timestamptz
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_end     timestamptz := p_from;
  v_tz      text;
  v_country text;
  v_n       jsonb;
  v_minutes jsonb;
  v_day     date;
  v_at      timestamptz;
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
  v_at := (v_day::timestamp + pg_catalog.make_interval(mins => (v_minutes #>> '{}')::integer))
          AT TIME ZONE v_tz;
  WHILE v_at < v_end + interval '24 hours' LOOP
    v_day := core.payout_business_day(v_country, v_day, 1);
    IF v_day IS NULL THEN
      RETURN NULL;
    END IF;
    v_at := (v_day::timestamp + pg_catalog.make_interval(mins => (v_minutes #>> '{}')::integer))
            AT TIME ZONE v_tz;
  END LOOP;
  RETURN v_at;
END
$fn$;

-- 3.4 `payout_at` d'un trip (0165, même signature et même résultat) : après la fin effective
CREATE OR REPLACE FUNCTION core.payout_schedule(p_trip_id uuid, p_first boolean)
  RETURNS timestamptz
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RETURN core.payout_schedule_after(p_trip_id, core.payout_effective_end(p_trip_id), p_first);
END
$fn$;

-- 3.5 Rang suivant d'une libération de la jambe HOST d'un trip (`i{n}` de
-- `release:{trip}:1:HOST:i{n}`, 17 §2.8) : 1 + plus haut rang des ordres LEG_RELEASE HOST du trip
-- (tout statut), hors `p_exclude` ; 1 sans ordre. Pour un trip à un seul item : `release_attempt
-- + 1` de 0165 (un seul ordre vivant, n + 1 après un refus reçu).
CREATE FUNCTION core.payout_next_release_rank(p_trip_id uuid, p_exclude uuid)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT 1 + COALESCE(pg_catalog.max(o.attempt_no), 0)
    FROM core.payment_payment_operation AS o
   WHERE o.trip_id = p_trip_id AND o.kind = 'LEG_RELEASE'
     AND o.id IS DISTINCT FROM p_exclude
     AND EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
                  WHERE l.operation_id = o.id AND l.leg = 'HOST' AND l.amount_minor > 0)
$fn$;

-- 3.6 Motifs de retenue du lot de l'item qui porte un ordre LEG_RELEASE (NULL : ordre rattaché à
-- aucun item), relus par la garde de libération (`settlement_release_blocker`, §12) à l'ordre et au
-- report. SECURITY DEFINER, aucun EXECUTE (comme `payout_release_hold_reasons` de 0172).
CREATE FUNCTION core.payout_release_operation_hold_reasons(p_operation_id uuid)
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.payout_batch_hold_reasons(i.batch_id)
    FROM core.payout_payout_item AS i
   WHERE i.release_operation_id = p_operation_id
$fn$;

-- 4. Ordre LEG_RELEASE de la jambe HOST d'un trip mis en lot (0165 §5.2, même signature) : US-319,
-- un trip peut porter plusieurs items (son item TRIP, puis un item POST_TRIP_CHARGE par lot suivant)
-- ; un seul ordre vivant PAR ITEM. L'ordre est celui d'un item libre (aucun ordre, ou ordre refusé
-- FAILED) d'un lot READY, de même montant ; rang n = 1 + plus haut rang des autres ordres HOST du
-- trip (§3.5) et clé `release:{trip}:1:HOST:i{n}` ; il y est rattaché. Ordre des refus de 0165
-- conservé : second ordre vivant (`payout_release_duplicate`), lot non READY
-- (`payout_release_batch_not_ready`), variante B fermée (`payout_batch_funds_holding_disabled`),
-- montant, clé ou rang (`payout_release_item_mismatch`). Hors lot : gardes de 0054 / 0123 seules.
CREATE OR REPLACE FUNCTION core.payout_release_item_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r      record;
  v_item record;
  v_n    integer;
BEGIN
  FOR r IN
    SELECT o.id, o.trip_id, o.idem_plain, o.amount_minor, o.attempt_no
      FROM core.payment_payment_operation AS o
     WHERE o.id IN (SELECT n.operation_id FROM new_legs AS n
                     WHERE n.leg = 'HOST' AND n.amount_minor > 0)
       AND o.kind = 'LEG_RELEASE' AND o.trip_id IS NOT NULL
     ORDER BY o.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM core.payout_payout_item AS i
                    WHERE i.trip_id = r.trip_id AND i.segment_no = 1 AND i.leg = 'HOST') THEN
      CONTINUE;
    END IF;
    -- ordre des verrous : trip (tenu par la commande), lots, items (même ordre que 0165)
    PERFORM 1 FROM core.payout_payout_batch AS b
     WHERE b.id IN (SELECT i.batch_id FROM core.payout_payout_item AS i
                     WHERE i.trip_id = r.trip_id AND i.segment_no = 1 AND i.leg = 'HOST')
     ORDER BY b.id
       FOR UPDATE;
    PERFORM 1 FROM core.payout_payout_item AS i
     WHERE i.trip_id = r.trip_id AND i.segment_no = 1 AND i.leg = 'HOST'
     ORDER BY i.id
       FOR UPDATE;
    -- un seul ordre vivant par item (L3-PM-33) : aucun item libre et un autre ordre vivant ⇒ doublon
    IF NOT EXISTS (SELECT 1 FROM core.payout_payout_item AS i
                    WHERE i.trip_id = r.trip_id AND i.segment_no = 1 AND i.leg = 'HOST'
                      AND (i.release_operation_id IS NULL
                           OR EXISTS (SELECT 1 FROM core.payment_payment_operation AS o3
                                       WHERE o3.id = i.release_operation_id
                                         AND o3.status = 'FAILED')))
       OR EXISTS (SELECT 1
                    FROM core.payment_payment_operation AS o2
                    JOIN core.payment_payment_operation_leg AS l2 ON l2.operation_id = o2.id
                   WHERE o2.trip_id = r.trip_id AND o2.id <> r.id AND o2.kind = 'LEG_RELEASE'
                     AND o2.status <> 'FAILED' AND l2.leg = 'HOST' AND l2.amount_minor > 0
                     AND NOT EXISTS (SELECT 1 FROM core.payout_payout_item AS i2
                                      WHERE i2.release_operation_id = o2.id)) THEN
      RAISE EXCEPTION 'payout: a live HOST release already exists for trip %', r.trip_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_release_duplicate';
    END IF;
    -- un item libre d'un lot READY (le plus ancien lot d'abord : lot échu, puis item)
    IF NOT EXISTS (SELECT 1
                     FROM core.payout_payout_item AS i
                     JOIN core.payout_payout_batch AS b ON b.id = i.batch_id
                    WHERE i.trip_id = r.trip_id AND i.segment_no = 1 AND i.leg = 'HOST'
                      AND b.status = 'READY'
                      AND (i.release_operation_id IS NULL
                           OR EXISTS (SELECT 1 FROM core.payment_payment_operation AS o3
                                       WHERE o3.id = i.release_operation_id
                                         AND o3.status = 'FAILED'))) THEN
      RAISE EXCEPTION 'payout: batch of trip % is not ready', r.trip_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_release_batch_not_ready';
    END IF;
    SELECT i.id, i.release_attempt, b.variant, b.country_code INTO v_item
      FROM core.payout_payout_item AS i
      JOIN core.payout_payout_batch AS b ON b.id = i.batch_id
     WHERE i.trip_id = r.trip_id AND i.segment_no = 1 AND i.leg = 'HOST'
       AND b.status = 'READY' AND i.amount_minor = r.amount_minor
       AND (i.release_operation_id IS NULL
            OR EXISTS (SELECT 1 FROM core.payment_payment_operation AS o3
                        WHERE o3.id = i.release_operation_id AND o3.status = 'FAILED'))
     ORDER BY b.scheduled_for, b.id, i.id
     LIMIT 1;
    IF v_item.id IS NULL THEN
      RAISE EXCEPTION 'payout: release of trip % differs from its payout item', r.trip_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_release_item_mismatch';
    END IF;
    -- variante B (fonds détenus par Kmino) : refus avant tout ordre sans l'interrupteur (L3-PM-31)
    IF v_item.variant = 'PLATFORM_MOR'
       AND NOT core.config_go_live('funds_holding_enabled', v_item.country_code) THEN
      RAISE EXCEPTION 'payout: funds holding is disabled in %', v_item.country_code
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_batch_funds_holding_disabled';
    END IF;
    v_n := core.payout_next_release_rank(r.trip_id, r.id);
    IF r.idem_plain IS DISTINCT FROM pg_catalog.format('release:%s:1:HOST:i%s', r.trip_id, v_n)
       OR r.attempt_no IS DISTINCT FROM v_n THEN
      RAISE EXCEPTION 'payout: release of trip % differs from its payout item', r.trip_id
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'payout_release_item_mismatch';
    END IF;
    UPDATE core.payout_payout_item AS i
       SET release_operation_id = r.id, release_attempt = v_n
     WHERE i.id = v_item.id;
  END LOOP;
  RETURN NULL;
END
$fn$;

-- 5. File et préparation d'un trip (0165, mêmes signatures) : items de nature TRIP ----------
-- (corps de 0165 recopiés ; seuls les deux filtres `kind = 'TRIP'` sont ajoutés)
CREATE OR REPLACE FUNCTION core.payout_trips_to_prepare(p_limit integer)
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
      LEFT JOIN core.payout_prepare_deferral AS d ON d.trip_id = t.id
     WHERE t.status = 'COMPLETED'
       AND NOT EXISTS (SELECT 1 FROM core.payout_payout_item AS i
                        WHERE i.trip_id = t.id AND i.segment_no = 1 AND i.leg = 'HOST'
                          AND i.kind = 'TRIP')
       AND (d.trip_id IS NULL OR d.next_attempt_at <= platform.now())
       AND core.payout_effective_end(t.id) IS NOT NULL
     ORDER BY d.next_attempt_at NULLS FIRST, t.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END
$fn$;

-- 7.2 Préparation d'un trip (critères 1 et 2) : payout_at, release_at (écrivain unique), lot, item,
-- montants et motifs. Issues : PREPARED, ALREADY_PREPARED, TRIP_UNKNOWN, NOT_COMPLETED,
-- NO_EFFECTIVE_END, NO_HOST_LEG, NO_CAPTURE, CALENDAR_MISSING (rien n'est écrit sauf PREPARED).
CREATE OR REPLACE FUNCTION core.payout_cmd_prepare_trip(p_trip_id uuid)
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
   WHERE i.trip_id = p_trip_id AND i.segment_no = 1 AND i.leg = 'HOST' AND i.kind = 'TRIP';
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
    PERFORM core.payout_cmd_defer_trip(p_trip_id, 'NO_HOST_LEG');
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
    PERFORM core.payout_cmd_defer_trip(p_trip_id, 'NO_CAPTURE');
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
    PERFORM core.payout_cmd_defer_trip(p_trip_id, 'CALENDAR_MISSING');
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

-- 6. Items d'un lot READY (0165, même signature) : rang suivant de la jambe HOST du TRIP -----
-- (corps de 0165 recopié ; seul le rang change : 1 + plus haut rang des ordres LEG_RELEASE HOST
-- du trip, identique à `release_attempt + 1` pour un trip à un seul item)
CREATE OR REPLACE FUNCTION core.payout_release_items(p_batch_id uuid)
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
           core.payout_next_release_rank(i.trip_id, NULL),
           pg_catalog.format('release:%s:1:HOST:i%s', i.trip_id,
                             core.payout_next_release_rank(i.trip_id, NULL)),
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

-- 7. Compensation d'un lot (0167, même signature) : montant d'un item selon sa nature -------
-- (corps de 0167 recopié ; seul le recalcul des items change)
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
    -- US-319 (ADR-200) : item d'un débit post-trip = Σ des parts HOST explicites rattachées, sauf
    -- part contre-passée ; item du trip = jambe HOST du trip hors parts des débits post-trip
    UPDATE core.payout_payout_item AS i
       SET amount_minor = CASE WHEN i.kind = 'TRIP' THEN core.payout_item_amount(i.trip_id)
                               ELSE core.payout_charge_item_amount(i.id) END
     WHERE i.batch_id = p_batch_id AND i.release_operation_id IS NULL
       AND i.amount_minor IS DISTINCT FROM
             CASE WHEN i.kind = 'TRIP' THEN core.payout_item_amount(i.trip_id)
                  ELSE core.payout_charge_item_amount(i.id) END;
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

-- 8. Débits post-trip reportés à verser (travailleur payment_command) -----------------------------

-- 8.1 File : débits débités (CHARGED), reportés sur les jambes du trip (`leg_reported`, mouvement
-- fait), hors loyer, part HOST > 0, sans part rattachée, dont l'item TRIP du trip est compensé
-- (montant figé) ; tentative différée du trip à venir exclue ; les jamais tentés d'abord
CREATE FUNCTION core.payout_charges_to_prepare(p_limit integer)
  RETURNS TABLE (charge_id uuid, trip_id uuid, country_code text)
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
    SELECT c.id, c.trip_id, c.country_code
      FROM core.payment_post_trip_charge AS c
      LEFT JOIN core.payout_prepare_deferral AS d ON d.trip_id = c.trip_id
     WHERE c.status = 'CHARGED' AND c.leg_reported AND c.leg_host_minor > 0
       AND c.purpose IN ('INCIDENTAL', 'DAMAGE', 'OTHER_DEBT')
       AND NOT EXISTS (SELECT 1 FROM core.payout_item_charge AS l WHERE l.charge_id = c.id)
       AND EXISTS (SELECT 1
                     FROM core.payout_payout_item AS i
                     JOIN core.payout_payout_batch AS b ON b.id = i.batch_id
                    WHERE i.trip_id = c.trip_id AND i.segment_no = 1 AND i.leg = 'HOST'
                      AND i.kind = 'TRIP' AND b.netted_at IS NOT NULL)
       AND (d.trip_id IS NULL OR d.next_attempt_at <= platform.now())
     ORDER BY d.next_attempt_at NULLS FIRST, c.updated_at, c.id
     LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 100), 500));
END
$fn$;

-- 8.2 Préparation de la part HOST d'un débit post-trip reporté (critère 2) : sous le verrou du trip
-- (ordre commun : trip, lot, item), lot ouvert du jour de `payout_at` (N-ième jour ouvré du pays
-- après le report ; J+5 au premier versement), item POST_TRIP_CHARGE du trip dans ce lot (créé au
-- besoin), part rattachée au montant explicite du débit, montants et motifs du lot. Issues :
-- PREPARED, ALREADY_PREPARED, CHARGE_UNKNOWN, NOT_REPORTED (débit non débité ou non reporté sur
-- les jambes), NO_HOST_SHARE, TRIP_NOT_NETTED (l'item du trip n'est pas encore compensé),
-- CALENDAR_MISSING (rien n'est écrit sauf PREPARED ; trip différé pour CALENDAR_MISSING).
CREATE FUNCTION core.payout_cmd_prepare_charge(p_charge_id uuid)
  RETURNS TABLE (outcome text, batch_id uuid, payout_at timestamptz, status text,
                 hold_reasons text[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_trip_id uuid;
  v_trip    record;
  c         core.payment_post_trip_charge%ROWTYPE;
  v_batch   uuid;
  v_item    uuid;
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
  SELECT x.trip_id INTO v_trip_id FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id;
  IF v_trip_id IS NULL THEN
    RETURN QUERY SELECT 'CHARGE_UNKNOWN'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  -- verrou du trip d'abord : le report du débit (settle_mit_attempt) et la préparation du trip le
  -- prennent aussi ; le débit est relu sous ce verrou
  SELECT t.id, t.org_id, t.country_code, t.currency INTO v_trip
    FROM core.booking_trip AS t WHERE t.id = v_trip_id FOR UPDATE;
  SELECT * INTO c FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id;
  -- rejeu : la part est déjà rattachée, rien n'est réécrit
  SELECT i.batch_id INTO v_batch
    FROM core.payout_item_charge AS l
    JOIN core.payout_payout_item AS i ON i.id = l.item_id
   WHERE l.charge_id = p_charge_id;
  IF v_batch IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_PREPARED'::text, x.id, x.scheduled_for, x.status, x.hold_reasons
                   FROM core.payout_payout_batch AS x WHERE x.id = v_batch;
    RETURN;
  END IF;
  -- débité, reporté sur les jambes du trip (mouvement de l'ordre MIT réussi), hors loyer
  IF c.status IS DISTINCT FROM 'CHARGED' OR NOT c.leg_reported
     OR c.purpose NOT IN ('INCIDENTAL', 'DAMAGE', 'OTHER_DEBT')
     OR c.currency IS DISTINCT FROM v_trip.currency
     OR NOT EXISTS (SELECT 1
                      FROM core.payment_post_trip_charge_attempt AS a
                      JOIN core.payment_payment_operation AS o ON o.id = a.operation_id
                      JOIN core.settlement_leg_movement AS m ON m.operation_id = o.id
                     WHERE a.charge_id = c.id AND a.settled = 'SUCCEEDED'
                       AND o.status = 'SUCCEEDED' AND o.kind = 'MIT_CHARGE') THEN
    RETURN QUERY SELECT 'NOT_REPORTED'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  IF c.leg_host_minor <= 0 THEN
    RETURN QUERY SELECT 'NO_HOST_SHARE'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  -- l'item du trip est compensé (montant figé) : la part n'est jamais comptée deux fois
  IF NOT EXISTS (SELECT 1
                   FROM core.payout_payout_item AS i
                   JOIN core.payout_payout_batch AS b ON b.id = i.batch_id
                  WHERE i.trip_id = v_trip_id AND i.segment_no = 1 AND i.leg = 'HOST'
                    AND i.kind = 'TRIP' AND b.netted_at IS NOT NULL) THEN
    RETURN QUERY SELECT 'TRIP_NOT_NETTED'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  SELECT a.collection_mode INTO v_mode FROM core.payment_psp_account AS a
   WHERE a.id = c.psp_account_id;
  -- premier versement (J+5) : aucun lot émis vers le compte de versement COURANT (0165)
  SELECT a.id INTO v_account FROM core.payout_payout_account AS a
   WHERE a.org_id = v_trip.org_id AND a.status IN ('PENDING', 'VERIFIED');
  v_first := v_account IS NULL
             OR NOT EXISTS (SELECT 1 FROM core.payout_payout_batch AS x
                             WHERE x.org_id = v_trip.org_id AND x.payout_account_id = v_account
                               AND x.status IN ('INITIATED', 'IN_TRANSIT', 'PAID'));
  v_at := core.payout_schedule_after(v_trip_id, platform.now(), v_first);
  IF v_at IS NULL THEN
    PERFORM core.payout_cmd_defer_trip(v_trip_id, 'CALENDAR_MISSING');
    RETURN QUERY SELECT 'CALENDAR_MISSING'::text, NULL::uuid, NULL::timestamptz, NULL::text,
                        NULL::text[];
    RETURN;
  END IF;
  -- lot ouvert du jour (créé au besoin ; un concurrent qui l'a créé est relu) : même clé que 0165
  SELECT x.id INTO v_batch FROM core.payout_payout_batch AS x
   WHERE x.org_id = v_trip.org_id AND x.currency = v_trip.currency AND x.kind = 'FINAL'
     AND x.scheduled_for = v_at AND x.psp_account_id = c.psp_account_id AND x.netted_at IS NULL
     FOR UPDATE;
  IF v_batch IS NULL THEN
    INSERT INTO core.payout_payout_batch AS x
           (org_id, country_code, currency, kind, variant, psp_account_id, payout_account_id,
            first_payout, status, scheduled_for)
    VALUES (v_trip.org_id, v_trip.country_code, v_trip.currency, 'FINAL', v_mode, c.psp_account_id,
            v_account, v_first, 'SCHEDULED', v_at)
    ON CONFLICT DO NOTHING
    RETURNING x.id INTO v_batch;
    IF v_batch IS NULL THEN
      SELECT x.id INTO v_batch FROM core.payout_payout_batch AS x
       WHERE x.org_id = v_trip.org_id AND x.currency = v_trip.currency AND x.kind = 'FINAL'
         AND x.scheduled_for = v_at AND x.psp_account_id = c.psp_account_id
         AND x.netted_at IS NULL
         FOR UPDATE;
    END IF;
  END IF;
  SELECT i.id INTO v_item FROM core.payout_payout_item AS i
   WHERE i.batch_id = v_batch AND i.trip_id = v_trip_id AND i.kind = 'POST_TRIP_CHARGE'
     FOR UPDATE;
  IF v_item IS NULL THEN
    INSERT INTO core.payout_payout_item AS i
           (batch_id, trip_id, segment_no, leg, org_id, country_code, currency, amount_minor, kind)
    VALUES (v_batch, v_trip_id, 1, 'HOST', v_trip.org_id, v_trip.country_code, v_trip.currency, 0,
            'POST_TRIP_CHARGE')
    RETURNING i.id INTO v_item;
  END IF;
  -- part explicite du débit (jamais un prorata) ; montant de l'item = Σ des parts (§3.1)
  INSERT INTO core.payout_item_charge (charge_id, item_id, amount_minor)
  VALUES (c.id, v_item, c.leg_host_minor);
  UPDATE core.payout_payout_item AS i
     SET amount_minor = core.payout_charge_item_amount(v_item)
   WHERE i.id = v_item AND i.amount_minor IS DISTINCT FROM core.payout_charge_item_amount(v_item);
  PERFORM core.payout_refresh_batch(v_batch, false);
  RETURN QUERY SELECT 'PREPARED'::text, x.id, x.scheduled_for, x.status, x.hold_reasons
                 FROM core.payout_payout_batch AS x WHERE x.id = v_batch;
END
$fn$;

-- 9. Report sur les soldes (0123, même signature) : + débits MIT post-trip hors loyer -------
-- (corps de 0123 recopié ; seul le contrôle du périmètre est élargi, bloc marqué US-319)
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
  -- US-319 (ADR-200) : un débit MIT post-trip hors loyer (frais annexe, dommage, amende, autre
  -- dette) entre au périmètre, seulement s'il est l'ordre d'une tentative d'un débit post-trip de
  -- CE trip et de CE but (jambes explicites de la tentative, jamais un prorata) ; tout autre ordre
  -- hors loyer (remboursement, encaissement de dette, réaffectation…) reste refusé
  IF ((v_purpose NOT IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION')
       OR v_kind NOT IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION', 'REFUND', 'LEG_REALLOCATION',
                         'LEG_RELEASE'))
      AND NOT (v_kind = 'MIT_CHARGE' AND v_purpose IN ('INCIDENTAL', 'DAMAGE', 'OTHER_DEBT')
               AND EXISTS (SELECT 1
                             FROM core.payment_post_trip_charge_attempt AS pa
                             JOIN core.payment_post_trip_charge AS pc ON pc.id = pa.charge_id
                            WHERE pa.operation_id = p_operation_id AND pc.trip_id = v_trip_id
                              AND pc.purpose = v_purpose)))
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

-- 10. Issue d'une tentative MIT (0169, même signature) : mouvement de jambe pour tout but ----
-- (corps de 0169 recopié ; seuls les deux blocs du report changent, marqués US-319)
CREATE OR REPLACE FUNCTION core.payment_cmd_settle_mit_attempt(p_charge_id uuid,
                                                              p_do_not_retry boolean)
  RETURNS TABLE (outcome text, code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  c        core.payment_post_trip_charge%ROWTYPE;
  v_trip   uuid;
  a        record;
  o        record;
  r        core.payment_mit_network_rule%ROWTYPE;
  v_max    integer;
  v_reason text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: settle_mit_attempt reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  SELECT x.trip_id INTO v_trip FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO c FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id FOR UPDATE;
  IF c.attempt_no = 0 THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  SELECT x.attempt_no, x.operation_id, x.settled INTO a
    FROM core.payment_post_trip_charge_attempt AS x
   WHERE x.charge_id = c.id AND x.attempt_no = c.attempt_no;
  SELECT y.id, y.status, y.proof_type INTO o
    FROM core.payment_payment_operation AS y WHERE y.id = a.operation_id;

  IF c.status = 'CHARGED' THEN
    -- report du mouvement de jambe attendu de la preuve (webhook signé ou lecture), pour tout
    -- but (US-319 : frais annexes, dommages, amendes compris)
    IF NOT c.leg_reported THEN
      IF o.proof_type IS NULL THEN
        RETURN QUERY SELECT 'AWAITING_PROOF'::text, NULL::text;
        RETURN;
      END IF;
      PERFORM core.settlement_cmd_apply_leg_movement(o.id);
      UPDATE core.payment_post_trip_charge AS x SET leg_reported = true WHERE x.id = c.id;
    END IF;
    RETURN QUERY SELECT 'CHARGED'::text, NULL::text;
    RETURN;
  END IF;
  IF c.status = 'UNPAID' THEN
    RETURN QUERY SELECT 'DONE'::text, c.outcome_code;
    RETURN;
  END IF;
  IF a.settled IS NOT NULL OR o.status IS NULL OR o.status NOT IN ('SUCCEEDED', 'FAILED') THEN
    RETURN QUERY SELECT 'IN_FLIGHT'::text, o.status::text;
    RETURN;
  END IF;

  IF o.status = 'SUCCEEDED' THEN
    UPDATE core.payment_post_trip_charge_attempt AS x
       SET settled = 'SUCCEEDED', do_not_retry = false
     WHERE x.charge_id = c.id AND x.attempt_no = a.attempt_no;
    UPDATE core.payment_post_trip_charge AS x SET status = 'CHARGED' WHERE x.id = c.id;
    -- US-319 (ADR-200 ; N-463) : tout débit post-trip (retenue du loyer, frais annexe, dommage,
    -- amende, autre dette) est reporté sur les jambes du trip, sur preuve, aux montants explicites
    -- de sa tentative ; `leg_reported` n'est vrai qu'APRÈS le mouvement (avant 0180 : vrai sans
    -- mouvement hors loyer). La part HOST est versée par le lot suivant de l'hôte (0180 §8).
    IF o.proof_type IS NULL THEN
      RETURN QUERY SELECT 'AWAITING_PROOF'::text, NULL::text;
      RETURN;
    END IF;
    PERFORM core.settlement_cmd_apply_leg_movement(o.id);
    UPDATE core.payment_post_trip_charge AS x SET leg_reported = true WHERE x.id = c.id;
    RETURN QUERY SELECT 'CHARGED'::text, NULL::text;
    RETURN;
  END IF;

  -- refus REÇU (aucun fonds débité)
  UPDATE core.payment_post_trip_charge_attempt AS x
     SET settled = 'FAILED', do_not_retry = COALESCE(p_do_not_retry, false)
   WHERE x.charge_id = c.id AND x.attempt_no = a.attempt_no;
  SELECT * INTO r FROM core.payment_mit_rule(c.country_code, c.network, c.reason);
  v_max := COALESCE(pg_catalog.cardinality(r.retry_offsets_days), 1);
  IF COALESCE(p_do_not_retry, false) OR c.attempt_no >= v_max THEN
    v_reason := CASE WHEN COALESCE(p_do_not_retry, false) THEN 'MIT_DO_NOT_RETRY'
                     ELSE 'MIT_DECLINED' END;
    PERFORM core.payment_mit_open_debt(c.id, v_reason);
    RETURN QUERY SELECT 'DEBT'::text, v_reason;
    RETURN;
  END IF;
  UPDATE core.payment_post_trip_charge AS x
     SET status = 'RETRY_DUE', outcome_code = 'MIT_RETRY_NOT_DUE',
         next_check_at = core.payment_mit_attempt_due(c.first_attempt_at, r.retry_offsets_days,
                                                      c.attempt_no + 1)
   WHERE x.id = c.id;
  RETURN QUERY SELECT 'RETRY_DUE'::text, NULL::text;
END
$fn$;

-- 11. Commentaires et droits des fonctions de cmd_money_owner (posés par le propriétaire) --------
COMMENT ON FUNCTION core.payout_charge_item_amount(uuid) IS
  'Part HOST d''un item de débits post-trip : Σ des parts explicites rattachées, hors part '
  'contre-passée (chargeback perdu après le débit). US-319 (ADR-200).';
COMMENT ON FUNCTION core.payout_item_amount(uuid) IS
  'Jambe HOST encore à libérer d''un trip pour son item TRIP (en vol compris, plafond de la version '
  'en tête), hors parts des débits post-trip reportés. US-708, US-319 (ADR-200).';
COMMENT ON FUNCTION core.payout_schedule_after(uuid, timestamptz, boolean) IS
  'payout_at après un instant (fin effective ou report d''un débit post-trip) : J+2 ouvrés du pays, '
  'J+5 au premier versement, heure locale du lot, jamais avant l''instant + 24 h. US-319 (ADR-200).';
COMMENT ON FUNCTION core.payout_schedule(uuid, boolean) IS
  'payout_at d''un trip (08 BR-PAYOUT-02) : J+2 ouvrés du pays après la fin effective, J+5 au '
  'premier versement, heure locale du lot. US-708 (ADR-185) ; US-319 (payout_schedule_after).';
COMMENT ON FUNCTION core.payout_next_release_rank(uuid, uuid) IS
  'Rang suivant d''une libération de la jambe HOST d''un trip (i{n} de la clé release:…) : 1 + plus '
  'haut rang des ordres LEG_RELEASE HOST du trip. US-319 (ADR-200).';
COMMENT ON FUNCTION core.payout_release_operation_hold_reasons(uuid) IS
  'Motifs de retenue du lot de l''item qui porte un ordre LEG_RELEASE (NULL : aucun item), relus par '
  'settlement_release_blocker. SECURITY DEFINER, aucun EXECUTE. US-319 (ADR-200).';
COMMENT ON FUNCTION core.payout_release_item_guard() IS
  'Garde des ordres LEG_RELEASE de la jambe HOST d''un trip mis en lot : un ordre vivant par item ; '
  'l''ordre d''un item libre d''un lot READY porte son montant, le rang suivant du trip et sa clé. '
  'US-708 (ADR-185), US-319 (ADR-200).';
COMMENT ON FUNCTION core.payout_release_items(uuid) IS
  'Items d''un lot READY et leur ordre LEG_RELEASE (montants stockés, rang suivant du trip). '
  'Travailleur payment_command. US-708, US-319.';
COMMENT ON FUNCTION core.payout_charges_to_prepare(integer) IS
  'Débits post-trip reportés dont la part HOST reste à mettre dans un lot (item du trip compensé). '
  'Travailleur payment_command. SECURITY DEFINER, EXECUTE app_worker. US-319 (ADR-200).';
COMMENT ON FUNCTION core.payout_cmd_prepare_charge(uuid) IS
  'Part HOST d''un débit post-trip reporté rattachée au lot suivant de l''hôte (item '
  'POST_TRIP_CHARGE, montant explicite). Travailleur payment_command. SECURITY DEFINER, EXECUTE '
  'app_worker. US-319 (ADR-200).';
COMMENT ON FUNCTION core.payment_cmd_settle_mit_attempt(uuid, boolean) IS
  'Report de l''issue de la tentative courante d''un débit post-trip (débité, relance, dette) ; '
  'débité ⇒ mouvement de jambe sur preuve pour tout but, leg_reported vrai après le mouvement. '
  'Travailleur payment_command. SECURITY DEFINER, EXECUTE app_worker. US-703 (ADR-189), US-319.';

REVOKE ALL ON FUNCTION
  core.payout_charge_item_amount(uuid),
  core.payout_schedule_after(uuid, timestamptz, boolean),
  core.payout_next_release_rank(uuid, uuid),
  core.payout_release_operation_hold_reasons(uuid),
  core.payout_charges_to_prepare(integer),
  core.payout_cmd_prepare_charge(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.payout_charges_to_prepare(integer),
  core.payout_cmd_prepare_charge(uuid)
TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 12. Garde du versement d'une jambe (0172, même signature, propriétaire migrator) ----------
-- (corps de 0172 recopié ; seul le bloc des motifs du lot change, marqué US-319)
CREATE OR REPLACE FUNCTION core.settlement_release_blocker(p_operation_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip    uuid;
  v_country text;
  v_account uuid;
  v_kind    text;
  v_status  text;
  v_org     uuid;
  v_now     timestamptz := platform.now();
  v_reasons text[];
BEGIN
  SELECT o.trip_id, o.country_code, o.psp_account_id, o.kind
    INTO v_trip, v_country, v_account, v_kind
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND OR v_kind IS DISTINCT FROM 'LEG_RELEASE' OR v_trip IS NULL THEN
    RETURN 'leg_release_trip_not_completed';
  END IF;
  SELECT t.status, t.org_id INTO v_status, v_org FROM core.booking_trip AS t WHERE t.id = v_trip;
  -- 08 BR-PAYOUT : la jambe HOST reste chez le PSP jusqu'à la fin du trajet
  IF v_status IS DISTINCT FROM 'COMPLETED' THEN
    RETURN 'leg_release_trip_not_completed';
  END IF;
  -- 08 E7 règle 6 : versement différé jusqu'à release_at (payout_at), posé et atteint
  IF EXISTS (SELECT 1
               FROM core.payment_payment_operation_leg AS l
               LEFT JOIN core.settlement_trip_leg_balance AS b
                 ON b.trip_id = v_trip AND b.segment_no = 1 AND b.leg = l.leg
              WHERE l.operation_id = p_operation_id AND l.amount_minor > 0
                AND (b.release_at IS NULL OR b.release_at > v_now)) THEN
    RETURN 'leg_release_not_due';
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
              WHERE l.operation_id = p_operation_id AND l.leg = 'HOST' AND l.amount_minor > 0)
     AND NOT EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS s
                      WHERE s.psp_account_id = v_account AND s.org_id = v_org
                        AND s.kyc_status = 'ACTIVE') THEN
    RETURN 'leg_release_submerchant_inactive';
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
              WHERE l.operation_id = p_operation_id AND l.leg = 'INSURER' AND l.amount_minor > 0)
     AND NOT core.config_go_live('insurer_contract_active', v_country) THEN
    RETURN 'leg_release_insurer_inactive';
  END IF;
  -- 17 §0.1 : interrupteur du pays, false en production, lu fail-closed
  IF NOT core.config_go_live('payouts_enabled', v_country) THEN
    RETURN 'leg_release_payouts_disabled';
  END IF;
  -- US-314 (ADR-192) : motifs de retenue du lot relus à l'ordre et au report de la jambe HOST ;
  -- US-319 (ADR-200) : un trip peut avoir plusieurs items (trip, débits post-trip) : les motifs
  -- sont ceux du lot de l'item qui porte CET ordre ; ordre d'un trip mis en lot rattaché à aucun
  -- item ⇒ retenu (fail-closed)
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
              WHERE l.operation_id = p_operation_id AND l.leg = 'HOST' AND l.amount_minor > 0)
     AND EXISTS (SELECT 1 FROM core.payout_payout_item AS i
                  WHERE i.trip_id = v_trip AND i.segment_no = 1 AND i.leg = 'HOST') THEN
    v_reasons := core.payout_release_operation_hold_reasons(p_operation_id);
    IF v_reasons IS NULL OR pg_catalog.cardinality(v_reasons) > 0 THEN
      RETURN 'leg_release_payout_held';
    END IF;
  END IF;
  RETURN NULL;
END
$fn$;

COMMENT ON FUNCTION core.settlement_release_blocker(uuid) IS
  'Garde du versement d''une jambe (LEG_RELEASE) : trip COMPLETED, release_at atteint, sous-marchand '
  'ACTIVE, interrupteurs du pays, puis motifs de retenue du lot de l''item qui porte l''ordre '
  '(US-314, US-319). Rend la première contrainte violée ou NULL. US-049 (ADR-088), US-314 '
  '(ADR-192), US-319 (ADR-200).';
COMMENT ON FUNCTION core.payout_payout_item_guard() IS
  'Garde des items de lot : jamais supprimés ; identité et nature figées ; montant figé dès qu''un '
  'ordre est rattaché ; rang monotone ; ordre remplacé après un refus reçu. US-708, US-319.';
COMMENT ON FUNCTION core.payout_item_charge_guard() IS
  'Garde des parts de débits post-trip : ajout seul ; part HOST explicite d''un débit reporté du '
  'même trip, item POST_TRIP_CHARGE encore sans ordre. US-319 (ADR-200).';
