-- 9500 — environnement de déploiement et écrivain des comptes PSP, pour les TESTS (US-019).
--
-- JAMAIS appliquée hors tests (comme 9000) : seule la base jetable principale `rueda_test_*` la
-- reçoit ; la base de contrôle `rueda_test_*_prod` garde la définition de production de
-- platform.deployment_env() (« production »), vérifiée par test/l0/l0-pay-port.test.ts.
--
-- 1. platform.deployment_env() : « test » par défaut ; un test pose `app.test_deployment_env`
--    (SET LOCAL, dans sa transaction) pour éprouver les gardes de production (C19) SOUS UN RÔLE DE
--    PRODUCTION. Même principe que l'horloge virtuelle (9000) : la base de production ne lit
--    jamais ce paramètre.
-- 2. Écriture des comptes PSP et des capacités par app_worker (tests seulement) : en production,
--    aucune écriture applicative de la configuration PSP n'existe en Bêta (graines par migration
--    sous migrator ; porte PAY-041 au lot C). Les gardes (CHECK, trigger FAKE) s'appliquent à tous
--    les rôles : ce droit de test ne les contourne pas.
--
-- Retour arrière :
--   réappliquer la définition de 0028 (CREATE OR REPLACE FUNCTION platform.deployment_env()) ;
--   DROP POLICY test_worker_write ON core.payment_psp_account, core.payment_psp_capability ;
--   REVOKE INSERT, UPDATE ON core.payment_psp_account, core.payment_psp_capability FROM app_worker ;
--   REVOKE SELECT ON core.payment_psp_account FROM app_worker.

CREATE OR REPLACE FUNCTION platform.deployment_env()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(NULLIF(pg_catalog.current_setting('app.test_deployment_env', true), ''), 'test')
$fn$;

COMMENT ON FUNCTION platform.deployment_env() IS
  'VERSION DE TEST (test-migrations/9500) : app.test_deployment_env si posé, sinon test.';

GRANT SELECT, INSERT, UPDATE ON core.payment_psp_account, core.payment_psp_capability TO app_worker;
CREATE POLICY test_worker_write ON core.payment_psp_account
  FOR ALL TO app_worker USING (true) WITH CHECK (true);
CREATE POLICY test_worker_write ON core.payment_psp_capability
  FOR ALL TO app_worker USING (true) WITH CHECK (true);

-- 3. Écriture BRUTE d'une opération et de ses jambes, en contournant la commande
--    payment_cmd_record_operation (revues argent n° 3, qa n° 8 ; sécurité n° 6) : sert à éprouver
--    le contrôle différé payment_operation_legs_check au COMMIT, et à peupler les jambes lues par
--    les preuves RLS (titulaire, autre hôte, FINANCE, OPS par dossier, autre pays).
--    SECURITY DEFINER sous migrator (politique migrator_all) : la transaction appelante reste sous
--    un rôle de production, et le contrôle différé s'exécute à SON COMMIT.
--    p_legs : objet {jambe: montant en texte} quelconque (jambes manquantes ou en trop admises,
--    pour les refus) ; p_with_account = false : opération sans compte PSP (fixtures antérieures).
-- Retour arrière : DROP FUNCTION test_fixture.pay_insert_operation_raw(uuid, uuid, text, bigint, jsonb, boolean);
CREATE FUNCTION test_fixture.pay_insert_operation_raw(
  p_operation_id uuid,
  p_trip_id      uuid,
  p_kind         text,
  p_amount_minor bigint,
  p_legs         jsonb,
  p_with_account boolean
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_account uuid;
  v_country text;
  v_currency text;
  v_org uuid;
BEGIN
  SELECT t.country_code, t.currency, t.org_id INTO v_country, v_currency, v_org
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  IF p_with_account THEN
    v_account := pg_catalog.gen_random_uuid();
    INSERT INTO core.payment_psp_account (id, provider, country_code, environment, status, public_webhook_id)
    VALUES (v_account, 'FAKE', v_country, 'SANDBOX', 'PENDING_VALIDATION',
            pg_catalog.replace(v_account::text, '-', ''));
  END IF;
  INSERT INTO core.payment_payment_operation
         (id, trip_id, psp_account_id, country_code, provider, kind, purpose, amount_minor, currency,
          attempt_no, status, idem_plain, idem_sent)
  VALUES (p_operation_id, p_trip_id, v_account, v_country, 'FAKE', p_kind,
          CASE WHEN p_kind LIKE 'DEPOSIT%' THEN 'DEPOSIT' ELSE 'RENT' END, p_amount_minor, v_currency,
          1, 'PENDING', pg_catalog.format('raw:%s', p_operation_id), pg_catalog.format('raw:%s', p_operation_id));
  INSERT INTO core.payment_payment_operation_leg (operation_id, leg, org_id, trip_id, country_code, amount_minor)
  SELECT p_operation_id, l.key, v_org, p_trip_id, v_country, (l.value #>> '{}')::bigint
    FROM pg_catalog.jsonb_each(COALESCE(p_legs, '{}'::jsonb)) AS l;
END
$fn$;
REVOKE ALL ON FUNCTION test_fixture.pay_insert_operation_raw(uuid, uuid, text, bigint, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.pay_insert_operation_raw(uuid, uuid, text, bigint, jsonb, boolean)
  TO app_api, app_worker;
