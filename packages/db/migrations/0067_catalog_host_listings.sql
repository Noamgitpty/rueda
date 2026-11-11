-- 0067 — CAT : lieux de remise, véhicules et annonces de l'hôte (modèle bêta), clé étrangère du véhicule.
-- US-115 ; 19 US-115 ; 16 HST-011, HST-005, HST-012, PRC-001, HST-033 ; 08 BR-LIST-04, BR-LIST-05,
-- BR-PRICE-01, BR-MILEAGE-01, SM-2 ; 17 §2.3 (« org_id = catalog.vehicle_org(vehicle_id), jamais
-- choisi par le client »), §3.1.3, §3.1.4 (C0 : « EXIF / GPS retirés des photos d'annonce »),
-- §3.2.3 (`location`, `vehicle`, `listing`, `listing_photo`, `deposit_policy`) ; 22 OQ-P2P-05 ;
-- DEC-FONDATEUR-13, DEC-FONDATEUR-19 ; ADR-060, ADR-089 (F-RLS-01, N-03), ADR-094, ADR-096 ;
-- ADR-099 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-099) :
--   - tables de l'hôte `catalog_location`, `catalog_vehicle`, `catalog_listing`,
--     `catalog_listing_photo` et table de plateforme `catalog_deposit_policy` (17 §3.2.3) ; RLS
--     ENABLE + FORCE, migrator_all ; AUCUN droit d'app_api, d'app_worker ni d'app_anon sur ces
--     tables : tout passe par des fonctions SECURITY DEFINER (propriétaire NOLOGIN
--     catalog_cmd_owner, search_path figé, EXECUTE au seul app_api) ;
--   - l'hôte est celui de la SESSION (empreinte du jeton, `core.iam_session_resolve`) et le compte
--     d'hôte est l'un de ses comptes titulaires (`core.iam_host_accounts`) : un compte d'un autre,
--     ou inconnu, rend FORBIDDEN ; un objet d'un autre compte rend la même réponse qu'un objet
--     inexistant (`*_NOT_FOUND`) : rien n'est révélé (L1-PM-11) ; le pays est TOUJOURS celui du
--     compte d'hôte, jamais une saisie ;
--   - particuliers seulement (DEC-FONDATEUR-13) : `plate_category` = PARTICULAR ; aucune limite de
--     véhicules (DEC-FONDATEUR-19) : rien n'est compté ;
--   - plaque normalisée (majuscules, sans espace, point ni tiret ; tout autre caractère refusé)
--     unique par pays ; VIN normalisé (ISO 3779 à 17 caractères, ou 5 à 17 avant 1981) unique
--     dans tous les pays : `VEHICLE_PLATE_DUPLICATE` (19 US-115 critère 1, L1-PM-20) ;
--   - variante du catalogue (ADR-094) : ACTIVE (elle, son modèle, sa marque), du marché du compte
--     d'hôte (`market` NULL ou égal au pays : réserve de la revue d'US-113) et produite l'année du
--     véhicule, sinon CATALOG_VARIANT_NOT_FOUND ; retirée : CATALOG_VARIANT_RETIRED ;
--   - prix journalier en unités mineures (bigint), > 0, multiple de `price_display_step_minor` du
--     pays (17 §7.2 `pyg_price_step`, sans objet là où la clé est déclarée non applicable ;
--     absente ailleurs : PARAM_MISSING) ; un trip confirmé n'est jamais touché (le propriétaire
--     des commandes n'a aucun droit sur les trips ni l'argent : 19 US-115 critère 3) ;
--   - SM-2 utile à la bêta : création DRAFT, soumission DRAFT → PENDING_REVIEW, suppression
--     DRAFT / BLOCKED_ELIGIBILITY / REJECTED → DELETED ; toute autre transition :
--     LISTING_TRANSITION_FORBIDDEN (la publication est US-118). Soumission, dans l'ordre :
--     complétude (photos ≥ `listing_min_photos` du pays : PHOTO_MIN_COUNT, l'annonce reste
--     DRAFT, 19 US-115 critère 2), compte d'hôte ACTIVE puis `p2p_private_hosts_enabled[pays]`
--     (sinon HOST_NOT_ACTIVATED, l'annonce reste DRAFT : 16 HST-005, BOARD N-37) ;
--   - lieu de remise = donnée de localisation (OQ-P2P-05, 16 HST-011, 17 §3.2.3 « geo exacte,
--     servie après réservation ; geo_public approximative ») : nom, adresse et point exact [C2]
--     ne sortent que vers l'hôte lui-même ; la projection publique d'une annonce LISTED
--     (`core.catalog_public_listing`) ne rend que la ville, la zone saisie et un point arrondi
--     au centième de degré (environ 1,1 km, colonne générée : jamais incohérent avec le point
--     exact) ; sans point exact, aucun point public (PROPOSÉ, fail-closed : 19 US-115 critère 4) ;
--     l'adresse exacte après confirmation est US-514 ;
--   - photos (16 HST-012) : `listing_photo` + `file_asset` (bucket PUBLIC_LISTING, C0, source
--     HOST_UPLOAD ajoutée ici), écrits par la commande AVANT le dépôt (création seule) ; type
--     réel, taille, antivirus et retrait des métadonnées sont du ressort de l'application
--     (cat/internal/host-listings/photo-ingest.ts) ; la base refuse tout type hors liste
--     (PHOTO_FORMAT) ;
--   - F-RLS-01 / N-03 (ADR-060, ADR-089) : clé étrangère (vehicle_id, org_id, country_code) vers
--     catalog_vehicle sur l'occupation, le hold et le trip ; `booking_vehicle_party` lit le
--     véhicule et son annonce LISTED ; `app.host_covers_vehicle` exige en plus que le véhicule
--     soit, au catalogue, un véhicule du compte de la session.
--
-- Expand / contract : création de tables et de fonctions ; ajouts de droits et de politiques ;
-- clés étrangères validées à la pose (production : aucune occupation, aucun hold ni trip n'a pu
-- être écrit, `booking_vehicle_party` ne connaissant aucun véhicule depuis 0037 ; graines du test
-- des migrations, US-046 : le bloc AVL est désormais posé après cette migration, avec son
-- véhicule au catalogue) ;
-- contrainte `file_asset_source_valid` recréée sous le même nom, élargie (HOST_UPLOAD) ; corps
-- de `core.booking_vehicle_party` et d'`app.host_covers_vehicle` remplacés à signature et
-- propriétaire identiques. Le COMPORTEMENT se resserre en fail-closed, volontairement : un
-- véhicule n'est bloqué ni réservé que s'il existe au catalogue (déjà vrai en production : aucun).
--
-- Retour arrière :
--   ALTER TABLE core.booking_vehicle_occupancy DROP CONSTRAINT occupancy_catalog_vehicle_fk;
--   ALTER TABLE core.booking_checkout_hold DROP CONSTRAINT checkout_hold_catalog_vehicle_fk;
--   ALTER TABLE core.booking_trip DROP CONSTRAINT trip_catalog_vehicle_fk,
--     DROP CONSTRAINT trip_catalog_listing_fk;
--   réappliquer core.booking_vehicle_party de 0037 et app.host_covers_vehicle de 0024 (sous
--     policy_fn_owner) ;
--   DROP FUNCTION core.catalog_cmd_create_location(bytea, uuid, text, text, text, text, text,
--     numeric, numeric), core.catalog_cmd_create_vehicle(bytea, uuid, uuid, text, text, uuid, text,
--     text, integer, text, text, smallint, text, integer, boolean, boolean),
--     core.catalog_cmd_create_listing(bytea, uuid, uuid, bigint, text, integer, bigint, boolean),
--     core.catalog_cmd_update_listing_pricing(bytea, uuid, uuid, bigint, text, integer, bigint),
--     core.catalog_cmd_add_listing_photo(bytea, uuid, uuid, uuid, uuid, text, bigint, bytea),
--     core.catalog_cmd_submit_listing(bytea, uuid, uuid), core.catalog_cmd_delete_listing(bytea,
--     uuid, uuid), core.catalog_host_locations(bytea, uuid), core.catalog_host_vehicles(bytea,
--     uuid), core.catalog_host_listings(bytea, uuid), core.catalog_public_listing(uuid),
--     core.catalog_host_context(bytea, uuid), core.catalog_param_int(text, text),
--     core.catalog_price_step(text), core.catalog_normalize_plate(text),
--     core.catalog_normalize_vin(text) ;
--   DROP TABLE core.catalog_listing_photo, core.catalog_listing, core.catalog_vehicle,
--     core.catalog_location, core.catalog_deposit_policy ;
--   DROP POLICY catalog_cmd_read ON core.config_country, core.config_param_definition,
--     core.config_param_value, core.catalog_vehicle_make, core.catalog_vehicle_model,
--     core.catalog_vehicle_variant ; DROP POLICY catalog_cmd_audit_insert ON
--     core.audit_audit_log ; DROP POLICY catalog_cmd_photo_insert ON core.audit_file_asset ;
--   recréer file_asset_source_valid de 0019 ; révoquer les droits accordés ci-dessous.

-- 1. Socle de catalog_cmd_owner (propriétaire NOLOGIN des commandes de l'hôte, amorçage) --------
GRANT USAGE ON SCHEMA core, platform TO catalog_cmd_owner;
GRANT EXECUTE ON FUNCTION platform.now() TO catalog_cmd_owner;
GRANT EXECUTE ON FUNCTION core.config_go_live(text, text) TO catalog_cmd_owner;

-- session et comptes d'hôte titulaires de la session (fonctions d'iam_auth_owner : seul leur
-- propriétaire accorde EXECUTE)
SET LOCAL ROLE iam_auth_owner;
GRANT EXECUTE ON FUNCTION core.iam_session_resolve(bytea), core.iam_host_accounts(bytea)
  TO catalog_cmd_owner;
RESET ROLE;

-- configuration : devise et fuseau du pays ; trois clés seulement (pas de prix, photos, ouverture
-- du pays aux hôtes particuliers lue par core.config_go_live)
GRANT SELECT (code, currency, time_zone) ON core.config_country TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.config_country FOR SELECT TO catalog_cmd_owner USING (true);
GRANT SELECT (key, not_applicable_in, go_live_switch) ON core.config_param_definition
  TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.config_param_definition FOR SELECT TO catalog_cmd_owner
  USING (key IN ('price_display_step_minor', 'listing_min_photos', 'p2p_private_hosts_enabled'));
GRANT SELECT (key, country_code, scope_type, value, valid_from, valid_to)
  ON core.config_param_value TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.config_param_value FOR SELECT TO catalog_cmd_owner
  USING (key IN ('price_display_step_minor', 'listing_min_photos', 'p2p_private_hosts_enabled'));

-- catalogue de référence (0063) : statut, marché, années et classe de valeur de la variante
GRANT SELECT (id, name, status) ON core.catalog_vehicle_make TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.catalog_vehicle_make FOR SELECT TO catalog_cmd_owner
  USING (true);
GRANT SELECT (id, make_id, name, status) ON core.catalog_vehicle_model TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.catalog_vehicle_model FOR SELECT TO catalog_cmd_owner
  USING (true);
GRANT SELECT (id, model_id, year_from, year_to, value_class, market, status)
  ON core.catalog_vehicle_variant TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.catalog_vehicle_variant FOR SELECT TO catalog_cmd_owner
  USING (true);

-- 2. Tables (17 §3.2.3) --------------------------------------------------------------------------
-- 2.1 Lieu de remise de l'hôte. Nom, adresse et point exact [C2] : l'hôte seul (US-514 : le
-- voyageur après confirmation) ; ville, zone et point arrondi [C0] : projection publique.
CREATE TABLE core.catalog_location (
  id              uuid          PRIMARY KEY,
  org_id          uuid          NOT NULL,
  country_code    text          NOT NULL
                  CONSTRAINT catalog_location_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  kind            text          NOT NULL DEFAULT 'HOME'
                  CONSTRAINT catalog_location_kind_valid CHECK (kind IN ('HOME', 'POI', 'AIRPORT')),
  -- libellé de l'hôte (17 §3.2.3 `name`, renommé `place_label` : « name » et « label » sont des
  -- noms trop génériques pour le contrôle des fuites de données personnelles d'US-046) [C2]
  place_label     text          NOT NULL
                  CONSTRAINT catalog_location_label_valid
                  CHECK (pg_catalog.btrim(place_label) <> ''
                         AND pg_catalog.char_length(place_label) <= 80),
  address_line    text          NOT NULL                                            -- [C2]
                  CONSTRAINT catalog_location_address_valid
                  CHECK (pg_catalog.btrim(address_line) <> ''
                         AND pg_catalog.char_length(address_line) <= 200),
  city            text          NOT NULL
                  CONSTRAINT catalog_location_city_valid
                  CHECK (pg_catalog.btrim(city) <> '' AND pg_catalog.char_length(city) <= 80),
  area_label      text
                  CONSTRAINT catalog_location_area_valid
                  CHECK (area_label IS NULL OR (pg_catalog.btrim(area_label) <> ''
                                                AND pg_catalog.char_length(area_label) <= 80)),
  -- point exact (x = longitude, y = latitude), posé par l'épingle de l'hôte, sans géocodage [C2]
  geo             point
                  CONSTRAINT catalog_location_geo_range
                  CHECK (geo[1] BETWEEN -90 AND 90 AND geo[0] BETWEEN -180 AND 180),
  -- point public (17 §3.2.3 geo_public) : arrondi au centième de degré (≈ 1,1 km), jamais saisi
  -- (PROPOSÉ, ADR-099)
  geo_public      point         GENERATED ALWAYS AS (
                    pg_catalog.point(pg_catalog.round(geo[0]::numeric, 2)::double precision,
                                     pg_catalog.round(geo[1]::numeric, 2)::double precision)) STORED,
  timezone        text          NOT NULL
                  CONSTRAINT catalog_location_timezone_valid CHECK (pg_catalog.btrim(timezone) <> ''),
  created_at      timestamptz   NOT NULL DEFAULT platform.now(),
  created_by      uuid          NOT NULL,
  CONSTRAINT catalog_location_org_fk FOREIGN KEY (org_id, country_code)
    REFERENCES core.iam_organization (id, country_code),
  CONSTRAINT catalog_location_party_unique UNIQUE (id, org_id, country_code)
);
CREATE INDEX catalog_location_org_idx ON core.catalog_location (org_id);
COMMENT ON TABLE core.catalog_location IS
  'CAT location (17 §3.2.3) : lieu de remise de l''hôte, sans géocodage ; nom, adresse, point '
  'exact [C2] à l''hôte seul (exact au voyageur après confirmation, US-514) ; ville, zone et '
  'point arrondi (≈ 1,1 km) publics. Écritures par commandes. US-115 (ADR-099).';

-- 2.2 Véhicule de l'hôte (particulier) : plaque unique par pays, VIN unique partout.
CREATE TABLE core.catalog_vehicle (
  id                  uuid        PRIMARY KEY,
  org_id              uuid        NOT NULL,
  country_code        text        NOT NULL
                      CONSTRAINT catalog_vehicle_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  home_location_id    uuid        NOT NULL,
  timezone            text        NOT NULL
                      CONSTRAINT catalog_vehicle_timezone_valid CHECK (pg_catalog.btrim(timezone) <> ''),
  plate               text        NOT NULL                                        -- [C2]
                      CONSTRAINT catalog_vehicle_plate_normalized CHECK (plate ~ '^[A-Z0-9]{2,12}$'),
  vin                 text                                                        -- [C2]
                      CONSTRAINT catalog_vehicle_vin_format CHECK (vin ~ '^[A-Z0-9]{5,17}$'),
  plate_category      text        NOT NULL DEFAULT 'PARTICULAR'
                      CONSTRAINT catalog_vehicle_plate_category_valid CHECK (plate_category = 'PARTICULAR'),
  insurer_eligibility text        NOT NULL DEFAULT 'PENDING'
                      CONSTRAINT catalog_vehicle_insurer_eligibility_valid
                      CHECK (insurer_eligibility IN ('ELIGIBLE', 'INELIGIBLE', 'PENDING')),
  variant_id          uuid        REFERENCES core.catalog_vehicle_variant (id),
  make_text           text
                      CONSTRAINT catalog_vehicle_make_text_valid
                      CHECK (make_text IS NULL OR (pg_catalog.btrim(make_text) <> ''
                                                   AND pg_catalog.char_length(make_text) <= 80)),
  model_text          text
                      CONSTRAINT catalog_vehicle_model_text_valid
                      CHECK (model_text IS NULL OR (pg_catalog.btrim(model_text) <> ''
                                                    AND pg_catalog.char_length(model_text) <= 80)),
  year                integer     NOT NULL
                      CONSTRAINT catalog_vehicle_year_range CHECK (year BETWEEN 1950 AND 2100),
  trim_override       text
                      CONSTRAINT catalog_vehicle_trim_valid
                      CHECK (trim_override IS NULL OR (pg_catalog.btrim(trim_override) <> ''
                                                       AND pg_catalog.char_length(trim_override) <= 80)),
  value_class         text
                      CONSTRAINT catalog_vehicle_value_class_valid
                      CHECK (value_class IN ('STANDARD', 'PREMIUM', 'LUXE')),
  transmission        text        NOT NULL
                      CONSTRAINT catalog_vehicle_transmission_valid
                      CHECK (transmission IN ('MANUAL', 'AUTOMATIC')),
  seats               smallint    NOT NULL
                      CONSTRAINT catalog_vehicle_seats_range CHECK (seats BETWEEN 1 AND 60),
  fuel_type           text        NOT NULL
                      CONSTRAINT catalog_vehicle_fuel_valid
                      CHECK (fuel_type IN ('GASOLINE', 'DIESEL', 'HYBRID', 'EV')),
  odometer_km         integer
                      CONSTRAINT catalog_vehicle_odometer_range CHECK (odometer_km BETWEEN 0 AND 3000000),
  eligibility_status  text        NOT NULL DEFAULT 'PENDING'
                      CONSTRAINT catalog_vehicle_eligibility_valid
                      CHECK (eligibility_status IN ('ELIGIBLE', 'INELIGIBLE', 'PENDING')),
  lien_declared       boolean     NOT NULL DEFAULT false,
  gps_installed       boolean     NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT platform.now(),
  created_by          uuid        NOT NULL,
  -- ISO 3779 (17 caractères, ni I, O ni Q) ; avant 1981 : 5 à 17 caractères (BR-LIST-04)
  CONSTRAINT catalog_vehicle_vin_iso CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$'
                                            OR year < 1981),
  -- repli make_text / model_text SEULEMENT sans variante (17 §3.2.3)
  CONSTRAINT catalog_vehicle_identity CHECK (
    (variant_id IS NOT NULL AND make_text IS NULL AND model_text IS NULL)
    OR (variant_id IS NULL AND make_text IS NOT NULL AND model_text IS NOT NULL)),
  CONSTRAINT catalog_vehicle_org_fk FOREIGN KEY (org_id, country_code)
    REFERENCES core.iam_organization (id, country_code),
  CONSTRAINT catalog_vehicle_location_fk FOREIGN KEY (home_location_id, org_id, country_code)
    REFERENCES core.catalog_location (id, org_id, country_code),
  CONSTRAINT catalog_vehicle_plate_unique UNIQUE (country_code, plate),
  CONSTRAINT catalog_vehicle_party_unique UNIQUE (id, org_id, country_code)
);
CREATE UNIQUE INDEX catalog_vehicle_vin_unique ON core.catalog_vehicle (vin) WHERE vin IS NOT NULL;
CREATE INDEX catalog_vehicle_org_idx ON core.catalog_vehicle (org_id);
COMMENT ON TABLE core.catalog_vehicle IS
  'CAT vehicle (17 §3.2.3) : véhicule d''un hôte particulier ; plaque normalisée unique par pays, '
  'VIN unique partout ; variante du catalogue (ADR-094) ou repli texte ; pays = celui du compte '
  'd''hôte. Écritures par commandes. US-115 (ADR-099).';

