-- 0151 — AUD : journal d'audit en ajout seul, chaîné par hachage SHA-256.
-- US-009 ; 17 §1.7, §3.1.2 (registre immuable), §3.1.3 point 3 (chaîne sur le texte chiffré),
-- §3.2.13 (`audit_log`) ; 16 ADM-001 ; ADR-051. Appliquée sous `migrator`.
--
-- Chaîne (ADR-051) :
--   hash(n) = SHA-256( UTF-8( forme canonique v1 de la ligne n, prev_hash(n) compris ) )
--   prev_hash(1) = 32 octets nuls ; prev_hash(n) = hash(n - 1) ; id = 1, 2, 3… sans trou.
-- La forme canonique (core.audit_log_canonical) est décrite champ par champ dans ADR-051 et
-- recalculée INDÉPENDAMMENT par le vérificateur TypeScript (packages/db/src/audit/chain.ts).
-- Elle porte sur le texte CHIFFRÉ (ip_enc) et sur les références, jamais sur un clair C2 / C3.
--
-- Écriture : le trigger zz_audit_log_chain (dernier trigger BEFORE INSERT, ordre alphabétique)
-- prend le verrou de la ligne de tête `audit_chain_head` (FOR UPDATE), attribue id, at, prev_hash
-- et hash, puis avance la tête. Les écrivains sont donc sérialisés jusqu'à leur COMMIT : l'ordre
-- des id est l'ordre des validations, et un instantané voit toujours un préfixe de la chaîne.
-- Le client ne peut fournir ni id, ni at, ni prev_hash, ni hash (droits par colonne, 0155).
-- SECURITY DEFINER (propriétaire migrator, search_path figé, EXECUTE retiré) : la tête est
-- invisible des rôles applicatifs ; la fonction ne reçoit que la ligne insérée, sans SQL dynamique.
--
-- Immuabilité : aucun droit UPDATE / DELETE / TRUNCATE (0155) ET triggers de refus, y compris
-- pour le propriétaire. Un propriétaire qui désactiverait les triggers reste détecté par la
-- vérification de la chaîne (test L0 « altération ») ; l'ancrage externe (export mensuel vers le
-- stockage verrouillé, 17 §10) borne ce risque.
--
-- Retour arrière (base vide) :
--   DROP TABLE core.audit_audit_log, core.audit_chain_head;
--   DROP FUNCTION core.audit_log_chain(), core.audit_log_canonical(core.audit_audit_log),
--     core.audit_canon(text), core.audit_chain_head_guard();

-- 1. Tête de chaîne : une ligne par chaîne, avancée de 1 à chaque écriture --------------------
CREATE TABLE core.audit_chain_head (
  chain     text   CONSTRAINT audit_chain_head_pkey PRIMARY KEY
    CONSTRAINT audit_chain_head_chain_valid CHECK (chain IN ('audit_log')),
  last_id   bigint NOT NULL CONSTRAINT audit_chain_head_last_id_valid CHECK (last_id >= 0),
  last_hash bytea  NOT NULL CONSTRAINT audit_chain_head_last_hash_size CHECK (octet_length(last_hash) = 32)
);

