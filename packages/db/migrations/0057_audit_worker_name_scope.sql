-- 0057 — AUD : écritures et lecture des clés de sujet réservées aux travailleurs nommés.
-- US-049 (porte du lot 0, red team RLS, constat F-RLS-06, PROPOSÉ élevé : docs/team/redteam/L0-rls.md)
-- ; 17 §2.3 (rôles SQL, contexte de session, fail-closed), §3.1.3 point 1 (clé par sujet),
-- §3.2.13 ; ADR-053 (point 7 : nom de travailleur déclaratif), ADR-077 (matrice), ADR-089.
-- Appliquée sous `migrator`.
--
-- Constat (RT-RLS-16, cas « app_worker se déclare WORKER `nom_inconnu` ») : les politiques
-- `worker_*` de 0021 n'exigeaient que `app.worker_name() IS NOT NULL`. Un nom de travailleur
-- INVENTÉ lisait donc toutes les clés de sujet enveloppées (`audit_subject_key`, C4) et pouvait
-- écrire dans le journal d'audit, le journal d'accès aux données et le registre des fichiers.
-- Cette migration recrée, SOUS LE MÊME NOM (remplacement admis, ADR-081), les politiques
-- concernées, en fail-closed :
--   1. `core.audit_subject_key` : SELECT par `evidence_ingest`, `evidence_verifier`,
--      `privacy_request` ; INSERT par `evidence_ingest`, `privacy_request` (seuls travailleurs qui
--      chiffrent ou déchiffrent une donnée C2 / C3 : réception de preuves, vérification des
--      empreintes d'un fichier chiffré, demandes des personnes — export et effacement, 17
--      §3.2.13 `data_subject_request` ; noms PROPOSÉS, déclarés dans authorization-matrix.json) ;
--   2. `core.audit_audit_log`, `core.audit_data_access_log`, `core.audit_file_asset` : INSERT
--      par les seuls travailleurs déclarés dans la matrice d'autorisations (ADR-077,
--      `authorization-matrix.json` « travailleurs ») ; un nom inconnu n'écrit plus rien.
-- Les politiques `worker_insert` de `core.outbox_outbox_event` et `core.outbox_scheduled_job`
-- (0014) restent telles quelles : sur le bus, le nom de travailleur est le nom de FILE, un
-- ensemble ouvert enregistré dans le code (registre du module BUS : `bus_scheduler`, files des
-- modules) ; justification dans ADR-089 (« Politiques fondées sur le seul nom de travailleur »).
--
-- Limite (ADR-053 point 7, ADR-089) : `app.worker_name` reste DÉCLARATIF. Un code compromis sous
-- `app_worker` peut annoncer un nom autorisé ; la restriction réduit la surface exposée (un nom
-- inventé, une file, un autre travailleur), elle ne remplace pas un rôle SQL par travailleur.
--
-- Expand / contract : aucune contraction de SCHÉMA ni de DROIT (GRANT inchangés, politiques
-- recréées sous le même nom) ; RESSERREMENT de comportement fail-closed, volontaire : un nom de
-- travailleur non autorisé ne lit plus les clés de sujet ni n'écrit l'audit. Aucun travailleur de
-- production n'écrit dans ces tables ni ne lit ces clés sous un autre nom (aucun appel
-- d'`appendAuditLog`, `recordDataAccess`, `receiveFile` ni de `SubjectKeyStore` dans le code des
-- applications au lot 0) : la version N servie n'est pas affectée.
--
-- Retour arrière : recréer les politiques de 0021 (worker_select, worker_insert de
-- core.audit_subject_key ; worker_insert de core.audit_audit_log, core.audit_data_access_log,
-- core.audit_file_asset) avec `app.worker_name() IS NOT NULL`.

-- 1. Clés de sujet : seuls les travailleurs qui chiffrent ou déchiffrent ---------------------------
DROP POLICY worker_select ON core.audit_subject_key;
CREATE POLICY worker_select ON core.audit_subject_key FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER'
         AND app.worker_name() IN ('evidence_ingest', 'evidence_verifier', 'privacy_request'));
DROP POLICY worker_insert ON core.audit_subject_key;
CREATE POLICY worker_insert ON core.audit_subject_key FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('evidence_ingest', 'privacy_request'));

-- 2. Journaux et registre des fichiers : travailleurs déclarés dans la matrice (ADR-077) -----------
DROP POLICY worker_insert ON core.audit_audit_log;
CREATE POLICY worker_insert ON core.audit_audit_log FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('audit_chain_verifier', 'booking_conversion',
                                        'booking_oracle', 'bordereau', 'bus_monitor',
                                        'disposition_sweeper', 'evidence_ingest',
                                        'evidence_verifier', 'hold_expiry', 'ntf_dispatcher',
                                        'ntf_sender', 'ops_monitor', 'outbox_relay',
                                        'payment_command', 'payment_intent_sweeper', 'payout',
                                        'privacy_request', 'reconciliation', 'settlement',
                                        'trip_lifecycle', 'webhook_ingest'));
DROP POLICY worker_insert ON core.audit_data_access_log;
CREATE POLICY worker_insert ON core.audit_data_access_log FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('audit_chain_verifier', 'booking_conversion',
                                        'booking_oracle', 'bordereau', 'bus_monitor',
                                        'disposition_sweeper', 'evidence_ingest',
                                        'evidence_verifier', 'hold_expiry', 'ntf_dispatcher',
                                        'ntf_sender', 'ops_monitor', 'outbox_relay',
                                        'payment_command', 'payment_intent_sweeper', 'payout',
                                        'privacy_request', 'reconciliation', 'settlement',
                                        'trip_lifecycle', 'webhook_ingest'));
DROP POLICY worker_insert ON core.audit_file_asset;
CREATE POLICY worker_insert ON core.audit_file_asset FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('audit_chain_verifier', 'booking_conversion',
                                        'booking_oracle', 'bordereau', 'bus_monitor',
                                        'disposition_sweeper', 'evidence_ingest',
                                        'evidence_verifier', 'hold_expiry', 'ntf_dispatcher',
                                        'ntf_sender', 'ops_monitor', 'outbox_relay',
                                        'payment_command', 'payment_intent_sweeper', 'payout',
                                        'privacy_request', 'reconciliation', 'settlement',
                                        'trip_lifecycle', 'webhook_ingest'));
