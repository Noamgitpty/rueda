-- 9940 — fixtures des preuves des correctifs argent de la porte du lot 0 (US-049, migration 0054).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle : poser les états que seuls de futurs écrivains métier poseront (fin du trajet SM-1,
-- `release_at` du versement différé, sous-marchand ACTIVE validé par le PSP), pour prouver que la
-- garde du versement (`core.settlement_release_blocker`) refuse chaque condition manquante, dans
-- l'ordre, jusqu'à l'interrupteur `payouts_enabled`, qui reste false (aucune fixture ne l'écrit :
-- 17 §0.1, commande à deux personnes d'US-125). SECURITY DEFINER sous migrator, search_path figé,
-- aucun SQL dynamique ; la transaction appelante reste sous un rôle de production et est ANNULÉE.
--
-- Retour arrière : DROP FUNCTION test_fixture.us049_set_trip_status(uuid, text),
--   test_fixture.us049_set_release_at(uuid, text, timestamptz),
--   test_fixture.us049_activate_submerchant(uuid, uuid).

CREATE FUNCTION test_fixture.us049_set_trip_status(p_trip_id uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.booking_trip SET status = p_status WHERE id = p_trip_id
$fn$;

CREATE FUNCTION test_fixture.us049_set_release_at(p_trip_id uuid, p_leg text, p_at timestamptz)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.settlement_trip_leg_balance
     SET release_at = p_at
   WHERE trip_id = p_trip_id AND segment_no = 1 AND leg = p_leg
$fn$;

-- Sous-marchand ACTIVE de l'hôte du trip sur ce compte (comme après le KYC du PSP).
CREATE FUNCTION test_fixture.us049_activate_submerchant(p_account_id uuid, p_trip_id uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.payment_psp_submerchant
         (id, psp_account_id, org_id, country_code, attempt_no, idem_plain,
          provider_submerchant_ref, kyc_status, payout_currency, activated_at)
  SELECT pg_catalog.gen_random_uuid(), p_account_id, t.org_id, t.country_code, 1,
         pg_catalog.format('submerchant:%s:a1', t.org_id),
         pg_catalog.format('sub_%s', pg_catalog.replace(t.org_id::text, '-', '')),
         'ACTIVE', t.currency, platform.now()
    FROM core.booking_trip AS t
   WHERE t.id = p_trip_id
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us049_set_trip_status(uuid, text),
  test_fixture.us049_set_release_at(uuid, text, timestamptz),
  test_fixture.us049_activate_submerchant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us049_set_trip_status(uuid, text),
  test_fixture.us049_set_release_at(uuid, text, timestamptz),
  test_fixture.us049_activate_submerchant(uuid, uuid)
TO app_worker;
