-- 0127 — PAY / STL : ordonnancement des remboursements planifiés et états SM-8 après l'envoi.
-- US-224 (partie 224c, argent / back-end) ; 19 US-224 (critères 1 et 4) ; 16 PAY-021 ; 08 SM-8,
-- E4, BR-PAY-08 ; 17 v6 §2.8 (port PaymentProvider, lecture d'abord), §3.2.7 (`refund_instance`),
-- §4.3 points 1 à 4 (verrou du trip, ordre PENDING, envoi, statut) ; ADR-145, ADR-147 ; ADR-150
-- (cette migration). Suites du BOARD : N-225 (ordonnanceur, états après SUBMITTED, verrou de l'ordre
-- pendant l'appel au PSP, relecture du statut et de la version en tête), N-227 (en partie).
-- Appliquée sous `migrator`, en une transaction.
--
-- Cette migration :
--   1. machine à états SM-8 après l'envoi autorisé : `SUBMITTED` → `SENT` (le PSP a accepté
--      l'ordre) ou `FAILED` ; `SENT` → `CONFIRMED` (succès) ou `FAILED` ; `FAILED` → `SUPERSEDED`
--      (version n+1, 08 SM-8 « Supersession »). Les états suivent l'ordre : déclencheur
--      `refund_instance_sync` (SECURITY DEFINER sous cmd_money_owner) sur le statut de l'ordre
--      `REFUND`, quel que soit le travailleur qui l'écrit (`payment_command` : réponse ou lecture du
--      PSP ; `webhook_ingest` : preuve signée) ; un ordre `UNKNOWN` (délai dépassé) laisse
--      l'instance où elle est (08 SM-8 : « un remboursement SUBMITTED sans réponse reste
--      SUBMITTED »). La date d'émission (`issued_at`, posée à `SUBMITTED`) ne change plus ;
--   2. supersession étendue aux instances `FAILED` (sans mouvement de fonds) et à leur avance
--      attendue (`CANCELLED`) ; le CHECK de la date d'émission admet une instance `SUPERSEDED` déjà
--      émise (passée par `FAILED`) ;
--   3. `core.payment_refunds_due` : file de l'ordonnanceur (travailleur `payment_command`) —
--      instances `PLANNED` à envoyer (les non bloquées d'abord), `SUBMITTED` / `SENT` dont l'ordre
--      attend le PSP, `CONFIRMED` prouvées non encore reportées, `FAILED` non encore signalées ;
--   4. `core.payment_cmd_refund_order_for_send` : sous le verrou du trip PUIS de l'ordre (gardés
--      jusqu'à la fin de la transaction, donc PENDANT l'appel au PSP), relit l'instance, l'ordre et la
--      version en tête ; refuse l'envoi d'un ordre jamais envoyé dont la version est remplacée
--      (`SUPERSEDED_UNSENT`, revue FIN) ; rend les seules données de l'ordre STOCKÉES (clé, montant,
--      jambes, référence de l'encaissement remboursé) : aucun montant n'est calculé ici ;
--   5. `core.payment_cmd_refund_mark_alerted` : dernière alerte FIN levée pour une instance
--      (colonne `fin_alert`), pour qu'un état ne soit signalé qu'une fois.
--
-- Hors de cette migration (passation docs/team/handoffs/US-224.md, partie 224c, et BOARD) : écran
-- S10 et lecture du remboursement (critère 1, UXQ-11), hôte défaillant (critère 5), file ops des
-- MISMATCH (N-196), file FIN de REFUND_OUT_OF_RANGE (N-13 a), nouvelle tentative après FAILED et
-- choix du rail (PENDING_CUSTOMER_CHOICE), remboursement multi-moyens (TJ16), instance exigée pour
-- tout REFUND de règlement, GL-21 en base (N-226).
--
-- Expand / contract : une colonne NULLABLE, trois fonctions, une fonction de déclencheur, un
-- déclencheur et une politique AJOUTÉS ; un CHECK recréé sous son nom (élargi : SUPERSEDED émise) ;
-- corps de deux fonctions de déclencheur remplacés à signature, propriétaire et droits identiques
-- (garde : transitions ajoutées ; supersession : FAILED en plus de PLANNED).
--
-- Retour arrière :
--   réappliquer les définitions de 0123 (payment_refund_instance_guard,
--   payment_refund_instance_supersede, CHECK refund_instance_issued_shape) ;
--   DROP TRIGGER refund_instance_sync ON core.payment_payment_operation;
--   DROP POLICY cmd_money_sync ON core.payment_refund_instance;
--   DROP FUNCTION core.payment_refund_instance_sync(), core.payment_refunds_due(integer),
--     core.payment_cmd_refund_order_for_send(uuid), core.payment_cmd_refund_mark_alerted(uuid, text);
--   REVOKE UPDATE (fin_alert) ON core.payment_refund_instance FROM cmd_money_owner;
--   ALTER TABLE core.payment_refund_instance DROP COLUMN fin_alert.

