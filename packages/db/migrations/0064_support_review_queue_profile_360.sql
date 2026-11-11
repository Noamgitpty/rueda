-- 0064 — SUP : files de revue avec délais, fiche 360°, notes internes, dossiers de support, pièces du staff, restrictions de compte.
-- US-109 ; 19 US-109 ; 16 ADM-005 (fiche 360°), ADM-029 (files), ADM-032 (journal d'accès) ;
-- 08 BR-ACC-10, BR-VERIF-09 ; 17 §2.3 (OPS / SUPPORT : objets couverts par un dossier ou un
-- élément de file assigné ; C3 seulement par `kyc.read_sensitive`, journalisé), §3.2.1
-- (`restriction`), §3.2.13 (`support_case`, `internal_note`, `review_queue_item`,
-- `data_access_log`, `file_asset`), §10 (catalogue des actions de console) ; pré-mortem du lot 1
-- L1-PM-08, L1-PM-33, L1-PM-41 à 43 ; ADR-062, ADR-080, ADR-092, ADR-096, ADR-097 (cette
-- migration). Appliquée sous `migrator`.
--
-- Principes (ADR-097) :
--   - files de revue : `support_review_queue` déclare chaque file (permission, paramètre de délai
--     du pays) ; un élément (`support_review_queue_item`) reçoit son échéance À LA CRÉATION, par
--     la base (`platform.now()` + délai du paramètre du pays ; paramètre absent : refus,
--     fail-closed). Un élément ouvert dont l'échéance est passée est SIGNALÉ (`overdue`) à chaque
--     lecture, calculé par la base. Les files sans paramètre de délai (OVERDUE, GRAY_MARKET,
--     LEG_RECONCILIATION) ne sont pas déclarées : leur story les ajoute ;
--   - aucune lecture directe : app_api, app_worker et app_anon n'ont AUCUN droit sur les tables
--     nouvelles ; tout passe par des commandes SECURITY DEFINER (iam_staff_owner, EXECUTE au seul
--     app_api) qui relisent la session (preuve de possession), le TOTP, la permission EN COURS
--     dans le pays du sujet (relu en base, jamais reçu du client) et la couverture ;
--   - couverture (17 §2.3) : un OPS ou un SUPPORT ne lit la fiche d'une personne que si un
--     dossier ouvert (`support_case`, demandeur = la personne) ou un élément de file ouvert (sujet
--     = la personne ou son compte d'hôte) lui est ASSIGNÉ ; un ADMIN lit toute personne de sa
--     portée pays ; FINANCE et SUPERADMIN : rien (fail-closed, PROPOSÉ) ;
--   - chaque consultation est journalisée AVANT la lecture, dans la même instruction : une ligne
--     `data_access_log` (READ_C2_SUPPORT pour la fiche, READ_C3 pour le dossier KYC) et une ligne
--     CHAÎNÉE `audit_log` (`STAFF_DATA_ACCESS`) ; un refus est journalisé (`STAFF_FORBIDDEN`) ;
--   - dossier KYC : lisible SEULEMENT par la file KYC, sur un élément ouvert assigné à l'acteur
--     (ADMIN : tout élément de sa portée), avec `kyc.read_sensitive` (L1-PM-08). La fiche 360° ne
--     montre que le statut KYC, jamais les pièces (16 ADM-005) ;
--   - restrictions : actions de console `RESTRICT_ACCOUNT` / `LIFT_RESTRICTION` (cadre
--     d'ADR-092 ; saisie `kind` ∈ {TS_HOLD, POLICY_VIOLATION}, motif obligatoire), commande de
--     domaine IAM `core.iam_manual_action_restriction` ; une restriction ACTIVE de la personne
--     refuse la pose d'un hold (`hold_account_restricted` → `ACCOUNT_RESTRICTED`), celle du
--     titulaire d'un compte d'hôte ferme ses véhicules (`hold_host_not_active` →
--     `HOST_NOT_ACTIVATED`, L1-PM-33) ;
--   - pièces du staff : la commande enregistre la ligne `file_asset` (seau PRIVATE_EVIDENCE, C2,
--     chiffrée par la clé du sujet) APRÈS les contrôles de l'API (taille, type réel sur les octets,
--     antivirus `CLEAN` seulement) et AVANT le dépôt (création seule), dans la même transaction.
--
-- Défauts PROPOSÉS (fail-closed, ADR-097) : permissions nouvelles `support.read_profile`,
-- `support.write_note`, `support.case_write` (SUPPORT_AGENT, OPS_AGENT, ADMIN),
-- `ops.restrict_account` (OPS_AGENT, ADMIN), `evidence.upload` (SUPPORT_AGENT, OPS_AGENT, ADMIN) ;
-- délais : heures ouvrées comptées en heures pleines (échéance plus tôt, jamais plus tard) ;
-- note de 1 à 2000 caractères ; motif d'accès de 10 à 500 caractères ; 200 éléments par lecture.
--
-- Retour arrière :
--   reprendre la définition de core.booking_cmd_place_hold de 0056 (sous cmd_hold_owner) ;
--   DELETE FROM core.support_manual_action_handler WHERE action_code IN ('RESTRICT_ACCOUNT', 'LIFT_RESTRICTION');
--   DELETE FROM core.support_manual_action_catalog WHERE action_code IN ('RESTRICT_ACCOUNT', 'LIFT_RESTRICTION');
--   DROP FUNCTION core.support_staff_queues(bytea, text, integer),
--     core.support_staff_claim_item(bytea, uuid, uuid), core.support_staff_kyc_dossier(bytea, uuid, uuid, text),
--     core.support_staff_find_user(bytea, uuid, text, text), core.support_staff_profile(bytea, uuid, uuid, text),
--     core.support_staff_add_note(bytea, uuid, uuid, text), core.support_staff_open_case(bytea, uuid, uuid, text, text, text),
--     core.support_staff_set_case_status(bytea, uuid, uuid, text),
--     core.support_staff_record_evidence(bytea, uuid, uuid, text, bigint, bytea),
--     core.support_staff_evidence_permitted(bytea, uuid, uuid),
--     core.iam_manual_action_restriction(bytea, uuid, text, uuid, jsonb, text, uuid, text),
--     core.support_enqueue_review(text, text, uuid, text, uuid), core.support_staff_covers_user(uuid, text, uuid, text),
--     core.support_staff_log_access(uuid, text, text, uuid, text, text, text, text, uuid, text),
--     core.support_queue_sla_minutes(text, text);
--   DROP TABLE core.support_internal_note, core.support_review_queue_item, core.support_review_queue;
--   DROP INDEX core.restriction_user_kind_active_unique ;
--   DROP POLICY des rôles propriétaires ci-dessous ; révoquer leurs droits ;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-109%'.

-- 1. Files de revue déclarées ---------------------------------------------------------------------
-- Une ligne par file : permission de la file et paramètre de délai du pays (17 §7.2, ADM-031).
-- `sla_unit_minutes` convertit l'unité du paramètre en minutes (h et heures ouvrées : 60, min : 1).
CREATE TABLE core.support_review_queue (
  queue            text    CONSTRAINT review_queue_pkey PRIMARY KEY
    CONSTRAINT review_queue_queue_valid CHECK (queue IN ('KYC', 'LISTING', 'HOST_VERIFICATION',
      'RISK_BOOKING', 'OVERDUE', 'GRAY_MARKET', 'CATALOG_ADDITION', 'LEG_RECONCILIATION')),
  permission_code  text    NOT NULL
    CONSTRAINT review_queue_permission_format CHECK (permission_code ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  sla_param_key    text    NOT NULL
    CONSTRAINT review_queue_sla_param_format CHECK (sla_param_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  sla_unit_minutes integer NOT NULL
    CONSTRAINT review_queue_sla_unit_valid CHECK (sla_unit_minutes IN (1, 60)),
  story            text    NOT NULL
    CONSTRAINT review_queue_story_format CHECK (story ~ '^US-[0-9]{3}$')
);
ALTER TABLE core.support_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.support_review_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.support_review_queue TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.support_review_queue FROM PUBLIC;
COMMENT ON TABLE core.support_review_queue IS
  'Files de revue déclarées (17 §3.2.13 review_queue_item.queue) : permission et paramètre de délai '
  'du pays (ADM-031). Écrite par migration seulement. US-109 (ADR-097).';

INSERT INTO core.support_review_queue (queue, permission_code, sla_param_key, sla_unit_minutes, story)
VALUES
  ('KYC',               'kyc.decide',              'kyc_review_sla_business_h',       60, 'US-109'),
  ('HOST_VERIFICATION', 'ops.review_listing_host', 'kyc_review_sla_business_h',       60, 'US-109'),
  ('LISTING',           'ops.review_listing_host', 'listing_review_sla_h',            60, 'US-109'),
  ('CATALOG_ADDITION',  'ops.review_listing_host', 'catalog_addition_sla_business_h', 60, 'US-109'),
  ('RISK_BOOKING',      'kyc.decide',              'review_hold_minutes',              1, 'US-109');

-- 2. Éléments de file (17 §3.2.13 review_queue_item ; classe B) -------------------------------------
CREATE TABLE core.support_review_queue_item (
  id           uuid        CONSTRAINT review_queue_item_pkey PRIMARY KEY,
  queue        text        NOT NULL
    CONSTRAINT review_queue_item_queue_fk REFERENCES core.support_review_queue (queue),
  subject_type text        NOT NULL
    CONSTRAINT review_queue_item_subject_type_format CHECK (subject_type ~ '^[A-Z][A-Z_]{1,63}$'),
  subject_id   uuid        NOT NULL,
  country_code text        NOT NULL
    CONSTRAINT review_queue_item_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  status       text        NOT NULL DEFAULT 'OPEN'
    CONSTRAINT review_queue_item_status_valid CHECK (status IN ('OPEN', 'IN_REVIEW', 'DONE', 'CANCELLED')),
  sla_due_at   timestamptz NOT NULL,
  assignee_id  uuid        REFERENCES core.iam_user_account (id),
  assigned_at  timestamptz,
  decision     text
    CONSTRAINT review_queue_item_decision_format CHECK (decision ~ '^[A-Z][A-Z_]{1,63}$'),
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT platform.now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT platform.now(),
  updated_by   uuid,
  row_version  integer     NOT NULL DEFAULT 0,
  CONSTRAINT review_queue_item_sla_after_creation CHECK (sla_due_at >= created_at),
  CONSTRAINT review_queue_item_assignment CHECK ((assignee_id IS NULL) = (assigned_at IS NULL)),
  CONSTRAINT review_queue_item_in_review_assigned CHECK (status <> 'IN_REVIEW' OR assignee_id IS NOT NULL),
  CONSTRAINT review_queue_item_decided CHECK ((status IN ('DONE', 'CANCELLED')) = (decided_at IS NOT NULL))
);
-- un seul élément vivant par sujet et par file
CREATE UNIQUE INDEX review_queue_item_live_unique ON core.support_review_queue_item
  (queue, subject_type, subject_id) WHERE (status IN ('OPEN', 'IN_REVIEW'));
CREATE INDEX review_queue_item_queue_due_idx ON core.support_review_queue_item
  (queue, country_code, sla_due_at) WHERE (status IN ('OPEN', 'IN_REVIEW'));
CREATE INDEX review_queue_item_subject_idx ON core.support_review_queue_item (subject_type, subject_id);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.support_review_queue_item
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
ALTER TABLE core.support_review_queue_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.support_review_queue_item FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.support_review_queue_item TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.support_review_queue_item FROM PUBLIC;
COMMENT ON TABLE core.support_review_queue_item IS
  'SUP review_queue_item (17 §3.2.13) : échéance posée par la base à la création (paramètre du '
  'pays), signalé en retard à la lecture. Aucun droit des rôles applicatifs. US-109 (ADR-097).';

-- 3. Notes internes (17 §3.2.13 internal_note ; jamais visibles des clients ; ajout seul) ---------
CREATE TABLE core.support_internal_note (
  id             uuid        CONSTRAINT internal_note_pkey PRIMARY KEY,
  subject_type   text        NOT NULL
    CONSTRAINT internal_note_subject_type_valid CHECK (subject_type IN ('USER_ACCOUNT')),
  subject_id     uuid        NOT NULL,
  country_code   text        NOT NULL
    CONSTRAINT internal_note_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  author_user_id uuid        NOT NULL REFERENCES core.iam_user_account (id),
  author_role    text        NOT NULL
    CONSTRAINT internal_note_author_role_format CHECK (author_role ~ '^[A-Z][A-Z_]{1,63}$'),
  body           text        NOT NULL                                  -- [C2]
    CONSTRAINT internal_note_body_length CHECK (
      pg_catalog.char_length(pg_catalog.btrim(body)) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT platform.now()
);
CREATE INDEX internal_note_subject_idx ON core.support_internal_note (subject_type, subject_id, created_at);
ALTER TABLE core.support_internal_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.support_internal_note FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.support_internal_note TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.support_internal_note FROM PUBLIC;
CREATE TRIGGER internal_note_append_only
  BEFORE UPDATE OR DELETE ON core.support_internal_note
  FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('internal_note_append_only');
CREATE TRIGGER internal_note_no_truncate
  BEFORE TRUNCATE ON core.support_internal_note
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('internal_note_append_only');
COMMENT ON TABLE core.support_internal_note IS
  'SUP internal_note (17 §3.2.13) : jamais visible des clients ; ajout seul ; écrite et lue par '
  'les commandes de la console seulement. US-109 (ADR-097).';

-- 4. Restrictions : une seule restriction ACTIVE par personne et par type -------------------------
CREATE UNIQUE INDEX restriction_user_kind_active_unique ON core.iam_restriction (user_id, kind)
  WHERE (active);

-- 5. Matrice (17 §2.3 ; PROPOSÉ là où 17 ne nomme pas la permission, 16 ADM-005 « Permissions ») --
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('SUPPORT_AGENT', 'support.read_profile', 'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 16 ADM-005 (lecture, dossier assigné)'),
  ('OPS_AGENT',     'support.read_profile', 'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 16 ADM-005 (lecture, dossier assigné)'),
  ('ADMIN',         'support.read_profile', 'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 17 §2.3 (tout, journalisé)'),
  ('SUPPORT_AGENT', 'support.write_note',   'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 16 ADM-005 (notes)'),
  ('OPS_AGENT',     'support.write_note',   'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 16 ADM-005 (notes)'),
  ('ADMIN',         'support.write_note',   'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 16 ADM-005 (notes)'),
  ('SUPPORT_AGENT', 'support.case_write',   'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 17 §2.3 (dossier de support)'),
  ('OPS_AGENT',     'support.case_write',   'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 17 §2.3 (dossier de support)'),
  ('ADMIN',         'support.case_write',   'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 17 §2.3 (dossier de support)'),
  ('OPS_AGENT',     'ops.restrict_account', 'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 16 ADM-005 (restrictions)'),
  ('ADMIN',         'ops.restrict_account', 'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : 16 ADM-005 (restrictions)'),
  ('SUPPORT_AGENT', 'evidence.upload',      'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : pièces des actions de console'),
  ('OPS_AGENT',     'evidence.upload',      'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : pièces des actions de console'),
  ('ADMIN',         'evidence.upload',      'PLATFORM', '2026-11-11T00:00:00Z', 'US-109 : pièces des actions de console');

-- 6. Droits d'iam_staff_owner (propriétaire des commandes de la console), au plus juste ----------
GRANT SELECT ON core.support_review_queue TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.support_review_queue FOR SELECT TO iam_staff_owner USING (true);

GRANT SELECT, INSERT (id, queue, subject_type, subject_id, country_code, status, sla_due_at,
                      created_by, updated_by)
  ON core.support_review_queue_item TO iam_staff_owner;
GRANT UPDATE (status, assignee_id, assigned_at, updated_by) ON core.support_review_queue_item
  TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.support_review_queue_item FOR SELECT TO iam_staff_owner
  USING (true);
CREATE POLICY iam_staff_insert ON core.support_review_queue_item FOR INSERT TO iam_staff_owner
  WITH CHECK (status = 'OPEN');
CREATE POLICY iam_staff_update ON core.support_review_queue_item FOR UPDATE TO iam_staff_owner
  USING (status IN ('OPEN', 'IN_REVIEW')) WITH CHECK (status IN ('OPEN', 'IN_REVIEW'));

GRANT SELECT, INSERT (id, subject_type, subject_id, country_code, author_user_id, author_role, body)
  ON core.support_internal_note TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.support_internal_note FOR SELECT TO iam_staff_owner USING (true);
CREATE POLICY iam_staff_insert ON core.support_internal_note FOR INSERT TO iam_staff_owner
  WITH CHECK (true);

-- dossiers de support : ouverture (assignée à l'acteur) et changement d'état, jamais un bris de
-- glace (procédure hors application, ADR-062) ; la lecture d'iam_staff_select (0051) est élargie
-- aux colonnes non personnelles du dossier (jamais le motif C2)
GRANT SELECT (requester_user_id, trip_id, channel, priority, sla_due_at, created_at)
  ON core.support_support_case TO iam_staff_owner;
GRANT INSERT (id, requester_user_id, country_code, channel, category, priority, status, assignee_id,
              created_by, updated_by)
  ON core.support_support_case TO iam_staff_owner;
GRANT UPDATE (status, updated_by) ON core.support_support_case TO iam_staff_owner;
CREATE POLICY iam_staff_insert ON core.support_support_case FOR INSERT TO iam_staff_owner
  WITH CHECK (category <> 'BREAK_GLASS' AND status = 'OPEN' AND trip_id IS NULL AND reason IS NULL);
CREATE POLICY iam_staff_update ON core.support_support_case FOR UPDATE TO iam_staff_owner
  USING (category <> 'BREAK_GLASS') WITH CHECK (category <> 'BREAK_GLASS');

-- fiche 360° : profil (C2, jamais le mot de passe), restrictions, comptes d'hôte, trips
GRANT SELECT (email, email_verified_at, phone_e164, phone_verified_at, legal_first_name,
              legal_last_name, display_name, date_of_birth, preferred_locale, residence_country,
              pseudonymized_at, created_at)
  ON core.iam_user_account TO iam_staff_owner;
GRANT SELECT (id, user_id, kind, active, reason, created_at, lifted_at) ON core.iam_restriction
  TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.iam_restriction FOR SELECT TO iam_staff_owner USING (true);
GRANT SELECT (kind, holder_user_id, display_name, status) ON core.iam_organization TO iam_staff_owner;
GRANT SELECT (guest_user_id, org_id, status, scheduled_start, scheduled_end, public_ref)
  ON core.booking_trip TO iam_staff_owner;

-- délais des files : les seuls paramètres déclarés par support_review_queue
GRANT SELECT (key, country_code, scope_type, value, valid_from, valid_to)
  ON core.config_param_value TO iam_staff_owner;
CREATE POLICY iam_staff_sla_read ON core.config_param_value FOR SELECT TO iam_staff_owner
  USING (key IN ('kyc_review_sla_business_h', 'listing_review_sla_h',
                 'catalog_addition_sla_business_h', 'review_hold_minutes'));

-- pièces du staff : seau PRIVATE_EVIDENCE, C2 chiffré par la clé d'une personne, téléversement du
-- staff (la politique de 0042 reste celle des fichiers de marque ; les deux sont permissives)
GRANT INSERT (enc_subject_type, enc_subject_id) ON core.audit_file_asset TO iam_staff_owner;
GRANT SELECT (sha256, uploader_user_id) ON core.audit_file_asset TO iam_staff_owner;
CREATE POLICY iam_staff_evidence_insert ON core.audit_file_asset FOR INSERT TO iam_staff_owner
  WITH CHECK (bucket = 'PRIVATE_EVIDENCE' AND classification = 'C2' AND source = 'STAFF_UPLOAD'
              AND enc_subject_type = 'USER' AND enc_subject_id IS NOT NULL
              AND retention_class = 'STAFF_EVIDENCE');
GRANT SELECT (subject_type, subject_id, destroyed_at) ON core.audit_subject_key TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.audit_subject_key FOR SELECT TO iam_staff_owner USING (true);

-- 7. Aides internes (SECURITY INVOKER, propriétaire migrator, EXECUTE à iam_staff_owner) ---------
-- Délai d'une file dans un pays, en minutes ; NULL si la file ou le paramètre manque.
CREATE FUNCTION core.support_queue_sla_minutes(p_queue text, p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                   AND (v.value #>> '{}') ~ '^[0-9]{1,6}$'
                   AND (v.value #>> '{}')::integer >= 1
              THEN (v.value #>> '{}')::integer * q.sla_unit_minutes END
    FROM core.support_review_queue AS q
    JOIN core.config_param_value AS v ON v.key = q.sla_param_key
   CROSS JOIN t
   WHERE q.queue = p_queue
     AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts
     AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

-- Mise en file (appelée par les commandes de domaine des stories productrices : US-106, US-108,
-- US-114, US-118, US-209 ; leur propriétaire reçoit EXECUTE dans leur migration). Échéance posée
-- par la base. Issues : CREATED (id), EXISTS (élément vivant déjà présent : son id),
-- QUEUE_UNKNOWN, PARAM_MISSING. Deux mises en file concurrentes du même sujet sont sérialisées.
CREATE FUNCTION core.support_enqueue_review(p_queue text, p_subject_type text, p_subject_id uuid,
                                            p_country text, p_actor uuid)
  RETURNS TABLE (outcome text, item_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_minutes integer;
  v_id      uuid;
  v_now     timestamptz := platform.now();
BEGIN
  IF p_queue IS NULL OR p_subject_type IS NULL OR p_subject_type !~ '^[A-Z][A-Z_]{1,63}$'
     OR p_subject_id IS NULL OR p_country IS NULL OR p_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'file de revue : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.support_review_queue AS q WHERE q.queue = p_queue) THEN
    RETURN QUERY SELECT 'QUEUE_UNKNOWN'::text, NULL::uuid;
    RETURN;
  END IF;
  v_minutes := core.support_queue_sla_minutes(p_queue, p_country);
  IF v_minutes IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'support.review_queue:' || p_queue || ':' || p_subject_type || ':' || p_subject_id::text, 0));
  SELECT i.id INTO v_id
    FROM core.support_review_queue_item AS i
   WHERE i.queue = p_queue AND i.subject_type = p_subject_type AND i.subject_id = p_subject_id
     AND i.status IN ('OPEN', 'IN_REVIEW');
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'EXISTS'::text, v_id;
    RETURN;
  END IF;
  v_id := pg_catalog.gen_random_uuid();
  INSERT INTO core.support_review_queue_item
         (id, queue, subject_type, subject_id, country_code, status, sla_due_at, created_by, updated_by)
  VALUES (v_id, p_queue, p_subject_type, p_subject_id, p_country, 'OPEN',
          v_now + pg_catalog.make_interval(mins => v_minutes), p_actor, p_actor);
  RETURN QUERY SELECT 'CREATED'::text, v_id;
END
$fn$;

-- Dossier (case:<id>) ou élément de file (item:<id>) OUVERT, assigné à p_actor, qui couvre la
-- personne p_user dans le pays p_country (17 §2.3) ; NULL sinon.
CREATE FUNCTION core.support_staff_covers_user(p_actor uuid, p_role text, p_user uuid, p_country text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
    (SELECT 'case:' || c.id::text
       FROM core.support_support_case AS c
      WHERE c.requester_user_id = p_user AND c.assignee_id = p_actor
        AND c.status IN ('OPEN', 'PENDING') AND c.country_code = p_country
        AND c.category <> 'BREAK_GLASS'
      ORDER BY c.created_at DESC LIMIT 1),
    (SELECT 'item:' || i.id::text
       FROM core.support_review_queue_item AS i
      WHERE i.assignee_id = p_actor AND i.status IN ('OPEN', 'IN_REVIEW')
        AND i.country_code = p_country
        AND ((i.subject_type = 'USER_ACCOUNT' AND i.subject_id = p_user)
             OR (i.subject_type = 'ORGANIZATION'
                 AND i.subject_id IN (SELECT o.id FROM core.iam_organization AS o
                                       WHERE o.holder_user_id = p_user)))
      ORDER BY i.created_at DESC LIMIT 1),
    CASE WHEN p_role = 'ADMIN' THEN 'scope:' || p_country END)
$fn$;

-- Journal d'accès (data_access_log) puis ligne CHAÎNÉE STAFF_DATA_ACCESS (écrite en dernier).
CREATE FUNCTION core.support_staff_log_access(p_actor uuid, p_role text, p_subject_type text,
                                              p_subject_id uuid, p_field text, p_kind text,
                                              p_purpose text, p_case_ref text, p_request_id uuid,
                                              p_country text)
  RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id uuid := pg_catalog.gen_random_uuid();
BEGIN
  INSERT INTO core.audit_data_access_log
         (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
          access_kind, case_ref, request_id)
  VALUES (v_id, p_actor, p_role, p_subject_type, p_subject_id, p_field, p_purpose, p_kind,
          p_case_ref, p_request_id);
  PERFORM core.iam_staff_audit(p_actor, p_role, 'STAFF_DATA_ACCESS', p_subject_type, p_subject_id,
                               NULL,
                               pg_catalog.jsonb_build_object('country', p_country,
                                 'access_kind', p_kind, 'field_or_file', p_field,
                                 'case_ref', p_case_ref, 'data_access_id', v_id),
                               p_purpose, p_request_id);
  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION core.support_queue_sla_minutes(text, text),
  core.support_enqueue_review(text, text, uuid, text, uuid),
  core.support_staff_covers_user(uuid, text, uuid, text),
  core.support_staff_log_access(uuid, text, text, uuid, text, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_queue_sla_minutes(text, text),
  core.support_enqueue_review(text, text, uuid, text, uuid),
  core.support_staff_covers_user(uuid, text, uuid, text),
  core.support_staff_log_access(uuid, text, text, uuid, text, text, text, text, uuid, text)
  TO iam_staff_owner;
COMMENT ON FUNCTION core.support_enqueue_review(text, text, uuid, text, uuid) IS
  'Mise en file de revue : échéance = platform.now() + délai du paramètre du pays (absent : '
  'PARAM_MISSING) ; un élément vivant par sujet et par file. US-109 (ADR-097).';

-- 8. Restrictions de compte : commande de domaine liée (cadre d'ADR-092) --------------------------
GRANT SELECT (id, user_id, kind, active) ON core.iam_restriction TO iam_auth_owner;
GRANT INSERT (id, user_id, kind, active, reason, source_ref, created_by, updated_by)
  ON core.iam_restriction TO iam_auth_owner;
GRANT UPDATE (active, lifted_at, updated_by) ON core.iam_restriction TO iam_auth_owner;
CREATE POLICY iam_auth_select ON core.iam_restriction FOR SELECT TO iam_auth_owner USING (true);
-- seules les restrictions manuelles s'écrivent ici (dettes, litiges : leurs stories)
CREATE POLICY iam_auth_insert ON core.iam_restriction FOR INSERT TO iam_auth_owner
  WITH CHECK (kind IN ('TS_HOLD', 'POLICY_VIOLATION') AND active);
CREATE POLICY iam_auth_update ON core.iam_restriction FOR UPDATE TO iam_auth_owner
  USING (kind IN ('TS_HOLD', 'POLICY_VIOLATION') AND active)
  WITH CHECK (kind IN ('TS_HOLD', 'POLICY_VIOLATION') AND NOT active);

INSERT INTO core.support_manual_action_catalog
       (action_code, permission_code, mode, subject_type, available, input_keys, input_values,
        requires_approval)
VALUES
  ('RESTRICT_ACCOUNT',  'ops.restrict_account', 'DOMAIN_COMMAND', 'USER_ACCOUNT', false, '{kind}',
   '{"kind": ["TS_HOLD", "POLICY_VIOLATION"]}', false),
  ('LIFT_RESTRICTION',  'ops.restrict_account', 'DOMAIN_COMMAND', 'USER_ACCOUNT', false, '{kind}',
   '{"kind": ["TS_HOLD", "POLICY_VIOLATION"]}', false);

-- Gestionnaire (signature imposée par support_manual_action_handler_check). Issues : DONE (ref_id =
-- la restriction), SUBJECT_NOT_FOUND, KIND_REQUIRED, RESTRICTION_EXISTS (pose), RESTRICTION_NOT_FOUND
-- (levée). Le motif de l'action devient celui de la restriction ; aucune saisie libre d'autre sorte.
CREATE FUNCTION core.iam_manual_action_restriction(p_token_hash bytea, p_action_id uuid,
                                                   p_action_code text, p_subject_id uuid,
                                                   p_input jsonb, p_reason text,
                                                   p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_kind text := p_input ->> 'kind';
  v_id   uuid;
BEGIN
  IF p_action_code IS NULL OR p_action_code NOT IN ('RESTRICT_ACCOUNT', 'LIFT_RESTRICTION')
     OR p_action_id IS NULL OR p_subject_id IS NULL OR p_actor IS NULL OR p_actor_role IS NULL
     OR p_reason IS NULL THEN
    RAISE EXCEPTION 'restriction : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('TS_HOLD', 'POLICY_VIOLATION') THEN
    RETURN QUERY SELECT 'KIND_REQUIRED'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM core.iam_user_account AS u WHERE u.id = p_subject_id) THEN
    RETURN QUERY SELECT 'SUBJECT_NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('iam.restriction:' || p_subject_id::text || ':' || v_kind, 0));
  SELECT r.id INTO v_id FROM core.iam_restriction AS r
   WHERE r.user_id = p_subject_id AND r.kind = v_kind AND r.active;
  IF p_action_code = 'RESTRICT_ACCOUNT' THEN
    IF v_id IS NOT NULL THEN
      RETURN QUERY SELECT 'RESTRICTION_EXISTS'::text, v_id, '{}'::uuid[];
      RETURN;
    END IF;
    INSERT INTO core.iam_restriction (id, user_id, kind, active, reason, source_ref, created_by,
                                      updated_by)
    VALUES (p_action_id, p_subject_id, v_kind, true, pg_catalog.btrim(p_reason),
            'manual_action:' || p_action_id::text, p_actor, p_actor);
    RETURN QUERY SELECT 'DONE'::text, p_action_id, '{}'::uuid[];
    RETURN;
  END IF;
  IF v_id IS NULL THEN
    RETURN QUERY SELECT 'RESTRICTION_NOT_FOUND'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  UPDATE core.iam_restriction AS r
     SET active = false, lifted_at = platform.now(), updated_by = p_actor
   WHERE r.id = v_id;
  RETURN QUERY SELECT 'DONE'::text, v_id, '{}'::uuid[];
END
$fn$;
COMMENT ON FUNCTION core.iam_manual_action_restriction(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à RESTRICT_ACCOUNT et LIFT_RESTRICTION (cadre d''US-101) : pose ou levée d''une '
  'restriction manuelle (TS_HOLD, POLICY_VIOLATION) motivée. EXECUTE iam_staff_owner. US-109.';
REVOKE ALL ON FUNCTION core.iam_manual_action_restriction(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_manual_action_restriction(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  TO iam_staff_owner;
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
ALTER FUNCTION core.iam_manual_action_restriction(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO iam_auth_owner;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;

INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES
  ('RESTRICT_ACCOUNT',
   'core.iam_manual_action_restriction(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
   'US-109'),
  ('LIFT_RESTRICTION',
   'core.iam_manual_action_restriction(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
   'US-109');

-- 9. Pose d'un hold : une restriction active refuse la réservation (16 ADM-005, BKG-012) --------
GRANT SELECT (user_id, active) ON core.iam_restriction TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.iam_restriction FOR SELECT TO cmd_hold_owner USING (true);
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- Corps de 0056 recopié à l'identique, plus les deux contrôles de restriction (étape marquée
-- US-109), placés après l'auto-réservation et avant toute lecture de paramètre ou tout verrou.
CREATE OR REPLACE FUNCTION core.booking_cmd_place_hold(
  p_vehicle_id uuid,
  p_start      timestamptz,
  p_end        timestamptz,
  p_flagged    boolean
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest      uuid := app.actor_id();
  v_org        uuid;
  v_country    text;
  v_holder     uuid;
  v_org_status text;
  v_buffer     integer;
  v_ttl        integer;
  v_max_total  integer;
  v_max_live   integer;
  v_rate       integer;
  v_grace      integer;
  v_order      text;
  v_review     boolean;
  v_minutes    integer;
  v_live       integer;
  v_overlap    boolean;
  v_recent     integer;
  v_now        timestamptz;
  v_expires_at timestamptz;
  v_period     tstzrange;
  v_hold       uuid := pg_catalog.gen_random_uuid();
  v_occupancy  uuid := pg_catalog.gen_random_uuid();
  v_max_days   integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  -- US-049 (RT-CONC-02) : bornes finies (une fin infinie occuperait le véhicule sans limite)
  IF p_vehicle_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT pg_catalog.isfinite(p_start)
     OR NOT pg_catalog.isfinite(p_end) OR p_end <= p_start OR p_start <= platform.now() THEN
    RAISE EXCEPTION 'hold: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;

  SELECT p.org_id, p.country_code INTO v_org, v_country
    FROM core.booking_vehicle_party(p_vehicle_id) AS p;
  IF v_org IS NULL OR v_country IS NULL THEN
    RAISE EXCEPTION 'hold: vehicle unknown'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_vehicle_unknown';
  END IF;
  SELECT o.holder_user_id, o.status INTO v_holder, v_org_status
    FROM core.iam_organization o
   WHERE o.id = v_org AND o.country_code = v_country;
  IF v_org_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'hold: host not active'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_host_not_active';
  END IF;
  -- self_booking_forbidden (16 BKG-012, Bêta : contrôle hôte / voyageur à la pose). US-049
  -- (F-RLS-02) : le titulaire, et tout membre du compte d'hôte du véhicule (co-hôte compris,
  -- appartenance active ou en attente), quel que soit le pays
  IF v_holder = v_guest
     OR EXISTS (SELECT 1 FROM core.iam_membership m
                 WHERE m.org_id = v_org AND m.user_id = v_guest
                   AND m.status IN ('ACTIVE', 'INVITED')) THEN
    RAISE EXCEPTION 'hold: self booking'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_self_booking';
  END IF;
  -- US-109 (16 ADM-005, BKG-012 ; 08 BR-ACC-10) : une restriction ACTIVE du voyageur refuse toute
  -- réservation ; celle du titulaire du compte d'hôte ferme ses véhicules (L1-PM-33)
  IF EXISTS (SELECT 1 FROM core.iam_restriction r WHERE r.user_id = v_guest AND r.active) THEN
    RAISE EXCEPTION 'hold: account restricted'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_account_restricted';
  END IF;
  IF EXISTS (SELECT 1 FROM core.iam_restriction r WHERE r.user_id = v_holder AND r.active) THEN
    RAISE EXCEPTION 'hold: host not active'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_host_not_active';
  END IF;

  v_buffer    := core.booking_param_int('buffer_minutes', v_country);
  v_ttl       := core.booking_param_int('hold_ttl_minutes', v_country);
  v_max_total := core.booking_param_int('hold_max_total_minutes', v_country);
  v_max_live  := core.booking_param_int('max_active_holds_per_guest', v_country);
  v_rate      := core.booking_param_int('hold_creations_per_guest_vehicle_hour', v_country);
  v_grace     := core.booking_param_int('sweep_grace_s', v_country);
  v_max_days  := core.booking_param_int('max_trip_days', v_country);  -- US-049 (RT-CONC-02)
  v_review    := COALESCE(p_flagged, true)
                 AND COALESCE(core.booking_param_text('flagged_booking_payment_order', v_country),
                              'REVIEW_BEFORE_CHARGE') IS DISTINCT FROM 'PAY_THEN_REVIEW';
  IF v_review THEN
    v_minutes := core.booking_param_int('review_hold_minutes', v_country);
  ELSE
    v_minutes := LEAST(v_ttl, v_max_total);
  END IF;
  IF v_buffer IS NULL OR v_ttl IS NULL OR v_max_total IS NULL OR v_max_live IS NULL
     OR v_rate IS NULL OR v_grace IS NULL OR v_minutes IS NULL OR v_minutes < 1
     OR v_max_days IS NULL OR v_max_days < 1 THEN
    RAISE EXCEPTION 'hold: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  -- US-049 (RT-CONC-02) : durée de location au plus max_trip_days jours du pays (17 §7.2, ADM-031)
  IF p_end - p_start > pg_catalog.make_interval(days => v_max_days) THEN
    RAISE EXCEPTION 'hold: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;
  v_period := core.booking_occupied_period(p_start, p_end, v_buffer);

  -- 0. verrous : guest puis véhicule (ordre global, 17 §2.5, VERIF_16-M2)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || p_vehicle_id::text, 0));

  -- 2a. expiration ciblée : texte EXPIRY_2A_SQL de test/support/expiry-2a.ts (17 §2.5,
  -- VERIF_16-M14, VERIF_17-A3 / A6), aux paramètres près (égalité vérifiée par expiry-2a.test.ts)
  WITH t AS (SELECT platform.now() AS ts),
     due AS (
       SELECT h.id, h.occupancy_id
         FROM core.booking_checkout_hold h, t
        WHERE (h.vehicle_id = p_vehicle_id OR h.guest_user_id = v_guest)
          AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
          AND h.expires_at <= t.ts
          AND (h.payment_in_flight_until IS NULL OR h.payment_in_flight_until <= t.ts)
          AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation o
                           WHERE o.hold_id = h.id AND o.purpose = 'RENT'
                             AND ( ( o.status IN ('PENDING','SUBMITTED','UNKNOWN')
                                     AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
                                     AND t.ts < h.payment_in_flight_until + make_interval(secs => v_grace) )
                                OR ( o.status = 'SUCCEEDED'
                                     AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                                      WHERE d.operation_id = o.id) ) ))
        FOR UPDATE OF h SKIP LOCKED
     ), expired AS (
       UPDATE core.booking_checkout_hold SET status = 'EXPIRED', expired_at = (SELECT ts FROM t)
        WHERE id IN (SELECT id FROM due)
       RETURNING occupancy_id
     )
     UPDATE core.booking_vehicle_occupancy
        SET active = false, deactivated_reason = 'HOLD_EXPIRED'
      WHERE id IN (SELECT occupancy_id FROM expired)
        AND kind = 'HOLD';

  -- 2b. contrôles entre hôtes, sous le verrou du voyageur (17 §2.3, RLS-3, RLS-4) : holds vivants
  -- tous hôtes confondus, chevauchement avec ses trips (période sans tampon, BR-BOOK-08)
  SELECT g.live_holds, g.trip_overlap INTO v_live, v_overlap
    FROM platform.guest_hold_guard(pg_catalog.tstzrange(p_start, p_end, '[)')) AS g;
  IF v_live IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF v_overlap THEN
    RAISE EXCEPTION 'hold: guest overlap'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_guest_overlap';
  END IF;
  IF v_live >= v_max_live THEN
    RAISE EXCEPTION 'hold: live hold limit reached'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_guest_limit';
  END IF;
  -- rotation (17 §2.5 M5) : poses du voyageur sur ce véhicule dans l'heure glissante
  v_now := platform.now();
  SELECT pg_catalog.count(*)::integer INTO v_recent
    FROM core.booking_checkout_hold h
   WHERE h.guest_user_id = v_guest AND h.vehicle_id = p_vehicle_id
     AND h.created_at > v_now - pg_catalog.make_interval(hours => 1);
  IF v_recent >= v_rate THEN
    RAISE EXCEPTION 'hold: rate limited'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_rate_limited';
  END IF;

  -- 2c. occupation HOLD [début, fin + tampon) puis hold ; pas de guest_occupancy (17 §2.5)
  v_expires_at := v_now + pg_catalog.make_interval(mins => v_minutes);
  -- 23P01 vehicle_occupancy_no_overlap possible ici : créneau pris (2d : VEHICLE_UNAVAILABLE)
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          ref_type, ref_id, created_by)
  VALUES (v_occupancy, p_vehicle_id, v_org, v_country, 'HOLD', 'CHECKOUT', v_period, true,
          v_expires_at, 'HOLD', v_hold, v_guest);
  -- 23505 one_live_hold_per_guest_vehicle possible ici : hold vivant du même voyageur
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
          expires_at, review_required, created_at, created_by)
  VALUES (v_hold, v_guest, p_vehicle_id, v_org, v_country, v_occupancy, 'CHECKOUT', 'ACTIVE',
          v_expires_at, v_review, v_now, v_guest);

  -- booking.hold.created (17 §2.5 : seul événement avant la preuve de paiement) ; aucune donnée
  -- du voyageur dans le contenu (l'acteur est dans l'enveloppe)
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.hold.created', 1, 'checkout_hold', v_hold, 0, v_country, v_guest, 'GUEST',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', v_hold, 'vehicle_id', p_vehicle_id,
                                        'org_id', v_org, 'expires_at', v_expires_at,
                                        'review_required', v_review),
          v_hold::text);
  RETURN v_hold;
END
$fn$;

COMMENT ON FUNCTION core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean) IS
  'Commande : pose d''un hold de checkout (17 §2.5 étape 2) ; refusée au titulaire et à tout membre '
  'du compte d''hôte du véhicule (SELF_BOOKING_FORBIDDEN), à un voyageur restreint '
  '(ACCOUNT_RESTRICTED) et sur le véhicule d''un titulaire restreint (HOST_NOT_ACTIVATED). US-023, '
  'US-049, US-109.';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 10. Commandes de la console (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) -------
-- Une commande = un appel = une instruction (ADR-056). Issues communes : AUTH_REQUIRED (aucune
-- session : rien n'est écrit), MFA_REQUIRED et FORBIDDEN (journalisés), puis l'issue propre.
-- `body` : jsonb rendu à l'API, sans le moindre secret (jamais le hachage du mot de passe).
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- 10.1 Files : résumé par file (ouverts, en retard) et éléments d'une file, dans les pays où
-- l'acteur détient la permission de la file. Un élément ouvert dont l'échéance est passée est
-- signalé (`overdue`), calculé par la base. Aucune donnée personnelle : des références seulement.
CREATE FUNCTION core.support_staff_queues(p_token_hash bytea, p_queue text, p_limit integer)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_now     timestamptz := platform.now();
  v_limit   integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_visible jsonb;
  v_summary jsonb;
  v_items   jsonb;
BEGIN
  IF p_queue IS NOT NULL AND p_queue !~ '^[A-Z][A-Z_]{1,63}$' THEN
    RAISE EXCEPTION 'files : file invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  -- (file, pays) où l'acteur détient la permission de la file, par un rôle en cours
  WITH visible AS (
    SELECT q.queue, k.code::text AS country
      FROM core.support_review_queue AS q
     CROSS JOIN core.config_country AS k
     WHERE core.iam_staff_permitted(v_s.user_id, q.permission_code, ARRAY[k.code::text], NULL)
           IS NOT NULL)
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('queue', s.queue, 'open', s.open,
                                                            'overdue', s.overdue)
                              ORDER BY s.queue)
    INTO v_summary
    FROM (SELECT v.queue,
                 pg_catalog.count(i.id) AS open,
                 pg_catalog.count(i.id) FILTER (WHERE i.sla_due_at <= v_now) AS overdue
            FROM visible AS v
            LEFT JOIN core.support_review_queue_item AS i
              ON i.queue = v.queue AND i.country_code = v.country
             AND i.status IN ('OPEN', 'IN_REVIEW')
           GROUP BY v.queue) AS s;
  IF v_summary IS NULL THEN
    -- aucune file permise : refus journalisé (sujet : la requête, aucun objet visé)
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'REVIEW_QUEUE',
                                 pg_catalog.gen_random_uuid(), NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION',
                                   'attempted', 'REVIEW_QUEUE_READ', 'queue', p_queue),
                                 NULL, NULL);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF p_queue IS NOT NULL THEN
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', x.id, 'queue', x.queue, 'subjectType', x.subject_type,
             'subjectId', x.subject_id, 'country', x.country_code, 'status', x.status,
             'slaDueAt', x.sla_due_at, 'overdue', x.sla_due_at <= v_now,
             'assigned', x.assignee_id IS NOT NULL,
             'assignedToMe', x.assignee_id IS NOT DISTINCT FROM v_s.user_id,
             'createdAt', x.created_at)
             ORDER BY (x.sla_due_at <= v_now) DESC, x.sla_due_at, x.id)
      INTO v_items
      FROM (SELECT i.*
              FROM core.support_review_queue_item AS i
              JOIN core.support_review_queue AS q ON q.queue = i.queue
             WHERE i.queue = p_queue AND i.status IN ('OPEN', 'IN_REVIEW')
               AND core.iam_staff_permitted(v_s.user_id, q.permission_code,
                                            ARRAY[i.country_code], NULL) IS NOT NULL
             ORDER BY (i.sla_due_at <= v_now) DESC, i.sla_due_at, i.id
             LIMIT v_limit) AS x;
  END IF;
  RETURN QUERY SELECT 'OK'::text,
    pg_catalog.jsonb_build_object('queues', v_summary,
                                  'items', COALESCE(v_items, '[]'::jsonb));
END
$fn$;

-- 10.2 Prise en charge d'un élément (assignation à soi). Issues : CLAIMED, TAKEN (déjà assigné à
-- une autre personne), FORBIDDEN (introuvable, clos ou hors permission / portée : même issue).
CREATE FUNCTION core.support_staff_claim_item(p_token_hash bytea, p_request_id uuid, p_item_id uuid)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_item record;
  v_role text;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'files : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'REVIEW_ITEM_CLAIM'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT i.id, i.queue, i.country_code, i.status, i.assignee_id, q.permission_code INTO v_item
    FROM core.support_review_queue_item AS i
    JOIN core.support_review_queue AS q ON q.queue = i.queue
   WHERE i.id = p_item_id
   FOR UPDATE OF i;
  IF v_item.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, v_item.permission_code,
                                       ARRAY[v_item.country_code], NULL);
  END IF;
  IF v_role IS NULL OR v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_item.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        WHEN v_role IS NULL THEN 'PERMISSION' ELSE 'CLOSED' END,
                                   'attempted', 'REVIEW_ITEM_CLAIM')
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_item.assignee_id IS NOT NULL AND v_item.assignee_id <> v_s.user_id THEN
    RETURN QUERY SELECT 'TAKEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_item.assignee_id IS NULL THEN
    UPDATE core.support_review_queue_item AS i
       SET status = 'IN_REVIEW', assignee_id = v_s.user_id, assigned_at = platform.now(),
           updated_by = v_s.user_id
     WHERE i.id = p_item_id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'REVIEW_ITEM_CLAIMED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('country', v_item.country_code,
                                   'queue', v_item.queue), NULL, p_request_id);
  END IF;
  RETURN QUERY SELECT 'CLAIMED'::text, pg_catalog.jsonb_build_object('itemId', p_item_id);