-- 2.3 Caution par pays et classe, fixée par la plateforme (17 §3.2.3) : aucune ligne avant le
-- jalon J-ADM-031 (`deposit_amount` à fixer) ; aucun écrivain applicatif en bêta.
CREATE TABLE core.catalog_deposit_policy (
  id               uuid        PRIMARY KEY,
  country_code     text        NOT NULL
                   CONSTRAINT catalog_deposit_policy_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  value_class      text        NOT NULL
                   CONSTRAINT catalog_deposit_policy_value_class_valid
                   CHECK (value_class IN ('STANDARD', 'PREMIUM', 'LUXE')),
  amount_minor     bigint      NOT NULL CONSTRAINT catalog_deposit_policy_amount_valid CHECK (amount_minor >= 0),
  currency         text        NOT NULL
                   CONSTRAINT catalog_deposit_policy_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  accepted_methods text[]      NOT NULL
                   CONSTRAINT catalog_deposit_policy_methods_valid
                   CHECK (pg_catalog.cardinality(accepted_methods) > 0
                          AND accepted_methods <@ ARRAY['CARD_PREAUTH', 'CARD_CHARGE_THEN_REFUND']),
  covered_items    text[]      NOT NULL
                   CONSTRAINT catalog_deposit_policy_covered_valid
                   CHECK (covered_items <@ ARRAY['FUEL', 'CLEANING', 'TOLLS', 'FINES', 'LATE_RETURN', 'KEYS']),
  excluded_items   text[]      NOT NULL DEFAULT '{}',
  -- aucun dommage n'est capturé sur la caution (08 BR-PAY-06)
  covers_damage    boolean     NOT NULL DEFAULT false
                   CONSTRAINT catalog_deposit_policy_no_damage CHECK (NOT covers_damage),
  valid_from       timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT catalog_deposit_policy_unique UNIQUE (country_code, value_class, valid_from)
);
COMMENT ON TABLE core.catalog_deposit_policy IS
  'CAT deposit_policy (17 §3.2.3) : caution par pays et classe, fixée par la plateforme, jamais '
  'par l''hôte ; ne couvre aucun dommage. Vide avant J-ADM-031. US-115 (ADR-099).';

