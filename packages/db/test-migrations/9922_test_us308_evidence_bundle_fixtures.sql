-- 9922 — fixtures des preuves du dossier de preuve d'un trip (US-308, migration 0164). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. `us308_consent` : acceptation d'une version de document juridique (forme écrite par la
--      commande d'inscription ou de réacceptation : gabarit es de la dernière version du genre,
--      heure posée par le TEST) ;
--   2. `us308_bundle` : relecture d'un dossier (aucun rôle applicatif ne lit la table) ;
--   3. `us308_try_tamper` : écriture interdite d'un dossier scellé (manifeste, empreinte, état,
--      suppression) : la garde `claim_evidence_sealed` doit la refuser, même au propriétaire ;
--   4. `us308_seed_bundle` : dossier REQUESTED d'un trip (dossier de support ouvert et manifeste
--      minimal scellé), demandé par une personne posée par le TEST, pour la matrice des routes
--      (US-043) : tout autre membre du staff du pays le vise sans en être le demandeur.
-- Appelées SEULEMENT dans une transaction ANNULÉE, ou sur des données de test validées sans
-- interrupteur. AUCUNE fixture n'écrit un interrupteur de mise en service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us308_consent(uuid, text, timestamptz),
--   test_fixture.us308_bundle(uuid), test_fixture.us308_try_tamper(uuid, text),
--   test_fixture.us308_seed_bundle(uuid, text, uuid).

CREATE FUNCTION test_fixture.us308_consent(p_user uuid, p_kind text, p_at timestamptz)
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_t record;
BEGIN
  SELECT t.id, t.version INTO v_t FROM core.contract_document_template AS t
   WHERE t.kind = p_kind AND t.country_code IS NULL AND t.locale = 'es'
   ORDER BY t.version DESC LIMIT 1;
  INSERT INTO core.contract_consent (user_id, template_id, doc_kind, doc_version, locale, accepted,
                                     accepted_at, context, c2_withheld)
  VALUES (p_user, v_t.id, p_kind, v_t.version, 'es', true, p_at, 'SIGNUP', true);
  RETURN v_t.version;
END
$fn$;

CREATE FUNCTION test_fixture.us308_bundle(p_id uuid)
  RETURNS TABLE (status text, failure_code text, findings jsonb, export_file_id uuid,
                 export_sha256 bytea, generated_at timestamptz, expires_at timestamptz,
                 manifest jsonb, manifest_text text, manifest_sha256 bytea, requested_by uuid,
                 case_id uuid, purpose text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT b.status, b.failure_code, b.findings, b.export_file_id, b.export_sha256, b.generated_at,
         b.expires_at, b.manifest, b.manifest::text, b.manifest_sha256, b.requested_by, b.case_id,
         b.purpose
    FROM core.claim_evidence_bundle AS b WHERE b.id = p_id
$fn$;

CREATE FUNCTION test_fixture.us308_try_tamper(p_id uuid, p_what text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  CASE p_what
    WHEN 'MANIFEST' THEN
      UPDATE core.claim_evidence_bundle AS b
         SET manifest = b.manifest || '{"absent": []}'::jsonb WHERE b.id = p_id;
    WHEN 'SHA256' THEN
      UPDATE core.claim_evidence_bundle AS b
         SET manifest_sha256 = pg_catalog.sha256('x'::bytea) WHERE b.id = p_id;
    WHEN 'REOPEN' THEN
      UPDATE core.claim_evidence_bundle AS b SET status = 'REQUESTED' WHERE b.id = p_id;
    WHEN 'EXTEND' THEN
      UPDATE core.claim_evidence_bundle AS b
         SET expires_at = b.expires_at + interval '30 days' WHERE b.id = p_id;
    WHEN 'DELETE' THEN
      DELETE FROM core.claim_evidence_bundle AS b WHERE b.id = p_id;
    ELSE
      RAISE EXCEPTION 'us308_try_tamper : cas inconnu %', p_what;
  END CASE;
END
$fn$;

CREATE FUNCTION test_fixture.us308_seed_bundle(p_trip uuid, p_country text, p_requester uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_case uuid := pg_catalog.gen_random_uuid();
  v_id   uuid := platform.uuid_v7();
  v_m    jsonb := pg_catalog.jsonb_build_object('schema', 'clm.evidence/1', 'files', '[]'::jsonb);
BEGIN
  INSERT INTO core.support_support_case (id, country_code, trip_id, channel, category, status,
                                         assignee_id)
  VALUES (v_case, p_country, p_trip, 'INTERNAL', 'CLAIM', 'OPEN', p_requester);
  INSERT INTO core.claim_evidence_bundle
         (id, trip_id, country_code, case_id, purpose, requested_by, requested_role, request_id,
          manifest, manifest_sha256)
  VALUES (v_id, p_trip, p_country, v_case, 'DISPUTE', p_requester, 'OPS_AGENT',
          pg_catalog.gen_random_uuid(), v_m,
          pg_catalog.sha256(pg_catalog.convert_to(v_m::text, 'UTF8')));
  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us308_consent(uuid, text, timestamptz),
  test_fixture.us308_bundle(uuid), test_fixture.us308_try_tamper(uuid, text),
  test_fixture.us308_seed_bundle(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us308_consent(uuid, text, timestamptz),
  test_fixture.us308_bundle(uuid), test_fixture.us308_try_tamper(uuid, text),
  test_fixture.us308_seed_bundle(uuid, text, uuid)
  TO app_api, app_worker;