END
$fn$;

-- 10.3 Dossier KYC : SEULEMENT par la file KYC (L1-PM-08), élément ouvert assigné à l'acteur
-- (ADMIN : tout élément de sa portée), permission `kyc.read_sensitive`, journalisé READ_C3 AVANT
-- la lecture. Bêta : le sujet d'un élément KYC est la personne (USER_ACCOUNT) ; le dossier rend
-- son identité déclarée, sans aucune image (la vérification d'US-105 viendra s'y ajouter).
-- Issues : GRANTED, CASE_REQUIRED (permission détenue, élément non couvert), FORBIDDEN
-- (introuvable ou sans permission dans le pays) ; refus journalisés.
CREATE FUNCTION core.support_staff_kyc_dossier(p_token_hash bytea, p_request_id uuid,
                                               p_item_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_item    record;
  v_role    text;
  v_reason  text;
  v_access  uuid;
  v_user    record;
  v_purpose text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR v_purpose IS NULL
     OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'dossier KYC : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id
    INTO v_item
    FROM core.support_review_queue_item AS i WHERE i.id = p_item_id;
  IF v_item.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'kyc.read_sensitive',
                                       ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'CASE'
    WHEN v_item.queue <> 'KYC' OR v_item.subject_type <> 'USER_ACCOUNT' THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', 'DATA_ACCESS', 'permission', 'kyc.read_sensitive',
                                   'access_kind', 'READ_C3', 'field_or_file', 'kyc_dossier')
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 v_purpose, p_request_id);
    -- permission détenue mais élément hors file KYC, clos ou non assigné : CASE_REQUIRED
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL THEN 'CASE_REQUIRED' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  -- journal D'ABORD (même instruction : sans journal, pas de donnée)
  v_access := core.support_staff_log_access(v_s.user_id, v_role, 'USER_ACCOUNT', v_item.subject_id,
                                            'kyc_dossier', 'READ_C3', v_purpose,
                                            'item:' || p_item_id::text, p_request_id,
                                            v_item.country_code);
  SELECT u.legal_first_name, u.legal_last_name, u.date_of_birth, u.residence_country,
         u.pseudonymized_at
    INTO v_user
    FROM core.iam_user_account AS u WHERE u.id = v_item.subject_id;
  RETURN QUERY SELECT 'GRANTED'::text, pg_catalog.jsonb_build_object(
    'itemId', p_item_id, 'userId', v_item.subject_id, 'country', v_item.country_code,
    'accessId', v_access, 'kycStatus', 'NOT_STARTED',
    'pseudonymized', v_user.pseudonymized_at IS NOT NULL,
    'legalFirstName', v_user.legal_first_name, 'legalLastName', v_user.legal_last_name,
    'dateOfBirth', v_user.date_of_birth, 'residenceCountry', v_user.residence_country);
