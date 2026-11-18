# ADR-156 — Séparation des tâches sur les cinq dernières entrées de la console ; avis du voyageur à la pose et à la levée de la restriction de son hôte

- **Statut** : PROPOSÉ (US-215, partie 215c, agent de story back-end, claude-opus-5-5, 2026-11-17). Revues exigées : celles de `check-story-reviews.mjs` ; `SECURITY DEFINER`, RLS et rôles sur un autre modèle que l'auteur. À reporter dans 17 §2.3 et §4.5.
- **Amende** : ADR-124 (point 1 « Non gardées, suivi » ; point 6, F2-T-02) et, par lui, ADR-122 (« quelle que soit l'action »).
- **Sources** : BOARD N-116, N-123, N-126 (revues d'US-122, passe n° 2, PR #152) ; 17 §2.3 (« un agent ne décide pas sur son propre dossier », RLS-24) ; 08 BR-TRUST-09 ; 19 US-122 critère 4 ; migration 0132.

## Contexte

ADR-124 a étendu la garde unique `core.support_actor_conflict` (ADR-122) aux entrées de la console qui décident un sujet. Il a laissé cinq entrées hors de la garde, comme suite : la fiche 360°, la note interne, l'ouverture d'un dossier de support, le changement de son état et la porte des lectures C3. Un agent pouvait donc lire sa propre fiche 360°, écrire une note sur lui-même ou ouvrir un dossier pour lui-même. Ce dossier le « couvrait » ensuite pour sa propre fiche.

La restriction d'un hôte (F2-T-02) prévenait le voyageur à chaque pose. Une restriction d'une seconde sorte (`TS_HOLD` puis `POLICY_VIOLATION`) envoyait donc un second avis. La levée n'en envoyait aucun : le voyageur restait sur l'avis d'examen.

Enfin, la fiche servait `hostTrips` depuis 0097, mais la console ne l'affichait pas (N-123).

## Décision

1. **Garde sur les cinq entrées (N-116)**. Chacune appelle `core.support_actor_conflict` avant toute lecture ou écriture du sujet, pour tous les rôles, ADMIN compris :

   | Entrée                                 | Sujet jugé                                                                                          |
   | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
   | `support_staff_profile` (fiche 360°)   | `USER_ACCOUNT` de la fiche                                                                          |
   | `support_staff_add_note`               | `USER_ACCOUNT` de la note                                                                           |
   | `support_staff_open_case`              | `USER_ACCOUNT` du demandeur                                                                         |
   | `support_staff_set_case_status`        | `SUPPORT_CASE` (demandeur et parties de son trip)                                                   |
   | `iam_staff_cmd_data_access` (porte C3) | `SUPPORT_CASE` du dossier ET sujet lu ; `USER` est lu comme `USER_ACCOUNT` ; type inconnu = conflit |

   Le refus a l'issue `SELF_FORBIDDEN`. Il est journalisé `STAFF_FORBIDDEN` avec `reason` = `SELF`, et rien n'est écrit : ni ligne d'accès, ni note, ni dossier, ni changement d'état. Le refus passe avant la couverture : un agent ne s'ouvre plus de dossier pour se couvrir.

   L'API rendait déjà 403 `STAFF_SELF_FORBIDDEN` pour cette issue (`refusalOf`, texte `common.ops.selfForbidden` existant, quatre langues). Le contrat OpenAPI l'ajoute à `POST /console/cases` (réponse `StaffForbiddenOrSelf`). La porte C3 rend `SELF_FORBIDDEN` à `StaffDataAccessDenied`, et une issue inconnue y reste un refus. Aucune route n'appelle encore cette porte.

   Les cas légitimes sont inchangés : seuls les blocs marqués US-215c changent dans les définitions recopiées de 0097, 0064 et 0051.

2. **Avis du voyageur (N-126), PROPOSÉ**.
   - **Pose** : l'avis `booking.trip.host_restricted` part seulement quand la personne passe de « aucune restriction active » à « restreinte ».
   - **Levée** : la levée de la **dernière** restriction active émet `booking.trip.host_restriction_lifted`, un événement par trip à venir (BOOKED, CHECKIN_OPEN) des comptes d'hôte de la personne. La charge est celle de la pose (`trip_id`, `guest_user_id`, `org_id`), sans motif. L'événement vient de `core.booking_notify_host_restriction_lifted` (cmd_hold_owner, EXECUTE iam_auth_owner). La politique `cmd_hold_trip_notice_ins` admet ce second type.
   - **Rendu** : gabarit NTF `EVT_TRIP_HOST_RESTRICTION_LIFTED` (e-mail puis SMS, message de trip). Les textes `ntf.tripHostRestrictionLifted.*` sont en es, en, fr et pt-BR (catalogue v72) : l'examen est terminé et la réservation tient. Ils ne promettent rien de plus.
   - **Ordre** : les poses et levées d'une même personne sont sérialisées par un verrou consultatif de la personne, pris avant le verrou de la sorte.

3. **`hostTrips` à l'écran (N-123)**. La fiche 360° de la console ajoute le tableau « Trips à venir comme hôte » (`backoffice.profile.hostTrips` et `noHostTrip`, quatre langues). Il montre l'identifiant court du trip et du compte d'hôte, l'état et le début. Il n'affiche jamais le voyageur.

## Conséquences

- La formule d'ADR-122 « quelle que soit l'action » vaut pour toute la console. Exception : `support_staff_evidence_permitted` (dépôt d'une pièce par le staff), autorisation seule, sans lecture : elle reste hors de la garde (suite).
- Une story qui ajoute une entrée de console ou un type de sujet appelle la garde et ajoute sa branche dans `core.support_subject_parties`.
- Un voyageur reçoit un avis par passage « libre → restreint » et un par passage « restreint → libre ».
- Aucune décision produit nouvelle pour le fondateur. L'avis de levée prolonge BR-TRUST-09 (« prévenir les voyageurs concernés »).
- Renvois à reporter : 17 §2.3 (cinq entrées gardées) ; 17 §4.5 (`booking.trip.host_restriction_lifted`).

## Retour arrière

Voir l'en-tête de la migration 0132 (définitions à réappliquer, politique à rétablir, fonction à supprimer). Côté code : retirer le gabarit et la règle NTF, les textes v72 et le tableau de la fiche.
