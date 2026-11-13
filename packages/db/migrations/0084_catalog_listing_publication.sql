-- 0084 — CAT : publication immédiate d'une annonce (comme Turo), retrait et revue de l'ops sur signal.
-- US-118 ; 19 US-118 (critères 1 à 4) ; 16 HST-016 / HST-026 (SM-2 complet, `LISTING_HAS_FUTURE_TRIPS`,
-- `LISTING_TRANSITION_FORBIDDEN`, `HOST_NOT_ACTIVATED`, `INSURER_CONTRACT_INACTIVE`), ADM-003
-- (file de revue des annonces, `DECISION_RATIONALE_REQUIRED`) ; 08 BR-LIST-08, BR-LIST-09, SM-2
-- (invariant : LISTED → UNLISTED / DELETED interdit tant qu'un trip est à venir) ; 17 §0.1
-- (interrupteurs), §3.2.3 ; 22 OQ-BR-29 (défaut : retrait refusé si trip futur) ; BOARD N-62
-- (`area_label` sans adresse exacte, `insurer_contract_active` à la publication) ;
-- DEC-FONDATEUR-22 (« jamais plus lourd que Turo ») ; ADR-099, ADR-100, ADR-104, ADR-107 ;
-- ADR-114 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Écart assumé avec 19 US-118 (« publication après revue de l'ops ») et 16 HST-016 (« revue manuelle
-- de toutes les annonces au lancement ») : consigne du fondateur DEC-FONDATEUR-22, qui prime.
-- L'annonce est PUBLIÉE (LISTED) dès que les contrôles automatiques passent ; l'ops n'intervient
-- que sur un signal, ou dans un pays dont le paramètre `listing_manual_review_required[pays]` vaut
-- true (false par défaut, 0085 ; ABSENT ⇒ revue exigée, fail-closed). Un véhicule hors catalogue ne
-- bloque plus l'annonce : marque et modèle saisis suffisent, la demande d'ajout (US-114) suit son
-- cours sans bloquer.
--
-- Principes (ADR-114, PROPOSÉ) :
--   - publication = la commande de soumission de 0067 (même signature, même route) : sources
--     DRAFT, REJECTED (correction puis nouvelle soumission, SM-2) et UNLISTED (remise en ligne) ;
--     contrôles automatiques, dans l'ordre : photos (`listing_min_photos`), zone affichée sans
--     adresse exacte (N-62, `LOCATION_AREA_ADDRESS`), CGU de l'hôte (US-126), compte d'hôte ACTIVE
--     (sa vérification US-123 est alors APPROVED : garde en base de 0075) et pays ouvert
--     (`p2p_private_hosts_enabled`), véhicule publiable (US-124 : `catalog_vehicle_publishable`,
--     motif rendu : VEHICLE_ELIGIBILITY_REQUIRED, VEHICLE_UNDER_REVIEW, VEHICLE_INELIGIBLE,
--     VEHICLE_RELEASED ou la première règle stricte en échec), contrat d'assureur actif dans le
--     pays (`insurer_contract_active`, absent = false, `INSURER_CONTRACT_INACTIVE`) ; tout refus
--     laisse l'annonce dans son état ; issue LISTED (publiée, `published_at`) ou PENDING_REVIEW
--     (revue exigée par le pays : élément de la file LISTING, sujet LISTING) ;
--   - zone affichée (`area_label`, saisie libre, publique) : filtre AUTOMATIQUE
--     `core.catalog_area_label_is_address` (numéro de 3 chiffres ou plus, marque de numéro « N° »,
--     « nro », « # », mot de voie ou de logement suivi d'un numéro, angle de rues « esquina »,
--     « esq. », « c/ ») ; refus à la création du lieu et à la publication, jamais une revue humaine ;
--   - véhicule hors catalogue : la règle CATALOG_ADDITION_PENDING sort de
--     `core.catalog_vehicle_blockers` (corps de 0077 recopié sans elle) ;
--   - retrait par l'hôte (`core.catalog_cmd_unlist_listing`) : LISTED → UNLISTED ; suppression
--     UNLISTED → DELETED ajoutée ; l'un et l'autre refusés tant qu'une occupation TRIP ou HOLD du
--     véhicule finit dans le futur (`LISTING_HAS_FUTURE_TRIPS`, OQ-BR-29, BR-LIST-09) ;
--   - revue de l'ops sur une annonce PENDING_REVIEW (`core.support_staff_decide_listing`, garde de
--     la file LISTING d'US-124 : permission `ops.review_listing_host` dans le pays, élément pris
--     en charge, TOTP) : APPROVE revérifie tout (zone, CGU, compte, pays, véhicule, assureur ; un
--     refus laisse l'annonce PENDING_REVIEW et l'élément ouvert) ; REJECT exige un motif d'une
--     liste fermée (`DECISION_RATIONALE_REQUIRED`) ; décision journalisée (journal chaîné) ;
--   - chaque changement de statut est journalisé (audit_audit_log, codes seulement).
--
-- Défauts PROPOSÉS (ADR-114) : `listing_manual_review_required` = false en PA et en PY ; motifs de
-- refus de l'ops PHOTO_QUALITY, ADDRESS_VISIBLE, VEHICLE_MISMATCH, PROHIBITED_CONTENT ; retrait
-- refusé dès qu'une occupation TRIP ou HOLD finit après platform.now() (hold compris : fail-closed).
--
-- Expand / contract : fonctions, politiques et droits ajoutés ; corps de
-- `core.catalog_cmd_create_location` (0067), `core.catalog_cmd_delete_listing` (0067),
-- `core.catalog_cmd_submit_listing` (0074) et `core.catalog_vehicle_blockers` (0077) remplacés à
-- signature, propriétaire et droits identiques. Le COMPORTEMENT change volontairement : aucune
-- annonce n'a pu être soumise en production (`p2p_private_hosts_enabled` et
-- `insurer_contract_active` valent false partout) ; l'issue de la soumission devient LISTED ou
-- PENDING_REVIEW au lieu de DONE (l'application de cette version la lit ; la version N, servie
-- pendant le déploiement, traduit une issue inconnue en 503 sans rien écrire de plus).
--
-- Retour arrière :
--   réappliquer core.catalog_cmd_create_location et core.catalog_cmd_delete_listing de 0067,
--     core.catalog_cmd_submit_listing de 0074 et core.catalog_vehicle_blockers de 0077 (sous
--     catalog_cmd_owner) ;
--   DROP FUNCTION core.support_staff_decide_listing(bytea, uuid, uuid, text, text),
--     core.catalog_listing_decide(uuid, text, uuid, text, text, text),
--     core.catalog_cmd_unlist_listing(bytea, uuid, uuid),
--     core.catalog_listing_publish_blocker(uuid, uuid, text, text),
--     core.catalog_area_label_is_address(text) ;
--   DROP POLICY catalog_cmd_publish_read ON core.config_param_definition, core.config_param_value ;
--   DROP POLICY catalog_cmd_publish_audit ON core.audit_audit_log ;
--   DROP POLICY catalog_cmd_read ON core.iam_organization ;
--   REVOKE UPDATE (published_at) ON core.catalog_listing FROM catalog_cmd_owner ;
--   REVOKE SELECT (id, holder_user_id, status) ON core.iam_organization FROM catalog_cmd_owner.