END
$fn$;

-- 10.4 Recherche d'une personne par son e-mail exact (normalisé). Rend son identifiant seulement
-- si l'acteur détient `support.read_profile` dans le pays de la personne ; journalisé
-- READ_C2_SUPPORT (le résultat révèle l'existence d'une adresse). Introuvable et hors portée :
-- même issue NOT_FOUND, journalisée (aucun oracle d'existence) ; acteur qui ne détient la
-- permission dans AUCUN pays : FORBIDDEN, journalisé.
CREATE FUNCTION core.support_staff_find_user(p_token_hash bytea, p_request_id uuid, p_email text,
                                             p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_user    uuid;
  v_country text;
  v_role    text;
  v_email   text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_purpose text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR v_email IS NULL OR pg_catalog.length(v_email) NOT BETWEEN 3 AND 254
     OR v_purpose IS NULL OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'recherche : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF NOT core.support_staff_holds_permission(v_s.user_id, 'support.read_profile') THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER_SEARCH',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION',
                                   'attempted', 'USER_SEARCH', 'permission', 'support.read_profile'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT u.id INTO v_user FROM core.iam_user_account AS u WHERE u.email = v_email;
  IF v_user IS NOT NULL THEN
    v_country := core.ctr_account_country(v_user);
  END IF;
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.read_profile', ARRAY[v_country], NULL);
  END IF;
  IF v_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER_SEARCH',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'SUBJECT_NOT_FOUND',
                                   'attempted', 'USER_SEARCH', 'permission', 'support.read_profile'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM core.support_staff_log_access(v_s.user_id, v_role, 'USER_ACCOUNT', v_user,
                                        'user_account.email', 'READ_C2_SUPPORT', v_purpose, NULL,
                                        p_request_id, v_country);
  RETURN QUERY SELECT 'FOUND'::text,
    pg_catalog.jsonb_build_object('userId', v_user, 'country', v_country);
END
$fn$;

-- 10.5 Fiche 360° d'une personne (16 ADM-005, Bêta SIMPLIFIÉ) : profil, statut KYC sans pièce,
-- restrictions, notes internes, comptes d'hôte (fermés à la réservation si le titulaire est
-- restreint), trips comme voyageur, dossiers et éléments de file. Permission
-- `support.read_profile` dans le pays de la personne, couverture (dossier ou élément assigné ;
-- ADMIN : sa portée), journal READ_C2_SUPPORT AVANT la lecture.
CREATE FUNCTION core.support_staff_profile(p_token_hash bytea, p_request_id uuid, p_user_id uuid,
                                           p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s          record;
  v_country    text;
  v_role       text;
  v_cover      text;
  v_access     uuid;
  v_u          record;
  v_restricted boolean;
  v_purpose    text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_user_id IS NULL OR v_purpose IS NULL
     OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'fiche : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER_ACCOUNT',
                                 p_user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS', 'permission', 'support.read_profile'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  v_country := core.ctr_account_country(p_user_id);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.read_profile', ARRAY[v_country], NULL);
  END IF;
  IF v_role IS NOT NULL THEN
    v_cover := core.support_staff_covers_user(v_s.user_id, v_role, p_user_id, v_country);
  END IF;
  IF v_cover IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'USER_ACCOUNT', p_user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_country IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        WHEN v_role IS NULL THEN 'PERMISSION' ELSE 'CASE' END,
                                   'attempted', 'DATA_ACCESS', 'permission', 'support.read_profile',
                                   'access_kind', 'READ_C2_SUPPORT')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country) END,
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL THEN 'CASE_REQUIRED' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  v_access := core.support_staff_log_access(v_s.user_id, v_role, 'USER_ACCOUNT', p_user_id,
                                            'user_account.profile_360', 'READ_C2_SUPPORT',
                                            v_purpose,
                                            CASE WHEN v_cover LIKE 'scope:%' THEN NULL ELSE v_cover END,
                                            p_request_id, v_country);
  SELECT u.id, u.email, u.email_verified_at, u.phone_e164, u.phone_verified_at, u.legal_first_name,
         u.legal_last_name, u.display_name, u.preferred_locale, u.residence_country, u.status,
         u.pseudonymized_at, u.created_at
    INTO v_u
    FROM core.iam_user_account AS u WHERE u.id = p_user_id;
  v_restricted := EXISTS (SELECT 1 FROM core.iam_restriction AS r
                           WHERE r.user_id = p_user_id AND r.active);
  RETURN QUERY SELECT 'GRANTED'::text, pg_catalog.jsonb_build_object(
    'accessId', v_access, 'country', v_country, 'coverage', pg_catalog.split_part(v_cover, ':', 1),
    'profile', pg_catalog.jsonb_build_object(
      'id', v_u.id, 'email', v_u.email, 'emailVerified', v_u.email_verified_at IS NOT NULL,
      'phone', v_u.phone_e164, 'phoneVerified', v_u.phone_verified_at IS NOT NULL,
      'legalFirstName', v_u.legal_first_name, 'legalLastName', v_u.legal_last_name,
      'displayName', v_u.display_name, 'preferredLocale', v_u.preferred_locale,
      'residenceCountry', v_u.residence_country, 'status', v_u.status,
      'pseudonymized', v_u.pseudonymized_at IS NOT NULL, 'createdAt', v_u.created_at),
    -- statut seulement, jamais une pièce (16 ADM-005) ; la vérification arrive avec US-105
    'kyc', pg_catalog.jsonb_build_object('status', 'NOT_STARTED'),
    'restricted', v_restricted,
    'restrictions', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'active', r.active, 'reason', r.reason,
        'createdAt', r.created_at, 'liftedAt', r.lifted_at) ORDER BY r.created_at DESC)
      FROM core.iam_restriction AS r WHERE r.user_id = p_user_id), '[]'::jsonb),
    'notes', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', n.id, 'authorRole', n.author_role, 'body', n.body, 'createdAt', n.created_at)
        ORDER BY n.created_at DESC)
      FROM (SELECT * FROM core.support_internal_note AS x
             WHERE x.subject_type = 'USER_ACCOUNT' AND x.subject_id = p_user_id
             ORDER BY x.created_at DESC LIMIT 50) AS n), '[]'::jsonb),
    -- une même personne apparaît sous ses deux rôles : hôte et voyageur (OQ-P2P-09)
    'hostAccounts', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'orgId', o.id, 'country', o.country_code, 'status', o.status,
        'displayName', o.display_name,
        'bookable', o.status = 'ACTIVE' AND NOT v_restricted) ORDER BY o.country_code)
      FROM core.iam_organization AS o
     WHERE o.holder_user_id = p_user_id AND o.country_code = v_country), '[]'::jsonb),
    'trips', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', t.id, 'publicRef', t.public_ref, 'status', t.status, 'country', t.country_code,
        'scheduledStart', t.scheduled_start, 'scheduledEnd', t.scheduled_end)
        ORDER BY t.scheduled_start DESC)
      FROM (SELECT x.id, x.public_ref, x.status, x.country_code, x.scheduled_start, x.scheduled_end
              FROM core.booking_trip AS x
             WHERE x.guest_user_id = p_user_id AND x.country_code = v_country
             ORDER BY x.scheduled_start DESC LIMIT 50) AS t), '[]'::jsonb),
    'cases', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', c.id, 'category', c.category, 'status', c.status, 'priority', c.priority,
        'channel', c.channel, 'assignedToMe', c.assignee_id IS NOT DISTINCT FROM v_s.user_id,
        'createdAt', c.created_at) ORDER BY c.created_at DESC)
      FROM core.support_support_case AS c
     WHERE c.requester_user_id = p_user_id AND c.country_code = v_country), '[]'::jsonb),
    'queueItems', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', i.id, 'queue', i.queue, 'status', i.status, 'slaDueAt', i.sla_due_at,
        'overdue', i.status IN ('OPEN', 'IN_REVIEW') AND i.sla_due_at <= platform.now())
        ORDER BY i.created_at DESC)
      FROM core.support_review_queue_item AS i
     WHERE i.subject_type = 'USER_ACCOUNT' AND i.subject_id = p_user_id
       AND i.country_code = v_country), '[]'::jsonb));
