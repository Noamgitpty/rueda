# AVL — Availability & Booking (`apps/api/src/modules/avl`)

**AVL — Availability & Booking** : occupation unique, holds TTL, réservation, intention de paiement et conversion gardée en trip ou compensation (US-024, commandes SQL décrites dans `packages/db/README.md`, ADR-065), trip, annulations et no-shows, oracle de production C12 (US-025, ADR-068). Dépendances autorisées : PRC, PAY, CTR, KYC, RISK, CAT, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 AVL --> PRC, PAY, CTR, RISK, KYC).

## Responsabilité

AVL tient la disponibilité de chaque véhicule (une seule table d'occupation, exclusion GiST), pose et libère les holds de checkout, convertit un hold payé en trip ou ouvre une compensation, puis porte le trip (SM-1, SM-1b), ses annulations et ses no-shows (17 §2.2, §2.5).

AVL ne calcule ni prix (PRC) ni règlement (STL), et n'appelle jamais le PSP lui-même : il écrit des commandes dans la boîte d'envoi de PAY. On écrit **uniquement par commandes** SQL ; l'horloge fait foi côté base (`platform.now()`).

État réel : `AvlModule` reste vide (US-001) ; `internal/` porte la tâche de l'oracle C12 (US-025) et le **checkout, partie back-end** (US-208, ADR-133, `internal/checkout/`, module dynamique `AvlCheckoutModule`). Le reste vit dans la base (`packages/db/migrations`) :

- US-006 : schéma de preuve L0 (occupations, holds, trips, compensations, dispositions) ;
- US-007 : preuves de concurrence L0-02 et L0-04 ;
- US-011 : clés étrangères vers IAM (0023) ;
- US-022 : table d'occupation unique, blocages de l'hôte, tampons (ADR-060) ;
- US-023 : commandes de pose et de libération des holds, tâche d'expiration (ADR-063) ;
- US-024 : intention de paiement, conversion gardée, ré-acquisition, compensation, balayages (ADR-065) ;
- US-127 : auto-réservation refusée à la pose et à la conversion pour l'hôte, les co-hôtes de tous ses comptes et les comptes liés (migration 0080, ADR-110). **Contrat de la future route de pose du hold** : sur `SELF_BOOKING_FORBIDDEN`, appeler `core.booking_cmd_report_self_booking(véhicule)` dans une **nouvelle** transaction (signalement à l'ops), puis afficher `common.booking.selfBookingForbidden.*`, sans autre détail ;
- US-207 : machine à états du trip (SM-1) en base : table des transitions, commandes `core.booking_cmd_trip_transition` et `core.booking_cmd_trip_cancel` (travailleur `trip_lifecycle`), journal d'état, segment et conducteur principal, `trip.status_changed` et `trip.cancellation.qualified` (migration 0099, ADR-126). Les routes du voyageur, de l'hôte et de l'ops et le règlement dans la même transaction arrivent avec US-215 / US-224 ;
- US-208 : checkout en une page, partie back-end (migrations 0107, 0108, ADR-133) : devis figé avec durée de validité, commande `core.booking_cmd_checkout` (devis, annonce immédiate, boîte manuelle, conducteur titulaire, documents acceptés, pose du hold par `core.booking_cmd_place_hold`), rattachement `booking_checkout_acceptance` / `booking_checkout_terms` ; aucun paiement (US-223) ;
- US-209 (209b, migration 0119, ADR-141) : décision de l'ops sur une réservation signalée, commande `core.booking_manual_action_review_flagged` liée à `REVIEW_FLAGGED_BOOKING` (cadre d'US-101, appelée par la console) : APPROVED ⇒ `reviewed_at` et UNE prolongation `reviewed_at + LEAST(hold_ttl_minutes, hold_max_total_minutes)` (hold et occupation), puis paiement par le chemin d'US-223a ; REJECTED ⇒ `RELEASED` / `REVIEW_REJECTED`, occupation libérée ; aucun débit. Hold de revue échu jamais revu ⇒ `RELEASED` / `REVIEW_REJECTED` (déclencheur `hold_review_lapse`, quel que soit l'écrivain), élément de file d'un hold sorti sans décision clos `CANCELLED` (déclencheur `hold_review_item_close`). Branche `PAY_THEN_REVIEW` : refus d'un trip payé ⇒ `CANCELLATION_UNAVAILABLE` (US-224). Événement `booking.hold.review_decided`.
- US-224 (224d, migration 0129, ADR-154) : `GET /trips/{tripId}/refunds` (`TripRefundsController`, `SessionGuard` puis `TermsGuard`, sans cache) : remboursement du trip lu par sa partie (`core.booking_trip_refunds`) : voyageur ⇒ état SM-8, montant remboursé, rail, dates de planification et d'émission ; titulaire du compte d'hôte ⇒ la seule part de la jambe HOST ; toute autre personne, trip inconnu ou identifiant mal formé ⇒ 404 `REFUND_NOT_FOUND` (même réponse) ; forme inattendue ou base indisponible ⇒ 503 `REFUNDS_UNAVAILABLE`. Montants en texte, jamais recalculés ; exposant de la devise et fuseau du trip pour l'affichage ;
- US-215 (215a, migration 0124, ADR-148) : annulations déclenchées par l'ops. Demande `core.booking_trip_cancellation` écrite par la commande liée `core.booking_manual_action_cancel_trip` (motif et initiateur dérivés de l'action, heure serveur) ; transition réglée `core.booking_cmd_trip_settle_cancellation` (travailleur `trip_lifecycle`, appelée par STL dans la transaction du règlement) : requalification en base (règles 1 et 2 ; preuve = pièce jointe à l'action), liaison du règlement à la demande, `settlement_id` au journal et dans `trip.status_changed`, créneau libéré, `cost_bearer`. `core.booking_cmd_trip_cancel` (US-207) reste sans appelant de production.
- US-209 (209a, migration 0112, ADR-135) : contrôles bloquants du conducteur au checkout (`KYC_NOT_APPROVED`, `KYC_BIOMETRIC_CONSENT_MISSING`, `KYC_LICENSE_EXPIRED`, `AGE_CLASS_MISMATCH`, 403), jugés après l'auto-réservation ; règles de risque déclarées (16 ADM-029) : réservation signalée ⇒ hold de revue ou ordinaire selon `flagged_booking_payment_order` ; mêmes contrôles relus au démarrage du paiement (`core.booking_cmd_start_payment`) et à la conversion (`core.booking_conversion_eligibility`) par `core.booking_guest_eligibility` (N-53, N-95, N-122). **Contrat de la future tâche de conversion (US-223)** : tout code de `core.booking_conversion_eligibility` autre que `ELIGIBLE` est une compensation `ELIGIBILITY_CHANGED`, jamais un trip ni une nouvelle tentative. Le consentement biométrique retiré rend un seul code, `KYC_BIOMETRIC_CONSENT_MISSING` (l'ancien `KYC_CONSENT_WITHDRAWN` n'est plus rendu).
- US-205 (205b, migrations 0117 et 0118, ADR-140) : le devis du checkout fige la distance de l'annonce (`mileage`, rejouée par la base) ; le devis lu rend `mileage` (colonnes figées), `cancellation` (annulation gratuite si la réservation a lieu maintenant, `core.catalog_public_terms`) et `lateCancellation` (jours retenus et montant TTC : devis figé REJOUÉ depuis `core.pricing_checkout_terms`, puis `lateCancellationOf` de PRC sur le moteur de règlement ; paramètres d'annulation `cancellationParamsOf` câblés par `main.ts` ; absents ou rejeu impossible ⇒ `null`, journalisé `cancellation`).
- US-223 (223b, ADR-142, aucune migration) : routes du paiement du hold (`internal/checkout/payment.*`) sur les commandes de 0116 (ADR-139) ; voir « Paiement du hold » ci-dessous.
- US-223 (223c-serveur, migrations 0125 et 0126, ADR-146) : réservation sur demande. Le checkout d'une annonce `instant_book = false` pose un hold REQUEST si `booking_request_mode_enabled` est vrai dans le pays (faux par défaut : `REQUEST_MODE_UNAVAILABLE` inchangé) ; T1 rend `captureMode` MANUAL (autorisation AUTH, jambes du devis), l'API l'envoie à `createHostedPayment` ; la preuve de l'autorisation (webhook signé) passe la demande en `AWAITING_HOST` (heure limite = preuve + `booking_request_expiry_hours`) ; l'hôte titulaire accepte (capture par jambes rattachée à l'AUTH, Σ jambes = total ≤ AUTH) ou refuse (VOID total par la boîte d'envoi) par `internal/checkout/host-requests.*` ; l'expiration passe par le travailleur `hold_expiry`. Le paiement du hold rend l'état de la demande (`request`, absent pour une réservation immédiate). Écrans : partie 223c-écrans.
- US-025 : oracle de production C12 (migration 0045) et sa tâche périodique `internal/production-oracle.ts` (ADR-068) ; fuzz C11 (`packages/db/test/l0/l0-c11-fuzz.test.ts`).

Détail des commandes : `packages/db/README.md`, sections « Table d'occupation unique », « Holds de checkout et commandes » et « Conversion gardée, ré-acquisition et compensation ». Machine à états du trip : section « Machine à états du trip » (US-207). iCal : US-510 (hors produit pour l'instant).

