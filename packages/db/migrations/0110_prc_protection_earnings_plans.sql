-- 0110 — PRC / CAT / AVL : protections du voyageur et plans de gains de l'hôte, partie serveur.
-- US-226 (partie 226a) ; 19 US-226 (Básica présélectionnée, aucune option « sans protection »,
-- niveau le plus haut refusé à un conducteur de 20 ans ; plan ESTÁNDAR par défaut figé au trip ;
-- changement de plan sans effet sur un trip déjà réservé ; ligne PROTECTION et part de l'assureur
-- ⇒ jambe INSURER de TJ01 ; insurer_contract_active = false ⇒ INSURER_CONTRACT_INACTIVE) ;
-- 16 PRT-001 / PRT-002 / BKG-003 / PRC-018, PRT-007 / PRT-008 / HST-048, PRT-011 ; 08 BR-PRICE-11,
-- BR-PROT-01, BR-PROT-02, BR-PROT-06, E7 ; 17 §2.6, §3.2.5, §7.2 ; BOARD N-141 ; pré-mortem du
-- lot 2 : L2-PM-08, L2-PM-18, L2-PM-19 ; ADR-136. Graine des paramètres : 0111 (générée).
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-136, PROPOSÉS, comme Turo) :
--   - devis prc.quote/3 : la ligne PROTECTION est CALCULÉE par la base comme par l'API, jamais
--     fournie : prix journalier = roundHalfUp(prix journalier net × part du niveau), borné par le
--     plancher et le plafond du niveau, × jours facturables (protection_grid du pays) ; niveau
--     choisi par le voyageur, au moins guest_protection_min_level (absent : niveau de plus petit
--     rang), refusé sous l'âge minimal du niveau (âge déclaré, figé) ; prime due =
--     roundHalfUp(PROTECTION × insurer_premium_share[niveau]) = jambe INSURER ; PLATFORM =
--     complément (08 E7) ; part de l'hôte = host_share_pct du plan du VÉHICULE (sinon
--     host_default_plan), figée dans le devis (hostSharePctFrozen) ;
--   - devis prc.quote/2 : rejeu inchangé (0108), jamais réservable (PROTECTION_LEVEL_REQUIRED au
--     checkout) ; à contracter quand plus aucun client ne l'envoie ;
--   - pays sans contrat d'assureur actif (insurer_contract_active absent ou false) : gel d'un devis
--     prc.quote/3 et checkout refusés, INSURER_CONTRACT_INACTIVE (16 PRT-001) ;
--   - plan de gains par véhicule : registre immuable et versionné (16 PRT-008 : modifiable à tout
--     moment, effet sur les nouveaux devis seulement, un devis figé garde sa part) ; écrit par la
--     seule commande de l'hôte titulaire ; plan absent de host_share_pct du pays ou PRO (sans objet,
--     DEC-FONDATEUR-13) ⇒ EARNINGS_PLAN_NOT_AVAILABLE ;
--   - aucune constante de pays : grille, parts, plans et interrupteurs lus des tables.
--
-- Issues ajoutées : gel ⇒ PROTECTION_LEVEL_REQUIRED, PROTECTION_LEVEL_NOT_ELIGIBLE,
--   INSURER_CONTRACT_INACTIVE ; checkout ⇒ PROTECTION_LEVEL_REQUIRED, INSURER_CONTRACT_INACTIVE ;
--   plan ⇒ DONE, AUTH_REQUIRED, FORBIDDEN, HOST_ACCOUNT_SUSPENDED, VEHICLE_NOT_FOUND,
--   EARNINGS_PLAN_NOT_AVAILABLE.
-- Erreur (SQLSTATE 23000, contrainte) traduite par packages/db/src/errors.ts :
--   catalog_earnings_plan_immutable → IMMUTABLE_RECORD.
--
-- Expand / contract : colonnes, table, fonctions, politiques et droits AJOUTÉS ; contrainte
-- pricing_quote_engine_known élargie (supprimée puis recréée) ; commandes de gel et de checkout
-- remplacées (mêmes signatures, propriétaires et droits) ; politique de lecture des paramètres de
-- cmd_money_owner élargie.
--
-- Retour arrière :
--   DROP FUNCTION core.catalog_listing_earnings_plan(uuid),
--     core.catalog_cmd_set_earnings_plan(bytea, uuid, uuid, text),
--     core.catalog_host_earnings_plans(bytea, uuid), core.booking_checkout_protection(bytea, uuid),
--     core.catalog_earnings_plan_guard() CASCADE ; DROP TABLE core.catalog_vehicle_earnings_plan ;
--   rejouer core.pricing_cmd_freeze_quote et core.booking_cmd_checkout de 0108 ;
--   ALTER TABLE core.pricing_quote DROP CONSTRAINT pricing_quote_protection_v3, DROP COLUMN
--     protection_level, host_plan_code, driver_age (si aucun devis /3) ; remettre
--     pricing_quote_engine_known de 0102 ; recréer la politique cmd_money_quote_read de 0108 ;
--   DROP POLICY catalog_cmd_plan_read ON core.config_param_value ; REVOKE des droits ci-dessous.

-- 1. Devis figé : moteur prc.quote/3, niveau de protection, plan de gains, âge déclaré -----------
ALTER TABLE core.pricing_quote DROP CONSTRAINT pricing_quote_engine_known;
ALTER TABLE core.pricing_quote ADD CONSTRAINT pricing_quote_engine_known
  CHECK (engine_version IN ('prc.quote/1', 'prc.quote/2', 'prc.quote/3'));
ALTER TABLE core.pricing_quote ADD COLUMN protection_level text
  CONSTRAINT pricing_quote_protection_level_format CHECK (protection_level ~ '^[A-Z][A-Z_]{0,31}$');
ALTER TABLE core.pricing_quote ADD COLUMN host_plan_code text
  CONSTRAINT pricing_quote_host_plan_format CHECK (host_plan_code ~ '^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]{0,31}$');
ALTER TABLE core.pricing_quote ADD COLUMN driver_age smallint
  CONSTRAINT pricing_quote_driver_age_valid CHECK (driver_age BETWEEN 0 AND 150);
-- un devis /3 porte toujours un niveau de protection et un plan ; les devis antérieurs, jamais
ALTER TABLE core.pricing_quote ADD CONSTRAINT pricing_quote_protection_v3
  CHECK ((engine_version = 'prc.quote/3') = (protection_level IS NOT NULL)
         AND (engine_version = 'prc.quote/3') = (host_plan_code IS NOT NULL));
