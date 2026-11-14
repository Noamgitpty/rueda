-- 0092 — AUD : registre des incidents de sécurité et des violations de données (délais de notification).
-- US-112 ; 19 US-112 (critère 2) ; 16 LEG-010, ADM-035 ; 17 §3.2.13 (`security_incident`), §4.5
-- (`security.incident.opened`), §6.4 (procédure d'incident, astreinte), §2.3 (matrice : PROPOSÉ,
-- aucune ligne de 17 ne nomme le registre) ; 22 OQ-MK-09 (délai de 72 h, PROPOSÉ) ; ADR-062
-- (console), ADR-121 (cette migration, PROPOSÉ). Appliquée sous `migrator`.
-- Paramètres lus : `security_incident_authority_notice_hours`, `security_incident_subjects_notice_hours`
-- (graine 0091).
--
-- Principes (ADR-121) :
--   - une ligne PAR PAYS touché (une autorité de contrôle par pays : ANTAI au Panama, autorité à
--     confirmer au Paraguay) ; un incident qui touche les deux pays est déclaré deux fois, avec le
--     même motif ; lecture de « countries text[] » de 17 §3.2.13 reportée (ADR-121) ;
--   - délais posés À LA DÉCLARATION, depuis l'instant de la détection (`detected_at`, saisi, jamais
--     postérieur à l'instant de la base) : échéance = détection + délai du pays ; délai absent ou
--     invalide ⇒ échéance IMMÉDIATE (fail-closed : un registre n'est jamais refusé faute de délai) ;
--   - données personnelles inconnues (NULL) = touchées (fail-closed) : les échéances s'appliquent
--     tant que l'incident n'est pas qualifié « sans donnée personnelle » ;
--   - aucun texte libre (pas de C2) : le récit et les preuves sont dans le post-mortem, pièce du
--     magasin de preuves (`audit_file_asset`), exigé pour clore ;
--   - commandes SECURITY DEFINER de la console du staff (famille `iam_staff_owner`, ADR-062) :
--     identité tirée de la SESSION (empreinte du jeton), TOTP exigé, permission et pays relus en
--     base, audit chaîné en dernier, événement `security.incident.opened` dans la même
--     transaction ; aucun droit de table pour les rôles applicatifs ; RLS ENABLE + FORCE ;
--   - travailleur `security_incident_watch` : chaque déclaration signalée UNE fois (alerte au
--     fondateur), chaque échéance de notification dépassée signalée UNE fois.
--
-- Défauts PROPOSÉS (fail-closed, ADR-121) : permissions `security.incident_declare` (OPS_AGENT,
-- ADMIN, SUPERADMIN : quiconque détecte peut inscrire) et `security.incident_manage` (ADMIN,
-- SUPERADMIN : qualification, notifications, clôture) ; clôture seulement contenue, notifiée (si
-- données personnelles) et avec post-mortem ; qualification « sans donnée personnelle » refusée après
-- une notification.
--
-- Retour arrière (base sans dépendance) :
--   DROP FUNCTION core.security_incident_cmd_open(bytea, uuid, text, text, text,
--     boolean, integer, timestamptz), core.security_incident_cmd_step(bytea, uuid, uuid,
--     text, uuid), core.security_incident_worker_watch(integer),
--     core.security_incident_notice_hours(text, text), core.security_incident_guard();
--   DROP TABLE core.audit_security_incident;
--   DROP POLICY iam_staff_incident_read ON core.config_param_value;
--   DROP POLICY iam_staff_incident_event ON core.outbox_outbox_event;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-112%'.

-- 1. Permissions de la matrice (17 §2.3 : lignes PROPOSÉES, à reporter dans 17) ---------------------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('OPS_AGENT',  'security.incident_declare', 'PLATFORM', '2026-11-03T00:00:00Z',
   'US-112 : déclaration d''un incident de sécurité (PROPOSÉ, ADR-121)'),
  ('ADMIN',      'security.incident_declare', 'PLATFORM', '2026-11-03T00:00:00Z',
   'US-112 : déclaration d''un incident de sécurité (PROPOSÉ, ADR-121)'),
  ('SUPERADMIN', 'security.incident_declare', 'PLATFORM', '2026-11-03T00:00:00Z',
   'US-112 : déclaration d''un incident de sécurité (PROPOSÉ, ADR-121)'),
  ('ADMIN',      'security.incident_manage',  'PLATFORM', '2026-11-03T00:00:00Z',
   'US-112 : qualification, notifications et clôture (responsable des données, PROPOSÉ, ADR-121)'),
  ('SUPERADMIN', 'security.incident_manage',  'PLATFORM', '2026-11-03T00:00:00Z',
   'US-112 : qualification, notifications et clôture (responsable des données, PROPOSÉ, ADR-121)');

-- 2. Registre (17 §3.2.13 `security_incident`, classe A) ------------------------------------------
CREATE TABLE core.audit_security_incident (
  id                            uuid        NOT NULL
    CONSTRAINT audit_security_incident_pkey PRIMARY KEY,          -- = identifiant de la demande
  country_code                  char(2)     NOT NULL REFERENCES core.config_country (code),
  kind                          text        NOT NULL
    CONSTRAINT audit_security_incident_kind_valid
      CHECK (kind IN ('DATA_BREACH', 'CREDENTIAL_LEAK', 'PSP_CREDENTIAL_COMPROMISE', 'AVAILABILITY',
                      'OTHER')),
  severity                      text        NOT NULL
    CONSTRAINT audit_security_incident_severity_valid
      CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')),
  -- NULL : pas encore qualifié, lu comme « touchées » (fail-closed)
  personal_data_involved        boolean,
  subjects_count_estimate       integer
    CONSTRAINT audit_security_incident_subjects_valid
      CHECK (subjects_count_estimate IS NULL OR subjects_count_estimate >= 0),
  detected_at                   timestamptz NOT NULL,
  reported_at                   timestamptz NOT NULL,
  reported_by                   uuid        NOT NULL REFERENCES core.iam_user_account (id),
  -- échéances posées à la déclaration : détection + délai du pays (OQ-MK-09), immuables
  authority_notification_due_at timestamptz NOT NULL,
  subjects_notification_due_at  timestamptz NOT NULL,
  contained_at                  timestamptz,
  authority_notified_at         timestamptz,
  subjects_notified_at          timestamptz,
  closed_at                     timestamptz,
  status                        text        NOT NULL
    CONSTRAINT audit_security_incident_status_valid
      CHECK (status IN ('OPEN', 'CONTAINED', 'NOTIFIED', 'CLOSED')),
  postmortem_file_id            uuid        REFERENCES core.audit_file_asset (id),
  updated_at                    timestamptz NOT NULL,
  updated_by                    uuid        NOT NULL REFERENCES core.iam_user_account (id),
  -- marques du travailleur security_incident_watch (une alerte par fait)
  opened_alerted_at             timestamptz,
  authority_overdue_alerted_at  timestamptz,
  subjects_overdue_alerted_at   timestamptz,
  CONSTRAINT audit_security_incident_detected CHECK (detected_at <= reported_at),
  CONSTRAINT audit_security_incident_due CHECK (
    authority_notification_due_at >= detected_at AND subjects_notification_due_at >= detected_at),
  CONSTRAINT audit_security_incident_closed CHECK (
    (status = 'CLOSED') = (closed_at IS NOT NULL)
    AND (closed_at IS NULL OR (postmortem_file_id IS NOT NULL AND contained_at IS NOT NULL))),
  -- clos avec données personnelles touchées (ou inconnues) ⇒ autorité ET personnes notifiées
  CONSTRAINT audit_security_incident_closed_notified CHECK (
    closed_at IS NULL OR personal_data_involved IS FALSE
    OR (authority_notified_at IS NOT NULL AND subjects_notified_at IS NOT NULL))
);
CREATE INDEX audit_security_incident_open_idx ON core.audit_security_incident (country_code)
  WHERE (closed_at IS NULL);
COMMENT ON TABLE core.audit_security_incident IS
  'AUD : registre des incidents de sécurité et violations de données (Ley 81, LEG-010, ADM-035) ; '
  'une ligne par pays touché, échéances de notification posées à la déclaration (OQ-MK-09). '
  'Écrit par les seules commandes de la console (iam_staff_owner). US-112 (ADR-121).';

-- Garde (toutes écritures) : aucune suppression ; identité, détection et échéances immuables ; un
-- fait daté ne s'efface ni ne se réécrit ; une ligne close ne bouge plus.
CREATE FUNCTION core.security_incident_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'incident : registre en ajout seul' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'incident : clos, immuable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.kind IS DISTINCT FROM OLD.kind OR NEW.detected_at IS DISTINCT FROM OLD.detected_at
     OR NEW.reported_at IS DISTINCT FROM OLD.reported_at
     OR NEW.reported_by IS DISTINCT FROM OLD.reported_by
     OR NEW.authority_notification_due_at IS DISTINCT FROM OLD.authority_notification_due_at
     OR NEW.subjects_notification_due_at IS DISTINCT FROM OLD.subjects_notification_due_at
     OR (OLD.contained_at IS NOT NULL AND NEW.contained_at IS DISTINCT FROM OLD.contained_at)
     OR (OLD.authority_notified_at IS NOT NULL
         AND NEW.authority_notified_at IS DISTINCT FROM OLD.authority_notified_at)
     OR (OLD.subjects_notified_at IS NOT NULL
         AND NEW.subjects_notified_at IS DISTINCT FROM OLD.subjects_notified_at)
     OR (OLD.opened_alerted_at IS NOT NULL
         AND NEW.opened_alerted_at IS DISTINCT FROM OLD.opened_alerted_at)
     OR (OLD.authority_overdue_alerted_at IS NOT NULL
         AND NEW.authority_overdue_alerted_at IS DISTINCT FROM OLD.authority_overdue_alerted_at)
     OR (OLD.subjects_overdue_alerted_at IS NOT NULL
         AND NEW.subjects_overdue_alerted_at IS DISTINCT FROM OLD.subjects_overdue_alerted_at) THEN
    RAISE EXCEPTION 'incident : identité, détection, échéances et faits datés immuables'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.security_incident_guard() FROM PUBLIC;
CREATE TRIGGER audit_security_incident_guard
  BEFORE UPDATE OR DELETE ON core.audit_security_incident
  FOR EACH ROW EXECUTE FUNCTION core.security_incident_guard();
CREATE TRIGGER audit_security_incident_no_truncate
  BEFORE TRUNCATE ON core.audit_security_incident
  FOR EACH STATEMENT EXECUTE FUNCTION core.security_incident_guard();

ALTER TABLE core.audit_security_incident ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_security_incident FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.audit_security_incident TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.audit_security_incident FROM PUBLIC;

-- 3. Droits d'iam_staff_owner, au plus juste --------------------------------------------------------
GRANT SELECT, INSERT ON core.audit_security_incident TO iam_staff_owner;
GRANT UPDATE (personal_data_involved, contained_at, authority_notified_at, subjects_notified_at,
              closed_at, status, postmortem_file_id, updated_at, updated_by, opened_alerted_at,
              authority_overdue_alerted_at, subjects_overdue_alerted_at)
  ON core.audit_security_incident TO iam_staff_owner;
CREATE POLICY iam_staff_incident_read ON core.audit_security_incident FOR SELECT TO iam_staff_owner
  USING (true);
CREATE POLICY iam_staff_incident_insert ON core.audit_security_incident FOR INSERT
  TO iam_staff_owner
  WITH CHECK (status = 'OPEN' AND closed_at IS NULL AND contained_at IS NULL
              AND authority_notified_at IS NULL AND subjects_notified_at IS NULL
              AND opened_alerted_at IS NULL);
-- verrou (SELECT … FOR UPDATE) et écriture : la garde refuse toute écriture d'une ligne close ; une
-- politique restreinte masquerait la ligne close au verrou (issue INCIDENT_CLOSED attendue)
CREATE POLICY iam_staff_incident_update ON core.audit_security_incident FOR UPDATE
  TO iam_staff_owner USING (true) WITH CHECK (true);

-- délais de notification du pays : ces deux clés seulement
CREATE POLICY iam_staff_incident_read ON core.config_param_value FOR SELECT TO iam_staff_owner
  USING (key IN ('security_incident_authority_notice_hours',
                 'security_incident_subjects_notice_hours'));

-- événement security.incident.opened (17 §4.5 : incident_id, due_at), acteur du staff
CREATE POLICY iam_staff_incident_event ON core.outbox_outbox_event FOR INSERT TO iam_staff_owner
  WITH CHECK (type = 'security.incident.opened' AND aggregate_type = 'security_incident'
              AND actor_user_id IS NOT NULL
              AND actor_role IN ('OPS_AGENT', 'ADMIN', 'SUPERADMIN'));

-- 4. Primitive (SECURITY INVOKER ; EXECUTE au seul iam_staff_owner) --------------------------------
-- Délai en vigueur (heures) d'une clé de portée pays ; NULL si absent ou invalide.
CREATE FUNCTION core.security_incident_notice_hours(p_key text, p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts),
       v AS (
         SELECT x.value
           FROM core.config_param_value AS x CROSS JOIN t
          WHERE x.key = p_key
            AND x.country_code::text = p_country
            AND x.scope_type = 'COUNTRY'
            AND x.valid_from <= t.ts
            AND (x.valid_to IS NULL OR x.valid_to > t.ts)
          ORDER BY x.valid_from DESC
          LIMIT 1)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                   AND (v.value #>> '{}') ~ '^[0-9]{1,5}$'
              THEN (v.value #>> '{}')::integer END
    FROM v
$fn$;
REVOKE ALL ON FUNCTION core.security_incident_notice_hours(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.security_incident_notice_hours(text, text) TO iam_staff_owner;

-- 5. Déclaration (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) ----------------------
-- Issues : AUTH_REQUIRED (aucune session vivante : non journalisé), MFA_REQUIRED, FORBIDDEN
-- (permission ou pays : même issue), DUPLICATE (même demande, même déclarant, même pays et même
-- nature), OPENED. Entrée mal formée, pays inconnu, détection future ou de plus d'un an : 22023.
-- Échéances rendues : détection + délai du pays (0 h si le délai manque : échéance immédiate).
CREATE FUNCTION core.security_incident_cmd_open(p_token_hash bytea, p_request_id uuid,
                                                          p_country text, p_kind text,
                                                          p_severity text, p_personal_data boolean,
                                                          p_subjects_estimate integer,
                                                          p_detected_at timestamptz)
  RETURNS TABLE (outcome text, incident_id uuid, authority_due_at timestamptz,
                 subjects_due_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now      timestamptz := platform.now();
  v_detected timestamptz;
  v_s        record;
  v_role     text;
  v_prev     record;
  v_auth_h   integer;
  v_subj_h   integer;
  v_auth_due timestamptz;
  v_subj_due timestamptz;
BEGIN
  v_detected := COALESCE(p_detected_at, v_now);
  IF p_request_id IS NULL OR p_country IS NULL OR p_country !~ '^[A-Z]{2}$'
     OR NOT EXISTS (SELECT 1 FROM core.config_country AS c WHERE c.code::text = p_country)
     OR p_kind IS NULL
     OR p_kind NOT IN ('DATA_BREACH', 'CREDENTIAL_LEAK', 'PSP_CREDENTIAL_COMPROMISE',
                       'AVAILABILITY', 'OTHER')
     OR p_severity IS NULL OR p_severity NOT IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW')
     OR (p_subjects_estimate IS NOT NULL AND p_subjects_estimate < 0)
     OR v_detected > v_now OR v_detected < v_now - interval '366 days' THEN
    RAISE EXCEPTION 'incident : pays, nature, gravité, estimation ou instant de détection invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'SECURITY_INCIDENT',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'OPEN_SECURITY_INCIDENT', 'country', p_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  v_role := core.iam_staff_permitted(v_s.user_id, 'security.incident_declare', ARRAY[p_country],
                                     NULL);
  IF v_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'SECURITY_INCIDENT',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION_OR_COUNTRY',
                                   'attempted', 'OPEN_SECURITY_INCIDENT',
                                   'permission', 'security.incident_declare',
                                   'country', p_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::timestamptz, NULL::timestamptz;
    RETURN;
  END IF;
  -- idempotence : une demande = un incident (sérialisée)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('audit.security_incident:' || p_request_id::text, 0));
  SELECT i.id, i.reported_by, i.country_code::text AS country_code, i.kind,
         i.authority_notification_due_at, i.subjects_notification_due_at
    INTO v_prev FROM core.audit_security_incident AS i WHERE i.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.reported_by = v_s.user_id AND v_prev.country_code = p_country
       AND v_prev.kind = p_kind THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_prev.id, v_prev.authority_notification_due_at,
                          v_prev.subjects_notification_due_at;
      RETURN;
    END IF;
    RAISE EXCEPTION 'incident : identifiant de demande déjà utilisé'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- délais du pays (OQ-MK-09) ; absents ⇒ échéance immédiate (fail-closed)
  v_auth_h := core.security_incident_notice_hours('security_incident_authority_notice_hours',
                                                        p_country);
  v_subj_h := core.security_incident_notice_hours('security_incident_subjects_notice_hours',
                                                        p_country);
  v_auth_due := v_detected + pg_catalog.make_interval(hours => COALESCE(v_auth_h, 0));
  v_subj_due := v_detected + pg_catalog.make_interval(hours => COALESCE(v_subj_h, 0));
  INSERT INTO core.audit_security_incident
         (id, country_code, kind, severity, personal_data_involved, subjects_count_estimate,
          detected_at, reported_at, reported_by, authority_notification_due_at,
          subjects_notification_due_at, status, updated_at, updated_by)
  VALUES (p_request_id, p_country, p_kind, p_severity, p_personal_data, p_subjects_estimate,
          v_detected, v_now, v_s.user_id, v_auth_due, v_subj_due, 'OPEN', v_now, v_s.user_id);
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  VALUES ('security.incident.opened', 1, 'security_incident', p_request_id, 0, p_country,
          v_s.user_id, v_role, p_request_id, NULL,
          pg_catalog.jsonb_build_object('incident_id', p_request_id, 'country', p_country,
            'kind', p_kind, 'severity', p_severity, 'personal_data', p_personal_data,
            'due_at', v_auth_due, 'subjects_due_at', v_subj_due),
          'security_incident:' || p_request_id::text);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'SECURITY_INCIDENT_OPENED', 'SECURITY_INCIDENT',
                               p_request_id, NULL,
                               pg_catalog.jsonb_build_object('country', p_country, 'kind', p_kind,
                                 'severity', p_severity, 'personalData', p_personal_data,
                                 'subjectsEstimate', p_subjects_estimate,
                                 'detectedAt', v_detected, 'authorityDueAt', v_auth_due,
                                 'subjectsDueAt', v_subj_due,
                                 'noticeHoursKnown', v_auth_h IS NOT NULL AND v_subj_h IS NOT NULL),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'OPENED'::text, p_request_id, v_auth_due, v_subj_due;
END
$fn$;

-- 6. Étapes (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) ---------------------------
-- Étapes : CONTAIN (`security.incident_declare`) ; CONFIRM_PERSONAL_DATA, NO_PERSONAL_DATA,
-- NOTIFY_AUTHORITY, NOTIFY_SUBJECTS, CLOSE (`security.incident_manage`, responsable des données).
-- Chaque fait est daté par la base (platform.now()), une seule fois. Issues : AUTH_REQUIRED,
-- MFA_REQUIRED, FORBIDDEN (permission, pays ou incident introuvable : même issue, journalisée),
-- INCIDENT_CLOSED, ALREADY_DONE, QUALIFICATION_LOCKED (« sans donnée personnelle » après une
-- notification), NOT_CONTAINED, NOTIFICATION_PENDING, POSTMORTEM_REQUIRED (pièce absente, effacée
-- ou hors des seaux de preuves), DONE. Étape inconnue : 22023.
-- Statut : CLOSED > NOTIFIED (notifications exigées faites) > CONTAINED > OPEN.
CREATE FUNCTION core.security_incident_cmd_step(p_token_hash bytea, p_request_id uuid,
                                                          p_incident_id uuid, p_step text,
                                                          p_postmortem_file_id uuid)
  RETURNS TABLE (outcome text, incident_id uuid, status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now    timestamptz := platform.now();
  v_s      record;
  v_i      record;
  v_role   text;
  v_perm   text;
  v_pd     boolean;
  v_cont   timestamptz;
  v_auth   timestamptz;
  v_subj   timestamptz;
  v_closed timestamptz;
  v_file   uuid;
  v_status text;
BEGIN
  IF p_request_id IS NULL OR p_incident_id IS NULL OR p_step IS NULL
     OR p_step NOT IN ('CONTAIN', 'CONFIRM_PERSONAL_DATA', 'NO_PERSONAL_DATA', 'NOTIFY_AUTHORITY',
                       'NOTIFY_SUBJECTS', 'CLOSE')
     OR (p_postmortem_file_id IS NOT NULL AND p_step <> 'CLOSE') THEN
    RAISE EXCEPTION 'incident : demande, incident ou étape invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'SECURITY_INCIDENT',
                                 p_incident_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'SECURITY_INCIDENT_' || p_step),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  v_perm := CASE WHEN p_step = 'CONTAIN' THEN 'security.incident_declare'
                 ELSE 'security.incident_manage' END;
  SELECT i.* INTO v_i FROM core.audit_security_incident AS i WHERE i.id = p_incident_id
     FOR UPDATE;
  IF v_i.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, v_perm, ARRAY[v_i.country_code::text], NULL);
  END IF;
  IF v_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'SECURITY_INCIDENT',
                                 p_incident_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_i.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION_OR_COUNTRY' END,
                                   'attempted', 'SECURITY_INCIDENT_' || p_step,
                                   'permission', v_perm)
                                 || CASE WHEN v_i.id IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_i.country_code) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_i.closed_at IS NOT NULL THEN
    RETURN QUERY SELECT 'INCIDENT_CLOSED'::text, v_i.id, v_i.status;
    RETURN;
  END IF;
  v_pd := v_i.personal_data_involved;
  v_cont := v_i.contained_at;
  v_auth := v_i.authority_notified_at;
  v_subj := v_i.subjects_notified_at;
  v_file := v_i.postmortem_file_id;
  CASE p_step
    WHEN 'CONTAIN' THEN
      IF v_cont IS NOT NULL THEN
        RETURN QUERY SELECT 'ALREADY_DONE'::text, v_i.id, v_i.status;
        RETURN;
      END IF;
      v_cont := v_now;
    WHEN 'CONFIRM_PERSONAL_DATA' THEN
      IF v_pd IS TRUE THEN
        RETURN QUERY SELECT 'ALREADY_DONE'::text, v_i.id, v_i.status;
        RETURN;
      END IF;
      v_pd := true;
    WHEN 'NO_PERSONAL_DATA' THEN
      IF v_pd IS FALSE THEN
        RETURN QUERY SELECT 'ALREADY_DONE'::text, v_i.id, v_i.status;
        RETURN;
      END IF;
      -- une notification faite atteste des données touchées : la qualification ne la défait pas
      IF v_auth IS NOT NULL OR v_subj IS NOT NULL THEN
        RETURN QUERY SELECT 'QUALIFICATION_LOCKED'::text, v_i.id, v_i.status;
        RETURN;
      END IF;
      v_pd := false;
    WHEN 'NOTIFY_AUTHORITY' THEN
      IF v_auth IS NOT NULL THEN
        RETURN QUERY SELECT 'ALREADY_DONE'::text, v_i.id, v_i.status;
        RETURN;
      END IF;
      v_auth := v_now;
    WHEN 'NOTIFY_SUBJECTS' THEN
      IF v_subj IS NOT NULL THEN
        RETURN QUERY SELECT 'ALREADY_DONE'::text, v_i.id, v_i.status;
        RETURN;
      END IF;
      v_subj := v_now;
    WHEN 'CLOSE' THEN
      IF v_cont IS NULL THEN
        RETURN QUERY SELECT 'NOT_CONTAINED'::text, v_i.id, v_i.status;
        RETURN;
      END IF;
      IF v_pd IS NOT FALSE AND (v_auth IS NULL OR v_subj IS NULL) THEN
        RETURN QUERY SELECT 'NOTIFICATION_PENDING'::text, v_i.id, v_i.status;
        RETURN;
      END IF;
      IF p_postmortem_file_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM core.audit_file_asset AS f
                         WHERE f.id = p_postmortem_file_id
                           AND f.bucket IN ('PRIVATE_EVIDENCE', 'DOCUMENTS')
                           AND f.deleted_at IS NULL) THEN
        RETURN QUERY SELECT 'POSTMORTEM_REQUIRED'::text, v_i.id, v_i.status;
        RETURN;
      END IF;
      v_file := p_postmortem_file_id;
      v_closed := v_now;
  END CASE;
  v_status := CASE WHEN v_closed IS NOT NULL THEN 'CLOSED'
                   WHEN v_auth IS NOT NULL AND v_subj IS NOT NULL THEN 'NOTIFIED'
                   WHEN v_cont IS NOT NULL THEN 'CONTAINED'
                   ELSE 'OPEN' END;
  UPDATE core.audit_security_incident AS i
     SET personal_data_involved = v_pd, contained_at = v_cont, authority_notified_at = v_auth,
         subjects_notified_at = v_subj, closed_at = v_closed, status = v_status,
         postmortem_file_id = v_file, updated_at = v_now, updated_by = v_s.user_id
   WHERE i.id = v_i.id;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'SECURITY_INCIDENT_STEP', 'SECURITY_INCIDENT',
                               v_i.id,
                               pg_catalog.jsonb_build_object('status', v_i.status,
                                 'personalData', v_i.personal_data_involved),
                               pg_catalog.jsonb_build_object('country', v_i.country_code,
                                 'step', p_step, 'status', v_status, 'personalData', v_pd,
                                 'at', v_now,
                                 'authorityLate', p_step = 'NOTIFY_AUTHORITY'
                                   AND v_now > v_i.authority_notification_due_at,
                                 'subjectsLate', p_step = 'NOTIFY_SUBJECTS'
                                   AND v_now > v_i.subjects_notification_due_at,
                                 'postmortemFileId', v_file),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'DONE'::text, v_i.id, v_status;
