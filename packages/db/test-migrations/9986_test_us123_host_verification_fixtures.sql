-- 9986 — fixtures des preuves de l'inscription et de la vérification de l'hôte (US-123, migration
-- 0075). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) :
--   - relectures des lignes que les rôles applicatifs ne lisent pas (dossier, filtrages, profil
--     fiscal, faits vérifiés, événements, audit, statut du compte d'hôte) : les attendus des tests
--     viennent de 19 US-123, 16 HST-049 / FIN-008 / VER-028 / A.8 et 17 §2.4, §4.5, jamais de ces
--     relectures ;
--   - sous-marchand du PSP posé directement (compte FAKE de test du pays, statut demandé) : le
--     KYC du PSP est simulé ici, l'enregistrement par le travailleur `payment_command` est prouvé
--     par l0-pay-marketplace (US-061).
--   - allègement ADR-115 (0085, 0086) : version du paramètre host_tax_id_required_for_activation et
--     capacité SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID du PSP FAKE, écrites dans une transaction
--     ANNULÉE par le test.
-- AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1) : la preuve du chemin ACTIVE
-- les ouvre par la procédure à deux personnes d'US-125, dans une fenêtre virtuelle lointaine.
--
-- Retour arrière : DROP FUNCTION test_fixture.us123_* (voir la liste des droits en fin de fichier).