-- 1. Droits de catalog_cmd_owner, au plus juste -------------------------------------------------
-- date de publication (17 §3.2.3 `published_at`)
GRANT UPDATE (published_at) ON core.catalog_listing TO catalog_cmd_owner;
-- revue par pays et interrupteur du contrat d'assureur (lus par catalog_param_bool et
-- core.config_go_live) : ces deux clés seulement
CREATE POLICY catalog_cmd_publish_read ON core.config_param_definition FOR SELECT
  TO catalog_cmd_owner
  USING (key IN ('listing_manual_review_required', 'insurer_contract_active'));
CREATE POLICY catalog_cmd_publish_read ON core.config_param_value FOR SELECT
  TO catalog_cmd_owner
  USING (key IN ('listing_manual_review_required', 'insurer_contract_active'));
-- statut et titulaire du compte d'hôte, revérifiés à l'approbation de l'ops (aucune autre colonne)
GRANT SELECT (id, holder_user_id, status) ON core.iam_organization TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.iam_organization FOR SELECT TO catalog_cmd_owner
  USING (true);
-- journal des changements de statut de l'annonce (16 HST-026 : « journalisé avec motif »)
CREATE POLICY catalog_cmd_publish_audit ON core.audit_audit_log FOR INSERT TO catalog_cmd_owner
  WITH CHECK (action_code IN ('LISTING_PUBLISHED', 'LISTING_UNLISTED', 'LISTING_REJECTED')
              AND subject_type = 'LISTING');

