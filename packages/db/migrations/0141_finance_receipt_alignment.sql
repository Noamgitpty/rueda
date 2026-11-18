-- 0141 — FIN : alignement des reçus et du relevé des gains sur les décisions écrites d'US-217
-- (partie 217b ; suites des revues de #231 : BOARD N-337, N-339, N-340 ; ADR-161 points 2 et 3,
-- ADR-167). Appliquée sous `migrator`, en une transaction.
--
-- Corps de deux fonctions de 0137 remplacés (CREATE OR REPLACE, signature, propriétaire
-- `cmd_money_owner`, SECURITY DEFINER et droits identiques ; montants toujours LUS dans l'état
-- stocké, jamais recalculés, jamais un prorata) :
--   1. `core.finance_trip_receipt_view(uuid, text)`, vue GUEST :
--      - N-337 : la taxe du trip fee n'est rendue que si rien du trip fee n'est remboursé. Après une
--        annulation qui rembourse une part du trip fee, `taxMinor` et `taxRateBps` valent `null`
--        (ADR-161 point 3, POUR_LE_FONDATEUR §4.7 bis, GL-38 : « taxe du trip fee conservé non
--        rendue ») : la taxe de LIGNE du devis figé porte sur le trip fee facturé en entier, et 08
--        (BR-CXL, « Taxes : méthode unique ») rembourse la taxe une fois par GROUPE fiscal, jamais
--        par ligne ; la taxe du trip fee conservé n'existe donc dans aucun état stocké et attend
--        OQ-BR-14 (aucun recalcul) ;
--      - N-340 : sans règlement ni solde capturé, aucun reçu (`NULL` ⇒ `NO_RECEIPT`, 409
--        `RECEIPT_NOT_READY`), comme la vue HOST du même trip ; le total payé n'est plus jamais lu
--        du devis (0137 rendait `q.total_minor`, un total deviné, avec la source `CAPTURE`) ;
--   2. `core.finance_host_statement(uuid, text)` (N-339) : deux sommes AJOUTÉES par devise,
--      `earnedMinor` (acquis : jambes HOST des versions en tête des règlements + ajustements du
--      host_ledger) et `pendingMinor` (à venir : jambes HOST capturées d'un trip sans règlement,
--      à venir, en cours ou en attente de son règlement). `hostLegMinor`, `adjustmentsMinor`,
--      `netMinor` (= `earnedMinor` + `pendingMinor`), `tripsCount` et les lignes sont inchangés.
--
-- Expand / contract : aucune table ni droit ; deux corps remplacés. Le relevé gagne deux clés :
-- l'API N (217a) contrôle les clés exactes et rendrait 503 `EARNINGS_UNAVAILABLE` (fail-closed)
-- entre cette migration et le déploiement de l'API N+1 (217b), qui les lit ; aucun écran ne lit
-- encore la route avant 217b.
--
-- Retour arrière : réappliquer les deux fonctions de 0137 (sous cmd_money_owner).

GRANT CREATE ON SCHEMA core TO cmd_money_owner;
SET LOCAL ROLE cmd_money_owner;

CREATE OR REPLACE FUNCTION core.finance_trip_receipt_view(p_trip_id uuid, p_viewer text)
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
  v_fee_back bigint;
