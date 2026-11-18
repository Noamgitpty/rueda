-- 0149 — STL / AVL / FIN : la capture prouvée d'un hold converti est rattachée au trip né de la
-- conversion et reportée sur ses soldes par jambe, dans la même transaction ; le rapprochement voit
-- tout trip qui a un encaissement prouvé.
-- US-221 partie 221b (agent argent / back-end) ; défauts D1 et D2 de la passation US-221 (PR #245) ;
-- 08 E7 règles 1, 2 et 10 (jambes explicites, jamais un prorata ; soldes par trip et jambe) ;
-- vecteurs TJ01 (USD), TJ08a (PYG) ; 17 v6 §2.3 (`cmd_money_owner`, RLS-25), §2.5 étape 4
-- (conversion gardée), §2.9 (« soldes modifiés seulement par les commandes settlement.cmd_*, dans la
-- transaction qui reçoit la preuve »), §4.3 point 8 ; ADR-139 (preuve), ADR-161 (faits de
-- l'invariant par jambe), ADR-165 (registre de l'assureur), ADR-170 (cette migration). Appliquée sous
-- `migrator`, en une transaction.
--
-- D1 : `core.booking_convert_payment` (0126) créait le trip sans rattacher la capture
-- (`payment_operation.trip_id` restait NULL) et `core.settlement_cmd_apply_leg_movement` (0123) la
-- refusait (`leg_movement_unsupported`) : soldes par jambe vides, aucune écriture COLLECTION au
-- registre de l'assureur. D2 : `core.finance_trip_leg_facts` (0137) ne lisait que les trips ayant
-- des soldes ou un règlement : un encaissement prouvé jamais porté passait le rapprochement.
--
-- Cette migration :
--   1. droits de `cmd_money_owner` : lecture de la disposition de paiement (colonnes sans donnée
--      personnelle) ; `UPDATE (trip_id)` de l'opération et de ses jambes, seulement par une nouvelle
--      politique réservée aux travailleurs de conversion (opération CAPTURE de loyer, SUCCEEDED,
--      prouvée, sans trip, rattachée au trip de SA disposition CONVERSION) ;
--   2. déclencheurs (tous rôles, sur un changement de `trip_id`) : `trip_id` d'une opération ou
--      d'une jambe ne change que de NULL au trip de la disposition CONVERSION de l'opération, sans
--      rien changer d'autre dans la même mise à jour ;
--   3. politiques d'écriture des soldes et des mouvements pour les travailleurs de conversion,
--      MIROIR EXACT de la preuve : mouvement CAPTURE de l'opération de la disposition CONVERSION du
--      trip ; soldes créés à zéro, puis `captured_minor` = jambe de cette opération, rien d'autre ;
--   4. commande `core.settlement_cmd_apply_conversion_capture(uuid)` (`cmd_money_owner`,
--      SECURITY DEFINER, EXECUTE `app_worker`, travailleurs booking_conversion, disposition_sweeper,
--      payment_intent_sweeper) : sous le verrou du trip, rattache la capture et ses jambes au trip,
--      reporte CHAQUE jambe avec son montant explicite (celui de l'opération, égal au devis figé,
--      contrôlé par la conversion), écrit le mouvement CAPTURE (le déclencheur de 0143 écrit la
--      COLLECTION de la jambe INSURER) ; idempotente (`DUPLICATE`) ; mêmes refus que le report de
--      0123 (preuve, périmètre, quatre jambes, Σ jambes = montant, détention de fonds) ;
--   5. `core.finance_trip_leg_facts()` (corps de 0137 recopié, blocs marqués US-221b) : un trip est
--      tenu dès que sa disposition CONVERSION porte une CAPTURE PROUVÉE (SUCCEEDED, preuve
--      rattachée) ; « encaissé » = Σ des encaissements portés et de cette capture : une capture
--      convertie jamais portée ressort en `TRIP_CAPTURE_LEGS` (les encaissements rattachés
--      directement au trip, MIT et recouvrements, restent jugés une fois portés : leur report
--      après la preuve est celui de la boîte d'envoi monétaire, lot C) ;
--   6. `core.booking_convert_payment(uuid)` (corps de 0126 recopié, blocs marqués US-221b) : la
--      conversion d'une CAPTURE appelle la commande 4 dans la même transaction (un refus annule la
--      conversion : aucun trip sans ses soldes, la tâche réessaie et compte l'erreur) ; un rejeu
--      (REPLAY) d'une conversion antérieure non portée la reporte (rattrapage idempotent).
--
-- Aucune autre commande n'est modifiée ; aucun interrupteur lu autrement que par
-- `core.config_go_live` (fail-closed) ; aucun texte visible ; aucun montant reçu en paramètre.
--
-- Codes (packages/db/src/errors.ts, existants) :
--   leg_movement_unsupported (55000)     → INVARIANT_VIOLATION ;
--   leg_movement_unproven (55000)        → PAYMENT_UNPROVEN ;
--   leg_funds_holding_disabled (55000)   → INVARIANT_VIOLATION ;
--   operation_trip_attach_invalid (23000, nouveau, déclencheurs) → INVARIANT_VIOLATION.
--
-- Expand / contract : droits, politiques, déclencheurs et fonction AJOUTÉS ; deux fonctions
-- remplacées à signature, propriétaire et droits identiques ; rien n'est retiré.
--
-- Retour arrière :
--   (réappliquer core.booking_convert_payment de 0126 et core.finance_trip_leg_facts de 0137)
--   DROP FUNCTION core.settlement_cmd_apply_conversion_capture(uuid);
--   DROP TRIGGER operation_trip_attach_guard ON core.payment_payment_operation;
--   DROP TRIGGER operation_leg_trip_attach_guard ON core.payment_payment_operation_leg;
--   DROP FUNCTION core.payment_guard_operation_trip_attach(), core.payment_guard_leg_trip_attach();
--   DROP POLICY cmd_money_conversion_attach ON core.payment_payment_operation;
--   DROP POLICY cmd_money_conversion_attach ON core.payment_payment_operation_leg;
--   DROP POLICY cmd_money_conversion_ins ON core.settlement_leg_movement;
--   DROP POLICY cmd_money_conversion_ins ON core.settlement_trip_leg_balance;
--   DROP POLICY cmd_money_conversion_upd ON core.settlement_trip_leg_balance;
--   DROP POLICY cmd_money_sel ON core.booking_payment_disposition;
--   REVOKE UPDATE (trip_id) ON core.payment_payment_operation, core.payment_payment_operation_leg
--     FROM cmd_money_owner;
--   REVOKE SELECT (operation_id, hold_id, disposition, trip_id) ON core.booking_payment_disposition
--     FROM cmd_money_owner;

-- 1. Droits de cmd_money_owner (sous migrator, propriétaire des tables) ---------------------------

GRANT SELECT (operation_id, hold_id, disposition, trip_id) ON core.booking_payment_disposition
  TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.booking_payment_disposition FOR SELECT TO cmd_money_owner
  USING (true);

GRANT UPDATE (trip_id) ON core.payment_payment_operation TO cmd_money_owner;
GRANT UPDATE (trip_id) ON core.payment_payment_operation_leg TO cmd_money_owner;

-- rattachement de la capture : travailleurs de conversion seulement, CAPTURE de loyer SUCCEEDED et
-- prouvée, sans trip ; le trip posé est celui de la disposition CONVERSION de l'opération
CREATE POLICY cmd_money_conversion_attach ON core.payment_payment_operation FOR UPDATE
  TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('booking_conversion', 'disposition_sweeper',
                                   'payment_intent_sweeper')
         AND trip_id IS NULL AND hold_id IS NOT NULL AND kind = 'CAPTURE' AND purpose = 'RENT'
         AND status = 'SUCCEEDED' AND proof_type IS NOT NULL)
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('booking_conversion', 'disposition_sweeper',
                                        'payment_intent_sweeper')
              AND kind = 'CAPTURE' AND purpose = 'RENT' AND status = 'SUCCEEDED'
              AND proof_type IS NOT NULL
              AND EXISTS (SELECT 1 FROM core.booking_payment_disposition AS d
                           WHERE d.operation_id = payment_payment_operation.id
                             AND d.hold_id = payment_payment_operation.hold_id
                             AND d.disposition = 'CONVERSION'
                             AND d.trip_id = payment_payment_operation.trip_id));

