# STL — Settlement engine & Ledger (`apps/api/src/modules/stl`)

**STL — Settlement engine & Ledger** : règlement économique pur, grand livre en partie double, host_ledger, commission. Dépendances autorisées : PRC, PAY, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 STL --> PAY, PRC (rupture du cycle STL ↔ PAY)).

## Responsabilité

STL calcule ce qui est dû après un événement de trip (annulation, fin, requalification). Il découpe ce dû en quatre jambes (`HOST`, `INSURER`, `TAX_THIRD_PARTY`, `PLATFORM`, 08 E7). Il tient les soldes par trip, segment et jambe, le grand livre, le `host_ledger` (SM-6b), l'`insurer_ledger` avec ses bordereaux, et les avances de Kmino (17 §2.2, §2.9).

STL ne déplace aucun fonds lui-même. Il planifie des commandes que PAY exécute auprès du PSP (17 §4.3). Il ne verse rien à l'hôte : c'est PYO.

État réel du code :

- Le module Nest de ce dossier est un **squelette** : `internal/` contient `settlement-review.ts` (US-224) et `trip-cancellation.ts` (US-215) ; `index.ts` exporte `StlModule`, `settleOrFinReview` et le règlement des annulations (`TripCancellationProcessor`, `registerTripCancellations`, `planCancellation`).
- Le **moteur pur** vit dans `packages/money` (US-017 : moteur des annulations ; US-018 : règlement persistable, versions, jambes). Voir [`packages/money/README.md`](../../../../../packages/money/README.md), sections « Moteur de règlement » et « Règlements persistés ».
- La **persistance** vit en base (US-018, US-062, US-061). Voir [`packages/db/README.md`](../../../../../packages/db/README.md), sections « Règlements et jambes », « Rôle P2P_HOST, tables d'argent et minimisation » et « Port de place de marché ».
- Restent à venir : le grand livre en partie double (US-530), le service qui ordonne les remboursements et alerte FIN sur un envoi retenu (US-224 partie 224c, US-215 ; l'instance et l'avance sont en base depuis 224b, ADR-147), le recouvrement des avances (US-709), l'ordre de reversement à l'assureur (lot C ; registre et bordereaux : US-227, ADR-165), le moteur complet (US-518).

## Entités

Bêta (17 §10 point 3) : schéma unique `core`, tables préfixées `settlement_`.

| Entité (17 §3.2.8)                         | État                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `settlement`                               | table `core.settlement_settlement` (migration 0027)                                                    |
| `settlement_line`                          | table `core.settlement_settlement_line` (migration 0027)                                               |
| `settlement_leg`                           | table `core.settlement_settlement_leg` (migration 0027)                                                |
| `trip_leg_balance`                         | table `core.settlement_trip_leg_balance` (migration 0027)                                              |
| `finance_approval` (listée en 17 §3.2.9)   | table `core.settlement_finance_approval` (migration 0036)                                              |
| `platform_advance`                         | table `core.settlement_platform_advance` (migration 0036)                                              |
| `insurer_ledger_state`                     | table `core.settlement_insurer_ledger_state` (migration 0036)                                          |
| `insurer_bordereau`                        | table `core.settlement_insurer_bordereau` (migration 0036)                                             |
| `insurer_bordereau_line`                   | table `core.settlement_insurer_bordereau_line` (migration 0036)                                        |
| `ledger_account`                           | cible 17, pas encore créée                                                                             |
| `journal_entry`                            | cible 17, pas encore créée                                                                             |
| `journal_line`                             | cible 17, pas encore créée                                                                             |
| `account_balance`                          | cible 17, pas encore créée                                                                             |
| `host_ledger_state`                        | table `core.settlement_host_ledger_state` (migration 0167, SM-6b : BALANCED, NEGATIVE, WRITTEN_OFF)    |
| `host_ledger[hôte][devise]` (17 §2.9)      | table `core.settlement_host_ledger_entry` (migration 0129)                                             |
| `insurer`, `insurer_contract` (17 §3.2.13) | tables `core.settlement_insurer`, `core.settlement_insurer_contract` (0081 ; colonnes et clés de 0143) |
| `insurer_ledger` (17 §2.9)                 | table `core.settlement_insurer_ledger_entry` (migration 0143)                                          |

Tables présentes en base mais absentes des listes d'entités de 17 :

- `core.settlement_settlement_tax_line` (migration 0027) : taxes par ligne du règlement ;
- `core.settlement_leg_movement` (migration 0039) : un mouvement de jambe par opération de paiement, écrit par `core.settlement_cmd_apply_leg_movement`.

Écritures : uniquement par les commandes `SECURITY DEFINER` du propriétaire `cmd_money_owner` :

