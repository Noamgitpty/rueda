-- 9964 — fixtures des preuves du registre Ley 81, des demandes des personnes et de la pseudonymisation (US-111, migration 0090). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, aucun SQL dynamique, EXECUTE au seul
-- app_api) : remplacer les écrivains qui n'existent pas encore (clôture d'un trip, dossier de
-- support), relire ce que les rôles applicatifs ne lisent pas (registre, demandes, journal des
-- purges) et poser, DANS la transaction du test (annulée), un registre validé et un fournisseur KYC
-- contractuel. Les attendus des tests viennent de 19 US-111, 16 LEG-009 / LEG-010, 17 §3.1.3,
-- §3.2.13, §7.2 et d'ADR-118, jamais de ces fonctions.
--
-- Retour arrière : DROP FUNCTION test_fixture.us111_close_trip(uuid, text, text, text),
--   test_fixture.us111_trip(uuid), test_fixture.us111_retention_log(uuid),
--   test_fixture.us111_dsr(uuid), test_fixture.us111_support_case(text, uuid),
--   test_fixture.us111_register(), test_fixture.us111_validate_register(text, boolean),
--   test_fixture.us111_tamper_log(uuid, text), test_fixture.us111_set_erasure(uuid, text,
--   timestamptz), test_fixture.us111_legal_hold(uuid, text).

-- Clôture d'un trip (aucun écrivain des fins de trip en Bêta) : statut final et motifs codés.
CREATE FUNCTION test_fixture.us111_close_trip(p_trip uuid, p_status text, p_termination text,
                                              p_cancellation text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.booking_trip
     SET status = p_status, termination_reason = p_termination, cancellation_reason = p_cancellation
   WHERE id = p_trip
$fn$;

CREATE FUNCTION test_fixture.us111_trip(p_trip uuid)
  RETURNS TABLE (status text, termination_reason text, cancellation_reason text,
                 guest_user_id uuid, currency text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.status, t.termination_reason, t.cancellation_reason, t.guest_user_id, t.currency
    FROM core.booking_trip AS t WHERE t.id = p_trip
$fn$;

CREATE FUNCTION test_fixture.us111_retention_log(p_subject uuid)
  RETURNS TABLE (rule_code text, subject_type text, country_code text, action text,
                 columns text[], due_at timestamptz, at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.rule_code, l.subject_type, l.country_code, l.action, l.columns, l.due_at, l.at
    FROM core.audit_retention_log AS l WHERE l.subject_id = p_subject ORDER BY l.at
$fn$;

CREATE FUNCTION test_fixture.us111_dsr(p_case uuid)
  RETURNS TABLE (id uuid, user_id uuid, country_code text, kind text, status text,
                 received_at timestamptz, due_at timestamptz, identity_verified_at timestamptz,
                 closed_at timestamptz, handled_by uuid, overdue_alerted_at timestamptz)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.id, d.user_id, d.country_code, d.kind, d.status, d.received_at, d.due_at,
         d.identity_verified_at, d.closed_at, d.handled_by, d.overdue_alerted_at
    FROM core.audit_data_subject_request AS d WHERE d.support_case_id = p_case
$fn$;

-- Dossier de support d'une personne (canal e-mail, catégorie ACCOUNT) : la demande arrive par lui.
CREATE FUNCTION test_fixture.us111_support_case(p_country text, p_requester uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.support_support_case (id, requester_user_id, country_code, channel, category)
  VALUES (v_id, p_requester, p_country, 'EMAIL', 'ACCOUNT');
  RETURN v_id;
END
$fn$;

-- Registre (lecture) : sous-traitants, traitements et règles, en jsonb.
CREATE FUNCTION test_fixture.us111_register()
  RETURNS jsonb
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'subprocessors', (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) ORDER BY s.code)
                        FROM core.audit_subprocessor AS s),
    'activities', (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(a) ORDER BY a.code)
                     FROM core.audit_processing_activity AS a),
    'rules', (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.code)
                FROM core.audit_retention_rule AS r))
$fn$;

-- Dans la transaction du test (annulée) : registre du pays validé (nouvelle version du paramètre
-- à platform.now()) et, si demandé, un fournisseur KYC contractuel en vigueur.
CREATE FUNCTION test_fixture.us111_validate_register(p_country text, p_with_kyc boolean)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES ('privacy_register_validated', p_country, 'COUNTRY', 'true'::jsonb,
          'test US-111 : registre validé dans une transaction annulée');
  IF p_with_kyc THEN
    INSERT INTO core.audit_subprocessor (code, service, name, mode, processing_countries,
                                         data_classes, contract_ref, transfer_safeguard,
                                         valid_from, story)
    VALUES ('KYC_TEST_CONTRACTED', 'KYC', 'Fournisseur KYC de test', 'CONTRACTED', '{US}',
            '{C2,C3}', 'contrat-test-us111', 'CONTRACTUAL_CLAUSES', platform.now(), 'US-111')
    ON CONFLICT (code) DO NOTHING;
  END IF;
