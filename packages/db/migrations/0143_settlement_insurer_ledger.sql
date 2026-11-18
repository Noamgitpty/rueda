-- 0143 — STL / FIN : jambe de l'assureur — registre `insurer_ledger`, bordereau mensuel à double
-- validation FINANCE et rapprochement.
-- US-227 (agent back-end / argent) ; 19 US-227 (critères 1 à 3 ; critère 4 : aucun ordre de
-- reversement en bêta, suite lot C) ; 16 PRT-003 ; 08 E4 (versions, variation n → n+1), E7 règles
-- 1, 3, 3 bis, 6 et 7, BR-PROT-01 ; vecteurs TJ01, TJ02b (USD), TJ08a, TJ08b (PYG), TJ14a, TJ14b ;
-- 17 v6 §2.3 (RLS-21 à RLS-24, `cmd_money_owner`), §2.9 (`insurer_ledger`, bordereaux), §3.2.8,
-- §3.2.13 ; ADR-064, ADR-111, ADR-147 (jambe déjà portée par un bordereau : refus fail-closed),
-- ADR-153 (modèle du `host_ledger`), ADR-165 (cette migration). Appliquée sous `migrator`, en une
-- transaction.
--
-- Cette migration :
--   1. contrat de l'assureur : colonnes `bordereau_period` (MONTHLY, défaut PROPOSÉ de 17 §7.2) et
--      `chargeback_clause` (PREMIUM_NEVER_REDUCED, 08 E7 règle 7), contrainte de portée
--      (id, assureur, pays) ; clés étrangères vers `settlement_insurer` et `settlement_insurer_contract`
--      des tables `insurer_ledger_state`, `insurer_bordereau` et `platform_advance` (reports d'US-062
--      et d'US-108) ;
--   2. bordereau : colonne `period_month` (mois `YYYY-MM` du pays) posée par la commande de rédaction,
--      un bordereau par (contrat, mois) ; politiques d'insertion resserrées (bordereau rédigé par la
--      commande, lignes seulement sur un bordereau DRAFT) ;
--   3. table `core.settlement_insurer_ledger_entry` : une écriture signée par ligne, `bigint` en
--      unités mineures de la devise du trip, rattachée au trip, au compte d'hôte, au contrat de
--      l'assureur en vigueur à la réservation (NULL si aucun : jamais facturée), et à sa source :
--      l'encaissement porté (`COLLECTION` : jambe INSURER de l'opération, motif positif) ou la
--      version du règlement (`SETTLEMENT_VARIATION` : variation signée de la jambe INSURER stockée,
--      E7 règle 3). Jamais recalculée, jamais un prorata : la politique d'insertion exige la ligne
--      source au montant exact. Idempotente par (opération) et par (règlement). Immuable. Une
--      version n+1 n'écrit que sa variation depuis la version n (sa base est la jambe de la
--      version n, 0027) : c'est la contre-passation de la version remplacée, sans réécrire la
--      version n ;
--   4. écritures DANS LA MÊME TRANSACTION que leur source : déclencheurs AFTER INSERT sur
--      `settlement_leg_movement` (encaissements) et sur `settlement_settlement_leg` (jambe INSURER,
--      variation non nulle) ; une variation sur un trip dont la jambe INSURER est déjà portée par un
--      bordereau émis est REFUSÉE (`insurer_leg_on_bordereau`, 08 E7 règle 3 bis, ADR-147 : pas
--      d'avance sur une jambe assureur libérée en bêta, revue FIN) ;
--   5. commande `core.settlement_cmd_draft_insurer_bordereaux(text)` (travailleur `bordereau`) :
--      pour le mois clos du pays, un bordereau DRAFT par contrat, une ligne par trip terminé dont la
--      prime due (Σ des écritures) est positive, non gelée (chargeback ouvert, 08 E7 règle 7) et pas
--      encore portée ; puis projection `insurer_ledger_state` (à payer, gelé, créance) ;
--   6. garde d'émission `insurer_bordereau_issue_check` (DRAFT → ISSUED, dans la commande
--      d'approbation FINANCE existante de 0123) : Σ lignes = total, chaque ligne = prime due
--      actuelle du trip, aucune ligne gelée ; sinon refus ;
--   7. faits du rapprochement `core.finance_insurer_ledger_facts()` (travailleur `reconciliation`).
--
-- Aucun paiement à l'assureur : aucun ordre `releaseLeg` ni reversement (PSP FAKE, aucun fonds de
-- tiers détenu ; 19 US-227 critère 4 : suite du lot C). `insurer_contract_active` n'est pas lu ni
-- modifié. Aucun texte visible.
--
-- Codes (packages/db/src/errors.ts) :
--   insurer_ledger_command_forbidden (42501)   → FORBIDDEN ;
--   insurer_leg_on_bordereau (55000)           → INVARIANT_VIOLATION (revue FIN du règlement) ;
--   insurer_bordereau_incoherent (23000)       → INVARIANT_VIOLATION ;
--   insurer_bordereau_stale (55000)            → INVARIANT_VIOLATION ;
--   insurer_bordereau_line_frozen (55000)      → INVARIANT_VIOLATION ;
--   settlement_immutable (23000)               → IMMUTABLE_RECORD (0027).
--
-- Expand / contract : colonnes (avec défaut), contraintes, table, fonctions, déclencheurs, droits
-- et politiques AJOUTÉS ; deux politiques d'insertion de cmd_money_owner resserrées (ALTER POLICY) ;
-- rien n'est retiré.
--
-- Retour arrière :
--   DROP TRIGGER insurer_bordereau_issue_check ON core.settlement_insurer_bordereau;
--   DROP TRIGGER insurer_ledger_variation_posted ON core.settlement_settlement_leg;
--   DROP TRIGGER insurer_ledger_collection_posted ON core.settlement_leg_movement;
--   DROP FUNCTION core.finance_insurer_ledger_facts(),
--     core.settlement_cmd_draft_insurer_bordereaux(text),
--     core.settlement_insurer_bordereau_issue_check(),
--     core.settlement_post_insurer_variation(), core.settlement_post_insurer_collection(),
--     core.settlement_insurer_contract_of_trip(uuid);
--   DROP TABLE core.settlement_insurer_ledger_entry;
--   ALTER POLICY cmd_money_ins ON core.settlement_insurer_bordereau WITH CHECK (<0036>);
--   ALTER POLICY cmd_money_ins ON core.settlement_insurer_bordereau_line WITH CHECK (<0036>);
--   ALTER TABLE core.settlement_insurer_bordereau DROP COLUMN period_month,
--     DROP CONSTRAINT insurer_bordereau_insurer_fk, DROP CONSTRAINT insurer_bordereau_contract_fk;
--   ALTER TABLE core.settlement_insurer_ledger_state DROP CONSTRAINT insurer_ledger_insurer_fk;
--   ALTER TABLE core.settlement_platform_advance DROP CONSTRAINT platform_advance_insurer_fk;
--   ALTER TABLE core.settlement_insurer_contract DROP COLUMN bordereau_period,
--     DROP COLUMN chargeback_clause, DROP CONSTRAINT settlement_insurer_contract_scope_unique;
--   (droits de cmd_money_owner de la section 5 : REVOKE).