- `core.settlement_cmd_record` (0027, travailleur `settlement`) ;
- `core.settlement_cmd_apply_leg_movement` (0039, travailleur `payment_command`) ;
- `core.settlement_cmd_request_finance_action` et `core.settlement_cmd_approve_finance_action` (0036, `app_api`, décision FINANCE à deux personnes).

Gardes ajoutées par les correctifs de la red team argent (US-049, migration 0054, ADR-088) :

- **Rejeu du règlement en base** : le trigger différé `settlement_balanced` rejoue les entrées `inputs` de chaque version par `core.settlement_verify_cxl_beta_1` (vérificateur indépendant du moteur `cxl-beta/1`, aucun montant produit) et refuse tout écart (`settlement_replay_mismatch`) ; une version n+1 porte sur le même trip canonique que la version n (`settlement_trip_inputs_changed`) ; une version de moteur sans vérificateur est refusée.
- **Remboursement borné par le règlement** : `settlement_cmd_apply_leg_movement` refuse un `REFUND` sans règlement du segment, ou qui dépasse, jambe par jambe, − Σ variations de la chaîne de versions (jamais de prorata).
- **Versement gardé** : `core.settlement_release_blocker` refuse un `LEG_RELEASE` (dès l'enregistrement de l'ordre, puis au report sur les soldes) tant que le trip n'est pas `COMPLETED`, que `release_at` n'est pas atteint, que l'hôte n'est pas sous-marchand `ACTIVE`, ou que `insurer_contract_active` / `payouts_enabled` du pays valent false. `funds_holding_enabled` est exigé pour un compte qui ne partage pas à la source.

