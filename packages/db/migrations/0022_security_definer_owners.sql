-- 0022 — propriétaires NOLOGIN dédiés des fonctions SECURITY DEFINER existantes.
-- US-011 ; 17 §2.3 « Rôles SQL » (un propriétaire NOLOGIN par famille, VERIF_17-B6), ADR-035 ;
-- ADR-053 ; amendement d'ADR-044 ; reports d'ADR-048 (US-006) et d'ADR-052 (US-010, revue
-- sécurité constat 1, MAJEUR). Appliquée sous `migrator`.
--
-- Avant : les fonctions SECURITY DEFINER d'US-006 (triggers d'intégrité) et d'US-010 (commandes
-- d'authentification) appartenaient à `migrator`, propriétaire de toutes les tables, qui peut
-- faire du DDL : un défaut futur d'une de ces fonctions se serait exécuté avec le rôle le plus
-- puissant hors superutilisateur.
-- Après : chaque famille a son propriétaire NOLOGIN, sans membre qui hérite de lui, qui ne possède
-- aucune table, n'a que les droits de table nécessaires et voit les lignes par une politique
-- explicite (il est soumis à FORCE ROW LEVEL SECURITY comme tout le monde) :
--   - integrity_owner : core.booking_assert_rent_payment_operation, booking_assert_conversion_
--     disposition, booking_assert_trip_occupancy (lecture seule de 5 tables) ;
--   - iam_auth_owner  : les 7 commandes core.iam_* (lecture et écritures bornées par colonnes).
--
-- Mécanique (PostgreSQL 16) : l'amorçage accorde chaque propriétaire à `migrator` avec
-- INHERIT FALSE, SET TRUE (ADR-044 amendé) ; `ALTER FUNCTION … OWNER TO` exige en plus que le
-- nouveau propriétaire ait CREATE sur le schéma de la fonction : CREATE est accordé le temps du
-- transfert puis retiré dans cette même transaction (il n'est vérifié qu'au transfert).
-- Les ACL des fonctions sont conservées (le concédant devient le nouveau propriétaire).
--
-- Retour arrière :
--   ALTER FUNCTION <chacune des 10 fonctions> OWNER TO migrator;
--   DROP POLICY integrity_read ON core.booking_vehicle_occupancy, core.booking_checkout_hold,
--     core.booking_trip, core.booking_payment_disposition, core.payment_payment_operation;
--   DROP POLICY iam_auth_select, iam_auth_insert, iam_auth_update ON <tables iam_* ci-dessous>;
--   REVOKE ALL ON <ces tables> FROM integrity_owner, iam_auth_owner;
--   REVOKE USAGE ON SCHEMA core, platform FROM integrity_owner, iam_auth_owner, …;

