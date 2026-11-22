-- 0176 — TRP : empreinte de photo d'état unique, tous trips, photos d'annonce comprises (bêta).
-- US-303 (suite des correctifs de la red team du lot 3, US-313) ; constats F-L3-PRE-01 (élevé :
-- aucune garde d'empreinte déjà vue, une seule photo remplit les 25 angles du gabarit) et
-- F-L3-PRE-02 (élevé : l'original EXIF / GPS stocké et archivé ; correctif côté API, ci-dessous) ;
-- pré-mortem du lot 3, L3-PM-03 (« refus d'une empreinte SHA-256 déjà enregistrée, tous trips,
-- photos d'annonce comprises ») et L3-PM-06 ; 16 TRP-004 ; 19 US-303 critère 2 ; 17 §3.2.10
-- (`inspection_photo`), §3.2.13 (`file_asset`) ; ADR-179 (photos guidées), ADR-196 (cette
-- migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-196, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - l'empreinte reçue par la commande est celle de la COPIE NETTOYÉE (EXIF dont GPS, XMP, IPTC,
--     commentaires retirés par `preparePhoto`, liste blanche d'AUD) : l'API la calcule, la scelle et
--     la stocke (F-L3-PRE-02). Elle ne change pas quand on modifie un octet de métadonnée : la
--     garde ne se contourne pas en retouchant l'EXIF. L'empreinte de l'ORIGINAL (envoyée par
--     l'appareil) ne sert qu'au contrôle de transport, dans l'API, et n'est jamais enregistrée ;
--   - une empreinte déjà enregistrée pour une photo d'état (tout trip, toute série, toute partie,
--     même angle compris : une reprise doit être une NOUVELLE prise) ou pour une photo d'annonce
--     (bucket PUBLIC_LISTING, même retirée ou refusée) ⇒ PHOTO_DUPLICATE, RIEN n'est écrit (ni
--     `file_asset`, ni photo ; le jeton de capture n'est PAS consommé : l'angle se reprend) ;
--   - garantie EN BASE, pas seulement dans l'API : index UNIQUE `trip_inspection_photo_sha256_unique`
--     sur `trip_ops_inspection_photo (sha256)`. Deux envois simultanés du même fichier (deux trips,
--     deux connexions, aucun verrou commun) : le second attend la transaction du premier sur l'index
--     unique ; premier validé ⇒ violation d'unicité rattrapée par la commande (bloc d'exception :
--     ses écritures annulées au point de sauvegarde) ⇒ PHOTO_DUPLICATE ; premier annulé ⇒ le second
--     passe. Une même série : le verrou de la série (FOR UPDATE, 0158) les sérialise, la lecture
--     préalable voit la première ;
--   - photos d'annonce : lecture préalable seulement (index partiel `file_asset_listing_sha256_idx`) :
--     une annonce publiée avant la photo d'état est vue ; aucune course utile (la photo d'annonce
--     est publique, servie avant tout trip). cmd_hold_owner lit `bucket` et `sha256` des seules
--     lignes PUBLIC_LISTING (C0, contenu publié volontairement ; colonnes déjà accordées par 0164),
--     jamais le contenu ;
--   - limite assumée (16 TRP-004 : « l'empreinte prouve l'intégrité depuis la réception, pas
--     l'absence de retouche ») : l'égalité d'octets ne reconnaît pas une image RÉENCODÉE ou dont un
--     pixel a changé ; une empreinte perceptuelle demande une bibliothèque d'image absente de la pile
--     (ADR-099) : suite au BOARD (ADR-196) ;
--   - aucune donnée personnelle en clair, aucun interrupteur lu ni écrit, aucune constante de pays.
--
-- Existant : la bêta n'est servie nulle part (aucune photo d'état en production) ; les graines du
-- test des migrations sur base peuplée (l0-us046) n'écrivent aucune photo d'état ; les preuves
-- posent des octets aléatoires, une photo par octets. Si des doublons existaient, CREATE UNIQUE
-- INDEX échouerait et la migration serait refusée (fail-closed, aucun doublon effacé ni masqué) :
-- l'ops les trie avant de rejouer. Aucune étape expand / contract n'est donc nécessaire.
--
-- Expand / contract : deux index, une politique de lecture AJOUTÉS ; la commande d'ajout est
-- remplacée à signature, propriétaire et droits identiques (une issue de plus : PHOTO_DUPLICATE).
-- Rien de retiré.
--
-- Retour arrière (avant toute photo dont l'unicité compte) :
--   DROP INDEX core.trip_inspection_photo_sha256_unique, core.file_asset_listing_sha256_idx ;
--   DROP POLICY cmd_hold_inspection_listing_sha_sel ON core.audit_file_asset ;
--   corps de core.trip_cmd_add_inspection_photo de 0158 rétabli (CREATE OR REPLACE).

-- 1. Garantie d'unicité en base -----------------------------------------------------------------
CREATE UNIQUE INDEX trip_inspection_photo_sha256_unique
  ON core.trip_ops_inspection_photo (sha256);
COMMENT ON INDEX core.trip_inspection_photo_sha256_unique IS
  'TRP : une empreinte (SHA-256 de la copie nettoyée) ne sert qu''une photo d''état, tous trips '
  'confondus (F-L3-PRE-01, L3-PM-03). US-303 (ADR-196).';

CREATE INDEX file_asset_listing_sha256_idx
  ON core.audit_file_asset (sha256)
  WHERE bucket = 'PUBLIC_LISTING';
COMMENT ON INDEX core.file_asset_listing_sha256_idx IS
  'AUD : recherche d''une empreinte de photo d''annonce par la commande d''ajout d''une photo '
  'd''état (PHOTO_DUPLICATE). US-303 (ADR-196).';

-- 2. Lecture des empreintes des photos d'annonce (C0, publiques) par cmd_hold_owner -------------
-- colonnes déjà accordées par 0164 (id, bucket, storage_key, mime, bytes, sha256, enc_*) ; la
-- politique ajoute les seules lignes PUBLIC_LISTING ; jamais une écriture.
CREATE POLICY cmd_hold_inspection_listing_sha_sel ON core.audit_file_asset FOR SELECT
  TO cmd_hold_owner USING (bucket = 'PUBLIC_LISTING');

-- 3. Commande d'ajout (cmd_hold_owner) ----------------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- Photo d'un angle : jeton consommé, ligne file_asset (PRIVATE_EVIDENCE, C2, clé USER de la
-- personne, créée par l'API dans la même transaction) et photo de la série. L'API a contrôlé le
-- type réel, les dimensions et l'antivirus, retiré les métadonnées et calculé l'empreinte de la
-- COPIE NETTOYÉE (celle qui est scellée et stockée) ; le dépôt de l'objet suit dans la même
-- transaction. Issues : DONE (clé de stockage, heure de réception), NOT_FOUND, INSPECTION_NOT_OPEN,
-- INSPECTION_SUBMITTED, PHOTO_GALLERY_FORBIDDEN (jeton absent, d'une autre personne, série ou
-- angle, expiré ou déjà consommé), PHOTO_INVALID (type, taille, empreinte), PHOTO_LIMIT_REACHED,
-- PHOTO_DUPLICATE (empreinte déjà enregistrée : photo d'état de tout trip, photo d'annonce ; rien
-- n'est écrit, le jeton reste utilisable), PARAM_MISSING (`photo_max_kb` absent ou mal formé).
CREATE OR REPLACE FUNCTION core.trip_cmd_add_inspection_photo(p_token_hash bytea, p_trip_id uuid,
                                                              p_kind text, p_capture_id uuid,
                                                              p_slot text, p_file_id uuid,
                                                              p_mime text, p_bytes bigint,
                                                              p_sha256 bytea,
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
  v_cons text;
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
  -- empreinte déjà vue (F-L3-PRE-01) : photo d'état de tout trip, ou photo d'annonce
  IF EXISTS (SELECT 1 FROM core.trip_ops_inspection_photo AS ph WHERE ph.sha256 = p_sha256)
     OR EXISTS (SELECT 1 FROM core.audit_file_asset AS f
                 WHERE f.bucket = 'PUBLIC_LISTING' AND f.sha256 = p_sha256) THEN
    RETURN QUERY SELECT 'PHOTO_DUPLICATE'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  v_skew := core.booking_param_int('clock_skew_flag_h', p.country_code);
  v_key := pg_catalog.format('trips/%s/inspections/%s/%s', p.trip_id, i.id, p_file_id);
  -- écritures sous point de sauvegarde : un envoi concurrent du même fichier, validé pendant
  -- l'attente sur l'index unique, annule les trois écritures et rend PHOTO_DUPLICATE
  BEGIN
    INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256,
                                       uploader_user_id, source, device_captured_at,
                                       classification, retention_class, enc_subject_type,
                                       enc_subject_id)
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
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
    IF v_cons = 'trip_inspection_photo_sha256_unique' THEN
      RETURN QUERY SELECT 'PHOTO_DUPLICATE'::text, NULL::text, NULL::timestamptz;
      RETURN;
    END IF;
    RAISE;
  END;
  RETURN QUERY SELECT 'DONE'::text, v_key, v_now;
END
$fn$;
COMMENT ON FUNCTION core.trip_cmd_add_inspection_photo(bytea, uuid, text, uuid, text, uuid, text, bigint, bytea, timestamptz) IS
  'Photo d''un angle : jeton de capture consommé, file_asset PRIVATE_EVIDENCE C2 (clé USER de la '
  'personne) et photo de la série, heure serveur ; empreinte de la copie nettoyée déjà vue (photo '
  'd''état de tout trip, photo d''annonce) : PHOTO_DUPLICATE, rien n''est écrit. SECURITY '
  'DEFINER, EXECUTE app_api. US-303 (ADR-179, ADR-196).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
