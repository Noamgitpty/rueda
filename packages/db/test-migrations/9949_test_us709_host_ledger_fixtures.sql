-- 9949 — Fixtures de TEST d'US-709a (0129, ADR-153) : host_ledger minimal. Jamais en production
-- (test-migrations/ seulement). SECURITY DEFINER sous migrator (politique migrator_all) ;
-- l'appelant reste sous un rôle de production (L0-05).
--
--   - us709_insert_entry : écriture posée directement dans le monde de la matrice d'autorisations
--     (l0-us043-authorization-matrix), pour que chaque cellule de lecture de
--     core.settlement_host_ledger_entry et de sa vue de solde soit éprouvée sur des lignes réelles.
--     Elle porte sur le règlement en tête du trip (même hôte, pays, devise et version : clé
--     étrangère de 0129) ; son montant est une donnée de test, jamais un attendu ;
--   - us709_entries : lecture des écritures d'un trip (les travailleurs n'ont aucun droit de
--     lecture sur la table) ;
--   - us709_call_post : appel de la commande de production sous le contexte de session de
--     l'appelant (gardes de la commande : travailleur, règlement, version, idempotence) ;
--   - us709_try_update / us709_try_delete / us709_try_truncate : immuabilité sous le
--     propriétaire de la table.
--
-- Retour arrière : DROP FUNCTION test_fixture.us709_insert_entry(uuid, uuid, bigint),
--   test_fixture.us709_entries(uuid), test_fixture.us709_call_post(uuid),
--   test_fixture.us709_try_update(uuid), test_fixture.us709_try_delete(uuid),
--   test_fixture.us709_try_truncate();

CREATE FUNCTION test_fixture.us709_insert_entry(p_id uuid, p_trip_id uuid, p_debit bigint)
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
    RAISE EXCEPTION 'us709_insert_entry: règlement absent';
  END IF;
  INSERT INTO core.settlement_host_ledger_entry
         (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
          settlement_version, reason, amount_minor)
  VALUES (p_id, s.org_id, s.country_code, s.currency, s.trip_id, s.segment_no, s.id, s.version,
          'HOST_CANCELLATION_PENALTY', -p_debit);
END
$fn$;

CREATE FUNCTION test_fixture.us709_entries(p_trip_id uuid)
  RETURNS TABLE (id uuid, org_id uuid, country_code text, currency text, trip_id uuid,
                 segment_no integer, settlement_id uuid, settlement_version integer, reason text,
                 amount_minor text, created_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.id, e.org_id, e.country_code, e.currency, e.trip_id, e.segment_no, e.settlement_id,
         e.settlement_version, e.reason, e.amount_minor::text, e.created_at
    FROM core.settlement_host_ledger_entry AS e
   WHERE e.trip_id = p_trip_id
   ORDER BY e.created_at, e.id
$fn$;

CREATE FUNCTION test_fixture.us709_call_post(p_settlement_id uuid)
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.settlement_cmd_post_host_penalty(p_settlement_id)
$fn$;

CREATE FUNCTION test_fixture.us709_try_update(p_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_host_ledger_entry SET amount_minor = amount_minor - 1 WHERE id = p_id
$fn$;

CREATE FUNCTION test_fixture.us709_try_delete(p_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  DELETE FROM core.settlement_host_ledger_entry WHERE id = p_id
$fn$;

CREATE FUNCTION test_fixture.us709_try_truncate()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  TRUNCATE core.settlement_host_ledger_entry;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us709_insert_entry(uuid, uuid, bigint), test_fixture.us709_entries(uuid),
  test_fixture.us709_call_post(uuid), test_fixture.us709_try_update(uuid),
  test_fixture.us709_try_delete(uuid), test_fixture.us709_try_truncate()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us709_insert_entry(uuid, uuid, bigint), test_fixture.us709_entries(uuid),
  test_fixture.us709_call_post(uuid), test_fixture.us709_try_update(uuid),
  test_fixture.us709_try_delete(uuid), test_fixture.us709_try_truncate()
  TO app_worker;