END
$fn$;

-- 7. Travailleur security_incident_watch (SECURITY DEFINER, iam_staff_owner, EXECUTE app_worker) ---
-- Signaux (une fois chacun, marque en base) : OPENED (déclaration nouvelle : alerte au fondateur),
-- AUTHORITY_OVERDUE, SUBJECTS_OVERDUE (échéance dépassée, notification non faite, incident non
-- clos, données personnelles touchées ou inconnues). Rend un compte par (signal, pays).
CREATE FUNCTION core.security_incident_worker_watch(p_batch integer)
  RETURNS TABLE (signal text, country_code text, n integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now    timestamptz := platform.now();
  v_opened uuid[];
  v_auth   uuid[];
  v_subj   uuid[];
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '')
        <> 'security_incident_watch' THEN
    RAISE EXCEPTION 'incident : réservé au travailleur security_incident_watch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'incident : lot invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT pg_catalog.array_agg(x.id) INTO v_opened FROM (
    SELECT i.id FROM core.audit_security_incident AS i
     WHERE i.opened_alerted_at IS NULL AND i.closed_at IS NULL
     ORDER BY i.reported_at, i.id LIMIT p_batch FOR UPDATE OF i SKIP LOCKED) AS x;
  SELECT pg_catalog.array_agg(x.id) INTO v_auth FROM (
    SELECT i.id FROM core.audit_security_incident AS i
     WHERE i.closed_at IS NULL AND i.personal_data_involved IS NOT FALSE
       AND i.authority_notified_at IS NULL AND i.authority_overdue_alerted_at IS NULL
       AND i.authority_notification_due_at <= v_now
     ORDER BY i.authority_notification_due_at, i.id LIMIT p_batch FOR UPDATE OF i SKIP LOCKED) AS x;
  SELECT pg_catalog.array_agg(x.id) INTO v_subj FROM (
    SELECT i.id FROM core.audit_security_incident AS i
     WHERE i.closed_at IS NULL AND i.personal_data_involved IS NOT FALSE
       AND i.subjects_notified_at IS NULL AND i.subjects_overdue_alerted_at IS NULL
       AND i.subjects_notification_due_at <= v_now
     ORDER BY i.subjects_notification_due_at, i.id LIMIT p_batch FOR UPDATE OF i SKIP LOCKED) AS x;
  UPDATE core.audit_security_incident AS i SET opened_alerted_at = v_now
   WHERE i.id = ANY (COALESCE(v_opened, '{}'::uuid[]));
  UPDATE core.audit_security_incident AS i SET authority_overdue_alerted_at = v_now
   WHERE i.id = ANY (COALESCE(v_auth, '{}'::uuid[]));
  UPDATE core.audit_security_incident AS i SET subjects_overdue_alerted_at = v_now
   WHERE i.id = ANY (COALESCE(v_subj, '{}'::uuid[]));
  RETURN QUERY
    SELECT s.signal, i.country_code::text, pg_catalog.count(*)::integer
      FROM (SELECT 'OPENED'::text AS signal, pg_catalog.unnest(COALESCE(v_opened, '{}'::uuid[])) AS id
            UNION ALL
            SELECT 'AUTHORITY_OVERDUE', pg_catalog.unnest(COALESCE(v_auth, '{}'::uuid[]))
            UNION ALL
            SELECT 'SUBJECTS_OVERDUE', pg_catalog.unnest(COALESCE(v_subj, '{}'::uuid[]))) AS s
      JOIN core.audit_security_incident AS i ON i.id = s.id
     GROUP BY s.signal, i.country_code
     ORDER BY s.signal, i.country_code;
