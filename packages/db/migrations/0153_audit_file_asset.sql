-- 0153 — AUD : métadonnées des fichiers (magasin de preuves) avec empreinte SHA-256 à la réception.
-- US-009 ; 17 §1.7 (« empreinte SHA-256 calculée à la réception et heure serveur », CLM-034),
-- §3.1.3 points 1 et 6 (fichiers nominatifs chiffrés par la clé du sujet), §3.2.13 (`file_asset`) ;
-- ADR-051. Appliquée sous `migrator`.
--
-- Le contenu est dans le stockage objet (port FileStore) ; ici : la description du fichier.
-- `sha256` = empreinte des octets REÇUS (le clair, avant tout chiffrement), calculée en flux par
-- l'application à la réception (packages/db/src/audit/file-asset.ts) ; `server_received_at` =
-- platform.now(), jamais fourni par le client.
--
-- Ajout PROPOSÉ à 17 §3.2.13 (ADR-051) : `enc_subject_type` / `enc_subject_id`, la clé de sujet
-- qui chiffre le fichier (17 §3.1.3 point 1 : « fichiers de preuve et PDF nominatifs chiffrés côté
-- application avec la même clé avant dépôt »). Un fichier C2 / C3 est toujours chiffré par sujet.
--
-- Classe D / E (17 §3.1.3) : la ligne n'est jamais supprimée ; seuls `retention_class`,
-- `legal_hold_until` et `deleted_at` peuvent évoluer (trigger de garde) ; l'empreinte, la taille,
-- l'emplacement et la clé de chiffrement sont figés. Aucun droit UPDATE en Bêta (0155) : la purge
-- et le gel légal arrivent avec leurs stories (US-536, US-046).
--
-- Retour arrière (base vide) : DROP TABLE core.audit_file_asset; DROP FUNCTION core.audit_file_asset_guard();

CREATE TABLE core.audit_file_asset (
  id                 uuid        CONSTRAINT file_asset_pkey PRIMARY KEY,
  bucket             text        NOT NULL
    CONSTRAINT file_asset_bucket_valid CHECK (bucket IN
      ('PUBLIC_LISTING', 'PRIVATE_EVIDENCE', 'KYC', 'DOCUMENTS', 'BRAND')),
  storage_key        text        NOT NULL
    CONSTRAINT file_asset_storage_key_format CHECK (
      storage_key ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]*$' AND pg_catalog.char_length(storage_key) <= 512),
  mime               text        NOT NULL
    CONSTRAINT file_asset_mime_format CHECK (mime ~ '^[a-z]+/[a-z0-9][a-z0-9.+-]{0,126}$'),
  bytes              bigint      NOT NULL
    CONSTRAINT file_asset_bytes_valid CHECK (bytes >= 0),
  sha256             bytea       NOT NULL
    CONSTRAINT file_asset_sha256_size CHECK (pg_catalog.octet_length(sha256) = 32),
  uploader_user_id   uuid,
  source             text        NOT NULL
    CONSTRAINT file_asset_source_valid CHECK (source IN
      ('IN_APP_CAMERA', 'STAFF_UPLOAD', 'GENERATED', 'PROVIDER')),
  device_captured_at timestamptz,
  server_received_at timestamptz NOT NULL DEFAULT platform.now(),
  classification     text        NOT NULL
    CONSTRAINT file_asset_classification_valid CHECK (classification IN ('C0', 'C1', 'C2', 'C3', 'C4')),
  retention_class    text        NOT NULL
    CONSTRAINT file_asset_retention_class_format CHECK (retention_class ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  enc_subject_type   text,
  enc_subject_id     uuid,
  legal_hold_until   timestamptz,
  deleted_at         timestamptz,
  CONSTRAINT file_asset_storage_unique UNIQUE (bucket, storage_key),
  CONSTRAINT file_asset_enc_key_complete CHECK ((enc_subject_type IS NULL) = (enc_subject_id IS NULL)),
  -- 17 §3.1.3 point 1 : tout fichier C2 / C3 est chiffré avec la clé de son sujet
  CONSTRAINT file_asset_personal_encrypted CHECK (
    classification NOT IN ('C2', 'C3') OR enc_subject_type IS NOT NULL),
  -- les secrets (C4) ne vont jamais au stockage objet (coffre / KMS, 17 §3.1.4)
  CONSTRAINT file_asset_no_secret CHECK (classification <> 'C4'),
  -- buckets publics : contenu publié volontairement (C0), jamais chiffré par sujet (17 §3.1.4)
  CONSTRAINT file_asset_public_bucket CHECK (
    bucket NOT IN ('PUBLIC_LISTING', 'BRAND') OR (classification = 'C0' AND enc_subject_type IS NULL)),
  CONSTRAINT file_asset_enc_key_fk FOREIGN KEY (enc_subject_type, enc_subject_id)
    REFERENCES core.audit_subject_key (subject_type, subject_id)
);

CREATE INDEX file_asset_enc_subject_idx ON core.audit_file_asset (enc_subject_type, enc_subject_id)
  WHERE enc_subject_type IS NOT NULL;

ALTER TABLE core.audit_file_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_file_asset FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.audit_file_asset TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.audit_file_asset FROM PUBLIC;

COMMENT ON TABLE core.audit_file_asset IS
  'AUD file_asset (17 §3.2.13, CLM-034) : empreinte SHA-256 à la réception, heure serveur. '
  'Classe D / E : jamais supprimée ; empreinte et emplacement figés. US-009.';

-- Garde : seuls retention_class, legal_hold_until et deleted_at évoluent ; jamais de DELETE.
CREATE FUNCTION core.audit_file_asset_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.id = OLD.id
     AND NEW.bucket = OLD.bucket
     AND NEW.storage_key = OLD.storage_key
     AND NEW.mime = OLD.mime
     AND NEW.bytes = OLD.bytes
     AND NEW.sha256 = OLD.sha256
     AND NEW.uploader_user_id IS NOT DISTINCT FROM OLD.uploader_user_id
     AND NEW.source = OLD.source
     AND NEW.device_captured_at IS NOT DISTINCT FROM OLD.device_captured_at
     AND NEW.server_received_at = OLD.server_received_at
     AND NEW.classification = OLD.classification
     AND NEW.enc_subject_type IS NOT DISTINCT FROM OLD.enc_subject_type
     AND NEW.enc_subject_id IS NOT DISTINCT FROM OLD.enc_subject_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'file_asset: fingerprint, location and key are immutable (% refused)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation',
          CONSTRAINT = 'file_asset_immutable';
END
$fn$;

COMMENT ON FUNCTION core.audit_file_asset_guard() IS
  'Trigger : file_asset n''admet que retention_class, legal_hold_until, deleted_at (17 §3.1.3). US-009.';
REVOKE ALL ON FUNCTION core.audit_file_asset_guard() FROM PUBLIC;

CREATE TRIGGER file_asset_immutable
  BEFORE UPDATE OR DELETE ON core.audit_file_asset
  FOR EACH ROW EXECUTE FUNCTION core.audit_file_asset_guard();
CREATE TRIGGER file_asset_no_truncate
  BEFORE TRUNCATE ON core.audit_file_asset
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('file_asset_immutable');
