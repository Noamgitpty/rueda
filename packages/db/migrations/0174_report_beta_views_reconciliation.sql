-- 0174 — RPT / FIN : vues de la bêta (remises du jour, retards, KPI de sortie) et rapprochement
-- par jambe ASSISTÉ (procédure mensuelle manuelle bornée).
-- US-311 ; 19 US-311 (« 10 trips et un export PSP de 11 opérations dont une de 128,40 sans trip
-- ⇒ l'écart "opération sans trip" est visible » ; « jambes d'un trip et export par jambe du FAKE
-- (listLegBalances) ⇒ chaque jambe appariée ou en écart, à l'unité mineure près » ; « KPI de
-- sortie calculés depuis les données (pas de saisie) » ; « procédure MANUELLE bornée : seuil
-- J-ADM-031, checklist signée chaque mois, écart au-delà du seuil traité sous 5 jours ouvrés,
-- deux mois consécutifs d'écart inexpliqué ⇒ rapprochement quotidien US-711 préalable » ;
-- variante PY) ; 16 FIN-005 (reconciliation_run RUNNING → MATCHED / DISCREPANCIES → CLOSED ;
-- RECON_STATEMENT_MISSING, RECON_FORMAT_INVALID ; bêta MANUEL) ; 18 §1.1 (S1 à S4) ; 08 E7
-- règle 10 (TJ15a à TJ15d) ; 17 §2.2 (RPT : vues de lecture, exports CSV ; FIN :
-- reconciliation_run, reconciliation_item), §2.3 (`data.export` : FINANCE lim. financier, ADMIN
-- journalisé ; vues security_invoker), §3.2.13 (`reconciliation_run`, `reconciliation_item`,
-- `data_access_log` BULK_EXPORT), §7.2 (`reconciliation_delta_threshold_bps`, J-ADM-031) ; 22
-- J-ADM-031 ; pré-mortem L3-PM-55, L3-PM-60 ; ADR-194 (cette migration). Appliquée sous
-- `migrator`, en une transaction.
--
-- Principes (ADR-194, PROPOSÉS) :
--   - aucune donnée personnelle superflue : identifiants techniques (trip, compte d'hôte,
--     véhicule), référence publique du trip, montants, états et heures ; jamais un nom, un
--     contact, une pièce ni une carte ;
--   - trois vues `WITH (security_invoker = true)` propriété d'`iam_staff_owner`, lues SEULEMENT
--     par les portes de la console (SECURITY DEFINER, iam_staff_owner, EXECUTE app_api) qui jugent
--     la session élevée (TOTP), la permission et le pays du rôle ; aucun droit applicatif direct ;
--   - les KPI de sortie sont calculés depuis les données à chaque lecture : aucune table, aucun
--     champ de saisie ; une source absente (sinistres, S3) est rendue « non mesurable », jamais 0 ;
--   - rapprochement : la plateforme ne lit JAMAIS le PSP réel (bêta : export du PSP collé par le
--     comptable, ou `listLegBalances` du FAKE en test) ; la porte apparie à l'unité mineure, sans
--     tolérance : toute différence est un élément en écart, jamais absorbée (L3-PM-60) ; le seuil
--     `reconciliation_delta_threshold_bps` (J-ADM-031) ne décide que de l'escalade (traitement sous
--     5 jours ouvrés) ; seuil absent ⇒ 0 (fail-closed) ;
--   - registres de classe A : un passage et ses éléments ne sont jamais supprimés ; seuls la
--     résolution d'un élément et la clôture (checklist signée) s'écrivent ensuite, une fois ;
--   - chaque export (vue ou rapprochement) est inscrit au journal d'accès (BULK_EXPORT) et à
--     l'audit chaîné ; chaque refus est journalisé.
--
-- Retour arrière :
--   DROP FUNCTION core.report_staff_beta_view(bytea, uuid, text, text, boolean, text),
--     core.finance_staff_reconciliation_export(bytea, uuid, text, date, text, text),
--     core.finance_staff_record_reconciliation(bytea, uuid, text, date, text, jsonb, text),
--     core.finance_staff_reconciliation_run(bytea, uuid, uuid, boolean, text),
--     core.finance_staff_reconciliation_runs(bytea, text),
--     core.finance_staff_resolve_reconciliation_item(bytea, uuid, uuid, text, text),
--     core.finance_staff_sign_reconciliation(bytea, uuid, uuid, jsonb),
--     core.report_staff_gate(bytea, text, text, text, uuid), core.report_staff_not_found(bytea, text,
--     uuid, uuid), core.finance_recon_threshold_bps(text),
--     core.finance_recon_month_state(text);
--   DROP VIEW core.report_handover_day_v, core.report_overdue_v, core.report_exit_kpi_v ;
--   DROP TABLE core.finance_reconciliation_item, core.finance_reconciliation_run ;
--   DROP FUNCTION core.finance_reconciliation_guard() ;
--   DROP POLICY rpt_staff_read ON (tables sources ci-dessous) ; REVOKE des droits par colonne
--     d'iam_staff_owner listés en section 4 ; REVOKE EXECUTE ON FUNCTION
--     core.payout_business_day(text, date, integer) FROM iam_staff_owner ;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-311%'.

-- 1. Permissions (17 §2.3 ; PROPOSÉ : 17 ne nomme pas ces lectures) -----------------------------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('OPS_AGENT', 'report.ops_views', 'PLATFORM', '2026-11-20T00:00:00Z',
   'US-311 : remises du jour et retards (17 §2.2 RPT ; aucune donnée personnelle)'),
  ('ADMIN',     'report.ops_views', 'PLATFORM', '2026-11-20T00:00:00Z',
   'US-311 : remises du jour et retards (17 §2.2 RPT)'),
  ('OPS_AGENT', 'report.exit_kpi',  'PLATFORM', '2026-11-20T00:00:00Z',
   'US-311 : KPI de sortie de bêta S1 à S4 (18 §1.1 ; agrégats)'),
  ('FINANCE',   'report.exit_kpi',  'PLATFORM', '2026-11-20T00:00:00Z',
   'US-311 : KPI de sortie de bêta S1 à S4 (18 §1.1 ; agrégats)'),
  ('ADMIN',     'report.exit_kpi',  'PLATFORM', '2026-11-20T00:00:00Z',
   'US-311 : KPI de sortie de bêta S1 à S4 (18 §1.1 ; agrégats)'),
  ('FINANCE',   'finance.reconciliation', 'PLATFORM', '2026-11-20T00:00:00Z',
   'US-311 : rapprochement par jambe (16 FIN-005 ; 17 §2.3 data.export « lim. financier »)'),
  ('ADMIN',     'finance.reconciliation', 'PLATFORM', '2026-11-20T00:00:00Z',
   'US-311 : rapprochement par jambe (16 FIN-005 ; journalisé)');

-- 2. Passages et éléments de rapprochement (17 §3.2.13, classe A) ------------------------------
CREATE TABLE core.finance_reconciliation_run (
  id                   uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT finance_reconciliation_run_pkey PRIMARY KEY,
  country_code         text        NOT NULL
    CONSTRAINT finance_recon_run_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  currency             text        NOT NULL
    CONSTRAINT finance_recon_run_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  -- OPERATIONS : opérations du PSP ↔ payment_operation ; LEGS : soldes par jambe ↔ trip_leg_balance
  kind                 text        NOT NULL
    CONSTRAINT finance_recon_run_kind_valid CHECK (kind IN ('OPERATIONS', 'LEGS')),
  -- 17 `scope` : rapprochement mensuel assisté de la bêta (le quotidien automatisé : US-711)
  scope                text        NOT NULL DEFAULT 'PSP_MONTHLY_MANUAL'
    CONSTRAINT finance_recon_run_scope_valid CHECK (scope = 'PSP_MONTHLY_MANUAL'),
  source               text        NOT NULL DEFAULT 'CSV_IMPORT'
    CONSTRAINT finance_recon_run_source_valid CHECK (source = 'CSV_IMPORT'),
  period_month         date        NOT NULL
    CONSTRAINT finance_recon_run_month_first CHECK (period_month = date_trunc('month', period_month)::date),
  psp_lines            integer     NOT NULL CONSTRAINT finance_recon_run_lines_nonneg CHECK (psp_lines >= 0),
  matched              integer     NOT NULL CONSTRAINT finance_recon_run_matched_nonneg CHECK (matched >= 0),
  -- lignes de la plateforme absentes du PSP (MISSING_PSP)
  unmatched_platform   integer     NOT NULL CONSTRAINT finance_recon_run_up_nonneg CHECK (unmatched_platform >= 0),
  -- lignes du PSP sans pendant à la plateforme (MISSING_PLATFORM : « opération sans trip »)
  unmatched_psp        integer     NOT NULL CONSTRAINT finance_recon_run_upsp_nonneg CHECK (unmatched_psp >= 0),
  amount_mismatches    integer     NOT NULL CONSTRAINT finance_recon_run_mm_nonneg CHECK (amount_mismatches >= 0),
  platform_total_minor bigint      NOT NULL CONSTRAINT finance_recon_run_total_nonneg CHECK (platform_total_minor >= 0),
  delta_minor          bigint      NOT NULL CONSTRAINT finance_recon_run_delta_nonneg CHECK (delta_minor >= 0),
  delta_pct_bps        integer     NOT NULL CONSTRAINT finance_recon_run_bps_nonneg CHECK (delta_pct_bps >= 0),
  -- seuil J-ADM-031 appliqué ; ABSENT ⇒ 0 (fail-closed, L3-PM-60)
  threshold_bps        integer     NOT NULL CONSTRAINT finance_recon_run_threshold_nonneg CHECK (threshold_bps >= 0),
  threshold_source     text        NOT NULL
    CONSTRAINT finance_recon_run_threshold_source CHECK (threshold_source IN ('PARAM', 'ABSENT_ZERO')),
  exceeds_threshold    boolean     NOT NULL,
  -- au-delà du seuil : traité au plus tard ce jour (5 jours ouvrés du pays ; calendrier absent ⇒
  -- le jour même, fail-closed)
  treat_by             date,
  status               text        NOT NULL
    CONSTRAINT finance_recon_run_status_valid CHECK (status IN ('MATCHED', 'DISCREPANCIES', 'CLOSED')),
  created_by           uuid        NOT NULL REFERENCES core.iam_user_account (id),
  created_role         text        NOT NULL
    CONSTRAINT finance_recon_run_role_valid CHECK (created_role IN ('FINANCE', 'ADMIN')),
  request_id           uuid        NOT NULL
    CONSTRAINT finance_recon_run_request_unique UNIQUE,
  created_at           timestamptz NOT NULL DEFAULT platform.now(),
  -- clôture : checklist signée (fondateur ou comptable)
  closed_by            uuid        REFERENCES core.iam_user_account (id),
  closed_role          text
    CONSTRAINT finance_recon_run_closed_role_valid CHECK (closed_role IN ('FINANCE', 'ADMIN')),
  closed_at            timestamptz,
  checklist            jsonb,
  unexplained_at_close integer
    CONSTRAINT finance_recon_run_unexplained_nonneg CHECK (unexplained_at_close >= 0),
  CONSTRAINT finance_recon_run_closed_shape CHECK (
    (status = 'CLOSED') = (closed_at IS NOT NULL)
    AND (closed_at IS NULL) = (closed_by IS NULL)
    AND (closed_at IS NULL) = (closed_role IS NULL)
    AND (closed_at IS NULL) = (checklist IS NULL)
    AND (closed_at IS NULL) = (unexplained_at_close IS NULL)),
  CONSTRAINT finance_recon_run_treat_shape CHECK (exceeds_threshold OR treat_by IS NULL)
);
CREATE INDEX finance_reconciliation_run_month_idx
  ON core.finance_reconciliation_run (country_code, period_month, kind);
