# AVL — Availability & Booking (`apps/api/src/modules/avl`)

**AVL — Availability & Booking** : occupation unique, holds TTL, réservation, intention de paiement et conversion gardée en trip ou compensation (US-024, commandes SQL décrites dans `packages/db/README.md`, ADR-065), trip, annulations et no-shows, oracle de production C12 (US-025, ADR-068). Dépendances autorisées : PRC, PAY, CTR, KYC, RISK, CAT, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 AVL --> PRC, PAY, CTR, RISK, KYC).

## Responsabilité

AVL tient la disponibilité de chaque véhicule (une seule table d'occupation, exclusion GiST), pose et libère les holds de checkout, convertit un hold payé en trip ou ouvre une compensation, puis porte le trip (SM-1, SM-1b), ses annulations et ses no-shows (17 §2.2, §2.5).

AVL ne calcule ni prix (PRC) ni règlement (STL), et n'appelle jamais le PSP lui-même : il écrit des commandes dans la boîte d'envoi de PAY. On écrit **uniquement par commandes** SQL ; l'horloge fait foi côté base (`platform.now()`).

État réel : le dossier du module est un **squelette** (`AvlModule` vide, US-001 ; `internal/` ne porte que la tâche de l'oracle C12, US-025). Tout ce qui est livré vit dans la base (`packages/db/migrations`) :

- US-006 : schéma de preuve L0 (occupations, holds, trips, compensations, dispositions) ;
- US-007 : preuves de concurrence L0-02 et L0-04 ;
- US-011 : clés étrangères vers IAM (0023) ;
- US-022 : table d'occupation unique, blocages de l'hôte, tampons (ADR-060) ;
- US-023 : commandes de pose et de libération des holds, tâche d'expiration (ADR-063) ;
- US-024 : intention de paiement, conversion gardée, ré-acquisition, compensation, balayages (ADR-065) ;
- US-025 : oracle de production C12 (migration 0045) et sa tâche périodique `internal/production-oracle.ts` (ADR-068) ; fuzz C11 (`packages/db/test/l0/l0-c11-fuzz.test.ts`).

Détail des commandes : `packages/db/README.md`, sections « Table d'occupation unique », « Holds de checkout et commandes » et « Conversion gardée, ré-acquisition et compensation ». Machine à états du trip : US-207. iCal : US-510 (hors produit pour l'instant).

## Entités

| Entité (17 §3.2.4)    | En base                                                                         |
| --------------------- | ------------------------------------------------------------------------------- |
| `vehicle_occupancy`   | table `core.booking_vehicle_occupancy` (migration 0004, refondue en 0032)       |
| `guest_occupancy`     | table `core.booking_guest_occupancy` (migration 0004)                           |
| `checkout_hold`       | table `core.booking_checkout_hold` (migration 0004, commandes 0037, 0040, 0041) |
| `hold_compensation`   | table `core.booking_hold_compensation` (migration 0004)                         |
| `payment_disposition` | table `core.booking_payment_disposition` (migration 0006)                       |
| `trip`                | table `core.booking_trip` (migration 0004)                                      |
| `trip_segment`        | cible 17, pas encore créée                                                      |
| `trip_driver`         | cible 17, pas encore créée                                                      |
| `trip_state_log`      | cible 17, pas encore créée                                                      |
| `ical_conflict`       | cible 17, pas encore créée                                                      |

Hors 17 §3.2.4 : `core.booking_disposition_repair_log` (migration 0041, essais du balayage des dispositions). Droits des travailleurs : 0007.

## Événements

Déjà émis par le code (écrits dans `core.outbox_outbox_event` par les fonctions SQL, dans la transaction de la commande) :

- `booking.hold.created`, `booking.hold.released`, `booking.hold.release_deferred`, `booking.hold.expired` (0037, 0040, 0041) ;
- `booking.hold.payment_in_flight` (0040) ;
- `booking.hold.converted`, `booking.hold.reacquired`, `booking.trip.booked` (0041, conversion) ;
- `booking.hold.compensated`, `booking.hold.compensation_required`, `booking.payment.late_ignored` (0041) ;
- `booking.alert.invariant_violation` et `booking.payment.disposition_overdue` (0041), `booking.alert.production_oracle` (0045, comptes seulement) : alertes absentes du catalogue 17 §4.5.

Cible seulement (17 §4.5) : `trip.status_changed`, `trip.cancellation.qualified`, `booking.request.*`, `booking.hold.release_requested`, `booking.hold.superseded`, `booking.ical.conflict_detected`, `booking.ical.feed_failing`, `payment.disposition.repair_alert`.

Consommés (cible 17 §4.5) : `iam.restriction.applied` / `.lifted`, `iam.organization.*`, `kyc.verification.status_changed`, `kyc.trip_identity.failed`, `catalog.listing.status_changed`, `catalog.vehicle.restricted`, `payment.received`, `trip.checkin.validated`, `trip.checkout.completed`, `dispute.opened` / `.decided`. Aucun consommateur TypeScript n'est branché ; la conversion est la fonction `core.booking_convert_payment`, exécutée par le travailleur `booking_conversion`.

## Ports

Aucun port vers l'extérieur : AVL ne parle pas au PSP (boîte d'envoi `core.payment_payment_command`, exécutée par PAY). `index.ts` exporte `AvlModule` et la tâche de l'oracle C12 : `registerProductionOracle(registry)` déclare la file périodique `booking_oracle` (24 h, PROPOSÉ ; câblage dans `worker.ts` par US-003), qui appelle `core.booking_production_oracle_alert()` et journalise des comptes seulement (`parseOracleReport`, fail-closed).

