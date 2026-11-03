-- 0027 — PAY : port PaymentProvider, comptes et capacités PSP, jambes, événements d'opération,
-- idempotence et réception des webhooks ; garde FAKE (C19).
-- US-019 ; 17 §2.8, §3.2.7, §4.3, §4.4, §6.5 ; 08 E4, E7 (règles 1, 4, 10) ; ADR-032, ADR-045,
-- ADR-056. Appliquée sous `migrator`.
--
-- Contenu :
--   0. platform.deployment_env() : environnement de déploiement de la BASE (17 §6.5 point 1).
--      Valeur de production : 'production' (fail-closed). Seule la migration d'environnement
--      (US-003) ou, en test, test-migrations/9400 la remplacent.
--   1. core.payment_psp_account : compte marchand de Kmino par (provider, pays, environnement) ;
--      garde FAKE : CHECK « FAKE ⇒ SANDBOX » et trigger « aucune écriture d'un FAKE en
--      production » (17 §3.2.7, §6.5 point 1, C19).
--   2. core.payment_psp_capability : matrice de capacités (configuration, lecture fail-closed).
--   3. core.payment_payment_operation : compte PSP de l'opération (psp_account_id).
--   4. core.payment_payment_operation_leg : jambes explicites (08 E7 règle 1), immuables, avec
--      contrôle différé « Σ jambes = montant, chaque jambe ≥ 0 » (LEG_REALLOCATION : Σ = 0).
--   5. core.payment_payment_operation_event : historique des statuts (17 §4.4 point 8).
--   6. core.payment_webhook_inbox : événements normalisés (traitement asynchrone, §4.4 point 5)
--      et garde « aucun PAN » (17 §1.6, §4.4 point 3, F26).
--   7. Commandes SECURITY DEFINER (propriétaire cmd_money_owner, liste blanche RLS-15) :
--      payment_cmd_record_operation, payment_cmd_apply_operation_status,
--      payment_resolve_webhook_account, payment_cmd_receive_webhook, payment_startup_guard.
--
-- Écarts assumés (à reporter dans 17 par l'orchestrateur, ADR-056) :
--   - collection_mode : PLATFORM_MOR refusé par CHECK tant qu'aucune garde ne lit
--     funds_holding_enabled[pays] (fail-closed ; US-125) ;
--   - garde FAKE plus stricte que 17 §3.2.7 : en production, AUCUNE écriture d'un compte FAKE
--     (et pas seulement son activation) ;
--   - webhook_inbox.normalized_events (jsonb) : événements normalisés stockés à la réception ;
--     raw_body_enc reste NULL tant que le chiffrement par KMS n'existe pas (US-003) ;
--   - payment_operation_event.outcome : APPLIED, DUPLICATE, STALE ou CONFLICT (rangs §4.4 point 7) ;
--   - webhook_inbox.psp_account_id : clé étrangère non posée (L0-08 insère des comptes fictifs ;
--     la commande de réception ne connaît que des comptes existants).
--
-- Retour arrière (tables vides) :
--   DROP FUNCTION core.payment_cmd_record_operation(uuid, uuid, uuid, uuid, text, text, text, bigint,
--     text, integer, text, text, jsonb), core.payment_cmd_apply_operation_status(uuid, text, text,
--     uuid, text), core.payment_resolve_webhook_account(text, text),
--     core.payment_cmd_receive_webhook(uuid, text, bytea, boolean, timestamptz, jsonb, jsonb),
--     core.payment_startup_guard();
--   ALTER TABLE core.payment_webhook_inbox DROP CONSTRAINT webhook_inbox_no_pan,
--     DROP COLUMN normalized_events;
--   DROP TABLE core.payment_payment_operation_event, core.payment_payment_operation_leg;
--   DROP TRIGGER payment_operation_legs_check ON core.payment_payment_operation;
--   DROP FUNCTION core.payment_assert_operation_legs();
--   ALTER TABLE core.payment_payment_operation DROP COLUMN psp_account_id;
--   DROP TABLE core.payment_psp_capability, core.payment_psp_account;
--   DROP FUNCTION core.payment_psp_account_fake_guard(), core.payment_text_has_pan(text),
--     platform.deployment_env();
--   REVOKE … FROM cmd_money_owner, integrity_owner (droits de la section 8).

-- 0. Environnement de déploiement de la base (17 §6.5 point 1) --------------------------------
-- Constante écrite par migration : jamais un paramètre de session (forgeable par un rôle
-- applicatif). STABLE pour que la version de test (9400) puisse lire un paramètre.
CREATE FUNCTION platform.deployment_env()
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT 'production'::text
$fn$;

COMMENT ON FUNCTION platform.deployment_env() IS
  'Environnement de déploiement de la base (17 §6.5) : production par défaut (fail-closed). '
  'Remplacée par la migration d''environnement (US-003) ou, en test, par test-migrations/9400.';

REVOKE ALL ON FUNCTION platform.deployment_env() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.deployment_env() TO app_api, app_worker, cmd_money_owner;

-- 1. Compte marchand de Kmino (17 §3.2.7, §2.8 ; ADR-045) ---------------------------------------
CREATE TABLE core.payment_psp_account (
  id                 uuid        PRIMARY KEY,
  provider           text        NOT NULL
    CONSTRAINT psp_account_provider_valid CHECK (provider IN
      ('TILOPAY', 'DLOCAL', 'BAC', 'PAGUELOFACIL', 'BANCARD_VPOS', 'UPAY', 'EBANX', 'FAKE')),
  owner_type         text        NOT NULL DEFAULT 'PLATFORM'
    CONSTRAINT psp_account_owner_platform CHECK (owner_type = 'PLATFORM'),
  country_code       text        NOT NULL
    CONSTRAINT psp_account_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  environment        text        NOT NULL
    CONSTRAINT psp_account_environment_valid CHECK (environment IN ('SANDBOX', 'LIVE')),
  collection_mode    text        NOT NULL DEFAULT 'SPLIT_AT_SOURCE'
    CONSTRAINT psp_account_collection_mode_valid CHECK (collection_mode IN
      ('SPLIT_AT_SOURCE', 'PLATFORM_MOR')),
  -- références de coffre [C4] : jamais le secret lui-même (17 §1.6)
  credentials_ref    text
    CONSTRAINT psp_account_credentials_ref_format CHECK (credentials_ref ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]{1,256}$'),
  webhook_secret_ref text
    CONSTRAINT psp_account_webhook_secret_ref_format CHECK (webhook_secret_ref ~ '^[a-z][a-z0-9+.-]*:[^[:space:]]{1,256}$'),
  public_webhook_id  text        NOT NULL
    CONSTRAINT psp_account_public_webhook_id_format CHECK (public_webhook_id ~ '^[A-Za-z0-9_-]{16,64}$')
    CONSTRAINT psp_account_public_webhook_id_unique UNIQUE,
  status             text        NOT NULL DEFAULT 'PENDING_VALIDATION'
    CONSTRAINT psp_account_status_valid CHECK (status IN
      ('PENDING_VALIDATION', 'ACTIVE', 'SUSPENDED')),
  gate_decision_ref  text,                          -- porte PAY-041 (opération de test, lot C)
  last_webhook_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT platform.now(),
  updated_at         timestamptz NOT NULL DEFAULT platform.now(),
  row_version        integer     NOT NULL DEFAULT 0,
  -- 17 §6.5 point 1 (VERIF_17-A7) : un FAKE n'est jamais LIVE
  CONSTRAINT psp_account_fake_sandbox_only CHECK (provider <> 'FAKE' OR environment = 'SANDBOX'),
  -- variante B fermée tant que funds_holding_enabled[pays] n'est lue par aucune garde (US-125)
  CONSTRAINT psp_account_platform_mor_closed CHECK (collection_mode <> 'PLATFORM_MOR'),
  -- un compte réel n'est activé qu'après la porte PAY-041
  CONSTRAINT psp_account_live_gate CHECK (
    status <> 'ACTIVE' OR environment <> 'LIVE' OR gate_decision_ref IS NOT NULL)
);

-- un compte ACTIVE par (provider, pays, environnement) (17 §3.2.7)
CREATE UNIQUE INDEX psp_account_one_active
  ON core.payment_psp_account (provider, country_code, environment) WHERE (status = 'ACTIVE');

CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_psp_account
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

-- Garde FAKE (17 §6.5 point 1, C19) : en production, aucune écriture d'un compte FAKE.
-- SECURITY INVOKER : platform.deployment_env() est lue sous le rôle qui écrit.
CREATE FUNCTION core.payment_psp_account_fake_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.provider = 'FAKE' AND platform.deployment_env() = 'production' THEN
    RAISE EXCEPTION 'psp_account: FAKE provider forbidden in production (C19)'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'psp_account_fake_forbidden';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_psp_account_fake_guard() FROM PUBLIC;

CREATE TRIGGER psp_account_fake_guard BEFORE INSERT OR UPDATE ON core.payment_psp_account
  FOR EACH ROW EXECUTE FUNCTION core.payment_psp_account_fake_guard();

COMMENT ON TABLE core.payment_psp_account IS
  'PAY psp_account (17 §3.2.7) : compte marchand de Kmino, owner_type PLATFORM. Identifiants par '
  'référence de coffre seulement. Garde FAKE : CHECK SANDBOX + trigger production (C19). Classe B.';

-- 2. Matrice de capacités (17 §2.8, §3.2.7) ----------------------------------------------------
-- Configuration et non code ; seule une ligne VALIDATED_* est utilisée, toute autre vaut « non »
-- (lecture fail-closed côté application, apps/api/src/modules/pay).
CREATE TABLE core.payment_psp_capability (
  provider     text        NOT NULL
    CONSTRAINT psp_capability_provider_format CHECK (provider ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  country_code text        NOT NULL
    CONSTRAINT psp_capability_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  method       text        NOT NULL
    CONSTRAINT psp_capability_method_valid CHECK (method IN
      ('*', 'CARD', 'YAPPY', 'CLAVE', 'QR', 'PIX', 'BANK_TRANSFER')),
  network      text        NOT NULL DEFAULT '*'
    CONSTRAINT psp_capability_network_valid CHECK (network IN ('*', 'VISA', 'MASTERCARD', 'AMEX')),
  capability   text        NOT NULL
    CONSTRAINT psp_capability_name_format CHECK (capability ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  value        jsonb       NOT NULL,
  status       text        NOT NULL
    CONSTRAINT psp_capability_status_valid CHECK (status IN
      ('VALIDATED_SANDBOX', 'VALIDATED_CONTRACT', 'DOCUMENTED', 'UNKNOWN')),
  source       text        NOT NULL CONSTRAINT psp_capability_source_present CHECK (source <> ''),
  validated_at timestamptz,
  valid_from   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT psp_capability_pkey PRIMARY KEY (provider, country_code, method, network, capability, valid_from),
  CONSTRAINT psp_capability_validated_dated CHECK (
    status NOT IN ('VALIDATED_SANDBOX', 'VALIDATED_CONTRACT') OR validated_at IS NOT NULL)
);

COMMENT ON TABLE core.payment_psp_capability IS
  'PAY psp_capability (17 §2.8) : capacité inconnue ou non VALIDATED_* = non. Classe C.';

-- 3. Compte PSP de l'opération -------------------------------------------------------------------
-- Nul pour les opérations écrites avant US-019 (fixtures US-006 / US-011) ; toute opération créée
-- par payment_cmd_record_operation le renseigne (et porte alors ses jambes, section 4).
ALTER TABLE core.payment_payment_operation
  ADD COLUMN psp_account_id uuid
    CONSTRAINT payment_operation_psp_account_fk REFERENCES core.payment_psp_account (id);

-- 4. Jambes d'une opération (17 §3.2.7, 08 E7 règle 1) -------------------------------------------
CREATE TABLE core.payment_payment_operation_leg (
  operation_id    uuid        NOT NULL
    CONSTRAINT payment_operation_leg_operation_fk REFERENCES core.payment_payment_operation (id),
  leg             text        NOT NULL
    CONSTRAINT payment_operation_leg_name CHECK (leg IN
      ('HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM')),
  org_id          uuid,                             -- compte d'hôte (portée RLS, US-062)
  country_code    text        NOT NULL
    CONSTRAINT payment_operation_leg_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  amount_minor    bigint      NOT NULL,             -- signe : contrôle différé ci-dessous
  beneficiary_ref text,                             -- sous-marchand, assureur (US-061)
  created_at      timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT payment_operation_leg_pkey PRIMARY KEY (operation_id, leg)
);

COMMENT ON TABLE core.payment_payment_operation_leg IS
  'PAY payment_operation_leg (17 §3.2.7) : montant explicite de chaque jambe, jamais un prorata '
  '(08 E7 règle 1). Immuable (aucun UPDATE ni DELETE accordé). Classe A.';

-- Contrôle différé (au COMMIT) : une opération rattachée à un compte PSP et qui déplace des fonds
-- a exactement ses 4 jambes ; Σ jambes = montant et chaque jambe ≥ 0, sauf LEG_REALLOCATION
-- (Σ = 0, Σ des jambes créditées = montant). Les opérations VOID, DEPOSIT_VOID, DEPOSIT_AUTH,
-- CHARGEBACK et CHARGEBACK_REVERSAL ne portent aucune jambe.
-- SECURITY DEFINER (famille integrity_trigger, ADR-048) : au COMMIT, le rôle courant est celui de
-- la session, que la RLS empêcherait de tout relire.
CREATE FUNCTION core.payment_assert_operation_legs()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_op      uuid;
  v_kind    text;
  v_amount  bigint;
  v_account uuid;
  v_n       integer;
  v_sum     numeric;
  v_pos     numeric;
  v_neg     boolean;
BEGIN
  IF TG_TABLE_NAME = 'payment_payment_operation' THEN
    v_op := NEW.id;
  ELSE
    v_op := NEW.operation_id;
  END IF;
  SELECT o.kind, o.amount_minor, o.psp_account_id INTO v_kind, v_amount, v_account
    FROM core.payment_payment_operation AS o WHERE o.id = v_op;
  SELECT count(*)::integer, COALESCE(sum(l.amount_minor), 0),
         COALESCE(sum(l.amount_minor) FILTER (WHERE l.amount_minor > 0), 0),
         COALESCE(bool_or(l.amount_minor < 0), false)
    INTO v_n, v_sum, v_pos, v_neg
    FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = v_op;
  IF v_account IS NULL THEN
    -- opération antérieure au port (fixtures) : aucune jambe ne peut lui être rattachée
    IF v_n > 0 THEN
      RAISE EXCEPTION 'payment_operation_leg: legs on an operation without PSP account'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_legs_complete';
    END IF;
    RETURN NULL;
  END IF;
  IF v_kind IN ('VOID', 'DEPOSIT_VOID', 'DEPOSIT_AUTH', 'CHARGEBACK', 'CHARGEBACK_REVERSAL') THEN
    IF v_n > 0 THEN
      RAISE EXCEPTION 'payment_operation_leg: % carries no leg', v_kind
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_legs_complete';
    END IF;
    RETURN NULL;
  END IF;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'payment_operation_leg: % legs, 4 expected', v_n
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_legs_complete';
  END IF;
  IF v_kind = 'LEG_REALLOCATION' THEN
    IF v_sum <> 0 OR v_pos <> v_amount THEN
      RAISE EXCEPTION 'payment_operation_leg: reallocation legs must sum to zero'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_leg_sum';
    END IF;
  ELSE
    IF v_neg THEN
      RAISE EXCEPTION 'payment_operation_leg: negative leg'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_leg_negative';
    END IF;
    IF v_sum <> v_amount THEN
      RAISE EXCEPTION 'payment_operation_leg: legs do not sum to the operation amount'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_leg_sum';
    END IF;
  END IF;
  RETURN NULL;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_assert_operation_legs() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER payment_operation_legs_check
  AFTER INSERT ON core.payment_payment_operation
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.payment_assert_operation_legs();
CREATE CONSTRAINT TRIGGER payment_operation_legs_check
  AFTER INSERT ON core.payment_payment_operation_leg
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION core.payment_assert_operation_legs();

-- 5. Historique des statuts d'une opération (17 §3.2.7, §4.4 points 7 et 8) -----------------------
CREATE TABLE core.payment_payment_operation_event (
  id           uuid        PRIMARY KEY,
  operation_id uuid        NOT NULL
    CONSTRAINT payment_operation_event_operation_fk REFERENCES core.payment_payment_operation (id),
  status       text        NOT NULL
    CONSTRAINT payment_operation_event_status_valid CHECK (status IN
      ('PENDING', 'SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  source       text        NOT NULL
    CONSTRAINT payment_operation_event_source_valid CHECK (source IN
      ('API_RESPONSE', 'WEBHOOK', 'POLL', 'MANUAL_OPS')),
  -- APPLIED : transition appliquée ; DUPLICATE : même statut ; STALE : rang inférieur, ignoré ;
  -- CONFLICT : terminal contradictoire, rien n'est changé (lecture getOperation puis file ops)
  outcome      text        NOT NULL
    CONSTRAINT payment_operation_event_outcome_valid CHECK (outcome IN
      ('APPLIED', 'DUPLICATE', 'STALE', 'CONFLICT')),
  raw_ref      uuid
    CONSTRAINT payment_operation_event_raw_ref_fk REFERENCES core.payment_webhook_inbox (id),
  at           timestamptz NOT NULL DEFAULT platform.now()
);

CREATE INDEX payment_operation_event_operation_idx
  ON core.payment_payment_operation_event (operation_id, at);

COMMENT ON TABLE core.payment_payment_operation_event IS
  'PAY payment_operation_event (17 §3.2.7) : chaque statut reçu, appliqué ou non. Immuable. Classe A.';

-- 6. Boîte de réception : événements normalisés et garde « aucun PAN » (17 §1.6, §4.4) ------------
-- Détecteur de PAN (17 §4.4 point 3, F26) : suite de 13 à 19 chiffres (espaces ou tirets simples
-- tolérés entre chiffres) valide au contrôle de Luhn. Même définition que pay/internal/pan.ts.
CREATE FUNCTION core.payment_text_has_pan(p_text text)
  RETURNS boolean
  LANGUAGE plpgsql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_run    text;
  v_digits text;
  v_sum    integer;
  v_digit  integer;
  v_double boolean;
  i        integer;
BEGIN
  IF p_text IS NULL THEN
    RETURN false;
  END IF;
  FOR v_run IN SELECT m[1] FROM regexp_matches(p_text, '([0-9](?:[ -]?[0-9])*)', 'g') AS m LOOP
    v_digits := translate(v_run, ' -', '');
    IF length(v_digits) BETWEEN 13 AND 19 THEN
      v_sum := 0;
      v_double := false;
      FOR i IN REVERSE length(v_digits)..1 LOOP
        v_digit := ascii(substr(v_digits, i, 1)) - 48;
        IF v_double THEN
          v_digit := v_digit * 2;
          IF v_digit > 9 THEN
            v_digit := v_digit - 9;
          END IF;
        END IF;
        v_sum := v_sum + v_digit;
        v_double := NOT v_double;
      END LOOP;
      IF v_sum % 10 = 0 THEN
        RETURN true;
      END IF;
    END IF;
  END LOOP;
  RETURN false;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_text_has_pan(text) FROM PUBLIC;
-- évaluée par la contrainte ci-dessous sous le rôle qui écrit la boîte de réception
GRANT EXECUTE ON FUNCTION core.payment_text_has_pan(text) TO app_worker, cmd_money_owner;

ALTER TABLE core.payment_webhook_inbox
  ADD COLUMN normalized_events jsonb
    CONSTRAINT webhook_inbox_normalized_events_array CHECK (
      normalized_events IS NULL OR jsonb_typeof(normalized_events) = 'array'),
  ADD CONSTRAINT webhook_inbox_no_pan CHECK (
    NOT core.payment_text_has_pan(headers::text)
    AND NOT core.payment_text_has_pan(normalized_events::text)
    AND NOT core.payment_text_has_pan(provider_event_id));

COMMENT ON COLUMN core.payment_webhook_inbox.normalized_events IS
  'Événements internes normalisés par verifyAndParseWebhook (17 §4.4 point 5), sans PAN (US-019).';

-- 7. Droits et politiques du propriétaire des commandes d'argent (cmd_money_owner) ----------------
GRANT USAGE ON SCHEMA core TO cmd_money_owner;
GRANT USAGE ON SCHEMA app TO cmd_money_owner;
GRANT EXECUTE ON FUNCTION app.actor_kind(), app.worker_name() TO cmd_money_owner;

GRANT SELECT ON core.payment_psp_account TO cmd_money_owner;
GRANT SELECT (id, org_id, country_code) ON core.booking_checkout_hold TO cmd_money_owner;
GRANT SELECT (id, org_id, country_code, currency) ON core.booking_trip TO cmd_money_owner;
GRANT SELECT, INSERT ON core.payment_payment_operation TO cmd_money_owner;
GRANT UPDATE (status, provider_reference, proof_type) ON core.payment_payment_operation TO cmd_money_owner;
GRANT SELECT, INSERT ON core.payment_payment_operation_leg TO cmd_money_owner;
GRANT SELECT, INSERT ON core.payment_payment_operation_event TO cmd_money_owner;
-- colonnes de l'arbitre webhook_inbox_dedup (ON CONFLICT) et identifiant rendu
GRANT SELECT (id, provider, psp_account_id, dedup_key) ON core.payment_webhook_inbox TO cmd_money_owner;
GRANT INSERT (id, provider, psp_account_id, provider_event_id, dedup_key, signature_valid, headers,
              processing_status, error, normalized_events)
  ON core.payment_webhook_inbox TO cmd_money_owner;
GRANT UPDATE (last_webhook_at) ON core.payment_psp_account TO cmd_money_owner;

CREATE POLICY money_cmd_read ON core.payment_psp_account FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY money_cmd_touch ON core.payment_psp_account FOR UPDATE TO cmd_money_owner
  USING (true) WITH CHECK (true);
CREATE POLICY money_cmd_read ON core.booking_checkout_hold FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY money_cmd_read ON core.booking_trip FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY money_cmd_read ON core.payment_payment_operation FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY money_cmd_insert ON core.payment_payment_operation FOR INSERT TO cmd_money_owner
  WITH CHECK (status = 'PENDING' AND psp_account_id IS NOT NULL);
CREATE POLICY money_cmd_update ON core.payment_payment_operation FOR UPDATE TO cmd_money_owner
  USING (psp_account_id IS NOT NULL) WITH CHECK (psp_account_id IS NOT NULL);
CREATE POLICY money_cmd_read ON core.payment_payment_operation_leg FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY money_cmd_insert ON core.payment_payment_operation_leg FOR INSERT TO cmd_money_owner
  WITH CHECK (true);
CREATE POLICY money_cmd_read ON core.payment_payment_operation_event FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY money_cmd_insert ON core.payment_payment_operation_event FOR INSERT TO cmd_money_owner
  WITH CHECK (true);
CREATE POLICY money_cmd_read ON core.payment_webhook_inbox FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY money_cmd_insert ON core.payment_webhook_inbox FOR INSERT TO cmd_money_owner
  WITH CHECK (psp_account_id IS NOT NULL);

-- integrity_owner : lecture seule des colonnes du contrôle différé (section 4)
GRANT SELECT (amount_minor, psp_account_id) ON core.payment_payment_operation TO integrity_owner;
GRANT SELECT ON core.payment_payment_operation_leg TO integrity_owner;
CREATE POLICY integrity_read ON core.payment_payment_operation_leg FOR SELECT TO integrity_owner USING (true);

-- Travailleurs : lecture des jambes et des événements (travailleur de commandes, webhooks).
GRANT SELECT ON core.payment_payment_operation_leg, core.payment_payment_operation_event TO app_worker;
CREATE POLICY worker_select ON core.payment_payment_operation_leg FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('money_command', 'webhook_ingest'));
CREATE POLICY worker_select ON core.payment_payment_operation_event FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('money_command', 'webhook_ingest'));

-- API (17 §3.2.7, RLS) : l'hôte TITULAIRE lit sa seule jambe HOST ; ADMIN / FINANCE du pays lisent
-- tout ; jamais le voyageur ni app_anon. Lecture par colonnes (US-011).
GRANT SELECT (operation_id, leg, org_id, country_code, amount_minor, created_at)
  ON core.payment_payment_operation_leg TO app_api;
CREATE POLICY leg_host_read ON core.payment_payment_operation_leg FOR SELECT TO app_api
  USING (app.actor_kind() = 'HOST' AND leg = 'HOST' AND org_id = app.org_id() AND app.is_org_holder());
CREATE POLICY leg_staff_read ON core.payment_payment_operation_leg FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code) OR app.has_staff_role('FINANCE', country_code)));