END
$fn$;

-- 10.6 Note interne sur une personne : même permission de pays et même couverture que la fiche.
-- Idempotente par request_id (= id de la note). Issues : ADDED, DUPLICATE, FORBIDDEN,
-- CASE_REQUIRED. Le texte n'entre jamais au journal (seulement la référence de la note).
CREATE FUNCTION core.support_staff_add_note(p_token_hash bytea, p_request_id uuid, p_user_id uuid,
                                            p_body text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_country text;
  v_role    text;
  v_cover   text;
  v_prev    record;
  v_body    text := pg_catalog.btrim(p_body);
BEGIN
  IF p_request_id IS NULL OR p_user_id IS NULL OR v_body IS NULL
     OR pg_catalog.char_length(v_body) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'note : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('support.internal_note:' || p_request_id::text, 0));
  SELECT n.id, n.subject_id, n.author_user_id INTO v_prev
    FROM core.support_internal_note AS n WHERE n.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.subject_id = p_user_id AND v_prev.author_user_id = v_s.user_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, pg_catalog.jsonb_build_object('noteId', v_prev.id);
      RETURN;
    END IF;
    RAISE EXCEPTION 'note : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_country := core.ctr_account_country(p_user_id);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.write_note', ARRAY[v_country], NULL);
  END IF;
  IF v_role IS NOT NULL THEN
    v_cover := core.support_staff_covers_user(v_s.user_id, v_role, p_user_id, v_country);
  END IF;
  IF v_cover IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'USER_ACCOUNT', p_user_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_country IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        WHEN v_role IS NULL THEN 'PERMISSION' ELSE 'CASE' END,
                                   'attempted', 'INTERNAL_NOTE', 'permission', 'support.write_note')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL THEN 'CASE_REQUIRED' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  INSERT INTO core.support_internal_note (id, subject_type, subject_id, country_code,
                                          author_user_id, author_role, body)
  VALUES (p_request_id, 'USER_ACCOUNT', p_user_id, v_country, v_s.user_id, v_role, v_body);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'INTERNAL_NOTE_ADDED', 'USER_ACCOUNT', p_user_id,
                               NULL,
                               pg_catalog.jsonb_build_object('country', v_country,
                                 'noteId', p_request_id),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'ADDED'::text, pg_catalog.jsonb_build_object('noteId', p_request_id);
