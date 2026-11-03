-- 9800 — fixtures de la conversion gardée (US-024). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` ; la base `rueda_test_*_prod` garde la définition de
-- production de core.booking_hold_payment_terms (aucun devis : T1 refuse, QUOTE_UNAVAILABLE).
--
--   1. Registre des conditions de paiement de TEST (test_fixture.us024_hold_terms) et
--      remplacement de core.booking_hold_payment_terms, qui tient lieu du devis accepté (PRC) :
--      montant, devise et jambes de capture d'un vecteur TJ de 08 (posés par le test), période
--      commerciale et fuseau du créneau. SECURITY DEFINER sous migrator, comme les autres
--      fixtures : cmd_hold_owner et app_worker l'exécutent sans droit sur test_fixture.
--   2. Compte marchand FAKE SANDBOX ACTIF du pays (créé au besoin, sinon celui qui existe :
--      un seul compte ACTIVE par fournisseur, pays et environnement).
--   3. Capacité PSP versionnée (valid_from) : chaque test l'ouvre et la referme dans sa propre
--      période d'horloge virtuelle.
--   4. Opération de loyer supplémentaire du hold, aux conditions du devis (ordre réutilisable payé
--      deux fois, paiement vu par le rapprochement seulement, autorisation) et statut forcé (statut
--      corrigé par l'ops après getOperation, 17 §4.4 point 7 « CONFLICT »).
--   5. Approbation d'une revue (travailleur de revue, ADM-029, non construit) : reviewed_at et
--      prolongation unique de l'échéance.
--
-- Retour arrière : DROP FUNCTION test_fixture.us024_set_terms(uuid, bigint, text, jsonb,
--   timestamptz, timestamptz, text), test_fixture.us024_psp_account(text),
--   test_fixture.us024_set_capability(text, text, text, text, jsonb, text, timestamptz),
--   test_fixture.us024_extra_operation(uuid, uuid, text, integer, text),
--   test_fixture.us024_force_operation_status(uuid, text),
--   test_fixture.us024_approve_review(uuid, integer), test_fixture.us024_psp_account_of(text, text,
--   text), test_fixture.us024_force_payment_attempts(uuid, integer) ; DROP TABLE test_fixture.us024_hold_terms ;
--   réappliquer la définition de 0040 de core.booking_hold_payment_terms.

CREATE TABLE test_fixture.us024_hold_terms (
  hold_id         uuid PRIMARY KEY,
  amount_minor    bigint NOT NULL,
  currency        text NOT NULL,
  legs            jsonb NOT NULL,
  scheduled_start timestamptz NOT NULL,
  scheduled_end   timestamptz NOT NULL,
  timezone        text NOT NULL
);
REVOKE ALL ON test_fixture.us024_hold_terms FROM PUBLIC;

CREATE FUNCTION test_fixture.us024_set_terms(
  p_hold_id         uuid,
  p_amount_minor    bigint,
  p_currency        text,
  p_legs            jsonb,
  p_scheduled_start timestamptz,
  p_scheduled_end   timestamptz,
  p_timezone        text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO test_fixture.us024_hold_terms
         (hold_id, amount_minor, currency, legs, scheduled_start, scheduled_end, timezone)
  VALUES (p_hold_id, p_amount_minor, p_currency, p_legs, p_scheduled_start, p_scheduled_end,
          p_timezone)
  ON CONFLICT (hold_id) DO UPDATE
     SET amount_minor = EXCLUDED.amount_minor, currency = EXCLUDED.currency,
         legs = EXCLUDED.legs, scheduled_start = EXCLUDED.scheduled_start,
         scheduled_end = EXCLUDED.scheduled_end, timezone = EXCLUDED.timezone;
END
$fn$;

CREATE OR REPLACE FUNCTION core.booking_hold_payment_terms(p_hold_id uuid)
  RETURNS TABLE (amount_minor    bigint,
                 currency        text,
                 legs            jsonb,
                 scheduled_start timestamptz,
                 scheduled_end   timestamptz,
                 timezone        text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.amount_minor, t.currency, t.legs, t.scheduled_start, t.scheduled_end, t.timezone
    FROM test_fixture.us024_hold_terms t
   WHERE t.hold_id = p_hold_id
$fn$;

COMMENT ON FUNCTION core.booking_hold_payment_terms(uuid) IS
  'VERSION DE TEST (test-migrations/9800) : registre des conditions de paiement de test.';

CREATE FUNCTION test_fixture.us024_psp_account(p_country_code text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  SELECT a.id INTO v_id
    FROM core.payment_psp_account a
   WHERE a.provider = 'FAKE' AND a.country_code = p_country_code AND a.environment = 'SANDBOX'
     AND a.status = 'ACTIVE';
  IF v_id IS NULL THEN
    v_id := pg_catalog.gen_random_uuid();
    INSERT INTO core.payment_psp_account
           (id, provider, country_code, environment, status, public_webhook_id, webhook_secret_ref,
            credentials_ref)
    VALUES (v_id, 'FAKE', p_country_code, 'SANDBOX', 'ACTIVE',
            'us024-' || pg_catalog.replace(v_id::text, '-', ''), 'vault:psp/test/webhook',
            'vault:psp/test/api');
  END IF;
  RETURN v_id;
END
$fn$;

CREATE FUNCTION test_fixture.us024_set_capability(
  p_provider     text,
  p_country_code text,
  p_method       text,
  p_capability   text,
  p_value        jsonb,
  p_status       text,
  p_valid_from   timestamptz
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO core.payment_psp_capability
         (provider, country_code, method, network, capability, value, status, source,
          validated_at, valid_from)
  VALUES (p_provider, p_country_code, p_method, '*', p_capability, p_value, p_status,
          'test US-024 (FAKE)',
          CASE WHEN p_status IN ('VALIDATED_SANDBOX', 'VALIDATED_CONTRACT') THEN p_valid_from END,
          p_valid_from);
END
$fn$;

-- Opération de loyer supplémentaire du hold, aux montants et jambes du devis de test.
CREATE FUNCTION test_fixture.us024_extra_operation(
  p_operation_id uuid,
  p_hold_id      uuid,
  p_kind         text,
  p_attempt_no   integer,
  p_status       text
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  h record;
  t record;
BEGIN
  SELECT ch.org_id, ch.country_code INTO h FROM core.booking_checkout_hold ch WHERE ch.id = p_hold_id;
  SELECT x.amount_minor, x.currency, x.legs INTO t
    FROM test_fixture.us024_hold_terms x WHERE x.hold_id = p_hold_id;
  INSERT INTO core.payment_payment_operation
         (id, hold_id, psp_account_id, country_code, provider, method, kind, purpose, amount_minor,
          currency, attempt_no, status, idem_plain, idem_sent, provider_reference)
  VALUES (p_operation_id, p_hold_id, test_fixture.us024_psp_account(h.country_code), h.country_code,
          'FAKE', 'CARD', p_kind, 'RENT', t.amount_minor, t.currency, p_attempt_no, p_status,
          pg_catalog.format('hold:%s:%s:x%s', p_hold_id, p_kind, p_operation_id),
          pg_catalog.format('hold:%s:%s:x%s', p_hold_id, p_kind, p_operation_id),
          'fake-x-' || p_operation_id::text);
  INSERT INTO core.payment_payment_operation_leg (operation_id, leg, org_id, trip_id, country_code,
                                                  amount_minor)
  SELECT p_operation_id, k, h.org_id, NULL, h.country_code, (t.legs ->> k)::bigint
    FROM pg_catalog.jsonb_object_keys(t.legs) AS k;
END
$fn$;

CREATE FUNCTION test_fixture.us024_force_operation_status(p_operation_id uuid, p_status text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE core.payment_payment_operation SET status = p_status WHERE id = p_operation_id;
END
$fn$;

-- Approbation d'une revue (17 §2.5 « Revue ops avant le débit ») : reviewed_at = platform.now(),
-- échéance prolongée une fois à reviewed_at + p_ttl_minutes (exception de hold_guarded_columns).
CREATE FUNCTION test_fixture.us024_approve_review(p_hold_id uuid, p_ttl_minutes integer)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  n integer;
BEGIN
  UPDATE core.booking_checkout_hold
     SET reviewed_at = platform.now(),
         expires_at = platform.now() + pg_catalog.make_interval(mins => p_ttl_minutes)
   WHERE id = p_hold_id AND review_required AND reviewed_at IS NULL AND status = 'ACTIVE';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'us024_approve_review: hold % not under review', p_hold_id;
  END IF;
END
$fn$;

-- Compte PSP ACTIF d'un fournisseur et d'un environnement donnés (garde d'environnement de T1).
CREATE FUNCTION test_fixture.us024_psp_account_of(p_provider text, p_country_code text,
                                                  p_environment text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid;
BEGIN
  SELECT a.id INTO v_id
    FROM core.payment_psp_account a
   WHERE a.provider = p_provider AND a.country_code = p_country_code
     AND a.environment = p_environment AND a.status = 'ACTIVE';
  IF v_id IS NULL THEN
    v_id := pg_catalog.gen_random_uuid();
    INSERT INTO core.payment_psp_account
           (id, provider, country_code, environment, status, public_webhook_id, webhook_secret_ref,
            credentials_ref, gate_decision_ref)
    VALUES (v_id, p_provider, p_country_code, p_environment, 'ACTIVE',
            'us024-' || pg_catalog.replace(v_id::text, '-', ''), 'vault:psp/test/webhook',
            'vault:psp/test/api', CASE WHEN p_environment = 'LIVE' THEN 'test US-024' END);
  END IF;
  RETURN v_id;
END
$fn$;

-- Compteur de refus forcé : seul chemin vers le refus défensif PAYMENT_ATTEMPTS_EXCEEDED de T1
-- (le 3e refus reçu libère déjà le hold).
CREATE FUNCTION test_fixture.us024_force_payment_attempts(p_hold_id uuid, p_attempts integer)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  UPDATE core.booking_checkout_hold SET payment_attempts = p_attempts WHERE id = p_hold_id;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us024_psp_account_of(text, text, text),
  test_fixture.us024_force_payment_attempts(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us024_psp_account_of(text, text, text),
  test_fixture.us024_force_payment_attempts(uuid, integer) TO app_api, app_worker;

REVOKE ALL ON FUNCTION
  test_fixture.us024_set_terms(uuid, bigint, text, jsonb, timestamptz, timestamptz, text),
  test_fixture.us024_psp_account(text),
  test_fixture.us024_set_capability(text, text, text, text, jsonb, text, timestamptz),
  test_fixture.us024_extra_operation(uuid, uuid, text, integer, text),
  test_fixture.us024_force_operation_status(uuid, text),
  test_fixture.us024_approve_review(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  test_fixture.us024_set_terms(uuid, bigint, text, jsonb, timestamptz, timestamptz, text),
  test_fixture.us024_psp_account(text),
  test_fixture.us024_set_capability(text, text, text, text, jsonb, text, timestamptz),
  test_fixture.us024_extra_operation(uuid, uuid, text, integer, text),
  test_fixture.us024_force_operation_status(uuid, text),
  test_fixture.us024_approve_review(uuid, integer) TO app_api, app_worker;
