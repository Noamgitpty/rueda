# TRP — Trip operations (`apps/api/src/modules/trp`)

**TRP — Trip operations** : check-in, check-out, inspections, hors ligne, retards et non-restitution. Dépendances autorisées : AVL, KYC, PAY, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 TRP --> AVL, AUD).

## Responsabilité

TRP gère la remise et le retour du véhicule entre particuliers (17 §2.2, §2.11) :

- ouverture du check-in à T−24 h, bloqué tant que la preuve de paiement n'est pas reçue ;
- check-in et check-out par l'hôte et le voyageur : photos guidées, compteur, carburant, clés, signature ;
- mode hors ligne : file locale, horodatage appareil et serveur, écart de plus de 2 h signalé ;
- retard (`OVERDUE` 30 min après la fin) et escalade de non-restitution ;
- refus du véhicule et liste des remises du jour de l'hôte.

TRP ne change pas lui-même l'état du trip : il demande les transitions SM-1 à AVL. La table du trip (`core.booking_trip`, migration 0004) appartient à AVL.

État réel du code : **photos guidées de l'état du véhicule** (US-303, ADR-179, migration 0158) et **remise et retour entre particuliers** (US-315, ADR-183, migration 0163 : ouverture, contrôle du permis, validations, passages IN_PROGRESS et RETURNED) et **détection automatique des retards** (US-305, ADR-188, migration 0168). Le reste arrive avec US-306 (vue des retards et escalade), US-307 (refus et no-show) et US-524 (hors ligne) ; les routes des frais annexes (US-706) sont ici, leurs règles en base (CLM, 0177).

### Photos d'état (US-303)

