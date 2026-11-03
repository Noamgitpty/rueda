-- 0042 — CFG : socle de marque modifiable — versions de thème (`brand_version`), actifs de marque
-- (`brand_asset`, fichiers en `file_asset`, bucket public BRAND) et blocs de contenu
-- (`content_block`) ; publication atomique et retour arrière journalisés.
-- US-034 ; DEC-FONDATEUR-07 ; 04 DSN-002, DSN-004 ; 16 DSN-003 / DSN-004 ; 17 §1.7 (audit),
-- §3.2.13 (`brand_version`, `brand_asset`, `content_block`, `file_asset`), ADR-036 ; ADR-051
-- (chaîne d'audit), ADR-056 (un appel = une instruction), ADR-062 (commandes de console) ;
-- ADR-067. Appliquée sous `migrator`.
--
-- Principes (ADR-067) :
--   - le thème est une DONNÉE versionnée : jetons DTCG complets (`tokens`), jamais une couleur ni
--     une police dans le code ; une version DRAFT est immuable (modifier = nouveau brouillon) ;
--     PUBLISHED et ARCHIVED sont figées (garde) ; jamais de DELETE ni de TRUNCATE ;
--   - écriture UNIQUEMENT par commandes SECURITY DEFINER (propriétaire NOLOGIN iam_staff_owner,
--     famille des commandes de console d'ADR-062 ; EXECUTE au seul app_api), une commande = un
--     appel = une instruction en autocommit (ADR-056) ; chaque commande relit la session
--     (empreinte du jeton), exige le TOTP, la permission (`brand.edit` / `brand.publish`, rôle
--     ADMIN, 17 §3.2.13) sur TOUS les pays déclarés (le thème est commun) ou sur le pays du bloc,
--     puis agit ou refuse ; refus et actions sont journalisés, l'audit écrit EN DERNIER ;
--   - publication atomique : sous un verrou consultatif de transaction, la version publiée passe
--     ARCHIVED et la cible PUBLISHED dans la même instruction ; un index unique partiel garantit
--     une seule version publiée (par clé, langue et pays pour les blocs) ;
--   - retour arrière = NOUVELLE version copiée (`copied_from_id`) puis publiée (17 §3.2.13) ;
--   - contraste : calculé par l'API avec le contrôle d'US-030 (@rueda/design-tokens,
--     `checkContrast`, aucune recopie en SQL) ; la base refuse une version publiée dont
--     `contrast_check` n'est pas « passé, aucune paire en échec » (CHECK) et journalise un refus ;
--   - lecture publique : app_api lit les seules versions et blocs PUBLISHED, sans identifiant du
--     personnel, et les actifs qu'ils référencent ; app_worker et app_anon : rien.
--
-- Retour arrière (base sans dépendance) :
--   DROP FUNCTION core.cfg_brand_cmd_register_asset(bytea, uuid, uuid, text, text, bigint, bytea,
--       text, text, text, text),
--     core.cfg_brand_cmd_save_draft(bytea, uuid, uuid, text, jsonb, integer, uuid, uuid, uuid, uuid),
--     core.cfg_brand_cmd_publish(bytea, uuid, uuid, jsonb),
--     core.cfg_brand_cmd_rollback(bytea, uuid, uuid, uuid, jsonb),
--     core.cfg_brand_staff_versions(bytea, uuid, integer),
--     core.cfg_content_cmd_save_draft(bytea, uuid, text, text, jsonb, uuid),
--     core.cfg_content_cmd_publish(bytea, uuid, text, text, integer),
--     core.cfg_content_cmd_rollback(bytea, uuid, text, text, integer),
--     core.cfg_brand_authorize(bytea, text, text, text, text, uuid, uuid),
--     core.cfg_brand_contrast_valid(jsonb), core.cfg_brand_body_allowed(text),
--     core.cfg_brand_version_guard(), core.cfg_content_block_guard(),
--     core.cfg_brand_asset_guard(), core.cfg_brand_no_truncate();
--   DROP TABLE core.config_content_block, core.config_brand_version, core.config_brand_asset;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-034%';
--   DROP POLICY iam_staff_insert ON core.audit_file_asset;
--   REVOKE INSERT ON core.audit_file_asset FROM iam_staff_owner.

-- 1. Permissions (17 §3.2.13 : `brand.publish`, rôle ADMIN ; 16 DSN-003 : brouillon = ADMIN) ------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('ADMIN', 'brand.edit',    'PLATFORM', '2026-11-03T00:00:00Z', 'US-034 : brouillons de marque et de contenu (16 DSN-003)'),
  ('ADMIN', 'brand.publish', 'PLATFORM', '2026-11-03T00:00:00Z', 'US-034 : publication et retour arrière (17 §3.2.13)');

-- 2. Fonctions pures de validation (SECURITY INVOKER, IMMUTABLE) ---------------------------------
-- Résultat du contrôle de contraste exigé d'une version publiée : objet, `passed` = true,
-- `failures` = tableau vide, `checker` nommé (le contrôle lui-même est celui d'US-030, côté API).
CREATE FUNCTION core.cfg_brand_contrast_valid(p_check jsonb)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  -- jamais NULL : un NULL passerait un CHECK et ne serait pas « faux » pour un IF NOT (fail-closed)
  SELECT COALESCE(
           pg_catalog.jsonb_typeof(p_check) = 'object'
           AND p_check -> 'passed' = 'true'::jsonb
           AND pg_catalog.jsonb_typeof(p_check -> 'failures') = 'array'
           AND pg_catalog.jsonb_array_length(p_check -> 'failures') = 0
           AND pg_catalog.jsonb_typeof(p_check -> 'checker') = 'string',
           false)
$fn$;

-- Markdown restreint d'un bloc (17 §3.2.13) : aucune balise HTML (donc aucun script), aucune URL
-- absolue (`schéma:/`, `www.`), aucune cible de lien hors du site (`](//…`, `](x…`, donc ni
-- `javascript:` ni `mailto:`), aucun lien par référence ; liens internes (`/…`, `#…`) seulement.
-- Filet de sécurité : l'API applique les mêmes règles avec un message précis.
CREATE FUNCTION core.cfg_brand_body_allowed(p_body text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           pg_catalog.char_length(pg_catalog.btrim(p_body)) BETWEEN 1 AND 20000
           AND p_body !~ '<[A-Za-z!/?]'
           AND p_body !~* '[a-z][a-z0-9+.-]*:[/\\]'
           AND p_body !~* '(^|[^a-z0-9])www\.'
           AND p_body !~ '\]\(\s*(//|[^/#\s)])'
           AND p_body !~ '\]\s*\[[^\]]*\]'
           AND p_body !~ '^\s*\[[^\]]+\]:'
           AND p_body !~ '\n\s*\[[^\]]+\]:',
           false)
$fn$;
REVOKE ALL ON FUNCTION core.cfg_brand_contrast_valid(jsonb), core.cfg_brand_body_allowed(text)
  FROM PUBLIC;

-- 3. Actifs de marque (17 §3.2.13 `brand_asset`, trilingue : alt_text_fr ajouté, US-060) --------
-- Emplacement, type, taille et empreinte sont recopiés de `file_asset` à l'enregistrement (même
-- commande, mêmes valeurs) : la lecture publique ne touche jamais une table d'audit.
CREATE TABLE core.config_brand_asset (
  id            uuid        CONSTRAINT brand_asset_pkey PRIMARY KEY,
  kind          text        NOT NULL
    CONSTRAINT brand_asset_kind_valid CHECK (kind IN ('LOGO', 'FAVICON', 'PWA_ICON', 'HERO_IMAGE', 'FONT')),
  file_asset_id uuid        NOT NULL
    CONSTRAINT brand_asset_file_unique UNIQUE
    REFERENCES core.audit_file_asset (id),
  storage_key   text        NOT NULL,
  mime          text        NOT NULL,
  bytes         bigint      NOT NULL
    CONSTRAINT brand_asset_bytes_valid CHECK (bytes BETWEEN 1 AND 10485760),
  sha256        bytea       NOT NULL
    CONSTRAINT brand_asset_sha256_size CHECK (pg_catalog.octet_length(sha256) = 32),
  alt_text_es   text,
  alt_text_en   text,
  alt_text_fr   text,
  license_note  text        NOT NULL
    CONSTRAINT brand_asset_license_length CHECK (pg_catalog.char_length(pg_catalog.btrim(license_note)) BETWEEN 3 AND 1000),
  uploaded_by   uuid        NOT NULL REFERENCES core.iam_user_account (id),
  created_at    timestamptz NOT NULL DEFAULT platform.now(),
  request_id    uuid        NOT NULL CONSTRAINT brand_asset_request_unique UNIQUE,
  -- images matricielles seulement (jamais de SVG dans un bucket public : script possible) ;
  -- polices en WOFF2. Liste PROPOSÉE (ADR-067), fail-closed.
  CONSTRAINT brand_asset_mime_valid CHECK (
    (kind = 'FONT' AND mime = 'font/woff2')
    OR (kind <> 'FONT' AND mime IN ('image/png', 'image/jpeg', 'image/webp'))),
  -- trilingue (es, en, fr) : toute image porte son texte alternatif dans les trois langues
  CONSTRAINT brand_asset_alt_trilingual CHECK (
    kind = 'FONT'
    OR (pg_catalog.char_length(pg_catalog.btrim(alt_text_es)) BETWEEN 1 AND 300
        AND pg_catalog.char_length(pg_catalog.btrim(alt_text_en)) BETWEEN 1 AND 300
        AND pg_catalog.char_length(pg_catalog.btrim(alt_text_fr)) BETWEEN 1 AND 300)),
  CONSTRAINT brand_asset_storage_key_format CHECK (storage_key ~ '^brand/[0-9a-f-]{36}$')
);
COMMENT ON TABLE core.config_brand_asset IS
  'CFG brand_asset (17 §3.2.13) : actif de marque public (C0), fichier en file_asset (bucket BRAND). '
  'Immuable. Écrit par core.cfg_brand_cmd_register_asset seulement. US-034.';

-- 4. Versions de thème (17 §3.2.13 `brand_version`) --------------------------------------------
CREATE TABLE core.config_brand_version (
  id                    uuid        CONSTRAINT brand_version_pkey PRIMARY KEY,
  version_no            integer     NOT NULL
    CONSTRAINT brand_version_no_unique UNIQUE
    CONSTRAINT brand_version_no_positive CHECK (version_no > 0),
  status                text        NOT NULL
    CONSTRAINT brand_version_status_valid CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  brand_name            text        NOT NULL
    CONSTRAINT brand_version_name_valid CHECK (
      pg_catalog.char_length(pg_catalog.btrim(brand_name)) BETWEEN 1 AND 60
      AND brand_name !~ '[[:cntrl:]<>{}]'),
  tokens                jsonb       NOT NULL
    CONSTRAINT brand_version_tokens_object CHECK (
      pg_catalog.jsonb_typeof(tokens) = 'object'
      AND pg_catalog.octet_length(tokens::text) <= 131072),
  tokens_schema_version integer     NOT NULL
    CONSTRAINT brand_version_schema_positive CHECK (tokens_schema_version > 0),
  logo_asset_id         uuid        REFERENCES core.config_brand_asset (id),
  favicon_asset_id      uuid        REFERENCES core.config_brand_asset (id),
  pwa_icon_asset_id     uuid        REFERENCES core.config_brand_asset (id),
  -- habillage des gabarits (US-020 e-mail, lot 5 WhatsApp) : jamais le texte transactionnel
  email_skin            jsonb
    CONSTRAINT brand_version_email_skin_object CHECK (email_skin IS NULL OR pg_catalog.jsonb_typeof(email_skin) = 'object'),
  whatsapp_skin         jsonb
    CONSTRAINT brand_version_whatsapp_skin_object CHECK (whatsapp_skin IS NULL OR pg_catalog.jsonb_typeof(whatsapp_skin) = 'object'),
  contrast_check        jsonb,
  copied_from_id        uuid        REFERENCES core.config_brand_version (id),
  created_by            uuid        NOT NULL REFERENCES core.iam_user_account (id),
  created_at            timestamptz NOT NULL DEFAULT platform.now(),
  published_by          uuid        REFERENCES core.iam_user_account (id),
  published_at          timestamptz,
  archived_at           timestamptz,
  request_id            uuid        NOT NULL CONSTRAINT brand_version_request_unique UNIQUE,
  CONSTRAINT brand_version_publication_complete CHECK (
    (status = 'DRAFT') = (published_at IS NULL) AND (published_at IS NULL) = (published_by IS NULL)),
  CONSTRAINT brand_version_archive_complete CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL)),
  -- 17 §3.2.13 : « publication refusée si contrast_check échoue »
  CONSTRAINT brand_version_contrast_passed CHECK (
    status = 'DRAFT' OR core.cfg_brand_contrast_valid(contrast_check))
);
-- une seule version publiée (17 §3.2.13)
CREATE UNIQUE INDEX brand_version_one_published ON core.config_brand_version ((true))
  WHERE status = 'PUBLISHED';