-- Capacités : données de référence lues par l'API (offre de moyens) et les travailleurs.
GRANT SELECT ON core.payment_psp_capability TO app_api, app_worker;
CREATE POLICY reference_read ON core.payment_psp_capability FOR SELECT TO app_api, app_worker
  USING (true);

-- 8. Commandes SECURITY DEFINER (propriétaire cmd_money_owner ; liste blanche RLS-15) -----------

-- 8.1 Enregistrer une opération planifiée avec ses jambes (17 §4.3 point 1 ; 08 E4).
-- Idempotence : même idem_plain et même contenu (montant, devise, nature, objet, compte, tentative,
-- jambes) ⇒ l'opération existante est rendue (replayed = true) ; même clé et contenu différent ⇒
-- IDEMPOTENCY_CONFLICT (16, fiche PAY-019). Réservée au travailleur de commandes.
CREATE FUNCTION core.payment_cmd_record_operation(
  p_id             uuid,
  p_hold_id        uuid,
  p_trip_id        uuid,
  p_psp_account_id uuid,
  p_method         text,
  p_kind           text,
  p_purpose        text,
  p_amount_minor   bigint,
  p_currency       text,
  p_attempt_no     integer,
  p_idem_plain     text,
  p_idem_sent      text,
  p_legs           jsonb
)
  RETURNS TABLE (operation_id uuid, replayed boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_provider    text;
  v_country     text;
  v_status      text;
  v_org         uuid;
  v_subject_cty text;
  v_trip_cur    text;
  v_keys        text[];
  v_leg         text;
  v_value       text;
  v_inserted    uuid;
  v_sum         numeric := 0;
  v_pos         numeric := 0;
  v_neg         boolean := false;
  v_existing    core.payment_payment_operation%ROWTYPE;
  v_same_legs   boolean;
  v_no_legs     boolean := p_kind IN ('VOID', 'DEPOSIT_VOID', 'DEPOSIT_AUTH', 'CHARGEBACK',
                                      'CHARGEBACK_REVERSAL');
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'money_command' THEN
    RAISE EXCEPTION 'payment: record_operation reserved to the money_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_idem_plain IS NULL OR length(p_idem_plain) NOT BETWEEN 1 AND 512 THEN
    RAISE EXCEPTION 'payment: invalid idempotency key' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- valeur transmise au PSP : idem_plain, ou hex(sha256(idem_plain)) (08 E4, 17 §2.8)
  IF p_idem_sent IS DISTINCT FROM p_idem_plain
     AND p_idem_sent IS DISTINCT FROM encode(sha256(convert_to(p_idem_plain, 'UTF8')), 'hex') THEN
    RAISE EXCEPTION 'payment: idem_sent is neither idem_plain nor its SHA-256'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- compte marchand ACTIVE, jamais un FAKE en production (17 §4.3 point 5.7)
  SELECT a.provider, a.country_code, a.status INTO v_provider, v_country, v_status
    FROM core.payment_psp_account AS a WHERE a.id = p_psp_account_id;
  IF NOT FOUND OR v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'payment: PSP account not active'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_account_active';
  END IF;
  IF v_provider = 'FAKE' AND platform.deployment_env() = 'production' THEN
    RAISE EXCEPTION 'payment: FAKE provider forbidden in production (C19)'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'psp_account_fake_forbidden';
  END IF;

  -- objet de l'opération : même pays que le compte ; devise du trip (17 §3.1.5)
  IF p_trip_id IS NOT NULL THEN
    SELECT t.org_id, t.country_code, t.currency INTO v_org, v_subject_cty, v_trip_cur
      FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  ELSE
    SELECT h.org_id, h.country_code INTO v_org, v_subject_cty
      FROM core.booking_checkout_hold AS h WHERE h.id = p_hold_id;
  END IF;
  IF v_subject_cty IS NULL OR v_subject_cty <> v_country
     OR (v_trip_cur IS NOT NULL AND v_trip_cur <> p_currency) THEN
    RAISE EXCEPTION 'payment: operation subject, account country or currency mismatch'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'payment_operation_subject_mismatch';
  END IF;

  -- jambes : exactement HOST, INSURER, TAX_THIRD_PARTY, PLATFORM, entiers en texte (bigint)
  IF v_no_legs THEN
    IF p_legs IS NOT NULL THEN
      RAISE EXCEPTION 'payment: % carries no leg', p_kind USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSE
    IF p_legs IS NULL OR jsonb_typeof(p_legs) <> 'object' THEN
      RAISE EXCEPTION 'payment: legs required' USING ERRCODE = 'invalid_parameter_value';
    END IF;
    SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(p_legs) AS k;
    IF v_keys IS DISTINCT FROM ARRAY['HOST', 'INSURER', 'PLATFORM', 'TAX_THIRD_PARTY'] THEN
      RAISE EXCEPTION 'payment: legs must be HOST, INSURER, TAX_THIRD_PARTY, PLATFORM'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    FOREACH v_leg IN ARRAY v_keys LOOP
      IF jsonb_typeof(p_legs -> v_leg) <> 'string' THEN
        RAISE EXCEPTION 'payment: leg % must be an integer string', v_leg
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_value := p_legs ->> v_leg;
      IF v_value !~ '^-?[0-9]{1,18}$' THEN
        RAISE EXCEPTION 'payment: leg % must be an integer string', v_leg
          USING ERRCODE = 'invalid_parameter_value';
      END IF;
      v_sum := v_sum + v_value::numeric;
      IF v_value::numeric > 0 THEN
        v_pos := v_pos + v_value::numeric;
      ELSIF v_value::numeric < 0 THEN
        v_neg := true;
      END IF;
    END LOOP;
    -- contrôle immédiat (le contrôle différé payment_operation_legs_check le refait au COMMIT) :
    -- Σ jambes = montant et chaque jambe ≥ 0 ; LEG_REALLOCATION : Σ = 0 (08 E7 règles 1, 3, 5)
    IF p_kind = 'LEG_REALLOCATION' THEN
      IF v_sum <> 0 OR v_pos <> p_amount_minor THEN
        RAISE EXCEPTION 'payment: reallocation legs must sum to zero'
          USING ERRCODE = 'integrity_constraint_violation',
                CONSTRAINT = 'payment_operation_leg_sum';
      END IF;
    ELSE
      IF v_neg THEN
        RAISE EXCEPTION 'payment: negative leg'
          USING ERRCODE = 'integrity_constraint_violation',
                CONSTRAINT = 'payment_operation_leg_negative';
      END IF;
      IF v_sum <> p_amount_minor THEN
        RAISE EXCEPTION 'payment: legs do not sum to the operation amount'
          USING ERRCODE = 'integrity_constraint_violation',
                CONSTRAINT = 'payment_operation_leg_sum';
      END IF;
    END IF;
  END IF;

  INSERT INTO core.payment_payment_operation AS o
         (id, hold_id, trip_id, psp_account_id, country_code, provider, method, kind, purpose,
          amount_minor, currency, attempt_no, status, idem_plain, idem_sent)
  VALUES (p_id, p_hold_id, p_trip_id, p_psp_account_id, v_country, v_provider, p_method, p_kind,
          p_purpose, p_amount_minor, p_currency, p_attempt_no, 'PENDING', p_idem_plain, p_idem_sent)
  ON CONFLICT ON CONSTRAINT payment_operation_idem_plain_unique DO NOTHING
  RETURNING o.id INTO v_inserted;

  IF v_inserted IS NULL THEN
    -- même clé : rejeu à l'identique, ou conflit d'idempotence
    SELECT * INTO v_existing FROM core.payment_payment_operation AS o
     WHERE o.idem_plain = p_idem_plain;
    IF v_no_legs THEN
      SELECT NOT EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
                          WHERE l.operation_id = v_existing.id)
        INTO v_same_legs;
    ELSE
      SELECT count(*) = 4 AND bool_and(l.amount_minor = (p_legs ->> l.leg)::bigint)
        INTO v_same_legs
        FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = v_existing.id;
    END IF;
    IF v_existing.kind IS DISTINCT FROM p_kind
       OR v_existing.purpose IS DISTINCT FROM p_purpose
       OR v_existing.amount_minor IS DISTINCT FROM p_amount_minor
       OR v_existing.currency IS DISTINCT FROM p_currency
       OR v_existing.hold_id IS DISTINCT FROM p_hold_id
       OR v_existing.trip_id IS DISTINCT FROM p_trip_id
       OR v_existing.psp_account_id IS DISTINCT FROM p_psp_account_id
       OR v_existing.method IS DISTINCT FROM p_method
       OR v_existing.attempt_no IS DISTINCT FROM p_attempt_no
       OR v_existing.idem_sent IS DISTINCT FROM p_idem_sent
       OR v_same_legs IS NOT TRUE THEN
      RAISE EXCEPTION 'payment: same idempotency key, different content'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_idempotency_conflict';
    END IF;
    operation_id := v_existing.id;
    replayed := true;
    RETURN NEXT;
    RETURN;
  END IF;

  IF NOT v_no_legs THEN
    INSERT INTO core.payment_payment_operation_leg (operation_id, leg, org_id, country_code, amount_minor)
    SELECT v_inserted, k, v_org, v_country, (p_legs ->> k)::bigint
      FROM unnest(v_keys) AS k;
  END IF;
  operation_id := v_inserted;
  replayed := false;
  RETURN NEXT;
