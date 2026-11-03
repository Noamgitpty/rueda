-- 0016 — AUD : clés de données par sujet (crypto-shredding) et garde des registres en ajout seul.
-- US-009 ; 17 §1.5 point 4, §3.1.3 « Crypto-shredding des registres immuables » points 1, 2, 5, 9,
-- §3.2.13 (`subject_key`) ; ADR-026 ; ADR-051. Appliquée sous `migrator`.
--
-- Une ligne par sujet (USER, ORG = compte d'hôte, PLATFORM = compte marchand de Kmino) : la clé de
-- données (DEK) du sujet, ENVELOPPÉE par le KMS (`wrapped_dek`, classe C4). La DEK en clair n'est
-- jamais en base : elle est déroulée dans le processus par le port KeyWrapper (packages/db/src/audit),
-- gardée en mémoire au plus `subject_dek_cache_ttl_s` (PROPOSÉ 300 s, 17 §3.1.3 point 9).
--
-- Effacement = destruction de la clé (17 §3.1.3 point 2) : `wrapped_dek` passe à NULL et
-- `destroyed_at` est posé ; c'est la SEULE modification admise d'une ligne (trigger de garde).
-- Les octets chiffrés des registres restent, illisibles ; aucune ligne de registre n'est modifiée.
-- La procédure de destruction (0020) n'est accordée à aucun rôle applicatif en Bêta (NN8).
--
-- Retour arrière (base vide) :
--   DROP TABLE core.audit_subject_key;
--   DROP FUNCTION core.audit_subject_key_guard(), core.audit_append_only();

-- 1. Garde générique des registres en ajout seul (classe A, 17 §3.1.2 et §3.1.3) ---------------
-- Refuse UPDATE, DELETE (FOR EACH ROW) et TRUNCATE (FOR EACH STATEMENT), y compris pour le
-- propriétaire : le nom de contrainte (TG_ARGV[0]) est traduit en IMMUTABLE_RECORD par
-- packages/db/src/errors.ts. Aucune lecture : pas besoin de SECURITY DEFINER.
CREATE FUNCTION core.audit_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION '%: append-only register (% refused)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation',
          CONSTRAINT = TG_ARGV[0];
END
$fn$;

COMMENT ON FUNCTION core.audit_append_only() IS
  'Trigger de refus UPDATE / DELETE / TRUNCATE des registres en ajout seul (17 §3.1.2). US-009.';
REVOKE ALL ON FUNCTION core.audit_append_only() FROM PUBLIC;

-- 2. Clé de données par sujet (17 §3.2.13) ---------------------------------------------------
CREATE TABLE core.audit_subject_key (
  subject_type       text        NOT NULL
    CONSTRAINT subject_key_type_valid CHECK (subject_type IN ('USER', 'ORG', 'PLATFORM')),
  subject_id         uuid        NOT NULL,
  -- DEK enveloppée par le KMS [C4] ; NULL après destruction
  wrapped_dek        bytea
    CONSTRAINT subject_key_wrapped_dek_size CHECK (octet_length(wrapped_dek) BETWEEN 32 AND 1024),
  -- identifiant de la clé maîtresse du KMS (jamais la clé elle-même)
  kms_key_id         text        NOT NULL
    CONSTRAINT subject_key_kms_key_id_format CHECK (kms_key_id ~ '^[A-Za-z0-9:/_.+=-]{1,255}$'),
  created_at         timestamptz NOT NULL DEFAULT platform.now(),
  destroyed_at       timestamptz,
  destroy_request_id uuid,      -- FK data_subject_request : à venir (US-536 ; NN8 procédure manuelle)
  CONSTRAINT subject_key_pkey PRIMARY KEY (subject_type, subject_id),
  CONSTRAINT subject_key_destroyed_has_no_dek CHECK ((destroyed_at IS NULL) = (wrapped_dek IS NOT NULL)),
  CONSTRAINT subject_key_destroy_has_request CHECK (destroyed_at IS NULL OR destroy_request_id IS NOT NULL)
);

ALTER TABLE core.audit_subject_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_subject_key FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.audit_subject_key TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.audit_subject_key FROM PUBLIC;

COMMENT ON TABLE core.audit_subject_key IS
  'AUD subject_key (17 §3.2.13, ADR-026). DEK par sujet enveloppée par le KMS ; seule modification '
  'admise : la destruction (wrapped_dek NULL, destroyed_at). Accès machine seulement. US-009.';

-- 3. Garde : seule la destruction modifie une ligne ; jamais de DELETE ni de TRUNCATE ----------
CREATE FUNCTION core.audit_subject_key_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.destroyed_at IS NULL
     AND NEW.destroyed_at IS NOT NULL
     AND NEW.wrapped_dek IS NULL
     AND NEW.subject_type = OLD.subject_type
     AND NEW.subject_id = OLD.subject_id
     AND NEW.kms_key_id = OLD.kms_key_id
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'subject_key: only the destruction of a live key is allowed (% refused)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation',
          CONSTRAINT = 'subject_key_immutable';
END
$fn$;

COMMENT ON FUNCTION core.audit_subject_key_guard() IS
  'Trigger : subject_key n''admet que la destruction (17 §3.1.3 point 2). US-009.';
REVOKE ALL ON FUNCTION core.audit_subject_key_guard() FROM PUBLIC;

CREATE TRIGGER subject_key_immutable
  BEFORE UPDATE OR DELETE ON core.audit_subject_key
  FOR EACH ROW EXECUTE FUNCTION core.audit_subject_key_guard();
CREATE TRIGGER subject_key_no_truncate
  BEFORE TRUNCATE ON core.audit_subject_key
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('subject_key_immutable');