COMMENT ON TABLE core.config_brand_version IS
  'CFG brand_version (17 §3.2.13, ADR-036) : thème versionné (jetons DTCG), une seule version '
  'PUBLISHED, retour arrière par copie ; écrit par les commandes core.cfg_brand_cmd_* seulement. US-034.';

-- 5. Blocs de contenu (17 §3.2.13 `content_block`) ----------------------------------------------
-- Un enregistrement de brouillon crée les TROIS langues (es, en, fr) sous le même numéro de
-- version : un bloc n'existe jamais dans une seule langue (exigence trilingue, US-060).
CREATE TABLE core.config_content_block (
  id             uuid        CONSTRAINT content_block_pkey PRIMARY KEY,
  block_key      text        NOT NULL
    CONSTRAINT content_block_key_format CHECK (
      block_key ~ '^[a-z][a-z0-9_]{0,39}(\.[a-z][a-z0-9_]{0,39}){1,5}$'
      AND pg_catalog.char_length(block_key) <= 120)
    -- les textes juridiques sont des document_template versionnés (LEG), jamais des blocs
    CONSTRAINT content_block_key_not_legal CHECK (block_key !~ '^legal\.'),
  locale         text        NOT NULL
    CONSTRAINT content_block_locale_valid CHECK (locale IN ('es', 'en', 'fr')),
  country_code   char(2)     REFERENCES core.config_country (code),   -- NULL = commun à tous
  version_no     integer     NOT NULL
    CONSTRAINT content_block_version_positive CHECK (version_no > 0),
  status         text        NOT NULL
    CONSTRAINT content_block_status_valid CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  body_md        text        NOT NULL
    CONSTRAINT content_block_body_allowed CHECK (core.cfg_brand_body_allowed(body_md)),
  asset_id       uuid        REFERENCES core.config_brand_asset (id),
  copied_from_id uuid        REFERENCES core.config_content_block (id),
  created_by     uuid        NOT NULL REFERENCES core.iam_user_account (id),
  created_at     timestamptz NOT NULL DEFAULT platform.now(),
  published_by   uuid        REFERENCES core.iam_user_account (id),
  published_at   timestamptz,
  archived_at    timestamptz,
  request_id     uuid        NOT NULL,
  CONSTRAINT content_block_version_unique UNIQUE NULLS NOT DISTINCT (block_key, country_code, version_no, locale),
  CONSTRAINT content_block_request_unique UNIQUE (request_id, locale),
  CONSTRAINT content_block_publication_complete CHECK (
    (status = 'DRAFT') = (published_at IS NULL) AND (published_at IS NULL) = (published_by IS NULL)),
  CONSTRAINT content_block_archive_complete CHECK ((status = 'ARCHIVED') = (archived_at IS NOT NULL))
);
-- une seule version publiée par clé, langue et pays (17 §3.2.13)
CREATE UNIQUE INDEX content_block_one_published
  ON core.config_content_block (block_key, locale, country_code) NULLS NOT DISTINCT
  WHERE status = 'PUBLISHED';
