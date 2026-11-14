-- 0082 — graine complémentaire : paramètres « host_review_* » (US-108 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « host_review_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('host_review_auto_delay_minutes', 'INT', 'min', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '19 US-108 ; 16 VER-028 (aucun oracle de la retenue de sanctions) ; ADR-105, ADR-111 (délai uniforme avant toute approbation automatique, comme le délai d''approbation annoncé par Turo)', 'PROPOSÉ'),
  ('host_review_manual_required', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '19 US-108 ; 16 ADM-004 ; consigne du fondateur du 2026-11-12 (vérification par exception, comme Turo)', 'PROPOSÉ');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('host_review_auto_delay_minutes', 'PA', 'COUNTRY', NULL, NULL, '1440'::jsonb, 'graine US-108 : défauts PROPOSÉS (19 US-108, 16 ADM-004, consigne du fondateur du 2026-11-12)'),
  ('host_review_auto_delay_minutes', 'PY', 'COUNTRY', NULL, NULL, '1440'::jsonb, 'graine US-108 : défauts PROPOSÉS (19 US-108, 16 ADM-004, consigne du fondateur du 2026-11-12)'),
  ('host_review_manual_required', 'PA', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-108 : défauts PROPOSÉS (19 US-108, 16 ADM-004, consigne du fondateur du 2026-11-12)'),
  ('host_review_manual_required', 'PY', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-108 : défauts PROPOSÉS (19 US-108, 16 ADM-004, consigne du fondateur du 2026-11-12)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'host\_review\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre host_review_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
