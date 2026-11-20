# NTF — Notifications (`apps/api/src/modules/ntf`)

**NTF — Notifications** : règles événement → destinataires → canaux → gabarit, repli, idempotence, préférences. Dépendances autorisées : CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 NTF --> CFG).

## Responsabilité

D'après 17 §2.2 et §2.13 : moteur unique de notifications (NTF-001) ; canaux e-mail transactionnel, SMS, WhatsApp (BSP), in-app, push (P1) ; repli automatique ; idempotence `(event_id, destinataire, canal)` ; réessais ; journal d'envoi ; préférences. NTF ne lit pas les tables d'IAM : les coordonnées viennent d'un port fourni par IAM.

État du code : **livré pour la bêta e-mail et SMS** par US-020 (port `MessagingChannel`, ADR-058) et US-021 (moteur, ADR-061). Le catalogue réduit compte quinze gabarits (plus deux réponses automatiques d'aide hors plage, US-310) (deux de la file d'ajout au catalogue, US-114 ; la confirmation de l'hôte et les demandes de réservation, US-213). Textes en es, en, fr et pt (pt-BR, DEC-FONDATEUR-18).

US-213 (ADR-174) : la confirmation porte la variable `assistance` : au voyageur, le support et l'assistance de l'assureur ; à l'hôte, le support. Les numéros sont relus à l'envoi dans la configuration du pays (`assistanceContacts` de CFG, via `notificationCountryData`). Absents (hors production seulement : la production refuse de démarrer sans eux), le message renvoie à la réservation dans l'appli. Le téléphone de l'hôte n'est jamais une source. Textes `ntf.assistance.<guest|host>.<email|sms>.<numbers|inApp>` (catalogue v90).

US-213 (ADR-157) : les parties d'une réservation (voyageur, titulaire du compte d'hôte) sont lues **en base** par le port `NotificationParties`. AVL fournit l'adaptateur (`core.booking_notification_parties`, 0133). Les producteurs de `booking.trip.booked`, `trip.status_changed` et `booking.request.*` ne portent en effet aucun identifiant de personne.

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
- `booking.trip.booked` (voyageur : `EVT_BOOKING_CONFIRMED` ; hôte : `EVT_BOOKING_CONFIRMED_HOST` ; parties lues en base, US-213) ;
- `trip.status_changed` (`to` commençant par `CANCELLED_` ; parties lues en base après la condition, US-213) ;
- `trip.overdue.detected` (producteur : travailleur `trip_overdue`, 0168, US-305 ; une fois par trip, voyageur et hôte, `EVT_TRIP_OVERDUE`) ;
- `trip.at_risk.flagged` (0168, US-305 : trip suivant du véhicule à risque, hôte, `EVT_TRIP_AT_RISK_HOST`, textes `ntf.tripAtRiskHost.*`) ;
- `payout.batch.status_changed` (`status` = `INITIATED` ou `ON_HOLD`) ;
- `catalog.addition_request.resolved` (`status` = `APPROVED` ou `MERGED` : ajout ; `REJECTED` : refus ; hôte demandeur `host_user_id`, US-114).
- `booking.trip.host_restricted` (voyageur `guest_user_id` d'un trip à venir dont l'hôte est restreint, gabarit `EVT_TRIP_HOST_RESTRICTED` ; US-122, ADR-124).
- `booking.trip.host_restriction_lifted` (même voyageur, quand la DERNIÈRE restriction de l'hôte est levée, gabarit `EVT_TRIP_HOST_RESTRICTION_LIFTED`, textes `ntf.tripHostRestrictionLifted.*` ; US-215c, ADR-156). Depuis 0129, `booking.trip.host_restricted` n'est émis qu'au passage « aucune restriction active → restreint ».
- Demandes de réservation (US-213, ADR-157 ; parties du hold lues en base) :
  - `booking.request.received` (hôte, avec l'heure limite) ;
  - `booking.request.declined` et `booking.request.expired` (voyageur) ;
  - `booking.request.capture_unconfirmed` (voyageur et hôte) ;
  - `booking.hold.released`, seulement pour la capture refusée d'une demande acceptée (hold `REQUEST` autorisé, `RELEASED`, `PAYMENT_DECLINED`, lu en base ; voyageur et hôte).
  - `booking.request.accepted` n'a pas de message : la confirmation suit au passage `BOOKED`.
- `deposit.decision.executed` (voyageur du trip lu en base, US-702, ADR-172) : avis choisi par `notice`, posé par la base (0153, US-702b) : `RELEASED` ⇒ `EVT_DEPOSIT_RELEASED`, `PARTIALLY_CAPTURED` ⇒ `EVT_DEPOSIT_PARTIALLY_CAPTURED`, `BLOCKED_UNTIL_EXPIRY` ⇒ `EVT_DEPOSIT_BLOCKED_UNTIL_EXPIRY` (annulation de l'autorisation refusée : montant bloqué par la banque jusqu'à `auth_expiry_at`, rien de prélevé, jamais « libérée » ; 08 E3 repli 4 ; textes `ntf.depositBlockedUntilExpiry.*`, catalogue v91). `notice` absent ⇒ erreur de contrat.

- `support.help_request.received` (US-310, ADR-182, 0162) : réponse automatique hors plage au demandeur (`requester_user_id`), dans la langue de son compte, choisie par `auto_reply` posé par la base : `GUEST` ⇒ `EVT_HELP_REQUEST_OFF_HOURS` (support et assistance de l'assureur), `HOST` ⇒ `EVT_HELP_REQUEST_OFF_HOURS_HOST` (support), `NONE` ⇒ aucun message ; SMS d'abord, e-mail en repli, message critique ; aucun délai promis ; textes `ntf.helpOffHours.*` et `ntf.helpOffHoursHost.*` (catalogue v97).

Cible (17 §4.5) : NTF consomme aussi, entre autres, `iam.user.registered`, `iam.restriction.applied` / `.lifted`, `kyc.host_verification.decided`, `catalog.listing.status_changed`, `booking.hold.*`, `booking.request.*`, `settlement.computed`, `refund.instance.status_changed`, `deposit.decision.executed`, `contract.document.generated` / `.signed`, `trip.checkin.validated`, `trip.checkout.completed` (non émis : `trip.status_changed` porte la transition, motifs `CHECKIN_VALIDATED` et `CHECKOUT_VALIDATED`, US-315, ADR-183), `claim.status_changed`, `invoice.status_changed`, `message.posted` / `.flagged`, `finance.statement.issued`, `fiscal.document.status_changed`, `host_ledger.state_changed`.

## Ports

- `MessagingChannel` (`internal/messaging-channel.port.ts`, US-020) : `channel`, `send` (texte déjà rendu) ; échecs en valeurs (`OK`, `REFUSED`, `UNAVAILABLE`, `TIMEOUT`). FAKE : `FakeMessagingChannel` (`EMAIL`, `SMS`) de `@rueda/fake-adapters/messaging`, jamais en production.
- `RecipientDirectory` (`internal/recipient-directory.port.ts`, US-021) : `contactOf` ; adaptateur `postgresNotificationContacts` exporté par IAM.
- `NotificationParties` (`internal/parties.port.ts`, US-213, ADR-157) : `partiesOf(tx, 'TRIP' | 'HOLD', id)`, lu dans la transaction du reçu. L'adaptateur `postgresNotificationParties` est exporté par AVL, avec la même forme et sans dépendance AVL --> NTF. Il est injecté par `registerNotifications(registry, sender, { parties })`. Sans lui, les règles `parties` échouent en erreur de contrat.

API publique (`index.ts`) :

- `NtfModule` ;
- types du port `MessagingChannel` ;
- catalogue : `RULES`, `TEMPLATES`, `TEMPLATE_KEYS`, `subscribedEventTypes`, `isDeclinedRequestCapture` ;
- résolution : `planDispatches`, `requiredParties`, `partyKey`, `dispatchEvent`, `NTF_DISPATCHER_WORKER`, `NTF_SENDER_WORKER`, `NotificationContractError` ;
- envoi : `NotificationSender`, `MAX_SEND_ATTEMPTS`, `RETRY_BASE_SECONDS` ;
- montage : `registerNotifications` (options `rules`, `parties`), `notificationCountryData`, `repositoryLocaleConfig` ;
- types : `RecipientDirectory`, `RecipientContact`, `NotificationParties`, `PartyFacts`, `PartySubject`, `PartiesSpec`, `NotificationRegistration`.

## Commandes de test

- Unitaires (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/ntf` (`templates.test.ts`, `dispatcher.test.ts`, `sender.test.ts`, `messaging-channel.port.test.ts`).
- Intégration (PostgreSQL réel, sous `app_worker`) : `pnpm --filter @rueda/api test:int` ; fichier du module : `apps/api/test/int/ntf.int.test.ts` (seul : `pnpm --filter @rueda/api exec vitest run --config vitest.int.config.ts test/int/ntf.int.test.ts`).
- Preuves L0 en base : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-ntf-dispatch.test.ts`.

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
