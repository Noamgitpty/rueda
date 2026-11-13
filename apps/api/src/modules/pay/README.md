# PAY — Payments abstraction (`apps/api/src/modules/pay`)

**PAY — Payments abstraction** : adaptateurs PSP, opérations de paiement, commandes monétaires, webhooks, remboursements. Dépendances autorisées : CFG, CTR, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 (CTR : mandat)).

## Responsabilité

D'après 17 §2.2 et §2.8 : adaptateurs PSP de place de marché, compte marchand de Kmino par pays, sous-marchands hôtes, matrice de capacités, registre des opérations avec montants par jambe, boîte d'envoi des commandes monétaires, webhooks entrants, puis instruments, consentements MIT, chargebacks, remboursements (SM-8) et caution. Aucun code métier ne connaît un PSP. PAY ne calcule aucune jambe : elles viennent du règlement (STL, 08 E7).

État du code :

- **livré** : port `PaymentProvider` avec contrôles de jambes, capacités fail-closed, erreurs normalisées, clés d'idempotence, envoi des commandes monétaires, réception et traitement des webhooks, détecteur de PAN, adaptateurs PostgreSQL et garde de démarrage (US-019, ADR-059) ; méthodes de place de marché et sous-marchands (US-061, ADR-066) ;
- **FAKE seulement** : le registre des PSP de production est vide jusqu'au lot C (US-601) ; un FAKE n'est jamais actif en production (C19) ;
- **pas encore** : paiement par jambes au checkout (US-223), instruments, MIT, remboursements, caution, chargebacks, dettes.

Détail fichier par fichier, FAKE et mode hostile : [`internal/README.md`](internal/README.md).

## Entités

Entités de 17 §3.2.7 :

| Entité                     | État en base                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `payment_operation`        | table `core.payment_payment_operation` (migration 0005 ; `psp_account_id` 0028, `NOT NULL` 0038) |
| `webhook_inbox`            | table `core.payment_webhook_inbox` (migration 0005 ; clé étrangère du compte 0038)               |
| `psp_account`              | table `core.payment_psp_account` (migration 0028)                                                |
| `psp_capability`           | table `core.payment_psp_capability` (migration 0028)                                             |
| `payment_operation_leg`    | table `core.payment_payment_operation_leg` (migration 0028)                                      |
| `payment_operation_event`  | table `core.payment_payment_operation_event` (migration 0028)                                    |
| `psp_submerchant`          | table `core.payment_psp_submerchant` (migration 0039)                                            |
| `payment_command`          | table `core.payment_payment_command` (migration 0040, réduite à `CANCEL_ORDER`)                  |
| `payment_operation_link`   | cible 17, pas encore créée                                                                       |
| `payment_instrument`       | cible 17, pas encore créée                                                                       |
| `mit_consent`              | cible 17, pas encore créée                                                                       |
| `tender`                   | cible 17, pas encore créée                                                                       |
| `refund_instance`          | cible 17, pas encore créée                                                                       |
| `deposit_hold`             | cible 17, pas encore créée                                                                       |
| `chargeback`               | cible 17, pas encore créée                                                                       |
| `debt_balance`             | cible 17, pas encore créée                                                                       |
| `payment_plan`             | cible 17, pas encore créée                                                                       |
| `payment_plan_installment` | cible 17, pas encore créée                                                                       |
| `credit_lot`               | cible 17, pas encore créée                                                                       |

Hors entités de 17 : `core.payment_psp_capability_catalog` (catalogue des capacités, migration 0039 ; `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID` ajoutée par 0086, non bloquante, lue par le KYC de l'hôte : inconnue ⇒ numéro fiscal exigé avant l'activation, ADR-115). Commandes `SECURITY DEFINER` (famille `cmd_money`) : `core.payment_cmd_record_operation`, `payment_cmd_apply_operation_status`, `payment_cmd_receive_webhook` (0028), `payment_cmd_register_submerchant`, `payment_cmd_record_submerchant_status` (0039). Détail : `packages/db/README.md`, sections « Port PaymentProvider » et « Port de place de marché ».

## Événements

Aucun événement de domaine n'est émis ni consommé par le code de PAY aujourd'hui. Chaque statut reçu est écrit dans `core.payment_payment_operation_event` (pas un événement d'outbox). La commande `CANCEL_ORDER` est écrite dans `core.payment_payment_command` par les commandes du hold (AVL, migration 0040), pas par un événement.

Cible (17 §2.2, §4.5) :

- émis : `payment.received`, `payment.operation.status_changed`, `payment.chargeback.opened` / `.closed`, `refund.instance.status_changed`, `deposit.decision.executed` ;
- consommés : `booking.hold.*` et `booking.hold.release_requested` / `.superseded` (annulation d'ordre), `booking.request.*`, `booking.hold.compensation_required`, `settlement.legs.*`, `settlement.computed`, `settlement.superseded`, `insurer.bordereau.issued`, `risk.review.*`, `invoice.status_changed`, `evidence.bundle.generated`, `payment.chargeback.opened`.

## Ports

- `PaymentProvider` (`internal/port.ts`, 17 §2.8) : toute méthode qui déplace des fonds reçoit des `LegAmounts` (`MONEY_MOVING_METHODS`) ; méthodes de place de marché idempotentes (`MARKETPLACE_WRITE_METHODS`).
- `WebhookVerifier` : vérification de signature par fournisseur, utilisée par `WebhookIngestService`.
- Magasins (`internal/stores.ts`) : `OperationStatusStore`, `WebhookInboxStore`, `WebhookWorkStore`, adaptateurs PostgreSQL `PgOperationRecorder`, `PgWebhookInboxStore`, `PgWebhookWorkStore`.
- FAKE : `FakePsp` de `@rueda/fake-adapters/psp`, traduit vers le port par `testing/fake-payment-provider.ts` ; `testing/` n'est exporté par aucun index et reste hors de la compilation de production.

API publique (`index.ts`, liste complète dans le fichier) : `PayModule`, `PayWebhookModule`, `postgresPayAdapters`, `PRODUCTION_PROVIDERS` ; types et constantes du port ; jambes (`LEGS`, `assertMovingLegs`, `legSum`…) ; erreurs (`PaymentError`, `PAYMENT_ERROR_CODES`) ; capacités (`CapabilitySet`, `CAPABILITIES`) ; idempotence (`settlementOperationKey`, `holdAttemptKey`…) ; `MoneyCommandSender` ; webhooks (`WebhookIngestService`, `WebhookProcessor`) ; PAN (`containsPan`, `maskPan`) ; démarrage (`assertPaymentStartup`, `checkPaymentStartup`).

## Commandes de test

- Unitaires (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/pay` (`internal/*.test.ts`, `testing/*.test.ts` : suite de contrat du port, place de marché, webhooks, vecteurs T51, T52, T68 et TJ en USD et PYG).
- Intégration (PostgreSQL réel, sous `app_api` et `app_worker`) : `pnpm --filter @rueda/api test:int` ; fichier du module : `testing/pg-stores.int.test.ts`.
- Preuves L0 en base : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-pay-port.test.ts test/l0/l0-pay-marketplace.test.ts test/l0/l0-pay-pan.test.ts test/l0/l0-pay-legs-rls.test.ts`.

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
