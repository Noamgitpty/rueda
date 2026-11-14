-- 0081 — KYC : vérification de l'hôte par l'ops PAR EXCEPTION (approbation automatique, filtrage
-- manuel des sanctions, dossier de la console), contrat de l'assureur partenaire et couverture du
-- véhicule à la soumission.
-- US-108 ; 19 US-108 (critères 1 à 4) ; 16 VER-028, HST-039, ADM-004, A.8 (`HOST_SCREENING_MISSING`,
-- `INSURER_CONTRACT_INACTIVE`, `VEHICLE_NOT_COVERED`, `HOST_PAYOUT_RAIL_UNAVAILABLE`) ; 08 BR-ACC-06,
-- BR-LIST-01, BR-PROT-01, BR-PROT-10 ; 17 §0.1, §2.4 (KYC de l'hôte, couverture du véhicule),
-- §3.2.2, §3.2.13 (`insurer`, `insurer_contract`, `manual_action`), §10 ; 22 OQ-P2P-03, OQ-BR-16 ;
-- consigne du fondateur du 2026-11-12 « jamais plus lourd que Turo » ; ADR-105, ADR-111 (cette
-- migration). Appliquée sous `migrator`. Paramètre `host_review_manual_required` : graine 0082.
--
-- Principes (ADR-111, PROPOSÉ) :
--   - revue PAR EXCEPTION (consigne du fondateur, comme Turo) : un dossier complet et propre
--     (KYC approuvé, âge, résidence, filtrage CLEAR, profil fiscal, CGU) est APPROUVÉ par le
--     travailleur `review_sla_watch` (acteur SYSTEM), sans l'ops ; l'ops n'intervient que sur
--     signal : retenue de sanctions (`screening_hold`, US-123) ou pays dont
--     `host_review_manual_required[pays]` vaut true (absent : revue exigée, fail-closed ; graine
--     false). Aucune pièce n'est demandée à l'hôte ici ;
--   - indiscernabilité d'US-123 : AUCUNE approbation automatique avant un délai UNIFORME compté
--     depuis la première entrée en revue (`host_review_auto_delay_minutes[pays]`, PROPOSÉ 24 h,
--     absent = jamais) : pendant ce délai, un dossier propre, retenu, signalé ou levé par un ADMIN
--     est vu de l'hôte exactement pareil (même statut réel, rien n'est écrit) ; un faux positif
--     levé dans le délai suit le même chemin que le propre. Résidu observable (ADR-111) : une
--     retenue ou un signal non levés au-delà du délai, et le refus final ;
--   - signaux du compte (état RESTRICTED, CLOSED, BANNED ; restriction active TS_HOLD,
--     POLICY_VIOLATION, KYC_REVOKED, CHARGEBACK) : jamais d'approbation automatique ;
--   - un dossier dont SEUL le filtrage manque est mis en file HOST_VERIFICATION (filtrage manuel
--     depuis l'écran O01, aucun prestataire en production) ;
--   - filtrage MANUEL des sanctions par l'ops (`HOST_SANCTIONS_SCREENING`, repli de la bêta tant
--     qu'aucun prestataire n'est branché) : listes consultées et résultat par liste (énumération
--     fermée), source `OPS_MANUAL`, date de la base, relecteur, action de console liée ; même suite
--     qu'un filtrage du prestataire (correspondance ⇒ retenue, file, événement interne) ;
--   - dossier de l'ops (`support_staff_host_dossier`) : liste de contrôle FERMÉE calculée en base,
--     retenue de sanctions visible du staff seulement, source et date du filtrage, pièces de
--     l'action ; lecture journalisée AVANT d'être rendue ;
--   - contrat de l'assureur partenaire (`settlement_insurer`, `settlement_insurer_contract`, STL) :
--     aucune commande ne l'écrit (entrée par décision écrite du fondateur, story US-227) ; critères
--     d'éligibilité du véhicule (âge, classe de valeur, usage). Soumission d'une annonce : véhicule
--     hors critères ⇒ VEHICLE_NOT_COVERED ; aucun contrat en vigueur ⇒ jamais couvert
--     (INSURER_CONTRACT_INACTIVE, fail-closed). La couverture n'ajoute AUCUNE démarche à l'hôte ;
--   - AUCUN interrupteur n'est écrit ici (17 §0.1) ; l'activation reste celle d'US-123.
--
-- Écarts PROPOSÉS (à reporter, ADR-111) : 19 US-108 décrit une revue systématique par l'ops ; la
-- consigne du fondateur la remplace par une revue par exception ; `sanctions_screening` gagne
-- `manual_action_id` ; `insurer` et `insurer_contract` créés sans leurs colonnes d'argent
-- (`premium_share`, `roadside_share`, `bordereau_period`, `chargeback_clause` : US-227) ;
-- `vehicle_eligibility` = {maxVehicleAgeYears, valueClasses, usages}.
--
-- Retour arrière :
--   DELETE FROM core.support_manual_action_handler WHERE action_code = 'HOST_SANCTIONS_SCREENING' ;
--   DELETE FROM core.support_manual_action_catalog WHERE action_code = 'HOST_SANCTIONS_SCREENING' ;
--   DROP FUNCTION core.support_staff_host_dossier(bytea, uuid, uuid, text),
--     core.kyc_staff_host_dossier(uuid),
--     core.kyc_manual_action_host_sanctions_screening(bytea, uuid, text, uuid, jsonb, text, uuid, text),
--     core.kyc_worker_auto_review_hosts(integer, uuid), core.kyc_host_auto_approve(uuid),
--     core.kyc_host_account_signaled(uuid), core.kyc_host_review_due(text, timestamptz),
--     core.settlement_insurer_vehicle_coverage(text, text, integer, text, text) ;
--   réappliquer core.catalog_cmd_submit_listing de 0074 et core.kyc_host_refresh de 0075 ;
--   ALTER TABLE core.kyc_host_verification DROP COLUMN review_started_at,
--     DROP COLUMN auto_review_attempted_at ; DROP POLICY kyc_cmd_host_signal_read ON
--     core.iam_restriction ;
--   DROP TABLE core.settlement_insurer_contract, core.settlement_insurer ;
--   ALTER TABLE core.kyc_sanctions_screening DROP COLUMN manual_action_id ;
--   DROP POLICY kyc_cmd_host_review_read ON core.config_param_value ;
--   DROP POLICY catalog_cmd_insurer_read ON core.config_param_definition, core.config_param_value ;
--   DROP POLICY kyc_cmd_host_queue_select ON core.support_review_queue_item ; révoquer les droits.

-- 1. Droits de kyc_cmd_owner, au plus juste --------------------------------------------------------
-- revue manuelle exigée par le pays et délai uniforme avant toute approbation automatique (graine
-- 0082 ; absents = revue exigée, aucune approbation automatique)
CREATE POLICY kyc_cmd_host_review_read ON core.config_param_value FOR SELECT TO kyc_cmd_owner
  USING (key IN ('host_review_manual_required', 'host_review_auto_delay_minutes'));
