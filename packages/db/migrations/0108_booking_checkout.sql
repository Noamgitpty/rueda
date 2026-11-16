-- 0108 — AVL : checkout en une page, partie back-end (devis figé et pose du hold de checkout).
-- US-208 (partie 208a) ; 19 US-208 (TA01 128,40 ; QUOTE_EXPIRED et nouveau devis ;
-- MANUAL_TRANSMISSION_NOT_CONFIRMED ; DRIVER_MUST_BE_ACCOUNT_HOLDER ; TERMS_NOT_ACCEPTED ; version
-- exacte des CGU, de la politique d'annulation et du texte géographique retrouvable ; variante PY) ;
-- 16 BKG-001 / BKG-006, BKG-002 / BKG-025, BKG-008 / BKG-023, PRC-025 ; 17 §2.5, §3.2.4, §3.2.5,
-- §3.2.6 ; 08 BR-BOOK-01, BR-BOOK-08, BR-BOOK-12, BR-GEO-01, BR-GEO-02, BR-ACC-08 ; suivis du
-- BOARD N-128 (annonce sur demande jamais réservée comme INSTANT), N-129 (lignes non rejouées par la
-- base, durée de validité du devis), N-130 (route du devis : taille et débit) ; pré-mortem du lot 2 :
-- L2-PM-03, L2-PM-09, L2-PM-13, L2-PM-14, L2-PM-31 ; ADR-133.
-- Appliquée sous `migrator`, en une transaction. Paramètres `quote_*` : graine 0107.
--
-- Principes (ADR-133, PROPOSÉS) :
--   - devis figé : `expires_at` = gel + `quote_validity_minutes` du pays (16 PRC-025 : 30 min) ;
--     débit des gels par voyageur (`quote_freezes_per_guest_hour`) ; documents canoniques bornés à
--     64 Kio (N-130). Rejeu inchangé (0102) ;
--   - on écrit UNIQUEMENT par la commande `core.booking_cmd_checkout` (SECURITY DEFINER,
--     propriétaire `cmd_hold_owner`, EXECUTE au seul `app_api`) : voyageur désigné par son jeton
--     de session (aucun identifiant de personne en paramètre), une seule transaction :
--       devis du voyageur, FROZEN, jamais utilisé, non expiré à platform.now() (QUOTE_EXPIRED) ;
--       lignes rejouées par la base seulement (TRIP_PRICE, TRIP_FEE ; toute autre ligne ⇒
--         QUOTE_LINE_NOT_SUPPORTED tant que sa story ne la recalcule pas en base, N-129) ;
--       annonce LISTED, hôte activable (interrupteurs du pays : absent = false) ;
--       annonce sur demande (`instant_book = false`) ⇒ REQUEST_MODE_UNAVAILABLE, jamais un hold
--         INSTANT (N-128 ; le mode REQUEST arrive avec US-223) ;
--       boîte manuelle sans la case ⇒ MANUAL_TRANSMISSION_NOT_CONFIRMED (BKG-025) ;
--       conducteur = titulaire du compte (nom légal) sinon DRIVER_MUST_BE_ACCOUNT_HOLDER (BKG-002) ;
--       versions en vigueur des CGU du voyageur, de la politique d'annulation et du texte
--         géographique acceptées (BKG-008, BKG-023), consentements `CHECKOUT` enregistrés ;
--       pose du hold par la commande existante `core.booking_cmd_place_hold` (mêmes contrôles :
--         auto-réservation, restrictions, chevauchement, préavis, exclusion GiST) ; une
--         auto-réservation refusée est signalée à l'ops (`core.booking_cmd_report_self_booking`,
--         contrat d'US-127) hors de la sous-transaction annulée ;
--       rattachement du hold au devis et aux versions acceptées (`booking_checkout_acceptance`,
--         `booking_checkout_terms`, registres immuables) ;
--   - aucun paiement : l'intention de paiement et la conversion restent à US-223 ;
--   - aucune constante de pays : pays, devise, paramètres et documents lus des tables.
--
-- Issues (colonne `outcome`) : DONE, AUTH_REQUIRED, QUOTE_NOT_FOUND, QUOTE_ALREADY_USED,
--   QUOTE_EXPIRED, QUOTE_LINE_NOT_SUPPORTED, LISTING_UNAVAILABLE, REQUEST_MODE_UNAVAILABLE,
--   MANUAL_TRANSMISSION_NOT_CONFIRMED, DRIVER_MUST_BE_ACCOUNT_HOLDER, TERMS_NOT_ACCEPTED,
--   TERMS_VERSION_CHANGED, TERMS_UNAVAILABLE, et les refus de la pose du hold : DATES_UNAVAILABLE,
--   DATES_NOTICE_TOO_SHORT, GUEST_OVERLAP, HOLD_ALREADY_LIVE, HOLD_LIMIT_REACHED,
--   HOLD_RATE_LIMITED, SELF_BOOKING_FORBIDDEN, ACCOUNT_RESTRICTED, KYC_CONSENT_WITHDRAWN,
--   BOOKING_UNAVAILABLE. Gel : QUOTE_RATE_LIMITED en plus des issues de 0102.
-- Erreur (SQLSTATE 23000, contrainte) traduite par packages/db/src/errors.ts :
--   booking_checkout_immutable → IMMUTABLE_RECORD.
--
-- Expand / contract : colonne, tables, fonctions, politiques et droits AJOUTÉS ; deux CHECK
-- élargis (genre GEO_TERMS) ; commande de gel et pays du compte remplacés (mêmes signatures,
-- propriétaires et droits) ; politique de lecture des paramètres de cmd_hold_owner élargie.
--
-- Retour arrière :
--   DROP FUNCTION core.booking_cmd_checkout(bytea, uuid, text, text, boolean, jsonb),
--     core.booking_checkout_quote(bytea, uuid), core.booking_checkout_summary(bytea, uuid),
--     core.ctr_checkout_terms(uuid, text, jsonb), core.iam_holder_name_matches(uuid, text, text),
--     core.booking_checkout_record_guard() CASCADE ;
--   DROP TABLE core.booking_checkout_terms, core.booking_checkout_acceptance ;
--   rejouer core.pricing_cmd_freeze_quote de 0102 et core.ctr_account_country de 0059 ;
--   ALTER TABLE core.pricing_quote DROP COLUMN expires_at ; DELETE des gabarits GEO_TERMS et
--     CANCELLATION_POLICY de la version 1, puis remettre les deux CHECK de 0059 ;
--   recréer les politiques cmd_money_quote_read et cmd_hold_read de config_param_value (0102,
--     0099) ; REVOKE des droits accordés ci-dessous.

-- 1. Devis figé : durée de validité ----------------------------------------------------------------
ALTER TABLE core.pricing_quote ADD COLUMN expires_at timestamptz;
ALTER TABLE core.pricing_quote ADD CONSTRAINT pricing_quote_expires_after_frozen
  CHECK (expires_at IS NULL OR expires_at > frozen_at);
COMMENT ON COLUMN core.pricing_quote.expires_at IS
  'Fin de validité du devis figé (17 §3.2.5) : gel + quote_validity_minutes du pays ; au-delà, '
  'QUOTE_EXPIRED au checkout (16 PRC-025). NULL : devis figé avant US-208, jamais réservable.';
GRANT INSERT (expires_at) ON core.pricing_quote TO cmd_money_owner;
ALTER POLICY cmd_money_quote_read ON core.config_param_value
  USING (key IN ('grace_minutes', 'max_trip_days', 'host_default_plan', 'host_share_pct',
                 'delivery_share_pct', 'extras_share_pct', 'trip_fee_schedule',
                 'quote_validity_minutes', 'quote_freezes_per_guest_hour'));

-- 2. Commande de gel remplacée (sous son propriétaire, CREATE accordé le temps du remplacement ;
-- propriétaire, EXECUTE et entrée de security-definer-allowlist.json inchangés) -----------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;
-- 2.1 Figer un devis : rejeu complet par la base (0102), plus taille, débit et validité (US-208).
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
  v_start   numeric;
  v_end     numeric;
  v_grace   numeric;
  v_max     numeric;
  v_days    numeric;
  v_plan    jsonb;
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
  IF pg_catalog.jsonb_typeof(v_req) IS DISTINCT FROM 'object' OR v_start IS NULL OR v_end IS NULL
     OR v_end <= v_start
     OR pg_catalog.jsonb_typeof(v_req -> 'lines') IS DISTINCT FROM 'object'
     OR (v_out ->> 'engineVersion') IS DISTINCT FROM 'prc.quote/2'
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

  -- lignes : prix du trip et trip fee calculés ici, les autres lues de la demande (ni TRIP_PRICE
  -- ni TRIP_FEE fournis : L2-PM-03, US-704)
  IF (v_req -> 'lines') ?| ARRAY['TRIP_PRICE', 'TRIP_FEE'] THEN
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
                                  leg_platform_minor, inputs, inputs_hash, outputs, outputs_hash,
                                  expires_at)
  VALUES (v_id, v_user, p_listing_id, l.country_code, l.currency, 'prc.quote/2',
          pg_catalog.tstzrange(pg_catalog.to_timestamp(v_start / 1000),
                               pg_catalog.to_timestamp(v_end / 1000), '[)'),
          v_days::integer, v_sub::bigint, v_tax::bigint, v_tax3::bigint, v_total::bigint,
          v_hfg::bigint, 0, v_tax3::bigint, (v_total - v_hfg - v_tax3)::bigint,
          p_inputs, p_inputs_hash, p_outputs, p_outputs_hash,
          platform.now() + pg_catalog.make_interval(mins => v_valid::integer));
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
  'Fige un devis prc.quote/2 du voyageur de la session sur une annonce LISTED : documents bornés, '
  'débit quote_freezes_per_guest_hour, empreintes vérifiées, devis rejoué par la base avec sa '
  'configuration (jours facturables, prix du trip, trip fee, taxe par ligne, total, jambes) ; tout '
  'écart ⇒ QUOTE_MISMATCH ; expires_at = gel + quote_validity_minutes. SECURITY DEFINER, EXECUTE '
  'app_api. US-202, US-704, US-208 (ADR-125, ADR-129, ADR-133).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 3. Documents du checkout : texte géographique (BKG-023) -------------------------------------
