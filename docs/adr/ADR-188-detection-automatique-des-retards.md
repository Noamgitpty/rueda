# ADR-188 — Détection automatique des retards : seuil figé à la réservation, une alerte par dossier, prolongation tacite bornée et trip suivant à risque

- **Statut** : PROPOSÉ (US-305, agent de story, rôle back-end, claude-opus-5-5, 2026-11-20). Revues exigées : celles de `node scripts/ci/check-story-reviews.mjs` (code, architecture, sécurité, argent, qa) ; RLS / rôles, `SECURITY DEFINER` et concurrence sur un autre modèle que l'auteur.
- **Complète** : ADR-126 (machine à états SM-1, transitions gardées et journalisées ; la paire IN_PROGRESS → OVERDUE existe depuis 0099), ADR-183 (remise et retour ; fin effective = première ligne `RETURNED` du journal d'état), ADR-061 / ADR-157 (catalogue des notifications), ADR-080 (port d'alerte de l'exploitation).
- **Sources** : 19 US-305 ; 16 TRP-035 ; 08 BR-RETURN-03, BR-BOOK-05, SM-1 ; 11 EC-17, EC-18, EC-19 ; 17 §2.5 (« Retard et prolongation tacite », C10, ordre des verrous), §3.2.4 (`trip.at_risk_reason`), §3.2.10 (`overdue_case`), §4.5 (`trip.overdue.detected`), §7.2 (`overdue_detection_minutes`, `overdue_occupancy_step_minutes`, `buffer_minutes`) ; 22 OQ-BR-04, OQ-BR-39 ; pré-mortem du lot 3 (L3-PM-09, L3-PM-13, L3-PM-15, L3-PM-16, L3-PM-55 ; RT-L3-NS04, RT-L3-NS05 ; N-19).

## Contexte

Depuis US-315, un trip réel va de BOOKED à RETURNED ; rien ne voyait encore qu'un véhicule n'était pas rendu. Le pré-mortem du lot 3 redoute un `OVERDUE` à 10:29 au lieu de 10:30, plusieurs alertes (minuterie rejouée, deux travailleurs), l'heure de l'appareil, le fuseau de Panamá appliqué au Paraguay et C10 toujours sans test (L3-PM-15, N-19) ; un créneau suivant vendu pendant un retard (L3-PM-13).

## Décision

1. **Un écrivain** : le travailleur pg-boss `trip_overdue` (tâche périodique, 60 s, PROPOSÉ : 16 TRP-035 « chaque minute »). La base liste les trips à traiter (`core.trip_overdue_due`, lot borné) ; chaque trip est traité dans sa propre transaction par `core.trip_cmd_detect_overdue` (SECURITY DEFINER, `cmd_hold_owner`, EXECUTE au seul `app_worker`, refus sous tout autre nom de travailleur). Un trip en échec ne bloque pas les suivants ; l'échec est alerté (`TRIP_OVERDUE_FAILED`, P1, par code d'erreur).
2. **Verrous et heure** : verrous consultatifs du voyageur puis du véhicule (ordre global de 17 §2.5, celui de la remise et de la conversion), ligne du trip `FOR UPDATE`, puis heure **serveur** (`platform.now()`) lue après l'attente. Un retour validé pendant l'attente est vu (`RETURNED` ⇒ `SKIPPED`) ; aucune heure ne vient d'un appareil ni d'un champ reçu.
3. **Seuil** : `overdue_detection_minutes` du pays **en vigueur à la réservation** (`booked_at`), conformément à 16 TRP-035 (« seuls les trips réservés ensuite l'appliquent ») ; défaut 30 (OQ-BR-04, OQ-BR-39 : `grace_minutes` + 1). Absent ⇒ `PARAM_MISSING`, rien n'est deviné, l'ops est alertée. Un trip `IN_PROGRESS` dont `platform.now()` ≥ fin prévue + seuil passe `OVERDUE` (motif `OVERDUE_DETECTED`) par `core.booking_trip_apply_transition` (0099, inchangée : journal, `trip.status_changed`). Le fuseau du pays ne sert qu'à l'affichage (NTF) : la détection compare des instants.
4. **Une alerte par trip** : le dossier `trip_ops_overdue_case` (17 `overdue_case`, unique par trip, étape `T30M`) est ouvert dans la même transaction ; l'événement `trip.overdue.detected` (`trip_id`, `stage`, `guest_user_id`, `host_user_id`, `scheduled_end`, `detected_at`) n'est écrit qu'à cette ouverture. Minuterie rejouée, deux travailleurs, trip déjà OVERDUE : aucun second événement. Le voyageur et l'hôte sont prévenus par NTF (`EVT_TRIP_OVERDUE`, SMS d'abord) ; l'ops par le consommateur `trip_overdue_alert` (`TRIP_OVERDUE_DETECTED`, P2), une alerte par événement dans la transaction du reçu de l'inbox.
5. **Prolongation tacite** (17 §2.5, F21) : à l'entrée en OVERDUE, puis chaque fois que la prolongation précédente est épuisée, la période de l'occupation TRIP devient `[début, now() + overdue_occupancy_step_minutes + buffer_minutes)` (défauts 60 et 120), jamais raccourcie. Si une occupation active suivante du véhicule (hold, trip, blocage, tampon) commence avant, la période s'arrête à son début : jamais de chevauchement (l'exclusion GiST tient ; la pose concurrente d'un hold attend le verrou du véhicule, puis est refusée `VEHICLE_UNAVAILABLE` sur la période prolongée).
6. **Trip suivant à risque** (C10, EC-19) : si l'occupation qui borne est un TRIP pas encore commencé, il reçoit `at_risk_reason` = `PREVIOUS_OVERDUE` une fois et `trip.at_risk.flagged` part : l'hôte est prévenu (`EVT_TRIP_AT_RISK_HOST`, es / en / fr / pt-BR, catalogue v103) et l'ops alertée (`TRIP_NEXT_AT_RISK`, P1 : relogement ou annulation selon BR-CXL, par l'ops). Un hold qui borne est revu à chaque passage : converti en trip, ce trip est marqué au passage suivant.
7. **Argent** : aucun montant, aucune écriture d'argent, aucun `release_at`. Le frais de retard (BR-RETURN-03 ; `lateFee` = max(grille, extension), OQ-BR-04) est porté par US-703 (débit séparé), qui lit le dossier (fin prévue, seuil appliqué, heure de détection) et la fin effective (ADR-183).
8. **Droits** : le dossier n'est lisible ni écrivable par aucun rôle applicatif ; `cmd_hold_owner` l'écrit sous le seul travailleur `trip_overdue` ; ses faits figés (trip, pays, fin prévue, seuil, détection, étape) ne sont jamais réécrits et la prolongation ne recule jamais (garde `trip_overdue_case_guard`). Politiques ajoutées à `cmd_hold_owner` sous ce même nom : transition IN_PROGRESS → OVERDUE et marque « à risque » (`cmd_trip_overdue_upd`), période de l'occupation TRIP d'un trip OVERDUE, toujours active (`cmd_trip_overdue_occ_upd`), ses deux événements (`cmd_trip_overdue_event_ins`), le seuil et le pas (`cmd_hold_overdue_param_read`). Aucun interrupteur lu ni écrit ; aucune constante de pays.

## Écarts PROPOSÉS à 17

- `overdue_case` porte aussi la fin prévue, le seuil appliqué, la fin de la prolongation tacite (`use_until`, `occupancy_until`, `bounded`) et le trip suivant marqué (`next_trip_id`) ; `actions`, `gps_requested_at` et `police_report_ref` arrivent avec l'escalade (US-306, US-318). Identifiant tiré par `gen_random_uuid()`.
- `trip.at_risk.flagged` : événement nouveau, à reporter dans 17 §4.5 (consommateurs NTF et l'alerte de l'ops).
- `trip.overdue_at` de 16 TRP-035 : l'heure de détection vit dans le dossier (`detected_at`) et la ligne OVERDUE du journal d'état, pas dans une colonne du trip.
- La garde de `core.booking_cmd_trip_transition` vers OVERDUE (0099, sans appelant de production) lit encore le seuil en vigueur à l'instant ; elle n'est pas utilisée par la détection.

## Options écartées

- Minuterie pg-boss **par trip** posée à la remise : elle se perd si la fin change (extension, US ultérieure) ou si la remise se fait hors du chemin nominal ; la liste relue chaque minute par la base est idempotente et rattrape un travailleur arrêté.
- Seuil lu à l'instant de la détection : un changement publié s'appliquerait aux trips déjà réservés, contraire à 16 TRP-035.
- Prolonger l'occupation jusqu'à la fin du retard « inconnue » (période ouverte) : le véhicule serait invendable sans borne et l'exclusion refuserait le trip suivant sans alerte ; le pas de 60 min et la borne au trip suivant suivent 17 §2.5.
- Déplacer ou annuler le trip suivant automatiquement : décision de l'ops (BR-CXL), jamais de la base ; « jamais plus lourd que Turo ».
- Alerte de l'ops envoyée par le travailleur après la validation : perdue si l'envoi échoue après le COMMIT ; le consommateur de l'outbox la rejoue jusqu'à succès, dédupliquée par le reçu.

## Conséquences

- C10 est enfin éprouvé (N-19) : `test/l0/l0-us305-overdue.test.ts`, au Panama (USD) et au Paraguay (PYG), à deux connexions dans les deux ordres.
- Suites : escalade T2H / T6H / T24H et `UNRETURNED` (US-306, US-523) ; vue des retards (US-306) ; frais de retard (US-703) ; prolongation demandée par le voyageur (une extension approuvée efface le retard, BR-RETURN-03) ; rappel H−2 `EVT_RETURN_REMINDER` ; occupation du voyageur non prolongée (17 ne la prévoit pas).
- Retour arrière : voir l'en-tête de la migration 0168.