COMMENT ON TABLE core.finance_reconciliation_run IS
  'FIN reconciliation_run (17 §3.2.13, 16 FIN-005) : passage de rapprochement mensuel assisté '
  '(opérations ou soldes par jambe) d''un pays, compté par la base, sans tolérance ; seuil '
  'J-ADM-031 appliqué (absent ⇒ 0) ; clôturé par la checklist signée. Écrit par les portes '
  'core.finance_staff_* seulement ; jamais supprimé. US-311 (ADR-194).';

CREATE TABLE core.finance_reconciliation_item (
  id             uuid        NOT NULL DEFAULT platform.uuid_v7()
    CONSTRAINT finance_reconciliation_item_pkey PRIMARY KEY,
  run_id         uuid        NOT NULL
    CONSTRAINT finance_recon_item_run_fk REFERENCES core.finance_reconciliation_run (id),
  -- côté qui porte la ligne : PSP (ligne de l'export) ou PLATFORM (ligne absente du PSP)
  side           text        NOT NULL
    CONSTRAINT finance_recon_item_side_valid CHECK (side IN ('PSP', 'PLATFORM')),
  -- référence d'opération du PSP, ou identifiant du trip (jambes)
  ref            text        NOT NULL
    CONSTRAINT finance_recon_item_ref_format CHECK (ref ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  leg            text
    CONSTRAINT finance_recon_item_leg_valid CHECK (leg IN ('HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM')),
  component      text
    CONSTRAINT finance_recon_item_component_valid CHECK (component IN
      ('AMOUNT', 'CAPTURED', 'REFUNDED', 'REALLOCATED_IN', 'REALLOCATED_OUT', 'RELEASED')),
  expected_minor bigint,
  observed_minor bigint,
  delta_minor    bigint      NOT NULL CONSTRAINT finance_recon_item_delta_nonneg CHECK (delta_minor >= 0),
  status         text        NOT NULL
    CONSTRAINT finance_recon_item_status_valid CHECK (status IN
      ('MATCHED', 'MISSING_PLATFORM', 'MISSING_PSP', 'AMOUNT_MISMATCH')),
  finding        text
    CONSTRAINT finance_recon_item_finding_valid CHECK (finding IN
      ('OPERATION_WITHOUT_TRIP', 'OPERATION_NOT_IN_PSP', 'LEG_WITHOUT_TRIP', 'LEG_NOT_IN_PSP',
       'AMOUNT')),
  -- résolution motivée (code fermé + note), une fois
  resolution     text
    CONSTRAINT finance_recon_item_resolution_valid CHECK (resolution IN
      ('TIMING', 'PSP_FEE', 'PSP_ERROR', 'PLATFORM_ERROR', 'DUPLICATE', 'OTHER')),
  resolution_note text
    CONSTRAINT finance_recon_item_note_length CHECK (pg_catalog.char_length(resolution_note) BETWEEN 10 AND 500),
  resolved_by    uuid        REFERENCES core.iam_user_account (id),
  resolved_at    timestamptz,
  CONSTRAINT finance_recon_item_matched_shape CHECK (
    (status = 'MATCHED') = (finding IS NULL) AND (status = 'MATCHED') = (delta_minor = 0)),
  CONSTRAINT finance_recon_item_resolution_shape CHECK (
    (resolution IS NULL) = (resolved_at IS NULL) AND (resolution IS NULL) = (resolved_by IS NULL)
    AND (resolution IS NULL) = (resolution_note IS NULL) AND (resolution IS NULL OR status <> 'MATCHED'))
);
CREATE INDEX finance_reconciliation_item_run_idx ON core.finance_reconciliation_item (run_id);
COMMENT ON TABLE core.finance_reconciliation_item IS
  'FIN reconciliation_item (17 §3.2.13) : ligne appariée ou en écart d''un passage (opération ou '
  'jambe, composante, attendu, observé, écart à l''unité mineure) ; résolution motivée une fois. '
  'Écrit par les portes core.finance_staff_* seulement ; jamais supprimé. US-311 (ADR-194).';

-- 2.1 Garde : aucune suppression ; un passage ne change qu'à sa clôture (une fois), un élément
-- qu'à sa résolution (une fois) ; migrator exempté (propriétaire, aucun code applicatif ne tourne
-- sous lui, L0-05).
CREATE FUNCTION core.finance_reconciliation_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF current_user = 'migrator' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION 'rapprochement : registre en ajout seul' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_TABLE_NAME = 'finance_reconciliation_run' THEN
    IF OLD.status = 'CLOSED' OR NEW.status <> 'CLOSED'
       OR (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'closed_by', 'closed_role', 'closed_at',
                                            'checklist', 'unexplained_at_close'])
          IS DISTINCT FROM
          (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'closed_by', 'closed_role', 'closed_at',
                                            'checklist', 'unexplained_at_close']) THEN
      RAISE EXCEPTION 'rapprochement : passage figé' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    IF OLD.resolution IS NOT NULL
       OR (pg_catalog.to_jsonb(NEW) - ARRAY['resolution', 'resolution_note', 'resolved_by',
                                            'resolved_at'])
          IS DISTINCT FROM
          (pg_catalog.to_jsonb(OLD) - ARRAY['resolution', 'resolution_note', 'resolved_by',
                                            'resolved_at']) THEN
      RAISE EXCEPTION 'rapprochement : élément figé' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END
$fn$;
CREATE TRIGGER finance_reconciliation_guard BEFORE UPDATE OR DELETE ON core.finance_reconciliation_run
  FOR EACH ROW EXECUTE FUNCTION core.finance_reconciliation_guard();
CREATE TRIGGER finance_reconciliation_guard BEFORE UPDATE OR DELETE ON core.finance_reconciliation_item
  FOR EACH ROW EXECUTE FUNCTION core.finance_reconciliation_guard();
CREATE TRIGGER finance_reconciliation_no_truncate BEFORE TRUNCATE ON core.finance_reconciliation_run
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('finance_reconciliation_guard');
CREATE TRIGGER finance_reconciliation_no_truncate BEFORE TRUNCATE ON core.finance_reconciliation_item
  FOR EACH STATEMENT EXECUTE FUNCTION core.audit_append_only('finance_reconciliation_guard');

-- 3. RLS : aucun droit applicatif ; portes sous iam_staff_owner --------------------------------
ALTER TABLE core.finance_reconciliation_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.finance_reconciliation_run FORCE ROW LEVEL SECURITY;
ALTER TABLE core.finance_reconciliation_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.finance_reconciliation_item FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.finance_reconciliation_run TO migrator USING (true) WITH CHECK (true);
CREATE POLICY migrator_all ON core.finance_reconciliation_item TO migrator USING (true) WITH CHECK (true);
GRANT SELECT, INSERT ON core.finance_reconciliation_run TO iam_staff_owner;
GRANT UPDATE (status, closed_by, closed_role, closed_at, checklist, unexplained_at_close)
  ON core.finance_reconciliation_run TO iam_staff_owner;
GRANT SELECT, INSERT ON core.finance_reconciliation_item TO iam_staff_owner;
GRANT UPDATE (resolution, resolution_note, resolved_by, resolved_at)
  ON core.finance_reconciliation_item TO iam_staff_owner;
CREATE POLICY iam_staff_recon_sel ON core.finance_reconciliation_run FOR SELECT TO iam_staff_owner
  USING (true);
CREATE POLICY iam_staff_recon_ins ON core.finance_reconciliation_run FOR INSERT TO iam_staff_owner
  WITH CHECK (status IN ('MATCHED', 'DISCREPANCIES'));
CREATE POLICY iam_staff_recon_close ON core.finance_reconciliation_run FOR UPDATE TO iam_staff_owner
  USING (status IN ('MATCHED', 'DISCREPANCIES')) WITH CHECK (status = 'CLOSED');
CREATE POLICY iam_staff_recon_sel ON core.finance_reconciliation_item FOR SELECT TO iam_staff_owner
  USING (true);
CREATE POLICY iam_staff_recon_ins ON core.finance_reconciliation_item FOR INSERT TO iam_staff_owner
  WITH CHECK (resolution IS NULL);
CREATE POLICY iam_staff_recon_resolve ON core.finance_reconciliation_item FOR UPDATE TO iam_staff_owner
  USING (resolution IS NULL AND status <> 'MATCHED') WITH CHECK (resolution IS NOT NULL);

-- 4. Lectures des sources par iam_staff_owner (colonnes au plus juste ; aucune donnée personnelle)
GRANT SELECT (org_id, vehicle_id, status, scheduled_start, scheduled_end, timezone, booked_at,
              source_hold_id, currency)
  ON core.booking_trip TO iam_staff_owner;   -- politique iam_staff_select (0033) : USING (true)
