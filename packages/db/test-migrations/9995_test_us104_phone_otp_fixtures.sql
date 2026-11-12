-- 9995 — fixtures des preuves de l'OTP du téléphone (US-104, migration 0066). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) : relecture
-- des défis d'une personne (colonnes que les rôles applicatifs ne lisent pas ; l'empreinte du code
-- n'est JAMAIS rendue, seulement sa présence), des événements émis pour un agrégat et du numéro
-- d'un compte. Les attendus des tests viennent de 19 US-104, 16 VER-013 et 17 §3.2.1, §4.5,
-- jamais de ces relectures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us104_challenges(uuid),
--   test_fixture.us104_events(uuid), test_fixture.us104_account_phone(uuid).

CREATE FUNCTION test_fixture.us104_challenges(p_user uuid)
  RETURNS TABLE (id uuid, phone_e164 text, country_code text, channel text, purpose text,
                 has_code boolean, issued boolean, attempts integer, locked_until timestamptz,
                 consumed_at timestamptz, expires_at timestamptz, created_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.id, c.phone_e164, c.country_code, c.channel, c.purpose, c.code_hash IS NOT NULL,
         c.issued_at IS NOT NULL, c.attempts, c.locked_until, c.consumed_at, c.expires_at,
         c.created_at
    FROM core.iam_otp_challenge AS c
   WHERE c.user_id = p_user
   ORDER BY c.created_at, c.id
$fn$;

CREATE FUNCTION test_fixture.us104_events(p_aggregate uuid)
  RETURNS TABLE (type text, aggregate_type text, country_code text, actor_user_id uuid,
                 actor_role text, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_type, e.country_code, e.actor_user_id, e.actor_role, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_id = p_aggregate
   ORDER BY e.id
$fn$;

CREATE FUNCTION test_fixture.us104_account_phone(p_user uuid)
  RETURNS TABLE (phone_e164 text, phone_verified boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT u.phone_e164, u.phone_verified_at IS NOT NULL
    FROM core.iam_user_account AS u WHERE u.id = p_user
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us104_challenges(uuid), test_fixture.us104_events(uuid),
  test_fixture.us104_account_phone(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us104_challenges(uuid), test_fixture.us104_events(uuid),
  test_fixture.us104_account_phone(uuid) TO app_api;