## Entités

| Entité (17 §3.2.4)    | En base                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `vehicle_occupancy`   | table `core.booking_vehicle_occupancy` (migration 0004, refondue en 0032)       |
| `guest_occupancy`     | table `core.booking_guest_occupancy` (migration 0004)                           |
| `checkout_hold`       | table `core.booking_checkout_hold` (migration 0004, commandes 0037, 0040, 0041) |
| `hold_compensation`   | table `core.booking_hold_compensation` (migration 0004)                         |
| `payment_disposition` | table `core.booking_payment_disposition` (migration 0006)                       |
| `trip`                | table `core.booking_trip` (migration 0004, transitions 0099)                    |
| `trip_segment`        | table `core.booking_trip_segment` (migration 0099, un segment en bêta)          |
| `trip_driver`         | table `core.booking_trip_driver` (migration 0099, `PRIMARY` seul en bêta)       |
| `trip_state_log`      | table `core.booking_trip_state_log` (migration 0099, ajout seul)                |
| `ical_conflict`       | cible 17, pas encore créée                                                      |

Hors 17 §3.2.4 : `core.booking_disposition_repair_log` (migration 0041, essais du balayage des dispositions). Droits des travailleurs : 0007.

## Routes (US-208)

| Route                                                   | Accès   | Rôle                                                                                                                         |
| ------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `POST /checkout/quotes`                                 | session | devis figé (lignes, total, validité, documents) ; rejoué par la base avant d'être figé                                       |
| `GET /checkout/quotes/{quoteId}`                        | session | devis figé du voyageur ; 404 sinon                                                                                           |
| `POST /checkout/quotes/{quoteId}/hold`                  | session | checkout : contrôles, consentements et pose du hold CHECKOUT ; aucun paiement                                                |
| `GET /checkout/holds/{holdId}`                          | session | récapitulatif du hold, version exacte de chaque document accepté et état de revue (`reviewState`, US-209c, ADR-144)          |
| `POST /checkout/holds/{holdId}/payment`                 | session | paiement du hold (US-223b) : T1, ordre chez le PSP avec chaque jambe, T2 ; 201 + page hébergée                               |
| `GET /checkout/holds/{holdId}/payment`                  | session | état du paiement (S06) : hold et trip né, jamais le statut de l'opération                                                    |
| `GET /host/accounts/{orgId}/requests`                   | session | demandes en attente ou en capture du compte titulaire de la session (US-223c) ; autre compte ⇒ 404 `REQUEST_NOT_FOUND`       |
| `GET /host/accounts/{orgId}/requests/{holdId}`          | session | une demande du compte (heure limite, période, total, gains HOST, voyageur réduit à `host_guest_v`)                           |
| `POST /host/accounts/{orgId}/requests/{holdId}/accept`  | session | acceptation : capture par jambes (clé stockée, référence de l'autorisation), affinage ; aucun connecteur ⇒ 503 avant la base |
| `POST /host/accounts/{orgId}/requests/{holdId}/decline` | session | refus : RELEASED (`REQUEST_DECLINED`), créneau libéré, VOID par la boîte d'envoi, aucun débit                                |

**Devis expiré (contrat, US-208b)** : `409 QUOTE_EXPIRED` ne porte aucun devis de remplacement. Le client redemande un devis (`POST /checkout/quotes`, même annonce, même période), affiche le nouveau total, fait accepter de nouveau les documents, puis pose le hold sur le nouveau devis (écran S05, ADR-134). Panne du magasin ou de la base : `503 BOOKING_UNAVAILABLE` et une ligne de journal `checkout.store_failed` (opération, nom de l'erreur, SQLSTATE ; jamais de message, de jeton ni de donnée personnelle).

`SessionGuard` + `TermsGuard` sur la classe (N-43 : contrôle à l'exécution, `ctr/internal/terms-guard-runtime.test.ts`). Écart assumé de 17 §2.2 : AVL dépend d'IAM (ADR-133). Mode `REQUEST` : US-223c (ADR-146), fermé tant que `booking_request_mode_enabled` est faux (`REQUEST_MODE_UNAVAILABLE`) ; contrôles bloquants : US-209.

**Protection du voyageur (US-226 partie 226a, ADR-136)** : `POST /checkout/quotes` accepte `protectionLevel` (absent ⇒ minimum du pays, présélectionné ; `null` ou vide ⇒ `422 PROTECTION_LEVEL_REQUIRED`, aucun trip sans protection) et `driverAge` (âge déclaré, figé dans le devis) ; niveau inconnu, sous le minimum ou refusé à l'âge déclaré ⇒ `422 PROTECTION_LEVEL_NOT_ELIGIBLE` ; pays sans contrat d'assureur actif ⇒ `409 INSURER_CONTRACT_INACTIVE` (gel et pose du hold). Le plan de gains du véhicule est lu en base (`core.catalog_listing_earnings_plan`) pour figer la même part de l'hôte que la base. Le devis lu rend `protectionLevel`, `driverAge`, `insurerContractActive` (`core.booking_checkout_protection`) et `protectionOptions` (niveaux vendus et leur prix pour la période, calculés avec l'instantané du gel ; choisir un autre niveau = demander un nouveau devis). Un devis sans ligne `PROTECTION` n'est jamais réservé (`PROTECTION_LEVEL_REQUIRED` à la pose).

**Paiement du hold (US-223 partie 223b, ADR-142)** : `POST /checkout/holds/{holdId}/payment` ne reçoit que le moyen (`{ method? }`, défaut `CARD` ; montant, jambe ou champ inconnu ⇒ `400`). Ordre : lecture de l'état (hold d'un autre voyageur ⇒ `404`, rien n'est démarré) ; hold ni payable ni interrompu ⇒ `200` avec l'état ; **aucun connecteur servi par l'image** (production jusqu'au lot C : registre vide, C19) ⇒ `503 PAYMENT_UNAVAILABLE` avant T1 ; T1 `core.booking_cmd_checkout_pay` ; `createHostedPayment` du connecteur du fournisseur de l'opération (clé de T1, montant et montant explicite de chaque jambe rendus par la base, capture `AUTO`, somme vérifiée avant l'appel) ; T2 `core.booking_cmd_checkout_record_order`. `201` et `redirectUrl` seulement si l'ordre est enregistré sur un hold en vol. Un ordre déjà en cours n'est jamais recréé (`EXISTING_ORDER`, `VERIFYING`). Reprise après un PSP sans réponse après T1 (état `INTERRUPTED` : hold en vol, opération `PENDING` sans référence) : T1 rend `RETRY_SAME_KEY`, l'API cherche d'abord l'ordre par notre clé (trouvé ⇒ jamais recréé ; lecture impossible ⇒ `503`) puis le recrée sous la même clé (N-108). Refus de T1 traduits par (SQLSTATE, contrainte) comme `packages/db/src/errors.ts` (`payment-store.ts`) ; panne ⇒ `503`, journal `checkout.payment_failed` (opération, nom, SQLSTATE, code PSP). `GET …/payment` rend `state` (`PAYABLE`, `DECLINED`, `VERIFYING`, `INTERRUPTED`, `CONFIRMED`, `REFUND_DUE`, `UNPROVEN`, `ENDED`, `paymentStateOf`) dérivé de `hold_status` et du trip né : `CONFIRMED` exige `CONVERTED` et un trip ; le statut de l'opération n'est jamais rendu. Options : `AvlCheckoutOptions.payments` (`store`, `providers` par fournisseur) ; tests : connecteur enregistreur de `testing/fake-checkout-payment-store.ts`.

