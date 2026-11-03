-- 0005 — PAY : opérations de paiement et boîte de réception des webhooks (schéma de preuve L0).
-- US-006 ; 17 §3.2.7, §4.4 ; L0-01 (bloc C), L0-08 (webhook_inbox). Appliquée sous `migrator`.
--
-- Sous-ensemble EXACT des entités de 17 §3.2.7 nécessaire aux preuves : la conversion gardée lit
-- l'opération de loyer d'un hold (17 §2.5 étape 4.2) et payment_disposition la référence (0006).
-- Réutilisé par US-019 (port PSP, webhooks), US-023 / US-024. Les montants sont des entiers en
-- unités mineures (bigint, CLAUDE.md point 4) ; aucun calcul d'argent ici.
-- Non couvert (ajouts additifs des stories PAY) : psp_account (FK psp_account_id), jambes
-- payment_operation_leg et leur contrainte de somme différée (US-019 / US-023, revue argent),
-- payment_operation_event, payment_operation_link, colonnes de change.
--
-- Retour arrière (tables vides) :
--   ALTER TABLE core.booking_checkout_hold DROP CONSTRAINT checkout_hold_conversion_operation_fk;
--   ALTER TABLE core.booking_hold_compensation DROP CONSTRAINT hold_compensation_operation_fk;
--   DROP TABLE core.payment_webhook_inbox, core.payment_payment_operation;

