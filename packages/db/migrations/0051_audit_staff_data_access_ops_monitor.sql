-- 0051 — AUD / exploitation : journal des lectures de données personnelles par le staff et
-- supervision (comptes seulement).
-- US-004 ; 16 ADM-032 (« Given une consultation d'un dossier KYC, Then elle est au journal
-- d'accès » ; « Given un webhook PSP en échec 3 fois, Then une alerte part »), NFR-07, NFR-15 ;
-- 17 §2.3 (`kyc.read_sensitive`, « hors dossier : support_case BREAK_GLASS motivé, journalisé
-- (data_access_log) »), §3.1.4 (C3 : chaque lecture journalisée), §3.2.13, §6.3 ; ADR-051,
-- ADR-062, ADR-080. Appliquée sous `migrator`.
--
-- 1. Permission `kyc.read_sensitive` (17 §2.3, PROPOSÉ, fail-closed) : OPS_AGENT (dossier de sa
--    file : support_case qui lui est assigné ; hors file = support_case BREAK_GLASS motivé) et
--    ADMIN (tout dossier de sa portée pays, journalisé). SUPPORT (« masqué ») : rien en clair ;
--    SUPERADMIN (« bris de glace seulement, double validation ») : rien tant que la double
--    validation n'existe pas (US-405).
-- 2. core.iam_staff_cmd_data_access : la PORTE de toute lecture de données personnelles par le
--    staff. UN appel = une instruction (ADR-056) : session (preuve de possession), TOTP,
--    permission EN COURS dans le pays du DOSSIER (relu en base, jamais reçu du client), dossier
--    ouvert ; puis, si l'accès est accordé, une ligne `data_access_log` (registre de 17 §3.2.13)
--    ET une ligne CHAÎNÉE `audit_log` (`STAFF_DATA_ACCESS`, écrite en dernier) qui la référence :
--    l'accès devient infalsifiable (chaîne SHA-256, ADR-051) et lisible par les rôles qui portent
--    `audit.read` (core.iam_staff_audit_read : ADMIN de son pays, SUPERADMIN, OPS / FINANCE leurs
--    lignes). Un refus est journalisé (STAFF_FORBIDDEN / STAFF_ACCESS_DENIED) sans ligne d'accès.
--    L'API ne rend la donnée que sur l'issue GRANTED, dans la MÊME transaction (fail-closed : sans
--    journal, pas de donnée). Types d'accès : READ_C3 et BREAK_GLASS ; READ_C2_SUPPORT et
--    BULK_EXPORT n'ont pas encore de permission semée (22023, stories SUP et `data.export`).
-- 3. Webhooks PSP : `processing_attempts` compte les passages en échec (QUARANTINED, FAILED) ;
--    le moniteur alerte à 3 (ADM-032).
-- 4. Travailleur `ops_monitor` : core.ops_monitor_metrics, comptes seulement (aucun identifiant,
--    aucune donnée personnelle), lus sous les politiques SELECT EXISTANTES étendues par ALTER
--    POLICY (même choix que booking_oracle, ADR-068 : pas de politique permissive de plus).
--
-- Retour arrière :
--   DROP FUNCTION core.ops_monitor_metrics(timestamptz, integer),
--     core.iam_staff_cmd_data_access(bytea, uuid, uuid, text, uuid, text, text, text);
--   ALTER POLICY des trois politiques vers leurs listes de 0015, 0007 et 0045 (sans ops_monitor) ;
--   REVOKE UPDATE (processing_attempts) ON core.payment_webhook_inbox FROM app_worker;
--   ALTER TABLE core.payment_webhook_inbox DROP COLUMN processing_attempts;
--   DROP POLICY iam_staff_insert ON core.audit_data_access_log;
--   DROP POLICY iam_staff_select ON core.support_support_case;
--   REVOKE … ON core.audit_data_access_log, core.support_support_case FROM iam_staff_owner;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-004%'.

-- 1. Matrice (17 §2.3, PROPOSÉ) ------------------------------------------------------------------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('OPS_AGENT', 'kyc.read_sensitive', 'PLATFORM', '2026-11-04T00:00:00Z',
   'US-004 : matrice 17 §2.3 (lim. : dossier de sa file ; hors file = bris de glace)'),
  ('ADMIN',     'kyc.read_sensitive', 'PLATFORM', '2026-11-04T00:00:00Z',
   'US-004 : matrice 17 §2.3 (journalisé)');

-- 2. Droits du propriétaire iam_staff_owner, au plus juste ----------------------------------------
-- dossier : pays, état, assignation et catégorie (jamais le motif C2)
GRANT SELECT (id, country_code, status, assignee_id, category) ON core.support_support_case
  TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.support_support_case FOR SELECT TO iam_staff_owner
  USING (true);
-- registre des accès : ajout seul (les triggers de 0018 refusent UPDATE / DELETE / TRUNCATE)
GRANT INSERT (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
              access_kind, case_ref, request_id)
  ON core.audit_data_access_log TO iam_staff_owner;
CREATE POLICY iam_staff_insert ON core.audit_data_access_log FOR INSERT TO iam_staff_owner
  WITH CHECK (true);

-- 3. Porte des lectures de données personnelles par le staff ------------------------------------
-- Issues : AUTH_REQUIRED (aucune session : rien n'est écrit, aucun acteur), MFA_REQUIRED et
-- FORBIDDEN (refus journalisés, aucune ligne d'accès), GRANTED (ligne d'accès + audit chaîné).
-- Dossier introuvable, fermé, d'un pays hors portée, non assigné (OPS) ou de catégorie
-- discordante (BREAK_GLASS ⇔ accès BREAK_GLASS) : même issue FORBIDDEN (aucun oracle d'existence).
-- Entrées mal formées : 22023 (rien n'est écrit).
CREATE FUNCTION core.iam_staff_cmd_data_access(p_token_hash bytea, p_request_id uuid,
                                               p_case_id uuid, p_subject_type text,
                                               p_subject_id uuid, p_field_or_file text,
                                               p_access_kind text, p_purpose text)
  RETURNS TABLE (outcome text, access_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s       record;
  v_case    record;
  v_role    text;
  v_reason  text;
  v_id      uuid;
  v_purpose text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_case_id IS NULL OR p_subject_id IS NULL
     OR p_subject_type IS NULL OR p_subject_type !~ '^[A-Z][A-Z0-9_]{1,63}$'
     OR p_field_or_file IS NULL OR p_field_or_file !~ '^[A-Za-z0-9_.:-]{1,160}$'
     OR p_access_kind IS NULL OR p_access_kind NOT IN ('READ_C3', 'BREAK_GLASS')
     OR v_purpose IS NULL OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'accès aux données : entrée invalide ou type d''accès non pris en charge'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', p_subject_type,
                                 p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive',
                                   'access_kind', p_access_kind, 'field_or_file', p_field_or_file),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT c.country_code, c.status, c.assignee_id, c.category INTO v_case
    FROM core.support_support_case AS c WHERE c.id = p_case_id;
  IF v_case.country_code IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'kyc.read_sensitive',
                                       ARRAY[v_case.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_case.country_code IS NULL THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN v_case.status NOT IN ('OPEN', 'PENDING') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_case.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    WHEN (p_access_kind = 'BREAK_GLASS') <> (v_case.category = 'BREAK_GLASS') THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 p_subject_type, p_subject_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive',
                                   'access_kind', p_access_kind, 'field_or_file', p_field_or_file,
                                   'case_id', p_case_id)
                                 || CASE WHEN v_case.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_case.country_code) END,
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  v_id := pg_catalog.gen_random_uuid();
  INSERT INTO core.audit_data_access_log
         (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
          access_kind, case_ref, request_id)
  VALUES (v_id, v_s.user_id, v_role, p_subject_type, p_subject_id, p_field_or_file, v_purpose,
          p_access_kind, p_case_id::text, p_request_id);
  -- audit EN DERNIER (passation US-009 : tête de chaîne tenue jusqu'au COMMIT)
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_DATA_ACCESS', p_subject_type,
                               p_subject_id, NULL,
                               pg_catalog.jsonb_build_object('country', v_case.country_code,
                                 'access_kind', p_access_kind, 'field_or_file', p_field_or_file,
                                 'case_id', p_case_id, 'data_access_id', v_id),
                               v_purpose, p_request_id);
  RETURN QUERY SELECT 'GRANTED'::text, v_id;
END
$fn$;

COMMENT ON FUNCTION core.iam_staff_cmd_data_access(bytea, uuid, uuid, text, uuid, text, text, text) IS
  'Porte des lectures de données personnelles par le staff (ADM-032) : TOTP, kyc.read_sensitive '
  'dans le pays du dossier, dossier ouvert ; data_access_log + audit chaîné. US-004, ADR-080.';

REVOKE ALL ON FUNCTION
  core.iam_staff_cmd_data_access(bytea, uuid, uuid, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.iam_staff_cmd_data_access(bytea, uuid, uuid, text, uuid, text, text, text) TO app_api;

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
ALTER FUNCTION core.iam_staff_cmd_data_access(bytea, uuid, uuid, text, uuid, text, text, text)
  OWNER TO iam_staff_owner;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;

-- 4. Webhooks PSP : passages en échec comptés (ADM-032, « en échec 3 fois ») ---------------------
ALTER TABLE core.payment_webhook_inbox
  ADD COLUMN processing_attempts integer NOT NULL DEFAULT 0
    CONSTRAINT webhook_inbox_processing_attempts_nonneg CHECK (processing_attempts >= 0);
COMMENT ON COLUMN core.payment_webhook_inbox.processing_attempts IS
  'Passages en échec (QUARANTINED, FAILED) du traitement asynchrone ; alerte à 3 (ADM-032). US-004.';
GRANT UPDATE (processing_attempts) ON core.payment_webhook_inbox TO app_worker;

-- 5. Lectures du travailleur ops_monitor (SELECT seulement, politiques existantes) ----------------
ALTER POLICY worker_select_monitor ON core.outbox_outbox_event
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('bus_monitor', 'ops_monitor'));
ALTER POLICY worker_select ON core.payment_webhook_inbox
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('webhook_ingest', 'booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper',
          'ops_monitor'));
ALTER POLICY worker_select ON core.payment_payment_operation
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'hold_expiry',
          'webhook_ingest', 'booking_oracle', 'ops_monitor'));

