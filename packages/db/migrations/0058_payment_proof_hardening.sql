-- 0058 — PAY : preuve d'un statut terminal durcie (quarantaine non effaçable, MANUAL_OPS, voie directe).
-- US-049 (revues code, argent et sécurité de la PR n° 92 au SHA 8296c10 : quarantaine blanchie,
-- RC-5 hors source WEBHOOK) ; 17 §4.4 points 2 à 7 ; ADR-059 ; ADR-088 (décisions 4 et 9).
-- Appliquée sous `migrator`.
--
-- 1. Quarantaine d'horodatage NON EFFAÇABLE. Le motif `SIGNED_TIMESTAMP_OUT_OF_TOLERANCE` ne vivait
--    que dans `payment_webhook_inbox.error`, que le travailleur réécrit (`OPERATION_NOT_FOUND` à la
--    relance) : au passage suivant, le webhook passait pour reçu dans la fenêtre (TS) et la garde de
--    0055 l'acceptait. Deux colonnes posées par la seule commande de réception, jamais réécrites
--    (trigger `webhook_inbox_proof_columns_immutable`, pour tous les rôles, propriétaire compris) :
--      - `signed_at_out_of_tolerance` : horodatage signé hors de ± 5 min à la réception ;
--      - `received_by_command` : ligne écrite par `core.payment_cmd_receive_webhook`. Une ligne
--        insérée directement par `webhook_ingest` (droit INSERT de 0007) vaut `false` (politique
--        `worker_insert_ingest` recréée : elle ne peut pas se déclarer reçue par la commande).
-- 2. `core.payment_cmd_apply_operation_status` : une preuve WEBHOOK exige en plus ces deux colonnes
--    (reçue par la commande, jamais hors tolérance) ; un statut terminal de source MANUAL_OPS est
--    `UNPROVEN` (aucune action du staff journalisée ne le prouve au lot 0 ; ADR-088). POLL et
--    API_RESPONSE inchangés : RC-5 reste PARTIELLEMENT corrigée pour ces deux sources (aucune
--    réponse PSP vérifiable au lot 0, le PSP est FAKE ; une réponse enregistrée par le même
--    travailleur ne prouverait rien), caractérisé par un test, story porteuse US-223 (ADR-088).
-- 3. Voie directe fermée : la politique `worker_update_status` de `payment_payment_operation`
--    (0007 : UPDATE de status, provider_reference, proof_type par quatre travailleurs, inutilisée
--    par le code et les fonctions de production) est recréée sous le même nom : elle n'admet plus ni
--    une ligne terminale (USING) ni un statut terminal ou une preuve (WITH CHECK). Un statut
--    terminal ne s'écrit plus que par `payment_cmd_apply_operation_status`.
--
-- Corps de 0048 (réception) et de 0055 (application) recopiés à l'identique hors les points
-- marqués US-049 (0058). Mêmes signatures, même propriétaire (cmd_money_owner), mêmes droits,
-- entrées RLS-15 inchangées.
--
-- Expand / contract : aucune contraction de schéma ni de droit (deux colonnes NOT NULL avec défaut,
-- un trigger, des politiques recréées sous le même nom) ; RESSERREMENT de comportement
-- fail-closed : la version N servie n'écrit ni MANUAL_OPS ni par la voie directe (vérifié dans le
-- code) ; un webhook hors tolérance déjà blanchi n'est plus accepté comme preuve.
--
-- Retour arrière : réappliquer 0048 (payment_cmd_receive_webhook) et 0055
--   (payment_cmd_apply_operation_status) sous cmd_money_owner ; recréer worker_insert_ingest de
--   0007 et worker_update_status de 0007 ; DROP TRIGGER webhook_inbox_proof_columns_immutable ON
--   core.payment_webhook_inbox ; DROP FUNCTION core.payment_webhook_inbox_proof_columns_guard() ;
--   ALTER TABLE core.payment_webhook_inbox DROP COLUMN received_by_command,
--     DROP COLUMN signed_at_out_of_tolerance (tables vides en production à ce stade).

-- 1. Colonnes de preuve de la boîte de réception, non effaçables -------------------------------
ALTER TABLE core.payment_webhook_inbox
  ADD COLUMN received_by_command boolean NOT NULL DEFAULT false,
  ADD COLUMN signed_at_out_of_tolerance boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN core.payment_webhook_inbox.received_by_command IS
  'Ligne écrite par core.payment_cmd_receive_webhook (seule preuve WEBHOOK admise). Jamais réécrite. US-049.';
COMMENT ON COLUMN core.payment_webhook_inbox.signed_at_out_of_tolerance IS
  'Horodatage signé hors de ± 5 min à la réception (17 §4.4 point 2). Jamais réécrit. US-049.';

CREATE FUNCTION core.payment_webhook_inbox_proof_columns_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF NEW.received_by_command IS DISTINCT FROM OLD.received_by_command
     OR NEW.signed_at_out_of_tolerance IS DISTINCT FROM OLD.signed_at_out_of_tolerance THEN
    RAISE EXCEPTION 'payment: webhook proof columns are immutable'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'webhook_inbox_proof_immutable';
  END IF;
  RETURN NEW;
END
$fn$;
COMMENT ON FUNCTION core.payment_webhook_inbox_proof_columns_guard() IS
  'Trigger : received_by_command et signed_at_out_of_tolerance ne changent jamais (tous rôles). US-049.';