**État de revue du hold (US-209 partie 209c, ADR-144)** : `GET /checkout/holds/{holdId}` rend `reviewState`, lu dans la même instruction que le récapitulatif (`core.booking_checkout_review_state`, migration 0120) : `PENDING` (hold `review_required` sans `reviewed_at` : revue avant le débit en cours, le paiement rendrait `409 BOOKING_UNDER_REVIEW`), `APPROVED` (revu : payable jusqu'à `expiresAt`, prolongation unique d'ADR-141), `REJECTED` (hold `RELEASED` motif `REVIEW_REJECTED` : refus de l'ops ou revue non faite dans le délai, jamais distingués pour le voyageur) ou `NONE`. État absent ou inconnu ⇒ `503 BOOKING_UNAVAILABLE` (jamais un hold présenté comme payable, N-203). S05 n'affiche « Pagar » que pour `NONE` et `APPROVED`.

## Événements

Déjà émis par le code (écrits dans `core.outbox_outbox_event` par les fonctions SQL, dans la transaction de la commande) :

- `booking.hold.created`, `booking.hold.released`, `booking.hold.release_deferred`, `booking.hold.expired` (0037, 0040, 0041) ;
- `booking.hold.payment_in_flight` (0040) ;
- `booking.hold.converted`, `booking.hold.reacquired`, `booking.trip.booked` (0041, conversion) ;
- `trip.status_changed` (0099 : naissance du trip et chaque transition, charge utile `trip_id`, `from`, `to`, `reason`, `settlement_id`) et `trip.cancellation.qualified` (0099, 17 §4.5 : `trip_id`, `segment_id` (segment n° 1), `reason` (motif qualifié), `origin`, `requested_at` (heure serveur), plus `requested_reason`, `initiator`, `to`) ;
- `booking.hold.compensated`, `booking.hold.compensation_required`, `booking.payment.late_ignored` (0041) ;
- `booking.alert.invariant_violation` et `booking.payment.disposition_overdue` (0041), `booking.alert.production_oracle` (0045, comptes seulement) : alertes absentes du catalogue 17 §4.5.

Cible seulement (17 §4.5) : `booking.request.*`, `booking.hold.release_requested`, `booking.hold.superseded`, `booking.ical.conflict_detected`, `booking.ical.feed_failing`, `payment.disposition.repair_alert`.

Consommés (cible 17 §4.5) : `iam.restriction.applied` / `.lifted`, `iam.organization.*`, `kyc.verification.status_changed`, `kyc.trip_identity.failed`, `catalog.listing.status_changed`, `catalog.vehicle.restricted`, `payment.received`, `trip.checkin.validated`, `trip.checkout.completed`, `dispute.opened` / `.decided`. Aucun consommateur TypeScript n'est branché ; la conversion est la fonction `core.booking_convert_payment`, exécutée par le travailleur `booking_conversion`.

## Ports

Aucun port vers l'extérieur : AVL ne parle pas au PSP (boîte d'envoi `core.payment_payment_command`, exécutée par PAY). `index.ts` exporte `AvlModule` et la tâche de l'oracle C12 : `registerProductionOracle(registry)` déclare la file périodique `booking_oracle` (24 h, PROPOSÉ ; câblage dans `worker.ts` par US-003), qui appelle `core.booking_production_oracle_alert()` et journalise des comptes seulement (`parseOracleReport`, fail-closed).