ALTER TABLE core.contract_document_template DROP CONSTRAINT document_template_kind_valid;
ALTER TABLE core.contract_document_template ADD CONSTRAINT document_template_kind_valid
  CHECK (kind IN ('TOS_GUEST', 'TOS_HOST', 'PRIVACY', 'MARKETING', 'BIOMETRIC_CONSENT',
                  'RENTAL_CONTRACT', 'CONSTANCIA', 'DAMAGE_TERMS', 'CANCELLATION_POLICY',
                  'GEO_TERMS'));
ALTER TABLE core.contract_consent DROP CONSTRAINT consent_doc_kind_valid;
ALTER TABLE core.contract_consent ADD CONSTRAINT consent_doc_kind_valid
  CHECK (doc_kind IN ('TOS_GUEST', 'TOS_HOST', 'PRIVACY', 'MARKETING', 'BIOMETRIC_CONSENT',
                      'DAMAGE_TERMS', 'CANCELLATION_POLICY', 'GEO_TERMS'));

-- Graine : version 1 BROUILLON commune aux pays (textes PROPOSÉS, à valider par le juridique à la
-- recette, DEC-FONDATEUR-02, OQ-BR-24) ; version propre à un pays publiée par la console (US-102).
-- En vigueur dès l'origine ; empreinte posée par le déclencheur de garde.
INSERT INTO core.contract_document_template
       (kind, country_code, locale, version, is_major, title, body_md, content_hash,
        legal_review_ref, is_authoritative, valid_from)
