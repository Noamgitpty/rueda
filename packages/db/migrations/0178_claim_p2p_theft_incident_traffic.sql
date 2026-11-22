-- 0178 — CLM : sinistres entre particuliers. Vol présumé après la non-restitution (dossier de vol,
-- déclaration à l'assureur partenaire journalisée, versement de l'hôte retenu), incident ou accident
-- déclaré par le voyageur avec photos et heure serveur, amendes, péages et fourrière refacturés au
-- voyageur par débit séparé avec frais de gestion.
-- US-318 ; 19 US-318 (critères 1 à 3) ; 16 TRP-038, ADM-022, CLM-002 ; 08 BR-RETURN-04,
-- BR-DAMAGE-01, BR-TT-01 à BR-TT-05, BR-PROT-05, BR-PRICE-15, BR-REIMB-04 ; 17 v6 §2.2 (CLM :
-- `incident_report`), §3.2.10 (`overdue_case`, `inspection`), §7.2 ; 22 OQ-BR-17, OQ-BR-19 ;
-- NOUVELLE-18 de l'analyse pivot §e.5 ; ADR-179 (photos guidées), ADR-182 (aide et urgence, S17),
-- ADR-189 (débits post-trip), ADR-193 (escalade de non-restitution), ADR-195 (sinistres) ; ADR-198
-- (cette migration, PROPOSÉ). Pré-mortem du lot 3 : L3-PM-17. Appliquée sous `migrator`, en une
-- transaction.
--
-- Principes (ADR-198, PROPOSÉS, fail-closed, comme Turo adapté au PA / PY) :
--   1. Vol présumé (19 critère 1) : quand l'escalade de l'ops (US-306) atteint l'étape T24H
--      (« plainte pré-remplie remise à l'hôte, qui la dépose »), le travailleur `payment_command`
--      ouvre le dossier de vol du trip (`claim_theft_case`, SM-4 THEFT_INVESTIGATION), y
--      journalise la déclaration à l'assureur partenaire (PENDING) et retient le versement de
--      l'hôte (motif CLAIM de `core.payout_batch_hold_reasons`). La déclaration n'est envoyée par
--      le port de l'assureur que si `insurer_contract_active[pays]` est vrai (lu en base, absent ⇒
--      faux). Trip rendu (sorti d'OVERDUE / UNRETURNED / VEHICLE_LOST) : dossier clos RETURNED,
--      déclaration non envoyée retirée (WITHDRAWN), retenue levée. La plateforme ne dépose aucune
--      plainte, ne récupère ni ne coupe aucun véhicule (OQ-BR-17) ; le statut du trip reste celui
--      de la machine à états (UNRETURNED non posé, ADR-193 point 8).
--   2. Incident ou accident du voyageur (19 critère 2) : depuis S17, après la demande d'aide du
--      trip (ACCIDENT ou BREAKDOWN, 0162 : numéros du pays du trip, assistance de l'assureur en
--      donnée de pays), le voyageur photographie par la chaîne existante d'US-303 (série
--      `INCIDENT` de `trip_ops_inspection`, jetons de capture, empreinte, heure serveur : rien
--      n'est dupliqué) puis ouvre l'incident (`claim_incident_report`) : au moins une photo,
--      heure de la base, dossier de support rattaché. Seul le voyageur du trip, pendant le trip.
--   3. Amendes, péages, fourrière (19 critère 3, 08 BR-TT-02 à 04) : le titulaire du compte
--      d'hôte déclare, avec la pièce photographiée dans sa série `TRAFFIC` (même chaîne), un
--      montant payé par lui pour un fait survenu pendant le trip ([début effectif, fin effective]),
--      au plus tard à fin effective + `traffic_charge_deadline_days` (120 j, 08 BR-TT-02 [NOUS]) ;
--      au-delà ⇒ `TRAFFIC_CHARGE_DEADLINE_PASSED` (rien n'est écrit). Frais de gestion =
--      roundHalfUp(montant × `traffic_charge_admin_fee_bps` / 10 000) (5 %, BR-PRICE-15 [NOUS]),
--      à la charge du voyageur (BR-REIMB-04) ; jambes explicites : HOST = montant (100 %), PLATFORM
--      = frais, INSURER = TAX_THIRD_PARTY = 0 (frais toutes taxes de la plateforme comprises,
--      PROPOSÉ). Débit séparé d'US-703 (but INCIDENTAL, motif DELAYED_CHARGES, origine
--      TRAFFIC_CHARGE) notifié par le travailleur `payment_command`, jamais la caution. Refacturation
--      seule, sans transfert de l'amende au conducteur (OQ-BR-19) ; parking de récupération exclu
--      (BR-TT-05 : aucune catégorie). Paramètre absent ⇒ refus (`TRAFFIC_*_UNKNOWN`).
--   4. Écritures par commandes seulement ; RLS ENABLE + FORCE ; aucun droit applicatif sur les
--      tables ; heure de la base ; aucune constante de pays ; aucun interrupteur écrit.
--
-- Codes (packages/db/src/errors.ts) : claim_p2p_command_forbidden (42501) → FORBIDDEN ;
-- claim_p2p_record_immutable (23000) → IMMUTABLE_RECORD.
--
-- Expand / contract : tables, fonctions, politiques et droits AJOUTÉS ; contrainte
-- `trip_inspection_kind_valid` remplacée sous le même nom (élargie : INCIDENT, TRAFFIC) ;
-- `core.trip_inspection_party` et `core.payout_batch_hold_reasons` remplacées à signature identique
-- (corps de 0158 et de 0175 recopiés, élargis). La version N de l'API n'appelle pas les nouvelles
-- fonctions.
--
-- Retour arrière (jamais en production : nouvelle migration) :
--   réappliquer core.payout_batch_hold_reasons de 0175 (sous cmd_money_owner) et
--     core.trip_inspection_party de 0158 (sous cmd_hold_owner) ;
--   DROP FUNCTION core.claim_cmd_report_incident(bytea, uuid, uuid, uuid, boolean, boolean),
--     core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text, timestamptz, bigint, uuid),
--     core.claim_host_trip_claims(bytea, uuid), core.claim_traffic_charge_legs(bigint, integer),
--     core.claim_theft_cases_due(integer), core.claim_cmd_open_theft_case(uuid),
--     core.claim_cmd_close_theft_case(uuid), core.claim_theft_declarations_due(integer),
--     core.claim_cmd_record_theft_declaration(uuid, text), core.claim_traffic_charges_due(integer),
--     core.claim_cmd_execute_traffic_charge(uuid, uuid),
--     core.claim_cmd_defer_traffic_charge(uuid, text), core.claim_p2p_guard() ;
--   DROP POLICY cmd_hold_incident_case_sel ON core.support_support_case ;
--   DROP POLICY cmd_hold_traffic_param_read ON core.config_param_value ;
--   DROP POLICY cmd_money_theft_overdue_sel ON core.trip_ops_overdue_case ;
--   révoquer les droits de colonnes accordés à cmd_hold_owner (support_support_case, booking_trip)
--     et à cmd_money_owner (trip_ops_overdue_case, booking_trip) ;
--   remettre trip_inspection_kind_valid (CHECKIN, CHECKOUT) — base sans série INCIDENT / TRAFFIC ;
--   DROP TABLE core.claim_traffic_charge, core.claim_incident_report, core.claim_theft_case ;
--   DELETE des valeurs puis des définitions des paramètres « traffic_charge_* ».