L'API réelle est SQL (`SECURITY DEFINER` sous `cmd_hold_owner`, ou `SECURITY INVOKER` pour les travailleurs) :

- `app_api` : `core.booking_cmd_place_host_block`, `core.booking_cmd_remove_host_block`, `core.booking_cmd_place_hold`, `core.booking_cmd_release_own_hold`, `core.booking_cmd_start_payment`, `core.booking_cmd_record_order` ;
- `app_worker` : `core.booking_cmd_place_buffer`, `core.booking_expire_due_holds`, `core.booking_release_cancelled_holds`, `core.booking_convert_payment`, `core.booking_record_payment_failure`, balayages `core.booking_intents_due` / `core.booking_record_poll` et `core.booking_disposition_candidates` / `core.booking_disposition_repair` ; oracle C12 `core.booking_production_oracle` (lecture seule) et `core.booking_production_oracle_alert` (travailleur `booking_oracle`).

Dépendances fail-closed en attendant d'autres modules : `core.booking_vehicle_party` ne connaît aucun véhicule tant que CAT n'existe pas (US-115) : aucun hold ni, depuis 0056 (US-049, ADR-089), aucun blocage de calendrier n'est possible en production avant le catalogue ; un hold est refusé (`SELF_BOOKING_FORBIDDEN`) au titulaire et à tout membre du compte d'hôte du véhicule ; `core.booking_hold_payment_terms` ne rend rien tant que PRC n'existe pas.

