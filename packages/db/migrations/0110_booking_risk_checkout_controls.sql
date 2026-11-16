-- 0110 — AVL / RISK / KYC : contrôles bloquants du conducteur et revue des réservations signalées.
-- US-209 (partie 209a, back-end) ; 19 US-209 (« âge minimum 25 ans pour une classe et un voyageur
-- de 24 ans ⇒ AGE_CLASS_MISMATCH » ; « entrée le 01/11 et fin le 31/01 en mode FLAG ⇒ revue, jamais
-- un refus ; fin à entrée + 90 j exactement ⇒ aucun signalement » ; « réservation signalée et
-- `flagged_booking_payment_order` = `REVIEW_BEFORE_CHARGE` ⇒ hold `review_required`
-- (`review_hold_minutes`), aucune autorisation avant la décision ; la branche `PAY_THEN_REVIEW` est
-- testée aussi ») ; 16 BKG-012, ADM-029, VER-007 ; 08 BR-BOOK-11, BR-ACC-04, BR-VERIF-02,
-- BR-VERIF-09 ; 17 §2.5 (2 bis : contrôles rejoués à la conversion), §3.2.13 (`risk_rule`,
-- `risk_assessment`), §7.2 ; 22 UXQ-08, UXQ-03, OQ-BR-21 (défauts fail-closed) ; suivis du BOARD
-- N-53, N-95, N-122 ; pré-mortem du lot 2 : L2-PM-21, L2-PM-22 ; ADR-135. Appliquée sous
-- `migrator`, en une transaction.
--
-- Principes (ADR-135, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - éligibilité du conducteur, UNE fonction de KYC : `core.kyc_checkout_driver(personne, début,
--     fin, pays, âge minimum)` (SECURITY DEFINER, kyc_cmd_owner, EXECUTE au seul cmd_hold_owner) :
--     consentement biométrique retiré ou absent ⇒ KYC_BIOMETRIC_CONSENT_MISSING (N-122) ;
--     vérification courante non APPROVED ⇒ KYC_NOT_APPROVED ; permis échu avant la fin du trip ⇒
--     KYC_LICENSE_EXPIRED (règle d'ADR-102) ; âge à la date locale du DÉBUT du trip inférieur à
--     l'âge minimum, ou date de naissance inconnue ⇒ AGE_CLASS_MISMATCH (08 BR-ACC-04, « âge
--     calculé à la date de début du trip ») ; elle rend aussi le signal du permis étranger
--     (VER-007) et l'âge du compte, sans aucune donnée personnelle ;
--   - âge minimum : `min_driver_age` de la classe de valeur du véhicule (portée CATEGORY), au moins
--     la valeur du pays ; valeur du pays absente ⇒ BOOKING_UNAVAILABLE (fail_mode BLOCK) ;
--   - déclaration d'entrée (VER-007, UXQ-03) : `core.kyc_entry_declaration` (ajout seul), écrite
--     par `core.kyc_cmd_declare_entry` (session de la personne ; date future ⇒
--     KYC_ENTRY_DATE_INVALID). Permis délivré hors du pays du trip : sans déclaration ⇒ signal
--     ENTRY_NOT_DECLARED (l'ops contrôle statut et date à la revue, défaut d'UXQ-03) ; résident ⇒
--     RESIDENT_FOREIGN_LICENSE ; date locale de fin > entrée + 90 j ⇒ BEYOND_90_DAYS ; fin à
--     entrée + 90 j exactement : aucun signal (borne incluse). Mode FLAG seul (OQ-BR-21) : jamais un
--     refus automatique ;
--   - règles de risque de la bêta (16 ADM-029), codées ici et DÉCLARÉES dans `core.risk_rule`
--     (version 1) : FOREIGN_LICENSE_90D (HIGH), ACCOUNT_UNDER_24H (LOW, compte de moins de 24 h),
--     SHORT_NOTICE_START (LOW, départ dans moins de 3 h), HIGH_VALUE_CLASS (LOW, classe PREMIUM ou
--     LUXE) ; poids HIGH 100, MEDIUM 50, LOW 25 ; score plafonné à 100 ; réservation SIGNALÉE si le
--     score atteint 50 : une règle HIGH, ou deux règles LOW (ADM-029 : « compte de 2 h qui part dans
--     2 h »). Une règle dont la dernière version est inactive n'est pas évaluée. Jamais plus lourd
--     que Turo : une seule règle LOW ne déclenche aucune revue ;
--   - checkout (`core.booking_cmd_checkout`, corps de 0108 recopié, changements marqués US-209) :
--     éligibilité et règles évaluées avant la pose ; la pose reçoit le signalement (`p_flagged`) ;
--     un conducteur inéligible est refusé APRÈS la pose, dans la même sous-transaction (annulée) :
--     l'auto-réservation reste jugée, refusée et signalée en premier (US-127) ; une règle déclenchée
--     écrit une évaluation `risk_assessment` (sujet HOLD, REVIEW ou AUTO_OK) et, si elle est
--     signalée, un élément de la file RISK_BOOKING (US-109) ;
--   - ordre revue / paiement (UXQ-08, inchangé : 0037) : REVIEW_BEFORE_CHARGE (défaut, valeur
--     absente ou inconnue) ⇒ hold `review_required`, TTL `review_hold_minutes`, aucune intention de
--     paiement avant `reviewed_at` (garde `hold_review_before_payment`) ; PAY_THEN_REVIEW ⇒ hold
--     ordinaire, l'évaluation reste en file (la revue porte sur le trip) ;
--   - mêmes contrôles au paiement et à la conversion (N-53, N-95, L2-PM-21) :
--     `core.booking_guest_eligibility(hold)` relit la restriction du voyageur, le retrait du
--     consentement et, pour un hold posé par le checkout, l'éligibilité du conducteur sur le devis
--     engagé ; `core.booking_cmd_start_payment` (corps de 0045 recopié) refuse avant toute
--     intention de paiement ; `core.booking_conversion_eligibility` (corps de 0080 recopié) rend le
--     code, donc une compensation, jamais un trip ;
--   - aucune constante de pays : pays, fuseau et paramètres lus des tables.
--
-- Issues nouvelles du checkout : KYC_NOT_APPROVED, KYC_BIOMETRIC_CONSENT_MISSING,
--   KYC_LICENSE_EXPIRED, AGE_CLASS_MISMATCH. Déclaration : DONE, AUTH_REQUIRED, COUNTRY_UNKNOWN,
--   REQUEST_INVALID, KYC_ENTRY_DATE_INVALID.
-- Erreurs (SQLSTATE 55000, contrainte) du démarrage du paiement, traduites par
--   packages/db/src/errors.ts : hold_account_restricted, hold_kyc_consent_missing,
--   hold_kyc_not_approved, hold_kyc_license_expired, hold_age_class_mismatch, hold_param_missing.
--
-- Hors de cette partie (209b, passation docs/team/handoffs/US-209.md) : décision de l'ops
--   (REVIEW_FLAGGED_BOOKING : prolongation unique ou RELEASED / REVIEW_REJECTED), annulation
--   PLATFORM_REVIEW_DELAY à T−2 h (US-224, US-215), routes et écrans (S05, O01), mode BLOCK.
--
-- Expand / contract : une table, des fonctions, des règles déclarées, des droits et des politiques
-- AJOUTÉS ; corps de `core.booking_cmd_checkout` (0108), `core.booking_cmd_start_payment` (0045) et
-- `core.booking_conversion_eligibility` (0080) remplacés à signature, propriétaire et droits
-- identiques. Le COMPORTEMENT se resserre, volontairement (16 BKG-012).
--
-- Retour arrière :
--   réappliquer core.booking_cmd_checkout de 0108, core.booking_cmd_start_payment de 0045 et
--     core.booking_conversion_eligibility de 0080 (sous cmd_hold_owner) ;
--   DROP FUNCTION core.booking_guest_eligibility(uuid),
--     core.booking_checkout_record_risk(uuid, uuid, uuid, text, jsonb, integer, boolean),
--     core.booking_checkout_risk(uuid, uuid, timestamptz, timestamptz, text),
--     core.booking_min_driver_age(text, text),
--     core.kyc_checkout_driver(uuid, timestamptz, timestamptz, text, integer),
--     core.kyc_cmd_declare_entry(bytea, text, text, date) ;
--   DROP TABLE core.kyc_entry_declaration ;
--   DELETE FROM core.risk_rule WHERE code IN ('FOREIGN_LICENSE_90D', 'ACCOUNT_UNDER_24H',
--     'SHORT_NOTICE_START', 'HIGH_VALUE_CLASS') (base sans évaluation seulement) ;
--   DROP POLICY cmd_hold_risk_read ON core.config_param_value,
--     cmd_hold_risk_hold_ins ON core.risk_assessment ;
--   révoquer les droits accordés ci-dessous.

-- 1. Déclaration d'entrée du voyageur (16 VER-007 `foreign_entry_declaration` ; UXQ-03) ----------
CREATE TABLE core.kyc_entry_declaration (
  id               uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT kyc_entry_declaration_pkey PRIMARY KEY,
  user_id          uuid        NOT NULL
    CONSTRAINT kyc_entry_declaration_user_fkey REFERENCES core.iam_user_account (id),
  -- pays d'entrée déclaré (pays de la configuration)
  country_code     char(2)     NOT NULL
    CONSTRAINT kyc_entry_declaration_country_fkey REFERENCES core.config_country (code),
  residency_status text        NOT NULL
    CONSTRAINT kyc_entry_declaration_residency_valid CHECK (residency_status IN ('TOURIST', 'RESIDENT')),
  entry_date       date,                                                     -- [C2]
  declared_at      timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT kyc_entry_declaration_tourist_entry CHECK (residency_status = 'RESIDENT'
                                                        OR entry_date IS NOT NULL)
);
CREATE INDEX kyc_entry_declaration_user_idx
  ON core.kyc_entry_declaration (user_id, country_code, declared_at DESC);
COMMENT ON TABLE core.kyc_entry_declaration IS
  'Déclaration d''entrée du voyageur (16 VER-007, UXQ-03) : statut (touriste, résident) et date '
  'd''entrée dans un pays ; la dernière fait foi. Ajout seul, par core.kyc_cmd_declare_entry. '
  'US-209 (ADR-135).';
COMMENT ON COLUMN core.kyc_entry_declaration.entry_date IS
  'Date d''entrée déclarée [C2] ; obligatoire pour un touriste. US-209.';
ALTER TABLE core.kyc_entry_declaration ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.kyc_entry_declaration FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.kyc_entry_declaration TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.kyc_entry_declaration FROM PUBLIC;
GRANT SELECT, INSERT (user_id, country_code, residency_status, entry_date)
  ON core.kyc_entry_declaration TO kyc_cmd_owner;
CREATE POLICY kyc_cmd_select ON core.kyc_entry_declaration FOR SELECT TO kyc_cmd_owner USING (true);
CREATE POLICY kyc_cmd_insert ON core.kyc_entry_declaration FOR INSERT TO kyc_cmd_owner
  WITH CHECK (true);

-- 2. Règles de risque de la bêta, déclarées (17 §3.2.13 ; 16 ADM-029, VER-007) -------------------
INSERT INTO core.risk_rule (code, version, description, severity, active, valid_from)
VALUES
  ('FOREIGN_LICENSE_90D', 1,
   'Permis délivré hors du pays du trip : entrée non déclarée, résident, ou fin du trip après la '
   'date d''entrée + 90 jours (16 VER-007, mode FLAG). Revue, jamais un refus automatique.',
   'HIGH', true, '2026-11-16T00:00:00Z'),
  ('ACCOUNT_UNDER_24H', 1,
   'Compte du voyageur créé moins de 24 heures avant le checkout (16 ADM-029).',
   'LOW', true, '2026-11-16T00:00:00Z'),
  ('SHORT_NOTICE_START', 1,
   'Départ du trip moins de 3 heures après le checkout (16 ADM-029).',
   'LOW', true, '2026-11-16T00:00:00Z'),
  ('HIGH_VALUE_CLASS', 1,
   'Véhicule de classe de valeur PREMIUM ou LUXE (16 ADM-029 « Premium »).',
   'LOW', true, '2026-11-16T00:00:00Z');

-- 3. Droits de kyc_cmd_owner : âge du compte (jamais un nom ni un contact) -----------------------
GRANT SELECT (created_at) ON core.iam_user_account TO kyc_cmd_owner;

-- 4. Commandes et lecture de KYC (SECURITY DEFINER, kyc_cmd_owner) -------------------------------
GRANT CREATE ON SCHEMA core TO kyc_cmd_owner;
SET LOCAL ROLE kyc_cmd_owner;

-- 4.1 Déclaration d'entrée de la personne de la session (16 VER-007 « saisie », UXQ-03). Issues :
-- DONE, AUTH_REQUIRED, COUNTRY_UNKNOWN, REQUEST_INVALID (statut inconnu, touriste sans date),
-- KYC_ENTRY_DATE_INVALID (date future dans le fuseau du pays, ou antérieure à 1900).
CREATE FUNCTION core.kyc_cmd_declare_entry(p_token_hash bytea, p_country text, p_residency text,
                                           p_entry_date date)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  v_tz   text;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text;
    RETURN;
  END IF;
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = p_country;
  IF v_tz IS NULL THEN
    RETURN QUERY SELECT 'COUNTRY_UNKNOWN'::text;
    RETURN;
  END IF;
  IF p_residency IS NULL OR p_residency NOT IN ('TOURIST', 'RESIDENT')
     OR (p_residency = 'TOURIST' AND p_entry_date IS NULL) THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text;
    RETURN;
  END IF;
  IF p_entry_date IS NOT NULL
     AND (p_entry_date > (platform.now() AT TIME ZONE v_tz)::date
          OR p_entry_date < DATE '1900-01-01') THEN
    RETURN QUERY SELECT 'KYC_ENTRY_DATE_INVALID'::text;
    RETURN;
  END IF;
  INSERT INTO core.kyc_entry_declaration (user_id, country_code, residency_status, entry_date)
  VALUES (v_user, p_country, p_residency, p_entry_date);
  RETURN QUERY SELECT 'DONE'::text;
END
$fn$;
COMMENT ON FUNCTION core.kyc_cmd_declare_entry(bytea, text, text, date) IS
  'Commande : déclaration d''entrée (statut, date) de la personne de la session (16 VER-007, '
  'UXQ-03) ; date future ⇒ KYC_ENTRY_DATE_INVALID. SECURITY DEFINER, EXECUTE app_api. US-209.';

-- 4.2 Éligibilité du conducteur à un trip (16 BKG-012, VER-007 ; N-95, N-122). Aucune donnée
-- personnelle rendue : un code, un signal et l'instant de création du compte.
CREATE FUNCTION core.kyc_checkout_driver(p_user uuid, p_start timestamptz, p_end timestamptz,
                                         p_country text, p_min_age integer)
  RETURNS TABLE (outcome text, foreign_signal text, account_created_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_tz      text;
  v_created timestamptz;
  v_birth   date;
  v_subject date;
  v_v       record;
  v_expiry  date;
  v_lic     text;
  v_decl    record;
  v_signal  text;
BEGIN
  SELECT k.time_zone INTO v_tz FROM core.config_country AS k WHERE k.code::text = p_country;
  SELECT u.created_at, u.date_of_birth INTO v_created, v_birth
    FROM core.iam_user_account AS u WHERE u.id = p_user;
  IF v_tz IS NULL OR v_created IS NULL OR p_start IS NULL OR p_end IS NULL OR p_end <= p_start
     OR p_min_age IS NULL OR p_min_age < 0 THEN
    RETURN QUERY SELECT 'BOOKING_UNAVAILABLE'::text, NULL::text, NULL::timestamptz;
    RETURN;
  END IF;
  -- N-122 : consentement biométrique retiré, le code exact (jamais FORBIDDEN)
  IF core.kyc_consent_withdrawn(p_user) THEN
    RETURN QUERY SELECT 'KYC_BIOMETRIC_CONSENT_MISSING'::text, NULL::text, v_created;
    RETURN;
  END IF;
  SELECT v.id, v.status, v.attempt, v.country_code::text AS country INTO v_v
    FROM core.kyc_identity_verification AS v
   WHERE v.user_id = p_user AND v.is_current;
  IF v_v.id IS NULL OR v_v.status <> 'APPROVED' THEN
    RETURN QUERY SELECT 'KYC_NOT_APPROVED'::text, NULL::text, v_created;
    RETURN;
  END IF;
  IF core.kyc_consent_current(p_user, v_v.country) IS NULL THEN
    RETURN QUERY SELECT 'KYC_BIOMETRIC_CONSENT_MISSING'::text, NULL::text, v_created;
    RETURN;
  END IF;
  -- permis accepté de la tentative courante, valable jusqu'à la fin du trip (règle d'ADR-102)
  SELECT d.expiry_date, d.issuing_country::text INTO v_expiry, v_lic
    FROM core.kyc_identity_document AS d
   WHERE d.verification_id = v_v.id AND d.attempt = v_v.attempt AND d.status = 'ACCEPTED'
     AND d.doc_type = 'DRIVER_LICENSE'
   ORDER BY d.created_at DESC LIMIT 1;
  IF v_expiry IS NULL OR p_end >= ((v_expiry + 1)::timestamp AT TIME ZONE v_tz) THEN
    RETURN QUERY SELECT 'KYC_LICENSE_EXPIRED'::text, NULL::text, v_created;
    RETURN;
  END IF;
  -- âge à la date locale du début du trip (08 BR-ACC-04) ; la date VÉRIFIÉE du dossier courant
  -- fait foi, à défaut la date déclarée du compte ; inconnue : jamais « assez âgé »
  SELECT s.date_of_birth INTO v_subject
    FROM core.kyc_identity_subject AS s
   WHERE s.verification_id = v_v.id AND s.attempt = v_v.attempt;
  v_birth := COALESCE(v_subject, v_birth);
  IF v_birth IS NULL
     OR (v_birth + pg_catalog.make_interval(years => p_min_age))::date
        > (p_start AT TIME ZONE v_tz)::date THEN
    RETURN QUERY SELECT 'AGE_CLASS_MISMATCH'::text, NULL::text, v_created;
    RETURN;
  END IF;
  -- permis étranger (16 VER-007, mode FLAG) : signal seulement, jamais un refus
  IF v_lic IS DISTINCT FROM p_country THEN
    SELECT e.residency_status, e.entry_date INTO v_decl
      FROM core.kyc_entry_declaration AS e
     WHERE e.user_id = p_user AND e.country_code::text = p_country
     ORDER BY e.declared_at DESC, e.id DESC
     LIMIT 1;
    v_signal := CASE
      WHEN v_decl.residency_status IS NULL THEN 'ENTRY_NOT_DECLARED'
      WHEN v_decl.residency_status = 'RESIDENT' THEN 'RESIDENT_FOREIGN_LICENSE'
      WHEN (p_end AT TIME ZONE v_tz)::date > v_decl.entry_date + 90 THEN 'BEYOND_90_DAYS'
    END;
  END IF;
  RETURN QUERY SELECT 'ELIGIBLE'::text, v_signal, v_created;
END
$fn$;
COMMENT ON FUNCTION core.kyc_checkout_driver(uuid, timestamptz, timestamptz, text, integer) IS
  'Éligibilité du conducteur à un trip (16 BKG-012, VER-007) : consentement, vérification '
  'approuvée, permis valable jusqu''à la fin, âge minimum au début ; signal du permis étranger. '
  'SECURITY DEFINER, EXECUTE cmd_hold_owner. US-209 (ADR-135).';

REVOKE ALL ON FUNCTION core.kyc_cmd_declare_entry(bytea, text, text, date),
  core.kyc_checkout_driver(uuid, timestamptz, timestamptz, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.kyc_cmd_declare_entry(bytea, text, text, date) TO app_api;
GRANT EXECUTE ON FUNCTION core.kyc_checkout_driver(uuid, timestamptz, timestamptz, text, integer)
  TO cmd_hold_owner;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM kyc_cmd_owner;

-- 5. Droits de cmd_hold_owner (au plus juste) ----------------------------------------------------
-- âge minimum de la classe (portée CATEGORY : scope_id déjà accordé par 0071) ; politique ajoutée
-- à côté de cmd_hold_read (permissives : OU), sans recopier sa liste
CREATE POLICY cmd_hold_risk_read ON core.config_param_value FOR SELECT TO cmd_hold_owner
  USING (key = 'min_driver_age');
-- poids des règles déclarées
GRANT SELECT (severity) ON core.risk_rule TO cmd_hold_owner;
-- évaluation d'un hold de checkout (sujet HOLD) : jamais décidée à l'écriture
CREATE POLICY cmd_hold_risk_hold_ins ON core.risk_assessment FOR INSERT TO cmd_hold_owner
  WITH CHECK (subject_type = 'HOLD' AND decision IN ('REVIEW', 'AUTO_OK') AND reviewed_by IS NULL
              AND decided_at IS NULL
              AND explanation IN ('CHECKOUT_RISK_REVIEW', 'CHECKOUT_RISK_AUTO_OK'));

-- 6. Sous cmd_hold_owner : aides, checkout, démarrage du paiement et conversion -------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 6.1 Âge minimum du conducteur pour une classe de valeur : valeur de la classe (CATEGORY), au moins
-- celle du pays ; valeur du pays absente ou mal formée ⇒ NULL (l'appelant refuse).
CREATE FUNCTION core.booking_min_driver_age(p_country text, p_class text)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now     timestamptz := platform.now();
  v_country integer := core.booking_param_int('min_driver_age', p_country);
  v_class   integer;
BEGIN
  IF v_country IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_class IS NOT NULL THEN
    SELECT (pv.value #>> '{}')::integer INTO v_class
      FROM core.config_param_value AS pv
     WHERE pv.key = 'min_driver_age' AND pv.country_code::text = p_country
       AND pv.scope_type = 'CATEGORY' AND pv.scope_id = p_class AND pv.valid_from <= v_now
       AND (pv.valid_to IS NULL OR pv.valid_to > v_now)
       AND pg_catalog.jsonb_typeof(pv.value) = 'number' AND (pv.value #>> '{}') ~ '^[0-9]{1,3}$'
     ORDER BY pv.valid_from DESC
     LIMIT 1;
  END IF;
  RETURN GREATEST(v_country, COALESCE(v_class, 0));
END
$fn$;
COMMENT ON FUNCTION core.booking_min_driver_age(text, text) IS
  'Âge minimum du conducteur (16 BKG-012, ADM-031) : min_driver_age de la classe, au moins celui '
  'du pays ; NULL si le pays n''a pas de valeur. US-209.';

-- 6.2 Contrôles du conducteur et règles de risque d'un trip (16 BKG-012, ADM-029, VER-007) :
-- issue de KYC (ELIGIBLE ou un code), réservation signalée, règles déclenchées et score.
CREATE FUNCTION core.booking_checkout_risk(p_guest uuid, p_vehicle uuid, p_start timestamptz,
                                           p_end timestamptz, p_country text)
  RETURNS TABLE (outcome text, flagged boolean, rules jsonb, score integer)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_now    timestamptz := platform.now();
  v_class  text;
  v_min    integer;
  d        record;
  r        record;
  v_signal text;
  v_rules  jsonb := '[]'::jsonb;
  v_score  integer := 0;
BEGIN
  SELECT cv.value_class INTO v_class FROM core.catalog_vehicle AS cv WHERE cv.id = p_vehicle;
  v_min := core.booking_min_driver_age(p_country, v_class);
  IF v_min IS NULL THEN
    RETURN QUERY SELECT 'BOOKING_UNAVAILABLE'::text, false, '[]'::jsonb, 0;
    RETURN;
  END IF;
  SELECT * INTO d FROM core.kyc_checkout_driver(p_guest, p_start, p_end, p_country, v_min);
  -- dernière version en vigueur de chaque règle de la bêta ; inactive : non évaluée
  FOR r IN
    SELECT DISTINCT ON (ru.code) ru.code, ru.version, ru.severity, ru.active
      FROM core.risk_rule AS ru
     WHERE ru.code IN ('FOREIGN_LICENSE_90D', 'ACCOUNT_UNDER_24H', 'SHORT_NOTICE_START',
                       'HIGH_VALUE_CLASS')
       AND ru.valid_from <= v_now
     ORDER BY ru.code, ru.version DESC
  LOOP
    CONTINUE WHEN NOT r.active;
    v_signal := CASE r.code
      WHEN 'FOREIGN_LICENSE_90D' THEN d.foreign_signal
      WHEN 'ACCOUNT_UNDER_24H' THEN
        CASE WHEN d.account_created_at > v_now - pg_catalog.make_interval(hours => 24)
             THEN 'ACCOUNT_AGE' END
      WHEN 'SHORT_NOTICE_START' THEN
        CASE WHEN p_start < v_now + pg_catalog.make_interval(hours => 3) THEN 'START_SOON' END
      WHEN 'HIGH_VALUE_CLASS' THEN
        CASE WHEN v_class IN ('PREMIUM', 'LUXE') THEN v_class END
    END;
    IF v_signal IS NOT NULL THEN
      v_rules := v_rules || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'code', r.code, 'version', r.version, 'signal', v_signal));
      v_score := v_score + CASE r.severity WHEN 'HIGH' THEN 100 WHEN 'MEDIUM' THEN 50 ELSE 25 END;
    END IF;
  END LOOP;
  v_score := LEAST(v_score, 100);
  RETURN QUERY SELECT COALESCE(d.outcome, 'BOOKING_UNAVAILABLE'), v_score >= 50, v_rules, v_score;
END
$fn$;
COMMENT ON FUNCTION core.booking_checkout_risk(uuid, uuid, timestamptz, timestamptz, text) IS
  'Contrôles du conducteur (KYC) et règles de risque déclarées d''un trip (16 BKG-012, ADM-029, '
  'VER-007) : issue, signalement (score ≥ 50), règles et score. US-209 (ADR-135).';

-- 6.3 Journal explicable (BR-TRUST-01) : évaluation du hold si une règle est déclenchée ; file
-- RISK_BOOKING du pays si la réservation est signalée (une mise en file impossible n'annule rien :
-- l'évaluation reste ouverte et visible, comme 0080).
CREATE FUNCTION core.booking_checkout_record_risk(p_hold uuid, p_guest uuid, p_org uuid,
                                                  p_country text, p_rules jsonb, p_score integer,
                                                  p_flagged boolean)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_id    uuid := pg_catalog.gen_random_uuid();
  r_queue record;
BEGIN
  IF p_rules IS NULL OR pg_catalog.jsonb_typeof(p_rules) <> 'array'
     OR pg_catalog.jsonb_array_length(p_rules) = 0 THEN
    RETURN;
  END IF;
  INSERT INTO core.risk_assessment
         (id, subject_type, subject_id, country_code, org_id, rules_fired, score, decision,
          dedupe_key, explanation)
  VALUES (v_id, 'HOLD', p_hold, p_country, p_org, p_rules, p_score,
          CASE WHEN p_flagged THEN 'REVIEW' ELSE 'AUTO_OK' END,
          'CHECKOUT_RISK:' || p_hold::text,
          CASE WHEN p_flagged THEN 'CHECKOUT_RISK_REVIEW' ELSE 'CHECKOUT_RISK_AUTO_OK' END);
  IF p_flagged THEN
    SELECT * INTO r_queue
      FROM core.support_enqueue_review('RISK_BOOKING', 'RISK_ASSESSMENT', v_id, p_country, NULL);
  END IF;
END
$fn$;
COMMENT ON FUNCTION core.booking_checkout_record_risk(uuid, uuid, uuid, text, jsonb, integer, boolean) IS
  'Évaluation de risque d''un hold de checkout (sujet HOLD, REVIEW ou AUTO_OK) et file RISK_BOOKING '
  'si la réservation est signalée (16 ADM-029). US-209 (ADR-135).';

-- 6.4 Contrôles bloquants du voyageur relus au paiement et à la conversion (N-53, N-95, N-122,
-- L2-PM-21) : ELIGIBLE ou un code. Hold posé par le checkout : éligibilité du conducteur sur la
-- période du devis engagé.
CREATE FUNCTION core.booking_guest_eligibility(p_hold_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid;
  v_vehicle uuid;
  v_country text;
  v_period  tstzrange;
  v_outcome text;
BEGIN
  SELECT ch.guest_user_id, ch.vehicle_id, ch.country_code INTO v_guest, v_vehicle, v_country
    FROM core.booking_checkout_hold AS ch WHERE ch.id = p_hold_id;
  IF v_guest IS NULL THEN
    RETURN 'UNKNOWN_HOLD';
  END IF;
  IF EXISTS (SELECT 1 FROM core.iam_restriction AS r WHERE r.user_id = v_guest AND r.active) THEN
    RETURN 'ACCOUNT_RESTRICTED';
  END IF;
  IF core.kyc_consent_withdrawn(v_guest) THEN
    RETURN 'KYC_BIOMETRIC_CONSENT_MISSING';
  END IF;
  SELECT q.period INTO v_period
    FROM core.booking_checkout_acceptance AS a
    JOIN core.pricing_quote AS q ON q.id = a.quote_id
   WHERE a.hold_id = p_hold_id;
  IF v_period IS NOT NULL THEN
    SELECT x.outcome INTO v_outcome
      FROM core.booking_checkout_risk(v_guest, v_vehicle, pg_catalog.lower(v_period),
                                      pg_catalog.upper(v_period), v_country) AS x;
    IF v_outcome IS DISTINCT FROM 'ELIGIBLE' THEN
      RETURN COALESCE(v_outcome, 'BOOKING_UNAVAILABLE');
    END IF;
  END IF;
  RETURN 'ELIGIBLE';
END
$fn$;
COMMENT ON FUNCTION core.booking_guest_eligibility(uuid) IS
  'Contrôles bloquants du voyageur d''un hold, relus au paiement et à la conversion (N-53, N-95, '
  'N-122) : restriction, consentement retiré, éligibilité du conducteur sur le devis engagé. '
  'US-209 (ADR-135).';

REVOKE ALL ON FUNCTION core.booking_min_driver_age(text, text),
  core.booking_checkout_risk(uuid, uuid, timestamptz, timestamptz, text),
  core.booking_checkout_record_risk(uuid, uuid, uuid, text, jsonb, integer, boolean),
  core.booking_guest_eligibility(uuid) FROM PUBLIC;

-- 6.5 Checkout : corps de 0108 recopié, changements marqués US-209 (étapes 3 bis, 4 et 6)
CREATE OR REPLACE FUNCTION core.booking_cmd_checkout(p_token_hash bytea, p_quote_id uuid, p_driver_first text,
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
  v_risk       record;  -- US-209
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

  -- 3 bis. US-209 (16 BKG-012, ADM-029, VER-007 ; ADR-135) : conducteur et règles de risque
  -- jugés AVANT la pose ; un conducteur inéligible est refusé APRÈS la pose, dans la
  -- sous-transaction : l'auto-réservation reste jugée et signalée en premier (US-127)
  SELECT * INTO v_risk
    FROM core.booking_checkout_risk(v_user, v_vehicle, pg_catalog.lower(q.period),
                                    pg_catalog.upper(q.period), v_country);

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
    -- US-209 : réservation signalée (ADM-029) ⇒ hold de revue selon flagged_booking_payment_order
    v_hold := core.booking_cmd_place_hold(v_vehicle, pg_catalog.lower(q.period),
                                          pg_catalog.upper(q.period), v_risk.flagged);
    -- US-209 : conducteur inéligible ⇒ refus, la pose et les consentements sont annulés
    IF v_risk.outcome IS DISTINCT FROM 'ELIGIBLE' THEN
      RAISE EXCEPTION 'checkout: driver not eligible'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'checkout_driver_ineligible';
    END IF;
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
        -- US-209 : KYC_NOT_APPROVED, KYC_BIOMETRIC_CONSENT_MISSING, KYC_LICENSE_EXPIRED,
        -- AGE_CLASS_MISMATCH ou BOOKING_UNAVAILABLE (paramètre absent)
        WHEN 'checkout_driver_ineligible' THEN COALESCE(v_risk.outcome, 'BOOKING_UNAVAILABLE')
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
  -- 6. US-209 : journal explicable (BR-TRUST-01) et file RISK_BOOKING si signalée (ADM-029)
  PERFORM core.booking_checkout_record_risk(v_hold, v_user, v_org, v_country, v_risk.rules,
                                            v_risk.score, v_risk.flagged);
  RETURN QUERY SELECT 'DONE'::text, v_hold, v_exp;
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_checkout(bytea, uuid, text, text, boolean, jsonb) IS
  'Checkout en une page (16 BKG-001) : devis figé valide et rejoué, annonce immédiate, conducteur '
  'titulaire et éligible (BKG-012), boîte manuelle confirmée, documents acceptés, puis pose du '
  'hold CHECKOUT (signalé : revue, ADM-029) et rattachement, dans une transaction ; aucun '
  'paiement. SECURITY DEFINER, EXECUTE app_api. US-208 (ADR-133), US-209 (ADR-135).';

-- 6.6 Éligibilité à la conversion : corps de 0080 recopié, contrôles du voyageur ajoutés en tête
CREATE OR REPLACE FUNCTION core.booking_conversion_eligibility(p_hold_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid;
  v_vehicle uuid;
  v_org     uuid;
  v_country text;
  v_holder  uuid;
  v_status  text;
  r_party   record;
  v_code    text;  -- US-209
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('booking_conversion', 'disposition_sweeper',
                                  'payment_intent_sweeper') THEN
    RAISE EXCEPTION 'conversion: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'conversion_forbidden';
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id, ch.org_id, ch.country_code
    INTO v_guest, v_vehicle, v_org, v_country
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id;
  IF v_guest IS NULL THEN
    RETURN 'UNKNOWN_HOLD';
  END IF;
  -- US-209 (N-53, N-95, N-122 ; L2-PM-21) : contrôles bloquants du voyageur rejoués (17 §2.5,
  -- 2 bis : « guest toujours éligible ») ; un refus est une compensation, jamais un trip
  v_code := core.booking_guest_eligibility(p_hold_id);
  IF v_code IS DISTINCT FROM 'ELIGIBLE' THEN
    RETURN COALESCE(v_code, 'BOOKING_UNAVAILABLE');
  END IF;
  SELECT p.org_id, p.country_code INTO r_party FROM core.booking_vehicle_party(v_vehicle) AS p;
  IF r_party.org_id IS DISTINCT FROM v_org OR r_party.country_code IS DISTINCT FROM v_country THEN
    RETURN 'VEHICLE_NOT_LISTED';
  END IF;
  SELECT o.holder_user_id, o.status INTO v_holder, v_status
    FROM core.iam_organization o
   WHERE o.id = v_org AND o.country_code = v_country;
  IF v_status IS DISTINCT FROM 'ACTIVE' THEN
    RETURN 'HOST_NOT_ACTIVE';
  END IF;
  -- US-127 (ADR-110) : titulaire, membre d'un compte du titulaire ou compte lié
  IF v_holder = v_guest OR core.risk_self_booking_signal(v_guest, v_org) IS NOT NULL THEN
    RETURN 'SELF_BOOKING';
  END IF;
  RETURN 'ELIGIBLE';
END
$fn$;
COMMENT ON FUNCTION core.booking_conversion_eligibility(uuid) IS
  'Éligibilité à la conversion (17 §2.5, 2 bis (ii) / (iii)) : ELIGIBLE ou un code de refus ; '
  'contrôles bloquants du voyageur rejoués, puis SELF_BOOKING (titulaire, membre, compte lié) '
  '(restriction, consentement, conducteur). Travailleurs de conversion seulement. US-024, US-127, '
  'US-209.';

-- 6.7 Démarrage du paiement : corps de 0045 recopié, contrôles du voyageur ajoutés après la garde
-- de revue (UXQ-08)
CREATE OR REPLACE FUNCTION core.booking_cmd_start_payment(p_hold_id uuid, p_psp_account_id uuid, p_method text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_env         text;
  v_guest       uuid := app.actor_id();
  v_owner       uuid;
  v_vehicle     uuid;
  v_country     text;
  v_status      text;
  v_now         timestamptz;
  v_margin      integer;
  v_timeout     integer;
  v_max_total   integer;
  v_tolerance   integer;
  v_max_tries   integer;
  v_order_ttl   integer;
  v_base        timestamptz;
  v_bound       timestamptz;
  v_attempt     integer;
  v_key         text;
  v_op          uuid := pg_catalog.gen_random_uuid();
  v_keys        text[];
  v_leg         text;
  v_outcome     text;
  n             integer;
  r_hold        record;
  r_op          record;
  r_terms       record;
  r_account     record;
  v_elig        text;  -- US-209
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL OR p_hold_id IS NULL THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  SELECT ch.guest_user_id, ch.vehicle_id, ch.country_code INTO v_owner, v_vehicle, v_country
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id;
  IF v_owner IS DISTINCT FROM v_guest THEN
    RAISE EXCEPTION 'payment: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('CARD', 'YAPPY', 'CLAVE', 'QR', 'PIX', 'BANK_TRANSFER') THEN
    RAISE EXCEPTION 'payment: method unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_method_unavailable';
  END IF;

  -- verrous voyageur → véhicule → hold (17 §2.5, ordre global M2)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || v_vehicle::text, 0));
  -- FOR UPDATE applique la politique UPDATE (cmd_hold_upd) : seul un hold vivant est verrouillé
  SELECT ch.status, ch.expires_at, ch.payment_in_flight_until, ch.payment_attempts,
         ch.review_required, ch.reviewed_at, ch.created_at, ch.org_id
    INTO r_hold
    FROM core.booking_checkout_hold ch
   WHERE ch.id = p_hold_id
     FOR UPDATE;
  IF NOT FOUND THEN
    SELECT ch.status INTO v_status FROM core.booking_checkout_hold ch WHERE ch.id = p_hold_id;
    IF v_status = 'CONVERTED' THEN
      RAISE EXCEPTION 'payment: hold already converted'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_payment_terminal';
    END IF;
    RAISE EXCEPTION 'payment: hold not payable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_not_payable';
  END IF;
  v_now := platform.now();

  -- Paiement déjà en vol : jamais un second ordre sans lecture (VERIF_17-B1)
  IF r_hold.status = 'PAYMENT_IN_FLIGHT' THEN
    SELECT o.id, o.idem_sent, o.provider_reference, o.status, o.provider, o.method,
           o.amount_minor, o.currency, o.attempt_no
      INTO r_op
      FROM core.payment_payment_operation o
     WHERE o.hold_id = p_hold_id AND o.purpose = 'RENT' AND o.kind = 'CAPTURE'
     ORDER BY o.attempt_no DESC, o.created_at DESC
     LIMIT 1;
    IF r_op.id IS NULL THEN
      v_outcome := 'VERIFYING';
    ELSIF r_op.provider_reference IS NOT NULL AND r_op.status IN ('PENDING', 'SUBMITTED')
          AND v_now < r_hold.payment_in_flight_until THEN
      v_outcome := 'EXISTING_ORDER';
    ELSIF r_op.provider_reference IS NULL AND r_op.status IN ('PENDING', 'UNKNOWN')
          AND v_now < r_hold.payment_in_flight_until
          AND core.payment_capability_bool(r_op.provider, v_country, r_op.method,
                                           'SUPPORTS_LOOKUP_BY_MERCHANT_REF') THEN
      v_outcome := 'RETRY_SAME_KEY';
    ELSE
      v_outcome := 'VERIFYING';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'outcome', v_outcome,
      'operationId', r_op.id,
      'idemSent', CASE WHEN v_outcome <> 'VERIFYING' THEN r_op.idem_sent END,
      'providerReference', CASE WHEN v_outcome = 'EXISTING_ORDER' THEN r_op.provider_reference END,
      'amountMinor', r_op.amount_minor::text,
      'currency', r_op.currency,
      'attemptNo', r_op.attempt_no,
      'legs', (SELECT pg_catalog.jsonb_object_agg(l.leg, l.amount_minor::text)
                 FROM core.payment_payment_operation_leg l WHERE l.operation_id = r_op.id),
      'paymentInFlightUntil', r_hold.payment_in_flight_until);
  END IF;

  -- hold ACTIVE : aucune intention de paiement avant reviewed_at (UXQ-08)
  IF r_hold.review_required AND r_hold.reviewed_at IS NULL THEN
    RAISE EXCEPTION 'payment: booking under review'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'hold_review_before_payment';
  END IF;
  -- US-209 (N-53, N-95, N-122 ; L2-PM-21) : contrôles bloquants du voyageur relus avant toute
  -- intention de paiement (restriction, consentement, éligibilité du conducteur)
  v_elig := core.booking_guest_eligibility(p_hold_id);
  IF v_elig IS DISTINCT FROM 'ELIGIBLE' THEN
    RAISE EXCEPTION 'payment: guest not eligible'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = CASE v_elig
                           WHEN 'ACCOUNT_RESTRICTED' THEN 'hold_account_restricted'
                           WHEN 'KYC_BIOMETRIC_CONSENT_MISSING' THEN 'hold_kyc_consent_missing'
                           WHEN 'KYC_NOT_APPROVED' THEN 'hold_kyc_not_approved'
                           WHEN 'KYC_LICENSE_EXPIRED' THEN 'hold_kyc_license_expired'
                           WHEN 'AGE_CLASS_MISMATCH' THEN 'hold_age_class_mismatch'
                           ELSE 'hold_param_missing'
                         END;
  END IF;
  SELECT t.amount_minor, t.currency, t.legs, t.scheduled_start
    INTO r_terms
    FROM core.booking_hold_payment_terms(p_hold_id) AS t;
  IF r_terms.amount_minor IS NULL OR r_terms.amount_minor <= 0 OR r_terms.currency IS NULL
     OR r_terms.legs IS NULL OR pg_catalog.jsonb_typeof(r_terms.legs) <> 'object'
     OR r_terms.scheduled_start IS NULL THEN
    RAISE EXCEPTION 'payment: quote unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_quote_unavailable';
  END IF;
  SELECT pg_catalog.array_agg(k ORDER BY k) INTO v_keys
    FROM pg_catalog.jsonb_object_keys(r_terms.legs) AS k;
  IF v_keys IS DISTINCT FROM ARRAY['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'] THEN
    RAISE EXCEPTION 'payment: quote unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_quote_unavailable';
  END IF;
  FOREACH v_leg IN ARRAY v_keys LOOP
    IF pg_catalog.jsonb_typeof(r_terms.legs -> v_leg) <> 'string'
       OR (r_terms.legs ->> v_leg) !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'payment: quote unavailable'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_quote_unavailable';
    END IF;
  END LOOP;

  v_margin    := core.booking_param_int('payment_in_flight_margin_s', v_country);
  v_timeout   := core.booking_param_int('psp_call_timeout_s', v_country);
  v_max_total := core.booking_param_int('hold_max_total_minutes', v_country);
  v_tolerance := core.booking_param_int('conversion_start_tolerance_minutes', v_country);
  v_max_tries := core.booking_param_int('payment_attempts_per_hold', v_country);
  IF v_margin IS NULL OR v_timeout IS NULL OR v_max_total IS NULL OR v_tolerance IS NULL
     OR v_max_tries IS NULL THEN
    RAISE EXCEPTION 'payment: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  -- un trip n'est jamais créé après son début prévu (2 bis (i)) : on ne débite pas pour rien
  IF r_terms.scheduled_start < v_now - pg_catalog.make_interval(mins => v_tolerance) THEN
    RAISE EXCEPTION 'payment: start passed'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_start_passed';
  END IF;
  IF r_hold.payment_attempts >= v_max_tries THEN
    RAISE EXCEPTION 'payment: attempts exhausted'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'payment_attempts_exceeded';
  END IF;

  -- compte marchand de Kmino du pays, ACTIVE, jamais un FAKE en production (17 §4.3 point 5.7)
  SELECT a.provider, a.country_code, a.status, a.collection_mode, a.environment INTO r_account
    FROM core.payment_psp_account a WHERE a.id = p_psp_account_id;
  IF r_account.provider IS NULL OR r_account.status <> 'ACTIVE' OR r_account.country_code <> v_country THEN
    RAISE EXCEPTION 'payment: PSP account not active'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_account_active';
  END IF;
  -- environnement de la base lu UNE fois ; NULL vaut « production » (fail-closed, revue sécurité
  -- US-024, report vers US-025) : ni la garde FAKE ni la garde SANDBOX ne s'ouvrent sur un NULL
  v_env := COALESCE(platform.deployment_env(), 'production');
  IF r_account.provider = 'FAKE' AND v_env = 'production' THEN
    RAISE EXCEPTION 'payment: FAKE provider forbidden in production (C19)'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'psp_account_fake_forbidden';
  END IF;
  -- compte de bac à sable seulement dans un environnement non productif connu (revue sécurité US-024,
  -- majeur 1) : environnement de la BASE (platform.deployment_env(), 17 §6.5 point 1 ; production
  -- par défaut) ; toute autre valeur, production comprise, exige un compte LIVE (fail-closed)
  IF r_account.environment IS DISTINCT FROM 'LIVE'
     AND v_env NOT IN ('test', 'development', 'staging') THEN
    RAISE EXCEPTION 'payment: sandbox PSP account outside a test environment'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_account_active';
  END IF;

  -- capacités bloquantes du PSP du pays (17 §2.8 ; report d'US-061, ADR-066) : une seule manque ⇒
  -- aucun paiement (fail-closed), le même refus que l'activation d'un hôte
  IF pg_catalog.cardinality(core.payment_missing_blocking_capabilities(
       r_account.provider, v_country, r_account.collection_mode)) > 0 THEN
    RAISE EXCEPTION 'payment: blocking PSP capability missing'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'host_payout_rail_unavailable';
  END IF;

  -- borne provisoire (17 §2.5 étape 3a)
  v_order_ttl := core.payment_capability_int(r_account.provider, v_country, p_method,
                                             'ORDER_TTL_SECONDS');
  v_base := CASE WHEN r_hold.review_required THEN r_hold.reviewed_at ELSE r_hold.created_at END
            + pg_catalog.make_interval(mins => v_max_total);
  IF v_order_ttl > 0 THEN
    v_bound := LEAST(v_now + pg_catalog.make_interval(secs => v_timeout + v_order_ttl + v_margin),
                     v_base);
  ELSE
    v_bound := v_base;
  END IF;

  UPDATE core.booking_checkout_hold
     SET status = 'PAYMENT_IN_FLIGHT', payment_in_flight_until = v_bound, updated_by = v_guest
   WHERE id = p_hold_id AND status = 'ACTIVE' AND expires_at > v_now;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'payment: hold not payable'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_not_payable';
  END IF;

  v_attempt := r_hold.payment_attempts + 1;
  v_key := pg_catalog.format('hold:%s:CAPTURE:a%s', p_hold_id, v_attempt);
  -- capture AUTO : opération CAPTURE, jambes de capture du devis (08 E7 règle 2)
  INSERT INTO core.payment_payment_operation
         (id, hold_id, psp_account_id, country_code, provider, method, kind, purpose, amount_minor,
          currency, attempt_no, status, idem_plain, idem_sent)
  VALUES (v_op, p_hold_id, p_psp_account_id, v_country, r_account.provider, p_method, 'CAPTURE',
          'RENT', r_terms.amount_minor, r_terms.currency, v_attempt, 'PENDING', v_key, v_key);
  INSERT INTO core.payment_payment_operation_leg
         (operation_id, leg, org_id, trip_id, country_code, amount_minor)
  SELECT v_op, k, r_hold.org_id, NULL, v_country, (r_terms.legs ->> k)::bigint
    FROM pg_catalog.unnest(v_keys) AS k;

  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.hold.payment_in_flight', 1, 'checkout_hold', p_hold_id, 1, v_country, v_guest,
          'GUEST', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', p_hold_id, 'operation_id', v_op,
                                        'attempt_no', v_attempt,
                                        'payment_in_flight_until', v_bound),
          p_hold_id::text);

  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'NEW_ORDER',
    'operationId', v_op,
    'idemSent', v_key,
    'providerReference', NULL,
    'amountMinor', r_terms.amount_minor::text,
    'currency', r_terms.currency,
    'attemptNo', v_attempt,
    'legs', r_terms.legs,
    'paymentInFlightUntil', v_bound);
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_start_payment(uuid, uuid, text) IS
  'Commande : intention de paiement T1 (17 §2.5 étape 3a), voyageur de la session ; aucune avant la '
  'revue (UXQ-08) ni pour un voyageur devenu inéligible (US-209) ; environnement NULL = production '
  '(fail-closed). US-024, US-025, US-209.';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