-- élément vivant de la file HOST_VERIFICATION (lecture seule ; clôture par la fonction
-- d'iam_staff_owner accordée en 0075)
CREATE POLICY kyc_cmd_host_queue_select ON core.support_review_queue_item FOR SELECT TO kyc_cmd_owner
  USING (queue = 'HOST_VERIFICATION');

-- 2. Filtrage : action de console qui l'a consigné (filtrage manuel de l'ops) ---------------------
-- La ligne `manual_action` est écrite par le cadre d'US-101 APRÈS la commande liée, dans la même
-- transaction : clé étrangère différée au COMMIT.
ALTER TABLE core.kyc_sanctions_screening
  ADD COLUMN manual_action_id uuid
    CONSTRAINT kyc_sanctions_screening_manual_action_fk
      REFERENCES core.support_manual_action (id) DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT kyc_sanctions_screening_manual_coherent
    CHECK ((provider = 'OPS_MANUAL') = (manual_action_id IS NOT NULL)
           AND (provider <> 'OPS_MANUAL' OR reviewer IS NOT NULL));
COMMENT ON COLUMN core.kyc_sanctions_screening.manual_action_id IS
  'Action de console HOST_SANCTIONS_SCREENING qui a consigné ce filtrage manuel (motif, pièces, '
  'audit) ; NULL pour un filtrage du prestataire. US-108 (ADR-111).';

-- 3. Assureur partenaire et contrat (17 §3.2.13 ; STL) ---------------------------------------------
CREATE TABLE core.settlement_insurer (
  id            uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT settlement_insurer_pkey PRIMARY KEY,
  country_code  text        NOT NULL
    CONSTRAINT settlement_insurer_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  name          text        NOT NULL
    CONSTRAINT settlement_insurer_name_valid
      CHECK (pg_catalog.btrim(name) <> '' AND pg_catalog.char_length(name) <= 160),
  kind          text        NOT NULL
    CONSTRAINT settlement_insurer_kind_valid CHECK (kind IN ('INSURER', 'BROKER')),
  license_ref   text
    CONSTRAINT settlement_insurer_license_format
      CHECK (license_ref IS NULL OR license_ref ~ '^[A-Za-z0-9_.:/-]{1,64}$'),
  status        text        NOT NULL DEFAULT 'ACTIVE'
    CONSTRAINT settlement_insurer_status_valid CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at    timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT settlement_insurer_id_country_unique UNIQUE (id, country_code)
);
COMMENT ON TABLE core.settlement_insurer IS
  'STL insurer (17 §3.2.13) : assureur partenaire (ou courtier agréé) d''un pays (OQ-P2P-03). '
  'Aucune commande ne l''écrit. US-108 (ADR-111) ; colonnes de versement : US-227.';

CREATE TABLE core.settlement_insurer_contract (
  id                   uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT settlement_insurer_contract_pkey PRIMARY KEY,
  insurer_id           uuid        NOT NULL,
  country_code         text        NOT NULL
    CONSTRAINT settlement_insurer_contract_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  version              integer     NOT NULL
    CONSTRAINT settlement_insurer_contract_version_positive CHECK (version >= 1),
  -- critères d'éligibilité du véhicule (17 §2.4 : âge, valeur, usage), forme fermée PROPOSÉE
  vehicle_eligibility  jsonb       NOT NULL
    CONSTRAINT settlement_insurer_contract_eligibility_shape CHECK (
          pg_catalog.jsonb_typeof(vehicle_eligibility) = 'object'
      AND vehicle_eligibility ?& ARRAY['maxVehicleAgeYears', 'usages', 'valueClasses']
      AND (vehicle_eligibility - ARRAY['maxVehicleAgeYears', 'usages', 'valueClasses']) = '{}'::jsonb
      AND pg_catalog.jsonb_typeof(vehicle_eligibility -> 'maxVehicleAgeYears') = 'number'
      AND (vehicle_eligibility ->> 'maxVehicleAgeYears') ~ '^[0-9]{1,2}$'
      AND pg_catalog.jsonb_typeof(vehicle_eligibility -> 'valueClasses') = 'array'
      AND pg_catalog.jsonb_array_length(vehicle_eligibility -> 'valueClasses') >= 1
      AND (vehicle_eligibility -> 'valueClasses') <@ '["STANDARD", "PREMIUM", "LUXE"]'::jsonb
      AND pg_catalog.jsonb_typeof(vehicle_eligibility -> 'usages') = 'array'
      AND pg_catalog.jsonb_array_length(vehicle_eligibility -> 'usages') >= 1
      AND (vehicle_eligibility -> 'usages') <@ '["PARTICULAR"]'::jsonb),
  signed_at            timestamptz NOT NULL,
  valid_from           timestamptz NOT NULL,
  valid_to             timestamptz,
  document_file_id     uuid        REFERENCES core.audit_file_asset (id),
  created_at           timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT settlement_insurer_contract_insurer_fk FOREIGN KEY (insurer_id, country_code)
    REFERENCES core.settlement_insurer (id, country_code),
  CONSTRAINT settlement_insurer_contract_period CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT settlement_insurer_contract_signed CHECK (signed_at <= valid_from),
  CONSTRAINT settlement_insurer_contract_version_unique UNIQUE (country_code, version),
  -- une version en vigueur par pays à tout instant (17 §3.2.13)
  CONSTRAINT settlement_insurer_contract_no_overlap EXCLUDE USING gist (
    country_code WITH =, pg_catalog.tstzrange(valid_from, valid_to, '[)') WITH &&)
);
COMMENT ON TABLE core.settlement_insurer_contract IS
  'STL insurer_contract (17 §3.2.13) : contrat de Kmino avec l''assureur partenaire du pays, '
  'critères d''éligibilité du véhicule ; une version en vigueur par pays ; aucune commande ne '
  'l''écrit (décision écrite du fondateur). insurer_contract_active[pays] reste un interrupteur '
  'séparé. US-108 (ADR-111) ; colonnes d''argent : US-227.';

ALTER TABLE core.settlement_insurer ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer_contract FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.settlement_insurer TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_insurer_contract TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.settlement_insurer, core.settlement_insurer_contract FROM PUBLIC;
-- lecture par le propriétaire des commandes du catalogue (couverture à la soumission) seulement
GRANT SELECT (id, country_code, status) ON core.settlement_insurer TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.settlement_insurer FOR SELECT TO catalog_cmd_owner
  USING (true);
GRANT SELECT (id, insurer_id, country_code, vehicle_eligibility, valid_from, valid_to)
  ON core.settlement_insurer_contract TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_read ON core.settlement_insurer_contract FOR SELECT TO catalog_cmd_owner
  USING (true);
-- interrupteur du contrat d'assureur du pays, lu par core.config_go_live à la soumission
CREATE POLICY catalog_cmd_insurer_read ON core.config_param_definition FOR SELECT TO catalog_cmd_owner
  USING (key = 'insurer_contract_active');
CREATE POLICY catalog_cmd_insurer_read ON core.config_param_value FOR SELECT TO catalog_cmd_owner
  USING (key = 'insurer_contract_active');