-- 0. Paramètres du pays (bloc généré, POST_SEED_PARAMS « traffic_charge_ », embedded) ---------
-- 0178 — graine complémentaire : paramètres « traffic_charge_* » (US-318 ; 17 §7.2).
-- FICHIER GÉNÉRÉ depuis apps/api/src/modules/cfg/data/params.json par seed-sql.ts
-- (renderParamSeedSql) : ne pas l’éditer à la main (test seed-sql.test.ts). Appliquée sous
-- `migrator`. 0009 est immuable (ADR-044) : elle reste rendue sans ces paramètres (ADR-075).
-- Valeurs PROPOSÉES ; valid_from posé par la garde (platform.now()).
--
-- Retour arrière (base sans dépendance) : DELETE des valeurs puis des définitions dont la clé
-- commence par « traffic_charge_ » ; jamais en production : nouvelle migration à la place.
INSERT INTO core.config_param_definition (key, type, unit, allowed_scopes, currency_bound, fail_mode, optional, go_live_switch, not_applicable_in, allowed_values, source_ref, status) VALUES
  ('traffic_charge_admin_fee_bps', 'BPS', NULL, ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-PRICE-15 [NOUS] (frais de gestion 5 % des frais annexes), BR-REIMB-04 (facturés au voyageur, pas prélevés sur l’hôte), BR-TT-02 à 04 ; 19 US-318 ; ADR-198 : frais de gestion d’une amende, d’un péage ou d’une fourrière refacturés au voyageur = roundHalfUp(montant × bps / 10 000), jambe PLATFORM, taxes de la plateforme comprises ; absent ou hors [0 ; 10 000] : refacturation refusée (TRAFFIC_FEE_UNKNOWN, fail-closed)', 'PROPOSÉ comme Turo (ADR-198) : Turo prend 3 % ; 08 recommande 5 % au PA / PY (coût PSP local) ; aucun plafond (Turo n''en a pas) : plafond de BR-PRICE-15 renvoyé au fondateur (POUR_LE_FONDATEUR)'),
  ('traffic_charge_deadline_days', 'DURATION', 'd', ARRAY['COUNTRY']::text[], false, 'BLOCK', false, false, '{}'::text[], NULL, '08 BR-TT-02 / BR-TT-03 [NOUS] (péages et PV : fin effective + 120 j, lenteur des avis ATTT), « Échéances exécutables » de BR-REIMB (end_effective = check-out ?? fin prévue) ; 19 US-318 ; ADR-198 : déclaration d’une amende, d’un péage ou d’une fourrière par l’hôte au plus tard à fin effective + ce délai (heure de la base) ; au-delà : TRAFFIC_CHARGE_DEADLINE_PASSED ; absent ou non positif : refus (TRAFFIC_WINDOW_UNKNOWN, fail-closed)', 'PROPOSÉ comme Turo (ADR-198) : Turo 90 j ; 08 retient 120 j au PA / PY');

INSERT INTO core.config_param_value (key, country_code, scope_type, scope_id, network, value, change_reason) VALUES
  ('traffic_charge_admin_fee_bps', 'PA', 'COUNTRY', NULL, NULL, '500'::jsonb, 'graine US-318 : défauts PROPOSÉS (08 BR-TT-02 à 04, BR-PRICE-15 ; ADR-198)'),
  ('traffic_charge_admin_fee_bps', 'PY', 'COUNTRY', NULL, NULL, '500'::jsonb, 'graine US-318 : défauts PROPOSÉS (08 BR-TT-02 à 04, BR-PRICE-15 ; ADR-198)'),
  ('traffic_charge_deadline_days', 'PA', 'COUNTRY', NULL, NULL, '120'::jsonb, 'graine US-318 : défauts PROPOSÉS (08 BR-TT-02 à 04, BR-PRICE-15 ; ADR-198)'),
  ('traffic_charge_deadline_days', 'PY', 'COUNTRY', NULL, NULL, '120'::jsonb, 'graine US-318 : défauts PROPOSÉS (08 BR-TT-02 à 04, BR-PRICE-15 ; ADR-198)');

-- Fail-closed : chaque paramètre du groupe a une valeur dans chaque pays déclaré.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM core.config_param_definition AS d
              CROSS JOIN core.config_country AS c
             WHERE d.key LIKE 'traffic\_charge\_%'
               AND NOT EXISTS (SELECT 1 FROM core.config_param_value AS v
                                WHERE v.key = d.key AND v.country_code = c.code)) THEN
    RAISE EXCEPTION 'graine : paramètre traffic_charge_* sans valeur pour un pays' USING ERRCODE = 'check_violation';
  END IF;
END
$check$;

-- 1. Tables ---------------------------------------------------------------------------------------

-- 1.1 Dossier de vol présumé (16 TRP-038 « déclaration de vol ouverte en SM-4 » ; classe A)
CREATE TABLE core.claim_theft_case (
  id               uuid        CONSTRAINT claim_theft_case_pkey PRIMARY KEY,
  trip_id          uuid        NOT NULL
    CONSTRAINT claim_theft_case_trip_unique UNIQUE,
  country_code     text        NOT NULL
    CONSTRAINT claim_theft_case_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  org_id           uuid        NOT NULL
    CONSTRAINT claim_theft_case_org_fk REFERENCES core.iam_organization (id),
  status           text        NOT NULL DEFAULT 'THEFT_INVESTIGATION'
    CONSTRAINT claim_theft_case_status_valid CHECK (status IN ('THEFT_INVESTIGATION', 'RETURNED')),
  opened_at        timestamptz NOT NULL DEFAULT platform.now(),
  closed_at        timestamptz,
  -- déclaration à l'assureur partenaire (journal ; sans engagement de prise en charge, OQ-P2P-03)
  insurer_status   text        NOT NULL DEFAULT 'PENDING'
    CONSTRAINT claim_theft_case_insurer_valid CHECK (insurer_status IN ('PENDING', 'SENT', 'WITHDRAWN')),
  insurer_sent_at  timestamptz,
  -- référence rendue par le port de l'assureur (FAKE en tests) ; jamais une donnée personnelle
  insurer_ref      text
    CONSTRAINT claim_theft_case_ref_format CHECK (
      insurer_ref IS NULL OR insurer_ref ~ '^[A-Za-z0-9:._-]{1,100}$'),
  CONSTRAINT claim_theft_case_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  CONSTRAINT claim_theft_case_closed_shape CHECK ((status = 'RETURNED') = (closed_at IS NOT NULL)),
  CONSTRAINT claim_theft_case_sent_shape CHECK (
    (insurer_status = 'SENT') = (insurer_sent_at IS NOT NULL)
    AND (insurer_status = 'SENT') = (insurer_ref IS NOT NULL))
);
COMMENT ON TABLE core.claim_theft_case IS
  'CLM : dossier de vol présumé d''un trip non rendu (16 TRP-038, SM-4 THEFT_INVESTIGATION), ouvert '
  'quand l''escalade atteint T24H ; déclaration à l''assureur journalisée, envoyée seulement si '
  'insurer_contract_active[pays] ; clos RETURNED au retour. Écrit par le travailleur '
  'payment_command seulement. US-318 (ADR-198).';

-- 1.2 Incident ou accident déclaré par le voyageur (17 §2.2 `incident_report`, 16 CLM-002 ; classe A)
CREATE TABLE core.claim_incident_report (
  id                uuid        CONSTRAINT claim_incident_report_pkey PRIMARY KEY,
  trip_id           uuid        NOT NULL,
  country_code      text        NOT NULL
    CONSTRAINT claim_incident_report_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  -- demande d'aide du trip (0162) ouverte par le voyageur : la file du support la voit
  case_id           uuid        NOT NULL
    CONSTRAINT claim_incident_report_case_fk REFERENCES core.support_support_case (id)
    CONSTRAINT claim_incident_report_case_unique UNIQUE,
  reporter_user_id  uuid        NOT NULL
    CONSTRAINT claim_incident_report_reporter_fk REFERENCES core.iam_user_account (id),
  kind              text        NOT NULL
    CONSTRAINT claim_incident_report_kind_valid CHECK (kind IN ('ACCIDENT', 'BREAKDOWN')),
  third_party       boolean     NOT NULL,
  police_report     boolean     NOT NULL,
  -- série INCIDENT d'US-303 (photos, empreintes, heure serveur) et photos présentes à la déclaration
  inspection_id     uuid        NOT NULL
    CONSTRAINT claim_incident_report_inspection_fk REFERENCES core.trip_ops_inspection (id),
  photo_file_ids    uuid[]      NOT NULL
    CONSTRAINT claim_incident_report_photos_present CHECK (
      pg_catalog.cardinality(photo_file_ids) BETWEEN 1 AND 100),
  request_id        uuid        NOT NULL
    CONSTRAINT claim_incident_report_request_unique UNIQUE,
  reported_at       timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT claim_incident_report_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code)
);
CREATE INDEX claim_incident_report_trip_idx ON core.claim_incident_report (trip_id);
COMMENT ON TABLE core.claim_incident_report IS
  'CLM incident_report (17 §2.2, 16 CLM-002) : incident ou accident déclaré par le voyageur depuis '
  'S17, rattaché à sa demande d''aide (0162) et aux photos de sa série INCIDENT (US-303), heure de '
  'la base. Écrit par core.claim_cmd_report_incident seulement. US-318 (ADR-198).';

