# MSG — Messaging (`apps/api/src/modules/msg`)

**MSG — Messaging** : fil par trip, masquage des coordonnées, détection du marché gris. Dépendances autorisées : IAM, AVL, CTR (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 MSG --> IAM ; ADR-181 : MSG --> CTR). Dépendances réelles : IAM (`SessionGuard`, `sessionProofOf`), CTR (`TermsGuard`).

## Responsabilité

D'après 17 §2.2 et §2.13, 16 MSG-001 / MSG-007 et 19 US-525 (ADR-181) : un fil de messages par trip entre le voyageur et l'hôte (titulaire du compte d'hôte ou co-hôte dont la portée couvre le véhicule), ouvert dès la réservation (le trip n'existe qu'à partir de `BOOKED`, BR-BOOK-02 : aucun contact avant) ; prénoms seulement ; masquage automatique des téléphones, courriels, identifiants et liens ; signal « paiement hors plateforme » par le catalogue de motifs d'ADR-176 réutilisé ; signal à l'ops (file `GRAY_MARKET`) et rappel à l'expéditeur, **jamais** de refus d'un texte légitime (jamais plus lourd que Turo) ; fil en lecture seule après la fin du trip + `review_window_days`. Les messages servent de preuve (`hostMessageTraced` de 08) : jamais supprimés, seulement masqués (`hidden_at`). **Aucun texte de message dans un journal** : seuls des codes et un SQLSTATE sont journalisés.

État du code (US-525) :

- routes `GET /trips/{tripId}/messages` et `POST /trips/{tripId}/messages` (`internal/trip-messages.controller.ts`, `SessionGuard` puis `TermsGuard`, `no-store`), service `TripMessagesService` (corps contrôlé, issues traduites, rappels `CONTACT_MASKED` / `OFF_PLATFORM_PAYMENT`), magasin `PgTripMessageStore` (fonctions `core.messaging_thread_read` et `core.messaging_cmd_post_message` de la migration 0160, lecture STRICTE des lignes, fail-closed) ;
- module dynamique `MsgTripMessagesModule` (sans adaptateurs : 503), adaptateurs de production `postgresMsgAdapters(pool)` ; `MsgModule` reste la coquille statique d'US-001.

`TermsGuard` (CTR) sur les deux routes, comme toute route d'un trip (US-102) : dépendance MSG → CTR au graphe (ADR-181, écart de 17 §2.2 à reporter). Relais WhatsApp et questions pré-réservation filtrées : P1. MSG n'envoie pas de notification (NTF ; avis « nouveau message » sans contenu : suite).

## Entités

Entités de 17 §3.2.12, créées par la migration 0160 (préfixe bêta `messaging_`) :

| Entité           | Table                           | Notes                                                                           |
| ---------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `message_thread` | `core.messaging_message_thread` | un fil par trip (UQ), créé au premier message                                   |
| `message`        | `core.messaging_message`        | `body` (preuve, jamais servi), `body_masked` (servi), `SENT` / `FLAGGED`        |
| `message_flag`   | `core.messaging_message_flag`   | `CONTACT_MASKED`, `GRAY_MARKET_KEYWORD` : codes seulement ; élément GRAY_MARKET |

Aucun droit applicatif sur ces tables : lecture et écriture par les deux fonctions `SECURITY DEFINER` (propriétaire `messaging_cmd_owner`, `EXECUTE` au seul `app_api`).

## Événements

Aucun événement n'est émis ni consommé par le code aujourd'hui (le signal à l'ops est l'élément de la file `GRAY_MARKET`, écrit dans la même transaction que le message).

Cible (17 §2.2, §4.5), en suite : émis `message.posted`, `message.flagged` (consommateurs : NTF pour l'avis sans contenu, SUP, STL pour `hostMessageTraced`) ; consommé `booking.trip.booked` (le fil est aujourd'hui créé au premier message).

## Ports

Port interne `TripMessageStore` (`internal/trip-message-store.ts`) : production `PgTripMessageStore` ; tests `FakeTripMessageStore` (`testing/`, jamais compilé dans l'image). Le relais WhatsApp (P1) passera par le port `MessagingChannel` de NTF.

API publique (`index.ts`) : `MsgModule`, `MsgTripMessagesModule`, `unavailableMsgOptions`, `postgresMsgAdapters`, `PgTripMessageStore`, `UnavailableTripMessageStore`, `MSG_MESSAGES`, `MsgHttpError`.

## Commandes de test

- Unitaires et contrat HTTP (vitest, sans base) : `pnpm --filter @rueda/api exec vitest run src/modules/msg` (`internal/trip-message-store.test.ts`, `testing/trip-messages.contract.test.ts` sur l'application réelle et le FAKE du magasin, confronté au contrat OpenAPI).
- Preuves en base (PostgreSQL réel, rôles de production, PA et PY) : `packages/db/test/l0/l0-us525-messaging.test.ts` (`pnpm --filter @rueda/db test:l0`) ; matrice des routes `src/testing/route-matrix.int.test.ts` (`pnpm --filter @rueda/api test:int`). Guide : `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` ; la CI (Testcontainers) fait foi.