## Commandes de test

- Unitaires du module : `internal/production-oracle.test.ts` ; contrat HTTP du checkout : `testing/checkout.contract.test.ts` ; du paiement du hold : `testing/checkout-payment.contract.test.ts` et `internal/checkout/payment.service.test.ts` (US-223b). Commande : `pnpm --filter @rueda/api exec vitest run src/modules/avl`.
- Intégration (PostgreSQL réel) : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/avl-schema.test.ts`.
- Preuves L0 (rôles de production) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-01-reacquisition.test.ts test/l0/l0-02-concurrency.test.ts test/l0/l0-03-i-occ.test.ts test/l0/l0-04-expiry-plan.test.ts test/l0/l0-08-unique.test.ts test/l0/l0-occ-single-occupancy.test.ts test/l0/l0-hold-commands.test.ts test/l0/l0-us024-conversion.test.ts test/l0/l0-us208-checkout.test.ts`. L0-02 et la conversion tournent seuls, dans le second groupe de `vitest.l0.config.ts`.
- Toutes les preuves L0 : `pnpm --filter @rueda/db test:l0`.
- Fuzz C11 et oracle C12 : `pnpm --filter @rueda/db test:c11` (1 000 exécutions par défaut ; rejeu `RUEDA_C11_REPLAY`).