-- 1.3 Amende, péage ou fourrière refacturés au voyageur (08 BR-TT-02 à 04 ; classe A)
CREATE TABLE core.claim_traffic_charge (
  id                        uuid        CONSTRAINT claim_traffic_charge_pkey PRIMARY KEY,
  trip_id                   uuid        NOT NULL,
  country_code              text        NOT NULL
    CONSTRAINT claim_traffic_charge_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency                  text        NOT NULL
    CONSTRAINT claim_traffic_charge_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  org_id                    uuid        NOT NULL
    CONSTRAINT claim_traffic_charge_org_fk REFERENCES core.iam_organization (id),
  -- titulaire du compte d'hôte relu en base (jamais un co-hôte, BR-COHOST-02)
  declared_by               uuid        NOT NULL
    CONSTRAINT claim_traffic_charge_declared_by_fk REFERENCES core.iam_user_account (id),
  kind                      text        NOT NULL
    CONSTRAINT claim_traffic_charge_kind_valid CHECK (kind IN ('TOLL', 'FINE', 'IMPOUND')),
  occurred_at               timestamptz NOT NULL,
  -- pièce : photo de la série TRAFFIC de l'hôte (US-303), une charge par pièce
  file_id                   uuid        NOT NULL
    CONSTRAINT claim_traffic_charge_file_fk REFERENCES core.audit_file_asset (id)
    CONSTRAINT claim_traffic_charge_file_unique UNIQUE,
  amount_minor              bigint      NOT NULL
    CONSTRAINT claim_traffic_charge_amount_positive CHECK (amount_minor > 0),
  fee_bps                   integer     NOT NULL
    CONSTRAINT claim_traffic_charge_fee_bps_range CHECK (fee_bps BETWEEN 0 AND 10000),
  admin_fee_minor           bigint      NOT NULL
    CONSTRAINT claim_traffic_charge_fee_nonneg CHECK (admin_fee_minor >= 0),
  total_minor               bigint      NOT NULL,
  leg_host_minor            bigint      NOT NULL,
  leg_insurer_minor         bigint      NOT NULL,
  leg_tax_third_party_minor bigint      NOT NULL,
  leg_platform_minor        bigint      NOT NULL,
  trip_start_at             timestamptz NOT NULL,
  trip_end_at               timestamptz NOT NULL,
  deadline_at               timestamptz NOT NULL,
  request_id                uuid        NOT NULL
    CONSTRAINT claim_traffic_charge_request_unique UNIQUE,
  declared_at               timestamptz NOT NULL DEFAULT platform.now(),
  execution_status          text        NOT NULL DEFAULT 'PENDING'
    CONSTRAINT claim_traffic_charge_execution_valid CHECK (
      execution_status IN ('PENDING', 'DONE', 'BLOCKED')),
  execution_code            text
    CONSTRAINT claim_traffic_charge_code_format CHECK (
      execution_code IS NULL OR execution_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  charge_id                 uuid
    CONSTRAINT claim_traffic_charge_charge_fk REFERENCES core.payment_post_trip_charge (id),
  executed_at               timestamptz,
  next_check_at             timestamptz NOT NULL DEFAULT platform.now(),
  CONSTRAINT claim_traffic_charge_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  -- jambes explicites (jamais un prorata) : HOST = montant payé par l'hôte, PLATFORM = frais
  CONSTRAINT claim_traffic_charge_legs_shape CHECK (
    leg_host_minor = amount_minor AND leg_platform_minor = admin_fee_minor
    AND leg_insurer_minor = 0 AND leg_tax_third_party_minor = 0
    AND total_minor = amount_minor + admin_fee_minor
    AND leg_host_minor + leg_insurer_minor + leg_tax_third_party_minor + leg_platform_minor
        = total_minor),
  CONSTRAINT claim_traffic_charge_in_trip CHECK (
    occurred_at >= trip_start_at AND occurred_at <= trip_end_at AND trip_start_at < trip_end_at),
  CONSTRAINT claim_traffic_charge_in_time CHECK (
    declared_at <= deadline_at AND deadline_at > trip_end_at AND occurred_at <= declared_at),
  CONSTRAINT claim_traffic_charge_executed_shape CHECK (
    (execution_status = 'DONE') = (executed_at IS NOT NULL)
    AND (execution_status = 'DONE') = (charge_id IS NOT NULL)
    AND (execution_status <> 'BLOCKED' OR execution_code IS NOT NULL))
);
CREATE INDEX claim_traffic_charge_due_idx ON core.claim_traffic_charge (next_check_at)
  WHERE (execution_status = 'PENDING');
CREATE INDEX claim_traffic_charge_trip_idx ON core.claim_traffic_charge (trip_id);
COMMENT ON TABLE core.claim_traffic_charge IS
  'CLM : amende, péage ou fourrière payés par l''hôte pour la période du trip, déclarés avec la '
  'pièce dans le délai (08 BR-TT-02 à 04), refacturés au voyageur par débit séparé (US-703) avec '
  'frais de gestion, jambes explicites ; sans transfert de l''amende (OQ-BR-19). Écrit par '
  'core.claim_cmd_declare_traffic_charge, exécuté par le travailleur payment_command. US-318 '
  '(ADR-198).';

-- 1.4 Garde : registres jamais supprimés ; transitions bornées
CREATE FUNCTION core.claim_p2p_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'claim_theft_case' THEN
    -- THEFT_INVESTIGATION → RETURNED (une fois) ; déclaration PENDING → SENT | WITHDRAWN
    IF (NEW.id, NEW.trip_id, NEW.country_code, NEW.org_id, NEW.opened_at)
         IS NOT DISTINCT FROM (OLD.id, OLD.trip_id, OLD.country_code, OLD.org_id, OLD.opened_at)
       AND (NEW.status = OLD.status AND NEW.closed_at IS NOT DISTINCT FROM OLD.closed_at
            OR (OLD.status = 'THEFT_INVESTIGATION' AND NEW.status = 'RETURNED'))
       AND (NEW.insurer_status = OLD.insurer_status
            AND NEW.insurer_sent_at IS NOT DISTINCT FROM OLD.insurer_sent_at
            AND NEW.insurer_ref IS NOT DISTINCT FROM OLD.insurer_ref
            OR (OLD.insurer_status = 'PENDING' AND NEW.insurer_status IN ('SENT', 'WITHDRAWN'))) THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'claim_traffic_charge' THEN
    -- seule l'exécution change : PENDING → DONE | BLOCKED, le débit rattaché une fois
    IF (NEW.id, NEW.trip_id, NEW.country_code, NEW.currency, NEW.org_id, NEW.declared_by, NEW.kind,
        NEW.occurred_at, NEW.file_id, NEW.amount_minor, NEW.fee_bps, NEW.admin_fee_minor,
        NEW.total_minor, NEW.leg_host_minor, NEW.leg_insurer_minor, NEW.leg_tax_third_party_minor,
        NEW.leg_platform_minor, NEW.trip_start_at, NEW.trip_end_at, NEW.deadline_at,
        NEW.request_id, NEW.declared_at)
       IS NOT DISTINCT FROM
       (OLD.id, OLD.trip_id, OLD.country_code, OLD.currency, OLD.org_id, OLD.declared_by, OLD.kind,
        OLD.occurred_at, OLD.file_id, OLD.amount_minor, OLD.fee_bps, OLD.admin_fee_minor,
        OLD.total_minor, OLD.leg_host_minor, OLD.leg_insurer_minor, OLD.leg_tax_third_party_minor,
        OLD.leg_platform_minor, OLD.trip_start_at, OLD.trip_end_at, OLD.deadline_at,
        OLD.request_id, OLD.declared_at)
       AND (OLD.charge_id IS NULL OR NEW.charge_id IS NOT DISTINCT FROM OLD.charge_id)
       AND (OLD.execution_status = 'PENDING'
            OR (OLD.execution_status = NEW.execution_status
                AND NEW.executed_at IS NOT DISTINCT FROM OLD.executed_at)) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'claim p2p: % refused on %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation', CONSTRAINT = 'claim_p2p_record_immutable';
END
$fn$;
COMMENT ON FUNCTION core.claim_p2p_guard() IS
  'Garde des registres d''US-318 : dossier de vol THEFT_INVESTIGATION → RETURNED, déclaration à '
  'l''assureur PENDING → SENT | WITHDRAWN ; incident immuable ; refacturation figée (seule son '
  'exécution change) ; jamais de DELETE ni de TRUNCATE. US-318 (ADR-198).';
REVOKE ALL ON FUNCTION core.claim_p2p_guard() FROM PUBLIC;
CREATE TRIGGER claim_p2p_immutable BEFORE UPDATE OR DELETE ON core.claim_theft_case
  FOR EACH ROW EXECUTE FUNCTION core.claim_p2p_guard();
CREATE TRIGGER claim_p2p_immutable BEFORE UPDATE OR DELETE ON core.claim_incident_report
  FOR EACH ROW EXECUTE FUNCTION core.claim_p2p_guard();
CREATE TRIGGER claim_p2p_immutable BEFORE UPDATE OR DELETE ON core.claim_traffic_charge
  FOR EACH ROW EXECUTE FUNCTION core.claim_p2p_guard();
CREATE TRIGGER claim_p2p_no_truncate BEFORE TRUNCATE ON core.claim_theft_case
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_p2p_record_immutable');
CREATE TRIGGER claim_p2p_no_truncate BEFORE TRUNCATE ON core.claim_incident_report
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_p2p_record_immutable');
CREATE TRIGGER claim_p2p_no_truncate BEFORE TRUNCATE ON core.claim_traffic_charge
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('claim_p2p_record_immutable');

-- 1.5 RLS : aucun droit applicatif
ALTER TABLE core.claim_theft_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.claim_theft_case FORCE ROW LEVEL SECURITY;
ALTER TABLE core.claim_incident_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.claim_incident_report FORCE ROW LEVEL SECURITY;
ALTER TABLE core.claim_traffic_charge ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.claim_traffic_charge FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.claim_theft_case TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.claim_incident_report TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.claim_traffic_charge TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.claim_theft_case, core.claim_incident_report, core.claim_traffic_charge
  FROM PUBLIC;

-- 1.6 Séries de photos d'US-303 : deux types de plus, même chaîne (jetons, empreinte, heure
-- serveur) ; INCIDENT (voyageur, pendant le trip) et TRAFFIC (titulaire, pièces après le retour)
ALTER TABLE core.trip_ops_inspection
  DROP CONSTRAINT trip_inspection_kind_valid,
  ADD CONSTRAINT trip_inspection_kind_valid
    CHECK (kind IN ('CHECKIN', 'CHECKOUT', 'INCIDENT', 'TRAFFIC'));

