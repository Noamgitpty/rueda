-- 0137 — STL : créance de l'hôte de la règle 3 bis portée au `host_ledger` (avance de Kmino).
-- US-224 (partie 224e, argent / back-end) ; 19 US-224 critère 4 (« une créance de 75,00 est inscrite
-- au `host_ledger` (avance de Kmino `platform_advance`, plafonnée par `host_advance_cap_minor`) ») ;
-- BOARD N-274 ; 08 E7 règle 3 bis (« le même montant devient une créance sur le bénéficiaire : pour
-- l'hôte, débit du `host_ledger[hôte][devise]` »), E5 (un grand livre par hôte et par devise),
-- vecteurs TJ18a à TJ18d ; 17 v6 §2.9, §3.2.8 ; ADR-147 (avance de Kmino, 0123), ADR-153
-- (`host_ledger` minimal, 0129), ADR-163 (cette migration). Appliquée sous `migrator`, en une
-- transaction.
--
-- Cette migration :
--   1. `core.settlement_host_ledger_entry` : motif fermé élargi de `RELEASED_LEG_ADVANCE` (créance
--      de l'hôte née d'une avance de Kmino sur une jambe `HOST` déjà versée) ; colonne `advance_id`
--      (clé étrangère vers `settlement_platform_advance`), exigée pour ce motif et interdite pour
--      les autres (`host_ledger_advance_shape`), UNIQUE (`host_ledger_advance_unique` : une créance
--      par avance) ; toute créance est un débit de l'hôte ; les deux uniques d'idempotence de 0129
--      sont recréées SOUS LEUR NOM avec `advance_id` en plus et `NULLS NOT DISTINCT` : pour la
--      pénalité (advance_id NULL) elles gardent exactement leur sens (une par règlement, une par
--      version) ; un règlement peut porter plusieurs avances (une par instance SM-8, règle 10),
--      donc plusieurs créances, une par avance ;
--   2. commande `core.settlement_cmd_post_advance_receivable(uuid)` (SECURITY DEFINER, propriétaire
--      `cmd_money_owner`, search_path figé, AUCUN EXECUTE) : lit l'avance (`RELEASED_LEG`, `OPEN`,
--      compte d'hôte, aucun assureur), son instance de remboursement et le règlement de celle-ci ;
--      écrit `−receivable_minor` de l'avance STOCKÉE (égal à son montant, CHECK
--      `platform_advance_released_leg` de 0036 ; calculé une fois par `payment_cmd_plan_refund` à la
--      planification, jamais recalculé ici, jamais un prorata), dans la devise du trip, rattachée au
--      règlement et à SA version ; idempotente par avance ;
--   3. déclencheur `platform_advance_receivable_posted` (AFTER UPDATE OF status de
--      `core.settlement_platform_advance`, `PLANNED` → `OPEN`, cause `RELEASED_LEG`) : l'avance ne
--      devient `OPEN` que dans `core.settlement_cmd_apply_leg_movement` (0123, report du
--      remboursement prouvé, travailleur `payment_command`) ; la créance est donc écrite dans la MÊME
--      instruction que le report qui rend l'avance effective ; un échec annule le report. Une avance
--      `PLANNED` (décision FINANCE attendue) ou `CANCELLED` (version remplacée) n'écrit rien ;
--   4. politique `cmd_money_ins_advance` (insertion de `cmd_money_owner`, travailleur
--      `payment_command`, motif `RELEASED_LEG_ADVANCE`, débit, avance citée) ; lecture `fin_read`
--      inchangée, colonne `advance_id` ajoutée aux colonnes lues par app_api (FINANCE / ADMIN).
--
-- Hors de cette migration (ADR-163, passation docs/team/handoffs/US-224.md, partie 224e) : aucun
-- recouvrement (`NETTING`, SM-6b, prélèvement, échéancier, passage en perte : US-709, GL-33) ; aucune
-- compensation sur un versement (aucun versement avant le lot C, `payouts_enabled` = `false`) ;
-- avance d'une jambe `INSURER` (imputation sur le bordereau suivant, US-227) ; lecture par l'hôte
-- (RLS-26, N-272).
--
-- Codes (packages/db/src/errors.ts) :
--   host_ledger_command_forbidden (42501)  → FORBIDDEN (code de 0129, même garde) ;
--   host_ledger_advance_unknown (23000)    → INVARIANT_VIOLATION ;
--   host_ledger_advance_unique (23505)     → INVARIANT_VIOLATION (défense : la commande rend
--                                            l'écriture d'origine).
--
-- Expand / contract : colonne facultative, contraintes, fonctions, déclencheur, droits et politique
-- AJOUTÉS ; CHECK du motif ÉLARGI et deux uniques recréées sous leur nom (toute ligne valide sous
-- la version N le reste : advance_id NULL pour toutes les écritures existantes).
--
-- Retour arrière :
--   DROP TRIGGER platform_advance_receivable_posted ON core.settlement_platform_advance;
--   DROP FUNCTION core.settlement_post_advance_receivable(),
--     core.settlement_cmd_post_advance_receivable(uuid);
--   DROP POLICY cmd_money_ins_advance ON core.settlement_host_ledger_entry;
--   DELETE des écritures RELEASED_LEG_ADVANCE (sous migrator, déclencheurs d'immuabilité désactivés
--     le temps de l'opération), puis recréer les contraintes de 0129 (host_ledger_reason_valid,
--     host_ledger_entry_settlement_reason_unique, host_ledger_entry_version_reason_unique) et
--   ALTER TABLE core.settlement_host_ledger_entry DROP COLUMN advance_id.

