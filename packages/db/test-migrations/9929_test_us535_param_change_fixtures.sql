-- 9929 — fixtures des preuves du changement revu d'une valeur de paramètre pays (US-535a,
-- migration 0157). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (search_path figé, EXECUTE au seul app_api) :
--   1. test_fixture.us535_set_bound (SECURITY DEFINER sous migrator) : pose une borne dans
--      `core.config_param_bound`. À n'appeler que dans une transaction ANNULÉE : aucune borne réelle
--      n'est posée par la story (0157 n'en écrit aucune, les clés numériques restent refusées) ;
--   2. test_fixture.us535_versions / us535_requests (SECURITY DEFINER sous migrator) : relecture des
--      versions de `config_param_value` (app_api ne lit ni `approved_by` ni `change_reason`) et des
--      demandes (aucun rôle applicatif ne les lit) ;
--   3. test_fixture.us535_owner_write (SECURITY DEFINER sous le propriétaire NOLOGIN
--      cmd_param_owner, comme les sondes de 9960 sous cmd_golive_owner) : écriture DIRECTE de
--      `config_param_value` avec les droits du propriétaire des commandes, hors des commandes ;
--      preuve STRUCTURELLE qu'une écriture d'interrupteur par ce propriétaire échoue contre le
--      trigger `param_value_go_live_guard` de 0073 (insertion) ou ne voit aucune ligne (fermeture),
--      et qu'une version sans demande approuvée est refusée par la RLS. À n'appeler que dans une
--      transaction annulée.
-- Les attendus des tests viennent de 19 US-535 (US-535a) et de 17 §0.1 / §2.3, jamais de ces
-- fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us535_set_bound(text, text, numeric, numeric),
--   test_fixture.us535_versions(text, text), test_fixture.us535_requests(text, text),
--   test_fixture.us535_owner_write(text, text, text, jsonb) ;
--   REVOKE USAGE ON SCHEMA test_fixture FROM cmd_param_owner.

CREATE FUNCTION test_fixture.us535_set_bound(p_key text, p_country text, p_min numeric,
                                             p_max numeric)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.config_param_bound (key, country_code, min_value, max_value, source_ref)
  VALUES (p_key, p_country, p_min, p_max, 'US-535a : borne de test (transaction annulée)')
$fn$;

CREATE FUNCTION test_fixture.us535_versions(p_key text, p_country text)
  RETURNS TABLE (id uuid, value jsonb, currency text, valid_from timestamptz,
                 valid_to timestamptz, approved_by uuid, decision_ref text, change_reason text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.id, v.value, v.currency::text, v.valid_from, v.valid_to, v.approved_by,
         v.decision_ref, v.change_reason
    FROM core.config_param_value AS v
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY'
   ORDER BY v.valid_from
$fn$;

CREATE FUNCTION test_fixture.us535_requests(p_key text, p_country text)
  RETURNS TABLE (id uuid, status text, requested_by uuid, approved_by uuid, value jsonb,
                 valid_from timestamptz, decision_ref text, expires_at timestamptz,
                 requested_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.id, r.status, r.requested_by, r.approved_by, r.value, r.valid_from, r.decision_ref,
         r.expires_at, r.requested_at
    FROM core.config_param_change_request AS r
   WHERE r.key = p_key AND r.country_code::text = p_country
   ORDER BY r.requested_at, r.id
$fn$;

CREATE FUNCTION test_fixture.us535_owner_write(p_what text, p_key text, p_country text,
                                               p_value jsonb)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_n integer;
BEGIN
  CASE p_what
    WHEN 'insert' THEN
      INSERT INTO core.config_param_value (key, country_code, scope_type, value, valid_from,
                                           approved_by, decision_ref, change_reason)
      VALUES (p_key, p_country, 'COUNTRY', p_value, platform.now() + interval '1 day',
              pg_catalog.gen_random_uuid(), 'DEC-FONDATEUR-15',
              'US-535a : écriture directe du propriétaire des commandes (sonde)');
      GET DIAGNOSTICS v_n = ROW_COUNT;
    WHEN 'close' THEN
      UPDATE core.config_param_value SET valid_to = platform.now() + interval '1 day'
       WHERE key = p_key AND country_code = p_country AND valid_to IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    ELSE
      RAISE EXCEPTION 'us535_owner_write : cas inconnu %', p_what;
  END CASE;
  RETURN v_n;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us535_set_bound(text, text, numeric, numeric),
  test_fixture.us535_versions(text, text), test_fixture.us535_requests(text, text),
  test_fixture.us535_owner_write(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us535_set_bound(text, text, numeric, numeric),
  test_fixture.us535_versions(text, text), test_fixture.us535_requests(text, text),
  test_fixture.us535_owner_write(text, text, text, jsonb) TO app_api;

-- droits posés AVANT le changement de propriétaire (l'ACL suit la fonction)
GRANT USAGE ON SCHEMA test_fixture TO cmd_param_owner;
GRANT CREATE ON SCHEMA test_fixture TO cmd_param_owner;
ALTER FUNCTION test_fixture.us535_owner_write(text, text, text, jsonb) OWNER TO cmd_param_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_param_owner;
