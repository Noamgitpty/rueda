-- 0046 — graine complémentaire : paramètres « rate_limit_* » (US-052 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « rate_limit_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('rate_limit_api_per_account_minute', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (API par compte et par minute)', 'PROPOSÉ'),
  ('rate_limit_api_per_ip_minute', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (API par IP et par minute)', 'PROPOSÉ'),
  ('rate_limit_bot_weight', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (poids d''une requête suspecte : client ralenti)', 'PROPOSÉ'),
  ('rate_limit_email_per_address_hour', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (e-mails coûteux par adresse et par heure)', 'PROPOSÉ'),
  ('rate_limit_email_per_ip_hour', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (e-mails coûteux par IP et par heure)', 'PROPOSÉ'),
  ('rate_limit_otp_per_ip_hour', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (envois d''OTP par IP et par heure)', 'PROPOSÉ'),
  ('rate_limit_otp_per_phone_hour', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (envois d''OTP par numéro et par heure)', 'PROPOSÉ'),
  ('rate_limit_quote_per_account_minute', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (devis par compte et par minute)', 'PROPOSÉ'),
  ('rate_limit_quote_per_ip_minute', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (devis par IP et par minute)', 'PROPOSÉ'),
  ('rate_limit_search_per_account_minute', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (recherche publique par compte et par minute)', 'PROPOSÉ'),
  ('rate_limit_search_per_ip_minute', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (recherche publique par IP et par minute)', 'PROPOSÉ'),
  ('rate_limit_signup_burst_per_ip_10min', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (inscriptions en rafale par IP en 10 min)', 'PROPOSÉ'),
  ('rate_limit_sms_daily_cap', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (plafond journalier d''envois SMS du pays, jour local)', 'PROPOSÉ'),
  ('rate_limit_webhook_per_ip_minute', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §6.6 ; 19 US-052 (webhooks : limite large, corps borné)', 'PROPOSÉ');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('rate_limit_api_per_account_minute', 'PA', 'COUNTRY', NULL, NULL, '300'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_api_per_account_minute', 'PY', 'COUNTRY', NULL, NULL, '300'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_api_per_ip_minute', 'PA', 'COUNTRY', NULL, NULL, '600'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_api_per_ip_minute', 'PY', 'COUNTRY', NULL, NULL, '600'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_bot_weight', 'PA', 'COUNTRY', NULL, NULL, '4'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_bot_weight', 'PY', 'COUNTRY', NULL, NULL, '4'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_email_per_address_hour', 'PA', 'COUNTRY', NULL, NULL, '10'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_email_per_address_hour', 'PY', 'COUNTRY', NULL, NULL, '10'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_email_per_ip_hour', 'PA', 'COUNTRY', NULL, NULL, '50'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_email_per_ip_hour', 'PY', 'COUNTRY', NULL, NULL, '50'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_otp_per_ip_hour', 'PA', 'COUNTRY', NULL, NULL, '20'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_otp_per_ip_hour', 'PY', 'COUNTRY', NULL, NULL, '20'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_otp_per_phone_hour', 'PA', 'COUNTRY', NULL, NULL, '5'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_otp_per_phone_hour', 'PY', 'COUNTRY', NULL, NULL, '5'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_quote_per_account_minute', 'PA', 'COUNTRY', NULL, NULL, '60'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_quote_per_account_minute', 'PY', 'COUNTRY', NULL, NULL, '60'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_quote_per_ip_minute', 'PA', 'COUNTRY', NULL, NULL, '60'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_quote_per_ip_minute', 'PY', 'COUNTRY', NULL, NULL, '60'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_search_per_account_minute', 'PA', 'COUNTRY', NULL, NULL, '120'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_search_per_account_minute', 'PY', 'COUNTRY', NULL, NULL, '120'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_search_per_ip_minute', 'PA', 'COUNTRY', NULL, NULL, '120'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_search_per_ip_minute', 'PY', 'COUNTRY', NULL, NULL, '120'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_signup_burst_per_ip_10min', 'PA', 'COUNTRY', NULL, NULL, '5'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_signup_burst_per_ip_10min', 'PY', 'COUNTRY', NULL, NULL, '5'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_sms_daily_cap', 'PA', 'COUNTRY', NULL, NULL, '2000'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_sms_daily_cap', 'PY', 'COUNTRY', NULL, NULL, '2000'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_webhook_per_ip_minute', 'PA', 'COUNTRY', NULL, NULL, '6000'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)'),
  ('rate_limit_webhook_per_ip_minute', 'PY', 'COUNTRY', NULL, NULL, '6000'::jsonb, 'graine US-052 : défauts PROPOSÉS (17 §6.6, §7.2)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'rate\_limit\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre rate_limit_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