-- 1. Colonne de la dernière alerte FIN et CHECK de la date d'émission ----------------------------
ALTER TABLE core.payment_refund_instance
  ADD COLUMN fin_alert text
    CONSTRAINT refund_instance_fin_alert_format CHECK (fin_alert ~ '^[A-Z][A-Z0-9_:]{0,79}$'),
  DROP CONSTRAINT refund_instance_issued_shape,
  -- date d'émission (BR-PAY-08) : jamais avant l'envoi autorisé ; toujours après ; une instance
  -- remplacée après un échec (FAILED → SUPERSEDED) garde la date de son émission
  ADD CONSTRAINT refund_instance_issued_shape CHECK (
    (status <> 'PLANNED' OR issued_at IS NULL)
    AND (status NOT IN ('SUBMITTED', 'SENT', 'CONFIRMED', 'FAILED') OR issued_at IS NOT NULL));
COMMENT ON COLUMN core.payment_refund_instance.fin_alert IS
  'Dernière alerte FIN levée pour cette instance (code technique, jamais une donnée personnelle) : '
  'un état n''est signalé qu''une fois. US-224 (224c), ADR-150.';
GRANT UPDATE (fin_alert) ON core.payment_refund_instance TO cmd_money_owner;

-- 2. Garde : transitions de SM-8 après l'envoi autorisé (corps de 0123, bloc marqué US-224c) ------
CREATE OR REPLACE FUNCTION core.payment_refund_instance_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PLANNED' OR NEW.issued_at IS NOT NULL OR NEW.fin_alert IS NOT NULL THEN
      RAISE EXCEPTION 'refund_instance: created PLANNED only'
        USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'refund_instance_transition';
    END IF;
    IF NEW.rail = 'CREDIT_CASH' AND NOT core.config_go_live('funds_holding_enabled', NEW.country_code) THEN
      RAISE EXCEPTION 'refund_instance: cash credit closed while funds holding is disabled'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_credit_cash_closed';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.origin_type IS DISTINCT FROM OLD.origin_type
     OR NEW.origin_id IS DISTINCT FROM OLD.origin_id OR NEW.settlement_id IS DISTINCT FROM OLD.settlement_id
     OR NEW.settlement_version IS DISTINCT FROM OLD.settlement_version
     OR NEW.trip_id IS DISTINCT FROM OLD.trip_id OR NEW.country_code IS DISTINCT FROM OLD.country_code
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.refunded_operation_id IS DISTINCT FROM OLD.refunded_operation_id
     OR NEW.instance_seq IS DISTINCT FROM OLD.instance_seq OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
     OR NEW.executor IS DISTINCT FROM OLD.executor OR NEW.rail IS DISTINCT FROM OLD.rail
     OR NEW.requested_legs IS DISTINCT FROM OLD.requested_legs
     OR NEW.amount_trip_minor IS DISTINCT FROM OLD.amount_trip_minor
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id OR NEW.advance_id IS DISTINCT FROM OLD.advance_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR (OLD.issued_at IS NOT NULL AND NEW.issued_at IS DISTINCT FROM OLD.issued_at) THEN
    RAISE EXCEPTION 'refund_instance: identity is immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'refund_instance_immutable';
  END IF;
  IF NOT ((OLD.status = 'PLANNED' AND NEW.status IN ('PLANNED', 'SUBMITTED', 'SUPERSEDED'))
          -- US-224c (08 SM-8) : l'ordre envoyé suit le PSP ; un échec n'est remplacé que par une
          -- version n+1 ; aucun retour en arrière, aucun saut (CONFIRMED passe toujours par SENT)
          OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('SENT', 'FAILED'))
          OR (OLD.status = 'SENT' AND NEW.status IN ('CONFIRMED', 'FAILED'))
          OR (OLD.status = 'FAILED' AND NEW.status = 'SUPERSEDED')
          OR (OLD.status = NEW.status AND NEW.blocked_reason IS NOT DISTINCT FROM OLD.blocked_reason
              AND NEW.issued_at IS NOT DISTINCT FROM OLD.issued_at)) THEN
    RAISE EXCEPTION 'refund_instance: transition % -> % refused', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'refund_instance_transition';
  END IF;
  RETURN NEW;
