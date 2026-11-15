-- 0100 — PRC : devis figés, lignes et versions de prix du trip.
-- US-202 ; 19 US-202 (« Given un devis figé, When il est rejoué, Then le total est identique au
-- cent » ; taxe par ligne T43 ; groupe third_party ⇒ jambe TAX_THIRD_PARTY) ; 16 PRC-025 (états
-- PROVISIONAL → FROZEN → SUPERSEDED, QUOTE_UNAVAILABLE, LEG_AMOUNT_NEGATIVE ; « une version figée
-- par réservation et par modification »), PRC-020 (TAX_CONFIG_MISSING) ; 17 §2.6, §3.2.5 (`quote`,
-- `quote_line`, `trip_price_version`) ; 08 BR-PRICE-12, BR-PRICE-14, BR-MOD-06, E7 ; pré-mortem du
-- lot 2 : L2-PM-03 (montant non borné : total recalculé en base), L2-PM-12, L2-PM-14 ; ADR-125.
-- Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-125, PROPOSÉS) :
--   - le devis est calculé par le moteur pur `prc.quote/1` de l'API ; la base ne stocke qu'un devis
--     FIGÉ (le devis PROVISIONAL n'est jamais persisté : affichage seulement) ;
--   - on écrit UNIQUEMENT par deux commandes (`SECURITY DEFINER`, propriétaire `cmd_money_owner`,
--     EXECUTE au seul `app_api`) :
--       `core.pricing_cmd_freeze_quote` : la base REJOUE le devis avec SA configuration (prix
--         journalier de l'annonce LISTED, `grace_minutes`, `max_trip_days`, `tax_line_config` en
--         vigueur, part du plan par défaut de l'hôte) : jours facturables, prix du trip, taxe par
--         ligne, total, jambes de la capture ; tout écart avec les sorties de l'API, ou une empreinte
--         qui ne correspond pas, ⇒ QUOTE_MISMATCH et rien n'est écrit (le client n'envoie jamais de
--         montant, l'API non plus n'en impose aucun) ;
--       `core.pricing_cmd_version_trip_price` : rattache un devis figé du voyageur à son trip,
--         version suivante ; le devis de la version précédente passe SUPERSEDED (BR-MOD-06) ;
--   - aucun droit des rôles applicatifs sur les tables (ni lecture, ni écriture directe) ;
--   - registres immuables : seule transition admise FROZEN → SUPERSEDED (par la commande), pour
--     tout rôle, migrator compris ; ni suppression ni TRUNCATE ;
--   - aucune constante de pays : devise, paramètres et taxes lus des tables de configuration ;
--   - arithmétique du vérificateur de 0054 (`settlement_verify_round`, `settlement_verify_alloc_host`,
--     `settlement_verify_host_from_guest`, `settlement_verify_floor_div`), recopiée de 08 ;
--   - protection et assistance renforcée : non vendues tant que la part de l'assureur n'est pas
--     fixée par le contrat et le niveau de protection connu (US-226) ⇒ QUOTE_UNAVAILABLE.
--
-- Issues (colonne `outcome`, codes de 16 et PROPOSÉS par ADR-125) : DONE, AUTH_REQUIRED,
--   LISTING_NOT_FOUND, QUOTE_UNAVAILABLE, TAX_CONFIG_MISSING, LEG_AMOUNT_NEGATIVE, QUOTE_MISMATCH,
--   QUOTE_NOT_FOUND, TRIP_NOT_FOUND.
-- Erreur (SQLSTATE 23000, contrainte) traduite par packages/db/src/errors.ts :
--   pricing_record_immutable → IMMUTABLE_RECORD.
--
-- Expand / contract : tables, fonctions, triggers, politiques et droits AJOUTÉS seulement.
--
-- Retour arrière :
--   DROP FUNCTION core.pricing_cmd_version_trip_price(bytea, uuid, uuid),
--     core.pricing_cmd_freeze_quote(bytea, uuid, text, text, text, text),
--     core.pricing_param(text, text), core.pricing_ratio(jsonb), core.pricing_ms(jsonb),
--     core.pricing_minor(jsonb), core.pricing_digest(text, text);
--   DROP TABLE core.pricing_trip_price_version, core.pricing_quote_line, core.pricing_quote;
--   DROP FUNCTION core.pricing_record_guard() ;
--   DROP POLICY cmd_money_quote_read ON core.config_param_value ; DROP POLICY cmd_money_read ON
--     core.pricing_tax_line_config ;
--   REVOKE SELECT ON core.pricing_tax_line_config FROM cmd_money_owner ;
--   REVOKE SELECT (guest_user_id, listing_id, scheduled_start, scheduled_end) ON core.booking_trip
--     FROM cmd_money_owner ;
--   REVOKE EXECUTE ON FUNCTION core.iam_session_resolve(bytea), core.catalog_public_listing(uuid)
--     FROM cmd_money_owner.

-- 1. Tables ---------------------------------------------------------------------------------------

-- Devis figé (17 §3.2.5 `quote`). Entrées et sorties canoniques du moteur et leurs empreintes ;
-- montants recalculés par la base (colonnes *_minor).
CREATE TABLE core.pricing_quote (
  id                        uuid        PRIMARY KEY,
  guest_user_id             uuid        NOT NULL,           -- FK iam_user (voyageur de la session)
  listing_id                uuid        NOT NULL,           -- FK catalog_listing (annonce LISTED)
  country_code              text        NOT NULL
    CONSTRAINT pricing_quote_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency                  text        NOT NULL
    CONSTRAINT pricing_quote_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  status                    text        NOT NULL DEFAULT 'FROZEN'
    CONSTRAINT pricing_quote_status_valid CHECK (status IN ('FROZEN', 'SUPERSEDED')),
  engine_version            text        NOT NULL
    CONSTRAINT pricing_quote_engine_known CHECK (engine_version IN ('prc.quote/1')),
  period                    tstzrange   NOT NULL
    CONSTRAINT pricing_quote_period_valid CHECK (NOT isempty(period) AND lower_inc(period)
                                                 AND NOT upper_inc(period)),
  billable_days             integer     NOT NULL CONSTRAINT pricing_quote_days_valid
                                                 CHECK (billable_days >= 1),
  subtotal_minor            bigint      NOT NULL,
  tax_total_minor           bigint      NOT NULL,
  tax_third_party_minor     bigint      NOT NULL,
  total_minor               bigint      NOT NULL CONSTRAINT pricing_quote_total_positive
                                                 CHECK (total_minor > 0),
  leg_host_minor            bigint      NOT NULL,
  leg_insurer_minor         bigint      NOT NULL,
  leg_tax_third_party_minor bigint      NOT NULL,
  leg_platform_minor        bigint      NOT NULL,
  inputs                    text        NOT NULL,
  inputs_hash               text        NOT NULL
    CONSTRAINT pricing_quote_inputs_hash_format CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  outputs                   text        NOT NULL,
  outputs_hash              text        NOT NULL
    CONSTRAINT pricing_quote_outputs_hash_format CHECK (outputs_hash ~ '^[0-9a-f]{64}$'),
  frozen_at                 timestamptz NOT NULL DEFAULT platform.now(),
  superseded_at             timestamptz,
  CONSTRAINT pricing_quote_total_sum CHECK (total_minor = subtotal_minor + tax_total_minor),
  CONSTRAINT pricing_quote_legs_sum CHECK (
    leg_host_minor + leg_insurer_minor + leg_tax_third_party_minor + leg_platform_minor = total_minor),
  CONSTRAINT pricing_quote_legs_nonnegative CHECK (
    leg_host_minor >= 0 AND leg_insurer_minor >= 0 AND leg_tax_third_party_minor >= 0
    AND leg_platform_minor >= 0),
  CONSTRAINT pricing_quote_third_party_leg CHECK (leg_tax_third_party_minor = tax_third_party_minor),
  CONSTRAINT pricing_quote_superseded CHECK ((status = 'SUPERSEDED') = (superseded_at IS NOT NULL))
);
COMMENT ON TABLE core.pricing_quote IS
  'Devis figé (16 PRC-025) : entrées et sorties canoniques du moteur prc.quote/1, empreintes '
  'SHA-256, montants rejoués par la base. Écrit par core.pricing_cmd_freeze_quote seulement ; seule '
  'transition FROZEN → SUPERSEDED. US-202, ADR-125.';
CREATE INDEX pricing_quote_guest_idx ON core.pricing_quote (guest_user_id, frozen_at);

-- Lignes typées du devis (17 §3.2.5 `quote_line`), taxe arrondie PAR LIGNE.
CREATE TABLE core.pricing_quote_line (
  quote_id     uuid    NOT NULL REFERENCES core.pricing_quote (id),
  seq          integer NOT NULL CONSTRAINT pricing_quote_line_seq_valid CHECK (seq BETWEEN 1 AND 10),
  line_type    text    NOT NULL
    CONSTRAINT pricing_quote_line_type_valid CHECK (line_type IN
      ('TRIP_PRICE', 'PROMO_PLATFORM', 'PROMO_HOST', 'TRIP_FEE', 'PROTECTION', 'EXTRAS',
       'ENHANCED_ROADSIDE', 'ADDITIONAL_DRIVER_FEE', 'YOUNG_DRIVER_FEE', 'DELIVERY_FEE')),
  amount_minor bigint  NOT NULL,
  tax_group    text,
  rate_bps     integer CONSTRAINT pricing_quote_line_rate_valid CHECK (rate_bps BETWEEN 0 AND 10000),
  tax_minor    bigint  NOT NULL,
  third_party  boolean NOT NULL,
  CONSTRAINT pricing_quote_line_pkey PRIMARY KEY (quote_id, seq),
  CONSTRAINT pricing_quote_line_type_unique UNIQUE (quote_id, line_type),
  CONSTRAINT pricing_quote_line_sign CHECK (
    amount_minor <> 0 AND (amount_minor > 0 OR line_type IN ('PROMO_PLATFORM', 'PROMO_HOST'))),
  CONSTRAINT pricing_quote_line_taxable CHECK (
    (tax_group IS NULL) = (rate_bps IS NULL) AND (tax_group IS NOT NULL OR (tax_minor = 0
                                                                            AND NOT third_party)))
);
COMMENT ON TABLE core.pricing_quote_line IS
  'Lignes d''un devis figé : montant, groupe fiscal et taux en vigueur, taxe arrondie par ligne '
  '(08 BR-PRICE-12, T43). US-202, ADR-125.';

-- Versions de prix du trip (17 §2.6, §3.2.5 ; 08 BR-MOD-06).
CREATE TABLE core.pricing_trip_price_version (
  trip_id    uuid        NOT NULL REFERENCES core.booking_trip (id),
  version    integer     NOT NULL CONSTRAINT pricing_trip_price_version_valid CHECK (version >= 1),
  quote_id   uuid        NOT NULL REFERENCES core.pricing_quote (id)
    CONSTRAINT pricing_trip_price_version_quote_unique UNIQUE,
  created_at timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT pricing_trip_price_version_pkey PRIMARY KEY (trip_id, version)
);
COMMENT ON TABLE core.pricing_trip_price_version IS
  'Version de prix d''un trip : chaque réservation ou modification rattache un devis figé (version '
  'suivante) ; le règlement porte la version en vigueur à l''événement. US-202, ADR-125.';

ALTER TABLE core.pricing_quote ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.pricing_quote FORCE ROW LEVEL SECURITY;
ALTER TABLE core.pricing_quote_line ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.pricing_quote_line FORCE ROW LEVEL SECURITY;
ALTER TABLE core.pricing_trip_price_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.pricing_trip_price_version FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.pricing_quote TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.pricing_quote_line TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.pricing_trip_price_version TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.pricing_quote, core.pricing_quote_line, core.pricing_trip_price_version FROM PUBLIC;

-- 2. Immuabilité (tout rôle, migrator compris) --------------------------------------------------
CREATE FUNCTION core.pricing_record_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- IF imbriqués : PL/pgSQL n'évalue pas AND en court-circuit garanti, et OLD.status n'existe que
  -- sur pricing_quote (42703 sur les lignes) ; NEW n'est défini qu'en UPDATE.
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'pricing_quote' THEN
      IF OLD.status = 'FROZEN' AND NEW.status = 'SUPERSEDED' AND NEW.superseded_at IS NOT NULL
         AND (to_jsonb(NEW) - 'status' - 'superseded_at')
             = (to_jsonb(OLD) - 'status' - 'superseded_at') THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'pricing record is immutable'
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'pricing_record_immutable';
END
$fn$;
REVOKE ALL ON FUNCTION core.pricing_record_guard() FROM PUBLIC;

CREATE TRIGGER pricing_quote_guard BEFORE UPDATE OR DELETE ON core.pricing_quote
  FOR EACH ROW EXECUTE FUNCTION core.pricing_record_guard();
CREATE TRIGGER pricing_quote_line_guard BEFORE UPDATE OR DELETE ON core.pricing_quote_line
  FOR EACH ROW EXECUTE FUNCTION core.pricing_record_guard();
CREATE TRIGGER pricing_trip_price_version_guard BEFORE UPDATE OR DELETE
  ON core.pricing_trip_price_version
  FOR EACH ROW EXECUTE FUNCTION core.pricing_record_guard();
CREATE TRIGGER pricing_quote_no_truncate BEFORE TRUNCATE ON core.pricing_quote
  FOR EACH STATEMENT EXECUTE FUNCTION core.pricing_record_guard();
CREATE TRIGGER pricing_quote_line_no_truncate BEFORE TRUNCATE ON core.pricing_quote_line
  FOR EACH STATEMENT EXECUTE FUNCTION core.pricing_record_guard();
CREATE TRIGGER pricing_trip_price_version_no_truncate BEFORE TRUNCATE
  ON core.pricing_trip_price_version
  FOR EACH STATEMENT EXECUTE FUNCTION core.pricing_record_guard();

-- 3. Droits du propriétaire des commandes d'argent (au plus juste) -------------------------------
GRANT SELECT, INSERT ON core.pricing_quote, core.pricing_quote_line, core.pricing_trip_price_version
  TO cmd_money_owner;
GRANT UPDATE (status, superseded_at) ON core.pricing_quote TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.pricing_quote FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.pricing_quote FOR INSERT TO cmd_money_owner WITH CHECK (true);
CREATE POLICY cmd_money_upd ON core.pricing_quote FOR UPDATE TO cmd_money_owner
  USING (status = 'FROZEN') WITH CHECK (status = 'SUPERSEDED');
CREATE POLICY cmd_money_sel ON core.pricing_quote_line FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.pricing_quote_line FOR INSERT TO cmd_money_owner WITH CHECK (true);
CREATE POLICY cmd_money_sel ON core.pricing_trip_price_version FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_ins ON core.pricing_trip_price_version FOR INSERT TO cmd_money_owner
  WITH CHECK (true);

-- configuration lue par le rejeu : taxes en vigueur, paramètres du devis (et rien d'autre)
GRANT SELECT ON core.pricing_tax_line_config TO cmd_money_owner;
CREATE POLICY cmd_money_read ON core.pricing_tax_line_config FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_quote_read ON core.config_param_value FOR SELECT TO cmd_money_owner
  USING (key IN ('grace_minutes', 'max_trip_days', 'host_default_plan', 'host_share_pct',
                 'delivery_share_pct', 'extras_share_pct'));
-- trip : portée du rattachement (le verrou FOR UPDATE passe par money_lock de 0027)
GRANT SELECT (guest_user_id, listing_id, scheduled_start, scheduled_end) ON core.booking_trip
  TO cmd_money_owner;
-- session du voyageur et annonce publiée (fonctions SECURITY DEFINER de leurs propriétaires :
-- seul le propriétaire accorde EXECUTE)
SET LOCAL ROLE iam_auth_owner;
GRANT EXECUTE ON FUNCTION core.iam_session_resolve(bytea) TO cmd_money_owner;
RESET ROLE;
SET LOCAL ROLE catalog_cmd_owner;
GRANT EXECUTE ON FUNCTION core.catalog_public_listing(uuid) TO cmd_money_owner;
RESET ROLE;

-- 4. Aides du rejeu (SECURITY INVOKER, sans lecture de table sauf pricing_param) ----------------

-- Valeur JSON en vigueur d'un paramètre de portée pays à platform.now(), sinon NULL.
CREATE FUNCTION core.pricing_param(p_key text, p_country text)
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

-- Part « n/d » dans [0 ; 1] (texte JSON), sinon NULL.
CREATE FUNCTION core.pricing_ratio(p_value jsonb)
  RETURNS numeric[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN m IS NOT NULL AND m[2]::numeric > 0 AND m[1]::numeric <= m[2]::numeric
              THEN ARRAY[m[1]::numeric, m[2]::numeric] END
    FROM (SELECT CASE WHEN pg_catalog.jsonb_typeof(p_value) = 'string'
                      THEN pg_catalog.regexp_match(p_value #>> '{}', '^([0-9]{1,18})/([0-9]{1,18})$')
                 END AS m) AS x
$fn$;

-- Instant en ms (nombre JSON entier sûr), sinon NULL.
CREATE FUNCTION core.pricing_ms(p_value jsonb)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN pg_catalog.jsonb_typeof(p_value) = 'number'
                   AND (p_value #>> '{}') ~ '^-?[0-9]{1,16}$'
                   AND abs((p_value #>> '{}')::numeric) <= 9007199254740991
              THEN (p_value #>> '{}')::numeric END
$fn$;

-- Montant en unités mineures (texte JSON d'un entier), sinon NULL.
CREATE FUNCTION core.pricing_minor(p_value jsonb)
  RETURNS numeric
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN pg_catalog.jsonb_typeof(p_value) = 'string'
                   AND (p_value #>> '{}') ~ '^(0|-?[1-9][0-9]{0,17})$'
              THEN (p_value #>> '{}')::numeric END
$fn$;

-- Empreinte SHA-256 (hexadécimal) de préfixe ‖ texte, comme frozen.ts.
CREATE FUNCTION core.pricing_digest(p_prefix text, p_text text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  STRICT
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_prefix || p_text, 'UTF8')), 'hex')
$fn$;

REVOKE ALL ON FUNCTION core.pricing_param(text, text), core.pricing_ratio(jsonb),
  core.pricing_ms(jsonb), core.pricing_minor(jsonb), core.pricing_digest(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.pricing_param(text, text), core.pricing_ratio(jsonb),
  core.pricing_ms(jsonb), core.pricing_minor(jsonb), core.pricing_digest(text, text)
  TO cmd_money_owner;

-- 5. Commandes ------------------------------------------------------------------------------------

-- 5.1 Figer un devis : rejeu complet par la base, puis écriture (16 PRC-025, L2-PM-03).
CREATE FUNCTION core.pricing_cmd_freeze_quote(p_token_hash bytea, p_listing_id uuid,
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
  v_start   numeric;
  v_end     numeric;
  v_grace   numeric;
  v_max     numeric;
  v_days    numeric;
  v_plan    jsonb;
  v_host    numeric[];
  v_deliv   numeric[];
  v_extras  numeric[];
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
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
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
  IF pg_catalog.jsonb_typeof(v_req) IS DISTINCT FROM 'object' OR v_start IS NULL OR v_end IS NULL
     OR v_end <= v_start
     OR pg_catalog.jsonb_typeof(v_req -> 'lines') IS DISTINCT FROM 'object'
     OR (v_out ->> 'engineVersion') IS DISTINCT FROM 'prc.quote/1'
     OR (v_out ->> 'currency') IS DISTINCT FROM l.currency
     OR core.pricing_minor(v_req -> 'dailyRate') IS DISTINCT FROM l.daily_price_minor::numeric THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;
  -- un devis ne se fige que pour une période à venir
  IF pg_catalog.to_timestamp(v_start / 1000) <= platform.now() THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
  END IF;

  -- paramètres du pays de l'annonce, en vigueur à platform.now()
  v_grace := core.pricing_ms(core.pricing_param('grace_minutes', l.country_code));
  v_max := core.pricing_ms(core.pricing_param('max_trip_days', l.country_code));
  v_plan := core.pricing_param('host_default_plan', l.country_code);
  IF pg_catalog.jsonb_typeof(v_plan) = 'string' THEN
    v_host := core.pricing_ratio(core.pricing_param('host_share_pct', l.country_code)
                                 -> (v_plan #>> '{}'));
  END IF;
  v_deliv := COALESCE(core.pricing_ratio(core.pricing_param('delivery_share_pct', l.country_code)),
                      v_host);
  v_extras := COALESCE(core.pricing_ratio(core.pricing_param('extras_share_pct', l.country_code)),
                       v_host);
  IF v_grace IS NULL OR v_grace < 0 OR v_max IS NULL OR v_max < 1 OR v_host IS NULL THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
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

  -- lignes : prix du trip calculé ici, les autres lues de la demande (jamais TRIP_PRICE fourni)
  IF (v_req -> 'lines') ? 'TRIP_PRICE' THEN
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
  FOR v_i IN 2 .. 10 LOOP
    IF v_amounts[v_i] < 0 AND c_types[v_i] NOT IN ('PROMO_PLATFORM', 'PROMO_HOST') THEN
      RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
      RETURN;
    END IF;
  END LOOP;
  -- protection et assistance : part de l'assureur non fixée (contrat, niveau : US-226)
  IF v_amounts[5] <> 0 OR v_amounts[7] <> 0 THEN
    RETURN QUERY SELECT 'QUOTE_UNAVAILABLE'::text, NULL::uuid;
    RETURN;
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

  -- jambes de la capture du total (08 E7) : HOST = hostFromGuest, INSURER = 0 (aucune protection),
  -- TAX_THIRD_PARTY = taxe des groupes third_party, PLATFORM = complément
  v_hfg := core.settlement_verify_host_from_guest(v_amounts, v_host, v_deliv, v_extras);
  IF v_total - v_hfg - v_tax3 < 0 THEN
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
     OR core.pricing_minor(v_out -> 'legs' -> 'INSURER') IS DISTINCT FROM 0
     OR core.pricing_minor(v_out -> 'legs' -> 'TAX_THIRD_PARTY') IS DISTINCT FROM v_tax3
     OR core.pricing_minor(v_out -> 'legs' -> 'PLATFORM') IS DISTINCT FROM v_total - v_hfg - v_tax3
  THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO core.pricing_quote (id, guest_user_id, listing_id, country_code, currency,
                                  engine_version, period, billable_days, subtotal_minor,
                                  tax_total_minor, tax_third_party_minor, total_minor,
                                  leg_host_minor, leg_insurer_minor, leg_tax_third_party_minor,
                                  leg_platform_minor, inputs, inputs_hash, outputs, outputs_hash)
  VALUES (v_id, v_user, p_listing_id, l.country_code, l.currency, 'prc.quote/1',
          pg_catalog.tstzrange(pg_catalog.to_timestamp(v_start / 1000),
                               pg_catalog.to_timestamp(v_end / 1000), '[)'),
          v_days::integer, v_sub::bigint, v_tax::bigint, v_tax3::bigint, v_total::bigint,
          v_hfg::bigint, 0, v_tax3::bigint, (v_total - v_hfg - v_tax3)::bigint,
          p_inputs, p_inputs_hash, p_outputs, p_outputs_hash);
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

-- 5.2 Rattacher un devis figé du voyageur à son trip : version suivante (BR-MOD-06).
CREATE FUNCTION core.pricing_cmd_version_trip_price(p_token_hash bytea, p_trip_id uuid,
                                                    p_quote_id uuid)
  RETURNS TABLE (outcome text, version integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  t         record;
  q         record;
  v_prev    uuid;
  v_version integer;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::integer;
    RETURN;
  END IF;
  -- verrou du trip : une version à la fois (premier gagnant)
  SELECT b.id, b.guest_user_id, b.listing_id, b.country_code, b.currency, b.status,
         b.scheduled_start, b.scheduled_end
    INTO t
    FROM core.booking_trip AS b
   WHERE b.id = p_trip_id
     FOR UPDATE;
  -- IDOR : le trip d'un autre voyageur répond comme un trip inconnu
  IF NOT FOUND OR t.guest_user_id IS DISTINCT FROM v_user THEN
    RETURN QUERY SELECT 'TRIP_NOT_FOUND'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT x.id, x.guest_user_id, x.listing_id, x.country_code, x.currency, x.status, x.period
    INTO q
    FROM core.pricing_quote AS x
   WHERE x.id = p_quote_id;
  IF NOT FOUND OR q.guest_user_id IS DISTINCT FROM v_user THEN
    RETURN QUERY SELECT 'QUOTE_NOT_FOUND'::text, NULL::integer;
    RETURN;
  END IF;
  IF q.status <> 'FROZEN'
     OR EXISTS (SELECT 1 FROM core.pricing_trip_price_version AS v WHERE v.quote_id = p_quote_id)
     OR t.status NOT IN ('BOOKED', 'CHECKIN_OPEN', 'IN_PROGRESS')
     OR q.country_code <> t.country_code OR q.currency <> t.currency
     OR (t.listing_id IS NOT NULL AND t.listing_id <> q.listing_id)
     OR q.period <> pg_catalog.tstzrange(t.scheduled_start, t.scheduled_end, '[)') THEN
    RETURN QUERY SELECT 'QUOTE_MISMATCH'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT v.quote_id, v.version INTO v_prev, v_version
    FROM core.pricing_trip_price_version AS v
   WHERE v.trip_id = p_trip_id
   ORDER BY v.version DESC
   LIMIT 1;
  v_version := COALESCE(v_version, 0) + 1;
  IF v_prev IS NOT NULL THEN
    UPDATE core.pricing_quote SET status = 'SUPERSEDED', superseded_at = platform.now()
     WHERE id = v_prev AND status = 'FROZEN';
  END IF;
  INSERT INTO core.pricing_trip_price_version (trip_id, version, quote_id)
  VALUES (p_trip_id, v_version, p_quote_id);
  RETURN QUERY SELECT 'DONE'::text, v_version;
END
$fn$;

COMMENT ON FUNCTION core.pricing_cmd_freeze_quote(bytea, uuid, text, text, text, text) IS
  'Fige un devis du voyageur de la session sur une annonce LISTED : empreintes vérifiées, devis '
  'rejoué par la base avec sa configuration (jours facturables, prix, taxe par ligne, total, '
  'jambes) ; tout écart ⇒ QUOTE_MISMATCH. SECURITY DEFINER, EXECUTE app_api. US-202 (ADR-125).';
COMMENT ON FUNCTION core.pricing_cmd_version_trip_price(bytea, uuid, uuid) IS
  'Rattache un devis figé du voyageur à son trip (version suivante, devis précédent SUPERSEDED). '
  'SECURITY DEFINER, EXECUTE app_api. US-202 (ADR-125).';

REVOKE ALL ON FUNCTION core.pricing_cmd_freeze_quote(bytea, uuid, text, text, text, text),
  core.pricing_cmd_version_trip_price(bytea, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.pricing_cmd_freeze_quote(bytea, uuid, text, text, text, text),
  core.pricing_cmd_version_trip_price(bytea, uuid, uuid) TO app_api;

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.pricing_cmd_freeze_quote(bytea, uuid, text, text, text, text)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.pricing_cmd_version_trip_price(bytea, uuid, uuid) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
