-- 0169 — PAY : carte enregistrée (jeton du PSP), consentement MIT, débits post-trip conformes aux
-- réseaux, dette du voyageur et encaissements partiels par jambe.
-- US-703 ; ADR-189 ; 19 US-703 (critères 1 à 3) ; 16 PAY-015 / PAY-037, EC-28 ; 08 BR-PAY-09,
-- BR-PAY-09 bis (REQ-PAY-DMG-04 à 07, 09), BR-PAY-10, BR-REIMB-03, E4 (`attempt_no` des
-- encaissements, T68), E7 règle 4 (révisée par US-056 ; TJ07, TJ17, TJ19) ; 17 v6 §2.8
-- (`chargeMIT`, `SUPPORTS_MIT` bloquante), §3.2.7 (`payment_instrument`, `mit_consent`,
-- `debt_balance`) ; 22 OQ-BR-43, OQ-PAY-18 (inconnu ⇒ aucun débit) ; pré-mortem du lot 3 :
-- L3-PM-16, L3-PM-21 à L3-PM-24, L3-PM-38, L3-PM-55 ; red team RT-L3-M01 à M04, RT-L3-H03.
-- Appliquée sous `migrator`.
--
-- Principes (ADR-189, PROPOSÉ, « comme Turo », jamais plus lourd) :
--   - carte enregistrée = JETON du PSP seulement (`payment_payment_instrument.token_ref`, jamais un
--     PAN : contrainte `core.payment_text_has_pan`, détecteur de 0029 / 0131) ; marque du réseau,
--     4 derniers chiffres et échéance ; une carte ACTIVE par (voyageur, compte PSP) : une nouvelle
--     carte remplace l'ancienne (REPLACED) ;
--   - consentement MIT (`payment_mit_consent`) donné par le voyageur au checkout, sur le hold
--     (S05, `web.s05.mitConsent`), quatre portées de 17 (`DELAYED_CHARGES`, `NO_SHOW`,
--     `DAMAGE_SEPARATE`, `REAUTHORIZATION`) ; lié UNE fois à la carte enregistrée par le paiement
--     prouvé (`core.payment_cmd_record_instrument`) ; immuable ensuite. Une carte changée après
--     le consentement n'est jamais débitée (consentement lié à l'ancienne carte, REPLACED) ;
--   - rappel du consentement à la remise (US-315, S09) : `payment_mit_consent_reminder`, posé par
--     le voyageur pendant CHECKIN_OPEN ; exigé pour un débit `DELAYED_CHARGES` ou
--     `DAMAGE_SEPARATE` (frais après le trip) ; un débit `NO_SHOW` (retenue d'une annulation, T29)
--     n'exige que le consentement du checkout ;
--   - règles des réseaux EN DONNÉES (`payment_mit_network_rule`, matrice pays × réseau × motif,
--     versionnée, insertion seule) : préavis d'objection en heures (NULL ⇒ accord écrit exigé,
--     Mastercard et Amex pour un dommage), délai maximal en jours et son point de départ (retour
--     ou notification), échéancier des tentatives (J0, J+3, J+7 : EC-28) ; règle absente ou délai
--     inconnu ⇒ aucun débit (OQ-BR-43, OQ-PAY-18), la dette part en recouvrement hors carte ;
--   - un débit post-trip (`payment_post_trip_charge`) naît NOTIFIÉ (heure de la base) avec le
--     montant EXPLICITE de chaque jambe (décision amont : US-305, US-706, US-309 ; jamais un
--     prorata) ; chaque tentative est planifiée par la base (`core.payment_cmd_plan_mit_attempt`) :
--     consentement, rappel, carte, règle du réseau, délai, préavis, `SUPPORTS_MIT` (capacité
--     inconnue = non), échéancier relus sous le verrou du trip ; une seule instance `MIT_CHARGE`
--     (i1), clé `{trip}:1:{v…}:MIT_CHARGE:{moyen}:i1:a{n}`, `attempt_no` + 1 seulement après un
--     refus REÇU, jamais une nouvelle tentative tant qu'une tentative est sans statut (T68) ;
--   - un ordre `MIT_CHARGE` ou `DEBT_COLLECTION` n'est enregistré que s'il est celui d'une
--     tentative ou d'un encaissement planifié ici (déclencheur `payment_operation_mit_guard`) :
--     aucun débit hors de ce chemin, par aucun rôle ;
--   - refus confirmé « ne pas réessayer », tentatives épuisées, consentement absent, carte changée,
--     délai dépassé ou règle inconnue ⇒ dette (`payment_debt_balance`, jambes dues = jambes du
--     débit) et restriction `UNPAID_BALANCE` du voyageur, levée quand toutes ses dettes sont
--     payées ;
--   - encaissement partiel d'une dette (`payment_debt_collection`) : jambes de la règle 4 de 08 E7
--     révisée (`core.payment_partial_collection_legs`, la même que `partialCollectionLegs` de
--     `@rueda/money`) : aucun incrément négatif, aucune jambe au-delà de son dû, cumul = jambes
--     dues au solde ; clé `{trip}:1:v0-DEBT-{dette}:DEBT_COLLECTION:{moyen}:i{n}:a1` ;
--   - la caution n'est jamais capturée pour un débit post-trip : aucun `DEPOSIT_*` ici, un débit
--     post-trip est toujours un `MIT_CHARGE` séparé ; aucun fonds de tiers détenu (mouvement de
--     jambe par `core.settlement_cmd_apply_leg_movement`, qui refuse tout mode autre que
--     SPLIT_AT_SOURCE sans `funds_holding_enabled`) ; aucun interrupteur écrit ; aucune constante
--     de pays ; heure de la base (`platform.now()`).
--
-- Écarts PROPOSÉS avec 17 §3.2.7 (ADR-189, à reporter) : `mit_consent.hold_id` (le consentement
-- est donné avant la naissance du trip) et `trip_id` nullable ; `mit_consent.document_id` absent
-- (texte versionné du catalogue : `consent_key`, `catalog_version`, `locale`) ;
-- `payment_instrument.bin6` et `issuer_country` absents (inutiles au débit, donnée minimisée) ;
-- `debt_balance` porte les jambes dues et encaissées, le débit d'origine et la règle ; états
-- `IN_PLAN`, `IN_COLLECTIONS`, `WRITTEN_OFF` non construits (échéancier et recouvrement : suites) ;
-- `post_trip_charge` (16 PAY-015 « Données ») porte `objection_until` sous forme de
-- `next_check_at` recalculé par la règle du réseau de la carte au moment du débit.
--
-- Codes (packages/db/src/errors.ts) : mit_command_forbidden (42501) → FORBIDDEN ;
-- mit_operation_unplanned, mit_charge_mismatch → INVARIANT_VIOLATION ; mit_charge_conflict,
-- mit_instrument_conflict → IDEMPOTENCY_CONFLICT ; mit_*_immutable → IMMUTABLE_RECORD ;
-- mit_charge_transition, debt_transition → INVALID_TRANSITION ; mit_charge_legs_sum,
-- debt_collection_amount → LEG_SUM_MISMATCH.
--
-- Retour arrière (base sans débit post-trip ; jamais en production : nouvelle migration) :
--   DROP TRIGGER payment_operation_mit_guard ON core.payment_payment_operation ;
--   DROP FUNCTION core.payment_* créées ici (liste des droits en fin de fichier) ;
--   DROP TABLE core.payment_debt_collection, core.payment_debt_balance,
--     core.payment_post_trip_charge_attempt, core.payment_post_trip_charge,
--     core.payment_mit_network_rule, core.payment_mit_consent_reminder, core.payment_mit_consent,
--     core.payment_payment_instrument ;
--   DROP POLICY cmd_money_debt_restriction_sel, cmd_money_debt_restriction_ins,
--     cmd_money_debt_restriction_upd ON core.iam_restriction ;
--   REVOKE les droits de colonnes accordés au §1.

-- 1. Droits complémentaires de cmd_money_owner (au plus juste) --------------------------------------
-- voyageur du hold et du trip (consentement, dette), état du hold (consentement au paiement)
GRANT SELECT (guest_user_id, status, converted_trip_id) ON core.booking_checkout_hold
  TO cmd_money_owner;
GRANT SELECT (guest_user_id) ON core.booking_trip TO cmd_money_owner;
-- capacité SUPPORTS_MIT relue à chaque tentative (inconnue = non)
GRANT EXECUTE ON FUNCTION core.payment_capability_value(text, text, text, text),
  core.payment_capability_bool(text, text, text, text) TO cmd_money_owner;
-- restriction UNPAID_BALANCE d'une dette ouverte (17 §3.2.7), levée au paiement de la dernière
GRANT SELECT (id, user_id, kind, active, source_ref), INSERT (id, user_id, kind, active, reason,
  source_ref) ON core.iam_restriction TO cmd_money_owner;
GRANT UPDATE (active, lifted_at, updated_by) ON core.iam_restriction TO cmd_money_owner;
CREATE POLICY cmd_money_debt_restriction_sel ON core.iam_restriction FOR SELECT
  TO cmd_money_owner USING (kind = 'UNPAID_BALANCE');