CREATE POLICY cmd_money_conversion_attach ON core.payment_payment_operation_leg FOR UPDATE
  TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('booking_conversion', 'disposition_sweeper',
                                   'payment_intent_sweeper')
         AND trip_id IS NULL)
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('booking_conversion', 'disposition_sweeper',
                                        'payment_intent_sweeper')
              AND EXISTS (SELECT 1
                            FROM core.payment_payment_operation AS o
                            JOIN core.booking_payment_disposition AS d
                              ON d.operation_id = o.id AND d.disposition = 'CONVERSION'
                           WHERE o.id = payment_payment_operation_leg.operation_id
                             AND o.trip_id = payment_payment_operation_leg.trip_id
                             AND d.trip_id = payment_payment_operation_leg.trip_id));

-- 2. Déclencheurs de rattachement (tous rôles) ----------------------------------------------------

CREATE FUNCTION core.payment_guard_operation_trip_attach()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- trip_id ne change que de NULL au trip de la disposition CONVERSION de l'opération, seul
  IF OLD.trip_id IS NOT NULL
     OR NEW.trip_id IS NULL
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.proof_type IS DISTINCT FROM OLD.proof_type
     OR NEW.provider_reference IS DISTINCT FROM OLD.provider_reference
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.hold_id IS DISTINCT FROM OLD.hold_id
     OR NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition AS d
                     WHERE d.operation_id = NEW.id AND d.disposition = 'CONVERSION'
                       AND d.trip_id = NEW.trip_id) THEN
    RAISE EXCEPTION 'payment_operation: trip_id is attached once, to the trip of its conversion'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'operation_trip_attach_invalid';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION core.payment_guard_operation_trip_attach() IS
  'Déclencheur operation_trip_attach_guard : trip_id d''une opération ne passe que de NULL au trip '
  'de sa disposition CONVERSION, sans autre changement. US-221 (221b, ADR-170).';
REVOKE ALL ON FUNCTION core.payment_guard_operation_trip_attach() FROM PUBLIC;
CREATE TRIGGER operation_trip_attach_guard
  BEFORE UPDATE OF trip_id ON core.payment_payment_operation
  FOR EACH ROW WHEN (OLD.trip_id IS DISTINCT FROM NEW.trip_id)
  EXECUTE FUNCTION core.payment_guard_operation_trip_attach();

CREATE FUNCTION core.payment_guard_leg_trip_attach()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- au rattachement, rien d'autre ne change : trip_id passe de NULL au trip de son opération
  IF OLD.trip_id IS NOT NULL
     OR NEW.trip_id IS NULL
     OR (NEW.operation_id, NEW.leg, NEW.org_id, NEW.country_code, NEW.amount_minor,
         NEW.beneficiary_ref, NEW.created_at)
        IS DISTINCT FROM
        (OLD.operation_id, OLD.leg, OLD.org_id, OLD.country_code, OLD.amount_minor,
         OLD.beneficiary_ref, OLD.created_at)
     OR NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                     WHERE o.id = NEW.operation_id AND o.trip_id = NEW.trip_id) THEN
    RAISE EXCEPTION 'payment_operation_leg: legs are immutable, trip_id follows its operation once'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'operation_trip_attach_invalid';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION core.payment_guard_leg_trip_attach() IS
  'Déclencheur operation_leg_trip_attach_guard : trip_id d''une jambe ne passe que de NULL au trip '
  'de son opération, sans autre changement. US-221 (221b, ADR-170).';
REVOKE ALL ON FUNCTION core.payment_guard_leg_trip_attach() FROM PUBLIC;
CREATE TRIGGER operation_leg_trip_attach_guard
  BEFORE UPDATE OF trip_id ON core.payment_payment_operation_leg
  FOR EACH ROW WHEN (OLD.trip_id IS DISTINCT FROM NEW.trip_id)
  EXECUTE FUNCTION core.payment_guard_leg_trip_attach();

-- 3. Soldes et mouvements : miroir exact de la capture convertie -----------------------------------