-- 2. Commandes des parties du trip (cmd_hold_owner, EXECUTE app_api) -------------------------------
GRANT SELECT, INSERT ON core.claim_incident_report TO cmd_hold_owner;
CREATE POLICY cmd_hold_incident_sel ON core.claim_incident_report FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_incident_ins ON core.claim_incident_report FOR INSERT TO cmd_hold_owner
  WITH CHECK (true);
GRANT SELECT, INSERT ON core.claim_traffic_charge TO cmd_hold_owner;
CREATE POLICY cmd_hold_traffic_sel ON core.claim_traffic_charge FOR SELECT TO cmd_hold_owner
  USING (true);
CREATE POLICY cmd_hold_traffic_ins ON core.claim_traffic_charge FOR INSERT TO cmd_hold_owner
  WITH CHECK (execution_status = 'PENDING' AND charge_id IS NULL AND executed_at IS NULL);
-- dossier de vol lu par l'hôte de son trip (état, déclaration à l'assureur), jamais écrit
GRANT SELECT (trip_id, status, opened_at, closed_at, insurer_status)
  ON core.claim_theft_case TO cmd_hold_owner;
CREATE POLICY cmd_hold_theft_sel ON core.claim_theft_case FOR SELECT TO cmd_hold_owner
  USING (true);
-- demande d'aide du voyageur (0162) : colonnes non personnelles, demandes d'accident ou de panne
GRANT SELECT (id, requester_user_id, trip_id, help_topic, status)
  ON core.support_support_case TO cmd_hold_owner;
CREATE POLICY cmd_hold_incident_case_sel ON core.support_support_case FOR SELECT
  TO cmd_hold_owner USING (help_topic IN ('ACCIDENT', 'BREAKDOWN'));
-- début effectif du trip (remise validée) et fuseau
GRANT SELECT (scheduled_start, checkin_validated_at) ON core.booking_trip TO cmd_hold_owner;
-- délai et frais de gestion du pays (17 §7.2, ce groupe)
CREATE POLICY cmd_hold_traffic_param_read ON core.config_param_value FOR SELECT
  TO cmd_hold_owner USING (key IN ('traffic_charge_deadline_days', 'traffic_charge_admin_fee_bps'));

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

-- 2.1 Partie de la session (0158, même signature, corps recopié et élargi) : INCIDENT = voyageur du
-- trip seulement, ouverte IN_PROGRESS / OVERDUE ; TRAFFIC = titulaire du compte d'hôte seulement,
-- ouverte après le retour (RETURNED, POST_TRIP, COMPLETED, IN_DISPUTE).
CREATE OR REPLACE FUNCTION core.trip_inspection_party(p_token_hash bytea, p_trip_id uuid, p_kind text)
  RETURNS TABLE (user_id uuid, role text, trip_id uuid, country_code text, open boolean)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user uuid;
  t      record;
BEGIN
  IF p_token_hash IS NULL OR p_trip_id IS NULL OR p_kind IS NULL
     OR p_kind NOT IN ('CHECKIN', 'CHECKOUT', 'INCIDENT', 'TRAFFIC') THEN
    RETURN;
  END IF;
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN;
  END IF;
  SELECT tr.id, tr.guest_user_id, tr.country_code, tr.status, o.holder_user_id INTO t
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
   WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT v_user,
         CASE WHEN v_user = t.guest_user_id THEN 'GUEST' ELSE 'HOST' END,
         t.id, t.country_code,
         CASE p_kind WHEN 'CHECKIN' THEN t.status = 'CHECKIN_OPEN'
                     WHEN 'TRAFFIC' THEN t.status IN ('RETURNED', 'POST_TRIP', 'COMPLETED',
                                                      'IN_DISPUTE')
                     ELSE t.status IN ('IN_PROGRESS', 'OVERDUE') END
   WHERE (v_user = t.guest_user_id OR v_user = t.holder_user_id)
     AND (p_kind <> 'INCIDENT' OR v_user = t.guest_user_id)
     AND (p_kind <> 'TRAFFIC' OR v_user = t.holder_user_id);
END
$fn$;
COMMENT ON FUNCTION core.trip_inspection_party(bytea, uuid, text) IS
  'Interne : partie de la session sur un trip (HOST titulaire du compte d''hôte, GUEST voyageur) et '
  'fenêtre de la série ; INCIDENT au voyageur pendant le trip, TRAFFIC au titulaire après le retour '
  '(US-318) ; rien pour toute autre personne. US-303 (ADR-179), US-318 (ADR-198).';
REVOKE ALL ON FUNCTION core.trip_inspection_party(bytea, uuid, text) FROM PUBLIC;