L'API réelle est SQL (`SECURITY DEFINER` sous `cmd_hold_owner`, ou `SECURITY INVOKER` pour les travailleurs) :

- `app_api` : `core.booking_cmd_place_host_block`, `core.booking_cmd_remove_host_block`, `core.booking_cmd_place_hold`, `core.booking_cmd_release_own_hold`, `core.booking_cmd_start_payment`, `core.booking_cmd_record_order` ;
- `app_worker` : `core.booking_cmd_place_buffer`, `core.booking_expire_due_holds`, `core.booking_release_cancelled_holds`, `core.booking_convert_payment`, `core.booking_record_payment_failure`, balayages `core.booking_intents_due` / `core.booking_record_poll` et `core.booking_disposition_candidates` / `core.booking_disposition_repair` ; oracle C12 `core.booking_production_oracle` (lecture seule) et `core.booking_production_oracle_alert` (travailleur `booking_oracle`).

Dépendances fail-closed en attendant d'autres modules : `core.booking_vehicle_party` ne connaît aucun véhicule tant que CAT n'existe pas (US-115) : aucun hold ni, depuis 0056 (US-049, ADR-089), aucun blocage de calendrier n'est possible en production avant le catalogue ; un hold est refusé (`SELF_BOOKING_FORBIDDEN`) au titulaire et à tout membre du compte d'hôte du véhicule ; `core.booking_hold_payment_terms` ne rend rien tant que PRC n'existe pas.

## Commandes de test

- Unitaires du module : `internal/production-oracle.test.ts`. Commande : `pnpm --filter @rueda/api exec vitest run src/modules/avl`.
- Intégration (PostgreSQL réel) : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/avl-schema.test.ts`.
- Preuves L0 (rôles de production) : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-01-reacquisition.test.ts test/l0/l0-02-concurrency.test.ts test/l0/l0-03-i-occ.test.ts test/l0/l0-04-expiry-plan.test.ts test/l0/l0-08-unique.test.ts test/l0/l0-occ-single-occupancy.test.ts test/l0/l0-hold-commands.test.ts test/l0/l0-us024-conversion.test.ts`. L0-02 et la conversion tournent seuls, dans le second groupe de `vitest.l0.config.ts`.
- Toutes les preuves L0 : `pnpm --filter @rueda/db test:l0`.
- Fuzz C11 et oracle C12 : `pnpm --filter @rueda/db test:c11` (1 000 exécutions par défaut ; rejeu `RUEDA_C11_REPLAY`).

`test:int` et `test:l0` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».
