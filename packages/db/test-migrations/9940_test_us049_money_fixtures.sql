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
-- `us049_signed_webhook` (RC-5, décision 4 d'ADR-088) : livre un VRAI webhook signé par la commande
-- de réception `core.payment_cmd_receive_webhook` (signature déclarée valide, horodatage signé =
-- platform.now(), un événement normalisé qui désigne l'opération par notre clé `idem_sent`), puis
-- le marque PROCESSED comme le ferait le travailleur `webhook_ingest` (aucune ligne laissée à
-- traiter par d'autres tests). Rend l'identifiant de la ligne d'inbox : c'est le `raw_ref` qu'exige
-- `core.payment_cmd_apply_operation_status` pour une preuve WEBHOOK_SIGNED (0055).
--
-- Retour arrière : DROP FUNCTION test_fixture.us049_set_trip_status(uuid, text),
--   test_fixture.us049_set_release_at(uuid, text, timestamptz),
--   test_fixture.us049_activate_submerchant(uuid, uuid),
--   test_fixture.us049_signed_webhook(uuid, text), test_fixture.us049_receive_signed(uuid, jsonb).

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

-- Réception par la VRAIE commande `core.payment_cmd_receive_webhook` (signature valide, horodatage
-- signé = platform.now()) ; cédée à cmd_money_owner, seul rôle (avec app_api) qui l'exécute
-- (migrator a INHERIT FALSE sur les propriétaires NOLOGIN, ADR-044).
CREATE FUNCTION test_fixture.us049_receive_signed(p_account_id uuid, p_events jsonb)
  RETURNS TABLE (outcome text, inbox_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.outcome, r.inbox_id
    FROM core.payment_cmd_receive_webhook(
           p_account_id,
           pg_catalog.format('evt-%s', pg_catalog.gen_random_uuid()),
           pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.gen_random_uuid()::text, 'UTF8')),
           true,
           platform.now(),
           '{}'::jsonb,
           p_events) AS r
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us049_receive_signed(uuid, jsonb) FROM PUBLIC;
GRANT CREATE ON SCHEMA test_fixture TO cmd_money_owner;
ALTER FUNCTION test_fixture.us049_receive_signed(uuid, jsonb) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_money_owner;
-- la cession retire l'EXECUTE de migrator : le propriétaire le lui rend (USAGE du schéma le temps
-- du GRANT seulement)
GRANT USAGE ON SCHEMA test_fixture TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;
GRANT EXECUTE ON FUNCTION test_fixture.us049_receive_signed(uuid, jsonb) TO migrator;
RESET ROLE;
REVOKE USAGE ON SCHEMA test_fixture FROM cmd_money_owner;

CREATE FUNCTION test_fixture.us049_signed_webhook(p_operation_id uuid, p_status text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_account uuid;
  v_ref     text;
  v_idem    text;
  v_outcome text;
  v_inbox   uuid;
BEGIN
  SELECT o.psp_account_id, o.provider_reference, o.idem_sent INTO v_account, v_ref, v_idem
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'us049_signed_webhook: operation % unknown', p_operation_id;
  END IF;
  SELECT r.outcome, r.inbox_id INTO v_outcome, v_inbox
    FROM test_fixture.us049_receive_signed(
           v_account,
           pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
             'type', 'payment.status',
             'providerReference', COALESCE(v_ref, pg_catalog.format('ref-%s', p_operation_id)),
             'merchantReference', v_idem,
             'status', p_status,
             'occurredAt', pg_catalog.to_char(platform.now() AT TIME ZONE 'UTC',
                                              'YYYY-MM-DD"T"HH24:MI:SS"Z"')))) AS r;
  IF v_outcome IS DISTINCT FROM 'RECEIVED' THEN
    RAISE EXCEPTION 'us049_signed_webhook: webhook %', v_outcome;
  END IF;
  UPDATE core.payment_webhook_inbox
     SET processing_status = 'PROCESSED', processed_at = platform.now()
   WHERE id = v_inbox;
  RETURN v_inbox;
END
$fn$;

REVOKE ALL ON FUNCTION
  test_fixture.us049_signed_webhook(uuid, text),
  test_fixture.us049_set_trip_status(uuid, text),
  test_fixture.us049_set_release_at(uuid, text, timestamptz),
  test_fixture.us049_activate_submerchant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us049_signed_webhook(uuid, text),
  test_fixture.us049_set_trip_status(uuid, text),
  test_fixture.us049_set_release_at(uuid, text, timestamptz),
  test_fixture.us049_activate_submerchant(uuid, uuid)
TO app_worker;