-- 1 bis. Motifs du véhicule (corps de 0077 recopié SANS la règle « hors catalogue » :
-- DEC-FONDATEUR-22, un véhicule hors catalogue ne bloque pas l'annonce ; US-114 suit son cours).
-- Propriétaire migrator (0077) et EXECUTE à catalog_cmd_owner inchangés : remplacée sous migrator.
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
  -- âge en années civiles du pays (16 HST-019 : 11 ans refusé au seuil 10)
  IF pg_catalog.date_part('year', v_today)::bigint - v.year > v_age THEN
    r := r || 'VEHICLE_TOO_OLD'::text;
  END IF;
  -- plaque et VIN saisis (le VIN est exigé pour un véhicule de 1981 ou après : ISO 3779),
  -- compteur et titulaire déclarés
  IF v.odometer_km IS NULL OR v.title_holder IS NULL OR (v.vin IS NULL AND v.year >= 1981) THEN
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

-- 2. Fonctions de domaine (catalog_cmd_owner) ----------------------------------------------------
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

-- 2.1 Zone affichée qui ressemble à une adresse exacte (N-62 ; PROPOSÉ, ADR-114). Motifs, sans
-- tenir compte de la casse : un nombre de trois chiffres ou plus (numéro de maison, code postal) ;
-- une marque de numéro suivie d'un chiffre (« N° 12 », « Nº », « n. », « nro », « núm », « # ») ;
-- un mot de voie ou de logement suivi d'un numéro (« Calle 50 », « Av. 3 », « apto 12 »,
-- « casa 4 », « torre 2 », « edificio 9 »…) ; un angle de rues (« esquina », « esq. », « c/ »).
-- Une zone (« Barrio Norte », « Costa del Este », « Villa Morra », « Vía España ») passe.
CREATE FUNCTION core.catalog_area_label_is_address(p_area text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_area IS NOT NULL AND (
       p_area ~ '[0-9]{3,}'
    OR p_area ~* '(^|[^a-z0-9áéíóúñüç])(n[°º.]|nro\.?|n[uú]m(ero)?\.?|#)[[:space:]]*[0-9]'
    OR p_area ~* ('(^|[^a-z0-9áéíóúñüç])(calle|avenida|avda|av|v[ií]a|carrera|cra|street|st|'
                  || 'rua|rue|pasaje|psje|casa|apto|apartamento|apt|depto|dpto|departamento|'
                  || 'piso|lote|manzana|mz|edificio|edif|torre|local|oficina)\.?[[:space:]]*[0-9]')
    OR p_area ~* '(^|[^a-z0-9áéíóúñüç])(esquina|esq)([^a-z0-9áéíóúñüç]|$)'
    OR p_area ~* '(^|[[:space:]])c/')
$fn$;
COMMENT ON FUNCTION core.catalog_area_label_is_address(text) IS
  'Zone affichée qui ressemble à une adresse exacte (numéro de rue, voie ou logement numéroté, '
  'angle de rues) : refusée à la création du lieu et à la publication (BOARD N-62, filtre '
  'automatique, PROPOSÉ). Aide interne sous catalog_cmd_owner. US-118 (ADR-114).';

-- 2.2 Premier motif qui empêche de publier une annonce (NULL : publiable), après la complétude et
-- avant l'écriture, dans l'ordre : zone, CGU de l'hôte, compte d'hôte ACTIVE et pays ouvert,
-- véhicule publiable, contrat d'assureur. `p_user` : personne dont on lit les CGU (hôte de la
-- session, ou titulaire du compte à l'approbation de l'ops).
CREATE FUNCTION core.catalog_listing_publish_blocker(p_listing uuid, p_user uuid, p_country text,
                                                     p_org_status text)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v record;
  r text[];
