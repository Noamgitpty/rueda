-- 0002 — configuration pays (CFG) : devises, pays, paramètres versionnés, fériés, taxes par
-- ligne, entités juridiques. US-013 ; 17 §1.1–§1.4, §3.2 (classe C), §7 ; ADR-024, ADR-033 ;
-- 16 ADM-014. Appliquée sous `migrator`.
--
-- Bêta (D1, CONTRIBUTING §9) : schéma unique `core`, tables préfixées par leur schéma cible
-- (`config_*` pour CFG, `pricing_tax_line_config` pour PRC, `finance_legal_entity` pour FIN).
-- Aucune valeur propre à un pays ici (ADR-024) : les graines sont dans 0003, générées depuis
-- apps/api/src/modules/cfg/data/ (source unique).
--
-- Classe C (17 §3.1) : tables versionnées, jamais supprimées. Une valeur de paramètre ou de taxe
-- n'est jamais rétroactive : `valid_from` absent ⇒ `platform.now()` ; antérieur ⇒ PARAM_RETROACTIVE,
-- pour tout rôle, migrator compris.
--
-- Droits : lecture seule pour app_api et app_worker ; aucune écriture applicative en Bêta
-- (paramétrage par migration de graines, écran au lot 5, US-535 ; interrupteurs : commandes à
-- deux personnes de US-125, RLS-27). Rien pour app_anon ni PUBLIC.
--
-- Retour arrière (base sans objet dépendant) :
--   DROP FUNCTION core.config_go_live(text, text);
--   DROP TABLE core.finance_legal_entity, core.pricing_tax_line_config,
--     core.config_holiday_calendar, core.config_param_value, core.config_param_definition,
--     core.config_country, core.config_currency;
--   DROP FUNCTION core.config_param_value_guard(), core.config_versioned_row_guard(),
--     core.config_tax_line_guard();
--   DROP SCHEMA core;  -- seulement si aucune autre migration n'y a créé d'objet

CREATE SCHEMA IF NOT EXISTS core;  -- propriétaire : migrator
REVOKE ALL ON SCHEMA core FROM PUBLIC;
GRANT USAGE ON SCHEMA core TO app_api, app_worker;

-- ---------------------------------------------------------------------------------------------
-- Devises et pays (17 §1.2, §1.1)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE core.config_currency (
  code     char(3)  PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  exponent smallint NOT NULL CHECK (exponent BETWEEN 0 AND 18)
);
COMMENT ON TABLE core.config_currency IS
  'Devises (17 §1.2) : exposant de l''unité mineure. Seule source de l''exposant (@rueda/money).';

