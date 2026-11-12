-- 0069 — graine complémentaire : paramètres « price_ceiling_* » (US-115 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « price_ceiling_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('price_ceiling_daily_minor', 'MONEY', NULL, ARRAY['COUNTRY']::text[], true, 'BLOCK', false, false, '{}'::text[], NULL, '16 PRC-001 (plafond de cohérence du prix journalier, PRICE_INVALID au-delà)', 'PROPOSÉ (défaut à confirmer par le fondateur)'),
  ('price_ceiling_extra_km_minor', 'MONEY', NULL, ARRAY['COUNTRY']::text[], true, 'BLOCK', false, false, '{}'::text[], NULL, '16 PRC-001, HST-033 (plafond de cohérence du prix du km supplémentaire)', 'PROPOSÉ (défaut à confirmer par le fondateur)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('price_ceiling_daily_minor', 'PA', 'COUNTRY', NULL, NULL, '"500000"'::jsonb, 'graine US-115 : défauts PROPOSÉS (16 PRC-001, HST-033)'),
  ('price_ceiling_daily_minor', 'PY', 'COUNTRY', NULL, NULL, '"35000000"'::jsonb, 'graine US-115 : défauts PROPOSÉS (16 PRC-001, HST-033)'),
  ('price_ceiling_extra_km_minor', 'PA', 'COUNTRY', NULL, NULL, '"1000"'::jsonb, 'graine US-115 : défauts PROPOSÉS (16 PRC-001, HST-033)'),
  ('price_ceiling_extra_km_minor', 'PY', 'COUNTRY', NULL, NULL, '"75000"'::jsonb, 'graine US-115 : défauts PROPOSÉS (16 PRC-001, HST-033)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'price\_ceiling\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre price_ceiling_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