-- 1. Contrat de l'assureur et clés étrangères ----------------------------------------------------

ALTER TABLE core.settlement_insurer_contract
  ADD COLUMN bordereau_period text NOT NULL DEFAULT 'MONTHLY'
    CONSTRAINT settlement_insurer_contract_bordereau_period_valid
      CHECK (bordereau_period IN ('MONTHLY')),
  ADD COLUMN chargeback_clause text NOT NULL DEFAULT 'PREMIUM_NEVER_REDUCED'
    CONSTRAINT settlement_insurer_contract_chargeback_clause_valid
      CHECK (chargeback_clause IN ('PREMIUM_NEVER_REDUCED')),
  ADD CONSTRAINT settlement_insurer_contract_scope_unique UNIQUE (id, insurer_id, country_code);
COMMENT ON COLUMN core.settlement_insurer_contract.bordereau_period IS
  'Périodicité du bordereau (insurer_settlement_at, 08 E7 règle 6) : MONTHLY, défaut PROPOSÉ ; '
  'fixée par le contrat signé (décision du fondateur). US-227 (ADR-165).';
COMMENT ON COLUMN core.settlement_insurer_contract.chargeback_clause IS
  'Clause de chargeback : PREMIUM_NEVER_REDUCED (08 E7 règle 7 : la prime due n''est jamais '
  'réduite par un chargeback perdu sans décision écrite). US-227 (ADR-165).';

ALTER TABLE core.settlement_insurer_ledger_state
  ADD CONSTRAINT insurer_ledger_insurer_fk FOREIGN KEY (insurer_id, country_code)
    REFERENCES core.settlement_insurer (id, country_code);
ALTER TABLE core.settlement_platform_advance
  ADD CONSTRAINT platform_advance_insurer_fk FOREIGN KEY (insurer_id, country_code)
    REFERENCES core.settlement_insurer (id, country_code);

-- 2. Bordereau : mois de la commande, unicité, clés étrangères -------------------------------------

