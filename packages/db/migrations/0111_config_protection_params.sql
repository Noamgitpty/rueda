-- 0111 — graine complémentaire : paramètres « protection_* » (US-226 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « protection_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('protection_grid', 'JSON', 'protection_grid', ARRAY['COUNTRY']::text[], true, 'BLOCK', false, false, '{}'::text[], NULL, '16 PRC-018, PRT-001, PRT-002, BKG-003 ; 08 BR-PRICE-11, BR-PROT-02 ; OQ-P2P-12 ; US-226 (ADR-136) : par niveau, rang, prix = part du prix journalier net, âge minimal du conducteur, plancher et plafond par jour ; absent : aucune réservation (protection obligatoire)', 'valeurs de test (16 PRC-018 « taux de test de 40 % », trip A de 08 : protection 25 % du loyer ; Total interdit aux moins de 21 ans, référence de PRT-002) ; grille à fixer avec l''assureur partenaire');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('protection_grid', 'PA', 'COUNTRY', NULL, NULL, '{"BASICA":{"dailyCeilingMinor":null,"dailyFloorMinor":null,"minDriverAge":null,"price":"1/4","rank":1},"ESTANDAR":{"dailyCeilingMinor":null,"dailyFloorMinor":null,"minDriverAge":null,"price":"2/5","rank":2},"TOTAL":{"dailyCeilingMinor":null,"dailyFloorMinor":null,"minDriverAge":21,"price":"13/20","rank":3}}'::jsonb, 'graine US-226 : défauts PROPOSÉS (16 PRC-018, PRT-001, PRT-002 ; 08 BR-PRICE-11, E7 ; ADR-136)'),
  ('protection_grid', 'PY', 'COUNTRY', NULL, NULL, '{"BASICA":{"dailyCeilingMinor":null,"dailyFloorMinor":null,"minDriverAge":null,"price":"1/4","rank":1},"ESTANDAR":{"dailyCeilingMinor":null,"dailyFloorMinor":null,"minDriverAge":null,"price":"2/5","rank":2},"TOTAL":{"dailyCeilingMinor":null,"dailyFloorMinor":null,"minDriverAge":21,"price":"13/20","rank":3}}'::jsonb, 'graine US-226 : défauts PROPOSÉS (16 PRC-018, PRT-001, PRT-002 ; 08 BR-PRICE-11, E7 ; ADR-136)');

-- Premières valeurs de clés définies dans 0009 (insurer_premium_share, insurer_roadside_share) : 0009 reste rendue
-- sans elles (ADR-044, ADR-136).
INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('insurer_premium_share', 'PA', 'COUNTRY', NULL, NULL, '{"BASICA":"7/10","ESTANDAR":"7/10","TOTAL":"7/10"}'::jsonb, 'graine US-226 : valeurs de test (16 PRC-018, PRT-001, PRT-002 ; 08 BR-PRICE-11, E7 ; ADR-136)'),
  ('insurer_premium_share', 'PY', 'COUNTRY', NULL, NULL, '{"BASICA":"7/10","ESTANDAR":"7/10","TOTAL":"7/10"}'::jsonb, 'graine US-226 : valeurs de test (16 PRC-018, PRT-001, PRT-002 ; 08 BR-PRICE-11, E7 ; ADR-136)'),
  ('insurer_roadside_share', 'PA', 'COUNTRY', NULL, NULL, '"1/2"'::jsonb, 'graine US-226 : valeurs de test (16 PRC-018, PRT-001, PRT-002 ; 08 BR-PRICE-11, E7 ; ADR-136)'),
  ('insurer_roadside_share', 'PY', 'COUNTRY', NULL, NULL, '"1/2"'::jsonb, 'graine US-226 : valeurs de test (16 PRC-018, PRT-001, PRT-002 ; 08 BR-PRICE-11, E7 ; ADR-136)');

-- Fail-closed : chacune de ces clés a une valeur dans chaque pays déclaré.
DO $check_keys$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(ARRAY['insurer_premium_share', 'insurer_roadside_share']::text[]) AS k(key)
              CROSS JOIN core.config_country AS c
             WHERE NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = k.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : valeur de test absente pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check_keys$;

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'protection\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre protection_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
