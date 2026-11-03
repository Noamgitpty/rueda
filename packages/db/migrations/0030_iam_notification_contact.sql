-- 0030 — IAM : coordonnées d'un destinataire de notification, pour le seul travailleur
-- `ntf_sender`. US-021 ; 17 §2.2 (IAM → NTF), §2.3 (« une politique explicite par travailleur »),
-- §3.1.4 (C2) ; ADR-061. Appliquée sous `migrator`.
--
-- Pourquoi une fonction SECURITY DEFINER : app_worker n'a AUCUN droit sur les tables IAM
-- (US-010, US-011 : tests iam-schema et l0-rls-columns), et doit le rester. L'expéditeur NTF a
-- pourtant besoin, au moment de l'envoi, de l'adresse, du numéro vérifié, de la langue et du
-- prénom du destinataire. La fonction rend ces seules colonnes, pour UN compte, et seulement au
-- travailleur nommé `ntf_sender` ; tout autre appelant reçoit zéro ligne (fail-closed).
--
-- Famille iam_auth (propriétaire NOLOGIN `iam_auth_owner`, qui lit déjà core.iam_user_account
-- par 0022) : aucun droit de table de plus. Liste blanche RLS-15 : security-definer-allowlist.json.
-- Le contexte est lu par current_setting (le propriétaire n'a pas de droit sur le schéma app) avec
-- le même format que app.actor_kind() / app.worker_name() (0002).
--
-- Règles de minimisation :
--   - le numéro n'est rendu que s'il est vérifié (phone_verified_at), sinon NULL ;
--   - l'adresse n'est rendue que si elle est vérifiée (email_verified_at), sinon NULL ;
--   - compte CLOSED, BANNED ou pseudonymisé : zéro ligne (rien à envoyer) ;
--   - ni nom de famille, ni date de naissance, ni pièce.
--
-- Retour arrière : DROP FUNCTION core.iam_notification_contact(uuid);

CREATE FUNCTION core.iam_notification_contact(p_user_id uuid)
  RETURNS TABLE (email text, phone_e164 text, preferred_locale text, first_name text)
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE WHEN u.email_verified_at IS NOT NULL THEN u.email END,
         CASE WHEN u.phone_verified_at IS NOT NULL THEN u.phone_e164 END,
         u.preferred_locale,
         COALESCE(NULLIF(pg_catalog.btrim(u.display_name), ''), u.legal_first_name)
    FROM core.iam_user_account AS u
   WHERE u.id = p_user_id
     AND u.status IN ('ACTIVE', 'RESTRICTED')
     AND u.pseudonymized_at IS NULL
     AND NULLIF(pg_catalog.current_setting('app.actor_kind', true), '') = 'WORKER'
     AND NULLIF(pg_catalog.current_setting('app.worker_name', true), '') = 'ntf_sender'
$fn$;

COMMENT ON FUNCTION core.iam_notification_contact(uuid) IS
  'Coordonnées vérifiées, langue et prénom d''un compte actif, pour le travailleur ntf_sender seulement (0 ligne sinon). SECURITY DEFINER, EXECUTE app_worker. US-021, ADR-061.';

REVOKE ALL ON FUNCTION core.iam_notification_contact(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.iam_notification_contact(uuid) TO app_worker;

-- Propriétaire NOLOGIN de la famille iam_auth (même mécanique que 0022 : CREATE le temps du
-- transfert seulement).
GRANT CREATE ON SCHEMA core TO iam_auth_owner;
ALTER FUNCTION core.iam_notification_contact(uuid) OWNER TO iam_auth_owner;
REVOKE CREATE ON SCHEMA core FROM iam_auth_owner;
