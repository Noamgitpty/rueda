-- 0083 — CAT : numéro de châssis en deux formats (VIN ISO 3779 ou numéro non ISO) et historique des engagements de l'hôte.
-- US-124, correctif de la seconde passe des revues (code 3, architecture 4, ux 3, qa 6, sécurité 5) ;
-- 08 BR-LIST-04 ; 16 HST-011, HST-019 ; 19 US-124 ; DEC-FONDATEUR-22 (« jamais plus lourd que
-- Turo ») ; ADR-107 et ADR-113 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- 1. Numéro de châssis : deux formats acceptés, sans constante d'année ni de pays.
--    - VIN ISO 3779 : 17 caractères, ni I, ni O, ni Q. Le chiffre de contrôle (position 9) n'est
--      pas vérifié : il n'est obligatoire qu'en Amérique du Nord, pas au Panama ni au Paraguay.
--    - Numéro non ISO (châssis court d'une importation japonaise, « GRJ150-0012345 ») : 5 à 16
--      lettres ou chiffres une fois normalisé.
--    Normalisation inchangée (core.catalog_normalize_vin, 0067) : majuscules, sans espace ni tiret.
--    Unicité (index catalog_vehicle_vin_unique) et contestation N-61 valent donc pour les deux
--    formats, quelle que soit la saisie (casse, espaces, tirets). Un numéro de 17 caractères est
--    lu comme un VIN ISO : avec I, O ou Q, il est refusé.
--    La règle « VIN ISO exigé à partir de 1981 », codée en dur en 0067 et 0077, disparaît : la
--    contrainte catalog_vehicle_vin_iso est recréée sous son nom sans l'année, la création et la
--    déclaration répondent `VEHICLE_VIN_INVALID` (message dédié) au lieu de
--    `VEHICLE_FIELD_REQUIRED`, et le numéro est exigé à la soumission pour tout véhicule (tout
--    véhicule porte un numéro de châssis, au format ISO ou non).
-- 2. Engagements de l'hôte (« propriétaire ou autorisé », « non gagé ou accord du créancier ») :
--    chaque engagement pris est AJOUTÉ à core.catalog_vehicle_attestation, avec la version du
--    catalogue, la langue et le libellé exact affiché (comme le consentement versionné des CGU,
--    US-102 / US-126) ; les colonnes *_attested_at du véhicule gardent le dernier engagement.
--    Nouvelle signature de core.catalog_cmd_declare_vehicle (libellé et version) ; l'ancienne
--    signature reste servie (version N de l'API) et ajoute l'engagement sans libellé connu.
--
-- Expand / contract : table, fonctions et droits ajoutés ; contrainte catalog_vehicle_vin_iso
-- supprimée puis recréée sous le même nom (relâchée : plus d'année, châssis non ISO admis) ; corps
-- de core.catalog_vehicle_blockers, core.catalog_cmd_create_vehicle et de l'ancienne signature de
-- core.catalog_cmd_declare_vehicle remplacés à signature, propriétaire et droits identiques.
-- L'issue nouvelle `VEHICLE_VIN_INVALID` est rendue par la version N de l'API en 503
-- (`LISTING_UNAVAILABLE`, issue inconnue) : aucune écriture, jamais une acceptation.
--
-- Retour arrière :
--   réappliquer core.catalog_vehicle_blockers, core.catalog_cmd_create_vehicle et
--     core.catalog_cmd_declare_vehicle (9 arguments) de 0077 ; recréer catalog_vehicle_vin_iso de
--     0067 (seulement si aucun numéro non ISO d'un véhicule de 1981 ou après n'est enregistré) ;
--   DROP FUNCTION core.catalog_cmd_declare_vehicle(bytea, uuid, uuid, text, boolean, integer,
--     boolean, boolean, text, text, integer, text, text), core.catalog_vehicle_declare(bytea, uuid,
--     uuid, text, boolean, integer, boolean, boolean, text, text, integer, text, text),
--     core.catalog_vin_kind(text) ;
--   DROP TABLE core.catalog_vehicle_attestation.

-- 1. Numéro de châssis -----------------------------------------------------------------------------
-- Format d'un numéro DÉJÀ normalisé : ISO_3779, CHASSIS (non ISO) ou NULL (refusé).
CREATE FUNCTION core.catalog_vin_kind(p_vin text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN p_vin ~ '^[A-HJ-NPR-Z0-9]{17}$' THEN 'ISO_3779'
              WHEN p_vin ~ '^[A-Z0-9]{5,16}$' THEN 'CHASSIS'
         END
$fn$;
COMMENT ON FUNCTION core.catalog_vin_kind(text) IS
  'Format d''un numéro de châssis normalisé : ISO_3779 (17 caractères sans I, O, Q ; chiffre de '
  'contrôle non vérifié), CHASSIS (5 à 16 lettres ou chiffres, non ISO), sinon NULL. US-124 (ADR-113).';
REVOKE ALL ON FUNCTION core.catalog_vin_kind(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_vin_kind(text) TO catalog_cmd_owner;

-- Filet de la table : les deux mêmes formats, sans année (recréée sous son nom).
ALTER TABLE core.catalog_vehicle DROP CONSTRAINT catalog_vehicle_vin_iso;
ALTER TABLE core.catalog_vehicle ADD CONSTRAINT catalog_vehicle_vin_iso
  CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$' OR vin ~ '^[A-Z0-9]{5,16}$');
COMMENT ON CONSTRAINT catalog_vehicle_vin_iso ON core.catalog_vehicle IS
  'Numéro de châssis normalisé : VIN ISO 3779 (17 caractères sans I, O, Q) ou numéro non ISO de '
  '5 à 16 caractères ; aucune année ni aucun pays (ADR-113). US-124.';

-- 2. Historique des engagements de l'hôte (ajout seul) --------------------------------------------
CREATE TABLE core.catalog_vehicle_attestation (
  id              uuid        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  vehicle_id      uuid        NOT NULL,
  org_id          uuid        NOT NULL,
  country_code    text        NOT NULL
                  CONSTRAINT catalog_vehicle_attestation_country_format
                  CHECK (country_code ~ '^[A-Z]{2}$'),
  user_id         uuid        NOT NULL REFERENCES core.iam_user_account (id),
  statement       text        NOT NULL
                  CONSTRAINT catalog_vehicle_attestation_statement_valid
                  CHECK (statement IN ('OWNERSHIP', 'LIEN')),
  -- clé du catalogue @rueda/i18n du libellé coché
  statement_key   text        NOT NULL
                  CONSTRAINT catalog_vehicle_attestation_key_valid
                  CHECK (statement_key IN ('web.vehicleDocs.declaration.owner',
                                           'web.vehicleDocs.declaration.lienOk')),
  -- version du catalogue, langue et libellé exact affichés ; NULL ensemble : ancienne signature
  -- de la commande (version N de l'API, libellé inconnu)
  catalog_version integer
                  CONSTRAINT catalog_vehicle_attestation_version_range
                  CHECK (catalog_version BETWEEN 1 AND 999999),
  locale          text
                  CONSTRAINT catalog_vehicle_attestation_locale_valid
                  CHECK (locale IN ('es', 'en', 'fr', 'pt')),
  statement_text  text
                  CONSTRAINT catalog_vehicle_attestation_text_valid
                  CHECK (pg_catalog.btrim(statement_text) <> ''
                         AND pg_catalog.char_length(statement_text) <= 500),
  attested_at     timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT catalog_vehicle_attestation_vehicle_fk FOREIGN KEY (vehicle_id, org_id, country_code)
    REFERENCES core.catalog_vehicle (id, org_id, country_code),
  CONSTRAINT catalog_vehicle_attestation_key_matches CHECK (
    (statement = 'OWNERSHIP') = (statement_key = 'web.vehicleDocs.declaration.owner')),
  CONSTRAINT catalog_vehicle_attestation_wording CHECK (
    (catalog_version IS NULL) = (locale IS NULL) AND (locale IS NULL) = (statement_text IS NULL))
);
CREATE INDEX catalog_vehicle_attestation_vehicle_idx ON core.catalog_vehicle_attestation
  (vehicle_id, attested_at);
CREATE TRIGGER catalog_vehicle_attestation_append_only
  BEFORE UPDATE OR DELETE ON core.catalog_vehicle_attestation
  FOR EACH ROW EXECUTE FUNCTION core.catalog_vehicle_no_delete();
CREATE TRIGGER catalog_vehicle_attestation_no_truncate
  BEFORE TRUNCATE ON core.catalog_vehicle_attestation
  FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_vehicle_no_delete();
COMMENT ON TABLE core.catalog_vehicle_attestation IS
  'CAT : engagements horodatés de l''hôte sur un véhicule (propriétaire ou autorisé ; non gagé ou '
  'accord du créancier), un par engagement pris, avec la version du catalogue, la langue et le '
  'libellé exact affichés ; ajout seul, jamais modifié ni supprimé. US-124 (ADR-113).';

ALTER TABLE core.catalog_vehicle_attestation ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_vehicle_attestation FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.catalog_vehicle_attestation TO migrator
  USING (true) WITH CHECK (true);
REVOKE ALL ON core.catalog_vehicle_attestation FROM PUBLIC;
GRANT SELECT, INSERT ON core.catalog_vehicle_attestation TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_insert ON core.catalog_vehicle_attestation FOR INSERT
  TO catalog_cmd_owner WITH CHECK (true);
CREATE POLICY catalog_cmd_read ON core.catalog_vehicle_attestation FOR SELECT
  TO catalog_cmd_owner USING (true);

-- 3. Motifs de la soumission : numéro de châssis exigé quelle que soit l'année (corps de 0077,
-- sans la constante 1981 ; propriétaire et droits inchangés)
CREATE OR REPLACE FUNCTION core.catalog_vehicle_blockers(p_vehicle uuid, p_strict boolean)
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
         x.lien_declared, x.released_at, x.vin, x.ownership_attested_at, x.lien_attested_at
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
  -- plaque et numéro de châssis saisis (VIN ISO 3779 ou numéro non ISO, quelle que soit l'année :
  -- tout véhicule en porte un ; ADR-113), compteur et titulaire déclarés
  IF v.odometer_km IS NULL OR v.title_holder IS NULL OR v.vin IS NULL THEN
    r := r || 'VEHICLE_FIELD_REQUIRED'::text;
  ELSIF v.odometer_km >= v_km THEN
    -- 08 BR-LIST-02 [NOUS] « < 200 000 km » : le plafond lui-même est refusé
    r := r || 'VEHICLE_MILEAGE_TOO_HIGH'::text;
  END IF;
  -- titre : l'hôte déclare être propriétaire ou autorisé par lui (08 BR-LIST-01, OQ-P2P-02) ;
  -- l'autorisation notariée n'est exigée que si le pays l'impose (elig_doc_owner_authorization)
  IF v.ownership_attested_at IS NULL
     OR (v.title_holder = 'THIRD_PARTY'
         AND core.catalog_document_required('OWNER_AUTHORIZATION', v.country_code)
         AND core.catalog_document_state(p_vehicle, 'OWNER_AUTHORIZATION', p_strict, v_today) <> 'OK') THEN
    r := r || 'VEHICLE_TITLE_MISMATCH'::text;
  END IF;
  -- véhicule financé : accord du créancier DÉCLARÉ (OQ-BR-28 ; paramètre absent ⇒ exigé) ; le
  -- document du créancier seulement si le pays l'impose (elig_doc_lender_consent)
  v_lender := COALESCE(core.catalog_param_bool('vehicle_financed_requires_lender_consent',
                                               v.country_code), true);
  IF v.lien_declared AND v_lender
     AND (v.lien_attested_at IS NULL
          OR (core.catalog_document_required('LENDER_CONSENT', v.country_code)
              AND core.catalog_document_state(p_vehicle, 'LENDER_CONSENT', p_strict, v_today) <> 'OK')) THEN
    r := r || 'VEHICLE_LENDER_CONSENT_REQUIRED'::text;
  END IF;
  -- pièces exigées par le pays (aucune par défaut)
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

-- 4. Commandes de l'hôte (SECURITY DEFINER, catalog_cmd_owner) -----------------------------------
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

-- 4.1 Véhicule (corps de 0077 recopié ; numéro de châssis au format ISO ou non ISO, sans année ;
-- refus dédié VEHICLE_VIN_INVALID)
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
     OR p_year IS NULL OR p_year NOT BETWEEN 1950 AND 2100
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
  -- numéro de châssis saisi : VIN ISO 3779 ou numéro non ISO (importation japonaise), sinon refus
  -- dédié (ADR-113)
  IF p_vin IS NOT NULL AND core.catalog_vin_kind(v_vin) IS NULL THEN
    RETURN QUERY SELECT 'VEHICLE_VIN_INVALID'::text, NULL::uuid;
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
  'Véhicule de l''hôte : plaque et numéro de châssis (VIN ISO 3779 ou non ISO) uniques parmi les '
  'véhicules non libérés, variante du marché du compte ; hors catalogue : demande d''ajout et '
  'élément de file dans la même instruction. SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099) ; '
  'US-114 (ADR-104) ; US-124 (ADR-107, ADR-113).';

-- 4.2 Déclarations et engagements de l'hôte (corps de 0077 étendu). Aide interne commune aux deux
-- signatures de la commande ; libellé (langue, version, textes) NULL : ancienne signature.
-- Issues : DONE, VEHICLE_FIELD_REQUIRED (champ manquant, VIN enregistré différent),
-- VEHICLE_VIN_INVALID (format), VEHICLE_PLATE_DUPLICATE (numéro pris) et celles de
-- catalog_vehicle_writable.
CREATE FUNCTION core.catalog_vehicle_declare(p_token_hash bytea, p_org uuid, p_vehicle uuid,
                                             p_title_holder text, p_lien_declared boolean,
                                             p_odometer_km integer,
                                             p_ownership_attested boolean,
                                             p_lien_attested boolean, p_vin text,
                                             p_locale text, p_catalog_version integer,
                                             p_ownership_text text, p_lien_text text)
  RETURNS TABLE (outcome text, vehicle_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  w      record;
  v_cur  record;
  v_vin  text := core.catalog_normalize_vin(p_vin);
  v_now  timestamptz := platform.now();
  v_lien boolean := COALESCE(p_lien_declared AND COALESCE(p_lien_attested, false), false);
BEGIN
  SELECT * INTO w FROM core.catalog_vehicle_writable(p_token_hash, p_org, p_vehicle);
  IF w.outcome <> 'OK' THEN
    RETURN QUERY SELECT w.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT x.vin INTO v_cur FROM core.catalog_vehicle AS x WHERE x.id = p_vehicle;
  IF p_title_holder IS NULL OR p_title_holder NOT IN ('HOST', 'THIRD_PARTY')
     OR p_lien_declared IS NULL OR p_ownership_attested IS NULL
     OR p_odometer_km IS NULL OR p_odometer_km NOT BETWEEN 0 AND 3000000
     OR (p_vin IS NOT NULL AND v_cur.vin IS NOT NULL AND v_vin IS DISTINCT FROM v_cur.vin) THEN
    -- le numéro déjà enregistré ne se change pas ici (contestation N-61 si un autre l'a pris)
    RETURN QUERY SELECT 'VEHICLE_FIELD_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- numéro saisi : VIN ISO 3779 ou numéro non ISO, sinon refus dédié (ADR-113)
  IF p_vin IS NOT NULL AND core.catalog_vin_kind(v_vin) IS NULL THEN
    RETURN QUERY SELECT 'VEHICLE_VIN_INVALID'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_vin IS NOT NULL AND v_cur.vin IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cat.vin:' || v_vin, 0));
    IF EXISTS (SELECT 1 FROM core.catalog_vehicle AS x
                WHERE x.released_at IS NULL AND x.vin = v_vin AND x.id <> p_vehicle) THEN
      RETURN QUERY SELECT 'VEHICLE_PLATE_DUPLICATE'::text, NULL::uuid;
      RETURN;
    END IF;
  END IF;
  BEGIN
    UPDATE core.catalog_vehicle AS x
       SET title_holder = p_title_holder, lien_declared = p_lien_declared,
           odometer_km = p_odometer_km, eligibility_status = 'PENDING',
           vin = COALESCE(x.vin, v_vin),
           ownership_attested_at = CASE WHEN p_ownership_attested THEN v_now END,
           lien_attested_at = CASE WHEN v_lien THEN v_now END
     WHERE x.id = p_vehicle;
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'VEHICLE_PLATE_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END;
  -- un engagement pris = une ligne de l'historique, jamais réécrite (libellé exact affiché)
  INSERT INTO core.catalog_vehicle_attestation (vehicle_id, org_id, country_code, user_id,
                                                statement, statement_key, catalog_version, locale,
                                                statement_text, attested_at)
  SELECT p_vehicle, p_org, w.country_code, w.user_id, s.kind, s.msg_key, p_catalog_version,
         p_locale, s.wording, v_now
    FROM (VALUES ('OWNERSHIP', 'web.vehicleDocs.declaration.owner', p_ownership_text,
                  p_ownership_attested),
                 ('LIEN', 'web.vehicleDocs.declaration.lienOk', p_lien_text, v_lien))
         AS s(kind, msg_key, wording, taken)
   WHERE s.taken;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (w.user_id, 'P2P_HOST', 'VEHICLE_DECLARATION_SAVED', 'VEHICLE', p_vehicle,
          pg_catalog.jsonb_build_object('eligibilityStatus', w.eligibility_status),
          pg_catalog.jsonb_build_object('orgId', p_org, 'country', w.country_code,
                                        'titleHolder', p_title_holder,
                                        'lienDeclared', p_lien_declared,
                                        'ownershipAttested', p_ownership_attested,
                                        'lienAttested', COALESCE(p_lien_attested, false),
                                        'catalogVersion', p_catalog_version,
                                        'locale', p_locale,
                                        'countries', pg_catalog.jsonb_build_array(w.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_vehicle;
END
$fn$;
COMMENT ON FUNCTION core.catalog_vehicle_declare(bytea, uuid, uuid, text, boolean, integer, boolean, boolean, text, text, integer, text, text) IS
  'Déclarations de l''hôte et historique de ses engagements (libellé, langue, version du '
  'catalogue) ; aide interne des deux signatures de catalog_cmd_declare_vehicle, sous '
  'catalog_cmd_owner, jamais exécutable par un rôle applicatif. US-124 (ADR-113).';
REVOKE ALL ON FUNCTION core.catalog_vehicle_declare(bytea, uuid, uuid, text, boolean, integer,
  boolean, boolean, text, text, integer, text, text) FROM PUBLIC;

-- 4.3 Commande servie par l'API : libellé AFFICHÉ obligatoire (langue du catalogue, version,
-- textes exacts des deux engagements) ; mal formé : VEHICLE_FIELD_REQUIRED, rien n'est écrit.
CREATE FUNCTION core.catalog_cmd_declare_vehicle(p_token_hash bytea, p_org uuid, p_vehicle uuid,
                                                 p_title_holder text, p_lien_declared boolean,
                                                 p_odometer_km integer,
                                                 p_ownership_attested boolean,
                                                 p_lien_attested boolean, p_vin text,
                                                 p_locale text, p_catalog_version integer,
                                                 p_ownership_text text, p_lien_text text)
  RETURNS TABLE (outcome text, vehicle_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF p_locale IS NULL OR p_locale NOT IN ('es', 'en', 'fr', 'pt')
     OR p_catalog_version IS NULL OR p_catalog_version NOT BETWEEN 1 AND 999999
     OR p_ownership_text IS NULL OR pg_catalog.btrim(p_ownership_text) = ''
     OR pg_catalog.char_length(p_ownership_text) > 500
     OR p_lien_text IS NULL OR pg_catalog.btrim(p_lien_text) = ''
     OR pg_catalog.char_length(p_lien_text) > 500 THEN
    RETURN QUERY SELECT 'VEHICLE_FIELD_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  RETURN QUERY SELECT d.outcome, d.vehicle_id
    FROM core.catalog_vehicle_declare(p_token_hash, p_org, p_vehicle, p_title_holder,
                                      p_lien_declared, p_odometer_km, p_ownership_attested,
                                      p_lien_attested, p_vin, p_locale, p_catalog_version,
                                      p_ownership_text, p_lien_text) AS d;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_declare_vehicle(bytea, uuid, uuid, text, boolean, integer, boolean, boolean, text, text, integer, text, text) IS
  'Déclarations et engagements horodatés de l''hôte, historisés avec le libellé affiché (langue, '
  'version du catalogue) ; numéro de châssis ISO 3779 ou non ISO saisi s''il manquait ; un '
  'véhicule ELIGIBLE redevient PENDING. SECURITY DEFINER, EXECUTE app_api. US-124 (ADR-107, ADR-113).';

-- 4.4 Ancienne signature (version N de l'API) : même règle, engagement historisé sans libellé.
CREATE OR REPLACE FUNCTION core.catalog_cmd_declare_vehicle(p_token_hash bytea, p_org uuid,
                                                            p_vehicle uuid, p_title_holder text,
                                                            p_lien_declared boolean,
                                                            p_odometer_km integer,
                                                            p_ownership_attested boolean,
                                                            p_lien_attested boolean, p_vin text)
  RETURNS TABLE (outcome text, vehicle_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  RETURN QUERY SELECT d.outcome, d.vehicle_id
    FROM core.catalog_vehicle_declare(p_token_hash, p_org, p_vehicle, p_title_holder,
                                      p_lien_declared, p_odometer_km, p_ownership_attested,
                                      p_lien_attested, p_vin, NULL, NULL, NULL, NULL) AS d;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_declare_vehicle(bytea, uuid, uuid, text, boolean, integer, boolean, boolean, text) IS
  'Ancienne signature (version N de l''API) : déclarations et engagements de l''hôte, historisés '
  'sans libellé connu ; numéro de châssis ISO 3779 ou non ISO. SECURITY DEFINER, EXECUTE app_api. '
  'US-124 (ADR-107, ADR-113).';

REVOKE ALL ON FUNCTION core.catalog_cmd_declare_vehicle(bytea, uuid, uuid, text, boolean, integer,
  boolean, boolean, text, text, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_cmd_declare_vehicle(bytea, uuid, uuid, text, boolean,
  integer, boolean, boolean, text, text, integer, text, text) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