COMMENT ON TABLE core.config_content_block IS
  'CFG content_block (17 §3.2.13, DSN-004) : texte non juridique par clé, langue (es, en, fr) et pays, '
  'versionné ; écrit par les commandes core.cfg_content_cmd_* seulement. US-034.';

-- 6. Gardes : versions jamais écrasées ni supprimées (tous rôles, migrator compris) -------------
CREATE FUNCTION core.cfg_brand_version_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'DRAFT' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.version_no, NEW.brand_name, NEW.tokens, NEW.tokens_schema_version,
          NEW.logo_asset_id, NEW.favicon_asset_id, NEW.pwa_icon_asset_id, NEW.email_skin,
          NEW.whatsapp_skin, NEW.copied_from_id, NEW.created_by, NEW.created_at, NEW.request_id)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.version_no, OLD.brand_name, OLD.tokens, OLD.tokens_schema_version,
          OLD.logo_asset_id, OLD.favicon_asset_id, OLD.pwa_icon_asset_id, OLD.email_skin,
          OLD.whatsapp_skin, OLD.copied_from_id, OLD.created_by, OLD.created_at, OLD.request_id) THEN
    -- DRAFT -> PUBLISHED (publication) ; PUBLISHED -> ARCHIVED (remplacée), rien d'autre
    IF OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' AND NEW.archived_at IS NULL THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'PUBLISHED' AND NEW.status = 'ARCHIVED'
       AND NEW.contrast_check IS NOT DISTINCT FROM OLD.contrast_check
       AND NEW.published_by IS NOT DISTINCT FROM OLD.published_by
       AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'brand_version: versions are never overwritten (% refused)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'brand_version_immutable';
END
$fn$;

CREATE FUNCTION core.cfg_content_block_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'DRAFT' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE'
     AND (NEW.id, NEW.block_key, NEW.locale, NEW.country_code, NEW.version_no, NEW.body_md,
          NEW.asset_id, NEW.copied_from_id, NEW.created_by, NEW.created_at, NEW.request_id)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.block_key, OLD.locale, OLD.country_code, OLD.version_no, OLD.body_md,
          OLD.asset_id, OLD.copied_from_id, OLD.created_by, OLD.created_at, OLD.request_id) THEN
    IF OLD.status = 'DRAFT' AND NEW.status = 'PUBLISHED' AND NEW.archived_at IS NULL THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'PUBLISHED' AND NEW.status = 'ARCHIVED'
       AND NEW.published_by IS NOT DISTINCT FROM OLD.published_by
       AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'content_block: versions are never overwritten (% refused)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'content_block_immutable';
END
$fn$;

CREATE FUNCTION core.cfg_brand_asset_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'brand_asset: assets are immutable (% refused)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'brand_asset_immutable';
END
$fn$;

CREATE FUNCTION core.cfg_brand_no_truncate()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION '%: TRUNCATE refused (versions are kept)', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'brand_history_kept';
END
$fn$;
REVOKE ALL ON FUNCTION core.cfg_brand_version_guard(), core.cfg_content_block_guard(),
  core.cfg_brand_asset_guard(), core.cfg_brand_no_truncate() FROM PUBLIC;

CREATE TRIGGER brand_version_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON core.config_brand_version
  FOR EACH ROW EXECUTE FUNCTION core.cfg_brand_version_guard();
CREATE TRIGGER brand_version_no_truncate
  BEFORE TRUNCATE ON core.config_brand_version
  FOR EACH STATEMENT EXECUTE FUNCTION core.cfg_brand_no_truncate();
CREATE TRIGGER content_block_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON core.config_content_block
  FOR EACH ROW EXECUTE FUNCTION core.cfg_content_block_guard();
CREATE TRIGGER content_block_no_truncate
  BEFORE TRUNCATE ON core.config_content_block
  FOR EACH STATEMENT EXECUTE FUNCTION core.cfg_brand_no_truncate();
CREATE TRIGGER brand_asset_immutable
  BEFORE UPDATE OR DELETE ON core.config_brand_asset
  FOR EACH ROW EXECUTE FUNCTION core.cfg_brand_asset_guard();
CREATE TRIGGER brand_asset_no_truncate
  BEFORE TRUNCATE ON core.config_brand_asset
  FOR EACH STATEMENT EXECUTE FUNCTION core.cfg_brand_no_truncate();

-- 7. RLS : ENABLE + FORCE, migrator_all ; lecture publique d'app_api ; écriture par commandes ---
ALTER TABLE core.config_brand_asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.config_brand_asset FORCE ROW LEVEL SECURITY;
ALTER TABLE core.config_brand_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.config_brand_version FORCE ROW LEVEL SECURITY;
ALTER TABLE core.config_content_block ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.config_content_block FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.config_brand_asset TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.config_brand_version TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.config_content_block TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.config_brand_asset, core.config_brand_version, core.config_content_block FROM PUBLIC;