ALTER TABLE core.settlement_insurer_bordereau
  ADD COLUMN period_month text
    CONSTRAINT insurer_bordereau_period_month_format
      CHECK (period_month IS NULL OR period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT insurer_bordereau_insurer_fk FOREIGN KEY (insurer_id, country_code)
    REFERENCES core.settlement_insurer (id, country_code),
  ADD CONSTRAINT insurer_bordereau_contract_fk FOREIGN KEY (insurer_contract_id, insurer_id, country_code)
    REFERENCES core.settlement_insurer_contract (id, insurer_id, country_code);
COMMENT ON COLUMN core.settlement_insurer_bordereau.period_month IS
  'Mois YYYY-MM du pays couvert (période [début, fin) dans le fuseau du pays) ; posé par '
  'settlement_cmd_draft_insurer_bordereaux, seul rédacteur. US-227 (ADR-165).';
-- un bordereau par contrat et par mois (rédaction idempotente)
CREATE UNIQUE INDEX insurer_bordereau_contract_month ON core.settlement_insurer_bordereau
  (insurer_contract_id, period_month) WHERE (period_month IS NOT NULL);

-- lecture : FINANCE / ADMIN du pays (fin_read de 0036) et travailleurs de la liste blanche
GRANT SELECT (period_month) ON core.settlement_insurer_bordereau TO app_api, app_worker;

-- 3. Registre de l'assureur ----------------------------------------------------------------------

CREATE TABLE core.settlement_insurer_ledger_entry (
  id                  uuid        PRIMARY KEY,
  trip_id             uuid        NOT NULL,
  segment_no          integer     NOT NULL
    CONSTRAINT insurer_ledger_entry_segment_beta CHECK (segment_no = 1),   -- bêta : voir settlement
  org_id              uuid        NOT NULL,                    -- compte d'hôte du trip (portée)
  country_code        text        NOT NULL
    CONSTRAINT insurer_ledger_entry_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency            text        NOT NULL                     -- devise du trip
    CONSTRAINT insurer_ledger_entry_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  -- contrat en vigueur à la réservation du trip (17 §3.2.13 : valeurs figées à la réservation) ;
  -- NULL si aucun : l'écriture est gardée (aucun montant perdu) mais n'entre dans aucun bordereau
  insurer_id          uuid,
  insurer_contract_id uuid,
  reason              text        NOT NULL
    CONSTRAINT insurer_ledger_entry_reason_valid CHECK (reason IN ('COLLECTION', 'SETTLEMENT_VARIATION')),
  operation_id        uuid,                                    -- COLLECTION : encaissement porté
  settlement_id       uuid,                                    -- SETTLEMENT_VARIATION : version
  settlement_version  integer
    CONSTRAINT insurer_ledger_entry_version_positive CHECK (settlement_version >= 1),
  -- signé, du point de vue de l'assureur : > 0 prime due en plus, < 0 prime due en moins
  amount_minor        bigint      NOT NULL
    CONSTRAINT insurer_ledger_entry_amount_nonzero CHECK (amount_minor <> 0),
  created_at          timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT insurer_ledger_entry_attribution CHECK ((insurer_id IS NULL) = (insurer_contract_id IS NULL)),
  CONSTRAINT insurer_ledger_entry_source_shape CHECK (
    (reason = 'COLLECTION' AND operation_id IS NOT NULL AND settlement_id IS NULL
       AND settlement_version IS NULL AND amount_minor > 0)
    OR (reason = 'SETTLEMENT_VARIATION' AND operation_id IS NULL AND settlement_id IS NOT NULL
        AND settlement_version IS NOT NULL)),
  CONSTRAINT insurer_ledger_entry_operation_unique UNIQUE (operation_id),
  CONSTRAINT insurer_ledger_entry_settlement_unique UNIQUE (settlement_id),
  CONSTRAINT insurer_ledger_entry_trip_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  CONSTRAINT insurer_ledger_entry_operation_fk FOREIGN KEY (operation_id)
    REFERENCES core.settlement_leg_movement (operation_id),
  CONSTRAINT insurer_ledger_entry_settlement_fk
    FOREIGN KEY (settlement_id, trip_id, segment_no, settlement_version, org_id, country_code, currency)
    REFERENCES core.settlement_settlement (id, trip_id, segment_no, version, org_id, country_code, currency),
  CONSTRAINT insurer_ledger_entry_contract_fk FOREIGN KEY (insurer_contract_id, insurer_id, country_code)
    REFERENCES core.settlement_insurer_contract (id, insurer_id, country_code)
);
CREATE INDEX insurer_ledger_entry_trip_idx ON core.settlement_insurer_ledger_entry (trip_id);
CREATE INDEX insurer_ledger_entry_contract_idx ON core.settlement_insurer_ledger_entry
  (insurer_contract_id, country_code, currency) WHERE (insurer_contract_id IS NOT NULL);

COMMENT ON TABLE core.settlement_insurer_ledger_entry IS
  'insurer_ledger (08 E7 ; 17 §2.9) : prime due à l''assureur, écritures signées par trip, lues '
  'de la jambe INSURER stockée (encaissement porté, variation de chaque version du règlement), '
  'dans la transaction de leur source ; immuable. US-227 (ADR-165).';

CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON core.settlement_insurer_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION core.settlement_guard_immutable();
CREATE TRIGGER settlement_immutable_truncate BEFORE TRUNCATE ON core.settlement_insurer_ledger_entry
  FOR EACH STATEMENT EXECUTE FUNCTION core.settlement_guard_immutable();

-- RLS : ENABLE + FORCE, socle migrator_all, lecture FINANCE / ADMIN du pays (comme host_ledger)
ALTER TABLE core.settlement_insurer_ledger_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.settlement_insurer_ledger_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.settlement_insurer_ledger_entry TO migrator
  USING (true) WITH CHECK (true);
REVOKE ALL ON core.settlement_insurer_ledger_entry FROM PUBLIC;
-- aucun identifiant du personnel dans la table : toutes les colonnes, FINANCE et ADMIN du pays
GRANT SELECT (id, trip_id, segment_no, org_id, country_code, currency, insurer_id,
              insurer_contract_id, reason, operation_id, settlement_id, settlement_version,
              amount_minor, created_at)
  ON core.settlement_insurer_ledger_entry TO app_api;
CREATE POLICY fin_read ON core.settlement_insurer_ledger_entry FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('FINANCE', country_code) OR app.has_staff_role('ADMIN', country_code)));

