# NTF — Notifications (`apps/api/src/modules/ntf`)

**NTF — Notifications** : règles événement → destinataires → canaux → gabarit, repli, idempotence, préférences. Dépendances autorisées : CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 NTF --> CFG).

## Responsabilité

D'après 17 §2.2 et §2.13 : moteur unique de notifications (NTF-001) ; canaux e-mail transactionnel, SMS, WhatsApp (BSP), in-app, push (P1) ; repli automatique ; idempotence `(event_id, destinataire, canal)` ; réessais ; journal d'envoi ; préférences. NTF ne lit pas les tables d'IAM : les coordonnées viennent d'un port fourni par IAM.

État du code : **livré pour la bêta e-mail et SMS** par US-020 (port `MessagingChannel`, ADR-058) et US-021 (moteur, ADR-061). Catalogue réduit de six gabarits, textes en es, en, fr et pt (pt-BR, DEC-FONDATEUR-18).

Non câblé (reports) : processus `worker.ts` (US-003), accusés de remise, préférences et désinscription, WhatsApp (US-526), rappels de trip, e-mail de vérification d'IAM, habillage de marque, purge à 13 mois.

Détail (chaîne d'envoi, gabarits, contrat de charge utile, données personnelles) : [`internal/README.md`](internal/README.md).

## Entités

Entités de 17 §3.2.12 :

| Entité                    | État                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `notification_dispatch`   | table `core.ntf_notification_dispatch` (migration 0030)                                            |
| `notification_template`   | pas de table : catalogue en code (`TEMPLATES`, `internal/catalog.ts`), textes dans `packages/i18n` |
| `notification_rule`       | pas de table : catalogue en code (`RULES`, `internal/catalog.ts`)                                  |
| `notification_preference` | cible 17, pas encore créée                                                                         |
| `inapp_notification`      | cible 17, pas encore créée                                                                         |

Coordonnées des destinataires : fonction `core.iam_notification_contact` (migration 0031, module IAM), réservée au travailleur `ntf_sender`.

## Événements

Déjà émis par le code (`internal/sender.ts`, par l'outbox du module BUS) :

- `notification.dispatch.failed` (échec définitif sans repli) ;
- `notification.fallback.triggered` (envoi de repli créé).

Déjà consommés par le code (travailleur `ntf_dispatcher`, `RULES` de `internal/catalog.ts`) :

- `kyc.verification.status_changed` (`to` = `APPROVED`) ;
- `booking.trip.booked` ;
- `trip.status_changed` (`to` commençant par `CANCELLED_`) ;
- `trip.overdue.detected` ;
- `payout.batch.status_changed` (`status` = `INITIATED` ou `ON_HOLD`).

Cible (17 §4.5) : NTF consomme aussi, entre autres, `iam.user.registered`, `iam.restriction.applied` / `.lifted`, `kyc.host_verification.decided`, `catalog.listing.status_changed`, `booking.hold.*`, `booking.request.*`, `settlement.computed`, `refund.instance.status_changed`, `deposit.decision.executed`, `contract.document.generated` / `.signed`, `trip.checkin.validated`, `trip.checkout.completed`, `claim.status_changed`, `invoice.status_changed`, `message.posted` / `.flagged`, `finance.statement.issued`, `fiscal.document.status_changed`, `host_ledger.state_changed`.

## Ports

- `MessagingChannel` (`internal/messaging-channel.port.ts`, US-020) : `channel`, `send` (texte déjà rendu) ; échecs en valeurs (`OK`, `REFUSED`, `UNAVAILABLE`, `TIMEOUT`). FAKE : `FakeMessagingChannel` (`EMAIL`, `SMS`) de `@rueda/fake-adapters/messaging`, jamais en production.
- `RecipientDirectory` (`internal/recipient-directory.port.ts`, US-021) : `contactOf` ; adaptateur `postgresNotificationContacts` exporté par IAM.

API publique (`index.ts`) : `NtfModule` ; types du port `MessagingChannel` ; catalogue `RULES`, `TEMPLATES`, `TEMPLATE_KEYS`, `subscribedEventTypes` ; `planDispatches`, `dispatchEvent`, `NTF_DISPATCHER_WORKER`, `NTF_SENDER_WORKER`, `NotificationContractError` ; `NotificationSender`, `MAX_SEND_ATTEMPTS`, `RETRY_BASE_SECONDS` ; `registerNotifications`, `notificationCountryData`, `repositoryLocaleConfig` ; types `RecipientDirectory`, `RecipientContact`.

## Commandes de test

- Unitaires (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/ntf` (`templates.test.ts`, `dispatcher.test.ts`, `sender.test.ts`, `messaging-channel.port.test.ts`).
- Intégration (PostgreSQL réel, sous `app_worker`) : `pnpm --filter @rueda/api test:int` ; fichier du module : `apps/api/test/int/ntf.int.test.ts` (seul : `pnpm --filter @rueda/api exec vitest run --config vitest.int.config.ts test/int/ntf.int.test.ts`).
- Preuves L0 en base : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-ntf-dispatch.test.ts`.

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