-- 4. Couverture d'un véhicule par le contrat en vigueur (SECURITY INVOKER, EXECUTE au seul
-- catalog_cmd_owner). Issues : COVERED, NOT_COVERED (motifs VEHICLE_AGE, VEHICLE_VALUE_CLASS,
-- VEHICLE_USAGE ; une donnée inconnue n'est jamais couverte), NO_CONTRACT (aucun contrat en
-- vigueur d'un assureur actif : la couverture ne peut pas être vérifiée, fail-closed).
CREATE FUNCTION core.settlement_insurer_vehicle_coverage(p_country text, p_timezone text,
                                                        p_year integer, p_value_class text,
                                                        p_plate_category text)
  RETURNS TABLE (outcome text, reasons text[], contract_id uuid)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now    timestamptz := platform.now();
  v_c      record;
  v_max    integer;
  v_reason text[] := '{}';
BEGIN
  SELECT c.id, c.vehicle_eligibility INTO v_c
    FROM core.settlement_insurer_contract AS c
    JOIN core.settlement_insurer AS i ON i.id = c.insurer_id AND i.country_code = c.country_code
   WHERE c.country_code = p_country AND i.status = 'ACTIVE'
     AND c.valid_from <= v_now AND (c.valid_to IS NULL OR c.valid_to > v_now)
   ORDER BY c.valid_from DESC LIMIT 1;
  IF v_c.id IS NULL THEN
    RETURN QUERY SELECT 'NO_CONTRACT'::text, '{}'::text[], NULL::uuid;
    RETURN;
  END IF;
  v_max := (v_c.vehicle_eligibility ->> 'maxVehicleAgeYears')::integer;
  -- âge en années civiles, au fuseau du véhicule (BR-LIST-02 : « ≤ N ans »)
  IF p_year IS NULL OR p_timezone IS NULL
     OR pg_catalog.date_part('year', v_now AT TIME ZONE p_timezone)::integer - p_year > v_max THEN
    v_reason := v_reason || 'VEHICLE_AGE'::text;
  END IF;
  IF p_value_class IS NULL OR NOT ((v_c.vehicle_eligibility -> 'valueClasses') ? p_value_class) THEN
    v_reason := v_reason || 'VEHICLE_VALUE_CLASS'::text;
  END IF;
  IF p_plate_category IS NULL OR NOT ((v_c.vehicle_eligibility -> 'usages') ? p_plate_category) THEN
    v_reason := v_reason || 'VEHICLE_USAGE'::text;
  END IF;
  RETURN QUERY SELECT CASE WHEN pg_catalog.cardinality(v_reason) = 0 THEN 'COVERED'
                           ELSE 'NOT_COVERED' END::text, v_reason, v_c.id;
END
$fn$;
COMMENT ON FUNCTION core.settlement_insurer_vehicle_coverage(text, text, integer, text, text) IS
  'Couverture d''un véhicule par le contrat d''assureur en vigueur du pays (âge, classe de valeur, '
  'usage) ; sans contrat : NO_CONTRACT (jamais couvert). EXECUTE catalog_cmd_owner. US-108.';
REVOKE ALL ON FUNCTION core.settlement_insurer_vehicle_coverage(text, text, integer, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.settlement_insurer_vehicle_coverage(text, text, integer, text, text)
  TO catalog_cmd_owner;

-- 5. Soumission d'une annonce (corps de 0074 recopié ; deux étapes ajoutées, marquées US-108) -----
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;
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
  v_vehicle uuid;
  v_min     bigint;
  v_photos  integer;
  v_veh     record;
  v_cov     record;
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
  -- véhicule rattaché au catalogue (16 HST-050 « véhicule en brouillon et non publiable » ;
  -- 19 US-114 critère 1) ; sinon l'annonce reste DRAFT
  -- (dernière demande refusée : CATALOG_ADDITION_REJECTED, l'hôte voit le motif ; sinon en attente)
  IF EXISTS (SELECT 1 FROM core.catalog_vehicle AS v
              WHERE v.id = v_vehicle AND v.variant_id IS NULL) THEN
    RETURN QUERY SELECT CASE WHEN (SELECT r.status FROM core.catalog_addition_request AS r
                                    WHERE r.vehicle_id = v_vehicle
                                    ORDER BY r.created_at DESC, r.id DESC LIMIT 1) = 'REJECTED'
                             THEN 'CATALOG_ADDITION_REJECTED' ELSE 'CATALOG_ADDITION_PENDING'
                        END::text, NULL::uuid;
    RETURN;
  END IF;
  -- CGU de l'hôte acceptées dans leur version exigée, dans le pays du compte (19 US-126 ; 16
  -- LEG-001 ; L1-PM-28 : garde dans la commande) ; sinon l'annonce reste DRAFT
  IF core.ctr_host_terms_required(h.user_id, h.country_code) THEN
    RETURN QUERY SELECT 'TERMS_REACCEPT_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- US-108 : véhicule hors des critères du contrat de l'assureur partenaire en vigueur (âge,
  -- valeur, usage ; 17 §2.4, 16 HST-019) ⇒ VEHICLE_NOT_COVERED, l'annonce reste DRAFT. Aucune
  -- démarche de l'hôte : critères jugés sur les données déjà déclarées du véhicule.
  SELECT v.year, v.value_class, v.plate_category, v.timezone INTO v_veh
    FROM core.catalog_vehicle AS v WHERE v.id = v_vehicle;
  SELECT * INTO v_cov
    FROM core.settlement_insurer_vehicle_coverage(h.country_code, v_veh.timezone, v_veh.year,
                                                  v_veh.value_class, v_veh.plate_category);
  IF v_cov.outcome = 'NOT_COVERED' THEN
    RETURN QUERY SELECT 'VEHICLE_NOT_COVERED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- compte d'hôte activé (17 §2.4 ; BOARD N-37) et pays ouvert aux hôtes particuliers (16 HST-005)
  IF h.org_status IS DISTINCT FROM 'ACTIVE'
     OR NOT core.config_go_live('p2p_private_hosts_enabled', h.country_code) THEN
    RETURN QUERY SELECT 'HOST_NOT_ACTIVATED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- US-108 : couverture jamais vérifiable sans contrat en vigueur ni interrupteur ouvert
  -- (fail-closed, 17 §2.4 ; OQ-P2P-03, OQ-BR-16)
  IF v_cov.outcome IS DISTINCT FROM 'COVERED'
     OR NOT core.config_go_live('insurer_contract_active', h.country_code) THEN
    RETURN QUERY SELECT 'INSURER_CONTRACT_INACTIVE'::text, NULL::uuid;
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
COMMENT ON FUNCTION core.catalog_cmd_submit_listing(bytea, uuid, uuid) IS
  'Soumission SM-2 DRAFT -> PENDING_REVIEW : photos, véhicule au catalogue, CGU de l''hôte, '
  'couverture de l''assureur, compte ACTIVE, pays ouvert ; journalisée. SECURITY DEFINER, EXECUTE '
  'app_api. US-115 (ADR-099) ; US-126 (ADR-100) ; US-114 (ADR-104) ; US-108 (ADR-111).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 6. Revue par exception : date d'entrée en revue, échéance uniforme, signaux, approbation ---------
-- 6.1 Dossier : instant de la PREMIÈRE entrée en revue (point de départ du délai uniforme, identique
-- pour un dossier propre et pour un dossier retenu, qui entrent en revue par le même calcul) ;
-- dernière passe du travailleur qui l'a laissé à l'ops (ordre de la passe : aucune famine).
ALTER TABLE core.kyc_host_verification
  ADD COLUMN review_started_at timestamptz,
  ADD COLUMN auto_review_attempted_at timestamptz;
COMMENT ON COLUMN core.kyc_host_verification.review_started_at IS
  'Première entrée en revue (IN_REVIEW) : départ du délai uniforme avant toute approbation '
  'automatique (host_review_auto_delay_minutes). US-108 (ADR-111).';
COMMENT ON COLUMN core.kyc_host_verification.auto_review_attempted_at IS
  'Dernière passe du travailleur review_sla_watch qui a laissé le dossier à l''ops (ordre de la '
  'passe). US-108 (ADR-111).';
GRANT UPDATE (review_started_at, auto_review_attempted_at) ON core.kyc_host_verification
  TO kyc_cmd_owner;

-- 6.2 Statut d'un dossier encore ouvert recalculé (corps de 0075 recopié ; deux changements marqués
-- US-108) : date de première entrée en revue ; mise en file AUSSI d'un dossier dont la seule pièce
-- manquante est le filtrage des sanctions (aucun prestataire : filtrage manuel par l'ops depuis la
-- file, écran O01). Le parcours de l'hôte est inchangé (mêmes statut et pièces manquantes).
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
SET LOCAL ROLE kyc_cmd_owner;
CREATE OR REPLACE FUNCTION core.kyc_host_refresh(p_dossier uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  h        record;
  g        record;
  v_miss   text[] := '{}';
  v_status text;
BEGIN
  SELECT d.* INTO h FROM core.kyc_host_verification AS d WHERE d.id = p_dossier;
  IF h.id IS NULL OR h.status NOT IN ('OPEN', 'DOCS_PENDING', 'IN_REVIEW') THEN
    RETURN h.status;
  END IF;
  SELECT * INTO g FROM core.kyc_host_gates(h.org_id);
  IF g.kyc_id IS NULL THEN v_miss := v_miss || 'HOST_KYC_REQUIRED'::text; END IF;
  IF g.screening_id IS NULL THEN v_miss := v_miss || 'HOST_SCREENING_MISSING'::text; END IF;
  IF g.tax <> 'OK' THEN v_miss := v_miss || 'HOST_TAX_ID_REQUIRED'::text; END IF;
  IF NOT g.terms_ok THEN v_miss := v_miss || 'TERMS_REACCEPT_REQUIRED'::text; END IF;
  v_status := CASE WHEN pg_catalog.cardinality(v_miss) = 0 THEN 'IN_REVIEW' ELSE 'DOCS_PENDING' END;
  -- dossier complet : file de revue de l'ops (échéance du pays ; paramètre absent : pas de file,
  -- le dossier reste visible dans la console)
  IF v_status = 'IN_REVIEW' AND h.status <> 'IN_REVIEW' THEN
    PERFORM 1 FROM core.support_enqueue_review('HOST_VERIFICATION', 'ORGANIZATION', h.org_id,
                                                g.country_code, h.user_id);
  -- US-108 : seul le filtrage des sanctions manque ⇒ file de l'ops (filtrage manuel depuis O01) ;
  -- un élément vivant existant est gardé (EXISTS)
  ELSIF v_status = 'DOCS_PENDING' AND v_miss = ARRAY['HOST_SCREENING_MISSING']::text[] THEN
    PERFORM 1 FROM core.support_enqueue_review('HOST_VERIFICATION', 'ORGANIZATION', h.org_id,
                                                g.country_code, h.user_id);
  END IF;
  UPDATE core.kyc_host_verification AS d
     SET status = v_status, missing = v_miss, identity_verification_id = g.kyc_id,
         age_ok = (g.age = 'OK'), residence_verified = (g.residence = 'VERIFIED'),
         tax_id_checked_at = CASE WHEN g.tax = 'OK' THEN COALESCE(d.tax_id_checked_at, platform.now()) END,
         -- US-108 : première entrée en revue, jamais déplacée ensuite
         review_started_at = CASE WHEN v_status = 'IN_REVIEW'
                                  THEN COALESCE(d.review_started_at, platform.now())
                                  ELSE d.review_started_at END,
         row_version = d.row_version + 1, updated_at = platform.now()
   WHERE d.id = h.id;
  RETURN v_status;
END
$fn$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 6.3 Échéance du délai uniforme (SECURITY INVOKER, EXECUTE au seul kyc_cmd_owner) : vraie si le
-- dossier est entré en revue depuis au moins `host_review_auto_delay_minutes[pays]` minutes
-- (PROPOSÉ 1440, comme le délai d'approbation annoncé par Turo) ; paramètre absent ou mal formé :
-- jamais due (aucune approbation automatique, fail-closed).
CREATE FUNCTION core.kyc_host_review_due(p_country text, p_started timestamptz)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v jsonb := core.kyc_host_param('host_review_auto_delay_minutes', p_country);
BEGIN
  IF p_started IS NULL OR v IS NULL OR pg_catalog.jsonb_typeof(v) <> 'number'
     OR (v #>> '{}') !~ '^[0-9]{1,6}$' THEN
    RETURN false;
  END IF;
  RETURN p_started + pg_catalog.make_interval(mins => (v #>> '{}')::integer) <= platform.now();
END
$fn$;
REVOKE ALL ON FUNCTION core.kyc_host_review_due(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_host_review_due(text, timestamptz) TO kyc_cmd_owner;

-- 6.4 Signaux du compte de la personne (17 §3.2.1) : compte RESTRICTED, CLOSED ou BANNED, ou
-- restriction ACTIVE de confiance et sécurité, de conformité, de KYC ou d'impayé de carte
-- (TS_HOLD, POLICY_VIOLATION, KYC_REVOKED, CHARGEBACK) ⇒ jamais d'approbation automatique.
GRANT SELECT (user_id, kind, active) ON core.iam_restriction TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_host_signal_read ON core.iam_restriction FOR SELECT TO kyc_cmd_owner
  USING (true);
CREATE FUNCTION core.kyc_host_account_signaled(p_user uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE((SELECT u.status IN ('RESTRICTED', 'CLOSED', 'BANNED')
                     FROM core.iam_user_account AS u WHERE u.id = p_user), true)
      OR EXISTS (SELECT 1 FROM core.iam_restriction AS r
                  WHERE r.user_id = p_user AND r.active
                    AND r.kind IN ('TS_HOLD', 'POLICY_VIOLATION', 'KYC_REVOKED', 'CHARGEBACK'))
$fn$;
REVOKE ALL ON FUNCTION core.kyc_host_account_signaled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_host_account_signaled(uuid) TO kyc_cmd_owner;

-- 6.5 Approbation automatique (SECURITY INVOKER, EXECUTE au seul kyc_cmd_owner). Appelée par le
-- travailleur sous le verrou du compte d'hôte. Issues : APPROVED (dossier approuvé, activation
-- tentée : compte ACTIVE ou PENDING_ACTIVATION), NOT_DUE (délai uniforme non écoulé : rien ne
-- change, pour aucun dossier), HELD (retenue de sanctions), SIGNALED (compte restreint ou fermé),
-- REVIEW_REQUIRED (pays qui impose la revue de l'ops, ou paramètre absent), CLAIMED (élément pris
-- en charge par un membre de l'ops : sa décision), NOT_READY (dossier absent, hors revue, ou un
-- contrôle n'est plus rempli). Hors APPROVED, rien n'est écrit sur le dossier.
CREATE FUNCTION core.kyc_host_auto_approve(p_org uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  h      record;
  g      record;
  v_ver  integer;
  v_item record;
BEGIN
  SELECT d.* INTO h FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  IF h.id IS NULL OR h.status <> 'IN_REVIEW' THEN
    RETURN 'NOT_READY';
  END IF;
  -- délai uniforme d'abord : avant l'échéance, un dossier propre et un dossier retenu ou signalé
  -- restent identiques (aucune écriture)
  IF NOT core.kyc_host_review_due(h.country_code, COALESCE(h.review_started_at, h.updated_at)) THEN
    RETURN 'NOT_DUE';
  END IF;
  IF h.screening_hold THEN
    RETURN 'HELD';
  END IF;
  IF core.kyc_host_account_signaled(h.user_id) THEN
    RETURN 'SIGNALED';
  END IF;
  -- revue de l'ops exigée par le pays ; paramètre absent ou mal formé : revue (fail-closed)
  IF core.kyc_host_param('host_review_manual_required', h.country_code) IS DISTINCT FROM 'false'::jsonb THEN
    RETURN 'REVIEW_REQUIRED';
  END IF;
  SELECT i.id, i.assignee_id INTO v_item
    FROM core.support_review_queue_item AS i
   WHERE i.queue = 'HOST_VERIFICATION' AND i.subject_type = 'ORGANIZATION' AND i.subject_id = p_org
     AND i.status IN ('OPEN', 'IN_REVIEW')
   LIMIT 1;
  IF v_item.assignee_id IS NOT NULL THEN
    RETURN 'CLAIMED';
  END IF;
  -- mêmes contrôles que la décision APPROVED de l'ops (0075), à l'horloge de la base
  SELECT * INTO g FROM core.kyc_host_gates(p_org);
  IF g.org_id IS NULL OR g.kyc_id IS NULL OR g.age <> 'OK' OR g.residence = 'MISMATCH'
     OR g.screening_id IS NULL OR g.screening_result IS DISTINCT FROM 'CLEAR'
     OR g.tax <> 'OK' OR NOT g.terms_ok THEN
    RETURN 'NOT_READY';
  END IF;
  UPDATE core.kyc_host_verification AS d
     SET status = 'APPROVED', decided_by = NULL, decided_at = platform.now(),
         identity_verification_id = g.kyc_id, age_ok = true,
         residence_verified = (g.residence = 'VERIFIED'), missing = '{}',
         row_version = d.row_version + 1, updated_at = platform.now()
   WHERE d.id = h.id AND d.status = 'IN_REVIEW' AND NOT d.screening_hold
  RETURNING d.row_version INTO v_ver;
  IF v_ver IS NULL THEN
    RETURN 'NOT_READY';
  END IF;
  INSERT INTO core.outbox_outbox_event
         (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES (platform.uuid_v7(), 'kyc.host_verification.decided', 1, 'host_verification', h.id, v_ver,
          h.country_code, NULL, 'SYSTEM', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('org_id', p_org, 'verification_id', h.id,
                                        'decision', 'APPROVED'),
          p_org::text);
  -- élément vivant de la file (posé par la mise en revue) clôturé : aucune action de l'ops
  IF v_item.id IS NOT NULL THEN
    PERFORM 1 FROM core.support_close_review_item(v_item.id, 'DONE', 'AUTO_APPROVED', NULL);
  END IF;
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after)
  VALUES (NULL, 'SYSTEM', 'HOST_VERIFICATION_DECIDED', 'ORGANIZATION', p_org,
          pg_catalog.jsonb_build_object('status', h.status),
          pg_catalog.jsonb_build_object('country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code),
                                        'verificationId', h.id, 'decision', 'APPROVED',
                                        'mode', 'AUTOMATIC'));
  -- activation tentée aussitôt (17 §2.4) : sinon le compte reste PENDING_ACTIVATION (fail-closed)
  PERFORM 1 FROM core.kyc_host_try_activate(p_org, NULL, 'SYSTEM');
  RETURN 'APPROVED';
END
$fn$;
REVOKE ALL ON FUNCTION core.kyc_host_auto_approve(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_host_auto_approve(uuid) TO kyc_cmd_owner;

-- 7. Travailleur review_sla_watch, partie hôtes (SECURITY DEFINER, EXECUTE app_worker) -------------
-- Dossiers IN_REVIEW non retenus dont le délai uniforme est échu, jamais tentés d'abord, puis du
-- plus anciennement tenté au plus récent (un dossier laissé à l'ops ne bloque jamais la tête du
-- lot) ; pour chacun, verrou consultatif du compte d'hôte TENTÉ (même clé que la soumission, le
-- filtrage et les décisions ; pris ailleurs : sauté, repris à la passe suivante), puis
-- core.kyc_host_auto_approve dans un sous-bloc : une erreur sur un dossier est isolée (comptée,
-- dossier repris plus tard) et ne fait tomber ni la passe ni les alertes de retard. `p_org`
-- restreint la passe à un compte (relance ciblée ; preuves). Issues : approved, kept (laissés à
-- l'ops), skipped (verrou pris), failed (erreur isolée).
CREATE FUNCTION core.kyc_worker_auto_review_hosts(p_batch integer, p_org uuid)
  RETURNS TABLE (approved integer, kept integer, skipped integer, failed integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_c    record;
  v_out  text;
  v_ok   integer := 0;
  v_keep integer := 0;
  v_skip integer := 0;
  v_fail integer := 0;
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.actor_kind', true), '') <> 'WORKER'
     OR COALESCE(pg_catalog.current_setting('app.worker_name', true), '') <> 'review_sla_watch' THEN
    RAISE EXCEPTION 'kyc : réservé au travailleur review_sla_watch'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 10000 THEN
    RAISE EXCEPTION 'kyc : lot invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR v_c IN
    SELECT d.id, d.org_id FROM core.kyc_host_verification AS d
     WHERE d.status = 'IN_REVIEW' AND NOT d.screening_hold
       AND (p_org IS NULL OR d.org_id = p_org)
       AND core.kyc_host_review_due(d.country_code, COALESCE(d.review_started_at, d.updated_at))
     ORDER BY d.auto_review_attempted_at NULLS FIRST, d.review_started_at, d.id
     LIMIT p_batch
  LOOP
    IF NOT pg_catalog.pg_try_advisory_xact_lock(
             pg_catalog.hashtextextended('kyc.host:' || v_c.org_id::text, 0)) THEN
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;
    BEGIN
      v_out := core.kyc_host_auto_approve(v_c.org_id);
    EXCEPTION WHEN OTHERS THEN
      v_out := 'FAILED';
    END;
    IF v_out = 'APPROVED' THEN
      v_ok := v_ok + 1;
    ELSE
      IF v_out = 'FAILED' THEN v_fail := v_fail + 1; ELSE v_keep := v_keep + 1; END IF;
      UPDATE core.kyc_host_verification AS d SET auto_review_attempted_at = platform.now()
       WHERE d.id = v_c.id;
    END IF;
  END LOOP;
  RETURN QUERY SELECT v_ok, v_keep, v_skip, v_fail;
END
$fn$;
COMMENT ON FUNCTION core.kyc_worker_auto_review_hosts(integer, uuid) IS
  'Approbation automatique des dossiers d''hôte complets et propres après le délai uniforme '
  '(revue de l''ops par exception), travailleur review_sla_watch. SECURITY DEFINER, EXECUTE '
  'app_worker. US-108 (ADR-111).';
REVOKE ALL ON FUNCTION core.kyc_worker_auto_review_hosts(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_worker_auto_review_hosts(integer, uuid) TO app_worker;

-- 8. Action de console HOST_SANCTIONS_SCREENING (cadre d'US-101) : filtrage MANUEL par l'ops ------
-- Repli de la bêta (VER-028 « recherche → résultat → consigné (source, date, auteur) ») tant
-- qu'aucun prestataire n'est branché. Sujet = compte d'hôte ; saisie fermée : `unList`,
-- `ofacList`, `nationalList` (listes du pays du compte) ∈ {CLEAR, MATCH}, toutes trois exigées ;
-- motif obligatoire, pièces facultatives (aucune exigence de pièce sans paramètre, consigne du
-- fondateur). Résultat CLEAR si les trois listes sont CLEAR, sinon POTENTIAL_MATCH (escalade à
-- l'ADMIN, US-123). Source `OPS_MANUAL`, date de la base, relecteur, action liée. Même suite qu'un
-- filtrage du prestataire (0075) : CLEAR ⇒ dossier recalculé ; correspondance ⇒ retenue,
-- file, événement interne ; l'hôte n'en voit rien. Issues : DONE (ref_id = dossier),
-- HOST_VERIFICATION_NOT_READY (aucun dossier), HOST_ALREADY_SCREENED (déjà filtré ou décidé),
-- SELF_FORBIDDEN (le membre du staff est le titulaire du compte).
CREATE FUNCTION core.kyc_manual_action_host_sanctions_screening(p_token_hash bytea,
                                                                p_action_id uuid,
                                                                p_action_code text,
                                                                p_subject_id uuid,
                                                                p_input jsonb, p_reason text,
                                                                p_actor uuid, p_actor_role text)
  RETURNS TABLE (outcome text, ref_id uuid, emitted_event_ids uuid[])
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_un     text := p_input ->> 'unList';
  v_ofac   text := p_input ->> 'ofacList';
  v_nat    text := p_input ->> 'nationalList';
  h        record;
  v_result text;
  v_tz     text;
  v_day    text;
  v_scr    uuid;
  v_ver    integer;
  v_ev     uuid;
  v_events uuid[] := '{}';
BEGIN
  IF p_action_code IS DISTINCT FROM 'HOST_SANCTIONS_SCREENING' OR p_subject_id IS NULL
     OR p_action_id IS NULL OR p_actor IS NULL OR p_actor_role IS NULL
     OR v_un IS NULL OR v_un NOT IN ('CLEAR', 'MATCH')
     OR v_ofac IS NULL OR v_ofac NOT IN ('CLEAR', 'MATCH')
     OR v_nat IS NULL OR v_nat NOT IN ('CLEAR', 'MATCH') THEN
    RAISE EXCEPTION 'filtrage manuel : action invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('kyc.host:' || p_subject_id::text, 0));
  SELECT d.id, d.status, d.user_id, d.country_code, d.sanctions_screening_id INTO h
    FROM core.kyc_host_verification AS d WHERE d.org_id = p_subject_id;
  IF h.id IS NULL THEN
    RETURN QUERY SELECT 'HOST_VERIFICATION_NOT_READY'::text, NULL::uuid, '{}'::uuid[];
    RETURN;
  END IF;
  IF h.user_id = p_actor THEN
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, h.id, '{}'::uuid[];
    RETURN;
  END IF;
  IF h.sanctions_screening_id IS NOT NULL OR h.status NOT IN ('OPEN', 'DOCS_PENDING', 'IN_REVIEW') THEN
    RETURN QUERY SELECT 'HOST_ALREADY_SCREENED'::text, h.id, '{}'::uuid[];
    RETURN;
  END IF;
  v_result := CASE WHEN v_un = 'CLEAR' AND v_ofac = 'CLEAR' AND v_nat = 'CLEAR' THEN 'CLEAR'
                   ELSE 'POTENTIAL_MATCH' END;
  -- source et date (VER-028) : listes consultées, datées du jour du pays du compte
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = h.country_code;
  v_day := pg_catalog.to_char(platform.now() AT TIME ZONE COALESCE(v_tz, 'UTC'), 'YYYY-MM-DD');
  INSERT INTO core.kyc_sanctions_screening (subject_id, host_verification_id, provider, request_key,
                                            lists_version, result, match_ref, screened_at,
                                            reviewer, manual_action_id)
  VALUES (h.user_id, h.id, 'OPS_MANUAL', pg_catalog.format('screening:%s:a1', h.id),
          pg_catalog.jsonb_build_object('UN', v_day, 'OFAC', v_day, 'NATIONAL', v_day),
          v_result, NULL, platform.now(), p_actor, p_action_id)
  RETURNING id INTO v_scr;
  IF v_result = 'CLEAR' THEN
    UPDATE core.kyc_host_verification AS d
       SET sanctions_screening_id = v_scr, row_version = d.row_version + 1, updated_at = platform.now()
     WHERE d.id = h.id;
    PERFORM core.kyc_host_refresh(h.id);
  ELSE
    UPDATE core.kyc_host_verification AS d
       SET sanctions_screening_id = v_scr, screening_hold = true, reason_code = 'HOST_SANCTIONS_HIT',
           row_version = d.row_version + 1, updated_at = platform.now()
     WHERE d.id = h.id
    RETURNING d.row_version INTO v_ver;
    -- même statut et mêmes pièces manquantes qu'un dossier propre (aucun oracle pour l'hôte)
    PERFORM core.kyc_host_refresh(h.id);
    PERFORM 1 FROM core.support_enqueue_review('HOST_VERIFICATION', 'ORGANIZATION', p_subject_id,
                                                h.country_code, p_actor);
    v_ev := platform.uuid_v7();
    INSERT INTO core.outbox_outbox_event
           (id, type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
    VALUES (v_ev, 'kyc.host_screening.flagged', 1, 'host_verification', h.id, v_ver,
            h.country_code, NULL, 'SYSTEM', pg_catalog.gen_random_uuid(), p_action_id,
            pg_catalog.jsonb_build_object('org_id', p_subject_id, 'verification_id', h.id,
                                          'reason_code', 'HOST_SANCTIONS_HIT'),
            p_subject_id::text);
    v_events := v_events || v_ev;
  END IF;
  -- motif journalisé : source et résultat, codes seulement
  INSERT INTO core.audit_audit_log (actor_user_id, actor_role, action_code, subject_type,
                                    subject_id, before, after, reason, request_id)
  VALUES (p_actor, p_actor_role, 'HOST_SANCTIONS_SCREENED', 'ORGANIZATION', p_subject_id, NULL,
          pg_catalog.jsonb_build_object('country', h.country_code,
                                        'countries', pg_catalog.jsonb_build_array(h.country_code),
                                        'verificationId', h.id, 'result', v_result,
                                        'source', 'OPS_MANUAL',
                                        'reasonCode', CASE WHEN v_result <> 'CLEAR'
                                                           THEN 'HOST_SANCTIONS_HIT' END),
          NULLIF(pg_catalog.left(pg_catalog.btrim(p_reason), 1000), ''), p_action_id);
  RETURN QUERY SELECT 'DONE'::text, h.id, v_events;
END
$fn$;
COMMENT ON FUNCTION core.kyc_manual_action_host_sanctions_screening(bytea, uuid, text, uuid, jsonb, text, uuid, text) IS
  'Commande liée à HOST_SANCTIONS_SCREENING (cadre d''US-101) : filtrage manuel des sanctions par '
  'l''ops (listes, résultat, source OPS_MANUAL, date, relecteur). EXECUTE iam_staff_owner. US-108.';
REVOKE ALL ON FUNCTION core.kyc_manual_action_host_sanctions_screening(bytea, uuid, text, uuid,
                                                                       jsonb, text, uuid, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_manual_action_host_sanctions_screening(bytea, uuid, text, uuid,
                                                                          jsonb, text, uuid, text)
  TO iam_staff_owner;

-- 9. Dossier de l'hôte pour l'ops (SECURITY DEFINER, EXECUTE au seul iam_staff_owner) -------------
-- Appelé par core.support_staff_host_dossier APRÈS la ligne du journal d'accès, et par elle seule.
-- Liste de contrôle FERMÉE, dans cet ordre (états OK, MISSING, BLOCKED, HELD) : IDENTITY, AGE,
-- RESIDENCE, SANCTIONS, TAX_PROFILE, HOST_TERMS, PAYOUT_ACCOUNT, PSP_CAPABILITIES, COUNTRY_OPEN,
-- INSURER_CONTRACT. Motifs de la revue par exception : SCREENING_HOLD, ACCOUNT_RESTRICTED,
-- COUNTRY_REVIEW. Filtrage :
-- source, date, résultat, relecteur, action liée ; jamais une référence chez le prestataire ni une
-- version de liste.
CREATE FUNCTION core.kyc_staff_host_dossier(p_org uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  h       record;
  g       record;
  s       record;
  v_rev   jsonb;
  v_why   text[] := '{}';
BEGIN
  SELECT d.id, d.status, d.screening_hold, d.reason_code, d.missing, d.decided_at, d.decided_by,
         d.activated_at, d.country_code
    INTO h
    FROM core.kyc_host_verification AS d WHERE d.org_id = p_org;
  SELECT * INTO g FROM core.kyc_host_gates(p_org);
  IF g.org_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT x.provider, x.screened_at, x.result, x.reviewer, x.manual_action_id INTO s
    FROM core.kyc_sanctions_screening AS x WHERE x.id = g.screening_id;
  v_rev := core.kyc_host_param('host_review_manual_required', g.country_code);
  IF COALESCE(h.screening_hold, false) THEN v_why := v_why || 'SCREENING_HOLD'::text; END IF;
  IF core.kyc_host_account_signaled(g.user_id) THEN v_why := v_why || 'ACCOUNT_RESTRICTED'::text; END IF;
  IF v_rev IS DISTINCT FROM 'false'::jsonb THEN v_why := v_why || 'COUNTRY_REVIEW'::text; END IF;
  RETURN pg_catalog.jsonb_build_object(
    'orgId', p_org, 'country', g.country_code, 'orgStatus', g.org_status,
    'verificationId', h.id, 'status', COALESCE(h.status, 'NOT_SUBMITTED'),
    'screeningHold', COALESCE(h.screening_hold, false), 'reasonCode', h.reason_code,
    'missing', COALESCE(pg_catalog.to_jsonb(h.missing), '[]'::jsonb),
    'decidedAt', h.decided_at, 'decidedBy', h.decided_by, 'activatedAt', h.activated_at,
    'reviewReasons', pg_catalog.to_jsonb(v_why),
    'blockers', pg_catalog.to_jsonb(core.kyc_host_blockers(p_org)),
    'screening', CASE WHEN s.provider IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'source', s.provider, 'screenedAt', s.screened_at, 'result', s.result,
      'reviewerId', s.reviewer, 'manualActionId', s.manual_action_id) END,
    'checklist', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('item', 'IDENTITY',
        'state', CASE WHEN g.kyc_id IS NOT NULL THEN 'OK' ELSE 'MISSING' END),
      pg_catalog.jsonb_build_object('item', 'AGE',
        'state', CASE g.age WHEN 'OK' THEN 'OK' WHEN 'UNVERIFIED' THEN 'MISSING' ELSE 'BLOCKED' END),
      pg_catalog.jsonb_build_object('item', 'RESIDENCE',
        'state', CASE WHEN g.residence = 'MISMATCH' THEN 'BLOCKED' ELSE 'OK' END),
      pg_catalog.jsonb_build_object('item', 'SANCTIONS',
        'state', CASE WHEN COALESCE(h.screening_hold, false) THEN 'HELD'
                      WHEN g.screening_id IS NULL THEN 'MISSING'
                      WHEN g.screening_result = 'CLEAR' THEN 'OK' ELSE 'BLOCKED' END),
      pg_catalog.jsonb_build_object('item', 'TAX_PROFILE',
        'state', CASE WHEN g.tax = 'OK' THEN 'OK' ELSE 'MISSING' END),
      pg_catalog.jsonb_build_object('item', 'HOST_TERMS',
        'state', CASE WHEN g.terms_ok THEN 'OK' ELSE 'MISSING' END),
      pg_catalog.jsonb_build_object('item', 'PAYOUT_ACCOUNT',
        'state', CASE WHEN g.submerchant_ok THEN 'OK' ELSE 'MISSING' END),
      pg_catalog.jsonb_build_object('item', 'PSP_CAPABILITIES',
        'state', CASE WHEN g.capabilities_ok THEN 'OK' ELSE 'BLOCKED' END),
      pg_catalog.jsonb_build_object('item', 'COUNTRY_OPEN',
        'state', CASE WHEN g.p2p_open THEN 'OK' ELSE 'BLOCKED' END),
      pg_catalog.jsonb_build_object('item', 'INSURER_CONTRACT',
        'state', CASE WHEN g.insurer_open THEN 'OK' ELSE 'BLOCKED' END)));
END
$fn$;
COMMENT ON FUNCTION core.kyc_staff_host_dossier(uuid) IS
  'Dossier de l''hôte pour l''ops : liste de contrôle fermée calculée en base, retenue de '
  'sanctions, motifs de la revue par exception, source et date du filtrage ; EXECUTE '
  'iam_staff_owner seulement (lecture journalisée par l''appelant). US-108 (ADR-111).';
REVOKE ALL ON FUNCTION core.kyc_staff_host_dossier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_staff_host_dossier(uuid) TO iam_staff_owner;

-- 10. Catalogue et liaison du cadre d'US-101 ---------------------------------------------------------
INSERT INTO core.support_manual_action_catalog
       (action_code, permission_code, mode, subject_type, available, input_keys, input_values,
        requires_approval)
VALUES ('HOST_SANCTIONS_SCREENING', 'ops.review_listing_host', 'DOMAIN_COMMAND', 'ORGANIZATION',
        false, '{unList,ofacList,nationalList}',
        '{"unList": ["CLEAR", "MATCH"], "ofacList": ["CLEAR", "MATCH"], "nationalList": ["CLEAR", "MATCH"]}',
        false);

-- propriétaire NOLOGIN (mécanique de 0075 : CREATE le temps du transfert seulement)
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_auto_approve(uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_review_due(text, timestamptz) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_host_account_signaled(uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_worker_auto_review_hosts(integer, uuid) OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_manual_action_host_sanctions_screening(bytea, uuid, text, uuid, jsonb, text, uuid, text)
  OWNER TO kyc_cmd_owner;
ALTER FUNCTION core.kyc_staff_host_dossier(uuid) OWNER TO kyc_cmd_owner;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

INSERT INTO core.support_manual_action_handler (action_code, handler, story)
VALUES ('HOST_SANCTIONS_SCREENING',
        'core.kyc_manual_action_host_sanctions_screening(bytea, uuid, text, uuid, jsonb, text, uuid, text)'::regprocedure,
        'US-108');

-- 11. Console : dossier de l'hôte (SECURITY DEFINER, iam_staff_owner, EXECUTE au seul app_api) ----
-- Par la file HOST_VERIFICATION seulement (élément ouvert assigné à l'acteur ; ADMIN : tout
-- élément de sa portée), permission `ops.review_listing_host` dans le pays de l'élément, pays du
-- compte d'hôte relu en base ; journalisé READ_C2_SUPPORT AVANT la lecture. Rend le dossier
-- (core.kyc_staff_host_dossier) et les pièces de l'action de filtrage manuel. Issues : GRANTED,
-- CASE_REQUIRED (permission détenue, élément non couvert), FORBIDDEN ; refus journalisés.
GRANT SELECT (evidence_file_ids) ON core.support_manual_action TO iam_staff_owner;
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;
CREATE FUNCTION core.support_staff_host_dossier(p_token_hash bytea, p_request_id uuid,
                                                p_item_id uuid, p_purpose text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s        record;
  v_item     record;
  v_role     text;
  v_reason   text;
  v_access   uuid;
  v_dossier  jsonb;
  v_evidence uuid[];
  v_purpose  text := pg_catalog.btrim(p_purpose);
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR v_purpose IS NULL
     OR pg_catalog.char_length(v_purpose) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'dossier de l''hôte : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REVIEW_QUEUE_ITEM',
                                 p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'DATA_ACCESS',
                                   'permission', 'ops.review_listing_host'),
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT i.id, i.queue, i.subject_type, i.subject_id, i.country_code, i.status, i.assignee_id
    INTO v_item
    FROM core.support_review_queue_item AS i WHERE i.id = p_item_id;
  IF v_item.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'ops.review_listing_host',
                                       ARRAY[v_item.country_code], NULL);
  END IF;
  v_reason := CASE
    WHEN v_item.id IS NULL THEN 'CASE'
    WHEN v_item.queue <> 'HOST_VERIFICATION' OR v_item.subject_type <> 'ORGANIZATION' THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN core.support_country_of_organization(v_item.subject_id) IS DISTINCT FROM v_item.country_code
      THEN 'COUNTRY'
    WHEN v_item.status NOT IN ('OPEN', 'IN_REVIEW') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_item.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    ELSE NULL END;
  IF v_reason IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'REVIEW_QUEUE_ITEM', p_item_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_reason,
                                   'attempted', 'DATA_ACCESS',
                                   'permission', 'ops.review_listing_host',
                                   'access_kind', 'READ_C2_SUPPORT', 'field_or_file', 'host_dossier')
                                 || CASE WHEN v_item.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_item.country_code) END,
                                 v_purpose, p_request_id);
    RETURN QUERY SELECT CASE WHEN v_role IS NOT NULL AND v_reason <> 'COUNTRY' THEN 'CASE_REQUIRED'
                             ELSE 'FORBIDDEN' END::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  -- journal D'ABORD (même instruction : sans journal, pas de donnée)
  v_access := core.support_staff_log_access(v_s.user_id, v_role, 'ORGANIZATION', v_item.subject_id,
                                            'host_dossier', 'READ_C2_SUPPORT', v_purpose,
                                            'item:' || p_item_id::text, p_request_id,
                                            v_item.country_code);
  v_dossier := core.kyc_staff_host_dossier(v_item.subject_id);
  IF v_dossier -> 'screening' ->> 'manualActionId' IS NOT NULL THEN
    SELECT m.evidence_file_ids INTO v_evidence
      FROM core.support_manual_action AS m
     WHERE m.id = (v_dossier -> 'screening' ->> 'manualActionId')::uuid;
  END IF;
  RETURN QUERY SELECT 'GRANTED'::text,
    COALESCE(v_dossier, '{}'::jsonb)
    || pg_catalog.jsonb_build_object('itemId', p_item_id, 'accessId', v_access,
                                     'evidenceFileIds',
                                     pg_catalog.to_jsonb(COALESCE(v_evidence, '{}'::uuid[])));
END
$fn$;
COMMENT ON FUNCTION core.support_staff_host_dossier(bytea, uuid, uuid, text) IS
  'Console : dossier de l''hôte par la file HOST_VERIFICATION (élément assigné ; ADMIN : portée), '
  'ops.review_listing_host, journalisé READ_C2_SUPPORT avant la lecture. US-108 (ADR-111).';
REVOKE ALL ON FUNCTION core.support_staff_host_dossier(bytea, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.support_staff_host_dossier(bytea, uuid, uuid, text) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