SELECT d.kind, NULL, d.locale, 1, true, d.title, d.body,
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), NULL, d.locale = 'es',
       '2000-01-01T00:00:00Z'
  FROM (VALUES
    ('CANCELLATION_POLICY', 'es', 'Política de cancelación (BORRADOR)',
     E'**BORRADOR — pendiente de validación jurídica.** Este texto es provisional.\n\n1. Antes del viaje puedes cancelar desde tu cuenta. El reembolso y lo que se conserva se calculan por la plataforma según las reglas publicadas y la antelación de tu cancelación; el importe se muestra antes de confirmar.\n2. Si el anfitrión cancela, se te reembolsa todo lo pagado.\n3. Si no te presentas a la entrega sin cancelar, el viaje se considera no presentado y se aplican las reglas de cancelación tardía.\n4. Un viaje en curso no se cancela: se termina antes y se liquida según las reglas publicadas.\n\nEl texto en español hace fe.'),
    ('CANCELLATION_POLICY', 'en', 'Cancellation policy (DRAFT)',
     E'**DRAFT — pending legal review.** This text is provisional.\n\n1. Before the trip you can cancel from your account. The refund and what is kept are calculated by the platform under the published rules and how early you cancel; the amount is shown before you confirm.\n2. If the host cancels, everything you paid is refunded.\n3. If you do not show up at the handover without cancelling, the trip counts as a no-show and the late cancellation rules apply.\n4. A trip in progress is not cancelled: it ends early and is settled under the published rules.\n\nThe Spanish text prevails.'),
    ('CANCELLATION_POLICY', 'fr', 'Politique d''annulation (BROUILLON)',
     E'**BROUILLON — à valider par le juridique.** Ce texte est provisoire.\n\n1. Avant le trajet, vous pouvez annuler depuis votre compte. Le remboursement et ce qui est conservé sont calculés par la plateforme selon les règles publiées et le délai de votre annulation ; le montant est affiché avant confirmation.\n2. Si l''hôte annule, tout ce que vous avez payé vous est remboursé.\n3. Si vous ne vous présentez pas à la remise sans avoir annulé, le trajet est compté comme non présenté et les règles d''annulation tardive s''appliquent.\n4. Un trajet en cours ne s''annule pas : il se termine plus tôt et il est réglé selon les règles publiées.\n\nLe texte espagnol fait foi.'),
    ('CANCELLATION_POLICY', 'pt', 'Política de cancelamento (RASCUNHO)',
     E'**RASCUNHO — pendente de validação jurídica.** Este texto é provisório.\n\n1. Antes da viagem, você pode cancelar pela sua conta. O reembolso e o que é retido são calculados pela plataforma conforme as regras publicadas e a antecedência do cancelamento; o valor é mostrado antes de você confirmar.\n2. Se o anfitrião cancelar, tudo o que você pagou é reembolsado.\n3. Se você não comparecer à entrega sem cancelar, a viagem conta como não comparecimento e as regras de cancelamento tardio se aplicam.\n4. Uma viagem em andamento não é cancelada: ela termina antes e é liquidada conforme as regras publicadas.\n\nO texto em espanhol prevalece.'),
    ('GEO_TERMS', 'es', 'Zonas de circulación (BORRADOR)',
     E'**BORRADOR — pendiente de validación jurídica.** Este texto es provisional.\n\n1. El auto no puede salir del territorio donde se alquila: está prohibido cruzar una frontera con él.\n2. No circules por las zonas ni por las vías que el anfitrión excluye en su anuncio, ni por vías sin pavimentar si el anuncio las excluye.\n3. Estas reglas se repiten en el contrato de alquiler entre el anfitrión y tú. Si no las respetas, puedes perder la protección y responder de los daños.\n\nEl texto en español hace fe.'),
    ('GEO_TERMS', 'en', 'Where you can drive (DRAFT)',
     E'**DRAFT — pending legal review.** This text is provisional.\n\n1. The car may not leave the country of the trip: crossing a border with it is forbidden.\n2. Do not drive in the areas or on the roads that the host excludes in the listing, or on unpaved roads if the listing excludes them.\n3. These rules are repeated in the rental contract between the host and you. If you break them, you may lose the protection and be liable for the damage.\n\nThe Spanish text prevails.'),
    ('GEO_TERMS', 'fr', 'Zones de circulation (BROUILLON)',
     E'**BROUILLON — à valider par le juridique.** Ce texte est provisoire.\n\n1. La voiture ne peut pas quitter le pays du trajet : passer une frontière avec elle est interdit.\n2. Ne circulez pas dans les zones ni sur les routes que l''hôte exclut dans son annonce, ni sur les routes non revêtues si l''annonce les exclut.\n3. Ces règles sont reprises dans le contrat de location entre l''hôte et vous. Si vous ne les respectez pas, vous pouvez perdre la protection et répondre des dommages.\n\nLe texte espagnol fait foi.'),
    ('GEO_TERMS', 'pt', 'Onde você pode dirigir (RASCUNHO)',
     E'**RASCUNHO — pendente de validação jurídica.** Este texto é provisório.\n\n1. O carro não pode sair do território onde é alugado: é proibido atravessar uma fronteira com ele.\n2. Não circule nas áreas nem nas vias que o anfitrião exclui no anúncio, nem em vias sem pavimento se o anúncio as excluir.\n3. Estas regras são repetidas no contrato de locação entre o anfitrião e você. Se não as respeitar, você pode perder a proteção e responder pelos danos.\n\nO texto em espanhol prevalece.')
  ) AS d(kind, locale, title, body);

