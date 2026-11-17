-- 0122 — CTR / AVL : contrat de location hôte–voyageur par trip et signature horodatée (bêta).
-- US-211 (partie 211a) ; 19 US-211 (« Given un trip BOOKED, When le contrat est généré, Then
-- l'hôte (nom, pièce masquée ; ou mandataire avec autorisation notariée), le voyageur, le niveau de
-- protection, la franchise, la caution, la grille de retard et l'interdiction de sortie du pays sont
-- identiques à la fiche et au devis ; Kmino y figure comme intermédiaire, jamais comme loueur » ;
-- « Given une seconde génération, Then nouvelle version, l'ancienne reste consultable ; Given un
-- contrat non signé, When l'hôte tente la remise, Then refus » ; « Given un PDF modifié après
-- signature, When on recalcule l'empreinte, Then CONTRACT_HASH_MISMATCH ») ; 16 BKG-018, BKG-019
-- (bêta SIMPLIFIÉ : « acceptation horodatée avec empreinte (case + horodatage serveur), sans
-- prestataire de signature ») ; 08 BR-BOOK-12, BR-TT-03, BR-RETURN-03, BR-GEO-02 ; 17 §2.7,
-- §3.1.3 (classe A, crypto-shredding), §3.2.6 (`generated_document`, `signature`), §3.2.4
-- (`trip_segment.contract_document_id`) ; ADR-017 ; ADR-143 (cette migration) ; pré-mortem du lot 2 :
-- L2-PM-26, L2-PM-33, L2-PM-35 ; BOARD N-131 (segment sans `contract_document_id`), N-199 (distance
-- du devis et retenue du moteur). Appliquée sous `migrator`, en une transaction.
--
-- Principes (ADR-143, PROPOSÉS, « comme Turo » : docs/team/COMME_TURO.md) :
--   - le contrat est ENTRE L'HÔTE ET LE VOYAGEUR ; la plateforme y est intermédiaire et marchand de
--     référence pour le paiement, jamais partie ni loueur (LEG-014, DEC-FONDATEUR-13) ; gabarit
--     `RENTAL_CONTRACT` BROUILLON commun aux pays (es fait foi, en, fr, pt-BR), sans « definitiva e
--     inapelable », à valider par l'avocat (OQ-BR-24, GL-23) ;
--   - FAITS du contrat lus par la base, jamais reçus du client : devis figé du checkout (prix TTC,
--     lignes, niveau de protection, distance figée de 205b : N-199), contrat de l'assureur en
--     vigueur À LA RÉSERVATION (franchise du niveau, RC, assureur, courtier), caution du pays et de
--     la classe de valeur à la réservation, tolérance de retard du pays (`grace_minutes`), véhicule
--     et lieu de remise, capacité de l'hôte (propriétaire, ou titre d'un tiers avec autorisation
--     notariée : `catalog_vehicle.title_holder`) ; le travailleur `booking_contract` lit ces faits,
--     calcule par le moteur de règlement UNIQUE la retenue hors fenêtre gratuite (`derived`), rend
--     le PDF et en calcule l'empreinte ; la base RELIT les faits à l'enregistrement et refuse tout
--     écart (SOURCE_CHANGED) ;
--   - minimisation (L2-PM-35, `host_guest_v`) : du voyageur, le prénom et l'initiale du nom
--     seulement ; de l'hôte, prénom et nom (16 BKG-018) ; la pièce n'est jamais citée (la plateforme
--     n'en garde pas le numéro) ; aucun contact, permis, date de naissance. Les données nominatives
--     (noms, plaque, lieu de remise, texte rendu) vivent dans `contract_document_party` (classe B,
--     pseudonymisable), jamais en clair dans le registre immuable ;
--   - registre immuable (classe A) : une version par génération demandée, idempotente par clé de
--     déclenchement (événement `booking.trip.booked` rejoué ⇒ ALREADY_RECORDED, L2-PM-33) ; une
--     seconde génération crée la version suivante (`supersedes_id`), l'ancienne reste lisible ;
--   - signature électronique simple (BKG-019 SIMPLIFIÉ) : le voyageur de la SESSION accepte la
--     dernière version en présentant l'empreinte SHA-256 du PDF qu'il a lu ; empreinte différente
--     ⇒ CONTRACT_HASH_MISMATCH, rien n'est écrit ; heure SERVEUR (`platform.now()`) ; sceau
--     SHA-256 du bloc de signature (empreinte du document, signature, rôle, heure) ; IP et
--     user-agent [C2] RETENUS tant que l'API n'a pas de KeyWrapper (règle des consentements, 0059) ;
--     OTP non exigé en bêta (16 BKG-019 SIMPLIFIÉ, « jamais plus lourd que Turo » ; suite) ;
--   - remise : `core.booking_cmd_trip_transition` refuse IN_PROGRESS (check-in validé) tant que la
--     dernière version du contrat n'est pas signée par le voyageur (CONTRACT_NOT_SIGNED) ;
--   - aucun interrupteur lu ni écrit ; aucune constante de pays.
--
-- Expand / contract : tables, colonne `booking_trip_segment.contract_document_id` (NULL), fonctions
-- et politiques AJOUTÉES ; `core.booking_cmd_trip_transition` remplacée (même signature,
-- propriétaire et droits ; corps de 0099 recopié, garde du contrat ajoutée, marquée « US-211 »).
--
-- Retour arrière :
--   rejouer core.booking_cmd_trip_transition de 0099 (sous cmd_hold_owner) ;
--   DROP FUNCTION core.booking_cmd_sign_contract(bytea, uuid, uuid, bytea),
--     core.booking_trip_contract(bytea, uuid, integer),
--     core.booking_cmd_record_contract(uuid, text, jsonb, jsonb, jsonb, uuid, uuid, text, bytea),
--     core.booking_contract_source(uuid), core.booking_contract_facts(uuid),
--     core.booking_trip_contract_signed(uuid), core.contract_document_immutable() ;
--   ALTER TABLE core.booking_trip_segment DROP COLUMN contract_document_id ;
--   DROP TABLE core.contract_signature, core.contract_document_party,
--     core.contract_generated_document ;
--   DELETE des gabarits RENTAL_CONTRACT version 1 (base vide de contrats seulement) ;
--   DROP POLICY des politiques cmd_hold_contract_* ci-dessous et REVOKE des droits accordés à
--   cmd_hold_owner.

-- 1. Gabarit BROUILLON commun (17 §2.7 ; OQ-BR-24) ------------------------------------------------
-- empreinte posée par le déclencheur de garde de 0059 ; aucune « definitiva e inapelable »
INSERT INTO core.contract_document_template
       (kind, country_code, locale, version, is_major, title, body_md, content_hash,
        legal_review_ref, is_authoritative, valid_from)
SELECT 'RENTAL_CONTRACT', NULL, d.locale, 1, true, d.title, d.body,
       pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex'), NULL, d.locale = 'es',
       '2000-01-01T00:00:00Z'
  FROM (VALUES
    ('es', 'Contrato de alquiler de vehículo entre particulares',
     E'BORRADOR — pendiente de validación jurídica. Este texto es provisional.\n' ||
     E'1. Partes. El anfitrión, persona particular, alquila al viajero un vehículo propio, o uno cuyo titular le autorizó por poder notarial. La plataforma pone en contacto a las partes y cobra el pago como comerciante de referencia; no es parte de este contrato ni empresa de alquiler. La plataforma verificó la identidad del anfitrión; el número de su documento no se muestra.\n' ||
     E'2. Objeto. Vehículo, período y lugar de entrega indicados en las condiciones del viaje.\n' ||
     E'3. Precio. El viajero paga a la plataforma el total indicado, impuestos incluidos; la plataforma reparte el pago según las reglas publicadas.\n' ||
     E'4. Protección. El plan de protección elegido y su franquicia son los indicados; los presta la aseguradora asociada según sus condiciones.\n' ||
     E'5. Depósito. La garantía indicada se toma con tarjeta, según las condiciones de pago.\n' ||
     E'6. Kilometraje. Se aplica el kilometraje indicado; cada kilómetro adicional se cobra al precio indicado.\n' ||
     E'7. Devolución y retraso. El viajero devuelve el vehículo en la fecha, hora y lugar acordados. Pasada la tolerancia indicada, el retraso se cobra según la política publicada.\n' ||
     E'8. Uso. Solo conduce el conductor nombrado. Está prohibido salir del territorio nacional donde se realiza el viaje. El viajero respeta las reglas del anfitrión (no fumar, limpieza, combustible, sin uso todoterreno). Las multas del período del viaje corren por cuenta del viajero.\n' ||
     E'9. Cancelación. Se aplica la política de cancelación aceptada en la reserva y los importes indicados.\n' ||
     E'10. Firma. El viajero acepta este contrato por medios electrónicos; la plataforma registra la hora de su servidor y la huella del documento exacto.\n' ||
     E'11. Ley aplicable. La del Estado donde se realiza el viaje. El texto en español hace fe.'),
    ('en', 'Peer-to-peer vehicle rental agreement',
     E'DRAFT — pending legal review. This text is provisional.\n' ||
     E'1. Parties. The host, a private individual, rents to the guest a vehicle they own, or one whose owner authorized them by notarized power of attorney. The platform connects the parties and collects payment as merchant of record; it is not a party to this agreement nor a rental company. The platform verified the host''s identity; their document number is not shown.\n' ||
     E'2. Subject. Vehicle, period and handover place as shown in the trip conditions.\n' ||
     E'3. Price. The guest pays the platform the total shown, taxes included; the platform splits the payment under the published rules.\n' ||
     E'4. Protection. The chosen protection plan and its deductible are as shown; they are provided by the partner insurer under its conditions.\n' ||
     E'5. Deposit. The deposit shown is taken by card, under the payment conditions.\n' ||
     E'6. Mileage. The mileage shown applies; each extra kilometre is charged at the price shown.\n' ||
     E'7. Return and late return. The guest returns the vehicle on the agreed date, time and place. After the grace period shown, late return is charged under the published policy.\n' ||
     E'8. Use. Only the named driver may drive. Leaving the territory of the trip country is forbidden. The guest follows the host''s rules (no smoking, cleanliness, fuel, no off-road use). Fines incurred during the trip are borne by the guest.\n' ||
     E'9. Cancellation. The cancellation policy accepted at booking and the amounts shown apply.\n' ||
     E'10. Signature. The guest accepts this agreement electronically; the platform records its server time and the fingerprint of the exact document.\n' ||
     E'11. Governing law. That of the trip country. The Spanish text prevails.'),
    ('fr', 'Contrat de location de véhicule entre particuliers',
     E'BROUILLON — à valider par le juridique. Ce texte est provisoire.\n' ||
     E'1. Parties. L''hôte, particulier, loue au voyageur un véhicule qui lui appartient, ou dont le titulaire l''a autorisé par procuration notariée. La plateforme met les parties en relation et encaisse le paiement comme marchand de référence ; elle n''est ni partie à ce contrat ni loueur. La plateforme a vérifié l''identité de l''hôte ; le numéro de sa pièce n''est pas affiché.\n' ||
     E'2. Objet. Véhicule, période et lieu de remise indiqués dans les conditions du trajet.\n' ||
     E'3. Prix. Le voyageur paie à la plateforme le total indiqué, taxes comprises ; la plateforme répartit le paiement selon les règles publiées.\n' ||
     E'4. Protection. Le plan de protection choisi et sa franchise sont ceux indiqués ; ils sont fournis par l''assureur partenaire selon ses conditions.\n' ||
     E'5. Caution. La caution indiquée est prise par carte, selon les conditions de paiement.\n' ||
     E'6. Kilométrage. Le kilométrage indiqué s''applique ; chaque kilomètre supplémentaire est facturé au prix indiqué.\n' ||
     E'7. Restitution et retard. Le voyageur rend le véhicule à la date, à l''heure et au lieu convenus. Passé le délai de tolérance indiqué, le retard est facturé selon la politique publiée.\n' ||
     E'8. Usage. Seul le conducteur nommé conduit. Il est interdit de sortir du territoire du pays du trajet. Le voyageur respecte les règles de l''hôte (non-fumeur, propreté, carburant, pas de tout-terrain). Les amendes de la période du trajet sont à la charge du voyageur.\n' ||
     E'9. Annulation. La politique d''annulation acceptée à la réservation et les montants indiqués s''appliquent.\n' ||
     E'10. Signature. Le voyageur accepte ce contrat par voie électronique ; la plateforme enregistre l''heure de son serveur et l''empreinte du document exact.\n' ||
     E'11. Loi applicable. Celle du pays du trajet. Le texte espagnol fait foi.'),
    ('pt', 'Contrato de aluguel de veículo entre particulares',
     E'RASCUNHO — pendente de validação jurídica. Este texto é provisório.\n' ||
     E'1. Partes. O anfitrião, pessoa física, aluga ao viajante um veículo próprio, ou um cujo titular o autorizou por procuração em cartório. A plataforma conecta as partes e recebe o pagamento como comerciante de referência; não é parte deste contrato nem locadora. A plataforma verificou a identidade do anfitrião; o número do documento não é mostrado.\n' ||
     E'2. Objeto. Veículo, período e local de entrega indicados nas condições da viagem.\n' ||
     E'3. Preço. O viajante paga à plataforma o total indicado, com impostos; a plataforma reparte o pagamento conforme as regras publicadas.\n' ||
     E'4. Proteção. O plano de proteção escolhido e sua franquia são os indicados; são prestados pela seguradora parceira conforme suas condições.\n' ||
     E'5. Caução. A caução indicada é feita no cartão, conforme as condições de pagamento.\n' ||
     E'6. Quilometragem. Aplica-se a quilometragem indicada; cada quilômetro adicional é cobrado pelo preço indicado.\n' ||
     E'7. Devolução e atraso. O viajante devolve o veículo na data, hora e local combinados. Após a tolerância indicada, o atraso é cobrado conforme a política publicada.\n' ||
     E'8. Uso. Só dirige o condutor nomeado. É proibido sair do território nacional onde a viagem ocorre. O viajante respeita as regras do anfitrião (não fumar, limpeza, combustível, sem uso fora de estrada). As multas do período da viagem ficam por conta do viajante.\n' ||
     E'9. Cancelamento. Aplicam-se a política de cancelamento aceita na reserva e os valores indicados.\n' ||
     E'10. Assinatura. O viajante aceita este contrato por meio eletrônico; a plataforma registra a hora do seu servidor e a impressão digital do documento exato.\n' ||
     E'11. Lei aplicável. A do Estado onde a viagem ocorre. O texto em espanhol prevalece.')
  ) AS d(locale, title, body);

-- 2. Registre des contrats générés (17 §3.2.6 `generated_document`, classe A, immuable) -----------
CREATE TABLE core.contract_generated_document (
  id                    uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT contract_generated_document_pkey PRIMARY KEY,
  kind                  text        NOT NULL
    CONSTRAINT generated_document_kind_valid CHECK (kind = 'RENTAL_CONTRACT'),
  -- gabarit espagnol (fait foi) et gabarit de courtoisie de la même version
  template_id           uuid        NOT NULL REFERENCES core.contract_document_template (id),
  courtesy_template_id  uuid        NOT NULL REFERENCES core.contract_document_template (id),
  subject_type          text        NOT NULL
    CONSTRAINT generated_document_subject_valid CHECK (subject_type = 'TRIP_SEGMENT'),
  subject_id            uuid        NOT NULL REFERENCES core.booking_trip_segment (id),
  trip_id               uuid        NOT NULL REFERENCES core.booking_trip (id),
  country_code          text        NOT NULL
    CONSTRAINT generated_document_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- langue de courtoisie (l'espagnol fait toujours foi)
  locale                text        NOT NULL
    CONSTRAINT generated_document_locale_valid CHECK (locale IN ('en', 'fr', 'pt')),
  version               integer     NOT NULL
    CONSTRAINT generated_document_version_positive CHECK (version >= 1),
  supersedes_id         uuid        REFERENCES core.contract_generated_document (id),
  -- demande de génération (identifiant d'événement ou de demande) : une version par demande
  trigger_key           text        NOT NULL
    CONSTRAINT generated_document_trigger_format CHECK (trigger_key ~ '^[A-Za-z0-9:._-]{1,100}$'),
  -- faits non nominatifs lus par la base (prix, protection, distance, caution, retard) [C1]
  terms                 jsonb       NOT NULL
    CONSTRAINT generated_document_terms_object CHECK (pg_catalog.jsonb_typeof(terms) = 'object'),
  -- valeurs calculées par le travailleur (retenue du moteur de règlement, marque) [C1]
  derived               jsonb       NOT NULL
    CONSTRAINT generated_document_derived_object CHECK (pg_catalog.jsonb_typeof(derived) = 'object'),
  renderer_version      text        NOT NULL
    CONSTRAINT generated_document_renderer_format CHECK (renderer_version ~ '^ctr\.pdf/[0-9]{1,3}$'),
  -- SHA-256 du PDF exact présenté au voyageur
  sha256                bytea       NOT NULL
    CONSTRAINT generated_document_sha256_length CHECK (pg_catalog.octet_length(sha256) = 32),
  generated_at          timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT generated_document_version_unique UNIQUE (subject_id, version),
  CONSTRAINT generated_document_trigger_unique UNIQUE (trip_id, trigger_key),
  CONSTRAINT generated_document_supersedes_unique UNIQUE (supersedes_id),
  CONSTRAINT generated_document_first_version CHECK ((version = 1) = (supersedes_id IS NULL))
);
CREATE INDEX generated_document_trip_idx ON core.contract_generated_document (trip_id, version);
COMMENT ON TABLE core.contract_generated_document IS
  'CTR generated_document (17 §3.2.6, classe A) : contrat de location hôte–voyageur d''un segment de '
  'trip, une ligne par version (supersedes_id), empreinte SHA-256 du PDF ; faits non nominatifs '
  'seulement (les noms sont dans contract_document_party). Écrit par '
  'core.booking_cmd_record_contract seulement ; immuable. US-211 (ADR-143).';

-- 2.1 Partie nominative du contrat (classe B : pseudonymisable à l'échéance de rétention) ---------
CREATE TABLE core.contract_document_party (
  document_id      uuid        NOT NULL
    CONSTRAINT contract_document_party_pkey PRIMARY KEY
    REFERENCES core.contract_generated_document (id),
  -- noms (hôte : prénom et nom ; voyageur : prénom et initiale), plaque, lieu de remise [C2]
  identity         jsonb       NOT NULL
    CONSTRAINT document_party_identity_object CHECK (pg_catalog.jsonb_typeof(identity) = 'object'),
  -- texte rendu (lignes du PDF, es puis courtoisie), qui contient l'identité [C2]
  body             jsonb       NOT NULL
    CONSTRAINT document_party_body_array CHECK (pg_catalog.jsonb_typeof(body) = 'array'),
  pseudonymized_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT platform.now()
);
COMMENT ON TABLE core.contract_document_party IS
  'CTR : partie nominative d''un contrat généré (noms, plaque, lieu de remise, texte rendu), hors du '
  'registre immuable pour rester pseudonymisable (17 §3.1.3 classe B/E) ; après pseudonymisation le '
  'PDF n''est plus reproductible, son empreinte reste vérifiable. US-211 (ADR-143).';

-- 2.2 Signatures (17 §3.2.6 `signature`, classe A, immuable) -----------------------------------
CREATE TABLE core.contract_signature (
  id                uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT contract_signature_pkey PRIMARY KEY,
  document_id       uuid        NOT NULL REFERENCES core.contract_generated_document (id),
  trip_id           uuid        NOT NULL REFERENCES core.booking_trip (id),
  signer_user_id    uuid        NOT NULL REFERENCES core.iam_user_account (id),
  signer_role       text        NOT NULL
    CONSTRAINT signature_role_valid CHECK (signer_role = 'GUEST'),
  -- bêta : acceptation par clic après authentification de session (16 BKG-019 SIMPLIFIÉ) ;
  -- CLICKWRAP_OTP (17 §2.7) quand l'OTP de signature sera exigé
  method            text        NOT NULL
    CONSTRAINT signature_method_valid CHECK (method IN ('CLICKWRAP', 'CLICKWRAP_OTP')),
  otp_challenge_id  uuid        REFERENCES core.iam_otp_challenge (id),
  signed_at         timestamptz NOT NULL DEFAULT platform.now(),
  -- empreinte du PDF présenté (égale à celle du document) et sceau du bloc de signature
  document_sha256   bytea       NOT NULL
    CONSTRAINT signature_document_sha256_length CHECK (pg_catalog.octet_length(document_sha256) = 32),
  seal_sha256       bytea       NOT NULL
    CONSTRAINT signature_seal_sha256_length CHECK (pg_catalog.octet_length(seal_sha256) = 32),
  ip_enc            bytea,                                       -- [C2] chiffré, clé du sujet
  user_agent_enc    bytea,                                       -- [C2] chiffré, clé du sujet
  key_subject_type  text
    CONSTRAINT signature_key_subject_type_valid CHECK (key_subject_type IS NULL OR key_subject_type = 'USER'),
  key_subject_id    uuid,
  c2_withheld       boolean     NOT NULL,
  CONSTRAINT signature_one_per_signer UNIQUE (document_id, signer_user_id),
  CONSTRAINT signature_otp_method CHECK ((method = 'CLICKWRAP_OTP') = (otp_challenge_id IS NOT NULL)),
  CONSTRAINT signature_c2_withheld_coherent
    CHECK (NOT c2_withheld OR (ip_enc IS NULL AND user_agent_enc IS NULL)),
  CONSTRAINT signature_key_coherent
    CHECK ((ip_enc IS NULL AND user_agent_enc IS NULL) OR key_subject_id IS NOT NULL)
);
CREATE INDEX contract_signature_trip_idx ON core.contract_signature (trip_id);
COMMENT ON TABLE core.contract_signature IS
  'CTR signature (17 §3.2.6, classe A) : acceptation électronique simple d''une version de contrat '
  'par le voyageur, heure serveur, empreinte du PDF présenté et sceau ; IP et user-agent [C2] '
  'retenus (c2_withheld) tant que l''API n''a pas de KeyWrapper. Écrit par '
  'core.booking_cmd_sign_contract seulement ; immuable. US-211 (ADR-143).';

-- 2.3 Immuabilité (registres A ; la partie nominative ne se modifie que par pseudonymisation, par
-- une story de rétention : aucun droit UPDATE aujourd'hui)
CREATE FUNCTION core.contract_document_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'contract: % refused on an append-only record (%)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'contract_record_immutable';
END
$fn$;
CREATE TRIGGER contract_record_immutable BEFORE UPDATE OR DELETE
  ON core.contract_generated_document
  FOR EACH ROW EXECUTE FUNCTION core.contract_document_immutable();
CREATE TRIGGER contract_record_immutable BEFORE UPDATE OR DELETE ON core.contract_signature
  FOR EACH ROW EXECUTE FUNCTION core.contract_document_immutable();
CREATE TRIGGER contract_record_no_delete BEFORE DELETE ON core.contract_document_party
  FOR EACH ROW EXECUTE FUNCTION core.contract_document_immutable();
CREATE TRIGGER ctr_no_truncate BEFORE TRUNCATE ON core.contract_generated_document
  FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate();
CREATE TRIGGER ctr_no_truncate BEFORE TRUNCATE ON core.contract_document_party
  FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate();
CREATE TRIGGER ctr_no_truncate BEFORE TRUNCATE ON core.contract_signature
  FOR EACH STATEMENT EXECUTE FUNCTION core.ctr_no_truncate();

-- 2.4 Segment : version en vigueur du contrat (17 §3.2.4 ; N-131)
ALTER TABLE core.booking_trip_segment
  ADD COLUMN contract_document_id uuid
    CONSTRAINT booking_trip_segment_contract_fkey REFERENCES core.contract_generated_document (id);
COMMENT ON COLUMN core.booking_trip_segment.contract_document_id IS
  'Dernière version du contrat de location du segment (17 §3.2.4), posée par '
  'core.booking_cmd_record_contract ; NULL = aucun contrat généré. US-211 (ADR-143).';

-- 2.5 RLS : aucun droit applicatif ; commandes sous cmd_hold_owner
ALTER TABLE core.contract_generated_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.contract_generated_document FORCE ROW LEVEL SECURITY;
ALTER TABLE core.contract_document_party ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.contract_document_party FORCE ROW LEVEL SECURITY;
ALTER TABLE core.contract_signature ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.contract_signature FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.contract_generated_document TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.contract_document_party TO migrator USING (true)
  WITH CHECK (true);
CREATE POLICY migrator_all ON core.contract_signature TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.contract_generated_document, core.contract_document_party,
  core.contract_signature FROM PUBLIC;

GRANT SELECT, INSERT ON core.contract_generated_document, core.contract_document_party,
  core.contract_signature TO cmd_hold_owner;
CREATE POLICY cmd_hold_contract_sel ON core.contract_generated_document FOR SELECT
  TO cmd_hold_owner USING (true);
CREATE POLICY cmd_hold_contract_ins ON core.contract_generated_document FOR INSERT
  TO cmd_hold_owner WITH CHECK (app.actor_kind() = 'WORKER'
                                AND app.worker_name() = 'booking_contract');
CREATE POLICY cmd_hold_contract_sel ON core.contract_document_party FOR SELECT
  TO cmd_hold_owner USING (true);
CREATE POLICY cmd_hold_contract_ins ON core.contract_document_party FOR INSERT
  TO cmd_hold_owner WITH CHECK (app.actor_kind() = 'WORKER'
                                AND app.worker_name() = 'booking_contract');
CREATE POLICY cmd_hold_contract_sel ON core.contract_signature FOR SELECT
  TO cmd_hold_owner USING (true);
CREATE POLICY cmd_hold_contract_ins ON core.contract_signature FOR INSERT
  TO cmd_hold_owner WITH CHECK (signer_role = 'GUEST' AND c2_withheld);
GRANT SELECT (contract_document_id), UPDATE (contract_document_id)
  ON core.booking_trip_segment TO cmd_hold_owner;

-- 3. Lectures de cmd_hold_owner (faits du contrat, au plus juste) -------------------------------
GRANT SELECT (public_ref, country_code, currency, timezone, scheduled_start, scheduled_end,
              booked_at, org_id, vehicle_id, status, source_hold_id)
  ON core.booking_trip TO cmd_hold_owner;
GRANT SELECT (quote_id) ON core.booking_checkout_hold TO cmd_hold_owner;
GRANT SELECT (id, listing_id, total_minor, currency, protection_level, mileage_mode, included_km,
              extra_km_price_minor, engine_version, inputs, inputs_hash, outputs, outputs_hash,
              frozen_at)
  ON core.pricing_quote TO cmd_hold_owner;
GRANT SELECT (make_text, model_text, variant_id, year, plate, title_holder, home_location_id,
              value_class)
  ON core.catalog_vehicle TO cmd_hold_owner;
GRANT SELECT (id, place_label, address_line, city) ON core.catalog_location TO cmd_hold_owner;
GRANT SELECT (holder_user_id) ON core.iam_organization TO cmd_hold_owner;
-- noms légaux et langue des parties (minimisés à la lecture : prénom et initiale du voyageur)
GRANT SELECT (id, legal_first_name, legal_last_name, preferred_locale, pseudonymized_at)
  ON core.iam_user_account TO cmd_hold_owner;
CREATE POLICY cmd_hold_contract_read ON core.iam_user_account FOR SELECT TO cmd_hold_owner
  USING (true);
-- marque et modèle du référentiel (C0)
GRANT SELECT (id, model_id) ON core.catalog_vehicle_variant TO cmd_hold_owner;
CREATE POLICY cmd_hold_contract_read ON core.catalog_vehicle_variant FOR SELECT
  TO cmd_hold_owner USING (true);
GRANT SELECT (id, make_id, name) ON core.catalog_vehicle_model TO cmd_hold_owner;
CREATE POLICY cmd_hold_contract_read ON core.catalog_vehicle_model FOR SELECT
  TO cmd_hold_owner USING (true);
GRANT SELECT (id, name) ON core.catalog_vehicle_make TO cmd_hold_owner;
CREATE POLICY cmd_hold_contract_read ON core.catalog_vehicle_make FOR SELECT
  TO cmd_hold_owner USING (true);
-- contrat de l'assureur en vigueur à la réservation (franchise, RC, assureur, courtier)
GRANT SELECT (id, insurer_id, broker_id, country_code, valid_from, valid_to, currency,
              rc_amount_minor, deductibles)
  ON core.settlement_insurer_contract TO cmd_hold_owner;
CREATE POLICY cmd_hold_contract_read ON core.settlement_insurer_contract FOR SELECT
  TO cmd_hold_owner USING (true);
GRANT SELECT (id, country_code, name, status) ON core.settlement_insurer TO cmd_hold_owner;
CREATE POLICY cmd_hold_contract_read ON core.settlement_insurer FOR SELECT TO cmd_hold_owner
  USING (true);
-- caution de la plateforme (pays, classe de valeur) à la réservation
GRANT SELECT (country_code, value_class, amount_minor, currency, valid_from)
  ON core.catalog_deposit_policy TO cmd_hold_owner;
CREATE POLICY cmd_hold_contract_read ON core.catalog_deposit_policy FOR SELECT
  TO cmd_hold_owner USING (true);
-- gabarits juridiques (C0)
GRANT SELECT (id, kind, country_code, locale, version, title, body_md, legal_review_ref,
              is_authoritative, valid_from)
  ON core.contract_document_template TO cmd_hold_owner;
CREATE POLICY cmd_hold_contract_read ON core.contract_document_template FOR SELECT
  TO cmd_hold_owner USING (true);
-- tolérance de retard du pays (08 BR-RETURN-03 ; 17 §7.2 `grace_minutes`)
CREATE POLICY cmd_hold_contract_param_read ON core.config_param_value FOR SELECT
  TO cmd_hold_owner USING (key = 'grace_minutes');
-- événements du contrat
CREATE POLICY cmd_hold_contract_event_ins ON core.outbox_outbox_event FOR INSERT
  TO cmd_hold_owner
  WITH CHECK (aggregate_type = 'contract_document'
              AND ((type = 'contract.document.generated' AND actor_role = 'SYSTEM'
                    AND actor_user_id IS NULL)
                   OR (type = 'contract.document.signed' AND actor_role = 'GUEST'
                       AND actor_user_id IS NOT NULL)));

-- 4. Fonctions (cmd_hold_owner) -----------------------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 4.1 Faits du contrat d'un trip (SECURITY INVOKER, interne) : {terms, identity} ; NULL si la
-- source est incomplète (devis sans protection ni distance, véhicule sans titulaire déclaré,
-- aucun contrat d'assureur en vigueur à la réservation, lieu inconnu) : fail-closed, jamais un
-- contrat deviné.
CREATE FUNCTION core.booking_contract_facts(p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t        record;
  q        record;
  v        record;
  loc      record;
  v_host   record;
  v_guest  record;
  ins      record;
  v_lines  jsonb;
  v_make   text;
  v_model  text;
  v_dep    bigint;
  v_grace  integer;
  v_tsfmt  CONSTANT text := 'YYYY-MM-DD HH24:MI';
BEGIN
  SELECT tr.id, tr.public_ref, tr.country_code, tr.currency, tr.timezone, tr.scheduled_start,
         tr.scheduled_end, tr.booked_at, tr.org_id, tr.vehicle_id, tr.guest_user_id,
         tr.source_hold_id
    INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  IF t.id IS NULL OR t.booked_at IS NULL OR t.source_hold_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT pq.id, pq.total_minor, pq.currency, pq.protection_level, pq.mileage_mode,
         pq.included_km, pq.extra_km_price_minor
    INTO q
    FROM core.booking_checkout_hold AS ho
    JOIN core.pricing_quote AS pq ON pq.id = ho.quote_id
   WHERE ho.id = t.source_hold_id;
  IF q.id IS NULL OR q.protection_level IS NULL OR q.mileage_mode IS NULL
     OR q.currency IS DISTINCT FROM t.currency THEN
    RETURN NULL;
  END IF;
  SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'type', l.line_type, 'amountMinor', l.amount_minor::text,
           'taxMinor', l.tax_minor::text) ORDER BY l.seq)
    INTO v_lines
    FROM core.pricing_quote_line AS l WHERE l.quote_id = q.id;

  SELECT cv.make_text, cv.model_text, cv.variant_id, cv.year, cv.plate, cv.title_holder,
         cv.home_location_id, cv.value_class
    INTO v
    FROM core.catalog_vehicle AS cv WHERE cv.id = t.vehicle_id AND cv.org_id = t.org_id;
  IF v.plate IS NULL OR v.title_holder IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT mk.name, md.name INTO v_make, v_model
    FROM core.catalog_vehicle_variant AS va
    JOIN core.catalog_vehicle_model AS md ON md.id = va.model_id
    JOIN core.catalog_vehicle_make AS mk ON mk.id = md.make_id
   WHERE va.id = v.variant_id;
  v_make := COALESCE(v.make_text, v_make);
  v_model := COALESCE(v.model_text, v_model);
  SELECT cl.place_label, cl.address_line, cl.city INTO loc
    FROM core.catalog_location AS cl WHERE cl.id = v.home_location_id;
  IF v_make IS NULL OR v_model IS NULL OR loc.city IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT u.legal_first_name, u.legal_last_name, u.pseudonymized_at INTO v_host
    FROM core.iam_organization AS o
    JOIN core.iam_user_account AS u ON u.id = o.holder_user_id
   WHERE o.id = t.org_id;
  SELECT u.legal_first_name, u.legal_last_name, u.pseudonymized_at INTO v_guest
    FROM core.iam_user_account AS u WHERE u.id = t.guest_user_id;
  IF v_host.legal_first_name IS NULL OR v_host.pseudonymized_at IS NOT NULL
     OR v_guest.legal_first_name IS NULL OR v_guest.pseudonymized_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- contrat de l'assureur en vigueur À LA RÉSERVATION (assureur actif, même devise)
  SELECT c.rc_amount_minor, c.deductibles ->> q.protection_level AS deductible,
         i.name AS insurer_name, b.name AS broker_name
    INTO ins
    FROM core.settlement_insurer_contract AS c
    JOIN core.settlement_insurer AS i ON i.id = c.insurer_id AND i.country_code = c.country_code
    LEFT JOIN core.settlement_insurer AS b ON b.id = c.broker_id AND b.country_code = c.country_code
   WHERE c.country_code = t.country_code AND i.status = 'ACTIVE' AND c.currency = t.currency
     AND c.valid_from <= t.booked_at AND (c.valid_to IS NULL OR c.valid_to > t.booked_at)
   ORDER BY c.valid_from DESC
   LIMIT 1;
  IF ins.deductible IS NULL OR ins.rc_amount_minor IS NULL THEN
    RETURN NULL;
  END IF;

  -- caution du pays et de la classe de valeur à la réservation (NULL : mention générique)
  SELECT CASE WHEN dp.amount_minor > 0 AND dp.currency = t.currency THEN dp.amount_minor END
    INTO v_dep
    FROM core.catalog_deposit_policy AS dp
   WHERE dp.country_code = t.country_code AND dp.value_class = v.value_class
     AND dp.valid_from <= t.booked_at
   ORDER BY dp.valid_from DESC
   LIMIT 1;
  v_grace := core.booking_param_int('grace_minutes', t.country_code);

  RETURN pg_catalog.jsonb_build_object(
    'terms', pg_catalog.jsonb_build_object(
      'schema', 'ctr.rental/1',
      'tripRef', t.public_ref,
      'country', t.country_code,
      'currency', t.currency,
      'timezone', t.timezone,
      'startLocal', pg_catalog.to_char(t.scheduled_start AT TIME ZONE t.timezone, v_tsfmt),
      'endLocal', pg_catalog.to_char(t.scheduled_end AT TIME ZONE t.timezone, v_tsfmt),
      'bookedAtLocal', pg_catalog.to_char(t.booked_at AT TIME ZONE t.timezone, v_tsfmt),
      'vehicle', pg_catalog.jsonb_build_object('make', v_make, 'model', v_model, 'year', v.year),
      'hostCapacity', CASE v.title_holder WHEN 'THIRD_PARTY' THEN 'AUTHORIZED' ELSE 'OWNER' END,
      'priceTotalMinor', q.total_minor::text,
      'priceLines', COALESCE(v_lines, '[]'::jsonb),
      'protection', pg_catalog.jsonb_build_object(
        'level', q.protection_level, 'deductibleMinor', ins.deductible,
        'rcMinor', ins.rc_amount_minor::text, 'insurer', ins.insurer_name,
        'broker', ins.broker_name),
      'depositMinor', v_dep::text,
      'mileage', pg_catalog.jsonb_build_object(
        'mode', q.mileage_mode, 'includedKm', q.included_km,
        'extraKmPriceMinor', q.extra_km_price_minor::text),
      'lateGraceMinutes', v_grace),
    'identity', pg_catalog.jsonb_build_object(
      'hostName', v_host.legal_first_name || ' ' || v_host.legal_last_name,
      'guestName', v_guest.legal_first_name || ' '
                   || pg_catalog.left(pg_catalog.btrim(v_guest.legal_last_name), 1) || '.',
      'plate', v.plate,
      'handoverPlace', loc.place_label,
      'handoverAddress', loc.address_line,
      'handoverCity', loc.city));
END
$fn$;
REVOKE ALL ON FUNCTION core.booking_contract_facts(uuid) FROM PUBLIC;

-- 4.2 Gabarit en vigueur d'une langue (portée du pays si une version y existe, sinon commune)
CREATE FUNCTION core.booking_contract_template(p_country text, p_locale text)
  RETURNS TABLE (id uuid, version integer, locale text, title text, body_md text,
                 is_draft boolean)
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH scope AS (
    SELECT CASE WHEN EXISTS (
             SELECT 1 FROM core.contract_document_template AS t
              WHERE t.kind = 'RENTAL_CONTRACT' AND t.country_code = p_country
                AND t.valid_from <= platform.now())
           THEN p_country END AS country
  ), latest AS (
    SELECT pg_catalog.max(t.version) AS version
      FROM core.contract_document_template AS t, scope
     WHERE t.kind = 'RENTAL_CONTRACT' AND t.country_code IS NOT DISTINCT FROM scope.country
       AND t.valid_from <= platform.now()
  )
  SELECT t.id, t.version, t.locale, t.title, t.body_md, t.legal_review_ref IS NULL
    FROM core.contract_document_template AS t, scope, latest
   WHERE t.kind = 'RENTAL_CONTRACT' AND t.country_code IS NOT DISTINCT FROM scope.country
     AND t.version = latest.version AND t.locale = p_locale
$fn$;
REVOKE ALL ON FUNCTION core.booking_contract_template(text, text) FROM PUBLIC;

-- 4.3 Langue de courtoisie : celle du voyageur si ce n'est pas l'espagnol, sinon l'anglais
-- (16 BKG-018 : « version anglaise de courtoisie »)
CREATE FUNCTION core.booking_contract_courtesy_locale(p_guest uuid)
  RETURNS text
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE pg_catalog.split_part(COALESCE(u.preferred_locale, 'en'), '-', 1)
           WHEN 'fr' THEN 'fr' WHEN 'pt' THEN 'pt' ELSE 'en' END
    FROM core.iam_user_account AS u WHERE u.id = p_guest
$fn$;
REVOKE ALL ON FUNCTION core.booking_contract_courtesy_locale(uuid) FROM PUBLIC;

-- 4.4 Source du contrat pour le travailleur `booking_contract` (SECURITY DEFINER, EXECUTE
-- app_worker) : faits, devis canonique (rejeu par le moteur de règlement), gabarits.
-- Issues : OK, TRIP_UNKNOWN, NOT_CONTRACTABLE (trip annulé ou déjà remis), SOURCE_UNAVAILABLE
-- (faits incomplets), TEMPLATE_UNAVAILABLE.
CREATE FUNCTION core.booking_contract_source(p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t       record;
  q       record;
  v_facts jsonb;
  es      record;
  ct      record;
  v_loc   text;
  v_next  integer;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'booking_contract' THEN
    RAISE EXCEPTION 'contract: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'contract_command_forbidden';
  END IF;
  SELECT tr.id, tr.status, tr.country_code, tr.currency, tr.guest_user_id, tr.source_hold_id,
         tr.booked_at
    INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'TRIP_UNKNOWN');
  END IF;
  IF t.status NOT IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'NOT_CONTRACTABLE');
  END IF;
  v_facts := core.booking_contract_facts(t.id);
  IF v_facts IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'SOURCE_UNAVAILABLE');
  END IF;
  v_loc := core.booking_contract_courtesy_locale(t.guest_user_id);
  SELECT * INTO es FROM core.booking_contract_template(t.country_code, 'es');
  SELECT * INTO ct FROM core.booking_contract_template(t.country_code, v_loc);
  IF es.id IS NULL OR ct.id IS NULL OR ct.version IS DISTINCT FROM es.version THEN
    RETURN pg_catalog.jsonb_build_object('outcome', 'TEMPLATE_UNAVAILABLE');
  END IF;
  SELECT pq.engine_version, pq.inputs, pq.inputs_hash, pq.outputs, pq.outputs_hash, pq.frozen_at
    INTO q
    FROM core.booking_checkout_hold AS ho
    JOIN core.pricing_quote AS pq ON pq.id = ho.quote_id
   WHERE ho.id = t.source_hold_id;
  SELECT COALESCE(pg_catalog.max(d.version), 0) + 1 INTO v_next
    FROM core.contract_generated_document AS d WHERE d.trip_id = t.id;
  RETURN pg_catalog.jsonb_build_object(
    'outcome', 'OK',
    'tripId', t.id,
    'country', t.country_code,
    'currency', t.currency,
    'bookedAt', pg_catalog.to_char(t.booked_at AT TIME ZONE 'UTC',
                                   'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'facts', v_facts,
    'nextVersion', v_next,
    'quote', pg_catalog.jsonb_build_object(
      'engineVersion', q.engine_version, 'inputs', q.inputs, 'inputsHash', q.inputs_hash,
      'outputs', q.outputs, 'outputsHash', q.outputs_hash,
      'frozenAt', pg_catalog.to_char(q.frozen_at AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
    'template', pg_catalog.jsonb_build_object(
      'id', es.id, 'version', es.version, 'title', es.title, 'body', es.body_md,
      'isDraft', es.is_draft),
    'courtesy', pg_catalog.jsonb_build_object(
      'id', ct.id, 'locale', ct.locale, 'title', ct.title, 'body', ct.body_md,
      'isDraft', ct.is_draft));
END
$fn$;
COMMENT ON FUNCTION core.booking_contract_source(uuid) IS
  'Source du contrat de location d''un trip pour le travailleur booking_contract : faits lus par la '
  'base (devis figé, assureur et caution à la réservation, véhicule, lieu, parties minimisées), '
  'devis canonique, gabarits es et de courtoisie, version suivante. SECURITY DEFINER, EXECUTE '
  'app_worker. US-211 (ADR-143).';
REVOKE ALL ON FUNCTION core.booking_contract_source(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_contract_source(uuid) TO app_worker;

-- 4.5 Enregistrement d'une version (SECURITY DEFINER, EXECUTE app_worker, `booking_contract`).
-- Idempotente par (trip, clé de déclenchement). Les faits reçus doivent ÊTRE ceux que la base relit
-- maintenant, et les gabarits ceux en vigueur ; sinon SOURCE_CHANGED (le travailleur relit et
-- recommence). Issues : RECORDED, ALREADY_RECORDED, TRIP_UNKNOWN, NOT_CONTRACTABLE,
-- SOURCE_CHANGED ; entrée mal formée ⇒ REQUEST_INVALID.
CREATE FUNCTION core.booking_cmd_record_contract(
  p_trip_id              uuid,
  p_trigger_key          text,
  p_facts                jsonb,
  p_derived              jsonb,
  p_body                 jsonb,
  p_template_id          uuid,
  p_courtesy_template_id uuid,
  p_renderer             text,
  p_sha256               bytea
)
  RETURNS TABLE (outcome text, document_id uuid, version integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t        record;
  v_prev   record;
  v_facts  jsonb;
  es       record;
  ct       record;
  v_seg    uuid;
  v_id     uuid;
  v_ver    integer;
  v_canc   jsonb;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'booking_contract' THEN
    RAISE EXCEPTION 'contract: command forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'contract_command_forbidden';
  END IF;
  v_canc := p_derived -> 'cancellation';
  IF p_trip_id IS NULL OR p_trigger_key IS NULL OR p_trigger_key !~ '^[A-Za-z0-9:._-]{1,100}$'
     OR p_facts IS NULL OR p_body IS NULL OR p_derived IS NULL
     OR pg_catalog.jsonb_typeof(p_derived) <> 'object'
     OR (p_derived - ARRAY['cancellation', 'brand']) <> '{}'::jsonb
     OR pg_catalog.jsonb_typeof(p_derived -> 'brand') IS DISTINCT FROM 'string'
     OR pg_catalog.length(p_derived ->> 'brand') NOT BETWEEN 1 AND 80
     OR (v_canc IS NOT NULL AND pg_catalog.jsonb_typeof(v_canc) <> 'null' AND (
          pg_catalog.jsonb_typeof(v_canc) <> 'object'
          OR (v_canc - ARRAY['freeUntilLocal', 'penaltyDays', 'retainedMinor', 'engineVersion'])
             <> '{}'::jsonb
          OR COALESCE(v_canc ->> 'freeUntilLocal', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$'
          OR COALESCE(v_canc ->> 'penaltyDays', '') NOT IN ('1', '1/2')
          OR COALESCE(v_canc ->> 'retainedMinor', '') !~ '^(0|[1-9][0-9]{0,14})$'
          OR COALESCE(v_canc ->> 'engineVersion', '') !~ '^[a-z0-9.-]{1,20}/[0-9]{1,3}$'))
     OR pg_catalog.jsonb_typeof(p_body) <> 'array'
     OR pg_catalog.jsonb_array_length(p_body) NOT BETWEEN 1 AND 600
     OR pg_catalog.octet_length(p_body::text) > 200000
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_body) AS e(x)
                 WHERE pg_catalog.jsonb_typeof(e.x) <> 'object'
                    OR (e.x - ARRAY['s', 't']) <> '{}'::jsonb
                    OR COALESCE(e.x ->> 's', '') NOT IN ('title', 'h', 'p', 'kv', 'note', 'sig')
                    OR pg_catalog.jsonb_typeof(e.x -> 't') IS DISTINCT FROM 'string'
                    OR pg_catalog.length(e.x ->> 't') > 2000)
     OR p_template_id IS NULL OR p_courtesy_template_id IS NULL
     OR p_renderer IS NULL OR p_renderer !~ '^ctr\.pdf/[0-9]{1,3}$'
     OR p_sha256 IS NULL OR pg_catalog.octet_length(p_sha256) <> 32 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  -- une génération à la fois par trip (deux livraisons du même événement, deux demandes)
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('contract:' || p_trip_id::text, 0));
  SELECT d.id, d.version INTO v_prev
    FROM core.contract_generated_document AS d
   WHERE d.trip_id = p_trip_id AND d.trigger_key = p_trigger_key;
  IF v_prev.id IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_RECORDED'::text, v_prev.id, v_prev.version;
    RETURN;
  END IF;

  SELECT tr.id, tr.status, tr.country_code, tr.guest_user_id INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN QUERY SELECT 'TRIP_UNKNOWN'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  IF t.status NOT IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    RETURN QUERY SELECT 'NOT_CONTRACTABLE'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  v_facts := core.booking_contract_facts(t.id);
  SELECT * INTO es FROM core.booking_contract_template(t.country_code, 'es');
  SELECT * INTO ct
    FROM core.booking_contract_template(t.country_code,
                                        core.booking_contract_courtesy_locale(t.guest_user_id));
  -- retenue écrite au contrat bornée par le total payé (08 E4 : jamais plus que l'encaissé)
  IF v_canc IS NOT NULL AND pg_catalog.jsonb_typeof(v_canc) = 'object'
     AND (p_facts #>> '{terms,priceTotalMinor}') ~ '^(0|[1-9][0-9]{0,17})$'
     AND (v_canc ->> 'retainedMinor')::numeric > (p_facts #>> '{terms,priceTotalMinor}')::numeric THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;
  IF v_facts IS NULL OR v_facts IS DISTINCT FROM p_facts
     OR es.id IS DISTINCT FROM p_template_id OR ct.id IS DISTINCT FROM p_courtesy_template_id
     OR ct.version IS DISTINCT FROM es.version THEN
    RETURN QUERY SELECT 'SOURCE_CHANGED'::text, NULL::uuid, NULL::integer;
    RETURN;
  END IF;

  SELECT s.id INTO v_seg FROM core.booking_trip_segment AS s
   WHERE s.trip_id = t.id AND s.seq = 1;
  IF v_seg IS NULL THEN
    RAISE EXCEPTION 'contract: segment 1 missing'
      USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'trip_segment_missing';
  END IF;
  -- version précédente en vigueur (non remplacée)
  SELECT d.id, d.version INTO v_prev
    FROM core.contract_generated_document AS d
   WHERE d.subject_id = v_seg
     AND NOT EXISTS (SELECT 1 FROM core.contract_generated_document AS n
                      WHERE n.supersedes_id = d.id);
  v_ver := COALESCE(v_prev.version, 0) + 1;
  v_id := platform.uuid_v7();
  INSERT INTO core.contract_generated_document
         (id, kind, template_id, courtesy_template_id, subject_type, subject_id, trip_id,
          country_code, locale, version, supersedes_id, trigger_key, terms, derived,
          renderer_version, sha256)
  VALUES (v_id, 'RENTAL_CONTRACT', es.id, ct.id, 'TRIP_SEGMENT', v_seg, t.id, t.country_code,
          ct.locale, v_ver, v_prev.id, p_trigger_key, p_facts -> 'terms', p_derived, p_renderer,
          p_sha256);
  INSERT INTO core.contract_document_party (document_id, identity, body)
  VALUES (v_id, p_facts -> 'identity', p_body);
  UPDATE core.booking_trip_segment SET contract_document_id = v_id WHERE id = v_seg;
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_role, correlation_id, payload, partition_key)
  VALUES ('contract.document.generated', 1, 'contract_document', v_id, v_ver, t.country_code,
          'SYSTEM', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('document_id', v_id, 'trip_id', t.id, 'segment_id', v_seg,
                                        'version', v_ver, 'kind', 'RENTAL_CONTRACT'),
          t.id::text);
  RETURN QUERY SELECT 'RECORDED'::text, v_id, v_ver;
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_record_contract(uuid, text, jsonb, jsonb, jsonb, uuid, uuid,
                                                     text, bytea) IS
  'Enregistre une version du contrat de location d''un trip (faits relus et comparés, gabarits en '
  'vigueur, empreinte du PDF), idempotente par clé de déclenchement ; version suivante sinon, '
  'l''ancienne reste lisible ; contract.document.generated. SECURITY DEFINER, EXECUTE app_worker '
  '(booking_contract). US-211 (ADR-143).';
REVOKE ALL ON FUNCTION core.booking_cmd_record_contract(uuid, text, jsonb, jsonb, jsonb, uuid, uuid,
                                                        text, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_cmd_record_contract(uuid, text, jsonb, jsonb, jsonb, uuid,
                                                           uuid, text, bytea) TO app_worker;

-- 4.6 Lecture d'une version par une partie du trip (SECURITY DEFINER, EXECUTE app_api) : le
-- voyageur du trip ou le TITULAIRE du compte d'hôte (session). Autre personne, trip inconnu ⇒
-- NOT_FOUND (même réponse, rien n'est révélé) ; aucun contrat ⇒ NOT_GENERATED. Version absente ⇒
-- la dernière.
CREATE FUNCTION core.booking_trip_contract(p_token_hash bytea, p_trip_id uuid, p_version integer)
  RETURNS TABLE (outcome text, viewer_role text, document_id uuid, version integer,
                 latest_version integer, locale text, generated_at timestamptz, sha256 text,
                 renderer_version text, terms jsonb, derived jsonb, body jsonb,
                 is_draft boolean, signature_id uuid, signed_at timestamptz, seal_sha256 text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user   uuid;
  t        record;
  v_role   text;
  v_latest integer;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  SELECT tr.id, tr.guest_user_id, o.holder_user_id INTO t
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
   WHERE tr.id = p_trip_id;
  v_role := CASE WHEN v_user IS NULL OR t.id IS NULL THEN NULL
                 WHEN v_user = t.guest_user_id THEN 'GUEST'
                 WHEN v_user = t.holder_user_id THEN 'HOST' END;
  IF v_role IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::uuid, NULL::integer, NULL::integer,
                        NULL::text, NULL::timestamptz, NULL::text, NULL::text, NULL::jsonb,
                        NULL::jsonb, NULL::jsonb, NULL::boolean, NULL::uuid, NULL::timestamptz,
                        NULL::text;
    RETURN;
  END IF;
  SELECT pg_catalog.max(d.version) INTO v_latest
    FROM core.contract_generated_document AS d WHERE d.trip_id = t.id;
  IF v_latest IS NULL OR (p_version IS NOT NULL AND (p_version < 1 OR p_version > v_latest)) THEN
    RETURN QUERY SELECT CASE WHEN v_latest IS NULL THEN 'NOT_GENERATED' ELSE 'NOT_FOUND' END::text,
                        v_role, NULL::uuid, NULL::integer, v_latest, NULL::text,
                        NULL::timestamptz, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb,
                        NULL::jsonb, NULL::boolean, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY
  SELECT 'OK'::text, v_role, d.id, d.version, v_latest, d.locale, d.generated_at,
         pg_catalog.encode(d.sha256, 'hex'), d.renderer_version, d.terms, d.derived,
         CASE WHEN p.pseudonymized_at IS NULL THEN p.body END,
         tpl.legal_review_ref IS NULL, s.id, s.signed_at, pg_catalog.encode(s.seal_sha256, 'hex')
    FROM core.contract_generated_document AS d
    JOIN core.contract_document_party AS p ON p.document_id = d.id
    JOIN core.contract_document_template AS tpl ON tpl.id = d.template_id
    LEFT JOIN core.contract_signature AS s
      ON s.document_id = d.id AND s.signer_user_id = t.guest_user_id AND s.signer_role = 'GUEST'
   WHERE d.trip_id = t.id AND d.version = COALESCE(p_version, v_latest);
END
$fn$;
COMMENT ON FUNCTION core.booking_trip_contract(bytea, uuid, integer) IS
  'Version du contrat de location d''un trip pour sa partie de la session (voyageur ou titulaire du '
  'compte d''hôte) : faits, texte rendu (sauf pseudonymisé), empreinte, BROUILLON, signature du '
  'voyageur ; NOT_FOUND sinon. SECURITY DEFINER, EXECUTE app_api. US-211 (ADR-143).';
REVOKE ALL ON FUNCTION core.booking_trip_contract(bytea, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_trip_contract(bytea, uuid, integer) TO app_api;

-- 4.7 Signature du voyageur (SECURITY DEFINER, EXECUTE app_api ; 16 BKG-019 SIMPLIFIÉ).
-- Issues : SIGNED, ALREADY_SIGNED (rejeu : la signature d'origine), NOT_FOUND (autre personne,
-- trip ou document inconnus : même réponse), CONTRACT_SUPERSEDED (une version plus récente
-- existe), NOT_SIGNABLE (trip annulé ou déjà remis), CONTRACT_HASH_MISMATCH (empreinte présentée ≠
-- celle du document : rien n'est écrit) ; entrée mal formée ⇒ REQUEST_INVALID.
CREATE FUNCTION core.booking_cmd_sign_contract(p_token_hash bytea, p_trip_id uuid,
                                               p_document_id uuid, p_presented_sha256 bytea)
  RETURNS TABLE (outcome text, signature_id uuid, signed_at timestamptz, seal_sha256 text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user  uuid;
  t       record;
  d       record;
  s       record;
  v_id    uuid;
  v_now   timestamptz := platform.now();
  v_seal  bytea;
BEGIN
  IF p_trip_id IS NULL OR p_document_id IS NULL OR p_presented_sha256 IS NULL
     OR pg_catalog.octet_length(p_presented_sha256) <> 32 THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  SELECT su.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS su;
  SELECT tr.id, tr.status, tr.country_code, tr.guest_user_id INTO t
    FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  IF v_user IS NULL OR t.id IS NULL OR t.guest_user_id <> v_user THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('contract:' || t.id::text, 0));
  SELECT g.id, g.version, g.sha256,
         EXISTS (SELECT 1 FROM core.contract_generated_document AS n WHERE n.supersedes_id = g.id)
           AS superseded
    INTO d
    FROM core.contract_generated_document AS g
   WHERE g.id = p_document_id AND g.trip_id = t.id;
  IF d.id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  SELECT x.id, x.signed_at, x.seal_sha256 INTO s
    FROM core.contract_signature AS x
   WHERE x.document_id = d.id AND x.signer_user_id = v_user;
  IF s.id IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_SIGNED'::text, s.id, s.signed_at,
                        pg_catalog.encode(s.seal_sha256, 'hex');
    RETURN;
  END IF;
  IF d.superseded THEN
    RETURN QUERY SELECT 'CONTRACT_SUPERSEDED'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  IF t.status NOT IN ('BOOKED', 'CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    RETURN QUERY SELECT 'NOT_SIGNABLE'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  IF p_presented_sha256 <> d.sha256 THEN
    RETURN QUERY SELECT 'CONTRACT_HASH_MISMATCH'::text, NULL::uuid, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;
  v_id := platform.uuid_v7();
  -- sceau du bloc de signature : version du sceau, empreinte du document, signature, rôle, heure
  -- serveur (ISO 8601 UTC, millisecondes)
  v_seal := pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.concat_ws('|', 'ctr.seal/1',
              pg_catalog.encode(d.sha256, 'hex'), v_id::text, 'GUEST',
              pg_catalog.to_char(v_now AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
              'UTF8'));
  INSERT INTO core.contract_signature
         (id, document_id, trip_id, signer_user_id, signer_role, method, signed_at,
          document_sha256, seal_sha256, c2_withheld)
  VALUES (v_id, d.id, t.id, v_user, 'GUEST', 'CLICKWRAP', v_now, d.sha256, v_seal, true);
  INSERT INTO core.outbox_outbox_event
         (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
          actor_user_id, actor_role, correlation_id, payload, partition_key)
  VALUES ('contract.document.signed', 1, 'contract_document', d.id, d.version, t.country_code,
          v_user, 'GUEST', pg_catalog.gen_random_uuid(),
          pg_catalog.jsonb_build_object('document_id', d.id, 'trip_id', t.id,
                                        'version', d.version, 'signature_id', v_id,
                                        'signer_role', 'GUEST'),
          t.id::text);
  RETURN QUERY SELECT 'SIGNED'::text, v_id, v_now, pg_catalog.encode(v_seal, 'hex');
END
$fn$;
COMMENT ON FUNCTION core.booking_cmd_sign_contract(bytea, uuid, uuid, bytea) IS
  'Signature électronique simple de la dernière version du contrat par le voyageur de la session '
  '(empreinte présentée = empreinte du document, sinon CONTRACT_HASH_MISMATCH), heure serveur, '
  'sceau ; C2 retenues ; contract.document.signed. SECURITY DEFINER, EXECUTE app_api. US-211 '
  '(ADR-143).';
REVOKE ALL ON FUNCTION core.booking_cmd_sign_contract(bytea, uuid, uuid, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_cmd_sign_contract(bytea, uuid, uuid, bytea) TO app_api;

-- 4.8 Contrat signé (SECURITY INVOKER, interne) : la dernière version est signée par le voyageur
CREATE FUNCTION core.booking_trip_contract_signed(p_trip_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM core.contract_generated_document AS d
      JOIN core.booking_trip AS t ON t.id = d.trip_id
      JOIN core.contract_signature AS s
        ON s.document_id = d.id AND s.signer_user_id = t.guest_user_id AND s.signer_role = 'GUEST'
     WHERE d.trip_id = p_trip_id
       AND NOT EXISTS (SELECT 1 FROM core.contract_generated_document AS n
                        WHERE n.supersedes_id = d.id))
$fn$;
REVOKE ALL ON FUNCTION core.booking_trip_contract_signed(uuid) FROM PUBLIC;

-- 4.9 Transition de cycle de vie (corps de 0099 recopié ; US-211 : la remise exige le contrat signé)
CREATE OR REPLACE FUNCTION core.booking_cmd_trip_transition(
  p_trip_id              uuid,
  p_to_status            text,
  p_reason_code          text,
  p_expected_row_version integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t         record;
  v_via     text;
  v_minutes integer;
  v_version integer;
BEGIN
  SELECT * INTO t FROM core.booking_trip_lock(p_trip_id, p_expected_row_version);
  SELECT tt.via INTO v_via FROM core.booking_trip_transition tt
   WHERE tt.from_status = t.status AND tt.to_status = p_to_status;
  IF v_via IS DISTINCT FROM 'TRANSITION' OR p_reason_code IS NULL
     OR p_reason_code !~ '^[A-Z][A-Z0-9_]{1,63}$' OR p_reason_code = 'HOLD_CONVERTED' THEN
    RAISE EXCEPTION 'trip: transition not allowed by SM-1'
      USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_transition_forbidden',
            DETAIL = pg_catalog.format('trip %s: %s -> %s', t.id, t.status, p_to_status);
  END IF;

  IF p_to_status = 'START_WINDOW_EXPIRED' THEN
    IF t.no_show_at IS NULL THEN
      RAISE EXCEPTION 'trip: no_show_at unknown'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
    END IF;
    IF platform.now() < t.no_show_at THEN
      RAISE EXCEPTION 'trip: start window not expired yet'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_transition_too_early';
    END IF;
  ELSIF p_to_status = 'OVERDUE' THEN
    v_minutes := core.booking_param_int('overdue_detection_minutes', t.country_code);
    IF v_minutes IS NULL THEN
      RAISE EXCEPTION 'trip: parameter overdue_detection_minutes missing'
        USING ERRCODE = 'object_not_in_prerequisite_state', CONSTRAINT = 'trip_param_missing';
    END IF;
    IF platform.now() < t.scheduled_end + pg_catalog.make_interval(mins => v_minutes) THEN
      RAISE EXCEPTION 'trip: not overdue yet'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_transition_too_early';
    END IF;
  ELSIF p_to_status = 'IN_PROGRESS' AND t.status IN ('CHECKIN_OPEN', 'START_WINDOW_EXPIRED') THEN
    IF p_reason_code <> 'CHECKIN_VALIDATED' OR NOT EXISTS (
         SELECT 1 FROM core.booking_trip_driver d
          WHERE d.trip_id = t.id AND d.role = 'PRIMARY' AND d.approved_at IS NOT NULL) THEN
      RAISE EXCEPTION 'trip: IN_PROGRESS requires a validated check-in and an approved driver'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_transition_forbidden';
    END IF;
    -- US-211 (16 BKG-018 : « Given un contrat non signé, When l'hôte tente de valider la remise,
    -- Then refus ») : la dernière version du contrat doit être signée par le voyageur
    IF NOT core.booking_trip_contract_signed(t.id) THEN
      RAISE EXCEPTION 'trip: rental contract not signed by the guest'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_contract_not_signed';
    END IF;
  ELSIF p_to_status = 'TERMINATED_EARLY' THEN
    IF p_reason_code NOT IN ('TERM_BREAKDOWN_NOT_GUEST', 'TERM_PLATFORM_NOT_GUEST',
                             'TERM_GUEST_FAULT', 'TERM_PAYMENT_FAILURE',
                             'TERM_ACCIDENT_PENDING') THEN
      RAISE EXCEPTION 'trip: TERMINATED_EARLY requires a termination reason (22 to 26)'
        USING ERRCODE = 'object_not_in_prerequisite_state',
              CONSTRAINT = 'trip_transition_forbidden';
    END IF;
  END IF;

  v_version := core.booking_trip_apply_transition(t.id, t.status, p_to_status, p_reason_code,
                                                  NULL, 'SYSTEM', 'TRANSITION', '{}'::jsonb);
  RETURN pg_catalog.jsonb_build_object('tripId', t.id, 'from', t.status, 'status', p_to_status,
                                       'reason', p_reason_code, 'rowVersion', v_version);
END
$fn$;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 5. Fonctions d'autres propriétaires appelées par cmd_hold_owner -------------------------------
-- (aucune : session résolue par core.iam_session_resolve, déjà exécutable par cmd_hold_owner)
