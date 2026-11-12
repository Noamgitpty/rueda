-- 9981 — TEST SEULEMENT : import de la douane au catalogue des véhicules (suite d'US-113,
-- migration 0078, ADR-109). Jamais appliquée hors du harnais (base principale du banc ; la base
-- « production » du banc n'a que les graines de 0063 et 0078).
--
-- 1. Preuves jouées PAR CETTE MIGRATION sous `migrator` : si la base acceptait une ligne fautive,
--    cette migration lèverait une exception et le banc, donc la CI, échouerait.
--    a) une ligne sans fiche d'une source qui DOIT en fournir une (OPS_CURATED, HOST_REQUEST) est
--       refusée (contraintes *_specs_complete) : la v1 et la file d'ajout restent complètes ;
--    b) une ligne de la douane sans licence ou sans source est refusée (NOT NULL, 0063) ;
--    c) une source inconnue est refusée (CHECK élargi de 0078, rien de plus) ;
--    d) une valeur technique invalide reste refusée, même pour la douane (CHECK de 0063 gardés).
-- 2. Fixtures lues par test/l0/l0-us113-customs-import.test.ts et par le test d'intégration de
--    l'API : marque témoin (la preuve a tourné), modèle et variante sans fiche communs aux pays.

DO $proof$
DECLARE
  v_note constant text := 'fixture de test US-113 (douane)';
BEGIN
  INSERT INTO core.catalog_vehicle_make (id, slug, name, source, license_note) VALUES
    ('11300000-0000-4000-8000-000000000d01', 'zz-douane-rejet', 'Rejet', 'OPS_CURATED', v_note);
  -- a) modèle OPS_CURATED sans carrosserie
  BEGIN
    INSERT INTO core.catalog_vehicle_model (id, make_id, slug, name, source, license_note) VALUES
      ('11300000-0000-4000-8000-000000000d11', '11300000-0000-4000-8000-000000000d01',
       'zz-ops-sans-fiche', 'Sans fiche', 'OPS_CURATED', v_note);
    RAISE EXCEPTION 'US-113 : un modèle OPS_CURATED sans fiche a été chargé';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- a) variante HOST_REQUEST sans boîte (modèle complet de la même instruction)
  BEGIN
    INSERT INTO core.catalog_vehicle_model
      (id, make_id, slug, name, body_type, seats_default, doors_default, source, license_note)
    VALUES
      ('11300000-0000-4000-8000-000000000d12', '11300000-0000-4000-8000-000000000d01',
       'zz-hote-complet', 'Complet', 'SEDAN', 5, 4, 'OPS_CURATED', v_note);
    INSERT INTO core.catalog_vehicle_variant
      (id, model_id, year_from, fuel_type, drive, seats, doors, source, license_note)
    VALUES
      ('11300000-0000-4000-8000-000000000d22', '11300000-0000-4000-8000-000000000d12',
       2020, 'GASOLINE', 'FWD', 5, 4, 'HOST_REQUEST', v_note);
    RAISE EXCEPTION 'US-113 : une variante HOST_REQUEST sans boîte a été chargée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- b) ligne de la douane sans licence, puis sans source
  BEGIN
    INSERT INTO core.catalog_vehicle_model (id, make_id, slug, name, source, license_note) VALUES
      ('11300000-0000-4000-8000-000000000d13', '11300000-0000-4000-8000-000000000d01',
       'zz-douane-sans-licence', 'Sans licence', 'DNIT_ADUANAS_PY', NULL);
    RAISE EXCEPTION 'US-113 : une ligne de la douane sans licence a été chargée';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO core.catalog_vehicle_model (id, make_id, slug, name, source, license_note) VALUES
      ('11300000-0000-4000-8000-000000000d14', '11300000-0000-4000-8000-000000000d01',
       'zz-douane-sans-source', 'Sans source', NULL, v_note);
    RAISE EXCEPTION 'US-113 : une ligne de la douane sans source a été chargée';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  -- c) source inconnue
  BEGIN
    INSERT INTO core.catalog_vehicle_model (id, make_id, slug, name, source, license_note) VALUES
      ('11300000-0000-4000-8000-000000000d15', '11300000-0000-4000-8000-000000000d01',
       'zz-source-inconnue', 'Source inconnue', 'DNIT_ADUANAS', v_note);
    RAISE EXCEPTION 'US-113 : une source inconnue a été acceptée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- d) valeur technique invalide, même pour la douane
  BEGIN
    INSERT INTO core.catalog_vehicle_model
      (id, make_id, slug, name, body_type, source, license_note)
    VALUES
      ('11300000-0000-4000-8000-000000000d16', '11300000-0000-4000-8000-000000000d01',
       'zz-douane-carrosserie', 'Carrosserie', 'TRUCK', 'DNIT_ADUANAS_PY', v_note);
    RAISE EXCEPTION 'US-113 : une carrosserie inconnue a été acceptée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle_model
              WHERE make_id = '11300000-0000-4000-8000-000000000d01') THEN
    RAISE EXCEPTION 'US-113 : des lignes d''une instruction refusée sont restées chargées';
  END IF;
  -- témoin : la preuve est allée au bout (retrait par RETIRED, jamais de DELETE)
  UPDATE core.catalog_vehicle_make SET status = 'RETIRED'
   WHERE id = '11300000-0000-4000-8000-000000000d01';
END
$proof$;

-- Fixtures (lues par les tests) : modèle et variante sans fiche, communs aux pays (market nul) ----
INSERT INTO core.catalog_vehicle_make (id, slug, name, status, source, source_ref, license_note)
VALUES
  ('11300000-0000-4000-8000-000000000d02', 'zz-douane-temoin', 'Marque douane de test', 'ACTIVE',
   'DNIT_ADUANAS_PY', 'test 9981', 'fixture de test US-113 (douane)');
INSERT INTO core.catalog_vehicle_model (id, make_id, slug, name, source, source_ref, license_note)
VALUES
  ('11300000-0000-4000-8000-000000000d32', '11300000-0000-4000-8000-000000000d02',
   'zz-douane-sans-fiche', 'Modèle sans fiche', 'DNIT_ADUANAS_PY', 'test 9981',
   'fixture de test US-113 (douane)');
INSERT INTO core.catalog_vehicle_variant
  (id, model_id, year_from, year_to, status, source, source_ref, license_note)
VALUES
  ('11300000-0000-4000-8000-000000000d42', '11300000-0000-4000-8000-000000000d32',
   2005, 2015, 'ACTIVE', 'DNIT_ADUANAS_PY', 'test 9981', 'fixture de test US-113 (douane)');
