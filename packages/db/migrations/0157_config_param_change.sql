-- 0157 — CFG : changement revu d'une valeur de paramètre pays, par deux personnes distinctes.
-- US-535a (tranche serveur d'US-535, suivie sous US-535) ; 19 US-535 « Découpage » ; 17 §0.1, §2.3
-- (`config.param_write`, `config.go_live_switch`, RLS-27), §3.2, §7.1, §7.2 ; 16 ADM-014, ADM-031 ;
-- DEC-FONDATEUR-15 ; BOARD N-22, N-411, N-412 ; ADR-178 (PROPOSÉ). Modèle : 0073 (US-125,
-- interrupteurs à deux personnes) ; garde de conflit d'acteurs `core.support_staff_conflict`
-- (US-222d2, 0156). Appliquée sous `migrator`, en une transaction.
--
-- Bêta (D1) : schéma unique `core`, préfixe `config_` (`config.param_change_request` →
-- `core.config_param_change_request`, `config.cmd_request_param_change` →
-- `core.config_cmd_request_param_change`, etc.).
--
-- Principes (ADR-178, PROPOSÉS) :
--   - TOUTE clé change par deux personnes réellement distinctes (plus strict que « paramètres
--     monétaires seulement », fail-closed) : demande d'un ADMIN ou SUPERADMIN qui détient
--     `config.param_write` dans le pays (17 §2.3 : ADMIN « oui », SUPERADMIN « oui »), approbation
--     par un SECOND ADMIN ou SUPERADMIN qui détient la permission dans le pays, ni le demandeur
--     (même dans une seconde session : l'identité est celle de la SESSION désignée par l'empreinte
--     du jeton, jamais d'un réglage `app.*`) ni une personne en conflit avec lui
--     (`core.support_staff_conflict`, dans les deux sens, jugé à l'approbation). Écart assumé avec
--     0073, où seul un SUPERADMIN approuve un interrupteur : la matrice donne `config.param_write`
--     à ADMIN et SUPERADMIN à égalité (revue architecture de la PR n° 260, n° 3) ;
--   - les clés `go_live_switch` (les quatre interrupteurs de 17 §0.1), en toute casse et entourées
--     de blancs, sont refusées à la demande (FORBIDDEN, raison GO_LIVE_SWITCH) et à l'écriture :
--     les politiques de `cmd_param_owner` ne voient ni n'écrivent aucune version d'une clé gardée,
--     la garde des demandes refuse une clé gardée pour tout rôle, et le trigger
--     `param_value_go_live_guard` de 0073 (INCHANGÉ) refuse toute écriture d'une clé gardée par un
--     autre écrivain que `migrator` (graines à false) et `cmd_golive_owner` ;
--   - valeur validée à la demande ET à l'approbation contre la définition : type, devise du pays
--     (explicite pour une clé liée à la devise, absente sinon), bornes min / max par clé et par pays
--     (`core.config_param_bound`, extension insertion seule de la définition ; absentes ⇒ refus
--     pour une clé numérique INT, DURATION, MONEY, BPS) ; une clé JSON est refusée (aucun schéma de
--     validation par clé en bêta : elle change par migration revue) ; portée COUNTRY seulement ;
--     PARAM_INVALID_VALUE (code PROPOSÉ), PARAM_UNKNOWN, PARAM_NOT_APPLICABLE ;
--   - seule une valeur DÉCIDÉE est programmée (N-22) : `decision_ref` d'une décision écrite du
--     fondateur (`DEC-FONDATEUR-n`, docs/team/DECISIONS.md), sinon PARAM_UNDECIDED ;
--   - jamais rétroactive : `valid_from` antérieur à `platform.now()` (demande ou approbation), ou
--     pas strictement postérieur à la dernière version (qui peut être programmée) ⇒
--     PARAM_RETROACTIVE ; à l'approbation, la version ouverte est fermée à `valid_from` et la
--     nouvelle s'ouvre à `valid_from` (ni trou ni recouvrement) ; un devis figé garde ses montants
--     (pricing_quote immuable, US-202) ;
--   - une seule demande PENDING par clé et par pays (index unique partiel, ALREADY_PENDING) ;
--     échéance 72 h (délai de 0073, PROPOSÉ) ; le demandeur ou un SUPERADMIN du pays annule ;
--   - effet dans la transaction de l'approbation : demande APPLIED (`approved_by`), fermeture de la
--     version ouverte, nouvelle version (`decision_ref`, `approved_by`, motif), événement
--     `config.param.changed`, audit en dernier ; tout refus est journalisé sans écrire de valeur ;
--   - AUCUNE valeur de paramètre ni AUCUNE borne n'est écrite ici : les clés numériques restent
--     refusées tant qu'une migration revue n'a pas posé leurs bornes (fail-closed).
--
-- Expand / contract : deux tables, une permission (deux lignes de matrice), un propriétaire NOLOGIN
-- (amorçage), des droits et politiques de ce seul propriétaire, un EXECUTE ajouté à
-- `core.config_go_live_write_refusal` (appelée par la garde sous l'écrivain) et à
-- `core.support_staff_conflict` ; aucune colonne, aucune fonction existante remplacée.
--
-- Retour arrière (base sans dépendance) :
--   DROP FUNCTION core.config_cmd_request_param_change(bytea, uuid, text, text, jsonb, text,
--     timestamptz, text, text), core.config_cmd_approve_param_change(bytea, uuid),
--     core.config_cmd_cancel_param_change(bytea, uuid), core.config_param_change_check(text, text,
--     jsonb, text);
--   DROP POLICY cmd_param_* (tables ci-dessous) ; REVOKE des droits de cmd_param_owner ;
--   REVOKE EXECUTE ON FUNCTION core.config_go_live_write_refusal(…), core.support_staff_conflict(…)
--     FROM cmd_param_owner ;
--   DROP TABLE core.config_param_change_request, core.config_param_bound ;
--   DROP FUNCTION core.config_param_change_request_guard(), core.config_param_bound_guard() ;
--   DELETE FROM core.iam_role_permission WHERE permission_code = 'config.param_write'.

-- 1. Permission de la matrice (17 §2.3 : `config.param_write`, ADMIN « oui », SUPERADMIN « oui » ;
--    hors interrupteurs de mise en service) ---------------------------------------------------------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('ADMIN',      'config.param_write', 'PLATFORM', '2026-11-19T00:00:00Z',
   'US-535a : matrice 17 §2.3 (demande ou approbation, jamais les deux ; hors interrupteurs)'),
  ('SUPERADMIN', 'config.param_write', 'PLATFORM', '2026-11-19T00:00:00Z',
   'US-535a : matrice 17 §2.3 (demande ou approbation, jamais les deux ; hors interrupteurs)');

-- 2. Bornes des clés numériques (extension de la définition, insertion seule) ----------------------
-- Une ligne par clé et par pays : la borne d'un montant est en unités mineures de la devise du
-- pays (USD et PYG n'ont pas la même échelle). Aucune ligne ici : une borne est une donnée revue,
-- posée par une migration revue (comme une définition) ; sans borne, la clé numérique est refusée.
CREATE TABLE core.config_param_bound (
  key          text        NOT NULL REFERENCES core.config_param_definition (key),
  country_code char(2)     NOT NULL REFERENCES core.config_country (code),
  min_value    numeric     NOT NULL CONSTRAINT param_bound_min_integral CHECK (min_value = pg_catalog.trunc(min_value) AND min_value >= 0),
  max_value    numeric     NOT NULL CONSTRAINT param_bound_max_integral CHECK (max_value = pg_catalog.trunc(max_value)),
  source_ref   text        NOT NULL CONSTRAINT param_bound_source_ref CHECK (source_ref <> ''),
  created_at   timestamptz NOT NULL DEFAULT platform.now(),
  created_by   name        NOT NULL DEFAULT current_user,
  CONSTRAINT config_param_bound_pkey PRIMARY KEY (key, country_code),
  CONSTRAINT param_bound_order CHECK (min_value <= max_value)
);
COMMENT ON TABLE core.config_param_bound IS
  'Bornes min / max d''une clé numérique (INT, DURATION, MONEY, BPS) par pays, en unité de la '
  'définition (unités mineures de la devise du pays pour MONEY) ; absentes ⇒ la commande revue '
  'refuse la clé (fail-closed). Insertion seule. US-535a (ADR-178).';

-- Insertion : clé numérique, non gardée, bornes dans le domaine du type ; ni modification ni
-- suppression (garde commune de 0008), ni TRUNCATE.
CREATE FUNCTION core.config_param_bound_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_def core.config_param_definition%ROWTYPE;
BEGIN
  SELECT * INTO v_def FROM core.config_param_definition AS d WHERE d.key = NEW.key;
  IF NOT FOUND OR v_def.go_live_switch OR v_def.type NOT IN ('INT', 'DURATION', 'MONEY', 'BPS')
     OR (v_def.type = 'BPS' AND NEW.max_value > 10000)
     OR (v_def.type = 'MONEY' AND NEW.max_value > 9223372036854775807) THEN
    RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
      DETAIL = format('borne refusée pour %s (clé numérique non gardée seulement)', NEW.key),
      CONSTRAINT = 'param_bound_numeric_key';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.config_param_bound_guard() FROM PUBLIC;
CREATE TRIGGER config_param_bound_insert_guard BEFORE INSERT ON core.config_param_bound
  FOR EACH ROW EXECUTE FUNCTION core.config_param_bound_guard();
CREATE TRIGGER config_param_bound_guard BEFORE UPDATE OR DELETE ON core.config_param_bound
  FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard();
CREATE TRIGGER config_param_bound_no_truncate BEFORE TRUNCATE ON core.config_param_bound
  FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate();

ALTER TABLE core.config_param_bound ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.config_param_bound FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.config_param_bound TO migrator USING (true) WITH CHECK (true);
-- aucun droit pour app_api, app_worker ni app_anon (lus par les seules commandes)
REVOKE ALL ON core.config_param_bound FROM PUBLIC;

-- 3. Demandes à deux personnes (17 §2.3, complément PROPOSÉ : config.param_change_request) --------
CREATE TABLE core.config_param_change_request (
  id            uuid        PRIMARY KEY,                       -- = identifiant de la demande
  key           text        NOT NULL REFERENCES core.config_param_definition (key),
  country_code  char(2)     NOT NULL REFERENCES core.config_country (code),
  value         jsonb       NOT NULL,
  currency      char(3)     REFERENCES core.config_currency (code),
  valid_from    timestamptz NOT NULL,
  reason        text        NOT NULL
    CONSTRAINT param_change_request_reason_length CHECK (pg_catalog.char_length(pg_catalog.btrim(reason)) BETWEEN 10 AND 1000),
  -- référence de la décision écrite du fondateur (docs/team/DECISIONS.md)
  decision_ref  text        NOT NULL
    CONSTRAINT param_change_request_decision_ref_format CHECK (decision_ref ~ '^DEC-FONDATEUR-[0-9]{1,4}$'),
  requested_by  uuid        NOT NULL,                          -- = personne de la session
  requested_at  timestamptz NOT NULL DEFAULT platform.now(),
  expires_at    timestamptz NOT NULL,
  approved_by   uuid,                                          -- = seconde personne
  approved_at   timestamptz,
  status        text        NOT NULL
    CONSTRAINT param_change_request_status_valid CHECK (status IN ('PENDING', 'APPLIED', 'REJECTED',
                                                                   'EXPIRED', 'CANCELLED')),
  CONSTRAINT param_change_request_expiry CHECK (expires_at > requested_at),
  CONSTRAINT param_change_request_not_retroactive CHECK (valid_from >= requested_at),
  CONSTRAINT param_change_request_two_people CHECK (approved_by IS NULL OR approved_by <> requested_by),
  CONSTRAINT param_change_request_applied_shape CHECK ((status = 'APPLIED') = (approved_by IS NOT NULL)),
  CONSTRAINT param_change_request_approved_at CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);
CREATE UNIQUE INDEX param_change_request_one_pending
  ON core.config_param_change_request (key, country_code) WHERE (status = 'PENDING');
COMMENT ON TABLE core.config_param_change_request IS
  'CFG param_change_request (complément PROPOSÉ de 17 §2.3) : demande puis approbation par deux '
  'personnes distinctes d''une nouvelle valeur datée d''un paramètre pays (hors interrupteurs de '
  'mise en service). US-535a (ADR-178).';
COMMENT ON COLUMN core.config_param_change_request.reason IS
  'Motif libre du demandeur (C2, dérogation d''effacement comme le journal) : aucune donnée de personne.';

-- Identité figée ; seule une demande PENDING change d'état ; une clé gardée (interrupteur, toute
-- casse) n'est jamais demandée, pour tout rôle ; ni suppression ni TRUNCATE (registre de décision).
CREATE FUNCTION core.config_param_change_request_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
                WHERE d.go_live_switch AND d.key = pg_catalog.lower(pg_catalog.btrim(NEW.key))) THEN
      RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege',
        DETAIL = 'interrupteur de mise en service : procédure à deux personnes de US-125 seulement',
        CONSTRAINT = 'param_change_request_go_live_key';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'PENDING'
     AND NEW.status IN ('APPLIED', 'REJECTED', 'EXPIRED', 'CANCELLED')
     AND (NEW.id, NEW.key, NEW.country_code, NEW.value, NEW.currency, NEW.valid_from, NEW.reason,
          NEW.decision_ref, NEW.requested_by, NEW.requested_at, NEW.expires_at)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.key, OLD.country_code, OLD.value, OLD.currency, OLD.valid_from, OLD.reason,
          OLD.decision_ref, OLD.requested_by, OLD.requested_at, OLD.expires_at) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'param_change_request : identité figée, seule une demande PENDING change d''état'
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'param_change_request_guarded';
END
$fn$;
REVOKE ALL ON FUNCTION core.config_param_change_request_guard() FROM PUBLIC;
CREATE TRIGGER param_change_request_guard
  BEFORE INSERT OR UPDATE OR DELETE ON core.config_param_change_request
  FOR EACH ROW EXECUTE FUNCTION core.config_param_change_request_guard();
CREATE TRIGGER param_change_request_no_truncate BEFORE TRUNCATE ON core.config_param_change_request
  FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate();

ALTER TABLE core.config_param_change_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.config_param_change_request FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.config_param_change_request TO migrator USING (true) WITH CHECK (true);
-- aucun droit pour app_api, app_worker ni app_anon : demandes et issues passent par les commandes
REVOKE ALL ON core.config_param_change_request FROM PUBLIC;

-- 4. Validation d'une valeur demandée (SECURITY INVOKER, appelée par les commandes sous
--    cmd_param_owner) : rend (NULL, NULL) si la valeur est recevable, sinon l'issue et sa raison.
--    La clé est comparée telle quelle (clés canoniques en minuscules, 0008) ; une clé gardée est
--    reconnue en toute casse et sans blancs. Ordre : clé gardée, clé inconnue, portée, pays non
--    concerné, devise, type, bornes. -----------------------------------------------------------------
CREATE FUNCTION core.config_param_change_check(p_key text, p_country text, p_value jsonb,
                                               p_currency text, OUT outcome text, OUT reason text)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_def  core.config_param_definition%ROWTYPE;
  v_cur  text;
  v_type text;
  v_text text;
  v_num  numeric;
  v_b    record;
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              WHERE d.go_live_switch AND d.key = pg_catalog.lower(pg_catalog.btrim(p_key))) THEN
    outcome := 'FORBIDDEN'; reason := 'GO_LIVE_SWITCH';
    RETURN;
  END IF;
  SELECT * INTO v_def FROM core.config_param_definition AS d WHERE d.key = p_key;
  IF NOT FOUND THEN
    outcome := 'PARAM_UNKNOWN'; reason := 'KEY';
    RETURN;
  END IF;
  IF NOT ('COUNTRY' = ANY (v_def.allowed_scopes)) THEN
    outcome := 'PARAM_INVALID_VALUE'; reason := 'SCOPE';
    RETURN;
  END IF;
  IF p_country = ANY (v_def.not_applicable_in) THEN
    outcome := 'PARAM_NOT_APPLICABLE'; reason := 'COUNTRY';
    RETURN;
  END IF;
  SELECT c.currency::text INTO v_cur FROM core.config_country AS c WHERE c.code::text = p_country;
  IF v_cur IS NULL THEN
    outcome := 'PARAM_INVALID_VALUE'; reason := 'COUNTRY';
    RETURN;
  END IF;
  -- devise : explicite et égale à celle du pays pour une clé liée à la devise (aucune conversion,
  -- 17 §7.1), absente sinon
  IF (v_def.currency_bound AND p_currency IS DISTINCT FROM v_cur)
     OR (NOT v_def.currency_bound AND p_currency IS NOT NULL) THEN
    outcome := 'PARAM_INVALID_VALUE'; reason := 'CURRENCY';
    RETURN;
  END IF;
  -- JSON : aucun schéma de validation par clé en bêta (barèmes, grilles, parts) : refus
  IF v_def.type = 'JSON' THEN
    outcome := 'PARAM_INVALID_VALUE'; reason := 'JSON_NOT_VALIDATED';
    RETURN;
  END IF;
  v_type := pg_catalog.jsonb_typeof(p_value);
  v_text := p_value #>> '{}';
  -- type : même lecture que la garde de 0008 (montant : chaîne d'entier ≥ 0 bornée à int64)
  IF v_type IS NULL OR NOT (CASE v_def.type
      WHEN 'BOOL' THEN v_type = 'boolean'
      WHEN 'MONEY' THEN v_type = 'string'
                        AND CASE WHEN v_text ~ '^(0|[1-9][0-9]{0,18})$'
                                 THEN v_text::numeric <= 9223372036854775807
                                 ELSE false END
      WHEN 'ENUM' THEN v_type = 'string' AND v_text = ANY (v_def.allowed_values)
      WHEN 'BPS' THEN v_type = 'number'
                      AND CASE WHEN v_text ~ '^[0-9]{1,5}$' THEN v_text::integer <= 10000
                               ELSE false END
      WHEN 'INT' THEN v_type = 'number' AND v_text ~ '^[0-9]{1,18}$'
      WHEN 'DURATION' THEN v_type = 'number' AND v_text ~ '^[0-9]{1,18}$'
      ELSE false
    END) THEN
    outcome := 'PARAM_INVALID_VALUE'; reason := 'TYPE';
    RETURN;
  END IF;
  -- bornes : clé numérique seulement ; absentes ⇒ refus (fail-closed)
  IF v_def.type IN ('INT', 'DURATION', 'MONEY', 'BPS') THEN
    v_num := v_text::numeric;
    SELECT b.min_value, b.max_value INTO v_b FROM core.config_param_bound AS b
     WHERE b.key = v_def.key AND b.country_code::text = p_country;
    IF NOT FOUND THEN
      outcome := 'PARAM_INVALID_VALUE'; reason := 'BOUNDS_MISSING';
      RETURN;
    END IF;
    IF v_num < v_b.min_value OR v_num > v_b.max_value THEN
      outcome := 'PARAM_INVALID_VALUE'; reason := 'OUT_OF_BOUNDS';
      RETURN;
    END IF;
  END IF;
  outcome := NULL; reason := NULL;
END
$fn$;
REVOKE ALL ON FUNCTION core.config_param_change_check(text, text, jsonb, text) FROM PUBLIC;

-- 5. Socle de cmd_param_owner (NOLOGIN, amorçage) : droits au plus juste --------------------------
GRANT USAGE ON SCHEMA core, app, platform TO cmd_param_owner;
GRANT EXECUTE ON FUNCTION platform.now() TO cmd_param_owner;
GRANT EXECUTE ON FUNCTION app.actor_kind(), app.country_scope() TO cmd_param_owner;
GRANT EXECUTE ON FUNCTION core.config_param_change_check(text, text, jsonb, text) TO cmd_param_owner;
-- la garde de 0008, exécutée sous l'écrivain, appelle la règle des interrupteurs de 0073 : sans ce
-- droit, toute écriture de cmd_param_owner échouerait par « permission denied » au lieu de la garde
GRANT EXECUTE ON FUNCTION core.config_go_live_write_refusal(text, text, text, jsonb, uuid, uuid, text)
  TO cmd_param_owner;

-- configuration : pays (devise), définitions ENTIÈRES (la garde de 0008 lit la ligne entière ; la
-- règle des interrupteurs doit voir les clés gardées pour les refuser), bornes
GRANT SELECT (code, currency) ON core.config_country TO cmd_param_owner;
CREATE POLICY cmd_param_sel ON core.config_country FOR SELECT TO cmd_param_owner USING (true);
GRANT SELECT ON core.config_param_definition TO cmd_param_owner;
CREATE POLICY cmd_param_sel ON core.config_param_definition FOR SELECT TO cmd_param_owner
  USING (true);
GRANT SELECT ON core.config_param_bound TO cmd_param_owner;
CREATE POLICY cmd_param_sel ON core.config_param_bound FOR SELECT TO cmd_param_owner USING (true);

-- valeurs : versions de portée COUNTRY des clés NON gardées seulement (lecture, fermeture d'une
-- version ouverte à la date d'une demande APPLIQUÉE, insertion de la seule version recopiant une
-- demande APPLIQUÉE) ; jamais une clé gardée, jamais `go_live_request_id`
GRANT SELECT (id, key, country_code, scope_type, currency, value, valid_from, valid_to)
  ON core.config_param_value TO cmd_param_owner;
GRANT UPDATE (valid_to) ON core.config_param_value TO cmd_param_owner;
GRANT INSERT (key, country_code, scope_type, currency, value, valid_from, approved_by, decision_ref,
              change_reason)
  ON core.config_param_value TO cmd_param_owner;
CREATE POLICY cmd_param_sel ON core.config_param_value FOR SELECT TO cmd_param_owner
  USING (scope_type = 'COUNTRY'
         AND key NOT IN (SELECT d.key FROM core.config_param_definition AS d WHERE d.go_live_switch));
CREATE POLICY cmd_param_upd ON core.config_param_value FOR UPDATE TO cmd_param_owner
  USING (app.actor_kind() = 'STAFF' AND scope_type = 'COUNTRY' AND valid_to IS NULL
         AND key NOT IN (SELECT d.key FROM core.config_param_definition AS d WHERE d.go_live_switch))
  WITH CHECK (app.actor_kind() = 'STAFF' AND valid_to IS NOT NULL
              AND EXISTS (SELECT 1 FROM core.config_param_change_request AS r
                           WHERE r.status = 'APPLIED'
                             AND r.key = config_param_value.key
                             AND r.country_code = config_param_value.country_code
                             AND r.valid_from = config_param_value.valid_to));
CREATE POLICY cmd_param_ins ON core.config_param_value FOR INSERT TO cmd_param_owner
  WITH CHECK (app.actor_kind() = 'STAFF' AND scope_type = 'COUNTRY'
              AND approved_by IS NOT NULL AND decision_ref IS NOT NULL
              AND EXISTS (SELECT 1 FROM core.config_param_change_request AS r
                           WHERE r.status = 'APPLIED'
                             AND r.key = config_param_value.key
                             AND r.country_code = config_param_value.country_code
                             AND r.value = config_param_value.value
                             AND r.currency IS NOT DISTINCT FROM config_param_value.currency
                             AND r.valid_from = config_param_value.valid_from
                             AND r.approved_by = config_param_value.approved_by
                             AND r.decision_ref = config_param_value.decision_ref));

-- demandes : lecture, création PENDING dans la portée, changement d'état ; aucune politique DELETE
GRANT SELECT ON core.config_param_change_request TO cmd_param_owner;
GRANT INSERT (id, key, country_code, value, currency, valid_from, reason, decision_ref, requested_by,
              requested_at, expires_at, status)
  ON core.config_param_change_request TO cmd_param_owner;
GRANT UPDATE (approved_by, approved_at, status) ON core.config_param_change_request
  TO cmd_param_owner;
CREATE POLICY cmd_param_sel ON core.config_param_change_request FOR SELECT TO cmd_param_owner
  USING (true);
CREATE POLICY cmd_param_ins ON core.config_param_change_request FOR INSERT TO cmd_param_owner
  WITH CHECK (app.actor_kind() = 'STAFF' AND status = 'PENDING' AND approved_by IS NULL
              AND country_code = ANY (app.country_scope()));
CREATE POLICY cmd_param_upd ON core.config_param_change_request FOR UPDATE TO cmd_param_owner
  USING (app.actor_kind() = 'STAFF' AND status = 'PENDING')
  WITH CHECK (app.actor_kind() = 'STAFF'
              AND status IN ('APPLIED', 'REJECTED', 'EXPIRED', 'CANCELLED')
              AND country_code = ANY (app.country_scope()));

-- session de staff, matrice et journal (aides de la console, ADR-062 ; SECURITY INVOKER) : mêmes
-- lectures que cmd_golive_owner (0073), écriture au journal en ajout seul
GRANT SELECT (id, user_id, token_hash, expires_at, revoked_at, mfa_level) ON core.iam_session
  TO cmd_param_owner;
GRANT SELECT (id, status) ON core.iam_user_account TO cmd_param_owner;
GRANT SELECT (user_id, role, country_scope, expires_at) ON core.iam_staff_role_assignment
  TO cmd_param_owner;
GRANT SELECT (role, permission_code, valid_from, valid_to) ON core.iam_role_permission
  TO cmd_param_owner;
GRANT INSERT (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after,
              reason, request_id)
  ON core.audit_audit_log TO cmd_param_owner;
GRANT SELECT (id) ON core.audit_audit_log TO cmd_param_owner;      -- RETURNING id
CREATE POLICY cmd_param_sel ON core.iam_session FOR SELECT TO cmd_param_owner USING (true);
CREATE POLICY cmd_param_sel ON core.iam_user_account FOR SELECT TO cmd_param_owner USING (true);
CREATE POLICY cmd_param_sel ON core.iam_staff_role_assignment FOR SELECT TO cmd_param_owner
  USING (true);
CREATE POLICY cmd_param_sel ON core.iam_role_permission FOR SELECT TO cmd_param_owner USING (true);
CREATE POLICY cmd_param_ins ON core.audit_audit_log FOR INSERT TO cmd_param_owner WITH CHECK (true);
CREATE POLICY cmd_param_sel ON core.audit_audit_log FOR SELECT TO cmd_param_owner USING (true);
GRANT EXECUTE ON FUNCTION core.iam_staff_session(bytea),
  core.iam_staff_permitted(uuid, text, text[], text[]),
  core.iam_staff_audit(uuid, text, text, text, uuid, jsonb, jsonb, text, uuid),
  core.iam_staff_audit_countries(uuid, text, uuid, jsonb, jsonb) TO cmd_param_owner;

-- garde de séparation des tâches (US-222d2, 0156) : propriétaire iam_staff_owner
SET LOCAL ROLE iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.support_staff_conflict(uuid, text, uuid) TO cmd_param_owner;
COMMENT ON FUNCTION core.support_staff_conflict(uuid, text, uuid) IS
  'Garde de séparation des tâches (core.support_actor_conflict) pour un autre propriétaire de '
  'commande (cmd_money_owner, cmd_golive_owner, cmd_param_owner). SECURITY DEFINER, aucun rôle '
  'applicatif. US-122 (ADR-124, F2-C-04), US-222d2 (ADR-177), US-535a (ADR-178).';
RESET ROLE;

-- événement config.param.changed (17 §4.5 : key, scope, valid_from), acteur ADMIN ou SUPERADMIN
GRANT INSERT (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
              actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  ON core.outbox_outbox_event TO cmd_param_owner;
CREATE POLICY cmd_param_event_ins ON core.outbox_outbox_event FOR INSERT TO cmd_param_owner
  WITH CHECK (type = 'config.param.changed' AND aggregate_type = 'param_value'
              AND actor_role IN ('ADMIN', 'SUPERADMIN') AND actor_user_id IS NOT NULL);

-- 6. Commandes à deux personnes (SECURITY DEFINER, cmd_param_owner, EXECUTE au seul app_api) -------
-- Issues (un refus n'est pas une erreur : il est journalisé puis rendu ; l'API répond 4xx) :
-- demande : AUTH_REQUIRED (aucune session vivante ou contexte non STAFF : non journalisé),
-- MFA_REQUIRED, FORBIDDEN (permission, rôle, pays : même issue, aucun oracle ; clé gardée : raison
-- GO_LIVE_SWITCH), PARAM_UNKNOWN, PARAM_NOT_APPLICABLE, PARAM_INVALID_VALUE (portée, devise, type,
-- JSON, bornes absentes ou dépassées), PARAM_UNDECIDED, PARAM_RETROACTIVE, DUPLICATE, NO_CHANGE
-- (valeur = dernière version ouverte : non journalisé), ALREADY_PENDING, REQUESTED ;
-- approbation : AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, NOT_PENDING, SELF_FORBIDDEN (le demandeur,
-- même dans une seconde session, ou une personne en conflit avec lui : la demande reste en
-- attente), EXPIRED, REJECTED (le demandeur n'a plus le droit ou son compte n'est plus ACTIVE),
-- PARAM_* (revalidation : la demande est rejetée), APPLIED ; annulation : AUTH_REQUIRED,
-- MFA_REQUIRED, FORBIDDEN, NOT_PENDING, CANCELLED. Paramètre absent (identifiant, clé, pays,
-- valid_from, motif) ou motif hors de 10 à 1000 caractères : 22023, sans journal.
-- Toutes les écritures d'une clé et d'un pays prennent le même verrou consultatif
-- `config.param:<clé>:<pays>` ; l'approbation relit l'état sous verrou.

CREATE FUNCTION core.config_cmd_request_param_change(p_token_hash bytea, p_request_id uuid,
                                                    p_key text, p_country text, p_value jsonb,
                                                    p_currency text, p_valid_from timestamptz,
                                                    p_reason text, p_decision_ref text)
  RETURNS TABLE (outcome text, request_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_role text;
  v_out  text;
  v_why  text;
  v_now  timestamptz;
  v_prev record;
  v_pend uuid;
  v_open record;
  v_last timestamptz;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_request_id IS NULL OR p_key IS NULL OR p_country IS NULL OR p_valid_from IS NULL
     OR p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) NOT BETWEEN 10 AND 1000 THEN
    RAISE EXCEPTION 'paramètre : identifiant, clé, pays, date d''effet ou motif invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'PARAM_CHANGE',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'REQUEST_PARAM_CHANGE', 'country', p_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  v_role := core.iam_staff_permitted(v_s.user_id, 'config.param_write', ARRAY[p_country],
                                     ARRAY['ADMIN', 'SUPERADMIN']);
  IF v_role IS NULL OR NOT (p_country = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'PARAM_CHANGE',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION_OR_COUNTRY',
                                   'attempted', 'REQUEST_PARAM_CHANGE',
                                   'permission', 'config.param_write', 'country', p_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- clé gardée, clé inconnue, portée, pays, devise, type, bornes
  SELECT c.outcome, c.reason INTO v_out, v_why
    FROM core.config_param_change_check(p_key, p_country, p_value, p_currency) AS c;
  IF v_out IS NULL AND (p_decision_ref IS NULL OR p_decision_ref !~ '^DEC-FONDATEUR-[0-9]{1,4}$') THEN
    -- seule une valeur décidée (décision écrite du fondateur) est programmée (N-22)
    v_out := 'PARAM_UNDECIDED'; v_why := 'DECISION_REF';
  END IF;
  v_now := platform.now();
  IF v_out IS NULL AND p_valid_from < v_now THEN
    v_out := 'PARAM_RETROACTIVE'; v_why := 'BEFORE_NOW';
  END IF;
  IF v_out IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role,
                                 CASE WHEN v_out = 'FORBIDDEN' THEN 'STAFF_FORBIDDEN'
                                      ELSE 'PARAM_CHANGE_REFUSED' END,
                                 'PARAM_CHANGE', p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('outcome', v_out,
                                   'reason', v_why, 'attempted', 'REQUEST_PARAM_CHANGE',
                                   'key', pg_catalog.left(p_key, 100), 'country', p_country,
                                   'validFrom', p_valid_from),
                                 NULL, p_request_id);
    RETURN QUERY SELECT v_out, NULL::uuid;
    RETURN;
  END IF;
  -- une seule demande à la fois par clé et par pays : sérialisation explicite
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('config.param:' || p_key || ':' || p_country, 0));
  SELECT r.id, r.key, r.country_code, r.value, r.currency, r.valid_from, r.requested_by INTO v_prev
    FROM core.config_param_change_request AS r WHERE r.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.key = p_key AND v_prev.country_code::text = p_country AND v_prev.value = p_value
       AND v_prev.currency::text IS NOT DISTINCT FROM p_currency
       AND v_prev.valid_from = p_valid_from AND v_prev.requested_by = v_s.user_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_prev.id;
      RETURN;
    END IF;
    RAISE EXCEPTION 'paramètre : identifiant de demande déjà utilisé'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- une demande échue ne bloque pas la suivante
  UPDATE core.config_param_change_request AS r SET status = 'EXPIRED'
   WHERE r.key = p_key AND r.country_code::text = p_country AND r.status = 'PENDING'
     AND r.expires_at <= v_now;
  SELECT r.id INTO v_pend FROM core.config_param_change_request AS r
   WHERE r.key = p_key AND r.country_code::text = p_country AND r.status = 'PENDING' FOR UPDATE;
  IF v_pend IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_PENDING'::text, v_pend;
    RETURN;
  END IF;
  -- la nouvelle version succède à la dernière (en vigueur ou programmée) : valid_from strictement
  -- postérieur à toute version de la clé dans le pays ; la dernière version ouverte est la valeur
  -- comparée (NO_CHANGE)
  SELECT pg_catalog.max(v.valid_from) INTO v_last FROM core.config_param_value AS v
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY';
  SELECT v.value, v.currency, v.valid_from INTO v_open FROM core.config_param_value AS v
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_to IS NULL
   ORDER BY v.valid_from DESC LIMIT 1;
  IF v_last IS NOT NULL AND p_valid_from <= v_last THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'PARAM_CHANGE_REFUSED', 'PARAM_CHANGE',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('outcome', 'PARAM_RETROACTIVE',
                                   'reason', 'BEFORE_LATEST_VERSION',
                                   'attempted', 'REQUEST_PARAM_CHANGE', 'key', p_key,
                                   'country', p_country, 'validFrom', p_valid_from),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'PARAM_RETROACTIVE'::text, NULL::uuid;
    RETURN;
  END IF;
  -- demande sans effet : refusée (elle occuperait la place d'une demande utile)
  IF v_open.valid_from IS NOT NULL AND v_open.value = p_value
     AND v_open.currency::text IS NOT DISTINCT FROM p_currency THEN
    RETURN QUERY SELECT 'NO_CHANGE'::text, NULL::uuid;
    RETURN;
  END IF;
  -- aucun effet sur la valeur : la demande seule ; échéance 72 h (délai de 0073, PROPOSÉ)
  -- instant de la demande = instant des contrôles (l'horloge de production avance pendant la
  -- commande : valid_from = maintenant reste recevable)
  INSERT INTO core.config_param_change_request (id, key, country_code, value, currency, valid_from,
                                                reason, decision_ref, requested_by, requested_at,
                                                expires_at, status)
  VALUES (p_request_id, p_key, p_country, p_value, p_currency, p_valid_from,
          pg_catalog.btrim(p_reason), p_decision_ref, v_s.user_id, v_now,
          v_now + interval '72 hours', 'PENDING');
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'PARAM_CHANGE_REQUESTED', 'PARAM_CHANGE',
                               p_request_id, pg_catalog.jsonb_build_object('value', v_open.value),
                               pg_catalog.jsonb_build_object('key', p_key, 'country', p_country,
                                 'value', p_value, 'currency', p_currency,
                                 'validFrom', p_valid_from, 'decisionRef', p_decision_ref),
                               p_decision_ref, p_request_id);
  RETURN QUERY SELECT 'REQUESTED'::text, p_request_id;