CREATE POLICY cmd_money_debt_restriction_ins ON core.iam_restriction FOR INSERT
  TO cmd_money_owner
  WITH CHECK (kind = 'UNPAID_BALANCE' AND active AND source_ref LIKE 'debt:%'
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
CREATE POLICY cmd_money_debt_restriction_upd ON core.iam_restriction FOR UPDATE
  TO cmd_money_owner
  USING (kind = 'UNPAID_BALANCE' AND source_ref LIKE 'debt:%'
         AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (kind = 'UNPAID_BALANCE' AND NOT active AND source_ref LIKE 'debt:%'
              AND app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

-- 2. Tables ---------------------------------------------------------------------------------------

-- 2.1 Carte enregistrée : jeton du PSP, jamais un PAN (17 §1.6, §3.2.7)
CREATE TABLE core.payment_payment_instrument (
  id             uuid        PRIMARY KEY,
  user_id        uuid        NOT NULL
    CONSTRAINT payment_instrument_user_fk REFERENCES core.iam_user_account (id),
  psp_account_id uuid        NOT NULL
    CONSTRAINT payment_instrument_account_fk REFERENCES core.payment_psp_account (id),
  country_code   text        NOT NULL
    CONSTRAINT payment_instrument_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- [C4] référence opaque du coffre du PSP ; format borné, aucun PAN (détecteur de 0029 / 0131)
  token_ref      text        NOT NULL
    CONSTRAINT payment_instrument_token_format CHECK (token_ref ~ '^[A-Za-z0-9_.:-]{8,128}$')
    CONSTRAINT payment_instrument_token_no_pan CHECK (NOT core.payment_text_has_pan(token_ref)),
  network        text        NOT NULL
    CONSTRAINT payment_instrument_network_valid CHECK (network IN ('VISA', 'MASTERCARD', 'AMEX')),
  funding        text        NOT NULL
    CONSTRAINT payment_instrument_funding_valid CHECK (funding IN ('CREDIT', 'DEBIT', 'PREPAID')),
  last4          text        NOT NULL
    CONSTRAINT payment_instrument_last4_format CHECK (last4 ~ '^[0-9]{4}$'),
  exp_month      smallint    NOT NULL
    CONSTRAINT payment_instrument_exp_month_valid CHECK (exp_month BETWEEN 1 AND 12),
  exp_year       smallint    NOT NULL
    CONSTRAINT payment_instrument_exp_year_valid CHECK (exp_year BETWEEN 2000 AND 2200),
  status         text        NOT NULL DEFAULT 'ACTIVE'
    CONSTRAINT payment_instrument_status_valid CHECK (status IN ('ACTIVE', 'REPLACED', 'REVOKED')),
  replaced_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT platform.now(),
  updated_at     timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT payment_instrument_token_unique UNIQUE (psp_account_id, token_ref),
  CONSTRAINT payment_instrument_replaced_shape CHECK ((status = 'ACTIVE') = (replaced_at IS NULL))
);
CREATE UNIQUE INDEX payment_instrument_one_active_idx
  ON core.payment_payment_instrument (user_id, psp_account_id) WHERE (status = 'ACTIVE');
COMMENT ON TABLE core.payment_payment_instrument IS
  'PAY payment_instrument (17 §3.2.7) : carte enregistrée, jeton du PSP seulement (jamais un PAN), '
  'marque, 4 derniers chiffres, échéance. Écrite par core.payment_cmd_record_instrument. US-703 '
  '(ADR-189).';

-- 2.2 Consentement MIT (checkout, S05) ; lié une fois à la carte du paiement prouvé
CREATE TABLE core.payment_mit_consent (
  id                   uuid        PRIMARY KEY,
  user_id              uuid        NOT NULL
    CONSTRAINT mit_consent_user_fk REFERENCES core.iam_user_account (id),
  hold_id              uuid
    CONSTRAINT mit_consent_hold_fk REFERENCES core.booking_checkout_hold (id)
    CONSTRAINT mit_consent_hold_unique UNIQUE,
  trip_id              uuid
    CONSTRAINT mit_consent_trip_fk REFERENCES core.booking_trip (id)
    CONSTRAINT mit_consent_trip_unique UNIQUE,
  instrument_id        uuid
    CONSTRAINT mit_consent_instrument_fk REFERENCES core.payment_payment_instrument (id),
  scopes               text[]      NOT NULL
    CONSTRAINT mit_consent_scopes_valid CHECK (
      pg_catalog.cardinality(scopes) > 0
      AND scopes <@ ARRAY['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION']),
  -- texte accepté : clé du catalogue et version, langue d'affichage (DEC-FONDATEUR-17)
  consent_key          text        NOT NULL
    CONSTRAINT mit_consent_key_format CHECK (consent_key ~ '^[a-z][A-Za-z0-9.]{2,80}$'),
  catalog_version      integer     NOT NULL
    CONSTRAINT mit_consent_catalog_version_positive CHECK (catalog_version >= 1),
  locale               text        NOT NULL
    CONSTRAINT mit_consent_locale_format CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  accepted_at          timestamptz NOT NULL DEFAULT platform.now(),
  bound_at             timestamptz,
  -- références de réseau de la transaction initiale (CIT), rendues par le PSP (17 §3.2.7)
  network_tx_reference text
    CONSTRAINT mit_consent_network_ref_format CHECK (
      network_tx_reference IS NULL OR network_tx_reference ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  transaction_link_id  text
    CONSTRAINT mit_consent_link_format CHECK (
      transaction_link_id IS NULL OR transaction_link_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  CONSTRAINT mit_consent_subject CHECK (hold_id IS NOT NULL OR trip_id IS NOT NULL),
  CONSTRAINT mit_consent_bound_shape CHECK ((instrument_id IS NULL) = (bound_at IS NULL))
);
COMMENT ON TABLE core.payment_mit_consent IS
  'PAY mit_consent (17 §3.2.7) : consentement explicite aux débits ultérieurs (MIT) donné au '
  'checkout (web.s05.mitConsent), lié une fois à la carte du paiement prouvé, immuable ensuite. '
  'US-703 (ADR-189).';

-- 2.3 Rappel du consentement à la remise (US-315, S09)
CREATE TABLE core.payment_mit_consent_reminder (
  trip_id         uuid        PRIMARY KEY
    CONSTRAINT mit_reminder_trip_fk REFERENCES core.booking_trip (id),
  consent_id      uuid        NOT NULL
    CONSTRAINT mit_reminder_consent_fk REFERENCES core.payment_mit_consent (id),
  user_id         uuid        NOT NULL
    CONSTRAINT mit_reminder_user_fk REFERENCES core.iam_user_account (id),
  catalog_version integer     NOT NULL
    CONSTRAINT mit_reminder_catalog_version_positive CHECK (catalog_version >= 1),
  locale          text        NOT NULL
    CONSTRAINT mit_reminder_locale_format CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  acknowledged_at timestamptz NOT NULL DEFAULT platform.now()
);
COMMENT ON TABLE core.payment_mit_consent_reminder IS
  'PAY : rappel du consentement MIT lu et confirmé par le voyageur à la remise (16 PAY-037 '
  '« consentement écrit au check-in »). Insertion seule. US-703 (ADR-189).';

-- 2.4 Règles des réseaux (pays × réseau × motif), en données, versionnées, insertion seule
CREATE TABLE core.payment_mit_network_rule (
  country_code       text        NOT NULL
    CONSTRAINT mit_rule_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  network            text        NOT NULL
    CONSTRAINT mit_rule_network_valid CHECK (network IN ('VISA', 'MASTERCARD', 'AMEX')),
  reason             text        NOT NULL
    CONSTRAINT mit_rule_reason_valid CHECK (reason IN ('DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE')),
  version            integer     NOT NULL
    CONSTRAINT mit_rule_version_positive CHECK (version >= 1),
  -- préavis d'objection depuis la notification ; NULL : accord écrit du voyageur exigé
  notice_hours       integer
    CONSTRAINT mit_rule_notice_valid CHECK (notice_hours IS NULL OR notice_hours BETWEEN 0 AND 8760),
  -- délai maximal du débit ; NULL : inconnu, aucun débit (OQ-BR-43, OQ-PAY-18)
  deadline_days      integer
    CONSTRAINT mit_rule_deadline_valid CHECK (deadline_days IS NULL OR deadline_days BETWEEN 1 AND 730),
  deadline_from      text        NOT NULL
    CONSTRAINT mit_rule_deadline_from_valid CHECK (deadline_from IN ('RETURN', 'NOTICE')),
  -- jours de chaque tentative depuis la première (J0, J+3, J+7) ; nombre = tentatives au plus
  retry_offsets_days integer[]   NOT NULL
    CONSTRAINT mit_rule_offsets_valid CHECK (
      pg_catalog.cardinality(retry_offsets_days) BETWEEN 1 AND 10
      AND retry_offsets_days[1] = 0 AND 0 <= ALL (retry_offsets_days)),
  source_ref         text        NOT NULL
    CONSTRAINT mit_rule_source_present CHECK (source_ref <> ''),
  created_at         timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT payment_mit_network_rule_pkey PRIMARY KEY (country_code, network, reason, version)
);
COMMENT ON TABLE core.payment_mit_network_rule IS
  'PAY : règles des réseaux pour un débit MIT post-trip (08 BR-PAY-09 bis, REQ-PAY-DMG-05, 07, 09 ; '
  'EC-28), par pays, réseau et motif ; la version la plus haute fait foi ; insertion seule. '
  'Valeurs PROPOSÉES, à confirmer par le PSP (OQ-PAY-18). US-703 (ADR-189).';

-- 2.5 Débit post-trip (16 PAY-015 « post_trip_charge ») : montant et jambes explicites
CREATE TABLE core.payment_post_trip_charge (
  id                        uuid        PRIMARY KEY,
  trip_id                   uuid        NOT NULL
    CONSTRAINT post_trip_charge_trip_fk REFERENCES core.booking_trip (id),
  user_id                   uuid        NOT NULL
    CONSTRAINT post_trip_charge_user_fk REFERENCES core.iam_user_account (id),
  country_code              text        NOT NULL
    CONSTRAINT post_trip_charge_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency                  text        NOT NULL
    CONSTRAINT post_trip_charge_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  purpose                   text        NOT NULL
    CONSTRAINT post_trip_charge_purpose_valid CHECK (purpose IN
      ('RENT_SHORTFALL', 'NO_SHOW_RETENTION', 'INCIDENTAL', 'DAMAGE', 'OTHER_DEBT')),
  reason                    text        NOT NULL
    CONSTRAINT post_trip_charge_reason_valid CHECK (reason IN
      ('DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE')),
  origin_type               text        NOT NULL
    CONSTRAINT post_trip_charge_origin_format CHECK (origin_type ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  origin_id                 uuid        NOT NULL,
  -- version du règlement d'origine (clé `v{n}`, T68) ; NULL : origine hors règlement (`v0-…`)
  settlement_version        integer
    CONSTRAINT post_trip_charge_version_positive CHECK (
      settlement_version IS NULL OR settlement_version >= 1),
  -- moyen débité : opération de carte du loyer (AUTH ou CAPTURE prouvée) ; segment `{moyen}`
  tender_operation_id       uuid        NOT NULL
    CONSTRAINT post_trip_charge_tender_fk REFERENCES core.payment_payment_operation (id),
  psp_account_id            uuid        NOT NULL
    CONSTRAINT post_trip_charge_account_fk REFERENCES core.payment_psp_account (id),
  amount_minor              bigint      NOT NULL
    CONSTRAINT post_trip_charge_amount_positive CHECK (amount_minor > 0),
  leg_host_minor            bigint      NOT NULL CONSTRAINT post_trip_charge_host_nonneg
    CHECK (leg_host_minor >= 0),
  leg_insurer_minor         bigint      NOT NULL CONSTRAINT post_trip_charge_insurer_nonneg
    CHECK (leg_insurer_minor >= 0),
  leg_tax_third_party_minor bigint      NOT NULL CONSTRAINT post_trip_charge_tax_nonneg
    CHECK (leg_tax_third_party_minor >= 0),
  leg_platform_minor        bigint      NOT NULL CONSTRAINT post_trip_charge_platform_nonneg
    CHECK (leg_platform_minor >= 0),
  notified_at               timestamptz NOT NULL DEFAULT platform.now(),
  -- accord écrit du voyageur postérieur au constat (REQ-PAY-DMG-05) ; NULL : aucun
  guest_agreed_at           timestamptz,
  status                    text        NOT NULL DEFAULT 'NOTIFIED'
    CONSTRAINT post_trip_charge_status_valid CHECK (status IN
      ('NOTIFIED', 'CHARGING', 'RETRY_DUE', 'CHARGED', 'UNPAID')),
  next_check_at             timestamptz NOT NULL DEFAULT platform.now(),
  -- réseau de la carte au premier débit tenté ; heure de la première tentative ; rang courant
  network                   text
    CONSTRAINT post_trip_charge_network_valid CHECK (
      network IS NULL OR network IN ('VISA', 'MASTERCARD', 'AMEX')),
  first_attempt_at          timestamptz,
  attempt_no                integer     NOT NULL DEFAULT 0
    CONSTRAINT post_trip_charge_attempt_nonneg CHECK (attempt_no >= 0),
  -- dernier motif rendu par la base (préavis, accord, règle…) ; code, jamais un message
  outcome_code              text
    CONSTRAINT post_trip_charge_outcome_format CHECK (
      outcome_code IS NULL OR outcome_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  leg_reported              boolean     NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT platform.now(),
  updated_at                timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT post_trip_charge_origin_unique UNIQUE (origin_type, origin_id),
  CONSTRAINT post_trip_charge_legs_sum CHECK (
    leg_host_minor + leg_insurer_minor + leg_tax_third_party_minor + leg_platform_minor
      = amount_minor),
  -- un débit de dommage n'est jamais un motif de retenue (BR-PAY-09 bis) et inversement
  CONSTRAINT post_trip_charge_reason_purpose CHECK (
    (reason = 'DAMAGE_SEPARATE') = (purpose = 'DAMAGE')
    AND (reason <> 'NO_SHOW' OR purpose IN ('RENT_SHORTFALL', 'NO_SHOW_RETENTION'))
    AND (reason <> 'DELAYED_CHARGES' OR purpose IN ('INCIDENTAL', 'OTHER_DEBT'))),
  CONSTRAINT post_trip_charge_attempt_shape CHECK (
    (attempt_no = 0) = (first_attempt_at IS NULL) AND (attempt_no = 0) = (network IS NULL))
);
CREATE INDEX post_trip_charge_due_idx ON core.payment_post_trip_charge (next_check_at)
  WHERE (status IN ('NOTIFIED', 'CHARGING', 'RETRY_DUE') OR NOT leg_reported);
CREATE INDEX post_trip_charge_trip_idx ON core.payment_post_trip_charge (trip_id);
COMMENT ON TABLE core.payment_post_trip_charge IS
  'PAY : débit post-trip décidé (frais de retard, frais annexe, dommage, retenue non encaissée), '
  'notifié à notified_at, débité par MIT (une instance, tentatives planifiées par la base) ou '
  'mis en dette. Montant et jambes explicites. US-703 (ADR-189).';

-- 2.6 Tentatives (`attempt_no` de 08 E4) : une ligne par tentative, avant l'ordre
CREATE TABLE core.payment_post_trip_charge_attempt (
  charge_id     uuid        NOT NULL
    CONSTRAINT post_trip_attempt_charge_fk REFERENCES core.payment_post_trip_charge (id),
  attempt_no    integer     NOT NULL
    CONSTRAINT post_trip_attempt_no_positive CHECK (attempt_no >= 1),
  idem_plain    text        NOT NULL
    CONSTRAINT post_trip_attempt_idem_unique UNIQUE,
  idem_sent     text        NOT NULL
    CONSTRAINT post_trip_attempt_idem_sent_format CHECK (idem_sent ~ '^[0-9a-f]{64}$'),
  amount_minor  bigint      NOT NULL
    CONSTRAINT post_trip_attempt_amount_positive CHECK (amount_minor > 0),
  operation_id  uuid
    CONSTRAINT post_trip_attempt_operation_fk REFERENCES core.payment_payment_operation (id)
    CONSTRAINT post_trip_attempt_operation_unique UNIQUE,
  planned_at    timestamptz NOT NULL DEFAULT platform.now(),
  -- issue reportée sur le débit (SUCCEEDED, FAILED) ; refus « ne pas réessayer » du réseau
  settled       text
    CONSTRAINT post_trip_attempt_settled_valid CHECK (settled IS NULL OR settled IN ('SUCCEEDED', 'FAILED')),
  do_not_retry  boolean,
  CONSTRAINT payment_post_trip_charge_attempt_pkey PRIMARY KEY (charge_id, attempt_no)
);
COMMENT ON TABLE core.payment_post_trip_charge_attempt IS
  'PAY : tentative d''un débit post-trip (08 E4 attempt_no : + 1 après un refus reçu seulement ; '
  'une seule instance MIT_CHARGE i1, T68) ; l''ordre MIT_CHARGE n''existe que pour elle. US-703.';

-- 2.7 Dette du voyageur (17 §3.2.7 debt_balance) : jambes dues et encaissées
CREATE TABLE core.payment_debt_balance (
  id                          uuid        PRIMARY KEY,
  user_id                     uuid        NOT NULL
    CONSTRAINT debt_balance_user_fk REFERENCES core.iam_user_account (id),
  trip_id                     uuid        NOT NULL
    CONSTRAINT debt_balance_trip_fk REFERENCES core.booking_trip (id),
  charge_id                   uuid        NOT NULL
    CONSTRAINT debt_balance_charge_fk REFERENCES core.payment_post_trip_charge (id)
    CONSTRAINT debt_balance_charge_unique UNIQUE,
  country_code                text        NOT NULL
    CONSTRAINT debt_balance_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency                    text        NOT NULL
    CONSTRAINT debt_balance_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  origin_type                 text        NOT NULL DEFAULT 'POST_TRIP_CHARGE'
    CONSTRAINT debt_balance_origin_valid CHECK (origin_type = 'POST_TRIP_CHARGE'),
  opened_reason               text        NOT NULL
    CONSTRAINT debt_balance_reason_format CHECK (opened_reason ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  amount_minor                bigint      NOT NULL
    CONSTRAINT debt_balance_amount_positive CHECK (amount_minor > 0),
  due_host_minor              bigint      NOT NULL CHECK (due_host_minor >= 0),
  due_insurer_minor           bigint      NOT NULL CHECK (due_insurer_minor >= 0),
  due_tax_third_party_minor   bigint      NOT NULL CHECK (due_tax_third_party_minor >= 0),
  due_platform_minor          bigint      NOT NULL CHECK (due_platform_minor >= 0),
  paid_host_minor             bigint      NOT NULL DEFAULT 0,
  paid_insurer_minor          bigint      NOT NULL DEFAULT 0,
  paid_tax_third_party_minor  bigint      NOT NULL DEFAULT 0,
  paid_platform_minor         bigint      NOT NULL DEFAULT 0,
  collection_seq              integer     NOT NULL DEFAULT 0
    CONSTRAINT debt_balance_seq_nonneg CHECK (collection_seq >= 0),
  rule_version                text        NOT NULL DEFAULT 'E7R4-US056'
    CONSTRAINT debt_balance_rule_valid CHECK (rule_version = 'E7R4-US056'),
  status                      text        NOT NULL DEFAULT 'OPEN'
    CONSTRAINT debt_balance_status_valid CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID')),
  created_at                  timestamptz NOT NULL DEFAULT platform.now(),
  updated_at                  timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT debt_balance_due_sum CHECK (
    due_host_minor + due_insurer_minor + due_tax_third_party_minor + due_platform_minor
      = amount_minor),
  -- jamais une jambe encaissée au-delà de son dû, jamais négative (08 E7 règles 4 et 5)
  CONSTRAINT debt_balance_paid_bounds CHECK (
    paid_host_minor BETWEEN 0 AND due_host_minor
    AND paid_insurer_minor BETWEEN 0 AND due_insurer_minor
    AND paid_tax_third_party_minor BETWEEN 0 AND due_tax_third_party_minor
    AND paid_platform_minor BETWEEN 0 AND due_platform_minor),
  CONSTRAINT debt_balance_status_shape CHECK (
    (status = 'PAID') = (paid_host_minor + paid_insurer_minor + paid_tax_third_party_minor
                         + paid_platform_minor = amount_minor)
    AND (status = 'OPEN') = (paid_host_minor + paid_insurer_minor + paid_tax_third_party_minor
                             + paid_platform_minor = 0))
);
CREATE INDEX debt_balance_user_idx ON core.payment_debt_balance (user_id) WHERE (status <> 'PAID');
COMMENT ON TABLE core.payment_debt_balance IS
  'PAY debt_balance (17 §3.2.7) : dette du voyageur née d''un débit post-trip non débité, jambes '
  'dues et encaissées (08 E7 règle 4) ; ouverte ⇒ restriction UNPAID_BALANCE. US-703 (ADR-189).';

-- 2.8 Encaissements d'une dette (instance_seq + 1 par paiement volontaire, 08 E4)
CREATE TABLE core.payment_debt_collection (
  id                        uuid        PRIMARY KEY,
  debt_id                   uuid        NOT NULL
    CONSTRAINT debt_collection_debt_fk REFERENCES core.payment_debt_balance (id),
  seq                       integer     NOT NULL
    CONSTRAINT debt_collection_seq_positive CHECK (seq >= 1),
  amount_minor              bigint      NOT NULL
    CONSTRAINT debt_collection_amount_positive CHECK (amount_minor > 0),
  leg_host_minor            bigint      NOT NULL CHECK (leg_host_minor >= 0),
  leg_insurer_minor         bigint      NOT NULL CHECK (leg_insurer_minor >= 0),
  leg_tax_third_party_minor bigint      NOT NULL CHECK (leg_tax_third_party_minor >= 0),
  leg_platform_minor        bigint      NOT NULL CHECK (leg_platform_minor >= 0),
  rule_version              text        NOT NULL
    CONSTRAINT debt_collection_rule_valid CHECK (rule_version = 'E7R4-US056'),
  idem_plain                text        NOT NULL
    CONSTRAINT debt_collection_idem_unique UNIQUE,
  idem_sent                 text        NOT NULL
    CONSTRAINT debt_collection_idem_sent_format CHECK (idem_sent ~ '^[0-9a-f]{64}$'),
  operation_id              uuid
    CONSTRAINT debt_collection_operation_fk REFERENCES core.payment_payment_operation (id)
    CONSTRAINT debt_collection_operation_unique UNIQUE,
  status                    text        NOT NULL DEFAULT 'PLANNED'
    CONSTRAINT debt_collection_status_valid CHECK (status IN ('PLANNED', 'COLLECTED', 'FAILED')),
  created_at                timestamptz NOT NULL DEFAULT platform.now(),
  settled_at                timestamptz,
  CONSTRAINT debt_collection_seq_unique UNIQUE (debt_id, seq),
  CONSTRAINT debt_collection_legs_sum CHECK (
    leg_host_minor + leg_insurer_minor + leg_tax_third_party_minor + leg_platform_minor
      = amount_minor),
  CONSTRAINT debt_collection_settled_shape CHECK ((status = 'PLANNED') = (settled_at IS NULL))
);
CREATE UNIQUE INDEX debt_collection_one_planned_idx ON core.payment_debt_collection (debt_id)
  WHERE (status = 'PLANNED');
COMMENT ON TABLE core.payment_debt_collection IS
  'PAY : encaissement d''une dette, jambes de 08 E7 règle 4 (core.payment_partial_collection_legs) '
  'et ordre DEBT_COLLECTION ; un seul encaissement planifié à la fois. US-703 (ADR-189).';

-- 3. Gardes (insertion seule, immuabilité, transitions) -----------------------------------------
-- Fonctions de garde : SECURITY INVOKER, aucun EXECUTE (les triggers s'exécutent quand même) ;
-- propriétaire cmd_money_owner (fin de fichier).

CREATE FUNCTION core.payment_mit_append_only()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'payment: % is append-only', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_record_immutable';
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_mit_append_only() FROM PUBLIC;

CREATE TRIGGER mit_rule_append_only BEFORE UPDATE OR DELETE ON core.payment_mit_network_rule
  FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_rule_no_truncate BEFORE TRUNCATE ON core.payment_mit_network_rule
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_reminder_append_only BEFORE UPDATE OR DELETE ON core.payment_mit_consent_reminder
  FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_reminder_no_truncate BEFORE TRUNCATE ON core.payment_mit_consent_reminder
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_consent_no_delete BEFORE DELETE ON core.payment_mit_consent
  FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_consent_no_truncate BEFORE TRUNCATE ON core.payment_mit_consent
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_instrument_no_delete BEFORE DELETE ON core.payment_payment_instrument
  FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_instrument_no_truncate BEFORE TRUNCATE ON core.payment_payment_instrument
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_charge_no_delete BEFORE DELETE ON core.payment_post_trip_charge
  FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_charge_no_truncate BEFORE TRUNCATE ON core.payment_post_trip_charge
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_attempt_no_delete BEFORE DELETE ON core.payment_post_trip_charge_attempt
  FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_attempt_no_truncate BEFORE TRUNCATE ON core.payment_post_trip_charge_attempt
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_debt_no_delete BEFORE DELETE ON core.payment_debt_balance
  FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_debt_no_truncate BEFORE TRUNCATE ON core.payment_debt_balance
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_collection_no_delete BEFORE DELETE ON core.payment_debt_collection
  FOR EACH ROW EXECUTE FUNCTION core.payment_mit_append_only();
CREATE TRIGGER mit_collection_no_truncate BEFORE TRUNCATE ON core.payment_debt_collection
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_mit_append_only();

-- 3.1 Carte : seul le statut passe d'ACTIVE à REPLACED / REVOKED (avec son heure)
CREATE FUNCTION core.payment_instrument_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.psp_account_id, NEW.country_code, NEW.token_ref, NEW.network,
      NEW.funding, NEW.last4, NEW.exp_month, NEW.exp_year, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.psp_account_id, OLD.country_code, OLD.token_ref, OLD.network,
      OLD.funding, OLD.last4, OLD.exp_month, OLD.exp_year, OLD.created_at)
     OR NOT ((OLD.status = 'ACTIVE' AND NEW.status IN ('REPLACED', 'REVOKED'))
             OR (OLD.status = 'REPLACED' AND NEW.status = 'ACTIVE' AND NEW.replaced_at IS NULL))
  THEN
    RAISE EXCEPTION 'payment: instrument is immutable except its retirement or its reuse'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_instrument_immutable';
  END IF;
  NEW.updated_at := platform.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_instrument_guard() FROM PUBLIC;
CREATE TRIGGER mit_instrument_guard BEFORE UPDATE ON core.payment_payment_instrument
  FOR EACH ROW EXECUTE FUNCTION core.payment_instrument_guard();

-- 3.2 Consentement : immuable, sauf la liaison unique à la carte (et au trip né du hold)
CREATE FUNCTION core.payment_mit_consent_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.hold_id, NEW.scopes, NEW.consent_key, NEW.catalog_version,
      NEW.locale, NEW.accepted_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.hold_id, OLD.scopes, OLD.consent_key, OLD.catalog_version,
      OLD.locale, OLD.accepted_at)
     OR (OLD.trip_id IS NOT NULL AND NEW.trip_id IS DISTINCT FROM OLD.trip_id)
     OR (OLD.instrument_id IS NOT NULL
         AND (NEW.instrument_id, NEW.bound_at, NEW.network_tx_reference, NEW.transaction_link_id)
             IS DISTINCT FROM
             (OLD.instrument_id, OLD.bound_at, OLD.network_tx_reference, OLD.transaction_link_id))
     OR (OLD.instrument_id IS NULL AND NEW.instrument_id IS NULL
         AND (NEW.network_tx_reference, NEW.transaction_link_id)
             IS DISTINCT FROM (OLD.network_tx_reference, OLD.transaction_link_id)) THEN
    RAISE EXCEPTION 'payment: MIT consent is immutable once bound'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_consent_immutable';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_mit_consent_guard() FROM PUBLIC;
CREATE TRIGGER mit_consent_guard BEFORE UPDATE ON core.payment_mit_consent
  FOR EACH ROW EXECUTE FUNCTION core.payment_mit_consent_guard();

-- 3.3 Débit : montants, jambes et origine immuables ; transitions de la liste
CREATE FUNCTION core.payment_post_trip_charge_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF (NEW.id, NEW.trip_id, NEW.user_id, NEW.country_code, NEW.currency, NEW.purpose, NEW.reason,
      NEW.origin_type, NEW.origin_id, NEW.settlement_version, NEW.tender_operation_id,
      NEW.psp_account_id, NEW.amount_minor, NEW.leg_host_minor, NEW.leg_insurer_minor,
      NEW.leg_tax_third_party_minor, NEW.leg_platform_minor, NEW.notified_at, NEW.guest_agreed_at,
      NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.trip_id, OLD.user_id, OLD.country_code, OLD.currency, OLD.purpose, OLD.reason,
      OLD.origin_type, OLD.origin_id, OLD.settlement_version, OLD.tender_operation_id,
      OLD.psp_account_id, OLD.amount_minor, OLD.leg_host_minor, OLD.leg_insurer_minor,
      OLD.leg_tax_third_party_minor, OLD.leg_platform_minor, OLD.notified_at, OLD.guest_agreed_at,
      OLD.created_at)
     OR (OLD.first_attempt_at IS NOT NULL
         AND NEW.first_attempt_at IS DISTINCT FROM OLD.first_attempt_at)
     OR (OLD.network IS NOT NULL AND NEW.network IS DISTINCT FROM OLD.network)
     OR NEW.attempt_no < OLD.attempt_no
     OR (OLD.leg_reported AND NOT NEW.leg_reported) THEN
    RAISE EXCEPTION 'payment: post-trip charge amounts, legs and origin are immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_charge_immutable';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status, NEW.status) IN (('NOTIFIED', 'CHARGING'), ('NOTIFIED', 'UNPAID'),
                                           ('CHARGING', 'CHARGED'), ('CHARGING', 'RETRY_DUE'),
                                           ('CHARGING', 'UNPAID'), ('RETRY_DUE', 'CHARGING'),
                                           ('RETRY_DUE', 'UNPAID'))) THEN
    RAISE EXCEPTION 'payment: post-trip charge % → % is not a transition', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_charge_transition';
  END IF;
  NEW.updated_at := platform.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_post_trip_charge_guard() FROM PUBLIC;
CREATE TRIGGER mit_charge_guard BEFORE UPDATE ON core.payment_post_trip_charge
  FOR EACH ROW EXECUTE FUNCTION core.payment_post_trip_charge_guard();

-- 3.4 Tentative : immuable, sauf le rattachement unique de l'ordre et l'issue reportée
CREATE FUNCTION core.payment_post_trip_attempt_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF (NEW.charge_id, NEW.attempt_no, NEW.idem_plain, NEW.idem_sent, NEW.amount_minor,
      NEW.planned_at)
     IS DISTINCT FROM
     (OLD.charge_id, OLD.attempt_no, OLD.idem_plain, OLD.idem_sent, OLD.amount_minor,
      OLD.planned_at)
     OR (OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id)
     OR (OLD.settled IS NOT NULL
         AND (NEW.settled, NEW.do_not_retry) IS DISTINCT FROM (OLD.settled, OLD.do_not_retry)) THEN
    RAISE EXCEPTION 'payment: post-trip charge attempt is immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_attempt_immutable';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_post_trip_attempt_guard() FROM PUBLIC;
CREATE TRIGGER mit_attempt_guard BEFORE UPDATE ON core.payment_post_trip_charge_attempt
  FOR EACH ROW EXECUTE FUNCTION core.payment_post_trip_attempt_guard();

-- 3.5 Dette : jambes dues immuables ; encaissé croissant ; transitions OPEN → PARTIALLY_PAID → PAID
CREATE FUNCTION core.payment_debt_balance_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF (NEW.id, NEW.user_id, NEW.trip_id, NEW.charge_id, NEW.country_code, NEW.currency,
      NEW.origin_type, NEW.opened_reason, NEW.amount_minor, NEW.due_host_minor,
      NEW.due_insurer_minor, NEW.due_tax_third_party_minor, NEW.due_platform_minor,
      NEW.rule_version, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.user_id, OLD.trip_id, OLD.charge_id, OLD.country_code, OLD.currency,
      OLD.origin_type, OLD.opened_reason, OLD.amount_minor, OLD.due_host_minor,
      OLD.due_insurer_minor, OLD.due_tax_third_party_minor, OLD.due_platform_minor,
      OLD.rule_version, OLD.created_at)
     OR NEW.paid_host_minor < OLD.paid_host_minor
     OR NEW.paid_insurer_minor < OLD.paid_insurer_minor
     OR NEW.paid_tax_third_party_minor < OLD.paid_tax_third_party_minor
     OR NEW.paid_platform_minor < OLD.paid_platform_minor
     OR NEW.collection_seq < OLD.collection_seq THEN
    RAISE EXCEPTION 'payment: debt amounts are immutable, collections only grow'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_debt_immutable';
  END IF;
  IF OLD.status = 'PAID' AND NEW.status IS DISTINCT FROM 'PAID' THEN
    RAISE EXCEPTION 'payment: a paid debt stays paid'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'debt_transition';
  END IF;
  NEW.updated_at := platform.now();
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_debt_balance_guard() FROM PUBLIC;
CREATE TRIGGER mit_debt_guard BEFORE UPDATE ON core.payment_debt_balance
  FOR EACH ROW EXECUTE FUNCTION core.payment_debt_balance_guard();

-- 3.6 Encaissement : immuable, sauf le rattachement de l'ordre et l'issue (une fois)
CREATE FUNCTION core.payment_debt_collection_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF (NEW.id, NEW.debt_id, NEW.seq, NEW.amount_minor, NEW.leg_host_minor, NEW.leg_insurer_minor,
      NEW.leg_tax_third_party_minor, NEW.leg_platform_minor, NEW.rule_version, NEW.idem_plain,
      NEW.idem_sent, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.debt_id, OLD.seq, OLD.amount_minor, OLD.leg_host_minor, OLD.leg_insurer_minor,
      OLD.leg_tax_third_party_minor, OLD.leg_platform_minor, OLD.rule_version, OLD.idem_plain,
      OLD.idem_sent, OLD.created_at)
     OR (OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id)
     OR (OLD.status <> 'PLANNED' AND (NEW.status, NEW.settled_at) IS DISTINCT FROM
                                     (OLD.status, OLD.settled_at)) THEN
    RAISE EXCEPTION 'payment: debt collection is immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_collection_immutable';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_debt_collection_guard() FROM PUBLIC;
CREATE TRIGGER mit_collection_guard BEFORE UPDATE ON core.payment_debt_collection
  FOR EACH ROW EXECUTE FUNCTION core.payment_debt_collection_guard();

-- 3.7 Un ordre MIT_CHARGE / DEBT_COLLECTION n'existe que pour une tentative ou un encaissement
-- planifié ici (même clé, même montant, aucun ordre encore rattaché) : aucun débit hors de ce
-- chemin, par aucun rôle (L3-PM-21, L3-PM-22). SECURITY DEFINER sous cmd_money_owner, aucun
-- EXECUTE (comme le gel de 0155 et la garde des lots de 0165) : d'autres propriétaires
-- enregistrent des opérations avec des droits restreints sur ces tables.
CREATE FUNCTION core.payment_operation_mit_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.kind = 'MIT_CHARGE' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM core.payment_post_trip_charge_attempt AS a
        JOIN core.payment_post_trip_charge AS c ON c.id = a.charge_id
       WHERE a.idem_plain = NEW.idem_plain AND a.idem_sent = NEW.idem_sent
         AND a.operation_id IS NULL AND a.amount_minor = NEW.amount_minor
         AND a.attempt_no = NEW.attempt_no
         AND c.trip_id IS NOT DISTINCT FROM NEW.trip_id AND c.purpose = NEW.purpose
         AND c.currency = NEW.currency AND c.psp_account_id = NEW.psp_account_id
         AND c.status IN ('NOTIFIED', 'RETRY_DUE')) THEN
      RAISE EXCEPTION 'payment: MIT_CHARGE outside a planned post-trip charge attempt'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_operation_unplanned';
    END IF;
  ELSIF NEW.kind = 'DEBT_COLLECTION' THEN
    IF NOT EXISTS (
      SELECT 1
        FROM core.payment_debt_collection AS k
        JOIN core.payment_debt_balance AS d ON d.id = k.debt_id
       WHERE k.idem_plain = NEW.idem_plain AND k.idem_sent = NEW.idem_sent
         AND k.operation_id IS NULL AND k.status = 'PLANNED'
         AND k.amount_minor = NEW.amount_minor AND d.trip_id IS NOT DISTINCT FROM NEW.trip_id
         AND d.currency = NEW.currency) THEN
      RAISE EXCEPTION 'payment: DEBT_COLLECTION outside a planned debt collection'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_operation_unplanned';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_operation_mit_guard() FROM PUBLIC;
CREATE TRIGGER payment_operation_mit_guard BEFORE INSERT ON core.payment_payment_operation
  FOR EACH ROW WHEN (NEW.kind IN ('MIT_CHARGE', 'DEBT_COLLECTION'))
  EXECUTE FUNCTION core.payment_operation_mit_guard();

-- 4. RLS : aucun droit applicatif ; commandes de cmd_money_owner -----------------------------------
ALTER TABLE core.payment_payment_instrument ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_payment_instrument FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payment_mit_consent ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_mit_consent FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payment_mit_consent_reminder ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_mit_consent_reminder FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payment_mit_network_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_mit_network_rule FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payment_post_trip_charge ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_post_trip_charge FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payment_post_trip_charge_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_post_trip_charge_attempt FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payment_debt_balance ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_debt_balance FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payment_debt_collection ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_debt_collection FORCE ROW LEVEL SECURITY;

CREATE POLICY migrator_all ON core.payment_payment_instrument TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.payment_mit_consent TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.payment_mit_consent_reminder TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.payment_mit_network_rule TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.payment_post_trip_charge TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.payment_post_trip_charge_attempt TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.payment_debt_balance TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.payment_debt_collection TO migrator USING (true)
  WITH CHECK (true);

REVOKE ALL ON core.payment_payment_instrument, core.payment_mit_consent,
  core.payment_mit_consent_reminder, core.payment_mit_network_rule, core.payment_post_trip_charge,
  core.payment_post_trip_charge_attempt, core.payment_debt_balance, core.payment_debt_collection
  FROM PUBLIC;

GRANT SELECT ON core.payment_payment_instrument, core.payment_mit_consent,
  core.payment_mit_consent_reminder, core.payment_mit_network_rule, core.payment_post_trip_charge,
  core.payment_post_trip_charge_attempt, core.payment_debt_balance, core.payment_debt_collection
  TO cmd_money_owner;
GRANT INSERT ON core.payment_payment_instrument, core.payment_mit_consent,
  core.payment_mit_consent_reminder, core.payment_post_trip_charge,
  core.payment_post_trip_charge_attempt, core.payment_debt_balance, core.payment_debt_collection
  TO cmd_money_owner;
GRANT UPDATE (status, replaced_at, updated_at) ON core.payment_payment_instrument
  TO cmd_money_owner;
GRANT UPDATE (trip_id, instrument_id, bound_at, network_tx_reference, transaction_link_id)
  ON core.payment_mit_consent TO cmd_money_owner;
GRANT UPDATE (status, next_check_at, network, first_attempt_at, attempt_no, outcome_code,
  leg_reported, updated_at) ON core.payment_post_trip_charge TO cmd_money_owner;
GRANT UPDATE (operation_id, settled, do_not_retry) ON core.payment_post_trip_charge_attempt
  TO cmd_money_owner;
GRANT UPDATE (paid_host_minor, paid_insurer_minor, paid_tax_third_party_minor,
  paid_platform_minor, collection_seq, status, updated_at) ON core.payment_debt_balance
  TO cmd_money_owner;
GRANT UPDATE (operation_id, status, settled_at) ON core.payment_debt_collection TO cmd_money_owner;

CREATE POLICY cmd_money_sel ON core.payment_payment_instrument FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_sel ON core.payment_mit_consent FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.payment_mit_consent_reminder FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_sel ON core.payment_mit_network_rule FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_sel ON core.payment_post_trip_charge FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_sel ON core.payment_post_trip_charge_attempt FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_sel ON core.payment_debt_balance FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.payment_debt_collection FOR SELECT TO cmd_money_owner
  USING (true);
-- écritures du travailleur payment_command
CREATE POLICY cmd_money_ins ON core.payment_payment_instrument FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND status = 'ACTIVE');
CREATE POLICY cmd_money_upd ON core.payment_payment_instrument FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
CREATE POLICY cmd_money_upd ON core.payment_mit_consent FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
CREATE POLICY cmd_money_ins ON core.payment_post_trip_charge FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND status = 'NOTIFIED' AND attempt_no = 0 AND NOT leg_reported);
CREATE POLICY cmd_money_upd ON core.payment_post_trip_charge FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
CREATE POLICY cmd_money_ins ON core.payment_post_trip_charge_attempt FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND operation_id IS NULL AND settled IS NULL);
CREATE POLICY cmd_money_upd ON core.payment_post_trip_charge_attempt FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
CREATE POLICY cmd_money_ins ON core.payment_debt_balance FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND status = 'OPEN');
CREATE POLICY cmd_money_upd ON core.payment_debt_balance FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
CREATE POLICY cmd_money_ins ON core.payment_debt_collection FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND status = 'PLANNED' AND operation_id IS NULL);
CREATE POLICY cmd_money_upd ON core.payment_debt_collection FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
-- écritures du voyageur (contexte GUEST posé par la commande APRÈS la vérification de sa session,
-- comme les commandes de la remise de 0163)
CREATE POLICY cmd_money_guest_ins ON core.payment_mit_consent FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'GUEST' AND instrument_id IS NULL AND trip_id IS NULL);
CREATE POLICY cmd_money_guest_ins ON core.payment_mit_consent_reminder FOR INSERT
  TO cmd_money_owner WITH CHECK (app.actor_kind() = 'GUEST');

