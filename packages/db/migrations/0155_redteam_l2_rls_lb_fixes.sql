-- 0155 — Correctifs de la red team RLS / ex-porte LB du lot 2 (US-222, partie 222d2 ; ADR-177).
-- Constats de docs/team/redteam/L2-rls-lb.md (US-222c, PR n° 256) : F-L2-LB-01 et F-L2-LB-02
-- (élevés), F-L2-LB-04 (N-114, faible) et F-L2-LB-05 (N-118, moyen) ; F-L2-LB-03 est corrigé côté
-- API (DepositRailExecutor, lecture d'abord). 17 §2.3 (RLS-24, RLS-27 : deux personnes
-- distinctes), ADR-122 / ADR-124 (garde unique de séparation des tâches : la personne, les personnes
-- de ses comptes d'hôte, un compte lié LINKED), DEC-FONDATEUR-15 ; 16 ACC-014, 08 BR-ACC-06 ;
-- DEC-FONDATEUR-22 (« jamais plus lourd que Turo »). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-177, PROPOSÉS) :
--   - F-L2-LB-01 : `core.settlement_cmd_approve_finance_action` (corps de 0123 recopié à
--     l'identique, un bloc marqué US-222d2) refuse `SELF_FORBIDDEN` (journalisé
--     `FINANCE_SELF_APPROVAL_DENIED`, raison `REQUESTER_RELATED`) quand l'approbateur et le
--     demandeur sont en conflit (`core.support_staff_conflict(x, 'USER_ACCOUNT', y)`, dans les deux
--     sens), pour TOUTE action FINANCE (ISSUE_BORDEREAU, DECIDE_ADVANCE, WRITE_OFF_RECEIVABLE) ;
--     la demande reste en attente (une personne réellement distincte peut l'approuver) ;
--   - F-L2-LB-02 : `core.config_cmd_approve_go_live_switch` (corps de 0073 recopié, un bloc marqué
--     US-222d2) applique la même garde, jugée au moment de l'approbation (le seul où deux personnes
--     sont en présence : un lien constaté après la demande compte) ; issue `SELF_FORBIDDEN`,
--     journal `GO_LIVE_SELF_APPROVAL_DENIED`, raison `REQUESTER_RELATED`, la demande reste en
--     attente. `cmd_golive_owner` reçoit EXECUTE sur `core.support_staff_conflict` (aucun rôle
--     applicatif). AUCUNE valeur d'interrupteur n'est écrite : tous restent à false ;
--   - F-L2-LB-04 (N-114) : le signal SAME_IDENTITY (`core.risk_self_booking_signal`, corps de 0093)
--     et le doublon d'identité d'hôte (`core.kyc_host_identity_duplicate`, corps de 0097) gardent,
--     EN OU avec l'inclusion des sacs de mots, l'égalité de la clé `core.kyc_legal_name_key`
--     (prénoms et noms non vides) à date de naissance égale : noms à un seul mot distinct (« Wei
--     Wei », « A Li »). Un homonyme réel n'est jamais bloqué sans revue humaine : le constat
--     NOT_LINKED de l'ops (US-127) le libère, comme avant ;
--   - F-L2-LB-05 (N-118) : le doublon d'identité d'hôte compte aussi les dossiers REJECTED et
--     REVOKED d'un autre titulaire (politique `risk_host_duplicate_read` élargie à ces trois
--     états) ; le second dossier n'est pas refusé : il reste en revue de l'ops
--     (`HOST_IDENTITY_DUPLICATE`), que le constat NOT_LINKED libère (comme Turo, PROPOSÉ).
--
-- Expand / contract : quatre fonctions remplacées (même signature, mêmes colonnes, même
-- propriétaire, mêmes droits), une politique élargie, un droit EXECUTE ajouté à un propriétaire ;
-- aucune table ni colonne, aucune valeur de paramètre.
--
-- Retour arrière : recréer les quatre fonctions avec les corps de 0123, 0073, 0093 et 0097 ;
--   ALTER POLICY risk_host_duplicate_read ON core.kyc_host_verification USING (status = 'APPROVED') ;
--   REVOKE EXECUTE ON FUNCTION core.support_staff_conflict(uuid, text, uuid) FROM cmd_golive_owner.