END
$fn$;

CREATE FUNCTION core.config_cmd_approve_param_change(p_token_hash bytea, p_request_id uuid)
  RETURNS TABLE (outcome text, request_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s     record;
  v_r     record;
  v_role  text;
  v_now   timestamptz;
  v_out   text;
  v_why   text;
  v_last  timestamptz;
  v_open  record;
  v_value uuid;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'paramètre : demande absente' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT r.id, r.key, r.country_code::text AS country_code, r.value, r.currency::text AS currency,
         r.valid_from, r.reason, r.decision_ref, r.requested_by, r.expires_at, r.status INTO v_r
    FROM core.config_param_change_request AS r WHERE r.id = p_request_id;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'PARAM_CHANGE',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'APPROVE_PARAM_CHANGE'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- approbation : ADMIN ou SUPERADMIN qui détient config.param_write dans le pays (17 §2.3)
  IF v_r.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'config.param_write', ARRAY[v_r.country_code],
                                       ARRAY['ADMIN', 'SUPERADMIN']);
  END IF;
  IF v_role IS NULL OR NOT (v_r.country_code = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'PARAM_CHANGE',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_r.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION_OR_COUNTRY' END,
                                   'attempted', 'APPROVE_PARAM_CHANGE',
                                   'permission', 'config.param_write'), NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_r.status <> 'PENDING' THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_r.id;
    RETURN;
  END IF;
  -- deux personnes réellement distinctes (DEC-FONDATEUR-15) : l'identité est celle de la SESSION
  -- (une seconde session du demandeur est la même personne) ; l'approbateur n'est pas non plus une
  -- personne du demandeur (lui-même sous un autre compte, une personne de ses comptes d'hôte, un
  -- compte lié LINKED), jugé dans les deux sens au moment de l'approbation ; refus journalisé, la
  -- demande reste en attente, aucun effet
  IF v_r.requested_by = v_s.user_id
     OR core.support_staff_conflict(v_s.user_id, 'USER_ACCOUNT', v_r.requested_by)
     OR core.support_staff_conflict(v_r.requested_by, 'USER_ACCOUNT', v_s.user_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'PARAM_SELF_APPROVAL_DENIED',
                                 'PARAM_CHANGE', v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code,
                                   'reason', CASE WHEN v_r.requested_by = v_s.user_id
                                                  THEN 'REQUESTER' ELSE 'REQUESTER_RELATED' END,
                                   'guard', 'SEPARATION_OF_DUTIES'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, v_r.id;
    RETURN;
  END IF;
  -- même verrou que la demande, puis la ligne ; l'état est relu sous verrou
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('config.param:' || v_r.key || ':' || v_r.country_code, 0));
  PERFORM 1 FROM core.config_param_change_request AS r
   WHERE r.id = v_r.id AND r.status = 'PENDING' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_r.id;
    RETURN;
  END IF;
  v_now := platform.now();
  IF v_r.expires_at <= v_now THEN
    UPDATE core.config_param_change_request AS r SET status = 'EXPIRED' WHERE r.id = v_r.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'PARAM_CHANGE_EXPIRED', 'PARAM_CHANGE',
                                 v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code), NULL, p_request_id);
    RETURN QUERY SELECT 'EXPIRED'::text, v_r.id;
    RETURN;
  END IF;
  -- le demandeur doit encore détenir la permission et un compte ACTIVE
  IF core.iam_staff_permitted(v_r.requested_by, 'config.param_write', ARRAY[v_r.country_code],
                              ARRAY['ADMIN', 'SUPERADMIN']) IS NULL
     OR NOT EXISTS (SELECT 1 FROM core.iam_user_account AS u
                     WHERE u.id = v_r.requested_by AND u.status = 'ACTIVE') THEN
    v_out := 'REJECTED'; v_why := 'REQUESTER_NOT_PERMITTED';
  ELSE
    -- revalidation sous verrou (clé gardée, type, devise, bornes), décision, non-rétroactivité
    SELECT c.outcome, c.reason INTO v_out, v_why
      FROM core.config_param_change_check(v_r.key, v_r.country_code, v_r.value, v_r.currency) AS c;
    IF v_out IS NULL AND v_r.decision_ref !~ '^DEC-FONDATEUR-[0-9]{1,4}$' THEN
      v_out := 'PARAM_UNDECIDED'; v_why := 'DECISION_REF';
    END IF;
    IF v_out IS NULL AND v_r.valid_from < v_now THEN
      v_out := 'PARAM_RETROACTIVE'; v_why := 'BEFORE_NOW';
    END IF;
    IF v_out IS NULL THEN
      -- versions ouvertes verrouillées (fermées plus bas), puis la dernière date d'effet
      PERFORM 1 FROM core.config_param_value AS v
       WHERE v.key = v_r.key AND v.country_code::text = v_r.country_code
         AND v.scope_type = 'COUNTRY' AND v.valid_to IS NULL
         FOR UPDATE;
      SELECT pg_catalog.max(v.valid_from) INTO v_last FROM core.config_param_value AS v
       WHERE v.key = v_r.key AND v.country_code::text = v_r.country_code
         AND v.scope_type = 'COUNTRY';
      SELECT v.id, v.value, v.valid_from INTO v_open FROM core.config_param_value AS v
       WHERE v.key = v_r.key AND v.country_code::text = v_r.country_code
         AND v.scope_type = 'COUNTRY' AND v.valid_to IS NULL
       ORDER BY v.valid_from DESC LIMIT 1;
      IF v_last IS NOT NULL AND v_r.valid_from <= v_last THEN
        v_out := 'PARAM_RETROACTIVE'; v_why := 'BEFORE_LATEST_VERSION';
      END IF;
    END IF;
  END IF;
  IF v_out IS NOT NULL THEN
    -- refus définitif : la demande est rejetée, aucune valeur écrite
    UPDATE core.config_param_change_request AS r SET status = 'REJECTED' WHERE r.id = v_r.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'PARAM_CHANGE_REJECTED', 'PARAM_CHANGE',
                                 v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code, 'outcome', v_out,
                                   'reason', v_why), NULL, p_request_id);
    RETURN QUERY SELECT v_out, v_r.id;
    RETURN;
  END IF;
  UPDATE core.config_param_change_request AS r
     SET status = 'APPLIED', approved_by = v_s.user_id, approved_at = v_now
   WHERE r.id = v_r.id;
  -- fermeture des versions ouvertes à la date d'effet, puis la nouvelle version (ni trou ni
  -- recouvrement) ; les gardes de 0008 / 0073 s'appliquent sous cmd_param_owner
  UPDATE core.config_param_value AS v SET valid_to = v_r.valid_from
   WHERE v.key = v_r.key AND v.country_code::text = v_r.country_code
     AND v.scope_type = 'COUNTRY' AND v.valid_to IS NULL;
  INSERT INTO core.config_param_value (key, country_code, scope_type, currency, value, valid_from,
                                       approved_by, decision_ref, change_reason)
  VALUES (v_r.key, v_r.country_code, 'COUNTRY', v_r.currency, v_r.value, v_r.valid_from,
          v_s.user_id, v_r.decision_ref, v_r.reason)
  RETURNING id INTO v_value;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  VALUES ('config.param.changed', 1, 'param_value', v_value, 0, v_r.country_code, v_s.user_id,
          v_role, v_r.id, NULL,
          pg_catalog.jsonb_build_object('key', v_r.key, 'scope', 'COUNTRY',
            'country', v_r.country_code, 'valid_from', v_r.valid_from),
          v_r.key || ':' || v_r.country_code);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'PARAM_CHANGE_APPLIED', 'PARAM_CHANGE',
                               v_r.id, pg_catalog.jsonb_build_object('value', v_open.value,
                                 'validFrom', v_open.valid_from),
                               pg_catalog.jsonb_build_object('key', v_r.key,
                                 'country', v_r.country_code, 'value', v_r.value,
                                 'currency', v_r.currency, 'validFrom', v_r.valid_from,
                                 'decisionRef', v_r.decision_ref, 'requestedBy', v_r.requested_by,
                                 'versionId', v_value),
                               v_r.decision_ref, p_request_id);
  RETURN QUERY SELECT 'APPLIED'::text, v_r.id;
