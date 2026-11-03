-- 0024 — contexte de session complet, dossier de support (sous-ensemble) et fonctions de politique.
-- US-011 ; 17 §2.3 « Contexte de session », « Portée par pays » (VERIF_17-B15), « Fonctions de
-- politique » (VERIF_17-B16), « Cloisonnement entre hôtes », §3.2.13 (`support_case`) ; ADR-027,
-- ADR-035 ; ADR-053. Appliquée sous `migrator`.
--
-- 1. Lecteurs du contexte (SECURITY INVOKER, comme app.actor_kind() de 0002) : paramètre absent,
--    vide ou mal formé ⇒ NULL ⇒ aucune ligne, SANS erreur (fail-closed, RLS-8). Le contexte est
--    posé par une seule fonction de la couche d'accès (packages/db/src/session-context.ts).
-- 2. `core.support_support_case` : le sous-ensemble de 17 §3.2.13 dont les politiques OPS / SUPPORT
--    ont besoin (« dossiers assignés seulement », RLS-6, RLS-20). Écrit par la console (US-012) ;
--    aucun droit d'écriture applicatif ici.
-- 3. Fonctions de politique : SECURITY DEFINER (elles lisent des tables elles-mêmes sous RLS),
--    STABLE, search_path figé, aucun paramètre de personne (elles lisent app.actor_id()),
--    propriétaire policy_fn_owner (NOLOGIN, lecture seule de 4 tables par politique dédiée),
--    EXECUTE au seul app_api. Elles ne renvoient qu'un booléen sur l'acteur de la session : rien sur
--    un tiers. Écarts PROPOSÉS avec 17 (ADR-053) :
--      - app.has_staff_role(rôle, pays) : le pays est un paramètre et la portée est relue dans
--        staff_role_assignment, en plus de app.country_scope() (le contexte ne peut que RÉDUIRE la
--        portée, jamais l'élargir) ;
--      - app.host_covers_vehicle(véhicule) : la portée d'un hôte est relue dans membership (un
--        co-hôte dont la couche d'accès oublierait app.vehicle_scope ne voit pas tout le compte :
--        17 écrivait « vehicle_scope() IS NULL ⇒ tout », ouvert par défaut) ;
--      - app.staff_case_covers(type, id) ne couvre que le type 'TRIP' (seul objet porté par
--        support_case en Bêta) ; review_queue_item arrivera avec sa story.
--    app.has_permission(code) n'est pas créée : aucune table en Bêta ne la lit encore (US-062).
--
-- Retour arrière :
--   DROP FUNCTION app.has_staff_role(text, text), app.staff_case_covers(text, uuid),
--     app.host_covers_vehicle(uuid), app.is_org_holder();
--   DROP POLICY policy_fn_read ON core.iam_membership, core.iam_organization,
--     core.iam_staff_role_assignment, core.iam_user_account, core.support_support_case;
--   REVOKE ALL ON core.iam_membership, core.iam_organization, core.iam_staff_role_assignment,
--     core.iam_user_account FROM policy_fn_owner;  REVOKE USAGE ON SCHEMA core FROM policy_fn_owner;
--   DROP TABLE core.support_support_case;
--   DROP FUNCTION app.actor_id(), app.org_id(), app.vehicle_scope(), app.country_scope();

-- 1. Lecteurs du contexte ------------------------------------------------------------------------
CREATE FUNCTION app.actor_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN v.s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v.s::uuid
         END
    FROM (SELECT pg_catalog.lower(NULLIF(pg_catalog.current_setting('app.actor_id', true), '')) AS s) AS v
$fn$;

CREATE FUNCTION app.org_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN v.s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v.s::uuid
         END
    FROM (SELECT pg_catalog.lower(NULLIF(pg_catalog.current_setting('app.org_id', true), '')) AS s) AS v
$fn$;