BEGIN
  SELECT x.id, x.eligibility_status, x.released_at, x.eligibility_submitted_at,
         x.eligibility_checked_at, o.area_label
    INTO v
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS x ON x.id = l.vehicle_id AND x.org_id = l.org_id
    JOIN core.catalog_location AS o ON o.id = x.home_location_id
   WHERE l.id = p_listing AND l.country_code = p_country;
  IF v.id IS NULL THEN
    RETURN 'LISTING_NOT_FOUND';
  END IF;
  -- zone publique sans adresse exacte (BOARD N-62)
  IF core.catalog_area_label_is_address(v.area_label) THEN
    RETURN 'LOCATION_AREA_ADDRESS';
  END IF;
  -- CGU de l'hôte acceptées dans leur version exigée, dans le pays du compte (US-126, L1-PM-28)
  IF p_user IS NULL OR core.ctr_host_terms_required(p_user, p_country) THEN
    RETURN 'TERMS_REACCEPT_REQUIRED';
  END IF;
  -- compte d'hôte activé (sa vérification est APPROVED : garde de 0075) et pays ouvert aux hôtes
  -- particuliers (16 HST-005, BOARD N-37)
  IF p_org_status IS DISTINCT FROM 'ACTIVE'
     OR NOT core.config_go_live('p2p_private_hosts_enabled', p_country) THEN
    RETURN 'HOST_NOT_ACTIVATED';
  END IF;
  -- véhicule publiable (US-124) ; le motif est rendu (19 US-118 critère 2)
  IF v.released_at IS NOT NULL THEN
    RETURN 'VEHICLE_RELEASED';
  END IF;
  IF NOT core.catalog_vehicle_publishable(v.id) THEN
    IF v.eligibility_status = 'INELIGIBLE' THEN
      RETURN 'VEHICLE_INELIGIBLE';
    END IF;
    IF v.eligibility_status = 'PENDING' THEN
      RETURN CASE WHEN v.eligibility_submitted_at IS NOT NULL
                       AND (v.eligibility_checked_at IS NULL
                            OR v.eligibility_checked_at < v.eligibility_submitted_at)
                  THEN 'VEHICLE_UNDER_REVIEW' ELSE 'VEHICLE_ELIGIBILITY_REQUIRED' END;
    END IF;
    -- ELIGIBLE mais une règle stricte ne tient plus (pièce expirée, consentement) : la première
    r := core.catalog_vehicle_blockers(v.id, true);
    RETURN COALESCE(r[1], 'VEHICLE_INELIGIBLE');
  END IF;
  -- contrat d'assureur actif dans le pays (17 §0.1 ; 16 HST-016 ; absent = false)
  IF NOT core.config_go_live('insurer_contract_active', p_country) THEN
    RETURN 'INSURER_CONTRACT_INACTIVE';
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.catalog_listing_publish_blocker(uuid, uuid, text, text) IS
  'Premier motif qui empêche de publier une annonce (zone, CGU, compte ACTIVE, pays ouvert, '
  'véhicule publiable, contrat d''assureur) ; NULL : publiable. Aide interne sous '
  'catalog_cmd_owner. US-118 (ADR-114).';

-- 2.3 Lieu de remise (corps de 0067 recopié ; une étape ajoutée : la zone affichée ne doit pas
-- contenir une adresse exacte, BOARD N-62)
CREATE OR REPLACE FUNCTION core.catalog_cmd_create_location(p_token_hash bytea, p_org uuid,
                                                            p_kind text, p_label text,
                                                            p_address_line text, p_city text,
                                                            p_area_label text, p_lat numeric,
                                                            p_lng numeric)
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
  -- zone publique (16 HST-011, OQ-P2P-05) : jamais une adresse exacte (BOARD N-62)
  IF core.catalog_area_label_is_address(p_area_label) THEN
    RETURN QUERY SELECT 'LOCATION_AREA_ADDRESS'::text, NULL::uuid;
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
COMMENT ON FUNCTION core.catalog_cmd_create_location(bytea, uuid, text, text, text, text, text, numeric, numeric) IS
  'Lieu de remise du compte d''hôte de la session (pays et fuseau du compte) ; zone affichée sans '
  'adresse exacte (LOCATION_AREA_ADDRESS). SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099) ; '
  'US-118 (ADR-114).';

