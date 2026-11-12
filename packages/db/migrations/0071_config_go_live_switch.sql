-- 0071 — CFG : interrupteurs de mise en service par pays, changés seulement par deux personnes.
-- US-125 ; 19 US-125 ; 17 §0.1 (interrupteurs), §2.3 (commandes `cmd_request_go_live_switch` /
-- `cmd_approve_go_live_switch`, propriétaire `cmd_golive_owner`, trigger
-- `param_value_go_live_guard`, RLS-27), §7.2 ; ADR-046 (mécanisme PROPOSÉ) ; DEC-FONDATEUR-15 ;
-- réserve 5 de la revue sécurité US-056 (l'identité ne vient jamais d'un réglage de session) ;
-- ADR-101 (PROPOSÉ). Appliquée sous `migrator`.
--
-- Bêta (D1) : schéma unique `core`, préfixe `config_` (`config.go_live_switch_request` →
-- `core.config_go_live_switch_request`, `config.cmd_*` → `core.config_cmd_*`).
--
-- Principes :
--   - clés gardées = définitions `go_live_switch` (drapeau de 0008, aucune liste en dur) ;
--   - trigger `param_value_go_live_guard` (tous rôles) : sur une clé gardée, quelle que soit la
--     casse de la clé, DELETE et UPDATE sont refusés (42501 ; fermer = nouvelle version à false par
--     la même procédure) ; INSERT seulement (a) par `migrator`, à false, sans demande (graines), ou
--     (b) par `cmd_golive_owner`, en recopiant une demande APPLIQUÉE, approuvée par une seconde
--     personne, jamais encore utilisée. TRUNCATE reste refusé par 0008 ; COPY passe par les
--     triggers de ligne. La garde de 0008 appelle la même règle EN PREMIER (ses propres refus,
--     clé inconnue par exemple, ne la masquent jamais) ;
--   - forme d'appel d'ADR-056 / ADR-062 (mécanique des décisions FINANCE de 0036) : l'identité
--     vient de la SESSION désignée par l'empreinte de son jeton, niveau TOTP, jamais d'un réglage
--     `app.*` ni d'un paramètre ; demandeur ≠ approbateur, même dans une seconde session de la
--     même personne (`CHECK (approved_by <> requested_by)`) ;
--   - demande : ADMIN ou SUPERADMIN avec `config.go_live_switch` dans le pays, référence d'une
--     décision écrite du fondateur (`DEC-FONDATEUR-n`, docs/team/DECISIONS.md) ; approbation :
--     SUPERADMIN AUTRE que le demandeur, dans le pays ; le demandeur doit encore détenir la
--     permission ; une demande expire 72 h après sa création (PROPOSÉ, ADR-101) ;
--   - effet dans la transaction de l'approbation : demande APPLIED, nouvelle version de
--     `config_param_value` (valid_from = platform.now()), événement `config.param.changed`,
--     audit en dernier ; refus (auto-approbation, expiration, demandeur sans droit) journalisés ;
--   - AUCUNE valeur n'est écrite ici : tous les interrupteurs restent à false (graine 0009). Second
--     approbateur humain non désigné (19 F-16) : aucune approbation possible en production.
--
-- Retour arrière (base sans dépendance) :
--   DROP FUNCTION core.config_cmd_request_go_live_switch(bytea, uuid, text, text, boolean, text),
--     core.config_cmd_approve_go_live_switch(bytea, uuid);
--   DROP TRIGGER param_value_go_live_guard ON core.config_param_value;
--   CREATE OR REPLACE FUNCTION core.config_param_value_guard() … corps de 0008 ;
--   DROP FUNCTION core.config_param_value_go_live_guard(), core.config_go_live_write_refusal(text,
--     text, text, jsonb, uuid, uuid, text), core.config_go_live_request_guard();
--   ALTER TABLE core.config_param_value DROP COLUMN go_live_request_id;
--   DROP TABLE core.config_go_live_switch_request;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-125%';
--   DROP POLICY cmd_golive_* (tables ci-dessous) ; révoquer les droits de cmd_golive_owner.