-- propriétaire des commandes d'argent : lecture ; insertion par colonnes, une écriture n'existe
-- qu'en MIROIR EXACT de sa source (jamais un montant reçu) ; ni UPDATE ni DELETE
GRANT SELECT ON core.settlement_insurer_ledger_entry TO cmd_money_owner;
GRANT INSERT (id, trip_id, segment_no, org_id, country_code, currency, insurer_id,
              insurer_contract_id, reason, operation_id, settlement_id, settlement_version,
              amount_minor)
  ON core.settlement_insurer_ledger_entry TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.settlement_insurer_ledger_entry FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_ins ON core.settlement_insurer_ledger_entry FOR INSERT TO cmd_money_owner
  WITH CHECK (
    (settlement_insurer_ledger_entry.reason = 'COLLECTION' AND EXISTS (
       SELECT 1
         FROM core.settlement_leg_movement AS m
         JOIN core.payment_payment_operation_leg AS g
           ON g.operation_id = m.operation_id AND g.leg = 'INSURER'
        WHERE m.operation_id = settlement_insurer_ledger_entry.operation_id
          AND m.trip_id = settlement_insurer_ledger_entry.trip_id
          AND m.segment_no = settlement_insurer_ledger_entry.segment_no
          AND m.kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
          AND g.amount_minor = settlement_insurer_ledger_entry.amount_minor))
    OR (settlement_insurer_ledger_entry.reason = 'SETTLEMENT_VARIATION' AND EXISTS (
       SELECT 1
         FROM core.settlement_settlement_leg AS l
        WHERE l.settlement_id = settlement_insurer_ledger_entry.settlement_id
          AND l.leg = 'INSURER'
          AND l.trip_id = settlement_insurer_ledger_entry.trip_id
          AND l.segment_no = settlement_insurer_ledger_entry.segment_no
          AND l.variation_minor = settlement_insurer_ledger_entry.amount_minor)));

-- 4. Politiques d'insertion du bordereau resserrées (0036) ----------------------------------------
GRANT INSERT (period_month) ON core.settlement_insurer_bordereau TO cmd_money_owner;
ALTER POLICY cmd_money_ins ON core.settlement_insurer_bordereau
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'bordereau' AND status = 'DRAFT'
              AND period_month IS NOT NULL);
ALTER POLICY cmd_money_ins ON core.settlement_insurer_bordereau_line
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'bordereau'
              AND EXISTS (SELECT 1 FROM core.settlement_insurer_bordereau AS b
                           WHERE b.id = settlement_insurer_bordereau_line.bordereau_id
                             AND b.country_code = settlement_insurer_bordereau_line.country_code
                             AND b.status = 'DRAFT'));

-- 5. Lectures de cmd_money_owner nécessaires (sous migrator, propriétaire des tables) -------------
GRANT SELECT (created_at) ON core.booking_trip TO cmd_money_owner;
GRANT SELECT (time_zone) ON core.config_country TO cmd_money_owner;
GRANT SELECT (id, country_code, status) ON core.settlement_insurer TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.settlement_insurer FOR SELECT TO cmd_money_owner USING (true);
GRANT SELECT (id, insurer_id, country_code, valid_from, valid_to, bordereau_period)
  ON core.settlement_insurer_contract TO cmd_money_owner;
CREATE POLICY cmd_money_sel ON core.settlement_insurer_contract FOR SELECT TO cmd_money_owner
  USING (true);

-- 6. Fonctions de la famille cmd_money -----------------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- Contrat de l'assureur du trip : celui du pays en vigueur à la réservation (création du trip) ;
-- au plus un (exclusion GiST de 0081). Aide interne SECURITY INVOKER : appelée par les fonctions
-- de son propriétaire seulement (aucun EXECUTE).
CREATE FUNCTION core.settlement_insurer_contract_of_trip(p_trip_id uuid)
  RETURNS TABLE (insurer_id uuid, contract_id uuid)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT c.insurer_id, c.id
    FROM core.booking_trip AS t
    JOIN core.settlement_insurer_contract AS c
      ON c.country_code = t.country_code
     AND c.valid_from <= t.created_at
     AND (c.valid_to IS NULL OR c.valid_to > t.created_at)
   WHERE t.id = p_trip_id
   ORDER BY c.valid_from DESC
   LIMIT 1
$fn$;
COMMENT ON FUNCTION core.settlement_insurer_contract_of_trip(uuid) IS
  'Contrat de l''assureur en vigueur à la réservation du trip (pays du trip) ; aucune ligne si '
  'aucun. Aide interne de cmd_money_owner. US-227 (ADR-165).';
REVOKE ALL ON FUNCTION core.settlement_insurer_contract_of_trip(uuid) FROM PUBLIC;