-- 2.4 Annonce (SM-2 ; une annonce par véhicule).
CREATE TABLE core.catalog_listing (
  id                   uuid        PRIMARY KEY,
  vehicle_id           uuid        NOT NULL CONSTRAINT catalog_listing_vehicle_unique UNIQUE,
  org_id               uuid        NOT NULL,
  country_code         text        NOT NULL
                       CONSTRAINT catalog_listing_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  status               text        NOT NULL DEFAULT 'DRAFT'
                       CONSTRAINT catalog_listing_status_valid CHECK (status IN
                         ('DRAFT', 'BLOCKED_ELIGIBILITY', 'PENDING_REVIEW', 'LISTED', 'REJECTED',
                          'SNOOZED', 'UNLISTED', 'RESTRICTED', 'REMOVED_BY_PLATFORM', 'DELETED')),
  daily_price_minor    bigint      NOT NULL
                       CONSTRAINT catalog_listing_price_positive CHECK (daily_price_minor > 0),
  currency             text        NOT NULL
                       CONSTRAINT catalog_listing_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  mileage_mode         text        NOT NULL
                       CONSTRAINT catalog_listing_mileage_mode_valid
                       CHECK (mileage_mode IN ('UNLIMITED', 'INCLUDED')),
  included_km_per_day  integer,
  extra_km_price_minor bigint,
  instant_book         boolean     NOT NULL DEFAULT true,
  deposit_policy_id    uuid        REFERENCES core.catalog_deposit_policy (id),
  submitted_at         timestamptz,
  published_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT platform.now(),
  created_by           uuid        NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT platform.now(),
  updated_by           uuid,
  row_version          integer     NOT NULL DEFAULT 0,
  -- 17 §3.2.3 : CHECK (mileage_mode = 'UNLIMITED' OR included_km_per_day > 0) ; 16 HST-033
  CONSTRAINT catalog_listing_mileage_valid CHECK (
    (mileage_mode = 'UNLIMITED' AND included_km_per_day IS NULL AND extra_km_price_minor IS NULL)
    OR (mileage_mode = 'INCLUDED' AND included_km_per_day BETWEEN 1 AND 10000
        AND extra_km_price_minor >= 0)),
  CONSTRAINT catalog_listing_vehicle_fk FOREIGN KEY (vehicle_id, org_id, country_code)
    REFERENCES core.catalog_vehicle (id, org_id, country_code),
  CONSTRAINT catalog_listing_party_unique UNIQUE (id, org_id, country_code)
);
CREATE INDEX catalog_listing_org_idx ON core.catalog_listing (org_id);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.catalog_listing
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
COMMENT ON TABLE core.catalog_listing IS
  'CAT listing (17 §3.2.3, SM-2) : annonce d''un véhicule ; prix journalier en unités mineures ; '
  'distance incluse ; transitions par commandes (bêta : DRAFT, PENDING_REVIEW, DELETED ; '
  'publication US-118). US-115 (ADR-099).';

