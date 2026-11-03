-- 0035 — Rôle P2P_HOST : permissions de l'hôte, politiques RLS de l'hôte sur les jambes,
-- minimisation de ce que l'hôte voit du voyageur (`host_guest_v`).
-- US-062 ; 17 §2.3 (rôles GUEST / P2P_HOST / CO_HOST, matrice, « Minimisation de ce que l'hôte
-- voit du voyageur », NOUVELLE-16, SQL des tables d'argent, « Fonctions de politique »), §3.2.1 ;
-- ADR-027, ADR-046, ADR-053, ADR-064 ; tests RLS-2, RLS-26, RLS-28. Appliquée sous `migrator`.
--
-- 1. Matrice des permissions (17 §2.3) : seules les permissions LUES par une politique ou une
--    commande de cette story sont semées (comme US-012) : `finance.read_org_statements` du
--    P2P_HOST (relevés de gains, jambes HOST), `finance.platform_advance` et
--    `finance.insurer_bordereau` de FINANCE et ADMIN (commandes FINANCE à deux personnes, 0036).
--    Le CO_HOST n'en reçoit aucune : comme chez Turo, il ne voit jamais les gains (BR-COHOST-02).
-- 2. `app.has_permission(code)` (17 §2.3, B16) : SECURITY DEFINER, STABLE, search_path figé,
--    propriétaire policy_fn_owner, aucun paramètre de personne. Elle relit en base l'appartenance
--    ACTIVE de l'acteur au compte d'hôte de la session, puis la matrice en vigueur pour son rôle,
--    plus les permissions unitaires accordées par le titulaire (`membership.permission_overrides`).
--    Le contexte ne peut donc que RÉDUIRE (ADR-053). Écart PROPOSÉ (ADR-064) : elle ne répond
--    que pour un acteur HOST ; le staff relit ses permissions par `core.iam_staff_permitted` dans
--    les commandes (ADR-062) et ses lectures par `app.has_staff_role` : faux pour tout autre acteur.
-- 3. Politiques de l'hôte sur les trois tables de jambes (RLS-2, RLS-28) : le TITULAIRE seulement
--    (`app.is_org_holder()`), jambe HOST de son compte, sans réduction de portée par véhicule, et
--    seulement s'il détient `finance.read_org_statements`. Un co-hôte qui aurait reçu la
--    permission par erreur ne lit rien : `app.is_org_holder()` est faux (RLS-28).
-- 4. Minimisation (report de la revue code US-011, constat 6) : `booking_trip.guest_user_id`
--    n'est plus lisible par app_api (aucun rôle applicatif ne s'en sert : le voyageur se connaît,
--    l'hôte passe par `host_guest_v`, le staff par la console). Les politiques peuvent encore
--    s'en servir (une politique n'exige pas le droit de lecture de la colonne) ; la sous-requête
--    de `operation_guest_read`, elle, l'exigeait : elle s'appuie désormais sur la RLS du trip.
-- 5. `core.booking_host_guest_v` (17 « host_guest_v ») : vue security_invoker au-dessus d'une
--    fonction SECURITY DEFINER (propriétaire host_view_owner, NOLOGIN, lecture seule de quatre
--    colonnes de deux tables par politique dédiée) : prénom, âge en années, note et statut de
--    vérification du voyageur des trips de SON compte (portée véhicule d'un co-hôte comprise),
--    jamais l'identifiant du compte, le nom, la date de naissance, l'email, le téléphone ni une
--    pièce. La note (`rating_aggregate`, story des avis) et le statut de vérification
--    (`identity_verification`, KYC du voyageur) n'existent pas encore : colonnes NULL jusqu'à
--    leurs stories, qui remplaceront la fonction (ADR-064, « Limites »).
--
-- Retour arrière :
--   DROP VIEW core.booking_host_guest_v; DROP FUNCTION core.booking_host_guest_rows();
--   DROP POLICY host_view_read ON core.booking_trip, core.iam_user_account;
--   REVOKE ALL ON core.booking_trip, core.iam_user_account FROM host_view_owner;
--   REVOKE EXECUTE ON FUNCTION app.host_covers_vehicle(uuid), app.actor_kind(), app.org_id(),
--     platform.now() FROM host_view_owner; REVOKE USAGE ON SCHEMA core, app, platform FROM host_view_owner;
--   GRANT SELECT (guest_user_id) ON core.booking_trip TO app_api;
--   ALTER POLICY operation_guest_read … (texte de 0025) ;
--   ALTER POLICY settlement_leg_host_read / leg_host_read … (textes de 0027, 0028) ;
--   DROP FUNCTION app.has_permission(text); DROP POLICY policy_fn_read ON core.iam_role_permission;
--   REVOKE SELECT ON core.iam_role_permission FROM policy_fn_owner;
--   REVOKE SELECT (permission_overrides) ON core.iam_membership FROM policy_fn_owner;
--   DELETE FROM core.iam_role_permission WHERE change_reason LIKE 'US-062%';

-- 1. Matrice des permissions (17 §2.3 ; PROPOSÉ) ------------------------------------------------
INSERT INTO core.iam_role_permission (role, permission_code, scope_rule, valid_from, change_reason)
VALUES
  ('P2P_HOST', 'finance.read_org_statements', 'ORG',      '2026-11-03T00:00:00Z', 'US-062 : matrice 17 §2.3'),
  ('FINANCE',  'finance.platform_advance',    'PLATFORM', '2026-11-03T00:00:00Z', 'US-062 : matrice 17 §2.3'),
  ('ADMIN',    'finance.platform_advance',    'PLATFORM', '2026-11-03T00:00:00Z', 'US-062 : matrice 17 §2.3'),
  ('FINANCE',  'finance.insurer_bordereau',   'PLATFORM', '2026-11-03T00:00:00Z', 'US-062 : matrice 17 §2.3'),
  ('ADMIN',    'finance.insurer_bordereau',   'PLATFORM', '2026-11-03T00:00:00Z', 'US-062 : matrice 17 §2.3');

-- 2. app.has_permission (policy_fn_owner) -------------------------------------------------------
GRANT SELECT (permission_overrides) ON core.iam_membership TO policy_fn_owner;
GRANT SELECT (role, permission_code, valid_from, valid_to) ON core.iam_role_permission TO policy_fn_owner;
CREATE POLICY policy_fn_read ON core.iam_role_permission FOR SELECT TO policy_fn_owner USING (true);

-- L'hôte de la session (titulaire ou co-hôte ACTIF du compte app.org_id) détient-il p_code ?
-- Titulaire : membership P2P_HOST active ET organization.holder_user_id = acteur (comme
-- app.is_org_holder) ; co-hôte : membership CO_HOST active. Permission = matrice en vigueur pour
-- ce rôle, ou permission unitaire accordée par le titulaire (permission_overrides).
CREATE FUNCTION app.has_permission(p_code text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           app.actor_kind() = 'HOST'
           AND p_code IS NOT NULL
           AND EXISTS (SELECT 1
                         FROM core.iam_membership AS m
                         JOIN core.iam_organization AS o ON o.id = m.org_id
                        WHERE m.org_id = app.org_id()
                          AND m.user_id = app.actor_id()
                          AND m.status = 'ACTIVE'
                          AND (m.role = 'CO_HOST'
                               OR (m.role = 'P2P_HOST' AND o.holder_user_id = m.user_id))
                          AND (p_code = ANY (m.permission_overrides)
                               OR EXISTS (SELECT 1
                                            FROM core.iam_role_permission AS p
                                           WHERE p.role = m.role
                                             AND p.permission_code = p_code
                                             AND p.valid_from <= platform.now()
                                             AND (p.valid_to IS NULL OR p.valid_to > platform.now())))),
           false)
$fn$;

COMMENT ON FUNCTION app.has_permission(text) IS
  'Politique : l''hôte de la session (titulaire ou co-hôte actif) détient la permission (matrice '
  'en vigueur ou permission unitaire du titulaire) ; faux pour tout autre acteur. US-062.';

REVOKE ALL ON FUNCTION app.has_permission(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_permission(text) TO app_api;

GRANT CREATE ON SCHEMA app TO policy_fn_owner;
ALTER FUNCTION app.has_permission(text) OWNER TO policy_fn_owner;
REVOKE CREATE ON SCHEMA app FROM policy_fn_owner;

-- 3. Politiques de l'hôte sur les jambes (RLS-2, RLS-28) ----------------------------------------
ALTER POLICY settlement_leg_host_read ON core.settlement_settlement_leg
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id() AND leg = 'HOST'
         AND app.is_org_holder() AND app.vehicle_scope() IS NULL
         AND app.has_permission('finance.read_org_statements'));
ALTER POLICY leg_host_read ON core.settlement_trip_leg_balance
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id() AND leg = 'HOST'
         AND app.is_org_holder() AND app.vehicle_scope() IS NULL
         AND app.has_permission('finance.read_org_statements'));
