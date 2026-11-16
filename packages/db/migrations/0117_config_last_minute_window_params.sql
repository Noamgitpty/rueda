-- 0117 — graine complémentaire : paramètres « last_minute_free_window* » (US-205 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « last_minute_free_window » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('last_minute_free_window_minutes', 'DURATION', 'min', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-CXL-01 (« freeUntil = lastMinute ? min(bookedAt + 60 min, trip.start) : trip.start − 24 h ») ; 16 LST-010 (« gratuite pendant 1 h après la réservation ») ; absent : aucune date d''annulation gratuite promise en dernière minute', 'PROPOSÉ (comme Turo : 1 h après la réservation ; égal à la fenêtre du moteur d''annulation cxl-beta/1, qui ne lit pas encore ce paramètre)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('last_minute_free_window_minutes', 'PA', 'COUNTRY', NULL, NULL, '60'::jsonb, 'graine US-205 : défauts PROPOSÉS (08 BR-CXL-01 ; 16 LST-010 ; ADR-140)'),
  ('last_minute_free_window_minutes', 'PY', 'COUNTRY', NULL, NULL, '60'::jsonb, 'graine US-205 : défauts PROPOSÉS (08 BR-CXL-01 ; 16 LST-010 ; ADR-140)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'last\_minute\_free\_window%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre last_minute_free_window* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