-- 4. Pays du compte : une acceptation au checkout (pays du trajet) ne le change pas (aide
-- SECURITY INVOKER de 0059, propriétaire migrator ; droits inchangés) ---------------------------
CREATE OR REPLACE FUNCTION core.ctr_account_country(p_user_id uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.country_code::text FROM core.contract_consent AS c
   WHERE c.user_id = p_user_id AND c.doc_kind = 'TOS_GUEST' AND c.accepted
     AND c.context <> 'CHECKOUT'
   ORDER BY c.seq DESC LIMIT 1
$fn$;

-- 5. Aides d'IAM et de CTR pour le checkout (SECURITY DEFINER, propriétaire iam_auth_owner,
-- EXECUTE au seul cmd_hold_owner : jamais appelables par un rôle applicatif) ------------------
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
SET LOCAL ROLE iam_auth_owner;

-- 5.1 Conducteur = titulaire du compte (16 BKG-002 : prénom et nom du permis, nom légal du compte,
-- ACC-006) : comparaison sans casse ni espaces superflus ; vide, trop long ou différent ⇒ false.
CREATE FUNCTION core.iam_holder_name_matches(p_user_id uuid, p_first text, p_last text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH n AS (
    SELECT pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(p_first), '\s+', ' ', 'g')) AS f,
           pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(p_last), '\s+', ' ', 'g')) AS l
  )
  SELECT COALESCE((
    SELECT n.f = pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(u.legal_first_name), '\s+', ' ', 'g'))
       AND n.l = pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(u.legal_last_name), '\s+', ' ', 'g'))
      FROM core.iam_user_account AS u, n
     WHERE u.id = p_user_id
       AND pg_catalog.length(n.f) BETWEEN 1 AND 100 AND pg_catalog.length(n.l) BETWEEN 1 AND 100), false)
$fn$;

