-- 0158 — TRP : photos guidées de l'état du véhicule, horodatage serveur et empreintes (bêta).
-- US-303 ; 19 US-303 (« Given 19 photos sur 20 (compteur manquant), When l'hôte ou le voyageur
-- valide, Then PHOTO_TEMPLATE_INCOMPLETE » ; « Given une photo reçue, When on recalcule
-- l'empreinte du fichier stocké, Then elle égale celle enregistrée » ; « Given une photo importée
-- de la galerie, When elle est envoyée, Then refus : capture dans l'application seulement ») ;
-- 16 TRP-004 (gabarit d'au moins 15 extérieures et 8 intérieures, carburant et compteur, DE CHAQUE
-- CÔTÉ ; la série de l'un ne remplace pas celle de l'autre ; heure serveur ; SHA-256 à la
-- réception ; `PHOTO_TEMPLATE_INCOMPLETE`, `PHOTO_GALLERY_FORBIDDEN`) ; 08 BR-PICKUP-03,
-- BR-RETURN-01, BR-DAMAGE-02 ; 17 §3.2.10 (`trip_inspection`, `inspection_photo`), §3.2.13
-- (`file_asset`), §3.1.3 points 1 et 6 (fichiers de preuve chiffrés par la clé du sujet, verrou
-- objet du seul bucket PRIVATE_EVIDENCE), §7.2 (`photo_max_kb`, `photo_max_px`,
-- `clock_skew_flag_h`) ; ADR-179 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-179, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - gabarit d'angles = liste FERMÉE et VERSIONNÉE (`trip_ops_photo_slot`, classe C, jamais modifiée :
--     une nouvelle version = de nouvelles lignes) ; version 1 : EXT_01 à EXT_15, INT_01 à INT_08,
--     FUEL et ODOMETER obligatoires (25 photos) ; KEY et DAMAGE_01 à DAMAGE_10 facultatives, hors
--     du minimum (17 §3.2.10) ; commun aux pays (aucune constante de pays) ;
--   - une série par côté (`trip_ops_inspection`, UNIQUE (trip, kind, rôle)) : l'hôte (titulaire du
--     compte d'hôte du trip) et le voyageur du trip, chacun la sienne ; la partie est celle de la
--     SESSION (empreinte du jeton), jugée ici, jamais un identifiant reçu ; toute autre personne,
--     trip inconnu : NOT_FOUND (même réponse, 17 §2.3 point 5) ; co-hôte : suite (US-315) ;
--   - fenêtre : départ (CHECKIN) quand le trip est CHECKIN_OPEN ; retour (CHECKOUT) quand il est
--     IN_PROGRESS ou OVERDUE ; sinon INSPECTION_NOT_OPEN ; série validée (SUBMITTED) : plus aucune
--     photo (INSPECTION_SUBMITTED). Le passage du trip à IN_PROGRESS reste à US-315 ;
--   - capture dans l'application seulement : chaque photo consomme un JETON DE CAPTURE émis par la
--     base au déclenchement de la caméra (`trip_ops_photo_capture` : un angle, la personne de la
--     session, 120 s, usage unique) ; sans jeton valide de cette personne, de cette série et de cet
--     angle ⇒ PHOTO_GALLERY_FORBIDDEN, rien n'est écrit. Limite assumée (16 TRP-004 : « l'empreinte
--     prouve l'intégrité depuis la réception, pas l'absence de retouche avant l'envoi ») : un client
--     modifié peut présenter un jeton frais avec une autre image ; le jeton prouve le parcours de
--     l'application et l'heure, pas le capteur ;
--   - heure SERVEUR (`platform.now()`) : jeton, réception (`received_at` = `file_asset.server_received_at`),
--     validation ; l'heure de l'appareil est gardée à titre indicatif, écart > `clock_skew_flag_h`
--     signalé (paramètre absent ou mal formé ⇒ signalé, fail-closed) ;
--   - fichier : ligne `file_asset` écrite par la commande (bucket PRIVATE_EVIDENCE, C2, source
--     IN_APP_CAMERA, chiffré par la clé USER de la personne qui photographie, rétention
--     TRIP_INSPECTION), empreinte SHA-256 des octets REÇUS calculée par l'API ; le dépôt de l'objet
--     (création seule, verrou objet du stockage réel) suit dans la MÊME transaction ;
--   - bornes : type réel JPEG ou WebP (contrôlé par l'API sur les octets, revérifié ici sur le type
--     déclaré), taille ≤ `photo_max_kb` du pays (absent ⇒ PARAM_MISSING), au plus 100 photos par
--     série (reprises comprises ; PHOTO_LIMIT_REACHED) ; une reprise ajoute une photo, la dernière
--     de l'angle compte, les précédentes restent (preuve, jamais effacée) ;
--   - validation : gabarit complet de la version de la série, sinon PHOTO_TEMPLATE_INCOMPLETE avec
--     la liste des angles manquants ; idempotente (ALREADY_SUBMITTED) ;
--   - concurrence : l'ajout et la validation verrouillent la série (FOR UPDATE), le jeton est
--     verrouillé avant d'être consommé : deux envois du même jeton ⇒ un seul passe ;
--   - aucune donnée personnelle en clair : identifiants, empreintes, angles, heures (C1) ; le contenu
--     (C2) est dans le stockage, chiffré ; aucun interrupteur lu ni écrit ; aucune constante de pays.
--
-- Expand / contract : tables, fonctions, droits et politiques AJOUTÉS ; aucune colonne existante
-- modifiée.
--
-- Retour arrière (base sans série) :
--   DROP FUNCTION core.trip_cmd_submit_inspection(bytea, uuid, text),
--     core.trip_cmd_add_inspection_photo(bytea, uuid, text, uuid, text, uuid, text, bigint, bytea,
--       timestamptz),
--     core.trip_photo_capture_check(bytea, uuid, text, uuid, text),
--     core.trip_cmd_open_photo_capture(bytea, uuid, text, text),
--     core.trip_inspection_view(bytea, uuid, text), core.trip_inspection_party(bytea, uuid, text),
--     core.trip_inspection_guard() ;
--   DROP TABLE core.trip_ops_inspection_photo, core.trip_ops_photo_capture, core.trip_ops_inspection,
--     core.trip_ops_photo_slot ;
--   DROP POLICY cmd_hold_inspection_file_ins ON core.audit_file_asset ;
--   DROP POLICY cmd_hold_inspection_param_read ON core.config_param_value ;
--   REVOKE INSERT (...) ON core.audit_file_asset FROM cmd_hold_owner.