-- Portée d'un co-hôte, littéral de tableau d'UUID : « {u1,u2} » ; « {} » = aucun véhicule.
-- Elle ne peut que RÉDUIRE la portée relue dans membership (app.host_covers_vehicle).
CREATE FUNCTION app.vehicle_scope()
  RETURNS uuid[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
           WHEN v.s ~ '^\{([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(,[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})*)?\}$'
             THEN v.s::uuid[]
         END
    FROM (SELECT pg_catalog.lower(NULLIF(pg_catalog.current_setting('app.vehicle_scope', true), '')) AS s) AS v
$fn$;

-- Portée pays d'un membre du staff (17 §2.3 « Portée par pays ») : « {AA} » ou « {AA,BB} ».
-- Les codes valides sont ceux de config (aucune constante ici) ; un code inconnu ne couvre aucune
-- ligne. Elle ne peut que RÉDUIRE la portée relue dans staff_role_assignment (app.has_staff_role).
CREATE FUNCTION app.country_scope()
  RETURNS text[]
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN v.s ~ '^\{[A-Z]{2}(,[A-Z]{2})*\}$' THEN v.s::text[] END
    FROM (SELECT NULLIF(pg_catalog.current_setting('app.country_scope', true), '') AS s) AS v
$fn$;

COMMENT ON FUNCTION app.actor_id() IS
  'Contexte app.actor_id (17 §2.3) ; absent ou mal formé => NULL (fail-closed). US-011.';
COMMENT ON FUNCTION app.org_id() IS
  'Contexte app.org_id : compte d''hôte de la session ; absent ou mal formé => NULL. US-011.';
COMMENT ON FUNCTION app.vehicle_scope() IS
  'Contexte app.vehicle_scope (uuid[]) ; ne fait que réduire la portée relue dans membership. US-011.';
COMMENT ON FUNCTION app.country_scope() IS
  'Contexte app.country_scope (text[]) ; ne fait que réduire la portée relue dans '
  'staff_role_assignment. US-011.';

REVOKE ALL ON FUNCTION app.actor_id(), app.org_id(), app.vehicle_scope(), app.country_scope()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.actor_id(), app.org_id(), app.vehicle_scope(), app.country_scope()
  TO app_api, app_worker, policy_fn_owner;

-- 2. Dossier de support (17 §3.2.13, sous-ensemble) ---------------------------------------------
CREATE TABLE core.support_support_case (
  id                uuid        PRIMARY KEY,
  requester_user_id uuid        REFERENCES core.iam_user_account (id),
  -- portée pays du staff (VERIF_17-B15) ; égal au pays du trip quand il y en a un (clé composée)
  country_code      text        NOT NULL
    CONSTRAINT support_case_country_format CHECK (country_code ~ '^[A-Z]{2}$'),
  trip_id           uuid,
  channel           text        NOT NULL
    -- INTERNAL : dossier ouvert par le staff lui-même (bris de glace motivé), PROPOSÉ
    CONSTRAINT support_case_channel_valid CHECK (channel IN
      ('WHATSAPP', 'EMAIL', 'PHONE', 'IN_APP', 'INTERNAL')),
  category          text        NOT NULL
    CONSTRAINT support_case_category_valid CHECK (category IN
      ('TRIP', 'PAYMENT', 'ACCOUNT', 'LISTING', 'CLAIM', 'SAFETY', 'OTHER', 'BREAK_GLASS')),
  priority          text        NOT NULL DEFAULT 'NORMAL'
    CONSTRAINT support_case_priority_valid CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  status            text        NOT NULL DEFAULT 'OPEN'
    CONSTRAINT support_case_status_valid CHECK (status IN ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED')),
  assignee_id       uuid        REFERENCES core.iam_user_account (id),
  reason            text,                                            -- [C2] motif (bris de glace)
  sla_due_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT platform.now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT platform.now(),
  updated_by        uuid,
  row_version       integer     NOT NULL DEFAULT 0,
  CONSTRAINT support_case_trip_country_fk FOREIGN KEY (trip_id, country_code)
    REFERENCES core.booking_trip (id, country_code),
  -- un bris de glace est toujours motivé (17 §2.3)
  CONSTRAINT support_case_break_glass_reason CHECK (
    category <> 'BREAK_GLASS'
    OR (reason IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(reason)) BETWEEN 10 AND 2000))
);
-- 17 §2.3 : index de la fonction de politique (objet, assigné)
CREATE INDEX support_case_trip_assignee_idx ON core.support_support_case (trip_id, assignee_id)
  WHERE (status IN ('OPEN', 'PENDING'));
CREATE TRIGGER touch_row BEFORE UPDATE ON core.support_support_case
  FOR EACH ROW EXECUTE FUNCTION platform.touch_row();

ALTER TABLE core.support_support_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.support_support_case FORCE ROW LEVEL SECURITY;
CREATE POLICY migrator_all ON core.support_support_case TO migrator USING (true) WITH CHECK (true);
REVOKE ALL ON core.support_support_case FROM PUBLIC;

COMMENT ON TABLE core.support_support_case IS
  'SUP support_case (17 §3.2.13), sous-ensemble : porte l''assignation qui ouvre à OPS / SUPPORT '
  'les objets d''un dossier (app.staff_case_covers). Écrit par la console (US-012). US-011.';

-- 3. Fonctions de politique (policy_fn_owner) ----------------------------------------------------
GRANT USAGE ON SCHEMA core TO policy_fn_owner;
GRANT SELECT (org_id, user_id, role, status, vehicle_scope) ON core.iam_membership TO policy_fn_owner;
GRANT SELECT (id, holder_user_id) ON core.iam_organization TO policy_fn_owner;
GRANT SELECT (user_id, role, country_scope, expires_at)
  ON core.iam_staff_role_assignment TO policy_fn_owner;
GRANT SELECT (trip_id, assignee_id, status, country_code)
  ON core.support_support_case TO policy_fn_owner;
-- statut du compte : un membre du staff dont le compte n'est pas ACTIVE perd ses rôles
GRANT SELECT (id, status) ON core.iam_user_account TO policy_fn_owner;
CREATE POLICY policy_fn_read ON core.iam_membership FOR SELECT TO policy_fn_owner USING (true);
CREATE POLICY policy_fn_read ON core.iam_organization FOR SELECT TO policy_fn_owner USING (true);
CREATE POLICY policy_fn_read ON core.iam_staff_role_assignment FOR SELECT TO policy_fn_owner USING (true);
CREATE POLICY policy_fn_read ON core.support_support_case FOR SELECT TO policy_fn_owner USING (true);
CREATE POLICY policy_fn_read ON core.iam_user_account FOR SELECT TO policy_fn_owner USING (true);

-- Le membre du staff de la session a-t-il le rôle p_role, en cours, sur le pays p_country ?
-- Le pays doit être à la fois dans la portée posée (app.country_scope) et dans celle de
-- l'attribution (staff_role_assignment.country_scope) : RLS-20. Le compte doit être ACTIVE : un
-- compte suspendu (RESTRICTED), fermé ou banni perd tous ses rôles internes (revue sécurité US-011).
CREATE FUNCTION app.has_staff_role(p_role text, p_country text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           app.actor_kind() = 'STAFF'
           AND p_country = ANY (app.country_scope())
           AND EXISTS (SELECT 1
                         FROM core.iam_staff_role_assignment AS a
                         JOIN core.iam_user_account AS u ON u.id = a.user_id
                        WHERE a.user_id = app.actor_id()
                          AND a.role = p_role
                          AND p_country = ANY (a.country_scope)
                          AND (a.expires_at IS NULL OR a.expires_at > platform.now())
                          AND u.status = 'ACTIVE'),
           false)
$fn$;

-- L'objet (type, id) est-il couvert par un dossier OUVERT assigné au membre du staff de la
-- session, OPS ou SUPPORT en cours sur le pays du dossier (17 §2.3 « dossiers assignés ») ?
CREATE FUNCTION app.staff_case_covers(p_object_type text, p_object_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           app.actor_kind() = 'STAFF'
           AND p_object_type = 'TRIP'
           AND EXISTS (SELECT 1
                         FROM core.support_support_case AS c
                        WHERE c.trip_id = p_object_id
                          AND c.assignee_id = app.actor_id()
                          AND c.status IN ('OPEN', 'PENDING')
                          AND c.country_code = ANY (app.country_scope())
                          AND EXISTS (SELECT 1
                                        FROM core.iam_staff_role_assignment AS a
                                        JOIN core.iam_user_account AS u ON u.id = a.user_id
                                       WHERE a.user_id = c.assignee_id
                                         AND a.role IN ('OPS_AGENT', 'SUPPORT_AGENT')
                                         AND c.country_code = ANY (a.country_scope)
                                         AND (a.expires_at IS NULL OR a.expires_at > platform.now())
                                         AND u.status = 'ACTIVE')),
           false)
$fn$;

-- Le véhicule est-il dans la portée de l'hôte de la session sur son compte d'hôte (app.org_id) ?
-- Titulaire actif : tous les véhicules du compte ; co-hôte actif : membership.vehicle_scope
-- seulement (vide = aucun) ; app.vehicle_scope, s'il est posé, réduit encore (17 §2.3, RLS-9).
CREATE FUNCTION app.host_covers_vehicle(p_vehicle_id uuid)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           app.actor_kind() = 'HOST'
           AND p_vehicle_id IS NOT NULL
           AND (app.vehicle_scope() IS NULL OR p_vehicle_id = ANY (app.vehicle_scope()))
           AND EXISTS (SELECT 1
                         FROM core.iam_membership AS m
                         JOIN core.iam_organization AS o ON o.id = m.org_id
                        WHERE m.org_id = app.org_id()
                          AND m.user_id = app.actor_id()
                          AND m.status = 'ACTIVE'
                          AND ((m.role = 'P2P_HOST' AND o.holder_user_id = m.user_id)
                               OR (m.role = 'CO_HOST' AND p_vehicle_id = ANY (m.vehicle_scope)))),
           false)
