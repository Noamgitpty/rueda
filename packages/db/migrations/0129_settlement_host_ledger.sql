-- 0129 — STL : grand livre minimal de l'hôte (`host_ledger`) ; pénalité d'annulation de l'hôte.
-- US-709a (partie minimale d'US-709 avancée au lot 2, BOARD N-219 ; agent argent / back-end) ;
-- 19 US-215 critère 2 (« pénalité de l'hôte portée au `host_ledger` comme ajustement de versement,
-- jamais comme jambe ») et US-709 ; 08 BR-CXL-13 (« la pénalité est débitée au `host_ledger` à
-- l'horodatage de l'annulation »), E5 (un grand livre par hôte et par devise), E7 règle 7
-- (ajustement de versement), vecteurs T14, T15, T48, T62, TJ06 ; 17 v6 §2.9 (`host_ledger[hôte][devise]`),
-- §3.2.8 ; ADR-148 (annulations réglées dans la transition), ADR-153 (cette migration).
-- Appliquée sous `migrator`, en une transaction.
--
-- Note sur 0124 (l. 59-62) : son commentaire nomme un « `host_ledger` (table d'US-224b) ». Cette
-- table n'existait pas et US-224b ne l'a pas créée (ADR-147 : recouvrement de la créance laissé à
-- US-709). Le `host_ledger` est créé ICI (US-709a) ; 0124 n'est pas réécrite.
--
-- Cette migration :
--   1. table `core.settlement_host_ledger_entry` : une écriture signée par ligne, en `bigint`
--      unités mineures de la devise du trip (une écriture = une devise, 08 E5), rattachée au compte
--      d'hôte (`org_id`), au trip, au segment, au règlement ET à sa version (clé étrangère
--      composite vers `settlement_settlement`, contrainte `settlement_ledger_scope_unique`
--      ajoutée), motif fermé (`HOST_CANCELLATION_PENALTY` seulement), horodatée par
--      `platform.now()` ; signe du point de vue de l'hôte : négatif = débit (dette de l'hôte).
--      Idempotence : UNIQUE (règlement, motif) et UNIQUE (trip, segment, version, motif).
--      Immuable (`settlement_immutable` : ni UPDATE, ni DELETE, ni TRUNCATE) ; une correction sera
--      une contre-passation (suite US-709) ;
--   2. vue `core.settlement_host_ledger_balance_v` (security_invoker) : solde par compte d'hôte,
--      pays et devise (Σ des écritures, jamais entre devises) ;
--   3. RLS ENABLE + FORCE, `migrator_all` ; lecture d'app_api réservée à FINANCE et ADMIN du pays
--      (`fin_read`, comme `platform_advance`) ; AUCUN droit d'app_worker ni d'app_anon ; AUCUNE
--      écriture par un rôle applicatif ; l'hôte ne lit rien (vue hôte : suite US-709, RLS-26) ;
--   4. commande `core.settlement_cmd_post_host_penalty(uuid)` (SECURITY DEFINER, propriétaire
--      `cmd_money_owner`, search_path figé, AUCUN EXECUTE accordé) : lit le règlement
--      d'annulation, version 1, et écrit `−host_penalty_minor` (montant du MOTEUR, rejoué par 0054,
--      jamais un paramètre) ; pénalité nulle ⇒ rien ; rejeu ⇒ l'écriture d'origine ;
--   5. déclencheur `trip_cancellation_penalty_posted` (AFTER UPDATE OF status de
--      `core.booking_trip_cancellation`, `PENDING` → `SETTLED`) : appelle la commande dans la
--      MÊME instruction que la liaison du règlement par `core.booking_cmd_trip_settle_cancellation`
--      (0124), donc dans la transaction du règlement et de la transition (SM-1 invariant 4) ; un
--      échec annule le tout. Aucun chemin d'annulation réglée ne peut l'omettre.
--
-- Hors de cette migration (ADR-153, passation docs/team/handoffs/US-709.md) : aucune retenue sur
-- un versement ni compensation `NETTING` (aucun versement avant le lot C, `payouts_enabled` =
-- `false`) ; `host_ledger_state` (SM-6b) et `host_ledger.state_changed` ; contre-passation d'une
-- version n+1 (SM-7 : la commande refuse une version > 1, fail-closed) ; pénalité de no-show de
-- l'hôte et autres motifs (reprises de chargeback, créances de la règle 3 bis) ; lecture par
-- l'hôte (`host_advance_v`-like, RLS-26) ; écritures en partie double (`journal_entry`).
--
-- Codes (packages/db/src/errors.ts) :
--   host_ledger_command_forbidden (42501)        → FORBIDDEN ;
--   host_ledger_settlement_unknown (23000)       → INVARIANT_VIOLATION ;
--   host_ledger_version_unsupported (55000)      → INVARIANT_VIOLATION ;
--   host_ledger_entry_settlement_reason_unique (23505) → INVARIANT_VIOLATION (défense) ;
--   settlement_immutable (23000)                 → IMMUTABLE_RECORD (0027).
--
-- Expand / contract : table, vue, contrainte d'unicité sur `settlement_settlement`, fonctions,
-- déclencheurs, droits et politiques AJOUTÉS ; rien n'est retiré ni réécrit.
--
-- Retour arrière :
--   DROP TRIGGER trip_cancellation_penalty_posted ON core.booking_trip_cancellation;
--   DROP FUNCTION core.settlement_post_cancellation_penalty(),
--     core.settlement_cmd_post_host_penalty(uuid);
--   DROP VIEW core.settlement_host_ledger_balance_v;
--   DROP TABLE core.settlement_host_ledger_entry;
--   ALTER TABLE core.settlement_settlement DROP CONSTRAINT settlement_ledger_scope_unique;

