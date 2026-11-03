-- 0152 — AUD : journal d'accès aux données personnelles (ajout seul).
-- US-009 ; 17 §1.5 point 5, §2.3 (« data_access_log couvre les lectures C3, les exports en masse
-- et les consultations C2 par le support »), §3.1.4 (C3 : chaque lecture journalisée), §3.2.13 ;
-- ADM-032 ; ADR-051. Appliquée sous `migrator`.
--
-- Registre de classe A : aucun UPDATE / DELETE / TRUNCATE (droits, 0155, et triggers de refus).
-- Il ne contient que des références (identifiants techniques, nom de champ ou de fichier, motif) :
-- aucune donnée C2 / C3 en clair, donc rien à chiffrer par sujet. Il n'est pas chaîné : seule la
-- chaîne de audit_log est exigée par 17 §1.7 (PROPOSÉ, ADR-051). Lectures (console) : US-012.
--
-- Retour arrière (base vide) : DROP TABLE core.audit_data_access_log;

CREATE TABLE core.audit_data_access_log (
  id            uuid        CONSTRAINT data_access_log_pkey PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT platform.now(),   -- non fourni par le client (0155)
  actor_user_id uuid,
  actor_role    text        NOT NULL
    CONSTRAINT data_access_log_actor_role_format CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  subject_type  text        NOT NULL
    CONSTRAINT data_access_log_subject_type_format CHECK (subject_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  subject_id    uuid        NOT NULL,
  -- nom technique du champ (`identity_document.number_enc`) ou identifiant de fichier
  field_or_file text        NOT NULL
    CONSTRAINT data_access_log_field_or_file_format CHECK (field_or_file ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  purpose       text        NOT NULL
    CONSTRAINT data_access_log_purpose_length CHECK (pg_catalog.char_length(purpose) BETWEEN 1 AND 500),
  access_kind   text        NOT NULL
    CONSTRAINT data_access_log_access_kind_valid CHECK (access_kind IN
      ('READ_C3', 'READ_C2_SUPPORT', 'BULK_EXPORT', 'BREAK_GLASS')),
  -- dossier assigné (file ou ticket) qui justifie l'accès (17 §2.3)
  case_ref      text
    CONSTRAINT data_access_log_case_ref_format CHECK (case_ref ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  request_id    uuid
);

CREATE INDEX data_access_log_subject_idx ON core.audit_data_access_log (subject_type, subject_id);

ALTER TABLE core.audit_data_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_data_access_log FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.audit_data_access_log TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.audit_data_access_log FROM PUBLIC;

COMMENT ON TABLE core.audit_data_access_log IS
  'AUD data_access_log (17 §3.2.13, ADM-032). Ajout seul, références seulement. Classe A. US-009.';

CREATE TRIGGER data_access_log_append_only
  BEFORE UPDATE OR DELETE ON core.audit_data_access_log
  FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('data_access_log_append_only');
CREATE TRIGGER data_access_log_no_truncate
  BEFORE TRUNCATE ON core.audit_data_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('data_access_log_append_only');
