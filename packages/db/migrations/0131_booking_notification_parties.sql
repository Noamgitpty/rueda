-- 0131 — AVL / NTF : parties d'une réservation lues par le travailleur des notifications.
-- US-213 (confirmation de réservation) ; 19 US-213 (critère 2 : « la confirmation est envoyée au
-- voyageur et à l'hôte […] sans doublon si l'événement est rejoué ») ; 16 BKG-022, NTF-007
-- (`EVT_BOOKING_CONFIRMED`, voyageur et hôte) ; 17 §2.2 (NTF ne lit pas les tables d'IAM ni
-- d'AVL : les destinataires viennent d'un port fourni par le module producteur), §4.5 ; ADR-061
-- point 9 ; ADR-157 (cette migration). Suites du BOARD : N-203, N-216, N-247.
-- Appliquée sous `migrator`, en une transaction.
--
-- Constat : les producteurs de `booking.trip.booked` (0126), `trip.status_changed` (0099, 0124) et
-- `booking.request.*` (0126) ne portent ni `guest_user_id` ni `host_user_id` (extensions NTF
-- d'ADR-061, jamais ajoutées) : les règles de confirmation et d'annulation du catalogue NTF levaient
-- une erreur de contrat (lettre morte et alerte), aucune notification ne partait. Plutôt que de
-- recopier les fonctions d'argent et de conversion pour enrichir leurs charges utiles, cette
-- migration AJOUTE une fonction de LECTURE (aucune écriture, aucune table, aucun droit sur une
-- table) :
--   `core.booking_notification_parties(text, uuid)` (cmd_hold_owner, EXECUTE app_worker) : pour le
--   seul travailleur `ntf_dispatcher` (`app.actor_kind` = WORKER), les parties d'un trip (`TRIP`)
--   ou d'un hold (`HOLD`) : voyageur, TITULAIRE du compte d'hôte (`organization.holder_user_id`,
--   comme le contrat, 0122) ; pour un hold, son type, son statut, son motif de libération et la
--   présence d'une heure limite de réponse (demande autorisée, 0126). Identifiants et codes
--   seulement : aucun nom, aucune coordonnée (lues à l'envoi par `core.iam_notification_contact`,
--   0031), aucune pièce, aucun montant. Sujet inconnu ou identifiant absent : NULL (NTF le traite
--   comme une erreur de contrat). Tout autre appelant : refus `notification_parties_forbidden`.
--
-- Droits : aucun nouveau. `cmd_hold_owner` lit déjà `booking_trip` (`guest_user_id` 0097, `org_id`
-- 0032), `booking_checkout_hold` (`guest_user_id`, `org_id`, `kind`, `status` 0037,
-- `release_reason` 0119, `request_respond_by` 0126) et `iam_organization.holder_user_id` (0037),
-- par ses politiques `cmd_hold_*` existantes. Aucun interrupteur lu ni écrit ; aucune constante
-- de pays.
--
-- Expand / contract : fonction AJOUTÉE seulement.
--
-- Retour arrière :
--   DROP FUNCTION core.booking_notification_parties(text, uuid).

GRANT CREATE ON SCHEMA core TO cmd_hold_owner;
SET LOCAL ROLE cmd_hold_owner;

CREATE FUNCTION core.booking_notification_parties(p_subject text, p_id uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  r record;
BEGIN
  IF app.actor_kind() IS DISTINCT FROM 'WORKER'
     OR app.worker_name() IS DISTINCT FROM 'ntf_dispatcher' THEN
    RAISE EXCEPTION 'notification parties: forbidden'
      USING ERRCODE = 'insufficient_privilege', CONSTRAINT = 'notification_parties_forbidden';
  END IF;
  IF p_subject = 'TRIP' THEN
    SELECT t.guest_user_id AS guest, o.holder_user_id AS host
      INTO r
      FROM core.booking_trip AS t
      JOIN core.iam_organization AS o ON o.id = t.org_id
     WHERE t.id = p_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    RETURN pg_catalog.jsonb_build_object('guestUserId', r.guest, 'hostUserId', r.host);
  ELSIF p_subject = 'HOLD' THEN
    SELECT h.guest_user_id AS guest, o.holder_user_id AS host, h.kind, h.status, h.release_reason,
           h.request_respond_by IS NOT NULL AS responded
      INTO r
      FROM core.booking_checkout_hold AS h
      JOIN core.iam_organization AS o ON o.id = h.org_id
     WHERE h.id = p_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    RETURN pg_catalog.jsonb_build_object('guestUserId', r.guest, 'hostUserId', r.host,
                                         'holdKind', r.kind, 'holdStatus', r.status,
                                         'releaseReason', r.release_reason,
                                         'requestAuthorized', r.responded);
  END IF;
  RETURN NULL;
END
$fn$;
COMMENT ON FUNCTION core.booking_notification_parties(text, uuid) IS
  'Parties d''un trip (TRIP) ou d''un hold (HOLD) pour le travailleur ntf_dispatcher : voyageur, '
  'titulaire du compte d''hôte ; pour un hold, type, statut, motif de libération, demande '
  'autorisée. Identifiants et codes seulement. SECURITY DEFINER, EXECUTE app_worker. US-213 '
  '(ADR-157).';
REVOKE ALL ON FUNCTION core.booking_notification_parties(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.booking_notification_parties(text, uuid) TO app_worker;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM cmd_hold_owner;