-- 5.2 Documents du checkout (16 BKG-008, BKG-023) : CGU du voyageur, politique d'annulation et
-- texte géographique en vigueur dans le pays du trajet, dans la langue du compte (repli : la
-- langue qui fait foi). `p_documents` NULL : liste des versions à afficher, rien d'écrit. Sinon :
-- chaque genre exactement une fois avec la version affichée, puis un consentement `CHECKOUT` par
-- document (C2 retenues) ; rien n'est écrit si un document manque, est périmé ou n'existe pas.
-- Issues : DONE (une ligne par document), TERMS_NOT_ACCEPTED, TERMS_VERSION_CHANGED,
-- TERMS_UNAVAILABLE (une ligne, sans document).
CREATE FUNCTION core.ctr_checkout_terms(p_user_id uuid, p_country text, p_documents jsonb)
  RETURNS TABLE (outcome text, doc_kind text, doc_version integer, locale text, title text,
                 template_id uuid, consent_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  c_kinds CONSTANT text[] := ARRAY['TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS'];
  v_lang  text;
  v_kind  text;
  v_e     jsonb;
  v_t     core.contract_document_template%ROWTYPE;
  v_ids   uuid[] := ARRAY[]::uuid[];
  v_id    uuid;
  v_i     integer;
BEGIN
  SELECT pg_catalog.split_part(u.preferred_locale, '-', 1) INTO v_lang
    FROM core.iam_user_account AS u WHERE u.id = p_user_id;
  IF v_lang IS NULL OR p_country IS NULL THEN
    RETURN QUERY SELECT 'TERMS_UNAVAILABLE'::text, NULL::text, NULL::integer, NULL::text,
                        NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  -- versions en vigueur, toutes présentes (sinon aucun checkout : fail-closed)
  FOREACH v_kind IN ARRAY c_kinds LOOP
    SELECT * INTO v_t FROM core.ctr_current_template(v_kind, p_country, v_lang, false);
    IF v_t.id IS NULL THEN
      RETURN QUERY SELECT 'TERMS_UNAVAILABLE'::text, NULL::text, NULL::integer, NULL::text,
                          NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    v_ids := v_ids || v_t.id;
  END LOOP;
  IF p_documents IS NULL THEN
    RETURN QUERY SELECT 'DONE'::text, t.kind, t.version, t.locale, t.title, t.id, NULL::uuid
                   FROM core.contract_document_template AS t
                   JOIN pg_catalog.unnest(v_ids) WITH ORDINALITY AS x(id, n) ON x.id = t.id
                  ORDER BY x.n;
    RETURN;
  END IF;
  -- demande : un tableau d'au plus trois objets { kind, version }, chaque genre une fois
  IF pg_catalog.jsonb_typeof(p_documents) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_documents) <> 3 THEN
    RETURN QUERY SELECT 'TERMS_NOT_ACCEPTED'::text, NULL::text, NULL::integer, NULL::text,
                        NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;
  FOR v_i IN 1 .. 3 LOOP
    v_kind := c_kinds[v_i];
    SELECT d.e INTO v_e FROM pg_catalog.jsonb_array_elements(p_documents) AS d(e)
     WHERE pg_catalog.jsonb_typeof(d.e) = 'object' AND d.e ->> 'kind' = v_kind;
    IF NOT FOUND OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_documents) AS d(e)
                      WHERE pg_catalog.jsonb_typeof(d.e) = 'object' AND d.e ->> 'kind' = v_kind) <> 1
       OR pg_catalog.jsonb_typeof(v_e -> 'version') IS DISTINCT FROM 'number' THEN
      RETURN QUERY SELECT 'TERMS_NOT_ACCEPTED'::text, NULL::text, NULL::integer, NULL::text,
                          NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
    SELECT * INTO v_t FROM core.contract_document_template AS t WHERE t.id = v_ids[v_i];
    IF (v_e ->> 'version')::numeric IS DISTINCT FROM v_t.version::numeric THEN
      RETURN QUERY SELECT 'TERMS_VERSION_CHANGED'::text, NULL::text, NULL::integer, NULL::text,
                          NULL::text, NULL::uuid, NULL::uuid;
      RETURN;
    END IF;
  END LOOP;
  FOR v_i IN 1 .. 3 LOOP
    INSERT INTO core.contract_consent (user_id, template_id, doc_kind, doc_version, locale, accepted,
                                       accepted_at, context, country_code, c2_withheld)
    SELECT p_user_id, t.id, t.kind, t.version, t.locale, true, platform.now(), 'CHECKOUT',
           p_country, true
      FROM core.contract_document_template AS t
     WHERE t.id = v_ids[v_i]
    RETURNING id INTO v_id;
    RETURN QUERY SELECT 'DONE'::text, t.kind, t.version, t.locale, t.title, t.id, v_id
                   FROM core.contract_document_template AS t WHERE t.id = v_ids[v_i];
  END LOOP;
END
$fn$;

COMMENT ON FUNCTION core.iam_holder_name_matches(uuid, text, text) IS
  'Le nom saisi pour le conducteur est-il le nom légal du compte (sans casse ni espaces superflus) '
  '? Aucune donnée rendue. SECURITY DEFINER, EXECUTE cmd_hold_owner. US-208 (16 BKG-002).';