COMMENT ON COLUMN core.pricing_quote.protection_level IS
  'Niveau de protection du voyageur figé (16 PRT-001, BKG-003 ; protection_grid) ; devis '
  'prc.quote/3 seulement. US-226, ADR-136.';
COMMENT ON COLUMN core.pricing_quote.host_plan_code IS
  'Plan de gains de l''hôte figé (08 BR-PROT-06 : plan du véhicule, sinon host_default_plan) ; sa '
  'part forme la jambe HOST du devis. US-226, ADR-136.';
COMMENT ON COLUMN core.pricing_quote.driver_age IS
  'Âge déclaré du conducteur, figé (16 BKG-003, PRT-002 : éligibilité du niveau) ; NULL : non '
  'saisi. US-226, ADR-136.';
GRANT INSERT (protection_level, host_plan_code, driver_age) ON core.pricing_quote
  TO cmd_money_owner;
GRANT SELECT (protection_level, driver_age) ON core.pricing_quote TO cmd_hold_owner;
ALTER POLICY cmd_money_quote_read ON core.config_param_value
  USING (key IN ('grace_minutes', 'max_trip_days', 'host_default_plan', 'host_share_pct',
                 'delivery_share_pct', 'extras_share_pct', 'trip_fee_schedule',
                 'quote_validity_minutes', 'quote_freezes_per_guest_hour',
                 'protection_grid', 'guest_protection_min_level', 'insurer_premium_share'));

-- 2. Plan de gains par véhicule (16 PRT-007, PRT-008, HST-048 ; 08 BR-PROT-06) -------------------
CREATE TABLE core.catalog_vehicle_earnings_plan (
  vehicle_id   uuid        NOT NULL REFERENCES core.catalog_vehicle (id),
  version      integer     NOT NULL CONSTRAINT catalog_earnings_plan_version_positive
                                    CHECK (version >= 1),
  org_id       uuid        NOT NULL,
  country_code char(2)     NOT NULL REFERENCES core.config_country (code),
  plan_code    text        NOT NULL CONSTRAINT catalog_earnings_plan_code_format
                                    CHECK (plan_code ~ '^[A-Z][A-Z0-9_ÁÉÍÓÚÑ]{0,31}$'),
  chosen_by    uuid        NOT NULL REFERENCES core.iam_user_account (id),
  chosen_at    timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT catalog_vehicle_earnings_plan_pkey PRIMARY KEY (vehicle_id, version)
);
COMMENT ON TABLE core.catalog_vehicle_earnings_plan IS
  'Plan de gains choisi par l''hôte pour un véhicule (16 PRT-008, vehicle_earnings_plan et '
  'plan_history) : une version par choix, la plus haute est en vigueur ; aucune ligne : '
  'host_default_plan du pays (ESTÁNDAR, OQ-P2P-11). Effet sur les nouveaux devis seulement : un '
  'devis figé garde sa part (pricing_quote.host_plan_code). Écrit par '
  'core.catalog_cmd_set_earnings_plan seulement ; immuable. US-226, ADR-136.';

ALTER TABLE core.catalog_vehicle_earnings_plan ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.catalog_vehicle_earnings_plan FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.catalog_vehicle_earnings_plan TO migrator USING (true)
  WITH CHECK (true);
REVOKE ALL ON core.catalog_vehicle_earnings_plan FROM PUBLIC;
GRANT SELECT, INSERT ON core.catalog_vehicle_earnings_plan TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_sel ON core.catalog_vehicle_earnings_plan FOR SELECT
  TO catalog_cmd_owner USING (true);
CREATE POLICY catalog_cmd_ins ON core.catalog_vehicle_earnings_plan FOR INSERT
  TO catalog_cmd_owner WITH CHECK (true);

CREATE FUNCTION core.catalog_earnings_plan_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'earnings plan record is immutable'
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'catalog_earnings_plan_immutable';
END
$fn$;
REVOKE ALL ON FUNCTION core.catalog_earnings_plan_guard() FROM PUBLIC;
CREATE TRIGGER catalog_vehicle_earnings_plan_guard BEFORE UPDATE OR DELETE
  ON core.catalog_vehicle_earnings_plan
  FOR EACH ROW EXECUTE FUNCTION core.catalog_earnings_plan_guard();
CREATE TRIGGER catalog_vehicle_earnings_plan_no_truncate BEFORE TRUNCATE
  ON core.catalog_vehicle_earnings_plan
  FOR EACH STATEMENT EXECUTE FUNCTION core.catalog_earnings_plan_guard();

-- plans du pays : host_share_pct (par plan) et host_default_plan, lus par catalog_cmd_owner
CREATE POLICY catalog_cmd_plan_read ON core.config_param_value FOR SELECT TO catalog_cmd_owner
  USING (key IN ('host_share_pct', 'host_default_plan'));

-- 3. Commandes et lectures du plan (SECURITY DEFINER, catalog_cmd_owner) ------------------------
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

