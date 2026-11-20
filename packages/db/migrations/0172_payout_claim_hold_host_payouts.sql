-- 0172 — PYO : réclamation ouverte ⇒ versement retenu (`CLAIM`) ; lecture des versements par
-- l'hôte titulaire (écran A08).
-- US-314 ; ADR-192 ; 19 US-314 (critères 3 et 5) ; 16 PYO-003 ; 08 BR-PAYOUT-02 (« versement
-- bloqué si une réclamation est ouverte »), BR-PAYOUT-04, SM-6 ; 17 v6 §0.1, §2.3 (RLS-26,
-- RLS-28), §3.2.9 (`payout_batch`, `payout_item`), §7.2 (`payout_business_day_offset`,
-- `first_payout_business_day`, `payout_batch_local_time`) ; 10b A08 ; pré-mortem du lot 3 :
-- L3-PM-34, L3-PM-43 ; red team RT-L3-V04, RT-L3-V10 ; BOARD N-384. Appliquée sous `migrator`,
-- en une transaction.
--
-- Principes (ADR-192, PROPOSÉS, fail-closed ; « comme Turo » : un versement est retenu tant
-- qu'une réclamation contre l'hôte est ouverte, et l'hôte voit ses versements, leur date et la
-- raison d'une retenue) :
--   1. RÉCLAMATION OUVERTE : un dossier de support `core.support_support_case` de catégorie
--      `CLAIM`, rattaché à un trip du lot, à l'état OPEN ou PENDING, ajoute le motif `CLAIM` aux
--      motifs de retenue du lot (`core.payout_batch_hold_reasons`, corps de 0167 recopié, un bloc
--      marqué US-314). Les motifs sont relus à la préparation, à la compensation, avant chaque
--      `releaseLeg` et avant `payout` (0165, 0167) : une réclamation ouverte APRÈS la préparation
--      retient le lot avant l'envoi. Le motif disparaît seulement quand le dossier passe RESOLVED
--      ou CLOSED, c'est-à-dire par la DÉCISION du support (`support_staff_set_case_status`, garde
--      de séparation des tâches d'ADR-122) ; aucune autre voie. Aucune écriture de
--      `trip_leg_balance.frozen` : la retenue du lot suffit à ne pas libérer la jambe HOST, et le
--      dégel d'une jambe reste réservé à la décision FIN du chargeback (0155, 0167). Sources de
--      litige couvertes après cette migration : chargeback ouvert (0155, 0167), trip en litige
--      SM-7 (`IN_DISPUTE` ⇒ `DISPUTE`, 0165), trip sorti de COMPLETED (`TRIP_NOT_COMPLETED`, dont
--      la non-restitution et le vol présumé : un trip `OVERDUE`, `UNRETURNED` ou `VEHICLE_LOST`
--      n'entre jamais dans un lot), réclamation ouverte (`CLAIM`, ici). Frais annexe contesté
--      (US-706) et dossier de dommages de l'assureur (US-309) : leurs stories ajoutent leur source
--      ici (aucune table n'existe encore) ;
--   2. LECTURE DE L'HÔTE (A08) : `core.payout_host_payouts(bytea, uuid)` (SECURITY DEFINER,
--      cmd_money_owner, EXECUTE app_api) rend, pour un compte d'hôte dont la personne de la
--      SESSION est TITULAIRE (`core.iam_host_accounts` : rôle P2P_HOST ACTIF ; un co-hôte n'est
--      jamais titulaire, même doté par erreur de `finance.read_org_statements`, RLS-28) et tant
--      que la matrice accorde `finance.read_org_statements` au rôle P2P_HOST : le pays, la devise,
--      le calendrier du pays (jours ouvrés du versement, du premier versement, heure locale du lot
--      et fuseau : paramètres de 17 §7.2, illisibles ⇒ NULL ; `payoutsOpen` : interrupteur
--      `payouts_enabled` du pays LU, absent ⇒ false, pour annoncer le calendrier au conditionnel) et ses 24 derniers lots (type, état,
--      date prévue, premier versement, brut, compensation, net, motifs de retenue STOCKÉS, dates
--      d'émission et de paiement, trips et montants des items). Jamais un identifiant du personnel
--      (RLS-26), ni un compte PSP, ni le compte de versement, ni une clé d'idempotence, ni une
--      référence du PSP. Montants en TEXTE (bigint exact), lus et jamais recalculés. Session
--      absente ⇒ AUTH_REQUIRED ; compte d'un autre hôte, co-hôte, compte inconnu ⇒ FORBIDDEN (même
--      réponse) ; permission retirée de la matrice ⇒ PERMISSION_DENIED.
--   3. GARDES DE LIBÉRATION (revue de #284) : `core.settlement_release_blocker` (0054, corps recopié,
--      un bloc marqué) relit en dernier les motifs de retenue du lot du trip
--      (`core.payout_release_hold_reasons`, SECURITY DEFINER, cmd_money_owner) pour un ordre qui
--      verse la jambe HOST : un motif ⇒ `leg_release_payout_held`. La garde s'applique à
--      l'enregistrement de l'ordre (déclencheur de 0054 : l'ordre n'est jamais créé, donc jamais
--      transmis) ET au report sur les soldes : une réclamation ouverte entre la relecture du lot
--      (`payout_cmd_recheck_batch`) et l'ordre `LEG_RELEASE` ne laisse plus partir la jambe HOST.
--      Les autres gardes de 0054 gardent leur ordre (interrupteur fermé ⇒ toujours
--      `leg_release_payouts_disabled`). Un `LEG_RELEASE` HOST hors lot reste refusé par
--      `leg_release_not_due` : `release_at` n'a qu'un écrivain, la préparation, qui met le trip en
--      lot dans la même transaction (S-06, 0165) ; seules les fixtures de test (migrator) posent un
--      `release_at` sans lot.
--   Aucun interrupteur écrit (la lecture lit seulement `payouts_enabled`) ; aucune constante de pays ; heure de la base
--   (`platform.now()`).
--
-- Codes : `leg_release_payout_held` (55000) → FORBIDDEN (packages/db/src/errors.ts) ; issues de la
-- lecture rendues en colonne, comme 0159.
--
-- Expand / contract : un corps remplacé à signature, propriétaire et droits identiques ; une
-- fonction, un droit de colonnes et une politique de lecture AJOUTÉS. L'API N n'appelle pas la
-- nouvelle fonction ; la version N + 1 l'appelle.
--
-- Retour arrière (jamais en production : nouvelle migration à la place) :
--   réappliquer core.payout_batch_hold_reasons de 0167 (sous cmd_money_owner) ;
--   réappliquer core.settlement_release_blocker de 0054 (sous migrator) ;
--   DROP FUNCTION core.payout_release_hold_reasons(uuid) ;
--   DROP FUNCTION core.payout_host_payouts(bytea, uuid) ;
--   DROP POLICY cmd_money_claim_sel ON core.support_support_case ;
--   REVOKE SELECT (trip_id, category, status) ON core.support_support_case FROM cmd_money_owner.

-- 1. Lecture des réclamations par le propriétaire des commandes d'argent (sous migrator) ---------
-- colonnes non personnelles seulement (trip, catégorie, état) ; dossiers de réclamation seulement
GRANT SELECT (trip_id, category, status) ON core.support_support_case TO cmd_money_owner;
CREATE POLICY cmd_money_claim_sel ON core.support_support_case FOR SELECT TO cmd_money_owner
  USING (category = 'CLAIM');

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

-- 2. Motifs de retenue d'un lot (0167, même signature) : + réclamation ouverte ------------------
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
    -- US-314 (ADR-192) : réclamation ouverte sur un trip du lot (08 BR-PAYOUT-02) ; levée par la
    -- seule décision du support (RESOLVED, CLOSED)
    UNION ALL
    SELECT 'CLAIM'
      FROM core.payout_payout_item AS i
     WHERE i.batch_id = p_batch_id
       AND EXISTS (SELECT 1 FROM core.support_support_case AS k
                    WHERE k.trip_id = i.trip_id AND k.category = 'CLAIM'
                      AND k.status IN ('OPEN', 'PENDING'))
  )
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT reasons.r ORDER BY reasons.r), ARRAY[]::text[])
    FROM reasons WHERE reasons.r IS NOT NULL
