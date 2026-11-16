-- 0120 — AVL : état de revue d'un hold de checkout, lu par le voyageur (S05).
-- US-209 (partie 209c, écrans du voyageur) ; 19 US-209 (critère 4 : « aucune intention de paiement
-- avant la décision ») ; 16 BKG-014, VER-007 ; 17 §2.5 (« Revue ops avant le débit ») ; 10b S05,
-- UX-35 ; 22 UXQ-08 ; ADR-135, ADR-141, ADR-142, ADR-144 (cette migration). Suites du BOARD :
-- N-172, N-203 (« bouton Pagar sur un hold en revue : la lecture du hold ne porte pas l'état de
-- revue »). Appliquée sous `migrator`, en une transaction.
--
-- Cette migration :
--   1. `core.booking_checkout_review_state(p_token_hash, p_hold_id)` (cmd_hold_owner, SECURITY
--      DEFINER, EXECUTE app_api seul) : état de revue d'un hold de checkout du voyageur de la
--      session, dérivé des colonnes du hold (aucune donnée de l'évaluation, aucun motif) :
--        REJECTED  hold RELEASED, motif REVIEW_REJECTED (refus de l'ops ou revue non faite dans le
--                  délai : le voyageur n'apprend jamais lequel, 08 BR-VERIF-03) ;
--        PENDING   hold `review_required` sans `reviewed_at` (revue avant le débit, UXQ-08) ;
--        APPROVED  hold `review_required` revu (`reviewed_at` posé : prolongation unique) ;
--        NONE      aucune revue avant le débit (hold ordinaire ou branche PAY_THEN_REVIEW).
--      Hold d'un autre voyageur ou inconnu : aucune ligne (même réponse que
--      `core.booking_checkout_summary`).
--
-- Expand / contract : une fonction ajoutée ; aucune table, aucune colonne, aucun droit retiré.
-- `core.booking_checkout_summary` (0108) est inchangée (type de retour non modifié).
--
-- Retour arrière :
--   DROP FUNCTION core.booking_checkout_review_state(bytea, uuid) ;
--   retirer l'entrée de security-definer-allowlist.json.

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 1. État de revue d'un hold de checkout du voyageur de la session -------------------------------
-- Droits déjà accordés à cmd_hold_owner : colonnes review_required, reviewed_at, status (0037),
-- release_reason (0119) de booking_checkout_hold ; booking_checkout_acceptance et
-- iam_session_resolve (0108).
CREATE FUNCTION core.booking_checkout_review_state(p_token_hash bytea, p_hold_id uuid)
  RETURNS TABLE (hold_id uuid, review_state text)
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT h.id,
         CASE
           WHEN h.status = 'RELEASED' AND h.release_reason = 'REVIEW_REJECTED' THEN 'REJECTED'
           WHEN h.review_required AND h.reviewed_at IS NULL THEN 'PENDING'
           WHEN h.review_required THEN 'APPROVED'
           ELSE 'NONE'
         END
    FROM core.booking_checkout_acceptance AS a
    JOIN core.booking_checkout_hold AS h ON h.id = a.hold_id
   WHERE a.hold_id = p_hold_id
     AND a.guest_user_id = (SELECT s.user_id FROM core.iam_session_resolve(p_token_hash) AS s)
$fn$;
COMMENT ON FUNCTION core.booking_checkout_review_state(bytea, uuid) IS
  'État de revue d''un hold de checkout du voyageur de la session (NONE, PENDING, APPROVED, '
  'REJECTED), dérivé du hold ; aucune ligne sinon. Aucun motif ni donnée de l''évaluation. '
  'SECURITY DEFINER, EXECUTE app_api. US-209 (ADR-144).';
REVOKE ALL ON FUNCTION core.booking_checkout_review_state(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_checkout_review_state(bytea, uuid) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