END
$fn$;

-- 3. Supersession (corps de 0123, bloc marqué US-224c) : FAILED aussi (sans mouvement de fonds) ---
CREATE OR REPLACE FUNCTION core.payment_refund_instance_supersede()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  -- US-224c (08 SM-8) : PLANNED et FAILED (rejet confirmé) n'ont déplacé aucun fonds
  UPDATE core.settlement_platform_advance AS a
     SET status = 'CANCELLED'
   WHERE a.status = 'PLANNED'
     AND a.id IN (SELECT ri.advance_id FROM core.payment_refund_instance AS ri
                   WHERE ri.trip_id = NEW.trip_id AND ri.status IN ('PLANNED', 'FAILED')
                     AND ri.advance_id IS NOT NULL);
  UPDATE core.payment_refund_instance AS ri
     SET status = 'SUPERSEDED', blocked_reason = NULL
   WHERE ri.trip_id = NEW.trip_id AND ri.status IN ('PLANNED', 'FAILED');
  RETURN NULL;
END
$fn$;

-- 4. États de l'instance qui suivent l'ordre (SECURITY DEFINER sous cmd_money_owner) -------------
-- Écrivains du statut d'un ordre REFUND : core.payment_cmd_apply_operation_status seulement
-- (travailleurs payment_command et webhook_ingest) ; le déclencheur est créé AVANT le transfert de
-- propriété (CREATE TRIGGER exige EXECUTE du créateur, comme 0123 et 0124).
CREATE FUNCTION core.payment_refund_instance_sync()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.status = 'SUBMITTED' THEN
    -- le PSP a reçu l'ordre (réponse « en cours ») : SENT
    UPDATE core.payment_refund_instance AS ri SET status = 'SENT'
     WHERE ri.operation_id = NEW.id AND ri.status = 'SUBMITTED';
  ELSIF NEW.status = 'SUCCEEDED' THEN
    -- succès : SENT puis CONFIRMED (jamais de saut, garde ci-dessus)
    UPDATE core.payment_refund_instance AS ri SET status = 'SENT'
     WHERE ri.operation_id = NEW.id AND ri.status = 'SUBMITTED';
    UPDATE core.payment_refund_instance AS ri SET status = 'CONFIRMED'
     WHERE ri.operation_id = NEW.id AND ri.status = 'SENT';
  ELSIF NEW.status = 'FAILED' THEN
    UPDATE core.payment_refund_instance AS ri SET status = 'FAILED'
     WHERE ri.operation_id = NEW.id AND ri.status IN ('SUBMITTED', 'SENT');
  END IF;
  -- UNKNOWN (délai dépassé) : l'instance reste où elle est (08 SM-8)
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.payment_refund_instance_sync() IS
  'SM-8 : l''instance de remboursement suit le statut de son ordre REFUND (SUBMITTED → SENT, '
  'SUCCEEDED → CONFIRMED, FAILED → FAILED ; UNKNOWN inchangé). US-224 (224c), ADR-150.';