COMMENT ON FUNCTION core.ctr_checkout_terms(uuid, text, jsonb) IS
  'Documents du checkout en vigueur dans le pays du trajet (CGU du voyageur, politique '
  'd''annulation, texte géographique) ; avec une demande : versions affichées vérifiées, puis un '
  'consentement CHECKOUT par document. SECURITY DEFINER, EXECUTE cmd_hold_owner. US-208.';
REVOKE ALL ON FUNCTION core.iam_holder_name_matches(uuid, text, text),
  core.ctr_checkout_terms(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_holder_name_matches(uuid, text, text),
  core.ctr_checkout_terms(uuid, text, jsonb) TO cmd_hold_owner;
-- session du voyageur (fonction d'iam_auth_owner : seul son propriétaire accorde EXECUTE)
GRANT EXECUTE ON FUNCTION core.iam_session_resolve(bytea) TO cmd_hold_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;

-- 6. Rattachement du hold au devis et aux versions acceptées (registres immuables) -------------
CREATE TABLE core.booking_checkout_acceptance (
  hold_id             uuid        NOT NULL
    CONSTRAINT booking_checkout_acceptance_pkey PRIMARY KEY
    REFERENCES core.booking_checkout_hold (id),
  quote_id            uuid        NOT NULL REFERENCES core.pricing_quote (id)
    CONSTRAINT booking_checkout_acceptance_quote_unique UNIQUE,
  guest_user_id       uuid        NOT NULL REFERENCES core.iam_user_account (id),
  country_code        char(2)     NOT NULL REFERENCES core.config_country (code),
  -- case « je sais conduire une boîte manuelle » cochée (16 BKG-025) ; NULL : boîte automatique
  manual_confirmed_at timestamptz,
  created_at          timestamptz NOT NULL DEFAULT platform.now()
);
COMMENT ON TABLE core.booking_checkout_acceptance IS
  'Checkout d''un hold (16 BKG-001, booking_draft) : devis figé engagé (un devis, un hold), pays, '
  'confirmation de la boîte manuelle ; conducteur = titulaire du compte (BKG-002, seul cas admis en '
  'bêta). Écrite par core.booking_cmd_checkout seulement ; immuable. US-208, ADR-133.';

CREATE TABLE core.booking_checkout_terms (
  hold_id     uuid    NOT NULL REFERENCES core.booking_checkout_acceptance (hold_id),
  doc_kind    text    NOT NULL
    CONSTRAINT booking_checkout_terms_kind_valid
    CHECK (doc_kind IN ('TOS_GUEST', 'CANCELLATION_POLICY', 'GEO_TERMS')),
  template_id uuid    NOT NULL REFERENCES core.contract_document_template (id),
  doc_version integer NOT NULL CONSTRAINT booking_checkout_terms_version_positive
                               CHECK (doc_version >= 1),
  locale      text    NOT NULL CONSTRAINT booking_checkout_terms_locale_valid
                               CHECK (locale IN ('es', 'en', 'fr', 'pt')),
  consent_id  uuid    NOT NULL REFERENCES core.contract_consent (id),
  CONSTRAINT booking_checkout_terms_pkey PRIMARY KEY (hold_id, doc_kind)
);
COMMENT ON TABLE core.booking_checkout_terms IS
  'Version exacte de chaque document accepté au checkout d''un hold (16 BKG-008 : CGU, politique '
  'd''annulation, texte géographique) et son consentement. Immuable. US-208, ADR-133.';

ALTER TABLE core.booking_checkout_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_checkout_acceptance FORCE ROW LEVEL SECURITY;
ALTER TABLE core.booking_checkout_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.booking_checkout_terms FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.booking_checkout_acceptance TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.booking_checkout_terms TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.booking_checkout_acceptance, core.booking_checkout_terms FROM PUBLIC;

CREATE FUNCTION core.booking_checkout_record_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'checkout record is immutable'
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'booking_checkout_immutable';
END
$fn$;
REVOKE ALL ON FUNCTION core.booking_checkout_record_guard() FROM PUBLIC;
CREATE TRIGGER booking_checkout_acceptance_guard BEFORE UPDATE OR DELETE
  ON core.booking_checkout_acceptance
  FOR EACH ROW EXECUTE FUNCTION core.booking_checkout_record_guard();
CREATE TRIGGER booking_checkout_terms_guard BEFORE UPDATE OR DELETE ON core.booking_checkout_terms
  FOR EACH ROW EXECUTE FUNCTION core.booking_checkout_record_guard();
CREATE TRIGGER booking_checkout_acceptance_no_truncate BEFORE TRUNCATE
  ON core.booking_checkout_acceptance
  FOR EACH STATEMENT EXECUTE FUNCTION core.booking_checkout_record_guard();
CREATE TRIGGER booking_checkout_terms_no_truncate BEFORE TRUNCATE ON core.booking_checkout_terms
  FOR EACH STATEMENT EXECUTE FUNCTION core.booking_checkout_record_guard();

-- 7. Droits de cmd_hold_owner (au plus juste) --------------------------------------------------
GRANT SELECT, INSERT ON core.booking_checkout_acceptance, core.booking_checkout_terms
  TO cmd_hold_owner;
CREATE POLICY cmd_hold_sel ON core.booking_checkout_acceptance FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_ins ON core.booking_checkout_acceptance FOR INSERT TO cmd_hold_owner
  WITH CHECK (true);
CREATE POLICY cmd_hold_sel ON core.booking_checkout_terms FOR SELECT TO cmd_hold_owner USING (true);
CREATE POLICY cmd_hold_ins ON core.booking_checkout_terms FOR INSERT TO cmd_hold_owner
  WITH CHECK (true);
-- devis figé : lecture des colonnes utiles au checkout (jamais d'écriture)
GRANT SELECT (id, guest_user_id, listing_id, country_code, currency, status, period,
              billable_days, total_minor, frozen_at, expires_at)
  ON core.pricing_quote TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.pricing_quote FOR SELECT TO cmd_hold_owner USING (true);
GRANT SELECT (quote_id, seq, line_type, amount_minor, tax_minor) ON core.pricing_quote_line
  TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.pricing_quote_line FOR SELECT TO cmd_hold_owner USING (true);
-- annonce : mode de réservation ; véhicule : boîte de vitesses
GRANT SELECT (id, instant_book) ON core.catalog_listing TO cmd_hold_owner;
GRANT SELECT (transmission) ON core.catalog_vehicle TO cmd_hold_owner;
-- hôte activable (aide de CAT, interrupteurs du pays lus par core.config_go_live)
GRANT EXECUTE ON FUNCTION core.config_go_live(text, text), core.catalog_search_host_open(uuid, text)
  TO cmd_hold_owner;
GRANT SELECT (key, go_live_switch) ON core.config_param_definition TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.config_param_definition FOR SELECT TO cmd_hold_owner
  USING (key IN ('p2p_private_hosts_enabled', 'insurer_contract_active'));
DROP POLICY cmd_hold_read ON core.config_param_value;
CREATE POLICY cmd_hold_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key IN ('buffer_minutes', 'hold_ttl_minutes', 'hold_max_total_minutes',
                 'max_active_holds_per_guest', 'hold_creations_per_guest_vehicle_hour',
                 'sweep_grace_s', 'flagged_booking_payment_order', 'review_hold_minutes',
                 'payment_in_flight_margin_s', 'psp_call_timeout_s',
                 'conversion_start_tolerance_minutes', 'payment_attempts_per_hold',
                 'max_trip_days', 'advance_notice_minutes',
                 'no_show_grace_minutes', 'overdue_detection_minutes',
                 'p2p_private_hosts_enabled', 'insurer_contract_active'));

-- 8. Commandes et lectures du checkout (SECURITY DEFINER, cmd_hold_owner, EXECUTE app_api) -----
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 8.1 Devis figé du voyageur de la session, prêt pour le checkout : période, lignes rejouées par la
-- base (montant et taxe, 16 BKG-006), total, validité, boîte de vitesses et mode de l'annonce,
-- versions des documents à accepter. Devis d'un autre voyageur ou inconnu : aucune ligne (même
-- réponse).
CREATE FUNCTION core.booking_checkout_quote(p_token_hash bytea, p_quote_id uuid)
  RETURNS TABLE (quote_id uuid, listing_id uuid, country_code text, currency text,
                 start_at timestamptz, end_at timestamptz, billable_days integer,
                 lines jsonb, total_minor bigint, expires_at timestamptz, expired boolean,
                 manual_transmission boolean, instant_book boolean, documents jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  q      record;
  v_docs  jsonb;
  v_lines jsonb;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL OR p_quote_id IS NULL THEN
    RETURN;
  END IF;
  SELECT pq.id, pq.listing_id, pq.country_code, pq.currency, pq.period, pq.billable_days,
         pq.total_minor, pq.expires_at, pq.status, l.instant_book, v.transmission
    INTO q
    FROM core.pricing_quote AS pq
    JOIN core.catalog_listing AS l ON l.id = pq.listing_id
    JOIN core.catalog_vehicle AS v ON v.id = l.vehicle_id
   WHERE pq.id = p_quote_id AND pq.guest_user_id = v_user;
  IF q.id IS NULL THEN
    RETURN;
  END IF;
  -- montants en texte (unités mineures, bigint sans perte côté API)
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('type', ln.line_type, 'amountMinor',
                                                             ln.amount_minor::text, 'taxMinor',
                                                             ln.tax_minor::text) ORDER BY ln.seq)
    INTO v_lines
    FROM core.pricing_quote_line AS ln
   WHERE ln.quote_id = q.id;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', t.doc_kind, 'version',
                                                             t.doc_version, 'locale', t.locale,
                                                             'title', t.title))
    INTO v_docs
    FROM core.ctr_checkout_terms(v_user, q.country_code, NULL) AS t
   WHERE t.outcome = 'DONE';
  RETURN QUERY SELECT q.id, q.listing_id, q.country_code, q.currency, pg_catalog.lower(q.period),
                      pg_catalog.upper(q.period), q.billable_days, COALESCE(v_lines, '[]'::jsonb),
                      q.total_minor, q.expires_at,
                      q.status <> 'FROZEN' OR q.expires_at IS NULL OR q.expires_at <= platform.now(),
                      q.transmission = 'MANUAL', q.instant_book, COALESCE(v_docs, '[]'::jsonb);
