# Module NTF — détail (US-020, US-021)

Le `README.md` du module reste la ligne unique imposée par `dependency-graph.test.ts` (US-001) ; le détail est ici. Décisions : ADR-058 (port `MessagingChannel`), ADR-061 (moteur). Spécifications : 16 NTF-001, 17 §2.13 et §3.2.12, 10b §3.9 et §3.13.

## Chaîne d'envoi

```text
événement (outbox, US-008)
  └─ relais ─▶ ntf_dispatcher (consommateur, dans la transaction du reçu)
                 règles → destinataires (charge utile) → canaux du gabarit
                 INSERT notification_dispatch … ON CONFLICT DO NOTHING   (critère 2)
                 + une tâche ntf_sender par envoi créé
  └─ ntf_sender (minuterie, une tâche par tentative)
       coordonnées (port RecipientDirectory ← IAM, core.iam_notification_contact)
       langue du destinataire → rendu (@rueda/i18n, es / en / fr) → MessagingChannel.send
       OK ⇒ SENT · UNAVAILABLE / TIMEOUT ⇒ réessai (≤ 3) · échec définitif ⇒ repli
       repli ⇒ nouvel envoi sur le canal de repli + notification.fallback.triggered (critère 3)
       sans repli ⇒ FAILED + notification.dispatch.failed
```

| Élément (`index.ts`)                                | Rôle                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TEMPLATES`, `RULES`, `TEMPLATE_KEYS`               | Catalogue réduit de la bêta (16 NTF-001) : `EVT_KYC_APPROVED`, `EVT_BOOKING_CONFIRMED`, `EVT_BOOKING_CANCELLED`, `EVT_TRIP_OVERDUE`, `EVT_PAYOUT_SENT`, `EVT_PAYOUT_ON_HOLD`. |
| `planDispatches`, `dispatchEvent`                   | Résolution et création des envois d'un événement (travailleur `ntf_dispatcher`).                                                                                              |
| `NotificationSender`                                | Une tentative d'envoi (travailleur `ntf_sender`) : langue, rendu, port, réessais, repli, événements `notification.*`.                                                         |
| `registerNotifications`                             | Abonne `ntf_dispatcher` aux types du catalogue et déclare la minuterie `ntf_sender` sur un `BusRegistry`.                                                                     |
| `notificationCountryData`, `repositoryLocaleConfig` | Fuseau, locales et exposants lus dans CFG et `@rueda/i18n` (aucune constante pays).                                                                                           |
| `RecipientDirectory` (port)                         | Coordonnées au moment de l'envoi ; adaptateur `postgresNotificationContacts` exporté par IAM.                                                                                 |
| `MessagingChannel` (port, US-020)                   | Transport d'un texte déjà rendu ; FAKE dans `@rueda/fake-adapters/messaging`, jamais en production.                                                                           |

## Gabarits

- Textes : `packages/i18n/src/catalogs/{es,en,fr}.ts`, clés `ntf.<slug>.email.subject`, `ntf.<slug>.email.body`, `ntf.<slug>.sms.body`. Toute clé ajoutée l'est dans les trois langues (sinon `pnpm typecheck` échoue) ; `CATALOG_VERSION` monte d'un cran et est enregistrée avec chaque envoi (`template_version`).
- Variables nommées, déclarées par gabarit avec leur origine et leur type (10b UX-59) : `first_name` (relu à l'envoi), `brand` (donnée de thème), `booking_ref` (8 derniers chiffres de `trip_id`), instants (fuseau du pays de l'événement), montants (unités mineures + devise, `formatMoney`).
- Rendu refusé (`TEMPLATE_VARIABLE_MISSING`) si une variable manque ou s'il reste `{…}`, `%s`, `undefined`, `null` ou `NaN` (10b UX-60) : l'envoi échoue et se replie, jamais un « {6} » envoyé.
- Contrôles en CI (`templates.test.ts`) : chaque gabarit × chaque locale active de chaque pays × chaque canal (repli compris), avec des noms accentués, longs, un montant à 0 et un trip de plus de 30 jours ; titre d'e-mail ≤ 60 caractères, SMS ≤ 3 segments selon l'encodage réel (GSM-7 ou UCS-2, 10b UX-61).

## Contrat de charge utile (PROPOSÉ, à reporter dans 17 §4.5)

| Événement                                              | Champs lus                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `kyc.verification.status_changed` (`to = APPROVED`)    | `user_id`                                                                      |
| `booking.trip.booked`                                  | `trip_id`, `guest_user_id`, `host_user_id`, `scheduled_start`, `scheduled_end` |
| `trip.status_changed` (`to = CANCELLED_*`)             | `trip_id`, `guest_user_id`, `host_user_id`                                     |
| `trip.overdue.detected`                                | `trip_id`, `guest_user_id`, `host_user_id`, `scheduled_end`                    |
| `payout.batch.status_changed` (`INITIATED`, `ON_HOLD`) | `host_user_id`, `net_minor` (chaîne), `currency`                               |

Champ absent ou mal formé ⇒ `NotificationContractError` : la tâche échoue, est réessayée, puis part en lettre morte avec alerte (17 §4.2). Aucun envoi partiel.

## Données personnelles

- `notification_dispatch` ne contient ni adresse, ni numéro, ni prénom, ni texte : seulement des identifiants, des variables non sensibles, l'empreinte SHA-256 du texte rendu et un code d'erreur court (contrainte `^[A-Z][A-Z0-9_]{0,63}$`).
- Journaux (`NtfLogEntry`) : `dispatch_id`, canal, gabarit, issue, tentatives, code. Test : `sender.test.ts` (« journaux »).
- Coordonnées : `core.iam_notification_contact` (0029), zéro ligne hors du travailleur `ntf_sender` ; numéro et adresse rendus seulement s'ils sont vérifiés.

## Tests

- Unitaires : `templates.test.ts` (critère 1), `dispatcher.test.ts` (résolution, critère 2), `sender.test.ts` (réessais, idempotence, repli, critère 3, journaux) ; base en mémoire `ntf.test-support.ts`.
- Intégration (PostgreSQL réel, `app_worker`) : `apps/api/test/int/ntf.int.test.ts`.
- L0 : `packages/db/test/l0/l0-ntf-dispatch.test.ts` (droits, RLS, unicité, contraintes, fonction de contact).

## Non câblé (reports)

Processus `worker.ts` (US-003) ; accusés de remise `DELIVERED` / `BOUNCED` ; préférences et désinscription (`notification_preference` : le catalogue de la bêta est entièrement transactionnel, 17 §3.2.12 « transactionnel email non désactivable ») ; limitation de débit (non citée par la story) ; rappels J−1 / H−2 (minuteries TRP) ; e-mail de vérification d'IAM (`PendingIdentityNotifier`) ; habillage de marque des e-mails (US-034) ; WhatsApp (US-526) ; purge à 13 mois.