-- 1. Gabarit d'angles (classe C, liste fermée versionnée) ---------------------------------------
CREATE TABLE core.trip_ops_photo_slot (
  template_version smallint NOT NULL
    CONSTRAINT trip_photo_slot_version_positive CHECK (template_version >= 1),
  slot_code        text     NOT NULL
    CONSTRAINT trip_photo_slot_code_format
      CHECK (slot_code ~ '^(EXT_[0-9]{2}|INT_[0-9]{2}|FUEL|ODOMETER|KEY|DAMAGE_[0-9]{2})$'),
  slot_group       text     NOT NULL
    CONSTRAINT trip_photo_slot_group_valid
      CHECK (slot_group IN ('EXTERIOR', 'INTERIOR', 'FUEL', 'ODOMETER', 'KEY', 'DAMAGE')),
  required         boolean  NOT NULL,
  position         smallint NOT NULL
    CONSTRAINT trip_photo_slot_position_range CHECK (position BETWEEN 1 AND 99),
  CONSTRAINT trip_photo_slot_pkey PRIMARY KEY (template_version, slot_code),
  CONSTRAINT trip_photo_slot_position_unique UNIQUE (template_version, position)
);
COMMENT ON TABLE core.trip_ops_photo_slot IS
  'TRP : gabarit d''angles des photos d''état du véhicule (16 TRP-004, 17 §3.2.10), liste fermée '
  'versionnée, commune aux pays ; version 1 : 15 extérieures, 8 intérieures, carburant et compteur '
  'obligatoires ; clés et dommages facultatifs. Classe C, jamais modifiée. US-303 (ADR-179).';

INSERT INTO core.trip_ops_photo_slot (template_version, slot_code, slot_group, required, position)
SELECT 1, pg_catalog.format('EXT_%s', pg_catalog.lpad(n::text, 2, '0')), 'EXTERIOR', true, n
  FROM pg_catalog.generate_series(1, 15) AS n
UNION ALL
SELECT 1, pg_catalog.format('INT_%s', pg_catalog.lpad(n::text, 2, '0')), 'INTERIOR', true, 15 + n
  FROM pg_catalog.generate_series(1, 8) AS n
UNION ALL SELECT 1, 'FUEL', 'FUEL', true, 24
UNION ALL SELECT 1, 'ODOMETER', 'ODOMETER', true, 25
UNION ALL SELECT 1, 'KEY', 'KEY', false, 26
UNION ALL
SELECT 1, pg_catalog.format('DAMAGE_%s', pg_catalog.lpad(n::text, 2, '0')), 'DAMAGE', false, 26 + n
  FROM pg_catalog.generate_series(1, 10) AS n;

-- 2. Séries (17 §3.2.10 `trip_inspection`, classe B : jamais supprimées) -----------------------
CREATE TABLE core.trip_ops_inspection (
  id               uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT trip_inspection_pkey PRIMARY KEY,
  trip_id          uuid        NOT NULL REFERENCES core.booking_trip (id),
  country_code     text        NOT NULL
    CONSTRAINT trip_inspection_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  kind             text        NOT NULL
    CONSTRAINT trip_inspection_kind_valid CHECK (kind IN ('CHECKIN', 'CHECKOUT')),
  -- CO_HOST (compté côté hôte) arrive avec US-315
  performer_role   text        NOT NULL
    CONSTRAINT trip_inspection_role_valid CHECK (performer_role IN ('HOST', 'GUEST')),
  performed_by     uuid        NOT NULL REFERENCES core.iam_user_account (id),
  template_version smallint    NOT NULL,
  -- VALIDATED (les deux séries, passage IN_PROGRESS) arrive avec US-315
  status           text        NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT trip_inspection_status_valid CHECK (status IN ('DRAFT', 'SUBMITTED')),
  created_at       timestamptz NOT NULL DEFAULT platform.now(),
  submitted_at     timestamptz,
  CONSTRAINT trip_inspection_one_per_side UNIQUE (trip_id, kind, performer_role),
  CONSTRAINT trip_inspection_submitted_coherent
    CHECK ((status = 'SUBMITTED') = (submitted_at IS NOT NULL))
);
COMMENT ON TABLE core.trip_ops_inspection IS
  'TRP trip_inspection (17 §3.2.10) : série de photos d''un côté (hôte ou voyageur) au départ ou au '
  'retour ; DRAFT puis SUBMITTED (gabarit complet, heure serveur). Écrite par les commandes '
  'core.trip_cmd_* seulement. US-303 (ADR-179).';