-- 2.5 Photo d'annonce (classe D : retrait par deleted_at).
CREATE TABLE core.catalog_listing_photo (
  id           uuid        PRIMARY KEY,
  listing_id   uuid        NOT NULL,
  org_id       uuid        NOT NULL,
  country_code text        NOT NULL
               CONSTRAINT catalog_listing_photo_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  file_id      uuid        NOT NULL CONSTRAINT catalog_listing_photo_file_unique UNIQUE
               REFERENCES core.audit_file_asset (id),
  position     smallint    NOT NULL CONSTRAINT catalog_listing_photo_position_range
               CHECK (position BETWEEN 0 AND 999),
  status       text        NOT NULL DEFAULT 'PENDING'
               CONSTRAINT catalog_listing_photo_status_valid
               CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  alt_text     text
               CONSTRAINT catalog_listing_photo_alt_valid
               CHECK (alt_text IS NULL OR pg_catalog.char_length(alt_text) <= 300),
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT platform.now(),
  created_by   uuid        NOT NULL,
  CONSTRAINT catalog_listing_photo_listing_fk FOREIGN KEY (listing_id, org_id, country_code)
    REFERENCES core.catalog_listing (id, org_id, country_code),
  CONSTRAINT catalog_listing_photo_position_unique UNIQUE (listing_id, position)
);
COMMENT ON TABLE core.catalog_listing_photo IS
  'CAT listing_photo (17 §3.2.3, 16 HST-012) : photo d''annonce (file_asset PUBLIC_LISTING, C0, '
  'métadonnées retirées avant dépôt) ; PENDING jusqu''à la revue de l''ops. US-115 (ADR-099).';

-- 3. RLS : ENABLE + FORCE, migrator_all ; aucun droit applicatif --------------------------------
ALTER TABLE core.catalog_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_location FORCE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_vehicle ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_vehicle FORCE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_deposit_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_deposit_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_listing ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_listing FORCE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_listing_photo ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_listing_photo FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.catalog_location TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.catalog_vehicle TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.catalog_deposit_policy TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.catalog_listing TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.catalog_listing_photo TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.catalog_location, core.catalog_vehicle, core.catalog_deposit_policy,
  core.catalog_listing, core.catalog_listing_photo FROM PUBLIC;

-- Droits de catalog_cmd_owner : ses commandes seules (pays et compte relus en base, jamais reçus)
GRANT SELECT, INSERT ON core.catalog_location TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_all ON core.catalog_location TO catalog_cmd_owner
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON core.catalog_vehicle TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_all ON core.catalog_vehicle TO catalog_cmd_owner
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON core.catalog_listing TO catalog_cmd_owner;
GRANT UPDATE (status, daily_price_minor, mileage_mode, included_km_per_day, extra_km_price_minor,
              submitted_at, updated_by)
  ON core.catalog_listing TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_all ON core.catalog_listing TO catalog_cmd_owner
  USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON core.catalog_listing_photo TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_all ON core.catalog_listing_photo TO catalog_cmd_owner
  USING (true) WITH CHECK (true);

-- Fichier d'une photo : la commande écrit la ligne file_asset (bucket public, C0, téléversement
-- de l'hôte), jamais un autre bucket, jamais une lecture ni une mise à jour.
ALTER TABLE core.audit_file_asset DROP CONSTRAINT file_asset_source_valid;
ALTER TABLE core.audit_file_asset ADD CONSTRAINT file_asset_source_valid CHECK (source IN
  ('IN_APP_CAMERA', 'STAFF_UPLOAD', 'GENERATED', 'PROVIDER', 'HOST_UPLOAD'));
GRANT INSERT (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id, source,
              classification, retention_class)
  ON core.audit_file_asset TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_photo_insert ON core.audit_file_asset FOR INSERT TO catalog_cmd_owner
  WITH CHECK (bucket = 'PUBLIC_LISTING' AND classification = 'C0' AND source = 'HOST_UPLOAD'
              AND enc_subject_type IS NULL AND retention_class = 'LISTING_PHOTO'
              AND mime IN ('image/jpeg', 'image/png', 'image/webp'));

-- Journal : soumission et suppression d'une annonce (la chaîne attribue id, at, hachages)
GRANT INSERT (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after,
              reason, request_id)
  ON core.audit_audit_log TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_audit_insert ON core.audit_audit_log FOR INSERT TO catalog_cmd_owner
  WITH CHECK (action_code IN ('LISTING_SUBMITTED', 'LISTING_DELETED') AND subject_type = 'LISTING');