BEGIN
  IF p_trip_id IS NULL OR p_viewer IS NULL OR p_viewer NOT IN ('GUEST', 'HOST') THEN
    RAISE EXCEPTION 'finance: receipt view input invalid' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT tr.id, tr.org_id INTO t FROM core.booking_trip AS tr WHERE tr.id = p_trip_id;
  IF t.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_viewer = 'HOST' THEN
    -- inchangé (0137)
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
  SELECT pg_catalog.sum(b.captured_minor)::bigint INTO v_captured
    FROM core.settlement_trip_leg_balance AS b
   WHERE b.trip_id = t.id AND b.segment_no = 1;
  -- N-340 : ni règlement ni solde capturé ⇒ aucun reçu (même issue que la vue HOST), jamais un
  -- total lu du devis
  IF h.id IS NULL AND v_captured IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT qt.id INTO q
    FROM core.pricing_trip_price_version AS v
    JOIN core.pricing_quote AS qt ON qt.id = v.quote_id
   WHERE v.trip_id = t.id
   ORDER BY v.version DESC
   LIMIT 1;
  SELECT ql.amount_minor, ql.tax_minor, ql.rate_bps INTO qf
    FROM core.pricing_quote_line AS ql
   WHERE ql.quote_id = q.id AND ql.line_type = 'TRIP_FEE';
  SELECT sl.amount_minor, sl.refund_minor, sl.retained_minor INTO sf
    FROM core.settlement_settlement_line AS sl
   WHERE sl.settlement_id = h.id AND sl.line_type = 'tripFee';
  v_fee_back := COALESCE(sf.refund_minor, 0);
  RETURN pg_catalog.jsonb_build_object(
    'source', CASE WHEN h.id IS NULL THEN 'CAPTURE' ELSE 'SETTLEMENT' END,
    'settlementVersion', h.version,
    'totalPaidMinor', COALESCE(h.total_paid_minor, v_captured)::text,
    -- dû au voyageur par la version en tête du règlement (pas un remboursement émis : SM-8)
    'refundMinor', COALESCE(h.guest_refund_minor, 0)::text,
    'tripFee', CASE WHEN COALESCE(qf.amount_minor, sf.amount_minor) IS NULL THEN NULL ELSE
      pg_catalog.jsonb_build_object(
        'chargedMinor', COALESCE(qf.amount_minor, sf.amount_minor)::text,
        -- taxe de LIGNE du devis figé (08 BR-PRICE-12, T43), rendue seulement si rien du trip fee
        -- n'est remboursé (N-337 : celle du trip fee conservé attend OQ-BR-14 ; jamais recalculée)
        'taxMinor', CASE WHEN v_fee_back > 0 THEN NULL ELSE qf.tax_minor::text END,
        'taxRateBps', CASE WHEN v_fee_back > 0 THEN NULL ELSE qf.rate_bps END,
        'refundedMinor', v_fee_back::text,
        'retainedMinor', COALESCE(sf.retained_minor, qf.amount_minor)::text) END,
    -- facture électronique (PAC / SIFEN) émise hors plateforme en bêta (16 FIN-002 MANUEL)
    'fiscalDocument', 'OFF_PLATFORM');
END
$fn$;
COMMENT ON FUNCTION core.finance_trip_receipt_view(uuid, text) IS
  'Reçu d''un trip pour une vue : HOST (gains : plan, part, base, frais retenus par Kmino, jambe '
  'HOST, ajustements, net) ou GUEST (total payé, remboursement dû au règlement, trip fee et sa taxe '
  'de ligne tant que rien du trip fee n''est remboursé ; facture hors plateforme) ; sans règlement '
  'ni capture : NULL ; montants lus (texte), jamais recalculés. EXECUTE cmd_hold_owner. US-217 '
  '(217a, ADR-161 ; 217b, ADR-167).';

CREATE OR REPLACE FUNCTION core.finance_host_statement(p_org uuid, p_month text)
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
                 -- N-339 : acquis (règlement en tête, host_ledger) et à venir (capture sans
                 -- règlement), deux sommes de lignes stockées
                 'earnedMinor', COALESCE(pg_catalog.sum(l.amount_minor)
                                         FILTER (WHERE l.source <> 'CAPTURE'), 0)::text,
                 'pendingMinor', COALESCE(pg_catalog.sum(l.amount_minor)
                                          FILTER (WHERE l.source = 'CAPTURE'), 0)::text,
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
  'ajustements du host_ledger, net, acquis (règlement, host_ledger) et à venir (capture sans '
  'règlement), lignes ; montants lus (texte). EXECUTE cmd_hold_owner. US-217 (217a, ADR-161 ; '
  '217b, ADR-167).';

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_money_owner;