-- 0. Socle commun des nouveaux propriétaires (0001 l'a fait pour les quatre premiers) ------------
GRANT USAGE ON SCHEMA platform
  TO iam_auth_owner, integrity_owner, cmd_money_owner, cmd_golive_owner;
GRANT EXECUTE ON FUNCTION platform.now()
  TO iam_auth_owner, integrity_owner, cmd_money_owner, cmd_golive_owner;
GRANT USAGE ON SCHEMA core TO iam_auth_owner, integrity_owner;

-- 1. Famille integrity_trigger (ADR-048) : lecture seule ----------------------------------------
-- Les fonctions relisent l'état FINAL de la transaction au COMMIT ; sous les droits de l'appelant
-- la RLS leur cacherait des lignes : d'où SECURITY DEFINER et une politique SELECT USING (true)
-- réservée à ce propriétaire, sans aucun droit d'écriture.
GRANT SELECT (id, kind, active, ref_type, ref_id, vehicle_id)
  ON core.booking_vehicle_occupancy TO integrity_owner;
GRANT SELECT (id, status, converted_trip_id, conversion_operation_id)
  ON core.booking_checkout_hold TO integrity_owner;
GRANT SELECT (id, status, vehicle_id) ON core.booking_trip TO integrity_owner;
GRANT SELECT (operation_id, hold_id, disposition, trip_id)
  ON core.booking_payment_disposition TO integrity_owner;
GRANT SELECT (id, hold_id, purpose, kind, status) ON core.payment_payment_operation TO integrity_owner;

CREATE POLICY integrity_read ON core.booking_vehicle_occupancy FOR SELECT TO integrity_owner USING (true);
CREATE POLICY integrity_read ON core.booking_checkout_hold FOR SELECT TO integrity_owner USING (true);
CREATE POLICY integrity_read ON core.booking_trip FOR SELECT TO integrity_owner USING (true);
CREATE POLICY integrity_read ON core.booking_payment_disposition FOR SELECT TO integrity_owner USING (true);
CREATE POLICY integrity_read ON core.payment_payment_operation FOR SELECT TO integrity_owner USING (true);

GRANT CREATE ON SCHEMA core TO integrity_owner;
ALTER FUNCTION core.booking_assert_rent_payment_operation() OWNER TO integrity_owner;
ALTER FUNCTION core.booking_assert_conversion_disposition() OWNER TO integrity_owner;
ALTER FUNCTION core.booking_assert_trip_occupancy() OWNER TO integrity_owner;
REVOKE CREATE ON SCHEMA core FROM integrity_owner;

-- 2. Famille iam_auth (ADR-052) : droits de table au plus juste des 7 commandes ----------------
-- Lectures : toutes les colonnes lues par les commandes (WHERE, RETURNING, résultats).
GRANT SELECT ON core.iam_user_account, core.iam_email_verification, core.iam_session
  TO iam_auth_owner;
GRANT SELECT (user_id, expires_at) ON core.iam_staff_role_assignment TO iam_auth_owner;
-- Écritures, colonne par colonne (les colonnes d'audit sont posées par défaut ou par trigger).
GRANT INSERT (id, email, password_hash, legal_first_name, legal_last_name, preferred_locale, status)
  ON core.iam_user_account TO iam_auth_owner;
-- email_verified_at et status : vérification d'email ; status sert aussi au verrou FOR SHARE de
-- l'ouverture de session (qui exige un droit UPDATE sur au moins une colonne).
GRANT UPDATE (email_verified_at, status) ON core.iam_user_account TO iam_auth_owner;
GRANT INSERT (id, user_id, email, token_hash, sent_at, expires_at, ip)
  ON core.iam_email_verification TO iam_auth_owner;
GRANT UPDATE (consumed_at) ON core.iam_email_verification TO iam_auth_owner;
GRANT INSERT (id, user_id, token_hash, expires_at, ip, user_agent, mfa_level, created_at)
  ON core.iam_session TO iam_auth_owner;
GRANT UPDATE (revoked_at, revoked_reason) ON core.iam_session TO iam_auth_owner;

-- Politiques par commande SQL (aucune politique DELETE, aucun droit DELETE).
CREATE POLICY iam_auth_select ON core.iam_user_account FOR SELECT TO iam_auth_owner USING (true);
CREATE POLICY iam_auth_insert ON core.iam_user_account FOR INSERT TO iam_auth_owner
  WITH CHECK (status = 'PENDING_EMAIL');               -- un compte naît toujours non vérifié
-- seule écriture admise : la vérification d'email (email_verified_at posé ; PENDING_EMAIL -> ACTIVE,
-- ACTIVE et RESTRICTED inchangés). Un compte CLOSED ou BANNED n'est ni modifiable ni verrouillable
-- (le verrou FOR SHARE de l'ouverture de session ne le voit pas : même résultat NULL qu'avant),
-- et aucune commande ne peut faire passer un compte à CLOSED, BANNED ou PENDING_EMAIL.
CREATE POLICY iam_auth_update ON core.iam_user_account FOR UPDATE TO iam_auth_owner
  USING (status IN ('PENDING_EMAIL', 'ACTIVE', 'RESTRICTED'))
  WITH CHECK (status IN ('ACTIVE', 'RESTRICTED') AND email_verified_at IS NOT NULL);

CREATE POLICY iam_auth_select ON core.iam_email_verification FOR SELECT TO iam_auth_owner USING (true);
CREATE POLICY iam_auth_insert ON core.iam_email_verification FOR INSERT TO iam_auth_owner
  WITH CHECK (consumed_at IS NULL);
CREATE POLICY iam_auth_update ON core.iam_email_verification FOR UPDATE TO iam_auth_owner
  USING (consumed_at IS NULL) WITH CHECK (consumed_at IS NOT NULL);   -- consommation seulement

CREATE POLICY iam_auth_select ON core.iam_session FOR SELECT TO iam_auth_owner USING (true);
CREATE POLICY iam_auth_insert ON core.iam_session FOR INSERT TO iam_auth_owner
  WITH CHECK (revoked_at IS NULL);
CREATE POLICY iam_auth_update ON core.iam_session FOR UPDATE TO iam_auth_owner
  USING (revoked_at IS NULL) WITH CHECK (revoked_at IS NOT NULL);     -- révocation seulement

CREATE POLICY iam_auth_select ON core.iam_staff_role_assignment FOR SELECT TO iam_auth_owner USING (true);

GRANT CREATE ON SCHEMA core TO iam_auth_owner;
ALTER FUNCTION core.iam_cmd_register(uuid, text, text, text, text, text, uuid, bytea, integer, inet)
  OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_cmd_verify_email(bytea) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_auth_lookup(text) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_cmd_open_session(uuid, uuid, bytea, integer, text, inet, text)
  OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_session_resolve(bytea) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_cmd_revoke_session(bytea, text) OWNER TO iam_auth_owner;
ALTER FUNCTION core.iam_cmd_revoke_all_sessions(bytea) OWNER TO iam_auth_owner;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;
