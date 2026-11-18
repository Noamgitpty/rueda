-- 9941 — Fixtures de TEST d'US-224e (migrations 0136 et 0137, ADR-163) : créance de la règle 3 bis
-- au host_ledger et hôte défaillant. Jamais en production (test-migrations/ seulement).
-- SECURITY DEFINER sous migrator (politique migrator_all) ; l'appelant reste sous un rôle de
-- production (L0-05).
--
--   - us224e_ledger_entries : lecture des écritures d'un trip AVEC l'avance citée (les travailleurs
--     n'ont aucun droit de lecture sur la table) ;
--   - us224e_call_post_receivable : appel de la commande de production sous le contexte de session
--     de l'appelant (gardes de la commande : travailleur, avance, idempotence) ;
--   - us224e_org_holder : titulaire d'un compte d'hôte posé par la fixture 9300 (sujet de la
--     restriction RESTRICT_ACCOUNT) ;
--   - us224e_cancellations : demandes d'annulation d'un compte d'hôte (lecture de contrôle).
--
-- Retour arrière : DROP FUNCTION test_fixture.us224e_ledger_entries(uuid),
--   test_fixture.us224e_call_post_receivable(uuid), test_fixture.us224e_org_holder(uuid),
--   test_fixture.us224e_cancellations(uuid);

CREATE FUNCTION test_fixture.us224e_ledger_entries(p_trip_id uuid)
  RETURNS TABLE (id uuid, org_id uuid, country_code text, currency text, trip_id uuid,
                 segment_no integer, settlement_id uuid, settlement_version integer, reason text,
                 amount_minor text, advance_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.id, e.org_id, e.country_code, e.currency, e.trip_id, e.segment_no, e.settlement_id,
         e.settlement_version, e.reason, e.amount_minor::text, e.advance_id
    FROM core.settlement_host_ledger_entry AS e
   WHERE e.trip_id = p_trip_id
   ORDER BY e.created_at, e.id
$fn$;

CREATE FUNCTION test_fixture.us224e_call_post_receivable(p_advance_id uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.settlement_cmd_post_advance_receivable(p_advance_id)
$fn$;

CREATE FUNCTION test_fixture.us224e_org_holder(p_org_id uuid)
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.holder_user_id FROM core.iam_organization AS o WHERE o.id = p_org_id
$fn$;

CREATE FUNCTION test_fixture.us224e_cancellations(p_org_id uuid)
  RETURNS TABLE (id uuid, trip_id uuid, action_code text, requested_reason text, initiator text,
                 status text, requested_by uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.id, c.trip_id, c.action_code, c.requested_reason, c.initiator, c.status, c.requested_by
    FROM core.booking_trip_cancellation AS c
    JOIN core.booking_trip AS t ON t.id = c.trip_id
   WHERE t.org_id = p_org_id
   ORDER BY t.scheduled_start, t.id, c.created_at
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us224e_ledger_entries(uuid), test_fixture.us224e_call_post_receivable(uuid),
  test_fixture.us224e_org_holder(uuid), test_fixture.us224e_cancellations(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us224e_ledger_entries(uuid), test_fixture.us224e_org_holder(uuid),
  test_fixture.us224e_cancellations(uuid)
  TO app_api, app_worker;

-- La commande de production n'a AUCUN EXECUTE (appelée par son déclencheur seulement) et migrator
-- n'hérite pas des droits de cmd_money_owner : us224e_call_post_receivable est cédée à
-- cmd_money_owner, propriétaire de la commande (comme us709_call_post, fixture 9949) ; l'EXECUTE
-- d'app_worker est rendu par le nouveau propriétaire. Aucun droit de production n'est modifié.
GRANT CREATE ON SCHEMA test_fixture TO cmd_money_owner;
ALTER FUNCTION test_fixture.us224e_call_post_receivable(uuid) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_money_owner;
GRANT USAGE ON SCHEMA test_fixture TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;
GRANT EXECUTE ON FUNCTION test_fixture.us224e_call_post_receivable(uuid) TO app_worker;
RESET ROLE;
REVOKE USAGE ON SCHEMA test_fixture FROM cmd_money_owner;