-- 2.1 Jetons de capture (capture dans l'application seulement, 16 TRP-004)
CREATE TABLE core.trip_ops_photo_capture (
  id            uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT trip_photo_capture_pkey PRIMARY KEY,
  inspection_id uuid        NOT NULL REFERENCES core.trip_ops_inspection (id),
  slot_code     text        NOT NULL,
  issued_to     uuid        NOT NULL REFERENCES core.iam_user_account (id),
  issued_at     timestamptz NOT NULL DEFAULT platform.now(),
  expires_at    timestamptz NOT NULL,
  used_at       timestamptz,
  CONSTRAINT trip_photo_capture_expiry CHECK (expires_at > issued_at),
  CONSTRAINT trip_photo_capture_used CHECK (used_at IS NULL OR used_at >= issued_at)
);
CREATE INDEX trip_photo_capture_inspection_idx ON core.trip_ops_photo_capture (inspection_id);
COMMENT ON TABLE core.trip_ops_photo_capture IS
  'TRP : jeton de capture émis par la base au déclenchement de la caméra (un angle, une personne, '
  '120 s, usage unique) ; une photo sans jeton valide est refusée (PHOTO_GALLERY_FORBIDDEN). '
  'US-303 (ADR-179).';

-- 2.2 Photos (17 §3.2.10 `inspection_photo`, classe B : jamais supprimées ni modifiées)
CREATE TABLE core.trip_ops_inspection_photo (
  inspection_id      uuid        NOT NULL REFERENCES core.trip_ops_inspection (id),
  slot_code          text        NOT NULL,
  file_id            uuid        NOT NULL REFERENCES core.audit_file_asset (id),
  taken_by_role      text        NOT NULL
    CONSTRAINT trip_inspection_photo_role_valid CHECK (taken_by_role IN ('HOST', 'GUEST')),
  capture_id         uuid        NOT NULL REFERENCES core.trip_ops_photo_capture (id),
  -- copie de file_asset.sha256 et .bytes (lecture des parties sans droit sur file_asset)
  sha256             bytea       NOT NULL
    CONSTRAINT trip_inspection_photo_sha256_size CHECK (pg_catalog.octet_length(sha256) = 32),
  bytes              bigint      NOT NULL
    CONSTRAINT trip_inspection_photo_bytes_positive CHECK (bytes > 0),
  received_at        timestamptz NOT NULL DEFAULT platform.now(),
  device_captured_at timestamptz,
  clock_skew_flag    boolean     NOT NULL,
  CONSTRAINT trip_inspection_photo_pkey PRIMARY KEY (inspection_id, slot_code, file_id),
  CONSTRAINT trip_inspection_photo_file_unique UNIQUE (file_id),
  CONSTRAINT trip_inspection_photo_capture_unique UNIQUE (capture_id)
);
COMMENT ON TABLE core.trip_ops_inspection_photo IS
  'TRP inspection_photo (17 §3.2.10) : photo d''un angle d''une série, fichier file_asset '
  '(PRIVATE_EVIDENCE, C2 chiffré par la clé de la personne), empreinte des octets reçus, heure '
  'serveur ; une reprise ajoute une ligne (la dernière de l''angle compte). US-303 (ADR-179).';

-- 2.3 Gardes : gabarit et photos immuables ; série : seulement DRAFT → SUBMITTED ; jeton :
-- seulement sa consommation. Jamais de DELETE ni de TRUNCATE.
CREATE FUNCTION core.trip_inspection_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- tests imbriqués : un champ n'est lu que sur la table qui le porte
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'trip_ops_inspection' THEN
    IF OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' AND NEW.submitted_at IS NOT NULL
       AND NEW.id = OLD.id AND NEW.trip_id = OLD.trip_id AND NEW.country_code = OLD.country_code
       AND NEW.kind = OLD.kind AND NEW.performer_role = OLD.performer_role
       AND NEW.performed_by = OLD.performed_by AND NEW.template_version = OLD.template_version
       AND NEW.created_at = OLD.created_at THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'trip_ops_photo_capture' THEN
    IF OLD.used_at IS NULL AND NEW.used_at IS NOT NULL
       AND NEW.id = OLD.id AND NEW.inspection_id = OLD.inspection_id
       AND NEW.slot_code = OLD.slot_code AND NEW.issued_to = OLD.issued_to
       AND NEW.issued_at = OLD.issued_at AND NEW.expires_at = OLD.expires_at THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'trip inspection: % refused on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_inspection_immutable';
END
$fn$;
COMMENT ON FUNCTION core.trip_inspection_guard() IS
  'Trigger : gabarit et photos immuables ; série DRAFT → SUBMITTED seulement ; jeton consommé une '
  'fois ; jamais de DELETE ni de TRUNCATE. US-303 (ADR-179).';
REVOKE ALL ON FUNCTION core.trip_inspection_guard() FROM PUBLIC;

CREATE TRIGGER trip_inspection_immutable BEFORE UPDATE OR DELETE ON core.trip_ops_photo_slot
  FOR EACH ROW EXECUTE FUNCTION core.trip_inspection_guard();
CREATE TRIGGER trip_inspection_immutable BEFORE UPDATE OR DELETE ON core.trip_ops_inspection
  FOR EACH ROW EXECUTE FUNCTION core.trip_inspection_guard();
CREATE TRIGGER trip_inspection_immutable BEFORE UPDATE OR DELETE ON core.trip_ops_photo_capture
  FOR EACH ROW EXECUTE FUNCTION core.trip_inspection_guard();
CREATE TRIGGER trip_inspection_immutable BEFORE UPDATE OR DELETE ON core.trip_ops_inspection_photo
  FOR EACH ROW EXECUTE FUNCTION core.trip_inspection_guard();
CREATE TRIGGER trip_inspection_no_truncate BEFORE TRUNCATE ON core.trip_ops_photo_slot
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_inspection_immutable');
CREATE TRIGGER trip_inspection_no_truncate BEFORE TRUNCATE ON core.trip_ops_inspection
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_inspection_immutable');
CREATE TRIGGER trip_inspection_no_truncate BEFORE TRUNCATE ON core.trip_ops_photo_capture
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_inspection_immutable');
CREATE TRIGGER trip_inspection_no_truncate BEFORE TRUNCATE ON core.trip_ops_inspection_photo
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('trip_inspection_immutable');

-- 3. RLS : aucun droit applicatif ; commandes sous cmd_hold_owner ------------------------------
ALTER TABLE core.trip_ops_photo_slot ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_photo_slot FORCE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_inspection ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_inspection FORCE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_photo_capture ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_photo_capture FORCE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_inspection_photo ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.trip_ops_inspection_photo FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.trip_ops_photo_slot TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.trip_ops_inspection TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.trip_ops_photo_capture TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.trip_ops_inspection_photo TO migrator USING (true)
  WITH CHECK (true);
REVOKE ALL ON core.trip_ops_photo_slot, core.trip_ops_inspection, core.trip_ops_photo_capture,
  core.trip_ops_inspection_photo FROM PUBLIC;

GRANT SELECT ON core.trip_ops_photo_slot TO cmd_hold_owner;
CREATE POLICY cmd_hold_inspection_sel ON core.trip_ops_photo_slot FOR SELECT TO cmd_hold_owner
  USING (true);
GRANT SELECT, INSERT ON core.trip_ops_inspection, core.trip_ops_photo_capture,
  core.trip_ops_inspection_photo TO cmd_hold_owner;
GRANT UPDATE (status, submitted_at) ON core.trip_ops_inspection TO cmd_hold_owner;
GRANT UPDATE (used_at) ON core.trip_ops_photo_capture TO cmd_hold_owner;
CREATE POLICY cmd_hold_inspection_sel ON core.trip_ops_inspection FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_inspection_ins ON core.trip_ops_inspection FOR INSERT TO cmd_hold_owner
  WITH CHECK (status = 'DRAFT' AND submitted_at IS NULL);
-- USING (true) : SELECT … FOR UPDATE applique aussi la condition USING de la politique UPDATE ; une
-- série validée doit rester verrouillable et lisible (ALREADY_SUBMITTED). La transition elle-même
-- (DRAFT → SUBMITTED seulement) est imposée par le déclencheur trip_inspection_immutable.
CREATE POLICY cmd_hold_inspection_upd ON core.trip_ops_inspection FOR UPDATE TO cmd_hold_owner
  USING (true) WITH CHECK (status = 'SUBMITTED');
CREATE POLICY cmd_hold_inspection_sel ON core.trip_ops_photo_capture FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_inspection_ins ON core.trip_ops_photo_capture FOR INSERT TO cmd_hold_owner
  WITH CHECK (used_at IS NULL);
-- même raison : un jeton consommé reste verrouillable (le rejeu est refusé par la commande) ; la
-- seule écriture admise (used_at posé une fois) est imposée par le déclencheur
CREATE POLICY cmd_hold_inspection_upd ON core.trip_ops_photo_capture FOR UPDATE TO cmd_hold_owner
  USING (true) WITH CHECK (used_at IS NOT NULL);
CREATE POLICY cmd_hold_inspection_sel ON core.trip_ops_inspection_photo FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_inspection_ins ON core.trip_ops_inspection_photo FOR INSERT TO cmd_hold_owner
  WITH CHECK (true);

-- Fichier d'une photo : PRIVATE_EVIDENCE, C2, capture dans l'application, chiffré par la clé USER
-- de la personne qui photographie ; jamais une lecture ni une mise à jour.
GRANT INSERT (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id, source,
              device_captured_at, classification, retention_class, enc_subject_type, enc_subject_id)
  ON core.audit_file_asset TO cmd_hold_owner;
CREATE POLICY cmd_hold_inspection_file_ins ON core.audit_file_asset FOR INSERT TO cmd_hold_owner
  WITH CHECK (bucket = 'PRIVATE_EVIDENCE' AND classification = 'C2' AND source = 'IN_APP_CAMERA'
              AND retention_class = 'TRIP_INSPECTION' AND enc_subject_type = 'USER'
              AND enc_subject_id IS NOT NULL AND enc_subject_id = uploader_user_id
              AND mime IN ('image/jpeg', 'image/webp'));

-- Bornes du pays (17 §7.2) : taille et côté maximaux, écart d'horloge signalé
CREATE POLICY cmd_hold_inspection_param_read ON core.config_param_value FOR SELECT
  TO cmd_hold_owner USING (key IN ('photo_max_kb', 'photo_max_px', 'clock_skew_flag_h'));

-- 4. Fonctions (cmd_hold_owner) -----------------------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 4.1 Partie de la session sur un trip (SECURITY INVOKER, interne) : HOST (titulaire du compte
-- d'hôte du trip) ou GUEST (voyageur du trip) ; aucune ligne pour toute autre personne. `open` :
-- fenêtre de la série demandée (CHECKIN : CHECKIN_OPEN ; CHECKOUT : IN_PROGRESS, OVERDUE).
CREATE FUNCTION core.trip_inspection_party(p_token_hash bytea, p_trip_id uuid, p_kind text)
  RETURNS TABLE (user_id uuid, role text, trip_id uuid, country_code text, open boolean)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  t      record;
BEGIN
  IF p_token_hash IS NULL OR p_trip_id IS NULL OR p_kind IS NULL
     OR p_kind NOT IN ('CHECKIN', 'CHECKOUT') THEN
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  SELECT tr.id, tr.guest_user_id, tr.country_code, tr.status, o.holder_user_id INTO t
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
   WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v_user,
         CASE WHEN v_user = t.guest_user_id THEN 'GUEST' ELSE 'HOST' END,
         t.id, t.country_code,
         CASE p_kind WHEN 'CHECKIN' THEN t.status = 'CHECKIN_OPEN'
                     ELSE t.status IN ('IN_PROGRESS', 'OVERDUE') END
   WHERE v_user = t.guest_user_id OR v_user = t.holder_user_id;
END
$fn$;
COMMENT ON FUNCTION core.trip_inspection_party(bytea, uuid, text) IS
  'Interne : partie de la session sur un trip (HOST titulaire du compte d''hôte, GUEST voyageur) et '
  'fenêtre de la série ; rien pour toute autre personne. US-303 (ADR-179).';
REVOKE ALL ON FUNCTION core.trip_inspection_party(bytea, uuid, text) FROM PUBLIC;

-- 4.2 Lecture d'une série par une partie du trip : gabarit, bornes du pays, les DEUX côtés
-- (chaque partie voit les séries de SON trip ; la dernière photo de chaque angle, son empreinte et
-- son heure de réception). NOT_FOUND à toute autre personne, trip inconnu, type inconnu.
CREATE FUNCTION core.trip_inspection_view(p_token_hash bytea, p_trip_id uuid, p_kind text)
  RETURNS jsonb
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  p        record;
  v_sides  jsonb;
  v_slots  jsonb;
BEGIN
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, p_kind);
  IF p.user_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_FOUND');
  END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'code', s.slot_code, 'group', s.slot_group, 'required', s.required)
           ORDER BY s.position)
    INTO v_slots
    FROM core.trip_ops_photo_slot AS s
   WHERE s.template_version = COALESCE(
           (SELECT i.template_version FROM core.trip_ops_inspection AS i
             WHERE i.trip_id = p.trip_id AND i.kind = p_kind AND i.performer_role = p.role),
           (SELECT pg_catalog.max(x.template_version) FROM core.trip_ops_photo_slot AS x));
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'role', r.role,
           'status', COALESCE(i.status, 'NONE'),
           'submittedAt', i.submitted_at,
           'photos', COALESCE((
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'slot', l.slot_code, 'fileId', l.file_id,
                      'sha256', pg_catalog.encode(l.sha256, 'hex'), 'bytes', l.bytes,
                      'receivedAt', l.received_at, 'clockSkew', l.clock_skew_flag)
                      ORDER BY l.slot_code)
               FROM (SELECT DISTINCT ON (ph.slot_code) ph.slot_code, ph.file_id, ph.sha256,
                            ph.bytes, ph.received_at, ph.clock_skew_flag
                       FROM core.trip_ops_inspection_photo AS ph
                      WHERE ph.inspection_id = i.id
                      ORDER BY ph.slot_code, ph.received_at DESC, ph.file_id DESC) AS l),
             '[]'::jsonb))
           ORDER BY r.role DESC)
    INTO v_sides
    FROM (VALUES ('HOST'), ('GUEST')) AS r(role)
    LEFT JOIN core.trip_ops_inspection AS i
      ON i.trip_id = p.trip_id AND i.kind = p_kind AND i.performer_role = r.role;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'OK',
    'viewerRole', p.role,
    'kind', p_kind,
    'country', p.country_code,
    -- fuseau du pays du trip : l'écran affiche l'heure serveur dans le fuseau du trip
    'timezone', (SELECT tr.timezone FROM core.booking_trip AS tr WHERE tr.id = p.trip_id),
    'open', p.open,
    'maxKb', core.booking_param_int('photo_max_kb', p.country_code),
    'maxPx', core.booking_param_int('photo_max_px', p.country_code),
    'slots', COALESCE(v_slots, '[]'::jsonb),
    'sides', v_sides);