-- 5. Règles des réseaux : graine PROPOSÉE pour chaque pays déclaré (aucun code de pays écrit) ------
-- Dommage (REQ-PAY-DMG-05, 07) : Visa, préavis d'objection de 20 j (480 h) à défaut d'accord ;
-- Mastercard et Amex, accord écrit exigé (NULL) ; délai 30 j (Mastercard) ou 90 j depuis le
-- retour. Frais annexes (BR-REIMB-02 / 03 [NOUS] 72 h ; REQ-PAY-DMG-09) : 72 h depuis la
-- notification ; Visa et Amex 90 j depuis le retour, Mastercard 30 j depuis la notification.
-- Retenue d'une annulation (NO_SHOW, T29) : délai non documenté par 08 ⇒ NULL, aucun débit (OQ-BR-43,
-- OQ-PAY-18) ; la retenue part en dette. Tentatives J0, J+3, J+7 (EC-28 [NOUS]).
INSERT INTO core.payment_mit_network_rule
       (country_code, network, reason, version, notice_hours, deadline_days, deadline_from,
        retry_offsets_days, source_ref)
SELECT c.code::text, r.network, r.reason, 1, r.notice_hours, r.deadline_days, r.deadline_from,
       ARRAY[0, 3, 7], r.source_ref
  FROM core.config_country AS c
 CROSS JOIN (VALUES
   ('VISA', 'DAMAGE_SEPARATE', 480, 90, 'RETURN', '08 REQ-PAY-DMG-05 (visa_objection_days 20 j), REQ-PAY-DMG-07 ; EC-28'),
   ('MASTERCARD', 'DAMAGE_SEPARATE', NULL::integer, 30, 'RETURN', '08 REQ-PAY-DMG-05 (accord écrit), REQ-PAY-DMG-07 ; EC-28'),
   ('AMEX', 'DAMAGE_SEPARATE', NULL::integer, 90, 'RETURN', '08 REQ-PAY-DMG-05 (accord écrit), REQ-PAY-DMG-07 ; EC-28'),
   ('VISA', 'DELAYED_CHARGES', 72, 90, 'RETURN', '08 BR-REIMB-02 / 03 (72 h), REQ-PAY-DMG-09 ; EC-28'),
   ('AMEX', 'DELAYED_CHARGES', 72, 90, 'RETURN', '08 BR-REIMB-02 / 03 (72 h), REQ-PAY-DMG-09 ; EC-28'),
   ('MASTERCARD', 'DELAYED_CHARGES', 72, 30, 'NOTICE', '08 BR-REIMB-02 / 03 (72 h), REQ-PAY-DMG-09 ; EC-28'),
   ('VISA', 'NO_SHOW', 0, NULL::integer, 'NOTICE', '08 T29 ; délai inconnu (OQ-BR-43, OQ-PAY-18) : aucun débit'),
   ('MASTERCARD', 'NO_SHOW', 0, NULL::integer, 'NOTICE', '08 T29 ; délai inconnu (OQ-BR-43, OQ-PAY-18) : aucun débit'),
   ('AMEX', 'NO_SHOW', 0, NULL::integer, 'NOTICE', '08 T29 ; délai inconnu (OQ-BR-43, OQ-PAY-18) : aucun débit')
 ) AS r(network, reason, notice_hours, deadline_days, deadline_from, source_ref);

