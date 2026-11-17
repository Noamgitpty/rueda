# ADR-157 — Parties des notifications de réservation lues en base, confirmation et demandes

- **Statut** : PROPOSÉ (US-213, agent back-end, claude-opus-5-5, 2026-11-17). Revues exigées : celles de `check-story-reviews.mjs` (revue design OUI pour US-213). Le `SECURITY DEFINER` et les rôles se revoient sur un autre modèle que l'auteur. À reporter dans 17 §4.5 (contrat de charge utile des événements lus par NTF) et dans 10b §4.3 (clés `ntf.*` et `web.s07.*` v73).
- **Complète** : ADR-061 (moteur NTF, point 9 « extensions de charge utile »), ADR-146 (mode `REQUEST`), ADR-149 (partie d'un trip jugée en base, titulaire du compte d'hôte), ADR-152 (S07 servi par la route de S06).
- **Sources** : 19 US-213 (critères 1 et 2) ; 16 BKG-022, NTF-007 / NTF-011 ; 10b S07, §4.3 ; 17 §2.2 (NTF --> CFG seulement), §3.2.1 ; BOARD N-203, N-216, N-243, N-247 ; GL-22.

## Contexte

ADR-061 attendait des producteurs qu'ils ajoutent `guest_user_id` et `host_user_id` aux charges utiles. Ils ne l'ont jamais fait :

- `booking.trip.booked` (0126) porte `trip_id`, `hold_id`, `vehicle_id`, `org_id` et `scheduled_*` ;
- `trip.status_changed` (0099, 0124) porte `trip_id`, `from`, `to`, `reason` et `settlement_id` ;
- `booking.request.*` (0126) porte `hold_id`, `vehicle_id` et `org_id`.

Les règles `EVT_BOOKING_CONFIRMED` et `EVT_BOOKING_CANCELLED` levaient donc une erreur de contrat (lettre morte et alerte) à chaque réservation et à chaque annulation. Aucun message ne serait parti.

Enrichir les charges utiles aurait obligé à recopier `core.booking_convert_payment`, la machine à états des trips et les fonctions des demandes. Ce sont des fonctions d'argent et de concurrence, longues et déjà revues.

NTF ne lit ni les tables d'AVL ni celles d'IAM (17 §2.2).

## Décision

1. **Parties lues en base par un port** (migration 0131) :
   - **Fonction** : `core.booking_notification_parties(sujet, id)` (`cmd_hold_owner`, `SECURITY DEFINER`, EXECUTE `app_worker`). Elle refuse tout appelant autre que le travailleur `ntf_dispatcher` (`notification_parties_forbidden`, 42501 → `FORBIDDEN`).
   - **Sujet `TRIP`** : voyageur et **titulaire** du compte d'hôte (`organization.holder_user_id`, comme le contrat, ADR-149).
   - **Sujet `HOLD`** : les mêmes, plus le type, le statut, le motif de libération et la présence d'une heure limite de réponse.
   - **Sujet inconnu** : NULL.
   - **Minimisation** : identifiants et codes seulement, aucun droit nouveau sur une table.
   - **Côté code** : le port `NotificationParties` appartient à NTF. AVL le réalise avec l'adaptateur `postgresNotificationParties`, qui a la même forme par typage structurel : AVL ne dépend pas de NTF. La racine de composition (`worker-tasks.ts`) les relie.
2. **La base fait foi.** Une règle peut déclarer `parties` (sujet, champ, condition `when` sur les faits). Ses destinataires viennent alors des faits lus dans la transaction du reçu :
   - une charge utile qui désigne une autre personne donne une erreur de contrat ;
   - un port absent ou un sujet inconnu donne aussi une erreur de contrat, jamais un destinataire deviné ;
   - la condition de statut de la charge utile est évaluée **avant** la lecture : un `trip.status_changed` non déclenchant ne lit rien.
3. **Un texte par rôle.** Il y a deux confirmations au passage `BOOKED` :
   - `EVT_BOOKING_CONFIRMED` (voyageur) : adresse exacte et contrat à signer dans la réservation, permis physique et pièce d'identité à présenter, conseils de sécurité de `web.s07.safety`, jamais le téléphone de l'hôte (messagerie, US-316) ;
   - `EVT_BOOKING_CONFIRMED_HOST` (hôte) : paiement reçu par Kmino, contrôle du permis à la remise, **aucune donnée du voyageur**.
4. **Demandes de réservation** (mode `REQUEST`, encore fermé par `booking_request_mode_enabled` = false) :
   - `booking.request.received` : l'hôte reçoit l'heure limite de la base ;
   - `booking.request.declined` et `.expired` : le voyageur apprend qu'aucun débit n'a eu lieu et que l'autorisation est annulée ;
   - `booking.request.capture_unconfirmed` : le voyageur et l'hôte sont prévenus ;
   - capture refusée d'une demande acceptée (`booking.hold.released`, faits lus en base : hold `REQUEST` autorisé, `RELEASED`, `PAYMENT_DECLINED`, même définition que l'état `CAPTURE_FAILED` de 0126) : le voyageur et l'hôte sont prévenus (N-247) ;
   - l'acceptation n'a pas de message propre : la confirmation suit au passage `BOOKED`, comme chez Turo (PROPOSÉ, `docs/team/COMME_TURO.md`).
5. **Référence courte** : ce sont les 8 **premiers** caractères de l'identifiant, comme S06, S07, A03, A05 et le contrat (`K-…`) :
   - confirmation et annulation : la référence du trip ;
   - demandes : celle du hold.
     S06 confirmé montre désormais le numéro du trip.
6. **Messages critiques** (le SMS part même au-delà du plafond, US-052) : les confirmations, la demande reçue (elle a une heure limite) et la réservation non confirmée. Le refus et l'expiration ne le sont pas.
7. **S06 confirmé** (10b S07) : titre `web.s07.title`, numéro du trip, `web.s07.documents`, `web.s07.safety`. L'adresse exacte reste sur la fiche du véhicule.
8. **Catalogue v73** (la v72 est réservée à US-215c).

## Conséquences

- L'annulation (`EVT_BOOKING_CANCELLED`) trouve aussi ses destinataires.
- Une lecture de plus par événement abonné (une ligne, par clé primaire), y compris pour chaque `booking.hold.released`. Elle est sans effet sur le chemin de l'argent : la lecture se fait dans la transaction du reçu NTF, pas dans celle de la conversion.
- Liste blanche RLS-15 : une entrée. `errors.ts` : `notification_parties_forbidden`. Le double de l'e2e donne aux trips un préfixe fixe, pour que le numéro du trip soit stable dans les captures.
- Non couvert (suites, GL-36) :
  - lien absolu vers le contrat (S09) et PDF joint : il faut une origine web publique du travailleur et des pièces jointes dans le port `MessagingChannel`, avec le canal réel du lot C ;
  - constancia (US-212) ;
  - numéros du support et de l'assistance de l'assureur (données du fondateur et du contrat de l'assureur) ;
  - co-hôtes (seul le titulaire est prévenu) ;
  - lien de la notification d'annulation vers S10 (224d) ;
  - avis de l'issue de la revue d'une réservation signalée (GL-17, N-172, `booking.hold.review_decided`) : le même port s'y prêtera.
