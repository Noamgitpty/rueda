-- 0025 — lectures d'app_api : politiques RLS par type d'acteur et par pays.
-- US-011 ; 17 §2.3 (matrice, « Cloisonnement entre hôtes », « Politiques RLS par type d'acteur »,
-- « Portée par pays », « Règles par type d'acteur », minimisation NOUVELLE-16) ; ADR-027, ADR-035 ;
-- ADR-053 ; tests RLS-1, RLS-6, RLS-8, RLS-9, RLS-12, RLS-13, RLS-20. Appliquée sous `migrator`.
--
-- Principes :
--   - LECTURE seulement : app_api n'a toujours AUCUN droit INSERT / UPDATE / DELETE sur ces tables
--     (ADR-035 ; écritures par commandes cmd_* et travailleurs) ; app_anon et PUBLIC : rien ;
--   - une politique par type d'acteur (GUEST, HOST, STAFF), chacune exigeant app.actor_kind() :
--     contexte absent ou incomplet ⇒ 0 ligne, sans erreur (RLS-8) ; WORKER sous app_api ⇒ 0 ligne ;
--   - GUEST : ses propres objets, quel que soit l'hôte ou le pays (guest_user_id = app.actor_id()) ;
--   - HOST : lignes de SON compte d'hôte (org_id = app.org_id()), réduites aux véhicules de sa
--     portée relue dans membership (titulaire : tous ; co-hôte : vehicle_scope) — app.host_covers_
--     vehicle ; aucun hold (avant la réservation, aucune donnée du voyageur, NOUVELLE-16) ;
--   - STAFF : toujours borné au pays (country_code = ANY (app.country_scope()) ET rôle attribué sur
--     ce pays, app.has_staff_role) ; ADMIN et FINANCE : tout le pays ; OPS / SUPPORT : objets d'un
--     dossier ouvert qui leur est assigné (app.staff_case_covers) ;
--   - colonnes : C4 (hachage du mot de passe) et clés techniques de paiement jamais accordées.
--
-- Hors de cette migration (aucune lecture app_api, documenté dans packages/db/README.md) :
-- booking_vehicle_occupancy (pas d'org_id avant le catalogue ; sonde catalog.vehicle_is_free),
-- booking_hold_compensation, booking_payment_disposition, payment_webhook_inbox (travailleurs),
-- iam_session, iam_email_verification, iam_auth_factor, iam_otp_challenge (commandes iam_*),
-- iam_staff_role_assignment, iam_role_permission, iam_restriction (console US-012), outbox_* (BUS).
--
-- Retour arrière : DROP POLICY <politiques ci-dessous> ; REVOKE SELECT ON <tables> FROM app_api.

-- core.booking_trip -----------------------------------------------------------------------------
GRANT SELECT ON core.booking_trip TO app_api;
CREATE POLICY trip_guest_read ON core.booking_trip FOR SELECT TO app_api
  USING (app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id());
CREATE POLICY trip_host_read ON core.booking_trip FOR SELECT TO app_api
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id()
         AND app.host_covers_vehicle(vehicle_id));
CREATE POLICY trip_staff_read ON core.booking_trip FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code) OR app.has_staff_role('FINANCE', country_code)
              OR app.staff_case_covers('TRIP', id)));

-- core.booking_checkout_hold (aucune politique HOST : NOUVELLE-16, ADR-053) ----------------------
GRANT SELECT ON core.booking_checkout_hold TO app_api;
CREATE POLICY hold_guest_read ON core.booking_checkout_hold FOR SELECT TO app_api
  USING (app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id());
CREATE POLICY hold_staff_read ON core.booking_checkout_hold FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code) OR app.has_staff_role('FINANCE', country_code)
              OR (converted_trip_id IS NOT NULL AND app.staff_case_covers('TRIP', converted_trip_id))));