REVOKE ALL ON FUNCTION core.payment_webhook_inbox_proof_columns_guard() FROM PUBLIC;
CREATE TRIGGER webhook_inbox_proof_columns_immutable
  BEFORE UPDATE ON core.payment_webhook_inbox
  FOR EACH ROW EXECUTE FUNCTION core.payment_webhook_inbox_proof_columns_guard();

-- une ligne insérée directement par webhook_ingest ne se déclare jamais reçue par la commande
DROP POLICY worker_insert_ingest ON core.payment_webhook_inbox;
CREATE POLICY worker_insert_ingest ON core.payment_webhook_inbox FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'webhook_ingest'
              AND NOT received_by_command);

-- la commande de réception écrit les deux colonnes ; l'application les relit
GRANT INSERT (received_by_command, signed_at_out_of_tolerance)
  ON core.payment_webhook_inbox TO cmd_money_owner;
GRANT SELECT (received_by_command, signed_at_out_of_tolerance)
  ON core.payment_webhook_inbox TO cmd_money_owner;

-- 3. Voie directe : jamais un statut terminal ni une preuve hors de la commande -----------------
DROP POLICY worker_update_status ON core.payment_payment_operation;
CREATE POLICY worker_update_status ON core.payment_payment_operation FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
           ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'webhook_ingest')
         AND status NOT IN ('SUCCEEDED', 'FAILED'))
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN
                ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper',
                 'webhook_ingest')
              AND status NOT IN ('SUCCEEDED', 'FAILED') AND proof_type IS NULL);

-- 2. Commandes (sous leur propriétaire, CREATE accordé le temps du remplacement) ---------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

CREATE OR REPLACE FUNCTION core.payment_cmd_receive_webhook(
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
  IF NOT FOUND OR (v_provider = 'FAKE' AND COALESCE(platform.deployment_env(), 'production') = 'production') THEN
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
  -- US-049 (0058) : la réception par cette commande et le hors-tolérance de l'horodatage signé
  -- sont posés ici, une fois, dans des colonnes que personne ne réécrit (trigger
  -- webhook_inbox_proof_columns_immutable)
  INSERT INTO core.payment_webhook_inbox AS w
         (id, provider, psp_account_id, provider_event_id, dedup_key, signature_valid, headers,
          processing_status, error, normalized_events, received_by_command,
          signed_at_out_of_tolerance)
  VALUES (v_id, v_provider, p_account_id, p_provider_event_id, p_dedup_key,
          p_signature_valid IS TRUE, p_headers, v_status,
          CASE v_status WHEN 'QUARANTINED' THEN 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE' END,
          CASE WHEN v_status = 'REJECTED_SIGNATURE' THEN NULL ELSE p_normalized END,
          true, v_status = 'QUARANTINED')
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

CREATE OR REPLACE FUNCTION core.payment_cmd_apply_operation_status(
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
  v_account   uuid;
  v_idem_sent text;
  v_rank_cur  integer;
  v_rank_new  integer;
  v_outcome   text;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER' OR app.worker_name() IS NULL
     OR app.worker_name() NOT IN ('payment_command', 'webhook_ingest') THEN
    RAISE EXCEPTION 'payment: apply_operation_status reserved to payment workers'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('SUBMITTED', 'SUCCEEDED', 'FAILED', 'UNKNOWN') THEN
    RAISE EXCEPTION 'payment: invalid status' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT o.status, o.provider_reference, o.psp_account_id, o.idem_sent
    INTO v_current, v_reference, v_account, v_idem_sent
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
  ELSIF p_source = 'MANUAL_OPS' AND p_status IN ('SUCCEEDED', 'FAILED') THEN
    -- US-049 (RC-5, 0058) : aucune action du staff journalisée ne prouve encore un statut terminal
    -- (aucune commande de console au lot 0) ⇒ fail-closed, rien n'est appliqué
    RETURN 'UNPROVEN';
  ELSIF p_source = 'WEBHOOK' AND p_status IN ('SUCCEEDED', 'FAILED')
        AND NOT EXISTS (
          SELECT 1
            FROM core.payment_webhook_inbox AS w
           WHERE w.id = p_raw_ref
             AND w.psp_account_id = v_account
             AND w.signature_valid
             -- US-049 (0058) : reçu par payment_cmd_receive_webhook (jamais une ligne écrite à la
             -- main par un travailleur) et jamais hors tolérance d'horodatage, motif non effaçable
             AND w.received_by_command
             AND NOT w.signed_at_out_of_tolerance
             AND w.processing_status IN ('RECEIVED', 'QUARANTINED', 'PROCESSED')
             AND NOT (w.processing_status = 'QUARANTINED'
                      AND w.error IS NOT DISTINCT FROM 'SIGNED_TIMESTAMP_OUT_OF_TOLERANCE')
             AND EXISTS (
               SELECT 1
                 FROM pg_catalog.jsonb_array_elements(COALESCE(w.normalized_events, '[]'::jsonb)) AS x(e)
                WHERE x.e ->> 'status' = p_status
                  AND (x.e ->> 'providerReference' = COALESCE(v_reference, p_provider_reference)
                       OR x.e ->> 'merchantReference' = v_idem_sent))) THEN
    -- US-049 (RC-5) : aucune preuve signée rattachée à l'opération ⇒ rien n'est appliqué
    RETURN 'UNPROVEN';
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

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