-- 6. Métriques de supervision (17 §6.3) : comptes seulement ---------------------------------------
-- Lignes (metric, label, country_code, value) ; `label` est un code technique (fournisseur, type
-- d'événement), jamais un identifiant ni une donnée personnelle :
--   outbox_oldest_age_s        âge (s) du plus ancien événement non publié (seuil 17 §6.3 : 120 s) ;
--   webhook_failing            webhooks QUARANTINED / FAILED avec au moins p_webhook_failures
--                              passages en échec, par fournisseur (ADM-032 : 3) ;
--   webhook_signature_rejected webhooks à signature invalide reçus depuis p_since, par fournisseur ;
--   payment_unknown_30m        opérations UNKNOWN depuis plus de 30 min, par pays (17 §6.3) ;
--   p1_event                   événements d'alerte écrits dans l'outbox depuis p_since, par type et
--                              par pays : charge utile `severity` = P1 (oracle C12, invariant,
--                              disposition en retard) et plafond SMS atteint (US-052).
-- Réservée au travailleur ops_monitor (sinon 42501 ops_monitor_forbidden).
CREATE FUNCTION core.ops_monitor_metrics(p_since timestamptz, p_webhook_failures integer)
  RETURNS TABLE (metric text, label text, country_code text, value bigint)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'ops_monitor' THEN
    RAISE EXCEPTION 'ops_monitor: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'ops_monitor_forbidden';
  END IF;
  IF p_since IS NULL OR p_webhook_failures IS NULL OR p_webhook_failures < 1 THEN
    RAISE EXCEPTION 'ops_monitor: paramètres invalides' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_now := platform.now();
  RETURN QUERY
    SELECT 'outbox_oldest_age_s'::text, NULL::text, NULL::text,
           GREATEST(0, COALESCE(pg_catalog.floor(EXTRACT(epoch FROM v_now - pg_catalog.min(e.created_at))), 0))::bigint
      FROM core.outbox_outbox_event AS e
     WHERE e.published_at IS NULL
    UNION ALL
    SELECT 'webhook_failing', w.provider, NULL, pg_catalog.count(*)::bigint
      FROM core.payment_webhook_inbox AS w
     WHERE w.processing_status IN ('QUARANTINED', 'FAILED')
       AND w.processing_attempts >= p_webhook_failures
     GROUP BY w.provider
    UNION ALL
    SELECT 'webhook_signature_rejected', w.provider, NULL, pg_catalog.count(*)::bigint
      FROM core.payment_webhook_inbox AS w
     WHERE w.processing_status = 'REJECTED_SIGNATURE' AND w.received_at > p_since
     GROUP BY w.provider
    UNION ALL
    SELECT 'payment_unknown_30m', NULL, o.country_code, pg_catalog.count(*)::bigint
      FROM core.payment_payment_operation AS o
     WHERE o.status = 'UNKNOWN' AND o.updated_at < v_now - interval '30 minutes'
     GROUP BY o.country_code
    UNION ALL
    SELECT 'p1_event', e.type, e.country_code, pg_catalog.count(*)::bigint
      FROM core.outbox_outbox_event AS e
     WHERE e.created_at > p_since
       AND (e.payload ->> 'severity' = 'P1' OR e.type = 'notification.sms_cap.reached')
     GROUP BY e.type, e.country_code;
END
$fn$;

COMMENT ON FUNCTION core.ops_monitor_metrics(timestamptz, integer) IS
  'Supervision (17 §6.3, ADM-032) : âge de l''outbox, webhooks en échec, opérations UNKNOWN, '
  'alertes P1 de l''outbox ; comptes seulement ; travailleur ops_monitor. US-004, ADR-080.';
REVOKE ALL ON FUNCTION core.ops_monitor_metrics(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.ops_monitor_metrics(timestamptz, integer) TO app_worker;