-- 1. Table ---------------------------------------------------------------------------------------

-- Portée complète d'un règlement (version et devise comprises) : cible de la clé étrangère des
-- écritures, qui ne peuvent donc citer ni une autre version, ni une autre devise, ni un autre hôte.
ALTER TABLE core.settlement_settlement
  ADD CONSTRAINT settlement_ledger_scope_unique
  UNIQUE (id, trip_id, segment_no, version, org_id, country_code, currency);

CREATE TABLE core.settlement_host_ledger_entry (
  id                 uuid        PRIMARY KEY,
  org_id             uuid        NOT NULL,                     -- compte d'hôte (08 E5 : par hôte)
  country_code       text        NOT NULL
    CONSTRAINT host_ledger_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency           text        NOT NULL                      -- devise du trip (08 E5 : par devise)
    CONSTRAINT host_ledger_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  trip_id            uuid        NOT NULL,
  segment_no         integer     NOT NULL,
  settlement_id      uuid        NOT NULL,
  settlement_version integer     NOT NULL
    CONSTRAINT host_ledger_version_positive CHECK (settlement_version >= 1),
  reason             text        NOT NULL
    CONSTRAINT host_ledger_reason_valid CHECK (reason IN ('HOST_CANCELLATION_PENALTY')),
  -- signé, du point de vue de l'hôte : < 0 débit (dette de l'hôte), > 0 crédit
  amount_minor       bigint      NOT NULL
    CONSTRAINT host_ledger_amount_nonzero CHECK (amount_minor <> 0),
  created_at         timestamptz NOT NULL DEFAULT platform.now(),
  -- une pénalité est toujours un débit de l'hôte (08 E7 règle 7)
  CONSTRAINT host_ledger_penalty_debit CHECK (
    reason <> 'HOST_CANCELLATION_PENALTY' OR amount_minor < 0),
  CONSTRAINT host_ledger_entry_settlement_reason_unique UNIQUE (settlement_id, reason),
  CONSTRAINT host_ledger_entry_version_reason_unique
    UNIQUE (trip_id, segment_no, settlement_version, reason),
  CONSTRAINT host_ledger_settlement_fk
    FOREIGN KEY (settlement_id, trip_id, segment_no, settlement_version, org_id, country_code, currency)
    REFERENCES core.settlement_settlement (id, trip_id, segment_no, version, org_id, country_code, currency)
);
CREATE INDEX host_ledger_org_idx ON core.settlement_host_ledger_entry (org_id, currency);

COMMENT ON TABLE core.settlement_host_ledger_entry IS
  'host_ledger (08 E5, E7 règle 7 ; 17 §2.9) : écritures signées de l''hôte par devise, rattachées '
  'au règlement et à sa version ; immuable. US-709a (ADR-153) : pénalité d''annulation seulement.';

-- Immuable : jamais modifiée ni supprimée (contre-passation future, US-709)
CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON core.settlement_host_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_host_ledger_entry
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable();

-- 2. Vue du solde (security_invoker : la RLS de la table s'applique) ------------------------------

CREATE VIEW core.settlement_host_ledger_balance_v WITH (security_invoker = true) AS
  SELECT e.org_id, e.country_code, e.currency,
         pg_catalog.sum(e.amount_minor)::bigint AS balance_minor,
         pg_catalog.count(*)::integer AS entries,
         pg_catalog.max(e.created_at) AS last_entry_at
    FROM core.settlement_host_ledger_entry AS e
   GROUP BY e.org_id, e.country_code, e.currency;
COMMENT ON VIEW core.settlement_host_ledger_balance_v IS
  'Solde du host_ledger par compte d''hôte, pays et devise (jamais entre devises, 08 E5) ; '
  'FINANCE / ADMIN du pays. US-709a (ADR-153).';

-- 3. RLS : ENABLE + FORCE, socle migrator_all, lectures FINANCE / ADMIN --------------------------

ALTER TABLE core.settlement_host_ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_host_ledger_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.settlement_host_ledger_entry TO migrator USING (true) WITH CHECK (true);

REVOKE ALL ON core.settlement_host_ledger_entry FROM PUBLIC;
REVOKE ALL ON core.settlement_host_ledger_balance_v FROM PUBLIC;

-- aucun identifiant du personnel dans la table : toutes les colonnes, FINANCE et ADMIN du pays
GRANT SELECT (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
              settlement_version, reason, amount_minor, created_at)
  ON core.settlement_host_ledger_entry TO app_api;
GRANT SELECT ON core.settlement_host_ledger_balance_v TO app_api;
CREATE POLICY fin_read ON core.settlement_host_ledger_entry FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));