END
$fn$;

-- 10.7 Ouverture d'un dossier de support pour une personne (demandeur), assigné à l'acteur ;
-- pays = celui du compte de la personne ; jamais un bris de glace. Idempotente par request_id
-- (= id du dossier). Issues : OPENED, DUPLICATE, FORBIDDEN.
CREATE FUNCTION core.support_staff_open_case(p_token_hash bytea, p_request_id uuid,
                                             p_requester uuid, p_category text, p_priority text,
                                             p_channel text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_country text;
  v_role    text;
  v_prev    record;
BEGIN
  IF p_request_id IS NULL OR p_requester IS NULL
     OR p_category IS NULL OR p_category NOT IN ('TRIP', 'PAYMENT', 'ACCOUNT', 'LISTING', 'CLAIM',
                                                 'SAFETY', 'OTHER')
     OR p_priority IS NULL OR p_priority NOT IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')
     OR p_channel IS NULL OR p_channel NOT IN ('WHATSAPP', 'EMAIL', 'PHONE', 'IN_APP') THEN
    RAISE EXCEPTION 'dossier : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('support.case:' || p_request_id::text, 0));
  SELECT c.id, c.requester_user_id, c.assignee_id INTO v_prev
    FROM core.support_support_case AS c WHERE c.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.requester_user_id = p_requester AND v_prev.assignee_id = v_s.user_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, pg_catalog.jsonb_build_object('caseId', v_prev.id);
      RETURN;
    END IF;
    RAISE EXCEPTION 'dossier : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_country := core.ctr_account_country(p_requester);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.case_write', ARRAY[v_country], NULL);
  END IF;
  IF v_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER_ACCOUNT',
                                 p_requester, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_country IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION' END,
                                   'attempted', 'SUPPORT_CASE_OPEN', 'permission', 'support.case_write')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  INSERT INTO core.support_support_case (id, requester_user_id, country_code, channel, category,
                                         priority, status, assignee_id, created_by, updated_by)
  VALUES (p_request_id, p_requester, v_country, p_channel, p_category, p_priority, 'OPEN',
          v_s.user_id, v_s.user_id, v_s.user_id);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'SUPPORT_CASE_OPENED', 'SUPPORT_CASE',
                               p_request_id, NULL,
                               pg_catalog.jsonb_build_object('country', v_country,
                                 'category', p_category, 'priority', p_priority,
                                 'channel', p_channel),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'OPENED'::text, pg_catalog.jsonb_build_object('caseId', p_request_id,
                                                                     'country', v_country);