END
$fn$;
COMMENT ON FUNCTION core.trip_inspection_view(bytea, uuid, text) IS
  'Série de photos d''un trip vue par une partie (gabarit, bornes du pays, les deux côtés, dernière '
  'photo de chaque angle) ; NOT_FOUND à toute autre personne. SECURITY DEFINER, EXECUTE app_api. '
  'US-303 (ADR-179).';

-- 4.3 Jeton de capture d'un angle (déclenchement de la caméra) : crée au besoin la série DRAFT de
-- la partie. Issues : DONE (jeton, échéance), NOT_FOUND, REQUEST_INVALID (angle hors gabarit),
-- INSPECTION_NOT_OPEN, INSPECTION_SUBMITTED, PHOTO_LIMIT_REACHED.
CREATE FUNCTION core.trip_cmd_open_photo_capture(p_token_hash bytea, p_trip_id uuid, p_kind text,
                                                 p_slot text)
  RETURNS TABLE (outcome text, capture_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p        record;
  v_insp   record;
  v_ver    smallint;
  v_id     uuid;
  v_exp    timestamptz;
BEGIN
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, p_kind);
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF NOT p.open THEN
    RETURN QUERY SELECT 'INSPECTION_NOT_OPEN'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT i.id, i.status, i.template_version INTO v_insp
    FROM core.trip_ops_inspection AS i
   WHERE i.trip_id = p.trip_id AND i.kind = p_kind AND i.performer_role = p.role
   FOR UPDATE;
  IF v_insp.id IS NULL THEN
    SELECT pg_catalog.max(x.template_version) INTO v_ver FROM core.trip_ops_photo_slot AS x;
  ELSE
    v_ver := v_insp.template_version;
  END IF;
  IF p_slot IS NULL OR NOT EXISTS (SELECT 1 FROM core.trip_ops_photo_slot AS s
                                     WHERE s.template_version = v_ver AND s.slot_code = p_slot) THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_insp.id IS NULL THEN
    INSERT INTO core.trip_ops_inspection (trip_id, country_code, kind, performer_role, performed_by,
                                      template_version)
    VALUES (p.trip_id, p.country_code, p_kind, p.role, p.user_id, v_ver)
    ON CONFLICT ON CONSTRAINT trip_inspection_one_per_side DO NOTHING;
    SELECT i.id, i.status, i.template_version INTO v_insp
      FROM core.trip_ops_inspection AS i
     WHERE i.trip_id = p.trip_id AND i.kind = p_kind AND i.performer_role = p.role
     FOR UPDATE;
  END IF;
  IF v_insp.status IS DISTINCT FROM 'DRAFT' THEN
    RETURN QUERY SELECT 'INSPECTION_SUBMITTED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.trip_ops_inspection_photo AS ph
       WHERE ph.inspection_id = v_insp.id) >= 100 THEN
    RETURN QUERY SELECT 'PHOTO_LIMIT_REACHED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  v_exp := platform.now() + interval '120 seconds';
  INSERT INTO core.trip_ops_photo_capture (inspection_id, slot_code, issued_to, expires_at)
  VALUES (v_insp.id, p_slot, p.user_id, v_exp)
  RETURNING id INTO v_id;
  RETURN QUERY SELECT 'DONE'::text, v_id, v_exp;