-- 1. Table : motif, colonne et contraintes ------------------------------------------------------

ALTER TABLE core.settlement_host_ledger_entry
  ADD COLUMN advance_id uuid
    CONSTRAINT host_ledger_advance_fk REFERENCES core.settlement_platform_advance (id);

ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_reason_valid,
  ADD CONSTRAINT host_ledger_reason_valid CHECK (reason IN
    ('HOST_CANCELLATION_PENALTY', 'RELEASED_LEG_ADVANCE'));

-- la créance d'une avance cite son avance, et elle seule ; c'est toujours une dette de l'hôte
ALTER TABLE core.settlement_host_ledger_entry
  ADD CONSTRAINT host_ledger_advance_shape CHECK (
    ((reason = 'RELEASED_LEG_ADVANCE') = (advance_id IS NOT NULL))
    AND (reason <> 'RELEASED_LEG_ADVANCE' OR amount_minor < 0)),
  ADD CONSTRAINT host_ledger_advance_unique UNIQUE (advance_id);

-- idempotence de 0129 : même nom, même sens pour la pénalité (advance_id NULL, NULLS NOT DISTINCT) ;
-- une créance par avance d'un même règlement
ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_entry_settlement_reason_unique,
  ADD CONSTRAINT host_ledger_entry_settlement_reason_unique
    UNIQUE NULLS NOT DISTINCT (settlement_id, reason, advance_id);
ALTER TABLE core.settlement_host_ledger_entry
  DROP CONSTRAINT host_ledger_entry_version_reason_unique,
  ADD CONSTRAINT host_ledger_entry_version_reason_unique
    UNIQUE NULLS NOT DISTINCT (trip_id, segment_no, settlement_version, reason, advance_id);

COMMENT ON COLUMN core.settlement_host_ledger_entry.advance_id IS
  'Avance de Kmino (platform_advance RELEASED_LEG) dont l''écriture est la créance sur l''hôte '
  '(08 E7 règle 3 bis) ; NULL pour les autres motifs. US-224e (ADR-163).';

-- 2. Droits et politique -------------------------------------------------------------------------

GRANT SELECT (advance_id) ON core.settlement_host_ledger_entry TO app_api;
GRANT INSERT (advance_id) ON core.settlement_host_ledger_entry TO cmd_money_owner;
-- seconde écriture de production : la créance d'une avance rendue effective par le report du
-- remboursement (travailleur payment_command, déclencheur de la section 4)
CREATE POLICY cmd_money_ins_advance ON core.settlement_host_ledger_entry FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND reason = 'RELEASED_LEG_ADVANCE' AND amount_minor < 0 AND advance_id IS NOT NULL);

