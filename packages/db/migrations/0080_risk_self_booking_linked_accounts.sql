-- 0080 — RISK / AVL : cumul hôte / voyageur, auto-réservation refusée y compris par un compte lié.
-- US-127 ; 19 US-127 (« Given un hôte qui cherche son propre véhicule, When il pose un hold, Then
-- refus (`self_booking_forbidden` = `true`) sans révéler d'information sur l'occupation » ; « Given
-- un compte voyageur lié à l'hôte (même appareil, même carte ou même numéro de permis), When il pose
-- un hold sur un véhicule de cet hôte, Then refus comme une auto-réservation et signalement à l'ops
-- (`risk_assessment`) » ; « aucune compensation [dette du voyageur / gains d'hôte] sans accord
-- écrit ») ; 16 ACC-014 (« À la pose du hold : le `org_id` du véhicule est comparé aux comptes
-- d'hôte du guest et des comptes liés → refus si identique » ; Bêta pilote : « comptes liés
-- (carte, appareil) repérés par l'ops à la revue KYC »), BKG-012, BKG-014 ; 08 BR-TRUST-05 ;
-- 17 §2.3 (`self_booking_forbidden`, permission `booking.create` qui exclut toujours son propre
-- véhicule), §2.5 (2 bis : éligibilité à la conversion), §3.2.13 (`risk_rule`, `risk_assessment`),
-- §7.2 ; 22 OQ-P2P-09 (défaut PROPOSÉ, fail-closed) ; ADR-060, ADR-065, ADR-089 (F-RLS-02),
-- ADR-097 (files), ADR-110 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-110, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - UNE fonction juge le lien entre un voyageur et un compte d'hôte :
--     `core.risk_self_booking_signal(voyageur, compte)` (SECURITY DEFINER, risk_limit_owner,
--     EXECUTE au seul cmd_hold_owner : jamais app_api, pour qu'aucun client ne s'en serve comme
--     oracle « ce compte est-il à la même personne ? »). Personnes du côté hôte : le titulaire du
--     compte du véhicule et les membres (ACTIVE ou INVITED, co-hôtes compris) de TOUS les comptes
--     d'hôte de ce titulaire, quel que soit le pays (son compte de l'autre pays compris). Signal :
--       DIRECT          le voyageur est l'une de ces personnes ;
--       <signal ops>    l'ops a constaté un lien (LINKED) entre le voyageur et l'une d'elles :
--                       SAME_CARD, SAME_DEVICE, SAME_DRIVER_LICENSE, SAME_IDENTITY, SAME_PHONE,
--                       OTHER (`core.risk_account_link`) ;
--       SAME_IDENTITY   les deux comptes ont une identité vérifiée (vérification approuvée au
--                       moins une fois) avec les mêmes nom et prénom légaux normalisés (casse,
--                       accents, espaces et ponctuation ignorés) et la même date de naissance
--                       rendue par le fournisseur ;
--       SAME_PHONE      même numéro E.164, vérifié sur l'un des deux comptes au moins ;
--     NULL sinon. Un constat NOT_LINKED de l'ops pour une paire (homonyme, numéro recyclé) écarte
--     les signaux AUTOMATIQUES de cette paire, jamais DIRECT ni un autre constat LINKED ;
--   - pose d'un hold (`core.booking_cmd_place_hold`, corps de 0071 recopié à l'identique hors
--     cette garde) : tout signal ⇒ `hold_self_booking` (SELF_BOOKING_FORBIDDEN), le MÊME refus
--     pour le titulaire, un membre et un compte lié, levé AVANT les verrous, l'expiration ciblée
--     et l'occupation : le refus ne dit rien de l'occupation ni du lien trouvé ;
--   - conversion (`core.booking_conversion_eligibility`, 0041) : même jugement (rendu
--     SELF_BOOKING) ⇒ compensation, jamais de trip. Un lien constaté, une appartenance ou une
--     identité vérifiée APRÈS la pose ferme donc la conversion (course pose / constat) ;
--   - signalement à l'ops (critère 2) : un refus est une exception qui annule la transaction de
--     la pose ; le signalement est donc une commande distincte,
--     `core.booking_cmd_report_self_booking(véhicule)` (cmd_hold_owner, EXECUTE app_api, acteur
--     GUEST), que l'API appelle dans une NOUVELLE transaction après un SELF_BOOKING_FORBIDDEN.
--     Elle rejuge le lien : pour un compte LIÉ (pas DIRECT : un hôte qui ouvre sa propre annonce
--     n'est pas un soupçon), elle écrit une évaluation `risk_assessment` (sujet USER = voyageur,
--     décision REVIEW, règle déclarée `SELF_BOOKING_LINKED_ACCOUNT` v1, signal, compte d'hôte) et
--     met l'évaluation dans la file RISK_BOOKING (US-109) du pays du véhicule ; une évaluation
--     ouverte par (voyageur, compte d'hôte) au plus (verrou consultatif + index unique partiel).
--     Elle ne rend rien (aucune information sur le lien au client) ;
--   - constat de l'ops (Bêta pilote d'ACC-014) : `core.risk_staff_decide_account_link` (famille
--     console iam_staff_owner, EXECUTE app_api) : session du staff élevée par TOTP, permission
--     `kyc.decide` dans les pays des DEUX comptes, jamais un lien qui le concerne, une ligne par
--     paire (dernier constat), audit chaîné en dernier ;
--   - OQ-P2P-09 « aucune compensation sans accord écrit » : aucun écrivain de compensation
--     n'existe (PYO est un squelette, US-709) ; cette migration n'en ajoute aucun. La garde est
--     portée par la DoR d'US-709 (ADR-110 n° 6).
--
-- Expand / contract : trois tables, des fonctions, des droits et des politiques ajoutés ; corps
-- de `core.booking_cmd_place_hold` (0071) et de `core.booking_conversion_eligibility` (0041)
-- remplacés à signature et propriétaire identiques. Le COMPORTEMENT se resserre, volontairement :
-- un membre d'un autre compte du titulaire, ou un compte lié, est refusé à la pose et à la
-- conversion (16 ACC-014).
--
-- Retour arrière :
--   réappliquer core.booking_cmd_place_hold de 0071 et core.booking_conversion_eligibility de 0041
--     (sous cmd_hold_owner) ;
--   DROP FUNCTION core.booking_cmd_report_self_booking(uuid),
--     core.risk_staff_decide_account_link(bytea, uuid, uuid, uuid, text, text),
--     core.risk_self_booking_signal(uuid, uuid) ;
--   DROP TABLE core.risk_assessment, core.risk_account_link, core.risk_rule ;
--   DROP POLICY risk_link_read ON core.iam_organization, core.iam_membership,
--     core.iam_user_account, core.kyc_identity_verification, core.kyc_identity_subject ;
--   révoquer les droits accordés ci-dessous (dont EXECUTE de core.support_enqueue_review à
--     cmd_hold_owner).

-- 1. Règles de risque déclarées (17 §3.2.13 `risk_rule`, classe C) --------------------------------
CREATE TABLE core.risk_rule (
  code        text        NOT NULL
    CONSTRAINT risk_rule_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  version     integer     NOT NULL CONSTRAINT risk_rule_version_positive CHECK (version >= 1),
  description text        NOT NULL
    CONSTRAINT risk_rule_description_length CHECK (char_length(btrim(description)) BETWEEN 10 AND 500),
  severity    text        NOT NULL
    CONSTRAINT risk_rule_severity_valid CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  active      boolean     NOT NULL,
  valid_from  timestamptz NOT NULL,
  CONSTRAINT risk_rule_pkey PRIMARY KEY (code, version)
);
COMMENT ON TABLE core.risk_rule IS
  'Règles de risque déclarées (17 §3.2.13) : en bêta, codées en dur mais déclarées ici pour que '
  'chaque évaluation reste explicable (BR-TRUST-01). Écrites par migration seulement. US-127.';
ALTER TABLE core.risk_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.risk_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.risk_rule TO migrator USING (true) WITH CHECK (true);

INSERT INTO core.risk_rule (code, version, description, severity, active, valid_from)
VALUES ('SELF_BOOKING_LINKED_ACCOUNT', 1,
        'Hold refusé : le voyageur est lié au titulaire ou à un membre du compte d''hôte du '
        'véhicule (même identité vérifiée, même téléphone ou lien constaté par l''ops). 16 ACC-014.',
        'HIGH', true, '2026-11-12T00:00:00Z');

-- 2. Liens entre comptes constatés par l'ops (16 ACC-014 « décision ops tracée ») ------------------
CREATE TABLE core.risk_account_link (
  id          uuid        CONSTRAINT risk_account_link_pkey PRIMARY KEY,
  user_low    uuid        NOT NULL
    CONSTRAINT risk_account_link_user_low_fkey REFERENCES core.iam_user_account (id),
  user_high   uuid        NOT NULL
    CONSTRAINT risk_account_link_user_high_fkey REFERENCES core.iam_user_account (id),
  decision    text        NOT NULL
    CONSTRAINT risk_account_link_decision_valid CHECK (decision IN ('LINKED', 'NOT_LINKED')),
  signal      text        NOT NULL
    CONSTRAINT risk_account_link_signal_valid CHECK (signal IN ('SAME_CARD', 'SAME_DEVICE',
      'SAME_DRIVER_LICENSE', 'SAME_IDENTITY', 'SAME_PHONE', 'OTHER')),
  decided_by  uuid        NOT NULL
    CONSTRAINT risk_account_link_decided_by_fkey REFERENCES core.iam_user_account (id),
  decided_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT platform.now(),
  updated_at  timestamptz NOT NULL DEFAULT platform.now(),
  row_version integer     NOT NULL DEFAULT 0
    CONSTRAINT risk_account_link_row_version_valid CHECK (row_version >= 0),
  CONSTRAINT risk_account_link_ordered CHECK (user_low < user_high),
  CONSTRAINT risk_account_link_pair_unique UNIQUE (user_low, user_high),
  CONSTRAINT risk_account_link_not_decider CHECK (decided_by <> user_low AND decided_by <> user_high)
);
CREATE INDEX risk_account_link_high_idx ON core.risk_account_link (user_high);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.risk_account_link
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
COMMENT ON TABLE core.risk_account_link IS
  'Dernier constat de l''ops sur une paire de comptes (16 ACC-014) : LINKED (même personne ou '
  'comptes liés : carte, appareil, permis…) ou NOT_LINKED (homonyme, numéro recyclé : écarte les '
  'signaux automatiques). Écrit par core.risk_staff_decide_account_link seulement. US-127.';
ALTER TABLE core.risk_account_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.risk_account_link FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.risk_account_link TO migrator USING (true) WITH CHECK (true);

-- 3. Évaluations de risque (17 §3.2.13 `risk_assessment`, classe A : journal explicable) ----------
CREATE TABLE core.risk_assessment (
  id           uuid        CONSTRAINT risk_assessment_pkey PRIMARY KEY,
  subject_type text        NOT NULL
    CONSTRAINT risk_assessment_subject_type_valid CHECK (subject_type IN ('HOLD', 'TRIP', 'USER')),
  subject_id   uuid        NOT NULL,
  country_code text        NOT NULL
    CONSTRAINT risk_assessment_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  org_id       uuid
    CONSTRAINT risk_assessment_org_fkey REFERENCES core.iam_organization (id),
  rules_fired  jsonb       NOT NULL
    CONSTRAINT risk_assessment_rules_array CHECK (jsonb_typeof(rules_fired) = 'array'
                                                  AND jsonb_array_length(rules_fired) >= 1),
  score        integer     NOT NULL CONSTRAINT risk_assessment_score_range CHECK (score BETWEEN 0 AND 100),
  decision     text        NOT NULL
    CONSTRAINT risk_assessment_decision_valid CHECK (decision IN ('AUTO_OK', 'REVIEW', 'REJECT')),
  dedupe_key   text        NOT NULL
    CONSTRAINT risk_assessment_dedupe_format CHECK (dedupe_key ~ '^[A-Z][A-Z0-9_]{1,63}:[0-9a-f-]{36}$'),
  explanation  text        NOT NULL
    CONSTRAINT risk_assessment_explanation_format CHECK (explanation ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  reviewed_by  uuid
    CONSTRAINT risk_assessment_reviewed_by_fkey REFERENCES core.iam_user_account (id),
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT risk_assessment_reviewed_coherent CHECK ((reviewed_by IS NULL) = (decided_at IS NULL))
);
-- une évaluation ouverte par sujet et par clé (voyageur, compte d'hôte) au plus
CREATE UNIQUE INDEX risk_assessment_open_unique ON core.risk_assessment
  (subject_type, subject_id, dedupe_key) WHERE (decided_at IS NULL);
COMMENT ON TABLE core.risk_assessment IS
  'Évaluation de risque explicable (17 §3.2.13, BR-TRUST-01) : règles déclenchées (code, version, '
  'signal), score, décision ; explanation = code seulement (aucune donnée personnelle). US-127 : '
  'auto-réservation par un compte lié (sujet USER = voyageur, org_id = compte d''hôte visé).';
COMMENT ON COLUMN core.risk_assessment.org_id IS
  'Compte d''hôte visé par la tentative (sujet USER) ; NULL pour une évaluation sans compte. US-127.';
COMMENT ON COLUMN core.risk_assessment.dedupe_key IS
  'Clé de déduplication des évaluations ouvertes : <règle>:<compte d''hôte>. US-127.';
ALTER TABLE core.risk_assessment ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.risk_assessment FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.risk_assessment TO migrator USING (true) WITH CHECK (true);

-- 4. Jugement du lien (SECURITY DEFINER, risk_limit_owner, EXECUTE au seul cmd_hold_owner) --------
-- Lectures au plus juste, par colonnes ; aucun droit pour les rôles applicatifs.
GRANT SELECT (id, holder_user_id) ON core.iam_organization TO risk_limit_owner;
CREATE POLICY risk_link_read ON core.iam_organization FOR SELECT TO risk_limit_owner USING (true);
GRANT SELECT (org_id, user_id, status) ON core.iam_membership TO risk_limit_owner;
CREATE POLICY risk_link_read ON core.iam_membership FOR SELECT TO risk_limit_owner USING (true);
GRANT SELECT (id, legal_first_name, legal_last_name, phone_e164, phone_verified_at, pseudonymized_at)
  ON core.iam_user_account TO risk_limit_owner;
CREATE POLICY risk_link_read ON core.iam_user_account FOR SELECT TO risk_limit_owner USING (true);
GRANT SELECT (id, user_id, approved_at) ON core.kyc_identity_verification TO risk_limit_owner;
CREATE POLICY risk_link_read ON core.kyc_identity_verification FOR SELECT TO risk_limit_owner
  USING (approved_at IS NOT NULL);
GRANT SELECT (verification_id, user_id, date_of_birth) ON core.kyc_identity_subject TO risk_limit_owner;
CREATE POLICY risk_link_read ON core.kyc_identity_subject FOR SELECT TO risk_limit_owner
  USING (date_of_birth IS NOT NULL);
GRANT SELECT (user_low, user_high, decision, signal) ON core.risk_account_link TO risk_limit_owner;
CREATE POLICY risk_link_read ON core.risk_account_link FOR SELECT TO risk_limit_owner USING (true);

CREATE FUNCTION core.risk_self_booking_signal(p_guest uuid, p_org uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  -- Personnes du côté hôte : titulaire du compte du véhicule et membres ACTIVE / INVITED de tous
  -- les comptes d'hôte de ce titulaire (tous pays). Le titulaire a aussi sa ligne P2P_HOST.
  WITH host AS (
    SELECT o.holder_user_id AS user_id FROM core.iam_organization AS o WHERE o.id = p_org
    UNION
    SELECT m.user_id
      FROM core.iam_organization AS o
      JOIN core.iam_organization AS o2 ON o2.holder_user_id = o.holder_user_id
      JOIN core.iam_membership AS m ON m.org_id = o2.id AND m.status IN ('ACTIVE', 'INVITED')
     WHERE o.id = p_org
  ),
  -- dernier constat de l'ops pour chaque paire (voyageur, personne du côté hôte)
  pair AS (
    SELECT h.user_id, l.decision, l.signal
      FROM host AS h
      LEFT JOIN core.risk_account_link AS l
        ON l.user_low = LEAST(h.user_id, p_guest) AND l.user_high = GREATEST(h.user_id, p_guest)
  ),
  -- signaux automatiques : toutes les paires sauf celles constatées NOT_LINKED
  auto_host AS (
    SELECT p.user_id FROM pair AS p WHERE p.decision IS DISTINCT FROM 'NOT_LINKED'
  ),
  -- identité vérifiée : nom et prénom légaux normalisés (casse, accents, espaces, ponctuation
  -- ignorés), date de naissance rendue par le fournisseur, sur une vérification approuvée au moins
  -- une fois ; comptes pseudonymisés exclus (leurs noms sont des marqueurs)
  ident AS (
    SELECT u.id AS user_id,
           pg_catalog.regexp_replace(
             pg_catalog.translate(pg_catalog.lower(u.legal_first_name || '|' || u.legal_last_name),
                                  'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿ',
                                  'aaaaaaaeeeeeiiiiiooooooouuuuuncyy'),
             '[^a-z|]', '', 'g') AS name_key,
           s.date_of_birth
      FROM core.iam_user_account AS u
      JOIN core.kyc_identity_verification AS v ON v.user_id = u.id AND v.approved_at IS NOT NULL
      JOIN core.kyc_identity_subject AS s
        ON s.verification_id = v.id AND s.user_id = u.id AND s.date_of_birth IS NOT NULL
     WHERE u.pseudonymized_at IS NULL
       AND (u.id = p_guest OR u.id IN (SELECT a.user_id FROM auto_host AS a))
  ),
  signals AS (
    -- entrée absente ou compte inconnu : aucun lien jugeable, fail-closed
    SELECT 0 AS rank, 'DIRECT' AS signal
     WHERE p_guest IS NULL OR p_org IS NULL OR NOT EXISTS (SELECT 1 FROM host)
    UNION ALL
    SELECT 1, 'DIRECT' WHERE EXISTS (SELECT 1 FROM host AS h WHERE h.user_id = p_guest)
    UNION ALL
    SELECT 2, p.signal FROM pair AS p WHERE p.decision = 'LINKED'
    UNION ALL
    SELECT 3, 'SAME_IDENTITY'
     WHERE EXISTS (SELECT 1
                     FROM ident AS g
                     JOIN ident AS h ON h.user_id <> g.user_id AND h.name_key = g.name_key
                                    AND h.date_of_birth = g.date_of_birth
                    WHERE g.user_id = p_guest AND g.name_key <> '|')
    UNION ALL
    -- même téléphone, vérifié sur l'un des deux comptes au moins
    SELECT 4, 'SAME_PHONE'
     WHERE EXISTS (SELECT 1
                     FROM core.iam_user_account AS g
                     JOIN core.iam_user_account AS h
                       ON h.id IN (SELECT a.user_id FROM auto_host AS a)
                    WHERE g.id = p_guest AND g.pseudonymized_at IS NULL
                      AND h.pseudonymized_at IS NULL AND g.phone_e164 IS NOT NULL
                      AND g.phone_e164 = h.phone_e164
                      AND (g.phone_verified_at IS NOT NULL OR h.phone_verified_at IS NOT NULL))
  )
  SELECT s.signal FROM signals AS s ORDER BY s.rank, s.signal LIMIT 1
$fn$;
COMMENT ON FUNCTION core.risk_self_booking_signal(uuid, uuid) IS
  'Lien entre un voyageur et un compte d''hôte (16 ACC-014, OQ-P2P-09) : DIRECT (titulaire ou '
  'membre d''un compte du titulaire, tous pays), constat LINKED de l''ops (son signal), '
  'SAME_IDENTITY, SAME_PHONE, ou NULL. EXECUTE au seul cmd_hold_owner (pose, conversion, '
  'signalement) : jamais un oracle pour un client. US-127 (ADR-110).';
REVOKE ALL ON FUNCTION core.risk_self_booking_signal(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.risk_self_booking_signal(uuid, uuid) TO cmd_hold_owner;
GRANT CREATE ON SCHEMA core TO risk_limit_owner;
ALTER FUNCTION core.risk_self_booking_signal(uuid, uuid) OWNER TO risk_limit_owner;
REVOKE CREATE ON SCHEMA core FROM risk_limit_owner;

-- 5. Droits de cmd_hold_owner : signalement (évaluation, file RISK_BOOKING) -----------------------
GRANT SELECT (code, version, active, valid_from) ON core.risk_rule TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.risk_rule FOR SELECT TO cmd_hold_owner USING (true);
GRANT SELECT (subject_type, subject_id, dedupe_key, decided_at) ON core.risk_assessment
  TO cmd_hold_owner;
CREATE POLICY cmd_hold_read ON core.risk_assessment FOR SELECT TO cmd_hold_owner
  USING (subject_type = 'USER' AND decided_at IS NULL);
GRANT INSERT (id, subject_type, subject_id, country_code, org_id, rules_fired, score, decision,
              dedupe_key, explanation)
  ON core.risk_assessment TO cmd_hold_owner;
CREATE POLICY cmd_hold_risk_ins ON core.risk_assessment FOR INSERT TO cmd_hold_owner
  WITH CHECK (subject_type = 'USER' AND decision = 'REVIEW' AND reviewed_by IS NULL
              AND decided_at IS NULL AND explanation = 'SELF_BOOKING_LINKED_ACCOUNT'
              AND app.actor_kind() = 'GUEST' AND subject_id = app.actor_id());
SET LOCAL ROLE iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.support_enqueue_review(text, text, uuid, text, uuid) TO cmd_hold_owner;
RESET ROLE;

-- 6. Sous cmd_hold_owner : pose, conversion et signalement --------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 6.1 Pose d'un hold : corps de 0071 recopié à l'identique, sauf la garde d'auto-réservation
-- (étape marquée US-127), qui reste à sa place : avant les paramètres, les verrous et l'occupation.
CREATE OR REPLACE FUNCTION core.booking_cmd_place_hold(
  p_vehicle_id uuid,
  p_start      timestamptz,
  p_end        timestamptz,
  p_flagged    boolean
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest      uuid := app.actor_id();
  v_org        uuid;
  v_country    text;
  v_holder     uuid;
  v_org_status text;
  v_buffer     integer;
  v_ttl        integer;
  v_max_total  integer;
  v_max_live   integer;
  v_rate       integer;
  v_grace      integer;
  v_order      text;
  v_review     boolean;
  v_minutes    integer;
  v_live       integer;
  v_overlap    boolean;
  v_recent     integer;
  v_now        timestamptz;
  v_expires_at timestamptz;
  v_period     tstzrange;
  v_hold       uuid := pg_catalog.gen_random_uuid();
  v_occupancy  uuid := pg_catalog.gen_random_uuid();
  v_max_days   integer;
  v_notice     integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  -- US-049 (RT-CONC-02) : bornes finies (une fin infinie occuperait le véhicule sans limite)
  IF p_vehicle_id IS NULL OR p_start IS NULL OR p_end IS NULL OR NOT pg_catalog.isfinite(p_start)
     OR NOT pg_catalog.isfinite(p_end) OR p_end <= p_start OR p_start <= platform.now() THEN
    RAISE EXCEPTION 'hold: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;

  SELECT p.org_id, p.country_code INTO v_org, v_country
    FROM core.booking_vehicle_party(p_vehicle_id) AS p;
  IF v_org IS NULL OR v_country IS NULL THEN
    RAISE EXCEPTION 'hold: vehicle unknown'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_vehicle_unknown';
  END IF;
  SELECT o.holder_user_id, o.status INTO v_holder, v_org_status
    FROM core.iam_organization o
   WHERE o.id = v_org AND o.country_code = v_country;
  IF v_org_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'hold: host not active'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_host_not_active';
  END IF;
  -- self_booking_forbidden (16 BKG-012, ACC-014 ; OQ-P2P-09). US-049 (F-RLS-02) : le titulaire et
  -- tout membre du compte d'hôte du véhicule. US-127 (ADR-110) : aussi tout membre d'un autre
  -- compte d'hôte du titulaire (autre pays) et tout compte lié à l'une de ces personnes (constat
  -- de l'ops, même identité vérifiée, même téléphone). Le même refus, sans détail, avant toute
  -- lecture de l'occupation ; le signalement à l'ops est la commande
  -- core.booking_cmd_report_self_booking (transaction distincte : ce refus annule celle-ci)
  IF core.risk_self_booking_signal(v_guest, v_org) IS NOT NULL THEN
    RAISE EXCEPTION 'hold: self booking'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_self_booking';
  END IF;
  -- US-109 (16 ADM-005, BKG-012 ; 08 BR-ACC-10) : une restriction ACTIVE du voyageur refuse toute
  -- réservation ; celle du titulaire du compte d'hôte ferme ses véhicules (L1-PM-33)
  IF EXISTS (SELECT 1 FROM core.iam_restriction r WHERE r.user_id = v_guest AND r.active) THEN
    RAISE EXCEPTION 'hold: account restricted'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_account_restricted';
  END IF;
  IF EXISTS (SELECT 1 FROM core.iam_restriction r WHERE r.user_id = v_holder AND r.active) THEN
    RAISE EXCEPTION 'hold: host not active'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_host_not_active';
  END IF;

  v_buffer    := core.booking_param_int('buffer_minutes', v_country);
  v_ttl       := core.booking_param_int('hold_ttl_minutes', v_country);
  v_max_total := core.booking_param_int('hold_max_total_minutes', v_country);
  v_max_live  := core.booking_param_int('max_active_holds_per_guest', v_country);
  v_rate      := core.booking_param_int('hold_creations_per_guest_vehicle_hour', v_country);
  v_grace     := core.booking_param_int('sweep_grace_s', v_country);
  v_max_days  := core.booking_param_int('max_trip_days', v_country);  -- US-049 (RT-CONC-02)
  v_review    := COALESCE(p_flagged, true)
                 AND COALESCE(core.booking_param_text('flagged_booking_payment_order', v_country),
                              'REVIEW_BEFORE_CHARGE') IS DISTINCT FROM 'PAY_THEN_REVIEW';
  IF v_review THEN
    v_minutes := core.booking_param_int('review_hold_minutes', v_country);
  ELSE
    v_minutes := LEAST(v_ttl, v_max_total);
  END IF;
  -- US-119 (16 CAL-003, 08 BR-BOOK-04) : préavis du lieu de remise du véhicule, sinon du pays
  v_notice    := core.catalog_effective_notice_minutes(p_vehicle_id);
  IF v_buffer IS NULL OR v_ttl IS NULL OR v_max_total IS NULL OR v_max_live IS NULL
     OR v_rate IS NULL OR v_grace IS NULL OR v_minutes IS NULL OR v_minutes < 1
     OR v_max_days IS NULL OR v_max_days < 1 OR v_notice IS NULL THEN
    RAISE EXCEPTION 'hold: parameter missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  -- US-049 (RT-CONC-02) : durée de location au plus max_trip_days jours du pays (17 §7.2, ADM-031)
  IF p_end - p_start > pg_catalog.make_interval(days => v_max_days) THEN
    RAISE EXCEPTION 'hold: invalid period'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'occupancy_period_invalid';
  END IF;
  -- US-119 : départ au plus tôt à platform.now() + préavis (borne incluse : 3 h pile acceptée,
  -- 2 h 59 refusée)
  IF p_start < platform.now() + pg_catalog.make_interval(mins => v_notice) THEN
    RAISE EXCEPTION 'hold: advance notice too short'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_notice_too_short';
  END IF;
  v_period := core.booking_occupied_period(p_start, p_end, v_buffer);

  -- 0. verrous : guest puis véhicule (ordre global, 17 §2.5, VERIF_16-M2)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('guest:' || v_guest::text, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('veh:' || p_vehicle_id::text, 0));

  -- 2a. expiration ciblée : texte EXPIRY_2A_SQL de test/support/expiry-2a.ts (17 §2.5,
  -- VERIF_16-M14, VERIF_17-A3 / A6), aux paramètres près (égalité vérifiée par expiry-2a.test.ts)
  WITH t AS (SELECT platform.now() AS ts),
     due AS (
       SELECT h.id, h.occupancy_id
         FROM core.booking_checkout_hold h, t
        WHERE (h.vehicle_id = p_vehicle_id OR h.guest_user_id = v_guest)
          AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
          AND h.expires_at <= t.ts
          AND (h.payment_in_flight_until IS NULL OR h.payment_in_flight_until <= t.ts)
          AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation o
                           WHERE o.hold_id = h.id AND o.purpose = 'RENT'
                             AND ( ( o.status IN ('PENDING','SUBMITTED','UNKNOWN')
                                     AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
                                     AND t.ts < h.payment_in_flight_until + make_interval(secs => v_grace) )
                                OR ( o.status = 'SUCCEEDED'
                                     AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                                      WHERE d.operation_id = o.id) ) ))
        FOR UPDATE OF h SKIP LOCKED
     ), expired AS (
       UPDATE core.booking_checkout_hold SET status = 'EXPIRED', expired_at = (SELECT ts FROM t)
        WHERE id IN (SELECT id FROM due)
       RETURNING occupancy_id
     )
     UPDATE core.booking_vehicle_occupancy
        SET active = false, deactivated_reason = 'HOLD_EXPIRED'
      WHERE id IN (SELECT occupancy_id FROM expired)
        AND kind = 'HOLD';

  -- 2b. contrôles entre hôtes, sous le verrou du voyageur (17 §2.3, RLS-3, RLS-4) : holds vivants
  -- tous hôtes confondus, chevauchement avec ses trips (période sans tampon, BR-BOOK-08)
  SELECT g.live_holds, g.trip_overlap INTO v_live, v_overlap
    FROM platform.guest_hold_guard(pg_catalog.tstzrange(p_start, p_end, '[)')) AS g;
  IF v_live IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF v_overlap THEN
    RAISE EXCEPTION 'hold: guest overlap'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_guest_overlap';
  END IF;
  IF v_live >= v_max_live THEN
    RAISE EXCEPTION 'hold: live hold limit reached'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_guest_limit';
  END IF;
  -- rotation (17 §2.5 M5) : poses du voyageur sur ce véhicule dans l'heure glissante
  v_now := platform.now();
  SELECT pg_catalog.count(*)::integer INTO v_recent
    FROM core.booking_checkout_hold h
   WHERE h.guest_user_id = v_guest AND h.vehicle_id = p_vehicle_id
     AND h.created_at > v_now - pg_catalog.make_interval(hours => 1);
  IF v_recent >= v_rate THEN
    RAISE EXCEPTION 'hold: rate limited'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_rate_limited';
  END IF;

  -- 2c. occupation HOLD [début, fin + tampon) puis hold ; pas de guest_occupancy (17 §2.5)
  v_expires_at := v_now + pg_catalog.make_interval(mins => v_minutes);
  -- 23P01 vehicle_occupancy_no_overlap possible ici : créneau pris (2d : VEHICLE_UNAVAILABLE)
  INSERT INTO core.booking_vehicle_occupancy
         (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at,
          ref_type, ref_id, created_by)
  VALUES (v_occupancy, p_vehicle_id, v_org, v_country, 'HOLD', 'CHECKOUT', v_period, true,
          v_expires_at, 'HOLD', v_hold, v_guest);
  -- 23505 one_live_hold_per_guest_vehicle possible ici : hold vivant du même voyageur
  INSERT INTO core.booking_checkout_hold
         (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status,
          expires_at, review_required, created_at, created_by)
  VALUES (v_hold, v_guest, p_vehicle_id, v_org, v_country, v_occupancy, 'CHECKOUT', 'ACTIVE',
          v_expires_at, v_review, v_now, v_guest);

  -- booking.hold.created (17 §2.5 : seul événement avant la preuve de paiement) ; aucune donnée
  -- du voyageur dans le contenu (l'acteur est dans l'enveloppe)
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('booking.hold.created', 1, 'checkout_hold', v_hold, 0, v_country, v_guest, 'GUEST',
          pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('hold_id', v_hold, 'vehicle_id', p_vehicle_id,
                                        'org_id', v_org, 'expires_at', v_expires_at,
                                        'review_required', v_review),
          v_hold::text);
  RETURN v_hold;
END
$fn$;

COMMENT ON FUNCTION core.booking_cmd_place_hold(uuid, timestamptz, timestamptz, boolean) IS
  'Commande : pose d''un hold de checkout (17 §2.5 étape 2) ; refusée (SELF_BOOKING_FORBIDDEN) au '
  'titulaire, à tout membre d''un compte d''hôte du titulaire (tous pays) et à tout compte lié à '
  'l''un d''eux (core.risk_self_booking_signal), à un voyageur restreint (ACCOUNT_RESTRICTED), sur '
  'le véhicule d''un titulaire restreint (HOST_NOT_ACTIVATED) et pour un départ dans le préavis du '
  'lieu (DATES_NOTICE_TOO_SHORT). US-023, US-049, US-109, US-119, US-127.';

-- 6.2 Éligibilité à la conversion : corps de 0041 recopié, la garde du titulaire devient le même
-- jugement que la pose (un lien constaté, une appartenance ou une identité vérifiée après la pose
-- ferme la conversion : compensation, jamais de trip)
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
  'SELF_BOOKING pour le titulaire, un membre d''un compte du titulaire ou un compte lié (même '
  'jugement que la pose). Travailleurs de conversion seulement. US-024, US-127.';

-- 6.3 Signalement à l'ops d'une tentative par un compte lié (critère 2) : appelée par l'API dans
-- une NOUVELLE transaction après un SELF_BOOKING_FORBIDDEN. Ne rend rien au client.
CREATE FUNCTION core.booking_cmd_report_self_booking(p_vehicle_id uuid)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_guest   uuid := app.actor_id();
  v_org     uuid;
  v_country text;
  v_signal  text;
  v_version integer;
  v_key     text;
  v_id      uuid := pg_catalog.gen_random_uuid();
  r_queue   record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'GUEST' OR v_guest IS NULL THEN
    RAISE EXCEPTION 'hold: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'hold_forbidden';
  END IF;
  IF p_vehicle_id IS NULL THEN
    RETURN;
  END IF;
  SELECT p.org_id, p.country_code INTO v_org, v_country
    FROM core.booking_vehicle_party(p_vehicle_id) AS p;
  IF v_org IS NULL OR v_country IS NULL THEN
    RETURN;
  END IF;
  v_signal := core.risk_self_booking_signal(v_guest, v_org);
  -- rien à signaler : aucun lien, ou l'hôte lui-même (DIRECT n'est pas un soupçon)
  IF v_signal IS NULL OR v_signal = 'DIRECT' THEN
    RETURN;
  END IF;
  SELECT r.version INTO v_version
    FROM core.risk_rule AS r
   WHERE r.code = 'SELF_BOOKING_LINKED_ACCOUNT' AND r.active AND r.valid_from <= platform.now()
   ORDER BY r.version DESC
   LIMIT 1;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'risk: rule missing'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'hold_param_missing';
  END IF;
  v_key := 'SELF_BOOKING_LINKED_ACCOUNT:' || v_org::text;
  -- une évaluation ouverte par (voyageur, compte d'hôte) : verrou puis relecture
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'risk.self_booking:' || v_guest::text || ':' || v_org::text, 0));
  IF EXISTS (SELECT 1 FROM core.risk_assessment AS a
              WHERE a.subject_type = 'USER' AND a.subject_id = v_guest AND a.dedupe_key = v_key
                AND a.decided_at IS NULL) THEN
    RETURN;
  END IF;
  INSERT INTO core.risk_assessment
         (id, subject_type, subject_id, country_code, org_id, rules_fired, score, decision,
          dedupe_key, explanation)
  VALUES (v_id, 'USER', v_guest, v_country, v_org,
          pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'code', 'SELF_BOOKING_LINKED_ACCOUNT', 'version', v_version, 'signal', v_signal)),
          100, 'REVIEW', v_key, 'SELF_BOOKING_LINKED_ACCOUNT');
  -- file RISK_BOOKING du pays du véhicule (US-109) ; une mise en file impossible (paramètre de
  -- délai absent) n'annule pas l'évaluation : elle reste ouverte et visible
  SELECT * INTO r_queue
    FROM core.support_enqueue_review('RISK_BOOKING', 'RISK_ASSESSMENT', v_id, v_country, NULL);
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_report_self_booking(uuid) IS
  'Commande : signalement à l''ops d''une tentative de hold par un compte lié au compte d''hôte '
  'du véhicule (16 ACC-014 « signal ADM-029 ») : évaluation risk_assessment REVIEW (règle '
  'SELF_BOOKING_LINKED_ACCOUNT) et file RISK_BOOKING ; une évaluation ouverte par (voyageur, '
  'compte) ; rien pour DIRECT ni sans lien ; ne rend rien. US-127 (ADR-110).';
REVOKE ALL ON FUNCTION core.booking_cmd_report_self_booking(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_cmd_report_self_booking(uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 7. Constat de l'ops sur une paire de comptes (famille console, iam_staff_owner, EXECUTE app_api)
GRANT SELECT, INSERT (id, user_low, user_high, decision, signal, decided_by, decided_at),
  UPDATE (decision, signal, decided_by, decided_at)
  ON core.risk_account_link TO iam_staff_owner;
CREATE POLICY iam_staff_select ON core.risk_account_link FOR SELECT TO iam_staff_owner USING (true);
CREATE POLICY iam_staff_insert ON core.risk_account_link FOR INSERT TO iam_staff_owner
  WITH CHECK (true);
CREATE POLICY iam_staff_update ON core.risk_account_link FOR UPDATE TO iam_staff_owner
  USING (true) WITH CHECK (true);

GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;
-- Issues : AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN, RECORDED, UNCHANGED. Entrée invalide : 22023.
-- Refus et constat journalisés (audit chaîné, en dernier) ; AUTH_REQUIRED et UNCHANGED non.
CREATE FUNCTION core.risk_staff_decide_account_link(p_token_hash bytea, p_request_id uuid,
                                                    p_user_a uuid, p_user_b uuid,
                                                    p_decision text, p_signal text)
  RETURNS TABLE (outcome text, link_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s       record;
  v_low     uuid;
  v_high    uuid;
  v_c_low   text;
  v_c_high  text;
  v_role    text;
  v_why     text;
  v_link    record;
  v_id      uuid;
BEGIN
  IF p_request_id IS NULL OR p_user_a IS NULL OR p_user_b IS NULL OR p_user_a = p_user_b
     OR p_decision IS NULL OR p_decision NOT IN ('LINKED', 'NOT_LINKED')
     OR p_signal IS NULL OR p_signal NOT IN ('SAME_CARD', 'SAME_DEVICE', 'SAME_DRIVER_LICENSE',
                                             'SAME_IDENTITY', 'SAME_PHONE', 'OTHER') THEN
    RAISE EXCEPTION 'comptes liés : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_low  := LEAST(p_user_a, p_user_b);
  v_high := GREATEST(p_user_a, p_user_b);
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'USER', v_low, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'ACCOUNT_LINK_DECISION'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- pays des deux comptes, relus en base ; permission dans les DEUX ; jamais un lien qui concerne
  -- l'acteur lui-même
  v_c_low  := core.ctr_account_country(v_low);
  v_c_high := core.ctr_account_country(v_high);
  IF v_s.user_id IN (v_low, v_high) THEN
    v_why := 'SELF';
  ELSIF v_c_low IS NULL OR v_c_high IS NULL THEN
    v_why := 'SUBJECT_NOT_FOUND';
  ELSE
    v_role := core.iam_staff_permitted(v_s.user_id, 'kyc.decide',
                                       ARRAY(SELECT DISTINCT c FROM pg_catalog.unnest(
                                               ARRAY[v_c_low, v_c_high]) AS c ORDER BY c),
                                       NULL);
    IF v_role IS NULL THEN
      v_why := 'PERMISSION';
    END IF;
  END IF;
  IF v_why IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN', 'USER',
                                 v_low, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_why,
                                   'attempted', 'ACCOUNT_LINK_DECISION')
                                 || CASE WHEN v_c_low IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country', v_c_low) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;

  -- une ligne par paire : verrou de la paire, relecture, puis écriture
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'risk.account_link:' || v_low::text || ':' || v_high::text, 0));
  SELECT l.id, l.decision, l.signal INTO v_link
    FROM core.risk_account_link AS l
   WHERE l.user_low = v_low AND l.user_high = v_high
   FOR UPDATE;
  IF v_link.id IS NOT NULL AND v_link.decision = p_decision AND v_link.signal = p_signal THEN
    RETURN QUERY SELECT 'UNCHANGED'::text, v_link.id;
    RETURN;
  END IF;
  IF v_link.id IS NULL THEN
    v_id := pg_catalog.gen_random_uuid();
    INSERT INTO core.risk_account_link (id, user_low, user_high, decision, signal, decided_by,
                                        decided_at)
    VALUES (v_id, v_low, v_high, p_decision, p_signal, v_s.user_id, platform.now());
  ELSE
    v_id := v_link.id;
    UPDATE core.risk_account_link AS l
       SET decision = p_decision, signal = p_signal, decided_by = v_s.user_id,
           decided_at = platform.now()
     WHERE l.id = v_id;
  END IF;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'ACCOUNT_LINK_DECIDED', 'USER', v_low,
                               CASE WHEN v_link.id IS NULL THEN NULL
                                    ELSE pg_catalog.jsonb_build_object('decision', v_link.decision,
                                           'signal', v_link.signal) END,
                               pg_catalog.jsonb_build_object('country', v_c_low,
                                 'otherCountry', v_c_high, 'otherUser', v_high, 'linkId', v_id,
                                 'decision', p_decision, 'signal', p_signal),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'RECORDED'::text, v_id;
END
$fn$;
COMMENT ON FUNCTION core.risk_staff_decide_account_link(bytea, uuid, uuid, uuid, text, text) IS
  'Console : constat de l''ops sur une paire de comptes (16 ACC-014 : comptes liés repérés à la '
  'revue KYC ; liens légitimes : décision tracée) : LINKED ferme la réservation entre eux, '
  'NOT_LINKED écarte les signaux automatiques. TOTP, kyc.decide dans les pays des deux comptes, '
  'jamais un lien de l''acteur ; audit chaîné. US-127 (ADR-110).';
REVOKE ALL ON FUNCTION core.risk_staff_decide_account_link(bytea, uuid, uuid, uuid, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.risk_staff_decide_account_link(bytea, uuid, uuid, uuid, text, text)
  TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