-- Lecture publique (API de lecture mise en cache, US-034) : versions et blocs PUBLISHED seulement,
-- sans identifiant du personnel (created_by, published_by, uploaded_by) ni requête ; actifs
-- référencés par la version ou un bloc publiés (un logo en brouillon n'est pas divulgué).
GRANT SELECT (id, version_no, status, brand_name, tokens, tokens_schema_version, logo_asset_id,
              favicon_asset_id, pwa_icon_asset_id, email_skin, whatsapp_skin, published_at)
  ON core.config_brand_version TO app_api;
CREATE POLICY api_read_published ON core.config_brand_version FOR SELECT TO app_api
  USING (status = 'PUBLISHED');
GRANT SELECT (id, block_key, locale, country_code, version_no, status, body_md, asset_id, published_at)
  ON core.config_content_block TO app_api;
CREATE POLICY api_read_published ON core.config_content_block FOR SELECT TO app_api
  USING (status = 'PUBLISHED');
GRANT SELECT (id, kind, storage_key, mime, bytes, sha256, alt_text_es, alt_text_en, alt_text_fr)
  ON core.config_brand_asset TO app_api;
CREATE POLICY api_read_published ON core.config_brand_asset FOR SELECT TO app_api
  USING (EXISTS (SELECT 1 FROM core.config_brand_version AS v
                  WHERE v.status = 'PUBLISHED'
                    AND config_brand_asset.id IN (v.logo_asset_id, v.favicon_asset_id, v.pwa_icon_asset_id))
         OR EXISTS (SELECT 1 FROM core.config_content_block AS b
                     WHERE b.status = 'PUBLISHED' AND b.asset_id = config_brand_asset.id));

-- Droits d'iam_staff_owner (propriétaire des commandes) : au plus juste.
GRANT SELECT ON core.config_brand_asset, core.config_brand_version, core.config_content_block
  TO iam_staff_owner;
GRANT INSERT (id, kind, file_asset_id, storage_key, mime, bytes, sha256, alt_text_es, alt_text_en,
              alt_text_fr, license_note, uploaded_by, request_id)
  ON core.config_brand_asset TO iam_staff_owner;
GRANT INSERT (id, version_no, status, brand_name, tokens, tokens_schema_version, logo_asset_id,
              favicon_asset_id, pwa_icon_asset_id, copied_from_id, created_by, request_id)
  ON core.config_brand_version TO iam_staff_owner;
GRANT UPDATE (status, contrast_check, published_by, published_at, archived_at)
  ON core.config_brand_version TO iam_staff_owner;
GRANT INSERT (id, block_key, locale, country_code, version_no, status, body_md, asset_id,
              copied_from_id, created_by, request_id)
  ON core.config_content_block TO iam_staff_owner;
GRANT UPDATE (status, published_by, published_at, archived_at)
  ON core.config_content_block TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.config_brand_asset FOR SELECT TO iam_staff_owner USING (true);
CREATE POLICY iam_staff_insert ON core.config_brand_asset FOR INSERT TO iam_staff_owner WITH CHECK (true);
CREATE POLICY iam_staff_select ON core.config_brand_version FOR SELECT TO iam_staff_owner USING (true);
CREATE POLICY iam_staff_insert ON core.config_brand_version FOR INSERT TO iam_staff_owner
  WITH CHECK (status = 'DRAFT');
CREATE POLICY iam_staff_update ON core.config_brand_version FOR UPDATE TO iam_staff_owner
  USING (status IN ('DRAFT', 'PUBLISHED')) WITH CHECK (status IN ('PUBLISHED', 'ARCHIVED'));
CREATE POLICY iam_staff_select ON core.config_content_block FOR SELECT TO iam_staff_owner USING (true);
CREATE POLICY iam_staff_insert ON core.config_content_block FOR INSERT TO iam_staff_owner
  WITH CHECK (status = 'DRAFT');
CREATE POLICY iam_staff_update ON core.config_content_block FOR UPDATE TO iam_staff_owner
  USING (status IN ('DRAFT', 'PUBLISHED')) WITH CHECK (status IN ('PUBLISHED', 'ARCHIVED'));

-- Fichiers de marque : la commande d'enregistrement écrit la ligne `file_asset` (bucket public
-- BRAND, C0, téléversement du staff), jamais un autre bucket (aucune lecture, aucune mise à jour).
GRANT INSERT (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id, source,
              classification, retention_class)
  ON core.audit_file_asset TO iam_staff_owner;
CREATE POLICY iam_staff_insert ON core.audit_file_asset FOR INSERT TO iam_staff_owner
  WITH CHECK (bucket = 'BRAND' AND classification = 'C0' AND source = 'STAFF_UPLOAD'
              AND enc_subject_type IS NULL AND retention_class = 'BRAND_PUBLIC');

GRANT EXECUTE ON FUNCTION core.cfg_brand_contrast_valid(jsonb), core.cfg_brand_body_allowed(text)
  TO iam_staff_owner;

-- 8. Autorisation commune des commandes (SECURITY INVOKER, exécutée sous iam_staff_owner) -------
-- Session vivante (empreinte du jeton), TOTP, puis permission sur TOUS les pays déclarés (thème et
-- blocs communs : p_country NULL) ou sur le pays du bloc. Refus journalisés (16 ADM-001). Issues :
-- AUTH_REQUIRED (aucun acteur, rien à journaliser), MFA_REQUIRED, FORBIDDEN, OK.
CREATE FUNCTION core.cfg_brand_authorize(p_token_hash bytea, p_permission text, p_country text,
                                         p_attempted text, p_subject_type text, p_subject_id uuid,
                                         p_request_id uuid,
                                         OUT outcome text, OUT actor uuid, OUT actor_role text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s         record;
  v_countries text[];
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    outcome := 'AUTH_REQUIRED';
    RETURN;
  END IF;
  actor := v_s.user_id;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', p_subject_type,
                                 COALESCE(p_subject_id, v_s.user_id), NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', p_attempted), NULL, p_request_id);
    outcome := 'MFA_REQUIRED';
    RETURN;
  END IF;
  IF p_country IS NULL THEN
    SELECT pg_catalog.array_agg(k.code::text ORDER BY k.code) INTO v_countries
      FROM core.config_country AS k;
  ELSE
    v_countries := ARRAY[p_country];
  END IF;
  actor_role := core.iam_staff_permitted(v_s.user_id, p_permission, COALESCE(v_countries, '{}'), NULL);
  IF actor_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', p_subject_type,
                                 COALESCE(p_subject_id, v_s.user_id), NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION',
                                   'attempted', p_attempted, 'permission', p_permission), NULL,
                                 p_request_id);
    outcome := 'FORBIDDEN';
    RETURN;
  END IF;
  outcome := 'OK';