-- Bordereaux du mois clos de chaque pays (17 §2.9 ; 08 E7 règles 6 et 7), travailleur `bordereau`.
-- p_month NULL : mois précédent dans le fuseau du pays ; sinon `YYYY-MM`, refusé s'il n'est pas
-- clos (PERIOD_OPEN). Par contrat : un bordereau DRAFT par mois (EXISTS si déjà rédigé), une ligne
-- par trip terminé (fin prévue ≤ fin du mois, état hors cours et hors litige) dont la prime due
-- Σ écritures > 0, jambe INSURER non gelée et pas encore portée ; total = Σ lignes. Puis projection
-- `insurer_ledger_state` du pays : à payer (prime due non portée, non gelée), gelée (chargeback
-- ouvert), créance (portée au-delà de la prime due). Aucun ordre de paiement.
CREATE FUNCTION core.settlement_cmd_draft_insurer_bordereaux(p_month text)
  RETURNS TABLE (outcome text, country text, bordereau uuid, lines integer, total bigint)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_now     timestamptz := platform.now();
  c         record;
  k         record;
  v_month   text;
  v_first   date;
  v_lower   timestamptz;
  v_upper   timestamptz;
  v_next    timestamptz;
  v_id      uuid;
  v_trips   uuid[];
  v_amounts bigint[];
  v_total   bigint;
  v_count   integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'bordereau' THEN
    RAISE EXCEPTION 'insurer_ledger: commande réservée au travailleur bordereau'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'insurer_ledger_command_forbidden';
  END IF;
  IF p_month IS NOT NULL AND p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'insurer_ledger: mois invalide (YYYY-MM attendu)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  FOR c IN
    SELECT y.code::text AS code, y.currency::text AS currency, y.time_zone
      FROM core.config_country AS y
     ORDER BY y.code
  LOOP
    v_month := COALESCE(p_month,
                        pg_catalog.to_char((v_now AT TIME ZONE c.time_zone) - interval '1 month',
                                           'YYYY-MM'));
    v_first := pg_catalog.to_date(v_month || '-01', 'YYYY-MM-DD');
    v_lower := v_first::timestamp AT TIME ZONE c.time_zone;
    v_upper := (v_first + interval '1 month') AT TIME ZONE c.time_zone;
    -- prochaine émission : fin du mois en cours dans le fuseau du pays
    v_next := (pg_catalog.date_trunc('month', v_now AT TIME ZONE c.time_zone) + interval '1 month')
                AT TIME ZONE c.time_zone;

    IF v_upper > v_now THEN
      RETURN QUERY SELECT 'PERIOD_OPEN'::text, c.code, NULL::uuid, 0, 0::bigint;
    ELSE
      FOR k IN
        SELECT DISTINCT e.insurer_contract_id AS contract_id, e.insurer_id
          FROM core.settlement_insurer_ledger_entry AS e
         WHERE e.country_code = c.code AND e.currency = c.currency
           AND e.insurer_contract_id IS NOT NULL
         ORDER BY 1
      LOOP
        -- un rédacteur à la fois par contrat ; l'index unique (contrat, mois) en défense
        PERFORM pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtext('rueda.insurer_bordereau:' || k.contract_id::text));
        SELECT b.id INTO v_id
          FROM core.settlement_insurer_bordereau AS b
         WHERE b.insurer_contract_id = k.contract_id AND b.period_month = v_month;
        IF v_id IS NOT NULL THEN
          RETURN QUERY
            SELECT 'EXISTS'::text, c.code, v_id,
                   (SELECT pg_catalog.count(*)::integer
                      FROM core.settlement_insurer_bordereau_line AS l WHERE l.bordereau_id = v_id),
                   (SELECT b.total_minor FROM core.settlement_insurer_bordereau AS b WHERE b.id = v_id);
          CONTINUE;
        END IF;
        SELECT pg_catalog.array_agg(d.trip_id ORDER BY d.trip_id),
               pg_catalog.array_agg(d.due ORDER BY d.trip_id),
               COALESCE(pg_catalog.sum(d.due), 0)::bigint,
               pg_catalog.count(*)::integer
          INTO v_trips, v_amounts, v_total, v_count
          FROM (SELECT e.trip_id, pg_catalog.sum(e.amount_minor)::bigint AS due
                  FROM core.settlement_insurer_ledger_entry AS e
                 WHERE e.insurer_contract_id = k.contract_id AND e.country_code = c.code
                   AND e.currency = c.currency AND e.segment_no = 1
                 GROUP BY e.trip_id) AS d
          JOIN core.booking_trip AS t ON t.id = d.trip_id
         WHERE d.due > 0
           AND t.scheduled_end <= v_upper
           AND t.status NOT IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED', 'IN_PROGRESS',
                                'OVERDUE', 'UNRETURNED', 'IN_DISPUTE')
           AND NOT EXISTS (SELECT 1 FROM core.settlement_insurer_bordereau_line AS l
                            WHERE l.trip_id = d.trip_id AND l.segment_no = 1)
           AND NOT EXISTS (SELECT 1 FROM core.settlement_trip_leg_balance AS lb
                            WHERE lb.trip_id = d.trip_id AND lb.segment_no = 1
                              AND lb.leg = 'INSURER' AND lb.frozen);
        IF v_count = 0 THEN
          RETURN QUERY SELECT 'EMPTY'::text, c.code, NULL::uuid, 0, 0::bigint;
          CONTINUE;
        END IF;
        v_id := pg_catalog.gen_random_uuid();
        INSERT INTO core.settlement_insurer_bordereau
               (id, insurer_id, insurer_contract_id, country_code, currency, period, total_minor,
                period_month)
        VALUES (v_id, k.insurer_id, k.contract_id, c.code, c.currency,
                pg_catalog.tstzrange(v_lower, v_upper, '[)'), v_total, v_month);
        INSERT INTO core.settlement_insurer_bordereau_line
               (bordereau_id, country_code, trip_id, segment_no, amount_minor)
        SELECT v_id, c.code, u.trip_id, 1, u.amount
          FROM ROWS FROM (pg_catalog.unnest(v_trips), pg_catalog.unnest(v_amounts))
               AS u(trip_id, amount);
        RETURN QUERY SELECT 'DRAFTED'::text, c.code, v_id, v_count, v_total;
      END LOOP;
    END IF;

    -- projection de la position de chaque assureur du pays (17 §2.9 insurer_ledger)
    INSERT INTO core.settlement_insurer_ledger_state AS s
           (insurer_id, country_code, currency, payable_minor, frozen_minor, receivable_minor,
            next_bordereau_at)
    SELECT p.insurer_id, c.code, c.currency, p.payable, p.frozen, p.receivable, v_next
      FROM (SELECT x.insurer_id,
                   COALESCE(pg_catalog.sum(x.open) FILTER (WHERE x.open > 0 AND NOT x.frozen), 0)::bigint
                     AS payable,
                   COALESCE(pg_catalog.sum(x.open) FILTER (WHERE x.open > 0 AND x.frozen), 0)::bigint
                     AS frozen,
                   COALESCE(pg_catalog.sum(-x.open) FILTER (WHERE x.open < 0), 0)::bigint
                     AS receivable
              FROM (SELECT d.insurer_id, d.due - COALESCE(bl.billed, 0) AS open,
                           COALESCE(fz.frozen, false) AS frozen
                      FROM (SELECT e.insurer_id, e.trip_id, pg_catalog.sum(e.amount_minor) AS due
                              FROM core.settlement_insurer_ledger_entry AS e
                             WHERE e.country_code = c.code AND e.currency = c.currency
                               AND e.insurer_id IS NOT NULL AND e.segment_no = 1
                             GROUP BY e.insurer_id, e.trip_id) AS d
                      LEFT JOIN LATERAL (
                        SELECT pg_catalog.sum(l.amount_minor) AS billed
                          FROM core.settlement_insurer_bordereau_line AS l
                          JOIN core.settlement_insurer_bordereau AS b ON b.id = l.bordereau_id
                         WHERE l.trip_id = d.trip_id AND l.segment_no = 1
                           AND b.status <> 'DRAFT' AND b.insurer_id = d.insurer_id) AS bl ON true
                      LEFT JOIN LATERAL (
                        SELECT pg_catalog.bool_or(lb.frozen) AS frozen
                          FROM core.settlement_trip_leg_balance AS lb
                         WHERE lb.trip_id = d.trip_id AND lb.segment_no = 1
                           AND lb.leg = 'INSURER') AS fz ON true) AS x
             GROUP BY x.insurer_id) AS p
    ON CONFLICT ON CONSTRAINT settlement_insurer_ledger_state_pkey DO UPDATE
       SET payable_minor = EXCLUDED.payable_minor, frozen_minor = EXCLUDED.frozen_minor,
           receivable_minor = EXCLUDED.receivable_minor,
           next_bordereau_at = EXCLUDED.next_bordereau_at;
  END LOOP;
