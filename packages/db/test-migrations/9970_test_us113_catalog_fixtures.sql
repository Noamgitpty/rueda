-- 9970 — TEST SEULEMENT : catalogue de référence des véhicules (US-113, migration 0063).
-- Jamais appliquée hors du harnais (base principale du banc ; la base « production » du banc n'a
-- que la graine de 0063).
--
-- 1. Preuves du critère 1 (19 US-113), jouées PAR CETTE MIGRATION sous `migrator` : une instruction
--    de graine dont UNE ligne n'a pas de licence (NULL ou blanc) ou pas de source échoue en entier,
--    aucune de ses lignes n'est chargée. Si la base acceptait la ligne, cette migration lèverait une
--    exception : le banc, donc la CI, échouerait. Même chose pour une consommation sans source et
--    pour un DELETE ou un TRUNCATE (retrait par RETIRED seulement).
-- 2. Fixtures lues par test/l0/l0-us113-vehicle-catalog.test.ts et par le test d'intégration de
--    l'API : marque témoin RETIRED (la preuve a tourné), variante à consommation EPA, variante
--    retirée, marque en attente de revue (invisible pour app_api).

DO $proof$
DECLARE
  v_note constant text := 'fixture de test US-113';
BEGIN
  -- a) licence NULL sur une ligne sur deux : l'instruction entière est refusée
  BEGIN
    INSERT INTO core.catalog_vehicle_make (id, slug, name, source, license_note) VALUES
      ('11300000-0000-4000-8000-000000000a01', 'zz-us113-rejet-valide', 'Valide', 'OPS_CURATED', v_note),
      ('11300000-0000-4000-8000-000000000a02', 'zz-us113-rejet-sans-licence', 'Sans licence', 'OPS_CURATED', NULL);
    RAISE EXCEPTION 'US-113 : une ligne de graine sans license_note a été chargée';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  -- b) licence blanche
  BEGIN
    INSERT INTO core.catalog_vehicle_make (id, slug, name, source, license_note) VALUES
      ('11300000-0000-4000-8000-000000000a03', 'zz-us113-rejet-blanc', 'Blanc', 'OPS_CURATED', '   ');
    RAISE EXCEPTION 'US-113 : une ligne de graine à license_note blanche a été chargée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- c) source absente (modèle d'une marque valide de la même instruction)
  BEGIN
    INSERT INTO core.catalog_vehicle_make (id, slug, name, source, license_note) VALUES
      ('11300000-0000-4000-8000-000000000a04', 'zz-us113-rejet-parent', 'Parent', 'OPS_CURATED', v_note);
    INSERT INTO core.catalog_vehicle_model
      (id, make_id, slug, name, body_type, seats_default, doors_default, source, license_note)
    VALUES
      ('11300000-0000-4000-8000-000000000b04', '11300000-0000-4000-8000-000000000a04',
       'zz-sans-source', 'Sans source', 'SEDAN', 5, 4, NULL, v_note);
    RAISE EXCEPTION 'US-113 : une ligne de graine sans source a été chargée';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  -- d) licence NULL sur une variante
  BEGIN
    INSERT INTO core.catalog_vehicle_make (id, slug, name, source, license_note) VALUES
      ('11300000-0000-4000-8000-000000000a05', 'zz-us113-rejet-variante', 'Variante', 'OPS_CURATED', v_note);
    INSERT INTO core.catalog_vehicle_model
      (id, make_id, slug, name, body_type, seats_default, doors_default, source, license_note)
    VALUES
      ('11300000-0000-4000-8000-000000000b05', '11300000-0000-4000-8000-000000000a05',
       'zz-modele', 'Modèle', 'SEDAN', 5, 4, 'OPS_CURATED', v_note);
    INSERT INTO core.catalog_vehicle_variant
      (id, model_id, year_from, transmission, fuel_type, drive, seats, doors, source, license_note)
    VALUES
      ('11300000-0000-4000-8000-000000000c05', '11300000-0000-4000-8000-000000000b05',
       2020, 'AT', 'GASOLINE', 'FWD', 5, 4, 'OPS_CURATED', NULL);
    RAISE EXCEPTION 'US-113 : une variante sans license_note a été chargée';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle_make WHERE slug LIKE 'zz-us113-rejet-%') THEN
    RAISE EXCEPTION 'US-113 : des lignes d''une instruction refusée sont restées chargées';
  END IF;
