-- 0091 — graine complémentaire : paramètres « security_incident_* » (US-112 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « security_incident_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('security_incident_authority_notice_hours', 'DURATION', 'h', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '19 US-112 ; 16 LEG-010, ADM-035 ; 17 §3.2.13 security_incident.authority_notification_due_at, §6.4 : délai de notification d''une violation de données à l''autorité, compté depuis la détection (security_incident.detected_at) ; valeur absente ⇒ échéance immédiate (fail-closed, ADR-121)', 'PROPOSÉ ; OQ-MK-09 (défaut 72 h, à confirmer par l’avocat PA et PY)'),
  ('security_incident_subjects_notice_hours', 'DURATION', 'h', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '19 US-112 ; 16 LEG-010 (notification aux personnes) ; 17 §3.2.13 security_incident.subjects_notified_at : délai de notification d''une violation aux personnes concernées, compté depuis la détection ; valeur absente ⇒ échéance immédiate (fail-closed, ADR-121)', 'PROPOSÉ ; OQ-MK-09 (même délai que l’autorité en attendant l’avis)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('security_incident_authority_notice_hours', 'PA', 'COUNTRY', NULL, NULL, '72'::jsonb, 'graine US-112 : défauts PROPOSÉS (19 US-112, 16 LEG-010 / ADM-035, OQ-MK-09)'),
  ('security_incident_authority_notice_hours', 'PY', 'COUNTRY', NULL, NULL, '72'::jsonb, 'graine US-112 : défauts PROPOSÉS (19 US-112, 16 LEG-010 / ADM-035, OQ-MK-09)'),
  ('security_incident_subjects_notice_hours', 'PA', 'COUNTRY', NULL, NULL, '72'::jsonb, 'graine US-112 : défauts PROPOSÉS (19 US-112, 16 LEG-010 / ADM-035, OQ-MK-09)'),
  ('security_incident_subjects_notice_hours', 'PY', 'COUNTRY', NULL, NULL, '72'::jsonb, 'graine US-112 : défauts PROPOSÉS (19 US-112, 16 LEG-010 / ADM-035, OQ-MK-09)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'security\_incident\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre security_incident_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