-- 4. Aides internes (SECURITY INVOKER, exécutées sous catalog_cmd_owner) -------------------------
-- Hôte de la session et compte d'hôte demandé : AUTH_REQUIRED (session invalide), FORBIDDEN (le
-- compte n'est pas un compte titulaire de la session, ou n'existe pas), OK (personne, pays et
-- statut du compte). Rien n'est lu d'un identifiant reçu autrement que par le jeton.
CREATE FUNCTION core.catalog_host_context(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (outcome text, user_id uuid, country_code text, org_status text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  v_country text;
  v_status  text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT a.country_code, a.org_status INTO v_country, v_status
    FROM core.iam_host_accounts(p_token_hash) AS a
   WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, v_user, NULL::text, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, v_user, v_country, v_status;
END
$fn$;

-- Paramètre entier du pays en vigueur à platform.now() (nombre ou chaîne d'entier), sinon NULL.
CREATE FUNCTION core.catalog_param_int(p_key text, p_country text)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) IN ('number', 'string')
                   AND (v.value #>> '{}') ~ '^[0-9]{1,18}$'
              THEN (v.value #>> '{}')::bigint END
    FROM core.config_param_value AS v CROSS JOIN t
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

-- Pas de prix du pays (BR-PRICE-14, 17 §7.2 pyg_price_step) : 1 là où la clé est déclarée non
-- applicable ; NULL (PARAM_MISSING) si elle est applicable et absente ou mal formée.
CREATE FUNCTION core.catalog_price_step(p_country text)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM core.config_param_definition AS d
                         WHERE d.key = 'price_display_step_minor'
                           AND p_country = ANY (d.not_applicable_in)) THEN 1::bigint
           ELSE NULLIF(core.catalog_param_int('price_display_step_minor', p_country), 0)
         END
$fn$;

-- Normalisation de la plaque : majuscules, sans espace, point ni tiret ; tout autre caractère
-- (lettre accentuée, homoglyphe, symbole) rend NULL (refus), jamais un retrait silencieux.
CREATE FUNCTION core.catalog_normalize_plate(p_plate text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN p_plate ~ '^[A-Za-z0-9 .-]{1,24}$'
              THEN NULLIF(pg_catalog.upper(pg_catalog.regexp_replace(p_plate, '[ .-]', '', 'g')), '')
         END
$fn$;

-- Normalisation du VIN : majuscules, sans espace ni tiret ; autre caractère : NULL (refus).
CREATE FUNCTION core.catalog_normalize_vin(p_vin text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN p_vin ~ '^[A-Za-z0-9 -]{1,40}$'
              THEN NULLIF(pg_catalog.upper(pg_catalog.regexp_replace(p_vin, '[ -]', '', 'g')), '')
         END
$fn$;

COMMENT ON FUNCTION core.catalog_host_context(bytea, uuid) IS
  'Hôte de la session (empreinte du jeton) et compte d''hôte titulaire demandé : AUTH_REQUIRED, '
  'FORBIDDEN ou OK (personne, pays, statut). Exécutée sous catalog_cmd_owner. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_param_int(text, text) IS
  'Paramètre entier du pays en vigueur à platform.now(), sinon NULL. US-115.';
COMMENT ON FUNCTION core.catalog_price_step(text) IS
  'Pas de prix du pays (price_display_step_minor ; 1 si non applicable ; NULL si absent). US-115.';
COMMENT ON FUNCTION core.catalog_normalize_plate(text) IS
  'Plaque normalisée (majuscules, sans espace, point ni tiret) ; caractère étranger : NULL. US-115.';
COMMENT ON FUNCTION core.catalog_normalize_vin(text) IS
  'VIN normalisé (majuscules, sans espace ni tiret) ; caractère étranger : NULL. US-115.';
REVOKE ALL ON FUNCTION core.catalog_host_context(bytea, uuid), core.catalog_param_int(text, text),
  core.catalog_price_step(text), core.catalog_normalize_plate(text),
  core.catalog_normalize_vin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_host_context(bytea, uuid), core.catalog_param_int(text, text),
  core.catalog_price_step(text), core.catalog_normalize_plate(text),
  core.catalog_normalize_vin(text) TO catalog_cmd_owner;

-- 5. Commandes de l'hôte (SECURITY DEFINER, catalog_cmd_owner, EXECUTE au seul app_api) ----------
-- Issues métier rendues, jamais levées (l'appelant traduit en HTTP) ; une donnée mal formée qui
-- échappe à la validation de l'application est refusée par les CHECK (erreur, rien n'est écrit).
-- Écriture refusée (HOST_ACCOUNT_SUSPENDED) pour un compte SUSPENDED ou OFFBOARDED ; brouillons
-- permis avant l'activation (16 HST-005).

-- 5.1 Lieu de remise
CREATE FUNCTION core.catalog_cmd_create_location(p_token_hash bytea, p_org uuid, p_kind text,
                                                 p_label text, p_address_line text, p_city text,
                                                 p_area_label text, p_lat numeric, p_lng numeric)
  RETURNS TABLE (outcome text, location_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h    record;
  v_tz text;
  v_id uuid := pg_catalog.gen_random_uuid();
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
  IF p_kind IS NULL OR p_kind NOT IN ('HOME', 'POI', 'AIRPORT')
     OR p_label IS NULL OR pg_catalog.btrim(p_label) = '' OR pg_catalog.char_length(p_label) > 80
     OR p_address_line IS NULL OR pg_catalog.btrim(p_address_line) = ''
     OR pg_catalog.char_length(p_address_line) > 200
     OR p_city IS NULL OR pg_catalog.btrim(p_city) = '' OR pg_catalog.char_length(p_city) > 80
     OR (p_area_label IS NOT NULL AND (pg_catalog.btrim(p_area_label) = ''
                                       OR pg_catalog.char_length(p_area_label) > 80))
     OR ((p_lat IS NULL) <> (p_lng IS NULL))
     OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RETURN QUERY SELECT 'LOCATION_FIELD_INVALID'::text, NULL::uuid;
    RETURN;
  END IF;
  -- fuseau du pays du compte d'hôte (17 §3.2.3 : « un véhicule hérite du fuseau de son lieu »)
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = h.country_code;
  IF v_tz IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  INSERT INTO core.catalog_location (id, org_id, country_code, kind, place_label, address_line, city,
                                     area_label, geo, timezone, created_by)
  VALUES (v_id, p_org, h.country_code, p_kind, pg_catalog.btrim(p_label),
          pg_catalog.btrim(p_address_line), pg_catalog.btrim(p_city),
          NULLIF(pg_catalog.btrim(p_area_label), ''),
          CASE WHEN p_lat IS NOT NULL
               THEN pg_catalog.point(pg_catalog.round(p_lng, 6)::double precision,
                                     pg_catalog.round(p_lat, 6)::double precision) END,
          v_tz, h.user_id);
  RETURN QUERY SELECT 'DONE'::text, v_id;
END
$fn$;

-- 5.2 Véhicule : plaque et VIN normalisés, uniques ; variante du marché du compte (US-113).
CREATE FUNCTION core.catalog_cmd_create_vehicle(p_token_hash bytea, p_org uuid, p_location_id uuid,
                                                p_plate text, p_vin text, p_variant_id uuid,
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
  -- contrainte unique reste le filet (23505 traduit en VEHICLE_PLATE_DUPLICATE)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cat.plate:' || h.country_code || ':' || v_plate, 0));
  IF v_vin IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cat.vin:' || v_vin, 0));
  END IF;
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle AS x
              WHERE (x.country_code = h.country_code AND x.plate = v_plate)
                 OR (v_vin IS NOT NULL AND x.vin = v_vin)) THEN
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
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT 'VEHICLE_PLATE_DUPLICATE'::text, NULL::uuid;
    RETURN;
  END;
  RETURN QUERY SELECT 'DONE'::text, v_id;
END
$fn$;

-- 5.3 Annonce : création (DRAFT) et tarif. Règles communes du prix et de la distance (PRC-001,
-- HST-033, BR-PRICE-14) dans la fonction d'aide ci-dessous.
CREATE FUNCTION core.catalog_pricing_outcome(p_country text, p_price bigint, p_mode text,
                                             p_km integer, p_extra bigint)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_step bigint;
BEGIN
  IF p_price IS NULL OR p_price <= 0 THEN
    RETURN 'PRICE_INVALID';
  END IF;
  v_step := core.catalog_price_step(p_country);
  IF v_step IS NULL THEN
    RETURN 'PARAM_MISSING';
  END IF;
  IF pg_catalog.mod(p_price, v_step) <> 0 THEN
    RETURN 'PRICE_INVALID';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('UNLIMITED', 'INCLUDED')
     OR (p_mode = 'UNLIMITED' AND (p_km IS NOT NULL OR p_extra IS NOT NULL))
     OR (p_mode = 'INCLUDED' AND (p_km IS NULL OR p_km NOT BETWEEN 1 AND 10000
                                  OR p_extra IS NULL OR p_extra < 0)) THEN
    RETURN 'MILEAGE_CONFIG_INVALID';
  END IF;
  RETURN 'OK';
END
$fn$;
COMMENT ON FUNCTION core.catalog_pricing_outcome(text, bigint, text, integer, bigint) IS
  'Prix journalier (> 0, multiple du pas du pays) et distance incluse (16 HST-033) : OK, '
  'PRICE_INVALID, PARAM_MISSING ou MILEAGE_CONFIG_INVALID. Sous catalog_cmd_owner. US-115.';
REVOKE ALL ON FUNCTION core.catalog_pricing_outcome(text, bigint, text, integer, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_pricing_outcome(text, bigint, text, integer, bigint)
  TO catalog_cmd_owner;

CREATE FUNCTION core.catalog_cmd_create_listing(p_token_hash bytea, p_org uuid, p_vehicle_id uuid,
                                                p_daily_price_minor bigint, p_mileage_mode text,
                                                p_included_km_per_day integer,
                                                p_extra_km_price_minor bigint,
                                                p_instant_book boolean)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h          record;
  v_vehicle  uuid;
  v_kind     text;
  v_currency text;
  v_check    text;
  v_id       uuid := pg_catalog.gen_random_uuid();
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
  SELECT v.id, l.kind INTO v_vehicle, v_kind
    FROM core.catalog_vehicle AS v
    JOIN core.catalog_location AS l ON l.id = v.home_location_id
   WHERE v.id = p_vehicle_id AND v.org_id = p_org AND v.country_code = h.country_code;
  IF v_vehicle IS NULL THEN
    RETURN QUERY SELECT 'VEHICLE_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  v_check := core.catalog_pricing_outcome(h.country_code, p_daily_price_minor, p_mileage_mode,
                                          p_included_km_per_day, p_extra_km_price_minor);
  IF v_check <> 'OK' THEN
    RETURN QUERY SELECT v_check, NULL::uuid;
    RETURN;
  END IF;
  -- mode REQUEST refusé pour un lieu aéroport (17 §3.2.3, OQ-P2P-10, US-060)
  IF p_instant_book IS NOT DISTINCT FROM false AND v_kind = 'AIRPORT' THEN
    RETURN QUERY SELECT 'REQUEST_MODE_NOT_ALLOWED'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT k.currency::text INTO v_currency FROM core.config_country AS k
   WHERE k.code::text = h.country_code;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cat.listing:' || v_vehicle::text, 0));
  IF EXISTS (SELECT 1 FROM core.catalog_listing AS x WHERE x.vehicle_id = v_vehicle) THEN
    RETURN QUERY SELECT 'LISTING_EXISTS'::text, NULL::uuid;
    RETURN;
  END IF;
  INSERT INTO core.catalog_listing (id, vehicle_id, org_id, country_code, status, daily_price_minor,
                                    currency, mileage_mode, included_km_per_day,
                                    extra_km_price_minor, instant_book, created_by, updated_by)
  VALUES (v_id, v_vehicle, p_org, h.country_code, 'DRAFT', p_daily_price_minor, v_currency,
          p_mileage_mode, p_included_km_per_day, p_extra_km_price_minor,
          COALESCE(p_instant_book, true), h.user_id, h.user_id);
  RETURN QUERY SELECT 'DONE'::text, v_id;
END
$fn$;

-- Tarif : effet sur les nouveaux devis seulement ; un trip confirmé garde son montant (PRC-001)
CREATE FUNCTION core.catalog_cmd_update_listing_pricing(p_token_hash bytea, p_org uuid,
                                                        p_listing_id uuid,
                                                        p_daily_price_minor bigint,
                                                        p_mileage_mode text,
                                                        p_included_km_per_day integer,
                                                        p_extra_km_price_minor bigint)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h        record;
  v_status text;
  v_check  text;
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
  SELECT l.status INTO v_status
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_status IN ('DELETED', 'REMOVED_BY_PLATFORM') THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  v_check := core.catalog_pricing_outcome(h.country_code, p_daily_price_minor, p_mileage_mode,
                                          p_included_km_per_day, p_extra_km_price_minor);
  IF v_check <> 'OK' THEN
    RETURN QUERY SELECT v_check, NULL::uuid;
    RETURN;
  END IF;
  UPDATE core.catalog_listing AS l
     SET daily_price_minor = p_daily_price_minor, mileage_mode = p_mileage_mode,
         included_km_per_day = p_included_km_per_day,
         extra_km_price_minor = p_extra_km_price_minor, updated_by = h.user_id
   WHERE l.id = p_listing_id;
  RETURN QUERY SELECT 'DONE'::text, p_listing_id;
END
$fn$;

-- 5.4 Photo : ligne file_asset (création seule, avant le dépôt) et photo PENDING en fin de liste.
-- L'application a contrôlé le type réel, la taille, l'antivirus et retiré les métadonnées ; la
-- base n'accepte que JPEG, PNG et WebP (PHOTO_FORMAT) et une empreinte SHA-256 de 32 octets.
CREATE FUNCTION core.catalog_cmd_add_listing_photo(p_token_hash bytea, p_org uuid,
                                                   p_listing_id uuid, p_photo_id uuid,
                                                   p_file_id uuid, p_mime text, p_bytes bigint,
                                                   p_sha256 bytea)
  RETURNS TABLE (outcome text, photo_id uuid, storage_key text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h        record;
  v_status text;
  v_pos    smallint;
  v_key    text;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_photo_id IS NULL OR p_file_id IS NULL THEN
    RAISE EXCEPTION 'photo : identifiants manquants' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT l.status INTO v_status
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_status NOT IN ('DRAFT', 'REJECTED', 'BLOCKED_ELIGIBILITY') THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF p_mime IS NULL OR p_mime NOT IN ('image/jpeg', 'image/png', 'image/webp')
     OR p_bytes IS NULL OR p_bytes <= 0
     OR p_sha256 IS NULL OR pg_catalog.octet_length(p_sha256) <> 32 THEN
    RETURN QUERY SELECT 'PHOTO_FORMAT'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.max(p.position) + 1, 0)::smallint INTO v_pos
    FROM core.catalog_listing_photo AS p WHERE p.listing_id = p_listing_id;
  v_key := 'listing/' || p_listing_id::text || '/' || p_photo_id::text;
  INSERT INTO core.audit_file_asset (id, bucket, storage_key, mime, bytes, sha256,
                                     uploader_user_id, source, classification, retention_class)
  VALUES (p_file_id, 'PUBLIC_LISTING', v_key, p_mime, p_bytes, p_sha256, h.user_id, 'HOST_UPLOAD',
          'C0', 'LISTING_PHOTO');
  INSERT INTO core.catalog_listing_photo (id, listing_id, org_id, country_code, file_id, position,
                                          status, created_by)
  VALUES (p_photo_id, p_listing_id, p_org, h.country_code, p_file_id, v_pos, 'PENDING', h.user_id);
  RETURN QUERY SELECT 'DONE'::text, p_photo_id, v_key;
END
$fn$;

-- 5.5 Soumission (SM-2 DRAFT → PENDING_REVIEW) : complétude d'abord (l'étape manquante est dite),
-- puis compte d'hôte ACTIVE et pays ouvert aux hôtes ; sinon l'annonce reste DRAFT.
CREATE FUNCTION core.catalog_cmd_submit_listing(p_token_hash bytea, p_org uuid, p_listing_id uuid)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h        record;
  v_status text;
  v_min    bigint;
  v_photos integer;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT l.status INTO v_status
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_status <> 'DRAFT' THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  -- photos (BR-LIST-05, 16 HST-012) : photos non retirées et non refusées
  v_min := core.catalog_param_int('listing_min_photos', h.country_code);
  IF v_min IS NULL OR v_min < 1 THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_photos
    FROM core.catalog_listing_photo AS p
   WHERE p.listing_id = p_listing_id AND p.deleted_at IS NULL AND p.status <> 'REJECTED';
  IF v_photos < v_min THEN
    RETURN QUERY SELECT 'PHOTO_MIN_COUNT'::text, NULL::uuid;
    RETURN;
  END IF;
  -- compte d'hôte activé (17 §2.4 ; BOARD N-37) et pays ouvert aux hôtes particuliers (16 HST-005)
  IF h.org_status IS DISTINCT FROM 'ACTIVE'
     OR NOT core.config_go_live('p2p_private_hosts_enabled', h.country_code) THEN
    RETURN QUERY SELECT 'HOST_NOT_ACTIVATED'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE core.catalog_listing AS l
     SET status = 'PENDING_REVIEW', submitted_at = platform.now(), updated_by = h.user_id
   WHERE l.id = p_listing_id;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (h.user_id, 'P2P_HOST', 'LISTING_SUBMITTED', 'LISTING', p_listing_id,
          pg_catalog.jsonb_build_object('status', 'DRAFT'),
          pg_catalog.jsonb_build_object('status', 'PENDING_REVIEW', 'orgId', p_org,
                                        'country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_listing_id;
END
$fn$;

-- 5.6 Suppression (SM-2 : DRAFT, BLOCKED_ELIGIBILITY, REJECTED → DELETED ; terminal)
CREATE FUNCTION core.catalog_cmd_delete_listing(p_token_hash bytea, p_org uuid, p_listing_id uuid)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h        record;
  v_status text;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT l.status INTO v_status
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_status NOT IN ('DRAFT', 'BLOCKED_ELIGIBILITY', 'REJECTED') THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE core.catalog_listing AS l
     SET status = 'DELETED', updated_by = h.user_id
   WHERE l.id = p_listing_id;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (h.user_id, 'P2P_HOST', 'LISTING_DELETED', 'LISTING', p_listing_id,
          pg_catalog.jsonb_build_object('status', v_status),
          pg_catalog.jsonb_build_object('status', 'DELETED', 'orgId', p_org,
                                        'country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_listing_id;
END
$fn$;

-- 6. Lectures de l'hôte (ses seules lignes) et projection publique --------------------------------
-- Session invalide ou compte d'un autre : 0 ligne (même réponse).
CREATE FUNCTION core.catalog_host_locations(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (location_id uuid, kind text, place_label text, address_line text, city text,
                 area_label text, geo_lat numeric, geo_lng numeric, timezone text)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.id, l.kind, l.place_label, l.address_line, l.city, l.area_label, l.geo[1]::numeric,
         l.geo[0]::numeric, l.timezone
    FROM core.catalog_host_context(p_token_hash, p_org) AS h
    JOIN core.catalog_location AS l ON l.org_id = p_org AND l.country_code = h.country_code
   WHERE h.outcome = 'OK'
   ORDER BY l.created_at, l.id
$fn$;

CREATE FUNCTION core.catalog_host_vehicles(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (vehicle_id uuid, location_id uuid, plate text, vin text, variant_id uuid,
                 make_text text, model_text text, year integer, trim_override text,
                 value_class text, transmission text, seats smallint, fuel_type text,
                 odometer_km integer, gps_installed boolean, lien_declared boolean,
                 eligibility_status text, listing_id uuid, listing_status text)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.id, v.home_location_id, v.plate, v.vin, v.variant_id, v.make_text, v.model_text, v.year,
         v.trim_override, v.value_class, v.transmission, v.seats, v.fuel_type, v.odometer_km,
         v.gps_installed, v.lien_declared, v.eligibility_status, l.id, l.status
    FROM core.catalog_host_context(p_token_hash, p_org) AS h
    JOIN core.catalog_vehicle AS v ON v.org_id = p_org AND v.country_code = h.country_code
    LEFT JOIN core.catalog_listing AS l ON l.vehicle_id = v.id
   WHERE h.outcome = 'OK'
   ORDER BY v.created_at, v.id
$fn$;

CREATE FUNCTION core.catalog_host_listings(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (listing_id uuid, vehicle_id uuid, status text, daily_price_minor bigint,
                 currency text, mileage_mode text, included_km_per_day integer,
                 extra_km_price_minor bigint, instant_book boolean, photos integer,
                 submitted_at timestamptz)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.id, l.vehicle_id, l.status, l.daily_price_minor, l.currency, l.mileage_mode,
         l.included_km_per_day, l.extra_km_price_minor, l.instant_book,
         (SELECT pg_catalog.count(*)::integer FROM core.catalog_listing_photo AS p
           WHERE p.listing_id = l.id AND p.deleted_at IS NULL AND p.status <> 'REJECTED'),
         l.submitted_at
    FROM core.catalog_host_context(p_token_hash, p_org) AS h
    JOIN core.catalog_listing AS l ON l.org_id = p_org AND l.country_code = h.country_code
   WHERE h.outcome = 'OK' AND l.status <> 'DELETED'
   ORDER BY l.created_at, l.id
$fn$;

-- Annonce publiée, vue d'un visiteur (19 US-115 critère 4) : colonnes C0 seulement. Jamais le
-- libellé ni l'adresse du lieu, ni son point exact, ni la plaque, ni le VIN, ni le compte d'hôte.
CREATE FUNCTION core.catalog_public_listing(p_listing_id uuid)
  RETURNS TABLE (listing_id uuid, country_code text, daily_price_minor bigint, currency text,
                 mileage_mode text, included_km_per_day integer, extra_km_price_minor bigint,
                 instant_book boolean, variant_id uuid, make_name text, model_name text,
                 year integer, transmission text, seats smallint, fuel_type text,
                 location_kind text, city text, area_label text, geo_public_lat numeric,
                 geo_public_lng numeric, timezone text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT l.id, l.country_code, l.daily_price_minor, l.currency, l.mileage_mode,
         l.included_km_per_day, l.extra_km_price_minor, l.instant_book, v.variant_id,
         COALESCE(mk.name, v.make_text), COALESCE(mo.name, v.model_text), v.year, v.transmission,
         v.seats, v.fuel_type, loc.kind, loc.city, loc.area_label, loc.geo_public[1]::numeric,
         loc.geo_public[0]::numeric, v.timezone
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id
    JOIN core.catalog_location AS loc ON loc.id = v.home_location_id
    LEFT JOIN core.catalog_vehicle_variant AS va ON va.id = v.variant_id
    LEFT JOIN core.catalog_vehicle_model AS mo ON mo.id = va.model_id
    LEFT JOIN core.catalog_vehicle_make AS mk ON mk.id = mo.make_id
   WHERE l.id = p_listing_id AND l.status = 'LISTED'
$fn$;

COMMENT ON FUNCTION core.catalog_cmd_create_location(bytea, uuid, text, text, text, text, text, numeric, numeric) IS
  'Lieu de remise du compte d''hôte de la session (pays et fuseau du compte). SECURITY DEFINER, '
  'EXECUTE app_api. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_cmd_create_vehicle(bytea, uuid, uuid, text, text, uuid, text, text, integer, text, text, smallint, text, integer, boolean, boolean) IS
  'Véhicule du compte d''hôte de la session : plaque et VIN normalisés, uniques '
  '(VEHICLE_PLATE_DUPLICATE) ; variante ACTIVE du marché du compte. SECURITY DEFINER, EXECUTE '
  'app_api. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_cmd_create_listing(bytea, uuid, uuid, bigint, text, integer, bigint, boolean) IS
  'Annonce DRAFT d''un véhicule du compte (une par véhicule) ; prix et distance validés. '
  'SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_cmd_update_listing_pricing(bytea, uuid, uuid, bigint, text, integer, bigint) IS
  'Tarif d''une annonce du compte ; sans effet sur les trips confirmés. SECURITY DEFINER, EXECUTE '
  'app_api. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_cmd_add_listing_photo(bytea, uuid, uuid, uuid, uuid, text, bigint, bytea) IS
  'Photo d''annonce : file_asset PUBLIC_LISTING C0 puis listing_photo PENDING ; rend la clé de '
  'dépôt. SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_cmd_submit_listing(bytea, uuid, uuid) IS
  'Soumission SM-2 DRAFT -> PENDING_REVIEW : photos, compte ACTIVE, pays ouvert ; journalisée. '
  'SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_cmd_delete_listing(bytea, uuid, uuid) IS
  'Suppression SM-2 (DRAFT, BLOCKED_ELIGIBILITY, REJECTED -> DELETED) ; journalisée. SECURITY '
  'DEFINER, EXECUTE app_api. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_host_locations(bytea, uuid) IS
  'Lieux de remise du compte d''hôte de la session (exacts : l''hôte seul). SECURITY DEFINER, '
  'EXECUTE app_api. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_host_vehicles(bytea, uuid) IS
  'Véhicules du compte d''hôte de la session. SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_host_listings(bytea, uuid) IS
  'Annonces du compte d''hôte de la session (hors DELETED). SECURITY DEFINER, EXECUTE app_api. '
  'US-115 (ADR-099).';
COMMENT ON FUNCTION core.catalog_public_listing(uuid) IS
  'Annonce LISTED vue d''un visiteur : colonnes C0, zone approximative seulement (jamais nom, '
  'adresse, point exact, plaque, VIN). SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099).';

REVOKE ALL ON FUNCTION
  core.catalog_cmd_create_location(bytea, uuid, text, text, text, text, text, numeric, numeric),
  core.catalog_cmd_create_vehicle(bytea, uuid, uuid, text, text, uuid, text, text, integer, text,
                                  text, smallint, text, integer, boolean, boolean),
  core.catalog_cmd_create_listing(bytea, uuid, uuid, bigint, text, integer, bigint, boolean),
  core.catalog_cmd_update_listing_pricing(bytea, uuid, uuid, bigint, text, integer, bigint),
  core.catalog_cmd_add_listing_photo(bytea, uuid, uuid, uuid, uuid, text, bigint, bytea),
  core.catalog_cmd_submit_listing(bytea, uuid, uuid),
  core.catalog_cmd_delete_listing(bytea, uuid, uuid),
  core.catalog_host_locations(bytea, uuid),
  core.catalog_host_vehicles(bytea, uuid),
  core.catalog_host_listings(bytea, uuid),
  core.catalog_public_listing(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.catalog_cmd_create_location(bytea, uuid, text, text, text, text, text, numeric, numeric),
  core.catalog_cmd_create_vehicle(bytea, uuid, uuid, text, text, uuid, text, text, integer, text,
                                  text, smallint, text, integer, boolean, boolean),
  core.catalog_cmd_create_listing(bytea, uuid, uuid, bigint, text, integer, bigint, boolean),
  core.catalog_cmd_update_listing_pricing(bytea, uuid, uuid, bigint, text, integer, bigint),
  core.catalog_cmd_add_listing_photo(bytea, uuid, uuid, uuid, uuid, text, bigint, bytea),
  core.catalog_cmd_submit_listing(bytea, uuid, uuid),
  core.catalog_cmd_delete_listing(bytea, uuid, uuid),
  core.catalog_host_locations(bytea, uuid),
  core.catalog_host_vehicles(bytea, uuid),
  core.catalog_host_listings(bytea, uuid),
  core.catalog_public_listing(uuid)
TO app_api;

-- Propriétaire NOLOGIN (CREATE le temps du transfert seulement, mécanique de 0047 / 0061)
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_create_location(bytea, uuid, text, text, text, text, text, numeric,
                                                numeric) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_create_vehicle(bytea, uuid, uuid, text, text, uuid, text, text,
                                               integer, text, text, smallint, text, integer,
                                               boolean, boolean) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_create_listing(bytea, uuid, uuid, bigint, text, integer, bigint,
                                               boolean) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_update_listing_pricing(bytea, uuid, uuid, bigint, text, integer,
                                                       bigint) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_add_listing_photo(bytea, uuid, uuid, uuid, uuid, text, bigint,
                                                  bytea) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_submit_listing(bytea, uuid, uuid) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_cmd_delete_listing(bytea, uuid, uuid) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_host_locations(bytea, uuid) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_host_vehicles(bytea, uuid) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_host_listings(bytea, uuid) OWNER TO catalog_cmd_owner;
ALTER FUNCTION core.catalog_public_listing(uuid) OWNER TO catalog_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 7. F-RLS-01 / N-03 : le véhicule vient du catalogue -------------------------------------------
-- 7.1 Compte et pays d'un véhicule publié (17 §2.3 : org_id = catalog.vehicle_org(vehicle_id)) :
-- le véhicule ET son annonce LISTED ; sinon aucune ligne (hold, blocage et conversion refusés).
-- Exécutée sous cmd_hold_owner (ses seuls appelants : hold, blocage, levée, conversion).
GRANT SELECT (id, org_id, country_code) ON core.catalog_vehicle TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.catalog_vehicle FOR SELECT TO cmd_hold_owner USING (true);
GRANT SELECT (vehicle_id, status) ON core.catalog_listing TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.catalog_listing FOR SELECT TO cmd_hold_owner USING (true);

CREATE OR REPLACE FUNCTION core.booking_vehicle_party(p_vehicle_id uuid)
  RETURNS TABLE (org_id uuid, country_code text)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT v.org_id, v.country_code
    FROM core.catalog_vehicle AS v
    JOIN core.catalog_listing AS l ON l.vehicle_id = v.id
   WHERE v.id = p_vehicle_id AND l.status = 'LISTED'
$fn$;
COMMENT ON FUNCTION core.booking_vehicle_party(uuid) IS
  'Compte d''hôte et pays d''un véhicule publié : catalog_vehicle et son annonce LISTED ; sinon '
  'aucune ligne (fail-closed). US-023, ADR-063 ; US-115 (ADR-099, F-RLS-01).';

-- 7.2 Portée de l'hôte : le véhicule est, au catalogue, un véhicule du compte de la session
-- (ADR-060 « Limites » : app.host_covers_vehicle relit le compte du véhicule). Corps de 0024
-- recopié, plus cette condition. Propriétaire policy_fn_owner (seul lui remplace la fonction).
GRANT SELECT (id, org_id) ON core.catalog_vehicle TO policy_fn_owner;
CREATE POLICY policy_fn_read ON core.catalog_vehicle FOR SELECT TO policy_fn_owner USING (true);

GRANT CREATE ON SCHEMA app TO policy_fn_owner;
SET LOCAL ROLE policy_fn_owner;
CREATE OR REPLACE FUNCTION app.host_covers_vehicle(p_vehicle_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           app.actor_kind() = 'HOST'
           AND p_vehicle_id IS NOT NULL
           AND (app.vehicle_scope() IS NULL OR p_vehicle_id = ANY (app.vehicle_scope()))
           AND EXISTS (SELECT 1
                         FROM core.iam_membership AS m
                         JOIN core.iam_organization AS o ON o.id = m.org_id
                        WHERE m.org_id = app.org_id()
                          AND m.user_id = app.actor_id()
                          AND m.status = 'ACTIVE'
                          AND ((m.role = 'P2P_HOST' AND o.holder_user_id = m.user_id)
                               OR (m.role = 'CO_HOST' AND p_vehicle_id = ANY (m.vehicle_scope))))
           -- US-115 : le véhicule existe au catalogue et appartient au compte de la session
           AND EXISTS (SELECT 1
                         FROM core.catalog_vehicle AS cv
                        WHERE cv.id = p_vehicle_id AND cv.org_id = app.org_id()),
           false)
$fn$;
-- COMMENT exige le propriétaire : posé sous policy_fn_owner, avant RESET ROLE
COMMENT ON FUNCTION app.host_covers_vehicle(uuid) IS
  'Politique : véhicule du catalogue du compte de la session, dans la portée de l''hôte '
  '(titulaire : tout ; co-hôte : vehicle_scope). US-011 ; US-115 (ADR-060, ADR-099).';
RESET ROLE;
REVOKE CREATE ON SCHEMA app FROM policy_fn_owner;

-- 7.3 Clés étrangères (vehicle_id, org_id, country_code) vers catalog_vehicle (ADR-060, N-03) et
-- listing_id du trip vers catalog_listing, validées à la pose : aucune occupation, aucun hold ni
-- trip n'a pu être écrit en production avant le catalogue (booking_vehicle_party ne connaissait
-- aucun véhicule depuis 0037) ; une base qui en contiendrait des orphelins fait échouer la
-- migration, qui n'est qu'une transaction (intégrité d'abord).
ALTER TABLE core.booking_vehicle_occupancy
  ADD CONSTRAINT occupancy_catalog_vehicle_fk FOREIGN KEY (vehicle_id, org_id, country_code)
  REFERENCES core.catalog_vehicle (id, org_id, country_code);
ALTER TABLE core.booking_checkout_hold
  ADD CONSTRAINT checkout_hold_catalog_vehicle_fk FOREIGN KEY (vehicle_id, org_id, country_code)
  REFERENCES core.catalog_vehicle (id, org_id, country_code);
ALTER TABLE core.booking_trip
  ADD CONSTRAINT trip_catalog_vehicle_fk FOREIGN KEY (vehicle_id, org_id, country_code)
  REFERENCES core.catalog_vehicle (id, org_id, country_code);
ALTER TABLE core.booking_trip
  ADD CONSTRAINT trip_catalog_listing_fk FOREIGN KEY (listing_id)
  REFERENCES core.catalog_listing (id);
