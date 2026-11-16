-- 9967 — fixtures des preuves des contrôles bloquants et de la revue (US-209, migration 0112).
-- TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*`.
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique), appelée
-- SEULEMENT dans des transactions de test ANNULÉES, sauf `us209_restrict` (personne de fixture
-- d'un test de conversion, données sans interrupteur) :
--   1. `us209_driver` : dossier d'identité d'une personne tel que la décision du fournisseur
--      l'écrit (US-105 / US-106) : vérification APPROVED courante, date de naissance du sujet,
--      permis ACCEPTED (pays de délivrance, échéance) et consentement biométrique en vigueur ;
--   2. `us209_refuse_biometric` : nouveau consentement biométrique refusé (le dernier fait foi) ;
--   3. `us209_restrict` : restriction ACTIVE d'une personne (comme la console d'US-109) ;
--   4. `us209_set_param` : nouvelle valeur d'un paramètre lu par la revue
--      (`flagged_booking_payment_order`, `min_driver_age`), portée pays ou classe, à platform.now() ;
--   5. `us209_hold_row` / `us209_risk_rows` : relecture brute du hold et de ses évaluations (aucun
--      rôle applicatif ne les lit) : les attendus viennent de 16 et 19, jamais de cette relecture ;
--   6. états KYC posés après la pose : retrait du consentement (RECHECK / CONSENT_WITHDRAWN),
--      statut de la vérification, échéance du permis ; nouvelle version d'une règle déclarée ;
--   7. `us209_conversion_eligibility` : la vraie éligibilité à la conversion dans la transaction de
--      test, sous le contexte du travailleur (propriétaire cmd_hold_owner, comme 9997).
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us209_* (voir la liste des droits en fin de fichier).

-- Gabarit du consentement biométrique en vigueur (même choix que core.kyc_biometric_template de
-- 0072, que migrator n'exécute pas : portée du pays s'il en a une, sinon commune ; langue es).
CREATE FUNCTION test_fixture.us209_biometric_template(p_country text)
  RETURNS TABLE (id uuid, kind text, version integer, locale text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t0 AS (SELECT platform.now() AS ts),
  scope AS (
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM core.contract_document_template AS t, t0
              WHERE t.kind = 'BIOMETRIC_CONSENT' AND t.country_code = p_country
                AND t.valid_from <= t0.ts)
           THEN p_country END AS country
  ), latest AS (
    SELECT pg_catalog.max(t.version) AS version
      FROM core.contract_document_template AS t, scope, t0
     WHERE t.kind = 'BIOMETRIC_CONSENT' AND t.country_code IS NOT DISTINCT FROM scope.country
       AND t.valid_from <= t0.ts
  )
  SELECT t.id, t.kind, t.version, t.locale
    FROM core.contract_document_template AS t, scope, latest
   WHERE t.kind = 'BIOMETRIC_CONSENT' AND t.country_code IS NOT DISTINCT FROM scope.country
     AND t.version = latest.version
     AND (t.locale = 'es' OR t.is_authoritative)
   ORDER BY (t.locale = 'es') DESC
   LIMIT 1
$fn$;

CREATE FUNCTION test_fixture.us209_driver(p_user uuid, p_country text, p_birth date,
                                          p_license_expiry date, p_license_country text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
  v_t  record;
BEGIN
  INSERT INTO core.kyc_identity_verification (id, user_id, country_code, status, is_current, attempt,
                                              approved_at, expires_at)
  VALUES (v_id, p_user, p_country, 'APPROVED', true, 1, platform.now(),
          platform.now() + interval '365 days');
  INSERT INTO core.kyc_identity_subject (verification_id, user_id, attempt, date_of_birth,
                                         residence_country)
  VALUES (v_id, p_user, 1, p_birth, p_country);
  INSERT INTO core.kyc_identity_document (verification_id, user_id, attempt, doc_type,
                                          issuing_country, expiry_date, is_permanent, status)
  VALUES (v_id, p_user, 1, 'DRIVER_LICENSE', p_license_country, p_license_expiry, true, 'ACCEPTED');
  SELECT t.id, t.kind, t.version, t.locale INTO v_t
    FROM test_fixture.us209_biometric_template(p_country) AS t;
  INSERT INTO core.contract_consent (user_id, template_id, doc_kind, doc_version, locale, accepted,
                                     accepted_at, context, country_code, c2_withheld)
  VALUES (p_user, v_t.id, v_t.kind, v_t.version, v_t.locale, true, platform.now(), 'KYC',
          p_country, true);
  RETURN v_id;
END
$fn$;

CREATE FUNCTION test_fixture.us209_refuse_biometric(p_user uuid, p_country text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.contract_consent (user_id, template_id, doc_kind, doc_version, locale, accepted,
                                     accepted_at, context, country_code, c2_withheld)
  SELECT p_user, t.id, t.kind, t.version, t.locale, false, platform.now(), 'KYC', p_country, true
    FROM test_fixture.us209_biometric_template(p_country) AS t
$fn$;

CREATE FUNCTION test_fixture.us209_restrict(p_user uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.iam_restriction (id, user_id, kind, active, reason)
  VALUES (pg_catalog.gen_random_uuid(), p_user, 'POLICY_VIOLATION', true, 'test US-209')
$fn$;

-- valid_from posé par la garde de 0008 (platform.now()) ; trois clés seulement
CREATE FUNCTION test_fixture.us209_set_param(p_key text, p_country text, p_scope_id text,
                                             p_value jsonb)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, value,
                                       change_reason)
  SELECT p_key, p_country, CASE WHEN p_scope_id IS NULL THEN 'COUNTRY' ELSE 'CATEGORY' END,
         p_scope_id, p_value, 'test US-209 : valeur de test'
   WHERE p_key IN ('flagged_booking_payment_order', 'min_driver_age',
                   'foreign_license_review_enabled')
$fn$;

CREATE FUNCTION test_fixture.us209_hold_row(p_hold_id uuid)
  RETURNS TABLE (status text, review_required boolean, reviewed_at timestamptz,
                 expires_at timestamptz, created_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT h.status, h.review_required, h.reviewed_at, h.expires_at, h.created_at
    FROM core.booking_checkout_hold AS h
   WHERE h.id = p_hold_id
$fn$;

CREATE FUNCTION test_fixture.us209_risk_rows(p_hold_id uuid)
  RETURNS TABLE (decision text, score integer, rules_fired jsonb, explanation text,
                 decided_at timestamptz, queue text, queue_status text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.decision, a.score, a.rules_fired, a.explanation, a.decided_at, q.queue, q.status
    FROM core.risk_assessment AS a
    LEFT JOIN core.support_review_queue_item AS q
      ON q.subject_type = 'RISK_ASSESSMENT' AND q.subject_id = a.id
   WHERE a.subject_type = 'HOLD' AND a.subject_id = p_hold_id
   ORDER BY a.created_at
$fn$;

-- Retrait du consentement biométrique tel que la commande KYC l'écrit (0072 / 0097) : vérification
-- courante RECHECK, motif CONSENT_WITHDRAWN (vrai état de N-122).
CREATE FUNCTION test_fixture.us209_withdraw_biometric(p_user uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.kyc_identity_verification
     SET status = 'RECHECK', decision_reason_code = 'CONSENT_WITHDRAWN'
   WHERE user_id = p_user AND is_current
$fn$;

-- Statut de la vérification courante (ex. REVOKED : approbation retirée après la pose).
CREATE FUNCTION test_fixture.us209_set_verification_status(p_user uuid, p_status text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.kyc_identity_verification SET status = p_status
   WHERE user_id = p_user AND is_current
$fn$;

-- Échéance du permis accepté de la tentative courante (permis renouvelé ou corrigé par l'ops).
CREATE FUNCTION test_fixture.us209_set_license_expiry(p_user uuid, p_expiry date)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.kyc_identity_document AS d SET expiry_date = p_expiry
    FROM core.kyc_identity_verification AS v
   WHERE v.user_id = p_user AND v.is_current AND d.verification_id = v.id
     AND d.attempt = v.attempt AND d.doc_type = 'DRIVER_LICENSE'
$fn$;

-- Nouvelle version d'une règle déclarée (migrator seul écrit risk_rule) : version suivante, active
-- ou non, valable à platform.now().
CREATE FUNCTION test_fixture.us209_rule_version(p_code text, p_active boolean)
  RETURNS integer
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.risk_rule (code, version, description, severity, active, valid_from)
  SELECT r.code, r.version + 1, r.description, r.severity, p_active, platform.now()
    FROM core.risk_rule AS r
   WHERE r.code = p_code
   ORDER BY r.version DESC
   LIMIT 1
  RETURNING version
$fn$;

-- Préavis du lieu de remise d'un véhicule (l'hôte le règle par la commande d'US-119).
CREATE FUNCTION test_fixture.us209_set_notice(p_vehicle uuid, p_minutes integer)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.catalog_location AS l SET advance_notice_minutes = p_minutes
    FROM core.catalog_vehicle AS v
   WHERE v.id = p_vehicle AND l.id = v.home_location_id
$fn$;

-- Éligibilité à la conversion d'un hold, dans la transaction de test (le travailleur de
-- conversion n'existe pas encore, US-223) : contexte du travailleur `booking_conversion` posé
-- localement, puis la vraie fonction. Transférée à cmd_hold_owner ci-dessous (précédent : 9997).
CREATE FUNCTION test_fixture.us209_conversion_eligibility(p_hold_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_kind   text := pg_catalog.current_setting('app.actor_kind', true);
  v_worker text := pg_catalog.current_setting('app.worker_name', true);
  v_r      text;
BEGIN
  PERFORM pg_catalog.set_config('app.actor_kind', 'WORKER', true);
  PERFORM pg_catalog.set_config('app.worker_name', 'booking_conversion', true);
  v_r := core.booking_conversion_eligibility(p_hold_id);
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  PERFORM pg_catalog.set_config('app.worker_name', COALESCE(v_worker, ''), true);
  RETURN v_r;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us209_biometric_template(text),
  test_fixture.us209_driver(uuid, text, date, date, text),
  test_fixture.us209_refuse_biometric(uuid, text), test_fixture.us209_restrict(uuid),
  test_fixture.us209_set_param(text, text, text, jsonb), test_fixture.us209_hold_row(uuid),
  test_fixture.us209_risk_rows(uuid), test_fixture.us209_withdraw_biometric(uuid),
  test_fixture.us209_set_verification_status(uuid, text),
  test_fixture.us209_set_license_expiry(uuid, date), test_fixture.us209_rule_version(text, boolean),
  test_fixture.us209_conversion_eligibility(uuid), test_fixture.us209_set_notice(uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us209_driver(uuid, text, date, date, text),
  test_fixture.us209_refuse_biometric(uuid, text), test_fixture.us209_restrict(uuid),
  test_fixture.us209_set_param(text, text, text, jsonb), test_fixture.us209_hold_row(uuid),
  test_fixture.us209_risk_rows(uuid), test_fixture.us209_withdraw_biometric(uuid),
  test_fixture.us209_set_verification_status(uuid, text),
  test_fixture.us209_set_license_expiry(uuid, date), test_fixture.us209_rule_version(text, boolean),
  test_fixture.us209_conversion_eligibility(uuid), test_fixture.us209_set_notice(uuid, integer)
  TO app_api;

-- Transfert de la sonde de conversion au propriétaire des commandes (précédent : 9997) ; CREATE le
-- temps du transfert. EXECUTE accordé avant : migrator n'est plus propriétaire ensuite.
GRANT CREATE ON SCHEMA test_fixture TO cmd_hold_owner;
ALTER FUNCTION test_fixture.us209_conversion_eligibility(uuid) OWNER TO cmd_hold_owner;
REVOKE CREATE ON SCHEMA test_fixture FROM cmd_hold_owner;