-- core.booking_guest_occupancy : table de portée plateforme, lisible par le voyageur seul -------
GRANT SELECT ON core.booking_guest_occupancy TO app_api;
CREATE POLICY guest_occupancy_guest_read ON core.booking_guest_occupancy FOR SELECT TO app_api
  USING (app.actor_kind() = 'GUEST' AND guest_user_id = app.actor_id());

-- core.payment_payment_operation : montants et statut ; ni clés d'idempotence ni référence PSP ----
GRANT SELECT (id, hold_id, trip_id, country_code, kind, purpose, amount_minor, currency, status,
              created_at, updated_at)
  ON core.payment_payment_operation TO app_api;
-- voyageur : opérations de SES holds et trips (les sous-requêtes sont elles-mêmes sous sa RLS)
CREATE POLICY operation_guest_read ON core.payment_payment_operation FOR SELECT TO app_api
  USING (app.actor_kind() = 'GUEST'
         AND (EXISTS (SELECT 1 FROM core.booking_checkout_hold AS h
                       WHERE h.id = payment_payment_operation.hold_id
                         AND h.guest_user_id = app.actor_id())
              OR EXISTS (SELECT 1 FROM core.booking_trip AS t
                          WHERE t.id = payment_payment_operation.trip_id
                            AND t.guest_user_id = app.actor_id())));
CREATE POLICY operation_staff_read ON core.payment_payment_operation FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code) OR app.has_staff_role('FINANCE', country_code)
              OR (trip_id IS NOT NULL AND app.staff_case_covers('TRIP', trip_id))));

-- core.iam_user_account : son propre compte seulement ; jamais password_hash (C4) ---------------
-- (le voyageur vu par l'hôte passera par la vue minimisée host_guest_v, US-062)
GRANT SELECT (id, email, email_verified_at, phone_e164, phone_verified_at, legal_first_name,
              legal_last_name, display_name, date_of_birth, preferred_locale, residence_country,
              status, created_at, updated_at)
  ON core.iam_user_account TO app_api;
CREATE POLICY user_account_self_read ON core.iam_user_account FOR SELECT TO app_api
  USING (app.actor_kind() IN ('GUEST', 'HOST', 'STAFF') AND id = app.actor_id());

-- core.iam_organization : le titulaire lit son compte d'hôte ; ADMIN / FINANCE du pays ---------
GRANT SELECT ON core.iam_organization TO app_api;
CREATE POLICY organization_holder_read ON core.iam_organization FOR SELECT TO app_api
  USING (app.actor_kind() = 'HOST' AND id = app.org_id() AND app.is_org_holder());
CREATE POLICY organization_staff_read ON core.iam_organization FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code) OR app.has_staff_role('FINANCE', country_code)));

-- core.iam_membership : le titulaire voit les membres de son compte, un co-hôte la sienne -------
GRANT SELECT (id, user_id, org_id, role, vehicle_scope, permission_overrides, status,
              invite_expires_at, created_at, updated_at)
  ON core.iam_membership TO app_api;
CREATE POLICY membership_host_read ON core.iam_membership FOR SELECT TO app_api
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id()
         AND (app.is_org_holder() OR (user_id = app.actor_id() AND status = 'ACTIVE')));
CREATE POLICY membership_staff_read ON core.iam_membership FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF'
         AND EXISTS (SELECT 1 FROM core.iam_organization AS o
                      WHERE o.id = iam_membership.org_id
                        AND o.country_code = ANY (app.country_scope())
                        AND app.has_staff_role('ADMIN', o.country_code)));

-- core.support_support_case : ADMIN du pays ; OPS / SUPPORT : dossiers qui leur sont assignés -----
GRANT SELECT ON core.support_support_case TO app_api;
CREATE POLICY support_case_staff_read ON core.support_support_case FOR SELECT TO app_api
  USING (app.actor_kind() = 'STAFF' AND country_code = ANY (app.country_scope())
         AND (app.has_staff_role('ADMIN', country_code)
              OR (assignee_id = app.actor_id()
                  AND (app.has_staff_role('OPS_AGENT', country_code)
                       OR app.has_staff_role('SUPPORT_AGENT', country_code)))));