-- 1. F-L2-LB-01 : approbation FINANCE (sous cmd_money_owner, définition de 0123) ----------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;
CREATE OR REPLACE FUNCTION core.settlement_cmd_approve_finance_action(p_token_hash bytea, p_approval_id uuid)
  RETURNS TABLE (outcome text, approval_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_f    record;
  v_perm text;
  v_type text;
  v_role text;
  v_now  timestamptz;
  v_ok   boolean;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION 'finance : demande absente' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT f.id, f.action, f.subject_id, f.country_code, f.reason, f.requested_by, f.status INTO v_f
    FROM core.settlement_finance_approval AS f WHERE f.id = p_approval_id;
  v_type := CASE v_f.action WHEN 'ISSUE_BORDEREAU' THEN 'INSURER_BORDEREAU'
                            WHEN 'DECIDE_ADVANCE' THEN 'PLATFORM_ADVANCE'
                            WHEN 'WRITE_OFF_RECEIVABLE' THEN 'PLATFORM_ADVANCE'
                            ELSE 'FINANCE_APPROVAL' END;
  v_perm := CASE v_f.action WHEN 'ISSUE_BORDEREAU' THEN 'finance.insurer_bordereau'
                            ELSE 'finance.platform_advance' END;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', v_type,
                                 COALESCE(v_f.subject_id, p_approval_id), NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'APPROVE_FINANCE_ACTION'), NULL, p_approval_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_f.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, v_perm, ARRAY[v_f.country_code], NULL);
  END IF;
  IF v_role IS NULL OR NOT (v_f.country_code = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', v_type,
                                 COALESCE(v_f.subject_id, p_approval_id), NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_f.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION_OR_COUNTRY' END,
                                   'attempted', 'APPROVE_FINANCE_ACTION', 'permission', v_perm),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_f.status <> 'PENDING' THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_f.id;
    RETURN;
  END IF;
  -- deux personnes distinctes : l'identité est celle de la SESSION (une seconde session du
  -- demandeur est la même personne) ; refus journalisé, aucun effet d'argent
  IF v_f.requested_by = v_s.user_id THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_SELF_APPROVAL_DENIED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'SELF_APPROVAL'::text, v_f.id;
    RETURN;
  END IF;
  -- US-122 (ADR-124, F2-C-04) : l'approbateur n'est pas non plus une personne du sujet
  -- (titulaire, co-hôte, compte lié) ; refus journalisé, aucun effet d'argent
  IF core.support_staff_conflict(v_s.user_id, v_type, v_f.subject_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_SELF_APPROVAL_DENIED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code,
                                   'reason', 'SELF', 'guard', 'SEPARATION_OF_DUTIES'),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, v_f.id;
    RETURN;
  END IF;
  -- US-222d2 (F-L2-LB-01, ADR-177) : l'approbateur n'est pas non plus une personne du DEMANDEUR
  -- (lui-même sous un autre compte, une personne de ses comptes d'hôte, un compte lié LINKED à
  -- l'un d'eux), jugé dans les deux sens et pour TOUTE action FINANCE : un sujet sans partie
  -- (bordereau de l'assureur) ou sans lien avec l'approbateur ne suffit plus ; refus journalisé,
  -- la demande reste en attente, aucun effet d'argent
  IF core.support_staff_conflict(v_s.user_id, 'USER_ACCOUNT', v_f.requested_by)
     OR core.support_staff_conflict(v_f.requested_by, 'USER_ACCOUNT', v_s.user_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_SELF_APPROVAL_DENIED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code,
                                   'reason', 'REQUESTER_RELATED', 'guard', 'SEPARATION_OF_DUTIES'),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, v_f.id;
    RETURN;
  END IF;
  -- verrous : la demande, puis le sujet ; le sujet doit être resté éligible
  PERFORM 1 FROM core.settlement_finance_approval AS f WHERE f.id = v_f.id AND f.status = 'PENDING'
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_f.id;
    RETURN;
  END IF;
  -- US-224b (N-119) : le conflit du DEMANDEUR est rejugé à l'approbation (il a pu devenir
  -- titulaire, co-hôte du compte ou compte lié depuis sa demande) ; la demande est rejetée,
  -- refus journalisé, aucun effet d'argent ; même issue que le conflit de l'approbateur
  IF core.support_staff_conflict(v_f.requested_by, v_type, v_f.subject_id) THEN
    UPDATE core.settlement_finance_approval AS f SET status = 'REJECTED' WHERE f.id = v_f.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_REJECTED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code,
                                   'reason', 'REQUESTER_CONFLICT', 'guard', 'SEPARATION_OF_DUTIES'),
                                 NULL, p_approval_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, v_f.id;
    RETURN;
  END IF;
  IF v_f.action = 'DECIDE_ADVANCE' THEN
    PERFORM 1 FROM core.settlement_platform_advance AS a
     WHERE a.id = v_f.subject_id AND a.status IN ('PLANNED', 'OPEN') AND a.decided_by IS NULL
       FOR UPDATE;
  ELSIF v_f.action = 'WRITE_OFF_RECEIVABLE' THEN
    PERFORM 1 FROM core.settlement_platform_advance AS a
     WHERE a.id = v_f.subject_id AND a.status IN ('OPEN', 'RECOVERING')
       AND a.receivable_minor > a.recovered_minor FOR UPDATE;
  ELSE
    PERFORM 1 FROM core.settlement_insurer_bordereau AS b
     WHERE b.id = v_f.subject_id AND b.status = 'DRAFT' FOR UPDATE;
  END IF;
  v_ok := FOUND;
  v_now := platform.now();
  IF NOT v_ok THEN
    UPDATE core.settlement_finance_approval AS f SET status = 'REJECTED' WHERE f.id = v_f.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_REJECTED', v_type,
                                 v_f.subject_id, NULL,
                                 pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                   'action', v_f.action, 'country', v_f.country_code,
                                   'reason', 'SUBJECT_CHANGED'), NULL, p_approval_id);
    RETURN QUERY SELECT 'SUBJECT_CHANGED'::text, v_f.id;
    RETURN;
  END IF;
  UPDATE core.settlement_finance_approval AS f
     SET status = 'APPROVED', approved_by = v_s.user_id, approved_at = v_now
   WHERE f.id = v_f.id;
  IF v_f.action = 'DECIDE_ADVANCE' THEN
    UPDATE core.settlement_platform_advance AS a
       SET decided_by = v_f.requested_by, decision_second_by = v_s.user_id,
           decision_approval_id = v_f.id
     WHERE a.id = v_f.subject_id;
  ELSIF v_f.action = 'WRITE_OFF_RECEIVABLE' THEN
    UPDATE core.settlement_platform_advance AS a
       SET status = 'WRITTEN_OFF', written_off_by = v_f.requested_by, write_off_second_by = v_s.user_id,
           write_off_approval_id = v_f.id, written_off_at = v_now
     WHERE a.id = v_f.subject_id;
  ELSE
    UPDATE core.settlement_insurer_bordereau AS b
       SET status = 'ISSUED', issued_by = v_f.requested_by, second_validated_by = v_s.user_id,
           approval_id = v_f.id, issued_at = v_now
     WHERE b.id = v_f.subject_id;
  END IF;
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'FINANCE_ACTION_APPROVED', v_type, v_f.subject_id,
                               NULL, pg_catalog.jsonb_build_object('approvalId', v_f.id,
                                 'action', v_f.action, 'country', v_f.country_code,
                                 'requestedBy', v_f.requested_by), NULL, p_approval_id);
  RETURN QUERY SELECT 'APPROVED'::text, v_f.id;
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 2. F-L2-LB-02 : approbation d'un interrupteur (sous cmd_golive_owner, définition de 0073) -----
SET LOCAL ROLE iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.support_staff_conflict(uuid, text, uuid) TO cmd_golive_owner;
COMMENT ON FUNCTION core.support_staff_conflict(uuid, text, uuid) IS
  'Garde de séparation des tâches (core.support_actor_conflict) pour un autre propriétaire de '
  'commande (cmd_money_owner, cmd_golive_owner). SECURITY DEFINER, aucun rôle applicatif. US-122 '
  '(ADR-124, F2-C-04), US-222d2 (ADR-177).';
