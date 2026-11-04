-- 0050 — Environnement de déploiement DÉCLARÉ (US-003, ADR-078 ; 17 §6.5 point 1, C19).
-- Reports d'US-025 et d'US-043 : `platform.deployment_env()` ne rend jamais NULL, et ne dépend plus
-- d'une constante figée par migration.
--
-- Avant : 0028 définissait `platform.deployment_env()` comme la constante « production ». Une base de
-- préproduction ne pouvait donc pas se déclarer autrement sans remplacer la fonction hors migration
-- (c'est ce que fait la surcouche de développement d'US-035).
--
-- Maintenant :
--   1. `platform.environment_declaration` : une ligne au plus (singleton), écrite UNE FOIS par le
--      job de déploiement sous `migrator` (`platform.declare_environment`), jamais modifiée ni
--      effacée (trigger), illisible et non modifiable par les rôles applicatifs (aucun droit).
--      Changer d'environnement = une autre base. Une base de production ne peut donc jamais devenir
--      une base de préproduction (où les gardes FAKE de la base s'ouvrent pour les comptes SANDBOX).
--   2. `platform.declared_environment()` : lecture de la déclaration, SECURITY DEFINER sous
--      `guard_owner` (le seul rôle qui lit la table), NULL si rien n'est déclaré.
--   3. `platform.deployment_env()` = `COALESCE(platform.declared_environment(), 'production')` :
--      base non déclarée ⇒ « production » (fail-closed), jamais NULL. Propriétaire, droits EXECUTE
--      et caractère STABLE inchangés (CREATE OR REPLACE) ; les gardes de 0048 gardent leur COALESCE.
--
-- Valeurs admises : development (surcouche locale d'US-035), preproduction, production. « test »
-- n'est jamais déclaré : les bases du banc remplacent la fonction (test-migrations/9500).
--
-- `migrator` n'a pas EXECUTE sur `platform.declared_environment()` (membre de guard_owner sans
-- héritage) : une future migration qui écrirait un compte PSP sous migrator déclencherait la garde
-- FAKE, donc `deployment_env()`, et échouerait (fail-closed, bruyant). Le job de déploiement relit
-- la déclaration sous `app_api` (packages/db/src/deploy/).
--
-- Retour arrière (expand / contract : rien ne lit encore la table hors de cette migration) :
--   CREATE OR REPLACE FUNCTION platform.deployment_env() … SELECT 'production'::text (0028) ;
--   DROP FUNCTION platform.declare_environment(text), platform.declared_environment() ;
--   DROP TABLE platform.environment_declaration ;
--   DROP FUNCTION platform.environment_declaration_immutable().

-- 1. Déclaration ----------------------------------------------------------------------------------
CREATE TABLE platform.environment_declaration (
  singleton   boolean     PRIMARY KEY DEFAULT true CHECK (singleton),
  environment text        NOT NULL
              CHECK (environment IN ('development', 'preproduction', 'production')),
  declared_at timestamptz NOT NULL DEFAULT platform.now(),
  declared_by text        NOT NULL DEFAULT current_user
);

COMMENT ON TABLE platform.environment_declaration IS
  'Environnement de déploiement de la base (US-003, ADR-078) : une ligne, écrite une fois sous '
  'migrator par platform.declare_environment, jamais modifiée ; absente ⇒ production.';

ALTER TABLE platform.environment_declaration ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.environment_declaration FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.environment_declaration FROM PUBLIC;
GRANT SELECT ON platform.environment_declaration TO guard_owner;
CREATE POLICY migrator_read ON platform.environment_declaration
  FOR SELECT TO migrator USING (true);
CREATE POLICY migrator_declare ON platform.environment_declaration
  FOR INSERT TO migrator WITH CHECK (true);
CREATE POLICY guard_read ON platform.environment_declaration
  FOR SELECT TO guard_owner USING (true);
-- Ces deux politiques rendent la ligne VISIBLE à un UPDATE ou un DELETE de migrator, pour que le
-- trigger ci-dessous le refuse explicitement (sans elles, la commande ne verrait aucune ligne et
-- réussirait sans rien faire, ce qui masquerait la tentative).
CREATE POLICY migrator_update_refused ON platform.environment_declaration
  FOR UPDATE TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_delete_refused ON platform.environment_declaration
  FOR DELETE TO migrator USING (true);

-- Aucune modification ni suppression, même par le propriétaire (TRUNCATE ignore la RLS : trigger).
CREATE FUNCTION platform.environment_declaration_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'environment declaration is immutable (US-003): % refused', TG_OP
    USING ERRCODE = 'object_not_in_prerequisite_state',
          CONSTRAINT = 'environment_declared_once';
END
$fn$;

REVOKE ALL ON FUNCTION platform.environment_declaration_immutable() FROM PUBLIC;

CREATE TRIGGER environment_declaration_no_update
  BEFORE UPDATE OR DELETE ON platform.environment_declaration
  FOR EACH ROW EXECUTE FUNCTION platform.environment_declaration_immutable();
CREATE TRIGGER environment_declaration_no_truncate
  BEFORE TRUNCATE ON platform.environment_declaration
  FOR EACH STATEMENT EXECUTE FUNCTION platform.environment_declaration_immutable();

-- 2. Lecture de la déclaration (garde) -------------------------------------------------------------
CREATE FUNCTION platform.declared_environment()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT d.environment FROM platform.environment_declaration AS d WHERE d.singleton
$fn$;

COMMENT ON FUNCTION platform.declared_environment() IS
  'Environnement déclaré de la base, NULL si aucun (US-003). Lu seulement par platform.deployment_env().';

-- propriétaire NOLOGIN (RLS-15) : il lui faut CREATE sur le schéma le temps du transfert (comme 0037)
GRANT CREATE ON SCHEMA platform TO guard_owner;
ALTER FUNCTION platform.declared_environment() OWNER TO guard_owner;
REVOKE CREATE ON SCHEMA platform FROM guard_owner;
REVOKE ALL ON FUNCTION platform.declared_environment() FROM PUBLIC;
-- les rôles qui exécutent platform.deployment_env() (0028, 0040) : fonction SECURITY INVOKER
GRANT EXECUTE ON FUNCTION platform.declared_environment()
  TO app_api, app_worker, cmd_money_owner, cmd_hold_owner;

-- 3. Environnement de déploiement : jamais NULL ---------------------------------------------------
CREATE OR REPLACE FUNCTION platform.deployment_env()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(platform.declared_environment(), 'production')
$fn$;

COMMENT ON FUNCTION platform.deployment_env() IS
  'Environnement de déploiement de la base (17 §6.5) : déclaration de platform.environment_declaration, '
  'production si aucune (fail-closed, jamais NULL ; US-003). En test : test-migrations/9500.';

-- 4. Déclaration par le job de déploiement (migrator seulement) ------------------------------------
-- Idempotente pour la même valeur ; toute autre valeur est refusée une fois la base déclarée.
CREATE FUNCTION platform.declare_environment(p_environment text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_current text;
BEGIN
  IF p_environment IS NULL
     OR p_environment NOT IN ('development', 'preproduction', 'production') THEN
    RAISE EXCEPTION 'environment declaration: unknown environment'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  INSERT INTO platform.environment_declaration (environment) VALUES (p_environment)
  ON CONFLICT (singleton) DO NOTHING;
  SELECT d.environment INTO v_current FROM platform.environment_declaration AS d WHERE d.singleton;
  IF v_current IS DISTINCT FROM p_environment THEN
    RAISE EXCEPTION 'environment declaration: database already declared %', v_current
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'environment_declared_once';
  END IF;
  RETURN v_current;
END
$fn$;

COMMENT ON FUNCTION platform.declare_environment(text) IS
  'Déclare l''environnement de la base, une fois (US-003) : job de déploiement sous migrator.';

REVOKE ALL ON FUNCTION platform.declare_environment(text) FROM PUBLIC;
