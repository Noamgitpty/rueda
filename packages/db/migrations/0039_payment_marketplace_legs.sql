-- 0039 — PAY / STL : port de place de marché (sous-marchands, capacités bloquantes) et écrivain des
-- soldes par jambe (`cmd_apply_leg_movement`).
-- US-061 ; 17 §2.8 (matrice de capacités, colonne « Bloquante », règle d'activation, sous-marchands),
-- §2.9 (soldes par trip, segment et jambe), §3.2.7 (`psp_submerchant`), §4.3 point 8 ; 08 E7
-- (règles 1 à 3 bis, 6, 10) ; ADR-045, ADR-057 (condition de rejeu), ADR-059, ADR-064, ADR-066.
-- Appliquée sous `migrator`.
--
-- Numérotation : réservée « à partir de 0045 » par l'orchestrateur (US-024 prend 0039 et suivantes),
-- mais `src/numbering.test.ts` exige des migrations contiguës : ce fichier prend la suite de main
-- (0039) et sera renuméroté à la fusion, derrière US-024.
--
-- Contenu :
--   1. core.payment_psp_capability_catalog : catalogue des capacités de 17 §2.8 avec leur type et
--      leur caractère BLOQUANT (« colonne bloquante » de 19 US-061). Une capacité absente de la
--      matrice est connue par le catalogue : elle vaut « non » (fail-closed).
--   2. core.payment_missing_blocking_capabilities(provider, pays, variante) : capacités bloquantes
--      non validées (seule une ligne VALIDATED_* de portée (*, *) en vigueur compte).
--   3. core.payment_psp_submerchant : chaque hôte sous-marchand du compte marchand de Kmino
--      (17 §3.2.7), une tentative par ligne, statut KYC du PSP.
--   4. Commandes SECURITY DEFINER (cmd_money_owner, liste blanche RLS-15, EXECUTE au seul
--      app_worker, travailleur `payment_command`) :
--      payment_cmd_register_submerchant (refus HOST_PAYOUT_RAIL_UNAVAILABLE si une capacité
--      bloquante manque), payment_cmd_record_submerchant_status.
--   5. core.settlement_leg_movement (opérations déjà portées sur les soldes, ajout seul) et
--      core.settlement_cmd_apply_leg_movement : seul écrivain de `trip_leg_balance` (17 §2.9) ;
--      montants lus de `payment_operation_leg`, jamais d'un paramètre ; débit d'une jambe libérée
--      ou gelée ⇒ LEG_ALREADY_RELEASED (08 E7 règle 3 bis).
--
-- Écarts PROPOSÉS (ADR-066, à reporter dans 17 par l'orchestrateur) :
--   - catalogue séparé au lieu d'une colonne `blocking` sur psp_capability : la matrice ne contient
--     que des lignes connues ; une capacité bloquante absente doit pourtant fermer l'activation ;
--   - seule une ligne de portée (méthode *, réseau *) compte pour une capacité bloquante ;
--   - `payment_cmd_register_submerchant` est l'activation PSP de l'hôte : les interrupteurs pays
--     (`p2p_private_hosts_enabled`, `insurer_contract_active`) restent à US-125 ;
--   - travailleur unique `payment_command` pour les sous-marchands et les mouvements de jambe ;
--   - un débit de PLATFORM au-delà du solde PLATFORM du trip (avance de Kmino, TJ18b) est refusé
--     (LEG_AMOUNT_NEGATIVE) tant que l'avance n'est pas portée par un mouvement crédité (US-224).
--
-- Retour arrière (tables vides) :
--   DROP FUNCTION core.settlement_cmd_apply_leg_movement(uuid),
--     core.payment_cmd_register_submerchant(uuid, uuid, uuid, integer),
--     core.payment_cmd_record_submerchant_status(uuid, text, text, text),
--     core.payment_missing_blocking_capabilities(text, text, text),
--     core.payment_psp_submerchant_guard();
--   DROP TABLE core.settlement_leg_movement, core.payment_psp_submerchant,
--     core.payment_psp_capability_catalog;
--   DROP POLICY cmd_money_ins, cmd_money_upd ON core.settlement_trip_leg_balance;
--   DROP POLICY cmd_money_sel ON core.payment_psp_capability, core.iam_organization,
--     core.config_country;
--   REVOKE … FROM cmd_money_owner (droits de la section 6).

-- 1. Catalogue des capacités (17 §2.8) -----------------------------------------------------------
CREATE TABLE core.payment_psp_capability_catalog (
  capability text PRIMARY KEY
    CONSTRAINT psp_capability_catalog_name_format CHECK (capability ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  kind       text NOT NULL
    CONSTRAINT psp_capability_catalog_kind_valid CHECK (kind IN ('bool', 'int', 'enum')),
  -- YES : aucun hôte activable sans elle ; VARIANT_A : bloquante en SPLIT_AT_SOURCE seulement ;
  -- NO : une parade fail-closed existe sans fonds avancés (17 §2.8, colonne « Bloquante »)
  blocking   text NOT NULL
    CONSTRAINT psp_capability_catalog_blocking_valid CHECK (blocking IN ('YES', 'NO', 'VARIANT_A')),
  source     text NOT NULL CONSTRAINT psp_capability_catalog_source_present CHECK (source <> '')
);

COMMENT ON TABLE core.payment_psp_capability_catalog IS
  'PAY : catalogue des capacités PSP de 17 §2.8 (type, colonne « Bloquante »). Une capacité absente '
  'de psp_capability vaut « non ». Même liste que CAPABILITIES (apps/api, module PAY). Classe C.';

INSERT INTO core.payment_psp_capability_catalog (capability, kind, blocking, source) VALUES
  ('SUPPORTS_SUBMERCHANT', 'bool', 'YES', '17 §2.8'),
  ('SUPPORTS_INDIVIDUAL_SUBMERCHANT', 'bool', 'YES', '17 §2.8'),
  ('SUPPORTS_MULTI_LEG_SPLIT', 'bool', 'VARIANT_A', '17 §2.8'),
  ('SUPPORTS_PER_LEG_AMOUNTS', 'bool', 'YES', '17 §2.8 ; 08 E7 règle 1'),
  ('SUPPORTS_B2C_PAYOUT', 'bool', 'YES', '17 §2.8'),
  ('SUPPORTS_DELAYED_PAYOUT_RELEASE', 'bool', 'YES', '17 §2.8 ; 08 E7 règle 6'),
  ('SUPPORTS_PAYOUT_ADJUSTMENT', 'bool', 'YES', '17 §2.8 ; 08 E7 règles 3, 3 bis, 7'),
  ('SUPPORTS_NEGATIVE_BALANCE_RECOVERY', 'bool', 'YES', '17 §2.8 ; 08 E7 règle 7'),
  ('SUPPORTS_PLATFORM_LEG_TRANSFER', 'bool', 'NO', '17 §2.8 (défaut false)'),
  ('SUPPORTS_YAPPY_IN_MARKETPLACE', 'bool', 'NO', '17 §2.8'),
  ('SUPPORTS_PREAUTH', 'bool', 'NO', '17 §2.8'),
  ('MAX_HOLD_HOURS', 'int', 'NO', '17 §2.8'),
  ('SUPPORTS_PARTIAL_CAPTURE', 'bool', 'YES', '17 §2.8'),
  ('SUPPORTS_VOID', 'bool', 'NO', '17 §2.8'),
  ('SUPPORTS_REFUND', 'bool', 'YES', '17 §2.8'),
  ('SUPPORTS_PARTIAL_REFUND', 'bool', 'YES', '17 §2.8'),
  ('ROLLBACK_WINDOW_HOURS', 'int', 'NO', '17 §2.8'),
  ('SUPPORTS_MIT', 'bool', 'YES', '17 §2.8'),
  ('SUPPORTS_REAUTH', 'bool', 'NO', '17 §2.8'),
  ('SUPPORTS_3DS', 'bool', 'NO', '17 §2.8'),
  ('CHARGEBACK_WINDOW_DAYS', 'int', 'NO', '17 §2.8'),
  ('IDEMPOTENCY_KEY_MAX_LEN', 'int', 'NO', '17 §2.8'),
  ('WEBHOOK_SIGNATURE_SCHEME', 'enum', 'YES', '17 §2.8'),
  ('SUPPORTS_LOOKUP_BY_MERCHANT_REF', 'bool', 'YES', '17 §2.8'),
  ('SUPPORTS_IDEMPOTENCY_HEADER', 'bool', 'NO', '17 §2.8'),
  ('ECHOES_MERCHANT_REF_IN_WEBHOOK', 'bool', 'NO', '17 §2.8'),
  ('ORDER_TTL_SECONDS', 'int', 'NO', '17 §2.8'),
  ('SUPPORTS_ORDER_CANCEL', 'bool', 'NO', '17 §2.8'),
  ('SUPPORTS_SINGLE_USE_ORDER', 'bool', 'NO', '17 §2.8'),
  ('ORDER_EXPIRY_RETURNED', 'bool', 'NO', '17 §2.8'),
  ('SUPPORTS_LIST_TRANSACTIONS', 'bool', 'NO', '17 §2.8'),
  ('CHARGEBACK_NOTIFICATION_CHANNEL', 'enum', 'YES', '17 §2.8'),
  ('REFUND_WINDOW_DAYS', 'int', 'NO', '17 §2.8'),
  ('MIN_AMOUNT_MINOR', 'int', 'NO', '17 §2.8'),
  ('MAX_AMOUNT_MINOR', 'int', 'NO', '17 §2.8'),
  ('WEBHOOK_RETRY_POLICY', 'enum', 'NO', '17 §2.8'),
  ('WEBHOOK_ORDERING_GUARANTEE', 'enum', 'NO', '17 §2.8'),
  ('SUPPORTS_RESTRICTED_API_KEYS', 'bool', 'NO', '17 §2.8');

-- 2. Capacités bloquantes manquantes (17 §2.8, « Règle d'activation ») ---------------------------
-- Rend la liste triée des capacités bloquantes NON validées pour (fournisseur, pays, variante) ;
-- vide ⇒ les capacités ne s'opposent pas à l'activation. Fail-closed : ligne absente, statut autre
-- que VALIDATED_*, valeur de type inattendu, booléen faux, entier ≤ 0 ou énumération UNKNOWN ⇒
-- « non » ; seule la ligne en vigueur la plus récente (valid_from ≤ platform.now()) de portée
-- (méthode *, réseau *) compte ; variante inconnue ⇒ VARIANT_A appliquée.
-- SECURITY INVOKER : le lecteur doit lire le catalogue et la matrice (données de référence).
CREATE FUNCTION core.payment_missing_blocking_capabilities(
  p_provider text,
  p_country  text,
  p_mode     text
)
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(array_agg(c.capability ORDER BY c.capability), ARRAY[]::text[])
    FROM core.payment_psp_capability_catalog AS c
   WHERE (c.blocking = 'YES'
          OR (c.blocking = 'VARIANT_A' AND p_mode IS DISTINCT FROM 'PLATFORM_MOR'))
     AND NOT COALESCE((
       SELECT CASE
                WHEN v.status NOT IN ('VALIDATED_SANDBOX', 'VALIDATED_CONTRACT') THEN false
                WHEN c.kind = 'bool' THEN v.value = 'true'::jsonb
                WHEN c.kind = 'int' THEN
                  CASE WHEN jsonb_typeof(v.value) = 'number'
                       THEN (v.value #>> '{}') ~ '^[1-9][0-9]{0,15}$'
                       ELSE false END
                ELSE
                  CASE WHEN jsonb_typeof(v.value) = 'string'
                       THEN (v.value #>> '{}') ~ '^[A-Z][A-Z0-9_]*$'
                            AND (v.value #>> '{}') <> 'UNKNOWN'
                       ELSE false END
              END
         FROM core.payment_psp_capability AS v
        WHERE v.provider = p_provider
          AND v.country_code = p_country
          AND v.method = '*'
          AND v.network = '*'
          AND v.capability = c.capability
          AND v.valid_from <= platform.now()
        ORDER BY v.valid_from DESC
        LIMIT 1), false)
$fn$;

COMMENT ON FUNCTION core.payment_missing_blocking_capabilities(text, text, text) IS
  'Capacités bloquantes non validées (17 §2.8) : vide ⇒ activation possible côté PSP. Fail-closed.';

REVOKE ALL ON FUNCTION core.payment_missing_blocking_capabilities(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_missing_blocking_capabilities(text, text, text)
  TO app_api, app_worker, cmd_money_owner;

-- 3. Sous-marchands (17 §3.2.7) -------------------------------------------------------------------
-- Une ligne par tentative d'enregistrement (`submerchant:{org_id}:a{n}`, 17 §2.8) ; au plus une
-- tentative vivante (non REJECTED) par (compte, hôte). Aucune suppression.
CREATE TABLE core.payment_psp_submerchant (
  id                       uuid        PRIMARY KEY,
  psp_account_id           uuid        NOT NULL
    CONSTRAINT psp_submerchant_account_fk REFERENCES core.payment_psp_account (id),
  org_id                   uuid        NOT NULL,
  country_code             text        NOT NULL
    CONSTRAINT psp_submerchant_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
  attempt_no               integer     NOT NULL
    CONSTRAINT psp_submerchant_attempt_positive CHECK (attempt_no >= 1),
  idem_plain               text        NOT NULL
    CONSTRAINT psp_submerchant_idem_unique UNIQUE,
  provider_submerchant_ref text
    CONSTRAINT psp_submerchant_ref_format CHECK (provider_submerchant_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  kyc_status               text        NOT NULL DEFAULT 'PENDING'
    CONSTRAINT psp_submerchant_kyc_status_valid CHECK (kyc_status IN
      ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED')),
  payout_currency          text        NOT NULL
    CONSTRAINT psp_submerchant_currency_format CHECK (payout_currency ~ '^[A-Z]{3}$'),
  activated_at             timestamptz,
  suspended_reason         text
    CONSTRAINT psp_submerchant_reason_length CHECK (length(suspended_reason) BETWEEN 1 AND 200),
  created_at               timestamptz NOT NULL DEFAULT platform.now(),
  updated_at               timestamptz NOT NULL DEFAULT platform.now(),
  row_version              integer     NOT NULL DEFAULT 0,
  CONSTRAINT psp_submerchant_org_country_fk FOREIGN KEY (org_id, country_code)
    REFERENCES core.iam_organization (id, country_code),
  CONSTRAINT psp_submerchant_attempt_unique UNIQUE (psp_account_id, org_id, attempt_no),
  CONSTRAINT psp_submerchant_active_ref CHECK (
    kyc_status NOT IN ('ACTIVE', 'SUSPENDED') OR provider_submerchant_ref IS NOT NULL),
  CONSTRAINT psp_submerchant_active_dated CHECK (kyc_status <> 'ACTIVE' OR activated_at IS NOT NULL),
  CONSTRAINT psp_submerchant_suspended_reason CHECK (
    (kyc_status = 'SUSPENDED') = (suspended_reason IS NOT NULL))
);

CREATE UNIQUE INDEX psp_submerchant_one_live
  ON core.payment_psp_submerchant (psp_account_id, org_id) WHERE (kyc_status <> 'REJECTED');
CREATE INDEX psp_submerchant_org_idx ON core.payment_psp_submerchant (org_id);

COMMENT ON TABLE core.payment_psp_submerchant IS
  'PAY psp_submerchant (17 §3.2.7) : hôte sous-marchand du compte marchand de Kmino. Écrite par '
  'payment_cmd_register_submerchant / payment_cmd_record_submerchant_status seulement. Classe B.';

-- Garde (sans lecture : pas de SECURITY DEFINER) : identité figée, référence PSP posée une fois,
-- transitions PENDING → ACTIVE | SUSPENDED | REJECTED, ACTIVE ⇄ SUSPENDED, REJECTED terminal ;
-- aucune suppression.
CREATE FUNCTION core.payment_psp_submerchant_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'psp_submerchant: no delete'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'psp_submerchant_immutable';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.psp_account_id IS DISTINCT FROM OLD.psp_account_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no OR NEW.idem_plain IS DISTINCT FROM OLD.idem_plain
     OR NEW.payout_currency IS DISTINCT FROM OLD.payout_currency
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.provider_submerchant_ref IS NOT NULL
         AND NEW.provider_submerchant_ref IS DISTINCT FROM OLD.provider_submerchant_ref)
     OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at) THEN
    RAISE EXCEPTION 'psp_submerchant: identity, PSP reference and activation date are immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'psp_submerchant_immutable';
  END IF;
  IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status
     AND NOT ((OLD.kyc_status = 'PENDING' AND NEW.kyc_status IN ('ACTIVE', 'SUSPENDED', 'REJECTED'))
              OR (OLD.kyc_status = 'ACTIVE' AND NEW.kyc_status = 'SUSPENDED')
              OR (OLD.kyc_status = 'SUSPENDED' AND NEW.kyc_status = 'ACTIVE')) THEN
    RAISE EXCEPTION 'psp_submerchant: transition % -> % refused', OLD.kyc_status, NEW.kyc_status
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'psp_submerchant_transition';
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION core.payment_psp_submerchant_guard() FROM PUBLIC;

CREATE TRIGGER psp_submerchant_guard BEFORE UPDATE OR DELETE ON core.payment_psp_submerchant
  FOR EACH ROW EXECUTE FUNCTION core.payment_psp_submerchant_guard();
CREATE TRIGGER touch_row BEFORE UPDATE ON core.payment_psp_submerchant
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
CREATE TRIGGER psp_submerchant_no_truncate BEFORE TRUNCATE ON core.payment_psp_submerchant
  FOR EACH STATEMENT EXECUTE FUNCTION core.payment_psp_submerchant_guard();

-- 4. Opérations portées sur les soldes par jambe (17 §2.9) ---------------------------------------
-- Une ligne par opération appliquée à `trip_leg_balance` : rend `cmd_apply_leg_movement`
-- idempotente. Ajout seul (même garde que les règlements, ADR-057).
CREATE TABLE core.settlement_leg_movement (
  operation_id uuid        PRIMARY KEY
    CONSTRAINT leg_movement_operation_fk REFERENCES core.payment_payment_operation (id),
  trip_id      uuid        NOT NULL,
  segment_no   integer     NOT NULL
    CONSTRAINT leg_movement_segment_beta CHECK (segment_no = 1),   -- bêta : voir settlement
  country_code text        NOT NULL,
  kind         text        NOT NULL
    CONSTRAINT leg_movement_kind_valid CHECK (kind IN
      ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION', 'REFUND', 'LEG_REALLOCATION', 'LEG_RELEASE')),
  applied_at   timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT leg_movement_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code)
);
CREATE INDEX leg_movement_trip_idx ON core.settlement_leg_movement (trip_id);

COMMENT ON TABLE core.settlement_leg_movement IS
  'STL : opérations déjà portées sur trip_leg_balance par settlement_cmd_apply_leg_movement '
  '(idempotence). Ajout seul. Classe A.';

CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON core.settlement_leg_movement
  FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_leg_movement
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable();

-- 5. RLS ENABLE + FORCE, lectures -----------------------------------------------------------------
ALTER TABLE core.payment_psp_capability_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_psp_capability_catalog FORCE ROW LEVEL SECURITY;
ALTER TABLE core.payment_psp_submerchant ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.payment_psp_submerchant FORCE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_leg_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_leg_movement FORCE ROW LEVEL SECURITY;

CREATE POLICY migrator_all ON core.payment_psp_capability_catalog TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.payment_psp_submerchant TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.settlement_leg_movement TO migrator USING (true) WITH CHECK (true);

REVOKE ALL ON core.payment_psp_capability_catalog, core.payment_psp_submerchant,
  core.settlement_leg_movement FROM PUBLIC;

-- Catalogue : donnée de référence, comme la matrice (0028).
GRANT SELECT ON core.payment_psp_capability_catalog TO app_api, app_worker;
CREATE POLICY reference_read ON core.payment_psp_capability_catalog FOR SELECT TO app_api, app_worker
  USING (true);

-- Sous-marchands, app_api : l'hôte TITULAIRE lit sa ligne, statut seulement (17 §3.2.7 ; jamais la
-- référence PSP ni le motif de suspension) ; ADMIN / FINANCE de la portée pays. Lecture par colonnes.
GRANT SELECT (id, org_id, country_code, kyc_status, payout_currency, activated_at, updated_at)
  ON core.payment_psp_submerchant TO app_api;
CREATE POLICY submerchant_host_read ON core.payment_psp_submerchant FOR SELECT TO app_api
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id() AND app.is_org_holder());
CREATE POLICY submerchant_staff_read ON core.payment_psp_submerchant FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code) OR app.has_staff_role('FINANCE', country_code)));

-- Travailleurs de la liste blanche des tables d'argent (17 §2.3, RLS-25) : lecture seule.
GRANT SELECT ON core.payment_psp_submerchant, core.settlement_leg_movement TO app_worker;
CREATE POLICY worker_money_read ON core.payment_psp_submerchant FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('payment_command', 'payout', 'reconciliation'));
CREATE POLICY worker_money_read ON core.settlement_leg_movement FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('settlement', 'payment_command', 'payout', 'bordereau', 'reconciliation'));

-- 6. Propriétaire des commandes d'argent : droits au plus juste ----------------------------------
GRANT SELECT ON core.payment_psp_capability_catalog, core.payment_psp_capability TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.payment_psp_capability_catalog FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_sel ON core.payment_psp_capability FOR SELECT TO cmd_money_owner USING (true);
GRANT SELECT (id, country_code, status) ON core.iam_organization TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.iam_organization FOR SELECT TO cmd_money_owner USING (true);
GRANT SELECT (code, currency) ON core.config_country TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.config_country FOR SELECT TO cmd_money_owner USING (true);

GRANT SELECT, INSERT ON core.payment_psp_submerchant TO cmd_money_owner;
GRANT UPDATE (kyc_status, provider_submerchant_ref, activated_at, suspended_reason)
  ON core.payment_psp_submerchant TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.payment_psp_submerchant FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.payment_psp_submerchant FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND kyc_status = 'PENDING' AND provider_submerchant_ref IS NULL);