-- 2.4 Publication (corps de 0074 remplacé). Issues : LISTED (publiée), PENDING_REVIEW (revue exigée
-- par le pays), AUTH_REQUIRED, FORBIDDEN, LISTING_NOT_FOUND, LISTING_TRANSITION_FORBIDDEN,
-- PARAM_MISSING, PHOTO_MIN_COUNT et les motifs de core.catalog_listing_publish_blocker.
CREATE OR REPLACE FUNCTION core.catalog_cmd_submit_listing(p_token_hash bytea, p_org uuid,
                                                           p_listing_id uuid)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h         record;
  v_status  text;
  v_min     bigint;
  v_photos  integer;
  v_block   text;
  v_review  boolean;
  v_item    record;
  v_to      text;
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
  -- SM-2 : DRAFT → publication ; REJECTED → correction et nouvelle soumission ; UNLISTED →
  -- remise en ligne ; toute autre source est refusée (19 US-118 critère 1)
  IF v_status NOT IN ('DRAFT', 'REJECTED', 'UNLISTED') THEN
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
  -- contrôles automatiques (zone, CGU, compte, pays, véhicule, assureur) : sinon l'annonce reste
  -- dans son état ; un véhicule hors catalogue ne bloque pas (DEC-FONDATEUR-22)
  v_block := core.catalog_listing_publish_blocker(p_listing_id, h.user_id, h.country_code,
                                                  h.org_status);
  IF v_block IS NOT NULL THEN
    RETURN QUERY SELECT v_block, NULL::uuid;
    RETURN;
  END IF;
  -- revue de l'ops exigée par le pays ? false par défaut (DEC-FONDATEUR-22) ; absent ⇒ exigée
  v_review := COALESCE(core.catalog_param_bool('listing_manual_review_required', h.country_code),
                       true);
  IF v_review THEN
    SELECT * INTO v_item
      FROM core.support_enqueue_review('LISTING', 'LISTING', p_listing_id, h.country_code,
                                       h.user_id);
    IF v_item.outcome IS DISTINCT FROM 'CREATED' AND v_item.outcome IS DISTINCT FROM 'EXISTS' THEN
      RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid;
      RETURN;
    END IF;
    v_to := 'PENDING_REVIEW';
    UPDATE core.catalog_listing AS l
       SET status = v_to, submitted_at = platform.now(), updated_by = h.user_id
     WHERE l.id = p_listing_id;
    INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                      subject_id, before, after)
    VALUES (h.user_id, 'P2P_HOST', 'LISTING_SUBMITTED', 'LISTING', p_listing_id,
            pg_catalog.jsonb_build_object('status', v_status),
            pg_catalog.jsonb_build_object('status', v_to, 'orgId', p_org,
                                          'country', h.country_code, 'itemId', v_item.item_id,
                                          'countries', pg_catalog.jsonb_build_array(h.country_code)));
  ELSE
    v_to := 'LISTED';
    UPDATE core.catalog_listing AS l
       SET status = v_to, submitted_at = platform.now(), published_at = platform.now(),
           updated_by = h.user_id
     WHERE l.id = p_listing_id;
    INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                      subject_id, before, after)
    VALUES (h.user_id, 'P2P_HOST', 'LISTING_PUBLISHED', 'LISTING', p_listing_id,
            pg_catalog.jsonb_build_object('status', v_status),
            pg_catalog.jsonb_build_object('status', v_to, 'orgId', p_org,
                                          'country', h.country_code, 'reason', 'AUTO_CHECKS',
                                          'countries', pg_catalog.jsonb_build_array(h.country_code)));
  END IF;
  RETURN QUERY SELECT v_to, p_listing_id;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_submit_listing(bytea, uuid, uuid) IS
  'Publication SM-2 (DRAFT, REJECTED, UNLISTED -> LISTED ; PENDING_REVIEW si le pays exige la revue) '
  ': photos, zone sans adresse, CGU de l''hôte, compte ACTIVE, pays ouvert, véhicule publiable, '
  'contrat d''assureur ; journalisée. SECURITY DEFINER, EXECUTE app_api. US-115 (ADR-099) ; US-126 '
  '(ADR-100) ; US-114 (ADR-104) ; US-118 (ADR-114).';

