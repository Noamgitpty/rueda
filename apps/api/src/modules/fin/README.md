# FIN — Finance & Tax (`apps/api/src/modules/fin`)

**FIN — Finance & Tax** : configuration fiscale, documents fiscaux, relevés de commission, rapprochements. Dépendances autorisées : STL, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 FIN --> STL).

## Responsabilité

D'après 17 §2.2 et §2.14 :

- documents fiscaux de Kmino : facture du trip fee et de ses services (PAC au Panama, SIFEN au Paraguay) ;
- relevés de gains de l'hôte (PYO-013), jamais une facture de commission ;
- rapprochements par jambe avec les relevés du PSP, exports comptables ;
- lecture du contrat d'assureur et des bordereaux, qui appartiennent à STL (dépendance FIN → STL seule).

FIN ne calcule ni le règlement ni les jambes (STL), et ne déplace pas de fonds (PAY). Le loyer de l'hôte particulier n'est pas facturé par Kmino tant que l'avis OQ-BR-14 / OQ-P2P-07 ne le demande pas (17 §3.2.13).

État du code : `FinModule` est vide (US-001). Existent le port `EInvoicingProvider` (US-020, ADR-058) et les **contrôles de rapprochement de l'argent** (US-047, ADR-087). US-217 (partie 217a, ADR-161) livre en base le reçu des gains de l'hôte, le reçu du trip fee du voyageur, le relevé mensuel et les faits de l'invariant par jambe (section ci-dessous). Restent US-541 (relevés figés, annuel), US-711 (rapprochement par jambe avec le PSP) et, pour le connecteur réel, US-604 (lot C).

## Rapprochement de l'argent (US-047, ADR-087)

`internal/money-reconciliation.ts` : tâche périodique du travailleur `reconciliation` (24 h, PROPOSÉ ; déclarée dans `apps/api/src/worker-tasks.ts`). En lecture seule, sur toute la base, elle relit les versions de règlement (`core.settlement_settlement`, `core.settlement_settlement_leg`) et les soldes par jambe (`core.settlement_trip_leg_balance`) : politiques `worker_money_read` de 0027 et 0036. Onze contrôles (codes PROPOSÉS) : `SETTLEMENT_LEGS_INCOMPLETE`, `SETTLEMENT_LEG_NEGATIVE`, `SETTLEMENT_LEGS_SUM`, `SETTLEMENT_HOST_LEG`, `SETTLEMENT_REFUND_BALANCE`, `SETTLEMENT_VARIATIONS_REFUND`, `SETTLEMENT_VERSION_CHAIN`, `LEG_BALANCE_OVERDRAWN` et, depuis US-217a (ADR-161), `TRIP_CAPTURE_LEGS` (Σ capturé = Σ des encaissements portés = Σ de leurs jambes), `TRIP_SETTLED_TOTAL` (total payé de la version en tête = encaissé), `STATEMENT_HOST_LEG` (jambe HOST du relevé de l'hôte = jambe HOST attendue, lue d'une autre source), sur les faits par trip de `core.finance_trip_leg_facts()` (0137 ; requête `tripLegFactsSql`, source `TRIP_LEG_FACTS_SOURCE`, montants et pays seulement). Leurs règles et leurs sources (08 E1, E4, E7 ; 17 §2.9, §3.2.8) sont dans l'en-tête du fichier. Le rapport ne contient que des comptes par contrôle et par pays. Tout écart lève une alerte P1 `FIN_MONEY_RECONCILIATION` par pays (runbook `docs/ops/MONITORING.md`). Un contexte autre que ce travailleur lève `MoneyReconciliationContractError` (jamais de zéros trompeurs). Les requêtes d'agrégat (`settlementAggregatesSql`, `legBalanceAggregatesSql`) lisent leurs tables en CTE (`SETTLEMENT_SOURCE`, `SETTLEMENT_LEG_SOURCE`, `LEG_BALANCE_SOURCE`) : le test d'intégration y ajoute une ligne en écart pour prouver la détection sur PostgreSQL réel, et la tâche n'utilise que les tables. Depuis US-227, quatorze contrôles (section suivante).

## Jambe de l'assureur au rapprochement (US-227, ADR-165)

Trois contrôles s'ajoutent au rapprochement nocturne, lus de `core.finance_insurer_ledger_facts()` (0143, travailleur `reconciliation`) : `INSURER_LEDGER_COLLECTION` (écritures d'encaissement du registre = jambes `INSURER` des encaissements portés), `INSURER_LEDGER_SETTLEMENT` (écritures de règlement = variations `INSURER` stockées), `INSURER_BORDEREAU_OVERBILLED` (porté par un bordereau émis ≤ prime due), à l'unité mineure, par pays. Une écriture sans contrat d'assureur est comptée (`examined.insurerUnattributed`), pas un écart.

## Reçu des gains, reçu du trip fee, relevé mensuel (US-217 partie 217a, ADR-161)

En base (migration 0137), sans table nouvelle : `host_earnings_statement` et `host_earnings_line` (17 §3.2.13) sont une **lecture calculée** des lignes immuables (version en tête du règlement, capture, devis figé, `host_ledger`), jamais un recalcul. `core.finance_earning_lines` (lignes `EARNING`, `CXL_EARNING`, `ADJUSTMENT`), `core.finance_trip_receipt_view` (vues `HOST` et `GUEST`), `core.finance_host_statement` (mois `YYYY-MM` par devise) ; les routes sont servies par AVL (`GET /trips/{tripId}/receipt`, `GET /host/accounts/{orgId}/earnings/{month}`), FIN ne dépendant pas d'IAM. Facture électronique : hors plateforme en bêta (FIN-002 MANUEL) ; entité qui facture non tranchée (ADR-013, `finance_legal_entity` vide) : le reçu n'en présente aucune.