-- 2.2 Jambes d'une refacturation (08 BR-TT-02 à 04, BR-PRICE-15, BR-REIMB-04 ; fonction pure,
-- version BR-TT-US318) : [HOST, INSURER, TAX_THIRD_PARTY, PLATFORM] ; HOST = montant (100 % à
-- l'hôte), PLATFORM = roundHalfUp(montant × bps / 10 000), INSURER = TAX_THIRD_PARTY = 0. Même règle
-- que `trafficChargeLegs` de @rueda/money. NULL si l'entrée est invalide.
CREATE FUNCTION core.claim_traffic_charge_legs(p_amount bigint, p_fee_bps integer)
  RETURNS bigint[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN p_amount IS NULL OR p_amount <= 0 OR p_fee_bps IS NULL
                OR p_fee_bps < 0 OR p_fee_bps > 10000 THEN NULL
           ELSE ARRAY[p_amount, 0, 0,
                      pg_catalog.floor((2::numeric * p_amount * p_fee_bps + 10000) / 20000)::bigint]
         END
$fn$;
COMMENT ON FUNCTION core.claim_traffic_charge_legs(bigint, integer) IS
  'Jambes [HOST, INSURER, TAX_THIRD_PARTY, PLATFORM] d''une amende, d''un péage ou d''une fourrière '
  'refacturés : montant à l''hôte, frais de gestion roundHalfUp(montant × bps / 10 000) à la '
  'plateforme (version BR-TT-US318). US-318 (ADR-198).';
REVOKE ALL ON FUNCTION core.claim_traffic_charge_legs(bigint, integer) FROM PUBLIC;

-- 2.3 Paramètre entier positif d'un pays en vigueur maintenant (NULL : absent ou mal formé)
CREATE FUNCTION core.claim_traffic_param(p_key text, p_country text)
  RETURNS integer
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v     jsonb;
  v_now timestamptz := platform.now();
BEGIN
  SELECT x.value INTO v
    FROM core.config_param_value AS x
   WHERE x.key = p_key AND x.country_code::text = p_country AND x.scope_type = 'COUNTRY'
     AND x.valid_from <= v_now AND (x.valid_to IS NULL OR x.valid_to > v_now)
   ORDER BY x.valid_from DESC
   LIMIT 1;
  IF pg_catalog.jsonb_typeof(v) = 'number' AND (v #>> '{}') ~ '^(0|[1-9][0-9]{0,4})$' THEN
    RETURN (v #>> '{}')::integer;
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.claim_traffic_param(text, text) IS
  'Interne : délai ou frais de gestion d''un pays (entier ≥ 0, en vigueur) ; NULL si absent ou mal '
  'formé (l''appelant refuse). US-318 (ADR-198).';
REVOKE ALL ON FUNCTION core.claim_traffic_param(text, text) FROM PUBLIC;

-- 2.4 Faits d'un trip pour une refacturation : début effectif (remise validée, sinon début prévu),
-- fin effective (premier retour), délai (fin + jours du pays), frais. Trip inconnu : aucune ligne.
CREATE FUNCTION core.claim_traffic_facts(p_trip_id uuid)
  RETURNS TABLE (trip_id uuid, country_code text, currency text, org_id uuid, holder_user_id uuid,
                 status text, start_at timestamptz, end_at timestamptz, deadline_days integer,
                 deadline_at timestamptz, fee_bps integer)
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t       record;
  v_ret   timestamptz;
  v_days  integer;
BEGIN
  SELECT x.id, x.country_code, x.currency, x.org_id, x.status, x.scheduled_start,
         x.checkin_validated_at, o.holder_user_id
    INTO t
    FROM core.booking_trip AS x
    JOIN core.iam_organization AS o ON o.id = x.org_id
   WHERE x.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_catalog.min(l.at) INTO v_ret
    FROM core.booking_trip_state_log AS l
   WHERE l.trip_id = t.id AND l.to_status = 'RETURNED' AND l.kind = 'TRANSITION';
  v_days := core.claim_traffic_param('traffic_charge_deadline_days', t.country_code);
  IF v_days IS NOT NULL AND v_days < 1 THEN
    v_days := NULL;
  END IF;
  RETURN QUERY
  SELECT t.id, t.country_code::text, t.currency::text, t.org_id, t.holder_user_id, t.status::text,
         COALESCE(t.checkin_validated_at, t.scheduled_start), v_ret, v_days,
         CASE WHEN v_ret IS NOT NULL AND v_days IS NOT NULL
              THEN v_ret + pg_catalog.make_interval(days => v_days) END,
         core.claim_traffic_param('traffic_charge_admin_fee_bps', t.country_code);
END
$fn$;
COMMENT ON FUNCTION core.claim_traffic_facts(uuid) IS
  'Interne : début et fin effectifs du trip, délai de refacturation (fin + traffic_charge_deadline_'
  'days) et frais de gestion du pays ; NULL si inconnus. US-318 (ADR-198).';
REVOKE ALL ON FUNCTION core.claim_traffic_facts(uuid) FROM PUBLIC;

-- 2.5 Incident ou accident déclaré par le voyageur (19 US-318 critère 2). Issues : NOT_FOUND
-- (session inconnue, autre personne, hôte, trip inconnu : même réponse), INCIDENT_NOT_OPEN (trip
-- hors IN_PROGRESS / OVERDUE), INCIDENT_CASE_REQUIRED (demande d'aide ACCIDENT / BREAKDOWN vivante
-- de ce voyageur sur ce trip absente), INCIDENT_PHOTOS_REQUIRED (aucune photo dans sa série
-- INCIDENT), REPORTED, DUPLICATE (rejeu de la même requête), EXISTS (incident déjà ouvert pour cette
-- demande). Heure de la base ; rien n'est écrit hors REPORTED.
CREATE FUNCTION core.claim_cmd_report_incident(p_token_hash bytea, p_request_id uuid,
                                               p_trip_id uuid, p_case_id uuid,
                                               p_third_party boolean, p_police_report boolean)
  RETURNS TABLE (outcome text, incident_id uuid, reported_at timestamptz, photo_count integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p      record;
  k      record;
  v_old  core.claim_incident_report%ROWTYPE;
  v_insp uuid;
  v_ids  uuid[];
  v_id   uuid;
  v_at   timestamptz;
BEGIN
  IF p_request_id IS NULL OR p_case_id IS NULL OR p_third_party IS NULL
     OR p_police_report IS NULL THEN
    RAISE EXCEPTION 'incident : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, 'INCIDENT');
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::timestamptz, NULL::integer;
    RETURN;
  END IF;
  -- rejeu : la requête d'abord (sérialisée), puis la demande d'aide
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim.incident:' || p_request_id::text, 0));
  SELECT * INTO v_old FROM core.claim_incident_report AS x WHERE x.request_id = p_request_id;
  IF v_old.id IS NOT NULL THEN
    IF v_old.trip_id = p.trip_id AND v_old.reporter_user_id = p.user_id
       AND v_old.case_id = p_case_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_old.id, v_old.reported_at,
                          pg_catalog.cardinality(v_old.photo_file_ids);
      RETURN;
    END IF;
    RAISE EXCEPTION 'incident : identifiant de requête déjà utilisé'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT p.open THEN
    RETURN QUERY SELECT 'INCIDENT_NOT_OPEN'::text, NULL::uuid, NULL::timestamptz, NULL::integer;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim.incident.case:' || p_case_id::text, 0));
  SELECT c.id, c.help_topic, c.status INTO k
    FROM core.support_support_case AS c
   WHERE c.id = p_case_id AND c.trip_id = p.trip_id AND c.requester_user_id = p.user_id;
  IF k.id IS NULL OR k.status NOT IN ('OPEN', 'PENDING') THEN
    RETURN QUERY SELECT 'INCIDENT_CASE_REQUIRED'::text, NULL::uuid, NULL::timestamptz,
                        NULL::integer;
    RETURN;
  END IF;
  SELECT * INTO v_old FROM core.claim_incident_report AS x WHERE x.case_id = p_case_id;
  IF v_old.id IS NOT NULL THEN
    RETURN QUERY SELECT 'EXISTS'::text, v_old.id, v_old.reported_at,
                        pg_catalog.cardinality(v_old.photo_file_ids);
    RETURN;
  END IF;
  -- photos de la série INCIDENT du voyageur (chaîne d'US-303), verrouillée le temps de la lecture
  SELECT i.id INTO v_insp
    FROM core.trip_ops_inspection AS i
   WHERE i.trip_id = p.trip_id AND i.kind = 'INCIDENT' AND i.performer_role = 'GUEST'
   FOR UPDATE;
  SELECT pg_catalog.array_agg(ph.file_id ORDER BY ph.received_at, ph.slot_code) INTO v_ids
    FROM core.trip_ops_inspection_photo AS ph
   WHERE ph.inspection_id = v_insp;
  IF v_insp IS NULL OR v_ids IS NULL OR pg_catalog.cardinality(v_ids) = 0 THEN
    RETURN QUERY SELECT 'INCIDENT_PHOTOS_REQUIRED'::text, NULL::uuid, NULL::timestamptz, 0;
    RETURN;
  END IF;
  v_id := pg_catalog.gen_random_uuid();
  v_at := platform.now();
  INSERT INTO core.claim_incident_report (id, trip_id, country_code, case_id, reporter_user_id,
                                          kind, third_party, police_report, inspection_id,
                                          photo_file_ids, request_id, reported_at)
  VALUES (v_id, p.trip_id, p.country_code, p_case_id, p.user_id, k.help_topic, p_third_party,
          p_police_report, v_insp, v_ids[1:100], p_request_id, v_at);
  RETURN QUERY SELECT 'REPORTED'::text, v_id, v_at, LEAST(pg_catalog.cardinality(v_ids), 100);
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_report_incident(bytea, uuid, uuid, uuid, boolean, boolean) IS
  'Incident ou accident déclaré par le voyageur de la session (S17) : demande d''aide ACCIDENT / '
  'BREAKDOWN vivante, au moins une photo de sa série INCIDENT (US-303), heure de la base. SECURITY '
  'DEFINER, EXECUTE app_api. US-318 (ADR-198).';

-- 2.6 Amende, péage ou fourrière déclarés par le titulaire (19 US-318 critère 3). Issues :
-- NOT_FOUND (session inconnue, voyageur, co-hôte, autre personne, trip inconnu : même réponse),
-- TRAFFIC_TRIP_NOT_ENDED (aucun retour), TRAFFIC_WINDOW_UNKNOWN / TRAFFIC_FEE_UNKNOWN (paramètre
-- absent), TRAFFIC_CHARGE_DEADLINE_PASSED (après fin effective + délai, à l'heure de la base),
-- TRAFFIC_OUTSIDE_TRIP (fait hors [début effectif, fin effective] ou futur), TRAFFIC_EVIDENCE_REQUIRED
-- (pièce absente de la série TRAFFIC du titulaire ou déjà utilisée), DECLARED, DUPLICATE. `body` :
-- montants et jambes (texte d'entiers), délai.
CREATE FUNCTION core.claim_cmd_declare_traffic_charge(p_token_hash bytea, p_request_id uuid,
                                                      p_trip_id uuid, p_kind text,
                                                      p_occurred_at timestamptz,
                                                      p_amount_minor bigint, p_file_id uuid)
  RETURNS TABLE (outcome text, charge_id uuid, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p      record;
  f      record;
  v_old  core.claim_traffic_charge%ROWTYPE;
  v_legs bigint[];
  v_now  timestamptz;
  v_id   uuid;
  v_ok   boolean;
BEGIN
  IF p_request_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('TOLL', 'FINE', 'IMPOUND')
     OR p_occurred_at IS NULL OR p_amount_minor IS NULL OR p_amount_minor <= 0
     OR p_amount_minor > 1000000000000 OR p_file_id IS NULL THEN
    RAISE EXCEPTION 'refacturation : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, 'TRAFFIC');
  IF p.user_id IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('claim.traffic:' || p_request_id::text, 0));
  SELECT * INTO v_old FROM core.claim_traffic_charge AS x WHERE x.request_id = p_request_id;
  IF v_old.id IS NOT NULL THEN
    IF v_old.trip_id = p.trip_id AND v_old.declared_by = p.user_id AND v_old.kind = p_kind
       AND v_old.occurred_at = p_occurred_at AND v_old.amount_minor = p_amount_minor
       AND v_old.file_id = p_file_id THEN
      RETURN QUERY SELECT 'DUPLICATE'::text, v_old.id, pg_catalog.jsonb_build_object(
        'amountMinor', v_old.amount_minor::text, 'adminFeeMinor', v_old.admin_fee_minor::text,
        'totalMinor', v_old.total_minor::text, 'deadlineAt', pg_catalog.to_char(v_old.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
      RETURN;
    END IF;
    RAISE EXCEPTION 'refacturation : identifiant de requête déjà utilisé'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO f FROM core.claim_traffic_facts(p.trip_id);
  IF f.trip_id IS NULL OR f.holder_user_id IS DISTINCT FROM p.user_id THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF f.end_at IS NULL OR NOT p.open THEN
    RETURN QUERY SELECT 'TRAFFIC_TRIP_NOT_ENDED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF f.deadline_at IS NULL THEN
    RETURN QUERY SELECT 'TRAFFIC_WINDOW_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  IF f.fee_bps IS NULL OR f.fee_bps > 10000 THEN
    RETURN QUERY SELECT 'TRAFFIC_FEE_UNKNOWN'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  -- pièces de la série verrouillées ; heure de la base lue APRÈS les verrous
  PERFORM 1 FROM core.trip_ops_inspection AS i
   WHERE i.trip_id = p.trip_id AND i.kind = 'TRAFFIC' AND i.performer_role = 'HOST'
   FOR UPDATE;
  v_now := platform.now();
  IF v_now > f.deadline_at THEN
    RETURN QUERY SELECT 'TRAFFIC_CHARGE_DEADLINE_PASSED'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                                      'tripEndAt', pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    RETURN;
  END IF;
  IF p_occurred_at < f.start_at OR p_occurred_at > f.end_at OR p_occurred_at > v_now
     OR f.start_at >= f.end_at THEN
    RETURN QUERY SELECT 'TRAFFIC_OUTSIDE_TRIP'::text, NULL::uuid,
                        pg_catalog.jsonb_build_object('tripStartAt', pg_catalog.to_char(f.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                                      'tripEndAt', pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    RETURN;
  END IF;
  SELECT EXISTS (SELECT 1
                   FROM core.trip_ops_inspection_photo AS ph
                   JOIN core.trip_ops_inspection AS i ON i.id = ph.inspection_id
                  WHERE ph.file_id = p_file_id AND i.trip_id = p.trip_id AND i.kind = 'TRAFFIC'
                    AND i.performer_role = 'HOST' AND i.performed_by = p.user_id)
         AND NOT EXISTS (SELECT 1 FROM core.claim_traffic_charge AS x WHERE x.file_id = p_file_id)
    INTO v_ok;
  IF NOT v_ok THEN
    RETURN QUERY SELECT 'TRAFFIC_EVIDENCE_REQUIRED'::text, NULL::uuid, NULL::jsonb;
    RETURN;
  END IF;
  v_legs := core.claim_traffic_charge_legs(p_amount_minor, f.fee_bps);
  v_id := pg_catalog.gen_random_uuid();
  INSERT INTO core.claim_traffic_charge
         (id, trip_id, country_code, currency, org_id, declared_by, kind, occurred_at, file_id,
          amount_minor, fee_bps, admin_fee_minor, total_minor, leg_host_minor, leg_insurer_minor,
          leg_tax_third_party_minor, leg_platform_minor, trip_start_at, trip_end_at, deadline_at,
          request_id, declared_at, next_check_at)
  VALUES (v_id, p.trip_id, f.country_code, f.currency, f.org_id, p.user_id, p_kind, p_occurred_at,
          p_file_id, p_amount_minor, f.fee_bps, v_legs[4], v_legs[1] + v_legs[4], v_legs[1],
          v_legs[2], v_legs[3], v_legs[4], f.start_at, f.end_at, f.deadline_at, p_request_id,
          v_now, v_now);
  RETURN QUERY SELECT 'DECLARED'::text, v_id, pg_catalog.jsonb_build_object(
    'amountMinor', p_amount_minor::text, 'adminFeeMinor', v_legs[4]::text,
    'totalMinor', (v_legs[1] + v_legs[4])::text, 'deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'legs', pg_catalog.jsonb_build_object('HOST', v_legs[1]::text, 'INSURER', v_legs[2]::text,
                                          'TAX_THIRD_PARTY', v_legs[3]::text,
                                          'PLATFORM', v_legs[4]::text));
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text, timestamptz,
  bigint, uuid) IS
  'Amende, péage ou fourrière déclarés par le titulaire du compte d''hôte de la session, avec la '
  'pièce de sa série TRAFFIC, dans le délai du pays (08 BR-TT-02) ; jambes explicites, frais de '
  'gestion du pays. SECURITY DEFINER, EXECUTE app_api. US-318 (ADR-198).';

-- 2.7 Sinistres du trip vus par son titulaire (écran de l'hôte) : délai, frais, dossier de vol et
-- déclaration à l'assureur, refacturations et pièces disponibles. NULL : personne autre que le
-- titulaire (voyageur, co-hôte, trip inconnu ; même réponse).
CREATE FUNCTION core.claim_host_trip_claims(p_token_hash bytea, p_trip_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  p   record;
  f   record;
  v_t jsonb;
BEGIN
  SELECT * INTO p FROM core.trip_inspection_party(p_token_hash, p_trip_id, 'TRAFFIC');
  IF p.user_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO f FROM core.claim_traffic_facts(p.trip_id);
  IF f.trip_id IS NULL OR f.holder_user_id IS DISTINCT FROM p.user_id THEN
    RETURN NULL;
  END IF;
  SELECT pg_catalog.jsonb_build_object('status', x.status, 'openedAt', pg_catalog.to_char(x.opened_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                                       'closedAt', pg_catalog.to_char(x.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'insurerStatus', x.insurer_status)
    INTO v_t
    FROM core.claim_theft_case AS x WHERE x.trip_id = p.trip_id;
  RETURN pg_catalog.jsonb_build_object(
    'tripId', p.trip_id, 'country', f.country_code, 'currency', f.currency,
    'open', p.open AND f.end_at IS NOT NULL AND f.deadline_at IS NOT NULL
            AND f.fee_bps IS NOT NULL AND platform.now() <= f.deadline_at,
    'tripStartAt', pg_catalog.to_char(f.start_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'tripEndAt', pg_catalog.to_char(f.end_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'deadlineAt', pg_catalog.to_char(f.deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'feeBps', f.fee_bps, 'theft', v_t,
    'charges', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'id', x.id, 'kind', x.kind, 'occurredAt', pg_catalog.to_char(x.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'amountMinor', x.amount_minor::text, 'adminFeeMinor', x.admin_fee_minor::text,
               'totalMinor', x.total_minor::text, 'declaredAt', pg_catalog.to_char(x.declared_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'status', x.execution_status) ORDER BY x.declared_at, x.occurred_at)
        FROM core.claim_traffic_charge AS x WHERE x.trip_id = p.trip_id), '[]'::jsonb),
    'evidence', COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'fileId', ph.file_id, 'slot', ph.slot_code, 'receivedAt', pg_catalog.to_char(ph.received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'used', EXISTS (SELECT 1 FROM core.claim_traffic_charge AS x
                                WHERE x.file_id = ph.file_id))
               ORDER BY ph.received_at, ph.slot_code)
        FROM core.trip_ops_inspection_photo AS ph
        JOIN core.trip_ops_inspection AS i ON i.id = ph.inspection_id
       WHERE i.trip_id = p.trip_id AND i.kind = 'TRAFFIC' AND i.performer_role = 'HOST'),
      '[]'::jsonb));
END
$fn$;
COMMENT ON FUNCTION core.claim_host_trip_claims(bytea, uuid) IS
  'Sinistres d''un trip vus par le titulaire du compte d''hôte de la session : délai et frais du '
  'pays, dossier de vol et déclaration à l''assureur, refacturations, pièces. Aucune donnée '
  'nominative. SECURITY DEFINER, EXECUTE app_api. US-318 (ADR-198).';

REVOKE ALL ON FUNCTION core.claim_traffic_facts(uuid),
  core.claim_cmd_report_incident(bytea, uuid, uuid, uuid, boolean, boolean),
  core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text, timestamptz, bigint, uuid),
  core.claim_host_trip_claims(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  core.claim_cmd_report_incident(bytea, uuid, uuid, uuid, boolean, boolean),
  core.claim_cmd_declare_traffic_charge(bytea, uuid, uuid, text, timestamptz, bigint, uuid),
  core.claim_host_trip_claims(bytea, uuid) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;

-- 3. Travailleur payment_command (cmd_money_owner, EXECUTE app_worker) ------------------------------
GRANT SELECT, INSERT ON core.claim_theft_case TO cmd_money_owner;
GRANT UPDATE (status, closed_at, insurer_status, insurer_sent_at, insurer_ref)
  ON core.claim_theft_case TO cmd_money_owner;
CREATE POLICY cmd_money_theft_sel ON core.claim_theft_case FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_theft_ins ON core.claim_theft_case FOR INSERT TO cmd_money_owner
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command'
              AND status = 'THEFT_INVESTIGATION' AND insurer_status = 'PENDING');
CREATE POLICY cmd_money_theft_upd ON core.claim_theft_case FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
GRANT SELECT ON core.claim_traffic_charge TO cmd_money_owner;
GRANT UPDATE (execution_status, execution_code, charge_id, executed_at, next_check_at)
  ON core.claim_traffic_charge TO cmd_money_owner;
CREATE POLICY cmd_money_traffic_sel ON core.claim_traffic_charge FOR SELECT TO cmd_money_owner
  USING (true);
CREATE POLICY cmd_money_traffic_upd ON core.claim_traffic_charge FOR UPDATE TO cmd_money_owner
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'payment_command');
-- dossier de retard à l'étape « plainte » (T24H, US-306) : trip et étape seulement
GRANT SELECT (trip_id, stage) ON core.trip_ops_overdue_case TO cmd_money_owner;
CREATE POLICY cmd_money_theft_overdue_sel ON core.trip_ops_overdue_case FOR SELECT
  TO cmd_money_owner USING (stage = 'T24H');
GRANT SELECT (status, scheduled_end) ON core.booking_trip TO cmd_money_owner;

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 3.1 File du vol présumé : trips à l'étape T24H encore non rendus sans dossier (OPEN), dossiers
-- dont le trip est rendu (CLOSE). Plus anciens d'abord.
CREATE FUNCTION core.claim_theft_cases_due(p_limit integer)
  RETURNS TABLE (trip_id uuid, action text)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: theft_cases_due reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  RETURN QUERY
  SELECT q.trip_id, q.action FROM (
    SELECT oc.trip_id, 'OPEN'::text AS action, t.scheduled_end AS at
      FROM core.trip_ops_overdue_case AS oc
      JOIN core.booking_trip AS t ON t.id = oc.trip_id
     WHERE oc.stage = 'T24H' AND t.status IN ('OVERDUE', 'UNRETURNED')
       AND NOT EXISTS (SELECT 1 FROM core.claim_theft_case AS x WHERE x.trip_id = oc.trip_id)
    UNION ALL
    SELECT x.trip_id, 'CLOSE'::text, x.opened_at
      FROM core.claim_theft_case AS x
      JOIN core.booking_trip AS t ON t.id = x.trip_id
     WHERE x.status = 'THEFT_INVESTIGATION'
       AND t.status NOT IN ('OVERDUE', 'UNRETURNED', 'VEHICLE_LOST')) AS q
   ORDER BY q.at, q.trip_id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END
$fn$;
COMMENT ON FUNCTION core.claim_theft_cases_due(integer) IS
  'Travailleur payment_command : trips à l''étape T24H sans dossier de vol (OPEN), dossiers dont le '
  'trip est rendu (CLOSE). EXECUTE app_worker. US-318 (ADR-198).';

-- 3.2 Ouverture du dossier de vol, sous le verrou du trip. Issues : OPENED, EXISTS, NOT_DUE (trip
-- non à l'étape T24H ou déjà rendu), NOT_FOUND. La déclaration à l'assureur est journalisée PENDING.
CREATE FUNCTION core.claim_cmd_open_theft_case(p_trip_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: open_theft_case reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  SELECT x.id, x.country_code, x.org_id, x.status INTO t
    FROM core.booking_trip AS x WHERE x.id = p_trip_id FOR UPDATE;
  IF t.id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF EXISTS (SELECT 1 FROM core.claim_theft_case AS x WHERE x.trip_id = t.id) THEN
    RETURN 'EXISTS';
  END IF;
  IF t.status NOT IN ('OVERDUE', 'UNRETURNED')
     OR NOT EXISTS (SELECT 1 FROM core.trip_ops_overdue_case AS oc
                     WHERE oc.trip_id = t.id AND oc.stage = 'T24H') THEN
    RETURN 'NOT_DUE';
  END IF;
  INSERT INTO core.claim_theft_case (id, trip_id, country_code, org_id)
  VALUES (pg_catalog.gen_random_uuid(), t.id, t.country_code, t.org_id);
  RETURN 'OPENED';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_open_theft_case(uuid) IS
  'Travailleur payment_command : dossier de vol présumé d''un trip non rendu à l''étape T24H, '
  'déclaration à l''assureur journalisée (PENDING). EXECUTE app_worker. US-318 (ADR-198).';

-- 3.3 Clôture au retour, sous le verrou du trip. Issues : CLOSED (déclaration non envoyée :
-- WITHDRAWN), NOT_DUE (trip encore non rendu), ALREADY_CLOSED, NOT_FOUND.
CREATE FUNCTION core.claim_cmd_close_theft_case(p_trip_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t record;
  x core.claim_theft_case%ROWTYPE;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: close_theft_case reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  SELECT b.id, b.status INTO t FROM core.booking_trip AS b WHERE b.id = p_trip_id FOR UPDATE;
  SELECT * INTO x FROM core.claim_theft_case AS c WHERE c.trip_id = p_trip_id FOR UPDATE;
  IF t.id IS NULL OR x.id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF x.status = 'RETURNED' THEN
    RETURN 'ALREADY_CLOSED';
  END IF;
  IF t.status IN ('OVERDUE', 'UNRETURNED', 'VEHICLE_LOST') THEN
    RETURN 'NOT_DUE';
  END IF;
  UPDATE core.claim_theft_case AS c
     SET status = 'RETURNED', closed_at = platform.now(),
         insurer_status = CASE WHEN c.insurer_status = 'PENDING' THEN 'WITHDRAWN'
                               ELSE c.insurer_status END
   WHERE c.id = x.id;
  RETURN 'CLOSED';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_close_theft_case(uuid) IS
  'Travailleur payment_command : dossier de vol clos au retour du véhicule (RETURNED), déclaration '
  'non envoyée retirée (WITHDRAWN). EXECUTE app_worker. US-318 (ADR-198).';

-- 3.4 Déclarations de vol à envoyer : seulement si insurer_contract_active[pays] (lu en base,
-- absent ⇒ faux). Aucune donnée nominative.
CREATE FUNCTION core.claim_theft_declarations_due(p_limit integer)
  RETURNS TABLE (theft_case_id uuid, country_code text, currency text, opened_at timestamptz)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: theft_declarations_due reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  RETURN QUERY
  SELECT x.id, x.country_code::text, t.currency::text, x.opened_at
    FROM core.claim_theft_case AS x
    JOIN core.booking_trip AS t ON t.id = x.trip_id
   WHERE x.insurer_status = 'PENDING' AND x.status = 'THEFT_INVESTIGATION'
     AND core.config_go_live('insurer_contract_active', x.country_code)
   ORDER BY x.opened_at, x.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END
$fn$;
COMMENT ON FUNCTION core.claim_theft_declarations_due(integer) IS
  'Travailleur payment_command : déclarations de vol en attente, du seul pays dont '
  'insurer_contract_active est vrai (absent ⇒ faux). EXECUTE app_worker. US-318 (ADR-198).';

CREATE FUNCTION core.claim_cmd_record_theft_declaration(p_theft_case_id uuid, p_provider_ref text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  x core.claim_theft_case%ROWTYPE;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: record_theft_declaration reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  IF p_provider_ref IS NULL OR p_provider_ref !~ '^[A-Za-z0-9:._-]{1,100}$' THEN
    RAISE EXCEPTION 'claim: invalid provider reference' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO x FROM core.claim_theft_case AS c WHERE c.id = p_theft_case_id FOR UPDATE;
  IF x.id IS NULL THEN
    RETURN 'NOT_FOUND';
  END IF;
  IF x.insurer_status = 'SENT' THEN
    RETURN 'ALREADY_SENT';
  END IF;
  IF x.insurer_status = 'WITHDRAWN' THEN
    RETURN 'WITHDRAWN';
  END IF;
  -- l'interrupteur est relu sous le verrou (fermé entre la file et l'envoi : rien n'est reporté)
  IF NOT core.config_go_live('insurer_contract_active', x.country_code) THEN
    RETURN 'INSURER_CONTRACT_INACTIVE';
  END IF;
  UPDATE core.claim_theft_case AS c
     SET insurer_status = 'SENT', insurer_sent_at = platform.now(), insurer_ref = p_provider_ref
   WHERE c.id = x.id;
  RETURN 'SENT';
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_record_theft_declaration(uuid, text) IS
  'Travailleur payment_command : déclaration de vol envoyée à l''assureur (référence du port), '
  'interrupteur relu. EXECUTE app_worker. US-318 (ADR-198).';

-- 3.5 Refacturations à exécuter (PENDING échues), plus anciennes d'abord
CREATE FUNCTION core.claim_traffic_charges_due(p_limit integer)
  RETURNS TABLE (traffic_charge_id uuid)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: traffic_charges_due reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  RETURN QUERY
  SELECT x.id FROM core.claim_traffic_charge AS x
   WHERE x.execution_status = 'PENDING' AND x.next_check_at <= platform.now()
   ORDER BY x.next_check_at, x.declared_at, x.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 0), 0), 100);
END
$fn$;
COMMENT ON FUNCTION core.claim_traffic_charges_due(integer) IS
  'Travailleur payment_command : refacturations à exécuter (PENDING échues). EXECUTE app_worker. '
  'US-318 (ADR-198).';

-- 3.6 Exécution par Kmino, sous le verrou du trip puis de la refacturation (ordre de notify) :
-- débit SÉPARÉ du voyageur d'US-703 (but INCIDENTAL, motif DELAYED_CHARGES, origine
-- TRAFFIC_CHARGE), montant explicite de chaque jambe, moyen = opération de carte du loyer prouvée,
-- jamais la caution. Issues : DONE (rejeu : même issue), BLOCKED (`NO_CARD_TENDER`,
-- `TRIP_UNKNOWN`), NOT_FOUND.
CREATE FUNCTION core.claim_cmd_execute_traffic_charge(p_traffic_charge_id uuid, p_charge_id uuid)
  RETURNS TABLE (outcome text, code text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  t        record;
  x        core.claim_traffic_charge%ROWTYPE;
  v_trip   uuid;
  v_tender uuid;
  r        record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: execute_traffic_charge reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  IF p_traffic_charge_id IS NULL OR p_charge_id IS NULL THEN
    RAISE EXCEPTION 'claim: invalid execution input' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT c.trip_id INTO v_trip FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id;
  IF v_trip IS NULL THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text;
    RETURN;
  END IF;
  SELECT b.id, b.country_code, b.currency, b.source_hold_id INTO t
    FROM core.booking_trip AS b WHERE b.id = v_trip FOR UPDATE;
  SELECT * INTO x FROM core.claim_traffic_charge AS c WHERE c.id = p_traffic_charge_id FOR UPDATE;
  IF x.execution_status <> 'PENDING' THEN
    RETURN QUERY SELECT x.execution_status, x.execution_code;
    RETURN;
  END IF;
  IF t.id IS NULL OR t.country_code <> x.country_code OR t.currency <> x.currency THEN
    UPDATE core.claim_traffic_charge AS c
       SET execution_status = 'BLOCKED', execution_code = 'TRIP_UNKNOWN'
     WHERE c.id = x.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'TRIP_UNKNOWN'::text;
    RETURN;
  END IF;
  SELECT o.id INTO v_tender
    FROM core.payment_payment_operation AS o
   WHERE (o.trip_id = t.id OR (t.source_hold_id IS NOT NULL AND o.hold_id = t.source_hold_id))
     AND o.kind IN ('AUTH', 'CAPTURE') AND o.method = 'CARD' AND o.purpose = 'RENT'
     AND o.status = 'SUCCEEDED' AND o.currency = t.currency
   ORDER BY (o.kind = 'CAPTURE') DESC, o.created_at, o.id
   LIMIT 1;
  IF v_tender IS NULL THEN
    UPDATE core.claim_traffic_charge AS c
       SET execution_status = 'BLOCKED', execution_code = 'NO_CARD_TENDER'
     WHERE c.id = x.id;
    RETURN QUERY SELECT 'BLOCKED'::text, 'NO_CARD_TENDER'::text;
    RETURN;
  END IF;
  SELECT * INTO r FROM core.payment_cmd_notify_post_trip_charge(
    p_charge_id, t.id, 'INCIDENTAL', 'DELAYED_CHARGES', 'TRAFFIC_CHARGE', x.id, NULL, v_tender,
    x.total_minor,
    pg_catalog.jsonb_build_object('HOST', x.leg_host_minor::text,
                                  'INSURER', x.leg_insurer_minor::text,
                                  'TAX_THIRD_PARTY', x.leg_tax_third_party_minor::text,
                                  'PLATFORM', x.leg_platform_minor::text),
    false);
  UPDATE core.claim_traffic_charge AS c
     SET execution_status = 'DONE', execution_code = NULL, charge_id = r.charge_id,
         executed_at = platform.now()
   WHERE c.id = x.id;
  RETURN QUERY SELECT 'DONE'::text, NULL::text;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_execute_traffic_charge(uuid, uuid) IS
  'Exécution d''une refacturation par Kmino : débit séparé du voyageur (US-703, but INCIDENTAL, '
  'motif DELAYED_CHARGES, jambes explicites, jamais la caution). Travailleur payment_command. '
  'EXECUTE app_worker. US-318 (ADR-198).';

-- 3.7 Report d'une exécution en échec (erreur de la base attrapée par le travailleur) : +15 min
CREATE FUNCTION core.claim_cmd_defer_traffic_charge(p_traffic_charge_id uuid, p_code text)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'payment_command' THEN
    RAISE EXCEPTION 'claim: defer_traffic_charge reserved to the payment_command worker'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'claim_p2p_command_forbidden';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[A-Z][A-Z0-9_]{1,63}$' THEN
    RAISE EXCEPTION 'claim: invalid code' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE core.claim_traffic_charge AS c
     SET next_check_at = platform.now() + interval '15 minutes', execution_code = p_code
   WHERE c.id = p_traffic_charge_id AND c.execution_status = 'PENDING';
  RETURN CASE WHEN FOUND THEN 'DEFERRED' ELSE 'NOT_DUE' END;
END
$fn$;
COMMENT ON FUNCTION core.claim_cmd_defer_traffic_charge(uuid, text) IS
  'Travailleur payment_command : refacturation en échec repoussée de 15 min (PROPOSÉ), code '
  'seulement. EXECUTE app_worker. US-318 (ADR-198).';

-- 3.8 Motifs de retenue d'un lot (0175, même signature) : corps de 0175 recopié ; le bloc CLAIM
-- réunit désormais trois sources (US-314, US-309, US-318 : dossier de vol ouvert).
CREATE OR REPLACE FUNCTION core.payout_batch_hold_reasons(p_batch_id uuid)
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH b AS (
    SELECT x.id, x.org_id, x.country_code, x.currency, x.variant, x.psp_account_id,
           x.scheduled_for, a.provider
      FROM core.payout_payout_batch AS x
      JOIN core.payment_psp_account AS a ON a.id = x.psp_account_id
     WHERE x.id = p_batch_id),
  reasons(r) AS (
    SELECT 'PAYOUTS_DISABLED' FROM b WHERE NOT core.config_go_live('payouts_enabled', b.country_code)
    UNION ALL
    SELECT 'FUNDS_HOLDING_DISABLED' FROM b
     WHERE b.variant = 'PLATFORM_MOR' AND NOT core.config_go_live('funds_holding_enabled', b.country_code)
    UNION ALL
    SELECT 'VARIANT_B_UNAVAILABLE' FROM b WHERE b.variant = 'PLATFORM_MOR'
    UNION ALL
    SELECT 'HOST_PAYOUT_RAIL_UNAVAILABLE' FROM b
     WHERE pg_catalog.cardinality(
             core.payment_missing_blocking_capabilities(b.provider, b.country_code, b.variant)) > 0
    UNION ALL
    SELECT 'SUBMERCHANT_INACTIVE' FROM b
     WHERE NOT EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS s
                        WHERE s.psp_account_id = b.psp_account_id AND s.org_id = b.org_id
                          AND s.kyc_status = 'ACTIVE')
    UNION ALL
    SELECT h.r FROM b,
           pg_catalog.unnest(core.payout_payout_account_hold(b.org_id, b.currency, b.scheduled_for))
             AS h(r)
    UNION ALL
    SELECT lb.frozen_reason
      FROM core.payout_payout_item AS i
      JOIN core.settlement_trip_leg_balance AS lb
        ON lb.trip_id = i.trip_id AND lb.segment_no = i.segment_no AND lb.leg = i.leg
     WHERE i.batch_id = p_batch_id AND lb.frozen
    UNION ALL
    SELECT 'CHARGEBACK'
      FROM core.payout_payout_item AS i
     WHERE i.batch_id = p_batch_id AND core.settlement_trip_chargeback_open(i.trip_id)
    UNION ALL
    SELECT CASE WHEN t.status = 'IN_DISPUTE' THEN 'DISPUTE' ELSE 'TRIP_NOT_COMPLETED' END
      FROM core.payout_payout_item AS i
      JOIN core.booking_trip AS t ON t.id = i.trip_id
     WHERE i.batch_id = p_batch_id AND t.status <> 'COMPLETED'
    -- motif CLAIM, un seul bloc pour trois sources :
    -- US-314 (ADR-192) : réclamation ouverte sur un trip du lot (08 BR-PAYOUT-02) ; levée par la
    -- seule décision du support (RESOLVED, CLOSED) ;
    -- US-309 (ADR-195) : réclamation de dommage ou d'incident du trip sans décision exécutée,
    -- quel que soit le déclarant ; levée par la seule décision exécutée (L3-PM-34, RT-L3-V04) ;
    -- US-318 (ADR-198) : vol présumé (dossier THEFT_INVESTIGATION) ; levé au retour (RETURNED)
    UNION ALL
    SELECT 'CLAIM'
      FROM core.payout_payout_item AS i
     WHERE i.batch_id = p_batch_id
       AND (EXISTS (SELECT 1 FROM core.support_support_case AS k
                     WHERE k.trip_id = i.trip_id AND k.category = 'CLAIM'
                       AND k.status IN ('OPEN', 'PENDING'))
            OR EXISTS (SELECT 1 FROM core.claim_damage_claim AS c
                         LEFT JOIN core.claim_decision AS d ON d.claim_id = c.id
                        WHERE c.trip_id = i.trip_id
                          AND (d.id IS NULL OR d.execution_status <> 'DONE'))
            OR EXISTS (SELECT 1 FROM core.claim_theft_case AS v
                        WHERE v.trip_id = i.trip_id AND v.status = 'THEFT_INVESTIGATION'))
  )
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT reasons.r ORDER BY reasons.r), ARRAY[]::text[])
    FROM reasons WHERE reasons.r IS NOT NULL
$fn$;

REVOKE ALL ON FUNCTION core.claim_theft_cases_due(integer), core.claim_cmd_open_theft_case(uuid),
  core.claim_cmd_close_theft_case(uuid), core.claim_theft_declarations_due(integer),
  core.claim_cmd_record_theft_declaration(uuid, text), core.claim_traffic_charges_due(integer),
  core.claim_cmd_execute_traffic_charge(uuid, uuid),
  core.claim_cmd_defer_traffic_charge(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.claim_theft_cases_due(integer),
  core.claim_cmd_open_theft_case(uuid), core.claim_cmd_close_theft_case(uuid),
  core.claim_theft_declarations_due(integer), core.claim_cmd_record_theft_declaration(uuid, text),
  core.claim_traffic_charges_due(integer), core.claim_cmd_execute_traffic_charge(uuid, uuid),
  core.claim_cmd_defer_traffic_charge(uuid, text) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