END
$fn$;
REVOKE ALL ON FUNCTION core.cfg_brand_authorize(bytea, text, text, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.cfg_brand_authorize(bytea, text, text, text, text, uuid, uuid)
  TO iam_staff_owner;

-- 9. Commandes de marque (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) ----------
-- Verrou de la marque : un seul écrivain à la fois (numérotation et publication).
-- Clé : hashtextextended('core.config_brand_version', 0), calculée à chaque appel.

-- Enregistrement d'un actif : ligne `file_asset` (BRAND, C0) puis `brand_asset`, dans la même
-- instruction, AVANT le dépôt de l'objet par l'API (ordre de la revue US-009, constat 1 ; port
-- FileStore en création seule). Empreinte et taille calculées par l'API sur les octets reçus.
-- Issues : AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, REGISTERED, DUPLICATE. Données invalides : 22023.
CREATE FUNCTION core.cfg_brand_cmd_register_asset(p_token_hash bytea, p_request_id uuid,
                                                  p_asset_id uuid, p_kind text, p_mime text,
                                                  p_bytes bigint, p_sha256 bytea, p_alt_es text,
                                                  p_alt_en text, p_alt_fr text, p_license_note text)
  RETURNS TABLE (outcome text, asset_id uuid, storage_key text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_a   record;
  v_id  uuid;
  v_key text;
BEGIN
  IF p_request_id IS NULL OR p_asset_id IS NULL OR p_kind IS NULL OR p_mime IS NULL
     OR p_bytes IS NULL OR p_sha256 IS NULL OR p_license_note IS NULL THEN
    RAISE EXCEPTION 'marque : données d''actif invalides' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.edit', NULL,
                                                  'BRAND_ASSET_REGISTER', 'BRAND_ASSET', p_asset_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT a.id, a.storage_key INTO v_id, v_key FROM core.config_brand_asset AS a
   WHERE a.request_id = p_request_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_id, v_key;
    RETURN;
  END IF;
  v_key := 'brand/' || p_asset_id::text;
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id,
                                     source, classification, retention_class)
  VALUES (p_asset_id, 'BRAND', v_key, p_mime, p_bytes, p_sha256, v_a.actor, 'STAFF_UPLOAD', 'C0',
          'BRAND_PUBLIC');
  INSERT INTO core.config_brand_asset (id, kind, file_asset_id, storage_key, mime, bytes, sha256,
                                       alt_text_es, alt_text_en, alt_text_fr, license_note,
                                       uploaded_by, request_id)
  VALUES (p_asset_id, p_kind, p_asset_id, v_key, p_mime, p_bytes, p_sha256,
          NULLIF(pg_catalog.btrim(p_alt_es), ''), NULLIF(pg_catalog.btrim(p_alt_en), ''),
          NULLIF(pg_catalog.btrim(p_alt_fr), ''), pg_catalog.btrim(p_license_note), v_a.actor,
          p_request_id);
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'BRAND_ASSET_REGISTERED', 'BRAND_ASSET',
                               p_asset_id, NULL,
                               pg_catalog.jsonb_build_object('kind', p_kind, 'mime', p_mime,
                                 'bytes', p_bytes, 'sha256', pg_catalog.encode(p_sha256, 'hex')),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'REGISTERED'::text, p_asset_id, v_key;
END
$fn$;

-- Brouillon de thème (nouvelle version DRAFT, numéro suivant). Les jetons ont été validés par
-- l'API (format, polices approuvées) ; les actifs doivent exister et être du bon type. Issues :
-- AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, SAVED, DUPLICATE. Données invalides : 22023.
CREATE FUNCTION core.cfg_brand_cmd_save_draft(p_token_hash bytea, p_request_id uuid,
                                              p_version_id uuid, p_brand_name text, p_tokens jsonb,
                                              p_tokens_schema_version integer, p_logo_asset_id uuid,
                                              p_favicon_asset_id uuid, p_pwa_icon_asset_id uuid,
                                              p_copied_from_id uuid)
  RETURNS TABLE (outcome text, version_id uuid, version_no integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_a  record;
  v_id uuid;
  v_no integer;
BEGIN
  IF p_request_id IS NULL OR p_version_id IS NULL OR p_brand_name IS NULL OR p_tokens IS NULL
     OR p_tokens_schema_version IS NULL THEN
    RAISE EXCEPTION 'marque : brouillon invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.edit', NULL,
                                                  'BRAND_SAVE_DRAFT', 'BRAND_VERSION', p_version_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  SELECT v.id, v.version_no INTO v_id, v_no FROM core.config_brand_version AS v
   WHERE v.request_id = p_request_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_id, v_no;
    RETURN;
  END IF;
  IF (p_logo_asset_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM core.config_brand_asset AS a WHERE a.id = p_logo_asset_id AND a.kind = 'LOGO'))
     OR (p_favicon_asset_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM core.config_brand_asset AS a WHERE a.id = p_favicon_asset_id AND a.kind = 'FAVICON'))
     OR (p_pwa_icon_asset_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM core.config_brand_asset AS a WHERE a.id = p_pwa_icon_asset_id AND a.kind = 'PWA_ICON'))
     OR (p_copied_from_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM core.config_brand_version AS v WHERE v.id = p_copied_from_id)) THEN
    RAISE EXCEPTION 'marque : actif ou version d''origine inconnu' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('core.config_brand_version', 0));
  SELECT COALESCE(pg_catalog.max(v.version_no), 0) + 1 INTO v_no FROM core.config_brand_version AS v;
  INSERT INTO core.config_brand_version (id, version_no, status, brand_name, tokens,
                                         tokens_schema_version, logo_asset_id, favicon_asset_id,
                                         pwa_icon_asset_id, copied_from_id, created_by, request_id)
  VALUES (p_version_id, v_no, 'DRAFT', pg_catalog.btrim(p_brand_name), p_tokens,
          p_tokens_schema_version, p_logo_asset_id, p_favicon_asset_id, p_pwa_icon_asset_id,
          p_copied_from_id, v_a.actor, p_request_id);
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'BRAND_DRAFT_SAVED', 'BRAND_VERSION',
                               p_version_id, NULL,
                               pg_catalog.jsonb_build_object('versionNo', v_no,
                                 'brandName', pg_catalog.btrim(p_brand_name),
                                 'copiedFromId', p_copied_from_id),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'SAVED'::text, p_version_id, v_no;
END
$fn$;