END
$fn$;

-- Tentative de réécriture ou d'effacement du journal des purges : SQLSTATE levé, ou « OK ».
CREATE FUNCTION test_fixture.us111_tamper_log(p_subject uuid, p_kind text)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_kind = 'UPDATE' THEN
    UPDATE core.audit_retention_log SET columns = '{}' WHERE subject_id = p_subject;
  ELSE
    DELETE FROM core.audit_retention_log WHERE subject_id = p_subject;
  END IF;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END
$fn$;

-- Demande d'effacement KYC forgée (US-105) dans un état et à une date donnés, pour une
-- vérification existante de la personne.
CREATE FUNCTION test_fixture.us111_set_erasure(p_user uuid, p_status text, p_requested_at timestamptz)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  INSERT INTO core.kyc_erasure_request (user_id, verification_id, provider, provider_session_ref,
                                        status, requested_at, completed_at)
  SELECT p_user, v.id, 'FAKE', 'fk_us111', p_status, p_requested_at,
         CASE WHEN p_status = 'FAILED' THEN p_requested_at END
    FROM core.kyc_identity_verification AS v WHERE v.user_id = p_user
   ORDER BY v.created_at DESC LIMIT 1
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us111_close_trip(uuid, text, text, text),
  test_fixture.us111_trip(uuid), test_fixture.us111_retention_log(uuid),
  test_fixture.us111_dsr(uuid), test_fixture.us111_support_case(text, uuid),
  test_fixture.us111_register(), test_fixture.us111_validate_register(text, boolean),
  test_fixture.us111_tamper_log(uuid, text),
  test_fixture.us111_set_erasure(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us111_close_trip(uuid, text, text, text),
  test_fixture.us111_trip(uuid), test_fixture.us111_retention_log(uuid),
  test_fixture.us111_dsr(uuid), test_fixture.us111_support_case(text, uuid),
  test_fixture.us111_register(), test_fixture.us111_validate_register(text, boolean),
  test_fixture.us111_tamper_log(uuid, text),
  test_fixture.us111_set_erasure(uuid, text, timestamptz) TO app_api, app_worker;

-- Gel légal posé sur un trip (DANS la transaction du test) : action de console d'enregistrement
-- seul inscrite sur le trip (rétrofacturation, incident), ou demande du voyageur du trip en
-- BLOCKED_LEGAL_HOLD (dossier de support créé pour l'occasion). Les vraies commandes exigent une
-- session TOTP et un trip validé : leur parcours est prouvé par l0-us101 et le critère 3.
CREATE FUNCTION test_fixture.us111_legal_hold(p_trip uuid, p_kind text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_t    record;
  v_case uuid := pg_catalog.gen_random_uuid();
  v_id   uuid := pg_catalog.gen_random_uuid();
BEGIN
  SELECT t.guest_user_id, t.country_code INTO v_t FROM core.booking_trip AS t WHERE t.id = p_trip;
  IF p_kind = 'BLOCKED_LEGAL_HOLD' THEN
    INSERT INTO core.support_support_case (id, requester_user_id, country_code, channel, category)
    VALUES (v_case, v_t.guest_user_id, v_t.country_code, 'EMAIL', 'ACCOUNT');
    INSERT INTO core.audit_data_subject_request
           (support_case_id, user_id, country_code, kind, status, received_at, due_at,
            identity_verified_at, handled_by, updated_at)
    VALUES (v_case, v_t.guest_user_id, v_t.country_code, 'DELETION', 'BLOCKED_LEGAL_HOLD',
            platform.now(), platform.now() + interval '10 days', platform.now(),
            v_t.guest_user_id, platform.now());
  ELSE
    INSERT INTO core.support_manual_action (id, action_code, mode, subject_type, subject_id,
                                            country_code, actor_user_id, actor_role, reason,
                                            request_id, outcome)
    VALUES (v_id, p_kind, 'RECORD_ONLY', 'TRIP', p_trip, v_t.country_code, v_t.guest_user_id,
            'ADMIN', 'Gel légal posé par le test US-111', v_id, 'RECORDED');
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us111_legal_hold(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us111_legal_hold(uuid, text) TO app_api, app_worker;
