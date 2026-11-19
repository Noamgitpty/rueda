-- 9921 — fixtures des preuves des lots de versement à l'hôte (US-708, migration 0166). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique, EXECUTE au seul
-- app_worker ; la transaction appelante reste sous un rôle de production et est ANNULÉE) : poser
-- les états que d'autres stories écrivent (fin effective et COMPLETED du trip : US-315 ; compte de
-- versement VÉRIFIÉ : US-707 ; dette au host_ledger : US-709 ; fériés du pays : donnée de
-- configuration ; lot déjà payé : premier versement), relire les lots et items (aucun rôle
-- applicatif ne les lit), et forcer l'état d'un lot pour prouver les gardes de l'envoi. Les
-- attendus des tests viennent de 19 US-708, 08 BR-PAYOUT-02, SM-6 et des vecteurs de l'export des
-- oracles, jamais de ces fixtures. AUCUNE fixture n'écrit un interrupteur de mise en service
-- (17 §0.1) : la garde de 0166 refuse INITIATED tant que payouts_enabled vaut false, même ici.
--
-- Retour arrière : DROP FUNCTION test_fixture.us708_* (voir la liste des droits en fin de fichier).

-- Fin effective (transition RETURNED, heure de la base) puis COMPLETED (fin du trip SM-1)
CREATE FUNCTION test_fixture.us708_complete_trip(p_trip_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO core.booking_trip_state_log (id, trip_id, from_status, to_status, kind, reason_code,
                                           actor_role)
  VALUES (pg_catalog.gen_random_uuid(), p_trip_id, 'IN_PROGRESS', 'RETURNED', 'TRANSITION',
          'CHECKOUT_VALIDATED', 'SYSTEM');
  UPDATE core.booking_trip SET status = 'COMPLETED' WHERE id = p_trip_id;
END
$fn$;

-- Statut du trip (litige : COMPLETED → IN_DISPUTE)
CREATE FUNCTION test_fixture.us708_set_trip_status(p_trip_id uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.booking_trip SET status = p_status WHERE id = p_trip_id
$fn$;

-- Férié du pays (version 1 du calendrier ; transaction ANNULÉE)
CREATE FUNCTION test_fixture.us708_holiday(p_country text, p_date date)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.config_holiday_calendar (country_code, date, name, version)
  VALUES (p_country, p_date, 'Fixture US-708', 1)
  ON CONFLICT DO NOTHING
$fn$;

-- Compte de versement VÉRIFIÉ de l'hôte du trip (enveloppe factice : aucun numéro réel), retenue
-- de changement facultative
CREATE FUNCTION test_fixture.us708_verified_account(p_trip_id uuid, p_change_hold_until timestamptz)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.payout_payout_account
         (id, org_id, user_id, country_code, currency, rail_kind, institution_code,
          account_number_enc, account_key_subject_id, account_last4, holder_name,
          holder_tax_id_kind, status, verified_at, change_hold_until)
  SELECT v_id, o.id, o.holder_user_id, t.country_code, t.currency, 'BANK_ACCOUNT', '0001',
         '\x01'::bytea || pg_catalog.decode(pg_catalog.repeat('ab', 40), 'hex'), o.id, '1234',
         'Fixture Host', 'TAX_ID', 'VERIFIED', platform.now(), p_change_hold_until
    FROM core.booking_trip AS t
    JOIN core.iam_organization AS o ON o.id = t.org_id
   WHERE t.id = p_trip_id;
  RETURN v_id;
END
$fn$;

-- Lot déjà PAYÉ vers le compte de versement (l'hôte n'en est plus à son premier versement)
CREATE FUNCTION test_fixture.us708_paid_batch(p_trip_id uuid, p_account_id uuid,
                                              p_psp_account_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.payout_payout_batch
         (id, org_id, country_code, currency, kind, variant, psp_account_id, payout_account_id,
          first_payout, status, scheduled_for, gross_minor, netted_minor, net_minor, netted_at,
          attempt_no, idempotency_key, initiated_at, paid_at)
  SELECT v_id, t.org_id, t.country_code, t.currency, 'FINAL', 'SPLIT_AT_SOURCE', p_psp_account_id,
         p_account_id, true, 'PAID', platform.now() - interval '30 days', 100, 0, 100,
         platform.now() - interval '30 days', 1, pg_catalog.format('payout:%s:r1', v_id),
         platform.now() - interval '30 days', platform.now() - interval '29 days'
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  RETURN v_id;
END
$fn$;

-- Dette de l'hôte au host_ledger (pénalité d'un AUTRE trip du même compte d'hôte, rattachée à un
-- règlement de ce trip : forme de 0129 ; montant positif ⇒ écriture négative)
CREATE FUNCTION test_fixture.us708_host_debit(p_trip_id uuid, p_amount_minor bigint)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_t       record;
  v_sibling uuid := pg_catalog.gen_random_uuid();
  v_stl     uuid := pg_catalog.gen_random_uuid();
  v_inputs  text := '{"engineVersion":"cxl-beta/1","fixture":"US-708"}';
BEGIN
  SELECT t.org_id, t.country_code, t.currency, t.timezone INTO v_t
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  PERFORM test_fixture.rls_insert_trip(v_sibling, pg_catalog.gen_random_uuid(), v_t.org_id,
                                       pg_catalog.gen_random_uuid(), v_t.country_code,
                                       v_t.currency, v_t.timezone,
                                       '2033-03-01T10:00:00Z', '2033-03-03T10:00:00Z');
  INSERT INTO core.settlement_settlement
         (id, trip_id, segment_no, version, org_id, country_code, currency, kind, engine_version,
          requested_reason, reason, origin, qualification, target_state, host_eligible,
          total_paid_minor, guest_refund_minor, tax_refund_minor, retained_minor,
          retained_tax_minor, host_from_guest_minor, host_compensation_minor,
          host_earnings_minor, platform_net_minor, host_penalty_minor, negative_leg, inputs,
          inputs_hash, param_snapshot_hash)
  VALUES (v_stl, v_sibling, 1, 1, v_t.org_id, v_t.country_code, v_t.currency, 'CANCELLATION',
          'cxl-beta/1', 'HOST_CANCELLED', 'HOST_CANCELLED', 'EVENT', 'FULL', 'CANCELLED_BY_HOST',
          false, 0, 0, 0, 0, 0, 0, 0, 0, 0, p_amount_minor, false, v_inputs,
          pg_catalog.sha256(pg_catalog.convert_to(
            'rueda.settlement.inputs/1' || pg_catalog.chr(10) || v_inputs, 'UTF8')),
          pg_catalog.sha256(pg_catalog.convert_to('fixture US-708', 'UTF8')));
  INSERT INTO core.settlement_host_ledger_entry
         (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
          settlement_version, reason, amount_minor)
  VALUES (pg_catalog.gen_random_uuid(), v_t.org_id, v_t.country_code, v_t.currency, v_sibling, 1,
          v_stl, 1, 'HOST_CANCELLATION_PENALTY', -p_amount_minor);
END
$fn$;

-- Relecture des lots du compte d'hôte d'un trip et des items d'un trip
CREATE FUNCTION test_fixture.us708_batches(p_trip_id uuid)
  RETURNS TABLE (id uuid, status text, scheduled_for timestamptz, first_payout boolean,
                 gross_minor bigint, netted_minor bigint, net_minor bigint, hold_reasons text[],
                 netted_at timestamptz, idempotency_key text, variant text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT b.id, b.status, b.scheduled_for, b.first_payout, b.gross_minor, b.netted_minor,
         b.net_minor, b.hold_reasons, b.netted_at, b.idempotency_key, b.variant
    FROM core.payout_payout_batch AS b
   WHERE b.org_id = (SELECT t.org_id FROM core.booking_trip AS t WHERE t.id = p_trip_id)
   ORDER BY b.created_at, b.id
$fn$;

CREATE FUNCTION test_fixture.us708_items(p_trip_id uuid)
  RETURNS TABLE (id uuid, batch_id uuid, amount_minor bigint, release_attempt integer,
                 release_operation_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.batch_id, i.amount_minor, i.release_attempt, i.release_operation_id
    FROM core.payout_payout_item AS i WHERE i.trip_id = p_trip_id
   ORDER BY i.id
$fn$;

-- Compte PSP d'un compte en variante B (PLATFORM_MOR) : collection_mode n'est écrit par aucun rôle
-- applicatif
CREATE FUNCTION test_fixture.us708_set_collection_mode(p_psp_account_id uuid, p_mode text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.payment_psp_account SET collection_mode = p_mode WHERE id = p_psp_account_id
$fn$;

-- État forcé d'un lot (preuve des gardes de l'envoi) : READY (compensé, net = brut, aucun motif)
-- ou INITIATED (refusé par la garde de 0166 tant que payouts_enabled vaut false)
CREATE FUNCTION test_fixture.us708_force_batch(p_batch_id uuid, p_status text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_status NOT IN ('READY', 'INITIATED') THEN
    RAISE EXCEPTION 'us708_force_batch: état hors liste %', p_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE core.payout_payout_batch AS b
     SET status = p_status, hold_reasons = ARRAY[]::text[], netted_minor = 0,
         net_minor = b.gross_minor, netted_at = COALESCE(b.netted_at, platform.now()),
         attempt_no = CASE WHEN p_status = 'INITIATED' THEN b.attempt_no + 1 ELSE b.attempt_no END,
         idempotency_key = CASE WHEN p_status = 'INITIATED'
                                THEN pg_catalog.format('payout:%s:r%s', b.id, b.attempt_no + 1)
                                ELSE b.idempotency_key END,
         initiated_at = CASE WHEN p_status = 'INITIATED' THEN platform.now() ELSE b.initiated_at END
   WHERE b.id = p_batch_id;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us708_complete_trip(uuid),
  test_fixture.us708_set_trip_status(uuid, text),
  test_fixture.us708_holiday(text, date),
  test_fixture.us708_verified_account(uuid, timestamptz),
  test_fixture.us708_paid_batch(uuid, uuid, uuid),
  test_fixture.us708_host_debit(uuid, bigint),
  test_fixture.us708_batches(uuid),
  test_fixture.us708_items(uuid),
  test_fixture.us708_set_collection_mode(uuid, text),
  test_fixture.us708_force_batch(uuid, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us708_complete_trip(uuid),
  test_fixture.us708_set_trip_status(uuid, text),
  test_fixture.us708_holiday(text, date),
  test_fixture.us708_verified_account(uuid, timestamptz),
  test_fixture.us708_paid_batch(uuid, uuid, uuid),
  test_fixture.us708_host_debit(uuid, bigint),
  test_fixture.us708_batches(uuid),
  test_fixture.us708_items(uuid),
  test_fixture.us708_set_collection_mode(uuid, text),
  test_fixture.us708_force_batch(uuid, text)
TO app_worker;