-- 3. Commande d'écriture (cmd_money_owner) -------------------------------------------------------

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- Créance de l'hôte d'une avance de Kmino effective (08 E7 règle 3 bis, TJ18b / TJ18d) : montant
-- lu de l'avance stockée (`receivable_minor`), jamais reçu ni recalculé ; écrit au débit du compte
-- d'hôte de l'avance, dans la devise du trip, rattaché au règlement et à la version de l'instance
-- de remboursement qui porte l'avance (clé étrangère composite de 0129 : même hôte, pays et
-- devise que le règlement). Idempotente par avance : un rejeu rend l'écriture d'origine.
CREATE FUNCTION core.settlement_cmd_post_advance_receivable(p_advance_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  a    record;
  i    record;
  s    record;
  v_id uuid;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'host_ledger: créance d''avance réservée au travailleur payment_command'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'host_ledger_command_forbidden';
  END IF;
  SELECT x.id, x.cause, x.status, x.org_id, x.insurer_id, x.trip_id, x.country_code, x.currency,
         x.receivable_minor
    INTO a
    FROM core.settlement_platform_advance AS x
   WHERE x.id = p_advance_id;
  -- une seule instance de remboursement porte une avance (créée avec elle, 0123)
  SELECT ri.settlement_id, ri.settlement_version, ri.trip_id
    INTO i
    FROM core.payment_refund_instance AS ri
   WHERE ri.advance_id = p_advance_id;
  SELECT x.id, x.trip_id, x.segment_no, x.version, x.org_id, x.country_code, x.currency
    INTO s
    FROM core.settlement_settlement AS x
   WHERE x.id = i.settlement_id;
  IF a.id IS NULL OR a.cause IS DISTINCT FROM 'RELEASED_LEG' OR a.status IS DISTINCT FROM 'OPEN'
     OR a.org_id IS NULL OR a.insurer_id IS NOT NULL OR a.receivable_minor IS NULL
     OR a.receivable_minor <= 0 OR s.id IS NULL OR s.version IS DISTINCT FROM i.settlement_version
     OR s.trip_id IS DISTINCT FROM a.trip_id OR i.trip_id IS DISTINCT FROM a.trip_id
     OR s.org_id IS DISTINCT FROM a.org_id OR s.country_code IS DISTINCT FROM a.country_code
     OR s.currency IS DISTINCT FROM a.currency THEN
    RAISE EXCEPTION 'host_ledger: avance % inconnue ou hors de son règlement', p_advance_id
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'host_ledger_advance_unknown';
  END IF;
  INSERT INTO core.settlement_host_ledger_entry
         (id, org_id, country_code, currency, trip_id, segment_no, settlement_id,
          settlement_version, reason, amount_minor, advance_id)
  VALUES (pg_catalog.gen_random_uuid(), s.org_id, s.country_code, s.currency, s.trip_id,
          s.segment_no, s.id, s.version, 'RELEASED_LEG_ADVANCE', -a.receivable_minor, a.id)
  ON CONFLICT ON CONSTRAINT host_ledger_advance_unique DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT e.id INTO v_id
      FROM core.settlement_host_ledger_entry AS e WHERE e.advance_id = a.id;
  END IF;
  RETURN v_id;
END
$fn$;
COMMENT ON FUNCTION core.settlement_cmd_post_advance_receivable(uuid) IS
  'host_ledger : débit de la créance de l''hôte d''une avance de Kmino effective (08 E7 règle 3 '
  'bis ; montant de l''avance stockée), rattaché au règlement et à la version de son instance de '
  'remboursement ; idempotent par avance. Appelée par le déclencheur '
  'platform_advance_receivable_posted seulement (aucun EXECUTE). US-224e (ADR-163).';
REVOKE ALL ON FUNCTION core.settlement_cmd_post_advance_receivable(uuid) FROM PUBLIC;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 4. Déclencheur : la créance écrite quand l'avance devient effective ----------------------------
-- Fonction créée par migrator (propriétaire de la table, qui pose le déclencheur), puis transférée
-- à cmd_money_owner, propriétaire de la commande qu'elle appelle (comme 0129, section 5).
CREATE FUNCTION core.settlement_post_advance_receivable()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM core.settlement_cmd_post_advance_receivable(NEW.id);
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_post_advance_receivable() IS
  'Déclencheur platform_advance_receivable_posted : une avance RELEASED_LEG qui devient OPEN (report '
  'du remboursement) écrit la créance de l''hôte au host_ledger, dans la même transaction. '
  'US-224e (ADR-163).';
REVOKE ALL ON FUNCTION core.settlement_post_advance_receivable() FROM PUBLIC;

CREATE TRIGGER platform_advance_receivable_posted
  AFTER UPDATE OF status ON core.settlement_platform_advance
  FOR EACH ROW
  WHEN (OLD.status = 'PLANNED' AND NEW.status = 'OPEN' AND NEW.cause = 'RELEASED_LEG')
  EXECUTE FUNCTION core.settlement_post_advance_receivable();

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.settlement_post_advance_receivable() OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
