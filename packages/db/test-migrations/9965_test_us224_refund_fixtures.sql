-- 9965 — Fixtures de TEST d'US-224 (224a, ADR-145) : ordre de règlement RÉUSSI et PROUVÉ écrit
-- sans passer par `core.payment_cmd_record_operation` (donc sans la garde d'enregistrement), pour
-- éprouver la défense en profondeur du REPORT sur les soldes (`settlement_cmd_apply_leg_movement`) :
-- course de deux reports sur deux connexions, remboursement sans règlement ou au-delà du règlement,
-- remboursement contre versement (revues de la PR #198, sécurité n° 1, argent n° 1, qa n° 1).
-- Jamais en production (test-migrations/ seulement). SECURITY DEFINER sous migrator (politique
-- migrator_all) : la transaction appelante reste sous un rôle de production (app_worker) et les
-- contrôles différés s'exécutent à SON COMMIT ; la garde de versement de 0054 (déclencheur des
-- jambes) s'applique toujours à un LEG_RELEASE.
--
-- Retour arrière : DROP FUNCTION test_fixture.us224_insert_proven_order(uuid, uuid, uuid, text,
--   jsonb, uuid, integer).

CREATE FUNCTION test_fixture.us224_insert_proven_order(
  p_operation_id       uuid,
  p_trip_id            uuid,
  p_account_id         uuid,
  p_kind               text,
  p_legs               jsonb,
  p_settlement_id      uuid,
  p_settlement_version integer
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_country  text;
  v_currency text;
  v_org      uuid;
  v_amount   bigint;
BEGIN
  SELECT t.country_code, t.currency, t.org_id INTO v_country, v_currency, v_org
    FROM core.booking_trip AS t WHERE t.id = p_trip_id;
  SELECT CASE WHEN p_kind = 'LEG_REALLOCATION'
              THEN COALESCE(sum((l.value #>> '{}')::bigint)
                              FILTER (WHERE (l.value #>> '{}')::bigint > 0), 0)
              ELSE COALESCE(sum((l.value #>> '{}')::bigint), 0) END
    INTO v_amount
    FROM pg_catalog.jsonb_each(p_legs) AS l;
  INSERT INTO core.payment_payment_operation
         (id, trip_id, psp_account_id, country_code, provider, kind, purpose, amount_minor, currency,
          attempt_no, status, idem_plain, idem_sent, proof_type, settlement_id, settlement_version)
  VALUES (p_operation_id, p_trip_id, p_account_id, v_country, 'FAKE', p_kind, 'RENT', v_amount,
          v_currency, 1, 'SUCCEEDED', pg_catalog.format('us224:%s', p_operation_id),
          pg_catalog.format('us224:%s', p_operation_id), 'WEBHOOK_SIGNED', p_settlement_id,
          p_settlement_version);
  INSERT INTO core.payment_payment_operation_leg (operation_id, leg, org_id, trip_id, country_code,
                                                  amount_minor)
  SELECT p_operation_id, l.key, v_org, p_trip_id, v_country, (l.value #>> '{}')::bigint
    FROM pg_catalog.jsonb_each(p_legs) AS l;
END
$fn$;
REVOKE ALL ON FUNCTION test_fixture.us224_insert_proven_order(uuid, uuid, uuid, text, jsonb, uuid,
                                                              integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.us224_insert_proven_order(uuid, uuid, uuid, text, jsonb, uuid,
                                                                 integer) TO app_worker;