-- 1. Permission de la matrice (17 §2.3 : ADMIN « lim. (demande) », SUPERADMIN « demande ou
--    approbation, jamais les deux ») -------------------------------------------------------------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('ADMIN',      'config.go_live_switch', 'PLATFORM', '2026-11-03T00:00:00Z',
   'US-125 : matrice 17 §2.3 (lim. : demande seulement)'),
  ('SUPERADMIN', 'config.go_live_switch', 'PLATFORM', '2026-11-03T00:00:00Z',
   'US-125 : matrice 17 §2.3 (demande ou approbation, jamais les deux)');

-- 2. Demandes à deux personnes (17 §2.3 config.go_live_switch_request) ---------------------------
CREATE TABLE core.config_go_live_switch_request (
  id            uuid        PRIMARY KEY,                       -- = identifiant de la demande
  key           text        NOT NULL REFERENCES core.config_param_definition (key),
  country_code  char(2)     NOT NULL REFERENCES core.config_country (code),
  value         boolean     NOT NULL,
  -- référence de la décision écrite du fondateur (docs/team/DECISIONS.md)
  decision_ref  text        NOT NULL
    CONSTRAINT go_live_request_decision_ref_format CHECK (decision_ref ~ '^DEC-FONDATEUR-[0-9]{1,4}$'),
  requested_by  uuid        NOT NULL,                          -- = personne de la session
  requested_at  timestamptz NOT NULL DEFAULT platform.now(),
  expires_at    timestamptz NOT NULL,
  approved_by   uuid,                                          -- = seconde personne
  approved_at   timestamptz,
  status        text        NOT NULL
    CONSTRAINT go_live_request_status_valid CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT go_live_request_expiry CHECK (expires_at > requested_at),
  CONSTRAINT go_live_request_two_people CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT go_live_request_applied_shape CHECK ((status = 'APPLIED') = (approved_by IS NOT NULL)),
  CONSTRAINT go_live_request_approved_at CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE UNIQUE INDEX go_live_request_one_pending ON core.config_go_live_switch_request (key, country_code)
  WHERE (status = 'PENDING');
COMMENT ON TABLE core.config_go_live_switch_request IS
  'CFG go_live_switch_request (17 §2.3) : demande puis approbation par deux personnes distinctes '
  'd''un interrupteur de mise en service par pays. US-125.';

-- Identité figée ; seule une demande PENDING change d'état (vers APPLIED, REJECTED ou EXPIRED) ;
-- ni suppression ni TRUNCATE (registre de décision).
CREATE FUNCTION core.config_go_live_request_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'PENDING' AND NEW.status IN ('APPLIED', 'REJECTED', 'EXPIRED')
     AND (NEW.id, NEW.key, NEW.country_code, NEW.value, NEW.decision_ref, NEW.requested_by,
          NEW.requested_at, NEW.expires_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.key, OLD.country_code, OLD.value, OLD.decision_ref, OLD.requested_by,
          OLD.requested_at, OLD.expires_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'go_live_switch_request : identité figée, seule une demande PENDING change d''état'
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'go_live_request_guarded';
END
$fn$;
REVOKE ALL ON FUNCTION core.config_go_live_request_guard() FROM PUBLIC;
CREATE TRIGGER go_live_request_guard BEFORE UPDATE OR DELETE ON core.config_go_live_switch_request
  FOR EACH ROW EXECUTE FUNCTION core.config_go_live_request_guard();
CREATE TRIGGER go_live_request_no_truncate BEFORE TRUNCATE ON core.config_go_live_switch_request
  FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate();

ALTER TABLE core.config_go_live_switch_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.config_go_live_switch_request FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.config_go_live_switch_request TO migrator USING (true) WITH CHECK (true);
-- aucun droit pour app_api, app_worker ni app_anon : demandes et issues passent par les commandes
REVOKE ALL ON core.config_go_live_switch_request FROM PUBLIC;

-- 3. Lien de la version de paramètre vers sa demande (expansion : colonne facultative) ----------
ALTER TABLE core.config_param_value
  ADD COLUMN go_live_request_id uuid REFERENCES core.config_go_live_switch_request (id);
COMMENT ON COLUMN core.config_param_value.go_live_request_id IS
  'Demande APPLIED (deux personnes) dont la version d''un interrupteur est la recopie ; NULL pour '
  'toute autre clé et pour les graines à false. US-125.';

-- 4. Règle d'écriture des clés gardées (RLS-27) -------------------------------------------------
-- Rend NULL si l'écriture est permise, sinon le motif du refus. SECURITY INVOKER : lit sous les
-- droits de l'écrivain (migrator, cmd_golive_owner ; un rôle qui ne peut pas lire la configuration
-- échoue, donc refuse). La clé est comparée en minuscules, sans blancs : `P2P_…` reste gardée.
CREATE FUNCTION core.config_go_live_write_refusal(p_op text, p_key text, p_old_key text,
                                                  p_value jsonb, p_request_id uuid,
                                                  p_approved_by uuid, p_decision_ref text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guarded boolean;
  v_r       record;
BEGIN
  SELECT pg_catalog.bool_or(d.go_live_switch) INTO v_guarded
    FROM core.config_param_definition AS d
   WHERE d.key = ANY (ARRAY[pg_catalog.lower(pg_catalog.btrim(p_key)),
                            pg_catalog.lower(pg_catalog.btrim(p_old_key))]);
  IF v_guarded IS NOT TRUE THEN
    RETURN NULL;
  END IF;
  IF p_op = 'DELETE' THEN
    RETURN 'interrupteur : suppression interdite (fermer = nouvelle version à false)';
  END IF;
  IF p_op <> 'INSERT' THEN
    RETURN 'interrupteur : modification interdite (nouvelle version par la procédure à deux personnes)';
  END IF;
  -- (a) graine à false par migrator, sans demande
  IF current_user = 'migrator' THEN
    IF p_value = 'false'::jsonb AND p_request_id IS NULL AND p_key = pg_catalog.lower(p_key) THEN
      RETURN NULL;
    END IF;
    RETURN 'interrupteur : migrator n''écrit que des graines à false';
  END IF;
  -- (b) recopie d'une demande APPLIED, approuvée par une seconde personne, utilisée une fois
  IF current_user = 'cmd_golive_owner' AND p_request_id IS NOT NULL THEN
    SELECT r.key, r.value, r.status, r.requested_by, r.approved_by, r.decision_ref INTO v_r
      FROM core.config_go_live_switch_request AS r WHERE r.id = p_request_id;
    IF v_r.status = 'APPLIED' AND v_r.key = p_key AND pg_catalog.to_jsonb(v_r.value) = p_value
       AND v_r.approved_by IS NOT NULL AND v_r.approved_by <> v_r.requested_by
       AND v_r.approved_by IS NOT DISTINCT FROM p_approved_by
       AND v_r.decision_ref IS NOT DISTINCT FROM p_decision_ref
       AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                        WHERE v.go_live_request_id = p_request_id) THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN 'interrupteur de mise en service : procédure à deux personnes seulement (RLS-27)';
END
$fn$;
REVOKE ALL ON FUNCTION core.config_go_live_write_refusal(text, text, text, jsonb, uuid, uuid, text)
  FROM PUBLIC;
-- appelée par les triggers sous le rôle de l'écrivain : app_worker n'écrit la table que sur la base
-- de TEST (9100) ; sans ce droit, son refus serait « permission denied » au lieu de la garde
GRANT EXECUTE ON FUNCTION core.config_go_live_write_refusal(text, text, text, jsonb, uuid, uuid, text)
  TO app_api, app_worker, cmd_golive_owner;

CREATE FUNCTION core.config_param_value_go_live_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_why text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_why := core.config_go_live_write_refusal('DELETE', OLD.key, OLD.key, NULL, NULL, NULL, NULL);
  ELSIF TG_OP = 'UPDATE' THEN
    v_why := core.config_go_live_write_refusal('UPDATE', NEW.key, OLD.key, NEW.value,
                                               NEW.go_live_request_id, NEW.approved_by,
                                               NEW.decision_ref);
  ELSE
    v_why := core.config_go_live_write_refusal('INSERT', NEW.key, NULL, NEW.value,
                                               NEW.go_live_request_id, NEW.approved_by,
                                               NEW.decision_ref);
  END IF;
  IF v_why IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege', DETAIL = v_why,
      CONSTRAINT = 'param_value_go_live_guard';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.config_param_value_go_live_guard() FROM PUBLIC;

CREATE TRIGGER param_value_go_live_guard
  BEFORE INSERT OR UPDATE OR DELETE ON core.config_param_value
  FOR EACH ROW EXECUTE FUNCTION core.config_param_value_go_live_guard();

-- Garde de 0008 : la règle des interrupteurs passe EN PREMIER (avant « clé inconnue » ou
-- « immuable »), le refus « autre que false » de 0008 est remplacé par la règle à deux personnes,
-- et la nouvelle colonne entre dans l'immuabilité. Le reste est inchangé.
CREATE OR REPLACE FUNCTION core.config_param_value_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz := platform.now();
  v_def  core.config_param_definition%ROWTYPE;
  v_cur  char(3);
  v_type text;
  v_why  text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_why := core.config_go_live_write_refusal('DELETE', OLD.key, OLD.key, NULL, NULL, NULL, NULL);
  ELSIF TG_OP = 'UPDATE' THEN
    v_why := core.config_go_live_write_refusal('UPDATE', NEW.key, OLD.key, NEW.value,
                                               NEW.go_live_request_id, NEW.approved_by,
                                               NEW.decision_ref);
  ELSE
    v_why := core.config_go_live_write_refusal('INSERT', NEW.key, NULL, NEW.value,
                                               NEW.go_live_request_id, NEW.approved_by,
                                               NEW.decision_ref);
  END IF;
  IF v_why IS NOT NULL THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege', DETAIL = v_why,
      CONSTRAINT = 'param_value_go_live_guard';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PARAM_IMMUTABLE' USING ERRCODE = 'check_violation',
      DETAIL = 'une valeur de paramètre ne se supprime pas : fermer par valid_to (17 §3.1, classe C)';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.key, NEW.country_code, NEW.scope_type, NEW.scope_id, NEW.network, NEW.currency,
        NEW.value, NEW.valid_from, NEW.approved_by, NEW.decision_ref, NEW.change_reason,
        NEW.created_at, NEW.created_by, NEW.go_live_request_id)
       IS DISTINCT FROM
       (OLD.id, OLD.key, OLD.country_code, OLD.scope_type, OLD.scope_id, OLD.network, OLD.currency,
        OLD.value, OLD.valid_from, OLD.approved_by, OLD.decision_ref, OLD.change_reason,
        OLD.created_at, OLD.created_by, OLD.go_live_request_id)
       OR OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL THEN
      RAISE EXCEPTION 'PARAM_IMMUTABLE' USING ERRCODE = 'check_violation',
        DETAIL = 'seule la fermeture d''une version ouverte (valid_to) est permise';
    END IF;
    IF NEW.valid_to < v_now THEN
      RAISE EXCEPTION 'PARAM_RETROACTIVE' USING ERRCODE = 'check_violation',
        DETAIL = 'valid_to antérieur à platform.now()';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW.valid_from IS NULL THEN
    NEW.valid_from := v_now;
  ELSIF NEW.valid_from < v_now THEN
    RAISE EXCEPTION 'PARAM_RETROACTIVE' USING ERRCODE = 'check_violation',
      DETAIL = 'valid_from antérieur à platform.now() (16 ADM-014)';
  END IF;

  SELECT * INTO v_def FROM core.config_param_definition WHERE key = NEW.key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARAM_UNKNOWN' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT (NEW.scope_type = ANY (v_def.allowed_scopes)) THEN
    RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
      DETAIL = format('portée %s non permise pour %s', NEW.scope_type, NEW.key);
  END IF;
  IF NEW.country_code = ANY (v_def.not_applicable_in) THEN
    RAISE EXCEPTION 'PARAM_NOT_APPLICABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT v_def.go_live_switch AND NEW.go_live_request_id IS NOT NULL THEN
    RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
      DETAIL = 'go_live_request_id réservé aux interrupteurs de mise en service';
  END IF;

  SELECT currency INTO v_cur FROM core.config_country WHERE code = NEW.country_code;
  IF v_def.currency_bound THEN
    IF NEW.currency IS NULL THEN
      NEW.currency := v_cur;
    ELSIF NEW.currency <> v_cur THEN
      RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
        DETAIL = 'devise différente de celle du pays (aucune conversion, 17 §7.1)';
    END IF;
  ELSIF NEW.currency IS NOT NULL THEN
    RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
      DETAIL = 'clé sans devise';
  END IF;

  v_type := jsonb_typeof(NEW.value);
  -- Parenthèses obligatoires : PL/pgSQL lit la condition de IF jusqu’au premier THEN.
  IF NOT (CASE v_def.type
      WHEN 'BOOL' THEN v_type = 'boolean'
      -- Montant : chaîne d'entier >= 0 bornée à int64 (bigint, 17 §1.2 ; revue argent US-013).
      WHEN 'MONEY' THEN v_type = 'string'
                        AND CASE WHEN (NEW.value #>> '{}') ~ '^(0|[1-9][0-9]{0,18})$'
                                 THEN (NEW.value #>> '{}')::numeric <= 9223372036854775807
                                 ELSE false END
      WHEN 'ENUM' THEN v_type = 'string' AND (NEW.value #>> '{}') = ANY (v_def.allowed_values)
      WHEN 'BPS' THEN v_type = 'number'
                      AND CASE WHEN (NEW.value #>> '{}') ~ '^[0-9]{1,5}$'
                               THEN (NEW.value #>> '{}')::integer <= 10000
                               ELSE false END
      WHEN 'JSON' THEN v_type <> 'null'
      ELSE v_type = 'number' AND (NEW.value #>> '{}') ~ '^[0-9]+$'  -- INT, DURATION
    END) THEN
    RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
      DETAIL = format('valeur incompatible avec le type %s de %s', v_def.type, NEW.key);
  END IF;
  RETURN NEW;
END
$fn$;

-- 5. Socle de cmd_golive_owner (NOLOGIN, amorçage) : droits au plus juste -----------------------
GRANT USAGE ON SCHEMA core, app, platform TO cmd_golive_owner;
GRANT EXECUTE ON FUNCTION platform.now(), platform.uuid_v7() TO cmd_golive_owner;
GRANT EXECUTE ON FUNCTION app.actor_kind(), app.country_scope() TO cmd_golive_owner;
GRANT EXECUTE ON FUNCTION core.config_go_live(text, text) TO cmd_golive_owner;

-- configuration : pays déclarés, définitions des clés GARDÉES, valeurs des clés gardées
-- (la garde de 0008, exécutée sous l'écrivain, lit la définition entière et la devise du pays)
GRANT SELECT (code, currency) ON core.config_country TO cmd_golive_owner;
CREATE POLICY cmd_golive_sel ON core.config_country FOR SELECT TO cmd_golive_owner USING (true);
GRANT SELECT ON core.config_param_definition TO cmd_golive_owner;
CREATE POLICY cmd_golive_sel ON core.config_param_definition FOR SELECT TO cmd_golive_owner
  USING (go_live_switch);
GRANT SELECT (id, key, country_code, scope_type, value, valid_from, valid_to, go_live_request_id)
  ON core.config_param_value TO cmd_golive_owner;
GRANT INSERT (key, country_code, scope_type, value, approved_by, decision_ref, change_reason,
              go_live_request_id)
  ON core.config_param_value TO cmd_golive_owner;
CREATE POLICY cmd_golive_sel ON core.config_param_value FOR SELECT TO cmd_golive_owner
  USING (go_live_request_id IS NOT NULL
         OR key IN (SELECT d.key FROM core.config_param_definition AS d WHERE d.go_live_switch));
CREATE POLICY cmd_golive_ins ON core.config_param_value FOR INSERT TO cmd_golive_owner
  WITH CHECK (app.actor_kind() = 'STAFF' AND go_live_request_id IS NOT NULL
              AND approved_by IS NOT NULL AND scope_type = 'COUNTRY');

-- demandes : lecture, création PENDING, changement d'état ; aucune politique DELETE
GRANT SELECT ON core.config_go_live_switch_request TO cmd_golive_owner;
GRANT INSERT (id, key, country_code, value, decision_ref, requested_by, expires_at, status)
  ON core.config_go_live_switch_request TO cmd_golive_owner;
GRANT UPDATE (approved_by, approved_at, status) ON core.config_go_live_switch_request
  TO cmd_golive_owner;
CREATE POLICY cmd_golive_sel ON core.config_go_live_switch_request FOR SELECT TO cmd_golive_owner
  USING (true);
CREATE POLICY cmd_golive_ins ON core.config_go_live_switch_request FOR INSERT TO cmd_golive_owner
  WITH CHECK (app.actor_kind() = 'STAFF' AND status = 'PENDING' AND approved_by IS NULL
              AND country_code = ANY (app.country_scope()));
CREATE POLICY cmd_golive_upd ON core.config_go_live_switch_request FOR UPDATE TO cmd_golive_owner
  USING (app.actor_kind() = 'STAFF' AND status = 'PENDING')
  WITH CHECK (app.actor_kind() = 'STAFF' AND status IN ('APPLIED', 'REJECTED', 'EXPIRED')
              AND country_code = ANY (app.country_scope()));

-- session de staff, matrice et journal (aides de la console, ADR-062 ; SECURITY INVOKER) : mêmes
-- lectures que cmd_money_owner (0036), écriture au journal en ajout seul
GRANT SELECT (id, user_id, token_hash, expires_at, revoked_at, mfa_level) ON core.iam_session
  TO cmd_golive_owner;
GRANT SELECT (id, status) ON core.iam_user_account TO cmd_golive_owner;
GRANT SELECT (user_id, role, country_scope, expires_at) ON core.iam_staff_role_assignment
  TO cmd_golive_owner;
GRANT SELECT (role, permission_code, valid_from, valid_to) ON core.iam_role_permission
  TO cmd_golive_owner;
GRANT INSERT (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after,
              reason, request_id)
  ON core.audit_audit_log TO cmd_golive_owner;
GRANT SELECT (id) ON core.audit_audit_log TO cmd_golive_owner;      -- RETURNING id
CREATE POLICY cmd_golive_sel ON core.iam_session FOR SELECT TO cmd_golive_owner USING (true);
CREATE POLICY cmd_golive_sel ON core.iam_user_account FOR SELECT TO cmd_golive_owner USING (true);
CREATE POLICY cmd_golive_sel ON core.iam_staff_role_assignment FOR SELECT TO cmd_golive_owner
  USING (true);
CREATE POLICY cmd_golive_sel ON core.iam_role_permission FOR SELECT TO cmd_golive_owner USING (true);
CREATE POLICY cmd_golive_ins ON core.audit_audit_log FOR INSERT TO cmd_golive_owner WITH CHECK (true);
CREATE POLICY cmd_golive_sel ON core.audit_audit_log FOR SELECT TO cmd_golive_owner USING (true);
GRANT EXECUTE ON FUNCTION core.iam_staff_session(bytea),
  core.iam_staff_permitted(uuid, text, text[], text[]),
  core.iam_staff_audit(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid),
  core.iam_staff_audit_countries(uuid, text, uuid, jsonb, jsonb) TO cmd_golive_owner;

-- événement config.param.changed (17 §4.5 : key, scope, valid_from), acteur STAFF
GRANT INSERT (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  ON core.outbox_outbox_event TO cmd_golive_owner;
CREATE POLICY cmd_golive_event_ins ON core.outbox_outbox_event FOR INSERT TO cmd_golive_owner
  WITH CHECK (type = 'config.param.changed' AND aggregate_type = 'param_value'
              AND actor_role = 'SUPERADMIN' AND actor_user_id IS NOT NULL);

-- 6. Commandes à deux personnes (SECURITY DEFINER, cmd_golive_owner, EXECUTE au seul app_api) ----
-- Issues (un refus n'est pas une erreur : il est journalisé puis rendu, l'API répond 403) :
-- AUTH_REQUIRED (aucune session vivante ou contexte non STAFF : non journalisé), MFA_REQUIRED,
-- FORBIDDEN (permission, rôle, pays : même issue, aucun oracle), DUPLICATE, ALREADY_PENDING,
-- REQUESTED ; puis NOT_PENDING, SELF_APPROVAL, EXPIRED, REJECTED (le demandeur n'a plus le droit),
-- APPLIED. Clé non gardée, pays absent ou référence de décision mal formée : 22023.

CREATE FUNCTION core.config_cmd_request_go_live_switch(p_token_hash bytea, p_request_id uuid,
                                                      p_key text, p_country text,
                                                      p_value boolean, p_decision_ref text)
  RETURNS TABLE (outcome text, request_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_role    text;
  v_prev    record;
  v_pending uuid;
  v_now     timestamptz;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_request_id IS NULL OR p_key IS NULL OR p_country IS NULL OR p_value IS NULL
     OR p_decision_ref IS NULL OR p_decision_ref !~ '^DEC-FONDATEUR-[0-9]{1,4}$'
     OR NOT EXISTS (SELECT 1 FROM core.config_param_definition AS d
                     WHERE d.key = p_key AND d.go_live_switch)
     OR NOT EXISTS (SELECT 1 FROM core.config_country AS c WHERE c.code::text = p_country) THEN
    RAISE EXCEPTION 'interrupteur : clé, pays ou référence de décision invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'GO_LIVE_SWITCH',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'REQUEST_GO_LIVE_SWITCH', 'country', p_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  v_role := core.iam_staff_permitted(v_s.user_id, 'config.go_live_switch', ARRAY[p_country],
                                     ARRAY['ADMIN', 'SUPERADMIN']);
  IF v_role IS NULL OR NOT (p_country = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'GO_LIVE_SWITCH',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION_OR_COUNTRY',
                                   'attempted', 'REQUEST_GO_LIVE_SWITCH',
                                   'permission', 'config.go_live_switch', 'country', p_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- une seule demande à la fois par clé et par pays : sérialisation explicite
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('config.go_live:' || p_key || ':' || p_country, 0));
  SELECT r.id, r.key, r.country_code, r.value, r.requested_by INTO v_prev
    FROM core.config_go_live_switch_request AS r WHERE r.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.key = p_key AND v_prev.country_code::text = p_country AND v_prev.value = p_value
       AND v_prev.requested_by = v_s.user_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_prev.id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'interrupteur : identifiant de demande déjà utilisé'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_now := platform.now();
  -- une demande échue ne bloque pas la suivante
  UPDATE core.config_go_live_switch_request AS r SET status = 'EXPIRED'
   WHERE r.key = p_key AND r.country_code::text = p_country AND r.status = 'PENDING'
     AND r.expires_at <= v_now;
  SELECT r.id INTO v_pending FROM core.config_go_live_switch_request AS r
   WHERE r.key = p_key AND r.country_code::text = p_country AND r.status = 'PENDING';
  IF v_pending IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_PENDING'::text, v_pending;
    RETURN;
  END IF;
  -- aucun effet sur la valeur : la demande seule ; échéance 72 h (PROPOSÉ, ADR-101)
  INSERT INTO core.config_go_live_switch_request (id, key, country_code, value, decision_ref,
                                                  requested_by, expires_at, status)
  VALUES (p_request_id, p_key, p_country, p_value, p_decision_ref, v_s.user_id,
          v_now + interval '72 hours', 'PENDING');
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SWITCH_REQUESTED', 'GO_LIVE_SWITCH',
                               p_request_id, NULL,
                               pg_catalog.jsonb_build_object('key', p_key, 'country', p_country,
                                 'value', p_value, 'decisionRef', p_decision_ref),
                               p_decision_ref, p_request_id);
  RETURN QUERY SELECT 'REQUESTED'::text, p_request_id;
END
$fn$;

CREATE FUNCTION core.config_cmd_approve_go_live_switch(p_token_hash bytea, p_request_id uuid)
  RETURNS TABLE (outcome text, request_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s      record;
  v_r      record;
  v_role   text;
  v_now    timestamptz;
  v_before boolean;
  v_value  uuid;
  v_from   timestamptz;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'interrupteur : demande absente' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT r.id, r.key, r.country_code::text AS country_code, r.value, r.decision_ref,
         r.requested_by, r.expires_at, r.status INTO v_r
    FROM core.config_go_live_switch_request AS r WHERE r.id = p_request_id;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'GO_LIVE_SWITCH',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'APPROVE_GO_LIVE_SWITCH'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- approbation : SUPERADMIN du pays seulement (un ADMIN ne fait que demander)
  IF v_r.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'config.go_live_switch', ARRAY[v_r.country_code],
                                       ARRAY['SUPERADMIN']);
  END IF;
  IF v_role IS NULL OR NOT (v_r.country_code = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'GO_LIVE_SWITCH',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_r.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION_OR_COUNTRY' END,
                                   'attempted', 'APPROVE_GO_LIVE_SWITCH',
                                   'permission', 'config.go_live_switch'), NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_r.status <> 'PENDING' THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_r.id;
    RETURN;
  END IF;
  -- deux personnes distinctes : l'identité est celle de la SESSION (une seconde session du
  -- demandeur est la même personne) ; refus journalisé, aucun effet
  IF v_r.requested_by = v_s.user_id THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SELF_APPROVAL_DENIED',
                                 'GO_LIVE_SWITCH', v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code, 'value', v_r.value),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'SELF_APPROVAL'::text, v_r.id;
    RETURN;
  END IF;
  -- même verrou que la demande, puis la ligne ; l'état est relu sous verrou
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('config.go_live:' || v_r.key || ':' || v_r.country_code, 0));
  PERFORM 1 FROM core.config_go_live_switch_request AS r
   WHERE r.id = v_r.id AND r.status = 'PENDING' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_r.id;
    RETURN;
  END IF;
  v_now := platform.now();
  IF v_r.expires_at <= v_now THEN
    UPDATE core.config_go_live_switch_request AS r SET status = 'EXPIRED' WHERE r.id = v_r.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SWITCH_EXPIRED', 'GO_LIVE_SWITCH',
                                 v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code, 'value', v_r.value),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'EXPIRED'::text, v_r.id;
    RETURN;
  END IF;
  -- le demandeur doit encore détenir la permission (rôle retiré entre-temps : demande rejetée)
  IF core.iam_staff_permitted(v_r.requested_by, 'config.go_live_switch', ARRAY[v_r.country_code],
                              ARRAY['ADMIN', 'SUPERADMIN']) IS NULL THEN
    UPDATE core.config_go_live_switch_request AS r SET status = 'REJECTED' WHERE r.id = v_r.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SWITCH_REJECTED', 'GO_LIVE_SWITCH',
                                 v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code, 'value', v_r.value,
                                   'reason', 'REQUESTER_NOT_PERMITTED'), NULL, p_request_id);
    RETURN QUERY SELECT 'REJECTED'::text, v_r.id;
    RETURN;
  END IF;
  v_before := core.config_go_live(v_r.key, v_r.country_code);
  UPDATE core.config_go_live_switch_request AS r
     SET status = 'APPLIED', approved_by = v_s.user_id, approved_at = v_now
   WHERE r.id = v_r.id;
  -- nouvelle version (valid_from posé par la garde de 0008 : platform.now()), recopie de la demande
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, approved_by,
                                       decision_ref, change_reason, go_live_request_id)
  VALUES (v_r.key, v_r.country_code, 'COUNTRY', pg_catalog.to_jsonb(v_r.value), v_s.user_id,
          v_r.decision_ref, 'interrupteur à deux personnes : ' || v_r.decision_ref, v_r.id)
  RETURNING id, valid_from INTO v_value, v_from;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  VALUES ('config.param.changed', 1, 'param_value', v_value, 0, v_r.country_code, v_s.user_id,
          'SUPERADMIN', v_r.id, NULL,
          pg_catalog.jsonb_build_object('key', v_r.key, 'scope', 'COUNTRY',
            'country', v_r.country_code, 'valid_from', v_from),
          v_r.key || ':' || v_r.country_code);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SWITCH_APPLIED', 'GO_LIVE_SWITCH',
                               v_r.id, pg_catalog.jsonb_build_object('value', v_before),
                               pg_catalog.jsonb_build_object('key', v_r.key,
                                 'country', v_r.country_code, 'value', v_r.value,
                                 'decisionRef', v_r.decision_ref, 'requestedBy', v_r.requested_by,
                                 'validFrom', v_from),
                               v_r.decision_ref, p_request_id);
  RETURN QUERY SELECT 'APPLIED'::text, v_r.id;