- Routes (`internal/inspection/inspection.controller.ts`, `SessionGuard` puis `TermsGuard`) : `GET /trips/{tripId}/inspections/{kind}` (gabarit, bornes du pays, les deux séries), `POST …/captures` (jeton de capture d'un angle, 120 s, usage unique), `POST …/photos` (photo de la caméra de l'application, base64 dans le corps JSON borné), `POST …/submit` (validation : gabarit complet, sinon 422 `PHOTO_TEMPLATE_INCOMPLETE` et `missing`). `kind` : `checkin` ou `checkout`.
- Envoi, fail-closed : source `CAMERA` et jeton valide (sinon `PHOTO_GALLERY_FORBIDDEN`), jugés par la base AVANT tout traitement ; ports branchés (sinon 503) ; taille ≤ `photo_max_kb` et limite JSON, type réel JPEG / WebP, côté ≤ `photo_max_px` (contrôles d'AUD) ; empreinte reçue = empreinte de l'appareil ; antivirus `CLEAN` ; puis une transaction : clé USER de la personne (coffre), commande d'ajout (`file_asset` PRIVATE_EVIDENCE C2, photo, heure serveur), chiffrement, dépôt en création seule.
- Base (0158, `cmd_hold_owner`, EXECUTE `app_api`) : `core.trip_inspection_view`, `core.trip_cmd_open_photo_capture`, `core.trip_photo_capture_check`, `core.trip_cmd_add_inspection_photo`, `core.trip_cmd_submit_inspection` ; tables sans aucun droit applicatif.
- Ports (`internal/inspection/ports.ts`) : `EvidenceScanner` (forme `UploadScanner`), `EvidenceVault`, `EvidenceFileStore` ; production : indisponibles (ClamAV DEC-FONDATEUR-20, KMS et stockage à verrou objet US-003, Q-007) ⇒ envoi 503. Adaptateurs : `postgresTrpAdapters(pool)`.
- Hors périmètre (suites) : lecture du contenu des photos (dossier de preuve, US-308), comparaison côte à côte (A04, US-315), co-hôte, file hors ligne (US-524), URL de dépôt signée (lot C).

### Remise et retour (US-315)

- Routes (`internal/handover/handover.controller.ts`, `SessionGuard` puis `TermsGuard`) : `GET /trips/{tripId}/handover/{direction}` (état, conditions relues par la base, contrôle du permis, séries, validations, heure de fin ; à l'hôte au départ : prénom, initiale du nom, année de naissance du voyageur), `POST …/checkin/open` (BOOKED → CHECKIN_OPEN, au plus tôt 24 h avant le début), `POST …/checkin/identity` (six points de VER-015, hôte seul), `POST …/{direction}/validate` (relevés, en personne ; la seconde validation fait la transition). `direction` : `checkin` ou `checkout`. Aucune heure reçue du client (clé inconnue ⇒ 400).
- Conditions de la remise, relues par la base à l'ouverture et à chaque validation du départ : paiement prouvé par webhook signé, contrat signé, caution décidée (autorisée si exigée), `insurer_contract_active`, éligibilité du voyageur, hôte non restreint (`CHECKIN_PAYMENT_NOT_CONFIRMED`, `CONTRACT_NOT_SIGNED`, `DEPOSIT_NOT_READY`, `INSURER_CONTRACT_INACTIVE`, `HANDOVER_BLOCKED`).
- Base (0163, `cmd_hold_owner`, EXECUTE `app_api`) : `core.trip_handover_view`, `core.trip_cmd_open_checkin`, `core.trip_cmd_identity_check`, `core.trip_cmd_validate_handover` ; verrous du voyageur puis du véhicule ; transition par `core.booking_trip_apply_transition` (0099) ; tables sans aucun droit applicatif, en ajout seul.
- **Fin effective du trajet** (source unique, lue par la caution et par US-708) : heure de la première ligne `RETURNED` de `core.booking_trip_state_log`, écrite par la seconde validation du retour ; début effectif : `booking_trip.checkin_validated_at`. Ce module n'écrit aucun `release_at`.
- Remise sans rencontre : jamais proposée ni acceptée (`CONTACTLESS_UNAVAILABLE`, OQ-P2P-05). Aucune file hors ligne : base injoignable ⇒ 503 `HANDOVER_UNAVAILABLE`.
- Hors périmètre (suites) : frais de carburant et de nettoyage (US-706, critère 5 d'US-315 : livré, voir « Frais annexes »), refus et photo-preuve (US-307), libération de la jambe HOST (US-708), co-hôte, minuterie d'ouverture, notifications EVT_CHECKIN_DONE / EVT_CHECKOUT_DONE.

### Retards (US-305)

- Travailleur `trip_overdue` (tâche périodique pg-boss, 60 s ; `internal/overdue/overdue-detection.ts`, déclaré par `registerOverdueDetection` dans `apps/api/src/worker-tasks.ts`) : `core.trip_overdue_due` liste les trips à traiter, puis `core.trip_cmd_detect_overdue` traite un trip par transaction (verrous du voyageur puis du véhicule, heure serveur lue après les verrous). Aucune route, aucun écran (16 TRP-035 : `SYSTEM`).
- Seuil : `overdue_detection_minutes` du pays **en vigueur à la réservation** (défaut 30, OQ-BR-04) ; à 10:29 rien, à 10:30 `IN_PROGRESS → OVERDUE` (motif `OVERDUE_DETECTED`, transition de 0099), dossier `trip_ops_overdue_case` (étape `T30M`, fin prévue et seuil figés) et **un seul** `trip.overdue.detected` (à l'ouverture du dossier). Un trip rendu n'est jamais touché.
- Alertes : voyageur et hôte par NTF (`EVT_TRIP_OVERDUE`) ; ops par le consommateur `trip_overdue_alert` (`TRIP_OVERDUE_DETECTED` P2, `TRIP_NEXT_AT_RISK` P1), une par événement dans la transaction du reçu ; détection en échec : `TRIP_OVERDUE_FAILED` (P1).
- Prolongation tacite (17 §2.5) : occupation TRIP portée à `[début, now() + overdue_occupancy_step_minutes + buffer_minutes)`, renouvelée quand elle est épuisée, jamais raccourcie, bornée au début de l'occupation suivante du véhicule (aucun chevauchement) ; si c'est un trip pas encore commencé, il est marqué à risque (`at_risk_reason` = `PREVIOUS_OVERDUE`) une fois et `trip.at_risk.flagged` part (hôte : `EVT_TRIP_AT_RISK_HOST`) ; un hold qui borne est revu à chaque passage (C10).
- Aucun montant, aucune écriture d'argent, aucun `release_at` : le frais de retard est porté par US-703 (débit séparé), qui lit le dossier et la fin effective.
- Hors périmètre (suites) : escalade T2H / T6H / T24H et `UNRETURNED` (US-306, US-523), vue des retards (US-306), extension demandée par le voyageur, rappel H−2 (`EVT_RETURN_REMINDER`).

### Escalade de non-restitution par l'ops (US-306)

- Action de console `ESCALATE_OVERDUE` (cadre d'US-101, `POST /console/actions`, permission `ops.force_terminate_trip` dans le pays du trip, session TOTP, garde de séparation des tâches d'ADR-122 / ADR-177) liée à `core.trip_manual_action_escalate_overdue` (0173, `cmd_hold_owner`, EXECUTE `iam_staff_owner` seulement) ; saisie fermée `escalationStep` ∈ {`CONTACT`, `FORMAL_NOTICE`, `POLICE_REPORT`} (étapes `T2H`, `T6H`, `T24H` du dossier).
- Une étape à la fois, dans l'ordre (`OVERDUE_STEP_OUT_OF_ORDER` : une étape faite ne se rejoue jamais, même par une seconde connexion), à son heure : fin prévue + `overdue_escalation_hours` du pays (défaut [2, 6, 24], 17 §7.2 ; sinon `OVERDUE_STEP_TOO_EARLY` ; paramètre absent ⇒ `PARAM_MISSING`) ; verrous du voyageur puis du véhicule, heure serveur ensuite. Trip non OVERDUE : `TRIP_NOT_OVERDUE` ; dossier pas encore ouvert : `OVERDUE_CASE_MISSING`.
- Effets (même transaction que `manual_action`, qui porte le motif, et l'audit) : étape du dossier avancée (garde : un cran, contexte STAFF seulement), ligne `core.trip_ops_overdue_escalation` (étape, gabarits produits, heure, heure due) et un `trip.overdue.escalated` attribué à l'agent ; l'hôte reçoit le gabarit de l'étape par NTF (`EVT_UNRETURNED_CONTACT`, `EVT_UNRETURNED_FORMAL_NOTICE`, `EVT_UNRETURNED_POLICE_REPORT`).
- La plateforme ne dépose aucune plainte, ne récupère ni ne coupe aucun véhicule (OQ-BR-17) ; aucune écriture sur l'occupation, l'argent ou un interrupteur ; le versement de l'hôte n'est pas bloqué. Le trip reste `OVERDUE` à T24H (prolongation tacite d'US-305 inchangée) : `UNRETURNED` est renvoyé à US-318 avec le retour, l'inspection et le rendez-vous d'un trip UNRETURNED (ADR-193).
- Vue des retards (16 ADM-022) : `core.trip_overdue_board` (interne, EXECUTE `iam_staff_owner`), lue par la console (`GET /console/overdue`, module SUP).

## Entités

| Entité (17 §3.2.10)     | État                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `trip_inspection`       | `core.trip_ops_inspection` (0158, US-303) ; jetons `core.trip_ops_photo_capture` ; gabarit `core.trip_ops_photo_slot` |
| `inspection_photo`      | `core.trip_ops_inspection_photo` (0158, US-303)                                                                       |
| `overdue_case`          | `core.trip_ops_overdue_case` (0168, US-305 ; écart PROPOSÉ : fin prévue, seuil, prolongation tacite, trip suivant)    |
| escalade (16 TRP-038)   | `core.trip_ops_overdue_escalation` (0173, US-306 ; une ligne par étape franchie, `id` = action de console)            |
| `key_handover`          | `core.trip_ops_key_handover` (0163, US-315)                                                                           |
| `trip_identity_check`   | `core.trip_ops_identity_check` (0163, US-315 ; entité de KYC dans 17, portée ici par la remise)                       |
| validation d'une partie | `core.trip_ops_handover_validation` (0163, US-315 ; écart PROPOSÉ à 17 : pas d'état VALIDATED de la série)            |

## Événements

La remise et le retour (US-315) émettent `trip.status_changed` par la transition de 0099 (motifs `CHECKIN_WINDOW_OPENED`, `CHECKIN_VALIDATED`, `CHECKOUT_VALIDATED`) ; `trip.checkin.validated` et `trip.checkout.completed` ne sont pas encore émis (suite, ADR-183).

Cible (17 §4.5) :

- émis : `trip.checkin.validated`, `trip.checkout.completed`, `trip.overdue.detected` / `.escalated`, `trip.offline.clock_skew_detected`. **Émis depuis US-305** (0168, travailleur `trip_overdue`) : `trip.overdue.detected` (`trip_id`, `stage`, `guest_user_id`, `host_user_id`, `scheduled_end`, `detected_at`), une fois par trip, et `trip.at_risk.flagged` (PROPOSÉ, à reporter dans 17 §4.5 : `trip_id` du trip suivant, `reason`, `host_user_id`, `scheduled_start`), une fois par trip suivant ; consommateurs : NTF et `trip_overdue_alert` ; **depuis US-306** (0173, commande liée à `ESCALATE_OVERDUE`) : `trip.overdue.escalated` (`trip_id`, `stage`, `host_user_id`, `documents`, `scheduled_end`, `escalated_at`, acteur = l'agent), une fois par étape franchie ; consommateur : NTF (hôte) ;
- consommés : `payment.received` (PAY, déblocage du check-in), `trip.status_changed` (AVL, minuteries).

## Ports

`index.ts` expose `TrpModule`, `TrpInspectionModule` et `postgresTrpAdapters` (photos et remise), le magasin de la remise (`HandoverStore`, `PgHandoverStore`) et son catalogue (`HANDOVER_MESSAGES`), les ports des photos (`EvidenceScanner`, `EvidenceVault`, `EvidenceFileStore` et leurs adaptateurs indisponibles), le magasin (`InspectionStore`, `PgInspectionStore`) et le catalogue des réponses (`INSPECTION_MESSAGES`). Les photos passent par le magasin de preuves d'AUD (`core.audit_file_asset`, bucket PRIVATE_EVIDENCE). Dépendances ajoutées : IAM (`SessionGuard`) et CTR (`TermsGuard`), écart assumé de 17 §2.2 (ADR-179).

## Commandes de test

Contrat des routes (FAKE du magasin et des ports, sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/trp
```

Preuves L0 sous les rôles de production, PA / USD et PY / PYG : `packages/db/test/l0/l0-us303-inspection-photos.test.ts`, `packages/db/test/l0/l0-us315-handover.test.ts` (conditions une à une avec témoin, permis, deux séries, heures serveur, retour, deux connexions), `packages/db/test/l0/l0-us305-overdue.test.ts` (bornes 10:29 / 10:30 au fuseau du pays, une alerte, deux travailleurs, retour avant 10:30, C10 dans les deux ordres, EC-19, seuil figé à la réservation, droits) (`pnpm --filter @rueda/db test:l0`, PostgreSQL requis : `docs/ops/INSTALL.md` ou `RUEDA_PG_TESTCONTAINERS=1`).

### No-show déclaré par une partie (US-307)

- Routes (`SessionGuard`, `TermsGuard`) : `GET /trips/{tripId}/no-show` (fenêtre en heure serveur, premier obstacle, preuve tracée, dernière demande) et `POST /trips/{tripId}/no-show` (`{ requestId }` seulement : clé d'idempotence ; la partie absente est l'autre partie de la session, jugée en base). Codes : `NO_SHOW_NOT_FOUND` (404, même réponse pour toute autre personne), `CHECKIN_NOT_OPEN`, `NO_SHOW_NOT_ALLOWED`, `NO_SHOW_TOO_EARLY`, `NO_SHOW_WINDOW_CLOSED`, `NO_SHOW_PARTY_PRESENT`, `NO_SHOW_EVIDENCE_REQUIRED`, `CANCELLATION_PENDING` (409), `REQUEST_INVALID` (400), `NO_SHOW_UNAVAILABLE` (503).
- Port `NoShowStore`, adaptateur `PgNoShowStore` (`core.trip_no_show_view`, `core.trip_cmd_report_no_show`, 0171) ; FAKE de test `testing/fake-no-show-store.ts` ; contrat `testing/trip-no-show.contract.test.ts`.
- La demande est réglée par le travailleur `trip_lifecycle` (STL, `TripCancellationProcessor`) : aucun montant ici.

### Frais annexes (US-706)

- Routes (`SessionGuard`, `TermsGuard`) : `GET /trips/{tripId}/incidental-fees` (demandes, échéance, état du débit, photos du trip utilisables comme pièces, délai de l'hôte), `POST /trips/{tripId}/incidental-fees` (hôte : `{ requestId, feeType, amountMinor, description, evidenceFileIds }`, montant en texte d'entier d'unités mineures, aucune heure ni jambe), `POST /trips/{tripId}/incidental-fees/{invoiceId}/accept` et `/dispute` (voyageur), `/cancel` (hôte). Un frais d'un autre trip que celui de l'URL, d'une autre partie ou d'une autre personne : `INCIDENTAL_NOT_FOUND` (404, même réponse).
- Codes : `INCIDENTAL_TYPE_NOT_ALLOWED`, `INCIDENTAL_TYPE_NOT_SUPPORTED`, `CLAIM_EVIDENCE_MISSING`, `INCIDENTAL_NOT_BILLABLE`, `INCIDENTAL_FUEL_PREPAID`, `INCIDENTAL_AMOUNT_ABOVE_CAP`, `INCIDENTAL_DISPUTE_REASON_REQUIRED` (422) ; `INCIDENTAL_TRIP_NOT_ENDED`, `INCIDENTAL_WINDOW_CLOSED`, `INCIDENTAL_DUPLICATE`, `INCIDENTAL_NOT_CANCELLABLE`, `INCIDENTAL_NOT_OPEN`, `GUEST_RESPONSE_WINDOW_CLOSED` (409) ; `REQUEST_INVALID` (400) ; `INCIDENTAL_UNAVAILABLE` (503 : base injoignable ou paramètre du pays absent).
- Port `IncidentalStore`, adaptateur `PgIncidentalStore` (`core.claim_incidental_view`, `core.claim_cmd_*_incidental`, 0177 ; décimales de la devise lues dans `core.config_currency`) ; FAKE de test `testing/fake-incidental-store.ts` ; contrat `testing/trip-incidental.contract.test.ts`. Le débit est fait par le travailleur `incidental_invoice_executor` (CLM) : aucun montant n'est débité ici.