END
$fn$;
COMMENT ON FUNCTION core.trip_cmd_open_photo_capture(bytea, uuid, text, text) IS
  'Jeton de capture d''un angle (120 s, usage unique) pour la partie de la session ; crée sa série '
  'DRAFT au besoin. SECURITY DEFINER, EXECUTE app_api. US-303 (ADR-179).';

-- 4.4 Jeton présenté par un envoi (lecture seule, avant l'antivirus) : OK et les bornes du pays
-- (`photo_max_kb`, `photo_max_px` ; NULL si absentes), ou le refus que
-- la commande d'ajout rendrait (NOT_FOUND, INSPECTION_NOT_OPEN, INSPECTION_SUBMITTED,
-- PHOTO_GALLERY_FORBIDDEN). N'écrit rien.
CREATE FUNCTION core.trip_photo_capture_check(p_token_hash bytea, p_trip_id uuid, p_kind text,
                                              p_capture_id uuid, p_slot text)
  RETURNS TABLE (outcome text, max_kb integer, max_px integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p   record;
  c   record;
BEGIN
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, p_kind);
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  IF NOT p.open THEN
    RETURN QUERY SELECT 'INSPECTION_NOT_OPEN'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  SELECT pc.id, pc.slot_code, pc.issued_to, pc.expires_at, pc.used_at, i.status, i.trip_id,
         i.kind, i.performer_role
    INTO c
    FROM core.trip_ops_photo_capture AS pc
    JOIN core.trip_ops_inspection AS i ON i.id = pc.inspection_id
   WHERE pc.id = p_capture_id;
  IF c.id IS NULL OR c.trip_id <> p.trip_id OR c.kind <> p_kind OR c.performer_role <> p.role
     OR c.issued_to <> p.user_id OR p_slot IS NULL OR c.slot_code <> p_slot
     OR c.used_at IS NOT NULL OR c.expires_at <= platform.now() THEN
    RETURN QUERY SELECT 'PHOTO_GALLERY_FORBIDDEN'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  IF c.status <> 'DRAFT' THEN
    RETURN QUERY SELECT 'INSPECTION_SUBMITTED'::text, NULL::integer, NULL::integer;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, core.booking_param_int('photo_max_kb', p.country_code),
                      core.booking_param_int('photo_max_px', p.country_code);