END
$fn$;

-- Annulation d'une demande en attente : par son demandeur (ADMIN ou SUPERADMIN qui détient
-- encore la permission) ou par un SUPERADMIN du pays ; journalisée. Aucun effet sur la valeur.
CREATE FUNCTION core.config_cmd_cancel_param_change(p_token_hash bytea, p_request_id uuid)
  RETURNS TABLE (outcome text, request_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_r    record;
  v_role text;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'paramètre : demande absente' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT r.id, r.key, r.country_code::text AS country_code, r.requested_by, r.status
    INTO v_r FROM core.config_param_change_request AS r WHERE r.id = p_request_id;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'PARAM_CHANGE',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'CANCEL_PARAM_CHANGE'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_r.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'config.param_write', ARRAY[v_r.country_code],
                                       CASE WHEN v_r.requested_by = v_s.user_id
                                            THEN ARRAY['ADMIN', 'SUPERADMIN']
                                            ELSE ARRAY['SUPERADMIN'] END);
  END IF;
  IF v_role IS NULL OR NOT (v_r.country_code = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'PARAM_CHANGE',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_r.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION_OR_COUNTRY' END,
                                   'attempted', 'CANCEL_PARAM_CHANGE',
                                   'permission', 'config.param_write'), NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('config.param:' || v_r.key || ':' || v_r.country_code, 0));
  PERFORM 1 FROM core.config_param_change_request AS r
   WHERE r.id = v_r.id AND r.status = 'PENDING' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_r.id;
    RETURN;
  END IF;
  UPDATE core.config_param_change_request AS r SET status = 'CANCELLED' WHERE r.id = v_r.id;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'PARAM_CHANGE_CANCELLED', 'PARAM_CHANGE',
                               v_r.id, NULL,
                               pg_catalog.jsonb_build_object('key', v_r.key,
                                 'country', v_r.country_code, 'requestedBy', v_r.requested_by),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'CANCELLED'::text, v_r.id;
