-- 0065 — graine complémentaire : paramètres « otp_rate_* » (US-104 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « otp_rate_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('otp_rate_per_account_hour', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-104 (envois d''OTP par compte et par heure, parade au SMS pumping)', 'PROPOSÉ'),
  ('otp_rate_per_prefix_hour', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-104 (envois d''OTP par indicatif pays et par heure, parade au SMS pumping)', 'PROPOSÉ');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('otp_rate_per_account_hour', 'PA', 'COUNTRY', NULL, NULL, '5'::jsonb, 'graine US-104 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('otp_rate_per_account_hour', 'PY', 'COUNTRY', NULL, NULL, '5'::jsonb, 'graine US-104 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('otp_rate_per_prefix_hour', 'PA', 'COUNTRY', NULL, NULL, '300'::jsonb, 'graine US-104 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('otp_rate_per_prefix_hour', 'PY', 'COUNTRY', NULL, NULL, '300'::jsonb, 'graine US-104 : défauts PROPOSÉS (17 §6.6, §7.2)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'otp\_rate\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre otp_rate_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