CREATE POLICY cmd_money_upd ON core.payment_psp_submerchant FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

-- Soldes par jambe : premier écrivain (17 §2.9) ; cumuls seulement, jamais l'identité ni le gel.
GRANT INSERT (trip_id, segment_no, leg, org_id, country_code, currency)
  ON core.settlement_trip_leg_balance TO cmd_money_owner;
GRANT UPDATE (captured_minor, refunded_minor, reallocated_in_minor, reallocated_out_minor,
              released_minor)
  ON core.settlement_trip_leg_balance TO cmd_money_owner;
CREATE POLICY cmd_money_ins ON core.settlement_trip_leg_balance FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND captured_minor = 0 AND refunded_minor = 0 AND reallocated_in_minor = 0
              AND reallocated_out_minor = 0 AND released_minor = 0 AND NOT frozen);
CREATE POLICY cmd_money_upd ON core.settlement_trip_leg_balance FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

GRANT SELECT, INSERT ON core.settlement_leg_movement TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.settlement_leg_movement FOR SELECT TO cmd_money_owner USING (true);
CREATE POLICY cmd_money_ins ON core.settlement_leg_movement FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');

-- 7. Commandes SECURITY DEFINER (cmd_money_owner ; liste blanche RLS-15) -------------------------

-- 7.1 Enregistrer un hôte comme sous-marchand (17 §2.8 `registerSubmerchant`, point 5 ; clé
-- `submerchant:{org_id}:a{n}`). Écrit la tentative PENDING AVANT l'appel au PSP (17 §4.3 point 1) :
-- le travailleur envoie ensuite la clé rendue. Refus HOST_PAYOUT_RAIL_UNAVAILABLE si une capacité
-- bloquante du compte n'est pas validée (une capacité inconnue vaut « non »).
CREATE FUNCTION core.payment_cmd_register_submerchant(
  p_id             uuid,
  p_org_id         uuid,
  p_psp_account_id uuid,
  p_attempt_no     integer
)
  RETURNS TABLE (submerchant_id uuid, idem_plain text, replayed boolean)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_provider    text;
  v_country     text;
  v_status      text;
  v_mode        text;
  v_org_country text;
  v_org_status  text;
  v_currency    text;
  v_missing     text[];
  v_idem        text;
  v_existing    core.payment_psp_submerchant%ROWTYPE;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: register_submerchant reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_id IS NULL OR p_org_id IS NULL OR p_attempt_no IS NULL OR p_attempt_no < 1 THEN
    RAISE EXCEPTION 'payment: invalid submerchant request' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- compte marchand de Kmino ACTIVE, jamais un FAKE en production (17 §4.3 point 5.7, C19)
  SELECT a.provider, a.country_code, a.status, a.collection_mode
    INTO v_provider, v_country, v_status, v_mode
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

  -- hôte du même pays que le compte, ni suspendu ni sorti
  SELECT o.country_code, o.status INTO v_org_country, v_org_status
    FROM core.iam_organization AS o WHERE o.id = p_org_id;
  IF NOT FOUND OR v_org_country <> v_country THEN
    RAISE EXCEPTION 'payment: host and PSP account country mismatch'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'psp_submerchant_org_mismatch';
  END IF;
  IF v_org_status IN ('SUSPENDED', 'OFFBOARDED') THEN
    RAISE EXCEPTION 'payment: host % cannot be registered', v_org_status
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'psp_submerchant_org_inactive';
  END IF;

  -- règle d'activation (17 §2.8) : toutes les capacités bloquantes validées pour la variante
  v_missing := core.payment_missing_blocking_capabilities(v_provider, v_country, v_mode);
  IF cardinality(v_missing) > 0 THEN
    RAISE EXCEPTION 'payment: host payout rail unavailable'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'host_payout_rail_unavailable',
            DETAIL = array_to_string(v_missing, ', ');
  END IF;

  v_idem := format('submerchant:%s:a%s', p_org_id, p_attempt_no);
  SELECT * INTO v_existing FROM core.payment_psp_submerchant AS s WHERE s.idem_plain = v_idem;
  IF FOUND THEN
    IF v_existing.psp_account_id IS DISTINCT FROM p_psp_account_id THEN
      RAISE EXCEPTION 'payment: same idempotency key, different content'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'payment_operation_idempotency_conflict';
    END IF;
    submerchant_id := v_existing.id;
    idem_plain := v_idem;
    replayed := true;
    RETURN NEXT;
    RETURN;
  END IF;

  -- tentative n > 1 : seulement après le refus (REJECTED) de toutes les précédentes, à la suite
  IF p_attempt_no > 1 AND NOT EXISTS (
       SELECT 1 FROM core.payment_psp_submerchant AS s
        WHERE s.psp_account_id = p_psp_account_id AND s.org_id = p_org_id
          AND s.attempt_no = p_attempt_no - 1) THEN
    RAISE EXCEPTION 'payment: submerchant attempt % out of sequence', p_attempt_no
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'psp_submerchant_attempt_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS s
              WHERE s.psp_account_id = p_psp_account_id AND s.org_id = p_org_id
                AND s.kyc_status <> 'REJECTED') THEN
    RAISE EXCEPTION 'payment: a live submerchant already exists for this host'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'psp_submerchant_attempt_invalid';
  END IF;

  -- devise de versement : celle du pays (configuration, 08 E7 règle 9 : aucune conversion)
  SELECT c.currency INTO v_currency FROM core.config_country AS c WHERE c.code = v_country;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'payment: country % not configured', v_country
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'psp_submerchant_country_unconfigured';
  END IF;

  INSERT INTO core.payment_psp_submerchant
         (id, psp_account_id, org_id, country_code, attempt_no, idem_plain, payout_currency)
  VALUES (p_id, p_psp_account_id, p_org_id, v_country, p_attempt_no, v_idem, v_currency);
  submerchant_id := p_id;
  idem_plain := v_idem;
  replayed := false;
  RETURN NEXT;
