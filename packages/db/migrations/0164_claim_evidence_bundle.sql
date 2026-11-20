-- 0164 — CLM : dossier de preuve d'un trip, manifeste scellé, export par l'ops (bêta).
-- US-308 ; 19 US-308 (« Given un trip terminé, When l'export est généré, Then le manifeste liste
-- chaque fichier avec son SHA-256 et chaque empreinte correspond » ; « Given 40 photos, contrat,
-- constancia et messages, When l'export est demandé, Then prêt en ≤ 10 min, lien expirant après
-- 7 j (seuils PROPOSÉS) ») ; 16 CLM-034 (contrat et constancia, versions des CGU acceptées, photos
-- de départ et de retour avec heure serveur et SHA-256, messages, journal d'événements du trip ;
-- « pièce manquante → listée comme absente dans le manifeste » ; états REQUESTED → READY → EXPIRED ;
-- `EVIDENCE_EXPORT_FAILED` ; bêta SIMPLIFIÉ : « export ZIP (photos, contrat, messages, journal)
-- sans PDF mis en page, généré à la demande par l'ops »), BKG-018 (« Given une signature, When le
-- dossier CLM-034 est exporté, Then horodatage, IP et empreinte y figurent ») ; 17 §3.2.11
-- (`evidence_bundle` : manifest, manifest_sha256, export_file_id, generated_at, purpose ACODECO,
-- CHARGEBACK, INSURER, DISPUTE), §3.2.13 (`file_asset`, `data_access_log`), §2.3 (`data.export`
-- OPS « lim. : C2 de sa file » ; `kyc.read_sensitive` : jamais dans le dossier) ; pré-mortem du
-- lot 3 : L3-PM-04, L3-PM-06, L3-PM-47, L3-PM-50 ; ADR-184 (cette migration). Appliquée sous
-- `migrator`, en une transaction.
--
-- Principes (ADR-184, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - le dossier est demandé par l'OPS seulement (bêta SIMPLIFIÉ de CLM-034) : permission
--     `evidence.export` (OPS_AGENT, ADMIN) dans le pays du DOSSIER DE SUPPORT qui le justifie,
--     dossier OUVERT (OPEN, PENDING) rattaché à CE trip et assigné à l'agent (ADMIN : tout dossier
--     de son pays), session élevée par TOTP, garde de séparation des tâches (ADR-122) ; motif
--     (10 à 500 caractères) au journal d'accès. Aucun hôte, aucun voyageur, aucun co-hôte n'a de
--     commande : l'export par un autre hôte (RT-L3-D03) n'a pas de chemin. Le partage avec le
--     voyageur (CLM-006, étape 3) reste un geste de l'ops ; l'accès des parties à leur propre
--     dossier (16 CLM-034 « Permissions ») est une suite ;
--   - MANIFESTE construit par la base au moment de la demande, à partir des seuls registres (jamais
--     d'une valeur reçue) : trip (référence, pays, période, état), contrat (versions, empreinte du
--     PDF, signature : heure serveur, méthode, empreinte présentée, sceau ; IP et user-agent « non
--     enregistrés » en bêta, ADR-143), versions des CGU acceptées par les deux parties avant la
--     réservation, séries de photos des deux côtés (angle, empreinte SHA-256 de `file_asset`, taille,
--     heure de réception serveur, heure de l'appareil indicative, écart d'horloge, reprises
--     comprises), journal d'état du trip (heure serveur, transitions, motif, rôle) ; chaque pièce
--     manquante est listée dans `absent` (contrat non généré, texte pseudonymisé, série non prise,
--     aucun fil de messages, constancia : rendue à la demande depuis les faits figés du contrat).
--     MESSAGES (US-525, 0161) : le fil du trip est un FICHIER de l'archive (`messages/messages.json`,
--     document construit par la messagerie : texte reçu, gardé comme preuve et jamais servi aux
--     parties, texte masqué servi, rôle de l'auteur, heure serveur, signaux et leurs codes) ; le
--     manifeste n'en porte que l'empreinte SHA-256 et les comptes (messages, signalés) ; le texte
--     n'est jamais copié dans le registre du dossier. Aucune donnée personnelle en clair : identifiants
--     techniques, codes, empreintes, heures (C1) ; jamais un nom, une plaque, un numéro de permis,
--     une image de pièce, une position (le contenu C2 est dans les fichiers, chiffrés) ;
--   - SCEAU : `manifest_sha256` = SHA-256 du texte UTF-8 du manifeste (`manifest::text`, forme
--     canonique de jsonb) ; le travailleur écrit ce texte à l'identique dans `manifest.json` de
--     l'archive. Le dossier est immuable : seules les transitions REQUESTED → READY (archive
--     déposée) et REQUESTED → FAILED (constat) sont admises, jamais de DELETE ni de TRUNCATE ;
--     EXPIRED est calculé à la lecture (`expires_at` ≤ heure serveur), jamais écrit ;
--   - ARCHIVE : le travailleur `evidence_verifier` (seul nom qui lit les clés de sujet, 0057) relit
--     chaque fichier, le déchiffre, recalcule son empreinte et la compare au manifeste (L3-PM-04 :
--     empreinte serveur des octets stockés, recalculée à l'export) ; un écart, un objet absent ou
--     une clé détruite ⇒ FAILED avec le constat (codes et identifiants, jamais un contenu) ; sinon
--     ZIP déposé en création seule (bucket PRIVATE_EVIDENCE, C2, source GENERATED, rétention
--     EVIDENCE_EXPORT), chiffré par la clé USER du DEMANDEUR (créée par l'API à la demande) : seul
--     le demandeur peut l'ouvrir. Lien valable 168 h (7 j, seuil PROPOSÉ de 19, aucun paramètre de
--     pays) depuis la génération ;
--   - TÉLÉCHARGEMENT : demandeur seulement, permission et dossier toujours valides, avant
--     l'échéance ; chaque ouverture est inscrite au journal d'accès (BULK_EXPORT) et à l'audit
--     chaîné ; un lien échu rejoué, un autre agent, un autre pays : refus journalisé ;
--   - aucun interrupteur lu ni écrit ; aucune constante de pays ; heure serveur (`platform.now()`).
--
-- Expand / contract : table, fonctions, droits et politiques AJOUTÉS ; aucune colonne existante
-- modifiée.
--
-- Retour arrière (base sans dossier) :
--   DROP FUNCTION core.support_staff_open_evidence_bundle(bytea, uuid, uuid, text),
--     core.messaging_evidence_messages(uuid, timestamptz),
--     core.support_staff_evidence_bundle(bytea, uuid, uuid),
--     core.support_staff_request_evidence_bundle(bytea, uuid, uuid, uuid, text, text),
--     core.claim_worker_fail_evidence_bundle(uuid, text, jsonb),
--     core.claim_worker_complete_evidence_bundle(uuid, uuid, text, bytea, bigint),
--     core.claim_worker_evidence_source(uuid), core.claim_worker_evidence_due(integer),
--     core.claim_evidence_export_file(uuid),
--     core.claim_evidence_record(uuid, text, uuid, text, uuid, text, uuid),
--     core.claim_evidence_manifest(uuid, uuid, text, timestamptz), core.claim_evidence_guard() ;
--   DROP TABLE core.claim_evidence_bundle ;
--   DROP POLICY cmd_hold_evidence_file_sel, cmd_hold_evidence_export_ins ON core.audit_file_asset ;
--   DROP POLICY cmd_hold_evidence_consent_sel ON core.contract_consent ;
--   REVOKE … ON core.audit_file_asset, core.contract_consent, core.booking_trip_state_log
--     FROM cmd_hold_owner (colonnes ci-dessous) ;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-308%'.

-- 1. Permission (17 §2.3 `data.export` OPS « lim. : C2 de sa file », PROPOSÉ) -----------------------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('OPS_AGENT', 'evidence.export', 'PLATFORM', '2026-11-19T00:00:00Z',
   'US-308 : dossier de preuve d''un trip (16 CLM-034 ; lim. : dossier de sa file)'),
  ('ADMIN',     'evidence.export', 'PLATFORM', '2026-11-19T00:00:00Z',
   'US-308 : dossier de preuve d''un trip (journalisé)');

-- 2. Dossiers de preuve (17 §3.2.11 `evidence_bundle`, classe A : jamais supprimés) ------------------
CREATE TABLE core.claim_evidence_bundle (
  id              uuid        NOT NULL
    CONSTRAINT claim_evidence_bundle_pkey PRIMARY KEY,
  trip_id         uuid        NOT NULL REFERENCES core.booking_trip (id),
  country_code    text        NOT NULL
    CONSTRAINT evidence_bundle_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- dossier de support qui justifie l'export (17 §2.3 : « C2 de sa file »)
  case_id         uuid        NOT NULL REFERENCES core.support_support_case (id),
  purpose         text        NOT NULL
    CONSTRAINT evidence_bundle_purpose_valid CHECK (purpose IN
      ('ACODECO', 'CHARGEBACK', 'INSURER', 'DISPUTE')),
  requested_by    uuid        NOT NULL REFERENCES core.iam_user_account (id),
  requested_role  text        NOT NULL
    CONSTRAINT evidence_bundle_role_format CHECK (requested_role ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  -- idempotence de la requête HTTP (une demande = un dossier)
  request_id      uuid        NOT NULL
    CONSTRAINT evidence_bundle_request_unique UNIQUE,
  status          text        NOT NULL DEFAULT 'REQUESTED'
    CONSTRAINT evidence_bundle_status_valid CHECK (status IN ('REQUESTED', 'READY', 'FAILED')),
  -- manifeste [C1] : identifiants, codes, empreintes, heures ; jamais une donnée nominative
  manifest        jsonb       NOT NULL
    CONSTRAINT evidence_bundle_manifest_object CHECK (pg_catalog.jsonb_typeof(manifest) = 'object'),
  manifest_sha256 bytea       NOT NULL
    CONSTRAINT evidence_bundle_manifest_sha256_size
      CHECK (pg_catalog.octet_length(manifest_sha256) = 32),
  requested_at    timestamptz NOT NULL DEFAULT platform.now(),
  generated_at    timestamptz,
  expires_at      timestamptz,
  export_file_id  uuid        REFERENCES core.audit_file_asset (id),
  export_sha256   bytea
    CONSTRAINT evidence_bundle_export_sha256_size
      CHECK (export_sha256 IS NULL OR pg_catalog.octet_length(export_sha256) = 32),
  export_bytes    bigint
    CONSTRAINT evidence_bundle_export_bytes_positive CHECK (export_bytes IS NULL OR export_bytes > 0),
  failure_code    text
    CONSTRAINT evidence_bundle_failure_code_valid CHECK (failure_code IS NULL OR failure_code IN
      ('INTEGRITY_MISMATCH', 'OBJECT_MISSING', 'KEY_UNAVAILABLE', 'RENDER_FAILED', 'TOO_LARGE')),
  -- constat [C1] : liste de {piece, ref, reason} (codes et identifiants seulement)
  findings        jsonb
    CONSTRAINT evidence_bundle_findings_array
      CHECK (findings IS NULL OR pg_catalog.jsonb_typeof(findings) = 'array'),
  CONSTRAINT evidence_bundle_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  CONSTRAINT evidence_bundle_ready_coherent CHECK (
    (status = 'READY') = (export_file_id IS NOT NULL AND export_sha256 IS NOT NULL
                          AND export_bytes IS NOT NULL AND generated_at IS NOT NULL
                          AND expires_at IS NOT NULL)),
  CONSTRAINT evidence_bundle_failed_coherent CHECK (
    (status = 'FAILED') = (failure_code IS NOT NULL AND findings IS NOT NULL)),
  CONSTRAINT evidence_bundle_expiry_after_generation CHECK (
    expires_at IS NULL OR expires_at > generated_at)
);
CREATE INDEX evidence_bundle_trip_idx ON core.claim_evidence_bundle (trip_id, requested_at);
CREATE INDEX evidence_bundle_due_idx ON core.claim_evidence_bundle (requested_at)
  WHERE status = 'REQUESTED';
COMMENT ON TABLE core.claim_evidence_bundle IS
  'CLM evidence_bundle (17 §3.2.11, 16 CLM-034) : dossier de preuve d''un trip demandé par l''ops '
  '(dossier de support, motif journalisé), manifeste scellé par la base (SHA-256 du texte), archive '
  'ZIP déposée par le travailleur evidence_verifier après recalcul de chaque empreinte ; '
  'REQUESTED → READY ou FAILED, EXPIRED calculé (168 h). Immuable. US-308 (ADR-184).';

-- 2.1 Garde : scellé ; seules REQUESTED → READY et REQUESTED → FAILED ; jamais DELETE ni TRUNCATE
CREATE FUNCTION core.claim_evidence_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'REQUESTED' AND NEW.status IN ('READY', 'FAILED')
     AND NEW.id = OLD.id AND NEW.trip_id = OLD.trip_id AND NEW.country_code = OLD.country_code
     AND NEW.case_id = OLD.case_id AND NEW.purpose = OLD.purpose
     AND NEW.requested_by = OLD.requested_by AND NEW.requested_role = OLD.requested_role
     AND NEW.request_id = OLD.request_id AND NEW.manifest = OLD.manifest
     AND NEW.manifest_sha256 = OLD.manifest_sha256 AND NEW.requested_at = OLD.requested_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'evidence bundle: % refused', TG_OP
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'claim_evidence_sealed';
END
$fn$;
COMMENT ON FUNCTION core.claim_evidence_guard() IS
  'Trigger : dossier de preuve scellé ; REQUESTED → READY ou FAILED seulement, manifeste et demande '
  'immuables ; jamais de DELETE ni de TRUNCATE. US-308 (ADR-184).';
REVOKE ALL ON FUNCTION core.claim_evidence_guard() FROM PUBLIC;
CREATE TRIGGER claim_evidence_sealed BEFORE UPDATE OR DELETE ON core.claim_evidence_bundle
  FOR EACH ROW EXECUTE FUNCTION core.claim_evidence_guard();
CREATE TRIGGER claim_evidence_no_truncate BEFORE TRUNCATE ON core.claim_evidence_bundle
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_evidence_sealed');

-- 3. RLS : aucun droit applicatif ; commandes sous cmd_hold_owner, portes sous iam_staff_owner -------
ALTER TABLE core.claim_evidence_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.claim_evidence_bundle FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.claim_evidence_bundle TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.claim_evidence_bundle FROM PUBLIC;

GRANT SELECT, INSERT ON core.claim_evidence_bundle TO cmd_hold_owner;
GRANT UPDATE (status, generated_at, expires_at, export_file_id, export_sha256, export_bytes,
              failure_code, findings)
  ON core.claim_evidence_bundle TO cmd_hold_owner;
CREATE POLICY cmd_hold_evidence_sel ON core.claim_evidence_bundle FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_evidence_ins ON core.claim_evidence_bundle FOR INSERT TO cmd_hold_owner
  WITH CHECK (status = 'REQUESTED' AND export_file_id IS NULL AND failure_code IS NULL);
-- USING (true) : SELECT … FOR UPDATE applique aussi la condition USING de la politique UPDATE ; la
-- transition elle-même est imposée par le déclencheur claim_evidence_sealed
CREATE POLICY cmd_hold_evidence_upd ON core.claim_evidence_bundle FOR UPDATE TO cmd_hold_owner
  USING (true) WITH CHECK (status IN ('READY', 'FAILED'));
-- portes du staff : lecture du dossier (jamais d'écriture directe)
GRANT SELECT ON core.claim_evidence_bundle TO iam_staff_owner;
CREATE POLICY iam_staff_evidence_sel ON core.claim_evidence_bundle FOR SELECT TO iam_staff_owner
  USING (true);

-- 3.1 Lectures de cmd_hold_owner pour le manifeste (au plus juste)
-- fichiers de preuve : type, taille, empreinte enregistrée, emplacement (jamais le contenu)
GRANT SELECT (id, bucket, storage_key, mime, bytes, sha256, enc_subject_type, enc_subject_id)
  ON core.audit_file_asset TO cmd_hold_owner;
CREATE POLICY cmd_hold_evidence_file_sel ON core.audit_file_asset FOR SELECT TO cmd_hold_owner
  USING (bucket = 'PRIVATE_EVIDENCE');
-- archive du dossier : PRIVATE_EVIDENCE, C2, générée, chiffrée par la clé USER du demandeur
CREATE POLICY cmd_hold_evidence_export_ins ON core.audit_file_asset FOR INSERT TO cmd_hold_owner
  WITH CHECK (bucket = 'PRIVATE_EVIDENCE' AND classification = 'C2' AND source = 'GENERATED'
              AND retention_class = 'EVIDENCE_EXPORT' AND mime = 'application/zip'
              AND enc_subject_type = 'USER' AND enc_subject_id IS NOT NULL
              AND enc_subject_id = uploader_user_id);
-- versions des CGU acceptées (jamais l'IP ni le user-agent chiffrés)
GRANT SELECT (user_id, doc_kind, doc_version, locale, accepted, accepted_at, context)
  ON core.contract_consent TO cmd_hold_owner;
CREATE POLICY cmd_hold_evidence_consent_sel ON core.contract_consent FOR SELECT
  TO cmd_hold_owner USING (true);
-- journal d'état du trip : motif et rôle de chaque transition (jamais l'identifiant de la personne)
GRANT SELECT (id, reason_code, actor_role) ON core.booking_trip_state_log TO cmd_hold_owner;

-- 3.2 Fil de messages du trip (propriétaire messaging_cmd_owner, qui lit déjà ses tables, 0161) :
-- document JSON canonique (texte de jsonb), mêmes données ⇒ même texte ⇒ même empreinte ; aucune
-- ligne s'il n'y a pas de fil. Le fil est BORNÉ à l'heure du scellé (`p_until` = `sealedAt`) : un
-- message, un signal ou un masquage postérieur au scellé n'entre pas dans le document (sinon la
-- relecture par le travailleur donnerait un faux écart) ; la décision de l'ops sur un signal
-- (`outcome`, posée plus tard) n'y figure pas. EXECUTE cmd_hold_owner (manifeste et sources du
-- travailleur) seulement.
GRANT CREATE ON SCHEMA core TO messaging_cmd_owner;
SET LOCAL ROLE messaging_cmd_owner;

CREATE FUNCTION core.messaging_evidence_messages(p_trip_id uuid, p_until timestamptz)
  RETURNS TABLE (thread_id uuid, document text, message_count integer, flagged_count integer)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.id,
         pg_catalog.jsonb_build_object(
           'schema', 'clm.evidence.messages/1',
           'threadId', t.id,
           'tripId', t.trip_id,
           'messages', COALESCE((
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'id', m.id,
                      'sentAt', pg_catalog.to_char(m.sent_at AT TIME ZONE 'UTC',
                                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'authorRole', m.author_role,
                      'channel', m.channel_origin,
                      'status', m.status,
                      'hiddenAt', CASE WHEN m.hidden_at <= p_until THEN
                                    pg_catalog.to_char(m.hidden_at AT TIME ZONE 'UTC',
                                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
                      'body', m.body,
                      'bodyMasked', m.body_masked,
                      'flags', COALESCE((
                        SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'kind', f.kind, 'matched', pg_catalog.to_jsonb(f.matched),
                                 'createdAt', pg_catalog.to_char(f.created_at AT TIME ZONE 'UTC',
                                                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
                               ORDER BY f.kind)
                          FROM core.messaging_message_flag AS f
                         WHERE f.message_id = m.id AND f.created_at <= p_until), '[]'::jsonb))
                    ORDER BY m.sent_at, m.id)
               FROM core.messaging_message AS m
              WHERE m.thread_id = t.id AND m.sent_at <= p_until), '[]'::jsonb))::text,
         (SELECT pg_catalog.count(*)::integer FROM core.messaging_message AS m
           WHERE m.thread_id = t.id AND m.sent_at <= p_until),
         (SELECT pg_catalog.count(*)::integer FROM core.messaging_message AS m
           WHERE m.thread_id = t.id AND m.sent_at <= p_until AND m.status = 'FLAGGED')
    FROM core.messaging_message_thread AS t
   WHERE t.trip_id = p_trip_id AND p_until IS NOT NULL AND t.created_at <= p_until
$fn$;
COMMENT ON FUNCTION core.messaging_evidence_messages(uuid, timestamptz) IS
  'Fil de messages d''un trip pour le dossier de preuve (US-308) : texte reçu (preuve, jamais servi '
  'aux parties) et texte masqué, rôle, heure serveur, signaux (codes) ; document JSON canonique et '
  'comptes, borné à l''heure du scellé. EXECUTE cmd_hold_owner seulement. US-308 (ADR-184).';
REVOKE ALL ON FUNCTION core.messaging_evidence_messages(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.messaging_evidence_messages(uuid, timestamptz) TO cmd_hold_owner;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM messaging_cmd_owner;

-- 4. Fonctions (cmd_hold_owner) -----------------------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 4.1 Manifeste d'un trip (SECURITY INVOKER, interne) : registres seulement, ordre déterministe.
CREATE FUNCTION core.claim_evidence_manifest(p_trip_id uuid, p_bundle_id uuid, p_purpose text,
                                             p_sealed_at timestamptz)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t          record;
  v_contract jsonb;
  v_terms    jsonb;
  v_insp     jsonb;
  v_events   jsonb;
  v_files    jsonb;
  v_absent   jsonb := '[]'::jsonb;
  v_side     record;
  v_msg      record;
BEGIN
  SELECT tr.id, tr.public_ref, tr.country_code, tr.currency, tr.timezone, tr.status,
         tr.scheduled_start, tr.scheduled_end, tr.booked_at, tr.guest_user_id,
         o.holder_user_id
    INTO t
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
   WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- contrat : chaque version, empreinte du PDF, signature du voyageur (16 BKG-018)
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'version', d.version,
           'documentId', d.id,
           'generatedAt', pg_catalog.to_char(d.generated_at AT TIME ZONE 'UTC',
                                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'renderer', d.renderer_version,
           'sha256', pg_catalog.encode(d.sha256, 'hex'),
           'draft', tpl.legal_review_ref IS NULL,
           'textErased', p.pseudonymized_at IS NOT NULL OR p.document_id IS NULL,
           'file', CASE WHEN p.document_id IS NOT NULL AND p.pseudonymized_at IS NULL
                        THEN pg_catalog.format('contract/contract-v%s.pdf', d.version) END,
           'signature', CASE WHEN s.id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
             'signerRole', s.signer_role,
             'method', s.method,
             'signedAt', pg_catalog.to_char(s.signed_at AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'documentSha256', pg_catalog.encode(s.document_sha256, 'hex'),
             'sealSha256', pg_catalog.encode(s.seal_sha256, 'hex'),
             -- bêta : IP et user-agent retenus (ADR-143) ; jamais rendus en clair ici
             'ip', CASE WHEN s.c2_withheld THEN 'NOT_RECORDED' ELSE 'RECORDED_ENCRYPTED' END,
             'userAgent', CASE WHEN s.c2_withheld THEN 'NOT_RECORDED'
                               ELSE 'RECORDED_ENCRYPTED' END) END)
         ORDER BY d.version)
    INTO v_contract
    FROM core.contract_generated_document AS d
    JOIN core.contract_document_template AS tpl ON tpl.id = d.template_id
    LEFT JOIN core.contract_document_party AS p ON p.document_id = d.id
    LEFT JOIN core.contract_signature AS s
      ON s.document_id = d.id AND s.signer_user_id = t.guest_user_id AND s.signer_role = 'GUEST'
   WHERE d.trip_id = t.id;
  IF v_contract IS NULL THEN
    v_absent := v_absent || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('piece', 'CONTRACT', 'reason', 'NOT_GENERATED'));
  ELSE
    v_absent := v_absent || COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'piece', 'CONTRACT_TEXT', 'version', (c ->> 'version')::integer,
               'reason', 'PSEUDONYMIZED') ORDER BY (c ->> 'version')::integer)
        FROM pg_catalog.jsonb_array_elements(v_contract) AS c
       WHERE (c ->> 'textErased')::boolean), '[]'::jsonb);
  END IF;
  -- constancia : attestation rendue à la demande depuis les faits figés du contrat (US-212)
  v_absent := v_absent || pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('piece', 'CONSTANCIA', 'reason', 'RENDERED_ON_DEMAND'));

  -- versions des CGU acceptées par les deux parties à la réservation (dernière par document)
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'party', x.party, 'docKind', x.doc_kind, 'version', x.doc_version,
           'locale', x.locale, 'context', x.context,
           'acceptedAt', pg_catalog.to_char(x.accepted_at AT TIME ZONE 'UTC',
                                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
         ORDER BY x.party, x.doc_kind)
    INTO v_terms
    FROM (
      SELECT DISTINCT ON (p.party, c.doc_kind)
             p.party, c.doc_kind, c.doc_version, c.locale, c.context, c.accepted_at
        FROM (VALUES ('GUEST', t.guest_user_id), ('HOST', t.holder_user_id)) AS p(party, user_id)
        JOIN core.contract_consent AS c ON c.user_id = p.user_id
       WHERE c.accepted
         AND c.accepted_at <= t.booked_at
         AND c.doc_kind IN ('TOS_GUEST', 'TOS_HOST', 'PRIVACY', 'DAMAGE_TERMS',
                            'CANCELLATION_POLICY')
       ORDER BY p.party, c.doc_kind, c.accepted_at DESC, c.doc_version DESC
    ) AS x;

  -- séries de photos : chaque photo (reprises comprises), empreinte enregistrée de file_asset
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'kind', i.kind,
           'side', i.performer_role,
           'status', i.status,
           'templateVersion', i.template_version,
           'createdAt', pg_catalog.to_char(i.created_at AT TIME ZONE 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'submittedAt', pg_catalog.to_char(i.submitted_at AT TIME ZONE 'UTC',
                                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'photos', COALESCE((
             SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'slot', ph.slot_code,
                      'fileId', ph.file_id,
                      'sha256', pg_catalog.encode(f.sha256, 'hex'),
                      'bytes', f.bytes,
                      'mime', f.mime,
                      'receivedAt', pg_catalog.to_char(ph.received_at AT TIME ZONE 'UTC',
                                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'deviceCapturedAt', pg_catalog.to_char(
                        ph.device_captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                      'clockSkewFlag', ph.clock_skew_flag,
                      -- copie de la série ≠ registre des fichiers : constat du travailleur
                      'registryMismatch', ph.sha256 <> f.sha256 OR ph.bytes <> f.bytes,
                      'current', NOT EXISTS (
                        SELECT 1 FROM core.trip_ops_inspection_photo AS n
                         WHERE n.inspection_id = ph.inspection_id AND n.slot_code = ph.slot_code
                           AND (n.received_at, n.file_id) > (ph.received_at, ph.file_id)),
                      'path', pg_catalog.format('photos/%s/%s/%s-%s-%s.%s', i.kind,
                                                i.performer_role,
                                                pg_catalog.lpad(sl.position::text, 2, '0'),
                                                ph.slot_code, ph.file_id,
                                                CASE f.mime WHEN 'image/webp' THEN 'webp'
                                                            ELSE 'jpg' END))
                    ORDER BY sl.position, ph.received_at, ph.file_id)
               FROM core.trip_ops_inspection_photo AS ph
               JOIN core.audit_file_asset AS f ON f.id = ph.file_id
               JOIN core.trip_ops_photo_slot AS sl
                 ON sl.template_version = i.template_version AND sl.slot_code = ph.slot_code
              WHERE ph.inspection_id = i.id), '[]'::jsonb))
         ORDER BY CASE i.kind WHEN 'CHECKIN' THEN 1 ELSE 2 END, i.performer_role)
    INTO v_insp
    FROM core.trip_ops_inspection AS i
   WHERE i.trip_id = t.id;
  FOR v_side IN
    SELECT k.kind, r.side
      FROM (VALUES ('CHECKIN', 1), ('CHECKOUT', 2)) AS k(kind, n)
      CROSS JOIN (VALUES ('GUEST'), ('HOST')) AS r(side)
     WHERE NOT EXISTS (SELECT 1 FROM core.trip_ops_inspection AS i
                        WHERE i.trip_id = t.id AND i.kind = k.kind AND i.performer_role = r.side
                          AND i.status = 'SUBMITTED')
     ORDER BY k.n, r.side
  LOOP
    v_absent := v_absent || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'piece', 'INSPECTION', 'kind', v_side.kind, 'side', v_side.side, 'reason', 'NOT_SUBMITTED'));
  END LOOP;
  -- fil de messages (US-525) : un fichier de l'archive ; le manifeste n'en porte que l'empreinte
  SELECT x.thread_id, x.document, x.message_count, x.flagged_count INTO v_msg
    FROM core.messaging_evidence_messages(t.id, p_sealed_at) AS x;
  IF v_msg.thread_id IS NULL THEN
    v_absent := v_absent || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('piece', 'MESSAGES', 'reason', 'NO_THREAD'));
  END IF;

  -- journal d'état du trip (heure serveur ; rôle, jamais la personne)
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'at', pg_catalog.to_char(l.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'from', l.from_status, 'to', l.to_status, 'kind', l.kind,
           'reason', l.reason_code, 'actorRole', l.actor_role)
         ORDER BY l.at, l.id)
    INTO v_events
    FROM core.booking_trip_state_log AS l
   WHERE l.trip_id = t.id;

  -- fichiers de l'archive : contrat (PDF rendu à l'identique) puis photos
  SELECT pg_catalog.jsonb_agg(e.item ORDER BY e.ord, e.path)
    INTO v_files
    FROM (
      SELECT 1 AS ord, c ->> 'file' AS path,
             pg_catalog.jsonb_build_object('path', c ->> 'file', 'kind', 'CONTRACT',
                                           'ref', c -> 'documentId', 'sha256', c -> 'sha256')
               AS item
        FROM pg_catalog.jsonb_array_elements(COALESCE(v_contract, '[]'::jsonb)) AS c
       WHERE c ->> 'file' IS NOT NULL
      UNION ALL
      SELECT 2, 'messages/messages.json',
             pg_catalog.jsonb_build_object(
               'path', 'messages/messages.json', 'kind', 'MESSAGES', 'ref', v_msg.thread_id,
               'sha256', pg_catalog.encode(pg_catalog.sha256(
                           pg_catalog.convert_to(v_msg.document, 'UTF8')), 'hex'))
       WHERE v_msg.thread_id IS NOT NULL
      UNION ALL
      SELECT 3, ph ->> 'path',
             pg_catalog.jsonb_build_object('path', ph ->> 'path', 'kind', 'PHOTO',
                                           'ref', ph -> 'fileId', 'sha256', ph -> 'sha256',
                                           'bytes', ph -> 'bytes')
        FROM pg_catalog.jsonb_array_elements(COALESCE(v_insp, '[]'::jsonb)) AS i,
             pg_catalog.jsonb_array_elements(i -> 'photos') AS ph
    ) AS e;

  RETURN pg_catalog.jsonb_build_object(
    'schema', 'clm.evidence/1',
    'bundleId', p_bundle_id,
    'purpose', p_purpose,
    'sealedAt', pg_catalog.to_char(p_sealed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'trip', pg_catalog.jsonb_build_object(
      'id', t.id, 'ref', t.public_ref, 'country', t.country_code, 'currency', t.currency,
      'timezone', t.timezone, 'status', t.status,
      'scheduledStart', pg_catalog.to_char(t.scheduled_start AT TIME ZONE 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'scheduledEnd', pg_catalog.to_char(t.scheduled_end AT TIME ZONE 'UTC',
                                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'bookedAt', pg_catalog.to_char(t.booked_at AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'contract', COALESCE(v_contract, '[]'::jsonb),
    'terms', COALESCE(v_terms, '[]'::jsonb),
    'inspections', COALESCE(v_insp, '[]'::jsonb),
    'events', COALESCE(v_events, '[]'::jsonb),
    'messages', CASE WHEN v_msg.thread_id IS NULL THEN NULL ELSE pg_catalog.jsonb_build_object(
      'threadId', v_msg.thread_id, 'count', v_msg.message_count,
      'flagged', v_msg.flagged_count) END,
    'files', COALESCE(v_files, '[]'::jsonb),
    'absent', v_absent);
END
$fn$;
COMMENT ON FUNCTION core.claim_evidence_manifest(uuid, uuid, text, timestamptz) IS
  'Interne : manifeste du dossier de preuve d''un trip, lu dans les seuls registres (contrat et '
  'signature, CGU acceptées, séries de photos et empreintes de file_asset, journal d''état, empreinte '
  'et comptes du fil de messages), pièces absentes listées ; aucune donnée nominative. US-308 '
  '(ADR-184).';

-- 4.2 Enregistrement d'un dossier demandé (porte du staff seulement). Issues : RECORDED (dossier
-- scellé), ALREADY_RECORDED (même requête du même agent sur le même trip : le dossier d'origine),
-- REQUEST_CONFLICT (identifiant de requête déjà pris par une autre demande), NOT_FOUND (trip).
CREATE FUNCTION core.claim_evidence_record(p_trip_id uuid, p_country text, p_case_id uuid,
                                           p_purpose text, p_requested_by uuid,
                                           p_requested_role text, p_request_id uuid)
  RETURNS TABLE (outcome text, bundle_id uuid, status text, manifest_sha256 text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_prev     record;
  v_id       uuid := platform.uuid_v7();
  v_now      timestamptz := platform.now();
  v_manifest jsonb;
  v_sha      bytea;
BEGIN
  IF p_trip_id IS NULL OR p_country IS NULL OR p_case_id IS NULL OR p_purpose IS NULL
     OR p_requested_by IS NULL OR p_requested_role IS NULL OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'evidence bundle: input invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT b.id, b.trip_id, b.requested_by, b.status, b.manifest_sha256 INTO v_prev
    FROM core.claim_evidence_bundle AS b WHERE b.request_id = p_request_id;
  IF v_prev.id IS NOT NULL THEN
    IF v_prev.trip_id = p_trip_id AND v_prev.requested_by = p_requested_by THEN
      RETURN QUERY SELECT 'ALREADY_RECORDED'::text, v_prev.id, v_prev.status,
                          pg_catalog.encode(v_prev.manifest_sha256, 'hex');
    ELSE
      RETURN QUERY SELECT 'REQUEST_CONFLICT'::text, NULL::uuid, NULL::text, NULL::text;
    END IF;
    RETURN;
  END IF;
  v_manifest := core.claim_evidence_manifest(p_trip_id, v_id, p_purpose, v_now);
  IF v_manifest IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  v_sha := pg_catalog.sha256(pg_catalog.convert_to(v_manifest::text, 'UTF8'));
  INSERT INTO core.claim_evidence_bundle
         (id, trip_id, country_code, case_id, purpose, requested_by, requested_role, request_id,
          manifest, manifest_sha256, requested_at)
  VALUES (v_id, p_trip_id, p_country, p_case_id, p_purpose, p_requested_by, p_requested_role,
          p_request_id, v_manifest, v_sha, v_now);
  RETURN QUERY SELECT 'RECORDED'::text, v_id, 'REQUESTED'::text, pg_catalog.encode(v_sha, 'hex');
END
$fn$;
COMMENT ON FUNCTION core.claim_evidence_record(uuid, text, uuid, text, uuid, text, uuid) IS
  'Dossier de preuve demandé : manifeste construit et scellé par la base (SHA-256 du texte), état '
  'REQUESTED ; idempotent par identifiant de requête. EXECUTE iam_staff_owner (porte du staff) '
  'seulement. US-308 (ADR-184).';

-- 4.3 Archive d'un dossier prêt (porte de téléchargement seulement) : emplacement et empreinte.
CREATE FUNCTION core.claim_evidence_export_file(p_bundle_id uuid)
  RETURNS TABLE (file_id uuid, storage_key text, sha256 text, bytes bigint, enc_subject_id uuid)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT f.id, f.storage_key, pg_catalog.encode(f.sha256, 'hex'), f.bytes, f.enc_subject_id
    FROM core.claim_evidence_bundle AS b
    JOIN core.audit_file_asset AS f ON f.id = b.export_file_id
   WHERE b.id = p_bundle_id AND b.status = 'READY'
$fn$;
COMMENT ON FUNCTION core.claim_evidence_export_file(uuid) IS
  'Archive d''un dossier de preuve prêt (fichier, clé de stockage, empreinte, taille, sujet de la '
  'clé). '
  'EXECUTE iam_staff_owner (porte de téléchargement) seulement. US-308 (ADR-184).';

-- 4.4 Travailleur evidence_verifier : dossiers à générer (les plus anciens d'abord)
CREATE FUNCTION core.claim_worker_evidence_due(p_limit integer)
  RETURNS TABLE (bundle_id uuid)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'evidence_verifier' THEN
    RAISE EXCEPTION 'evidence bundle: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'evidence_command_forbidden';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'evidence bundle: limit invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT b.id FROM core.claim_evidence_bundle AS b
   WHERE b.status = 'REQUESTED'
   ORDER BY b.requested_at, b.id
   LIMIT p_limit;
END
$fn$;
COMMENT ON FUNCTION core.claim_worker_evidence_due(integer) IS
  'Travailleur evidence_verifier : dossiers de preuve REQUESTED, les plus anciens d''abord. EXECUTE '
  'app_worker. US-308 (ADR-184).';

-- 4.5 Travailleur : sources d'un dossier (verrou du dossier, manifeste scellé à l'octet, demandeur,
-- texte figé des versions du contrat à rendre). Issues : OK, LOCKED (pris par un autre passage),
-- NOT_DUE (déjà READY / FAILED, inconnu).
CREATE FUNCTION core.claim_worker_evidence_source(p_bundle_id uuid)
  RETURNS TABLE (outcome text, manifest text, manifest_sha256 text, requested_by uuid,
                 contracts jsonb, messages text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  b record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'evidence_verifier' THEN
    RAISE EXCEPTION 'evidence bundle: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'evidence_command_forbidden';
  END IF;
  IF p_bundle_id IS NULL THEN
    RAISE EXCEPTION 'evidence bundle: input invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.id, x.trip_id, x.status, x.manifest, x.manifest_sha256, x.requested_by, x.requested_at
    INTO b
    FROM core.claim_evidence_bundle AS x WHERE x.id = p_bundle_id
     FOR UPDATE SKIP LOCKED;
  IF b.id IS NULL THEN
    RETURN QUERY SELECT CASE WHEN EXISTS (SELECT 1 FROM core.claim_evidence_bundle AS y
                                           WHERE y.id = p_bundle_id AND y.status = 'REQUESTED')
                             THEN 'LOCKED' ELSE 'NOT_DUE' END::text,
                        NULL::text, NULL::text, NULL::uuid, NULL::jsonb, NULL::text;
    RETURN;
  END IF;
  IF b.status <> 'REQUESTED' THEN
    RETURN QUERY SELECT 'NOT_DUE'::text, NULL::text, NULL::text, NULL::uuid, NULL::jsonb,
                        NULL::text;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'OK'::text, b.manifest::text, pg_catalog.encode(b.manifest_sha256, 'hex'), b.requested_by,
         COALESCE((
           SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'version', d.version, 'documentId', d.id, 'renderer', d.renderer_version,
                    'sha256', pg_catalog.encode(d.sha256, 'hex'), 'terms', d.terms,
                    'body', p.body)
                  ORDER BY d.version)
             FROM core.contract_generated_document AS d
             JOIN core.contract_document_party AS p ON p.document_id = d.id
            WHERE d.trip_id = b.trip_id AND p.pseudonymized_at IS NULL), '[]'::jsonb),
         (SELECT x.document
            FROM core.messaging_evidence_messages(b.trip_id, b.requested_at) AS x);
END
$fn$;
COMMENT ON FUNCTION core.claim_worker_evidence_source(uuid) IS
  'Travailleur evidence_verifier : manifeste scellé (texte exact), demandeur, texte figé des '
  'versions du contrat et document du fil de messages d''un dossier REQUESTED, verrouillé (SKIP '
  'LOCKED). EXECUTE app_worker. '
  'US-308 (ADR-184).';

-- 4.6 Travailleur : archive déposée ⇒ READY (fichier enregistré, lien de 168 h). Issues : READY,
-- NOT_DUE (déjà READY / FAILED, inconnu) ; clé de stockage hors forme ⇒ 22023.
CREATE FUNCTION core.claim_worker_complete_evidence_bundle(p_bundle_id uuid, p_file_id uuid,
                                                           p_storage_key text, p_sha256 bytea,
                                                           p_bytes bigint)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  b     record;
  v_now timestamptz := platform.now();
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'evidence_verifier' THEN
    RAISE EXCEPTION 'evidence bundle: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'evidence_command_forbidden';
  END IF;
  IF p_bundle_id IS NULL OR p_file_id IS NULL OR p_sha256 IS NULL
     OR pg_catalog.octet_length(p_sha256) <> 32 OR p_bytes IS NULL OR p_bytes <= 0
     OR p_storage_key IS DISTINCT FROM
          pg_catalog.format('evidence-bundles/%s/%s.zip', p_bundle_id, p_file_id) THEN
    RAISE EXCEPTION 'evidence bundle: input invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.id, x.status, x.requested_by INTO b
    FROM core.claim_evidence_bundle AS x WHERE x.id = p_bundle_id FOR UPDATE;
  IF b.id IS NULL OR b.status <> 'REQUESTED' THEN
    RETURN 'NOT_DUE';
  END IF;
  INSERT INTO core.audit_file_asset
         (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id, source, classification,
          retention_class, enc_subject_type, enc_subject_id)
  VALUES (p_file_id, 'PRIVATE_EVIDENCE', p_storage_key, 'application/zip', p_bytes, p_sha256,
          b.requested_by, 'GENERATED', 'C2', 'EVIDENCE_EXPORT', 'USER', b.requested_by);
  -- lien de 7 j (seuil PROPOSÉ de 19 US-308, commun aux pays)
  UPDATE core.claim_evidence_bundle AS x
     SET status = 'READY', generated_at = v_now, expires_at = v_now + interval '168 hours',
         export_file_id = p_file_id, export_sha256 = p_sha256, export_bytes = p_bytes
   WHERE x.id = b.id;
  RETURN 'READY';
END
$fn$;
COMMENT ON FUNCTION core.claim_worker_complete_evidence_bundle(uuid, uuid, text, bytea, bigint) IS
  'Travailleur evidence_verifier : archive ZIP déposée (création seule) ⇒ file_asset '
  'PRIVATE_EVIDENCE C2 GENERATED chiffré par la clé USER du demandeur, dossier READY, échéance à '
  'heure serveur + 168 h. EXECUTE app_worker. US-308 (ADR-184).';

-- 4.7 Travailleur : constat ⇒ FAILED (code, liste {piece, ref, reason} sans contenu). Issues :
-- FAILED, NOT_DUE ; code ou constat hors forme ⇒ 22023.
CREATE FUNCTION core.claim_worker_fail_evidence_bundle(p_bundle_id uuid, p_code text,
                                                       p_findings jsonb)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  b record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'evidence_verifier' THEN
    RAISE EXCEPTION 'evidence bundle: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'evidence_command_forbidden';
  END IF;
  IF p_bundle_id IS NULL OR p_code IS NULL
     OR p_code NOT IN ('INTEGRITY_MISMATCH', 'OBJECT_MISSING', 'KEY_UNAVAILABLE', 'RENDER_FAILED',
                       'TOO_LARGE')
     OR p_findings IS NULL OR pg_catalog.jsonb_typeof(p_findings) <> 'array'
     OR pg_catalog.jsonb_array_length(p_findings) NOT BETWEEN 1 AND 200
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_findings) AS f
                 WHERE pg_catalog.jsonb_typeof(f) <> 'object'
                    OR (SELECT pg_catalog.array_agg(k ORDER BY k)
                          FROM pg_catalog.jsonb_object_keys(f) AS k)
                       IS DISTINCT FROM ARRAY['piece', 'reason', 'ref']
                    OR COALESCE(f ->> 'piece', '') !~ '^[A-Z][A-Z0-9_]{1,63}$'
                    OR COALESCE(f ->> 'reason', '') !~ '^[A-Z][A-Z0-9_]{1,63}$'
                    OR COALESCE(f ->> 'ref', '') !~ '^[A-Za-z0-9/_.:-]{1,160}$') THEN
    RAISE EXCEPTION 'evidence bundle: input invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.id, x.status INTO b
    FROM core.claim_evidence_bundle AS x WHERE x.id = p_bundle_id FOR UPDATE;
  IF b.id IS NULL OR b.status <> 'REQUESTED' THEN
    RETURN 'NOT_DUE';
  END IF;
  UPDATE core.claim_evidence_bundle AS x
     SET status = 'FAILED', failure_code = p_code, findings = p_findings
   WHERE x.id = b.id;
  RETURN 'FAILED';
END
$fn$;
COMMENT ON FUNCTION core.claim_worker_fail_evidence_bundle(uuid, text, jsonb) IS
  'Travailleur evidence_verifier : constat (écart d''empreinte, objet absent, clé indisponible, '
  'rendu impossible, archive trop grande) ⇒ dossier FAILED, codes et identifiants seulement. '
  'EXECUTE app_worker. US-308 (ADR-184).';

REVOKE ALL ON FUNCTION core.claim_evidence_manifest(uuid, uuid, text, timestamptz),
  core.claim_evidence_record(uuid, text, uuid, text, uuid, text, uuid),
  core.claim_evidence_export_file(uuid),
  core.claim_worker_evidence_due(integer),
  core.claim_worker_evidence_source(uuid),
  core.claim_worker_complete_evidence_bundle(uuid, uuid, text, bytea, bigint),
  core.claim_worker_fail_evidence_bundle(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_evidence_record(uuid, text, uuid, text, uuid, text, uuid),
  core.claim_evidence_export_file(uuid) TO iam_staff_owner;
GRANT EXECUTE ON FUNCTION core.claim_worker_evidence_due(integer),
  core.claim_worker_evidence_source(uuid),
  core.claim_worker_complete_evidence_bundle(uuid, uuid, text, bytea, bigint),
  core.claim_worker_fail_evidence_bundle(uuid, text, jsonb) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 5. Portes du staff (iam_staff_owner, EXECUTE app_api) ---------------------------------------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- 5.1 Demande d'un dossier. Issues : AUTH_REQUIRED (aucune session : rien n'est écrit), MFA_REQUIRED
-- (journalisé), FORBIDDEN (permission absente ou hors pays : journalisé), CASE_REQUIRED (dossier
-- inconnu, fermé, d'un autre trip, non assigné à l'OPS : journalisé, même issue), SELF_FORBIDDEN
-- (trip qui concerne l'agent, ADR-122 : journalisé), REQUESTED (dossier scellé ; accès au journal
-- et audit chaîné), ALREADY_REQUESTED (rejeu de la même requête : rien de plus n'est écrit),
-- REQUEST_INVALID (identifiant de requête pris par une autre demande). Entrée mal formée ⇒ 22023.
CREATE FUNCTION core.support_staff_request_evidence_bundle(p_token_hash bytea, p_request_id uuid,
                                                           p_trip_id uuid, p_case_id uuid,
                                                           p_purpose text, p_reason text)
  RETURNS TABLE (outcome text, bundle_id uuid, status text, manifest_sha256 text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s      record;
  v_case   record;
  v_role   text;
  v_deny   text;
  r        record;
  v_access uuid;
  v_reason text := pg_catalog.btrim(p_reason);
BEGIN
  IF p_request_id IS NULL OR p_trip_id IS NULL OR p_case_id IS NULL OR p_purpose IS NULL
     OR p_purpose NOT IN ('ACODECO', 'CHARGEBACK', 'INSURER', 'DISPUTE')
     OR v_reason IS NULL OR pg_catalog.char_length(v_reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'dossier de preuve : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'TRIP', p_trip_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'EVIDENCE_EXPORT', 'permission', 'evidence.export',
                                   'field_or_file', 'evidence_bundle'),
                                 v_reason, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT c.country_code, c.status, c.assignee_id, c.trip_id INTO v_case
    FROM core.support_support_case AS c WHERE c.id = p_case_id;
  IF v_case.country_code IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'evidence.export', ARRAY[v_case.country_code],
                                       NULL);
  END IF;
  v_deny := CASE
    WHEN v_case.country_code IS NULL THEN 'CASE'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN v_case.trip_id IS DISTINCT FROM p_trip_id THEN 'CASE'
    WHEN v_case.status NOT IN ('OPEN', 'PENDING') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_case.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    WHEN core.support_actor_conflict(v_s.user_id, 'TRIP', p_trip_id) THEN 'SELF'
    ELSE NULL END;
  IF v_deny IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN', 'TRIP',
                                 p_trip_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_deny,
                                   'attempted', 'EVIDENCE_EXPORT', 'permission', 'evidence.export',
                                   'field_or_file', 'evidence_bundle', 'case_id', p_case_id)
                                 || CASE WHEN v_case.country_code IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                v_case.country_code) END,
                                 v_reason, p_request_id);
    RETURN QUERY SELECT CASE v_deny WHEN 'PERMISSION' THEN 'FORBIDDEN'
                                    WHEN 'SELF' THEN 'SELF_FORBIDDEN'
                                    ELSE 'CASE_REQUIRED' END::text,
                        NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  SELECT * INTO r FROM core.claim_evidence_record(p_trip_id, v_case.country_code, p_case_id,
                                                  p_purpose, v_s.user_id, v_role, p_request_id);
  IF r.outcome = 'ALREADY_RECORDED' THEN
    RETURN QUERY SELECT 'ALREADY_REQUESTED'::text, r.bundle_id, r.status, r.manifest_sha256;
    RETURN;
  END IF;
  IF r.outcome <> 'RECORDED' THEN
    -- identifiant de requête pris, ou trip disparu (impossible : clé du dossier)
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::text, NULL::text;
    RETURN;
  END IF;
  v_access := pg_catalog.gen_random_uuid();
  INSERT INTO core.audit_data_access_log
         (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
          access_kind, case_ref, request_id)
  VALUES (v_access, v_s.user_id, v_role, 'TRIP', p_trip_id,
          'evidence_bundle:' || r.bundle_id::text, v_reason, 'BULK_EXPORT', p_case_id::text,
          p_request_id);
  -- audit EN DERNIER (tête de chaîne tenue jusqu'au COMMIT)
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_DATA_ACCESS', 'TRIP', p_trip_id, NULL,
                               pg_catalog.jsonb_build_object('country', v_case.country_code,
                                 'access_kind', 'BULK_EXPORT', 'attempted', 'EVIDENCE_EXPORT',
                                 'field_or_file', 'evidence_bundle:' || r.bundle_id::text,
                                 'case_id', p_case_id, 'data_access_id', v_access,
                                 'purpose', p_purpose, 'manifest_sha256', r.manifest_sha256),
                               v_reason, p_request_id);
  RETURN QUERY SELECT 'REQUESTED'::text, r.bundle_id, r.status, r.manifest_sha256;
END
$fn$;
COMMENT ON FUNCTION core.support_staff_request_evidence_bundle(bytea, uuid, uuid, uuid, text, text) IS
  'Console : demande du dossier de preuve d''un trip (16 CLM-034) ; session élevée, evidence.export '
  'dans le pays du dossier de support OUVERT de ce trip assigné à l''agent (ADMIN : tout dossier), '
  'garde ADR-122 ; motif au journal d''accès (BULK_EXPORT) et audit chaîné ; refus journalisés. '
  'EXECUTE app_api. US-308 (ADR-184).';

-- 5.2 État d'un dossier (demandeur seulement ; aucune donnée personnelle : lecture non inscrite au
-- journal d'accès, refus journalisés). Issues : OK, AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN (dossier
-- inconnu ou permission absente dans son pays), NOT_FOUND (dossier d'un autre agent).
CREATE FUNCTION core.support_staff_evidence_bundle(p_token_hash bytea, p_request_id uuid,
                                                   p_bundle_id uuid)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  b      record;
  v_role text;
  v_deny text;
  v_now  timestamptz := platform.now();
BEGIN
  IF p_request_id IS NULL OR p_bundle_id IS NULL THEN
    RAISE EXCEPTION 'dossier de preuve : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'EVIDENCE_BUNDLE',
                                 p_bundle_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'READ', 'permission', 'evidence.export',
                                   'field_or_file', 'evidence_bundle'),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT x.* INTO b FROM core.claim_evidence_bundle AS x WHERE x.id = p_bundle_id;
  -- dossier inconnu, ou permission absente dans le pays du dossier : FORBIDDEN (même issue) ;
  -- dossier d'un autre agent, permission détenue : NOT_FOUND (le dossier n'est jamais montré)
  IF b.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'evidence.export', ARRAY[b.country_code],
                                       NULL);
  END IF;
  v_deny := CASE WHEN b.id IS NULL THEN 'NOT_FOUND'
                 WHEN v_role IS NULL THEN 'PERMISSION'
                 WHEN b.requested_by <> v_s.user_id THEN 'NOT_REQUESTER'
                 ELSE NULL END;
  IF v_deny IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'EVIDENCE_BUNDLE', p_bundle_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_deny,
                                   'attempted', 'READ', 'permission', 'evidence.export',
                                   'field_or_file', 'evidence_bundle')
                                 || CASE WHEN b.id IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                b.country_code) END,
                                 NULL, p_request_id);
    RETURN QUERY SELECT CASE v_deny WHEN 'NOT_REQUESTER' THEN 'NOT_FOUND'
                                    ELSE 'FORBIDDEN' END::text, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, pg_catalog.jsonb_build_object(
    'bundleId', b.id,
    'tripId', b.trip_id,
    'country', b.country_code,
    'purpose', b.purpose,
    'status', CASE WHEN b.status = 'READY' AND b.expires_at <= v_now THEN 'EXPIRED'
                   ELSE b.status END,
    'manifestSha256', pg_catalog.encode(b.manifest_sha256, 'hex'),
    'requestedAt', pg_catalog.to_char(b.requested_at AT TIME ZONE 'UTC',
                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'generatedAt', pg_catalog.to_char(b.generated_at AT TIME ZONE 'UTC',
                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt', pg_catalog.to_char(b.expires_at AT TIME ZONE 'UTC',
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'exportSha256', pg_catalog.encode(b.export_sha256, 'hex'),
    'exportBytes', b.export_bytes,
    'failureCode', b.failure_code,
    'findings', b.findings,
    'absent', b.manifest -> 'absent',
    'fileCount', pg_catalog.jsonb_array_length(b.manifest -> 'files'));
END
$fn$;
COMMENT ON FUNCTION core.support_staff_evidence_bundle(bytea, uuid, uuid) IS
  'Console : état d''un dossier de preuve pour son demandeur (REQUESTED, READY, EXPIRED calculé, '
  'FAILED et constat), empreintes, pièces absentes ; aucune donnée personnelle ; refus journalisés. '
  'EXECUTE app_api. US-308 (ADR-184).';

-- 5.3 Ouverture de l'archive (téléchargement). Issues : OK (accès au journal et audit chaîné, puis
-- emplacement et empreinte de l'archive), NOT_READY, FAILED, EXPIRED (journalisé : lien rejoué),
-- AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN (dossier inconnu, permission absente dans son pays),
-- NOT_FOUND (dossier d'un autre agent), CASE_REQUIRED (dossier de support clos ou réassigné),
-- SELF_FORBIDDEN ; tous journalisés sauf
-- AUTH_REQUIRED, NOT_READY et FAILED.
CREATE FUNCTION core.support_staff_open_evidence_bundle(p_token_hash bytea, p_request_id uuid,
                                                        p_bundle_id uuid, p_reason text)
  RETURNS TABLE (outcome text, file_id uuid, storage_key text, sha256 text, bytes bigint,
                 manifest_sha256 text, trip_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s      record;
  b        record;
  v_case   record;
  v_role   text;
  v_deny   text;
  f        record;
  v_access uuid;
  v_reason text := pg_catalog.btrim(p_reason);
BEGIN
  IF p_request_id IS NULL OR p_bundle_id IS NULL
     OR v_reason IS NULL OR pg_catalog.char_length(v_reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'dossier de preuve : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text, NULL::bigint,
                        NULL::text, NULL::uuid;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'EVIDENCE_BUNDLE',
                                 p_bundle_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', 'EVIDENCE_DOWNLOAD',
                                   'permission', 'evidence.export',
                                   'field_or_file', 'evidence_bundle'),
                                 v_reason, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid, NULL::text, NULL::text, NULL::bigint,
                        NULL::text, NULL::uuid;
    RETURN;
  END IF;
  SELECT x.id, x.trip_id, x.country_code, x.case_id, x.status, x.requested_by, x.expires_at,
         x.manifest_sha256
    INTO b
    FROM core.claim_evidence_bundle AS x WHERE x.id = p_bundle_id;
  IF b.id IS NOT NULL THEN
    v_role := core.iam_staff_permitted(v_s.user_id, 'evidence.export', ARRAY[b.country_code],
                                       NULL);
    SELECT c.status, c.assignee_id, c.trip_id INTO v_case
      FROM core.support_support_case AS c WHERE c.id = b.case_id;
  END IF;
  v_deny := CASE
    -- dossier inconnu ou permission absente dans son pays : FORBIDDEN ; dossier d'un autre agent :
    -- NOT_FOUND (le lien ne se partage pas)
    WHEN b.id IS NULL THEN 'NOT_FOUND'
    WHEN v_role IS NULL THEN 'PERMISSION'
    WHEN b.requested_by <> v_s.user_id THEN 'NOT_REQUESTER'
    WHEN v_case.status NOT IN ('OPEN', 'PENDING') THEN 'CASE'
    WHEN v_role <> 'ADMIN' AND v_case.assignee_id IS DISTINCT FROM v_s.user_id THEN 'CASE'
    WHEN core.support_actor_conflict(v_s.user_id, 'TRIP', b.trip_id) THEN 'SELF'
    WHEN b.status = 'READY' AND b.expires_at <= platform.now() THEN 'EXPIRED'
    ELSE NULL END;
  IF v_deny IS NOT NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, COALESCE(v_role, 'STAFF'), 'STAFF_FORBIDDEN',
                                 'EVIDENCE_BUNDLE', p_bundle_id, NULL,
                                 pg_catalog.jsonb_build_object('reason', v_deny,
                                   'attempted', 'EVIDENCE_DOWNLOAD',
                                   'permission', 'evidence.export',
                                   'field_or_file', 'evidence_bundle')
                                 || CASE WHEN b.id IS NULL THEN '{}'::jsonb
                                         ELSE pg_catalog.jsonb_build_object('country',
                                                b.country_code, 'case_id', b.case_id) END,
                                 v_reason, p_request_id);
    RETURN QUERY SELECT CASE v_deny WHEN 'CASE' THEN 'CASE_REQUIRED'
                                    WHEN 'SELF' THEN 'SELF_FORBIDDEN'
                                    WHEN 'EXPIRED' THEN 'EXPIRED'
                                    WHEN 'NOT_REQUESTER' THEN 'NOT_FOUND'
                                    ELSE 'FORBIDDEN' END::text,
                        NULL::uuid, NULL::text, NULL::text, NULL::bigint, NULL::text, NULL::uuid;
    RETURN;
  END IF;
  IF b.status <> 'READY' THEN
    RETURN QUERY SELECT CASE b.status WHEN 'FAILED' THEN 'FAILED' ELSE 'NOT_READY' END::text,
                        NULL::uuid, NULL::text, NULL::text, NULL::bigint,
                        pg_catalog.encode(b.manifest_sha256, 'hex'), b.trip_id;
    RETURN;
  END IF;
  SELECT * INTO f FROM core.claim_evidence_export_file(b.id);
  v_access := pg_catalog.gen_random_uuid();
  INSERT INTO core.audit_data_access_log
         (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
          access_kind, case_ref, request_id)
  VALUES (v_access, v_s.user_id, v_role, 'TRIP', b.trip_id,
          'evidence_bundle:' || b.id::text || ':download', v_reason, 'BULK_EXPORT',
          b.case_id::text, p_request_id);
  PERFORM core.iam_staff_audit(v_s.user_id, v_role, 'STAFF_DATA_ACCESS', 'TRIP', b.trip_id, NULL,
                               pg_catalog.jsonb_build_object('country', b.country_code,
                                 'access_kind', 'BULK_EXPORT', 'attempted', 'EVIDENCE_DOWNLOAD',
                                 'field_or_file', 'evidence_bundle:' || b.id::text || ':download',
                                 'case_id', b.case_id, 'data_access_id', v_access,
                                 'export_sha256', f.sha256),
                               v_reason, p_request_id);
  RETURN QUERY SELECT 'OK'::text, f.file_id, f.storage_key, f.sha256, f.bytes,
                      pg_catalog.encode(b.manifest_sha256, 'hex'), b.trip_id;
END
$fn$;
COMMENT ON FUNCTION core.support_staff_open_evidence_bundle(bytea, uuid, uuid, text) IS
  'Console : ouverture de l''archive d''un dossier de preuve par son demandeur seulement '
  '(permission et dossier de support toujours valides, avant l''échéance de 168 h) ; accès au '
  'journal (BULK_EXPORT) et audit chaîné ; lien échu rejoué, autre agent : refus journalisé. '
  'EXECUTE app_api. US-308 (ADR-184).';

REVOKE ALL ON FUNCTION
  core.support_staff_request_evidence_bundle(bytea, uuid, uuid, uuid, text, text),
  core.support_staff_evidence_bundle(bytea, uuid, uuid),
  core.support_staff_open_evidence_bundle(bytea, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.support_staff_request_evidence_bundle(bytea, uuid, uuid, uuid, text, text),
  core.support_staff_evidence_bundle(bytea, uuid, uuid),
  core.support_staff_open_evidence_bundle(bytea, uuid, uuid, text) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