-- Publication atomique d'un brouillon. `p_contrast_check` = rapport du contrôle d'US-030 calculé
-- par l'API sur les jetons de CE brouillon (immuable) : `passed` false => refus journalisé avec
-- les paires en cause, rien ne change. Sinon, dans la même instruction et sous le verrou de la
-- marque : la version publiée passe ARCHIVED, le brouillon PUBLISHED. Issues : AUTH_REQUIRED,
-- MFA_REQUIRED, FORBIDDEN, NOT_FOUND, NOT_DRAFT, CONTRAST_INSUFFICIENT, PUBLISHED.
CREATE FUNCTION core.cfg_brand_cmd_publish(p_token_hash bytea, p_request_id uuid,
                                           p_version_id uuid, p_contrast_check jsonb)
  RETURNS TABLE (outcome text, version_id uuid, version_no integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz := platform.now();
  v_a    record;
  v_t    record;
  v_prev record;
BEGIN
  IF p_request_id IS NULL OR p_version_id IS NULL OR p_contrast_check IS NULL
     OR pg_catalog.jsonb_typeof(p_contrast_check) <> 'object'
     OR pg_catalog.jsonb_typeof(p_contrast_check -> 'passed') <> 'boolean'
     OR pg_catalog.jsonb_typeof(p_contrast_check -> 'failures') <> 'array'
     OR pg_catalog.octet_length(p_contrast_check::text) > 65536 THEN
    RAISE EXCEPTION 'marque : rapport de contraste invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.publish', NULL,
                                                  'BRAND_PUBLISH', 'BRAND_VERSION', p_version_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('core.config_brand_version', 0));
  SELECT v.id, v.version_no, v.status INTO v_t FROM core.config_brand_version AS v
   WHERE v.id = p_version_id;
  IF v_t.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  IF v_t.status <> 'DRAFT' THEN
    RETURN QUERY SELECT 'NOT_DRAFT'::text, v_t.id, v_t.version_no;
    RETURN;
  END IF;
  IF NOT core.cfg_brand_contrast_valid(p_contrast_check) THEN
    PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'BRAND_PUBLISH_REFUSED', 'BRAND_VERSION',
                                 v_t.id, NULL,
                                 pg_catalog.jsonb_build_object('versionNo', v_t.version_no,
                                   'reason', 'BRAND_CONTRAST_INSUFFICIENT',
                                   'failures', p_contrast_check -> 'failures'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'CONTRAST_INSUFFICIENT'::text, v_t.id, v_t.version_no;
    RETURN;
  END IF;
  SELECT v.id, v.version_no INTO v_prev FROM core.config_brand_version AS v
   WHERE v.status = 'PUBLISHED';
  UPDATE core.config_brand_version AS v SET status = 'ARCHIVED', archived_at = v_now
   WHERE v.status = 'PUBLISHED';
  UPDATE core.config_brand_version AS v
     SET status = 'PUBLISHED', contrast_check = p_contrast_check, published_by = v_a.actor,
         published_at = v_now
   WHERE v.id = v_t.id;
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'BRAND_PUBLISHED', 'BRAND_VERSION', v_t.id,
                               CASE WHEN v_prev.id IS NULL THEN NULL
                                    ELSE pg_catalog.jsonb_build_object('publishedVersionId', v_prev.id,
                                           'versionNo', v_prev.version_no) END,
                               pg_catalog.jsonb_build_object('versionId', v_t.id,
                                 'versionNo', v_t.version_no,
                                 'checker', p_contrast_check -> 'checker'),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'PUBLISHED'::text, v_t.id, v_t.version_no;
END
$fn$;

-- Retour arrière en un clic : copie de la version ARCHIVÉE p_target_id (une version déjà publiée)
-- en nouvelle version p_new_version_id (copied_from_id), aussitôt publiée, la publiée passant
-- ARCHIVED ; une seule instruction, sous le verrou. Le contraste de la cible est recontrôlé par
-- l'API (le contrôle d'US-030 a pu se durcir) : échec => refus journalisé. Issues : AUTH_REQUIRED,
-- MFA_REQUIRED, FORBIDDEN, NOT_FOUND, NOT_ARCHIVED, CONTRAST_INSUFFICIENT, ROLLED_BACK, DUPLICATE.
CREATE FUNCTION core.cfg_brand_cmd_rollback(p_token_hash bytea, p_request_id uuid,
                                            p_new_version_id uuid, p_target_id uuid,
                                            p_contrast_check jsonb)
  RETURNS TABLE (outcome text, version_id uuid, version_no integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz := platform.now();
  v_a    record;
  v_t    record;
  v_prev record;
  v_id   uuid;
  v_no   integer;
BEGIN
  IF p_request_id IS NULL OR p_new_version_id IS NULL OR p_target_id IS NULL
     OR p_contrast_check IS NULL OR pg_catalog.jsonb_typeof(p_contrast_check) <> 'object'
     OR pg_catalog.jsonb_typeof(p_contrast_check -> 'passed') <> 'boolean'
     OR pg_catalog.jsonb_typeof(p_contrast_check -> 'failures') <> 'array'
     OR pg_catalog.octet_length(p_contrast_check::text) > 65536 THEN
    RAISE EXCEPTION 'marque : retour arrière invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.publish', NULL,
                                                  'BRAND_ROLLBACK', 'BRAND_VERSION', p_target_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('core.config_brand_version', 0));
  SELECT v.id, v.version_no INTO v_id, v_no FROM core.config_brand_version AS v
   WHERE v.request_id = p_request_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_id, v_no;
    RETURN;
  END IF;
  SELECT v.* INTO v_t FROM core.config_brand_version AS v WHERE v.id = p_target_id;
  IF v_t.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  IF v_t.status <> 'ARCHIVED' THEN
    RETURN QUERY SELECT 'NOT_ARCHIVED'::text, v_t.id, v_t.version_no;
    RETURN;
  END IF;
  IF NOT core.cfg_brand_contrast_valid(p_contrast_check) THEN
    PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'BRAND_ROLLBACK_REFUSED', 'BRAND_VERSION',
                                 v_t.id, NULL,
                                 pg_catalog.jsonb_build_object('versionNo', v_t.version_no,
                                   'reason', 'BRAND_CONTRAST_INSUFFICIENT',
                                   'failures', p_contrast_check -> 'failures'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'CONTRAST_INSUFFICIENT'::text, v_t.id, v_t.version_no;
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.max(v.version_no), 0) + 1 INTO v_no FROM core.config_brand_version AS v;
  INSERT INTO core.config_brand_version (id, version_no, status, brand_name, tokens,
                                         tokens_schema_version, logo_asset_id, favicon_asset_id,
                                         pwa_icon_asset_id, copied_from_id, created_by, request_id)
  VALUES (p_new_version_id, v_no, 'DRAFT', v_t.brand_name, v_t.tokens, v_t.tokens_schema_version,
          v_t.logo_asset_id, v_t.favicon_asset_id, v_t.pwa_icon_asset_id, v_t.id, v_a.actor,
          p_request_id);
  SELECT v.id, v.version_no INTO v_prev FROM core.config_brand_version AS v
   WHERE v.status = 'PUBLISHED';
  UPDATE core.config_brand_version AS v SET status = 'ARCHIVED', archived_at = v_now
   WHERE v.status = 'PUBLISHED';
  UPDATE core.config_brand_version AS v
     SET status = 'PUBLISHED', contrast_check = p_contrast_check, published_by = v_a.actor,
         published_at = v_now
   WHERE v.id = p_new_version_id;
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'BRAND_ROLLED_BACK', 'BRAND_VERSION',
                               p_new_version_id,
                               CASE WHEN v_prev.id IS NULL THEN NULL
                                    ELSE pg_catalog.jsonb_build_object('publishedVersionId', v_prev.id,
                                           'versionNo', v_prev.version_no) END,
                               pg_catalog.jsonb_build_object('versionId', p_new_version_id,
                                 'versionNo', v_no, 'copiedFromId', v_t.id,
                                 'copiedFromVersionNo', v_t.version_no,
                                 'checker', p_contrast_check -> 'checker'),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'ROLLED_BACK'::text, p_new_version_id, v_no;
END
$fn$;

-- Historique des versions pour la console (brouillons compris, prévisualisation, US-120) :
-- `brand.edit`, de la plus récente à la plus ancienne, 1 à 100 lignes ; une seule si p_version_id.
-- Session non élevée ou sans permission : aucune ligne, refus journalisé.
CREATE FUNCTION core.cfg_brand_staff_versions(p_token_hash bytea, p_version_id uuid, p_limit integer)
  RETURNS TABLE (id uuid, version_no integer, status text, brand_name text, tokens jsonb,
                 tokens_schema_version integer, logo_asset_id uuid, favicon_asset_id uuid,
                 pwa_icon_asset_id uuid, contrast_check jsonb, copied_from_id uuid,
                 created_by uuid, created_at timestamptz, published_by uuid,
                 published_at timestamptz, archived_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_a     record;
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
BEGIN
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.edit', NULL,
                                                  'BRAND_READ', 'BRAND_VERSION', p_version_id,
                                                  NULL);
  IF v_a.outcome <> 'OK' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT v.id, v.version_no, v.status, v.brand_name, v.tokens, v.tokens_schema_version,
           v.logo_asset_id, v.favicon_asset_id, v.pwa_icon_asset_id, v.contrast_check,
           v.copied_from_id, v.created_by, v.created_at, v.published_by, v.published_at,
           v.archived_at
      FROM core.config_brand_version AS v
     WHERE p_version_id IS NULL OR v.id = p_version_id
     ORDER BY v.version_no DESC
     LIMIT v_limit;
