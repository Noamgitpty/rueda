-- 0113 — graine complémentaire : paramètres « foreign_license_* » (US-209 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « foreign_license_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('foreign_license_review_enabled', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '16 VER-007, ADM-029 ; 22 OQ-BR-21 ; DEC-FONDATEUR-22 « jamais plus lourd que Turo » : revue avant le débit d''un voyageur à permis étranger (entrée non déclarée, résident, fin après entrée + 90 jours), seulement si le pays l''exige (absent : revue)', 'PROPOSÉ (comme Turo : aucune revue sur le seul permis étranger ; à activer par pays si l''avis juridique d''OQ-BR-21 confirme la règle des 90 jours)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('foreign_license_review_enabled', 'PA', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-209 : défauts PROPOSÉS (16 VER-007 ; OQ-BR-21 ; DEC-FONDATEUR-22 ; ADR-135)'),
  ('foreign_license_review_enabled', 'PY', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-209 : défauts PROPOSÉS (16 VER-007 ; OQ-BR-21 ; DEC-FONDATEUR-22 ; ADR-135)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'foreign\_license\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre foreign_license_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
