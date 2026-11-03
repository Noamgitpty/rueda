-- 0020 — AUD : procédure de destruction d'une clé de sujet (crypto-shredding), tracée.
-- US-009 ; 17 §3.1.3 points 2, 5 et 10 ; §3.2.13 (`subject_key` : « destruction refusée si
-- legal_hold_until futur ») ; NN8 ; ADR-026 ; ADR-051. Appliquée sous `migrator`.
--
-- Bêta (NN8, 17 §3.1.3 point 10) : la destruction est une PROCÉDURE MANUELLE tracée (manual_action
-- HANDLE_DSR, LEG-009) ; l'outil arrive au lot 5 (US-536). Cette fonction est la seule façon prévue
-- de détruire une clé : elle n'est accordée à AUCUN rôle applicatif (SECURITY INVOKER, EXECUTE
-- retiré à PUBLIC) ; elle s'exécute sous le rôle de l'opérateur habilité (docs/adr/ADR-051).
--
-- Effet, dans une seule transaction :
--   1. verrouille la clé (FOR UPDATE) ; refuse une clé inconnue ou déjà détruite ;
--   2. refuse tant qu'un fichier chiffré par cette clé est sous gel légal (legal_hold_until futur,
--      17 §3.1.3 point 5) ; le gel d'une demande `data_subject_request` s'ajoutera avec US-536 ;
--   3. wrapped_dek := NULL, destroyed_at := platform.now(), destroy_request_id ;
--   4. écrit une ligne audit_log SUBJECT_KEY_DESTROYED (références seulement), chaînée.
-- Aucune ligne de registre n'est modifiée ; la chaîne d'audit reste valide.
--
-- Retour arrière : DROP FUNCTION core.audit_destroy_subject_key(text, uuid, uuid, text);

CREATE FUNCTION core.audit_destroy_subject_key(
  p_subject_type text,
  p_subject_id   uuid,
  p_request_id   uuid,
  p_reason       text
)
  RETURNS bigint
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  k        record;
  audit_id bigint;
BEGIN
  IF p_request_id IS NULL OR p_reason IS NULL THEN
    RAISE EXCEPTION 'subject_key destruction: request and reason are required'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'subject_key_destroy_has_request';
  END IF;

  SELECT s.destroyed_at INTO k
    FROM core.audit_subject_key s
   WHERE s.subject_type = p_subject_type AND s.subject_id = p_subject_id
     FOR UPDATE;
  IF NOT FOUND OR k.destroyed_at IS NOT NULL THEN
    RAISE EXCEPTION 'subject_key destruction: no live key for this subject'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'subject_key_not_live';
  END IF;

  IF EXISTS (SELECT 1
               FROM core.audit_file_asset f
              WHERE f.enc_subject_type = p_subject_type
                AND f.enc_subject_id = p_subject_id
                AND f.legal_hold_until > platform.now()) THEN
    RAISE EXCEPTION 'subject_key destruction: legal hold in force'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'subject_key_legal_hold';
  END IF;

  UPDATE core.audit_subject_key
     SET wrapped_dek = NULL,
         destroyed_at = platform.now(),
         destroy_request_id = p_request_id
   WHERE subject_type = p_subject_type AND subject_id = p_subject_id;

  INSERT INTO core.audit_audit_log
         (actor_user_id, actor_role, action_code, subject_type, subject_id, after, reason, request_id)
  VALUES (NULL, 'DATA_CONTROLLER', 'SUBJECT_KEY_DESTROYED', 'SUBJECT_KEY', p_subject_id,
          pg_catalog.jsonb_build_object('subject_type', p_subject_type, 'destroyed', true),
          p_reason, p_request_id);

  SELECT h.last_id INTO audit_id FROM core.audit_chain_head h WHERE h.chain = 'audit_log';
  RETURN audit_id;
END
$fn$;

COMMENT ON FUNCTION core.audit_destroy_subject_key(text, uuid, uuid, text) IS
  'Crypto-shredding (17 §3.1.3) : détruit la clé d''un sujet, refuse sous gel légal, journalise. '
  'Procédure manuelle en Bêta (NN8) ; aucun rôle applicatif. US-009.';
REVOKE ALL ON FUNCTION core.audit_destroy_subject_key(text, uuid, uuid, text) FROM PUBLIC;