GRANT SELECT (currency) ON core.config_country TO iam_staff_owner;   -- iam_staff_select (0034)
GRANT SELECT (trip_id, kind, performer_role) ON core.trip_ops_handover_validation TO iam_staff_owner;
CREATE POLICY rpt_staff_read ON core.trip_ops_handover_validation FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (trip_id, direction, at) ON core.trip_ops_key_handover TO iam_staff_owner;
CREATE POLICY rpt_staff_read ON core.trip_ops_key_handover FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (trip_id, country_code, stage, scheduled_end, detected_at, use_until, bounded,
              next_trip_id)
  ON core.trip_ops_overdue_case TO iam_staff_owner;
CREATE POLICY rpt_staff_read ON core.trip_ops_overdue_case FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (trip_id, segment_no, leg, country_code, currency, captured_minor, refunded_minor,
              reallocated_in_minor, reallocated_out_minor, released_minor, frozen)
  ON core.settlement_trip_leg_balance TO iam_staff_owner;
CREATE POLICY rpt_staff_read ON core.settlement_trip_leg_balance FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (id, hold_id, trip_id, country_code, kind, purpose, status, amount_minor, currency,
              provider_reference, proof_type, created_at)
  ON core.payment_payment_operation TO iam_staff_owner;
CREATE POLICY rpt_staff_read ON core.payment_payment_operation FOR SELECT TO iam_staff_owner
  USING (true);
GRANT SELECT (org_id, country_code, status) ON core.kyc_host_verification TO iam_staff_owner;
CREATE POLICY rpt_staff_read ON core.kyc_host_verification FOR SELECT TO iam_staff_owner
  USING (true);
-- seuil J-ADM-031 du rapprochement seulement (colonnes déjà accordées par 0064)
CREATE POLICY rpt_staff_recon_threshold ON core.config_param_value FOR SELECT TO iam_staff_owner
  USING (key = 'reconciliation_delta_threshold_bps');
-- 5 jours ouvrés du pays (fonction interne de 0165, mêmes règles que les versements)
GRANT SELECT (country_code, version, date) ON core.config_holiday_calendar TO iam_staff_owner;
CREATE POLICY rpt_staff_read ON core.config_holiday_calendar FOR SELECT TO iam_staff_owner
  USING (true);
-- accordé par son propriétaire (cmd_money_owner, 0165) : migrator n'en a pas l'option d'octroi
SET LOCAL ROLE cmd_money_owner;
GRANT EXECUTE ON FUNCTION core.payout_business_day(text, date, integer) TO iam_staff_owner;
RESET ROLE;

-- 5. Vues de lecture (17 §2.2 RPT, security_invoker ; propriété d'iam_staff_owner) --------------
GRANT CREATE ON SCHEMA core TO iam_staff_owner;
SET LOCAL ROLE iam_staff_owner;

-- 5.1 Remises (CHECKIN) et retours (CHECKOUT) prévus aujourd'hui, au fuseau du trip, par compte
-- d'hôte ; trips annulés, refusés ou en no-show exclus
CREATE VIEW core.report_handover_day_v WITH (security_invoker = true) AS
SELECT t.id AS trip_id, t.public_ref, t.country_code, t.org_id, t.vehicle_id, t.status,
       x.kind, x.planned_at,
       EXISTS (SELECT 1 FROM core.trip_ops_handover_validation AS v
                WHERE v.trip_id = t.id AND v.kind = x.kind AND v.performer_role = 'HOST')
         AS host_validated,
       EXISTS (SELECT 1 FROM core.trip_ops_handover_validation AS v
                WHERE v.trip_id = t.id AND v.kind = x.kind AND v.performer_role = 'GUEST')
         AS guest_validated,
       (SELECT k.at FROM core.trip_ops_key_handover AS k
         WHERE k.trip_id = t.id
           AND k.direction = CASE x.kind WHEN 'CHECKIN' THEN 'OUT' ELSE 'IN' END) AS keys_at
  FROM core.booking_trip AS t
 CROSS JOIN LATERAL (VALUES ('CHECKIN'::text, t.scheduled_start),
                            ('CHECKOUT'::text, t.scheduled_end)) AS x(kind, planned_at)
 WHERE t.status NOT IN ('CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST', 'CANCELLED_BY_PLATFORM',
                        'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST', 'NO_SHOW_HOST')
   AND (x.planned_at AT TIME ZONE t.timezone)::date
       = (platform.now() AT TIME ZONE t.timezone)::date;
COMMENT ON VIEW core.report_handover_day_v IS
  'RPT : remises et retours prévus aujourd''hui (fuseau du trip), validations de chaque partie et '
  'clés ; aucune donnée personnelle. Lue par core.report_staff_beta_view seulement. US-311.';

-- 5.2 Retards vivants (dossier de 0168 ; trip encore OVERDUE ou UNRETURNED)
CREATE VIEW core.report_overdue_v WITH (security_invoker = true) AS
SELECT c.trip_id, t.public_ref, c.country_code, t.org_id, t.vehicle_id, t.status, c.stage,
       c.scheduled_end, c.detected_at,
       pg_catalog.floor(pg_catalog.date_part('epoch', platform.now() - c.scheduled_end) / 60)::bigint
         AS minutes_late,
       c.use_until, c.bounded, c.next_trip_id
  FROM core.trip_ops_overdue_case AS c
  JOIN core.booking_trip AS t ON t.id = c.trip_id
 WHERE c.stage <> 'RESOLVED' AND t.status IN ('OVERDUE', 'UNRETURNED');
COMMENT ON VIEW core.report_overdue_v IS
  'RPT : retards vivants (étape, fin prévue, détection, minutes de retard à l''heure serveur, trip '
  'suivant à risque) ; aucune donnée personnelle. Lue par core.report_staff_beta_view. US-311.';

-- 5.3 KPI de sortie de bêta (18 §1.1), calculés à chaque lecture, par pays
CREATE VIEW core.report_exit_kpi_v WITH (security_invoker = true) AS
SELECT k.code::text AS country_code,
       -- S1 : comptes d'hôte vérifiés (APPROVED) avec au moins un trip commencé ce mois-ci (fuseau
       -- du pays) ; seuil non fixé (18 : « à fixer avec la dotation de l'ops »)
       (SELECT pg_catalog.count(DISTINCT t.org_id)
          FROM core.booking_trip AS t
         WHERE t.country_code = k.code::text
           AND t.status NOT IN ('CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST', 'CANCELLED_BY_PLATFORM',
                                'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST', 'NO_SHOW_HOST', 'BOOKED',
                                'CHECKIN_OPEN', 'START_WINDOW_EXPIRED')
           AND pg_catalog.date_trunc('month', t.scheduled_start AT TIME ZONE k.time_zone)
               = pg_catalog.date_trunc('month', platform.now() AT TIME ZONE k.time_zone)
           AND EXISTS (SELECT 1 FROM core.kyc_host_verification AS v
                        WHERE v.org_id = t.org_id AND v.status = 'APPROVED'))::bigint
         AS s1_active_hosts,
       -- S2 : trips terminés cumulés (retour fait)
       (SELECT pg_catalog.count(*) FROM core.booking_trip AS t
         WHERE t.country_code = k.code::text
           AND t.status IN ('RETURNED', 'POST_TRIP', 'COMPLETED'))::bigint AS s2_completed_trips,
       -- S2 : double réservation = deux trips vivants du même véhicule qui se chevauchent
       (SELECT pg_catalog.count(*)
          FROM core.booking_trip AS a
          JOIN core.booking_trip AS b
            ON b.vehicle_id = a.vehicle_id AND b.id > a.id
           AND pg_catalog.tstzrange(a.scheduled_start, a.scheduled_end, '[)')
               && pg_catalog.tstzrange(b.scheduled_start, b.scheduled_end, '[)')
         WHERE a.country_code = k.code::text
           AND a.status NOT IN ('CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST', 'CANCELLED_BY_PLATFORM',
                                'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST', 'NO_SHOW_HOST')
           AND b.status NOT IN ('CANCELLED_BY_GUEST', 'CANCELLED_BY_HOST', 'CANCELLED_BY_PLATFORM',
                                'REFUSED_AT_PICKUP', 'NO_SHOW_GUEST', 'NO_SHOW_HOST'))::bigint
         AS s2_double_bookings,
       -- S2 : clés remises sans paiement prouvé (aucune autorisation ni capture réussie et prouvée)
       (SELECT pg_catalog.count(*)
          FROM core.trip_ops_key_handover AS kh
          JOIN core.booking_trip AS t ON t.id = kh.trip_id
         WHERE kh.direction = 'OUT' AND t.country_code = k.code::text
           AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation AS op
                            WHERE op.hold_id = t.source_hold_id
                              AND op.kind IN ('AUTH', 'CAPTURE') AND op.status = 'SUCCEEDED'
                              AND op.proof_type IS NOT NULL))::bigint AS s2_keys_unpaid,
       -- S4 : éléments en écart NON expliqués des passages des deux mois complets précédents
       (SELECT pg_catalog.count(*)
          FROM core.finance_reconciliation_item AS i
          JOIN core.finance_reconciliation_run AS r ON r.id = i.run_id
         WHERE r.country_code = k.code::text AND i.status <> 'MATCHED' AND i.resolution IS NULL
           AND r.period_month >= (pg_catalog.date_trunc('month', platform.now() AT TIME ZONE k.time_zone)
                                  - interval '2 months')::date
           AND r.period_month < pg_catalog.date_trunc('month', platform.now() AT TIME ZONE k.time_zone)::date)::bigint
         AS s4_unexplained_items,
       -- S4 : mois complets précédents (deux au plus) clôturés pour les opérations ET les jambes
       (SELECT pg_catalog.count(*) FROM (
          SELECT r.period_month
            FROM core.finance_reconciliation_run AS r
           WHERE r.country_code = k.code::text AND r.status = 'CLOSED'
             AND r.period_month >= (pg_catalog.date_trunc('month', platform.now() AT TIME ZONE k.time_zone)
                                    - interval '2 months')::date
             AND r.period_month < pg_catalog.date_trunc('month', platform.now() AT TIME ZONE k.time_zone)::date
           GROUP BY r.period_month
          HAVING pg_catalog.count(DISTINCT r.kind) = 2) AS m)::bigint AS s4_months_closed
  FROM core.config_country AS k;