END
$fn$;
COMMENT ON FUNCTION core.settlement_cmd_draft_insurer_bordereaux(text) IS
  'Bordereaux DRAFT du mois clos par contrat d''assureur et projection insurer_ledger_state ; '
  'travailleur bordereau seulement (EXECUTE app_worker) ; aucun paiement. US-227 (ADR-165).';
REVOKE ALL ON FUNCTION core.settlement_cmd_draft_insurer_bordereaux(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.settlement_cmd_draft_insurer_bordereaux(text) TO app_worker;

-- Faits du rapprochement de la jambe assureur, par trip (identifiant technique non rendu par le
-- rapport : comptes par pays, FIN, money-reconciliation.ts) : Σ écritures d'encaissement et Σ
-- jambes INSURER des encaissements portés ; Σ écritures de règlement et Σ variations INSURER des
-- versions ; Σ porté par des bordereaux émis de la commande ; prime due ; écriture sans contrat.
CREATE FUNCTION core.finance_insurer_ledger_facts()
  RETURNS TABLE (country_code text, currency text, collected_entries_minor bigint,
                 collected_legs_minor bigint, settled_entries_minor bigint,
                 settled_variations_minor bigint, billed_minor bigint, due_minor bigint,
                 unattributed boolean)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'reconciliation' THEN
    RAISE EXCEPTION 'finance: insurer ledger facts are read by the reconciliation worker only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH col AS (
    SELECT m.trip_id, pg_catalog.sum(g.amount_minor)::bigint AS legs
      FROM core.settlement_leg_movement AS m
      JOIN core.payment_payment_operation_leg AS g
        ON g.operation_id = m.operation_id AND g.leg = 'INSURER'
     WHERE m.segment_no = 1 AND m.kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
     GROUP BY m.trip_id
  ),
  vari AS (
    SELECT l.trip_id, pg_catalog.sum(l.variation_minor)::bigint AS variations
      FROM core.settlement_settlement_leg AS l
     WHERE l.segment_no = 1 AND l.leg = 'INSURER'
     GROUP BY l.trip_id
  ),
  ent AS (
    SELECT e.trip_id,
           pg_catalog.sum(e.amount_minor) FILTER (WHERE e.reason = 'COLLECTION')::bigint AS col,
           pg_catalog.sum(e.amount_minor) FILTER (WHERE e.reason = 'SETTLEMENT_VARIATION')::bigint
             AS var,
           pg_catalog.sum(e.amount_minor)::bigint AS due,
           pg_catalog.bool_or(e.insurer_contract_id IS NULL) AS unattributed
      FROM core.settlement_insurer_ledger_entry AS e
     WHERE e.segment_no = 1
     GROUP BY e.trip_id
  ),
  bil AS (
    -- bordereaux rédigés par la commande (period_month posé), émis ou au-delà
    SELECT l.trip_id, pg_catalog.sum(l.amount_minor)::bigint AS billed
      FROM core.settlement_insurer_bordereau_line AS l
      JOIN core.settlement_insurer_bordereau AS b ON b.id = l.bordereau_id
     WHERE l.segment_no = 1 AND b.status <> 'DRAFT' AND b.period_month IS NOT NULL
     GROUP BY l.trip_id
  ),
  ids AS (
    SELECT col.trip_id AS id FROM col
    UNION SELECT vari.trip_id FROM vari
    UNION SELECT ent.trip_id FROM ent
    UNION SELECT bil.trip_id FROM bil
  )
  SELECT t.country_code, t.currency,
         COALESCE(ent.col, 0)::bigint, COALESCE(col.legs, 0)::bigint,
         COALESCE(ent.var, 0)::bigint, COALESCE(vari.variations, 0)::bigint,
         COALESCE(bil.billed, 0)::bigint, COALESCE(ent.due, 0)::bigint,
         COALESCE(ent.unattributed, false)
    FROM ids
    JOIN core.booking_trip AS t ON t.id = ids.id
    LEFT JOIN col ON col.trip_id = ids.id
    LEFT JOIN vari ON vari.trip_id = ids.id
    LEFT JOIN ent ON ent.trip_id = ids.id
    LEFT JOIN bil ON bil.trip_id = ids.id;