END
$fn$;

-- 8.2 Checkout : contrôles du devis, de l'annonce, du conducteur et des documents, puis pose du
-- hold par core.booking_cmd_place_hold et rattachement, dans la même transaction (voir l'en-tête).
CREATE FUNCTION core.booking_cmd_checkout(p_token_hash bytea, p_quote_id uuid, p_driver_first text,
                                          p_driver_last text, p_manual_confirmed boolean,
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
  -- N-129 : seules les lignes rejouées par la base (0102) engagent un prix
  IF EXISTS (SELECT 1 FROM core.pricing_quote_line AS ln
              WHERE ln.quote_id = q.id AND ln.line_type NOT IN ('TRIP_PRICE', 'TRIP_FEE')) THEN
    RETURN QUERY SELECT 'QUOTE_LINE_NOT_SUPPORTED'::text, NULL::uuid, NULL::timestamptz;
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
  -- consentements (sous-transaction)
  BEGIN
    FOR v_terms IN SELECT * FROM core.ctr_checkout_terms(v_user, v_country, p_documents) LOOP
      IF v_terms.outcome <> 'DONE' THEN
        RETURN QUERY SELECT v_terms.outcome, NULL::uuid, NULL::timestamptz;
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

-- 8.3 Récapitulatif d'un hold de checkout du voyageur de la session : état, échéance, devis
-- engagé et version exacte de chaque document accepté. Hold d'un autre voyageur ou inconnu : aucune
-- ligne (même réponse).
CREATE FUNCTION core.booking_checkout_summary(p_token_hash bytea, p_hold_id uuid)
  RETURNS TABLE (hold_id uuid, status text, expires_at timestamptz, quote_id uuid,
                 listing_id uuid, currency text, start_at timestamptz, end_at timestamptz,
                 total_minor bigint, manual_confirmed_at timestamptz, documents jsonb)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT h.id, h.status, h.expires_at, a.quote_id, pq.listing_id, pq.currency,
         pg_catalog.lower(pq.period), pg_catalog.upper(pq.period), pq.total_minor,
         a.manual_confirmed_at,
         (SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind', t.doc_kind, 'version',
                                                                     t.doc_version, 'locale',
                                                                     t.locale)
                                      ORDER BY t.doc_kind)
            FROM core.booking_checkout_terms AS t WHERE t.hold_id = h.id)
    FROM core.booking_checkout_acceptance AS a
    JOIN core.booking_checkout_hold AS h ON h.id = a.hold_id
    JOIN core.pricing_quote AS pq ON pq.id = a.quote_id
   WHERE a.hold_id = p_hold_id
     AND a.guest_user_id = (SELECT s.user_id FROM core.iam_session_resolve(p_token_hash) AS s)
