-- 0007 — droits et politiques RLS des travailleurs (app_worker) sur les tables AVL et PAY.
-- US-006 ; 17 §2.3 « Droits d'écriture sur les tables de réservation » (VERIF_17-A1) et « Rôles
-- d'exécution des commandes » (VERIF_17-A2) ; ADR-035. Appliquée sous `migrator`.
--
-- Principes :
--   - app_api : AUCUN droit sur ces tables ici (17 §2.3 : aucun INSERT / UPDATE / DELETE ; ses
--     lectures filtrées et les commandes cmd_* sous cmd_hold_owner arrivent avec US-011 / US-023) ;
--   - app_anon, PUBLIC : rien ;
--   - DELETE : accordé à personne (classe A / B : désactivation, jamais suppression) ;
--   - app_worker : colonnes bornées par GRANT UPDATE (colonnes), politiques séparées par commande
--     SQL (SELECT, INSERT, UPDATE ; aucune politique DELETE), chacune réservée à app.actor_kind() =
--     'WORKER' et à une liste de travailleurs (« une politique explicite par travailleur »).
--     Contexte absent ⇒ aucune ligne visible, aucune écriture (fail-closed).
--
-- Travailleurs (noms PROPOSÉS, reportés dans packages/db/README.md) :
--   booking_conversion, disposition_sweeper, payment_intent_sweeper : étape 4 (conversion,
--     ré-acquisition avec l'expiration ciblée 2a, partie véhicule) et étape 5 (compensation) ;
--   hold_expiry : étape 7 (expiration) et libération effective (étape 6, temps 2) ;
--   trip_lifecycle : transitions SM-1 qui désactivent ou raccourcissent l'occupation d'un trip ;
--   webhook_ingest : réception des webhooks (17 §4.4) et application du statut d'opération.
--
-- Retour arrière : DROP POLICY worker_* sur chaque table ; REVOKE ALL ON <tables> FROM app_worker.

-- core.booking_checkout_hold -------------------------------------------------------------------
GRANT SELECT ON core.booking_checkout_hold TO app_worker;
GRANT UPDATE (status, expired_at, released_at, release_reason, converted_trip_id,
              conversion_operation_id, compensated_at, last_polled_at)
  ON core.booking_checkout_hold TO app_worker;
CREATE POLICY worker_select ON core.booking_checkout_hold FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'hold_expiry'));
CREATE POLICY worker_update_conversion ON core.booking_checkout_hold FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper'))
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper'));
-- l'expiration ne fait que sortir un hold vivant vers EXPIRED / RELEASED
CREATE POLICY worker_update_expiry ON core.booking_checkout_hold FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'hold_expiry'
         AND status IN ('ACTIVE', 'PAYMENT_IN_FLIGHT'))
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'hold_expiry'
         AND status IN ('EXPIRED', 'RELEASED'));

-- core.booking_vehicle_occupancy ---------------------------------------------------------------
GRANT SELECT ON core.booking_vehicle_occupancy TO app_worker;
GRANT UPDATE (kind, active, expires_at, deactivated_reason, ref_type, ref_id, period)
  ON core.booking_vehicle_occupancy TO app_worker;
CREATE POLICY worker_select ON core.booking_vehicle_occupancy FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'hold_expiry',
          'trip_lifecycle'));
CREATE POLICY worker_update_conversion ON core.booking_vehicle_occupancy FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper'))
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper'));
-- l'expiration désactive une occupation HOLD, jamais une ligne TRIP (17 §2.5, VERIF_14-F1)
CREATE POLICY worker_update_expiry ON core.booking_vehicle_occupancy FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'hold_expiry'
         AND kind = 'HOLD' AND active)
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'hold_expiry'
         AND kind = 'HOLD' AND NOT active);
-- les transitions de trip ne touchent que les lignes TRIP (désactivation, raccourcissement)
CREATE POLICY worker_update_trip ON core.booking_vehicle_occupancy FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle' AND kind = 'TRIP')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle' AND kind = 'TRIP');

-- core.booking_trip ----------------------------------------------------------------------------
GRANT SELECT, INSERT ON core.booking_trip TO app_worker;
GRANT UPDATE (status, scheduled_start, scheduled_end, termination_reason, cancellation_reason)
  ON core.booking_trip TO app_worker;
CREATE POLICY worker_select ON core.booking_trip FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'trip_lifecycle'));
-- un trip naît BOOKED, par la conversion seulement (SM-1 HOLD -> BOOKED)
CREATE POLICY worker_insert_conversion ON core.booking_trip FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper')
         AND status = 'BOOKED');
CREATE POLICY worker_update_trip ON core.booking_trip FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle');

-- core.booking_guest_occupancy -----------------------------------------------------------------
GRANT SELECT, INSERT ON core.booking_guest_occupancy TO app_worker;
GRANT UPDATE (active, period) ON core.booking_guest_occupancy TO app_worker;
CREATE POLICY worker_select ON core.booking_guest_occupancy FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'trip_lifecycle'));
CREATE POLICY worker_insert_conversion ON core.booking_guest_occupancy FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper') AND active);
CREATE POLICY worker_update_trip ON core.booking_guest_occupancy FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'trip_lifecycle');

-- core.booking_hold_compensation ---------------------------------------------------------------
GRANT SELECT, INSERT ON core.booking_hold_compensation TO app_worker;
CREATE POLICY worker_select ON core.booking_hold_compensation FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper'));
CREATE POLICY worker_insert_conversion ON core.booking_hold_compensation FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper')
         AND status = 'OPEN');

-- core.booking_payment_disposition (immuable : SELECT et INSERT seulement) ---------------------
GRANT SELECT, INSERT ON core.booking_payment_disposition TO app_worker;
CREATE POLICY worker_select ON core.booking_payment_disposition FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'hold_expiry'));
CREATE POLICY worker_insert_conversion ON core.booking_payment_disposition FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper'));

-- core.payment_payment_operation (montants immuables : seul le statut évolue) ------------------
GRANT SELECT ON core.payment_payment_operation TO app_worker;
GRANT UPDATE (status, provider_reference, proof_type) ON core.payment_payment_operation TO app_worker;
CREATE POLICY worker_select ON core.payment_payment_operation FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'hold_expiry',
          'webhook_ingest'));
CREATE POLICY worker_update_status ON core.payment_payment_operation FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'webhook_ingest'))
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper', 'webhook_ingest'));

-- core.payment_webhook_inbox -------------------------------------------------------------------
GRANT SELECT, INSERT ON core.payment_webhook_inbox TO app_worker;
GRANT UPDATE (processing_status, processed_at, error) ON core.payment_webhook_inbox TO app_worker;
-- la preuve persistée est relue par la conversion et par disposition_sweeper (17 §2.5, A6)
CREATE POLICY worker_select ON core.payment_webhook_inbox FOR SELECT TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() IN
         ('webhook_ingest', 'booking_conversion', 'disposition_sweeper', 'payment_intent_sweeper'));
CREATE POLICY worker_insert_ingest ON core.payment_webhook_inbox FOR INSERT TO app_worker
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'webhook_ingest');
CREATE POLICY worker_update_ingest ON core.payment_webhook_inbox FOR UPDATE TO app_worker
  USING (app.actor_kind() = 'WORKER' AND app.worker_name() = 'webhook_ingest')
  WITH CHECK (app.actor_kind() = 'WORKER' AND app.worker_name() = 'webhook_ingest');