END
$fn$;
COMMENT ON FUNCTION core.finance_insurer_ledger_facts() IS
  'Faits du rapprochement de la jambe assureur par trip : écritures du registre et jambes INSURER '
  'stockées (encaissements portés, variations des versions), porté par bordereau émis, prime due. '
  'Travailleur reconciliation seulement (EXECUTE app_worker). US-227 (ADR-165).';
REVOKE ALL ON FUNCTION core.finance_insurer_ledger_facts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.finance_insurer_ledger_facts() TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 7. Déclencheurs d'écriture (créés par migrator, propriétaire des tables, puis transférés à
-- cmd_money_owner, comme 0129 section 5) --------------------------------------------------------

-- Encaissement porté (CAPTURE, MIT_CHARGE, DEBT_COLLECTION) : jambe INSURER de l'opération, lue
-- de `payment_operation_leg` (montant explicite, 08 E7 règle 1) ; 0 ⇒ rien. Rejeu : rien (UNIQUE).
CREATE FUNCTION core.settlement_post_insurer_collection()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_amount bigint;
  t        record;
  k        record;
BEGIN
  SELECT g.amount_minor INTO v_amount
    FROM core.payment_payment_operation_leg AS g
   WHERE g.operation_id = NEW.operation_id AND g.leg = 'INSURER';
  IF v_amount IS NULL OR v_amount = 0 THEN
    RETURN NULL;
  END IF;
  SELECT x.org_id, x.country_code, x.currency INTO t
    FROM core.booking_trip AS x WHERE x.id = NEW.trip_id;
  SELECT y.insurer_id, y.contract_id INTO k
    FROM core.settlement_insurer_contract_of_trip(NEW.trip_id) AS y;
  INSERT INTO core.settlement_insurer_ledger_entry
         (id, trip_id, segment_no, org_id, country_code, currency, insurer_id, insurer_contract_id,
          reason, operation_id, amount_minor)
  VALUES (pg_catalog.gen_random_uuid(), NEW.trip_id, NEW.segment_no, t.org_id, t.country_code,
          t.currency, k.insurer_id, k.contract_id, 'COLLECTION', NEW.operation_id, v_amount)
  ON CONFLICT ON CONSTRAINT insurer_ledger_entry_operation_unique DO NOTHING;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_post_insurer_collection() IS
  'Déclencheur insurer_ledger_collection_posted : la jambe INSURER d''un encaissement porté sur les '
  'soldes est écrite au registre de l''assureur, dans la même transaction. US-227 (ADR-165).';
REVOKE ALL ON FUNCTION core.settlement_post_insurer_collection() FROM PUBLIC;

-- Version de règlement : variation signée de la jambe INSURER stockée (08 E7 règle 3 ; version
-- n+1 : variation depuis la version n). Jambe déjà portée par un bordereau émis ⇒ refus (règle
-- 3 bis, ADR-147) : le règlement entier est annulé et part en revue FIN.
CREATE FUNCTION core.settlement_post_insurer_variation()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  s record;
  k record;