-- 2.5 Retrait par l'hôte : LISTED → UNLISTED, refusé tant qu'un trip est à venir (OQ-BR-29,
-- BR-LIST-09). Issues : DONE, AUTH_REQUIRED, FORBIDDEN, LISTING_NOT_FOUND,
-- LISTING_TRANSITION_FORBIDDEN, LISTING_HAS_FUTURE_TRIPS.
CREATE FUNCTION core.catalog_cmd_unlist_listing(p_token_hash bytea, p_org uuid, p_listing_id uuid)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h         record;
  v_status  text;
  v_vehicle uuid;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT l.status, l.vehicle_id INTO v_status, v_vehicle
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_status <> 'LISTED' THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  IF pg_catalog.jsonb_array_length(core.catalog_vehicle_live_bookings(v_vehicle)) > 0 THEN
    RETURN QUERY SELECT 'LISTING_HAS_FUTURE_TRIPS'::text, NULL::uuid;
    RETURN;
  END IF;
  UPDATE core.catalog_listing AS l
     SET status = 'UNLISTED', updated_by = h.user_id
   WHERE l.id = p_listing_id;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (h.user_id, 'P2P_HOST', 'LISTING_UNLISTED', 'LISTING', p_listing_id,
          pg_catalog.jsonb_build_object('status', v_status),
          pg_catalog.jsonb_build_object('status', 'UNLISTED', 'orgId', p_org,
                                        'country', h.country_code, 'reason', 'HOST_REQUEST',
                                        'countries', pg_catalog.jsonb_build_array(h.country_code)));
  RETURN QUERY SELECT 'DONE'::text, p_listing_id;
END
$fn$;
COMMENT ON FUNCTION core.catalog_cmd_unlist_listing(bytea, uuid, uuid) IS
  'Retrait SM-2 LISTED -> UNLISTED par l''hôte, refusé tant qu''un trip ou un hold du véhicule est '
  'à venir (LISTING_HAS_FUTURE_TRIPS) ; journalisé. SECURITY DEFINER, EXECUTE app_api. US-118 '
  '(ADR-114).';

