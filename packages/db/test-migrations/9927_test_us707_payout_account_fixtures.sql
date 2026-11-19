-- 9927 — fixtures des preuves du compte de versement de l'hôte (US-707, migration 0159). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) :
--   - relectures des lignes qu'aucun rôle applicatif ne lit (comptes de versement, audit, matrice
--     des permissions) : les attendus des tests viennent de 19 US-707, 16 PYO-001 et 17 §2.3,
--     §3.2.9, §7.2, jamais de ces relectures ;
--   - version d'un paramètre du compte de versement (`payout_account_change_hold_h`,
--     `payout_account_rails`), écrite dans une transaction ANNULÉE par le test (fail-closed).
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us707_* (voir la liste des droits en fin de fichier).

CREATE FUNCTION test_fixture.us707_accounts(p_org uuid)
  RETURNS TABLE (id uuid, status text, country_code text, currency text, rail_kind text,
                 institution_code text, account_number_enc bytea, account_last4 text,
                 holder_name text, holder_tax_id_kind text, reject_reason text,
                 provider_ref text, verified_at timestamptz, change_hold_until timestamptz,
                 replaced_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.id, a.status, a.country_code, a.currency, a.rail_kind, a.institution_code,
         a.account_number_enc, a.account_last4, a.holder_name, a.holder_tax_id_kind,
         a.reject_reason, a.provider_ref, a.verified_at, a.change_hold_until, a.replaced_at
    FROM core.payout_payout_account AS a WHERE a.org_id = p_org
   ORDER BY a.created_at, a.id
$fn$;

CREATE FUNCTION test_fixture.us707_audit(p_org uuid)
  RETURNS TABLE (action_code text, actor_role text, before jsonb, after jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.action_code, l.actor_role, l.before, l.after
    FROM core.audit_audit_log AS l
   WHERE l.subject_type = 'ORGANIZATION' AND l.subject_id = p_org
     AND l.action_code LIKE 'PAYOUT_ACCOUNT_%'
   ORDER BY l.id
$fn$;

CREATE FUNCTION test_fixture.us707_permission_roles(p_code text)
  RETURNS TABLE (role text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT DISTINCT p.role FROM core.iam_role_permission AS p
   WHERE p.permission_code = p_code AND p.valid_from <= platform.now()
     AND (p.valid_to IS NULL OR p.valid_to > platform.now())
   ORDER BY 1
$fn$;

-- Version d'un paramètre du compte de versement : p_value NULL ⇒ la valeur en vigueur est fermée
-- (clé absente, fail-closed) ; sinon une nouvelle version. Transaction de l'appelant, ANNULÉE.
CREATE FUNCTION test_fixture.us707_param_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key NOT IN ('payout_account_change_hold_h', 'payout_account_rails') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_value IS NULL THEN
    -- même mécanique que 9986 : fermeture 10 ms plus tard, puis attente de sa prise d'effet
    UPDATE core.config_param_value
       SET valid_to = platform.now() + pg_catalog.make_interval(secs => 0.01)
     WHERE key = p_key AND country_code = p_country AND scope_type = 'COUNTRY'
       AND valid_to IS NULL;
    PERFORM pg_catalog.pg_sleep(0.05);
    RETURN;
  END IF;
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-707 (annulé)');
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us707_accounts(uuid), test_fixture.us707_audit(uuid),
  test_fixture.us707_permission_roles(text),
  test_fixture.us707_param_version(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us707_accounts(uuid), test_fixture.us707_audit(uuid),
  test_fixture.us707_permission_roles(text),
  test_fixture.us707_param_version(text, text, jsonb) TO app_api;