-- propriétaire des commandes d'argent : lecture, insertion par colonnes ; une politique par
-- commande SQL, aucune UPDATE ni DELETE
GRANT SELECT ON core.settlement_host_ledger_entry TO cmd_money_owner;
GRANT INSERT (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
              settlement_version, reason, amount_minor)
  ON core.settlement_host_ledger_entry TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.settlement_host_ledger_entry FOR SELECT TO cmd_money_owner
  USING (true);
-- seule écriture : la pénalité d'une annulation réglée, dans la transaction du travailleur
-- trip_lifecycle (déclencheur de la liaison du règlement, section 5)
CREATE POLICY cmd_money_ins ON core.settlement_host_ledger_entry FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle'
              AND reason = 'HOST_CANCELLATION_PENALTY' AND amount_minor < 0);

-- 4. Commande d'écriture (cmd_money_owner) -------------------------------------------------------

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- Pénalité de l'hôte d'un règlement d'annulation (08 BR-CXL-13, E7 règle 7) : montant lu du
-- règlement (`host_penalty_minor`, calculé par le moteur et rejoué par la base, 0054), jamais
-- reçu ; écrit au débit de l'hôte, dans la devise du trip, à `platform.now()` (horodatage de
-- l'annulation réglée). Idempotente par (règlement, motif) : un rejeu rend l'écriture d'origine.
-- Pénalité nulle ⇒ NULL, rien d'écrit. Version > 1 (requalification SM-7) ⇒ refus : la
-- contre-passation de la version n est une suite (US-709).
CREATE FUNCTION core.settlement_cmd_post_host_penalty(p_settlement_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s    record;
  v_id uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'trip_lifecycle' THEN
    RAISE EXCEPTION 'host_ledger: commande réservée au travailleur trip_lifecycle'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'host_ledger_command_forbidden';
  END IF;
  SELECT x.id, x.trip_id, x.segment_no, x.version, x.org_id, x.country_code, x.currency,
         x.kind, x.host_penalty_minor
    INTO s
    FROM core.settlement_settlement AS x
   WHERE x.id = p_settlement_id;
  IF s.id IS NULL OR s.kind IS DISTINCT FROM 'CANCELLATION' THEN
    RAISE EXCEPTION 'host_ledger: règlement d''annulation inconnu'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'host_ledger_settlement_unknown';
  END IF;
  IF s.version <> 1 THEN
    RAISE EXCEPTION 'host_ledger: version % non prise en charge (contre-passation : US-709)', s.version
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'host_ledger_version_unsupported';
  END IF;
  IF s.host_penalty_minor = 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO core.settlement_host_ledger_entry
         (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
          settlement_version, reason, amount_minor)
  VALUES (pg_catalog.gen_random_uuid(), s.org_id, s.country_code, s.currency, s.trip_id,
          s.segment_no, s.id, s.version, 'HOST_CANCELLATION_PENALTY', -s.host_penalty_minor)
  ON CONFLICT ON CONSTRAINT host_ledger_entry_settlement_reason_unique DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT e.id INTO v_id
      FROM core.settlement_host_ledger_entry AS e
     WHERE e.settlement_id = s.id AND e.reason = 'HOST_CANCELLATION_PENALTY';
  END IF;
  RETURN v_id;
END
$fn$;
COMMENT ON FUNCTION core.settlement_cmd_post_host_penalty(uuid) IS
  'host_ledger : débit de la pénalité de l''hôte d''un règlement d''annulation v1 (montant du '
  'règlement), idempotent par (règlement, motif). Appelée par le déclencheur '
  'trip_cancellation_penalty_posted seulement (aucun EXECUTE). US-709a (ADR-153).';
REVOKE ALL ON FUNCTION core.settlement_cmd_post_host_penalty(uuid) FROM PUBLIC;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 5. Déclencheur : la pénalité écrite par la liaison du règlement (0124) -------------------------
-- Fonction créée par migrator (propriétaire de la table, qui pose le déclencheur), puis transférée
-- à cmd_money_owner, propriétaire de la commande qu'elle appelle (comme 0124, section 11).
CREATE FUNCTION core.settlement_post_cancellation_penalty()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM core.settlement_cmd_post_host_penalty(NEW.settlement_id);
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_post_cancellation_penalty() IS
  'Déclencheur trip_cancellation_penalty_posted : une demande d''annulation réglée (SETTLED) écrit '
  'la pénalité de l''hôte de son règlement au host_ledger, dans la même transaction. US-709a (ADR-153).';
REVOKE ALL ON FUNCTION core.settlement_post_cancellation_penalty() FROM PUBLIC;

CREATE TRIGGER trip_cancellation_penalty_posted
  AFTER UPDATE OF status ON core.booking_trip_cancellation
  FOR EACH ROW
  WHEN (NEW.status = 'SETTLED' AND OLD.status IS DISTINCT FROM 'SETTLED')
  EXECUTE FUNCTION core.settlement_post_cancellation_penalty();

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.settlement_post_cancellation_penalty() OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
