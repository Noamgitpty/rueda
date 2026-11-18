-- 9946 — fixtures des preuves de la constancia d'arrendamiento (US-212, migration 0138). TESTS
-- SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Rôle (SECURITY DEFINER sous migrator, search_path figé ; aucun SQL dynamique) :
--   1. `us212_contract` : version de contrat posée sans le travailleur, avec les faits (`terms`)
--      et la partie nominative (`identity`) écrits par le TEST (jamais par cette fixture), version
--      suivante du segment n° 1 ; le monde du trip vient de `us211_world` (9963) ;
--   2. `us212_erase` : partie nominative d'un contrat pseudonymisée (forme du balayage de rétention,
--      US-111), pour la preuve ERASED.
-- Appelées SEULEMENT dans une transaction ANNULÉE. AUCUNE fixture n'écrit un interrupteur de mise en
-- service (17 §0.1).
--
-- Retour arrière : DROP FUNCTION test_fixture.us212_contract(uuid, jsonb, jsonb),
--   test_fixture.us212_erase(uuid).

CREATE FUNCTION test_fixture.us212_contract(p_trip uuid, p_terms jsonb, p_identity jsonb)
  RETURNS TABLE (document_id uuid, version integer)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_seg  uuid;
  v_prev record;
  v_id   uuid := platform.uuid_v7();
  v_es   uuid;
  v_en   uuid;
  v_cc   text;
BEGIN
  SELECT s.id, t.country_code INTO v_seg, v_cc
    FROM core.booking_trip_segment AS s JOIN core.booking_trip AS t ON t.id = s.trip_id
   WHERE s.trip_id = p_trip AND s.seq = 1;
  SELECT d.id, d.version INTO v_prev FROM core.contract_generated_document AS d
   WHERE d.subject_id = v_seg
     AND NOT EXISTS (SELECT 1 FROM core.contract_generated_document AS n WHERE n.supersedes_id = d.id);
  SELECT t.id INTO v_es FROM core.contract_document_template AS t
   WHERE t.kind = 'RENTAL_CONTRACT' AND t.country_code IS NULL AND t.locale = 'es'
   ORDER BY t.version DESC LIMIT 1;
  SELECT t.id INTO v_en FROM core.contract_document_template AS t
   WHERE t.kind = 'RENTAL_CONTRACT' AND t.country_code IS NULL AND t.locale = 'en'
   ORDER BY t.version DESC LIMIT 1;
  INSERT INTO core.contract_generated_document
         (id, kind, template_id, courtesy_template_id, subject_type, subject_id, trip_id,
          country_code, locale, version, supersedes_id, trigger_key, terms, derived,
          renderer_version, sha256)
  VALUES (v_id, 'RENTAL_CONTRACT', v_es, v_en, 'TRIP_SEGMENT', v_seg, p_trip, v_cc, 'en',
          COALESCE(v_prev.version, 0) + 1, v_prev.id,
          'us212:' || (COALESCE(v_prev.version, 0) + 1)::text, p_terms, '{"brand":"Marca"}',
          'ctr.pdf/1', pg_catalog.sha256(pg_catalog.convert_to(v_id::text, 'UTF8')));
  INSERT INTO core.contract_document_party (document_id, identity, body)
  VALUES (v_id, p_identity, '[{"s":"p","t":"fixture"}]');
  UPDATE core.booking_trip_segment SET contract_document_id = v_id WHERE id = v_seg;
  RETURN QUERY SELECT v_id, COALESCE(v_prev.version, 0) + 1;
END
$fn$;

-- Partie nominative pseudonymisée (US-111) : identité et texte remplacés, date posée
CREATE FUNCTION test_fixture.us212_erase(p_trip uuid)
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  UPDATE core.contract_document_party AS p
     SET identity = '{}'::jsonb, body = '[]'::jsonb, pseudonymized_at = platform.now()
   WHERE p.document_id IN (SELECT d.id FROM core.contract_generated_document AS d
                            WHERE d.trip_id = p_trip)
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us212_contract(uuid, jsonb, jsonb),
  test_fixture.us212_erase(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us212_contract(uuid, jsonb, jsonb),
  test_fixture.us212_erase(uuid) TO app_api;
