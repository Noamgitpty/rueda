# RPT — Reporting (`apps/api/src/modules/rpt`)

**RPT — Reporting** : vues de lecture (tableaux de bord, KPI), exports CSV. Dépendances autorisées : IAM, KYC, CAT, AVL, PRC, CTR, PAY, STL, PYO, TRP, CLM, MSG, NTF, REV, SUP, FIN, RISK (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 (« lecture seule de tous »)).

## Responsabilité

RPT sert des vues de lecture (17 §2.2, §2.14) :

- tableau de bord de l'hôte ;
- vue des retards pour l'ops ;
- KPI de sortie de bêta S1 à S4 (18 §1.1) ;
- exports CSV.

RPT n'écrit jamais dans les données d'un autre module. Il lit tous les modules, mais seulement en lecture.

État réel du code : **US-311** (ADR-194, PROPOSÉ) livre les vues de la bêta, les KPI de sortie, les exports CSV et les routes du rapprochement par jambe assisté (`RptConsoleModule`, `internal/console.controller.ts`, magasin `internal/store.ts`, CSV `internal/csv.ts`). Les tables et commandes du rapprochement sont de FIN (README de FIN) ; RPT ne fait que transmettre l'empreinte de la session aux portes de la base, qui jugent la permission et le pays.

## Routes de la console (US-311)

| Route                                                                                                                                                                                                                                         | Permission (base)        | Rôles                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------- |
| `GET /console/beta-views/{view}?country=` (`handovers-today`, `overdue`)                                                                                                                                                                      | `report.ops_views`       | OPS_AGENT, ADMIN          |
| `GET /console/beta-views/exit-kpi?country=`                                                                                                                                                                                                   | `report.exit_kpi`        | OPS_AGENT, FINANCE, ADMIN |
| `POST /console/reports/exports` (CSV ; `source` : vue, `OPERATIONS`, `LEGS`, `RUN_ITEMS`)                                                                                                                                                     | celle de la source       | selon la source           |
| `POST /console/reconciliation/runs`, `GET /console/reconciliation/runs?country=`, `GET /console/reconciliation/runs/{runId}`, `POST /console/reconciliation/items/{itemId}/resolution`, `POST /console/reconciliation/runs/{runId}/signature` | `finance.reconciliation` | FINANCE, ADMIN            |

Toutes : StaffGuard (session élevée par TOTP), pays du rôle seulement, refus journalisés, aucune donnée personnelle ; chaque export CSV écrit une ligne `BULK_EXPORT` au journal d'accès avec son motif. Sans magasin (`UnavailableReportStore`) : 503 `REPORT_UNAVAILABLE`. Codes : `RECON_STATEMENT_MISSING`, `RECON_FORMAT_INVALID` (16 FIN-005), `RECON_CHECKLIST_INCOMPLETE`, `RECON_RUN_CLOSED`, `RECON_ITEM_SETTLED` (PROPOSÉS), messages `common.reconciliation.*` (es, en, fr, pt-BR, catalogue v109). Procédure : `docs/ops/RAPPROCHEMENT_MENSUEL.md`.

## Entités

RPT ne possède aucune table (17 §2.2 : « vues matérialisées uniquement »). Migration 0174 : trois vues **non matérialisées** `WITH (security_invoker = true)`, propriété d'`iam_staff_owner`, lues seulement par la porte `core.report_staff_beta_view` (aucun droit applicatif direct) : `core.report_handover_day_v` (remises et retours du jour au fuseau du trip, validations, clés), `core.report_overdue_v` (retards vivants, minutes de retard à l'heure serveur), `core.report_exit_kpi_v` (S1, S2, S4 calculés à chaque lecture ; S3 non mesurable avant US-309). Une vue matérialisée n'est pas retenue en bêta : les KPI doivent être exacts à la lecture (ADR-194).

## Événements

RPT n'émet aucun événement (17 §2.2). Aucun abonnement n'existe encore dans le code. Un consommateur fictif `rpt_other` sur `review.published` sert seulement de donnée de test au bus (`apps/api/src/modules/bus/internal/bus.test.ts`).

Cible : 17 §4.5 cite RPT parmi les consommateurs de `catalog.listing.status_changed`, `booking.hold.*`, `booking.payment.late_ignored`, `settlement.legs.*`, `booking.trip.booked`, `trip.status_changed`, `notification.dispatch.failed`, `review.published`, `finance.statement.issued`, `finance.reconciliation.delta_exceeded` et `support.review_queue.sla_breached`.

## Ports

Aucun port. API publique (`index.ts`) : `RptModule`, `RptConsoleModule`, `PgReportStore`, `UnavailableReportStore`, `ReportStoreError`, `REPORT_MESSAGES`, `ReportHttpError`, `toCsv`, `CSV_COLUMNS`, `BETA_VIEWS`, `RECON_KINDS`, `RECON_RESOLUTIONS`, `RECON_CHECKLIST` et leurs types.

## Commandes de test

Tests : `internal/csv.test.ts` (RFC 4180, injection de formule, montants sans perte), `testing/report.contract.test.ts` (contrat OpenAPI de chaque route, chaque statut déclaré) ; preuves sur PostgreSQL sous les rôles de production : `packages/db/test/l0/l0-us311-beta-reconciliation.test.ts` (fixture 9911) et la matrice des routes (`apps/api/src/testing/route-matrix.int.test.ts`). Commande unitaire (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/rpt --passWithNoTests
```

`pnpm --filter @rueda/db test:l0 -- l0-us311` et `pnpm --filter @rueda/api test:int` demandent PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (CI).
