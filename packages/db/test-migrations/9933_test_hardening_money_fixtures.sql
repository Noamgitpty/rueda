-- 9933 — Fixtures de TEST du durcissement argent n° 2 d'US-224 (migration 0152, ADR-166 n° 9 ;
-- BOARD N-367). Jamais en production (test-migrations/ seulement). SECURITY DEFINER sous migrator
-- (politique migrator_all), search_path figé ; l'appelant reste sous un rôle de production (L0-05),
-- dans une transaction de test.
--
--   - hard2_credit_tender : donne à un encaissement `CAPTURE` encore `PENDING` (enregistré par la
--     vraie commande sur une carte) un moyen crédit de 08 (`CREDIT_CASH`, `CREDIT_PROMO`). Depuis
--     0152, la commande refuse un encaissement par crédit tant que les crédits n'existent pas ; les
--     preuves de 224f qui rejouent les moyens d'origine RÉELS de 08 (T33 : crédit cash et crédit
--     promo ; TJ16d : crédit cash) n'ont donc plus d'autre moyen d'en poser un, pour prouver que le
--     remboursement d'un crédit reste refusé sur tout rail (défense en profondeur).
-- Les attendus des tests viennent de 08 (T33, TJ15, TJ16) et d'ADR-166, jamais de cette fixture.
--
-- Retour arrière : DROP FUNCTION test_fixture.hard2_credit_tender(uuid, text).

CREATE FUNCTION test_fixture.hard2_credit_tender(p_operation_id uuid, p_method text)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_method IS NULL OR p_method NOT IN ('CREDIT_CASH', 'CREDIT_PROMO') THEN
    RAISE EXCEPTION 'test hard2 : moyen crédit attendu' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE core.payment_payment_operation AS o
     SET method = p_method
   WHERE o.id = p_operation_id AND o.kind = 'CAPTURE' AND o.status = 'PENDING';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'test hard2 : encaissement CAPTURE PENDING attendu'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END
$fn$;

REVOKE ALL ON FUNCTION test_fixture.hard2_credit_tender(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION test_fixture.hard2_credit_tender(uuid, text) TO app_worker;