END
$fn$;

COMMENT ON FUNCTION core.config_cmd_request_param_change(bytea, uuid, text, text, jsonb, text,
                                                         timestamptz, text, text) IS
  'Demande de nouvelle valeur datée d''un paramètre pays (ADMIN ou SUPERADMIN avec '
  'config.param_write, décision écrite du fondateur), validée, sans effet ; jamais une clé '
  'gardée : 17 §2.3, ADM-014. US-535a (ADR-178).';
COMMENT ON FUNCTION core.config_cmd_approve_param_change(bytea, uuid) IS
  'Approbation par une seconde personne réellement distincte (ADMIN ou SUPERADMIN avec '
  'config.param_write) ; fermeture de la version ouverte, nouvelle version, événement et audit '
  'dans la même transaction. US-535a (ADR-178).';
COMMENT ON FUNCTION core.config_cmd_cancel_param_change(bytea, uuid) IS
  'Annulation d''une demande en attente par son demandeur ou un SUPERADMIN du pays, journalisée. '
  'US-535a (ADR-178).';

REVOKE ALL ON FUNCTION core.config_cmd_request_param_change(bytea, uuid, text, text, jsonb, text,
                                                            timestamptz, text, text),
  core.config_cmd_approve_param_change(bytea, uuid),
  core.config_cmd_cancel_param_change(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.config_cmd_request_param_change(bytea, uuid, text, text, jsonb, text,
                                                               timestamptz, text, text),
  core.config_cmd_approve_param_change(bytea, uuid),
  core.config_cmd_cancel_param_change(bytea, uuid) TO app_api;   -- jamais app_worker ni app_anon

GRANT CREATE ON SCHEMA core TO cmd_param_owner;
ALTER FUNCTION core.config_cmd_request_param_change(bytea, uuid, text, text, jsonb, text,
                                                    timestamptz, text, text)
  OWNER TO cmd_param_owner;
ALTER FUNCTION core.config_cmd_approve_param_change(bytea, uuid) OWNER TO cmd_param_owner;
ALTER FUNCTION core.config_cmd_cancel_param_change(bytea, uuid) OWNER TO cmd_param_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_param_owner;
