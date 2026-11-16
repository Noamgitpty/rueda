-- 9977 — fixtures des preuves des protections du voyageur et des plans de gains de l'hôte (US-226,
-- migrations 0110 et 0111). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique), appelée
-- SEULEMENT dans des transactions de test ANNULÉES :
--   1. `us226_set_param` / `us226_close_param` : nouvelle valeur ou fermeture d'un paramètre de la
--      protection ou du plan d'un pays (comme la console de configuration), à platform.now() ;
--      clés permises : protection_grid, guest_protection_min_level, insurer_premium_share,
--      host_share_pct (grille, parts et plans de TEST : entrées des tests, jamais des attendus) ;
--   2. `us226_set_vehicle_plan` : version suivante du plan d'un véhicule, comme la commande de
--      l'hôte (prouvée à part, avec un vrai hôte) ;
--   3. `us226_plan_rows` : relecture brute du registre des plans (aucun rôle applicatif ne le lit) ;
--   4. `us226_try_write` : écriture directe sous migrator (immuabilité, tous rôles).
--
-- Retour arrière : DROP FUNCTION test_fixture.us226_set_param(text, text, jsonb),
--   test_fixture.us226_close_param(text, text), test_fixture.us226_set_vehicle_plan(uuid, text),
--   test_fixture.us226_plan_rows(uuid), test_fixture.us226_try_write(uuid, text).

CREATE FUNCTION test_fixture.us226_set_param(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key NOT IN ('protection_grid', 'guest_protection_min_level', 'insurer_premium_share',
                   'host_share_pct') THEN
    RAISE EXCEPTION 'clé hors du périmètre des fixtures US-226' USING ERRCODE = 'check_violation';
  END IF;
  -- valid_from (platform.now()) et devise posés par la garde de 0008
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-226 : valeur de test');
END
$fn$;

CREATE FUNCTION test_fixture.us226_close_param(p_key text, p_country text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.config_param_value
     SET valid_to = platform.now()
   WHERE key = p_key
     AND key IN ('protection_grid', 'guest_protection_min_level', 'insurer_premium_share',
                 'host_share_pct')
     AND country_code = p_country AND scope_type = 'COUNTRY' AND valid_to IS NULL
$fn$;

CREATE FUNCTION test_fixture.us226_set_vehicle_plan(p_vehicle_id uuid, p_plan_code text)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_version integer;
BEGIN
  SELECT COALESCE(pg_catalog.max(p.version), 0) + 1 INTO v_version
    FROM core.catalog_vehicle_earnings_plan AS p WHERE p.vehicle_id = p_vehicle_id;
  INSERT INTO core.catalog_vehicle_earnings_plan (vehicle_id, version, org_id, country_code,
                                                  plan_code, chosen_by)
  SELECT v.id, v_version, v.org_id, v.country_code, p_plan_code,
         (SELECT l.created_by FROM core.catalog_listing AS l WHERE l.vehicle_id = v.id LIMIT 1)
    FROM core.catalog_vehicle AS v
   WHERE v.id = p_vehicle_id;
  RETURN v_version;
END
$fn$;

CREATE FUNCTION test_fixture.us226_plan_rows(p_vehicle_id uuid)
  RETURNS TABLE (version integer, plan_code text, org_id uuid, country_code text, chosen_by uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p.version, p.plan_code, p.org_id, p.country_code::text, p.chosen_by
    FROM core.catalog_vehicle_earnings_plan AS p
   WHERE p.vehicle_id = p_vehicle_id
   ORDER BY p.version
$fn$;

-- Écriture directe sous migrator : mise à jour, suppression, TRUNCATE. Rend le SQLSTATE et la
-- contrainte de l'erreur, ou 'OK'.
CREATE FUNCTION test_fixture.us226_try_write(p_vehicle_id uuid, p_kind text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_state      text;
  v_constraint text;
BEGIN
  BEGIN
    CASE p_kind
      WHEN 'update' THEN
        UPDATE core.catalog_vehicle_earnings_plan SET plan_code = plan_code
         WHERE vehicle_id = p_vehicle_id;
      WHEN 'delete' THEN
        DELETE FROM core.catalog_vehicle_earnings_plan WHERE vehicle_id = p_vehicle_id;
      WHEN 'truncate' THEN
        TRUNCATE core.catalog_vehicle_earnings_plan;
      ELSE
        RETURN 'UNKNOWN';
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_constraint = CONSTRAINT_NAME;
    RETURN v_state || ':' || COALESCE(v_constraint, '');
  END;
  RETURN 'OK';
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us226_set_param(text, text, jsonb),
  test_fixture.us226_close_param(text, text), test_fixture.us226_set_vehicle_plan(uuid, text),
  test_fixture.us226_plan_rows(uuid), test_fixture.us226_try_write(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us226_set_param(text, text, jsonb),
  test_fixture.us226_close_param(text, text), test_fixture.us226_set_vehicle_plan(uuid, text),
  test_fixture.us226_plan_rows(uuid), test_fixture.us226_try_write(uuid, text) TO app_api;