END
$fn$;

-- 10. Commandes des blocs de contenu ------------------------------------------------------------
-- Brouillon d'un bloc : les TROIS langues ensemble (p_bodies = {"es": …, "en": …, "fr": …}, aucune
-- autre clé), même numéro de version, suivant pour (clé, pays). Une langue absente ou vide :
-- LOCALE_MISSING (16 DSN-004 : CONTENT_BLOCK_REQUIRED_MISSING). Clé `legal.*`, Markdown hors des
-- règles, pays inconnu : 22023 / 23514. Issues : AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN,
-- LOCALE_MISSING, SAVED, DUPLICATE.
CREATE FUNCTION core.cfg_content_cmd_save_draft(p_token_hash bytea, p_request_id uuid,
                                                p_block_key text, p_country text, p_bodies jsonb,
                                                p_asset_id uuid)
  RETURNS TABLE (outcome text, version_no integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_a      record;
  v_no     integer;
  v_locale text;
  v_first  uuid;
  v_id     uuid;
BEGIN
  IF p_request_id IS NULL OR p_block_key IS NULL OR p_bodies IS NULL
     OR pg_catalog.jsonb_typeof(p_bodies) <> 'object'
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_bodies) AS k(key)
                 WHERE k.key NOT IN ('es', 'en', 'fr'))
     OR (p_country IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM core.config_country AS c WHERE c.code = p_country))
     OR (p_asset_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM core.config_brand_asset AS a WHERE a.id = p_asset_id AND a.kind = 'HERO_IMAGE')) THEN
    RAISE EXCEPTION 'contenu : brouillon invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.edit', p_country,
                                                  'CONTENT_SAVE_DRAFT', 'CONTENT_BLOCK', p_request_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::integer;
    RETURN;
  END IF;
  SELECT b.version_no INTO v_no FROM core.config_content_block AS b
   WHERE b.request_id = p_request_id LIMIT 1;
  IF v_no IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_no;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(ARRAY['es', 'en', 'fr']) AS l(locale)
              WHERE pg_catalog.jsonb_typeof(p_bodies -> l.locale) IS DISTINCT FROM 'string'
                 OR pg_catalog.btrim(p_bodies ->> l.locale) = '') THEN
    RETURN QUERY SELECT 'LOCALE_MISSING'::text, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.config_content_block:' || p_block_key || ':' || COALESCE(p_country, ''), 0));
  SELECT COALESCE(pg_catalog.max(b.version_no), 0) + 1 INTO v_no FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country;
  FOREACH v_locale IN ARRAY ARRAY['es', 'en', 'fr'] LOOP
    v_id := pg_catalog.gen_random_uuid();
    v_first := COALESCE(v_first, v_id);
    INSERT INTO core.config_content_block (id, block_key, locale, country_code, version_no, status,
                                           body_md, asset_id, created_by, request_id)
    VALUES (v_id, p_block_key, v_locale, p_country, v_no, 'DRAFT', p_bodies ->> v_locale, p_asset_id,
            v_a.actor, p_request_id);
  END LOOP;
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'CONTENT_DRAFT_SAVED', 'CONTENT_BLOCK',
                               v_first, NULL,
                               pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                 'blockKey', p_block_key, 'country', p_country, 'versionNo', v_no)),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'SAVED'::text, v_no;
END
$fn$;

-- Publication d'une version de bloc (les trois langues ensemble), atomique : la version publiée
-- de (clé, pays) passe ARCHIVED, la cible PUBLISHED. Issues : AUTH_REQUIRED, MFA_REQUIRED,
-- FORBIDDEN, NOT_FOUND, NOT_DRAFT, PUBLISHED.
CREATE FUNCTION core.cfg_content_cmd_publish(p_token_hash bytea, p_request_id uuid,
                                             p_block_key text, p_country text, p_version_no integer)
  RETURNS TABLE (outcome text, version_no integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now    timestamptz := platform.now();
  v_a      record;
  v_rows   integer;
  v_drafts integer;
  v_first  uuid;
  v_prev   integer;
BEGIN
  IF p_request_id IS NULL OR p_block_key IS NULL OR p_version_no IS NULL THEN
    RAISE EXCEPTION 'contenu : publication invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.publish', p_country,
                                                  'CONTENT_PUBLISH', 'CONTENT_BLOCK', p_request_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.config_content_block:' || p_block_key || ':' || COALESCE(p_country, ''), 0));
  SELECT pg_catalog.count(*)::integer, pg_catalog.count(*) FILTER (WHERE b.status = 'DRAFT')::integer
    INTO v_rows, v_drafts
    FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = p_version_no;
  IF v_rows = 0 THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::integer;
    RETURN;
  END IF;
  IF v_drafts <> 3 THEN
    RETURN QUERY SELECT 'NOT_DRAFT'::text, p_version_no;
    RETURN;
  END IF;
  SELECT pg_catalog.max(b.version_no) INTO v_prev FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'PUBLISHED';
  UPDATE core.config_content_block AS b SET status = 'ARCHIVED', archived_at = v_now
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'PUBLISHED';
  UPDATE core.config_content_block AS b
     SET status = 'PUBLISHED', published_by = v_a.actor, published_at = v_now
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = p_version_no;
  SELECT b.id INTO v_first FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = p_version_no AND b.locale = 'es';
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'CONTENT_PUBLISHED', 'CONTENT_BLOCK',
                               v_first,
                               CASE WHEN v_prev IS NULL THEN NULL
                                    ELSE pg_catalog.jsonb_build_object('versionNo', v_prev) END,
                               pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                 'blockKey', p_block_key, 'country', p_country,
                                 'versionNo', p_version_no)),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'PUBLISHED'::text, p_version_no;
END
$fn$;

