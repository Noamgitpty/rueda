-- 0055 — PAY : une preuve WEBHOOK_SIGNED exige un webhook reçu, signé et rattaché (US-049, RC-5).
-- 17 §4.4 points 2 à 7 ; ADR-059 ; ADR-088 (décision 4, arbitrage de l'orchestrateur). Rapport :
-- docs/team/redteam/L0-argent.md (RC-5, ARG-36). Appliquée sous `migrator`.
--
-- Défaut corrigé : `core.payment_cmd_apply_operation_status(op, 'SUCCEEDED', 'WEBHOOK', NULL, …)`
-- posait `proof_type = WEBHOOK_SIGNED` sans aucun webhook. Désormais, un statut TERMINAL
-- (SUCCEEDED, FAILED) de source WEBHOOK n'est APPLIQUÉ que si `p_raw_ref` désigne une ligne de
-- `payment_webhook_inbox` écrite par `payment_cmd_receive_webhook` :
--   - du même compte PSP que l'opération ;
--   - de signature valide (`signature_valid`), jamais REJECTED_SIGNATURE ni FAILED ;
--   - pas en quarantaine pour horodatage (`SIGNED_TIMESTAMP_OUT_OF_TOLERANCE`, 17 §4.4 point 2 :
--     ces événements ne valent que confirmés par getOperation, source POLL) ;
--   - dont un événement normalisé porte ce statut et désigne cette opération (référence PSP de
--     l'opération ou reçue, ou notre clé `idem_sent`).
-- Sinon l'issue est `UNPROVEN` : rien ne change, aucun événement n'est écrit (la table des
-- événements n'admet que les quatre issues de rang). Les issues DUPLICATE, STALE, CONFLICT et
-- NOT_FOUND sont inchangées (elles ne modifient rien). Les sources POLL, API_RESPONSE et MANUAL_OPS
-- sont inchangées.
--
-- Corps de 0028 recopié à l'identique, hors le contrôle de la preuve. Même signature, même
-- propriétaire (cmd_money_owner), mêmes droits, entrée RLS-15 inchangée.
--
-- Retour arrière : réappliquer la définition de 0028 de
--   core.payment_cmd_apply_operation_status(uuid, text, text, uuid, text) (sous cmd_money_owner) ;
--   REVOKE SELECT (signature_valid, processing_status, error, normalized_events)
--     ON core.payment_webhook_inbox FROM cmd_money_owner.

GRANT SELECT (signature_valid, processing_status, error, normalized_events)
  ON core.payment_webhook_inbox TO cmd_money_owner;

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

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
  ELSIF p_source = 'WEBHOOK' AND p_status IN ('SUCCEEDED', 'FAILED')
        AND NOT EXISTS (
          SELECT 1
            FROM core.payment_webhook_inbox AS w
           WHERE w.id = p_raw_ref
             AND w.psp_account_id = v_account
             AND w.signature_valid
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