-- 2.6 Suppression (corps de 0067 recopié ; UNLISTED → DELETED ajoutée, refusée tant qu'un trip est
-- à venir : SM-2, BR-LIST-09)
CREATE OR REPLACE FUNCTION core.catalog_cmd_delete_listing(p_token_hash bytea, p_org uuid,
                                                           p_listing_id uuid)
  RETURNS TABLE (outcome text, listing_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h         record;
  v_status  text;
  v_vehicle uuid;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT l.status, l.vehicle_id INTO v_status, v_vehicle
    FROM core.catalog_listing AS l
   WHERE l.id = p_listing_id AND l.org_id = p_org AND l.country_code = h.country_code
     FOR UPDATE;
  IF v_status IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_status NOT IN ('DRAFT', 'BLOCKED_ELIGIBILITY', 'REJECTED', 'UNLISTED') THEN
    RETURN QUERY SELECT 'LISTING_TRANSITION_FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_status = 'UNLISTED'
     AND pg_catalog.jsonb_array_length(core.catalog_vehicle_live_bookings(v_vehicle)) > 0 THEN
    RETURN QUERY SELECT 'LISTING_HAS_FUTURE_TRIPS'::text, NULL::uuid;
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
COMMENT ON FUNCTION core.catalog_cmd_delete_listing(bytea, uuid, uuid) IS
  'Suppression SM-2 (DRAFT, BLOCKED_ELIGIBILITY, REJECTED, UNLISTED -> DELETED ; UNLISTED refusée '
  'tant qu''un trip est à venir) ; journalisée. SECURITY DEFINER, EXECUTE app_api. US-115 '
  '(ADR-099) ; US-118 (ADR-114).';

-- 2.7 Décision de l'ops sur une annonce en revue (fonction de domaine, appelée par la console).
-- APPROVE : tous les contrôles automatiques revérifiés (16 HST-016 : `insurer_contract_active` à
-- false ⇒ INSURER_CONTRACT_INACTIVE, l'annonce reste PENDING_REVIEW) ; REJECT : motif d'une liste
-- fermée (16 ADM-003 `DECISION_RATIONALE_REQUIRED`). Issues : DECIDED (statut rendu),
-- NOT_UNDER_REVIEW, COUNTRY_MISMATCH, DECISION_RATIONALE_REQUIRED et les motifs du blocage.
CREATE FUNCTION core.catalog_listing_decide(p_listing uuid, p_country text, p_actor uuid,
                                            p_actor_role text, p_decision text, p_reason text)
  RETURNS TABLE (outcome text, status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  l       record;
  v_block text;
BEGIN
  IF p_listing IS NULL OR p_decision IS NULL OR p_decision NOT IN ('APPROVE', 'REJECT')
     OR p_actor IS NULL OR p_actor_role IS NULL THEN
    RAISE EXCEPTION 'revue de l''annonce : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.id, x.status, x.country_code, x.org_id, o.status AS org_status, o.holder_user_id
    INTO l
    FROM core.catalog_listing AS x
    JOIN core.iam_organization AS o ON o.id = x.org_id
   WHERE x.id = p_listing
     FOR UPDATE OF x;
  IF l.id IS NULL OR l.status <> 'PENDING_REVIEW' THEN
    RETURN QUERY SELECT 'NOT_UNDER_REVIEW'::text, NULL::text;
    RETURN;
  END IF;
  IF l.country_code IS DISTINCT FROM p_country THEN
    RETURN QUERY SELECT 'COUNTRY_MISMATCH'::text, NULL::text;
    RETURN;
  END IF;
  IF p_decision = 'REJECT' THEN
    IF p_reason IS NULL OR p_reason NOT IN ('PHOTO_QUALITY', 'ADDRESS_VISIBLE', 'VEHICLE_MISMATCH',
                                            'PROHIBITED_CONTENT') THEN
      RETURN QUERY SELECT 'DECISION_RATIONALE_REQUIRED'::text, NULL::text;
      RETURN;
    END IF;
    UPDATE core.catalog_listing AS x SET status = 'REJECTED', updated_by = p_actor
     WHERE x.id = p_listing;
    INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                      subject_id, before, after)
    VALUES (p_actor, p_actor_role, 'LISTING_REJECTED', 'LISTING', p_listing,
            pg_catalog.jsonb_build_object('status', 'PENDING_REVIEW'),
            pg_catalog.jsonb_build_object('status', 'REJECTED', 'orgId', l.org_id,
                                          'country', l.country_code, 'reason', p_reason,
                                          'countries', pg_catalog.jsonb_build_array(l.country_code)));
    RETURN QUERY SELECT 'DECIDED'::text, 'REJECTED'::text;
    RETURN;
  END IF;
  v_block := core.catalog_listing_publish_blocker(p_listing, l.holder_user_id, l.country_code,
                                                  l.org_status);
  IF v_block IS NOT NULL THEN
    RETURN QUERY SELECT v_block, NULL::text;
    RETURN;
  END IF;
  UPDATE core.catalog_listing AS x
     SET status = 'LISTED', published_at = platform.now(), updated_by = p_actor
   WHERE x.id = p_listing;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (p_actor, p_actor_role, 'LISTING_PUBLISHED', 'LISTING', p_listing,
          pg_catalog.jsonb_build_object('status', 'PENDING_REVIEW'),
          pg_catalog.jsonb_build_object('status', 'LISTED', 'orgId', l.org_id,
                                        'country', l.country_code, 'reason', 'OPS_APPROVED',
                                        'countries', pg_catalog.jsonb_build_array(l.country_code)));
  RETURN QUERY SELECT 'DECIDED'::text, 'LISTED'::text;
END
$fn$;
COMMENT ON FUNCTION core.catalog_listing_decide(uuid, text, uuid, text, text, text) IS
  'Décision de l''ops sur une annonce PENDING_REVIEW : APPROVE revérifie les contrôles '
  'automatiques ; REJECT motivé (liste fermée) ; journalisée. SECURITY DEFINER, EXECUTE '
  'iam_staff_owner seul. US-118 (ADR-114).';

REVOKE ALL ON FUNCTION core.catalog_area_label_is_address(text),
  core.catalog_listing_publish_blocker(uuid, uuid, text, text),
  core.catalog_cmd_unlist_listing(bytea, uuid, uuid),
  core.catalog_listing_decide(uuid, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_cmd_unlist_listing(bytea, uuid, uuid) TO app_api;
GRANT EXECUTE ON FUNCTION core.catalog_listing_decide(uuid, text, uuid, text, text, text)
  TO iam_staff_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 3. Commande de la console (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) --------
-- Garde de la file LISTING d'US-124 (`core.support_staff_vehicle_gate`, sujet LISTING) : session,
-- TOTP, permission `ops.review_listing_host` EN COURS dans le pays de l'élément, élément ouvert
-- pris en charge par l'acteur (ADMIN : sa portée) ; refus journalisés. Aucune donnée personnelle
-- n'est lue ni rendue. Issues : DECIDED, NOT_UNDER_REVIEW, DECISION_RATIONALE_REQUIRED, les motifs
-- du blocage (APPROVE) et les issues communes AUTH_REQUIRED, MFA_REQUIRED, CASE_REQUIRED, FORBIDDEN.
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

CREATE FUNCTION core.support_staff_decide_listing(p_token_hash bytea, p_request_id uuid,
                                                  p_item_id uuid, p_decision text, p_reason text)
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
  IF p_request_id IS NULL OR p_item_id IS NULL OR p_decision IS NULL
     OR p_decision NOT IN ('APPROVE', 'REJECT') THEN
    RAISE EXCEPTION 'revue de l''annonce : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_g FROM core.support_staff_vehicle_gate(p_token_hash, p_item_id, 'LISTING',
                                                          'LISTING_REVIEW_DECIDE', p_request_id);
  IF v_g.refusal IS NOT NULL THEN
    RETURN QUERY SELECT v_g.refusal, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_r FROM core.catalog_listing_decide(v_g.subject_id, v_g.country_code, v_g.user_id,
                                                      v_g.role, p_decision, p_reason);
  IF v_r.outcome = 'COUNTRY_MISMATCH' THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_r.outcome <> 'DECIDED' THEN
    RETURN QUERY SELECT v_r.outcome, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO v_c FROM core.support_close_review_item(
    p_item_id, 'DONE', CASE WHEN v_r.status = 'LISTED' THEN 'APPROVED' ELSE 'REJECTED' END,
    v_g.user_id);
  IF v_c.outcome <> 'CLOSED' THEN
    RAISE EXCEPTION 'revue de l''annonce : élément non clos'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  -- journal EN DERNIER (passation US-009) ; codes seulement
  PERFORM core.iam_staff_audit(v_g.user_id, v_g.role, 'LISTING_REVIEW_DECIDED', 'LISTING',
                               v_g.subject_id, pg_catalog.jsonb_build_object('status', 'PENDING_REVIEW'),
                               pg_catalog.jsonb_build_object('country', v_g.country_code,
                                 'status', v_r.status, 'decision', p_decision,
                                 'reason', p_reason, 'itemId', p_item_id),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'DECIDED'::text, pg_catalog.jsonb_build_object(
    'itemId', p_item_id, 'listingId', v_g.subject_id, 'status', v_r.status);
END
$fn$;
COMMENT ON FUNCTION core.support_staff_decide_listing(bytea, uuid, uuid, text, text) IS
  'Décision de l''ops sur une annonce en revue (APPROVE revérifié, REJECT motivé), élément clos, '
  'journal chaîné. SECURITY DEFINER, EXECUTE app_api. US-118 (ADR-114).';
REVOKE ALL ON FUNCTION core.support_staff_decide_listing(bytea, uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_decide_listing(bytea, uuid, uuid, text, text) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