CREATE POLICY cmd_money_conversion_ins ON core.settlement_leg_movement FOR INSERT
  TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('booking_conversion', 'disposition_sweeper',
                                        'payment_intent_sweeper')
              AND kind = 'CAPTURE' AND segment_no = 1
              AND EXISTS (SELECT 1
                            FROM core.booking_payment_disposition AS d
                            JOIN core.payment_payment_operation AS o ON o.id = d.operation_id
                           WHERE d.operation_id = settlement_leg_movement.operation_id
                             AND d.trip_id = settlement_leg_movement.trip_id
                             AND d.disposition = 'CONVERSION'
                             AND o.trip_id = settlement_leg_movement.trip_id
                             AND o.kind = 'CAPTURE' AND o.status = 'SUCCEEDED'
                             AND o.proof_type IS NOT NULL));

CREATE POLICY cmd_money_conversion_ins ON core.settlement_trip_leg_balance FOR INSERT
  TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('booking_conversion', 'disposition_sweeper',
                                        'payment_intent_sweeper')
              AND captured_minor = 0 AND refunded_minor = 0 AND reallocated_in_minor = 0
              AND reallocated_out_minor = 0 AND released_minor = 0 AND NOT frozen
              AND EXISTS (SELECT 1 FROM core.booking_payment_disposition AS d
                           WHERE d.trip_id = settlement_trip_leg_balance.trip_id
                             AND d.disposition = 'CONVERSION'));

CREATE POLICY cmd_money_conversion_upd ON core.settlement_trip_leg_balance FOR UPDATE
  TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('booking_conversion', 'disposition_sweeper',
                                   'payment_intent_sweeper')
         AND captured_minor = 0 AND refunded_minor = 0 AND reallocated_in_minor = 0
         AND reallocated_out_minor = 0 AND released_minor = 0 AND NOT frozen
         AND EXISTS (SELECT 1 FROM core.booking_payment_disposition AS d
                      WHERE d.trip_id = settlement_trip_leg_balance.trip_id
                        AND d.disposition = 'CONVERSION'))
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('booking_conversion', 'disposition_sweeper',
                                        'payment_intent_sweeper')
              AND refunded_minor = 0 AND reallocated_in_minor = 0
              AND reallocated_out_minor = 0 AND released_minor = 0 AND NOT frozen
              AND captured_minor = (SELECT g.amount_minor
                                      FROM core.booking_payment_disposition AS d
                                      JOIN core.payment_payment_operation_leg AS g
                                        ON g.operation_id = d.operation_id
                                     WHERE d.trip_id = settlement_trip_leg_balance.trip_id
                                       AND d.disposition = 'CONVERSION'
                                       AND g.leg = settlement_trip_leg_balance.leg));

-- 4. Commande de report de la capture convertie (famille cmd_money) --------------------------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- Appelée par core.booking_convert_payment, dans la transaction de la conversion. Montants LUS
-- (jambes de l'opération, contrôlées égales au devis figé par la conversion), jamais reçus.
CREATE FUNCTION core.settlement_cmd_apply_conversion_capture(p_operation_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip_id  uuid;
  v_org      uuid;
  v_country  text;
  v_trip_cur text;
  v_mode     text;
  v_n        integer;
  v_sum      bigint;
  r_op       record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('booking_conversion', 'disposition_sweeper',
                                  'payment_intent_sweeper') THEN
    RAISE EXCEPTION 'settlement: conversion capture reserved to the conversion workers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT d.trip_id INTO v_trip_id
    FROM core.booking_payment_disposition AS d
   WHERE d.operation_id = p_operation_id AND d.disposition = 'CONVERSION';
  IF v_trip_id IS NULL THEN
    RAISE EXCEPTION 'settlement: operation % has no conversion', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- verrou du trip : un seul écrivain des soldes du trip à la fois (17 §2.9, §4.3 point 1)
  SELECT t.org_id, t.country_code, t.currency INTO v_org, v_country, v_trip_cur
    FROM core.booking_trip AS t WHERE t.id = v_trip_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m WHERE m.operation_id = p_operation_id) THEN
    RETURN 'DUPLICATE';
  END IF;

  -- opération relue SOUS le verrou du trip
  SELECT o.trip_id, o.kind, o.purpose, o.status, o.proof_type, o.currency, o.amount_minor,
         o.psp_account_id, o.country_code
    INTO r_op
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF r_op.kind IS DISTINCT FROM 'CAPTURE' OR r_op.purpose IS DISTINCT FROM 'RENT'
     OR r_op.currency IS DISTINCT FROM v_trip_cur OR r_op.country_code IS DISTINCT FROM v_country
     OR r_op.psp_account_id IS NULL
     OR (r_op.trip_id IS NOT NULL AND r_op.trip_id <> v_trip_id) THEN
    RAISE EXCEPTION 'settlement: operation % is outside the converted capture perimeter',
                    p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;
  IF r_op.status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'settlement: operation % is %, not SUCCEEDED', p_operation_id, r_op.status
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_not_succeeded';
  END IF;
  IF r_op.proof_type IS NULL THEN
    RAISE EXCEPTION 'settlement: operation % has no attached proof', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_movement_unproven';
  END IF;
  -- quatre jambes explicites, Σ jambes = montant capturé (08 E7 règles 1 et 2 ; jamais un prorata)
  SELECT pg_catalog.count(*)::integer, pg_catalog.sum(l.amount_minor)::bigint INTO v_n, v_sum
    FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = p_operation_id;
  IF v_n <> 4 OR v_sum IS DISTINCT FROM r_op.amount_minor
     OR EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
                 WHERE l.operation_id = p_operation_id AND l.amount_minor < 0) THEN
    RAISE EXCEPTION 'settlement: operation % has % legs summing to %, 4 legs = % expected',
                    p_operation_id, v_n, v_sum, r_op.amount_minor
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;
  -- fonds détenus par Kmino (mode autre que SPLIT_AT_SOURCE) seulement si
  -- funds_holding_enabled[pays] (17 §0.1, lecture fail-closed) : même garde que 0123
  SELECT a.collection_mode INTO v_mode FROM core.payment_psp_account AS a
   WHERE a.id = r_op.psp_account_id;
  IF v_mode IS DISTINCT FROM 'SPLIT_AT_SOURCE'
     AND NOT core.config_go_live('funds_holding_enabled', v_country) THEN
    RAISE EXCEPTION 'settlement: funds holding is disabled for %', v_country
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_funds_holding_disabled';
  END IF;

  -- rattachement de la capture et de ses jambes au trip né de la conversion (déclencheurs de 2)
  IF r_op.trip_id IS NULL THEN
    UPDATE core.payment_payment_operation AS o SET trip_id = v_trip_id
     WHERE o.id = p_operation_id AND o.trip_id IS NULL;
  END IF;
  UPDATE core.payment_payment_operation_leg AS l SET trip_id = v_trip_id
   WHERE l.operation_id = p_operation_id AND l.trip_id IS NULL;

  -- quatre lignes de solde du segment (bêta : segment 1), créées à zéro ; une ligne déjà portée
  -- par un autre encaissement refuse le report (politique cmd_money_conversion_upd : fail-closed)
  INSERT INTO core.settlement_trip_leg_balance (trip_id, segment_no, leg, org_id, country_code, currency)
  SELECT v_trip_id, 1, l.leg, v_org, v_country, v_trip_cur
    FROM unnest(ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM']) AS l(leg)
  ON CONFLICT (trip_id, segment_no, leg) DO NOTHING;

  -- chaque jambe reçoit SON montant explicite (jambe de l'opération), jamais un prorata
  UPDATE core.settlement_trip_leg_balance AS b
     SET captured_minor = b.captured_minor + l.amount_minor
    FROM core.payment_payment_operation_leg AS l
   WHERE l.operation_id = p_operation_id
     AND b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
     AND l.amount_minor <> 0;

  -- une ligne filtrée par la RLS (solde déjà porté, jambe gelée) ne doit pas passer en silence :
  -- l'opération rattachée et chaque solde = sa jambe, sinon refus (fail-closed)
  IF NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS o
                  WHERE o.id = p_operation_id AND o.trip_id = v_trip_id)
     OR EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
                 WHERE l.operation_id = p_operation_id
                   AND l.trip_id IS DISTINCT FROM v_trip_id)
     OR (SELECT pg_catalog.count(*)
           FROM core.payment_payment_operation_leg AS l
           JOIN core.settlement_trip_leg_balance AS b
             ON b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
          WHERE l.operation_id = p_operation_id
            AND b.captured_minor = l.amount_minor AND b.refunded_minor = 0
            AND b.reallocated_in_minor = 0 AND b.reallocated_out_minor = 0
            AND b.released_minor = 0 AND NOT b.frozen) <> 4 THEN
    RAISE EXCEPTION 'settlement: trip % already carries leg movements, capture % not reported',
                    v_trip_id, p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- mouvement CAPTURE (idempotence par opération) ; insurer_ledger_collection_posted (0143) écrit
  -- la COLLECTION de la jambe INSURER dans la même transaction
  INSERT INTO core.settlement_leg_movement (operation_id, trip_id, segment_no, country_code, kind)
  VALUES (p_operation_id, v_trip_id, 1, v_country, 'CAPTURE');
  RETURN 'APPLIED';