BEGIN
  IF EXISTS (SELECT 1
               FROM core.settlement_insurer_bordereau_line AS l
               JOIN core.settlement_insurer_bordereau AS b ON b.id = l.bordereau_id
              WHERE l.trip_id = NEW.trip_id AND l.segment_no = NEW.segment_no
                AND b.status <> 'DRAFT') THEN
    RAISE EXCEPTION 'insurer_ledger: jambe INSURER déjà portée par un bordereau émis (08 E7 règle 3 bis)'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'insurer_leg_on_bordereau';
  END IF;
  SELECT x.version, x.org_id, x.country_code, x.currency INTO s
    FROM core.settlement_settlement AS x WHERE x.id = NEW.settlement_id;
  SELECT y.insurer_id, y.contract_id INTO k
    FROM core.settlement_insurer_contract_of_trip(NEW.trip_id) AS y;
  INSERT INTO core.settlement_insurer_ledger_entry
         (id, trip_id, segment_no, org_id, country_code, currency, insurer_id, insurer_contract_id,
          reason, settlement_id, settlement_version, amount_minor)
  VALUES (pg_catalog.gen_random_uuid(), NEW.trip_id, NEW.segment_no, s.org_id, s.country_code,
          s.currency, k.insurer_id, k.contract_id, 'SETTLEMENT_VARIATION', NEW.settlement_id,
          s.version, NEW.variation_minor)
  ON CONFLICT ON CONSTRAINT insurer_ledger_entry_settlement_unique DO NOTHING;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_post_insurer_variation() IS
  'Déclencheur insurer_ledger_variation_posted : la variation de la jambe INSURER d''une version de '
  'règlement est écrite au registre de l''assureur, dans la même transaction ; refus si la jambe '
  'est déjà portée par un bordereau émis. US-227 (ADR-165).';
REVOKE ALL ON FUNCTION core.settlement_post_insurer_variation() FROM PUBLIC;

CREATE TRIGGER insurer_ledger_collection_posted
  AFTER INSERT ON core.settlement_leg_movement
  FOR EACH ROW
  WHEN (NEW.kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION'))
  EXECUTE FUNCTION core.settlement_post_insurer_collection();
CREATE TRIGGER insurer_ledger_variation_posted
  AFTER INSERT ON core.settlement_settlement_leg
  FOR EACH ROW
  WHEN (NEW.leg = 'INSURER' AND NEW.variation_minor <> 0)
  EXECUTE FUNCTION core.settlement_post_insurer_variation();

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.settlement_post_insurer_collection() OWNER TO cmd_money_owner;
ALTER FUNCTION core.settlement_post_insurer_variation() OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 8. Garde d'émission (SECURITY INVOKER : exécutée sous cmd_money_owner par la commande
-- d'approbation FINANCE de 0123, seule à écrire ISSUED) ------------------------------------------
-- Un bordereau rédigé par la commande (period_month posé) n'est émis que s'il porte au moins une
-- ligne, Σ lignes = total, chaque ligne = prime due actuelle du trip (Σ écritures du contrat ; une
-- variation postérieure à la rédaction ⇒ bordereau périmé) et aucune jambe INSURER gelée.
CREATE FUNCTION core.settlement_insurer_bordereau_issue_check()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_count integer;
  v_sum   bigint;
BEGIN
  IF NEW.period_month IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT pg_catalog.count(*)::integer, COALESCE(pg_catalog.sum(l.amount_minor), 0)::bigint
    INTO v_count, v_sum
    FROM core.settlement_insurer_bordereau_line AS l
   WHERE l.bordereau_id = NEW.id;
  IF v_count = 0 OR v_sum <> NEW.total_minor THEN
    RAISE EXCEPTION 'insurer_bordereau: lignes absentes ou Σ lignes ≠ total'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'insurer_bordereau_incoherent';
  END IF;
  IF EXISTS (SELECT 1
               FROM core.settlement_insurer_bordereau_line AS l
               JOIN core.settlement_trip_leg_balance AS lb
                 ON lb.trip_id = l.trip_id AND lb.segment_no = l.segment_no AND lb.leg = 'INSURER'
              WHERE l.bordereau_id = NEW.id AND lb.frozen) THEN
    RAISE EXCEPTION 'insurer_bordereau: une ligne porte une jambe INSURER gelée (08 E7 règle 7)'
      USING ERRCODE = 'object_not_in_prerequisite_state',
            CONSTRAINT = 'insurer_bordereau_line_frozen';
  END IF;
  IF EXISTS (SELECT 1
               FROM core.settlement_insurer_bordereau_line AS l
              WHERE l.bordereau_id = NEW.id
                AND l.amount_minor IS DISTINCT FROM (
                  SELECT pg_catalog.sum(e.amount_minor)::bigint
                    FROM core.settlement_insurer_ledger_entry AS e
                   WHERE e.trip_id = l.trip_id AND e.segment_no = l.segment_no
                     AND e.insurer_contract_id = NEW.insurer_contract_id)) THEN
    RAISE EXCEPTION 'insurer_bordereau: prime due changée depuis la rédaction'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'insurer_bordereau_stale';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION core.settlement_insurer_bordereau_issue_check() IS
  'Garde insurer_bordereau_issue_check (DRAFT → ISSUED) : lignes = total, lignes = prime due '
  'actuelle, aucune ligne gelée, pour un bordereau rédigé par la commande. US-227 (ADR-165).';
REVOKE ALL ON FUNCTION core.settlement_insurer_bordereau_issue_check() FROM PUBLIC;

CREATE TRIGGER insurer_bordereau_issue_check
  BEFORE UPDATE OF status ON core.settlement_insurer_bordereau
  FOR EACH ROW
  WHEN (OLD.status = 'DRAFT' AND NEW.status = 'ISSUED')
  EXECUTE FUNCTION core.settlement_insurer_bordereau_issue_check();