COMMENT ON VIEW core.report_exit_kpi_v IS
  'RPT : KPI de sortie de bêta (18 §1.1 S1, S2, S4) calculés depuis les données à chaque lecture ; '
  'S3 (sinistres) sans source avant US-309 : non mesurable. Aucune saisie. US-311 (ADR-194).';

-- 6. Fonctions internes (SECURITY INVOKER, EXECUTE au seul propriétaire) ------------------------

-- 6.1 Session élevée, permission et pays ; refus journalisés. Issues : OK (rôle rendu),
-- AUTH_REQUIRED (rien n'est écrit), MFA_REQUIRED, FORBIDDEN.
CREATE FUNCTION core.report_staff_gate(p_token_hash bytea, p_permission text, p_country text,
                                       p_attempted text, p_request_id uuid)
  RETURNS TABLE (outcome text, user_id uuid, role text)
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_s    record;
  v_role text;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_ACCESS_DENIED', 'REPORT',
                                 pg_catalog.gen_random_uuid(), NULL,
                                 pg_catalog.jsonb_build_object('reason', '2FA_REQUIRED',
                                   'attempted', p_attempted, 'permission', p_permission,
                                   'country', p_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'MFA_REQUIRED'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  v_role := core.iam_staff_permitted(v_s.user_id, p_permission, ARRAY[p_country], NULL);
  IF v_role IS NULL THEN
    PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'REPORT',
                                 pg_catalog.gen_random_uuid(), NULL,
                                 pg_catalog.jsonb_build_object('reason', 'PERMISSION',
                                   'attempted', p_attempted, 'permission', p_permission,
                                   'country', p_country),
                                 NULL, p_request_id);
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::uuid, NULL::text;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, v_s.user_id, v_role;
END
$fn$;

-- 6.1 bis Objet introuvable (passage, élément) : session jugée, refus journalisé sans pays ; même
-- issue qu'un objet d'un pays sans permission (aucun oracle d'existence). Issues : AUTH_REQUIRED
-- (rien n'est écrit), MFA_REQUIRED, FORBIDDEN.
CREATE FUNCTION core.report_staff_not_found(p_token_hash bytea, p_attempted text,
                                            p_subject_id uuid, p_request_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  VOLATILE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_s record;
BEGIN
  SELECT * INTO v_s FROM core.iam_staff_session(p_token_hash);
  IF v_s.user_id IS NULL THEN
    RETURN 'AUTH_REQUIRED';
  END IF;
  IF v_s.mfa_level <> 'TOTP' THEN
    RETURN 'MFA_REQUIRED';
  END IF;
  PERFORM core.iam_staff_audit(v_s.user_id, 'STAFF', 'STAFF_FORBIDDEN', 'RECONCILIATION',
                               p_subject_id, NULL,
                               pg_catalog.jsonb_build_object('reason', 'NOT_FOUND',
                                 'attempted', p_attempted,
                                 'permission', 'finance.reconciliation'),
                               NULL, p_request_id);
  RETURN 'FORBIDDEN';
END
$fn$;

-- 6.2 Seuil J-ADM-031 en vigueur (bps) ; absent ou mal formé ⇒ NULL (l'appelant applique 0)
CREATE FUNCTION core.finance_recon_threshold_bps(p_country text)
  RETURNS integer
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN pg_catalog.jsonb_typeof(v.value) = 'number'
                   AND (v.value #>> '{}') ~ '^[0-9]{1,5}$'
                   AND (v.value #>> '{}')::integer <= 10000
              THEN (v.value #>> '{}')::integer END
    FROM core.config_param_value AS v
   WHERE v.key = 'reconciliation_delta_threshold_bps'
     AND v.country_code::text = p_country
     AND v.scope_type = 'COUNTRY'
     AND v.valid_from <= platform.now()
     AND (v.valid_to IS NULL OR v.valid_to > platform.now())
   ORDER BY v.valid_from DESC
   LIMIT 1
$fn$;

-- 6.3 État des mois de rapprochement d'un pays (24 derniers mois) : clôture des deux natures,
-- éléments non expliqués ; « quotidien préalable » quand les deux derniers mois complets ont
-- chacun un écart inexpliqué (19 US-311 critère 4 ; US-711)
CREATE FUNCTION core.finance_recon_month_state(p_country text)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH k AS (
    SELECT pg_catalog.date_trunc('month', platform.now() AT TIME ZONE c.time_zone)::date AS cur
      FROM core.config_country AS c WHERE c.code::text = p_country
  ), m AS (
    SELECT r.period_month,
           pg_catalog.count(DISTINCT r.kind) FILTER (WHERE r.status = 'CLOSED') AS kinds_closed,
           (SELECT pg_catalog.count(*) FROM core.finance_reconciliation_item AS i
              JOIN core.finance_reconciliation_run AS q ON q.id = i.run_id
             WHERE q.country_code = p_country AND q.period_month = r.period_month
               AND i.status <> 'MATCHED' AND i.resolution IS NULL) AS unexplained
      FROM core.finance_reconciliation_run AS r, k
     WHERE r.country_code = p_country AND r.period_month >= (k.cur - interval '24 months')::date
     GROUP BY r.period_month
  ), last2 AS (
    SELECT g.month::date AS month, COALESCE(m.unexplained, 0) AS unexplained,
           COALESCE(m.kinds_closed, 0) AS kinds_closed
      FROM k, pg_catalog.generate_series((k.cur - interval '2 months')::timestamp,
                                         (k.cur - interval '1 month')::timestamp,
                                         interval '1 month') AS g(month)
      LEFT JOIN m ON m.period_month = g.month::date
  )
  SELECT pg_catalog.jsonb_build_object(
    'months', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                          'month', pg_catalog.to_char(m.period_month, 'YYYY-MM'),
                          'closed', m.kinds_closed = 2, 'unexplained', m.unexplained)
                          ORDER BY m.period_month DESC) FROM m), '[]'::jsonb),
    'dailyReconciliationRequired',
      (SELECT pg_catalog.count(*) = 2 AND pg_catalog.bool_and(l.unexplained > 0) FROM last2 AS l),
    'previousMonthsClosed',
      (SELECT pg_catalog.count(*) FILTER (WHERE l.kinds_closed = 2) FROM last2 AS l))
$fn$;

-- 7. Portes de la console (SECURITY DEFINER, iam_staff_owner, EXECUTE app_api) ------------------

-- 7.1 Vue de la bêta d'un pays : HANDOVERS_TODAY, OVERDUE (report.ops_views), EXIT_KPI
-- (report.exit_kpi). Export (p_export) : motif de 10 à 500 caractères, journal d'accès
-- BULK_EXPORT et audit chaîné. Issues : OK, AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN.
CREATE FUNCTION core.report_staff_beta_view(p_token_hash bytea, p_request_id uuid, p_view text,
                                            p_country text, p_export boolean, p_reason text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  g        record;
  v_rows   jsonb;
  v_access uuid;
  v_month  jsonb;
  v_reason text := pg_catalog.btrim(p_reason);
BEGIN
  IF p_request_id IS NULL OR p_view IS NULL
     OR p_view NOT IN ('HANDOVERS_TODAY', 'OVERDUE', 'EXIT_KPI')
     OR p_country IS NULL OR p_country !~ '^[A-Z]{2}$' OR p_export IS NULL
     OR (p_export AND (v_reason IS NULL OR pg_catalog.char_length(v_reason) NOT BETWEEN 10 AND 500))
  THEN
    RAISE EXCEPTION 'vue de la bêta : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO g FROM core.report_staff_gate(p_token_hash,
    CASE WHEN p_view = 'EXIT_KPI' THEN 'report.exit_kpi' ELSE 'report.ops_views' END,
    p_country, CASE WHEN p_export THEN 'REPORT_EXPORT' ELSE 'REPORT_READ' END, p_request_id);
  IF g.outcome <> 'OK' THEN
    RETURN QUERY SELECT g.outcome, NULL::jsonb;
    RETURN;
  END IF;
  IF p_view = 'HANDOVERS_TODAY' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'tripId', v.trip_id, 'tripRef', v.public_ref, 'orgId', v.org_id,
             'vehicleId', v.vehicle_id, 'status', v.status, 'kind', v.kind,
             'plannedAt', v.planned_at, 'hostValidated', v.host_validated,
             'guestValidated', v.guest_validated, 'keysAt', v.keys_at)
             ORDER BY v.org_id, v.planned_at, v.trip_id, v.kind), '[]'::jsonb)
      INTO v_rows
      FROM core.report_handover_day_v AS v WHERE v.country_code = p_country;
  ELSIF p_view = 'OVERDUE' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'tripId', v.trip_id, 'tripRef', v.public_ref, 'orgId', v.org_id,
             'vehicleId', v.vehicle_id, 'status', v.status, 'stage', v.stage,
             'scheduledEnd', v.scheduled_end, 'detectedAt', v.detected_at,
             'minutesLate', v.minutes_late, 'useUntil', v.use_until, 'bounded', v.bounded,
             'nextTripId', v.next_trip_id)
             ORDER BY v.scheduled_end, v.trip_id), '[]'::jsonb)
      INTO v_rows
      FROM core.report_overdue_v AS v WHERE v.country_code = p_country;
  ELSE
    v_month := core.finance_recon_month_state(p_country);
    -- seuils de 18 §1.1 (PROPOSÉS) : S1 à fixer ; S2 ≥ 100 et 0 incident ; S3 100 % ; S4 0 écart
    -- non expliqué sur deux cycles ; non mesurable ⇒ met = null (critère non atteint)
    SELECT pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object('code', 'S1', 'measurable', true,
               'value', v.s1_active_hosts, 'threshold', NULL, 'met', NULL),
             pg_catalog.jsonb_build_object('code', 'S2', 'measurable', true,
               'value', v.s2_completed_trips, 'threshold', 100,
               'doubleBookings', v.s2_double_bookings, 'keysWithoutPayment', v.s2_keys_unpaid,
               'met', v.s2_completed_trips >= 100 AND v.s2_double_bookings = 0
                      AND v.s2_keys_unpaid = 0),
             pg_catalog.jsonb_build_object('code', 'S3', 'measurable', false,
               'value', NULL, 'threshold', 100, 'met', NULL),
             pg_catalog.jsonb_build_object('code', 'S4', 'measurable', true,
               'value', v.s4_unexplained_items, 'threshold', 0,
               'monthsClosed', v.s4_months_closed,
               'dailyReconciliationRequired', v_month -> 'dailyReconciliationRequired',
               'met', v.s4_unexplained_items = 0 AND v.s4_months_closed = 2))
      INTO v_rows
      FROM core.report_exit_kpi_v AS v WHERE v.country_code = p_country;
    v_rows := COALESCE(v_rows, '[]'::jsonb);
  END IF;
  IF p_export THEN
    v_access := pg_catalog.gen_random_uuid();
    INSERT INTO core.audit_data_access_log
           (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
            access_kind, case_ref, request_id)
    VALUES (v_access, g.user_id, g.role, 'REPORT', p_request_id,
            'report:' || pg_catalog.lower(p_view) || ':' || p_country, v_reason, 'BULK_EXPORT',
            NULL, p_request_id);
    PERFORM core.iam_staff_audit(g.user_id, g.role, 'STAFF_DATA_ACCESS', 'REPORT', p_request_id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('country', p_country,
                                   'access_kind', 'BULK_EXPORT', 'attempted', 'REPORT_EXPORT',
                                   'view', p_view, 'rows', pg_catalog.jsonb_array_length(v_rows),
                                   'data_access_id', v_access),
                                 v_reason, p_request_id);
  END IF;
  RETURN QUERY SELECT 'OK'::text, pg_catalog.jsonb_build_object(
    'view', p_view, 'country', p_country, 'at', platform.now(), 'rows', v_rows);