END
$fn$;
COMMENT ON FUNCTION core.trip_photo_capture_check(bytea, uuid, text, uuid, text) IS
  'Jeton de capture présenté par un envoi, jugé avant l''antivirus (n''écrit rien). SECURITY '
  'DEFINER, EXECUTE app_api. US-303 (ADR-179).';

-- 4.5 Photo d'un angle : jeton consommé, ligne file_asset (PRIVATE_EVIDENCE, C2, clé USER de la
-- personne, créée par l'API dans la même transaction) et photo de la série. L'API a contrôlé le
-- type réel, les dimensions et l'antivirus, et calculé l'empreinte des octets reçus ; le dépôt
-- de l'objet suit dans la même transaction. Issues : DONE (clé de stockage, heure de réception),
-- NOT_FOUND, INSPECTION_NOT_OPEN, INSPECTION_SUBMITTED, PHOTO_GALLERY_FORBIDDEN (jeton absent,
-- d'une autre personne, série ou angle, expiré ou déjà consommé), PHOTO_INVALID (type, taille,
-- empreinte), PHOTO_LIMIT_REACHED, PARAM_MISSING (`photo_max_kb` absent ou mal formé).
CREATE FUNCTION core.trip_cmd_add_inspection_photo(p_token_hash bytea, p_trip_id uuid, p_kind text,
                                                   p_capture_id uuid, p_slot text, p_file_id uuid,
                                                   p_mime text, p_bytes bigint, p_sha256 bytea,
                                                   p_device_captured_at timestamptz)
  RETURNS TABLE (outcome text, storage_key text, received_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p      record;
  i      record;
  c      record;
  v_kb   integer;
  v_skew integer;
  v_now  timestamptz := platform.now();
  v_key  text;
BEGIN
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, p_kind);
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF NOT p.open THEN
    RETURN QUERY SELECT 'INSPECTION_NOT_OPEN'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  -- la série d'abord (ordre commun avec la validation), puis le jeton
  SELECT x.id, x.status INTO i
    FROM core.trip_ops_inspection AS x
   WHERE x.trip_id = p.trip_id AND x.kind = p_kind AND x.performer_role = p.role
   FOR UPDATE;
  SELECT pc.id, pc.inspection_id, pc.slot_code, pc.issued_to, pc.expires_at, pc.used_at INTO c
    FROM core.trip_ops_photo_capture AS pc
   WHERE pc.id = p_capture_id
   FOR UPDATE;
  IF i.id IS NULL OR c.id IS NULL OR c.inspection_id <> i.id OR c.issued_to <> p.user_id
     OR p_slot IS NULL OR c.slot_code <> p_slot OR c.used_at IS NOT NULL
     OR c.expires_at <= v_now THEN
    RETURN QUERY SELECT 'PHOTO_GALLERY_FORBIDDEN'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF i.status <> 'DRAFT' THEN
    RETURN QUERY SELECT 'INSPECTION_SUBMITTED'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  v_kb := core.booking_param_int('photo_max_kb', p.country_code);
  IF v_kb IS NULL OR v_kb < 1 THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_file_id IS NULL OR p_mime IS NULL OR p_mime NOT IN ('image/jpeg', 'image/webp')
     OR p_bytes IS NULL OR p_bytes < 1 OR p_bytes > v_kb::bigint * 1000
     OR p_sha256 IS NULL OR pg_catalog.octet_length(p_sha256) <> 32 THEN
    RETURN QUERY SELECT 'PHOTO_INVALID'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF (SELECT pg_catalog.count(*) FROM core.trip_ops_inspection_photo AS ph
       WHERE ph.inspection_id = i.id) >= 100 THEN
    RETURN QUERY SELECT 'PHOTO_LIMIT_REACHED'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  v_skew := core.booking_param_int('clock_skew_flag_h', p.country_code);
  v_key := pg_catalog.format('trips/%s/inspections/%s/%s', p.trip_id, i.id, p_file_id);
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id,
                                     source, device_captured_at, classification, retention_class,
                                     enc_subject_type, enc_subject_id)
  VALUES (p_file_id, 'PRIVATE_EVIDENCE', v_key, p_mime, p_bytes, p_sha256, p.user_id,
          'IN_APP_CAMERA', p_device_captured_at, 'C2', 'TRIP_INSPECTION', 'USER', p.user_id);
  UPDATE core.trip_ops_photo_capture AS pc SET used_at = v_now WHERE pc.id = c.id;
  INSERT INTO core.trip_ops_inspection_photo (inspection_id, slot_code, file_id, taken_by_role,
                                          capture_id, sha256, bytes, received_at,
                                          device_captured_at, clock_skew_flag)
  VALUES (i.id, p_slot, p_file_id, p.role, c.id, p_sha256, p_bytes, v_now, p_device_captured_at,
          -- paramètre absent ou mal formé, heure de l'appareil absente : signalé (fail-closed)
          v_skew IS NULL OR p_device_captured_at IS NULL
            OR pg_catalog.abs(EXTRACT(EPOCH FROM (v_now - p_device_captured_at)))
               > v_skew::numeric * 3600);
  RETURN QUERY SELECT 'DONE'::text, v_key, v_now;
