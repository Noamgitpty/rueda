-- 9914 — fixtures des preuves du no-show et du refus du véhicule (US-307, migration 0171).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique, EXECUTE à app_api et
-- app_worker) :
--   1. test_fixture.us307_holder : titulaire du compte d'hôte d'un trip (pour ouvrir sa session) ;
--   2. test_fixture.us307_identity_check : contrôle du permis écrit DIRECTEMENT (présence des deux
--      parties à la remise, US-315), statut donné ;
--   3. test_fixture.us307_cancellation : relecture d'une demande (les rôles applicatifs n'ont aucun
--      droit sur la table) ;
--   4. test_fixture.us307_guest_checkin : validation de la remise par le voyageur écrite DIRECTEMENT
--      (refus du véhicule après le check-in) ;
--   5. test_fixture.us307_host_ledger : écritures du host_ledger d'un trip (app_worker ne le lit pas).
-- Les messages du fil viennent de test_fixture.us316_seed_message (9919). Appelées SEULEMENT dans
-- une transaction ANNULÉE ou sur des trips neufs. AUCUN interrupteur de mise en service écrit
-- (17 §0.1). Les attendus des tests viennent de 19 US-307, 16 TRP-015 / TRP-007, 08 et des oracles
-- de docs/specs/tools/, jamais de ces fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us307_holder(uuid),
--   test_fixture.us307_identity_check(uuid, text), test_fixture.us307_cancellation(uuid),
--   test_fixture.us307_guest_checkin(uuid), test_fixture.us307_host_ledger(uuid).

CREATE FUNCTION test_fixture.us307_holder(p_trip uuid)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.holder_user_id
    FROM core.booking_trip AS t JOIN core.iam_organization AS o ON o.id = t.org_id
   WHERE t.id = p_trip
$fn$;

-- Contrôle du permis à la remise (six points, conforme ou non), écrit par le titulaire
CREATE FUNCTION test_fixture.us307_identity_check(p_trip uuid, p_status text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO core.trip_ops_identity_check (trip_id, country_code, status, checklist,
                                            failure_subreason, checked_by)
  SELECT t.id, t.country_code, p_status,
         pg_catalog.jsonb_build_object('face', true, 'name', true, 'birthYear', true,
                                       'valid', p_status = 'TRIP_ID_OK', 'provisional', true,
                                       'restrictions', true),
         CASE WHEN p_status = 'TRIP_ID_FAILED' THEN 'INVALID_LICENSE' END,
         test_fixture.us307_holder(t.id)
    FROM core.booking_trip AS t WHERE t.id = p_trip;
END
$fn$;

-- Demande relue (aucun droit applicatif sur la table) : action, motif, initiateur, statut, preuve
CREATE FUNCTION test_fixture.us307_cancellation(p_id uuid)
  RETURNS TABLE (trip_id uuid, action_code text, requested_reason text, initiator text,
                 sub_reason text, status text, host_message_traced boolean, requested_by uuid,
                 requested_at timestamptz, settlement_id uuid, cost_bearer text,
                 outcome_code text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.trip_id, c.action_code, c.requested_reason, c.initiator, c.sub_reason, c.status,
         c.host_message_traced, c.requested_by, c.requested_at, c.settlement_id, c.cost_bearer,
         c.outcome_code
    FROM core.booking_trip_cancellation AS c WHERE c.id = p_id
$fn$;

-- Validation de la remise par le voyageur (relevés de test), à platform.now()
CREATE FUNCTION test_fixture.us307_guest_checkin(p_trip uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.trip_ops_handover_validation (trip_id, country_code, kind, performer_role,
                                                 performed_by, odometer_km, fuel_eighths, method)
  SELECT t.id, t.country_code, 'CHECKIN', 'GUEST', t.guest_user_id, 1000, 8, 'IN_PERSON'
    FROM core.booking_trip AS t WHERE t.id = p_trip
$fn$;

-- Écritures du host_ledger d'un trip (motif, montant signé, devise)
CREATE FUNCTION test_fixture.us307_host_ledger(p_trip uuid)
  RETURNS TABLE (reason text, amount_minor bigint, currency text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.reason, e.amount_minor, e.currency
    FROM core.settlement_host_ledger_entry AS e WHERE e.trip_id = p_trip ORDER BY e.created_at, e.id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us307_holder(uuid), test_fixture.us307_identity_check(uuid, text),
  test_fixture.us307_cancellation(uuid), test_fixture.us307_guest_checkin(uuid),
  test_fixture.us307_host_ledger(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us307_holder(uuid),
  test_fixture.us307_identity_check(uuid, text), test_fixture.us307_cancellation(uuid),
  test_fixture.us307_guest_checkin(uuid), test_fixture.us307_host_ledger(uuid)
  TO app_api, app_worker;