RESET ROLE;
GRANT CREATE ON SCHEMA core TO cmd_golive_owner;
SET LOCAL ROLE cmd_golive_owner;
CREATE OR REPLACE FUNCTION core.config_cmd_approve_go_live_switch(p_token_hash bytea, p_request_id uuid)
  RETURNS TABLE (outcome text, request_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s      record;
  v_r      record;
  v_role   text;
  v_now    timestamptz;
  v_before boolean;
  v_value  uuid;
  v_from   timestamptz;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL OR app.actor_kind() IS DISTINCT FROM 'STAFF' THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'interrupteur : demande absente' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT r.id, r.key, r.country_code::text AS country_code, r.value, r.decision_ref,
         r.requested_by, r.expires_at, r.status INTO v_r
    FROM core.config_go_live_switch_request AS r WHERE r.id = p_request_id;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'GO_LIVE_SWITCH',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'APPROVE_GO_LIVE_SWITCH'), NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid;
    RETURN;
  END IF;
  -- approbation : SUPERADMIN du pays seulement (un ADMIN ne fait que demander)
  IF v_r.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'config.go_live_switch', ARRAY[v_r.country_code],
                                       ARRAY['SUPERADMIN']);
  END IF;
  IF v_role IS NULL OR NOT (v_r.country_code = ANY (COALESCE(app.country_scope(), '{}'::text[]))) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'GO_LIVE_SWITCH',
                                 p_request_id, NULL,
                                 pg_catalog.jsonb_build_object('reason',
                                   CASE WHEN v_r.id IS NULL THEN 'SUBJECT_NOT_FOUND'
                                        ELSE 'PERMISSION_OR_COUNTRY' END,
                                   'attempted', 'APPROVE_GO_LIVE_SWITCH',
                                   'permission', 'config.go_live_switch'), NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_r.status <> 'PENDING' THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_r.id;
    RETURN;
  END IF;
  -- deux personnes distinctes : l'identité est celle de la SESSION (une seconde session du
  -- demandeur est la même personne) ; refus journalisé, aucun effet
  IF v_r.requested_by = v_s.user_id THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SELF_APPROVAL_DENIED',
                                 'GO_LIVE_SWITCH', v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code, 'value', v_r.value),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'SELF_APPROVAL'::text, v_r.id;
    RETURN;
  END IF;
  -- US-222d2 (F-L2-LB-02, ADR-177) : deux personnes DISTINCTES (DEC-FONDATEUR-15, RLS-27) ;
  -- l'approbateur n'est pas une personne du demandeur (lui-même sous un autre compte, une personne
  -- de ses comptes d'hôte, un compte lié LINKED), jugé dans les deux sens au moment de
  -- l'approbation (un lien constaté après la demande compte) ; refus journalisé, la demande reste
  -- en attente, aucun effet
  IF core.support_staff_conflict(v_s.user_id, 'USER_ACCOUNT', v_r.requested_by)
     OR core.support_staff_conflict(v_r.requested_by, 'USER_ACCOUNT', v_s.user_id) THEN
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SELF_APPROVAL_DENIED',
                                 'GO_LIVE_SWITCH', v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code, 'value', v_r.value,
                                   'reason', 'REQUESTER_RELATED',
                                   'guard', 'SEPARATION_OF_DUTIES'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'SELF_FORBIDDEN'::text, v_r.id;
    RETURN;
  END IF;
  -- même verrou que la demande, puis la ligne ; l'état est relu sous verrou
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('config.go_live:' || v_r.key || ':' || v_r.country_code, 0));
  PERFORM 1 FROM core.config_go_live_switch_request AS r
   WHERE r.id = v_r.id AND r.status = 'PENDING' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_PENDING'::text, v_r.id;
    RETURN;
  END IF;
  v_now := platform.now();
  IF v_r.expires_at <= v_now THEN
    UPDATE core.config_go_live_switch_request AS r SET status = 'EXPIRED' WHERE r.id = v_r.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SWITCH_EXPIRED', 'GO_LIVE_SWITCH',
                                 v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code, 'value', v_r.value),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'EXPIRED'::text, v_r.id;
    RETURN;
  END IF;
  -- le demandeur doit encore détenir la permission et un compte ACTIVE (rôle retiré ou compte
  -- suspendu entre-temps : demande rejetée)
  IF core.iam_staff_permitted(v_r.requested_by, 'config.go_live_switch', ARRAY[v_r.country_code],
                              ARRAY['ADMIN', 'SUPERADMIN']) IS NULL
     OR NOT EXISTS (SELECT 1 FROM core.iam_user_account AS u
                     WHERE u.id = v_r.requested_by AND u.status = 'ACTIVE') THEN
    UPDATE core.config_go_live_switch_request AS r SET status = 'REJECTED' WHERE r.id = v_r.id;
    PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SWITCH_REJECTED', 'GO_LIVE_SWITCH',
                                 v_r.id, NULL,
                                 pg_catalog.jsonb_build_object('key', v_r.key,
                                   'country', v_r.country_code, 'value', v_r.value,
                                   'reason', 'REQUESTER_NOT_PERMITTED'), NULL, p_request_id);
    RETURN QUERY SELECT 'REJECTED'::text, v_r.id;
    RETURN;
  END IF;
  v_before := core.config_go_live(v_r.key, v_r.country_code);
  UPDATE core.config_go_live_switch_request AS r
     SET status = 'APPLIED', approved_by = v_s.user_id, approved_at = v_now
   WHERE r.id = v_r.id;
  -- nouvelle version (valid_from posé par la garde de 0008 : platform.now()), recopie de la demande
  INSERT INTO core.config_param_value (key, country_code, scope_type, value, approved_by,
                                       decision_ref, change_reason, go_live_request_id)
  VALUES (v_r.key, v_r.country_code, 'COUNTRY', pg_catalog.to_jsonb(v_r.value), v_s.user_id,
          v_r.decision_ref, 'interrupteur à deux personnes : ' || v_r.decision_ref, v_r.id)
  RETURNING id, valid_from INTO v_value, v_from;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, causation_id, payload, partition_key)
  VALUES ('config.param.changed', 1, 'param_value', v_value, 0, v_r.country_code, v_s.user_id,
          'SUPERADMIN', v_r.id, NULL,
          pg_catalog.jsonb_build_object('key', v_r.key, 'scope', 'COUNTRY',
            'country', v_r.country_code, 'valid_from', v_from),
          v_r.key || ':' || v_r.country_code);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'GO_LIVE_SWITCH_APPLIED', 'GO_LIVE_SWITCH',
                               v_r.id, pg_catalog.jsonb_build_object('value', v_before),
                               pg_catalog.jsonb_build_object('key', v_r.key,
                                 'country', v_r.country_code, 'value', v_r.value,
                                 'decisionRef', v_r.decision_ref, 'requestedBy', v_r.requested_by,
                                 'validFrom', v_from),
                               v_r.decision_ref, p_request_id);
  RETURN QUERY SELECT 'APPLIED'::text, v_r.id;
