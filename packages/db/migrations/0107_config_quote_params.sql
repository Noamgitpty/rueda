-- 0107 — graine complémentaire : paramètres « quote_* » (US-208 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « quote_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('quote_freezes_per_guest_hour', 'INT', 'count', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '17 §3.2.5 ; suivi N-130 (revue sécurité d''US-202, constat 9 a) : devis figés par un même voyageur sur une heure glissante, tous véhicules confondus ; absent : refus QUOTE_UNAVAILABLE', 'PROPOSÉ (comme Turo : débit d''un voyageur qui compare des dates, jamais atteint par un voyageur honnête)'),
  ('quote_validity_minutes', 'DURATION', 'min', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '16 PRC-025, BKG-001 (« devis plus ancien que sa durée de validité (PROPOSÉ 30 min) ⇒ QUOTE_EXPIRED ») ; 17 §3.2.5 quote.expires_at ; suivi N-129 ; absent : refus QUOTE_UNAVAILABLE', 'PROPOSÉ (16 PRC-025 : 30 min ; comme Turo : le prix affiché au checkout tient le temps de réserver)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('quote_freezes_per_guest_hour', 'PA', 'COUNTRY', NULL, NULL, '30'::jsonb, 'graine US-208 : défauts PROPOSÉS (16 PRC-025, BKG-001 ; BOARD N-129, N-130 ; ADR-133)'),
  ('quote_freezes_per_guest_hour', 'PY', 'COUNTRY', NULL, NULL, '30'::jsonb, 'graine US-208 : défauts PROPOSÉS (16 PRC-025, BKG-001 ; BOARD N-129, N-130 ; ADR-133)'),
  ('quote_validity_minutes', 'PA', 'COUNTRY', NULL, NULL, '30'::jsonb, 'graine US-208 : défauts PROPOSÉS (16 PRC-025, BKG-001 ; BOARD N-129, N-130 ; ADR-133)'),
  ('quote_validity_minutes', 'PY', 'COUNTRY', NULL, NULL, '30'::jsonb, 'graine US-208 : défauts PROPOSÉS (16 PRC-025, BKG-001 ; BOARD N-129, N-130 ; ADR-133)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'quote\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre quote_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
