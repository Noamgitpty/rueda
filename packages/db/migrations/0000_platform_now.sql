-- 0000 — schéma `platform`, horloge de la base `platform.now()`, journal des migrations.
-- US-005 ; 17 §1.3 points 1 et 2 bis ; ADR-030. Appliquée sous `migrator`.
--
-- Ce fichier est le SEUL du SQL de production autorisé à lire `clock_timestamp()`
-- (packages/db/sql-clock-allowlist.json). Tout le SQL métier appelle `platform.now()`.
--
-- Retour arrière (à la main, base vide de tout objet dépendant) :
--   DROP TABLE platform.schema_migration; DROP FUNCTION platform.now(); DROP SCHEMA platform;

CREATE SCHEMA platform;  -- propriétaire : migrator (rôle courant)
REVOKE ALL ON SCHEMA platform FROM PUBLIC;

-- Instant réel de l'appel (clock_timestamp), et non le début de la transaction (now()) :
-- après l'attente d'un verrou consultatif, now() serait périmé (17 §1.3 point 1).
-- VOLATILE, jamais STABLE ni IMMUTABLE : le planificateur ne doit pas figer sa valeur dans
-- une instruction (17 §1.3 point 2 bis, L0-06). Une instruction qui veut un instant cohérent
-- le capture une fois : WITH t AS (SELECT platform.now() AS ts) …
CREATE FUNCTION platform.now()
  RETURNS timestamptz
  LANGUAGE sql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.clock_timestamp()
$fn$;

COMMENT ON FUNCTION platform.now() IS
  'Horloge faisant foi (17 §1.3, ADR-030). Production : clock_timestamp(). En test seulement, '
  'packages/db/test-migrations la remplace par une horloge virtuelle.';

REVOKE ALL ON FUNCTION platform.now() FROM PUBLIC;

-- Journal des migrations appliquées, tenu par l'exécuteur (packages/db/src/migrate.ts).
CREATE TABLE platform.schema_migration (
  version    text        PRIMARY KEY CHECK (version ~ '^[0-9]{4}$'),
  name       text        NOT NULL CHECK (name ~ '^[a-z0-9_]+$'),
  checksum   text        NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT platform.now(),
  applied_by name        NOT NULL DEFAULT current_user
);

COMMENT ON TABLE platform.schema_migration IS
  'Migrations appliquées (US-005). Écrit par migrator seulement ; aucun droit pour les rôles applicatifs.';

-- RLS partout, y compris ici (CLAUDE.md point 5) ; migrator est soumis à FORCE (17 §2.3, B9).
ALTER TABLE platform.schema_migration ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.schema_migration FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON platform.schema_migration
  TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON platform.schema_migration FROM PUBLIC;