END
$fn$;

-- 8.2 Appliquer un statut reçu, selon les rangs de 17 §4.4 point 7 : PENDING (0) < SUBMITTED =
-- UNKNOWN (1) < SUCCEEDED = FAILED (2, terminaux). Rang inférieur ⇒ STALE (journalisé, ignoré) ;
-- même statut ⇒ DUPLICATE ; deux terminaux contradictoires ⇒ CONFLICT (rien ne change : lecture
-- getOperation puis file ops). Chaque statut reçu est écrit dans payment_operation_event.
CREATE FUNCTION core.payment_cmd_apply_operation_status(
  p_operation_id       uuid,
  p_status             text,
  p_source             text,
  p_raw_ref            uuid,
  p_provider_reference text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_current   text;
  v_reference text;
  v_rank_cur  integer;
  v_rank_new  integer;
  v_outcome   text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('money_command', 'webhook_ingest') THEN
    RAISE EXCEPTION 'payment: apply_operation_status reserved to payment workers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN') THEN
    RAISE EXCEPTION 'payment: invalid status' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT o.status, o.provider_reference INTO v_current, v_reference
    FROM core.payment_payment_operation AS o
   WHERE o.id = p_operation_id AND o.psp_account_id IS NOT NULL
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  v_rank_cur := CASE v_current WHEN 'PENDING' THEN 0 WHEN 'SUBMITTED' THEN 1 WHEN 'UNKNOWN' THEN 1
                               ELSE 2 END;
  v_rank_new := CASE p_status WHEN 'SUBMITTED' THEN 1 WHEN 'UNKNOWN' THEN 1 ELSE 2 END;

  IF p_status = v_current THEN
    v_outcome := 'DUPLICATE';
  ELSIF v_rank_new < v_rank_cur THEN
    v_outcome := 'STALE';
  ELSIF v_rank_cur = 2 THEN
    v_outcome := 'CONFLICT';                     -- SUCCEEDED contre FAILED
  ELSIF v_reference IS NOT NULL AND p_provider_reference IS NOT NULL
        AND v_reference <> p_provider_reference THEN
    v_outcome := 'CONFLICT';                     -- référence PSP contradictoire
  ELSE
    v_outcome := 'APPLIED';
    UPDATE core.payment_payment_operation AS o
       SET status = p_status,
           provider_reference = COALESCE(o.provider_reference, p_provider_reference),
           proof_type = CASE
                          WHEN p_status IN ('SUCCEEDED', 'FAILED') AND p_source = 'WEBHOOK'
                            THEN 'WEBHOOK_SIGNED'
                          WHEN p_status IN ('SUCCEEDED', 'FAILED') AND p_source = 'POLL'
                            THEN 'POLL'
                          ELSE o.proof_type
                        END
     WHERE o.id = p_operation_id;
  END IF;

  INSERT INTO core.payment_payment_operation_event (id, operation_id, status, source, outcome, raw_ref)
  VALUES (gen_random_uuid(), p_operation_id, p_status, p_source, v_outcome, p_raw_ref);
  RETURN v_outcome;
