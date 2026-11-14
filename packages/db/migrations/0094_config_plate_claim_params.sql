-- 0094 — graine complémentaire : paramètres « plate_claims_* » (US-122 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « plate_claims_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('plate_claims_open_per_host', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, 'BOARD N-61 (contestation de plaque ou de VIN) ; red team du lot 1, F-L1-V-01 : plafond de contestations ouvertes par compte d''hôte (absent : refus CLAIM_LIMIT_REACHED)', 'PROPOSÉ');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('plate_claims_open_per_host', 'PA', 'COUNTRY', NULL, NULL, '5'::jsonb, 'graine US-122 : défauts PROPOSÉS (BOARD N-61, red team F-L1-V-01, ADR-122)'),
  ('plate_claims_open_per_host', 'PY', 'COUNTRY', NULL, NULL, '5'::jsonb, 'graine US-122 : défauts PROPOSÉS (BOARD N-61, red team F-L1-V-01, ADR-122)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'plate\_claims\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre plate_claims_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