$fn$;

COMMENT ON FUNCTION core.booking_checkout_quote(bytea, uuid) IS
  'Devis figé du voyageur de la session pour le checkout (période, total, validité, boîte manuelle, '
  'mode de l''annonce, documents à accepter) ; aucune ligne sinon. SECURITY DEFINER, EXECUTE '
  'app_api. US-208 (ADR-133).';
COMMENT ON FUNCTION core.booking_cmd_checkout(bytea, uuid, text, text, boolean, jsonb) IS
  'Checkout en une page (16 BKG-001) : devis figé valide et rejoué, annonce immédiate, conducteur '
  'titulaire, boîte manuelle confirmée, documents acceptés, puis pose du hold CHECKOUT et '
  'rattachement, dans une transaction ; aucun paiement. SECURITY DEFINER, EXECUTE app_api. US-208 '
  '(ADR-133).';
COMMENT ON FUNCTION core.booking_checkout_summary(bytea, uuid) IS
  'Récapitulatif d''un hold de checkout du voyageur de la session : état, échéance, devis engagé, '
  'versions acceptées ; aucune ligne sinon. SECURITY DEFINER, EXECUTE app_api. US-208 (ADR-133).';
REVOKE ALL ON FUNCTION core.booking_checkout_quote(bytea, uuid),
  core.booking_cmd_checkout(bytea, uuid, text, text, boolean, jsonb),
  core.booking_checkout_summary(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_checkout_quote(bytea, uuid),
  core.booking_cmd_checkout(bytea, uuid, text, text, boolean, jsonb),
  core.booking_checkout_summary(bytea, uuid) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