-- Retour arrière d'un bloc : copie de la version ARCHIVÉE p_target_version_no (par défaut la
-- dernière version archivée, c'est-à-dire la précédente publiée) en nouvelle version publiée.
-- Issues : AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, NOT_FOUND, ROLLED_BACK, DUPLICATE.
CREATE FUNCTION core.cfg_content_cmd_rollback(p_token_hash bytea, p_request_id uuid,
                                              p_block_key text, p_country text,
                                              p_target_version_no integer)
  RETURNS TABLE (outcome text, version_no integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now    timestamptz := platform.now();
  v_a      record;
  v_target integer;
  v_no     integer;
  v_prev   integer;
  v_first  uuid;
  v_n      integer;
BEGIN
  IF p_request_id IS NULL OR p_block_key IS NULL THEN
    RAISE EXCEPTION 'contenu : retour arrière invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_a FROM core.cfg_brand_authorize(p_token_hash, 'brand.publish', p_country,
                                                  'CONTENT_ROLLBACK', 'CONTENT_BLOCK', p_request_id,
                                                  p_request_id);
  IF v_a.outcome <> 'OK' THEN
    RETURN QUERY SELECT v_a.outcome, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('core.config_content_block:' || p_block_key || ':' || COALESCE(p_country, ''), 0));
  SELECT b.version_no INTO v_no FROM core.config_content_block AS b
   WHERE b.request_id = p_request_id LIMIT 1;
  IF v_no IS NOT NULL THEN
    RETURN QUERY SELECT 'DUPLICATE'::text, v_no;
    RETURN;
  END IF;
  -- cible : la version archivée demandée, sinon la dernière publiée avant l'actuelle
  SELECT b.version_no INTO v_target FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'ARCHIVED'
     AND (p_target_version_no IS NULL OR b.version_no = p_target_version_no)
   ORDER BY b.published_at DESC, b.version_no DESC
   LIMIT 1;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = v_target AND b.status = 'ARCHIVED';
  IF v_target IS NULL OR v_n <> 3 THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.max(b.version_no), 0) + 1 INTO v_no FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country;
  INSERT INTO core.config_content_block (id, block_key, locale, country_code, version_no, status,
                                         body_md, asset_id, copied_from_id, created_by, request_id)
  SELECT pg_catalog.gen_random_uuid(), b.block_key, b.locale, b.country_code, v_no, 'DRAFT',
         b.body_md, b.asset_id, b.id, v_a.actor, p_request_id
    FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = v_target;
  SELECT pg_catalog.max(b.version_no) INTO v_prev FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'PUBLISHED';
  UPDATE core.config_content_block AS b SET status = 'ARCHIVED', archived_at = v_now
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.status = 'PUBLISHED';
  UPDATE core.config_content_block AS b
     SET status = 'PUBLISHED', published_by = v_a.actor, published_at = v_now
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = v_no;
  SELECT b.id INTO v_first FROM core.config_content_block AS b
   WHERE b.block_key = p_block_key AND b.country_code IS NOT DISTINCT FROM p_country
     AND b.version_no = v_no AND b.locale = 'es';
  PERFORM core.iam_staff_audit(v_a.actor, v_a.actor_role, 'CONTENT_ROLLED_BACK', 'CONTENT_BLOCK',
                               v_first,
                               CASE WHEN v_prev IS NULL THEN NULL
                                    ELSE pg_catalog.jsonb_build_object('versionNo', v_prev) END,
                               pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
                                 'blockKey', p_block_key, 'country', p_country, 'versionNo', v_no,
                                 'copiedFromVersionNo', v_target)),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'ROLLED_BACK'::text, v_no;
END
$fn$;

COMMENT ON FUNCTION core.cfg_brand_cmd_register_asset(bytea, uuid, uuid, text, text, bigint, bytea, text, text, text, text) IS
  'Actif de marque : file_asset (BRAND, C0) + brand_asset ; brand.edit ; journalisé. US-034.';
COMMENT ON FUNCTION core.cfg_brand_cmd_save_draft(bytea, uuid, uuid, text, jsonb, integer, uuid, uuid, uuid, uuid) IS
  'Brouillon de thème (nouvelle version DRAFT) ; brand.edit ; journalisé. US-034.';
COMMENT ON FUNCTION core.cfg_brand_cmd_publish(bytea, uuid, uuid, jsonb) IS
  'Publication atomique d''un brouillon (contraste US-030 exigé) ; brand.publish ; journalisée. US-034.';
COMMENT ON FUNCTION core.cfg_brand_cmd_rollback(bytea, uuid, uuid, uuid, jsonb) IS
  'Retour arrière : copie d''une version archivée, publiée ; brand.publish ; journalisé. US-034.';
COMMENT ON FUNCTION core.cfg_brand_staff_versions(bytea, uuid, integer) IS
  'Historique des versions de marque pour la console (brouillons compris) ; brand.edit. US-034.';
COMMENT ON FUNCTION core.cfg_content_cmd_save_draft(bytea, uuid, text, text, jsonb, uuid) IS
  'Brouillon de bloc de contenu, trois langues ensemble ; brand.edit ; journalisé. US-034.';
COMMENT ON FUNCTION core.cfg_content_cmd_publish(bytea, uuid, text, text, integer) IS
  'Publication atomique d''une version de bloc (trois langues) ; brand.publish ; journalisée. US-034.';
COMMENT ON FUNCTION core.cfg_content_cmd_rollback(bytea, uuid, text, text, integer) IS
  'Retour arrière d''un bloc : copie de la version archivée, publiée ; brand.publish. US-034.';

REVOKE ALL ON FUNCTION
  core.cfg_brand_cmd_register_asset(bytea, uuid, uuid, text, text, bigint, bytea, text, text, text, text),
  core.cfg_brand_cmd_save_draft(bytea, uuid, uuid, text, jsonb, integer, uuid, uuid, uuid, uuid),
  core.cfg_brand_cmd_publish(bytea, uuid, uuid, jsonb),
  core.cfg_brand_cmd_rollback(bytea, uuid, uuid, uuid, jsonb),
  core.cfg_brand_staff_versions(bytea, uuid, integer),
  core.cfg_content_cmd_save_draft(bytea, uuid, text, text, jsonb, uuid),
  core.cfg_content_cmd_publish(bytea, uuid, text, text, integer),
  core.cfg_content_cmd_rollback(bytea, uuid, text, text, integer)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.cfg_brand_cmd_register_asset(bytea, uuid, uuid, text, text, bigint, bytea, text, text, text, text),
  core.cfg_brand_cmd_save_draft(bytea, uuid, uuid, text, jsonb, integer, uuid, uuid, uuid, uuid),
  core.cfg_brand_cmd_publish(bytea, uuid, uuid, jsonb),
  core.cfg_brand_cmd_rollback(bytea, uuid, uuid, uuid, jsonb),
  core.cfg_brand_staff_versions(bytea, uuid, integer),
  core.cfg_content_cmd_save_draft(bytea, uuid, text, text, jsonb, uuid),
  core.cfg_content_cmd_publish(bytea, uuid, text, text, integer),
  core.cfg_content_cmd_rollback(bytea, uuid, text, text, integer)
TO app_api;

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
ALTER FUNCTION core.cfg_brand_cmd_register_asset(bytea, uuid, uuid, text, text, bigint, bytea, text, text, text, text)
  OWNER TO iam_staff_owner;
ALTER FUNCTION core.cfg_brand_cmd_save_draft(bytea, uuid, uuid, text, jsonb, integer, uuid, uuid, uuid, uuid)
  OWNER TO iam_staff_owner;
ALTER FUNCTION core.cfg_brand_cmd_publish(bytea, uuid, uuid, jsonb) OWNER TO iam_staff_owner;
ALTER FUNCTION core.cfg_brand_cmd_rollback(bytea, uuid, uuid, uuid, jsonb) OWNER TO iam_staff_owner;
ALTER FUNCTION core.cfg_brand_staff_versions(bytea, uuid, integer) OWNER TO iam_staff_owner;
ALTER FUNCTION core.cfg_content_cmd_save_draft(bytea, uuid, text, text, jsonb, uuid) OWNER TO iam_staff_owner;
ALTER FUNCTION core.cfg_content_cmd_publish(bytea, uuid, text, text, integer) OWNER TO iam_staff_owner;
ALTER FUNCTION core.cfg_content_cmd_rollback(bytea, uuid, text, text, integer) OWNER TO iam_staff_owner;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