END
$fn$;
COMMENT ON FUNCTION core.trip_cmd_add_inspection_photo(bytea, uuid, text, uuid, text, uuid, text, bigint, bytea, timestamptz) IS
  'Photo d''un angle : jeton de capture consommé, file_asset PRIVATE_EVIDENCE C2 (clé USER de la '
  'personne) et photo de la série, heure serveur. SECURITY DEFINER, EXECUTE app_api. '
  'US-303 (ADR-179).';

-- 4.6 Validation de sa série par la partie : gabarit complet de la version de la série, sinon
-- PHOTO_TEMPLATE_INCOMPLETE et les angles obligatoires manquants (série absente : tous). Issues :
-- DONE, ALREADY_SUBMITTED (heure d'origine), NOT_FOUND, INSPECTION_NOT_OPEN,
-- PHOTO_TEMPLATE_INCOMPLETE.
CREATE FUNCTION core.trip_cmd_submit_inspection(p_token_hash bytea, p_trip_id uuid, p_kind text)
  RETURNS TABLE (outcome text, submitted_at timestamptz, missing text[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p         record;
  i         record;
  v_missing text[];
  v_ver     smallint;
  v_now     timestamptz := platform.now();
BEGIN
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, p_kind);
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::timestamptz, '{}'::text[];
    RETURN;
  END IF;
  SELECT x.id, x.status, x.submitted_at, x.template_version INTO i
    FROM core.trip_ops_inspection AS x
   WHERE x.trip_id = p.trip_id AND x.kind = p_kind AND x.performer_role = p.role
   FOR UPDATE;
  IF i.id IS NOT NULL AND i.status = 'SUBMITTED' THEN
    RETURN QUERY SELECT 'ALREADY_SUBMITTED'::text, i.submitted_at, '{}'::text[];
    RETURN;
  END IF;
  IF NOT p.open THEN
    RETURN QUERY SELECT 'INSPECTION_NOT_OPEN'::text, NULL::timestamptz, '{}'::text[];
    RETURN;
  END IF;
  v_ver := COALESCE(i.template_version,
                    (SELECT pg_catalog.max(x.template_version) FROM core.trip_ops_photo_slot AS x));
  SELECT COALESCE(pg_catalog.array_agg(s.slot_code ORDER BY s.position), '{}'::text[])
    INTO v_missing
    FROM core.trip_ops_photo_slot AS s
   WHERE s.template_version = v_ver AND s.required
     AND NOT EXISTS (SELECT 1 FROM core.trip_ops_inspection_photo AS ph
                      WHERE ph.inspection_id = i.id AND ph.slot_code = s.slot_code);
  IF i.id IS NULL OR pg_catalog.cardinality(v_missing) > 0 THEN
    RETURN QUERY SELECT 'PHOTO_TEMPLATE_INCOMPLETE'::text, NULL::timestamptz, v_missing;
    RETURN;
  END IF;
  UPDATE core.trip_ops_inspection AS x SET status = 'SUBMITTED', submitted_at = v_now
   WHERE x.id = i.id;
  RETURN QUERY SELECT 'DONE'::text, v_now, '{}'::text[];
END
$fn$;
COMMENT ON FUNCTION core.trip_cmd_submit_inspection(bytea, uuid, text) IS
  'Validation de sa série par la partie de la session : gabarit complet (sinon '
  'PHOTO_TEMPLATE_INCOMPLETE et les angles manquants), heure serveur ; idempotente. SECURITY '
  'DEFINER, EXECUTE app_api. US-303 (ADR-179).';

REVOKE ALL ON FUNCTION core.trip_inspection_party(bytea, uuid, text),
  core.trip_inspection_view(bytea, uuid, text),
  core.trip_cmd_open_photo_capture(bytea, uuid, text, text),
  core.trip_photo_capture_check(bytea, uuid, text, uuid, text),
  core.trip_cmd_add_inspection_photo(bytea, uuid, text, uuid, text, uuid, text, bigint, bytea,
                                     timestamptz),
  core.trip_cmd_submit_inspection(bytea, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.trip_inspection_view(bytea, uuid, text),
  core.trip_cmd_open_photo_capture(bytea, uuid, text, text),
  core.trip_photo_capture_check(bytea, uuid, text, uuid, text),
  core.trip_cmd_add_inspection_photo(bytea, uuid, text, uuid, text, uuid, text, bigint, bytea,
                                     timestamptz),
  core.trip_cmd_submit_inspection(bytea, uuid, text) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
