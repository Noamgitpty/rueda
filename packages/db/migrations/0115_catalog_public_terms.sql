-- 0115 — CAT / STL : conditions affichées sur la fiche et conditions du contrat de l'assureur.
-- Annulation, distance, protection de l'assureur partenaire et caution (S03).
-- US-205 ; 19 US-205 (critères 1 à 4) ; 16 LST-010 (`freeUntil` de BR-CXL-01), LST-012 (distance
-- incluse et prix du km), LST-013 (bloc protection : assureur, RC, franchises, exclusions, caution ;
-- bloc absent si `insurer_contract_active[pays]` = false ou véhicule hors contrat), PRT-003 /
-- PRT-013 (RC tiers incluse à tout niveau, montant lu dans `insurer_contract`, contrat sous le
-- minimum ⇒ non activable) ; 08 BR-CXL-01, BR-CXL-06, BR-MILEAGE-01, BR-PROT-01, BR-PROT-03,
-- BR-PROT-04, BR-PAY-06 ; 17 §2.4, §3.2.13, §0.1 ; 22 OQ-P2P-03, OQ-BR-16, OQ-BR-30 ; pré-mortem du
-- lot 2 L2-PM-08 ; ADR-111 (contrat de l'assureur, US-108), ADR-131 (caution des cartes), ADR-132
-- (fiche), ADR-136 (niveaux de protection) ; ADR-138 (cette migration). Appliquée sous `migrator`,
-- en une transaction.
--
-- Principes (ADR-138, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - conditions du contrat de l'assureur partenaire (`settlement_insurer_contract`, versionné par
--     pays) : courtier, devise, montant de RC tiers par événement, franchise du voyageur par niveau
--     (`BASICA`, `ESTANDAR`, `TOTAL` : les niveaux de `protection_grid`), exclusions principales en
--     es, en, fr et pt-BR. Toutes présentes ou toutes absentes ; AUCUNE commande ne les écrit
--     (entrée par décision écrite du fondateur, comme le contrat, US-227) ; une fois posées, elles
--     ne changent plus (nouvelle version du contrat à la place) ;
--   - garde à l'entrée : RC sous `insurer_rc_minimum[pays]` (0114), minimum absent, ou devise autre
--     que celle du pays ⇒ POLICY_RC_BELOW_MINIMUM / INSURER_CONTRACT_CURRENCY_MISMATCH, rien n'est
--     écrit (16 PRT-003 : « contrat sous le minimum légal paramétré ⇒ contrat non activable ») ;
--   - lecture publique (`core.catalog_public_terms`, SECURITY DEFINER, propriétaire
--     catalog_cmd_owner, EXECUTE au seul app_api) d'une annonce LISTED : paramètres d'annulation du
--     pays et, pour un départ donné, `freeUntil` de BR-CXL-01 calculé à platform.now() (instant de
--     la réservation si elle avait lieu maintenant : borne de 24 h avant le départ, ou dernière
--     minute = 1 h après la réservation, seuil `last_minute_threshold`, OQ-BR-30) ; distance de
--     l'annonce ; caution de la plateforme (même règle que les cartes, 0105) ; protection : rendue
--     SEULEMENT si l'interrupteur `insurer_contract_active[pays]` est vrai, qu'un contrat en vigueur
--     d'un assureur ACTIVE couvre le véhicule (âge, classe, usage : 0081), que ses conditions sont
--     posées, dans la devise de l'annonce, et que la RC atteint TOUJOURS le minimum du pays (relu à
--     la lecture : un minimum relevé après coup retire la promesse) ; sinon `protection_offered` =
--     false et aucune donnée de l'assureur (19 US-205 critère 4 : aucune promesse de couverture) ;
--   - aucune donnée personnelle : ni hôte, ni adresse, ni compte ; les conditions de l'assureur
--     sont publiques (C0).
--
-- Expand / contract : colonnes ajoutées (NULL pour les contrats existants : aucune promesse),
-- fonctions, politique et droits ajoutés ; aucune colonne existante modifiée.
--
-- Retour arrière :
--   DROP FUNCTION core.catalog_public_terms(uuid, timestamptz) ;
--   DROP TRIGGER settlement_insurer_contract_terms_guard ON core.settlement_insurer_contract ;
--   DROP FUNCTION core.settlement_insurer_contract_terms_guard() ;
--   DROP POLICY catalog_cmd_terms_read ON core.config_param_value ;
--   REVOKE SELECT (name, kind, license_ref) ON core.settlement_insurer FROM catalog_cmd_owner ;
--   REVOKE SELECT (version, broker_id, currency, rc_amount_minor, deductibles, exclusions)
--     ON core.settlement_insurer_contract FROM catalog_cmd_owner ;
--   ALTER TABLE core.settlement_insurer_contract DROP CONSTRAINT
--     settlement_insurer_contract_broker_fk, DROP CONSTRAINT settlement_insurer_contract_terms_complete,
--     DROP COLUMN exclusions, DROP COLUMN deductibles, DROP COLUMN rc_amount_minor,
--     DROP COLUMN currency, DROP COLUMN broker_id.

