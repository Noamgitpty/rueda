-- 9943 — fixtures des preuves des rails de la caution (US-225, migration 0138 ; ADR-164).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Nouvelle version d'un paramètre de la caution, valable à platform.now(), écrite dans la
-- transaction de l'appelant (app_api), qui l'ANNULE ensuite (comme us124_param_version). Clés
-- fermées : paramètres de déclencheur et de rail que lit PgDepositRailConfigReader, valeurs de
-- test de 08 (T57–T59, T69–T73). Jamais un interrupteur de mise en service : funds_holding_enabled
-- ne s'ouvre que par la procédure à deux personnes (test/support/golive.ts). Les attendus du test
-- viennent de 08 et des oracles de docs/specs/tools/, jamais de ces fixtures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us225_param_version(text, text, jsonb).

CREATE FUNCTION test_fixture.us225_param_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key NOT IN ('deposit_always_required', 'deposit_trigger_classes', 'deposit_young_driver_age',
                   'deposit_young_driver_classes', 'deposit_on_risk_flag', 'risk_control_deployed',
                   'deposit_amount', 'deposit_charge_cap', 'provider_max_hold_h',
                   'deposit_reauth_lead_h') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-225 (annulé)');
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us225_param_version(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us225_param_version(text, text, jsonb) TO app_api;
