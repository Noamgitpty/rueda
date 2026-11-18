-- 0139 — graine complémentaire : paramètres « deposit_always_required* » (US-225 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « deposit_always_required » ou vaut deposit_fee_notice_h, deposit_on_risk_flag, deposit_reauth_lead_h, deposit_trigger_classes, deposit_young_driver_age, deposit_young_driver_classes, risk_control_deployed ;
-- jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('deposit_always_required', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PAY-06 (déclencheur COUNTRY : caution imposée à tout trip du pays) ; 17 §7.2 ; ADR-108 ; absent ou illisible : déclencheur vrai, caution exigée (fail-closed)', 'PROPOSÉ comme Turo (ADR-108) : aucune caution par défaut'),
  ('deposit_fee_notice_h', 'DURATION', 'h', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PAY-06 « Libération à heure fixe » : un frais annexe n’est capturé sur la caution que s’il a été notifié au voyageur au moins 48 h avant la décision (délai BR-REIMB-03) ; sinon débit MIT séparé', 'PROPOSÉ (08 BR-PAY-06, BR-REIMB-03)'),
  ('deposit_on_risk_flag', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PAY-06 (déclencheur RISK : trip signalé par le contrôle de risque, BR-VERIF-09, ADM-029) ; 17 §7.2 ; absent : déclencheur vrai (fail-closed)', 'PROPOSÉ comme Turo (vrai) ; sans effet tant que risk_control_deployed est faux'),
  ('deposit_reauth_lead_h', 'DURATION', 'h', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PAY-06 « Mécanisme » rail (a) : ré-autorisation planifiée à auth_expiry − 24 h', 'PROPOSÉ (08 BR-PAY-06 ; la capacité SUPPORTS_REAUTH reste à valider avec le PSP)'),
  ('deposit_trigger_classes', 'JSON', 'value_class_set', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PAY-06 (déclencheur CLASS : classe de valeur du véhicule, ADR-159) ; 17 §7.2 ; ADR-108 ; absent : toutes les classes déclenchent (fail-closed)', 'PROPOSÉ comme Turo ({LUXE}, équivalent Super Deluxe) ; à confirmer par le fondateur avant la mise en ligne'),
  ('deposit_young_driver_age', 'INT', 'years', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PAY-06 (déclencheur AGE, seuil strict, plus jeune conducteur approuvé) ; 17 §7.2 ; ADR-108 ; absent : tout âge déclenche (fail-closed)', 'PROPOSÉ comme Turo (30 ans) ; sans effet tant que deposit_young_driver_classes est vide'),
  ('deposit_young_driver_classes', 'JSON', 'value_class_set', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PAY-06 (déclencheur AGE : classes du catalogue concernées) ; 17 §7.2 ; absent : toutes les classes (fail-closed)', 'décidé (DEC-FONDATEUR-21, 2026-11-12) : ensemble vide, aucune caution liée à l’âge au PA et au PY'),
  ('risk_control_deployed', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PAY-06 (« contrôle non déployé ≠ en panne », risk_control_deployed) ; ADR-108 point 3 bis ; faux : RISK non évalué (risk_evaluated = false) ; absent : contrôle tenu pour déployé, une panne rend RISK vrai (fail-closed)', 'PROPOSÉ (faux tant que la caution sur signal de risque n’est pas branchée au contrôle de risque de US-209 ; changé seulement par l’administration avec journal)');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('deposit_always_required', 'PA', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_always_required', 'PY', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_fee_notice_h', 'PA', 'COUNTRY', NULL, NULL, '48'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_fee_notice_h', 'PY', 'COUNTRY', NULL, NULL, '48'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_on_risk_flag', 'PA', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_on_risk_flag', 'PY', 'COUNTRY', NULL, NULL, 'true'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_reauth_lead_h', 'PA', 'COUNTRY', NULL, NULL, '24'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_reauth_lead_h', 'PY', 'COUNTRY', NULL, NULL, '24'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_trigger_classes', 'PA', 'COUNTRY', NULL, NULL, '["LUXE"]'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_trigger_classes', 'PY', 'COUNTRY', NULL, NULL, '["LUXE"]'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_young_driver_age', 'PA', 'COUNTRY', NULL, NULL, '30'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_young_driver_age', 'PY', 'COUNTRY', NULL, NULL, '30'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_young_driver_classes', 'PA', 'COUNTRY', NULL, NULL, '[]'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('deposit_young_driver_classes', 'PY', 'COUNTRY', NULL, NULL, '[]'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('risk_control_deployed', 'PA', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)'),
  ('risk_control_deployed', 'PY', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-225 : défauts PROPOSÉS (08 BR-PAY-06 ; 17 §7.2 ; ADR-108 ; ADR-164)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE (d.key LIKE 'deposit\_always\_required%' OR d.key = ANY (ARRAY['deposit_fee_notice_h', 'deposit_on_risk_flag', 'deposit_reauth_lead_h', 'deposit_trigger_classes', 'deposit_young_driver_age', 'deposit_young_driver_classes', 'risk_control_deployed']::text[]))
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre deposit_always_required* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