END
$fn$;

-- 7.2 Appliquer l'état KYC rendu par le PSP (`registerSubmerchant` / `getSubmerchant`). Même
-- statut et même référence ⇒ DUPLICATE ; référence contradictoire ⇒ CONFLICT (rien ne change,
-- lecture getSubmerchant puis file ops) ; transition hors de la garde ⇒ refus.
CREATE FUNCTION core.payment_cmd_record_submerchant_status(
  p_submerchant_id uuid,
  p_status         text,
  p_provider_ref   text,
  p_reason         text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_row core.payment_psp_submerchant%ROWTYPE;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: record_submerchant_status reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED') THEN
    RAISE EXCEPTION 'payment: invalid submerchant status' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_row FROM core.payment_psp_submerchant AS s
   WHERE s.id = p_submerchant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF v_row.provider_submerchant_ref IS NOT NULL AND p_provider_ref IS NOT NULL
     AND p_provider_ref <> v_row.provider_submerchant_ref THEN
    RETURN 'CONFLICT';
  END IF;
  IF p_status = v_row.kyc_status
     AND (p_provider_ref IS NULL OR p_provider_ref = v_row.provider_submerchant_ref) THEN
    RETURN 'DUPLICATE';
  END IF;
  UPDATE core.payment_psp_submerchant AS s
     SET kyc_status = p_status,
         provider_submerchant_ref = COALESCE(s.provider_submerchant_ref, p_provider_ref),
         activated_at = CASE WHEN p_status = 'ACTIVE' THEN COALESCE(s.activated_at, platform.now())
                             ELSE s.activated_at END,
         suspended_reason = CASE WHEN p_status = 'SUSPENDED'
                                 THEN COALESCE(NULLIF(p_reason, ''), 'PSP_SUSPENDED') END
   WHERE s.id = p_submerchant_id;
  RETURN 'APPLIED';
END
$fn$;

-- 7.3 Porter une opération RÉUSSIE sur les soldes par jambe (17 §2.9 ; seul écrivain de
-- trip_leg_balance). Montants lus de payment_operation_leg, jamais d'un paramètre. Sous le verrou
-- du trip (FOR UPDATE), une fois par opération (settlement_leg_movement) :
--   CAPTURE, MIT_CHARGE, DEBT_COLLECTION ⇒ captured ; REFUND ⇒ refunded ;
--   LEG_REALLOCATION ⇒ reallocated_out (jambe < 0), reallocated_in (jambe > 0) ;
--   LEG_RELEASE ⇒ released.
-- Débit (remboursement, source d'une réaffectation, libération) : jambe gelée ou débit au-delà du
-- disponible d'une jambe déjà libérée ⇒ LEG_ALREADY_RELEASED (08 E7 règle 3 bis : la variation
-- doit être portée sur PLATFORM AVANT l'ordre) ; au-delà du disponible sinon ⇒ LEG_AMOUNT_NEGATIVE.
-- Périmètre : opérations de loyer (RENT, RENT_SHORTFALL, NO_SHOW_RETENTION, 17 §2.8) rattachées à
-- un trip ; tout autre cas est refusé (fail-closed).
CREATE FUNCTION core.settlement_cmd_apply_leg_movement(p_operation_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip_id  uuid;
  v_kind     text;
  v_purpose  text;
  v_status   text;
  v_currency text;
  v_account  uuid;
  v_org      uuid;
  v_country  text;
  v_trip_cur text;
  v_n        integer;
  r          record;
  v_debit    bigint;
  v_avail    bigint;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'settlement: apply_leg_movement reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT o.trip_id, o.kind, o.purpose, o.currency, o.psp_account_id
    INTO v_trip_id, v_kind, v_purpose, v_currency, v_account
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND OR v_trip_id IS NULL OR v_account IS NULL THEN
    RAISE EXCEPTION 'settlement: operation % has no trip leg to move', p_operation_id
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- verrou du trip : un seul écrivain des soldes du trip à la fois (17 §2.9, §4.3 point 1)
  SELECT t.org_id, t.country_code, t.currency INTO v_org, v_country, v_trip_cur
    FROM core.booking_trip AS t WHERE t.id = v_trip_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m WHERE m.operation_id = p_operation_id) THEN
    RETURN 'DUPLICATE';
  END IF;

  -- statut relu SOUS le verrou du trip
  SELECT o.status INTO v_status FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF v_status <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'settlement: operation % is %, not SUCCEEDED', p_operation_id, v_status
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_not_succeeded';
  END IF;
  IF v_purpose NOT IN ('RENT', 'RENT_SHORTFALL', 'NO_SHOW_RETENTION')
     OR v_kind NOT IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION', 'REFUND', 'LEG_REALLOCATION',
                       'LEG_RELEASE')
     OR v_currency IS DISTINCT FROM v_trip_cur THEN
    RAISE EXCEPTION 'settlement: operation % (% / %) is outside the rent leg perimeter',
                    p_operation_id, v_kind, v_purpose
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;
  SELECT count(*)::integer INTO v_n
    FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = p_operation_id;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'settlement: operation % has % legs, 4 expected', p_operation_id, v_n
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'leg_movement_unsupported';
  END IF;

  -- quatre lignes de solde du segment (bêta : segment 1), créées à zéro au premier mouvement
  INSERT INTO core.settlement_trip_leg_balance (trip_id, segment_no, leg, org_id, country_code, currency)
  SELECT v_trip_id, 1, l.leg, v_org, v_country, v_trip_cur
    FROM unnest(ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM']) AS l(leg)
  ON CONFLICT (trip_id, segment_no, leg) DO NOTHING;

  -- contrôle des débits sur les soldes verrouillés (17 §4.3 point 8, 08 E7 règle 3 bis)
  FOR r IN
    SELECT l.leg, l.amount_minor, b.captured_minor, b.refunded_minor, b.reallocated_in_minor,
           b.reallocated_out_minor, b.released_minor, b.frozen
      FROM core.payment_payment_operation_leg AS l
      JOIN core.settlement_trip_leg_balance AS b
        ON b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
     WHERE l.operation_id = p_operation_id
     ORDER BY array_position(ARRAY['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'], l.leg)
       FOR UPDATE OF b
  LOOP
    v_debit := CASE
                 WHEN v_kind IN ('REFUND', 'LEG_RELEASE') THEN r.amount_minor
                 WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(-r.amount_minor, 0)
                 ELSE 0
               END;
    IF v_debit > 0 THEN
      IF r.frozen THEN
        RAISE EXCEPTION 'settlement: leg % of trip % is frozen', r.leg, v_trip_id
          USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_frozen';
      END IF;
      v_avail := r.captured_minor + r.reallocated_in_minor - r.refunded_minor
                 - r.reallocated_out_minor - r.released_minor;
      IF v_debit > v_avail THEN
        IF r.released_minor > 0 THEN
          RAISE EXCEPTION 'settlement: leg % of trip % already released', r.leg, v_trip_id
            USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'leg_already_released';
        END IF;
        RAISE EXCEPTION 'settlement: debit % exceeds leg % balance %', v_debit, r.leg, v_avail
          USING ERRCODE = 'object_not_in_prerequisite_state',
                CONSTRAINT = 'leg_movement_exceeds_balance';
      END IF;
    END IF;
  END LOOP;

  UPDATE core.settlement_trip_leg_balance AS b
     SET captured_minor = b.captured_minor
                          + CASE WHEN v_kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
                                 THEN l.amount_minor ELSE 0 END,
         refunded_minor = b.refunded_minor
                          + CASE WHEN v_kind = 'REFUND' THEN l.amount_minor ELSE 0 END,
         reallocated_in_minor = b.reallocated_in_minor
                          + CASE WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(l.amount_minor, 0)
                                 ELSE 0 END,
         reallocated_out_minor = b.reallocated_out_minor
                          + CASE WHEN v_kind = 'LEG_REALLOCATION' THEN greatest(-l.amount_minor, 0)
                                 ELSE 0 END,
         released_minor = b.released_minor
                          + CASE WHEN v_kind = 'LEG_RELEASE' THEN l.amount_minor ELSE 0 END
    FROM core.payment_payment_operation_leg AS l
   WHERE l.operation_id = p_operation_id
     AND b.trip_id = v_trip_id AND b.segment_no = 1 AND b.leg = l.leg
     AND l.amount_minor <> 0;

  INSERT INTO core.settlement_leg_movement (operation_id, trip_id, segment_no, country_code, kind)
  VALUES (p_operation_id, v_trip_id, 1, v_country, v_kind);
  RETURN 'APPLIED';
END
$fn$;

REVOKE ALL ON FUNCTION
  core.payment_cmd_register_submerchant(uuid, uuid, uuid, integer),
  core.payment_cmd_record_submerchant_status(uuid, text, text, text),
  core.settlement_cmd_apply_leg_movement(uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.payment_cmd_register_submerchant(uuid, uuid, uuid, integer),
  core.payment_cmd_record_submerchant_status(uuid, text, text, text),
  core.settlement_cmd_apply_leg_movement(uuid)
  TO app_worker;

-- 8. Transfert aux propriétaires NOLOGIN (ADR-053) : CREATE accordé le temps du transfert --------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_register_submerchant(uuid, uuid, uuid, integer) OWNER TO cmd_money_owner;
ALTER FUNCTION core.payment_cmd_record_submerchant_status(uuid, text, text, text) OWNER TO cmd_money_owner;
ALTER FUNCTION core.settlement_cmd_apply_leg_movement(uuid) OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
