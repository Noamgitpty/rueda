-- 9996 — fixtures des preuves de la vérification d'identité (US-105, migration 0071). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) :
--   - relectures des lignes que les rôles applicatifs ne lisent pas (vérification courante,
--     champs du permis, scores, événements, rejets de rappels, consentements biométriques) : les
--     attendus des tests viennent de 19 US-105, 16 VER-001 / VER-002 / VER-004 et 17 §3.2.2,
--     §4.5, §7.2, jamais de ces relectures ;
--   - téléphone vérifié posé directement (numéro fictif unique) : la vérification par OTP (0066,
--     prouvée par l0-us104) partage la table des défis avec la purge à 30 jours de l0-us104, qui,
--     sous une horloge virtuelle à +31 jours, efface aussi les défis d'un fichier parallèle
--     (échec aléatoire observé en CI : saisie refusée) ;
--   - publication d'une version 2 du consentement biométrique, pour éprouver « une nouvelle version
--     exige une nouvelle acceptation » DANS une transaction annulée (la commande de console de 0059
--     ne publie pas ce genre).
--
-- Retour arrière : DROP FUNCTION test_fixture.us105_* (voir la liste des droits en fin de fichier).

CREATE FUNCTION test_fixture.us105_verification(p_user uuid)
  RETURNS TABLE (id uuid, country_code text, status text, attempt integer, provider text,
                 provider_session_ref text, decision_reason_code text, approved_at timestamptz,
                 expires_at timestamptz, row_version integer)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.id, v.country_code::text, v.status, v.attempt, v.provider, v.provider_session_ref,
         v.decision_reason_code, v.approved_at, v.expires_at, v.row_version
    FROM core.kyc_identity_verification AS v
   WHERE v.user_id = p_user
   ORDER BY v.created_at, v.id
$fn$;

CREATE FUNCTION test_fixture.us105_documents(p_user uuid)
  RETURNS TABLE (doc_type text, issuing_country text, expiry_date date, license_class text,
                 is_permanent boolean, provider_document_ref text, status text, attempt integer)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.doc_type, d.issuing_country::text, d.expiry_date, d.license_class, d.is_permanent,
         d.provider_document_ref, d.status, d.attempt
    FROM core.kyc_identity_document AS d
    JOIN core.kyc_identity_verification AS v ON v.id = d.verification_id
   WHERE v.user_id = p_user
   ORDER BY d.created_at, d.id
$fn$;

CREATE FUNCTION test_fixture.us105_liveness(p_user uuid)
  RETURNS TABLE (liveness_score numeric, face_match_score numeric, result text,
                 provider_session_ref text, retention_days numeric)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.liveness_score, l.face_match_score, l.result, l.provider_session_ref,
         pg_catalog.round(EXTRACT(EPOCH FROM (l.retention_until - l.created_at)) / 86400, 3)
    FROM core.kyc_liveness_check AS l
    JOIN core.kyc_identity_verification AS v ON v.id = l.verification_id
   WHERE v.user_id = p_user
   ORDER BY l.created_at, l.id
$fn$;

CREATE FUNCTION test_fixture.us105_events(p_verification uuid)
  RETURNS TABLE (type text, aggregate_version bigint, country_code text, actor_user_id uuid,
                 actor_role text, payload jsonb)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT e.type, e.aggregate_version, e.country_code, e.actor_user_id, e.actor_role, e.payload
    FROM core.outbox_outbox_event AS e
   WHERE e.aggregate_id = p_verification AND e.aggregate_type = 'identity_verification'
   ORDER BY e.aggregate_version, e.id
$fn$;

CREATE FUNCTION test_fixture.us105_rejections(p_sha256 bytea)
  RETURNS TABLE (provider text, reason text, body_length integer)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.provider, r.reason, r.body_length
    FROM core.kyc_webhook_rejection AS r
   WHERE r.body_sha256 = p_sha256
   ORDER BY r.received_at, r.id
$fn$;

CREATE FUNCTION test_fixture.us105_consents(p_user uuid)
  RETURNS TABLE (doc_kind text, doc_version integer, accepted boolean, context text,
                 country_code text, c2_withheld boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.doc_kind, c.doc_version, c.accepted, c.context, c.country_code::text, c.c2_withheld
    FROM core.contract_consent AS c
   WHERE c.user_id = p_user AND c.doc_kind = 'BIOMETRIC_CONSENT'
   ORDER BY c.seq
$fn$;

-- Version suivante du consentement biométrique commun, en vigueur à platform.now() (quatre
-- langues, texte de test). À n'appeler que dans une transaction ANNULÉE.
CREATE FUNCTION test_fixture.us105_publish_biometric_next()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_next integer;
BEGIN
  SELECT pg_catalog.max(t.version) + 1 INTO v_next FROM core.contract_document_template AS t
   WHERE t.kind = 'BIOMETRIC_CONSENT' AND t.country_code IS NULL;
  INSERT INTO core.contract_document_template
         (kind, country_code, locale, version, is_major, title, body_md, content_hash,
          legal_review_ref, is_authoritative, valid_from)
  SELECT 'BIOMETRIC_CONSENT', NULL, l.locale, v_next, true, 'test v' || v_next,
         'texte de test, version ' || v_next, pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'),
         NULL, l.locale = 'es', platform.now()
    FROM (VALUES ('es'), ('en'), ('fr'), ('pt')) AS l(locale);
  RETURN v_next;
END
$fn$;

CREATE FUNCTION test_fixture.us105_verify_phone(p_user uuid, p_phone text)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.iam_user_account AS u
     SET phone_e164 = p_phone, phone_verified_at = platform.now()
   WHERE u.id = p_user
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us105_verify_phone(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us105_verify_phone(uuid, text) TO app_api;

REVOKE ALL ON FUNCTION test_fixture.us105_verification(uuid), test_fixture.us105_documents(uuid),
  test_fixture.us105_liveness(uuid), test_fixture.us105_events(uuid),
  test_fixture.us105_rejections(bytea), test_fixture.us105_consents(uuid),
  test_fixture.us105_publish_biometric_next() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us105_verification(uuid), test_fixture.us105_documents(uuid),
  test_fixture.us105_liveness(uuid), test_fixture.us105_events(uuid),
  test_fixture.us105_rejections(bytea), test_fixture.us105_consents(uuid),
  test_fixture.us105_publish_biometric_next() TO app_api;
