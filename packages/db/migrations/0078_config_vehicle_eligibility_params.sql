-- 0078 — graine complémentaire : paramètres « elig_* » (US-124 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « elig_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('elig_age_years_ceiling', 'INT', 'year', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-LIST-02 [NOUS] (≤ 10 ans) ; 16 HST-019 (VEHICLE_TOO_OLD)', 'PROPOSÉ (défaut à confirmer par le fondateur)'),
  ('elig_doc_compulsory_insurance', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '16 HST-039 (assurance obligatoire minimale SOBAT au Panama ; au Paraguay, déclaration d’une police personnelle)', 'PROPOSÉ (défaut à confirmer par le fondateur)'),
  ('elig_doc_inspection', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '16 HST-039 (revisado PA, inspección técnica PY) ; 08 BR-LIST-02 [NOUS]', 'PROPOSÉ (défaut à confirmer par le fondateur)'),
  ('elig_doc_plate_vin_photo', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '16 HST-039 (photo de la plaque et du VIN) ; 16 HST-019', 'PROPOSÉ (défaut à confirmer par le fondateur)'),
  ('elig_doc_title', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '16 HST-039 (titre ou registro : registro único vehicular PA, cédula verde PY) ; 08 BR-LIST-01', 'PROPOSÉ (défaut à confirmer par le fondateur)'),
  ('elig_odometer_km_ceiling', 'INT', 'km', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-LIST-02 [NOUS] (< 200 000 km) ; 16 HST-019 (VEHICLE_MILEAGE_TOO_HIGH)', 'PROPOSÉ (défaut à confirmer par le fondateur)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('elig_age_years_ceiling', 'PA', 'COUNTRY', NULL, NULL, '10'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_age_years_ceiling', 'PY', 'COUNTRY', NULL, NULL, '10'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_doc_compulsory_insurance', 'PA', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_doc_compulsory_insurance', 'PY', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_doc_inspection', 'PA', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_doc_inspection', 'PY', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_doc_plate_vin_photo', 'PA', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_doc_plate_vin_photo', 'PY', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_doc_title', 'PA', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_doc_title', 'PY', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_odometer_km_ceiling', 'PA', 'COUNTRY', NULL, NULL, '200000'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)'),
  ('elig_odometer_km_ceiling', 'PY', 'COUNTRY', NULL, NULL, '200000'::jsonb, 'graine US-124 : défauts PROPOSÉS (08 BR-LIST-01, BR-LIST-02, 16 HST-019, HST-039)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'elig\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre elig_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
