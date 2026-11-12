-- 0077 — CAT : documents et éligibilité du véhicule (titre, prenda, plaque, châssis, inspection, âge), contestation de plaque.
-- US-124 ; 19 US-124 ; 16 HST-019 (éligibilité), HST-039 (documents) ; 08 BR-LIST-01, BR-LIST-02,
-- BR-LIST-03 ; 17 §2.4 (« titulaire du véhicule = titulaire du compte d'hôte, ou accord écrit »),
-- §3.2.3 (`vehicle.eligibility_status`, `lien_declared`), §3.1.3 point 1 (fichier C2 chiffré par
-- la clé de son sujet), §5 (antivirus), §7.2 (`vehicle_financed_requires_lender_consent`) ; 22
-- OQ-P2P-02, OQ-BR-28, OQ-CAT-01 (g) ; ADR-097 (files de revue), ADR-099, ADR-104 ; ADR-107 (cette
-- migration) ; BOARD N-37 (nom affiché au voyageur), N-61 (plaque ou VIN pris par un autre hôte) ;
-- pré-mortem L1-PM-11, L1-PM-14, L1-PM-15, L1-PM-41 à L1-PM-43. Appliquée sous `migrator`, en une
-- transaction.
--
-- Principes (ADR-107, PROPOSÉ) :
--   - pièces du véhicule (`catalog_vehicle_document`, 16 HST-039) : TITLE, OWNER_AUTHORIZATION
--     (autorisation notariée du propriétaire), PLATE_VIN_PHOTO, INSPECTION (revisado PA,
--     inspección técnica PY), LENDER_CONSENT (consentement écrit du créancier), COMPULSORY_INSURANCE ;
--     fichier `file_asset` du seau privé DOCUMENTS, C2, chiffré par la clé USER de l'hôte, écrit par
--     la commande AVANT le dépôt et APRÈS l'antivirus (application, fail-closed) ; une nouvelle
--     pièce d'un type remplace la précédente (SUPERSEDED) ; jamais supprimée ;
--   - déclarations de l'hôte (`title_holder` HOST ou THIRD_PARTY, prenda, compteur) ;
--   - règles automatiques (16 HST-019 « âge, km, rapprochement ») à la SOUMISSION DU VÉHICULE à la
--     revue (`catalog_cmd_submit_vehicle_eligibility`) : véhicule hors catalogue
--     (CATALOG_ADDITION_PENDING, OQ-CAT-01 g), âge au-delà de `elig_age_years_ceiling` du pays
--     (VEHICLE_TOO_OLD), compteur égal ou supérieur à `elig_odometer_km_ceiling`
--     (VEHICLE_MILEAGE_TOO_HIGH, 08 BR-LIST-02 « < 200 000 km »),
--     titre d'un tiers sans autorisation notariée (VEHICLE_TITLE_MISMATCH, motif « titre »),
--     véhicule financé sans consentement du créancier quand `vehicle_financed_requires_lender_consent`
--     vaut true ou manque (VEHICLE_LENDER_CONSENT_REQUIRED, fail-closed), pièce exigée par le pays
--     absente (`elig_doc_*`, absente ⇒ exigée : VEHICLE_DOCUMENT_REQUIRED) ; refus journalisé
--     (ligne `catalog_vehicle_eligibility_check`), rien d'autre n'est écrit ;
--   - revue de l'ops (file LISTING de 0064, sujet VEHICLE, permission `ops.review_listing_host`) sur
--     une liste de contrôle FERMÉE, chaque point coché PASS ou FAIL (aucune case « tout vérifié »,
--     L1-PM-14) et un verdict par pièce soumise ; le résultat est CALCULÉ par la base : ELIGIBLE
--     seulement si tout passe et que les pièces exigées sont VALID et non expirées ; plaque ou VIN
--     discordants ⇒ le véhicule reste PENDING avec ses motifs journalisés (19 US-124 critère 2) ;
--     titre interdit ou registre défavorable ⇒ INELIGIBLE ;
--   - publiable (`catalog_vehicle_publishable`, pour US-118) : ELIGIBLE, non libéré, et les règles
--     strictes encore vraies (consentement du créancier, pièces valides et non expirées) ;
--   - contestation (N-61) : un hôte dont la plaque ou le VIN est déjà pris par un AUTRE compte du
--     même pays ouvre une contestation avec son titre ; l'ops la lit, un ADMIN seul la confirme :
--     le véhicule en cause est libéré (`released_at`, INELIGIBLE, annonces vivantes
--     REMOVED_BY_PLATFORM) et sa plaque et son VIN redeviennent disponibles (contrainte d'exclusion
--     et index unique partiels, recréés sous leur nom) ;
--   - nom affiché au voyageur (N-37) : le premier mot du prénom légal du titulaire, jamais le nom
--     de famille ni le nom légal complet (`core.iam_host_public_first_name`, iam_auth_owner) ;
--   - aucun droit applicatif sur les nouvelles tables (RLS ENABLE + FORCE) ; la console lit et
--     décide par des fonctions de domaine (EXECUTE à iam_staff_owner seul), chaque lecture de
--     donnée personnelle (plaque, VIN, noms, pièce) journalisée AVANT d'être rendue.
--
-- Défauts PROPOSÉS (fail-closed, ADR-107) : âge maximal 10 ans, compteur maximal 200 000 km (08
-- BR-LIST-02 [NOUS]) ; pièces exigées : titre, photo plaque / VIN, inspection dans les deux pays,
-- assurance obligatoire (SOBAT) au Panama seulement (16 HST-039) ; motifs fermés ; confirmation
-- d'une contestation réservée à l'ADMIN.
--
-- Expand / contract : tables, colonnes nullables ou à défaut, fonctions, politiques et droits
-- ajoutés ; politiques `catalog_cmd_read` (config_param_definition, config_param_value,
-- support_review_queue_item) et `catalog_cmd_audit_insert` recréées sous le même nom, élargies ;
-- contrainte `catalog_vehicle_plate_unique` recréée sous le même nom en contrainte d'EXCLUSION
-- partielle (véhicules non libérés) et index `catalog_vehicle_vin_unique` recréé sous le même nom,
-- partiel : même garantie tant qu'aucun véhicule n'est libéré ; corps de
-- `core.catalog_cmd_create_vehicle` (0074) remplacé à signature, propriétaire et droits identiques
-- (doublon compté parmi les véhicules non libérés ; violation d'exclusion traduite comme l'unicité).
--
-- Retour arrière :
--   réappliquer core.catalog_cmd_create_vehicle de 0074 ; recréer catalog_vehicle_plate_unique en
--     UNIQUE (country_code, plate) et catalog_vehicle_vin_unique sans released_at (aucun véhicule
--     libéré) ; recréer les politiques catalog_cmd_read et catalog_cmd_audit_insert de 0067 / 0074 ;
--   DROP FUNCTION des fonctions créées ci-dessous ; DROP TABLE core.catalog_vehicle_claim,
--     core.catalog_vehicle_eligibility_check, core.catalog_vehicle_document ;
--   ALTER TABLE core.catalog_vehicle DROP COLUMN title_holder, eligibility_reasons,
--     eligibility_submitted_at, eligibility_checked_at, released_at ;
--   DROP POLICY catalog_cmd_doc_insert ON core.audit_file_asset ; révoquer les droits accordés.

-- 1. Véhicule : déclarations, état de la revue, libération (N-61) --------------------------------
ALTER TABLE core.catalog_vehicle
  ADD COLUMN title_holder text
    CONSTRAINT catalog_vehicle_title_holder_valid CHECK (title_holder IN ('HOST', 'THIRD_PARTY')),
  ADD COLUMN eligibility_reasons text[] NOT NULL DEFAULT '{}'
    CONSTRAINT catalog_vehicle_eligibility_reasons_format
    CHECK (pg_catalog.array_to_string(eligibility_reasons, ',') ~ '^([A-Z][A-Z_]{1,63}(,|$))*$'),
  ADD COLUMN eligibility_submitted_at timestamptz,
  ADD COLUMN eligibility_checked_at timestamptz,
  ADD COLUMN released_at timestamptz;
COMMENT ON COLUMN core.catalog_vehicle.title_holder IS
  'Titulaire du titre déclaré par l''hôte : HOST, ou THIRD_PARTY (autorisation notariée exigée). US-124.';
COMMENT ON COLUMN core.catalog_vehicle.released_at IS
  'Libération après une contestation confirmée par un ADMIN (N-61) : plaque et VIN disponibles. US-124.';

-- plaque unique PAR PAYS et VIN unique PARTOUT parmi les véhicules non libérés (recréés sous leur
-- nom ; aucun véhicule n'est libéré avant cette migration : garantie identique)
ALTER TABLE core.catalog_vehicle DROP CONSTRAINT catalog_vehicle_plate_unique;
ALTER TABLE core.catalog_vehicle ADD CONSTRAINT catalog_vehicle_plate_unique
  EXCLUDE USING btree (country_code WITH =, plate WITH =) WHERE (released_at IS NULL);
DROP INDEX core.catalog_vehicle_vin_unique;
CREATE UNIQUE INDEX catalog_vehicle_vin_unique ON core.catalog_vehicle (vin)
  WHERE vin IS NOT NULL AND released_at IS NULL;

GRANT UPDATE (title_holder, lien_declared, odometer_km, eligibility_status, eligibility_reasons,
              eligibility_submitted_at, eligibility_checked_at, released_at)
  ON core.catalog_vehicle TO catalog_cmd_owner;

-- 2. Tables ---------------------------------------------------------------------------------------
-- 2.1 Pièce du véhicule (16 HST-039 vehicle_document ; classe D, jamais supprimée).
CREATE TABLE core.catalog_vehicle_document (
  id            uuid        PRIMARY KEY,
  vehicle_id    uuid        NOT NULL,
  org_id        uuid        NOT NULL,
  country_code  text        NOT NULL
                CONSTRAINT catalog_vehicle_document_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  doc_type      text        NOT NULL
                CONSTRAINT catalog_vehicle_document_type_valid CHECK (doc_type IN
                  ('TITLE', 'OWNER_AUTHORIZATION', 'PLATE_VIN_PHOTO', 'INSPECTION',
                   'LENDER_CONSENT', 'COMPULSORY_INSURANCE')),
  -- fichier du seau privé DOCUMENTS (C2, clé de l'hôte) ; id de la pièce = id du fichier
  file_id       uuid        NOT NULL CONSTRAINT catalog_vehicle_document_file_unique UNIQUE
                REFERENCES core.audit_file_asset (id),
  mime          text        NOT NULL
                CONSTRAINT catalog_vehicle_document_mime_valid
                CHECK (mime IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')),
  bytes         bigint      NOT NULL
                CONSTRAINT catalog_vehicle_document_bytes_range CHECK (bytes BETWEEN 1 AND 10485760),
  status        text        NOT NULL DEFAULT 'SUBMITTED'
                CONSTRAINT catalog_vehicle_document_status_valid
                CHECK (status IN ('SUBMITTED', 'VALID', 'REJECTED', 'SUPERSEDED')),
  -- fin de validité déclarée par l'hôte, confirmée ou corrigée par l'ops
  valid_until   date
                CONSTRAINT catalog_vehicle_document_valid_until_range
                CHECK (valid_until BETWEEN DATE '1950-01-01' AND DATE '2100-12-31'),
  reject_reason text
                CONSTRAINT catalog_vehicle_document_reject_reason_valid
                CHECK (reject_reason IN ('ILLEGIBLE', 'EXPIRED', 'MISMATCH', 'WRONG_DOCUMENT',
                                         'SUSPECTED_FORGERY')),
  uploaded_by   uuid        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT platform.now(),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  CONSTRAINT catalog_vehicle_document_vehicle_fk FOREIGN KEY (vehicle_id, org_id, country_code)
    REFERENCES core.catalog_vehicle (id, org_id, country_code),
  CONSTRAINT catalog_vehicle_document_rejected CHECK ((status = 'REJECTED') = (reject_reason IS NOT NULL)),
  CONSTRAINT catalog_vehicle_document_reviewed CHECK ((reviewed_by IS NULL) = (reviewed_at IS NULL))
);
-- une pièce vivante (SUBMITTED ou VALID) par véhicule et par type
CREATE UNIQUE INDEX catalog_vehicle_document_live_unique ON core.catalog_vehicle_document
  (vehicle_id, doc_type) WHERE status IN ('SUBMITTED', 'VALID');
CREATE INDEX catalog_vehicle_document_org_idx ON core.catalog_vehicle_document (org_id);
COMMENT ON TABLE core.catalog_vehicle_document IS
  'CAT vehicle_document (16 HST-039) : pièce du véhicule (titre, autorisation notariée, plaque et '
  'VIN, inspection, consentement du créancier, assurance obligatoire) ; fichier privé C2 chiffré par '
  'la clé de l''hôte, analysé avant dépôt ; jamais supprimée. US-124 (ADR-107).';

-- 2.2 Contrôle d'éligibilité (16 HST-019 eligibility_check(by, at, result) ; ajout seul).
CREATE TABLE core.catalog_vehicle_eligibility_check (
  id             uuid        PRIMARY KEY,
  vehicle_id     uuid        NOT NULL,
  org_id         uuid        NOT NULL,
  country_code   text        NOT NULL
                 CONSTRAINT catalog_vehicle_check_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  kind           text        NOT NULL
                 CONSTRAINT catalog_vehicle_check_kind_valid
                 CHECK (kind IN ('AUTO_SUBMISSION', 'OPS_REVIEW', 'CLAIM_RELEASE')),
  result         text        NOT NULL
                 CONSTRAINT catalog_vehicle_check_result_valid
                 CHECK (result IN ('SUBMITTED', 'REFUSED', 'ELIGIBLE', 'PENDING', 'INELIGIBLE')),
  reasons        text[]      NOT NULL DEFAULT '{}'
                 CONSTRAINT catalog_vehicle_check_reasons_format
                 CHECK (pg_catalog.array_to_string(reasons, ',') ~ '^([A-Z][A-Z_]{1,63}(,|$))*$'),
  -- liste de contrôle de l'ops (clés fermées, PASS / FAIL ; registre : NOT_CONSULTABLE admis)
  checklist      jsonb,
  actor_user_id  uuid        NOT NULL,
  actor_role     text        NOT NULL
                 CONSTRAINT catalog_vehicle_check_role_valid
                 CHECK (actor_role IN ('P2P_HOST', 'OPS_AGENT', 'ADMIN')),
  review_item_id uuid        REFERENCES core.support_review_queue_item (id),
  created_at     timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT catalog_vehicle_check_vehicle_fk FOREIGN KEY (vehicle_id, org_id, country_code)
    REFERENCES core.catalog_vehicle (id, org_id, country_code),
  CONSTRAINT catalog_vehicle_check_checklist CHECK ((kind = 'OPS_REVIEW') = (checklist IS NOT NULL))
);
CREATE INDEX catalog_vehicle_check_vehicle_idx ON core.catalog_vehicle_eligibility_check
  (vehicle_id, created_at);
CREATE TRIGGER catalog_vehicle_check_append_only
  BEFORE UPDATE OR DELETE ON core.catalog_vehicle_eligibility_check
  FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete();
CREATE TRIGGER catalog_vehicle_check_no_truncate
  BEFORE TRUNCATE ON core.catalog_vehicle_eligibility_check
  FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete();
COMMENT ON TABLE core.catalog_vehicle_eligibility_check IS
  'CAT eligibility_check (16 HST-019) : chaque soumission, refus automatique, revue de l''ops et '
  'libération, avec motifs (codes seulement, jamais la plaque ni le VIN) ; ajout seul. US-124.';

-- 2.3 Contestation d'une plaque ou d'un VIN (N-61 ; classe D).
CREATE TABLE core.catalog_vehicle_claim (
  id                uuid        PRIMARY KEY,
  org_id            uuid        NOT NULL,
  country_code      text        NOT NULL
                    CONSTRAINT catalog_vehicle_claim_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  claimant_user_id  uuid        NOT NULL REFERENCES core.iam_user_account (id),
  plate             text        NOT NULL                                          -- [C2]
                    CONSTRAINT catalog_vehicle_claim_plate_normalized CHECK (plate ~ '^[A-Z0-9]{2,12}$'),
  vin               text                                                        -- [C2]
                    CONSTRAINT catalog_vehicle_claim_vin_format CHECK (vin ~ '^[A-Z0-9]{5,17}$'),
  target_vehicle_id uuid        NOT NULL REFERENCES core.catalog_vehicle (id),
  title_file_id     uuid        NOT NULL CONSTRAINT catalog_vehicle_claim_file_unique UNIQUE
                    REFERENCES core.audit_file_asset (id),
  mime              text        NOT NULL
                    CONSTRAINT catalog_vehicle_claim_mime_valid
                    CHECK (mime IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')),
  bytes             bigint      NOT NULL
                    CONSTRAINT catalog_vehicle_claim_bytes_range CHECK (bytes BETWEEN 1 AND 10485760),
  status            text        NOT NULL DEFAULT 'OPEN'
                    CONSTRAINT catalog_vehicle_claim_status_valid
                    CHECK (status IN ('OPEN', 'UPHELD', 'DISMISSED')),
  dismiss_reason    text
                    CONSTRAINT catalog_vehicle_claim_dismiss_reason_valid
                    CHECK (dismiss_reason IN ('INSUFFICIENT_PROOF', 'CLAIMANT_NOT_OWNER')),
  review_item_id    uuid        REFERENCES core.support_review_queue_item (id),
  decided_by        uuid,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT catalog_vehicle_claim_org_fk FOREIGN KEY (org_id, country_code)
    REFERENCES core.iam_organization (id, country_code),
  CONSTRAINT catalog_vehicle_claim_decided CHECK (
    (status = 'OPEN') = (decided_by IS NULL) AND (decided_by IS NULL) = (decided_at IS NULL)),
  CONSTRAINT catalog_vehicle_claim_dismissed CHECK ((status = 'DISMISSED') = (dismiss_reason IS NOT NULL))
);
-- une contestation ouverte par compte et par véhicule en cause
CREATE UNIQUE INDEX catalog_vehicle_claim_open_unique ON core.catalog_vehicle_claim
  (org_id, target_vehicle_id) WHERE status = 'OPEN';
CREATE INDEX catalog_vehicle_claim_target_idx ON core.catalog_vehicle_claim (target_vehicle_id);
COMMENT ON TABLE core.catalog_vehicle_claim IS
  'CAT vehicle_claim (BOARD N-61) : contestation d''une plaque ou d''un VIN déjà enregistrés par un '
  'autre compte du pays, avec le titre du demandeur (fichier privé C2) ; confirmée par un ADMIN, '
  'elle libère le véhicule en cause. Jamais supprimée. US-124 (ADR-107).';

CREATE TRIGGER catalog_vehicle_document_no_delete
  BEFORE DELETE ON core.catalog_vehicle_document
  FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete();
CREATE TRIGGER catalog_vehicle_document_no_truncate
  BEFORE TRUNCATE ON core.catalog_vehicle_document
  FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete();
CREATE TRIGGER catalog_vehicle_claim_no_delete
  BEFORE DELETE ON core.catalog_vehicle_claim
  FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete();
CREATE TRIGGER catalog_vehicle_claim_no_truncate
  BEFORE TRUNCATE ON core.catalog_vehicle_claim
  FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete();

-- 3. RLS : ENABLE + FORCE, migrator_all ; aucun droit applicatif --------------------------------
ALTER TABLE core.catalog_vehicle_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_vehicle_document FORCE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_vehicle_eligibility_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_vehicle_eligibility_check FORCE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_vehicle_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_vehicle_claim FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.catalog_vehicle_document TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.catalog_vehicle_eligibility_check TO migrator
  USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.catalog_vehicle_claim TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.catalog_vehicle_document, core.catalog_vehicle_eligibility_check,
  core.catalog_vehicle_claim FROM PUBLIC;

GRANT SELECT, INSERT ON core.catalog_vehicle_document TO catalog_cmd_owner;
GRANT UPDATE (status, valid_until, reject_reason, reviewed_by, reviewed_at)
  ON core.catalog_vehicle_document TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_all ON core.catalog_vehicle_document TO catalog_cmd_owner
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON core.catalog_vehicle_eligibility_check TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_all ON core.catalog_vehicle_eligibility_check TO catalog_cmd_owner
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON core.catalog_vehicle_claim TO catalog_cmd_owner;
GRANT UPDATE (status, dismiss_reason, decided_by, decided_at)
  ON core.catalog_vehicle_claim TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_all ON core.catalog_vehicle_claim TO catalog_cmd_owner
  USING (true) WITH CHECK (true);

-- Fichier d'une pièce : seau privé DOCUMENTS, C2, clé USER de l'hôte qui téléverse, jamais une
-- lecture ni une mise à jour (la clé est créée par le coffre de l'application, sous app_api).
GRANT INSERT (enc_subject_type, enc_subject_id) ON core.audit_file_asset TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_doc_insert ON core.audit_file_asset FOR INSERT TO catalog_cmd_owner
  WITH CHECK (bucket = 'DOCUMENTS' AND classification = 'C2' AND source = 'HOST_UPLOAD'
              AND enc_subject_type = 'USER' AND enc_subject_id IS NOT NULL
              AND enc_subject_id = uploader_user_id AND retention_class = 'VEHICLE_DOCUMENT'
              AND mime IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf'));

-- configuration : paramètres d'éligibilité du pays en plus des clés de 0067 (politique recréée
-- sous son nom, élargie)
DROP POLICY catalog_cmd_read ON core.config_param_definition;
CREATE POLICY catalog_cmd_read ON core.config_param_definition FOR SELECT TO catalog_cmd_owner
  USING (key IN ('price_display_step_minor', 'listing_min_photos', 'price_ceiling_daily_minor',
                'price_ceiling_extra_km_minor', 'p2p_private_hosts_enabled',
                'vehicle_financed_requires_lender_consent', 'elig_age_years_ceiling',
                'elig_odometer_km_ceiling', 'elig_doc_title',
                'elig_doc_plate_vin_photo', 'elig_doc_inspection',
                'elig_doc_compulsory_insurance'));
DROP POLICY catalog_cmd_read ON core.config_param_value;
CREATE POLICY catalog_cmd_read ON core.config_param_value FOR SELECT TO catalog_cmd_owner
  USING (key IN ('price_display_step_minor', 'listing_min_photos', 'price_ceiling_daily_minor',
                'price_ceiling_extra_km_minor', 'p2p_private_hosts_enabled',
                'vehicle_financed_requires_lender_consent', 'elig_age_years_ceiling',
                'elig_odometer_km_ceiling', 'elig_doc_title',
                'elig_doc_plate_vin_photo', 'elig_doc_inspection',
                'elig_doc_compulsory_insurance'));

-- journal : actions de l'hôte sur ses véhicules (politique recréée sous son nom, élargie)
DROP POLICY catalog_cmd_audit_insert ON core.audit_audit_log;
CREATE POLICY catalog_cmd_audit_insert ON core.audit_audit_log FOR INSERT TO catalog_cmd_owner
  WITH CHECK ((action_code IN ('LISTING_SUBMITTED', 'LISTING_DELETED') AND subject_type = 'LISTING')
              OR (action_code IN ('VEHICLE_DECLARATION_SAVED', 'VEHICLE_DOCUMENT_RECEIVED',
                                  'VEHICLE_ELIGIBILITY_SUBMITTED')
                  AND subject_type = 'VEHICLE')
              OR (action_code = 'VEHICLE_CLAIM_OPENED' AND subject_type = 'VEHICLE_CLAIM'));

-- files de revue : éléments de la file LISTING en plus de CATALOG_ADDITION (politique recréée)
DROP POLICY catalog_cmd_read ON core.support_review_queue_item;
CREATE POLICY catalog_cmd_read ON core.support_review_queue_item FOR SELECT TO catalog_cmd_owner
  USING (queue IN ('CATALOG_ADDITION', 'LISTING'));

-- 4. Nom affiché au voyageur (N-37) : fonction d'iam_auth_owner (seul lecteur des comptes) ------
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
SET LOCAL ROLE iam_auth_owner;
-- Premier mot du prénom LÉGAL du titulaire d'un compte d'hôte ACTIVE (« Ana » pour « Ana María
-- Pérez Gómez ») : jamais le nom de famille, jamais le nom légal complet (PROPOSÉ, comme Turo) ;
-- NULL si le compte est inconnu ou n'est pas ACTIVE, ou si la personne est pseudonymisée.
CREATE FUNCTION core.iam_host_public_first_name(p_org uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT NULLIF(pg_catalog.left(pg_catalog.split_part(pg_catalog.btrim(u.legal_first_name), ' ', 1),
                                40), '')
    FROM core.iam_organization AS o
    JOIN core.iam_user_account AS u ON u.id = o.holder_user_id
   WHERE o.id = p_org AND o.status = 'ACTIVE' AND u.pseudonymized_at IS NULL
$fn$;
COMMENT ON FUNCTION core.iam_host_public_first_name(uuid) IS
  'Nom affiché au voyageur (BOARD N-37) : premier mot du prénom légal du titulaire d''un compte '
  'd''hôte ACTIVE, jamais le nom de famille. SECURITY DEFINER, EXECUTE catalog_cmd_owner. US-124.';
REVOKE ALL ON FUNCTION core.iam_host_public_first_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_host_public_first_name(uuid) TO catalog_cmd_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;

-- 5. Aides (propriétaire migrator, SECURITY INVOKER, EXECUTE à catalog_cmd_owner) ----------------
-- Booléen du pays en vigueur ; NULL si absent ou mal formé.
CREATE FUNCTION core.catalog_param_bool(p_key text, p_country text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'boolean' THEN (v.value #>> '{}')::boolean END
    FROM core.config_param_value AS v CROSS JOIN t
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

-- Clé de stockage d'une pièce (seau DOCUMENTS) : compte, véhicule ou contestation, fichier.
CREATE FUNCTION core.catalog_document_key(p_org uuid, p_parent uuid, p_file uuid)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT 'vehicle-documents/' || p_org::text || '/' || p_parent::text || '/' || p_file::text
$fn$;

-- Pièce exigée par le pays : `elig_doc_<type>` ; absente ou mal formée ⇒ exigée
-- (fail-closed). Les autres types (autorisation, consentement) dépendent des déclarations.
CREATE FUNCTION core.catalog_document_required(p_type text, p_country text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE p_type
           WHEN 'TITLE' THEN COALESCE(core.catalog_param_bool('elig_doc_title', p_country), true)
           WHEN 'PLATE_VIN_PHOTO'
             THEN COALESCE(core.catalog_param_bool('elig_doc_plate_vin_photo', p_country), true)
           WHEN 'INSPECTION'
             THEN COALESCE(core.catalog_param_bool('elig_doc_inspection', p_country), true)
           WHEN 'COMPULSORY_INSURANCE'
             THEN COALESCE(core.catalog_param_bool('elig_doc_compulsory_insurance', p_country), true)
           ELSE false
         END
$fn$;

-- État d'une pièce d'un type pour un véhicule : OK, MISSING ou EXPIRED. Non strict (soumission) :
-- pièce SUBMITTED ou VALID ; strict (décision, publication) : VALID seulement. Une fin de
-- validité passée dans le fuseau du pays rend EXPIRED dans les deux cas.
CREATE FUNCTION core.catalog_document_state(p_vehicle uuid, p_type text, p_strict boolean,
                                            p_today date)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN d.id IS NULL THEN 'MISSING'
           WHEN p_strict AND d.status <> 'VALID' THEN 'MISSING'
           WHEN d.valid_until IS NOT NULL AND d.valid_until < p_today THEN 'EXPIRED'
           ELSE 'OK'
         END
    FROM (SELECT 1) AS one
    LEFT JOIN core.catalog_vehicle_document AS d
      ON d.vehicle_id = p_vehicle AND d.doc_type = p_type AND d.status IN ('SUBMITTED', 'VALID')
$fn$;

-- Motifs qui empêchent le véhicule d'être soumis (non strict) ou rendu éligible et publiable
-- (strict), dans l'ordre de 19 US-124 et 16 HST-019 ; tableau vide : rien n'empêche. Seuils lus
-- dans les paramètres du pays (absents : PARAM_MISSING, fail-closed) ; âge et date du jour dans le
-- fuseau du pays, sur platform.now().
CREATE FUNCTION core.catalog_vehicle_blockers(p_vehicle uuid, p_strict boolean)
  RETURNS text[]
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v        record;
  v_tz     text;
  v_today  date;
  v_age    bigint;
  v_km     bigint;
  v_lender boolean;
  v_state  text;
  v_type   text;
  r        text[] := '{}';
BEGIN
  SELECT x.id, x.country_code, x.variant_id, x.year, x.odometer_km, x.title_holder,
         x.lien_declared, x.released_at
    INTO v
    FROM core.catalog_vehicle AS x WHERE x.id = p_vehicle;
  IF v.id IS NULL THEN
    RETURN ARRAY['VEHICLE_NOT_FOUND'];
  END IF;
  IF v.released_at IS NOT NULL THEN
    RETURN ARRAY['VEHICLE_RELEASED'];
  END IF;
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = v.country_code;
  v_age := core.catalog_param_int('elig_age_years_ceiling', v.country_code);
  v_km := core.catalog_param_int('elig_odometer_km_ceiling', v.country_code);
  IF v_tz IS NULL OR v_age IS NULL OR v_age < 1 OR v_km IS NULL OR v_km < 1 THEN
    RETURN ARRAY['PARAM_MISSING'];
  END IF;
  v_today := (platform.now() AT TIME ZONE v_tz)::date;
  -- véhicule hors catalogue : jamais publiable (OQ-CAT-01 g ; US-114)
  IF v.variant_id IS NULL THEN
    r := r || 'CATALOG_ADDITION_PENDING'::text;
  END IF;
  -- âge en années civiles du pays (16 HST-019 : 11 ans refusé au seuil 10)
  IF pg_catalog.date_part('year', v_today)::bigint - v.year > v_age THEN
    r := r || 'VEHICLE_TOO_OLD'::text;
  END IF;
  IF v.odometer_km IS NULL OR v.title_holder IS NULL THEN
    r := r || 'VEHICLE_FIELD_REQUIRED'::text;
  ELSIF v.odometer_km >= v_km THEN
    -- 08 BR-LIST-02 [NOUS] « < 200 000 km » : le plafond lui-même est refusé
    r := r || 'VEHICLE_MILEAGE_TOO_HIGH'::text;
  END IF;
  -- titre d'un tiers : autorisation notariée du propriétaire (08 BR-LIST-01, OQ-P2P-02)
  IF v.title_holder = 'THIRD_PARTY'
     AND core.catalog_document_state(p_vehicle, 'OWNER_AUTHORIZATION', p_strict, v_today) <> 'OK' THEN
    r := r || 'VEHICLE_TITLE_MISMATCH'::text;
  END IF;
  -- véhicule financé : consentement écrit du créancier (OQ-BR-28) ; paramètre absent ⇒ exigé
  v_lender := COALESCE(core.catalog_param_bool('vehicle_financed_requires_lender_consent',
                                               v.country_code), true);
  IF v.lien_declared AND v_lender
     AND core.catalog_document_state(p_vehicle, 'LENDER_CONSENT', p_strict, v_today) <> 'OK' THEN
    r := r || 'VEHICLE_LENDER_CONSENT_REQUIRED'::text;
  END IF;
  -- pièces exigées par le pays
  FOREACH v_type IN ARRAY ARRAY['TITLE', 'PLATE_VIN_PHOTO', 'INSPECTION', 'COMPULSORY_INSURANCE'] LOOP
    IF core.catalog_document_required(v_type, v.country_code) THEN
      v_state := core.catalog_document_state(p_vehicle, v_type, p_strict, v_today);
      IF v_state = 'EXPIRED' AND NOT ('VEHICLE_DOCUMENT_EXPIRED' = ANY (r)) THEN
        r := r || 'VEHICLE_DOCUMENT_EXPIRED'::text;
      ELSIF v_state = 'MISSING' AND NOT ('VEHICLE_DOCUMENT_REQUIRED' = ANY (r)) THEN
        r := r || 'VEHICLE_DOCUMENT_REQUIRED'::text;
      END IF;
    END IF;
  END LOOP;
  RETURN r;
END
$fn$;

COMMENT ON FUNCTION core.catalog_param_bool(text, text) IS
  'Paramètre booléen du pays en vigueur à platform.now(), sinon NULL. US-124.';
COMMENT ON FUNCTION core.catalog_document_key(uuid, uuid, uuid) IS
  'Clé de stockage d''une pièce du véhicule ou d''une contestation (seau DOCUMENTS). US-124.';
COMMENT ON FUNCTION core.catalog_document_required(text, text) IS
  'Pièce exigée par le pays (elig_doc_*) ; absente ou mal formée : exigée. US-124.';
COMMENT ON FUNCTION core.catalog_document_state(uuid, text, boolean, date) IS
  'État d''une pièce d''un type : OK, MISSING ou EXPIRED (strict : VALID seulement). US-124.';
COMMENT ON FUNCTION core.catalog_vehicle_blockers(uuid, boolean) IS
  'Motifs qui empêchent la soumission (non strict) ou l''éligibilité et la publication (strict) '
  'd''un véhicule ; paramètres du pays, fail-closed. Sous catalog_cmd_owner. US-124 (ADR-107).';
REVOKE ALL ON FUNCTION core.catalog_param_bool(text, text),
  core.catalog_document_key(uuid, uuid, uuid), core.catalog_document_required(text, text),
  core.catalog_document_state(uuid, text, boolean, date),
  core.catalog_vehicle_blockers(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_param_bool(text, text),
  core.catalog_document_key(uuid, uuid, uuid), core.catalog_document_required(text, text),
  core.catalog_document_state(uuid, text, boolean, date),
  core.catalog_vehicle_blockers(uuid, boolean) TO catalog_cmd_owner;

-- 6. Commandes de l'hôte et fonctions de domaine (SECURITY DEFINER, catalog_cmd_owner) -----------
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

-- 6.1 Véhicule (corps de 0074 recopié ; doublon compté parmi les véhicules NON libérés, N-61 ;
-- violation de la contrainte d'exclusion traduite comme celle de l'unicité)
CREATE OR REPLACE FUNCTION core.catalog_cmd_create_vehicle(p_token_hash bytea, p_org uuid,
                                                           p_location_id uuid, p_plate text,
                                                           p_vin text, p_variant_id uuid,
                                                           p_make_text text, p_model_text text,
                                                           p_year integer, p_trim text,
                                                           p_transmission text, p_seats smallint,
                                                           p_fuel_type text, p_odometer_km integer,
                                                           p_gps_installed boolean,
                                                           p_lien_declared boolean)
  RETURNS TABLE (outcome text, vehicle_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h       record;
  v_loc   record;
  v_var   record;
  v_class text;
  v_plate text := core.catalog_normalize_plate(p_plate);
  v_vin   text := core.catalog_normalize_vin(p_vin);
  v_id    uuid := pg_catalog.gen_random_uuid();
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- champs obligatoires et formats (16 HST-011 VEHICLE_FIELD_REQUIRED)
  IF v_plate IS NULL OR v_plate !~ '^[A-Z0-9]{2,12}$'
     OR (p_vin IS NOT NULL AND (v_vin IS NULL OR v_vin !~ '^[A-Z0-9]{5,17}$'))
     OR p_year IS NULL OR p_year NOT BETWEEN 1950 AND 2100
     OR (v_vin IS NOT NULL AND v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' AND p_year >= 1981)
     OR p_transmission IS NULL OR p_transmission NOT IN ('MANUAL', 'AUTOMATIC')
     OR p_seats IS NULL OR p_seats NOT BETWEEN 1 AND 60
     OR p_fuel_type IS NULL OR p_fuel_type NOT IN ('GASOLINE', 'DIESEL', 'HYBRID', 'EV')
     OR (p_odometer_km IS NOT NULL AND p_odometer_km NOT BETWEEN 0 AND 3000000)
     OR (p_trim IS NOT NULL AND (pg_catalog.btrim(p_trim) = '' OR pg_catalog.char_length(p_trim) > 80))
     OR (p_variant_id IS NULL AND (p_make_text IS NULL OR pg_catalog.btrim(p_make_text) = ''
                                   OR pg_catalog.char_length(p_make_text) > 80
                                   OR p_model_text IS NULL OR pg_catalog.btrim(p_model_text) = ''
                                   OR pg_catalog.char_length(p_model_text) > 80))
     OR (p_variant_id IS NOT NULL AND (p_make_text IS NOT NULL OR p_model_text IS NOT NULL)) THEN
    RETURN QUERY SELECT 'VEHICLE_FIELD_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- lieu de remise du MÊME compte (un lieu d'un autre compte : même réponse qu'inconnu)
  SELECT l.id, l.timezone INTO v_loc
    FROM core.catalog_location AS l
   WHERE l.id = p_location_id AND l.org_id = p_org AND l.country_code = h.country_code;
  IF v_loc.id IS NULL THEN
    RETURN QUERY SELECT 'LOCATION_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  -- variante : ACTIVE (elle, son modèle, sa marque), du marché du pays, produite l'année dite
  IF p_variant_id IS NOT NULL THEN
    SELECT v.id, v.status AS v_status, o.status AS o_status, m.status AS m_status, v.market,
           v.year_from, v.year_to, v.value_class
      INTO v_var
      FROM core.catalog_vehicle_variant AS v
      JOIN core.catalog_vehicle_model AS o ON o.id = v.model_id
      JOIN core.catalog_vehicle_make AS m ON m.id = o.make_id
     WHERE v.id = p_variant_id;
    IF v_var.id IS NULL OR v_var.v_status = 'PENDING_REVIEW' OR v_var.o_status = 'PENDING_REVIEW'
       OR v_var.m_status = 'PENDING_REVIEW'
       OR (v_var.market IS NOT NULL AND v_var.market::text <> h.country_code) THEN
      RETURN QUERY SELECT 'CATALOG_VARIANT_NOT_FOUND'::text, NULL::uuid;
      RETURN;
    END IF;
    IF v_var.v_status = 'RETIRED' OR v_var.o_status = 'RETIRED' OR v_var.m_status = 'RETIRED' THEN
      RETURN QUERY SELECT 'CATALOG_VARIANT_RETIRED'::text, NULL::uuid;
      RETURN;
    END IF;
    IF p_year < v_var.year_from OR (v_var.year_to IS NOT NULL AND p_year > v_var.year_to) THEN
      RETURN QUERY SELECT 'CATALOG_VARIANT_NOT_FOUND'::text, NULL::uuid;
      RETURN;
    END IF;
    v_class := v_var.value_class;
  END IF;
  -- doublons sérialisés (deux créations concurrentes de la même plaque ou du même VIN) ; la
  -- contrainte d'exclusion et l'index unique restent le filet ; un véhicule libéré (N-61) ne
  -- compte plus
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cat.plate:' || h.country_code || ':' || v_plate, 0));
  IF v_vin IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cat.vin:' || v_vin, 0));
  END IF;
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle AS x
              WHERE x.released_at IS NULL
                AND ((x.country_code = h.country_code AND x.plate = v_plate)
                     OR (v_vin IS NOT NULL AND x.vin = v_vin))) THEN
    RETURN QUERY SELECT 'VEHICLE_PLATE_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END IF;
  BEGIN
    INSERT INTO core.catalog_vehicle (id, org_id, country_code, home_location_id, timezone, plate,
                                      vin, variant_id, make_text, model_text, year, trim_override,
                                      value_class, transmission, seats, fuel_type, odometer_km,
                                      lien_declared, gps_installed, created_by)
    VALUES (v_id, p_org, h.country_code, v_loc.id, v_loc.timezone, v_plate, v_vin, p_variant_id,
            CASE WHEN p_variant_id IS NULL THEN pg_catalog.btrim(p_make_text) END,
            CASE WHEN p_variant_id IS NULL THEN pg_catalog.btrim(p_model_text) END,
            p_year, NULLIF(pg_catalog.btrim(p_trim), ''), v_class, p_transmission,
            p_seats, p_fuel_type, p_odometer_km, COALESCE(p_lien_declared, false),
            COALESCE(p_gps_installed, false), h.user_id);
  EXCEPTION WHEN unique_violation OR exclusion_violation THEN
    RETURN QUERY SELECT 'VEHICLE_PLATE_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END;
  -- hors catalogue (« Autre » de l'assistant) : demande d'ajout et élément de file (US-114)
  IF p_variant_id IS NULL THEN
    PERFORM core.catalog_addition_open(p_org, h.country_code, v_id, h.user_id, p_make_text,
                                       p_model_text, p_year, p_trim, v_vin);
  END IF;
  RETURN QUERY SELECT 'DONE'::text, v_id;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_create_vehicle(bytea, uuid, uuid, text, text, uuid, text, text, integer, text, text, smallint, text, integer, boolean, boolean) IS
  'Véhicule de l''hôte : plaque et VIN uniques parmi les véhicules non libérés, variante du marché '
  'du compte ; hors catalogue : demande d''ajout et élément de file dans la même instruction. '
  'SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099) ; US-114 (ADR-104) ; US-124 (ADR-107).';

-- Véhicule du compte de la session, verrouillé, et son état de revue. Issues : OK, AUTH_REQUIRED,
-- FORBIDDEN (compte d'un autre), HOST_ACCOUNT_SUSPENDED, VEHICLE_NOT_FOUND (véhicule d'un autre
-- compte : même réponse qu'inconnu), VEHICLE_RELEASED, VEHICLE_INELIGIBLE (décision définitive de
-- l'ops), VEHICLE_UNDER_REVIEW (soumis, revue non tranchée : rien ne change pendant la revue).
CREATE FUNCTION core.catalog_vehicle_writable(p_token_hash bytea, p_org uuid, p_vehicle uuid)
  RETURNS TABLE (outcome text, user_id uuid, country_code text, eligibility_status text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h record;
  v record;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, h.user_id, h.country_code, NULL::text;
    RETURN;
  END IF;
  SELECT x.id, x.eligibility_status, x.released_at, x.eligibility_submitted_at,
         x.eligibility_checked_at
    INTO v
    FROM core.catalog_vehicle AS x
   WHERE x.id = p_vehicle AND x.org_id = p_org AND x.country_code = h.country_code
     FOR UPDATE;
  IF v.id IS NULL THEN
    RETURN QUERY SELECT 'VEHICLE_NOT_FOUND'::text, h.user_id, h.country_code, NULL::text;
    RETURN;
  END IF;
  IF v.released_at IS NOT NULL THEN
    RETURN QUERY SELECT 'VEHICLE_RELEASED'::text, h.user_id, h.country_code, v.eligibility_status;
    RETURN;
  END IF;
  IF v.eligibility_status = 'INELIGIBLE' THEN
    RETURN QUERY SELECT 'VEHICLE_INELIGIBLE'::text, h.user_id, h.country_code, v.eligibility_status;
    RETURN;
  END IF;
  IF v.eligibility_submitted_at IS NOT NULL
     AND (v.eligibility_checked_at IS NULL OR v.eligibility_checked_at < v.eligibility_submitted_at) THEN
    RETURN QUERY SELECT 'VEHICLE_UNDER_REVIEW'::text, h.user_id, h.country_code, v.eligibility_status;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, h.user_id, h.country_code, v.eligibility_status;
END
$fn$;
COMMENT ON FUNCTION core.catalog_vehicle_writable(bytea, uuid, uuid) IS
  'Véhicule du compte de la session, verrouillé, modifiable (ni libéré, ni inéligible, ni en '
  'revue). Aide interne sous catalog_cmd_owner. US-124 (ADR-107).';
REVOKE ALL ON FUNCTION core.catalog_vehicle_writable(bytea, uuid, uuid) FROM PUBLIC;

-- 6.2 Déclarations de l'hôte (titulaire du titre, prenda, compteur). Un véhicule ELIGIBLE revient
-- PENDING : la revue doit être refaite (fail-closed). Issues : DONE, VEHICLE_FIELD_REQUIRED et
-- celles de catalog_vehicle_writable.
CREATE FUNCTION core.catalog_cmd_declare_vehicle(p_token_hash bytea, p_org uuid, p_vehicle uuid,
                                                 p_title_holder text, p_lien_declared boolean,
                                                 p_odometer_km integer)
  RETURNS TABLE (outcome text, vehicle_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  w record;
BEGIN
  SELECT * INTO w FROM core.catalog_vehicle_writable(p_token_hash, p_org, p_vehicle);
  IF w.outcome <> 'OK' THEN
    RETURN QUERY SELECT w.outcome, NULL::uuid;
    RETURN;
  END IF;
  IF p_title_holder IS NULL OR p_title_holder NOT IN ('HOST', 'THIRD_PARTY')
     OR p_lien_declared IS NULL
     OR p_odometer_km IS NULL OR p_odometer_km NOT BETWEEN 0 AND 3000000 THEN
    RETURN QUERY SELECT 'VEHICLE_FIELD_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE core.catalog_vehicle AS x
     SET title_holder = p_title_holder, lien_declared = p_lien_declared,
         odometer_km = p_odometer_km, eligibility_status = 'PENDING'
   WHERE x.id = p_vehicle;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (w.user_id, 'P2P_HOST', 'VEHICLE_DECLARATION_SAVED', 'VEHICLE', p_vehicle,
          pg_catalog.jsonb_build_object('eligibilityStatus', w.eligibility_status),
          pg_catalog.jsonb_build_object('orgId', p_org, 'country', w.country_code,
                                        'titleHolder', p_title_holder,
                                        'lienDeclared', p_lien_declared,
                                        'countries', pg_catalog.jsonb_build_array(w.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_vehicle;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_declare_vehicle(bytea, uuid, uuid, text, boolean, integer) IS
  'Déclarations de l''hôte sur son véhicule (titulaire du titre, prenda, compteur) ; un véhicule '
  'ELIGIBLE redevient PENDING. SECURITY DEFINER, EXECUTE app_api. US-124 (ADR-107).';

-- 6.3 Droit de déposer une pièce, jugé AVANT l'antivirus (L1-PM-43). Issues : OK et celles de
-- catalog_vehicle_writable. N'écrit rien.
CREATE FUNCTION core.catalog_vehicle_document_permitted(p_token_hash bytea, p_org uuid,
                                                        p_vehicle uuid)
  RETURNS TABLE (outcome text)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT w.outcome FROM core.catalog_vehicle_writable(p_token_hash, p_org, p_vehicle) AS w
$fn$;
COMMENT ON FUNCTION core.catalog_vehicle_document_permitted(bytea, uuid, uuid) IS
  'Droit de déposer une pièce sur un véhicule du compte de la session, jugé avant l''antivirus ; '
  'n''écrit rien. SECURITY DEFINER, EXECUTE app_api. US-124 (ADR-107).';

-- 6.4 Pièce : ligne file_asset (DOCUMENTS, C2, clé de l'hôte ; création seule) et pièce SUBMITTED ;
-- la pièce vivante du même type passe SUPERSEDED. L'application a contrôlé le type réel, la taille
-- et l'antivirus ; la clé USER de l'hôte existe (coffre, même transaction). Un véhicule ELIGIBLE
-- revient PENDING. Issues : DONE (pièce, clé de stockage), DUPLICATE (même fichier rejoué),
-- VEHICLE_DOCUMENT_INVALID (type, format, taille, date) et celles de catalog_vehicle_writable.
CREATE FUNCTION core.catalog_cmd_add_vehicle_document(p_token_hash bytea, p_org uuid,
                                                      p_vehicle uuid, p_file_id uuid,
                                                      p_doc_type text, p_mime text,
                                                      p_bytes bigint, p_sha256 bytea,
                                                      p_valid_until date)
  RETURNS TABLE (outcome text, document_id uuid, storage_key text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  w     record;
  v_key text;
BEGIN
  SELECT * INTO w FROM core.catalog_vehicle_writable(p_token_hash, p_org, p_vehicle);
  IF w.outcome <> 'OK' THEN
    RETURN QUERY SELECT w.outcome, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_file_id IS NOT NULL AND EXISTS (SELECT 1 FROM core.catalog_vehicle_document AS d
                                        WHERE d.file_id = p_file_id AND d.vehicle_id = p_vehicle) THEN
    -- rejeu du même dépôt (même requête) : rien n'est réécrit
    RETURN QUERY SELECT 'DUPLICATE'::text, p_file_id,
                        core.catalog_document_key(p_org, p_vehicle, p_file_id);
    RETURN;
  END IF;
  IF p_file_id IS NULL
     OR p_doc_type IS NULL OR p_doc_type NOT IN ('TITLE', 'OWNER_AUTHORIZATION', 'PLATE_VIN_PHOTO',
                                                 'INSPECTION', 'LENDER_CONSENT',
                                                 'COMPULSORY_INSURANCE')
     OR p_mime IS NULL OR p_mime NOT IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')
     OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 10485760
     OR p_sha256 IS NULL OR pg_catalog.octet_length(p_sha256) <> 32
     OR (p_valid_until IS NOT NULL
         AND p_valid_until NOT BETWEEN DATE '1950-01-01' AND DATE '2100-12-31') THEN
    RETURN QUERY SELECT 'VEHICLE_DOCUMENT_INVALID'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  v_key := core.catalog_document_key(p_org, p_vehicle, p_file_id);
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id,
                                     source, classification, retention_class, enc_subject_type,
                                     enc_subject_id)
  VALUES (p_file_id, 'DOCUMENTS', v_key, p_mime, p_bytes, p_sha256, w.user_id, 'HOST_UPLOAD', 'C2',
          'VEHICLE_DOCUMENT', 'USER', w.user_id);
  UPDATE core.catalog_vehicle_document AS d
     SET status = 'SUPERSEDED'
   WHERE d.vehicle_id = p_vehicle AND d.doc_type = p_doc_type AND d.status IN ('SUBMITTED', 'VALID');
  INSERT INTO core.catalog_vehicle_document (id, vehicle_id, org_id, country_code, doc_type, file_id,
                                             mime, bytes, valid_until, uploaded_by)
  VALUES (p_file_id, p_vehicle, p_org, w.country_code, p_doc_type, p_file_id, p_mime, p_bytes,
          p_valid_until, w.user_id);
  UPDATE core.catalog_vehicle AS x SET eligibility_status = 'PENDING' WHERE x.id = p_vehicle;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (w.user_id, 'P2P_HOST', 'VEHICLE_DOCUMENT_RECEIVED', 'VEHICLE', p_vehicle, NULL,
          pg_catalog.jsonb_build_object('orgId', p_org, 'country', w.country_code,
                                        'documentType', p_doc_type, 'fileId', p_file_id,
                                        'mime', p_mime, 'bytes', p_bytes,
                                        'countries', pg_catalog.jsonb_build_array(w.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_file_id, v_key;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_add_vehicle_document(bytea, uuid, uuid, uuid, text, text, bigint, bytea, date) IS
  'Pièce du véhicule (fichier DOCUMENTS C2 chiffré par la clé de l''hôte, créé avant le dépôt) ; '
  'remplace la pièce vivante du même type. SECURITY DEFINER, EXECUTE app_api. US-124 (ADR-107).';

-- 6.5 Soumission du véhicule à la revue de l'ops : règles automatiques (non strictes) ; un refus
-- est journalisé (ligne REFUSED avec ses motifs), rien d'autre n'est écrit. Sinon : élément de la
-- file LISTING (sujet VEHICLE, échéance de la base), ligne SUBMITTED, journal. Issues : DONE (id de
-- l'élément), le premier motif (VEHICLE_TOO_OLD, VEHICLE_TITLE_MISMATCH…, `reasons` les porte tous),
-- VEHICLE_ALREADY_ELIGIBLE, PARAM_MISSING (file ou seuils absents) et celles de
-- catalog_vehicle_writable.
CREATE FUNCTION core.catalog_cmd_submit_vehicle_eligibility(p_token_hash bytea, p_org uuid,
                                                            p_vehicle uuid)
  RETURNS TABLE (outcome text, item_id uuid, reasons text[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  w      record;
  v_r    text[];
  v_item record;
BEGIN
  SELECT * INTO w FROM core.catalog_vehicle_writable(p_token_hash, p_org, p_vehicle);
  IF w.outcome <> 'OK' THEN
    RETURN QUERY SELECT w.outcome, NULL::uuid, '{}'::text[];
    RETURN;
  END IF;
  IF w.eligibility_status = 'ELIGIBLE' THEN
    RETURN QUERY SELECT 'VEHICLE_ALREADY_ELIGIBLE'::text, NULL::uuid, '{}'::text[];
    RETURN;
  END IF;
  v_r := core.catalog_vehicle_blockers(p_vehicle, false);
  IF 'PARAM_MISSING' = ANY (v_r) THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid, v_r;
    RETURN;
  END IF;
  IF pg_catalog.cardinality(v_r) > 0 THEN
    INSERT INTO core.catalog_vehicle_eligibility_check (id, vehicle_id, org_id, country_code, kind,
                                                        result, reasons, actor_user_id, actor_role)
    VALUES (pg_catalog.gen_random_uuid(), p_vehicle, p_org, w.country_code, 'AUTO_SUBMISSION',
            'REFUSED', v_r, w.user_id, 'P2P_HOST');
    UPDATE core.catalog_vehicle AS x SET eligibility_reasons = v_r WHERE x.id = p_vehicle;
    RETURN QUERY SELECT v_r[1], NULL::uuid, v_r;
    RETURN;
  END IF;
  SELECT * INTO v_item
    FROM core.support_enqueue_review('LISTING', 'VEHICLE', p_vehicle, w.country_code, w.user_id);
  IF v_item.outcome IS DISTINCT FROM 'CREATED' AND v_item.outcome IS DISTINCT FROM 'EXISTS' THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid, '{}'::text[];
    RETURN;
  END IF;
  INSERT INTO core.catalog_vehicle_eligibility_check (id, vehicle_id, org_id, country_code, kind,
                                                      result, reasons, actor_user_id, actor_role,
                                                      review_item_id)
  VALUES (pg_catalog.gen_random_uuid(), p_vehicle, p_org, w.country_code, 'AUTO_SUBMISSION',
          'SUBMITTED', '{}', w.user_id, 'P2P_HOST', v_item.item_id);
  UPDATE core.catalog_vehicle AS x
     SET eligibility_submitted_at = platform.now(), eligibility_reasons = '{}',
         eligibility_status = 'PENDING'
   WHERE x.id = p_vehicle;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (w.user_id, 'P2P_HOST', 'VEHICLE_ELIGIBILITY_SUBMITTED', 'VEHICLE', p_vehicle, NULL,
          pg_catalog.jsonb_build_object('orgId', p_org, 'country', w.country_code,
                                        'itemId', v_item.item_id,
                                        'countries', pg_catalog.jsonb_build_array(w.country_code)));
  RETURN QUERY SELECT 'DONE'::text, v_item.item_id, '{}'::text[];
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_submit_vehicle_eligibility(bytea, uuid, uuid) IS
  'Soumission du véhicule à la revue de l''ops : règles automatiques (âge, compteur, catalogue, '
  'titre, prenda, pièces exigées) ; refus journalisé ; sinon élément de la file LISTING. SECURITY '
  'DEFINER, EXECUTE app_api. US-124 (ADR-107).';

-- 6.7 Véhicule publiable (pour US-118) : ELIGIBLE, non libéré, règles strictes encore vraies
-- (consentement du créancier, pièces exigées VALID et non expirées). Faux si inconnu.
CREATE FUNCTION core.catalog_vehicle_publishable(p_vehicle uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE((SELECT v.eligibility_status = 'ELIGIBLE' AND v.released_at IS NULL
                     FROM core.catalog_vehicle AS v WHERE v.id = p_vehicle), false)
         AND pg_catalog.cardinality(core.catalog_vehicle_blockers(p_vehicle, true)) = 0
$fn$;
COMMENT ON FUNCTION core.catalog_vehicle_publishable(uuid) IS
  'Véhicule publiable : ELIGIBLE, non libéré, consentement du créancier et pièces valides (règles '
  'strictes). Pour la publication (US-118). SECURITY DEFINER, EXECUTE à aucun rôle applicatif. US-124.';

-- 6.6 Lecture de l'hôte : éligibilité de chaque véhicule du compte (statut, motifs, pièces sans
-- leur clé de stockage, pièces exigées, revue en cours). Jamais la plaque ni le VIN (déjà connus de
-- l'hôte par catalog_host_vehicles), jamais l'auteur de la revue.
CREATE FUNCTION core.catalog_host_vehicle_eligibility(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (vehicle_id uuid, body jsonb)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.id, pg_catalog.jsonb_build_object(
    'vehicleId', v.id,
    'eligibilityStatus', v.eligibility_status,
    'titleHolder', v.title_holder,
    'lienDeclared', v.lien_declared,
    'odometerKm', v.odometer_km,
    'reasons', pg_catalog.to_jsonb(v.eligibility_reasons),
    'released', v.released_at IS NOT NULL,
    'publishable', core.catalog_vehicle_publishable(v.id),
    'underReview', v.eligibility_submitted_at IS NOT NULL
                   AND (v.eligibility_checked_at IS NULL
                        OR v.eligibility_checked_at < v.eligibility_submitted_at),
    'submittedAt', v.eligibility_submitted_at,
    'checkedAt', v.eligibility_checked_at,
    'requiredDocuments', (SELECT COALESCE(pg_catalog.jsonb_agg(t.doc ORDER BY t.ord), '[]'::jsonb)
                            FROM (VALUES (1, 'TITLE'), (2, 'PLATE_VIN_PHOTO'), (3, 'INSPECTION'),
                                         (4, 'COMPULSORY_INSURANCE')) AS t(ord, doc)
                           WHERE core.catalog_document_required(t.doc, v.country_code))
                         || CASE WHEN v.title_holder = 'THIRD_PARTY'
                                 THEN '["OWNER_AUTHORIZATION"]'::jsonb ELSE '[]'::jsonb END
                         || CASE WHEN v.lien_declared
                                      AND COALESCE(core.catalog_param_bool(
                                            'vehicle_financed_requires_lender_consent',
                                            v.country_code), true)
                                 THEN '["LENDER_CONSENT"]'::jsonb ELSE '[]'::jsonb END,
    'documents', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                           'documentId', d.id, 'type', d.doc_type, 'status', d.status,
                           'validUntil', d.valid_until, 'rejectReason', d.reject_reason,
                           'mime', d.mime, 'bytes', d.bytes, 'createdAt', d.created_at)
                           ORDER BY d.doc_type, d.created_at), '[]'::jsonb)
                    FROM core.catalog_vehicle_document AS d
                   WHERE d.vehicle_id = v.id AND d.status IN ('SUBMITTED', 'VALID', 'REJECTED')))
    FROM core.catalog_host_context(p_token_hash, p_org) AS h
    JOIN core.catalog_vehicle AS v ON v.org_id = p_org AND v.country_code = h.country_code
   WHERE h.outcome = 'OK'
   ORDER BY v.created_at, v.id
$fn$;
COMMENT ON FUNCTION core.catalog_host_vehicle_eligibility(bytea, uuid) IS
  'Éligibilité des véhicules du compte de la session : statut, motifs, pièces (sans clé de '
  'stockage), pièces exigées par le pays et les déclarations. SECURITY DEFINER, EXECUTE app_api. '
  'US-124 (ADR-107).';

-- 6.8 Contestation d'une plaque ou d'un VIN (N-61). Véhicule en cause : véhicule NON libéré d'un
-- AUTRE compte du même pays qui porte cette plaque ou ce VIN. Issues de l'aide : OK (véhicule en
-- cause), AUTH_REQUIRED, FORBIDDEN, HOST_ACCOUNT_SUSPENDED, VEHICLE_FIELD_REQUIRED,
-- CLAIM_NOT_NEEDED (aucun autre compte n'a cette plaque ni ce VIN), CLAIM_DUPLICATE (contestation
-- ouverte du même compte). Rien n'est révélé du compte en cause.
CREATE FUNCTION core.catalog_vehicle_claim_target(p_token_hash bytea, p_org uuid, p_plate text,
                                                  p_vin text)
  RETURNS TABLE (outcome text, user_id uuid, country_code text, target uuid, plate text, vin text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h       record;
  v_plate text := core.catalog_normalize_plate(p_plate);
  v_vin   text := core.catalog_normalize_vin(p_vin);
  v_t     uuid;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, h.user_id, h.country_code, NULL::uuid,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_plate IS NULL OR v_plate !~ '^[A-Z0-9]{2,12}$'
     OR (p_vin IS NOT NULL AND (v_vin IS NULL OR v_vin !~ '^[A-Z0-9]{5,17}$')) THEN
    RETURN QUERY SELECT 'VEHICLE_FIELD_REQUIRED'::text, h.user_id, h.country_code, NULL::uuid,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT x.id INTO v_t
    FROM core.catalog_vehicle AS x
   WHERE x.released_at IS NULL AND x.country_code = h.country_code AND x.org_id <> p_org
     AND (x.plate = v_plate OR (v_vin IS NOT NULL AND x.vin = v_vin))
   ORDER BY x.created_at, x.id
   LIMIT 1;
  IF v_t IS NULL THEN
    RETURN QUERY SELECT 'CLAIM_NOT_NEEDED'::text, h.user_id, h.country_code, NULL::uuid,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle_claim AS c
              WHERE c.org_id = p_org AND c.target_vehicle_id = v_t AND c.status = 'OPEN') THEN
    RETURN QUERY SELECT 'CLAIM_DUPLICATE'::text, h.user_id, h.country_code, NULL::uuid,
                        NULL::text, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, h.user_id, h.country_code, v_t, v_plate, v_vin;
END
$fn$;
REVOKE ALL ON FUNCTION core.catalog_vehicle_claim_target(bytea, uuid, text, text) FROM PUBLIC;

-- Droit d'ouvrir une contestation, jugé AVANT l'antivirus ; n'écrit rien. Issue OK ou un refus.
CREATE FUNCTION core.catalog_vehicle_claim_permitted(p_token_hash bytea, p_org uuid, p_plate text,
                                                     p_vin text)
  RETURNS TABLE (outcome text)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.outcome FROM core.catalog_vehicle_claim_target(p_token_hash, p_org, p_plate, p_vin) AS t
$fn$;
COMMENT ON FUNCTION core.catalog_vehicle_claim_permitted(bytea, uuid, text, text) IS
  'Droit d''ouvrir une contestation de plaque ou de VIN, jugé avant l''antivirus ; n''écrit rien. '
  'SECURITY DEFINER, EXECUTE app_api. US-124 (BOARD N-61).';

-- Ouverture : fichier du titre du demandeur (DOCUMENTS, C2, sa clé), contestation OPEN, élément de
-- la file LISTING (sujet VEHICLE_CLAIM) ; file indisponible : rien n'est écrit. Issues : DONE (id
-- de la contestation, clé de stockage), VEHICLE_DOCUMENT_INVALID et celles de l'aide.
CREATE FUNCTION core.catalog_cmd_open_vehicle_claim(p_token_hash bytea, p_org uuid, p_plate text,
                                                    p_vin text, p_file_id uuid, p_mime text,
                                                    p_bytes bigint, p_sha256 bytea)
  RETURNS TABLE (outcome text, claim_id uuid, storage_key text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t      record;
  v_item record;
  v_key  text;
BEGIN
  SELECT * INTO t FROM core.catalog_vehicle_claim_target(p_token_hash, p_org, p_plate, p_vin);
  IF t.outcome <> 'OK' THEN
    RETURN QUERY SELECT t.outcome, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_file_id IS NULL
     OR p_mime IS NULL OR p_mime NOT IN ('image/jpeg', 'image/png', 'image/heic', 'application/pdf')
     OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 10485760
     OR p_sha256 IS NULL OR pg_catalog.octet_length(p_sha256) <> 32 THEN
    RETURN QUERY SELECT 'VEHICLE_DOCUMENT_INVALID'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cat.claim:' || p_org::text || ':' || t.target::text, 0));
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle_claim AS c
              WHERE c.org_id = p_org AND c.target_vehicle_id = t.target AND c.status = 'OPEN') THEN
    RETURN QUERY SELECT 'CLAIM_DUPLICATE'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO v_item
    FROM core.support_enqueue_review('LISTING', 'VEHICLE_CLAIM', p_file_id, t.country_code, t.user_id);
  IF v_item.outcome IS DISTINCT FROM 'CREATED' THEN
    RAISE EXCEPTION 'file des contestations indisponible (%)', COALESCE(v_item.outcome, 'NULL')
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  v_key := core.catalog_document_key(p_org, p_file_id, p_file_id);
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id,
                                     source, classification, retention_class, enc_subject_type,
                                     enc_subject_id)
  VALUES (p_file_id, 'DOCUMENTS', v_key, p_mime, p_bytes, p_sha256, t.user_id, 'HOST_UPLOAD', 'C2',
          'VEHICLE_DOCUMENT', 'USER', t.user_id);
  -- id de la contestation = id du fichier du titre = sujet de l'élément de file
  INSERT INTO core.catalog_vehicle_claim (id, org_id, country_code, claimant_user_id, plate, vin,
                                          target_vehicle_id, title_file_id, mime, bytes,
                                          review_item_id)
  VALUES (p_file_id, p_org, t.country_code, t.user_id, t.plate, t.vin, t.target, p_file_id, p_mime,
          p_bytes, v_item.item_id);
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (t.user_id, 'P2P_HOST', 'VEHICLE_CLAIM_OPENED', 'VEHICLE_CLAIM', p_file_id, NULL,
          pg_catalog.jsonb_build_object('orgId', p_org, 'country', t.country_code,
                                        'itemId', v_item.item_id,
                                        'countries', pg_catalog.jsonb_build_array(t.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_file_id, v_key;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_open_vehicle_claim(bytea, uuid, text, text, uuid, text, bigint, bytea) IS
  'Contestation d''une plaque ou d''un VIN pris par un autre compte du pays, avec le titre du '
  'demandeur (fichier privé C2) ; élément de la file LISTING. SECURITY DEFINER, EXECUTE app_api. '
  'US-124 (BOARD N-61).';

-- Contestations du compte de la session (statut seulement : rien du véhicule ni du compte en cause).
CREATE FUNCTION core.catalog_host_vehicle_claims(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (claim_id uuid, plate text, status text, dismiss_reason text, created_at timestamptz,
                 decided_at timestamptz)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.id, c.plate, c.status, c.dismiss_reason, c.created_at, c.decided_at
    FROM core.catalog_host_context(p_token_hash, p_org) AS h
    JOIN core.catalog_vehicle_claim AS c ON c.org_id = p_org AND c.country_code = h.country_code
   WHERE h.outcome = 'OK'
   ORDER BY c.created_at, c.id
$fn$;
COMMENT ON FUNCTION core.catalog_host_vehicle_claims(bytea, uuid) IS
  'Contestations du compte de la session (plaque saisie par lui, statut). SECURITY DEFINER, '
  'EXECUTE app_api. US-124 (BOARD N-61).';

-- 6.9 Nom affiché au voyageur pour une annonce LISTED (N-37) : premier mot du prénom légal.
CREATE FUNCTION core.catalog_public_host_name(p_listing_id uuid)
  RETURNS TABLE (host_first_name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.iam_host_public_first_name(l.org_id)
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.status = 'LISTED'
$fn$;
COMMENT ON FUNCTION core.catalog_public_host_name(uuid) IS
  'Nom de l''hôte affiché au voyageur sur une annonce LISTED : premier mot du prénom légal, jamais '
  'le nom de famille (BOARD N-37). SECURITY DEFINER, EXECUTE app_api. US-124.';

-- 6.10 Fonctions de domaine de la console (EXECUTE à iam_staff_owner seul) ----------------------
-- Dossier du véhicule pour l'ops (C2 : plaque, VIN ; la console journalise AVANT de le rendre) :
-- caractéristiques, déclarations, pièces (sans clé), pièces exigées, motifs stricts, derniers
-- contrôles, compte d'hôte (la console ajoute le titulaire et ses noms). NULL si inconnu ou
-- d'un autre pays.
CREATE FUNCTION core.catalog_vehicle_dossier(p_vehicle uuid, p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'vehicleId', v.id, 'orgId', v.org_id, 'country', v.country_code,
    'plate', v.plate, 'vin', v.vin, 'year', v.year,
    'make', COALESCE(mk.name, v.make_text), 'model', COALESCE(mo.name, v.model_text),
    'variantId', v.variant_id, 'odometerKm', v.odometer_km, 'titleHolder', v.title_holder,
    'lienDeclared', v.lien_declared, 'eligibilityStatus', v.eligibility_status,
    'reasons', pg_catalog.to_jsonb(v.eligibility_reasons), 'released', v.released_at IS NOT NULL,
    'strictBlockers', pg_catalog.to_jsonb(core.catalog_vehicle_blockers(v.id, true)),
    'documents', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                           'documentId', d.id, 'type', d.doc_type, 'status', d.status,
                           'validUntil', d.valid_until, 'rejectReason', d.reject_reason,
                           'mime', d.mime, 'bytes', d.bytes, 'createdAt', d.created_at)
                           ORDER BY d.doc_type, d.created_at), '[]'::jsonb)
                    FROM core.catalog_vehicle_document AS d
                   WHERE d.vehicle_id = v.id AND d.status IN ('SUBMITTED', 'VALID', 'REJECTED')),
    'checks', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'kind', c.kind, 'result', c.result, 'reasons', pg_catalog.to_jsonb(c.reasons),
                        'createdAt', c.created_at) ORDER BY c.created_at DESC), '[]'::jsonb)
                 FROM (SELECT * FROM core.catalog_vehicle_eligibility_check AS c0
                        WHERE c0.vehicle_id = v.id ORDER BY c0.created_at DESC LIMIT 10) AS c))
    FROM core.catalog_vehicle AS v
    LEFT JOIN core.catalog_vehicle_variant AS va ON va.id = v.variant_id
    LEFT JOIN core.catalog_vehicle_model AS mo ON mo.id = va.model_id
    LEFT JOIN core.catalog_vehicle_make AS mk ON mk.id = mo.make_id
   WHERE v.id = p_vehicle AND v.country_code = p_country
$fn$;

-- Fichier d'une pièce lisible par l'élément de file : pièce du véhicule (sujet VEHICLE) ; titre du
-- demandeur ou pièce du véhicule en cause (sujet VEHICLE_CLAIM). Rend la clé de stockage, le type,
-- la taille et la personne dont la clé chiffre le fichier ; rien si le fichier n'est pas couvert.
CREATE FUNCTION core.catalog_vehicle_file(p_subject_type text, p_subject_id uuid, p_country text,
                                          p_file_id uuid)
  RETURNS TABLE (storage_key text, mime text, bytes bigint, subject_user_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.catalog_document_key(d.org_id, d.vehicle_id, d.file_id), d.mime, d.bytes, d.uploaded_by
    FROM core.catalog_vehicle_document AS d
   WHERE d.file_id = p_file_id AND d.country_code = p_country
     AND d.status IN ('SUBMITTED', 'VALID', 'REJECTED')
     AND ((p_subject_type = 'VEHICLE' AND d.vehicle_id = p_subject_id)
          OR (p_subject_type = 'VEHICLE_CLAIM'
              AND d.vehicle_id = (SELECT c.target_vehicle_id FROM core.catalog_vehicle_claim AS c
                                   WHERE c.id = p_subject_id)))
  UNION ALL
  SELECT core.catalog_document_key(c.org_id, c.id, c.title_file_id), c.mime, c.bytes, c.claimant_user_id
    FROM core.catalog_vehicle_claim AS c
   WHERE p_subject_type = 'VEHICLE_CLAIM' AND c.id = p_subject_id AND c.title_file_id = p_file_id
     AND c.country_code = p_country
$fn$;

-- Décision de l'ops sur un véhicule en revue, dans le pays p_country. Liste de contrôle FERMÉE
-- (`p_checklist`, toutes les clés, PASS / FAIL ; REGISTRY : NOT_CONSULTABLE admis en bêta) et un
-- verdict pour CHAQUE pièce soumise (`p_documents` : [{documentId, verdict VALID | REJECTED,
-- validUntil, reason}] ; INSPECTION, COMPULSORY_INSURANCE et LENDER_CONSENT VALID exigent
-- validUntil). Le résultat est CALCULÉ : ELIGIBLE si tout passe et qu'aucune règle stricte ne
-- bloque ; titre interdit ou registre défavorable : INELIGIBLE ; sinon PENDING avec les motifs.
-- Issues : DECIDED (result, reasons), NOT_UNDER_REVIEW, COUNTRY_MISMATCH, CHECKLIST_INVALID.
CREATE FUNCTION core.catalog_vehicle_decide(p_vehicle uuid, p_country text, p_actor uuid,
                                            p_actor_role text, p_checklist jsonb,
                                            p_documents jsonb, p_item uuid)
  RETURNS TABLE (outcome text, result text, reasons text[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now    timestamptz := platform.now();
  v        record;
  v_keys   text[] := ARRAY['TITLE_HOLDER', 'TITLE_CLEAN', 'PLATE_MATCH', 'VIN_MATCH', 'LIEN',
                           'INSPECTION', 'REGISTRY'];
  v_ok     boolean;
  v_r      text[] := '{}';
  v_res    text;
  v_doc    jsonb;
  v_d      record;
  v_seen   uuid[] := '{}';
  v_until  date;
BEGIN
  IF p_vehicle IS NULL OR p_country IS NULL OR p_actor IS NULL
     OR p_actor_role IS NULL OR p_actor_role NOT IN ('OPS_AGENT', 'ADMIN') THEN
    RAISE EXCEPTION 'revue du véhicule : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.id, x.org_id, x.country_code, x.eligibility_status, x.released_at,
         x.eligibility_submitted_at, x.eligibility_checked_at
    INTO v
    FROM core.catalog_vehicle AS x WHERE x.id = p_vehicle FOR UPDATE;
  IF v.id IS NULL OR v.country_code IS DISTINCT FROM p_country THEN
    RETURN QUERY SELECT 'COUNTRY_MISMATCH'::text, NULL::text, '{}'::text[];
    RETURN;
  END IF;
  IF v.released_at IS NOT NULL OR v.eligibility_submitted_at IS NULL
     OR (v.eligibility_checked_at IS NOT NULL
         AND v.eligibility_checked_at >= v.eligibility_submitted_at) THEN
    RETURN QUERY SELECT 'NOT_UNDER_REVIEW'::text, NULL::text, '{}'::text[];
    RETURN;
  END IF;
  -- liste de contrôle : exactement les clés attendues, chaque valeur cochée (aucune par défaut)
  v_ok := p_checklist IS NOT NULL AND pg_catalog.jsonb_typeof(p_checklist) = 'object'
    AND (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.jsonb_object_keys(p_checklist) AS k)
        = (SELECT pg_catalog.array_agg(k ORDER BY k) FROM pg_catalog.unnest(v_keys) AS k)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_checklist) AS e(key, value)
                     WHERE pg_catalog.jsonb_typeof(e.value) <> 'string'
                        OR NOT ((e.value #>> '{}') IN ('PASS', 'FAIL')
                                OR (e.key = 'REGISTRY' AND (e.value #>> '{}') = 'NOT_CONSULTABLE')));
  -- verdicts : un tableau, une entrée par pièce SOUMISE du véhicule, aucune autre
  v_ok := v_ok AND p_documents IS NOT NULL AND pg_catalog.jsonb_typeof(p_documents) = 'array';
  IF v_ok THEN
    FOR v_doc IN SELECT x FROM pg_catalog.jsonb_array_elements(p_documents) AS x LOOP
      IF pg_catalog.jsonb_typeof(v_doc) <> 'object'
         OR NOT (v_doc ? 'documentId') OR NOT (v_doc ? 'verdict')
         OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(v_doc) AS k
                     WHERE k NOT IN ('documentId', 'verdict', 'validUntil', 'reason'))
         OR pg_catalog.jsonb_typeof(v_doc -> 'documentId') <> 'string'
         OR (v_doc ->> 'documentId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR COALESCE(v_doc ->> 'verdict', '') NOT IN ('VALID', 'REJECTED')
         OR (v_doc ? 'validUntil' AND pg_catalog.jsonb_typeof(v_doc -> 'validUntil') NOT IN ('null', 'string'))
         OR (pg_catalog.jsonb_typeof(v_doc -> 'validUntil') = 'string'
             AND (v_doc ->> 'validUntil') !~ '^(19[5-9][0-9]|20[0-9][0-9]|2100)-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$')
         OR (v_doc ->> 'verdict' = 'REJECTED'
             AND COALESCE(v_doc ->> 'reason', '') NOT IN ('ILLEGIBLE', 'EXPIRED', 'MISMATCH',
                                                         'WRONG_DOCUMENT', 'SUSPECTED_FORGERY'))
         OR (v_doc ->> 'verdict' = 'VALID' AND v_doc ? 'reason'
             AND pg_catalog.jsonb_typeof(v_doc -> 'reason') <> 'null') THEN
        v_ok := false;
        EXIT;
      END IF;
      -- date impossible (31 février…) : saisie refusée, jamais une erreur
      IF pg_catalog.jsonb_typeof(v_doc -> 'validUntil') = 'string' THEN
        BEGIN
          v_until := (v_doc ->> 'validUntil')::date;
        EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
          v_ok := false;
          EXIT;
        END;
      END IF;
      SELECT d.id, d.doc_type, d.status INTO v_d
        FROM core.catalog_vehicle_document AS d
       WHERE d.id = (v_doc ->> 'documentId')::uuid AND d.vehicle_id = p_vehicle;
      IF v_d.id IS NULL OR v_d.status <> 'SUBMITTED' OR v_d.id = ANY (v_seen)
         OR (v_doc ->> 'verdict' = 'VALID'
             AND v_d.doc_type IN ('INSPECTION', 'COMPULSORY_INSURANCE', 'LENDER_CONSENT')
             AND pg_catalog.jsonb_typeof(v_doc -> 'validUntil') IS DISTINCT FROM 'string') THEN
        v_ok := false;
        EXIT;
      END IF;
      v_seen := v_seen || v_d.id;
    END LOOP;
    v_ok := v_ok AND NOT EXISTS (SELECT 1 FROM core.catalog_vehicle_document AS d
                                  WHERE d.vehicle_id = p_vehicle AND d.status = 'SUBMITTED'
                                    AND NOT (d.id = ANY (v_seen)));
  END IF;
  IF NOT COALESCE(v_ok, false) THEN
    RETURN QUERY SELECT 'CHECKLIST_INVALID'::text, NULL::text, '{}'::text[];
    RETURN;
  END IF;
  -- verdicts posés
  FOR v_doc IN SELECT x FROM pg_catalog.jsonb_array_elements(p_documents) AS x LOOP
    v_until := CASE WHEN pg_catalog.jsonb_typeof(v_doc -> 'validUntil') = 'string'
                    THEN (v_doc ->> 'validUntil')::date END;
    UPDATE core.catalog_vehicle_document AS d
       SET status = v_doc ->> 'verdict',
           valid_until = COALESCE(v_until, d.valid_until),
           reject_reason = CASE WHEN v_doc ->> 'verdict' = 'REJECTED' THEN v_doc ->> 'reason' END,
           reviewed_by = p_actor, reviewed_at = v_now
     WHERE d.id = (v_doc ->> 'documentId')::uuid;
    IF v_doc ->> 'verdict' = 'REJECTED' AND NOT ('VEHICLE_DOCUMENT_REJECTED' = ANY (v_r)) THEN
      v_r := v_r || 'VEHICLE_DOCUMENT_REJECTED'::text;
    END IF;
  END LOOP;
  -- points de contrôle en échec ⇒ motifs (19 US-124 critère 2 : plaque, VIN)
  IF p_checklist ->> 'TITLE_HOLDER' = 'FAIL' THEN v_r := v_r || 'VEHICLE_TITLE_MISMATCH'::text; END IF;
  IF p_checklist ->> 'PLATE_MATCH' = 'FAIL' THEN v_r := v_r || 'VEHICLE_PLATE_MISMATCH'::text; END IF;
  IF p_checklist ->> 'VIN_MATCH' = 'FAIL' THEN v_r := v_r || 'VEHICLE_VIN_MISMATCH'::text; END IF;
  IF p_checklist ->> 'LIEN' = 'FAIL' THEN v_r := v_r || 'VEHICLE_LENDER_CONSENT_REQUIRED'::text; END IF;
  IF p_checklist ->> 'INSPECTION' = 'FAIL' THEN v_r := v_r || 'VEHICLE_INSPECTION_INVALID'::text; END IF;
  IF p_checklist ->> 'TITLE_CLEAN' = 'FAIL' THEN v_r := v_r || 'VEHICLE_TITLE_FORBIDDEN'::text; END IF;
  IF p_checklist ->> 'REGISTRY' = 'FAIL' THEN v_r := v_r || 'VEHICLE_REGISTRY_FLAGGED'::text; END IF;
  -- règles strictes après les verdicts (pièces VALID et non expirées, consentement, âge…)
  v_r := v_r || ARRAY(SELECT b FROM pg_catalog.unnest(core.catalog_vehicle_blockers(p_vehicle, true)) AS b
                       WHERE NOT (b = ANY (v_r)));
  v_res := CASE
             WHEN 'VEHICLE_TITLE_FORBIDDEN' = ANY (v_r) OR 'VEHICLE_REGISTRY_FLAGGED' = ANY (v_r)
               THEN 'INELIGIBLE'
             WHEN pg_catalog.cardinality(v_r) = 0 THEN 'ELIGIBLE'
             ELSE 'PENDING'
           END;
  INSERT INTO core.catalog_vehicle_eligibility_check (id, vehicle_id, org_id, country_code, kind,
                                                      result, reasons, checklist, actor_user_id,
                                                      actor_role, review_item_id, created_at)
  VALUES (pg_catalog.gen_random_uuid(), p_vehicle, v.org_id, v.country_code, 'OPS_REVIEW', v_res,
          v_r, p_checklist, p_actor, p_actor_role, p_item, v_now);
  UPDATE core.catalog_vehicle AS x
     SET eligibility_status = v_res, eligibility_reasons = v_r, eligibility_checked_at = v_now
   WHERE x.id = p_vehicle;
  RETURN QUERY SELECT 'DECIDED'::text, v_res, v_r;
END
$fn$;

-- Dossier d'une contestation pour l'ops (C2 ; journalisé par la console) : plaque et VIN saisis,
-- demandeur (identifiant), titre (fichier), dossier du véhicule en cause.
CREATE FUNCTION core.catalog_vehicle_claim_dossier(p_claim uuid, p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    'claimId', c.id, 'country', c.country_code, 'status', c.status, 'plate', c.plate, 'vin', c.vin,
    'claimantUserId', c.claimant_user_id, 'claimantOrgId', c.org_id,
    'titleFileId', c.title_file_id, 'mime', c.mime, 'bytes', c.bytes, 'createdAt', c.created_at,
    'dismissReason', c.dismiss_reason,
    'target', core.catalog_vehicle_dossier(c.target_vehicle_id, c.country_code))
    FROM core.catalog_vehicle_claim AS c
   WHERE c.id = p_claim AND c.country_code = p_country
$fn$;

-- Décision sur une contestation OPEN : UPHOLD (ADMIN seul, contrôlé par la console) libère le
-- véhicule en cause (released_at, INELIGIBLE, motif VEHICLE_RELEASED, annonces vivantes
-- REMOVED_BY_PLATFORM, ligne CLAIM_RELEASE) ; DISMISS motivé. Issues : DECIDED (status, véhicule en
-- cause), NOT_OPEN, COUNTRY_MISMATCH, CLAIM_REASON_INVALID.
CREATE FUNCTION core.catalog_vehicle_claim_decide(p_claim uuid, p_country text, p_actor uuid,
                                                  p_actor_role text, p_decision text,
                                                  p_reason text)
  RETURNS TABLE (outcome text, status text, target_vehicle_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now timestamptz := platform.now();
  c     record;
  v     record;
BEGIN
  IF p_claim IS NULL OR p_country IS NULL OR p_actor IS NULL
     OR p_actor_role IS NULL OR p_actor_role NOT IN ('OPS_AGENT', 'ADMIN')
     OR p_decision IS NULL OR p_decision NOT IN ('UPHOLD', 'DISMISS') THEN
    RAISE EXCEPTION 'contestation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- véhicule en cause d'abord, puis la contestation
  SELECT x.target_vehicle_id INTO v FROM core.catalog_vehicle_claim AS x WHERE x.id = p_claim;
  IF v.target_vehicle_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_OPEN'::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT x.id, x.org_id, x.country_code, x.released_at, x.eligibility_status INTO v
    FROM core.catalog_vehicle AS x WHERE x.id = v.target_vehicle_id FOR UPDATE;
  SELECT x.id, x.status, x.country_code INTO c
    FROM core.catalog_vehicle_claim AS x WHERE x.id = p_claim FOR UPDATE;
  IF c.country_code IS DISTINCT FROM p_country THEN
    RETURN QUERY SELECT 'COUNTRY_MISMATCH'::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  IF c.status <> 'OPEN' THEN
    RETURN QUERY SELECT 'NOT_OPEN'::text, c.status, NULL::uuid;
    RETURN;
  END IF;
  IF (p_decision = 'DISMISS' AND (p_reason IS NULL
                                  OR p_reason NOT IN ('INSUFFICIENT_PROOF', 'CLAIMANT_NOT_OWNER')))
     OR (p_decision = 'UPHOLD' AND p_reason IS NOT NULL) THEN
    RETURN QUERY SELECT 'CLAIM_REASON_INVALID'::text, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_decision = 'UPHOLD' AND v.released_at IS NULL THEN
    UPDATE core.catalog_vehicle AS x
       SET released_at = v_now, eligibility_status = 'INELIGIBLE',
           eligibility_reasons = ARRAY['VEHICLE_RELEASED'], eligibility_checked_at = v_now
     WHERE x.id = v.id;
    UPDATE core.catalog_listing AS l
       SET status = 'REMOVED_BY_PLATFORM', updated_by = p_actor
     WHERE l.vehicle_id = v.id AND l.status NOT IN ('DELETED', 'REMOVED_BY_PLATFORM');
    INSERT INTO core.catalog_vehicle_eligibility_check (id, vehicle_id, org_id, country_code, kind,
                                                        result, reasons, actor_user_id, actor_role,
                                                        created_at)
    VALUES (pg_catalog.gen_random_uuid(), v.id, v.org_id, v.country_code, 'CLAIM_RELEASE',
            'INELIGIBLE', ARRAY['VEHICLE_RELEASED'], p_actor, p_actor_role, v_now);
  END IF;
  UPDATE core.catalog_vehicle_claim AS x
     SET status = CASE WHEN p_decision = 'UPHOLD' THEN 'UPHELD' ELSE 'DISMISSED' END,
         dismiss_reason = CASE WHEN p_decision = 'DISMISS' THEN p_reason END,
         decided_by = p_actor, decided_at = v_now
   WHERE x.id = p_claim;
  RETURN QUERY SELECT 'DECIDED'::text,
                      CASE WHEN p_decision = 'UPHOLD' THEN 'UPHELD' ELSE 'DISMISSED' END::text,
                      v.id;
END
$fn$;

COMMENT ON FUNCTION core.catalog_vehicle_dossier(uuid, text) IS
  'Dossier du véhicule vu par l''ops (C2 : plaque, VIN ; journalisé par la console). SECURITY '
  'DEFINER, EXECUTE iam_staff_owner seul. US-124 (ADR-107).';
COMMENT ON FUNCTION core.catalog_vehicle_file(text, uuid, text, uuid) IS
  'Fichier d''une pièce couvert par l''élément de file (clé, type, taille, personne de la clé). '
  'SECURITY DEFINER, EXECUTE iam_staff_owner seul. US-124 (ADR-107).';
COMMENT ON FUNCTION core.catalog_vehicle_decide(uuid, text, uuid, text, jsonb, jsonb, uuid) IS
  'Décision de l''ops sur un véhicule en revue : liste de contrôle fermée et verdict par pièce ; '
  'résultat calculé (ELIGIBLE, PENDING, INELIGIBLE). SECURITY DEFINER, EXECUTE iam_staff_owner '
  'seul. US-124 (ADR-107).';
COMMENT ON FUNCTION core.catalog_vehicle_claim_dossier(uuid, text) IS
  'Dossier d''une contestation vu par l''ops (C2 ; journalisé par la console). SECURITY DEFINER, '
  'EXECUTE iam_staff_owner seul. US-124 (BOARD N-61).';
COMMENT ON FUNCTION core.catalog_vehicle_claim_decide(uuid, text, uuid, text, text, text) IS
  'Décision sur une contestation : UPHOLD libère le véhicule en cause, DISMISS motivé. SECURITY '
  'DEFINER, EXECUTE iam_staff_owner seul. US-124 (BOARD N-61).';

REVOKE ALL ON FUNCTION
  core.catalog_cmd_declare_vehicle(bytea, uuid, uuid, text, boolean, integer),
  core.catalog_vehicle_document_permitted(bytea, uuid, uuid),
  core.catalog_cmd_add_vehicle_document(bytea, uuid, uuid, uuid, text, text, bigint, bytea, date),
  core.catalog_cmd_submit_vehicle_eligibility(bytea, uuid, uuid),
  core.catalog_host_vehicle_eligibility(bytea, uuid),
  core.catalog_vehicle_publishable(uuid),
  core.catalog_vehicle_claim_permitted(bytea, uuid, text, text),
  core.catalog_cmd_open_vehicle_claim(bytea, uuid, text, text, uuid, text, bigint, bytea),
  core.catalog_host_vehicle_claims(bytea, uuid),
  core.catalog_public_host_name(uuid),
  core.catalog_vehicle_dossier(uuid, text),
  core.catalog_vehicle_file(text, uuid, text, uuid),
  core.catalog_vehicle_decide(uuid, text, uuid, text, jsonb, jsonb, uuid),
  core.catalog_vehicle_claim_dossier(uuid, text),
  core.catalog_vehicle_claim_decide(uuid, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.catalog_cmd_declare_vehicle(bytea, uuid, uuid, text, boolean, integer),
  core.catalog_vehicle_document_permitted(bytea, uuid, uuid),
  core.catalog_cmd_add_vehicle_document(bytea, uuid, uuid, uuid, text, text, bigint, bytea, date),
  core.catalog_cmd_submit_vehicle_eligibility(bytea, uuid, uuid),
  core.catalog_host_vehicle_eligibility(bytea, uuid),
  core.catalog_vehicle_claim_permitted(bytea, uuid, text, text),
  core.catalog_cmd_open_vehicle_claim(bytea, uuid, text, text, uuid, text, bigint, bytea),
  core.catalog_host_vehicle_claims(bytea, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION core.catalog_public_host_name(uuid) TO app_api;
GRANT EXECUTE ON FUNCTION core.catalog_vehicle_dossier(uuid, text),
  core.catalog_vehicle_file(text, uuid, text, uuid),
  core.catalog_vehicle_decide(uuid, text, uuid, text, jsonb, jsonb, uuid),
  core.catalog_vehicle_claim_dossier(uuid, text),
  core.catalog_vehicle_claim_decide(uuid, text, uuid, text, text, text) TO iam_staff_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 7. Commandes de la console (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) --------
-- Permission de la file LISTING (`ops.review_listing_host`) EN COURS dans le pays de l'élément ;
-- élément ouvert du sujet attendu pris en charge par l'acteur (ADMIN : sa portée) ; TOTP. Refus
-- journalisés (STAFF_ACCESS_DENIED, STAFF_FORBIDDEN) ; issues communes : AUTH_REQUIRED,
-- MFA_REQUIRED, CASE_REQUIRED, FORBIDDEN. Chaque lecture de donnée personnelle (plaque, VIN, noms,
-- pièce) est journalisée (data_access_log READ_C2_SUPPORT puis STAFF_DATA_ACCESS) AVANT d'être
-- rendue ; un motif (`purpose`, 10 à 500 caractères) est exigé.
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- Garde commune : rend (refus, rôle, sujet, pays). Refus journalisé ici.
CREATE FUNCTION core.support_staff_vehicle_item(p_user uuid, p_item_id uuid, p_subject_type text,
                                                p_attempted text, p_request_id uuid,
                                                OUT refusal text, OUT role text,
                                                OUT subject_id uuid, OUT country_code text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_item   record;
  v_reason text;
BEGIN
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id,
         q.permission_code
    INTO v_item
    FROM core.support_review_queue_item AS i
    JOIN core.support_review_queue AS q ON q.queue = i.queue
   WHERE i.id = p_item_id
     FOR UPDATE OF i;
  IF v_item.id IS NOT NULL THEN
    role := core.iam_staff_permitted(p_user, v_item.permission_code, ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'SUBJECT_NOT_FOUND'
    WHEN v_item.queue <> 'LISTING' OR v_item.subject_type <> p_subject_type THEN 'CASE'
    WHEN role IS NULL THEN 'PERMISSION'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM p_user THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(p_user, COALESCE(role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', p_attempted)
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 NULL, p_request_id);
    refusal := CASE WHEN role IS NOT NULL AND v_reason = 'CASE' THEN 'CASE_REQUIRED'
                    ELSE 'FORBIDDEN' END;
    RETURN;
  END IF;
  subject_id := v_item.subject_id;
  country_code := v_item.country_code;
END
$fn$;
REVOKE ALL ON FUNCTION core.support_staff_vehicle_item(uuid, uuid, text, text, uuid) FROM PUBLIC;

-- Session, TOTP et garde ; rend (refus, utilisateur, rôle, sujet, pays).
CREATE FUNCTION core.support_staff_vehicle_gate(p_token_hash bytea, p_item_id uuid,
                                                p_subject_type text, p_attempted text,
                                                p_request_id uuid,
                                                OUT refusal text, OUT user_id uuid, OUT role text,
                                                OUT subject_id uuid, OUT country_code text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s record;
  v_g record;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    refusal := 'AUTH_REQUIRED';
    RETURN;
  END IF;
  user_id := v_s.user_id;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', p_attempted), NULL, p_request_id);
    refusal := 'MFA_REQUIRED';
    RETURN;
  END IF;
  SELECT * INTO v_g FROM core.support_staff_vehicle_item(v_s.user_id, p_item_id, p_subject_type,
                                                          p_attempted, p_request_id);
  refusal := v_g.refusal;
  role := v_g.role;
  subject_id := v_g.subject_id;
  country_code := v_g.country_code;
END
$fn$;
REVOKE ALL ON FUNCTION core.support_staff_vehicle_gate(bytea, uuid, text, text, uuid) FROM PUBLIC;

-- Noms légaux d'une personne (C2), pour le rapprochement du titre ; titulaire d'un compte d'hôte.
CREATE FUNCTION core.support_staff_legal_names(p_user uuid)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.jsonb_build_object('userId', u.id, 'legalFirstName', u.legal_first_name,
                                       'legalLastName', u.legal_last_name)
    FROM core.iam_user_account AS u WHERE u.id = p_user
$fn$;
CREATE FUNCTION core.support_staff_org_holder_names(p_org uuid)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.support_staff_legal_names(o.holder_user_id)
    FROM core.iam_organization AS o WHERE o.id = p_org
$fn$;
REVOKE ALL ON FUNCTION core.support_staff_legal_names(uuid),
  core.support_staff_org_holder_names(uuid) FROM PUBLIC;

-- 7.1 Dossier d'un véhicule en revue (lecture journalisée). Issues : GRANTED, NOT_UNDER_REVIEW
-- (aucun véhicule derrière l'élément), PURPOSE_REQUIRED et les issues communes.
CREATE FUNCTION core.support_staff_vehicle_eligibility(p_token_hash bytea, p_request_id uuid,
                                                       p_item_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_g    record;
  v_body jsonb;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'revue du véhicule : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_g FROM core.support_staff_vehicle_gate(p_token_hash, p_item_id, 'VEHICLE',
                                                          'VEHICLE_ELIGIBILITY_READ', p_request_id);
  IF v_g.refusal IS NOT NULL THEN
    RETURN QUERY SELECT v_g.refusal, NULL::jsonb;
    RETURN;
  END IF;
  IF p_purpose IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_purpose)) NOT BETWEEN 10 AND 500 THEN
    RETURN QUERY SELECT 'PURPOSE_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  v_body := core.catalog_vehicle_dossier(v_g.subject_id, v_g.country_code);
  IF v_body IS NULL THEN
    RETURN QUERY SELECT 'NOT_UNDER_REVIEW'::text, NULL::jsonb;
    RETURN;
  END IF;
  -- journal AVANT la donnée
  PERFORM core.support_staff_log_access(v_g.user_id, v_g.role, 'VEHICLE', v_g.subject_id,
                                        'vehicle.eligibility_dossier', 'READ_C2_SUPPORT',
                                        pg_catalog.btrim(p_purpose), 'item:' || p_item_id::text,
                                        p_request_id, v_g.country_code);
  RETURN QUERY SELECT 'GRANTED'::text,
    v_body || pg_catalog.jsonb_build_object(
      'itemId', p_item_id,
      'holder', core.support_staff_org_holder_names((v_body ->> 'orgId')::uuid));
END
$fn$;

-- 7.2 Fichier d'une pièce couvert par l'élément (VEHICLE ou VEHICLE_CLAIM) : journalisé AVANT,
-- rend la clé de stockage, le type, la taille et la personne de la clé (l'application lit puis
-- déchiffre). Issues : GRANTED, FILE_NOT_FOUND, PURPOSE_REQUIRED et les issues communes.
CREATE FUNCTION core.support_staff_vehicle_file(p_token_hash bytea, p_request_id uuid,
                                                p_item_id uuid, p_subject_type text,
                                                p_file_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_g record;
  v_f record;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR p_file_id IS NULL
     OR p_subject_type IS NULL OR p_subject_type NOT IN ('VEHICLE', 'VEHICLE_CLAIM') THEN
    RAISE EXCEPTION 'pièce du véhicule : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_g FROM core.support_staff_vehicle_gate(p_token_hash, p_item_id, p_subject_type,
                                                          'VEHICLE_DOCUMENT_READ', p_request_id);
  IF v_g.refusal IS NOT NULL THEN
    RETURN QUERY SELECT v_g.refusal, NULL::jsonb;
    RETURN;
  END IF;
  IF p_purpose IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_purpose)) NOT BETWEEN 10 AND 500 THEN
    RETURN QUERY SELECT 'PURPOSE_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_f FROM core.catalog_vehicle_file(p_subject_type, v_g.subject_id, v_g.country_code,
                                                    p_file_id);
  IF v_f.storage_key IS NULL THEN
    RETURN QUERY SELECT 'FILE_NOT_FOUND'::text, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM core.support_staff_log_access(v_g.user_id, v_g.role, p_subject_type, v_g.subject_id,
                                        'file:' || p_file_id::text, 'READ_C2_SUPPORT',
                                        pg_catalog.btrim(p_purpose), 'item:' || p_item_id::text,
                                        p_request_id, v_g.country_code);
  RETURN QUERY SELECT 'GRANTED'::text, pg_catalog.jsonb_build_object(
    'fileId', p_file_id, 'storageKey', v_f.storage_key, 'mime', v_f.mime, 'bytes', v_f.bytes,
    'subjectUserId', v_f.subject_user_id);
END
$fn$;

-- 7.3 Décision sur un véhicule en revue : fonction de domaine, clôture de l'élément (DONE, décision
-- = résultat calculé) et journal chaîné (codes seulement), dans la même instruction. Issues :
-- DECIDED, NOT_UNDER_REVIEW, CHECKLIST_INVALID et les issues communes.
CREATE FUNCTION core.support_staff_decide_vehicle_eligibility(p_token_hash bytea,
                                                              p_request_id uuid, p_item_id uuid,
                                                              p_checklist jsonb, p_documents jsonb)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_g record;
  v_r record;
  v_c record;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'revue du véhicule : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_g FROM core.support_staff_vehicle_gate(p_token_hash, p_item_id, 'VEHICLE',
                                                          'VEHICLE_ELIGIBILITY_DECIDE', p_request_id);
  IF v_g.refusal IS NOT NULL THEN
    RETURN QUERY SELECT v_g.refusal, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_r FROM core.catalog_vehicle_decide(v_g.subject_id, v_g.country_code, v_g.user_id,
                                                      v_g.role, p_checklist, p_documents, p_item_id);
  IF v_r.outcome = 'COUNTRY_MISMATCH' THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_r.outcome <> 'DECIDED' THEN
    RETURN QUERY SELECT v_r.outcome, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_c FROM core.support_close_review_item(p_item_id, 'DONE', v_r.result, v_g.user_id);
  IF v_c.outcome <> 'CLOSED' THEN
    RAISE EXCEPTION 'revue du véhicule : élément non clos' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- journal EN DERNIER (passation US-009) ; codes seulement, jamais la plaque ni le VIN
  PERFORM core.iam_staff_audit(v_g.user_id, v_g.role, 'VEHICLE_ELIGIBILITY_DECIDED', 'VEHICLE',
                               v_g.subject_id, NULL,
                               pg_catalog.jsonb_build_object('country', v_g.country_code,
                                 'result', v_r.result, 'reasons', pg_catalog.to_jsonb(v_r.reasons),
                                 'checklist', p_checklist, 'itemId', p_item_id),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'DECIDED'::text, pg_catalog.jsonb_build_object(
    'itemId', p_item_id, 'vehicleId', v_g.subject_id, 'result', v_r.result,
    'reasons', pg_catalog.to_jsonb(v_r.reasons));
END
$fn$;

-- 7.4 Dossier d'une contestation (lecture journalisée) : demandeur et titulaire du véhicule en
-- cause avec leurs noms légaux. Issues : GRANTED, NOT_OPEN, PURPOSE_REQUIRED et les communes.
CREATE FUNCTION core.support_staff_vehicle_claim(p_token_hash bytea, p_request_id uuid,
                                                 p_item_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_g    record;
  v_body jsonb;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL THEN
    RAISE EXCEPTION 'contestation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_g FROM core.support_staff_vehicle_gate(p_token_hash, p_item_id, 'VEHICLE_CLAIM',
                                                          'VEHICLE_CLAIM_READ', p_request_id);
  IF v_g.refusal IS NOT NULL THEN
    RETURN QUERY SELECT v_g.refusal, NULL::jsonb;
    RETURN;
  END IF;
  IF p_purpose IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_purpose)) NOT BETWEEN 10 AND 500 THEN
    RETURN QUERY SELECT 'PURPOSE_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  v_body := core.catalog_vehicle_claim_dossier(v_g.subject_id, v_g.country_code);
  IF v_body IS NULL THEN
    RETURN QUERY SELECT 'NOT_OPEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM core.support_staff_log_access(v_g.user_id, v_g.role, 'VEHICLE_CLAIM', v_g.subject_id,
                                        'vehicle_claim.dossier', 'READ_C2_SUPPORT',
                                        pg_catalog.btrim(p_purpose), 'item:' || p_item_id::text,
                                        p_request_id, v_g.country_code);
  RETURN QUERY SELECT 'GRANTED'::text,
    v_body || pg_catalog.jsonb_build_object(
      'itemId', p_item_id,
      'claimant', core.support_staff_legal_names((v_body ->> 'claimantUserId')::uuid),
      'targetHolder', core.support_staff_org_holder_names((v_body -> 'target' ->> 'orgId')::uuid));
END
$fn$;

-- 7.5 Décision sur une contestation : UPHOLD réservé à l'ADMIN (PROPOSÉ : libérer le véhicule d'un
-- autre hôte), DISMISS motivé ; élément clos ; l'élément vivant de revue du véhicule libéré est
-- annulé ; journal chaîné. Issues : DECIDED, NOT_OPEN, CLAIM_REASON_INVALID, ADMIN_REQUIRED et les
-- issues communes.
CREATE FUNCTION core.support_staff_decide_vehicle_claim(p_token_hash bytea, p_request_id uuid,
                                                        p_item_id uuid, p_decision text,
                                                        p_reason text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_g    record;
  v_r    record;
  v_c    record;
  v_live uuid;
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR p_decision IS NULL
     OR p_decision NOT IN ('UPHOLD', 'DISMISS') THEN
    RAISE EXCEPTION 'contestation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_g FROM core.support_staff_vehicle_gate(p_token_hash, p_item_id, 'VEHICLE_CLAIM',
                                                          'VEHICLE_CLAIM_DECIDE', p_request_id);
  IF v_g.refusal IS NOT NULL THEN
    RETURN QUERY SELECT v_g.refusal, NULL::jsonb;
    RETURN;
  END IF;
  IF p_decision = 'UPHOLD' AND v_g.role <> 'ADMIN' THEN
    PERFORM core.iam_staff_audit(v_g.user_id, v_g.role, 'STAFF_FORBIDDEN', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', 'ADMIN_REQUIRED',
                                   'attempted', 'VEHICLE_CLAIM_UPHOLD',
                                   'country', v_g.country_code),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'ADMIN_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_r FROM core.catalog_vehicle_claim_decide(v_g.subject_id, v_g.country_code,
                                                            v_g.user_id, v_g.role, p_decision,
                                                            p_reason);
  IF v_r.outcome = 'COUNTRY_MISMATCH' THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_r.outcome <> 'DECIDED' THEN
    RETURN QUERY SELECT v_r.outcome, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_c FROM core.support_close_review_item(p_item_id, 'DONE', v_r.status, v_g.user_id);
  IF v_c.outcome <> 'CLOSED' THEN
    RAISE EXCEPTION 'contestation : élément non clos' USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- véhicule libéré : sa revue vivante n'a plus d'objet
  IF v_r.status = 'UPHELD' THEN
    SELECT i.id INTO v_live FROM core.support_review_queue_item AS i
     WHERE i.queue = 'LISTING' AND i.subject_type = 'VEHICLE' AND i.subject_id = v_r.target_vehicle_id
       AND i.status IN ('OPEN', 'IN_REVIEW');
    IF v_live IS NOT NULL THEN
      PERFORM core.support_close_review_item(v_live, 'CANCELLED', 'RELEASED', v_g.user_id);
    END IF;
  END IF;
  PERFORM core.iam_staff_audit(v_g.user_id, v_g.role, 'VEHICLE_CLAIM_DECIDED', 'VEHICLE_CLAIM',
                               v_g.subject_id, pg_catalog.jsonb_build_object('status', 'OPEN'),
                               pg_catalog.jsonb_build_object('country', v_g.country_code,
                                 'status', v_r.status, 'reason', p_reason,
                                 'targetVehicleId', v_r.target_vehicle_id, 'itemId', p_item_id),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'DECIDED'::text, pg_catalog.jsonb_build_object(
    'itemId', p_item_id, 'claimId', v_g.subject_id, 'status', v_r.status);
END
$fn$;

COMMENT ON FUNCTION core.support_staff_vehicle_item(uuid, uuid, text, text, uuid) IS
  'Garde des commandes de revue du véhicule : élément LISTING ouvert du sujet attendu, permission '
  'de la file dans son pays, pris en charge par l''acteur (ADMIN : sa portée) ; refus journalisé. '
  'Aide interne sous iam_staff_owner. US-124 (ADR-107).';
COMMENT ON FUNCTION core.support_staff_vehicle_gate(bytea, uuid, text, text, uuid) IS
  'Session, TOTP et garde des commandes de revue du véhicule. Aide interne. US-124 (ADR-107).';
COMMENT ON FUNCTION core.support_staff_legal_names(uuid) IS
  'Noms légaux d''une personne (C2), rendus seulement après journalisation. Aide interne. US-124.';
COMMENT ON FUNCTION core.support_staff_org_holder_names(uuid) IS
  'Noms légaux du titulaire d''un compte d''hôte (C2), après journalisation. Aide interne. US-124.';
COMMENT ON FUNCTION core.support_staff_vehicle_eligibility(bytea, uuid, uuid, text) IS
  'Dossier d''un véhicule en revue (plaque, VIN, pièces, titulaire) ; lecture journalisée avant '
  'd''être rendue. SECURITY DEFINER, EXECUTE app_api. US-124 (ADR-107).';
COMMENT ON FUNCTION core.support_staff_vehicle_file(bytea, uuid, uuid, text, uuid, text) IS
  'Accès au fichier d''une pièce couvert par l''élément ; journalisé avant d''être rendu. SECURITY '
  'DEFINER, EXECUTE app_api. US-124 (ADR-107).';
COMMENT ON FUNCTION core.support_staff_decide_vehicle_eligibility(bytea, uuid, uuid, jsonb, jsonb) IS
  'Décision de l''ops sur un véhicule (liste de contrôle fermée, verdict par pièce, résultat '
  'calculé), élément clos, journal chaîné. SECURITY DEFINER, EXECUTE app_api. US-124 (ADR-107).';
COMMENT ON FUNCTION core.support_staff_vehicle_claim(bytea, uuid, uuid, text) IS
  'Dossier d''une contestation de plaque ou de VIN ; lecture journalisée. SECURITY DEFINER, '
  'EXECUTE app_api. US-124 (BOARD N-61).';
COMMENT ON FUNCTION core.support_staff_decide_vehicle_claim(bytea, uuid, uuid, text, text) IS
  'Décision sur une contestation (UPHOLD : ADMIN seul, libère le véhicule en cause ; DISMISS '
  'motivé), élément clos, journal chaîné. SECURITY DEFINER, EXECUTE app_api. US-124 (BOARD N-61).';
REVOKE ALL ON FUNCTION core.support_staff_vehicle_eligibility(bytea, uuid, uuid, text),
  core.support_staff_vehicle_file(bytea, uuid, uuid, text, uuid, text),
  core.support_staff_decide_vehicle_eligibility(bytea, uuid, uuid, jsonb, jsonb),
  core.support_staff_vehicle_claim(bytea, uuid, uuid, text),
  core.support_staff_decide_vehicle_claim(bytea, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_vehicle_eligibility(bytea, uuid, uuid, text),
  core.support_staff_vehicle_file(bytea, uuid, uuid, text, uuid, text),
  core.support_staff_decide_vehicle_eligibility(bytea, uuid, uuid, jsonb, jsonb),
  core.support_staff_vehicle_claim(bytea, uuid, uuid, text),
  core.support_staff_decide_vehicle_claim(bytea, uuid, uuid, text, text) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
