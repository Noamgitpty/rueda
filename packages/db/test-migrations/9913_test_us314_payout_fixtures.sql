-- 9913 — fixtures des preuves d'US-314 (migration 0172) : réclamation ouverte ⇒ versement retenu,
-- lecture des versements par l'hôte titulaire (A08). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique ; la transaction
-- appelante reste sous un rôle de production et est ANNULÉE) : poser les états que d'autres
-- commandes écrivent — décision du support sur un dossier (`support_staff_set_case_status`, US-101 /
-- US-310, garde de séparation des tâches prouvée par leurs stories), lot de versement d'un état
-- donné (US-708 / US-709 : préparation, compensation, émission et paiement prouvés par
-- `l0-us708-*`). Les attendus des tests viennent de 19 US-314, 08 BR-PAYOUT-02, SM-6, 17 §2.3 et
-- des vecteurs de l'export des oracles, jamais de ces fixtures. AUCUNE fixture n'écrit un
-- interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us314_set_case_status(uuid, text),
--   test_fixture.us314_batch(uuid, text, text[], timestamptz, boolean, bigint, bigint).

-- Décision du support sur un dossier (OPEN → PENDING → RESOLVED / CLOSED)
CREATE FUNCTION test_fixture.us314_set_case_status(p_case_id uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.support_support_case SET status = p_status WHERE id = p_case_id
$fn$;

-- Lot de versement d'un état donné pour le compte d'hôte d'un trip, et son item (montant = brut).
-- Compensé (`netted_at`) pour tout état après SCHEDULED / ON_HOLD ; émis et payé pour PAID.
CREATE FUNCTION test_fixture.us314_batch(p_trip_id uuid, p_status text, p_hold_reasons text[],
                                         p_scheduled_for timestamptz, p_first boolean,
                                         p_gross_minor bigint, p_netted_minor bigint)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id     uuid := pg_catalog.gen_random_uuid();
  v_t      record;
  v_netted boolean := p_status NOT IN ('SCHEDULED', 'ON_HOLD');
  v_sent   boolean := p_status IN ('INITIATED', 'IN_TRANSIT', 'PAID', 'FAILED');
BEGIN
  SELECT t.org_id, t.country_code, t.currency INTO v_t
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  INSERT INTO core.payout_payout_batch
         (id, org_id, country_code, currency, kind, variant, psp_account_id, payout_account_id,
          first_payout, status, scheduled_for, gross_minor, netted_minor, net_minor, hold_reasons,
          netted_at, attempt_no, idempotency_key, initiated_at, paid_at)
  VALUES (v_id, v_t.org_id, v_t.country_code, v_t.currency, 'FINAL', 'SPLIT_AT_SOURCE',
          test_fixture.fixture_psp_account(v_t.country_code), NULL, p_first, p_status,
          p_scheduled_for, p_gross_minor, p_netted_minor, p_gross_minor - p_netted_minor,
          COALESCE(p_hold_reasons, ARRAY[]::text[]),
          CASE WHEN v_netted THEN p_scheduled_for END,
          CASE WHEN v_sent THEN 1 ELSE 0 END,
          CASE WHEN v_sent THEN pg_catalog.format('payout:%s:r1', v_id) END,
          CASE WHEN v_sent THEN p_scheduled_for + interval '1 minute' END,
          CASE WHEN p_status = 'PAID' THEN p_scheduled_for + interval '1 day' END);
  INSERT INTO core.payout_payout_item (batch_id, trip_id, segment_no, leg, org_id, country_code,
                                       currency, amount_minor)
  VALUES (v_id, p_trip_id, 1, 'HOST', v_t.org_id, v_t.country_code, v_t.currency, p_gross_minor);
  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us314_set_case_status(uuid, text),
  test_fixture.us314_batch(uuid, text, text[], timestamptz, boolean, bigint, bigint)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us314_set_case_status(uuid, text) TO app_worker;
GRANT EXECUTE ON FUNCTION
  test_fixture.us314_batch(uuid, text, text[], timestamptz, boolean, bigint, bigint)
TO app_api;
