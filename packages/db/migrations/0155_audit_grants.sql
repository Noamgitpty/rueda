-- 0155 — AUD : droits et politiques RLS des rôles de production sur les tables d'audit.
-- US-009 ; 17 §2.3 (rôles SQL, contexte de session, fail-closed), §3.1.2 (registre immuable :
-- « droits SQL retirés au rôle applicatif »), §3.2.13 ; ADR-035 ; ADR-051. Appliquée sous `migrator`.
--
-- Principes :
--   - AUCUN UPDATE, DELETE ni TRUNCATE pour aucun rôle applicatif, sur aucune table d'audit ;
--     aucune politique UPDATE / DELETE (seule migrator_all existe en plus des politiques ci-dessous) ;
--   - INSERT par COLONNES : le client ne fournit jamais id / at / prev_hash / hash (chaîne),
--     created_at / destroyed_at (clé), server_received_at / legal_hold_until / deleted_at (fichier) ;
--   - écriture réservée à un contexte posé (fail-closed) : app_api avec app.actor_kind() ∈
--     {GUEST, HOST, STAFF}, app_worker avec app.actor_kind() = 'WORKER' ; contexte absent ⇒ refus ;
--   - lectures : seulement ce dont l'application a besoin en Bêta — la clé du sujet (pour chiffrer)
--     et, pour deux travailleurs nommés, la vérification de la chaîne (audit_chain_verifier) et
--     des empreintes (evidence_verifier). Lecture du journal par la console : US-012 (audit.read).
--   - app_anon, PUBLIC : rien.
--
-- Travailleurs (noms PROPOSÉS, reportés dans packages/db/README.md) : audit_chain_verifier,
-- evidence_verifier.
--
-- Retour arrière : DROP POLICY api_* / worker_* sur chaque table ;
--   REVOKE ALL ON core.audit_subject_key, core.audit_audit_log, core.audit_chain_head,
--     core.audit_data_access_log, core.audit_file_asset FROM app_api, app_worker;

-- core.audit_subject_key ------------------------------------------------------------------------
-- Lire la clé enveloppée de son sujet et en créer une au premier besoin (17 §3.1.3 point 1).
-- La DEK enveloppée ne sert à rien sans le KMS (port KeyWrapper) ; la destruction n'est accordée
-- à personne (0154).
GRANT SELECT (subject_type, subject_id, wrapped_dek, kms_key_id, destroyed_at)
  ON core.audit_subject_key TO app_api, app_worker;
GRANT INSERT (subject_type, subject_id, wrapped_dek, kms_key_id)
  ON core.audit_subject_key TO app_api, app_worker;
CREATE POLICY api_select ON core.audit_subject_key FOR SELECT TO app_api
  USING (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF'));
CREATE POLICY api_insert ON core.audit_subject_key FOR INSERT TO app_api
  WITH CHECK (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF'));
CREATE POLICY worker_select ON core.audit_subject_key FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IS NOT NULL);
CREATE POLICY worker_insert ON core.audit_subject_key FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IS NOT NULL);

-- core.audit_audit_log --------------------------------------------------------------------------
GRANT INSERT (actor_user_id, actor_role, action_code, subject_type, subject_id, before, after,
              reason, ip_enc, ip_key_subject_type, ip_key_subject_id, c2_withheld, request_id)
  ON core.audit_audit_log TO app_api, app_worker;
CREATE POLICY api_insert ON core.audit_audit_log FOR INSERT TO app_api
  WITH CHECK (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF'));
CREATE POLICY worker_insert ON core.audit_audit_log FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IS NOT NULL);
-- vérification de la chaîne (17 §1.7) : relecture complète par un seul travailleur nommé
GRANT SELECT ON core.audit_audit_log TO app_worker;
CREATE POLICY worker_select_verifier ON core.audit_audit_log FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'audit_chain_verifier');

-- core.audit_chain_head : lue par le vérificateur pour détecter une troncature de la fin --------
GRANT SELECT ON core.audit_chain_head TO app_worker;
CREATE POLICY worker_select_verifier ON core.audit_chain_head FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'audit_chain_verifier');

-- core.audit_data_access_log --------------------------------------------------------------------
GRANT INSERT (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
              access_kind, case_ref, request_id)
  ON core.audit_data_access_log TO app_api, app_worker;
CREATE POLICY api_insert ON core.audit_data_access_log FOR INSERT TO app_api
  WITH CHECK (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF'));
CREATE POLICY worker_insert ON core.audit_data_access_log FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IS NOT NULL);

-- core.audit_file_asset -------------------------------------------------------------------------
GRANT INSERT (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id, source,
              device_captured_at, classification, retention_class, enc_subject_type, enc_subject_id)
  ON core.audit_file_asset TO app_api, app_worker;
CREATE POLICY api_insert ON core.audit_file_asset FOR INSERT TO app_api
  WITH CHECK (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF'));
CREATE POLICY worker_insert ON core.audit_file_asset FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IS NOT NULL);
-- recalcul des empreintes (critère US-009 : « le SHA-256 recalculé égale celui de file_asset »)
GRANT SELECT ON core.audit_file_asset TO app_worker;
CREATE POLICY worker_select_verifier ON core.audit_file_asset FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'evidence_verifier');