END
$fn$;

-- 10.8 Changement d'état d'un dossier (PENDING, RESOLVED, CLOSED) par son assigné, ou par un ADMIN
-- de son pays. Issues : UPDATED, CASE_REQUIRED (permission détenue : dossier d'un autre assigné,
-- fermé ou bris de glace), FORBIDDEN (introuvable ou sans permission dans le pays) ; journalisés.
CREATE FUNCTION core.support_staff_set_case_status(p_token_hash bytea, p_request_id uuid,
                                                   p_case_id uuid, p_status text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_case record;
  v_role text;
BEGIN
  IF p_request_id IS NULL OR p_case_id IS NULL OR p_status IS NULL
     OR p_status NOT IN ('PENDING', 'RESOLVED', 'CLOSED') THEN
    RAISE EXCEPTION 'dossier : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT c.id, c.country_code, c.status, c.assignee_id, c.category INTO v_case
    FROM core.support_support_case AS c WHERE c.id = p_case_id FOR UPDATE;
  IF v_case.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'support.case_write',
                                       ARRAY[v_case.country_code], NULL);
  END IF;
  IF v_role IS NULL OR v_case.category = 'BREAK_GLASS' OR v_case.status = 'CLOSED'
     OR (v_role <> 'ADMIN' AND v_case.assignee_id IS DISTINCT FROM v_s.user_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'SUPPORT_CASE', p_case_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_case.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        WHEN v_role IS NULL THEN 'PERMISSION' ELSE 'CASE' END,
                                   'attempted', 'SUPPORT_CASE_STATUS')
                                 || CASE WHEN v_case.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_case.country_code) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL THEN 'CASE_REQUIRED' ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  UPDATE core.support_support_case AS c SET status = p_status, updated_by = v_s.user_id
   WHERE c.id = p_case_id;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'SUPPORT_CASE_STATUS_CHANGED', 'SUPPORT_CASE',
                               p_case_id, pg_catalog.jsonb_build_object('status', v_case.status),
                               pg_catalog.jsonb_build_object('country', v_case.country_code,
                                 'status', p_status),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'UPDATED'::text, pg_catalog.jsonb_build_object('caseId', p_case_id,
                                                                      'status', p_status);