END
$fn$;
COMMENT ON FUNCTION core.report_staff_beta_view(bytea, uuid, text, text, boolean, text) IS
  'Console : vue de la bêta d''un pays (remises du jour, retards : report.ops_views ; KPI de '
  'sortie : report.exit_kpi), aucune donnée personnelle ; export journalisé (BULK_EXPORT) et '
  'audit chaîné ; refus journalisés. EXECUTE app_api. US-311 (ADR-194).';

-- 7.2 Export de la plateforme pour le rapprochement d'un mois (finance.reconciliation) :
-- OPERATIONS (opérations réussies du mois, fuseau du pays) ou LEGS (soldes par jambe des trips
-- réservés dans le mois). Motif obligatoire, journal d'accès BULK_EXPORT et audit chaîné.
CREATE FUNCTION core.finance_staff_reconciliation_export(p_token_hash bytea, p_request_id uuid,
                                                         p_country text, p_month date,
                                                         p_kind text, p_reason text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  g        record;
  v_tz     text;
  v_rows   jsonb;
  v_access uuid;
  v_reason text := pg_catalog.btrim(p_reason);
BEGIN
  IF p_request_id IS NULL OR p_country IS NULL OR p_country !~ '^[A-Z]{2}$' OR p_month IS NULL
     OR p_month <> pg_catalog.date_trunc('month', p_month)::date
     OR p_kind IS NULL OR p_kind NOT IN ('OPERATIONS', 'LEGS')
     OR v_reason IS NULL OR pg_catalog.char_length(v_reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'rapprochement : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO g FROM core.report_staff_gate(p_token_hash, 'finance.reconciliation', p_country,
                                              'RECONCILIATION_EXPORT', p_request_id);
  IF g.outcome <> 'OK' THEN
    RETURN QUERY SELECT g.outcome, NULL::jsonb;
    RETURN;
  END IF;
  SELECT c.time_zone INTO v_tz FROM core.config_country AS c WHERE c.code::text = p_country;
  IF p_kind = 'OPERATIONS' THEN
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'reference', op.provider_reference, 'kind', op.kind, 'purpose', op.purpose,
             'amountMinor', op.amount_minor::text, 'currency', op.currency,
             'tripId', COALESCE(op.trip_id, t.id), 'tripRef', t.public_ref,
             'createdAt', op.created_at)
             ORDER BY op.created_at, op.id), '[]'::jsonb)
      INTO v_rows
      FROM core.payment_payment_operation AS op
      LEFT JOIN core.booking_trip AS t
        ON t.id = op.trip_id OR (op.trip_id IS NULL AND t.source_hold_id = op.hold_id)
     WHERE op.country_code = p_country AND op.status = 'SUCCEEDED'
       AND op.provider_reference IS NOT NULL
       AND pg_catalog.date_trunc('month', op.created_at AT TIME ZONE v_tz)::date = p_month;
  ELSE
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'tripId', t.id, 'tripRef', t.public_ref, 'leg', b.leg, 'currency', b.currency,
             'capturedMinor', b.captured_minor::text, 'refundedMinor', b.refunded_minor::text,
             'reallocatedInMinor', b.reallocated_in_minor::text,
             'reallocatedOutMinor', b.reallocated_out_minor::text,
             'releasedMinor', b.released_minor::text, 'frozen', b.frozen)
             ORDER BY t.booked_at, t.id, b.leg), '[]'::jsonb)
      INTO v_rows
      FROM core.settlement_trip_leg_balance AS b
      JOIN core.booking_trip AS t ON t.id = b.trip_id
     WHERE b.country_code = p_country
       AND pg_catalog.date_trunc('month', t.booked_at AT TIME ZONE v_tz)::date = p_month;
  END IF;
  v_access := pg_catalog.gen_random_uuid();
  INSERT INTO core.audit_data_access_log
         (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
          access_kind, case_ref, request_id)
  VALUES (v_access, g.user_id, g.role, 'RECONCILIATION', p_request_id,
          'reconciliation:' || pg_catalog.lower(p_kind) || ':' || p_country || ':'
            || pg_catalog.to_char(p_month, 'YYYY-MM'),
          v_reason, 'BULK_EXPORT', NULL, p_request_id);
  PERFORM core.iam_staff_audit(g.user_id, g.role, 'STAFF_DATA_ACCESS', 'RECONCILIATION',
                               p_request_id, NULL,
                               pg_catalog.jsonb_build_object('country', p_country,
                                 'access_kind', 'BULK_EXPORT', 'attempted', 'RECONCILIATION_EXPORT',
                                 'kind', p_kind, 'month', pg_catalog.to_char(p_month, 'YYYY-MM'),
                                 'rows', pg_catalog.jsonb_array_length(v_rows),
                                 'data_access_id', v_access),
                               v_reason, p_request_id);
  RETURN QUERY SELECT 'OK'::text, pg_catalog.jsonb_build_object(
    'kind', p_kind, 'country', p_country, 'month', pg_catalog.to_char(p_month, 'YYYY-MM'),
    'rows', v_rows);
END
$fn$;
COMMENT ON FUNCTION core.finance_staff_reconciliation_export(bytea, uuid, text, date, text, text) IS
  'Console : export de la plateforme pour le rapprochement mensuel (opérations ou soldes par '
  'jambe ; montants, références, identifiants techniques, aucune donnée personnelle) ; '
  'finance.reconciliation dans le pays ; journal d''accès BULK_EXPORT et audit chaîné. EXECUTE '
  'app_api. US-311 (ADR-194).';

-- 7.3 Passage de rapprochement : appariement, à l'unité mineure, des lignes du PSP (export collé
-- ou listLegBalances du FAKE) avec la plateforme. Aucune tolérance. Idempotent par identifiant de
-- requête. Issues : RECORDED, ALREADY_RECORDED (même requête), AUTH_REQUIRED, MFA_REQUIRED,
-- FORBIDDEN. Ligne mal formée, doublon ou autre devise ⇒ 22023 (RECON_FORMAT_INVALID) ; aucune
-- ligne ⇒ 22023 (RECON_STATEMENT_MISSING) ; mois à venir ⇒ 22023.
CREATE FUNCTION core.finance_staff_record_reconciliation(p_token_hash bytea, p_request_id uuid,
                                                         p_country text, p_month date,
                                                         p_kind text, p_lines jsonb,
                                                         p_reason text)
  RETURNS TABLE (outcome text, run_id uuid)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  g          record;
  v_tz       text;
  v_currency text;
  v_items    jsonb;
  v_total    bigint;
  v_run      uuid;
  v_existing record;
  v_thr      integer;
  v_thr_src  text;
  a          record;
  v_bps      integer;
  v_exceeds  boolean;
  v_treat    date;
  v_today    date;
  v_reason   text := pg_catalog.btrim(p_reason);