-- 6. Fonctions internes (SECURITY INVOKER, aucun EXECUTE ; propriétaire cmd_money_owner) ---------

-- 6.1 08 E7 règle 4 révisée (US-056) : incréments d'un encaissement `a` d'une dette aux jambes
-- `due` [HOST, INSURER, TAX_THIRD_PARTY, PLATFORM], déjà encaissée de `carried`. Même règle que
-- `partialCollectionLegs` de @rueda/money (version E7R4-US056). NULL si l'entrée est invalide.
CREATE FUNCTION core.payment_partial_collection_legs(p_due bigint[], p_carried bigint[],
                                                     p_amount bigint)
  RETURNS bigint[]
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_owed  numeric := 0;
  v_c     numeric := 0;
  v_rest  numeric;
  v_inc   numeric[] := ARRAY[0, 0, 0, 0];
  v_want  numeric;
  v_take  numeric;
  v_room  numeric;
  i       integer;
  k       integer;
BEGIN
  IF p_due IS NULL OR p_carried IS NULL OR p_amount IS NULL
     OR pg_catalog.array_length(p_due, 1) IS DISTINCT FROM 4
     OR pg_catalog.array_length(p_carried, 1) IS DISTINCT FROM 4 OR p_amount <= 0 THEN
    RETURN NULL;
  END IF;
  FOR i IN 1..4 LOOP
    IF p_due[i] IS NULL OR p_carried[i] IS NULL OR p_due[i] < 0 OR p_carried[i] < 0
       OR p_carried[i] > p_due[i] THEN
      RETURN NULL;
    END IF;
    v_owed := v_owed + p_due[i];
    v_c := v_c + p_carried[i];
  END LOOP;
  IF v_c + p_amount > v_owed THEN
    RETURN NULL;
  END IF;
  v_rest := p_amount;
  -- 1. HOST → INSURER → TAX_THIRD_PARTY à leur cible cumulative ⌊dû × (c + a) / owed⌋
  FOR i IN 1..3 LOOP
    v_want := pg_catalog.div(p_due[i]::numeric * (v_c + p_amount), v_owed) - p_carried[i];
    v_take := GREATEST(0, LEAST(v_want, v_rest));
    v_inc[i] := v_take;
    v_rest := v_rest - v_take;
  END LOOP;
  -- 2. PLATFORM plafonnée à ce qu'il lui reste dû
  v_inc[4] := LEAST(v_rest, p_due[4]::numeric - p_carried[4]);
  v_rest := v_rest - v_inc[4];
  -- 3. excédent : TAX_THIRD_PARTY → INSURER → HOST, dans la limite de leur reste
  FOREACH k IN ARRAY ARRAY[3, 2, 1] LOOP
    v_room := p_due[k]::numeric - p_carried[k] - v_inc[k];
    v_take := LEAST(v_rest, v_room);
    v_inc[k] := v_inc[k] + v_take;
    v_rest := v_rest - v_take;
  END LOOP;
  IF v_rest <> 0 THEN
    RETURN NULL;
  END IF;
  RETURN ARRAY[v_inc[1]::bigint, v_inc[2]::bigint, v_inc[3]::bigint, v_inc[4]::bigint];
END
$fn$;
COMMENT ON FUNCTION core.payment_partial_collection_legs(bigint[], bigint[], bigint) IS
  '08 E7 règle 4 révisée (US-056) : incréments [HOST, INSURER, TAX_THIRD_PARTY, PLATFORM] d''un '
  'encaissement partiel ; jamais négatifs, cumul ≤ dû, solde exact. Version E7R4-US056. US-703.';

-- 6.2 Consentement d'un trip : celui du trip, sinon celui du hold dont il est né
CREATE FUNCTION core.payment_trip_mit_consent(p_trip_id uuid)
  RETURNS SETOF core.payment_mit_consent
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.*
    FROM core.payment_mit_consent AS c
    JOIN core.booking_trip AS t ON t.id = p_trip_id
   WHERE (c.trip_id = t.id OR (t.source_hold_id IS NOT NULL AND c.hold_id = t.source_hold_id))
     AND c.user_id = t.guest_user_id
   ORDER BY (c.trip_id IS NOT NULL) DESC, c.accepted_at
   LIMIT 1
$fn$;

-- 6.3 Règle en vigueur (version la plus haute) pour un pays, un réseau et un motif
CREATE FUNCTION core.payment_mit_rule(p_country text, p_network text, p_reason text)
  RETURNS SETOF core.payment_mit_network_rule
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT r.*
    FROM core.payment_mit_network_rule AS r
   WHERE r.country_code = p_country AND r.network = p_network AND r.reason = p_reason
   ORDER BY r.version DESC
   LIMIT 1
$fn$;

-- 6.4 Ouverture de la dette d'un débit (jambes dues = jambes du débit), restriction UNPAID_BALANCE
-- du voyageur (une par dette, source `debt:{id}`), débit UNPAID. Appelée sous le verrou du trip.
CREATE FUNCTION core.payment_mit_open_debt(p_charge_id uuid, p_reason text)
  RETURNS uuid
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  c      core.payment_post_trip_charge%ROWTYPE;
  v_debt uuid;
BEGIN
  SELECT * INTO c FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id;
  SELECT d.id INTO v_debt FROM core.payment_debt_balance AS d WHERE d.charge_id = p_charge_id;
  IF v_debt IS NULL THEN
    v_debt := pg_catalog.gen_random_uuid();
    INSERT INTO core.payment_debt_balance
           (id, user_id, trip_id, charge_id, country_code, currency, opened_reason, amount_minor,
            due_host_minor, due_insurer_minor, due_tax_third_party_minor, due_platform_minor)
    VALUES (v_debt, c.user_id, c.trip_id, c.id, c.country_code, c.currency, p_reason,
            c.amount_minor, c.leg_host_minor, c.leg_insurer_minor, c.leg_tax_third_party_minor,
            c.leg_platform_minor);
    INSERT INTO core.iam_restriction (id, user_id, kind, active, reason, source_ref)
    VALUES (pg_catalog.gen_random_uuid(), c.user_id, 'UNPAID_BALANCE', true, p_reason,
            'debt:' || v_debt::text);
  END IF;
  IF c.status <> 'UNPAID' THEN
    UPDATE core.payment_post_trip_charge AS x
       SET status = 'UNPAID', outcome_code = p_reason
     WHERE x.id = p_charge_id;
  END IF;
  RETURN v_debt;
