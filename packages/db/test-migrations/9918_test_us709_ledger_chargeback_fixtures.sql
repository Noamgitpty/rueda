-- 9918 — fixtures des preuves du grand livre de l'hôte, des chargebacks et de la compensation
-- (US-709, migration 0167). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique ; la transaction
-- appelante reste sous un rôle de production) : poser les états que d'autres stories écrivent
-- (règlement d'annulation en tête : US-215 ; remboursements appliqués aux soldes : US-224 ; lot
-- déjà PAYÉ au titre d'un trip : premier versement d'US-708 ; créance de Kmino de la règle 3 bis :
-- US-224e) et relire ce qu'aucun rôle applicatif ne lit (imputations, écritures, état SM-6b,
-- ajustement d'un lot). Les montants sont des ENTRÉES recopiées des vecteurs de l'export des
-- oracles ou de 08 ; les attendus des tests viennent de l'export, jamais de ces fixtures. AUCUNE
-- fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Un règlement posé sans ses lignes ni ses jambes ne passe pas le contrôle différé
-- `settlement_balanced` : `us709_settlement` ne sert qu'aux transactions ANNULÉES.
--
-- Retour arrière : DROP FUNCTION test_fixture.us709_* (liste des droits en fin de fichier).

-- Règlement v1 en tête d'un trip (annulation ou trajet réalisé) aux montants d'un vecteur
CREATE FUNCTION test_fixture.us709_settlement(p_trip_id uuid, p_kind text, p_total bigint,
                                              p_refund bigint, p_host bigint)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_t      record;
  v_id     uuid := pg_catalog.gen_random_uuid();
  v_inputs text := '{"engineVersion":"cxl-beta/1","fixture":"US-709"}';
BEGIN
  IF p_kind NOT IN ('CANCELLATION', 'COMPLETION') THEN
    RAISE EXCEPTION 'us709_settlement: nature hors liste %', p_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT t.org_id, t.country_code, t.currency INTO v_t
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  INSERT INTO core.settlement_settlement
         (id, trip_id, segment_no, version, org_id, country_code, currency, kind, engine_version,
          requested_reason, reason, origin, qualification, target_state, host_eligible,
          total_paid_minor, guest_refund_minor, tax_refund_minor, retained_minor,
          retained_tax_minor, host_from_guest_minor, host_compensation_minor,
          host_earnings_minor, platform_net_minor, host_penalty_minor, negative_leg, inputs,
          inputs_hash, param_snapshot_hash)
  VALUES (v_id, p_trip_id, 1, 1, v_t.org_id, v_t.country_code, v_t.currency, p_kind, 'cxl-beta/1',
          'GUEST_CANCELLED', 'GUEST_CANCELLED', 'EVENT', 'VOLUNTARY', 'CANCELLED_BY_GUEST', true,
          p_total, p_refund, 0, p_total - p_refund, 0, p_host, 0, p_host,
          p_total - p_refund - p_host, 0, false, v_inputs,
          pg_catalog.sha256(pg_catalog.convert_to(
            'rueda.settlement.inputs/1' || pg_catalog.chr(10) || v_inputs, 'UTF8')),
          pg_catalog.sha256(pg_catalog.convert_to('fixture US-709', 'UTF8')));
  RETURN v_id;
END
$fn$;

-- Remboursement appliqué aux soldes du trip (cumul `refunded_minor`), en cascade PLATFORM →
-- TAX_THIRD_PARTY → INSURER → HOST sur le disponible de chaque jambe (seule la somme compte)
CREATE FUNCTION test_fixture.us709_refunded(p_trip_id uuid, p_amount bigint)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_left bigint := p_amount;
  v_take bigint;
  b      record;
BEGIN
  FOR b IN
    SELECT x.leg, x.captured_minor + x.reallocated_in_minor - x.refunded_minor
                  - x.reallocated_out_minor - x.released_minor AS available
      FROM core.settlement_trip_leg_balance AS x
     WHERE x.trip_id = p_trip_id AND x.segment_no = 1
     ORDER BY pg_catalog.array_position(ARRAY['PLATFORM', 'TAX_THIRD_PARTY', 'INSURER', 'HOST'], x.leg)
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, b.available);
    UPDATE core.settlement_trip_leg_balance AS x
       SET refunded_minor = x.refunded_minor + v_take
     WHERE x.trip_id = p_trip_id AND x.segment_no = 1 AND x.leg = b.leg;
    v_left := v_left - v_take;
  END LOOP;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'us709_refunded: remboursement au-delà de l''encaissé'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$fn$;