CREATE FUNCTION test_fixture.us123_set_submerchant(p_org uuid, p_status text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_country  text;
  v_currency text;
  v_account  uuid;
  v_id       uuid := pg_catalog.gen_random_uuid();
BEGIN
  SELECT o.country_code, k.currency::text INTO v_country, v_currency
    FROM core.iam_organization AS o JOIN core.config_country AS k ON k.code::text = o.country_code
   WHERE o.id = p_org;
  v_account := test_fixture.fixture_psp_account(v_country);
  INSERT INTO core.payment_psp_submerchant (id, psp_account_id, org_id, country_code, attempt_no,
                                            idem_plain, payout_currency)
  VALUES (v_id, v_account, p_org, v_country,
          (SELECT COALESCE(pg_catalog.max(s.attempt_no), 0) + 1
             FROM core.payment_psp_submerchant AS s
            WHERE s.psp_account_id = v_account AND s.org_id = p_org),
          'us123:' || v_id::text, v_currency);
  IF p_status <> 'PENDING' THEN
    UPDATE core.payment_psp_submerchant AS s
       SET kyc_status = p_status,
           provider_submerchant_ref = 'fk_sm_' || pg_catalog.replace(v_id::text, '-', ''),
           activated_at = CASE WHEN p_status = 'ACTIVE' THEN platform.now() END,
           suspended_reason = CASE WHEN p_status = 'SUSPENDED' THEN 'test' END
     WHERE s.id = v_id;
  END IF;
END
$fn$;

CREATE FUNCTION test_fixture.us123_dossier(p_org uuid)
  RETURNS TABLE (id uuid, status text, missing text[], age_ok boolean, residence_verified boolean,
                 reason_code text, decided_by uuid, decided_at timestamptz,
                 activated_at timestamptz, sanctions_screening_id uuid,
                 identity_verification_id uuid, country_code text, screening_hold boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.id, d.status, d.missing, d.age_ok, d.residence_verified, d.reason_code, d.decided_by,
         d.decided_at, d.activated_at, d.sanctions_screening_id, d.identity_verification_id,
         d.country_code, d.screening_hold
    FROM core.kyc_host_verification AS d WHERE d.org_id = p_org
$fn$;

CREATE FUNCTION test_fixture.us123_screenings(p_org uuid)
  RETURNS TABLE (subject_type text, provider text, request_key text, lists_version jsonb,
                 result text, match_ref text, reviewer uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.subject_type, s.provider, s.request_key, s.lists_version, s.result, s.match_ref,
         s.reviewer
    FROM core.kyc_sanctions_screening AS s
    JOIN core.kyc_host_verification AS d ON d.id = s.host_verification_id
   WHERE d.org_id = p_org
   ORDER BY s.created_at, s.id
$fn$;

CREATE FUNCTION test_fixture.us123_tax_profile(p_org uuid)
  RETURNS TABLE (tax_id_kind text, tax_id_enc bytea, tax_id_key_subject_type text,
                 tax_id_key_subject_id uuid, regime text, taxpayer_kind text, country_code text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p.tax_id_kind, p.tax_id_enc, p.tax_id_key_subject_type, p.tax_id_key_subject_id, p.regime,
         p.taxpayer_kind, p.country_code
    FROM core.kyc_host_tax_profile AS p WHERE p.org_id = p_org
$fn$;

CREATE FUNCTION test_fixture.us123_subject(p_user uuid)
  RETURNS TABLE (date_of_birth date, residence_country text, attempt integer)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT s.date_of_birth, s.residence_country::text, s.attempt
    FROM core.kyc_identity_subject AS s WHERE s.user_id = p_user
   ORDER BY s.created_at, s.id
$fn$;

CREATE FUNCTION test_fixture.us123_org_status(p_org uuid)
  RETURNS text
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT o.status FROM core.iam_organization AS o WHERE o.id = p_org
$fn$;

CREATE FUNCTION test_fixture.us123_events(p_org uuid)
  RETURNS TABLE (id uuid, type text, aggregate_type text, aggregate_version bigint,
                 country_code text, actor_role text, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.id, e.type, e.aggregate_type, e.aggregate_version, e.country_code, e.actor_role, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE (e.aggregate_type = 'organization' AND e.aggregate_id = p_org)
      OR (e.aggregate_type = 'host_verification'
          AND e.aggregate_id IN (SELECT d.id FROM core.kyc_host_verification AS d WHERE d.org_id = p_org))
   ORDER BY e.created_at, e.id
$fn$;

CREATE FUNCTION test_fixture.us123_audit(p_org uuid)
  RETURNS TABLE (action_code text, actor_role text, after jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.action_code, a.actor_role, a.after
    FROM core.audit_audit_log AS a
   WHERE a.subject_type = 'ORGANIZATION' AND a.subject_id = p_org
   ORDER BY a.id
$fn$;

CREATE FUNCTION test_fixture.us123_queue_items(p_org uuid)
  RETURNS TABLE (queue text, status text, decision text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.queue, i.status, i.decision
    FROM core.support_review_queue_item AS i
   WHERE i.subject_type = 'ORGANIZATION' AND i.subject_id = p_org
   ORDER BY i.created_at, i.id
$fn$;

-- Capacités BLOQUANTES du PSP FAKE du pays (catalogue de 0039, sans liste en dur) posées au statut
-- demandé à l'instant `p_valid_from` : la plus récente fait foi (17 §2.8). Appelée avec un instant
-- d'une fenêtre d'horloge virtuelle lointaine, refermée par une ligne UNKNOWN : sans effet hors de
-- cette fenêtre pour les autres preuves.
CREATE FUNCTION test_fixture.us123_set_capabilities(p_country text, p_status text,
                                                    p_valid_from timestamptz)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.payment_psp_capability
         (provider, country_code, method, network, capability, value, status, source,
          validated_at, valid_from)
  SELECT 'FAKE', p_country, '*', '*', c.capability,
         CASE c.kind WHEN 'bool' THEN 'true'::jsonb WHEN 'int' THEN '24'::jsonb
                     ELSE '"SUPPORTED"'::jsonb END,
         p_status, 'test US-123 (FAKE)',
         CASE WHEN p_status IN ('VALIDATED_SANDBOX', 'VALIDATED_CONTRACT') THEN p_valid_from END,
         p_valid_from
    FROM core.payment_psp_capability_catalog AS c
   WHERE c.blocking <> 'NO'
$fn$;

-- Allègement ADR-115 (migrations 0085, 0086) : nouvelle version de host_tax_id_required_for_activation
-- valable à platform.now(), écrite dans la transaction de l'appelant, qui l'ANNULE ensuite (comme
-- us124_param_version) ; une valeur JSON nulle prouve le repli fail-closed (clé mal formée). Clé
-- fermée.
CREATE FUNCTION test_fixture.us123_param_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key IS DISTINCT FROM 'host_tax_id_required_for_activation' THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-123 ADR-115 (annulé)');
END
$fn$;

-- Capacité SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID du PSP FAKE du pays (statut, valeur), valable à
-- platform.now() : écrite dans la transaction de l'appelant, qui l'ANNULE ensuite.
CREATE FUNCTION test_fixture.us123_set_payout_tax_capability(p_country text, p_status text,
                                                             p_value jsonb)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.payment_psp_capability
         (provider, country_code, method, network, capability, value, status, source,
          validated_at, valid_from)
  VALUES ('FAKE', p_country, '*', '*', 'SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID', p_value, p_status,
          'test US-123 ADR-115 (FAKE, annulé)',
          CASE WHEN p_status IN ('VALIDATED_SANDBOX', 'VALIDATED_CONTRACT') THEN platform.now() END,
          platform.now())
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us123_set_submerchant(uuid, text),
  test_fixture.us123_dossier(uuid), test_fixture.us123_screenings(uuid),
  test_fixture.us123_tax_profile(uuid), test_fixture.us123_subject(uuid),
  test_fixture.us123_org_status(uuid), test_fixture.us123_events(uuid),
  test_fixture.us123_audit(uuid), test_fixture.us123_queue_items(uuid),
  test_fixture.us123_set_capabilities(text, text, timestamptz),
  test_fixture.us123_param_version(text, text, jsonb),
  test_fixture.us123_set_payout_tax_capability(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us123_set_submerchant(uuid, text),
  test_fixture.us123_dossier(uuid), test_fixture.us123_screenings(uuid),
  test_fixture.us123_tax_profile(uuid), test_fixture.us123_subject(uuid),
  test_fixture.us123_org_status(uuid), test_fixture.us123_events(uuid),
  test_fixture.us123_audit(uuid), test_fixture.us123_queue_items(uuid),
  test_fixture.us123_set_capabilities(text, text, timestamptz),
  test_fixture.us123_param_version(text, text, jsonb),
  test_fixture.us123_set_payout_tax_capability(text, text, jsonb) TO app_api;