END
$fn$;

COMMENT ON FUNCTION core.config_cmd_request_go_live_switch(bytea, uuid, text, text, boolean, text) IS
  'Demande de changement d''un interrupteur de mise en service (ADMIN ou SUPERADMIN, décision '
  'écrite du fondateur), sans effet : 17 §2.3, RLS-27. US-125.';
COMMENT ON FUNCTION core.config_cmd_approve_go_live_switch(bytea, uuid) IS
  'Approbation par un SUPERADMIN AUTRE que le demandeur ; nouvelle version, événement et audit '
  'dans la même transaction : 17 §2.3, RLS-27. US-125.';

REVOKE ALL ON FUNCTION core.config_cmd_request_go_live_switch(bytea, uuid, text, text, boolean, text),
  core.config_cmd_approve_go_live_switch(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.config_cmd_request_go_live_switch(bytea, uuid, text, text, boolean, text),
  core.config_cmd_approve_go_live_switch(bytea, uuid) TO app_api;   -- jamais app_worker ni app_anon

GRANT CREATE ON SCHEMA core TO cmd_golive_owner;
ALTER FUNCTION core.config_cmd_request_go_live_switch(bytea, uuid, text, text, boolean, text)
  OWNER TO cmd_golive_owner;
ALTER FUNCTION core.config_cmd_approve_go_live_switch(bytea, uuid) OWNER TO cmd_golive_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_golive_owner;