-- Lot PAYÉ portant la jambe HOST d'un trip (part de l'hôte déjà versée : T53, T54 b, T55)
CREATE FUNCTION test_fixture.us709_paid_item(p_trip_id uuid, p_psp_account_id uuid,
                                             p_amount bigint)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.payout_payout_batch
         (id, org_id, country_code, currency, kind, variant, psp_account_id, first_payout, status,
          scheduled_for, gross_minor, netted_minor, net_minor, netted_at, attempt_no,
          idempotency_key, initiated_at, paid_at)
  SELECT v_id, t.org_id, t.country_code, t.currency, 'CXL_EARNINGS', 'SPLIT_AT_SOURCE',
         p_psp_account_id, true, 'PAID', platform.now() - interval '20 days', p_amount, 0,
         p_amount, platform.now() - interval '20 days', 1, pg_catalog.format('payout:%s:r1', v_id),
         platform.now() - interval '20 days', platform.now() - interval '19 days'
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  INSERT INTO core.payout_payout_item
         (batch_id, trip_id, segment_no, leg, org_id, country_code, currency, amount_minor)
  SELECT v_id, t.id, 1, 'HOST', t.org_id, t.country_code, t.currency, p_amount
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  RETURN v_id;
END
$fn$;

-- Créance de Kmino de la règle 3 bis (08 TJ18b / TJ18d) sur le compte d'hôte d'un trip : un trip
-- FRÈRE du même compte, son règlement v1, l'avance RELEASED_LEG OPEN et la créance au host_ledger
-- (forme de 0139), comme si l'avance avait été décidée puis rendue effective (US-224e)
CREATE FUNCTION test_fixture.us709_receivable(p_trip_id uuid, p_amount bigint)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_t       record;
  v_sibling uuid := pg_catalog.gen_random_uuid();
  v_stl     uuid;
  v_adv     uuid := pg_catalog.gen_random_uuid();
BEGIN
  SELECT t.org_id, t.country_code, t.currency, t.timezone INTO v_t
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  PERFORM test_fixture.rls_insert_trip(v_sibling, pg_catalog.gen_random_uuid(), v_t.org_id,
                                       pg_catalog.gen_random_uuid(), v_t.country_code,
                                       v_t.currency, v_t.timezone,
                                       '2033-05-01T10:00:00Z', '2033-05-03T10:00:00Z');
  v_stl := test_fixture.us709_settlement(v_sibling, 'CANCELLATION', p_amount, 0, 0);
  INSERT INTO core.settlement_platform_advance
         (id, country_code, currency, trip_id, org_id, cause, amount_minor, funded_from,
          receivable_minor, status)
  VALUES (v_adv, v_t.country_code, v_t.currency, v_sibling, v_t.org_id, 'RELEASED_LEG', p_amount,
          'COUNTRY_PLATFORM_BALANCE', p_amount, 'OPEN');
  INSERT INTO core.settlement_host_ledger_entry
         (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
          settlement_version, reason, amount_minor, advance_id)
  VALUES (pg_catalog.gen_random_uuid(), v_t.org_id, v_t.country_code, v_t.currency, v_sibling, 1,
          v_stl, 1, 'RELEASED_LEG_ADVANCE', -p_amount, v_adv);
  RETURN v_adv;
END
$fn$;

-- Même créance sur le règlement EN TÊTE (déjà enregistré par la vraie commande) d'un trip :
-- transaction VALIDÉE possible (preuves RLS-26 / RLS-28 et passage en perte à deux personnes)
CREATE FUNCTION test_fixture.us709_receivable_on_head(p_advance_id uuid, p_trip_id uuid,
                                                      p_amount bigint)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s record;