-- 1. Opération de paiement (17 §3.2.7) --------------------------------------------------------
CREATE TABLE core.payment_payment_operation (
  id                 uuid        PRIMARY KEY,
  hold_id            uuid        REFERENCES core.booking_checkout_hold (id),
  trip_id            uuid        REFERENCES core.booking_trip (id),  -- nul avant la conversion (F5)
  country_code       text        NOT NULL
    CONSTRAINT payment_operation_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- fournisseur : la liste fermée appartient à psp_account (US-019) ; ici, son format seulement
  provider           text        NOT NULL
    CONSTRAINT payment_operation_provider_format CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  method             text,
  kind               text        NOT NULL
    CONSTRAINT payment_operation_kind_valid CHECK (kind IN
      ('AUTH', 'CAPTURE', 'VOID', 'REFUND', 'MIT_CHARGE', 'DEBT_COLLECTION', 'CREDIT_REDEMPTION',
       'CREDIT_REISSUE', 'CHARGEBACK', 'CHARGEBACK_REVERSAL', 'DEPOSIT_AUTH', 'DEPOSIT_CAPTURE',
       'DEPOSIT_VOID', 'LEG_REALLOCATION', 'LEG_RELEASE')),   -- LINK_PAYMENT : sans objet (P2P)
  purpose            text        NOT NULL
    CONSTRAINT payment_operation_purpose_valid CHECK (purpose IN
      ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION', 'DEPOSIT', 'INCIDENTAL', 'DAMAGE',
       'OTHER_DEBT')),
  amount_minor       bigint      NOT NULL
    CONSTRAINT payment_operation_amount_positive CHECK (amount_minor > 0),
  currency           text        NOT NULL
    CONSTRAINT payment_operation_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  attempt_no         integer     NOT NULL
    CONSTRAINT payment_operation_attempt_positive CHECK (attempt_no >= 1),
  status             text        NOT NULL           -- projection ; rang §4.4 point 7
    CONSTRAINT payment_operation_status_valid CHECK (status IN
      ('PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  idem_plain         text        NOT NULL
    CONSTRAINT payment_operation_idem_plain_unique UNIQUE,
  idem_sent          text        NOT NULL,
  provider_reference text,
  proof_type         text
    CONSTRAINT payment_operation_proof_type_valid CHECK (proof_type IN ('WEBHOOK_SIGNED', 'POLL')),
  created_at         timestamptz NOT NULL DEFAULT platform.now(),
  updated_at         timestamptz NOT NULL DEFAULT platform.now(),
  row_version        integer     NOT NULL DEFAULT 0,
  CONSTRAINT payment_operation_has_subject CHECK (trip_id IS NOT NULL OR hold_id IS NOT NULL),
  -- cohérence kind / purpose (17 §3.2.7)
  CONSTRAINT payment_operation_deposit_kind CHECK (
    (kind IN ('DEPOSIT_AUTH', 'DEPOSIT_CAPTURE', 'DEPOSIT_VOID')) = (purpose = 'DEPOSIT')),
  CONSTRAINT payment_operation_auth_capture_purpose CHECK (
    kind NOT IN ('AUTH', 'CAPTURE') OR purpose IN ('RENT', 'RENT_SHORTFALL')),
  CONSTRAINT payment_operation_mit_purpose CHECK (
    kind <> 'MIT_CHARGE' OR purpose IN
      ('RENT_SHORTFALL', 'NO_SHOW_RETENTION', 'INCIDENTAL', 'DAMAGE', 'OTHER_DEBT'))
);

CREATE INDEX payment_operation_hold_idx ON core.payment_payment_operation (hold_id)
  WHERE (hold_id IS NOT NULL);

CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_payment_operation
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

ALTER TABLE core.booking_checkout_hold
  ADD CONSTRAINT checkout_hold_conversion_operation_fk
  FOREIGN KEY (conversion_operation_id) REFERENCES core.payment_payment_operation (id);
ALTER TABLE core.booking_hold_compensation
  ADD CONSTRAINT hold_compensation_operation_fk
  FOREIGN KEY (operation_id) REFERENCES core.payment_payment_operation (id);

COMMENT ON TABLE core.payment_payment_operation IS
  'PAY payment_operation (17 §3.2.7), sous-ensemble. Montants immuables, seul status évolue. '
  'Insérée par les commandes (cmd_start_payment, US-023) ; statut appliqué par les travailleurs.';

-- 2. Boîte de réception des webhooks (17 §3.2.7, §4.4 point 3) --------------------------------
CREATE TABLE core.payment_webhook_inbox (
  id                uuid        PRIMARY KEY,
  provider          text        NOT NULL
    CONSTRAINT webhook_inbox_provider_format CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  psp_account_id    uuid,                           -- FK psp_account : US-019
  provider_event_id text,
  dedup_key         bytea       NOT NULL,           -- provider_event_id, sinon sha256(provider ‖ compte ‖ corps)
  received_at       timestamptz NOT NULL DEFAULT platform.now(),
  signature_valid   boolean     NOT NULL,
  headers           jsonb,
  raw_body_enc      bytea,                          -- [C2] chiffré (US-019)
  processing_status text        NOT NULL DEFAULT 'RECEIVED'
    CONSTRAINT webhook_inbox_processing_status_valid CHECK (processing_status IN
      ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'QUARANTINED', 'FAILED', 'REJECTED_SIGNATURE')),
  processed_at      timestamptz,
  error             text,
  -- 17 §4.4, corrigé VERIF_14-F23 : un psp_account_id nul ne contourne pas le dédoublonnage
  CONSTRAINT webhook_inbox_dedup UNIQUE NULLS NOT DISTINCT (provider, psp_account_id, dedup_key)
);

COMMENT ON TABLE core.payment_webhook_inbox IS
  'PAY webhook_inbox (17 §4.4). Doublon => 23505 sur webhook_inbox_dedup => réponse 200 sans '
  'traitement (code WEBHOOK_DUPLICATE). Classe A.';

-- 3. RLS ENABLE + FORCE --------------------------------------------------------------------------
ALTER TABLE core.payment_payment_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_payment_operation FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payment_payment_operation TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.payment_webhook_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_webhook_inbox FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payment_webhook_inbox TO migrator USING (true) WITH CHECK (true);

REVOKE ALL ON core.payment_payment_operation, core.payment_webhook_inbox FROM PUBLIC;