END
$proof$;

-- Fixtures (lues par les tests) -----------------------------------------------------------------
INSERT INTO core.catalog_vehicle_make (id, slug, name, status, source, source_ref, license_note) VALUES
  ('11300000-0000-4000-8000-000000000001', 'zz-us113-preuve', 'Témoin de la preuve', 'RETIRED',
   'OPS_CURATED', 'test 9970', 'fixture de test US-113'),
  ('11300000-0000-4000-8000-000000000002', 'zz-us113-epa', 'Marque EPA de test', 'ACTIVE',
   'OPS_CURATED', 'test 9970', 'fixture de test US-113'),
  ('11300000-0000-4000-8000-000000000003', 'zz-us113-retiree', 'Marque à variante retirée', 'ACTIVE',
   'OPS_CURATED', 'test 9970', 'fixture de test US-113'),
  ('11300000-0000-4000-8000-000000000004', 'zz-us113-attente', 'Marque en attente', 'PENDING_REVIEW',
   'OPS_CURATED', 'test 9970', 'fixture de test US-113');

INSERT INTO core.catalog_vehicle_model
  (id, make_id, slug, name, body_type, seats_default, doors_default, source, license_note)
VALUES
  ('11300000-0000-4000-8000-000000000102', '11300000-0000-4000-8000-000000000002',
   'zz-modele-epa', 'Modèle EPA', 'SEDAN', 5, 4, 'OPS_CURATED', 'fixture de test US-113'),
  ('11300000-0000-4000-8000-000000000103', '11300000-0000-4000-8000-000000000003',
   'zz-modele-retire', 'Modèle à variante retirée', 'HATCHBACK', 5, 5, 'OPS_CURATED',
   'fixture de test US-113');

INSERT INTO core.catalog_vehicle_variant
  (id, model_id, year_from, transmission, fuel_type, drive, consumption_l_100km,
   consumption_source, seats, doors, status, source, license_note)
VALUES
  ('11300000-0000-4000-8000-000000000202', '11300000-0000-4000-8000-000000000102',
   2019, 'CVT', 'HYBRID', 'FWD', 4.2, 'EPA_US_REFERENCE', 5, 4, 'ACTIVE', 'OPS_CURATED',
   'fixture de test US-113'),
  ('11300000-0000-4000-8000-000000000203', '11300000-0000-4000-8000-000000000103',
   2012, 'MT', 'GASOLINE', 'FWD', NULL, NULL, 5, 5, 'RETIRED', 'OPS_CURATED',
   'fixture de test US-113');

-- e) consommation sans source, DELETE et TRUNCATE refusés (après les fixtures)
DO $guards$
BEGIN
  BEGIN
    UPDATE core.catalog_vehicle_variant SET consumption_source = NULL
     WHERE id = '11300000-0000-4000-8000-000000000202';
    RAISE EXCEPTION 'US-113 : une consommation sans source a été acceptée';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM core.catalog_vehicle_variant WHERE id = '11300000-0000-4000-8000-000000000203';
    RAISE EXCEPTION 'US-113 : une variante a été supprimée (retrait par RETIRED seulement)';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
  BEGIN
    TRUNCATE core.catalog_vehicle_variant;
    RAISE EXCEPTION 'US-113 : TRUNCATE du catalogue accepté';
  EXCEPTION WHEN integrity_constraint_violation THEN NULL;
  END;
END
$guards$;
