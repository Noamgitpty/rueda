# PAY — Payments abstraction (`apps/api/src/modules/pay`)

**PAY — Payments abstraction** : adaptateurs PSP, opérations de paiement, commandes monétaires, webhooks, remboursements. Dépendances autorisées : CFG, CTR, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 (CTR : mandat)).

## Responsabilité

D'après 17 §2.2 et §2.8 : adaptateurs PSP de place de marché, compte marchand de Kmino par pays, sous-marchands hôtes, matrice de capacités, registre des opérations avec montants par jambe, boîte d'envoi des commandes monétaires, webhooks entrants, puis instruments, consentements MIT, chargebacks, remboursements (SM-8) et caution. Aucun code métier ne connaît un PSP. PAY ne calcule aucune jambe : elles viennent du règlement (STL, 08 E7).

État du code :

- **livré** : port `PaymentProvider` avec contrôles de jambes, capacités fail-closed, erreurs normalisées, clés d'idempotence, envoi des commandes monétaires, réception et traitement des webhooks, détecteur de PAN (UUID et empreintes `hex(sha256)` de 64 minuscules écartés : ADR-155, migration 0131), adaptateurs PostgreSQL et garde de démarrage (US-019, ADR-059) ; méthodes de place de marché et sous-marchands (US-061, ADR-066) ;
- **FAKE seulement** : le registre des PSP de production est vide jusqu'au lot C (US-601) ; un FAKE n'est jamais actif en production (C19) ;
- **livré par US-223 (223a, ADR-139)** : preuve par webhook seulement (montant et devise du webhook vérifiés en base, `MISMATCH` ; horodatage signé absent hors fenêtre ; aucune lecture ni réponse d'un compte LIVE ne prouve ; `UNPROVEN` et `MISMATCH` traités par `WebhookProcessor` : `FAILED` à motif dédié et alerte) ; lecture avant tout envoi sans `SUPPORTS_IDEMPOTENCY_HEADER` (N-108, `MoneyCommandSender`) ; tâches `webhook_ingest` et `booking_conversion` du travailleur (`worker-tasks.ts`) ;
- **pas encore** : routes HTTP du paiement (US-223 partie 223b), mode `REQUEST` (223c), instruments, MIT, remboursements, caution, chargebacks, dettes.

Détail fichier par fichier, FAKE et mode hostile : [`internal/README.md`](internal/README.md).

## Entités

Entités de 17 §3.2.7 :

| Entité                     | État en base                                                                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payment_operation`        | table `core.payment_payment_operation` (migration 0005 ; `psp_account_id` 0028, `NOT NULL` 0038)                                                                                                     |
| `webhook_inbox`            | table `core.payment_webhook_inbox` (migration 0005 ; clé étrangère du compte 0038)                                                                                                                   |
| `psp_account`              | table `core.payment_psp_account` (migration 0028)                                                                                                                                                    |
| `psp_capability`           | table `core.payment_psp_capability` (migration 0028)                                                                                                                                                 |
| `payment_operation_leg`    | table `core.payment_payment_operation_leg` (migration 0028)                                                                                                                                          |
| `payment_operation_event`  | table `core.payment_payment_operation_event` (migration 0028)                                                                                                                                        |
| `psp_submerchant`          | table `core.payment_psp_submerchant` (migration 0039)                                                                                                                                                |
| `payment_command`          | table `core.payment_payment_command` (migration 0040, réduite à `CANCEL_ORDER`)                                                                                                                      |
| `payment_operation_link`   | cible 17, pas encore créée                                                                                                                                                                           |
| `payment_instrument`       | cible 17, pas encore créée                                                                                                                                                                           |
| `mit_consent`              | cible 17, pas encore créée                                                                                                                                                                           |
| `tender`                   | cible 17, pas encore créée                                                                                                                                                                           |
| `refund_instance`          | cible 17, pas encore créée                                                                                                                                                                           |
| `deposit_hold`             | `core.payment_deposit_hold` (0146, US-701 ; 0149, US-702) : décision figée par hold avant le paiement, décision exécutée (capturé, libéré), lue et écrite par les seules fonctions de cmd_hold_owner |
| `chargeback`               | cible 17, pas encore créée                                                                                                                                                                           |
| `debt_balance`             | cible 17, pas encore créée                                                                                                                                                                           |
| `payment_plan`             | cible 17, pas encore créée                                                                                                                                                                           |
| `payment_plan_installment` | cible 17, pas encore créée                                                                                                                                                                           |
| `credit_lot`               | cible 17, pas encore créée                                                                                                                                                                           |

Hors entités de 17 : `core.payment_psp_capability_catalog` (catalogue des capacités, migration 0039 ; `SUPPORTS_PAYOUT_WITHOUT_HOST_TAX_ID` ajoutée par 0087, non bloquante, lue par le KYC de l'hôte : inconnue ⇒ numéro fiscal exigé avant l'activation, ADR-115). Commandes `SECURITY DEFINER` (famille `cmd_money`) : `core.payment_cmd_record_operation`, `payment_cmd_apply_operation_status`, `payment_cmd_receive_webhook` (0028), `payment_cmd_register_submerchant`, `payment_cmd_record_submerchant_status` (0039). Détail : `packages/db/README.md`, sections « Port PaymentProvider » et « Port de place de marché ».

## Caution « comme Turo » (US-225 ; 08 BR-PAY-06 ; ADR-108, ADR-164)

**Aucune caution par défaut.** Une caution n'existe que si un déclencheur paramétré par pays est vrai (`deposit_always_required`, `deposit_trigger_classes` = {LUXE}, âge sur `deposit_young_driver_classes` = vide au PA et au PY, signal de risque si `risk_control_deployed`) : graine `0142`, valeurs PROPOSÉES. Au checkout, avant le paiement, `decideDepositGate` rend `NOT_REQUIRED` (aucun rail évalué), `REQUIRED` avec le rail choisi par configuration, ou un refus (`PARAM_MISSING` si `deposit_amount` manque, `DEPOSIT_RAIL_UNAVAILABLE` avec les jours possibles). Le rail « débit puis remboursement » reste fermé tant que `funds_holding_enabled[pays]` = `false` (aucun fonds de tiers détenu) ; une capacité PSP inconnue vaut « non ». `planDepositDecision` et `DepositRailExecutor` exécutent la décision sur le port (FAKE seulement) avec le montant explicite de chaque commande. **Non branché** au checkout ni à un travailleur dans cette story : `deposit_hold`, l'écriture au checkout, les minuteries et l'écran S05 sont à US-701 / US-702 (voir `docs/team/handoffs/US-225.md`).

### Caution figée au checkout, vue du voyageur, minuterie (US-701 ; ADR-169)

- `DepositCheckoutGate` (`internal/deposit-checkout.ts`) : `view` (S05 : décision figée, ou évaluée **sans écriture** tant qu'un paiement est possible) et `enforce` (avant T1 : refus ⇒ aucune ligne ; sinon décision figée une fois par `core.payment_cmd_record_deposit_decision`, `EXISTING` ensuite). `evaluateDepositCheckout` (pur) rend la décision, la ligne à figer (mécanisme, déclencheurs [C2], instantané des paramètres [C2], montant, `H_requise`, `V`, échéancier de `planDepositSchedule`) et la vue du voyageur `DepositGuestView` (statut, montant, devise, `HOLD` / `CHARGE`, libération ; ou refus et jours possibles), jamais un champ [C2]. Âge des conducteurs et signal de risque non lus ici : inconnus, donc fail-closed (suite S-10).
- `PgDepositCheckoutStore` (`internal/pg-deposit-checkout.ts`) sous `app_api` : `core.payment_deposit_checkout`, `core.payment_cmd_record_deposit_decision` (0146).
- `DepositReauthTimer` / `registerDepositTimers` (`internal/deposit-timer.ts`) : tâche `deposit_timer` (60 s, nom `payment_command`) ; file `core.payment_deposit_reauth_due`, ré-autorisation par le port hors transaction, transition `core.payment_cmd_deposit_transition` (rang attendu) ; refusée ⇒ décision avancée à `expiration − deposit_safety_h`, alerte `DEPOSIT_REAUTH_FAILED`, aucun débit ; en cours ou inconnue ⇒ aucun changement, même clé au passage suivant. Aucun connecteur en production avant le lot C.
- `DepositRailExecutor.reauthorize` : `SUCCEEDED` seul ⇒ `REAUTHORIZED` ; `PENDING` / `SUBMITTED` / `UNKNOWN` / `UNKNOWN_OUTCOME` ⇒ `REAUTH_PENDING` (`needsLookup`).
- Clés d'idempotence (S-6, 08 E4) : `{trip}:{segment}:v0-DEPOSIT-{caution}:{opération}:{moyen}:i{n}:a{m}` (`depositOperationKey`) ; remboursement du rail (b) = `offSettlementRefundKey` d'origine `DEPOSIT`.

### Décision de la caution à l'heure de décision (US-702 ; ADR-172)

- **Échéancier recalculé par la base** : `core.payment_cmd_record_deposit_decision` (0149) ignore `provider`, `authAt`, `releaseAt`, `decisionAt`, `reauthDueAt` de la décision envoyée et les recalcule (compte marchand du pays, durées `auth_lead_h`, `release_delay_h`, `deposit_safety_h`, `deposit_reauth_lead_h` lues en base) ; `V` reste l'instantané, borné. Le site lit toujours la libération figée en base.
- `DepositDecisionTimer` / `PgDepositDecisionStore` (`internal/deposit-decision.ts`), dans la tâche `deposit_timer` après les ré-autorisations : file `core.payment_deposit_decision_due` (décision échue ou autorisation expirée ; rien ne la suspend), plan `planDepositDecision`, exécution `DepositRailExecutor.execute` hors transaction, transition finale `core.payment_cmd_deposit_decide` (rang attendu, Σ capturé + libéré = montant) qui écrit `deposit.decision.executed`. Autorisation expirée ⇒ `EXPIRED` sans appel ; issue inconnue ⇒ même clé au passage suivant ; VOID refusé ⇒ laissée expirer, `DEPOSIT_DECISION_FAILED` ; MIT impossible ⇒ libérée quand même, `DEPOSIT_FEES_UNCOLLECTED`.
- `DepositFeeSource` : frais annexes et carte du consentement MIT ; en production `NO_DEPOSIT_FEES` (aucun registre des frais annexes encore : caution libérée en entier, frais ensuite par MIT, PROPOSÉ).

## Événements

Émis par une fonction de la base appelée par PAY : `deposit.decision.executed` (0149, US-702 ; `deposit_id`, `trip_id`, `status`, `captured_minor`, `released_minor`, `currency`, `decided_at`), consommé par NTF (avis au voyageur). Aucun autre événement de domaine n'est émis ni consommé par le code de PAY aujourd'hui. Chaque statut reçu est écrit dans `core.payment_payment_operation_event` (pas un événement d'outbox). La commande `CANCEL_ORDER` est écrite dans `core.payment_payment_command` par les commandes du hold (AVL, migration 0040), pas par un événement.

Cible (17 §2.2, §4.5) :

- émis : `payment.received`, `payment.operation.status_changed`, `payment.chargeback.opened` / `.closed`, `refund.instance.status_changed`, `deposit.decision.executed` ;
- consommés : `booking.hold.*` et `booking.hold.release_requested` / `.superseded` (annulation d'ordre), `booking.request.*`, `booking.hold.compensation_required`, `settlement.legs.*`, `settlement.computed`, `settlement.superseded`, `insurer.bordereau.issued`, `risk.review.*`, `invoice.status_changed`, `evidence.bundle.generated`, `payment.chargeback.opened`.

## Ports

- `PaymentProvider` (`internal/port.ts`, 17 §2.8) : toute méthode qui déplace des fonds reçoit des `LegAmounts` (`MONEY_MOVING_METHODS`) ; méthodes de place de marché idempotentes (`MARKETPLACE_WRITE_METHODS`).
- `WebhookVerifier` : vérification de signature par fournisseur, utilisée par `WebhookIngestService`.
- Magasins (`internal/stores.ts`) : `OperationStatusStore`, `WebhookInboxStore`, `WebhookWorkStore`, adaptateurs PostgreSQL `PgOperationRecorder`, `PgWebhookInboxStore`, `PgWebhookWorkStore`. US-224 (ADR-145) : `PgOperationRecorder.record` appelle la commande à 15 arguments ; un ordre REFUND / LEG_REALLOCATION / LEG_RELEASE d'un trip porte `settlement` (identifiant et version en tête du règlement), sinon la base le refuse ; un webhook de ces ordres sans montant ne les prouve pas (`UNPROVEN`). US-224b (ADR-147) : `PgRefundPlanner` planifie un remboursement de règlement (`plan` : instance SM-8, avance de Kmino attendue si la part HOST est déjà versée, ordre PENDING) et autorise son envoi (`submit` : `SUBMITTED`, `DUPLICATE`, `SUPERSEDED` ou `BLOCKED` avec son motif, tant qu'une avance n'a pas de décision FINANCE à deux personnes) ; l'appel au PSP ne suit que `SUBMITTED`. US-224c (ADR-150) : `PgRefundOrders` (`due` : file de l'ordonnanceur ; `orderForSend` : ordre stocké relu sous les verrous du trip et de l'ordre, gardés pendant l'appel au PSP, refus `NOT_SUBMITTED`, `FINAL`, `SUPERSEDED_UNSENT`, `NO_TARGET` ; `markAlerted` ; `applyLegMovement`) ; `PaymentConnectorRegistry` et `PRODUCTION_PAYMENT_CONNECTORS` (aucun connecteur avant le lot C) ; `REFUND_INSTANCE_STATUSES` (types resserrés de `PgRefundPlanner`, N-227). US-224f (ADR-166) : `PgRefundOrders.awaitChoice` (instance `FAILED` après un rejet confirmé ⇒ `PENDING_CUSTOMER_CHOICE`, `attempt_no` + 1 ; `DUPLICATE`, `SUPERSEDED`) ; la base refuse un rail natif sur un moyen autre qu'une carte et tout remboursement d'un moyen au-delà de ce qu'il a payé.
- FAKE : `FakePsp` de `@rueda/fake-adapters/psp`, traduit vers le port par `testing/fake-payment-provider.ts` ; `testing/` n'est exporté par aucun index et reste hors de la compilation de production.

API publique (`index.ts`, liste complète dans le fichier) : `PayModule`, `PayWebhookModule`, `postgresPayAdapters`, `PRODUCTION_PROVIDERS` ; types et constantes du port ; jambes (`LEGS`, `assertMovingLegs`, `legSum`…) ; erreurs (`PaymentError`, `PAYMENT_ERROR_CODES`) ; capacités (`CapabilitySet`, `CAPABILITIES`) ; idempotence (`settlementOperationKey`, `holdAttemptKey`…) ; `MoneyCommandSender` ; webhooks (`WebhookIngestService`, `WebhookProcessor`) ; PAN (`containsPan`, `maskPan`) ; démarrage (`assertPaymentStartup`, `checkPaymentStartup`).

## Commandes de test

- Unitaires (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/pay` (`internal/*.test.ts`, `testing/*.test.ts` : suite de contrat du port, place de marché, webhooks, vecteurs T51, T52, T68 et TJ en USD et PYG).
- Intégration (PostgreSQL réel, sous `app_api` et `app_worker`) : `pnpm --filter @rueda/api test:int` ; fichier du module : `testing/pg-stores.int.test.ts`.
- Preuves L0 en base : `pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-pay-port.test.ts test/l0/l0-pay-marketplace.test.ts test/l0/l0-pay-pan.test.ts test/l0/l0-pay-legs-rls.test.ts`.

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