END
$fn$;

-- 8.3 Résoudre le compte d'un point d'entrée de webhook (17 §4.4) : rien pour un compte inconnu ou
-- pour un FAKE en production (404 sans écriture, C19). Ne rend que la RÉFÉRENCE du secret.
CREATE FUNCTION core.payment_resolve_webhook_account(p_provider text, p_public_webhook_id text)
  RETURNS TABLE (account_id uuid, webhook_secret_ref text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT a.id, a.webhook_secret_ref
    FROM core.payment_psp_account AS a
   WHERE a.provider = p_provider
     AND a.public_webhook_id = p_public_webhook_id
     AND NOT (a.provider = 'FAKE' AND platform.deployment_env() = 'production')
$fn$;

-- 8.4 Recevoir un webhook (17 §4.4 points 2 à 4) : persistance avec dédoublonnage, statut de
-- signature, horodatage signé contrôlé à l'heure de la BASE (tolérance ± 5 min ; hors tolérance
-- avec signature valide ⇒ QUARANTINED). Compte inconnu ou FAKE en production ⇒ NOT_FOUND, sans
-- écriture. Doublon ⇒ DUPLICATE (réponse 200 sans traitement).
CREATE FUNCTION core.payment_cmd_receive_webhook(
  p_account_id        uuid,
  p_provider_event_id text,
  p_dedup_key         bytea,
  p_signature_valid   boolean,
  p_signed_at         timestamptz,
  p_headers           jsonb,
  p_normalized        jsonb
)
  RETURNS TABLE (outcome text, inbox_id uuid)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_provider text;
  v_now      timestamptz := platform.now();
  v_status   text;
  v_id       uuid := gen_random_uuid();
  v_inserted uuid;