END
$fn$;

COMMENT ON FUNCTION core.security_incident_cmd_open(bytea, uuid, text, text, text,
  boolean, integer, timestamptz) IS
  'Déclaration d''un incident de sécurité ou d''une violation de données (un pays) : échéances de '
  'notification posées depuis la détection (OQ-MK-09), événement et audit. US-112 (ADR-121).';
COMMENT ON FUNCTION core.security_incident_cmd_step(bytea, uuid, uuid, text, uuid) IS
  'Étape d''un incident (confinement, qualification, notifications, clôture avec post-mortem), '
  'datée par la base, journalisée. US-112 (ADR-121).';
COMMENT ON FUNCTION core.security_incident_worker_watch(integer) IS
  'Travailleur security_incident_watch : déclarations nouvelles et échéances dépassées signalées '
  'une fois chacune. US-112 (ADR-121).';

REVOKE ALL ON FUNCTION core.security_incident_cmd_open(bytea, uuid, text, text, text,
    boolean, integer, timestamptz),
  core.security_incident_cmd_step(bytea, uuid, uuid, text, uuid),
  core.security_incident_worker_watch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.security_incident_cmd_open(bytea, uuid, text, text, text,
    boolean, integer, timestamptz),
  core.security_incident_cmd_step(bytea, uuid, uuid, text, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION core.security_incident_worker_watch(integer) TO app_worker;

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
ALTER FUNCTION core.security_incident_cmd_open(bytea, uuid, text, text, text, boolean,
  integer, timestamptz) OWNER TO iam_staff_owner;
ALTER FUNCTION core.security_incident_cmd_step(bytea, uuid, uuid, text, uuid)
  OWNER TO iam_staff_owner;
ALTER FUNCTION core.security_incident_worker_watch(integer) OWNER TO iam_staff_owner;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