END
$fn$;
COMMENT ON FUNCTION core.settlement_cmd_apply_conversion_capture(uuid) IS
  'Report de la capture prouvée d''un hold converti (17 §2.5 étape 4, §2.9) : rattachement au trip '
  'de la disposition CONVERSION, chaque jambe à son montant explicite, mouvement CAPTURE (COLLECTION '
  'de l''assureur par 0143) ; DUPLICATE si déjà porté. Travailleurs booking_conversion, '
  'disposition_sweeper, payment_intent_sweeper (EXECUTE app_worker). US-221 (221b, ADR-170).';
REVOKE ALL ON FUNCTION core.settlement_cmd_apply_conversion_capture(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.settlement_cmd_apply_conversion_capture(uuid) TO app_worker;

-- 5. Faits de l'invariant par jambe (corps de 0137 recopié ; blocs marqués US-221b) ---------------
CREATE OR REPLACE FUNCTION core.finance_trip_leg_facts()
  RETURNS TABLE (trip_id uuid, country_code text, currency text, captured_minor bigint,
                 collected_minor bigint, collected_legs_minor bigint,
                 head_total_paid_minor bigint, expected_host_minor bigint,
                 statement_host_minor bigint)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'reconciliation' THEN
    RAISE EXCEPTION 'finance: leg facts are read by the reconciliation worker only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH enc AS (
    -- US-221b (D2) : encaissements du trip = ceux qui sont portés sur les soldes UNION la capture
    -- PROUVÉE (SUCCEEDED, preuve rattachée) qui a converti un hold en ce trip (disposition
    -- CONVERSION) ; une capture convertie jamais portée est donc vue (et en écart). Un
    -- encaissement rattaché directement au trip (MIT, recouvrement) est porté par la boîte d'envoi
    -- monétaire après sa preuve (lot C) : hors de ces faits tant que ce report n'existe pas
    SELECT m.trip_id, m.operation_id AS op_id
      FROM core.settlement_leg_movement AS m
     WHERE m.segment_no = 1 AND m.kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
    UNION
    SELECT d.trip_id, o.id
      FROM core.booking_payment_disposition AS d
      JOIN core.payment_payment_operation AS o ON o.id = d.operation_id
     WHERE d.disposition = 'CONVERSION'
       AND o.status = 'SUCCEEDED' AND o.proof_type IS NOT NULL
       AND o.kind = 'CAPTURE' AND o.purpose = 'RENT'
  ),
  held AS (
    SELECT b.trip_id AS id FROM core.settlement_trip_leg_balance AS b WHERE b.segment_no = 1
    UNION
    SELECT s.trip_id FROM core.settlement_settlement AS s WHERE s.segment_no = 1
    UNION
    SELECT e.trip_id FROM enc AS e
  ),
  tr AS (
    SELECT t.id, t.org_id, t.country_code, t.currency
      FROM core.booking_trip AS t
      JOIN held AS x ON x.id = t.id
  ),
  orgs AS (SELECT DISTINCT y.org_id FROM tr AS y),
  lines AS (
    SELECT l.trip_id, l.amount_minor
      FROM orgs AS o
      CROSS JOIN LATERAL core.finance_earning_lines(o.org_id) AS l
     WHERE l.line_kind IN ('EARNING', 'CXL_EARNING')
  ),
  cap AS (
    SELECT b.trip_id,
           pg_catalog.sum(b.captured_minor)::bigint AS captured,
           pg_catalog.sum(b.captured_minor) FILTER (WHERE b.leg = 'HOST')::bigint AS host
      FROM core.settlement_trip_leg_balance AS b
     WHERE b.segment_no = 1
     GROUP BY b.trip_id
  ),
  ops AS (
    -- US-221b : encaissements portés ou prouvés (mêmes natures que captured_minor)
    SELECT e.trip_id,
           pg_catalog.sum(o.amount_minor)::bigint AS amount,
           pg_catalog.sum((SELECT pg_catalog.sum(g.amount_minor)
                             FROM core.payment_payment_operation_leg AS g
                            WHERE g.operation_id = o.id))::bigint AS legs,
           pg_catalog.sum((SELECT g.amount_minor
                             FROM core.payment_payment_operation_leg AS g
                            WHERE g.operation_id = o.id AND g.leg = 'HOST'))::bigint AS host
      FROM enc AS e
      JOIN core.payment_payment_operation AS o ON o.id = e.op_id
     GROUP BY e.trip_id
  ),
  head AS (
    SELECT DISTINCT ON (s.trip_id) s.trip_id, s.total_paid_minor, s.host_from_guest_minor
      FROM core.settlement_settlement AS s
     WHERE s.segment_no = 1
     ORDER BY s.trip_id, s.version DESC
  )
  SELECT tr.id, tr.country_code, tr.currency,
         COALESCE(c.captured, 0)::bigint,
         op.amount, op.legs,
         h.total_paid_minor,
         -- jambe HOST attendue, lue d'une AUTRE source que le relevé : en-tête du règlement
         -- (hostFromGuest), sinon jambes HOST des encaissements, sinon solde capturé
         CASE WHEN h.trip_id IS NOT NULL THEN h.host_from_guest_minor
              WHEN op.trip_id IS NOT NULL THEN op.host
              ELSE c.host END,
         ln.amount_minor
    FROM tr
    LEFT JOIN cap AS c ON c.trip_id = tr.id
    LEFT JOIN ops AS op ON op.trip_id = tr.id
    LEFT JOIN head AS h ON h.trip_id = tr.id
    LEFT JOIN lines AS ln ON ln.trip_id = tr.id;