BEGIN
  SELECT a.provider INTO v_provider FROM core.payment_psp_account AS a WHERE a.id = p_account_id;
  IF NOT FOUND OR (v_provider = 'FAKE' AND platform.deployment_env() = 'production') THEN
    outcome := 'NOT_FOUND';
    inbox_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;
  IF p_dedup_key IS NULL OR length(p_dedup_key) NOT BETWEEN 16 AND 64 THEN
    RAISE EXCEPTION 'payment: invalid dedup key' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_status := CASE
                WHEN p_signature_valid IS NOT TRUE THEN 'REJECTED_SIGNATURE'
                WHEN p_signed_at IS NOT NULL
                     AND (p_signed_at < v_now - interval '5 minutes'
                          OR p_signed_at > v_now + interval '5 minutes') THEN 'QUARANTINED'
                ELSE 'RECEIVED'
              END;
  INSERT INTO core.payment_webhook_inbox AS w
         (id, provider, psp_account_id, provider_event_id, dedup_key, signature_valid, headers,
          processing_status, error, normalized_events)
  VALUES (v_id, v_provider, p_account_id, p_provider_event_id, p_dedup_key,
          p_signature_valid IS TRUE, p_headers, v_status,
          CASE v_status WHEN 'QUARANTINED' THEN 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE' END,
          CASE WHEN v_status = 'REJECTED_SIGNATURE' THEN NULL ELSE p_normalized END)
  ON CONFLICT ON CONSTRAINT webhook_inbox_dedup DO NOTHING
  RETURNING w.id INTO v_inserted;
  IF v_inserted IS NULL THEN
    outcome := 'DUPLICATE';
    inbox_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;
  IF v_status <> 'REJECTED_SIGNATURE' THEN
    UPDATE core.payment_psp_account AS a SET last_webhook_at = v_now WHERE a.id = p_account_id;
  END IF;
  outcome := v_status;
  inbox_id := v_inserted;
  RETURN NEXT;
