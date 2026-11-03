# RISK — Fraud / Risk (`apps/api/src/modules/risk`)

**RISK — Fraud / Risk** : règles de risque, évaluation à la réservation, file de revue, journal explicable. Dépendances autorisées : IAM, KYC, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2).

## Responsabilité

RISK évalue le risque d'une réservation, d'un hold ou d'un utilisateur (17 §2.2, §2.14) :

- en bêta, 5 à 10 règles codées en dur, mais **déclarées** dans `risk_rule` (code, version, description) ;
- chaque décision (`AUTO_OK`, `REVIEW`, `REJECT`) est journalisée avec les règles déclenchées, pour rester explicable (BR-TRUST-01) ;
- une décision `REVIEW` alimente la file de revue humaine de SUP ; la capture n'a lieu qu'après la revue (PAY-006).

RISK ne pose pas lui-même les restrictions de compte : la table `core.iam_restriction` appartient à IAM (migration 0010).

État réel du code : **squelette**. `internal/` est vide et `index.ts` n'exporte que `RiskModule`. Le module arrive avec US-209 (contrôles bloquants et revue de chaque réservation) ; US-127 y ajoute la règle des comptes liés.

## Entités

| Entité (17 §3.2.13) | État                       |
| ------------------- | -------------------------- |
| `risk_rule`         | cible 17, pas encore créée |
| `risk_assessment`   | cible 17, pas encore créée |

## Événements

Aucun événement n'est encore émis par le code.

Cible (17 §4.5) :

- émis : `risk.review.required` / `.decided` (consommateurs : SUP pour la file, PAY pour la capture après revue) ;
- consommés : `iam.user.registered`, `iam.phone.verified` (IAM), `kyc.verification.status_changed` (KYC), `booking.hold.*` (AVL), `settlement.advance.*` (STL), `trip.offline.clock_skew_detected` (TRP).

## Ports

Aucun port. L'API publique de `index.ts` se limite à `RiskModule`.

## Commandes de test

Le module n'a encore aucun test. Commande unitaire (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/risk --passWithNoTests
```

Aucun test d'intégration ni preuve L0 ne concerne encore RISK. Quand il y en aura, `pnpm --filter @rueda/api test:int` et `pnpm --filter @rueda/db test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
