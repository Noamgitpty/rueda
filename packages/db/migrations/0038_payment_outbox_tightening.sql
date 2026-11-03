-- 0038 — PAY et BUS : reports de sécurité confiés à US-023.
-- US-023 ; reports d'US-019 (revue sécurité et argent : compte PSP obligatoire, clé étrangère de
-- la boîte de réception, adaptation de L0-08) et d'US-008 (revue sécurité : seul le relais crée
-- des livraisons) ; 17 §2.8, §3.2.7, §4.2, §4.4 ; ADR-050, ADR-059 ; ADR-063. Appliquée sous
-- `migrator`.
--
--   1. core.payment_payment_operation.psp_account_id NOT NULL : toute opération désigne le compte
--      marchand qui l'a portée ; le contrôle différé payment_operation_legs_check (0028) exige donc
--      ses quatre jambes pour toute opération qui déplace des fonds (fin de l'exception
--      « opération antérieure au port »). Tables vides en production à ce stade.
--   2. core.payment_webhook_inbox.psp_account_id : clé étrangère vers payment_psp_account (NULL
--      admis : un rappel dont le compte n'est pas résolu reste dédoublonné par l'index NULLS NOT
--      DISTINCT, L0-08).
--   3. core.outbox_scheduled_job : app_api ne dépose plus de livraison d'événement
--      (event_id IS NULL) ; seul le relais (app_worker outbox_relay) rattache une tâche à un
--      événement. Les minuteries de l'API (17 §2.11) restent permises.
--
-- Non fait ici (ADR-063, « Reports ») : retrait complet des écritures directes d'app_api dans
-- l'outbox au profit des commandes cmd_* (tous les producteurs de l'API doivent d'abord passer
-- par des commandes) ; choix de l'identifiant d'un événement par le producteur (publishEvent lit
-- platform.uuid_v7() faute de droit de lecture ; une collision échoue en 23505, sans effet).
--
-- Retour arrière :
--   ALTER TABLE core.payment_payment_operation ALTER COLUMN psp_account_id DROP NOT NULL;
--   ALTER TABLE core.payment_webhook_inbox DROP CONSTRAINT webhook_inbox_psp_account_fk;
--   DROP POLICY api_insert ON core.outbox_scheduled_job; recréer la politique de 0014 (sans
--   event_id IS NULL).

-- 1. Compte PSP obligatoire ---------------------------------------------------------------------
ALTER TABLE core.payment_payment_operation ALTER COLUMN psp_account_id SET NOT NULL;

COMMENT ON COLUMN core.payment_payment_operation.psp_account_id IS
  'Compte marchand de l''opération (17 §3.2.7) ; obligatoire depuis US-023 (0038) : toute '
  'opération qui déplace des fonds porte ses quatre jambes (contrôle différé de 0028).';

-- 2. Clé étrangère de la boîte de réception -------------------------------------------------------
ALTER TABLE core.payment_webhook_inbox
  ADD CONSTRAINT webhook_inbox_psp_account_fk
  FOREIGN KEY (psp_account_id) REFERENCES core.payment_psp_account (id);

CREATE INDEX webhook_inbox_psp_account_idx ON core.payment_webhook_inbox (psp_account_id)
  WHERE (psp_account_id IS NOT NULL);

-- 3. Livraisons créées par le relais seulement -----------------------------------------------------
DROP POLICY api_insert ON core.outbox_scheduled_job;
CREATE POLICY api_insert ON core.outbox_scheduled_job FOR INSERT TO app_api
  WITH CHECK (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF')
              AND state = 'CREATED' AND attempts = 0 AND event_id IS NULL);