END
$fn$;

-- 10.9 Pièce téléversée par le staff, AVANT toute analyse : l'acteur détient-il `evidence.upload`
-- dans le pays de la personne sujet ? Issues : PERMITTED, FORBIDDEN (journalisé). Rien d'autre
-- n'est écrit : l'API n'analyse ni ne dépose rien pour un acteur sans droit.
CREATE FUNCTION core.support_staff_evidence_permitted(p_token_hash bytea, p_request_id uuid,
                                                      p_subject_user uuid)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_country text;
  v_role    text;
BEGIN
  IF p_request_id IS NULL OR p_subject_user IS NULL THEN
    RAISE EXCEPTION 'pièce : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  v_country := core.ctr_account_country(p_subject_user);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'evidence.upload', ARRAY[v_country], NULL);
  END IF;
  IF v_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER_ACCOUNT',
                                 p_subject_user, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_country IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION' END,
                                   'attempted', 'EVIDENCE_UPLOAD', 'permission', 'evidence.upload')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'PERMITTED'::text, pg_catalog.jsonb_build_object('country', v_country);
END
$fn$;

-- 10.10 Pièce téléversée par le staff : APRÈS les contrôles de l'API (taille, type réel sur les
-- octets, antivirus CLEAN seulement ; L1-PM-41 à 43) et AVANT le dépôt (création seule, même
-- transaction). Seau PRIVATE_EVIDENCE, C2, chiffrée par la clé de la personne sujet (qui doit
-- exister et ne pas être détruite : sinon UNAVAILABLE). Permission `evidence.upload` dans le pays
-- de la personne. Types admis : JPEG, PNG, HEIC, PDF (jamais SVG ni HTML). Idempotente par
-- request_id (= id du fichier). Issues : RECORDED (storageKey), DUPLICATE, FORBIDDEN, UNAVAILABLE.
CREATE FUNCTION core.support_staff_record_evidence(p_token_hash bytea, p_request_id uuid,
                                                   p_subject_user uuid, p_mime text,
                                                   p_bytes bigint, p_sha256 bytea)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_country text;
  v_role    text;
  v_prev    record;
  v_key     text;