BEGIN
  IF p_request_id IS NULL OR p_country IS NULL OR p_country !~ '^[A-Z]{2}$' OR p_month IS NULL
     OR p_month <> pg_catalog.date_trunc('month', p_month)::date
     OR p_kind IS NULL OR p_kind NOT IN ('OPERATIONS', 'LEGS')
     OR p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array'
     OR pg_catalog.jsonb_array_length(p_lines) NOT BETWEEN 1 AND 5000
     OR v_reason IS NULL OR pg_catalog.char_length(v_reason) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'rapprochement : relevé absent ou entrée invalide'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO g FROM core.report_staff_gate(p_token_hash, 'finance.reconciliation', p_country,
                                              'RECONCILIATION_RECORD', p_request_id);
  IF g.outcome <> 'OK' THEN
    RETURN QUERY SELECT g.outcome, NULL::uuid;
    RETURN;
  END IF;
  SELECT r.id, r.country_code, r.kind, r.period_month INTO v_existing
    FROM core.finance_reconciliation_run AS r WHERE r.request_id = p_request_id;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.country_code <> p_country OR v_existing.kind <> p_kind
       OR v_existing.period_month <> p_month THEN
      RAISE EXCEPTION 'rapprochement : identifiant de requête déjà pris'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    RETURN QUERY SELECT 'ALREADY_RECORDED'::text, v_existing.id;
    RETURN;
  END IF;
  SELECT c.time_zone, c.currency::text INTO v_tz, v_currency
    FROM core.config_country AS c WHERE c.code::text = p_country;
  v_today := (platform.now() AT TIME ZONE v_tz)::date;
  IF p_month > pg_catalog.date_trunc('month', v_today)::date THEN
    RAISE EXCEPTION 'rapprochement : mois à venir' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- format des lignes (RECON_FORMAT_INVALID) : objet, devise du pays, montants entiers ≥ 0
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_lines) AS e(x)
     WHERE pg_catalog.jsonb_typeof(e.x) <> 'object'
        OR (e.x ->> 'currency') IS DISTINCT FROM v_currency
        OR (p_kind = 'OPERATIONS' AND (
              COALESCE(e.x ->> 'reference', '') !~ '^[A-Za-z0-9_.:-]{1,128}$'
              OR COALESCE(e.x ->> 'amountMinor', '') !~ '^[0-9]{1,18}$'))
        OR (p_kind = 'LEGS' AND (
              COALESCE(e.x ->> 'tripReference', '') !~ '^[A-Za-z0-9_.:-]{1,128}$'
              OR COALESCE(e.x ->> 'leg', '') NOT IN ('HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM')
              OR COALESCE(e.x ->> 'capturedMinor', '') !~ '^[0-9]{1,18}$'
              OR COALESCE(e.x ->> 'refundedMinor', '') !~ '^[0-9]{1,18}$'
              OR COALESCE(e.x ->> 'reallocatedInMinor', '') !~ '^[0-9]{1,18}$'
              OR COALESCE(e.x ->> 'reallocatedOutMinor', '') !~ '^[0-9]{1,18}$'
              OR COALESCE(e.x ->> 'releasedMinor', '') !~ '^[0-9]{1,18}$')))
     OR (p_kind = 'OPERATIONS' AND EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(p_lines) AS e(x)
           GROUP BY e.x ->> 'reference' HAVING pg_catalog.count(*) > 1))
     OR (p_kind = 'LEGS' AND EXISTS (
          SELECT 1 FROM pg_catalog.jsonb_array_elements(p_lines) AS e(x)
           GROUP BY e.x ->> 'tripReference', e.x ->> 'leg' HAVING pg_catalog.count(*) > 1)) THEN
    RAISE EXCEPTION 'rapprochement : relevé mal formé' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind = 'OPERATIONS' THEN
    -- plateforme : opérations réussies du pays portant une référence du PSP ; « sans trip » quand
    -- ni l'opération ni son hold ne mènent à un trip
    WITH plat AS (
      SELECT DISTINCT ON (op.provider_reference)
             op.provider_reference AS ref, op.amount_minor AS amt, op.created_at,
             (op.trip_id IS NOT NULL
              OR EXISTS (SELECT 1 FROM core.booking_trip AS t WHERE t.source_hold_id = op.hold_id))
               AS has_trip
        FROM core.payment_payment_operation AS op
       WHERE op.country_code = p_country AND op.status = 'SUCCEEDED'
         AND op.provider_reference IS NOT NULL
       ORDER BY op.provider_reference, op.created_at, op.id
    ), psp AS (
      SELECT e.x ->> 'reference' AS ref, (e.x ->> 'amountMinor')::bigint AS amt
        FROM pg_catalog.jsonb_array_elements(p_lines) AS e(x)
    ), items AS (
      SELECT 'PSP'::text AS side, p.ref, NULL::text AS leg,
             CASE WHEN pl.ref IS NULL OR NOT pl.has_trip OR pl.amt = p.amt THEN NULL
                  ELSE 'AMOUNT' END AS component,
             pl.amt AS expected_minor, p.amt AS observed_minor,
             CASE WHEN pl.ref IS NULL OR NOT pl.has_trip THEN p.amt
                  ELSE pg_catalog.abs(pl.amt - p.amt) END AS delta_minor,
             CASE WHEN pl.ref IS NULL OR NOT pl.has_trip THEN 'MISSING_PLATFORM'
                  WHEN pl.amt = p.amt THEN 'MATCHED' ELSE 'AMOUNT_MISMATCH' END AS status,
             CASE WHEN pl.ref IS NULL OR NOT pl.has_trip THEN 'OPERATION_WITHOUT_TRIP'
                  WHEN pl.amt = p.amt THEN NULL ELSE 'AMOUNT' END AS finding
        FROM psp AS p LEFT JOIN plat AS pl ON pl.ref = p.ref
      UNION ALL
      SELECT 'PLATFORM', pl.ref, NULL, NULL, pl.amt, NULL, pl.amt, 'MISSING_PSP',
             'OPERATION_NOT_IN_PSP'
        FROM plat AS pl
       WHERE pg_catalog.date_trunc('month', pl.created_at AT TIME ZONE v_tz)::date = p_month
         AND NOT EXISTS (SELECT 1 FROM psp WHERE psp.ref = pl.ref)
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i)), '[]'::jsonb),
           (SELECT COALESCE(pg_catalog.sum(pl.amt), 0)::bigint FROM plat AS pl
             WHERE pg_catalog.date_trunc('month', pl.created_at AT TIME ZONE v_tz)::date = p_month)
      INTO v_items, v_total
      FROM items AS i;
  ELSE
    -- plateforme : soldes par jambe des trips du pays (référence = trip ou hold d'origine) ;
    -- les cinq composantes comparées à l'unité mineure, dans l'ordre de 17 §2.9
    WITH plat AS (
      SELECT t.id AS trip_id, t.source_hold_id, t.booked_at, b.leg, b.captured_minor AS c,
             b.refunded_minor AS r, b.reallocated_in_minor AS ri, b.reallocated_out_minor AS ro,
             b.released_minor AS rel
        FROM core.settlement_trip_leg_balance AS b
        JOIN core.booking_trip AS t ON t.id = b.trip_id
       WHERE b.country_code = p_country AND b.segment_no = 1
    ), psp AS (
      SELECT e.x ->> 'tripReference' AS ref, e.x ->> 'leg' AS leg,
             (e.x ->> 'capturedMinor')::bigint AS c, (e.x ->> 'refundedMinor')::bigint AS r,
             (e.x ->> 'reallocatedInMinor')::bigint AS ri,
             (e.x ->> 'reallocatedOutMinor')::bigint AS ro,
             (e.x ->> 'releasedMinor')::bigint AS rel
        FROM pg_catalog.jsonb_array_elements(p_lines) AS e(x)
    ), pair AS (
      SELECT p.*, pl.trip_id, pl.c AS pc, pl.r AS pr, pl.ri AS pri, pl.ro AS pro, pl.rel AS prel
        FROM psp AS p
        LEFT JOIN plat AS pl
          ON pl.leg = p.leg AND (pl.trip_id::text = p.ref OR pl.source_hold_id::text = p.ref)
    ), items AS (
      SELECT 'PSP'::text AS side, COALESCE(x.trip_id::text, x.ref) AS ref, x.leg,
             CASE WHEN x.trip_id IS NULL THEN NULL
                  WHEN x.pc <> x.c THEN 'CAPTURED' WHEN x.pr <> x.r THEN 'REFUNDED'
                  WHEN x.pri <> x.ri THEN 'REALLOCATED_IN' WHEN x.pro <> x.ro THEN 'REALLOCATED_OUT'
                  WHEN x.prel <> x.rel THEN 'RELEASED' END AS component,
             CASE WHEN x.trip_id IS NULL THEN NULL
                  WHEN x.pc <> x.c THEN x.pc WHEN x.pr <> x.r THEN x.pr
                  WHEN x.pri <> x.ri THEN x.pri WHEN x.pro <> x.ro THEN x.pro
                  ELSE x.prel END AS expected_minor,
             CASE WHEN x.trip_id IS NULL THEN x.c
                  WHEN x.pc <> x.c THEN x.c WHEN x.pr <> x.r THEN x.r
                  WHEN x.pri <> x.ri THEN x.ri WHEN x.pro <> x.ro THEN x.ro
                  ELSE x.rel END AS observed_minor,
             CASE WHEN x.trip_id IS NULL THEN x.c + x.r + x.ri + x.ro + x.rel
                  ELSE pg_catalog.abs(x.pc - x.c) + pg_catalog.abs(x.pr - x.r)
                       + pg_catalog.abs(x.pri - x.ri) + pg_catalog.abs(x.pro - x.ro)
                       + pg_catalog.abs(x.prel - x.rel) END AS delta_minor,
             CASE WHEN x.trip_id IS NULL THEN 'MISSING_PLATFORM'
                  WHEN x.pc = x.c AND x.pr = x.r AND x.pri = x.ri AND x.pro = x.ro
                       AND x.prel = x.rel THEN 'MATCHED'
                  ELSE 'AMOUNT_MISMATCH' END AS status,
             CASE WHEN x.trip_id IS NULL THEN 'LEG_WITHOUT_TRIP'
                  WHEN x.pc = x.c AND x.pr = x.r AND x.pri = x.ri AND x.pro = x.ro
                       AND x.prel = x.rel THEN NULL
                  ELSE 'AMOUNT' END AS finding
        FROM pair AS x
      UNION ALL
      SELECT 'PLATFORM', pl.trip_id::text, pl.leg, NULL, pl.c, NULL,
             pl.c + pl.r + pl.ri + pl.ro + pl.rel, 'MISSING_PSP', 'LEG_NOT_IN_PSP'
        FROM plat AS pl
       WHERE pg_catalog.date_trunc('month', pl.booked_at AT TIME ZONE v_tz)::date = p_month
         AND NOT EXISTS (SELECT 1 FROM pair AS x
                          WHERE x.trip_id = pl.trip_id AND x.leg = pl.leg)
    )
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(i)), '[]'::jsonb),
           (SELECT COALESCE(pg_catalog.sum(pl.c), 0)::bigint FROM plat AS pl
             WHERE pg_catalog.date_trunc('month', pl.booked_at AT TIME ZONE v_tz)::date = p_month)
      INTO v_items, v_total
      FROM items AS i;
  END IF;

  -- une ligne du PSP appariée à deux jambes ne peut pas exister (clé trip, segment, jambe) ;
  -- un élément « en écart » sans écart chiffré est compté au minimum d'une unité (jamais absorbé)
  SELECT pg_catalog.count(*) FILTER (WHERE x.status = 'MATCHED') AS matched,
         pg_catalog.count(*) FILTER (WHERE x.status = 'MISSING_PSP') AS unmatched_platform,
         pg_catalog.count(*) FILTER (WHERE x.status = 'MISSING_PLATFORM') AS unmatched_psp,
         pg_catalog.count(*) FILTER (WHERE x.status = 'AMOUNT_MISMATCH') AS mismatches,
         COALESCE(pg_catalog.sum(CASE WHEN x.status <> 'MATCHED'
                                      THEN GREATEST(x.delta_minor, 1) ELSE 0 END), 0)::bigint
           AS delta
    INTO a
    FROM pg_catalog.jsonb_to_recordset(v_items)
           AS x(status text, delta_minor bigint);

  v_thr := core.finance_recon_threshold_bps(p_country);
  v_thr_src := CASE WHEN v_thr IS NULL THEN 'ABSENT_ZERO' ELSE 'PARAM' END;
  v_thr := COALESCE(v_thr, 0);
  v_bps := CASE WHEN v_total > 0
                THEN LEAST(pg_catalog.round(a.delta::numeric * 10000 / v_total), 2000000000)::integer
                WHEN a.delta > 0 THEN 10000 ELSE 0 END;
  -- comparaison exacte en entiers (aucun arrondi ne fait passer un écart sous le seuil)
  v_exceeds := CASE WHEN v_total > 0 THEN a.delta::numeric * 10000 > v_thr::numeric * v_total
                    ELSE a.delta > 0 END;
  IF v_exceeds THEN
    v_treat := COALESCE(core.payout_business_day(p_country, v_today, 5), v_today);
  END IF;

  v_run := platform.uuid_v7();
  INSERT INTO core.finance_reconciliation_run
         (id, country_code, currency, kind, period_month, psp_lines, matched, unmatched_platform,
          unmatched_psp, amount_mismatches, platform_total_minor, delta_minor, delta_pct_bps,
          threshold_bps, threshold_source, exceeds_threshold, treat_by, status, created_by,
          created_role, request_id)
  VALUES (v_run, p_country, v_currency, p_kind, p_month, pg_catalog.jsonb_array_length(p_lines),
          a.matched, a.unmatched_platform, a.unmatched_psp, a.mismatches, v_total, a.delta, v_bps,
          v_thr, v_thr_src, v_exceeds, v_treat,
          CASE WHEN a.unmatched_platform + a.unmatched_psp + a.mismatches = 0 THEN 'MATCHED'
               ELSE 'DISCREPANCIES' END,
          g.user_id, g.role, p_request_id);
  INSERT INTO core.finance_reconciliation_item
         (run_id, side, ref, leg, component, expected_minor, observed_minor, delta_minor, status,
          finding)
  SELECT v_run, x.side, x.ref, x.leg, x.component, x.expected_minor, x.observed_minor,
         CASE WHEN x.status <> 'MATCHED' THEN GREATEST(x.delta_minor, 1) ELSE 0 END, x.status,
         x.finding
    FROM pg_catalog.jsonb_to_recordset(v_items)
           AS x(side text, ref text, leg text, component text, expected_minor bigint,
                observed_minor bigint, delta_minor bigint, status text, finding text);
  -- audit EN DERNIER (montants agrégés, aucune donnée personnelle)
  PERFORM core.iam_staff_audit(g.user_id, g.role, 'RECONCILIATION_RUN_RECORDED', 'RECONCILIATION',
                               v_run, NULL,
                               pg_catalog.jsonb_build_object('country', p_country,
                                 'kind', p_kind, 'month', pg_catalog.to_char(p_month, 'YYYY-MM'),
                                 'matched', a.matched, 'unmatched_platform', a.unmatched_platform,
                                 'unmatched_psp', a.unmatched_psp, 'mismatches', a.mismatches,
                                 'delta_minor', a.delta::text, 'threshold_bps', v_thr,
                                 'threshold_source', v_thr_src, 'exceeds', v_exceeds),
                               v_reason, p_request_id);
  RETURN QUERY SELECT 'RECORDED'::text, v_run;
