-- 0030 — NTF : journal des envois de notifications (`notification_dispatch`). US-021 ; 17 §2.13,
-- §3.2.12 ; 16 NTF-001 ; ADR-061. Appliquée sous `migrator`.
--
-- Une ligne = un message à UN destinataire sur UN canal pour UN événement. L'unicité
-- (event_id, recipient_user_id, channel) de 17 §3.2.12 rend le rejeu d'un événement sans effet :
-- aucun doublon par destinataire et canal (critère 2 d'US-021).
--
-- Écarts PROPOSÉS avec 17 §3.2.12 (ADR-061, à reporter dans 17) :
--   - `notification_template` et `notification_rule` ne sont pas des tables : le catalogue de la
--     bêta est du code typé (apps/api/src/modules/ntf/internal/catalog.ts) et les textes sont dans
--     `@rueda/i18n` (es, en, fr) ; `template_key` + `template_version` (= CATALOG_VERSION) tracent
--     la version utilisée (10b UX-62). Les tables viendront avec l'édition des gabarits (ADMIN) ;
--   - colonnes ajoutées : `event_type`, `country_code`, `correlation_id` (événements
--     `notification.*`), `recipient_role`, `variables` (valeurs NON sensibles copiées de la charge
--     utile de l'événement : références, instants, montants en unités mineures), `locale`
--     (langue retenue à l'envoi), `last_error` (code court), `fallback_of` (envoi d'origine d'un
--     repli) ;
--   - `rendered_hash` : SHA-256 du texte rendu (preuve) ; le texte lui-même n'est jamais stocké.
--   - ni adresse, ni numéro, ni prénom : les coordonnées sont relues au moment de l'envoi par
--     `core.iam_notification_contact` (0031) et jamais écrites ici.
--
-- Droits : app_worker seulement, sous les travailleurs `ntf_dispatcher` (création) et
-- `ntf_sender` (envoi, repli). Rien pour app_api, app_anon ni PUBLIC. Aucun DELETE (purge à 13 mois :
-- story de purge, comme l'outbox, passation US-008). RLS ENABLE + FORCE.
--
-- Retour arrière (table vide) :
--   DROP TABLE core.ntf_notification_dispatch;

CREATE TABLE core.ntf_notification_dispatch (
  id                  uuid        PRIMARY KEY DEFAULT platform.uuid_v7(),
  event_id            uuid        NOT NULL,
  event_type          text        NOT NULL,
  country_code        text,
  correlation_id      uuid        NOT NULL,
  recipient_user_id   uuid        NOT NULL REFERENCES core.iam_user_account (id),
  recipient_role      text        NOT NULL,
  channel             text        NOT NULL,
  template_key        text        NOT NULL,
  template_version    integer     NOT NULL,
  variables           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL DEFAULT 'QUEUED',
  attempts            smallint    NOT NULL DEFAULT 0,
  locale              text,
  provider_message_id text,
  rendered_hash       bytea,
  last_error          text,
  fallback_of         uuid        REFERENCES core.ntf_notification_dispatch (id),
  created_at          timestamptz NOT NULL DEFAULT platform.now(),
  updated_at          timestamptz NOT NULL DEFAULT platform.now(),
  row_version         integer     NOT NULL DEFAULT 0,
  CONSTRAINT notification_dispatch_unique UNIQUE (event_id, recipient_user_id, channel),
  CONSTRAINT notification_dispatch_event_type_format
    CHECK (event_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT notification_dispatch_country_format CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT notification_dispatch_role_format CHECK (recipient_role ~ '^[A-Z][A-Z0-9_]{0,31}$'),
  -- canaux du port MessagingChannel (US-020) ; WhatsApp au lot 5 (US-526), in-app et push plus tard
  CONSTRAINT notification_dispatch_channel_valid CHECK (channel IN ('EMAIL', 'SMS')),
  CONSTRAINT notification_dispatch_template_format CHECK (template_key ~ '^EVT_[A-Z0-9_]{1,60}$'),
  CONSTRAINT notification_dispatch_template_version CHECK (template_version >= 1),
  CONSTRAINT notification_dispatch_variables_object CHECK (pg_catalog.jsonb_typeof(variables) = 'object'),
  CONSTRAINT notification_dispatch_status_valid CHECK (
    status IN ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'FALLBACK_TRIGGERED', 'SUPPRESSED')),
  -- 17 §2.13 : 3 réessais au plus
  CONSTRAINT notification_dispatch_attempts_range CHECK (attempts BETWEEN 0 AND 3),
  CONSTRAINT notification_dispatch_locale_format CHECK (locale IS NULL OR locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT notification_dispatch_hash_sha256
    CHECK (rendered_hash IS NULL OR pg_catalog.octet_length(rendered_hash) = 32),
  -- un code court, jamais un message d'erreur libre (qui pourrait porter une donnée personnelle)
  CONSTRAINT notification_dispatch_error_code CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  CONSTRAINT notification_dispatch_provider_ref
    CHECK (provider_message_id IS NULL OR pg_catalog.length(provider_message_id) BETWEEN 1 AND 200),
  CONSTRAINT notification_dispatch_sent_has_ref CHECK (
    status NOT IN ('SENT', 'DELIVERED') OR (provider_message_id IS NOT NULL AND rendered_hash IS NOT NULL)),
  CONSTRAINT notification_dispatch_not_own_fallback CHECK (fallback_of IS NULL OR fallback_of <> id)
);
CREATE INDEX notification_dispatch_recipient_idx ON core.ntf_notification_dispatch (recipient_user_id);
CREATE INDEX notification_dispatch_fallback_idx ON core.ntf_notification_dispatch (fallback_of)
  WHERE (fallback_of IS NOT NULL);
CREATE TRIGGER touch_row BEFORE UPDATE ON core.ntf_notification_dispatch
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();
COMMENT ON TABLE core.ntf_notification_dispatch IS
  'NTF notification_dispatch (17 §3.2.12) : un envoi par (événement, destinataire, canal). Aucun contenu ni coordonnée. US-021, ADR-061.';

-- RLS ENABLE + FORCE, migrator_all -------------------------------------------------------------
ALTER TABLE core.ntf_notification_dispatch ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.ntf_notification_dispatch FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.ntf_notification_dispatch TO migrator USING (true) WITH CHECK (true);

-- Droits d'app_worker, bornés par colonnes --------------------------------------------------------
-- création : ni statut, ni tentative, ni résultat d'envoi choisis par l'écrivain (DEFAULT)
GRANT INSERT (event_id, event_type, country_code, correlation_id, recipient_user_id, recipient_role,
              channel, template_key, template_version, variables, fallback_of)
  ON core.ntf_notification_dispatch TO app_worker;
-- lecture bornée par colonnes (revue sécurité US-021) : ni created_at, ni updated_at, ni row_version
GRANT SELECT (id, event_id, event_type, country_code, correlation_id, recipient_user_id,
              recipient_role, channel, template_key, template_version, variables, status, attempts,
              locale, provider_message_id, rendered_hash, last_error, fallback_of)
  ON core.ntf_notification_dispatch TO app_worker;
GRANT UPDATE (status, attempts, locale, provider_message_id, rendered_hash, last_error)
  ON core.ntf_notification_dispatch TO app_worker;

-- ntf_dispatcher crée les envois d'un événement ; ntf_sender crée les envois de repli
CREATE POLICY ntf_worker_insert ON core.ntf_notification_dispatch FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER'
              AND app.worker_name() IN ('ntf_dispatcher', 'ntf_sender')
              AND status = 'QUEUED' AND attempts = 0
              AND (fallback_of IS NULL OR app.worker_name() = 'ntf_sender'));
CREATE POLICY ntf_worker_select ON core.ntf_notification_dispatch FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN ('ntf_dispatcher', 'ntf_sender'));
-- seul l'expéditeur fait avancer un envoi, et jamais depuis un état terminal
CREATE POLICY ntf_sender_update ON core.ntf_notification_dispatch FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'ntf_sender' AND status = 'QUEUED')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'ntf_sender');
