-- 0089 — graine complémentaire : paramètres « privacy_* » (US-111 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « privacy_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('privacy_dsr_response_days', 'DURATION', 'd', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '19 US-111 ; 16 LEG-010 ; 17 §3.2.13 data_subject_request.due_at (délai légal à confirmer) ; défaut prudent en jours civils, plus court qu''un délai en jours ouvrés', 'PROPOSÉ ; OQ-MK-09 (Ley 81, Ley 7593)'),
  ('privacy_register_validated', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'FALSE', false, false, '{}'::text[], NULL, '19 US-111 ; 16 LEG-010 (registre validé par l''avocat avant la première collecte réelle ; sinon KYC_PRODUCTION_BLOCKED_NO_REGISTER)', 'PROPOSÉ, fail-closed ; OQ-MK-09'),
  ('privacy_vehicle_attestation_retention_months', 'DURATION', 'month', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '19 US-111 ; 08 BR-LIST-04 (engagements horodatés de l''hôte, catalog_vehicle_attestation, US-124) : durée comptée depuis la fin du dernier trip du véhicule ; lignes en ajout seul, sans donnée C2 ni C3', 'PROPOSÉ ; OQ-BR-25');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('privacy_dsr_response_days', 'PA', 'COUNTRY', NULL, NULL, '10'::jsonb, 'graine US-111 : défauts PROPOSÉS (19 US-111, 16 LEG-009 / LEG-010, OQ-BR-25, OQ-MK-09)'),
  ('privacy_dsr_response_days', 'PY', 'COUNTRY', NULL, NULL, '10'::jsonb, 'graine US-111 : défauts PROPOSÉS (19 US-111, 16 LEG-009 / LEG-010, OQ-BR-25, OQ-MK-09)'),
  ('privacy_register_validated', 'PA', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-111 : défauts PROPOSÉS (19 US-111, 16 LEG-009 / LEG-010, OQ-BR-25, OQ-MK-09)'),
  ('privacy_register_validated', 'PY', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-111 : défauts PROPOSÉS (19 US-111, 16 LEG-009 / LEG-010, OQ-BR-25, OQ-MK-09)'),
  ('privacy_vehicle_attestation_retention_months', 'PA', 'COUNTRY', NULL, NULL, '60'::jsonb, 'graine US-111 : défauts PROPOSÉS (19 US-111, 16 LEG-009 / LEG-010, OQ-BR-25, OQ-MK-09)'),
  ('privacy_vehicle_attestation_retention_months', 'PY', 'COUNTRY', NULL, NULL, '60'::jsonb, 'graine US-111 : défauts PROPOSÉS (19 US-111, 16 LEG-009 / LEG-010, OQ-BR-25, OQ-MK-09)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'privacy\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre privacy_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