-- 1. Conditions versionnées du contrat de l'assureur partenaire (17 §3.2.13) ---------------------
ALTER TABLE core.settlement_insurer_contract
  ADD COLUMN broker_id uuid,
  ADD COLUMN currency text
    CONSTRAINT settlement_insurer_contract_currency_format
      CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  -- RC tiers par événement, unités mineures de la devise du pays (08 BR-PROT-04)
  ADD COLUMN rc_amount_minor bigint
    CONSTRAINT settlement_insurer_contract_rc_positive
      CHECK (rc_amount_minor IS NULL OR (rc_amount_minor > 0
                                         AND rc_amount_minor <= 100000000000000)),
  -- franchise du voyageur par niveau de protection (unités mineures, texte d'un entier)
  ADD COLUMN deductibles jsonb
    CONSTRAINT settlement_insurer_contract_deductibles_shape CHECK (
      deductibles IS NULL OR (
            pg_catalog.jsonb_typeof(deductibles) = 'object'
        AND deductibles ?& ARRAY['BASICA', 'ESTANDAR', 'TOTAL']
        AND (deductibles - ARRAY['BASICA', 'ESTANDAR', 'TOTAL']) = '{}'::jsonb
        AND pg_catalog.jsonb_typeof(deductibles -> 'BASICA') = 'string'
        AND pg_catalog.jsonb_typeof(deductibles -> 'ESTANDAR') = 'string'
        AND pg_catalog.jsonb_typeof(deductibles -> 'TOTAL') = 'string'
        AND (deductibles ->> 'BASICA') ~ '^(0|[1-9][0-9]{0,13})$'
        AND (deductibles ->> 'ESTANDAR') ~ '^(0|[1-9][0-9]{0,13})$'
        AND (deductibles ->> 'TOTAL') ~ '^(0|[1-9][0-9]{0,13})$')),
  -- exclusions principales du contrat, dans les quatre langues du site (texte de l'assureur)
  ADD COLUMN exclusions jsonb
    CONSTRAINT settlement_insurer_contract_exclusions_shape CHECK (
      exclusions IS NULL OR (
            pg_catalog.jsonb_typeof(exclusions) = 'object'
        AND exclusions ?& ARRAY['es', 'en', 'fr', 'pt-BR']
        AND (exclusions - ARRAY['es', 'en', 'fr', 'pt-BR']) = '{}'::jsonb
        AND pg_catalog.jsonb_typeof(exclusions -> 'es') = 'string'
        AND pg_catalog.jsonb_typeof(exclusions -> 'en') = 'string'
        AND pg_catalog.jsonb_typeof(exclusions -> 'fr') = 'string'
        AND pg_catalog.jsonb_typeof(exclusions -> 'pt-BR') = 'string'
        AND pg_catalog.btrim(exclusions ->> 'es') <> ''
        AND pg_catalog.btrim(exclusions ->> 'en') <> ''
        AND pg_catalog.btrim(exclusions ->> 'fr') <> ''
        AND pg_catalog.btrim(exclusions ->> 'pt-BR') <> ''
        AND pg_catalog.char_length(exclusions ->> 'es') <= 2000
        AND pg_catalog.char_length(exclusions ->> 'en') <= 2000
        AND pg_catalog.char_length(exclusions ->> 'fr') <= 2000
        AND pg_catalog.char_length(exclusions ->> 'pt-BR') <= 2000)),
  -- toutes les conditions ou aucune (un contrat sans conditions ne promet rien)
  ADD CONSTRAINT settlement_insurer_contract_terms_complete CHECK (
        (currency IS NULL) = (rc_amount_minor IS NULL)
    AND (currency IS NULL) = (deductibles IS NULL)
    AND (currency IS NULL) = (exclusions IS NULL)),
  -- courtier agréé du même pays (16 PRT-013 : « assureur et courtier cités »)
  ADD CONSTRAINT settlement_insurer_contract_broker_fk FOREIGN KEY (broker_id, country_code)
    REFERENCES core.settlement_insurer (id, country_code);

COMMENT ON COLUMN core.settlement_insurer_contract.rc_amount_minor IS
  'RC tiers incluse par événement (08 BR-PROT-04, 16 PRT-003), unités mineures de currency ; '
  '>= insurer_rc_minimum[pays] (garde POLICY_RC_BELOW_MINIMUM). US-205 (ADR-138).';
COMMENT ON COLUMN core.settlement_insurer_contract.deductibles IS
  'Franchise du voyageur par niveau de protection (BASICA, ESTANDAR, TOTAL), unités mineures. '
  'US-205 (ADR-138).';
COMMENT ON COLUMN core.settlement_insurer_contract.exclusions IS
  'Exclusions principales du contrat (08 BR-PROT-03), es / en / fr / pt-BR. US-205 (ADR-138).';

-- 1.1 Garde : minimum de RC du pays, devise du pays, conditions immuables une fois posées
CREATE FUNCTION core.settlement_insurer_contract_terms_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now      timestamptz := platform.now();
  v_min      jsonb;
  v_currency text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.currency IS NOT NULL
     AND (NEW.currency IS DISTINCT FROM OLD.currency
          OR NEW.rc_amount_minor IS DISTINCT FROM OLD.rc_amount_minor
          OR NEW.deductibles IS DISTINCT FROM OLD.deductibles
          OR NEW.exclusions IS DISTINCT FROM OLD.exclusions
          OR NEW.broker_id IS DISTINCT FROM OLD.broker_id) THEN
    RAISE EXCEPTION 'INSURER_CONTRACT_TERMS_IMMUTABLE'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'settlement_insurer_contract_terms_immutable';
  END IF;
  IF NEW.currency IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT c.currency::text INTO v_currency
    FROM core.config_country AS c WHERE c.code::text = NEW.country_code;
  IF v_currency IS NULL OR v_currency <> NEW.currency THEN
    RAISE EXCEPTION 'INSURER_CONTRACT_CURRENCY_MISMATCH'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'settlement_insurer_contract_currency_country';
  END IF;
  SELECT v.value INTO v_min
    FROM core.config_param_value AS v
   WHERE v.key = 'insurer_rc_minimum' AND v.country_code::text = NEW.country_code
     AND v.scope_type = 'COUNTRY' AND v.valid_from <= v_now
     AND (v.valid_to IS NULL OR v.valid_to > v_now)
   ORDER BY v.valid_from DESC
   LIMIT 1;
  -- minimum absent ou illisible : la conformité ne peut pas être prouvée (fail-closed)
  IF v_min IS NULL OR pg_catalog.jsonb_typeof(v_min) <> 'string'
     OR (v_min #>> '{}') !~ '^[0-9]{1,15}$'
     OR NEW.rc_amount_minor < (v_min #>> '{}')::bigint THEN
    RAISE EXCEPTION 'POLICY_RC_BELOW_MINIMUM'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'settlement_insurer_contract_rc_minimum';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION core.settlement_insurer_contract_terms_guard() IS
  'Garde des conditions du contrat d''assureur : RC >= insurer_rc_minimum[pays] (absent : refus, '
  'POLICY_RC_BELOW_MINIMUM), devise du pays, conditions immuables une fois posées. US-205 '
  '(ADR-138).';
REVOKE ALL ON FUNCTION core.settlement_insurer_contract_terms_guard() FROM PUBLIC;
CREATE TRIGGER settlement_insurer_contract_terms_guard
  BEFORE INSERT OR UPDATE ON core.settlement_insurer_contract
  FOR EACH ROW EXECUTE FUNCTION core.settlement_insurer_contract_terms_guard();

-- 2. Lectures de catalog_cmd_owner (assureur, conditions, paramètres d'annulation et de RC) -----
GRANT SELECT (name, kind, license_ref) ON core.settlement_insurer TO catalog_cmd_owner;
GRANT SELECT (version, broker_id, currency, rc_amount_minor, deductibles, exclusions)
  ON core.settlement_insurer_contract TO catalog_cmd_owner;
CREATE POLICY catalog_cmd_terms_read ON core.config_param_value FOR SELECT TO catalog_cmd_owner
  USING (key IN ('free_cancel_lead', 'last_minute_threshold', 'insurer_rc_minimum'));

-- 3. Conditions publiques d'une annonce LISTED (19 US-205) ---------------------------------------
-- Une ligne ; annonce inconnue ou non publiée : aucune ligne. `p_start` : départ choisi (instant
-- UTC) ou NULL (fiche sans dates : paramètres seuls).
GRANT CREATE ON SCHEMA core TO catalog_cmd_owner;
SET LOCAL ROLE catalog_cmd_owner;

CREATE FUNCTION core.catalog_public_terms(p_listing_id uuid, p_start timestamptz)
  RETURNS TABLE (listing_id uuid, currency text, timezone text, read_at timestamptz,
                 free_cancel_lead_hours integer, last_minute_threshold_hours integer,
                 last_minute boolean, free_until timestamptz, mileage_mode text,
                 included_km_per_day integer, extra_km_price_minor bigint,
                 deposit_amount_minor bigint, protection_offered boolean, insurer_name text,
                 insurer_license_ref text, broker_name text, broker_license_ref text,
                 contract_version integer, rc_amount_minor bigint, deductibles jsonb,
                 exclusions jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now   timestamptz := platform.now();
  v_l     record;
  v_lead  jsonb;
  v_thr   jsonb;
  v_min   jsonb;
  v_cov   record;
  v_c     record;
BEGIN
  SELECT l.id, l.country_code, l.currency, l.mileage_mode, l.included_km_per_day,
         l.extra_km_price_minor, v.timezone, v.year, v.value_class, v.plate_category
    INTO v_l
    FROM core.catalog_listing AS l
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id AND v.org_id = l.org_id
   WHERE l.id = p_listing_id AND l.status = 'LISTED';
  IF v_l.id IS NULL THEN
    RETURN;
  END IF;
  listing_id := v_l.id;
  currency := v_l.currency;
  timezone := v_l.timezone;
  read_at := v_now;
  mileage_mode := v_l.mileage_mode;
  included_km_per_day := v_l.included_km_per_day;
  extra_km_price_minor := v_l.extra_km_price_minor;
  protection_offered := false;

  -- 3.1 Annulation (BR-CXL-01, OQ-BR-30) : paramètres du pays, entiers d'heures ; absent ⇒ NULL
  v_lead := core.catalog_plan_param('free_cancel_lead', v_l.country_code);
  v_thr := core.catalog_plan_param('last_minute_threshold', v_l.country_code);
  IF pg_catalog.jsonb_typeof(v_lead) = 'number' AND (v_lead #>> '{}') ~ '^[0-9]{1,4}$'
     AND pg_catalog.jsonb_typeof(v_thr) = 'number' AND (v_thr #>> '{}') ~ '^[0-9]{1,4}$' THEN
    free_cancel_lead_hours := (v_lead #>> '{}')::integer;
    last_minute_threshold_hours := (v_thr #>> '{}')::integer;
    -- freeUntil si la réservation avait lieu maintenant (bookedAt = platform.now()) :
    -- dernière minute (départ à moins du seuil) ⇒ 1 h après la réservation, sans date ici ;
    -- sinon départ − free_cancel_lead (borne incluse, BR-CXL-01)
    IF p_start IS NOT NULL AND p_start > v_now THEN
      last_minute := p_start - v_now
                     < pg_catalog.make_interval(hours => last_minute_threshold_hours);
      IF NOT last_minute THEN
        free_until := p_start - pg_catalog.make_interval(hours => free_cancel_lead_hours);
      END IF;
    END IF;
  END IF;

  -- 3.2 Caution de la plateforme (même règle que les cartes, 0105 ; NULL : mention générique)
  SELECT CASE WHEN dp.amount_minor > 0 AND dp.currency = v_l.currency THEN dp.amount_minor END
    INTO deposit_amount_minor
    FROM core.catalog_deposit_policy AS dp
   WHERE dp.country_code = v_l.country_code AND dp.value_class = v_l.value_class
     AND dp.valid_from <= v_now
   ORDER BY dp.valid_from DESC
   LIMIT 1;

  -- 3.3 Protection de l'assureur partenaire : rien sans interrupteur, contrat, couverture,
  -- conditions, même devise et RC au minimum du pays (19 US-205 critères 3 et 4)
  IF NOT core.config_go_live('insurer_contract_active', v_l.country_code) THEN
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT * INTO v_cov
    FROM core.settlement_insurer_vehicle_coverage(v_l.country_code, v_l.timezone, v_l.year,
                                                  v_l.value_class, v_l.plate_category);
  IF v_cov.outcome IS DISTINCT FROM 'COVERED' OR v_cov.contract_id IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT c.version, c.currency, c.rc_amount_minor, c.deductibles, c.exclusions,
         i.name AS insurer_name, i.license_ref AS insurer_license_ref,
         b.name AS broker_name, b.license_ref AS broker_license_ref, b.status AS broker_status
    INTO v_c
    FROM core.settlement_insurer_contract AS c
    JOIN core.settlement_insurer AS i ON i.id = c.insurer_id AND i.country_code = c.country_code
    LEFT JOIN core.settlement_insurer AS b ON b.id = c.broker_id AND b.country_code = c.country_code
   WHERE c.id = v_cov.contract_id AND i.status = 'ACTIVE';
  v_min := core.catalog_plan_param('insurer_rc_minimum', v_l.country_code);
  IF v_c.currency IS NULL OR v_c.currency <> v_l.currency
     OR v_min IS NULL OR pg_catalog.jsonb_typeof(v_min) <> 'string'
     OR (v_min #>> '{}') !~ '^[0-9]{1,15}$'
     OR v_c.rc_amount_minor < (v_min #>> '{}')::bigint
     OR (v_c.broker_name IS NOT NULL AND v_c.broker_status IS DISTINCT FROM 'ACTIVE') THEN
    RETURN NEXT;
    RETURN;
  END IF;
  protection_offered := true;
  insurer_name := v_c.insurer_name;
  insurer_license_ref := v_c.insurer_license_ref;
  broker_name := v_c.broker_name;
  broker_license_ref := v_c.broker_license_ref;
  contract_version := v_c.version;
  rc_amount_minor := v_c.rc_amount_minor;
  deductibles := v_c.deductibles;
  exclusions := v_c.exclusions;
  RETURN NEXT;
END
$fn$;
COMMENT ON FUNCTION core.catalog_public_terms(uuid, timestamptz) IS
  'Conditions publiques d''une annonce LISTED : annulation (paramètres du pays, freeUntil de '
  'BR-CXL-01 à platform.now() pour un départ donné), distance, caution de la plateforme, '
  'protection de l''assureur partenaire seulement si insurer_contract_active, contrat en vigueur '
  'couvrant le véhicule, conditions posées, même devise et RC >= insurer_rc_minimum. SECURITY '
  'DEFINER, EXECUTE app_api. US-205 (ADR-138).';

REVOKE ALL ON FUNCTION core.catalog_public_terms(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.catalog_public_terms(uuid, timestamptz) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM catalog_cmd_owner;
