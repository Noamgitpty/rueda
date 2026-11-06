# PYO — Payouts (`apps/api/src/modules/pyo`)

**PYO — Payouts** : comptes de versement, lots de versement, compensation des débits (P0-B). Dépendances autorisées : STL, PAY, KYC (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 PYO --> STL).

## Responsabilité

PYO verse à l'hôte sa part (17 §2.2, §2.10) :

- compte de versement vérifié, au nom de l'hôte ;
- lots SM-6 par compte d'hôte, devise et type, à partir des jambes `HOST` libérées par STL ;
- compensation des débits du `host_ledger` (`NETTING`, SM-6b) ;
- gel (`ON_HOLD`) en cas de litige, de chargeback ou de réclamation, puis reprise.

PYO ne calcule pas la part de l'hôte (c'est STL) et n'appelle pas le PSP directement : il passe par le port `PaymentProvider` de PAY. Aucun versement si `payouts_enabled[pays]` vaut `false` : la garde est en base depuis US-049 (`core.settlement_release_blocker`, migration 0054, ADR-088), qui refuse tout `LEG_RELEASE` dès l'enregistrement de l'ordre (trip `COMPLETED`, `release_at` atteint, sous-marchand `ACTIVE`, interrupteurs du pays).

État réel du code : **squelette**. `internal/` est vide et `index.ts` n'exporte que `PyoModule`. Le module arrive avec US-707 (compte de versement), US-708 (versements depuis la jambe `HOST`), US-709 (compensations et solde négatif) et US-314 (versements fermés par pays, gel).

## Entités

| Entité (17 §3.2.9) | État                       |
| ------------------ | -------------------------- |
| `payout_account`   | cible 17, pas encore créée |
| `payout_batch`     | cible 17, pas encore créée |
| `payout_item`      | cible 17, pas encore créée |

17 §3.2.9 liste aussi `finance_approval` (table `core.settlement_finance_approval`, migration 0036, possédée par STL) et `tax_remittance` (module FIN).

## Événements

Aucun événement n'est encore émis par le code.

Cible (17 §4.5) :

- émis : `payout.batch.status_changed`. NTF y est déjà abonné (`apps/api/src/modules/ntf/internal/catalog.ts`) ; aucun producteur n'existe encore ;
- consommés : `settlement.legs.posted` / `.released` / `.reallocated` (STL), `host_ledger.state_changed` (STL), `trip.status_changed` (AVL), `payment.chargeback.opened` / `.closed` (PAY), `claim.status_changed` et `dispute.opened` / `.decided` (CLM).

## Ports

Aucun port propre à PYO. L'API publique de `index.ts` se limite à `PyoModule`.

Le versement passera par le port `PaymentProvider` de PAY (`apps/api/src/modules/pay/internal/port.ts` : `payout`, `adjustPayout`). Son adaptateur FAKE est le PSP simulé de `packages/fake-adapters` (sous-chemin `psp`, US-061), qui émet `payout.paid` et `payout.adjusted`. Voir [`packages/fake-adapters/README.md`](../../../../../packages/fake-adapters/README.md).

## Commandes de test

Le module n'a encore aucun test. Commande unitaire (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/pyo --passWithNoTests
```

Le contrat du port de versement est déjà testé côté PAY (sans base) :

```bash
pnpm --filter @rueda/api exec vitest run src/modules/pay/testing/marketplace.test.ts
```

Aucun test d'intégration ni preuve L0 ne concerne encore PYO. Quand il y en aura, `pnpm --filter @rueda/api test:int` et `pnpm --filter @rueda/db test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1`.
