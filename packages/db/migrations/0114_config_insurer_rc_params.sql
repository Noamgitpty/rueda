-- 0114 — graine complémentaire : paramètres « insurer_rc_* » (US-205 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « insurer_rc_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('insurer_rc_minimum', 'MONEY', NULL, ARRAY['COUNTRY']::text[], true, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PROT-04 (« RC primaire ... montant {param} >= 100 000 USD par événement ») ; 16 PRT-003 / PRT-013 (« contrat sous le minimum légal paramétré => contrat non activable ») ; 19 US-205 critère 3 (POLICY_RC_BELOW_MINIMUM) ; absent : aucune RC promise, conditions du contrat refusées', 'PROPOSÉ (OQ-BR-16 : montant minimum par événement à confirmer par l''avocat et l''assureur ; PY : équivalent en PYG de la recommandation de 08, valeur de test)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('insurer_rc_minimum', 'PA', 'COUNTRY', NULL, NULL, '"10000000"'::jsonb, 'graine US-205 : défauts PROPOSÉS (08 BR-PROT-04 ; 16 PRT-003 / PRT-013 ; OQ-BR-16 ; ADR-138)'),
  ('insurer_rc_minimum', 'PY', 'COUNTRY', NULL, NULL, '"750000000"'::jsonb, 'graine US-205 : défauts PROPOSÉS (08 BR-PROT-04 ; 16 PRT-003 / PRT-013 ; OQ-BR-16 ; ADR-138)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'insurer\_rc\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre insurer_rc_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
