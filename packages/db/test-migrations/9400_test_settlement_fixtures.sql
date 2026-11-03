-- 9400 — fixtures des tests de règlements et de jambes (US-018). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : remplacer l'écrivain de `trip_leg_balance` qui n'existe pas encore
-- (`cmd_apply_leg_movement`, montants lus de `payment_operation_leg`, US-061 / US-223) pour poser
-- l'état capturé d'un segment, sans donner aux rôles applicatifs un droit de table qu'ils n'auront
-- pas en production. SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique.
-- La portée (compte d'hôte, pays, devise) est relue du trip, comme le fera la commande réelle.
--
-- Fonctions :
--   - settlement_insert_leg_balance : pose l'état capturé (et libéré) d'une jambe ;
--   - settlement_update_leg_balance / settlement_delete_leg_balance : écritures directes sous
--     migrator, pour prouver les gardes `trip_leg_balance_monotonic` et `trip_leg_balance_no_delete`
--     (aucun rôle de production ne peut écrire la table) ;
--   - settlement_try_trip_update : CÉDÉE à cmd_money_owner, elle exécute réellement un UPDATE de
--     `booking_trip.row_version` sous ce propriétaire pour prouver que `money_lock` (WITH CHECK
--     false) le refuse : le droit UPDATE (row_version) ne sert qu'au verrou FOR UPDATE.
--
-- Retour arrière : DROP FUNCTION test_fixture.settlement_insert_leg_balance(uuid, integer, text,
--   bigint, bigint), test_fixture.settlement_update_leg_balance(uuid, text, bigint, bigint),
--   test_fixture.settlement_delete_leg_balance(uuid, text), test_fixture.settlement_try_trip_update(uuid).

CREATE FUNCTION test_fixture.settlement_insert_leg_balance(
  p_trip_id    uuid,
  p_segment_no integer,
  p_leg        text,
  p_captured   bigint,
  p_released   bigint
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.settlement_trip_leg_balance
         (trip_id, segment_no, leg, org_id, country_code, currency, captured_minor, released_minor)
  SELECT t.id, p_segment_no, p_leg, t.org_id, t.country_code, t.currency, p_captured, p_released
    FROM core.booking_trip AS t
   WHERE t.id = p_trip_id
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.settlement_insert_leg_balance(uuid, integer, text, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.settlement_insert_leg_balance(uuid, integer, text, bigint, bigint)
TO app_api, app_worker;

CREATE FUNCTION test_fixture.settlement_update_leg_balance(
  p_trip_id  uuid,
  p_leg      text,
  p_captured bigint,
  p_released bigint
)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_trip_leg_balance
     SET captured_minor = p_captured, released_minor = p_released
   WHERE trip_id = p_trip_id AND segment_no = 1 AND leg = p_leg
$fn$;

CREATE FUNCTION test_fixture.settlement_delete_leg_balance(p_trip_id uuid, p_leg text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  DELETE FROM core.settlement_trip_leg_balance
   WHERE trip_id = p_trip_id AND segment_no = 1 AND leg = p_leg
$fn$;

CREATE FUNCTION test_fixture.settlement_try_trip_update(p_trip_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.booking_trip SET row_version = row_version WHERE id = p_trip_id
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.settlement_update_leg_balance(uuid, text, bigint, bigint),
  test_fixture.settlement_delete_leg_balance(uuid, text),
  test_fixture.settlement_try_trip_update(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.settlement_update_leg_balance(uuid, text, bigint, bigint),
  test_fixture.settlement_delete_leg_balance(uuid, text),
  test_fixture.settlement_try_trip_update(uuid)
TO app_api, app_worker;

GRANT CREATE ON SCHEMA test_fixture TO cmd_money_owner;
ALTER FUNCTION test_fixture.settlement_try_trip_update(uuid) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_money_owner;