BEGIN
  SELECT x.id, x.trip_id, x.segment_no, x.version, x.org_id, x.country_code, x.currency INTO s
    FROM core.settlement_settlement AS x
   WHERE x.trip_id = p_trip_id
   ORDER BY x.version DESC
   LIMIT 1;
  IF s.id IS NULL THEN
    RAISE EXCEPTION 'us709_receivable_on_head: règlement absent'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.settlement_platform_advance
         (id, country_code, currency, trip_id, org_id, cause, amount_minor, funded_from,
          receivable_minor, status)
  VALUES (p_advance_id, s.country_code, s.currency, s.trip_id, s.org_id, 'RELEASED_LEG', p_amount,
          'COUNTRY_PLATFORM_BALANCE', p_amount, 'OPEN');
  INSERT INTO core.settlement_host_ledger_entry
         (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
          settlement_version, reason, amount_minor, advance_id)
  VALUES (pg_catalog.gen_random_uuid(), s.org_id, s.country_code, s.currency, s.trip_id,
          s.segment_no, s.id, s.version, 'RELEASED_LEG_ADVANCE', -p_amount, p_advance_id);
END
$fn$;

-- Imputation d'un trip de la matrice d'autorisations (US-043) : une ligne cohérente (trajet réalisé,
-- une unité perdue) citant l'encaissement du trip, pour éprouver chaque cellule sur une ligne réelle
CREATE FUNCTION test_fixture.us709_insert_imputation(p_trip_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_op uuid;
  v_t  record;
BEGIN
  SELECT t.org_id, t.country_code, t.currency INTO v_t FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  SELECT o.id INTO v_op FROM core.payment_payment_operation AS o
   WHERE o.trip_id = p_trip_id AND o.kind = 'CAPTURE' ORDER BY o.created_at LIMIT 1;
  IF v_op IS NULL THEN
    RAISE EXCEPTION 'us709_insert_imputation: encaissement absent'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.settlement_chargeback_imputation
         (operation_id, trip_id, segment_no, org_id, country_code, currency, earnings_kind,
          lost_trip_minor, collected_before_minor, refund_committed_minor, owed_minor,
          host_from_guest_minor, host_paid_minor, retained_before_minor, retained_after_minor,
          host_payable_after_minor, clawback_minor, host_unpaid_cancelled_minor,
          guest_receivable_minor, loss_expense_minor, host_leg_minor, insurer_leg_minor,
          tax_third_party_leg_minor, platform_leg_minor)
  VALUES (v_op, p_trip_id, 1, v_t.org_id, v_t.country_code, v_t.currency, 'REALIZED', 1, 1, 0, 1,
          0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, -1)
  ON CONFLICT DO NOTHING;
END
$fn$;

-- Recouvrement partiel d'une avance (état laissé par une compensation, preuve de lecture RLS-26)
CREATE FUNCTION test_fixture.us709_recover(p_advance_id uuid, p_amount bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_platform_advance AS a
     SET recovered_minor = a.recovered_minor + p_amount,
         status = CASE WHEN a.recovered_minor + p_amount = a.receivable_minor THEN 'RECOVERED'
                       ELSE 'RECOVERING' END
   WHERE a.id = p_advance_id
$fn$;

-- Crédit forgé (compensation d'un lot) : prouve la garde « crédit ≤ dette » et l'unique par lot
CREATE FUNCTION test_fixture.us709_try_netting(p_batch_id uuid, p_amount bigint)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.settlement_host_ledger_entry
         (id, org_id, country_code, currency, reason, amount_minor, payout_batch_id)
  SELECT pg_catalog.gen_random_uuid(), b.org_id, b.country_code, b.currency, 'PAYOUT_NETTING',
         p_amount, b.id
    FROM core.payout_payout_batch AS b WHERE b.id = p_batch_id
$fn$;

-- Rejeu d'une mise à jour d'un ordre (déclencheur AFTER UPDATE OF trip_id du chargeback, même valeur)
CREATE FUNCTION test_fixture.us709_touch_operation(p_operation_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.payment_payment_operation SET trip_id = trip_id WHERE id = p_operation_id
$fn$;

-- Relectures (aucun rôle applicatif ne lit ces tables sous un contexte de travailleur)
CREATE FUNCTION test_fixture.us709_imputation(p_operation_id uuid)
  RETURNS TABLE (earnings_kind text, lost_trip_minor text, collected_before_minor text,
                 refund_committed_minor text, owed_minor text, host_paid_minor text,
                 clawback_minor text, host_unpaid_cancelled_minor text,
                 guest_receivable_minor text, loss_expense_minor text, host_leg_minor text,
                 insurer_leg_minor text, tax_third_party_leg_minor text, platform_leg_minor text,
                 currency text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.earnings_kind, i.lost_trip_minor::text, i.collected_before_minor::text,
         i.refund_committed_minor::text, i.owed_minor::text, i.host_paid_minor::text,
         i.clawback_minor::text, i.host_unpaid_cancelled_minor::text,
         i.guest_receivable_minor::text, i.loss_expense_minor::text, i.host_leg_minor::text,
         i.insurer_leg_minor::text, i.tax_third_party_leg_minor::text,
         i.platform_leg_minor::text, i.currency
    FROM core.settlement_chargeback_imputation AS i WHERE i.operation_id = p_operation_id
$fn$;

CREATE FUNCTION test_fixture.us709_ledger(p_trip_id uuid)
  RETURNS TABLE (reason text, amount_minor text, currency text, trip_id uuid,
                 chargeback_operation_id uuid, payout_batch_id uuid, advance_id uuid,
                 write_off_approval_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.reason, e.amount_minor::text, e.currency, e.trip_id, e.chargeback_operation_id,
         e.payout_batch_id, e.advance_id, e.write_off_approval_id
    FROM core.settlement_host_ledger_entry AS e
   WHERE e.org_id = (SELECT t.org_id FROM core.booking_trip AS t WHERE t.id = p_trip_id)
   ORDER BY e.created_at, e.id
$fn$;

CREATE FUNCTION test_fixture.us709_state(p_trip_id uuid)
  RETURNS TABLE (currency text, state text, balance_minor text, open_advances_minor text,
                 next_action_set boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.currency, s.state, s.balance_minor::text, s.open_advances_minor::text,
         s.next_action_at IS NOT NULL
    FROM core.settlement_host_ledger_state AS s
   WHERE s.org_id = (SELECT t.org_id FROM core.booking_trip AS t WHERE t.id = p_trip_id)
   ORDER BY s.currency
$fn$;

CREATE FUNCTION test_fixture.us709_advance_row(p_advance_id uuid)
  RETURNS TABLE (status text, receivable_minor text, recovered_minor text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.status, a.receivable_minor::text, a.recovered_minor::text
    FROM core.settlement_platform_advance AS a WHERE a.id = p_advance_id
$fn$;

CREATE FUNCTION test_fixture.us709_batch_adjustment(p_batch_id uuid)
  RETURNS TABLE (adjustment_status text, adjustment_key text, netted_minor text, net_minor text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT b.adjustment_status, b.adjustment_key, b.netted_minor::text, b.net_minor::text
    FROM core.payout_payout_batch AS b WHERE b.id = p_batch_id
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us709_settlement(uuid, text, bigint, bigint, bigint),
  test_fixture.us709_refunded(uuid, bigint),
  test_fixture.us709_paid_item(uuid, uuid, bigint),
  test_fixture.us709_receivable(uuid, bigint),
  test_fixture.us709_receivable_on_head(uuid, uuid, bigint),
  test_fixture.us709_insert_imputation(uuid),
  test_fixture.us709_recover(uuid, bigint),
  test_fixture.us709_try_netting(uuid, bigint),
  test_fixture.us709_touch_operation(uuid),
  test_fixture.us709_imputation(uuid),
  test_fixture.us709_ledger(uuid),
  test_fixture.us709_state(uuid),
  test_fixture.us709_advance_row(uuid),
  test_fixture.us709_batch_adjustment(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us709_settlement(uuid, text, bigint, bigint, bigint),
  test_fixture.us709_refunded(uuid, bigint),
  test_fixture.us709_paid_item(uuid, uuid, bigint),
  test_fixture.us709_receivable(uuid, bigint),
  test_fixture.us709_receivable_on_head(uuid, uuid, bigint),
  test_fixture.us709_insert_imputation(uuid),
  test_fixture.us709_recover(uuid, bigint),
  test_fixture.us709_try_netting(uuid, bigint),
  test_fixture.us709_touch_operation(uuid),
  test_fixture.us709_imputation(uuid),
  test_fixture.us709_ledger(uuid),
  test_fixture.us709_state(uuid),
  test_fixture.us709_advance_row(uuid),
  test_fixture.us709_batch_adjustment(uuid)
TO app_worker;
GRANT EXECUTE ON FUNCTION
  test_fixture.us709_receivable_on_head(uuid, uuid, bigint),
  test_fixture.us709_recover(uuid, bigint),
  test_fixture.us709_ledger(uuid),
  test_fixture.us709_state(uuid),
  test_fixture.us709_advance_row(uuid)
TO app_api;