END
$fn$;

-- 8.5 Contrôle de démarrage (17 §6.5 point 3) : environnement de la base et nombre de comptes FAKE.
CREATE FUNCTION core.payment_startup_guard()
  RETURNS TABLE (deployment_env text, fake_accounts integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT platform.deployment_env(),
         (SELECT count(*)::integer FROM core.payment_psp_account AS a WHERE a.provider = 'FAKE')
$fn$;

REVOKE ALL ON FUNCTION
  core.payment_cmd_record_operation(uuid, uuid, uuid, uuid, text, text, text, bigint, text, integer,
                                    text, text, jsonb),
  core.payment_cmd_apply_operation_status(uuid, text, text, uuid, text),
  core.payment_resolve_webhook_account(text, text),
  core.payment_cmd_receive_webhook(uuid, text, bytea, boolean, timestamptz, jsonb, jsonb),
  core.payment_startup_guard()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.payment_cmd_record_operation(uuid, uuid, uuid, uuid, text, text, text, bigint, text, integer,
                                    text, text, jsonb),
  core.payment_cmd_apply_operation_status(uuid, text, text, uuid, text)
  TO app_worker;
GRANT EXECUTE ON FUNCTION
  core.payment_resolve_webhook_account(text, text),
  core.payment_cmd_receive_webhook(uuid, text, bytea, boolean, timestamptz, jsonb, jsonb)
  TO app_api;
GRANT EXECUTE ON FUNCTION core.payment_startup_guard() TO app_api, app_worker;

-- 9. Transfert aux propriétaires NOLOGIN (ADR-053) : CREATE accordé le temps du transfert --------
GRANT CREATE ON SCHEMA core TO cmd_money_owner, integrity_owner;
ALTER FUNCTION core.payment_cmd_record_operation(uuid, uuid, uuid, uuid, text, text, text, bigint,
                                                 text, integer, text, text, jsonb)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_apply_operation_status(uuid, text, text, uuid, text)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_resolve_webhook_account(text, text) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_receive_webhook(uuid, text, bytea, boolean, timestamptz, jsonb, jsonb)
  OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_startup_guard() OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_assert_operation_legs() OWNER TO integrity_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner, integrity_owner;

-- 10. RLS ENABLE + FORCE --------------------------------------------------------------------------
ALTER TABLE core.payment_psp_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_psp_account FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payment_psp_account TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.payment_psp_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_psp_capability FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payment_psp_capability TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.payment_payment_operation_leg ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_payment_operation_leg FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payment_payment_operation_leg TO migrator USING (true) WITH CHECK (true);

ALTER TABLE core.payment_payment_operation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_payment_operation_event FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.payment_payment_operation_event TO migrator USING (true) WITH CHECK (true);

REVOKE ALL ON core.payment_psp_account, core.payment_psp_capability,
  core.payment_payment_operation_leg, core.payment_payment_operation_event FROM PUBLIC;