-- 0028 n'exigeait pas l'absence de réduction de portée par véhicule : alignée sur 17 §2.3.
ALTER POLICY leg_host_read ON core.payment_payment_operation_leg
  USING (app.actor_kind() = 'HOST' AND org_id = app.org_id() AND leg = 'HOST'
         AND app.is_org_holder() AND app.vehicle_scope() IS NULL
         AND app.has_permission('finance.read_org_statements'));

-- 4. Minimisation : identifiant du voyageur ------------------------------------------------------
REVOKE SELECT (guest_user_id) ON core.booking_trip FROM app_api;
-- Le trip est lui-même sous la RLS du voyageur (trip_guest_read) : la sous-requête ne voit que
-- SES trips, sans lire guest_user_id.
ALTER POLICY operation_guest_read ON core.payment_payment_operation
  USING (app.actor_kind() = 'GUEST'
         AND (EXISTS (SELECT 1 FROM core.booking_checkout_hold AS h
                       WHERE h.id = payment_payment_operation.hold_id
                         AND h.guest_user_id = app.actor_id())
              OR EXISTS (SELECT 1 FROM core.booking_trip AS t
                          WHERE t.id = payment_payment_operation.trip_id)));

-- 5. host_guest_v (host_view_owner) -------------------------------------------------------------
GRANT USAGE ON SCHEMA core, app, platform TO host_view_owner;
GRANT EXECUTE ON FUNCTION platform.now(), app.actor_kind(), app.org_id() TO host_view_owner;
GRANT EXECUTE ON FUNCTION app.host_covers_vehicle(uuid) TO host_view_owner;
GRANT SELECT (id, org_id, vehicle_id, guest_user_id) ON core.booking_trip TO host_view_owner;
GRANT SELECT (id, legal_first_name, date_of_birth, pseudonymized_at)
  ON core.iam_user_account TO host_view_owner;