END
$fn$;

COMMENT ON FUNCTION core.config_cmd_approve_go_live_switch(bytea, uuid) IS
  'Approbation par un SUPERADMIN AUTRE que le demandeur et sans lien avec lui (ni compte lié, ni '
  'personne de ses comptes d''hôte) ; nouvelle version, événement et audit dans la même '
  'transaction : 17 §2.3, RLS-27. US-125, US-222d2 (ADR-177).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_golive_owner;

-- 3. F-L2-LB-04 et F-L2-LB-05 : identité (sous risk_limit_owner, définitions de 0093 et 0097) ----
ALTER POLICY risk_host_duplicate_read ON core.kyc_host_verification
  USING (status IN ('APPROVED', 'REJECTED', 'REVOKED'));
GRANT CREATE ON SCHEMA core TO risk_limit_owner;
SET LOCAL ROLE risk_limit_owner;
CREATE OR REPLACE FUNCTION core.risk_self_booking_signal(p_guest uuid, p_org uuid)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_holder uuid;
  v_host   uuid[];
  v_auto   uuid[];
  v_signal text;
  v_key    text;
  v_birth  date;
BEGIN
  -- entrée absente ou compte inconnu : aucun lien jugeable, fail-closed
  IF p_guest IS NULL OR p_org IS NULL THEN
    RETURN 'DIRECT';
  END IF;
  SELECT o.holder_user_id INTO v_holder FROM core.iam_organization AS o WHERE o.id = p_org;
  IF v_holder IS NULL THEN
    RETURN 'DIRECT';
  END IF;
  -- personnes du côté hôte : titulaire du compte du véhicule et membres ACTIVE / INVITED de tous
  -- les comptes d'hôte de ce titulaire (tous pays)
  v_host := ARRAY(
    SELECT v_holder
    UNION
    SELECT m.user_id
      FROM core.iam_organization AS o2
      JOIN core.iam_membership AS m ON m.org_id = o2.id AND m.status IN ('ACTIVE', 'INVITED')
     WHERE o2.holder_user_id = v_holder);
  IF p_guest = ANY (v_host) THEN
    RETURN 'DIRECT';
  END IF;
  -- constat LINKED de l'ops sur une paire (voyageur, personne du côté hôte)
  SELECT l.signal INTO v_signal
    FROM pg_catalog.unnest(v_host) AS h(user_id)
    JOIN core.risk_account_link AS l
      ON l.user_low = LEAST(h.user_id, p_guest) AND l.user_high = GREATEST(h.user_id, p_guest)
   WHERE l.decision = 'LINKED'
   ORDER BY l.signal LIMIT 1;
  IF v_signal IS NOT NULL THEN
    RETURN v_signal;
  END IF;
  -- signaux automatiques : toutes les personnes du côté hôte sauf celles constatées NOT_LINKED
  v_auto := ARRAY(
    SELECT h.user_id
      FROM pg_catalog.unnest(v_host) AS h(user_id)
     WHERE NOT EXISTS (SELECT 1 FROM core.risk_account_link AS l
                        WHERE l.user_low = LEAST(h.user_id, p_guest)
                          AND l.user_high = GREATEST(h.user_id, p_guest)
                          AND l.decision = 'NOT_LINKED'));
  IF pg_catalog.cardinality(v_auto) = 0 THEN
    RETURN NULL;
  END IF;
  -- SAME_IDENTITY : identités du voyageur (chacune de ses vérifications approuvées une fois) ;
  -- aucune ⇒ aucune lecture côté hôte (cas courant). US-122 : sac de mots du nom lu sur le permis
  -- (sinon du nom déclaré), comparé par inclusion (ADR-122)
  IF EXISTS (
    WITH g AS (
      SELECT COALESCE(
               NULLIF((SELECT core.kyc_legal_name_bag(d.holder_given_names, d.holder_surnames)
                         FROM core.kyc_identity_document AS d
                        WHERE d.verification_id = v.id
                        ORDER BY d.created_at DESC, d.id DESC LIMIT 1), '{}'::text[]),
               core.kyc_legal_name_bag(u.legal_first_name, u.legal_last_name)) AS name_bag,
             -- US-222d2 (F-L2-LB-04, N-114) : clé de nom « prénoms | noms », même source
             COALESCE(
               NULLIF((SELECT core.kyc_legal_name_key(d.holder_given_names, d.holder_surnames)
                         FROM core.kyc_identity_document AS d
                        WHERE d.verification_id = v.id
                        ORDER BY d.created_at DESC, d.id DESC LIMIT 1), '|'),
               core.kyc_legal_name_key(u.legal_first_name, u.legal_last_name)) AS name_key,
             s.date_of_birth
        FROM core.iam_user_account AS u
        JOIN core.kyc_identity_verification AS v
          ON v.user_id = u.id AND v.first_approved_at IS NOT NULL
        JOIN core.kyc_identity_subject AS s
          ON s.verification_id = v.id AND s.user_id = u.id AND s.date_of_birth IS NOT NULL
       WHERE u.id = p_guest AND u.pseudonymized_at IS NULL
    ),
    h AS (
      SELECT COALESCE(
               NULLIF((SELECT core.kyc_legal_name_bag(d.holder_given_names, d.holder_surnames)
                         FROM core.kyc_identity_document AS d
                        WHERE d.verification_id = v.id
                        ORDER BY d.created_at DESC, d.id DESC LIMIT 1), '{}'::text[]),
               core.kyc_legal_name_bag(u.legal_first_name, u.legal_last_name)) AS name_bag,
             -- US-222d2 (F-L2-LB-04, N-114) : clé de nom « prénoms | noms », même source
             COALESCE(
               NULLIF((SELECT core.kyc_legal_name_key(d.holder_given_names, d.holder_surnames)
                         FROM core.kyc_identity_document AS d
                        WHERE d.verification_id = v.id
                        ORDER BY d.created_at DESC, d.id DESC LIMIT 1), '|'),
               core.kyc_legal_name_key(u.legal_first_name, u.legal_last_name)) AS name_key,
             s.date_of_birth
        FROM pg_catalog.unnest(v_auto) AS a(user_id)
        JOIN core.iam_user_account AS u ON u.id = a.user_id
        JOIN core.kyc_identity_verification AS v
          ON v.user_id = u.id AND v.first_approved_at IS NOT NULL
        JOIN core.kyc_identity_subject AS s
          ON s.verification_id = v.id AND s.user_id = u.id AND s.date_of_birth IS NOT NULL
       WHERE u.pseudonymized_at IS NULL
         AND EXISTS (SELECT 1 FROM g)
    )
    -- US-122 (F-L1-S-01) : sacs de mots, inclusion, même date de naissance
    SELECT 1 FROM g JOIN h ON h.date_of_birth = g.date_of_birth
     WHERE core.kyc_legal_name_bags_match(g.name_bag, h.name_bag)
        -- US-222d2 (F-L2-LB-04, N-114) : OU même clé de nom (noms à un seul mot distinct),
        -- prénoms et noms présents ; un homonyme réel est libéré par le constat NOT_LINKED de l'ops
        OR (g.name_key = h.name_key
            AND pg_catalog.split_part(g.name_key, '|', 1) <> ''
            AND pg_catalog.split_part(g.name_key, '|', 2) <> '')) THEN
    RETURN 'SAME_IDENTITY';
  END IF;
  -- SAME_PHONE : même numéro, vérifié sur l'un des deux comptes au moins
  IF EXISTS (SELECT 1
               FROM core.iam_user_account AS g
               JOIN core.iam_user_account AS h ON h.id = ANY (v_auto)
              WHERE g.id = p_guest AND g.pseudonymized_at IS NULL
                AND h.pseudonymized_at IS NULL AND g.phone_e164 IS NOT NULL
                AND g.phone_e164 = h.phone_e164
                AND (g.phone_verified_at IS NOT NULL OR h.phone_verified_at IS NOT NULL)) THEN
    RETURN 'SAME_PHONE';
  END IF;
  RETURN NULL;
