-- 0160 — graine complémentaire : paramètres « payout_account_rails* » (US-707 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « payout_account_rails » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('payout_account_rails', 'JSON', 'payout_rails', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PAYOUT-01 (ACH au PA ; SIPAP et portefeuilles au PY) ; 16 PYO-001 ; ADR-180', 'PROPOSÉ ; formats et établissements à confirmer avec le PSP (lot C) ; absent ⇒ aucun compte enregistrable');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('payout_account_rails', 'PA', 'COUNTRY', NULL, NULL, '{"BANK_ACCOUNT":{"accountPattern":"^[0-9]{6,20}$","institutionPattern":"^[0-9]{3,9}$"}}'::jsonb, 'graine US-707 : défauts PROPOSÉS (08 BR-PAYOUT-01 ; 16 PYO-001 ; ADR-180)'),
  ('payout_account_rails', 'PY', 'COUNTRY', NULL, NULL, '{"BANK_ACCOUNT":{"accountPattern":"^[0-9]{6,20}$","institutionPattern":"^[0-9]{3,9}$"},"WALLET":{"accountPattern":"^09[0-9]{8}$","institutions":["TIGO_MONEY","BILLETERA_PERSONAL"]}}'::jsonb, 'graine US-707 : défauts PROPOSÉS (08 BR-PAYOUT-01 ; 16 PYO-001 ; ADR-180)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'payout\_account\_rails%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre payout_account_rails* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
