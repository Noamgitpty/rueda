-- 0003 — schéma unique de la Bêta pilote `core` et colonnes d'audit des tables mutables.
-- US-006 ; 17 §3.1.1 (Bêta : un schéma unique, tables préfixées par le schéma cible), §3.1.2 ;
-- CONTRIBUTING §9 ; packages/db/schemas.ts (`BETA_SCHEMA`, `betaTableName()`). Appliquée sous `migrator`.
--
-- Retour arrière (base vide de tout objet dépendant) :
--   DROP FUNCTION platform.touch_row(); DROP SCHEMA core;

CREATE SCHEMA core;  -- propriétaire : migrator
REVOKE ALL ON SCHEMA core FROM PUBLIC;
COMMENT ON SCHEMA core IS
  'Bêta pilote (D1) : schéma unique, tables <schéma cible>_<entité de 17> (booking_trip…). '
  'Le passage au schéma par module sera un renommage mécanique (core.booking_trip -> booking.trip).';

-- USAGE seulement : chaque table accorde ensuite le strict nécessaire, rôle par rôle.
-- app_anon n'a rien (vues publiques seulement, US-011) ; les propriétaires NOLOGIN des commandes
-- reçoivent leurs droits avec leurs commandes (cmd_hold_owner : US-023).
GRANT USAGE ON SCHEMA core TO app_api, app_worker;

-- Colonnes d'audit des tables mutables (17 §3.1.2) : updated_at à l'horloge de la base et
-- row_version (verrou optimiste) incrémenté à chaque mise à jour, quel que soit l'écrivain.
CREATE FUNCTION platform.touch_row()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  NEW.updated_at := platform.now();
  NEW.row_version := OLD.row_version + 1;
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION platform.touch_row() IS
  'Trigger BEFORE UPDATE : updated_at = platform.now(), row_version + 1 (17 §3.1.2). US-006.';
REVOKE ALL ON FUNCTION platform.touch_row() FROM PUBLIC;
