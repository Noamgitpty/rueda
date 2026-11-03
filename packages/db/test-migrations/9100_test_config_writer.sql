-- 9100 — droits d'écriture de TEST sur la configuration pays (US-013).
--
-- JAMAIS appliquée hors tests (comme 9000) : seule la base jetable principale `rueda_test_*` la
-- reçoit ; la base de contrôle `rueda_test_*_prod` (migrations de production seules) prouve que
-- les rôles applicatifs n'y écrivent pas (test test/int/config-country.test.ts).
--
-- Pourquoi : en production, aucune écriture applicative de la configuration n'existe en Bêta
-- (graines par migration sous migrator ; écran au lot 5 ; interrupteurs par les commandes de
-- US-125). Pour éprouver les gardes (PARAM_RETROACTIVE, immuabilité, cohérence, interrupteurs)
-- **sous un rôle de production** (CLAUDE.md point 6) et non sous migrator, app_worker reçoit ici,
-- en test seulement, l'écriture de deux tables versionnées et la modification de quatre
-- tables de référence (pour éprouver leur garde d'immuabilité). Les gardes sont des triggers qui s'appliquent à
-- tous les rôles : ce droit de test ne les contourne pas.
--
-- Retour arrière :
--   DROP POLICY test_worker_write ON core.config_param_value;
--   DROP POLICY test_worker_write ON core.pricing_tax_line_config;
--   REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.config_param_value, core.pricing_tax_line_config FROM app_worker;

GRANT INSERT, UPDATE, DELETE, TRUNCATE ON core.config_param_value, core.pricing_tax_line_config TO app_worker;
CREATE POLICY test_worker_write ON core.config_param_value
  FOR ALL TO app_worker USING (true) WITH CHECK (true);
CREATE POLICY test_worker_write ON core.pricing_tax_line_config
  FOR ALL TO app_worker USING (true) WITH CHECK (true);

-- Tables de référence sans version : modification, suppression et TRUNCATE seulement, pour
-- prouver la garde d'immuabilité (aucun INSERT).
-- Retour arrière : REVOKE UPDATE, DELETE, TRUNCATE sur ces quatre tables ; DROP POLICY test_worker_write.
GRANT UPDATE, DELETE, TRUNCATE
  ON core.config_currency, core.config_country, core.config_param_definition, core.finance_legal_entity
  TO app_worker;
CREATE POLICY test_worker_write ON core.config_currency
  FOR ALL TO app_worker USING (true) WITH CHECK (true);
CREATE POLICY test_worker_write ON core.config_country
  FOR ALL TO app_worker USING (true) WITH CHECK (true);
CREATE POLICY test_worker_write ON core.config_param_definition
  FOR ALL TO app_worker USING (true) WITH CHECK (true);
CREATE POLICY test_worker_write ON core.finance_legal_entity
  FOR ALL TO app_worker USING (true) WITH CHECK (true);