END
$fn$;
COMMENT ON FUNCTION core.finance_staff_record_reconciliation(bytea, uuid, text, date, text, jsonb, text) IS
  'Console : passage de rapprochement mensuel assisté (OPERATIONS ou LEGS) ; appariement à '
  'l''unité mineure, sans tolérance ; seuil J-ADM-031 (absent ⇒ 0) pour l''escalade sous 5 jours '
  'ouvrés ; idempotent par requête ; audit chaîné. EXECUTE app_api. US-311 (ADR-194).';

-- 7.4 Lecture d'un passage (résumé, éléments en écart d'abord) ; export journalisé (BULK_EXPORT).
-- Issues : OK, FORBIDDEN (passage inconnu ou d'un pays sans permission : même issue, journalisée),
-- AUTH_REQUIRED, MFA_REQUIRED.
CREATE FUNCTION core.finance_staff_reconciliation_run(p_token_hash bytea, p_request_id uuid,
                                                      p_run_id uuid, p_export boolean,
                                                      p_reason text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  r        record;
  g        record;
  v_items  jsonb;
  v_today  date;
  v_access uuid;
  v_reason text := pg_catalog.btrim(p_reason);
BEGIN
  IF p_request_id IS NULL OR p_run_id IS NULL OR p_export IS NULL
     OR (p_export AND (v_reason IS NULL OR pg_catalog.char_length(v_reason) NOT BETWEEN 10 AND 500))
  THEN
    RAISE EXCEPTION 'rapprochement : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.* INTO r FROM core.finance_reconciliation_run AS x WHERE x.id = p_run_id;
  IF r.id IS NULL THEN
    RETURN QUERY SELECT core.report_staff_not_found(p_token_hash, 'RECONCILIATION_READ', p_run_id,
                                                    p_request_id), NULL::jsonb;
    RETURN;
  END IF;
  SELECT * INTO g FROM core.report_staff_gate(p_token_hash, 'finance.reconciliation',
    r.country_code, CASE WHEN p_export THEN 'RECONCILIATION_EXPORT' ELSE 'RECONCILIATION_READ' END,
    p_request_id);
  IF g.outcome <> 'OK' THEN
    RETURN QUERY SELECT g.outcome, NULL::jsonb;
    RETURN;
  END IF;
  SELECT (platform.now() AT TIME ZONE c.time_zone)::date INTO v_today
    FROM core.config_country AS c WHERE c.code::text = r.country_code;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'itemId', i.id, 'side', i.side, 'ref', i.ref, 'leg', i.leg, 'component', i.component,
           'expectedMinor', i.expected_minor::text, 'observedMinor', i.observed_minor::text,
           'deltaMinor', i.delta_minor::text, 'status', i.status, 'finding', i.finding,
           'resolution', i.resolution, 'resolvedAt', i.resolved_at)
           ORDER BY (i.status = 'MATCHED'), i.side, i.ref, i.leg), '[]'::jsonb)
    INTO v_items
    FROM core.finance_reconciliation_item AS i WHERE i.run_id = r.id;
  IF p_export THEN
    v_access := pg_catalog.gen_random_uuid();
    INSERT INTO core.audit_data_access_log
           (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
            access_kind, case_ref, request_id)
    VALUES (v_access, g.user_id, g.role, 'RECONCILIATION', r.id,
            'reconciliation_run:' || r.id::text, v_reason, 'BULK_EXPORT', NULL, p_request_id);
    PERFORM core.iam_staff_audit(g.user_id, g.role, 'STAFF_DATA_ACCESS', 'RECONCILIATION', r.id,
                                 NULL,
                                 pg_catalog.jsonb_build_object('country', r.country_code,
                                   'access_kind', 'BULK_EXPORT',
                                   'attempted', 'RECONCILIATION_EXPORT',
                                   'rows', pg_catalog.jsonb_array_length(v_items),
                                   'data_access_id', v_access),
                                 v_reason, p_request_id);
  END IF;
  RETURN QUERY SELECT 'OK'::text, pg_catalog.jsonb_build_object(
    'runId', r.id, 'country', r.country_code, 'currency', r.currency, 'kind', r.kind,
    'month', pg_catalog.to_char(r.period_month, 'YYYY-MM'), 'status', r.status,
    'pspLines', r.psp_lines, 'matched', r.matched, 'unmatchedPlatform', r.unmatched_platform,
    'unmatchedPsp', r.unmatched_psp, 'amountMismatches', r.amount_mismatches,
    'platformTotalMinor', r.platform_total_minor::text, 'deltaMinor', r.delta_minor::text,
    'deltaPctBps', r.delta_pct_bps, 'thresholdBps', r.threshold_bps,
    'thresholdSource', r.threshold_source, 'exceedsThreshold', r.exceeds_threshold,
    'treatBy', r.treat_by,
    'treatOverdue', r.exceeds_threshold AND r.status <> 'CLOSED' AND r.treat_by < v_today
                    AND EXISTS (SELECT 1 FROM core.finance_reconciliation_item AS i
                                 WHERE i.run_id = r.id AND i.status <> 'MATCHED'
                                   AND i.resolution IS NULL),
    'createdAt', r.created_at, 'closedAt', r.closed_at, 'checklist', r.checklist,
    'unexplainedAtClose', r.unexplained_at_close, 'items', v_items);
END
$fn$;
COMMENT ON FUNCTION core.finance_staff_reconciliation_run(bytea, uuid, uuid, boolean, text) IS
  'Console : passage de rapprochement (résumé, éléments, échéance de traitement) pour '
  'finance.reconciliation dans son pays ; passage inconnu ou d''un autre pays : FORBIDDEN '
  'journalisé ; export journalisé (BULK_EXPORT). EXECUTE app_api. US-311 (ADR-194).';

-- 7.5 Passages d'un pays (24 derniers mois) et état des mois (clôture, inexpliqué, quotidien
-- préalable). Issues : OK, AUTH_REQUIRED, MFA_REQUIRED, FORBIDDEN.
CREATE FUNCTION core.finance_staff_reconciliation_runs(p_token_hash bytea, p_country text)
  RETURNS TABLE (outcome text, body jsonb)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  g      record;
  v_runs jsonb;