REVOKE ALL ON FUNCTION core.payment_refund_instance_sync() FROM PUBLIC;
CREATE TRIGGER refund_instance_sync AFTER UPDATE OF status ON core.payment_payment_operation
  FOR EACH ROW WHEN (NEW.kind = 'REFUND')
  EXECUTE FUNCTION core.payment_refund_instance_sync();
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
ALTER FUNCTION core.payment_refund_instance_sync() OWNER TO cmd_money_owner;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- statut écrit par la preuve signée (travailleur webhook_ingest) : seulement les états qui suivent
-- l'ordre, depuis un état envoyé
CREATE POLICY cmd_money_sync ON core.payment_refund_instance FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'webhook_ingest'
         AND status IN ('SUBMITTED', 'SENT'))
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'webhook_ingest'
              AND status IN ('SENT', 'CONFIRMED', 'FAILED'));

-- 5. Commandes de l'ordonnanceur (cmd_money_owner, EXECUTE app_worker, travailleur payment_command)
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 5.1 File : ce qui attend une action de l'ordonnanceur ; les instances bloquées en dernier (une
-- avance sans décision FINANCE ne prive jamais les autres de leur passage)
CREATE FUNCTION core.payment_refunds_due(p_limit integer)
  RETURNS TABLE (instance_id uuid, country_code text, status text, operation_status text,
                 provider text, blocked_reason text, fin_alert text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: refunds_due reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'payment: limit must be between 1 and 500' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT ri.id, ri.country_code, ri.status, o.status, o.provider, ri.blocked_reason, ri.fin_alert
    FROM core.payment_refund_instance AS ri
    JOIN core.payment_payment_operation AS o ON o.id = ri.operation_id
   WHERE ri.status = 'PLANNED'
      OR (ri.status IN ('SUBMITTED', 'SENT') AND o.status IN ('PENDING', 'UNKNOWN', 'SUBMITTED'))
      OR (ri.status = 'CONFIRMED' AND o.proof_type IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM core.settlement_leg_movement AS m
                           WHERE m.operation_id = ri.operation_id))
      OR (ri.status = 'FAILED' AND ri.fin_alert IS DISTINCT FROM 'FAILED')
   ORDER BY (ri.blocked_reason IS NOT NULL), ri.created_at, ri.id
   LIMIT p_limit;
END
$fn$;
COMMENT ON FUNCTION core.payment_refunds_due(integer) IS
  'File de l''ordonnanceur des remboursements (SM-8) : à envoyer, en attente du PSP, à reporter, '
  'échecs à signaler. Travailleur payment_command. US-224 (224c), ADR-150.';
