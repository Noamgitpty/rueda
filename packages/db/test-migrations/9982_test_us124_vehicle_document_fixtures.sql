-- 9982 — fixtures des preuves des documents et de l'éligibilité du véhicule (US-124, migrations 0077 et 0078). TESTS SEULEMENT.
--
-- JAMAIS appliquée hors tests : seul le harnais ajoute test-migrations/, et seulement à la base
-- jetable principale `rueda_test_*` (le schéma test_fixture est créé par 9001).
--
-- Relectures (SECURITY DEFINER sous migrator, search_path figé, EXECUTE au seul app_api) des lignes
-- que les rôles applicatifs ne lisent pas : véhicule (état de la revue), pièces, contrôles,
-- contestations, fichiers, journal. Plus une variante du catalogue couvrant toutes les années
-- (âge maximal éprouvé à la frontière) et la valeur d'un paramètre posée dans une transaction de
-- test (repli fail-closed). Les attendus du test viennent de 19 US-124, 16 HST-019 / HST-039, 08
-- BR-LIST-01 à 03 et 22 OQ-P2P-02 / OQ-BR-28, jamais de ces relectures.
--
-- Retour arrière : DROP FUNCTION test_fixture.us124_variant(text), test_fixture.us124_vehicle(uuid),
--   test_fixture.us124_documents(uuid), test_fixture.us124_checks(uuid),
--   test_fixture.us124_claims(uuid), test_fixture.us124_file(uuid),
--   test_fixture.us124_audit(uuid), test_fixture.us124_param_version(text, text, jsonb),
--   test_fixture.us124_vehicle_items(uuid).

