-- 9905 — fixtures des preuves du report de la jambe HOST des débits post-trip dans les versements
-- (US-319, migration 0180). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique, EXECUTE au seul
-- app_worker ; la transaction appelante reste sous un rôle de production et est ANNULÉE) : relire
-- les items de lot, les parts rattachées et les soldes de jambe d'un trip (aucun rôle applicatif
-- ne lit les lots), et tenter une écriture interdite sur les parts. Les attendus des tests viennent
-- de 19 / BOARD US-319, 08 (E7, BR-REIMB-04, BR-TT-02) et des vecteurs de l'export des oracles,
-- jamais de ces fixtures. AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us319_* (voir la liste des droits en fin de fichier).

-- Items de lot d'un trip (nature, lot, montant, rang, ordre rattaché, état du lot)
CREATE FUNCTION test_fixture.us319_items(p_trip_id uuid)
  RETURNS TABLE (kind text, batch_id uuid, amount_minor bigint, release_attempt integer,
                 release_operation_id uuid, batch_status text, scheduled_for timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.kind, i.batch_id, i.amount_minor, i.release_attempt, i.release_operation_id, b.status,
         b.scheduled_for
    FROM core.payout_payout_item AS i
    JOIN core.payout_payout_batch AS b ON b.id = i.batch_id
   WHERE i.trip_id = p_trip_id
   ORDER BY b.scheduled_for, i.kind DESC
$fn$;

-- Part rattachée d'un débit post-trip (NULL : aucune)
CREATE FUNCTION test_fixture.us319_share(p_charge_id uuid)
  RETURNS TABLE (amount_minor bigint, item_kind text, batch_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.amount_minor, i.kind, i.batch_id
    FROM core.payout_item_charge AS l
    JOIN core.payout_payout_item AS i ON i.id = l.item_id
   WHERE l.charge_id = p_charge_id
$fn$;

-- Solde d'une jambe du trip (registre miroir, segment 1)
CREATE FUNCTION test_fixture.us319_leg(p_trip_id uuid, p_leg text)
  RETURNS TABLE (captured_minor bigint, released_minor bigint, frozen boolean)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT b.captured_minor, b.released_minor, b.frozen
    FROM core.settlement_trip_leg_balance AS b
   WHERE b.trip_id = p_trip_id AND b.segment_no = 1 AND b.leg = p_leg
$fn$;

-- Écriture interdite sur les parts (la garde de 0180 refuse, même sous migrator)
CREATE FUNCTION test_fixture.us319_try_write(p_what text, p_charge_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_what = 'UPDATE' THEN
    UPDATE core.payout_item_charge AS l SET amount_minor = l.amount_minor + 1
     WHERE l.charge_id = p_charge_id;
  ELSIF p_what = 'DELETE' THEN
    DELETE FROM core.payout_item_charge AS l WHERE l.charge_id = p_charge_id;
  ELSE
    RAISE EXCEPTION 'us319_try_write: % inconnu', p_what;
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us319_items(uuid),
  test_fixture.us319_share(uuid),
  test_fixture.us319_leg(uuid, text),
  test_fixture.us319_try_write(text, uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us319_items(uuid),
  test_fixture.us319_share(uuid),
  test_fixture.us319_leg(uuid, text),
  test_fixture.us319_try_write(text, uuid)
TO app_worker;