BEGIN
  IF p_country IS NULL OR p_country !~ '^[A-Z]{2}$' THEN
    RAISE EXCEPTION 'rapprochement : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT * INTO g FROM core.report_staff_gate(p_token_hash, 'finance.reconciliation', p_country,
                                              'RECONCILIATION_LIST', NULL);
  IF g.outcome <> 'OK' THEN
    RETURN QUERY SELECT g.outcome, NULL::jsonb;
    RETURN;
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'runId', r.id, 'kind', r.kind, 'month', pg_catalog.to_char(r.period_month, 'YYYY-MM'),
           'status', r.status, 'matched', r.matched, 'unmatchedPlatform', r.unmatched_platform,
           'unmatchedPsp', r.unmatched_psp, 'amountMismatches', r.amount_mismatches,
           'deltaMinor', r.delta_minor::text, 'exceedsThreshold', r.exceeds_threshold,
           'treatBy', r.treat_by, 'createdAt', r.created_at, 'closedAt', r.closed_at)
           ORDER BY r.period_month DESC, r.created_at DESC), '[]'::jsonb)
    INTO v_runs
    FROM (SELECT x.* FROM core.finance_reconciliation_run AS x
           WHERE x.country_code = p_country
           ORDER BY x.period_month DESC, x.created_at DESC LIMIT 200) AS r;
  RETURN QUERY SELECT 'OK'::text, pg_catalog.jsonb_build_object(
    'country', p_country, 'runs', v_runs) || core.finance_recon_month_state(p_country);
END
$fn$;
COMMENT ON FUNCTION core.finance_staff_reconciliation_runs(bytea, text) IS
  'Console : passages de rapprochement d''un pays et état des mois (clôture, écarts inexpliqués, '
  'rapprochement quotidien US-711 préalable après deux mois) ; finance.reconciliation. EXECUTE '
  'app_api. US-311 (ADR-194).';

-- 7.6 Résolution motivée d'un élément en écart (code fermé et note de 10 à 500 caractères ; aucun
-- nom ni contact). Issues : RESOLVED, ALREADY_RESOLVED, CLOSED (passage clôturé), MATCHED
-- (élément apparié : rien à résoudre), FORBIDDEN (élément inconnu ou d'un pays sans permission :
-- journalisé), AUTH_REQUIRED, MFA_REQUIRED.
CREATE FUNCTION core.finance_staff_resolve_reconciliation_item(p_token_hash bytea,
                                                               p_request_id uuid, p_item_id uuid,
                                                               p_resolution text, p_note text)
  RETURNS TABLE (outcome text)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  i      record;
  g      record;
  v_note text := pg_catalog.btrim(p_note);
BEGIN
  IF p_request_id IS NULL OR p_item_id IS NULL OR p_resolution IS NULL
     OR p_resolution NOT IN ('TIMING', 'PSP_FEE', 'PSP_ERROR', 'PLATFORM_ERROR', 'DUPLICATE', 'OTHER')
     OR v_note IS NULL OR pg_catalog.char_length(v_note) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'rapprochement : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.id, x.status, x.resolution, r.country_code, r.status AS run_status, r.id AS run_id
    INTO i
    FROM core.finance_reconciliation_item AS x
    JOIN core.finance_reconciliation_run AS r ON r.id = x.run_id
   WHERE x.id = p_item_id;
  IF i.id IS NULL THEN
    RETURN QUERY SELECT core.report_staff_not_found(p_token_hash, 'RECONCILIATION_RESOLVE',
                                                    p_item_id, p_request_id);
    RETURN;
  END IF;
  SELECT * INTO g FROM core.report_staff_gate(p_token_hash, 'finance.reconciliation',
    i.country_code, 'RECONCILIATION_RESOLVE', p_request_id);
  IF g.outcome IN ('AUTH_REQUIRED', 'MFA_REQUIRED') THEN
    RETURN QUERY SELECT g.outcome;
    RETURN;
  END IF;
  -- autre pays : refus journalisé par la porte, même issue qu'un élément inconnu
  IF g.outcome <> 'OK' THEN
    RETURN QUERY SELECT g.outcome;
    RETURN;
  END IF;
  IF i.status = 'MATCHED' THEN
    RETURN QUERY SELECT 'MATCHED'::text;
    RETURN;
  END IF;
  IF i.resolution IS NOT NULL THEN
    RETURN QUERY SELECT 'ALREADY_RESOLVED'::text;
    RETURN;
  END IF;
  IF i.run_status = 'CLOSED' THEN
    RETURN QUERY SELECT 'CLOSED'::text;
    RETURN;
  END IF;
  UPDATE core.finance_reconciliation_item AS x
     SET resolution = p_resolution, resolution_note = v_note, resolved_by = g.user_id,
         resolved_at = platform.now()
   WHERE x.id = p_item_id;
  PERFORM core.iam_staff_audit(g.user_id, g.role, 'RECONCILIATION_ITEM_RESOLVED', 'RECONCILIATION',
                               i.run_id, NULL,
                               pg_catalog.jsonb_build_object('country', i.country_code,
                                 'item_id', p_item_id, 'resolution', p_resolution),
                               v_note, p_request_id);
  RETURN QUERY SELECT 'RESOLVED'::text;
END
$fn$;
COMMENT ON FUNCTION core.finance_staff_resolve_reconciliation_item(bytea, uuid, uuid, text, text) IS
  'Console : résolution motivée, une fois, d''un élément en écart d''un passage non clôturé ; '
  'finance.reconciliation dans son pays ; audit chaîné. EXECUTE app_api. US-311 (ADR-194).';

-- 7.7 Clôture d'un passage : checklist mensuelle signée (fondateur ou comptable : FINANCE ou
-- ADMIN). Les cinq points doivent valoir true ; les éléments encore inexpliqués sont comptés
-- (`unexplained_at_close`), jamais effacés. Issues : CLOSED, ALREADY_CLOSED, CHECKLIST_INCOMPLETE,
-- FORBIDDEN (passage inconnu ou d'un pays sans permission : journalisé), AUTH_REQUIRED,
-- MFA_REQUIRED.
CREATE FUNCTION core.finance_staff_sign_reconciliation(p_token_hash bytea, p_request_id uuid,
                                                       p_run_id uuid, p_checklist jsonb)
  RETURNS TABLE (outcome text, unexplained integer)
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  r      record;
  g      record;
  v_open integer;
  v_keys text[] := ARRAY['PSP_STATEMENT_COMPLETE', 'OPERATIONS_RECONCILED', 'LEGS_RECONCILED',
                         'DISCREPANCIES_EXPLAINED_OR_ESCALATED', 'THRESHOLD_REVIEWED'];
BEGIN
  IF p_request_id IS NULL OR p_run_id IS NULL OR p_checklist IS NULL
     OR pg_catalog.jsonb_typeof(p_checklist) <> 'object'
     OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_checklist) AS k(key)
                 WHERE k.key <> ALL (v_keys)) THEN
    RAISE EXCEPTION 'rapprochement : entrée invalide' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT x.id, x.country_code, x.status INTO r
    FROM core.finance_reconciliation_run AS x WHERE x.id = p_run_id;
  IF r.id IS NULL THEN
    RETURN QUERY SELECT core.report_staff_not_found(p_token_hash, 'RECONCILIATION_SIGN', p_run_id,
                                                    p_request_id), NULL::integer;
    RETURN;
  END IF;
  SELECT * INTO g FROM core.report_staff_gate(p_token_hash, 'finance.reconciliation',
    r.country_code, 'RECONCILIATION_SIGN', p_request_id);
  IF g.outcome IN ('AUTH_REQUIRED', 'MFA_REQUIRED') THEN
    RETURN QUERY SELECT g.outcome, NULL::integer;
    RETURN;
  END IF;
  IF g.outcome <> 'OK' THEN
    RETURN QUERY SELECT g.outcome, NULL::integer;
    RETURN;
  END IF;
  IF r.status = 'CLOSED' THEN
    RETURN QUERY SELECT 'ALREADY_CLOSED'::text, NULL::integer;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.unnest(v_keys) AS k(key)
              WHERE (p_checklist -> k.key) IS DISTINCT FROM 'true'::jsonb) THEN
    RETURN QUERY SELECT 'CHECKLIST_INCOMPLETE'::text, NULL::integer;
    RETURN;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_open
    FROM core.finance_reconciliation_item AS i
   WHERE i.run_id = r.id AND i.status <> 'MATCHED' AND i.resolution IS NULL;
  UPDATE core.finance_reconciliation_run AS x
     SET status = 'CLOSED', closed_by = g.user_id, closed_role = g.role,
         closed_at = platform.now(), checklist = p_checklist, unexplained_at_close = v_open
   WHERE x.id = r.id;
  PERFORM core.iam_staff_audit(g.user_id, g.role, 'RECONCILIATION_RUN_SIGNED', 'RECONCILIATION',
                               r.id, NULL,
                               pg_catalog.jsonb_build_object('country', r.country_code,
                                 'unexplained_at_close', v_open),
                               NULL, p_request_id);
  RETURN QUERY SELECT 'CLOSED'::text, v_open;
END
$fn$;
COMMENT ON FUNCTION core.finance_staff_sign_reconciliation(bytea, uuid, uuid, jsonb) IS
  'Console : clôture d''un passage par la checklist mensuelle signée (cinq points à true) ; écarts '
  'encore inexpliqués comptés, jamais effacés ; finance.reconciliation ; audit chaîné. EXECUTE '
  'app_api. US-311 (ADR-194).';

REVOKE ALL ON FUNCTION core.report_staff_gate(bytea, text, text, text, uuid),
  core.report_staff_not_found(bytea, text, uuid, uuid),
  core.finance_recon_threshold_bps(text), core.finance_recon_month_state(text),
  core.report_staff_beta_view(bytea, uuid, text, text, boolean, text),
  core.finance_staff_reconciliation_export(bytea, uuid, text, date, text, text),
  core.finance_staff_record_reconciliation(bytea, uuid, text, date, text, jsonb, text),
  core.finance_staff_reconciliation_run(bytea, uuid, uuid, boolean, text),
  core.finance_staff_reconciliation_runs(bytea, text),
  core.finance_staff_resolve_reconciliation_item(bytea, uuid, uuid, text, text),
  core.finance_staff_sign_reconciliation(bytea, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.report_staff_beta_view(bytea, uuid, text, text, boolean, text),
  core.finance_staff_reconciliation_export(bytea, uuid, text, date, text, text),
  core.finance_staff_record_reconciliation(bytea, uuid, text, date, text, jsonb, text),
  core.finance_staff_reconciliation_run(bytea, uuid, uuid, boolean, text),
  core.finance_staff_reconciliation_runs(bytea, text),
  core.finance_staff_resolve_reconciliation_item(bytea, uuid, uuid, text, text),
  core.finance_staff_sign_reconciliation(bytea, uuid, uuid, jsonb) TO app_api;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM iam_staff_owner;