Service appelant du moteur (US-224, ADR-145, BOARD N-13 (a)) : `settleOrFinReview(calcul, pays, alertes)` (exporté par `index.ts`) attrape `REFUND_OUT_OF_RANGE` du moteur, n'écrit ni n'envoie rien, lève l'alerte P1 `FIN_SETTLEMENT_REVIEW` (comptes et codes seulement) et rend `SettlementError.details` à l'appelant (annulation d'US-215), qui l'inscrit avec la référence du trip. Les ordres d'un règlement sont calculés par `settlementOrders` (`@rueda/money`) et enregistrés par la commande PAY à 15 arguments, rattachés à la version en tête et bornés en base dès l'enregistrement (migration 0121).

## Événements

Aucun événement n'est encore émis par le code : aucune commande STL n'écrit dans l'outbox.

Cible (17 §4.5) :

- émis : `settlement.computed`, `settlement.superseded`, `settlement.legs.posted` / `.released` / `.reallocated`, `settlement.advance.opened` / `.recovered` / `.written_off`, `insurer.bordereau.issued`, `host_ledger.state_changed` ;
- 17 §2.2 cite aussi `ledger.entry.posted`, absent du catalogue §4.5 ;
- consommés : `trip.cancellation.qualified` (AVL), `payment.operation.status_changed` (PAY), `refund.instance.status_changed` (PAY), `trip.checkout.completed` (TRP) (non émis : `trip.status_changed` porte la transition, motifs `CHECKIN_VALIDATED` et `CHECKOUT_VALIDATED`, US-315, ADR-183), `dispute.opened` / `.decided` (CLM), `message.posted` (MSG, lecture de la preuve `hostMessageTraced`).

## Ports

Aucun port propre à STL. L'API publique de `index.ts` se limite à `StlModule`.

- Le moteur pur est l'API de `@rueda/money` : `computeCancellationSettlement`, `buildSettlementRecord`, `settlementRecordPayload`, `settlementDelta`, `settlementOperationKey`.
- Les mouvements de fonds passent par le port `PaymentProvider` de PAY (`releaseLeg`, `transferFromPlatform`, etc.) et son adaptateur FAKE (`packages/fake-adapters`, sous-chemin `psp`).
- Les codes d'erreur de la base (`SETTLEMENT_EXISTS`, `SETTLEMENT_STALE`, `SETTLEMENT_UNBALANCED`, `LEG_AMOUNT_NEGATIVE`, `LEG_ALREADY_RELEASED`, `IMMUTABLE_RECORD` ; rejeu et gardes de 0054 : `INVARIANT_VIOLATION`, `INVALID_TRANSITION`, `HOST_PAYOUT_RAIL_UNAVAILABLE`, `FORBIDDEN`) sont traduits par `translateDbError` de `@rueda/db`.

## Commandes de test

Le dossier du module ne contient aucun test. Commande unitaire (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/stl --passWithNoTests
```

Tests du moteur (sans base, vecteurs dorés T et TJ, en USD et en PYG) :

```bash
pnpm --filter @rueda/money exec vitest run test/settlement
```

Preuves L0 en base (sous les rôles de production) :

```bash
pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-stl-settlement.test.ts
pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-us062-host-money.test.ts
pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-pay-marketplace.test.ts
pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/l0-us049-money-fixes.test.ts
pnpm --filter @rueda/db exec vitest run --config vitest.l0.config.ts test/l0/redteam-argent
```

Intégration du schéma (RLS, politiques, droits, triggers) :

```bash
pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/stl-schema.test.ts
```

Les tests L0 et d'intégration demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.

## Annulations déclenchées par l'ops (US-215, ADR-148)

`TripCancellationProcessor` (`internal/trip-cancellation.ts`), tâche périodique `trip_lifecycle` (10 s, 50 demandes par passage, une par transaction) déclarée par `registerTripCancellations` (`worker-tasks.ts`). Pour chaque demande `PENDING` de la console : faits lus sous verrous (`core.booking_trip_cancellation_begin`), trip tiré du devis figé **rejoué** (PRC : `replayFrozenQuote`, `quoteSettlementTrip` ; départ et réservation de la base), paramètres du pays lus en base (`cancellationParams`, aucun défaut), moteur unique (`buildSettlementRecord`, `cxl-beta/1`) dans `settleOrFinReview`, ordres de `settlementOrders` (réaffectation puis remboursement du moyen d'origine, montant explicite de chaque jambe) ; puis, dans la MÊME transaction, `core.settlement_cmd_record` (travailleur `settlement`), `core.booking_cmd_trip_settle_cancellation` (`trip_lifecycle`) et la commande PAY à 15 arguments (`payment_command`, capture d'origine du loyer). Refus déterministes garés (`FAILED`, alerte `TRIP_CANCELLATION_FAILED` ; `FIN_REVIEW`, alerte `FIN_SETTLEMENT_REVIEW`), interblocage repris au passage suivant ; seuls des comptes et des codes sont journalisés.

## Ordonnanceur des remboursements (US-224 partie 224c, ADR-150)

`RefundScheduler` (`internal/refund-scheduler.ts`), tâche périodique `refund_scheduler` (10 s, 50 instances par passage, une par transaction sous le nom `payment_command`) déclarée par `registerRefundScheduler` (`worker-tasks.ts`, registre `PRODUCTION_PAYMENT_CONNECTORS` de PAY : vide avant le lot C). File `core.payment_refunds_due` (0127) : `PLANNED` ⇒ envoi autorisé (`PgRefundPlanner.submit`) puis, dans la MÊME transaction, ordre stocké relu sous les verrous du trip et de l'ordre (`PgRefundOrders.orderForSend`) et envoyé par `MoneyCommandSender` au connecteur du fournisseur (montant explicite de chaque jambe, clé stockée) ; `SUBMITTED` / `SENT` ⇒ même envoi (lecture d'abord si l'issue est inconnue) ; `CONFIRMED` prouvé ⇒ report (`core.settlement_cmd_apply_leg_movement`) ; `FAILED` ⇒ alerte. Sans connecteur : rien n'est autorisé ni envoyé. Alertes `FIN_REFUND_BLOCKED` (avance sans décision FINANCE, critère 4) et `FIN_REFUND_FAILED` (P1, une fois par état : `refund_instance.fin_alert`). L'instance suit l'ordre (déclencheur `refund_instance_sync` : `SENT`, `CONFIRMED`, `FAILED`). Preuves : `refund-scheduler.test.ts` (unitaires, TJ02b / TJ08b), `refund-scheduler.int.test.ts` (PostgreSQL réel, annulation réglée par le vrai processeur puis envoyée, prouvée et reportée, T03 / T27), `packages/db/test/l0/l0-us224c-refund-scheduler.test.ts`.

## `host_ledger` minimal (US-709a, ADR-153)

La pénalité de l'hôte qui annule (`host_penalty_minor` du règlement, 08 E7 règle 7) est écrite au `host_ledger` (`core.settlement_host_ledger_entry`, migration 0129) par la base elle-même, dans la transaction de `TripCancellationProcessor` : la liaison du règlement à la demande (`core.booking_cmd_trip_settle_cancellation`) déclenche `core.settlement_cmd_post_host_penalty`. Aucun code de l'API n'écrit ni ne lit le `host_ledger` ; FINANCE et ADMIN du pays lisent le solde par hôte et par devise (`core.settlement_host_ledger_balance_v`). Aucune retenue sur un versement (GL-33, suite US-709 / US-314).

**Créance de la règle 3 bis (US-224e, ADR-163).** Quand une avance de Kmino sur une jambe `HOST` déjà versée devient effective (`OPEN`, au report du remboursement par `core.settlement_cmd_apply_leg_movement`, `RefundScheduler`), la base écrit dans la même instruction la créance de l'hôte (`RELEASED_LEG_ADVANCE`, montant de l'avance stockée, 08 TJ18b / TJ18d) par le déclencheur `platform_advance_receivable_posted`. Aucun code de l'API n'y participe ; aucun recouvrement (`NETTING`, SM-6b) avant US-709.

**Grand livre de l'hôte, chargebacks et compensation (US-709, ADR-187).** Un chargeback perdu est imputé par la base au statut `SUCCEEDED` (`core.settlement_cmd_impute_chargeback`, migration 0167) : reprise sur l'hôte `max(0, versé − payable après)` au `host_ledger` de la devise du trip (0 sur un trip réalisé), créance du voyageur et perte de Kmino dans `core.settlement_chargeback_imputation`, jambes de 08 E7 règle 7 ; la fonction pure `chargebackImputation` de `@rueda/money` (T53, T54, T55, T67, TJ14) en est la référence. Un chargeback ouvert gèle HOST et INSURER ; décidé, la base dégèle. La compensation d'un lot (US-708) est écrite au grand livre (`PAYOUT_NETTING`) et recouvre les avances de Kmino ; l'état SM-6b est projeté dans `core.settlement_host_ledger_state` ; un passage en perte à deux personnes écrit `RECEIVABLE_WRITE_OFF`. Aucun code de l'API n'écrit ces tables.

**Remboursement réparti sur les moyens d'origine (US-224f, ADR-166).** Le processeur des annulations lit tous les encaissements réussis du loyer du trip (`tendersOf` : capture, débit MIT, recouvrement, devise du trip, ordre des captures, montant déjà engagé sur chacun) et `ordersByTender` (pur) en tire un ordre par moyen : 08 E2 décide le montant de chaque moyen (`refundsByTender` de `@rueda/money`), la règle 10 ses jambes ; la réaffectation est rattachée au premier moyen de la cascade ; clé `…:REFUND:{moyen}:i1:a1`. Bêta (fail-closed) : seule la carte est remboursée (`NATIVE_PARTIAL`) ; un moyen non natif ou un crédit qui doit rembourser quelque chose ⇒ `REFUND_RAIL_UNAVAILABLE`, rien n'est écrit, la demande est garée avec une alerte. L'ordonnanceur (`RefundScheduler`) fait passer une instance en échec confirmé à `PENDING_CUSTOMER_CHOICE` (`attempt_no` + 1, `PgRefundOrders.awaitChoice`) dans la transaction qui pose l'alerte `FIN_REFUND_FAILED` ; aucun autre rail n'est ouvert en bêta.

**Durcissement argent n° 2 (US-224, ADR-166 n° 7 et 8, BOARD N-364, N-365).** L'ordonnanceur appelle l'attente du choix (`awaitChoice`) AVANT la marque de l'alerte (`markAlerted`) ; la base prend dans les deux le verrou du trip puis la ligne de l'instance (migration 0152), l'ordre de la supersession : aucun interblocage (preuve à deux connexions, `packages/db/test/l0/l0-us224-await-choice-race.test.ts`). `classify` gare `FIN_REVIEW` un `REFUND_OUT_OF_RANGE` où qu'il soit levé (moteur ou 08 E2 des moyens dans `ordersByTender`), avec l'alerte `FIN_SETTLEMENT_REVIEW` ; les autres refus du moteur restent `FAILED`.

## Registre et bordereau de l'assureur (US-227, ADR-165)

La jambe `INSURER` est écrite au registre de l'assureur (`core.settlement_insurer_ledger_entry`, migration 0143) par la base elle-même, dans la transaction de sa source : chaque encaissement porté sur les soldes (`COLLECTION`, jambe de l'opération) et chaque version de règlement (`SETTLEMENT_VARIATION`, variation stockée ; une version n+1 n'écrit que sa variation depuis la version n). Une variation sur un trip déjà porté par un bordereau émis est refusée (`insurer_leg_on_bordereau`) : l'annulation de l'ops est garée `FIN_REVIEW`. La tâche `bordereau` (`internal/insurer-bordereau.ts`, 24 h, `registerInsurerBordereaux` dans `worker-tasks.ts`) appelle `core.settlement_cmd_draft_insurer_bordereaux(NULL)` : bordereau DRAFT du mois clos par contrat, projection `insurer_ledger_state`. L'émission reste `ISSUE_BORDEREAU` à deux personnes FINANCE (console d'US-101), gardée par `insurer_bordereau_issue_check`. Aucun paiement à l'assureur (lot C, GL-42). Preuves : `insurer-bordereau.test.ts`, `packages/db/test/l0/l0-us227-insurer-ledger.test.ts`.
