-- 0137 — FIN / AVL : reçu des gains de l'hôte, reçu du trip fee du voyageur, relevé mensuel des
-- gains et faits de l'invariant par jambe.
-- US-217 (partie 217a, serveur) ; 19 US-217 (critères 1 à 3) ; 16 FIN-018 / PYO-013, FIN-001,
-- FIN-002 (facture émise hors plateforme en bêta : MANUEL) ; 08 E7 (jambes HOST, INSURER,
-- TAX_THIRD_PARTY, PLATFORM ; règle 7 : la pénalité de l'hôte est un ajustement de versement, jamais
-- une jambe), BR-PAYOUT-05, BR-PRICE-06, BR-PRICE-12, BR-PROT-06 ; vecteurs TJ01, TJ02a, TJ08a ;
-- 17 v6 §3.2.13 (`host_earnings_statement`, `host_earnings_line`) ; 10b UX-45 (A08, Bêta L3) ;
-- ADR-161 (cette migration). Appliquée sous `migrator`, en une transaction.
--
-- Cette migration AJOUTE des fonctions de LECTURE (aucune table, aucune écriture de domaine). Tout
-- montant est LU dans l'état stocké — version en tête du règlement (`settlement_settlement`,
-- `settlement_settlement_leg`, `settlement_settlement_line`), état capturé (`trip_leg_balance`,
-- opérations portées), devis figé du trip (`pricing_quote`, `pricing_quote_line`) et host_ledger
-- (`settlement_host_ledger_entry`) — jamais recalculé, jamais un prorata :
--   1. `core.finance_earning_lines(uuid)` (cmd_money_owner, aucun EXECUTE : appelée par les
--      fonctions 2, 3 et 6 de son propriétaire) : lignes de
--      gains d'un compte d'hôte, une par trip (EARNING sans règlement, CXL_EARNING pour un règlement
--      d'annulation, EARNING sinon : jambe HOST de la version en tête, ou jambe HOST capturée tant
--      qu'aucun règlement n'existe), plus une ligne ADJUSTMENT par écriture du host_ledger (pénalité
--      de l'hôte, en ligne séparée, 19 US-217 critère 2). Mois du relevé (PROPOSÉ) : mois, dans le
--      fuseau du trip, de la version 1 du règlement si elle existe, sinon de la fin prévue du trip ;
--      écriture du host_ledger : mois de son horodatage. Base partageable (loyer, promo de l'hôte,
--      livraison, Extras : retenus du règlement en tête, ou lignes du devis figé), plan et part figés
--      du devis : les « frais retenus par Kmino » valent base − jambe HOST (soustraction de deux
--      montants stockés) ;
--   2. `core.finance_trip_receipt_view(uuid, text)` (cmd_money_owner, EXECUTE cmd_hold_owner) :
--      HOST : reçu des gains du trip (plan, part, base, frais retenus par Kmino, jambe HOST,
--      ajustements, net) ; GUEST : reçu du paiement et du trip fee (total payé, remboursé, trip fee
--      facturé, sa taxe de ligne du devis figé, part remboursée et retenue ; document fiscal émis
--      hors plateforme en bêta, FIN-002 MANUEL). Aucune donnée de l'autre partie ;
--   3. `core.finance_host_statement(uuid, text)` (cmd_money_owner, EXECUTE cmd_hold_owner) :
--      relevé d'un mois `YYYY-MM` par devise (Σ jambes HOST, Σ ajustements, net, lignes) ;
--   4. `core.booking_trip_receipt(bytea, uuid)` (cmd_hold_owner, EXECUTE app_api) : la partie de la
--      session (voyageur du trip ou TITULAIRE du compte d'hôte, comme 0130) lit sa vue ; toute autre
--      personne, un trip inconnu ou une session absente reçoivent NOT_FOUND (aucun oracle) ;
--   5. `core.booking_host_earnings(bytea, uuid, text)` (cmd_hold_owner, EXECUTE app_api) : relevé
--      du mois d'un compte d'hôte dont la session est TITULAIRE (`core.iam_host_accounts`) ; sinon
--      FORBIDDEN ; mois mal formé : REQUEST_INVALID ;
--   6. `core.finance_trip_leg_facts()` (cmd_money_owner, EXECUTE app_worker, travailleur
--      `reconciliation` seulement) : par trip tenu, les faits de l'invariant par jambe (Σ capturé
--      des soldes, Σ des opérations d'encaissement portées et de leurs jambes, total payé de la
--      version en tête, jambe HOST attendue lue d'une autre source que le relevé, jambe HOST du
--      relevé) ; les contrôles sont jugés par le rapprochement (FIN, US-047, ADR-087 / ADR-161).
--
-- Droit ajouté : SELECT (scheduled_end, timezone) de core.booking_trip à cmd_money_owner (mois du
-- relevé ; politiques money_read / cmd_money_sel existantes).
--
-- Expand / contract : fonctions et droit de colonne AJOUTÉS seulement.
--
-- Retour arrière :
--   DROP FUNCTION core.finance_trip_leg_facts(), core.booking_host_earnings(bytea, uuid, text),
--     core.booking_trip_receipt(bytea, uuid), core.finance_host_statement(uuid, text),
--     core.finance_trip_receipt_view(uuid, text), core.finance_earning_lines(uuid);
--   REVOKE SELECT (scheduled_end, timezone) ON core.booking_trip FROM cmd_money_owner;

-- 0. Droit de colonne (sous migrator, propriétaire de la table) -----------------------------------
GRANT SELECT (scheduled_end, timezone) ON core.booking_trip TO cmd_money_owner;

-- 1. Lectures de l'argent (famille cmd_money) -----------------------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

CREATE FUNCTION core.finance_earning_lines(p_org uuid)
  RETURNS TABLE (line_kind text, trip_id uuid, country_code text, currency text,
                 period_month text, event_at timestamptz, trip_status text, source text,
                 settlement_version integer, reason text, amount_minor bigint,
                 share_base_minor bigint, host_plan_code text, host_share_pct text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  WITH trips AS (
    SELECT t.id, t.country_code, t.currency, t.timezone, t.status, t.scheduled_end
      FROM core.booking_trip AS t
     WHERE t.org_id = p_org
  ),
  head AS (
    -- version en tête du règlement (bêta : un segment ; versions uniques par trip et segment)
    SELECT DISTINCT ON (s.trip_id) s.trip_id, s.id, s.version, s.kind
      FROM core.settlement_settlement AS s
     WHERE s.org_id = p_org AND s.segment_no = 1
     ORDER BY s.trip_id, s.version DESC
  ),
  v1s AS (
    SELECT s.trip_id, s.created_at
      FROM core.settlement_settlement AS s
     WHERE s.org_id = p_org AND s.segment_no = 1 AND s.version = 1
  ),
  cap AS (
    SELECT b.trip_id,
           pg_catalog.sum(b.captured_minor) FILTER (WHERE b.leg = 'HOST')::bigint AS host_captured
      FROM core.settlement_trip_leg_balance AS b
     WHERE b.org_id = p_org AND b.segment_no = 1
     GROUP BY b.trip_id
  ),
  qv AS (
    -- devis figé de la dernière version de prix du trip (17 §2.6)
    SELECT DISTINCT ON (v.trip_id) v.trip_id, q.id, q.host_plan_code, q.outputs
      FROM core.pricing_trip_price_version AS v
      JOIN core.pricing_quote AS q ON q.id = v.quote_id
     WHERE v.trip_id IN (SELECT x.id FROM trips AS x)
     ORDER BY v.trip_id, v.version DESC
  )
  SELECT CASE WHEN h.kind = 'CANCELLATION' THEN 'CXL_EARNING' ELSE 'EARNING' END,
         t.id, t.country_code, t.currency,
         pg_catalog.to_char(COALESCE(f.created_at, t.scheduled_end) AT TIME ZONE t.timezone,
                            'YYYY-MM'),
         COALESCE(f.created_at, t.scheduled_end),
         t.status,
         CASE WHEN h.id IS NULL THEN 'CAPTURE' ELSE 'SETTLEMENT' END,
         h.version,
         NULL::text,
         CASE WHEN h.id IS NULL THEN c.host_captured
              ELSE (SELECT l.kept_minor
                      FROM core.settlement_settlement_leg AS l
                     WHERE l.settlement_id = h.id AND l.leg = 'HOST') END,
         CASE WHEN h.id IS NOT NULL THEN
                COALESCE((SELECT pg_catalog.sum(sl.retained_minor)
                            FROM core.settlement_settlement_line AS sl
                           WHERE sl.settlement_id = h.id
                             AND sl.line_type IN ('tripPrice', 'promoHost', 'delivery', 'extras')),
                         0)::bigint
              WHEN qq.id IS NOT NULL THEN
                (SELECT pg_catalog.sum(ql.amount_minor)
                   FROM core.pricing_quote_line AS ql
                  WHERE ql.quote_id = qq.id
                    AND ql.line_type IN ('TRIP_PRICE', 'PROMO_HOST', 'DELIVERY_FEE', 'EXTRAS'))::bigint
         END,
         qq.host_plan_code,
         CASE WHEN qq.id IS NULL THEN NULL ELSE (qq.outputs::jsonb ->> 'hostSharePct') END
    FROM trips AS t
    LEFT JOIN head AS h ON h.trip_id = t.id
    LEFT JOIN v1s AS f ON f.trip_id = t.id
    LEFT JOIN cap AS c ON c.trip_id = t.id
    LEFT JOIN qv AS qq ON qq.trip_id = t.id
   WHERE h.id IS NOT NULL OR c.trip_id IS NOT NULL
  UNION ALL
  -- host_ledger : une ligne séparée par écriture (pénalité de l'hôte, 08 E7 règle 7)
  SELECT 'ADJUSTMENT', e.trip_id, e.country_code, e.currency,
         pg_catalog.to_char(e.created_at AT TIME ZONE t.timezone, 'YYYY-MM'),
         e.created_at, t.status, 'HOST_LEDGER', e.settlement_version, e.reason, e.amount_minor,
         NULL::bigint, NULL::text, NULL::text
    FROM core.settlement_host_ledger_entry AS e
    JOIN trips AS t ON t.id = e.trip_id
   WHERE e.org_id = p_org
$fn$;
COMMENT ON FUNCTION core.finance_earning_lines(uuid) IS
  'Lignes de gains d''un compte d''hôte (EARNING, CXL_EARNING : jambe HOST de la version en tête '
  'ou capturée ; ADJUSTMENT : écriture du host_ledger), mois du relevé, base partageable, plan et '
  'part figés ; montants lus, jamais recalculés. Aucun EXECUTE (propriétaire seul). US-217 (217a, '
  'ADR-161).';
REVOKE ALL ON FUNCTION core.finance_earning_lines(uuid) FROM PUBLIC;

CREATE FUNCTION core.finance_trip_receipt_view(p_trip_id uuid, p_viewer text)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  t          record;
  e          record;
  h          record;
  q          record;
  qf         record;
  sf         record;
  v_adj      jsonb;
  v_adj_sum  bigint;
  v_captured bigint;
BEGIN
  IF p_trip_id IS NULL OR p_viewer IS NULL OR p_viewer NOT IN ('GUEST', 'HOST') THEN
    RAISE EXCEPTION 'finance: receipt view input invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT tr.id, tr.org_id INTO t FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_viewer = 'HOST' THEN
    SELECT l.* INTO e
      FROM core.finance_earning_lines(t.org_id) AS l
     WHERE l.trip_id = t.id AND l.line_kind IN ('EARNING', 'CXL_EARNING');
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'reason', a.reason,
             'amountMinor', a.amount_minor::text,
             'periodMonth', a.period_month,
             'at', pg_catalog.to_char(a.event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
             ORDER BY a.event_at, a.reason), '[]'::jsonb),
           COALESCE(pg_catalog.sum(a.amount_minor), 0)::bigint
      INTO v_adj, v_adj_sum
      FROM core.finance_earning_lines(t.org_id) AS a
     WHERE a.trip_id = t.id AND a.line_kind = 'ADJUSTMENT';
    RETURN pg_catalog.jsonb_build_object(
      'kind', e.line_kind,
      'source', e.source,
      'settlementVersion', e.settlement_version,
      'periodMonth', e.period_month,
      'eventAt', pg_catalog.to_char(e.event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'hostPlanCode', e.host_plan_code,
      'hostSharePct', e.host_share_pct,
      'shareBaseMinor', e.share_base_minor::text,
      'kminoFeeMinor', CASE WHEN e.share_base_minor IS NULL OR e.amount_minor IS NULL THEN NULL
                            ELSE (e.share_base_minor - e.amount_minor)::text END,
      'hostLegMinor', e.amount_minor::text,
      'adjustments', v_adj,
      'adjustmentsMinor', v_adj_sum::text,
      'netMinor', (e.amount_minor + v_adj_sum)::text);
  END IF;

  -- GUEST : ce que le voyageur a payé à Kmino et le trip fee (16 FIN-018 ; FIN-002 hors plateforme)
  SELECT s.id, s.version, s.total_paid_minor, s.guest_refund_minor INTO h
    FROM core.settlement_settlement AS s
   WHERE s.trip_id = t.id AND s.segment_no = 1
   ORDER BY s.version DESC
   LIMIT 1;
  SELECT qt.id, qt.total_minor INTO q
    FROM core.pricing_trip_price_version AS v
    JOIN core.pricing_quote AS qt ON qt.id = v.quote_id
   WHERE v.trip_id = t.id
   ORDER BY v.version DESC
   LIMIT 1;
  SELECT pg_catalog.sum(b.captured_minor)::bigint INTO v_captured
    FROM core.settlement_trip_leg_balance AS b
   WHERE b.trip_id = t.id AND b.segment_no = 1;
  IF h.id IS NULL AND q.id IS NULL AND v_captured IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT ql.amount_minor, ql.tax_minor, ql.rate_bps INTO qf
    FROM core.pricing_quote_line AS ql
   WHERE ql.quote_id = q.id AND ql.line_type = 'TRIP_FEE';
  SELECT sl.amount_minor, sl.refund_minor, sl.retained_minor INTO sf
    FROM core.settlement_settlement_line AS sl
   WHERE sl.settlement_id = h.id AND sl.line_type = 'tripFee';
  RETURN pg_catalog.jsonb_build_object(
    'source', CASE WHEN h.id IS NULL THEN 'CAPTURE' ELSE 'SETTLEMENT' END,
    'settlementVersion', h.version,
    'totalPaidMinor', COALESCE(h.total_paid_minor, v_captured, q.total_minor)::text,
    'refundMinor', COALESCE(h.guest_refund_minor, 0)::text,
    'tripFee', CASE WHEN COALESCE(qf.amount_minor, sf.amount_minor) IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object(
        'chargedMinor', COALESCE(qf.amount_minor, sf.amount_minor)::text,
        -- taxe de LIGNE du devis figé (08 BR-PRICE-12, T43) ; jamais recalculée
        'taxMinor', qf.tax_minor::text,
        'taxRateBps', qf.rate_bps,
        'refundedMinor', COALESCE(sf.refund_minor, 0)::text,
        'retainedMinor', COALESCE(sf.retained_minor, qf.amount_minor)::text) END,
    -- facture électronique (PAC / SIFEN) émise hors plateforme en bêta (16 FIN-002 MANUEL)
    'fiscalDocument', 'OFF_PLATFORM');
END
$fn$;
COMMENT ON FUNCTION core.finance_trip_receipt_view(uuid, text) IS
  'Reçu d''un trip pour une vue : HOST (gains : plan, part, base, frais retenus par Kmino, jambe '
  'HOST, ajustements, net) ou GUEST (total payé, remboursé, trip fee et sa taxe de ligne ; facture '
  'hors plateforme) ; montants lus (texte), jamais recalculés. EXECUTE cmd_hold_owner. US-217 '
  '(217a, ADR-161).';
REVOKE ALL ON FUNCTION core.finance_trip_receipt_view(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.finance_trip_receipt_view(uuid, text) TO cmd_hold_owner;

CREATE FUNCTION core.finance_host_statement(p_org uuid, p_month text)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_org IS NULL OR p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'finance: statement input invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN COALESCE((
    SELECT pg_catalog.jsonb_agg(x.statement ORDER BY x.currency)
      FROM (
        SELECT l.currency,
               pg_catalog.jsonb_build_object(
                 'currency', l.currency,
                 'tripsCount', pg_catalog.count(DISTINCT l.trip_id)
                               FILTER (WHERE l.line_kind <> 'ADJUSTMENT'),
                 'hostLegMinor', COALESCE(pg_catalog.sum(l.amount_minor)
                                          FILTER (WHERE l.line_kind <> 'ADJUSTMENT'), 0)::text,
                 'adjustmentsMinor', COALESCE(pg_catalog.sum(l.amount_minor)
                                              FILTER (WHERE l.line_kind = 'ADJUSTMENT'), 0)::text,
                 'netMinor', COALESCE(pg_catalog.sum(l.amount_minor), 0)::text,
                 'lines', pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                   'kind', l.line_kind,
                   'tripId', l.trip_id,
                   'tripStatus', l.trip_status,
                   'source', l.source,
                   'settlementVersion', l.settlement_version,
                   'reason', l.reason,
                   'eventAt', pg_catalog.to_char(l.event_at AT TIME ZONE 'UTC',
                                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                   'amountMinor', l.amount_minor::text,
                   'shareBaseMinor', l.share_base_minor::text,
                   'kminoFeeMinor', CASE WHEN l.share_base_minor IS NULL OR l.amount_minor IS NULL
                                         THEN NULL
                                         ELSE (l.share_base_minor - l.amount_minor)::text END,
                   'hostPlanCode', l.host_plan_code,
                   'hostSharePct', l.host_share_pct)
                   ORDER BY l.event_at, l.trip_id, l.line_kind)) AS statement
          FROM core.finance_earning_lines(p_org) AS l
         WHERE l.period_month = p_month
         GROUP BY l.currency
      ) AS x), '[]'::jsonb);
END
$fn$;
COMMENT ON FUNCTION core.finance_host_statement(uuid, text) IS
  'Relevé des gains d''un compte d''hôte pour un mois YYYY-MM, par devise : Σ jambes HOST, Σ '
  'ajustements du host_ledger, net, lignes ; montants lus (texte). EXECUTE cmd_hold_owner. US-217 '
  '(217a, ADR-161).';
REVOKE ALL ON FUNCTION core.finance_host_statement(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.finance_host_statement(uuid, text) TO cmd_hold_owner;

-- Faits de l'invariant par jambe (19 US-217 critère 3) : lus par le travailleur reconciliation ;
-- identifiants techniques seulement (aucune donnée personnelle) ; le rapport n'en garde que des
-- comptes par pays (FIN, money-reconciliation.ts).
CREATE FUNCTION core.finance_trip_leg_facts()
  RETURNS TABLE (trip_id uuid, country_code text, currency text, captured_minor bigint,
                 collected_minor bigint, collected_legs_minor bigint,
                 head_total_paid_minor bigint, expected_host_minor bigint,
                 statement_host_minor bigint)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'reconciliation' THEN
    RAISE EXCEPTION 'finance: leg facts are read by the reconciliation worker only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
  WITH held AS (
    SELECT b.trip_id AS id FROM core.settlement_trip_leg_balance AS b WHERE b.segment_no = 1
    UNION
    SELECT s.trip_id FROM core.settlement_settlement AS s WHERE s.segment_no = 1
  ),
  tr AS (
    SELECT t.id, t.org_id, t.country_code, t.currency
      FROM core.booking_trip AS t
      JOIN held AS x ON x.id = t.id
  ),
  orgs AS (SELECT DISTINCT y.org_id FROM tr AS y),
  lines AS (
    SELECT l.trip_id, l.amount_minor
      FROM orgs AS o
      CROSS JOIN LATERAL core.finance_earning_lines(o.org_id) AS l
     WHERE l.line_kind IN ('EARNING', 'CXL_EARNING')
  ),
  cap AS (
    SELECT b.trip_id,
           pg_catalog.sum(b.captured_minor)::bigint AS captured,
           pg_catalog.sum(b.captured_minor) FILTER (WHERE b.leg = 'HOST')::bigint AS host
      FROM core.settlement_trip_leg_balance AS b
     WHERE b.segment_no = 1
     GROUP BY b.trip_id
  ),
  ops AS (
    -- opérations d'encaissement portées sur les soldes (mêmes natures que captured_minor)
    SELECT m.trip_id,
           pg_catalog.sum(o.amount_minor)::bigint AS amount,
           pg_catalog.sum((SELECT pg_catalog.sum(g.amount_minor)
                             FROM core.payment_payment_operation_leg AS g
                            WHERE g.operation_id = o.id))::bigint AS legs,
           pg_catalog.sum((SELECT g.amount_minor
                             FROM core.payment_payment_operation_leg AS g
                            WHERE g.operation_id = o.id AND g.leg = 'HOST'))::bigint AS host
      FROM core.settlement_leg_movement AS m
      JOIN core.payment_payment_operation AS o ON o.id = m.operation_id
     WHERE m.segment_no = 1 AND m.kind IN ('CAPTURE', 'MIT_CHARGE', 'DEBT_COLLECTION')
     GROUP BY m.trip_id
  ),
  head AS (
    SELECT DISTINCT ON (s.trip_id) s.trip_id, s.total_paid_minor, s.host_from_guest_minor
      FROM core.settlement_settlement AS s
     WHERE s.segment_no = 1
     ORDER BY s.trip_id, s.version DESC
  )
  SELECT tr.id, tr.country_code, tr.currency,
         COALESCE(c.captured, 0)::bigint,
         op.amount, op.legs,
         h.total_paid_minor,
         -- jambe HOST attendue, lue d'une AUTRE source que le relevé : en-tête du règlement
         -- (hostFromGuest), sinon jambes HOST des opérations portées, sinon solde capturé
         CASE WHEN h.trip_id IS NOT NULL THEN h.host_from_guest_minor
              WHEN op.trip_id IS NOT NULL THEN op.host
              ELSE c.host END,
         ln.amount_minor
    FROM tr
    LEFT JOIN cap AS c ON c.trip_id = tr.id
    LEFT JOIN ops AS op ON op.trip_id = tr.id
    LEFT JOIN head AS h ON h.trip_id = tr.id
    LEFT JOIN lines AS ln ON ln.trip_id = tr.id;
END
$fn$;
COMMENT ON FUNCTION core.finance_trip_leg_facts() IS
  'Faits de l''invariant par jambe, par trip tenu : Σ capturé, Σ des encaissements portés et de '
  'leurs jambes, total payé de la version en tête, jambe HOST attendue et jambe HOST du relevé. '
  'Travailleur reconciliation seulement (EXECUTE app_worker). US-217 (217a, ADR-161).';
REVOKE ALL ON FUNCTION core.finance_trip_leg_facts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.finance_trip_leg_facts() TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;

-- 2. Lectures par la partie (famille cmd_hold, EXECUTE app_api) ------------------------------------
GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

CREATE FUNCTION core.booking_trip_receipt(p_token_hash bytea, p_trip_id uuid)
  RETURNS TABLE (outcome text, viewer_role text, trip_status text, currency text, timezone text,
                 receipt jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_user    uuid;
  t         record;
  v_role    text;
  v_receipt jsonb;
BEGIN
  SELECT s.user_id INTO v_user FROM core.iam_session_resolve(p_token_hash) AS s;
  SELECT tr.id, tr.status, tr.currency, tr.timezone, tr.guest_user_id, o.holder_user_id INTO t
    FROM core.booking_trip AS tr
    JOIN core.iam_organization AS o ON o.id = tr.org_id
   WHERE tr.id = p_trip_id;
  v_role := CASE WHEN v_user IS NULL OR t.id IS NULL THEN NULL
                 WHEN v_user = t.guest_user_id THEN 'GUEST'
                 WHEN v_user = t.holder_user_id THEN 'HOST' END;
  IF v_role IS NULL THEN
    -- autre personne, trip inconnu, session absente : même réponse (aucun oracle d'existence)
    RETURN QUERY SELECT 'NOT_FOUND'::text, NULL::text, NULL::text, NULL::text, NULL::text,
                        NULL::jsonb;
    RETURN;
  END IF;
  v_receipt := core.finance_trip_receipt_view(t.id, v_role);
  IF v_receipt IS NULL THEN
    -- trip sans capture ni règlement : aucun montant à montrer (jamais un reçu deviné)
    RETURN QUERY SELECT 'NO_RECEIPT'::text, v_role, t.status, t.currency, t.timezone, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, v_role, t.status, t.currency, t.timezone, v_receipt;
END
$fn$;
COMMENT ON FUNCTION core.booking_trip_receipt(bytea, uuid) IS
  'Reçu d''un trip pour sa partie de la session (voyageur : paiement et trip fee ; titulaire du '
  'compte d''hôte : gains du trip) ; NOT_FOUND sinon, NO_RECEIPT sans capture ni règlement. '
  'SECURITY DEFINER, EXECUTE app_api. US-217 (217a, ADR-161).';
REVOKE ALL ON FUNCTION core.booking_trip_receipt(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_trip_receipt(bytea, uuid) TO app_api;

CREATE FUNCTION core.booking_host_earnings(p_token_hash bytea, p_org uuid, p_month text)
  RETURNS TABLE (outcome text, country_code text, statements jsonb)
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_country text;
BEGIN
  IF p_month IS NULL OR p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RETURN QUERY SELECT 'REQUEST_INVALID'::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;
  SELECT a.country_code INTO v_country
    FROM core.iam_host_accounts(p_token_hash) AS a
   WHERE a.org_id = p_org;
  IF v_country IS NULL THEN
    -- compte d'un autre, co-hôte, inconnu ou session absente : même réponse
    RETURN QUERY SELECT 'FORBIDDEN'::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'OK'::text, v_country, core.finance_host_statement(p_org, p_month);
END
$fn$;
COMMENT ON FUNCTION core.booking_host_earnings(bytea, uuid, text) IS
  'Relevé des gains du mois YYYY-MM d''un compte d''hôte dont la session est titulaire ; '
  'FORBIDDEN sinon, REQUEST_INVALID si le mois est mal formé. SECURITY DEFINER, EXECUTE app_api. '
  'US-217 (217a, ADR-161).';
REVOKE ALL ON FUNCTION core.booking_host_earnings(bytea, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_host_earnings(bytea, uuid, text) TO app_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