CREATE TABLE core.config_country (
  code              char(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  currency          char(3) NOT NULL REFERENCES core.config_currency (code),
  time_zone         text    NOT NULL CHECK (time_zone <> ''),
  legal_locale      text    NOT NULL,
  default_locale    text    NOT NULL,
  locales           text[]  NOT NULL CHECK (cardinality(locales) > 0),
  names             jsonb   NOT NULL CHECK (jsonb_typeof(names) = 'object'),
  host_tax_id_kinds text[]  NOT NULL,
  CHECK (legal_locale = ANY (locales)),
  CHECK (default_locale = ANY (locales))
);
COMMENT ON TABLE core.config_country IS
  'Pays configurés (17 §1.1) : devise, fuseau IANA, locales (version juridique faisant foi : legal_locale).';

-- ---------------------------------------------------------------------------------------------
-- Paramètres (17 §3.2 param_definition / param_value, §7)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE core.config_param_definition (
  key               text    PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  type              text    NOT NULL
                    CHECK (type IN ('INT', 'BOOL', 'DURATION', 'MONEY', 'BPS', 'ENUM', 'JSON')),
  unit              text,
  allowed_scopes    text[]  NOT NULL
                    CHECK (cardinality(allowed_scopes) > 0
                           AND allowed_scopes <@ ARRAY['NETWORK', 'PSP', 'ORG', 'CATEGORY', 'COUNTRY']),
  currency_bound    boolean NOT NULL DEFAULT false,
  fail_mode         text    NOT NULL CHECK (fail_mode IN ('BLOCK', 'FALSE', 'ZERO')),
  optional          boolean NOT NULL DEFAULT false,
  -- Drapeau de clé protégée (interrupteur de mise en service, 17 §0.1) : lu par la garde de US-125.
  go_live_switch    boolean NOT NULL DEFAULT false,
  not_applicable_in text[]  NOT NULL DEFAULT '{}',
  allowed_values    text[],
  source_ref        text    NOT NULL,
  status            text    NOT NULL,
  CHECK (fail_mode <> 'FALSE' OR type = 'BOOL'),
  CHECK (fail_mode <> 'ZERO' OR type IN ('INT', 'DURATION', 'MONEY', 'BPS')),
  CHECK (NOT currency_bound OR type IN ('MONEY', 'JSON')),
  CHECK ((type = 'ENUM') = (allowed_values IS NOT NULL AND cardinality(allowed_values) > 0)),
  CHECK (NOT go_live_switch
         OR (type = 'BOOL' AND fail_mode = 'FALSE' AND allowed_scopes = ARRAY['COUNTRY'] AND NOT optional))
);
COMMENT ON TABLE core.config_param_definition IS
  'Registre des clés (17 §7.2) ; fail_mode = comportement en l''absence de valeur (17 §7.1 point 7).';

CREATE TABLE core.config_param_value (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text        NOT NULL REFERENCES core.config_param_definition (key),
  country_code  char(2)     NOT NULL REFERENCES core.config_country (code),
  scope_type    text        NOT NULL
                CHECK (scope_type IN ('NETWORK', 'PSP', 'ORG', 'CATEGORY', 'COUNTRY')),
  scope_id      text,
  network       text,
  currency      char(3)     REFERENCES core.config_currency (code),
  value         jsonb       NOT NULL,
  -- Rempli par la garde : absent ⇒ platform.now() ; antérieur à platform.now() ⇒ PARAM_RETROACTIVE.
  valid_from    timestamptz NOT NULL,
  valid_to      timestamptz,
  approved_by   uuid,
  decision_ref  text,
  change_reason text        NOT NULL CHECK (change_reason <> ''),
  created_at    timestamptz NOT NULL DEFAULT platform.now(),
  created_by    name        NOT NULL DEFAULT current_user,
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK ((scope_type IN ('COUNTRY', 'NETWORK')) = (scope_id IS NULL)),
  CHECK ((scope_type = 'NETWORK') = (network IS NOT NULL)),
  UNIQUE NULLS NOT DISTINCT (key, country_code, scope_type, scope_id, network, valid_from)
);
COMMENT ON TABLE core.config_param_value IS
  'Valeurs versionnées (17 §3.2) ; jamais rétroactives, jamais supprimées ; seule la fermeture '
  '(valid_to, non rétroactive) est permise.';

-- Garde de config_param_value (tous rôles) : non-rétroactivité, cohérence avec la définition,
-- immuabilité (seule valid_to se ferme), aucune suppression.
CREATE FUNCTION core.config_param_value_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now  timestamptz := platform.now();
  v_def  core.config_param_definition%ROWTYPE;
  v_cur  char(3);
  v_type text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PARAM_IMMUTABLE' USING ERRCODE = 'check_violation',
      DETAIL = 'une valeur de paramètre ne se supprime pas : fermer par valid_to (17 §3.1, classe C)';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.key, NEW.country_code, NEW.scope_type, NEW.scope_id, NEW.network, NEW.currency,
        NEW.value, NEW.valid_from, NEW.approved_by, NEW.decision_ref, NEW.change_reason,
        NEW.created_at, NEW.created_by)
       IS DISTINCT FROM
       (OLD.id, OLD.key, OLD.country_code, OLD.scope_type, OLD.scope_id, OLD.network, OLD.currency,
        OLD.value, OLD.valid_from, OLD.approved_by, OLD.decision_ref, OLD.change_reason,
        OLD.created_at, OLD.created_by)
       OR OLD.valid_to IS NOT NULL OR NEW.valid_to IS NULL THEN
      RAISE EXCEPTION 'PARAM_IMMUTABLE' USING ERRCODE = 'check_violation',
        DETAIL = 'seule la fermeture d''une version ouverte (valid_to) est permise';
    END IF;
    IF NEW.valid_to < v_now THEN
      RAISE EXCEPTION 'PARAM_RETROACTIVE' USING ERRCODE = 'check_violation',
        DETAIL = 'valid_to antérieur à platform.now()';
    END IF;
    RETURN NEW;
  END IF;

  -- INSERT
  IF NEW.valid_from IS NULL THEN
    NEW.valid_from := v_now;
  ELSIF NEW.valid_from < v_now THEN
    RAISE EXCEPTION 'PARAM_RETROACTIVE' USING ERRCODE = 'check_violation',
      DETAIL = 'valid_from antérieur à platform.now() (16 ADM-014)';
  END IF;

  SELECT * INTO v_def FROM core.config_param_definition WHERE key = NEW.key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PARAM_UNKNOWN' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT (NEW.scope_type = ANY (v_def.allowed_scopes)) THEN
    RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
      DETAIL = format('portée %s non permise pour %s', NEW.scope_type, NEW.key);
  END IF;
  IF NEW.country_code = ANY (v_def.not_applicable_in) THEN
    RAISE EXCEPTION 'PARAM_NOT_APPLICABLE' USING ERRCODE = 'check_violation';
  END IF;
  IF v_def.go_live_switch AND NEW.value <> 'false'::jsonb THEN
    -- Interrupteurs (17 §0.1) : seules les commandes à deux personnes de US-125 pourront écrire
    -- autre chose que false ; d'ici là, aucune écriture à true n'est possible (fail-closed).
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = 'insufficient_privilege',
      DETAIL = 'interrupteur de mise en service : procédure à deux personnes (RLS-27)';
  END IF;

  SELECT currency INTO v_cur FROM core.config_country WHERE code = NEW.country_code;
  IF v_def.currency_bound THEN
    IF NEW.currency IS NULL THEN
      NEW.currency := v_cur;
    ELSIF NEW.currency <> v_cur THEN
      RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
        DETAIL = 'devise différente de celle du pays (aucune conversion, 17 §7.1)';
    END IF;
  ELSIF NEW.currency IS NOT NULL THEN
    RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
      DETAIL = 'clé sans devise';
  END IF;

  v_type := jsonb_typeof(NEW.value);
  IF NOT CASE v_def.type
      WHEN 'BOOL' THEN v_type = 'boolean'
      WHEN 'MONEY' THEN v_type = 'string' AND (NEW.value #>> '{}') ~ '^(0|[1-9][0-9]{0,18})$'
      WHEN 'ENUM' THEN v_type = 'string' AND (NEW.value #>> '{}') = ANY (v_def.allowed_values)
      WHEN 'BPS' THEN v_type = 'number'
                      AND CASE WHEN (NEW.value #>> '{}') ~ '^[0-9]{1,5}$'
                               THEN (NEW.value #>> '{}')::integer <= 10000
                               ELSE false END
      WHEN 'JSON' THEN v_type <> 'null'
      ELSE v_type = 'number' AND (NEW.value #>> '{}') ~ '^[0-9]+$'  -- INT, DURATION
    END THEN
    RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
      DETAIL = format('valeur incompatible avec le type %s de %s', v_def.type, NEW.key);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER config_param_value_guard
  BEFORE INSERT OR UPDATE OR DELETE ON core.config_param_value
  FOR EACH ROW EXECUTE FUNCTION core.config_param_value_guard();

-- Garde commune des tables de référence versionnées (classe C) sans fermeture : insertion
-- seulement, valid_from non rétroactif (si la table en a un).
CREATE FUNCTION core.config_versioned_row_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'PARAM_IMMUTABLE' USING ERRCODE = 'check_violation',
      DETAIL = format('%s : table versionnée, ni modification ni suppression (17 §3.1, classe C) ; '
                      'publier une nouvelle version', TG_TABLE_NAME);
  END IF;
  RETURN NEW;
END
$fn$;

-- TRUNCATE ne déclenche pas les triggers de ligne : refus explicite, au niveau de l'instruction.
CREATE FUNCTION core.config_no_truncate()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'PARAM_IMMUTABLE' USING ERRCODE = 'check_violation',
    DETAIL = format('%s : TRUNCATE interdit (17 §3.1, classe C)', TG_TABLE_NAME);
END
$fn$;

CREATE TRIGGER config_param_value_no_truncate
  BEFORE TRUNCATE ON core.config_param_value
  FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- Fériés (17 §1.3, §7.1 point 8)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE core.config_holiday_calendar (
  country_code char(2) NOT NULL REFERENCES core.config_country (code),
  date         date    NOT NULL,
  name         text    NOT NULL CHECK (name <> ''),
  version      integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (country_code, date, version)
);
COMMENT ON TABLE core.config_holiday_calendar IS
  'Fériés par pays, versionnés (17 §1.3) : payout_at, SLA en jours ouvrés, relances.';

CREATE TRIGGER config_holiday_calendar_guard
  BEFORE UPDATE OR DELETE ON core.config_holiday_calendar
  FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard();
CREATE TRIGGER config_holiday_calendar_no_truncate
  BEFORE TRUNCATE ON core.config_holiday_calendar
  FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- Taxes par ligne (module PRC ; 17 §3.2 tax_line_config ; 08 BR-PRICE-12)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE core.pricing_tax_line_config (
  country_code char(2)     NOT NULL REFERENCES core.config_country (code),
  line_type    text        NOT NULL
               CHECK (line_type IN ('TRIP_PRICE', 'PROMO_PLATFORM', 'PROMO_HOST', 'TRIP_FEE',
                                    'PROTECTION', 'EXTRAS', 'ENHANCED_ROADSIDE',
                                    'ADDITIONAL_DRIVER_FEE', 'YOUNG_DRIVER_FEE', 'DELIVERY_FEE')),
  taxable      boolean     NOT NULL,
  rate_group   text,
  rate_bps     integer     CHECK (rate_bps BETWEEN 0 AND 10000),
  third_party  boolean     NOT NULL DEFAULT false,
  version      integer     NOT NULL CHECK (version > 0),
  valid_from   timestamptz NOT NULL,
  PRIMARY KEY (country_code, line_type, version),
  CHECK (taxable = (rate_group IS NOT NULL)),
  CHECK (taxable = (rate_bps IS NOT NULL)),
  CHECK (taxable OR NOT third_party)
);
COMMENT ON TABLE core.pricing_tax_line_config IS
  'Taxe par type de ligne et par pays, versionnée (17 §3.2, 08 BR-PRICE-12) ; third_party = taxe '
  'collectée pour un tiers (jambe TAX_THIRD_PARTY), false par défaut.';

-- Insertion : valid_from non rétroactif ; un rate_group a un seul taux et une seule valeur de
-- third_party dans une même version (17 §3.2). Ni modification ni suppression.
CREATE FUNCTION core.config_tax_line_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := platform.now();
BEGIN
  IF NEW.valid_from IS NULL THEN
    NEW.valid_from := v_now;
  ELSIF NEW.valid_from < v_now THEN
    RAISE EXCEPTION 'PARAM_RETROACTIVE' USING ERRCODE = 'check_violation',
      DETAIL = 'valid_from antérieur à platform.now() (16 ADM-014)';
  END IF;
  IF NEW.taxable AND EXISTS (
       SELECT 1 FROM core.pricing_tax_line_config t
        WHERE t.country_code = NEW.country_code AND t.version = NEW.version
          AND t.rate_group = NEW.rate_group
          AND (t.rate_bps <> NEW.rate_bps OR t.third_party <> NEW.third_party)) THEN
    RAISE EXCEPTION 'CONFIG_INVALID' USING ERRCODE = 'check_violation',
      DETAIL = format('groupe fiscal %s incohérent (taux ou third_party)', NEW.rate_group);
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER pricing_tax_line_config_insert_guard
  BEFORE INSERT ON core.pricing_tax_line_config
  FOR EACH ROW EXECUTE FUNCTION core.config_tax_line_guard();
CREATE TRIGGER pricing_tax_line_config_guard
  BEFORE UPDATE OR DELETE ON core.pricing_tax_line_config
  FOR EACH ROW EXECUTE FUNCTION core.config_versioned_row_guard();
CREATE TRIGGER pricing_tax_line_config_no_truncate
  BEFORE TRUNCATE ON core.pricing_tax_line_config
  FOR EACH STATEMENT EXECUTE FUNCTION core.config_no_truncate();

-- ---------------------------------------------------------------------------------------------
-- Entités juridiques de Kmino (module FIN ; 17 §3.2 legal_entity ; ADR-013 en attente)
-- ---------------------------------------------------------------------------------------------

CREATE TABLE core.finance_legal_entity (
  id                       uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Pays où l'entité est marchand de référence et facture le trip fee (17 §10 : une ligne par pays).
  country_code             char(2) NOT NULL UNIQUE REFERENCES core.config_country (code),
  name                     text    NOT NULL CHECK (name <> ''),
  country_of_incorporation char(2) NOT NULL CHECK (country_of_incorporation ~ '^[A-Z]{2}$'),
  tax_id                   text    NOT NULL CHECK (tax_id <> ''),
  invoicing_regime         text    NOT NULL CHECK (invoicing_regime ~ '^[A-Z][A-Z0-9_]*$')
);
COMMENT ON TABLE core.finance_legal_entity IS
  'Entité de Kmino par pays (17 §3.2) ; vide tant qu''ADR-013 / OQ-MK-06 n''est pas tranchée : '
  'la production refuse alors de démarrer.';

-- ---------------------------------------------------------------------------------------------
-- Lecture des interrupteurs (17 §2.3) : clé absente, inconnue, non interrupteur, pays inconnu
-- ou valeur autre que true ⇒ false (fail-closed). Invocateur : lit sous la RLS de l'appelant.
-- STABLE comme dans 17 §2.3 ; l'instant est capturé une fois.
-- ---------------------------------------------------------------------------------------------

CREATE FUNCTION core.config_go_live(p_key text, p_country text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH t AS (SELECT platform.now() AS ts)
  SELECT COALESCE((
    SELECT v.value = 'true'::jsonb
      FROM core.config_param_value v
      JOIN core.config_param_definition d ON d.key = v.key AND d.go_live_switch
      CROSS JOIN t
     WHERE v.key = p_key
       AND v.country_code::text = p_country
       AND v.scope_type = 'COUNTRY'
       AND v.valid_from <= t.ts
       AND (v.valid_to IS NULL OR v.valid_to > t.ts)
     ORDER BY v.valid_from DESC
     LIMIT 1), false)
$fn$;
REVOKE ALL ON FUNCTION core.config_go_live(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.config_go_live(text, text) TO app_api, app_worker;

-- ---------------------------------------------------------------------------------------------
-- RLS partout (CLAUDE.md point 5 ; 17 §2.3, B9) et droits minimaux
-- ---------------------------------------------------------------------------------------------

DO $rls$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['config_currency', 'config_country', 'config_param_definition',
                           'config_param_value', 'config_holiday_calendar',
                           'pricing_tax_line_config', 'finance_legal_entity']
  LOOP
    EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY migrator_all ON core.%I TO migrator USING (true) WITH CHECK (true)', t);
    -- Référence lisible par l'application, sans écriture (17 §2.3 : configuration commune).
    EXECUTE format('CREATE POLICY app_read ON core.%I FOR SELECT TO app_api, app_worker USING (true)', t);
    EXECUTE format('REVOKE ALL ON core.%I FROM PUBLIC', t);
    EXECUTE format('GRANT SELECT ON core.%I TO app_api, app_worker', t);
  END LOOP;
END
$rls$;
