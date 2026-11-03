# FIN — Finance & Tax (`apps/api/src/modules/fin`)

**FIN — Finance & Tax** : configuration fiscale, documents fiscaux, relevés de commission, rapprochements. Dépendances autorisées : STL, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 FIN --> STL).

## Responsabilité

D'après 17 §2.2 et §2.14 :

- documents fiscaux de Kmino : facture du trip fee et de ses services (PAC au Panama, SIFEN au Paraguay) ;
- relevés de gains de l'hôte (PYO-013), jamais une facture de commission ;
- rapprochements par jambe avec les relevés du PSP, exports comptables ;
- lecture du contrat d'assureur et des bordereaux, qui appartiennent à STL (dépendance FIN → STL seule).

FIN ne calcule ni le règlement ni les jambes (STL), et ne déplace pas de fonds (PAY). Le loyer de l'hôte particulier n'est pas facturé par Kmino tant que l'avis OQ-BR-14 / OQ-P2P-07 ne le demande pas (17 §3.2.13).

État du code : **squelette**. `FinModule` est vide (US-001). Seul le port `EInvoicingProvider` existe (US-020, ADR-058). Le métier arrive avec US-217 (reçu des gains, facture du trip fee), US-541 (relevés), US-711 (rapprochement par jambe) et, pour le connecteur réel, US-604 (lot C).

## Entités

Entités de 17 §3.2.13 possédées par FIN (17 §2.2) :

| Entité                    | État en base                                                                   |
| ------------------------- | ------------------------------------------------------------------------------ |
| `legal_entity`            | table `core.finance_legal_entity` (migration 0008, graines 0009, story US-013) |
| `fiscal_document`         | cible 17, pas encore créée                                                     |
| `fiscal_document_line`    | cible 17, pas encore créée                                                     |
| `host_earnings_statement` | cible 17, pas encore créée                                                     |
| `host_earnings_line`      | cible 17, pas encore créée                                                     |
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

API publique (`index.ts`) : `FinModule` et les types du port (`EInvoicingProvider`, `EInvoicingOutcome`, `FiscalDocumentLine`, `FiscalReceipt`, `FiscalStatus`, `SubmitFiscalDocumentRequest`).

## Commandes de test

- Unitaires (vitest, sans base ; config `apps/api/vitest.config.ts`) : `pnpm --filter @rueda/api exec vitest run src/modules/fin`. Seul test : `internal/e-invoicing-provider.port.test.ts` (conformité du FAKE au port ; une divergence casse aussi `pnpm typecheck`).
- Intégration et L0 : aucun test propre à FIN. La table `core.finance_legal_entity` est couverte par `packages/db/test/int/config-country.test.ts` : `pnpm --filter @rueda/db exec vitest run --config vitest.int.config.ts test/int/config-country.test.ts`.

Les tests d'intégration et L0 demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
