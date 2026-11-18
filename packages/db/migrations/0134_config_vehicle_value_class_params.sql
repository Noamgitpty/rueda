-- 0134 — graine complémentaire : paramètres « vehicle_default_value_class* » (US-113 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « vehicle_default_value_class » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('vehicle_default_value_class', 'ENUM', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], ARRAY['STANDARD', 'PREMIUM', 'LUXE']::text[], '08 BR-ACC-05 (classes STANDARD / PREMIUM / LUXE, seuils de valeur PROPOSÉS) ; BOARD N-83 : classe d''un véhicule dont ni la variante du catalogue ni une règle de marque ou de modèle ne donne la classe (douane, hors catalogue), attribuée à la publication ; absent : aucune classe, le véhicule n''est jamais couvert (fail-closed)', 'PROPOSÉ (N-83, ADR-159 : STANDARD, comme Turo où la classe suit la valeur et où la plupart des véhicules sont standard ; les marques et modèles de valeur haute sont relevés par les règles de classement, jamais par ce défaut ; valeur définitive à confirmer avec l''assureur partenaire)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('vehicle_default_value_class', 'PA', 'COUNTRY', NULL, NULL, '"STANDARD"'::jsonb, 'graine US-113 : défauts PROPOSÉS (08 BR-ACC-05 ; BOARD N-83 ; ADR-159)'),
  ('vehicle_default_value_class', 'PY', 'COUNTRY', NULL, NULL, '"STANDARD"'::jsonb, 'graine US-113 : défauts PROPOSÉS (08 BR-ACC-05 ; BOARD N-83 ; ADR-159)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'vehicle\_default\_value\_class%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre vehicle_default_value_class* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
