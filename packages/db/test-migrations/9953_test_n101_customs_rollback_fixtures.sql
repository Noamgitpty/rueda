-- 9953 — TEST SEULEMENT : catalogue de la douane partagé et retour arrière de l'import (N-101,
-- migrations 0095 et 0096 ; ADR-123, ADR-109). Jamais appliquée hors du harnais (base principale
-- du banc). Jouée après toutes les migrations de production, avant les autres fixtures (9981…).
--
-- Preuves jouées PAR CETTE MIGRATION sous `migrator` : si l'une échoue, la migration lève une
-- exception et le banc, donc la CI, échoue.
--   a) 0095 a joué : aucune variante de la douane ne garde un marché ; 0096 a joué : JMC Vigor ;
--   b) retour arrière de l'import (revue architecture US-113 n° 2) : toutes les lignes de la
--      douane se retirent par `status = 'RETIRED'` (plus aucune ACTIVE) ; DELETE reste refusé
--      (garde de 0063) ; les `NOT NULL` de 0063 NE SE RÉTABLISSENT PAS tant que des lignes sans
--      fiche existent, même retirées : la contraction exige d'abord de compléter leur fiche (ou une
--      dérogation revue), ce qu'écrit ADR-123 ;
--   c) le retrait simulé est annulé (sous-transaction) : la base du banc garde l'import ACTIVE.
-- Témoin lu par test/l0/l0-n101-catalogue-pa.test.ts : marque `zz-n101-temoin` (RETIRED), écrite
-- seulement si toutes les preuves ont tenu.

DO $proof$
DECLARE
  v_variants integer;
  v_models   integer;
BEGIN
  -- a) 0095 et 0096
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle_variant
              WHERE source = 'DNIT_ADUANAS_PY' AND market IS NOT NULL) THEN
    RAISE EXCEPTION 'N-101 : une variante de la douane garde un marché (0095 n''a pas joué)';
  END IF;
  SELECT count(*) INTO v_variants FROM core.catalog_vehicle_variant
   WHERE source = 'DNIT_ADUANAS_PY' AND status = 'ACTIVE';
  SELECT count(*) INTO v_models FROM core.catalog_vehicle_model
   WHERE source = 'DNIT_ADUANAS_PY' AND status = 'ACTIVE';
  IF v_variants < 600 OR v_models < 600 THEN
    RAISE EXCEPTION 'N-101 : import de la douane absent (% variantes, % modèles)',
      v_variants, v_models;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.catalog_vehicle_model o
                   JOIN core.catalog_vehicle_make m ON m.id = o.make_id
                   JOIN core.catalog_vehicle_variant v ON v.model_id = o.id
                  WHERE m.slug = 'jmc' AND o.slug = 'vigor' AND v.market IS NULL
                    AND v.status = 'ACTIVE' AND v.source = 'DNIT_ADUANAS_PY') THEN
    RAISE EXCEPTION 'N-101 : JMC Vigor (0096) absent ou réservé à un pays';
  END IF;

  -- b) retour arrière simulé, annulé à la fin du bloc
  BEGIN
    UPDATE core.catalog_vehicle_variant SET status = 'RETIRED' WHERE source = 'DNIT_ADUANAS_PY';
    UPDATE core.catalog_vehicle_model SET status = 'RETIRED' WHERE source = 'DNIT_ADUANAS_PY';
    UPDATE core.catalog_vehicle_make SET status = 'RETIRED' WHERE source = 'DNIT_ADUANAS_PY';
    IF EXISTS (SELECT 1 FROM core.catalog_vehicle_variant
                WHERE source = 'DNIT_ADUANAS_PY' AND status = 'ACTIVE') THEN
      RAISE EXCEPTION 'N-101 : une variante de la douane reste ACTIVE après le retrait';
    END IF;
    -- DELETE refusé (garde de 0063)
    BEGIN
      DELETE FROM core.catalog_vehicle_variant WHERE source = 'DNIT_ADUANAS_PY';
      RAISE EXCEPTION 'N-101 : DELETE d''une variante de la douane accepté';
    EXCEPTION WHEN integrity_constraint_violation THEN NULL;
    END;
    -- NOT NULL de 0063 : impossible à rétablir avec des lignes sans fiche, même retirées
    BEGIN
      ALTER TABLE core.catalog_vehicle_variant ALTER COLUMN transmission SET NOT NULL;
      RAISE EXCEPTION 'N-101 : NOT NULL de la boîte rétabli malgré des lignes sans fiche';
    EXCEPTION WHEN not_null_violation THEN NULL;
    END;
    BEGIN
      ALTER TABLE core.catalog_vehicle_model ALTER COLUMN body_type SET NOT NULL;
      RAISE EXCEPTION 'N-101 : NOT NULL de la carrosserie rétabli malgré des lignes sans fiche';
    EXCEPTION WHEN not_null_violation THEN NULL;
    END;
    -- c) annule le retrait simulé
    RAISE EXCEPTION USING ERRCODE = 'N1010', MESSAGE = 'N-101 : retrait simulé annulé';
  EXCEPTION WHEN SQLSTATE 'N1010' THEN NULL;
  END;

  IF (SELECT count(*) FROM core.catalog_vehicle_variant
       WHERE source = 'DNIT_ADUANAS_PY' AND status = 'ACTIVE') <> v_variants THEN
    RAISE EXCEPTION 'N-101 : le retrait simulé n''a pas été annulé';
  END IF;

  -- témoin : toutes les preuves ont tenu
  INSERT INTO core.catalog_vehicle_make (id, slug, name, status, source, source_ref, license_note)
  VALUES ('a1010000-0000-4000-8000-000000009953', 'zz-n101-temoin', 'Témoin N-101', 'RETIRED',
          'OPS_CURATED', 'test 9953', 'fixture de test N-101 (douane)');
END
$proof$;