CREATE POLICY host_view_read ON core.booking_trip FOR SELECT TO host_view_owner USING (true);
CREATE POLICY host_view_read ON core.iam_user_account FOR SELECT TO host_view_owner USING (true);

-- Voyageurs des trips du compte d'hôte de la session, réduits à ce que 17 §2.3 autorise.
-- Aucun paramètre ; aucune ligne pour un acteur autre que HOST ; un co-hôte ne voit que les trips
-- des véhicules de sa portée (app.host_covers_vehicle relit membership) ; un compte pseudonymisé
-- (droit à l'effacement) ne rend plus de prénom.
CREATE FUNCTION core.booking_host_guest_rows()
  RETURNS TABLE (trip_id uuid, first_name text, age_years integer, rating numeric,
                 verification_status text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT t.id,
         CASE WHEN u.pseudonymized_at IS NULL THEN u.legal_first_name END,
         CASE WHEN u.pseudonymized_at IS NULL AND u.date_of_birth IS NOT NULL
              THEN pg_catalog.date_part('year',
                     pg_catalog.age(platform.now(), u.date_of_birth::timestamptz))::integer
         END,
         NULL::numeric,      -- note du voyageur : rating_aggregate (story des avis)
         NULL::text          -- statut de vérification : identity_verification (KYC du voyageur)
    FROM core.booking_trip AS t
    JOIN core.iam_user_account AS u ON u.id = t.guest_user_id
   WHERE app.actor_kind() = 'HOST'
     AND t.org_id = app.org_id()
     AND app.host_covers_vehicle(t.vehicle_id)
$fn$;

COMMENT ON FUNCTION core.booking_host_guest_rows() IS
  'host_guest_v (17 §2.3) : prénom, âge, note, statut de vérification du voyageur des trips de '
  'l''hôte de la session ; rien d''autre. US-062.';

REVOKE ALL ON FUNCTION core.booking_host_guest_rows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_host_guest_rows() TO app_api;

GRANT CREATE ON SCHEMA core TO host_view_owner;
ALTER FUNCTION core.booking_host_guest_rows() OWNER TO host_view_owner;
REVOKE CREATE ON SCHEMA core FROM host_view_owner;

CREATE VIEW core.booking_host_guest_v WITH (security_invoker = true) AS
  SELECT g.trip_id, g.first_name, g.age_years, g.rating, g.verification_status
    FROM core.booking_host_guest_rows() AS g;
COMMENT ON VIEW core.booking_host_guest_v IS
  'host_guest_v (17 §2.3, NOUVELLE-16) : ce que l''hôte voit du voyageur de ses trips. US-062.';
REVOKE ALL ON core.booking_host_guest_v FROM PUBLIC;
GRANT SELECT ON core.booking_host_guest_v TO app_api;
