# STL — Settlement engine & Ledger (`apps/api/src/modules/stl`)

**STL — Settlement engine & Ledger** : règlement économique pur, grand livre en partie double, host_ledger, commission. Dépendances autorisées : PRC, PAY, CFG (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 STL --> PAY, PRC (rupture du cycle STL ↔ PAY)).

## Responsabilité

STL calcule ce qui est dû après un événement de trip (annulation, fin, requalification). Il découpe ce dû en quatre jambes (`HOST`, `INSURER`, `TAX_THIRD_PARTY`, `PLATFORM`, 08 E7). Il tient les soldes par trip, segment et jambe, le grand livre, le `host_ledger` (SM-6b), l'`insurer_ledger` avec ses bordereaux, et les avances de Kmino (17 §2.2, §2.9).

STL ne déplace aucun fonds lui-même. Il planifie des commandes que PAY exécute auprès du PSP (17 §4.3). Il ne verse rien à l'hôte : c'est PYO.

État réel du code :

- Le module Nest de ce dossier est un **squelette** : `internal/` est vide et `index.ts` n'exporte que `StlModule`.
- Le **moteur pur** vit dans `packages/money` (US-017 : moteur des annulations ; US-018 : règlement persistable, versions, jambes). Voir [`packages/money/README.md`](../../../../../packages/money/README.md), sections « Moteur de règlement » et « Règlements persistés ».
- La **persistance** vit en base (US-018, US-062, US-061). Voir [`packages/db/README.md`](../../../../../packages/db/README.md), sections « Règlements et jambes », « Rôle P2P_HOST, tables d'argent et minimisation » et « Port de place de marché ».
- Restent à venir : le grand livre en partie double (US-530), les avances et remboursements par jambe (US-224, US-709), l'assureur et les bordereaux (US-227), le moteur complet (US-518).

## Entités

Bêta (17 §10 point 3) : schéma unique `core`, tables préfixées `settlement_`.

| Entité (17 §3.2.8)                         | État                                                            |
| ------------------------------------------ | --------------------------------------------------------------- |
| `settlement`                               | table `core.settlement_settlement` (migration 0027)             |
| `settlement_line`                          | table `core.settlement_settlement_line` (migration 0027)        |
| `settlement_leg`                           | table `core.settlement_settlement_leg` (migration 0027)         |
| `trip_leg_balance`                         | table `core.settlement_trip_leg_balance` (migration 0027)       |
| `finance_approval` (listée en 17 §3.2.9)   | table `core.settlement_finance_approval` (migration 0036)       |
| `platform_advance`                         | table `core.settlement_platform_advance` (migration 0036)       |
| `insurer_ledger_state`                     | table `core.settlement_insurer_ledger_state` (migration 0036)   |
| `insurer_bordereau`                        | table `core.settlement_insurer_bordereau` (migration 0036)      |
| `insurer_bordereau_line`                   | table `core.settlement_insurer_bordereau_line` (migration 0036) |
| `ledger_account`                           | cible 17, pas encore créée                                      |
| `journal_entry`                            | cible 17, pas encore créée                                      |
| `journal_line`                             | cible 17, pas encore créée                                      |
| `account_balance`                          | cible 17, pas encore créée                                      |
| `host_ledger_state`                        | cible 17, pas encore créée                                      |
| `insurer`, `insurer_contract` (17 §3.2.13) | cible 17, pas encore créées (US-227)                            |

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

## Événements

Aucun événement n'est encore émis par le code : aucune commande STL n'écrit dans l'outbox.

Cible (17 §4.5) :

- émis : `settlement.computed`, `settlement.superseded`, `settlement.legs.posted` / `.released` / `.reallocated`, `settlement.advance.opened` / `.recovered` / `.written_off`, `insurer.bordereau.issued`, `host_ledger.state_changed` ;
- 17 §2.2 cite aussi `ledger.entry.posted`, absent du catalogue §4.5 ;
- consommés : `trip.cancellation.qualified` (AVL), `payment.operation.status_changed` (PAY), `refund.instance.status_changed` (PAY), `trip.checkout.completed` (TRP), `dispute.opened` / `.decided` (CLM), `message.posted` (MSG, lecture de la preuve `hostMessageTraced`).

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