INSERT INTO core.audit_chain_head (chain, last_id, last_hash)
VALUES ('audit_log', 0, pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'));

ALTER TABLE core.audit_chain_head ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_chain_head FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.audit_chain_head TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.audit_chain_head FROM PUBLIC;

COMMENT ON TABLE core.audit_chain_head IS
  'Tête de la chaîne de audit_audit_log (ADR-051) : dernier id et dernier hachage. Avancée par '
  'le trigger zz_audit_log_chain seulement. US-009.';

-- la tête n'avance que de 1, ne recule jamais et ne disparaît pas
CREATE FUNCTION core.audit_chain_head_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.chain = OLD.chain AND NEW.last_id = OLD.last_id + 1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'audit_chain_head: the head only moves forward by one (% refused)', TG_OP
    USING ERRCODE = 'integrity_constraint_violation',
          CONSTRAINT = 'audit_chain_head_guard';
END
$fn$;
REVOKE ALL ON FUNCTION core.audit_chain_head_guard() FROM PUBLIC;

CREATE TRIGGER audit_chain_head_guard
  BEFORE UPDATE OR DELETE ON core.audit_chain_head
  FOR EACH ROW EXECUTE FUNCTION core.audit_chain_head_guard();
CREATE TRIGGER audit_chain_head_no_truncate
  BEFORE TRUNCATE ON core.audit_chain_head
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('audit_chain_head_guard');

-- 2. Journal d'audit (17 §3.2.13) -------------------------------------------------------------
CREATE TABLE core.audit_audit_log (
  id                  bigint      CONSTRAINT audit_log_pkey PRIMARY KEY,  -- attribué par la chaîne
  at                  timestamptz NOT NULL,                               -- platform.now(), forcé
  actor_user_id       uuid,                                               -- NULL = système
  actor_role          text        NOT NULL
    CONSTRAINT audit_log_actor_role_format CHECK (actor_role ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  action_code         text        NOT NULL
    CONSTRAINT audit_log_action_code_format CHECK (action_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  subject_type        text        NOT NULL
    CONSTRAINT audit_log_subject_type_format CHECK (subject_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  subject_id          uuid        NOT NULL,
  -- références et valeurs C0 / C1 seulement (17 §3.1.3 point 3, VERIF_14-F14)
  before              jsonb
    CONSTRAINT audit_log_before_object CHECK (pg_catalog.jsonb_typeof(before) = 'object'),
  after               jsonb
    CONSTRAINT audit_log_after_object CHECK (pg_catalog.jsonb_typeof(after) = 'object'),
  reason              text
    CONSTRAINT audit_log_reason_length CHECK (pg_catalog.char_length(reason) BETWEEN 1 AND 1000),
  -- IP de l'acteur [C2], chiffrée avec la clé du sujet acteur (enveloppe v1 : 0x01 || nonce 12 ||
  -- texte chiffré || étiquette 16, AES-256-GCM, ADR-051)
  ip_enc              bytea
    CONSTRAINT audit_log_ip_envelope CHECK (
      pg_catalog.octet_length(ip_enc) >= 29
      AND substring(ip_enc FROM 1 FOR 1) = pg_catalog.decode('01', 'hex')),
  ip_key_subject_type text,
  ip_key_subject_id   uuid,
  -- KMS indisponible et clé absente du cache : ligne écrite quand même, sans la donnée C2
  -- (17 §3.1.3 point 9)
  c2_withheld         boolean     NOT NULL DEFAULT false,
  request_id          uuid,
  prev_hash           bytea       NOT NULL
    CONSTRAINT audit_log_prev_hash_size CHECK (pg_catalog.octet_length(prev_hash) = 32),
  hash                bytea       NOT NULL
    CONSTRAINT audit_log_hash_size CHECK (pg_catalog.octet_length(hash) = 32),
  CONSTRAINT audit_log_ip_key_complete CHECK (
    (ip_enc IS NULL) = (ip_key_subject_type IS NULL)
    AND (ip_key_subject_type IS NULL) = (ip_key_subject_id IS NULL)),
  -- la clé est celle du sujet ACTEUR (17 §3.2.13 : « ip_enc [C2] (clé du sujet acteur) »)
  CONSTRAINT audit_log_ip_key_is_actor CHECK (
    ip_key_subject_type IS NULL
    OR (ip_key_subject_type = 'USER' AND ip_key_subject_id = actor_user_id)),
  CONSTRAINT audit_log_withheld_has_no_ip CHECK (NOT (c2_withheld AND ip_enc IS NOT NULL)),
  CONSTRAINT audit_log_ip_key_fk FOREIGN KEY (ip_key_subject_type, ip_key_subject_id)
    REFERENCES core.audit_subject_key (subject_type, subject_id)
);

CREATE INDEX audit_log_subject_idx ON core.audit_audit_log (subject_type, subject_id);

ALTER TABLE core.audit_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.audit_audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.audit_audit_log TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.audit_audit_log FROM PUBLIC;

COMMENT ON TABLE core.audit_audit_log IS
  'AUD audit_log (17 §3.2.13, 16 ADM-001). Ajout seul, chaîné par SHA-256 (ADR-051). Classe A. US-009.';

-- 3. Forme canonique v1 (ADR-051) --------------------------------------------------------------
-- Champ : `<octets UTF-8>:<texte>` ; NULL : `~`. Chaque ligne `nom=champ`, terminée par LF.
CREATE FUNCTION core.audit_canon(v text)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN v IS NULL THEN '~'
           ELSE pg_catalog.octet_length(pg_catalog.convert_to(v, 'UTF8'))::text || ':' || v
         END
$fn$;
REVOKE ALL ON FUNCTION core.audit_canon(text) FROM PUBLIC;

CREATE FUNCTION core.audit_log_canonical(r core.audit_audit_log)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT 'rueda.audit_log.v1' || E'\n'
      || 'id='                  || core.audit_canon(r.id::text) || E'\n'
      || 'at_us='               || core.audit_canon(
                                     ((EXTRACT(epoch FROM r.at) * 1000000)::bigint)::text) || E'\n'
      || 'actor_user_id='       || core.audit_canon(r.actor_user_id::text) || E'\n'
      || 'actor_role='          || core.audit_canon(r.actor_role) || E'\n'
      || 'action_code='         || core.audit_canon(r.action_code) || E'\n'
      || 'subject_type='        || core.audit_canon(r.subject_type) || E'\n'
      || 'subject_id='          || core.audit_canon(r.subject_id::text) || E'\n'
      || 'before='              || core.audit_canon(r.before::text) || E'\n'
      || 'after='               || core.audit_canon(r.after::text) || E'\n'
      || 'reason='              || core.audit_canon(r.reason) || E'\n'
      || 'ip_enc='              || core.audit_canon(pg_catalog.encode(r.ip_enc, 'hex')) || E'\n'
      || 'ip_key_subject_type=' || core.audit_canon(r.ip_key_subject_type) || E'\n'
      || 'ip_key_subject_id='   || core.audit_canon(r.ip_key_subject_id::text) || E'\n'
      || 'c2_withheld='         || core.audit_canon(CASE WHEN r.c2_withheld THEN 'true' ELSE 'false' END) || E'\n'
      || 'request_id='          || core.audit_canon(r.request_id::text) || E'\n'
      || 'prev_hash='           || core.audit_canon(pg_catalog.encode(r.prev_hash, 'hex')) || E'\n'
$fn$;
REVOKE ALL ON FUNCTION core.audit_log_canonical(core.audit_audit_log) FROM PUBLIC;

COMMENT ON FUNCTION core.audit_log_canonical(core.audit_audit_log) IS
  'Forme canonique v1 d''une ligne d''audit (ADR-051), hachée par zz_audit_log_chain. US-009.';

-- 4. Trigger de chaîne --------------------------------------------------------------------------
CREATE FUNCTION core.audit_log_chain()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  head      record;
  destroyed timestamptz;
BEGIN
  -- une donnée C2 ne s'écrit jamais avec la clé d'un sujet effacé (17 §3.1.3 point 2) ; FOR SHARE
  -- sérialise avec une destruction concurrente
  IF NEW.ip_key_subject_type IS NOT NULL THEN
    SELECT k.destroyed_at INTO destroyed
      FROM core.audit_subject_key k
     WHERE k.subject_type = NEW.ip_key_subject_type AND k.subject_id = NEW.ip_key_subject_id
       FOR SHARE;
    IF FOUND AND destroyed IS NOT NULL THEN
      RAISE EXCEPTION 'audit_log: subject key destroyed'
        USING ERRCODE = 'integrity_constraint_violation',
              CONSTRAINT = 'audit_log_key_destroyed';
    END IF;
  END IF;

  SELECT h.last_id, h.last_hash INTO head
    FROM core.audit_chain_head h
   WHERE h.chain = 'audit_log'
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'audit_log: chain head missing'
      USING ERRCODE = 'integrity_constraint_violation',
            CONSTRAINT = 'audit_chain_head_guard';
  END IF;

  NEW.id        := head.last_id + 1;
  NEW.at        := platform.now();
  NEW.prev_hash := head.last_hash;
  NEW.hash      := pg_catalog.sha256(pg_catalog.convert_to(core.audit_log_canonical(NEW), 'UTF8'));

  UPDATE core.audit_chain_head
     SET last_id = NEW.id, last_hash = NEW.hash
   WHERE chain = 'audit_log';
  RETURN NEW;
END
$fn$;

COMMENT ON FUNCTION core.audit_log_chain() IS
  'Trigger BEFORE INSERT : id, at, prev_hash, hash de la chaîne d''audit (ADR-051). SECURITY '
  'DEFINER : lit et avance core.audit_chain_head, invisible des rôles applicatifs. US-009.';
REVOKE ALL ON FUNCTION core.audit_log_chain() FROM PUBLIC;

-- « zz_ » : dernier trigger BEFORE INSERT (ordre alphabétique), donc la ligne hachée est la ligne
-- écrite. Un trigger ajouté plus tard ne doit pas trier après lui (revue architecture).
CREATE TRIGGER zz_audit_log_chain
  BEFORE INSERT ON core.audit_audit_log
  FOR EACH ROW EXECUTE FUNCTION core.audit_log_chain();
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON core.audit_audit_log
  FOR EACH ROW EXECUTE FUNCTION core.audit_append_only('audit_log_append_only');
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON core.audit_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('audit_log_append_only');
