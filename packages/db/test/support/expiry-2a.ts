/** Texte unique de l'instruction 2a (US-006, US-007). Module sans base de données. */

/**
 * Instruction 2a (17 §2.5, VERIF_16-M14, VERIF_17-A3 / A6), recopiée de la spécification : holds
 * échus du véhicule OU du guest, filtres A3 / A6, `FOR UPDATE OF h SKIP LOCKED` dans une CTE.
 * Paramètres : $1 véhicule, $2 guest (nul = partie véhicule seule), $3 `sweep_grace_s`.
 * Même texte pour l'exécution (`expireDueHolds`), pour le plan mesuré par L0-04 et pour la
 * fixture de pose `test_fixture.l0_place_hold` (9002) : `expiry-2a.test.ts` vérifie l'égalité.
 */
export const EXPIRY_2A_SQL = `WITH t AS (SELECT platform.now() AS ts),
     due AS (
       SELECT h.id, h.occupancy_id
         FROM core.booking_checkout_hold h, t
        WHERE (h.vehicle_id = $1::uuid OR h.guest_user_id = $2::uuid)
          AND h.status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT')
          AND h.expires_at <= t.ts
          AND (h.payment_in_flight_until IS NULL OR h.payment_in_flight_until <= t.ts)
          AND NOT EXISTS (SELECT 1 FROM core.payment_payment_operation o
                           WHERE o.hold_id = h.id AND o.purpose = 'RENT'
                             AND ( ( o.status IN ('PENDING','SUBMITTED','UNKNOWN')
                                     AND (h.last_polled_at IS NULL OR h.last_polled_at < h.payment_in_flight_until)
                                     AND t.ts < h.payment_in_flight_until + make_interval(secs => $3) )
                                OR ( o.status = 'SUCCEEDED'
                                     AND NOT EXISTS (SELECT 1 FROM core.booking_payment_disposition d
                                                      WHERE d.operation_id = o.id) ) ))
        FOR UPDATE OF h SKIP LOCKED
     ), expired AS (
       UPDATE core.booking_checkout_hold SET status = 'EXPIRED', expired_at = (SELECT ts FROM t)
        WHERE id IN (SELECT id FROM due)
       RETURNING occupancy_id
     )
     UPDATE core.booking_vehicle_occupancy
        SET active = false, deactivated_reason = 'HOLD_EXPIRED'
      WHERE id IN (SELECT occupancy_id FROM expired)
        AND kind = 'HOLD'`;