END
$fn$;

CREATE OR REPLACE FUNCTION core.kyc_host_identity_duplicate(p_org uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH holder AS (
    SELECT o.holder_user_id AS user_id FROM core.iam_organization AS o WHERE o.id = p_org
  ),
  -- identités vérifiées (approuvées une fois) d'une personne : sac de mots du nom lu sur le
  -- permis, sinon du nom déclaré (même lecture que core.risk_self_booking_signal, ADR-122)
  idn AS (
    SELECT s.user_id, s.date_of_birth,
           COALESCE(
             NULLIF((SELECT core.kyc_legal_name_bag(d.holder_given_names, d.holder_surnames)
                       FROM core.kyc_identity_document AS d
                      WHERE d.verification_id = v.id
                      ORDER BY d.created_at DESC, d.id DESC LIMIT 1), '{}'::text[]),
             core.kyc_legal_name_bag(u.legal_first_name, u.legal_last_name)) AS name_bag,
           -- US-222d2 (F-L2-LB-04, N-114) : clé de nom « prénoms | noms » (même source)
           COALESCE(
             NULLIF((SELECT core.kyc_legal_name_key(d.holder_given_names, d.holder_surnames)
                       FROM core.kyc_identity_document AS d
                      WHERE d.verification_id = v.id
                      ORDER BY d.created_at DESC, d.id DESC LIMIT 1), '|'),
             core.kyc_legal_name_key(u.legal_first_name, u.legal_last_name)) AS name_key
      FROM core.kyc_identity_subject AS s
      JOIN core.kyc_identity_verification AS v
        ON v.id = s.verification_id AND v.user_id = s.user_id AND v.first_approved_at IS NOT NULL
      JOIN core.iam_user_account AS u ON u.id = s.user_id AND u.pseudonymized_at IS NULL
     WHERE s.date_of_birth IS NOT NULL
  ),
  me AS (SELECT i.* FROM idn AS i JOIN holder AS h ON h.user_id = i.user_id)
  SELECT (SELECT h.user_id FROM holder AS h) IS NULL
      OR EXISTS (
           SELECT 1
             FROM me
             JOIN idn AS t ON t.date_of_birth = me.date_of_birth AND t.user_id <> me.user_id
            WHERE (core.kyc_legal_name_bags_match(me.name_bag, t.name_bag)
                   -- US-222d2 (F-L2-LB-04, N-114) : OU même clé de nom, prénoms et noms présents
                   OR (me.name_key = t.name_key
                       AND pg_catalog.split_part(me.name_key, '|', 1) <> ''
                       AND pg_catalog.split_part(me.name_key, '|', 2) <> ''))
              -- US-222d2 (F-L2-LB-05, N-118) : un dossier REJETÉ ou RÉVOQUÉ compte aussi
              -- (bannissement contourné par un second compte, 08 BR-ACC-06)
              AND EXISTS (SELECT 1
                            FROM core.iam_organization AS o2
                            JOIN core.kyc_host_verification AS hv ON hv.org_id = o2.id
                           WHERE o2.holder_user_id = t.user_id
                             AND hv.status IN ('APPROVED', 'REJECTED', 'REVOKED'))
              AND NOT EXISTS (SELECT 1 FROM core.risk_account_link AS l
                               WHERE l.user_low = LEAST(t.user_id, me.user_id)
                                 AND l.user_high = GREATEST(t.user_id, me.user_id)
                                 AND l.decision = 'NOT_LINKED'))
$fn$;

COMMENT ON FUNCTION core.kyc_host_identity_duplicate(uuid) IS
  'Doublon d''identité d''hôte : le titulaire du compte est la même personne (SAME_IDENTITY : sacs '
  'de mots inclus ou même clé de nom, même naissance) qu''un autre titulaire dont un dossier '
  'd''hôte est APPROVED, REJECTED ou REVOKED, sans constat NOT_LINKED ; compte inconnu : vrai. '
  'SECURITY DEFINER, EXECUTE kyc_cmd_owner. US-122 (ADR-124, F2-A03-01), US-222d2 (ADR-177).';
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM risk_limit_owner;