BEGIN
  IF p_request_id IS NULL OR p_subject_user IS NULL
     OR p_mime IS NULL OR p_mime NOT IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')
     OR p_bytes IS NULL OR p_bytes < 1 OR p_bytes > 10485760
     OR p_sha256 IS NULL OR pg_catalog.octet_length(p_sha256) <> 32 THEN
    RAISE EXCEPTION 'pièce : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  v_key := 'staff-evidence/' || p_request_id::text;
  SELECT f.id, f.sha256, f.uploader_user_id INTO v_prev
    FROM core.audit_file_asset AS f WHERE f.id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.sha256 = p_sha256 AND v_prev.uploader_user_id = v_s.user_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text,
        pg_catalog.jsonb_build_object('fileId', v_prev.id, 'storageKey', v_key);
      RETURN;
    END IF;
    RAISE EXCEPTION 'pièce : identifiant de demande déjà utilisé' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_country := core.ctr_account_country(p_subject_user);
  IF v_country IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'evidence.upload', ARRAY[v_country], NULL);
  END IF;
  IF v_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'USER_ACCOUNT',
                                 p_subject_user, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_country IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION' END,
                                   'attempted', 'EVIDENCE_UPLOAD', 'permission', 'evidence.upload')
                                 || CASE WHEN v_country IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_country) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  -- clé de la personne : créée par l'API (enveloppe KMS) AVANT cet appel ; détruite ou absente :
  -- aucun dépôt possible (fail-closed)
  IF NOT EXISTS (SELECT 1 FROM core.audit_subject_key AS k
                  WHERE k.subject_type = 'USER' AND k.subject_id = p_subject_user
                    AND k.destroyed_at IS NULL) THEN
    RETURN QUERY SELECT 'UNAVAILABLE'::text, NULL::jsonb;
    RETURN;
  END IF;
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id,
                                     source, classification, retention_class, enc_subject_type,
                                     enc_subject_id)
  VALUES (p_request_id, 'PRIVATE_EVIDENCE', v_key, p_mime, p_bytes, p_sha256, v_s.user_id,
          'STAFF_UPLOAD', 'C2', 'STAFF_EVIDENCE', 'USER', p_subject_user);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'EVIDENCE_RECEIVED', 'USER_ACCOUNT',
                               p_subject_user, NULL,
                               pg_catalog.jsonb_build_object('country', v_country,
                                 'fileId', p_request_id, 'mime', p_mime, 'bytes', p_bytes),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'RECORDED'::text,
    pg_catalog.jsonb_build_object('fileId', p_request_id, 'storageKey', v_key);
END
$fn$;

COMMENT ON FUNCTION core.support_staff_queues(bytea, text, integer) IS
  'Console : files de revue (résumé, éléments, retard signalé par la base) dans les pays où '
  'l''acteur détient la permission de la file. US-109 (ADR-097).';
COMMENT ON FUNCTION core.support_staff_claim_item(bytea, uuid, uuid) IS
  'Console : prise en charge d''un élément de file (assignation à soi), journalisée. US-109.';
COMMENT ON FUNCTION core.support_staff_kyc_dossier(bytea, uuid, uuid, text) IS
  'Console : dossier KYC par la file KYC seulement (élément assigné), kyc.read_sensitive, '
  'journalisé READ_C3 avant la lecture (L1-PM-08). US-109 (ADR-097).';
COMMENT ON FUNCTION core.support_staff_find_user(bytea, uuid, text, text) IS
  'Console : recherche d''une personne par son e-mail exact, journalisée. US-109 (ADR-097).';
COMMENT ON FUNCTION core.support_staff_profile(bytea, uuid, uuid, text) IS
  'Console : fiche 360° (16 ADM-005), couverture par dossier ou élément assigné (ADMIN : portée), '
  'journalisée READ_C2_SUPPORT avant la lecture. US-109 (ADR-097).';
COMMENT ON FUNCTION core.support_staff_add_note(bytea, uuid, uuid, text) IS
  'Console : note interne sur une personne (internal_note), jamais visible des clients. US-109.';
COMMENT ON FUNCTION core.support_staff_open_case(bytea, uuid, uuid, text, text, text) IS
  'Console : ouverture d''un dossier de support assigné à l''acteur (jamais un bris de glace). US-109.';
COMMENT ON FUNCTION core.support_staff_set_case_status(bytea, uuid, uuid, text) IS
  'Console : changement d''état d''un dossier par son assigné ou un ADMIN du pays. US-109.';
COMMENT ON FUNCTION core.support_staff_evidence_permitted(bytea, uuid, uuid) IS
  'Console : droit de téléverser une pièce pour une personne (evidence.upload), jugé avant toute '
  'analyse ; refus journalisé. US-109 (ADR-097).';
COMMENT ON FUNCTION core.support_staff_record_evidence(bytea, uuid, uuid, text, bigint, bytea) IS
  'Console : ligne file_asset d''une pièce du staff (PRIVATE_EVIDENCE, C2, clé de la personne), '
  'après les contrôles de type, de taille et d''antivirus de l''API. US-109 (ADR-097).';

REVOKE ALL ON FUNCTION core.support_staff_queues(bytea, text, integer),
  core.support_staff_claim_item(bytea, uuid, uuid),
  core.support_staff_kyc_dossier(bytea, uuid, uuid, text),
  core.support_staff_find_user(bytea, uuid, text, text),
  core.support_staff_profile(bytea, uuid, uuid, text),
  core.support_staff_add_note(bytea, uuid, uuid, text),
  core.support_staff_open_case(bytea, uuid, uuid, text, text, text),
  core.support_staff_set_case_status(bytea, uuid, uuid, text),
  core.support_staff_evidence_permitted(bytea, uuid, uuid),
  core.support_staff_record_evidence(bytea, uuid, uuid, text, bigint, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_queues(bytea, text, integer),
  core.support_staff_claim_item(bytea, uuid, uuid),
  core.support_staff_kyc_dossier(bytea, uuid, uuid, text),
  core.support_staff_find_user(bytea, uuid, text, text),
  core.support_staff_profile(bytea, uuid, uuid, text),
  core.support_staff_add_note(bytea, uuid, uuid, text),
  core.support_staff_open_case(bytea, uuid, uuid, text, text, text),
  core.support_staff_set_case_status(bytea, uuid, uuid, text),
  core.support_staff_evidence_permitted(bytea, uuid, uuid),
  core.support_staff_record_evidence(bytea, uuid, uuid, text, bigint, bytea) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