`test:int` et `test:l0` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».

## Contrat de location hôte–voyageur (US-211 partie 211a, ADR-143)

Travailleur `booking_contract` (`internal/contract/contract-generator.ts`, déclaré dans `worker-tasks.ts`), consommateur de `booking.trip.booked`, dans la transaction du reçu de l'événement :

1. `core.booking_contract_source(trip)` (0122, EXECUTE `app_worker`) : faits lus par la base (devis du checkout, distance figée, assureur et caution à la réservation, véhicule, lieu, hôte nommé, voyageur minimisé), devis canonique, gabarits es et de courtoisie, version suivante ;
2. retenue hors fenêtre gratuite par `lateCancellationOf` de PRC sur le devis REJOUÉ (la même que S05, N-199) ; rejeu impossible : aucune retenue écrite ;
3. texte, PDF et empreinte par CTR (`buildContractBody`, `renderContractPdf`, `contractSha256`) ;
4. `core.booking_cmd_record_contract` : la base relit les faits et refuse un écart (`SOURCE_CHANGED` : erreur, rejeu) ; clé `evt:<événement>` (rejeu : `ALREADY_RECORDED`).

Source incomplète ou gabarit absent : `CONTRACT_GENERATION_FAILED` journalisé et levé (lettre morte, alerte). Journaux : issue, pays, motif ; jamais un nom, une plaque ni un montant. Lecture (`core.booking_trip_contract`) et signature du voyageur (`core.booking_cmd_sign_contract`) : commandes `app_api` de 0122, routes en 211b. La remise (`IN_PROGRESS`) exige la dernière version signée (`CONTRACT_NOT_SIGNED`).

Tests : `internal/contract/contract-generator.test.ts` (base simulée) ; preuves L0 `packages/db/test/l0/l0-us211-rental-contract.test.ts`.
