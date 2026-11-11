-- 0067 — graine complémentaire : paramètres « listing_min_photos* » (US-115 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « listing_min_photos » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('listing_min_photos', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-LIST-05 (au moins 6 photos, {param}) ; 16 HST-012 (PHOTO_MIN_COUNT à la soumission)', 'PROPOSÉ');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('listing_min_photos', 'PA', 'COUNTRY', NULL, NULL, '6'::jsonb, 'graine US-115 : défauts PROPOSÉS (08 BR-LIST-05, 16 HST-012)'),
  ('listing_min_photos', 'PY', 'COUNTRY', NULL, NULL, '6'::jsonb, 'graine US-115 : défauts PROPOSÉS (08 BR-LIST-05, 16 HST-012)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'listing\_min\_photos%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre listing_min_photos* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