-- 3.1 Valeur JSON en vigueur d'un paramètre de plan du pays, à platform.now() (aide interne).
CREATE FUNCTION core.catalog_plan_param(p_key text, p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT v.value
    FROM core.config_param_value AS v CROSS JOIN t
   WHERE v.key = p_key AND v.country_code::text = p_country AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= t.ts AND (v.valid_to IS NULL OR v.valid_to > t.ts)
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

-- 3.2 Plan choisi pour le véhicule d'une annonce LISTED (version la plus haute) ; NULL : aucun
-- choix (plan par défaut du pays). Lu par l'API (devis du checkout) et par la commande de gel.
CREATE FUNCTION core.catalog_listing_earnings_plan(p_listing_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p.plan_code
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle_earnings_plan AS p ON p.vehicle_id = l.vehicle_id
   WHERE l.id = p_listing_id AND l.status = 'LISTED'
   ORDER BY p.version DESC
   LIMIT 1
$fn$;

-- 3.3 Choix du plan d'un véhicule par l'hôte titulaire (16 PRT-008) : plan vendu dans le pays
-- (clé de host_share_pct, jamais PRO), nouvelle version ; même plan que la version en vigueur :
-- DONE sans nouvelle version. Effet sur les nouveaux devis seulement.
CREATE FUNCTION core.catalog_cmd_set_earnings_plan(p_token_hash bytea, p_org uuid,
                                                   p_vehicle_id uuid, p_plan_code text)
  RETURNS TABLE (outcome text, plan_code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h         record;
  v_found   boolean;
  v_shares  jsonb;
  v_current text;
  v_version integer;
BEGIN
  SELECT * INTO h FROM core.catalog_host_context(p_token_hash, p_org);
  IF h.outcome <> 'OK' THEN
    RETURN QUERY SELECT h.outcome, NULL::text;
    RETURN;
  END IF;
  IF h.org_status NOT IN ('ONBOARDING', 'PENDING_ACTIVATION', 'ACTIVE') THEN
    RETURN QUERY SELECT 'HOST_ACCOUNT_SUSPENDED'::text, NULL::text;
    RETURN;
  END IF;
  SELECT true INTO v_found
    FROM core.catalog_vehicle AS v
   WHERE v.id = p_vehicle_id AND v.org_id = p_org AND v.country_code = h.country_code;
  IF v_found IS NULL THEN
    RETURN QUERY SELECT 'VEHICLE_NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  -- plans vendus : clés de host_share_pct du pays ; PRO sans objet (pivot P2P), jamais proposé
  v_shares := core.catalog_plan_param('host_share_pct', h.country_code);
  IF p_plan_code IS NULL OR p_plan_code = 'PRO'
     OR pg_catalog.jsonb_typeof(v_shares) IS DISTINCT FROM 'object'
     OR NOT (v_shares ? p_plan_code) THEN
    RETURN QUERY SELECT 'EARNINGS_PLAN_NOT_AVAILABLE'::text, NULL::text;
    RETURN;
  END IF;
  -- deux choix concurrents du même véhicule l'un après l'autre
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('catalog_earnings_plan:' || p_vehicle_id::text, 0));
  SELECT p.plan_code, p.version INTO v_current, v_version
    FROM core.catalog_vehicle_earnings_plan AS p
   WHERE p.vehicle_id = p_vehicle_id
   ORDER BY p.version DESC
   LIMIT 1;
  IF v_current IS NOT DISTINCT FROM p_plan_code THEN
    RETURN QUERY SELECT 'DONE'::text, p_plan_code;
    RETURN;
  END IF;
  INSERT INTO core.catalog_vehicle_earnings_plan (vehicle_id, version, org_id, country_code,
                                                  plan_code, chosen_by)
  VALUES (p_vehicle_id, COALESCE(v_version, 0) + 1, p_org, h.country_code, p_plan_code, h.user_id);
  RETURN QUERY SELECT 'DONE'::text, p_plan_code;
END
$fn$;

-- 3.4 Plans des véhicules du compte de l'hôte titulaire : plan en vigueur (ou plan par défaut du
-- pays), choisi ou non, et plans vendus dans le pays avec leur part (jamais PRO) ; compte sans
-- véhicule : une ligne dont vehicle_id est NULL. Compte d'un autre ou inconnu : aucune ligne.
CREATE FUNCTION core.catalog_host_earnings_plans(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (vehicle_id uuid, plan_code text, chosen boolean, chosen_at timestamptz,
                 default_plan text, offered jsonb)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH h AS (
    SELECT c.country_code,
           core.catalog_plan_param('host_default_plan', c.country_code) #>> '{}' AS default_plan,
           (SELECT pg_catalog.jsonb_object_agg(e.key, e.value)
              FROM pg_catalog.jsonb_each(
                     CASE WHEN pg_catalog.jsonb_typeof(
                                 core.catalog_plan_param('host_share_pct', c.country_code))
                               = 'object'
                          THEN core.catalog_plan_param('host_share_pct', c.country_code)
                          ELSE '{}'::jsonb END) AS e
             WHERE e.key <> 'PRO') AS offered
      FROM core.catalog_host_context(p_token_hash, p_org) AS c
     WHERE c.outcome = 'OK'
  )
  SELECT v.id, COALESCE(p.plan_code, h.default_plan), p.plan_code IS NOT NULL, p.chosen_at,
         h.default_plan, COALESCE(h.offered, '{}'::jsonb)
    FROM h
    -- compte sans véhicule : une ligne sans véhicule (plans vendus seulement)
    LEFT JOIN core.catalog_vehicle AS v ON v.org_id = p_org AND v.country_code = h.country_code
    LEFT JOIN LATERAL (
      SELECT x.plan_code, x.chosen_at FROM core.catalog_vehicle_earnings_plan AS x
       WHERE x.vehicle_id = v.id ORDER BY x.version DESC LIMIT 1) AS p ON true
   ORDER BY v.created_at, v.id
$fn$;

COMMENT ON FUNCTION core.catalog_listing_earnings_plan(uuid) IS
  'Plan de gains choisi pour le véhicule d''une annonce LISTED (NULL : plan par défaut du pays) ; '
  'aucune autre donnée. SECURITY DEFINER, EXECUTE app_api et cmd_money_owner. US-226 (ADR-136).';
COMMENT ON FUNCTION core.catalog_cmd_set_earnings_plan(bytea, uuid, uuid, text) IS
  'Choix du plan de gains d''un véhicule par l''hôte titulaire de la session (16 PRT-008) : plan '
  'vendu dans le pays, nouvelle version ; effet sur les nouveaux devis seulement. SECURITY '
  'DEFINER, EXECUTE app_api. US-226 (ADR-136).';
COMMENT ON FUNCTION core.catalog_host_earnings_plans(bytea, uuid) IS
  'Plans de gains des véhicules du compte de l''hôte titulaire de la session et plans vendus '
  'dans le pays (jamais PRO). SECURITY DEFINER, EXECUTE app_api. US-226 (ADR-136).';
REVOKE ALL ON FUNCTION core.catalog_plan_param(text, text),
  core.catalog_listing_earnings_plan(uuid),
  core.catalog_cmd_set_earnings_plan(bytea, uuid, uuid, text),
  core.catalog_host_earnings_plans(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_listing_earnings_plan(uuid) TO app_api, cmd_money_owner;
GRANT EXECUTE ON FUNCTION core.catalog_cmd_set_earnings_plan(bytea, uuid, uuid, text),
  core.catalog_host_earnings_plans(bytea, uuid) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;

-- 4. Commande de gel remplacée (sous son propriétaire, CREATE accordé le temps du remplacement ;
-- propriétaire, EXECUTE et entrée de security-definer-allowlist.json inchangés) -----------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;
-- 4.1 Figer un devis : rejeu complet par la base (0108) ; prc.quote/3 : protection du voyageur,
-- prime de l'assureur et plan du véhicule rejoués (US-226).
CREATE OR REPLACE FUNCTION core.pricing_cmd_freeze_quote(p_token_hash bytea, p_listing_id uuid,
                                              p_inputs text, p_inputs_hash text,
                                              p_outputs text, p_outputs_hash text)
  RETURNS TABLE (outcome text, quote_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  -- ordre des lignes : celui du moteur (QUOTE_LINE_TYPES), indices du vérificateur de 0054
  c_types   CONSTANT text[] := ARRAY['TRIP_PRICE', 'PROMO_PLATFORM', 'PROMO_HOST', 'TRIP_FEE',
                                     'PROTECTION', 'EXTRAS', 'ENHANCED_ROADSIDE',
                                     'ADDITIONAL_DRIVER_FEE', 'YOUNG_DRIVER_FEE', 'DELIVERY_FEE'];
  v_user    uuid;
  l         record;
  v_in      jsonb;
  v_out     jsonb;
  v_req     jsonb;
  v_ver     text;
  v_v3      boolean;
  v_start   numeric;
  v_end     numeric;
  v_grace   numeric;
  v_max     numeric;
  v_days    numeric;
  v_plan    jsonb;
  v_vplan   text;
  v_host    numeric[];
  v_deliv   numeric[];
  v_extras  numeric[];
  v_fee     numeric;
  v_amounts numeric[] := ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]::numeric[];
  v_taxes   numeric[] := ARRAY[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]::numeric[];
  v_groups  text[]    := ARRAY[NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL]::text[];
  v_rates   integer[] := ARRAY[NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL]::integer[];
  v_third   boolean[] := ARRAY[false, false, false, false, false, false, false, false, false,
                               false]::boolean[];
  v_key     text;
  v_value   jsonb;
  v_i       integer;
  v_cfg     record;
  v_sub     numeric := 0;
  v_tax     numeric := 0;
  v_tax3    numeric := 0;
  v_total   numeric;
  v_hfg     numeric;
  v_out_lines jsonb := '[]'::jsonb;
  v_id      uuid := pg_catalog.gen_random_uuid();
  v_seq     integer := 0;
  v_rate    numeric;
  v_valid   numeric;
  -- US-226 : protection du voyageur
  v_level   text;
  v_age     numeric;
  v_grid    jsonb;
  v_terms   jsonb;
  v_min     jsonb;
  v_minrank numeric;
  v_rank    numeric;
  v_need    jsonb;
  v_price   numeric[];
  v_daily   numeric;
  v_bound   numeric;
  v_share   numeric[];
  v_ins     numeric := 0;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- US-208 (N-130) : documents canoniques bornés en taille avant toute empreinte
  IF pg_catalog.octet_length(p_inputs) > 65536 OR pg_catalog.octet_length(p_outputs) > 65536 THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT * INTO l FROM core.catalog_public_listing(p_listing_id) AS p;
  IF l.listing_id IS NULL THEN
    RETURN QUERY SELECT 'LISTING_NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;

  -- empreintes et forme des documents canoniques (frozen.ts)
  IF p_inputs IS NULL OR p_outputs IS NULL OR p_inputs_hash IS NULL OR p_outputs_hash IS NULL
     OR core.pricing_digest(E'rueda.quote.inputs/1\n', p_inputs) <> p_inputs_hash
     OR core.pricing_digest(E'rueda.quote.outputs/1\n', p_outputs) <> p_outputs_hash THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  BEGIN
    v_in := p_inputs::jsonb;
    v_out := p_outputs::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END;
  v_req := v_in -> 'request';
  v_start := core.pricing_ms(v_req -> 'startAtMs');
  v_end := core.pricing_ms(v_req -> 'endAtMs');
  v_ver := v_out ->> 'engineVersion';
  IF pg_catalog.jsonb_typeof(v_req) IS DISTINCT FROM 'object' OR v_start IS NULL OR v_end IS NULL
     OR v_end <= v_start
     OR pg_catalog.jsonb_typeof(v_req -> 'lines') IS DISTINCT FROM 'object'
     OR v_ver IS NULL OR v_ver NOT IN ('prc.quote/2', 'prc.quote/3')
     OR (v_out ->> 'currency') IS DISTINCT FROM l.currency
     OR core.pricing_minor(v_req -> 'dailyRate') IS DISTINCT FROM l.daily_price_minor::numeric THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  v_v3 := v_ver = 'prc.quote/3';
  -- US-226 : un devis /3 porte un niveau de protection (aucun trip sans protection, 16 PRT-011) et
  -- un âge déclaré entier ou nul ; un devis /2 n'en porte aucun
  IF v_v3 THEN
    IF pg_catalog.jsonb_typeof(v_req -> 'protectionLevel') IS DISTINCT FROM 'string'
       OR (v_req ->> 'protectionLevel') = '' THEN
      RETURN QUERY SELECT 'PROTECTION_LEVEL_REQUIRED'::text, NULL::uuid;
      RETURN;
    END IF;
    v_level := v_req ->> 'protectionLevel';
    IF v_level !~ '^[A-Z][A-Z_]{0,31}$' THEN
      RETURN QUERY SELECT 'PROTECTION_LEVEL_NOT_ELIGIBLE'::text, NULL::uuid;
      RETURN;
    END IF;
    IF pg_catalog.jsonb_typeof(v_req -> 'driverAge') IS NOT DISTINCT FROM 'null'
       OR NOT (v_req ? 'driverAge') THEN
      v_age := NULL;
    ELSE
      v_age := core.pricing_ms(v_req -> 'driverAge');
      IF v_age IS NULL OR v_age < 0 OR v_age > 150 THEN
        RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
        RETURN;
      END IF;
    END IF;
    -- 16 PRT-001 : aucune vente de protection sans contrat d'assureur actif dans le pays
    IF NOT core.config_go_live('insurer_contract_active', l.country_code) THEN
      RETURN QUERY SELECT 'INSURER_CONTRACT_INACTIVE'::text, NULL::uuid;
      RETURN;
    END IF;
  ELSIF (v_req ? 'protectionLevel' AND pg_catalog.jsonb_typeof(v_req -> 'protectionLevel') <> 'null')
        OR (v_req ? 'driverAge' AND pg_catalog.jsonb_typeof(v_req -> 'driverAge') <> 'null') THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  -- un devis ne se fige que pour une période à venir
  IF pg_catalog.to_timestamp(v_start / 1000) <= platform.now() THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- paramètres du pays de l'annonce, en vigueur à platform.now() ; US-226 : plan du véhicule
  -- (devis /3), sinon host_default_plan ; plan absent de host_share_pct ⇒ QUOTE_UNAVAILABLE
  v_grace := core.pricing_ms(core.pricing_param('grace_minutes', l.country_code));
  v_max := core.pricing_ms(core.pricing_param('max_trip_days', l.country_code));
  IF v_v3 THEN
    v_vplan := core.catalog_listing_earnings_plan(p_listing_id);
  END IF;
  v_plan := COALESCE(pg_catalog.to_jsonb(v_vplan),
                     core.pricing_param('host_default_plan', l.country_code));
  IF pg_catalog.jsonb_typeof(v_plan) = 'string' THEN
    v_host := core.pricing_ratio(core.pricing_param('host_share_pct', l.country_code)
                                 -> (v_plan #>> '{}'));
  END IF;
  v_deliv := COALESCE(core.pricing_ratio(core.pricing_param('delivery_share_pct', l.country_code)),
                      v_host);
  v_extras := COALESCE(core.pricing_ratio(core.pricing_param('extras_share_pct', l.country_code)),
                       v_host);
  -- US-208 : durée de validité du devis figé (16 PRC-025 : QUOTE_EXPIRED au-delà) et débit des
  -- devis figés du voyageur (N-130) ; absents ou mal formés ⇒ QUOTE_UNAVAILABLE (BLOCK)
  v_valid := core.pricing_ms(core.pricing_param('quote_validity_minutes', l.country_code));
  v_rate := core.pricing_ms(core.pricing_param('quote_freezes_per_guest_hour', l.country_code));
  IF v_grace IS NULL OR v_grace < 0 OR v_max IS NULL OR v_max < 1 OR v_host IS NULL
     OR v_valid IS NULL OR v_valid < 1 OR v_valid > 1440 OR v_rate IS NULL OR v_rate < 1 THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;
  -- débit : devis figés par ce voyageur sur l'heure glissante, tous véhicules ; deux gels
  -- concurrents du même voyageur l'un après l'autre (verrou de transaction)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('pricing_quote:freeze:' || v_user::text, 0));
  IF (SELECT pg_catalog.count(*) FROM core.pricing_quote AS q
       WHERE q.guest_user_id = v_user
         AND q.frozen_at > platform.now() - pg_catalog.make_interval(hours => 1)) >= v_rate THEN
    RETURN QUERY SELECT 'QUOTE_RATE_LIMITED'::text, NULL::uuid;
    RETURN;
  END IF;

  -- jours facturables : max(1, ceil((fin − début − tolérance) / 24 h)) (17 §2.6, TA07)
  v_days := GREATEST(1, -core.settlement_verify_floor_div(-(v_end - v_start - v_grace * 60000),
                                                          86400000));
  IF v_days > v_max THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;
  IF core.pricing_ms(v_out -> 'billableDays') IS DISTINCT FROM v_days THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  -- lignes : prix du trip et trip fee calculés ici (et la protection d'un devis /3), les autres
  -- lues de la demande (ni TRIP_PRICE ni TRIP_FEE fournis : L2-PM-03, US-704 ; ni PROTECTION
  -- dans un devis /3 : US-226)
  IF (v_req -> 'lines') ?| ARRAY['TRIP_PRICE', 'TRIP_FEE']
     OR (v_v3 AND (v_req -> 'lines') ? 'PROTECTION') THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  FOR v_key, v_value IN SELECT * FROM pg_catalog.jsonb_each(v_req -> 'lines') LOOP
    v_i := pg_catalog.array_position(c_types, v_key);
    IF v_i IS NULL OR core.pricing_minor(v_value) IS NULL THEN
      RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
      RETURN;
    END IF;
    v_amounts[v_i] := core.pricing_minor(v_value);
  END LOOP;
  v_amounts[1] := l.daily_price_minor::numeric * v_days;
  -- trip fee (US-704 ; 08 BR-PRICE-06 ; 16 PRC-012) : max(roundHalfUp(P × taux de la tranche),
  -- minimum), barème trip_fee_schedule du pays en vigueur ; absent ou mal formé ⇒ QUOTE_UNAVAILABLE
  v_fee := core.pricing_trip_fee(v_amounts[1], v_days,
                                 core.pricing_param('trip_fee_schedule', l.country_code));
  IF v_fee IS NULL THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;
  v_amounts[4] := v_fee;
  FOR v_i IN 2 .. 10 LOOP
    IF v_amounts[v_i] < 0 AND c_types[v_i] NOT IN ('PROMO_PLATFORM', 'PROMO_HOST') THEN
      RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
      RETURN;
    END IF;
  END LOOP;
  -- assistance renforcée : non rejouée par la base (aucune grille de prix) ; protection d'un devis
  -- /2 : part de l'assureur non figée
  IF v_amounts[7] <> 0 OR (NOT v_v3 AND v_amounts[5] <> 0) THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- US-226 : protection du voyageur (16 PRC-018, PRT-001, PRT-002, PRT-011 ; 08 BR-PRICE-11, E7)
  IF v_v3 THEN
    v_grid := core.pricing_param('protection_grid', l.country_code);
    IF pg_catalog.jsonb_typeof(v_grid) IS DISTINCT FROM 'object' THEN
      RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
      RETURN;
    END IF;
    -- minimum du pays (absent : niveau de plus petit rang)
    v_min := core.pricing_param('guest_protection_min_level', l.country_code);
    IF v_min IS NULL THEN
      SELECT pg_catalog.min(core.pricing_ms(e.value -> 'rank')) INTO v_minrank
        FROM pg_catalog.jsonb_each(v_grid) AS e;
    ELSIF pg_catalog.jsonb_typeof(v_min) = 'string' THEN
      v_minrank := core.pricing_ms(v_grid -> (v_min #>> '{}') -> 'rank');
    END IF;
    IF v_minrank IS NULL OR v_minrank < 1 THEN
      RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
      RETURN;
    END IF;
    v_terms := v_grid -> v_level;
    IF pg_catalog.jsonb_typeof(v_terms) IS DISTINCT FROM 'object' THEN
      RETURN QUERY SELECT 'PROTECTION_LEVEL_NOT_ELIGIBLE'::text, NULL::uuid;
      RETURN;
    END IF;
    v_rank := core.pricing_ms(v_terms -> 'rank');
    v_price := core.pricing_ratio(v_terms -> 'price');
    v_need := v_terms -> 'minDriverAge';
    IF v_rank IS NULL OR v_rank < 1 OR v_price IS NULL
       OR (pg_catalog.jsonb_typeof(v_need) IS DISTINCT FROM 'null'
           AND core.pricing_ms(v_need) IS NULL) THEN
      RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
      RETURN;
    END IF;
    IF v_rank < v_minrank
       OR (pg_catalog.jsonb_typeof(v_need) = 'number'
           AND (v_age IS NULL OR v_age < core.pricing_ms(v_need))) THEN
      RETURN QUERY SELECT 'PROTECTION_LEVEL_NOT_ELIGIBLE'::text, NULL::uuid;
      RETURN;
    END IF;
    -- prix journalier = roundHalfUp(prix journalier net × part), borné par plancher et plafond
    v_daily := core.settlement_verify_round(l.daily_price_minor::numeric, v_price[1], v_price[2]);
    FOR v_key IN SELECT pg_catalog.unnest(ARRAY['dailyFloorMinor', 'dailyCeilingMinor']) LOOP
      IF pg_catalog.jsonb_typeof(v_terms -> v_key) IS NOT DISTINCT FROM 'null' THEN
        CONTINUE;
      END IF;
      v_bound := core.pricing_minor(v_terms -> v_key);
      IF v_bound IS NULL OR v_bound < 0 THEN
        RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
        RETURN;
      END IF;
      v_daily := CASE WHEN v_key = 'dailyFloorMinor' THEN GREATEST(v_daily, v_bound)
                      ELSE LEAST(v_daily, v_bound) END;
    END LOOP;
    v_amounts[5] := v_daily * v_days;
    -- prime due à l'assureur : roundHalfUp(PROTECTION × insurer_premium_share[niveau]) ; part
    -- absente ⇒ aucune vente (jamais une prime nulle)
    v_share := core.pricing_ratio(core.pricing_param('insurer_premium_share', l.country_code)
                                  -> v_level);
    IF v_share IS NULL THEN
      RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
      RETURN;
    END IF;
    v_ins := core.settlement_verify_round(v_amounts[5], v_share[1], v_share[2]);
  END IF;

  -- taxe par ligne selon tax_line_config en vigueur (08 BR-PRICE-12, T43)
  FOR v_i IN 1 .. 10 LOOP
    CONTINUE WHEN v_amounts[v_i] = 0;
    SELECT c.taxable, c.rate_group, c.rate_bps, c.third_party INTO v_cfg
      FROM core.pricing_tax_line_config AS c
     WHERE c.country_code::text = l.country_code AND c.line_type = c_types[v_i]
       AND c.valid_from <= platform.now()
     ORDER BY c.version DESC
     LIMIT 1;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'TAX_CONFIG_MISSING'::text, NULL::uuid;
      RETURN;
    END IF;
    IF v_cfg.taxable THEN
      v_groups[v_i] := v_cfg.rate_group;
      v_rates[v_i] := v_cfg.rate_bps;
      v_taxes[v_i] := core.settlement_verify_round(v_amounts[v_i], v_cfg.rate_bps, 10000);
      v_third[v_i] := v_cfg.third_party;
    END IF;
    v_sub := v_sub + v_amounts[v_i];
    v_tax := v_tax + v_taxes[v_i];
    IF v_third[v_i] THEN
      v_tax3 := v_tax3 + v_taxes[v_i];
    END IF;
    v_out_lines := v_out_lines || pg_catalog.jsonb_build_object(
      'type', c_types[v_i], 'amount', v_amounts[v_i]::text, 'taxGroup', v_groups[v_i],
      'tax', v_taxes[v_i]::text);
  END LOOP;
  v_total := v_sub + v_tax;
  IF v_amounts[1] <= 0 OR v_total <= 0 OR v_total > 9223372036854775807 THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  -- jambes de la capture du total (08 E7) : HOST = hostFromGuest, INSURER = prime due (devis /3,
  -- 0 sinon), TAX_THIRD_PARTY = taxe des groupes third_party, PLATFORM = complément
  v_hfg := core.settlement_verify_host_from_guest(v_amounts, v_host, v_deliv, v_extras);
  IF v_total - v_hfg - v_ins - v_tax3 < 0 THEN
    RETURN QUERY SELECT 'LEG_AMOUNT_NEGATIVE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- les sorties de l'API doivent être exactement celles du rejeu
  IF (v_out -> 'lines') IS DISTINCT FROM v_out_lines
     OR core.pricing_minor(v_out -> 'subtotal') IS DISTINCT FROM v_sub
     OR core.pricing_minor(v_out -> 'taxTotal') IS DISTINCT FROM v_tax
     OR core.pricing_minor(v_out -> 'taxThirdParty') IS DISTINCT FROM v_tax3
     OR core.pricing_minor(v_out -> 'total') IS DISTINCT FROM v_total
     OR core.pricing_minor(v_out -> 'legs' -> 'HOST') IS DISTINCT FROM v_hfg
     OR core.pricing_minor(v_out -> 'legs' -> 'INSURER') IS DISTINCT FROM v_ins
     OR core.pricing_minor(v_out -> 'legs' -> 'TAX_THIRD_PARTY') IS DISTINCT FROM v_tax3
     OR core.pricing_minor(v_out -> 'legs' -> 'PLATFORM')
        IS DISTINCT FROM v_total - v_hfg - v_ins - v_tax3
     OR (v_v3 AND ((v_out ->> 'protectionLevel') IS DISTINCT FROM v_level
                   OR (v_out ->> 'hostPlan') IS DISTINCT FROM (v_plan #>> '{}')))
  THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO core.pricing_quote (id, guest_user_id, listing_id, country_code, currency,
                                  engine_version, period, billable_days, subtotal_minor,
                                  tax_total_minor, tax_third_party_minor, total_minor,
                                  leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
                                  leg_platform_minor, inputs, inputs_hash, outputs, outputs_hash,
                                  expires_at, protection_level, host_plan_code, driver_age)
  VALUES (v_id, v_user, p_listing_id, l.country_code, l.currency, v_ver,
          pg_catalog.tstzrange(pg_catalog.to_timestamp(v_start / 1000),
                               pg_catalog.to_timestamp(v_end / 1000), '[)'),
          v_days::integer, v_sub::bigint, v_tax::bigint, v_tax3::bigint, v_total::bigint,
          v_hfg::bigint, v_ins::bigint, v_tax3::bigint, (v_total - v_hfg - v_ins - v_tax3)::bigint,
          p_inputs, p_inputs_hash, p_outputs, p_outputs_hash,
          platform.now() + pg_catalog.make_interval(mins => v_valid::integer),
          v_level, CASE WHEN v_v3 THEN v_plan #>> '{}' END, v_age::smallint);
  FOR v_i IN 1 .. 10 LOOP
    CONTINUE WHEN v_amounts[v_i] = 0;
    v_seq := v_seq + 1;
    INSERT INTO core.pricing_quote_line (quote_id, seq, line_type, amount_minor, tax_group,
                                         rate_bps, tax_minor, third_party)
    VALUES (v_id, v_seq, c_types[v_i], v_amounts[v_i]::bigint, v_groups[v_i], v_rates[v_i],
            v_taxes[v_i]::bigint, v_third[v_i]);
  END LOOP;
  RETURN QUERY SELECT 'DONE'::text, v_id;
END
$fn$;

COMMENT ON FUNCTION core.pricing_cmd_freeze_quote(bytea, uuid, text, text, text, text) IS
  'Fige un devis du voyageur de la session sur une annonce LISTED : documents bornés, débit '
  'quote_freezes_per_guest_hour, empreintes vérifiées, devis rejoué par la base avec sa '
  'configuration (jours facturables, prix du trip, trip fee, protection du voyageur et prime de '
  'l''assureur en prc.quote/3, plan du véhicule, taxe par ligne, total, jambes) ; tout écart ⇒ '
  'QUOTE_MISMATCH ; pays sans contrat d''assureur actif ⇒ INSURER_CONTRACT_INACTIVE ; expires_at = '
  'gel + quote_validity_minutes. SECURITY DEFINER, EXECUTE app_api. US-202, US-704, US-208, US-226 '
  '(ADR-125, ADR-129, ADR-133, ADR-136).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 5. Checkout : protection exigée, contrat d'assureur actif (sous cmd_hold_owner ; même signature,
-- propriétaire et droits que 0108) ; lecture de la protection du devis -------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 5.1 Protection d'un devis figé du voyageur de la session : niveau, âge déclaré, instant du gel,
-- interrupteur de l'assureur du pays (16 PRT-001 : checkout ouvert ⇒ INSURER_CONTRACT_INACTIVE
-- affiché). Devis d'un autre voyageur ou inconnu : aucune ligne (même réponse).
CREATE FUNCTION core.booking_checkout_protection(p_token_hash bytea, p_quote_id uuid)
  RETURNS TABLE (quote_id uuid, protection_level text, driver_age integer, frozen_at timestamptz,
                 insurer_contract_active boolean)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pq.id, pq.protection_level, pq.driver_age::integer, pq.frozen_at,
         core.config_go_live('insurer_contract_active', pq.country_code::text)
    FROM core.pricing_quote AS pq
   WHERE pq.id = p_quote_id
     AND pq.guest_user_id = (SELECT s.user_id FROM core.iam_session_resolve(p_token_hash) AS s)
$fn$;

-- 5.2 Checkout (0108) : la ligne PROTECTION rejouée par la base engage un prix ; un devis sans
-- protection n'est jamais réservé (PROTECTION_LEVEL_REQUIRED) ; pays sans contrat d'assureur
-- actif ⇒ INSURER_CONTRACT_INACTIVE avant tout autre contrôle de l'annonce.
CREATE OR REPLACE FUNCTION core.booking_cmd_checkout(p_token_hash bytea, p_quote_id uuid,
                                                     p_driver_first text, p_driver_last text,
                                                     p_manual_confirmed boolean,
                                                     p_documents jsonb)
  RETURNS TABLE (outcome text, hold_id uuid, expires_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user       uuid;
  q            record;
  v_vehicle    uuid;
  v_status     text;
  v_instant    boolean;
  v_trans      text;
  v_org        uuid;
  v_country    text;
  v_terms      record;
  v_rows       jsonb := '[]'::jsonb;
  v_hold       uuid;
  v_exp        timestamptz;
  v_prev_kind  text;
  v_prev_actor text;
  v_constraint text;
  v_code       text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- verrou du voyageur, la clé de la pose du hold (ordre voyageur → véhicule, 17 §2.5) : deux
  -- checkouts du même devis l'un après l'autre
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_user::text, 0));

  -- 1. devis du voyageur (16 PRC-025, BKG-001)
  SELECT pq.id, pq.listing_id, pq.country_code, pq.status, pq.period, pq.expires_at INTO q
    FROM core.pricing_quote AS pq
   WHERE pq.id = p_quote_id AND pq.guest_user_id = v_user;
  IF q.id IS NULL THEN
    RETURN QUERY SELECT 'QUOTE_NOT_FOUND'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM core.booking_checkout_acceptance AS a WHERE a.quote_id = q.id) THEN
    RETURN QUERY SELECT 'QUOTE_ALREADY_USED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF q.status IS DISTINCT FROM 'FROZEN' OR q.expires_at IS NULL OR q.expires_at <= platform.now()
  THEN
    RETURN QUERY SELECT 'QUOTE_EXPIRED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- N-129 : seules les lignes rejouées par la base (0102, 0110) engagent un prix
  IF EXISTS (SELECT 1 FROM core.pricing_quote_line AS ln
              WHERE ln.quote_id = q.id
                AND ln.line_type NOT IN ('TRIP_PRICE', 'TRIP_FEE', 'PROTECTION')) THEN
    RETURN QUERY SELECT 'QUOTE_LINE_NOT_SUPPORTED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- US-226 (16 PRT-011) : aucun trip sans protection
  IF NOT EXISTS (SELECT 1 FROM core.pricing_quote_line AS ln
                  WHERE ln.quote_id = q.id AND ln.line_type = 'PROTECTION') THEN
    RETURN QUERY SELECT 'PROTECTION_LEVEL_REQUIRED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  -- US-226 (16 PRT-001) : aucune réservation sans contrat d'assureur actif dans le pays
  IF NOT core.config_go_live('insurer_contract_active', q.country_code::text) THEN
    RETURN QUERY SELECT 'INSURER_CONTRACT_INACTIVE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- 2. annonce publiée, hôte activable, réservation immédiate (N-128)
  SELECT l.vehicle_id, l.status, l.instant_book, v.transmission, v.org_id, v.country_code
    INTO v_vehicle, v_status, v_instant, v_trans, v_org, v_country
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id
   WHERE l.id = q.listing_id;
  IF v_status IS DISTINCT FROM 'LISTED' OR v_country IS DISTINCT FROM q.country_code::text
     OR NOT core.catalog_search_host_open(v_org, v_country) THEN
    RETURN QUERY SELECT 'LISTING_UNAVAILABLE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF v_instant IS DISTINCT FROM true THEN
    RETURN QUERY SELECT 'REQUEST_MODE_UNAVAILABLE'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- 3. conducteur (16 BKG-025, BKG-002)
  IF v_trans = 'MANUAL' AND p_manual_confirmed IS DISTINCT FROM true THEN
    RETURN QUERY SELECT 'MANUAL_TRANSMISSION_NOT_CONFIRMED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  IF NOT core.iam_holder_name_matches(v_user, p_driver_first, p_driver_last) THEN
    RETURN QUERY SELECT 'DRIVER_MUST_BE_ACCOUNT_HOLDER'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;

  -- 4. documents acceptés puis pose du hold, ensemble : un refus de la pose annule aussi les
  -- consentements (sous-transaction). Aucune demande (NULL) : rien d'accepté (la liste des
  -- versions à afficher n'est jamais une acceptation)
  IF p_documents IS NULL THEN
    RETURN QUERY SELECT 'TERMS_NOT_ACCEPTED'::text, NULL::uuid, NULL::timestamptz;
    RETURN;
  END IF;
  BEGIN
    FOR v_terms IN SELECT * FROM core.ctr_checkout_terms(v_user, v_country, p_documents) LOOP
      IF v_terms.outcome <> 'DONE' OR v_terms.consent_id IS NULL THEN
        RETURN QUERY SELECT CASE WHEN v_terms.outcome = 'DONE' THEN 'TERMS_NOT_ACCEPTED'
                                 ELSE v_terms.outcome END, NULL::uuid, NULL::timestamptz;
        RETURN;
      END IF;
      v_rows := v_rows || pg_catalog.jsonb_build_object(
        'kind', v_terms.doc_kind, 'template', v_terms.template_id, 'version', v_terms.doc_version,
        'locale', v_terms.locale, 'consent', v_terms.consent_id);
    END LOOP;
    IF pg_catalog.jsonb_array_length(v_rows) <> 3 THEN
      RAISE EXCEPTION 'checkout: terms incomplete'
        USING ERRCODE = 'internal_error', CONSTRAINT = 'booking_checkout_terms_incomplete';
    END IF;
    -- la pose lit le voyageur dans le contexte de session : celui de la session vérifiée,
    -- remis à sa valeur précédente aussitôt (annulé avec la sous-transaction en cas de refus)
    v_prev_kind := pg_catalog.current_setting('app.actor_kind', true);
    v_prev_actor := pg_catalog.current_setting('app.actor_id', true);
    PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
    PERFORM pg_catalog.set_config('app.actor_id', v_user::text, true);
    -- p_flagged = false : aucune règle de risque avant US-209 (contrôles bloquants à la pose)
    v_hold := core.booking_cmd_place_hold(v_vehicle, pg_catalog.lower(q.period),
                                          pg_catalog.upper(q.period), false);
    PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_prev_kind, ''), true);
    PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_prev_actor, ''), true);
  EXCEPTION
    WHEN object_not_in_prerequisite_state OR check_violation OR exclusion_violation
         OR unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      v_code := CASE v_constraint
        WHEN 'vehicle_occupancy_no_overlap' THEN 'DATES_UNAVAILABLE'
        WHEN 'hold_notice_too_short' THEN 'DATES_NOTICE_TOO_SHORT'
        WHEN 'occupancy_period_invalid' THEN 'QUOTE_EXPIRED'
        WHEN 'hold_guest_overlap' THEN 'GUEST_OVERLAP'
        WHEN 'one_live_hold_per_guest_vehicle' THEN 'HOLD_ALREADY_LIVE'
        WHEN 'hold_guest_limit' THEN 'HOLD_LIMIT_REACHED'
        WHEN 'hold_rate_limited' THEN 'HOLD_RATE_LIMITED'
        WHEN 'hold_self_booking' THEN 'SELF_BOOKING_FORBIDDEN'
        WHEN 'hold_account_restricted' THEN 'ACCOUNT_RESTRICTED'
        WHEN 'hold_kyc_consent_withdrawn' THEN 'KYC_CONSENT_WITHDRAWN'
        WHEN 'hold_host_not_active' THEN 'LISTING_UNAVAILABLE'
        WHEN 'hold_vehicle_unknown' THEN 'LISTING_UNAVAILABLE'
        WHEN 'hold_param_missing' THEN 'BOOKING_UNAVAILABLE'
      END;
      IF v_code IS NULL THEN
        RAISE;
      END IF;
      -- US-127 (ADR-110) : la tentative refusée est signalée à l'ops hors de la sous-transaction
      -- annulée (le signalement reste, le hold et les consentements non)
      IF v_code = 'SELF_BOOKING_FORBIDDEN' THEN
        v_prev_kind := pg_catalog.current_setting('app.actor_kind', true);
        v_prev_actor := pg_catalog.current_setting('app.actor_id', true);
        PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
        PERFORM pg_catalog.set_config('app.actor_id', v_user::text, true);
        PERFORM core.booking_cmd_report_self_booking(v_vehicle);
        PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_prev_kind, ''), true);
        PERFORM pg_catalog.set_config('app.actor_id', COALESCE(v_prev_actor, ''), true);
      END IF;
      RETURN QUERY SELECT v_code, NULL::uuid, NULL::timestamptz;
      RETURN;
  END;

  -- 5. rattachement (16 BKG-008 : version exacte retrouvable après la réservation)
  SELECT h.expires_at INTO v_exp FROM core.booking_checkout_hold AS h WHERE h.id = v_hold;
  INSERT INTO core.booking_checkout_acceptance (hold_id, quote_id, guest_user_id, country_code,
                                                manual_confirmed_at)
  VALUES (v_hold, q.id, v_user, v_country,
          CASE WHEN v_trans = 'MANUAL' THEN platform.now() END);
  INSERT INTO core.booking_checkout_terms (hold_id, doc_kind, template_id, doc_version, locale,
                                           consent_id)
  SELECT v_hold, r ->> 'kind', (r ->> 'template')::uuid, (r ->> 'version')::integer,
         r ->> 'locale', (r ->> 'consent')::uuid
    FROM pg_catalog.jsonb_array_elements(v_rows) AS x(r);
  RETURN QUERY SELECT 'DONE'::text, v_hold, v_exp;
END
$fn$;

COMMENT ON FUNCTION core.booking_checkout_protection(bytea, uuid) IS
  'Protection d''un devis figé du voyageur de la session : niveau, âge déclaré, instant du gel, '
  'insurer_contract_active du pays ; aucune ligne sinon. SECURITY DEFINER, EXECUTE app_api. '
  'US-226 (ADR-136).';
COMMENT ON FUNCTION core.booking_cmd_checkout(bytea, uuid, text, text, boolean, jsonb) IS
  'Checkout en une page (16 BKG-001) : devis figé valide et rejoué, protection présente '
  '(PROTECTION_LEVEL_REQUIRED), contrat d''assureur actif (INSURER_CONTRACT_INACTIVE), annonce '
  'immédiate, conducteur titulaire, boîte manuelle confirmée, documents acceptés, puis pose du '
  'hold CHECKOUT et rattachement, dans une transaction ; aucun paiement. SECURITY DEFINER, EXECUTE '
  'app_api. US-208, US-226 (ADR-133, ADR-136).';
REVOKE ALL ON FUNCTION core.booking_checkout_protection(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_checkout_protection(bytea, uuid) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
