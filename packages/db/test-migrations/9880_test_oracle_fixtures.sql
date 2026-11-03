-- 9880 — fixtures de l'oracle C12 et de la garde d'environnement de T1 (US-025). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (et à ses copies `_inj`, `_fuzz`) ; la base `rueda_test_*_prod`
-- garde les définitions de production.
--
--   1. platform.deployment_env() (version de TEST de 9500) : le paramètre de session
--      `app.test_deployment_env` = '__null__' la fait rendre NULL. C'est le seul moyen d'éprouver,
--      sous un rôle de production, la garde fail-closed de T1 (0043) contre un environnement NULL
--      (report de la revue sécurité d'US-024). Toute autre valeur garde le comportement de 9500.
--   2. test_fixture.us025_forge_c12(contrôle, trip) : forge, DANS LA TRANSACTION DE L'APPELANT, la
--      violation d'un contrôle de l'oracle C12 à partir d'un trip converti de référence. Les
--      gardes structurelles qui l'interdisent (index one_conversion_per_hold, triggers de hold et
--      de disposition, triggers différés d'I-OCC) sont levées dans cette transaction seulement :
--      le test rend toujours la transaction par ROLLBACK (DDL transactionnel de PostgreSQL), rien
--      n'est validé. SECURITY DEFINER sous migrator, propriétaire des tables, comme les autres
--      fixtures (hors liste blanche RLS-15, qui porte sur la base de production).
--
-- Retour arrière : réappliquer la définition de 9500 de platform.deployment_env() ;
--   DROP FUNCTION test_fixture.us025_forge_c12(text, uuid).

CREATE OR REPLACE FUNCTION platform.deployment_env()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN pg_catalog.current_setting('app.test_deployment_env', true) = '__null__' THEN NULL
           ELSE COALESCE(NULLIF(pg_catalog.current_setting('app.test_deployment_env', true), ''),
                         'test')
         END
$fn$;

COMMENT ON FUNCTION platform.deployment_env() IS
  'VERSION DE TEST (test-migrations/9500, 9880) : app.test_deployment_env si posé (''__null__'' '
  '⇒ NULL), sinon test.';

CREATE FUNCTION test_fixture.us025_forge_c12(p_check text, p_trip_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_hold uuid;
  v_op   uuid := pg_catalog.gen_random_uuid();
BEGIN
  SELECT t.source_hold_id INTO v_hold FROM core.booking_trip t WHERE t.id = p_trip_id;
  IF v_hold IS NULL THEN
    RAISE EXCEPTION 'us025_forge_c12: trip de référence converti attendu';
  END IF;
  CASE p_check
    WHEN 'TRIP_WITHOUT_ACTIVE_OCCUPANCY' THEN
      -- un second trip non terminal du même voyageur et du même véhicule, sans occupation
      INSERT INTO core.booking_trip (id, guest_user_id, org_id, vehicle_id, country_code, currency,
                                     timezone, scheduled_start, scheduled_end, status)
      SELECT pg_catalog.gen_random_uuid(), t.guest_user_id, t.org_id, t.vehicle_id, t.country_code,
             t.currency, t.timezone, t.scheduled_start, t.scheduled_end, 'BOOKED'
        FROM core.booking_trip t WHERE t.id = p_trip_id;
    WHEN 'SUCCEEDED_WITHOUT_DISPOSITION' THEN
      -- paiement de loyer réussi « maintenant » (horloge de l'appelant), jamais disposé
      PERFORM test_fixture.us024_extra_operation(v_op, v_hold, 'CAPTURE', 90, 'SUCCEEDED');
    WHEN 'COMPENSATED_HOLD_WITH_TRIP' THEN
      -- le hold converti passe COMPENSATED (garde des états terminaux levée) en gardant son trip
      ALTER TABLE core.booking_checkout_hold DISABLE TRIGGER USER;
      UPDATE core.booking_checkout_hold
         SET status = 'COMPENSATED', compensated_at = platform.now()
       WHERE id = v_hold;
    WHEN 'HOLD_WITH_TWO_CONVERSIONS' THEN
      -- seconde disposition CONVERSION du même hold (index unique et trigger levés)
      DROP INDEX core.one_conversion_per_hold;
      ALTER TABLE core.booking_payment_disposition DISABLE TRIGGER USER;
      PERFORM test_fixture.us024_extra_operation(v_op, v_hold, 'CAPTURE', 91, 'SUCCEEDED');
      INSERT INTO core.booking_payment_disposition (operation_id, hold_id, disposition, trip_id)
      VALUES (v_op, v_hold, 'CONVERSION', p_trip_id);
    WHEN 'INACTIVE_TRIP_OCCUPANCY_OF_LIVE_TRIP' THEN
      -- occupation TRIP inactive du trip vivant, en plus de son occupation active
      INSERT INTO core.booking_vehicle_occupancy (id, vehicle_id, kind, source, period, active,
                                                  deactivated_reason, ref_type, ref_id, org_id,
                                                  country_code)
      SELECT pg_catalog.gen_random_uuid(), o.vehicle_id, 'TRIP', o.source, o.period, false,
             'SHORTENED', 'TRIP', o.ref_id, o.org_id, o.country_code
        FROM core.booking_vehicle_occupancy o
       WHERE o.kind = 'TRIP' AND o.active AND o.ref_id = p_trip_id;
    ELSE
      RAISE EXCEPTION 'us025_forge_c12: contrôle inconnu %', p_check;
  END CASE;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us025_forge_c12(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us025_forge_c12(text, uuid) TO app_worker;
