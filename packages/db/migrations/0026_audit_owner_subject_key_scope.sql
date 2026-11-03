-- 0026 — AUD : propriétaire dédié du trigger de chaîne et cloisonnement des clés par sujet.
-- US-011 ; reports d'US-009 (passation « Reste » 2, revue sécurité) ; 17 §2.3 (rôles SQL, un
-- propriétaire NOLOGIN par famille), §3.1.3 (clés par sujet) ; ADR-051 ; ADR-053.
-- Appliquée sous `migrator`.
--
-- 1. core.audit_log_chain() (SECURITY DEFINER, trigger BEFORE INSERT) passe de `migrator` à
--    `audit_chain_owner` (NOLOGIN, membre de rien) : il ne lit que l'état de destruction des clés
--    de sujet (verrou FOR SHARE, qui exige un droit UPDATE sur une colonne : la politique UPDATE de
--    ce rôle a WITH CHECK (false), aucune écriture n'aboutit) et lit / avance la tête de chaîne.
-- 2. core.audit_subject_key, lecture et création par app_api : la clé d'un sujet n'est plus
--    accessible à toute session posée, seulement à celle de CE sujet (17 §3.1.3 ; revue sécurité
--    US-009, clé « empoisonnée » pour un sujet tiers) :
--      - USER : le compte de la session (subject_id = app.actor_id()), quel que soit son type ;
--      - ORG  : le compte d'hôte de la session, pour son titulaire seulement (app.is_org_holder) ;
--      - PLATFORM : aucun accès app_api (compte marchand de Kmino : travailleurs seulement).
--    Les travailleurs nommés (app_worker) gardent l'accès de 0021 : ils agissent pour tous les
--    sujets (réception de preuves, vérifications) ; leur nom reste déclaratif (ADR-053 point 7).
--
-- Retour arrière :
--   ALTER FUNCTION core.audit_log_chain() OWNER TO migrator;
--   DROP POLICY audit_chain_read, audit_chain_lock ON core.audit_subject_key;
--   DROP POLICY audit_chain_read, audit_chain_advance ON core.audit_chain_head;
--   REVOKE ALL ON core.audit_subject_key, core.audit_chain_head FROM audit_chain_owner;
--   recréer api_select / api_insert de 0021 (USING / WITH CHECK app.actor_kind() IN (…)).

-- 1. Trigger de chaîne ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA core, platform TO audit_chain_owner;
GRANT EXECUTE ON FUNCTION platform.now() TO audit_chain_owner;
GRANT EXECUTE ON FUNCTION core.audit_canon(text), core.audit_log_canonical(core.audit_audit_log)
  TO audit_chain_owner;

GRANT SELECT (subject_type, subject_id, destroyed_at) ON core.audit_subject_key TO audit_chain_owner;
GRANT UPDATE (destroyed_at) ON core.audit_subject_key TO audit_chain_owner;   -- FOR SHARE seulement
CREATE POLICY audit_chain_read ON core.audit_subject_key FOR SELECT TO audit_chain_owner
  USING (true);
CREATE POLICY audit_chain_lock ON core.audit_subject_key FOR UPDATE TO audit_chain_owner
  USING (true) WITH CHECK (false);                     -- verrou de ligne, jamais une écriture

GRANT SELECT (chain, last_id, last_hash) ON core.audit_chain_head TO audit_chain_owner;
GRANT UPDATE (last_id, last_hash) ON core.audit_chain_head TO audit_chain_owner;
CREATE POLICY audit_chain_read ON core.audit_chain_head FOR SELECT TO audit_chain_owner
  USING (true);
CREATE POLICY audit_chain_advance ON core.audit_chain_head FOR UPDATE TO audit_chain_owner
  USING (chain = 'audit_log') WITH CHECK (chain = 'audit_log');   -- + audit_chain_head_guard

GRANT CREATE ON SCHEMA core TO audit_chain_owner;
ALTER FUNCTION core.audit_log_chain() OWNER TO audit_chain_owner;
REVOKE CREATE ON SCHEMA core FROM audit_chain_owner;

-- 2. Clés par sujet : cloisonnement d'app_api ---------------------------------------------------
DROP POLICY api_select ON core.audit_subject_key;
DROP POLICY api_insert ON core.audit_subject_key;
CREATE POLICY api_select ON core.audit_subject_key FOR SELECT TO app_api
  USING (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF')
         AND ((subject_type = 'USER' AND subject_id = app.actor_id())
              OR (subject_type = 'ORG' AND subject_id = app.org_id() AND app.is_org_holder())));
CREATE POLICY api_insert ON core.audit_subject_key FOR INSERT TO app_api
  WITH CHECK (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF')
              AND ((subject_type = 'USER' AND subject_id = app.actor_id())
                   OR (subject_type = 'ORG' AND subject_id = app.org_id() AND app.is_org_holder())));