-- Variante ACTIVE du marché du pays, produite de 1990 à aujourd'hui (clone d'une variante de la graine).
CREATE FUNCTION test_fixture.us124_variant(p_country text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v    record;
  v_id uuid;
BEGIN
  SELECT x.* INTO v
    FROM core.catalog_vehicle_variant x
    JOIN core.catalog_vehicle_model o ON o.id = x.model_id AND o.status = 'ACTIVE'
    JOIN core.catalog_vehicle_make m ON m.id = o.make_id AND m.status = 'ACTIVE'
   WHERE x.status = 'ACTIVE' AND x.market IS NULL
   ORDER BY x.id
   LIMIT 1;
  INSERT INTO core.catalog_vehicle_variant (id, model_id, year_from, year_to, trim_name,
                                            transmission, fuel_type, drive, seats, doors,
                                            value_class, market, status, source, license_note)
  VALUES (pg_catalog.gen_random_uuid(), v.model_id, 1990, NULL, 'US124 fixture', v.transmission,
          v.fuel_type, v.drive, v.seats, v.doors, v.value_class, p_country, 'ACTIVE', 'OPS_CURATED',
          'fixture de test US-124')
  ON CONFLICT ON CONSTRAINT catalog_vehicle_variant_natural_key DO NOTHING;
  SELECT x.id INTO v_id FROM core.catalog_vehicle_variant x
   WHERE x.model_id = v.model_id AND x.trim_name = 'US124 fixture' AND x.market = p_country
     AND x.year_from = 1990 AND x.transmission = v.transmission AND x.fuel_type = v.fuel_type
     AND x.drive = v.drive;
  RETURN v_id;
END
$fn$;

-- État du véhicule (plaque et VIN compris : relecture de test).
CREATE FUNCTION test_fixture.us124_vehicle(p_vehicle uuid)
  RETURNS TABLE (eligibility_status text, eligibility_reasons text[], title_holder text,
                 lien_declared boolean, odometer_km integer, submitted boolean, checked boolean,
                 released boolean, plate text, vin text, org_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.eligibility_status, v.eligibility_reasons, v.title_holder, v.lien_declared,
         v.odometer_km, v.eligibility_submitted_at IS NOT NULL,
         v.eligibility_checked_at IS NOT NULL, v.released_at IS NOT NULL, v.plate, v.vin, v.org_id
    FROM core.catalog_vehicle v WHERE v.id = p_vehicle
$fn$;

-- Pièces d'un véhicule, de la plus ancienne à la plus récente.
CREATE FUNCTION test_fixture.us124_documents(p_vehicle uuid)
  RETURNS TABLE (id uuid, doc_type text, status text, valid_until date, reject_reason text,
                 file_id uuid, reviewed boolean)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.id, d.doc_type, d.status, d.valid_until, d.reject_reason, d.file_id,
         d.reviewed_at IS NOT NULL
    FROM core.catalog_vehicle_document d WHERE d.vehicle_id = p_vehicle
   ORDER BY d.created_at, d.id
$fn$;

-- Contrôles d'éligibilité d'un véhicule, du plus ancien au plus récent.
CREATE FUNCTION test_fixture.us124_checks(p_vehicle uuid)
  RETURNS TABLE (kind text, result text, reasons text[], checklist jsonb, actor_user_id uuid,
                 actor_role text, review_item_id uuid)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.kind, c.result, c.reasons, c.checklist, c.actor_user_id, c.actor_role, c.review_item_id
    FROM core.catalog_vehicle_eligibility_check c WHERE c.vehicle_id = p_vehicle
   ORDER BY c.created_at, c.id
$fn$;

-- Contestations ouvertes par un compte.
CREATE FUNCTION test_fixture.us124_claims(p_org uuid)
  RETURNS TABLE (id uuid, status text, target_vehicle_id uuid, review_item_id uuid,
                 dismiss_reason text, plate text, vin text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.id, c.status, c.target_vehicle_id, c.review_item_id, c.dismiss_reason, c.plate, c.vin
    FROM core.catalog_vehicle_claim c WHERE c.org_id = p_org
   ORDER BY c.created_at, c.id
$fn$;

-- Fichier d'une pièce (seau, classe, clé de chiffrement, source).
CREATE FUNCTION test_fixture.us124_file(p_file uuid)
  RETURNS TABLE (bucket text, classification text, source text, retention_class text,
                 enc_subject_type text, enc_subject_id uuid, uploader_user_id uuid,
                 storage_key text, mime text, bytes bigint)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT f.bucket, f.classification, f.source, f.retention_class, f.enc_subject_type,
         f.enc_subject_id, f.uploader_user_id, f.storage_key, f.mime, f.bytes
    FROM core.audit_file_asset f WHERE f.id = p_file
$fn$;

-- Lignes du journal d'un sujet (texte brut de before / after, pour y chercher plaque et VIN).
CREATE FUNCTION test_fixture.us124_audit(p_subject uuid)
  RETURNS TABLE (action_code text, actor_role text, subject_type text, payload text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.action_code, l.actor_role, l.subject_type,
         COALESCE(l.before::text, '') || ' ' || COALESCE(l.after::text, '') || ' '
           || COALESCE(l.reason, '')
    FROM core.audit_audit_log l WHERE l.subject_id = p_subject
   ORDER BY l.id
$fn$;

-- Nouvelle version d'un paramètre d'éligibilité valable à platform.now(), écrite dans la
-- transaction de l'appelant, qui l'ANNULE ensuite (comme us115_price_ceiling_version) : une valeur
-- JSON nulle prouve le repli fail-closed (clé absente ou mal formée). Clés fermées.
CREATE FUNCTION test_fixture.us124_param_version(p_key text, p_country text, p_value jsonb)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_key NOT IN ('vehicle_financed_requires_lender_consent', 'elig_age_years_ceiling',
                   'elig_odometer_km_ceiling', 'elig_doc_compulsory_insurance') THEN
    RAISE EXCEPTION 'clé hors liste : %', p_key USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, change_reason)
  VALUES (p_key, p_country, 'COUNTRY', p_value, 'test US-124 (annulé)');
END
$fn$;

-- Éléments de la file LISTING d'un sujet (véhicule ou contestation).
CREATE FUNCTION test_fixture.us124_vehicle_items(p_subject uuid)
  RETURNS TABLE (id uuid, queue text, subject_type text, status text, decision text,
                 country_code text)
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT i.id, i.queue, i.subject_type, i.status, i.decision, i.country_code
    FROM core.support_review_queue_item i WHERE i.subject_id = p_subject
   ORDER BY i.created_at, i.id
$fn$;

REVOKE ALL ON FUNCTION test_fixture.us124_variant(text), test_fixture.us124_vehicle(uuid),
  test_fixture.us124_documents(uuid), test_fixture.us124_checks(uuid),
  test_fixture.us124_claims(uuid), test_fixture.us124_file(uuid), test_fixture.us124_audit(uuid),
  test_fixture.us124_param_version(text, text, jsonb), test_fixture.us124_vehicle_items(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us124_variant(text), test_fixture.us124_vehicle(uuid),
  test_fixture.us124_documents(uuid), test_fixture.us124_checks(uuid),
  test_fixture.us124_claims(uuid), test_fixture.us124_file(uuid), test_fixture.us124_audit(uuid),
  test_fixture.us124_param_version(text, text, jsonb), test_fixture.us124_vehicle_items(uuid)
  TO app_api;