END
$fn$;
COMMENT ON FUNCTION core.finance_trip_leg_facts() IS
  'Faits de l''invariant par jambe, par trip tenu (soldes, règlement ou capture convertie prouvée) : '
  'Σ capturé, Σ des encaissements portés ou convertis prouvés et de leurs jambes, total payé de la version en '
  'tête, jambe HOST attendue et jambe HOST du relevé. Travailleur reconciliation seulement '
  '(EXECUTE app_worker). US-217 (217a, ADR-161), US-221 (221b, ADR-170).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 6. Conversion gardée (corps de 0126 recopié ; blocs marqués US-221b) ---------------------------
CREATE OR REPLACE FUNCTION core.booking_convert_payment(p_operation_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest      uuid;
  v_vehicle    uuid;
  v_now        timestamptz;
  v_tolerance  integer;
  v_grace      integer;
  v_reason     text;
  v_late       boolean;
  v_trip       uuid := pg_catalog.gen_random_uuid();
  v_try        integer := 0;
  v_conflict   boolean;
  v_constraint text;
  v_legs_ok    boolean;
  v_foreign    boolean;
  v_same_paid  boolean;
  v_unpaid     uuid[];
  v_h2         uuid;
  n            integer;
  r_op         record;
  r_disp       record;
  r_hold       record;
  r_terms      record;
  r_occ        record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('booking_conversion', 'disposition_sweeper',
                                  'payment_intent_sweeper') THEN
    RAISE EXCEPTION 'conversion: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  SELECT op.hold_id, op.status, op.purpose, op.kind, op.amount_minor, op.currency,
         op.country_code, op.proof_type
    INTO r_op
    FROM core.payment_payment_operation op
   WHERE op.id = p_operation_id;
  IF NOT FOUND OR r_op.hold_id IS NULL OR r_op.purpose <> 'RENT'
     OR r_op.kind NOT IN ('AUTH', 'CAPTURE') THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_APPLICABLE');
  END IF;
  IF r_op.status <> 'SUCCEEDED' THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_SUCCEEDED', 'status', r_op.status);
  END IF;
  -- US-223 (S-02, RC-5) : SUCCEEDED sans preuve rattachée (réponse d'API) ⇒ aucun trip ; la
  -- conversion attend le webhook signé (ou la lecture d'un compte de bac à sable)
  IF r_op.proof_type IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_PROVEN');
  END IF;
  -- US-223c (17 §2.5 « Hold de demande REQUEST ») : l'autorisation prouvée d'une demande n'est
  -- jamais convertie ni compensée (aucune disposition) : la demande attend l'hôte (AWAITING_HOST),
  -- ou, si le hold n'est plus vivant, l'autorisation est annulée (VOID total) ; seule la CAPTURE
  -- de l'acceptation devient un trip
  IF r_op.kind = 'AUTH' AND EXISTS (SELECT 1 FROM core.booking_checkout_hold ch
                                     WHERE ch.id = r_op.hold_id AND ch.kind = 'REQUEST') THEN
    RETURN core.booking_request_authorized(p_operation_id);
  END IF;
  -- voyageur et véhicule : colonnes gardées, jamais modifiées (lues avant les verrous)
  SELECT ch.guest_user_id, ch.vehicle_id INTO v_guest, v_vehicle
    FROM core.booking_checkout_hold ch WHERE ch.id = r_op.hold_id;
  IF v_guest IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_APPLICABLE');
  END IF;

  -- 0. verrous voyageur puis véhicule (ordre global, VERIF_16-M2) ; rejeu exact
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  SELECT d.disposition, d.trip_id, d.hold_compensation_id INTO r_disp
    FROM core.booking_payment_disposition d WHERE d.operation_id = p_operation_id;
  IF FOUND THEN
    IF r_disp.disposition = 'COMPENSATION' THEN
      -- preuve tardive d'une opération déjà compensée (C13, E2) : journalisée, ignorée
      INSERT INTO core.outbox_outbox_event
             (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_role, correlation_id, payload, partition_key)
      VALUES ('booking.payment.late_ignored', 1, 'checkout_hold', r_op.hold_id, 4, r_op.country_code,
              'SYSTEM', pg_catalog.gen_random_uuid(),
              pg_catalog.jsonb_build_object('hold_id', r_op.hold_id, 'operation_id', p_operation_id,
                                            'hold_compensation_id', r_disp.hold_compensation_id),
              r_op.hold_id::text);
    END IF;
    -- US-221b : rejeu d'une conversion de CAPTURE : report idempotent sur les soldes par jambe
    -- (DUPLICATE si déjà porté ; rattrape une conversion antérieure à 0149, jamais portée)
    IF r_disp.disposition = 'CONVERSION' AND r_op.kind = 'CAPTURE' THEN
      PERFORM core.settlement_cmd_apply_conversion_capture(p_operation_id);
    END IF;
    RETURN pg_catalog.jsonb_build_object('outcome', 'REPLAY', 'disposition', r_disp.disposition,
                                         'tripId', r_disp.trip_id,
                                         'compensationId', r_disp.hold_compensation_id);
  END IF;

  -- 1. verrou de ligne du hold, SANS prédicat de statut (la tâche d'expiration le saute)
  SELECT ch.id, ch.status, ch.occupancy_id, ch.org_id, ch.country_code, ch.review_required,
         ch.reviewed_at
    INTO r_hold
    FROM core.booking_checkout_hold ch
   WHERE ch.id = r_op.hold_id
     FOR UPDATE;
  IF r_hold.status = 'CONVERTED' THEN
    -- autre opération que celle qui a converti (sinon REPLAY) : jamais un second rattachement
    RETURN core.booking_open_compensation(r_hold.id, p_operation_id, 'DUPLICATE_PAYMENT');
  ELSIF r_hold.status = 'COMPENSATED' THEN
    -- jamais de trip, même si le créneau est redevenu libre (VERIF_16-N1)
    RETURN core.booking_open_compensation(r_hold.id, p_operation_id,
                                          'LATE_PAYMENT_AFTER_COMPENSATION');
  END IF;
  IF r_hold.review_required AND r_hold.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'conversion: review pending'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'conversion_review_pending';
  END IF;

  -- 2. preuve contre le devis accepté ; 2 bis : début, catalogue, hôte, voyageur
  v_tolerance := core.booking_param_int('conversion_start_tolerance_minutes', r_hold.country_code);
  v_grace     := core.booking_param_int('sweep_grace_s', r_hold.country_code);
  IF v_tolerance IS NULL OR v_grace IS NULL THEN
    RAISE EXCEPTION 'conversion: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  v_now := platform.now();
  SELECT t.amount_minor, t.currency, t.legs, t.scheduled_start, t.scheduled_end, t.timezone
    INTO r_terms
    FROM core.booking_hold_payment_terms(r_hold.id) AS t;
  SELECT pg_catalog.lower(vo.period) AS lo, pg_catalog.upper(vo.period) AS hi INTO r_occ
    FROM core.booking_vehicle_occupancy vo WHERE vo.id = r_hold.occupancy_id;
  SELECT pg_catalog.count(*) = 4
         AND pg_catalog.bool_and(CASE WHEN (r_terms.legs ->> l.leg) ~ '^[0-9]{1,18}$'
                                      THEN l.amount_minor = (r_terms.legs ->> l.leg)::bigint
                                      ELSE false END)
         AND CASE WHEN pg_catalog.jsonb_typeof(r_terms.legs) = 'object'
                  THEN (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(r_terms.legs)) = 4
                  ELSE false END
    INTO v_legs_ok
    FROM core.payment_payment_operation_leg l
   WHERE l.operation_id = p_operation_id;
  IF r_terms.amount_minor IS NULL OR r_terms.timezone IS NULL
     OR r_op.country_code IS DISTINCT FROM r_hold.country_code
     OR r_op.amount_minor IS DISTINCT FROM r_terms.amount_minor
     OR r_op.currency IS DISTINCT FROM r_terms.currency
     OR v_legs_ok IS NOT TRUE
     OR r_terms.scheduled_start IS DISTINCT FROM r_occ.lo
     OR r_terms.scheduled_end IS NULL OR r_terms.scheduled_end <= r_terms.scheduled_start
     OR r_terms.scheduled_end > r_occ.hi THEN
    v_reason := 'ELIGIBILITY_CHANGED';                -- devis invalidé ou preuve ≠ devis (iv)
  ELSIF r_terms.scheduled_start < v_now - pg_catalog.make_interval(mins => v_tolerance) THEN
    v_reason := 'START_PASSED';                       -- (i) : jamais un trip après son début
  ELSIF core.booking_conversion_eligibility(r_hold.id) <> 'ELIGIBLE' THEN
    v_reason := 'ELIGIBILITY_CHANGED';                -- (ii), (iii)
  END IF;
  IF v_reason IS NOT NULL THEN
    RETURN core.booking_open_compensation(r_hold.id, p_operation_id, v_reason);
  END IF;

  -- 3. conversion (ACTIVE, PAYMENT_IN_FLIGHT : même si expires_at est dépassé) ou ré-acquisition
  --    sous la contrainte (EXPIRED, RELEASED) ; d'abord l'expiration ciblée 2a, partie véhicule,
  --    sous le verrou du véhicule déjà tenu (VERIF_17 T3, C4 bis)
  v_late := r_hold.status IN ('EXPIRED', 'RELEASED');
  IF v_late THEN
    -- 2a : texte EXPIRY_2A_SQL de test/support/expiry-2a.ts, partie véhicule seule
    WITH t AS (SELECT platform.now() AS ts),
       due AS (
         SELECT h.id, h.occupancy_id
           FROM core.booking_checkout_hold h, t
          WHERE (h.vehicle_id = v_vehicle OR h.guest_user_id = NULL::uuid)
            AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
            AND h.expires_at <= t.ts
            AND (h.payment_in_flight_until IS NULL OR h.payment_in_flight_until <= t.ts)
            AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation o
                             WHERE o.hold_id = h.id AND o.purpose = 'RENT'
                               AND ( ( o.status IN ('PENDING','SUBMITTED','UNKNOWN')
                                       AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
                                       AND t.ts < h.payment_in_flight_until + make_interval(secs => v_grace) )
                                  OR ( o.status = 'SUCCEEDED'
                                       AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                                        WHERE d.operation_id = o.id) ) ))
          FOR UPDATE OF h SKIP LOCKED
       ), expired AS (
         UPDATE core.booking_checkout_hold SET status = 'EXPIRED', expired_at = (SELECT ts FROM t)
          WHERE id IN (SELECT id FROM due)
         RETURNING occupancy_id
       )
       UPDATE core.booking_vehicle_occupancy
          SET active = false, deactivated_reason = 'HOLD_EXPIRED'
        WHERE id IN (SELECT occupancy_id FROM expired)
          AND kind = 'HOLD';
  END IF;

  LOOP
    v_try := v_try + 1;
    v_conflict := false;
    -- bloc = SAVEPOINT reacquire : toute erreur annule l'occupation, le trip et la disposition
    BEGIN
      UPDATE core.booking_vehicle_occupancy
         SET kind = 'TRIP', active = true, expires_at = NULL, deactivated_reason = NULL,
             ref_type = 'TRIP', ref_id = v_trip
       WHERE id = r_hold.occupancy_id AND kind = 'HOLD';
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n <> 1 THEN
        v_reason := 'INVARIANT_VIOLATION';            -- occupation absente ou déjà TRIP
      ELSE
        -- 4. trip BOOKED (SM-1 HOLD -> BOOKED), occupation du voyageur (sans tampon)
        INSERT INTO core.booking_trip
               (id, guest_user_id, org_id, vehicle_id, country_code, currency, timezone,
                scheduled_start, scheduled_end, status, source_hold_id)
        VALUES (v_trip, v_guest, r_hold.org_id, v_vehicle, r_hold.country_code, r_op.currency,
                r_terms.timezone, r_terms.scheduled_start, r_terms.scheduled_end, 'BOOKED',
                r_hold.id);
        INSERT INTO core.booking_guest_occupancy (id, guest_user_id, period, active, trip_id)
        VALUES (pg_catalog.gen_random_uuid(), v_guest,
                pg_catalog.tstzrange(r_terms.scheduled_start, r_terms.scheduled_end, '[)'), true,
                v_trip);
        -- US-223 (N-160) : version de prix n° 1 du trip = devis engagé au checkout du hold
        -- (aucune ligne pour un hold sans checkout)
        PERFORM core.pricing_bind_checkout_trip(v_trip);
        -- 5. disposition CONVERSION (PK : XOR) puis hold CONVERTED
        INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, trip_id)
        VALUES (p_operation_id, r_hold.id, 'CONVERSION', v_trip);
        UPDATE core.booking_checkout_hold
           SET status = 'CONVERTED', converted_trip_id = v_trip,
               conversion_operation_id = p_operation_id
         WHERE id = r_hold.id;
        INSERT INTO core.outbox_outbox_event
               (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
                actor_role, correlation_id, payload, partition_key)
        SELECT e.type, 1, e.agg_type, e.agg_id, e.version, r_hold.country_code, 'SYSTEM',
               pg_catalog.gen_random_uuid(), e.payload, e.partition
          FROM (VALUES
                  ('booking.hold.converted', 'checkout_hold', r_hold.id, 3,
                   pg_catalog.jsonb_build_object('hold_id', r_hold.id, 'trip_id', v_trip,
                                                 'operation_id', p_operation_id,
                                                 'reacquired', v_late),
                   r_hold.id::text),
                  ('booking.trip.booked', 'trip', v_trip, 0,
                   pg_catalog.jsonb_build_object('trip_id', v_trip, 'hold_id', r_hold.id,
                                                 'vehicle_id', v_vehicle, 'org_id', r_hold.org_id,
                                                 'scheduled_start', r_terms.scheduled_start,
                                                 'scheduled_end', r_terms.scheduled_end),
                   v_trip::text),
                  ('booking.hold.reacquired', 'checkout_hold', r_hold.id, 3,
                   pg_catalog.jsonb_build_object('hold_id', r_hold.id, 'trip_id', v_trip,
                                                 'previous_status', r_hold.status),
                   r_hold.id::text))
               AS e(type, agg_type, agg_id, version, payload, partition)
         WHERE e.type <> 'booking.hold.reacquired' OR v_late;
        -- US-221b (D1) : la CAPTURE prouvée est rattachée au trip né et reportée sur chaque jambe
        -- (montant explicite de l'opération = devis figé, contrôlé à l'étape 2), mouvement CAPTURE
        -- et COLLECTION de l'assureur, dans CETTE transaction ; un refus annule la conversion.
        -- Une AUTH (fixtures de la conversion) n'encaisse rien : aucun report.
        IF r_op.kind = 'CAPTURE' THEN
          PERFORM core.settlement_cmd_apply_conversion_capture(p_operation_id);
        END IF;
      END IF;
    EXCEPTION WHEN exclusion_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint = 'guest_no_overlap' THEN
        v_reason := 'GUEST_OVERLAP';                  -- le voyageur a déjà un trip sur ces dates
      ELSIF v_constraint = 'vehicle_occupancy_no_overlap' THEN
        v_conflict := true;
      ELSE
        RAISE;
      END IF;
    END;

    IF v_reason IS NOT NULL THEN
      RETURN core.booking_open_compensation(r_hold.id, p_operation_id, v_reason);
    END IF;
    IF NOT v_conflict THEN
      RETURN pg_catalog.jsonb_build_object('outcome', 'CONVERTED', 'tripId', v_trip,
                                           'reacquired', v_late);
    END IF;
    IF NOT v_late OR v_try > 1 THEN
      RETURN core.booking_open_compensation(
        r_hold.id, p_operation_id,
        CASE WHEN NOT v_late THEN 'INVARIANT_VIOLATION'
             WHEN r_hold.status = 'RELEASED' THEN 'SLOT_LOST_AFTER_RELEASE'
             ELSE 'SLOT_LOST_AFTER_EXPIRY' END);
    END IF;

    -- Résolution selon l'occupation en conflit (VERIF_17-A4), lue sous le verrou du véhicule :
    --   autre voyageur, blocage, tampon, trip d'un tiers ⇒ SLOT_LOST_* ;
    --   hold du même voyageur déjà payé, ou trip du même voyageur ⇒ DUPLICATE_PAYMENT ;
    --   seulement des holds vivants NON payés du même voyageur ⇒ supplantés (RELEASED,
    --   SUPERSEDED_BY_PAID_HOLD, CANCEL_ORDER de leurs ordres vivants), puis UNE nouvelle tentative.
    --   « Priorité au payeur » (reacquire_preempts_unpaid_hold, M13) : non retenue, non construite.
    SELECT COALESCE(pg_catalog.bool_or(c.cls = 'FOREIGN'), false),
           COALESCE(pg_catalog.bool_or(c.cls = 'SAME_PAID'), false),
           pg_catalog.array_agg(c.hold_id) FILTER (WHERE c.cls = 'SAME_UNPAID')
      INTO v_foreign, v_same_paid, v_unpaid
      FROM (SELECT vo.id,
                   CASE
                     WHEN vo.kind = 'HOLD' AND h2.guest_user_id = v_guest
                          AND h2.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
                          AND EXISTS (SELECT 1 FROM core.payment_payment_operation o2
                                       WHERE o2.hold_id = h2.id AND o2.purpose = 'RENT'
                                         AND o2.status = 'SUCCEEDED')
                       THEN 'SAME_PAID'
                     WHEN vo.kind = 'HOLD' AND h2.guest_user_id = v_guest
                          AND h2.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
                       THEN 'SAME_UNPAID'
                     WHEN vo.kind = 'TRIP' AND tr.guest_user_id = v_guest
                       THEN 'SAME_PAID'
                     ELSE 'FOREIGN'
                   END AS cls,
                   h2.id AS hold_id
              FROM core.booking_vehicle_occupancy vo
              LEFT JOIN core.booking_checkout_hold h2
                     ON vo.kind = 'HOLD' AND h2.occupancy_id = vo.id
              LEFT JOIN core.booking_trip tr
                     ON vo.kind = 'TRIP' AND tr.id = vo.ref_id
             WHERE vo.vehicle_id = v_vehicle AND vo.active AND vo.id <> r_hold.occupancy_id
               AND vo.period && (SELECT o.period FROM core.booking_vehicle_occupancy o
                                  WHERE o.id = r_hold.occupancy_id)) AS c;

    IF v_foreign OR (NOT v_same_paid AND v_unpaid IS NULL) THEN
      RETURN core.booking_open_compensation(
        r_hold.id, p_operation_id,
        CASE WHEN r_hold.status = 'RELEASED' THEN 'SLOT_LOST_AFTER_RELEASE'
             ELSE 'SLOT_LOST_AFTER_EXPIRY' END);
    END IF;
    IF v_same_paid THEN
      RETURN core.booking_open_compensation(r_hold.id, p_operation_id, 'DUPLICATE_PAYMENT');
    END IF;

    FOREACH v_h2 IN ARRAY v_unpaid LOOP
      WITH released AS (
        UPDATE core.booking_checkout_hold
           SET status = 'RELEASED', released_at = v_now, release_reason = 'SUPERSEDED_BY_PAID_HOLD'
         WHERE id = v_h2 AND status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
        RETURNING id, occupancy_id, vehicle_id, org_id, country_code
      ), occupancy AS (
        UPDATE core.booking_vehicle_occupancy vo
           SET active = false, deactivated_reason = 'HOLD_RELEASED'
          FROM released
         WHERE vo.id = released.occupancy_id AND vo.kind = 'HOLD' AND vo.active
      )
      INSERT INTO core.outbox_outbox_event
             (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_role, correlation_id, payload, partition_key)
      SELECT 'booking.hold.released', 1, 'checkout_hold', released.id, 2, released.country_code,
             'SYSTEM', pg_catalog.gen_random_uuid(),
             pg_catalog.jsonb_build_object('hold_id', released.id, 'vehicle_id', released.vehicle_id,
                                           'org_id', released.org_id,
                                           'reason', 'SUPERSEDED_BY_PAID_HOLD',
                                           'superseded_by', r_hold.id),
             released.id::text
        FROM released;
      -- ordres vivants de H2 : annulation par la boîte d'envoi si la capacité est validée
      INSERT INTO core.payment_payment_command
             (id, operation_kind, idem_plain, operation_id, hold_id, country_code, partition_key)
      SELECT pg_catalog.gen_random_uuid(), 'CANCEL_ORDER',
             'hold:' || v_h2::text || ':CANCEL:' || o.id::text || ':a1',
             o.id, v_h2, o.country_code, v_h2::text
        FROM core.payment_payment_operation o
       WHERE o.hold_id = v_h2 AND o.purpose = 'RENT'
         AND o.status IN ('PENDING', 'SUBMITTED', 'UNKNOWN')
         AND o.provider_reference IS NOT NULL
         AND core.payment_capability_bool(o.provider, o.country_code, o.method,
                                          'SUPPORTS_ORDER_CANCEL')
      ON CONFLICT ON CONSTRAINT payment_command_idem_unique DO NOTHING;
    END LOOP;
  END LOOP;
END
$fn$;
COMMENT ON FUNCTION core.booking_convert_payment(uuid) IS
  'Conversion atomique et gardée (17 §2.5 étape 4) : trip BOOKED ou compensation, jamais les deux ; '
  'aucun trip sans preuve rattachée (NOT_PROVEN) ; version de prix n° 1 = devis du checkout ; '
  'autorisation d''une demande : attente de l''hôte ou VOID (booking_request_authorized). '
  'conversion d''une CAPTURE : rattachement au trip et report sur les soldes par jambe '
  '(settlement_cmd_apply_conversion_capture), dans la même transaction. '
  'Travailleurs booking_conversion, disposition_sweeper, payment_intent_sweeper. US-024, US-223, '
  'US-221 (221b).';