END
$fn$;

-- 6.5 Échéance de la tentative n (1-indexée) : première tentative + n-ième décalage
CREATE FUNCTION core.payment_mit_attempt_due(p_first timestamptz, p_offsets integer[], p_n integer)
  RETURNS timestamptz
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT p_first + pg_catalog.make_interval(days => p_offsets[p_n])
$fn$;

-- 7. Commandes (SECURITY DEFINER ; propriétaire cmd_money_owner) ---------------------------------

-- 7.1 Consentement au checkout (S05) par le voyageur du hold : hold vivant (ACTIVE, ou paiement
-- interrompu PAYMENT_IN_FLIGHT) ; quatre portées de 17 ; une fois par hold. Issues : ACCEPTED,
-- ALREADY_ACCEPTED, NOT_FOUND (session, hold d'un autre), HOLD_NOT_PAYABLE, REQUEST_INVALID,
-- PARAM_MISSING (`mit_consent_checkbox_required[pays]` absent ou illisible : fail_mode BLOCK,
-- aucun consentement enregistré, donc aucun paiement ; le site bloque de même, ADR-189 n° 15).
CREATE FUNCTION core.payment_cmd_accept_mit_consent(p_token_hash bytea, p_hold_id uuid,
                                                    p_locale text, p_catalog_version integer)
  RETURNS TABLE (outcome text, consent_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user  uuid;
  h       record;
  v_id    uuid;
  v_mode  text;
  v_kind  text := pg_catalog.current_setting('app.actor_kind', true);
BEGIN
  IF p_token_hash IS NULL OR p_hold_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT x.id, x.guest_user_id, x.status, x.country_code INTO h
    FROM core.booking_checkout_hold AS x WHERE x.id = p_hold_id;
  IF h.id IS NULL OR h.guest_user_id IS DISTINCT FROM v_user THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_locale IS NULL OR p_locale !~ '^[a-z]{2}(-[A-Z]{2})?$'
     OR p_catalog_version IS NULL OR p_catalog_version < 1 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT c.id INTO v_id FROM core.payment_mit_consent AS c WHERE c.hold_id = p_hold_id;
  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_ACCEPTED'::text, v_id;
    RETURN;
  END IF;
  IF h.status NOT IN ('ACTIVE', 'PAYMENT_IN_FLIGHT') THEN
    RETURN QUERY SELECT 'HOLD_NOT_PAYABLE'::text, NULL::uuid;
    RETURN;
  END IF;
  v_mode := core.payment_mit_consent_mode(h.country_code::text);
  IF v_mode IS NULL THEN
    RETURN QUERY SELECT 'PARAM_MISSING'::text, NULL::uuid;
    RETURN;
  END IF;
  v_id := pg_catalog.gen_random_uuid();
  PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
  INSERT INTO core.payment_mit_consent (id, user_id, hold_id, scopes, consent_key, catalog_version,
                                        locale)
  VALUES (v_id, v_user, p_hold_id,
          ARRAY['DELAYED_CHARGES', 'NO_SHOW', 'DAMAGE_SEPARATE', 'REAUTHORIZATION'],
          -- texte réellement affiché : case séparée (paramètre du pays vrai) ou mention au bouton
          CASE v_mode WHEN 'CHECKBOX' THEN 'web.s05.mitConsent' ELSE 'web.s05.mitConsentNotice' END,
          p_catalog_version, p_locale)
  ON CONFLICT ON CONSTRAINT mit_consent_hold_unique DO NOTHING;
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  SELECT c.id INTO v_id FROM core.payment_mit_consent AS c WHERE c.hold_id = p_hold_id;
  RETURN QUERY SELECT 'ACCEPTED'::text, v_id;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_accept_mit_consent(bytea, uuid, text, integer) IS
  'Consentement MIT du voyageur au checkout (S05, web.s05.mitConsent), une fois par hold vivant. '
  'SECURITY DEFINER, EXECUTE app_api. US-703 (ADR-189).';

-- 7.2 Carte enregistrée par le paiement prouvé (travailleur payment_command ; lot C : webhook du
-- PSP, FAKE en tests) : jeton seul, carte précédente du voyageur sur ce compte REPLACED ; liaison
-- UNE fois du consentement du hold (et du trip né du hold). Rejeu du même jeton : même carte.
-- Sans consentement du hold encore à lier : aucun effet sur les cartes (revue argent n° 4).
CREATE FUNCTION core.payment_cmd_record_instrument(p_id uuid, p_hold_id uuid,
                                                   p_psp_account_id uuid, p_token_ref text,
                                                   p_network text, p_funding text, p_last4 text,
                                                   p_exp_month integer, p_exp_year integer,
                                                   p_network_tx_reference text,
                                                   p_transaction_link_id text)
  RETURNS TABLE (instrument_id uuid, bound boolean, replayed boolean)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  h         record;
  v_country text;
  v_status  text;
  v_existing core.payment_payment_instrument%ROWTYPE;
  v_consent uuid;
  v_bound   boolean := false;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: record_instrument reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  SELECT x.id, x.guest_user_id, x.country_code, x.converted_trip_id INTO h
    FROM core.booking_checkout_hold AS x WHERE x.id = p_hold_id;
  SELECT a.country_code, a.status INTO v_country, v_status
    FROM core.payment_psp_account AS a WHERE a.id = p_psp_account_id;
  IF h.id IS NULL OR v_country IS NULL OR v_country <> h.country_code THEN
    RAISE EXCEPTION 'payment: instrument hold or account mismatch'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_charge_mismatch';
  END IF;
  -- verrou du voyageur : une carte ACTIVE à la fois, remplacement sans course
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('mit.instrument:' || h.guest_user_id::text, 0));
  -- revue sécurité n° 6 : un PAN est refusé AVANT toute écriture, sans jamais citer la valeur
  -- (la contrainte payment_instrument_token_no_pan reste la défense en profondeur)
  IF p_token_ref IS NULL OR core.payment_text_has_pan(p_token_ref) THEN
    RAISE EXCEPTION 'payment: card token refused (looks like a card number)'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'payment_instrument_token_no_pan';
  END IF;
  SELECT * INTO v_existing FROM core.payment_payment_instrument AS i
   WHERE i.psp_account_id = p_psp_account_id AND i.token_ref = p_token_ref;
  -- revue argent n° 4 (delta 20b) : seul un consentement de CE hold encore sans carte peut changer
  -- l'état des cartes. Rejeu tardif d'un ancien hold (travailleur relancé, webhook rejoué) ou autre
  -- jeton pour un hold déjà lié : AUCUN effet (ni remplacement, ni réactivation, ni carte créée)
  SELECT c.id INTO v_consent FROM core.payment_mit_consent AS c
   WHERE c.hold_id = p_hold_id AND c.user_id = h.guest_user_id AND c.instrument_id IS NULL
   FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id <> h.guest_user_id OR v_existing.network <> p_network
       OR v_existing.last4 <> p_last4 THEN
      RAISE EXCEPTION 'payment: same token, different card'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_instrument_conflict';
    END IF;
    -- revue argent n° 5 : voyageur qui revient avec une carte déjà enregistrée. Carte retirée
    -- (REVOKED) : jamais reprise, rien n'est lié ; carte remplacée (REPLACED) redevenue celle du
    -- paiement : elle redevient la carte courante (l'autre est remplacée, ADR-189 n° 14)
    IF v_consent IS NOT NULL AND v_existing.status = 'REPLACED' THEN
      UPDATE core.payment_payment_instrument AS i
         SET status = 'REPLACED', replaced_at = platform.now()
       WHERE i.user_id = h.guest_user_id AND i.psp_account_id = p_psp_account_id
         AND i.status = 'ACTIVE';
      UPDATE core.payment_payment_instrument AS i
         SET status = 'ACTIVE', replaced_at = NULL
       WHERE i.id = v_existing.id;
      v_existing.status := 'ACTIVE';
    END IF;
    IF v_consent IS NOT NULL AND v_existing.status = 'ACTIVE' THEN
      -- le consentement de CE hold, encore sans carte, est lié une fois à la carte connue
      UPDATE core.payment_mit_consent AS c
         SET instrument_id = v_existing.id, bound_at = platform.now(),
             network_tx_reference = p_network_tx_reference,
             transaction_link_id = p_transaction_link_id,
             trip_id = COALESCE(c.trip_id, h.converted_trip_id)
       WHERE c.id = v_consent AND c.instrument_id IS NULL;
    END IF;
    instrument_id := v_existing.id;
    SELECT EXISTS (SELECT 1 FROM core.payment_mit_consent AS c
                    WHERE c.hold_id = p_hold_id AND c.instrument_id = v_existing.id)
      INTO bound;
    replayed := true;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_consent IS NULL THEN
    -- jeton nouveau sans consentement à lier (hold déjà lié, ou sans consentement) : sans effet
    instrument_id := NULL;
    bound := false;
    replayed := true;
    RETURN NEXT;
    RETURN;
  END IF;
  UPDATE core.payment_payment_instrument AS i
     SET status = 'REPLACED', replaced_at = platform.now()
   WHERE i.user_id = h.guest_user_id AND i.psp_account_id = p_psp_account_id
     AND i.status = 'ACTIVE';
  INSERT INTO core.payment_payment_instrument (id, user_id, psp_account_id, country_code, token_ref,
                                               network, funding, last4, exp_month, exp_year)
  VALUES (p_id, h.guest_user_id, p_psp_account_id, v_country, p_token_ref, p_network, p_funding,
          p_last4, p_exp_month, p_exp_year);
  UPDATE core.payment_mit_consent AS c
     SET instrument_id = p_id, bound_at = platform.now(),
         network_tx_reference = p_network_tx_reference,
         transaction_link_id = p_transaction_link_id,
         trip_id = COALESCE(c.trip_id, h.converted_trip_id)
   WHERE c.id = v_consent AND c.instrument_id IS NULL;
  v_bound := FOUND;
  instrument_id := p_id;
  bound := v_bound;
  replayed := false;
  RETURN NEXT;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_record_instrument(uuid, uuid, uuid, text, text, text, text,
  integer, integer, text, text) IS
  'Carte enregistrée (jeton du PSP, jamais un PAN) du voyageur d''un hold ; liaison unique du '
  'consentement MIT. Travailleur payment_command. SECURITY DEFINER, EXECUTE app_worker. US-703.';

-- 7.3 Rappel du consentement à la remise (S09) par le voyageur du trip, pendant CHECKIN_OPEN ou
-- START_WINDOW_EXPIRED. Issues : ACKNOWLEDGED, ALREADY_ACKNOWLEDGED, NOT_FOUND, NO_CONSENT,
-- CHECKIN_NOT_OPEN, REQUEST_INVALID.
CREATE FUNCTION core.payment_cmd_ack_mit_reminder(p_token_hash bytea, p_trip_id uuid,
                                                  p_locale text, p_catalog_version integer)
  RETURNS TABLE (outcome text, acknowledged_at timestamptz)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  t         record;
  v_consent uuid;
  v_at      timestamptz;
  v_kind    text := pg_catalog.current_setting('app.actor_kind', true);
BEGIN
  IF p_token_hash IS NULL OR p_trip_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  SELECT x.id, x.guest_user_id, x.status INTO t FROM core.booking_trip AS x WHERE x.id = p_trip_id;
  IF v_user IS NULL OR t.id IS NULL OR t.guest_user_id IS DISTINCT FROM v_user THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF p_locale IS NULL OR p_locale !~ '^[a-z]{2}(-[A-Z]{2})?$'
     OR p_catalog_version IS NULL OR p_catalog_version < 1 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::timestamptz;
    RETURN;
  END IF;
  SELECT r.acknowledged_at INTO v_at FROM core.payment_mit_consent_reminder AS r
   WHERE r.trip_id = p_trip_id;
  IF v_at IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_ACKNOWLEDGED'::text, v_at;
    RETURN;
  END IF;
  SELECT c.id INTO v_consent FROM core.payment_trip_mit_consent(p_trip_id) AS c;
  IF v_consent IS NULL THEN
    RETURN QUERY SELECT 'NO_CONSENT'::text, NULL::timestamptz;
    RETURN;
  END IF;
  IF t.status NOT IN ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    RETURN QUERY SELECT 'CHECKIN_NOT_OPEN'::text, NULL::timestamptz;
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('app.actor_kind', 'GUEST', true);
  INSERT INTO core.payment_mit_consent_reminder (trip_id, consent_id, user_id, catalog_version,
                                                 locale)
  VALUES (p_trip_id, v_consent, v_user, p_catalog_version, p_locale)
  ON CONFLICT (trip_id) DO NOTHING;
  PERFORM pg_catalog.set_config('app.actor_kind', COALESCE(v_kind, ''), true);
  SELECT r.acknowledged_at INTO v_at FROM core.payment_mit_consent_reminder AS r
   WHERE r.trip_id = p_trip_id;
  RETURN QUERY SELECT 'ACKNOWLEDGED'::text, v_at;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_ack_mit_reminder(bytea, uuid, text, integer) IS
  'Rappel du consentement MIT confirmé par le voyageur à la remise (S09, US-315). SECURITY '
  'DEFINER, EXECUTE app_api. US-703 (ADR-189).';

-- 7.4 Lecture du voyageur (S09) : consentement, marque et 4 derniers chiffres de la carte liée,
-- rappel ; aucune ligne pour toute autre personne. Jamais le jeton.
CREATE FUNCTION core.payment_mit_consent_view(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (consented boolean, accepted_at timestamptz, network text, last4 text,
                 card_active boolean, reminded_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  t      record;
  c      record;
  i      record;
  v_rem  timestamptz;
BEGIN
  IF p_token_hash IS NULL OR p_trip_id IS NULL THEN
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  SELECT x.id, x.guest_user_id INTO t FROM core.booking_trip AS x WHERE x.id = p_trip_id;
  IF v_user IS NULL OR t.id IS NULL OR t.guest_user_id IS DISTINCT FROM v_user THEN
    RETURN;
  END IF;
  SELECT x.id, x.accepted_at, x.instrument_id INTO c
    FROM core.payment_trip_mit_consent(p_trip_id) AS x;
  -- toujours exécutée (aucune ligne sans carte liée : champs NULL, jamais un record non assigné)
  SELECT y.network, y.last4, y.status INTO i
    FROM core.payment_payment_instrument AS y WHERE y.id = c.instrument_id;
  SELECT r.acknowledged_at INTO v_rem FROM core.payment_mit_consent_reminder AS r
   WHERE r.trip_id = p_trip_id;
  RETURN QUERY SELECT c.id IS NOT NULL, c.accepted_at, i.network::text, i.last4::text,
                      COALESCE(i.status = 'ACTIVE', false), v_rem;
END
$fn$;
COMMENT ON FUNCTION core.payment_mit_consent_view(bytea, uuid) IS
  'Consentement MIT d''un trip vu par son voyageur : marque et 4 derniers chiffres seulement. '
  'SECURITY DEFINER, EXECUTE app_api. US-703 (ADR-189).';

-- 7.5 Débit post-trip décidé et notifié (travailleur payment_command, appelé par la décision
-- amont : US-305, US-706, US-309) : montant et jambes EXPLICITES (Σ = montant, chacune ≥ 0, jamais
-- un prorata), moyen = opération de carte du loyer du trip (AUTH / CAPTURE prouvée), notification
-- à l'heure de la base. Rejeu de la même origine au même contenu : même débit ; autre contenu :
-- conflit. Issues : NOTIFIED, REPLAYED.
CREATE FUNCTION core.payment_cmd_notify_post_trip_charge(p_id uuid, p_trip_id uuid,
                                                         p_purpose text, p_reason text,
                                                         p_origin_type text, p_origin_id uuid,
                                                         p_settlement_version integer,
                                                         p_tender_operation_id uuid,
                                                         p_amount_minor bigint, p_legs jsonb,
                                                         p_guest_agreed boolean)
  RETURNS TABLE (outcome text, charge_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t        record;
  o        record;
  v_keys   text[];
  v_leg    text;
  v_l      bigint[] := ARRAY[0, 0, 0, 0]::bigint[];
  v_sum    numeric := 0;
  v_old    core.payment_post_trip_charge%ROWTYPE;
  k        integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: notify_post_trip_charge reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  SELECT x.id, x.guest_user_id, x.country_code, x.currency, x.source_hold_id INTO t
    FROM core.booking_trip AS x WHERE x.id = p_trip_id FOR UPDATE;
  SELECT y.id, y.trip_id, y.hold_id, y.kind, y.method, y.purpose, y.status, y.psp_account_id,
         y.currency
    INTO o FROM core.payment_payment_operation AS y WHERE y.id = p_tender_operation_id;
  IF t.id IS NULL OR o.id IS NULL
     OR NOT COALESCE(o.trip_id = t.id
                     OR (t.source_hold_id IS NOT NULL AND o.hold_id = t.source_hold_id), false)
     OR o.kind NOT IN ('AUTH', 'CAPTURE') OR o.method IS DISTINCT FROM 'CARD'
     OR o.purpose <> 'RENT' OR o.status <> 'SUCCEEDED' OR o.currency <> t.currency THEN
    RAISE EXCEPTION 'payment: post-trip charge needs the card operation of the trip rent'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_charge_mismatch';
  END IF;
  -- jambes : exactement HOST, INSURER, TAX_THIRD_PARTY, PLATFORM, entiers ≥ 0, Σ = montant
  IF p_legs IS NULL OR pg_catalog.jsonb_typeof(p_legs) <> 'object' THEN
    RAISE EXCEPTION 'payment: legs required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT pg_catalog.array_agg(x ORDER BY x) INTO v_keys FROM pg_catalog.jsonb_object_keys(p_legs) AS x;
  IF v_keys IS DISTINCT FROM ARRAY['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'] THEN
    RAISE EXCEPTION 'payment: legs must be HOST, INSURER, TAX_THIRD_PARTY, PLATFORM'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  k := 0;
  FOREACH v_leg IN ARRAY ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] LOOP
    k := k + 1;
    IF pg_catalog.jsonb_typeof(p_legs -> v_leg) <> 'string'
       OR (p_legs ->> v_leg) !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'payment: leg % must be a non-negative integer string', v_leg
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_leg_negative';
    END IF;
    v_l[k] := (p_legs ->> v_leg)::bigint;
    v_sum := v_sum + v_l[k];
  END LOOP;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 OR v_sum <> p_amount_minor THEN
    RAISE EXCEPTION 'payment: legs do not sum to the charge amount'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_charge_legs_sum';
  END IF;
  SELECT * INTO v_old FROM core.payment_post_trip_charge AS x
   WHERE x.origin_type = p_origin_type AND x.origin_id = p_origin_id;
  IF v_old.id IS NOT NULL THEN
    IF (v_old.trip_id, v_old.purpose, v_old.reason, v_old.settlement_version,
        v_old.tender_operation_id, v_old.amount_minor, v_old.leg_host_minor,
        v_old.leg_insurer_minor, v_old.leg_tax_third_party_minor, v_old.leg_platform_minor,
        v_old.guest_agreed_at IS NOT NULL)
       IS DISTINCT FROM
       (p_trip_id, p_purpose, p_reason, p_settlement_version, p_tender_operation_id,
        p_amount_minor, v_l[1], v_l[2], v_l[3], v_l[4], COALESCE(p_guest_agreed, false)) THEN
      RAISE EXCEPTION 'payment: same post-trip charge origin, different content'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'mit_charge_conflict';
    END IF;
    RETURN QUERY SELECT 'REPLAYED'::text, v_old.id;
    RETURN;
  END IF;
  INSERT INTO core.payment_post_trip_charge
         (id, trip_id, user_id, country_code, currency, purpose, reason, origin_type, origin_id,
          settlement_version, tender_operation_id, psp_account_id, amount_minor, leg_host_minor,
          leg_insurer_minor, leg_tax_third_party_minor, leg_platform_minor, guest_agreed_at)
  VALUES (p_id, p_trip_id, t.guest_user_id, t.country_code, t.currency, p_purpose, p_reason,
          p_origin_type, p_origin_id, p_settlement_version, p_tender_operation_id,
          o.psp_account_id, p_amount_minor, v_l[1], v_l[2], v_l[3], v_l[4],
          CASE WHEN p_guest_agreed THEN platform.now() END);
  RETURN QUERY SELECT 'NOTIFIED'::text, p_id;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_notify_post_trip_charge(uuid, uuid, text, text, text, uuid,
  integer, uuid, bigint, jsonb, boolean) IS
  'Débit post-trip décidé et notifié (montant et jambes explicites, moyen de carte du loyer). '
  'Travailleur payment_command. SECURITY DEFINER, EXECUTE app_worker. US-703 (ADR-189).';

-- 7.6 Planification d'une tentative (travailleur payment_command), sous le verrou du trip puis du
-- débit. Issues :
--   PLANNED (tentative et ordre MIT_CHARGE PENDING créés : envoyer) ; IN_FLIGHT (une tentative
--   sans statut : relire ou rejouer la MÊME clé, jamais une nouvelle tentative) ; SETTLE (issue
--   connue à reporter) ; NOT_DUE (préavis, accord, échéancier : `code`, aucune écriture hors
--   `next_check_at`) ; BLOCKED (capacité SUPPORTS_MIT inconnue = non, compte inactif : aucun
--   ordre) ; DEBT (consentement absent, rappel absent, carte changée, règle ou délai inconnu, délai
--   dépassé : dette ouverte) ; DONE (déjà débité ou en dette).
CREATE FUNCTION core.payment_cmd_plan_mit_attempt(p_charge_id uuid, p_operation_id uuid)
  RETURNS TABLE (outcome text, code text, operation_id uuid, attempt integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  c          core.payment_post_trip_charge%ROWTYPE;
  v_trip     uuid;
  v_status   text;
  v_op       uuid;
  v_opstat   text;
  v_settled  text;
  k          record;
  ins        record;
  r          core.payment_mit_network_rule%ROWTYPE;
  v_acc      record;
  v_now      timestamptz := platform.now();
  v_from     timestamptz;
  v_deadline timestamptz;
  v_notice   timestamptz;
  v_due      timestamptz;
  v_n        integer;
  v_plain    text;
  v_sent     text;
  v_rec      record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: plan_mit_attempt reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  SELECT x.trip_id INTO v_trip FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  -- verrou du trip (un seul écrivain d'argent du trip), puis du débit
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO c FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id FOR UPDATE;
  IF c.status IN ('CHARGED', 'UNPAID') THEN
    RETURN QUERY SELECT 'DONE'::text, c.status, NULL::uuid, c.attempt_no;
    RETURN;
  END IF;
  -- tentative courante : sans statut ⇒ IN_FLIGHT ; issue connue non reportée ⇒ SETTLE
  IF c.attempt_no > 0 THEN
    SELECT a.operation_id, a.settled INTO v_op, v_settled
      FROM core.payment_post_trip_charge_attempt AS a
     WHERE a.charge_id = c.id AND a.attempt_no = c.attempt_no;
    SELECT o.status INTO v_opstat FROM core.payment_payment_operation AS o WHERE o.id = v_op;
    IF v_settled IS NULL THEN
      IF v_opstat IN ('SUCCEEDED', 'FAILED') THEN
        RETURN QUERY SELECT 'SETTLE'::text, v_opstat, v_op, c.attempt_no;
      ELSE
        RETURN QUERY SELECT 'IN_FLIGHT'::text, v_opstat, v_op, c.attempt_no;
      END IF;
      RETURN;
    END IF;
  END IF;
  IF c.next_check_at > v_now THEN
    RETURN QUERY SELECT 'NOT_DUE'::text, COALESCE(c.outcome_code, 'MIT_NOT_DUE'), NULL::uuid,
                        c.attempt_no;
    RETURN;
  END IF;

  -- consentement du trip, portée du motif, carte liée et toujours ACTIVE sur le compte du débit
  SELECT x.id, x.scopes, x.instrument_id INTO k FROM core.payment_trip_mit_consent(c.trip_id) AS x;
  IF k.id IS NULL OR NOT (c.reason = ANY (k.scopes)) OR k.instrument_id IS NULL THEN
    PERFORM core.payment_mit_open_debt(c.id, 'MIT_CONSENT_MISSING');
    RETURN QUERY SELECT 'DEBT'::text, 'MIT_CONSENT_MISSING'::text, NULL::uuid, c.attempt_no;
    RETURN;
  END IF;
  -- rappel à la remise exigé pour un frais après le trip (16 PAY-037)
  IF c.reason IN ('DELAYED_CHARGES', 'DAMAGE_SEPARATE')
     AND NOT EXISTS (SELECT 1 FROM core.payment_mit_consent_reminder AS m
                      WHERE m.trip_id = c.trip_id AND m.consent_id = k.id) THEN
    PERFORM core.payment_mit_open_debt(c.id, 'MIT_CONSENT_MISSING');
    RETURN QUERY SELECT 'DEBT'::text, 'MIT_CONSENT_MISSING'::text, NULL::uuid, c.attempt_no;
    RETURN;
  END IF;
  SELECT y.id, y.network, y.status, y.psp_account_id INTO ins
    FROM core.payment_payment_instrument AS y WHERE y.id = k.instrument_id;
  IF ins.status IS DISTINCT FROM 'ACTIVE' OR ins.psp_account_id <> c.psp_account_id
     OR (c.network IS NOT NULL AND ins.network <> c.network) THEN
    PERFORM core.payment_mit_open_debt(c.id, 'MIT_INSTRUMENT_CHANGED');
    RETURN QUERY SELECT 'DEBT'::text, 'MIT_INSTRUMENT_CHANGED'::text, NULL::uuid, c.attempt_no;
    RETURN;
  END IF;

  -- règle du réseau de la carte (données) ; inconnue ⇒ aucun débit
  SELECT * INTO r FROM core.payment_mit_rule(c.country_code, ins.network, c.reason);
  IF r.country_code IS NULL OR r.deadline_days IS NULL THEN
    PERFORM core.payment_mit_open_debt(c.id, 'MIT_RULE_UNKNOWN');
    RETURN QUERY SELECT 'DEBT'::text, 'MIT_RULE_UNKNOWN'::text, NULL::uuid, c.attempt_no;
    RETURN;
  END IF;
  v_from := CASE r.deadline_from WHEN 'RETURN' THEN core.payout_effective_end(c.trip_id)
                                 ELSE c.notified_at END;
  IF v_from IS NULL THEN
    PERFORM core.payment_mit_open_debt(c.id, 'MIT_RULE_UNKNOWN');
    RETURN QUERY SELECT 'DEBT'::text, 'MIT_RULE_UNKNOWN'::text, NULL::uuid, c.attempt_no;
    RETURN;
  END IF;
  v_deadline := v_from + pg_catalog.make_interval(days => r.deadline_days);
  IF v_now > v_deadline THEN
    PERFORM core.payment_mit_open_debt(c.id, 'MIT_DEADLINE_PASSED');
    RETURN QUERY SELECT 'DEBT'::text, 'MIT_DEADLINE_PASSED'::text, NULL::uuid, c.attempt_no;
    RETURN;
  END IF;

  -- première tentative : préavis d'objection, ou accord écrit si le réseau l'exige
  IF c.attempt_no = 0 THEN
    IF c.guest_agreed_at IS NULL THEN
      IF r.notice_hours IS NULL THEN
        UPDATE core.payment_post_trip_charge AS x
           SET next_check_at = v_deadline, outcome_code = 'MIT_AGREEMENT_REQUIRED'
         WHERE x.id = c.id;
        RETURN QUERY SELECT 'NOT_DUE'::text, 'MIT_AGREEMENT_REQUIRED'::text, NULL::uuid, 0;
        RETURN;
      END IF;
      v_notice := c.notified_at + pg_catalog.make_interval(hours => r.notice_hours);
      IF v_now < v_notice THEN
        UPDATE core.payment_post_trip_charge AS x
           SET next_check_at = v_notice, outcome_code = 'MIT_NOTICE_PERIOD_NOT_ELAPSED'
         WHERE x.id = c.id;
        RETURN QUERY SELECT 'NOT_DUE'::text, 'MIT_NOTICE_PERIOD_NOT_ELAPSED'::text, NULL::uuid, 0;
        RETURN;
      END IF;
    END IF;
  ELSE
    -- relance : échéancier de la règle (J0, J+3, J+7) ; épuisé ⇒ dette
    IF c.attempt_no >= pg_catalog.cardinality(r.retry_offsets_days) THEN
      PERFORM core.payment_mit_open_debt(c.id, 'MIT_DECLINED');
      RETURN QUERY SELECT 'DEBT'::text, 'MIT_DECLINED'::text, NULL::uuid, c.attempt_no;
      RETURN;
    END IF;
    v_due := core.payment_mit_attempt_due(c.first_attempt_at, r.retry_offsets_days,
                                          c.attempt_no + 1);
    IF v_now < v_due THEN
      UPDATE core.payment_post_trip_charge AS x
         SET next_check_at = v_due, outcome_code = 'MIT_RETRY_NOT_DUE'
       WHERE x.id = c.id;
      RETURN QUERY SELECT 'NOT_DUE'::text, 'MIT_RETRY_NOT_DUE'::text, NULL::uuid, c.attempt_no;
      RETURN;
    END IF;
  END IF;

  -- capacité bloquante relue à l'envoi (inconnue = non) et compte du débit ACTIVE : aucun ordre
  SELECT a.provider, a.status INTO v_acc FROM core.payment_psp_account AS a
   WHERE a.id = c.psp_account_id;
  IF v_acc.status IS DISTINCT FROM 'ACTIVE'
     OR NOT core.payment_capability_bool(v_acc.provider, c.country_code, 'CARD', 'SUPPORTS_MIT') THEN
    UPDATE core.payment_post_trip_charge AS x
       SET next_check_at = v_now + interval '1 day', outcome_code = 'MIT_RAIL_UNAVAILABLE'
     WHERE x.id = c.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'MIT_RAIL_UNAVAILABLE'::text, NULL::uuid, c.attempt_no;
    RETURN;
  END IF;

  -- nouvelle tentative de l'instance i1 : clé de 08 E4, condensée (limite inconnue = condensé)
  v_n := c.attempt_no + 1;
  v_plain := pg_catalog.format('%s:1:%s:MIT_CHARGE:%s:i1:a%s', c.trip_id,
               CASE WHEN c.settlement_version IS NULL
                    THEN 'v0-' || c.origin_type || '-' || c.origin_id::text
                    ELSE 'v' || c.settlement_version::text END,
               c.tender_operation_id, v_n);
  v_sent := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_plain, 'UTF8')), 'hex');
  INSERT INTO core.payment_post_trip_charge_attempt (charge_id, attempt_no, idem_plain, idem_sent,
                                                     amount_minor)
  VALUES (c.id, v_n, v_plain, v_sent, c.amount_minor);
  SELECT x.operation_id, x.replayed INTO v_rec
    FROM core.payment_cmd_record_operation(
           p_operation_id, NULL, c.trip_id, c.psp_account_id, 'CARD', 'MIT_CHARGE', c.purpose,
           c.amount_minor, c.currency, v_n, v_plain, v_sent,
           pg_catalog.jsonb_build_object('HOST', c.leg_host_minor::text,
                                         'INSURER', c.leg_insurer_minor::text,
                                         'TAX_THIRD_PARTY', c.leg_tax_third_party_minor::text,
                                         'PLATFORM', c.leg_platform_minor::text),
           NULL, NULL) AS x;
  UPDATE core.payment_post_trip_charge_attempt AS a
     SET operation_id = v_rec.operation_id
   WHERE a.charge_id = c.id AND a.attempt_no = v_n;
  UPDATE core.payment_post_trip_charge AS x
     SET status = 'CHARGING', attempt_no = v_n,
         first_attempt_at = COALESCE(x.first_attempt_at, v_now),
         network = COALESCE(x.network, ins.network), outcome_code = NULL
   WHERE x.id = c.id;
  RETURN QUERY SELECT 'PLANNED'::text, NULL::text, v_rec.operation_id, v_n;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_plan_mit_attempt(uuid, uuid) IS
  'Tentative de débit MIT d''un débit post-trip : consentement, rappel, carte, règle du réseau, '
  'délai, préavis, SUPPORTS_MIT et échéancier relus sous le verrou du trip ; une instance i1, '
  'attempt_no + 1 après un refus reçu seulement (T68). SECURITY DEFINER, EXECUTE app_worker. US-703.';

-- 7.7 Ordre STOCKÉ de la tentative courante pour l'envoi (verrous du trip puis du débit, gardés
-- jusqu'au COMMIT donc pendant l'appel au PSP) : clé, montant, jambes, jeton de la carte liée,
-- motif MIT. `sendable` faux : rien à envoyer (issue connue, débit terminé).
CREATE FUNCTION core.payment_mit_attempt_for_send(p_charge_id uuid)
  RETURNS TABLE (sendable boolean, operation_id uuid, operation_status text, idem_sent text,
                 amount_minor bigint, currency text, legs jsonb, provider_reference text,
                 instrument_token text, mit_reason text, provider text, attempt integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  c      core.payment_post_trip_charge%ROWTYPE;
  v_trip uuid;
  o      record;
  v_tok  text;
  v_prov text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: mit_attempt_for_send reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  SELECT x.trip_id INTO v_trip FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text, NULL::text, NULL::bigint, NULL::text,
                        NULL::jsonb, NULL::text, NULL::text, NULL::text, NULL::text, NULL::integer;
    RETURN;
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO c FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id FOR UPDATE;
  SELECT y.id, y.status, y.idem_sent, y.amount_minor, y.currency, y.provider_reference INTO o
    FROM core.payment_post_trip_charge_attempt AS a
    JOIN core.payment_payment_operation AS y ON y.id = a.operation_id
   WHERE a.charge_id = c.id AND a.attempt_no = c.attempt_no AND a.settled IS NULL;
  IF c.status <> 'CHARGING' OR o.id IS NULL OR o.status IN ('SUCCEEDED', 'FAILED') THEN
    RETURN QUERY SELECT false, o.id, o.status::text, NULL::text, NULL::bigint, NULL::text,
                        NULL::jsonb, NULL::text, NULL::text, NULL::text, NULL::text, c.attempt_no;
    RETURN;
  END IF;
  SELECT i.token_ref INTO v_tok
    FROM core.payment_trip_mit_consent(c.trip_id) AS k
    JOIN core.payment_payment_instrument AS i ON i.id = k.instrument_id
   WHERE i.status = 'ACTIVE';
  SELECT a.provider INTO v_prov FROM core.payment_psp_account AS a WHERE a.id = c.psp_account_id;
  RETURN QUERY
  SELECT v_tok IS NOT NULL, o.id, o.status::text, o.idem_sent::text, o.amount_minor, o.currency::text,
         (SELECT pg_catalog.jsonb_object_agg(l.leg, l.amount_minor::text)
            FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = o.id),
         o.provider_reference::text, v_tok, c.reason, v_prov, c.attempt_no;
END
$fn$;
COMMENT ON FUNCTION core.payment_mit_attempt_for_send(uuid) IS
  'Ordre MIT_CHARGE stocké de la tentative courante et jeton de la carte liée, sous les verrous du '
  'trip et du débit (jusqu''au COMMIT). SECURITY DEFINER, EXECUTE app_worker. US-703 (ADR-189).';

-- 7.8 Report de l'issue d'une tentative (travailleur payment_command) : SUCCEEDED ⇒ CHARGED (et
-- mouvement de jambe du périmètre du loyer, prouvé) ; FAILED reçu ⇒ relance planifiée (J+3, J+7)
-- ou dette (« ne pas réessayer », tentatives épuisées) ; sans statut ⇒ IN_FLIGHT. Issues :
-- CHARGED, AWAITING_PROOF, RETRY_DUE, DEBT, IN_FLIGHT, DONE.
CREATE FUNCTION core.payment_cmd_settle_mit_attempt(p_charge_id uuid, p_do_not_retry boolean)
  RETURNS TABLE (outcome text, code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  c        core.payment_post_trip_charge%ROWTYPE;
  v_trip   uuid;
  a        record;
  o        record;
  r        core.payment_mit_network_rule%ROWTYPE;
  v_max    integer;
  v_reason text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: settle_mit_attempt reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  SELECT x.trip_id INTO v_trip FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO c FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id FOR UPDATE;
  IF c.attempt_no = 0 THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  SELECT x.attempt_no, x.operation_id, x.settled INTO a
    FROM core.payment_post_trip_charge_attempt AS x
   WHERE x.charge_id = c.id AND x.attempt_no = c.attempt_no;
  SELECT y.id, y.status, y.proof_type INTO o
    FROM core.payment_payment_operation AS y WHERE y.id = a.operation_id;

  IF c.status = 'CHARGED' THEN
    -- report du mouvement de jambe attendu de la preuve (webhook signé ou lecture)
    IF NOT c.leg_reported AND c.purpose IN ('RENT_SHORTFALL', 'NO_SHOW_RETENTION') THEN
      IF o.proof_type IS NULL THEN
        RETURN QUERY SELECT 'AWAITING_PROOF'::text, NULL::text;
        RETURN;
      END IF;
      PERFORM core.settlement_cmd_apply_leg_movement(o.id);
      UPDATE core.payment_post_trip_charge AS x SET leg_reported = true WHERE x.id = c.id;
    END IF;
    RETURN QUERY SELECT 'CHARGED'::text, NULL::text;
    RETURN;
  END IF;
  IF c.status = 'UNPAID' THEN
    RETURN QUERY SELECT 'DONE'::text, c.outcome_code;
    RETURN;
  END IF;
  IF a.settled IS NOT NULL OR o.status IS NULL OR o.status NOT IN ('SUCCEEDED', 'FAILED') THEN
    RETURN QUERY SELECT 'IN_FLIGHT'::text, o.status::text;
    RETURN;
  END IF;

  IF o.status = 'SUCCEEDED' THEN
    UPDATE core.payment_post_trip_charge_attempt AS x
       SET settled = 'SUCCEEDED', do_not_retry = false
     WHERE x.charge_id = c.id AND x.attempt_no = a.attempt_no;
    UPDATE core.payment_post_trip_charge AS x SET status = 'CHARGED' WHERE x.id = c.id;
    -- frais du périmètre du loyer (retenue non encaissée, T29) : jambes reportées au trip, sur
    -- preuve ; les autres motifs (frais annexes, dommages) sont reportés par leur story (US-706,
    -- US-309) : aucun mouvement ici
    IF c.purpose IN ('RENT_SHORTFALL', 'NO_SHOW_RETENTION') THEN
      IF o.proof_type IS NULL THEN
        RETURN QUERY SELECT 'AWAITING_PROOF'::text, NULL::text;
        RETURN;
      END IF;
      PERFORM core.settlement_cmd_apply_leg_movement(o.id);
      UPDATE core.payment_post_trip_charge AS x SET leg_reported = true WHERE x.id = c.id;
    ELSE
      UPDATE core.payment_post_trip_charge AS x SET leg_reported = true WHERE x.id = c.id;
    END IF;
    RETURN QUERY SELECT 'CHARGED'::text, NULL::text;
    RETURN;
  END IF;

  -- refus REÇU (aucun fonds débité)
  UPDATE core.payment_post_trip_charge_attempt AS x
     SET settled = 'FAILED', do_not_retry = COALESCE(p_do_not_retry, false)
   WHERE x.charge_id = c.id AND x.attempt_no = a.attempt_no;
  SELECT * INTO r FROM core.payment_mit_rule(c.country_code, c.network, c.reason);
  v_max := COALESCE(pg_catalog.cardinality(r.retry_offsets_days), 1);
  IF COALESCE(p_do_not_retry, false) OR c.attempt_no >= v_max THEN
    v_reason := CASE WHEN COALESCE(p_do_not_retry, false) THEN 'MIT_DO_NOT_RETRY'
                     ELSE 'MIT_DECLINED' END;
    PERFORM core.payment_mit_open_debt(c.id, v_reason);
    RETURN QUERY SELECT 'DEBT'::text, v_reason;
    RETURN;
  END IF;
  UPDATE core.payment_post_trip_charge AS x
     SET status = 'RETRY_DUE', outcome_code = 'MIT_RETRY_NOT_DUE',
         next_check_at = core.payment_mit_attempt_due(c.first_attempt_at, r.retry_offsets_days,
                                                      c.attempt_no + 1)
   WHERE x.id = c.id;
  RETURN QUERY SELECT 'RETRY_DUE'::text, NULL::text;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_settle_mit_attempt(uuid, boolean) IS
  'Report de l''issue de la tentative courante d''un débit post-trip (débité, relance, dette). '
  'Travailleur payment_command. SECURITY DEFINER, EXECUTE app_worker. US-703 (ADR-189).';

-- 7.9 File des débits à traiter (travailleur payment_command) : échus (NOTIFIED, RETRY_DUE), en
-- cours (CHARGING), débités dont le mouvement de jambe attend sa preuve.
CREATE FUNCTION core.payment_post_trip_charges_due(p_limit integer)
  RETURNS TABLE (charge_id uuid, status text, provider text, country_code text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: post_trip_charges_due reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  RETURN QUERY
  SELECT c.id, c.status, a.provider::text, c.country_code
    FROM core.payment_post_trip_charge AS c
    JOIN core.payment_psp_account AS a ON a.id = c.psp_account_id
   WHERE c.next_check_at <= platform.now()
     AND (c.status IN ('NOTIFIED', 'RETRY_DUE', 'CHARGING')
          OR (c.status = 'CHARGED' AND NOT c.leg_reported))
   ORDER BY c.next_check_at, c.id
   LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
END
$fn$;
COMMENT ON FUNCTION core.payment_post_trip_charges_due(integer) IS
  'File des débits post-trip à traiter. SECURITY DEFINER, EXECUTE app_worker. US-703 (ADR-189).';

-- 7.10 Encaissement partiel d'une dette (travailleur payment_command ; paiement volontaire du
-- voyageur, lot C : lien de paiement) : jambes de la règle 4 (`payment_partial_collection_legs`),
-- instance_seq + 1, clé `{trip}:1:v0-DEBT-{dette}:DEBT_COLLECTION:{moyen}:i{n}:a1`, ordre
-- DEBT_COLLECTION PENDING. Un seul encaissement planifié à la fois. Issues : PLANNED (jambes),
-- PENDING_COLLECTION (un encaissement attend son issue : aucun nouveau), PAID, AMOUNT_INVALID.
CREATE FUNCTION core.payment_cmd_plan_debt_collection(p_debt_id uuid, p_collection_id uuid,
                                                      p_operation_id uuid, p_amount_minor bigint)
  RETURNS TABLE (outcome text, collection_id uuid, operation_id uuid, legs jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  d       core.payment_debt_balance%ROWTYPE;
  c       core.payment_post_trip_charge%ROWTYPE;
  v_trip  uuid;
  v_inc   bigint[];
  v_seq   integer;
  v_plain text;
  v_sent  text;
  v_legs  jsonb;
  v_rec   record;
  v_pend  uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: plan_debt_collection reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  SELECT x.trip_id INTO v_trip FROM core.payment_debt_balance AS x WHERE x.id = p_debt_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO d FROM core.payment_debt_balance AS x WHERE x.id = p_debt_id FOR UPDATE;
  IF d.status = 'PAID' THEN
    RETURN QUERY SELECT 'PAID'::text, NULL::uuid, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  SELECT k.id INTO v_pend FROM core.payment_debt_collection AS k
   WHERE k.debt_id = d.id AND k.status = 'PLANNED';
  IF v_pend IS NOT NULL THEN
    RETURN QUERY SELECT 'PENDING_COLLECTION'::text, v_pend, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  v_inc := core.payment_partial_collection_legs(
             ARRAY[d.due_host_minor, d.due_insurer_minor, d.due_tax_third_party_minor,
                   d.due_platform_minor],
             ARRAY[d.paid_host_minor, d.paid_insurer_minor, d.paid_tax_third_party_minor,
                   d.paid_platform_minor],
             p_amount_minor);
  IF v_inc IS NULL THEN
    RETURN QUERY SELECT 'AMOUNT_INVALID'::text, NULL::uuid, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO c FROM core.payment_post_trip_charge AS x WHERE x.id = d.charge_id;
  v_seq := d.collection_seq + 1;
  v_plain := pg_catalog.format('%s:1:v0-DEBT-%s:DEBT_COLLECTION:%s:i%s:a1', d.trip_id, d.id,
                               c.tender_operation_id, v_seq);
  v_sent := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_plain, 'UTF8')), 'hex');
  v_legs := pg_catalog.jsonb_build_object('HOST', v_inc[1]::text, 'INSURER', v_inc[2]::text,
                                          'TAX_THIRD_PARTY', v_inc[3]::text,
                                          'PLATFORM', v_inc[4]::text);
  INSERT INTO core.payment_debt_collection (id, debt_id, seq, amount_minor, leg_host_minor,
                                            leg_insurer_minor, leg_tax_third_party_minor,
                                            leg_platform_minor, rule_version, idem_plain,
                                            idem_sent)
  VALUES (p_collection_id, d.id, v_seq, p_amount_minor, v_inc[1], v_inc[2], v_inc[3], v_inc[4],
          d.rule_version, v_plain, v_sent);
  SELECT x.operation_id, x.replayed INTO v_rec
    FROM core.payment_cmd_record_operation(
           p_operation_id, NULL, d.trip_id, c.psp_account_id, 'CARD', 'DEBT_COLLECTION', c.purpose,
           p_amount_minor, d.currency, 1, v_plain, v_sent, v_legs, NULL, NULL) AS x;
  UPDATE core.payment_debt_collection AS k SET operation_id = v_rec.operation_id
   WHERE k.id = p_collection_id;
  UPDATE core.payment_debt_balance AS x SET collection_seq = v_seq WHERE x.id = d.id;
  RETURN QUERY SELECT 'PLANNED'::text, p_collection_id, v_rec.operation_id, v_legs;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_plan_debt_collection(uuid, uuid, uuid, bigint) IS
  'Encaissement partiel d''une dette : jambes de 08 E7 règle 4 révisée, ordre DEBT_COLLECTION. '
  'Travailleur payment_command. SECURITY DEFINER, EXECUTE app_worker. US-703 (ADR-189).';

-- 7.11 Report d'un encaissement (travailleur payment_command) : SUCCEEDED prouvé ⇒ cumul par jambe
-- (PARTIALLY_PAID, PAID), mouvement de jambe du périmètre du loyer ; dette PAYÉE et plus aucune
-- autre dette ouverte du voyageur ⇒ restriction UNPAID_BALANCE levée ; FAILED ⇒ encaissement
-- échoué, rien d'encaissé. Issues : COLLECTED, AWAITING_PROOF, FAILED, IN_FLIGHT, DONE.
CREATE FUNCTION core.payment_cmd_settle_debt_collection(p_collection_id uuid)
  RETURNS TABLE (outcome text, debt_status text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  k       core.payment_debt_collection%ROWTYPE;
  d       core.payment_debt_balance%ROWTYPE;
  v_trip  uuid;
  o       record;
  v_paid  bigint;
  v_stat  text;
  v_purp  text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: settle_debt_collection reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  SELECT b.trip_id INTO v_trip
    FROM core.payment_debt_collection AS x
    JOIN core.payment_debt_balance AS b ON b.id = x.debt_id
   WHERE x.id = p_collection_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT * INTO k FROM core.payment_debt_collection AS x WHERE x.id = p_collection_id FOR UPDATE;
  SELECT * INTO d FROM core.payment_debt_balance AS x WHERE x.id = k.debt_id FOR UPDATE;
  IF k.status <> 'PLANNED' THEN
    RETURN QUERY SELECT 'DONE'::text, d.status;
    RETURN;
  END IF;
  SELECT y.id, y.status, y.proof_type INTO o
    FROM core.payment_payment_operation AS y WHERE y.id = k.operation_id;
  IF o.status = 'FAILED' THEN
    UPDATE core.payment_debt_collection AS x SET status = 'FAILED', settled_at = platform.now()
     WHERE x.id = k.id;
    RETURN QUERY SELECT 'FAILED'::text, d.status;
    RETURN;
  END IF;
  IF o.status IS DISTINCT FROM 'SUCCEEDED' THEN
    RETURN QUERY SELECT 'IN_FLIGHT'::text, d.status;
    RETURN;
  END IF;
  -- aucun encaissement porté sans preuve rattachée (webhook signé ou lecture : US-223, RC-5)
  IF o.proof_type IS NULL THEN
    RETURN QUERY SELECT 'AWAITING_PROOF'::text, d.status;
    RETURN;
  END IF;
  v_paid := d.paid_host_minor + d.paid_insurer_minor + d.paid_tax_third_party_minor
            + d.paid_platform_minor + k.amount_minor;
  v_stat := CASE WHEN v_paid = d.amount_minor THEN 'PAID' ELSE 'PARTIALLY_PAID' END;
  UPDATE core.payment_debt_balance AS x
     SET paid_host_minor = x.paid_host_minor + k.leg_host_minor,
         paid_insurer_minor = x.paid_insurer_minor + k.leg_insurer_minor,
         paid_tax_third_party_minor = x.paid_tax_third_party_minor + k.leg_tax_third_party_minor,
         paid_platform_minor = x.paid_platform_minor + k.leg_platform_minor,
         status = v_stat
   WHERE x.id = d.id;
  UPDATE core.payment_debt_collection AS x SET status = 'COLLECTED', settled_at = platform.now()
   WHERE x.id = k.id;
  SELECT c.purpose INTO v_purp FROM core.payment_post_trip_charge AS c WHERE c.id = d.charge_id;
  IF v_purp IN ('RENT_SHORTFALL', 'NO_SHOW_RETENTION') THEN
    PERFORM core.settlement_cmd_apply_leg_movement(o.id);
  END IF;
  IF v_stat = 'PAID' THEN
    UPDATE core.iam_restriction AS r
       SET active = false, lifted_at = platform.now()
     WHERE r.user_id = d.user_id AND r.kind = 'UNPAID_BALANCE' AND r.active
       AND r.source_ref = 'debt:' || d.id::text;
  END IF;
  RETURN QUERY SELECT 'COLLECTED'::text, v_stat;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_settle_debt_collection(uuid) IS
  'Report d''un encaissement de dette prouvé : cumul par jambe, dette payée, restriction levée. '
  'Travailleur payment_command. SECURITY DEFINER, EXECUTE app_worker. US-703 (ADR-189).';

-- 7.12 Mode du consentement du pays (DEC-FONDATEUR-22, ADR-189 n° 15) : `CHECKBOX` si
-- `mit_consent_checkbox_required[pays]` vaut vrai, `NOTICE` s'il vaut faux (mention explicite au
-- bouton de paiement, comme Turo) ; absent ou non booléen ⇒ NULL (fail_mode BLOCK : aucun
-- consentement, aucun paiement, des deux côtés). Le consentement reste exigé et enregistré dans
-- les deux modes. Interne (SECURITY INVOKER, aucun EXECUTE).
CREATE FUNCTION core.payment_mit_consent_mode(p_country text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE core.payout_param('mit_consent_checkbox_required', p_country)
           WHEN 'true'::jsonb THEN 'CHECKBOX'
           WHEN 'false'::jsonb THEN 'NOTICE'
         END
$fn$;

-- 7.13 Mode du consentement vu par le voyageur du hold (S05) ; aucune ligne pour toute autre
-- personne.
CREATE FUNCTION core.payment_mit_consent_mode_of_hold(p_token_hash bytea, p_hold_id uuid)
  RETURNS TABLE (mode text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  h      record;
BEGIN
  IF p_token_hash IS NULL OR p_hold_id IS NULL THEN
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  SELECT x.id, x.guest_user_id, x.country_code INTO h
    FROM core.booking_checkout_hold AS x WHERE x.id = p_hold_id;
  IF v_user IS NULL OR h.id IS NULL OR h.guest_user_id IS DISTINCT FROM v_user THEN
    RETURN;
  END IF;
  -- paramètre absent : BLOCKED (le site n'offre pas le paiement ; la base le refuse de même)
  RETURN QUERY SELECT COALESCE(core.payment_mit_consent_mode(h.country_code::text), 'BLOCKED');
END
$fn$;
COMMENT ON FUNCTION core.payment_mit_consent_mode_of_hold(bytea, uuid) IS
  'Mode du consentement MIT (CHECKBOX ou NOTICE) du pays du hold, vu par son voyageur (S05). '
  'SECURITY DEFINER, EXECUTE app_api. US-703 (ADR-189).';

-- 7.14 Prochaine relecture d'un débit dont le traitement n'a pas abouti (revue code n° 3 : aucune
-- famine de la file) : débit en cours (`CHARGING`) ou débité dont le mouvement de jambe attend sa
-- preuve, repoussé de 15 min (PROPOSÉ), code journalisé ; tout autre état : rien. Travailleur
-- payment_command.
CREATE FUNCTION core.payment_cmd_defer_mit_charge(p_charge_id uuid, p_code text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip uuid;
  v_n    integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: defer_mit_charge reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'mit_command_forbidden';
  END IF;
  SELECT x.trip_id INTO v_trip FROM core.payment_post_trip_charge AS x WHERE x.id = p_charge_id;
  IF v_trip IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  UPDATE core.payment_post_trip_charge AS x
     SET next_check_at = platform.now() + interval '15 minutes',
         outcome_code = CASE WHEN p_code ~ '^[A-Z][A-Z0-9_]{1,63}$' THEN p_code
                             ELSE x.outcome_code END
   WHERE x.id = p_charge_id
     AND (x.status = 'CHARGING' OR (x.status = 'CHARGED' AND NOT x.leg_reported));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN CASE WHEN v_n = 1 THEN 'DEFERRED' ELSE 'UNCHANGED' END;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_defer_mit_charge(uuid, text) IS
  'Prochaine relecture (+15 min) d''un débit post-trip en cours ou en attente de preuve : la file '
  'ne le ramène plus en tête. Travailleur payment_command. SECURITY DEFINER, EXECUTE app_worker. US-703.';

-- 8. Droits et propriétaire -------------------------------------------------------------------
REVOKE ALL ON FUNCTION
  core.payment_partial_collection_legs(bigint[], bigint[], bigint),
  core.payment_trip_mit_consent(uuid),
  core.payment_mit_rule(text, text, text),
  core.payment_mit_open_debt(uuid, text),
  core.payment_mit_attempt_due(timestamptz, integer[], integer),
  core.payment_cmd_accept_mit_consent(bytea, uuid, text, integer),
  core.payment_cmd_record_instrument(uuid, uuid, uuid, text, text, text, text, integer, integer,
                                     text, text),
  core.payment_cmd_ack_mit_reminder(bytea, uuid, text, integer),
  core.payment_mit_consent_view(bytea, uuid),
  core.payment_cmd_notify_post_trip_charge(uuid, uuid, text, text, text, uuid, integer, uuid,
                                           bigint, jsonb, boolean),
  core.payment_cmd_plan_mit_attempt(uuid, uuid),
  core.payment_mit_attempt_for_send(uuid),
  core.payment_cmd_settle_mit_attempt(uuid, boolean),
  core.payment_post_trip_charges_due(integer),
  core.payment_cmd_plan_debt_collection(uuid, uuid, uuid, bigint),
  core.payment_cmd_settle_debt_collection(uuid),
  core.payment_mit_consent_mode(text),
  core.payment_mit_consent_mode_of_hold(bytea, uuid),
  core.payment_cmd_defer_mit_charge(uuid, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.payment_cmd_accept_mit_consent(bytea, uuid, text, integer),
  core.payment_cmd_ack_mit_reminder(bytea, uuid, text, integer),
  core.payment_mit_consent_view(bytea, uuid),
  core.payment_mit_consent_mode_of_hold(bytea, uuid)
TO app_api;
GRANT EXECUTE ON FUNCTION
  core.payment_cmd_record_instrument(uuid, uuid, uuid, text, text, text, text, integer, integer,
                                     text, text),
  core.payment_cmd_notify_post_trip_charge(uuid, uuid, text, text, text, uuid, integer, uuid,
                                           bigint, jsonb, boolean),
  core.payment_cmd_plan_mit_attempt(uuid, uuid),
  core.payment_mit_attempt_for_send(uuid),
  core.payment_cmd_settle_mit_attempt(uuid, boolean),
  core.payment_post_trip_charges_due(integer),
  core.payment_cmd_plan_debt_collection(uuid, uuid, uuid, bigint),
  core.payment_cmd_settle_debt_collection(uuid),
  core.payment_cmd_defer_mit_charge(uuid, text)
TO app_worker;

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.payment_mit_append_only() OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_instrument_guard() OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_mit_consent_guard() OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_post_trip_charge_guard() OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_post_trip_attempt_guard() OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_debt_balance_guard() OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_debt_collection_guard() OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_operation_mit_guard() OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_partial_collection_legs(bigint[], bigint[], bigint)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_trip_mit_consent(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_mit_rule(text, text, text) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_mit_open_debt(uuid, text) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_mit_attempt_due(timestamptz, integer[], integer)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_accept_mit_consent(bytea, uuid, text, integer)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_record_instrument(uuid, uuid, uuid, text, text, text, text, integer,
                                                  integer, text, text) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_ack_mit_reminder(bytea, uuid, text, integer)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_mit_consent_view(bytea, uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_notify_post_trip_charge(uuid, uuid, text, text, text, uuid, integer,
                                                        uuid, bigint, jsonb, boolean)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_plan_mit_attempt(uuid, uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_mit_attempt_for_send(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_settle_mit_attempt(uuid, boolean) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_post_trip_charges_due(integer) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_plan_debt_collection(uuid, uuid, uuid, bigint)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_settle_debt_collection(uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_mit_consent_mode(text) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_mit_consent_mode_of_hold(bytea, uuid) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_defer_mit_charge(uuid, text) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 9. Mode du consentement : lecture du paramètre par cmd_money_owner (liste de 0165 + la clé ;
-- même nom de politique : remplacement admis, ADR-081)
ALTER POLICY cmd_money_sel ON core.config_param_value
  USING (key IN ('payouts_enabled', 'insurer_contract_active', 'funds_holding_enabled',
                 'payout_account_rails', 'payout_account_change_hold_h',
                 'payout_business_day_offset', 'first_payout_business_day',
                 'payout_batch_local_time', 'mit_consent_checkbox_required'));

-- 10. Paramètre `mit_consent_checkbox_required` (DEC-FONDATEUR-22) : bloc GÉNÉRÉ depuis
-- apps/api/src/modules/cfg/data/params.json (`renderParamSeedSql`, groupe `embedded` de
-- POST_SEED_PARAMS) ; seed-sql.test.ts exige ce bloc à l'identique. Ne pas l'éditer à la main.
-- 0169 — graine complémentaire : paramètres « mit_consent_checkbox_required* » (US-703 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « mit_consent_checkbox_required » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('mit_consent_checkbox_required', 'BOOL', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '16 PAY-015, 10b UX-30 (case séparée `web.s05.mitConsent`) ; DEC-FONDATEUR-22 (« jamais plus lourd que Turo ; tout contrôle plus lourd = paramètre pays à false ») ; ADR-189 ; faux : consentement MIT par la mention explicite à côté du bouton de paiement (comme Turo), toujours enregistré ; vrai : case séparée obligatoire ; absent : fail_mode BLOCK, même sens des deux côtés (base : aucun consentement enregistré ; site : aucun paiement offert)', 'PROPOSÉ comme Turo (ADR-189) : mention au bouton, aucune case de plus ; vrai seulement si une règle de réseau ou un avis l’exige dans le pays');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('mit_consent_checkbox_required', 'PA', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-703 : défauts PROPOSÉS (16 PAY-015 ; 10b UX-30 ; DEC-FONDATEUR-22 ; ADR-189)'),
  ('mit_consent_checkbox_required', 'PY', 'COUNTRY', NULL, NULL, 'false'::jsonb, 'graine US-703 : défauts PROPOSÉS (16 PAY-015 ; 10b UX-30 ; DEC-FONDATEUR-22 ; ADR-189)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'mit\_consent\_checkbox\_required%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre mit_consent_checkbox_required* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;
