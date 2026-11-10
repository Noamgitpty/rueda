-- 9950 — fixtures des preuves de paiement des revues de la PR n° 92 (US-049, migrations 0055 et
-- 0058). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- `us049_receive_custom` : réception par la VRAIE commande `core.payment_cmd_receive_webhook`, avec
-- la signature déclarée, l'horodatage signé et les événements normalisés choisis par le test (autre
-- opération, autre statut, autre compte, signature invalide, quarantaine d'horodatage), dans la
-- transaction du test (sous app_worker, annulée : aucune ligne laissée aux autres fichiers, aucun
-- compte PSP ACTIVE validé). Cédée à cmd_money_owner, seul rôle (avec app_api) qui exécute la
-- commande ; EXECUTE accordé à app_worker par son propriétaire (même procédé que 9940).
--
-- Retour arrière : DROP FUNCTION test_fixture.us049_receive_custom(uuid, jsonb, boolean, timestamptz).

CREATE FUNCTION test_fixture.us049_receive_custom(p_account_id uuid, p_events jsonb,
                                                  p_signature_valid boolean,
                                                  p_signed_at timestamptz)
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
           p_signature_valid,
           p_signed_at,
           '{}'::jsonb,
           p_events) AS r
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us049_receive_custom(uuid, jsonb, boolean, timestamptz) FROM PUBLIC;
GRANT CREATE ON SCHEMA test_fixture TO cmd_money_owner;
ALTER FUNCTION test_fixture.us049_receive_custom(uuid, jsonb, boolean, timestamptz) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_money_owner;
GRANT USAGE ON SCHEMA test_fixture TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;
GRANT EXECUTE ON FUNCTION test_fixture.us049_receive_custom(uuid, jsonb, boolean, timestamptz)
  TO app_worker;
RESET ROLE;
REVOKE USAGE ON SCHEMA test_fixture FROM cmd_money_owner;