$fn$;

-- L'acteur est-il le TITULAIRE actif du compte d'hôte de la session (17 §2.3, US-056) ?
-- Un co-hôte ne l'est jamais, quelles que soient ses permissions (RLS-28).
CREATE FUNCTION app.is_org_holder()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT COALESCE(
           app.actor_kind() = 'HOST'
           AND EXISTS (SELECT 1
                         FROM core.iam_organization AS o
                         JOIN core.iam_membership AS m
                           ON m.org_id = o.id AND m.user_id = o.holder_user_id
                        WHERE o.id = app.org_id()
                          AND o.holder_user_id = app.actor_id()
                          AND m.role = 'P2P_HOST'
                          AND m.status = 'ACTIVE'),
           false)
$fn$;

COMMENT ON FUNCTION app.has_staff_role(text, text) IS
  'Politique : rôle interne en cours de l''acteur sur ce pays (portée posée ET attribuée). US-011.';
COMMENT ON FUNCTION app.staff_case_covers(text, uuid) IS
  'Politique : objet couvert par un dossier ouvert assigné à l''acteur OPS / SUPPORT. US-011.';
COMMENT ON FUNCTION app.host_covers_vehicle(uuid) IS
  'Politique : véhicule dans la portée de l''hôte (titulaire : tout ; co-hôte : vehicle_scope). US-011.';
COMMENT ON FUNCTION app.is_org_holder() IS
  'Politique : acteur titulaire actif du compte d''hôte de la session (jamais un co-hôte). US-011.';

REVOKE ALL ON FUNCTION app.has_staff_role(text, text), app.staff_case_covers(text, uuid),
  app.host_covers_vehicle(uuid), app.is_org_holder() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.has_staff_role(text, text), app.staff_case_covers(text, uuid),
  app.host_covers_vehicle(uuid), app.is_org_holder() TO app_api;

GRANT CREATE ON SCHEMA app TO policy_fn_owner;
ALTER FUNCTION app.has_staff_role(text, text) OWNER TO policy_fn_owner;
ALTER FUNCTION app.staff_case_covers(text, uuid) OWNER TO policy_fn_owner;
ALTER FUNCTION app.host_covers_vehicle(uuid) OWNER TO policy_fn_owner;
ALTER FUNCTION app.is_org_holder() OWNER TO policy_fn_owner;
REVOKE CREATE ON SCHEMA app FROM policy_fn_owner;