Partie 217b (migration 0145, ADR-167) : taxe du trip fee non rendue dès qu'une part en est remboursée, aucun reçu du voyageur sans règlement ni capture, relevé séparé en acquis (`earnedMinor`) et à venir (`pendingMinor`) ; écrans A08 et S09 · reçu dans `apps/web`.

## Entités

Entités de 17 §3.2.13 possédées par FIN (17 §2.2) :

| Entité                    | État en base                                                                   |
| ------------------------- | ------------------------------------------------------------------------------ |
| `legal_entity`            | table `core.finance_legal_entity` (migration 0008, graines 0009, story US-013) |
| `fiscal_document`         | cible 17, pas encore créée                                                     |
| `fiscal_document_line`    | cible 17, pas encore créée                                                     |
| `host_earnings_statement` | lecture calculée (0137, ADR-161) : `core.finance_host_statement`               |
| `host_earnings_line`      | lecture calculée (0137, ADR-161) : `core.finance_earning_lines`                |
| `tax_remittance`          | cible 17 (§2.2 seulement, sans fiche en §3.2.13), pas encore créée             |
| `reconciliation_run`      | cible 17, pas encore créée                                                     |
| `reconciliation_item`     | cible 17, pas encore créée                                                     |

`insurer` et `insurer_contract` sont listés en §3.2.13 mais possédés par STL. Les tables d'argent de STL lues par FIN (`core.settlement_*`, migrations 0027 et 0036) sont décrites dans le README de STL. Permissions déjà semées dans `core.iam_role_permission` : `finance.read_org_statements`, `finance.platform_advance`, `finance.insurer_bordereau` (migrations 0035, 0036).

## Événements

Aucun événement n'est émis ni consommé par le code aujourd'hui.

Cible (17 §2.2, §4.5) :

- émis : `finance.statement.issued`, `fiscal.document.status_changed`, `finance.reconciliation.delta_exceeded` ;
- consommés : `settlement.legs.posted` / `.released` / `.reallocated`, `settlement.advance.*`, `insurer.bordereau.issued`, `settlement.computed`, `settlement.superseded`, `payment.operation.status_changed`, `booking.trip.booked` (mémo GMV), `claim.status_changed`, `payout.batch.status_changed`, `support.commercial_gesture.issued`.

## Ports

- `EInvoicingProvider` (`internal/e-invoicing-provider.port.ts`, US-020, ADR-058) : `supportsRegime`, `submit` (soumission idempotente d'un document fiscal), `getStatus`. Échecs en valeurs (`OK`, `REFUSED`, `UNAVAILABLE`, `TIMEOUT`) ; régime inconnu ⇒ `UNSUPPORTED_REGIME` (capacité inconnue = « non ») ; montants `bigint` en unités mineures.
- Adaptateur FAKE : `FakeEInvoicingProvider` de `@rueda/fake-adapters/e-invoicing` (tests et développement seulement, jamais en production). Connecteur réel : lot C (US-604).

API publique (`index.ts`) : `FinModule`, les types du port (`EInvoicingProvider`, `EInvoicingOutcome`, `FiscalDocumentLine`, `FiscalReceipt`, `FiscalStatus`, `SubmitFiscalDocumentRequest`) et le rapprochement (`registerMoneyReconciliation`, `runMoneyReconciliation`, `evaluateMoneyReconciliation`, `reconciliationReportJson`, `MONEY_RECONCILIATION_CHECKS`, `MONEY_RECONCILIATION_WORKER`, `MONEY_RECONCILIATION_PERIOD_SECONDS`, `MoneyReconciliationContractError`, `settlementAggregatesSql`, `legBalanceAggregatesSql`, `SETTLEMENT_SOURCE`, `SETTLEMENT_LEG_SOURCE`, `LEG_BALANCE_SOURCE`, `parseSettlementRow`, `parseLegBalanceRow`, `parseTripLegFactRow`, `TRIP_LEG_FACTS_SOURCE`, `tripLegFactsSql`, `tripLegViolations`, types `MoneyReconciliationCheck`, `MoneyReconciliationReport`, `TripLegFact`).

## Commandes de test

- Unitaires (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/fin`. Fichiers : `internal/e-invoicing-provider.port.test.ts` (conformité du FAKE au port ; une divergence casse aussi `pnpm typecheck`) et `internal/money-reconciliation.test.ts` (chaque contrôle détecte son écart dans chaque pays configuré ; lecture fail-closed ; alerte sans identifiant).
- Intégration : `apps/api/test/int/reconciliation.int.test.ts`, soit le parcours doré de règlement puis le rapprochement et l'oracle C12 sous `app_worker`, dans chaque pays configuré : `RUEDA_PG_TESTCONTAINERS=1 pnpm --filter @rueda/api test:reconciliation` (aussi dans `pnpm test:int`, et chaque nuit dans le job `rapprochement`). La table `core.finance_legal_entity` est couverte par `packages/db/test/int/config-country.test.ts` : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/config-country.test.ts`.

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