REVOKE ALL ON FUNCTION core.payment_refunds_due(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_refunds_due(integer) TO app_worker;

-- 5.2 Ordre à envoyer : verrous du trip puis de l'ordre, gardés PENDANT l'appel au PSP (17 §4.3
-- points 1 à 3) ; tout est relu sous ces verrous. Aucun montant calculé : l'ordre stocké.
CREATE FUNCTION core.payment_cmd_refund_order_for_send(p_instance_id uuid)
  RETURNS TABLE (operation_id uuid, operation_status text, idem_sent text, amount_minor bigint,
                 currency text, legs jsonb, target_reference text, provider_reference text,
                 provider text, sendable boolean, reason text)
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_trip   uuid;
  v_i      record;
  v_o      record;
  v_target text;
  v_legs   jsonb;
  v_reason text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: refund_order_for_send reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_instance_id IS NULL THEN
    RAISE EXCEPTION 'payment: refund instance required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT ri.trip_id INTO v_trip FROM core.payment_refund_instance AS ri WHERE ri.id = p_instance_id;
  IF v_trip IS NULL THEN
    RAISE EXCEPTION 'payment: unknown refund instance'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'refund_instance_unknown';
  END IF;
  -- même ordre de verrous que la planification, l'envoi autorisé, la garde et le report
  PERFORM 1 FROM core.booking_trip AS t WHERE t.id = v_trip FOR UPDATE;
  SELECT ri.status, ri.operation_id, ri.settlement_id, ri.refunded_operation_id INTO v_i
    FROM core.payment_refund_instance AS ri WHERE ri.id = p_instance_id;
  SELECT o.id, o.status, o.idem_sent, o.amount_minor, o.currency, o.provider_reference, o.provider
    INTO v_o
    FROM core.payment_payment_operation AS o WHERE o.id = v_i.operation_id
     FOR UPDATE;
  SELECT o.provider_reference INTO v_target
    FROM core.payment_payment_operation AS o WHERE o.id = v_i.refunded_operation_id;
  SELECT pg_catalog.jsonb_object_agg(l.leg, l.amount_minor::text) INTO v_legs
    FROM core.payment_payment_operation_leg AS l WHERE l.operation_id = v_o.id;

  IF v_i.status = 'PLANNED' THEN
    v_reason := 'NOT_SUBMITTED';                 -- envoi jamais autorisé
  ELSIF v_i.status NOT IN ('SUBMITTED', 'SENT')
        OR v_o.status NOT IN ('PENDING', 'UNKNOWN', 'SUBMITTED') THEN
    v_reason := 'FINAL';                         -- confirmé, échoué ou remplacé
  ELSIF v_o.status = 'PENDING'
        AND EXISTS (SELECT 1 FROM core.settlement_settlement AS s
                     WHERE s.supersedes_id = v_i.settlement_id) THEN
    -- autorisé puis remplacé avant tout envoi connu : jamais envoyé sans la revue FIN (une version
    -- n+1 recalcule ce qui reste à rembourser, 08 SM-8)
    v_reason := 'SUPERSEDED_UNSENT';
  ELSIF v_target IS NULL THEN
    v_reason := 'NO_TARGET';
  END IF;
  RETURN QUERY SELECT v_o.id, v_o.status, v_o.idem_sent, v_o.amount_minor, v_o.currency, v_legs,
                      v_target, v_o.provider_reference, v_o.provider, v_reason IS NULL, v_reason;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_refund_order_for_send(uuid) IS
  'Ordre d''une instance de remboursement envoyée, relu et verrouillé (trip puis ordre) jusqu''à la '
  'fin de la transaction, appel au PSP compris. Travailleur payment_command. US-224 (224c), ADR-150.';
REVOKE ALL ON FUNCTION core.payment_cmd_refund_order_for_send(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_cmd_refund_order_for_send(uuid) TO app_worker;

-- 5.3 Dernière alerte FIN levée (un état n'est signalé qu'une fois)
CREATE FUNCTION core.payment_cmd_refund_mark_alerted(p_instance_id uuid, p_key text)
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'payment: refund_mark_alerted reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_instance_id IS NULL OR p_key IS NULL OR p_key !~ '^[A-Z][A-Z0-9_:]{0,79}$' THEN
    RAISE EXCEPTION 'payment: invalid alert key' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE core.payment_refund_instance AS ri SET fin_alert = p_key
   WHERE ri.id = p_instance_id AND ri.fin_alert IS DISTINCT FROM p_key;
  RETURN FOUND;
END
$fn$;
COMMENT ON FUNCTION core.payment_cmd_refund_mark_alerted(uuid, text) IS
  'Pose la dernière alerte FIN levée pour une instance de remboursement (code technique seul). '
  'Travailleur payment_command. US-224 (224c), ADR-150.';
REVOKE ALL ON FUNCTION core.payment_cmd_refund_mark_alerted(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payment_cmd_refund_mark_alerted(uuid, text) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
