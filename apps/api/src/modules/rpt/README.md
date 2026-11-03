# RPT — Reporting (`apps/api/src/modules/rpt`)

**RPT — Reporting** : vues de lecture (tableaux de bord, KPI), exports CSV. Dépendances autorisées : IAM, KYC, CAT, AVL, PRC, CTR, PAY, STL, PYO, TRP, CLM, MSG, NTF, REV, SUP, FIN, RISK (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 (« lecture seule de tous »)).

## Responsabilité

RPT sert des vues de lecture (17 §2.2, §2.14) :

- tableau de bord de l'hôte ;
- vue des retards pour l'ops ;
- KPI de sortie de bêta S1 à S4 (18 §1.1) ;
- exports CSV.

RPT n'écrit jamais dans les données d'un autre module. Il lit tous les modules, mais seulement en lecture.

État réel du code : **squelette**. `internal/` est vide et `index.ts` n'exporte que `RptModule`. Le module arrive avec US-311 (vues de la bêta, KPI de sortie et rapprochement par jambe assisté).

## Entités

RPT ne possède aucune table (17 §2.2 : « vues matérialisées uniquement »). Aucune vue matérialisée n'est encore créée.

## Événements

RPT n'émet aucun événement (17 §2.2). Aucun abonnement n'existe encore dans le code. Un consommateur fictif `rpt_other` sur `review.published` sert seulement de donnée de test au bus (`apps/api/src/modules/bus/internal/bus.test.ts`).

Cible : 17 §4.5 cite RPT parmi les consommateurs de `catalog.listing.status_changed`, `booking.hold.*`, `booking.payment.late_ignored`, `settlement.legs.*`, `booking.trip.booked`, `trip.status_changed`, `notification.dispatch.failed`, `review.published`, `finance.statement.issued`, `finance.reconciliation.delta_exceeded` et `support.review_queue.sla_breached`.

## Ports

Aucun port. L'API publique de `index.ts` se limite à `RptModule`.

## Commandes de test

Le module n'a encore aucun test. Commande unitaire (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/rpt --passWithNoTests
```

Aucun test d'intégration ni preuve L0 ne concerne encore RPT. Quand il y en aura, `pnpm --filter @rueda/api test:int` et `pnpm --filter @rueda/db test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