$fn$;

-- 3. Versements de l'hôte titulaire (A08) ---------------------------------------------------------
CREATE FUNCTION core.payout_host_payouts(p_token_hash bytea, p_org uuid)
  RETURNS TABLE (outcome text, country_code text, currency text, schedule jsonb, batches jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user     uuid;
  v_country  text;
  v_currency text;
  v_tz       text;
  v_offset   jsonb;
  v_first    jsonb;
  v_minutes  jsonb;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'AUTH_REQUIRED'::text, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  -- titulaire seulement (co-hôte, autre hôte, compte inconnu : même réponse ; RLS-28)
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  -- 17 §2.3 : `finance.read_org_statements` du rôle P2P_HOST, en vigueur
  IF NOT EXISTS (SELECT 1 FROM core.iam_role_permission AS p
                  WHERE p.role = 'P2P_HOST' AND p.permission_code = 'finance.read_org_statements'
                    AND p.valid_from <= platform.now()
                    AND (p.valid_to IS NULL OR p.valid_to > platform.now())) THEN
    RETURN QUERY SELECT 'PERMISSION_DENIED'::text, NULL::text, NULL::text, NULL::jsonb, NULL::jsonb;
    RETURN;
  END IF;
  SELECT k.currency::text, k.time_zone::text INTO v_currency, v_tz
    FROM core.config_country AS k WHERE k.code::text = v_country;
  -- calendrier du pays (mêmes formes admises que core.payout_schedule ; illisible ⇒ NULL)
  v_offset := core.payout_param('payout_business_day_offset', v_country);
  v_first := core.payout_param('first_payout_business_day', v_country);
  v_minutes := core.payout_param('payout_batch_local_time', v_country);
  RETURN QUERY
  SELECT 'OK'::text, v_country, v_currency,
         pg_catalog.jsonb_build_object(
           'businessDayOffset',
             CASE WHEN pg_catalog.jsonb_typeof(v_offset) = 'number'
                       AND (v_offset #>> '{}') ~ '^[1-9][0-9]?$'
                  THEN (v_offset #>> '{}')::integer END,
           'firstPayoutBusinessDay',
             CASE WHEN pg_catalog.jsonb_typeof(v_first) = 'number'
                       AND (v_first #>> '{}') ~ '^[1-9][0-9]?$'
                  THEN (v_first #>> '{}')::integer END,
           'localTimeMinutes',
             CASE WHEN pg_catalog.jsonb_typeof(v_minutes) = 'number'
                       AND (v_minutes #>> '{}') ~ '^(0|[1-9][0-9]{0,3})$'
                       AND (v_minutes #>> '{}')::integer <= 1439
                  THEN (v_minutes #>> '{}')::integer END,
           'timeZone', v_tz,
           -- interrupteur du pays (17 §0.1, absent ⇒ false), lu pour l'annonce seulement
           'payoutsOpen', core.config_go_live('payouts_enabled', v_country)),
         COALESCE((
           SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                    'batchId', x.id,
                    'kind', x.kind,
                    'status', x.status,
                    'currency', x.currency,
                    'scheduledFor', pg_catalog.to_char(x.scheduled_for AT TIME ZONE 'UTC',
                                                       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'firstPayout', x.first_payout,
                    'grossMinor', x.gross_minor::text,
                    'nettedMinor', x.netted_minor::text,
                    'netMinor', x.net_minor::text,
                    'holdReasons', pg_catalog.to_jsonb(x.hold_reasons),
                    'initiatedAt', pg_catalog.to_char(x.initiated_at AT TIME ZONE 'UTC',
                                                      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'paidAt', pg_catalog.to_char(x.paid_at AT TIME ZONE 'UTC',
                                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                    'items', COALESCE((
                      SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                               'tripId', i.trip_id,
                               'amountMinor', i.amount_minor::text)
                             ORDER BY i.trip_id)
                        FROM core.payout_payout_item AS i WHERE i.batch_id = x.id),
                      '[]'::jsonb))
                  ORDER BY x.scheduled_for DESC, x.id DESC)
             FROM (SELECT y.* FROM core.payout_payout_batch AS y
                    WHERE y.org_id = p_org
                    ORDER BY y.scheduled_for DESC, y.id DESC
                    LIMIT 24) AS x),
           '[]'::jsonb);
END
$fn$;

COMMENT ON FUNCTION core.payout_batch_hold_reasons(uuid) IS
  'Motifs de retenue d''un lot de versement (interrupteurs, variante B, capacités, sous-marchand, '
  'compte, gels, chargeback ouvert, litige, réclamation ouverte). US-708, US-709, US-314 (ADR-192).';
COMMENT ON FUNCTION core.payout_host_payouts(bytea, uuid) IS
  'Versements d''un compte d''hôte dont la session est TITULAIRE (A08) : calendrier du pays et 24 '
  'derniers lots, sans identifiant du personnel ; FORBIDDEN sinon. SECURITY DEFINER, EXECUTE '
  'app_api. US-314 (ADR-192).';
REVOKE ALL ON FUNCTION core.payout_host_payouts(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.payout_host_payouts(bytea, uuid) TO app_api;

-- 4. Motifs de retenue du lot d'un trip, pour les gardes de libération (NULL : trip hors lot)
CREATE FUNCTION core.payout_release_hold_reasons(p_trip_id uuid)
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT core.payout_batch_hold_reasons(i.batch_id)
    FROM core.payout_payout_item AS i
   WHERE i.trip_id = p_trip_id AND i.segment_no = 1 AND i.leg = 'HOST'
$fn$;
COMMENT ON FUNCTION core.payout_release_hold_reasons(uuid) IS
  'Motifs de retenue du lot du trip (NULL hors lot), relus par la garde de libération '
  'settlement_release_blocker à l''ordre et au report. SECURITY DEFINER. US-314 (ADR-192).';
REVOKE ALL ON FUNCTION core.payout_release_hold_reasons(uuid) FROM PUBLIC;
-- la garde (SECURITY INVOKER) s'exécute sous l'écrivain de l'ordre : cmd_money_owner (commandes)
-- ou migrator (fixtures de test) ; aucun rôle applicatif
GRANT EXECUTE ON FUNCTION core.payout_release_hold_reasons(uuid) TO migrator;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 5. Garde du versement d'une jambe (0054, même signature, propriétaire migrator) : + lot retenu --
CREATE OR REPLACE FUNCTION core.settlement_release_blocker(p_operation_id uuid)
  RETURNS text
  LANGUAGE plpgsql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_trip    uuid;
  v_country text;
  v_account uuid;
  v_kind    text;
  v_status  text;
  v_org     uuid;
  v_now     timestamptz := platform.now();
  v_reasons text[];
BEGIN
  SELECT o.trip_id, o.country_code, o.psp_account_id, o.kind
    INTO v_trip, v_country, v_account, v_kind
    FROM core.payment_payment_operation AS o WHERE o.id = p_operation_id;
  IF NOT FOUND OR v_kind IS DISTINCT FROM 'LEG_RELEASE' OR v_trip IS NULL THEN
    RETURN 'leg_release_trip_not_completed';
  END IF;
  SELECT t.status, t.org_id INTO v_status, v_org FROM core.booking_trip AS t WHERE t.id = v_trip;
  -- 08 BR-PAYOUT : la jambe HOST reste chez le PSP jusqu'à la fin du trajet
  IF v_status IS DISTINCT FROM 'COMPLETED' THEN
    RETURN 'leg_release_trip_not_completed';
  END IF;
  -- 08 E7 règle 6 : versement différé jusqu'à release_at (payout_at), posé et atteint
  IF EXISTS (SELECT 1
               FROM core.payment_payment_operation_leg AS l
               LEFT JOIN core.settlement_trip_leg_balance AS b
                 ON b.trip_id = v_trip AND b.segment_no = 1 AND b.leg = l.leg
              WHERE l.operation_id = p_operation_id AND l.amount_minor > 0
                AND (b.release_at IS NULL OR b.release_at > v_now)) THEN
    RETURN 'leg_release_not_due';
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
              WHERE l.operation_id = p_operation_id AND l.leg = 'HOST' AND l.amount_minor > 0)
     AND NOT EXISTS (SELECT 1 FROM core.payment_psp_submerchant AS s
                      WHERE s.psp_account_id = v_account AND s.org_id = v_org
                        AND s.kyc_status = 'ACTIVE') THEN
    RETURN 'leg_release_submerchant_inactive';
  END IF;
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
              WHERE l.operation_id = p_operation_id AND l.leg = 'INSURER' AND l.amount_minor > 0)
     AND NOT core.config_go_live('insurer_contract_active', v_country) THEN
    RETURN 'leg_release_insurer_inactive';
  END IF;
  -- 17 §0.1 : interrupteur du pays, false en production, lu fail-closed
  IF NOT core.config_go_live('payouts_enabled', v_country) THEN
    RETURN 'leg_release_payouts_disabled';
  END IF;
  -- US-314 (ADR-192) : motifs de retenue du lot du trip (réclamation, litige, gel, compte…) relus
  -- à l'ordre et au report de la jambe HOST
  IF EXISTS (SELECT 1 FROM core.payment_payment_operation_leg AS l
              WHERE l.operation_id = p_operation_id AND l.leg = 'HOST' AND l.amount_minor > 0) THEN
    v_reasons := core.payout_release_hold_reasons(v_trip);
    IF pg_catalog.cardinality(v_reasons) > 0 THEN
      RETURN 'leg_release_payout_held';
    END IF;
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.settlement_release_blocker(uuid) IS
  'Garde du versement d''une jambe (LEG_RELEASE) : trip COMPLETED, release_at atteint, sous-marchand '
  'ACTIVE, interrupteurs du pays, puis motifs de retenue du lot du trip (US-314). Rend la première '
  'contrainte violée ou NULL. US-049 (ADR-088), US-314 (ADR-192).';
